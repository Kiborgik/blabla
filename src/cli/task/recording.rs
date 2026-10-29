use super::*;

pub(super) fn run(project: &Project, action: TaskAction, json: bool) -> i32 {
    match action {
        TaskAction::Evidence {
            name,
            run: true,
            fail_on_check: true,
            ..
        } => evidence_run_with_failure_status(project, &name, json),
        TaskAction::Evidence {
            name, run: true, ..
        } => evidence_run(project, &name, json),
        TaskAction::Evidence {
            name,
            exit: Some(exit),
            tool: Some(tool),
            ..
        } => locked(project, json, || {
            evidence(project, &name, exit, &tool, json)
        }),
        _ => locked(project, json, || 2),
    }
}

pub(super) fn require_current_review(
    project: &Project,
    task: &Task,
    json: bool,
) -> Result<(), i32> {
    if review_freshness(project, task) == Some(false) {
        return Err(refuse(
            "the reviewed target changed; reaccept this review before recording evidence",
            json,
        ));
    }
    Ok(())
}

pub(super) fn accepted_for_evidence(
    project: &Project,
    name: &str,
    json: bool,
) -> Result<Task, i32> {
    let task = mutate(project, name, json)?;
    if task.state != TaskState::Accepted || task.accepted.is_none() {
        return Err(refuse(
            format!(
                "task {name:?} must be accepted before recording evidence; {}",
                handback_guidance(&task, "accept")
            ),
            json,
        ));
    }
    Ok(task)
}

pub(super) fn recordable(project: &Project, name: &str, json: bool) -> Result<Task, i32> {
    let task = accepted_for_evidence(project, name, json)?;
    require_tracking(project, &task, json)?;
    require_current_review(project, &task, json)?;
    Ok(task)
}

pub(super) fn tree_fingerprint(tree: &std::collections::BTreeMap<String, String>) -> String {
    let mut hasher = blabla::project::Fnv::new();
    for (path, digest) in tree {
        hasher.write_str(path);
        hasher.write_str(digest);
    }
    hasher.finish()
}

struct ManualEvidence<'a> {
    check: String,
    exit: i32,
    tool: &'a str,
    command: Option<Vec<String>>,
    log: Option<String>,
}

fn record_evidence(
    project: &Project,
    task: &mut Task,
    record: ManualEvidence<'_>,
    json: bool,
) -> i32 {
    let tree = view_tree(project);
    let inputs = task::evidence_inputs(task, &tree);
    let member_manifest = Some(task::capture_evidence_members(
        &inputs,
        &tree,
        "manual-record",
    ));
    task.evidence.push(task::Evidence {
        reuse: None,
        identity: task::declared_check(task),
        acceptance_epoch: Some(task.acceptance_epoch),
        check: record.check,
        exit: record.exit,
        tree: tree_fingerprint(&tree),
        tool: record.tool.to_owned(),
        unix: now_unix(),
        inputs,
        command: record.command,
        log: record.log,
        member_manifest,
    });
    store(project, task, json)
}

pub(super) fn evidence(project: &Project, name: &str, exit: i32, tool: &str, json: bool) -> i32 {
    let mut task = exit_on_err!(recordable(project, name, json));
    let Some(check) = task.check.as_deref().map(command_line) else {
        return refuse(
            format!(
                "task {name:?} declares no check, so a result cannot be bound to one. The orchestrator declares one with blabla task check {name} --check <prog> <arg>...; ask which check covers this work rather than choosing one"
            ),
            json,
        );
    };
    let record = ManualEvidence {
        check,
        exit,
        tool,
        command: None,
        log: None,
    };
    record_evidence(project, &mut task, record, json)
}

pub(super) fn evidence_run(project: &Project, name: &str, json: bool) -> i32 {
    evidence_run_with_status(project, name, json, false)
}

pub(super) fn evidence_run_with_failure_status(project: &Project, name: &str, json: bool) -> i32 {
    evidence_run_with_status(project, name, json, true)
}

