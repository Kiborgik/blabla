use serde_json::{Value, json};
use std::path::Path;
use tempfile::TempDir;

use crate::interpreter;
use crate::support;

fn write(root: &Path, path: &str, text: &str) {
    let file = root.join(path);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(file, text).unwrap();
}

fn cli(root: &Path, arguments: &[&str], expected: i32) -> Value {
    let mut args = vec!["--json"];
    args.extend_from_slice(arguments);
    let output = support::run_in(Some(root), &support::args(&args));
    assert_eq!(
        output.status.code(),
        Some(expected),
        "{arguments:?}\nstdout={}\nstderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "{arguments:?} did not reach structured CLI handling: {error}\n{}",
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

fn success(root: &Path, arguments: &[&str]) -> Value {
    cli(root, arguments, 0)
}

fn read_json(root: &Path, path: &str) -> Value {
    serde_json::from_slice(&std::fs::read(root.join(path)).unwrap()).unwrap()
}

fn task(root: &Path, name: &str) -> Value {
    success(root, &["task", "show", name])
}

fn check_and_ready(root: &Path, name: &str) {
    success(root, &["task", "evidence", name, "--run"]);
    let challenge = success(root, &["challenge", name]);
    assert_eq!(challenge["assignment_clear"], true);
    success(root, &["task", "ready", name]);
}

fn fixture() -> TempDir {
    fixture_with_structure(
        "module entry \"entry.rs\"\nrequire \"entry-exists\": symbol entry::run\n",
    )
}

fn fixture_with_structure(structure: &str) -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "project.bla",
        &format!(
            "project Bounded\nuse behavior \"behavior.bla\"\nuse structure \"structure.bla\"\nprocess \"process.bla\"\nverify behavior {{ command [\"{}\", \"app.py\"] seed 0 cases 1 steps 4 timeout_ms {} shrink_budget 8 }}\n",
            interpreter::python(),
            crate::UNMEASURED_ALLOWANCE.as_millis()
        ),
    );
    write(
        root,
        "behavior.bla",
        "state count: int\naction increment()\nwhen increment { expect \"adds-one\": after.count == before.count + 1 }\n",
    );
    write(root, "structure.bla", structure);
    write(root, "entry.rs", "pub fn run() {}\n");
    write(
        root,
        "process.bla",
        "role \"orchestrator\" { purpose \"Own integration\" model \"owner\" }\nrole \"worker\" { purpose \"Do bounded work\" model \"worker\" }\nrole \"reviewer\" { purpose \"Review bounded work\" model \"reviewer\" }\n",
    );
    write(root, "owned.txt", "before\n");
    write(root, "review.md", "before review\n");
    write(root, "reports/other.md", "before report\n");
    write(root, "helper.py", "STEP = 1\n");
    write(
        root,
        "check.py",
        "from pathlib import Path\nassert Path('owned.txt').read_text() == 'after\\n'\n",
    );
    write(
        root,
        "app.py",
        "import json, runpy, sys\nfrom pathlib import Path\nstep = runpy.run_path(str(Path(__file__).parent / 'helper.py'))['STEP']\ncount = 0\nfor line in sys.stdin:\n r = json.loads(line)\n if r['op'] == 'reset':\n  count = 0\n  value = {'ok': True}\n elif r['op'] == 'call':\n  count += step\n  value = {'ok': True}\n else:\n  value = {'count': count}\n print(json.dumps({'id': r['id'], 'result': value}), flush=True)\n",
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
            "Update owned text",
            "--scope",
            "owned.txt",
            "--deliverable",
            "owned.txt",
            "--input",
            "owned.txt",
            "check.py",
            "--check",
            interpreter::python(),
            "check.py",
        ],
    );
    success(
        root,
        &[
            "task",
            "open",
            "other",
            "--role",
            "worker",
            "--statement",
            "Concurrent reports and helper",
            "--scope",
            "reports",
            "helper.py",
            "entry.rs",
            "--check",
            interpreter::python(),
            "-c",
            "pass",
        ],
    );
    success(root, &["task", "accept", "other", "--model", "worker"]);
    success(root, &["task", "accept", "work", "--model", "worker"]);
    write(root, "owned.txt", "after\n");
    success(root, &["finish"]);
    check_and_ready(root, "work");
    temp
}

