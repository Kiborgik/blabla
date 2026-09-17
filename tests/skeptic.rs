#[path = "support/cli.rs"]
mod support;

use serde_json::Value;
use std::path::Path;
use support::{args, run_in};
use tempfile::TempDir;

const MANIFEST: &str =
    "project Fixture\n\nprocess \"process.bla\"\n\nuse structure \"contracts/arch.bla\"\n";
const CONTRACT: &str = "module thing \"src/thing.rs\"\n\nrequire \"entry\": symbol thing::run\n";
const SOURCE: &str = "pub fn run() {}\n";
const OWED: &str = "pub fn owed() {}\n";

const PROCESS: &str = r#"
role "orchestrator" {
    purpose "divide the work and decide completion"
    verification "product"
}

role "worker" {
    purpose "carry out one bounded task"
    verification "focused"
    model "qwen3.5:4b"
}

flow "development" {
    purpose "one bounded change from context to gate"
}

step "assign" {
    flow "development"
    role ["orchestrator"]
    statement "record the bounded task before the work starts"
    command "blabla task open"
}

step "challenge" {
    flow "development"
    role ["orchestrator", "worker"]
    statement "ask BlaBla to contradict the current account of the work"
    command "blabla challenge"
}
"#;

fn write(root: &Path, relative: &str, text: &str) {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn project() -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "project.bla", MANIFEST);
    write(root, "contracts/arch.bla", CONTRACT);
    write(root, "src/thing.rs", SOURCE);
    write(root, "src/other.rs", SOURCE);
    write(root, "src/owed.rs", OWED);
    write(root, "process.bla", PROCESS);
    temp
}

fn json_of(temp: &TempDir, arguments: &[&str]) -> (Value, i32) {
    let output = run_in(Some(temp.path()), &args(arguments));
    (
        serde_json::from_str(&String::from_utf8(output.stdout).unwrap()).unwrap(),
        output.status.code().unwrap(),
    )
}

fn run(temp: &TempDir, arguments: &[&str]) -> i32 {
    run_in(Some(temp.path()), &args(arguments))
        .status
        .code()
        .unwrap()
}

fn assign(temp: &TempDir, deliverable: &str) {
    assign_within(temp, "src", deliverable);
}

fn assign_within(temp: &TempDir, scope: &str, deliverable: &str) {
    assert_eq!(
        run(
            temp,
            &[
                "task",
                "open",
                "one",
                "--role",
                "worker",
                "--statement",
                "a bounded change",
                "--scope",
                scope,
                "--deliverable",
                deliverable,
                "--json",
            ],
        ),
        0
    );
}

fn ungrounded(view: &Value, class: &str) -> String {
    view["ungrounded"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry[0] == class)
        .map(|entry| entry[1].as_str().unwrap().to_owned())
        .unwrap_or_else(|| panic!("{class} is not reported as ungrounded"))
}

#[test]
fn a_deliverable_that_never_changed_is_challenged_and_the_challenge_exits_nonzero() {
    let temp = project();
    assign(&temp, "src/owed.rs");
    let (view, code) = json_of(&temp, &["challenge", "--json"]);
    assert_eq!(view["challenge"]["class"], "deliverable-unchanged");
    assert_eq!(view["task"], "one");
    assert_eq!(code, 1);

    write(temp.path(), "src/owed.rs", "pub fn owed() -> u8 { 1 }\n");
    let (view, code) = json_of(&temp, &["challenge", "--json"]);
    assert!(view["challenge"].is_null());
    assert_eq!(
        ungrounded(&view, "deliverable-unchanged"),
        "every declared deliverable changed since the task opened"
    );
    assert_eq!(code, 0);
}

#[test]
fn a_registered_contract_owed_as_a_deliverable_is_measured_rather_than_reported_absent() {
    let temp = project();
    assign_within(&temp, "contracts", "contracts/arch.bla");
    let (view, code) = json_of(&temp, &["challenge", "--json"]);
    assert_eq!(view["challenge"]["class"], "deliverable-unchanged");
    assert!(
        view["challenge"]["evidence"]
            .as_array()
            .unwrap()
            .iter()
            .all(|line| !line.as_str().unwrap().contains("absent")),
        "{view}"
    );
    assert_eq!(code, 1);

    write(
        temp.path(),
        "contracts/arch.bla",
        "module thing \"src/thing.rs\"\n\nrequire \"entry\": symbol thing::run\nrequire \"other\": symbol thing::run\n",
    );
    let (view, code) = json_of(&temp, &["challenge", "--json"]);
    assert!(view["challenge"].is_null(), "{view}");
    assert_eq!(code, 0);
}

