use blabla::project::status::CompletionState;
use blabla::project::task::{self, Acceptance, Answer, Ask, Evidence, Opening, Pick, Question};
use blabla::skeptic::{self, Evidence as Grounds};
use blabla::structure::falsify::FalsifyReport;
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

fn opened(temp: &TempDir) {
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
                "repair the entry point",
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
}

fn accepted(temp: &TempDir) {
    opened(temp);
    assert_eq!(
        code(temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
}

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

fn state(temp: &TempDir) -> String {
    shown(temp)["state"].as_str().unwrap().to_owned()
}

fn stderr(output: Output) -> String {
    String::from_utf8(output.stderr).unwrap()
}

fn change_the_deliverable_and_record_evidence(temp: &TempDir) {
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
fn an_asked_question_waits_for_the_workers_pick_and_leaves_the_state_alone() {
    let temp = project();
    opened(&temp);
    let output = ask(&temp, &[], "opus");
    let said = String::from_utf8(output.stdout).unwrap();
    assert_eq!(output.status.code(), Some(0), "{said}");
    assert!(
        said.contains("task::work   OPEN   question q1 asked, floor 70%"),
        "{said}"
    );
    assert!(
        said.contains(
            "blabla task decide work --on q1 --pick <yes|no> --confidence <0-100> --model <id>"
        ),
        "{said}"
    );
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
    let temp = project();
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
    let unprocessed = project();
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
    let temp = project();
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
    let temp = project();
    accepted(&temp);
    assert_eq!(
        ask(&temp, &["--options", "a,b,c", "--floor", "90"], "opus")
            .status
            .code(),
        Some(0)
    );
    let output = pick(&temp, "q1", "b", "90");
    let said = String::from_utf8(output.stdout).unwrap();
    assert_eq!(output.status.code(), Some(0), "{said}");
    assert!(said.contains("decision 1 STANDS"), "{said}");
    assert!(said.contains("question q1's floor of 90%"), "{said}");
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
fn a_pick_between_the_roles_floor_and_the_questions_floor_blocks_the_task() {
    let temp = project();
    accepted(&temp);
    assert_eq!(
        ask(&temp, &["--floor", "90"], "opus").status.code(),
        Some(0)
    );
    let output = pick(&temp, "q1", "yes", "80");
    let said = String::from_utf8(output.stdout).unwrap();
    assert_eq!(output.status.code(), Some(0), "{said}");
    assert!(
        said.contains("task::work   BLOCKED   decision 1 BLOCKS THE TASK"),
        "{said}"
    );
    assert!(
        said.contains("80% is below question q1's floor of 90%"),
        "{said}"
    );
    assert!(said.contains("blabla task answer work 1"), "{said}");
    assert_eq!(state(&temp), "blocked");
    assert_eq!(decisions(&temp)[0]["below_floor"], true);
    let challenge = json(&temp, &["challenge", "work"]);
    assert_eq!(challenge["challenge"]["class"], "decision-unanswered");
    assert!(
        challenge["challenge"]["evidence"]
            .to_string()
            .contains("below question q1's floor of 90%"),
        "{challenge}"
    );
    assert!(!grounded(&temp).contains(&"question-unpicked".to_owned()));
}

#[test]
fn a_role_floor_raised_above_the_questions_is_named_as_the_roles() {
    let temp = project();
    accepted(&temp);
    assert_eq!(
        ask(&temp, &["--floor", "80"], "opus").status.code(),
        Some(0)
    );
    std::fs::write(
        temp.path().join("process.bla"),
        PROCESS.replace("block_below \"70\"", "block_below \"90\""),
    )
    .unwrap();
    let output = pick(&temp, "q1", "yes", "85");
    let said = String::from_utf8(output.stdout).unwrap();
    assert_eq!(output.status.code(), Some(0), "{said}");
    assert!(
        said.contains("85% is below role::worker's floor of 90%"),
        "{said}"
    );
    assert_eq!(decisions(&temp)[0]["floor"], 90);
    assert_eq!(questions(&temp)[0]["floor"], 80);
    let challenge = json(&temp, &["challenge", "work"]);
    assert_eq!(challenge["challenge"]["class"], "decision-unanswered");
    assert!(
        challenge["challenge"]["evidence"]
            .to_string()
            .contains("below role::worker's floor of 90%"),
        "{challenge}"
    );
    let refused = stderr(run(&temp, &["task", "ready", "work"]));
    assert!(
        refused.contains("is below role::worker's floor and has no answer"),
        "{refused}"
    );
}

#[test]
fn a_question_is_picked_once_and_the_refusal_names_the_decision_that_picked_it() {
    let temp = project();
    accepted(&temp);
    assert_eq!(ask(&temp, &[], "opus").status.code(), Some(0));
    assert_eq!(pick(&temp, "q1", "yes", "95").status.code(), Some(0));
    for (choice, confidence) in [("no", "99"), ("yes", "95")] {
        let refused = pick(&temp, "q1", choice, confidence);
        assert_eq!(refused.status.code(), Some(2));
        let said = stderr(refused);
        assert!(
            said.contains("question q1 is already picked by decision 1"),
            "{said}"
        );
    }
    assert_eq!(decisions(&temp).len(), 1);
}

#[test]
fn a_pick_follows_every_decide_rule() {
    let temp = project();
    opened(&temp);
    assert_eq!(
        ask(&temp, &["--options", "a,b", "--floor", "90"], "opus")
            .status
            .code(),
        Some(0)
    );
    let before_acceptance = pick(&temp, "q1", "a", "95");
    assert_eq!(before_acceptance.status.code(), Some(2));
    assert!(stderr(before_acceptance).contains("blabla task accept work"));
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
    assert!(stderr(blocked).contains("Rename the flag?"));
    assert_eq!(decisions(&temp).len(), 1);
    assert_eq!(ask(&temp, &[], "opus").status.code(), Some(0));
    assert_eq!(state(&temp), "blocked");
}

#[test]
fn an_unpicked_question_refuses_hand_back_and_grounds_its_challenge() {
    let temp = project();
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
    let evidence = challenge["challenge"]["evidence"].to_string();
    assert!(evidence.contains("question q1"), "{evidence}");
    assert!(evidence.contains(QUESTION), "{evidence}");
    assert!(evidence.contains("options: mine, concurrent"), "{evidence}");
    let reconcile = challenge["challenge"]["reconcile"].as_str().unwrap();
    assert!(
        reconcile.starts_with(
            "blabla task decide work --on q1 --pick <mine|concurrent> --confidence <0-100> --model <id>"
        ),
        "{reconcile}"
    );
    assert_eq!(code(&temp, &["challenge", "work"]), 1);
    let refused = run(&temp, &["task", "ready", "work"]);
    assert_eq!(refused.status.code(), Some(2));
    let said = stderr(refused);
    assert!(
        said.contains("blabla task decide work --on q1 --pick <mine|concurrent>"),
        "{said}"
    );
    assert_eq!(state(&temp), "accepted");
    assert_eq!(pick(&temp, "q1", "mine", "95").status.code(), Some(0));
    assert!(!grounded(&temp).contains(&"question-unpicked".to_owned()));
    assert_eq!(code(&temp, &["challenge", "work"]), 0);
    assert_eq!(code(&temp, &["task", "ready", "work"]), 0);
}

#[test]
fn a_question_asked_after_hand_back_stands_and_refuses_the_close() {
    let temp = project();
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
    assert_eq!(code(&temp, &["challenge", "work"]), 0);
    assert_eq!(code(&temp, &["task", "ready", "work"]), 0);
}

#[test]
fn task_show_lists_the_questions_unpicked_first_before_the_decisions_and_routes_the_pick_first() {
    let temp = project();
    accepted(&temp);
    let before = text(&temp, &["task", "show", "work"]);
    assert!(
        before.contains("Questions from the orchestrator:\n  none asked\n\nDecisions"),
        "{before}"
    );
    assert!(before.contains("--on <question-id>"), "{before}");
    assert_eq!(ask(&temp, &[], "opus").status.code(), Some(0));
    assert_eq!(
        run(
            &temp,
            &[
                "task",
                "ask",
                "work",
                "Which lock guards the entry?",
                "--options",
                "read,write",
                "--floor",
                "90",
                "--model",
                "opus",
            ],
        )
        .status
        .code(),
        Some(0)
    );
    assert_eq!(pick(&temp, "q1", "yes", "95").status.code(), Some(0));
    let shown = text(&temp, &["task", "show", "work"]);
    let questions_at = shown.find("Questions from the orchestrator").unwrap();
    let decisions_at = shown.find("\nDecisions (").unwrap();
    assert!(questions_at < decisions_at, "{shown}");
    let unpicked_at = shown.find("  q2 Which lock guards the entry?").unwrap();
    let picked_at = shown.find(&format!("  q1 {QUESTION}")).unwrap();
    assert!(
        questions_at < unpicked_at && unpicked_at < picked_at,
        "{shown}"
    );
    assert!(
        shown.contains("    choice: read, write   floor 90%   asked by opus\n    NO PICK: blabla task decide work --on q2 --pick <read|write> --confidence <0-100> --model <id>"),
        "{shown}"
    );
    assert!(
        shown.contains(
            "    yes-no: yes, no   floor 70%   asked by opus\n    picked yes at 95% in decision 1"
        ),
        "{shown}"
    );
    assert!(
        shown.contains(&format!("  1 {QUESTION}   on question q1")),
        "{shown}"
    );
    let routes = &shown[shown.find("\nScratch:").unwrap()..];
    let first_route = routes
        .lines()
        .skip(3)
        .find(|line| !line.trim().is_empty())
        .unwrap();
    assert!(
        first_route.starts_with(
            "  blabla task decide work --on q2 --pick <read|write> --confidence <0-100> --model <id>"
        ),
        "{routes}"
    );
    assert!(
        first_route.contains("before anything else"),
        "{first_route}"
    );
    assert_eq!(pick(&temp, "q2", "read", "95").status.code(), Some(0));
    let settled = text(&temp, &["task", "show", "work"]);
    assert!(!settled.contains("NO PICK"), "{settled}");
    assert!(!settled.contains("before anything else"), "{settled}");
}

#[test]
fn asking_while_the_worker_carries_the_task_is_attested_like_every_orchestrator_verb() {
    let temp = project();
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
    let listed = text(&temp, &["task", "show", "work"]);
    assert!(
        listed.contains("  ask   --model opus   UNCONFIRMED"),
        "{listed}"
    );
    assert!(grounded(&temp).contains(&"orchestrator-record-during-carry".to_owned()));
}

#[test]
fn explain_role_counts_how_many_answered_decisions_were_asked_questions() {
    let temp = project();
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
    let explained = text(&temp, &["explain", "role::worker"]);
    assert!(
        explained
            .contains("  small  2 answered  1 held  mean confidence 85  1 on asked questions\n"),
        "{explained}"
    );
}

#[test]
fn the_blunt_voice_has_a_line_for_an_unpicked_question() {
    let temp = project();
    let manifest = std::fs::read_to_string(temp.path().join("project.bla")).unwrap();
    std::fs::write(
        temp.path().join("project.bla"),
        format!("{manifest}\nvoice blunt\n"),
    )
    .unwrap();
    accepted(&temp);
    assert_eq!(ask(&temp, &[], "opus").status.code(), Some(0));
    let challenge = json(&temp, &["challenge", "work"]);
    assert_eq!(challenge["challenge"]["class"], "question-unpicked");
    let neutral = challenge["challenge"]["statement"].as_str().unwrap();
    let blunt = contradiction(Voice::Blunt, "question-unpicked", neutral);
    assert!(speaks_bluntly(&blunt), "{blunt}");
    assert!(
        text(&temp, &["challenge", "work"]).contains(&blunt),
        "{blunt}"
    );
    assert!(skeptic::CLASSES.contains(&"question-unpicked"));
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

fn unanswered_evidence(work: &task::Task, tree: &BTreeMap<String, String>) -> String {
    let challenge = report(work, tree).challenge.expect("a challenge stands");
    assert_eq!(challenge.class.word(), "decision-unanswered");
    challenge.evidence.join("\n")
}

#[test]
fn the_library_refuses_hand_back_while_a_question_is_unpicked_even_with_no_blocker_counted() {
    let (mut work, tree) = library_task();
    assert!(task::ask(&mut work, asked(None, "opus"), 70, &orchestrator()).is_ok());
    assert_eq!(work.questions[0].floor, 70);
    assert_eq!(work.state, "accepted");
    assert_eq!(blockers(&work, &tree), vec!["question-unpicked"]);
    assert_eq!(task::handback(&work, &tree), Err("pick-question"));
    assert!(task::record_challenge(&mut work, &tree, 0, 3));
    assert_eq!(task::mark_ready(&mut work, &tree, 0), Err("pick-question"));
    assert_eq!(work.state, "accepted");
    assert!(!task::pick(&mut work, picked(70), 70).unwrap().below_floor);
    assert!(blockers(&work, &tree).is_empty());
    assert!(task::record_challenge(&mut work, &tree, 0, 4));
    assert!(task::mark_ready(&mut work, &tree, 0).is_ok());
}

#[test]
fn the_library_measures_a_pick_against_the_higher_of_the_questions_and_the_roles_floor() {
    let (mut work, tree) = library_task();
    assert!(task::ask(&mut work, asked(Some(80), "opus"), 70, &orchestrator()).is_ok());
    let decision = task::pick(&mut work, picked(85), 90).unwrap();
    assert_eq!(decision.floor, 90);
    assert!(decision.below_floor);
    assert_eq!(work.state, "blocked");
    assert_eq!(task::floor_owner(&work, &work.decisions[0]), "role::worker");
    let evidence = unanswered_evidence(&work, &tree);
    assert!(
        evidence.contains("below role::worker's floor of 90%"),
        "{evidence}"
    );
    let (mut work, tree) = library_task();
    assert!(task::ask(&mut work, asked(Some(90), "opus"), 70, &orchestrator()).is_ok());
    assert_eq!(task::pick(&mut work, picked(85), 70).unwrap().floor, 90);
    assert_eq!(task::floor_owner(&work, &work.decisions[0]), "question q1");
    let evidence = unanswered_evidence(&work, &tree);
    assert!(
        evidence.contains("below question q1's floor of 90%"),
        "{evidence}"
    );
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
    let again = task::pick(&mut work, picked(95), 0).unwrap_err();
    assert!(again.contains("decision 1"), "{again}");
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
    work.state = "closed".to_owned();
    assert!(task::ask(&mut work, asked(None, "opus"), 0, &orchestrator()).is_err());
}
