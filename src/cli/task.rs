use super::{emit_error, error, recovery, write_json};
use blabla::project::Project;
use blabla::project::status::{RECORD_DIRECTORY, StatusView, now_unix, status_view};
use blabla::project::task::{self, Finding, Opening, Task};
use blabla::skeptic::{self, ChallengeReport, Evidence};
use blabla::structure::default_providers;
use blabla::structure::falsify;
use blabla::voice::{Voice, contradiction};
use serde::Serialize;
use std::io::{self, Write};

#[derive(Serialize)]
struct TaskView<'a> {
    task: &'a Task,
    open: bool,
    unresolved: usize,
    possibly_incomplete: bool,
    authority: &'static str,
}

fn view(task: &Task) -> TaskView<'_> {
    TaskView {
        open: task.open(),
        unresolved: task.unresolved().count(),
        possibly_incomplete: recovery::foreign(recovery::running(), task.build.as_deref()),
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

fn mutate(project: &Project, name: &str, json: bool) -> Result<Task, i32> {
    let task = load(project, name, json)?;
    if task.open() {
        return Ok(task);
    }
    Err(emit_error(
        error(
            "task",
            format!(
                "task {name:?} is closed; what it holds is history rather than open evidence, and amending it would rewrite an account that was already decided. Open a new task for the follow-on work"
            ),
            None,
        ),
        json,
        2,
    ))
}

fn declared_role(project: &Project, role_name: &str) -> Option<blabla::memory::process::Role> {
    project
        .manifest
        .process
        .as_ref()
        .map(|entry| {
            blabla::memory::read(
                &entry.path,
                &entry.display,
                blabla::memory::process::build,
                blabla::memory::process::validate,
            )
        })
        .and_then(|memory| {
            memory.present().and_then(|process| {
                process
                    .roles
                    .iter()
                    .find(|role| role.name == role_name)
                    .cloned()
            })
        })
}

fn validate_orchestrator_model(project: &Project, model: &str, json: bool) -> Result<(), i32> {
    let role = declared_role(project, "orchestrator");
    match role {
        Some(role) if role.model.is_empty() || role.model.contains(&model.to_owned()) => Ok(()),
        Some(role) => Err(emit_error(
            error(
                "task",
                format!(
                    "model {model:?} is not in role::orchestrator's permitted list: {}",
                    role.model.join(", ")
                ),
                None,
            ),
            json,
            2,
        )),
        None => Err(emit_error(
            error("task", undeclared_role("orchestrator"), None),
            json,
            2,
        )),
    }
}

fn undeclared_role(role: &str) -> String {
    include_str!("text/role-undeclared.md").replace("{{role}}", role)
}

fn create(project: &Project, task: &mut Task, json: bool) -> i32 {
    if let Some(identity) = recovery::running() {
        task.build = Some(identity.stamp());
    }
    write_record(project, task, json, true)
}

fn store(project: &Project, task: &mut Task, json: bool) -> i32 {
    let identity = recovery::running();
    if let Some(identity) = identity
        && let Some(message) = recovery::refuse_write(identity, task.build.as_deref())
    {
        return emit_error(error("recovery", message, None), json, 2);
    }
    if let Some(identity) = identity {
        task.build = Some(identity.stamp());
    }
    write_record(project, task, json, false)
}

fn write_record(project: &Project, task: &mut Task, json: bool, whole_view: bool) -> i32 {
    let task = &*task;
    if let Err(failure) = task::write(&project.manifest.root, task) {
        return emit_error(
            error("task", format!("cannot record the task: {failure}"), None),
            json,
            2,
        );
    }
    let result = if json {
        write_json(&view(task))
    } else if whole_view {
        write_task(task)
    } else {
        write_task_line(task)
    };
    if result.is_ok() { 0 } else { 4 }
}

fn write_task_line(task: &Task) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(
        output,
        "task::{}   {}   recorded; blabla task show {} prints the record",
        task.name,
        state_label(task),
        task.name
    )
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
    let existing = task::read(root, name).ok().flatten();
    if !task::replaceable(existing.as_ref())
        && let Some(existing) = existing
    {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} is already recorded in state {state:?}; opening it again would replace what it holds, and a closed record is history rather than a free name. Read it with blabla task show {name}, or choose a name nothing has used",
                    state = existing.state
                ),
                None,
            ),
            json,
            2,
        );
    }
    let ignored = ignored_declaration(project, "deliverable", &opening.deliverables)
        .or_else(|| ignored_declaration(project, "input", &opening.inputs));
    if let Some(message) = ignored {
        return emit_error(error("task", message, None), json, 2);
    }
    let mut recorded = task::record(
        root,
        &project.ignore,
        Opening {
            scope: opening.scope.into_iter().map(normalize).collect(),
            inputs: opening.inputs.into_iter().map(normalize).collect(),
            deliverables: owed_paths(project, opening.deliverables),
            ..opening
        },
        now_unix(),
    );
    create(project, &mut recorded, json)
}

