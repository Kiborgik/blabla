use blabla::application::{AppConfig, Application};
use blabla::ir::{Field, Type};
use blabla::report::Call;
use blabla::runtime::AppSession;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

fn session() -> AppSession {
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
        Duration::from_millis(8000),
    );
    AppSession::spawn(&config).unwrap()
}

fn fields() -> Vec<Field> {
    let source = include_str!("../contracts/development-effort.bla");
    let mut fields = blabla::semantics::compile("development-effort.bla", source)
        .unwrap()
        .state;
    fields.push(Field {
        name: "determinable".into(),
        ty: Type::Bool,
    });
    fields.push(Field {
        name: "phase_interval_count".into(),
        ty: Type::Int,
    });
    fields
}

fn call(app: &mut AppSession, action: &str, args: Vec<Value>) {
    let start = Instant::now();
    app.call(&Call {
        action: action.into(),
        args,
    })
    .unwrap();
    eprintln!(
        "effort composed {action}: {} ms",
        start.elapsed().as_millis()
    );
}

#[test]
fn composed_transport_requires_real_positive_refusal_and_two_way_isolation() {
    let mut app = session();
    app.reset().unwrap();
    let initial = app.observe(&fields()).unwrap();
    assert_eq!(initial["phase_fixture_initialized"], false);
    call(&mut app, "positive_phase_fixture", vec![]);
    assert_eq!(app.observe(&fields()).unwrap()["eligible"], true);
    call(&mut app, "switch_phase", vec![]);
    let positive = app.observe(&fields()).unwrap();
    assert_eq!(positive["succeeded"], true);
    assert_eq!(positive["phase_interval_count"], 1);
    assert_eq!(positive["freshness_preserved"], true);
    assert_eq!(positive["determinable"], initial["determinable"]);
    call(&mut app, "report_module_unreported", vec![]);
    let mut after_legacy = app.observe(&fields()).unwrap();
    assert_eq!(after_legacy["determinable"], false);
    after_legacy["determinable"] = positive["determinable"].clone();
    assert_eq!(after_legacy, positive);
    call(&mut app, "threshold_budget_fixture", vec![]);
    assert_eq!(
        app.observe(&fields()).unwrap()["budget_fixture_qualified"],
        true
    );
    call(&mut app, "inspect_budget", vec![]);
    let budget = app.observe(&fields()).unwrap();
    for field in [
        "exact_active_totals",
        "blocked_excluded",
        "pending_unknown_excluded",
        "target_arithmetic_exact",
        "incomplete_coverage_visible",
        "view_read_only",
        "authority_preserved",
    ] {
        assert_eq!(budget[field], true, "{field}");
    }
    assert_eq!(budget["determinable"], false);
    assert_eq!(budget["phase_interval_count"], 1);
    call(&mut app, "phase_fixture", vec![json!(1)]);
    assert_eq!(app.observe(&fields()).unwrap()["eligible"], false);
    call(&mut app, "switch_phase", vec![]);
    let refused = app.observe(&fields()).unwrap();
    assert_eq!(refused["succeeded"], false);
    assert_eq!(refused["records_unchanged"], true);
    assert_eq!(refused["budget_fixture_initialized"], true);
    app.reset().unwrap();
    assert_eq!(app.observe(&fields()).unwrap(), initial);
    app.finish().unwrap();
}

#[test]
fn composed_errors_remain_errors_and_unused_resets_stay_uninitialized() {
    let mut app = session();
    app.reset().unwrap();
    let initial = app.observe(&fields()).unwrap();
    let start = Instant::now();
    for _ in 0..16 {
        app.reset().unwrap();
        assert_eq!(app.observe(&fields()).unwrap(), initial);
    }
    eprintln!(
        "16 composed unused reset/observe pairs: {} ms",
        start.elapsed().as_millis()
    );
    let error = app
        .call(&Call {
            action: "phase_fixture".into(),
            args: vec![json!("invalid")],
        })
        .unwrap_err();
    assert_eq!(error.code, "APP_FAILURE");
    assert!(
        error
            .message
            .contains("fixture requires one signed integer")
    );
    assert_eq!(app.observe(&fields()).unwrap_err().code, "APP_IO");
    let mut other = session();
    other.reset().unwrap();
    assert_eq!(other.observe(&fields()).unwrap(), initial);
    let unknown = other
        .call(&Call {
            action: "unregistered_effort_action".into(),
            args: vec![],
        })
        .unwrap_err();
    assert_eq!(unknown.code, "APP_FAILURE");
    assert!(unknown.message.contains("unknown action"));
}