#[test]
fn a_deliverable_that_does_not_exist_is_challenged() {
    let temp = project();
    assign(&temp, "tests/absent.rs");
    let (view, code) = json_of(&temp, &["challenge", "--json"]);
    assert_eq!(view["challenge"]["class"], "deliverable-unchanged");
    assert_eq!(code, 1);
}

#[test]
fn an_unresolved_finding_outranks_every_other_challenge_and_a_resolution_retires_it() {
    let temp = project();
    assign(&temp, "src/owed.rs");
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "finding",
                "one",
                "the guard reads a value the parser never produces",
                "--json"
            ]
        ),
        0
    );

    let (view, code) = json_of(&temp, &["challenge", "--json"]);
    assert_eq!(view["challenge"]["class"], "unresolved-finding");
    assert_eq!(code, 1);
    let grounded: Vec<&str> = view["grounded"]
        .as_array()
        .unwrap()
        .iter()
        .map(|class| class.as_str().unwrap())
        .collect();
    assert!(grounded.contains(&"deliverable-unchanged"));

    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "resolve",
                "one",
                "1",
                "--evidence",
                "src/thing.rs:1 the parser does produce it",
                "--json",
            ],
        ),
        0
    );
    let (view, _) = json_of(&temp, &["challenge", "--json"]);
    assert_eq!(view["challenge"]["class"], "deliverable-unchanged");
    assert_eq!(
        ungrounded(&view, "unresolved-finding"),
        "every finding recorded on the task carries a resolution"
    );
}

#[test]
fn a_finding_on_a_closed_task_is_history_rather_than_an_open_challenge() {
    let temp = project();
    assign(&temp, "src/owed.rs");
    run(
        &temp,
        &["task", "finding", "one", "left outstanding", "--json"],
    );
    assert_eq!(run(&temp, &["task", "close", "one", "--json"]), 0);

    let (view, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        ungrounded(&view, "unresolved-finding"),
        "the task is closed; a finding on it is history rather than open evidence"
    );
    assert_eq!(view["challenge"]["class"], "deliverable-unchanged");
    assert_eq!(code, 1);
}

#[test]
fn a_file_changed_outside_the_write_scope_is_challenged_and_one_inside_it_is_not() {
    let temp = project();
    assign_within(&temp, "src/thing.rs", "src/thing.rs");
    write(temp.path(), "src/thing.rs", "pub fn run() -> u8 { 1 }\n");

    let (view, _) = json_of(&temp, &["challenge", "--json"]);
    assert_eq!(
        ungrounded(&view, "scope-breach"),
        "every file changed since the task opened is inside its write scope"
    );

    write(temp.path(), "src/other.rs", "pub fn run() -> u8 { 2 }\n");
    let (view, code) = json_of(&temp, &["challenge", "--json"]);
    assert_eq!(view["challenge"]["class"], "scope-breach");
    assert_eq!(code, 1);
    assert!(
        view["challenge"]["evidence"]
            .as_array()
            .unwrap()
            .iter()
            .any(|line| line.as_str().unwrap().contains("src/other.rs"))
    );

    assert_eq!(
        run(
            &temp,
            &["task", "scope", "one", "--add", "src/other.rs", "--json"]
        ),
        0
    );
    let (view, code) = json_of(&temp, &["challenge", "--json"]);
    assert_eq!(
        ungrounded(&view, "scope-breach"),
        "every file changed since the task opened is inside its write scope"
    );
    assert_eq!(code, 0);
}

#[test]
fn a_class_with_no_evidence_behind_it_says_so_rather_than_reporting_no_contradiction() {
    let temp = project();
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "open",
                "bare",
                "--role",
                "worker",
                "--statement",
                "no scope, no deliverable",
                "--json",
            ],
        ),
        0
    );
    let (view, _) = json_of(&temp, &["challenge", "--json"]);
    assert_eq!(
        ungrounded(&view, "scope-breach"),
        "the task declares no write scope"
    );
    assert_eq!(
        ungrounded(&view, "deliverable-unchanged"),
        "the task declares no deliverable"
    );
    assert_eq!(
        ungrounded(&view, "unresolved-finding"),
        "the task records no finding"
    );
}

