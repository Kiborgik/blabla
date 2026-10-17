use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::Path;
use tempfile::TempDir;
#[path = "support/cli.rs"]
mod support;

fn write(root: &Path, path: &str, text: &str) {
    let path = root.join(path);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}
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
fn files(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, here: &Path, map: &mut BTreeMap<String, Vec<u8>>) {
        for entry in std::fs::read_dir(here).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, map);
            } else {
                map.insert(
                    path.strip_prefix(root).unwrap().to_string_lossy().into(),
                    std::fs::read(path).unwrap(),
                );
            }
        }
    }
    let mut map = BTreeMap::new();
    walk(root, root, &mut map);
    map
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
    let before = files(root);
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
    assert_eq!(files(root), before);
}
fn ready(root: &Path, name: &str) {
    let (_, result) = cli(root, &["challenge", name]);
    assert_eq!(result["assignment_clear"], true, "{result}");
    ok(root, &["task", "ready", name]);
}
fn fixture() -> TempDir {
    fixture_with(false, false)
}
fn fixture_with(delivery: bool, batch: bool) -> TempDir {
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
    write(
        root,
        "process.bla",
        "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\nrole \"reviewer\" { purpose \"Review\" model \"reviewer\" }\n",
    );
    write(
        root,
        "check.py",
        "from pathlib import Path\np=Path('.blabla/runs')\np.write_text(str(int(p.read_text())+1) if p.exists() else '1')\nprint('actual checked source')\nraise SystemExit(9 if Path('.blabla/fail').exists() else 0)\n",
    );
    if delivery {
        write(
            root,
            "project.bla",
            "project Reuse\nuse structure \"entry.bla\"\nuse behavior \"counter.bla\"\nprocess \"process.bla\"\ngoal \"goals.bla\"\nverify behavior { command [\"python3\", \"counter.py\"] seed 0 cases 1 steps 2 timeout_ms 2000 shrink_budget 4 }\n",
        );
        write(
            root,
            "goals.bla",
            "goal \"deliver\" { statement \"Observe the real outcome\" expect [\"contract::entry\"] state \"active\" delivery \"required\" }\n",
        );
        write(
            root,
            "counter.bla",
            "state count: int\naction increment()\nwhen increment { expect \"one\": after.count == before.count + 1 }\n",
        );
        write(
            root,
            "counter.py",
            "import json,sys\ncount=0\nfor line in sys.stdin:\n r=json.loads(line)\n if r['op']=='reset':\n  count=0\n  value={'ok':True}\n elif r['op']=='call':\n  count+=1\n  value={'ok':True}\n else:\n  value={'count':count}\n print(json.dumps({'id':r['id'],'result':value}),flush=True)\n",
        );
    }
    write(root, "src2/app.rs", "pub fn second() {}\n");
    for (name, path) in [("source", "src"), ("second", "src2")] {
        if name == "second" && !batch {
            continue;
        }
        let mut args = vec![
            "task",
            "open",
            name,
            "--role",
            "worker",
            "--statement",
            "Implement source",
            "--scope",
            path,
        ];
        if delivery {
            args.extend(["--goal", "deliver"]);
        }
        args.extend([
            "--input",
            path,
            "check.py",
            "--check-argv",
            "python3",
            "check.py",
        ]);
        ok(root, &args);
        ok(root, &["task", "accept", name, "--model", "worker"]);
        ok(root, &["task", "evidence", name, "--run"]);
        if delivery {
            partial(root, name, "Source result observed; live result remains");
        }
        ready(root, name);
    }
    let mut args = vec![
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
    ];
    if batch {
        args.extend(["--delivery-review-of", "second"]);
    }
    args.extend([
        "--input",
        "src",
        "src2",
        "check.py",
        "reviews/review.md",
        "--check-argv",
        "python3",
        "check.py",
    ]);
    ok(root, &args);
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
            "identity", "command", "inputs", "unix", "log", "exit", "tree",
        ] {
            assert_eq!(reused[field], run[field], "{field}");
        }
        assert_eq!(reused["tool"], "reuse");
        assert_eq!(reused["reuse"]["original_index"], 0);
        assert_eq!(reused["reuse"]["original_epoch"], run["acceptance_epoch"]);
        assert_eq!(reused["reuse"]["model"], "reviewer");
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
fn default_accept_still_requires_a_new_epoch_receipt() {
    let t = fixture();
    let root = t.path();
    let before = record(root, "review");
    repin_source(root);
    ok(root, &["task", "accept", "review", "--model", "reviewer"]);
    assert_eq!(record(root, "review")["evidence"], before["evidence"]);
    let (_, v) = cli(root, &["challenge", "review"]);
    assert_eq!(v["assignment_clear"], false);
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
fn changed_check_and_uncovered_target_scope_refuse() {
    for changed_check in [false, true] {
        let t = fixture();
        let root = t.path();
        if changed_check {
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
                    "--argv",
                    "python3",
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
    let before = files(t.path());
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
    assert_eq!(files(t.path()), before);
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
            "manual source check",
            "--model",
            "owner",
            "--input",
            "src",
            "check.py",
            "reviews/review.md",
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
    let before = files(root);
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
    assert_eq!(files(root), before);
}

const OBSERVATION: &str = r#"{"kind":"runtime","locator":"fixture://observed-source/1","context":"Synthetic fixture observation, not an applied live result"}"#;
fn partial(root: &Path, name: &str, observation: &str) {
    ok(
        root,
        &[
            "task",
            "delivery",
            name,
            "deliver",
            "--status",
            "partial",
            "--observation",
            observation,
            "--observation-ref",
            OBSERVATION,
            "--delivered",
            "Checked source",
            "--remaining",
            "Actual live outcome",
            "--owner",
            "delivery-owner",
            "--next",
            "Authorized live inspection",
            "--model",
            "worker",
        ],
    );
}
fn verdict(root: &Path, source: &str) {
    ok(
        root,
        &[
            "task",
            "delivery-review",
            "review",
            "deliver",
            "--source",
            source,
            "--verdict",
            "accept",
            "--observation-ref",
            OBSERVATION,
            "--reason",
            "Independently inspected this exact Partial source claim",
            "--model",
            "reviewer",
        ],
    );
}
fn close_args(name: &str, bounded: bool) -> Vec<&str> {
    let mut args = vec!["task", "close", name, "--model", "owner"];
    if bounded {
        args.extend([
            "--bounded",
            "--reason",
            "Bounded source accepted; current whole-product verification remains outstanding",
        ]);
    }
    args
}
#[test]
fn reused_run_never_renews_delivery_verdicts_and_both_close_modes_keep_partial_residuals() {
    for (bounded, order) in [
        (false, ["source", "second"]),
        (false, ["second", "source"]),
        (true, ["source", "second"]),
        (true, ["second", "source"]),
    ] {
        let t = fixture_with(true, true);
        let root = t.path();
        verdict(root, "source");
        verdict(root, "second");
        ready(root, "review");
        let old = record(root, "review");
        repin_source(root);
        ok(root, &["task", "evidence", "source", "--run"]);
        partial(
            root,
            "source",
            "A renewed Partial account requires a fresh independent verdict",
        );
        ready(root, "source");
        let source_bytes = std::fs::read(root.join(".blabla/tasks/source.json")).unwrap();
        ok(root, &["finish"]);
        let status_before = std::fs::read(root.join(".blabla/status.json")).unwrap();
        reuse(root);
        assert_eq!(
            std::fs::read(root.join(".blabla/status.json")).unwrap(),
            status_before
        );
        assert_eq!(
            record(root, "review")["delivery_reviews"],
            old["delivery_reviews"]
        );
        assert_eq!(
            std::fs::read(root.join(".blabla/tasks/source.json")).unwrap(),
            source_bytes
        );
        for source in ["source", "second"] {
            let shown = ok(root, &["task", "show", source]);
            assert!(
                !shown["delivery"]["reviews_pending"]
                    .as_array()
                    .unwrap()
                    .is_empty(),
                "{shown}"
            );
        }
        let before = files(root);
        let (exit, _) = cli(root, &close_args("source", bounded));
        assert_eq!(exit, 2);
        assert_eq!(files(root), before);
        verdict(root, "source");
        assert!(
            !ok(root, &["task", "show", "second"])["delivery"]["reviews_pending"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        verdict(root, "second");
        ready(root, "review");
        ok(root, &["finish"]);
        if bounded {
            ok(
                root,
                &[
                    "task",
                    "open",
                    "concurrent",
                    "--role",
                    "worker",
                    "--statement",
                    "Unrelated implementation",
                    "--scope",
                    "unrelated.md",
                    "--check-argv",
                    "true",
                ],
            );
            write(
                root,
                "unrelated.md",
                "Actual unrelated implementation drift\n",
            );
        }
        ok(root, &close_args("review", bounded));
        for source in order {
            ok(root, &close_args(source, bounded));
        }
        let (_, status) = cli(root, &["status"]);
        for source in ["source", "second"] {
            assert!(
                status["delivery"]["residuals"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|r| r["origin_task"] == source && r["status"] == "partial")
            );
        }
    }
}
#[test]
fn source_artifact_outside_original_selection_refuses_until_a_real_run_covers_it() {
    let t = fixture_with(true, false);
    let root = t.path();
    repin_source(root);
    ok(root, &["task", "evidence", "source", "--run"]);
    write(
        root,
        "artifact.txt",
        "Actual independently inspectable artifact",
    );
    let reference = r#"{"kind":"artifact","locator":"artifact.txt","context":"New explicit artifact was not in the original review execution"}"#;
    ok(
        root,
        &[
            "task",
            "delivery",
            "source",
            "deliver",
            "--status",
            "partial",
            "--observation",
            "Additional artifact",
            "--observation-ref",
            reference,
            "--delivered",
            "Source",
            "--remaining",
            "Live",
            "--owner",
            "owner",
            "--next",
            "Inspect",
            "--model",
            "worker",
        ],
    );
    refused(root, "reviewer");
}
#[test]
fn reason_requires_opt_in_and_text_output_discloses_both_times() {
    let t = fixture();
    let root = t.path();
    let before = files(root);
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
    assert_eq!(files(root), before);
    reuse(root);
    let out = support::run_in(Some(root), &support::args(&["task", "show", "review"]));
    assert!(out.status.success());
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(text.contains("original execution"));
    assert!(text.contains("explicitly reused"));
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
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    ok(
        root,
        &["task", "accept", "falsifying", "--model", "reviewer"],
    );
    ok(root, &["task", "evidence", "falsifying", "--run"]);
    let before = files(root);
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
    assert!(v["message"].as_str().unwrap().contains("falsification"));
    assert_eq!(files(root), before);
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

#[test]
fn declared_input_membership_and_newer_epoch_do_not_recover_an_older_run() {
    for new_epoch in [false, true] {
        let t = fixture();
        let root = t.path();
        if new_epoch {
            ok(root, &["task", "accept", "review", "--model", "reviewer"]);
        } else {
            ok(
                root,
                &[
                    "task", "check", "review", "--model", "owner", "--input", "src", "check.py",
                    "--argv", "python3", "check.py",
                ],
            );
        }
        refused(root, "reviewer");
    }
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
