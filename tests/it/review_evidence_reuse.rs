use crate::interpreter;
use crate::support::{self, tree_snapshot, write};
use serde_json::{Value, json};
use std::path::Path;
use tempfile::TempDir;

fn cli(root: &Path, args: &[&str]) -> (i32, Value) {
    let mut argv = vec!["--json"];
    argv.extend(args);
    let out = support::run_in(Some(root), &support::args(&argv));
    let value = serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|_| json!({"stderr":String::from_utf8_lossy(&out.stderr)}));
    (out.status.code().unwrap(), value)
}
fn ok(root: &Path, args: &[&str]) -> Value {
    let (code, value) = cli(root, args);
    assert_eq!(code, 0, "{args:?}: {value}");
    value
}
fn record(root: &Path, name: &str) -> Value {
    ok(root, &["task", "show", name])["task"].clone()
}
fn reuse(root: &Path) -> Value {
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
    )
}
fn refused(root: &Path, model: &str) {
    let before = tree_snapshot(root);
    let (code, value) = cli(
        root,
        &[
            "task",
            "accept",
            "review",
            "--model",
            model,
            "--reuse-evidence",
            "--reason",
            "Inspect exact original execution",
        ],
    );
    assert_eq!(code, 2, "{value}");
    assert_eq!(
        value["category"], "task",
        "must be a lifecycle refusal, not missing-option failure: {value}"
    );
    assert_eq!(tree_snapshot(root), before);
}
fn ready(root: &Path, name: &str) {
    let (_, result) = cli(root, &["challenge", name]);
    assert_eq!(result["assignment_clear"], true, "{result}");
    ok(root, &["task", "ready", name]);
}
const PROCESS: &str = "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\nrole \"reviewer\" { purpose \"Review\" model \"reviewer\" }\n";
fn fixture() -> TempDir {
    fixture_with(PROCESS)
}
fn fixture_with(process: &str) -> TempDir {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    write(
        root,
        "project.bla",
        "project Reuse\nuse structure \"entry.bla\"\nprocess \"process.bla\"\n",
    );
    write(
        root,
        "entry.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(root, "src/app.rs", "pub fn run() {}\n");
    write(root, "reviews/review.md", "Inspected bounded source.\n");
    write(root, "process.bla", process);
    write(
        root,
        "check.py",
        "from pathlib import Path\np=Path('.blabla/runs')\np.write_text(str(int(p.read_text())+1) if p.exists() else '1')\nprint('actual checked source')\nraise SystemExit(9 if Path('.blabla/fail').exists() else 0)\n",
    );
    write(root, "src2/app.rs", "pub fn second() {}\n");
    ok(
        root,
        &[
            "task",
            "open",
            "source",
            "--role",
            "worker",
            "--statement",
            "Implement source",
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
    ok(root, &["task", "accept", "source", "--model", "worker"]);
    ok(root, &["task", "evidence", "source", "--run"]);
    ready(root, "source");
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
            "source",
            "--input",
            "src",
            "src2",
            "check.py",
            "reviews/review.md",
            "--check",
            interpreter::python(),
            "check.py",
        ],
    );
    ok(root, &["task", "accept", "review", "--model", "reviewer"]);
    ok(root, &["task", "evidence", "review", "--run"]);
    tmp
}
fn repin_source(root: &Path) {
    ok(root, &["task", "accept", "source", "--model", "worker"]);
}

#[test]
fn accepted_and_ready_review_reuse_keeps_original_execution_and_advances_epoch() {
    for was_ready in [false, true] {
        let t = fixture();
        let root = t.path();
        if was_ready {
            ready(root, "review");
        }
        let before = record(root, "review");
        let run = before["evidence"][0].clone();
        let counter = std::fs::read(root.join(".blabla/runs")).unwrap();
        repin_source(root);
        let source = record(root, "source");
        reuse(root);
        let after = record(root, "review");
        assert_eq!(
            after["acceptance_epoch"].as_u64(),
            Some(before["acceptance_epoch"].as_u64().unwrap() + 1)
        );
        assert_eq!(after["evidence"][0], run);
        let reused = &after["evidence"][1];
        for field in [
            "identity",
            "command",
            "inputs",
            "unix",
            "log",
            "exit",
            "tree",
            "member_manifest",
        ] {
            assert_eq!(reused[field], run[field], "{field}");
        }
        assert_eq!(reused["tool"], "reuse");
        assert_eq!(reused["reuse"]["original_index"], 0);
        assert_eq!(reused["reuse"]["original_epoch"], run["acceptance_epoch"]);
        assert_eq!(reused["reuse"]["model"], "reviewer");
        assert_eq!(run["member_manifest"]["capture"], "execution-start");
        let mut recorded = run.clone();
        recorded.as_object_mut().unwrap().remove("executed");
        let original: blabla::project::task::Evidence = serde_json::from_value(recorded).unwrap();
        let mut digest = blabla::project::Fnv::new();
        digest.write_str("task-memory-v1");
        digest.write_str(&serde_json::to_string(&original).unwrap());
        assert_eq!(reused["reuse"]["original_digest"], digest.finish());
        assert_eq!(after["state"], "accepted");
        assert!(after["challenged"].is_null());
        assert_ne!(after["review_of"], before["review_of"]);
        assert_eq!(record(root, "source"), source);
        assert_eq!(std::fs::read(root.join(".blabla/runs")).unwrap(), counter);
        let shown = ok(root, &["task", "show", "review"]);
        let project = blabla::project::load(
            blabla::project::read_manifest(&root.join("project.bla")).unwrap(),
        )
        .unwrap();
        let stored: blabla::project::task::Task =
            serde_json::from_value(shown["task"].clone()).unwrap();
        let tree = blabla::project::snapshot(root, &project.ignore);
        assert!(blabla::project::task::readiness(&stored, &tree).supported);
        refused(root, "reviewer");
    }
}
#[test]
fn default_accept_of_a_review_does_not_carry_executed_evidence() {
    let t = fixture();
    let root = t.path();
    let before = record(root, "review");
    repin_source(root);
    ok(root, &["task", "accept", "review", "--model", "reviewer"]);
    assert_eq!(record(root, "review")["evidence"], before["evidence"]);
    let (_, v) = cli(root, &["challenge", "review"]);
    assert_eq!(v["assignment_clear"], false, "{v}");
}

#[test]
fn reuse_admits_a_reviewer_model_the_role_lists_as_a_family() {
    let t = fixture_with(&PROCESS.replace("model \"reviewer\"", "model [\"review*\"]"));
    let root = t.path();
    repin_source(root);
    let after = reuse(root)["task"].clone();
    assert_eq!(after["evidence"][1]["reuse"]["original_index"], 0);
    assert_eq!(after["evidence"][1]["reuse"]["model"], "reviewer");
}
#[test]
fn changed_complete_input_map_refuses_without_writes() {
    for path in ["src/app.rs", "reviews/review.md", "check.py"] {
        let t = fixture();
        write(t.path(), path, "changed\n");
        refused(t.path(), "reviewer");
    }
}

#[test]
fn evidence_member_manifest_unchanged_owned_leaf_does_not_rescue_changed_broad_input() {
    let t = fixture();
    let root = t.path();
    let before = record(root, "review");
    let owned = std::fs::read(root.join("src/app.rs")).unwrap();
    write(
        root,
        "src/unowned.rs",
        "another tracked leaf under the selected root",
    );
    let view = ok(root, &["task", "freshness", "review"]);
    assert_eq!(view["receipts"][0]["state"], "stale");
    assert_eq!(
        before["evidence"][0]["member_manifest"]["availability"],
        "complete"
    );
    assert_eq!(std::fs::read(root.join("src/app.rs")).unwrap(), owned);
    refused(root, "reviewer");
}
#[test]
fn changed_check_and_uncovered_target_scope_refuse() {
    for case in ["scope", "check", "narrowed-inputs"] {
        let t = fixture();
        let root = t.path();
        if case == "narrowed-inputs" {
            ok(
                root,
                &[
                    "task",
                    "check",
                    "review",
                    "--model",
                    "owner",
                    "--input",
                    "src",
                    "check.py",
                    "--check",
                    interpreter::python(),
                    "check.py",
                ],
            );
        } else if case == "check" {
            ok(
                root,
                &[
                    "task",
                    "check",
                    "review",
                    "--model",
                    "owner",
                    "--input",
                    "src",
                    "check.py",
                    "reviews/review.md",
                    "--check",
                    interpreter::python(),
                    "-c",
                    "pass",
                ],
            );
        } else {
            write(root, "extra/file.rs", "new source");
            ok(
                root,
                &[
                    "task", "scope", "source", "--add", "extra", "--model", "owner",
                ],
            );
        }
        refused(root, "reviewer");
    }
}
#[test]
fn missing_input_or_log_refuses() {
    for log in [false, true] {
        let t = fixture();
        let root = t.path();
        let r = record(root, "review");
        let path = if log {
            r["evidence"][0]["log"].as_str().unwrap()
        } else {
            "src/app.rs"
        };
        std::fs::remove_file(root.join(path)).unwrap();
        refused(root, "reviewer");
    }
}
#[test]
fn wrong_or_revoked_model_and_blank_reason_refuse() {
    let t = fixture();
    refused(t.path(), "worker");
    let before = tree_snapshot(t.path());
    let (code, v) = cli(
        t.path(),
        &[
            "task",
            "accept",
            "review",
            "--model",
            "reviewer",
            "--reuse-evidence",
            "--reason",
            "  ",
        ],
    );
    assert_eq!(code, 2);
    assert_eq!(v["category"], "task");
    assert_eq!(tree_snapshot(t.path()), before);
    write(
        t.path(),
        "process.bla",
        "role \"reviewer\" { purpose \"Review\" model \"replacement\" }\n",
    );
    refused(t.path(), "reviewer");
}
#[test]
fn latest_failed_run_is_not_bypassed_by_earlier_success() {
    let t = fixture();
    let root = t.path();
    write(root, ".blabla/fail", "fail");
    ok(root, &["task", "evidence", "review", "--run"]);
    assert_eq!(record(root, "review")["evidence"][1]["exit"], 9);
    refused(root, "reviewer");
}
#[test]
fn manual_receipt_cannot_be_promoted_to_an_execution() {
    let t = fixture();
    let root = t.path();
    ok(
        root,
        &[
            "task",
            "check",
            "review",
            "--model",
            "owner",
            "--input",
            "src",
            "check.py",
            "reviews/review.md",
            "--check",
            "manual source check",
        ],
    );
    ok(root, &["task", "accept", "review", "--model", "reviewer"]);
    ok(
        root,
        &[
            "task", "evidence", "review", "--exit", "0", "--tool", "check",
        ],
    );
    refused(root, "reviewer");
}
#[test]
fn non_review_and_falsification_tasks_refuse() {
    let t = fixture();
    let root = t.path();
    let before = tree_snapshot(root);
    let (code, v) = cli(
        root,
        &[
            "task",
            "accept",
            "source",
            "--model",
            "worker",
            "--reuse-evidence",
            "--reason",
            "same run",
        ],
    );
    assert_eq!(code, 2);
    assert_eq!(v["category"], "task");
    assert_eq!(tree_snapshot(root), before);
}

#[test]
fn reason_requires_opt_in() {
    let t = fixture();
    let root = t.path();
    let before = tree_snapshot(root);
    let (code, v) = cli(
        root,
        &[
            "task",
            "accept",
            "review",
            "--model",
            "reviewer",
            "--reason",
            "without opt-in",
        ],
    );
    assert_eq!(code, 2);
    assert_eq!(v["category"], "invocation");
    assert_eq!(tree_snapshot(root), before);
}

#[test]
fn actual_falsification_obligation_and_withdrawn_target_refuse() {
    let t = fixture();
    let root = t.path();
    write(root, "falsify.md", "Original report");
    ok(
        root,
        &[
            "task",
            "open",
            "falsifying",
            "--role",
            "reviewer",
            "--statement",
            "Review with falsification",
            "--scope",
            "falsify.md",
            "--review-of",
            "source",
            "--falsify",
            "falsify.md",
            "--input",
            "src",
            "check.py",
            "falsify.md",
            "--check",
            interpreter::python(),
            "check.py",
        ],
    );
    ok(
        root,
        &["task", "accept", "falsifying", "--model", "reviewer"],
    );
    ok(root, &["task", "evidence", "falsifying", "--run"]);
    let before = tree_snapshot(root);
    let (code, v) = cli(
        root,
        &[
            "task",
            "accept",
            "falsifying",
            "--model",
            "reviewer",
            "--reuse-evidence",
            "--reason",
            "same execution",
        ],
    );
    assert_eq!(code, 2);
    assert_eq!(v["category"], "task");
    assert_eq!(tree_snapshot(root), before);
    ok(
        root,
        &[
            "task",
            "withdraw",
            "source",
            "--model",
            "owner",
            "--reason",
            "Owner withdrew this assignment",
        ],
    );
    refused(root, "reviewer");
}

#[cfg(unix)]
#[test]
fn original_log_cannot_escape_task_scratch_through_a_symlink() {
    let t = fixture();
    let root = t.path();
    let r = record(root, "review");
    let log = root.join(r["evidence"][0]["log"].as_str().unwrap());
    let bytes = std::fs::read(&log).unwrap();
    std::fs::write(root.join("outside.log"), bytes).unwrap();
    std::fs::remove_file(&log).unwrap();
    std::os::unix::fs::symlink(root.join("outside.log"), &log).unwrap();
    refused(root, "reviewer");
}

#[test]
fn blocked_reviews_remain_ineligible_even_with_resolved_findings() {
    let tmp = fixture();
    let root = tmp.path();
    ok(root, &["task", "block", "review", "Await owner"]);
    ok(
        root,
        &[
            "task",
            "resolve",
            "review",
            "1",
            "--evidence",
            "Owner settled review blocker",
            "--model",
            "owner",
        ],
    );
    refused(root, "reviewer");
}
