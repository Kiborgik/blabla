use serde_json::{Value, json};
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Instant;

fn adapter(requests: &[Value]) -> Vec<Value> {
    let started = Instant::now();
    let mut child = Command::new("cargo")
        .args([
            "run",
            "--locked",
            "--quiet",
            "--example",
            "structure-adapter",
        ])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    for request in requests {
        writeln!(input, "{request}").unwrap();
    }
    drop(input);
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    eprintln!("{}", String::from_utf8_lossy(&output.stderr));
    eprintln!(
        "adapter batch including source Cargo startup: {:?}",
        started.elapsed()
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap()["result"].clone())
        .collect()
}

#[test]
fn named_real_bounded_fixture_accepts_and_keeps_project_stale() {
    let results = adapter(&[
        json!({"id":1,"op":"call","name":"bounded_result_fixture","args":[0]}),
        json!({"id":2,"op":"observe"}),
        json!({"id":3,"op":"call","name":"accept_bounded_result","args":[]}),
        json!({"id":4,"op":"observe"}),
    ]);
    assert_eq!(
        results[0]["ok"], true,
        "missing genuine fixture binding: {}",
        results[0]
    );
    assert_eq!(results[1]["result_task_ready"], true);
    assert_eq!(results[1]["bounded_prior_canonical_green"], true);
    assert_eq!(results[1]["bounded_implementation_only_drift"], true);
    assert_eq!(results[2]["ok"], true);
    assert_eq!(results[3]["bounded_accepted"], true);
    assert_eq!(results[3]["bounded_basis_recorded"], true, "{}", results[3]);
    assert_eq!(results[3]["bounded_task_revision_current"], true);
    assert_eq!(
        results[3]["bounded_verification_eligibility_current"], true,
        "{}",
        results[3]
    );
    assert_eq!(results[3]["bounded_project_record_unchanged"], true);
    assert_eq!(results[3]["bounded_project_completion_allowed"], false);
}

#[path = "../bridge/bounded_results.rs"]
mod bounded_results;

fn call(probe: &mut bounded_results::BoundedResults, name: &str, args: Value) {
    probe.call(name, &args).expect("recognized action").unwrap();
}

#[test]
fn positive_modes_refusals_repeated_results_and_reset_use_actual_cli() {
    let mut probe = bounded_results::BoundedResults::new();
    assert_eq!(probe.observe()["project_verification_current"], false);
    assert_eq!(probe.observe()["bounded_fixture_initialized"], false);
    call(&mut probe, "accept_bounded_result", json!([]));
    assert_eq!(probe.observe()["bounded_accepted"], false);
    assert_eq!(probe.observe()["bounded_fixture_initialized"], true);
    assert_eq!(probe.observe()["bounded_project_completion_allowed"], true);
    call(&mut probe, "accept_ordinary_result", json!([]));
    assert_eq!(probe.observe()["ordinary_close_accepted"], true);
    call(&mut probe, "accept_ordinary_result", json!([]));
    assert_eq!(probe.observe()["ordinary_close_accepted"], false);
    assert_eq!(probe.observe()["bounded_project_record_unchanged"], true);
    call(&mut probe, "bounded_success_fixture", json!([]));
    let before = probe.observe();
    assert_eq!(before["result_task_ready"], true);
    assert_eq!(before["bounded_other_blockers_clear"], true);
    call(&mut probe, "accept_ordinary_result", json!([]));
    assert_eq!(probe.observe()["ordinary_close_accepted"], false);
    call(&mut probe, "accept_bounded_result", json!([]));
    let accepted = probe.observe();
    for field in [
        "bounded_accepted",
        "bounded_basis_recorded",
        "bounded_project_record_unchanged",
        "bounded_task_revision_current",
        "bounded_verification_eligibility_current",
    ] {
        assert_eq!(accepted[field], true, "{field}: {accepted}");
    }
    call(&mut probe, "accept_bounded_result", json!([]));
    assert_eq!(probe.observe()["bounded_accepted"], false);
    assert_eq!(probe.observe()["bounded_basis_recorded"], false);
    call(&mut probe, "ordinary_success_fixture", json!([]));
    call(&mut probe, "accept_ordinary_result", json!([]));
    assert_eq!(probe.observe()["ordinary_close_accepted"], true);
}

