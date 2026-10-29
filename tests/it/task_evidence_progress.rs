use blabla::project::task;
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tempfile::TempDir;

use crate::support;

const LIMIT: u64 = 64 * 1024 * 1024;

use crate::interpreter;
use interpreter::python;

fn invoke(root: &Path, values: &[&str]) -> Value {
    let output = support::run_in(Some(root), &support::args(values));
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
    invoke(
        temp.path(),
        &[
            "--json",
            "task",
            "open",
            "capture",
            "--role",
            "worker",
            "--statement",
            "capture bytes",
            "--scope",
            "src",
            "--check",
            python(),
            "-c",
            script,
        ],
    );
    invoke(
        temp.path(),
        &["task", "accept", "capture", "--model", "worker", "--json"],
    );
    let view = invoke(
        temp.path(),
        &["task", "show", "capture", "--json", "--verbose"],
    );
    assert!(
        view["evidence_progress"].is_object(),
        "CLI executable does not expose candidate progress: {}",
        env!("CARGO_BIN_EXE_blabla")
    );
    let plain = invoke(temp.path(), &["task", "show", "capture", "--json"]);
    assert!(plain.get("evidence_progress").is_none());
    let binary = Path::new(env!("CARGO_BIN_EXE_blabla"));
    let digest = blabla::project::digest_of(
        binary.parent().unwrap(),
        binary.file_name().unwrap().to_str().unwrap(),
    )
    .unwrap();
    assert_eq!(
        view["task"]["build"],
        format!("{} {digest}", env!("CARGO_PKG_VERSION"))
    );
    temp
}

struct Running {
    child: Child,
    stdout: tempfile::NamedTempFile,
    stderr: tempfile::NamedTempFile,
}

impl Running {
    fn start(root: &Path) -> Self {
        let stdout = tempfile::NamedTempFile::new().unwrap();
        let stderr = tempfile::NamedTempFile::new().unwrap();
        let child = Command::new(env!("CARGO_BIN_EXE_blabla"))
            .current_dir(root)
            .args(["task", "evidence", "capture", "--run", "--json"])
            .stdin(Stdio::null())
            .stdout(stdout.as_file().try_clone().unwrap())
            .stderr(stderr.as_file().try_clone().unwrap())
            .spawn()
            .unwrap();
        Self {
            child,
            stdout,
            stderr,
        }
    }

    fn finish(&mut self, code: i32) -> Value {
        let status = until(|| self.child.try_wait().unwrap());
        assert_eq!(
            status.code(),
            Some(code),
            "{}",
            fs::read_to_string(self.stdout.path()).unwrap()
        );
        serde_json::from_slice(&fs::read(self.stdout.path()).unwrap()).unwrap()
    }

    fn release(&mut self, root: &Path, child: &mut TcpStream) {
        match self.child.try_wait() {
            Ok(None) => {}
            Ok(Some(_)) => self.barrier_failure(root, "wrapper exited before release", None),
            Err(error) => self.barrier_failure(root, "wrapper status unavailable", Some(error)),
        }
        for run in diagnostic_runs(root) {
            let Some(text) = run["progress"]["text"].as_str() else {
                continue;
            };
            let Ok(progress) = serde_json::from_str::<Value>(text) else {
                continue;
            };
            if progress["capture"]["failure"].is_string()
                || matches!(
                    progress["capture"]["phase"].as_str(),
                    Some("complete" | "incomplete")
                )
            {
                self.barrier_failure(root, "capture terminated before release", None);
            }
        }
        if let Err(error) = child.write_all(&[1]) {
            self.barrier_failure(root, "release write failed", Some(error));
        }
    }

    fn barrier_failure(&mut self, root: &Path, reason: &str, error: Option<std::io::Error>) -> ! {
        let status = match self.child.try_wait() {
            Ok(Some(status)) => status
                .code()
                .map(|code| format!("exit:{code}"))
                .unwrap_or_else(|| "signaled".into()),
            Ok(None) => "running".into(),
            Err(_) => "unavailable".into(),
        };
        let report = serde_json::json!({
            "reason": reason,
            "io_error": error.map(|error| serde_json::json!({
                "kind": format!("{:?}", error.kind()),
                "os_code": error.raw_os_error(),
            })),
            "wrapper_status": status,
            "stdout": diagnostic_file(self.stdout.path()),
            "stderr": diagnostic_file(self.stderr.path()),
            "runs": diagnostic_runs(root),
            "limits": {"file_prefix_bytes": 2048, "directory_entries": 8, "runs": 2},
        });
        panic!("evidence barrier failure: {report}");
    }
}

