use super::{emit_error, error, recovery, write_json};
use blabla::project::Project;
use blabla::project::status::{StatusView, now_unix, status_view};
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

fn create(project: &Project, task: &mut Task, json: bool) -> i32 {
    if let Some(identity) = recovery::running() {
        task.build = Some(identity.stamp());
    }
    write_record(project, task, json)
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
    write_record(project, task, json)
}

fn write_record(project: &Project, task: &mut Task, json: bool) -> i32 {
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
    let mut recorded = task::record(
        root,
        Opening {
            scope: opening.scope.into_iter().map(normalize).collect(),
            deliverables: owed_paths(project, opening.deliverables),
            ..opening
        },
        now_unix(),
    );
    create(project, &mut recorded, json)
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
            blabla::project::snapshot(root)
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
        resolution: None,
    });
    store(project, &mut task, json)
}

pub(super) fn resolve(project: &Project, name: &str, id: usize, evidence: &str, json: bool) -> i32 {
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
    finding.resolution = Some(evidence.to_owned());
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
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let root = &project.manifest.root;
    for path in owed_paths(project, add) {
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

pub(super) fn declare_check(project: &Project, name: &str, command: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    task.check = Some(command.to_owned());
    store(project, &mut task, json)
}

pub(super) fn close(project: &Project, name: &str, model: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let evaluation = super::project::evaluate_with_run_state(project);
    let structure = project.verify_structure();
    let status = status_view(project, &evaluation, &structure);
    let report = report_for(project, &status, Some(&task));
    let standing = report.grounded.len();
    if !task::accept_result(&mut task, standing, model, now_unix()) {
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
    task.accepted = Some(task::Acceptance {
        model: model.to_owned(),
        unix: now_unix(),
    });
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
        resolution: None,
    });
    store(project, &mut task, json)
}

pub(super) fn ready(project: &Project, name: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if !task::apply(&mut task, "ready") {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} state {state:?} → \"ready\" is not allowed",
                    state = task.state
                ),
                None,
            ),
            json,
            2,
        );
    }
    store(project, &mut task, json)
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

pub(super) fn attribute(project: &Project, name: &str, path: &str, kind: &str, json: bool) -> i32 {
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
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let path = normalize(path.to_owned());
    let digest = blabla::project::digest_of(&project.manifest.root, &path);
    task.attributions.retain(|entry| entry.path != path);
    task.attributions.push(task::Attribution {
        path,
        kind: kind.to_owned(),
        digest,
    });
    store(project, &mut task, json)
}

pub(super) fn evidence(project: &Project, name: &str, exit: i32, tool: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let Some(check) = task.check.clone() else {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} declares no check, so a result cannot be bound to one. The orchestrator declares one with blabla task check {name} \"<command>\"; ask which check covers this work rather than choosing one"
                ),
                None,
            ),
            json,
            2,
        );
    };
    let root = &project.manifest.root;
    let inputs = task
        .deliverables
        .iter()
        .filter_map(|deliverable| {
            blabla::project::digest_of(root, &deliverable.path)
                .map(|digest| (deliverable.path.clone(), digest))
        })
        .collect();
    let tree = blabla::project::snapshot(root);
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
    });
    store(project, &mut task, json)
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
        write_challenge(&report, project.manifest.voice)
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
    let resolution = selected.map(|task| resolved(project, task));
    skeptic::challenge(&Evidence {
        task: selected,
        tree: &tree,
        completion: status.completion.state,
        completion_reason: &status.completion.reason,
        falsify: &|| falsify::falsify(&project.structure, root, &default_providers()),
        role: resolution.as_ref(),
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
    write_routes(&mut output, task)?;
    writeln!(output, "\n{}", task::AUTHORITY)
}

pub(super) const ROUTES: [&str; 6] = [
    "accept",
    "check",
    "blocker",
    "finding",
    "challenge",
    "hand-back",
];

pub(super) fn route_text(
    route: &str,
    name: &str,
    check: Option<&str>,
    accepted: bool,
) -> Vec<String> {
    match route {
        "accept" if accepted => Vec::new(),
        "accept" => vec![format!(
            "\n  blabla task accept {name} --model <id>   take the assignment before changing anything; unaccepted work is challenged as work done outside BlaBla"
        )],
        "check" => match check {
            Some(check) => vec![
                format!("\nDeclared check:\n  {check}"),
                format!(
                    "  blabla task evidence {name} --exit <code> --tool <tool>   record what the whole run reported"
                ),
            ],
            None => vec![
                "\nDeclared check:\n  none declared; ask the orchestrator which check covers this rather than choosing one".to_owned(),
            ],
        },
        "blocker" => vec![format!(
            "\n  blabla task block {name} \"...\"   stop and say what blocks it"
        )],
        "finding" => vec![format!(
            "  blabla task finding {name} \"...\"   record what you cannot settle inside the task"
        )],
        "challenge" => vec![format!(
            "  blabla challenge {name}   one contradiction grounded in the record and the tree, before handing back"
        )],
        "hand-back" => vec![format!(
            "  blabla task ready {name}   hand back for review; closing it is the orchestrator's, never yours"
        )],
        _ => Vec::new(),
    }
}

pub(super) fn routes_text(name: &str, check: Option<&str>) -> String {
    ROUTES
        .iter()
        .flat_map(|route| route_text(route, name, check, false))
        .map(|line| format!("{line}\n"))
        .collect()
}

fn route_lines(route: &str, task: &Task) -> Vec<String> {
    route_text(
        route,
        &task.name,
        task.check.as_deref(),
        task.accepted.is_some(),
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
            if task.open() { "OPEN" } else { "CLOSED" },
            task.role,
            task.unresolved().count()
        )?;
    }
    writeln!(output, "\n  blabla task show <name>   one task in full")?;
    writeln!(output, "\n{}", task::AUTHORITY)
}

