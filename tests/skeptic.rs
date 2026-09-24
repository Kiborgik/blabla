#[path = "support/cli.rs"]
mod support;

use serde_json::Value;
use std::path::Path;
use support::{args, run_in};
use tempfile::TempDir;

const MANIFEST: &str =
    "project Fixture\n\nprocess \"process.bla\"\n\nuse structure \"contracts/arch.bla\"\n";
const CONTRACT: &str = "module thing \"src/thing.rs\"\n\nrequire \"entry\": symbol thing::run\n";
const CONSULTING_MANIFEST: &str = "project Fixture\n\nprocess \"process.bla\"\n\nknowledge \"knowledge/engineering.bla\"\n\nuse structure \"contracts/arch.bla\"\n";
const PACK: &str = r#"
knowledge "engineering" {
    purpose "engineering judgment for the fixture"
}

ruling "smallest-correct-change" {
    pack "engineering"
    statement "change what the task requires and nothing else"
}
"#;
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

fn project_whose_role_consults_a_pack() -> TempDir {
    let temp = project();
    let root = temp.path();
    let consulting = PROCESS.replace(
        "    model \"qwen3.5:4b\"\n",
        "    model \"qwen3.5:4b\"\n    consult [\"engineering\"]\n",
    );
    assert_ne!(
        consulting, PROCESS,
        "the fixture no longer declares the worker model it attaches consult to"
    );
    write(root, "project.bla", CONSULTING_MANIFEST);
    write(root, "knowledge/engineering.bla", PACK);
    write(root, "process.bla", &consulting);
    temp
}

fn json_of(temp: &TempDir, arguments: &[&str]) -> (Value, i32) {
    let output = run_in(Some(temp.path()), &args(arguments));
    (
        serde_json::from_str(&String::from_utf8(output.stdout).unwrap()).unwrap(),
        output.status.code().unwrap(),
    )
}

fn stdout_of(temp: &TempDir, arguments: &[&str]) -> String {
    String::from_utf8(run_in(Some(temp.path()), &args(arguments)).stdout).unwrap()
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

#[test]
fn changing_a_non_deliverable_input_requires_new_check_evidence() {
    let temp = project();
    assign(&temp, "src/owed.rs");
    assert_eq!(
        run(&temp, &["task", "accept", "one", "--model", "qwen3.5:4b"]),
        0
    );
    write(temp.path(), "src/owed.rs", "pub fn owed() { let _ = 1; }\n");
    assert_eq!(
        run(
            &temp,
            &["task", "evidence", "one", "--exit", "0", "--tool", "test"]
        ),
        0
    );
    write(temp.path(), "src/other.rs", "pub fn run() { let _ = 2; }\n");
    assert_ne!(run(&temp, &["challenge", "one"]), 0);
    assert_ne!(run(&temp, &["task", "ready", "one"]), 0);
    assert_eq!(
        run(
            &temp,
            &["task", "evidence", "one", "--exit", "0", "--tool", "test"]
        ),
        0
    );
    assert_eq!(run(&temp, &["challenge", "one"]), 0);
    assert_eq!(run(&temp, &["task", "ready", "one"]), 0);
}

#[test]
fn explicit_check_inputs_track_creation_without_staling_on_unrelated_edits() {
    let temp = project();
    assign(&temp, "src/owed.rs");
    assert_eq!(
        run(
            &temp,
            &["task", "check", "one", "check", "--input", "src/read.rs"]
        ),
        0
    );
    write(temp.path(), "src/owed.rs", "pub fn owed() { let _ = 1; }\n");
    record_success(&temp);
    write(temp.path(), "src/other.rs", "pub fn run() { let _ = 2; }\n");
    assert_eq!(run(&temp, &["challenge", "one"]), 0);
    write(temp.path(), "src/read.rs", "pub fn input() {}\n");
    assert_ne!(run(&temp, &["challenge", "one"]), 0);
    assert_ne!(run(&temp, &["task", "ready", "one"]), 0);
    record_success(&temp);
    assert_eq!(run(&temp, &["challenge", "one"]), 0);
    assert_eq!(run(&temp, &["task", "ready", "one"]), 0);
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
                "--check",
                "cargo test --lib",
                "--json",
            ],
        ),
        0
    );
    assert_eq!(
        run(
            temp,
            &["task", "accept", "one", "--model", "qwen3.5:4b", "--json"]
        ),
        0
    );
}

