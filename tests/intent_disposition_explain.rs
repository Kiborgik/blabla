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

fn cli(temp: &TempDir, args: &[&str]) -> (i32, Value) {
    let mut arguments = vec!["--json"];
    arguments.extend(args);
    let output = support::run_in(Some(temp.path()), &support::args(&arguments));
    let value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        panic!(
            "stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
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
        "project Changes\nuse structure \"entry.bla\"\nprocess \"process.bla\"\ngoal \"goals.bla\"\nsystem \"system.bla\"\n",
    );
    write(
        temp.path(),
        "entry.bla",
        "module app \"core/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(
        temp.path(),
        "process.bla",
        "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\npolicy \"bounded\" { applies_to [\"worker\"] statement \"Stay within scope\" }\n",
    );
    write(
        temp.path(),
        "goals.bla",
        "goal \"deliver\" { statement \"Deliver the entry\" expect [\"contract::entry\"] state \"active\" }\n",
    );
    write(
        temp.path(),
        "system.bla",
        "system \"app\" { purpose \"Own the entry\" paths [\"core/\"] }\nsystem \"elsewhere\" { purpose \"Unrelated work\" paths [\"elsewhere/\"] }\n",
    );
    write(temp.path(), "core/app.rs", "pub fn run() {}\n");
    write(temp.path(), "core/extra.rs", "pub fn extra() {}\n");
    write(temp.path(), "optional.txt", "optional input\n");
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
            "core/app.rs",
            "--goal",
            "deliver",
            "--require-intent-disposition",
            "--input",
            "core",
            "check.py",
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    temp
}

fn show(temp: &TempDir) -> Value {
    success(temp, &["task", "show", "work"])
}

fn row<'a>(view: &'a Value, identity: &str) -> &'a Value {
    view["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["identity"] == identity)
        .unwrap()
}

fn disposition(temp: &TempDir, identity: &str) {
    success(
        temp,
        &[
            "task",
            "disposition",
            "work",
            identity,
            "--status",
            "confirmed-unchanged",
            "--reason",
            "The callable entry preserves this recorded boundary",
            "--model",
            "worker",
        ],
    );
}

fn complete(temp: &TempDir) {
    let identities: Vec<String> = show(temp)["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["identity"].as_str().unwrap().to_owned())
        .collect();
    for identity in identities {
        disposition(temp, &identity);
    }
}

fn amend_record(temp: &TempDir, change: impl FnOnce(&mut Value)) {
    let path = temp.path().join(".blabla/tasks/work.json");
    let mut value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    change(&mut value);
    std::fs::write(path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
}

fn files(root: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut result = BTreeMap::new();
    for entry in std::fs::read_dir(root).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type().unwrap().is_dir() {
            for (child, bytes) in files(&entry.path()) {
                result.insert(format!("{name}/{child}"), bytes);
            }
        } else {
            result.insert(name, std::fs::read(entry.path()).unwrap());
        }
    }
    result
}

#[test]
fn missing_receipts_have_no_invented_revision_and_current_receipts_have_empty_deltas() {
    let temp = fixture();
    let view = show(&temp);
    let missing = row(&view, "system::app");
    assert_eq!(missing["state"], "missing");
    assert_eq!(missing.get("freshness"), Some(&Value::Null));
    complete(&temp);
    let view = show(&temp);
    for row in view["affected_intent"].as_array().unwrap() {
        assert_eq!(row["state"], "current");
        assert_eq!(
            row["freshness"],
            json!({"acceptance_epoch": null, "assignment_digest_changed": false, "changed_paths": [], "changed_identities": [], "own_identity_fingerprint_changed": false, "claim_problems": []})
        );
    }
}

#[test]
fn broad_input_change_explains_shared_staleness_without_inventing_a_child_file() {
    let temp = fixture();
    complete(&temp);
    write(
        temp.path(),
        "core/extra.rs",
        "pub fn extra() { let _ = 1; }\n",
    );
    let view = show(&temp);
    for row in view["affected_intent"].as_array().unwrap() {
        assert_eq!(row["state"], "stale");
        let freshness = &row["freshness"];
        assert_eq!(freshness["acceptance_epoch"], Value::Null);
        assert_eq!(freshness["assignment_digest_changed"], false);
        assert_eq!(freshness["own_identity_fingerprint_changed"], false);
        assert_eq!(freshness["changed_identities"], json!([]));
        let paths = freshness["changed_paths"].as_array().unwrap();
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0]["path"], "core");
        assert_eq!(paths[0]["change"], "changed");
        assert_ne!(paths[0]["recorded"], paths[0]["current"]);
    }
}

