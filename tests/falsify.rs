#[path = "support/cli.rs"]
mod support;

use serde_json::Value;
use std::path::Path;
use support::{args, run_in};
use tempfile::TempDir;

fn write(root: &Path, relative: &str, text: &str) {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn json_of(temp: &TempDir, arguments: &[&str]) -> (Value, i32) {
    let output = run_in(Some(temp.path()), &args(arguments));
    let text = String::from_utf8(output.stdout).unwrap();
    (
        serde_json::from_str(&text).unwrap(),
        output.status.code().unwrap(),
    )
}

fn project_with_contracts(manifest: &str) -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "project.bla", manifest);
    write(
        root,
        "src/main.py",
        "SYMBOLS = [\"a\", \"b\"]\ndef func():\n    pass\n",
    );
    temp
}

#[test]
fn two_active_structure_contracts_both_falsifiable() {
    let manifest = r#"project TestProject

use structure "contracts/first.bla"
use structure "contracts/second.bla"
"#;
    let first_contract = r#"module main "src/main.py"

require "has-symbols": symbol main::SYMBOLS
"#;
    let second_contract = r#"module main "src/main.py"

require "has-func": symbol main::func
"#;
    let temp = project_with_contracts(manifest);
    let root = temp.path();
    write(root, "contracts/first.bla", first_contract);
    write(root, "contracts/second.bla", second_contract);

    let (view, code) = json_of(&temp, &["check", "--falsify", "--json"]);

    assert_eq!(code, 0, "exit code should be 0 for all falsifiable");
    assert_eq!(view["status"], "ok");
    assert_eq!(view["operation"], "falsify");
    assert_eq!(view["layer"], "structure");
    assert_eq!(view["scope"], "project");
    assert_eq!(view["active_structure"], 2);

    let contracts: Vec<String> = view["contracts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap().to_string())
        .collect();
    assert_eq!(contracts.len(), 2);

    assert_eq!(view["total"], 2, "should have 2 rules total");
    assert_eq!(view["falsifiable"], 2, "both rules should be falsifiable");

    assert!(view.get("excluded_drafts").is_none(), "{view}");

    let rules = view["rules"].as_array().unwrap();
    assert_eq!(rules.len(), 2);

    for rule in rules {
        assert_eq!(rule["verdict"], "falsifiable");
        assert!(rule["id"].as_str().unwrap().contains("::"));
    }
}

#[test]
fn one_active_and_one_draft_structure_contract() {
    let manifest = r#"project TestProject

use structure "contracts/active.bla"
draft structure "contracts/draft.bla"
"#;
    let active_contract = r#"module main "src/main.py"

require "has-symbols": symbol main::SYMBOLS
"#;
    let draft_contract = r#"module main "src/main.py"

require "draft-rule": symbol main::func
"#;
    let temp = project_with_contracts(manifest);
    let root = temp.path();
    write(root, "contracts/active.bla", active_contract);
    write(root, "contracts/draft.bla", draft_contract);

    let (view, code) = json_of(&temp, &["check", "--falsify", "--json"]);

    assert_eq!(code, 0);
    assert_eq!(view["active_structure"], 1, "only active should be counted");
    assert_eq!(view["total"], 1, "only active rules should be in total");

    assert_eq!(
        view["excluded_drafts"],
        serde_json::json!(["draft"]),
        "{view}"
    );
    assert_eq!(view["contracts"], serde_json::json!(["active"]), "{view}");
}

#[test]
fn only_draft_structure_contract_returns_error() {
    let manifest = r#"project TestProject

draft structure "contracts/draft.bla"
"#;
    let draft_contract = r#"module main "src/main.py"

require "draft-rule": symbol main::func
"#;
    let temp = project_with_contracts(manifest);
    let root = temp.path();
    write(root, "contracts/draft.bla", draft_contract);

    let (view, code) = json_of(&temp, &["check", "--falsify", "--json"]);

    assert_eq!(code, 2, "{view}");
    assert_eq!(view["status"], "error");
    assert_eq!(view["category"], "project");
    assert!(view.get("rules").is_none(), "{view}");
    assert!(view.get("total").is_none(), "{view}");
}

#[test]
fn vacuous_rule_exits_1() {
    let manifest = r#"project TestProject

use structure "contracts/vacuous.bla"
"#;
    let vacuous_contract = r#"module missing "src/missing.py"

forbid "missing-restart": symbol missing::Domain.restart
"#;
    let temp = project_with_contracts(manifest);
    let root = temp.path();
    write(root, "contracts/vacuous.bla", vacuous_contract);

    let (view, code) = json_of(&temp, &["check", "--falsify", "--json"]);

    assert_eq!(code, 1, "exit 1 when any rule is vacuous");
    assert_eq!(view["status"], "vacuous");
    assert_eq!(view["vacuous"], 1);
    assert_eq!(view["falsifiable"], 0);

    let rules = view["rules"].as_array().unwrap();
    let vacuous_rule = &rules[0];
    assert_eq!(vacuous_rule["verdict"], "vacuous");
}

#[test]
fn unevaluable_rule_exits_3() {
    let manifest = r#"project TestProject

use structure "contracts/unevaluable.bla"
"#;
    let unevaluable_contract = r#"module main "src/main.py"

require "value-is-callable": value main::func contains "impossible"
"#;
    let temp = project_with_contracts(manifest);
    let root = temp.path();
    write(root, "contracts/unevaluable.bla", unevaluable_contract);

    let (view, code) = json_of(&temp, &["check", "--falsify", "--json"]);

    assert_eq!(code, 3, "exit 3 when any rule is unevaluable");
    assert_eq!(view["status"], "unevaluable");
    assert_eq!(view["unevaluable"], 1);

    let rules = view["rules"].as_array().unwrap();
    let unevaluable_rule = &rules[0];
    assert_eq!(unevaluable_rule["verdict"], "unevaluable");
}

#[test]
fn rule_ids_are_canonical_and_resolvable() {
    let manifest = r#"project TestProject

use structure "contracts/test.bla"
"#;
    let contract = r#"module main "src/main.py"

require "symbols-field": symbol main::SYMBOLS
forbid "no-undefined": symbol main::undefined
"#;
    let temp = project_with_contracts(manifest);
    let root = temp.path();
    write(root, "contracts/test.bla", contract);

    let (view, _) = json_of(&temp, &["check", "--falsify", "--json"]);

    let rules = view["rules"].as_array().unwrap();
    assert_eq!(rules.len(), 2);

    for rule in rules {
        let id = rule["id"].as_str().unwrap();
        assert!(id.contains("::"), "id should be in namespace::label format");
        assert!(
            id.starts_with("test::"),
            "id should use contract group as namespace"
        );

        let (explain_view, explain_code) = json_of(&temp, &["explain", id, "--json"]);
        assert_eq!(explain_code, 0, "rule id should be resolvable: {}", id);
        assert_eq!(explain_view["id"], id);
    }
}

#[test]
fn mixed_verdicts_exit_on_highest_priority() {
    let manifest = r#"project TestProject

use structure "contracts/mixed.bla"
"#;
    let contract = r#"module main "src/main.py"
module missing "src/missing.py"

require "has-symbols": symbol main::SYMBOLS
forbid "missing-restart": symbol missing::Domain.restart
"#;
    let temp = project_with_contracts(manifest);
    let root = temp.path();
    write(root, "contracts/mixed.bla", contract);

    let (view, code) = json_of(&temp, &["check", "--falsify", "--json"]);

    assert_eq!(code, 1, "vacuous (exit 1) takes priority over falsifiable");
    assert_eq!(view["status"], "vacuous");
    assert_eq!(view["falsifiable"], 1);
    assert_eq!(view["vacuous"], 1);
}

#[test]
fn completion_is_never_a_signal() {
    let manifest = r#"project TestProject

use structure "contracts/test.bla"
"#;
    let contract = r#"module main "src/main.py"

require "has-x": symbol main::x
"#;
    let temp = project_with_contracts(manifest);
    let root = temp.path();
    write(root, "contracts/test.bla", contract);

    let (view, _) = json_of(&temp, &["check", "--falsify", "--json"]);

    assert_eq!(view["completion"], "not a completion signal");
}

#[test]
fn json_output_includes_all_required_fields() {
    let manifest = r#"project TestProject

use structure "contracts/test.bla"
"#;
    let contract = r#"module main "src/main.py"

require "has-symbols": symbol main::SYMBOLS
"#;
    let temp = project_with_contracts(manifest);
    let root = temp.path();
    write(root, "contracts/test.bla", contract);

    let (view, _) = json_of(&temp, &["check", "--falsify", "--json"]);

    assert!(view.get("status").is_some());
    assert!(view.get("operation").is_some());
    assert!(view.get("layer").is_some());
    assert!(view.get("scope").is_some());
    assert!(view.get("project").is_some());
    assert!(view.get("contracts").is_some());
    assert!(view.get("active_structure").is_some());
    assert!(view.get("completion").is_some());
    assert!(view.get("inspections").is_some());
    assert!(view.get("total").is_some());
    assert!(view.get("falsifiable").is_some());
    assert!(view.get("vacuous").is_some());
    assert!(view.get("unevaluable").is_some());
    assert!(view.get("limits").is_some());
    assert!(view.get("rules").is_some());
}

#[test]
fn single_file_falsify_still_works() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let manifest = r#"project TestProject

use structure "contracts/test.bla"
"#;
    write(root, "project.bla", manifest);
    write(
        root,
        "contracts/test.bla",
        r#"module main "src/main.py"

require "has-symbols": symbol main::SYMBOLS
"#,
    );
    write(
        root,
        "src/main.py",
        "SYMBOLS = [\"a\", \"b\"]\ndef func():\n    pass\n",
    );

    let output = run_in(
        Some(root),
        &args(&["check", "--falsify", "contracts/test.bla", "--json"]),
    );
    let code = output.status.code().unwrap();
    let text = String::from_utf8(output.stdout).unwrap();
    let view: Value = serde_json::from_str(&text).unwrap();

    assert_eq!(code, 0);
    assert_eq!(view["operation"], "falsify");
    assert_eq!(view["layer"], "structure");
    assert!(view.get("scope").is_none(), "{view}");
    assert_eq!(view["contract"], "contracts/test.bla");
}