fn drift(root: &Path) -> Value {
    write(root, "reports/other.md", "after report\n");
    let status = cli(root, &["status"], 5);
    assert_eq!(status["recorded"]["stale"], json!(["implementation"]));
    assert_eq!(status["completion"]["allowed"], false);
    status
}

fn bounded(root: &Path, name: &str, expected: i32) -> Value {
    let value = cli(
        root,
        &[
            "task",
            "close",
            name,
            "--bounded",
            "--reason",
            "Accept only the current bounded result; integration is pending",
            "--model",
            "owner",
        ],
        expected,
    );
    assert_ne!(
        value["category"], "invocation",
        "the bounded surface must be recognized: {value}"
    );
    value
}

fn refused_without_changes(root: &Path, name: &str) {
    let before = task(root, name)["task"].clone();
    let status = std::fs::read(root.join(".blabla/status.json")).ok();
    bounded(root, name, 2);
    assert_eq!(task(root, name)["task"], before);
    assert_eq!(std::fs::read(root.join(".blabla/status.json")).ok(), status);
}

fn ordinary_close_still_requires_current_project_verification(root: &Path) {
    drift(root);
    let challenge = success(root, &["challenge", "work"]);
    assert_eq!(challenge["assignment_clear"], true);
    assert_eq!(challenge["grounded"], json!(["verification-not-current"]));
    let before = task(root, "work")["task"].clone();
    cli(root, &["task", "close", "work", "--model", "owner"], 2);
    assert_eq!(task(root, "work")["task"], before);
}

fn bounded_close_accepts_current_result_without_refreshing_project_verification(root: &Path) {
    let prior = read_json(root, ".blabla/status.json");
    let stale = drift(root);
    let before = task(root, "work");
    let record = std::fs::read(root.join(".blabla/status.json")).unwrap();
    let accepted = bounded(root, "work", 0);
    assert_eq!(accepted["task"]["state"], "closed");
    assert_eq!(accepted["task"]["result"]["model"], "owner");
    assert_eq!(accepted["task"]["result_basis"]["kind"], "bounded");
    assert_eq!(
        accepted["task"]["result_basis"]["reason"],
        "Accept only the current bounded result; integration is pending"
    );
    assert_eq!(accepted["task"]["result_basis"]["project_state"], "stale");
    assert_eq!(
        accepted["task"]["result_basis"]["prior_run_id"],
        prior["run_id"]
    );
    assert_eq!(
        accepted["task"]["result_basis"]["implementation_fingerprint"],
        prior["implementation_fingerprint"]
    );
    assert_eq!(accepted["task"]["evidence"], before["task"]["evidence"]);
    assert_eq!(
        std::fs::read(root.join(".blabla/status.json")).unwrap(),
        record
    );
    assert_eq!(cli(root, &["status"], 5)["completion"], stale["completion"]);
    success(
        root,
        &[
            "task",
            "open",
            "successor",
            "--role",
            "worker",
            "--statement",
            "Use released scope",
            "--scope",
            "owned.txt",
            "--check",
            interpreter::python(),
            "check.py",
        ],
    );
    success(root, &["finish"]);
    assert_eq!(
        task(root, "work")["task"]["result_basis"],
        accepted["task"]["result_basis"]
    );
}

fn a_changed_declared_input_still_refuses_bounded_close(root: &Path) {
    drift(root);
    write(root, "owned.txt", "changed again\n");
    let challenge = cli(root, &["challenge", "work"], 1);
    assert_eq!(challenge["assignment_clear"], false);
    assert!(
        challenge["grounded"]
            .as_array()
            .unwrap()
            .contains(&json!("evidence-superseded"))
    );
    refused_without_changes(root, "work");
}