#[test]
fn one_identity_change_is_named_for_all_receipts_without_implying_their_own_identity_changed() {
    let temp = fixture();
    complete(&temp);
    let text = std::fs::read_to_string(temp.path().join("system.bla")).unwrap();
    write(
        temp.path(),
        "system.bla",
        &text.replace("Own the entry", "Own the revised entry"),
    );
    let view = show(&temp);
    for row in view["affected_intent"].as_array().unwrap() {
        assert_eq!(row["state"], "stale");
        assert_eq!(row["freshness"]["changed_paths"], json!([]));
        assert_eq!(
            row["freshness"]["own_identity_fingerprint_changed"],
            row["identity"] == "system::app"
        );
        let changes = row["freshness"]["changed_identities"].as_array().unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0]["identity"], "system::app");
        assert_eq!(changes[0]["change"], "changed");
    }
}

#[test]
fn new_epoch_reports_its_exact_delta_and_an_opaque_assignment_digest_change() {
    let temp = fixture();
    complete(&temp);
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    let view = show(&temp);
    let freshness = &row(&view, "system::app")["freshness"];
    assert_eq!(
        freshness["acceptance_epoch"],
        json!({"recorded": 1, "current": 2})
    );
    assert_eq!(freshness["assignment_digest_changed"], true);
    assert_eq!(freshness["changed_paths"], json!([]));
    assert_eq!(freshness["changed_identities"], json!([]));
}

#[test]
fn assignment_amendment_does_not_invent_a_field_level_history() {
    let temp = fixture();
    complete(&temp);
    success(
        &temp,
        &[
            "task",
            "statement",
            "work",
            "An amended scoped result",
            "--model",
            "owner",
        ],
    );
    let view = show(&temp);
    let freshness = &row(&view, "system::app")["freshness"];
    assert_eq!(freshness["acceptance_epoch"], Value::Null);
    assert_eq!(freshness["assignment_digest_changed"], true);
    assert!(freshness.get("changed_assignment_fields").is_none());
    assert_eq!(freshness["changed_paths"], json!([]));
}

