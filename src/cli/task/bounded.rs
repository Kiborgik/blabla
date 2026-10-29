use super::*;
use blabla::project::{self, runstate, status};
use blabla::report::RunStatus;
use blabla::structure::LayerStatus;
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
struct RecordedStructure {
    status: String,
    verified: usize,
    violated: usize,
    errors: usize,
    rules: Vec<RecordedStructureRule>,
    #[serde(rename = "invocations")]
    _invocations: usize,
}

#[derive(Deserialize)]
struct RecordedStructureRule {
    id: String,
    status: String,
}

fn prior_structure_green(project: &Project, record: &status::Record) -> bool {
    let Some(value) = &record.structure else {
        return false;
    };
    let Ok(stored) = serde_json::from_value::<RecordedStructure>(value.clone()) else {
        return false;
    };
    let expected: BTreeSet<_> = project
        .structure_rules()
        .map(|rule| rule.id.as_str())
        .collect();
    let observed: BTreeSet<_> = stored.rules.iter().map(|rule| rule.id.as_str()).collect();
    stored.status == "green"
        && stored.violated == 0
        && stored.errors == 0
        && stored.verified == stored.rules.len()
        && stored.rules.len() == observed.len()
        && expected == observed
        && stored.rules.iter().all(|rule| rule.status == "green")
}

struct Decision {
    project: Project,
    task: Task,
    tree: BTreeMap<String, String>,
    revision: task::RelevantRevision,
    task_record: String,
    reviews: BTreeMap<String, task::RelevantRevision>,
    verification: Vec<u8>,
    marker: Option<Vec<u8>>,
    structure: String,
    record: status::Record,
}

fn refuse(message: impl Into<String>, json: bool) -> i32 {
    emit_error(error("task", message.into(), None), json, 2)
}

fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("cannot inspect {}: {error}", path.display())),
    }
}

fn unread_record(failure: &io::Error, root: &Path) -> String {
    let message = format!("cannot read prior canonical verification: {failure}");
    if failure.kind() != io::ErrorKind::NotFound {
        return message;
    }
    format!(
        "{message}. No prior canonical verification record was found for this project ({}). Bounded close requires prior overall canonical GREEN; READY and review receipts are not that record. Owner: inspect `blabla status` first, with the shown root passed as the single `--project` value. Keep the hand-back pending; perform this project's canonical finish only when authorized and no verification is already running. After canonical GREEN, use ordinary close and satisfy its remaining checks.",
        root.display()
    )
}

fn undecodable_record(failure: &serde_json::Error) -> String {
    format!("cannot decode prior canonical verification: {failure}")
}

