use super::packet::{self, ContextValue};
use super::policy::{self, AdvisoryOutcome, ExpertResult, PolicySettings};
use super::provider::{
    self, EvaluationRequest, EvaluationResponse, ProviderIdentity, ProviderUsage,
};
use super::{
    DeliveryState, EventStamp, ExpertLimits, ExpertMode, HostCapabilities, InterventionSummary,
    ObservedEvent, ObservedFact, SourceKind,
};
use crate::memory::{self, knowledge, process};
use crate::project::{self, Project, task};
use crate::runtime::strict_json::StrictValue;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{File, OpenOptions, TryLockError};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const MAX_TRACE_BYTES: usize = 262_144;
pub const MAX_CONFIG_BYTES: usize = 65_536;
pub const MAX_EVENT_BYTES: usize = 65_536;
const MAX_LEDGER_BYTES: usize = 4_194_304;
const MAX_INDEX_ENTRIES: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provenance {
    Imported,
    LocalCheckpoint,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TraceLimits {
    pub retention_days: u64,
    pub payload_bytes: usize,
    pub unresolved_per_task: usize,
}
impl Default for TraceLimits {
    fn default() -> Self {
        Self {
            retention_days: 7,
            payload_bytes: 16_777_216,
            unresolved_per_task: 64,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrozenBudget {
    pub false_nudge_max: f64,
    pub p95_delivery_ms: u64,
    pub min_held_out_delivered: usize,
    pub min_justified_opportunities: usize,
    pub min_evaluable_coverage: f64,
    pub confidence_level: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HeldOutSummary {
    pub delivered_nudges: usize,
    pub false_nudges: usize,
    pub justified_opportunities: usize,
    pub missed_opportunities: usize,
    pub evaluable_checkpoints: usize,
    pub planned_checkpoints: usize,
    pub quality_upper_bound: Option<f64>,
    pub p95_delivery_ms: Option<f64>,
    pub complete: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromotionEvidenceKind {
    MatchedLiveExpanded,
    Replay,
    Synthetic,
    Pilot,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PromotionRecord {
    pub record_id: String,
    pub evidence_kind: PromotionEvidenceKind,
    pub protocol_fingerprint: String,
    pub holdout_fingerprint: String,
    pub matched_snapshot_fingerprint: String,
    pub calibration_fingerprint: String,
    pub provider: ProviderIdentity,
    pub host: HostCapabilities,
    pub binding_id: String,
    pub question_fingerprint: String,
    pub template_fingerprint: String,
    pub policy_fingerprint: String,
    pub implementation_fingerprint: String,
    pub budget: FrozenBudget,
    pub held_out: HeldOutSummary,
    pub matched_live_passed: bool,
    pub observed_steering_passed: bool,
    pub evidence_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfiguredProvider {
    pub identity: ProviderIdentity,
    pub argv: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeConfig {
    pub mode: ExpertMode,
    pub provider: Option<ConfiguredProvider>,
    pub host: Option<HostCapabilities>,
    pub policies: Vec<PolicySettings>,
    pub limits: ExpertLimits,
    pub trace_limits: TraceLimits,
    pub promotions: Vec<PromotionRecord>,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            mode: ExpertMode::Shadow,
            provider: None,
            host: None,
            policies: vec![],
            limits: ExpertLimits::default(),
            trace_limits: TraceLimits::default(),
            promotions: vec![],
        }
    }
}

impl RuntimeConfig {
    pub fn validate(&self) -> Result<(), TraceError> {
        validate_selected(self)?;
        let limits = &self.limits;
        if limits.packet_bytes == 0
            || limits.packet_bytes > 16384
            || limits.excerpt_bytes == 0
            || limits.excerpt_bytes > 2048
            || limits.history_entries > 8
            || !(1..=4).contains(&limits.judgments_per_checkpoint)
            || !(1..=60000).contains(&limits.request_timeout_ms)
            || limits.concurrency != 1
            || limits.retries > 1
            || limits.deliveries_per_checkpoint != 1
            || self.trace_limits.retention_days > 365
            || self.trace_limits.payload_bytes > 16_777_216
            || !(1..=64).contains(&self.trace_limits.unresolved_per_task)
            || self.policies.len() > 64
            || self.promotions.len() > 64
        {
            return Err(TraceError::InvalidInput);
        }
        if let Some(provider) = &self.provider
            && (provider.argv.is_empty()
                || provider.argv.len() > 32
                || provider
                    .argv
                    .iter()
                    .any(|arg| arg.len() > 2048 || packet::redact(arg) != *arg)
                || provider.identity.require_mode(ExpertMode::Shadow).is_err())
        {
            return Err(TraceError::InvalidInput);
        }
        let mut bindings = BTreeSet::new();
        if self
            .policies
            .iter()
            .any(|settings| !bindings.insert(&settings.binding_id))
        {
            return Err(TraceError::InvalidInput);
        }
        if serde_json::to_vec(self)
            .map_err(|_| TraceError::InvalidInput)?
            .len()
            > MAX_CONFIG_BYTES
        {
            return Err(TraceError::LimitExceeded);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostReceiptState {
    Delivered,
    Acknowledged,
    Declined,
    Unknown,
    NotDelivered,
}
impl HostReceiptState {
    fn matches(self, state: DeliveryState) -> bool {
        matches!(
            (self, state),
            (Self::Delivered, DeliveryState::Delivered)
                | (Self::Acknowledged, DeliveryState::Acknowledged)
                | (Self::Declined, DeliveryState::Declined)
                | (Self::Unknown, DeliveryState::Unknown)
                | (Self::NotDelivered, DeliveryState::Proposed)
        )
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostReceiptObservation {
    pub request_id: String,
    pub idempotency_key: String,
    pub state: HostReceiptState,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    pub state: DeliveryState,
    pub evidence: String,
    pub checkpoint_id: String,
    pub unix_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TraceRecord {
    pub request: EvaluationRequest,
    pub response: EvaluationResponse,
    pub settings: PolicySettings,
    pub result: ExpertResult,
    pub mode: ExpertMode,
    pub provenance: Provenance,
    pub local_batch_id: Option<String>,
    pub limits: ExpertLimits,
    pub implementation_fingerprints: BTreeMap<String, String>,
    pub suppression_reasons: Vec<String>,
    pub receipts: Vec<Receipt>,
    pub runtime_fingerprint: Option<String>,
    pub expertise_pair: Option<Box<ExpertisePair>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpertisePair {
    pub request: EvaluationRequest,
    pub response: EvaluationResponse,
    pub settings: PolicySettings,
}

pub fn deterministic_result(
    request: &EvaluationRequest,
    provenance: Provenance,
) -> Option<ExpertResult> {
    if provenance != Provenance::LocalCheckpoint {
        return None;
    }
    let packet = &request.packet;
    let failure = packet
        .context
        .get(&super::ContextSlot::Evidence)
        .into_iter()
        .flat_map(ContextValue::observations)
        .filter(|observation| {
            observation.capture == "local:task-evidence"
                && observation.kind == SourceKind::DeterministicOutput
        })
        .scan(BTreeSet::new(), |seen, observation| {
            let current = match &observation.fact {
                Some(ObservedFact::CommandExit { argv, exit })
                    if seen.insert(packet::digest(argv)) =>
                {
                    *exit != 0
                }
                _ => false,
            };
            Some((observation, current))
        })
        .find(|(_, failed)| *failed)
        .map(|(observation, _)| observation.id.clone());
    let task_blocked = packet.context.get(&super::ContextSlot::Task).into_iter().flat_map(ContextValue::observations).any(|observation| {
        observation.capture == "local:task-record" && (matches!(&observation.fact, Some(ObservedFact::TaskState { state, .. }) if state == "blocked") || serde_json::from_str::<serde_json::Value>(&observation.text).ok().and_then(|value| value.get("unresolved_findings").and_then(serde_json::Value::as_array).map(|findings| !findings.is_empty())).unwrap_or(false))
    });
    if failure.is_none() && !task_blocked {
        return None;
    }
    let (template, references) = if let Some(reference) = failure.filter(|_| {
        request
            .judgment
            .templates
            .contains(&super::TemplateKind::CiteEvidence)
    }) {
        (Some(super::TemplateKind::CiteEvidence), vec![reference])
    } else if request
        .judgment
        .templates
        .contains(&super::TemplateKind::AskOwner)
    {
        (
            Some(super::TemplateKind::AskOwner),
            vec![packet.event.task.clone()],
        )
    } else {
        (None, vec![])
    };
    let mut result = policy::outcome(
        request,
        AdvisoryOutcome::Escalation,
        "deterministic_blocker",
    );
    result.template = template;
    result.references = references;
    if let Ok(message) = policy::render(&result, packet) {
        result.message = Some(message);
    } else {
        result = policy::outcome(request, AdvisoryOutcome::Abstain, "deterministic_blocker");
    }
    Some(result)
}

fn base_result(record: &TraceRecord) -> ExpertResult {
    deterministic_result(&record.request, record.provenance).unwrap_or_else(|| {
        policy::decide(
            &record.request,
            &record.response,
            &record.settings,
            &record.request.packet.history,
        )
    })
}

pub fn record_priority(record: &TraceRecord) -> (policy::ConcernKind, &str) {
    (
        if record.result.reason == "deterministic_blocker" {
            policy::ConcernKind::DeterministicBlocker
        } else {
            record.settings.concern
        },
        &record.settings.binding_id,
    )
}

impl TraceRecord {
    pub fn new(
        mut request: EvaluationRequest,
        mut response: EvaluationResponse,
        settings: PolicySettings,
        mode: ExpertMode,
        provenance: Provenance,
        local_batch_id: Option<String>,
        limits: ExpertLimits,
    ) -> Result<Self, TraceError> {
        clean_response(&mut response);
        validate_selected(&request)?;
        validate_selected(&response)?;
        validate_selected(&settings)?;
        packet::validate_packet(&request.packet, &request.judgment, &limits)
            .map_err(|_| TraceError::InvalidInput)?;
        let response = provider::validate_response(&request, response)
            .map_err(|_| TraceError::InvalidInput)?;
        request.packet.accounting.provider_tokens = response.usage.input_tokens;
        policy::validate_settings(&settings, &request.judgment)
            .map_err(|_| TraceError::InvalidInput)?;
        let mut result = deterministic_result(&request, provenance).unwrap_or_else(|| {
            policy::decide(&request, &response, &settings, &request.packet.history)
        });
        let missing_pair = request.judgment.name == "expertise-useful";
        if missing_pair {
            result = policy::outcome(&request, AdvisoryOutcome::Abstain, "expertise_pair_missing");
        }
        Ok(Self {
            request,
            response,
            settings,
            result,
            mode,
            provenance,
            local_batch_id,
            limits,
            implementation_fingerprints: implementation_fingerprints(),
            suppression_reasons: if missing_pair {
                vec!["expertise_pair_missing".into()]
            } else {
                vec![]
            },
            receipts: vec![],
            runtime_fingerprint: None,
            expertise_pair: None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TraceError {
    InvalidInput,
    LimitExceeded,
    Io,
    Missing,
    Conflict,
    Stale,
    LedgerExhausted,
}
impl std::fmt::Display for TraceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for TraceError {}
impl From<io::Error> for TraceError {
    fn from(_: io::Error) -> Self {
        Self::Io
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayError {
    InvalidRecord,
    ImplementationMismatch,
    DecisionMismatch,
}
impl std::fmt::Display for ReplayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for ReplayError {}

pub fn implementation_fingerprints() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("policy".into(), packet::digest(&include_str!("policy.rs"))),
        (
            "templates".into(),
            packet::digest(&policy::template_implementation()),
        ),
        ("packet".into(), packet::digest(&include_str!("packet.rs"))),
        (
            "provider".into(),
            packet::digest(&include_str!("provider.rs")),
        ),
        ("trace".into(), packet::digest(&include_str!("trace.rs"))),
    ])
}

pub fn validate_selected(value: &impl Serialize) -> Result<(), TraceError> {
    let value = serde_json::to_value(value).map_err(|_| TraceError::InvalidInput)?;
    fn check(value: &serde_json::Value, depth: usize) -> bool {
        if depth > 32 {
            return false;
        }
        match value {
            serde_json::Value::String(text) => text.len() <= 2048 && packet::redact(text) == *text,
            serde_json::Value::Array(values) => {
                values.len() <= 16384 && values.iter().all(|value| check(value, depth + 1))
            }
            serde_json::Value::Object(values) => {
                values.len() <= 16384
                    && values.iter().all(|(key, value)| {
                        key.len() <= 2048 && packet::redact(key) == *key && check(value, depth + 1)
                    })
            }
            _ => true,
        }
    }
    if check(&value, 0) {
        Ok(())
    } else {
        Err(TraceError::InvalidInput)
    }
}

fn reject_symlink(path: &Path) -> Result<(), TraceError> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(TraceError::InvalidInput),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(TraceError::Io),
    }
}

pub fn decode_json<T: DeserializeOwned>(bytes: &[u8], max: usize) -> Result<T, TraceError> {
    if bytes.len() > max {
        return Err(TraceError::LimitExceeded);
    }
    let StrictValue(value) = serde_json::from_slice(bytes).map_err(|_| TraceError::InvalidInput)?;
    validate_selected(&value)?;
    serde_json::from_value(value).map_err(|_| TraceError::InvalidInput)
}

pub fn read_json<T: DeserializeOwned>(path: &Path, max: usize) -> Result<T, TraceError> {
    reject_symlink(path)?;
    if !std::fs::metadata(path)?.is_file() {
        return Err(TraceError::InvalidInput);
    }
    let file = File::open(path)?;
    if file.metadata()?.len() > max as u64 {
        return Err(TraceError::LimitExceeded);
    }
    let mut bytes = Vec::new();
    file.take(max as u64 + 1).read_to_end(&mut bytes)?;
    decode_json(&bytes, max)
}

fn clean_response(response: &mut EvaluationResponse) {
    for text in [
        &mut response.self_report,
        &mut response.diagnostic,
        &mut response.provider_request_id,
    ]
    .into_iter()
    .flatten()
    {
        *text = packet::bounded(text, 2048).0;
    }
}

pub fn replay(record: &TraceRecord) -> Result<ExpertResult, ReplayError> {
    validate_selected(record).map_err(|_| ReplayError::InvalidRecord)?;
    if record.implementation_fingerprints != implementation_fingerprints() {
        return Err(ReplayError::ImplementationMismatch);
    }
    if serde_json::to_vec(record)
        .map_err(|_| ReplayError::InvalidRecord)?
        .len()
        > MAX_TRACE_BYTES
        || record.receipts.len() > 64
        || record.suppression_reasons.len() > 8
        || packet::validate_packet(
            &record.request.packet,
            &record.request.judgment,
            &record.limits,
        )
        .is_err()
        || provider::validate_response(&record.request, record.response.clone()).is_err()
    {
        return Err(ReplayError::InvalidRecord);
    }
    let mut result = base_result(record);
    if let Some(pair) = &record.expertise_pair {
        result = expertise_result(record, pair)?;
    }
    for reason in &record.suppression_reasons {
        let outcome = match reason.as_str() {
            "unresolved_concern" | "checkpoint_budget" => AdvisoryOutcome::Silence,
            "stale_revision"
            | "stale_checkpoint"
            | "ledger_exhausted"
            | "expertise_pair_missing" => AdvisoryOutcome::Abstain,
            _ => return Err(ReplayError::InvalidRecord),
        };
        result = policy::outcome(&record.request, outcome, reason);
    }
    if result != record.result {
        return Err(ReplayError::DecisionMismatch);
    }
    Ok(result)
}

fn expertise_result(
    record: &TraceRecord,
    pair: &ExpertisePair,
) -> Result<ExpertResult, ReplayError> {
    if packet::validate_packet(&pair.request.packet, &pair.request.judgment, &record.limits)
        .is_err()
        || pair.request.question_fingerprint != policy::question_fingerprint(&pair.request.judgment)
        || pair.request.template_fingerprint != policy::template_fingerprint(&pair.request.judgment)
        || record.settings.concern != policy::ConcernKind::Expertise
        || pair.settings.concern != policy::ConcernKind::Expertise
        || pair.response.provider != record.response.provider
        || record.request.judgment.name != "expertise-useful"
        || pair.request.judgment.name != "expertise-selection"
        || provider::validate_batch(&provider::EvaluationBatchRequest {
            batch_id: record
                .local_batch_id
                .clone()
                .unwrap_or_else(|| "pair".into()),
            requests: vec![record.request.clone(), pair.request.clone()],
        })
        .is_err()
        || provider::validate_response(&pair.request, pair.response.clone()).is_err()
        || policy::validate_settings(&pair.settings, &pair.request.judgment).is_err()
    {
        return Err(ReplayError::InvalidRecord);
    }
    let useful = base_result(record);
    if useful.reason == "deterministic_blocker" {
        return Ok(useful);
    }
    if !matches!(
        useful.outcome,
        AdvisoryOutcome::Nudge | AdvisoryOutcome::Escalation
    ) {
        return Ok(useful);
    }
    let calibration = &pair.settings.calibration;
    if calibration.provider != pair.response.provider
        || calibration.question_fingerprint != pair.request.question_fingerprint
        || calibration.template_fingerprint != pair.request.template_fingerprint
        || calibration.policy_fingerprint != policy::policy_fingerprint(&pair.settings)
    {
        return Ok(policy::outcome(
            &record.request,
            AdvisoryOutcome::Abstain,
            "calibration_mismatch",
        ));
    }
    let Ok(provider::TypedAnswer::Choice { pick, .. }) = &pair.response.outcome else {
        return Ok(policy::outcome(
            &record.request,
            AdvisoryOutcome::Abstain,
            "expertise_selection_failed",
        ));
    };
    if pick == "none" {
        return Ok(policy::outcome(
            &record.request,
            AdvisoryOutcome::Silence,
            "expertise_none",
        ));
    }
    let target = pair
        .request
        .packet
        .context
        .get(&super::ContextSlot::Candidates)
        .and_then(|value| {
            value
                .observations()
                .iter()
                .find(|observation| observation.text.starts_with(&format!("{pick}: ")))
        })
        .map(|observation| observation.id.clone());
    let Some(target) = target.filter(|id| record.request.packet.references.contains_key(id)) else {
        return Ok(policy::outcome(
            &record.request,
            AdvisoryOutcome::Abstain,
            "unknown_reference",
        ));
    };
    let mut result = useful;
    result.references = vec![target];
    result.message = Some(
        policy::render(&result, &record.request.packet).map_err(|_| ReplayError::InvalidRecord)?,
    );
    Ok(result)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TraceEntry {
    pub request_id: String,
    pub run_id: String,
    pub task: String,
    pub file: String,
    pub created_unix_ms: u64,
    pub bytes: usize,
    pub payload_omitted: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureRecord {
    pub event: EventStamp,
    pub binding_id: Option<String>,
    pub reason: String,
    pub provider_calls: usize,
    pub mode: ExpertMode,
}

pub fn validate_event_structure(event: &ObservedEvent) -> Result<(), TraceError> {
    let stamp = EventStamp::from(event);
    if event.sequence == 0
        || (event.sequence == 1 && event.previous_sequence.is_some())
        || event
            .previous_sequence
            .is_some_and(|previous| previous >= event.sequence)
        || [
            &stamp.event_id,
            &stamp.run_id,
            &stamp.task,
            &stamp.checkpoint_id,
            &stamp.host.host,
            &stamp.host.version,
            &stamp.host.adapter,
        ]
        .iter()
        .any(|text| text.trim().is_empty() || text.len() > 256 || packet::redact(text) != ***text)
        || !stamp.host.checkpoints.contains(&stamp.kind)
        || stamp.host.checkpoints.len() > 6
        || stamp.host.gaps.len() > 8
        || stamp
            .host
            .gaps
            .iter()
            .any(|text| text.trim().is_empty() || text.len() > 256 || packet::redact(text) != *text)
        || event.observations.len() > 32
        || serde_json::to_vec(event)
            .map_err(|_| TraceError::InvalidInput)?
            .len()
            > MAX_EVENT_BYTES
    {
        return Err(TraceError::InvalidInput);
    }
    Ok(())
}

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TraceIndex {
    entries: Vec<TraceEntry>,
    omitted_payloads: u64,
    omitted_bytes: u64,
    captures: Vec<CaptureRecord>,
    omitted_captures: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CorrectiveState {
    paths: String,
    facts: String,
    action: Option<String>,
}

fn corrective_state(packet: &packet::ExpertPacket, concern: &str) -> CorrectiveState {
    let mut facts = BTreeMap::new();
    for observation in packet
        .context
        .get(&super::ContextSlot::Evidence)
        .into_iter()
        .flat_map(ContextValue::observations)
    {
        if observation.capture == "local:task-evidence"
            && let Some(ObservedFact::CommandExit { argv, exit }) = &observation.fact
        {
            facts.entry(packet::digest(argv)).or_insert(*exit);
        }
    }
    let action_slot = if concern == "unsupported_claim" {
        super::ContextSlot::Claim
    } else {
        super::ContextSlot::Proposal
    };
    let action = packet.context.get(&action_slot).and_then(|value| {
        if let ContextValue::Present { observations } = value {
            let actions = observations
                .iter()
                .filter(|observation| {
                    observation.capture != "host:receipt"
                        && matches!(
                            observation.kind,
                            SourceKind::HostObservation | SourceKind::WorkerStatement
                        )
                })
                .map(|observation| &observation.text)
                .collect::<BTreeSet<_>>();
            if !actions.is_empty() {
                return Some(packet::digest(&actions));
            }
        }
        None
    });
    CorrectiveState {
        paths: packet::digest(&packet.revision.paths),
        facts: packet::digest(&facts),
        action,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SuppressionEntry {
    request_id: String,
    run_id: String,
    task: String,
    acceptance_epoch: u64,
    binding_id: String,
    relevant_revision: String,
    material_revision: String,
    concern: String,
    target: String,
    checkpoint_id: String,
    state: DeliveryState,
    idempotency_key: String,
    reserved_unix_ms: u64,
    receipts: Vec<Receipt>,
    no_delivery_verified: bool,
    corrective_state: CorrectiveState,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Ledger {
    entries: BTreeMap<String, SuppressionEntry>,
    checkpoints: BTreeMap<String, ObservedEvent>,
    blocked_checkpoints: BTreeSet<String>,
}

pub struct TraceStore {
    root: PathBuf,
    limits: TraceLimits,
}
struct StoreLock(File);
impl Drop for StoreLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn atomic_write(path: &Path, value: &impl Serialize, max: usize) -> Result<(), TraceError> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    validate_selected(value)?;
    reject_symlink(path)?;
    let bytes = serde_json::to_vec(value).map_err(|_| TraceError::InvalidInput)?;
    if bytes.len() > max {
        return Err(TraceError::LimitExceeded);
    }
    let directory = path.parent().ok_or(TraceError::InvalidInput)?;
    std::fs::create_dir_all(directory)?;
    let temporary = directory.join(format!(
        ".{}-{}-{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .ok_or(TraceError::InvalidInput)?,
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

impl TraceStore {
    pub fn new(root: &Path, limits: TraceLimits) -> Result<Self, TraceError> {
        if limits.retention_days > 365
            || limits.payload_bytes > 16_777_216
            || !(1..=64).contains(&limits.unresolved_per_task)
        {
            return Err(TraceError::InvalidInput);
        }
        let store = Self {
            root: root.to_path_buf(),
            limits,
        };
        store.ensure_storage()?;
        Ok(store)
    }
    fn directory(&self) -> PathBuf {
        self.root.join(".blabla/expert")
    }
    fn ensure_storage(&self) -> Result<(), TraceError> {
        for path in [
            self.root.join(".blabla"),
            self.directory(),
            self.directory().join("traces"),
            self.directory().join(".store.lock"),
            self.directory().join("index.json"),
            self.directory().join("ledger.json"),
            self.directory().join("runtime.json"),
        ] {
            reject_symlink(&path)?;
        }
        Ok(())
    }
    fn effective_limits(&self) -> Result<TraceLimits, TraceError> {
        if self.directory().join("runtime.json").exists() {
            let config = self.runtime()?;
            config.validate()?;
            Ok(config.trace_limits)
        } else {
            Ok(self.limits.clone())
        }
    }
    fn lock(&self) -> Result<StoreLock, TraceError> {
        self.ensure_storage()?;
        std::fs::create_dir_all(self.directory())?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.directory().join(".store.lock"))?;
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match file.try_lock() {
                Ok(()) => return Ok(StoreLock(file)),
                Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10))
                }
                _ => return Err(TraceError::Io),
            }
        }
    }
    fn index(&self) -> Result<TraceIndex, TraceError> {
        let path = self.directory().join("index.json");
        if !path.exists() {
            return Ok(TraceIndex::default());
        }
        let index: TraceIndex = read_json(&path, MAX_LEDGER_BYTES)?;
        if index.entries.len() > MAX_INDEX_ENTRIES
            || index.captures.len() > 256
            || index.entries.iter().any(|entry| {
                entry.bytes > MAX_TRACE_BYTES
                    || !policy::safe_identifier(&entry.request_id)
                    || !policy::safe_identifier(&entry.run_id)
                    || !policy::safe_identifier(&entry.task)
                    || self
                        .trace_path(&entry.request_id)
                        .file_name()
                        .and_then(|name| name.to_str())
                        != Some(entry.file.as_str())
            })
        {
            return Err(TraceError::LimitExceeded);
        }
        Ok(index)
    }
    fn ledger(&self) -> Result<Ledger, TraceError> {
        let path = self.directory().join("ledger.json");
        if !path.exists() {
            return Ok(Ledger::default());
        }
        let ledger: Ledger = read_json(&path, MAX_LEDGER_BYTES)?;
        if ledger.entries.len() > 16384
            || ledger.checkpoints.len() > 256
            || ledger.blocked_checkpoints.len() > 256
        {
            return Err(TraceError::LimitExceeded);
        }
        Ok(ledger)
    }
    fn save_ledger(&self, ledger: &Ledger) -> Result<(), TraceError> {
        atomic_write(
            &self.directory().join("ledger.json"),
            ledger,
            MAX_LEDGER_BYTES,
        )
    }
    fn rewrite(&self, record: &TraceRecord) -> Result<(), TraceError> {
        atomic_write(
            &self.trace_path(&record.request.request_id),
            record,
            MAX_TRACE_BYTES,
        )?;
        let mut index = self.index()?;
        self.retain(&mut index)?;
        atomic_write(
            &self.directory().join("index.json"),
            &index,
            MAX_LEDGER_BYTES,
        )
    }
    fn trace_path(&self, id: &str) -> PathBuf {
        self.directory()
            .join("traces")
            .join(format!("{}.json", packet::digest(&("trace", id))))
    }
    pub fn set_runtime(&self, config: &RuntimeConfig) -> Result<(), TraceError> {
        config.validate()?;
        let _lock = self.lock()?;
        atomic_write(
            &self.directory().join("runtime.json"),
            config,
            MAX_CONFIG_BYTES,
        )
    }
    pub fn runtime(&self) -> Result<RuntimeConfig, TraceError> {
        self.ensure_storage()?;
        read_json(&self.directory().join("runtime.json"), MAX_CONFIG_BYTES)
    }
    pub fn record(&self, record: &TraceRecord) -> Result<(), TraceError> {
        replay(record).map_err(|_| TraceError::InvalidInput)?;
        let _lock = self.lock()?;
        let mut clean = record.clone();
        clean_response(&mut clean.response);
        if let Some(pair) = &mut clean.expertise_pair {
            clean_response(&mut pair.response);
        }
        let mut index = self.index()?;
        if index
            .entries
            .iter()
            .any(|entry| entry.request_id == record.request.request_id)
        {
            return Err(TraceError::Conflict);
        }
        let path = self.trace_path(&record.request.request_id);
        atomic_write(&path, &clean, MAX_TRACE_BYTES)?;
        let bytes = std::fs::metadata(&path)?.len() as usize;
        index.entries.push(TraceEntry {
            request_id: record.request.request_id.clone(),
            run_id: record.request.packet.event.run_id.clone(),
            task: record.request.packet.event.task.clone(),
            file: path.file_name().unwrap().to_str().unwrap().into(),
            created_unix_ms: now_ms(),
            bytes,
            payload_omitted: false,
        });
        self.retain(&mut index)?;
        atomic_write(
            &self.directory().join("index.json"),
            &index,
            MAX_LEDGER_BYTES,
        )
    }
    fn retain(&self, index: &mut TraceIndex) -> Result<(), TraceError> {
        let limits = self.effective_limits()?;
        for entry in &mut index.entries {
            if !entry.payload_omitted {
                let path = self.trace_path(&entry.request_id);
                reject_symlink(&path)?;
                entry.bytes = usize::try_from(std::fs::metadata(path)?.len())
                    .map_err(|_| TraceError::LimitExceeded)?;
                if entry.bytes > MAX_TRACE_BYTES {
                    return Err(TraceError::LimitExceeded);
                }
            }
        }
        index.entries.sort_by(|a, b| {
            (a.created_unix_ms, &a.request_id).cmp(&(b.created_unix_ms, &b.request_id))
        });
        let cutoff = now_ms().saturating_sub(limits.retention_days.saturating_mul(86_400_000));
        let mut total: usize = index
            .entries
            .iter()
            .filter(|entry| !entry.payload_omitted)
            .map(|entry| entry.bytes)
            .try_fold(0usize, usize::checked_add)
            .ok_or(TraceError::LimitExceeded)?;
        for entry in &mut index.entries {
            if !entry.payload_omitted
                && (entry.created_unix_ms < cutoff || total > limits.payload_bytes)
            {
                std::fs::remove_file(self.trace_path(&entry.request_id))?;
                entry.payload_omitted = true;
                total = total.saturating_sub(entry.bytes);
                index.omitted_payloads = index.omitted_payloads.saturating_add(1);
                index.omitted_bytes = index.omitted_bytes.saturating_add(entry.bytes as u64);
            }
        }
        while index.entries.len() > MAX_INDEX_ENTRIES {
            if index.entries[0].payload_omitted {
                index.entries.remove(0);
            } else {
                return Err(TraceError::LimitExceeded);
            }
        }
        Ok(())
    }
    pub fn capture(
        &self,
        event: &ObservedEvent,
        binding_id: Option<String>,
        reason: &str,
    ) -> Result<(), TraceError> {
        validate_event_structure(event)?;
        if !policy::safe_identifier(reason)
            || binding_id
                .as_ref()
                .is_some_and(|id| !policy::safe_identifier(id))
        {
            return Err(TraceError::InvalidInput);
        }
        let _lock = self.lock()?;
        let mut index = self.index()?;
        if matches!(
            reason,
            "host_observation_gaps"
                | "event_sequence_gap"
                | "stale_checkpoint"
                | "ledger_exhausted"
        ) {
            let mut ledger = self.ledger()?;
            let key = packet::digest(&(&event.run_id, &event.task));
            if (ledger.checkpoints.contains_key(&key) || ledger.checkpoints.len() < 256)
                && ledger
                    .checkpoints
                    .get(&key)
                    .is_none_or(|previous| event.sequence >= previous.sequence)
            {
                let mut captured = event.clone();
                captured.observations.clear();
                ledger.checkpoints.insert(key.clone(), captured);
                ledger.blocked_checkpoints.insert(key);
                self.save_ledger(&ledger)?;
            }
        }
        index.captures.push(CaptureRecord {
            event: EventStamp::from(event),
            binding_id,
            reason: reason.into(),
            provider_calls: 0,
            mode: ExpertMode::Shadow,
        });
        if index.captures.len() > 256 {
            index.captures.remove(0);
            index.omitted_captures = index.omitted_captures.saturating_add(1);
        }
        self.retain(&mut index)?;
        atomic_write(
            &self.directory().join("index.json"),
            &index,
            MAX_LEDGER_BYTES,
        )
    }
    pub fn captures(&self) -> Result<Vec<CaptureRecord>, TraceError> {
        let _lock = self.lock()?;
        Ok(self.index()?.captures)
    }
    pub fn traces(&self) -> Result<Vec<TraceEntry>, TraceError> {
        let _lock = self.lock()?;
        let mut index = self.index()?;
        self.retain(&mut index)?;
        atomic_write(
            &self.directory().join("index.json"),
            &index,
            MAX_LEDGER_BYTES,
        )?;
        Ok(index.entries)
    }
    pub fn read(&self, request_id: &str) -> Result<TraceRecord, TraceError> {
        self.ensure_storage()?;
        if !policy::safe_identifier(request_id) {
            return Err(TraceError::InvalidInput);
        }
        read_json(&self.trace_path(request_id), MAX_TRACE_BYTES)
    }
    pub fn delete_run(&self, run_id: &str) -> Result<usize, TraceError> {
        if !policy::safe_identifier(run_id) {
            return Err(TraceError::InvalidInput);
        }
        let _lock = self.lock()?;
        let mut index = self.index()?;
        let mut deleted = 0;
        for entry in &mut index.entries {
            if entry.run_id == run_id && !entry.payload_omitted {
                std::fs::remove_file(self.trace_path(&entry.request_id))?;
                entry.payload_omitted = true;
                index.omitted_payloads = index.omitted_payloads.saturating_add(1);
                index.omitted_bytes = index.omitted_bytes.saturating_add(entry.bytes as u64);
                deleted += 1;
            }
        }
        atomic_write(
            &self.directory().join("index.json"),
            &index,
            MAX_LEDGER_BYTES,
        )?;
        Ok(deleted)
    }
    pub fn advance_checkpoint(&self, event: &ObservedEvent) -> Result<(), TraceError> {
        packet::validate_event(&EventStamp::from(event)).map_err(|_| TraceError::InvalidInput)?;
        if event.observations.len() > 32
            || event.observations.iter().any(|observation| {
                !policy::safe_identifier(&observation.id)
                    || observation.capture.len() > 256
                    || packet::redact(&observation.capture) != observation.capture
                    || observation
                        .capture
                        .to_ascii_lowercase()
                        .starts_with("local:")
                    || observation
                        .capture
                        .to_ascii_lowercase()
                        .contains("transcript")
                    || observation
                        .capture
                        .to_ascii_lowercase()
                        .contains("session-store")
                    || observation.kind == SourceKind::DeterministicOutput
                    || observation.fact.is_some()
                    || observation.observed_revision.len() > 256
                    || packet::redact(&observation.observed_revision)
                        != observation.observed_revision
                    || observation.text.len() > 2048
            })
            || serde_json::to_vec(event)
                .map_err(|_| TraceError::InvalidInput)?
                .len()
                > MAX_EVENT_BYTES
        {
            return Err(TraceError::LimitExceeded);
        }
        let _lock = self.lock()?;
        let mut ledger = self.ledger()?;
        let key = packet::digest(&(&event.run_id, &event.task));
        if let Some(previous) = ledger.checkpoints.get(&key) {
            if (ledger.blocked_checkpoints.contains(&key) && event.sequence <= previous.sequence)
                || event.sequence < previous.sequence
                || (event.sequence == previous.sequence && event != previous)
                || (event.sequence > previous.sequence
                    && event.previous_sequence != Some(previous.sequence))
            {
                return Err(TraceError::Stale);
            }
        } else if event.sequence != 1 {
            return Err(TraceError::Stale);
        }
        if !ledger.checkpoints.contains_key(&key) && ledger.checkpoints.len() >= 256 {
            return Err(TraceError::LedgerExhausted);
        }
        let mut event = event.clone();
        for observation in &mut event.observations {
            observation.text = packet::bounded(&observation.text, 2048).0;
            observation.fact = None;
        }
        ledger.blocked_checkpoints.remove(&key);
        ledger.checkpoints.insert(key, event);
        self.save_ledger(&ledger)
    }
    pub fn history(
        &self,
        task_id: &str,
        acceptance_epoch: u64,
    ) -> Result<Vec<InterventionSummary>, TraceError> {
        let _lock = self.lock()?;
        let ledger = self.ledger()?;
        let mut entries = ledger
            .entries
            .iter()
            .filter(|(_, entry)| {
                entry.task == task_id
                    && entry.acceptance_epoch == acceptance_epoch
                    && !entry.no_delivery_verified
            })
            .collect::<Vec<_>>();
        entries.sort_unstable_by(|(key_a, a), (key_b, b)| {
            (a.reserved_unix_ms, key_a).cmp(&(b.reserved_unix_ms, key_b))
        });
        Ok(entries
            .into_iter()
            .map(|(_, entry)| InterventionSummary {
                request_id: entry.request_id.clone(),
                concern: entry.concern.clone(),
                target: entry.target.clone(),
                state: entry.state,
                evidence_revision: entry.material_revision.clone(),
            })
            .collect())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeliveryProposal {
    pub request_id: String,
    pub idempotency_key: Option<String>,
    pub state: DeliveryState,
    pub result: ExpertResult,
}

fn event_from_packet(packet: &packet::ExpertPacket) -> ObservedEvent {
    let stamp = &packet.event;
    ObservedEvent {
        event_id: stamp.event_id.clone(),
        run_id: stamp.run_id.clone(),
        task: stamp.task.clone(),
        checkpoint_id: stamp.checkpoint_id.clone(),
        sequence: stamp.sequence,
        previous_sequence: stamp.previous_sequence,
        unix_ms: stamp.unix_ms,
        kind: stamp.kind,
        host: stamp.host.clone(),
        observations: packet
            .context
            .values()
            .flat_map(ContextValue::observations)
            .filter(|observation| !observation.capture.starts_with("local:"))
            .cloned()
            .collect(),
    }
}

pub fn definitions(
    project: &Project,
) -> Result<(Vec<knowledge::Judgment>, Vec<process::JudgmentBinding>), TraceError> {
    let entries = project
        .manifest
        .knowledge
        .iter()
        .map(|entry| (entry.path.as_path(), entry.display.as_str()))
        .collect::<Vec<_>>();
    let knowledge = memory::read_all(&entries, knowledge::build, knowledge::validate);
    let entry = project
        .manifest
        .process
        .as_ref()
        .ok_or(TraceError::InvalidInput)?;
    let process = memory::read(
        &entry.path,
        &entry.display,
        process::build,
        process::validate,
    );
    Ok((
        knowledge
            .present()
            .ok_or(TraceError::InvalidInput)?
            .judgments
            .clone(),
        process
            .present()
            .ok_or(TraceError::InvalidInput)?
            .bindings
            .clone(),
    ))
}

fn rebuild(project: &Project, record: &TraceRecord) -> Result<packet::ExpertPacket, TraceError> {
    let task_name = record
        .request
        .packet
        .event
        .task
        .strip_prefix("task::")
        .ok_or(TraceError::InvalidInput)?;
    let task = task::read(&project.manifest.root, task_name)
        .map_err(|_| TraceError::Io)?
        .ok_or(TraceError::Missing)?;
    if !task.open() || task.state != "accepted" {
        return Err(TraceError::Stale);
    }
    let (judgments, bindings) = definitions(project)?;
    let binding = bindings
        .iter()
        .find(|binding| binding.id() == record.request.packet.binding_id)
        .ok_or(TraceError::Stale)?;
    if judgments
        .iter()
        .find(|judgment| judgment.id() == binding.judgment)
        != Some(&record.request.judgment)
    {
        return Err(TraceError::Stale);
    }
    project::expert::build_packet(
        project,
        &task,
        &event_from_packet(&record.request.packet),
        binding,
        &record.limits,
        &record.request.packet.history,
    )
    .map_err(|_| TraceError::Stale)
}

fn selected_revision_matches(current: &packet::ExpertPacket, record: &TraceRecord) -> bool {
    current.revision == record.request.packet.revision && current.hash == record.request.packet.hash
}
pub fn current_revision_matches(project: &Project, record: &TraceRecord) -> bool {
    rebuild(project, record).is_ok_and(|current| selected_revision_matches(&current, record))
}

impl TraceStore {
    pub fn reserve(
        &self,
        request_id: &str,
        checkpoint: &str,
        project: &Project,
    ) -> Result<DeliveryProposal, TraceError> {
        let _task_lock = task::store::lock(&self.root).map_err(|_| TraceError::Io)?;
        let _lock = self.lock()?;
        let mut record = self.read(request_id)?;
        let mut ledger = self.ledger()?;
        let reject = |record: &TraceRecord, reason: &str, state| DeliveryProposal {
            request_id: request_id.into(),
            idempotency_key: None,
            state,
            result: policy::outcome(&record.request, AdvisoryOutcome::Abstain, reason),
        };
        if record.provenance != Provenance::LocalCheckpoint {
            return Ok(reject(
                &record,
                "untrusted_provenance",
                DeliveryState::Proposed,
            ));
        }
        let config = self.runtime()?;
        config.validate()?;
        if config.mode != ExpertMode::Advisory || record.mode != ExpertMode::Advisory {
            return Ok(reject(&record, "shadow_mode", DeliveryState::Proposed));
        }
        if config.limits != record.limits
            || config
                .policies
                .iter()
                .find(|settings| settings.binding_id == record.settings.binding_id)
                != Some(&record.settings)
            || record.runtime_fingerprint.as_ref() != Some(&packet::digest(&config))
        {
            return Ok(reject(&record, "runtime_changed", DeliveryState::Stale));
        }
        if replay(&record).is_err() {
            return Ok(reject(&record, "invalid_record", DeliveryState::Stale));
        }
        if !matches!(
            record.result.outcome,
            AdvisoryOutcome::Nudge | AdvisoryOutcome::Escalation
        ) {
            return Ok(DeliveryProposal {
                request_id: request_id.into(),
                idempotency_key: None,
                state: DeliveryState::Proposed,
                result: record.result,
            });
        }
        let current = match rebuild(project, &record) {
            Ok(packet) => packet,
            Err(_) => {
                record.suppression_reasons.push("stale_revision".into());
                record.result =
                    policy::outcome(&record.request, AdvisoryOutcome::Abstain, "stale_revision");
                self.rewrite(&record)?;
                return Ok(reject(&record, "stale_revision", DeliveryState::Stale));
            }
        };
        if !selected_revision_matches(&current, &record) {
            record.suppression_reasons.push("stale_revision".into());
            record.result =
                policy::outcome(&record.request, AdvisoryOutcome::Abstain, "stale_revision");
            self.rewrite(&record)?;
            return Ok(reject(&record, "stale_revision", DeliveryState::Stale));
        }
        let event = &record.request.packet.event;
        let key = packet::digest(&(&event.run_id, &event.task));
        if checkpoint != event.checkpoint_id
            || ledger.blocked_checkpoints.contains(&key)
            || ledger
                .checkpoints
                .get(&key)
                .is_none_or(|current| EventStamp::from(current) != *event)
        {
            record.suppression_reasons.push("stale_checkpoint".into());
            record.result = policy::outcome(
                &record.request,
                AdvisoryOutcome::Abstain,
                "stale_checkpoint",
            );
            self.rewrite(&record)?;
            return Ok(reject(&record, "stale_checkpoint", DeliveryState::Stale));
        }
        if !promotion_matches(&config, &record, &current) {
            return Ok(reject(
                &record,
                "promotion_required",
                DeliveryState::Proposed,
            ));
        }
        let target = policy::concern_target(&current, &record.result);
        let material = policy::material_fingerprint(&current);
        let concern = record.settings.concern.code();
        let idempotency_key = packet::digest(&(
            "blabla.expert.delivery.v1",
            &event.task,
            current.revision.acceptance_epoch,
            &current.binding_id,
            current.revision.fingerprint(),
            &material,
            concern,
            &target,
        ));
        if ledger.entries.values().any(|entry| {
            !entry.no_delivery_verified
                && entry.state == DeliveryState::Unknown
                && entry.task == event.task
                && entry.concern == concern
                && entry.target == target
                && entry.request_id != request_id
        }) {
            return Ok(reject(
                &record,
                "uncertain_delivery",
                DeliveryState::Unknown,
            ));
        }
        if ledger.entries.values().any(|entry| {
            !entry.no_delivery_verified
                && entry.task == event.task
                && entry.acceptance_epoch == current.revision.acceptance_epoch
                && ((entry.concern == concern
                    && entry.target == target
                    && entry.material_revision == material)
                    || (entry.run_id == event.run_id && entry.checkpoint_id == event.checkpoint_id))
        }) {
            return Ok(reject(
                &record,
                "duplicate_delivery",
                DeliveryState::Unknown,
            ));
        }
        if ledger
            .entries
            .values()
            .filter(|entry| {
                entry.task == event.task
                    && entry.state != DeliveryState::ObservedResolved
                    && !entry.no_delivery_verified
            })
            .count()
            >= config.trace_limits.unresolved_per_task
        {
            return Ok(reject(&record, "ledger_exhausted", DeliveryState::Proposed));
        }
        let original_key = idempotency_key;
        let mut idempotency_key = original_key.clone();
        let mut attempt = 0usize;
        while ledger.entries.contains_key(&idempotency_key) {
            if attempt >= ledger.entries.len() {
                return Err(TraceError::LedgerExhausted);
            }
            attempt += 1;
            idempotency_key =
                packet::digest(&("blabla.expert.delivery.attempt.v1", &original_key, attempt));
        }
        ledger.entries.insert(
            idempotency_key.clone(),
            SuppressionEntry {
                request_id: request_id.into(),
                run_id: event.run_id.clone(),
                task: event.task.clone(),
                acceptance_epoch: current.revision.acceptance_epoch,
                binding_id: current.binding_id.clone(),
                relevant_revision: current.revision.fingerprint(),
                material_revision: material,
                concern: concern.into(),
                target,
                checkpoint_id: event.checkpoint_id.clone(),
                state: DeliveryState::Unknown,
                idempotency_key: idempotency_key.clone(),
                reserved_unix_ms: now_ms(),
                receipts: vec![],
                no_delivery_verified: false,
                corrective_state: corrective_state(&current, concern),
            },
        );
        self.save_ledger(&ledger)?;
        Ok(DeliveryProposal {
            request_id: request_id.into(),
            idempotency_key: Some(idempotency_key),
            state: DeliveryState::Unknown,
            result: record.result,
        })
    }
    pub fn receipt(
        &self,
        request_id: &str,
        state: DeliveryState,
        evidence: &str,
        project: &Project,
    ) -> Result<Receipt, TraceError> {
        if !policy::safe_identifier(evidence) {
            return Err(TraceError::InvalidInput);
        }
        let _task_lock = task::store::lock(&self.root).map_err(|_| TraceError::Io)?;
        let _lock = self.lock()?;
        let mut ledger = self.ledger()?;
        let entry = ledger
            .entries
            .values()
            .find(|entry| entry.request_id == request_id)
            .cloned()
            .ok_or(TraceError::Missing)?;
        let checkpoint = ledger
            .checkpoints
            .get(&packet::digest(&(&entry.run_id, &entry.task)))
            .ok_or(TraceError::Stale)?;
        let host_evidence = checkpoint
            .observations
            .iter()
            .filter(|observation| {
                observation.id == evidence
                    && observation.kind == SourceKind::HostObservation
                    && !observation.capture.starts_with("local:")
            })
            .any(|observation| {
                let Ok(receipt) =
                    decode_json::<HostReceiptObservation>(observation.text.as_bytes(), 2048)
                else {
                    return false;
                };
                receipt.request_id == request_id
                    && receipt.idempotency_key == entry.idempotency_key
                    && receipt.state.matches(state)
            });
        let config = self.runtime()?;
        if config.host.as_ref() != Some(&checkpoint.host) {
            return Err(TraceError::InvalidInput);
        }
        if state == DeliveryState::ObservedResolved {
            let task_name = entry
                .task
                .strip_prefix("task::")
                .ok_or(TraceError::InvalidInput)?;
            let task = task::read(&self.root, task_name)
                .map_err(|_| TraceError::Io)?
                .ok_or(TraceError::Missing)?;
            let index = evidence
                .strip_prefix(&format!("evidence::{task_name}::"))
                .and_then(|index| index.parse::<usize>().ok())
                .and_then(|index| index.checked_sub(1))
                .ok_or(TraceError::InvalidInput)?;
            let observed = task.evidence.get(index).ok_or(TraceError::InvalidInput)?;
            let tree = project::snapshot(&self.root, &project.ignore);
            if observed.exit != 0
                || observed.tool != "run"
                || observed.unix.saturating_mul(1000) < entry.reserved_unix_ms.saturating_sub(1000)
                || !task::evidence_matches(&task, observed)
                || observed.inputs != task::evidence_inputs(&task, &tree)
                || !matches!((&observed.identity, &observed.command), (Some(task::CheckIdentity::Argv { argv }), Some(command)) if argv == command)
            {
                return Err(TraceError::InvalidInput);
            }
            let record = self.read(request_id)?;
            let current = rebuild(project, &record)?;
            let corrective = corrective_state(&current, &entry.concern);
            if corrective.paths == entry.corrective_state.paths
                && corrective.facts == entry.corrective_state.facts
                && (corrective.action.is_none()
                    || corrective.action == entry.corrective_state.action)
            {
                return Err(TraceError::InvalidInput);
            }
        } else if !matches!(
            state,
            DeliveryState::Delivered
                | DeliveryState::Acknowledged
                | DeliveryState::Declined
                | DeliveryState::Unknown
                | DeliveryState::Proposed
        ) || !host_evidence
        {
            return Err(TraceError::InvalidInput);
        }
        if entry.receipts.len() >= 64 {
            return Err(TraceError::LimitExceeded);
        }
        if entry.state == DeliveryState::ObservedResolved {
            return Err(TraceError::Conflict);
        }
        let receipt = Receipt {
            state,
            evidence: evidence.into(),
            checkpoint_id: checkpoint.checkpoint_id.clone(),
            unix_ms: now_ms(),
        };
        let stored = ledger.entries.get_mut(&entry.idempotency_key).unwrap();
        stored.state = state;
        stored.no_delivery_verified = state == DeliveryState::Proposed;
        stored.receipts.push(receipt.clone());
        self.save_ledger(&ledger)?;
        if let Ok(mut record) = self.read(request_id) {
            record.receipts.push(receipt.clone());
            self.rewrite(&record)?;
        }
        Ok(receipt)
    }
    pub fn cleanup_terminal(&self, task_name: &str) -> Result<usize, TraceError> {
        let _task_lock = task::store::lock(&self.root).map_err(|_| TraceError::Io)?;
        let task = task::read(&self.root, task_name)
            .map_err(|_| TraceError::Io)?
            .ok_or(TraceError::Missing)?;
        if task.open() {
            return Err(TraceError::Conflict);
        }
        let _lock = self.lock()?;
        let mut ledger = self.ledger()?;
        let before = ledger.entries.len();
        let id = format!("task::{task_name}");
        ledger.entries.retain(|_, entry| entry.task != id);
        let checkpoint_keys = ledger
            .checkpoints
            .iter()
            .filter(|(_, event)| event.task == id)
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        ledger.checkpoints.retain(|_, event| event.task != id);
        ledger
            .blocked_checkpoints
            .retain(|key| !checkpoint_keys.contains(key));
        self.save_ledger(&ledger)?;
        Ok(before - ledger.entries.len())
    }
}

pub fn promotion_matches(
    config: &RuntimeConfig,
    record: &TraceRecord,
    packet: &packet::ExpertPacket,
) -> bool {
    let provider = &record.response.provider;
    if provider.require_mode(ExpertMode::Advisory).is_err()
        || config
            .provider
            .as_ref()
            .is_none_or(|configured| configured.identity != *provider)
        || config.host.as_ref() != Some(&packet.event.host)
        || !packet.event.host.pauses_worker
        || !packet.event.host.same_task_delivery
        || !packet.event.host.delivery_receipts
        || !packet.event.host.gaps.is_empty()
    {
        return false;
    }
    config.promotions.iter().any(|promotion| {
        let budget = &promotion.budget;
        let expected_false = if record.settings.concern == policy::ConcernKind::Expertise {
            0.1
        } else {
            0.05
        };
        let expected_latency = if matches!(
            record.settings.concern,
            policy::ConcernKind::GoalDrift | policy::ConcernKind::Expertise
        ) {
            3000
        } else {
            1500
        };
        let min_delivered = if record.settings.concern == policy::ConcernKind::Expertise {
            30
        } else {
            60
        };
        let summary = &promotion.held_out;
        promotion.evidence_kind == PromotionEvidenceKind::MatchedLiveExpanded
            && promotion.matched_live_passed
            && promotion.observed_steering_passed
            && promotion.provider == *provider
            && promotion.host == packet.event.host
            && promotion.binding_id == packet.binding_id
            && promotion.question_fingerprint == record.request.question_fingerprint
            && promotion.template_fingerprint == record.request.template_fingerprint
            && promotion.policy_fingerprint == policy::policy_fingerprint(&record.settings)
            && promotion.calibration_fingerprint == packet::digest(&record.settings.calibration)
            && promotion.implementation_fingerprint
                == packet::digest(&record.implementation_fingerprints)
            && promotion.matched_snapshot_fingerprint == packet.revision.fingerprint()
            && [
                &promotion.record_id,
                &promotion.protocol_fingerprint,
                &promotion.holdout_fingerprint,
            ]
            .iter()
            .all(|id| policy::safe_identifier(id))
            && budget.false_nudge_max == expected_false
            && budget.p95_delivery_ms == expected_latency
            && budget.min_held_out_delivered == min_delivered
            && budget.min_justified_opportunities == 20
            && budget.min_evaluable_coverage == 0.9
            && budget.confidence_level == 0.95
            && summary.complete
            && summary.delivered_nudges >= min_delivered
            && summary.delivered_nudges <= 10000
            && summary.false_nudges <= summary.delivered_nudges
            && summary.justified_opportunities >= 20
            && summary.missed_opportunities <= summary.justified_opportunities
            && summary.planned_checkpoints > 0
            && summary.evaluable_checkpoints <= summary.planned_checkpoints
            && summary.evaluable_checkpoints as f64 / summary.planned_checkpoints as f64 >= 0.9
            && summary.quality_upper_bound.is_some_and(|upper| {
                upper.is_finite()
                    && upper <= expected_false
                    && (upper - quality_upper_bound(summary.false_nudges, summary.delivered_nudges))
                        .abs()
                        <= 1e-9
            })
            && summary.p95_delivery_ms.is_some_and(|latency| {
                latency.is_finite() && latency >= 0.0 && latency <= expected_latency as f64
            })
            && !promotion.evidence_ids.is_empty()
            && promotion.evidence_ids.len() <= 8
            && promotion.evidence_ids.iter().all(|id| {
                packet
                    .context
                    .values()
                    .flat_map(ContextValue::observations)
                    .any(|observation| {
                        observation.id == *id
                            && observation.capture == "local:task-evidence"
                            && matches!(
                                observation.fact,
                                Some(ObservedFact::CommandExit { exit: 0, .. })
                            )
                    })
            })
    })
}

pub fn quality_upper_bound(false_nudges: usize, delivered: usize) -> f64 {
    if delivered == 0 || false_nudges >= delivered {
        return 1.0;
    }
    let mut low = false_nudges as f64 / delivered as f64;
    let mut high = 1.0;
    for _ in 0..64 {
        let p = (low + high) / 2.0;
        let mut log_term = delivered as f64 * (-p).ln_1p();
        let mut cdf = log_term.exp();
        for k in 1..=false_nudges {
            log_term += ((delivered - k + 1) as f64).ln() - (k as f64).ln() + p.ln() - (-p).ln_1p();
            cdf += log_term.exp();
        }
        if cdf > 0.05 {
            low = p;
        } else {
            high = p;
        }
    }
    high
}

pub fn aggregate_usage(records: &[TraceRecord]) -> ProviderUsage {
    let mut batches = BTreeSet::new();
    let mut input = Some(0usize);
    let mut output = Some(0usize);
    let mut latency = Some(0.0);
    for record in records {
        if let Some(batch) = &record.local_batch_id {
            let key = packet::digest(&(
                batch,
                &record.response.provider,
                &record.response.provider_request_id,
            ));
            if !batches.insert(key) {
                continue;
            }
        }
        input = input
            .zip(record.response.usage.input_tokens)
            .and_then(|(a, b)| a.checked_add(b));
        output = output
            .zip(record.response.usage.output_tokens)
            .and_then(|(a, b)| a.checked_add(b));
        latency = latency
            .zip(record.response.usage.reported_latency_ms)
            .map(|(a, b)| a + b)
            .filter(|value| value.is_finite());
    }
    ProviderUsage {
        input_tokens: input,
        output_tokens: output,
        reported_latency_ms: latency,
    }
}

pub fn suppress(record: &mut TraceRecord, reason: &str) {
    let outcome = if matches!(reason, "unresolved_concern" | "checkpoint_budget") {
        AdvisoryOutcome::Silence
    } else {
        AdvisoryOutcome::Abstain
    };
    if !record
        .suppression_reasons
        .iter()
        .any(|saved| saved == reason)
    {
        record.suppression_reasons.push(reason.into());
    }
    record.result = policy::outcome(&record.request, outcome, reason);
}

pub fn apply_expertise_pair(record: &mut TraceRecord) -> Result<(), TraceError> {
    let pair = record
        .expertise_pair
        .as_ref()
        .ok_or(TraceError::InvalidInput)?;
    let result = expertise_result(record, pair).map_err(|_| TraceError::InvalidInput)?;
    record
        .suppression_reasons
        .retain(|reason| reason != "expertise_pair_missing");
    record.result = result;
    Ok(())
}

pub fn check_current(
    project: &Project,
    record: &mut TraceRecord,
    store: &TraceStore,
) -> Result<(), TraceError> {
    let _task_lock = task::store::lock(&project.manifest.root).map_err(|_| TraceError::Io)?;
    let _lock = store.lock()?;
    match rebuild(project, record) {
        Ok(current) if selected_revision_matches(&current, record) => (),
        _ => {
            suppress(record, "stale_revision");
            return Ok(());
        }
    }
    let event = &record.request.packet.event;
    let ledger = store.ledger()?;
    if ledger
        .blocked_checkpoints
        .contains(&packet::digest(&(&event.run_id, &event.task)))
        || ledger
            .checkpoints
            .get(&packet::digest(&(&event.run_id, &event.task)))
            .is_none_or(|current| EventStamp::from(current) != *event)
    {
        suppress(record, "stale_checkpoint");
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeStatus {
    pub mode: ExpertMode,
    pub requested_mode: Option<ExpertMode>,
    pub provider: Option<String>,
    pub host: Option<String>,
    pub limits: ExpertLimits,
    pub trace_limits: TraceLimits,
    pub retained_payloads: Option<usize>,
    pub payload_bytes: Option<usize>,
    pub omitted_payloads: Option<u64>,
    pub omitted_bytes: Option<u64>,
    pub capture_records: Option<usize>,
    pub omitted_captures: Option<u64>,
    pub unresolved_concerns: Option<usize>,
    pub unknown_deliveries: Option<usize>,
    pub error: Option<String>,
}

pub fn status(project: &Project) -> Option<RuntimeStatus> {
    if !project.manifest.root.join(".blabla/expert").exists() {
        return None;
    }
    let mut status = RuntimeStatus {
        mode: ExpertMode::Shadow,
        requested_mode: None,
        provider: None,
        host: None,
        limits: ExpertLimits::default(),
        trace_limits: TraceLimits::default(),
        retained_payloads: None,
        payload_bytes: None,
        omitted_payloads: None,
        omitted_bytes: None,
        capture_records: None,
        omitted_captures: None,
        unresolved_concerns: None,
        unknown_deliveries: None,
        error: None,
    };
    let result = (|| {
        let store = TraceStore::new(&project.manifest.root, TraceLimits::default())?;
        let config = if store.directory().join("runtime.json").exists() {
            let config = store.runtime()?;
            config.validate()?;
            status.requested_mode = Some(config.mode);
            config
        } else {
            RuntimeConfig::default()
        };
        status.limits = config.limits.clone();
        status.trace_limits = config.trace_limits.clone();
        status.provider = config
            .provider
            .as_ref()
            .map(|provider| provider.identity.provider.clone());
        status.host = config.host.as_ref().map(|host| host.host.clone());
        store.traces()?;
        let index = store.index()?;
        let ledger = store.ledger()?;
        status.retained_payloads = Some(
            index
                .entries
                .iter()
                .filter(|entry| !entry.payload_omitted)
                .count(),
        );
        status.payload_bytes = Some(
            index
                .entries
                .iter()
                .filter(|entry| !entry.payload_omitted)
                .map(|entry| entry.bytes)
                .try_fold(0usize, usize::checked_add)
                .ok_or(TraceError::LimitExceeded)?,
        );
        status.omitted_payloads = Some(index.omitted_payloads);
        status.omitted_bytes = Some(index.omitted_bytes);
        status.capture_records = Some(index.captures.len());
        status.omitted_captures = Some(index.omitted_captures);
        status.unresolved_concerns = Some(
            ledger
                .entries
                .values()
                .filter(|entry| {
                    entry.state != DeliveryState::ObservedResolved && !entry.no_delivery_verified
                })
                .count(),
        );
        status.unknown_deliveries = Some(
            ledger
                .entries
                .values()
                .filter(|entry| entry.state == DeliveryState::Unknown)
                .count(),
        );
        status.mode = match config.mode {
            ExpertMode::Off => ExpertMode::Off,
            ExpertMode::Shadow => ExpertMode::Shadow,
            ExpertMode::Advisory => {
                let promoted = !config.promotions.is_empty()
                    && index
                        .entries
                        .iter()
                        .rev()
                        .filter(|entry| !entry.payload_omitted)
                        .take(64)
                        .any(|entry| {
                            store.read(&entry.request_id).is_ok_and(|record| {
                                record.mode == ExpertMode::Advisory
                                    && record.provenance == Provenance::LocalCheckpoint
                                    && record.runtime_fingerprint.as_ref()
                                        == Some(&packet::digest(&config))
                                    && replay(&record).is_ok()
                                    && current_revision_matches(project, &record)
                                    && ledger
                                        .checkpoints
                                        .get(&packet::digest(&(
                                            &record.request.packet.event.run_id,
                                            &record.request.packet.event.task,
                                        )))
                                        .is_some_and(|event| {
                                            EventStamp::from(event) == record.request.packet.event
                                        })
                                    && promotion_matches(&config, &record, &record.request.packet)
                            })
                        });
                if promoted {
                    ExpertMode::Advisory
                } else {
                    ExpertMode::Shadow
                }
            }
        };
        Ok::<(), TraceError>(())
    })();
    if let Err(error) = result {
        status.error = Some(error.to_string());
    }
    Some(status)
}
