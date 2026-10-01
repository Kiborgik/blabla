use super::*;
use crate::expert::calibration::{
    self, CalibrationExecution, CalibrationRequestManifest, EvidenceRef, FitPlan, FitSavedRequest,
    FitSavedResult,
};
use crate::expert::native::{self, NativePlan};
use crate::expert::policy::PolicySettings;
use crate::expert::trace::{self, RuntimeConfig};
use crate::project::{self, Project, task};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Component, Path};

pub fn normalized_path(value: &str) -> bool {
    let path = Path::new(value);
    !value.is_empty()
        && !value.contains('\\')
        && !path.is_absolute()
        && value.as_bytes().get(1) != Some(&b':')
        && path.components().all(|c| matches!(c, Component::Normal(_)))
        && path
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/")
            == value
}
pub fn checked_path(root: &Path, value: &str) -> Result<std::path::PathBuf, Error> {
    if !normalized_path(value) {
        return Err(Error::InvalidInput);
    }
    let mut current = root.to_path_buf();
    for part in Path::new(value).components() {
        current.push(part);
        let metadata = std::fs::symlink_metadata(&current).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                Error::Refused(Refusal::StorageMissing)
            } else {
                Error::Io
            }
        })?;
        require(!metadata.file_type().is_symlink(), Refusal::InvalidInput)?;
    }
    Ok(current)
}
pub fn read_bytes(root: &Path, evidence: &EvidenceRef, max: usize) -> Result<Vec<u8>, Error> {
    require(
        identifier(&evidence.id) && hex(&evidence.sha256, 64),
        Refusal::InvalidInput,
    )?;
    let current = checked_path(root, &evidence.path)?;
    let mut bytes = Vec::new();
    let file = std::fs::File::open(&current)?;
    require(
        file.metadata()?.is_file() && file.metadata()?.len() <= max as u64,
        Refusal::InvalidInput,
    )?;
    file.take(max as u64 + 1).read_to_end(&mut bytes)?;
    require(
        bytes.len() <= max && calibration::sha256(&bytes) == evidence.sha256,
        Refusal::RuntimeChanged,
    )?;
    Ok(bytes)
}
pub fn read<T: DeserializeOwned + Serialize>(
    root: &Path,
    evidence: &EvidenceRef,
) -> Result<T, Error> {
    native::decode(&read_bytes(root, evidence, native::MAX_NATIVE_BYTES)?)
}
pub fn read_large<T: DeserializeOwned>(root: &Path, evidence: &EvidenceRef) -> Result<T, Error> {
    Ok(trace::decode_json(
        &read_bytes(root, evidence, calibration::MAX_FIT_BYTES)?,
        calibration::MAX_FIT_BYTES,
    )?)
}
pub fn task_current(project: &Project, task_id: &str, epoch: u64) -> Result<task::Task, Error> {
    require(identifier(task_id), Refusal::IdentityMismatch)?;
    let name = task_id.strip_prefix("task::").ok_or(Error::InvalidInput)?;
    let current = task::read(&project.manifest.root, name)
        .map_err(|_| Error::Io)?
        .ok_or(Refusal::IdentityMismatch)?;
    require(current.state == "accepted", Refusal::TaskNotAccepted)?;
    require(
        epoch > 0 && epoch == current.acceptance_epoch,
        Refusal::EpochMismatch,
    )?;
    Ok(current)
}
pub fn assignment(project: &Project, current: &task::Task) -> task::revision::RelevantRevision {
    task::revision::relevant_revision(
        current,
        &project::snapshot(&project.manifest.root, &project.ignore),
        Default::default(),
    )
}
pub fn approval(project: &Project, approval: &Approval) -> Result<(), Error> {
    read_bytes(
        &project.manifest.root,
        &approval.owner_instruction,
        native::MAX_NATIVE_BYTES,
    )?;
    let name = approval
        .issuer_task
        .strip_prefix("task::")
        .ok_or(Error::InvalidInput)?;
    let issuer = task::read(&project.manifest.root, name)
        .map_err(|_| Error::Io)?
        .ok_or(Refusal::IdentityMismatch)?;
    require(
        issuer.state == "accepted"
            && issuer.role.trim_start_matches("role::") == "orchestrator"
            && task::carrier(&issuer) == Some(approval.issuer_model.as_str()),
        Refusal::PermitMismatch,
    )?;
    let entry = project
        .manifest
        .process
        .as_ref()
        .ok_or(Error::InvalidInput)?;
    let memory = crate::memory::read(
        &entry.path,
        &entry.display,
        crate::memory::process::build,
        crate::memory::process::validate,
    );
    let process = memory.present().ok_or(Error::InvalidInput)?;
    let role = process
        .roles
        .iter()
        .find(|r| r.name == "orchestrator")
        .ok_or(Error::InvalidInput)?;
    require(
        role.model.contains(&approval.issuer_model)
            || process
                .aliases
                .iter()
                .any(|a| a.name == approval.issuer_model && role.model.contains(&a.model)),
        Refusal::PermitMismatch,
    )
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RealCalibration {
    pub kind: String,
    pub schema_version: u64,
    pub protocol_sha256: String,
    pub development_manifest_sha256: String,
    pub holdout_manifest_sha256: String,
    pub request_manifest: EvidenceRef,
    pub fit_plan: EvidenceRef,
    #[serde(deserialize_with = "nullable")]
    pub fitted_result: Option<EvidenceRef>,
    pub provider: crate::expert::provider::ProviderIdentity,
    pub provider_argv_sha256: String,
    pub runtime_config_sha256: String,
    pub executions: Vec<CalibrationExecution>,
    pub selected: Vec<PolicySettings>,
    pub policy_sha256: String,
    pub status: String,
    pub promotion_records: Vec<trace::PromotionRecord>,
}
pub fn calibration_matches(
    project: &Project,
    spec: &PermitSpec,
    config: &RuntimeConfig,
) -> Result<(), Error> {
    let real = calibration_matches_config(project, &spec.real_calibration, &spec.protocol, config)?;
    require(
        real.provider == spec.provider
            && real.provider_argv_sha256 == spec.provider_argv_sha256
            && real.development_manifest_sha256 == spec.development_manifest_sha256
            && real.holdout_manifest_sha256 == spec.holdout_manifest_sha256
            && config.limits == spec.limits,
        Refusal::PermitMismatch,
    )
}
pub(crate) fn calibration_matches_config(
    project: &Project,
    calibration_ref: &EvidenceRef,
    protocol_ref: &EvidenceRef,
    config: &RuntimeConfig,
) -> Result<RealCalibration, Error> {
    let root = &project.manifest.root;
    let configured = config.provider.as_ref().ok_or(Refusal::PermitMismatch)?;
    configured
        .identity
        .require_mode(config.mode)
        .map_err(|_| Refusal::PermitMismatch)?;
    let real: RealCalibration = read_large(root, calibration_ref)?;
    require(
        real.kind == "real_provider_development_calibration"
            && real.schema_version == 1
            && real.status == "eligible"
            && !real.executions.is_empty()
            && real.executions.len() <= 512
            && real.promotion_records.is_empty()
            && real.provider == configured.identity
            && real.provider_argv_sha256 == calibration::canonical_sha256(&configured.argv)?
            && config.policies.iter().all(|p| real.selected.contains(p))
            && hex(&real.runtime_config_sha256, 64)
            && real.policy_sha256 == calibration::canonical_sha256(&real.selected)?,
        Refusal::PermitMismatch,
    )?;
    let (judgments, bindings) = trace::definitions(project)?;
    for settings in &config.policies {
        let binding = bindings
            .iter()
            .find(|b| b.id() == settings.binding_id)
            .ok_or(Refusal::PermitMismatch)?;
        let judgment = judgments
            .iter()
            .find(|j| j.id() == binding.judgment)
            .ok_or(Refusal::PermitMismatch)?;
        crate::expert::policy::validate_settings(settings, judgment)
            .map_err(|_| Refusal::PermitMismatch)?;
        require(
            settings.calibration.question_fingerprint
                == crate::expert::policy::question_fingerprint(judgment)
                && settings.calibration.template_fingerprint
                    == crate::expert::policy::template_fingerprint(judgment),
            Refusal::PermitMismatch,
        )?;
    }
    let plan_bytes = read_bytes(root, &real.fit_plan, calibration::MAX_FIT_BYTES)?;
    let manifest_bytes = read_bytes(root, &real.request_manifest, calibration::MAX_FIT_BYTES)?;
    let plan: FitPlan = trace::decode_json(&plan_bytes, calibration::MAX_FIT_BYTES)?;
    let manifest: CalibrationRequestManifest =
        trace::decode_json(&manifest_bytes, calibration::MAX_FIT_BYTES)?;
    let protocol_bytes = read_bytes(root, protocol_ref, calibration::MAX_FIT_BYTES)?;
    require(
        real.protocol_sha256 == plan.protocol_sha256
            && plan.provider == configured.identity
            && plan.limits == config.limits
            && real.development_manifest_sha256 == plan.development_manifest_sha256
            && real.holdout_manifest_sha256 == plan.holdout_manifest_sha256,
        Refusal::PermitMismatch,
    )?;
    let input = FitSavedRequest {
        kind: "fit_saved_development".into(),
        schema_version: 1,
        protocol_evidence: protocol_ref.clone(),
        plan,
        plan_evidence: real.fit_plan.clone(),
        request_manifest: manifest,
        manifest_evidence: real.request_manifest.clone(),
        executions: real.executions.clone(),
    };
    let context =
        calibration::validate_fit_context(&input, &protocol_bytes, &plan_bytes, &manifest_bytes)?;
    let fitted = calibration::fit_saved(&input, &context)?;
    let saved: FitSavedResult = read_large(
        root,
        real.fitted_result.as_ref().ok_or(Refusal::PermitMismatch)?,
    )?;
    require(saved == fitted, Refusal::PermitMismatch)?;
    let selected = saved
        .groups
        .iter()
        .flat_map(|g| g.selected_primary.iter().chain(g.selected_selection.iter()))
        .cloned()
        .collect::<Vec<_>>();
    require(selected == real.selected, Refusal::PermitMismatch)?;
    for group in &saved.groups {
        if let (Some(primary), Some(selection)) =
            (&group.selected_primary, &group.selected_selection)
        {
            require(
                config.policies.contains(primary) == config.policies.contains(selection),
                Refusal::PermitMismatch,
            )?;
        }
    }
    let request_bytes = read_bytes(
        root,
        &input.request_manifest.requests_jsonl,
        calibration::MAX_FIT_BYTES,
    )?;
    let mut seen = BTreeSet::new();
    for line in request_bytes.split_inclusive(|b| *b == b'\n') {
        require(line.last() == Some(&b'\n'), Refusal::PermitMismatch)?;
        let request: crate::expert::provider::EvaluationRequest =
            trace::decode_json(line, trace::MAX_EVENT_BYTES)?;
        require(
            seen.insert(request.request_id.clone())
                && real.executions.iter().any(|e| e.request == request),
            Refusal::PermitMismatch,
        )?;
    }
    require(seen.len() == real.executions.len(), Refusal::PermitMismatch)?;
    for execution in &real.executions {
        read_bytes(root, &execution.command_evidence, native::MAX_NATIVE_BYTES)?;
    }
    Ok(real)
}
pub fn validate_plan(plan: &NativePlan) -> Result<(), Error> {
    require(
        plan.kind == "native_matched_run_plan"
            && plan.schema_version == 1
            && identifier(&plan.experiment_id)
            && (3..=192).contains(&plan.arms.len())
            && plan.order.len() == plan.arms.len()
            && plan.host_operation_timeout_ms > 0
            && plan.response_timeout_ms > 0,
        Refusal::InvalidInput,
    )?;
    plan.capability.validate()?;
    let ids = plan.arms.iter().map(|a| &a.run_id).collect::<BTreeSet<_>>();
    require(
        ids.len() == plan.arms.len() && plan.order.iter().collect::<BTreeSet<_>>() == ids,
        Refusal::InvalidInput,
    )?;
    for arm in &plan.arms {
        require(
            normalized_path(&arm.workspace)
                && identifier(&arm.run_id)
                && identifier(&arm.matched_task_id)
                && arm.repeat > 0
                && arm.budgets.max_wall_ms > 0
                && arm.frozen_brief.len() <= 8192
                && calibration::sha256(arm.frozen_brief.as_bytes()) == arm.brief_sha256
                && (arm.arm != crate::expert::ExpertMode::Off
                    || (arm.budgets.provider_attempts == 0
                        && arm.budgets.evaluated_questions == 0))
                && (arm.arm == crate::expert::ExpertMode::Advisory
                    || arm.budgets.delivery_attempts == 0),
            Refusal::InvalidInput,
        )?;
        let peers = plan
            .arms
            .iter()
            .filter(|a| a.matched_task_id == arm.matched_task_id && a.repeat == arm.repeat)
            .collect::<Vec<_>>();
        require(
            peers.len() == 3
                && peers
                    .iter()
                    .any(|a| a.arm == crate::expert::ExpertMode::Off)
                && peers
                    .iter()
                    .any(|a| a.arm == crate::expert::ExpertMode::Shadow)
                && peers
                    .iter()
                    .any(|a| a.arm == crate::expert::ExpertMode::Advisory)
                && peers.iter().all(|a| {
                    a.brief_sha256 == arm.brief_sha256
                        && a.grading_spec == arm.grading_spec
                        && a.budgets.max_wall_ms == arm.budgets.max_wall_ms
                        && (a.arm == crate::expert::ExpertMode::Off
                            || arm.arm == crate::expert::ExpertMode::Off
                            || (a.budgets.provider_attempts == arm.budgets.provider_attempts
                                && a.budgets.evaluated_questions
                                    == arm.budgets.evaluated_questions))
                }),
            Refusal::InvalidInput,
        )?;
    }
    Ok(())
}

pub fn plan_protocol(plan: &NativePlan, protocol: &serde_json::Value) -> Result<(), Error> {
    require(
        plan.controls_sha256 == calibration::canonical_sha256(&protocol["pilot"]["controls"])?
            && serde_json::to_value(&plan.snapshot_files).map_err(|_| Error::InvalidInput)?
                == protocol["pilot"]["snapshot_files"]
            && serde_json::to_value(&plan.capability.host).map_err(|_| Error::InvalidInput)?
                == protocol["host"]["capabilities"]
            && protocol["host"]["stop_reason"].is_null(),
        Refusal::RuntimeChanged,
    )?;
    if plan.phase == Phase::Pilot {
        let order = plan
            .order
            .iter()
            .map(|id| plan.arms.iter().find(|a| &a.run_id == id).map(|a| a.arm))
            .collect::<Vec<_>>();
        require(
            plan.arms.len() == 3
                && order
                    == [
                        Some(crate::expert::ExpertMode::Off),
                        Some(crate::expert::ExpertMode::Shadow),
                        Some(crate::expert::ExpertMode::Advisory),
                    ]
                && plan.arms.iter().all(|a| {
                    a.repeat == 1
                        && protocol["pilot"]["task_id"].as_str() == Some(a.matched_task_id.as_str())
                        && protocol["pilot"]["max_wall_ms"].as_u64() == Some(a.budgets.max_wall_ms)
                        && (a.arm == crate::expert::ExpertMode::Off
                            || protocol["pilot"]["call_limit_per_arm"].as_u64()
                                == Some(a.budgets.provider_attempts))
                }),
            Refusal::RuntimeChanged,
        )?;
    } else {
        require(
            protocol["expanded"]["status"] != "not_predeclared"
                && protocol["expanded"]["stop_reason"].is_null(),
            Refusal::RuntimeChanged,
        )?;
    }
    Ok(())
}

pub fn frozen_controls(
    project: &Project,
    plan: &NativePlan,
    arm: &crate::expert::native::ArmPlan,
    config: &RuntimeConfig,
) -> Result<std::collections::BTreeMap<String, String>, Error> {
    let task = task_current(project, &arm.task, arm.acceptance_epoch)?;
    let mut controls = plan
        .snapshot_files
        .iter()
        .filter(|(path, _)| !task.scope.iter().any(|scope| task::covers(scope, path)))
        .map(|(path, hash)| (path.clone(), hash.clone()))
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut paths = vec![project.manifest.path.clone()];
    paths.extend(
        project
            .manifest
            .knowledge
            .iter()
            .chain(project.manifest.process.iter())
            .chain(project.manifest.mission.iter())
            .chain(project.manifest.system.iter())
            .chain(project.manifest.goal.iter())
            .map(|e| e.path.clone()),
    );
    if let Some(provider) = &config.provider {
        paths.extend(
            provider
                .argv
                .iter()
                .map(|arg| project.manifest.root.join(arg))
                .filter(|path| path.starts_with(&project.manifest.root) && path.is_file()),
        );
    }
    for path in paths {
        let relative = path
            .strip_prefix(&project.manifest.root)
            .map_err(|_| Error::InvalidInput)?
            .to_string_lossy()
            .replace('\\', "/");
        let metadata = std::fs::symlink_metadata(&path)?;
        require(
            metadata.is_file() && metadata.len() <= calibration::MAX_FIT_BYTES as u64,
            Refusal::RuntimeChanged,
        )?;
        let hash = calibration::sha256(&std::fs::read(&path)?);
        read_bytes(
            &project.manifest.root,
            &EvidenceRef {
                id: "frozen-control".into(),
                path: relative.clone(),
                sha256: hash.clone(),
            },
            calibration::MAX_FIT_BYTES,
        )?;
        controls.insert(relative, hash);
    }
    Ok(controls)
}
