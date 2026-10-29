use crate::support::task_project::{code, ok};
use crate::support::write;
use blabla::project::task;
use serde_json::{Value, json};
use tempfile::TempDir;

pub(crate) const WORKER_MODEL: &str = "worker";
pub(crate) const LENSED_MODEL: &str = "lensed";
pub(crate) const ORCHESTRATOR_MODEL: &str = "owner";

pub(crate) fn fixture() -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "project.bla",
        "project Claims\nuse structure \"entry.bla\"\nprocess \"process.bla\"\nknowledge \"knowledge.bla\"\ngoal \"goals.bla\"\nsystem \"system.bla\"\n",
    );
    write(
        root,
        "entry.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(
        root,
        "process.bla",
        "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\nrole \"lensed\" { purpose \"Implement under a lens\" model \"lensed\" consult [\"testing\"] }\n",
    );
    write(
        root,
        "knowledge.bla",
        "knowledge \"testing\" { purpose \"Inspect actual evidence\" }\nruling \"actual\" { pack \"testing\" statement \"Read the observed result\" }\n",
    );
    write(
        root,
        "goals.bla",
        "goal \"deliver\" { statement \"Deliver the entry\" expect [\"contract::entry\"] state \"active\" }\n",
    );
    write(
        root,
        "system.bla",
        "system \"app\" { purpose \"Own the entry\" paths [\"src/\"] }\nsystem \"other\" { purpose \"Unrelated work\" paths [\"other/\"] }\n",
    );
    write(root, "src/app.rs", "pub fn run() {}\n");
    write(root, "other/extra.rs", "pub fn extra() {}\n");
    temp
}

pub(crate) fn open_task(temp: &TempDir, role: &str, goal: bool, extra: &[&str]) {
    let mut arguments = vec![
        "task",
        "open",
        "work",
        "--role",
        role,
        "--statement",
        "claim the outcome",
        "--scope",
        "src/app.rs",
    ];
    if goal {
        arguments.extend(["--goal", "deliver"]);
    }
    arguments.extend(extra);
    arguments.extend(["--check", "true"]);
    ok(temp, &arguments);
}

pub(crate) fn prepared(temp: &TempDir, model: &str) {
    ok(temp, &["task", "accept", "work", "--model", model]);
    write(temp.path(), "src/app.rs", "pub fn run() { let _ = 1; }\n");
    ok(
        temp,
        &["task", "evidence", "work", "--exit", "0", "--tool", "check"],
    );
    code(temp, &["challenge", "work"]);
}

pub(crate) fn record_bytes(temp: &TempDir) -> Vec<u8> {
    std::fs::read(task::path_of(temp.path(), "work")).unwrap()
}

pub(crate) fn record(temp: &TempDir) -> Value {
    serde_json::from_slice(&record_bytes(temp)).unwrap()
}

fn goal_task() -> TempDir {
    let temp = fixture();
    open_task(&temp, "worker", true, &[]);
    prepared(&temp, WORKER_MODEL);
    temp
}

fn ready_with(temp: &TempDir, extra: &[&str]) -> i32 {
    let mut arguments = vec!["task", "ready", "work"];
    arguments.extend(extra);
    code(temp, &arguments)
}

fn refused_leaves_record(temp: &TempDir, extra: &[&str]) {
    let before = record_bytes(temp);
    assert_eq!(ready_with(temp, extra), 2, "{extra:?}");
    assert_eq!(record_bytes(temp), before, "{extra:?}");
    assert_eq!(record(temp)["state"], "accepted", "{extra:?}");
}

const FULL_CLAIMS: [&str; 6] = [
    "--outcome",
    "delivered",
    "--claim",
    "system::app=updated",
    "--claim",
    "goal::deliver=unchanged",
];

pub(crate) fn close_work(temp: &TempDir) -> i32 {
    code(
        temp,
        &["task", "close", "work", "--model", ORCHESTRATOR_MODEL],
    )
}

fn resolve_work(temp: &TempDir, evidence: &str) -> i32 {
    code(
        temp,
        &[
            "task",
            "resolve",
            "work",
            "1",
            "--evidence",
            evidence,
            "--model",
            ORCHESTRATOR_MODEL,
        ],
    )
}

#[test]
fn a_goal_task_is_refused_without_an_outcome() {
    refused_leaves_record(&goal_task(), &[]);
}

#[test]
fn an_outcome_without_a_goal_is_refused() {
    let temp = fixture();
    open_task(&temp, "worker", false, &[]);
    prepared(&temp, WORKER_MODEL);
    refused_leaves_record(&temp, &["--outcome", "delivered"]);
}

#[test]
fn an_unknown_outcome_is_refused() {
    refused_leaves_record(&goal_task(), &["--outcome", "finished"]);
}