fn confirm(temp: &TempDir) {
    assert_eq!(
        run(
            temp,
            &["task", "confirm", "one", "--model", "opus", "--json"]
        ),
        0
    );
}

fn record_success(temp: &TempDir) {
    assert_eq!(
        run(
            temp,
            &[
                "task", "evidence", "one", "--exit", "0", "--tool", "test", "--json"
            ]
        ),
        0
    );
}

#[test]
fn scoped_handback_does_not_require_the_workers_product_gate() {
    let temp = project();
    write(
        temp.path(),
        "contracts/behavior.bla",
        "state count: int\naction increment()\nwhen increment { expect \"increment\": after.count == before.count + 1 }\n",
    );
    write(
        temp.path(),
        "project.bla",
        &format!(
            "{MANIFEST}\nuse behavior \"contracts/behavior.bla\"\nverify behavior {{ command [\"python\", \"app.py\"] seed 0 cases 1 steps 1 timeout_ms 1000 shrink_budget 0 }}\n"
        ),
    );
    assign(&temp, "src/owed.rs");
    write(temp.path(), "src/owed.rs", "pub fn owed() -> u8 { 1 }\n");
    record_success(&temp);
    let (challenge, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(code, 0, "{challenge}");
    assert_eq!(challenge["assignment_clear"], true);
    assert!(
        challenge["grounded"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "verification-not-current")
    );
    assert_eq!(run(&temp, &["task", "ready", "one", "--json"]), 0);
    assert_eq!(
        run(
            &temp,
            &["task", "close", "one", "--model", "opus", "--json"]
        ),
        2
    );
}

#[test]
fn a_directory_created_after_assignment_is_observed_and_its_evidence_can_go_stale() {
    let temp = project();
    assign_within(&temp, "generated", "generated");
    write(temp.path(), "generated/a.rs", "pub fn generated() {}\n");
    record_success(&temp);
    let (challenge, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(code, 0, "{challenge}");
    assert_eq!(run(&temp, &["task", "ready", "one", "--json"]), 0);
    write(temp.path(), "generated/b.rs", "pub fn more() {}\n");
    let (stale, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(code, 1, "{stale}");
    assert!(
        stale["grounded"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "evidence-superseded")
    );
    assert_eq!(
        run(
            &temp,
            &["task", "close", "one", "--model", "opus", "--json"]
        ),
        2
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
    record_success(&temp);
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
    record_success(&temp);
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
                "--model",
                "claude-opus-4-1",
                "--json",
            ],
        ),
        0
    );
    let (view, _) = json_of(&temp, &["challenge", "--json"]);
    assert_eq!(view["challenge"]["class"], "deliverable-unchanged");
    assert_eq!(
        ungrounded(&view, "unresolved-finding"),
        "every finding recorded on the task carries a resolution or an addressed mark"
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
    assert_eq!(
        run(
            &temp,
            &["task", "close", "one", "--model", "opus", "--json"]
        ),
        2,
        "a result is not accepted while challenges stand"
    );

    write(temp.path(), "src/owed.rs", "pub fn owed() -> u8 { 1 }\n");
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "resolve",
                "one",
                "1",
                "--evidence",
                "settled in review",
                "--model",
                "claude-opus-4-1",
                "--json",
            ],
        ),
        0
    );
    assert_eq!(
        run(
            &temp,
            &[
                "task", "evidence", "one", "--exit", "0", "--tool", "cargo", "--json"
            ],
        ),
        0
    );
    assert_eq!(run(&temp, &["challenge", "one", "--json"]), 0);
    assert_eq!(run(&temp, &["task", "ready", "one", "--json"]), 0);
    confirm(&temp);
    let (standing, _) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        run(
            &temp,
            &["task", "close", "one", "--model", "opus", "--json"]
        ),
        0,
        "a reconciled hand-back is accepted; standing: {standing}"
    );

    let (view, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        ungrounded(&view, "unresolved-finding"),
        "the task is closed; a finding on it is history rather than open evidence"
    );
    assert!(view["challenge"].is_null(), "{view}");
    assert_eq!(code, 0);
}

