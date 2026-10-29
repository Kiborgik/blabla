use crate::support;
use blabla::voice::{Voice, contradiction, speaks_bluntly};
use serde_json::Value;
use std::process::Output;
use support::task_project::{
    accepted, change_the_deliverable, code, grounded, json, opened, project, record_evidence, run,
    shows, state, text,
};
use tempfile::TempDir;

const PROCESS: &str = r#"
role "orchestrator" {
    purpose "divide the work"
    model ["opus"]
}

role "worker" {
    purpose "carry out one bounded task"
    model ["small"]
    block_below "70"
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

fn decide(temp: &TempDir, pick: &str, confidence: &str, options: Option<&str>) -> Output {
    let mut list = vec![
        "task",
        "decide",
        "work",
        "Is the stale read caused by the cache?",
        "--pick",
        pick,
        "--confidence",
        confidence,
        "--model",
        "small",
    ];
    if let Some(options) = options {
        list.extend(["--options", options]);
    }
    run(temp, &list)
}

fn decisions(temp: &TempDir) -> Vec<Value> {
    json(temp, &["task", "show", "work"])["task"]["decisions"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn answer(temp: &TempDir, id: &str, pick: &str, model: &str) -> i32 {
    code(
        temp,
        &[
            "task",
            "answer",
            "work",
            id,
            "--pick",
            pick,
            "--reason",
            "the failing run reads a cold cache; the lock is the cause",
            "--model",
            model,
        ],
    )
}

fn standing(temp: &TempDir) -> Value {
    json(temp, &["task", "show", "work"])["decisions"][0].clone()
}

#[test]
fn a_decision_at_the_floor_is_recorded_and_stands() {
    let temp = project(PROCESS);
    accepted(&temp);
    let output = decide(&temp, "yes", "70", None);
    assert_eq!(output.status.code(), Some(0));
    let recorded = decisions(&temp);
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0]["kind"], "yes-no");
    assert_eq!(recorded[0]["options"], serde_json::json!(["yes", "no"]));
    assert_eq!(recorded[0]["confidence"], 70);
    assert_eq!(recorded[0]["model"], "small");
    assert_eq!(recorded[0]["below_floor"], false);
    assert_eq!(state(&temp), "accepted");
}

#[test]
fn a_decision_below_the_floor_blocks_the_task_in_the_same_step() {
    let temp = project(PROCESS);
    accepted(&temp);
    let output = decide(&temp, "b", "69", Some("a,b,c"));
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(state(&temp), "blocked");
    let recorded = decisions(&temp);
    assert_eq!(recorded[0]["kind"], "choice");
    assert_eq!(recorded[0]["options"], serde_json::json!(["a", "b", "c"]));
    assert_eq!(recorded[0]["below_floor"], true);
    assert_eq!(recorded[0]["floor"], 70);
}

#[test]
fn a_blocked_task_takes_no_decision_until_the_orchestrator_answers_and_the_worker_resumes() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(decide(&temp, "yes", "20", None).status.code(), Some(0));
    for (pick, confidence) in [("no", "95"), ("yes", "10")] {
        let refused = run(
            &temp,
            &[
                "task",
                "decide",
                "work",
                "Rename the flag?",
                "--pick",
                pick,
                "--confidence",
                confidence,
                "--model",
                "small",
            ],
        );
        assert_eq!(refused.status.code(), Some(2));
    }
    assert_eq!(decisions(&temp).len(), 1);
    assert_eq!(state(&temp), "blocked");
    assert_eq!(
        code(&temp, &["task", "accept", "work", "--model", "small"]),
        2
    );
    assert_eq!(answer(&temp, "1", "no", "opus"), 0);
    assert_eq!(state(&temp), "blocked");
    assert_eq!(decide(&temp, "yes", "95", None).status.code(), Some(2));
    assert_eq!(
        code(&temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
    assert_eq!(state(&temp), "accepted");
    assert_eq!(decide(&temp, "yes", "95", None).status.code(), Some(0));
    assert_eq!(decisions(&temp).len(), 2);
}

#[test]
fn decide_arguments_are_validated_and_nothing_is_recorded() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(decide(&temp, "maybe", "90", None).status.code(), Some(2));
    assert_eq!(
        decide(&temp, "d", "90", Some("a,b,c")).status.code(),
        Some(2)
    );
    assert_eq!(decide(&temp, "a", "90", Some("a")).status.code(), Some(2));
    assert_eq!(decide(&temp, "a", "90", Some("a,a")).status.code(), Some(2));
    for outside in ["101", "-1", "1000"] {
        assert_eq!(
            decide(&temp, "yes", outside, None).status.code(),
            Some(2),
            "{outside}"
        );
    }
    assert!(decisions(&temp).is_empty());
    assert_eq!(state(&temp), "accepted");
    assert_eq!(decide(&temp, "yes", "100", None).status.code(), Some(0));
    assert_eq!(decide(&temp, "yes", "0", None).status.code(), Some(0));
    assert_eq!(decisions(&temp).len(), 2);
}

#[test]
fn deciding_is_the_carrying_roles_once_the_task_is_accepted() {
    let temp = project(PROCESS);
    opened(&temp);
    assert_eq!(decide(&temp, "yes", "90", None).status.code(), Some(2));
    assert_eq!(
        code(&temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
    let other_model = code(
        &temp,
        &[
            "task",
            "decide",
            "work",
            "Is it the cache?",
            "--pick",
            "yes",
            "--confidence",
            "90",
            "--model",
            "opus",
        ],
    );
    assert_eq!(other_model, 2);
    assert!(decisions(&temp).is_empty());
}

#[test]
fn answering_a_decision_settles_it_and_counts_in_calibration() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(decide(&temp, "yes", "40", None).status.code(), Some(0));
    assert_eq!(answer(&temp, "1", "maybe", "opus"), 2);
    assert_eq!(answer(&temp, "1", "yes", "small"), 2);
    assert_eq!(answer(&temp, "2", "yes", "opus"), 2);
    assert!(decisions(&temp)[0]["answer"].is_null());
    assert_eq!(answer(&temp, "1", "yes", "opus"), 0);
    assert_eq!(decisions(&temp)[0]["answer"]["pick"], "yes");
    assert_eq!(decisions(&temp)[0]["answer"]["model"], "opus");
    assert_eq!(standing(&temp)["status"], "answered");
    assert_eq!(standing(&temp)["current_pick"], "yes");
    let role = json(&temp, &["explain", "role::worker"]);
    assert_eq!(role["calibration"][0]["held"], 1, "{role}");
    assert_eq!(role["calibration"][0]["overruled"], 0, "{role}");

    let overruled = project(PROCESS);
    accepted(&overruled);
    assert_eq!(decide(&overruled, "yes", "40", None).status.code(), Some(0));
    assert_eq!(answer(&overruled, "1", "no", "opus"), 0);
    assert_eq!(decisions(&overruled)[0]["answer"]["pick"], "no");
    assert_eq!(standing(&overruled)["status"], "overruled");
    assert_eq!(standing(&overruled)["current_pick"], "no");
    let role = json(&overruled, &["explain", "role::worker"]);
    assert_eq!(role["calibration"][0]["answered"], 1, "{role}");
    assert_eq!(role["calibration"][0]["held"], 0, "{role}");
    assert_eq!(role["calibration"][0]["overruled"], 1, "{role}");
}

#[test]
fn an_unanswered_decision_below_the_floor_refuses_hand_back_and_grounds_its_challenge() {
    let temp = project(PROCESS);
    accepted(&temp);
    change_the_deliverable(&temp);
    assert_eq!(
        decide(&temp, "c", "30", Some("a,b,c")).status.code(),
        Some(0)
    );
    let challenge = json(&temp, &["challenge", "work"]);
    assert_eq!(challenge["challenge"]["class"], "decision-unanswered");
    assert_eq!(code(&temp, &["task", "ready", "work"]), 2);
    assert_eq!(state(&temp), "blocked");
    assert_eq!(answer(&temp, "1", "a", "opus"), 0);
    assert!(!grounded(&temp).contains(&"decision-unanswered".to_owned()));
    assert_eq!(
        code(&temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
    record_evidence(&temp);
    assert_eq!(code(&temp, &["challenge", "work"]), 0);
    assert_eq!(code(&temp, &["task", "ready", "work"]), 0);
}

#[test]
fn several_unanswered_decisions_below_the_floor_are_all_counted_in_the_challenge() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(decide(&temp, "yes", "30", None).status.code(), Some(0));
    let single = json(&temp, &["challenge", "work"])["challenge"]["evidence"]
        .as_array()
        .unwrap()
        .len();
    let path = temp.path().join(".blabla/tasks/work.json");
    let mut record: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let mut second = record["decisions"][0].clone();
    second["id"] = 2.into();
    second["question"] = "A second open call".into();
    record["decisions"].as_array_mut().unwrap().push(second);
    std::fs::write(&path, serde_json::to_vec(&record).unwrap()).unwrap();
    let challenge = json(&temp, &["challenge", "work"]);
    assert_eq!(challenge["challenge"]["class"], "decision-unanswered");
    let evidence = challenge["challenge"]["evidence"].as_array().unwrap();
    assert_eq!(evidence.len(), single + 1, "{challenge}");
    assert_eq!(decisions(&temp).len(), 2);
}

#[test]
fn decisions_that_stand_do_not_block_hand_back() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(decide(&temp, "yes", "95", None).status.code(), Some(0));
    change_the_deliverable(&temp);
    record_evidence(&temp);
    assert!(!grounded(&temp).contains(&"decision-unanswered".to_owned()));
    assert_eq!(code(&temp, &["task", "ready", "work"]), 0);
    assert_eq!(answer(&temp, "1", "no", "opus"), 0);
    assert_eq!(state(&temp), "ready");
    assert_eq!(code(&temp, &["challenge", "work"]), 0);
}

#[test]
fn a_blunt_project_voices_every_challenge_in_its_own_words() {
    let temp = project(PROCESS);
    let manifest = std::fs::read_to_string(temp.path().join("project.bla")).unwrap();
    support::write(
        temp.path(),
        "project.bla",
        &format!("{manifest}\nvoice blunt\n"),
    );
    accepted(&temp);
    assert_eq!(decide(&temp, "yes", "10", None).status.code(), Some(0));
    let challenge = json(&temp, &["challenge", "work"]);
    assert_eq!(challenge["challenge"]["class"], "decision-unanswered");
    let neutral = challenge["challenge"]["statement"].as_str().unwrap();
    let blunt = contradiction(Voice::Blunt, "decision-unanswered", neutral);
    assert!(speaks_bluntly(&blunt), "{blunt}");
    let said = text(&temp, &["challenge", "work"]);
    assert!(said.contains(&blunt), "{said}");
}

#[test]
fn explain_role_reports_the_floor_and_calibration_per_model_from_every_record() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(decide(&temp, "yes", "90", None).status.code(), Some(0));
    assert_eq!(decide(&temp, "yes", "61", None).status.code(), Some(0));
    assert_eq!(answer(&temp, "1", "yes", "opus"), 0);
    assert_eq!(answer(&temp, "2", "no", "opus"), 0);
    assert_eq!(
        code(&temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
    assert_eq!(decide(&temp, "no", "20", None).status.code(), Some(0));
    let mut closed: Value = serde_json::from_slice(
        &std::fs::read(temp.path().join(".blabla/tasks/work.json")).unwrap(),
    )
    .unwrap();
    closed["name"] = "earlier".into();
    closed["state"] = "closed".into();
    closed["closed_unix"] = 9.into();
    closed["decisions"][0]["model"] = "tiny".into();
    closed["decisions"][0]["confidence"] = 51.into();
    closed["decisions"].as_array_mut().unwrap().truncate(1);
    std::fs::write(
        temp.path().join(".blabla/tasks/earlier.json"),
        serde_json::to_vec(&closed).unwrap(),
    )
    .unwrap();
    let worker = json(&temp, &["explain", "role::worker"]);
    assert_eq!(worker["block_below"], 70, "{worker}");
    let by_model = |model: &str| {
        worker["calibration"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["model"] == model)
            .unwrap_or_else(|| panic!("{model}: {worker}"))
            .clone()
    };
    let small = by_model("small");
    assert_eq!(small["answered"], 2);
    assert_eq!(small["held"], 1);
    assert_eq!(small["mean_confidence"], 76);
    assert_eq!(small["asked"], 0);
    let tiny = by_model("tiny");
    assert_eq!(tiny["answered"], 1);
    assert_eq!(tiny["held"], 1);
    assert_eq!(tiny["mean_confidence"], 51);
    let orchestrator = json(&temp, &["explain", "role::orchestrator"]);
    assert_eq!(orchestrator["block_below"], 0, "{orchestrator}");
    assert!(
        orchestrator
            .get("calibration")
            .is_none_or(|calibration| calibration.as_array().is_none_or(Vec::is_empty)),
        "{orchestrator}"
    );
}

#[test]
fn human_views_run_with_open_and_answered_decisions() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(decide(&temp, "yes", "40", None).status.code(), Some(0));
    shows(&temp, &["task", "show", "work"], "task::work");
    shows(&temp, &["explain", "role::worker"], "role::worker");
    shows(&temp, &["status"], "work");
    assert_eq!(answer(&temp, "1", "no", "opus"), 0);
    shows(&temp, &["task", "show", "work"], "task::work");
    shows(&temp, &["explain", "role::worker"], "role::worker");
    shows(
        &temp,
        &["explain", "flow::development"],
        "flow::development",
    );
}

#[test]
fn calibration_counts_an_alias_under_the_model_it_stands_for() {
    let temp = project(&format!(
        "{PROCESS}\nalias \"small-host-id\" {{ model \"small\" }}\n"
    ));
    accepted(&temp);
    for (question, model) in [
        ("Is it the cache?", "small"),
        ("Is it the lock?", "small-host-id"),
    ] {
        assert_eq!(
            code(
                &temp,
                &[
                    "task",
                    "decide",
                    "work",
                    question,
                    "--pick",
                    "yes",
                    "--confidence",
                    "90",
                    "--model",
                    model,
                ],
            ),
            0,
            "{model}"
        );
    }
    assert_eq!(decisions(&temp)[1]["model"], "small-host-id");
    assert_eq!(answer(&temp, "1", "yes", "opus"), 0);
    assert_eq!(answer(&temp, "2", "no", "opus"), 0);
    let role = json(&temp, &["explain", "role::worker"]);
    let calibration = role["calibration"].as_array().unwrap();
    assert_eq!(calibration.len(), 1, "{role}");
    assert_eq!(calibration[0]["model"], "small", "{role}");
    assert_eq!(calibration[0]["answered"], 2, "{role}");
    assert_eq!(calibration[0]["held"], 1, "{role}");
}

#[test]
fn a_floor_outside_0_to_100_makes_process_memory_invalid() {
    for (floor, valid) in [("101", false), ("-1", false), ("100", true), ("0", true)] {
        let temp =
            project(&PROCESS.replace("block_below \"70\"", &format!("block_below \"{floor}\"")));
        let status = json(&temp, &["status"]);
        assert_eq!(
            status["process_memory"]["state"] == "present",
            valid,
            "{floor}: {status}"
        );
    }
    let unreadable = project(&PROCESS.replace("block_below \"70\"", "block_below \"high\""));
    let status = json(&unreadable, &["status"]);
    assert_ne!(status["process_memory"]["state"], "present", "{status}");
}

#[test]
fn a_role_without_a_floor_blocks_nothing() {
    let temp = project(&PROCESS.replace("block_below \"70\"", ""));
    accepted(&temp);
    let output = decide(&temp, "yes", "0", None);
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(state(&temp), "accepted");
    assert_eq!(decisions(&temp)[0]["below_floor"], false);
    assert_eq!(json(&temp, &["explain", "role::worker"])["block_below"], 0);
}
