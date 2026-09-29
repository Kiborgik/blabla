use blabla::project::task::{self, Acceptance, Answer, Evidence, Opening, Question};
use blabla::voice::{Voice, contradiction, speaks_bluntly};
use serde_json::Value;
use std::collections::BTreeMap;
use std::process::Output;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;

use support::{args, run_in};

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

fn project(process: &str) -> TempDir {
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
    std::fs::write(root.join("process.bla"), process).unwrap();
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

fn accepted(temp: &TempDir) {
    assert_eq!(
        code(
            temp,
            &[
                "task",
                "open",
                "work",
                "--role",
                "worker",
                "--statement",
                "repair the cache",
                "--scope",
                "src",
                "--deliverable",
                "src/thing.rs",
                "--check",
                "true",
            ],
        ),
        0
    );
    assert_eq!(
        code(temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
}

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

fn change_the_deliverable(temp: &TempDir) {
    std::fs::write(
        temp.path().join("src/thing.rs"),
        "pub fn run() -> u8 { 1 }\n",
    )
    .unwrap();
}

fn record_evidence(temp: &TempDir) {
    assert_eq!(
        code(
            temp,
            &["task", "evidence", "work", "--exit", "0", "--tool", "check"]
        ),
        0
    );
}

fn state(temp: &TempDir) -> String {
    json(temp, &["task", "show", "work"])["task"]["state"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn grounded(temp: &TempDir) -> Vec<String> {
    json(temp, &["challenge", "work"])["grounded"]
        .as_array()
        .unwrap()
        .iter()
        .map(|class| class.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn a_decision_at_the_floor_is_recorded_and_stands() {
    let temp = project(PROCESS);
    accepted(&temp);
    let output = decide(&temp, "yes", "70", None);
    let said = String::from_utf8(output.stdout).unwrap();
    assert_eq!(output.status.code(), Some(0), "{said}");
    assert!(said.contains("decision 1 STANDS"), "{said}");
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
    let said = String::from_utf8(output.stdout).unwrap();
    assert_eq!(output.status.code(), Some(0), "{said}");
    assert!(
        said.contains("task::work   BLOCKED   decision 1 BLOCKS THE TASK"),
        "{said}"
    );
    assert!(said.contains("Stop now. Do not act on b"), "{said}");
    assert!(said.contains("blabla task answer work 1"), "{said}");
    assert!(said.contains("blabla task accept work"), "{said}");
    assert_eq!(state(&temp), "blocked");
    let recorded = decisions(&temp);
    assert_eq!(recorded[0]["kind"], "choice");
    assert_eq!(recorded[0]["options"], serde_json::json!(["a", "b", "c"]));
    assert_eq!(recorded[0]["below_floor"], true);
    assert_eq!(recorded[0]["floor"], 70);
}

#[test]
fn a_blocked_task_takes_no_decision_and_names_the_one_that_blocks_it() {
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
        let said = String::from_utf8(refused.stderr).unwrap();
        assert!(said.contains("decision 1"), "{said}");
        assert!(
            said.contains("Is the stale read caused by the cache?"),
            "{said}"
        );
    }
    assert_eq!(decisions(&temp).len(), 1);
    assert_eq!(state(&temp), "blocked");
    assert_eq!(answer(&temp, "1", "no", "opus"), 0);
    assert_eq!(decide(&temp, "yes", "95", None).status.code(), Some(2));
    assert_eq!(
        code(&temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
    assert_eq!(decide(&temp, "yes", "95", None).status.code(), Some(0));
    assert_eq!(decisions(&temp).len(), 2);
}

#[test]
fn a_pick_outside_the_options_is_refused_and_nothing_is_recorded() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(decide(&temp, "maybe", "90", None).status.code(), Some(2));
    assert_eq!(
        decide(&temp, "d", "90", Some("a,b,c")).status.code(),
        Some(2)
    );
    assert_eq!(decide(&temp, "a", "90", Some("a")).status.code(), Some(2));
    assert_eq!(decide(&temp, "a", "90", Some("a,a")).status.code(), Some(2));
    assert!(decisions(&temp).is_empty());
    assert_eq!(state(&temp), "accepted");
}

#[test]
fn a_confidence_outside_0_to_100_is_refused_and_nothing_is_recorded() {
    let temp = project(PROCESS);
    accepted(&temp);
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
    assert_eq!(
        code(
            &temp,
            &[
                "task",
                "open",
                "work",
                "--role",
                "worker",
                "--statement",
                "repair",
                "--scope",
                "src",
                "--check",
                "true",
            ],
        ),
        0
    );
    let before_acceptance = decide(&temp, "yes", "90", None);
    assert_eq!(before_acceptance.status.code(), Some(2));
    assert!(
        String::from_utf8(before_acceptance.stderr)
            .unwrap()
            .contains("blabla task accept work")
    );
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
fn only_the_orchestrators_answer_lets_a_blocked_task_resume() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(decide(&temp, "yes", "40", None).status.code(), Some(0));
    let refused = run(&temp, &["task", "accept", "work", "--model", "small"]);
    assert_eq!(refused.status.code(), Some(2));
    assert!(
        String::from_utf8(refused.stderr)
            .unwrap()
            .contains("Is the stale read caused by the cache?")
    );
    assert_eq!(state(&temp), "blocked");
    assert_eq!(answer(&temp, "1", "no", "opus"), 0);
    assert_eq!(state(&temp), "blocked");
    assert_eq!(
        code(&temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
    assert_eq!(state(&temp), "accepted");
}

#[test]
fn an_agreeing_answer_settles_the_decision_and_overrules_nothing() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(decide(&temp, "yes", "40", None).status.code(), Some(0));
    assert_eq!(answer(&temp, "1", "maybe", "opus"), 2);
    assert_eq!(answer(&temp, "1", "yes", "small"), 2);
    assert_eq!(answer(&temp, "2", "yes", "opus"), 2);
    assert!(decisions(&temp)[0]["answer"].is_null());
    assert_eq!(answer(&temp, "1", "yes", "opus"), 0);
    let recorded = decisions(&temp);
    assert_eq!(recorded[0]["answer"]["pick"], "yes");
    assert_eq!(recorded[0]["answer"]["model"], "opus");
    let role = json(&temp, &["explain", "role::worker"]);
    assert_eq!(role["calibration"][0]["held"], 1, "{role}");
    assert_eq!(role["calibration"][0]["overruled"], 0, "{role}");
}

#[test]
fn an_overruling_answer_settles_the_decision_and_counts_against_the_pick() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(decide(&temp, "yes", "40", None).status.code(), Some(0));
    assert_eq!(answer(&temp, "1", "no", "opus"), 0);
    assert_eq!(decisions(&temp)[0]["answer"]["pick"], "no");
    let role = json(&temp, &["explain", "role::worker"]);
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
    let evidence = challenge["challenge"]["evidence"].to_string();
    assert!(
        evidence.contains("Is the stale read caused by the cache?"),
        "{evidence}"
    );
    assert!(evidence.contains("options: a, b, c"), "{evidence}");
    let reconcile = challenge["challenge"]["reconcile"].as_str().unwrap();
    assert!(
        reconcile.contains("blabla task answer work 1 --pick <a|b|c>"),
        "{reconcile}"
    );
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
    assert_eq!(
        code(&temp, &["challenge", "work"]),
        0,
        "{}",
        text(&temp, &["challenge", "work"])
    );
}

#[test]
fn the_blunt_voice_has_a_line_for_an_unanswered_decision() {
    let temp = project(PROCESS);
    let manifest = std::fs::read_to_string(temp.path().join("project.bla")).unwrap();
    std::fs::write(
        temp.path().join("project.bla"),
        format!("{manifest}\nvoice blunt\n"),
    )
    .unwrap();
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
fn task_show_lists_every_decision_with_its_standing_and_answer() {
    let temp = project(PROCESS);
    accepted(&temp);
    let before = text(&temp, &["task", "show", "work"]);
    assert!(
        before.contains(
            "Decisions (role::worker blocks the task on a decision below 70% confidence):\n  none recorded"
        ),
        "{before}"
    );
    assert!(
        before.contains("blabla task decide work \"<question>\""),
        "{before}"
    );
    assert_eq!(decide(&temp, "yes", "90", None).status.code(), Some(0));
    assert_eq!(decide(&temp, "b", "50", Some("a,b")).status.code(), Some(0));
    let shown = text(&temp, &["task", "show", "work"]);
    assert!(
        shown.contains("yes-no: yes, no   picked yes at 90% by small   STANDS"),
        "{shown}"
    );
    assert!(
        shown.contains("choice: a, b   picked b at 50% by small   BLOCKS THE TASK, below 70%"),
        "{shown}"
    );
    assert!(
        shown.contains("no answer yet: stop, do not act on b. The orchestrator answers with blabla task answer work 2"),
        "{shown}"
    );
    assert_eq!(answer(&temp, "2", "a", "opus"), 0);
    let answered = text(&temp, &["task", "show", "work"]);
    assert!(
        answered.contains(
            "answered a by opus, overruling b: the failing run reads a cold cache; the lock is the cause"
        ),
        "{answered}"
    );
}

#[test]
fn explain_role_prints_the_floor_and_one_calibration_line_per_model_from_every_record() {
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
    let explained = text(&temp, &["explain", "role::worker"]);
    assert!(explained.contains("Blocks below:\n  70%"), "{explained}");
    assert!(
        explained
            .contains("  small  2 answered  1 held  mean confidence 76  0 on asked questions\n"),
        "{explained}"
    );
    assert!(
        explained
            .contains("  tiny  1 answered  1 held  mean confidence 51  0 on asked questions\n"),
        "{explained}"
    );
    let orchestrator = text(&temp, &["explain", "role::orchestrator"]);
    assert!(!orchestrator.contains("answered"), "{orchestrator}");
    assert!(
        orchestrator.contains("Blocks below:\n  0%"),
        "{orchestrator}"
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
fn a_floor_outside_0_to_100_makes_process_memory_invalid_with_the_role_named() {
    for (floor, valid) in [("101", false), ("-1", false), ("100", true), ("0", true)] {
        let temp =
            project(&PROCESS.replace("block_below \"70\"", &format!("block_below \"{floor}\"")));
        let status = json(&temp, &["status"]);
        let problems = status["process_memory"]["problems"].to_string();
        assert_eq!(
            status["process_memory"]["state"] == "present",
            valid,
            "{floor}: {status}"
        );
        if !valid {
            assert!(problems.contains("role \\\"worker\\\""), "{problems}");
        }
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
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("decision 1 STANDS")
    );
    assert_eq!(state(&temp), "accepted");
    assert_eq!(json(&temp, &["explain", "role::worker"])["block_below"], 0);
}

fn library_task() -> (task::Task, BTreeMap<String, String>) {
    let tree = BTreeMap::from([("src/a.rs".to_owned(), "new".to_owned())]);
    let mut work = task::record_from(
        Opening {
            name: "work".to_owned(),
            role: "worker".to_owned(),
            statement: "repair".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/a.rs".to_owned()],
            check: Some("check".to_owned()),
            ..Default::default()
        },
        0,
        BTreeMap::from([("src/a.rs".to_owned(), "old".to_owned())]),
        vec![Some("old".to_owned())],
    );
    assert!(task::apply(&mut work, "accepted"));
    work.accepted = Some(Acceptance {
        model: "small".to_owned(),
        unix: 1,
        changed_at_acceptance: None,
    });
    work.evidence.push(Evidence {
        check: "check".to_owned(),
        exit: 0,
        tree: "tree".to_owned(),
        tool: "test".to_owned(),
        unix: 2,
        inputs: task::evidence_inputs(&work, &tree),
        command: None,
        log: None,
    });
    (work, tree)
}

fn asked(pick: &str, confidence: i64) -> Question {
    Question {
        question: "Is it the cache?".to_owned(),
        options: Vec::new(),
        pick: pick.to_owned(),
        confidence,
        model: "small".to_owned(),
    }
}

#[test]
fn the_library_blocks_the_task_refuses_resumption_until_answered_and_an_answer_keeps_a_receipt() {
    let (mut work, tree) = library_task();
    assert!(
        task::decide(&mut work, asked("yes", 49), 50)
            .unwrap()
            .unanswered_below_floor()
    );
    assert_eq!(work.state, "blocked");
    assert!(task::decide(&mut work, asked("yes", 90), 50).is_err());
    assert_eq!(work.decisions.len(), 1);
    assert_eq!(task::handback(&work, &tree), Err("await-answer"));
    assert!(task::mark_ready(&mut work, &tree, 0).is_err());
    assert!(!task::apply(&mut work, "accepted"));
    let given = Answer {
        pick: "no".to_owned(),
        model: "opus".to_owned(),
        reason: "the lock".to_owned(),
    };
    assert!(
        task::answer(&mut work, 1, given.clone())
            .unwrap()
            .overruled()
    );
    assert_eq!(work.state, "blocked");
    assert!(task::apply(&mut work, "accepted"));
    assert_eq!(task::handback(&work, &tree), Err("challenge"));
    assert!(task::decide(&mut work, asked("yes", 50), 50).is_ok());
    assert_eq!(work.state, "accepted");
    assert!(task::record_challenge(&mut work, &tree, 0, 3));
    assert!(task::mark_ready(&mut work, &tree, 0).is_ok());
    assert!(task::answer(&mut work, 2, given).is_ok());
    assert!(task::challenge_current(&work, &tree));
}

#[test]
fn calibration_counts_only_answered_decisions_per_model() {
    let (mut work, _) = library_task();
    for (pick, confidence) in [("yes", 80), ("no", 91), ("yes", 10)] {
        task::decide(&mut work, asked(pick, confidence), 50).unwrap();
    }
    for (id, pick) in [(1, "yes"), (2, "yes")] {
        task::answer(
            &mut work,
            id,
            Answer {
                pick: pick.to_owned(),
                model: "opus".to_owned(),
                reason: "read".to_owned(),
            },
        )
        .unwrap();
    }
    assert_eq!(
        task::calibration(&[work], str::to_owned),
        vec![task::Calibration {
            model: "small".to_owned(),
            answered: 2,
            held: 1,
            overruled: 1,
            mean_confidence: 86,
            asked: 0,
        }]
    );
    assert!(task::calibration(&[], str::to_owned).is_empty());
}
