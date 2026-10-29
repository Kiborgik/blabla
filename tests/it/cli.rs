use serde_json::Value;
use std::ffi::OsStr;
use std::fs;
use tempfile::{NamedTempFile, TempDir};

use crate::support;
use support::{args, run, run_in};

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
fn run_budgets_are_validated_before_the_application_starts() {
    for (flag, value) in [
        ("--cases", "0"),
        ("--steps", "0"),
        ("--timeout-ms", "42001"),
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
    for extra in [
        &[][..],
        &["--timeout-ms", "42000"][..],
        &["--shrink-budget", "0"][..],
        &["--shrink-budget", "256"][..],
    ] {
        let mut values = vec!["run", "examples/hello.bla"];
        values.extend_from_slice(extra);
        values.extend(["--json", "--", "blabla-nonexistent-test-app"]);
        let output = run(&args(&values));
        assert_eq!(output.status.code(), Some(3), "{extra:?}: {output:?}");
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["category"], "application");
        assert_eq!(report["seed"], 0);
    }
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
    let first_rule_id = rules[0]["id"].as_str().unwrap();
    let human = run(&args(&["check", "--falsify", "contracts/rust.bla"]));
    assert_eq!(human.status.code(), Some(0), "{human:?}");
    assert!(
        String::from_utf8(human.stdout)
            .unwrap()
            .contains(first_rule_id)
    );
}

#[test]
fn help_runs_for_the_binary_and_for_task_verbs() {
    for arguments in [
        &["--help"][..],
        &["task", "--help"][..],
        &["task", "open", "--help"][..],
        &["check", "--help"][..],
    ] {
        let output = run(&args(arguments));
        assert!(output.status.success(), "{arguments:?}: {output:?}");
        assert!(!output.stdout.is_empty(), "{arguments:?}");
    }
}

fn gone_probe(manifest: &str) -> TempDir {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("project.bla"), manifest).unwrap();
    fs::write(
        dir.path().join("probe.bla"),
        "module gone \"app/gone.py\"\nforbid  \"gone-restart\": symbol gone::Domain.restart\n",
    )
    .unwrap();
    dir
}

#[test]
fn a_rule_standing_on_a_missing_module_is_vacuous_and_exits_one() {
    let dir = gone_probe("project Probe\n");
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
fn status_prints_the_standing_challenge_that_finish_prints() {
    let dir = gone_probe("project Probe\n\nuse structure \"probe.bla\"\n");
    let finished = run_in(Some(dir.path()), &args(&["finish", "--json"]));
    let report: Value = serde_json::from_slice(&finished.stdout).unwrap();
    let challenge = &report["challenge"]["challenge"];
    assert!(challenge.is_object(), "{report}");
    let class = challenge["class"].as_str().unwrap();
    let statement = challenge["statement"].as_str().unwrap();
    let expected = blabla::voice::contradiction(blabla::voice::Voice::default(), class, statement);
    let human = run_in(Some(dir.path()), &args(&["status"]));
    let text = String::from_utf8(human.stdout).unwrap();
    assert!(text.contains(&expected), "{text}");
}

#[test]
fn a_contract_in_a_subdirectory_resolves_modules_from_the_project_root() {
    let dir = TempDir::new().unwrap();
    fs::create_dir_all(dir.path().join("contracts")).unwrap();
    fs::create_dir_all(dir.path().join("src")).unwrap();
    fs::write(
        dir.path().join("project.bla"),
        "project Probe\n\nuse structure \"contracts/arch.bla\"\n",
    )
    .unwrap();
    fs::write(dir.path().join("src/thing.rs"), "pub fn run() {}\n").unwrap();
    fs::write(
        dir.path().join("contracts/arch.bla"),
        "module thing \"src/thing.rs\"\n\nrequire \"entry\": symbol thing::run\n",
    )
    .unwrap();
    let output = run_in(
        Some(dir.path()),
        &args(&["check", "contracts/arch.bla", "--json"]),
    );
    assert_eq!(output.status.code(), Some(0), "{output:?}");
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["evaluated"]["state"], "GREEN");
}

#[test]
fn an_option_clap_suggests_is_a_structured_field_of_the_invocation_error() {
    let output = run(&args(&["task", "open", "x", "--check-argv", "y", "--json"]));
    assert_eq!(output.status.code(), Some(2), "{output:?}");
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["category"], "invocation");
    assert_eq!(report["suggested"], "--check");
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
    let dir = gone_probe("project Probe\n");

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

