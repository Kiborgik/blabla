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
    let mut arguments = vec!["--json"];
    arguments.extend_from_slice(args);
    let output = support::run_in(Some(root), &support::args(&arguments));
    let value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        json!({"stdout":String::from_utf8_lossy(&output.stdout),"stderr":String::from_utf8_lossy(&output.stderr)})
    });
    (output.status.code().unwrap(), value)
}

fn success(root: &Path, args: &[&str]) -> Value {
    let (exit, value) = cli(root, args);
    assert_eq!(exit, 0, "{args:?}: {value}");
    value
}

fn files(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn visit(root: &Path, here: &Path, found: &mut BTreeMap<String, Vec<u8>>) {
        for entry in std::fs::read_dir(here).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                visit(root, &path, found);
            } else {
                found.insert(
                    path.strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                    std::fs::read(path).unwrap(),
                );
            }
        }
    }
    let mut found = BTreeMap::new();
    visit(root, root, &mut found);
    found
}

fn refused(root: &Path, args: &[&str]) -> Value {
    let before = files(root);
    let (exit, value) = cli(root, args);
    assert_eq!(exit, 2, "{args:?}: {value}");
    assert_eq!(files(root), before, "refusal changed files: {args:?}");
    value
}

const OBSERVATION: &str = r#"{"kind":"artifact","locator":"observation.txt","context":"Inspected synthetic fixture observation, not a deployed outcome"}"#;

fn claim_args<'a>(name: &'a str, goal: &'a str, model: &'a str, refresh: bool) -> Vec<&'a str> {
    let mut args = vec![
        "task",
        "delivery",
        name,
        goal,
        "--status",
        "partial",
        "--observation",
        "Explicitly reinspected this fixture's source-only outcome",
        "--observation-ref",
        OBSERVATION,
        "--delivered",
        "The fixture source behavior is checked",
        "--remaining",
        "An independently observed deployment remains",
        "--owner",
        "release-owner",
        "--next",
        "Authorize and observe deployment",
        "--model",
        model,
    ];
    if refresh {
        args.push("--refresh-ready");
    }
    args
}

fn show(root: &Path, name: &str) -> Value {
    success(root, &["task", "show", name])
}

fn handback(root: &Path, name: &str) {
    let (_, challenge) = cli(root, &["challenge", name]);
    assert_eq!(challenge["assignment_clear"], true, "{challenge}");
    success(root, &["task", "ready", name]);
}

