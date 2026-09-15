use blabla::application::{AppConfig, Application};
use blabla::ir::{Field, MAX_INT, Type};
use blabla::report::Call;
use blabla::runtime::{AppSession, project_observation};
use serde_json::json;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

#[path = "support/process.rs"]
mod process;
use process::{assert_process_stopped, process_is_running};

fn field(name: &str, ty: Type) -> Field {
    Field {
        name: name.into(),
        ty,
    }
}

fn python_config(script: &Path, mode: &str, timeout: Duration) -> AppConfig {
    AppConfig {
        executable: PathBuf::from("python"),
        args: vec![OsString::from(script.as_os_str()), OsString::from(mode)],
        timeout,
    }
}

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/protocol/app.py")
}

fn todo_app() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("examples/todo/app.py")
}

fn todo_schema() -> Vec<Field> {
    vec![field(
        "todos",
        Type::List(Box::new(Type::Record(vec![
            field("id", Type::Int),
            field("text", Type::String),
            field("done", Type::Bool),
        ]))),
    )]
}

#[test]
fn projects_declared_fields_recursively_and_ignores_extras() {
    let schema = todo_schema();
    let observed = json!({
        "todos": [{"id": 7, "text": "milk", "done": false, "private": "ignored"}],
        "debug": true
    });

    let projected = project_observation(&observed, &schema).unwrap();

    assert_eq!(
        projected,
        json!({"todos": [{"id": 7, "text": "milk", "done": false}]})
    );
}

#[test]
fn rejects_missing_null_wrong_fractional_and_out_of_range_observations() {
    let cases = [
        (json!({}), vec![field("name", Type::String)]),
        (json!({"name": null}), vec![field("name", Type::String)]),
        (json!({"ready": "yes"}), vec![field("ready", Type::Bool)]),
        (json!({"count": 1.5}), vec![field("count", Type::Int)]),
        (
            json!({"count": MAX_INT + 1}),
            vec![field("count", Type::Int)],
        ),
    ];

    for (value, schema) in cases {
        let error = project_observation(&value, &schema).unwrap_err();
        assert_eq!(error.code, "APP_OBSERVATION");
    }
}

#[test]
fn exchanges_jsonl_with_a_real_process_in_an_isolated_directory() {
    let schema = vec![field("cwd", Type::String), field("calls", Type::Int)];
    let config = python_config(&fixture(), "normal", Duration::from_secs(1));
    let mut first = AppSession::spawn(&config).unwrap();
    let mut second = AppSession::spawn(&config).unwrap();

    first.reset().unwrap();
    second.reset().unwrap();
    first
        .call(&Call {
            action: "increment".into(),
            args: vec![],
        })
        .unwrap();
    let first_state = first.observe(&schema).unwrap();
    let second_state = second.observe(&schema).unwrap();

    assert_eq!(first_state["calls"], 1);
    assert_eq!(second_state["calls"], 0);
    assert_ne!(first_state["cwd"], second_state["cwd"]);
}

#[test]
fn rejects_invalid_timeout_configuration_before_spawning() {
    for timeout in [
        Duration::ZERO,
        Duration::from_secs(5) + Duration::from_nanos(1),
    ] {
        let error = match AppSession::spawn(&python_config(&fixture(), "normal", timeout)) {
            Ok(_) => panic!("invalid timeout started a session"),
            Err(error) => error,
        };
        assert_eq!(error.code, "APP_CONFIG");
    }
}

#[test]
fn reports_process_start_failures() {
    let config = AppConfig {
        executable: PathBuf::from("blabla-executable-that-does-not-exist"),
        args: vec![],
        timeout: Duration::from_secs(1),
    };

    let error = match AppSession::spawn(&config) {
        Ok(_) => panic!("missing executable started a session"),
        Err(error) => error,
    };

    assert_eq!(error.code, "APP_SPAWN");
}

#[test]
fn reports_failed_acknowledgements_separately_from_protocol_errors() {
    let mut session = AppSession::spawn(&python_config(
        &fixture(),
        "failed_ack",
        Duration::from_secs(1),
    ))
    .unwrap();

    let error = session.reset().unwrap_err();

    assert_eq!(error.code, "APP_FAILURE");
    assert_eq!(error.message, "fixture rejected reset");
}

#[test]
fn rejects_unsolicited_preoutput_and_wrong_response_ids() {
    for mode in ["pre_output", "wrong_id"] {
        let mut session =
            AppSession::spawn(&python_config(&fixture(), mode, Duration::from_secs(1))).unwrap();

        let error = session.reset().unwrap_err();

        assert_eq!(error.code, "APP_PROTOCOL", "mode {mode}");
    }
}

