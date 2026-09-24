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

mod assignment;
mod attestation;
mod decisions;
mod goals;
mod lifecycle;
mod questions;
mod voice;

fn main() {
    let mut scenario = Scenario::CollectionHit;
    let mut assignment = assignment::Assignment::new();
    let mut tone = voice::Tone::new();
    let mut app = lifecycle::Lifecycle::new();
    let mut objectives = goals::Goals::new();
    let mut ledger = decisions::Decisions::new();
    let mut attested = attestation::Attestation::new();
    let mut asked = questions::Questions::new();
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
                scenario = Scenario::CollectionHit;
                assignment = assignment::Assignment::new();
                tone = voice::Tone::new();
                app.reset();
                objectives = goals::Goals::new();
                ledger = decisions::Decisions::new();
                attested = attestation::Attestation::new();
                asked = questions::Questions::new();
                json!({ "ok": true })
            }
            "call" => {
                let name = request
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                match Scenario::from_action(name) {
                    Some(chosen) => {
                        scenario = chosen;
                        json!({ "ok": true })
                    }
                    None if assignment.call(name) => json!({ "ok": true }),
                    None if tone.call(name) => json!({ "ok": true }),
                    None if app.call(name) => json!({ "ok": true }),
                    None if objectives.call(name) => json!({ "ok": true }),
                    None if ledger.call(name) => json!({ "ok": true }),
                    None if attested.call(name) => json!({ "ok": true }),
                    None if asked.call(name) => json!({ "ok": true }),
                    None => json!({ "ok": false, "error": format!("unknown action: {name}") }),
                }
            }
            "observe" => {
                let mut state = observe(scenario);
                let voiced = tone.observe(&assignment.report());
                for source in [
                    assignment.observe(),
                    voiced,
                    app.observe(),
                    objectives.observe(),
                    ledger.observe(),
                    attested.observe(),
                    asked.observe(),
                ] {
                    if let (Some(state), Some(extra)) = (state.as_object_mut(), source.as_object())
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
}
