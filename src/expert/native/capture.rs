use super::run::{LockedRun, Run, Stage};
use super::*;
use crate::expert::calibration;
use crate::expert::packet;
use crate::expert::pilot::evidence;
use crate::expert::pilot::{self, Error, Refusal, require};
use crate::expert::trace::{self, TraceStore};
use crate::expert::{Observation, ObservedEvent};
use crate::project::{self, Project};
use std::collections::BTreeSet;

pub(crate) fn marker(capture: &BoundaryCapture) -> Result<WorkerBoundary, Error> {
    let key = &capture.key;
    Ok(WorkerBoundary {
        kind: "blabla_native_boundary".into(),
        schema_version: 1,
        run_id: key.run_id.clone(),
        task: key.task.clone(),
        acceptance_epoch: key.acceptance_epoch,
        child_attestation: key.child.clone(),
        generation: key.generation,
        sequence: key.sequence,
        boundary_nonce: key.boundary_nonce.clone(),
        capture_id: capture.capture_id.clone(),
        capture_sha256: calibration::canonical_sha256(capture)?,
    })
}
pub(crate) fn capture(
    store: &TraceStore,
    project: &Project,
    locked: LockedRun<'_>,
    work_key: &BoundaryKey,
    child: &Child,
    statements: &[WorkerStatement],
    final_boundary: bool,
) -> Result<NativeResult, Error> {
    let LockedRun { run, ledger, now } = locked;
    let enrolled = run
        .enrollments
        .get(&work_key.task)
        .ok_or(Refusal::IdentityMismatch)?;
    require(
        &enrolled.key == work_key && &enrolled.enrollment.child == child,
        Refusal::IdentityMismatch,
    )?;
    require(enrolled.stage == Stage::AwaitWork, Refusal::StaleCheckpoint)?;
    let current = evidence::task_current(project, &work_key.task, work_key.acceptance_epoch)?;
    let assignment = evidence::assignment(project, &current);
    let work_id = enrolled
        .work_operation_id
        .as_ref()
        .ok_or(Refusal::StaleCheckpoint)?;
    let operation = run
        .operations
        .iter()
        .find(|op| &op.request.operation_id == work_id)
        .ok_or(Refusal::StaleCheckpoint)?;
    require(
        operation.claimed
            && operation.request.key == *work_key
            && matches!(operation.request.payload, HostAction::ContinueWork { .. }),
        Refusal::StaleCheckpoint,
    )?;
    let mut ids = BTreeSet::new();
    require(
        statements.len() <= 32
            && statements.iter().all(|s| {
                pilot::identifier(&s.statement_id)
                    && ids.insert(&s.statement_id)
                    && s.text.len() <= 2048
                    && packet::redact(&s.text) == s.text
            }),
        Refusal::InvalidInput,
    )?;
    if let Some(reference) = &enrolled.capture {
        let saved: BoundaryCapture = evidence::read(&store.root, reference)?;
        require(
            saved.statements == statements
                && saved.final_boundary == final_boundary
                && saved.key.assignment_revision == assignment,
            Refusal::StaleRevision,
        )?;
        rebuild(project, run, &saved)?;
        return Ok(NativeResult::BoundaryCaptured {
            marker: marker(&saved)?,
        });
    }
    let sequence = work_key
        .sequence
        .checked_add(1)
        .ok_or(Refusal::SequenceGap)?;
    let mut key = work_key.clone();
    key.sequence = sequence;
    key.previous_sequence = (sequence > 1).then_some(sequence - 1);
    key.assignment_revision = assignment;
    key.checkpoint_id = format!(
        "checkpoint-{}",
        packet::digest(&(
            &key.run_id,
            &key.task,
            key.acceptance_epoch,
            key.generation,
            key.sequence,
            &key.boundary_nonce
        ))
    );
    let capture_id = format!("capture-{}", pilot::nonce()?);
    let event = ObservedEvent {
        event_id: capture_id.clone(),
        run_id: key.run_id.clone(),
        task: key.task.clone(),
        checkpoint_id: key.checkpoint_id.clone(),
        sequence,
        previous_sequence: key.previous_sequence,
        unix_ms: now.unix_ms,
        kind: crate::expert::CheckpointKind::TurnEnd,
        host: enrolled.enrollment.capability.host.clone(),
        observations: vec![],
    };
    let config = &run.frozen.as_ref().ok_or(Refusal::RuntimeChanged)?.config;
    let (_, bindings) = trace::selected_bindings(project, &current, &event, config)?;
    let history = trace::ledger_history(ledger, &key.task, key.acceptance_epoch, &run.execution()?);
    let mut projections = Vec::new();
    for binding in bindings.iter().take(config.limits.judgments_per_checkpoint) {
        let first = project::expert::build_packet(
            project,
            &current,
            &event,
            binding,
            &config.limits,
            &history,
        )
        .map_err(|_| Refusal::MissingContext)?;
        let observations = statements
            .iter()
            .map(|statement| Observation {
                id: format!(
                    "native-statement-{}",
                    packet::digest(&(&capture_id, &statement.statement_id))
                ),
                slot: statement.slot.into(),
                kind: crate::expert::SourceKind::WorkerStatement,
                capture: "host:native-worker-statement".into(),
                observed_revision: first.revision.fingerprint(),
                text: statement.text.clone(),
                fact: None,
            })
            .collect::<Vec<_>>();
        let mut projected = event.clone();
        projected.observations = observations.clone();
        let second = project::expert::build_packet(
            project,
            &current,
            &projected,
            binding,
            &config.limits,
            &first.history,
        )
        .map_err(|_| Refusal::MissingContext)?;
        require(first.revision == second.revision, Refusal::StaleRevision)?;
        projections.push(BindingProjection {
            binding_id: binding.id(),
            revision: second.revision,
            observations,
            history: second.history,
            packet_hash: second.hash,
        });
    }
    let capture = BoundaryCapture {
        kind: "native_boundary_capture".into(),
        schema_version: 1,
        capture_id: capture_id.clone(),
        key,
        work_operation_id: work_id.clone(),
        statements: statements.to_vec(),
        final_boundary,
        event,
        projections,
    };
    rebuild(project, run, &capture)?;
    let reference = store.save_experimental_payload(
        &work_key.run_id,
        "captures",
        &capture_id,
        &capture,
        MAX_NATIVE_BYTES,
    )?;
    run.enrollments.get_mut(&work_key.task).unwrap().capture = Some(reference);
    Ok(NativeResult::BoundaryCaptured {
        marker: marker(&capture)?,
    })
}
pub(crate) fn rebuild(
    project: &Project,
    run: &Run,
    capture: &BoundaryCapture,
) -> Result<Checkpoint, Error> {
    let key = &capture.key;
    let current = evidence::task_current(project, &key.task, key.acceptance_epoch)?;
    require(
        evidence::assignment(project, &current) == key.assignment_revision,
        Refusal::StaleRevision,
    )?;
    let config = &run.frozen.as_ref().ok_or(Refusal::RuntimeChanged)?.config;
    let (judgments, bindings) =
        trace::selected_bindings(project, &current, &capture.event, config)?;
    require(
        capture.projections.len() <= 4 && capture.event.observations.is_empty(),
        Refusal::StorageCorrupt,
    )?;
    let selected_ids = bindings
        .iter()
        .take(config.limits.judgments_per_checkpoint)
        .map(|b| b.id())
        .collect::<Vec<_>>();
    require(
        selected_ids
            == capture
                .projections
                .iter()
                .map(|p| p.binding_id.clone())
                .collect::<Vec<_>>(),
        Refusal::RuntimeChanged,
    )?;
    let mut selected = Vec::new();
    for projection in &capture.projections {
        let binding = bindings
            .iter()
            .find(|b| b.id() == projection.binding_id)
            .ok_or(Refusal::RuntimeChanged)?;
        let judgment = judgments
            .iter()
            .find(|j| j.id() == binding.judgment)
            .ok_or(Refusal::RuntimeChanged)?;
        let mut event = capture.event.clone();
        event.observations = projection.observations.clone();
        let packet = project::expert::build_packet(
            project,
            &current,
            &event,
            binding,
            &config.limits,
            &projection.history,
        )
        .map_err(|_| Refusal::StaleRevision)?;
        require(
            packet.revision == projection.revision && packet.hash == projection.packet_hash,
            Refusal::StaleRevision,
        )?;
        selected.push(SelectedBinding {
            binding_id: binding.id(),
            revision: projection.revision.clone(),
            packet_hash: packet.hash,
            question_fingerprint: crate::expert::policy::question_fingerprint(judgment),
            template_fingerprint: crate::expert::policy::template_fingerprint(judgment),
        });
    }
    let final_task = evidence::task_current(project, &key.task, key.acceptance_epoch)?;
    require(
        evidence::assignment(project, &final_task) == key.assignment_revision,
        Refusal::StaleRevision,
    )?;
    Ok(Checkpoint {
        key: key.clone(),
        selected,
    })
}
