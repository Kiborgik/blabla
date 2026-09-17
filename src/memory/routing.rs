use super::Memory;
use super::knowledge::KnowledgeMemory;
use super::process::ProcessMemory;
use super::system::SystemMemory;

pub fn system_problems(system: &SystemMemory, knowledge: &Memory<KnowledgeMemory>) -> Vec<String> {
    let mut problems = Vec::new();
    for declared in &system.systems {
        for pack in &declared.knowledge {
            if let Some(reason) = unresolved(knowledge, pack) {
                problems.push(format!(
                    "system {:?} names knowledge pack {pack:?}, but {reason}",
                    declared.name
                ));
            }
        }
    }
    problems
}

pub fn process_problems(
    process: &ProcessMemory,
    knowledge: &Memory<KnowledgeMemory>,
) -> Vec<String> {
    let mut problems = Vec::new();
    for role in &process.roles {
        for pack in &role.consult {
            if let Some(reason) = unresolved(knowledge, pack) {
                problems.push(format!(
                    "role {:?} consults knowledge pack {pack:?}, but {reason}",
                    role.name
                ));
            }
        }
    }
    for policy in &process.policies {
        for pack in &policy.consult {
            if let Some(reason) = unresolved(knowledge, pack) {
                problems.push(format!(
                    "policy {:?} consults knowledge pack {pack:?}, but {reason}",
                    policy.name
                ));
            }
        }
    }
    problems
}

fn unresolved(knowledge: &Memory<KnowledgeMemory>, pack: &str) -> Option<String> {
    match knowledge {
        Memory::Present(memory) if memory.declares(pack) => None,
        Memory::Present(memory) => Some(format!(
            "no registered pack declares it; declared packs are {}",
            declared(&memory.pack_names())
        )),
        Memory::Unregistered | Memory::Ignored(_) => Some(
            "no knowledge memory is registered; register the pack with `knowledge \"path\"` in project.bla".to_owned(),
        ),
        other => Some(format!(
            "knowledge memory is {}, so no pack resolves",
            other.state()
        )),
    }
}

fn declared(names: &[&str]) -> String {
    if names.is_empty() {
        return "none".to_owned();
    }
    names.join(", ")
}
