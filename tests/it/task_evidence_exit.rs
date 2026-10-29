use blabla::project::task;
use blabla::project::task::machine::TaskState;
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::process::Output;
use tempfile::TempDir;

use crate::support;

use crate::interpreter;
use interpreter::python;

fn cli(root: &Path, values: &[&str]) -> Output {
    support::run_in(Some(root), &support::args(values))
}

fn successful(root: &Path, values: &[&str]) -> Value {
    let output = cli(root, values);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn fixture(script: &str) -> TempDir {
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join("src")).unwrap();
    fs::write(temp.path().join("src/input"), b"original").unwrap();
    fs::write(
        temp.path().join("project.bla"),
        "project Test\nprocess \"process.bla\"\n",
    )
    .unwrap();
    fs::write(temp.path().join("process.bla"), "role \"orchestrator\" { purpose \"assign\" model \"owner\" }\nrole \"worker\" { purpose \"build\" model \"worker\" }\n").unwrap();
    successful(
        temp.path(),
        &[
            "--json",
            "task",
            "open",
            "capture",
            "--role",
            "worker",
            "--statement",
            "record check before exit policy",
            "--scope",
            "src",
            "--check",
            python(),
            "-c",
            script,
        ],
    );
    successful(
        temp.path(),
        &["--json", "task", "accept", "capture", "--model", "worker"],
    );
    temp
}

fn record(root: &Path) -> task::Task {
    task::read(root, "capture").unwrap().unwrap()
}

fn progress(root: &Path) -> Value {
    let runs: Vec<_> = fs::read_dir(root.join(".blabla/scratch/capture"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("evidence-run-")
        })
        .collect();
    assert_eq!(runs.len(), 1);
    serde_json::from_slice(&fs::read(runs[0].join("progress.json")).unwrap()).unwrap()
}

fn completed_log(root: &Path) -> Vec<u8> {
    let logs: Vec<_> = fs::read_dir(root.join(".blabla/scratch/capture"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "log"))
        .collect();
    assert_eq!(logs.len(), 1);
    fs::read(&logs[0]).unwrap()
}

#[test]
fn opt_in_failed_check_persists_exact_evidence_before_returning_failure() {
    let temp = fixture(
        "import os\nfrom pathlib import Path\nos.write(1,b'\\x00\\xffstdout\\n');os.write(2,b'stderr\\n')\nPath('.blabla/launches').open('a').write('1')\nPath('src/input').write_text('changed by child')\nraise SystemExit(7)",
    );
    let before = record(temp.path());
    let output = cli(
        temp.path(),
        &[
            "--json",
            "task",
            "evidence",
            "capture",
            "--run",
            "--fail-on-check",
        ],
    );
    let shown: Value = serde_json::from_slice(&output.stdout).unwrap();
    let after = record(temp.path());
    assert_eq!(after.evidence.len(), 1, "{shown}");
    let evidence = &after.evidence[0];
    assert_eq!(evidence.exit, 7);
    assert_eq!(evidence.identity, task::declared_check(&before));
    assert_eq!(evidence.command, before.check);
    assert_eq!(evidence.acceptance_epoch, Some(before.acceptance_epoch));
    assert_eq!(
        evidence.inputs["src"],
        task::evidence_inputs(&before, &before.opened_tree)["src"]
    );
    assert!(evidence.member_manifest.is_some());
    assert_eq!(
        fs::read(temp.path().join(evidence.log.as_ref().unwrap())).unwrap(),
        b"\x00\xffstdout\nstderr\n"
    );
    assert_eq!(shown["task"]["evidence"][0]["exit"], 7);
    assert_eq!(after.state, TaskState::Accepted);
    assert_eq!(
        fs::read_to_string(temp.path().join(".blabla/launches")).unwrap(),
        "1"
    );
    let observed = progress(temp.path());
    assert_eq!(observed["recording"], "recorded");
    assert_eq!(observed["capture"]["complete"], true);
    assert_eq!(
        observed["capture"]["child"],
        serde_json::json!({"kind":"exited","code":7})
    );
    assert_eq!(output.status.code(), Some(1));
}

#[test]
fn opt_in_success_keeps_success_status_and_plain_receipt() {
    let temp = fixture("import os\nos.write(1,b'passed\\n')");
    let output = cli(
        temp.path(),
        &["task", "evidence", "capture", "--run", "--fail-on-check"],
    );
    assert_eq!(output.status.code(), Some(0));
    let after = record(temp.path());
    assert_eq!(after.evidence.len(), 1);
    assert_eq!(after.evidence[0].exit, 0);
    assert_eq!(after.state, TaskState::Accepted);
    assert_eq!(completed_log(temp.path()), b"passed\n");
    assert_eq!(progress(temp.path())["recording"], "recorded");
}

