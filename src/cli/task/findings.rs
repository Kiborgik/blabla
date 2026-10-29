use super::*;

pub(super) fn run(project: &Project, action: TaskAction, json: bool) -> i32 {
    match action {
        TaskAction::Finding { name, statement } => finding(project, &name, &statement, json),
        TaskAction::Note { name, statement } => note(project, &name, &statement, json),
        TaskAction::Addressed {
            name,
            id,
            statement,
            model,
        } => addressed(project, &name, id, &statement, &model, json),
        TaskAction::Resolve {
            name,
            id,
            evidence,
            model,
        } => resolve(project, &name, id, &evidence, &model, json),
        _ => unreachable!("only finding commands are dispatched here"),
    }
}

pub(super) fn find_finding(task: &mut Task, id: usize) -> Result<&mut Finding, String> {
    let name = task.name.clone();
    task.findings
        .iter_mut()
        .find(|finding| finding.id == id)
        .ok_or_else(|| format!("task {name:?} records no finding {id}"))
}

pub(super) fn finding(project: &Project, name: &str, statement: &str, json: bool) -> i32 {
    let mut task = exit_on_err!(mutate(project, name, json));
    let id = task.next_finding_id();
    task.findings.push(Finding {
        id,
        statement: statement.to_owned(),
        addressed: None,
        resolution: None,
        residual: false,
    });
    let code = store(project, &mut task, json);
    if code == 0 && !json {
        println!("finding {id} recorded on task::{name}");
    }
    code
}

pub(super) fn record_note(task: &mut Task, statement: &str) {
    task.notes.push(task::Note {
        statement: statement.to_owned(),
        unix: now_unix(),
    });
}

pub(super) fn note(project: &Project, name: &str, statement: &str, json: bool) -> i32 {
    let mut task = exit_on_err!(mutate(project, name, json));
    record_note(&mut task, statement);
    store(project, &mut task, json)
}

pub(super) fn addressed(
    project: &Project,
    name: &str,
    id: usize,
    statement: &str,
    model: &str,
    json: bool,
) -> i32 {
    let mut task = exit_on_err!(mutate(project, name, json));
    exit_on_err!(require_addressing_model(project, &task, model, json));
    exit_on_err!(require_declared_role(project, &task.role, json));
    let finding = refuse_on_err!(find_finding(&mut task, id), json);
    finding.addressed = Some(task::Addressed {
        model: model.to_owned(),
        statement: statement.to_owned(),
        unix: now_unix(),
    });
    task.challenged = None;
    store(project, &mut task, json)
}

pub(super) fn resolve(
    project: &Project,
    name: &str,
    id: usize,
    evidence: &str,
    model: &str,
    json: bool,
) -> i32 {
    exit_on_err!(validate_orchestrator_model(project, model, json));
    let recorded = exit_on_err!(load(project, name, json));
    let residual_on_closed = recorded.state == TaskState::Closed
        && recorded
            .findings
            .iter()
            .any(|finding| finding.id == id && finding.residual);
    let mut task = if residual_on_closed {
        recorded
    } else {
        exit_on_err!(mutate(project, name, json))
    };
    let finding = refuse_on_err!(find_finding(&mut task, id), json);
    finding.resolution = Some(task::FindingResolution {
        evidence: evidence.to_owned(),
        model: Some(model.to_owned()),
    });
    task::attest(&mut task, "resolve", Some(model), now_unix());
    store(project, &mut task, json)
}
