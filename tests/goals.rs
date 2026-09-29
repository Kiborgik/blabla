#[path = "support/cli.rs"]
mod support;

use blabla::memory::Memory;
use blabla::memory::goal::{self, Goal, GoalMemory, Outcome, Verdict};
use blabla::project::runstate::marker_path;
use blabla::skeptic::{self, Evidence};
use blabla::structure::falsify::FalsifyReport;
use blabla::voice::{self, Voice};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use support::{args, run_in};
use tempfile::TempDir;

const MANIFEST: &str = "project Fixture\n\nmission \"mission.bla\"\ngoal \"goals.bla\"\n\nuse structure \"contracts/arch.bla\"\nuse structure \"contracts/broken.bla\"\nuse behavior \"contracts/counter.bla\"\n";
const WITHOUT_GOALS: &str = "project Fixture\n\nmission \"mission.bla\"\n\nuse structure \"contracts/arch.bla\"\nuse structure \"contracts/broken.bla\"\nuse behavior \"contracts/counter.bla\"\n";
const WITHOUT_MISSION: &str =
    "project Fixture\n\ngoal \"goals.bla\"\n\nuse structure \"contracts/arch.bla\"\n";
const STRUCTURE_ONLY: &str = "project Fixture\n\ngoal \"goals.bla\"\n\nuse structure \"contracts/arch.bla\"\nuse structure \"contracts/broken.bla\"\n";
const STRUCTURE_ONLY_WITHOUT_GOALS: &str = "project Fixture\n\nuse structure \"contracts/arch.bla\"\nuse structure \"contracts/broken.bla\"\n";
const COUNTING: &str = "project Fixture\n\ngoal \"goals.bla\"\n\nuse behavior \"contracts/count.bla\"\n\nverify behavior {\n    command [\"python\", \"app.py\"]\n    cases 1\n    steps 4\n}\n";

const ARCH: &str = "module thing \"src/thing.rs\"\n\nrequire \"fields\": symbol thing::FIELDS\n";
const BROKEN: &str =
    "module thing \"src/thing.rs\"\n\nforbid \"no-fields\": symbol thing::FIELDS\n";
const COUNTER: &str = "state x: int\naction a()\nwhen a { expect \"grows\": after.x >= 0 }\n";
const SOURCE: &str = "pub const FIELDS: [&str; 1] = [\"a\"];\n";
const COUNT: &str = "state count: int\n\naction increment()\n\nwhen increment {\n    expect \"adds-one\": after.count == before.count + 1\n}\n";
const APP: &str = r#"import json
import sys

sys.stdin.reconfigure(encoding="utf-8", errors="strict")
sys.stdout.reconfigure(encoding="utf-8", errors="strict")
count = 0
for line in sys.stdin:
    request = json.loads(line)
    if request["op"] == "reset":
        count = 0
        result = {"ok": True}
    elif request["op"] == "observe":
        result = {"count": count}
    else:
        count += 1
        result = {"ok": True}
    print(json.dumps({"id": request["id"], "result": result}), flush=True)
"#;

const GOAL_CLASS: &str = skeptic::GOAL_CLASSES[0];

const MISSION: &str = r#"
mission "fixture" {
    statement "keep the fixture honest"
}

priority "truth-first" {
    statement "an honest signal outranks a convenient one"
}
"#;

const GOALS: &str = r#"
goal "verdicts" {
    serves ["truth-first"]
    statement "every verdict appears once"
    expect ["arch::fields", "broken::no-fields", "counter::grows", "arch::unwritten"]
    state "active"
}

goal "contracts" {
    statement "a contract is judged as a whole"
    expect ["contract::arch", "contract::broken", "contract::counter", "contract::absent"]
    state "active"
}

goal "ready" {
    statement "the structure the project needs is in place"
    expect ["arch::fields", "contract::arch"]
    state "active"
}

goal "shipped" {
    statement "a finished goal"
    expect ["arch::fields"]
    state "done"
}

goal "abandoned" {
    statement "a goal nobody pursues"
    expect ["broken::no-fields"]
    state "dropped"
}
"#;

