use super::process_tree::{self, ProcessTree};
use std::io::Read;
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

pub const DEADLINE_EXPIRED: &str = "source CLI exceeded request deadline";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompletionKind {
    ExitWaiter,
    StdoutReader,
    StderrReader,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProducerState {
    NotStarted,
    Pending,
    Observed { after: Duration, succeeded: bool },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CompletionObservation {
    pub kind: CompletionKind,
    pub producer: ProducerState,
    pub received_after: Option<Duration>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StageTiming {
    pub stage: &'static str,
    pub elapsed: Duration,
}

#[derive(Debug)]
pub struct Diagnostics {
    pub budget_at_entry: Duration,
    pub elapsed: Duration,
    pub remaining: Duration,
    pub snapshot_after: Duration,
    pub stages: [Option<StageTiming>; 8],
    pub completions: [CompletionObservation; 3],
}

impl Diagnostics {
    fn new(started: Instant, deadline: Instant) -> Self {
        Self {
            budget_at_entry: deadline.saturating_duration_since(started),
            elapsed: Duration::ZERO,
            remaining: Duration::ZERO,
            snapshot_after: Duration::ZERO,
            stages: [None; 8],
            completions: [
                CompletionKind::ExitWaiter,
                CompletionKind::StdoutReader,
                CompletionKind::StderrReader,
            ]
            .map(|kind| CompletionObservation {
                kind,
                producer: ProducerState::NotStarted,
                received_after: None,
            }),
        }
    }
}

#[derive(Clone)]
struct ProducerRecorder {
    started: Instant,
    facts: Arc<[OnceLock<ProducerState>; 3]>,
}

impl ProducerRecorder {
    fn observed(&self, index: usize, succeeded: bool) {
        let _ = self.facts[index].set(ProducerState::Observed {
            after: self.started.elapsed(),
            succeeded,
        });
    }
}

struct Observations {
    producer: ProducerRecorder,
    started: [bool; 3],
    received: [Option<Duration>; 3],
}

impl Observations {
    fn new(started: Instant) -> Self {
        Self {
            producer: ProducerRecorder {
                started,
                facts: Arc::new(std::array::from_fn(|_| OnceLock::new())),
            },
            started: [false; 3],
            received: [None; 3],
        }
    }

    fn snapshot(&self, diagnostics: &mut Diagnostics) {
        for (index, event) in diagnostics.completions.iter_mut().enumerate() {
            event.producer =
                self.producer.facts[index]
                    .get()
                    .copied()
                    .unwrap_or(if self.started[index] {
                        ProducerState::Pending
                    } else {
                        ProducerState::NotStarted
                    });
            event.received_after = self.received[index];
        }
        diagnostics.snapshot_after = self.producer.started.elapsed();
    }
}

enum Event {
    Exit(Result<ExitStatus, String>),
    Read(bool, Result<Vec<u8>, String>),
}

struct Running {
    child: Option<Child>,
    tree: Option<ProcessTree>,
    events: Option<Receiver<Event>>,
    pending: usize,
    observations: Option<Observations>,
}

impl Running {
    fn producer(&self) -> Option<ProducerRecorder> {
        self.observations
            .as_ref()
            .map(|value| value.producer.clone())
    }

    fn started(&mut self, index: usize) {
        if let Some(observations) = &mut self.observations {
            observations.started[index] = true;
        }
    }

    fn terminate(&mut self) {
        if let Some(tree) = self.tree.as_mut() {
            tree.terminate();
        }
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
        }
    }

    fn released(&mut self) -> Result<bool, String> {
        let exited = match self.child.as_mut() {
            Some(child) => child.try_wait().map_err(|e| e.to_string())?.is_some(),
            None => true,
        };
        if exited
            && self.pending == 0
            && let Some(tree) = &self.tree
        {
            tree.reap_descendants();
        }
        Ok(exited
            && self.pending == 0
            && self
                .tree
                .as_ref()
                .map(ProcessTree::is_empty)
                .transpose()
                .map_err(|e| e.message)?
                .unwrap_or(true))
    }

    fn receive(&mut self, deadline: Instant) -> Result<Event, String> {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or(DEADLINE_EXPIRED)?;
        let event = self
            .events
            .as_ref()
            .unwrap()
            .recv_timeout(remaining)
            .map_err(|e| match e {
                RecvTimeoutError::Timeout => DEADLINE_EXPIRED.to_owned(),
                RecvTimeoutError::Disconnected => {
                    "source CLI completion channel disconnected".to_owned()
                }
            })?;
        self.pending -= 1;
        if let Some(observations) = &mut self.observations {
            let index = match &event {
                Event::Exit(_) => 0,
                Event::Read(false, _) => 1,
                Event::Read(true, _) => 2,
            };
            observations.received[index] = Some(observations.producer.started.elapsed());
        }
        Ok(event)
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.terminate();
        let deadline = Instant::now() + Duration::from_millis(250);
        while Instant::now() < deadline {
            if self.released().unwrap_or(false) {
                return;
            }
            if self.pending > 0 {
                if self.receive(deadline).is_err() {
                    break;
                }
            } else {
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        let child = self.child.take();
        let events = self.events.take();
        let pending = self.pending;
        let tree = self.tree.take();
        std::thread::spawn(move || {
            if let Some(mut child) = child {
                let _ = child.wait();
            }
            if let Some(events) = events {
                for _ in 0..pending {
                    if events.recv().is_err() {
                        break;
                    }
                }
            }
            if let Some(tree) = tree {
                loop {
                    tree.reap_descendants();
                    if tree.is_empty().unwrap_or(false) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        });
    }
}

pub fn time_left(deadline: Instant) -> Result<(), String> {
    if Instant::now() >= deadline {
        Err(DEADLINE_EXPIRED.into())
    } else {
        Ok(())
    }
}

fn capture(mut stream: impl Read, remaining: &AtomicUsize) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = stream.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            return Ok(output);
        }
        remaining
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |left| {
                left.checked_sub(count)
            })
            .map_err(|_| "source CLI exceeded request output budget")?;
        output.extend_from_slice(&buffer[..count]);
    }
}

fn reader(
    stream: impl Read + Send + 'static,
    stderr: bool,
    remaining: Arc<AtomicUsize>,
    events: Sender<Event>,
    diagnostics: Option<ProducerRecorder>,
) -> Result<(), String> {
    std::thread::Builder::new()
        .name("blabla-command-output".into())
        .spawn(move || {
            let result = capture(stream, &remaining);
            if let Some(diagnostics) = diagnostics {
                diagnostics.observed(if stderr { 2 } else { 1 }, result.is_ok());
            }
            let _ = events.send(Event::Read(stderr, result));
        })
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn measured<T>(
    timings: &mut Vec<(&'static str, Duration)>,
    stage: &'static str,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let started = Instant::now();
    let result = action();
    timings.push((stage, started.elapsed()));
    result.map_err(|error| format!("{error}; process stage: {stage}"))
}

pub fn run(command: &mut Command, deadline: Instant, limit: usize) -> Result<Output, String> {
    run_recorded(command, deadline, limit, Instant::now(), None)
}

pub fn run_with_diagnostics(
    command: &mut Command,
    deadline: Instant,
    limit: usize,
) -> (Result<Output, String>, Diagnostics) {
    let started = Instant::now();
    let mut diagnostics = Diagnostics::new(started, deadline);
    let result = run_recorded(command, deadline, limit, started, Some(&mut diagnostics));
    (result, diagnostics)
}

fn run_recorded(
    command: &mut Command,
    deadline: Instant,
    limit: usize,
    started: Instant,
    mut diagnostics: Option<&mut Diagnostics>,
) -> Result<Output, String> {
    let mut timings = Vec::with_capacity(8);
    let result = run_inner(
        command,
        deadline,
        limit,
        &mut timings,
        started,
        &mut diagnostics,
    );
    if let Some(diagnostics) = diagnostics {
        diagnostics.elapsed = started.elapsed();
        diagnostics.remaining = deadline.saturating_duration_since(Instant::now());
        if diagnostics.snapshot_after.is_zero() {
            diagnostics.snapshot_after = diagnostics.elapsed;
        }
        for (slot, (stage, elapsed)) in diagnostics.stages.iter_mut().zip(&timings) {
            *slot = Some(StageTiming {
                stage,
                elapsed: *elapsed,
            });
        }
    }
    result.map_err(|error| {
        let timings = timings
            .into_iter()
            .map(|(stage, duration)| format!("{stage}={}ms", duration.as_millis()))
            .collect::<Vec<_>>()
            .join(", ");
        format!("{error}; process timings: {timings}")
    })
}

fn run_inner(
    command: &mut Command,
    deadline: Instant,
    limit: usize,
    timings: &mut Vec<(&'static str, Duration)>,
    started: Instant,
    diagnostics: &mut Option<&mut Diagnostics>,
) -> Result<Output, String> {
    time_left(deadline)?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    process_tree::configure(command);
    time_left(deadline)?;
    let child = measured(timings, "spawn", || {
        command.spawn().map_err(|e| e.to_string())
    })?;
    let (sender, events) = mpsc::channel();
    let mut running = Running {
        child: Some(child),
        tree: None,
        events: Some(events),
        pending: 0,
        observations: diagnostics.is_some().then(|| Observations::new(started)),
    };
    let result = (|| {
        time_left(deadline).map_err(|error| format!("{error}; process stage: spawn"))?;
        running.tree = Some(measured(timings, "attach/resume", || {
            ProcessTree::attach(running.child.as_mut().unwrap()).map_err(|e| e.message)
        })?);
        time_left(deadline).map_err(|error| format!("{error}; process stage: attach/resume"))?;
        let stdout = running
            .child
            .as_mut()
            .unwrap()
            .stdout
            .take()
            .ok_or("source CLI stdout unavailable")?;
        let stderr = running
            .child
            .as_mut()
            .unwrap()
            .stderr
            .take()
            .ok_or("source CLI stderr unavailable")?;
        let remaining = Arc::new(AtomicUsize::new(limit));
        reader(
            stdout,
            false,
            remaining.clone(),
            sender.clone(),
            running.producer(),
        )?;
        running.pending += 1;
        running.started(1);
        reader(stderr, true, remaining, sender.clone(), running.producer())?;
        running.pending += 1;
        running.started(2);
        let (transfer, owned) = mpsc::channel::<Child>();
        let producer = running.producer();
        std::thread::Builder::new()
            .name("blabla-command-exit".into())
            .spawn(move || {
                if let Ok(mut child) = owned.recv() {
                    let result = child.wait().map_err(|e| e.to_string());
                    if let Some(producer) = producer {
                        producer.observed(0, result.is_ok());
                    }
                    let _ = sender.send(Event::Exit(result));
                }
            })
            .map_err(|e| e.to_string())?;
        if let Err(error) = transfer.send(running.child.take().unwrap()) {
            running.child = Some(error.0);
            return Err("source CLI could not transfer child to exit waiter".into());
        }
        running.pending += 1;
        running.started(0);
        let mut status = None;
        let mut stdout = None;
        let mut stderr = None;
        while running.pending > 0 {
            match measured(timings, "completion event", || running.receive(deadline))? {
                Event::Exit(result) => {
                    status = Some(result?);
                    measured(timings, "terminate descendants", || {
                        running.terminate();
                        Ok(())
                    })?;
                }
                Event::Read(false, result) => stdout = Some(result?),
                Event::Read(true, result) => stderr = Some(result?),
            }
        }
        measured(timings, "tree release", || {
            while !running.released()? {
                time_left(deadline)?;
                std::thread::sleep(Duration::from_millis(1));
            }
            time_left(deadline)
        })?;
        running.tree.take();
        Ok(Output {
            status: status.ok_or("source CLI exit event missing")?,
            stdout: stdout.ok_or("source CLI stdout event missing")?,
            stderr: stderr.ok_or("source CLI stderr event missing")?,
        })
    })();
    if let (Some(observations), Some(diagnostics)) = (&running.observations, diagnostics) {
        observations.snapshot(diagnostics);
    }
    measured(timings, "cleanup", || {
        drop(running);
        Ok(())
    })?;
    result.and_then(|output| {
        time_left(deadline)?;
        Ok(output)
    })
}
