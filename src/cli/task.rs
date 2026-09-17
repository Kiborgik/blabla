use super::{emit_error, error, write_json};
use blabla::project::Project;
use blabla::project::status::{StatusView, now_unix, status_view};
use blabla::project::task::{self, Finding, Opening, Task};
use blabla::skeptic::{self, ChallengeReport, Evidence};
use blabla::structure::default_providers;
use blabla::structure::falsify;
use serde::Serialize;
use std::io::{self, Write};

#[derive(Serialize)]
struct TaskView<'a> {
    task: &'a Task,
    open: bool,
    unresolved: usize,
    authority: &'static str,
}

fn view(task: &Task) -> TaskView<'_> {
    TaskView {
        open: task.open(),
        unresolved: task.unresolved().count(),
        authority: task::AUTHORITY,
        task,
    }
}

fn load(project: &Project, name: &str, json: bool) -> Result<Task, i32> {
    match task::read(&project.manifest.root, name) {
        Ok(Some(task)) => Ok(task),
        Ok(None) => Err(emit_error(
            error(
                "task",
                format!(
                    "no bounded task {name:?} is recorded; blabla task show lists every recorded task and blabla task open records one"
                ),
                None,
            ),
            json,
            2,
        )),
        Err(message) => Err(emit_error(error("task", message, None), json, 2)),
    }
}

fn store(project: &Project, task: &Task, json: bool) -> i32 {
    if let Err(failure) = task::write(&project.manifest.root, task) {
        return emit_error(
            error("task", format!("cannot record the task: {failure}"), None),
            json,
            2,
        );
    }
    let result = if json {
        write_json(&view(task))
    } else {
        write_task(task)
    };
    if result.is_ok() { 0 } else { 4 }
}

pub(super) fn open(project: &Project, opening: Opening, json: bool) -> i32 {
    let name = &opening.name;
    if !blabla::memory::syntax::is_identity_safe(name) {
        return emit_error(
            error(
                "task",
                format!(
                    "{name:?} cannot name a task; a name starts with a letter or digit and continues with letters, digits, '_' or '-'"
                ),
                None,
            ),
            json,
            2,
        );
    }
    let root = &project.manifest.root;
    let recorded = task::record(
        root,
        Opening {
            scope: opening.scope.into_iter().map(normalize).collect(),
            deliverables: opening.deliverables.into_iter().map(normalize).collect(),
            ..opening
        },
        now_unix(),
    );
    store(project, &recorded, json)
}

fn normalize(path: String) -> String {
    path.replace('\\', "/")
}

