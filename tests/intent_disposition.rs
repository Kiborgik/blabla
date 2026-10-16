use blabla::project::task;
use serde_json::{Value, json};
use std::path::Path;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;

fn write(root: &Path, path: &str, text: &str) {
    let target = root.join(path);
    std::fs::create_dir_all(target.parent().unwrap()).unwrap();
    std::fs::write(target, text).unwrap();
}

fn cli(temp: &TempDir, arguments: &[&str]) -> (i32, Value) {
    let mut all = vec!["--json"];
    all.extend_from_slice(arguments);
    let output = support::run_in(Some(temp.path()), &support::args(&all));
    let value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        panic!(
            "{arguments:?}: stdout {} stderr {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    });
    (output.status.code().unwrap(), value)
}

fn success(temp: &TempDir, arguments: &[&str]) -> Value {
    let (code, value) = cli(temp, arguments);
    assert_eq!(code, 0, "{arguments:?}: {value}");
    value
}

fn fixture() -> TempDir {
    let temp = TempDir::new().unwrap();
    write(
        temp.path(),
        "project.bla",
        "project Intent\nuse structure \"architecture.bla\"\nmission \"mission.bla\"\nsystem \"system.bla\"\nprocess \"process.bla\"\ngoal \"goals.bla\"\nknowledge \"knowledge.bla\"\n",
    );
    write(
        temp.path(),
        "architecture.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(temp.path(), "src/app.rs", "pub fn run() {}\n");
    write(temp.path(), "src/extra.rs", "pub fn extra() {}\n");
    write(
        temp.path(),
        "tests/check.py",
        "from pathlib import Path\nassert Path('src/app.rs').exists()\n",
    );
    write(
        temp.path(),
        "mission.bla",
        "mission \"demo\" { statement \"Keep accountable intent current\" }\npriority \"truth\" { statement \"Evidence before claims\" }\n",
    );
    write(
        temp.path(),
        "goals.bla",
        "goal \"deliver\" { serves [\"truth\"] statement \"Deliver the intended entry\" expect [\"contract::architecture\"] state \"active\" }\n",
    );
    write(
        temp.path(),
        "system.bla",
        "system \"app\" { purpose \"Own the entry\" paths [\"src/\"] knowledge [\"engineering\"] }\nsystem \"elsewhere\" { purpose \"Independent responsibility\" paths [\"other/\"] }\nresponsibility \"entry\" { owner \"app\" statement \"Keep the entry callable\" }\nseam \"handoff\" { between [\"app\", \"elsewhere\"] value \"Call\" statement \"Exchange committed values\" }\n",
    );
    write(
        temp.path(),
        "process.bla",
        "role \"orchestrator\" { purpose \"Assign and close\" model \"owner\" }\nrole \"worker\" { purpose \"Carry a slice\" model \"worker\" }\npolicy \"bounded\" { applies_to [\"worker\"] statement \"Work only inside scope\" }\n",
    );
    write(
        temp.path(),
        "knowledge.bla",
        "knowledge \"engineering\" { purpose \"Assess responsibility boundaries\" }\nruling \"separate\" { pack \"engineering\" statement \"Keep one reason to change\" }\n",
    );
    success(&temp, &["check"]);
    success(
        &temp,
        &[
            "task",
            "open",
            "work",
            "--role",
            "worker",
            "--statement",
            "Keep the entry aligned",
            "--scope",
            "src",
            "--goal",
            "deliver",
            "--input",
            "src/app.rs",
            "tests/check.py",
            "--check-argv",
            "python",
            "tests/check.py",
        ],
    );
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    temp
}

fn require_via_record(temp: &TempDir) {
    let path = temp.path().join(".blabla/tasks/work.json");
    let mut record: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    record["intent_disposition_required"] = json!(true);
    std::fs::write(path, serde_json::to_vec_pretty(&record).unwrap()).unwrap();
}

fn affected(temp: &TempDir) -> Vec<String> {
    success(temp, &["task", "show", "work"])["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["identity"].as_str().unwrap().to_owned())
        .collect()
}

fn disposition(temp: &TempDir, identity: &str, status: &str) {
    success(
        temp,
        &[
            "task",
            "disposition",
            "work",
            identity,
            "--status",
            status,
            "--reason",
            "src/app.rs retains its public entry; tests/check.py checks the bounded implementation",
            "--model",
            "worker",
        ],
    );
}

fn complete(temp: &TempDir) {
    for (index, identity) in affected(temp).iter().enumerate() {
        disposition(
            temp,
            identity,
            if index % 2 == 0 {
                "updated"
            } else {
                "confirmed-unchanged"
            },
        );
    }
}

fn evidence(temp: &TempDir) {
    success(temp, &["task", "evidence", "work", "--run"]);
}

fn state(temp: &TempDir) -> Value {
    success(temp, &["task", "show", "work"])
}

#[test]
fn required_intent_is_a_real_existing_lifecycle_gate_not_a_note() {
    let temp = fixture();
    require_via_record(&temp);
    evidence(&temp);
    success(&temp, &["task", "note", "work", "Everything is aligned"]);
    let (code, report) = cli(&temp, &["challenge", "work"]);
    assert_eq!(
        code, 1,
        "missing affected-intent reasons must block: {report}"
    );
    assert!(
        report["assignment_blockers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry == "intent-disposition-missing")
    );
    assert_eq!(cli(&temp, &["task", "ready", "work"]).0, 2);
    assert_eq!(
        cli(&temp, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
}

#[test]
fn opt_in_cli_records_all_relevant_identities_and_allows_accountable_closure() {
    let temp = fixture();
    success(
        &temp,
        &[
            "task",
            "open",
            "opted",
            "--role",
            "worker",
            "--statement",
            "Require intent review",
            "--scope",
            "new-src",
            "--require-intent-disposition",
        ],
    );
    assert_eq!(
        success(&temp, &["task", "show", "opted"])["task"]["intent_disposition_required"],
        true
    );
    require_via_record(&temp);
    let identities = affected(&temp);
    for expected in [
        "memory::mission",
        "goal::deliver",
        "system::app",
        "responsibility::entry",
        "seam::handoff",
        "role::worker",
        "policy::bounded",
        "models::worker",
        "knowledge::engineering",
    ] {
        assert!(
            identities.iter().any(|identity| identity == expected),
            "missing {expected}: {identities:?}"
        );
    }
    assert!(
        !identities
            .iter()
            .any(|identity| identity == "system::elsewhere")
    );
    let goals_before = std::fs::read(temp.path().join("goals.bla")).unwrap();
    complete(&temp);
    let shown = state(&temp);
    assert_eq!(shown["intent_disposition_current"], true);
    assert!(
        shown["affected_intent"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| entry["state"] == "current")
    );
    assert_eq!(
        std::fs::read(temp.path().join("goals.bla")).unwrap(),
        goals_before
    );
    evidence(&temp);
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
    success(&temp, &["task", "close", "work", "--model", "owner"]);
    assert_eq!(state(&temp)["task"]["state"], "closed");
    assert_eq!(
        std::fs::read(temp.path().join("goals.bla")).unwrap(),
        goals_before
    );
}

#[test]
fn relevant_intent_and_scoped_source_changes_stale_receipts_but_unrelated_system_does_not() {
    let temp = fixture();
    require_via_record(&temp);
    complete(&temp);
    let system_path = temp.path().join("system.bla");
    let system = std::fs::read_to_string(&system_path).unwrap();
    write(
        temp.path(),
        "system.bla",
        &system.replace(
            "Independent responsibility",
            "Independent clarified responsibility",
        ),
    );
    assert_eq!(state(&temp)["intent_disposition_current"], true);
    write(
        temp.path(),
        "src/extra.rs",
        "pub fn extra() { let _ = 1; }\n",
    );
    assert_eq!(
        state(&temp)["intent_disposition_current"],
        false,
        "scope edits stale even outside explicit check inputs"
    );
    complete(&temp);
    assert_eq!(state(&temp)["intent_disposition_current"], true);
    write(
        temp.path(),
        "system.bla",
        &system.replace("Own the entry", "Own the revised entry"),
    );
    assert_eq!(state(&temp)["intent_disposition_current"], false);
    complete(&temp);
    write(
        temp.path(),
        "mission.bla",
        "mission \"demo\" { statement \"A revised accountable mission\" }\npriority \"truth\" { statement \"Evidence before claims\" }\n",
    );
    assert_eq!(state(&temp)["intent_disposition_current"], false);
    complete(&temp);
    let goals = std::fs::read_to_string(temp.path().join("goals.bla")).unwrap();
    write(
        temp.path(),
        "goals.bla",
        &goals.replace(
            "Deliver the intended entry",
            "Deliver the revised intended entry",
        ),
    );
    assert_eq!(state(&temp)["intent_disposition_current"], false);
    complete(&temp);
    let process = std::fs::read_to_string(temp.path().join("process.bla")).unwrap();
    write(
        temp.path(),
        "process.bla",
        &process.replace("Work only inside scope", "Work strictly only inside scope"),
    );
    assert_eq!(state(&temp)["intent_disposition_current"], false);
}

#[test]
fn invalid_dispositions_are_atomic_and_cannot_grant_scope_or_replace_evidence() {
    let temp = fixture();
    require_via_record(&temp);
    let before = std::fs::read(temp.path().join(".blabla/tasks/work.json")).unwrap();
    for extra in [
        ["system::elsewhere", "updated", "Specific reason", "worker"],
        ["system::app", "guessed", "Specific reason", "worker"],
        ["system::app", "updated", "   ", "worker"],
        ["system::app", "updated", "Specific reason", "owner"],
    ] {
        assert_eq!(
            cli(
                &temp,
                &[
                    "task",
                    "disposition",
                    "work",
                    extra[0],
                    "--status",
                    extra[1],
                    "--reason",
                    extra[2],
                    "--model",
                    extra[3]
                ]
            )
            .0,
            2
        );
        assert_eq!(
            std::fs::read(temp.path().join(".blabla/tasks/work.json")).unwrap(),
            before
        );
    }
    complete(&temp);
    assert_eq!(state(&temp)["task"]["scope"], json!(["src"]));
    let (_, report) = cli(&temp, &["challenge", "work"]);
    assert!(
        report["assignment_blockers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry == "readiness-without-evidence")
    );
    assert_eq!(cli(&temp, &["task", "ready", "work"]).0, 2);
    write(temp.path(), "tests/check.py", "raise SystemExit(1)\n");
    complete(&temp);
    success(&temp, &["task", "evidence", "work", "--run"]);
    let (code, report) = cli(&temp, &["challenge", "work"]);
    assert_eq!(code, 1);
    assert!(
        report["assignment_blockers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry == "declared-check-failed")
    );
    assert_eq!(cli(&temp, &["task", "ready", "work"]).0, 2);
}

#[test]
fn legacy_tasks_still_close_without_dispositions_and_read_older_records() {
    let temp = fixture();
    let path = temp.path().join(".blabla/tasks/work.json");
    let mut old: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    old.as_object_mut()
        .unwrap()
        .remove("intent_disposition_required");
    old.as_object_mut().unwrap().remove("intent_dispositions");
    std::fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
    assert!(task::read(temp.path(), "work").unwrap().is_some());
    evidence(&temp);
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
    success(&temp, &["task", "close", "work", "--model", "owner"]);
    assert_eq!(state(&temp)["task"]["state"], "closed");
}

#[test]
fn reacceptance_and_relevant_intent_changes_after_ready_need_fresh_dispositions() {
    let temp = fixture();
    require_via_record(&temp);
    complete(&temp);
    evidence(&temp);
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
    let mission = std::fs::read_to_string(temp.path().join("mission.bla")).unwrap();
    write(
        temp.path(),
        "mission.bla",
        &mission.replace(
            "Keep accountable intent current",
            "Keep revised accountable intent current",
        ),
    );
    let (code, report) = cli(&temp, &["challenge", "work"]);
    assert_eq!(code, 1);
    assert!(
        report["assignment_blockers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry == "intent-disposition-missing")
    );
    assert_eq!(
        cli(&temp, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    assert_eq!(state(&temp)["intent_disposition_current"], false);
    complete(&temp);
    assert_eq!(state(&temp)["intent_disposition_current"], true);
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    assert_eq!(
        state(&temp)["intent_disposition_current"],
        false,
        "a new acceptance epoch needs accountable current review"
    );
}

#[test]
fn removed_intent_cannot_silently_erase_an_opening_obligation() {
    let temp = fixture();
    success(
        &temp,
        &[
            "task",
            "open",
            "required",
            "--role",
            "worker",
            "--statement",
            "Account for registered intent",
            "--scope",
            "separate",
            "--require-intent-disposition",
        ],
    );
    success(&temp, &["task", "accept", "required", "--model", "worker"]);
    let manifest = std::fs::read_to_string(temp.path().join("project.bla")).unwrap();
    write(
        temp.path(),
        "project.bla",
        &manifest.replace("mission \"mission.bla\"\n", ""),
    );
    let shown = success(&temp, &["task", "show", "required"]);
    assert!(
        shown["affected_intent"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["identity"] == "memory::mission" && entry["state"] == "missing")
    );
    success(
        &temp,
        &[
            "task",
            "disposition",
            "required",
            "memory::mission",
            "--status",
            "updated",
            "--reason",
            "The manifest no longer registers mission.bla; this removed registration is explicitly accounted for",
            "--model",
            "worker",
        ],
    );
    let shown = success(&temp, &["task", "show", "required"]);
    assert!(
        shown["affected_intent"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["identity"] == "memory::mission" && entry["state"] == "current")
    );
}

#[test]
fn dispositions_stay_current_when_recorded_but_a_review_of_them_notices_changed_reasons() {
    let temp = fixture();
    require_via_record(&temp);
    complete(&temp);
    success(
        &temp,
        &[
            "task",
            "open",
            "review",
            "--role",
            "worker",
            "--statement",
            "Inspect current accountable result",
            "--scope",
            "reviews",
            "--review-of",
            "work",
        ],
    );
    success(&temp, &["task", "accept", "review", "--model", "worker"]);
    assert_eq!(
        success(&temp, &["task", "show", "review"])["review_current"],
        true
    );
    success(
        &temp,
        &[
            "task",
            "disposition",
            "work",
            "system::app",
            "--status",
            "confirmed-unchanged",
            "--reason",
            "The source entry remains run and the app system still owns src; this corrects the earlier explanation",
            "--model",
            "worker",
        ],
    );
    assert_eq!(
        state(&temp)["intent_disposition_current"],
        true,
        "receipts do not fingerprint themselves"
    );
    assert_eq!(
        success(&temp, &["task", "show", "review"])["review_current"],
        false,
        "reviewers inspect the changed accountable explanation"
    );
}

#[test]
fn current_dispositions_never_turn_a_failed_contract_green() {
    let temp = fixture();
    require_via_record(&temp);
    write(temp.path(), "src/app.rs", "pub fn wrong() {}\n");
    complete(&temp);
    evidence(&temp);
    assert_eq!(state(&temp)["intent_disposition_current"], true);
    assert_ne!(cli(&temp, &["finish"]).0, 0);
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
    assert_eq!(
        cli(&temp, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
    assert_eq!(state(&temp)["task"]["scope"], json!(["src"]));
}

#[test]
fn legacy_challenge_fingerprint_omits_new_default_fields_and_remains_valid() {
    let temp = fixture();
    evidence(&temp);
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
    let mut old = task::read(temp.path(), "work").unwrap().unwrap();
    let mut normalized = old.clone();
    normalized.challenged = None;
    normalized.state.clear();
    normalized.closed_unix = None;
    normalized.closed_paths.clear();
    normalized.result = None;
    normalized.build = None;
    normalized.notes.clear();
    normalized.orchestrator_records.clear();
    let serialized = serde_json::to_string(&normalized).unwrap();
    assert!(
        !serialized.contains("intent_disposition"),
        "legacy fingerprint must not gain serialized default keys"
    );
    assert!(!serialized.contains("intent_identities"));
    let project = blabla::project::load(
        blabla::project::read_manifest(&temp.path().join("project.bla")).unwrap(),
    )
    .unwrap();
    let tree = blabla::project::snapshot(temp.path(), &project.ignore);
    let mut fingerprint = blabla::project::Fnv::new();
    fingerprint.write_str(&serialized);
    for (path, digest) in &tree {
        if task::receipt_covers(&old, &tree, path) {
            fingerprint.write_str(path);
            fingerprint.write_str(digest);
        }
    }
    old.challenged.as_mut().unwrap().fingerprint = fingerprint.finish();
    task::write(temp.path(), &old).unwrap();
    success(&temp, &["task", "close", "work", "--model", "owner"]);
}