fn evidence_run_with_status(project: &Project, name: &str, json: bool, fail_on_check: bool) -> i32 {
    let initial_lock = refuse_on_err!(task::store::lock(&project.manifest.root), json);
    let task = exit_on_err!(recordable(project, name, json));
    let Some(argv) = task.check.clone().filter(|argv| !argv.is_empty()) else {
        return refuse(
            format!(
                "task {name:?} declares no check, so --run cannot execute it; the orchestrator declares one with blabla task check {name} --check <prog> <arg>..."
            ),
            json,
        );
    };
    let root = &project.manifest.root;
    let tree = blabla::project::snapshot(root, &project.ignore);
    let input_digests = task::evidence_inputs(&task, &tree);
    let member_manifest = Some(task::capture_evidence_members(
        &input_digests,
        &tree,
        "execution-start",
    ));
    let identity = task::declared_check(&task);
    let acceptance_epoch = task.acceptance_epoch;
    let pins = progress::fingerprint(&(
        &identity,
        acceptance_epoch,
        &tree,
        &input_digests,
        &member_manifest,
    ));
    let Ok(mut run) = progress::Run::create(root, &task, pins) else {
        return refuse(
            "cannot prepare private evidence capture; nothing is recorded",
            json,
        );
    };
    let streams = run
        .stdout
        .try_clone()
        .and_then(|stdout| run.stderr.try_clone().map(|stderr| (stdout, stderr)));
    let Ok((stdout, stderr)) = streams else {
        run.recording(progress::Recording::Failed, None);
        return refuse("cannot prepare evidence streams; nothing is recorded", json);
    };
    drop(initial_lock);
    if !json {
        eprintln!(
            "Evidence run {}: private capture, {} byte combined limit; inspect task show {} for last-observed progress",
            run.id(),
            blabla::runtime::evidence_capture::OUTPUT_LIMIT,
            name
        );
    }
    let mut command = std::process::Command::new(&argv[0]);
    command.args(&argv[1..]).current_dir(root);
    let mut captured =
        blabla::runtime::evidence_capture::run(&mut command, stdout, stderr, |snapshot| {
            run.observe(snapshot)
        });
    if !captured.complete {
        run.recording(progress::Recording::Failed, None);
        return refuse(
            format!(
                "evidence capture incomplete ({:?}); partial bytes retained; nothing is recorded",
                captured.failure
            ),
            json,
        );
    }
    if run.finalize(&mut captured).is_err() {
        run.recording(progress::Recording::Failed, None);
        return refuse(
            "cannot publish complete evidence log; partial artifacts retained; nothing is recorded",
            json,
        );
    }
    let blabla::runtime::evidence_capture::ChildObservation::Exited { code: exit } = captured.child
    else {
        run.recording(progress::Recording::Refused, None);
        return refuse(
            "check ended without a numeric exit code; complete log retained; nothing is recorded",
            json,
        );
    };
    let log = run.log(name);
    let _completion_lock = match task::store::lock(root) {
        Ok(lock) => lock,
        Err(message) => {
            run.recording(progress::Recording::Failed, None);
            return refuse(message, json);
        }
    };
    let mut reloaded = match accepted_for_evidence(project, name, json) {
        Ok(task) => task,
        Err(exit) => {
            run.recording(progress::Recording::Refused, None);
            return exit;
        }
    };
    if reloaded.opened_unix != task.opened_unix || reloaded.opened_tree != task.opened_tree {
        run.recording(progress::Recording::Refused, None);
        return refuse(
            format!("task {name:?} was replaced while its check ran; nothing is recorded"),
            json,
        );
    }
    let evidence = task::Evidence {
        reuse: None,
        identity,
        acceptance_epoch: Some(acceptance_epoch),
        check: command_line(&argv),
        exit,
        tree: tree_fingerprint(&tree),
        tool: "run".to_owned(),
        unix: now_unix(),
        inputs: input_digests,
        command: Some(argv),
        log: Some(log),
        member_manifest,
    };
    let receipt_fingerprint = progress::fingerprint(&evidence);
    run.recording(
        progress::Recording::Pending,
        Some(receipt_fingerprint.clone()),
    );
    if run.ensure_current().is_err() {
        run.recording(progress::Recording::Refused, None);
        return refuse(
            "evidence capture ancestry changed; nothing is recorded",
            json,
        );
    }
    task::apply_evidence(&mut reloaded, evidence);
    let code = store(project, &mut reloaded, json);
    let recorded = task::read(root, name).ok().flatten().is_some_and(|task| {
        task.evidence
            .iter()
            .any(|evidence| progress::fingerprint(evidence) == receipt_fingerprint)
    });
    run.recording(
        if recorded {
            progress::Recording::Recorded
        } else {
            progress::Recording::Failed
        },
        None,
    );
    if receipt_failed(code, json, reloaded.evidence.last(), |receipt| {
        write_evidence_receipt(&mut io::stdout().lock(), receipt)
    }) {
        return 4;
    }
    match (code, fail_on_check, recorded, exit) {
        (0, true, false, _) => 2,
        (0, true, true, exit) if exit != 0 => 1,
        _ => code,
    }
}
