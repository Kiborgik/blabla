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

fn cli(root: &Path, arguments: &[&str]) -> (i32, Value) {
    let mut args = vec!["--json"];
    args.extend(arguments);
    let output = support::run_in(Some(root), &support::args(&args));
    let value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        json!({"stdout": String::from_utf8_lossy(&output.stdout), "stderr": String::from_utf8_lossy(&output.stderr)})
    });
    (output.status.code().unwrap(), value)
}

fn success(root: &Path, arguments: &[&str]) -> Value {
    let (exit, value) = cli(root, arguments);
    assert_eq!(exit, 0, "{arguments:?}: {value}");
    value
}

fn show(root: &Path, name: &str) -> Value {
    success(root, &["task", "show", name])
}

fn tree(root: &Path) -> BTreeMap<String, Option<Vec<u8>>> {
    fn visit(root: &Path, path: &Path, found: &mut BTreeMap<String, Option<Vec<u8>>>) {
        for entry in std::fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            let key = path
                .strip_prefix(root)
                .unwrap()
                .to_str()
                .unwrap()
                .to_owned();
            if path.is_dir() {
                found.insert(key, None);
                visit(root, &path, found);
            } else {
                found.insert(key, Some(std::fs::read(path).unwrap()));
            }
        }
    }
    let mut found = BTreeMap::new();
    visit(root, root, &mut found);
    found
}

fn disposition(
    root: &Path,
    name: &str,
    identity: &str,
    model: &str,
    refresh: bool,
) -> (i32, Value) {
    let mut args = vec![
        "task",
        "disposition",
        name,
        identity,
        "--status",
        "confirmed-unchanged",
        "--reason",
        "The observed source entry and actual check retain this boundary",
        "--model",
        model,
    ];
    if refresh {
        args.push("--refresh-ready");
    }
    cli(root, &args)
}

fn reflection(root: &Path, name: &str, model: &str, refresh: bool) -> (i32, Value) {
    let mut args = vec![
        "task",
        "reflect",
        name,
        "--outcome",
        "no-useful-successor",
        "--decision",
        "Retain the reviewed entry",
        "--observation",
        "The actual check read the callable source entry",
        "--evidence-ref",
        "src/app.rs",
        "--reason",
        "No additional entry behavior is required by this bounded fixture",
        "--model",
        model,
    ];
    if refresh {
        args.push("--refresh-ready");
    }
    cli(root, &args)
}

fn claims(root: &Path, name: &str, model: &str, refresh: bool) {
    for row in show(root, name)["affected_intent"].as_array().unwrap() {
        let result = disposition(
            root,
            name,
            row["identity"].as_str().unwrap(),
            model,
            refresh,
        );
        assert_eq!(result.0, 0, "{}", result.1);
    }
    let result = reflection(root, name, model, refresh);
    assert_eq!(result.0, 0, "{}", result.1);
}

fn handback(root: &Path, name: &str, model: &str) {
    success(root, &["task", "evidence", name, "--run"]);
    success(
        root,
        &[
            "task",
            "lens",
            name,
            "testing",
            "Read the actual entry check result",
            "--model",
            model,
        ],
    );
    claims(root, name, model, false);
    let challenge = success(root, &["challenge", name]);
    assert_eq!(challenge["assignment_clear"], true, "{challenge}");
    success(root, &["task", "ready", name]);
}

