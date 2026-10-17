#[path = "../bridge/source_cli.rs"]
mod source_cli;
use serde_json::{Value, json};
use std::io::Write;
use std::process::{Command, Stdio};

fn adapter(requests: &[Value]) -> Vec<Value> {
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
    String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap()["result"].clone())
        .collect()
}

#[test]
fn actual_adapter_unknown_role_binding_refuses_without_task_writes() {
    let rows = adapter(&[
        json!({"id":1,"op":"call","name":"configured_role_fixture","args":[0]}),
        json!({"id":2,"op":"observe"}),
        json!({"id":3,"op":"call","name":"open_requested_role","args":[]}),
        json!({"id":4,"op":"observe"}),
    ]);
    assert_eq!(rows[0]["ok"], true, "missing binding: {}", rows[0]);
    assert_eq!(rows[1]["role_project_configured"], true);
    assert_eq!(rows[1]["requested_role_registered"], false);
    assert_eq!(rows[2]["ok"], true, "{}", rows[2]);
    assert_eq!(rows[3]["task_open_succeeded"], false);
    assert_eq!(rows[3]["task_record_unchanged"], true);
}

#[path = "../bridge/task_roles.rs"]
mod task_roles;

fn call(probe: &mut task_roles::TaskRoles, name: &str, args: Value) {
    probe
        .call(name, &args)
        .expect("recognized role action")
        .unwrap();
}

#[test]
fn every_configuration_uses_real_parser_and_open_results_with_repeat_safe_scopes() {
    let mut probe = task_roles::TaskRoles::new();
    for (kind, state, configured, registered, bootstrap, accepted) in [
        (0, "present", true, false, false, false),
        (1, "present", true, true, false, true),
        (2, "unregistered", false, false, true, true),
        (3, "present", false, false, true, true),
        (4, "missing", false, false, false, false),
        (5, "unreadable", false, false, false, false),
        (6, "invalid", false, false, false, false),
        (7, "unreadable", false, false, false, false),
        (8, "missing", false, false, false, false),
    ] {
        call(&mut probe, "configured_role_fixture", json!([kind]));
        let before = probe.observe();
        assert_eq!(before["role_fixture_initialized"], true);
        assert_eq!(before["role_configuration_state"], state);
        assert_eq!(before["role_project_configured"], configured);
        assert_eq!(before["requested_role_registered"], registered);
        assert_eq!(before["role_free_bootstrap"], bootstrap);
        assert_eq!(before["task_open_succeeded"], false);
        for _ in 0..2 {
            call(&mut probe, "open_requested_role", json!([]));
            let after = probe.observe();
            assert_eq!(
                after["task_open_succeeded"], accepted,
                "kind {kind}: {after}"
            );
            assert_eq!(
                after["task_record_unchanged"], !accepted,
                "kind {kind}: {after}"
            );
            assert_eq!(after["task_open_exit"], if accepted { 0 } else { 2 });
            assert_eq!(after["declared_policy_retained"], registered && accepted);
            for key in [
                "role_fixture_initialized",
                "role_configuration_state",
                "role_project_configured",
                "requested_role_registered",
                "role_free_bootstrap",
                "role_configuration_valid",
                "requested_role",
            ] {
                assert_eq!(
                    after[key], before[key],
                    "changed prepared configuration {key}"
                );
            }
        }
    }
}

#[test]
fn first_use_and_positive_composites_are_actual_decisions_and_clear_prior_outcomes() {
    let mut probe = task_roles::TaskRoles::new();
    assert_eq!(probe.observe()["role_fixture_initialized"], false);
    assert_eq!(probe.observe()["role_configuration_state"], "uninitialized");
    call(&mut probe, "open_requested_role", json!([]));
    assert_eq!(probe.observe()["role_fixture_initialized"], true);
    assert_eq!(probe.observe()["role_configuration_valid"], true);
    assert_eq!(probe.observe()["task_open_exit"], 2);
    call(&mut probe, "open_registered_role", json!([]));
    assert_eq!(probe.observe()["task_open_succeeded"], true);
    assert_eq!(probe.observe()["declared_policy_retained"], true);
    call(&mut probe, "open_registered_role", json!([]));
    assert_eq!(probe.observe()["task_open_succeeded"], true);
    call(&mut probe, "configured_role_fixture", json!([5]));
    assert_eq!(probe.observe()["task_open_exit"], Value::Null);
    assert_eq!(probe.observe()["declared_policy_retained"], false);
    call(&mut probe, "open_bootstrap_role", json!([]));
    assert_eq!(probe.observe()["task_open_succeeded"], true);
    assert_eq!(probe.observe()["role_free_bootstrap"], true);
    assert_eq!(probe.observe()["declared_policy_retained"], false);
    call(&mut probe, "open_requested_role", json!([]));
    assert_eq!(probe.observe()["task_open_succeeded"], true);
}

