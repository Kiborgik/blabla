pub mod python;
pub mod syntax;
#[cfg(test)]
mod tests;

use crate::diagnostic::Location;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug)]
pub struct StructureContract {
    pub group: Option<String>,
    pub file: String,
    pub source: String,
    pub modules: Vec<ModuleDecl>,
    pub rules: Vec<StructureRule>,
}

#[derive(Clone, Debug)]
pub struct ModuleDecl {
    pub name: String,
    pub display: String,
    pub path: PathBuf,
    pub location: Location,
}

impl ModuleDecl {
    pub fn key(&self) -> String {
        normalize(&self.path).to_string_lossy().replace('\\', "/")
    }

    pub fn stem(&self) -> String {
        self.path
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    pub fn package(&self, root: &Path) -> Vec<String> {
        let directory = normalize(&self.path);
        let Some(directory) = directory.parent() else {
            return Vec::new();
        };
        let Ok(relative) = directory.strip_prefix(normalize(root)) else {
            return Vec::new();
        };
        relative
            .components()
            .filter_map(|component| match component {
                Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
                _ => None,
            })
            .collect()
    }

    pub fn dotted(&self, root: &Path) -> Option<String> {
        let normalized = normalize(&self.path);
        let relative = normalized.strip_prefix(normalize(root)).ok()?;
        let mut parts: Vec<String> = relative
            .components()
            .filter_map(|component| match component {
                Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
                _ => None,
            })
            .collect();
        let last = parts.pop()?;
        let stem = Path::new(&last)
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or(last);
        parts.push(stem);
        Some(parts.join("."))
    }
}

pub fn normalize(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !result.pop() {
                    result.push("..");
                }
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}

#[derive(Clone, Debug)]
pub struct StructureRule {
    pub id: String,
    pub label: String,
    pub polarity: Polarity,
    pub fact: Fact,
    pub location: Location,
    pub source: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Polarity {
    Require,
    Forbid,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Fact {
    Module {
        module: String,
    },
    Symbol {
        module: String,
        path: Vec<String>,
    },
    Dependency {
        from: String,
        to: DependencyTarget,
    },
    Contains {
        module: String,
        path: Vec<String>,
        value: Literal,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DependencyTarget {
    Module(String),
    External(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Literal {
    Bool(bool),
    Int(i64),
    Str(String),
}

impl Literal {
    fn render(&self) -> String {
        match self {
            Literal::Bool(value) => value.to_string(),
            Literal::Int(value) => value.to_string(),
            Literal::Str(value) => format!("{value:?}"),
        }
    }
}

impl Fact {
    pub fn render(&self) -> String {
        match self {
            Fact::Module { module } => format!("module {module}"),
            Fact::Symbol { module, path } => format!("symbol {module}::{}", path.join(".")),
            Fact::Dependency { from, to } => match to {
                DependencyTarget::Module(name) => format!("dependency {from} -> {name}"),
                DependencyTarget::External(name) => format!("dependency {from} -> {name:?}"),
            },
            Fact::Contains {
                module,
                path,
                value,
            } => format!(
                "value {module}::{} contains {}",
                path.join("."),
                value.render()
            ),
        }
    }

    pub fn modules(&self) -> Vec<&str> {
        match self {
            Fact::Module { module }
            | Fact::Symbol { module, .. }
            | Fact::Contains { module, .. } => {
                vec![module.as_str()]
            }
            Fact::Dependency { from, .. } => vec![from.as_str()],
        }
    }

    fn requirement(&self, polarity: Polarity) -> String {
        let verb = |positive: &str, negative: &str| match polarity {
            Polarity::Require => positive.to_owned(),
            Polarity::Forbid => negative.to_owned(),
        };
        match self {
            Fact::Module { module } => {
                format!("module {module} {}", verb("must exist", "must not exist"))
            }
            Fact::Symbol { module, path } => format!(
                "{module} {} {}",
                verb("must define", "must not define"),
                path.join(".")
            ),
            Fact::Dependency { from, to } => format!(
                "{from} {} {}",
                verb("must depend on", "must not depend on"),
                match to {
                    DependencyTarget::Module(name) => name.clone(),
                    DependencyTarget::External(name) => format!("external module {name:?}"),
                }
            ),
            Fact::Contains {
                module,
                path,
                value,
            } => format!(
                "{module}::{} {} {}",
                path.join("."),
                verb("must contain", "must not contain"),
                value.render()
            ),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ModuleFacts {
    pub exists: bool,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub symbols: Vec<SymbolFact>,
    #[serde(default)]
    pub imports: Vec<ImportFact>,
    #[serde(default)]
    pub collections: Vec<CollectionFact>,
    #[serde(default)]
    pub unsupported: Vec<SymbolFact>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SymbolFact {
    pub path: Vec<String>,
    pub line: usize,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ImportFact {
    pub name: String,
    pub line: usize,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CollectionFact {
    pub path: Vec<String>,
    pub line: usize,
    pub values: Vec<Literal>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProviderFailure {
    NoProvider {
        extension: String,
    },
    Unavailable {
        provider: &'static str,
        message: String,
    },
}

impl ProviderFailure {
    fn message(&self) -> String {
        match self {
            ProviderFailure::NoProvider { extension } => format!(
                "no structural provider inspects '{extension}' files; v0.5 ships the python provider only"
            ),
            ProviderFailure::Unavailable { provider, message } => {
                format!("the {provider} provider could not run: {message}")
            }
        }
    }
}

pub trait Provider {
    fn id(&self) -> &'static str;
    fn handles(&self, path: &Path) -> bool;
    fn symbol_depth(&self) -> usize;
    fn inspect(
        &self,
        root: &Path,
        modules: &[&ModuleDecl],
    ) -> Result<BTreeMap<String, ModuleFacts>, ProviderFailure>;
}

pub fn default_providers() -> Vec<Box<dyn Provider>> {
    vec![Box::new(python::PythonProvider)]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleStatus {
    Green,
    Red,
    Error,
}

impl RuleStatus {
    pub fn word(self) -> &'static str {
        match self {
            RuleStatus::Green => "GREEN",
            RuleStatus::Red => "RED",
            RuleStatus::Error => "ERROR",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerStatus {
    Green,
    Red,
    Error,
    None,
}

impl LayerStatus {
    pub fn word(self) -> &'static str {
        match self {
            LayerStatus::Green => "GREEN",
            LayerStatus::Red => "RED",
            LayerStatus::Error => "ERROR",
            LayerStatus::None => "none declared",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct RuleResult {
    pub id: String,
    pub group: Option<String>,
    pub label: String,
    pub file: String,
    pub line: usize,
    pub polarity: Polarity,
    pub fact: String,
    pub requirement: String,
    pub status: RuleStatus,
    pub observed: Option<String>,
    pub message: String,
    pub provider: Option<&'static str>,
}

#[derive(Clone, Debug, Serialize)]
pub struct StructureReport {
    pub status: LayerStatus,
    pub verified: usize,
    pub violated: usize,
    pub errors: usize,
    pub rules: Vec<RuleResult>,
    pub invocations: usize,
}

impl StructureReport {
    pub fn none() -> Self {
        Self {
            status: LayerStatus::None,
            verified: 0,
            violated: 0,
            errors: 0,
            rules: Vec::new(),
            invocations: 0,
        }
    }

    pub fn first_error(&self) -> Option<&str> {
        self.rules
            .iter()
            .find(|rule| rule.status == RuleStatus::Error)
            .map(|rule| rule.message.as_str())
    }

    pub fn total(&self) -> usize {
        self.rules.len()
    }

    pub fn result(&self, id: &str) -> Option<&RuleResult> {
        self.rules.iter().find(|rule| rule.id == id)
    }
}

struct Inspected<'a> {
    provider: Option<&'a dyn Provider>,
    facts: Result<ModuleFacts, ProviderFailure>,
}

pub fn verify(
    contracts: &[StructureContract],
    root: &Path,
    providers: &[Box<dyn Provider>],
) -> StructureReport {
    let mut inspected: BTreeMap<String, Inspected<'_>> = BTreeMap::new();
    let mut by_provider: Vec<Vec<&ModuleDecl>> = providers.iter().map(|_| Vec::new()).collect();
    for contract in contracts {
        for module in &contract.modules {
            let key = module.key();
            if inspected.contains_key(&key) {
                continue;
            }
            match providers
                .iter()
                .position(|provider| provider.handles(&module.path))
            {
                Some(index) => {
                    by_provider[index].push(module);
                    inspected.insert(
                        key,
                        Inspected {
                            provider: Some(providers[index].as_ref()),
                            facts: Ok(ModuleFacts::default()),
                        },
                    );
                }
                None => {
                    let extension = module
                        .path
                        .extension()
                        .map(|extension| format!(".{}", extension.to_string_lossy()))
                        .unwrap_or_else(|| "(no extension)".to_owned());
                    inspected.insert(
                        key,
                        Inspected {
                            provider: None,
                            facts: Err(ProviderFailure::NoProvider { extension }),
                        },
                    );
                }
            }
        }
    }
    let mut invocations = 0;
    for (index, modules) in by_provider.iter().enumerate() {
        if modules.is_empty() {
            continue;
        }
        invocations += 1;
        match providers[index].inspect(root, modules) {
            Ok(mut facts) => {
                for module in modules {
                    let key = module.key();
                    let entry = facts.remove(&key).unwrap_or_default();
                    if let Some(slot) = inspected.get_mut(&key) {
                        slot.facts = Ok(entry);
                    }
                }
            }
            Err(failure) => {
                for module in modules {
                    if let Some(slot) = inspected.get_mut(&module.key()) {
                        slot.facts = Err(failure.clone());
                    }
                }
            }
        }
    }
    let mut rules = Vec::new();
    for contract in contracts {
        for rule in &contract.rules {
            rules.push(evaluate_rule(contract, rule, root, &inspected));
        }
    }
    let verified = rules
        .iter()
        .filter(|rule| rule.status == RuleStatus::Green)
        .count();
    let violated = rules
        .iter()
        .filter(|rule| rule.status == RuleStatus::Red)
        .count();
    let errors = rules
        .iter()
        .filter(|rule| rule.status == RuleStatus::Error)
        .count();
    let status = if contracts.is_empty() {
        LayerStatus::None
    } else if violated > 0 {
        LayerStatus::Red
    } else if errors > 0 {
        LayerStatus::Error
    } else {
        LayerStatus::Green
    };
    StructureReport {
        status,
        verified,
        violated,
        errors,
        rules,
        invocations,
    }
}

enum Outcome {
    Holds(String),
    Absent(String),
    Error(String),
}

fn evaluate_rule(
    contract: &StructureContract,
    rule: &StructureRule,
    root: &Path,
    inspected: &BTreeMap<String, Inspected<'_>>,
) -> RuleResult {
    let module_by_name = |name: &str| contract.modules.iter().find(|module| module.name == name);
    let mut provider = None;
    let mut failure = None;
    for name in rule.fact.modules() {
        if let Some(module) = module_by_name(name)
            && let Some(slot) = inspected.get(&module.key())
        {
            if provider.is_none() {
                provider = slot.provider.map(Provider::id);
            }
            match &slot.facts {
                Err(problem) if failure.is_none() => failure = Some(problem.message()),
                Ok(facts) if facts.error.is_some() && failure.is_none() => {
                    failure = Some(format!(
                        "{} could not be parsed: {}",
                        module.display,
                        facts.error.clone().unwrap_or_default()
                    ));
                }
                _ => {}
            }
        }
    }
    let outcome = match failure {
        Some(message) => Outcome::Error(message),
        None => {
            let facts = |name: &str| -> Option<(&ModuleDecl, &ModuleFacts)> {
                let module = module_by_name(name)?;
                let slot = inspected.get(&module.key())?;
                match &slot.facts {
                    Ok(facts) => Some((module, facts)),
                    Err(_) => None,
                }
            };
            let depth = module_by_name(rule.fact.modules()[0])
                .and_then(|module| inspected.get(&module.key()))
                .and_then(|slot| slot.provider)
                .map(Provider::symbol_depth)
                .unwrap_or(usize::MAX);
            match &rule.fact {
                Fact::Module { module } => match facts(module) {
                    Some((decl, facts)) if facts.exists => {
                        Outcome::Holds(format!("{} exists", decl.display))
                    }
                    Some((decl, _)) => Outcome::Absent(format!("{} does not exist", decl.display)),
                    None => Outcome::Error(format!("module {module} was not inspected")),
                },
                Fact::Symbol { module, path } => symbol_outcome(facts(module), path, depth),
                Fact::Dependency { from, to } => match facts(from) {
                    Some((decl, facts)) => {
                        let (targets, display) = match to {
                            DependencyTarget::Module(name) => match module_by_name(name) {
                                Some(target) => {
                                    (module_names(target, decl, root), target.display.clone())
                                }
                                None => (Vec::new(), name.clone()),
                            },
                            DependencyTarget::External(name) => {
                                (vec![name.clone()], format!("{name:?}"))
                            }
                        };
                        let hit = facts.imports.iter().find(|import| {
                            targets.iter().any(|target| {
                                import.name == *target
                                    || import.name.starts_with(&format!("{target}."))
                            })
                        });
                        match hit {
                            Some(import) => Outcome::Holds(format!(
                                "{}:{} imports {} ({display})",
                                decl.display, import.line, import.name
                            )),
                            None => Outcome::Absent(format!(
                                "{} does not import {display}",
                                decl.display
                            )),
                        }
                    }
                    None => Outcome::Error(format!("module {from} was not inspected")),
                },
                Fact::Contains {
                    module,
                    path,
                    value,
                } => match facts(module) {
                    Some((decl, facts)) => {
                        let name = path.join(".");
                        if path.len() > depth {
                            Outcome::Error(format!(
                                "the provider reports symbols at most {depth} levels deep; {name} is deeper"
                            ))
                        } else if let Some(collection) =
                            facts.collections.iter().find(|item| item.path == *path)
                        {
                            if collection.values.contains(value) {
                                Outcome::Holds(format!(
                                    "{}:{} {name} contains {}",
                                    decl.display,
                                    collection.line,
                                    value.render()
                                ))
                            } else {
                                Outcome::Absent(format!(
                                    "{}:{} {name} = {}",
                                    decl.display,
                                    collection.line,
                                    render_values(&collection.values)
                                ))
                            }
                        } else if let Some(symbol) =
                            facts.symbols.iter().find(|symbol| symbol.path == *path)
                        {
                            Outcome::Error(format!(
                                "{}:{} {name} is not a literal collection of strings, integers or booleans; membership cannot be evaluated statically",
                                decl.display, symbol.line
                            ))
                        } else if !facts.exists {
                            Outcome::Absent(format!("{} does not exist", decl.display))
                        } else {
                            Outcome::Absent(format!("{} does not define {name}", decl.display))
                        }
                    }
                    None => Outcome::Error(format!("module {module} was not inspected")),
                },
            }
        }
    };
    let (status, observed, message) = match (&outcome, rule.polarity) {
        (Outcome::Error(message), _) => (RuleStatus::Error, None, message.clone()),
        (Outcome::Holds(observed), Polarity::Require) => (
            RuleStatus::Green,
            Some(observed.clone()),
            "requirement satisfied".to_owned(),
        ),
        (Outcome::Holds(observed), Polarity::Forbid) => (
            RuleStatus::Red,
            Some(observed.clone()),
            "forbidden fact is present".to_owned(),
        ),
        (Outcome::Absent(observed), Polarity::Require) => (
            RuleStatus::Red,
            Some(observed.clone()),
            "required fact is absent".to_owned(),
        ),
        (Outcome::Absent(observed), Polarity::Forbid) => (
            RuleStatus::Green,
            Some(observed.clone()),
            "forbidden fact is absent".to_owned(),
        ),
    };
    RuleResult {
        id: rule.id.clone(),
        group: contract.group.clone(),
        label: rule.label.clone(),
        file: rule.location.file.clone(),
        line: rule.location.line,
        polarity: rule.polarity,
        fact: rule.fact.render(),
        requirement: rule.fact.requirement(rule.polarity),
        status,
        observed,
        message,
        provider,
    }
}

fn symbol_outcome(
    facts: Option<(&ModuleDecl, &ModuleFacts)>,
    path: &[String],
    depth: usize,
) -> Outcome {
    let name = path.join(".");
    match facts {
        Some((decl, facts)) => {
            if path.len() > depth {
                return Outcome::Error(format!(
                    "the provider reports symbols at most {depth} levels deep; {name} is deeper"
                ));
            }
            match facts.symbols.iter().find(|symbol| symbol.path == path) {
                Some(symbol) => {
                    Outcome::Holds(format!("{}:{} defines {name}", decl.display, symbol.line))
                }
                None if facts.exists => {
                    Outcome::Absent(format!("{} does not define {name}", decl.display))
                }
                None => Outcome::Absent(format!("{} does not exist", decl.display)),
            }
        }
        None => Outcome::Error("module was not inspected".to_owned()),
    }
}

fn module_names(target: &ModuleDecl, from: &ModuleDecl, root: &Path) -> Vec<String> {
    let mut names = vec![target.stem()];
    if let Some(dotted) = target.dotted(root) {
        names.push(dotted);
    }
    let from_package = from.package(root);
    let target_package = target.package(root);
    if target_package.len() >= from_package.len()
        && target_package[..from_package.len()] == from_package[..]
    {
        let mut parts = target_package[from_package.len()..].to_vec();
        parts.push(target.stem());
        names.push(parts.join("."));
    }
    names.sort();
    names.dedup();
    names
}

fn render_values(values: &[Literal]) -> String {
    let rendered: Vec<String> = values.iter().map(Literal::render).collect();
    format!("({})", rendered.join(", "))
}
