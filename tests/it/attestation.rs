use crate::support;
use serde_json::Value;
use support::task_project::{
    change_the_deliverable, code, grounded, json, ok, opened, project_with, record_evidence, state,
};
use tempfile::TempDir;

const CLASS: &str = "orchestrator-record-during-carry";

const PROCESS: &str = r#"
role "orchestrator" {
    purpose "divide the work and decide completion"
    model ["opus"]
}

role "worker" {
    purpose "carry out one bounded task"
    model ["small"]
    block_below "70"
}
"#;

fn project() -> TempDir {
    project_with(Some(PROCESS))
}

fn project_without_process_memory() -> TempDir {
    project_with(None)
}

#[test]
fn open_reports_whether_process_memory_declares_the_orchestrator() {
    let open = [
        "task",
        "open",
        "work",
        "--role",
        "worker",
        "--statement",
        "repair the entry point",
        "--scope",
        "src",
        "--deliverable",
        "src/thing.rs",
        "--check",
        "true",
    ];
    let bare = project_without_process_memory();
    assert_eq!(json(&bare, &open)["orchestrator_declared"], false);
    let declared = project();
    assert_eq!(json(&declared, &open)["orchestrator_declared"], true);
}

fn amendment<'a>(verb: &str, model: &'a str) -> Vec<&'a str> {
    match verb {
        "check" => vec!["task", "check", "work", "--model", model, "--check", "true"],
        "scope" => vec![
            "task",
            "scope",
            "work",
            "--add",
            "contracts",
            "--model",
            model,
        ],
        _ => vec![
            "task",
            "statement",
            "work",
            "repair the entry point",
            "--model",
            model,
        ],
    }
}

#[test]
fn optional_orchestrator_model_is_recorded_without_a_role_and_limited_with_one() {
    let bare = project_without_process_memory();
    opened(&bare);
    let declared = project();
    opened(&declared);
    for verb in ["check", "scope", "statement"] {
        assert_eq!(code(&bare, &amendment(verb, "claude-opus-5-5")), 0);
        assert_eq!(records(&bare).last().unwrap()["verb"], verb);
        if verb == "check" {
            assert_eq!(records(&bare).last().unwrap()["model"], "claude-opus-5-5");
        }
        assert_eq!(code(&declared, &amendment(verb, "small")), 2);
        assert_eq!(code(&declared, &amendment(verb, "opus")), 0);
    }
    assert_eq!(
        json(&bare, &["task", "show", "work"])["task"]["check"][0],
        "true"
    );
}

