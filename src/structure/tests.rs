use super::python::{EXTRACTOR, PythonProvider};
use super::syntax::{is_structure_source, parse};
use super::{
    DependencyTarget, Fact, ImportFact, LayerStatus, Literal, ModuleDecl, ModuleFacts, Polarity,
    Provider, ProviderFailure, RuleStatus, StructureContract, SymbolFact, verify,
};
use std::cell::Cell;
use std::collections::BTreeMap;
use std::path::Path;

const ARCHITECTURE: &str = r#"
module model    "app/model.py"
module domain   "app/domain.py"
module store    "app/store.py"

require "durable-fields":    symbol model::DURABLE_FIELDS
forbid  "no-domain-restart": symbol domain::VaultDomain.restart
forbid  "domain-independent-of-store": dependency domain -> store
forbid  "domain-no-json":    dependency domain -> "json"
require "durable-keeper":    value model::DURABLE_FIELDS contains "keeper"
forbid  "id-is-the-key":     value model::DURABLE_FIELDS contains "id"
require "model-module":      module model
"#;

fn contract(source: &str) -> StructureContract {
    parse(
        "architecture.bla",
        source,
        Path::new("/repo"),
        Some("architecture"),
    )
    .unwrap()
}

#[test]
fn structure_files_are_recognised_by_their_first_declaration() {
    assert!(is_structure_source("\n  module model \"a.py\""));
    assert!(!is_structure_source("modules x"));
    assert!(!is_structure_source("state count: int"));
}

#[test]
fn parser_builds_modules_labelled_rules_and_namespaced_ids() {
    let parsed = contract(ARCHITECTURE);
    assert_eq!(parsed.modules.len(), 3);
    assert_eq!(parsed.modules[1].name, "domain");
    assert_eq!(parsed.modules[1].display, "app/domain.py");
    assert_eq!(
        parsed.modules[1].path,
        Path::new("/repo").join("app/domain.py")
    );
    let ids: Vec<&str> = parsed.rules.iter().map(|rule| rule.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "architecture::durable-fields",
            "architecture::no-domain-restart",
            "architecture::domain-independent-of-store",
            "architecture::domain-no-json",
            "architecture::durable-keeper",
            "architecture::id-is-the-key",
            "architecture::model-module",
        ]
    );
    assert_eq!(parsed.rules[0].polarity, Polarity::Require);
    assert_eq!(
        parsed.rules[0].fact,
        Fact::Symbol {
            module: "model".into(),
            path: vec!["DURABLE_FIELDS".into()],
        }
    );
    assert_eq!(parsed.rules[1].polarity, Polarity::Forbid);
    assert_eq!(
        parsed.rules[1].fact,
        Fact::Symbol {
            module: "domain".into(),
            path: vec!["VaultDomain".into(), "restart".into()],
        }
    );
    assert_eq!(
        parsed.rules[2].fact,
        Fact::Dependency {
            from: "domain".into(),
            to: DependencyTarget::Module("store".into()),
        }
    );
    assert_eq!(
        parsed.rules[3].fact,
        Fact::Dependency {
            from: "domain".into(),
            to: DependencyTarget::External("json".into()),
        }
    );
    assert_eq!(
        parsed.rules[4].fact,
        Fact::Contains {
            module: "model".into(),
            path: vec!["DURABLE_FIELDS".into()],
            value: Literal::Str("keeper".into()),
        }
    );
    assert_eq!(
        parsed.rules[6].fact,
        Fact::Module {
            module: "model".into()
        }
    );
    assert_eq!(parsed.rules[1].location.line, 7);
    assert_eq!(parsed.rules[1].location.file, "architecture.bla");
    assert_eq!(
        parsed.rules[1].source,
        "forbid \"no-domain-restart\": symbol domain::VaultDomain.restart"
    );
    assert_eq!(
        parsed.rules[1].fact.render(),
        "symbol domain::VaultDomain.restart"
    );
    assert_eq!(
        parsed.rules[3].fact.render(),
        "dependency domain -> \"json\""
    );
    let bare = parse("s.bla", ARCHITECTURE, Path::new("/repo"), None).unwrap();
    assert_eq!(bare.rules[0].id, "durable-fields");
}