#[test]
fn a_file_changed_outside_the_write_scope_is_challenged_and_one_inside_it_is_not() {
    let temp = project();
    assign_within(&temp, "src/thing.rs", "src/thing.rs");
    write(temp.path(), "src/thing.rs", "pub fn run() -> u8 { 1 }\n");

    record_success(&temp);
    let (view, _) = json_of(&temp, &["challenge", "--json"]);
    assert_eq!(
        ungrounded(&view, "scope-breach"),
        "every file changed since the task opened is inside its write scope"
    );

    write(temp.path(), "src/other.rs", "pub fn run() -> u8 { 2 }\n");
    let (view, code) = json_of(&temp, &["challenge", "--json"]);
    assert_eq!(view["challenge"]["class"], "attribution-unknown", "{view}");
    assert_eq!(code, 1);

    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "attribute",
                "one",
                "src/other.rs",
                "--kind",
                "task",
                "--model",
                "claude-opus-4-1",
                "--json"
            ]
        ),
        0
    );
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
    assert_eq!(code, 1);
    assert!(
        view["grounded"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "evidence-superseded")
    );
    record_success(&temp);
    assert_eq!(run(&temp, &["challenge", "one"]), 0);
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
    assert!(step.get("enforcement").is_none(), "{step}");
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

#[test]
fn opening_a_name_that_is_already_open_refuses_and_leaves_the_record_it_found() {
    let temp = project();
    assign(&temp, "src/owed.rs");
    run(
        &temp,
        &["task", "finding", "one", "left outstanding", "--json"],
    );
    let (before, _) = json_of(&temp, &["task", "show", "one", "--json"]);

    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "open",
                "one",
                "--role",
                "worker",
                "--statement",
                "a second opening",
                "--scope",
                "src",
                "--json",
            ],
        ),
        2
    );

    let (after, _) = json_of(&temp, &["task", "show", "one", "--json"]);
    assert_eq!(after["task"]["statement"], before["task"]["statement"]);
    assert_eq!(after["task"]["state"], before["task"]["state"]);
    assert_eq!(after["task"]["accepted"], before["task"]["accepted"]);
    assert_eq!(after["task"]["findings"], before["task"]["findings"]);
    assert_eq!(
        after["task"]["deliverables"],
        before["task"]["deliverables"]
    );
}

#[test]
fn a_deliverable_a_record_lost_is_owed_again_once_it_is_named() {
    let temp = project();
    assign(&temp, "src/owed.rs");
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "deliverable",
                "one",
                "--add",
                "src/thing.rs",
                "--json"
            ],
        ),
        0
    );
    let (view, _) = json_of(&temp, &["task", "show", "one", "--json"]);
    let owed: Vec<&str> = view["task"]["deliverables"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["path"].as_str().unwrap())
        .collect();
    assert_eq!(owed, ["src/owed.rs", "src/thing.rs"]);

    let (challenge, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(challenge["challenge"]["class"], "deliverable-unchanged");
    assert_eq!(code, 1, "a restored obligation is owed again");
}

