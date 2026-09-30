use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExpertMode {
    Off,
    Shadow,
    Advisory,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextSlot {
    Task,
    Goal,
    Mission,
    Proposal,
    Claim,
    Evidence,
    Attempts,
    Candidates,
    Rules,
    System,
}

impl ContextSlot {
    pub fn from_authored(value: &str) -> Option<Self> {
        match value {
            "task" => Some(Self::Task),
            "goal" => Some(Self::Goal),
            "mission" => Some(Self::Mission),
            "proposal" => Some(Self::Proposal),
            "claim" => Some(Self::Claim),
            "evidence" => Some(Self::Evidence),
            "attempts" => Some(Self::Attempts),
            "candidates" => Some(Self::Candidates),
            "rules" => Some(Self::Rules),
            "system" => Some(Self::System),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateKind {
    ReadIdentity,
    CiteEvidence,
    ReconsiderApproach,
    AskOwner,
}

impl TemplateKind {
    pub fn from_authored(value: &str) -> Option<Self> {
        match value {
            "read-identity" => Some(Self::ReadIdentity),
            "cite-evidence" => Some(Self::CiteEvidence),
            "reconsider-approach" => Some(Self::ReconsiderApproach),
            "ask-owner" => Some(Self::AskOwner),
            _ => None,
        }
    }

    pub fn reference_slots(self) -> &'static [ContextSlot] {
        match self {
            Self::ReadIdentity => &[
                ContextSlot::Goal,
                ContextSlot::Mission,
                ContextSlot::Candidates,
                ContextSlot::Rules,
                ContextSlot::System,
            ],
            Self::CiteEvidence => &[ContextSlot::Evidence],
            Self::ReconsiderApproach => &[ContextSlot::Proposal, ContextSlot::Attempts],
            Self::AskOwner => &[ContextSlot::Task],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckpointKind {
    Plan,
    ToolCall,
    ToolResult,
    Claim,
    TurnEnd,
    Review,
}

impl CheckpointKind {
    pub fn from_authored(value: &str) -> Option<Self> {
        match value {
            "plan" => Some(Self::Plan),
            "tool-call" => Some(Self::ToolCall),
            "tool-result" => Some(Self::ToolResult),
            "claim" => Some(Self::Claim),
            "turn-end" => Some(Self::TurnEnd),
            "review" => Some(Self::Review),
            _ => None,
        }
    }
}

pub mod packet;
pub mod provider;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    HostObservation,
    DeterministicOutput,
    WorkerStatement,
    ExpertInference,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ObservedFact {
    CommandExit { argv: Vec<String>, exit: i32 },
    TaskState { task: String, state: String },
    Revision { fingerprint: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Observation {
    pub id: String,
    pub slot: ContextSlot,
    pub kind: SourceKind,
    pub capture: String,
    pub observed_revision: String,
    pub text: String,
    pub fact: Option<ObservedFact>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostCapabilities {
    pub host: String,
    pub version: String,
    pub adapter: String,
    pub checkpoints: Vec<CheckpointKind>,
    pub pauses_worker: bool,
    pub same_task_delivery: bool,
    pub delivery_receipts: bool,
    pub pre_tool_control: bool,
    pub gaps: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservedEvent {
    pub event_id: String,
    pub run_id: String,
    pub task: String,
    pub checkpoint_id: String,
    pub sequence: u64,
    pub previous_sequence: Option<u64>,
    pub unix_ms: u64,
    pub kind: CheckpointKind,
    pub host: HostCapabilities,
    pub observations: Vec<Observation>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventStamp {
    pub event_id: String,
    pub run_id: String,
    pub task: String,
    pub checkpoint_id: String,
    pub sequence: u64,
    pub previous_sequence: Option<u64>,
    pub unix_ms: u64,
    pub kind: CheckpointKind,
    pub host: HostCapabilities,
}

impl From<&ObservedEvent> for EventStamp {
    fn from(event: &ObservedEvent) -> Self {
        Self {
            event_id: event.event_id.clone(),
            run_id: event.run_id.clone(),
            task: event.task.clone(),
            checkpoint_id: event.checkpoint_id.clone(),
            sequence: event.sequence,
            previous_sequence: event.previous_sequence,
            unix_ms: event.unix_ms,
            kind: event.kind,
            host: event.host.clone(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    Proposed,
    Delivered,
    Acknowledged,
    Declined,
    Stale,
    ObservedResolved,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InterventionSummary {
    pub request_id: String,
    pub concern: String,
    pub target: String,
    pub state: DeliveryState,
    pub evidence_revision: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PacketAccounting {
    pub selected_bytes: usize,
    pub omitted_bytes: usize,
    pub estimated_tokens: usize,
    pub provider_tokens: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpertLimits {
    pub packet_bytes: usize,
    pub excerpt_bytes: usize,
    pub history_entries: usize,
    pub judgments_per_checkpoint: usize,
    pub request_timeout_ms: u64,
    pub concurrency: usize,
    pub retries: usize,
    pub deliveries_per_checkpoint: usize,
}

impl Default for ExpertLimits {
    fn default() -> Self {
        Self {
            packet_bytes: 16_384,
            excerpt_bytes: 2_048,
            history_entries: 8,
            judgments_per_checkpoint: 4,
            request_timeout_ms: 10_000,
            concurrency: 1,
            retries: 0,
            deliveries_per_checkpoint: 1,
        }
    }
}