#[test]
fn check_reports_error_for_unsupported_file_extension() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("project.bla"), "project TestProj\n").unwrap();
    fs::write(dir.path().join("test.zig"), "fn main() {}\n").unwrap();
    fs::write(
        dir.path().join("test.bla"),
        "module unsupported \"test.zig\"\nrequire \"test-module\": module unsupported\n",
    )
    .unwrap();

    let output = run_in(Some(dir.path()), &args(&["check", "test.bla", "--json"]));
    assert_eq!(output.status.code(), Some(3), "{output:?}");
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["status"], "error");
    assert_eq!(report["evaluated"]["state"], "ERROR");

    let human_output = run_in(Some(dir.path()), &args(&["check", "test.bla"]));
    assert_eq!(human_output.status.code(), Some(3));
}

#[test]
fn a_project_scoped_check_skips_the_projects_ignored_files_when_counting_lines() {
    let dir = TempDir::new().unwrap();
    fs::write(
        dir.path().join("project.bla"),
        "project Probe\nignore \"pack/skipped/\"\n",
    )
    .unwrap();
    fs::create_dir_all(dir.path().join("pack/skipped")).unwrap();
    fs::write(dir.path().join("pack/small.txt"), "a\nb\n").unwrap();
    fs::write(
        dir.path().join("pack/skipped/huge.txt"),
        "line\n".repeat(50),
    )
    .unwrap();
    fs::write(
        dir.path().join("size.bla"),
        "module pack \"pack\"\nrequire \"bounded\": lines pack <= 3\n",
    )
    .unwrap();

    let output = run_in(Some(dir.path()), &args(&["check", "size.bla", "--json"]));
    assert_eq!(output.status.code(), Some(0), "{output:?}");
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["status"], "ok");
    assert_eq!(report["evaluated"]["state"], "GREEN");
    assert_eq!(report["evaluated"]["issues"], serde_json::json!([]));
}

#[test]
fn run_uses_project_profile_timeout() {
    let dir = TempDir::new().unwrap();

    fs::write(
        dir.path().join("project.bla"),
        r#"project TestProject

verify behavior {
    command ["python", "simple_adapter.py"]
    timeout_ms 30000
}
"#,
    )
    .unwrap();

    fs::write(
        dir.path().join("test_contract.bla"),
        r#"state done: bool

action start()

when start {
    expect "done": after.done == true
}
"#,
    )
    .unwrap();

    fs::write(
        dir.path().join("simple_adapter.py"),
        r#"import json
import sys
import time

sys.stdin.reconfigure(encoding="utf-8", errors="strict")
sys.stdout.reconfigure(encoding="utf-8", errors="strict")
done = False
first_request = True

def emit(request, result):
    value = {"id": request["id"], "result": result}
    print(json.dumps(value, separators=(",", ":")), flush=True)

for line in sys.stdin:
    try:
        request = json.loads(line)
        operation = request.get("op")
        if operation == "reset":
            if first_request:
                time.sleep(1.5)
                first_request = False
            done = False
            emit(request, {"ok": True})
        elif operation == "observe":
            emit(request, {"done": done})
        elif operation == "call" and request.get("name") == "start" and request.get("args") == []:
            done = True
            emit(request, {"ok": True})
        else:
            emit(request, {"ok": False, "error": "unknown request"})
    except Exception as error:
        emit(request, {"ok": False, "error": str(error)})
"#,
    )
    .unwrap();

    let adapter_path = dir.path().join("simple_adapter.py");
    let run_args = vec![
        OsStr::new("run"),
        OsStr::new("test_contract.bla"),
        OsStr::new("--cases"),
        OsStr::new("1"),
        OsStr::new("--steps"),
        OsStr::new("1"),
        OsStr::new("--json"),
        OsStr::new("--"),
        OsStr::new("python"),
        adapter_path.as_os_str(),
    ];
    let output = support::run_in(Some(dir.path()), &run_args);

    assert_eq!(
        output.status.code(),
        Some(0),
        "Expected success with profile timeout: {output:?}"
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["status"], "green", "Expected green status: {report}");
}
