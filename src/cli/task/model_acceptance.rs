use super::{Project, Task, memory, process, task};
use serde::Serialize;

#[derive(Serialize)]
pub(super) struct Guidance {
    status: &'static str,
    accepted_model: String,
    role: String,
    permitted_models: Option<Vec<String>>,
    pub(super) message: String,
    authority: &'static str,
}

pub(super) fn guidance(project: &Project, task: &Task) -> Option<Guidance> {
    let accepted = task.accepted.as_ref()?;
    let entry = project.manifest.process.as_ref()?;
    let memory = memory::read(
        &entry.path,
        &entry.display,
        process::build,
        process::validate,
    );
    let unavailable = |reason: String| Guidance {
        status: "unavailable",
        accepted_model: accepted.model.clone(),
        role: task.role.clone(),
        permitted_models: None,
        message: format!(
            "acceptance is recorded but model permission remains unsettled. Recorded model: {:?}; role::{} permitted IDs are unavailable: {reason}. Repair the registered process policy and inspect blabla task show {} before work; no permission is granted by this diagnostic.",
            accepted.model, task.role, task.name
        ),
        authority: "diagnostic-only",
    };
    let Some(process) = memory.present() else {
        return Some(unavailable(format!(
            "{} is {} ({})",
            entry.display,
            memory.state(),
            memory.problems().join("; ")
        )));
    };
    if !process.roles.is_empty() && !process.roles.iter().any(|role| role.name == task.role) {
        return Some(unavailable(format!(
            "role {:?} is not declared in {}",
            task.role, entry.display
        )));
    }
    let permitted = task::models::permitted(process, &task.role);
    if permitted.is_empty()
        || process::admits(&permitted, &accepted.model)
        || task.exceptions.iter().any(|exception| {
            !exception.superseded
                && exception.model == accepted.model
                && exception.approval.is_some()
        })
    {
        return None;
    }
    Some(Guidance {
        status: "outside_role_policy",
        accepted_model: accepted.model.clone(),
        role: task.role.clone(),
        message: format!(
            "acceptance is recorded but model permission remains unsettled. Recorded model: {:?}; role::{} permits these exact IDs (including declared aliases): {:?}. No approved nonsuperseded exception covers this model. Before work, use blabla task propose-model {} <recorded-model> --reason <reason>, then obtain the owner's ruling through blabla task approve-model {} <recorded-model> --approval <owner-ruling>. Attest the actual model, not a different permitted ID; effort is separate from model identity. Approval preserves the acceptance epoch and existing evidence; normal carry confirmation still applies. Do not reaccept merely to repair spelling.",
            accepted.model, task.role, permitted, task.name, task.name
        ),
        permitted_models: Some(permitted),
        authority: "diagnostic-only",
    })
}