#[test]
fn parser_rejects_malformed_and_incompatible_declarations_deterministically() {
    let cases = [
        ("module a \"a.py\"\nmodule a \"b.py\"", "E_DUPLICATE_MODULE"),
        ("require \"x\": symbol a::B", "E_UNKNOWN_MODULE"),
        (
            "module a \"a.py\"\nrequire \"x\": symbol a::B\nforbid \"x\": symbol a::C",
            "E_DUPLICATE_LABEL",
        ),
        (
            "module a \"a.py\"\nrequire \"x\": count a::B",
            "E_STRUCTURE_FACT",
        ),
        (
            "module a \"a.py\"\nrequire \"x\": symbol a.B",
            "E_STRUCTURE_SYNTAX",
        ),
        (
            "module a \"a.py\"\nforbid \"x\": dependency a -> 7",
            "E_STRUCTURE_FACT",
        ),
        (
            "module a \"a.py\"\nrequire \"x\": value a::B contains 1.5",
            "E_STRUCTURE_FACT",
        ),
        ("module a \"a.py\"\nstate count: int", "E_LAYER_MIX"),
        (
            "module a \"a.py\"\nrequire \"\": module a",
            "E_STRUCTURE_SYNTAX",
        ),
        ("module a a.py", "E_STRUCTURE_SYNTAX"),
    ];
    for (source, code) in cases {
        let first = parse("s.bla", source, Path::new("/repo"), Some("s")).unwrap_err();
        let second = parse("s.bla", source, Path::new("/repo"), Some("s")).unwrap_err();
        assert_eq!(first.code, code, "{source}: {}", first.message);
        assert_eq!(first, second);
        assert!(first.location.line >= 1);
    }
}

struct FakeProvider {
    facts: BTreeMap<String, ModuleFacts>,
    calls: Cell<usize>,
    failure: Option<ProviderFailure>,
}

impl Provider for FakeProvider {
    fn id(&self) -> &'static str {
        "fake"
    }

    fn handles(&self, path: &Path) -> bool {
        path.extension().is_some_and(|extension| extension == "py")
    }

    fn symbol_depth(&self) -> usize {
        2
    }

    fn inspect(
        &self,
        _root: &Path,
        modules: &[&ModuleDecl],
    ) -> Result<BTreeMap<String, ModuleFacts>, ProviderFailure> {
        self.calls.set(self.calls.get() + 1);
        if let Some(failure) = &self.failure {
            return Err(failure.clone());
        }
        Ok(modules
            .iter()
            .filter_map(|module| {
                self.facts
                    .get(&module.display)
                    .map(|facts| (module.key(), facts.clone()))
            })
            .collect())
    }
}

fn symbols(paths: &[&str]) -> Vec<SymbolFact> {
    paths
        .iter()
        .enumerate()
        .map(|(index, path)| SymbolFact {
            path: path.split('.').map(str::to_owned).collect(),
            line: index + 1,
        })
        .collect()
}