#[test]
fn a_failing_declared_check_is_challenged_and_blocks_result_acceptance() {
    let temp = project();
    assign(&temp, "src/owed.rs");
    write(temp.path(), "src/owed.rs", "pub fn owed() -> u8 { 1 }\n");
    assert_eq!(
        run(
            &temp,
            &[
                "task", "evidence", "one", "--exit", "101", "--tool", "cargo", "--json"
            ],
        ),
        0
    );
    assert_eq!(run(&temp, &["task", "ready", "one", "--json"]), 2);

    let (view, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        view["challenge"]["class"], "declared-check-failed",
        "{view}"
    );
    assert_eq!(code, 1);
    assert_eq!(
        ungrounded(&view, "readiness-without-evidence"),
        "a result for the declared check is recorded against this hand-back"
    );
    assert_eq!(
        run(
            &temp,
            &["task", "close", "one", "--model", "opus", "--json"]
        ),
        2,
        "a failing check is not a reconciled hand-back"
    );

    assert_eq!(
        run(
            &temp,
            &[
                "task", "evidence", "one", "--exit", "0", "--tool", "cargo", "--json"
            ],
        ),
        0
    );
    let (view, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert!(view["challenge"].is_null(), "{view}");
    assert_eq!(code, 0);
}

#[test]
fn a_stale_exact_declaration_does_not_discard_a_standing_directory_one() {
    let temp = project();
    assign_within(&temp, "src/thing.rs", "src/thing.rs");
    write(temp.path(), "src/thing.rs", "pub fn run() -> u8 { 1 }\n");
    write(temp.path(), "src/other.rs", "pub fn run() -> u8 { 2 }\n");

    for path in ["src", "src/other.rs"] {
        assert_eq!(
            run(
                &temp,
                &[
                    "task",
                    "attribute",
                    "one",
                    path,
                    "--kind",
                    "concurrent",
                    "--model",
                    "claude-opus-4-1",
                    "--json"
                ],
            ),
            0
        );
    }
    write(temp.path(), "src/other.rs", "pub fn run() -> u8 { 3 }\n");

    let (view, _) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        ungrounded(&view, "attribution-unknown"),
        "every change since the task opened is attributable",
        "the exact declaration went stale; the directory one still stands"
    );
}

#[test]
fn opening_a_name_a_closed_record_already_used_is_refused() {
    let temp = project();
    assign(&temp, "src/owed.rs");
    write(temp.path(), "src/owed.rs", "pub fn owed() -> u8 { 1 }\n");
    run(
        &temp,
        &[
            "task", "evidence", "one", "--exit", "0", "--tool", "cargo", "--json",
        ],
    );
    assert_eq!(run(&temp, &["challenge", "one", "--json"]), 0);
    assert_eq!(run(&temp, &["task", "ready", "one", "--json"]), 0);
    assert_eq!(
        run(
            &temp,
            &["task", "close", "one", "--model", "opus", "--json"]
        ),
        0
    );

    let (before, _) = json_of(&temp, &["task", "show", "one", "--json"]);
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "open",
                "one",
                "--role",
                "worker",
                "--statement",
                "reusing a closed name",
                "--scope",
                "src",
                "--json",
            ],
        ),
        2
    );
    let (after, _) = json_of(&temp, &["task", "show", "one", "--json"]);
    assert_eq!(after["task"], before["task"]);
}

#[test]
fn the_entry_names_the_route_that_carries_each_step_and_the_lifecycle_takes_them_in_that_order() {
    let temp = project();
    let guide = stdout_of(&temp, &["guide", "loop"]);
    for route in [
        "blabla task open <name>",
        "blabla task accept <name> --model <id>",
        "blabla task evidence <name> --exit <code> --tool <tool>",
        "--tool is an evidence label, not the command to execute",
        "when <the check the assignment declares> exits 0 that is --exit 0 --tool check",
        "blabla challenge <name>",
        "blabla task ready <name>",
        "blabla task ask <name> \"<question>\" --model <id>",
        "--on <question-id>",
        "blabla task confirm <name> --model <id>",
        "blabla task close <name> --model <id>",
    ] {
        assert!(
            guide.contains(route),
            "the loop guide never names {route}:\n{guide}"
        );
    }

    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "open",
                "one",
                "--role",
                "worker",
                "--statement",
                "a bounded change",
                "--scope",
                "src",
                "--deliverable",
                "src/owed.rs",
                "--check",
                "cargo test --lib",
                "--json",
            ],
        ),
        0
    );
    let view = stdout_of(&temp, &["task", "show", "one"]);
    for route in [
        "blabla task accept one --model <id>",
        "blabla task evidence one --exit <code> --tool <tool>",
        "blabla challenge one",
        "blabla task ready one",
    ] {
        assert!(
            view.contains(route),
            "the assignment view never routes to {route}:\n{view}"
        );
    }

    write(temp.path(), "src/owed.rs", "pub fn owed() -> u8 { 1 }\n");
    let (unaccepted, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        unaccepted["challenge"]["class"], "work-without-acceptance",
        "{unaccepted}"
    );
    assert_eq!(code, 1);

    assert_eq!(
        run(
            &temp,
            &["task", "accept", "one", "--model", "qwen3.5:4b", "--json"]
        ),
        0
    );
    assert_eq!(run(&temp, &["task", "ready", "one", "--json"]), 2);
    let (unsupported, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        unsupported["challenge"]["class"], "readiness-without-evidence",
        "{unsupported}"
    );
    assert_eq!(code, 1);
    assert_eq!(
        run(
            &temp,
            &["task", "close", "one", "--model", "opus", "--json"]
        ),
        2,
        "a hand-back with no result for the declared check is not a reconciled one"
    );

    assert_eq!(
        run(
            &temp,
            &[
                "task", "evidence", "one", "--exit", "0", "--tool", "cargo", "--json"
            ],
        ),
        0
    );
    let (settled, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert!(settled["challenge"].is_null(), "{settled}");
    assert_eq!(code, 0);
    let clear = stdout_of(&temp, &["challenge", "one"]);
    assert!(
        clear.contains("blabla task ready one"),
        "a clear challenge on an accepted task never routes to the hand-back:\n{clear}"
    );
    assert_eq!(run(&temp, &["task", "ready", "one", "--json"]), 0);
    assert_eq!(
        run(
            &temp,
            &["task", "close", "one", "--model", "opus", "--json"]
        ),
        0
    );
}