fn fixture() -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "project.bla",
        "project Refresh\nuse structure \"entry.bla\"\nuse behavior \"counter.bla\"\nprocess \"process.bla\"\ngoal \"goals.bla\"\nknowledge \"knowledge.bla\"\nverify behavior { command [\"python3\", \"counter.py\"] seed 0 cases 1 steps 2 timeout_ms 2000 shrink_budget 4 }\n",
    );
    write(
        root,
        "counter.bla",
        "state count: int\naction increment()\nwhen increment { expect \"one\": after.count == before.count + 1 }\n",
    );
    write(
        root,
        "counter.py",
        "import json, sys\ncount=0\nfor line in sys.stdin:\n r=json.loads(line)\n if r['op']=='reset':\n  count=0\n  value={'ok':True}\n elif r['op']=='call':\n  count+=1\n  value={'ok':True}\n else:\n  value={'count':count}\n print(json.dumps({'id':r['id'],'result':value}),flush=True)\n",
    );
    write(
        root,
        "entry.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(root, "src/app.rs", "pub fn run() {}\n");
    write(
        root,
        "process.bla",
        "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" consult [\"testing\"] }\nrole \"reviewer\" { purpose \"Review\" model \"reviewer\" consult [\"testing\"] }\n",
    );
    write(
        root,
        "knowledge.bla",
        "knowledge \"testing\" { purpose \"Read actual checks\" }\nruling \"real\" { pack \"testing\" statement \"Observe the executed result\" }\n",
    );
    write(
        root,
        "goals.bla",
        "goal \"deliver\" { statement \"Retain the callable entry\" expect [\"contract::entry\"] state \"active\" }\n",
    );
    write(
        root,
        "check.py",
        "from pathlib import Path\np=Path('.blabla/check-count')\np.write_text(str(int(p.read_text())+1) if p.exists() else '1')\nassert 'pub fn run' in Path('src/app.rs').read_text()\n",
    );
    success(
        root,
        &[
            "task",
            "open",
            "work",
            "--role",
            "worker",
            "--statement",
            "Retain the entry",
            "--scope",
            "src",
            "--goal",
            "deliver",
            "--require-intent-disposition",
            "--require-goal-reflection",
            "--input",
            "src",
            "check.py",
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    success(root, &["task", "accept", "work", "--model", "worker"]);
    success(root, &["finish"]);
    handback(root, "work", "worker");
    temp
}

#[test]
fn ready_disposition_refresh_preserves_real_evidence_and_clears_only_challenge() {
    let temp = fixture();
    let root = temp.path();
    let before = show(root, "work")["task"].clone();
    assert!(!before["challenged"].is_null());
    let before_tree = tree(root);
    let (exit, value) = disposition(root, "work", "goal::deliver", "worker", true);
    assert_eq!(
        exit, 0,
        "explicit READY receipt refresh must succeed: {value}"
    );
    let after = show(root, "work")["task"].clone();
    let mut expected = before.clone();
    expected.as_object_mut().unwrap().remove("challenged");
    let entries = after["intent_dispositions"].as_array().unwrap();
    assert_eq!(
        entries.len(),
        before["intent_dispositions"].as_array().unwrap().len() + 1
    );
    assert_eq!(entries.last().unwrap()["identity"], "goal::deliver");
    assert_eq!(entries.last().unwrap()["model"], "worker");
    expected["intent_dispositions"] = after["intent_dispositions"].clone();
    assert_eq!(after, expected);
    let mut expected_tree = before_tree;
    expected_tree.insert(
        ".blabla/tasks/work.json".into(),
        Some(std::fs::read(root.join(".blabla/tasks/work.json")).unwrap()),
    );
    assert_eq!(tree(root), expected_tree);
    assert_eq!(show(root, "work")["goal_reflection_state"], "stale");
    assert_eq!(
        cli(root, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
}

fn refused_refreshes(root: &Path, name: &str, model: &str) {
    let before = tree(root);
    for reflect in [false, true] {
        let result = if reflect {
            reflection(root, name, model, true)
        } else {
            disposition(root, name, "goal::deliver", model, true)
        };
        assert_eq!(
            tree(root),
            before,
            "refused refresh changed exact fixture bytes"
        );
        assert_eq!(result.0, 2, "{}", result.1);
        assert_eq!(
            result.1["category"], "task",
            "must reach the policy refusal, not a missing-option parser error: {}",
            result.1
        );
    }
}

fn resolve_finding(root: &Path) {
    success(
        root,
        &[
            "task",
            "finding",
            "work",
            "Inspect the administrative resolution",
        ],
    );
    success(
        root,
        &[
            "task",
            "resolve",
            "work",
            "1",
            "--evidence",
            "The owner inspected the current unchanged source and settled the question",
            "--model",
            "owner",
        ],
    );
}

fn review(root: &Path, name: &str, target: &str) {
    let scope = format!("reports/{name}.md");
    success(
        root,
        &[
            "task",
            "open",
            name,
            "--role",
            "reviewer",
            "--statement",
            "Review the current target",
            "--review-of",
            target,
            "--scope",
            &scope,
            "--goal",
            "deliver",
            "--require-intent-disposition",
            "--require-goal-reflection",
            "--input",
            "src",
            "check.py",
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    success(root, &["task", "accept", name, "--model", "reviewer"]);
    write(root, &scope, "The actual source entry was inspected\n");
    handback(root, name, "reviewer");
    assert_eq!(show(root, name)["review_current"], true);
}

#[test]
fn ready_reflection_refresh_changes_only_the_supplied_claim_and_challenge() {
    let temp = fixture();
    let root = temp.path();
    let before = show(root, "work")["task"].clone();
    let before_tree = tree(root);
    let result = reflection(root, "work", "worker", true);
    assert_eq!(result.0, 0, "{}", result.1);
    let after = show(root, "work")["task"].clone();
    let mut expected = before;
    expected.as_object_mut().unwrap().remove("challenged");
    expected["goal_reflection"] = after["goal_reflection"].clone();
    assert_eq!(after, expected);
    assert_eq!(
        after["goal_reflection"]["decision"],
        "Retain the reviewed entry"
    );
    assert_eq!(
        after["goal_reflection"]["outcome"]["kind"],
        "no-useful-successor"
    );
    let mut expected_tree = before_tree;
    expected_tree.insert(
        ".blabla/tasks/work.json".into(),
        Some(std::fs::read(root.join(".blabla/tasks/work.json")).unwrap()),
    );
    assert_eq!(tree(root), expected_tree);
    assert_eq!(
        cli(root, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
    success(root, &["challenge", "work"]);
    success(root, &["task", "close", "work", "--model", "owner"]);
}

#[test]
fn resolved_finding_can_refresh_claims_without_rerunning_the_check_or_reaccepting() {
    let temp = fixture();
    let root = temp.path();
    resolve_finding(root);
    let before = show(root, "work");
    assert_eq!(before["intent_disposition_current"], false);
    assert_eq!(before["goal_reflection_state"], "stale");
    let count = std::fs::read(root.join(".blabla/check-count")).unwrap();
    let status = std::fs::read(root.join(".blabla/status.json")).unwrap();
    claims(root, "work", "worker", true);
    let after = show(root, "work");
    assert_eq!(after["intent_disposition_current"], true);
    assert_eq!(after["goal_reflection_state"], "current");
    for key in [
        "state",
        "acceptance_epoch",
        "accepted",
        "evidence",
        "scope",
        "review_of",
        "findings",
    ] {
        assert_eq!(after["task"][key], before["task"][key], "{key}");
    }
    assert!(after["task"]["challenged"].is_null());
    assert_eq!(
        std::fs::read(root.join(".blabla/check-count")).unwrap(),
        count
    );
    assert_eq!(
        cli(root, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
    success(root, &["challenge", "work"]);
    success(root, &["task", "close", "work", "--model", "owner"]);
    assert_eq!(
        std::fs::read(root.join(".blabla/status.json")).unwrap(),
        status
    );
}

#[test]
fn one_manual_disposition_does_not_confirm_other_identities_or_refresh_reflection() {
    let temp = fixture();
    let root = temp.path();
    resolve_finding(root);
    let before = show(root, "work")["task"].clone();
    let result = disposition(root, "work", "goal::deliver", "worker", true);
    assert_eq!(result.0, 0, "{}", result.1);
    let after = show(root, "work");
    assert_eq!(after["intent_disposition_current"], false);
    assert_eq!(after["goal_reflection_state"], "stale");
    assert_eq!(after["task"]["goal_reflection"], before["goal_reflection"]);
    let rows = after["affected_intent"].as_array().unwrap();
    assert!(
        rows.iter()
            .any(|r| r["identity"] == "goal::deliver" && r["state"] == "current")
    );
    assert!(
        rows.iter()
            .filter(|r| r["identity"] != "goal::deliver")
            .all(|r| r["state"] == "stale")
    );
    let (exit, value) = cli(root, &["challenge", "work"]);
    assert_eq!(exit, 1, "{value}");
    assert!(
        value["grounded"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "intent-disposition-missing")
    );
    assert_eq!(
        cli(root, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
}

#[test]
fn ordinary_ready_writes_still_refuse_and_ordinary_reacceptance_changes_epoch() {
    let temp = fixture();
    let root = temp.path();
    let before_tree = tree(root);
    assert_eq!(
        disposition(root, "work", "goal::deliver", "worker", false).0,
        2
    );
    assert_eq!(reflection(root, "work", "worker", false).0, 2);
    assert_eq!(tree(root), before_tree);
    let before = show(root, "work")["task"].clone();
    success(root, &["task", "accept", "work", "--model", "worker"]);
    let after = show(root, "work");
    assert_eq!(
        after["task"]["acceptance_epoch"].as_u64().unwrap(),
        before["acceptance_epoch"].as_u64().unwrap() + 1
    );
    assert_eq!(after["task"]["evidence"], before["evidence"]);
    assert_eq!(after["intent_disposition_current"], false);
    assert_eq!(after["goal_reflection_state"], "stale");
    assert_eq!(cli(root, &["task", "ready", "work"]).0, 2);
    handback(root, "work", "worker");
    assert_eq!(
        std::fs::read_to_string(root.join(".blabla/check-count")).unwrap(),
        "2"
    );
}

#[test]
fn explicit_refresh_refuses_accepted_blocked_closed_withdrawn_and_open_states() {
    for state in ["accepted", "blocked", "closed", "withdrawn", "open"] {
        let temp = fixture();
        let root = temp.path();
        let name = if state == "open" {
            success(
                root,
                &[
                    "task",
                    "open",
                    "fresh",
                    "--role",
                    "worker",
                    "--statement",
                    "Unaccepted work",
                    "--scope",
                    "other",
                    "--goal",
                    "deliver",
                    "--require-intent-disposition",
                    "--require-goal-reflection",
                    "--input",
                    "src",
                    "check.py",
                    "--check-argv",
                    "python3",
                    "check.py",
                ],
            );
            "fresh"
        } else {
            match state {
                "accepted" => {
                    success(root, &["task", "accept", "work", "--model", "worker"]);
                }
                "blocked" => {
                    success(root, &["task", "accept", "work", "--model", "worker"]);
                    success(
                        root,
                        &["task", "block", "work", "An owner decision is needed"],
                    );
                }
                "closed" => {
                    success(root, &["task", "close", "work", "--model", "owner"]);
                }
                "withdrawn" => {
                    success(
                        root,
                        &[
                            "task",
                            "withdraw",
                            "work",
                            "--reason",
                            "Cancel this fixture",
                            "--model",
                            "owner",
                        ],
                    );
                }
                _ => unreachable!(),
            }
            "work"
        };
        assert_eq!(show(root, name)["task"]["state"], state);
        refused_refreshes(root, name, "worker");
    }
}

#[test]
fn wrong_model_and_revoked_model_refuse_without_writes() {
    let temp = fixture();
    refused_refreshes(temp.path(), "work", "owner");
    let process = std::fs::read_to_string(temp.path().join("process.bla")).unwrap();
    write(
        temp.path(),
        "process.bla",
        &process.replace("model \"worker\"", "model \"replacement\""),
    );
    refused_refreshes(temp.path(), "work", "worker");
}

#[test]
fn malformed_or_missing_registered_process_cannot_prove_model_eligibility() {
    for missing in [false, true] {
        let temp = fixture();
        if missing {
            std::fs::remove_file(temp.path().join("process.bla")).unwrap();
        } else {
            write(temp.path(), "process.bla", "role \"worker\" {");
        }
        refused_refreshes(temp.path(), "work", "worker");
    }
}

#[test]
fn changed_source_and_new_directory_child_refuse_without_writes() {
    for new_child in [false, true] {
        let temp = fixture();
        write(
            temp.path(),
            if new_child {
                "src/new.rs"
            } else {
                "src/app.rs"
            },
            "pub fn run() { let changed = 1; }\n",
        );
        refused_refreshes(temp.path(), "work", "worker");
    }
}

#[test]
fn missing_and_nonfile_check_inputs_refuse_without_writes() {
    for nonfile in [false, true] {
        let temp = fixture();
        std::fs::remove_file(temp.path().join("check.py")).unwrap();
        if nonfile {
            std::fs::create_dir(temp.path().join("check.py")).unwrap();
        }
        refused_refreshes(temp.path(), "work", "worker");
    }
}

#[test]
fn changed_check_argv_and_input_selection_refuse_without_writes() {
    for inputs in [false, true] {
        let temp = fixture();
        let root = temp.path();
        if inputs {
            success(
                root,
                &[
                    "task",
                    "check",
                    "work",
                    "--model",
                    "owner",
                    "--input",
                    "src/app.rs",
                    "check.py",
                    "--argv",
                    "python3",
                    "check.py",
                ],
            );
        } else {
            success(
                root,
                &[
                    "task",
                    "check",
                    "work",
                    "--model",
                    "owner",
                    "--input",
                    "src",
                    "check.py",
                    "--argv",
                    "python3",
                    "-c",
                    "raise SystemExit(0)",
                ],
            );
        }
        refused_refreshes(root, "work", "worker");
    }
}

#[test]
fn concurrent_attribution_does_not_erase_an_explicit_input_dependency() {
    let temp = fixture();
    let root = temp.path();
    write(root, "src/app.rs", "pub fn run() { let changed = 1; }\n");
    success(
        root,
        &[
            "task",
            "attribute",
            "work",
            "src/app.rs",
            "--kind",
            "concurrent",
            "--model",
            "owner",
        ],
    );
    refused_refreshes(root, "work", "worker");
}

#[test]
fn review_target_source_epoch_and_claim_changes_refuse_without_repinning() {
    for change in ["source", "epoch", "claim"] {
        let temp = fixture();
        let root = temp.path();
        review(root, "review", "work");
        match change {
            "source" => write(root, "src/app.rs", "pub fn run() { let changed = 1; }\n"),
            "epoch" => {
                success(root, &["task", "accept", "work", "--model", "worker"]);
            }
            "claim" => {
                let result = disposition(root, "work", "goal::deliver", "worker", true);
                assert_eq!(result.0, 0, "{}", result.1);
            }
            _ => unreachable!(),
        }
        assert_eq!(show(root, "review")["review_current"], false);
        refused_refreshes(root, "review", "reviewer");
    }
}

#[test]
fn recursive_target_rework_refuses_outer_review_refresh() {
    let temp = fixture();
    let root = temp.path();
    review(root, "inner", "work");
    review(root, "outer", "inner");
    success(root, &["task", "accept", "work", "--model", "worker"]);
    assert_eq!(show(root, "outer")["review_current"], false);
    refused_refreshes(root, "outer", "reviewer");
}

#[test]
fn missing_corrupt_and_withdrawn_targets_refuse_without_touching_review() {
    for kind in ["missing", "corrupt", "withdrawn"] {
        let temp = fixture();
        let root = temp.path();
        review(root, "review", "work");
        match kind {
            "missing" => std::fs::remove_file(root.join(".blabla/tasks/work.json")).unwrap(),
            "corrupt" => write(root, ".blabla/tasks/work.json", "not a task record"),
            "withdrawn" => {
                success(
                    root,
                    &[
                        "task",
                        "withdraw",
                        "work",
                        "--reason",
                        "Withdraw target",
                        "--model",
                        "owner",
                    ],
                );
            }
            _ => unreachable!(),
        }
        assert_eq!(show(root, "review")["review_current"], false);
        refused_refreshes(root, "review", "reviewer");
    }
}

#[test]
fn target_closure_alone_preserves_review_currency_and_explicit_refresh_target() {
    let temp = fixture();
    let root = temp.path();
    review(root, "review", "work");
    success(root, &["finish"]);
    let before = show(root, "review")["task"].clone();
    success(root, &["task", "close", "work", "--model", "owner"]);
    assert_eq!(show(root, "review")["review_current"], true);
    let result = reflection(root, "review", "reviewer", true);
    assert_eq!(result.0, 0, "{}", result.1);
    let after = show(root, "review")["task"].clone();
    assert_eq!(after["review_of"], before["review_of"]);
    assert_eq!(after["evidence"], before["evidence"]);
    assert_eq!(after["acceptance_epoch"], before["acceptance_epoch"]);
}

#[test]
fn unresolved_finding_survives_manual_refresh_and_still_blocks_close() {
    let temp = fixture();
    let root = temp.path();
    success(
        root,
        &["task", "finding", "work", "Unresolved independent concern"],
    );
    let finding = show(root, "work")["task"]["findings"].clone();
    claims(root, "work", "worker", true);
    let (exit, value) = cli(root, &["challenge", "work"]);
    assert_eq!(exit, 1, "{value}");
    assert!(
        value["grounded"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "unresolved-finding")
    );
    assert_eq!(show(root, "work")["task"]["findings"], finding);
    assert_eq!(
        cli(root, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
}

#[test]
fn global_verification_drift_survives_successful_receipt_refresh() {
    let temp = fixture();
    let root = temp.path();
    success(
        root,
        &[
            "task",
            "open",
            "other",
            "--role",
            "worker",
            "--statement",
            "Concurrent report",
            "--scope",
            "other.md",
            "--check-argv",
            "python3",
            "-c",
            "pass",
        ],
    );
    success(root, &["task", "accept", "other", "--model", "worker"]);
    write(root, "other.md", "A real unrelated report change\n");
    let status = std::fs::read(root.join(".blabla/status.json")).unwrap();
    let result = reflection(root, "work", "worker", true);
    assert_eq!(result.0, 0, "{}", result.1);
    let (_, challenge) = cli(root, &["challenge", "work"]);
    assert!(
        challenge["grounded"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "verification-not-current")
    );
    assert_eq!(
        cli(root, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
    assert_eq!(
        std::fs::read(root.join(".blabla/status.json")).unwrap(),
        status
    );
}

#[test]
fn closure_only_control_is_already_current_without_the_new_surface() {
    let temp = fixture();
    let root = temp.path();
    review(root, "review", "work");
    success(root, &["finish"]);
    let before = show(root, "review")["task"]["review_of"].clone();
    success(root, &["task", "close", "work", "--model", "owner"]);
    let after = show(root, "review");
    assert_eq!(after["review_current"], true);
    assert_eq!(after["task"]["review_of"], before);
}

#[test]
fn malformed_manual_claims_refuse_without_any_record_or_file_writes() {
    let temp = fixture();
    let root = temp.path();
    let cases = [
        vec![
            "task",
            "disposition",
            "work",
            "goal::deliver",
            "--status",
            "confirmed-unchanged",
            "--reason",
            " ",
            "--model",
            "worker",
            "--refresh-ready",
        ],
        vec![
            "task",
            "disposition",
            "work",
            "goal::deliver",
            "--status",
            "invented",
            "--reason",
            "Explicit reason",
            "--model",
            "worker",
            "--refresh-ready",
        ],
        vec![
            "task",
            "disposition",
            "work",
            "goal::unknown",
            "--status",
            "confirmed-unchanged",
            "--reason",
            "Explicit reason",
            "--model",
            "worker",
            "--refresh-ready",
        ],
        vec![
            "task",
            "reflect",
            "work",
            "--outcome",
            "no-useful-successor",
            "--decision",
            " ",
            "--observation",
            "Actual source",
            "--evidence-ref",
            "src/app.rs",
            "--reason",
            "No successor",
            "--model",
            "worker",
            "--refresh-ready",
        ],
        vec![
            "task",
            "reflect",
            "work",
            "--outcome",
            "successor",
            "--decision",
            "A successor needs ownership",
            "--observation",
            "Actual source",
            "--evidence-ref",
            "src/app.rs",
            "--reason",
            "Next bounded work",
            "--model",
            "worker",
            "--refresh-ready",
        ],
    ];
    for args in cases {
        let before = tree(root);
        let (exit, value) = cli(root, &args);
        assert_eq!(tree(root), before);
        assert_eq!(exit, 2, "{value}");
        assert_eq!(value["category"], "task", "{value}");
    }
}

#[test]
fn refresh_cannot_opt_a_legacy_task_into_claim_requirements() {
    let temp = fixture();
    let root = temp.path();
    success(
        root,
        &[
            "task",
            "open",
            "legacy",
            "--role",
            "worker",
            "--statement",
            "Legacy task",
            "--scope",
            "legacy.md",
            "--goal",
            "deliver",
            "--input",
            "src",
            "check.py",
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    success(root, &["task", "accept", "legacy", "--model", "worker"]);
    success(root, &["task", "evidence", "legacy", "--run"]);
    success(
        root,
        &[
            "task",
            "lens",
            "legacy",
            "testing",
            "Read actual check",
            "--model",
            "worker",
        ],
    );
    success(root, &["challenge", "legacy"]);
    success(root, &["task", "ready", "legacy"]);
    refused_refreshes(root, "legacy", "worker");
    success(
        root,
        &[
            "task", "check", "legacy", "--input", "src", "check.py", "--argv", "python3",
            "check.py",
        ],
    );
    let before = tree(root);
    let (_, challenge) = cli(root, &["challenge", "legacy"]);
    assert_eq!(challenge["assignment_clear"], false, "{challenge}");
    assert_eq!(tree(root), before);
}

#[test]
fn renewed_claims_do_not_confirm_owner_records_made_during_carry() {
    let temp = fixture();
    let root = temp.path();
    success(root, &["task", "accept", "work", "--model", "worker"]);
    success(
        root,
        &[
            "task",
            "statement",
            "work",
            "Retain the inspected callable entry",
            "--model",
            "owner",
        ],
    );
    handback(root, "work", "worker");
    let records = show(root, "work")["task"]["orchestrator_records"].clone();
    assert!(
        records
            .as_array()
            .unwrap()
            .iter()
            .any(|r| !r["carried_by"].is_null() && r["confirmed"].is_null())
    );
    claims(root, "work", "worker", true);
    let (_, challenge) = cli(root, &["challenge", "work"]);
    assert!(
        challenge["grounded"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "orchestrator-record-during-carry")
    );
    assert_eq!(show(root, "work")["task"]["orchestrator_records"], records);
    assert_eq!(
        cli(root, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
}

#[test]
fn changed_consulted_knowledge_still_requires_a_current_lens() {
    let temp = fixture();
    let root = temp.path();
    write(
        root,
        "knowledge.bla",
        "knowledge \"testing\" { purpose \"Read actual checks\" }\nruling \"real\" { pack \"testing\" statement \"Observe the executed result and its complete failure log\" }\n",
    );
    claims(root, "work", "worker", true);
    let (exit, challenge) = cli(root, &["challenge", "work"]);
    assert_eq!(exit, 1);
    assert!(
        challenge["grounded"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "lens-unassessed")
    );
    assert_eq!(
        cli(root, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
}

#[test]
fn an_unpicked_owner_question_survives_refresh_and_blocks_close() {
    let temp = fixture();
    let root = temp.path();
    success(
        root,
        &[
            "task",
            "ask",
            "work",
            "Is the observed entry sufficient?",
            "--model",
            "owner",
        ],
    );
    let questions = show(root, "work")["task"]["questions"].clone();
    claims(root, "work", "worker", true);
    let (exit, challenge) = cli(root, &["challenge", "work"]);
    assert_eq!(exit, 1);
    assert!(
        challenge["grounded"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "question-unpicked")
    );
    assert_eq!(show(root, "work")["task"]["questions"], questions);
    assert_eq!(
        cli(root, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
}

#[test]
fn corrupted_ready_state_cannot_promote_missing_or_genuinely_failed_evidence() {
    for failed in [false, true] {
        let temp = fixture();
        let root = temp.path();
        success(root, &["task", "accept", "work", "--model", "worker"]);
        if failed {
            success(
                root,
                &[
                    "task",
                    "check",
                    "work",
                    "--model",
                    "owner",
                    "--input",
                    "src",
                    "check.py",
                    "--argv",
                    "python3",
                    "-c",
                    "raise SystemExit(17)",
                ],
            );
            success(root, &["task", "evidence", "work", "--run"]);
            assert_eq!(
                show(root, "work")["task"]["evidence"]
                    .as_array()
                    .unwrap()
                    .last()
                    .unwrap()["exit"],
                17
            );
        }
        let path = root.join(".blabla/tasks/work.json");
        let mut corrupt: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        corrupt["state"] = json!("ready");
        if !failed {
            corrupt["evidence"] = json!([]);
        }
        std::fs::write(path, serde_json::to_vec_pretty(&corrupt).unwrap()).unwrap();
        assert_eq!(show(root, "work")["task"]["state"], "ready");
        refused_refreshes(root, "work", "worker");
    }
}

#[test]
fn refresh_updates_only_existing_writer_provenance_in_a_cross_build_metadata_fixture() {
    for is_reflection in [false, true] {
        let temp = fixture();
        let root = temp.path();
        let path = root.join(".blabla/tasks/work.json");
        let mut metadata_fixture: Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let current_build = metadata_fixture["build"].clone();
        metadata_fixture["build"] = json!("0.11.0 prior-writer-metadata-fixture");
        std::fs::write(&path, serde_json::to_vec(&metadata_fixture).unwrap()).unwrap();
        let before_tree = tree(root);
        let (exit, value) = if is_reflection {
            reflection(root, "work", "worker", true)
        } else {
            disposition(root, "work", "goal::deliver", "worker", true)
        };
        assert_eq!(exit, 0, "{value}");
        let after = show(root, "work")["task"].clone();
        metadata_fixture
            .as_object_mut()
            .unwrap()
            .remove("challenged");
        let key = if is_reflection {
            "goal_reflection"
        } else {
            "intent_dispositions"
        };
        metadata_fixture[key] = after[key].clone();
        metadata_fixture["build"] = current_build;
        assert_eq!(after, metadata_fixture);
        let mut expected_tree = before_tree;
        expected_tree.insert(
            ".blabla/tasks/work.json".into(),
            Some(std::fs::read(path).unwrap()),
        );
        assert_eq!(tree(root), expected_tree);
        assert_eq!(
            std::fs::read_to_string(root.join(".blabla/check-count")).unwrap(),
            "1"
        );
    }
}

#[test]
fn stale_ready_statement_challenge_cannot_be_replaced_by_diagnostic_inspection() {
    let temp = fixture();
    let root = temp.path();
    success(
        root,
        &[
            "task",
            "statement",
            "work",
            "A materially sharper assignment",
            "--model",
            "owner",
        ],
    );
    let old = show(root, "work")["task"]["challenged"].clone();
    assert!(!old.is_null());
    let before = tree(root);
    let (_, challenged) = cli(root, &["challenge", "work"]);
    assert_eq!(challenged["assignment_clear"], false, "{challenged}");
    assert_eq!(tree(root), before);
    assert_eq!(show(root, "work")["task"]["challenged"], old);
    assert_eq!(
        cli(root, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
    assert_eq!(tree(root), before);
}

#[test]
fn current_ready_rechallenge_and_refused_close_preserve_exact_bytes() {
    let temp = fixture();
    let root = temp.path();
    success(
        root,
        &[
            "task",
            "open",
            "other",
            "--role",
            "worker",
            "--statement",
            "Concurrent report",
            "--scope",
            "other.md",
            "--check-argv",
            "python3",
            "-c",
            "pass",
        ],
    );
    success(root, &["task", "accept", "other", "--model", "worker"]);
    write(
        root,
        "other.md",
        "An unrelated report changed the whole-project snapshot\n",
    );
    let path = root.join(".blabla/tasks/work.json");
    let mut metadata_fixture = show(root, "work")["task"].clone();
    metadata_fixture["challenged"]["unix"] = json!(1);
    std::fs::write(&path, serde_json::to_vec_pretty(&metadata_fixture).unwrap()).unwrap();
    let before = tree(root);
    for _ in 0..2 {
        let (_, challenge) = cli(root, &["challenge", "work"]);
        assert_eq!(challenge["assignment_clear"], true, "{challenge}");
        assert_eq!(tree(root), before);
        let (exit, refusal) = cli(root, &["task", "close", "work", "--model", "owner"]);
        assert_eq!(exit, 2, "{refusal}");
        assert_eq!(tree(root), before);
    }
    assert_eq!(show(root, "work")["task"]["challenged"]["unix"], 1);
}

#[test]
fn explicit_ready_rechallenge_preserves_authority_and_checks_current_blockers() {
    for kind in ["positive", "source", "target", "finding"] {
        let temp = fixture();
        let root = temp.path();
        let name = if kind == "target" {
            review(root, "review", "work");
            "review"
        } else {
            "work"
        };
        let model = if kind == "target" {
            "reviewer"
        } else {
            "worker"
        };
        claims(root, name, model, true);
        let before = show(root, name)["task"].clone();
        assert!(before["challenged"].is_null());
        match kind {
            "source" => write(root, "src/app.rs", "pub fn run() { let _ = 1; }\n"),
            "target" => {
                success(root, &["task", "accept", "work", "--model", "worker"]);
            }
            "finding" => {
                success(root, &["task", "finding", name, "Still unresolved"]);
            }
            _ => {}
        }
        let checkpoint = show(root, name)["task"].clone();
        let (exit, value) = cli(root, &["challenge", name]);
        assert_eq!(
            exit,
            if kind == "positive" { 0 } else { 1 },
            "{kind}: {value}"
        );
        assert_eq!(value["assignment_clear"], kind == "positive", "{value}");
        let after = show(root, name)["task"].clone();
        let mut expected = checkpoint;
        if kind == "positive" {
            assert!(!after["challenged"].is_null());
            expected["challenged"] = after["challenged"].clone();
        } else {
            expected.as_object_mut().unwrap().remove("challenged");
            assert!(after["challenged"].is_null());
        }
        assert_eq!(after, expected);
        assert_eq!(after["state"], "ready");
        assert_eq!(after["acceptance_epoch"], before["acceptance_epoch"]);
        assert_eq!(after["evidence"], before["evidence"]);
        assert_eq!(after["review_of"], before["review_of"]);
    }
}

#[test]
fn newly_observed_obligations_are_remembered_without_automatic_dispositions() {
    let temp = fixture();
    let root = temp.path();
    let process = std::fs::read_to_string(root.join("process.bla")).unwrap();
    write(
        root,
        "process.bla",
        &format!(
            "{process}\npolicy \"new-obligation\" {{ applies_to [\"worker\"] statement \"Inspect the new obligation explicitly\" }}\n"
        ),
    );
    let before = show(root, "work")["task"].clone();
    let (exit, value) = disposition(root, "work", "goal::deliver", "worker", true);
    assert_eq!(exit, 0, "{value}");
    let observed = show(root, "work");
    let after = &observed["task"];
    assert!(
        after["intent_identities"]
            .as_array()
            .unwrap()
            .contains(&json!("policy::new-obligation"))
    );
    assert!(
        !after["intent_dispositions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["identity"] == "policy::new-obligation")
    );
    let row = observed["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["identity"] == "policy::new-obligation")
        .unwrap();
    assert_eq!(row["state"], "missing");
    for key in [
        "state",
        "acceptance_epoch",
        "accepted",
        "evidence",
        "scope",
        "check_inputs",
        "review_of",
        "goal_reflection",
    ] {
        assert_eq!(after[key], before[key], "{key}");
    }
    write(root, "process.bla", &process);
    let removed = show(root, "work");
    let row = removed["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["identity"] == "policy::new-obligation")
        .unwrap();
    assert_eq!(row["state"], "missing");
    assert_eq!(
        disposition(root, "work", "policy::new-obligation", "worker", true).0,
        0
    );
    let accounted = show(root, "work");
    let row = accounted["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["identity"] == "policy::new-obligation")
        .unwrap();
    assert_eq!(row["state"], "current");
}

#[test]
fn reflection_refresh_remembers_new_obligations_after_declaration_removal() {
    let temp = fixture();
    let root = temp.path();
    let process = std::fs::read_to_string(root.join("process.bla")).unwrap();
    write(
        root,
        "process.bla",
        &format!(
            "{process}\npolicy \"new-obligation\" {{ applies_to [\"worker\"] statement \"Inspect the new obligation explicitly\" }}\n"
        ),
    );
    let before = show(root, "work")["task"].clone();
    let (exit, value) = reflection(root, "work", "worker", true);
    assert_eq!(exit, 0, "{value}");
    let observed = show(root, "work");
    let after = &observed["task"];
    assert!(
        after["intent_identities"]
            .as_array()
            .unwrap()
            .contains(&json!("policy::new-obligation"))
    );
    assert!(
        !after["intent_dispositions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["identity"] == "policy::new-obligation")
    );
    let row = observed["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["identity"] == "policy::new-obligation")
        .unwrap();
    assert_eq!(row["state"], "missing");
    for key in [
        "state",
        "acceptance_epoch",
        "accepted",
        "evidence",
        "scope",
        "check_inputs",
        "review_of",
        "intent_dispositions",
    ] {
        assert_eq!(after[key], before[key], "{key}");
    }
    write(root, "process.bla", &process);
    let removed = show(root, "work");
    let row = removed["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["identity"] == "policy::new-obligation")
        .unwrap();
    assert_eq!(row["state"], "missing");
    assert_eq!(
        disposition(root, "work", "policy::new-obligation", "worker", true).0,
        0
    );
    let accounted = show(root, "work");
    let row = accounted["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["identity"] == "policy::new-obligation")
        .unwrap();
    assert_eq!(row["state"], "current");
}
