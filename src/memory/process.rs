use super::syntax::Block;
use super::{Memory, expect_fields, expect_keywords, list, safe_references, text};
use crate::diagnostic::Diagnostic;
use serde::Serialize;
use std::collections::BTreeMap;

pub const FILE_NAME: &str = "process.bla";

pub const AUTHORITY: &str = include_str!("../cli/text/authority-process.md");

#[derive(Clone, Debug, Serialize)]
pub struct Role {
    pub name: String,
    pub purpose: String,
    pub owns: Vec<String>,
    pub verification: Option<String>,
    pub model: Vec<String>,
    pub consult: Vec<String>,
    pub block_below: i64,
}

impl Role {
    pub fn floor(&self) -> u8 {
        u8::try_from(self.block_below.clamp(0, 100)).unwrap_or(0)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Policy {
    pub name: String,
    pub statement: String,
    pub applies_to: Vec<String>,
    pub consult: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Flow {
    pub name: String,
    pub purpose: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Step {
    pub name: String,
    pub flow: String,
    pub role: Vec<String>,
    pub statement: String,
    pub command: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Alias {
    pub name: String,
    pub model: String,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct ProcessMemory {
    pub roles: Vec<Role>,
    pub policies: Vec<Policy>,
    pub flows: Vec<Flow>,
    pub steps: Vec<Step>,
    pub aliases: Vec<Alias>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProcessStatus {
    pub file: String,
    pub state: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub roles: Vec<String>,
    pub policies: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub flows: Vec<String>,
    pub steps: usize,
    pub authority: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProcessExplainView {
    pub kind: &'static str,
    pub id: String,
    pub statement: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub owns: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub model: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_below: Option<i64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub policies: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub applies_to: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub consult: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub authority: &'static str,
}

pub fn build(blocks: &[Block]) -> Result<ProcessMemory, Diagnostic> {
    expect_keywords(blocks, &["role", "policy", "flow", "step", "alias"])?;
    let mut memory = ProcessMemory::default();
    for block in blocks {
        match block.keyword.as_str() {
            "role" => {
                expect_fields(
                    block,
                    &["purpose"],
                    &["owns", "verification", "model", "consult", "block_below"],
                )?;
                safe_references(block.field("consult"))?;
                let block_below = match block.field("block_below") {
                    None => 0,
                    Some(field) => text(block, "block_below")?.trim().parse().map_err(|_| {
                        Diagnostic {
                            location: field.location.clone(),
                            code: "E_MEMORY_FIELD".into(),
                            message: format!(
                                "`block_below` in `role {:?}` takes a whole-number percentage such as \"70\"",
                                block.name
                            ),
                        }
                    })?,
                };
                memory.roles.push(Role {
                    name: block.name.clone(),
                    purpose: text(block, "purpose")?,
                    owns: list(block, "owns"),
                    verification: block
                        .field("verification")
                        .map(|_| text(block, "verification"))
                        .transpose()?,
                    model: list(block, "model"),
                    consult: list(block, "consult"),
                    block_below,
                });
            }
            "flow" => {
                expect_fields(block, &["purpose"], &[])?;
                memory.flows.push(Flow {
                    name: block.name.clone(),
                    purpose: text(block, "purpose")?,
                });
            }
            "step" => {
                expect_fields(block, &["flow", "role", "statement"], &["command"])?;
                safe_references(block.field("flow"))?;
                safe_references(block.field("role"))?;
                memory.steps.push(Step {
                    name: block.name.clone(),
                    flow: text(block, "flow")?,
                    role: list(block, "role"),
                    statement: text(block, "statement")?,
                    command: block
                        .field("command")
                        .map(|_| text(block, "command"))
                        .transpose()?,
                });
            }
            "alias" => {
                expect_fields(block, &["model"], &[])?;
                memory.aliases.push(Alias {
                    name: block.name.clone(),
                    model: text(block, "model")?.to_owned(),
                });
            }
            _ => {
                expect_fields(block, &["statement", "applies_to"], &["consult"])?;
                safe_references(block.field("applies_to"))?;
                safe_references(block.field("consult"))?;
                memory.policies.push(Policy {
                    name: block.name.clone(),
                    statement: text(block, "statement")?,
                    applies_to: list(block, "applies_to"),
                    consult: list(block, "consult"),
                });
            }
        }
    }
    Ok(memory)
}

pub fn validate(memory: &ProcessMemory) -> Vec<String> {
    let mut problems = Vec::new();
    let mut declared: Vec<(&str, &'static str)> = Vec::new();
    declared.extend(
        memory
            .roles
            .iter()
            .map(|role| (role.name.as_str(), "a role")),
    );
    declared.extend(
        memory
            .policies
            .iter()
            .map(|policy| (policy.name.as_str(), "a policy")),
    );
    declared.extend(
        memory
            .flows
            .iter()
            .map(|flow| (flow.name.as_str(), "a flow")),
    );
    declared.extend(
        memory
            .steps
            .iter()
            .map(|step| (step.name.as_str(), "a step")),
    );
    declared.extend(
        memory
            .aliases
            .iter()
            .map(|alias| (alias.name.as_str(), "an alias")),
    );
    let mut seen: BTreeMap<&str, &'static str> = BTreeMap::new();
    for (name, kind) in declared {
        if let Some(previous) = seen.insert(name, kind) {
            problems.push(format!(
                "the name {name:?} is declared twice, as {previous} and as {kind}; every name must resolve to one entry"
            ));
        }
    }
    for role in &memory.roles {
        if !(0..=100).contains(&role.block_below) {
            problems.push(format!(
                "role {:?} declares block_below {}, outside 0..100; it is the percentage of stated confidence below which a decision blocks the task until the orchestrator answers it",
                role.name, role.block_below
            ));
        }
    }
    for policy in &memory.policies {
        if policy.applies_to.is_empty() {
            problems.push(format!(
                "policy {:?} applies to no role; a policy names the roles it binds",
                policy.name
            ));
        }
        for role in &policy.applies_to {
            if !memory.roles.iter().any(|declared| declared.name == *role) {
                problems.push(format!(
                    "policy {:?} applies to {role:?}, which is not a declared role",
                    policy.name
                ));
            }
        }
    }
    for step in &memory.steps {
        if !memory.flows.iter().any(|flow| flow.name == step.flow) {
            problems.push(format!(
                "step {:?} belongs to flow {:?}, which is not a declared flow",
                step.name, step.flow
            ));
        }
        if step.role.is_empty() {
            problems.push(format!(
                "step {:?} names no role; a step says which role carries it",
                step.name
            ));
        }
        for carrier in &step.role {
            if !memory.roles.iter().any(|role| role.name == *carrier) {
                problems.push(format!(
                    "step {:?} is carried by {carrier:?}, which is not a declared role",
                    step.name
                ));
            }
        }
    }
    for flow in &memory.flows {
        if !memory.steps.iter().any(|step| step.flow == flow.name) {
            problems.push(format!(
                "flow {:?} declares no step; a flow whose steps are absent describes no loop",
                flow.name
            ));
        }
    }
    for alias in &memory.aliases {
        if !memory
            .roles
            .iter()
            .any(|role| role.model.iter().any(|m| m == &alias.model))
        {
            problems.push(format!(
                "alias {:?} declares model {:?}, which no role lists; an alias must stand for a model in a role's permitted list",
                alias.name, alias.model
            ));
        }
    }
    problems
}

pub fn status(memory: &Memory<ProcessMemory>, file: &str) -> Option<ProcessStatus> {
    if matches!(memory, Memory::Unregistered) {
        return None;
    }
    Some(ProcessStatus {
        file: file.to_owned(),
        state: memory.state(),
        problems: memory.problems(),
        roles: memory
            .present()
            .map(|memory| {
                memory
                    .roles
                    .iter()
                    .map(|role| format!("role::{}", role.name))
                    .collect()
            })
            .unwrap_or_default(),
        policies: memory
            .present()
            .map(|memory| memory.policies.len())
            .unwrap_or(0),
        flows: memory
            .present()
            .map(|memory| {
                memory
                    .flows
                    .iter()
                    .map(|flow| format!("flow::{}", flow.name))
                    .collect()
            })
            .unwrap_or_default(),
        steps: memory
            .present()
            .map(|memory| memory.steps.len())
            .unwrap_or(0),
        authority: AUTHORITY,
    })
}

pub fn permitted_models(memory: &ProcessMemory, role_name: &str) -> Vec<String> {
    let role = match memory.roles.iter().find(|r| r.name == role_name) {
        Some(r) => r,
        None => return Vec::new(),
    };
    let mut result = Vec::new();
    for model in &role.model {
        result.push(model.clone());
        for alias in &memory.aliases {
            if alias.model == *model {
                result.push(alias.name.clone());
            }
        }
    }
    result
}

pub fn model_named_by(memory: &ProcessMemory, model: &str) -> String {
    memory
        .aliases
        .iter()
        .find(|alias| alias.name == model)
        .map_or(model, |alias| alias.model.as_str())
        .to_owned()
}

pub fn canonical(memory: &Memory<ProcessMemory>, query: &str) -> Vec<String> {
    let Some(memory) = memory.present() else {
        return Vec::new();
    };
    let (wanted, name) = split(query);
    let mut found = Vec::new();
    if wanted.is_none_or(|kind| kind == "role") && memory.roles.iter().any(|role| role.name == name)
    {
        found.push(format!("role::{name}"));
    }
    if wanted.is_none_or(|kind| kind == "policy")
        && memory.policies.iter().any(|policy| policy.name == name)
    {
        found.push(format!("policy::{name}"));
    }
    if wanted.is_none_or(|kind| kind == "flow") && memory.flows.iter().any(|flow| flow.name == name)
    {
        found.push(format!("flow::{name}"));
    }
    if wanted.is_none_or(|kind| kind == "step") && memory.steps.iter().any(|step| step.name == name)
    {
        found.push(format!("step::{name}"));
    }
    found
}

pub fn explain(memory: &Memory<ProcessMemory>, query: &str) -> Option<ProcessExplainView> {
    let memory = memory.present()?;
    let (wanted, name) = split(query);
    let blank = ProcessExplainView {
        kind: "role",
        id: query.to_owned(),
        statement: String::new(),
        owns: Vec::new(),
        verification: None,
        model: Vec::new(),
        block_below: None,
        policies: Vec::new(),
        applies_to: Vec::new(),
        consult: Vec::new(),
        steps: Vec::new(),
        flow: None,
        command: None,
        authority: AUTHORITY,
    };
    if wanted.is_none_or(|kind| kind == "role")
        && let Some(role) = memory.roles.iter().find(|role| role.name == name)
    {
        let models = role
            .model
            .iter()
            .map(|model| {
                let aliases_for_model: Vec<_> = memory
                    .aliases
                    .iter()
                    .filter(|alias| &alias.model == model)
                    .map(|alias| alias.name.clone())
                    .collect();
                if aliases_for_model.is_empty() {
                    model.clone()
                } else {
                    format!("{}  (aliases: {})", model, aliases_for_model.join(", "))
                }
            })
            .collect();
        return Some(ProcessExplainView {
            id: format!("role::{}", role.name),
            statement: role.purpose.clone(),
            owns: role.owns.clone(),
            verification: role.verification.clone(),
            model: models,
            block_below: Some(role.block_below),
            policies: memory
                .policies
                .iter()
                .filter(|policy| policy.applies_to.contains(&role.name))
                .map(|policy| format!("policy::{}  {}", policy.name, policy.statement))
                .collect(),
            consult: packs(&role.consult),
            steps: memory
                .steps
                .iter()
                .filter(|step| step.role.contains(&role.name))
                .map(|step| format!("step::{}  flow::{}", step.name, step.flow))
                .collect(),
            ..blank
        });
    }
    if wanted.is_none_or(|kind| kind == "policy")
        && let Some(policy) = memory.policies.iter().find(|policy| policy.name == name)
    {
        return Some(ProcessExplainView {
            kind: "policy",
            id: format!("policy::{}", policy.name),
            statement: policy.statement.clone(),
            applies_to: policy
                .applies_to
                .iter()
                .map(|role| format!("role::{role}"))
                .collect(),
            consult: packs(&policy.consult),
            ..blank
        });
    }
    if wanted.is_none_or(|kind| kind == "flow")
        && let Some(flow) = memory.flows.iter().find(|flow| flow.name == name)
    {
        return Some(ProcessExplainView {
            kind: "flow",
            id: format!("flow::{}", flow.name),
            statement: flow.purpose.clone(),
            steps: memory
                .steps
                .iter()
                .filter(|step| step.flow == flow.name)
                .map(|step| {
                    let command = step
                        .command
                        .as_deref()
                        .unwrap_or("carried by judgment; no command");
                    format!(
                        "step::{}  {}  {command}",
                        step.name,
                        carriers(&step.role).join(" ")
                    )
                })
                .collect(),
            ..blank
        });
    }
    if wanted.is_none_or(|kind| kind == "step")
        && let Some(step) = memory.steps.iter().find(|step| step.name == name)
    {
        return Some(ProcessExplainView {
            kind: "step",
            id: format!("step::{}", step.name),
            statement: step.statement.clone(),
            flow: Some(format!("flow::{}", step.flow)),
            applies_to: carriers(&step.role),
            command: step.command.clone(),
            ..blank
        });
    }
    None
}

fn carriers(names: &[String]) -> Vec<String> {
    names.iter().map(|role| format!("role::{role}")).collect()
}

fn packs(names: &[String]) -> Vec<String> {
    names
        .iter()
        .map(|pack| format!("knowledge::{pack}"))
        .collect()
}

fn split(query: &str) -> (Option<&str>, &str) {
    for kind in ["role", "policy", "flow", "step"] {
        if let Some(name) = query
            .strip_prefix(kind)
            .and_then(|rest| rest.strip_prefix("::"))
        {
            return (Some(kind), name);
        }
    }
    (None, query)
}
