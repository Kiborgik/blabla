use serde_json::{Value, json};
use std::path::Path;
use tempfile::TempDir;

use crate::interpreter;
use crate::support::{self, write};

fn cli(root: &Path, args: &[&str]) -> (i32, Value) {
    let mut argv = vec!["--json"];
    argv.extend(args);
    let output = support::run_in(Some(root), &support::args(&argv));
    let value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        json!({"stdout":String::from_utf8_lossy(&output.stdout), "stderr":String::from_utf8_lossy(&output.stderr)})
    });
    (output.status.code().unwrap(), value)
}

fn ok(root: &Path, args: &[&str]) -> Value {
    let (exit, value) = cli(root, args);
    assert_eq!(exit, 0, "{args:?}: {value}");
    value
}

fn task(root: &Path, name: &str) -> Value {
    ok(root, &["task", "show", name])["task"].clone()
}

fn fixture() -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "project.bla",
        "project Recovery\nuse structure \"entry.bla\"\nuse behavior \"counter.bla\"\nprocess \"process.bla\"\n",
    );
    write(
        root,
        "entry.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(
        root,
        "counter.bla",
        "state count: int\naction increment()\nwhen increment { expect \"one\": after.count == before.count + 1 }\n",
    );
    write(root, "src/app.rs", "pub fn run() {}\n");
    write(
        root,
        "process.bla",
        "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\nrole \"reviewer\" { purpose \"Review\" model \"reviewer\" }\n",
    );
    write(
        root,
        "check.py",
        "from pathlib import Path\np=Path('.blabla/check-count')\np.write_text(str(int(p.read_text())+1) if p.exists() else '1')\nassert 'pub fn run' in Path('src/app.rs').read_text()\n",
    );
    ok(
        root,
        &[
            "task",
            "open",
            "work",
            "--role",
            "worker",
            "--statement",
            "Retain the source entry",
            "--scope",
            "src",
            "--input",
            "src",
            "check.py",
            "--check",
            interpreter::python(),
            "check.py",
        ],
    );
    ok(root, &["task", "accept", "work", "--model", "worker"]);
    ok(root, &["task", "evidence", "work", "--run"]);
    ready(root, "work");
    temp
}

fn ready(root: &Path, name: &str) {
    let report = ok(root, &["challenge", name]);
    assert_eq!(report["assignment_clear"], true, "{report}");
    ok(root, &["task", "ready", name]);
}

fn inspect(root: &Path, name: &str, clear: bool, action: &str) -> Value {
    let before = support::tree_snapshot(root);
    let (exit, report) = cli(root, &["challenge", name]);
    assert_eq!(exit, if clear { 0 } else { 1 }, "{report}");
    assert_eq!(report["assignment_clear"], clear, "{report}");
    let recovery = &report["assignment_recovery"];
    assert_eq!(recovery["action"], action, "{report}");
    assert_eq!(recovery["authority"], "diagnostic-only");
    let guidance = recovery["guidance"].as_str().unwrap();
    let text = support::run_in(Some(root), &support::args(&["challenge", name]));
    assert_eq!(text.status.code(), Some(exit));
    assert!(String::from_utf8_lossy(&text.stdout).contains(guidance));
    let (ready_exit, refusal) = cli(root, &["task", "ready", name]);
    assert_eq!(ready_exit, 2, "{refusal}");
    assert!(
        refusal["message"].as_str().unwrap().contains(guidance),
        "{refusal}"
    );
    assert_eq!(
        support::tree_snapshot(root),
        before,
        "inspection and refused hand-back must not run checks, rewrite receipts or advance acceptance"
    );
    report
}