fn ignored_declaration(project: &Project, kind: &str, declared: &[String]) -> Option<String> {
    let root = &project.manifest.root;
    declared.iter().map(|path| normalize(path.clone())).find_map(|path| {
        project
            .ignore
            .rule_for(&path, root.join(&path).is_dir())
            .map(|rule| {
                format!(
                    "{kind} {path:?} is left out of change tracking by {rule}, so BlaBla could never observe it; drop that ignore rule or declare a path it does not cover"
                )
            })
    })
}

fn normalize(path: String) -> String {
    path.replace('\\', "/")
}

fn owed_paths(project: &Project, declared: Vec<String>) -> Vec<String> {
    let root = &project.manifest.root;
    let mut tree: Option<Vec<String>> = None;
    let mut owed = Vec::new();
    for path in declared.into_iter().map(normalize) {
        if !root.join(&path).is_dir() {
            owed.push(path);
            continue;
        }
        let files = tree.get_or_insert_with(|| {
            blabla::project::snapshot(root, &project.ignore)
                .into_keys()
                .collect::<Vec<String>>()
        });
        let prefix = format!("{path}/");
        let under: Vec<String> = files
            .iter()
            .filter(|name| name.starts_with(&prefix))
            .cloned()
            .collect();
        if under.is_empty() {
            owed.push(path);
        } else {
            owed.extend(under);
        }
    }
    owed
}

pub(super) fn finding(project: &Project, name: &str, statement: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    task.findings.push(Finding {
        id: task.next_finding_id(),
        statement: statement.to_owned(),
        addressed: None,
        resolution: None,
    });
    store(project, &mut task, json)
}

pub(super) fn note(project: &Project, name: &str, statement: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    task.notes.push(task::Note {
        statement: statement.to_owned(),
        unix: now_unix(),
    });
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
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    match declared_role(project, &task.role) {
        Some(role) if role.model.is_empty() || role.model.contains(&model.to_owned()) => {}
        Some(role) => {
            return emit_error(
                error(
                    "task",
                    format!(
                        "model {model:?} is not in role::{}'s permitted list: {}",
                        task.role,
                        role.model.join(", ")
                    ),
                    None,
                ),
                json,
                2,
            );
        }
        None => {
            return emit_error(error("task", undeclared_role(&task.role), None), json, 2);
        }
    }
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
    if let Err(exit) = validate_orchestrator_model(project, model, json) {
        return exit;
    }
    let mut task = match mutate(project, name, json) {
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
    finding.resolution = Some(task::FindingResolution {
        evidence: evidence.to_owned(),
        model: Some(model.to_owned()),
    });
    store(project, &mut task, json)
}

pub(super) fn widen(project: &Project, name: &str, add: Vec<String>, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    for path in add.into_iter().map(normalize) {
        if !task.scope.contains(&path) {
            task.scope.push(path);
        }
    }
    store(project, &mut task, json)
}

pub(super) fn owe(project: &Project, name: &str, add: Vec<String>, json: bool) -> i32 {
    if let Some(message) = ignored_declaration(project, "deliverable", &add) {
        return emit_error(error("task", message, None), json, 2);
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let root = &project.manifest.root;
    for path in owed_paths(project, add) {
        task.removed_deliverables
            .retain(|removed| removed.path != path);
        if task
            .deliverables
            .iter()
            .any(|deliverable| deliverable.path == path)
        {
            continue;
        }
        let opened_digest = blabla::project::digest_of(root, &path);
        task.deliverables.push(task::Deliverable {
            opened_digest,
            path,
        });
    }
    store(project, &mut task, json)
}

pub(super) fn unowe(
    project: &Project,
    name: &str,
    path: &str,
    reason: Option<&str>,
    model: Option<&str>,
    json: bool,
) -> i32 {
    let (Some(reason), Some(model)) = (reason.filter(|text| !text.trim().is_empty()), model) else {
        return emit_error(
            error(
                "task",
                "task deliverable --remove needs --reason \"...\" and --model <id>: withdrawing a deliverable is the orchestrator's decision and the record keeps why".to_owned(),
                None,
            ),
            json,
            2,
        );
    };
    if let Err(exit) = validate_orchestrator_model(project, model, json) {
        return exit;
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let path = normalize(path.to_owned());
    let withdrawn: Vec<String> = task
        .deliverables
        .iter()
        .filter(|deliverable| task::covers(&path, &deliverable.path))
        .map(|deliverable| deliverable.path.clone())
        .collect();
    if withdrawn.is_empty() {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} owes no deliverable at {path}, so there is nothing to withdraw; blabla task show {name} lists what it owes"
                ),
                None,
            ),
            json,
            2,
        );
    }
    task.deliverables
        .retain(|deliverable| !withdrawn.contains(&deliverable.path));
    let unix = now_unix();
    task.removed_deliverables
        .extend(withdrawn.into_iter().map(|path| task::RemovedDeliverable {
            path,
            reason: reason.to_owned(),
            unix,
        }));
    store(project, &mut task, json)
}

