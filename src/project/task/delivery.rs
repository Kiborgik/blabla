use super::RelevantRevision;
use crate::memory::goal::Goal;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Obligation {
    pub basis: Vec<String>,
    pub goal: Goal,
    pub goal_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim: Option<Claim>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    Delivered,
    Partial,
    Blocked,
    NotApplicable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReferenceKind {
    Verification,
    Artifact,
    Runtime,
    Viewport,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reference {
    pub kind: ReferenceKind,
    pub locator: String,
    pub context: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Claim {
    pub status: Status,
    pub observation: String,
    pub refs: Vec<Reference>,
    pub delivered: Option<String>,
    pub remaining: Option<String>,
    pub owner: Option<String>,
    pub next: Option<String>,
    pub blocker: Option<String>,
    pub unblock_when: Option<String>,
    pub reason: Option<String>,
    pub model: String,
    pub unix: u64,
    pub revision: RelevantRevision,
    pub artifacts: BTreeMap<String, Option<String>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Verdict {
    Accept,
    Reject,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Origin {
    pub task: String,
    pub goal: String,
    pub claim_digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Review {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_task: Option<String>,
    pub goal: String,
    pub claim_digest: String,
    pub goal_fingerprint: String,
    pub target_revision: RelevantRevision,
    pub revision: RelevantRevision,
    pub verdict: Verdict,
    pub refs: Vec<Reference>,
    pub reason: String,
    pub model: String,
    pub unix: u64,
    pub artifacts: BTreeMap<String, Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolve_origin: Option<Origin>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution: Option<Status>,
}
