use crate::support::task_project::{code, ok};
use crate::support::{cli_json, tree_snapshot};
use crate::task_claims::{
    ORCHESTRATOR_MODEL, WORKER_MODEL, fixture, open_task, prepared, record_bytes,
};
use serde_json::Value;
use tempfile::TempDir;

const PHASES: [&str; 4] = [
    "open-to-accepted",
    "accepted-to-ready",
    "ready-to-closed",
    "check-runs",
];

fn budget(temp: &TempDir) -> Value {
    let (exit, view) = cli_json(temp.path(), &["task", "budget", "work"]);
    assert_eq!(exit, 0, "{view}");
    view
}

fn seconds(view: &Value, phase: &str) -> Value {
    view["phases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["phase"] == phase)
        .unwrap_or_else(|| panic!("no phase {phase}: {view}"))["seconds"]
        .clone()
}

#[test]
fn a_budget_names_every_phase_and_reports_missing_data_as_unknown() {
    let temp = fixture();
    open_task(&temp, "worker", true, &[]);
    let view = budget(&temp);
    let named: Vec<&str> = view["phases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["phase"].as_str().unwrap())
        .collect();
    assert_eq!(named, PHASES.to_vec());
    assert_eq!(view["task"], "work");
    assert_eq!(view["state"], "open");
    for phase in PHASES {
        assert_eq!(seconds(&view, phase), Value::Null, "{phase}");
    }
}

#[test]
fn a_budget_measures_the_phases_the_record_holds_and_leaves_the_rest_unknown() {
    let temp = fixture();
    open_task(&temp, "worker", true, &[]);
    prepared(&temp, WORKER_MODEL);
    let accepted = budget(&temp);
    assert!(seconds(&accepted, "open-to-accepted").is_u64());
    assert_eq!(seconds(&accepted, "accepted-to-ready"), Value::Null);
    ok(&temp, &["task", "ready", "work", "--outcome", "delivered"]);
    let ready = budget(&temp);
    assert!(seconds(&ready, "accepted-to-ready").is_u64());
    assert_eq!(seconds(&ready, "ready-to-closed"), Value::Null);
    assert_eq!(
        code(
            &temp,
            &["task", "close", "work", "--model", ORCHESTRATOR_MODEL]
        ),
        0
    );
    let closed = budget(&temp);
    assert!(seconds(&closed, "open-to-accepted").is_u64());
    assert!(seconds(&closed, "accepted-to-ready").is_u64());
    assert!(seconds(&closed, "ready-to-closed").is_u64());
    assert_eq!(seconds(&closed, "check-runs"), Value::Null);
}

#[test]
fn a_budget_writes_nothing() {
    let temp = fixture();
    open_task(&temp, "worker", true, &[]);
    prepared(&temp, WORKER_MODEL);
    let record = record_bytes(&temp);
    let tree = tree_snapshot(temp.path());
    budget(&temp);
    let text = code(&temp, &["task", "budget", "work"]);
    assert_eq!(text, 0);
    assert_eq!(record_bytes(&temp), record);
    assert_eq!(tree_snapshot(temp.path()), tree);
}

#[test]
fn a_budget_of_a_task_accepted_more_than_once_leaves_the_first_phase_unknown() {
    let temp = fixture();
    open_task(&temp, "worker", true, &[]);
    prepared(&temp, WORKER_MODEL);
    ok(&temp, &["task", "ready", "work", "--outcome", "delivered"]);
    ok(&temp, &["task", "accept", "work", "--model", WORKER_MODEL]);
    let view = budget(&temp);
    assert_eq!(seconds(&view, "open-to-accepted"), Value::Null);
}

#[test]
fn a_budget_of_an_unrecorded_task_is_refused() {
    let temp = fixture();
    let (exit, _) = cli_json(temp.path(), &["task", "budget", "work"]);
    assert_eq!(exit, 2);
}