#[test]
fn extreme_integer_kinds_are_finite_and_bad_arguments_are_errors_not_refusals() {
    let mut probe = task_roles::TaskRoles::new();
    for kind in [i64::MIN, i64::MAX, -9, -1, 0, 9] {
        call(&mut probe, "configured_role_fixture", json!([kind]));
        let actual = probe.observe();
        let mut normalized = task_roles::TaskRoles::new();
        call(
            &mut normalized,
            "configured_role_fixture",
            json!([kind.rem_euclid(9)]),
        );
        assert_eq!(actual, normalized.observe());
    }
    let before = probe.observe();
    for args in [
        json!(null),
        json!({"kind":0}),
        json!([]),
        json!(["0"]),
        json!([0, 1]),
        json!([1.5]),
        json!([u64::MAX]),
    ] {
        assert!(
            probe
                .call("configured_role_fixture", &args)
                .unwrap()
                .is_err()
        );
        assert_eq!(probe.observe(), before);
    }
    assert!(
        probe
            .call("open_registered_role", &json!([1]))
            .unwrap()
            .is_err()
    );
    assert!(probe.call("unrecognized", &json!([])).is_none());
    assert_eq!(probe.observe(), before);
}

fn role_fields(value: &Value) -> Value {
    let mut value = value.as_object().unwrap().clone();
    value.retain(|key, _| {
        key.starts_with("role_")
            || key == "requested_role"
            || key == "requested_role_registered"
            || key == "task_open_succeeded"
            || key == "task_open_exit"
            || key == "task_record_unchanged"
            || key == "declared_policy_retained"
    });
    Value::Object(value)
}

#[test]
fn adapter_reset_and_two_way_legacy_and_bounded_isolation_preserve_all_other_fields() {
    let rows = adapter(&[
        json!({"id":0,"op":"observe"}),
        json!({"id":1,"op":"call","name":"open_registered_role","args":[]}),
        json!({"id":2,"op":"observe"}),
        json!({"id":3,"op":"call","name":"report_collection_miss","args":[]}),
        json!({"id":4,"op":"call","name":"bounded_success_fixture","args":[]}),
        json!({"id":5,"op":"observe"}),
        json!({"id":6,"op":"call","name":"open_bootstrap_role","args":[]}),
        json!({"id":7,"op":"observe"}),
        json!({"id":8,"op":"reset"}),
        json!({"id":9,"op":"observe"}),
    ]);
    for index in [1, 3, 4, 6, 8] {
        assert_eq!(rows[index]["ok"], true, "{}", rows[index]);
    }
    assert_eq!(role_fields(&rows[2]), role_fields(&rows[5]));
    for index in [0, 5] {
        let after = if index == 0 { 2 } else { 7 };
        for (key, value) in rows[index].as_object().unwrap() {
            if !role_fields(&rows[index])
                .as_object()
                .unwrap()
                .contains_key(key)
            {
                assert_eq!(&rows[after][key], value, "role action changed {key}");
            }
        }
    }
    assert_eq!(rows[9], rows[0]);
}