#[test]
fn current_ready_waits_for_review_despite_project_wide_verification_challenge() {
    let temp = fixture();
    let report = inspect(temp.path(), "work", true, "await-review");
    assert!(report["assignment_recovery"]["blocker"].is_null());
    assert!(
        report["project_challenges"]
            .as_array()
            .unwrap()
            .iter()
            .any(|class| class == "verification-not-current")
    );
    let view = ok(temp.path(), &["task", "show", "work"]);
    assert_eq!(view["task"]["state"], "ready");
    assert!(
        view["routes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|route| route == "challenge")
    );
}

#[test]
fn changed_execution_inputs_require_resume_and_new_verification_without_running_it() {
    let temp = fixture();
    write(temp.path(), "src/app.rs", "pub fn run() -> u8 { 1 }\n");
    let report = inspect(temp.path(), "work", false, "resume-and-verify");
    assert_eq!(
        report["assignment_recovery"]["blocker"],
        "evidence-superseded"
    );
    assert_eq!(
        std::fs::read_to_string(temp.path().join(".blabla/check-count")).unwrap(),
        "1"
    );
    assert_eq!(task(temp.path(), "work")["state"], "ready");
}

#[test]
fn stale_challenge_without_assignment_blockers_requires_resume_not_waiting_for_review() {
    let temp = fixture();
    ok(
        temp.path(),
        &[
            "task",
            "statement",
            "work",
            "Reassess the retained entry",
            "--model",
            "owner",
        ],
    );
    let report = inspect(temp.path(), "work", false, "resume-task");
    assert!(
        report["assignment_blockers"].as_array().unwrap().is_empty(),
        "{report}"
    );
    assert!(report["assignment_recovery"]["blocker"].is_null());
}

fn review_fixture() -> TempDir {
    let temp = fixture();
    let root = temp.path();
    write(root, "reviews/review.md", "Inspected the source entry.\n");
    ok(
        root,
        &[
            "task",
            "open",
            "review",
            "--role",
            "reviewer",
            "--statement",
            "Inspect source",
            "--scope",
            "reviews/review.md",
            "--review-of",
            "work",
            "--input",
            "src",
            "check.py",
            "reviews/review.md",
            "--check",
            interpreter::python(),
            "check.py",
        ],
    );
    ok(root, &["task", "accept", "review", "--model", "reviewer"]);
    ok(root, &["task", "evidence", "review", "--run"]);
    ready(root, "review");
    temp
}

#[test]
fn changed_review_target_offers_explicit_guarded_reuse_without_claiming_eligibility() {
    let temp = review_fixture();
    let root = temp.path();
    ok(root, &["task", "accept", "work", "--model", "worker"]);
    let report = inspect(root, "review", false, "inspect-review-target");
    assert_eq!(
        report["assignment_recovery"]["blocker"],
        "review-target-stale"
    );
    let before = task(root, "review");
    ok(
        root,
        &[
            "task",
            "accept",
            "review",
            "--model",
            "reviewer",
            "--reuse-evidence",
            "--reason",
            "Original execution inputs are unchanged; inspect the renewed source account separately",
        ],
    );
    let after = task(root, "review");
    assert_eq!(
        after["acceptance_epoch"].as_u64(),
        Some(before["acceptance_epoch"].as_u64().unwrap() + 1)
    );
    assert_eq!(after["evidence"][0], before["evidence"][0]);
    assert_eq!(
        std::fs::read_to_string(root.join(".blabla/check-count")).unwrap(),
        "2"
    );
}

#[test]
fn changed_review_execution_does_not_offer_reuse_as_a_shortcut() {
    let temp = review_fixture();
    let root = temp.path();
    ok(root, &["task", "accept", "work", "--model", "worker"]);
    write(root, "src/app.rs", "pub fn run() -> u8 { 2 }\n");
    let report = inspect(root, "review", false, "resume-and-verify");
    assert_eq!(
        report["assignment_recovery"]["blocker"],
        "evidence-superseded"
    );
}

#[test]
fn unresolved_findings_keep_the_authoritative_reconciliation_and_owner_boundary() {
    let temp = fixture();
    ok(
        temp.path(),
        &[
            "task",
            "finding",
            "work",
            "The owner must settle the changed boundary",
        ],
    );
    let report = inspect(temp.path(), "work", false, "resolve-assignment-blocker");
    assert_eq!(
        report["assignment_recovery"]["blocker"],
        "unresolved-finding"
    );
    assert!(
        report["assignment_recovery"]["guidance"]
            .as_str()
            .unwrap()
            .contains(report["challenge"]["reconcile"].as_str().unwrap())
    );
}