#[test]
fn memory_files_are_refused_as_memory_rather_than_behavior() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "project.bla", "project TestProject\n");
    for (path, kind, source) in [
        (
            "mission.bla",
            "mission",
            "mission \"x\" { statement \"s\" }\n",
        ),
        ("system.bla", "system", "system \"s\" { purpose \"p\" }\n"),
        ("process.bla", "process", "role \"r\" { purpose \"p\" }\n"),
        (
            "pack.bla",
            "knowledge",
            "knowledge \"p\" { purpose \"u\" }\n",
        ),
    ] {
        write(root, path, source);
        let (view, code) = json_of(&temp, &["check", "--falsify", path, "--json"]);
        assert_eq!(code, 2, "{path}: {view}");
        assert_eq!(view["status"], "error", "{path}: {view}");
        assert_eq!(view["category"], "usage", "{path}: {view}");
        let message = view["message"].as_str().unwrap();
        assert!(
            message.contains(&format!("{kind} memory")),
            "{path}: {message}"
        );
        assert!(!message.contains("campaign"), "{path}: {message}");
    }
}

#[test]
fn a_behavior_contract_is_still_refused_as_behavior() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "project.bla", "project TestProject\n");
    write(root, "behavior.bla", "state todos: [int]\n");
    let (view, code) = json_of(&temp, &["check", "--falsify", "behavior.bla", "--json"]);
    assert_eq!(code, 2, "{view}");
    assert_eq!(view["category"], "usage", "{view}");
    let message = view["message"].as_str().unwrap();
    assert!(message.contains("campaign"), "{message}");
    assert!(!message.contains("memory"), "{message}");
}