fn inspect(
    manifest: &Path,
    name: &str,
    model: &str,
    reason: &str,
    json: bool,
) -> Result<Decision, i32> {
    if reason.trim().is_empty() || model.trim().is_empty() {
        return Err(refuse(
            "bounded result acceptance requires a nonempty owner reason and model",
            json,
        ));
    }
    let project = project::read_manifest(manifest)
        .and_then(project::load)
        .map_err(|failure| {
            refuse(
                format!("cannot reload bounded acceptance inputs: {failure:?}"),
                json,
            )
        })?;
    validate_orchestrator_model(&project, model, json)?;
    let task = mutate(&project, name, json)?;
    require_tracking(&project, &task, json)?;
    if task.result_basis.is_some() {
        return Err(refuse("a bounded result basis is already recorded", json));
    }
    let root = &project.manifest.root;
    let unreadable = task::unreadable(root);
    if !unreadable.is_empty() {
        return Err(refuse(unreadable.join("; "), json));
    }
    let tree = project::snapshot(root, &project.ignore);
    if task.state != TaskState::Ready
        || !task::challenge_current(&task, &tree)
        || !task::tracked_readiness(&task, root, &project.ignore, &tree).supported
    {
        return Err(refuse(
            "bounded acceptance requires a READY task with current evidence and challenge",
            json,
        ));
    }
    if review_freshness(&project, &task) == Some(false) {
        return Err(refuse(
            "the recursive review target is no longer current",
            json,
        ));
    }
    let verification = std::fs::read(status::record_path(root))
        .map_err(|failure| refuse(unread_record(&failure, root), json))?;
    let record: status::Record = serde_json::from_slice(&verification)
        .map_err(|failure| refuse(undecodable_record(&failure), json))?;
    let marker =
        read_optional(&runstate::marker_path(root)).map_err(|message| refuse(message, json))?;
    let marker_value = marker
        .as_deref()
        .map(serde_json::from_slice::<runstate::Marker>)
        .transpose()
        .map_err(|failure| {
            refuse(
                format!("cannot decode verification run state: {failure}"),
                json,
            )
        })?;
    let mut evaluation = status::evaluate(&project, Ok(Some(record.clone())));
    status::apply_run_state(&mut evaluation, &project, Ok(marker_value));
    let structure = project.verify_structure();
    let view = status_view(&project, &evaluation, &structure);
    let eligible = evaluation.recorded.as_ref().is_some_and(|recorded| {
        recorded.status == RunStatus::Green
            && recorded.canonical
            && recorded.stale == ["implementation"]
    }) && evaluation.run_state.is_none()
        && evaluation.record_error.is_none()
        && record
            .run_id
            .as_ref()
            .is_some_and(|id| !id.trim().is_empty())
        && prior_structure_green(&project, &record)
        && structure.status == LayerStatus::Green
        && view.completion.state == status::CompletionState::Stale;
    if !eligible {
        return Err(refuse(
            "bounded acceptance requires prior overall canonical GREEN, only implementation drift, current GREEN structure and no pending verification",
            json,
        ));
    }
    let report = report_at(
        &project,
        &view,
        Some(&task),
        Err(skeptic::GOALS_NOT_JUDGED),
        &tree,
    );
    let blockers = skeptic::standing(
        &report.grounded,
        &[
            skeptic::Class::VerificationNotCurrent,
            skeptic::Class::WithdrawalResidue,
        ],
    );
    if !blockers.is_empty() {
        return Err(refuse(
            format!("bounded result is not accepted: grounded challenges remain: {blockers:?}"),
            json,
        ));
    }
    let revision = task::relevant_revision(&task, &tree, review_identities(&project, &task));
    let task_record = fingerprint(&task);
    let reviews =
        review_context(&project, &task, &tree).map_err(|message| refuse(message, json))?;
    Ok(Decision {
        project,
        task,
        tree,
        revision,
        task_record,
        reviews,
        verification,
        marker,
        structure: fingerprint(&structure),
        record,
    })
}

fn record_result(initial: Decision, model: &str, reason: &str, json: bool) -> i32 {
    let mut current = match inspect(
        &initial.project.manifest.path,
        &initial.task.name,
        model,
        reason,
        json,
    ) {
        Ok(current) => current,
        Err(exit) => return exit,
    };
    if current.task_record != initial.task_record
        || current.revision != initial.revision
        || current.reviews != initial.reviews
        || current.verification != initial.verification
        || current.marker != initial.marker
        || current.structure != initial.structure
    {
        return refuse(
            "task, review or verification eligibility changed during the bounded acceptance decision; inspect and retry",
            json,
        );
    }
    if !task::accept_result(
        &mut current.task,
        &current.tree,
        &current.project.ignore,
        0,
        model,
        now_unix(),
    ) {
        return refuse(
            "the current bounded result is no longer ready for acceptance",
            json,
        );
    }
    current.task.result_basis = Some(task::ResultBasis::Bounded {
        reason: reason.to_owned(),
        project_state: "stale".into(),
        prior_run_id: current
            .record
            .run_id
            .expect("eligible record has a run identity"),
        implementation_fingerprint: current.record.implementation_fingerprint,
        revision: current.revision,
    });
    store_and_discard(&current.project, &mut current.task, json)
}

pub(super) fn close(project: &Project, name: &str, model: &str, reason: &str, json: bool) -> i32 {
    let initial = match inspect(&project.manifest.path, name, model, reason, json) {
        Ok(initial) => initial,
        Err(exit) => return exit,
    };
    record_result(initial, model, reason, json)
}

#[cfg(test)]
pub(super) fn close_with_checkpoint(
    project: &Project,
    name: &str,
    model: &str,
    reason: &str,
    checkpoint: impl FnOnce(),
) -> i32 {
    let initial = match inspect(&project.manifest.path, name, model, reason, false) {
        Ok(initial) => initial,
        Err(exit) => return exit,
    };
    checkpoint();
    record_result(initial, model, reason, false)
}

#[cfg(test)]
mod tests;
