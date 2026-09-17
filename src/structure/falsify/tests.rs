use super::super::syntax::parse;
use super::super::tests::{FakeProvider, symbols};
use super::super::{
    CollectionFact, EntryFact, ImportFact, Literal, ModuleFacts, Provider, ProviderFailure,
    RuleStatus, StructureContract, verify,
};
use super::{FalsifyReport, RuleFalsification, Verdict, falsify};
use std::cell::Cell;
use std::collections::BTreeMap;
use std::path::Path;

const ARCHITECTURE: &str = r#"
module model  "app/model.py"
module domain "app/domain.py"
module store  "app/store.py"
module gate   "app/gate.py"
module gone   "app/gone.py"

require "durable-fields":              symbol model::DURABLE_FIELDS
forbid  "no-domain-restart":           symbol domain::VaultDomain.restart
require "domain-uses-model":           dependency domain -> model
forbid  "domain-independent-of-store": dependency domain -> store
forbid  "domain-no-json":              dependency domain -> "json"
require "durable-keeper":              value model::DURABLE_FIELDS contains "keeper"
forbid  "id-is-the-key":               value model::DURABLE_FIELDS contains "id"
require "clippy-denies-warnings":      value gate::GATES maps "clippy" to "warnings"
forbid  "no-audit-step":               value gate::GATES maps "audit" to "public"
require "model-module":                module model
forbid  "gone-module":                 module gone
forbid  "gone-restart":                symbol gone::VaultDomain.restart
forbid  "gone-imports-model":          dependency gone -> model
forbid  "domain-independent-of-gone":  dependency domain -> gone
forbid  "absent-collection":           value model::ABSENT contains "x"
forbid  "absent-entries":              value model::ABSENT maps "a" to "b"
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

fn collection(name: &str, values: Vec<Literal>) -> CollectionFact {
    CollectionFact {
        path: vec![name.to_owned()],
        line: 3,
        values,
    }
}

fn entry(name: &str, key: &str, values: Option<Vec<&str>>) -> EntryFact {
    EntryFact {
        path: vec![name.to_owned()],
        key: Literal::Str(key.to_owned()),
        line: 4,
        values: values.map(|values| {
            values
                .into_iter()
                .map(|value| Literal::Str(value.to_owned()))
                .collect()
        }),
    }
}

fn imports(names: &[&str]) -> Vec<ImportFact> {
    names
        .iter()
        .enumerate()
        .map(|(index, name)| ImportFact {
            name: (*name).to_owned(),
            line: index + 1,
        })
        .collect()
}

fn module(facts: ModuleFacts) -> ModuleFacts {
    facts
}

fn base_facts() -> BTreeMap<String, ModuleFacts> {
    let mut facts = BTreeMap::new();
    facts.insert(
        "app/model.py".to_owned(),
        module(ModuleFacts {
            exists: true,
            symbols: symbols(&["DURABLE_FIELDS", "Vault"]),
            collections: vec![collection(
                "DURABLE_FIELDS",
                vec![Literal::Str("keeper".into()), Literal::Str("glyph".into())],
            )],
            ..ModuleFacts::default()
        }),
    );
    facts.insert(
        "app/domain.py".to_owned(),
        module(ModuleFacts {
            exists: true,
            symbols: symbols(&["VaultDomain", "VaultDomain.rotate"]),
            imports: imports(&["model"]),
            ..ModuleFacts::default()
        }),
    );
    facts.insert(
        "app/store.py".to_owned(),
        module(ModuleFacts {
            exists: true,
            symbols: symbols(&["VaultStore"]),
            ..ModuleFacts::default()
        }),
    );
    facts.insert(
        "app/gate.py".to_owned(),
        module(ModuleFacts {
            exists: true,
            symbols: symbols(&["GATES"]),
            entries: vec![
                entry("GATES", "clippy", Some(vec!["clippy", "warnings"])),
                entry("GATES", "fmt", Some(vec!["fmt"])),
            ],
            ..ModuleFacts::default()
        }),
    );
    facts
}

