use super::syntax::Block;
use super::{Memory, expect_fields, expect_keywords, list, safe_references, text};
use crate::diagnostic::Diagnostic;
use serde::Serialize;
use std::collections::BTreeMap;

pub const FILE_NAME: &str = "system.bla";

pub const AUTHORITY: &str = include_str!("../cli/text/authority-system.md");

#[derive(Clone, Debug, Serialize)]
pub struct System {
    pub name: String,
    pub purpose: String,
    pub paths: Vec<String>,
    pub knowledge: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Responsibility {
    pub name: String,
    pub statement: String,
    pub owner: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Seam {
    pub name: String,
    pub statement: String,
    pub between: Vec<String>,
    pub value: String,
    pub moves_with: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct SystemMemory {
    pub systems: Vec<System>,
    pub responsibilities: Vec<Responsibility>,
    pub seams: Vec<Seam>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SystemStatus {
    pub file: String,
    pub state: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub systems: Vec<String>,
    pub responsibilities: usize,
    pub seams: usize,
    pub authority: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct SystemExplainView {
    pub kind: &'static str,
    pub id: String,
    pub statement: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub owns: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub between: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub seams: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub moves_with: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub knowledge: Vec<String>,
    pub authority: &'static str,
}

pub fn build(blocks: &[Block]) -> Result<SystemMemory, Diagnostic> {
    expect_keywords(blocks, &["system", "responsibility", "seam"])?;
    let mut memory = SystemMemory::default();
    for block in blocks {
        match block.keyword.as_str() {
            "system" => {
                expect_fields(block, &["purpose"], &["paths", "knowledge"])?;
                safe_references(block.field("knowledge"))?;
                memory.systems.push(System {
                    name: block.name.clone(),
                    purpose: text(block, "purpose")?,
                    paths: list(block, "paths"),
                    knowledge: list(block, "knowledge"),
                });
            }
            "responsibility" => {
                expect_fields(block, &["owner", "statement"], &[])?;
                safe_references(block.field("owner"))?;
                memory.responsibilities.push(Responsibility {
                    name: block.name.clone(),
                    statement: text(block, "statement")?,
                    owner: text(block, "owner")?,
                });
            }
            _ => {
                expect_fields(block, &["between", "value", "statement"], &["moves_with"])?;
                safe_references(block.field("between"))?;
                memory.seams.push(Seam {
                    name: block.name.clone(),
                    statement: text(block, "statement")?,
                    between: list(block, "between"),
                    value: text(block, "value")?,
                    moves_with: list(block, "moves_with"),
                });
            }
        }
    }
    Ok(memory)
}

pub fn validate(memory: &SystemMemory) -> Vec<String> {
    let mut problems = Vec::new();
    let mut declared: Vec<(&str, &'static str)> = Vec::new();
    declared.extend(
        memory
            .systems
            .iter()
            .map(|system| (system.name.as_str(), "a system")),
    );
    declared.extend(
        memory
            .responsibilities
            .iter()
            .map(|responsibility| (responsibility.name.as_str(), "a responsibility")),
    );
    declared.extend(
        memory
            .seams
            .iter()
            .map(|seam| (seam.name.as_str(), "a seam")),
    );
    let mut seen: BTreeMap<&str, &'static str> = BTreeMap::new();
    for (name, kind) in declared {
        if let Some(previous) = seen.insert(name, kind) {
            problems.push(format!(
                "the name {name:?} is declared twice, as {previous} and as {kind}; every name must resolve to one entry"
            ));
        }
    }
    let known = |name: &str| memory.systems.iter().any(|system| system.name == name);
    for responsibility in &memory.responsibilities {
        if !known(&responsibility.owner) {
            problems.push(format!(
                "responsibility {:?} is owned by {:?}, which is not a declared system",
                responsibility.name, responsibility.owner
            ));
        }
    }
    for seam in &memory.seams {
        if seam.between.len() != 2 {
            problems.push(format!(
                "seam {:?} lists {} sides; a seam is between exactly two systems",
                seam.name,
                seam.between.len()
            ));
        }
        for side in &seam.between {
            if !known(side) {
                problems.push(format!(
                    "seam {:?} names {side:?}, which is not a declared system",
                    seam.name
                ));
            }
        }
    }
    problems
}

pub fn status(memory: &Memory<SystemMemory>, file: &str) -> Option<SystemStatus> {
    if matches!(memory, Memory::Unregistered) {
        return None;
    }
    Some(SystemStatus {
        file: file.to_owned(),
        state: memory.state(),
        problems: memory.problems(),
        systems: memory
            .present()
            .map(|memory| {
                memory
                    .systems
                    .iter()
                    .map(|system| format!("system::{}", system.name))
                    .collect()
            })
            .unwrap_or_default(),
        responsibilities: memory
            .present()
            .map(|memory| memory.responsibilities.len())
            .unwrap_or(0),
        seams: memory
            .present()
            .map(|memory| memory.seams.len())
            .unwrap_or(0),
        authority: AUTHORITY,
    })
}

pub fn canonical(memory: &Memory<SystemMemory>, query: &str) -> Vec<String> {
    let Some(memory) = memory.present() else {
        return Vec::new();
    };
    let (wanted, name) = split(query);
    let mut found = Vec::new();
    if wanted.is_none_or(|kind| kind == "system")
        && memory.systems.iter().any(|system| system.name == name)
    {
        found.push(format!("system::{name}"));
    }
    if wanted.is_none_or(|kind| kind == "responsibility")
        && memory
            .responsibilities
            .iter()
            .any(|responsibility| responsibility.name == name)
    {
        found.push(format!("responsibility::{name}"));
    }
    if wanted.is_none_or(|kind| kind == "seam") && memory.seams.iter().any(|seam| seam.name == name)
    {
        found.push(format!("seam::{name}"));
    }
    found
}

pub fn explain(memory: &Memory<SystemMemory>, query: &str) -> Option<SystemExplainView> {
    let memory = memory.present()?;
    let (wanted, name) = split(query);
    let blank = SystemExplainView {
        kind: "system",
        id: query.to_owned(),
        statement: String::new(),
        paths: Vec::new(),
        owns: Vec::new(),
        owner: None,
        between: Vec::new(),
        value: None,
        seams: Vec::new(),
        moves_with: Vec::new(),
        knowledge: Vec::new(),
        authority: AUTHORITY,
    };
    if wanted.is_none_or(|kind| kind == "system")
        && let Some(system) = memory.systems.iter().find(|system| system.name == name)
    {
        return Some(SystemExplainView {
            id: format!("system::{}", system.name),
            statement: system.purpose.clone(),
            paths: system.paths.clone(),
            owns: memory
                .responsibilities
                .iter()
                .filter(|responsibility| responsibility.owner == system.name)
                .map(|responsibility| {
                    format!(
                        "responsibility::{}  {}",
                        responsibility.name, responsibility.statement
                    )
                })
                .collect(),
            seams: memory
                .seams
                .iter()
                .filter(|seam| seam.between.contains(&system.name))
                .map(|seam| {
                    let other = seam
                        .between
                        .iter()
                        .find(|side| **side != system.name)
                        .cloned()
                        .unwrap_or_default();
                    format!(
                        "seam::{}  with system::{other}, value {}",
                        seam.name, seam.value
                    )
                })
                .collect(),
            knowledge: system
                .knowledge
                .iter()
                .map(|pack| format!("knowledge::{pack}"))
                .collect(),
            ..blank
        });
    }
    if wanted.is_none_or(|kind| kind == "responsibility")
        && let Some(responsibility) = memory
            .responsibilities
            .iter()
            .find(|responsibility| responsibility.name == name)
    {
        return Some(SystemExplainView {
            kind: "responsibility",
            id: format!("responsibility::{}", responsibility.name),
            statement: responsibility.statement.clone(),
            owner: Some(format!("system::{}", responsibility.owner)),
            ..blank
        });
    }
    if wanted.is_none_or(|kind| kind == "seam")
        && let Some(seam) = memory.seams.iter().find(|seam| seam.name == name)
    {
        return Some(SystemExplainView {
            kind: "seam",
            id: format!("seam::{}", seam.name),
            statement: seam.statement.clone(),
            between: seam
                .between
                .iter()
                .map(|side| format!("system::{side}"))
                .collect(),
            value: Some(seam.value.clone()),
            moves_with: seam.moves_with.clone(),
            ..blank
        });
    }
    None
}

fn split(query: &str) -> (Option<&str>, &str) {
    for kind in ["system", "responsibility", "seam"] {
        if let Some(name) = query
            .strip_prefix(kind)
            .and_then(|rest| rest.strip_prefix("::"))
        {
            return (Some(kind), name);
        }
    }
    (None, query)
}