fn grounded(root: &Path, name: &str, class: &str, exit: i32) {
    let report = cli(root, &["challenge", name], exit);
    assert!(
        report["grounded"]
            .as_array()
            .unwrap()
            .contains(&json!(class)),
        "{report}"
    );
}

fn review_fixture() -> TempDir {
    let temp = fixture();
    let root = temp.path();
    success(
        root,
        &[
            "task",
            "open",
            "review",
            "--role",
            "reviewer",
            "--statement",
            "Review the current owned change",
            "--scope",
            "review.md",
            "--deliverable",
            "review.md",
            "--review-of",
            "work",
            "--check",
            interpreter::python(),
            "check.py",
        ],
    );
    success(root, &["task", "accept", "review", "--model", "reviewer"]);
    write(
        root,
        "review.md",
        "Reviewed current source and exact check\n",
    );
    check_and_ready(root, "review");
    success(root, &["finish"]);
    assert_eq!(task(root, "review")["review_current"], true);
    temp
}

fn a_bounded_review_releases_its_scope_but_later_source_change_expires_approval(root: &Path) {
    drift(root);
    let closed = bounded(root, "review", 0);
    assert_eq!(closed["review_current"], true);
    assert_eq!(closed["approval_current"], true);
    assert_eq!(closed["task"]["result_basis"]["kind"], "bounded");
    write(root, "owned.txt", "later feature\n");
    let after = task(root, "review");
    assert_eq!(after["task"]["state"], "closed");
    assert_eq!(after["task"]["result"], closed["task"]["result"]);
    assert_eq!(after["review_current"], false);
    assert_eq!(after["approval_current"], false);
}

fn target_reacceptance_still_blocks_a_ready_review(root: &Path) {
    drift(root);
    success(root, &["task", "accept", "work", "--model", "worker"]);
    assert_eq!(task(root, "review")["review_current"], false);
    grounded(root, "review", "review-target-stale", 1);
    refused_without_changes(root, "review");
}

fn bounded_acceptance_never_blesses_an_implicit_dependency_or_overrides_a_red_finish(root: &Path) {
    write(root, "helper.py", "STEP = 2\n");
    let status = cli(root, &["status"], 5);
    assert_eq!(status["recorded"]["stale"], json!(["implementation"]));
    assert_eq!(
        success(root, &["challenge", "work"])["assignment_clear"],
        true
    );
    bounded(root, "work", 0);
    let finish = cli(root, &["finish"], 1);
    assert_eq!(finish["project"]["state"], "red");
    assert_eq!(finish["project"]["completion"]["allowed"], false);
    assert_eq!(task(root, "work")["task"]["state"], "closed");
}

fn an_explicit_dependency_stays_binding_even_when_its_change_is_concurrent(root: &Path) {
    success(root, &["task", "accept", "work", "--model", "worker"]);
    success(
        root,
        &[
            "task",
            "check",
            "work",
            "--model",
            "owner",
            "--input",
            "owned.txt",
            "check.py",
            "helper.py",
            "--check",
            interpreter::python(),
            "check.py",
        ],
    );
    check_and_ready(root, "work");
    success(root, &["task", "confirm", "work", "--model", "owner"]);
    write(root, "helper.py", "STEP = 2\n");
    grounded(root, "work", "evidence-superseded", 1);
    refused_without_changes(root, "work");
}

fn an_unconfirmed_owner_record_remains_a_close_blocker(root: &Path) {
    success(root, &["task", "accept", "work", "--model", "worker"]);
    success(
        root,
        &[
            "task",
            "statement",
            "work",
            "Reviewed sharper bounded statement",
            "--model",
            "owner",
        ],
    );
    check_and_ready(root, "work");
    drift(root);
    grounded(root, "work", "orchestrator-record-during-carry", 0);
    refused_without_changes(root, "work");
    success(root, &["task", "confirm", "work", "--model", "owner"]);
    assert_eq!(bounded(root, "work", 0)["task"]["state"], "closed");
}