#[test]
fn human_task_views_render_recorded_states_and_ready_waits_for_review() {
    let temp = project();
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "open",
                "one",
                "--role",
                "worker",
                "--statement",
                "a bounded change",
                "--scope",
                "src",
                "--deliverable",
                "src/owed.rs",
                "--check",
                "cargo test --lib",
                "--json",
            ],
        ),
        0
    );
    assert!(stdout_of(&temp, &["task", "show", "one"]).contains("task::one   OPEN"));

    assert_eq!(
        run(
            &temp,
            &["task", "accept", "one", "--model", "qwen3.5:4b", "--json"],
        ),
        0
    );
    let accepted = stdout_of(&temp, &["task", "show", "one"]);
    assert!(accepted.contains("task::one   ACCEPTED"), "{accepted}");
    assert!(
        accepted.contains("no challenge is recorded until the command runs"),
        "{accepted}"
    );

    assert_eq!(
        run(
            &temp,
            &["task", "block", "one", "waiting on review", "--json"],
        ),
        0
    );
    assert!(stdout_of(&temp, &["task", "show", "one"]).contains("task::one   BLOCKED"));

    assert_eq!(
        run(
            &temp,
            &["task", "accept", "one", "--model", "qwen3.5:4b", "--json"],
        ),
        0
    );
    write(temp.path(), "src/owed.rs", "pub fn owed() -> u8 { 1 }\n");
    assert_eq!(
        run(
            &temp,
            &[
                "task", "evidence", "one", "--exit", "0", "--tool", "cargo", "--json"
            ],
        ),
        0
    );
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "resolve",
                "one",
                "1",
                "--evidence",
                "reviewed",
                "--model",
                "claude-opus-4-1",
                "--json"
            ],
        ),
        0
    );
    assert_eq!(run(&temp, &["challenge", "one", "--json"]), 0);
    assert_eq!(run(&temp, &["task", "ready", "one", "--json"]), 0);
    let ready = stdout_of(&temp, &["task", "show", "one"]);
    assert!(ready.contains("task::one   READY"), "{ready}");
    assert!(ready.contains("await orchestrator review"), "{ready}");
    confirm(&temp);

    assert_eq!(
        run(
            &temp,
            &["task", "close", "one", "--model", "qwen3.5:4b", "--json"],
        ),
        0
    );
    assert!(stdout_of(&temp, &["task", "show", "one"]).contains("task::one   CLOSED"));
}

