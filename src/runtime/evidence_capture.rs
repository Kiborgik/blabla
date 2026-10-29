use super::process_tree::{self, ProcessTree};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{self, Read, Write};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

pub const OUTPUT_LIMIT: usize = 64 * 1024 * 1024;
const CLEANUP_GRACE: Duration = Duration::from_millis(250);
const POLL: Duration = Duration::from_millis(25);

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Preparing,
    Running,
    Draining,
    Complete,
    Incomplete,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ChildObservation {
    NotSpawned,
    Running,
    Exited { code: i32 },
    Signaled { signal: i32 },
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Failure {
    Spawn,
    Setup,
    Read,
    Write,
    Sync,
    OutputLimit,
    Wait,
    Progress,
    Finalize,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Cleanup {
    NotRequested,
    Attempted,
    Complete,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub phase: Phase,
    pub child: ChildObservation,
    pub stdout_bytes: u64,
    pub stderr_bytes: u64,
    pub stdout_eof: bool,
    pub stderr_eof: bool,
    pub complete: bool,
    pub failure: Option<Failure>,
    pub cancellation_requested: bool,
    pub cleanup: Cleanup,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            phase: Phase::Preparing,
            child: ChildObservation::NotSpawned,
            stdout_bytes: 0,
            stderr_bytes: 0,
            stdout_eof: false,
            stderr_eof: false,
            complete: false,
            failure: None,
            cancellation_requested: false,
            cleanup: Cleanup::NotRequested,
        }
    }
}

impl Snapshot {
    pub fn fail(&mut self, failure: Failure) {
        self.failure.get_or_insert(failure);
        self.phase = Phase::Incomplete;
        self.complete = false;
    }
}

struct OwnedChild {
    child: Option<Child>,
    tree: Option<ProcessTree>,
    armed: bool,
}

impl OwnedChild {
    fn terminate(&mut self) {
        if let Some(tree) = &mut self.tree {
            tree.terminate();
        }
        if let Some(child) = &mut self.child {
            let _ = child.kill();
        }
    }

    fn observe(&mut self, snapshot: &mut Snapshot) {
        if matches!(
            snapshot.child,
            ChildObservation::Running | ChildObservation::Unknown
        ) {
            match self.child.as_mut().unwrap().try_wait() {
                Ok(Some(status)) => snapshot.child = child_observation(status),
                Ok(None) => {}
                Err(_) => {
                    snapshot.child = ChildObservation::Unknown;
                    snapshot.fail(Failure::Wait);
                }
            }
        }
    }

    fn released(&self, snapshot: &Snapshot) -> bool {
        if !matches!(
            snapshot.child,
            ChildObservation::Exited { .. } | ChildObservation::Signaled { .. }
        ) {
            return false;
        }
        if let Some(tree) = &self.tree {
            tree.reap_descendants();
            tree.is_empty().unwrap_or(false)
        } else {
            true
        }
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        self.terminate();
        let child = self.child.take();
        let tree = self.tree.take();
        let _ = std::thread::Builder::new()
            .name("blabla-evidence-reap".into())
            .spawn(move || {
                if let Some(mut child) = child {
                    let _ = child.wait();
                }
                if let Some(tree) = tree {
                    tree.reap_descendants();
                }
            });
    }
}

fn child_observation(status: ExitStatus) -> ChildObservation {
    if let Some(code) = status.code() {
        return ChildObservation::Exited { code };
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return ChildObservation::Signaled { signal };
        }
    }
    ChildObservation::Unknown
}

struct Shared {
    remaining: AtomicUsize,
    bytes: [AtomicU64; 2],
    eof: [AtomicBool; 2],
    stop: AtomicBool,
}

impl Shared {
    fn snapshot(&self, snapshot: &mut Snapshot) {
        snapshot.stdout_bytes = self.bytes[0].load(Ordering::Acquire);
        snapshot.stderr_bytes = self.bytes[1].load(Ordering::Acquire);
        snapshot.stdout_eof = self.eof[0].load(Ordering::Acquire);
        snapshot.stderr_eof = self.eof[1].load(Ordering::Acquire);
    }
}