fn clean_facts() -> BTreeMap<String, ModuleFacts> {
    let mut facts = BTreeMap::new();
    facts.insert(
        "app/model.py".to_owned(),
        ModuleFacts {
            exists: true,
            error: None,
            symbols: symbols(&["DURABLE_FIELDS", "Vault"]),
            imports: vec![ImportFact {
                name: "dataclasses".into(),
                line: 1,
            }],
            collections: vec![super::CollectionFact {
                path: vec!["DURABLE_FIELDS".into()],
                line: 3,
                values: vec![Literal::Str("keeper".into()), Literal::Str("glyph".into())],
            }],
            unsupported: Vec::new(),
        },
    );
    facts.insert(
        "app/domain.py".to_owned(),
        ModuleFacts {
            exists: true,
            error: None,
            symbols: symbols(&["VaultDomain", "VaultDomain.rotate"]),
            imports: vec![ImportFact {
                name: "model".into(),
                line: 1,
            }],
            collections: Vec::new(),
            unsupported: Vec::new(),
        },
    );
    facts.insert(
        "app/store.py".to_owned(),
        ModuleFacts {
            exists: true,
            error: None,
            symbols: symbols(&["VaultStore"]),
            imports: vec![ImportFact {
                name: "model".into(),
                line: 2,
            }],
            collections: Vec::new(),
            unsupported: Vec::new(),
        },
    );
    facts
}

fn report_with(facts: BTreeMap<String, ModuleFacts>) -> (super::StructureReport, usize) {
    let provider = FakeProvider {
        facts,
        calls: Cell::new(0),
        failure: None,
    };
    let providers: Vec<Box<dyn Provider>> = vec![Box::new(provider)];
    let report = verify(&[contract(ARCHITECTURE)], Path::new("/repo"), &providers);
    let calls = report.invocations;
    (report, calls)
}

#[test]
fn a_clean_architecture_is_green_with_one_provider_invocation() {
    let (report, invocations) = report_with(clean_facts());
    assert_eq!(report.status, LayerStatus::Green, "{report:?}");
    assert_eq!(report.verified, 7);
    assert_eq!(report.violated, 0);
    assert_eq!(report.errors, 0);
    assert_eq!(invocations, 1);
    let ids: Vec<&str> = report.rules.iter().map(|rule| rule.id.as_str()).collect();
    assert_eq!(ids[0], "architecture::durable-fields");
    assert_eq!(ids[6], "architecture::model-module");
    let restart = report.result("architecture::no-domain-restart").unwrap();
    assert_eq!(restart.status, RuleStatus::Green);
    assert_eq!(
        restart.observed.as_deref(),
        Some("app/domain.py does not define VaultDomain.restart")
    );
    assert_eq!(
        restart.requirement,
        "domain must not define VaultDomain.restart"
    );
    assert_eq!(restart.provider, Some("fake"));
    assert_eq!(restart.file, "architecture.bla");
    assert_eq!(restart.line, 7);
}

#[test]
fn mutations_turn_exactly_the_touched_rule_red_with_an_observation() {
    let mut facts = clean_facts();
    facts
        .get_mut("app/domain.py")
        .unwrap()
        .imports
        .push(ImportFact {
            name: "store".into(),
            line: 4,
        });
    let (report, _) = report_with(facts);
    let rule = report
        .result("architecture::domain-independent-of-store")
        .unwrap();
    assert_eq!(report.status, LayerStatus::Red);
    assert_eq!(report.violated, 1);
    assert_eq!(rule.status, RuleStatus::Red);
    assert_eq!(
        rule.observed.as_deref(),
        Some("app/domain.py:4 imports store (app/store.py)")
    );

    let mut facts = clean_facts();
    let model = facts.get_mut("app/model.py").unwrap();
    model
        .symbols
        .retain(|symbol| symbol.path != ["DURABLE_FIELDS"]);
    model.collections.clear();
    let (report, _) = report_with(facts);
    assert_eq!(
        report
            .result("architecture::durable-fields")
            .unwrap()
            .status,
        RuleStatus::Red
    );
    assert_eq!(
        report
            .result("architecture::durable-keeper")
            .unwrap()
            .status,
        RuleStatus::Red
    );
    assert_eq!(
        report.result("architecture::id-is-the-key").unwrap().status,
        RuleStatus::Green
    );

    let mut facts = clean_facts();
    facts
        .get_mut("app/domain.py")
        .unwrap()
        .symbols
        .push(SymbolFact {
            path: vec!["VaultDomain".into(), "restart".into()],
            line: 40,
        });
    let (report, _) = report_with(facts);
    let rule = report.result("architecture::no-domain-restart").unwrap();
    assert_eq!(rule.status, RuleStatus::Red);
    assert_eq!(
        rule.observed.as_deref(),
        Some("app/domain.py:40 defines VaultDomain.restart")
    );

    let mut facts = clean_facts();
    facts.get_mut("app/model.py").unwrap().collections[0]
        .values
        .retain(|value| value != &Literal::Str("keeper".into()));
    let (report, _) = report_with(facts);
    let rule = report.result("architecture::durable-keeper").unwrap();
    assert_eq!(rule.status, RuleStatus::Red);
    assert_eq!(
        rule.observed.as_deref(),
        Some("app/model.py:3 DURABLE_FIELDS = (\"glyph\")")
    );

    let mut facts = clean_facts();
    facts.get_mut("app/model.py").unwrap().collections[0]
        .values
        .push(Literal::Str("id".into()));
    let (report, _) = report_with(facts);
    let rule = report.result("architecture::id-is-the-key").unwrap();
    assert_eq!(rule.status, RuleStatus::Red);
    assert_eq!(
        rule.observed.as_deref(),
        Some("app/model.py:3 DURABLE_FIELDS contains \"id\"")
    );
}

