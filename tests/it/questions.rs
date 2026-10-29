use crate::support;
use crate::task_workflow::hand_back;
use blabla::project::status::CompletionState;
use blabla::project::task::machine::{self, Command, Facts, TaskState};
use blabla::project::task::{self, Acceptance, Answer, Ask, Evidence, Opening, Pick, Question};
use blabla::skeptic::{self, Evidence as Grounds};
use blabla::structure::falsify::FalsifyReport;
use serde_json::Value;
use std::collections::BTreeMap;
use std::process::Output;
use support::task_project::{
    accepted, change_the_deliverable, code, grounded, json, opened, project, record_evidence, run,
    shows, state,
};
use tempfile::TempDir;

const PROCESS: &str = r#"
role "orchestrator" {
    purpose "divide the work and ask the calls it doubts"
    model ["opus"]
}

role "worker" {
    purpose "carry out one bounded task"
    model ["small"]
    block_below "70"
}
"#;

const QUESTION: &str = "Is the failing test this task's?";

fn ask(temp: &TempDir, extra: &[&str], model: &str) -> Output {
    let mut list = vec!["task", "ask", "work", QUESTION, "--model", model];
    list.extend_from_slice(extra);
    run(temp, &list)
}

fn pick(temp: &TempDir, on: &str, choice: &str, confidence: &str) -> Output {
    run(
        temp,
        &[
            "task",
            "decide",
            "work",
            "--on",
            on,
            "--pick",
            choice,
            "--confidence",
            confidence,
            "--model",
            "small",
        ],
    )
}

fn shown(temp: &TempDir) -> Value {
    json(temp, &["task", "show", "work"])["task"].clone()
}