fn fixture() -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "project.bla",
        "project RefreshDelivery\nuse structure \"entry.bla\"\nprocess \"process.bla\"\ngoal \"goals.bla\"\n",
    );
    write(
        root,
        "entry.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(root, "src/app.rs", "pub fn run() {}\n");
    write(
        root,
        "observation.txt",
        "Observed fixture source only; deployment not delivered\n",
    );
    write(
        root,
        "process.bla",
        "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\nrole \"reviewer\" { purpose \"Review\" model \"reviewer\" }\n",
    );
    write(
        root,
        "goals.bla",
        "goal \"deliver\" { statement \"Observe the source outcome\" expect [\"contract::entry\"] state \"active\" delivery \"required\" }\ngoal \"other\" { statement \"Observe a separate outcome\" expect [\"contract::entry\"] state \"active\" delivery \"required\" }\n",
    );
    write(
        root,
        "check.py",
        "from pathlib import Path\nassert 'pub fn run' in Path('src/app.rs').read_text()\np=Path('.blabla/check-count')\np.write_text(str(int(p.read_text())+1) if p.exists() else '1')\n",
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
            "Checked source and explicit delivery residual",
            "--scope",
            "src",
            "--goal",
            "deliver",
            "--delivery-goal",
            "other",
            "--input",
            "src",
            "check.py",
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    success(root, &["task", "accept", "work", "--model", "worker"]);
    success(root, &["task", "evidence", "work", "--run"]);
    for goal in ["deliver", "other"] {
        success(root, &claim_args("work", goal, "worker", false));
    }
    handback(root, "work");
    temp
}

fn review(root: &Path, name: &str, target: &str) {
    success(
        root,
        &[
            "task",
            "open",
            name,
            "--role",
            "reviewer",
            "--statement",
            "Read the complete source target",
            "--review-of",
            target,
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
    success(root, &["task", "accept", name, "--model", "reviewer"]);
    success(root, &["task", "evidence", name, "--run"]);
    success(root, &claim_args(name, "deliver", "reviewer", false));
    handback(root, name);
}

#[test]
fn goal_only_refresh_records_one_explicit_partial_claim_without_execution_or_acceptance() {
    let temp = fixture();
    let root = temp.path();
    let before = show(root, "work");
    let goals = std::fs::read_to_string(root.join("goals.bla")).unwrap();
    write(
        root,
        "goals.bla",
        &goals.replace(
            "Observe the source outcome",
            "Observe the source outcome and keep its deployment residual explicit",
        ),
    );
    success(
        root,
        &[
            "task",
            "attribute",
            "work",
            "goals.bla",
            "--kind",
            "concurrent",
            "--model",
            "owner",
        ],
    );
    assert_eq!(show(root, "work")["delivery"]["claims_current"], false);
    let (_, challenge) = cli(root, &["challenge", "work"]);
    assert_eq!(
        challenge["assignment_recovery"]["action"],
        "inspect-manual-receipts"
    );
    assert_eq!(
        challenge["assignment_recovery"]["blocker"],
        "goal-delivery-claim-missing"
    );
    success(root, &claim_args("work", "deliver", "worker", true));
    let one = show(root, "work");
    assert_eq!(one["task"]["state"], "ready");
    assert_eq!(one["task"]["evidence"], before["task"]["evidence"]);
    assert_eq!(
        one["task"]["acceptance_epoch"],
        before["task"]["acceptance_epoch"]
    );
    assert_eq!(one["task"]["accepted"], before["task"]["accepted"]);
    assert_eq!(
        one["task"]["delivery_obligations"]["goal::other"],
        before["task"]["delivery_obligations"]["goal::other"]
    );
    assert_eq!(
        one["delivery"]["claims_current"], false,
        "another goal is not automatically attested"
    );
    assert_eq!(
        one["task"]["delivery_obligations"]["goal::deliver"]["claim"]["status"],
        "partial"
    );
    assert!(one["task"]["challenged"].is_null());
    success(root, &claim_args("work", "other", "worker", true));
    assert_eq!(show(root, "work")["delivery"]["claims_current"], true);
    let (_, challenge) = cli(root, &["challenge", "work"]);
    assert_eq!(challenge["assignment_clear"], true, "{challenge}");
    assert_eq!(challenge["assignment_recovery"]["action"], "await-review");
    let after = show(root, "work");
    assert_eq!(after["task"]["state"], "ready");
    assert_eq!(after["task"]["evidence"], before["task"]["evidence"]);
    assert_eq!(after["task"]["accepted"], before["task"]["accepted"]);
    assert_eq!(
        after["task"]["acceptance_epoch"],
        before["task"]["acceptance_epoch"]
    );
    assert_eq!(
        std::fs::read_to_string(root.join(".blabla/check-count")).unwrap(),
        "1"
    );
}

#[test]
fn refresh_is_explicit_ready_only_and_same_model() {
    let temp = fixture();
    let root = temp.path();
    refused(root, &claim_args("work", "deliver", "worker", false));
    refused(root, &claim_args("work", "deliver", "reviewer", true));
    success(root, &["task", "accept", "work", "--model", "worker"]);
    refused(root, &claim_args("work", "deliver", "worker", true));
    success(root, &["task", "evidence", "work", "--run"]);
    success(root, &claim_args("work", "deliver", "worker", false));
    assert_eq!(show(root, "work")["task"]["state"], "accepted");
    success(
        root,
        &[
            "task",
            "withdraw",
            "work",
            "--reason",
            "Synthetic lifecycle boundary",
            "--model",
            "owner",
        ],
    );
    refused(root, &claim_args("work", "deliver", "worker", true));
}

#[test]
fn changed_source_or_check_refuses_without_writing_or_running() {
    for change in ["source", "check-source", "argv"] {
        let temp = fixture();
        let root = temp.path();
        match change {
            "source" => write(root, "src/app.rs", "pub fn run() { let changed = 1; }\n"),
            "check-source" => write(root, "check.py", "raise RuntimeError('changed check')\n"),
            _ => {
                success(
                    root,
                    &[
                        "task", "check", "work", "--input", "src", "check.py", "--argv", "python3",
                        "check.py", "changed",
                    ],
                );
            }
        }
        refused(root, &claim_args("work", "deliver", "worker", true));
        assert_eq!(
            std::fs::read_to_string(root.join(".blabla/check-count")).unwrap(),
            "1"
        );
    }
}

#[test]
fn revoked_authority_and_missing_or_failed_evidence_refuse_without_writes() {
    for change in ["authority", "missing-evidence", "failed-evidence"] {
        let temp = fixture();
        let root = temp.path();
        if change == "authority" {
            let process = std::fs::read_to_string(root.join("process.bla")).unwrap();
            write(
                root,
                "process.bla",
                &process.replace("model \"worker\"", "model \"replacement\""),
            );
        } else {
            let path = root.join(".blabla/tasks/work.json");
            let mut task: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            if change == "missing-evidence" {
                task["evidence"] = json!([]);
            } else {
                task["evidence"][0]["exit"] = json!(1);
            }
            std::fs::write(path, serde_json::to_vec(&task).unwrap()).unwrap();
        }
        refused(root, &claim_args("work", "deliver", "worker", true));
    }
}

#[test]
fn missing_or_ignored_observation_refuses_without_erasing_previous_claim() {
    for ignored in [false, true] {
        let temp = fixture();
        let root = temp.path();
        let before = show(root, "work")["task"]["delivery_obligations"].clone();
        let mut args = claim_args("work", "deliver", "worker", true);
        let reference = if ignored {
            write(root, ".blabla/ignored.txt", "Not a tracked observation\n");
            r#"{"kind":"artifact","locator":".blabla/ignored.txt","context":"Synthetic ignored reference"}"#
        } else {
            std::fs::remove_file(root.join("observation.txt")).unwrap();
            OBSERVATION
        };
        let index = args
            .iter()
            .position(|arg| *arg == "--observation-ref")
            .unwrap();
        args[index + 1] = reference;
        refused(root, &args);
        assert_eq!(show(root, "work")["task"]["delivery_obligations"], before);
    }
}

#[test]
fn explicitly_reinspected_observation_is_rehashed_not_inferred_from_execution() {
    let temp = fixture();
    let root = temp.path();
    let before = show(root, "work");
    write(
        root,
        "observation.txt",
        "New explicitly reinspected synthetic observation; still no deployed claim\n",
    );
    success(root, &claim_args("work", "deliver", "worker", true));
    let after = show(root, "work");
    assert_ne!(
        after["task"]["delivery_obligations"]["goal::deliver"]["claim"]["artifacts"],
        before["task"]["delivery_obligations"]["goal::deliver"]["claim"]["artifacts"]
    );
    assert_eq!(after["task"]["evidence"], before["task"]["evidence"]);
    assert_eq!(after["task"]["state"], "ready");
    assert_eq!(
        std::fs::read_to_string(root.join(".blabla/check-count")).unwrap(),
        "1"
    );
}

#[test]
fn stale_recursive_review_target_cannot_be_repinned_by_delivery_refresh() {
    let temp = fixture();
    let root = temp.path();
    review(root, "inner", "work");
    review(root, "outer", "inner");
    success(root, &["task", "accept", "work", "--model", "worker"]);
    assert_eq!(show(root, "outer")["review_current"], false);
    refused(root, &claim_args("outer", "deliver", "reviewer", true));
    assert_eq!(
        std::fs::read_to_string(root.join(".blabla/check-count")).unwrap(),
        "3"
    );
}

#[test]
fn refresh_does_not_relax_claim_completeness_or_delivery_review_authority() {
    let temp = fixture();
    let root = temp.path();
    let mut args = claim_args("work", "deliver", "worker", true);
    let remaining = args.iter().position(|arg| *arg == "--remaining").unwrap();
    args[remaining + 1] = "";
    refused(root, &args);
    let mut args = claim_args("work", "deliver", "worker", true);
    let status = args.iter().position(|arg| *arg == "--status").unwrap();
    args[status + 1] = "delivered";
    let reference = args
        .iter()
        .position(|arg| *arg == "--observation-ref")
        .unwrap();
    args[reference + 1] = r#"{"kind":"verification","locator":"check.py","context":"Only source verification, not delivery"}"#;
    refused(root, &args);
    refused(
        root,
        &[
            "task",
            "delivery-review",
            "work",
            "deliver",
            "--verdict",
            "accepted",
            "--observation-ref",
            OBSERVATION,
            "--reason",
            "Not an independent accepted review",
            "--model",
            "worker",
        ],
    );
}