#[test]
fn finish_accepts_clean_eof_and_rejects_trailing_frames() {
    let schema = vec![field("cwd", Type::String), field("calls", Type::Int)];
    let mut healthy =
        AppSession::spawn(&python_config(&fixture(), "normal", Duration::from_secs(1))).unwrap();
    healthy.reset().unwrap();
    healthy.observe(&schema).unwrap();
    healthy.finish().unwrap();

    let mut trailing = AppSession::spawn(&python_config(
        &fixture(),
        "trailing",
        Duration::from_secs(1),
    ))
    .unwrap();
    trailing.reset().unwrap();
    trailing.observe(&schema).unwrap();

    let error = trailing.finish().unwrap_err();

    assert_eq!(error.code, "APP_PROTOCOL");
}

#[test]
fn finish_rejects_crash_and_timeout_after_stdin_eof() {
    for (mode, code) in [("crash_on_eof", "APP_CRASH"), ("ignore_eof", "APP_TIMEOUT")] {
        let mut session =
            AppSession::spawn(&python_config(&fixture(), mode, Duration::from_millis(100)))
                .unwrap();
        session.reset().unwrap();

        let error = session.finish().unwrap_err();

        assert_eq!(error.code, code, "mode {mode}");
    }
}

#[test]
fn finish_and_drop_terminate_inheriting_descendants_and_release_threads() {
    let schema = vec![
        field("cwd", Type::String),
        field("calls", Type::Int),
        field("descendant_pid", Type::Int),
    ];
    let config = python_config(&fixture(), "descendant", Duration::from_millis(500));
    let mut finished = AppSession::spawn(&config).unwrap();
    finished.reset().unwrap();
    let state = finished.observe(&schema).unwrap();
    let directory = PathBuf::from(state["cwd"].as_str().unwrap());
    let process_id = state["descendant_pid"].as_i64().unwrap();
    assert!(process_is_running(process_id));

    let started = Instant::now();
    finished.finish().unwrap();

    assert!(started.elapsed() < Duration::from_secs(1));
    assert_process_stopped(process_id);
    assert!(!directory.exists());

    let mut dropped = AppSession::spawn(&config).unwrap();
    dropped.reset().unwrap();
    let state = dropped.observe(&schema).unwrap();
    let directory = PathBuf::from(state["cwd"].as_str().unwrap());
    let process_id = state["descendant_pid"].as_i64().unwrap();
    assert!(process_is_running(process_id));

    drop(dropped);

    assert_process_stopped(process_id);
    assert!(!directory.exists());

    let mut timed_out = AppSession::spawn(&config).unwrap();
    timed_out.reset().unwrap();
    let state = timed_out.observe(&schema).unwrap();
    let directory = PathBuf::from(state["cwd"].as_str().unwrap());
    let process_id = state["descendant_pid"].as_i64().unwrap();
    assert!(process_is_running(process_id));

    let error = timed_out
        .call(&Call {
            action: "hang".into(),
            args: vec![],
        })
        .unwrap_err();

    assert_eq!(error.code, "APP_TIMEOUT");
    assert_process_stopped(process_id);
    assert!(!directory.exists());
}

#[test]
fn rejects_malformed_noise_and_invalid_acknowledgements() {
    for mode in ["malformed", "stdout_noise", "json_noise", "wrong_ack"] {
        let mut session =
            AppSession::spawn(&python_config(&fixture(), mode, Duration::from_secs(1))).unwrap();

        let error = session.reset().unwrap_err();

        assert_eq!(error.code, "APP_PROTOCOL", "mode {mode}");
    }
}

#[test]
fn distinguishes_eof_and_crash_before_response() {
    for (mode, code) in [("eof", "APP_EOF"), ("crash", "APP_CRASH")] {
        let mut session =
            AppSession::spawn(&python_config(&fixture(), mode, Duration::from_secs(1))).unwrap();

        let error = session.reset().unwrap_err();

        assert_eq!(error.code, code, "mode {mode}");
    }
}

#[test]
fn rejects_unterminated_and_oversized_response_lines() {
    for mode in ["unterminated", "oversized"] {
        let mut session =
            AppSession::spawn(&python_config(&fixture(), mode, Duration::from_secs(1))).unwrap();

        let error = session.reset().unwrap_err();

        assert_eq!(error.code, "APP_PROTOCOL", "mode {mode}");
    }
}