#[test]
fn a_task_without_a_goal_hands_back_without_an_outcome() {
    let temp = fixture();
    open_task(&temp, "worker", false, &[]);
    prepared(&temp, WORKER_MODEL);
    assert_eq!(ready_with(&temp, &[]), 0);
    let record = record(&temp);
    assert_eq!(record["state"], "ready");
    assert_eq!(record["outcome"], Value::Null);
}

#[test]
fn a_delivered_or_not_applicable_outcome_adds_no_residual() {
    for word in ["delivered", "not-applicable"] {
        let temp = goal_task();
        assert_eq!(ready_with(&temp, &["--outcome", word]), 0, "{word}");
        let record = record(&temp);
        assert_eq!(record["state"], "ready", "{word}");
        assert_eq!(record["outcome"], word);
        assert_eq!(record["findings"].as_array().unwrap().len(), 0, "{word}");
    }
}

#[test]
fn a_partial_or_blocked_outcome_adds_one_residual_that_survives_close_without_blocking_it() {
    for word in ["partial", "blocked"] {
        let temp = goal_task();
        assert_eq!(ready_with(&temp, &["--outcome", word]), 0, "{word}");
        let handed = record(&temp);
        assert_eq!(handed["outcome"], word);
        let findings = handed["findings"].as_array().unwrap();
        assert_eq!(findings.len(), 1, "{word}");
        assert_eq!(findings[0]["residual"], true, "{word}");
        let read = task::read(temp.path(), "work").unwrap().unwrap();
        assert_eq!(read.blocking().count(), 0, "{word}");
        assert_eq!(read.unresolved().count(), 1, "{word}");
        assert_eq!(
            code(
                &temp,
                &["task", "close", "work", "--model", ORCHESTRATOR_MODEL]
            ),
            0,
            "{word}"
        );
        let closed = task::read(temp.path(), "work").unwrap().unwrap();
        assert_eq!(closed.state.word(), "closed", "{word}");
        assert_eq!(closed.unresolved().count(), 1, "{word}");
        assert_eq!(closed.blocking().count(), 0, "{word}");
    }
}

fn intent_task() -> TempDir {
    let temp = fixture();
    open_task(&temp, "worker", true, &["--intent"]);
    prepared(&temp, WORKER_MODEL);
    temp
}

#[test]
fn only_an_intent_task_records_that_it_asks_for_claims() {
    let asking = fixture();
    open_task(&asking, "worker", true, &["--intent"]);
    assert_eq!(record(&asking)["asks_intent"], true);
    let plain = fixture();
    open_task(&plain, "worker", true, &[]);
    assert_eq!(record(&plain)["asks_intent"], Value::Null);
}

#[test]
fn an_intent_task_is_refused_without_its_claims() {
    refused_leaves_record(&intent_task(), &["--outcome", "delivered"]);
}

#[test]
fn an_intent_task_records_one_claim_per_affected_intent_with_its_readiness() {
    let temp = intent_task();
    let exit = ready_with(&temp, &FULL_CLAIMS);
    assert_eq!(exit, 0);
    let record = record(&temp);
    assert_eq!(record["state"], "ready");
    assert_eq!(
        record["intent_claims"],
        json!([
            {"intent": "system::app", "claim": "updated"},
            {"intent": "goal::deliver", "claim": "unchanged"}
        ])
    );
}

#[test]
fn a_missing_unaffected_duplicate_or_malformed_claim_is_refused() {
    let cases: [&[&str]; 4] = [
        &["--claim", "goal::deliver=updated"],
        &[
            "--claim",
            "system::app=updated",
            "--claim",
            "goal::deliver=updated",
            "--claim",
            "system::other=unchanged",
        ],
        &[
            "--claim",
            "system::app=updated",
            "--claim",
            "system::app=unchanged",
            "--claim",
            "goal::deliver=updated",
        ],
        &[
            "--claim",
            "system::app=maybe",
            "--claim",
            "goal::deliver=updated",
        ],
    ];
    for claims in cases {
        let temp = intent_task();
        let mut extra = vec!["--outcome", "delivered"];
        extra.extend(claims);
        refused_leaves_record(&temp, &extra);
    }
}

#[test]
fn a_task_opened_without_the_flag_asks_no_claims_and_refuses_any() {
    let temp = goal_task();
    refused_leaves_record(
        &temp,
        &["--outcome", "delivered", "--claim", "goal::deliver=updated"],
    );
    assert_eq!(ready_with(&temp, &["--outcome", "delivered"]), 0);
    assert_eq!(record(&temp)["intent_claims"], Value::Null);
}

