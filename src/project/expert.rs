use super::Project;
use crate::expert::{ContextSlot, ExpertMode};
use crate::memory::goal::{self, GoalMemory};
use crate::memory::knowledge::{self, KnowledgeMemory};
use crate::memory::mission::{self, MissionMemory};
use crate::memory::process::{self, ProcessMemory};
use crate::memory::system::{self, SystemMemory};
use crate::memory::{self, Memory, routing};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpertStatus {
    pub mode: ExpertMode,
    pub bindings: usize,
    pub host: String,
    pub provider: String,
}

pub fn status(
    knowledge: &Memory<KnowledgeMemory>,
    process: &Memory<ProcessMemory>,
) -> Option<ExpertStatus> {
    let bindings = process
        .present()
        .map_or(0, |process| process.bindings.len());
    let judgments = knowledge
        .present()
        .map_or(0, |knowledge| knowledge.judgments.len());
    if bindings == 0 && judgments == 0 {
        return None;
    }
    Some(ExpertStatus {
        mode: if bindings == 0 {
            ExpertMode::Off
        } else {
            ExpertMode::Shadow
        },
        bindings,
        host: "unknown".to_owned(),
        provider: "unknown".to_owned(),
    })
}

pub fn validate_bindings(project: &Project) -> Vec<String> {
    let Some(entry) = &project.manifest.process else {
        return Vec::new();
    };
    let process = memory::read(
        &entry.path,
        &entry.display,
        process::build,
        process::validate,
    );
    let Some(process) = process.present() else {
        return process.problems();
    };
    let knowledge_entries = project
        .manifest
        .knowledge
        .iter()
        .map(|entry| (entry.path.as_path(), entry.display.as_str()))
        .collect::<Vec<_>>();
    let knowledge = if knowledge_entries.is_empty() {
        Memory::Unregistered
    } else {
        memory::read_all(&knowledge_entries, knowledge::build, knowledge::validate)
    };
    let mission = read_optional(
        project.manifest.mission.as_ref(),
        mission::build,
        mission::validate,
    );
    let goal = read_optional(project.manifest.goal.as_ref(), goal::build, goal::validate);
    let system = read_optional(
        project.manifest.system.as_ref(),
        system::build,
        system::validate,
    );
    let goal_serving = goal
        .present()
        .map(|memory| goal::serving_problems(memory, &mission))
        .unwrap_or_default();
    let system_routing = system
        .present()
        .map(|memory| routing::system_problems(memory, &knowledge))
        .unwrap_or_default();
    let goal = goal.with_problems(goal_serving);
    let system = system.with_problems(system_routing);
    binding_problems(project, process, &knowledge, &mission, &goal, &system)
}

fn read_optional<T>(
    entry: Option<&super::MemoryEntry>,
    build: fn(&[memory::syntax::Block]) -> Result<T, crate::diagnostic::Diagnostic>,
    validate: fn(&T) -> Vec<String>,
) -> Memory<T> {
    match entry {
        Some(entry) => memory::read(&entry.path, &entry.display, build, validate),
        None => Memory::Unregistered,
    }
}