pub(super) fn finding(project: &Project, name: &str, statement: &str, json: bool) -> i32 {
    let mut task = match load(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    task.findings.push(Finding {
        id: task.next_finding_id(),
        statement: statement.to_owned(),
        resolution: None,
    });
    store(project, &task, json)
}

pub(super) fn resolve(project: &Project, name: &str, id: usize, evidence: &str, json: bool) -> i32 {
    let mut task = match load(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let Some(finding) = task.findings.iter_mut().find(|finding| finding.id == id) else {
        return emit_error(
            error(
                "task",
                format!("task {name:?} records no finding {id}"),
                None,
            ),
            json,
            2,
        );
    };
    finding.resolution = Some(evidence.to_owned());
    store(project, &task, json)
}

pub(super) fn widen(project: &Project, name: &str, add: Vec<String>, json: bool) -> i32 {
    let mut task = match load(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    for path in add.into_iter().map(normalize) {
        if !task.scope.contains(&path) {
            task.scope.push(path);
        }
    }
    store(project, &task, json)
}

pub(super) fn close(project: &Project, name: &str, json: bool) -> i32 {
    let mut task = match load(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    task.closed_unix = Some(now_unix());
    store(project, &task, json)
}

pub(super) fn show(project: &Project, name: Option<&str>, json: bool) -> i32 {
    let Some(name) = name else {
        let tasks = task::read_all(&project.manifest.root);
        let views: Vec<TaskView<'_>> = tasks.iter().map(view).collect();
        let result = if json {
            write_json(&views)
        } else {
            write_tasks(&tasks)
        };
        return if result.is_ok() { 0 } else { 4 };
    };
    let task = match load(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let result = if json {
        write_json(&view(&task))
    } else {
        write_task(&task)
    };
    if result.is_ok() { 0 } else { 4 }
}

pub(super) fn challenge(project: &Project, name: Option<&str>, json: bool) -> i32 {
    let root = &project.manifest.root;
    let selected = match name {
        Some(name) => match load(project, name, json) {
            Ok(task) => Some(task),
            Err(exit) => return exit,
        },
        None => {
            let mut open: Vec<Task> = task::read_all(root)
                .into_iter()
                .filter(Task::open)
                .collect();
            if open.len() > 1 {
                let names: Vec<String> = open
                    .iter()
                    .map(|task| format!("blabla challenge {}", task.name))
                    .collect();
                return emit_error(
                    error(
                        "task",
                        format!(
                            "{} bounded tasks are open, so there is no single one to challenge; run one of: {}",
                            open.len(),
                            names.join(" | ")
                        ),
                        None,
                    ),
                    json,
                    2,
                );
            }
            open.pop()
        }
    };
    let evaluation = super::project::evaluate_with_run_state(project);
    let structure = project.verify_structure();
    let status = status_view(project, &evaluation, &structure);
    let report = report_for(project, &status, selected.as_ref());
    let result = if json {
        write_json(&report)
    } else {
        write_challenge(&report)
    };
    if result.is_err() {
        return 4;
    }
    report.exit_code()
}

pub(super) fn report_for(
    project: &Project,
    status: &StatusView,
    selected: Option<&Task>,
) -> ChallengeReport {
    let root = &project.manifest.root;
    let tree = blabla::project::snapshot(root);
    skeptic::challenge(&Evidence {
        task: selected,
        tree: &tree,
        completion: status.completion.state,
        completion_reason: &status.completion.reason,
        falsify: &|| falsify::falsify(&project.structure, root, &default_providers()),
    })
}

pub(super) fn standing(project: &Project, status: &StatusView) -> ChallengeReport {
    let mut open: Vec<Task> = task::read_all(&project.manifest.root)
        .into_iter()
        .filter(Task::open)
        .collect();
    let selected = if open.len() == 1 { open.pop() } else { None };
    report_for(project, status, selected.as_ref())
}

pub(super) fn write_challenge(report: &ChallengeReport) -> io::Result<()> {
    let mut output = io::stdout().lock();
    write_challenge_into(&mut output, report)
}

pub(super) fn write_challenge_into(
    output: &mut impl Write,
    report: &ChallengeReport,
) -> io::Result<()> {
    match &report.task {
        Some(name) => writeln!(output, "CHALLENGE  bounded task {name}")?,
        None => writeln!(output, "CHALLENGE  no bounded task is open")?,
    }
    match &report.challenge {
        Some(challenge) => {
            writeln!(output, "\n{}\n", challenge.statement)?;
            writeln!(output, "Evidence:")?;
            for line in &challenge.evidence {
                writeln!(output, "  {line}")?;
            }
            writeln!(output, "\nReconcile:\n  {}", challenge.reconcile)?;
            writeln!(output, "\nClass: {}", challenge.class.word())?;
            let waiting: Vec<&str> = report
                .grounded
                .iter()
                .copied()
                .filter(|class| *class != challenge.class.word())
                .collect();
            if !waiting.is_empty() {
                writeln!(
                    output,
                    "Also standing, one challenge at a time: {}",
                    waiting.join(", ")
                )?;
            }
        }
        None => {
            writeln!(
                output,
                "\nNothing here can be challenged from the evidence BlaBla holds."
            )?;
        }
    }
    if !report.ungrounded.is_empty() {
        writeln!(output, "\nNot grounded:")?;
        for (class, reason) in &report.ungrounded {
            writeln!(output, "  {class}: {reason}")?;
        }
    }
    writeln!(output, "\n{}", report.authority)?;
    for limit in skeptic::LIMITS {
        writeln!(output, "{limit}")?;
    }
    Ok(())
}

fn write_task(task: &Task) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(
        output,
        "task::{}   {}",
        task.name,
        if task.open() { "OPEN" } else { "CLOSED" }
    )?;
    writeln!(output, "\nStatement:\n  {}", task.statement)?;
    writeln!(output, "\nCarried by:\n  role::{}", task.role)?;
    writeln!(
        output,
        "\nWrite scope:\n  {}",
        if task.scope.is_empty() {
            "none declared".to_owned()
        } else {
            task.scope.join("  ")
        }
    )?;
    writeln!(
        output,
        "\nDeliverables:\n  {}",
        if task.deliverables.is_empty() {
            "none declared".to_owned()
        } else {
            task.deliverables
                .iter()
                .map(|deliverable| deliverable.path.clone())
                .collect::<Vec<String>>()
                .join("  ")
        }
    )?;
    if task.findings.is_empty() {
        writeln!(output, "\nFindings:\n  none recorded")?;
    } else {
        writeln!(output, "\nFindings:")?;
        for finding in &task.findings {
            writeln!(output, "  {} {}", finding.id, finding.statement)?;
            match &finding.resolution {
                Some(resolution) => writeln!(output, "    resolved: {resolution}")?,
                None => writeln!(output, "    UNRESOLVED")?,
            }
        }
    }
    writeln!(output, "\n  blabla challenge {}", task.name)?;
    writeln!(output, "\n{}", task::AUTHORITY)
}

fn write_tasks(tasks: &[Task]) -> io::Result<()> {
    let mut output = io::stdout().lock();
    if tasks.is_empty() {
        writeln!(output, "No bounded task is recorded.")?;
        return writeln!(
            output,
            "  blabla task open <name> --role <role> --statement \"...\" --scope <path> --deliverable <path>"
        );
    }
    writeln!(output, "Bounded tasks:")?;
    for task in tasks {
        writeln!(
            output,
            "  task::{}   {}   role::{}   {} unresolved",
            task.name,
            if task.open() { "OPEN" } else { "CLOSED" },
            task.role,
            task.unresolved().count()
        )?;
    }
    writeln!(output, "\n  blabla task show <name>   one task in full")?;
    writeln!(output, "\n{}", task::AUTHORITY)
}
