use super::syntax::Block;
use super::{Memory, expect_fields, expect_keywords, safe_references, text};
use crate::diagnostic::Diagnostic;
use serde::Serialize;
use std::collections::BTreeSet;

pub const DIRECTORY: &str = "knowledge";

pub const AUTHORITY: &str = include_str!("../cli/text/authority-knowledge.md");

#[derive(Clone, Debug, Serialize)]
pub struct Pack {
    pub name: String,
    pub purpose: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Ruling {
    pub name: String,
    pub pack: String,
    pub statement: String,
}

impl Ruling {
    pub fn id(&self) -> String {
        format!("ruling::{}::{}", self.pack, self.name)
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct KnowledgeMemory {
    pub packs: Vec<Pack>,
    pub rulings: Vec<Ruling>,
}

impl KnowledgeMemory {
    pub fn declares(&self, pack: &str) -> bool {
        self.packs.iter().any(|declared| declared.name == pack)
    }

    pub fn pack_names(&self) -> Vec<&str> {
        self.packs.iter().map(|pack| pack.name.as_str()).collect()
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct KnowledgeStatus {
    pub files: Vec<String>,
    pub state: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub packs: Vec<String>,
    pub rulings: usize,
    pub authority: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct KnowledgeExplainView {
    pub kind: &'static str,
    pub id: String,
    pub statement: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pack: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub rulings: Vec<String>,
    pub authority: &'static str,
}

pub fn build(blocks: &[Block]) -> Result<KnowledgeMemory, Diagnostic> {
    expect_keywords(blocks, &["knowledge", "ruling"])?;
    let mut memory = KnowledgeMemory::default();
    for block in blocks {
        match block.keyword.as_str() {
            "knowledge" => {
                expect_fields(block, &["purpose"], &[])?;
                memory.packs.push(Pack {
                    name: block.name.clone(),
                    purpose: text(block, "purpose")?,
                });
            }
            _ => {
                expect_fields(block, &["pack", "statement"], &[])?;
                safe_references(block.field("pack"))?;
                memory.rulings.push(Ruling {
                    name: block.name.clone(),
                    pack: text(block, "pack")?,
                    statement: text(block, "statement")?,
                });
            }
        }
    }
    Ok(memory)
}

pub fn validate(memory: &KnowledgeMemory) -> Vec<String> {
    let mut problems = Vec::new();
    let mut packs: BTreeSet<&str> = BTreeSet::new();
    for pack in &memory.packs {
        if !packs.insert(pack.name.as_str()) {
            problems.push(format!(
                "the pack {:?} is declared twice; knowledge::{} must resolve to one pack",
                pack.name, pack.name
            ));
        }
    }
    let mut identities: BTreeSet<String> = BTreeSet::new();
    for ruling in &memory.rulings {
        if !memory.declares(&ruling.pack) {
            problems.push(format!(
                "ruling {:?} belongs to pack {:?}, which is not a declared pack",
                ruling.name, ruling.pack
            ));
            continue;
        }
        if !identities.insert(ruling.id()) {
            problems.push(format!(
                "pack {:?} declares the ruling {:?} twice; ruling names are unique inside a pack and may repeat between packs",
                ruling.pack, ruling.name
            ));
        }
    }
    for pack in &memory.packs {
        if !memory.rulings.iter().any(|ruling| ruling.pack == pack.name) {
            problems.push(format!(
                "pack {:?} declares no ruling; a pack that routing points at must carry expertise",
                pack.name
            ));
        }
    }
    problems
}

pub fn status(memory: &Memory<KnowledgeMemory>, files: &[String]) -> Option<KnowledgeStatus> {
    if matches!(memory, Memory::Unregistered) {
        return None;
    }
    let present = memory.present();
    Some(KnowledgeStatus {
        files: files.to_vec(),
        state: memory.state(),
        problems: memory.problems(),
        packs: present
            .map(|memory| {
                memory
                    .packs
                    .iter()
                    .map(|pack| format!("knowledge::{}", pack.name))
                    .collect()
            })
            .unwrap_or_default(),
        rulings: present.map(|memory| memory.rulings.len()).unwrap_or(0),
        authority: AUTHORITY,
    })
}

pub fn canonical(memory: &Memory<KnowledgeMemory>, query: &str) -> Vec<String> {
    let Some(memory) = memory.present() else {
        return Vec::new();
    };
    match parse(query) {
        Query::Pack(name) => {
            if memory.declares(name) {
                vec![format!("knowledge::{name}")]
            } else {
                Vec::new()
            }
        }
        Query::Ruling(pack, name) => memory
            .rulings
            .iter()
            .filter(|ruling| ruling.pack == pack && ruling.name == name)
            .map(Ruling::id)
            .collect(),
        Query::PackRulings(pack) => memory
            .rulings
            .iter()
            .filter(|ruling| ruling.pack == pack)
            .map(Ruling::id)
            .collect(),
        Query::Bare(name) => {
            let mut found: Vec<String> = memory
                .declares(name)
                .then(|| format!("knowledge::{name}"))
                .into_iter()
                .collect();
            found.extend(
                memory
                    .rulings
                    .iter()
                    .filter(|ruling| ruling.name == name)
                    .map(Ruling::id),
            );
            found
        }
    }
}

pub fn explain(memory: &Memory<KnowledgeMemory>, query: &str) -> Option<KnowledgeExplainView> {
    let memory = memory.present()?;
    match parse(query) {
        Query::Pack(name) | Query::Bare(name) if memory.declares(name) => {
            let pack = memory.packs.iter().find(|pack| pack.name == name)?;
            Some(KnowledgeExplainView {
                kind: "knowledge",
                id: format!("knowledge::{}", pack.name),
                statement: pack.purpose.clone(),
                pack: None,
                rulings: memory
                    .rulings
                    .iter()
                    .filter(|ruling| ruling.pack == pack.name)
                    .map(Ruling::id)
                    .collect(),
                authority: AUTHORITY,
            })
        }
        Query::Ruling(pack, name) => {
            let ruling = memory
                .rulings
                .iter()
                .find(|ruling| ruling.pack == pack && ruling.name == name)?;
            Some(KnowledgeExplainView {
                kind: "ruling",
                id: ruling.id(),
                statement: ruling.statement.clone(),
                pack: Some(format!("knowledge::{}", ruling.pack)),
                rulings: Vec::new(),
                authority: AUTHORITY,
            })
        }
        _ => None,
    }
}

enum Query<'a> {
    Pack(&'a str),
    Ruling(&'a str, &'a str),
    PackRulings(&'a str),
    Bare(&'a str),
}

fn parse(query: &str) -> Query<'_> {
    if let Some(rest) = query.strip_prefix("knowledge::") {
        return Query::Pack(rest);
    }
    match query.strip_prefix("ruling::") {
        Some(rest) => match rest.split_once("::") {
            Some((pack, name)) => Query::Ruling(pack, name),
            None => Query::PackRulings(rest),
        },
        None => Query::Bare(query),
    }
}