fn questions(temp: &TempDir) -> Vec<Value> {
    shown(temp)["questions"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn decisions(temp: &TempDir) -> Vec<Value> {
    shown(temp)["decisions"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn change_the_deliverable_and_record_evidence(temp: &TempDir) {
    change_the_deliverable(temp);
    record_evidence(temp);
}

#[test]
fn an_asked_question_waits_for_the_workers_pick_and_leaves_the_state_alone() {
    let temp = project(PROCESS);
    opened(&temp);
    let output = ask(&temp, &[], "opus");
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(state(&temp), "open");
    assert_eq!(
        code(&temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
    assert_eq!(
        ask(&temp, &["--options", "a,b,c", "--floor", "90"], "opus")
            .status
            .code(),
        Some(0)
    );
    assert_eq!(state(&temp), "accepted");
    let asked = questions(&temp);
    assert_eq!(asked.len(), 2);
    assert_eq!(asked[0]["id"], "q1");
    assert_eq!(asked[0]["kind"], "yes-no");
    assert_eq!(asked[0]["options"], serde_json::json!(["yes", "no"]));
    assert_eq!(asked[0]["floor"], 70);
    assert_eq!(asked[0]["model"], "opus");
    assert_eq!(asked[1]["id"], "q2");
    assert_eq!(asked[1]["kind"], "choice");
    assert_eq!(asked[1]["options"], serde_json::json!(["a", "b", "c"]));
    assert_eq!(asked[1]["floor"], 90);
    assert!(decisions(&temp).is_empty());
}

#[test]
fn only_the_orchestrator_asks() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(
        ask(&temp, &["--floor", "90"], "small").status.code(),
        Some(2)
    );
    assert!(questions(&temp).is_empty());
    assert_eq!(
        ask(&temp, &["--floor", "90"], "opus").status.code(),
        Some(0)
    );
    let unprocessed = project(PROCESS);
    std::fs::write(
        unprocessed.path().join("process.bla"),
        PROCESS.replace("role \"orchestrator\"", "role \"planner\""),
    )
    .unwrap();
    accepted(&unprocessed);
    assert_eq!(ask(&unprocessed, &[], "opus").status.code(), Some(2));
    assert!(questions(&unprocessed).is_empty());
}

#[test]
fn a_floor_below_the_roles_or_outside_0_to_100_is_refused_and_nothing_is_recorded() {
    let temp = project(PROCESS);
    accepted(&temp);
    for floor in ["69", "0", "-1", "101"] {
        assert_eq!(
            ask(&temp, &["--floor", floor], "opus").status.code(),
            Some(2),
            "{floor}"
        );
    }
    assert!(questions(&temp).is_empty());
    for (floor, options) in [("70", "a"), ("70", "a,a"), ("70", ",b")] {
        assert_eq!(
            ask(&temp, &["--floor", floor, "--options", options], "opus")
                .status
                .code(),
            Some(2),
            "{options}"
        );
    }
    assert_eq!(
        code(&temp, &["task", "ask", "work", " ", "--model", "opus"]),
        2
    );
    assert!(questions(&temp).is_empty());
    for floor in ["70", "100"] {
        assert_eq!(
            ask(&temp, &["--floor", floor], "opus").status.code(),
            Some(0)
        );
    }
    assert_eq!(questions(&temp).len(), 2);
}

#[test]
fn a_pick_at_or_above_the_questions_floor_is_a_decision_linked_to_it_that_stands() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(
        ask(&temp, &["--options", "a,b,c", "--floor", "90"], "opus")
            .status
            .code(),
        Some(0)
    );
    let output = pick(&temp, "q1", "b", "90");
    assert_eq!(output.status.code(), Some(0));
    let recorded = decisions(&temp);
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0]["on"], "q1");
    assert_eq!(recorded[0]["question"], QUESTION);
    assert_eq!(recorded[0]["kind"], "choice");
    assert_eq!(recorded[0]["options"], serde_json::json!(["a", "b", "c"]));
    assert_eq!(recorded[0]["pick"], "b");
    assert_eq!(recorded[0]["floor"], 90);
    assert_eq!(recorded[0]["below_floor"], false);
    assert_eq!(state(&temp), "accepted");
}

#[test]
fn a_pick_below_the_higher_of_the_questions_and_the_roles_floor_blocks_the_task() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(
        ask(&temp, &["--floor", "90"], "opus").status.code(),
        Some(0)
    );
    let output = pick(&temp, "q1", "yes", "80");
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(state(&temp), "blocked");
    assert_eq!(decisions(&temp)[0]["below_floor"], true);
    assert_eq!(decisions(&temp)[0]["floor"], 90);
    let challenge = json(&temp, &["challenge", "work"]);
    assert_eq!(challenge["challenge"]["class"], "decision-unanswered");
    assert!(!grounded(&temp).contains(&"question-unpicked".to_owned()));

    let raised = project(PROCESS);
    accepted(&raised);
    assert_eq!(
        ask(&raised, &["--floor", "80"], "opus").status.code(),
        Some(0)
    );
    support::write(
        raised.path(),
        "process.bla",
        &PROCESS.replace("block_below \"70\"", "block_below \"90\""),
    );
    assert_eq!(pick(&raised, "q1", "yes", "85").status.code(), Some(0));
    assert_eq!(decisions(&raised)[0]["floor"], 90);
    assert_eq!(questions(&raised)[0]["floor"], 80);
    let challenge = json(&raised, &["challenge", "work"]);
    assert_eq!(challenge["challenge"]["class"], "decision-unanswered");
    assert_eq!(code(&raised, &["task", "ready", "work"]), 2);
}

#[test]
fn a_question_is_picked_once() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(ask(&temp, &[], "opus").status.code(), Some(0));
    assert_eq!(pick(&temp, "q1", "yes", "95").status.code(), Some(0));
    for (choice, confidence) in [("no", "99"), ("yes", "95")] {
        assert_eq!(pick(&temp, "q1", choice, confidence).status.code(), Some(2));
    }
    assert_eq!(decisions(&temp).len(), 1);
}

#[test]
fn human_views_run_with_an_unpicked_and_a_picked_question() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(ask(&temp, &[], "opus").status.code(), Some(0));
    shows(&temp, &["task", "show", "work"], "q1");
    shows(&temp, &["status"], "work");
    assert_eq!(pick(&temp, "q1", "yes", "95").status.code(), Some(0));
    shows(&temp, &["task", "show", "work"], "q1");
    shows(&temp, &["explain", "role::worker"], "role::worker");
}

