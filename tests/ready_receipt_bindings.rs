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
fn actual_adapter_binds_a_genuine_positive_ready_receipt() {
    let _guard = serial();
    let rows = adapter(&[
        json!({"id":1,"op":"call","name":"ready_receipt_fixture","args":[0]}),
        json!({"id":2,"op":"observe"}),
        json!({"id":3,"op":"call","name":"refresh_ready_disposition","args":[]}),
        json!({"id":4,"op":"observe"}),
    ]);
    assert_eq!(rows[0]["ok"], true, "missing binding: {}", rows[0]);
    assert_eq!(rows[1]["ready_receipt_eligible"], true);
    assert_eq!(rows[2]["ok"], true, "{}", rows[2]);
    assert_eq!(rows[3]["ready_receipt_succeeded"], true);
    assert_eq!(rows[3]["ready_receipt_epoch_preserved"], true);
    assert_eq!(rows[3]["ready_receipt_evidence_preserved"], true);
}

#[path = "../bridge/ready_receipts.rs"]
mod ready_receipts;

fn serial() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn call(probe: &mut ready_receipts::ReadyReceipts, name: &str, args: Value) {
    probe
        .call(name, &args)
        .expect("recognized receipt action")
        .unwrap();
}

#[test]
fn all_finite_fixtures_use_actual_positive_or_zero_effect_refusal_outcomes() {
    let _guard = serial();
    for reflection in [false, true] {
        for kind in 0..12 {
            let mut probe = ready_receipts::ReadyReceipts::new();
            call(&mut probe, "ready_receipt_fixture", json!([kind]));
            let before = probe.observe();
            let eligible = matches!(kind, 0 | 7 | 8 | 10 | 11);
            assert_eq!(before["ready_receipt_fixture_initialized"], true);
            assert_eq!(
                before["ready_receipt_eligible"], eligible,
                "kind {kind}: {before}"
            );
            let action = if reflection {
                "refresh_ready_reflection"
            } else {
                "refresh_ready_disposition"
            };
            for _ in 0..2 {
                call(&mut probe, action, json!([]));
                let after = probe.observe();
                assert_eq!(
                    after["ready_receipt_succeeded"], eligible,
                    "kind {kind}: {after}"
                );
                assert_eq!(after["ready_receipt_exit"], if eligible { 0 } else { 2 });
                if eligible {
                    for field in [
                        "epoch_preserved",
                        "evidence_preserved",
                        "scope_preserved",
                        "target_preserved",
                        "explicit_claim_only",
                        "writer_provenance_current",
                        "observed_identities_retained",
                        "challenge_cleared",
                        "close_blockers_preserved",
                    ] {
                        assert_eq!(
                            after[format!("ready_receipt_{field}")],
                            true,
                            "kind {kind}, {field}: {after}"
                        );
                    }
                } else {
                    assert_eq!(
                        after["ready_receipt_record_unchanged"], true,
                        "kind {kind}: {after}"
                    );
                }
            }
            call(&mut probe, "check_refreshed_closure", json!([]));
            let checked = probe.observe();
            assert_eq!(
                checked["ready_receipt_close_blockers_preserved"], true,
                "kind {kind}: {checked}"
            );
            assert_eq!(checked["ready_receipt_close_exit"], 2);
            assert_eq!(checked["ready_receipt_record_unchanged"], true);
            assert_ne!(checked["ready_receipt_task_state"], "closed");
            assert_eq!(checked["ready_receipt_succeeded"], false);
            assert_eq!(checked["ready_receipt_exit"], Value::Null);
        }
    }
}

#[test]
fn both_claim_kinds_remember_observed_but_unclaimed_identities() {
    let _guard = serial();
    for action in ["refresh_ready_disposition", "refresh_ready_reflection"] {
        let mut probe = ready_receipts::ReadyReceipts::new();
        call(&mut probe, "ready_receipt_fixture", json!([7]));
        call(&mut probe, action, json!([]));
        let observed = probe.observe();
        assert_eq!(observed["ready_receipt_observed_identities_retained"], true);
        let identity = observed["ready_receipt_pending_identities"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["identity"] == "policy::observed-obligation")
            .unwrap();
        assert_eq!(identity["state"], "missing");
        call(&mut probe, "ready_receipt_fixture", json!([8]));
        let removed = probe.observe();
        let identity = removed["ready_receipt_pending_identities"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["identity"] == "policy::observed-obligation")
            .unwrap();
        assert_eq!(identity["state"], "missing");
        call(&mut probe, action, json!([]));
        assert_eq!(
            probe.observe()["ready_receipt_observed_identities_retained"],
            true
        );
    }
}

#[test]
fn lazy_initialization_and_reset_do_not_invent_a_task_or_a_decision() {
    let _guard = serial();
    let start = std::time::Instant::now();
    for _ in 0..152 {
        let probe = ready_receipts::ReadyReceipts::new();
        let untouched = probe.observe();
        assert_eq!(untouched["ready_receipt_fixture_initialized"], false);
        assert_eq!(untouched["ready_receipt_task_state"], Value::Null);
        assert_eq!(untouched["ready_receipt_exit"], Value::Null);
        assert_eq!(untouched["ready_receipt_succeeded"], false);
    }
    eprintln!(
        "152 unused receipt construction/observations: {} ms",
        start.elapsed().as_millis()
    );
    for action in [
        "refresh_ready_disposition",
        "refresh_ready_reflection",
        "check_refreshed_closure",
    ] {
        let mut probe = ready_receipts::ReadyReceipts::new();
        call(&mut probe, action, json!([]));
        let observed = probe.observe();
        assert_eq!(observed["ready_receipt_fixture_initialized"], true);
        if action == "check_refreshed_closure" {
            assert_eq!(observed["ready_receipt_close_blockers_preserved"], true);
        } else {
            assert_eq!(observed["ready_receipt_succeeded"], true);
        }
        probe = ready_receipts::ReadyReceipts::new();
        assert_eq!(probe.observe()["ready_receipt_fixture_initialized"], false);
    }
}