#[test]
fn a_vacuous_rule_is_not_dropped_with_project_staleness() {
    let temp = fixture_with_structure(
        "module missing \"missing.py\"\nforbid \"no-missing-restart\": symbol missing::Domain.restart\n",
    );
    let root = temp.path();
    drift(root);
    grounded(root, "work", "vacuous-rule", 0);
    refused_without_changes(root, "work");
}

fn an_unresolved_finding_remains_a_close_blocker(root: &Path) {
    drift(root);
    success(
        root,
        &[
            "task",
            "finding",
            "work",
            "Actual unresolved bounded concern",
        ],
    );
    grounded(root, "work", "unresolved-finding", 1);
    refused_without_changes(root, "work");
}

fn a_latest_failed_check_cannot_use_an_older_success(root: &Path) {
    drift(root);
    success(root, &["task", "accept", "work", "--model", "worker"]);
    write(root, "owned.txt", "failing check input\n");
    success(root, &["task", "evidence", "work", "--run"]);
    grounded(root, "work", "declared-check-failed", 1);
    refused_without_changes(root, "work");
}

fn a_missing_declared_input_cannot_gain_bounded_acceptance(root: &Path) {
    drift(root);
    std::fs::remove_file(root.join("owned.txt")).unwrap();
    grounded(root, "work", "evidence-superseded", 1);
    refused_without_changes(root, "work");
}

fn a_worker_model_cannot_record_owner_bounded_acceptance(root: &Path) {
    drift(root);
    let before = task(root, "work")["task"].clone();
    let failure = cli(
        root,
        &[
            "task",
            "close",
            "work",
            "--bounded",
            "--reason",
            "Bounded result",
            "--model",
            "worker",
        ],
        2,
    );
    assert_eq!(failure["category"], "task");
    assert_eq!(task(root, "work")["task"], before);
}

fn a_blank_reason_cannot_record_bounded_acceptance(root: &Path) {
    drift(root);
    let before = task(root, "work")["task"].clone();
    let failure = cli(
        root,
        &[
            "task",
            "close",
            "work",
            "--bounded",
            "--reason",
            "  ",
            "--model",
            "owner",
        ],
        2,
    );
    assert_eq!(failure["category"], "task");
    assert_eq!(task(root, "work")["task"], before);
}

fn a_real_prior_red_record_hidden_by_later_staleness_is_ineligible(root: &Path) {
    write(root, "helper.py", "STEP = 2\n");
    assert_eq!(cli(root, &["finish"], 1)["project"]["state"], "red");
    write(root, "helper.py", "STEP = 1\n");
    drift(root);
    assert_eq!(
        read_json(root, ".blabla/status.json")["report"]["status"],
        "red"
    );
    refused_without_changes(root, "work");
}

fn live_structure_failure_remains_ineligible(root: &Path) {
    write(root, "entry.rs", "pub fn renamed() {}\n");
    let status = cli(root, &["status"], 1);
    assert_eq!(status["structure"]["status"], "red");
    refused_without_changes(root, "work");
}

fn changed_contract_identity_is_not_an_implementation_only_exception(root: &Path) {
    write(
        root,
        "behavior.bla",
        "state count: int\naction increment()\nwhen increment { expect \"adds-two\": after.count == before.count + 2 }\n",
    );
    let status = cli(root, &["status"], 5);
    assert!(
        status["recorded"]["stale"]
            .as_array()
            .unwrap()
            .contains(&json!("contracts"))
    );
    refused_without_changes(root, "work");
}

fn changed_profile_is_not_an_implementation_only_exception(root: &Path) {
    let manifest = std::fs::read_to_string(root.join("project.bla")).unwrap();
    write(root, "project.bla", &manifest.replace("seed 0", "seed 1"));
    let status = cli(root, &["status"], 5);
    assert!(
        status["recorded"]["stale"]
            .as_array()
            .unwrap()
            .contains(&json!("profile"))
    );
    refused_without_changes(root, "work");
}