#[test]
fn a_pick_follows_every_decide_rule() {
    let temp = project(PROCESS);
    opened(&temp);
    assert_eq!(
        ask(&temp, &["--options", "a,b", "--floor", "90"], "opus")
            .status
            .code(),
        Some(0)
    );
    let before_acceptance = pick(&temp, "q1", "a", "95");
    assert_eq!(before_acceptance.status.code(), Some(2));
    assert_eq!(
        code(&temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
    assert_eq!(pick(&temp, "q1", "c", "95").status.code(), Some(2));
    assert_eq!(pick(&temp, "q1", "yes", "95").status.code(), Some(2));
    for outside in ["101", "-1"] {
        assert_eq!(pick(&temp, "q1", "a", outside).status.code(), Some(2));
    }
    assert_eq!(pick(&temp, "q9", "a", "95").status.code(), Some(2));
    let with_text = run(
        &temp,
        &[
            "task",
            "decide",
            "work",
            QUESTION,
            "--on",
            "q1",
            "--pick",
            "a",
            "--confidence",
            "95",
            "--model",
            "small",
        ],
    );
    assert_eq!(with_text.status.code(), Some(2));
    let with_options = run(
        &temp,
        &[
            "task",
            "decide",
            "work",
            "--on",
            "q1",
            "--options",
            "a,b",
            "--pick",
            "a",
            "--confidence",
            "95",
            "--model",
            "small",
        ],
    );
    assert_eq!(with_options.status.code(), Some(2));
    let with_neither = run(
        &temp,
        &[
            "task",
            "decide",
            "work",
            "--pick",
            "a",
            "--confidence",
            "95",
            "--model",
            "small",
        ],
    );
    assert_eq!(with_neither.status.code(), Some(2));
    let other_model = run(
        &temp,
        &[
            "task",
            "decide",
            "work",
            "--on",
            "q1",
            "--pick",
            "a",
            "--confidence",
            "95",
            "--model",
            "opus",
        ],
    );
    assert_eq!(other_model.status.code(), Some(2));
    assert!(decisions(&temp).is_empty());
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "decide",
                "work",
                "Rename the flag?",
                "--pick",
                "no",
                "--confidence",
                "10",
                "--model",
                "small",
            ],
        )
        .status
        .code(),
        Some(0)
    );
    assert_eq!(state(&temp), "blocked");
    let blocked = pick(&temp, "q1", "a", "95");
    assert_eq!(blocked.status.code(), Some(2));
    assert_eq!(decisions(&temp).len(), 1);
    assert_eq!(ask(&temp, &[], "opus").status.code(), Some(0));
    assert_eq!(state(&temp), "blocked");
}

#[test]
fn an_unpicked_question_refuses_hand_back_and_grounds_its_challenge() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(
        ask(
            &temp,
            &["--options", "mine,concurrent", "--floor", "90"],
            "opus"
        )
        .status
        .code(),
        Some(0)
    );
    change_the_deliverable_and_record_evidence(&temp);
    let challenge = json(&temp, &["challenge", "work"]);
    assert_eq!(challenge["challenge"]["class"], "question-unpicked");
    assert_eq!(code(&temp, &["challenge", "work"]), 1);
    assert_eq!(code(&temp, &["task", "ready", "work"]), 2);
    assert_eq!(state(&temp), "accepted");
    assert_eq!(pick(&temp, "q1", "mine", "95").status.code(), Some(0));
    assert!(!grounded(&temp).contains(&"question-unpicked".to_owned()));
    assert_eq!(code(&temp, &["challenge", "work"]), 0);
    assert_eq!(code(&temp, &["task", "ready", "work"]), 0);
}