#[test]
fn an_open_task_with_closed_unix_set_and_unresolved_findings_grounds_the_challenge() {
    use serde_json::json;
    use std::fs;

    let temp = project();
    assign(&temp, "src/owed.rs");
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "finding",
                "one",
                "unresolved issue detected",
                "--json"
            ]
        ),
        0
    );

    let tasks_dir = temp.path().join(".blabla/tasks");
    let task_files: Vec<_> = fs::read_dir(&tasks_dir)
        .expect("tasks directory should exist")
        .filter_map(|entry| {
            entry.ok().and_then(|e| {
                let path = e.path();
                if path.extension().map(|ext| ext == "json").unwrap_or(false) {
                    Some(path)
                } else {
                    None
                }
            })
        })
        .collect();

    assert_eq!(task_files.len(), 1, "exactly one task file should exist");
    let task_path = &task_files[0];

    let task_json_str = fs::read_to_string(task_path).unwrap();
    let mut task_json: serde_json::Value = serde_json::from_str(&task_json_str).unwrap();

    task_json["state"] = json!("open");
    task_json["closed_unix"] = json!(1234567890u64);

    fs::write(task_path, serde_json::to_string_pretty(&task_json).unwrap()).unwrap();

    let (view, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        view["challenge"]["class"], "unresolved-finding",
        "open task with inconsistent state (state=open, closed_unix set) should ground on state field, not closed_unix: {view}"
    );
    assert_eq!(code, 1);
    assert!(
        !view["ungrounded"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .any(|entry| entry[0] == "unresolved-finding"),
        "unresolved-finding should not appear in ungrounded: {view}"
    );
}

#[test]
fn a_lens_assessment_names_the_pack_the_role_consults_and_a_ruling_identity_does_not_clear_it() {
    let temp = project_whose_role_consults_a_pack();
    assign(&temp, "src/owed.rs");
    write(temp.path(), "src/owed.rs", "pub fn owed() -> u8 { 1 }\n");
    assert_eq!(
        run(
            &temp,
            &[
                "task", "evidence", "one", "--exit", "0", "--tool", "cargo", "--json"
            ],
        ),
        0
    );
    assert_eq!(run(&temp, &["task", "ready", "one", "--json"]), 2);

    let (unassessed, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        unassessed["challenge"]["class"], "lens-unassessed",
        "{unassessed}"
    );
    assert_eq!(code, 1);

    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "lens",
                "one",
                "ruling::engineering::smallest-correct-change",
                "held against it",
                "--json",
            ],
        ),
        0
    );
    let (identity, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        identity["challenge"]["class"], "lens-unassessed",
        "a ruling identity is not the lens the role consults: {identity}"
    );
    assert_eq!(code, 1);

    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "lens",
                "one",
                "engineering",
                "held against it",
                "--json",
            ],
        ),
        0
    );
    let (assessed, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert!(assessed["challenge"].is_null(), "{assessed}");
    assert_eq!(code, 0);
}

#[test]
fn a_task_opened_with_no_check_can_be_given_one_and_then_reach_a_closed_record() {
    let temp = project();
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "open",
                "one",
                "--role",
                "worker",
                "--statement",
                "a bounded change",
                "--scope",
                "src",
                "--deliverable",
                "src/owed.rs",
                "--json",
            ],
        ),
        0
    );
    assert_eq!(
        run(
            &temp,
            &["task", "accept", "one", "--model", "qwen3.5:4b", "--json"]
        ),
        0
    );
    write(temp.path(), "src/owed.rs", "pub fn owed() -> u8 { 1 }\n");
    assert_eq!(
        run(
            &temp,
            &[
                "task", "evidence", "one", "--exit", "0", "--tool", "cargo", "--json"
            ],
        ),
        2,
        "a result cannot be bound to a check the record does not declare"
    );
    assert_eq!(run(&temp, &["task", "ready", "one", "--json"]), 2);
    let (unsupported, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        unsupported["challenge"]["class"], "readiness-without-evidence",
        "{unsupported}"
    );
    assert_eq!(code, 1);

    assert_eq!(
        run(
            &temp,
            &["task", "check", "one", "cargo test --lib", "--json"]
        ),
        0
    );
    assert_eq!(
        run(
            &temp,
            &[
                "task", "evidence", "one", "--exit", "0", "--tool", "cargo", "--json"
            ],
        ),
        0
    );
    let (settled, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        settled["grounded"],
        serde_json::json!(["orchestrator-record-during-carry"]),
        "{settled}"
    );
    assert_eq!(settled["assignment_clear"], true, "{settled}");
    assert_eq!(code, 0);
    assert_eq!(run(&temp, &["task", "ready", "one", "--json"]), 0);
    confirm(&temp);
    assert_eq!(
        run(
            &temp,
            &["task", "close", "one", "--model", "opus", "--json"]
        ),
        0
    );
}

