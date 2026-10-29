use crate::support::task_project::{
    accepted, change_the_deliverable, code, json, ok, opened, project, set_record_field, text,
};
use crate::support::write;
use crate::task_claims::{ORCHESTRATOR_MODEL, WORKER_MODEL, fixture};
use blabla::project::task;
use blabla::project::task::machine;
use serde_json::Value;
use tempfile::TempDir;

const PROCESS: &str = r#"
role "orchestrator" {
    purpose "divide the work"
    model ["opus"]
}

role "worker" {
    purpose "carry out one bounded task"
    model ["small"]
}

flow "development" {
    purpose "one bounded change"
}

step "assign" {
    flow "development"
    role ["orchestrator"]
    statement "record the bounded task before the work starts"
}
"#;

const STATES: [&str; 6] = [
    "open",
    "accepted",
    "blocked",
    "ready",
    "closed",
    "withdrawn",
];

fn in_state(state: &str) -> TempDir {
    let temp = project(PROCESS);
    opened(&temp);
    set_record_field(&temp, "work", "state", Value::from(state));
    temp
}

fn record(temp: &TempDir) -> Vec<u8> {
    std::fs::read(task::path_of(temp.path(), "work")).unwrap()
}

#[test]
fn each_state_offers_the_routes_its_table_names() {
    let expected: [(&str, &[&str]); 6] = [
        (
            "open",
            &[
                "accept",
                "check",
                "note",
                "finding",
                "addressed",
                "decide",
                "challenge",
            ],
        ),
        (
            "accepted",
            &[
                "accept",
                "check",
                "blocker",
                "note",
                "finding",
                "addressed",
                "decide",
                "lens",
                "challenge",
                "hand-back",
            ],
        ),
        (
            "blocked",
            &[
                "accept",
                "check",
                "note",
                "finding",
                "addressed",
                "decide",
                "challenge",
            ],
        ),
        ("ready", &["accept", "check", "finding", "challenge"]),
        ("closed", &["check"]),
        ("withdrawn", &["check"]),
    ];
    for (state, routes) in expected {
        let temp = in_state(state);
        let view = json(&temp, &["task", "show", "work"]);
        assert_eq!(view["routes"], Value::from(routes.to_vec()), "{state}");
    }
}

#[test]
fn a_command_moves_only_where_the_table_allows_and_a_refused_one_changes_no_record() {
    let commands: [(&str, &[&str]); 5] = [
        ("accept", &["task", "accept", "work", "--model", "small"]),
        (
            "block",
            &["task", "block", "work", "waiting on the orchestrator"],
        ),
        ("ready", &["task", "ready", "work"]),
        ("close", &["task", "close", "work", "--model", "opus"]),
        (
            "withdraw",
            &[
                "task", "withdraw", "work", "--reason", "replaced", "--model", "opus",
            ],
        ),
    ];
    let live = ["open", "accepted", "blocked", "ready"];
    let moves: Vec<(&str, &str, &str)> = live
        .iter()
        .map(|from| ("accept", *from, "accepted"))
        .chain([("block", "accepted", "blocked")])
        .chain(live.iter().map(|from| ("withdraw", *from, "withdrawn")))
        .collect();
    for state in STATES {
        for (command, argv) in commands {
            let temp = in_state(state);
            let before = record(&temp);
            let exit = code(&temp, argv);
            let after: Value = serde_json::from_slice(&record(&temp)).unwrap();
            match moves
                .iter()
                .find(|(moved, from, _)| *moved == command && *from == state)
            {
                Some((_, _, to)) => {
                    assert_eq!(exit, 0, "{command} from {state}");
                    assert_eq!(after["state"], *to, "{command} from {state}");
                }
                None => {
                    assert_ne!(exit, 0, "{command} from {state}");
                    assert_eq!(record(&temp), before, "{command} from {state}");
                }
            }
        }
    }
}

fn scope_of(temp: &TempDir) -> Value {
    serde_json::from_slice::<Value>(&record(temp)).unwrap()["scope"].clone()
}

