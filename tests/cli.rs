use serde_json::Value;
use std::ffi::OsStr;
use std::fs;
use tempfile::NamedTempFile;

#[path = "support/cli.rs"]
mod support;
use support::{args, run};

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
