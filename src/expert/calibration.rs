use super::packet;
use super::policy::{self, AdvisoryOutcome, ConcernKind, ExpertResult, PolicySettings, Predicate};
use super::provider::{
    self, EvaluationBatchRequest, EvaluationRequest, EvaluationResponse, ProviderIdentity,
};
use super::trace::{self, ExpertisePair, Provenance, RuntimeConfig, TraceError, TraceRecord};
use super::{ExpertLimits, ExpertMode};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_FIT_BYTES: usize = 8 * 1024 * 1024;
const RANK: [&str; 3] = [
    "fewest_missed_correct_nudges",
    "fewest_false_nudges",
    "candidate_id",
];

fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(deserializer)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceRef {
    pub id: String,
    pub path: String,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalibrationRequestManifest {
    pub kind: String,
    pub schema_version: u64,
    pub development_manifest_sha256: String,
    pub requests_jsonl: EvidenceRef,
    pub cases: Vec<CalibrationCase>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalibrationCase {
    pub case_id: String,
    pub group_id: String,
    pub primary_request_id: String,
    #[serde(deserialize_with = "nullable")]
    pub selection_request_id: Option<String>,
    pub gold: DevelopmentGold,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DevelopmentGold {
    pub justified_nudge: bool,
    pub acceptable_reference_sets: Vec<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FitPlan {
    pub kind: String,
    pub schema_version: u64,
    pub protocol_sha256: String,
    pub development_manifest_sha256: String,
    pub holdout_manifest_sha256: String,
    pub request_manifest_sha256: String,
    pub provider: ProviderIdentity,
    pub limits: ExpertLimits,
    pub groups: Vec<CandidateGroup>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FitFamily {
    GoalDrift,
    Expertise,
    ClaimSupport,
    FailedApproach,
}

impl FitFamily {
    fn name(self) -> &'static str {
        match self {
            Self::GoalDrift => "goal-drift",
            Self::Expertise => "expertise",
            Self::ClaimSupport => "claim-support",
            Self::FailedApproach => "failed-approach",
        }
    }

    fn concern(self) -> ConcernKind {
        match self {
            Self::GoalDrift => ConcernKind::GoalDrift,
            Self::Expertise => ConcernKind::Expertise,
            Self::ClaimSupport => ConcernKind::UnsupportedClaim,
            Self::FailedApproach => ConcernKind::RepeatedApproach,
        }
    }

    fn predicate(self) -> Predicate {
        match self {
            Self::GoalDrift => Predicate::ChoiceLabel {
                label: "drift".into(),
            },
            Self::Expertise => Predicate::NoulProbability { value: true },
            Self::ClaimSupport => Predicate::NoulProbability { value: false },
            Self::FailedApproach => Predicate::ScoreTail {
                from_level: "repeating".into(),
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateGroup {
    pub group_id: String,
    pub family: FitFamily,
    pub primary_binding: String,
    #[serde(deserialize_with = "nullable")]
    pub selection_binding: Option<String>,
    pub candidates: Vec<PolicyCandidate>,
    pub objective: FitObjective,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyCandidate {
    pub candidate_id: String,
    pub primary: PolicySettings,
    #[serde(deserialize_with = "nullable")]
    pub selection: Option<PolicySettings>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FitObjective {
    pub false_nudge_max: f64,
    pub min_evaluable_coverage: f64,
    pub min_justified_opportunities: u64,
    pub min_proposed_nudges: u64,
    pub rank: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalibrationExecution {
    pub request: EvaluationRequest,
    pub response: EvaluationResponse,
    pub command_evidence: EvidenceRef,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FitSavedRequest {
    pub kind: String,
    pub schema_version: u64,
    pub protocol_evidence: EvidenceRef,
    pub plan: FitPlan,
    pub plan_evidence: EvidenceRef,
    pub request_manifest: CalibrationRequestManifest,
    pub manifest_evidence: EvidenceRef,
    pub executions: Vec<CalibrationExecution>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreflightDevelopmentRequest {
    pub kind: String,
    pub schema_version: u64,
    pub protocol_evidence: EvidenceRef,
    pub plan_evidence: EvidenceRef,
    pub manifest_evidence: EvidenceRef,
    pub runtime_config_evidence: EvidenceRef,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreflightDevelopmentResult {
    pub kind: String,
    pub schema_version: u64,
    pub protocol_sha256: String,
    pub fit_plan_sha256: String,
    pub request_manifest_sha256: String,
    pub runtime_config_sha256: String,
    pub provider_argv_sha256: String,
    pub development_manifest_sha256: String,
    pub holdout_manifest_sha256: String,
    pub request_ids: Vec<String>,
    pub referenced_files: Vec<EvidenceRef>,
    pub provider_calls: u64,
    pub delivery_attempts: u64,
}

pub struct PreflightDevelopmentInputs {
    plan: FitPlan,
    manifest: CalibrationRequestManifest,
    config: RuntimeConfig,
    config_fingerprint: String,
    context: ValidatedFitContext,
    request_ids: BTreeSet<String>,
    referenced_files: Vec<EvidenceRef>,
}

impl PreflightDevelopmentInputs {
    pub fn requests_evidence(&self) -> &EvidenceRef {
        &self.manifest.requests_jsonl
    }
}

pub struct PreflightDevelopmentCalibration {
    pub plan: FitPlan,
    pub request_manifest: CalibrationRequestManifest,
    pub requests: Vec<EvaluationRequest>,
    pub result: PreflightDevelopmentResult,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FitSavedResult {
    pub kind: String,
    pub schema_version: u64,
    pub fit_plan_sha256: String,
    pub request_manifest_sha256: String,
    pub executions_sha256: String,
    pub groups: Vec<FitGroupResult>,
    pub provider_calls: u64,
    pub delivery_attempts: u64,
    pub promotion_records: Vec<trace::PromotionRecord>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FitGroupResult {
    pub group_id: String,
    #[serde(deserialize_with = "nullable")]
    pub selected_candidate_id: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub selected_primary: Option<PolicySettings>,
    #[serde(deserialize_with = "nullable")]
    pub selected_selection: Option<PolicySettings>,
    pub status: FitStatus,
    pub candidates: Vec<CandidateScore>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FitStatus {
    Eligible,
    NoFeasibleCandidate,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateScore {
    pub candidate_id: String,
    pub results: Vec<CaseDecision>,
    pub planned: u64,
    pub evaluable: u64,
    pub proposed: u64,
    pub false_proposed: u64,
    pub justified: u64,
    pub missed_correct: u64,
    pub provider_failures: u64,
    pub feasible: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaseDecision {
    pub case_id: String,
    pub result: ExpertResult,
}

pub fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn canonical_sha256(value: &impl Serialize) -> Result<String, TraceError> {
    let value = serde_json::to_value(value).map_err(|_| TraceError::InvalidInput)?;
    let mut bytes = Vec::new();
    write_canonical(&value, &mut bytes)?;
    Ok(sha256(&bytes))
}

fn write_canonical(value: &Value, bytes: &mut Vec<u8>) -> Result<(), TraceError> {
    match value {
        Value::Array(values) => {
            bytes.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    bytes.push(b',');
                }
                write_canonical(value, bytes)?;
            }
            bytes.push(b']');
        }
        Value::Object(values) => {
            bytes.push(b'{');
            for (index, (key, value)) in values.iter().enumerate() {
                if index > 0 {
                    bytes.push(b',');
                }
                serde_json::to_writer(&mut *bytes, key).map_err(|_| TraceError::InvalidInput)?;
                bytes.push(b':');
                write_canonical(value, bytes)?;
            }
            bytes.push(b'}');
        }
        Value::Number(number) if number.is_f64() => {
            bytes.extend(python_float(number).as_bytes());
        }
        _ => serde_json::to_writer(&mut *bytes, value).map_err(|_| TraceError::InvalidInput)?,
    }
    if bytes.len() > MAX_FIT_BYTES {
        return Err(TraceError::LimitExceeded);
    }
    Ok(())
}

fn python_float(number: &serde_json::Number) -> String {
    let text = number.to_string();
    let (sign, magnitude) = text
        .strip_prefix('-')
        .map_or(("", text.as_str()), |value| ("-", value));
    let (mantissa, exponent) = magnitude.split_once('e').unwrap_or((magnitude, "0"));
    let decimal = mantissa.find('.').unwrap_or(mantissa.len());
    let digits = mantissa.replace('.', "");
    let leading = digits.bytes().take_while(|byte| *byte == b'0').count();
    let digits = digits[leading..].trim_end_matches('0');
    if digits.is_empty() {
        return format!("{sign}0.0");
    }
    let exponent = exponent.parse::<i32>().unwrap() + decimal as i32 - leading as i32 - 1;
    if !(-4..16).contains(&exponent) {
        let fraction = if digits.len() == 1 {
            String::new()
        } else {
            format!(".{}", &digits[1..])
        };
        return format!("{sign}{}{fraction}e{exponent:+03}", &digits[..1]);
    }
    let decimal = exponent + 1;
    if decimal <= 0 {
        format!("{sign}0.{}{digits}", "0".repeat(-decimal as usize))
    } else if decimal as usize >= digits.len() {
        format!(
            "{sign}{digits}{}.0",
            "0".repeat(decimal as usize - digits.len())
        )
    } else {
        format!(
            "{sign}{}.{}",
            &digits[..decimal as usize],
            &digits[decimal as usize..]
        )
    }
}

pub fn decode_fit_saved(bytes: &[u8]) -> Result<FitSavedRequest, TraceError> {
    trace::decode_json(bytes, MAX_FIT_BYTES)
}

pub fn encode_fit_result(result: &FitSavedResult) -> Result<Vec<u8>, TraceError> {
    let bytes = serde_json::to_vec(result).map_err(|_| TraceError::InvalidInput)?;
    if bytes.len() > MAX_FIT_BYTES {
        return Err(TraceError::LimitExceeded);
    }
    Ok(bytes)
}

fn require(condition: bool) -> Result<(), TraceError> {
    if condition {
        Ok(())
    } else {
        Err(TraceError::InvalidInput)
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn valid_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains(['\\', ':', '\0'])
        && !path.starts_with('/')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn validate_evidence(evidence: &EvidenceRef) -> Result<(), TraceError> {
    require(
        policy::safe_identifier(&evidence.id)
            && valid_path(&evidence.path)
            && is_sha256(&evidence.sha256),
    )
}

fn probability(value: f64) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

fn binding(value: &str) -> bool {
    policy::safe_identifier(value)
        && value.starts_with("binding::")
        && value.len() > "binding::".len()
}

fn validate_request(input: &FitSavedRequest) -> Result<(), TraceError> {
    trace::validate_selected(input)?;
    require(
        serde_json::to_vec(input)
            .map_err(|_| TraceError::InvalidInput)?
            .len()
            <= MAX_FIT_BYTES,
    )?;
    require(
        input.kind == "fit_saved_development"
            && input.schema_version == 1
            && (1..=512).contains(&input.executions.len()),
    )?;
    validate_evidence(&input.protocol_evidence)?;
    validate_evidence(&input.plan_evidence)?;
    validate_evidence(&input.manifest_evidence)?;
    let plan = &input.plan;
    let request_ids = validate_plan_manifest(plan, &input.request_manifest)?;
    let mut execution_ids = BTreeSet::new();
    for execution in &input.executions {
        let request = &execution.request;
        require(
            execution_ids.insert(request.request_id.clone())
                && execution.response.provider == plan.provider
                && request.question_fingerprint == policy::question_fingerprint(&request.judgment)
                && request.template_fingerprint == policy::template_fingerprint(&request.judgment)
                && policy::safe_identifier(&request.packet.event.task)
                && request.packet.event.task.starts_with("task::"),
        )?;
        validate_evidence(&execution.command_evidence)?;
        packet::validate_packet(&request.packet, &request.judgment, &plan.limits)
            .map_err(|_| TraceError::InvalidInput)?;
        provider::validate_response(request, execution.response.clone())
            .map_err(|_| TraceError::InvalidInput)?;
    }
    require(execution_ids == request_ids)
}

fn validate_plan_manifest(
    plan: &FitPlan,
    manifest: &CalibrationRequestManifest,
) -> Result<BTreeSet<String>, TraceError> {
    require(
        plan.kind == "typed_development_fit_plan"
            && plan.schema_version == 1
            && manifest.kind == "real_calibration_requests"
            && manifest.schema_version == 1
            && (1..=4).contains(&plan.groups.len())
            && (1..=256).contains(&manifest.cases.len())
            && [
                &plan.protocol_sha256,
                &plan.development_manifest_sha256,
                &plan.holdout_manifest_sha256,
                &plan.request_manifest_sha256,
                &manifest.development_manifest_sha256,
            ]
            .iter()
            .all(|hash| is_sha256(hash))
            && plan.development_manifest_sha256 == manifest.development_manifest_sha256
            && plan.request_manifest_sha256 == canonical_sha256(manifest)?,
    )?;
    validate_evidence(&manifest.requests_jsonl)?;
    plan.provider
        .require_mode(ExpertMode::Shadow)
        .map_err(|_| TraceError::InvalidInput)?;
    RuntimeConfig {
        limits: plan.limits.clone(),
        ..RuntimeConfig::default()
    }
    .validate()?;
    let mut groups = BTreeMap::new();
    let mut bindings = BTreeSet::new();
    for group in &plan.groups {
        require(
            policy::safe_identifier(&group.group_id)
                && groups.insert(&group.group_id, group).is_none()
                && binding(&group.primary_binding)
                && bindings.insert(&group.primary_binding)
                && group.selection_binding.is_some() == (group.family == FitFamily::Expertise)
                && (1..=64).contains(&group.candidates.len())
                && probability(group.objective.false_nudge_max)
                && probability(group.objective.min_evaluable_coverage)
                && group.objective.min_justified_opportunities > 0
                && group.objective.min_proposed_nudges > 0
                && group.objective.rank.iter().map(String::as_str).eq(RANK),
        )?;
        if let Some(selection) = &group.selection_binding {
            require(binding(selection) && bindings.insert(selection))?;
        }
        validate_candidates(group, plan)?;
    }
    let mut case_ids = BTreeSet::new();
    let mut request_ids = BTreeSet::new();
    let mut assigned_groups = BTreeSet::new();
    for case in &manifest.cases {
        let group = groups.get(&case.group_id).ok_or(TraceError::InvalidInput)?;
        require(
            policy::safe_identifier(&case.case_id)
                && case_ids.insert(case.case_id.clone())
                && policy::safe_identifier(&case.primary_request_id)
                && request_ids.insert(case.primary_request_id.clone())
                && case.selection_request_id.is_some() == (group.family == FitFamily::Expertise)
                && case.gold.acceptable_reference_sets.len() <= 8,
        )?;
        assigned_groups.insert(&case.group_id);
        if let Some(selection) = &case.selection_request_id {
            require(policy::safe_identifier(selection) && request_ids.insert(selection.clone()))?;
        }
        let mut reference_sets = BTreeSet::new();
        for references in &case.gold.acceptable_reference_sets {
            let set: BTreeSet<_> = references.iter().collect();
            require(
                (1..=4).contains(&references.len())
                    && references.iter().all(|id| policy::safe_identifier(id))
                    && set.len() == references.len()
                    && reference_sets.insert(set),
            )?;
        }
    }
    require(assigned_groups.len() == groups.len())?;
    Ok(request_ids)
}

fn validate_candidates(group: &CandidateGroup, plan: &FitPlan) -> Result<(), TraceError> {
    let baseline = &group.candidates[0];
    let varied = group.family.predicate();
    require(
        baseline
            .primary
            .rules
            .iter()
            .any(|rule| rule.predicate == varied),
    )?;
    if group.family == FitFamily::GoalDrift {
        require(group.candidates.len() == 1 && baseline.primary.calibration.thresholds.is_empty())?;
    }
    let mut ids = BTreeSet::new();
    for candidate in &group.candidates {
        require(
            policy::safe_identifier(&candidate.candidate_id)
                && ids.insert(&candidate.candidate_id)
                && candidate.primary.binding_id == group.primary_binding
                && candidate.primary.concern == group.family.concern()
                && candidate.selection == baseline.selection
                && candidate.selection.is_some() == group.selection_binding.is_some(),
        )?;
        let mut normalized = candidate.primary.clone();
        normalized.calibration.record_id = baseline.primary.calibration.record_id.clone();
        for rule in &normalized.rules {
            if rule.predicate == varied && group.family != FitFamily::GoalDrift {
                match baseline.primary.calibration.thresholds.get(&rule.id) {
                    Some(value) => {
                        normalized
                            .calibration
                            .thresholds
                            .insert(rule.id.clone(), *value);
                    }
                    None => return Err(TraceError::InvalidInput),
                }
            }
        }
        require(normalized == baseline.primary)?;
        for settings in std::iter::once(&candidate.primary).chain(candidate.selection.iter()) {
            require(
                settings.calibration.provider == plan.provider
                    && settings.calibration.development_fingerprint
                        == plan.development_manifest_sha256
                    && settings.calibration.policy_fingerprint
                        == policy::policy_fingerprint(settings),
            )?;
        }
        if let Some(selection) = &candidate.selection {
            require(
                Some(&selection.binding_id) == group.selection_binding.as_ref()
                    && selection.concern == ConcernKind::Expertise
                    && selection.calibration.thresholds.is_empty(),
            )?;
        }
    }
    Ok(())
}

fn validate_request_settings(
    request: &EvaluationRequest,
    settings: &PolicySettings,
    name: &str,
) -> Result<(), TraceError> {
    require(
        name != "expertise-selection"
            || matches!(
                request.judgment.output,
                crate::memory::knowledge::JudgmentOutput::Choice { .. }
            ),
    )?;
    require(
        request.packet.binding_id == settings.binding_id
            && request.judgment.name == name
            && settings.calibration.question_fingerprint == request.question_fingerprint
            && settings.calibration.template_fingerprint == request.template_fingerprint,
    )?;
    policy::validate_settings(settings, &request.judgment).map_err(|_| TraceError::InvalidInput)?;
    Ok(())
}

fn record_for(
    execution: &CalibrationExecution,
    settings: &PolicySettings,
    plan: &FitPlan,
    name: &str,
) -> Result<TraceRecord, TraceError> {
    let request = &execution.request;
    validate_request_settings(request, settings, name)?;
    TraceRecord::new(
        request.clone(),
        execution.response.clone(),
        settings.clone(),
        ExpertMode::Shadow,
        Provenance::Imported,
        None,
        plan.limits.clone(),
    )
}

fn score_candidate(
    input: &FitSavedRequest,
    group: &CandidateGroup,
    candidate: &PolicyCandidate,
    executions: &BTreeMap<&str, &CalibrationExecution>,
) -> Result<CandidateScore, TraceError> {
    let mut score = CandidateScore {
        candidate_id: candidate.candidate_id.clone(),
        results: vec![],
        planned: 0,
        evaluable: 0,
        proposed: 0,
        false_proposed: 0,
        justified: 0,
        missed_correct: 0,
        provider_failures: 0,
        feasible: false,
    };
    for case in input
        .request_manifest
        .cases
        .iter()
        .filter(|case| case.group_id == group.group_id)
    {
        let primary = executions[case.primary_request_id.as_str()];
        let mut record = record_for(
            primary,
            &candidate.primary,
            &input.plan,
            if group.family == FitFamily::Expertise {
                "expertise-useful"
            } else {
                group.family.name()
            },
        )?;
        score.provider_failures += u64::from(primary.response.outcome.is_err());
        if let Some(selection_id) = &case.selection_request_id {
            let execution = executions[selection_id.as_str()];
            let settings = candidate
                .selection
                .as_ref()
                .ok_or(TraceError::InvalidInput)?;
            let pair = record_for(execution, settings, &input.plan, "expertise-selection")?;
            provider::validate_batch(&EvaluationBatchRequest {
                batch_id: case.case_id.clone(),
                requests: vec![primary.request.clone(), execution.request.clone()],
            })
            .map_err(|_| TraceError::InvalidInput)?;
            record.expertise_pair = Some(Box::new(ExpertisePair {
                request: pair.request,
                response: pair.response,
                settings: pair.settings,
            }));
            trace::apply_expertise_pair(&mut record)?;
            score.provider_failures += u64::from(execution.response.outcome.is_err());
        }
        let result = record.result;
        let proposed = matches!(
            result.outcome,
            AdvisoryOutcome::Nudge | AdvisoryOutcome::Escalation
        );
        let references: BTreeSet<_> = result.references.iter().collect();
        let correct = proposed
            && case.gold.justified_nudge
            && case
                .gold
                .acceptable_reference_sets
                .iter()
                .any(|acceptable| acceptable.iter().collect::<BTreeSet<_>>() == references);
        score.planned += 1;
        score.evaluable += u64::from(result.outcome != AdvisoryOutcome::Abstain);
        score.proposed += u64::from(proposed);
        score.false_proposed += u64::from(proposed && !correct);
        score.justified += u64::from(case.gold.justified_nudge);
        score.missed_correct += u64::from(case.gold.justified_nudge && !correct);
        score.results.push(CaseDecision {
            case_id: case.case_id.clone(),
            result,
        });
    }
    let objective = &group.objective;
    score.feasible = score.planned > 0
        && score.proposed > 0
        && score.proposed >= objective.min_proposed_nudges
        && score.justified >= objective.min_justified_opportunities
        && score.false_proposed as f64 / score.proposed as f64 <= objective.false_nudge_max
        && score.evaluable as f64 / score.planned as f64 >= objective.min_evaluable_coverage;
    Ok(score)
}

fn score_groups(
    input: &FitSavedRequest,
    fit_plan_sha256: &str,
) -> Result<FitSavedResult, TraceError> {
    let executions = input
        .executions
        .iter()
        .map(|execution| (execution.request.request_id.as_str(), execution))
        .collect();
    let mut groups = Vec::new();
    for group in &input.plan.groups {
        let candidates: Vec<_> = group
            .candidates
            .iter()
            .map(|candidate| score_candidate(input, group, candidate, &executions))
            .collect::<Result<_, _>>()?;
        let selected = candidates
            .iter()
            .enumerate()
            .filter(|(_, score)| score.feasible)
            .min_by_key(|(_, score)| {
                (
                    score.missed_correct,
                    score.false_proposed,
                    &score.candidate_id,
                )
            })
            .map(|(index, _)| &group.candidates[index]);
        groups.push(FitGroupResult {
            group_id: group.group_id.clone(),
            selected_candidate_id: selected.map(|candidate| candidate.candidate_id.clone()),
            selected_primary: selected.map(|candidate| candidate.primary.clone()),
            selected_selection: selected.and_then(|candidate| candidate.selection.clone()),
            status: if selected.is_some() {
                FitStatus::Eligible
            } else {
                FitStatus::NoFeasibleCandidate
            },
            candidates,
        });
    }
    let result = FitSavedResult {
        kind: "fitted_saved_development".into(),
        schema_version: 1,
        fit_plan_sha256: fit_plan_sha256.to_owned(),
        request_manifest_sha256: canonical_sha256(&input.request_manifest)?,
        executions_sha256: canonical_sha256(&input.executions)?,
        groups,
        provider_calls: 0,
        delivery_attempts: 0,
        promotion_records: vec![],
    };
    encode_fit_result(&result)?;
    Ok(result)
}

#[derive(Clone, Debug)]
pub struct ValidatedFitContext {
    request_fingerprint: String,
    protocol_fingerprint: String,
    fit_plan_sha256: String,
    development_manifest_sha256: String,
    holdout_manifest_sha256: String,
    candidate_thresholds: Vec<f64>,
    budgets: BTreeMap<FitFamily, FitProtocolBudget>,
}

#[derive(Clone, Debug)]
struct FitProtocolBudget {
    false_nudge_max: f64,
    min_evaluable_coverage: f64,
    min_justified_opportunities: u64,
}

pub fn validate_fit_context(
    request: &FitSavedRequest,
    protocol_bytes: &[u8],
    plan_bytes: &[u8],
    manifest_bytes: &[u8],
) -> Result<ValidatedFitContext, TraceError> {
    validate_request(request)?;
    for (bytes, evidence) in [
        (protocol_bytes, &request.protocol_evidence),
        (plan_bytes, &request.plan_evidence),
        (manifest_bytes, &request.manifest_evidence),
    ] {
        if bytes.len() > MAX_FIT_BYTES {
            return Err(TraceError::LimitExceeded);
        }
        require(sha256(bytes) == evidence.sha256)?;
    }
    let plan_value: Value = trace::decode_json(plan_bytes, MAX_FIT_BYTES)?;
    let fit_plan_sha256 = canonical_sha256(&plan_value)?;
    let plan: FitPlan = serde_json::from_value(plan_value).map_err(|_| TraceError::InvalidInput)?;
    let manifest: CalibrationRequestManifest = trace::decode_json(manifest_bytes, MAX_FIT_BYTES)?;
    require(plan == request.plan && manifest == request.request_manifest)?;
    let protocol: Value = trace::decode_json(protocol_bytes, MAX_FIT_BYTES)?;
    validate_context_plan(
        &plan,
        &protocol,
        fit_plan_sha256,
        canonical_sha256(request)?,
    )
}

fn validate_context_plan(
    plan: &FitPlan,
    protocol: &Value,
    fit_plan_sha256: String,
    request_fingerprint: String,
) -> Result<ValidatedFitContext, TraceError> {
    let (candidate_thresholds, budgets) = validate_protocol(protocol)?;
    let protocol_fingerprint = canonical_sha256(protocol)?;
    let development_manifest_sha256 = protocol["datasets"]["development"]["manifest_sha256"]
        .as_str()
        .ok_or(TraceError::InvalidInput)?
        .to_owned();
    let holdout_manifest_sha256 = protocol["datasets"]["holdout"]["manifest_sha256"]
        .as_str()
        .ok_or(TraceError::InvalidInput)?
        .to_owned();
    require(
        protocol_fingerprint == plan.protocol_sha256
            && development_manifest_sha256 == plan.development_manifest_sha256
            && holdout_manifest_sha256 == plan.holdout_manifest_sha256,
    )?;
    Ok(ValidatedFitContext {
        request_fingerprint,
        protocol_fingerprint,
        fit_plan_sha256,
        development_manifest_sha256,
        holdout_manifest_sha256,
        candidate_thresholds,
        budgets,
    })
}

pub fn fit_saved(
    request: &FitSavedRequest,
    context: &ValidatedFitContext,
) -> Result<FitSavedResult, TraceError> {
    require(
        context.request_fingerprint == canonical_sha256(request)?
            && context.protocol_fingerprint == request.plan.protocol_sha256
            && context.development_manifest_sha256 == request.plan.development_manifest_sha256
            && context.holdout_manifest_sha256 == request.plan.holdout_manifest_sha256,
    )?;
    validate_protocol_candidates(&request.plan, context)?;
    score_groups(request, &context.fit_plan_sha256)
}

fn validate_protocol_candidates(
    plan: &FitPlan,
    context: &ValidatedFitContext,
) -> Result<(), TraceError> {
    for group in &plan.groups {
        let budget = context
            .budgets
            .get(&group.family)
            .ok_or(TraceError::InvalidInput)?;
        require(
            group.objective.false_nudge_max == budget.false_nudge_max
                && group.objective.min_evaluable_coverage == budget.min_evaluable_coverage
                && group.objective.min_justified_opportunities
                    == budget.min_justified_opportunities,
        )?;
        for settings in group.candidates.iter().flat_map(|candidate| {
            std::iter::once(&candidate.primary).chain(candidate.selection.iter())
        }) {
            require(
                settings
                    .calibration
                    .thresholds
                    .values()
                    .all(|value| context.candidate_thresholds.contains(value)),
            )?;
        }
    }
    Ok(())
}

pub fn preflight_development_inputs(
    input: &PreflightDevelopmentRequest,
    protocol_bytes: &[u8],
    plan_bytes: &[u8],
    manifest_bytes: &[u8],
    runtime_config_bytes: &[u8],
) -> Result<PreflightDevelopmentInputs, TraceError> {
    trace::validate_selected(input)?;
    require(input.kind == "preflight_development_calibration" && input.schema_version == 1)?;
    let mut referenced_files = Vec::new();
    for (bytes, evidence) in [
        (protocol_bytes, &input.protocol_evidence),
        (plan_bytes, &input.plan_evidence),
        (manifest_bytes, &input.manifest_evidence),
        (runtime_config_bytes, &input.runtime_config_evidence),
    ] {
        validate_evidence(evidence)?;
        if bytes.len() > MAX_FIT_BYTES {
            return Err(TraceError::LimitExceeded);
        }
        require(sha256(bytes) == evidence.sha256)?;
        referenced_files.push(evidence.clone());
    }
    let protocol: Value = trace::decode_json(protocol_bytes, MAX_FIT_BYTES)?;
    let plan_value: Value = trace::decode_json(plan_bytes, MAX_FIT_BYTES)?;
    let plan: FitPlan =
        serde_json::from_value(plan_value.clone()).map_err(|_| TraceError::InvalidInput)?;
    let manifest: CalibrationRequestManifest = trace::decode_json(manifest_bytes, MAX_FIT_BYTES)?;
    let config_value: Value = trace::decode_json(runtime_config_bytes, trace::MAX_CONFIG_BYTES)?;
    let config: RuntimeConfig =
        serde_json::from_value(config_value.clone()).map_err(|_| TraceError::InvalidInput)?;
    let request_ids = validate_plan_manifest(&plan, &manifest)?;
    let context = validate_context_plan(
        &plan,
        &protocol,
        canonical_sha256(&plan_value)?,
        String::new(),
    )?;
    validate_protocol_candidates(&plan, &context)?;
    config.validate()?;
    let provider = config.provider.as_ref().ok_or(TraceError::InvalidInput)?;
    require(
        config.mode == ExpertMode::Shadow
            && config.promotions.is_empty()
            && provider.identity == plan.provider
            && config.limits == plan.limits,
    )?;
    for settings in &config.policies {
        require(plan.groups.iter().any(|group| {
            group.candidates.iter().any(|candidate| {
                &candidate.primary == settings || candidate.selection.as_ref() == Some(settings)
            })
        }))?;
    }
    Ok(PreflightDevelopmentInputs {
        plan,
        manifest,
        config,
        config_fingerprint: canonical_sha256(&config_value)?,
        context,
        request_ids,
        referenced_files,
    })
}

pub fn preflight_development_calibration(
    inputs: PreflightDevelopmentInputs,
    requests_bytes: &[u8],
) -> Result<PreflightDevelopmentCalibration, TraceError> {
    let PreflightDevelopmentInputs {
        plan,
        manifest,
        config,
        config_fingerprint,
        context,
        request_ids,
        mut referenced_files,
    } = inputs;
    let provider = config.provider.as_ref().ok_or(TraceError::InvalidInput)?;
    if requests_bytes.len() > MAX_FIT_BYTES {
        return Err(TraceError::LimitExceeded);
    }
    require(sha256(requests_bytes) == manifest.requests_jsonl.sha256)?;
    referenced_files.push(manifest.requests_jsonl.clone());
    let mut requests = Vec::new();
    let mut seen = BTreeSet::new();
    for line in requests_bytes.split_inclusive(|byte| *byte == b'\n') {
        require(line.last() == Some(&b'\n') && requests.len() < 512)?;
        let request: EvaluationRequest = trace::decode_json(line, trace::MAX_EVENT_BYTES)?;
        require(
            seen.insert(request.request_id.clone())
                && request.question_fingerprint == policy::question_fingerprint(&request.judgment)
                && request.template_fingerprint == policy::template_fingerprint(&request.judgment)
                && policy::safe_identifier(&request.packet.event.task)
                && request.packet.event.task.starts_with("task::")
                && plan
                    .provider
                    .supported_outputs
                    .contains(&provider::OutputKind::from(&request.judgment.output)),
        )?;
        packet::validate_packet(&request.packet, &request.judgment, &plan.limits)
            .map_err(|_| TraceError::InvalidInput)?;
        requests.push(request);
    }
    require(seen == request_ids)?;
    let by_id: BTreeMap<_, _> = requests
        .iter()
        .map(|request| (&request.request_id, request))
        .collect();
    for case in &manifest.cases {
        let group = plan
            .groups
            .iter()
            .find(|group| group.group_id == case.group_id)
            .ok_or(TraceError::InvalidInput)?;
        let primary = by_id[&case.primary_request_id];
        require(
            case.gold
                .acceptable_reference_sets
                .iter()
                .flatten()
                .all(|identity| policy::reference_resolves(&primary.packet, identity)),
        )?;
        for candidate in &group.candidates {
            validate_request_settings(
                primary,
                &candidate.primary,
                if group.family == FitFamily::Expertise {
                    "expertise-useful"
                } else {
                    group.family.name()
                },
            )?;
            if let Some(selection_id) = &case.selection_request_id {
                let selection = by_id[selection_id];
                validate_request_settings(
                    selection,
                    candidate
                        .selection
                        .as_ref()
                        .ok_or(TraceError::InvalidInput)?,
                    "expertise-selection",
                )?;
                provider::validate_batch(&EvaluationBatchRequest {
                    batch_id: case.case_id.clone(),
                    requests: vec![primary.clone(), selection.clone()],
                })
                .map_err(|_| TraceError::InvalidInput)?;
            }
        }
    }
    referenced_files.sort_by(|a, b| (&a.path, &a.id).cmp(&(&b.path, &b.id)));
    let result = PreflightDevelopmentResult {
        kind: "preflighted_development_calibration".into(),
        schema_version: 1,
        protocol_sha256: context.protocol_fingerprint,
        fit_plan_sha256: context.fit_plan_sha256,
        request_manifest_sha256: canonical_sha256(&manifest)?,
        runtime_config_sha256: config_fingerprint,
        provider_argv_sha256: canonical_sha256(&provider.argv)?,
        development_manifest_sha256: context.development_manifest_sha256,
        holdout_manifest_sha256: context.holdout_manifest_sha256,
        request_ids: requests
            .iter()
            .map(|request| request.request_id.clone())
            .collect(),
        referenced_files,
        provider_calls: 0,
        delivery_attempts: 0,
    };
    Ok(PreflightDevelopmentCalibration {
        plan,
        request_manifest: manifest,
        requests,
        result,
    })
}

fn exact_fields(value: &Value, fields: &[&str]) -> Result<(), TraceError> {
    let object = value.as_object().ok_or(TraceError::InvalidInput)?;
    require(object.len() == fields.len() && fields.iter().all(|field| object.contains_key(*field)))
}

fn text_fields(value: &Value, fields: &[&str]) -> Result<(), TraceError> {
    require(fields.iter().all(|field| value[*field].as_str().is_some()))
}

fn bool_fields(value: &Value, fields: &[&str]) -> Result<(), TraceError> {
    require(fields.iter().all(|field| value[*field].is_boolean()))
}

fn protocol_number(value: &Value, min: f64, max: f64) -> Result<f64, TraceError> {
    let number = value.as_f64().ok_or(TraceError::InvalidInput)?;
    require(number.is_finite() && number >= min && number <= max)?;
    Ok(number)
}

fn protocol_positive(value: &Value) -> Result<u64, TraceError> {
    let number = value.as_u64().ok_or(TraceError::InvalidInput)?;
    require(number > 0)?;
    Ok(number)
}

fn validate_protocol(
    protocol: &Value,
) -> Result<(Vec<f64>, BTreeMap<FitFamily, FitProtocolBudget>), TraceError> {
    exact_fields(
        protocol,
        &[
            "schema_version",
            "protocol_id",
            "status",
            "approved_by",
            "approved_utc",
            "evidence_kind",
            "datasets",
            "budgets",
            "quality_interval",
            "latency_quantile",
            "calibration",
            "budget_rationale",
            "host",
            "pilot",
            "expanded",
            "promotion",
        ],
    )?;
    text_fields(
        protocol,
        &[
            "protocol_id",
            "status",
            "approved_by",
            "approved_utc",
            "evidence_kind",
            "latency_quantile",
        ],
    )?;
    require(
        protocol["schema_version"].as_u64() == Some(1)
            && protocol["status"] == "frozen"
            && protocol["approved_by"]
                .as_str()
                .is_some_and(|value| !value.trim().is_empty())
            && protocol["latency_quantile"] == "nearest-rank",
    )?;
    exact_fields(&protocol["datasets"], &["development", "holdout"])?;
    for split in ["development", "holdout"] {
        let dataset = &protocol["datasets"][split];
        exact_fields(dataset, &["manifest_sha256"])?;
        require(dataset["manifest_sha256"].as_str().is_some_and(is_sha256))?;
    }
    let families = [
        FitFamily::GoalDrift,
        FitFamily::Expertise,
        FitFamily::ClaimSupport,
        FitFamily::FailedApproach,
    ];
    exact_fields(&protocol["budgets"], &families.map(FitFamily::name))?;
    let mut budgets = BTreeMap::new();
    for family in families {
        let value = &protocol["budgets"][family.name()];
        exact_fields(
            value,
            &[
                "false_nudge_max",
                "p95_delivery_ms",
                "min_delivered_nudges",
                "min_justified_opportunities",
                "min_evaluable_coverage",
            ],
        )?;
        protocol_number(&value["p95_delivery_ms"], 1.0, f64::MAX)?;
        protocol_positive(&value["min_delivered_nudges"])?;
        budgets.insert(
            family,
            FitProtocolBudget {
                false_nudge_max: protocol_number(&value["false_nudge_max"], 0.0, 1.0)?,
                min_evaluable_coverage: protocol_number(
                    &value["min_evaluable_coverage"],
                    0.0,
                    1.0,
                )?,
                min_justified_opportunities: protocol_positive(
                    &value["min_justified_opportunities"],
                )?,
            },
        );
    }
    let calibration = &protocol["calibration"];
    exact_fields(
        calibration,
        &[
            "allowed_split",
            "candidate_thresholds",
            "signal",
            "holdout_access",
        ],
    )?;
    text_fields(calibration, &["signal"])?;
    require(
        calibration["allowed_split"] == "development" && calibration["holdout_access"] == false,
    )?;
    let thresholds = calibration["candidate_thresholds"]
        .as_array()
        .ok_or(TraceError::InvalidInput)?
        .iter()
        .map(|value| protocol_number(value, 0.0, 1.0))
        .collect::<Result<Vec<_>, _>>()?;
    let interval = &protocol["quality_interval"];
    exact_fields(
        interval,
        &[
            "method",
            "confidence",
            "zero_denominator",
            "ungraded_nudges",
        ],
    )?;
    text_fields(interval, &["method", "zero_denominator", "ungraded_nudges"])?;
    require(interval["method"] == "exact-one-sided-clopper-pearson")?;
    protocol_number(&interval["confidence"], 0.5, 0.999999)?;
    let rationale = &protocol["budget_rationale"];
    exact_fields(
        rationale,
        &[
            "false_nudge",
            "latency",
            "timing_evidence_kind",
            "timing_evidence_sha256",
        ],
    )?;
    text_fields(
        rationale,
        &[
            "false_nudge",
            "latency",
            "timing_evidence_kind",
            "timing_evidence_sha256",
        ],
    )?;
    let host = &protocol["host"];
    exact_fields(
        host,
        &[
            "status",
            "capabilities",
            "stop_reason",
            "evidence_path",
            "evidence_sha256",
        ],
    )?;
    text_fields(host, &["status"])?;
    for name in ["stop_reason", "evidence_path", "evidence_sha256"] {
        require(host[name].is_string() || host[name].is_null())?;
    }
    let _: super::HostCapabilities = serde_json::from_value(host["capabilities"].clone())
        .map_err(|_| TraceError::InvalidInput)?;
    let pilot = &protocol["pilot"];
    exact_fields(
        pilot,
        &[
            "phase",
            "task_id",
            "task",
            "arms",
            "order",
            "runs_per_arm",
            "max_wall_ms",
            "call_limit_per_arm",
            "cost_limit_per_arm",
            "snapshot_files",
            "controls",
            "grading",
            "stop_reasons",
            "promotion_eligible",
        ],
    )?;
    text_fields(pilot, &["phase", "task_id", "task"])?;
    let arms = serde_json::json!(["off", "shadow", "advisory"]);
    require(
        pilot["arms"] == arms
            && pilot["order"] == arms
            && pilot["runs_per_arm"].as_u64() == Some(1)
            && pilot["promotion_eligible"] == false
            && pilot["call_limit_per_arm"].as_u64().is_some(),
    )?;
    protocol_number(&pilot["max_wall_ms"], 1.0, 600000.0)?;
    protocol_number(&pilot["cost_limit_per_arm"], 0.0, f64::MAX)?;
    let snapshot = pilot["snapshot_files"]
        .as_object()
        .ok_or(TraceError::InvalidInput)?;
    require(
        snapshot
            .iter()
            .all(|(path, digest)| valid_path(path) && digest.as_str().is_some_and(is_sha256)),
    )?;
    require(
        pilot["stop_reasons"]
            .as_array()
            .is_some_and(|reasons| reasons.iter().all(Value::is_string)),
    )?;
    let controls = &[
        "worker",
        "tools",
        "host",
        "onboarding",
        "rules",
        "environment",
    ];
    exact_fields(&pilot["controls"], controls)?;
    text_fields(&pilot["controls"], controls)?;
    let grading = &[
        "correctness",
        "scope",
        "owner_interventions",
        "steering_ms",
        "rework_ms",
        "acknowledgment",
    ];
    exact_fields(&pilot["grading"], grading)?;
    text_fields(&pilot["grading"], grading)?;
    let expanded = &protocol["expanded"];
    exact_fields(expanded, &["status", "stop_reason", "promotion_eligible"])?;
    text_fields(expanded, &["status"])?;
    require(expanded["stop_reason"].is_string() || expanded["stop_reason"].is_null())?;
    bool_fields(expanded, &["promotion_eligible"])?;
    let promotion = &protocol["promotion"];
    exact_fields(
        promotion,
        &[
            "required_evidence_kind",
            "requires_independent_correctness_and_scope",
            "requires_observed_steering_reduction",
            "replay_fixture_pilot_allowed",
        ],
    )?;
    text_fields(promotion, &["required_evidence_kind"])?;
    bool_fields(
        promotion,
        &[
            "requires_independent_correctness_and_scope",
            "requires_observed_steering_reduction",
            "replay_fixture_pilot_allowed",
        ],
    )?;
    Ok((thresholds, budgets))
}

pub fn validate_frozen_protocol(protocol: &Value) -> Result<(), TraceError> {
    validate_protocol(protocol).map(|_| ())
}