pub(super) fn resolved(project: &Project, task: &Task) -> task::Resolution {
    let role = project
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
                    .find(|role| role.name == task.role)
                    .cloned()
            })
        });
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
            Opening {
                name: "probe".to_owned(),
                role: "worker".to_owned(),
                statement: "probe".to_owned(),
                scope: Vec::new(),
                deliverables: Vec::new(),
                check: check.map(str::to_owned),
            },
            0,
        )
    }

    #[test]
    fn every_declared_route_puts_a_line_in_the_assignment_view() {
        let task = probe_task(Some("cargo test --lib structure"));
        for route in ROUTES {
            assert!(
                !route_lines(route, &task).is_empty(),
                "route {route} writes nothing"
            );
        }
        assert!(route_lines("no-such-route", &task).is_empty());
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
        let (_, project) = setup_project();
        let opening = task::Opening {
            name: "test-accept".to_owned(),
            role: "worker".to_owned(),
            statement: "Test accept transition".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/main.rs".to_owned()],
            check: None,
        };
        let root = &project.manifest.root;
        let task = task::record(root, opening, 0);
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
        let (_, project) = setup_project();
        let opening = task::Opening {
            name: "test-block".to_owned(),
            role: "worker".to_owned(),
            statement: "Test block transition".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/main.rs".to_owned()],
            check: None,
        };
        let root = &project.manifest.root;
        let task = task::record(root, opening, 0);
        task::write(root, &task).unwrap();

        let exit = block(&project, "test-block", "some reason", false);
        assert_ne!(exit, 0, "block from open should fail");

        let loaded = task::read(root, "test-block").unwrap().unwrap();
        assert_eq!(loaded.state, "open", "state should remain open");
        assert!(loaded.findings.is_empty(), "findings should be empty");
    }

    #[test]
    fn ready_not_setting_result() {
        let (_, project) = setup_project();
        let opening = task::Opening {
            name: "test-ready".to_owned(),
            role: "worker".to_owned(),
            statement: "Test ready not setting result".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/main.rs".to_owned()],
            check: None,
        };
        let root = &project.manifest.root;
        let mut task = task::record(root, opening, 0);
        task.state = "accepted".to_owned();
        task.accepted = Some(task::Acceptance {
            model: "test-model".to_owned(),
            unix: 0,
        });
        task::write(root, &task).unwrap();

        let exit = ready(&project, "test-ready", false);
        assert_eq!(exit, 0);

        let loaded = task::read(root, "test-ready").unwrap().unwrap();
        assert_eq!(loaded.state, "ready");
        assert!(loaded.result.is_none());
    }
}
