use blabla::application::{AppConfig, Application};
use blabla::ir::{Field, Type};
use blabla::report::Call;
use blabla::runtime::AppSession;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

fn session() -> AppSession {
    AppSession::spawn(&AppConfig::launched(
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
    ))
    .unwrap()
}

fn fields() -> Vec<Field> {
    let mut fields = blabla::semantics::compile(
        "goal-delivery.bla",
        include_str!("../contracts/goal-delivery.bla"),
    )
    .unwrap()
    .state;
    fields.extend(
        blabla::semantics::compile(
            "development-effort.bla",
            include_str!("../contracts/development-effort.bla"),
        )
        .unwrap()
        .state,
    );
    fields.push(Field {
        name: "determinable".into(),
        ty: Type::Bool,
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
        "delivery composed {action}: {} ms",
        start.elapsed().as_millis()
    );
}

#[test]
fn both_composed_paths_preserve_real_delivery_and_isolation() {
    let output = std::process::Command::new("cargo")
        .args([
            "test",
            "--locked",
            "--test",
            "coverage",
            "goal_delivery_composed_probe",
            "--",
            "--exact",
            "--nocapture",
        ])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(stdout.contains("1 passed"), "{stdout}");

    let mut app = session();
    app.reset().unwrap();
    let initial = app.observe(&fields()).unwrap();
    assert_eq!(initial["delivery_fixture_initialized"], false);
    assert_eq!(initial["phase_fixture_initialized"], false);
    for _ in 0..8 {
        app.reset().unwrap();
        assert_eq!(app.observe(&fields()).unwrap(), initial);
    }
    call(&mut app, "delivery_fixture", vec![json!(1)]);
    assert_eq!(
        app.observe(&fields()).unwrap()["delivery_claim_eligible"],
        true
    );
    call(&mut app, "record_delivery_claim", vec![]);
    let positive = app.observe(&fields()).unwrap();
    assert_eq!(positive["delivery_operation_succeeded"], true);
    assert_eq!(positive["delivery_partial_or_blocked"], true);
    call(&mut app, "threshold_budget_fixture", vec![]);
    call(&mut app, "inspect_budget", vec![]);
    call(&mut app, "report_module_unreported", vec![]);
    let independent = app.observe(&fields()).unwrap();
    assert_eq!(independent["budget_fixture_qualified"], true);
    assert_eq!(independent["determinable"], false);
    for (key, value) in positive.as_object().unwrap() {
        if key.starts_with("delivery_") {
            assert_eq!(&independent[key], value, "{key}");
        }
    }
    call(&mut app, "delivery_fixture", vec![json!(3)]);
    assert_eq!(
        app.observe(&fields()).unwrap()["delivery_claim_eligible"],
        false
    );
    call(&mut app, "record_delivery_claim", vec![]);
    let refused = app.observe(&fields()).unwrap();
    assert_eq!(refused["delivery_operation_succeeded"], false);
    assert_eq!(refused["delivery_records_unchanged"], true);
    for (key, value) in independent.as_object().unwrap() {
        if !key.starts_with("delivery_") {
            assert_eq!(&refused[key], value, "{key}");
        }
    }
    for (kind, bounded) in [(6, false), (7, true)] {
        call(&mut app, "delivery_fixture", vec![json!(kind)]);
        let before = app.observe(&fields()).unwrap();
        let eligibility = if bounded {
            "delivery_bounded_close_eligible"
        } else {
            "delivery_ordinary_close_eligible"
        };
        assert_eq!(before[eligibility], true);
        call(&mut app, "close_delivery_task", vec![json!(bounded)]);
        let closed = app.observe(&fields()).unwrap();
        assert_eq!(closed["delivery_source_closed"], true);
        assert_eq!(closed["delivery_residual_visible"], true);
        assert_eq!(closed["delivery_contract_authority_preserved"], true);
        call(&mut app, "inspect_delivery_reminders", vec![]);
        let inspected = app.observe(&fields()).unwrap();
        assert_eq!(inspected["delivery_residual_visible"], true);
        assert_eq!(inspected["delivery_records_unchanged"], true);
        assert_eq!(inspected["delivery_views_agree"], true);
    }
    app.reset().unwrap();
    assert_eq!(app.observe(&fields()).unwrap(), initial);
    let error = app
        .call(&Call {
            action: "delivery_fixture".into(),
            args: vec![json!("invalid")],
        })
        .unwrap_err();
    assert_eq!(error.code, "APP_FAILURE");
    assert!(
        !error.message.contains("unknown action"),
        "{}",
        error.message
    );
    assert_eq!(app.observe(&fields()).unwrap_err().code, "APP_IO");
    let mut fresh = session();
    fresh.reset().unwrap();
    assert_eq!(fresh.observe(&fields()).unwrap(), initial);
    fresh.finish().unwrap();
}

fn batched_snapshot(app: &mut AppSession) -> Result<Value, blabla::diagnostic::AppError> {
    let state = app.observe(&fields())?;
    let field = |name: &str, ty: Type| Field {
        name: name.into(),
        ty,
    };
    let mut schema = fields();
    schema.push(field("delivery_exit", Type::Optional(Box::new(Type::Int))));
    if state["delivery_fixture_initialized"] == true {
        schema.push(field(
            "delivery_task",
            Type::Record(vec![
                field(
                    "task",
                    Type::Record(vec![
                        field("name", Type::String),
                        field("state", Type::String),
                        field("acceptance_epoch", Type::Int),
                    ]),
                ),
                field(
                    "delivery",
                    Type::Record(vec![
                        field("claims_current", Type::Bool),
                        field(
                            "obligations",
                            Type::List(Box::new(Type::Record(vec![
                                field("goal", Type::String),
                                field("current", Type::Bool),
                                field("claim_digest", Type::Optional(Box::new(Type::String))),
                            ]))),
                        ),
                    ]),
                ),
            ]),
        ));
    }
    if state["delivery_batch_initialized"] == true {
        schema.push(field(
            "delivery_batch_review",
            Type::Record(vec![
                field("review_current", Type::Bool),
                field(
                    "task",
                    Type::Record(vec![
                        field("name", Type::String),
                        field("state", Type::String),
                        field(
                            "delivery_reviews",
                            Type::List(Box::new(Type::Record(vec![
                                field("source_task", Type::String),
                                field("goal", Type::String),
                                field("claim_digest", Type::String),
                                field("verdict", Type::String),
                                field("model", Type::String),
                            ]))),
                        ),
                    ]),
                ),
            ]),
        ));
    }
    app.observe(&schema)
}

#[test]
fn batched_delivery_composed_paths_preserve_explicit_sources_and_errors() {
    let output = std::process::Command::new("cargo")
        .args([
            "test",
            "--locked",
            "--test",
            "coverage",
            "batched_delivery_composed_probe",
            "--",
            "--exact",
            "--nocapture",
        ])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(stdout.contains("1 passed"), "{stdout}");
    assert!(
        stdout.contains("batched_delivery_composed_probe ... ok"),
        "{stdout}"
    );

    std::io::Write::write_all(&mut std::io::stderr(), &output.stdout).unwrap();
    std::io::Write::write_all(&mut std::io::stderr(), &output.stderr).unwrap();

    let mut app = session();
    app.reset().unwrap();
    let initial = batched_snapshot(&mut app).unwrap();
    assert_eq!(initial["delivery_batch_initialized"], false);
    assert_eq!(initial["delivery_fixture_initialized"], false);
    for _ in 0..8 {
        app.reset().unwrap();
        assert_eq!(batched_snapshot(&mut app).unwrap(), initial);
    }
    call(&mut app, "delivery_fixture", vec![json!(1)]);
    let legacy = batched_snapshot(&mut app).unwrap()["delivery_task"].clone();
    call(&mut app, "delivery_batch_fixture", vec![json!(1)]);
    let before = batched_snapshot(&mut app).unwrap();
    assert_eq!(before["delivery_selected_source_assigned"], true);
    assert_eq!(before["delivery_selected_source_current"], true);
    assert_eq!(before["delivery_selected_review_eligible"], true);
    assert_eq!(before["delivery_task"], legacy);
    call(&mut app, "review_explicit_delivery_source", vec![]);
    let reviewed = batched_snapshot(&mut app).unwrap();
    assert_eq!(reviewed["delivery_operation_succeeded"], true);
    assert_eq!(reviewed["delivery_selected_verdict_recorded"], true);
    assert_eq!(reviewed["delivery_other_source_verdicts_preserved"], true);
    assert_eq!(reviewed["delivery_source_records_unchanged"], true);
    assert_eq!(reviewed["delivery_task"], legacy);
    let verdicts = reviewed["delivery_batch_review"]["task"]["delivery_reviews"]
        .as_array()
        .unwrap();
    assert_eq!(verdicts.len(), 2);
    assert!(verdicts.iter().any(|v| v["source_task"] == "work"));
    assert!(verdicts.iter().any(|v| v["source_task"] == "secondary"));
    for (key, value) in initial.as_object().unwrap() {
        if !key.starts_with("delivery_") {
            assert_eq!(&reviewed[key], value, "{key}");
        }
    }
    call(&mut app, "threshold_budget_fixture", vec![]);
    call(&mut app, "inspect_budget", vec![]);
    call(&mut app, "report_module_unreported", vec![]);
    let independent = batched_snapshot(&mut app).unwrap();
    assert_eq!(independent["budget_fixture_qualified"], true);
    assert_eq!(independent["determinable"], false);
    for (key, value) in reviewed.as_object().unwrap() {
        if key.starts_with("delivery_") {
            assert_eq!(&independent[key], value, "{key}");
        }
    }
    call(&mut app, "delivery_batch_fixture", vec![json!(4)]);
    let stale = batched_snapshot(&mut app).unwrap();
    assert_eq!(stale["delivery_batch_review"]["review_current"], true);
    assert_eq!(stale["delivery_selected_source_current"], false);
    call(&mut app, "review_explicit_delivery_source", vec![]);
    let refused = batched_snapshot(&mut app).unwrap();
    assert_eq!(refused["delivery_operation_succeeded"], false);
    assert_eq!(refused["delivery_exit"], 2);
    assert_eq!(refused["delivery_records_unchanged"], true);
    assert_eq!(refused["delivery_other_source_verdicts_preserved"], true);
    assert_eq!(refused["delivery_source_records_unchanged"], true);
    for (key, value) in independent.as_object().unwrap() {
        if !key.starts_with("delivery_") {
            assert_eq!(&refused[key], value, "{key}");
        }
    }
    let batch = refused["delivery_batch_review"].clone();
    call(&mut app, "record_delivery_claim", vec![]);
    assert_eq!(
        batched_snapshot(&mut app).unwrap()["delivery_operation_succeeded"],
        true
    );
    assert_eq!(
        batched_snapshot(&mut app).unwrap()["delivery_batch_review"],
        batch
    );
    app.reset().unwrap();
    assert_eq!(batched_snapshot(&mut app).unwrap(), initial);
    let error = app
        .call(&Call {
            action: "delivery_batch_fixture".into(),
            args: vec![json!("invalid")],
        })
        .unwrap_err();
    assert_eq!(error.code, "APP_FAILURE");
    assert!(!error.message.contains("unknown action"));
    assert_eq!(batched_snapshot(&mut app).unwrap_err().code, "APP_IO");
    let mut fresh = session();
    fresh.reset().unwrap();
    assert_eq!(batched_snapshot(&mut fresh).unwrap(), initial);
    fresh.finish().unwrap();
}
