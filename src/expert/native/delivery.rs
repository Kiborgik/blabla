use super::run::{LockedRun, Run, Stage, transaction};
use super::run::{Reservation, create_operation};
use super::*;
use crate::expert::calibration;
use crate::expert::pilot::{self, Clock, Error, Refusal, evidence, require};
use crate::expert::trace::{self, TraceRecord, TraceStore};
use crate::project::Project;
fn refusal(reason: &str) -> Refusal {
    match reason {
        "stale_revision" => Refusal::StaleRevision,
        "stale_checkpoint" => Refusal::StaleCheckpoint,
        "runtime_changed" => Refusal::RuntimeChanged,
        "non_actionable" => Refusal::NonActionable,
        "uncertain_delivery" => Refusal::UncertainDelivery,
        "duplicate_delivery" => Refusal::DuplicateDelivery,
        "ledger_exhausted" => Refusal::LedgerExhausted,
        _ => Refusal::InvalidInput,
    }
}
pub(crate) fn prepare_locked(
    store: &TraceStore,
    project: &Project,
    locked: LockedRun<'_>,
    checkpoint: &Checkpoint,
    request_id: &str,
    authority: &crate::expert::pilot::AuthorityRef,
) -> Result<NativeResult, Error> {
    let LockedRun { run, ledger, now } = locked;
    run.admission(project, now, true)?;
    run.checkpoint_current(project, checkpoint)?;
    require(
        run.permit
            .as_ref()
            .is_some_and(|p| &p.authority() == authority),
        Refusal::PermitMismatch,
    )?;
    if let Some(saved) = run
        .reservations
        .values()
        .find(|r| r.checkpoint == *checkpoint)
    {
        require(
            saved.request_id == request_id && saved.authority == *authority,
            Refusal::DuplicateDelivery,
        )?;
        let operation = run
            .operations
            .iter()
            .find(|o| o.request.operation_id == saved.operation_id)
            .ok_or(Refusal::StorageCorrupt)?;
        return Ok(NativeResult::RequestReserved {
            checkpoint: checkpoint.clone(),
            request_id: request_id.into(),
            idempotency_key: saved.idempotency_key.clone(),
            host_operation: operation.request.clone(),
        });
    }
    let enrolled = run
        .enrollments
        .get(&checkpoint.key.task)
        .ok_or(Refusal::IdentityMismatch)?;
    require(
        enrolled.stage == Stage::Observed && enrolled.evaluated,
        Refusal::StaleCheckpoint,
    )?;
    let Some(reference) = run.traces.get(request_id) else {
        run.enrollments.get_mut(&checkpoint.key.task).unwrap().stage = Stage::Settled;
        return Ok(NativeResult::NoAdvice {
            code: Refusal::NonActionable,
            completion: None,
        });
    };
    let record: TraceRecord = evidence::read_large(&store.root, reference)?;
    require(
        record.execution == run.execution()?
            && checkpoint.selected.iter().any(|s| {
                s.binding_id == record.request.packet.binding_id
                    && s.revision == record.request.packet.revision
                    && s.packet_hash == record.request.packet.hash
            }),
        Refusal::IdentityMismatch,
    )?;
    let config = &run.frozen.as_ref().unwrap().config;
    let (current, idempotency_key) = match trace::reserve_guard(
        project,
        ledger,
        config,
        &record,
        &checkpoint.key.checkpoint_id,
        None,
    ) {
        Ok(value) => value,
        Err("non_actionable") => {
            run.enrollments.get_mut(&checkpoint.key.task).unwrap().stage = Stage::Settled;
            return Ok(NativeResult::NoAdvice {
                code: Refusal::NonActionable,
                completion: None,
            });
        }
        Err(reason) => return Err(refusal(reason).into()),
    };
    let timeout = run.frozen.as_ref().unwrap().plan.response_timeout_ms;
    let deadline = run.deadline(now, timeout)?;
    let wake = Wake {
        kind: "blabla_native_wake".into(),
        schema_version: 1,
        run_id: checkpoint.key.run_id.clone(),
        checkpoint_id: checkpoint.key.checkpoint_id.clone(),
        wake_nonce: pilot::nonce()?,
    };
    let mut spent = run.spent.clone();
    spent.charge(&run.permit.as_ref().unwrap().spec.budgets, 0, 0, 1)?;
    let operation = create_operation(
        run,
        &checkpoint.key,
        now,
        HostAction::WakeWorker { wake: wake.clone() },
    )?;
    run.spent = spent;
    ledger.entries.insert(
        idempotency_key.clone(),
        trace::suppression_entry(&record, &current, idempotency_key.clone(), now.unix_ms),
    );
    run.reservations.insert(
        wake.wake_nonce.clone(),
        Reservation {
            checkpoint: checkpoint.clone(),
            request_id: request_id.into(),
            idempotency_key: idempotency_key.clone(),
            authority: authority.clone(),
            wake,
            operation_id: operation.operation_id.clone(),
            deadline_boottime_ms: deadline,
            consume_nonce: None,
            result_sha256: None,
            refusal: None,
            receipts: vec![],
            settled: false,
        },
    );
    run.enrollments.get_mut(&checkpoint.key.task).unwrap().stage = Stage::AwaitResponse;
    Ok(NativeResult::RequestReserved {
        checkpoint: checkpoint.clone(),
        request_id: request_id.into(),
        idempotency_key,
        host_operation: operation,
    })
}
pub fn prepare(
    store: &TraceStore,
    project: &Project,
    checkpoint: &Checkpoint,
    request_id: &str,
    authority: &crate::expert::pilot::AuthorityRef,
) -> Result<NativeResult, Error> {
    transaction(store, &checkpoint.key.run_id, |run, ledger, now| {
        prepare_locked(
            store,
            project,
            LockedRun { run, ledger, now },
            checkpoint,
            request_id,
            authority,
        )
    })
}
pub(crate) fn receipt(
    run: &mut Run,
    nonce: &str,
    now: &Clock,
    category: ReceiptCategory,
) -> Result<NativeReceipt, Error> {
    let reservation = run
        .reservations
        .get_mut(nonce)
        .ok_or(Refusal::IdentityMismatch)?;
    require(reservation.receipts.len() < 64, Refusal::LedgerExhausted)?;
    let receipt = NativeReceipt {
        request_id: reservation.request_id.clone(),
        idempotency_key: reservation.idempotency_key.clone(),
        key: reservation.checkpoint.key.clone(),
        recorded: now.clone(),
        category,
    };
    reservation.receipts.push(receipt.clone());
    Ok(receipt)
}
pub struct ConsumeRequest<'a> {
    pub wake: &'a Wake,
    pub task: &'a str,
    pub acceptance_epoch: u64,
    pub generation: u64,
    pub child_attestation: &'a Child,
    pub first_action_attestation: bool,
}
pub fn consume(
    store: &TraceStore,
    project: &Project,
    request: ConsumeRequest<'_>,
) -> Result<NativeResult, Error> {
    let ConsumeRequest {
        wake,
        task,
        acceptance_epoch: epoch,
        generation,
        child_attestation: child,
        first_action_attestation: first_action,
    } = request;
    transaction(store, &wake.run_id, |run, ledger, now| {
        let saved = run
            .reservations
            .get(&wake.wake_nonce)
            .ok_or(Refusal::IdentityMismatch)?
            .clone();
        require(
            saved.wake == *wake
                && saved.checkpoint.key.task == task
                && saved.checkpoint.key.child == *child,
            Refusal::IdentityMismatch,
        )?;
        if saved.consume_nonce.is_some() {
            return Ok(NativeResult::NoAdvice {
                code: Refusal::AlreadyConsumed,
                completion: None,
            });
        }
        if let Some(refusal) = saved.refusal {
            return Ok(NativeResult::NoAdvice {
                code: refusal.code,
                completion: Some(refusal.completion()?),
            });
        }
        require(
            !saved.settled
                && run
                    .operations
                    .iter()
                    .any(|o| o.request.operation_id == saved.operation_id && o.claimed),
            Refusal::StaleCheckpoint,
        )?;
        let eligible = (|| {
            require(first_action, Refusal::GenerationMismatch)?;
            require(
                epoch == saved.checkpoint.key.acceptance_epoch,
                Refusal::EpochMismatch,
            )?;
            require(
                generation == saved.checkpoint.key.generation,
                Refusal::GenerationMismatch,
            )?;
            require(
                now.boottime_ms < saved.deadline_boottime_ms,
                Refusal::Expired,
            )?;
            run.admission(project, now, true)?;
            run.checkpoint_current(project, &saved.checkpoint)?;
            require(
                run.permit
                    .as_ref()
                    .is_some_and(|p| p.authority() == saved.authority),
                Refusal::PermitMismatch,
            )?;
            let record: TraceRecord = evidence::read_large(
                &store.root,
                run.traces
                    .get(&saved.request_id)
                    .ok_or(Refusal::StorageMissing)?,
            )?;
            require(
                record.execution == run.execution()?,
                Refusal::RuntimeChanged,
            )?;
            trace::reserve_guard(
                project,
                ledger,
                &run.frozen.as_ref().unwrap().config,
                &record,
                &saved.checkpoint.key.checkpoint_id,
                Some(&saved.idempotency_key),
            )
            .map_err(refusal)?;
            let exposure_clock = Clock::now()?;
            run.observe_clock(&exposure_clock)?;
            run.deadline(&exposure_clock, 1)?;
            require(
                exposure_clock.boottime_ms < saved.deadline_boottime_ms,
                Refusal::Expired,
            )?;
            Ok::<_, Error>((record, exposure_clock))
        })();
        let (record, exposure_clock) = match eligible {
            Ok(value) => value,
            Err(Error::Refused(code))
                if !matches!(
                    code,
                    Refusal::StorageCorrupt
                        | Refusal::StorageMissing
                        | Refusal::ClockUncertain
                        | Refusal::UncertainDelivery
                ) =>
            {
                let refused = ConsumeRefusal {
                    kind: "consume_refusal".into(),
                    key: saved.checkpoint.key.clone(),
                    request_id: saved.request_id.clone(),
                    wake_nonce: wake.wake_nonce.clone(),
                    refusal_nonce: pilot::nonce()?,
                    code,
                    exposure_attempted: false,
                };
                if !matches!(
                    code,
                    Refusal::StaleRevision | Refusal::MissingContext | Refusal::NonActionable
                ) {
                    run.stop(code);
                }
                let completion = refused.completion()?;
                run.reservations.get_mut(&wake.wake_nonce).unwrap().refusal = Some(refused);
                return Ok(NativeResult::NoAdvice {
                    code,
                    completion: Some(completion),
                });
            }
            Err(error) => return Err(error),
        };
        let consume_nonce = pilot::nonce()?;
        let result_sha256 = calibration::canonical_sha256(&record.result)?;
        let output = NativeResult::Consumed {
            checkpoint: saved.checkpoint.clone(),
            request_id: saved.request_id.clone(),
            idempotency_key: saved.idempotency_key.clone(),
            consume_nonce: consume_nonce.clone(),
            result_sha256: result_sha256.clone(),
            result: record.result.clone(),
            authority: saved.authority.clone(),
        };
        require(
            serde_json::to_vec(&output)
                .map_err(|_| Error::InvalidInput)?
                .len()
                <= MAX_NATIVE_BYTES,
            Refusal::LedgerExhausted,
        )?;
        let active = run.reservations.get_mut(&wake.wake_nonce).unwrap();
        active.consume_nonce = Some(consume_nonce.clone());
        active.result_sha256 = Some(result_sha256.clone());
        receipt(
            run,
            &wake.wake_nonce,
            &exposure_clock,
            ReceiptCategory::ExposureAttempted {
                consume_nonce: consume_nonce.clone(),
                result_sha256: result_sha256.clone(),
            },
        )?;
        Ok(output)
    })
}
pub fn record_response(
    store: &TraceStore,
    project: &Project,
    checkpoint: &Checkpoint,
    request_id: &str,
    evidence: &ResponseEvidence,
) -> Result<NativeResult, Error> {
    transaction(store, &checkpoint.key.run_id, |run, ledger, now| {
        record_response_locked(
            store,
            project,
            LockedRun { run, ledger, now },
            checkpoint,
            request_id,
            evidence,
        )
    })
}
pub(crate) fn record_response_locked(
    store: &TraceStore,
    project: &Project,
    locked: LockedRun<'_>,
    checkpoint: &Checkpoint,
    request_id: &str,
    evidence: &ResponseEvidence,
) -> Result<NativeResult, Error> {
    let LockedRun { run, ledger, now } = locked;
    let saved = run
        .reservations
        .values()
        .find(|r| &r.checkpoint == checkpoint && r.request_id == request_id)
        .ok_or(Refusal::IdentityMismatch)?
        .clone();
    let category = match evidence {
        ResponseEvidence::ObservedResolution { task_evidence_id } => {
            let entry = ledger
                .entries
                .get(&saved.idempotency_key)
                .ok_or(Refusal::StorageCorrupt)?;
            require(
                matches!(
                    entry.state,
                    crate::expert::DeliveryState::Acknowledged
                        | crate::expert::DeliveryState::Declined
                ),
                Refusal::UncertainDelivery,
            )?;
            let record = evidence::read_large(
                &store.root,
                run.traces.get(request_id).ok_or(Refusal::StorageMissing)?,
            )?;
            trace::validate_resolution(project, entry, &record, task_evidence_id)?;
            ReceiptCategory::ObservedResolved {
                task_evidence_id: task_evidence_id.clone(),
            }
        }
        ResponseEvidence::WorkerResponse {
            response_operation_id,
        } => {
            let operation = run
                .operations
                .iter()
                .find(|o| &o.request.operation_id == response_operation_id)
                .ok_or(Refusal::IdentityMismatch)?;
            let result = operation
                .result
                .as_ref()
                .ok_or(Refusal::UncertainDelivery)?;
            require(
                matches!(&operation.request.payload, HostAction::AwaitBoundary { expected_nonce } if expected_nonce == &saved.wake.wake_nonce)
                    && operation.request.key == checkpoint.key,
                Refusal::IdentityMismatch,
            )?;
            let HostOutcome::WorkerResponse { origin, response } = &result.payload else {
                return Err(Refusal::IdentityMismatch.into());
            };
            require(origin == &checkpoint.key.child, Refusal::OriginMismatch)?;
            match response {
                WorkerResponse::Advice {
                    schema_version,
                    run_id,
                    checkpoint_id,
                    request_id: actual_request,
                    wake_nonce,
                    consume_nonce,
                    result_sha256,
                    child_attestation,
                    disposition,
                } => {
                    require(
                        *schema_version == 1
                            && run_id == &checkpoint.key.run_id
                            && checkpoint_id == &checkpoint.key.checkpoint_id
                            && actual_request == request_id
                            && wake_nonce == &saved.wake.wake_nonce
                            && child_attestation == origin
                            && saved.consume_nonce.as_ref() == Some(consume_nonce)
                            && saved.result_sha256.as_ref() == Some(result_sha256),
                        Refusal::IdentityMismatch,
                    )?;
                    match disposition {
                        Disposition::Acknowledged => ReceiptCategory::Acknowledged {
                            response_operation_id: response_operation_id.clone(),
                            evidence: result.evidence.clone(),
                        },
                        Disposition::Declined => ReceiptCategory::Declined {
                            response_operation_id: response_operation_id.clone(),
                            evidence: result.evidence.clone(),
                        },
                    }
                }
                WorkerResponse::NoAdvice {
                    schema_version,
                    completion,
                    child_attestation,
                } => {
                    let refused = saved.refusal.as_ref().ok_or(Refusal::IdentityMismatch)?;
                    require(
                        *schema_version == 1
                            && child_attestation == origin
                            && saved.consume_nonce.is_none()
                            && &refused.completion()? == completion,
                        Refusal::UncertainDelivery,
                    )?;
                    ReceiptCategory::NotExposed {
                        reason: NotExposedReason::ConsumeRefused,
                        refusal_sha256: Some(completion.refusal_sha256.clone()),
                    }
                }
            }
        }
    };
    if let Some(previous) = saved.receipts.iter().find(|r| r.category == category) {
        return Ok(NativeResult::ResponseObserved {
            request_id: request_id.into(),
            receipt: previous.clone(),
        });
    }
    let observed = receipt(run, &saved.wake.wake_nonce, now, category.clone())?;
    let entry = ledger
        .entries
        .get_mut(&saved.idempotency_key)
        .ok_or(Refusal::StorageCorrupt)?;
    let state = match &category {
        ReceiptCategory::Acknowledged { .. } => crate::expert::DeliveryState::Acknowledged,
        ReceiptCategory::Declined { .. } => crate::expert::DeliveryState::Declined,
        ReceiptCategory::ObservedResolved { .. } => crate::expert::DeliveryState::ObservedResolved,
        ReceiptCategory::NotExposed { .. } => crate::expert::DeliveryState::Proposed,
        _ => return Err(Error::InvalidInput),
    };
    entry.state = state;
    entry.no_delivery_verified = state == crate::expert::DeliveryState::Proposed;
    let evidence_id = match evidence {
        ResponseEvidence::WorkerResponse {
            response_operation_id,
        } => response_operation_id,
        ResponseEvidence::ObservedResolution { task_evidence_id } => task_evidence_id,
    };
    entry.receipts.push(trace::Receipt {
        execution: entry.execution.clone(),
        state,
        evidence: evidence_id.clone(),
        checkpoint_id: checkpoint.key.checkpoint_id.clone(),
        unix_ms: now.unix_ms,
    });
    run.reservations
        .get_mut(&saved.wake.wake_nonce)
        .unwrap()
        .settled = true;
    run.enrollments
        .get_mut(&checkpoint.key.task)
        .ok_or(Refusal::IdentityMismatch)?
        .stage = Stage::Settled;
    if let Some(refused) = &saved.refusal
        && !matches!(
            refused.code,
            Refusal::StaleRevision | Refusal::MissingContext | Refusal::NonActionable
        )
    {
        run.stop(refused.code);
    }
    Ok(NativeResult::ResponseObserved {
        request_id: request_id.into(),
        receipt: observed,
    })
}