fn binding_problems(
    project: &Project,
    process: &ProcessMemory,
    knowledge: &Memory<KnowledgeMemory>,
    mission: &Memory<MissionMemory>,
    goal: &Memory<GoalMemory>,
    system: &Memory<SystemMemory>,
) -> Vec<String> {
    let mut problems = Vec::new();
    for binding in &process.bindings {
        let judgment = knowledge.present().and_then(|memory| {
            memory
                .judgments
                .iter()
                .find(|judgment| judgment.id() == binding.judgment)
        });
        let Some(judgment) = judgment else {
            problems.push(format!(
                "{} names unresolved judgment {:?}",
                binding.id(),
                binding.judgment
            ));
            continue;
        };
        for (slot, references) in &binding.context {
            for reference in references {
                let resolved = match slot {
                    ContextSlot::Goal => goal.present().is_some_and(|memory| {
                        memory.goals.iter().any(|goal| goal.id() == *reference)
                    }),
                    ContextSlot::Mission => mission
                        .present()
                        .and_then(|memory| memory.mission.as_ref())
                        .is_some_and(|mission| format!("mission::{}", mission.name) == *reference),
                    ContextSlot::System => system.present().is_some_and(|memory| {
                        memory
                            .systems
                            .iter()
                            .any(|system| format!("system::{}", system.name) == *reference)
                    }),
                    ContextSlot::Candidates => resolves_knowledge(knowledge, reference, true),
                    ContextSlot::Rules => {
                        resolves_knowledge(knowledge, reference, false)
                            || resolves_rule(project, reference)
                    }
                    _ => false,
                };
                if !resolved {
                    problems.push(format!(
                        "{} has unresolved or wrong-kind {slot:?} reference {reference:?}",
                        binding.id()
                    ));
                }
            }
        }
        for template in &judgment.templates {
            let available = template.reference_slots().iter().any(|slot| {
                *slot == ContextSlot::Task
                    || judgment.requires.contains(slot)
                    || judgment.optional.contains(slot)
                    || binding
                        .context
                        .get(slot)
                        .is_some_and(|references| !references.is_empty())
            });
            if !available {
                problems.push(format!(
                    "{} cannot supply references for template {template:?}",
                    binding.id()
                ));
            }
        }
    }
    problems
}

fn resolves_knowledge(memory: &Memory<KnowledgeMemory>, identity: &str, packs: bool) -> bool {
    let Some(memory) = memory.present() else {
        return false;
    };
    memory.rulings.iter().any(|ruling| ruling.id() == identity)
        || (packs
            && memory
                .packs
                .iter()
                .any(|pack| format!("knowledge::{}", pack.name) == identity))
}

fn resolves_rule(project: &Project, identity: &str) -> bool {
    project.rules.iter().any(|rule| rule.id == identity)
        || project
            .structure
            .iter()
            .flat_map(|contract| &contract.rules)
            .any(|rule| rule.id == identity)
        || project
            .groups
            .iter()
            .any(|group| format!("contract::{}", group.name) == identity)
}

pub fn judgment_source(project: &Project, identity: &str) -> Option<String> {
    project.manifest.knowledge.iter().find_map(|entry| {
        let source = std::fs::read_to_string(&entry.path).ok()?;
        let blocks = memory::syntax::parse(&entry.display, &source).ok()?;
        let memory = knowledge::build(&blocks).ok()?;
        memory
            .judgments
            .iter()
            .any(|judgment| judgment.id() == identity)
            .then(|| entry.display.clone())
    })
}

pub fn binding_source(project: &Project) -> Option<&str> {
    project
        .manifest
        .process
        .as_ref()
        .map(|entry| entry.display.as_str())
}

use super::task::{self, Task};
use crate::expert::packet::{self, ContextValue, ExpertPacket, PacketError};
use crate::expert::{
    EventStamp, ExpertLimits, InterventionSummary, Observation, ObservedEvent, ObservedFact,
    PacketAccounting, SourceKind,
};
use crate::memory::process::JudgmentBinding;
use std::collections::{BTreeMap, BTreeSet};

struct PacketMemory {
    knowledge: KnowledgeMemory,
    process: ProcessMemory,
    mission: Memory<MissionMemory>,
    goal: Memory<GoalMemory>,
    system: Memory<SystemMemory>,
}

impl PacketMemory {
    fn load(project: &Project) -> Result<Self, PacketError> {
        let entries = project
            .manifest
            .knowledge
            .iter()
            .map(|entry| (entry.path.as_path(), entry.display.as_str()))
            .collect::<Vec<_>>();
        let knowledge = memory::read_all(&entries, knowledge::build, knowledge::validate);
        let process = read_optional(
            project.manifest.process.as_ref(),
            process::build,
            process::validate,
        );
        Ok(Self {
            knowledge: knowledge
                .present()
                .cloned()
                .ok_or(PacketError::UnresolvedReference)?,
            process: process
                .present()
                .cloned()
                .ok_or(PacketError::UnresolvedReference)?,
            mission: read_optional(
                project.manifest.mission.as_ref(),
                mission::build,
                mission::validate,
            ),
            goal: read_optional(project.manifest.goal.as_ref(), goal::build, goal::validate),
            system: read_optional(
                project.manifest.system.as_ref(),
                system::build,
                system::validate,
            ),
        })
    }

