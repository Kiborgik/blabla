use serde_json::Value;
use std::ffi::OsStr;
use std::fs;
use tempfile::{NamedTempFile, TempDir};

#[path = "support/cli.rs"]
mod support;
use support::{args, run, run_in};

#[test]
fn help_describes_contract_commands() {
    let output = run(&args(&["--help"]));
    assert!(output.status.success());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("check"), "{text}");
    assert!(text.contains("run"), "{text}");
    assert!(text.contains("behavioral"), "{text}");
    for required in [
        "executable project memory",
        ".bla",
        "meaningful changes",
        "completion",
        "GREEN",
        "YELLOW",
        "RED",
        "weaken",
    ] {
        assert!(text.contains(required), "missing {required}: {text}");
    }
}

#[test]
fn check_reports_compiled_behavior_counts() {
    let output = run(&args(&["check", "examples/todo.bla", "--json"]));
    assert_eq!(output.status.code(), Some(0), "{output:?}");
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["status"], "ok");
    assert_eq!(report["actions"], 4);
    assert_eq!(report["postconditions"], 12);
    assert_eq!(report["invariants"], 1);
    assert_eq!(report["forbidden"], 1);
}

#[test]
fn invalid_source_is_located_and_machine_readable() {
    let source = NamedTempFile::new().unwrap();
    fs::write(
        source.path(),
        "state x: int\naction start()\nwhen start { expect \"bad\": after.missing == 1 }",
    )
    .unwrap();
    let output = run(&[
        OsStr::new("check"),
        source.path().as_os_str(),
        OsStr::new("--json"),
    ]);
    assert_eq!(output.status.code(), Some(2), "{output:?}");
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["status"], "error");
    assert_eq!(report["category"], "contract");
    assert_eq!(report["diagnostic"]["location"]["line"], 3);
    assert!(
        report["diagnostic"]["code"]
            .as_str()
            .unwrap()
            .starts_with('E')
    );
}

#[test]
fn invalid_budgets_fail_without_launching_an_application() {
    for (flag, value) in [
        ("--cases", "0"),
        ("--steps", "0"),
        ("--timeout-ms", "5001"),
        ("--timeout-ms", "0"),
        ("--shrink-budget", "257"),
    ] {
        let output = run(&args(&[
            "run",
            "examples/hello.bla",
            flag,
            value,
            "--json",
            "--",
            "missing-application",
        ]));
        assert_eq!(output.status.code(), Some(2), "{flag} {value}: {output:?}");
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["category"], "invocation");
    }
}

#[test]
fn zero_and_maximum_shrink_budgets_reach_application_startup() {
    for budget in ["0", "256"] {
        let output = run(&args(&[
            "run",
            "examples/hello.bla",
            "--shrink-budget",
            budget,
            "--json",
            "--",
            "blabla-nonexistent-test-app",
        ]));
        assert_eq!(output.status.code(), Some(3), "{budget}: {output:?}");
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["category"], "application");
    }
}

#[test]
fn missing_application_is_a_protocol_error() {
    let output = run(&args(&[
        "run",
        "examples/hello.bla",
        "--json",
        "--",
        "blabla-nonexistent-test-app",
    ]));
    assert_eq!(output.status.code(), Some(3), "{output:?}");
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["category"], "application");
    assert_eq!(report["seed"], 0);
}

#[test]
fn application_flags_are_not_consumed_by_the_verifier() {
    let output = run(&args(&[
        "run",
        "examples/hello.bla",
        "--cases",
        "1",
        "--steps",
        "1",
        "--",
        "blabla-nonexistent-test-app",
        "--json",
    ]));
    assert_eq!(output.status.code(), Some(3), "{output:?}");
    assert!(output.stdout.is_empty(), "{output:?}");
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("seed: 0")
    );
}

#[test]
fn unknown_options_produce_json_invocation_errors() {
    let output = run(&args(&["check", "examples/hello.bla", "--bogus", "--json"]));
    assert_eq!(output.status.code(), Some(2));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["category"], "invocation");
}