#[test]
fn default_failed_check_keeps_successful_storage_status() {
    let temp = fixture("import os\nos.write(1,b'failed\\n');raise SystemExit(7)");
    let output = cli(temp.path(), &["task", "evidence", "capture", "--run"]);
    assert_eq!(output.status.code(), Some(0));
    let after = record(temp.path());
    assert_eq!(after.evidence.len(), 1);
    assert_eq!(after.evidence[0].exit, 7);
    assert_eq!(completed_log(temp.path()), b"failed\n");
    assert_eq!(progress(temp.path())["recording"], "recorded");
}

#[test]
fn opt_in_numeric_refusal_and_timeout_values_remain_exact_child_evidence() {
    for exit in [2, 4, 124, 125] {
        let temp = fixture(&format!(
            "import os\nos.write(1,b'numeric {exit}\\n');raise SystemExit({exit})"
        ));
        let output = cli(
            temp.path(),
            &["task", "evidence", "capture", "--run", "--fail-on-check"],
        );
        assert_eq!(output.status.code(), Some(1), "child {exit}");
        let after = record(temp.path());
        assert_eq!(after.evidence.len(), 1);
        assert_eq!(after.evidence[0].exit, exit);
        assert_eq!(
            completed_log(temp.path()),
            format!("numeric {exit}\n").as_bytes()
        );
        let observed = progress(temp.path());
        assert_eq!(observed["recording"], "recorded");
        assert_eq!(
            observed["capture"]["child"],
            serde_json::json!({"kind":"exited","code":exit})
        );
    }
}

#[test]
fn fail_on_check_requires_run_and_refuses_manual_evidence_without_launching() {
    let temp = fixture("from pathlib import Path\nPath('.blabla/launched').write_text('bad')");
    let before = fs::read(temp.path().join(".blabla/tasks/capture.json")).unwrap();
    for values in [
        vec!["task", "evidence", "capture", "--fail-on-check"],
        vec![
            "task",
            "evidence",
            "capture",
            "--fail-on-check",
            "--exit",
            "7",
            "--tool",
            "manual",
        ],
        vec![
            "task",
            "evidence",
            "capture",
            "--fail-on-check",
            "--run",
            "--exit",
            "7",
            "--tool",
            "manual",
        ],
    ] {
        assert_eq!(cli(temp.path(), &values).status.code(), Some(2));
        assert_eq!(
            fs::read(temp.path().join(".blabla/tasks/capture.json")).unwrap(),
            before
        );
    }
    assert!(!temp.path().join(".blabla/launched").exists());
    assert!(!temp.path().join(".blabla/scratch/capture").exists());
}

