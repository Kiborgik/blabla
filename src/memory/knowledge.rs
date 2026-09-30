use super::syntax::Block;
use super::{
    Memory, expect_fields, expect_keywords, field_error, safe_references, string_list, text,
};
use crate::diagnostic::Diagnostic;
use crate::expert::{ContextSlot, TemplateKind};
use serde::{Deserialize, Serialize};
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Judgment {
    pub name: String,
    pub pack: String,
    pub purpose: String,
    pub question: String,
    pub criteria: String,
    pub requires: Vec<ContextSlot>,
    pub optional: Vec<ContextSlot>,
    pub output: JudgmentOutput,
    pub templates: Vec<TemplateKind>,
}

impl Judgment {
    pub fn id(&self) -> String {
        format!("judgment::{}::{}", self.pack, self.name)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum JudgmentOutput {
    Choice { alternatives: Vec<String> },
    Noul { proposition: String },
    Score { levels: Vec<String> },
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct KnowledgeMemory {
    pub packs: Vec<Pack>,
    pub rulings: Vec<Ruling>,
    pub judgments: Vec<Judgment>,
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
    pub judgments: usize,
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
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub judgments: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub judgment: Option<Judgment>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub references: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub authority: &'static str,
}

pub fn build(blocks: &[Block]) -> Result<KnowledgeMemory, Diagnostic> {
    expect_keywords(blocks, &["knowledge", "ruling", "judgment"])?;
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
            "judgment" => memory.judgments.push(build_judgment(block)?),
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
    for judgment in &memory.judgments {
        if !memory.declares(&judgment.pack) {
            problems.push(format!("{} belongs to an undeclared pack", judgment.id()));
        }
        if !identities.insert(judgment.id()) {
            problems.push(format!("{} is declared twice", judgment.id()));
        }
    }
    for pack in &memory.packs {
        if !memory.rulings.iter().any(|ruling| ruling.pack == pack.name)
            && !memory
                .judgments
                .iter()
                .any(|judgment| judgment.pack == pack.name)
        {
            problems.push(format!(
                "pack {:?} declares no ruling or judgment; a pack that routing points at must carry expertise",
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
        judgments: present.map(|memory| memory.judgments.len()).unwrap_or(0),
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
        Query::Judgment(pack, name) => memory
            .judgments
            .iter()
            .filter(|judgment| judgment.pack == pack && judgment.name == name)
            .map(Judgment::id)
            .collect(),
        Query::PackJudgments(pack) => memory
            .judgments
            .iter()
            .filter(|judgment| judgment.pack == pack)
            .map(Judgment::id)
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
            found.extend(
                memory
                    .judgments
                    .iter()
                    .filter(|judgment| judgment.name == name)
                    .map(Judgment::id),
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
                judgments: memory
                    .judgments
                    .iter()
                    .filter(|judgment| judgment.pack == pack.name)
                    .map(Judgment::id)
                    .collect(),
                judgment: None,
                references: Vec::new(),
                source: None,
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
                judgments: Vec::new(),
                judgment: None,
                references: Vec::new(),
                source: None,
                authority: AUTHORITY,
            })
        }
        Query::Judgment(pack, name) => {
            let judgment = memory
                .judgments
                .iter()
                .find(|judgment| judgment.pack == pack && judgment.name == name)?;
            Some(KnowledgeExplainView {
                kind: "judgment",
                id: judgment.id(),
                statement: judgment.purpose.clone(),
                pack: Some(format!("knowledge::{}", judgment.pack)),
                rulings: Vec::new(),
                judgments: Vec::new(),
                judgment: Some(judgment.clone()),
                references: vec![format!("knowledge::{}", judgment.pack)],
                source: None,
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
    Judgment(&'a str, &'a str),
    PackJudgments(&'a str),
    Bare(&'a str),
}

fn parse(query: &str) -> Query<'_> {
    if let Some(rest) = query.strip_prefix("knowledge::") {
        return Query::Pack(rest);
    }
    if let Some(rest) = query.strip_prefix("judgment::") {
        return match rest.split_once("::") {
            Some((pack, name)) => Query::Judgment(pack, name),
            None => Query::PackJudgments(rest),
        };
    }
    match query.strip_prefix("ruling::") {
        Some(rest) => match rest.split_once("::") {
            Some((pack, name)) => Query::Ruling(pack, name),
            None => Query::PackRulings(rest),
        },
        None => Query::Bare(query),
    }
}

fn typed_list<T: Copy + Ord>(
    block: &Block,
    name: &str,
    parse: fn(&str) -> Option<T>,
) -> Result<Vec<T>, Diagnostic> {
    let mut found = BTreeSet::new();
    string_list(block, name)?
        .iter()
        .map(|value| {
            let value = parse(value)
                .ok_or_else(|| field_error(block, name, "contains an unsupported value"))?;
            if !found.insert(value) {
                return Err(field_error(block, name, "contains a duplicate value"));
            }
            Ok(value)
        })
        .collect()
}

fn ordered_labels(block: &Block, name: &str) -> Result<Vec<String>, Diagnostic> {
    let values = string_list(block, name)?;
    safe_references(block.field(name))?;
    if values.len() < 2 || values.iter().collect::<BTreeSet<_>>().len() != values.len() {
        return Err(field_error(
            block,
            name,
            "needs at least two distinct identity-safe labels",
        ));
    }
    Ok(values)
}

fn build_judgment(block: &Block) -> Result<Judgment, Diagnostic> {
    expect_fields(
        block,
        &[
            "pack",
            "purpose",
            "requires",
            "question",
            "criteria",
            "output",
            "templates",
        ],
        &["optional", "alternatives", "proposition", "levels"],
    )?;
    safe_references(block.field("pack"))?;
    let requires = typed_list(block, "requires", ContextSlot::from_authored)?;
    let optional = typed_list(block, "optional", ContextSlot::from_authored)?;
    if requires.iter().any(|slot| optional.contains(slot)) {
        return Err(field_error(block, "optional", "overlaps required context"));
    }
    let criteria = text(block, "criteria")?;
    if criteria.trim().is_empty() {
        return Err(field_error(block, "criteria", "cannot be empty"));
    }
    let output_name = text(block, "output")?;
    let output_field = match output_name.as_str() {
        "choice" => "alternatives",
        "noul" => "proposition",
        "score" => "levels",
        _ => {
            return Err(field_error(
                block,
                "output",
                "must be choice, noul or score",
            ));
        }
    };
    for field in ["alternatives", "proposition", "levels"] {
        if field != output_field && block.field(field).is_some() {
            return Err(field_error(
                block,
                field,
                "does not belong to this output kind",
            ));
        }
    }
    let output = match output_name.as_str() {
        "choice" => {
            let alternatives = ordered_labels(block, "alternatives")?;
            if alternatives
                .iter()
                .any(|label| label.starts_with("candidate-"))
                && alternatives.iter().any(|label| {
                    ![
                        "candidate-1",
                        "candidate-2",
                        "candidate-3",
                        "candidate-4",
                        "none",
                    ]
                    .contains(&label.as_str())
                })
            {
                return Err(field_error(
                    block,
                    "alternatives",
                    "contains an unsupported candidate label",
                ));
            }
            JudgmentOutput::Choice { alternatives }
        }
        "noul" => {
            let proposition = text(block, "proposition")?;
            if proposition.trim().is_empty() {
                return Err(field_error(block, "proposition", "cannot be empty"));
            }
            JudgmentOutput::Noul { proposition }
        }
        _ => JudgmentOutput::Score {
            levels: ordered_labels(block, "levels")?,
        },
    };
    Ok(Judgment {
        name: block.name.clone(),
        pack: text(block, "pack")?,
        purpose: text(block, "purpose")?,
        question: text(block, "question")?,
        criteria,
        requires,
        optional,
        output,
        templates: typed_list(block, "templates", TemplateKind::from_authored)?,
    })
}