fn verification_record_is_ineligible(root: &Path, corrupt: bool) {
    drift(root);
    if corrupt {
        write(root, ".blabla/status.json", "not JSON");
    } else {
        std::fs::remove_file(root.join(".blabla/status.json")).unwrap();
    }
    refused_without_changes(root, "work");
}

fn a_missing_verification_record_is_ineligible(root: &Path) {
    verification_record_is_ineligible(root, false);
}

fn a_corrupt_verification_record_is_ineligible(root: &Path) {
    verification_record_is_ineligible(root, true);
}

fn verifier_change_is_not_an_implementation_only_exception(root: &Path) {
    let mut record = read_json(root, ".blabla/status.json");
    record["verifier_version"] = json!("older-verifier");
    write(root, ".blabla/status.json", &record.to_string());
    let status = cli(root, &["status"], 5);
    assert!(
        status["recorded"]["stale"]
            .as_array()
            .unwrap()
            .contains(&json!("verifier"))
    );
    refused_without_changes(root, "work");
}

fn pending_run_is_ineligible(root: &Path, live: bool) {
    let record = read_json(root, ".blabla/status.json");
    let profile: blabla::project::Profile =
        serde_json::from_value(record["profile"].clone()).unwrap();
    let marker = blabla::project::runstate::Marker {
        run_id: "synthetic-pending-run".into(),
        pid: if live { std::process::id() } else { u32::MAX },
        started_unix: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        verifier_version: env!("CARGO_PKG_VERSION").into(),
        project_identity: record["project_identity"].as_str().unwrap().into(),
        profile_identity: blabla::project::runstate::profile_identity(Some(&profile)),
        profile: Some(profile),
    };
    blabla::project::runstate::write_marker(root, &marker).unwrap();
    let status = cli(root, &["status"], 5);
    assert_eq!(
        status["state"],
        if live { "verifying" } else { "interrupted" }
    );
    refused_without_changes(root, "work");
}

fn an_interrupted_run_cannot_be_treated_as_stale_success(root: &Path) {
    pending_run_is_ineligible(root, false);
}

fn an_in_progress_run_cannot_be_treated_as_stale_success(root: &Path) {
    pending_run_is_ineligible(root, true);
}

fn a_capped_drift_display_cannot_hide_a_changed_explicit_input(root: &Path) {
    for index in 0..60 {
        write(root, &format!("reports/{index:03}.md"), "new report\n");
    }
    write(root, "owned.txt", "changed required input\n");
    let status = cli(root, &["status"], 5);
    assert!(
        status["recorded"]["input_drift"]["omitted_changes"]
            .as_u64()
            .unwrap()
            > 0
    );
    grounded(root, "work", "evidence-superseded", 1);
    refused_without_changes(root, "work");
}

fn default_close_keeps_legacy_result_shape_and_normal_freshness(root: &Path) {
    let closed = success(root, &["task", "close", "work", "--model", "owner"]);
    assert_eq!(closed["task"]["state"], "closed");
    assert_eq!(closed["task"]["result"]["model"], "owner");
    assert!(closed["task"]["result_basis"].is_null());
    assert_eq!(success(root, &["status"])["completion"]["allowed"], true);
}

fn unknown_changes_cannot_be_hidden_by_bounded_closure(root: &Path) {
    drift(root);
    write(root, "unowned.txt", "unaccounted change\n");
    grounded(root, "work", "attribution-unknown", 1);
    refused_without_changes(root, "work");
}

fn a_synthetic_yellow_record_hidden_by_staleness_is_ineligible(root: &Path) {
    let mut record = read_json(root, ".blabla/status.json");
    record["report"]["status"] = json!("yellow");
    write(root, ".blabla/status.json", &record.to_string());
    drift(root);
    refused_without_changes(root, "work");
}

fn a_noncanonical_record_hidden_by_staleness_is_ineligible(root: &Path) {
    let mut record = read_json(root, ".blabla/status.json");
    record["report"]["seed"] = json!(1);
    write(root, ".blabla/status.json", &record.to_string());
    drift(root);
    refused_without_changes(root, "work");
}