#[test]
fn unsupported_facts_and_missing_providers_are_errors_never_green() {
    let mut facts = clean_facts();
    let model = facts.get_mut("app/model.py").unwrap();
    model.collections.clear();
    model.unsupported.push(SymbolFact {
        path: vec!["DURABLE_FIELDS".into()],
        line: 3,
    });
    let (report, _) = report_with(facts);
    assert_eq!(report.status, LayerStatus::Error);
    assert_eq!(report.errors, 2);
    for id in [
        "architecture::durable-keeper",
        "architecture::id-is-the-key",
    ] {
        let rule = report.result(id).unwrap();
        assert_eq!(rule.status, RuleStatus::Error);
        assert!(
            rule.message.contains("not a literal collection"),
            "{}",
            rule.message
        );
    }

    let mut facts = clean_facts();
    facts.get_mut("app/domain.py").unwrap().error = Some("invalid syntax (line 3)".into());
    let (report, _) = report_with(facts);
    for id in [
        "architecture::no-domain-restart",
        "architecture::domain-independent-of-store",
        "architecture::domain-no-json",
    ] {
        let rule = report.result(id).unwrap();
        assert_eq!(rule.status, RuleStatus::Error, "{id}");
        assert!(rule.message.contains("could not be parsed"));
    }
    assert_eq!(
        report
            .result("architecture::durable-fields")
            .unwrap()
            .status,
        RuleStatus::Green
    );

    let provider = FakeProvider {
        facts: BTreeMap::new(),
        calls: Cell::new(0),
        failure: Some(ProviderFailure::Unavailable {
            provider: "fake",
            message: "python was not found".into(),
        }),
    };
    let providers: Vec<Box<dyn Provider>> = vec![Box::new(provider)];
    let report = verify(&[contract(ARCHITECTURE)], Path::new("/repo"), &providers);
    assert_eq!(report.status, LayerStatus::Error);
    assert_eq!(report.errors, 7);
    assert!(report.rules[0].message.contains("python was not found"));

    let report = verify(&[contract(ARCHITECTURE)], Path::new("/repo"), &[]);
    assert_eq!(report.status, LayerStatus::Error);
    assert!(
        report.rules[0]
            .message
            .contains("no structural provider inspects '.py'")
    );

    let report = verify(&[], Path::new("/repo"), &[]);
    assert_eq!(report.status, LayerStatus::None);
}

