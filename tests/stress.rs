use blabla::application::{AppConfig, Application};
use blabla::report::Call;
use blabla::runtime::AppSession;
use blabla::semantics::compile;
use serde_json::Value;
use std::collections::BTreeSet;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;
use support::{args, run};

fn verify_json(contract: &str, app: &Path, cases: &str, steps: &str, shrink: &str) -> (i32, Value) {
    verify_json_seed(contract, app, cases, steps, shrink, "0")
}

fn verify_json_seed(
    contract: &str,
    app: &Path,
    cases: &str,
    steps: &str,
    shrink: &str,
    seed: &str,
) -> (i32, Value) {
    let mut command = args(&[
        "run",
        contract,
        "--seed",
        seed,
        "--cases",
        cases,
        "--steps",
        steps,
        "--shrink-budget",
        shrink,
        "--timeout-ms",
        "5000",
        "--json",
        "--",
    ]);
    command.push(OsStr::new("python"));
    command.push(app.as_os_str());
    let output = run(&command);
    let report = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("invalid JSON report: {error}; {output:?}"));
    (output.status.code().unwrap(), report)
}

fn variant(original: &str, replacement: &str) -> (TempDir, PathBuf) {
    let source = fs::read_to_string("examples/todo/app.py").unwrap();
    assert_eq!(
        source.matches(original).count(),
        1,
        "mutation must target one application statement"
    );
    let directory = TempDir::new().unwrap();
    let transport = directory.path().join("adapters").join("python");
    fs::create_dir_all(&transport).unwrap();
    fs::copy(
        "adapters/python/blabla_adapter.py",
        transport.join("blabla_adapter.py"),
    )
    .unwrap();
    let app = directory
        .path()
        .join("examples")
        .join("todo")
        .join("app.py");
    fs::create_dir_all(app.parent().unwrap()).unwrap();
    fs::write(&app, source.replace(original, replacement)).unwrap();
    (directory, app)
}

fn logical_report(value: Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .into_iter()
                .filter(|(key, _)| {
                    !matches!(
                        key.as_str(),
                        "first_witness_ms"
                            | "elapsed_ms"
                            | "time_to_full_coverage_ms"
                            | "detection_ms"
                            | "shrink_ms"
                    )
                })
                .map(|(key, value)| (key, logical_report(value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(logical_report).collect()),
        value => value,
    }
}

#[test]
#[ignore = "search-quality stress: four seeds plus an independent replay of every generated action"]
fn the_generator_reaches_every_required_input_state_across_seeds() {
    let app_path = Path::new("examples/todo/app.py").canonicalize().unwrap();
    let mut sequences = Vec::new();
    for seed in ["0", "1", "2", "3"] {
        let (exit, report) = verify_json_seed("examples/todo.bla", &app_path, "4", "32", "0", seed);
        assert_eq!(
            exit,
            0,
            "seed={seed}; missing={:?}",
            report["coverage"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|p| p["status"] == "unexercised")
                .map(|p| (&p["id"], &p["required_witness"]))
                .collect::<Vec<_>>()
        );
        assert_eq!(report["steps_executed"], 128);
        sequences.extend(report["sequences"].as_array().unwrap().iter().cloned());
    }
    assert_eq!(
        sequences
            .iter()
            .map(|sequence| sequence.as_array().unwrap().len())
            .sum::<usize>(),
        512
    );
    let contract = compile("examples/todo.bla", include_str!("../examples/todo.bla")).unwrap();
    let config = AppConfig {
        executable: "python".into(),
        args: vec![app_path.into_os_string()],
        timeout: Duration::from_secs(5),
        startup: Duration::from_secs(5),
    };
    let mut coverage = BTreeSet::new();
    for sequence in &sequences {
        let mut app = AppSession::spawn(&config).unwrap();
        app.reset().unwrap();
        for value in sequence.as_array().unwrap() {
            let call: Call = serde_json::from_value(value.clone()).unwrap();
            let before = app.observe(&contract.state).unwrap();
            let todos = before["todos"].as_array().unwrap();
            coverage.insert(call.action.clone());
            match call.action.as_str() {
                "add" => {
                    if call.args[0] == "" {
                        coverage.insert("empty-add".into());
                    }
                    if todos.iter().any(|t| t["text"] == call.args[0]) {
                        coverage.insert("duplicate-text".into());
                    }
                }
                "complete" | "remove" => {
                    let target = todos.iter().find(|t| t["id"] == call.args[0]);
                    coverage.insert(format!(
                        "{}-{}",
                        call.action,
                        if target.is_some() {
                            "existing"
                        } else {
                            "missing"
                        }
                    ));
                    if call.action == "complete" && target.is_some_and(|t| t["done"] == true) {
                        coverage.insert("repeated-complete".into());
                    }
                }
                "restart" if !todos.is_empty() => {
                    coverage.insert("nonempty-restart".into());
                }
                _ => {}
            }
            if call.action == "restart" {
                app.restart().unwrap();
            } else {
                app.call(&call).unwrap();
            }
        }
        app.finish().unwrap();
    }
    for required in [
        "add",
        "complete",
        "remove",
        "restart",
        "empty-add",
        "duplicate-text",
        "complete-existing",
        "complete-missing",
        "remove-existing",
        "remove-missing",
        "repeated-complete",
        "nonempty-restart",
    ] {
        assert!(
            coverage.contains(required),
            "missing {required}; actual coverage {coverage:?}"
        );
    }
}

#[test]
#[ignore = "reproducibility stress: the same shrink campaign twice, compared as logical reports"]
fn a_persistence_counterexample_is_identical_across_two_runs() {
    let (_directory, app) = variant(
        "        os.replace(temporary, self.path)",
        "        temporary.unlink()",
    );
    let (first_exit, first) = verify_json("examples/todo.bla", &app, "4", "32", "256");
    assert_eq!(first_exit, 1, "{first}");
    let (second_exit, second) = verify_json("examples/todo.bla", &app, "4", "32", "256");
    assert_eq!(second_exit, 1, "{second}");
    assert_eq!(logical_report(first), logical_report(second));
}
