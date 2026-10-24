use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path};
use tempfile::TempDir;
#[path = "support/cli.rs"]
mod support;

fn cli(root: &Path, args: &[&str]) -> (i32, Value) {
    let mut all = vec!["--json"];
    all.extend_from_slice(args);
    let out = support::run_in(Some(root), &support::args(&all));
    (
        out.status.code().unwrap(),
        serde_json::from_slice(&out.stdout).unwrap(),
    )
}
fn ok(root: &Path, args: &[&str]) -> Value {
    let (exit, value) = cli(root, args);
    assert_eq!(exit, 0, "{args:?}: {value}");
    value
}
fn text(root: &Path, args: &[&str]) -> String {
    String::from_utf8(support::run_in(Some(root), &support::args(args)).stdout).unwrap()
}
fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, path: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for e in std::fs::read_dir(path).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                walk(root, &p, out);
            } else {
                out.insert(
                    p.strip_prefix(root).unwrap().to_string_lossy().into(),
                    std::fs::read(p).unwrap(),
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}
fn fixture() -> TempDir {
    let t = TempDir::new().unwrap();
    let r = t.path();
    for (p, s) in [
        (
            "project.bla",
            "project Origin\nuse structure \"entry.bla\"\nprocess \"process.bla\"\ngoal \"goals.bla\"\n",
        ),
        (
            "entry.bla",
            "module app \"app.rs\"\nrequire \"entry\": symbol app::run\n",
        ),
        ("app.rs", "pub fn run() {}\n"),
        (
            "process.bla",
            "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\n",
        ),
        (
            "goals.bla",
            "goal \"viewer\" { statement \"Visible result\" expect [\"contract::entry\"] state \"active\" delivery \"required\" }\n",
        ),
    ] {
        std::fs::write(r.join(p), s).unwrap();
    }
    ok(
        r,
        &[
            "task",
            "open",
            "origin",
            "--role",
            "worker",
            "--statement",
            "A bounded change",
            "--scope",
            "app.rs",
            "--goal",
            "viewer",
            "--input",
            "app.rs",
            "--check-argv",
            "python3",
            "-c",
            "print('actual fixture check')",
        ],
    );
    ok(r, &["task", "accept", "origin", "--model", "worker"]);
    t
}
fn synthetic_record(root: &Path, change: impl FnOnce(&mut Value)) {
    let path = root.join(".blabla/tasks/origin.json");
    let mut value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    change(&mut value);
    std::fs::write(path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
}
fn inspect(root: &Path, role: Value, state: &str, owner: Value) {
    let before = tree(root);
    let (_, status) = cli(root, &["status"]);
    let goal = ok(root, &["explain", "goal::viewer"]);
    assert_eq!(status["delivery"], goal["delivery"]);
    assert_eq!(status["delivery"]["total"], 1);
    assert_eq!(status["delivery"]["omitted"], 0);
    assert_eq!(status["delivery"]["state"], "unresolved");
    let row = &status["delivery"]["residuals"][0];
    assert_eq!(row["origin_role"], role);
    assert_eq!(row["source_state"], state);
    assert_eq!(row["owner"], owner);
    for args in [vec!["status"], vec!["explain", "goal::viewer"]] {
        let out = text(root, &args);
        if let Some(owner) = owner.as_str() {
            assert!(out.contains(&format!("owner {owner}")), "{out}");
            assert!(!out.contains("delivery owner not recorded"));
        } else {
            let role = role
                .as_str()
                .map(|r| format!("role::{r}"))
                .unwrap_or("unknown".into());
            assert!(
                out.contains(&format!(
                    "delivery owner not recorded; origin {role} ({state})"
                )),
                "{out}"
            );
            assert!(!out.contains("owner unassigned"));
        }
    }
    assert_eq!(
        tree(root),
        before,
        "read-only projection changed fixture bytes"
    );
}

#[test]
fn actual_accepted_and_withdrawn_origins_keep_unclaimed_ownership() {
    let t = fixture();
    let r = t.path();
    let refusal_before = cli(r, &["task", "close", "origin", "--model", "owner"]);
    inspect(r, json!("worker"), "accepted", Value::Null);
    assert_eq!(
        cli(r, &["task", "close", "origin", "--model", "owner"]),
        refusal_before
    );
    assert_eq!(refusal_before.0, 2);
    ok(
        r,
        &[
            "task",
            "withdraw",
            "origin",
            "--reason",
            "Stop this fixture assignment",
            "--model",
            "owner",
        ],
    );
    inspect(r, json!("worker"), "withdrawn", Value::Null);
}

#[test]
fn synthetic_historical_closed_and_roleless_records_do_not_invent_owners() {
    let t = fixture();
    let r = t.path();
    synthetic_record(r, |v| {
        v["state"] = json!("closed");
        v["closed_unix"] = json!(1);
    });
    inspect(r, json!("worker"), "closed", Value::Null);
    synthetic_record(r, |v| {
        v["role"] = json!("");
    });
    inspect(r, Value::Null, "closed", Value::Null);
}

#[test]
fn explicit_partial_owner_remains_distinct_from_origin_role() {
    let t = fixture();
    let r = t.path();
    ok(r, &["task", "evidence", "origin", "--run"]);
    ok(
        r,
        &[
            "task",
            "delivery",
            "origin",
            "viewer",
            "--status",
            "partial",
            "--observation",
            "Synthetic source check observed",
            "--observation-ref",
            r#"{"kind":"verification","locator":"app.rs","context":"Source fixture only"}"#,
            "--delivered",
            "Checked source",
            "--remaining",
            "Actual viewport observation",
            "--owner",
            "viewer-owner",
            "--next",
            "Inspect actual viewport",
            "--model",
            "worker",
        ],
    );
    inspect(r, json!("worker"), "accepted", json!("viewer-owner"));
}

#[test]
fn synthetic_stale_successor_reflection_is_not_promoted_to_delivery_owner() {
    let t = fixture();
    let r = t.path();
    synthetic_record(r, |v| {
        v["state"] = json!("closed");
        v["goal_reflection"] = json!({
            "decision":"Historical next step", "observation":"Old source outcome",
            "evidence_refs":["app.rs"], "reason":"Historical recommendation only",
            "outcome":{"kind":"successor", "recommendation":"A future viewer task", "owner":"historical-adviser", "dependencies":[], "observable_outcome":"A viewed result"},
            "model":"worker", "unix":1,
            "revision":{"acceptance_epoch":0,"task_digest":"stale","paths":{},"identities":{}}
        });
    });
    inspect(r, json!("worker"), "closed", Value::Null);
    assert!(!text(r, &["status"]).contains("historical-adviser"));
}
