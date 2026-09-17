#[cfg(test)]
mod tests;

use super::{
    DependencyTarget, EntryFact, Fact, ImportFact, Inspected, Literal, ModuleDecl, ModuleFacts,
    Polarity, Provider, RuleStatus, StructureContract, StructureRule, SymbolFact, evaluate_rule,
    module_names,
};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Falsifiable,
    Vacuous,
    Unevaluable,
}

impl Verdict {
    pub fn word(self) -> &'static str {
        match self {
            Verdict::Falsifiable => "FALSIFIABLE",
            Verdict::Vacuous => "VACUOUS",
            Verdict::Unevaluable => "UNEVALUABLE",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct RuleFalsification {
    pub id: String,
    pub label: String,
    pub file: String,
    pub line: usize,
    pub fact: String,
    pub requirement: String,
    pub status: RuleStatus,
    pub verdict: Verdict,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub counterfactual_status: Option<RuleStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub counterfactual: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finding: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FalsifyReport {
    pub invocations: usize,
    pub falsifiable: usize,
    pub vacuous: usize,
    pub unevaluable: usize,
    pub total: usize,
    pub rules: Vec<RuleFalsification>,
}

impl FalsifyReport {
    pub fn exit_code(&self) -> i32 {
        if self.vacuous > 0 {
            1
        } else if self.unevaluable > 0 {
            3
        } else {
            0
        }
    }

    pub fn findings(&self) -> impl Iterator<Item = &RuleFalsification> {
        self.rules
            .iter()
            .filter(|rule| rule.verdict != Verdict::Falsifiable)
    }
}

pub const LIMITS: [&str; 3] = [
    "FALSIFIABLE means the evaluator's verdict depends on the fact the rule names; it does not mean the rule names the right project concept, and it does not mean a real source edit would produce those facts.",
    "A counterfactual changes the observed facts, never the repository: nothing here was written, and one inspection produced every fact both verdicts were read from.",
    "This is a contract-author's check, not a completion signal; blabla status and blabla finish remain the authority over the whole project.",
];

pub fn falsify(
    contracts: &[StructureContract],
    root: &Path,
    providers: &[Box<dyn Provider>],
) -> FalsifyReport {
    let inspection = super::inspect(contracts, root, providers);
    let mut rules = Vec::new();
    for contract in contracts {
        for rule in &contract.rules {
            rules.push(examine(contract, rule, root, &inspection.modules));
        }
    }
    let count = |verdict: Verdict| rules.iter().filter(|rule| rule.verdict == verdict).count();
    FalsifyReport {
        invocations: inspection.invocations,
        falsifiable: count(Verdict::Falsifiable),
        vacuous: count(Verdict::Vacuous),
        unevaluable: count(Verdict::Unevaluable),
        total: rules.len(),
        rules,
    }
}

fn examine(
    contract: &StructureContract,
    rule: &StructureRule,
    root: &Path,
    observed: &BTreeMap<String, Inspected<'_>>,
) -> RuleFalsification {
    let actual = evaluate_rule(contract, rule, root, observed);
    let carry = |verdict, counterfactual_status, counterfactual, finding| RuleFalsification {
        id: actual.id.clone(),
        label: actual.label.clone(),
        file: actual.file.clone(),
        line: actual.line,
        fact: actual.fact.clone(),
        requirement: actual.requirement.clone(),
        status: actual.status,
        verdict,
        counterfactual_status,
        counterfactual,
        finding,
    };
    if actual.status == RuleStatus::Error {
        return carry(
            Verdict::Unevaluable,
            None,
            None,
            Some(format!(
                "the rule cannot be evaluated as it stands, so it has no observed truth value to invert: {}",
                actual.message
            )),
        );
    }
    let holds = matches!(
        (actual.status, rule.polarity),
        (RuleStatus::Green, Polarity::Require) | (RuleStatus::Red, Polarity::Forbid)
    );
    let counterfactual = match invert(contract, rule, root, observed, holds) {
        Ok(counterfactual) => counterfactual,
        Err(finding) => return carry(Verdict::Vacuous, None, None, Some(finding)),
    };
    let under = evaluate_rule(contract, rule, root, &counterfactual.modules);
    if under.status == RuleStatus::Error {
        return carry(
            Verdict::Vacuous,
            Some(under.status),
            Some(counterfactual.description),
            Some(format!(
                "the counterfactual observation cannot be evaluated: {}",
                under.message
            )),
        );
    }
    if under.status == actual.status {
        return carry(
            Verdict::Vacuous,
            Some(under.status),
            Some(counterfactual.description),
            Some(format!(
                "inverting the fact this rule names leaves it {}, so its verdict does not depend on that fact",
                actual.status.word()
            )),
        );
    }
    carry(
        Verdict::Falsifiable,
        Some(under.status),
        Some(counterfactual.description),
        None,
    )
}

struct Counterfactual<'a> {
    modules: BTreeMap<String, Inspected<'a>>,
    description: String,
}

fn invert<'a>(
    contract: &StructureContract,
    rule: &StructureRule,
    root: &Path,
    observed: &BTreeMap<String, Inspected<'a>>,
    holds: bool,
) -> Result<Counterfactual<'a>, String> {
    let module_by_name = |name: &str| contract.modules.iter().find(|module| module.name == name);
    let exists = |module: &ModuleDecl| {
        observed
            .get(&module.key())
            .and_then(|slot| slot.facts.as_ref().ok())
            .is_some_and(|facts| facts.exists)
    };
    let subject = module_by_name(rule.fact.modules()[0])
        .ok_or_else(|| "the rule names a module this contract does not declare".to_owned())?;
    let target = match &rule.fact {
        Fact::Dependency {
            to: DependencyTarget::Module(name),
            ..
        } => match module_by_name(name) {
            Some(target) => Some((target, exists(target))),
            None => return Err(format!("{name} is not a module this contract declares")),
        },
        _ => None,
    };
    let mut modules = observed.clone();
    let slot = modules
        .get_mut(&subject.key())
        .ok_or_else(|| format!("{} was not inspected", subject.display))?;
    let facts = slot.facts.as_mut().map_err(|failure| {
        format!(
            "{} was not inspected: {}",
            subject.display,
            failure.message()
        )
    })?;
    let description = match &rule.fact {
        Fact::Module { .. } => invert_module(subject, facts, holds),
        Fact::Symbol { path, .. } => invert_symbol(subject, facts, path, holds),
        Fact::Dependency { to, .. } => invert_dependency(subject, facts, to, target, root, holds),
        Fact::Contains { path, value, .. } => invert_contains(subject, facts, path, value, holds),
        Fact::Maps {
            path, key, value, ..
        } => invert_maps(subject, facts, path, key, value, holds),
    }?;
    Ok(Counterfactual {
        modules,
        description,
    })
}

