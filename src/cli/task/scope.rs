use super::*;

pub(super) fn run(project: &Project, action: TaskAction, json: bool, swallowed: &[String]) -> i32 {
    match action {
        TaskAction::Scope {
            name,
            add,
            remove,
            model,
        } => {
            if remove.is_empty() {
                widen(project, &name, add, model.as_deref(), json)
            } else {
                release(project, &name, &remove, model.as_deref(), json)
            }
        }
        TaskAction::Statement { name, text, model } => {
            restate(project, &name, &text, model.as_deref(), json)
        }
        TaskAction::Withdraw {
            name,
            reason,
            model,
        } => withdraw(project, &name, &reason, &model, json),
        TaskAction::ReconcileWithdrawal {
            name,
            path,
            successor,
            model,
        } => reconcile_withdrawal(project, &name, &path, &successor, &model, json),
        TaskAction::Check {
            name,
            check,
            input,
            reset_inputs,
            add_scope,
            model,
        } => declare_check(
            project,
            &name,
            CheckAmendment {
                check,
                inputs: input,
                reset_inputs,
                add_scope,
                model,
            },
            json,
            swallowed,
        ),
        TaskAction::Deliverable {
            name,
            add,
            remove,
            reason,
            model,
        } => match remove {
            Some(path) => unowe(
                project,
                &name,
                &path,
                reason.as_deref(),
                model.as_deref(),
                json,
            ),
            None => owe(project, &name, add, json),
        },
        _ => unreachable!("only scope commands are dispatched here"),
    }
}

fn widen_scope(project: &Project, task: &mut Task, add: &[String]) -> Result<(), String> {
    let add = task::validate_scope(
        &project.manifest.root,
        &task.name,
        add,
        &task::read_all(&project.manifest.root),
    )?;
    for path in add {
        if !task.scope.contains(&path) {
            task.scope.push(path);
        }
    }
    Ok(())
}

pub(super) fn widen(
    project: &Project,
    name: &str,
    add: Vec<String>,
    model: Option<&str>,
    json: bool,
) -> i32 {
    if let Some(model) = model {
        exit_on_err!(validate_optional_orchestrator_model(project, model, json));
    }
    let mut task = exit_on_err!(mutate(project, name, json));
    refuse_on_err!(widen_scope(project, &mut task, &add), json);
    task::attest(&mut task, "scope", model, now_unix());
    store(project, &mut task, json)
}

pub(super) fn release(
    project: &Project,
    name: &str,
    remove: &[String],
    model: Option<&str>,
    json: bool,
) -> i32 {
    if let Some(model) = model {
        exit_on_err!(validate_optional_orchestrator_model(project, model, json));
    }
    let mut task = exit_on_err!(mutate(project, name, json));
    let root = &project.manifest.root;
    let tree = blabla::project::snapshot(root, &project.ignore);
    let changed: Vec<String> = task::changed(&task, &tree, &project.ignore)
        .into_iter()
        .map(str::to_owned)
        .collect();
    let mut released = Vec::new();
    for path in remove {
        let path = refuse_on_err!(task::normalize_scope(root, path), json);
        let Some(entry) = task
            .scope
            .iter()
            .find(|entry| task::covers(&path, entry) && task::covers(entry, &path))
        else {
            return refuse(
                format!(
                    "{path} is not in the write scope of task {name:?}; blabla task show {name} lists it"
                ),
                json,
            );
        };
        if task
            .deliverables
            .iter()
            .any(|deliverable| task::covers(&path, &deliverable.path))
        {
            return refuse(
                format!(
                    "{path} is or covers a declared deliverable of task {name:?}, so it stays in the write scope"
                ),
                json,
            );
        }
        if changed.iter().any(|moved| task::covers(&path, moved)) {
            return refuse(
                format!(
                    "{path} changed since task {name:?} opened, so the task owns that change and the path stays in its write scope"
                ),
                json,
            );
        }
        released.push(entry.clone());
    }
    task.scope.retain(|entry| !released.contains(entry));
    task::attest(&mut task, "scope --remove", model, now_unix());
    store(project, &mut task, json)
}

pub(super) fn restate(
    project: &Project,
    name: &str,
    text: &str,
    model: Option<&str>,
    json: bool,
) -> i32 {
    if let Some(model) = model {
        exit_on_err!(validate_optional_orchestrator_model(project, model, json));
    }
    let mut task = exit_on_err!(mutate(project, name, json));
    text.clone_into(&mut task.statement);
    task::attest(&mut task, "statement", model, now_unix());
    store(project, &mut task, json)
}

pub(super) fn withdraw(
    project: &Project,
    name: &str,
    reason: &str,
    model: &str,
    json: bool,
) -> i32 {
    exit_on_err!(validate_orchestrator_model(project, model, json));
    let mut task = exit_on_err!(mutate(project, name, json));
    let tree = view_tree(project);
    refuse_on_err!(
        task::withdraw(&mut task, &tree, &project.ignore, reason, model, now_unix()),
        json
    );
    task::attest(&mut task, "withdraw", Some(model), now_unix());
    store_and_discard(project, &mut task, json)
}

