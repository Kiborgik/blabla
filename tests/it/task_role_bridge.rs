use serde_json::{Value, json};
use std::io::Write;
use std::process::Stdio;

fn adapter(requests: &[Value]) -> Vec<Value> {
    let mut child = crate::source_cli::cargo()
        .args([
            "run",
            "--locked",
            "--quiet",
            "--example",
            "structure-adapter",
        ])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .env_remove("BLABLA_SOURCE_CLI_DIAGNOSTICS")
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
    assert!(
        output.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap()["result"].clone())
        .collect()
}

use crate::component::Component;
use crate::source_cli::Campaign;
use crate::task_roles;
use std::path::PathBuf;

fn call(probe: &mut task_roles::TaskRoles, name: &str, args: Value) {
    probe
        .call(name, &args)
        .expect("recognized role action")
        .unwrap();
}

fn new_probe() -> task_roles::TaskRoles {
    task_roles::TaskRoles::with_campaign(Campaign::with_executable(PathBuf::from(env!(
        "CARGO_BIN_EXE_blabla"
    ))))
}

fn assert_pair_decides(action: &str, before: &Value, after: &Value, fields: &[(&str, bool)]) {
    assert_ne!(
        evaluate(action, before, after),
        blabla::report::RunStatus::Red,
        "{action}"
    );
    for (field, value) in fields {
        let mut mutant = after.clone();
        mutant[*field] = json!(value);
        assert_eq!(
            evaluate(action, before, &mutant),
            blabla::report::RunStatus::Red,
            "{action}: {field}"
        );
    }
}

struct Configuration {
    kind: i64,
    state: &'static str,
    configured: bool,
    registered: bool,
    bootstrap: bool,
    accepted: bool,
    opens: usize,
    decides: bool,
}

fn check_configuration(case: Configuration) {
    let mut probe = new_probe();
    call(&mut probe, "configured_role_fixture", json!([case.kind]));
    let before = probe.observe(&Value::Null);
    assert_eq!(before["role_fixture_initialized"], true);
    assert_eq!(before["role_configuration_state"], case.state);
    assert_eq!(before["role_project_configured"], case.configured);
    assert_eq!(before["requested_role_registered"], case.registered);
    assert_eq!(before["role_free_bootstrap"], case.bootstrap);
    assert_eq!(before["task_open_succeeded"], false);
    for _ in 0..case.opens {
        call(&mut probe, "open_requested_role", json!([]));
        let after = probe.observe(&Value::Null);
        assert_eq!(after["task_open_succeeded"], case.accepted, "{after}");
        assert_eq!(after["task_record_unchanged"], !case.accepted, "{after}");
        assert_eq!(after["task_open_exit"], if case.accepted { 0 } else { 2 });
        assert_eq!(
            after["declared_policy_retained"],
            case.registered && case.accepted
        );
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
        if case.decides {
            assert_pair_decides(
                "open_requested_role",
                &before,
                &after,
                &[
                    ("task_open_succeeded", true),
                    ("task_record_unchanged", false),
                ],
            );
        }
    }
}

macro_rules! configuration_tests {
    ($($name:ident: $kind:expr, $state:expr, $configured:expr, $registered:expr, $bootstrap:expr, $accepted:expr, $opens:expr, $decides:expr;)*) => {
        $(
            #[test]
            fn $name() {
                check_configuration(Configuration {
                    kind: $kind,
                    state: $state,
                    configured: $configured,
                    registered: $registered,
                    bootstrap: $bootstrap,
                    accepted: $accepted,
                    opens: $opens,
                    decides: $decides,
                });
            }
        )*
    };
}

configuration_tests! {
    an_unregistered_requested_role_is_refused: 0, "present", true, false, false, false, 2, true;
    a_registered_requested_role_is_admitted: 1, "present", true, true, false, true, 1, false;
    a_project_without_a_process_file_admits_the_bootstrap_role: 2, "unregistered", false, false, true, true, 2, false;
    an_empty_process_file_admits_the_bootstrap_role: 3, "present", false, false, true, true, 1, false;
    a_missing_process_file_refuses: 4, "missing", false, false, false, false, 1, true;
    an_unreadable_process_file_refuses: 5, "unreadable", false, false, false, false, 1, true;
    an_invalid_process_file_refuses: 6, "invalid", false, false, false, false, 1, true;
    a_non_utf8_process_file_refuses: 7, "unreadable", false, false, false, false, 1, true;
    a_directory_for_the_process_file_refuses: 8, "missing", false, false, false, false, 1, true;
}

