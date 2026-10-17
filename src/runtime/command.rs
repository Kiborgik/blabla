use super::process_tree::{self, ProcessTree};
use std::io::Read;
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

enum Event {
    Exit(Result<ExitStatus, String>),
    Read(bool, Result<Vec<u8>, String>),
}

struct Running {
    child: Option<Child>,
    tree: Option<ProcessTree>,
    events: Option<Receiver<Event>>,
    pending: usize,
}

impl Running {
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
            .ok_or("source CLI exceeded request deadline")?;
        let event = self
            .events
            .as_ref()
            .unwrap()
            .recv_timeout(remaining)
            .map_err(|e| match e {
                RecvTimeoutError::Timeout => "source CLI exceeded request deadline".to_owned(),
                RecvTimeoutError::Disconnected => {
                    "source CLI completion channel disconnected".to_owned()
                }
            })?;
        self.pending -= 1;
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
        #[cfg(unix)]
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
            #[cfg(unix)]
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

fn time_left(deadline: Instant) -> Result<(), String> {
    if Instant::now() >= deadline {
        Err("source CLI exceeded request deadline".into())
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
) -> Result<(), String> {
    std::thread::Builder::new()
        .name("blabla-command-output".into())
        .spawn(move || {
            let _ = events.send(Event::Read(stderr, capture(stream, &remaining)));
        })
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn run(command: &mut Command, deadline: Instant, limit: usize) -> Result<Output, String> {
    time_left(deadline)?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    process_tree::configure(command);
    time_left(deadline)?;
    let child = command.spawn().map_err(|e| e.to_string())?;
    let (sender, events) = mpsc::channel();
    let mut running = Running {
        child: Some(child),
        tree: None,
        events: Some(events),
        pending: 0,
    };
    running.tree =
        Some(ProcessTree::attach(running.child.as_mut().unwrap()).map_err(|e| e.message)?);
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
    reader(stdout, false, remaining.clone(), sender.clone())?;
    running.pending += 1;
    reader(stderr, true, remaining, sender.clone())?;
    running.pending += 1;
    let (transfer, owned) = mpsc::channel::<Child>();
    std::thread::Builder::new()
        .name("blabla-command-exit".into())
        .spawn(move || {
            if let Ok(mut child) = owned.recv() {
                let _ = sender.send(Event::Exit(child.wait().map_err(|e| e.to_string())));
            }
        })
        .map_err(|e| e.to_string())?;
    if let Err(error) = transfer.send(running.child.take().unwrap()) {
        running.child = Some(error.0);
        return Err("source CLI could not transfer child to exit waiter".into());
    }
    running.pending += 1;
    let mut status = None;
    let mut stdout = None;
    let mut stderr = None;
    while running.pending > 0 {
        match running.receive(deadline)? {
            Event::Exit(result) => {
                status = Some(result?);
                running.terminate();
            }
            Event::Read(false, result) => stdout = Some(result?),
            Event::Read(true, result) => stderr = Some(result?),
        }
    }
    while !running.released()? {
        time_left(deadline)?;
        std::thread::sleep(Duration::from_millis(1));
    }
    time_left(deadline)?;
    running.tree.take();
    Ok(Output {
        status: status.ok_or("source CLI exit event missing")?,
        stdout: stdout.ok_or("source CLI stdout event missing")?,
        stderr: stderr.ok_or("source CLI stderr event missing")?,
    })
}