#[test]
fn an_unchanged_path_leaves_the_scope_as_an_orchestrator_record() {
    let temp = in_state("accepted");
    ok(
        &temp,
        &["task", "scope", "work", "--add", "docs", "--model", "opus"],
    );
    assert_eq!(scope_of(&temp), Value::from(vec!["src", "docs"]));
    assert_eq!(
        code(
            &temp,
            &[
                "task", "scope", "work", "--remove", "docs", "--model", "opus"
            ]
        ),
        0
    );
    let after: Value = serde_json::from_slice(&record(&temp)).unwrap();
    assert_eq!(after["scope"], Value::from(vec!["src"]));
    let records = after["orchestrator_records"].as_array().unwrap();
    assert_eq!(records.last().unwrap()["verb"], "scope --remove");
    assert_eq!(records.last().unwrap()["model"], "opus");
}

#[test]
fn a_changed_path_stays_in_the_scope_and_the_refusal_changes_no_record() {
    let temp = in_state("accepted");
    change_the_deliverable(&temp);
    let before = record(&temp);
    assert_eq!(
        code(
            &temp,
            &[
                "task", "scope", "work", "--remove", "src", "--model", "opus"
            ]
        ),
        2
    );
    assert_eq!(record(&temp), before);
}

#[test]
fn a_changed_path_in_a_mixed_case_directory_stays_in_the_scope() {
    let temp = project(PROCESS);
    write(temp.path(), "Lib/Code.rs", "pub fn run() -> u8 { 0 }\n");
    ok(
        &temp,
        &[
            "task",
            "open",
            "cased",
            "--role",
            "worker",
            "--statement",
            "change a file in a mixed-case directory",
            "--scope",
            "Lib",
            "--check",
            "true",
        ],
    );
    write(temp.path(), "Lib/Code.rs", "pub fn run() -> u8 { 1 }\n");
    let path = task::path_of(temp.path(), "cased");
    let before = std::fs::read(&path).unwrap();
    assert_eq!(
        code(
            &temp,
            &[
                "task", "scope", "cased", "--remove", "Lib", "--model", "opus"
            ]
        ),
        2
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn a_path_outside_the_scope_cannot_be_released() {
    let temp = in_state("accepted");
    let before = record(&temp);
    assert_eq!(
        code(
            &temp,
            &[
                "task", "scope", "work", "--remove", "docs", "--model", "opus"
            ]
        ),
        2
    );
    assert_eq!(record(&temp), before);
}

fn release_from_scope(temp: &TempDir, path: &str) -> i32 {
    code(
        temp,
        &["task", "scope", "work", "--remove", path, "--model", "opus"],
    )
}

#[test]
fn a_path_that_is_or_covers_a_declared_deliverable_cannot_be_released() {
    for path in ["src", "src/thing.rs"] {
        let temp = in_state("accepted");
        let before = record(&temp);
        assert_eq!(release_from_scope(&temp, path), 2, "{path}");
        assert_eq!(record(&temp), before, "{path}");
    }
}

#[test]
fn a_record_with_a_field_this_version_does_not_write_is_refused_as_older() {
    let cases = [
        ("unrecognised", Value::from(true)),
        (
            "notes",
            serde_json::json!([{"statement": "kept", "unix": 1, "unrecognised": true}]),
        ),
    ];
    for (field, value) in cases {
        let temp = in_state("accepted");
        set_record_field(&temp, "work", field, value);
        let shown = json(&temp, &["task", "show", "work"]);
        assert_eq!(shown["status"], "error", "{field}");
        assert_eq!(shown["category"], "task", "{field}");
    }
}

#[test]
fn a_scope_amendment_adds_or_removes_never_both_and_never_neither() {
    let temp = in_state("accepted");
    let before = record(&temp);
    for arguments in [
        &[
            "task", "scope", "work", "--add", "docs", "--remove", "src", "--model", "opus",
        ][..],
        &["task", "scope", "work", "--model", "opus"][..],
    ] {
        assert_ne!(code(&temp, arguments), 0, "{arguments:?}");
        assert_eq!(record(&temp), before, "{arguments:?}");
    }
}

fn withdrawn_with_a_closed_successor() -> TempDir {
    let temp = fixture();
    ok(
        &temp,
        &[
            "task",
            "open",
            "old",
            "--role",
            "worker",
            "--statement",
            "first",
            "--scope",
            "src",
            "--check",
            "true",
        ],
    );
    ok(&temp, &["task", "accept", "old", "--model", WORKER_MODEL]);
    write(temp.path(), "src/app.rs", "pub fn run() { let _ = 2; }\n");
    write(temp.path(), "src/extra.rs", "pub fn extra() {}\n");
    ok(
        &temp,
        &[
            "task",
            "withdraw",
            "old",
            "--reason",
            "replaced",
            "--model",
            ORCHESTRATOR_MODEL,
        ],
    );
    ok(
        &temp,
        &[
            "task",
            "open",
            "next",
            "--role",
            "worker",
            "--statement",
            "second",
            "--scope",
            "src",
            "--input",
            "src",
            "--check",
            "true",
        ],
    );
    ok(&temp, &["task", "accept", "next", "--model", WORKER_MODEL]);
    ok(
        &temp,
        &["task", "evidence", "next", "--exit", "0", "--tool", "check"],
    );
    ok(&temp, &["challenge", "next"]);
    ok(&temp, &["task", "ready", "next"]);
    ok(
        &temp,
        &["task", "close", "next", "--model", ORCHESTRATOR_MODEL],
    );
    temp
}

fn old_record(temp: &TempDir) -> Vec<u8> {
    std::fs::read(task::path_of(temp.path(), "old")).unwrap()
}

#[test]
fn several_paths_are_reconciled_in_one_call() {
    let temp = withdrawn_with_a_closed_successor();
    ok(
        &temp,
        &[
            "task",
            "reconcile-withdrawal",
            "old",
            "src/app.rs",
            "src/extra.rs",
            "--successor",
            "next",
            "--model",
            ORCHESTRATOR_MODEL,
        ],
    );
    let record: Value = serde_json::from_slice(&old_record(&temp)).unwrap();
    let paths: Vec<&str> = record["withdrawal"]["reconciliations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths, vec!["src/app.rs", "src/extra.rs"]);
}

#[test]
fn one_path_that_cannot_be_reconciled_records_nothing() {
    let temp = withdrawn_with_a_closed_successor();
    let before = old_record(&temp);
    assert_eq!(
        code(
            &temp,
            &[
                "task",
                "reconcile-withdrawal",
                "old",
                "src/app.rs",
                "other/extra.rs",
                "--successor",
                "next",
                "--model",
                ORCHESTRATOR_MODEL,
            ]
        ),
        2
    );
    assert_eq!(old_record(&temp), before);
}

#[test]
fn a_record_keeps_its_state_word_through_a_read_and_a_write() {
    for state in STATES {
        let temp = in_state(state);
        let read = task::read(temp.path(), "work").unwrap().unwrap();
        task::write(temp.path(), &read).unwrap();
        let written: Value = serde_json::from_slice(&record(&temp)).unwrap();
        assert_eq!(written["state"], state);
    }
}

#[test]
fn a_task_view_carries_no_authority_paragraph_and_less_unless_verbose() {
    let temp = project(PROCESS);
    opened(&temp);
    let plain = text(&temp, &["task", "show", "work"]);
    let verbose = text(&temp, &["task", "show", "work", "--verbose"]);
    assert!(!plain.contains(task::AUTHORITY));
    assert!(!verbose.contains(task::AUTHORITY));
    assert!(plain.lines().count() < verbose.lines().count());
}

#[test]
fn the_task_json_holds_run_internals_only_when_verbose() {
    let temp = project(PROCESS);
    opened(&temp);
    let plain = json(&temp, &["task", "show", "work"]);
    let verbose = json(&temp, &["task", "show", "work", "--verbose"]);
    assert!(plain.get("evidence_progress").is_none());
    assert!(verbose.get("evidence_progress").is_some());
}

#[test]
fn status_lists_live_tasks_and_counts_the_rest_unless_verbose() {
    let temp = project(PROCESS);
    opened(&temp);
    ok(
        &temp,
        &[
            "task", "withdraw", "work", "--reason", "replaced", "--model", "opus",
        ],
    );
    ok(
        &temp,
        &[
            "task",
            "open",
            "next",
            "--role",
            "worker",
            "--statement",
            "second",
            "--scope",
            "src",
            "--check",
            "true",
        ],
    );
    let plain = text(&temp, &["status"]);
    let verbose = text(&temp, &["status", "--verbose"]);
    assert!(plain.contains("task::next"));
    assert!(!plain.contains("task::work"));
    assert!(verbose.contains("task::next"));
    assert!(verbose.contains("task::work"));
}

#[test]
fn a_refused_hand_back_names_the_guard_that_refused_it() {
    let temp = project(PROCESS);
    accepted(&temp);
    let refusal = json(&temp, &["task", "ready", "work"]);
    assert_eq!(refusal["status"], "error");
    assert!(
        refusal["message"]
            .as_str()
            .unwrap()
            .contains(machine::Guard::EvidenceSupported.code())
    );
}