fn diagnostic_file(path: &Path) -> Value {
    let read = || -> std::io::Result<Value> {
        let file = fs::File::open(path)?;
        let length = file.metadata()?.len();
        let mut bytes = Vec::new();
        file.take(2049).read_to_end(&mut bytes)?;
        let truncated = bytes.len() > 2048;
        bytes.truncate(2048);
        Ok(serde_json::json!({
            "bytes": length,
            "truncated": truncated,
            "text": String::from_utf8_lossy(&bytes),
        }))
    };
    read().unwrap_or_else(|error| {
        serde_json::json!({"error": format!("{:?}", error.kind()), "os_code": error.raw_os_error()})
    })
}

fn diagnostic_runs(root: &Path) -> Vec<Value> {
    fs::read_dir(root.join(".blabla/scratch/capture"))
        .into_iter()
        .flatten()
        .take(8)
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("evidence-run-")
        })
        .take(2)
        .map(|entry| {
            let path = entry.path();
            serde_json::json!({
                "progress": diagnostic_file(&path.join("progress.json")),
                "stdout_partial_bytes": fs::metadata(path.join("stdout.partial")).ok().map(|value| value.len()),
                "stderr_partial_bytes": fs::metadata(path.join("stderr.partial")).ok().map(|value| value.len()),
            })
        })
        .collect()
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn until<T>(mut read: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(value) = read() {
            return value;
        }
        assert!(Instant::now() < deadline, "finite barrier timed out");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn barrier() -> TcpListener {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    listener
}

fn connected(listener: &TcpListener) -> TcpStream {
    let mut stream = until(|| listener.accept().ok().map(|(stream, _)| stream));
    stream.set_nonblocking(false).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(20)))
        .unwrap();
    stream
        .set_write_timeout(Some(Duration::from_secs(20)))
        .unwrap();
    let mut byte = [0];
    stream.read_exact(&mut byte).unwrap();
    assert_eq!(byte, [1]);
    stream
}

fn script(listener: &TcpListener, after: &str) -> String {
    format!(
        "import os,socket,threading\ns=socket.create_connection(('127.0.0.1',{}),20);s.settimeout(None)\na=b'\\x00\\xff\\r\\nstdout-no-newline'\nb=b'\\xfe\\x00stderr-no-newline'\nt=threading.Thread(target=lambda:os.write(2,b));t.start();os.write(1,a);t.join()\ns.sendall(b'\\x01');s.recv(1)\n{}",
        listener.local_addr().unwrap().port(),
        after
    )
}

fn snapshots(root: &Path) -> Vec<(PathBuf, Value)> {
    let scratch = root.join(".blabla/scratch/capture");
    fs::read_dir(scratch)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("evidence-run-")
        })
        .filter_map(|entry| {
            let path = entry.path().join("progress.json");
            serde_json::from_slice(&fs::read(&path).ok()?)
                .ok()
                .map(|value| (path, value))
        })
        .collect()
}