#[test]
fn opt_in_revalidates_task_authority_before_recording_failed_child() {
    let binary = serde_json::to_string(env!("CARGO_BIN_EXE_blabla")).unwrap();
    let script = format!(
        "import subprocess\nsubprocess.run([{binary},'task','block','capture','changed during check'],check=True)\nprint('child failed')\nraise SystemExit(7)"
    );
    let temp = fixture(&script);
    let output = cli(
        temp.path(),
        &[
            "--json",
            "task",
            "evidence",
            "capture",
            "--run",
            "--fail-on-check",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    let after = record(temp.path());
    assert_eq!(after.state, TaskState::Blocked);
    assert!(after.evidence.is_empty());
    assert!(
        String::from_utf8(completed_log(temp.path()))
            .unwrap()
            .contains("child failed")
    );
    let observed = progress(temp.path());
    assert_eq!(observed["recording"], "refused");
    assert_eq!(observed["capture"]["complete"], true);
    assert_eq!(
        observed["capture"]["child"],
        serde_json::json!({"kind":"exited","code":7})
    );
}

#[test]
fn opt_in_store_refusal_is_not_reported_as_recorded_check_failure() {
    let temp = fixture(
        "import os\nfrom pathlib import Path\nPath(f'.blabla/tasks/.capture-{os.getppid()}-0.tmp').mkdir()\nos.write(1,b'store refused\\n')\nraise SystemExit(7)",
    );
    let before = fs::read(temp.path().join(".blabla/tasks/capture.json")).unwrap();
    let output = cli(
        temp.path(),
        &[
            "--json",
            "task",
            "evidence",
            "capture",
            "--run",
            "--fail-on-check",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(
        fs::read(temp.path().join(".blabla/tasks/capture.json")).unwrap(),
        before
    );
    assert!(record(temp.path()).evidence.is_empty());
    assert_eq!(completed_log(temp.path()), b"store refused\n");
    let observed = progress(temp.path());
    assert_eq!(observed["recording"], "failed");
    assert_eq!(observed["capture"]["complete"], true);
    assert_eq!(
        observed["capture"]["child"],
        serde_json::json!({"kind":"exited","code":7})
    );
}

fn supported(root: &Path) -> bool {
    let tree = blabla::project::snapshot(root, &Default::default());
    task::readiness(&record(root), &tree).supported
}

fn shown_evidence(root: &Path) -> Vec<Value> {
    successful(root, &["--json", "task", "show", "capture"])["task"]["evidence"]
        .as_array()
        .unwrap()
        .clone()
}

fn reaccept(root: &Path) {
    successful(
        root,
        &["--json", "task", "accept", "capture", "--model", "worker"],
    );
}

#[test]
fn executed_evidence_stays_current_across_reacceptance_until_an_input_changes() {
    let temp = fixture("pass");
    successful(
        temp.path(),
        &["--json", "task", "evidence", "capture", "--run"],
    );
    assert!(supported(temp.path()));
    reaccept(temp.path());
    assert_eq!(record(temp.path()).acceptance_epoch, 2);
    assert!(supported(temp.path()));
    assert_eq!(shown_evidence(temp.path())[0]["executed"], true);
    fs::write(temp.path().join("src/input"), b"changed").unwrap();
    assert!(!supported(temp.path()));
}

#[test]
fn a_claimed_exit_is_shown_as_claimed_and_stays_bound_to_its_acceptance() {
    let temp = fixture("pass");
    successful(
        temp.path(),
        &[
            "--json", "task", "evidence", "capture", "--exit", "0", "--tool", "manual",
        ],
    );
    assert_eq!(shown_evidence(temp.path())[0]["executed"], false);
    assert!(supported(temp.path()));
    reaccept(temp.path());
    assert!(!supported(temp.path()));
}

#[test]
fn a_later_claim_keeps_an_earlier_execution_from_surviving_reacceptance() {
    let temp = fixture("pass");
    successful(
        temp.path(),
        &["--json", "task", "evidence", "capture", "--run"],
    );
    successful(
        temp.path(),
        &[
            "--json", "task", "evidence", "capture", "--exit", "1", "--tool", "manual",
        ],
    );
    reaccept(temp.path());
    assert!(!supported(temp.path()));
    let shown = shown_evidence(temp.path());
    assert_eq!(shown[0]["executed"], true);
    assert_eq!(shown[1]["executed"], false);
}

#[cfg(unix)]
#[test]
fn opt_in_direct_signal_keeps_typed_observation_without_numeric_evidence() {
    let temp = fixture(
        "import os,signal\nos.write(1,b'before signal\\n')\nos.kill(os.getpid(),signal.SIGTERM)",
    );
    let before = fs::read(temp.path().join(".blabla/tasks/capture.json")).unwrap();
    let output = cli(
        temp.path(),
        &[
            "--json",
            "task",
            "evidence",
            "capture",
            "--run",
            "--fail-on-check",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(
        fs::read(temp.path().join(".blabla/tasks/capture.json")).unwrap(),
        before
    );
    assert!(record(temp.path()).evidence.is_empty());
    assert_eq!(completed_log(temp.path()), b"before signal\n");
    let observed = progress(temp.path());
    assert_eq!(observed["recording"], "refused");
    assert_eq!(observed["capture"]["complete"], true);
    assert_eq!(
        observed["capture"]["child"],
        serde_json::json!({"kind":"signaled","signal":libc::SIGTERM})
    );
}

#[cfg(target_os = "linux")]
#[test]
fn opt_in_output_failure_takes_precedence_after_recording() {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    for json in [false, true] {
        let temp = fixture("print('record before output');raise SystemExit(7)");
        let mut command = Command::new(env!("CARGO_BIN_EXE_blabla"));
        command.current_dir(temp.path()).args([
            "task",
            "evidence",
            "capture",
            "--run",
            "--fail-on-check",
        ]);
        if json {
            command.arg("--json");
        }
        let mut child = command
            .stdin(Stdio::null())
            .stdout(
                fs::OpenOptions::new()
                    .write(true)
                    .open("/dev/full")
                    .unwrap(),
            )
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if Instant::now() >= deadline {
                child.kill().unwrap();
                child.wait().unwrap();
                panic!("output-failure CLI exceeded deadline");
            }
            std::thread::sleep(Duration::from_millis(5));
        };
        assert_eq!(status.code(), Some(4), "json={json}");
        let after = record(temp.path());
        assert_eq!(after.evidence.len(), 1);
        assert_eq!(after.evidence[0].exit, 7);
        assert_eq!(completed_log(temp.path()), b"record before output\n");
        assert_eq!(progress(temp.path())["recording"], "recorded");
    }
}