fn a_removed_profile_is_ineligible_even_with_an_old_green_record(root: &Path) {
    let manifest = std::fs::read_to_string(root.join("project.bla")).unwrap();
    write(
        root,
        "project.bla",
        manifest.split("verify behavior").next().unwrap(),
    );
    let status = cli(root, &["status"], 5);
    assert_eq!(status["completion"]["allowed"], false);
    refused_without_changes(root, "work");
}

fn bounded_close_does_not_require_a_complete_display_of_unrelated_drift(root: &Path) {
    for index in 0..60 {
        write(root, &format!("reports/{index:03}.md"), "new report\n");
    }
    let status = cli(root, &["status"], 5);
    assert!(
        status["recorded"]["input_drift"]["omitted_changes"]
            .as_u64()
            .unwrap()
            > 0
    );
    assert_eq!(bounded(root, "work", 0)["task"]["state"], "closed");
    assert_eq!(cli(root, &["status"], 5)["completion"]["allowed"], false);
}

fn legacy_aggregate_history_does_not_invent_path_independence(root: &Path) {
    let mut record = read_json(root, ".blabla/status.json");
    record
        .as_object_mut()
        .unwrap()
        .remove("implementation_inputs");
    write(root, ".blabla/status.json", &record.to_string());
    let stale = drift(root);
    assert_eq!(
        stale["recorded"]["input_drift"]["availability"],
        "legacy-unavailable"
    );
    let saved = std::fs::read(root.join(".blabla/status.json")).unwrap();
    assert_eq!(bounded(root, "work", 0)["task"]["state"], "closed");
    assert_eq!(
        std::fs::read(root.join(".blabla/status.json")).unwrap(),
        saved
    );
    assert_eq!(cli(root, &["status"], 5)["completion"]["allowed"], false);
}

fn repaired_structure_does_not_turn_a_prior_overall_red_finish_into_green_history(root: &Path) {
    write(root, "entry.rs", "pub fn renamed() {}\n");
    let finished = cli(root, &["finish"], 1);
    assert_eq!(finished["completion"]["state"], "structure_red");
    let prior = read_json(root, ".blabla/status.json");
    assert_eq!(prior["report"]["status"], "green");
    assert_eq!(prior["structure"]["status"], "red");
    write(root, "entry.rs", "pub fn run() {}\n");
    let stale = drift(root);
    assert_eq!(stale["structure"]["status"], "green");
    refused_without_changes(root, "work");
}

fn missing_recorded_structure_cannot_establish_prior_overall_green(root: &Path) {
    let mut record = read_json(root, ".blabla/status.json");
    record.as_object_mut().unwrap().remove("structure");
    write(root, ".blabla/status.json", &record.to_string());
    drift(root);
    refused_without_changes(root, "work");
}

fn malformed_recorded_structure_cannot_establish_prior_overall_green(root: &Path) {
    let mut record = read_json(root, ".blabla/status.json");
    record["structure"] = json!({"status": "green"});
    write(root, ".blabla/status.json", &record.to_string());
    drift(root);
    refused_without_changes(root, "work");
}