#[test]
fn private_binary_progress_precedes_exit_and_preserves_original_receipt() {
    let listener = barrier();
    let temp = fixture(&script(&listener, "raise SystemExit(7)"));
    let before = task::read(temp.path(), "capture").unwrap().unwrap();
    let mut running = Running::start(temp.path());
    let mut child = connected(&listener);
    let (path, observed) = until(|| {
        snapshots(temp.path())
            .into_iter()
            .find(|(_, v)| v["capture"]["stdout_bytes"] == 21 && v["capture"]["stderr_bytes"] == 19)
    });
    assert_eq!(observed["capture"]["phase"], "running");
    assert_eq!(observed["recording"], "pending");
    assert!(
        task::read(temp.path(), "capture")
            .unwrap()
            .unwrap()
            .evidence
            .is_empty()
    );
    let show = invoke(
        temp.path(),
        &["task", "show", "capture", "--json", "--verbose"],
    );
    assert_eq!(show["evidence_progress"]["shown"], 1);
    assert_eq!(
        show["evidence_progress"]["entries"][0]["outcome"],
        "unknown"
    );
    assert_eq!(
        fs::read(path.parent().unwrap().join("stdout.partial")).unwrap(),
        b"\x00\xff\r\nstdout-no-newline"
    );
    invoke(
        temp.path(),
        &["task", "note", "capture", "note while running", "--json"],
    );
    fs::write(temp.path().join("src/input"), b"changed").unwrap();
    child.write_all(&[1]).unwrap();
    running.finish(0);
    let after = task::read(temp.path(), "capture").unwrap().unwrap();
    assert_eq!(after.evidence.len(), 1);
    let receipt = &after.evidence[0];
    assert_eq!(receipt.exit, 7);
    assert_eq!(receipt.acceptance_epoch, Some(before.acceptance_epoch));
    assert_eq!(receipt.identity, task::declared_check(&before));
    assert!(receipt.member_manifest.is_some());
    assert_eq!(
        receipt.inputs["src"],
        task::evidence_inputs(&before, &before.opened_tree)["src"]
    );
    assert_eq!(
        fs::read(temp.path().join(receipt.log.as_ref().unwrap())).unwrap(),
        b"\x00\xff\r\nstdout-no-newline\xfe\x00stderr-no-newline"
    );
    let terminal = snapshots(temp.path()).pop().unwrap().1;
    assert_eq!(terminal["recording"], "recorded");
    assert_eq!(terminal["capture"]["complete"], true);
    assert_eq!(
        terminal["capture"]["child"],
        serde_json::json!({"kind":"exited","code":7})
    );
    assert!(!path.parent().unwrap().join("stdout.partial").exists());
    let rendered = serde_json::to_string(&terminal).unwrap();
    for secret in [
        "stdout-no-newline",
        "stderr-no-newline",
        "socket",
        "note while running",
    ] {
        assert!(!rendered.contains(secret));
    }
}

#[test]
fn simultaneous_runs_have_distinct_artifacts_and_append_both_receipts() {
    let listener = barrier();
    let temp = fixture(&script(&listener, "raise SystemExit(0)"));
    let mut first = Running::start(temp.path());
    let mut second = Running::start(temp.path());
    let mut a = connected(&listener);
    let mut b = connected(&listener);
    until(|| (snapshots(temp.path()).len() == 2).then_some(()));
    assert!(
        task::read(temp.path(), "capture")
            .unwrap()
            .unwrap()
            .evidence
            .is_empty()
    );
    a.write_all(&[1]).unwrap();
    b.write_all(&[1]).unwrap();
    first.finish(0);
    second.finish(0);
    let work = task::read(temp.path(), "capture").unwrap().unwrap();
    assert_eq!(work.evidence.len(), 2);
    assert_ne!(work.evidence[0].log, work.evidence[1].log);
    assert!(
        snapshots(temp.path())
            .iter()
            .all(|(_, value)| value["recording"] == "recorded")
    );
}

#[test]
fn both_pipes_are_drained_concurrently_without_interleaving_final_bytes() {
    let temp = fixture(
        "import os,threading\na=b'A'*1048576;b=b'B'*1048576\nt=threading.Thread(target=lambda:os.write(2,b));t.start();os.write(1,a);t.join()",
    );
    Running::start(temp.path()).finish(0);
    let work = task::read(temp.path(), "capture").unwrap().unwrap();
    let bytes = fs::read(temp.path().join(work.evidence[0].log.as_ref().unwrap())).unwrap();
    assert_eq!(bytes.len(), 2097152);
    assert!(bytes[..1048576].iter().all(|b| *b == b'A'));
    assert!(bytes[1048576..].iter().all(|b| *b == b'B'));
}

