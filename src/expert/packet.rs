use super::{
    ContextSlot, EventStamp, ExpertLimits, InterventionSummary, Observation, PacketAccounting,
    SourceKind, TemplateKind,
};
use crate::memory::knowledge::Judgment;
use crate::project::task::revision::RelevantRevision;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ContextValue {
    Present {
        observations: Vec<Observation>,
    },
    Missing,
    Unknown,
    Unavailable {
        reason: String,
    },
    Truncated {
        observations: Vec<Observation>,
        omitted_bytes: usize,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum ContextWire {
    Present {
        observations: Vec<Observation>,
    },
    Missing {},
    Unknown {},
    Unavailable {
        reason: String,
    },
    Truncated {
        observations: Vec<Observation>,
        omitted_bytes: usize,
    },
}

impl<'de> Deserialize<'de> for ContextValue {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match ContextWire::deserialize(deserializer)? {
            ContextWire::Present { observations } => Self::Present { observations },
            ContextWire::Missing {} => Self::Missing,
            ContextWire::Unknown {} => Self::Unknown,
            ContextWire::Unavailable { reason } => Self::Unavailable { reason },
            ContextWire::Truncated {
                observations,
                omitted_bytes,
            } => Self::Truncated {
                observations,
                omitted_bytes,
            },
        })
    }
}

