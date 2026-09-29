use blabla::voice::{Voice, contradiction, speaks_bluntly};
use serde_json::Value;
use std::process::Output;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;

use support::{args, run_in};

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
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    std::fs::create_dir_all(root.join("contracts")).unwrap();
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(
        root.join("project.bla"),
        "project Test\n\nprocess \"process.bla\"\n\nuse structure \"contracts/arch.bla\"\n",
    )
    .unwrap();
    std::fs::write(
        root.join("contracts/arch.bla"),
        "module thing \"src/thing.rs\"\n\nrequire \"entry\": symbol thing::run\n",
    )
    .unwrap();
    std::fs::write(root.join("process.bla"), PROCESS).unwrap();
    std::fs::write(root.join("src/thing.rs"), "pub fn run() {}\n").unwrap();
    temp
}

fn run(temp: &TempDir, list: &[&str]) -> Output {
    run_in(Some(temp.path()), &args(list))
}

fn code(temp: &TempDir, list: &[&str]) -> i32 {
    run(temp, list).status.code().unwrap()
}

fn text(temp: &TempDir, list: &[&str]) -> String {
    let output = run(temp, list);
    format!(
        "{}{}",
        String::from_utf8(output.stdout).unwrap(),
        String::from_utf8(output.stderr).unwrap()
    )
}

fn json(temp: &TempDir, list: &[&str]) -> Value {
    let mut list = list.to_vec();
    list.push("--json");
    serde_json::from_slice(&run(temp, &list).stdout).unwrap()
}