#[test]
fn an_intent_task_that_touches_no_intent_hands_back_without_claims() {
    let temp = fixture();
    write(temp.path(), "docs/notes.md", "first\n");
    ok(
        &temp,
        &[
            "task",
            "open",
            "work",
            "--role",
            "worker",
            "--statement",
            "change a file no system owns",
            "--scope",
            "docs/notes.md",
            "--intent",
            "--check",
            "true",
        ],
    );
    ok(&temp, &["task", "accept", "work", "--model", WORKER_MODEL]);
    write(temp.path(), "docs/notes.md", "second\n");
    ok(
        &temp,
        &["task", "evidence", "work", "--exit", "0", "--tool", "check"],
    );
    code(&temp, &["challenge", "work"]);
    assert_eq!(ready_with(&temp, &[]), 0);
    let task = record(&temp);
    assert_eq!(task["state"], "ready");
    assert_eq!(task["asks_intent"], true);
}

fn lensed_task() -> TempDir {
    let temp = fixture();
    open_task(&temp, "lensed", true, &[]);
    prepared(&temp, LENSED_MODEL);
    temp
}

#[test]
fn ready_records_its_lens_assessments_and_notes_with_the_readiness() {
    let temp = lensed_task();
    let exit = ready_with(
        &temp,
        &[
            "--outcome",
            "delivered",
            "--lens",
            "testing",
            "read the observed result",
            "--note",
            "first note",
            "--note",
            "second note",
        ],
    );
    assert_eq!(exit, 0);
    let record = record(&temp);
    assert_eq!(record["state"], "ready");
    let assessments = record["assessments"].as_array().unwrap();
    assert_eq!(assessments.len(), 1);
    assert_eq!(assessments[0]["ruling"], "testing");
    assert_eq!(assessments[0]["model"], LENSED_MODEL);
    assert_eq!(record["notes"].as_array().unwrap().len(), 2);
}

#[test]
fn a_refused_ready_records_no_assessment_and_no_note() {
    let cases: [&[&str]; 2] = [
        &[
            "--lens",
            "testing",
            "read the observed result",
            "--note",
            "a note",
        ],
        &[
            "--outcome",
            "delivered",
            "--lens",
            "absent",
            "read the observed result",
            "--note",
            "a note",
        ],
    ];
    for extra in cases {
        let temp = lensed_task();
        refused_leaves_record(&temp, extra);
        let record = record(&temp);
        assert_eq!(record["assessments"].as_array().unwrap().len(), 0);
        assert_eq!(record["notes"].as_array().unwrap().len(), 0);
    }
}

#[test]
fn accepting_a_handed_back_task_clears_its_recorded_claims() {
    let temp = intent_task();
    assert_eq!(ready_with(&temp, &FULL_CLAIMS), 0);
    assert_eq!(
        code(&temp, &["task", "accept", "work", "--model", WORKER_MODEL]),
        0
    );
    let resumed = record(&temp);
    assert_eq!(resumed["state"], "accepted");
    assert_eq!(resumed["outcome"], Value::Null);
    assert!(resumed.get("intent_claims").is_none(), "{resumed}");
}

#[test]
fn ready_records_its_own_challenge_when_none_was_run() {
    let temp = fixture();
    open_task(&temp, "worker", false, &[]);
    ok(&temp, &["task", "accept", "work", "--model", WORKER_MODEL]);
    write(temp.path(), "src/app.rs", "pub fn run() { let _ = 1; }\n");
    ok(
        &temp,
        &["task", "evidence", "work", "--exit", "0", "--tool", "check"],
    );
    assert_eq!(ready_with(&temp, &[]), 0);
    let ready = record(&temp);
    assert_eq!(ready["state"], "ready");
    assert!(ready["challenged"].is_object(), "{ready}");
}

#[test]
fn a_residual_finding_on_a_closed_task_can_be_resolved() {
    let temp = goal_task();
    assert_eq!(ready_with(&temp, &["--outcome", "partial"]), 0);
    assert_eq!(close_work(&temp), 0);
    assert_eq!(
        resolve_work(&temp, "the remainder was delivered elsewhere"),
        0
    );
    let closed = task::read(temp.path(), "work").unwrap().unwrap();
    assert_eq!(closed.state.word(), "closed");
    assert_eq!(closed.unresolved().count(), 0);
}

#[test]
fn a_finding_that_is_not_residual_cannot_be_resolved_once_the_task_is_closed() {
    let temp = goal_task();
    ok(&temp, &["task", "finding", "work", "an open concern"]);
    assert_eq!(
        code(
            &temp,
            &[
                "task",
                "addressed",
                "work",
                "1",
                "handled",
                "--model",
                WORKER_MODEL
            ]
        ),
        0
    );
    assert_eq!(resolve_work(&temp, "settled"), 0);
    assert_eq!(ready_with(&temp, &["--outcome", "delivered"]), 0);
    ok(
        &temp,
        &["task", "confirm", "work", "--model", ORCHESTRATOR_MODEL],
    );
    assert_eq!(close_work(&temp), 0);
    let before = record_bytes(&temp);
    assert_eq!(resolve_work(&temp, "settled again"), 2);
    assert_eq!(record_bytes(&temp), before);
}
