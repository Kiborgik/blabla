use serde_json::{Value, json};
#[path = "../bridge/development_effort.rs"]
mod development_effort;
#[path = "../bridge/source_cli.rs"]
mod source_cli;

fn serial() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|p| p.into_inner())
}
fn call(p: &mut development_effort::DevelopmentEffort, name: &str, args: Value) {
    p.call(name, &args).expect("bound action").unwrap();
}

#[test]
fn positive_real_phase_and_threshold_inputs_are_independently_qualified() {
    let _guard = serial();
    let mut p = development_effort::DevelopmentEffort::new();
    assert_eq!(p.observe()["phase_fixture_initialized"], false);
    call(&mut p, "positive_phase_fixture", json!([]));
    let before = p.observe();
    assert_eq!(before["eligible"], true);
    call(&mut p, "switch_phase", json!([]));
    let after = p.observe();
    assert_eq!(after["succeeded"], true);
    assert_eq!(after["phase_interval_count"], 1);
    assert_eq!(after["freshness_preserved"], true);
    assert_eq!(after["authority_preserved"], true);
    call(&mut p, "switch_phase", json!([]));
    assert_eq!(p.observe()["records_unchanged"], true);
    call(&mut p, "threshold_budget_fixture", json!([]));
    assert_eq!(p.observe()["budget_fixture_qualified"], true);
    call(&mut p, "inspect_budget", json!([]));
    let b = p.observe();
    assert_eq!(b["budget"]["active_seconds"], 100);
    assert_eq!(b["budget"]["overhead_seconds"], 20);
    assert_eq!(b["budget"]["observed_target"], "within");
    assert_eq!(b["budget"]["coverage"], "partial");
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
        "{}/contracts/development-effort.bla",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    let mut contract = blabla::semantics::compile("development-effort.bla", &source).unwrap();
    contract.actions.retain(|a| a.name == action);
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
fn accepts(action: &str, before: &Value, after: &Value) {
    assert_ne!(
        evaluate(action, before, after),
        blabla::report::RunStatus::Red,
        "{action}: {after}"
    );
}
fn rejects_mutation(action: &str, before: &Value, after: &Value, field: &str, value: Value) {
    let mut bad = after.clone();
    bad[field] = value;
    assert_eq!(
        evaluate(action, before, &bad),
        blabla::report::RunStatus::Red,
        "missed {field}"
    );
}

#[test]
fn every_phase_preparation_and_repeat_uses_real_cli_and_falsifiable_contract_facts() {
    let _guard = serial();
    let mut p = development_effort::DevelopmentEffort::new();
    for kind in 0..12 {
        let previous = p.observe();
        call(&mut p, "phase_fixture", json!([kind]));
        let prepared = p.observe();
        accepts("phase_fixture", &previous, &prepared);
        rejects_mutation(
            "phase_fixture",
            &previous,
            &prepared,
            "phase_fixture_initialized",
            json!(false),
        );
        assert_eq!(
            prepared["eligible"],
            matches!(kind, 0 | 6 | 7 | 8 | 9 | 10),
            "kind {kind}"
        );
        assert!(prepared["phase_exit"].is_null());
        for _ in 0..2 {
            let before = p.observe();
            call(&mut p, "switch_phase", json!([]));
            let after = p.observe();
            accepts("switch_phase", &before, &after);
            assert_eq!(
                after["succeeded"], before["eligible"],
                "kind {kind}: {after}"
            );
            assert_eq!(
                after["phase_exit"],
                if before["eligible"] == true { 0 } else { 2 }
            );
            for f in ["freshness_preserved", "authority_preserved"] {
                assert_eq!(after[f], true);
                rejects_mutation("switch_phase", &before, &after, f, json!(false));
            }
            if before["eligible"] == true {
                assert_eq!(after["intervals_nonoverlapping"], true);
                rejects_mutation("switch_phase", &before, &after, "succeeded", json!(false));
                rejects_mutation(
                    "switch_phase",
                    &before,
                    &after,
                    "intervals_nonoverlapping",
                    json!(false),
                );
            } else {
                assert_eq!(after["records_unchanged"], true);
                rejects_mutation("switch_phase", &before, &after, "succeeded", json!(true));
                rejects_mutation(
                    "switch_phase",
                    &before,
                    &after,
                    "records_unchanged",
                    json!(false),
                );
            }
        }
    }
}

#[test]
fn synthetic_arithmetic_exercises_threshold_waits_unknown_overlap_windows_and_cap() {
    let _guard = serial();
    let mut p = development_effort::DevelopmentEffort::new();
    for kind in 0..11 {
        let previous = p.observe();
        call(&mut p, "budget_fixture", json!([kind]));
        let before = p.observe();
        accepts("budget_fixture", &previous, &before);
        rejects_mutation(
            "budget_fixture",
            &previous,
            &before,
            "budget_fixture_initialized",
            json!(false),
        );
        assert_eq!(before["budget_fixture_qualified"], kind == 1);
        for _ in 0..2 {
            call(&mut p, "inspect_budget", json!([]));
            let after = p.observe();
            accepts("inspect_budget", &before, &after);
            for f in [
                "exact_active_totals",
                "blocked_excluded",
                "pending_unknown_excluded",
                "target_arithmetic_exact",
                "incomplete_coverage_visible",
                "view_read_only",
                "authority_preserved",
            ] {
                assert_eq!(after[f], true, "kind {kind} {f}: {after}");
                rejects_mutation("inspect_budget", &before, &after, f, json!(false));
            }
            let b = &after["budget"];
            assert_eq!(b["totals_valid"], !matches!(kind, 6 | 8 | 10));
            if !matches!(kind, 6 | 8 | 10) {
                assert_eq!(
                    b["active_seconds"],
                    [0, 100, 99, 0, 0, 100, 0, 51, 0, 80, 0][kind as usize]
                );
            }
            if kind == 2 {
                assert_eq!(b["observed_target"], "above");
            }
            if kind == 7 {
                assert_eq!(b["interval_count"], 51);
                assert_eq!(b["intervals"].as_array().unwrap().len(), 50);
                assert_eq!(b["omitted_intervals"], 1);
            }
            if kind == 8 {
                assert_eq!(b["projects"].as_array().unwrap().len(), 2);
            }
            if b["active_seconds"] == 0 {
                rejects_mutation(
                    "inspect_budget",
                    &before,
                    &after,
                    "ratio_defined",
                    json!(true),
                );
            }
        }
    }
}

#[test]
fn named_qualifications_isolation_extreme_selectors_and_lazy_reset() {
    let _guard = serial();
    let mut p = development_effort::DevelopmentEffort::new();
    let mut other = development_effort::DevelopmentEffort::new();
    let empty = p.observe();
    let start = std::time::Instant::now();
    for _ in 0..152 {
        p.reset();
        assert_eq!(p.observe(), empty);
    }
    eprintln!(
        "152 unused effort reset/observe pairs: {:?}",
        start.elapsed()
    );
    for (name, field) in [
        ("positive_phase_fixture", "eligible"),
        ("threshold_budget_fixture", "budget_fixture_qualified"),
    ] {
        let before = p.observe();
        call(&mut p, name, json!([]));
        let after = p.observe();
        accepts(name, &before, &after);
        rejects_mutation(name, &before, &after, field, json!(false));
    }
    let phase = p.observe();
    call(&mut p, "inspect_budget", json!([]));
    for key in [
        "phase_fixture_initialized",
        "eligible",
        "phase_interval_count",
        "phase_request",
        "phase_model",
    ] {
        assert_eq!(p.observe()[key], phase[key]);
    }
    let budget = p.observe();
    call(&mut p, "switch_phase", json!([]));
    for key in [
        "budget_fixture_initialized",
        "budget_fixture_qualified",
        "budget",
        "exact_active_totals",
    ] {
        assert_eq!(p.observe()[key], budget[key]);
    }
    assert_eq!(other.observe(), empty);
    for (action, modulus) in [("phase_fixture", 12), ("budget_fixture", 11)] {
        for kind in [i64::MIN, i64::MAX] {
            call(&mut p, action, json!([kind]));
            let actual = p.observe();
            call(&mut other, action, json!([kind.rem_euclid(modulus)]));
            for key in if action == "phase_fixture" {
                vec![
                    "eligible",
                    "phase_interval_count",
                    "phase_request",
                    "phase_model",
                    "phase_pending_count",
                ]
            } else {
                vec!["budget_fixture_qualified", "budget_input_intervals"]
            } {
                assert_eq!(actual[key], other.observe()[key]);
            }
        }
        let before = p.observe();
        for args in [
            json!(null),
            json!([]),
            json!([0, 1]),
            json!(["0"]),
            json!([1.5]),
            json!([u64::MAX]),
        ] {
            assert!(p.call(action, &args).unwrap().is_err());
            assert_eq!(p.observe(), before);
        }
    }
    let before = p.observe();
    assert!(p.call("switch_phase", &json!([1])).unwrap().is_err());
    assert!(p.call("unknown", &json!([])).is_none());
    assert_eq!(p.observe(), before);
    p.reset();
    assert_eq!(p.observe(), empty);
    call(&mut p, "switch_phase", json!([]));
    assert_eq!(p.observe()["succeeded"], true);
    p.reset();
    call(&mut p, "inspect_budget", json!([]));
    assert_eq!(p.observe()["budget"]["coverage"], "unknown");
}

#[test]
fn lazy_constructor_reset_and_transport_failure_never_manufacture_refusal() {
    let _guard = serial();
    if let Ok(marker) = std::env::var("EFFORT_BINDING_TEST_CHILD") {
        let mut p = development_effort::DevelopmentEffort::new();
        let empty = p.observe();
        for _ in 0..152 {
            p.reset();
            assert_eq!(p.observe(), empty);
        }
        assert!(!std::path::Path::new(&marker).exists());
        let error = p.call("switch_phase", &json!([])).unwrap().unwrap_err();
        assert!(error.contains("non-JSON"), "{error}");
        assert!(std::path::Path::new(&marker).exists());
        assert_eq!(p.observe()["succeeded"], false);
        assert!(p.observe()["phase_exit"].is_null());
        #[cfg(unix)]
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::TempDir::new().unwrap();
        let marker = dir.path().join("called");
        let cargo = dir.path().join("cargo");
        std::fs::write(
            &cargo,
            format!(
                "#!/bin/sh\nprintf called > '{}'\nprintf broken\nexit 77\n",
                marker.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&cargo, std::fs::Permissions::from_mode(0o700)).unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "lazy_constructor_reset_and_transport_failure_never_manufacture_refusal",
                "--nocapture",
            ])
            .env("EFFORT_BINDING_TEST_CHILD", &marker)
            .env("PATH", dir.path())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[test]
fn replay_observations_do_not_leak_temporary_paths_or_wall_clock() {
    let _guard = serial();
    let mut a = development_effort::DevelopmentEffort::new();
    let mut b = development_effort::DevelopmentEffort::new();
    for kind in [1, 8, 10] {
        for p in [&mut a, &mut b] {
            p.reset();
            call(p, "budget_fixture", json!([kind]));
            call(p, "inspect_budget", json!([]));
        }
        assert_eq!(a.observe(), b.observe(), "budget kind {kind}");
    }
    for p in [&mut a, &mut b] {
        p.reset();
        call(p, "positive_phase_fixture", json!([]));
        call(p, "switch_phase", json!([]));
    }
    assert_eq!(a.observe(), b.observe());
}