#[test]
fn capture_cap_boundary_is_exact_and_overflow_grants_no_evidence() {
    for count in [LIMIT - 1, LIMIT, LIMIT + 1] {
        let temp = fixture(&format!(
            "import os\nn={count}\nwhile n:\n b=b'x'*min(n,65536);n-=os.write(1,b)"
        ));
        Running::start(temp.path()).finish(if count > LIMIT { 2 } else { 0 });
        let work = task::read(temp.path(), "capture").unwrap().unwrap();
        let (path, observed) = snapshots(temp.path()).pop().unwrap();
        if count > LIMIT {
            assert!(work.evidence.is_empty());
            assert_eq!(observed["capture"]["failure"], "output-limit");
            assert_eq!(observed["capture"]["complete"], false);
            assert_eq!(
                fs::metadata(path.parent().unwrap().join("stdout.partial"))
                    .unwrap()
                    .len(),
                LIMIT
            );
        } else {
            assert_eq!(work.evidence.len(), 1);
            assert_eq!(
                fs::metadata(temp.path().join(work.evidence[0].log.as_ref().unwrap()))
                    .unwrap()
                    .len(),
                count
            );
        }
        assert_eq!(observed["capture"]["stdout_bytes"], count.min(LIMIT));
    }
}

#[test]
fn malformed_oversized_and_symlink_progress_is_bounded_diagnostic_only() {
    let temp = fixture("pass");
    Running::start(temp.path()).finish(0);
    let (path, original) = snapshots(temp.path()).pop().unwrap();
    let before = fs::read(temp.path().join(".blabla/tasks/capture.json")).unwrap();
    for bytes in [
        b"{broken".to_vec(),
        vec![b'x'; 16385],
        serde_json::to_vec(&serde_json::json!({"schema":999})).unwrap(),
    ] {
        fs::write(&path, bytes).unwrap();
        let view = invoke(
            temp.path(),
            &["task", "show", "capture", "--json", "--verbose"],
        );
        assert_eq!(view["evidence_progress"]["unavailable"], 1);
        assert_eq!(view["evidence_progress"]["shown"], 0);
    }
    fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();
    #[cfg(unix)]
    {
        fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink("/dev/zero", &path).unwrap();
        let view = invoke(
            temp.path(),
            &["task", "show", "capture", "--json", "--verbose"],
        );
        assert_eq!(view["evidence_progress"]["unavailable"], 1);
    }
    assert_eq!(
        before,
        fs::read(temp.path().join(".blabla/tasks/capture.json")).unwrap()
    );
}

#[cfg(unix)]
#[test]
fn signaled_child_keeps_complete_log_but_has_no_integer_exit_evidence() {
    let temp = fixture(
        "import os,signal\nos.write(1,b'before-signal');os.kill(os.getpid(),signal.SIGTERM)",
    );
    Running::start(temp.path()).finish(2);
    assert!(
        task::read(temp.path(), "capture")
            .unwrap()
            .unwrap()
            .evidence
            .is_empty()
    );
    let (_, observed) = snapshots(temp.path()).pop().unwrap();
    assert_eq!(observed["capture"]["child"]["kind"], "signaled");
    assert_eq!(observed["capture"]["child"]["signal"], libc::SIGTERM);
    assert_eq!(observed["capture"]["complete"], true);
    assert_eq!(observed["recording"], "refused");
}

#[cfg(unix)]
#[test]
fn wrapper_death_preserves_partial_bytes_and_never_invents_a_child_exit() {
    let listener = barrier();
    let temp = fixture(&script(&listener, "raise SystemExit(0)"));
    let mut running = Running::start(temp.path());
    let mut child = connected(&listener);
    let (path, _) = until(|| {
        snapshots(temp.path())
            .into_iter()
            .find(|(_, v)| v["capture"]["stdout_bytes"] == 21)
    });
    running.child.kill().unwrap();
    running.child.wait().unwrap();
    child.write_all(&[1]).unwrap();
    assert_eq!(
        fs::read(path.parent().unwrap().join("stdout.partial")).unwrap(),
        b"\x00\xff\r\nstdout-no-newline"
    );
    let view = invoke(
        temp.path(),
        &["task", "show", "capture", "--json", "--verbose"],
    );
    assert!(view["task"]["evidence"].as_array().unwrap().is_empty());
    assert_eq!(
        view["evidence_progress"]["entries"][0]["outcome"],
        "unknown"
    );
    assert_eq!(
        view["evidence_progress"]["entries"][0]["receipt_observed"],
        false
    );
}