#[test]
fn each_real_refusal_exposes_its_actual_disqualifying_fact() {
    let mut probe = bounded_results::BoundedResults::new();
    for (kind, field) in [
        (2, "bounded_task_revision_current"),
        (3, "bounded_other_blockers_clear"),
        (4, "bounded_prior_canonical_green"),
        (5, "bounded_prior_canonical_green"),
        (6, "bounded_owner_attested"),
        (7, "bounded_reason_present"),
        (8, "bounded_implementation_only_drift"),
    ] {
        call(&mut probe, "bounded_result_fixture", json!([kind]));
        let before = probe.observe();
        assert_eq!(before[field], false, "fixture {kind}: {before}");
        call(&mut probe, "accept_bounded_result", json!([]));
        let after = probe.observe();
        assert_eq!(after["bounded_accepted"], false, "fixture {kind}: {after}");
        assert_eq!(after["bounded_project_record_unchanged"], true);
    }
}

#[test]
fn finite_kind_normalization_and_bad_arguments_do_not_fabricate_refusals() {
    let mut probe = bounded_results::BoundedResults::new();
    call(&mut probe, "bounded_result_fixture", json!([-9]));
    let before = probe.observe();
    assert_eq!(before["bounded_implementation_only_drift"], true);
    assert!(
        probe
            .call("bounded_result_fixture", &json!(["invalid"]))
            .unwrap()
            .is_err()
    );
    assert_eq!(probe.observe(), before);
    assert!(probe.call("unknown_action", &json!([])).is_none());
    assert_eq!(probe.observe(), before);
    let unchanged = probe.observe();
    assert_eq!(probe.observe(), unchanged);
}

#[test]
fn adapter_reset_and_two_way_isolation_keep_legacy_fields_separate() {
    let results = adapter(&[
        json!({"id":1,"op":"observe"}),
        json!({"id":2,"op":"call","name":"bounded_success_fixture","args":[]}),
        json!({"id":3,"op":"observe"}),
        json!({"id":4,"op":"call","name":"report_collection_miss","args":[]}),
        json!({"id":5,"op":"observe"}),
        json!({"id":6,"op":"call","name":"accept_bounded_result","args":[]}),
        json!({"id":7,"op":"observe"}),
        json!({"id":8,"op":"reset"}),
        json!({"id":9,"op":"observe"}),
    ]);
    for index in [1, 3, 5, 7] {
        assert_eq!(results[index]["ok"], true, "{}", results[index]);
    }
    for (key, value) in results[0].as_object().unwrap() {
        if !key.starts_with("bounded_")
            && ![
                "result_task_ready",
                "ordinary_close_accepted",
                "project_verification_current",
            ]
            .contains(&key.as_str())
        {
            assert_eq!(&results[2][key], value, "bounded setup changed {key}");
            assert_eq!(
                results[4][key], results[6][key],
                "bounded close changed {key}"
            );
        }
    }
    for (key, value) in results[2].as_object().unwrap() {
        if key.starts_with("bounded_")
            || [
                "result_task_ready",
                "ordinary_close_accepted",
                "project_verification_current",
            ]
            .contains(&key.as_str())
        {
            assert_eq!(&results[4][key], value, "legacy action changed {key}");
        }
    }
    assert_eq!(results[8], results[0]);
}

