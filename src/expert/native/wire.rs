use crate::expert::calibration::{self, EvidenceRef};
use crate::expert::pilot::{
    self, AuthorityRef, Budgets, Clock, Error, Phase, Refusal, nullable, require,
};
use crate::expert::policy::ExpertResult;
use crate::expert::provider::ProviderIdentity;
use crate::expert::{HostCapabilities, InterventionSummary, Observation, ObservedEvent};
use crate::project::task::revision::RelevantRevision;
use crate::runtime::strict_json::StrictValue;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::collections::BTreeMap;

pub const MAX_NATIVE_BYTES: usize = 65_536;

pub fn decode<T: DeserializeOwned + Serialize>(bytes: &[u8]) -> Result<T, Error> {
    if bytes.len() > MAX_NATIVE_BYTES {
        return Err(Error::InvalidInput);
    }
    let StrictValue(value) = serde_json::from_slice(bytes).map_err(|_| Error::InvalidInput)?;
    validate_value(&value, "", 0)?;
    serde_json::from_value(value).map_err(|_| Error::InvalidInput)
}
pub(crate) fn validate_value(
    value: &serde_json::Value,
    key: &str,
    depth: usize,
) -> Result<(), Error> {
    if depth > 32 {
        return Err(Error::InvalidInput);
    }
    match value {
        serde_json::Value::String(s) => {
            if s.len()
                > if matches!(key, "brief" | "frozen_brief") {
                    8192
                } else {
                    2048
                }
                || crate::expert::packet::redact(s) != *s
                || (key.ends_with("sha256") && !pilot::hex(s, 64))
                || (key.ends_with("nonce") && !pilot::hex(s, 32))
            {
                return Err(Error::InvalidInput);
            }
        }
        serde_json::Value::Array(values) => {
            if values.len() > 16384 {
                return Err(Error::InvalidInput);
            }
            for value in values {
                validate_value(value, key, depth + 1)?;
            }
        }
        serde_json::Value::Object(values) => {
            for (key, value) in values {
                if key == "schema_version" && value.as_u64() != Some(1) {
                    return Err(Error::InvalidInput);
                }
                validate_value(value, key, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Child {
    #[serde(deserialize_with = "nullable")]
    pub agent_id: Option<String>,
    pub task_name: String,
}
impl Child {
    pub fn validate(&self) -> Result<(), Error> {
        require(
            pilot::opaque(&self.task_name)
                && self.task_name.starts_with('/')
                && self
                    .agent_id
                    .as_ref()
                    .is_none_or(|id| pilot::opaque(id) && id != &self.task_name),
            Refusal::IdentityMismatch,
        )
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeCapability {
    pub kind: String,
    pub host: HostCapabilities,
    pub tool_surface: EvidenceRef,
    pub nonce_round_trip: EvidenceRef,
    pub boundary: String,
    pub continuation_owner: String,
    pub delivery: String,
    pub origin: String,
    pub limitations: Vec<String>,
}
impl NativeCapability {
    pub fn validate(&self) -> Result<(), Error> {
        let host = &self.host;
        require(
            self.kind == "cooperative_between_turn"
                && self.boundary == "completed_idle_turn"
                && self.continuation_owner == "single_enrolled_coordinator"
                && self.delivery == "worker_first_action_consume"
                && self.origin == "coordinator_correlated_native_result"
                && self.limitations
                    == [
                        "no_atomic_host_send",
                        "in_turn_unobserved",
                        "child_identity_attested",
                        "unobserved_out_of_band_continuation",
                    ]
                && host.host == "openai-native-collaboration"
                && host.adapter == "blabla-native-cooperative"
                && pilot::hex(&self.tool_surface.sha256, 64)
                && host.version == format!("unversioned-{}", &self.tool_surface.sha256[..16])
                && host.checkpoints == [crate::expert::CheckpointKind::TurnEnd]
                && !host.pauses_worker
                && !host.same_task_delivery
                && !host.delivery_receipts
                && !host.pre_tool_control
                && host.gaps.is_empty(),
            Refusal::UnsupportedCapability,
        )
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Enrollment {
    pub run_id: String,
    pub task: String,
    pub acceptance_epoch: u64,
    pub child: Child,
    pub coordinator: Child,
    pub generation: u64,
    pub assignment_revision: RelevantRevision,
    pub spawn_evidence: EvidenceRef,
    pub initial_idle_evidence: EvidenceRef,
    pub capability: NativeCapability,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BoundaryKey {
    pub run_id: String,
    pub task: String,
    pub acceptance_epoch: u64,
    pub child: Child,
    pub generation: u64,
    pub checkpoint_id: String,
    pub sequence: u64,
    #[serde(deserialize_with = "nullable")]
    pub previous_sequence: Option<u64>,
    pub boundary_nonce: String,
    pub assignment_revision: RelevantRevision,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectedBinding {
    pub binding_id: String,
    pub revision: RelevantRevision,
    pub packet_hash: String,
    pub question_fingerprint: String,
    pub template_fingerprint: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Checkpoint {
    pub key: BoundaryKey,
    pub selected: Vec<SelectedBinding>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostRequest {
    pub schema_version: u64,
    pub operation_id: String,
    pub key: BoundaryKey,
    pub created: Clock,
    pub deadline_boottime_ms: u64,
    pub payload: HostAction,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum HostAction {
    InspectChild,
    ContinueWork { brief: String, brief_sha256: String },
    WakeWorker { wake: Wake },
    AwaitBoundary { expected_nonce: String },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkContinuation {
    pub kind: String,
    pub schema_version: u64,
    pub key: BoundaryKey,
    pub brief: String,
    pub brief_sha256: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Wake {
    pub kind: String,
    pub schema_version: u64,
    pub run_id: String,
    pub checkpoint_id: String,
    pub wake_nonce: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostResult {
    pub schema_version: u64,
    pub operation_id: String,
    pub request_sha256: String,
    pub key: BoundaryKey,
    pub evidence: EvidenceRef,
    pub payload: HostOutcome,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChildStatus {
    Idle,
    Running,
    Missing,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotInvokedReason {
    CancelledBeforeCall,
    DeadlineBeforeCall,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnknownReason {
    ToolError,
    MissingResult,
    AmbiguousOrigin,
    DeadlineAfterCall,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum HostOutcome {
    ChildStatus {
        child: Child,
        status: ChildStatus,
    },
    ContinuationAccepted {
        child: Child,
    },
    WakeAccepted {
        child: Child,
    },
    BoundaryReturned {
        origin: Child,
        marker: WorkerBoundary,
    },
    WorkerResponse {
        origin: Child,
        response: WorkerResponse,
    },
    NotInvoked {
        reason: NotInvokedReason,
    },
    Unknown {
        reason: UnknownReason,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatementSlot {
    Claim,
    Proposal,
    Evidence,
    Attempts,
}
impl From<StatementSlot> for crate::expert::ContextSlot {
    fn from(slot: StatementSlot) -> Self {
        match slot {
            StatementSlot::Claim => Self::Claim,
            StatementSlot::Proposal => Self::Proposal,
            StatementSlot::Evidence => Self::Evidence,
            StatementSlot::Attempts => Self::Attempts,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerStatement {
    pub statement_id: String,
    pub slot: StatementSlot,
    pub text: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerBoundary {
    pub kind: String,
    pub schema_version: u64,
    pub run_id: String,
    pub task: String,
    pub acceptance_epoch: u64,
    pub child_attestation: Child,
    pub generation: u64,
    pub sequence: u64,
    pub boundary_nonce: String,
    pub capture_id: String,
    pub capture_sha256: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Disposition {
    Acknowledged,
    Declined,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum WorkerResponse {
    #[serde(rename = "blabla_native_response")]
    Advice {
        schema_version: u64,
        run_id: String,
        checkpoint_id: String,
        request_id: String,
        wake_nonce: String,
        consume_nonce: String,
        result_sha256: String,
        child_attestation: Child,
        disposition: Disposition,
    },
    #[serde(rename = "blabla_native_no_advice")]
    NoAdvice {
        schema_version: u64,
        completion: NoAdviceCompletion,
        child_attestation: Child,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoAdviceCompletion {
    pub run_id: String,
    pub checkpoint_id: String,
    pub request_id: String,
    pub wake_nonce: String,
    pub refusal_nonce: String,
    pub refusal_sha256: String,
    pub code: Refusal,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConsumeRefusal {
    pub kind: String,
    pub key: BoundaryKey,
    pub request_id: String,
    pub wake_nonce: String,
    pub refusal_nonce: String,
    pub code: Refusal,
    pub exposure_attempted: bool,
}
impl ConsumeRefusal {
    pub fn completion(&self) -> Result<NoAdviceCompletion, Error> {
        Ok(NoAdviceCompletion {
            run_id: self.key.run_id.clone(),
            checkpoint_id: self.key.checkpoint_id.clone(),
            request_id: self.request_id.clone(),
            wake_nonce: self.wake_nonce.clone(),
            refusal_nonce: self.refusal_nonce.clone(),
            refusal_sha256: calibration::canonical_sha256(self)?,
            code: self.code,
        })
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BoundaryCapture {
    pub kind: String,
    pub schema_version: u64,
    pub capture_id: String,
    pub key: BoundaryKey,
    pub work_operation_id: String,
    pub statements: Vec<WorkerStatement>,
    pub final_boundary: bool,
    pub event: ObservedEvent,
    pub projections: Vec<BindingProjection>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BindingProjection {
    pub binding_id: String,
    pub revision: RelevantRevision,
    pub observations: Vec<Observation>,
    pub history: Vec<InterventionSummary>,
    pub packet_hash: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObserveRequest {
    pub schema_version: u64,
    pub kind: String,
    pub key: BoundaryKey,
    pub boundary_operation_id: String,
    pub idle_operation_id: String,
    pub config_sha256: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ResponseEvidence {
    WorkerResponse { response_operation_id: String },
    ObservedResolution { task_evidence_id: String },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InvalidationReason {
    OutOfBandContinuation,
    OriginMismatch,
    MissedBoundary,
    CoordinatorLost,
    TaskReplaced,
    OwnerStop,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum NativeRequest {
    Enroll {
        schema_version: u64,
        enrollment: Box<Enrollment>,
    },
    CaptureBoundary {
        schema_version: u64,
        work_key: BoundaryKey,
        child_attestation: Child,
        statements: Vec<WorkerStatement>,
        final_boundary: bool,
    },
    Observe {
        schema_version: u64,
        key: BoundaryKey,
        boundary_operation_id: String,
        idle_operation_id: String,
        config_sha256: String,
    },
    PrepareWake {
        schema_version: u64,
        checkpoint: Checkpoint,
        request_id: String,
        authority: AuthorityRef,
    },
    Consume {
        schema_version: u64,
        wake: Wake,
        task: String,
        acceptance_epoch: u64,
        generation: u64,
        child_attestation: Child,
        first_action_attestation: bool,
    },
    RecordResponse {
        schema_version: u64,
        checkpoint: Checkpoint,
        request_id: String,
        evidence: ResponseEvidence,
    },
    Invalidate {
        schema_version: u64,
        key: BoundaryKey,
        reason: InvalidationReason,
        evidence: EvidenceRef,
        coordinator: Child,
    },
    StartRun {
        schema_version: u64,
        run_id: String,
        native_plan: EvidenceRef,
        protocol: EvidenceRef,
    },
    Advance {
        schema_version: u64,
        run_id: String,
        native_plan_sha256: String,
        coordinator: Child,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClaimRequest {
    pub schema_version: u64,
    pub run_id: String,
    pub operation_id: String,
    pub request_sha256: String,
    pub coordinator: Child,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum NativeResult {
    Enrolled {
        key: BoundaryKey,
    },
    BoundaryCaptured {
        marker: WorkerBoundary,
    },
    BoundaryObserved {
        checkpoint: Checkpoint,
        event: ObservedEvent,
    },
    RequestReserved {
        checkpoint: Checkpoint,
        request_id: String,
        idempotency_key: String,
        host_operation: HostRequest,
    },
    Consumed {
        checkpoint: Checkpoint,
        request_id: String,
        idempotency_key: String,
        consume_nonce: String,
        result_sha256: String,
        result: ExpertResult,
        authority: AuthorityRef,
    },
    ResponseObserved {
        request_id: String,
        receipt: NativeReceipt,
    },
    Invalidated {
        run_id: String,
        generation: u64,
    },
    NoAdvice {
        code: Refusal,
        #[serde(deserialize_with = "nullable")]
        completion: Option<NoAdviceCompletion>,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AdvanceResult {
    Pending { request: HostRequest },
    CheckpointDue { observation: ObserveRequest },
    AwaitingPermit { run_id: String },
    ArmStopped { run_id: String, code: Refusal },
    ArmFinished { run_id: String },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum HostNextResult {
    Pending { request: Box<HostRequest> },
    None { run_id: String },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClaimResult {
    Claimed { operation_id: String },
    Refused { code: Refusal },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum HostRecordResult {
    Recorded { operation_id: String },
    Refused { code: Refusal },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeReceipt {
    pub request_id: String,
    pub idempotency_key: String,
    pub key: BoundaryKey,
    pub recorded: Clock,
    pub category: ReceiptCategory,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotExposedReason {
    CancelledBeforeConsume,
    StaleBeforeConsume,
    ConsumeRefused,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnknownReceiptReason {
    DispatchResultMissing,
    ConsumeResultMissing,
    ResponseDeadline,
    StorageUncertain,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ReceiptCategory {
    TransportAccepted {
        operation_id: String,
        evidence: EvidenceRef,
    },
    ExposureAttempted {
        consume_nonce: String,
        result_sha256: String,
    },
    Acknowledged {
        response_operation_id: String,
        evidence: EvidenceRef,
    },
    Declined {
        response_operation_id: String,
        evidence: EvidenceRef,
    },
    ObservedResolved {
        task_evidence_id: String,
    },
    NotExposed {
        reason: NotExposedReason,
        #[serde(deserialize_with = "nullable")]
        refusal_sha256: Option<String>,
    },
    Unknown {
        reason: UnknownReceiptReason,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ExecutionIdentity {
    Ordinary,
    Experimental {
        run_id: String,
        experiment_id: String,
        arm: crate::expert::ExpertMode,
        protocol_sha256: String,
        native_plan_sha256: String,
        #[serde(deserialize_with = "nullable")]
        authority: Option<AuthorityRef>,
        capability_sha256: String,
    },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativePlan {
    pub kind: String,
    pub schema_version: u64,
    pub experiment_id: String,
    pub protocol_sha256: String,
    pub phase: Phase,
    pub capability: NativeCapability,
    pub provider: ProviderIdentity,
    pub calibration: EvidenceRef,
    pub controls_sha256: String,
    pub snapshot_files: BTreeMap<String, String>,
    pub arms: Vec<ArmPlan>,
    pub order: Vec<String>,
    pub host_operation_timeout_ms: u64,
    pub response_timeout_ms: u64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArmPlan {
    pub run_id: String,
    pub matched_task_id: String,
    pub repeat: u64,
    pub arm: crate::expert::ExpertMode,
    pub task: String,
    pub acceptance_epoch: u64,
    pub child: Child,
    pub coordinator: Child,
    pub workspace: String,
    pub initial_assignment_revision: RelevantRevision,
    pub frozen_brief: String,
    pub brief_sha256: String,
    pub runtime_config: EvidenceRef,
    pub budgets: Budgets,
    pub grading_spec: EvidenceRef,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeToolObservation {
    pub kind: String,
    pub schema_version: u64,
    pub record_id: String,
    pub coordinator: Child,
    pub capture_session: String,
    pub local_sequence: u64,
    #[serde(deserialize_with = "nullable")]
    pub operation_id: Option<String>,
    pub attestation: String,
    pub projection: NativeProjection,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum NativeProjection {
    ToolSurface {
        source: String,
        surface: NativeToolSurface,
    },
    Spawn {
        tool: String,
        requested_task_name: String,
        returned: Child,
    },
    Status {
        tool: String,
        #[serde(deserialize_with = "nullable")]
        path_prefix: Option<String>,
        #[serde(deserialize_with = "nullable")]
        selected: Option<SelectedStatus>,
    },
    Followup {
        tool: String,
        target_task_name: String,
        sent: SentProtocol,
        outcome: FollowupOutcome,
    },
    Completion {
        source: String,
        origin: Child,
        marker: NativeMarker,
    },
    NotInvoked {
        tool: String,
        reason: NotInvokedReason,
    },
    Unavailable {
        source: String,
        reason: UnavailableReason,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FollowupOutcome {
    ReturnedWithoutError,
    ExplicitRejection,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnavailableReason {
    MissingResult,
    UnrecognizedShape,
    AmbiguousOrigin,
    ToolError,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SelectedStatus {
    Completed {
        agent_name: String,
        #[serde(deserialize_with = "nullable")]
        agent_id: Option<String>,
        marker: Box<NativeMarker>,
    },
    Running {
        agent_name: String,
        #[serde(deserialize_with = "nullable")]
        agent_id: Option<String>,
    },
    Unknown {
        agent_name: String,
        #[serde(deserialize_with = "nullable")]
        agent_id: Option<String>,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum NativeMarker {
    #[serde(rename = "blabla_native_ready")]
    Ready {
        schema_version: u64,
        run_id: String,
        task: String,
        acceptance_epoch: u64,
    },
    #[serde(rename = "blabla_native_probe_ready")]
    ProbeReady {
        schema_version: u64,
        proof_id: String,
    },
    #[serde(rename = "blabla_native_probe_response")]
    ProbeResponse {
        schema_version: u64,
        proof_id: String,
        nonce: String,
    },
    #[serde(rename = "blabla_native_boundary")]
    Boundary {
        schema_version: u64,
        run_id: String,
        task: String,
        acceptance_epoch: u64,
        child_attestation: Child,
        generation: u64,
        sequence: u64,
        boundary_nonce: String,
        capture_id: String,
        capture_sha256: String,
    },
    #[serde(rename = "blabla_native_response")]
    Advice {
        schema_version: u64,
        run_id: String,
        checkpoint_id: String,
        request_id: String,
        wake_nonce: String,
        consume_nonce: String,
        result_sha256: String,
        child_attestation: Child,
        disposition: Disposition,
    },
    #[serde(rename = "blabla_native_no_advice")]
    NoAdvice {
        schema_version: u64,
        completion: NoAdviceCompletion,
        child_attestation: Child,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SentProtocol {
    Probe { message: ProbeMessage },
    Wake { message: Wake },
    Work { message_sha256: String },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProbeMessage {
    pub kind: String,
    pub schema_version: u64,
    pub proof_id: String,
    pub nonce: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolSignature {
    pub required: Vec<String>,
    pub optional: Vec<String>,
    pub argument_type: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WaitSignature {
    pub required: Vec<String>,
    pub optional: Vec<String>,
    pub argument_type: String,
    pub timeout_ms_min: u64,
    pub timeout_ms_max: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeToolSurface {
    pub spawn_agent: ToolSignature,
    pub list_agents: ToolSignature,
    pub followup_task: ToolSignature,
    pub wait_agent: WaitSignature,
    pub followup_semantics: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InitialIdleEvidence {
    pub kind: String,
    pub schema_version: u64,
    pub record_id: String,
    pub spawn_evidence: EvidenceRef,
    pub completion: NativeToolObservation,
    pub status: NativeToolObservation,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProbeChallenge {
    pub kind: String,
    pub schema_version: u64,
    pub proof_id: String,
    pub coordinator: Child,
    pub capture_session: String,
    pub nonce: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NonceRoundTripEvidence {
    pub kind: String,
    pub schema_version: u64,
    pub record_id: String,
    pub tool_surface: EvidenceRef,
    pub spawn_evidence: EvidenceRef,
    pub idle_before: EvidenceRef,
    pub challenge: ProbeChallenge,
    pub followup: NativeToolObservation,
    pub response: NativeToolObservation,
    pub status_after: NativeToolObservation,
}
