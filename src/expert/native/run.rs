use super::*;
use crate::expert::calibration::EvidenceRef;
use crate::expert::pilot::{Clock, Error, IssuedPermit, PermitState, Refusal, Spent};
use crate::expert::trace::{self, RuntimeConfig};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Run {
    pub enrollments: BTreeMap<String, EnrolledTask>,
    #[serde(deserialize_with = "pilot::nullable")]
    pub frozen: Option<FrozenRun>,
    pub started: Clock,
    pub last_clock: Clock,
    #[serde(deserialize_with = "pilot::nullable")]
    pub stopped: Option<Refusal>,
    #[serde(deserialize_with = "pilot::nullable")]
    pub permit: Option<IssuedPermit>,
    #[serde(deserialize_with = "pilot::nullable")]
    pub permit_state: Option<PermitState>,
    pub spent: Spent,
    pub attempts: BTreeMap<String, ProviderAttempt>,
    pub operations: Vec<Operation>,
    pub reservations: BTreeMap<String, Reservation>,
    pub traces: BTreeMap<String, EvidenceRef>,
    pub observed_sequences: BTreeMap<String, String>,
    #[serde(deserialize_with = "pilot::nullable")]
    pub revoke_approval: Option<crate::expert::pilot::Approval>,
    pub invalidations: Vec<Invalidation>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Invalidation {
    pub key: BoundaryKey,
    pub reason: InvalidationReason,
    pub evidence: EvidenceRef,
    pub coordinator: Child,
    pub recorded: Clock,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnrolledTask {
    pub enrollment: Enrollment,
    pub key: BoundaryKey,
    pub stage: Stage,
    #[serde(deserialize_with = "pilot::nullable")]
    pub capture: Option<EvidenceRef>,
    #[serde(deserialize_with = "pilot::nullable")]
    pub checkpoint: Option<Checkpoint>,
    #[serde(deserialize_with = "pilot::nullable")]
    pub work_operation_id: Option<String>,
    #[serde(deserialize_with = "pilot::nullable")]
    pub boundary_operation_id: Option<String>,
    #[serde(deserialize_with = "pilot::nullable")]
    pub idle_operation_id: Option<String>,
    pub final_boundary: bool,
    pub evaluated: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Enrolled,
    Continue,
    AwaitWork,
    InspectBoundary,
    CheckpointDue,
    Observed,
    AwaitResponse,
    Settled,
    Finished,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrozenRun {
    pub controls: BTreeMap<String, String>,
    pub implementation_fingerprints: BTreeMap<String, String>,
    pub plan_ref: EvidenceRef,
    pub protocol_ref: EvidenceRef,
    pub plan: NativePlan,
    pub arm: ArmPlan,
    pub config: RuntimeConfig,
    pub config_ref: EvidenceRef,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderAttempt {
    pub request_ids: Vec<String>,
    pub bindings: Vec<String>,
    pub checkpoint: Checkpoint,
    pub started: Clock,
    pub deadline_boottime_ms: u64,
    pub completed: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Operation {
    pub request: HostRequest,
    pub claimed: bool,
    #[serde(deserialize_with = "pilot::nullable")]
    pub result: Option<HostResult>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reservation {
    pub checkpoint: Checkpoint,
    pub request_id: String,
    pub idempotency_key: String,
    pub authority: crate::expert::pilot::AuthorityRef,
    pub wake: Wake,
    pub operation_id: String,
    pub deadline_boottime_ms: u64,
    #[serde(deserialize_with = "pilot::nullable")]
    pub consume_nonce: Option<String>,
    #[serde(deserialize_with = "pilot::nullable")]
    pub result_sha256: Option<String>,
    #[serde(deserialize_with = "pilot::nullable")]
    pub refusal: Option<ConsumeRefusal>,
    pub receipts: Vec<NativeReceipt>,
    pub settled: bool,
}
impl Run {
    pub(crate) fn stop(&mut self, code: Refusal) {
        self.stopped = Some(code);
        if matches!(self.permit_state, Some(PermitState::Active)) {
            self.permit_state = Some(PermitState::Stopped { code });
        }
    }
    pub fn observe_clock(&mut self, now: &Clock) -> Result<(), Error> {
        if let Err(code) = now.check_after(&self.last_clock) {
            self.stop(code);
            return Err(code.into());
        }
        self.last_clock = now.clone();
        Ok(())
    }
}
impl Run {
    pub fn execution(&self) -> Result<ExecutionIdentity, Error> {
        let frozen = self.frozen.as_ref().ok_or(Refusal::RuntimeChanged)?;
        Ok(ExecutionIdentity::Experimental {
            run_id: frozen.arm.run_id.clone(),
            experiment_id: frozen.plan.experiment_id.clone(),
            arm: frozen.arm.arm,
            protocol_sha256: frozen.protocol_ref.sha256.clone(),
            native_plan_sha256: frozen.plan_ref.sha256.clone(),
            authority: self.permit.as_ref().map(IssuedPermit::authority),
            capability_sha256: crate::expert::calibration::canonical_sha256(
                &frozen.plan.capability,
            )?,
        })
    }
}

use crate::expert::pilot::evidence;
use crate::expert::pilot::{self, require};
use crate::expert::trace::{Ledger, TraceRecord, TraceStore};
use crate::expert::{ExpertMode, ObservedEvent};
use crate::expert::{calibration, packet};
use crate::project::Project;

pub(crate) struct LockedRun<'a> {
    pub run: &'a mut Run,
    pub ledger: &'a mut Ledger,
    pub now: &'a Clock,
}

pub(crate) fn transaction<T>(
    store: &TraceStore,
    run_id: &str,
    f: impl FnOnce(&mut Run, &mut Ledger, &Clock) -> Result<T, Error>,
) -> Result<T, Error> {
    require(pilot::identifier(run_id), Refusal::InvalidInput)?;
    store.experimental_transaction(false, |ledger, now| {
        let mut run = ledger
            .experimental_runs
            .remove(run_id)
            .ok_or(Refusal::IdentityMismatch)?;
        let result = run
            .observe_clock(now)
            .and_then(|()| f(&mut run, ledger, now));
        if let Err(Error::Refused(code)) = &result
            && matches!(
                code,
                Refusal::RuntimeChanged
                    | Refusal::Expired
                    | Refusal::ClockUncertain
                    | Refusal::BudgetExhausted
                    | Refusal::StorageMissing
                    | Refusal::StorageCorrupt
                    | Refusal::LedgerExhausted
                    | Refusal::UncertainDelivery
            )
        {
            run.stop(*code);
        }
        ledger.experimental_runs.insert(run_id.into(), run);
        result
    })
}
impl Run {
    pub(crate) fn admission(
        &mut self,
        project: &Project,
        now: &Clock,
        need_permit: bool,
    ) -> Result<(), Error> {
        if let Some(code) = self.stopped {
            return Err(code.into());
        }
        if matches!(self.permit_state, Some(PermitState::Revoked { .. })) {
            return Err(Refusal::PermitRevoked.into());
        }
        let frozen = self.frozen.as_ref().ok_or(Refusal::RuntimeChanged)?;
        let root = &project.manifest.root;
        evidence::read_bytes(root, &frozen.plan_ref, MAX_NATIVE_BYTES)?;
        evidence::read_bytes(root, &frozen.protocol_ref, calibration::MAX_FIT_BYTES)?;
        let config: RuntimeConfig = evidence::read(root, &frozen.config_ref)?;
        require(
            config == frozen.config && config.promotions.is_empty() && config.limits.retries == 0,
            Refusal::RuntimeChanged,
        )?;
        evidence::read_bytes(root, &frozen.arm.runtime_config, MAX_NATIVE_BYTES)?;
        require(
            frozen.implementation_fingerprints == trace::implementation_fingerprints(),
            Refusal::RuntimeChanged,
        )?;
        for (path, hash) in &frozen.controls {
            evidence::read_bytes(
                root,
                &EvidenceRef {
                    id: "frozen-control".into(),
                    path: path.clone(),
                    sha256: hash.clone(),
                },
                calibration::MAX_FIT_BYTES,
            )?;
        }
        frozen.plan.capability.validate()?;
        for enrolled in self.enrollments.values() {
            super::validate_enrollment_evidence(root, &enrolled.enrollment)?;
        }
        let current =
            evidence::task_current(project, &frozen.arm.task, frozen.arm.acceptance_epoch)?;
        let enrolled = self
            .enrollments
            .get(&frozen.arm.task)
            .ok_or(Refusal::IdentityMismatch)?;
        require(
            enrolled.enrollment.child == frozen.arm.child
                && enrolled.enrollment.coordinator == frozen.arm.coordinator
                && evidence::assignment(project, &current).task_digest
                    == enrolled.enrollment.assignment_revision.task_digest,
            Refusal::RuntimeChanged,
        )?;
        let elapsed = now
            .boottime_ms
            .checked_sub(self.started.boottime_ms)
            .ok_or(Refusal::ClockUncertain)?;
        require(elapsed < frozen.arm.budgets.max_wall_ms, Refusal::Expired)?;
        if frozen.arm.arm == ExpertMode::Shadow {
            evidence::calibration_matches_config(
                project,
                &frozen.plan.calibration,
                &frozen.protocol_ref,
                &frozen.config,
            )?;
        }
        if frozen.arm.arm == ExpertMode::Advisory && need_permit {
            let permit = self.permit.as_ref().ok_or(Refusal::PermitMissing)?;
            permit.verify_hash()?;
            require(
                matches!(self.permit_state, Some(PermitState::Active)),
                Refusal::PermitRevoked,
            )?;
            require(
                permit.spec.not_before_unix_ms <= now.unix_ms
                    && now.unix_ms < permit.spec.expires_unix_ms
                    && now
                        .boottime_ms
                        .checked_sub(permit.issued.boottime_ms)
                        .is_some_and(|n| n < permit.spec.budgets.max_wall_ms),
                Refusal::Expired,
            )?;
            crate::expert::pilot::validate_scope(project, self, &permit.spec)?;
        }
        Ok(())
    }
    pub(crate) fn deadline(&self, now: &Clock, timeout: u64) -> Result<u64, Error> {
        let frozen = self.frozen.as_ref().ok_or(Refusal::RuntimeChanged)?;
        let mut deadline = now
            .boottime_ms
            .checked_add(timeout)
            .ok_or(Refusal::ClockUncertain)?;
        deadline = deadline.min(
            self.started
                .boottime_ms
                .checked_add(frozen.arm.budgets.max_wall_ms)
                .ok_or(Refusal::ClockUncertain)?,
        );
        if let Some(permit) = &self.permit {
            let remaining = permit
                .spec
                .expires_unix_ms
                .checked_sub(now.unix_ms)
                .ok_or(Refusal::Expired)?;
            deadline = deadline
                .min(
                    now.boottime_ms
                        .checked_add(remaining)
                        .ok_or(Refusal::ClockUncertain)?,
                )
                .min(
                    permit
                        .issued
                        .boottime_ms
                        .checked_add(permit.spec.budgets.max_wall_ms)
                        .ok_or(Refusal::ClockUncertain)?,
                );
        }
        require(deadline > now.boottime_ms, Refusal::Expired)?;
        Ok(deadline)
    }
    pub(crate) fn checkpoint_current(
        &self,
        project: &Project,
        checkpoint: &Checkpoint,
    ) -> Result<BoundaryCapture, Error> {
        let enrolled = self
            .enrollments
            .get(&checkpoint.key.task)
            .ok_or(Refusal::IdentityMismatch)?;
        require(
            enrolled.checkpoint.as_ref() == Some(checkpoint) && enrolled.key == checkpoint.key,
            Refusal::StaleCheckpoint,
        )?;
        let capture: BoundaryCapture = evidence::read(
            &project.manifest.root,
            enrolled.capture.as_ref().ok_or(Refusal::StorageMissing)?,
        )?;
        require(
            super::capture::rebuild(project, self, &capture)? == *checkpoint,
            Refusal::StaleRevision,
        )?;
        Ok(capture)
    }
}

pub fn start(
    store: &TraceStore,
    project: &Project,
    run_id: &str,
    plan_ref: &EvidenceRef,
    protocol_ref: &EvidenceRef,
) -> Result<AdvanceResult, Error> {
    transaction(store, run_id, |run, ledger, now| {
        let plan: NativePlan = evidence::read(&store.root, plan_ref)?;
        evidence::validate_plan(&plan)?;
        let protocol: serde_json::Value = evidence::read_large(&store.root, protocol_ref)?;
        calibration::validate_frozen_protocol(&protocol)?;
        evidence::plan_protocol(&plan, &protocol)?;
        require(
            calibration::canonical_sha256(&protocol)? == plan.protocol_sha256,
            Refusal::RuntimeChanged,
        )?;
        let arm = plan
            .arms
            .iter()
            .find(|arm| arm.run_id == run_id)
            .ok_or(Refusal::IdentityMismatch)?
            .clone();
        let config: RuntimeConfig = evidence::read(&store.root, &arm.runtime_config)?;
        config.validate()?;
        require(
            evidence::checked_path(&store.root, &arm.workspace)?.is_dir(),
            Refusal::InvalidInput,
        )?;
        evidence::read_bytes(&store.root, &arm.grading_spec, MAX_NATIVE_BYTES)?;
        for peer in &plan.arms {
            let mut peer_config: RuntimeConfig = evidence::read(&store.root, &peer.runtime_config)?;
            peer_config.validate()?;
            require(peer_config.mode == peer.arm, Refusal::RuntimeChanged)?;
            peer_config.mode = config.mode;
            require(peer_config == config, Refusal::RuntimeChanged)?;
        }
        require(
            config.mode == arm.arm
                && config.host.as_ref() == Some(&plan.capability.host)
                && config.promotions.is_empty()
                && config.limits.retries == 0
                && (config.mode == ExpertMode::Off
                    || config
                        .provider
                        .as_ref()
                        .is_some_and(|p| p.identity == plan.provider)),
            Refusal::RuntimeChanged,
        )?;
        let enrolled = run
            .enrollments
            .get(&arm.task)
            .ok_or(Refusal::IdentityMismatch)?;
        require(
            enrolled.enrollment.child == arm.child
                && enrolled.enrollment.coordinator == arm.coordinator
                && enrolled.enrollment.acceptance_epoch == arm.acceptance_epoch
                && enrolled.enrollment.assignment_revision == arm.initial_assignment_revision
                && enrolled.enrollment.capability == plan.capability,
            Refusal::IdentityMismatch,
        )?;
        if let Some(frozen) = &run.frozen {
            require(
                frozen.plan_ref == *plan_ref
                    && frozen.protocol_ref == *protocol_ref
                    && frozen.plan == plan
                    && frozen.arm == arm
                    && frozen.config == config,
                Refusal::RuntimeChanged,
            )?;
        } else {
            let current = evidence::task_current(project, &arm.task, arm.acceptance_epoch)?;
            require(
                evidence::assignment(project, &current) == arm.initial_assignment_revision,
                Refusal::StaleRevision,
            )?;
            for (path, hash) in &plan.snapshot_files {
                evidence::read_bytes(
                    &store.root,
                    &EvidenceRef {
                        id: "snapshot".into(),
                        path: path.clone(),
                        sha256: hash.clone(),
                    },
                    8 * 1024 * 1024,
                )?;
            }
            let config_ref = store.save_experimental_payload(
                run_id,
                "config",
                "runtime",
                &config,
                trace::MAX_CONFIG_BYTES,
            )?;
            let controls = evidence::frozen_controls(project, &plan, &arm, &config)?;
            run.frozen = Some(FrozenRun {
                controls,
                implementation_fingerprints: trace::implementation_fingerprints(),
                plan_ref: plan_ref.clone(),
                protocol_ref: protocol_ref.clone(),
                plan,
                arm,
                config,
                config_ref,
            });
            run.started = now.clone();
        }
        advance_locked_with_store(store, ledger, run, project, now)
    })
}

pub fn checkpoint_input(
    store: &TraceStore,
    project: &Project,
    run_id: &str,
    event: &ObservedEvent,
    supplied: Option<&RuntimeConfig>,
) -> Result<(RuntimeConfig, BoundaryCapture, ExecutionIdentity), Error> {
    transaction(store, run_id, |run, _, now| {
        run.admission(project, now, true)?;
        let frozen = run.frozen.as_ref().ok_or(Refusal::RuntimeChanged)?;
        require(
            supplied.is_none_or(|c| c == &frozen.config),
            Refusal::RuntimeChanged,
        )?;
        let enrolled = run
            .enrollments
            .get(&event.task)
            .ok_or(Refusal::IdentityMismatch)?;
        require(
            enrolled.stage == Stage::Observed && !enrolled.evaluated,
            Refusal::StaleCheckpoint,
        )?;
        let checkpoint = enrolled
            .checkpoint
            .as_ref()
            .ok_or(Refusal::StaleCheckpoint)?;
        let capture = run.checkpoint_current(project, checkpoint)?;
        require(
            event.observations.is_empty() && capture.event == *event,
            Refusal::StaleCheckpoint,
        )?;
        Ok((frozen.config.clone(), capture, run.execution()?))
    })
}
pub fn reserve_provider(
    store: &TraceStore,
    project: &Project,
    run_id: &str,
    requests: &[crate::expert::provider::EvaluationRequest],
) -> Result<(String, u64), Error> {
    transaction(store, run_id, |run, _, now| {
        run.admission(project, now, true)?;
        require(
            !requests.is_empty() && requests.len() <= 4,
            Refusal::InvalidInput,
        )?;
        if requests.len() > 1 {
            crate::expert::provider::validate_batch(
                &crate::expert::provider::EvaluationBatchRequest {
                    batch_id: "native-reservation".into(),
                    requests: requests.to_vec(),
                },
            )
            .map_err(|_| Error::InvalidInput)?;
        }
        let task = &requests[0].packet.event.task;
        let checkpoint = run
            .enrollments
            .get(task)
            .and_then(|e| e.checkpoint.clone())
            .ok_or(Refusal::StaleCheckpoint)?;
        run.checkpoint_current(project, &checkpoint)?;
        require(
            requests.iter().all(|r| {
                checkpoint.selected.iter().any(|s| {
                    s.binding_id == r.packet.binding_id
                        && s.packet_hash == r.packet.hash
                        && s.revision == r.packet.revision
                })
            }) && !run.attempts.values().any(|a| {
                a.checkpoint == checkpoint
                    && requests
                        .iter()
                        .any(|r| a.bindings.contains(&r.packet.binding_id))
            }),
            Refusal::AlreadyClaimed,
        )?;
        let frozen = run.frozen.as_ref().unwrap();
        require(frozen.arm.arm != ExpertMode::Off, Refusal::BudgetExhausted)?;
        require(
            requests.iter().all(|request| {
                frozen.config.policies.iter().any(|settings| {
                    settings.binding_id == request.packet.binding_id
                        && settings.calibration.question_fingerprint == request.question_fingerprint
                        && settings.calibration.template_fingerprint == request.template_fingerprint
                        && request.question_fingerprint
                            == crate::expert::policy::question_fingerprint(&request.judgment)
                        && request.template_fingerprint
                            == crate::expert::policy::template_fingerprint(&request.judgment)
                })
            }),
            Refusal::PermitMismatch,
        )?;
        let deadline = run.deadline(now, frozen.config.limits.request_timeout_ms)?;
        let id = format!("provider-{}", pilot::nonce()?);
        run.spent
            .charge(&frozen.arm.budgets, 1, requests.len() as u64, 0)?;
        if let Some(permit) = &run.permit {
            require(
                run.spent.provider_attempts <= permit.spec.budgets.provider_attempts
                    && run.spent.evaluated_questions <= permit.spec.budgets.evaluated_questions,
                Refusal::BudgetExhausted,
            )?;
        }
        run.attempts.insert(
            id.clone(),
            ProviderAttempt {
                request_ids: requests.iter().map(|r| r.request_id.clone()).collect(),
                bindings: requests
                    .iter()
                    .map(|r| r.packet.binding_id.clone())
                    .collect(),
                checkpoint,
                started: now.clone(),
                deadline_boottime_ms: deadline,
                completed: false,
            },
        );
        Ok((id, deadline))
    })
}
pub fn store_records(
    store: &TraceStore,
    project: &Project,
    run_id: &str,
    records: &mut [TraceRecord],
) -> Result<(), Error> {
    transaction(store, run_id, |run, _, now| {
        let admission = run.admission(project, now, true);
        let valid = admission.is_ok();
        let fatal = match &admission {
            Ok(()) | Err(Error::Refused(Refusal::PermitRevoked)) => None,
            Err(Error::Refused(Refusal::InvalidInput)) | Err(Error::InvalidInput | Error::Io) => {
                Some(Refusal::StorageCorrupt)
            }
            Err(Error::Refused(code)) => Some(*code),
        };
        if let Some(code) = fatal {
            run.stop(code);
        }
        let execution = run.execution()?;
        let mut staged = records.to_vec();
        let mut ids = std::collections::BTreeSet::new();
        for record in &mut staged {
            require(
                ids.insert(record.request.request_id.clone())
                    && !run.traces.contains_key(&record.request.request_id),
                Refusal::IdentityMismatch,
            )?;
            let attempt = run
                .attempts
                .values()
                .find(|attempt| attempt.request_ids.contains(&record.request.request_id));
            require(
                attempt.is_some()
                    || trace::deterministic_result(&record.request, record.provenance).is_some(),
                Refusal::IdentityMismatch,
            )?;
            let timely =
                attempt.is_none_or(|attempt| now.boottime_ms < attempt.deadline_boottime_ms);
            record.mode = ExpertMode::Shadow;
            record.execution = execution.clone();
            record.permit = run.permit.clone();
            if !valid || !timely {
                trace::suppress(record, "stale_checkpoint");
            }
            if valid && timely && run.frozen.as_ref().unwrap().arm.arm == ExpertMode::Advisory {
                record.mode = ExpertMode::Advisory;
            }
            trace::replay(record).map_err(|_| Error::InvalidInput)?;
            super::validate_value(
                &serde_json::to_value(&record).map_err(|_| Error::InvalidInput)?,
                "",
                0,
            )?;
            require(
                pilot::identifier(&record.request.request_id),
                Refusal::InvalidInput,
            )?;
        }
        require(
            run.attempts.values().all(|attempt| {
                attempt
                    .request_ids
                    .iter()
                    .all(|id| run.traces.contains_key(id) || ids.contains(id))
            }),
            Refusal::UncertainDelivery,
        )?;
        let mut references = BTreeMap::new();
        for record in &staged {
            match store.save_experimental_payload(
                run_id,
                "traces",
                &record.request.request_id,
                record,
                trace::MAX_TRACE_BYTES,
            ) {
                Ok(reference) => {
                    references.insert(record.request.request_id.clone(), reference);
                }
                Err(error) => {
                    run.stop(Refusal::StorageCorrupt);
                    return Err(error.into());
                }
            }
        }
        run.traces.extend(references);
        for attempt in run.attempts.values_mut() {
            attempt.completed = true;
        }
        let task = run.frozen.as_ref().unwrap().arm.task.clone();
        run.enrollments.get_mut(&task).unwrap().evaluated = true;
        records.clone_from_slice(&staged);
        if fatal.is_some() { admission } else { Ok(()) }
    })
}

pub(crate) fn create_operation(
    run: &mut Run,
    key: &BoundaryKey,
    now: &Clock,
    payload: HostAction,
) -> Result<HostRequest, Error> {
    require(
        run.operations.len() < 64 && !run.operations.iter().any(|o| o.result.is_none()),
        Refusal::LedgerExhausted,
    )?;
    let timeout = run
        .frozen
        .as_ref()
        .ok_or(Refusal::RuntimeChanged)?
        .plan
        .host_operation_timeout_ms;
    let mut deadline = run.deadline(now, timeout)?;
    if let HostAction::AwaitBoundary { expected_nonce } = &payload
        && let Some(reservation) = run.reservations.get(expected_nonce)
    {
        deadline = deadline.min(reservation.deadline_boottime_ms);
    }
    let request = HostRequest {
        schema_version: 1,
        operation_id: format!("operation-{}", pilot::nonce()?),
        key: key.clone(),
        created: now.clone(),
        deadline_boottime_ms: deadline,
        payload,
    };
    require(
        serde_json::to_vec(&HostNextResult::Pending {
            request: Box::new(request.clone()),
        })
        .map_err(|_| Error::InvalidInput)?
        .len()
            <= MAX_NATIVE_BYTES,
        Refusal::LedgerExhausted,
    )?;
    run.operations.push(Operation {
        request: request.clone(),
        claimed: false,
        result: None,
    });
    Ok(request)
}
fn advance_locked_with_store(
    store: &TraceStore,
    ledger: &mut Ledger,
    run: &mut Run,
    project: &Project,
    now: &Clock,
) -> Result<AdvanceResult, Error> {
    if let Some(code) = run.stopped {
        return Ok(AdvanceResult::ArmStopped {
            run_id: run
                .frozen
                .as_ref()
                .ok_or(Refusal::RuntimeChanged)?
                .arm
                .run_id
                .clone(),
            code,
        });
    }
    let frozen = run.frozen.as_ref().ok_or(Refusal::RuntimeChanged)?.clone();
    if frozen.arm.arm == ExpertMode::Advisory && run.permit.is_none() {
        return Ok(AdvanceResult::AwaitingPermit {
            run_id: frozen.arm.run_id,
        });
    }
    run.admission(project, now, true)?;
    if let Some(operation) = run.operations.iter().find(|o| o.result.is_none()) {
        if now.boottime_ms >= operation.request.deadline_boottime_ms {
            let code = if operation.claimed {
                Refusal::UncertainDelivery
            } else {
                Refusal::Expired
            };
            run.stop(code);
            return Ok(AdvanceResult::ArmStopped {
                run_id: frozen.arm.run_id,
                code,
            });
        }
        return Ok(AdvanceResult::Pending {
            request: operation.request.clone(),
        });
    }
    loop {
        let enrolled = run
            .enrollments
            .get(&frozen.arm.task)
            .ok_or(Refusal::IdentityMismatch)?
            .clone();
        let payload = match enrolled.stage {
            Stage::Enrolled | Stage::InspectBoundary => HostAction::InspectChild,
            Stage::Continue => {
                if enrolled.key.sequence > 0 && enrolled.work_operation_id.is_some() {
                    let current = evidence::task_current(
                        project,
                        &enrolled.key.task,
                        enrolled.key.acceptance_epoch,
                    )?;
                    let active = run.enrollments.get_mut(&frozen.arm.task).unwrap();
                    active.key.generation = active
                        .key
                        .generation
                        .checked_add(1)
                        .ok_or(Refusal::GenerationMismatch)?;
                    active.key.boundary_nonce = pilot::nonce()?;
                    active.key.assignment_revision = evidence::assignment(project, &current);
                    active.capture = None;
                    active.checkpoint = None;
                    active.work_operation_id = None;
                    active.boundary_operation_id = None;
                    active.idle_operation_id = None;
                    active.evaluated = false;
                    continue;
                }
                HostAction::ContinueWork {
                    brief: frozen.arm.frozen_brief.clone(),
                    brief_sha256: frozen.arm.brief_sha256.clone(),
                }
            }
            Stage::AwaitWork => HostAction::AwaitBoundary {
                expected_nonce: enrolled.key.boundary_nonce.clone(),
            },
            Stage::AwaitResponse => {
                let reservation = run
                    .reservations
                    .values()
                    .find(|r| r.checkpoint.key == enrolled.key && !r.settled)
                    .ok_or(Refusal::UncertainDelivery)?;
                HostAction::AwaitBoundary {
                    expected_nonce: reservation.wake.wake_nonce.clone(),
                }
            }
            Stage::CheckpointDue => {
                return Ok(AdvanceResult::CheckpointDue {
                    observation: ObserveRequest {
                        schema_version: 1,
                        kind: "observe".into(),
                        key: enrolled.key.clone(),
                        boundary_operation_id: enrolled
                            .boundary_operation_id
                            .ok_or(Refusal::StaleCheckpoint)?,
                        idle_operation_id: enrolled
                            .idle_operation_id
                            .ok_or(Refusal::StaleCheckpoint)?,
                        config_sha256: frozen.arm.runtime_config.sha256.clone(),
                    },
                });
            }
            Stage::Observed => {
                require(enrolled.evaluated, Refusal::StaleCheckpoint)?;
                if frozen.arm.arm == ExpertMode::Advisory {
                    let mut candidates = Vec::new();
                    for reference in run.traces.values() {
                        let record: TraceRecord = evidence::read_large(&store.root, reference)?;
                        if record.request.packet.event.checkpoint_id == enrolled.key.checkpoint_id
                            && matches!(
                                record.result.outcome,
                                crate::expert::policy::AdvisoryOutcome::Nudge
                                    | crate::expert::policy::AdvisoryOutcome::Escalation
                            )
                        {
                            candidates.push(record);
                        }
                    }
                    candidates
                        .sort_by(|a, b| trace::record_priority(a).cmp(&trace::record_priority(b)));
                    if let Some(record) = candidates.first() {
                        let authority = run.permit.as_ref().unwrap().authority();
                        if let NativeResult::RequestReserved { host_operation, .. } =
                            prepare_locked(
                                store,
                                project,
                                LockedRun { run, ledger, now },
                                enrolled
                                    .checkpoint
                                    .as_ref()
                                    .ok_or(Refusal::StaleCheckpoint)?,
                                &record.request.request_id,
                                &authority,
                            )?
                        {
                            return Ok(AdvanceResult::Pending {
                                request: host_operation,
                            });
                        }
                    }
                }
                run.enrollments.get_mut(&frozen.arm.task).unwrap().stage = Stage::Settled;
                continue;
            }
            Stage::Settled => {
                let active = run.enrollments.get_mut(&frozen.arm.task).unwrap();
                active.stage = if active.final_boundary {
                    Stage::Finished
                } else {
                    Stage::Enrolled
                };
                continue;
            }
            Stage::Finished => {
                return Ok(AdvanceResult::ArmFinished {
                    run_id: frozen.arm.run_id,
                });
            }
        };
        return Ok(AdvanceResult::Pending {
            request: create_operation(run, &enrolled.key, now, payload)?,
        });
    }
}
pub fn advance(
    store: &TraceStore,
    project: &Project,
    run_id: &str,
    plan_hash: &str,
    coordinator: &Child,
) -> Result<AdvanceResult, Error> {
    transaction(store, run_id, |run, ledger, now| {
        let frozen = run.frozen.as_ref().ok_or(Refusal::RuntimeChanged)?;
        require(
            &frozen.arm.coordinator == coordinator
                && calibration::canonical_sha256(&frozen.plan)? == plan_hash,
            Refusal::IdentityMismatch,
        )?;
        advance_locked_with_store(store, ledger, run, project, now)
    })
}

pub fn observe(
    store: &TraceStore,
    project: &Project,
    request: &ObserveRequest,
) -> Result<NativeResult, Error> {
    transaction(store, &request.key.run_id, |run, ledger, now| {
        run.admission(project, now, true)?;
        let enrolled = run
            .enrollments
            .get(&request.key.task)
            .ok_or(Refusal::IdentityMismatch)?
            .clone();
        require(
            enrolled.key == request.key
                && matches!(enrolled.stage, Stage::CheckpointDue | Stage::Observed)
                && enrolled.boundary_operation_id.as_ref() == Some(&request.boundary_operation_id)
                && enrolled.idle_operation_id.as_ref() == Some(&request.idle_operation_id)
                && run.frozen.as_ref().unwrap().arm.runtime_config.sha256 == request.config_sha256,
            Refusal::StaleCheckpoint,
        )?;
        let capture: BoundaryCapture = evidence::read(
            &store.root,
            enrolled.capture.as_ref().ok_or(Refusal::StorageMissing)?,
        )?;
        let checkpoint = super::capture::rebuild(project, run, &capture)?;
        let ledger_key = packet::digest(&(&request.key.run_id, &request.key.task));
        if let Some(prior) = ledger.checkpoints.get(&ledger_key) {
            require(
                prior == &capture.event
                    || (prior.sequence.checked_add(1) == Some(capture.event.sequence)
                        && capture.event.previous_sequence == Some(prior.sequence)),
                Refusal::SequenceGap,
            )?;
        } else {
            require(capture.event.sequence == 1, Refusal::SequenceGap)?;
        }
        require(
            ledger.checkpoints.contains_key(&ledger_key) || ledger.checkpoints.len() < 256,
            Refusal::LedgerExhausted,
        )?;
        ledger
            .checkpoints
            .insert(ledger_key.clone(), capture.event.clone());
        ledger.blocked_checkpoints.remove(&ledger_key);
        let active = run.enrollments.get_mut(&request.key.task).unwrap();
        active.checkpoint = Some(checkpoint.clone());
        active.stage = Stage::Observed;
        active.final_boundary = capture.final_boundary;
        Ok(NativeResult::BoundaryObserved {
            checkpoint,
            event: capture.event,
        })
    })
}
pub fn capture_boundary(
    store: &TraceStore,
    project: &Project,
    work_key: &BoundaryKey,
    child: &Child,
    statements: &[WorkerStatement],
    final_boundary: bool,
) -> Result<NativeResult, Error> {
    transaction(store, &work_key.run_id, |run, ledger, now| {
        run.admission(project, now, true)?;
        super::capture::capture(
            store,
            project,
            LockedRun { run, ledger, now },
            work_key,
            child,
            statements,
            final_boundary,
        )
    })
}
pub fn invalidate(
    store: &TraceStore,
    key: &BoundaryKey,
    reason: InvalidationReason,
    evidence_ref: &EvidenceRef,
    coordinator: &Child,
) -> Result<NativeResult, Error> {
    transaction(store, &key.run_id, |run, _, now| {
        let enrolled = run
            .enrollments
            .get(&key.task)
            .ok_or(Refusal::IdentityMismatch)?;
        require(
            enrolled.key == *key && enrolled.enrollment.coordinator == *coordinator,
            Refusal::IdentityMismatch,
        )?;
        evidence::read_bytes(&store.root, evidence_ref, MAX_NATIVE_BYTES)?;
        if !run
            .invalidations
            .iter()
            .any(|i| i.key == *key && i.reason == reason && i.evidence == *evidence_ref)
        {
            require(run.invalidations.len() < 64, Refusal::LedgerExhausted)?;
            run.invalidations.push(Invalidation {
                key: key.clone(),
                reason,
                evidence: evidence_ref.clone(),
                coordinator: coordinator.clone(),
                recorded: now.clone(),
            });
        }
        run.stop(match reason {
            InvalidationReason::OriginMismatch => Refusal::OriginMismatch,
            InvalidationReason::MissedBoundary => Refusal::SequenceGap,
            InvalidationReason::TaskReplaced => Refusal::EpochMismatch,
            _ => Refusal::GenerationMismatch,
        });
        Ok(NativeResult::Invalidated {
            run_id: key.run_id.clone(),
            generation: key.generation,
        })
    })
}

pub fn runtime_config(store: &TraceStore, run_id: &str) -> Result<RuntimeConfig, Error> {
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
    let frozen = run.frozen.as_ref().ok_or(Refusal::RuntimeChanged)?;
    let config: RuntimeConfig = evidence::read(&store.root, &frozen.config_ref)?;
    require(config == frozen.config, Refusal::RuntimeChanged)?;
    Ok(config)
}
pub fn enroll(
    store: &TraceStore,
    project: &Project,
    enrollment: Enrollment,
) -> Result<NativeResult, Error> {
    require(
        pilot::identifier(&enrollment.run_id) && enrollment.generation > 0,
        Refusal::InvalidInput,
    )?;
    store.experimental_transaction(true, |ledger, now| {
        let current =
            evidence::task_current(project, &enrollment.task, enrollment.acceptance_epoch)?;
        require(
            evidence::assignment(project, &current) == enrollment.assignment_revision,
            Refusal::StaleRevision,
        )?;
        super::validate_enrollment_evidence(&store.root, &enrollment)?;
        require(
            ledger.experimental_runs.contains_key(&enrollment.run_id)
                || ledger.experimental_runs.len() < 256,
            Refusal::LedgerExhausted,
        )?;
        if !ledger.experimental_runs.contains_key(&enrollment.run_id) {
            let payload = store.experimental_path(&enrollment.run_id, "config", "runtime")?;
            require(
                !payload
                    .parent()
                    .and_then(|p| p.parent())
                    .is_some_and(|p| p.exists()),
                Refusal::StorageCorrupt,
            )?;
        }
        let run = ledger
            .experimental_runs
            .entry(enrollment.run_id.clone())
            .or_insert_with(|| Run {
                enrollments: BTreeMap::new(),
                frozen: None,
                started: now.clone(),
                last_clock: now.clone(),
                stopped: None,
                permit: None,
                permit_state: None,
                spent: Spent::default(),
                attempts: BTreeMap::new(),
                operations: vec![],
                reservations: BTreeMap::new(),
                traces: BTreeMap::new(),
                observed_sequences: BTreeMap::new(),
                revoke_approval: None,
                invalidations: vec![],
            });
        run.observe_clock(now)?;
        require(
            run.stopped.is_none() && run.frozen.is_none(),
            Refusal::IdentityMismatch,
        )?;
        if let Some(prior) = run.enrollments.get(&enrollment.task) {
            require(prior.enrollment == enrollment, Refusal::IdentityMismatch)?;
            return Ok(NativeResult::Enrolled {
                key: prior.key.clone(),
            });
        }
        require(
            run.enrollments.len() < 16
                && run.enrollments.values().all(|e| {
                    e.enrollment.child != enrollment.child
                        && e.enrollment.coordinator == enrollment.coordinator
                }),
            Refusal::IdentityMismatch,
        )?;
        for observation in super::enrollment_observations(&store.root, &enrollment)? {
            let key = format!(
                "{}:{}",
                observation.capture_session, observation.local_sequence
            );
            let hash = calibration::canonical_sha256(&observation)?;
            require(
                run.observed_sequences
                    .get(&key)
                    .is_none_or(|old| old == &hash),
                Refusal::SequenceGap,
            )?;
            run.observed_sequences.insert(key, hash);
        }
        let key = BoundaryKey {
            run_id: enrollment.run_id.clone(),
            task: enrollment.task.clone(),
            acceptance_epoch: enrollment.acceptance_epoch,
            child: enrollment.child.clone(),
            generation: enrollment.generation,
            checkpoint_id: "initial".into(),
            sequence: 0,
            previous_sequence: None,
            boundary_nonce: pilot::nonce()?,
            assignment_revision: enrollment.assignment_revision.clone(),
        };
        run.enrollments.insert(
            enrollment.task.clone(),
            EnrolledTask {
                enrollment,
                key: key.clone(),
                stage: Stage::Enrolled,
                capture: None,
                checkpoint: None,
                work_operation_id: None,
                boundary_operation_id: None,
                idle_operation_id: None,
                final_boundary: false,
                evaluated: false,
            },
        );
        Ok(NativeResult::Enrolled { key })
    })
}
pub fn runtime_config_sha256(store: &TraceStore, run_id: &str) -> Result<String, Error> {
    let _lock = store.lock()?;
    let ledger = store.ledger()?;
    Ok(ledger
        .experimental_runs
        .get(run_id)
        .and_then(|run| run.frozen.as_ref())
        .ok_or(Refusal::IdentityMismatch)?
        .arm
        .runtime_config
        .sha256
        .clone())
}

use super::delivery::prepare_locked;
pub use super::delivery::{ConsumeRequest, consume, prepare, record_response};
pub use super::host::{claim, host_next, host_result};