#[test]
fn real_runtime_protocol_and_existing_request_budget_reach_every_named_setup() {
    use blabla::application::{AppConfig, Application};
    use blabla::report::Call;
    use blabla::runtime::AppSession;
    use std::time::Duration;
    let manifest = format!("{}/Cargo.toml", env!("CARGO_MANIFEST_DIR"));
    let config = AppConfig::launched(
        "cargo".into(),
        [
            "run",
            "--locked",
            "--quiet",
            "--manifest-path",
            &manifest,
            "--example",
            "structure-adapter",
        ]
        .into_iter()
        .map(Into::into)
        .collect(),
        Duration::from_millis(5000),
    );
    let mut session = AppSession::spawn(&config).unwrap();
    let start = Instant::now();
    session.reset().unwrap();
    eprintln!(
        "actual runtime source startup and reset: {} ms",
        start.elapsed().as_millis()
    );
    for (name, args) in [
        ("bounded_result_fixture", vec![json!(0)]),
        ("accept_bounded_result", vec![]),
        ("ordinary_success_fixture", vec![]),
        ("accept_ordinary_result", vec![]),
        ("bounded_success_fixture", vec![]),
    ] {
        let start = Instant::now();
        session
            .call(&Call {
                action: name.into(),
                args,
            })
            .unwrap();
        eprintln!("actual runtime {name}: {} ms", start.elapsed().as_millis());
    }
    session.finish().unwrap();
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

#[test]
fn actual_decision_pairs_satisfy_draft_predicates_and_detect_adversarial_outputs() {
    let mut probe = bounded_results::BoundedResults::new();
    for (setup, action, accepted) in [
        (
            "bounded_success_fixture",
            "accept_bounded_result",
            "bounded_accepted",
        ),
        (
            "ordinary_success_fixture",
            "accept_ordinary_result",
            "ordinary_close_accepted",
        ),
    ] {
        let previous = probe.observe();
        call(&mut probe, setup, json!([]));
        let before = probe.observe();
        assert_ne!(
            evaluate_pair(setup, &previous, &before).status,
            blabla::report::RunStatus::Red
        );
        call(&mut probe, action, json!([]));
        let after = probe.observe();
        assert_eq!(after[accepted], true);
        assert_ne!(
            evaluate_pair(action, &before, &after).status,
            blabla::report::RunStatus::Red
        );
        let mut refused = after.clone();
        refused[accepted] = json!(false);
        assert_eq!(
            evaluate_pair(action, &before, &refused).status,
            blabla::report::RunStatus::Red
        );
        let mut changed = after.clone();
        changed["bounded_project_record_unchanged"] = json!(false);
        assert_eq!(
            evaluate_pair(action, &before, &changed).status,
            blabla::report::RunStatus::Red
        );
        if action == "accept_bounded_result" {
            for field in [
                "bounded_basis_recorded",
                "bounded_task_revision_current",
                "bounded_verification_eligibility_current",
            ] {
                let mut changed = after.clone();
                changed[field] = json!(false);
                assert_eq!(
                    evaluate_pair(action, &before, &changed).status,
                    blabla::report::RunStatus::Red,
                    "{field}"
                );
            }
            let mut completed = after.clone();
            completed["bounded_project_completion_allowed"] = json!(true);
            assert_eq!(
                evaluate_pair(action, &before, &completed).status,
                blabla::report::RunStatus::Red
            );
        }
    }
    for kind in [3, 4, 5] {
        call(&mut probe, "bounded_result_fixture", json!([kind]));
        let before = probe.observe();
        call(&mut probe, "accept_bounded_result", json!([]));
        let after = probe.observe();
        assert_ne!(
            evaluate_pair("accept_bounded_result", &before, &after).status,
            blabla::report::RunStatus::Red
        );
        let mut admitted = after.clone();
        admitted["bounded_accepted"] = json!(true);
        assert_eq!(
            evaluate_pair("accept_bounded_result", &before, &admitted).status,
            blabla::report::RunStatus::Red
        );
    }
}

#[test]
fn unused_probe_is_explicitly_uninitialized_until_a_real_first_close() {
    let mut probe = bounded_results::BoundedResults::new();
    let before = probe.observe();
    assert_eq!(before["bounded_fixture_initialized"], false);
    for field in [
        "result_task_ready",
        "bounded_prior_canonical_green",
        "project_verification_current",
        "bounded_accepted",
        "ordinary_close_accepted",
    ] {
        assert_eq!(before[field], false, "unused probe fabricated {field}");
    }
    call(&mut probe, "accept_ordinary_result", json!([]));
    let after = probe.observe();
    assert_eq!(after["bounded_fixture_initialized"], true);
    assert_eq!(after["ordinary_close_accepted"], true);
    assert_eq!(after["bounded_project_record_unchanged"], true);
    assert_ne!(
        evaluate_pair("accept_ordinary_result", &before, &after).status,
        blabla::report::RunStatus::Red
    );
}

#[cfg(unix)]
#[test]
fn legacy_startup_resets_and_observations_never_launch_nested_cargo() {
    use std::os::unix::fs::PermissionsExt;
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