#[test]
fn deeper_symbol_paths_than_the_provider_reports_are_errors() {
    let deep = parse(
        "s.bla",
        "module a \"a.py\"\nrequire \"x\": symbol a::B.c.d",
        Path::new("/repo"),
        Some("s"),
    )
    .unwrap();
    let provider = FakeProvider {
        facts: clean_facts(),
        calls: Cell::new(0),
        failure: None,
    };
    let providers: Vec<Box<dyn Provider>> = vec![Box::new(provider)];
    let report = verify(&[deep], Path::new("/repo"), &providers);
    assert_eq!(report.rules[0].status, RuleStatus::Error);
    assert!(report.rules[0].message.contains("2 levels deep"));
}

#[test]
fn missing_modules_are_observed_state_not_provider_failures() {
    let mut facts = clean_facts();
    facts.insert("app/domain.py".to_owned(), ModuleFacts::default());
    let (report, _) = report_with(facts);
    assert_eq!(
        report
            .result("architecture::no-domain-restart")
            .unwrap()
            .status,
        RuleStatus::Green
    );
    assert_eq!(
        report
            .result("architecture::domain-independent-of-store")
            .unwrap()
            .status,
        RuleStatus::Green
    );
    let mut facts = clean_facts();
    facts.insert("app/model.py".to_owned(), ModuleFacts::default());
    let (report, _) = report_with(facts);
    let module = report.result("architecture::model-module").unwrap();
    assert_eq!(module.status, RuleStatus::Red);
    assert_eq!(
        module.observed.as_deref(),
        Some("app/model.py does not exist")
    );
}

#[test]
fn dependency_targets_match_stems_root_relative_and_package_relative_names() {
    let source = "module model \"pkg/model.py\"\nmodule domain \"pkg/domain.py\"\nmodule other \"lib/other.py\"\nforbid \"a\": dependency domain -> model\nforbid \"b\": dependency domain -> other";
    let parsed = parse("s.bla", source, Path::new("/repo"), Some("s")).unwrap();
    let mut facts = BTreeMap::new();
    for (display, imports) in [
        ("pkg/domain.py", vec!["pkg.model", "lib.other"]),
        ("pkg/model.py", vec![]),
        ("lib/other.py", vec![]),
    ] {
        facts.insert(
            display.to_owned(),
            ModuleFacts {
                exists: true,
                error: None,
                symbols: Vec::new(),
                imports: imports
                    .into_iter()
                    .map(|name| ImportFact {
                        name: name.to_owned(),
                        line: 1,
                    })
                    .collect(),
                collections: Vec::new(),
                unsupported: Vec::new(),
            },
        );
    }
    let provider = FakeProvider {
        facts,
        calls: Cell::new(0),
        failure: None,
    };
    let providers: Vec<Box<dyn Provider>> = vec![Box::new(provider)];
    let report = verify(&[parsed], Path::new("/repo"), &providers);
    assert_eq!(report.rules[0].status, RuleStatus::Red);
    assert_eq!(report.rules[1].status, RuleStatus::Red);
    let decl = ModuleDecl {
        name: "model".into(),
        display: "pkg/model.py".into(),
        path: Path::new("/repo").join("pkg/model.py"),
        location: crate::diagnostic::Location {
            file: "s.bla".into(),
            line: 1,
            column: 1,
        },
    };
    assert_eq!(decl.package(Path::new("/repo")), vec!["pkg".to_owned()]);
    assert_eq!(
        decl.dotted(Path::new("/repo")).as_deref(),
        Some("pkg.model")
    );
    assert_eq!(decl.stem(), "model");
}

#[test]
fn the_python_extractor_parses_and_never_executes() {
    for forbidden in [
        "exec(",
        "eval(",
        "__import__",
        "importlib",
        "compile(",
        "import re",
        "subprocess",
        "os.system",
        "runpy",
    ] {
        assert!(
            !EXTRACTOR.contains(forbidden),
            "extractor contains {forbidden}"
        );
    }
    assert!(EXTRACTOR.contains("ast.parse"));
    assert!(PythonProvider.handles(Path::new("x.py")));
    assert!(!PythonProvider.handles(Path::new("x.rs")));
    assert_eq!(PythonProvider.symbol_depth(), 2);
}