#[test]
fn a_challenge_writes_nothing_and_never_moves_the_completion_gate() {
    let temp = project();
    assign(&temp, "src/owed.rs");
    let record = temp.path().join(".blabla").join("tasks").join("one.json");
    let before = std::fs::read(&record).unwrap();

    let (status_before, status_code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(run(&temp, &["challenge"]), 1);
    let (status_after, code_after) = json_of(&temp, &["status", "--json"]);

    assert_eq!(std::fs::read(&record).unwrap(), before);
    assert_eq!(status_before["overall"], status_after["overall"]);
    assert_eq!(status_code, code_after);
}

#[test]
fn status_names_every_recorded_task_and_the_flow_that_says_when_to_challenge() {
    let temp = project();
    assign(&temp, "src/owed.rs");
    let (view, _) = json_of(&temp, &["status", "--json"]);

    assert_eq!(view["bounded_tasks"]["open"], 1);
    assert_eq!(view["bounded_tasks"]["tasks"][0]["id"], "task::one");
    assert_eq!(view["bounded_tasks"]["tasks"][0]["role"], "role::worker");
    assert_eq!(
        view["process_memory"]["flows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|flow| flow.as_str().unwrap())
            .collect::<Vec<&str>>(),
        ["flow::development"]
    );
    assert_eq!(view["process_memory"]["steps"], 2);
}

#[test]
fn a_flow_costs_one_line_per_step_and_the_step_identity_carries_the_statement() {
    let temp = project();
    let (flow, code) = json_of(&temp, &["explain", "flow::development", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(flow["kind"], "flow");
    let steps = flow["steps"].as_array().unwrap();
    assert_eq!(steps.len(), 2);
    for step in steps {
        assert!(!step.as_str().unwrap().contains("record the bounded task"));
    }

    let (step, code) = json_of(&temp, &["explain", "step::assign", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(step["kind"], "step");
    assert_eq!(step["flow"], "flow::development");
    assert_eq!(step["command"], "blabla task open");
    assert_eq!(step["enforcement"], "advisory");
    assert_eq!(
        step["applies_to"]
            .as_array()
            .unwrap()
            .iter()
            .map(|role| role.as_str().unwrap())
            .collect::<Vec<&str>>(),
        ["role::orchestrator"]
    );
}

#[test]
fn a_role_reaches_every_step_it_carries_including_one_shared_with_another_role() {
    let temp = project();
    let (worker, _) = json_of(&temp, &["explain", "role::worker", "--json"]);
    let steps: Vec<&str> = worker["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| step.as_str().unwrap())
        .collect();
    assert_eq!(steps.len(), 1);
    assert!(steps[0].starts_with("step::challenge"));

    let (challenge, _) = json_of(&temp, &["explain", "step::challenge", "--json"]);
    assert_eq!(
        challenge["applies_to"]
            .as_array()
            .unwrap()
            .iter()
            .map(|role| role.as_str().unwrap())
            .collect::<Vec<&str>>(),
        ["role::orchestrator", "role::worker"]
    );
}

#[test]
fn a_step_pointing_at_an_undeclared_flow_or_role_makes_the_process_memory_invalid() {
    let temp = project();
    write(
        temp.path(),
        "process.bla",
        "role \"worker\" { purpose \"carry out one bounded task\" }\n\nflow \"development\" { purpose \"one bounded change\" }\n\nstep \"assign\" { flow \"absent\" role [\"ghost\"] statement \"record it\" }\n",
    );
    let (view, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["process_memory"]["state"], "invalid");
    let problems: Vec<&str> = view["process_memory"]["problems"]
        .as_array()
        .unwrap()
        .iter()
        .map(|problem| problem.as_str().unwrap())
        .collect();
    assert_eq!(problems.len(), 3);
    assert_eq!(view["overall"]["status"], "green");
}

#[test]
fn a_flow_that_declares_no_step_describes_no_loop_and_is_invalid() {
    let temp = project();
    write(
        temp.path(),
        "process.bla",
        "role \"worker\" { purpose \"carry out one bounded task\" }\n\nflow \"development\" { purpose \"one bounded change\" }\n",
    );
    let (view, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["process_memory"]["state"], "invalid");
    assert_eq!(
        view["process_memory"]["problems"].as_array().unwrap().len(),
        1
    );
    assert_eq!(view["overall"]["status"], "green");
}