fn providers_for(facts: BTreeMap<String, ModuleFacts>) -> Vec<Box<dyn Provider>> {
    vec![Box::new(FakeProvider {
        facts,
        calls: Cell::new(0),
        failure: None,
    })]
}

fn report_for(source: &str, facts: BTreeMap<String, ModuleFacts>) -> FalsifyReport {
    falsify(
        &[contract(source)],
        Path::new("/repo"),
        &providers_for(facts),
    )
}

fn report() -> FalsifyReport {
    report_for(ARCHITECTURE, base_facts())
}

fn rule<'a>(report: &'a FalsifyReport, label: &str) -> &'a RuleFalsification {
    report
        .rules
        .iter()
        .find(|rule| rule.id == format!("architecture::{label}"))
        .unwrap_or_else(|| panic!("no rule {label}"))
}

fn assert_flips(report: &FalsifyReport, label: &str, from: RuleStatus, to: RuleStatus) {
    let found = rule(report, label);
    assert_eq!(found.verdict, Verdict::Falsifiable, "{label}: {found:?}");
    assert_eq!(found.status, from, "{label}");
    assert_eq!(found.counterfactual_status, Some(to), "{label}");
    assert!(found.finding.is_none(), "{label}: {found:?}");
    assert!(found.counterfactual.is_some(), "{label}");
}

fn assert_vacuous(report: &FalsifyReport, label: &str, needle: &str) {
    let found = rule(report, label);
    assert_eq!(found.verdict, Verdict::Vacuous, "{label}: {found:?}");
    let finding = found.finding.as_deref().unwrap_or_default();
    assert!(finding.contains(needle), "{label}: {finding}");
}

#[test]
fn a_satisfied_require_rule_turns_red_when_the_fact_it_names_is_removed() {
    let report = report();
    assert_flips(
        &report,
        "durable-fields",
        RuleStatus::Green,
        RuleStatus::Red,
    );
    assert_eq!(
        rule(&report, "durable-fields").counterfactual.as_deref(),
        Some("app/model.py does not define DURABLE_FIELDS")
    );
    assert_flips(&report, "model-module", RuleStatus::Green, RuleStatus::Red);
    assert_flips(
        &report,
        "durable-keeper",
        RuleStatus::Green,
        RuleStatus::Red,
    );
    assert_flips(
        &report,
        "clippy-denies-warnings",
        RuleStatus::Green,
        RuleStatus::Red,
    );
    assert_flips(
        &report,
        "domain-uses-model",
        RuleStatus::Green,
        RuleStatus::Red,
    );
}

#[test]
fn a_satisfied_forbid_rule_turns_red_when_the_fact_it_names_is_introduced() {
    let report = report();
    assert_flips(
        &report,
        "no-domain-restart",
        RuleStatus::Green,
        RuleStatus::Red,
    );
    assert_eq!(
        rule(&report, "no-domain-restart").counterfactual.as_deref(),
        Some("app/domain.py defines VaultDomain.restart")
    );
    assert_flips(&report, "id-is-the-key", RuleStatus::Green, RuleStatus::Red);
    assert_flips(&report, "no-audit-step", RuleStatus::Green, RuleStatus::Red);
    assert_flips(
        &report,
        "domain-no-json",
        RuleStatus::Green,
        RuleStatus::Red,
    );
    assert_flips(&report, "gone-module", RuleStatus::Green, RuleStatus::Red);
}

#[test]
fn an_injected_module_dependency_uses_a_name_the_provider_reports() {
    let report = report();
    assert_flips(
        &report,
        "domain-independent-of-store",
        RuleStatus::Green,
        RuleStatus::Red,
    );
    assert_eq!(
        rule(&report, "domain-independent-of-store")
            .counterfactual
            .as_deref(),
        Some("app/domain.py imports app.store (app/store.py)")
    );
}