    fn resolve(&self, project: &Project, identity: &str) -> Option<String> {
        if packet::redact(identity) != identity {
            return None;
        }
        if let Some(view) = knowledge::explain(&Memory::Present(self.knowledge.clone()), identity)
            && view.id == identity
        {
            if view.kind == "knowledge" {
                let rulings = self
                    .knowledge
                    .rulings
                    .iter()
                    .filter(|r| format!("knowledge::{}", r.pack) == identity)
                    .map(|r| (&r.name, &r.statement))
                    .collect::<Vec<_>>();
                return serde_json::to_string(&(view.statement, rulings)).ok();
            }
            return Some(view.statement);
        }
        if let Some(goal) = self
            .goal
            .present()
            .and_then(|m| m.goals.iter().find(|g| g.id() == identity))
        {
            return serde_json::to_string(goal).ok();
        }
        if let Some(view) = mission::explain(&self.mission, identity).filter(|v| v.id == identity) {
            return serde_json::to_string(&(view.statement, view.priorities, view.non_goals)).ok();
        }
        if let Some(view) = system::explain(&self.system, identity).filter(|v| v.id == identity) {
            return serde_json::to_string(&(view.statement, view.owns, view.seams, view.knowledge))
                .ok();
        }
        if let Some(rule) = project.rules.iter().find(|rule| rule.id == identity) {
            return Some(rule.source.clone());
        }
        if let Some(rule) = project.structure_rules().find(|rule| rule.id == identity) {
            return Some(rule.source.clone());
        }
        let name = identity.strip_prefix("contract::")?;
        if !project.groups.iter().any(|group| group.name == name) {
            return None;
        }
        let rules = project
            .rules
            .iter()
            .filter(|rule| rule.group == name)
            .map(|rule| (&rule.id, &rule.source))
            .collect::<Vec<_>>();
        let structure = project
            .structure_rules()
            .filter(|rule| rule.id.starts_with(&format!("{name}::")))
            .map(|rule| (&rule.id, &rule.source))
            .collect::<Vec<_>>();
        serde_json::to_string(&(rules, structure)).ok()
    }
}

pub fn resolve_references(
    project: &Project,
    identities: &BTreeSet<String>,
) -> Result<BTreeMap<String, String>, PacketError> {
    let memory = PacketMemory::load(project)?;
    identities
        .iter()
        .map(|identity| {
            memory
                .resolve(project, identity)
                .map(|source| (identity.clone(), source))
                .ok_or(PacketError::UnresolvedReference)
        })
        .collect()
}