#[test]
fn a_question_asked_after_hand_back_stands_and_refuses_the_close() {
    let temp = project(PROCESS);
    accepted(&temp);
    change_the_deliverable_and_record_evidence(&temp);
    assert_eq!(code(&temp, &["challenge", "work"]), 0);
    assert_eq!(code(&temp, &["task", "ready", "work"]), 0);
    assert_eq!(ask(&temp, &[], "opus").status.code(), Some(0));
    assert_eq!(state(&temp), "ready");
    assert!(grounded(&temp).contains(&"question-unpicked".to_owned()));
    assert_eq!(
        code(&temp, &["task", "close", "work", "--model", "opus"]),
        2
    );
    assert_eq!(
        code(&temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
    assert_eq!(pick(&temp, "q1", "no", "90").status.code(), Some(0));
    assert_eq!(code(&temp, &["challenge", "work"]), 1);
    change_the_deliverable_and_record_evidence(&temp);
    assert_eq!(code(&temp, &["challenge", "work"]), 0);
    assert_eq!(code(&temp, &["task", "ready", "work"]), 0);
}

#[test]
fn asking_while_the_worker_carries_the_task_is_attested_like_every_orchestrator_verb() {
    let temp = project(PROCESS);
    opened(&temp);
    assert_eq!(ask(&temp, &[], "opus").status.code(), Some(0));
    let record = shown(&temp)["orchestrator_records"].clone();
    assert_eq!(record[0]["verb"], "ask", "{record}");
    assert!(record[0]["carried_by"].is_null(), "{record}");
    assert_eq!(
        code(&temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
    assert_eq!(ask(&temp, &[], "opus").status.code(), Some(0));
    let record = shown(&temp)["orchestrator_records"].clone();
    assert_eq!(record[1]["verb"], "ask", "{record}");
    assert_eq!(record[1]["model"], "opus", "{record}");
    assert_eq!(record[1]["carried_by"], "small", "{record}");
    assert!(grounded(&temp).contains(&"orchestrator-record-during-carry".to_owned()));
}

#[test]
fn explain_role_counts_how_many_answered_decisions_were_asked_questions() {
    let temp = project(PROCESS);
    accepted(&temp);
    assert_eq!(
        ask(&temp, &["--floor", "90"], "opus").status.code(),
        Some(0)
    );
    assert_eq!(pick(&temp, "q1", "yes", "80").status.code(), Some(0));
    assert_eq!(
        code(
            &temp,
            &[
                "task",
                "answer",
                "work",
                "1",
                "--pick",
                "no",
                "--reason",
                "the failure predates the task",
                "--model",
                "opus",
            ],
        ),
        0
    );
    assert_eq!(
        code(&temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "decide",
                "work",
                "Rename the flag?",
                "--pick",
                "yes",
                "--confidence",
                "90",
                "--model",
                "small",
            ],
        )
        .status
        .code(),
        Some(0)
    );
    assert_eq!(
        code(
            &temp,
            &[
                "task", "answer", "work", "2", "--pick", "yes", "--reason", "fine", "--model",
                "opus",
            ],
        ),
        0
    );
    let role = json(&temp, &["explain", "role::worker"]);
    assert_eq!(role["calibration"][0]["answered"], 2, "{role}");
    assert_eq!(role["calibration"][0]["overruled"], 1, "{role}");
    assert_eq!(role["calibration"][0]["asked"], 1, "{role}");
    assert_eq!(role["calibration"][0]["mean_confidence"], 85, "{role}");
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
            check: Some(vec!["check".to_owned()]),
            ..Default::default()
        },
        0,
        BTreeMap::from([("src/a.rs".to_owned(), "old".to_owned())]),
        vec![Some("old".to_owned())],
    );
    assert!(machine::fire(&mut work, Command::Accept, &Facts::record_only()).is_ok());
    work.accepted = Some(Acceptance {
        model: "small".to_owned(),
        unix: 1,
        changed_at_acceptance: None,
    });
    work.evidence.push(Evidence {
        member_manifest: None,
        reuse: None,
        identity: task::declared_check(&work),
        acceptance_epoch: Some(work.acceptance_epoch),
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

fn asked(floor: Option<i64>, model: &str) -> Ask {
    Ask {
        question: QUESTION.to_owned(),
        options: Vec::new(),
        floor,
        model: model.to_owned(),
    }
}

fn picked(confidence: i64) -> Pick {
    Pick {
        on: "q1".to_owned(),
        pick: "yes".to_owned(),
        confidence,
        model: "small".to_owned(),
    }
}

fn orchestrator() -> Vec<String> {
    vec!["opus".to_owned()]
}

fn report(work: &task::Task, tree: &BTreeMap<String, String>) -> skeptic::ChallengeReport {
    skeptic::challenge(&Grounds {
        task: Some(work),
        tree,
        completion: CompletionState::Green,
        completion_reason: "",
        falsify: &|| FalsifyReport {
            invocations: 0,
            falsifiable: 0,
            vacuous: 0,
            unevaluable: 0,
            total: 0,
            rules: Vec::new(),
        },
        role: None,
        other_tasks: &[],
    })
}

fn blockers(work: &task::Task, tree: &BTreeMap<String, String>) -> Vec<&'static str> {
    report(work, tree).assignment_blockers()
}

fn call(pick: &str, confidence: i64) -> Question {
    Question {
        question: "Rename it?".to_owned(),
        options: Vec::new(),
        pick: pick.to_owned(),
        confidence,
        model: "small".to_owned(),
    }
}

#[test]
fn the_library_refuses_a_worker_a_low_floor_a_closed_task_and_a_second_pick() {
    let (mut work, _) = library_task();
    assert!(task::ask(&mut work, asked(Some(90), "small"), 70, &orchestrator()).is_err());
    assert!(task::ask(&mut work, asked(Some(69), "opus"), 70, &orchestrator()).is_err());
    assert!(task::ask(&mut work, asked(Some(101), "opus"), 0, &orchestrator()).is_err());
    assert!(work.questions.is_empty());
    assert!(task::ask(&mut work, asked(Some(69), "anyone"), 0, &[]).is_ok());
    assert!(task::pick(&mut work, picked(95), 0).is_ok());
    assert!(task::pick(&mut work, picked(95), 0).is_err());
    assert_eq!(work.decisions.len(), 1);
    task::answer(
        &mut work,
        1,
        Answer {
            pick: "yes".to_owned(),
            model: "opus".to_owned(),
            reason: "read".to_owned(),
        },
    )
    .unwrap();
    assert_eq!(
        task::calibration(std::slice::from_ref(&work), str::to_owned)[0].asked,
        1
    );
    assert!(
        task::decide(
            &mut work,
            Question {
                question: "Rename it?".to_owned(),
                options: Vec::new(),
                pick: "no".to_owned(),
                confidence: 95,
                model: "small".to_owned(),
            },
            0,
        )
        .unwrap()
        .on
        .is_none()
    );
    work.state = TaskState::Closed;
    assert!(task::ask(&mut work, asked(None, "opus"), 0, &orchestrator()).is_err());
}

#[test]
fn the_library_refuses_hand_back_while_a_question_is_unpicked_even_with_no_blocker_counted() {
    let (mut work, tree) = library_task();
    assert!(task::ask(&mut work, asked(None, "opus"), 70, &orchestrator()).is_ok());
    assert_eq!(work.questions[0].floor, 70);
    assert_eq!(work.state, TaskState::Accepted);
    assert_eq!(blockers(&work, &tree), vec!["question-unpicked"]);
    assert_eq!(task::handback(&work, &tree), Err("pick-question"));
    assert!(task::record_challenge(&mut work, &tree, 0, 3));
    assert_eq!(hand_back(&mut work, &tree), Err("pick-question"));
    assert_eq!(work.state, TaskState::Accepted);
    assert!(!task::pick(&mut work, picked(70), 70).unwrap().below_floor);
    assert!(blockers(&work, &tree).is_empty());
    assert!(task::record_challenge(&mut work, &tree, 0, 4));
    assert!(hand_back(&mut work, &tree).is_ok());
}

#[test]
fn the_library_measures_a_pick_against_the_higher_of_the_questions_and_the_roles_floor() {
    let (mut work, tree) = library_task();
    assert!(task::ask(&mut work, asked(Some(80), "opus"), 70, &orchestrator()).is_ok());
    let decision = task::pick(&mut work, picked(85), 90).unwrap();
    assert_eq!(decision.floor, 90);
    assert!(decision.below_floor);
    assert_eq!(work.state, TaskState::Blocked);
    assert_eq!(task::floor_owner(&work, &work.decisions[0]), "role::worker");
    assert_eq!(
        report(&work, &tree)
            .challenge
            .expect("a challenge stands")
            .class
            .word(),
        "decision-unanswered"
    );
    let (mut work, tree) = library_task();
    assert!(task::ask(&mut work, asked(Some(90), "opus"), 70, &orchestrator()).is_ok());
    assert_eq!(task::pick(&mut work, picked(85), 70).unwrap().floor, 90);
    let owner = task::floor_owner(&work, &work.decisions[0]);
    assert!(owner.ends_with(&work.questions[0].id), "{owner}");
    assert!(!owner.starts_with("role::"), "{owner}");
    assert_eq!(
        report(&work, &tree)
            .challenge
            .expect("a challenge stands")
            .class
            .word(),
        "decision-unanswered"
    );
}

#[test]
fn the_library_blocks_the_task_refuses_resumption_until_answered_and_an_answer_keeps_a_receipt() {
    let (mut work, tree) = library_task();
    assert!(
        task::decide(&mut work, call("yes", 49), 50)
            .unwrap()
            .unanswered_below_floor()
    );
    assert_eq!(work.state, TaskState::Blocked);
    assert!(task::decide(&mut work, call("yes", 90), 50).is_err());
    assert_eq!(work.decisions.len(), 1);
    assert_eq!(task::handback(&work, &tree), Err("await-answer"));
    assert!(hand_back(&mut work, &tree).is_err());
    assert!(machine::fire(&mut work, Command::Accept, &Facts::record_only()).is_err());
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
    assert_eq!(work.state, TaskState::Blocked);
    assert!(machine::fire(&mut work, Command::Accept, &Facts::record_only()).is_ok());
    assert_eq!(task::handback(&work, &tree), Err("challenge"));
    assert!(task::decide(&mut work, call("yes", 50), 50).is_ok());
    assert_eq!(work.state, TaskState::Accepted);
    assert!(task::record_challenge(&mut work, &tree, 0, 3));
    assert!(hand_back(&mut work, &tree).is_ok());
    assert!(task::answer(&mut work, 2, given).is_ok());
    assert!(task::challenge_current(&work, &tree));
}