#[test]
fn check_mutation_and_reacceptance_do_not_rebind_the_started_run() {
    for amendment in ["check", "reaccept"] {
        let listener = barrier();
        let temp = fixture(&script(&listener, "raise SystemExit(0)"));
        let before = task::read(temp.path(), "capture").unwrap().unwrap();
        let mut running = Running::start(temp.path());
        let mut child = connected(&listener);
        if amendment == "check" {
            invoke(
                temp.path(),
                &[
                    "--json",
                    "task",
                    "check",
                    "capture",
                    "--check",
                    python(),
                    "-c",
                    "raise SystemExit(9)",
                ],
            );
        } else {
            invoke(
                temp.path(),
                &["task", "accept", "capture", "--model", "worker", "--json"],
            );
        }
        child.write_all(&[1]).unwrap();
        running.finish(0);
        let after = task::read(temp.path(), "capture").unwrap().unwrap();
        assert_eq!(after.evidence.len(), 1);
        assert_eq!(after.evidence[0].identity, task::declared_check(&before));
        assert_eq!(
            after.evidence[0].acceptance_epoch,
            Some(before.acceptance_epoch)
        );
        let tree = blabla::project::snapshot(temp.path(), &Default::default());
        assert_eq!(
            task::readiness(&after, &tree).supported,
            amendment == "reaccept",
            "{amendment}"
        );
    }
}

#[test]
fn quiet_heartbeat_and_exited_parent_with_open_pipes_are_last_observations() {
    let listener = barrier();
    let descendant = format!(
        "import socket,os\ns=socket.create_connection(('127.0.0.1',{}),20);s.settimeout(None);s.sendall(b'\\x01');s.recv(1);os.write(1,b'drained')",
        listener.local_addr().unwrap().port()
    );
    let temp = fixture(&format!(
        "import subprocess,sys\nsubprocess.Popen([sys.executable,'-c',{descendant:?}])"
    ));
    let mut running = Running::start(temp.path());
    let mut child = connected(&listener);
    let (_, first) = until(|| {
        snapshots(temp.path())
            .into_iter()
            .find(|(_, value)| value["capture"]["phase"] == "draining")
    });
    assert_eq!(first["capture"]["child"]["kind"], "exited");
    assert_eq!(first["capture"]["complete"], false);
    until(|| {
        snapshots(temp.path())
            .into_iter()
            .find(|(_, value)| value["observed_unix"].as_u64() > first["observed_unix"].as_u64())
    });
    assert!(
        task::read(temp.path(), "capture")
            .unwrap()
            .unwrap()
            .evidence
            .is_empty()
    );
    child.write_all(&[1]).unwrap();
    running.finish(0);
    let after = task::read(temp.path(), "capture").unwrap().unwrap();
    assert_eq!(
        fs::read(temp.path().join(after.evidence[0].log.as_ref().unwrap())).unwrap(),
        b"drained"
    );
}

#[test]
fn progress_publication_failure_retains_bytes_and_refuses_evidence() {
    let listener = barrier();
    let temp = fixture(&script(&listener, "raise SystemExit(0)"));
    let mut running = Running::start(temp.path());
    let _child = connected(&listener);
    let (path, _) = until(|| {
        snapshots(temp.path())
            .into_iter()
            .find(|(_, v)| v["capture"]["stdout_bytes"] == 21 && v["capture"]["stderr_bytes"] == 19)
    });
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    running.finish(2);
    assert!(
        task::read(temp.path(), "capture")
            .unwrap()
            .unwrap()
            .evidence
            .is_empty()
    );
    assert_eq!(
        fs::read(path.parent().unwrap().join("stdout.partial")).unwrap(),
        b"\x00\xff\r\nstdout-no-newline"
    );
    assert_eq!(
        fs::read(path.parent().unwrap().join("stderr.partial")).unwrap(),
        b"\xfe\x00stderr-no-newline"
    );
}