fn absent_module(subject: &ModuleDecl, what: &str) -> String {
    format!(
        "{} does not exist, so the counterfactual would have to create the module rather than change whether it {what}",
        subject.display
    )
}

fn invert_module(
    subject: &ModuleDecl,
    facts: &mut ModuleFacts,
    holds: bool,
) -> Result<String, String> {
    if holds {
        *facts = ModuleFacts::default();
        Ok(format!("{} does not exist", subject.display))
    } else {
        facts.exists = true;
        Ok(format!("{} exists", subject.display))
    }
}

fn invert_symbol(
    subject: &ModuleDecl,
    facts: &mut ModuleFacts,
    path: &[String],
    holds: bool,
) -> Result<String, String> {
    let name = path.join(".");
    if holds {
        facts.symbols.retain(|symbol| symbol.path != path);
        return Ok(format!("{} does not define {name}", subject.display));
    }
    if !facts.exists {
        return Err(absent_module(subject, &format!("defines {name}")));
    }
    facts.symbols.push(SymbolFact {
        path: path.to_vec(),
        line: 0,
    });
    Ok(format!("{} defines {name}", subject.display))
}

fn invert_dependency(
    subject: &ModuleDecl,
    facts: &mut ModuleFacts,
    to: &DependencyTarget,
    target: Option<(&ModuleDecl, bool)>,
    root: &Path,
    holds: bool,
) -> Result<String, String> {
    let (spellings, display) = match (to, target) {
        (DependencyTarget::External(name), _) => (vec![name.clone()], format!("{name:?}")),
        (DependencyTarget::Module(_), Some((target, _))) => {
            (module_names(target, subject, root), target.display.clone())
        }
        (DependencyTarget::Module(name), None) => (Vec::new(), name.clone()),
    };
    if holds {
        facts.imports.retain(|import| {
            !spellings.iter().any(|spelling| {
                import.name == *spelling || import.name.starts_with(&format!("{spelling}."))
            })
        });
        return Ok(format!("{} does not import {display}", subject.display));
    }
    if !facts.exists {
        return Err(absent_module(subject, &format!("imports {display}")));
    }
    let name = match (to, target) {
        (DependencyTarget::External(name), _) => name.clone(),
        (DependencyTarget::Module(_), Some((target, false))) => {
            return Err(format!(
                "{} does not exist, so the counterfactual would have to create the target module before a dependency on it could be observed",
                target.display
            ));
        }
        (DependencyTarget::Module(_), Some((target, true))) => {
            target.dotted(root).ok_or_else(|| {
                format!(
                    "{display} lies outside the project root, so no provider reports a name a dependency on it could be observed under"
                )
            })?
        }
        (DependencyTarget::Module(_), None) => {
            return Err(format!("{display} is not a module this contract declares"));
        }
    };
    facts.imports.push(ImportFact {
        name: name.clone(),
        line: 0,
    });
    Ok(format!("{} imports {name} ({display})", subject.display))
}

