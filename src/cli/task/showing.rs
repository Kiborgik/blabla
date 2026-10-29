use super::*;

pub(super) fn run(project: &Project, action: TaskAction, json: bool, verbose: bool) -> i32 {
    match action {
        TaskAction::Show { name } => show(project, name.as_deref(), json, verbose),
        TaskAction::Freshness { name } => freshness::show(project, &name, json, verbose),
        _ => unreachable!("only the show and freshness commands are dispatched here"),
    }
}

pub(super) fn show(project: &Project, name: Option<&str>, json: bool, verbose: bool) -> i32 {
    let Some(name) = name else {
        let tasks = task::read_all(&project.manifest.root);
        let views: Vec<TaskView<'_>> = tasks
            .iter()
            .map(|task| view_among(project, task, &tasks))
            .collect();
        return render(json, &views, |_| write_tasks(&tasks));
    };
    let task = exit_on_err!(load(project, name, json));
    let mut shown = view(project, &task);
    if verbose {
        shown.evidence_progress = Some(progress::summary(&project.manifest.root, &task));
    }
    if json {
        shown.challenge_classes =
            Some(assignment_report_at(project, &task, &view_tree(project)).into());
        shown.affected_intents = Some(if task.asks_intent {
            task::claims::affected_intents(&task, &super::lifecycle::system_memory_systems(project))
        } else {
            Vec::new()
        });
    }
    render(json, &shown, |shown| {
        write_task(
            &task,
            &project.manifest.root,
            role_floor(project, &task.role),
            shown,
        )
        .and_then(|()| {
            if verbose {
                write_resolution(&resolved(project, &task))
            } else {
                Ok(())
            }
        })
    })
}

pub(in crate::cli) fn resolved(project: &Project, task: &Task) -> task::Resolution {
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
    let mut resolution = match role {
        Some(role) => {
            let permitted = declared_permitted_models(project, &task.role);
            task::resolve(
                task,
                &permitted,
                &role.consult,
                role.verification.as_deref().unwrap_or("unstated"),
                &contracts,
            )
        }
        None => task::resolve(task, &[], &[], "unstated", &contracts),
    };
    if !task.lenses.is_empty() {
        resolution.lenses.clone_from(&task.lenses);
    }
    resolution.knowledge_fingerprints = knowledge_fingerprints(project);
    resolution.review_current = review_freshness(project, task);
    resolution
}

pub(super) fn role_floor(project: &Project, role: &str) -> Option<u8> {
    declared_role(project, role).map(|role| role.floor())
}

pub(super) fn write_resolution(resolution: &task::Resolution) -> io::Result<()> {
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

pub(super) fn join_or(values: &[String], empty: &str) -> String {
    if values.is_empty() {
        empty.to_owned()
    } else {
        values.join("  ")
    }
}