pub(super) fn declare_check(
    project: &Project,
    name: &str,
    command: Option<String>,
    argv: Vec<String>,
    inputs: Vec<String>,
    json: bool,
) -> i32 {
    if let Some(message) = ignored_declaration(project, "input", &inputs) {
        return emit_error(error("task", message, None), json, 2);
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if let Some(cmd) = command {
        task.check = Some(cmd);
        task.check_argv = None;
    }
    if !argv.is_empty() {
        task.check_argv = Some(argv);
        task.check = None;
    }
    task.check_inputs = inputs.into_iter().map(normalize).collect();
    task.challenged = None;
    store(project, &mut task, json)
}

pub(super) fn close(project: &Project, name: &str, model: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    if task.state == "ready" && !task::challenge_current(&task, &tree) {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} changed since its challenge; resume with blabla task accept {name} --model <id>, verify and challenge again before hand-back"
                ),
                None,
            ),
            json,
            2,
        );
    }
    let evaluation = super::project::evaluate_with_run_state(project);
    let structure = project.verify_structure();
    let status = status_view(project, &evaluation, &structure);
    let report = report_for(project, &status, Some(&task));
    let standing = report.grounded.len();
    if !task::accept_result(&mut task, &tree, standing, model, now_unix()) {
        return emit_error(
            error(
                "task",
                format!(
                    "the result of {name:?} is not accepted: {reason}. blabla challenge {name} states what stands",
                    reason = if standing == 0 {
                        format!(
                            "state {state:?} is not a hand-back awaiting a decision",
                            state = task.state
                        )
                    } else {
                        format!("{standing} grounded challenge(s) stand against it")
                    }
                ),
                None,
            ),
            json,
            2,
        );
    }
    store(project, &mut task, json)
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
        write_task(&task).and_then(|()| write_resolution(&resolved(project, &task)))
    };
    if result.is_ok() { 0 } else { 4 }
}

fn write_resolution(resolution: &task::Resolution) -> io::Result<()> {
    let out = io::stdout();
    let mut out = out.lock();
    writeln!(out, "Resolved for this assignment:")?;
    writeln!(
        out,
        "  models permitted   {}",
        join_or(&resolution.models, "none declared by the role")
    )?;
    writeln!(
        out,
        "  lenses consulted   {}",
        join_or(&resolution.lenses, "none")
    )?;
    writeln!(out, "  verification tier  {}", resolution.verification)?;
    writeln!(
        out,
        "  contracts in scope {}",
        join_or(&resolution.requirements, "none touch this scope")
    )?;
    writeln!(
        out,
        "  blabla explain role::<name>   the authority behind these; this view is a summary"
    )?;
    Ok(())
}

fn join_or(values: &[String], empty: &str) -> String {
    if values.is_empty() {
        empty.to_owned()
    } else {
        values.join("  ")
    }
}

pub(super) fn accept(project: &Project, name: &str, model: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if !task::apply(&mut task, "accepted") {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} state {state:?} → \"accepted\" is not allowed",
                    state = task.state
                ),
                None,
            ),
            json,
            2,
        );
    }
    let current_tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    task::record_acceptance(&mut task, &current_tree, model, now_unix());
    store(project, &mut task, json)
}

pub(super) fn block(project: &Project, name: &str, reason: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if !task::apply(&mut task, "blocked") {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} state {state:?} → \"blocked\" is not allowed",
                    state = task.state
                ),
                None,
            ),
            json,
            2,
        );
    }
    task.findings.push(Finding {
        id: task.next_finding_id(),
        statement: reason.to_owned(),
        addressed: None,
        resolution: None,
    });
    store(project, &mut task, json)
}

pub(super) fn ready(project: &Project, name: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let evaluation = super::project::evaluate_with_run_state(project);
    let structure = project.verify_structure();
    let status = status_view(project, &evaluation, &structure);
    let report = report_for(project, &status, Some(&task));
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    if let Err(next) = task::mark_ready(&mut task, &tree, assignment_blockers(&report).len()) {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} cannot be handed back from {state:?}: {guidance}",
                    state = task.state,
                    guidance = handback_guidance(&task, next)
                ),
                None,
            ),
            json,
            2,
        );
    }
    store(project, &mut task, json)
}

fn handback_guidance(task: &Task, next: &str) -> String {
    let name = &task.name;
    match next {
        "accept" => format!("accept or resume it with blabla task accept {name} --model <id>"),
        "declare-check" => format!(
            "ask the orchestrator to declare its check with blabla task check {name} \"<command>\""
        ),
        "record-evidence" if task.check_argv.is_some() => format!(
            "run its declared check with blabla task evidence {name} --run, which records the exit code BlaBla observes"
        ),
        "record-evidence" => format!(
            "run its declared check, then record the actual result with blabla task evidence {name} --exit <code> --tool <label>"
        ),
        "challenge" | "resolve-challenge" => format!(
            "run blabla challenge {name}, reconcile assignment blockers, then retry the hand-back"
        ),
        "review" => "it is already READY; review and result acceptance belong to the orchestrator"
            .to_owned(),
        "closed" => "it is CLOSED; open a new assignment for new work".to_owned(),
        _ => "the task record has an invalid state".to_owned(),
    }
}