#[test]
fn final_log_collision_fails_closed_without_replacing_an_existing_file() {
    let listener = barrier();
    let temp = fixture(&script(&listener, "raise SystemExit(0)"));
    let mut running = Running::start(temp.path());
    let mut child = connected(&listener);
    let (_, observed) = until(|| {
        snapshots(temp.path())
            .into_iter()
            .find(|(_, v)| v["capture"]["stdout_bytes"] == 21)
    });
    let log = temp.path().join(format!(
        ".blabla/scratch/capture/evidence-1-{}-{}.log",
        running.child.id(),
        observed["run_id"].as_str().unwrap()
    ));
    fs::write(&log, b"do-not-replace").unwrap();
    running.release(temp.path(), &mut child);
    running.finish(2);
    assert_eq!(fs::read(log).unwrap(), b"do-not-replace");
    assert!(
        task::read(temp.path(), "capture")
            .unwrap()
            .unwrap()
            .evidence
            .is_empty()
    );
    assert_eq!(
        snapshots(temp.path()).pop().unwrap().1["capture"]["failure"],
        "finalize"
    );
}

#[test]
fn bounded_progress_listing_never_promotes_a_diagnostic_receipt() {
    let temp = fixture("pass");
    Running::start(temp.path()).finish(0);
    let (path, mut original) = snapshots(temp.path()).pop().unwrap();
    let before = task::read(temp.path(), "capture").unwrap().unwrap();
    original["recording"] = serde_json::json!("pending");
    fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();
    let view = invoke(
        temp.path(),
        &["task", "show", "capture", "--json", "--verbose"],
    );
    assert_eq!(
        view["evidence_progress"]["entries"][0]["receipt_observed"],
        true
    );
    original["receipt_fingerprint"] = serde_json::json!("0".repeat(64));
    original["recording"] = serde_json::json!("recorded");
    fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();
    let view = invoke(
        temp.path(),
        &["task", "show", "capture", "--json", "--verbose"],
    );
    assert_eq!(
        view["evidence_progress"]["entries"][0]["receipt_observed"],
        false
    );
    for index in 0..30 {
        let id = format!("{index:032x}");
        let dir = path
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join(format!("evidence-run-{id}"));
        fs::create_dir(&dir).unwrap();
        original["run_id"] = serde_json::json!(id);
        fs::write(
            dir.join("progress.json"),
            serde_json::to_vec(&original).unwrap(),
        )
        .unwrap();
    }
    let view = invoke(
        temp.path(),
        &["task", "show", "capture", "--json", "--verbose"],
    );
    assert_eq!(view["evidence_progress"]["total"], 31);
    assert_eq!(view["evidence_progress"]["shown"], 20);
    assert_eq!(view["evidence_progress"]["omitted"], 11);
    assert_eq!(
        serde_json::to_value(
            task::read(temp.path(), "capture")
                .unwrap()
                .unwrap()
                .evidence
        )
        .unwrap(),
        serde_json::to_value(before.evidence).unwrap()
    );
}

#[test]
fn combined_pipe_cap_fails_closed_and_missing_program_has_typed_spawn_failure() {
    let temp = fixture(
        "import os,threading\ndef send(fd,n):\n while n:\n  b=b'x'*min(n,65536);n-=os.write(fd,b)\nt=threading.Thread(target=send,args=(2,33554432));t.start();send(1,33554433);t.join()",
    );
    Running::start(temp.path()).finish(2);
    let (_, observed) = snapshots(temp.path()).pop().unwrap();
    assert_eq!(
        observed["capture"]["stdout_bytes"].as_u64().unwrap()
            + observed["capture"]["stderr_bytes"].as_u64().unwrap(),
        LIMIT
    );
    assert_eq!(observed["capture"]["failure"], "output-limit");
    assert!(
        task::read(temp.path(), "capture")
            .unwrap()
            .unwrap()
            .evidence
            .is_empty()
    );
    invoke(
        temp.path(),
        &[
            "--json",
            "task",
            "check",
            "capture",
            "--check",
            "missing-private-evidence-program",
        ],
    );
    Running::start(temp.path()).finish(2);
    let all = snapshots(temp.path());
    assert!(
        all.iter()
            .any(|(_, value)| value["capture"]["failure"] == "spawn"
                && value["capture"]["child"]["kind"] == "not-spawned")
    );
    assert!(
        all.iter()
            .all(|(_, value)| !value.to_string().contains("missing-private"))
    );
}

