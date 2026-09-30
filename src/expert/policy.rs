use super::packet::{self, ContextValue, ExpertPacket};
use super::provider::{self, EvaluationRequest, EvaluationResponse, ProviderIdentity, TypedAnswer};
use super::{ContextSlot, DeliveryState, ExpertLimits, InterventionSummary, TemplateKind};
use crate::memory::knowledge::{Judgment, JudgmentOutput};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdvisoryOutcome {
    Silence,
    Abstain,
    Nudge,
    Escalation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConcernKind {
    DeterministicBlocker,
    GoalDrift,
    UnsupportedClaim,
    RepeatedApproach,
    Expertise,
}

impl ConcernKind {
    pub fn code(self) -> &'static str {
        match self {
            Self::DeterministicBlocker => "deterministic_blocker",
            Self::GoalDrift => "goal_drift",
            Self::UnsupportedClaim => "unsupported_claim",
            Self::RepeatedApproach => "repeated_approach",
            Self::Expertise => "expertise",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Predicate {
    ChoiceLabel { label: String },
    NoulValue { value: bool },
    NoulProbability { value: bool },
    ScoreLevel { level: String },
    ScoreTail { from_level: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ReferenceSelection {
    Slot { slot: ContextSlot },
    Identity { id: String },
    SelectedCandidate,
    Task,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum ReferenceSelectionWire {
    Slot { slot: ContextSlot },
    Identity { id: String },
    SelectedCandidate {},
    Task {},
}
impl<'de> Deserialize<'de> for ReferenceSelection {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match ReferenceSelectionWire::deserialize(deserializer)? {
            ReferenceSelectionWire::Slot { slot } => Self::Slot { slot },
            ReferenceSelectionWire::Identity { id } => Self::Identity { id },
            ReferenceSelectionWire::SelectedCandidate {} => Self::SelectedCandidate,
            ReferenceSelectionWire::Task {} => Self::Task,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyRule {
    pub id: String,
    pub predicate: Predicate,
    pub outcome: AdvisoryOutcome,
    pub template: Option<TemplateKind>,
    pub reference: ReferenceSelection,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalibrationRecord {
    pub record_id: String,
    pub provider: ProviderIdentity,
    pub question_fingerprint: String,
    pub template_fingerprint: String,
    pub policy_fingerprint: String,
    pub development_fingerprint: String,
    pub thresholds: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicySettings {
    pub binding_id: String,
    pub concern: ConcernKind,
    pub rules: Vec<PolicyRule>,
    pub calibration: CalibrationRecord,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpertResult {
    pub request_id: String,
    pub packet_hash: String,
    pub outcome: AdvisoryOutcome,
    pub references: Vec<String>,
    pub template: Option<TemplateKind>,
    pub message: Option<String>,
    pub reason: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyError {
    InvalidSettings,
    UnknownReference,
    InvalidTemplate,
    LimitExceeded,
}

impl std::fmt::Display for PolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for PolicyError {}

pub fn question_fingerprint(judgment: &Judgment) -> String {
    packet::digest(&("blabla.expert.question.v1", judgment))
}

pub fn template_fingerprint(judgment: &Judgment) -> String {
    packet::digest(&(
        "blabla.expert.templates.v1",
        &judgment.templates,
        template_implementation(),
    ))
}

pub fn policy_fingerprint(settings: &PolicySettings) -> String {
    packet::digest(&(
        "blabla.expert.policy.v1",
        &settings.binding_id,
        settings.concern,
        &settings.rules,
    ))
}

pub fn template_implementation() -> &'static str {
    "read_identity:cite_evidence:reconsider_approach:ask_owner:v1"
}

pub fn safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':' | b'.'))
        && packet::redact(value) == value
}

fn material_text(observation: &super::Observation) -> String {
    if observation.capture == "local:task-evidence"
        && let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&observation.text)
    {
        if let Some(object) = value.as_object_mut() {
            object.remove("id");
        }
        return value.to_string();
    }
    observation.text.clone()
}

pub fn material_fingerprint(packet: &ExpertPacket) -> String {
    let context: BTreeMap<_, _> = packet
        .context
        .iter()
        .filter(|(slot, _)| **slot != ContextSlot::Task)
        .map(|(slot, value)| {
            let mut local = BTreeMap::new();
            let mut supplied = BTreeSet::new();
            for observation in value
                .observations()
                .iter()
                .filter(|observation| observation.capture != "host:receipt")
            {
                let fingerprint = packet::digest(&(
                    observation.slot,
                    observation.kind,
                    &observation.capture,
                    material_text(observation),
                    &observation.fact,
                ));
                if observation.capture == "local:task-evidence" {
                    let key = match &observation.fact {
                        Some(super::ObservedFact::CommandExit { argv, .. }) => packet::digest(argv),
                        _ => material_text(observation),
                    };
                    local.entry(key).or_insert(fingerprint);
                } else {
                    supplied.insert(fingerprint);
                }
            }
            let observations = (local, supplied);
            (
                *slot,
                (
                    match value {
                        ContextValue::Present { .. } => "present",
                        ContextValue::Missing => "missing",
                        ContextValue::Unknown => "unknown",
                        ContextValue::Unavailable { .. } => "unavailable",
                        ContextValue::Truncated { .. } => "truncated",
                    },
                    observations,
                ),
            )
        })
        .collect();
    let references = packet
        .references
        .iter()
        .filter(|(id, _)| !id.starts_with("evidence::"))
        .collect::<BTreeMap<_, _>>();
    packet::digest(&(
        "blabla.expert.material.v1",
        packet.revision.acceptance_epoch,
        &packet.revision.paths,
        &packet.revision.identities,
        context,
        references,
    ))
}

pub fn concern_target(packet: &ExpertPacket, result: &ExpertResult) -> String {
    result
        .references
        .first()
        .filter(|id| !id.starts_with("evidence::"))
        .cloned()
        .unwrap_or_else(|| packet.event.task.clone())
}

pub fn validate_settings(
    settings: &PolicySettings,
    judgment: &Judgment,
) -> Result<(), PolicyError> {
    if !safe_identifier(&settings.binding_id)
        || settings.rules.is_empty()
        || settings.rules.len() > 16
        || !safe_identifier(&settings.calibration.record_id)
        || settings.calibration.thresholds.len() > 16
        || [
            &settings.calibration.question_fingerprint,
            &settings.calibration.template_fingerprint,
            &settings.calibration.policy_fingerprint,
            &settings.calibration.development_fingerprint,
        ]
        .iter()
        .any(|id| !safe_identifier(id))
    {
        return Err(PolicyError::InvalidSettings);
    }
    let mut ids = BTreeSet::new();
    let mut thresholds = BTreeSet::new();
    for rule in &settings.rules {
        if !safe_identifier(&rule.id) || !ids.insert(&rule.id) {
            return Err(PolicyError::InvalidSettings);
        }
        let compatible = match (&rule.predicate, &judgment.output) {
            (Predicate::ChoiceLabel { label }, JudgmentOutput::Choice { alternatives }) => {
                alternatives.contains(label)
            }
            (
                Predicate::NoulValue { .. } | Predicate::NoulProbability { .. },
                JudgmentOutput::Noul { .. },
            ) => true,
            (Predicate::ScoreLevel { level }, JudgmentOutput::Score { levels }) => {
                levels.contains(level)
            }
            (Predicate::ScoreTail { from_level }, JudgmentOutput::Score { levels }) => {
                levels.contains(from_level)
            }
            _ => false,
        };
        if !compatible {
            return Err(PolicyError::InvalidSettings);
        }
        if matches!(
            rule.predicate,
            Predicate::NoulProbability { .. } | Predicate::ScoreTail { .. }
        ) {
            thresholds.insert(rule.id.clone());
            if settings
                .calibration
                .thresholds
                .get(&rule.id)
                .is_none_or(|value| !value.is_finite() || !(0.0..=1.0).contains(value))
            {
                return Err(PolicyError::InvalidSettings);
            }
        }
        if matches!(
            rule.outcome,
            AdvisoryOutcome::Nudge | AdvisoryOutcome::Escalation
        ) {
            if rule
                .template
                .is_none_or(|template| !judgment.templates.contains(&template))
            {
                return Err(PolicyError::InvalidSettings);
            }
        } else if rule.template.is_some() {
            return Err(PolicyError::InvalidSettings);
        }
        if let ReferenceSelection::Identity { id } = &rule.reference
            && !safe_identifier(id)
        {
            return Err(PolicyError::InvalidSettings);
        }
    }
    if settings
        .calibration
        .thresholds
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>()
        != thresholds
    {
        return Err(PolicyError::InvalidSettings);
    }
    Ok(())
}

pub fn outcome(
    request: &EvaluationRequest,
    outcome: AdvisoryOutcome,
    reason: &str,
) -> ExpertResult {
    ExpertResult {
        request_id: request.request_id.clone(),
        packet_hash: request.packet.hash.clone(),
        outcome,
        references: vec![],
        template: None,
        message: None,
        reason: reason.into(),
    }
}

fn predicate_matches(
    rule: &PolicyRule,
    settings: &PolicySettings,
    judgment: &Judgment,
    answer: &TypedAnswer,
) -> Result<bool, &'static str> {
    let threshold = |probability: f64| {
        let threshold = settings.calibration.thresholds[&rule.id];
        if (probability - threshold).abs() <= provider::PROBABILITY_TOLERANCE {
            Err("rounding_uncertainty")
        } else {
            Ok(probability > threshold)
        }
    };
    match (&rule.predicate, answer) {
        (Predicate::ChoiceLabel { label }, TypedAnswer::Choice { pick, .. }) => Ok(label == pick),
        (
            Predicate::NoulValue { value },
            TypedAnswer::Noul {
                value: Some(actual),
                ..
            },
        ) => Ok(value == actual),
        (
            Predicate::NoulProbability { value },
            TypedAnswer::Noul {
                probability: Some(probability),
                ..
            },
        ) => threshold(if *value {
            *probability
        } else {
            1.0 - probability
        }),
        (
            Predicate::ScoreLevel { level },
            TypedAnswer::Score {
                level: Some(actual),
                ..
            },
        ) => Ok(level == actual),
        (
            Predicate::ScoreTail { from_level },
            TypedAnswer::Score {
                distribution: Some(distribution),
                ..
            },
        ) => {
            let JudgmentOutput::Score { levels } = &judgment.output else {
                return Err("invalid_settings");
            };
            let start = levels
                .iter()
                .position(|level| level == from_level)
                .ok_or("invalid_settings")?;
            threshold(distribution[start..].iter().sum())
        }
        _ => Err("missing_answer_statistic"),
    }
}

fn selected_references(
    rule: &PolicyRule,
    request: &EvaluationRequest,
    answer: &TypedAnswer,
) -> Result<Vec<String>, PolicyError> {
    let packet = &request.packet;
    let references = match &rule.reference {
        ReferenceSelection::Slot { slot } => packet
            .context
            .get(slot)
            .map(|value| {
                value
                    .observations()
                    .iter()
                    .map(|observation| observation.id.clone())
                    .filter(|id| packet.references.contains_key(id))
                    .collect()
            })
            .unwrap_or_default(),
        ReferenceSelection::Identity { id } => vec![id.clone()],
        ReferenceSelection::Task => vec![packet.event.task.clone()],
        ReferenceSelection::SelectedCandidate => {
            let TypedAnswer::Choice { pick, .. } = answer else {
                return Err(PolicyError::UnknownReference);
            };
            let selected = packet
                .context
                .get(&ContextSlot::Candidates)
                .and_then(|value| {
                    value.observations().iter().find(|observation| {
                        observation.text.starts_with(&format!("{pick}: "))
                            || observation.text.starts_with(&format!("{pick}="))
                    })
                })
                .map(|observation| observation.id.clone())
                .ok_or(PolicyError::UnknownReference)?;
            vec![selected]
        }
    };
    if references.is_empty()
        || references.len() > 4
        || references.iter().any(|id| !reference_resolves(packet, id))
    {
        return Err(PolicyError::UnknownReference);
    }
    Ok(references)
}

fn reference_resolves(packet: &ExpertPacket, id: &str) -> bool {
    safe_identifier(id)
        && (packet.references.contains_key(id)
            || (id == packet.event.task
                && packet.context.get(&ContextSlot::Task).is_some_and(|value| {
                    value.observations().iter().any(|observation| {
                        observation.id == id && observation.capture == "local:task-record"
                    })
                })))
}

pub fn decide(
    request: &EvaluationRequest,
    response: &EvaluationResponse,
    settings: &PolicySettings,
    history: &[InterventionSummary],
) -> ExpertResult {
    if packet::validate_packet(&request.packet, &request.judgment, &ExpertLimits::default())
        .is_err()
        || !safe_identifier(&request.request_id)
    {
        return outcome(request, AdvisoryOutcome::Abstain, "invalid_packet");
    }
    if request.question_fingerprint != question_fingerprint(&request.judgment)
        || request.template_fingerprint != template_fingerprint(&request.judgment)
    {
        return outcome(request, AdvisoryOutcome::Abstain, "definition_mismatch");
    }
    if provider::validate_response(request, response.clone()).is_err() {
        return outcome(request, AdvisoryOutcome::Abstain, "invalid_response");
    }
    if validate_settings(settings, &request.judgment).is_err()
        || settings.binding_id != request.packet.binding_id
    {
        return outcome(request, AdvisoryOutcome::Abstain, "invalid_settings");
    }
    let calibration = &settings.calibration;
    if calibration.provider != response.provider
        || calibration.question_fingerprint != request.question_fingerprint
        || calibration.template_fingerprint != request.template_fingerprint
        || calibration.policy_fingerprint != policy_fingerprint(settings)
    {
        return outcome(request, AdvisoryOutcome::Abstain, "calibration_mismatch");
    }
    let answer = match &response.outcome {
        Ok(answer) => answer,
        Err(failure) => {
            return outcome(
                request,
                AdvisoryOutcome::Abstain,
                &format!("provider_{failure}"),
            );
        }
    };
    if request.judgment.name == "expertise-selection" {
        return outcome(request, AdvisoryOutcome::Silence, "expertise_pair_required");
    }
    for rule in &settings.rules {
        match predicate_matches(rule, settings, &request.judgment, answer) {
            Ok(false) => continue,
            Err(reason) => return outcome(request, AdvisoryOutcome::Abstain, reason),
            Ok(true) => (),
        }
        let mut result = outcome(request, rule.outcome, "mapped_answer");
        if !matches!(
            rule.outcome,
            AdvisoryOutcome::Nudge | AdvisoryOutcome::Escalation
        ) {
            return result;
        }
        result.references = match selected_references(rule, request, answer) {
            Ok(references) => references,
            Err(_) => return outcome(request, AdvisoryOutcome::Abstain, "unknown_reference"),
        };
        let material = material_fingerprint(&request.packet);
        if history.iter().any(|entry| {
            entry.concern == settings.concern.code()
                && (entry.target == concern_target(&request.packet, &result)
                    || result.references.contains(&entry.target))
                && entry.evidence_revision == material
                && matches!(
                    entry.state,
                    DeliveryState::Proposed
                        | DeliveryState::Delivered
                        | DeliveryState::Acknowledged
                        | DeliveryState::Declined
                        | DeliveryState::Unknown
                )
        }) {
            return outcome(request, AdvisoryOutcome::Silence, "unresolved_concern");
        }
        result.template = rule.template;
        result.message = match render(&result, &request.packet) {
            Ok(message) => Some(message),
            Err(_) => return outcome(request, AdvisoryOutcome::Abstain, "unknown_reference"),
        };
        return result;
    }
    outcome(request, AdvisoryOutcome::Silence, "no_matching_rule")
}

pub fn render(result: &ExpertResult, packet: &ExpertPacket) -> Result<String, PolicyError> {
    if !matches!(
        result.outcome,
        AdvisoryOutcome::Nudge | AdvisoryOutcome::Escalation
    ) || result.references.is_empty()
        || result.references.len() > 4
        || result
            .references
            .iter()
            .any(|id| !reference_resolves(packet, id))
        || result.packet_hash != packet.hash
    {
        return Err(PolicyError::UnknownReference);
    }
    let targets = result.references.join(", ");
    let task = &packet.event.task;
    if !safe_identifier(task) {
        return Err(PolicyError::UnknownReference);
    }
    let message = match result.template.ok_or(PolicyError::InvalidTemplate)? {
        TemplateKind::ReadIdentity => {
            format!("{task}: read {targets} before choosing the next approach.")
        }
        TemplateKind::CiteEvidence => {
            format!("{task}: reconsider the claim against {targets}; cite the observed evidence.")
        }
        TemplateKind::ReconsiderApproach => {
            format!("{task}: reconsider the approach against {targets} before repeating it.")
        }
        TemplateKind::AskOwner => {
            format!("{task}: ask the task owner to decide the concern identified by {targets}.")
        }
    };
    if message.len() > 2048 || packet::redact(&message) != message {
        return Err(PolicyError::LimitExceeded);
    }
    Ok(message)
}

pub fn priority(settings: &PolicySettings) -> (ConcernKind, &str) {
    (settings.concern, &settings.binding_id)
}