pub(super) fn reconcile_withdrawal(
    project: &Project,
    name: &str,
    paths: &[String],
    successor: &str,
    model: &str,
    json: bool,
) -> i32 {
    exit_on_err!(validate_orchestrator_model(project, model, json));
    let root = &project.manifest.root;
    let mut task = exit_on_err!(load(project, name, json));
    let successor = exit_on_err!(load(project, successor, json));
    let tree = blabla::project::snapshot(root, &project.ignore);
    let mut reconciliations = Vec::new();
    for requested in paths {
        let path = refuse_on_err!(task::normalize_scope(root, requested), json);
        let captured = task.withdrawal.as_ref().and_then(|record| {
            record
                .unresolved_paths
                .keys()
                .find(|captured| task::covers(&path, captured) && task::covers(captured, &path))
                .cloned()
        });
        let path = match (task.state, captured) {
            (TaskState::Withdrawn, Some(path)) => path,
            _ => {
                return refuse(
                    format!(
                        "reconciliation of {requested} requires a captured path on a WITHDRAWN task; nothing is recorded"
                    ),
                    json,
                );
            }
        };
        let Some(successor_closed_unix) = successor.closed_unix.filter(|_| {
            task::tracking_error(&successor, root, &project.ignore).is_none()
                && task::successful_successor(&successor, &tree, &path)
        }) else {
            return refuse(
                format!(
                    "reconciliation of {requested} requires the successor CLOSED, with current successful evidence and the path covered by its inputs (its check inputs, or its write scope when it declares none) or its deliverables; nothing is recorded"
                ),
                json,
            );
        };
        reconciliations.push(task::WithdrawalReconciliation {
            revision: task::successor_revision(&successor, &tree, &path),
            path,
            successor: successor.name.clone(),
            model: model.to_owned(),
            unix: now_unix(),
            successor_closed_unix,
        });
    }
    task.withdrawal
        .as_mut()
        .expect("withdrawal checked")
        .reconciliations
        .extend(reconciliations);
    task::attest(&mut task, "reconcile-withdrawal", Some(model), now_unix());
    store(project, &mut task, json)
}

pub(super) fn owe(project: &Project, name: &str, add: Vec<String>, json: bool) -> i32 {
    let add = refuse_on_err!(tracked_declarations(project, "deliverable", add), json);
    let mut task = exit_on_err!(mutate(project, name, json));
    let paths = refuse_on_err!(owed_paths(project, add), json);
    for path in paths {
        task::owe_path(&mut task, path);
    }
    task::attest(&mut task, "deliverable --add", None, now_unix());
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
        return refuse(
            "task deliverable --remove needs --reason \"...\" and --model <id>: withdrawing a deliverable is the orchestrator's decision and the record keeps why",
            json,
        );
    };
    exit_on_err!(validate_orchestrator_model(project, model, json));
    let mut task = exit_on_err!(mutate(project, name, json));
    let path = normalize(path.to_owned());
    let withdrawn: Vec<String> = task
        .deliverables
        .iter()
        .filter(|deliverable| task::covers(&path, &deliverable.path))
        .map(|deliverable| deliverable.path.clone())
        .collect();
    if withdrawn.is_empty() {
        return refuse(
            format!(
                "task {name:?} owes no deliverable at {path}, so there is nothing to withdraw; blabla task show {name} lists what it owes"
            ),
            json,
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
    task::attest(&mut task, "deliverable --remove", Some(model), unix);
    store(project, &mut task, json)
}

pub(super) struct CheckAmendment {
    pub(super) check: Vec<String>,
    pub(super) inputs: Vec<String>,
    pub(super) reset_inputs: bool,
    pub(super) add_scope: Vec<String>,
    pub(super) model: Option<String>,
}

fn amended_check_inputs(task: &Task, inputs: Vec<String>, reset_inputs: bool) -> Vec<String> {
    if inputs.is_empty() && !reset_inputs {
        task.check_inputs.clone()
    } else {
        inputs
    }
}

pub(super) fn declare_check(
    project: &Project,
    name: &str,
    amendment: CheckAmendment,
    json: bool,
    swallowed: &[String],
) -> i32 {
    let CheckAmendment {
        check,
        inputs,
        reset_inputs,
        add_scope,
        model,
    } = amendment;
    if let Some(model) = model.as_deref() {
        exit_on_err!(validate_optional_orchestrator_model(project, model, json));
    }
    if check.is_empty() && inputs.is_empty() && add_scope.is_empty() && !reset_inputs {
        return refuse(
            format!(
                "task check {name} needs --check PROG ARGS, --input, --add-scope or --reset-inputs; use blabla task show {name} to inspect its current check"
            ),
            json,
        );
    }
    let mut task = exit_on_err!(mutate(project, name, json));
    if !add_scope.is_empty() {
        refuse_on_err!(widen_scope(project, &mut task, &add_scope), json);
    }
    task.check_inputs = refuse_on_err!(
        tracked_declarations(
            project,
            "input",
            amended_check_inputs(&task, inputs, reset_inputs),
        ),
        json
    );
    if let Some(message) = task::tracking_error(&task, &project.manifest.root, &project.ignore) {
        return refuse(message, json);
    }
    if !check.is_empty() {
        task.check = Some(check);
    }
    task.challenged = None;
    let verb = if add_scope.is_empty() {
        "check"
    } else {
        "check --add-scope"
    };
    task::attest(&mut task, verb, model.as_deref(), now_unix());
    store_with(project, &mut task, json, swallowed)
}