#[test]
fn added_and_removed_tracked_keys_are_distinct_from_missing_observed_files() {
    let temp = fixture();
    complete(&temp);
    amend_record(&temp, |record| {
        record["check_inputs"] = json!(["core/app.rs", "optional.txt"])
    });
    let view = show(&temp);
    let paths = row(&view, "system::app")["freshness"]["changed_paths"]
        .as_array()
        .unwrap();
    let names: Vec<_> = paths
        .iter()
        .map(|path| path["path"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["check.py", "core", "optional.txt"]);
    assert_eq!(paths[0]["change"], "removed");
    assert!(paths[0]["recorded"].is_string());
    assert_eq!(paths[0]["current"], Value::Null);
    assert_eq!(paths[2]["change"], "added");
    assert_eq!(paths[2]["recorded"], Value::Null);
    assert!(paths[2]["current"].is_string());
    complete(&temp);
    std::fs::remove_file(temp.path().join("optional.txt")).unwrap();
    let view = show(&temp);
    let paths = row(&view, "system::app")["freshness"]["changed_paths"]
        .as_array()
        .unwrap();
    assert_eq!(paths.len(), 1);
    assert_eq!(paths[0]["path"], "optional.txt");
    assert_eq!(paths[0]["change"], "changed");
    assert!(paths[0]["recorded"].is_string());
    assert_eq!(paths[0]["current"], Value::Null);
}

#[test]
fn removed_intent_keeps_its_explicit_absence_fingerprint() {
    let temp = fixture();
    complete(&temp);
    write(
        temp.path(),
        "goals.bla",
        "goal \"other\" { statement \"Another goal\" expect [\"contract::entry\"] state \"active\" }\n",
    );
    let view = show(&temp);
    let goal = row(&view, "goal::deliver");
    assert_eq!(goal["state"], "stale");
    assert_eq!(goal["freshness"]["own_identity_fingerprint_changed"], true);
    let changes = goal["freshness"]["changed_identities"].as_array().unwrap();
    let old = changes
        .iter()
        .find(|change| change["identity"] == "goal::deliver")
        .unwrap();
    assert_eq!(old["change"], "changed");
    assert_eq!(old["current"], "absent");
}

#[test]
fn receipts_from_different_revisions_get_their_own_deltas() {
    let temp = fixture();
    complete(&temp);
    write(temp.path(), "core/extra.rs", "pub fn changed() {}\n");
    disposition(&temp, "system::app");
    let view = show(&temp);
    assert_eq!(row(&view, "system::app")["state"], "current");
    assert_eq!(
        row(&view, "system::app")["freshness"]["changed_paths"],
        json!([])
    );
    assert_eq!(row(&view, "role::worker")["state"], "stale");
    assert_eq!(
        row(&view, "role::worker")["freshness"]["changed_paths"][0]["path"],
        "core"
    );
}

#[test]
fn invalid_claims_are_explained_even_when_revisions_are_equal() {
    for problem in [
        "acceptance-missing",
        "accepted-model-mismatch",
        "invalid-status",
        "blank-reason",
    ] {
        let temp = fixture();
        complete(&temp);
        amend_record(&temp, |record| {
            if problem == "acceptance-missing" {
                record["accepted"] = Value::Null;
                return;
            }
            let receipt = record["intent_dispositions"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|receipt| receipt["identity"] == "system::app")
                .unwrap();
            match problem {
                "accepted-model-mismatch" => receipt["model"] = json!("someone-else"),
                "invalid-status" => receipt["status"] = json!("invented"),
                "blank-reason" => receipt["reason"] = json!(" \n"),
                _ => unreachable!(),
            }
        });
        let view = show(&temp);
        let actual = row(&view, "system::app");
        assert_eq!(actual["state"], "stale");
        let freshness = &actual["freshness"];
        assert_eq!(freshness["claim_problems"], json!([problem]));
        assert_eq!(freshness["acceptance_epoch"], Value::Null);
        assert_eq!(freshness["assignment_digest_changed"], false);
        assert_eq!(freshness["changed_paths"], json!([]));
        assert_eq!(freshness["changed_identities"], json!([]));
    }
}

#[test]
fn explanation_is_deterministic_read_only_and_does_not_change_challenge_or_readiness() {
    let temp = fixture();
    complete(&temp);
    success(&temp, &["task", "evidence", "work", "--run"]);
    write(temp.path(), "core/extra.rs", "pub fn changed() {}\n");
    let challenge_before = cli(&temp, &["challenge", "work"]);
    let ready_before = cli(&temp, &["task", "ready", "work"]);
    let before = files(temp.path());
    let first = show(&temp);
    assert_eq!(show(&temp), first);
    let output = support::run_in(Some(temp.path()), &support::args(&["task", "show", "work"]));
    assert!(output.status.success());
    let human = String::from_utf8(output.stdout).unwrap();
    assert!(human.contains("Shared input changes"));
    assert!(human.contains("core (changed)"));
    assert!(human.contains("Own identity fingerprint: unchanged"));
    assert!(human.contains("directory fingerprints do not identify changed child files"));
    assert_eq!(files(temp.path()), before);
    let challenge_after = cli(&temp, &["challenge", "work"]);
    let ready_after = cli(&temp, &["task", "ready", "work"]);
    assert_eq!(challenge_after.0, challenge_before.0);
    assert_eq!(
        challenge_after.1["assignment_blockers"],
        challenge_before.1["assignment_blockers"]
    );
    assert_eq!(ready_after, ready_before);
}

#[test]
fn unrelated_intent_change_leaves_current_receipts_without_deltas() {
    let temp = fixture();
    complete(&temp);
    let text = std::fs::read_to_string(temp.path().join("system.bla")).unwrap();
    write(
        temp.path(),
        "system.bla",
        &text.replace("Unrelated work", "Unrelated amended work"),
    );
    let view = show(&temp);
    assert_eq!(view["intent_disposition_current"], true);
    assert_eq!(
        row(&view, "system::app")["freshness"]["changed_identities"],
        json!([])
    );
}
