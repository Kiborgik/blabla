use super::*;

pub(super) fn run(project: &Project, action: TaskAction, json: bool) -> i32 {
    match action {
        TaskAction::Lens {
            name,
            lens: pack,
            statement,
            model,
        } => lens(project, &name, &pack, &statement, model.as_deref(), json),
        TaskAction::ProposeModel {
            name,
            model,
            reason,
        } => propose_model(project, &name, &model, &reason, json),
        TaskAction::ApproveModel {
            name,
            model,
            approval,
        } => approve_model(project, &name, &model, &approval, json),
        TaskAction::Attribute {
            name,
            paths,
            kind,
            model,
        } => attribute(project, &name, &paths, &kind, &model, json),
        _ => unreachable!("only model and lens commands are dispatched here"),
    }
}

fn prepare_lens(
    project: &Project,
    task: &Task,
    lens: &str,
    statement: &str,
    model: Option<&str>,
    knowledge: &BTreeMap<String, String>,
) -> Result<task::Assessment, String> {
    if let Some(model) = model
        && task
            .accepted
            .as_ref()
            .map(|accepted| accepted.model.as_str())
            != Some(model)
    {
        return Err(format!(
            "model {model:?} did not accept this task; the lens is recorded by the accepted model"
        ));
    }
    let fingerprint = knowledge.get(lens).cloned();
    let consulted = declared_role(project, &task.role)
        .is_some_and(|role| role.consult.iter().any(|pack| pack == lens));
    if task.state != TaskState::Accepted
        || task.accepted.is_none()
        || !consulted
        || fingerprint.is_none()
    {
        return Err(
            "a lens must name a resolved pack consulted by the accepted task's role".into(),
        );
    }
    Ok(task::Assessment {
        model: task
            .accepted
            .as_ref()
            .map(|accepted| accepted.model.clone()),
        acceptance_epoch: Some(task.acceptance_epoch),
        knowledge_fingerprint: fingerprint,
        ruling: lens.to_owned(),
        statement: statement.to_owned(),
        unix: now_unix(),
    })
}

pub(super) fn assess(
    project: &Project,
    task: &mut Task,
    lens: &str,
    statement: &str,
    model: Option<&str>,
    knowledge: &BTreeMap<String, String>,
) -> Result<(), String> {
    let assessment = prepare_lens(project, task, lens, statement, model, knowledge)?;
    task.assessments.push(assessment);
    Ok(())
}

pub(super) fn lens(
    project: &Project,
    name: &str,
    lens: &str,
    statement: &str,
    model: Option<&str>,
    json: bool,
) -> i32 {
    let mut task = exit_on_err!(mutate(project, name, json));
    refuse_on_err!(
        assess(
            project,
            &mut task,
            lens,
            statement,
            model,
            &knowledge_fingerprints(project),
        ),
        json
    );
    store(project, &mut task, json)
}

pub(super) fn propose_model(
    project: &Project,
    name: &str,
    model: &str,
    reason: &str,
    json: bool,
) -> i32 {
    let mut task = exit_on_err!(mutate(project, name, json));
    task.exceptions.push(task::Exception {
        acceptance_epoch: task.accepted.as_ref().map(|_| task.acceptance_epoch),
        superseded: false,
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
    let mut task = exit_on_err!(mutate(project, name, json));
    let Some(exception) = task.exceptions.iter_mut().find(|exception| {
        !exception.superseded && exception.model == model && exception.approval.is_none()
    }) else {
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
    task::attest(&mut task, "approve-model", None, now_unix());
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
    if task::AttributionKind::from_word(kind).is_none() {
        return refuse(
            format!(
                "{kind:?} does not name an origin; BlaBla records {}",
                task::AttributionKind::ALL
                    .map(task::AttributionKind::word)
                    .join(", ")
            ),
            json,
        );
    }
    exit_on_err!(validate_orchestrator_model(project, model, json));
    let mut task = exit_on_err!(mutate(project, name, json));
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    let changed: Vec<String> = task::changed(&task, &tree, &project.ignore)
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
            return refuse(
                format!(
                    "{path} has not changed since the task opened, so there is nothing to attribute; blabla challenge {name} names the paths that have"
                ),
                json,
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
    task::attest(&mut task, "attribute", Some(model), now_unix());
    store(project, &mut task, json)
}