pub fn build_packet(
    project: &Project,
    task: &Task,
    event: &ObservedEvent,
    binding: &JudgmentBinding,
    limits: &ExpertLimits,
    history: &[InterventionSummary],
) -> Result<ExpertPacket, PacketError> {
    let current_project = super::read_manifest(&project.manifest.path)
        .and_then(super::load)
        .map_err(|_| PacketError::UnresolvedRevision)?;
    let project = &current_project;
    let stamp = EventStamp::from(event);
    packet::validate_event(&stamp)?;
    if limits.packet_bytes == 0
        || limits.excerpt_bytes == 0
        || limits.history_entries > 8
        || limits.judgments_per_checkpoint == 0
        || limits.judgments_per_checkpoint > 4
    {
        return Err(PacketError::LimitExceeded);
    }
    if event.task != format!("task::{}", task.name)
        || !binding
            .roles
            .iter()
            .any(|role| role.trim_start_matches("role::") == task.role.trim_start_matches("role::"))
        || !binding.checkpoints.contains(&event.kind)
    {
        return Err(PacketError::InvalidEvent);
    }
    if !validate_bindings(project).is_empty() {
        return Err(PacketError::UnresolvedReference);
    }
    let memory = PacketMemory::load(project)?;
    if !memory
        .process
        .bindings
        .iter()
        .any(|current| current == binding)
    {
        return Err(PacketError::UnresolvedRevision);
    }
    let judgment = memory
        .knowledge
        .judgments
        .iter()
        .find(|j| j.id() == binding.judgment)
        .ok_or(PacketError::UnresolvedReference)?;
    let slots: BTreeSet<_> = judgment
        .requires
        .iter()
        .chain(&judgment.optional)
        .copied()
        .collect();
    let mut identities = compatible_fingerprints(&memory, task, event, binding, judgment, limits)?;
    let mut context = BTreeMap::new();
    let mut references = BTreeMap::new();
    let mut omitted = 0usize;
    for slot in &slots {
        let mut resolved = Vec::new();
        let mut reference_omissions = 0usize;
        let declared = binding.context.get(slot).cloned().unwrap_or_else(|| {
            if *slot == ContextSlot::Goal {
                task.goal
                    .as_ref()
                    .map(|goal| {
                        if goal.starts_with("goal::") {
                            goal.clone()
                        } else {
                            format!("goal::{goal}")
                        }
                    })
                    .into_iter()
                    .collect()
            } else {
                Vec::new()
            }
        });
        if *slot == ContextSlot::Candidates && declared.len() > 4 {
            return Err(PacketError::LimitExceeded);
        }
        for (index, identity) in declared.iter().enumerate() {
            let source = memory
                .resolve(project, identity)
                .ok_or(PacketError::UnresolvedReference)?;
            identities.insert(identity.clone(), packet::digest(&source));
            let (text, lost) = packet::bounded(&source, limits.excerpt_bytes);
            references.insert(identity.clone(), text.clone());
            omitted = omitted.saturating_add(lost);
            reference_omissions = reference_omissions.saturating_add(lost);
            resolved.push(Observation {
                id: identity.clone(),
                slot: *slot,
                kind: SourceKind::DeterministicOutput,
                capture: "local:registered-memory".into(),
                observed_revision: String::new(),
                text: if *slot == ContextSlot::Candidates {
                    format!("candidate-{}: {text}", index + 1)
                } else {
                    text
                },
                fact: None,
            });
        }
        context.insert(
            *slot,
            if resolved.is_empty() {
                if matches!(slot, ContextSlot::Claim | ContextSlot::Proposal) {
                    ContextValue::Unknown
                } else {
                    ContextValue::Missing
                }
            } else if reference_omissions > 0 {
                ContextValue::Truncated {
                    observations: resolved,
                    omitted_bytes: reference_omissions,
                }
            } else {
                ContextValue::Present {
                    observations: resolved,
                }
            },
        );
    }
    let tree = super::snapshot(&project.manifest.root, &project.ignore);
    if task.name.is_empty()
        || task.name.len() > 128
        || !task
            .name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err(PacketError::InvalidEvent);
    }
    let stored = task::read(&project.manifest.root, &task.name)
        .map_err(|_| PacketError::UnresolvedRevision)?
        .ok_or(PacketError::UnresolvedRevision)?;
    if stored.state != task.state
        || packet::digest(&stored.evidence) != packet::digest(&task.evidence)
        || task::revision::relevant_revision(&stored, &tree, BTreeMap::new())
            != task::revision::relevant_revision(task, &tree, BTreeMap::new())
    {
        return Err(PacketError::UnresolvedRevision);
    }
    let revision = task::revision::relevant_revision(task, &tree, identities);
    if revision
        .paths
        .keys()
        .any(|path| packet::redact(path) != *path)
    {
        return Err(PacketError::UnresolvedRevision);
    }
    let fingerprint = revision.fingerprint();
    for value in context.values_mut() {
        if let ContextValue::Present { observations }
        | ContextValue::Truncated { observations, .. } = value
        {
            for observation in observations {
                observation.observed_revision = fingerprint.clone();
            }
        }
    }
    if slots.contains(&ContextSlot::Task) {
        let selected = serde_json::json!({"id": format!("task::{}", task.name), "statement": task.statement, "role": task.role, "goal": task.goal, "scope": task.scope, "check": task::declared_check(task), "state": task.state, "readiness": task::tracked_readiness(task, &project.manifest.root, &project.ignore, &tree), "unresolved_findings": task.unresolved().map(|f| (&f.id, &f.statement)).collect::<Vec<_>>(), "blocked": task.state == "blocked", "successful_current_check": task::tracked_readiness(task, &project.manifest.root, &project.ignore, &tree).supported});
        context.insert(
            ContextSlot::Task,
            ContextValue::Present {
                observations: vec![Observation {
                    id: format!("task::{}", task.name),
                    slot: ContextSlot::Task,
                    kind: SourceKind::DeterministicOutput,
                    capture: "local:task-record".into(),
                    observed_revision: fingerprint.clone(),
                    text: selected.to_string(),
                    fact: Some(ObservedFact::TaskState {
                        task: format!("task::{}", task.name),
                        state: task.state.clone(),
                    }),
                }],
            },
        );
    }
    let mut seen = BTreeSet::new();
    let mut supplied = event.observations.iter().collect::<Vec<_>>();
    supplied.sort_by(|a, b| (a.slot, &a.id).cmp(&(b.slot, &b.id)));
    for observation in supplied {
        if references.contains_key(&observation.id)
            || !seen.insert(observation.id.clone())
            || observation.id.trim().is_empty()
            || observation.id.len() > 256
            || packet::redact(&observation.id) != observation.id
            || observation
                .capture
                .to_ascii_lowercase()
                .starts_with("local:")
            || observation.capture.len() > 256
            || packet::redact(&observation.capture) != observation.capture
            || observation
                .capture
                .to_ascii_lowercase()
                .contains("transcript")
            || observation
                .capture
                .to_ascii_lowercase()
                .contains("session-store")
            || observation.kind == SourceKind::DeterministicOutput
            || observation.id.starts_with("evidence::")
            || observation.id.starts_with("task::")
        {
            return Err(PacketError::InvalidEvent);
        }
        if !slots.contains(&observation.slot)
            || !matches!(
                observation.slot,
                ContextSlot::Claim
                    | ContextSlot::Proposal
                    | ContextSlot::Evidence
                    | ContextSlot::Attempts
            )
        {
            continue;
        }
        if observation.observed_revision != fingerprint {
            context.insert(
                observation.slot,
                ContextValue::Unavailable {
                    reason: "observed_revision_mismatch".into(),
                },
            );
            continue;
        }
        let mut selected = observation.clone();
        selected.fact = None;
        match context.get_mut(&selected.slot) {
            Some(ContextValue::Present { observations }) => observations.push(selected),
            Some(ContextValue::Unavailable { .. }) => (),
            _ => {
                context.insert(
                    selected.slot,
                    ContextValue::Present {
                        observations: vec![selected],
                    },
                );
            }
        }
    }
    let current_inputs = task::tracking_error(task, &project.manifest.root, &project.ignore)
        .is_none()
        .then(|| task::evidence_inputs(task, &tree));
    omitted = omitted.saturating_add(collect_evidence(
        task,
        current_inputs.as_ref(),
        &fingerprint,
        &slots,
        &mut context,
        &mut references,
        limits,
    ));
    let relevant_history = history
        .iter()
        .filter(|h| h.target == event.task || references.contains_key(&h.target))
        .collect::<Vec<_>>();
    omitted = omitted.saturating_add(
        relevant_history
            .iter()
            .take(
                relevant_history
                    .len()
                    .saturating_sub(limits.history_entries),
            )
            .flat_map(|h| [&h.request_id, &h.concern, &h.target, &h.evidence_revision])
            .map(String::len)
            .fold(0usize, usize::saturating_add),
    );
    let mut selected_history = history
        .iter()
        .filter(|h| h.target == event.task || references.contains_key(&h.target))
        .rev()
        .take(limits.history_entries)
        .cloned()
        .collect::<Vec<_>>();
    selected_history.reverse();
    for summary in &mut selected_history {
        for text in [
            &mut summary.request_id,
            &mut summary.concern,
            &mut summary.target,
            &mut summary.evidence_revision,
        ] {
            let (bounded, lost) = packet::bounded(text, limits.excerpt_bytes);
            *text = bounded;
            omitted = omitted.saturating_add(lost);
        }
    }
    for value in context.values_mut() {
        let mut lost = 0usize;
        let prior_lost = match value {
            ContextValue::Truncated { omitted_bytes, .. } => *omitted_bytes,
            _ => 0,
        };
        if let ContextValue::Present { observations }
        | ContextValue::Truncated { observations, .. } = value
        {
            for observation in observations.iter_mut() {
                let (text, bytes) = packet::bounded(&observation.text, limits.excerpt_bytes);
                observation.text = text;
                lost = lost.saturating_add(bytes);
                if let Some(ObservedFact::CommandExit { argv, .. }) = &mut observation.fact {
                    for arg in argv {
                        *arg = packet::bounded(arg, limits.excerpt_bytes).0;
                    }
                }
            }
            if lost > 0 {
                *value = ContextValue::Truncated {
                    observations: observations.clone(),
                    omitted_bytes: prior_lost.saturating_add(lost),
                };
                omitted = omitted.saturating_add(lost);
            }
        }
    }
    let mut packet = ExpertPacket {
        event: stamp,
        binding_id: binding.id(),
        revision,
        context,
        references,
        history: selected_history,
        accounting: PacketAccounting {
            selected_bytes: 0,
            omitted_bytes: omitted,
            estimated_tokens: 0,
            provider_tokens: None,
        },
        hash: String::new(),
    };
    packet.accounting.selected_bytes = packet::selected_bytes(&packet);
    packet.accounting.estimated_tokens = packet.accounting.selected_bytes.div_ceil(4);
    packet.hash = packet::canonical_hash(&packet);
    if serde_json::to_vec(&packet)
        .map_err(|_| PacketError::InvalidEvent)?
        .len()
        > limits.packet_bytes
    {
        return Err(PacketError::LimitExceeded);
    }
    Ok(packet)
}