fn assignment_blockers(report: &ChallengeReport) -> Vec<&'static str> {
    report
        .grounded
        .iter()
        .copied()
        .filter(|class| !matches!(*class, "verification-not-current" | "vacuous-rule"))
        .collect()
}

pub(super) fn lens(project: &Project, name: &str, lens: &str, statement: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    task.assessments.push(task::Assessment {
        ruling: lens.to_owned(),
        statement: statement.to_owned(),
        unix: now_unix(),
    });
    store(project, &mut task, json)
}

pub(super) fn propose_model(
    project: &Project,
    name: &str,
    model: &str,
    reason: &str,
    json: bool,
) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    task.exceptions.push(task::Exception {
        model: model.to_owned(),
        reason: reason.to_owned(),
        approval: None,
    });
    store(project, &mut task, json)
}

pub(super) fn approve_model(
    project: &Project,
    name: &str,
    model: &str,
    approval: &str,
    json: bool,
) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let Some(exception) = task
        .exceptions
        .iter_mut()
        .find(|exception| exception.model == model && exception.approval.is_none())
    else {
        return emit_error(
            error(
                "E_NO_PROPOSAL",
                format!("no unresolved model exception for {model} is recorded on {name}"),
                None,
            ),
            json,
            3,
        );
    };
    exception.approval = Some(approval.to_owned());
    store(project, &mut task, json)
}

pub(super) fn attribute(
    project: &Project,
    name: &str,
    paths: &[String],
    kind: &str,
    model: &str,
    json: bool,
) -> i32 {
    if !task::ATTRIBUTIONS.contains(&kind) {
        return emit_error(
            error(
                "task",
                format!(
                    "{kind:?} does not name an origin; BlaBla records {}",
                    task::ATTRIBUTIONS.join(", ")
                ),
                None,
            ),
            json,
            2,
        );
    }
    if let Err(exit) = validate_orchestrator_model(project, model, json) {
        return exit;
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    let changed: Vec<String> = task::changed(&task, &tree)
        .into_iter()
        .map(str::to_owned)
        .collect();
    for path in paths {
        let path = normalize(path.to_owned());
        let inside = format!("{}/", path.trim_end_matches('/'));
        if !changed
            .iter()
            .any(|moved| *moved == path || moved.starts_with(&inside))
        {
            return emit_error(
                error(
                    "task",
                    format!(
                        "{path} has not changed since the task opened, so there is nothing to attribute; blabla challenge {name} names the paths that have"
                    ),
                    None,
                ),
                json,
                2,
            );
        }
        let digest = blabla::project::digest_of(&project.manifest.root, &path);
        task.attributions.retain(|entry| entry.path != path);
        task.attributions.push(task::Attribution {
            path,
            kind: kind.to_owned(),
            digest,
            model: Some(model.to_owned()),
        });
    }
    store(project, &mut task, json)
}

fn accepted_for_evidence(project: &Project, name: &str, json: bool) -> Result<Task, i32> {
    let task = mutate(project, name, json)?;
    if task.state != "accepted" || task.accepted.is_none() {
        return Err(emit_error(
            error(
                "task",
                format!(
                    "task {name:?} must be accepted before recording evidence; {}",
                    handback_guidance(&task, "accept")
                ),
                None,
            ),
            json,
            2,
        ));
    }
    Ok(task)
}

#[allow(clippy::too_many_arguments)]
fn record_evidence(
    project: &Project,
    task: &mut Task,
    check: String,
    exit: i32,
    tool: &str,
    command: Option<Vec<String>>,
    log: Option<String>,
    json: bool,
) -> i32 {
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    let inputs = task::evidence_inputs(task, &tree);
    let mut hasher = blabla::project::Fnv::new();
    for (path, digest) in &tree {
        hasher.write_str(path);
        hasher.write_str(digest);
    }
    task.evidence.push(task::Evidence {
        check,
        exit,
        tree: hasher.finish(),
        tool: tool.to_owned(),
        unix: now_unix(),
        inputs,
        command,
        log,
    });
    store(project, task, json)
}

pub(super) fn evidence(project: &Project, name: &str, exit: i32, tool: &str, json: bool) -> i32 {
    let mut task = match accepted_for_evidence(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let Some(check) = task.check.clone() else {
        let message = if task.check_argv.is_some() {
            format!(
                "task {name:?} declares its check as a program and its arguments; {}",
                handback_guidance(&task, "record-evidence")
            )
        } else {
            format!(
                "task {name:?} declares no check, so a result cannot be bound to one. The orchestrator declares one with blabla task check {name} \"<command>\"; ask which check covers this work rather than choosing one"
            )
        };
        return emit_error(error("task", message, None), json, 2);
    };
    record_evidence(project, &mut task, check, exit, tool, None, None, json)
}

pub(super) fn evidence_run(project: &Project, name: &str, json: bool) -> i32 {
    let mut task = match accepted_for_evidence(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let Some(argv) = task.check_argv.clone().filter(|argv| !argv.is_empty()) else {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} declares no argv check, so --run cannot execute it; the orchestrator declares one with blabla task check {name} --argv <prog> <arg>..."
                ),
                None,
            ),
            json,
            2,
        );
    };
    let root = &project.manifest.root;
    let scratch = root
        .join(RECORD_DIRECTORY)
        .join(task::SCRATCH_DIRECTORY)
        .join(name);
    if let Err(failure) = std::fs::create_dir_all(&scratch) {
        return emit_error(
            error(
                "task",
                format!("cannot create {}: {failure}", scratch.display()),
                None,
            ),
            json,
            2,
        );
    }
    let log_name = format!("evidence-{}.log", task.evidence.len() + 1);
    let output = match std::process::Command::new(&argv[0])
        .args(&argv[1..])
        .current_dir(root)
        .output()
    {
        Ok(output) => output,
        Err(failure) => {
            return emit_error(
                error("task", format!("cannot spawn {}: {failure}", argv[0]), None),
                json,
                2,
            );
        }
    };
    let Some(exit) = output.status.code() else {
        return emit_error(
            error(
                "task",
                format!(
                    "{} ended without an exit code; nothing is recorded",
                    argv[0]
                ),
                None,
            ),
            json,
            2,
        );
    };
    if let Err(failure) = std::fs::write(
        scratch.join(&log_name),
        [output.stdout, output.stderr].concat(),
    ) {
        return emit_error(
            error("task", format!("cannot write {log_name}: {failure}"), None),
            json,
            2,
        );
    }
    let log = format!(
        "{RECORD_DIRECTORY}/{}/{name}/{log_name}",
        task::SCRATCH_DIRECTORY
    );
    record_evidence(
        project,
        &mut task,
        argv.join(" "),
        exit,
        "run",
        Some(argv),
        Some(log),
        json,
    )
}