#[test]
fn a_closed_record_refuses_a_declared_check() {
    let temp = project();
    assign(&temp, "src/owed.rs");
    write(temp.path(), "src/owed.rs", "pub fn owed() -> u8 { 1 }\n");
    assert_eq!(
        run(
            &temp,
            &[
                "task", "evidence", "one", "--exit", "0", "--tool", "cargo", "--json"
            ],
        ),
        0
    );
    assert_eq!(run(&temp, &["challenge", "one", "--json"]), 0);
    assert_eq!(run(&temp, &["task", "ready", "one", "--json"]), 0);
    assert_eq!(
        run(
            &temp,
            &["task", "close", "one", "--model", "opus", "--json"]
        ),
        0
    );
    assert_eq!(
        run(
            &temp,
            &["task", "check", "one", "cargo test --doc", "--json"]
        ),
        2,
        "a closed record is history rather than open evidence"
    );
}

#[test]
fn a_directory_deliverable_is_the_files_under_it_and_a_later_add_picks_up_new_ones() {
    let temp = project();
    assign(&temp, "src");
    let opened = stdout_of(&temp, &["task", "show", "one"]);
    for path in ["src/thing.rs", "src/other.rs", "src/owed.rs"] {
        assert!(
            opened.contains(path),
            "a directory deliverable must owe the files under it; {path} is missing:\n{opened}"
        );
    }

    let (unchanged, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        unchanged["challenge"]["class"], "deliverable-unchanged",
        "{unchanged}"
    );
    assert_eq!(code, 1);

    write(temp.path(), "src/thing.rs", "pub fn run() -> u8 { 1 }\n");
    write(temp.path(), "src/other.rs", "pub fn run() -> u8 { 2 }\n");
    write(temp.path(), "src/owed.rs", "pub fn owed() -> u8 { 3 }\n");
    record_success(&temp);
    let (produced, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert!(produced["challenge"].is_null(), "{produced}");
    assert_eq!(code, 0);

    write(temp.path(), "src/added.rs", "pub fn added() {}\n");
    assert_eq!(
        run(
            &temp,
            &["task", "deliverable", "one", "--add", "src", "--json"]
        ),
        0
    );
    let show_after_add = stdout_of(&temp, &["task", "show", "one"]);
    assert!(
        show_after_add.contains("src/added.rs"),
        "adding the directory again must owe the file that appeared in it: {show_after_add}"
    );
    let (again, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        again["challenge"]["class"], "evidence-superseded",
        "the owed file is a new check input: {again}"
    );
    assert_eq!(code, 1);
    record_success(&temp);
    let (after_record, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        after_record["grounded"],
        serde_json::json!(["orchestrator-record-during-carry"]),
        "the orchestrator's deliverable --add is all that stands: {after_record}"
    );
    assert_eq!(after_record["assignment_clear"], true, "{after_record}");
    assert_eq!(code, 0);
}

#[test]
fn a_path_inside_another_open_tasks_scope_is_not_grounded_as_attribution_unknown() {
    let temp = project();
    assign_within(&temp, "src/thing.rs", "src/thing.rs");
    write(temp.path(), "src/thing.rs", "pub fn run() -> u8 { 1 }\n");
    record_success(&temp);
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "open",
                "two",
                "--role",
                "worker",
                "--statement",
                "second task",
                "--scope",
                "src/other.rs",
                "--deliverable",
                "src/other.rs",
                "--check",
                "cargo test --lib",
                "--json"
            ],
        ),
        0
    );
    assert_eq!(
        run(
            &temp,
            &["task", "accept", "two", "--model", "qwen3.5:4b", "--json"]
        ),
        0
    );
    write(temp.path(), "src/other.rs", "pub fn run() -> u8 { 2 }\n");
    let (report, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert!(
        report["challenge"].is_null(),
        "src/other.rs is in task two's scope, so it should not ground attribution-unknown: {report}"
    );
    assert_eq!(code, 0);
}

