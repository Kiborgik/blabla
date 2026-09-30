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
