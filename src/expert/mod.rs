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
