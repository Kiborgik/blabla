use super::delivery::{receipt, record_response_locked};
use super::run::{LockedRun, Run, Stage, transaction};
use super::*;
use crate::expert::calibration;
use crate::expert::pilot::{self, Clock, Error, Refusal, evidence, require};
use crate::expert::trace::{self, Ledger, TraceStore};
use crate::project::Project;
pub fn host_next(store: &TraceStore, run_id: &str) -> Result<HostNextResult, Error> {
    require(pilot::identifier(run_id), Refusal::InvalidInput)?;
    let _lock = store.lock()?;
    let ledger = store.ledger().map_err(|e| match e {
        trace::TraceError::InvalidInput | trace::TraceError::LimitExceeded => {
            Error::Refused(Refusal::StorageCorrupt)
        }
        other => other.into(),
    })?;
    let run = ledger
        .experimental_runs
        .get(run_id)
        .ok_or(Refusal::IdentityMismatch)?;
    Clock::now()?.check_after(&run.last_clock)?;
    if run.stopped.is_some() {
        return Ok(HostNextResult::None {
            run_id: run_id.into(),
        });
    }
    Ok(
        match run
            .operations
            .iter()
            .find(|o| !o.claimed && o.result.is_none())
        {
            Some(operation) => HostNextResult::Pending {
                request: Box::new(operation.request.clone()),
            },
            None => HostNextResult::None {
                run_id: run_id.into(),
            },
        },
    )
}
pub fn claim(
    store: &TraceStore,
    project: &Project,
    request: &ClaimRequest,
) -> Result<ClaimResult, Error> {
    transaction(store, &request.run_id, |run, _, now| {
        run.admission(project, now, true)?;
        let frozen = run.frozen.as_ref().unwrap();
        require(
            request.schema_version == 1 && request.coordinator == frozen.arm.coordinator,
            Refusal::IdentityMismatch,
        )?;
        let operation = run
            .operations
            .iter_mut()
            .find(|o| o.request.operation_id == request.operation_id)
            .ok_or(Refusal::IdentityMismatch)?;
        require(
            calibration::canonical_sha256(&operation.request)? == request.request_sha256,
            Refusal::IdentityMismatch,
        )?;
        require(
            !operation.claimed && operation.result.is_none(),
            Refusal::AlreadyClaimed,
        )?;
        require(
            now.boottime_ms < operation.request.deadline_boottime_ms,
            Refusal::Expired,
        )?;
        operation.claimed = true;
        if matches!(operation.request.payload, HostAction::ContinueWork { .. }) {
            let enrolled = run
                .enrollments
                .get_mut(&operation.request.key.task)
                .ok_or(Refusal::IdentityMismatch)?;
            require(enrolled.stage == Stage::Continue, Refusal::StaleCheckpoint)?;
            enrolled.stage = Stage::AwaitWork;
            enrolled.work_operation_id = Some(request.operation_id.clone());
        }
        Ok(ClaimResult::Claimed {
            operation_id: request.operation_id.clone(),
        })
    })
}
fn expected_status(run: &Run, task: &str) -> Result<NativeMarker, Error> {
    let enrolled = run.enrollments.get(task).ok_or(Refusal::IdentityMismatch)?;
    for operation in run
        .operations
        .iter()
        .rev()
        .filter(|o| o.request.key.task == task)
    {
        if let Some(result) = &operation.result {
            let value = match &result.payload {
                HostOutcome::BoundaryReturned { marker, .. } => serde_json::to_value(marker),
                HostOutcome::WorkerResponse { response, .. } => serde_json::to_value(response),
                _ => continue,
            }
            .map_err(|_| Error::InvalidInput)?;
            return serde_json::from_value(value).map_err(|_| Error::InvalidInput);
        }
    }
    Ok(NativeMarker::Ready {
        schema_version: 1,
        run_id: enrolled.key.run_id.clone(),
        task: task.into(),
        acceptance_epoch: enrolled.key.acceptance_epoch,
    })
}
pub fn host_result(
    store: &TraceStore,
    project: &Project,
    result: &HostResult,
) -> Result<HostRecordResult, Error> {
    transaction(store, &result.key.run_id, |run, ledger, now| {
        let mut candidate = run.clone();
        let mut candidate_ledger = ledger.clone();
        let outcome = host_result_locked(
            store,
            project,
            result,
            &mut candidate,
            &mut candidate_ledger,
            now,
        );
        if outcome.is_ok() {
            *run = candidate;
            *ledger = candidate_ledger;
        } else if let Some(code) = candidate.stopped {
            run.stop(code);
        }
        outcome
    })
}
fn host_result_locked(
    store: &TraceStore,
    project: &Project,
    result: &HostResult,
    run: &mut Run,
    ledger: &mut Ledger,
    now: &Clock,
) -> Result<HostRecordResult, Error> {
    let index = run
        .operations
        .iter()
        .position(|o| o.request.operation_id == result.operation_id)
        .ok_or(Refusal::IdentityMismatch)?;
    let operation = run.operations[index].clone();
    if let Some(saved) = &operation.result {
        if saved == result {
            return Ok(HostRecordResult::Recorded {
                operation_id: result.operation_id.clone(),
            });
        }
        run.stop(Refusal::IdentityMismatch);
        return Err(Refusal::IdentityMismatch.into());
    }
    require(
        operation.claimed
            && operation.request.key == result.key
            && calibration::canonical_sha256(&operation.request)? == result.request_sha256,
        Refusal::IdentityMismatch,
    )?;
    let enrolled = run
        .enrollments
        .get(&result.key.task)
        .ok_or(Refusal::IdentityMismatch)?
        .clone();
    let observed: NativeToolObservation = evidence::read(&store.root, &result.evidence)?;
    require(
        observed.record_id == result.evidence.id,
        Refusal::IdentityMismatch,
    )?;
    let expected = expected_status(run, &result.key.task)?;
    let normalized = super::normalize_projection(
        &operation.request,
        &observed,
        &enrolled.enrollment.coordinator,
        Some(&expected),
    );
    let normalized = match normalized {
        Ok(value) => value,
        Err(Error::Refused(Refusal::OriginMismatch)) => {
            run.stop(Refusal::OriginMismatch);
            return Err(Refusal::OriginMismatch.into());
        }
        Err(error) => return Err(error),
    };
    require(normalized == result.payload, Refusal::IdentityMismatch)?;
    let observed_key = format!("{}:{}", observed.capture_session, observed.local_sequence);
    let observed_hash = calibration::canonical_sha256(&observed)?;
    require(
        run.observed_sequences
            .get(&observed_key)
            .is_none_or(|prior| prior == &observed_hash),
        Refusal::SequenceGap,
    )?;
    require(run.observed_sequences.len() < 256, Refusal::LedgerExhausted)?;
    for prior in run.operations.iter().filter_map(|o| o.result.as_ref()) {
        let prior_observed: NativeToolObservation = evidence::read(&store.root, &prior.evidence)?;
        if prior_observed.capture_session == observed.capture_session {
            require(
                prior_observed.local_sequence < observed.local_sequence,
                Refusal::SequenceGap,
            )?;
        }
    }
    run.observed_sequences.insert(observed_key, observed_hash);
    run.operations[index].result = Some(result.clone());
    if now.boottime_ms >= operation.request.deadline_boottime_ms {
        run.stop(Refusal::Expired);
    }
    match &result.payload {
        HostOutcome::ChildStatus {
            status: ChildStatus::Idle,
            ..
        } => {
            let active = run.enrollments.get_mut(&result.key.task).unwrap();
            match active.stage {
                Stage::Enrolled => active.stage = Stage::Continue,
                Stage::InspectBoundary => {
                    active.stage = Stage::CheckpointDue;
                    active.idle_operation_id = Some(result.operation_id.clone());
                }
                _ => return Err(Refusal::StaleCheckpoint.into()),
            }
        }
        HostOutcome::ContinuationAccepted { .. } => require(
            enrolled.stage == Stage::AwaitWork
                && enrolled.work_operation_id.as_ref() == Some(&result.operation_id),
            Refusal::StaleCheckpoint,
        )?,
        HostOutcome::WakeAccepted { .. } => {
            let nonce = run
                .reservations
                .values()
                .find(|r| r.operation_id == result.operation_id)
                .map(|r| r.wake.wake_nonce.clone())
                .ok_or(Refusal::IdentityMismatch)?;
            receipt(
                run,
                &nonce,
                now,
                ReceiptCategory::TransportAccepted {
                    operation_id: result.operation_id.clone(),
                    evidence: result.evidence.clone(),
                },
            )?;
        }
        HostOutcome::BoundaryReturned { marker, .. } => {
            require(enrolled.stage == Stage::AwaitWork, Refusal::StaleCheckpoint)?;
            let capture: BoundaryCapture = evidence::read(
                &store.root,
                enrolled.capture.as_ref().ok_or(Refusal::StorageMissing)?,
            )?;
            require(
                super::capture::marker(&capture)? == *marker
                    && capture.key.sequence
                        == enrolled
                            .key
                            .sequence
                            .checked_add(1)
                            .ok_or(Refusal::SequenceGap)?,
                Refusal::SequenceGap,
            )?;
            let active = run.enrollments.get_mut(&result.key.task).unwrap();
            active.key = capture.key;
            active.stage = Stage::InspectBoundary;
            active.boundary_operation_id = Some(result.operation_id.clone());
        }
        HostOutcome::WorkerResponse { .. } => {
            let saved = run
                .reservations
                .values()
                .find(|r| r.checkpoint.key == result.key && !r.settled)
                .ok_or(Refusal::IdentityMismatch)?
                .clone();
            record_response_locked(
                store,
                project,
                LockedRun { run, ledger, now },
                &saved.checkpoint,
                &saved.request_id,
                &ResponseEvidence::WorkerResponse {
                    response_operation_id: result.operation_id.clone(),
                },
            )?;
        }
        HostOutcome::Unknown { .. } => run.stop(Refusal::UncertainDelivery),
        HostOutcome::NotInvoked { .. } => run.stop(Refusal::Expired),
        HostOutcome::ChildStatus { .. } => run.stop(Refusal::StaleCheckpoint),
    }
    Ok(HostRecordResult::Recorded {
        operation_id: result.operation_id.clone(),
    })
}
