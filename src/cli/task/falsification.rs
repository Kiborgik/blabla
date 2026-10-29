use super::*;

pub(super) fn run(project: &Project, action: TaskAction, json: bool) -> i32 {
    match action {
        TaskAction::Falsify { name } => falsify(project, &name, json),
        _ => unreachable!("only the falsify command is dispatched here"),
    }
}

pub(super) fn falsify_paths(
    project: &Project,
    task: &Task,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let root = &project.manifest.root;
    paths
        .iter()
        .map(|path| {
            let normalized = task::normalize_scope(root, path)?;
            if !task.in_scope(&normalized) {
                return Err(format!(
                    "falsify path {path:?} is outside the write scope of task {:?}; only files the task may write can be falsified",
                    task.name
                ));
            }
            if root.join(&normalized).is_dir() {
                return Err(format!("falsify path {path:?} is a directory; name a file"));
            }
            Ok(normalized)
        })
        .collect()
}

pub(super) fn falsify(project: &Project, name: &str, json: bool) -> i32 {
    let root = &project.manifest.root;
    let lock = refuse_on_err!(task::store::lock(root), json);
    let task = exit_on_err!(accepted_for_evidence(project, name, json));
    if task.falsify.is_empty() {
        return refuse(
            format!("task {name:?} names no paths to falsify; open it with --falsify PATH"),
            json,
        );
    }
    exit_on_err!(require_tracking(project, &task, json));
    exit_on_err!(require_current_review(project, &task, json));
    let Some(argv) = task.check.clone().filter(|argv| !argv.is_empty()) else {
        return refuse(
            format!(
                "task {name:?} declares no check, so falsify cannot execute it; the orchestrator declares one with blabla task check {name} --check <prog> <arg>..."
            ),
            json,
        );
    };
    let scratch = task::scratch_directory(root, name);
    let copy = task::falsify_copy_directory(root, name);
    if let Err(failure) = std::fs::create_dir_all(&scratch) {
        return refuse(
            format!("cannot create {}: {failure}", scratch.display()),
            json,
        );
    }
    drop(lock);
    let tree = match stage_copy(project, &copy) {
        Ok(tree) => tree,
        Err(message) => {
            let _ = std::fs::remove_dir_all(&copy);
            return refuse(message, json);
        }
    };
    let inputs = task::evidence_inputs(&task, &tree);
    let runs = run_in_copy(project, &task, name, &argv, &copy, &scratch, json);
    let _ = std::fs::remove_dir_all(&copy);
    let (current, opened) = exit_on_err!(runs);
    let _completion = refuse_on_err!(task::store::lock(root), json);
    let mut reloaded = exit_on_err!(accepted_for_evidence(project, name, json));
    if reloaded.opened_unix != task.opened_unix || reloaded.opened_tree != task.opened_tree {
        return refuse(
            format!("task {name:?} was replaced while its falsify run ran; nothing is recorded"),
            json,
        );
    }
    reloaded.falsifications.push(task::Falsification {
        acceptance_epoch: task.acceptance_epoch,
        check: argv.join(" "),
        current_exit: current.exit,
        current_log: current.log,
        opened_exit: opened.as_ref().map(|run| run.exit),
        opened_log: opened.map(|run| run.log),
        unix: now_unix(),
        inputs,
    });
    let code = store(project, &mut reloaded, json);
    if receipt_failed(code, json, reloaded.falsifications.last(), |receipt| {
        write_falsification_receipt(&mut io::stdout().lock(), receipt)
    }) {
        return 4;
    }
    code
}

struct FalsifyRun {
    exit: i32,
    log: String,
}

fn stage_copy(
    project: &Project,
    copy: &std::path::Path,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    if copy.exists() {
        std::fs::remove_dir_all(copy)
            .map_err(|failure| format!("cannot clear {}: {failure}", copy.display()))?;
    }
    let root = &project.manifest.root;
    let files: Vec<String> = blabla::project::snapshot(root, &project.ignore)
        .into_keys()
        .collect();
    task::store::copy_into(root, copy, &files)
        .map_err(|failure| format!("cannot copy the tree for falsify: {failure}"))?;
    Ok(blabla::project::snapshot(copy, &project.ignore))
}

fn run_in_copy(
    project: &Project,
    task: &Task,
    name: &str,
    argv: &[String],
    copy: &std::path::Path,
    scratch: &std::path::Path,
    json: bool,
) -> Result<(FalsifyRun, Option<FalsifyRun>), i32> {
    let label = task::scratch_label(name);
    let number = task.falsifications.len() + 1;
    let stamp = now_unix();
    let current = run_check(
        argv,
        copy,
        scratch,
        &label,
        &format!("falsify-{number}-current-{stamp}.log"),
        json,
    )?;
    if current.exit != 0 {
        return Ok((current, None));
    }
    let opened_directory = task::store::opened_directory(&project.manifest.root, name);
    if let Err(failure) = task::store::apply_opened(copy, &opened_directory, &task.falsify) {
        return Err(refuse(
            format!("cannot place the opened contents in the copy: {failure}"),
            json,
        ));
    }
    let opened = run_check(
        argv,
        copy,
        scratch,
        &label,
        &format!("falsify-{number}-opened-{stamp}.log"),
        json,
    )?;
    Ok((current, Some(opened)))
}

fn run_check(
    argv: &[String],
    dir: &std::path::Path,
    scratch: &std::path::Path,
    label: &str,
    log_name: &str,
    json: bool,
) -> Result<FalsifyRun, i32> {
    let output = std::process::Command::new(&argv[0])
        .args(&argv[1..])
        .current_dir(dir)
        .output()
        .map_err(|failure| refuse(format!("cannot spawn {}: {failure}", argv[0]), json))?;
    let Some(exit) = output.status.code() else {
        return Err(refuse(
            format!(
                "{} ended without an exit code; nothing is recorded",
                argv[0]
            ),
            json,
        ));
    };
    std::fs::write(
        scratch.join(log_name),
        [output.stdout, output.stderr].concat(),
    )
    .map_err(|failure| refuse(format!("cannot write {log_name}: {failure}"), json))?;
    Ok(FalsifyRun {
        exit,
        log: format!("{label}/{log_name}"),
    })
}

pub(super) fn write_falsification_receipt(
    output: &mut impl Write,
    falsification: &task::Falsification,
) -> io::Result<()> {
    let opened = falsification
        .opened_exit
        .map_or_else(|| "not run".to_owned(), |exit| exit.to_string());
    writeln!(
        output,
        "\nFalsification:\n  acceptance epoch {}   current exit {}   opened exit {opened}",
        epoch_label(Some(falsification.acceptance_epoch)),
        falsification.current_exit
    )?;
    writeln!(output, "  current log {}", falsification.current_log)?;
    if let Some(log) = &falsification.opened_log {
        writeln!(output, "  opened log {log}")?;
    }
    Ok(())
}