fn compatible_fingerprints(
    memory: &PacketMemory,
    task: &Task,
    event: &ObservedEvent,
    binding: &JudgmentBinding,
    judgment: &knowledge::Judgment,
    limits: &ExpertLimits,
) -> Result<BTreeMap<String, String>, PacketError> {
    let required = judgment.requires.iter().copied().collect::<BTreeSet<_>>();
    let optional = judgment.optional.iter().copied().collect::<BTreeSet<_>>();
    let mut fingerprints = BTreeMap::new();
    let mut count = 0usize;
    for candidate in &memory.process.bindings {
        if !candidate
            .roles
            .iter()
            .any(|role| role.trim_start_matches("role::") == task.role.trim_start_matches("role::"))
            || !candidate.checkpoints.contains(&event.kind)
            || candidate.context != binding.context
        {
            continue;
        }
        let Some(definition) = memory
            .knowledge
            .judgments
            .iter()
            .find(|j| j.id() == candidate.judgment)
        else {
            continue;
        };
        if definition.requires.iter().copied().collect::<BTreeSet<_>>() != required
            || definition.optional.iter().copied().collect::<BTreeSet<_>>() != optional
        {
            continue;
        }
        count += 1;
        if count > limits.judgments_per_checkpoint {
            return Err(PacketError::LimitExceeded);
        }
        fingerprints.insert(candidate.id(), packet::digest(candidate));
        fingerprints.insert(definition.id(), packet::digest(definition));
    }
    Ok(fingerprints)
}