#[test]
fn first_use_and_positive_composites_are_actual_decisions_and_clear_prior_outcomes() {
    let mut probe = new_probe();
    let initial = probe.observe(&Value::Null);
    assert_eq!(initial["role_fixture_initialized"], false);
    assert_eq!(initial["role_configuration_state"], "uninitialized");
    call(&mut probe, "configured_role_fixture", json!([0]));
    let configured = probe.observe(&Value::Null);
    assert_pair_decides(
        "configured_role_fixture",
        &initial,
        &configured,
        &[("role_fixture_initialized", false)],
    );
    let mut probe = new_probe();
    call(&mut probe, "open_requested_role", json!([]));
    let prior = probe.observe(&Value::Null);
    assert_eq!(prior["role_fixture_initialized"], true);
    assert_eq!(prior["role_configuration_valid"], true);
    assert_eq!(prior["task_open_exit"], 2);
    call(&mut probe, "open_registered_role", json!([]));
    let registered = probe.observe(&Value::Null);
    assert_eq!(registered["task_open_succeeded"], true);
    assert_eq!(registered["declared_policy_retained"], true);
    assert_pair_decides(
        "open_registered_role",
        &prior,
        &registered,
        &[
            ("task_open_succeeded", false),
            ("declared_policy_retained", false),
        ],
    );
    call(&mut probe, "configured_role_fixture", json!([5]));
    let replaced = probe.observe(&Value::Null);
    assert_eq!(replaced["task_open_exit"], Value::Null);
    assert_eq!(replaced["declared_policy_retained"], false);
    call(&mut probe, "configured_role_fixture", json!([2]));
    let before = probe.observe(&Value::Null);
    call(&mut probe, "open_bootstrap_role", json!([]));
    let bootstrap = probe.observe(&Value::Null);
    assert_eq!(bootstrap["task_open_succeeded"], true);
    assert_eq!(bootstrap["role_free_bootstrap"], true);
    assert_eq!(bootstrap["declared_policy_retained"], false);
    assert_pair_decides(
        "open_bootstrap_role",
        &before,
        &bootstrap,
        &[("task_open_succeeded", false)],
    );
    call(&mut probe, "open_requested_role", json!([]));
    assert_eq!(probe.observe(&Value::Null)["task_open_succeeded"], true);
}

#[test]
fn extreme_integer_kinds_are_finite_and_bad_arguments_are_errors_not_refusals() {
    let mut probe = new_probe();
    for kind in [i64::MIN, i64::MAX, -9, -1, 0, 9] {
        call(&mut probe, "configured_role_fixture", json!([kind]));
        let actual = probe.observe(&Value::Null);
        let mut normalized = new_probe();
        call(
            &mut normalized,
            "configured_role_fixture",
            json!([kind.rem_euclid(9)]),
        );
        assert_eq!(actual, normalized.observe(&Value::Null));
    }
    let before = probe.observe(&Value::Null);
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
        assert_eq!(probe.observe(&Value::Null), before);
    }
    assert!(
        probe
            .call("open_registered_role", &json!([1]))
            .unwrap()
            .is_err()
    );
    assert!(probe.call("unrecognized", &json!([])).is_none());
    assert_eq!(probe.observe(&Value::Null), before);
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
        json!({"id":8,"op":"call","name":"accept_bounded_result","args":[]}),
        json!({"id":9,"op":"observe"}),
        json!({"id":10,"op":"reset"}),
        json!({"id":11,"op":"observe"}),
        json!({"id":12,"op":"call","name":"configured_role_fixture","args":[0]}),
        json!({"id":13,"op":"observe"}),
        json!({"id":14,"op":"call","name":"open_requested_role","args":[]}),
        json!({"id":15,"op":"observe"}),
    ]);
    for index in [1, 3, 4, 6, 8, 10, 12, 14] {
        assert_eq!(rows[index]["ok"], true, "{}", rows[index]);
    }
    assert_eq!(rows[13]["role_project_configured"], true);
    assert_eq!(rows[13]["requested_role_registered"], false);
    assert_eq!(rows[15]["task_open_succeeded"], false);
    assert_eq!(rows[15]["task_record_unchanged"], true);
    let bounded_fields = |value: &Value| {
        let mut value = value.as_object().unwrap().clone();
        value.retain(|key, _| {
            key.starts_with("bounded_")
                || [
                    "result_task_ready",
                    "ordinary_close_accepted",
                    "project_verification_current",
                ]
                .contains(&key.as_str())
        });
        Value::Object(value)
    };
    assert_eq!(bounded_fields(&rows[5]), bounded_fields(&rows[7]));
    for (key, value) in rows[7].as_object().unwrap() {
        if !bounded_fields(&rows[7])
            .as_object()
            .unwrap()
            .contains_key(key)
        {
            assert_eq!(&rows[9][key], value, "bounded close changed {key}");
        }
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
    assert_eq!(rows[11], rows[0]);
}

#[test]
fn every_component_answers_its_own_action_and_reset_restores_the_whole_observation() {
    let actions = [
        "report_collection_miss",
        "open_a_task",
        "select_the_blunt_voice",
        "finish_the_application",
        "declare_an_active_goal_on_a_green_rule",
        "decide_at_or_above_the_floor",
        "take_the_task",
        "ask_a_question_as_the_orchestrator",
        "expert_evaluate_current_claim",
        "no_such_action",
    ];
    let mut requests = vec![json!({"op": "reset"}), json!({"op": "observe"})];
    requests.extend(
        actions
            .iter()
            .map(|name| json!({"op": "call", "name": name, "args": []})),
    );
    requests.extend([json!({"op": "reset"}), json!({"op": "observe"})]);
    let rows = adapter(&requests);
    assert_eq!(rows.len(), requests.len());
    let answered: Vec<Value> = rows[2..2 + actions.len()]
        .iter()
        .map(|row| row["ok"].clone())
        .collect();
    let mut expected = vec![Value::Bool(true); actions.len() - 1];
    expected.push(Value::Bool(false));
    assert_eq!(answered, expected);
    assert_eq!(rows[rows.len() - 1], rows[1]);
}

#[cfg(unix)]
#[test]
fn unused_role_probe_launches_no_cargo_and_invocation_failures_remain_adapter_errors() {
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;
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
            assert!(rows[2]["error"].is_string());
            assert_eq!(rows[3]["role_fixture_initialized"], true);
            assert_eq!(rows[3]["task_open_exit"], Value::Null);
            assert_eq!(rows[3]["task_open_succeeded"], false);
        }
        for index in [1, 5] {
            assert_eq!(rows[index]["role_fixture_initialized"], false);
        }
    }
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
