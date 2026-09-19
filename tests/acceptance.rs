use serde_json::Value;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
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

#[test]
fn hello_world_crosses_the_real_process_boundary() {
    let app = Path::new("examples/hello/app.py").canonicalize().unwrap();
    let (exit, report) = verify_json("examples/hello.bla", &app, "1", "1", "0");
    assert_eq!(exit, 0, "{report}");
    assert_eq!(report["status"], "green");
    assert_eq!(report["steps_executed"], 1);
    assert_eq!(report["sequences"][0][0]["action"], "start");
}

#[test]
fn the_todo_example_campaign_finishes_green_with_every_obligation_exercised() {
    let app = Path::new("examples/todo/app.py").canonicalize().unwrap();
    let (exit, report) = verify_json("examples/todo.bla", &app, "4", "32", "0");
    assert_eq!(
        exit,
        0,
        "unexercised={:?}",
        report["coverage"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|obligation| obligation["status"] == "unexercised")
            .map(|obligation| (&obligation["id"], &obligation["required_witness"]))
            .collect::<Vec<_>>()
    );
    assert_eq!(report["status"], "green");
    assert_eq!(report["unexercised"], 0);
    assert_eq!(report["violated"], 0);
    assert_eq!(report["steps_executed"], 128);
}

#[test]
fn persistence_mutation_shrinks_to_a_two_action_counterexample() {
    let (_directory, app) = variant(
        "        os.replace(temporary, self.path)",
        "        temporary.unlink()",
    );
    let (exit, report) = verify_json("examples/todo.bla", &app, "4", "32", "256");
    assert_eq!(exit, 1, "{report}");
    assert_eq!(report["status"], "red");
    assert_eq!(report["property"], "persistence");
    let sequence = report["minimal_sequence"].as_array().unwrap();
    assert_eq!(sequence.len(), 2, "{report}");
    assert_eq!(sequence[0]["action"], "add");
    assert!(!sequence[0]["args"][0].as_str().unwrap().is_empty());
    assert_eq!(sequence[1]["action"], "restart");
    assert_eq!(report["after"]["todos"].as_array().unwrap().len(), 0);
    assert_eq!(report["before"]["todos"].as_array().unwrap().len(), 1);
    assert_eq!(report["shrink"]["status"], "fixed_point");
    assert_eq!(report["shrink"]["confirmations"], 2);
}

#[test]
fn contract_detects_identity_completion_and_unrelated_data_loss_mutations() {
    let variants = [
        (
            "        next_id = max((todo[\"id\"] for todo in self.todos), default=0) + 1",
            "        next_id = 1",
        ),
        (
            "                    todo[\"done\"] = True",
            "                    todo[\"done\"] = False",
        ),
        (
            "        remaining = [todo for todo in self.todos if todo[\"id\"] != todo_id]",
            "        remaining = []",
        ),
    ];
    for (original, replacement) in variants {
        let (_directory, app) = variant(original, replacement);
        let (exit, report) = verify_json("examples/todo.bla", &app, "4", "32", "0");
        assert_eq!(exit, 1, "mutation {replacement}: {report}");
        assert_eq!(report["status"], "red");
        assert_ne!(report["property"], "persistence");
    }
}

#[test]
fn forbidden_initial_state_fails_before_any_generated_action() {
    let (_directory, app) = variant(
        "        self.storage.reset()\n        self.todos = []",
        "        self.storage.reset()\n        self.todos = [{\"id\": 1, \"text\": \"\", \"done\": False}]",
    );
    let (exit, report) = verify_json("examples/todo.bla", &app, "1", "1", "8");
    assert_eq!(exit, 1, "{report}");
    assert_eq!(report["property"], "empty-text");
    assert_eq!(report["minimal_sequence"], serde_json::json!([]));
    assert_eq!(report["steps_executed"], 0);
    assert!(
        report["predicate"]
            .as_str()
            .unwrap()
            .starts_with("not (any(todos,"),
        "{report}"
    );
    let mut command = args(&[
        "run",
        "examples/todo.bla",
        "--cases",
        "1",
        "--steps",
        "1",
        "--shrink-budget",
        "0",
        "--",
        "python",
    ]);
    command.push(app.as_os_str());
    let human = run(&command);
    assert_eq!(human.status.code(), Some(1));
    let text = String::from_utf8(human.stdout).unwrap();
    assert!(text.contains("predicate: not (any(todos,"), "{text}");
    assert!(text.contains("expected predicate: true"), "{text}");
    assert!(text.contains("actual predicate: false"), "{text}");
}
