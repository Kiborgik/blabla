use super::*;

pub(super) fn declared_role(
    project: &Project,
    role_name: &str,
) -> Option<blabla::memory::process::Role> {
    project
        .manifest
        .process
        .as_ref()
        .map(|entry| read_entry(entry, process::build, process::validate))
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

pub(super) fn validate_open_role(
    project: &Project,
    role_name: &str,
    json: bool,
) -> Result<(), i32> {
    let Some(entry) = &project.manifest.process else {
        return Ok(());
    };
    let memory = read_entry(entry, process::build, process::validate);
    let Some(process) = memory.present() else {
        return Err(emit_error(
            error(
                "task",
                format!(
                    "cannot resolve task role {role_name:?}: registered process {} is {}: {}; repair the registered process before opening a task",
                    entry.display,
                    memory.state(),
                    memory.problems().join("; ")
                ),
                None,
            ),
            json,
            2,
        ));
    };
    if !process.roles.is_empty() && !process.roles.iter().any(|role| role.name == role_name) {
        let mut names = process
            .roles
            .iter()
            .map(|role| role.name.as_str())
            .collect::<Vec<_>>();
        names.sort_unstable();
        return Err(emit_error(
            error(
                "task",
                format!(
                    "task role {role_name:?} is not declared in {}; declared roles: {}; choose a declared role or ask the owner to declare the intended role",
                    entry.display,
                    names.join(", ")
                ),
                None,
            ),
            json,
            2,
        ));
    }
    Ok(())
}

pub(super) fn unconsulted_lens(
    project: &Project,
    role_name: &str,
    lenses: &[String],
) -> Option<String> {
    let consulted = declared_role(project, role_name)
        .map(|role| role.consult)
        .unwrap_or_default();
    lenses
        .iter()
        .find(|lens| !consulted.contains(*lens))
        .map(|lens| {
            format!(
                "{lens:?} is not a pack role::{role_name} consults; it consults: {}",
                join_or(&consulted, "none")
            )
        })
}

pub(super) fn declared_permitted_models(project: &Project, role_name: &str) -> Vec<String> {
    project
        .manifest
        .process
        .as_ref()
        .map(|entry| read_entry(entry, process::build, process::validate))
        .and_then(|memory| {
            memory
                .present()
                .map(|process| task::models::permitted(process, role_name))
        })
        .unwrap_or_default()
}

pub(super) fn require_addressing_model(
    project: &Project,
    task: &Task,
    model: &str,
    json: bool,
) -> Result<(), i32> {
    let permitted = declared_permitted_models(project, &task.role);
    if task::can_address_finding(task, model, &permitted) {
        return Ok(());
    }
    Err(refuse(
        format!(
            "model {model:?} is not in role::{}'s permitted list: {}",
            task.role,
            permitted.join(", ")
        ),
        json,
    ))
}

pub(super) fn require_declared_role(
    project: &Project,
    role_name: &str,
    json: bool,
) -> Result<blabla::memory::process::Role, i32> {
    declared_role(project, role_name).ok_or_else(|| refuse(undeclared_role(role_name), json))
}

pub(super) fn validate_orchestrator_model(
    project: &Project,
    model: &str,
    json: bool,
) -> Result<(), i32> {
    let role = declared_role(project, task::ORCHESTRATOR_ROLE);
    match role {
        Some(_) => {
            let permitted = declared_permitted_models(project, task::ORCHESTRATOR_ROLE);
            if permitted.is_empty() || process::admits(&permitted, model) {
                Ok(())
            } else {
                Err(emit_error(
                    error(
                        "task",
                        format!(
                            "model {model:?} is not in role::orchestrator's permitted list: {}",
                            permitted.join(", ")
                        ),
                        None,
                    ),
                    json,
                    2,
                ))
            }
        }
        None => Err(emit_error(
            error("task", undeclared_role(task::ORCHESTRATOR_ROLE), None),
            json,
            2,
        )),
    }
}

pub(super) fn orchestrator_declared(project: &Project) -> bool {
    declared_role(project, task::ORCHESTRATOR_ROLE).is_some()
}

pub(super) fn validate_optional_orchestrator_model(
    project: &Project,
    model: &str,
    json: bool,
) -> Result<(), i32> {
    if orchestrator_declared(project) {
        validate_orchestrator_model(project, model, json)
    } else {
        Ok(())
    }
}

pub(super) fn undeclared_role(role: &str) -> String {
    include_str!("../text/role-undeclared.md").replace("{{role}}", role)
}
