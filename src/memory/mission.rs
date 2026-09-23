use super::syntax::Block;
use super::{Memory, expect_fields, expect_keywords, list, text};
use crate::diagnostic::Diagnostic;
use serde::Serialize;
use std::collections::BTreeMap;

pub const FILE_NAME: &str = "mission.bla";

pub const AUTHORITY: &str = include_str!("../cli/text/authority-mission.md");

#[derive(Clone, Debug, Serialize)]
pub struct Mission {
    pub name: String,
    pub statement: String,
    pub non_goals: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Priority {
    pub name: String,
    pub statement: String,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct MissionMemory {
    pub mission: Option<Mission>,
    pub priorities: Vec<Priority>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MissionStatus {
    pub file: String,
    pub state: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mission: Option<String>,
    pub priorities: usize,
    pub non_goals: usize,
    pub authority: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct MissionExplainView {
    pub kind: &'static str,
    pub id: String,
    pub statement: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub priorities: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub non_goals: Vec<String>,
    pub authority: &'static str,
}

pub fn build(blocks: &[Block]) -> Result<MissionMemory, Diagnostic> {
    expect_keywords(blocks, &["mission", "priority"])?;
    let mut memory = MissionMemory::default();
    for block in blocks {
        match block.keyword.as_str() {
            "mission" => {
                expect_fields(block, &["statement"], &["non_goals"])?;
                if let Some(previous) = &memory.mission {
                    return Err(Diagnostic {
                        location: block.location.clone(),
                        code: "E_MEMORY_DECLARATION".into(),
                        message: format!(
                            "`mission {:?}` is a second mission declaration; a project states one mission, and {:?} is already declared",
                            block.name, previous.name
                        ),
                    });
                }
                memory.mission = Some(Mission {
                    name: block.name.clone(),
                    statement: text(block, "statement")?,
                    non_goals: list(block, "non_goals"),
                });
            }
            _ => {
                expect_fields(block, &["statement"], &[])?;
                memory.priorities.push(Priority {
                    name: block.name.clone(),
                    statement: text(block, "statement")?,
                });
            }
        }
    }
    Ok(memory)
}

pub fn validate(memory: &MissionMemory) -> Vec<String> {
    let mut problems = Vec::new();
    let Some(mission) = &memory.mission else {
        return vec![
            "no `mission` declaration; mission memory states the one thing this project is for, and priorities only qualify it".to_owned(),
        ];
    };
    let mut declared: Vec<(&str, &'static str)> = vec![(mission.name.as_str(), "the mission")];
    declared.extend(
        memory
            .priorities
            .iter()
            .map(|priority| (priority.name.as_str(), "a priority")),
    );
    let mut seen: BTreeMap<&str, &'static str> = BTreeMap::new();
    for (name, kind) in declared {
        if let Some(previous) = seen.insert(name, kind) {
            problems.push(format!(
                "the name {name:?} is declared twice, as {previous} and as {kind}; every name must resolve to one entry"
            ));
        }
    }
    problems
}

pub fn status(memory: &Memory<MissionMemory>, file: &str) -> Option<MissionStatus> {
    if matches!(memory, Memory::Unregistered) {
        return None;
    }
    let present = memory.present();
    Some(MissionStatus {
        file: file.to_owned(),
        state: memory.state(),
        problems: memory.problems(),
        mission: present
            .and_then(|memory| memory.mission.as_ref())
            .map(|mission| format!("mission::{}", mission.name)),
        priorities: present.map(|memory| memory.priorities.len()).unwrap_or(0),
        non_goals: present
            .and_then(|memory| memory.mission.as_ref())
            .map(|mission| mission.non_goals.len())
            .unwrap_or(0),
        authority: AUTHORITY,
    })
}

pub fn canonical(memory: &Memory<MissionMemory>, query: &str) -> Vec<String> {
    let Some(memory) = memory.present() else {
        return Vec::new();
    };
    let (wanted, name) = split(query);
    let mut found = Vec::new();
    if wanted.is_none_or(|kind| kind == "mission")
        && memory
            .mission
            .as_ref()
            .is_some_and(|mission| mission.name == name)
    {
        found.push(format!("mission::{name}"));
    }
    if wanted.is_none_or(|kind| kind == "priority")
        && memory
            .priorities
            .iter()
            .any(|priority| priority.name == name)
    {
        found.push(format!("priority::{name}"));
    }
    found
}

pub fn explain(memory: &Memory<MissionMemory>, query: &str) -> Option<MissionExplainView> {
    let memory = memory.present()?;
    let (wanted, name) = split(query);
    if wanted.is_none_or(|kind| kind == "mission")
        && let Some(mission) = memory
            .mission
            .as_ref()
            .filter(|mission| mission.name == name)
    {
        return Some(MissionExplainView {
            kind: "mission",
            id: format!("mission::{}", mission.name),
            statement: mission.statement.clone(),
            priorities: memory
                .priorities
                .iter()
                .map(|priority| format!("priority::{}  {}", priority.name, priority.statement))
                .collect(),
            non_goals: mission.non_goals.clone(),
            authority: AUTHORITY,
        });
    }
    if wanted.is_none_or(|kind| kind == "priority")
        && let Some(priority) = memory
            .priorities
            .iter()
            .find(|priority| priority.name == name)
    {
        return Some(MissionExplainView {
            kind: "priority",
            id: format!("priority::{}", priority.name),
            statement: priority.statement.clone(),
            priorities: Vec::new(),
            non_goals: Vec::new(),
            authority: AUTHORITY,
        });
    }
    None
}

fn split(query: &str) -> (Option<&str>, &str) {
    for kind in ["mission", "priority"] {
        if let Some(name) = query
            .strip_prefix(kind)
            .and_then(|rest| rest.strip_prefix("::"))
        {
            return (Some(kind), name);
        }
    }
    (None, query)
}