#[cfg(unix)]
#[test]
fn unused_role_probe_launches_no_cargo_and_invocation_failures_remain_adapter_errors() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::TempDir::new().unwrap();
    let marker = temp.path().join("invoked");
    let cargo = temp.path().join("cargo");
    std::fs::write(
        &cargo,
        format!(
            "#!/bin/sh\nprintf invoked > '{}'\nexit 77\n",
            marker.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&cargo, std::fs::Permissions::from_mode(0o755)).unwrap();
    for active in [false, true] {
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
        for request in [
            json!({"id":0,"op":"reset"}),
            json!({"id":1,"op":"observe"}),
            json!({"id":2,"op":"call","name":if active { "open_requested_role" } else { "report_collection_hit" },"args":[]}),
            json!({"id":5,"op":"observe"}),
            json!({"id":3,"op":"reset"}),
            json!({"id":4,"op":"observe"}),
        ] {
            writeln!(input, "{request}").unwrap();
        }
        drop(input);
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let rows: Vec<Value> = String::from_utf8(output.stdout)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap()["result"].clone())
            .collect();
        assert_eq!(marker.exists(), active);
        assert_eq!(rows[2]["ok"], !active);
        if active {
            assert!(rows[2]["error"].as_str().unwrap().contains("non-JSON"));
            assert_eq!(rows[3]["role_fixture_initialized"], true);
            assert_eq!(rows[3]["task_open_exit"], Value::Null);
            assert_eq!(rows[3]["task_open_succeeded"], false);
        }
        for index in [1, 5] {
            assert_eq!(rows[index]["role_fixture_initialized"], false);
        }
    }
}

#[test]
fn actual_runtime_uses_configured_eight_second_request_budget() {
    use blabla::application::{AppConfig, Application};
    use blabla::report::Call;
    use blabla::runtime::AppSession;
    use std::time::{Duration, Instant};
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
        Duration::from_millis(8000),
    );
    let mut session = AppSession::spawn(&config).unwrap();
    let start = Instant::now();
    session.reset().unwrap();
    eprintln!(
        "role runtime startup/reset: {} ms",
        start.elapsed().as_millis()
    );
    for (action, args) in [
        ("open_requested_role", vec![]),
        ("open_registered_role", vec![]),
        ("open_bootstrap_role", vec![]),
        ("configured_role_fixture", vec![json!(i64::MIN)]),
        ("open_requested_role", vec![]),
    ] {
        let start = Instant::now();
        session
            .call(&Call {
                action: action.into(),
                args,
            })
            .unwrap();
        eprintln!("role runtime {action}: {} ms", start.elapsed().as_millis());
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
fn evaluate(action: &str, before: &Value, after: &Value) -> blabla::report::RunStatus {
    let source = std::fs::read_to_string(format!(
        "{}/contracts/task-role-resolution.bla",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    let mut contract = blabla::semantics::compile("task-role-resolution.bla", &source).unwrap();
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
    .status
}
#[test]
fn actual_decision_pairs_satisfy_draft_rules_and_detect_adversarial_observation_mutations() {
    use blabla::report::RunStatus;
    let mut probe = task_roles::TaskRoles::new();
    let before = probe.observe();
    call(&mut probe, "configured_role_fixture", json!([0]));
    let after = probe.observe();
    assert_ne!(
        evaluate("configured_role_fixture", &before, &after),
        RunStatus::Red
    );
    let mut mutant = after.clone();
    mutant["role_fixture_initialized"] = json!(false);
    assert_eq!(
        evaluate("configured_role_fixture", &before, &mutant),
        RunStatus::Red
    );
    for kind in [0, 4, 5, 6, 7, 8] {
        call(&mut probe, "configured_role_fixture", json!([kind]));
        let before = probe.observe();
        call(&mut probe, "open_requested_role", json!([]));
        let after = probe.observe();
        assert_ne!(
            evaluate("open_requested_role", &before, &after),
            RunStatus::Red
        );
        for field in ["task_open_succeeded", "task_record_unchanged"] {
            let mut mutant = after.clone();
            mutant[field] = json!(field == "task_open_succeeded");
            assert_eq!(
                evaluate("open_requested_role", &before, &mutant),
                RunStatus::Red,
                "kind {kind}, field {field}"
            );
        }
    }
    for (kind, action, fields) in [
        (
            0,
            "open_registered_role",
            vec!["task_open_succeeded", "declared_policy_retained"],
        ),
        (2, "open_bootstrap_role", vec!["task_open_succeeded"]),
    ] {
        call(&mut probe, "configured_role_fixture", json!([kind]));
        let before = probe.observe();
        call(&mut probe, action, json!([]));
        let after = probe.observe();
        assert_ne!(evaluate(action, &before, &after), RunStatus::Red);
        for field in fields {
            let mut mutant = after.clone();
            mutant[field] = json!(false);
            assert_eq!(evaluate(action, &before, &mutant), RunStatus::Red);
        }
    }
}
