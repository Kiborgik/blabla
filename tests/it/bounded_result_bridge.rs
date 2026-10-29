use crate::component::Component;
use crate::source_cli::Campaign;
use serde_json::{Value, json};
use std::path::PathBuf;

use crate::bounded_results;

fn call(probe: &mut bounded_results::BoundedResults, name: &str, args: Value) {
    probe.call(name, &args).expect("recognized action").unwrap();
}

#[derive(Clone)]
struct ObservedPair {
    before: Value,
    after: Value,
    called: bool,
}

impl blabla::application::Application for ObservedPair {
    fn reset(&mut self) -> Result<(), blabla::diagnostic::AppError> {
        self.called = false;
        Ok(())
    }
    fn call(&mut self, _: &blabla::report::Call) -> Result<(), blabla::diagnostic::AppError> {
        self.called = true;
        Ok(())
    }
    fn observe(&mut self, _: &[blabla::ir::Field]) -> Result<Value, blabla::diagnostic::AppError> {
        Ok(if self.called {
            self.after.clone()
        } else {
            self.before.clone()
        })
    }
}

fn evaluate_pair(action: &str, before: &Value, after: &Value) -> blabla::report::RunReport {
    let source = std::fs::read_to_string(format!(
        "{}/contracts/bounded-results.bla",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    let mut contract = blabla::semantics::compile("bounded-results.bla", &source).unwrap();
    contract
        .actions
        .retain(|candidate| candidate.name == action);
    assert_eq!(contract.actions.len(), 1);
    blabla::verify::run(
        &contract,
        &blabla::report::RunOptions {
            seed: 0,
            cases: 1,
            steps: 1,
            shrink_budget: 0,
        },
        || {
            Ok(ObservedPair {
                before: before.clone(),
                after: after.clone(),
                called: false,
            })
        },
    )
    .unwrap()
}

fn new_probe() -> bounded_results::BoundedResults {
    bounded_results::BoundedResults::with_campaign(
        Campaign::with_executable(PathBuf::from(env!("CARGO_BIN_EXE_blabla"))),
        Default::default(),
    )
}

fn not_red(action: &str, before: &Value, after: &Value) {
    assert_ne!(
        evaluate_pair(action, before, after).status,
        blabla::report::RunStatus::Red,
        "{action}"
    );
}

fn red_when(action: &str, before: &Value, after: &Value, field: &str, value: bool) {
    let mut mutant = after.clone();
    mutant[field] = json!(value);
    assert_eq!(
        evaluate_pair(action, before, &mutant).status,
        blabla::report::RunStatus::Red,
        "{action}: {field}"
    );
}

const BOUNDED_FIELDS: [&str; 5] = [
    "bounded_accepted",
    "bounded_basis_recorded",
    "bounded_project_record_unchanged",
    "bounded_task_revision_current",
    "bounded_verification_eligibility_current",
];

#[test]
fn a_bounded_success_fixture_accepts_and_keeps_the_project_stale() {
    let mut probe = new_probe();
    let initial = probe.observe(&Value::Null);
    call(&mut probe, "bounded_result_fixture", json!([-9]));
    let before = probe.observe(&Value::Null);
    for field in [
        "result_task_ready",
        "bounded_prior_canonical_green",
        "bounded_implementation_only_drift",
    ] {
        assert_eq!(before[field], true, "{field}: {before}");
    }
    not_red("bounded_success_fixture", &initial, &before);
    call(&mut probe, "accept_bounded_result", json!([]));
    let after = probe.observe(&Value::Null);
    for field in BOUNDED_FIELDS {
        assert_eq!(after[field], true, "{field}: {after}");
    }
    assert_eq!(after["bounded_project_completion_allowed"], false);
    not_red("accept_bounded_result", &before, &after);
    red_when(
        "accept_bounded_result",
        &before,
        &after,
        "bounded_accepted",
        false,
    );
    for field in BOUNDED_FIELDS.iter().skip(1) {
        red_when("accept_bounded_result", &before, &after, field, false);
    }
    red_when(
        "accept_bounded_result",
        &before,
        &after,
        "bounded_project_completion_allowed",
        true,
    );
}

#[test]
fn an_ordinary_success_fixture_accepts_through_the_ordinary_close() {
    let mut probe = new_probe();
    let initial = probe.observe(&Value::Null);
    call(&mut probe, "ordinary_success_fixture", json!([]));
    let before = probe.observe(&Value::Null);
    not_red("ordinary_success_fixture", &initial, &before);
    call(&mut probe, "accept_ordinary_result", json!([]));
    let after = probe.observe(&Value::Null);
    assert_eq!(after["ordinary_close_accepted"], true);
    not_red("accept_ordinary_result", &before, &after);
    red_when(
        "accept_ordinary_result",
        &before,
        &after,
        "ordinary_close_accepted",
        false,
    );
    red_when(
        "accept_ordinary_result",
        &before,
        &after,
        "bounded_project_record_unchanged",
        false,
    );
}

fn refusal(kind: i64, disqualifier: &str, checks_pairs: bool) {
    let mut probe = new_probe();
    call(&mut probe, "bounded_result_fixture", json!([kind]));
    let before = probe.observe(&Value::Null);
    assert_eq!(before[disqualifier], false, "fixture {kind}: {before}");
    call(&mut probe, "accept_bounded_result", json!([]));
    let after = probe.observe(&Value::Null);
    assert_eq!(after["bounded_accepted"], false, "fixture {kind}: {after}");
    assert_eq!(after["bounded_project_record_unchanged"], true);
    if checks_pairs {
        not_red("accept_bounded_result", &before, &after);
        red_when(
            "accept_bounded_result",
            &before,
            &after,
            "bounded_accepted",
            true,
        );
    }
}

#[test]
fn a_changed_task_revision_refuses_the_bounded_close() {
    refusal(2, "bounded_task_revision_current", false);
}

#[test]
fn another_blocker_refuses_the_bounded_close() {
    refusal(3, "bounded_other_blockers_clear", true);
}

#[test]
fn a_red_prior_run_refuses_the_bounded_close() {
    refusal(4, "bounded_prior_canonical_green", true);
}

#[test]
fn a_red_prior_structure_refuses_the_bounded_close() {
    refusal(5, "bounded_prior_canonical_green", true);
}

#[test]
fn a_worker_model_refuses_the_bounded_close() {
    refusal(6, "bounded_owner_attested", false);
}

#[test]
fn a_blank_reason_refuses_the_bounded_close() {
    refusal(7, "bounded_reason_present", false);
}

#[test]
fn a_changed_profile_refuses_the_bounded_close() {
    refusal(8, "bounded_implementation_only_drift", false);
}

#[test]
fn a_first_use_close_builds_the_ordinary_fixture_and_a_repeat_is_refused() {
    let mut probe = new_probe();
    let unused = probe.observe(&Value::Null);
    for field in [
        "bounded_fixture_initialized",
        "result_task_ready",
        "bounded_prior_canonical_green",
        "project_verification_current",
        "bounded_accepted",
        "ordinary_close_accepted",
    ] {
        assert_eq!(unused[field], false, "unused probe fabricated {field}");
    }
    call(&mut probe, "accept_bounded_result", json!([]));
    let bounded = probe.observe(&Value::Null);
    assert_eq!(bounded["bounded_accepted"], false);
    assert_eq!(bounded["bounded_fixture_initialized"], true);
    assert_eq!(bounded["bounded_project_completion_allowed"], true);
    call(&mut probe, "accept_ordinary_result", json!([]));
    let ordinary = probe.observe(&Value::Null);
    assert_eq!(ordinary["ordinary_close_accepted"], true);
    call(&mut probe, "accept_ordinary_result", json!([]));
    let repeated = probe.observe(&Value::Null);
    assert_eq!(repeated["ordinary_close_accepted"], false);
    assert_eq!(repeated["bounded_project_record_unchanged"], true);
}

#[test]
fn a_bounded_fixture_refuses_the_ordinary_close_and_a_repeated_bounded_close() {
    let mut probe = new_probe();
    call(&mut probe, "bounded_success_fixture", json!([]));
    let before = probe.observe(&Value::Null);
    assert_eq!(before["result_task_ready"], true);
    assert_eq!(before["bounded_other_blockers_clear"], true);
    call(&mut probe, "accept_ordinary_result", json!([]));
    assert_eq!(
        probe.observe(&Value::Null)["ordinary_close_accepted"],
        false
    );
    call(&mut probe, "accept_bounded_result", json!([]));
    let accepted = probe.observe(&Value::Null);
    for field in BOUNDED_FIELDS {
        assert_eq!(accepted[field], true, "{field}: {accepted}");
    }
    call(&mut probe, "accept_bounded_result", json!([]));
    let repeated = probe.observe(&Value::Null);
    assert_eq!(repeated["bounded_accepted"], false);
    assert_eq!(repeated["bounded_basis_recorded"], false);
}

#[test]
fn bad_fixture_arguments_and_unknown_actions_leave_the_observation_unchanged() {
    let mut probe = new_probe();
    let before = probe.observe(&Value::Null);
    assert!(
        probe
            .call("bounded_result_fixture", &json!(["invalid"]))
            .unwrap()
            .is_err()
    );
    assert_eq!(probe.observe(&Value::Null), before);
    assert!(probe.call("unknown_action", &json!([])).is_none());
    assert_eq!(probe.observe(&Value::Null), before);
}

#[cfg(unix)]
#[test]
fn legacy_startup_resets_and_observations_never_launch_nested_cargo() {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    use std::process::{Command, Stdio};
    let temp = tempfile::TempDir::new().unwrap();
    let cargo = temp.path().join("cargo");
    let marker = temp.path().join("invoked");
    std::fs::write(
        &cargo,
        format!(
            "#!/bin/sh\nprintf invoked > '{}'\nexit 77\n",
            marker.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&cargo, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut child = Command::new(env!("CARGO"))
        .args([
            "run",
            "--locked",
            "--quiet",
            "--example",
            "structure-adapter",
        ])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .env(
            "PATH",
            format!(
                "{}:{}",
                temp.path().display(),
                std::env::var("PATH").unwrap()
            ),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    for (id, op, name) in [
        (1, "reset", None),
        (2, "observe", None),
        (3, "call", Some("report_collection_miss")),
        (4, "reset", None),
        (5, "observe", None),
    ] {
        writeln!(input, "{}", json!({"id":id,"op":op,"name":name,"args":[]})).unwrap();
    }
    drop(input);
    let output = child.wait_with_output().unwrap();
    assert!(
        !marker.exists(),
        "unused legacy path launched nested Cargo: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let responses: Vec<Value> = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(responses.len(), 5);
    assert_eq!(responses[1]["result"]["bounded_fixture_initialized"], false);
    assert_eq!(responses[4]["result"]["bounded_fixture_initialized"], false);
}
