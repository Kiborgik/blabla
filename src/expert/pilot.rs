use super::trace::TraceError;
use serde::{Deserialize, Deserializer, Serialize};
use std::io::Read;
#[cfg(target_os = "linux")]
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Refusal {
    InvalidInput,
    IdentityMismatch,
    EpochMismatch,
    OriginMismatch,
    GenerationMismatch,
    SequenceGap,
    TaskNotAccepted,
    StaleRevision,
    StaleCheckpoint,
    UnsupportedCapability,
    PermitMissing,
    PermitMismatch,
    PermitRevoked,
    Expired,
    ClockUncertain,
    BudgetExhausted,
    AlreadyClaimed,
    AlreadyConsumed,
    DuplicateDelivery,
    UncertainDelivery,
    MissingContext,
    NonActionable,
    RuntimeChanged,
    StorageMissing,
    StorageCorrupt,
    LedgerExhausted,
}

#[derive(Debug)]
pub enum Error {
    Refused(Refusal),
    InvalidInput,
    Io,
}
impl From<TraceError> for Error {
    fn from(error: TraceError) -> Self {
        match error {
            TraceError::Io => Self::Io,
            TraceError::Missing => Self::Refused(Refusal::StorageMissing),
            TraceError::LedgerExhausted | TraceError::LimitExceeded => {
                Self::Refused(Refusal::LedgerExhausted)
            }
            TraceError::Stale => Self::Refused(Refusal::StaleRevision),
            _ => Self::InvalidInput,
        }
    }
}
impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self::Io
    }
}
impl From<Refusal> for Error {
    fn from(value: Refusal) -> Self {
        Self::Refused(value)
    }
}

pub(crate) fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
pub fn require(value: bool, code: Refusal) -> Result<(), Error> {
    if value { Ok(()) } else { Err(code.into()) }
}
pub fn identifier(value: &str) -> bool {
    value.len() <= 256 && super::policy::safe_identifier(value)
}
pub fn hex(value: &str, len: usize) -> bool {
    value.len() == len
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn opaque(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 256 && super::packet::redact(value) == value
}
pub fn nonce() -> Result<String, Error> {
    let mut bytes = [0u8; 16];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Clock {
    pub boot_id: String,
    pub boottime_ms: u64,
    pub unix_ms: u64,
}
impl Clock {
    pub fn check_after(&self, prior: &Self) -> Result<(), Refusal> {
        let elapsed_boot = self.boottime_ms.checked_sub(prior.boottime_ms);
        let elapsed_utc = self.unix_ms.checked_sub(prior.unix_ms);
        if self.boot_id != prior.boot_id
            || !opaque(&self.boot_id)
            || elapsed_boot
                .zip(elapsed_utc)
                .is_none_or(|(a, b)| a.abs_diff(b) > 2000)
        {
            Err(Refusal::ClockUncertain)
        } else {
            Ok(())
        }
    }
    #[cfg(target_os = "linux")]
    pub fn now() -> Result<Self, Error> {
        let mut time = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        if unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut time) } != 0
            || time.tv_sec < 0
            || !(0..1_000_000_000).contains(&time.tv_nsec)
        {
            return Err(Refusal::ClockUncertain.into());
        }
        let boottime_ms = (time.tv_sec as u64)
            .checked_mul(1000)
            .and_then(|ms| ms.checked_add(time.tv_nsec as u64 / 1_000_000))
            .ok_or(Refusal::ClockUncertain)?;
        let unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|d| u64::try_from(d.as_millis()).ok())
            .ok_or(Refusal::ClockUncertain)?;
        let boot_id = std::fs::read_to_string("/proc/sys/kernel/random/boot_id")
            .map_err(|_| Refusal::ClockUncertain)?
            .trim()
            .to_owned();
        require(opaque(&boot_id), Refusal::ClockUncertain)?;
        Ok(Self {
            boot_id,
            boottime_ms,
            unix_ms,
        })
    }
    #[cfg(not(target_os = "linux"))]
    pub fn now() -> Result<Self, Error> {
        Err(Refusal::UnsupportedCapability.into())
    }
}

mod wire;
pub use wire::*;
pub mod evidence;