fn bounded_receipt_is_visible_and_cannot_be_replaced_by_another_close(root: &Path) {
    drift(root);
    bounded(root, "work", 0);
    let bytes = std::fs::read(root.join(".blabla/tasks/work.json")).unwrap();
    bounded(root, "work", 2);
    assert_eq!(
        std::fs::read(root.join(".blabla/tasks/work.json")).unwrap(),
        bytes
    );
    let shown = support::run_in(Some(root), &support::args(&["task", "show", "work"]));
    assert!(shown.status.success());
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

type Scenario = (&'static str, fn(&Path));

fn run_scenarios(template: &TempDir, scenarios: &[Scenario]) {
    for (name, scenario) in scenarios {
        let copy = TempDir::new().unwrap();
        copy_tree(template.path(), copy.path());
        eprintln!("scenario {name}");
        scenario(copy.path());
    }
}

macro_rules! scenarios {
    ($($name:ident),* $(,)?) => {
        &[$((stringify!($name), $name as fn(&Path))),*]
    };
}

#[test]
fn a_copied_fixture_reports_the_same_status_and_challenge() {
    let original = fixture();
    let copy = TempDir::new().unwrap();
    copy_tree(original.path(), copy.path());
    for arguments in [&["status"][..], &["challenge", "work"][..]] {
        let left = cli(original.path(), arguments, 0);
        let right = cli(copy.path(), arguments, 0);
        let differing: Vec<_> = left
            .as_object()
            .unwrap()
            .iter()
            .filter(|(key, value)| key.as_str() != "manifest" && &right[key.as_str()] != *value)
            .map(|(key, _)| key.as_str())
            .collect();
        assert!(differing.is_empty(), "{arguments:?}: {differing:?}");
    }
}

#[test]
fn current_blockers_refuse_the_bounded_close_without_changes() {
    run_scenarios(
        &fixture(),
        scenarios![
            ordinary_close_still_requires_current_project_verification,
            a_changed_declared_input_still_refuses_bounded_close,
            a_missing_declared_input_cannot_gain_bounded_acceptance,
            a_capped_drift_display_cannot_hide_a_changed_explicit_input,
            a_latest_failed_check_cannot_use_an_older_success,
            an_unresolved_finding_remains_a_close_blocker,
            unknown_changes_cannot_be_hidden_by_bounded_closure,
            a_worker_model_cannot_record_owner_bounded_acceptance,
            a_blank_reason_cannot_record_bounded_acceptance,
        ],
    );
}

#[test]
fn tampered_or_unsound_records_are_ineligible_for_the_bounded_close() {
    run_scenarios(
        &fixture(),
        scenarios![
            a_real_prior_red_record_hidden_by_later_staleness_is_ineligible,
            live_structure_failure_remains_ineligible,
            a_synthetic_yellow_record_hidden_by_staleness_is_ineligible,
            a_noncanonical_record_hidden_by_staleness_is_ineligible,
            a_removed_profile_is_ineligible_even_with_an_old_green_record,
            missing_recorded_structure_cannot_establish_prior_overall_green,
            malformed_recorded_structure_cannot_establish_prior_overall_green,
            repaired_structure_does_not_turn_a_prior_overall_red_finish_into_green_history,
            a_missing_verification_record_is_ineligible,
            a_corrupt_verification_record_is_ineligible,
            an_interrupted_run_cannot_be_treated_as_stale_success,
            an_in_progress_run_cannot_be_treated_as_stale_success,
        ],
    );
}

#[test]
fn only_implementation_drift_is_an_exception_and_acceptance_leaves_the_record_alone() {
    run_scenarios(
        &fixture(),
        scenarios![
            changed_contract_identity_is_not_an_implementation_only_exception,
            changed_profile_is_not_an_implementation_only_exception,
            verifier_change_is_not_an_implementation_only_exception,
            bounded_close_accepts_current_result_without_refreshing_project_verification,
            bounded_close_does_not_require_a_complete_display_of_unrelated_drift,
            legacy_aggregate_history_does_not_invent_path_independence,
            default_close_keeps_legacy_result_shape_and_normal_freshness,
            bounded_receipt_is_visible_and_cannot_be_replaced_by_another_close,
        ],
    );
}

#[test]
fn explicit_dependencies_and_unconfirmed_owner_records_stay_binding() {
    run_scenarios(
        &fixture(),
        scenarios![
            bounded_acceptance_never_blesses_an_implicit_dependency_or_overrides_a_red_finish,
            an_explicit_dependency_stays_binding_even_when_its_change_is_concurrent,
            an_unconfirmed_owner_record_remains_a_close_blocker,
        ],
    );
}

#[test]
fn a_ready_review_follows_its_target() {
    run_scenarios(
        &review_fixture(),
        scenarios![
            a_bounded_review_releases_its_scope_but_later_source_change_expires_approval,
            target_reacceptance_still_blocks_a_ready_review,
        ],
    );
}
