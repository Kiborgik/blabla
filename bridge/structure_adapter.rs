mod source_cli;
use blabla::skeptic::ChallengeReport;
use blabla::structure::{
    CollectionFact, ImportFact, Literal, ModuleDecl, ModuleFacts, Provider, ProviderFailure,
    RuleStatus, SymbolFact, UnreadableImport, syntax::parse, verify,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::io::{BufRead, Write};
use std::path::Path;

const CONTRACT: &str = r#"
module m    "m.probe"
module near "near.probe"
module far  "far.probe"

require "require-value":  value m::X contains "a"
forbid  "forbid-value":   value m::X contains "a"
require "require-symbol": symbol m::X
forbid  "forbid-symbol":  symbol m::X
forbid  "forbid-near":    dependency m -> near
forbid  "forbid-far":     dependency m -> far
"#;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Scenario {
    CollectionHit,
    CollectionMiss,
    ValueUnreadable,
    UnreadableWithoutSymbol,
    Scalar,
    NameUndefined,
    ModuleMissing,
    ModuleUnreported,
    UnboundedUnknownImport,
    UnknownScopedToOneModule,
    ImportFoundDespiteAnUnknown,
}

impl Scenario {
    fn from_action(name: &str) -> Option<Scenario> {
        match name {
            "report_collection_hit" => Some(Scenario::CollectionHit),
            "report_collection_miss" => Some(Scenario::CollectionMiss),
            "report_value_unreadable" => Some(Scenario::ValueUnreadable),
            "report_unreadable_without_symbol" => Some(Scenario::UnreadableWithoutSymbol),
            "report_scalar" => Some(Scenario::Scalar),
            "report_name_undefined" => Some(Scenario::NameUndefined),
            "report_module_missing" => Some(Scenario::ModuleMissing),
            "report_module_unreported" => Some(Scenario::ModuleUnreported),
            "report_unbounded_unknown_import" => Some(Scenario::UnboundedUnknownImport),
            "report_unknown_scoped_to_one_module" => Some(Scenario::UnknownScopedToOneModule),
            "report_import_found_despite_an_unknown" => Some(Scenario::ImportFoundDespiteAnUnknown),
            _ => None,
        }
    }

    fn facts(self) -> Option<ModuleFacts> {
        let name = || vec!["X".to_owned()];
        let symbol = || {
            vec![SymbolFact {
                path: name(),
                line: 1,
            }]
        };
        let collection = |member: &str| {
            vec![CollectionFact {
                path: name(),
                line: 1,
                values: vec![Literal::Str(member.to_owned())],
            }]
        };
        let unreadable = |covers: Option<String>| UnreadableImport {
            form: "a reference this provider cannot resolve".to_owned(),
            line: 2,
            covers,
        };
        match self {
            Scenario::CollectionHit => Some(ModuleFacts {
                exists: true,
                symbols: symbol(),
                collections: collection("a"),
                ..ModuleFacts::default()
            }),
            Scenario::CollectionMiss => Some(ModuleFacts {
                exists: true,
                symbols: symbol(),
                collections: collection("b"),
                ..ModuleFacts::default()
            }),
            Scenario::ValueUnreadable => Some(ModuleFacts {
                exists: true,
                symbols: symbol(),
                unsupported: symbol(),
                ..ModuleFacts::default()
            }),
            Scenario::UnreadableWithoutSymbol => Some(ModuleFacts {
                exists: true,
                unsupported: symbol(),
                ..ModuleFacts::default()
            }),
            Scenario::Scalar => Some(ModuleFacts {
                exists: true,
                symbols: symbol(),
                ..ModuleFacts::default()
            }),
            Scenario::NameUndefined => Some(ModuleFacts {
                exists: true,
                ..ModuleFacts::default()
            }),
            Scenario::ModuleMissing => Some(ModuleFacts::default()),
            Scenario::ModuleUnreported => None,
            Scenario::UnboundedUnknownImport => Some(ModuleFacts {
                exists: true,
                symbols: symbol(),
                collections: collection("a"),
                unresolved_imports: vec![unreadable(None)],
                ..ModuleFacts::default()
            }),
            Scenario::UnknownScopedToOneModule => Some(ModuleFacts {
                exists: true,
                symbols: symbol(),
                collections: collection("a"),
                unresolved_imports: vec![unreadable(Some("near".to_owned()))],
                ..ModuleFacts::default()
            }),
            Scenario::ImportFoundDespiteAnUnknown => Some(ModuleFacts {
                exists: true,
                symbols: symbol(),
                collections: collection("a"),
                imports: vec![ImportFact {
                    name: "near".to_owned(),
                    line: 3,
                }],
                unresolved_imports: vec![unreadable(None)],
                ..ModuleFacts::default()
            }),
        }
    }
}