#[test]
fn removing_a_dependency_removes_every_spelling_the_evaluator_matches() {
    let mut facts = base_facts();
    facts.get_mut("app/domain.py").unwrap().imports =
        imports(&["model", "app.model", "app.model.detail"]);
    let report = report_for(ARCHITECTURE, facts);
    assert_flips(
        &report,
        "domain-uses-model",
        RuleStatus::Green,
        RuleStatus::Red,
    );
}

#[test]
fn a_red_rule_is_falsifiable_when_the_fact_it_names_can_be_made_to_hold() {
    let mut facts = base_facts();
    facts.get_mut("app/model.py").unwrap().symbols = symbols(&["Vault"]);
    facts.get_mut("app/model.py").unwrap().collections = Vec::new();
    facts.get_mut("app/domain.py").unwrap().symbols =
        symbols(&["VaultDomain", "VaultDomain.restart"]);
    let report = report_for(ARCHITECTURE, facts);
    assert_flips(
        &report,
        "durable-fields",
        RuleStatus::Red,
        RuleStatus::Green,
    );
    assert_flips(
        &report,
        "no-domain-restart",
        RuleStatus::Red,
        RuleStatus::Green,
    );
}

#[test]
fn a_rule_standing_on_a_missing_module_is_vacuous_rather_than_falsifiable() {
    let report = report();
    assert_vacuous(&report, "gone-restart", "does not exist");
    assert_vacuous(&report, "gone-imports-model", "does not exist");
    assert_vacuous(
        &report,
        "domain-independent-of-gone",
        "create the target module before a dependency on it could be observed",
    );
    let found = rule(&report, "gone-restart");
    assert_eq!(found.status, RuleStatus::Green);
    assert!(found.counterfactual_status.is_none());
}

#[test]
fn a_rule_over_a_name_no_provider_reports_as_a_collection_is_vacuous() {
    let report = report();
    assert_vacuous(&report, "absent-collection", "no literal collection");
    assert_vacuous(&report, "absent-entries", "no key/value entries");
}

#[test]
fn a_rule_that_cannot_be_evaluated_has_no_truth_value_to_invert() {
    const UNREADABLE: &str = r#"
module notes "app/notes.txt"
module model "app/model.py"

require "notes-exist":  module notes
require "deep-symbol":  symbol model::Vault.field.inner
"#;
    let report = report_for(UNREADABLE, base_facts());
    for label in ["notes-exist", "deep-symbol"] {
        let found = rule(&report, label);
        assert_eq!(found.verdict, Verdict::Unevaluable, "{label}: {found:?}");
        assert_eq!(found.status, RuleStatus::Error, "{label}");
        assert!(found.counterfactual.is_none(), "{label}");
    }
    assert_eq!(report.exit_code(), 3);
}

#[test]
fn an_unreadable_payload_is_unevaluable_and_never_repaired_by_a_counterfactual() {
    let mut facts = base_facts();
    facts.get_mut("app/gate.py").unwrap().entries = vec![
        entry("GATES", "clippy", None),
        entry("GATES", "fmt", Some(vec!["fmt"])),
    ];
    let report = report_for(ARCHITECTURE, facts);
    let found = rule(&report, "clippy-denies-warnings");
    assert_eq!(found.verdict, Verdict::Unevaluable, "{found:?}");
    assert!(found.counterfactual.is_none());
}

#[test]
fn the_counts_the_exit_code_and_the_findings_agree() {
    let report = report();
    assert_eq!(report.total, report.rules.len());
    assert_eq!(
        report.falsifiable + report.vacuous + report.unevaluable,
        report.total
    );
    assert_eq!(report.vacuous, 5);
    assert_eq!(report.unevaluable, 0);
    assert_eq!(report.findings().count(), report.vacuous);
    assert_eq!(report.exit_code(), 1);
}