fn invert_contains(
    subject: &ModuleDecl,
    facts: &mut ModuleFacts,
    path: &[String],
    value: &Literal,
    holds: bool,
) -> Result<String, String> {
    let name = path.join(".");
    let rendered = value.render();
    let Some(collection) = facts
        .collections
        .iter_mut()
        .find(|collection| collection.path == path)
    else {
        return Err(if facts.exists {
            format!(
                "{} reports no literal collection named {name}, so the counterfactual would have to introduce the collection rather than change whether it contains {rendered}",
                subject.display
            )
        } else {
            absent_module(subject, &format!("defines {name}"))
        });
    };
    if holds {
        collection.values.retain(|element| element != value);
        Ok(format!(
            "{} {name} does not contain {rendered}",
            subject.display
        ))
    } else {
        collection.values.push(value.clone());
        Ok(format!("{} {name} contains {rendered}", subject.display))
    }
}

fn invert_maps(
    subject: &ModuleDecl,
    facts: &mut ModuleFacts,
    path: &[String],
    key: &Literal,
    value: &Literal,
    holds: bool,
) -> Result<String, String> {
    let name = path.join(".");
    let association = format!("{name} maps {} to {}", key.render(), value.render());
    if !facts.entries.iter().any(|entry| entry.path == path) {
        return Err(if facts.exists {
            format!(
                "{} reports no key/value entries named {name}, so the counterfactual would have to introduce the collection rather than change whether {association}",
                subject.display
            )
        } else {
            absent_module(subject, &format!("defines {name}"))
        });
    }
    let existing = facts
        .entries
        .iter_mut()
        .find(|entry| entry.path == path && entry.key == *key);
    match (holds, existing) {
        (true, Some(entry)) => {
            if let Some(values) = entry.values.as_mut() {
                values.retain(|element| element != value);
            }
            Ok(format!(
                "{} {name} does not map {} to {}",
                subject.display,
                key.render(),
                value.render()
            ))
        }
        (true, None) => Err(format!(
            "{} reports no entry of {name} keyed {}, so there is nothing to invert",
            subject.display,
            key.render()
        )),
        (false, Some(entry)) => {
            match entry.values.as_mut() {
                Some(values) => values.push(value.clone()),
                None => entry.values = Some(vec![value.clone()]),
            }
            Ok(format!("{} {association}", subject.display))
        }
        (false, None) => {
            facts.entries.push(EntryFact {
                path: path.to_vec(),
                key: key.clone(),
                line: 0,
                values: Some(vec![value.clone()]),
            });
            Ok(format!("{} {association}", subject.display))
        }
    }
}
