use blabla::runtime::command::{self, CompletionKind, ProducerState};
use std::process::Command;
use std::time::{Duration, Instant};

use crate::python_script;
use python_script::python;

#[test]
fn opt_in_retains_original_output_and_typed_success_observations() {
    let script =
        "import sys; print('private stdout'); print('private stderr',file=sys.stderr); sys.exit(7)";
    let plain = command::run(
        &mut python(script),
        Instant::now() + Duration::from_secs(2),
        1024,
    )
    .unwrap();
    let (result, diagnostics) = command::run_with_diagnostics(
        &mut python(script),
        Instant::now() + Duration::from_secs(2),
        1024,
    );
    let observed = result.unwrap();
    assert_eq!(plain.status.code(), observed.status.code());
    assert_eq!(plain.stdout, observed.stdout);
    assert_eq!(plain.stderr, observed.stderr);
    assert_eq!(
        diagnostics.completions.map(|event| event.kind),
        [
            CompletionKind::ExitWaiter,
            CompletionKind::StdoutReader,
            CompletionKind::StderrReader,
        ]
    );
    for event in diagnostics.completions {
        let ProducerState::Observed { after, succeeded } = event.producer else {
            panic!("{event:?}");
        };
        assert!(succeeded);
        assert!(after <= event.received_after.unwrap());
        assert!(event.received_after.unwrap() <= diagnostics.snapshot_after);
    }
    assert!(diagnostics.snapshot_after <= diagnostics.elapsed);
    assert!(diagnostics.remaining <= diagnostics.budget_at_entry);
    assert_eq!(diagnostics.stages.iter().flatten().count(), 8);
    let rendered = format!("{diagnostics:?}");
    assert!(rendered.len() < 4096);
    for secret in ["private stdout", "private stderr", script, "python"] {
        assert!(!rendered.contains(secret));
    }
}

#[test]
fn output_failure_records_typed_failure_without_payload() {
    let (result, diagnostics) = command::run_with_diagnostics(
        &mut python(
            "import sys,time; sys.stdout.write('private'*10000); sys.stdout.flush(); time.sleep(5)",
        ),
        Instant::now() + Duration::from_secs(2),
        1024,
    );
    assert!(result.is_err());
    let stdout = diagnostics.completions[1];
    assert_eq!(stdout.kind, CompletionKind::StdoutReader);
    assert!(matches!(
        stdout.producer,
        ProducerState::Observed {
            succeeded: false,
            ..
        }
    ));
    assert!(stdout.received_after.is_some());
    assert!(
        diagnostics
            .stages
            .iter()
            .flatten()
            .any(|stage| stage.stage == "cleanup")
    );
    assert!(!format!("{diagnostics:?}").contains("private"));
}

#[test]
fn timeout_snapshot_is_before_cleanup_and_retains_pending_observations() {
    let directory = tempfile::TempDir::new().unwrap();
    let marker = directory.path().join("late-child");
    let descendant = format!(
        "import time; from pathlib import Path; time.sleep(0.8); Path({:?}).write_text('escaped')",
        marker.to_string_lossy()
    );
    let script = format!(
        "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',{descendant:?}]); time.sleep(5)"
    );
    let started = Instant::now();
    let (result, diagnostics) = command::run_with_diagnostics(
        &mut python(&script),
        started + Duration::from_millis(500),
        1024,
    );
    assert!(result.is_err());
    assert!(started.elapsed() < Duration::from_secs(2));
    std::thread::sleep(Duration::from_millis(600));
    assert!(!marker.exists());
    assert!(diagnostics.remaining.is_zero());
    assert!(diagnostics.snapshot_after <= diagnostics.elapsed);
    assert!(diagnostics.completions.iter().any(|event| {
        event.producer == ProducerState::Pending && event.received_after.is_none()
    }));
    assert!(
        diagnostics
            .completions
            .iter()
            .all(|event| event.received_after.is_none())
    );
    assert!(
        diagnostics
            .stages
            .iter()
            .flatten()
            .any(|stage| stage.stage == "cleanup")
    );
}

#[test]
fn expired_deadline_records_no_producers_and_does_not_launch() {
    let directory = tempfile::TempDir::new().unwrap();
    let marker = directory.path().join("must-not-run");
    let script = format!(
        "from pathlib import Path; Path({:?}).write_text('ran')",
        marker.to_string_lossy()
    );
    let deadline = Instant::now();
    let plain = command::run(&mut python(&script), deadline, 1024).unwrap_err();
    let (result, diagnostics) = command::run_with_diagnostics(&mut python(&script), deadline, 1024);
    assert_eq!(result.unwrap_err(), plain);
    assert!(!marker.exists());
    assert!(diagnostics.budget_at_entry.is_zero());
    assert!(diagnostics.remaining.is_zero());
    assert!(diagnostics.stages.iter().all(Option::is_none));
    assert!(diagnostics.completions.iter().all(|event| {
        event.producer == ProducerState::NotStarted && event.received_after.is_none()
    }));
}

#[test]
fn spawn_failure_records_only_the_attempted_stage() {
    let missing = tempfile::TempDir::new()
        .unwrap()
        .path()
        .join("missing-private-program");
    let (result, diagnostics) = command::run_with_diagnostics(
        &mut Command::new(missing),
        Instant::now() + Duration::from_secs(2),
        1024,
    );
    assert!(result.is_err());
    assert_eq!(diagnostics.stages.iter().flatten().count(), 1);
    assert_eq!(diagnostics.stages[0].unwrap().stage, "spawn");
    assert!(
        diagnostics
            .completions
            .iter()
            .all(|event| event.producer == ProducerState::NotStarted)
    );
    assert!(!format!("{diagnostics:?}").contains("missing-private-program"));
}