fn ok(temp: &TempDir, list: &[&str]) {
    let output = run(temp, list);
    assert_eq!(
        output.status.code(),
        Some(0),
        "{list:?}: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn opened(temp: &TempDir) {
    ok(
        temp,
        &[
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
        ],
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
    std::fs::write(
        temp.path().join("src/thing.rs"),
        "pub fn run() -> u8 { 1 }\n",
    )
    .unwrap();
    assert_eq!(
        code(
            temp,
            &["task", "evidence", "work", "--exit", "0", "--tool", "check"]
        ),
        0
    );
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

fn grounded(temp: &TempDir) -> Vec<String> {
    json(temp, &["challenge", "work"])["grounded"]
        .as_array()
        .unwrap()
        .iter()
        .map(|class| class.as_str().unwrap().to_owned())
        .collect()
}

fn state(temp: &TempDir) -> String {
    json(temp, &["task", "show", "work"])["task"]["state"]
        .as_str()
        .unwrap()
        .to_owned()
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
    ok(&temp, &["task", "check", "work", "true"]);
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

    let shown = text(&temp, &["task", "show", "work"]);
    assert!(
        shown.contains("Recorded under an orchestrator model while small carried the task:\n  resolve   --model opus   UNCONFIRMED\n  attribute   --model opus   UNCONFIRMED\n  scope   no --model given   UNCONFIRMED\n  check   no --model given   UNCONFIRMED\n  deliverable --add   no --model given   UNCONFIRMED\n  deliverable --remove   --model opus   UNCONFIRMED\n  approve-model   no --model given   UNCONFIRMED\n  answer   --model opus   UNCONFIRMED\n"),
        "{shown}"
    );
    assert!(
        shown.contains("--model is an attestation, not proof."),
        "{shown}"
    );
    assert!(
        shown.contains("blabla task confirm work --model <id>"),
        "{shown}"
    );
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
    let shown = text(&temp, &["task", "show", "work"]);
    assert!(
        !shown.contains("Recorded under an orchestrator model"),
        "{shown}"
    );
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
    std::fs::write(
        temp.path().join("src/thing.rs"),
        "pub fn run() -> u8 { 1 }\n",
    )
    .unwrap();
    assert_eq!(
        code(
            &temp,
            &["task", "evidence", "work", "--exit", "0", "--tool", "check"]
        ),
        0
    );
    let challenge = json(&temp, &["challenge", "work"]);
    assert_eq!(challenge["challenge"]["class"], CLASS, "{challenge}");
    assert_eq!(challenge["assignment_clear"], true, "{challenge}");
    let statement = challenge["challenge"]["statement"].as_str().unwrap();
    assert!(
        statement.contains("--model is an attestation, not proof"),
        "{statement}"
    );
    let reconcile = challenge["challenge"]["reconcile"].as_str().unwrap();
    assert!(
        reconcile.contains("blabla task confirm work --model <id>"),
        "{reconcile}"
    );
    assert_eq!(code(&temp, &["challenge", "work"]), 0);
    assert_eq!(code(&temp, &["task", "ready", "work"]), 0);
    assert_eq!(state(&temp), "ready");
    assert!(grounded(&temp).contains(&CLASS.to_owned()));
    let project_challenge = json(&temp, &["challenge"]);
    assert_eq!(project_challenge["challenge"]["class"], CLASS);
}

#[test]
fn the_blunt_voice_has_a_line_for_a_record_made_while_a_worker_carries_the_task() {
    let temp = project();
    let manifest = std::fs::read_to_string(temp.path().join("project.bla")).unwrap();
    std::fs::write(
        temp.path().join("project.bla"),
        format!("{manifest}\nvoice blunt\n"),
    )
    .unwrap();
    carried(&temp);
    resolve_a_finding(&temp);
    hand_back(&temp);
    let challenge = json(&temp, &["challenge", "work"]);
    assert_eq!(challenge["challenge"]["class"], CLASS, "{challenge}");
    let neutral = challenge["challenge"]["statement"].as_str().unwrap();
    let blunt = contradiction(Voice::Blunt, CLASS, neutral);
    assert!(speaks_bluntly(&blunt), "{blunt}");
    let said = text(&temp, &["challenge", "work"]);
    assert!(said.contains(&blunt), "{said}");
}

#[test]
fn confirming_clears_every_record_from_the_carry_and_keeps_the_list() {
    let temp = project();
    opened(&temp);
    ok(&temp, &["task", "check", "work", "true"]);
    take(&temp);
    resolve_a_finding(&temp);
    hand_back(&temp);
    take(&temp);
    ok(&temp, &["task", "scope", "work", "--add", "docs"]);
    hand_back(&temp);
    assert!(grounded(&temp).contains(&CLASS.to_owned()));

    let refused = text(&temp, &["task", "confirm", "work", "--model", "small"]);
    assert_eq!(
        code(&temp, &["task", "confirm", "work", "--model", "small"]),
        2
    );
    assert!(
        refused.contains("not in role::orchestrator's permitted list"),
        "{refused}"
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
    let shown = text(&temp, &["task", "show", "work"]);
    assert!(
        shown.contains("  resolve   --model opus   confirmed by opus\n  scope   no --model given   confirmed by opus\n"),
        "{shown}"
    );
    assert!(
        !shown.contains("task close is refused until every record here is confirmed"),
        "{shown}"
    );
    let nothing = text(&temp, &["task", "confirm", "work", "--model", "opus"]);
    assert!(nothing.contains("nothing to confirm"), "{nothing}");
}

#[test]
fn the_carrier_cannot_confirm_records_from_its_own_carry() {
    let temp = project();
    carried(&temp);
    ok(&temp, &["task", "scope", "work", "--add", "docs"]);
    let before = json(&temp, &["task", "show", "work"])["task"].clone();
    let refusal = text(&temp, &["task", "confirm", "work", "--model", "opus"]);
    assert!(refusal.contains("carried by small"), "{refusal}");
    assert!(refusal.contains("task ready or task block"), "{refusal}");
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
fn a_task_with_unconfirmed_records_from_the_carry_does_not_close() {
    let temp = project();
    carried(&temp);
    resolve_a_finding(&temp);
    hand_back(&temp);
    let refusal = text(&temp, &["task", "close", "work", "--model", "opus"]);
    assert_eq!(
        code(&temp, &["task", "close", "work", "--model", "opus"]),
        2
    );
    assert!(
        refusal.contains("blabla task confirm work --model <id>"),
        "{refusal}"
    );
    assert_eq!(state(&temp), "ready");
    assert_eq!(
        code(&temp, &["task", "confirm", "work", "--model", "opus"]),
        0
    );
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
