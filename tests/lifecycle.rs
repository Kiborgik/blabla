use blabla::application::{AppConfig, Application};
use blabla::ir::{Field, Type};
use blabla::report::Call;
use blabla::report::{RunOptions, RunStatus};
use blabla::runtime::AppSession;
use blabla::semantics::compile;
use blabla::verify::run;
use serde_json::json;
use std::path::Path;
use std::time::Duration;

#[path = "support/process.rs"]
mod process;

fn config(mode: &str) -> AppConfig {
    AppConfig {
        executable: "python".into(),
        args: vec![
            Path::new("tests/fixtures/lifecycle/app.py")
                .canonicalize()
                .unwrap()
                .into_os_string(),
            mode.into(),
        ],
        timeout: Duration::from_secs(1),
        startup: Duration::from_secs(1),
    }
}

const NORMAL: &str = r#"
state count: int
action increment()
when increment { expect "incremented": after.count == before.count + 1 }
always "nonnegative" { count >= 0 }
"#;

const RESTART: &str = r#"
action restart()
when restart { expect "persistence": after.count == before.count }
"#;

#[test]
fn memory_only_passes_normal_operations_but_fails_trusted_restart() {
    let options = RunOptions {
        seed: 0,
        cases: 1,
        steps: 8,
        shrink_budget: 64,
    };
    let config = config("memory");
    let normal = compile("count.bla", NORMAL).unwrap();
    let normal_report = run(&normal, &options, || AppSession::spawn(&config)).unwrap();
    assert_eq!(normal_report.status, RunStatus::Green);
    let contract = compile("count.bla", &format!("{NORMAL}{RESTART}")).unwrap();
    let report = run(&contract, &options, || AppSession::spawn(&config)).unwrap();
    assert_eq!(report.status, RunStatus::Red);
    let failure = report.failure.unwrap();
    assert_eq!(failure.property, "persistence");
    assert_eq!(
        failure
            .sequence
            .iter()
            .map(|call| call.action.as_str())
            .collect::<Vec<_>>(),
        ["increment", "restart"]
    );
}

#[test]
fn persistent_application_survives_trusted_restart() {
    let options = RunOptions {
        seed: 0,
        cases: 1,
        steps: 8,
        shrink_budget: 64,
    };
    let config = config("persistent");
    let contract = compile("count.bla", &format!("{NORMAL}{RESTART}")).unwrap();
    let report = run(&contract, &options, || AppSession::spawn(&config)).unwrap();
    assert_eq!(report.status, RunStatus::Green);
    assert!(
        report.sequences[0]
            .iter()
            .any(|call| call.action == "restart")
    );
}

#[test]
fn restart_preserves_directory_and_reset_replaces_it_with_clean_state() {
    let schema = vec![
        Field {
            name: "count".into(),
            ty: Type::Int,
        },
        Field {
            name: "pid".into(),
            ty: Type::Int,
        },
        Field {
            name: "cwd".into(),
            ty: Type::String,
        },
    ];
    let mut session = AppSession::spawn(&config("persistent")).unwrap();
    session.reset().unwrap();
    session
        .call(&Call {
            action: "increment".into(),
            args: vec![],
        })
        .unwrap();
    let before = session.observe(&schema).unwrap();
    session.restart().unwrap();
    let after = session.observe(&schema).unwrap();
    assert_eq!(after["count"], json!(1));
    assert_eq!(after["cwd"], before["cwd"]);
    assert_ne!(after["pid"], before["pid"]);
    process::assert_process_stopped(before["pid"].as_i64().unwrap());
    session.reset().unwrap();
    let reset = session.observe(&schema).unwrap();
    assert_eq!(reset["count"], json!(0));
    assert_ne!(reset["cwd"], after["cwd"]);
    assert!(!Path::new(before["cwd"].as_str().unwrap()).exists());
    session.finish().unwrap();
    process::assert_process_stopped(reset["pid"].as_i64().unwrap());
    assert!(!Path::new(reset["cwd"].as_str().unwrap()).exists());
}

#[test]
fn restart_and_finish_terminate_owned_descendants() {
    let schema = vec![Field {
        name: "descendant_pid".into(),
        ty: Type::Int,
    }];
    let mut session = AppSession::spawn(&config("descendant")).unwrap();
    session.reset().unwrap();
    let before = session.observe(&schema).unwrap();
    session.restart().unwrap();
    process::assert_process_stopped(before["descendant_pid"].as_i64().unwrap());
    let after = session.observe(&schema).unwrap();
    session.finish().unwrap();
    process::assert_process_stopped(after["descendant_pid"].as_i64().unwrap());
}

#[test]
fn fresh_process_crashes_and_timeouts_remain_runtime_errors() {
    let contract = compile("count.bla", &format!("{NORMAL}{RESTART}")).unwrap();
    let options = RunOptions {
        seed: 0,
        cases: 1,
        steps: 8,
        shrink_budget: 64,
    };
    for (mode, code) in [
        ("crash_on_restart", "APP_CRASH"),
        ("timeout_on_restart", "APP_TIMEOUT"),
    ] {
        let mut config = config(mode);
        config.timeout = Duration::from_millis(200);
        let error = run(&contract, &options, || AppSession::spawn(&config)).unwrap_err();
        match error {
            blabla::report::VerifyError::Application(error) => assert_eq!(error.code, code),
            other => panic!("unexpected result: {other:?}"),
        }
    }
}

#[test]
fn saving_only_on_clean_exit_does_not_pass_forced_restart() {
    let contract = compile("count.bla", &format!("{NORMAL}{RESTART}")).unwrap();
    let options = RunOptions {
        seed: 0,
        cases: 1,
        steps: 8,
        shrink_budget: 64,
    };
    let config = config("save_on_exit");
    let report = run(&contract, &options, || AppSession::spawn(&config)).unwrap();
    assert_eq!(report.status, RunStatus::Red);
    assert_eq!(report.failure.unwrap().property, "persistence");
}

#[test]
fn trusted_restart_without_relevant_state_is_incomplete() {
    let contract = compile("empty-restart.bla", &format!("state count: int\n{RESTART}")).unwrap();
    let config = config("persistent");
    let report = run(
        &contract,
        &RunOptions {
            seed: 0,
            cases: 1,
            steps: 2,
            shrink_budget: 0,
        },
        || AppSession::spawn(&config),
    )
    .unwrap();
    assert_eq!(report.status, RunStatus::Yellow);
    assert!(report.failure.is_none());
    assert_eq!(report.steps_executed, 2);
    assert!(
        report
            .coverage_summary
            .coverage
            .iter()
            .any(|p| p.id.contains("restart") && p.witnesses == 0)
    );
}