fn take(temp: &TempDir) {
    assert_eq!(
        code(temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
}

fn carried(temp: &TempDir) {
    opened(temp);
    take(temp);
}

fn hand_back(temp: &TempDir) {
    change_the_deliverable(temp);
    record_evidence(temp);
    assert_eq!(code(temp, &["challenge", "work"]), 0);
    assert_eq!(code(temp, &["task", "ready", "work"]), 0);
}

fn record_a_finding(temp: &TempDir) -> String {
    ok(temp, &["task", "finding", "work", "the entry point panics"]);
    json(temp, &["task", "show", "work"])["task"]["findings"]
        .as_array()
        .unwrap()
        .len()
        .to_string()
}

fn resolve(temp: &TempDir, id: &str) {
    ok(
        temp,
        &[
            "task",
            "resolve",
            "work",
            id,
            "--evidence",
            "src/thing.rs no longer panics",
            "--model",
            "opus",
        ],
    );
}

fn resolve_a_finding(temp: &TempDir) {
    let id = record_a_finding(temp);
    resolve(temp, &id);
}

fn records(temp: &TempDir) -> Vec<Value> {
    json(temp, &["task", "show", "work"])["task"]["orchestrator_records"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

#[test]
fn every_orchestrator_verb_made_while_a_worker_carries_the_task_is_marked_and_listed() {
    let temp = project();
    carried(&temp);
    resolve_a_finding(&temp);
    std::fs::create_dir_all(temp.path().join("other")).unwrap();
    std::fs::write(temp.path().join("other/landed.rs"), "pub fn landed() {}\n").unwrap();
    ok(
        &temp,
        &[
            "task",
            "attribute",
            "work",
            "other/landed.rs",
            "--kind",
            "concurrent",
            "--model",
            "opus",
        ],
    );
    ok(&temp, &["task", "scope", "work", "--add", "docs"]);
    ok(&temp, &["task", "check", "work", "--check", "true"]);
    ok(
        &temp,
        &["task", "deliverable", "work", "--add", "src/extra.rs"],
    );
    ok(
        &temp,
        &[
            "task",
            "deliverable",
            "work",
            "--remove",
            "src/extra.rs",
            "--reason",
            "the entry point needs no helper",
            "--model",
            "opus",
        ],
    );
    ok(
        &temp,
        &[
            "task",
            "propose-model",
            "work",
            "big",
            "--reason",
            "the repair is design heavy",
        ],
    );
    ok(
        &temp,
        &[
            "task",
            "approve-model",
            "work",
            "big",
            "--approval",
            "the owner approved big",
        ],
    );
    ok(
        &temp,
        &[
            "task",
            "decide",
            "work",
            "Is the panic in the entry point?",
            "--pick",
            "yes",
            "--confidence",
            "90",
            "--model",
            "small",
        ],
    );
    ok(
        &temp,
        &[
            "task",
            "answer",
            "work",
            "1",
            "--pick",
            "yes",
            "--reason",
            "the trace ends there",
            "--model",
            "opus",
        ],
    );

    let recorded = records(&temp);
    let verbs: Vec<&str> = recorded
        .iter()
        .map(|record| record["verb"].as_str().unwrap())
        .collect();
    assert_eq!(
        verbs,
        [
            "resolve",
            "attribute",
            "scope",
            "check",
            "deliverable --add",
            "deliverable --remove",
            "approve-model",
            "answer"
        ]
    );
    let models: Vec<Option<&str>> = recorded
        .iter()
        .map(|record| record["model"].as_str())
        .collect();
    assert_eq!(
        models,
        [
            Some("opus"),
            Some("opus"),
            None,
            None,
            None,
            Some("opus"),
            None,
            Some("opus")
        ]
    );
    for record in &recorded {
        assert_eq!(record["carried_by"], "small", "{record}");
        assert!(record["confirmed"].is_null(), "{record}");
        assert!(record["unix"].as_u64().unwrap() > 0, "{record}");
    }
}

#[test]
fn a_record_made_while_nobody_carries_the_task_is_kept_and_not_listed() {
    let temp = project();
    opened(&temp);
    ok(&temp, &["task", "scope", "work", "--add", "docs"]);
    take(&temp);
    ok(
        &temp,
        &[
            "task",
            "decide",
            "work",
            "Is the panic in the entry point?",
            "--pick",
            "yes",
            "--confidence",
            "40",
            "--model",
            "small",
        ],
    );
    assert_eq!(state(&temp), "blocked");
    ok(
        &temp,
        &[
            "task",
            "answer",
            "work",
            "1",
            "--pick",
            "yes",
            "--reason",
            "the trace ends there",
            "--model",
            "opus",
        ],
    );
    take(&temp);
    let id = record_a_finding(&temp);
    ok(
        &temp,
        &[
            "task",
            "addressed",
            "work",
            &id,
            "the panic is gone",
            "--model",
            "small",
        ],
    );
    hand_back(&temp);
    resolve(&temp, &id);

    let recorded = records(&temp);
    let verbs: Vec<&str> = recorded
        .iter()
        .map(|record| record["verb"].as_str().unwrap())
        .collect();
    assert_eq!(verbs, ["scope", "answer", "resolve"]);
    for record in &recorded {
        assert!(record["carried_by"].is_null(), "{record}");
    }
    assert!(!grounded(&temp).contains(&CLASS.to_owned()));
    assert_eq!(
        code(&temp, &["task", "confirm", "work", "--model", "opus"]),
        2
    );
    assert_eq!(
        code(&temp, &["task", "close", "work", "--model", "opus"]),
        0
    );
    assert_eq!(state(&temp), "closed");
}

#[test]
fn an_unconfirmed_record_from_the_carry_grounds_the_challenge_and_does_not_refuse_hand_back() {
    let temp = project();
    carried(&temp);
    ok(&temp, &["task", "scope", "work", "--add", "docs"]);
    change_the_deliverable(&temp);
    record_evidence(&temp);
    let challenge = json(&temp, &["challenge", "work"]);
    assert_eq!(challenge["challenge"]["class"], CLASS, "{challenge}");
    assert_eq!(challenge["assignment_clear"], true, "{challenge}");
    assert_eq!(code(&temp, &["challenge", "work"]), 0);
    assert_eq!(code(&temp, &["task", "ready", "work"]), 0);
    assert_eq!(state(&temp), "ready");
    assert!(grounded(&temp).contains(&CLASS.to_owned()));
    let project_challenge = json(&temp, &["challenge"]);
    assert_eq!(project_challenge["challenge"]["class"], CLASS);
}

#[test]
fn confirming_clears_every_record_from_the_carry_and_keeps_the_list() {
    let temp = project();
    opened(&temp);
    ok(&temp, &["task", "check", "work", "--check", "true"]);
    take(&temp);
    resolve_a_finding(&temp);
    hand_back(&temp);
    take(&temp);
    ok(&temp, &["task", "scope", "work", "--add", "docs"]);
    hand_back(&temp);
    assert!(grounded(&temp).contains(&CLASS.to_owned()));
    assert_eq!(
        code(&temp, &["task", "confirm", "work", "--model", "small"]),
        2
    );
    assert_eq!(
        code(&temp, &["task", "close", "work", "--model", "opus"]),
        2
    );
    assert!(
        records(&temp)
            .iter()
            .all(|record| record["confirmed"].is_null())
    );

    assert_eq!(
        code(&temp, &["task", "confirm", "work", "--model", "opus"]),
        0
    );
    let recorded = records(&temp);
    assert_eq!(recorded.len(), 3);
    assert!(recorded[0]["carried_by"].is_null());
    assert!(recorded[0]["confirmed"].is_null());
    for record in &recorded[1..] {
        assert_eq!(record["carried_by"], "small", "{record}");
        assert_eq!(record["confirmed"]["model"], "opus", "{record}");
    }
    assert!(!grounded(&temp).contains(&CLASS.to_owned()));
    assert_eq!(
        code(&temp, &["task", "close", "work", "--model", "opus"]),
        0
    );
    assert_eq!(state(&temp), "closed");
    assert_eq!(
        code(&temp, &["task", "confirm", "work", "--model", "opus"]),
        2
    );
}

#[test]
fn resolving_a_finding_needs_the_orchestrator_process_memory_declares() {
    let bare = project_without_process_memory();
    opened(&bare);
    ok(
        &bare,
        &["task", "finding", "work", "the entry point panics"],
    );
    assert_eq!(
        code(
            &bare,
            &[
                "task",
                "resolve",
                "work",
                "1",
                "--evidence",
                "src/thing.rs no longer panics",
                "--model",
                "opus",
            ]
        ),
        2
    );
    assert_eq!(json(&bare, &["task", "show", "work"])["unresolved"], 1);

    let declared = project();
    opened(&declared);
    let id = record_a_finding(&declared);
    resolve(&declared, &id);
    assert_eq!(json(&declared, &["task", "show", "work"])["unresolved"], 0);
}

#[test]
fn the_carrier_cannot_confirm_records_from_its_own_carry() {
    let temp = project();
    carried(&temp);
    ok(&temp, &["task", "scope", "work", "--add", "docs"]);
    let before = json(&temp, &["task", "show", "work"])["task"].clone();
    assert_eq!(
        code(&temp, &["task", "confirm", "work", "--model", "opus"]),
        2
    );
    assert_eq!(json(&temp, &["task", "show", "work"])["task"], before);
    assert!(grounded(&temp).contains(&CLASS.to_owned()));
    ok(
        &temp,
        &["task", "block", "work", "waiting on the orchestrator"],
    );
    assert_eq!(
        code(&temp, &["task", "confirm", "work", "--model", "opus"]),
        0
    );
    assert!(
        records(&temp)
            .iter()
            .all(|record| record["confirmed"]["model"] == "opus")
    );
}

#[test]
fn withdrawal_requires_orchestrator_attestation_and_preserves_rejected_record() {
    let temp = project();
    ok(
        &temp,
        &[
            "task",
            "open",
            "withdraw",
            "--role",
            "worker",
            "--statement",
            "repair",
            "--scope",
            "src",
        ],
    );
    let path = temp.path().join(".blabla/tasks/withdraw.json");
    let before = std::fs::read(&path).unwrap();
    for model in ["small", "unknown"] {
        assert_eq!(
            code(
                &temp,
                &[
                    "task", "withdraw", "withdraw", "--reason", "reassign", "--model", model
                ]
            ),
            2
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
    assert_eq!(
        code(
            &temp,
            &[
                "task", "withdraw", "withdraw", "--reason", " ", "--model", "opus"
            ]
        ),
        2
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);
    ok(
        &temp,
        &[
            "task", "withdraw", "withdraw", "--reason", "reassign", "--model", "opus",
        ],
    );
    let view = json(&temp, &["task", "show", "withdraw"]);
    assert_eq!(view["task"]["withdrawal"]["model"], "opus");
    assert_eq!(
        view["task"]["orchestrator_records"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()["model"],
        "opus"
    );
    assert_eq!(view["task"]["state"], "withdrawn");
}