fn write(root: &Path, relative: &str, text: &str) {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn project_with(manifest: &str, goals: &str) -> TempDir {
    let temp = without_goal_file(manifest);
    write(temp.path(), "goals.bla", goals);
    temp
}

fn without_goal_file(manifest: &str) -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "project.bla", manifest);
    write(root, "mission.bla", MISSION);
    write(root, "contracts/arch.bla", ARCH);
    write(root, "contracts/broken.bla", BROKEN);
    write(root, "contracts/counter.bla", COUNTER);
    write(root, "src/thing.rs", SOURCE);
    temp
}

fn project() -> TempDir {
    project_with(MANIFEST, GOALS)
}

fn json_of(temp: &TempDir, arguments: &[&str]) -> (Value, i32) {
    let output = run_in(Some(temp.path()), &args(arguments));
    let text = String::from_utf8(output.stdout).unwrap();
    (
        serde_json::from_str(&text).unwrap_or_else(|_| panic!("not JSON: {text}")),
        output.status.code().unwrap(),
    )
}

fn text_of(temp: &TempDir, arguments: &[&str]) -> String {
    String::from_utf8(run_in(Some(temp.path()), &args(arguments)).stdout).unwrap()
}

fn active<'a>(status: &'a Value, id: &str) -> &'a Value {
    status["goal_memory"]["active"]
        .as_array()
        .unwrap()
        .iter()
        .find(|outcome| outcome["goal"] == id)
        .unwrap_or_else(|| panic!("{id} is not an active goal in {status}"))
}