#[test]
fn a_contract_whose_every_rule_discriminates_exits_zero() {
    const TIGHT: &str = r#"
module model "app/model.py"

require "durable-fields": symbol model::DURABLE_FIELDS
require "durable-keeper": value model::DURABLE_FIELDS contains "keeper"
forbid  "id-is-the-key":  value model::DURABLE_FIELDS contains "id"
"#;
    let report = report_for(TIGHT, base_facts());
    assert_eq!(report.exit_code(), 0);
    assert_eq!(report.falsifiable, 3);
    assert_eq!(report.findings().count(), 0);
}

#[test]
fn falsification_inspects_once_and_leaves_the_real_verdicts_untouched() {
    let before = verify(
        &[contract(ARCHITECTURE)],
        Path::new("/repo"),
        &providers_for(base_facts()),
    );
    let report = report();
    let after = verify(
        &[contract(ARCHITECTURE)],
        Path::new("/repo"),
        &providers_for(base_facts()),
    );
    assert_eq!(report.invocations, 1);
    assert_eq!(before.status, after.status);
    for rule in &report.rules {
        let live = before.result(&rule.id).unwrap();
        assert_eq!(rule.status, live.status, "{}", rule.id);
        assert_eq!(rule.status, after.result(&rule.id).unwrap().status);
        assert_eq!(rule.fact, live.fact);
        assert_eq!(rule.requirement, live.requirement);
    }
}

#[test]
fn a_provider_that_cannot_run_makes_every_rule_unevaluable() {
    let providers: Vec<Box<dyn Provider>> = vec![Box::new(FakeProvider {
        facts: base_facts(),
        calls: Cell::new(0),
        failure: Some(ProviderFailure::Unavailable {
            provider: "fake",
            message: "interpreter missing".into(),
        }),
    })];
    let report = falsify(&[contract(ARCHITECTURE)], Path::new("/repo"), &providers);
    assert_eq!(report.unevaluable, report.total);
    assert_eq!(report.falsifiable, 0);
    assert_eq!(report.exit_code(), 3);
}

fn observed_imports(
    provider: &dyn Provider,
    root: &Path,
    from: &str,
    target: &str,
) -> (Vec<String>, String) {
    let declare = |relative: &str| super::super::ModuleDecl {
        name: relative.to_owned(),
        display: relative.to_owned(),
        path: root.join(relative),
        location: crate::diagnostic::Location {
            file: "t.bla".into(),
            line: 1,
            column: 1,
        },
    };
    let from = declare(from);
    let target = declare(target);
    let facts = provider.inspect(root, &[&from]).unwrap();
    let names = facts[&from.key()]
        .imports
        .iter()
        .map(|import| import.name.clone())
        .collect();
    (names, target.dotted(root).unwrap())
}

#[test]
fn the_rust_provider_reports_a_module_dependency_under_the_name_a_counterfactual_injects() {
    let temp = tempfile::TempDir::new().unwrap();
    let root = temp.path();
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("src/lib.rs"), "pub mod a;\npub mod b;\n").unwrap();
    std::fs::write(
        root.join("src/a.rs"),
        "use crate::b;\npub fn go() { b::run(); }\n",
    )
    .unwrap();
    std::fs::write(root.join("src/b.rs"), "pub fn run() {}\n").unwrap();
    let (names, injected) = observed_imports(
        &super::super::rust::RustProvider,
        root,
        "src/a.rs",
        "src/b.rs",
    );
    assert_eq!(injected, "src.b");
    assert!(names.contains(&injected), "{names:?}");
}

#[test]
fn the_python_provider_reports_a_module_dependency_under_the_name_a_counterfactual_injects() {
    let temp = tempfile::TempDir::new().unwrap();
    let root = temp.path();
    std::fs::create_dir_all(root.join("pkg")).unwrap();
    std::fs::write(root.join("pkg/a.py"), "import pkg.b\n").unwrap();
    std::fs::write(root.join("pkg/b.py"), "VALUE = 1\n").unwrap();
    let (names, injected) = observed_imports(
        &super::super::python::PythonProvider,
        root,
        "pkg/a.py",
        "pkg/b.py",
    );
    assert_eq!(injected, "pkg.b");
    assert!(names.contains(&injected), "{names:?}");
}