pub(super) fn challenge(project: &Project, name: Option<&str>, json: bool) -> i32 {
    let root = &project.manifest.root;
    let mut selected = match name {
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
    let tree = blabla::project::snapshot(root, &project.ignore);
    let blockers = assignment_blockers(&report);
    let mut assignment_clear = None;
    if let Some(task) = selected.as_mut() {
        if task.state == "accepted" {
            let recorded = task::record_challenge(task, &tree, blockers.len(), now_unix());
            if let Some(identity) = recovery::running() {
                if let Some(message) = recovery::refuse_write(identity, task.build.as_deref()) {
                    return emit_error(error("recovery", message, None), json, 2);
                }
                task.build = Some(identity.stamp());
            }
            if let Err(failure) = task::write(root, task) {
                return emit_error(
                    error("task", format!("cannot record challenge: {failure}"), None),
                    json,
                    2,
                );
            }
            assignment_clear = Some(recorded);
        } else if task.state != "closed" {
            assignment_clear = Some(
                task.state == "ready"
                    && blockers.is_empty()
                    && task::readiness(task, &tree).supported
                    && task::challenge_current(task, &tree),
            );
        }
    }
    let result = if json {
        let mut view = serde_json::to_value(&report).expect("challenge serializes");
        view["assignment_clear"] = serde_json::json!(assignment_clear);
        write_json(&view)
    } else {
        let scoped = if let Some(clear) = assignment_clear {
            let task = selected.as_ref().expect("selected task");
            let detail = if clear {
                let next = if task.state == "accepted" {
                    format!("hand back now with blabla task ready {}; ", task.name)
                } else {
                    String::new()
                };
                format!(
                    "current assignment evidence and challenge support hand-back; {next}project-wide verification remains the orchestrator's"
                )
            } else {
                handback_guidance(
                    task,
                    task::handback(task, &tree)
                        .err()
                        .unwrap_or("resolve-challenge"),
                )
            };
            writeln!(
                io::stdout().lock(),
                "\nAssignment check: {} — {detail}",
                if clear { "CLEAR" } else { "BLOCKED" }
            )
        } else {
            Ok(())
        };
        scoped.and_then(|()| write_challenge(&report, project.manifest.voice))
    };
    if result.is_err() {
        return 4;
    }
    assignment_clear.map_or_else(|| report.exit_code(), |clear| if clear { 0 } else { 1 })
}

pub(super) fn report_for(
    project: &Project,
    status: &StatusView,
    selected: Option<&Task>,
) -> ChallengeReport {
    let root = &project.manifest.root;
    let tree = blabla::project::snapshot(root, &project.ignore);
    let resolution = selected.map(|task| resolved(project, task));
    let other_tasks = task::read_all(root);
    skeptic::challenge(&Evidence {
        task: selected,
        tree: &tree,
        completion: status.completion.state,
        completion_reason: &status.completion.reason,
        falsify: &|| falsify::falsify(&project.structure, root, &default_providers()),
        role: resolution.as_ref(),
        other_tasks: &other_tasks,
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

pub(super) fn write_challenge(report: &ChallengeReport, voice: Voice) -> io::Result<()> {
    let mut output = io::stdout().lock();
    write_challenge_into(&mut output, report, voice)
}

pub(super) fn write_challenge_into(
    output: &mut impl Write,
    report: &ChallengeReport,
    voice: Voice,
) -> io::Result<()> {
    match &report.task {
        Some(name) => writeln!(output, "CHALLENGE  bounded task {name}")?,
        None => writeln!(output, "CHALLENGE  no bounded task is open")?,
    }
    match &report.challenge {
        Some(challenge) => {
            writeln!(
                output,
                "\n{}\n",
                contradiction(voice, challenge.class.word(), &challenge.statement)
            )?;
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
    writeln!(output, "task::{}   {}", task.name, state_label(task))?;
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
    writeln!(
        output,
        "\nCheck inputs (plus deliverables):\n  {}",
        if task.check_inputs.is_empty() {
            format!("write scope: {}", task.scope.join("  "))
        } else {
            task.check_inputs.join("  ")
        }
    )?;
    if task.findings.is_empty() {
        writeln!(output, "\nFindings:\n  none recorded")?;
    } else {
        writeln!(output, "\nFindings:")?;
        for finding in &task.findings {
            writeln!(output, "  {} {}", finding.id, finding.statement)?;
            if let Some(addressed) = &finding.addressed {
                writeln!(
                    output,
                    "    addressed by {}: {}",
                    addressed.model, addressed.statement
                )?;
            }
            match &finding.resolution {
                Some(resolution) => {
                    writeln!(output, "    resolved: {}", resolution.evidence)?;
                    if let Some(model) = &resolution.model {
                        writeln!(output, "    by {model}")?;
                    }
                }
                None if finding.addressed.is_some() => {
                    writeln!(output, "    awaiting the orchestrator's resolution")?
                }
                None => writeln!(output, "    UNRESOLVED")?,
            }
        }
    }
    if !task.notes.is_empty() {
        writeln!(output, "\nNotes:")?;
        for note in &task.notes {
            writeln!(output, "  {}", note.statement)?;
        }
    }
    if !task.removed_deliverables.is_empty() {
        writeln!(output, "\nRemoved deliverables:")?;
        for removed in &task.removed_deliverables {
            writeln!(output, "  {} — {}", removed.path, removed.reason)?;
        }
    }
    write_routes(&mut output, task)?;
    writeln!(output, "\n{}", task::AUTHORITY)
}

pub(super) const ROUTES: [&str; 9] = [
    "accept",
    "check",
    "blocker",
    "note",
    "finding",
    "addressed",
    "lens",
    "challenge",
    "hand-back",
];

fn route_states(route: &str) -> &'static [&'static str] {
    match route {
        "accept" => &["open", "blocked", "ready"],
        "check" | "blocker" | "note" | "addressed" | "hand-back" => {
            &["open", "accepted", "blocked"]
        }
        "finding" | "challenge" => &["open", "accepted", "blocked", "ready"],
        "lens" => &["accepted"],
        _ => &[],
    }
}

fn check_lines(name: &str, check: Option<&str>, check_argv: Option<&[String]>) -> Vec<String> {
    match (check_argv, check) {
        (Some(argv), _) => vec![
            format!("\nDeclared check:\n  {}", argv.join(" ")),
            format!(
                "  blabla task evidence {name} --run   BlaBla runs exactly that program and records the exit code it observed"
            ),
        ],
        (None, Some(check)) => vec![
            format!("\nDeclared check:\n  {check}"),
            include_str!("text/route-check-instruction.md").to_owned(),
            format!(
                "  blabla task evidence {name} --exit <code> --tool <tool>   record what the whole run reported; when {check} exits 0 that is --exit 0 --tool check"
            ),
        ],
        (None, None) => vec![include_str!("text/route-check-none-declared.md").to_owned()],
    }
}

fn render_route(
    route: &str,
    name: &str,
    check: Option<&str>,
    check_argv: Option<&[String]>,
    state: Option<&str>,
) -> Vec<String> {
    match route {
        "accept" => vec![format!(
            "\n  blabla task accept {name} --model <id>   {}",
            if matches!(state, Some("blocked" | "ready")) {
                "take the assignment again before changing anything; a BLOCKED or READY task resumes by being accepted"
            } else {
                "take the assignment before changing anything; unaccepted work is challenged as work done outside BlaBla"
            }
        )],
        "check" => check_lines(name, check, check_argv),
        "blocker" => vec![format!(
            "  blabla task block {name} \"...\"   record the blocker and stop"
        )],
        "note" => vec![format!(
            "  blabla task note {name} \"...\"   keep a note on the record; a note is not a finding and blocks nothing"
        )],
        "finding" => vec![format!(
            "  blabla task finding {name} \"...\"   record unsettled work; it blocks hand-back until it is addressed or resolved"
        )],
        "addressed" => vec![format!(
            "  blabla task addressed {name} <id> \"...\" --model <id>   say what you did about a finding; the orchestrator still resolves it"
        )],
        "lens" => vec![format!(
            "  blabla task lens {name} <pack> \"...\"   one assessment against one lens the role consults"
        )],
        "challenge" => vec![if state == Some("ready") {
            format!(
                "  READY: hand-back recorded; await orchestrator review; closing task {name} is orchestrator-owned"
            )
        } else {
            format!(
                "  blabla challenge {name}   ask BlaBla for one contradiction grounded in the record and tree; no challenge is recorded until the command runs"
            )
        }],
        "hand-back" => vec![format!(
            "  blabla task ready {name}   hand back for review; closing it is the orchestrator's, never yours"
        )],
        _ => Vec::new(),
    }
}

pub(super) fn route_text(
    route: &str,
    name: &str,
    check: Option<&str>,
    check_argv: Option<&[String]>,
    state: Option<&str>,
) -> Vec<String> {
    match state {
        Some(state) if !route_states(route).contains(&state) => Vec::new(),
        _ => render_route(route, name, check, check_argv, state),
    }
}

pub(super) fn routes_text(name: &str, check: Option<&str>) -> String {
    ROUTES
        .iter()
        .filter(|route| {
            route_states(route)
                .iter()
                .any(|state| matches!(*state, "open" | "accepted"))
        })
        .flat_map(|route| route_text(route, name, check, None, None))
        .map(|line| format!("{line}\n"))
        .collect()
}

fn route_lines(route: &str, task: &Task) -> Vec<String> {
    route_text(
        route,
        &task.name,
        task.check.as_deref(),
        task.check_argv.as_deref(),
        Some(&task.state),
    )
}

fn write_routes(output: &mut impl Write, task: &Task) -> io::Result<()> {
    writeln!(
        output,
        "\nScratch:\n  .blabla/{}/{}   working space; not a deliverable and outside the tree snapshot",
        task::SCRATCH_DIRECTORY,
        task.name
    )?;
    for route in ROUTES {
        for line in route_lines(route, task) {
            writeln!(output, "{line}")?;
        }
    }
    Ok(())
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
            state_label(task),
            task.role,
            task.unresolved().count()
        )?;
    }
    writeln!(output, "\n  blabla task show <name>   one task in full")?;
    writeln!(output, "\n{}", task::AUTHORITY)
}

fn state_label(task: &Task) -> String {
    task.state.to_ascii_uppercase()
}

pub(super) fn resolved(project: &Project, task: &Task) -> task::Resolution {
    let role = declared_role(project, &task.role);
    let contracts: Vec<(String, Vec<String>)> = project
        .structure
        .iter()
        .map(|contract| {
            (
                format!(
                    "contract::{}",
                    contract.group.clone().unwrap_or_else(|| "?".to_owned())
                ),
                contract
                    .modules
                    .iter()
                    .map(|module| module.display.clone())
                    .collect(),
            )
        })
        .collect();
    match role {
        Some(role) => task::resolve(
            task,
            &role.model,
            &role.consult,
            role.verification.as_deref().unwrap_or("unstated"),
            &contracts,
        ),
        None => task::resolve(task, &[], &[], "unstated", &contracts),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn probe_task(check: Option<&str>) -> Task {
        task::record(
            std::path::Path::new("."),
            &blabla::project::ignore::Ignore::default(),
            Opening {
                name: "probe".to_owned(),
                role: "worker".to_owned(),
                statement: "probe".to_owned(),
                scope: Vec::new(),
                deliverables: Vec::new(),
                check: check.map(str::to_owned),
                check_argv: None,
                inputs: Vec::new(),
            },
            0,
        )
    }

    #[test]
    fn every_declared_route_puts_a_line_in_the_assignment_view() {
        let mut task = probe_task(Some("cargo test --lib structure"));
        for route in ROUTES {
            let states = route_states(route);
            assert!(!states.is_empty(), "route {route} belongs to no state");
            for state in states {
                task.state = (*state).to_owned();
                assert!(
                    !route_lines(route, &task).is_empty(),
                    "route {route} writes nothing in state {state}"
                );
            }
            assert!(
                !route_text(route, "probe", Some("cargo test"), None, None).is_empty(),
                "route {route} writes nothing in the state-free loop text"
            );
        }
        task.state = "closed".to_owned();
        assert!(
            ROUTES
                .iter()
                .all(|route| route_lines(route, &task).is_empty())
        );
        assert!(route_lines("no-such-route", &task).is_empty());
        assert!(route_states("no-such-route").is_empty());
    }

    #[test]
    fn a_worker_view_never_names_the_product_gate() {
        let mut task = probe_task(Some("cargo test --lib structure"));
        for state in task::STATES {
            task.state = state.to_owned();
            let text: String = ROUTES
                .iter()
                .flat_map(|route| route_lines(route, &task))
                .collect();
            assert!(!text.contains("blabla finish"), "{state}: {text}");
        }
    }

    #[test]
    fn the_lens_route_is_offered_while_the_task_is_accepted_and_not_after_hand_back() {
        let mut task = probe_task(Some("cargo test --lib structure"));
        task.state = "accepted".to_owned();
        assert!(!route_lines("lens", &task).is_empty());
        task.state = "ready".to_owned();
        assert!(route_lines("lens", &task).is_empty());
    }

    #[test]
    fn the_evidence_guidance_names_the_route_an_argv_check_takes() {
        let mut task = probe_task(None);
        task.check_argv = Some(vec!["cargo".to_owned(), "test".to_owned()]);
        let guidance = handback_guidance(&task, "record-evidence");
        assert!(
            guidance.contains("blabla task evidence probe --run"),
            "{guidance}"
        );
        assert!(!guidance.contains("--exit"), "{guidance}");
    }

    #[test]
    fn an_undeclared_check_says_so_instead_of_naming_one() {
        let declared = route_lines("check", &probe_task(Some("cargo test")));
        let absent = route_lines("check", &probe_task(None));
        assert!(declared.iter().any(|line| line.contains("cargo test")));
        assert!(!absent.iter().any(|line| line.contains("cargo test")));
        assert_eq!(absent.len(), 1);
    }

    fn write(root: &std::path::Path, relative: &str, text: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, text).unwrap();
    }

    fn setup_project() -> (TempDir, blabla::project::Project) {
        let temp = TempDir::new().unwrap();
        let root = temp.path();

        write(
            root,
            "project.bla",
            "project Test\nuse behavior \"core.bla\"\n\nverify behavior {\n    command [\"true\"]\n    seed 1\n    cases 1\n    steps 1\n    timeout_ms 100\n    shrink_budget 1\n}\n",
        );
        write(
            root,
            "core.bla",
            "state x: int\n\naction inc()\n\nwhen inc {\n    expect \"change\": after.x > before.x\n}\n",
        );

        let project = blabla::project::load(
            blabla::project::read_manifest(&root.join("project.bla")).unwrap(),
        )
        .unwrap();
        (temp, project)
    }

    #[test]
    fn accept_legal_transition_recorded() {
        let (_temp, project) = setup_project();
        let opening = task::Opening {
            name: "test-accept".to_owned(),
            role: "worker".to_owned(),
            statement: "Test accept transition".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/main.rs".to_owned()],
            check: None,
            check_argv: None,
            inputs: Vec::new(),
        };
        let root = &project.manifest.root;
        let task = task::record(root, &project.ignore, opening, 0);
        task::write(root, &task).unwrap();

        let exit = accept(&project, "test-accept", "model-id", false);
        assert_eq!(exit, 0, "accept should succeed");

        let loaded = task::read(root, "test-accept").unwrap().unwrap();
        assert_eq!(loaded.state, "accepted", "state should be accepted");
        assert!(loaded.accepted.is_some(), "accepted should be recorded");
        assert_eq!(
            loaded.accepted.unwrap().model,
            "model-id",
            "model should match input"
        );
    }

    #[test]
    fn block_illegal_transition_refused() {
        let (_temp, project) = setup_project();
        let opening = task::Opening {
            name: "test-block".to_owned(),
            role: "worker".to_owned(),
            statement: "Test block transition".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/main.rs".to_owned()],
            check: None,
            check_argv: None,
            inputs: Vec::new(),
        };
        let root = &project.manifest.root;
        let task = task::record(root, &project.ignore, opening, 0);
        task::write(root, &task).unwrap();

        let exit = block(&project, "test-block", "some reason", false);
        assert_ne!(exit, 0, "block from open should fail");

        let loaded = task::read(root, "test-block").unwrap().unwrap();
        assert_eq!(loaded.state, "open", "state should remain open");
        assert!(loaded.findings.is_empty(), "findings should be empty");
    }

    #[test]
    fn ready_not_setting_result() {
        let (_temp, project) = setup_project();
        let opening = task::Opening {
            name: "test-ready".to_owned(),
            role: "worker".to_owned(),
            statement: "Test ready not setting result".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/main.rs".to_owned()],
            check: Some("check".to_owned()),
            check_argv: None,
            inputs: Vec::new(),
        };
        let root = &project.manifest.root;
        let mut task = task::record(root, &project.ignore, opening, 0);
        task.state = "accepted".to_owned();
        task.accepted = Some(task::Acceptance {
            model: "test-model".to_owned(),
            unix: 0,
            changed_at_acceptance: None,
        });
        task::write(root, &task).unwrap();

        write(root, "src/main.rs", "pub fn main() {}\n");
        assert_eq!(evidence(&project, "test-ready", 0, "test", false), 0);
        assert_eq!(challenge(&project, Some("test-ready"), false), 0);
        let exit = ready(&project, "test-ready", false);
        assert_eq!(exit, 0);

        let loaded = task::read(root, "test-ready").unwrap().unwrap();
        assert_eq!(loaded.state, "ready");
        assert!(loaded.result.is_none());
    }
}