#[test]
fn hostile_kinds_are_bounded_and_malformed_arguments_do_not_become_refusals() {
    let _guard = serial();
    for kind in [i64::MIN, i64::MAX] {
        let mut probe = ready_receipts::ReadyReceipts::new();
        call(&mut probe, "ready_receipt_fixture", json!([kind]));
        let before = probe.observe();
        let mut normalized = ready_receipts::ReadyReceipts::new();
        call(
            &mut normalized,
            "ready_receipt_fixture",
            json!([kind.rem_euclid(12)]),
        );
        for field in [
            "ready_receipt_eligible",
            "ready_receipt_task_state",
            "ready_receipt_unresolved_findings",
        ] {
            assert_eq!(before[field], normalized.observe()[field]);
        }
        for args in [
            json!(null),
            json!({"kind":0}),
            json!([]),
            json!([0, 1]),
            json!(["0"]),
            json!([1.5]),
            json!([u64::MAX]),
        ] {
            assert!(probe.call("ready_receipt_fixture", &args).unwrap().is_err());
            assert_eq!(probe.observe(), before);
        }
        assert!(
            probe
                .call("refresh_ready_reflection", &json!([0]))
                .unwrap()
                .is_err()
        );
        assert!(probe.call("unknown", &json!([])).is_none());
        assert_eq!(probe.observe(), before);
    }
}

fn receipt_fields(value: &Value) -> Value {
    Value::Object(
        value
            .as_object()
            .unwrap()
            .iter()
            .filter(|(key, _)| key.starts_with("ready_receipt_"))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    )
}

#[test]
fn adapter_reset_and_two_way_isolation_preserve_legacy_role_and_bounded_probes() {
    let _guard = serial();
    let rows = adapter(&[
        json!({"id":0,"op":"observe"}),
        json!({"id":1,"op":"call","name":"ready_receipt_fixture","args":[0]}),
        json!({"id":2,"op":"call","name":"refresh_ready_reflection","args":[]}),
        json!({"id":3,"op":"observe"}),
        json!({"id":4,"op":"call","name":"open_registered_role","args":[]}),
        json!({"id":5,"op":"call","name":"report_collection_miss","args":[]}),
        json!({"id":6,"op":"call","name":"bounded_success_fixture","args":[]}),
        json!({"id":7,"op":"observe"}),
        json!({"id":8,"op":"call","name":"refresh_ready_disposition","args":[]}),
        json!({"id":9,"op":"observe"}),
        json!({"id":10,"op":"reset"}),
        json!({"id":11,"op":"observe"}),
    ]);
    for index in [1, 2, 4, 5, 6, 8, 10] {
        assert_eq!(rows[index]["ok"], true, "{}", rows[index]);
    }
    assert_eq!(receipt_fields(&rows[3]), receipt_fields(&rows[7]));
    for (before, after) in [(0, 3), (7, 9)] {
        for (key, value) in rows[before].as_object().unwrap() {
            if !key.starts_with("ready_receipt_") {
                assert_eq!(&rows[after][key], value, "receipt action changed {key}");
            }
        }
    }
    assert_eq!(rows[11], rows[0]);
}

#[test]
fn actual_runtime_respects_existing_five_second_budget_for_a_finite_sequence() {
    use blabla::application::{AppConfig, Application};
    use blabla::report::Call;
    use blabla::runtime::AppSession;
    use std::time::{Duration, Instant};
    let _guard = serial();
    let config = AppConfig::launched(
        "cargo".into(),
        vec![
            "run".into(),
            "--locked".into(),
            "--quiet".into(),
            "--manifest-path".into(),
            format!("{}/Cargo.toml", env!("CARGO_MANIFEST_DIR")).into(),
            "--example".into(),
            "structure-adapter".into(),
        ],
        Duration::from_millis(5000),
    );
    let mut session = AppSession::spawn(&config).unwrap();
    let started = Instant::now();
    session.reset().unwrap();
    eprintln!(
        "receipt runtime startup/reset: {} ms",
        started.elapsed().as_millis()
    );
    for (action, args) in [
        ("refresh_ready_disposition", vec![]),
        ("refresh_ready_reflection", vec![]),
        ("check_refreshed_closure", vec![]),
        ("ready_receipt_fixture", vec![json!(10)]),
        ("refresh_ready_reflection", vec![]),
        ("ready_receipt_fixture", vec![json!(5)]),
        ("refresh_ready_disposition", vec![]),
    ] {
        let start = Instant::now();
        session
            .call(&Call {
                action: action.into(),
                args,
            })
            .unwrap();
        eprintln!(
            "receipt runtime {action}: {} ms",
            start.elapsed().as_millis()
        );
    }
    session.finish().unwrap();
}

#[cfg(unix)]
#[test]
fn unused_receipt_probe_launches_no_cargo_and_dependency_failures_remain_adapter_errors() {
    use std::os::unix::fs::PermissionsExt;
    let _guard = serial();
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
            json!({"id":2,"op":"call","name":if active { "refresh_ready_disposition" } else { "report_collection_hit" },"args":[]}),
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
            assert_eq!(rows[3]["ready_receipt_fixture_initialized"], false);
            assert_eq!(rows[3]["ready_receipt_exit"], Value::Null);
            assert_eq!(rows[3]["ready_receipt_succeeded"], false);
        }
        for index in [1, 5] {
            assert_eq!(rows[index]["ready_receipt_fixture_initialized"], false);
        }
    }
}