impl ContextValue {
    pub fn observations(&self) -> &[Observation] {
        match self {
            Self::Present { observations } | Self::Truncated { observations, .. } => observations,
            _ => &[],
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpertPacket {
    pub event: EventStamp,
    pub binding_id: String,
    pub revision: RelevantRevision,
    pub context: BTreeMap<ContextSlot, ContextValue>,
    pub references: BTreeMap<String, String>,
    pub history: Vec<InterventionSummary>,
    pub accounting: PacketAccounting,
    pub hash: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PacketError {
    InvalidEvent,
    SequenceGap,
    UnresolvedRevision,
    UnresolvedReference,
    MissingRequiredContext,
    LimitExceeded,
}

impl PacketError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidEvent => "invalid_event",
            Self::SequenceGap => "sequence_gap",
            Self::UnresolvedRevision => "unresolved_revision",
            Self::UnresolvedReference => "unresolved_reference",
            Self::MissingRequiredContext => "missing_required_context",
            Self::LimitExceeded => "limit_exceeded",
        }
    }
}

impl std::fmt::Display for PacketError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for PacketError {}

pub fn digest<T: Serialize>(value: &T) -> String {
    let mut hash = crate::project::Fnv::new();
    hash.write_str("blabla.expert.value.v1");
    hash.write(&serde_json::to_vec(value).expect("expert value serializes"));
    hash.finish()
}

pub fn canonical_hash(packet: &ExpertPacket) -> String {
    let mut canonical = packet.clone();
    canonical.hash.clear();
    canonical.event.event_id.clear();
    canonical.event.unix_ms = 0;
    for summary in &mut canonical.history {
        summary.request_id.clear();
    }
    canonical.accounting = PacketAccounting {
        selected_bytes: 0,
        omitted_bytes: 0,
        estimated_tokens: 0,
        provider_tokens: None,
    };
    digest(&("blabla.expert.packet.v1", canonical))
}

pub fn selected_bytes(packet: &ExpertPacket) -> usize {
    checked_selected_bytes(packet).unwrap_or(usize::MAX)
}

fn checked_selected_bytes(packet: &ExpertPacket) -> Option<usize> {
    packet
        .context
        .values()
        .flat_map(ContextValue::observations)
        .map(|observation| observation.text.len())
        .chain(packet.references.values().map(String::len))
        .chain(
            packet
                .history
                .iter()
                .flat_map(|summary| {
                    [
                        &summary.request_id,
                        &summary.concern,
                        &summary.target,
                        &summary.evidence_revision,
                    ]
                })
                .map(String::len),
        )
        .try_fold(0usize, |total, bytes| total.checked_add(bytes))
}

pub fn validate_event(event: &EventStamp) -> Result<(), PacketError> {
    if event.sequence == 0
        || (event.sequence == 1 && event.previous_sequence.is_some())
        || (event.sequence > 1 && event.previous_sequence != Some(event.sequence - 1))
    {
        return Err(PacketError::SequenceGap);
    }
    if [
        &event.event_id,
        &event.run_id,
        &event.task,
        &event.checkpoint_id,
        &event.host.host,
        &event.host.version,
        &event.host.adapter,
    ]
    .iter()
    .any(|s| s.trim().is_empty() || s.len() > 256 || redact(s) != ***s)
        || !event.host.checkpoints.contains(&event.kind)
        || !event.host.gaps.is_empty()
        || event.host.checkpoints.len() > 6
    {
        return Err(PacketError::InvalidEvent);
    }
    Ok(())
}

pub fn validate_packet(
    packet: &ExpertPacket,
    judgment: &Judgment,
    limits: &ExpertLimits,
) -> Result<(), PacketError> {
    validate_event(&packet.event)?;
    if packet.hash != canonical_hash(packet) {
        return Err(PacketError::InvalidEvent);
    }
    if packet.revision.paths.values().any(Option::is_none)
        || !valid_digest(&packet.revision.task_digest)
        || packet
            .revision
            .paths
            .values()
            .flatten()
            .any(|hash| !valid_digest(hash))
        || packet.revision.identities.is_empty()
        || packet
            .revision
            .identities
            .values()
            .any(|hash| !valid_digest(hash))
    {
        return Err(PacketError::UnresolvedRevision);
    }
    let permitted: BTreeSet<_> = judgment
        .requires
        .iter()
        .chain(&judgment.optional)
        .copied()
        .collect();
    if packet.context.keys().copied().collect::<BTreeSet<_>>() != permitted {
        return Err(PacketError::InvalidEvent);
    }
    for slot in &judgment.requires {
        if !matches!(packet.context.get(slot), Some(ContextValue::Present { observations }) if !observations.is_empty())
        {
            return Err(PacketError::MissingRequiredContext);
        }
    }
    let revision = packet.revision.fingerprint();
    let mut ids = BTreeSet::new();
    let mut reference_owners = BTreeSet::new();
    for (slot, value) in &packet.context {
        if let ContextValue::Unavailable { reason } = value
            && !safe_text(reason, limits.excerpt_bytes)
        {
            return Err(PacketError::InvalidEvent);
        }
        for observation in value.observations() {
            if observation.slot != *slot
                || observation.observed_revision != revision
                || !safe_text(&observation.id, 256)
                || !safe_text(&observation.capture, 256)
                || observation
                    .capture
                    .to_ascii_lowercase()
                    .contains("transcript")
                || !ids.insert((*slot, observation.id.clone()))
                || !capture_consistent(observation)
                || observation.text.len() > limits.excerpt_bytes
                || redact(&observation.text) != observation.text
            {
                return Err(PacketError::InvalidEvent);
            }
            if observation.fact.as_ref().is_some_and(|fact| {
                !safe_fact(fact, &packet.event.task, &revision, limits.excerpt_bytes)
            }) {
                return Err(PacketError::InvalidEvent);
            }
            if observation.fact.is_some() && observation.kind != SourceKind::DeterministicOutput {
                return Err(PacketError::InvalidEvent);
            }
            let memory_reference = matches!(
                slot,
                ContextSlot::Goal
                    | ContextSlot::Mission
                    | ContextSlot::Candidates
                    | ContextSlot::Rules
                    | ContextSlot::System
            );
            let evidence_reference = matches!(slot, ContextSlot::Evidence | ContextSlot::Attempts)
                && observation.kind == SourceKind::DeterministicOutput;
            if memory_reference && observation.kind != SourceKind::DeterministicOutput {
                return Err(PacketError::InvalidEvent);
            }
            if memory_reference || evidence_reference {
                if !packet.references.contains_key(&observation.id) {
                    return Err(PacketError::UnresolvedReference);
                }
                reference_owners.insert(observation.id.clone());
            }
        }
    }
    if packet
        .references
        .keys()
        .any(|id| !reference_owners.contains(id))
    {
        return Err(PacketError::UnresolvedReference);
    }
    if judgment.templates.contains(&TemplateKind::CiteEvidence)
        && !packet
            .context
            .get(&ContextSlot::Evidence)
            .is_some_and(|value| {
                value.observations().iter().any(|observation| {
                    observation.kind == SourceKind::DeterministicOutput
                        && observation.fact.is_some()
                        && packet.references.contains_key(&observation.id)
                })
            })
    {
        return Err(PacketError::UnresolvedReference);
    }
    if packet.references.iter().any(|(id, text)| {
        !safe_text(id, 256) || text.len() > limits.excerpt_bytes || redact(text) != *text
    }) {
        return Err(PacketError::UnresolvedReference);
    }
    if !safe_text(&packet.binding_id, 256)
        || packet
            .revision
            .paths
            .keys()
            .any(|path| !safe_text(path, 2048))
        || packet
            .revision
            .identities
            .iter()
            .any(|(id, hash)| !safe_text(id, 256) || !safe_text(hash, 256))
        || packet.history.iter().any(|entry| {
            [
                &entry.request_id,
                &entry.concern,
                &entry.target,
                &entry.evidence_revision,
            ]
            .iter()
            .any(|text| !safe_text(text, limits.excerpt_bytes))
        })
    {
        return Err(PacketError::InvalidEvent);
    }
    let selected = checked_selected_bytes(packet).ok_or(PacketError::LimitExceeded)?;
    let omitted = packet
        .context
        .values()
        .map(|value| match value {
            ContextValue::Truncated { omitted_bytes, .. } => *omitted_bytes,
            _ => 0,
        })
        .try_fold(0usize, |total, bytes| total.checked_add(bytes))
        .ok_or(PacketError::LimitExceeded)?;
    if packet.accounting.selected_bytes != selected
        || packet.accounting.estimated_tokens != packet.accounting.selected_bytes.div_ceil(4)
        || packet.history.len() > limits.history_entries
        || omitted > packet.accounting.omitted_bytes
        || serde_json::to_vec(packet)
            .map_err(|_| PacketError::InvalidEvent)?
            .len()
            > limits.packet_bytes
    {
        return Err(PacketError::LimitExceeded);
    }
    Ok(())
}

fn valid_digest(text: &str) -> bool {
    text.len() == 16
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn capture_consistent(observation: &Observation) -> bool {
    let capture = observation.capture.to_ascii_lowercase();
    if capture.contains("transcript") || capture.contains("session-store") {
        return false;
    }
    match observation.capture.as_str() {
        "local:task-record" => {
            observation.slot == ContextSlot::Task
                && observation.kind == SourceKind::DeterministicOutput
                && matches!(
                    observation.fact,
                    Some(super::ObservedFact::TaskState { .. })
                )
        }
        "local:registered-memory" => {
            matches!(
                observation.slot,
                ContextSlot::Goal
                    | ContextSlot::Mission
                    | ContextSlot::Candidates
                    | ContextSlot::Rules
                    | ContextSlot::System
            ) && observation.kind == SourceKind::DeterministicOutput
                && observation.fact.is_none()
        }
        "local:task-evidence" => {
            matches!(
                observation.slot,
                ContextSlot::Evidence | ContextSlot::Attempts
            ) && observation.id.starts_with("evidence::")
                && matches!(
                    observation.kind,
                    SourceKind::DeterministicOutput | SourceKind::WorkerStatement
                )
                && matches!(
                    observation.fact,
                    None | Some(super::ObservedFact::CommandExit { .. })
                )
        }
        _ => {
            !capture.starts_with("local:")
                && observation.kind != SourceKind::DeterministicOutput
                && observation.fact.is_none()
        }
    }
}

fn safe_text(text: &str, max: usize) -> bool {
    !text.trim().is_empty() && text.len() <= max && redact(text) == text
}

fn safe_fact(fact: &super::ObservedFact, task: &str, revision: &str, max: usize) -> bool {
    match fact {
        super::ObservedFact::CommandExit { argv, .. } => {
            !argv.is_empty()
                && argv
                    .iter()
                    .all(|arg| arg.len() <= max && redact(arg) == *arg)
        }
        super::ObservedFact::TaskState {
            task: observed,
            state,
        } => observed == task && crate::project::task::STATES.contains(&state.as_str()),
        super::ObservedFact::Revision { fingerprint } => fingerprint == revision,
    }
}

pub fn bounded(text: &str, max: usize) -> (String, usize) {
    let redacted = redact(text);
    let mut end = redacted.len().min(max);
    while !redacted.is_char_boundary(end) {
        end -= 1;
    }
    (redacted[..end].to_owned(), redacted.len() - end)
}

pub fn redact(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut position = 0;
    let bytes = text.as_bytes();
    let lowercase = text.to_ascii_lowercase();
    while position < text.len() {
        let tail = &text[position..];
        let lower = &lowercase[position..];
        if tail.starts_with("-----BEGIN ")
            && tail
                .split("-----")
                .nth(1)
                .is_some_and(|header| header.contains("PRIVATE KEY"))
        {
            let end = tail
                .find("-----END ")
                .and_then(|start| {
                    tail[start + 9..]
                        .find("-----")
                        .map(|length| start + 9 + length + 5)
                })
                .unwrap_or(tail.len());
            result.push_str("[REDACTED]");
            position += end;
            continue;
        }
        let credentials = [
            "api_key",
            "api-key",
            "apikey",
            "password",
            "passwd",
            "secret",
            "access_token",
            "refresh_token",
            "token",
            "authorization",
        ];
        let key = credentials.iter().find(|key| {
            lower.starts_with(**key)
                && (position == 0 || !bytes[position - 1].is_ascii_alphanumeric())
        });
        if let Some(key) = key {
            let mut value = position + key.len();
            while value < bytes.len() && matches!(bytes[value], b' ' | b'\t' | b'"' | b'\'') {
                value += 1;
            }
            if value < bytes.len() && matches!(bytes[value], b'=' | b':') {
                value += 1;
                while value < bytes.len() && matches!(bytes[value], b' ' | b'\t' | b'"' | b'\'') {
                    value += 1;
                }
                result.push_str(&text[position..value]);
                let mut end = value;
                while end < bytes.len()
                    && !matches!(bytes[end], b'\n' | b'\r' | b',' | b';' | b'"' | b'\'')
                    && (key == &"authorization" || !bytes[end].is_ascii_whitespace())
                {
                    end += 1;
                }
                result.push_str("[REDACTED]");
                position = end;
                continue;
            }
        }
        let secret_prefix = ["sk-", "ghp_", "github_pat_", "AKIA", "eyJ"]
            .iter()
            .any(|prefix| tail.starts_with(prefix));
        if secret_prefix {
            let end = tail
                .find(|c: char| {
                    !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | '+' | '='))
                })
                .unwrap_or(tail.len());
            if end >= 16 {
                result.push_str("[REDACTED]");
                position += end;
                continue;
            }
        }
        let c = tail.chars().next().expect("nonempty tail");
        result.push(c);
        position += c.len_utf8();
    }
    result
}