#[test]
fn rejects_wrong_observation_types_through_the_session_boundary() {
    let mut session = AppSession::spawn(&python_config(
        &fixture(),
        "wrong_observation",
        Duration::from_secs(1),
    ))
    .unwrap();
    session.reset().unwrap();

    let error = session.observe(&todo_schema()).unwrap_err();

    assert_eq!(error.code, "APP_OBSERVATION");
}

#[test]
fn bounds_read_and_blocking_write_deadlines() {
    let mut read_session = AppSession::spawn(&python_config(
        &fixture(),
        "timeout_read",
        Duration::from_millis(100),
    ))
    .unwrap();
    let read_start = Instant::now();
    let read_error = read_session.reset().unwrap_err();
    assert_eq!(read_error.code, "APP_TIMEOUT");
    assert!(read_start.elapsed() < Duration::from_secs(1));

    let mut write_session = AppSession::spawn(&python_config(
        &fixture(),
        "timeout_write",
        Duration::from_millis(500),
    ))
    .unwrap();
    write_session.reset().unwrap();
    let payload = json!("x".repeat(8 * 1024 * 1024));
    let write_start = Instant::now();
    let write_error = write_session
        .call(&Call {
            action: "large".into(),
            args: vec![payload],
        })
        .unwrap_err();
    assert_eq!(write_error.code, "APP_TIMEOUT");
    assert!(
        write_error.message.contains("writing"),
        "expected a write-phase timeout, got: {}",
        write_error.message
    );
    assert!(write_start.elapsed() < Duration::from_millis(1500));
}

#[test]
fn drop_and_protocol_errors_release_the_isolated_directory() {
    let schema = vec![field("cwd", Type::String), field("calls", Type::Int)];
    let config = python_config(&fixture(), "normal", Duration::from_millis(100));
    let mut session = AppSession::spawn(&config).unwrap();
    session.reset().unwrap();
    let directory = PathBuf::from(session.observe(&schema).unwrap()["cwd"].as_str().unwrap());
    drop(session);
    assert!(!directory.exists());

    let mut session = AppSession::spawn(&config).unwrap();
    session.reset().unwrap();
    let directory = PathBuf::from(session.observe(&schema).unwrap()["cwd"].as_str().unwrap());
    let error = session
        .call(&Call {
            action: "hang".into(),
            args: vec![],
        })
        .unwrap_err();
    assert_eq!(error.code, "APP_TIMEOUT");
    assert!(!directory.exists());
}

#[test]
fn hello_and_todo_examples_exercise_real_application_behavior() {
    let hello = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("examples/hello/app.py");
    let mut hello_session =
        AppSession::spawn(&python_config(&hello, "", Duration::from_secs(1))).unwrap();
    hello_session.reset().unwrap();
    hello_session
        .call(&Call {
            action: "start".into(),
            args: vec![],
        })
        .unwrap();
    assert_eq!(
        hello_session
            .observe(&[field("stdout", Type::String)])
            .unwrap(),
        json!({"stdout": "Hello, world!"})
    );
    hello_session.finish().unwrap();

    let mut todo_session =
        AppSession::spawn(&python_config(&todo_app(), "", Duration::from_secs(1))).unwrap();
    todo_session.reset().unwrap();
    todo_session
        .call(&Call {
            action: "add".into(),
            args: vec![json!("")],
        })
        .unwrap();
    todo_session
        .call(&Call {
            action: "add".into(),
            args: vec![json!("milk")],
        })
        .unwrap();
    todo_session
        .call(&Call {
            action: "add".into(),
            args: vec![json!("milk")],
        })
        .unwrap();
    todo_session
        .call(&Call {
            action: "complete".into(),
            args: vec![json!(999)],
        })
        .unwrap();
    todo_session
        .call(&Call {
            action: "complete".into(),
            args: vec![json!(1)],
        })
        .unwrap();
    todo_session
        .call(&Call {
            action: "remove".into(),
            args: vec![json!(999)],
        })
        .unwrap();
    todo_session
        .call(&Call {
            action: "remove".into(),
            args: vec![json!(2)],
        })
        .unwrap();
    todo_session.restart().unwrap();

    assert_eq!(
        todo_session.observe(&todo_schema()).unwrap(),
        json!({"todos": [{"id": 1, "text": "milk", "done": true}]})
    );
    todo_session.finish().unwrap();
}

#[test]
fn rejects_duplicate_json_keys_instead_of_accepting_a_later_success() {
    for mode in ["duplicate_ok", "duplicate_result"] {
        let mut session =
            AppSession::spawn(&python_config(&fixture(), mode, Duration::from_secs(1))).unwrap();
        let error = session.reset().unwrap_err();
        assert_eq!(error.code, "APP_PROTOCOL");
    }
}