#[test]
fn falsifying_the_rust_contract_reports_every_rule_as_falsifiable() {
    let output = run(&args(&[
        "check",
        "--falsify",
        "contracts/rust.bla",
        "--json",
    ]));
    assert_eq!(output.status.code(), Some(0), "{output:?}");
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["status"], "ok");
    assert_eq!(report["operation"], "falsify");
    assert_eq!(report["layer"], "structure");
    assert_eq!(report["inspections"], 1);
    let total = report["total"].as_i64().unwrap();
    assert_eq!(report["falsifiable"], total);
    assert_eq!(report["vacuous"], 0);
    assert_eq!(report["unevaluable"], 0);
    let rules = report["rules"].as_array().unwrap();
    assert_eq!(rules.len() as i64, total);
    for rule in rules {
        assert_eq!(rule["verdict"], "falsifiable");
        assert!(rule["counterfactual"].is_string());
        assert!(!rule["counterfactual"].as_str().unwrap().is_empty());
        assert_eq!(rule["counterfactual_status"], "red");
        assert_eq!(rule["status"], "green");
    }
}

#[test]
fn the_human_and_json_falsification_renderings_carry_one_result() {
    let json_output = run(&args(&[
        "check",
        "--falsify",
        "contracts/rust.bla",
        "--json",
    ]));
    let json_report: Value = serde_json::from_slice(&json_output.stdout).unwrap();
    let first_rule_id = json_report["rules"][0]["id"].as_str().unwrap().to_string();

    let human_output = run(&args(&["check", "--falsify", "contracts/rust.bla"]));
    assert_eq!(human_output.status.code(), Some(0), "{human_output:?}");
    let human_text = String::from_utf8(human_output.stdout).unwrap();
    assert!(human_text.contains("FALSIFICATION"), "{human_text}");
    assert!(human_text.contains(&first_rule_id), "{human_text}");
    assert!(human_text.contains("FALSIFIABLE"), "{human_text}");
    assert!(
        human_text.contains("Exit 0 every rule falsifiable"),
        "{human_text}"
    );
    assert!(!human_text.contains("VACUOUS"), "{human_text}");
}

#[test]
fn a_rule_standing_on_a_missing_module_is_vacuous_and_exits_one() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("project.bla"), "project Probe\n").unwrap();
    fs::write(
        dir.path().join("probe.bla"),
        "module gone \"app/gone.py\"\nforbid  \"gone-restart\": symbol gone::Domain.restart\n",
    )
    .unwrap();
    let output = run_in(
        Some(dir.path()),
        &args(&["check", "--falsify", "probe.bla", "--json"]),
    );
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["status"], "vacuous");
    assert_eq!(report["vacuous"], 1);
    assert_eq!(report["falsifiable"], 0);
    assert_eq!(report["rules"][0]["verdict"], "vacuous");
    assert_eq!(report["rules"][0]["status"], "green");
    assert!(report["rules"][0]["finding"].is_string());
    assert!(report["rules"][0].get("counterfactual_status").is_none());
}

#[test]
fn a_module_fact_is_falsifiable_even_when_its_file_is_absent() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("project.bla"), "project Probe\n").unwrap();
    fs::write(
        dir.path().join("exists.bla"),
        "module gone \"app/gone.py\"\nforbid  \"gone-module\": module gone\n",
    )
    .unwrap();
    let output = run_in(
        Some(dir.path()),
        &args(&["check", "--falsify", "exists.bla", "--json"]),
    );
    assert_eq!(output.status.code(), Some(0), "{output:?}");
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    let rules = report["rules"].as_array().unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0]["verdict"], "falsifiable");
}

#[test]
fn falsification_needs_exactly_one_structure_contract() {
    let output_behavior = run(&args(&[
        "check",
        "--falsify",
        "examples/todo.bla",
        "--json",
    ]));
    assert_eq!(
        output_behavior.status.code(),
        Some(2),
        "{output_behavior:?}"
    );
    let report_behavior: Value = serde_json::from_slice(&output_behavior.stdout).unwrap();
    assert_eq!(report_behavior["category"], "usage");
}

#[test]
fn falsification_leaves_status_and_the_record_untouched() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("project.bla"), "project Probe\n").unwrap();
    fs::write(
        dir.path().join("probe.bla"),
        "module gone \"app/gone.py\"\nforbid  \"gone-restart\": symbol gone::Domain.restart\n",
    )
    .unwrap();

    let status_before_output = run_in(Some(dir.path()), &args(&["--json", "status"]));
    let status_before: Value = serde_json::from_slice(&status_before_output.stdout).unwrap();

    let _falsify_output = run_in(
        Some(dir.path()),
        &args(&["check", "--falsify", "probe.bla", "--json"]),
    );

    let status_after_output = run_in(Some(dir.path()), &args(&["--json", "status"]));
    let status_after: Value = serde_json::from_slice(&status_after_output.stdout).unwrap();

    assert_eq!(status_before, status_after);
    assert!(!dir.path().join(".blabla").exists());
}