#[cfg(unix)]
#[test]
fn private_files_and_directory_symlinks_are_not_followed() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let listener = barrier();
    let temp = fixture(&script(&listener, "raise SystemExit(0)"));
    let mut running = Running::start(temp.path());
    let mut child = connected(&listener);
    let (path, _) = until(|| {
        snapshots(temp.path())
            .into_iter()
            .find(|(_, v)| v["capture"]["stdout_bytes"] == 21)
    });
    let dir = path.parent().unwrap();
    assert_eq!(
        fs::metadata(dir).unwrap().permissions().mode() & 0o777,
        0o700
    );
    for name in ["stdout.partial", "stderr.partial", "progress.json"] {
        assert_eq!(
            fs::metadata(dir.join(name)).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    child.write_all(&[1]).unwrap();
    running.finish(0);
    let outside = TempDir::new().unwrap();
    fs::write(
        outside.path().join("progress.json"),
        fs::read(&path).unwrap(),
    )
    .unwrap();
    fs::remove_dir_all(dir).unwrap();
    symlink(outside.path(), dir).unwrap();
    let view = invoke(
        temp.path(),
        &["task", "show", "capture", "--json", "--verbose"],
    );
    assert_eq!(view["evidence_progress"]["unavailable"], 1);
    let source = temp.path().join(".blabla/scratch/capture");
    fs::remove_dir_all(&source).unwrap();
    symlink(outside.path(), &source).unwrap();
    let view = invoke(
        temp.path(),
        &["task", "show", "capture", "--json", "--verbose"],
    );
    assert_eq!(view["evidence_progress"]["directory_available"], false);
}

#[cfg(unix)]
#[test]
fn scratch_ancestry_replacement_cannot_publish_or_clean_through_redirected_paths() {
    use std::os::unix::fs::symlink;
    for redirect in [true, false] {
        let listener = barrier();
        let temp = fixture(&script(&listener, "raise SystemExit(0)"));
        let outside = TempDir::new().unwrap();
        let mut running = Running::start(temp.path());
        let mut child = connected(&listener);
        let (_, observed) = until(|| {
            snapshots(temp.path())
                .into_iter()
                .find(|(_, v)| v["capture"]["stdout_bytes"] == 21)
        });
        let run_name = format!("evidence-run-{}", observed["run_id"].as_str().unwrap());
        let original = temp.path().join(".blabla/scratch/capture");
        let moved = outside.path().join("moved");
        fs::rename(&original, &moved).unwrap();
        if redirect {
            symlink(&moved, &original).unwrap();
        } else {
            fs::create_dir_all(original.join(&run_name)).unwrap();
            fs::write(
                original.join(&run_name).join("stdout.partial"),
                b"replacement-stdout",
            )
            .unwrap();
            fs::write(
                original.join(&run_name).join("stderr.partial"),
                b"replacement-stderr",
            )
            .unwrap();
        }
        child.write_all(&[1]).unwrap();
        running.finish(2);
        assert!(
            task::read(temp.path(), "capture")
                .unwrap()
                .unwrap()
                .evidence
                .is_empty()
        );
        assert!(!fs::read_dir(&moved).unwrap().flatten().any(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "log")
        }));
        assert_eq!(
            fs::read(moved.join(&run_name).join("stdout.partial")).unwrap(),
            b"\x00\xff\r\nstdout-no-newline"
        );
        if !redirect {
            assert_eq!(
                fs::read(original.join(&run_name).join("stdout.partial")).unwrap(),
                b"replacement-stdout"
            );
            assert_eq!(
                fs::read(original.join(&run_name).join("stderr.partial")).unwrap(),
                b"replacement-stderr"
            );
            assert!(!original.join(&run_name).join("progress.json").exists());
            assert_eq!(fs::read_dir(&original).unwrap().count(), 1);
        }
    }
}