fn verdicts(outcome: &Value) -> Vec<(String, String)> {
    outcome["expectations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|expectation| {
            (
                expectation["identity"].as_str().unwrap().to_owned(),
                expectation["verdict"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

fn pairs(expected: &[(&str, Verdict)]) -> Vec<(String, String)> {
    expected
        .iter()
        .map(|(identity, verdict)| ((*identity).to_owned(), verdict.word().to_owned()))
        .collect()
}

fn problems(temp: &TempDir) -> Vec<String> {
    let (status, _) = json_of(temp, &["status", "--json"]);
    assert_eq!(status["goal_memory"]["state"], "invalid", "{status}");
    status["goal_memory"]["problems"]
        .as_array()
        .unwrap()
        .iter()
        .map(|problem| problem.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn each_rule_expectation_resolves_to_its_verdict() {
    let temp = project();
    let (status, _) = json_of(&temp, &["status", "--json"]);
    let outcome = active(&status, "goal::verdicts");
    assert_eq!(
        verdicts(outcome),
        pairs(&[
            ("arch::fields", Verdict::Held),
            ("broken::no-fields", Verdict::NotHeld),
            ("counter::grows", Verdict::Unverified),
            ("arch::unwritten", Verdict::Unresolved),
        ])
    );
    assert_eq!(outcome["expected"], 4);
    assert_eq!(outcome["held"], 1);
    assert_eq!(outcome["not_held"], 1);
    assert_eq!(outcome["unverified"], 1);
    assert_eq!(outcome["unresolved"], 1);
}

#[test]
fn each_contract_expectation_resolves_to_its_verdict() {
    let temp = project();
    let (status, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(
        verdicts(active(&status, "goal::contracts")),
        pairs(&[
            ("contract::arch", Verdict::Held),
            ("contract::broken", Verdict::NotHeld),
            ("contract::counter", Verdict::Unverified),
            ("contract::absent", Verdict::Unresolved),
        ])
    );
}

#[test]
fn status_counts_active_and_done_goals_and_lists_only_active_ones() {
    let temp = project();
    let (status, _) = json_of(&temp, &["status", "--json"]);
    let memory = &status["goal_memory"];
    assert_eq!(memory["state"], "present");
    assert_eq!(memory["file"], "goals.bla");
    assert_eq!(memory["done"], 1);
    assert_eq!(memory["dropped"], 1);
    let active: Vec<&str> = memory["active"]
        .as_array()
        .unwrap()
        .iter()
        .map(|outcome| outcome["goal"].as_str().unwrap())
        .collect();
    assert_eq!(active, ["goal::verdicts", "goal::contracts", "goal::ready"]);

    let text = text_of(&temp, &["status"]);
    let line = text
        .lines()
        .find(|line| line.starts_with("GOALS"))
        .unwrap_or_else(|| panic!("no GOALS line in {text}"));
    let words: Vec<&str> = line.split_whitespace().collect();
    assert_eq!(&words[1..5], ["3", "active", "1", "done"]);
    for id in active {
        assert!(
            text.lines()
                .any(|row| row.split_whitespace().next() == Some(id)),
            "{id} has no line of its own in {text}"
        );
    }
}

#[test]
fn goals_never_change_completion() {
    let with = project();
    let without = without_goal_file(WITHOUT_GOALS);
    let (status, code) = json_of(&with, &["status", "--json"]);
    let (bare, bare_code) = json_of(&without, &["status", "--json"]);
    assert!(bare.get("goal_memory").is_none());
    assert_eq!(status["overall"], bare["overall"]);
    assert_eq!(status["completion"], bare["completion"]);
    assert_eq!(code, bare_code);
}

#[test]
fn an_unregistered_goal_file_is_reported_and_not_read() {
    let temp = project_with(WITHOUT_GOALS, GOALS);
    let (status, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(status["goal_memory"]["state"], "unregistered");
    assert!(
        status["goal_memory"]["active"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn next_points_at_an_active_goal_whose_expectations_all_hold() {
    let temp = project();
    let text = text_of(&temp, &["status"]);
    let next: Vec<&str> = text
        .split("\nNext:\n")
        .nth(1)
        .unwrap_or_else(|| panic!("no Next section in {text}"))
        .lines()
        .take_while(|line| !line.is_empty())
        .collect();
    let pointed: Vec<&str> = next
        .iter()
        .filter_map(|line| line.split_whitespace().nth(2))
        .filter(|id| id.starts_with("goal::"))
        .collect();
    assert_eq!(pointed, ["goal::ready"], "{text}");
}

#[test]
fn explain_gives_the_statement_the_priorities_served_and_each_verdict() {
    let temp = project();
    let (view, code) = json_of(&temp, &["explain", "goal::verdicts", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(view["kind"], "goal");
    assert_eq!(view["id"], "goal::verdicts");
    assert_eq!(view["state"], "active");
    assert_eq!(view["statement"], "every verdict appears once");
    assert_eq!(view["serves"], serde_json::json!(["priority::truth-first"]));
    assert_eq!(view["outcome"]["expected"], 4);
    assert_eq!(view["outcome"]["held"], 1);

    let (bare, code) = json_of(&temp, &["explain", "abandoned", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(bare["id"], "goal::abandoned");
    assert_eq!(bare["state"], "dropped");
}

#[test]
fn a_duplicate_name_is_invalid() {
    let temp = project_with(
        MANIFEST,
        "goal \"twice\" { statement \"a\" expect [\"arch::fields\"] state \"active\" }\ngoal \"twice\" { statement \"b\" expect [\"arch::fields\"] state \"done\" }\n",
    );
    let found = problems(&temp);
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].contains("\"twice\""), "{found:?}");
}

#[test]
fn a_goal_that_expects_nothing_is_invalid() {
    let temp = project_with(
        MANIFEST,
        "goal \"vacuous\" { statement \"a\" expect [] state \"done\" }\n",
    );
    let found = problems(&temp);
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].contains("\"vacuous\""), "{found:?}");

    let (report, code) = json_of(&temp, &["check", "goals.bla", "--json"]);
    assert_eq!(report["status"], "invalid");
    assert_ne!(code, 0);
}

#[test]
fn a_state_outside_the_three_words_is_invalid() {
    let temp = project_with(
        MANIFEST,
        "goal \"odd\" { statement \"a\" expect [\"arch::fields\"] state \"finished\" }\n",
    );
    let found = problems(&temp);
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].contains("\"finished\""), "{found:?}");
}

#[test]
fn an_expectation_that_is_not_a_canonical_identity_is_invalid() {
    for written in ["fields", "contract::", "::fields", "arch::", "a b::c"] {
        let temp = project_with(
            MANIFEST,
            &format!("goal \"odd\" {{ statement \"a\" expect [{written:?}] state \"active\" }}\n"),
        );
        let found = problems(&temp);
        assert_eq!(found.len(), 1, "{written}: {found:?}");
        assert!(found[0].contains(&format!("{written:?}")), "{found:?}");
    }
}

#[test]
fn serving_an_undeclared_priority_is_invalid() {
    let temp = project_with(
        MANIFEST,
        "goal \"odd\" { serves [\"speed\"] statement \"a\" expect [\"arch::fields\"] state \"active\" }\n",
    );
    let found = problems(&temp);
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].contains("\"speed\""), "{found:?}");
    assert!(found[0].contains("truth-first"), "{found:?}");
}

#[test]
fn serving_a_priority_with_no_mission_registered_is_invalid() {
    let temp = project_with(
        WITHOUT_MISSION,
        "goal \"odd\" { serves [\"truth-first\"] statement \"a\" expect [\"arch::fields\"] state \"active\" }\n",
    );
    let found = problems(&temp);
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].contains("\"truth-first\""), "{found:?}");

    let valid = project_with(
        WITHOUT_MISSION,
        "goal \"odd\" { statement \"a\" expect [\"arch::fields\"] state \"active\" }\n",
    );
    let (status, _) = json_of(&valid, &["status", "--json"]);
    assert_eq!(status["goal_memory"]["state"], "present");
}

#[test]
fn a_missing_field_or_an_unknown_field_is_unreadable() {
    for goals in [
        "goal \"odd\" { statement \"a\" expect [] }\n",
        "goal \"odd\" { statement \"a\" expect [] state \"active\" owner \"x\" }\n",
        "priority \"odd\" { statement \"a\" }\n",
    ] {
        let temp = project_with(MANIFEST, goals);
        let (status, _) = json_of(&temp, &["status", "--json"]);
        assert_eq!(status["goal_memory"]["state"], "unreadable", "{goals}");
    }
}

#[test]
fn check_validates_a_goal_file_alone() {
    let temp = project();
    let (report, code) = json_of(&temp, &["check", "goals.bla", "--json"]);
    assert_eq!(code, 0, "{report}");
    assert_eq!(report["memory"], "goal");
    assert_eq!(report["status"], "valid");
    assert_eq!(report["declarations"], 5);

    write(
        temp.path(),
        "goals.bla",
        "goal \"odd\" { statement \"a\" expect [\"fields\"] state \"active\" }\n",
    );
    let (report, _) = json_of(&temp, &["check", "goals.bla", "--json"]);
    assert_eq!(report["status"], "invalid");
}

#[test]
fn a_second_goal_registration_and_a_group_named_goal_are_refused() {
    let temp = project_with(
        "project Fixture\n\ngoal \"goals.bla\"\ngoal \"more.bla\"\n\nuse structure \"contracts/arch.bla\"\n",
        GOALS,
    );
    let (error, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(code, 2);
    assert!(error.to_string().contains("E_DUPLICATE_GOAL"), "{error}");

    let temp = project_with(
        "project Fixture\n\nuse structure \"contracts/goal.bla\"\n",
        GOALS,
    );
    write(temp.path(), "contracts/goal.bla", ARCH);
    let (error, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(code, 2);
    assert!(error.to_string().contains("E_RESERVED_GROUP"), "{error}");
}

fn declared(state: &str) -> Goal {
    Goal {
        name: "ship".to_owned(),
        serves: Vec::new(),
        statement: "ship it".to_owned(),
        expect: vec!["arch::fields".to_owned(), "arch::more".to_owned()],
        state: state.to_owned(),
    }
}

fn judged(state: &str, more: Verdict) -> Outcome {
    goal::outcome(&declared(state), |identity| {
        if identity == "arch::more" {
            more
        } else {
            Verdict::Held
        }
    })
}

fn standing(goals: &[Outcome]) -> Vec<&'static str> {
    let falsified = || FalsifyReport {
        invocations: 0,
        falsifiable: 0,
        vacuous: 0,
        unevaluable: 0,
        total: 0,
        rules: Vec::new(),
    };
    skeptic::challenge_with_goals(
        &Evidence {
            task: None,
            tree: &BTreeMap::new(),
            completion: blabla::project::status::CompletionState::Green,
            completion_reason: "canonical verification is GREEN",
            falsify: &falsified,
            role: None,
            other_tasks: &[],
        },
        goals,
    )
    .grounded
}

#[test]
fn outcome_counts_each_verdict_from_the_lookup_alone() {
    for (verdict, held) in [
        (Verdict::Held, 2),
        (Verdict::NotHeld, 1),
        (Verdict::Unverified, 1),
        (Verdict::Unresolved, 1),
    ] {
        let outcome = judged("active", verdict);
        assert_eq!(outcome.goal, "goal::ship");
        assert_eq!(outcome.expected, 2);
        assert_eq!(outcome.held, held);
        assert_eq!(
            outcome.held + outcome.not_held + outcome.unverified + outcome.unresolved,
            2
        );
        assert_eq!(outcome.holds(), verdict == Verdict::Held);
    }
}

#[test]
fn a_done_goal_whose_expectation_is_not_held_is_challenged_project_wide() {
    for verdict in [Verdict::NotHeld, Verdict::Unverified, Verdict::Unresolved] {
        let grounded = standing(&[judged("done", verdict)]);
        assert_eq!(
            grounded.first(),
            Some(&skeptic::GOAL_CLASSES[0]),
            "{verdict:?}"
        );
    }
}

#[test]
fn a_goal_that_holds_is_active_or_is_dropped_is_never_challenged() {
    for goal in [
        judged("done", Verdict::Held),
        judged("active", Verdict::NotHeld),
        judged("dropped", Verdict::NotHeld),
    ] {
        let grounded = standing(std::slice::from_ref(&goal));
        assert!(
            !grounded.contains(&skeptic::GOAL_CLASSES[0]),
            "{} {}: {grounded:?}",
            goal.goal,
            goal.state
        );
    }
}

#[test]
fn the_goal_challenge_names_the_goal_and_each_expectation_not_held() {
    let report = skeptic::challenge_with_goals(
        &Evidence {
            task: None,
            tree: &BTreeMap::new(),
            completion: blabla::project::status::CompletionState::Green,
            completion_reason: "canonical verification is GREEN",
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
        },
        &[judged("done", Verdict::Unresolved)],
    );
    let challenge = report.challenge.as_ref().expect("a goal challenge stands");
    assert_eq!(challenge.class.word(), skeptic::GOAL_CLASSES[0]);
    assert!(challenge.statement.contains("goal::ship"));
    assert!(
        challenge
            .evidence
            .iter()
            .any(|line| line.contains("arch::more") && line.contains(Verdict::Unresolved.word()))
    );
    assert!(
        !challenge
            .evidence
            .iter()
            .any(|line| line.contains("arch::fields"))
    );
    assert_eq!(report.exit_code(), 1);
}

fn declaration(name: &str, state: &str, expect: &[&str]) -> String {
    format!(
        "goal {name:?} {{\n    statement \"a goal\"\n    expect {expect:?}\n    state {state:?}\n}}\n"
    )
}

fn counting(goals: &str) -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "project.bla", COUNTING);
    write(root, "contracts/count.bla", COUNT);
    write(root, "app.py", APP);
    write(root, "goals.bla", goals);
    temp
}

fn classes(report: &Value) -> Vec<String> {
    report["grounded"]
        .as_array()
        .unwrap_or_else(|| panic!("no grounded list in {report}"))
        .iter()
        .map(|class| class.as_str().unwrap().to_owned())
        .collect()
}

fn reason<'a>(report: &'a Value, class: &str) -> Option<&'a str> {
    report["ungrounded"]
        .as_array()
        .unwrap_or_else(|| panic!("no ungrounded list in {report}"))
        .iter()
        .find(|pair| pair[0] == class)
        .and_then(|pair| pair[1].as_str())
}

fn challenged(temp: &TempDir) -> (Vec<String>, i32, Value) {
    let (report, code) = json_of(temp, &["challenge", "--json"]);
    assert!(report.get("task").is_none(), "{report}");
    (classes(&report), code, report)
}

fn evidence(report: &Value) -> Vec<String> {
    report["challenge"]["evidence"]
        .as_array()
        .unwrap_or_else(|| panic!("no challenge evidence in {report}"))
        .iter()
        .map(|line| line.as_str().unwrap().to_owned())
        .collect()
}

fn names_verdict(lines: &[String], identity: &str, verdict: Verdict) -> bool {
    lines
        .iter()
        .any(|line| line.contains(identity) && line.contains(verdict.word()))
}

fn expectation_verdicts(temp: &TempDir, id: &str) -> Vec<(String, String)> {
    let (view, code) = json_of(temp, &["explain", id, "--json"]);
    assert_eq!(code, 0, "{view}");
    verdicts(&view["outcome"])
}

fn open_task(temp: &TempDir, name: &str, goal: Option<&str>) -> (Value, i32) {
    let mut arguments = vec![
        "task",
        "open",
        name,
        "--role",
        "worker",
        "--statement",
        "serve a goal",
        "--deliverable",
        "out.txt",
        "--json",
    ];
    if let Some(goal) = goal {
        arguments.extend(["--goal", goal]);
    }
    json_of(temp, &arguments)
}

fn recorded(temp: &TempDir, name: &str) -> bool {
    let (shown, code) = json_of(temp, &["task", "show", name, "--json"]);
    match code {
        0 => true,
        2 => false,
        _ => panic!("task show {name} exited {code}: {shown}"),
    }
}

#[test]
fn the_project_wide_challenge_grounds_a_done_goal_with_a_red_or_unresolved_expectation() {
    let red = project_with(
        MANIFEST,
        &declaration("red", "done", &["arch::fields", "broken::no-fields"]),
    );
    let (grounded, code, report) = challenged(&red);
    assert_eq!(report["challenge"]["class"], GOAL_CLASS, "{report}");
    assert!(grounded.iter().any(|class| class == GOAL_CLASS), "{report}");
    assert_eq!(code, 1);
    let lines = evidence(&report);
    assert!(
        names_verdict(&lines, "broken::no-fields", Verdict::NotHeld),
        "{lines:?}"
    );
    assert!(
        !lines.iter().any(|line| line.contains("arch::fields")),
        "{lines:?}"
    );

    let unresolved = project_with(
        WITHOUT_MISSION,
        &declaration("unresolved", "done", &["arch::fields", "arch::unwritten"]),
    );
    let (grounded, code, report) = challenged(&unresolved);
    assert_eq!(grounded, [GOAL_CLASS], "{report}");
    assert_eq!(code, 1);
    assert!(
        names_verdict(&evidence(&report), "arch::unwritten", Verdict::Unresolved),
        "{report}"
    );

    write(
        unresolved.path(),
        "goals.bla",
        &declaration("unresolved", "active", &["arch::fields", "arch::unwritten"]),
    );
    let (grounded, code, report) = challenged(&unresolved);
    assert!(grounded.is_empty(), "{report}");
    assert_eq!(code, 0);
}

#[test]
fn a_done_goal_that_holds_and_a_dropped_or_active_goal_never_ground_the_challenge() {
    let held = project_with(
        WITHOUT_MISSION,
        &declaration("held", "done", &["arch::fields", "contract::arch"]),
    );
    let (grounded, code, report) = challenged(&held);
    assert!(grounded.is_empty(), "{report}");
    assert_eq!(code, 0);

    let red = ["arch::fields", "broken::no-fields"];
    let unpursued = project_with(
        MANIFEST,
        &format!(
            "{}{}",
            declaration("dropped", "dropped", &red),
            declaration("pending", "active", &red)
        ),
    );
    let (grounded, _, report) = challenged(&unpursued);
    assert!(!grounded.is_empty(), "{report}");
    assert!(
        !grounded.iter().any(|class| class == GOAL_CLASS),
        "{report}"
    );
}

#[test]
fn a_done_goal_whose_behavior_expectation_rests_on_a_stale_run_grounds_the_challenge() {
    let temp = counting(&declaration("counts", "active", &["count::adds-one"]));
    let (finished, code) = json_of(&temp, &["finish", "--json"]);
    assert_eq!(code, 0, "{finished}");
    let (grounded, code, report) = challenged(&temp);
    assert!(grounded.is_empty(), "{report}");
    assert_eq!(code, 0);

    write(
        temp.path(),
        "goals.bla",
        &declaration("counts", "done", &["count::adds-one"]),
    );
    let (status, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(status["state"], "stale", "{status}");
    let (grounded, _, report) = challenged(&temp);
    assert_eq!(report["challenge"]["class"], GOAL_CLASS, "{report}");
    assert!(grounded.iter().any(|class| class == GOAL_CLASS), "{report}");
    assert!(
        names_verdict(&evidence(&report), "count::adds-one", Verdict::Unverified),
        "{report}"
    );
}

#[test]
fn the_challenge_judges_goals_under_the_run_state_status_and_explain_use() {
    let temp = counting(&declaration("counts", "done", &["count::adds-one"]));
    let (finished, code) = json_of(&temp, &["finish", "--json"]);
    assert_eq!(code, 0, "{finished}");
    assert_eq!(
        expectation_verdicts(&temp, "goal::counts"),
        pairs(&[("count::adds-one", Verdict::Held)])
    );
    let (grounded, code, report) = challenged(&temp);
    assert!(grounded.is_empty(), "{report}");
    assert_eq!(code, 0);

    std::fs::write(marker_path(temp.path()), "{").unwrap();
    let (status, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(status["state"], "interrupted", "{status}");
    assert_eq!(
        expectation_verdicts(&temp, "goal::counts"),
        pairs(&[("count::adds-one", Verdict::Unverified)])
    );
    let (grounded, _, report) = challenged(&temp);
    assert!(grounded.iter().any(|class| class == GOAL_CLASS), "{report}");
}

#[test]
fn a_goal_memory_status_calls_invalid_grounds_no_challenge_and_declares_no_goal() {
    let valid = declaration("red", "done", &["broken::no-fields"]);
    let temp = project_with(MANIFEST, &valid);
    let (grounded, _, report) = challenged(&temp);
    assert!(grounded.iter().any(|class| class == GOAL_CLASS), "{report}");
    let unjudged = |memory: Memory<GoalMemory>| {
        let (status, _) = json_of(&temp, &["status", "--json"]);
        assert_eq!(status["goal_memory"]["state"], memory.state(), "{status}");
        let (grounded, _, report) = challenged(&temp);
        assert!(
            !grounded.iter().any(|class| class == GOAL_CLASS),
            "{report}"
        );
        let expected = skeptic::unjudged_goals(&memory);
        assert!(expected.is_some(), "{}", memory.state());
        assert_eq!(reason(&report, GOAL_CLASS), expected, "{report}");
    };

    write(
        temp.path(),
        "goals.bla",
        &valid.replacen("{\n", "{\n    serves [\"speed\"]\n", 1),
    );
    unjudged(Memory::Invalid(Vec::new()));
    let (explained, code) = json_of(&temp, &["explain", "goal::red", "--json"]);
    assert_eq!(code, 2, "{explained}");
    let (refusal, code) = open_task(&temp, "serving", Some("red"));
    assert_eq!(code, 2, "{refusal}");
    assert!(!recorded(&temp, "serving"));

    write(
        temp.path(),
        "goals.bla",
        &valid.replacen("{\n", "{\n    owner \"x\"\n", 1),
    );
    unjudged(Memory::Unreadable(String::new()));

    std::fs::remove_file(temp.path().join("goals.bla")).unwrap();
    unjudged(Memory::Missing(String::new()));
}

#[test]
fn a_blunt_project_speaks_the_goal_challenge_in_its_voice() {
    let temp = project_with(
        &format!("{MANIFEST}\nvoice blunt\n"),
        &declaration("red", "done", &["broken::no-fields"]),
    );
    let (report, _) = json_of(&temp, &["challenge", "--json"]);
    assert_eq!(report["challenge"]["class"], GOAL_CLASS, "{report}");
    let neutral = report["challenge"]["statement"].as_str().unwrap();
    let rendered = voice::contradiction(Voice::Blunt, GOAL_CLASS, neutral);
    assert!(voice::speaks_bluntly(&rendered), "{rendered}");
    let text = text_of(&temp, &["challenge"]);
    assert!(text.lines().any(|line| line == rendered), "{text}");
}

#[test]
fn task_open_refuses_a_goal_the_goal_memory_does_not_declare() {
    let temp = project();
    let (refusal, code) = open_task(&temp, "serving", Some("nope"));
    assert_eq!(code, 2, "{refusal}");
    let message = refusal["message"].as_str().unwrap();
    let words: BTreeSet<&str> = message
        .split(|character: char| !(character.is_alphanumeric() || "-_".contains(character)))
        .collect();
    for declared in ["verdicts", "contracts", "ready", "shipped", "abandoned"] {
        assert!(words.contains(declared), "{declared}: {message}");
    }
    assert!(!recorded(&temp, "serving"));

    let (opened, code) = open_task(&temp, "serving", Some("ready"));
    assert_eq!(code, 0, "{opened}");
    assert_eq!(opened["task"]["goal"], "ready");

    let unregistered = without_goal_file(WITHOUT_GOALS);
    let (refusal, code) = open_task(&unregistered, "serving", Some("ready"));
    assert_eq!(code, 2, "{refusal}");
    assert!(!recorded(&unregistered, "serving"));
}

#[test]
fn explain_lists_only_the_tasks_whose_record_names_the_goal() {
    let temp = project();
    for (name, goal) in [
        ("first", Some("ready")),
        ("second", Some("verdicts")),
        ("third", None),
    ] {
        let (opened, code) = open_task(&temp, name, goal);
        assert_eq!(code, 0, "{opened}");
    }
    let (ready, code) = json_of(&temp, &["explain", "goal::ready", "--json"]);
    assert_eq!(code, 0, "{ready}");
    assert_eq!(ready["serving_tasks"], json!([["first", "open"]]));
    let (verdicts, _) = json_of(&temp, &["explain", "goal::verdicts", "--json"]);
    assert_eq!(verdicts["serving_tasks"], json!([["second", "open"]]));
    let (shipped, _) = json_of(&temp, &["explain", "goal::shipped", "--json"]);
    assert!(shipped.get("serving_tasks").is_none(), "{shipped}");
}

#[test]
fn task_show_names_the_goal_a_task_serves_as_one_identity() {
    let temp = project();
    for (name, goal) in [("serving", Some("ready")), ("plain", None)] {
        let (opened, code) = open_task(&temp, name, goal);
        assert_eq!(code, 0, "{opened}");
    }
    let text = text_of(&temp, &["task", "show", "serving"]);
    let served: Vec<&str> = text
        .lines()
        .filter_map(|line| line.strip_prefix("Serves "))
        .collect();
    assert_eq!(served.len(), 1, "{text}");
    let (explained, code) = json_of(&temp, &["explain", served[0], "--json"]);
    assert_eq!(code, 0, "{explained}");
    assert_eq!(explained["id"], "goal::ready");
    let (shown, _) = json_of(&temp, &["task", "show", "serving", "--json"]);
    assert_eq!(shown["task"]["goal"], "ready");

    let text = text_of(&temp, &["task", "show", "plain"]);
    assert!(
        !text.lines().any(|line| line.starts_with("Serves ")),
        "{text}"
    );
    let (shown, code) = json_of(&temp, &["task", "show", "plain", "--json"]);
    assert_eq!(code, 0, "{shown}");
    assert!(shown["task"].get("goal").is_none(), "{shown}");
}

#[test]
fn finish_carries_the_same_standing_challenge_with_or_without_goals() {
    let red = declaration("red", "done", &["broken::no-fields"]);
    let with = project_with(STRUCTURE_ONLY, &red);
    let (grounded, _, report) = challenged(&with);
    assert!(grounded.iter().any(|class| class == GOAL_CLASS), "{report}");

    let without = project_with(STRUCTURE_ONLY_WITHOUT_GOALS, &red);
    let (finished, _) = json_of(&with, &["finish", "--json"]);
    let (bare, _) = json_of(&without, &["finish", "--json"]);
    assert!(
        !classes(&finished["challenge"])
            .iter()
            .any(|class| class == GOAL_CLASS),
        "{finished}"
    );
    assert_eq!(
        reason(&finished["challenge"], GOAL_CLASS),
        Some(skeptic::GOALS_NOT_JUDGED),
        "{finished}"
    );
    assert_eq!(finished["challenge"], bare["challenge"]);
}