use super::calibration;
use super::native::run::{self, Run};
use super::trace::{self, TraceStore};
use crate::project::Project;
use std::collections::BTreeSet;

pub(crate) fn validate_scope(project: &Project, run: &Run, spec: &PermitSpec) -> Result<(), Error> {
    let frozen = run.frozen.as_ref().ok_or(Refusal::RuntimeChanged)?;
    require(
        spec.kind == "experimental_permit"
            && spec.schema_version == 1
            && identifier(&spec.permit_id)
            && spec.arm == "advisory"
            && !spec.promotion_eligible
            && spec.run_id == frozen.arm.run_id
            && spec.experiment_id == frozen.plan.experiment_id
            && spec.phase == frozen.plan.phase
            && spec.protocol == frozen.protocol_ref
            && spec.native_plan == frozen.plan_ref
            && spec.coordinator == frozen.arm.coordinator
            && spec.capability == frozen.plan.capability
            && spec.provider == frozen.plan.provider
            && spec.runtime_config_sha256 == frozen.arm.runtime_config.sha256
            && spec.real_calibration == frozen.plan.calibration
            && spec.limits == frozen.config.limits
            && spec.budgets == frozen.arm.budgets
            && spec.budgets.provider_attempts > 0
            && spec.budgets.evaluated_questions > 0
            && spec.budgets.delivery_attempts > 0
            && spec.budgets.max_wall_ms > 0
            && spec.not_before_unix_ms < spec.expires_unix_ms
            && spec.limits.retries == 0
            && spec.implementation_fingerprints == trace::implementation_fingerprints()
            && spec.stop_on
                == [
                    "owner_stop",
                    "revocation",
                    "expiry",
                    "clock_uncertain",
                    "scope_change",
                    "snapshot_change",
                    "capability_change",
                    "budget_exhausted",
                    "unknown_delivery",
                    "coordinator_lost",
                    "storage_error",
                ]
            && spec.frozen_snapshot_sha256
                == calibration::canonical_sha256(&frozen.plan.snapshot_files)?,
        Refusal::PermitMismatch,
    )?;
    require(
        (1..=16).contains(&spec.tasks.len())
            && spec.tasks.len() == run.enrollments.len()
            && (1..=8).contains(&spec.bindings.len()),
        Refusal::PermitMismatch,
    )?;
    let mut tasks = BTreeSet::new();
    for scope in &spec.tasks {
        let enrolled = run
            .enrollments
            .get(&scope.task)
            .ok_or(Refusal::PermitMismatch)?;
        require(
            tasks.insert(&scope.task)
                && scope.acceptance_epoch == enrolled.enrollment.acceptance_epoch
                && scope.child == enrolled.enrollment.child
                && scope.initial_assignment_revision == enrolled.enrollment.assignment_revision,
            Refusal::PermitMismatch,
        )?;
        evidence::task_current(project, &scope.task, scope.acceptance_epoch)?;
    }
    let configured = frozen
        .config
        .provider
        .as_ref()
        .ok_or(Refusal::PermitMismatch)?;
    require(
        configured.identity == spec.provider
            && spec.provider_argv_sha256 == calibration::canonical_sha256(&configured.argv)?,
        Refusal::PermitMismatch,
    )?;
    spec.provider
        .require_mode(super::ExpertMode::Advisory)
        .map_err(|_| Refusal::PermitMismatch)?;
    let (judgments, bindings) = trace::definitions(project)?;
    let mut ids = BTreeSet::new();
    for scope in &spec.bindings {
        let binding = bindings
            .iter()
            .find(|b| b.id() == scope.binding_id)
            .ok_or(Refusal::PermitMismatch)?;
        let judgment = judgments
            .iter()
            .find(|j| j.id() == binding.judgment)
            .ok_or(Refusal::PermitMismatch)?;
        let settings = frozen
            .config
            .policies
            .iter()
            .find(|p| p.binding_id == scope.binding_id)
            .ok_or(Refusal::PermitMismatch)?;
        super::policy::validate_settings(settings, judgment)
            .map_err(|_| Refusal::PermitMismatch)?;
        require(
            ids.insert(&scope.binding_id)
                && scope.question_fingerprint == super::policy::question_fingerprint(judgment)
                && scope.template_fingerprint == super::policy::template_fingerprint(judgment)
                && scope.policy_fingerprint == super::policy::policy_fingerprint(settings)
                && scope.calibration_fingerprint == super::packet::digest(&settings.calibration),
            Refusal::PermitMismatch,
        )?;
    }
    require(
        ids == frozen
            .config
            .policies
            .iter()
            .map(|p| &p.binding_id)
            .collect(),
        Refusal::PermitMismatch,
    )?;
    evidence::calibration_matches(project, spec, &frozen.config)
}
pub fn issue(
    store: &TraceStore,
    project: &Project,
    spec: PermitSpec,
    approval: Approval,
) -> Result<PermitResult, Error> {
    let run_id = spec.run_id.clone();
    run::transaction(store, &run_id, |run, _, now| {
        evidence::approval(project, &approval)?;
        if let Some(permit) = &run.permit {
            require(
                permit.spec == spec && permit.approval == approval,
                Refusal::PermitMismatch,
            )?;
            return Ok(PermitResult::Issued {
                permit: Box::new(permit.clone()),
            });
        }
        run.admission(project, now, false)?;
        validate_scope(project, run, &spec)?;
        require(
            spec.not_before_unix_ms <= now.unix_ms && now.unix_ms < spec.expires_unix_ms,
            Refusal::Expired,
        )?;
        let permit_sha256 = calibration::canonical_sha256(
            &serde_json::json!({"spec":spec,"approval":approval,"issued":now}),
        )?;
        let permit = IssuedPermit {
            spec,
            approval,
            issued: now.clone(),
            permit_sha256,
        };
        run.permit = Some(permit.clone());
        run.permit_state = Some(PermitState::Active);
        Ok(PermitResult::Issued {
            permit: Box::new(permit),
        })
    })
}
pub fn revoke(
    store: &TraceStore,
    project: &Project,
    authority: AuthorityRef,
    reason: String,
    approval: Approval,
) -> Result<PermitResult, Error> {
    let run_id = authority.run_id().to_owned();
    run::transaction(store, &run_id, |run, _, now| {
        evidence::approval(project, &approval)?;
        require(
            !reason.is_empty() && reason.len() <= 2048 && super::packet::redact(&reason) == reason,
            Refusal::InvalidInput,
        )?;
        require(
            run.permit
                .as_ref()
                .is_some_and(|p| p.authority() == authority),
            Refusal::PermitMismatch,
        )?;
        let recorded = match &run.permit_state {
            Some(PermitState::Revoked { recorded, .. }) => recorded.clone(),
            _ => {
                run.permit_state = Some(PermitState::Revoked {
                    recorded: now.clone(),
                    reason,
                });
                run.stopped = Some(Refusal::PermitRevoked);
                run.revoke_approval = Some(approval);
                now.clone()
            }
        };
        Ok(PermitResult::Revoked {
            authority,
            recorded,
        })
    })
}
pub fn show(store: &TraceStore, run_id: &str) -> Result<PermitView, Error> {
    run::transaction(store, run_id, |run, _, now| {
        let permit = run.permit.clone().ok_or(Refusal::PermitMissing)?;
        if matches!(run.permit_state, Some(PermitState::Active))
            && (now.unix_ms >= permit.spec.expires_unix_ms
                || now
                    .boottime_ms
                    .checked_sub(permit.issued.boottime_ms)
                    .is_none_or(|elapsed| elapsed >= permit.spec.budgets.max_wall_ms)
                || run.frozen.as_ref().is_some_and(|frozen| {
                    now.boottime_ms
                        .checked_sub(run.started.boottime_ms)
                        .is_none_or(|elapsed| elapsed >= frozen.arm.budgets.max_wall_ms)
                }))
        {
            run.stop(Refusal::Expired);
        }
        Ok(PermitView {
            kind: "permit_view".into(),
            permit,
            state: run.permit_state.clone().ok_or(Refusal::PermitMissing)?,
            spent: run.spent.clone(),
            last_clock: run.last_clock.clone(),
        })
    })
}