fn copy_stream(
    mut stream: impl Read,
    mut file: impl Write,
    shared: &Shared,
    index: usize,
) -> Result<(), Failure> {
    let mut buffer = [0; 64 * 1024];
    loop {
        if shared.stop.load(Ordering::Acquire) {
            return Ok(());
        }
        let count = match stream.read(&mut buffer) {
            Ok(count) => count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(Failure::Read),
        };
        if count == 0 {
            shared.eof[index].store(true, Ordering::Release);
            return Ok(());
        }
        let available = shared
            .remaining
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |left| {
                Some(left.saturating_sub(count))
            })
            .unwrap();
        let captured = count.min(available);
        let mut written = 0;
        while written < captured {
            match file.write(&buffer[written..captured]) {
                Ok(0) => return Err(Failure::Write),
                Ok(count) => {
                    written += count;
                    shared.bytes[index].fetch_add(count as u64, Ordering::Release);
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(_) => return Err(Failure::Write),
            }
        }
        if captured < count {
            return Err(Failure::OutputLimit);
        }
    }
}

pub fn run(
    command: &mut Command,
    stdout: File,
    stderr: File,
    mut publish: impl FnMut(&Snapshot) -> io::Result<()>,
) -> Snapshot {
    let mut snapshot = Snapshot::default();
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    process_tree::configure(command);
    let child = match command.spawn() {
        Ok(child) => child,
        Err(_) => {
            snapshot.fail(Failure::Spawn);
            let _ = publish(&snapshot);
            return snapshot;
        }
    };
    let mut owned = OwnedChild {
        child: Some(child),
        tree: None,
        armed: true,
    };
    snapshot.child = ChildObservation::Running;
    let shared = Arc::new(Shared {
        remaining: AtomicUsize::new(OUTPUT_LIMIT),
        bytes: std::array::from_fn(|_| AtomicU64::new(0)),
        eof: std::array::from_fn(|_| AtomicBool::new(false)),
        stop: AtomicBool::new(false),
    });
    let (send, receive) = mpsc::channel();
    let mut readers = Vec::with_capacity(2);
    let setup = (|| {
        owned.tree =
            Some(ProcessTree::attach(owned.child.as_mut().unwrap()).map_err(|_| Failure::Setup)?);
        let child = owned.child.as_mut().unwrap();
        let streams: [Box<dyn Read + Send>; 2] = [
            Box::new(child.stdout.take().ok_or(Failure::Setup)?),
            Box::new(child.stderr.take().ok_or(Failure::Setup)?),
        ];
        for (index, (stream, mut file)) in streams.into_iter().zip([stdout, stderr]).enumerate() {
            let shared = shared.clone();
            let send = send.clone();
            let reader = std::thread::Builder::new()
                .name("blabla-evidence-output".into())
                .spawn(move || {
                    let result = copy_stream(stream, &mut file, &shared, index)
                        .and_then(|()| file.sync_all().map_err(|_| Failure::Sync));
                    if result.is_err() {
                        shared.stop.store(true, Ordering::Release);
                    }
                    let _ = send.send(result);
                })
                .map_err(|_| Failure::Setup)?;
            readers.push(reader);
        }
        Ok::<(), Failure>(())
    })();
    drop(send);
    if let Err(failure) = setup {
        snapshot.fail(failure);
    } else {
        snapshot.phase = Phase::Running;
    }
    if publish(&snapshot).is_err() {
        snapshot.fail(Failure::Progress);
    }
    let mut pending = readers.len();
    let mut published = Instant::now();
    let mut cleanup_deadline = None;
    let mut idle = Duration::from_millis(1);
    loop {
        let previous_child = snapshot.child;
        owned.observe(&mut snapshot);
        shared.snapshot(&mut snapshot);
        if snapshot.failure.is_none()
            && pending == 0
            && !matches!(
                snapshot.child,
                ChildObservation::Running | ChildObservation::NotSpawned
            )
        {
            snapshot.complete = snapshot.stdout_eof && snapshot.stderr_eof;
            if snapshot.complete {
                snapshot.phase = Phase::Complete;
                owned.armed = false;
            } else {
                snapshot.fail(Failure::Read);
            }
            if snapshot.complete {
                break;
            }
        }
        if snapshot.failure.is_some() && cleanup_deadline.is_none() {
            shared.stop.store(true, Ordering::Release);
            owned.terminate();
            snapshot.cleanup = Cleanup::Attempted;
            cleanup_deadline = Some(Instant::now() + CLEANUP_GRACE);
        }
        if let Some(deadline) = cleanup_deadline {
            if pending == 0 && owned.released(&snapshot) {
                snapshot.cleanup = Cleanup::Complete;
                owned.armed = false;
                break;
            }
            if Instant::now() >= deadline {
                snapshot.cleanup = Cleanup::Unknown;
                break;
            }
        } else if !matches!(snapshot.child, ChildObservation::Running) {
            snapshot.phase = Phase::Draining;
        }
        if snapshot.child != previous_child || published.elapsed() >= Duration::from_secs(1) {
            if publish(&snapshot).is_err() {
                snapshot.fail(Failure::Progress);
            }
            published = Instant::now();
        }
        if pending > 0 {
            match receive.recv_timeout(POLL) {
                Ok(result) => {
                    pending -= 1;
                    if let Err(failure) = result {
                        snapshot.fail(failure);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    snapshot.fail(Failure::Read);
                    pending = 0;
                }
            }
        } else {
            std::thread::sleep(idle);
            idle = (idle * 2).min(POLL);
        }
    }
    for reader in readers {
        if reader.is_finished() {
            let _ = reader.join();
        }
    }
    shared.snapshot(&mut snapshot);
    if publish(&snapshot).is_err() {
        snapshot.fail(Failure::Progress);
    }
    snapshot
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared(limit: usize) -> Shared {
        Shared {
            remaining: AtomicUsize::new(limit),
            bytes: std::array::from_fn(|_| AtomicU64::new(0)),
            eof: std::array::from_fn(|_| AtomicBool::new(false)),
            stop: AtomicBool::new(false),
        }
    }

    struct PartialWrite {
        bytes: Vec<u8>,
    }
    impl Write for PartialWrite {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if !self.bytes.is_empty() {
                return Err(io::Error::other("private failure"));
            }
            self.bytes.extend_from_slice(&bytes[..2]);
            Ok(2)
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn write_failure_counts_only_written_prefix_and_read_failure_is_typed() {
        let shared = shared(8);
        let mut output = PartialWrite { bytes: Vec::new() };
        assert_eq!(
            copy_stream(&b"binary\x00\xff"[..], &mut output, &shared, 0),
            Err(Failure::Write)
        );
        assert_eq!(shared.bytes[0].load(Ordering::Acquire), 2);
        assert_eq!(output.bytes, b"bi");
        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::other("private read failure"))
            }
        }
        assert_eq!(
            copy_stream(Broken, io::sink(), &shared, 1),
            Err(Failure::Read)
        );
        assert!(!shared.eof[1].load(Ordering::Acquire));
    }

    #[test]
    fn budget_captures_exact_prefix_including_boundary() {
        for length in [7, 8, 9] {
            let shared = shared(8);
            let mut output = Vec::new();
            let result = copy_stream(&vec![0xff; length][..], &mut output, &shared, 0);
            assert_eq!(
                result,
                if length > 8 {
                    Err(Failure::OutputLimit)
                } else {
                    Ok(())
                }
            );
            assert_eq!(output.len(), length.min(8));
            assert_eq!(
                shared.bytes[0].load(Ordering::Acquire),
                length.min(8) as u64
            );
        }
    }
}