#[test]
fn a_path_outside_all_open_tasks_scopes_is_grounded_as_attribution_unknown() {
    let temp = project();
    assign_within(&temp, "src/thing.rs", "src/thing.rs");
    write(temp.path(), "src/thing.rs", "pub fn run() -> u8 { 1 }\n");
    record_success(&temp);
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "open",
                "two",
                "--role",
                "worker",
                "--statement",
                "second task",
                "--scope",
                "src/other.rs",
                "--deliverable",
                "src/other.rs",
                "--check",
                "cargo test --lib",
                "--json"
            ],
        ),
        0
    );
    assert_eq!(
        run(
            &temp,
            &["task", "accept", "two", "--model", "qwen3.5:4b", "--json"]
        ),
        0
    );
    write(temp.path(), "src/owed.rs", "pub fn owed() -> u8 { 3 }\n");
    let (report, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        report["challenge"]["class"], "attribution-unknown",
        "src/owed.rs is not in any task's scope, so it should ground attribution-unknown: {report}"
    );
    assert_eq!(code, 1);
}

#[test]
fn attribution_unknown_counts_every_undeclared_path_in_its_evidence() {
    let temp = project();
    assign_within(&temp, "src/thing.rs", "src/thing.rs");
    write(temp.path(), "src/thing.rs", "pub fn run() -> u8 { 1 }\n");
    record_success(&temp);
    write(temp.path(), "src/owed.rs", "pub fn owed() -> u8 { 3 }\n");
    write(temp.path(), "src/owed2.rs", "pub fn owed2() -> u8 { 4 }\n");
    let (report, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(code, 1);
    assert_eq!(report["challenge"]["class"], "attribution-unknown");
    let evidence = report["challenge"]["evidence"].as_array().unwrap();
    let counted = evidence
        .iter()
        .filter_map(|line| line.as_str())
        .find(|line| line.starts_with("2 changed paths carry no declaration"))
        .expect("the evidence names how many paths are undeclared");
    assert!(counted.contains("src/owed.rs") && counted.contains("src/owed2.rs"));
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "attribute",
                "one",
                "src/owed.rs",
                "src/owed2.rs",
                "--kind",
                "concurrent",
                "--model",
                "claude-opus-4-1",
                "--json"
            ],
        ),
        0
    );
    let (report, _) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_ne!(report["challenge"]["class"], "attribution-unknown");
}

#[test]
fn a_path_inside_a_closed_tasks_scope_is_grounded_as_attribution_unknown() {
    let temp = project();
    assign_within(&temp, "src/thing.rs", "src/thing.rs");
    write(temp.path(), "src/thing.rs", "pub fn run() -> u8 { 1 }\n");
    record_success(&temp);
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "open",
                "two",
                "--role",
                "worker",
                "--statement",
                "second task",
                "--scope",
                "src/other.rs",
                "--deliverable",
                "src/other.rs",
                "--check",
                "cargo test --lib",
                "--json"
            ],
        ),
        0
    );
    assert_eq!(
        run(
            &temp,
            &["task", "accept", "two", "--model", "qwen3.5:4b", "--json"]
        ),
        0
    );
    write(temp.path(), "src/other.rs", "pub fn run() -> u8 { 2 }\n");
    assert_eq!(
        run(
            &temp,
            &[
                "task", "evidence", "two", "--exit", "0", "--tool", "cargo", "--json"
            ]
        ),
        0
    );
    assert_eq!(run(&temp, &["challenge", "two", "--json"]), 0);
    assert_eq!(run(&temp, &["task", "ready", "two", "--json"]), 0);
    assert_eq!(
        run(
            &temp,
            &["task", "close", "two", "--model", "opus", "--json"]
        ),
        0
    );
    let (report, code) = json_of(&temp, &["challenge", "one", "--json"]);
    assert_eq!(
        report["challenge"]["class"], "attribution-unknown",
        "src/other.rs is in a closed task's scope, so it should ground attribution-unknown: {report}"
    );
    assert_eq!(code, 1);
}