fn collect_evidence(
    task: &Task,
    current_inputs: Option<&BTreeMap<String, Option<String>>>,
    revision: &str,
    slots: &BTreeSet<ContextSlot>,
    context: &mut BTreeMap<ContextSlot, ContextValue>,
    references: &mut BTreeMap<String, String>,
    limits: &ExpertLimits,
) -> usize {
    if !slots.contains(&ContextSlot::Evidence) && !slots.contains(&ContextSlot::Attempts) {
        return 0;
    }
    let mut omitted_by_slot: BTreeMap<ContextSlot, usize> = BTreeMap::new();
    let mut omitted_references = 0usize;
    for (position, (index, evidence)) in task.evidence.iter().enumerate().rev().enumerate() {
        let id = format!("evidence::{}::{}", task.name, index + 1);
        let current = task::evidence_matches(task, evidence)
            && current_inputs.is_some_and(|inputs| evidence.inputs == *inputs);
        let captured = evidence.tool == "run"
            && matches!((&evidence.identity, &evidence.command), (Some(task::CheckIdentity::Argv { argv }), Some(command)) if argv == command);
        let observed = current && captured;
        let text = serde_json::json!({"id": id, "check": evidence.identity, "exit": evidence.exit, "current": current, "observed": captured, "acceptance_epoch": evidence.acceptance_epoch}).to_string();
        for slot in [ContextSlot::Evidence, ContextSlot::Attempts] {
            if !slots.contains(&slot) || (slot == ContextSlot::Evidence && !current) {
                continue;
            }
            if position >= limits.history_entries {
                let bytes = packet::redact(&text).len();
                let total = omitted_by_slot.entry(slot).or_default();
                *total = total.saturating_add(bytes);
                continue;
            }
            let observation = Observation {
                id: id.clone(),
                slot,
                kind: if captured {
                    SourceKind::DeterministicOutput
                } else {
                    SourceKind::WorkerStatement
                },
                capture: "local:task-evidence".into(),
                observed_revision: revision.into(),
                text: text.clone(),
                fact: if observed {
                    Some(ObservedFact::CommandExit {
                        argv: evidence.command.clone().expect("observed command"),
                        exit: evidence.exit,
                    })
                } else {
                    None
                },
            };
            if captured {
                references.insert(id.clone(), packet::bounded(&text, limits.excerpt_bytes).0);
            }
            match context.get_mut(&slot) {
                Some(ContextValue::Present { observations }) => observations.push(observation),
                Some(ContextValue::Unavailable { .. }) => (),
                _ => {
                    context.insert(
                        slot,
                        ContextValue::Present {
                            observations: vec![observation],
                        },
                    );
                }
            }
        }
        if position >= limits.history_entries
            && captured
            && (slots.contains(&ContextSlot::Attempts)
                || (current && slots.contains(&ContextSlot::Evidence)))
        {
            omitted_references = omitted_references.saturating_add(packet::redact(&text).len());
        }
    }
    let mut omitted_total = omitted_references;
    for (slot, omitted_bytes) in omitted_by_slot {
        omitted_total = omitted_total.saturating_add(omitted_bytes);
        let existing = context.remove(&slot);
        let value = match existing {
            Some(ContextValue::Present { observations }) => ContextValue::Truncated {
                observations,
                omitted_bytes,
            },
            Some(ContextValue::Truncated {
                observations,
                omitted_bytes: prior,
            }) => ContextValue::Truncated {
                observations,
                omitted_bytes: prior.saturating_add(omitted_bytes),
            },
            Some(ContextValue::Unavailable { reason }) => ContextValue::Unavailable { reason },
            _ => ContextValue::Truncated {
                observations: Vec::new(),
                omitted_bytes,
            },
        };
        context.insert(slot, value);
    }
    omitted_total
}
