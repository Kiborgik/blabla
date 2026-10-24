use serde_json::{Value, json};
use std::path::Path;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;

fn write(root: &Path, path: &str, text: &str) {
    let path = root.join(path);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn cli(temp: &TempDir, args: &[&str]) -> (i32, Value) {
    let mut arguments = vec!["--json"];
    arguments.extend(args);
    let output = support::run_in(Some(temp.path()), &support::args(&arguments));
    let value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        json!({"stdout": String::from_utf8_lossy(&output.stdout), "stderr": String::from_utf8_lossy(&output.stderr)})
    });
    (output.status.code().unwrap(), value)
}

fn success(temp: &TempDir, args: &[&str]) -> Value {
    let (exit, value) = cli(temp, args);
    assert_eq!(exit, 0, "{args:?}: {value}");
    value
}

fn fixture() -> TempDir {
    let temp = TempDir::new().unwrap();
    write(
        temp.path(),
        "project.bla",
        "project Reflection\nuse structure \"entry.bla\"\nprocess \"process.bla\"\ngoal \"goals.bla\"\nsystem \"system.bla\"\n",
    );
    write(
        temp.path(),
        "process.bla",
        "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\nrole \"reviewer\" { purpose \"Review\" model \"reviewer\" }\n",
    );
    write(
        temp.path(),
        "goals.bla",
        "goal \"deliver\" { statement \"Make the entry useful\" expect [\"contract::entry\"] state \"active\" }\n",
    );
    write(
        temp.path(),
        "system.bla",
        "system \"app\" { purpose \"Own the entry\" paths [\"src/\"] }\nsystem \"other\" { purpose \"Independent\" paths [\"other/\"] }\n",
    );
    write(
        temp.path(),
        "entry.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(temp.path(), "src/app.rs", "pub fn run() {}\n");
    write(temp.path(), "src/extra.rs", "pub fn extra() {}\n");
    write(temp.path(), "check.py", "raise SystemExit(0)\n");
    success(
        &temp,
        &[
            "task",
            "open",
            "work",
            "--role",
            "worker",
            "--statement",
            "Improve the entry",
            "--scope",
            "src",
            "--goal",
            "deliver",
            "--input",
            "src/app.rs",
            "check.py",
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    temp
}

fn require(temp: &TempDir, intent: bool) {
    let path = temp.path().join(".blabla/tasks/work.json");
    let mut record: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    record["goal_reflection_required"] = json!(true);
    if intent {
        record["intent_disposition_required"] = json!(true);
    }
    std::fs::write(path, serde_json::to_vec_pretty(&record).unwrap()).unwrap();
}

fn show(temp: &TempDir) -> Value {
    success(temp, &["task", "show", "work"])
}
fn evidence(temp: &TempDir) {
    success(temp, &["task", "evidence", "work", "--run"]);
}

fn reflect(temp: &TempDir, outcome: &str, extra: &[&str]) -> (i32, Value) {
    let mut args = vec![
        "task",
        "reflect",
        "work",
        "--outcome",
        outcome,
        "--decision",
        "The entry now exposes its result",
        "--observation",
        "The real declared check passed and src/app.rs remains callable",
        "--evidence-ref",
        "src/app.rs",
        "--reason",
        "The observed entry behavior now permits this bounded next decision",
        "--model",
        "worker",
    ];
    args.extend(extra);
    cli(temp, &args)
}

fn reflected(temp: &TempDir, outcome: &str, extra: &[&str]) {
    let (exit, value) = reflect(temp, outcome, extra);
    assert_eq!(exit, 0, "{value}");
    assert_eq!(show(temp)["goal_reflection_state"], "current");
}

#[test]
fn required_reflection_is_a_real_lifecycle_obligation_not_a_note() {
    let temp = fixture();
    require(&temp, false);
    evidence(&temp);
    success(
        &temp,
        &["task", "note", "work", "We should think about the goal"],
    );
    assert_eq!(show(&temp)["goal_reflection_state"], "missing");
    let (exit, report) = cli(&temp, &["challenge", "work"]);
    assert_eq!(exit, 1);
    assert!(
        report.to_string().contains("goal-reflection-missing"),
        "{report}"
    );
    assert_ne!(cli(&temp, &["task", "ready", "work"]).0, 0);
    reflected(&temp, "no-useful-successor", &[]);
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
    success(&temp, &["task", "close", "work", "--model", "owner"]);
}

#[test]
fn four_terminal_outcomes_preserve_goal_authority_and_create_no_work() {
    let options = [
        (
            "successor",
            vec![
                "--recommendation",
                "Add one result assertion in src/app.rs",
                "--owner",
                "role::worker",
                "--dependency",
                "owner approves the focused successor",
                "--observable-outcome",
                "The result assertion fails when the result is wrong",
            ],
        ),
        (
            "blocked",
            vec![
                "--blocker",
                "The owner has not defined the desired result",
                "--owner",
                "project owner",
                "--unblock-when",
                "The owner states the expected result",
            ],
        ),
        ("completion-recommended", vec![]),
        ("no-useful-successor", vec![]),
    ];
    for (outcome, fields) in options {
        let temp = fixture();
        require(&temp, false);
        evidence(&temp);
        let goals = std::fs::read(temp.path().join("goals.bla")).unwrap();
        reflected(&temp, outcome, &fields);
        assert_eq!(
            show(&temp)["task"]["goal_reflection"]["outcome"]["kind"],
            outcome
        );
        assert_eq!(std::fs::read(temp.path().join("goals.bla")).unwrap(), goals);
        assert_eq!(
            std::fs::read_dir(temp.path().join(".blabla/tasks"))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "json"))
                .count(),
            1
        );
        assert!(!temp.path().join(".blabla/status.json").exists());
    }
}

#[test]
fn opt_in_requires_named_goal_and_old_tasks_keep_their_behavior() {
    let temp = fixture();
    assert!(show(&temp)["goal_reflection_state"].is_null());
    evidence(&temp);
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
    let (exit, value) = cli(
        &temp,
        &[
            "task",
            "open",
            "missing-goal",
            "--role",
            "worker",
            "--statement",
            "A feature",
            "--scope",
            "other",
            "--require-goal-reflection",
        ],
    );
    assert_ne!(exit, 0);
    assert!(value.to_string().contains("goal"));
    let opened = success(
        &temp,
        &[
            "task",
            "open",
            "linked",
            "--role",
            "worker",
            "--statement",
            "A feature",
            "--scope",
            "other",
            "--goal",
            "deliver",
            "--require-goal-reflection",
        ],
    );
    assert_eq!(opened["task"]["goal_reflection_required"], true);
}

#[test]
fn reflection_rejects_missing_content_unrelated_fields_and_wrong_actor_or_state() {
    let temp = fixture();
    assert_ne!(reflect(&temp, "no-useful-successor", &[]).0, 0);
    require(&temp, false);
    assert_ne!(reflect(&temp, "successor", &[]).0, 0);
    assert_ne!(reflect(&temp, "blocked", &[]).0, 0);
    assert_ne!(reflect(&temp, "invented", &[]).0, 0);
    assert_ne!(
        reflect(&temp, "no-useful-successor", &["--owner", "irrelevant"]).0,
        0
    );
    let args = [
        "task",
        "reflect",
        "work",
        "--outcome",
        "no-useful-successor",
        "--decision",
        " ",
        "--observation",
        "Observed result",
        "--evidence-ref",
        "src/app.rs",
        "--reason",
        "Enough",
        "--model",
        "worker",
    ];
    assert_ne!(cli(&temp, &args).0, 0);
    let mut wrong_actor = args;
    wrong_actor[6] = "Changed result";
    wrong_actor[14] = "stranger";
    assert_ne!(cli(&temp, &wrong_actor).0, 0);
    success(&temp, &["task", "block", "work", "Await owner input"]);
    assert_ne!(reflect(&temp, "no-useful-successor", &[]).0, 0);
}

#[test]
fn source_intent_evidence_and_epoch_changes_stale_the_reflection() {
    let temp = fixture();
    require(&temp, false);
    evidence(&temp);
    reflected(&temp, "no-useful-successor", &[]);
    write(temp.path(), "src/extra.rs", "pub fn changed() {}\n");
    assert_eq!(show(&temp)["goal_reflection_state"], "stale");
    reflected(&temp, "no-useful-successor", &[]);
    write(
        temp.path(),
        "goals.bla",
        "goal \"deliver\" { statement \"A changed expected outcome\" expect [\"contract::entry\"] state \"active\" }\n",
    );
    assert_eq!(show(&temp)["goal_reflection_state"], "stale");
    reflected(&temp, "no-useful-successor", &[]);
    evidence(&temp);
    assert_eq!(show(&temp)["goal_reflection_state"], "stale");
    reflected(&temp, "no-useful-successor", &[]);
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    assert_eq!(show(&temp)["goal_reflection_state"], "stale");
}

#[test]
fn unrelated_system_changes_do_not_force_busywork() {
    let temp = fixture();
    require(&temp, false);
    evidence(&temp);
    reflected(&temp, "no-useful-successor", &[]);
    write(
        temp.path(),
        "system.bla",
        "system \"app\" { purpose \"Own the entry\" paths [\"src/\"] }\nsystem \"other\" { purpose \"An unrelated amended purpose\" paths [\"other/\"] }\n",
    );
    assert_eq!(show(&temp)["goal_reflection_state"], "current");
}

#[test]
fn disposition_changes_stale_reflection_without_mutual_self_staling() {
    let temp = fixture();
    require(&temp, true);
    evidence(&temp);
    let identities: Vec<String> = show(&temp)["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["identity"].as_str().unwrap().to_owned())
        .collect();
    for identity in &identities {
        success(
            &temp,
            &[
                "task",
                "disposition",
                "work",
                identity,
                "--status",
                "confirmed-unchanged",
                "--reason",
                "The callable entry preserves this boundary",
                "--model",
                "worker",
            ],
        );
    }
    reflected(&temp, "no-useful-successor", &[]);
    assert_eq!(show(&temp)["intent_disposition_current"], true);
    success(
        &temp,
        &[
            "task",
            "disposition",
            "work",
            &identities[0],
            "--status",
            "confirmed-unchanged",
            "--reason",
            "A more precise inspection of the callable entry",
            "--model",
            "worker",
        ],
    );
    assert_eq!(show(&temp)["goal_reflection_state"], "stale");
    reflected(&temp, "no-useful-successor", &[]);
    assert_eq!(show(&temp)["intent_disposition_current"], true);
}

#[test]
fn reflection_changes_invalidate_challenge_and_review_receipts() {
    let temp = fixture();
    require(&temp, false);
    evidence(&temp);
    reflected(&temp, "no-useful-successor", &[]);
    success(&temp, &["challenge", "work"]);
    success(
        &temp,
        &[
            "task",
            "open",
            "review",
            "--role",
            "reviewer",
            "--statement",
            "Review the reflection",
            "--review-of",
            "work",
            "--scope",
            "reviews",
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    success(&temp, &["task", "accept", "review", "--model", "reviewer"]);
    assert_eq!(
        success(&temp, &["task", "show", "review"])["review_current"],
        true
    );
    reflected(&temp, "completion-recommended", &[]);
    assert!(show(&temp)["task"]["challenged"].is_null());
    assert_eq!(
        success(&temp, &["task", "show", "review"])["review_current"],
        false
    );
}

#[test]
fn every_common_field_and_each_evidence_reference_must_be_nonblank() {
    let temp = fixture();
    require(&temp, false);
    let args = [
        "task",
        "reflect",
        "work",
        "--outcome",
        "no-useful-successor",
        "--decision",
        "New consequence",
        "--observation",
        "Observed result",
        "--evidence-ref",
        "src/app.rs",
        "--reason",
        "A causal reason to stop",
        "--model",
        "worker",
    ];
    for index in [6, 8, 10, 12] {
        let mut blank = args;
        blank[index] = "  ";
        let (exit, value) = cli(&temp, &blank);
        assert_eq!(exit, 2, "{value}");
        assert!(value["message"].as_str().unwrap().contains("concrete"));
    }
    assert_eq!(show(&temp)["goal_reflection_state"], "missing");
    let (exit, value) = reflect(
        &temp,
        "successor",
        &[
            "--recommendation",
            "One scoped assertion",
            "--owner",
            "role::worker",
            "--observable-outcome",
            "Wrong results fail",
            "--dependency",
            " ",
        ],
    );
    assert_eq!(exit, 2, "{value}");
}

#[test]
fn a_reflection_never_replaces_a_real_failing_check() {
    let temp = fixture();
    require(&temp, false);
    evidence(&temp);
    reflected(&temp, "completion-recommended", &[]);
    write(temp.path(), "check.py", "raise SystemExit(1)\n");
    evidence(&temp);
    assert_eq!(show(&temp)["goal_reflection_state"], "stale");
    let (exit, value) = cli(
        &temp,
        &[
            "task",
            "reflect",
            "work",
            "--outcome",
            "blocked",
            "--decision",
            "A failing check prevents the next step",
            "--observation",
            "The declared check actually exited 1",
            "--evidence-ref",
            "check.py",
            "--reason",
            "Resolve the failure before claiming a deliverable",
            "--blocker",
            "Declared check failed",
            "--owner",
            "role::worker",
            "--unblock-when",
            "The repaired check passes",
            "--model",
            "worker",
        ],
    );
    assert_eq!(exit, 0, "{value}");
    assert_eq!(show(&temp)["goal_reflection_state"], "current");
    let (exit, report) = cli(&temp, &["challenge", "work"]);
    assert_eq!(exit, 1);
    assert!(
        report["assignment_blockers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "declared-check-failed")
    );
    assert_ne!(cli(&temp, &["task", "ready", "work"]).0, 0);
}

#[test]
fn removed_goal_stales_the_record_and_cannot_be_reflected_as_declared() {
    let temp = fixture();
    require(&temp, false);
    reflected(&temp, "no-useful-successor", &[]);
    write(
        temp.path(),
        "goals.bla",
        "goal \"other\" { statement \"Another goal\" expect [\"contract::entry\"] state \"active\" }\n",
    );
    assert_eq!(show(&temp)["goal_reflection_state"], "stale");
    let (exit, value) = reflect(&temp, "no-useful-successor", &[]);
    assert_eq!(exit, 2);
    assert!(value["message"].as_str().unwrap().contains("not declared"));
}

#[test]
fn a_goal_change_after_hand_back_blocks_closure() {
    let temp = fixture();
    require(&temp, false);
    evidence(&temp);
    reflected(&temp, "completion-recommended", &[]);
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
    write(
        temp.path(),
        "goals.bla",
        "goal \"deliver\" { statement \"A changed owner outcome\" expect [\"contract::entry\"] state \"active\" }\n",
    );
    let (exit, report) = cli(&temp, &["challenge", "work"]);
    assert_eq!(exit, 1);
    assert!(
        report["assignment_blockers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "goal-reflection-missing")
    );
    assert_ne!(
        cli(&temp, &["task", "close", "work", "--model", "owner"]).0,
        0
    );
}

#[test]
fn human_and_json_views_expose_the_same_claim_and_freshness() {
    let temp = fixture();
    require(&temp, false);
    reflected(
        &temp,
        "blocked",
        &[
            "--blocker",
            "Missing owner outcome",
            "--owner",
            "project owner",
            "--unblock-when",
            "Expected result is stated",
        ],
    );
    let report = show(&temp);
    let output = support::run_in(Some(temp.path()), &support::args(&["task", "show", "work"]));
    assert!(output.status.success());
    let human = String::from_utf8(output.stdout).unwrap();
    assert!(human.contains("Goal reflection: REQUIRED (CURRENT)"));
    let reflection = &report["task"]["goal_reflection"];
    for field in ["decision", "observation", "reason"] {
        assert!(human.contains(reflection[field].as_str().unwrap()));
    }
    assert!(human.contains("Missing owner outcome"));
    assert!(human.contains("Expected result is stated"));
}

#[test]
fn assignment_amendment_invalidates_a_previous_reflection() {
    let temp = fixture();
    require(&temp, false);
    reflected(&temp, "no-useful-successor", &[]);
    success(
        &temp,
        &[
            "task",
            "statement",
            "work",
            "An amended bounded result",
            "--model",
            "owner",
        ],
    );
    assert_eq!(show(&temp)["goal_reflection_state"], "stale");
}