struct ScenarioProvider(Scenario);

impl Provider for ScenarioProvider {
    fn id(&self) -> &'static str {
        "scenario"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &[]
    }

    fn handles(&self, _path: &Path) -> bool {
        true
    }

    fn symbol_depth(&self) -> usize {
        2
    }

    fn inspect(
        &self,
        _root: &Path,
        modules: &[&ModuleDecl],
    ) -> Result<BTreeMap<String, ModuleFacts>, ProviderFailure> {
        let mut reported = BTreeMap::new();
        if let Some(facts) = self.0.facts() {
            for module in modules {
                reported.insert(module.key(), facts.clone());
            }
        }
        Ok(reported)
    }
}

fn observe(scenario: Scenario) -> Value {
    let contract = parse("probe.bla", CONTRACT, Path::new("."), Some("probe"))
        .expect("the probe contract must compile");
    let providers: Vec<Box<dyn Provider>> = vec![Box::new(ScenarioProvider(scenario))];
    let report = verify(&[contract], Path::new("."), &providers);
    let verdicts: Vec<Value> = report
        .rules
        .iter()
        .map(|rule| {
            json!({
                "rule": rule.label,
                "status": match rule.status {
                    RuleStatus::Green => "green",
                    RuleStatus::Red => "red",
                    RuleStatus::Error => "error",
                },
            })
        })
        .collect();
    let determinable = report
        .rules
        .iter()
        .all(|rule| rule.status != RuleStatus::Error);
    json!({ "verdicts": verdicts, "determinable": determinable })
}

struct Structure(Scenario);

impl Component for Structure {
    fn call(&mut self, name: &str, _args: &Value) -> Option<Result<(), String>> {
        self.0 = Scenario::from_action(name)?;
        Some(Ok(()))
    }

    fn observe(&self, _observed: &Value) -> Value {
        observe(self.0)
    }
}

mod assignment;
mod attestation;
mod bounded_results;
mod component;
mod decisions;
mod expert;
mod goals;
mod lifecycle;
mod questions;
mod task_machine;
mod task_roles;
mod voice;

use component::Component;

fn standing(report: &ChallengeReport) -> Vec<Value> {
    report
        .grounded
        .iter()
        .map(|class| json!({ "class": class }))
        .collect()
}

fn components(campaign: &source_cli::Campaign) -> Vec<Box<dyn Component>> {
    vec![
        Box::new(Structure(Scenario::CollectionHit)),
        Box::new(assignment::Assignment::new()),
        Box::new(bounded_results::BoundedResults::with_campaign(
            campaign.clone(),
            bounded_results::Templates::default(),
        )),
        Box::new(task_roles::TaskRoles::with_campaign(campaign.clone())),
        Box::new(task_machine::TaskMachine::with_campaign(campaign.clone())),
        Box::new(voice::Tone::new()),
        Box::new(lifecycle::Lifecycle::new()),
        Box::new(goals::Goals::new()),
        Box::new(decisions::Decisions::new()),
        Box::new(attestation::Attestation::new()),
        Box::new(questions::Questions::new()),
        Box::new(expert::Expert::new()),
    ]
}

fn main() -> Result<(), String> {
    let scope =
        source_cli::ImageScope::cached(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    let campaign = scope.campaign();
    let mut registry = components(&campaign);
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(failure) => {
                eprintln!("unreadable request: {failure}");
                continue;
            }
        };
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let operation = request
            .get("op")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let result = match operation {
            "reset" => {
                registry = components(&campaign);
                json!({ "ok": true })
            }
            "call" => {
                let name = request
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let args = request.get("args").unwrap_or(&Value::Null);
                match registry
                    .iter_mut()
                    .find_map(|component| component.call(name, args))
                {
                    Some(Ok(())) => json!({ "ok": true }),
                    Some(Err(error)) => json!({ "ok": false, "error": error }),
                    None => json!({ "ok": false, "error": format!("unknown action: {name}") }),
                }
            }
            "observe" => {
                let mut state = json!({});
                for component in &registry {
                    let observed = component.observe(&state);
                    if let (Some(state), Some(extra)) =
                        (state.as_object_mut(), observed.as_object())
                    {
                        for (key, value) in extra {
                            state.insert(key.clone(), value.clone());
                        }
                    }
                }
                state
            }
            other => json!({ "ok": false, "error": format!("unknown op: {other}") }),
        };
        let response = json!({ "id": id, "result": result });
        let _ = writeln!(stdout, "{response}");
        let _ = stdout.flush();
    }
    scope.verify_content(std::time::Instant::now() + blabla::runtime::MAX_TIMEOUT)
}
