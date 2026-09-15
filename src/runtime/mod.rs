pub mod primitives;
mod process_tree;
mod strict_json;

use crate::application::{AppConfig, Application};
use crate::diagnostic::AppError;
use crate::ir::{Field, MAX_INT, Type};
use crate::report::Call;
use serde_json::{Map, Value, json};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tempfile::TempDir;

use process_tree::ProcessTree;

pub const MAX_TIMEOUT: Duration = Duration::from_secs(5);
const RESPONSE_LINE_LIMIT: usize = 1024 * 1024;
const CLEANUP_LIMIT: Duration = Duration::from_millis(250);

struct WriteJob {
    bytes: Vec<u8>,
    completion: SyncSender<Result<(), String>>,
}

enum ResponseEvent {
    Line(Vec<u8>),
    Eof,
    Unterminated,
    TooLong,
    Io(String),
}

pub struct AppSession {
    child: Option<Child>,
    writer: Option<Sender<WriteJob>>,
    responses: Receiver<ResponseEvent>,
    writer_thread: Option<JoinHandle<()>>,
    reader_thread: Option<JoinHandle<()>>,
    process_tree: Option<ProcessTree>,
    temp_dir: Option<Arc<TempDir>>,
    config: AppConfig,
    initialized: bool,
    timeout: Duration,
    closed: bool,
}

impl AppSession {
    pub fn spawn(config: &AppConfig) -> Result<Self, AppError> {
        if config.timeout.is_zero() || config.timeout > MAX_TIMEOUT {
            return Err(AppError::new(
                "APP_CONFIG",
                "exchange timeout must be greater than zero and at most five seconds",
            ));
        }

        let temp_dir = Arc::new(TempDir::new().map_err(|error| {
            AppError::new(
                "APP_SPAWN",
                format!("could not create working directory: {error}"),
            )
        })?);
        Self::spawn_in(config, temp_dir)
    }

    fn spawn_in(config: &AppConfig, temp_dir: Arc<TempDir>) -> Result<Self, AppError> {
        let mut command = Command::new(&config.executable);
        command
            .args(&config.args)
            .current_dir(temp_dir.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        process_tree::configure(&mut command);
        let mut child = command.spawn().map_err(|error| {
            AppError::new(
                "APP_SPAWN",
                format!("could not start application process: {error}"),
            )
        })?;
        let process_tree = match ProcessTree::attach(&mut child) {
            Ok(process_tree) => process_tree,
            Err(error) => {
                cleanup_failed_spawn(child, temp_dir, None);
                return Err(error);
            }
        };

        let (stdin, stdout) = match (child.stdin.take(), child.stdout.take()) {
            (Some(stdin), Some(stdout)) => (stdin, stdout),
            _ => {
                cleanup_failed_spawn(child, temp_dir, Some(process_tree));
                return Err(AppError::new(
                    "APP_SPAWN",
                    "application protocol pipes were not available",
                ));
            }
        };
        let (writer, write_jobs) = mpsc::channel();
        let (response_sender, responses) = mpsc::sync_channel(1);
        let writer_thread = match thread::Builder::new()
            .name("blabla-app-writer".into())
            .spawn(move || write_requests(stdin, write_jobs))
        {
            Ok(handle) => handle,
            Err(error) => {
                cleanup_failed_spawn(child, temp_dir, Some(process_tree));
                return Err(AppError::new(
                    "APP_SPAWN",
                    format!("could not start protocol writer: {error}"),
                ));
            }
        };
        let reader_thread = match thread::Builder::new()
            .name("blabla-app-reader".into())
            .spawn(move || read_responses(stdout, response_sender))
        {
            Ok(handle) => handle,
            Err(error) => {
                drop(writer);
                cleanup_failed_spawn(child, temp_dir, Some(process_tree));
                let mut writer_thread = Some(writer_thread);
                let deadline = Instant::now() + CLEANUP_LIMIT;
                while Instant::now() < deadline
                    && writer_thread
                        .as_ref()
                        .is_some_and(|handle| !handle.is_finished())
                {
                    thread::sleep(Duration::from_millis(1));
                }
                join_finished(&mut writer_thread);
                return Err(AppError::new(
                    "APP_SPAWN",
                    format!("could not start protocol reader: {error}"),
                ));
            }
        };

        Ok(Self {
            child: Some(child),
            writer: Some(writer),
            responses,
            writer_thread: Some(writer_thread),
            reader_thread: Some(reader_thread),
            process_tree: Some(process_tree),
            temp_dir: Some(temp_dir),
            config: config.clone(),
            initialized: false,
            timeout: config.timeout,
            closed: false,
        })
    }

    fn exchange(&mut self, request: Value) -> Result<Value, AppError> {
        let result = self.exchange_open(request);
        if result.is_err() {
            self.shutdown();
        }
        result
    }

    fn exchange_open(&mut self, mut request: Value) -> Result<Value, AppError> {
        if self.closed {
            return Err(AppError::new("APP_IO", "application session is closed"));
        }
        let deadline = Instant::now() + self.timeout;
        let request_id = request_id()?;
        request
            .as_object_mut()
            .ok_or_else(|| AppError::new("APP_IO", "protocol request must be an object"))?
            .insert("id".into(), Value::String(request_id.clone()));
        let mut bytes = serde_json::to_vec(&request).map_err(|error| {
            AppError::new(
                "APP_IO",
                format!("could not encode protocol request: {error}"),
            )
        })?;
        bytes.push(b'\n');
        let (completion, written) = mpsc::sync_channel(1);
        self.writer
            .as_ref()
            .ok_or_else(|| AppError::new("APP_IO", "application input is closed"))?
            .send(WriteJob { bytes, completion })
            .map_err(|_| AppError::new("APP_IO", "application input is closed"))?;

        match written.recv_timeout(remaining(deadline)?) {
            Ok(Ok(())) => {}
            Ok(Err(message)) => return Err(AppError::new("APP_IO", message)),
            Err(RecvTimeoutError::Timeout) => {
                return Err(AppError::new(
                    "APP_TIMEOUT",
                    "application exchange timed out while writing request",
                ));
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(AppError::new(
                    "APP_IO",
                    "protocol writer stopped unexpectedly",
                ));
            }
        }

        let event = match self.responses.recv_timeout(remaining(deadline)?) {
            Ok(event) => event,
            Err(RecvTimeoutError::Timeout) => {
                return Err(AppError::new(
                    "APP_TIMEOUT",
                    "application exchange timed out while reading response",
                ));
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(AppError::new(
                    "APP_IO",
                    "protocol reader stopped unexpectedly",
                ));
            }
        };
        let line = match event {
            ResponseEvent::Line(line) => line,
            ResponseEvent::Eof => return Err(self.eof_error(deadline)),
            ResponseEvent::Unterminated => {
                return Err(AppError::new(
                    "APP_PROTOCOL",
                    "application closed stdout before terminating its response line",
                ));
            }
            ResponseEvent::TooLong => {
                return Err(AppError::new(
                    "APP_PROTOCOL",
                    "application response exceeded the 1 MiB line limit",
                ));
            }
            ResponseEvent::Io(message) => return Err(AppError::new("APP_IO", message)),
        };
        let response =
            serde_json::from_slice::<strict_json::StrictValue>(&line).map_err(|error| {
                AppError::new(
                    "APP_PROTOCOL",
                    format!("application emitted malformed JSON: {error}"),
                )
            })?;
        unwrap_response(response.0, &request_id)
    }

    fn eof_error(&mut self, exchange_deadline: Instant) -> AppError {
        let status_deadline = exchange_deadline.min(Instant::now() + Duration::from_millis(50));
        loop {
            match self.child.as_mut().map(Child::try_wait) {
                Some(Ok(Some(status))) if !status.success() => {
                    return AppError::new(
                        "APP_CRASH",
                        format!("application exited unsuccessfully with {status}"),
                    );
                }
                Some(Ok(Some(status))) => {
                    return AppError::new(
                        "APP_EOF",
                        format!("application exited before responding with {status}"),
                    );
                }
                Some(Ok(None)) if Instant::now() < status_deadline => {
                    thread::sleep(Duration::from_millis(1));
                }
                Some(Ok(None)) | None => {
                    return AppError::new("APP_EOF", "application closed stdout before responding");
                }
                Some(Err(error)) => {
                    return AppError::new(
                        "APP_IO",
                        format!("could not inspect application process: {error}"),
                    );
                }
            }
        }
    }

    fn acknowledgement(&mut self, request: Value) -> Result<(), AppError> {
        let result = self.exchange(request).and_then(validate_acknowledgement);
        if result.is_err() {
            self.shutdown();
        }
        result
    }

    fn finish_open(&mut self) -> Result<(), AppError> {
        if self.closed {
            return Err(AppError::new("APP_IO", "application session is closed"));
        }
        let deadline = Instant::now() + self.timeout;
        self.writer.take();
        while self
            .writer_thread
            .as_ref()
            .is_some_and(|handle| !handle.is_finished())
        {
            if Instant::now() >= deadline {
                return Err(AppError::new(
                    "APP_TIMEOUT",
                    "application finalization timed out while closing stdin",
                ));
            }
            thread::sleep(Duration::from_millis(1));
        }
        join_finished(&mut self.writer_thread);

        let mut saw_eof = false;
        let mut saw_exit = false;
        while !saw_eof || !saw_exit {
            if !saw_exit {
                match self.child.as_mut().map(Child::try_wait) {
                    Some(Ok(Some(status))) if status.success() => {
                        saw_exit = true;
                        if let Some(mut process_tree) = self.process_tree.take() {
                            process_tree.terminate();
                        }
                    }
                    Some(Ok(Some(status))) => {
                        return Err(AppError::new(
                            "APP_CRASH",
                            format!("application exited unsuccessfully with {status}"),
                        ));
                    }
                    Some(Ok(None)) => {}
                    Some(Err(error)) => {
                        return Err(AppError::new(
                            "APP_IO",
                            format!("could not inspect application process: {error}"),
                        ));
                    }
                    None => {
                        return Err(AppError::new(
                            "APP_IO",
                            "application process is not available",
                        ));
                    }
                }
            }

            if !saw_eof {
                let wait = remaining(deadline)?.min(Duration::from_millis(5));
                match self.responses.recv_timeout(wait) {
                    Ok(ResponseEvent::Line(_)) => {
                        return Err(AppError::new(
                            "APP_PROTOCOL",
                            "application emitted an extra response during finalization",
                        ));
                    }
                    Ok(ResponseEvent::Eof) => saw_eof = true,
                    Ok(ResponseEvent::Unterminated) => {
                        return Err(AppError::new(
                            "APP_PROTOCOL",
                            "application closed stdout with an unterminated trailing response",
                        ));
                    }
                    Ok(ResponseEvent::TooLong) => {
                        return Err(AppError::new(
                            "APP_PROTOCOL",
                            "application trailing response exceeded the 1 MiB line limit",
                        ));
                    }
                    Ok(ResponseEvent::Io(message)) => {
                        return Err(AppError::new("APP_IO", message));
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => {
                        return Err(AppError::new(
                            "APP_IO",
                            "protocol reader stopped before clean EOF",
                        ));
                    }
                }
            } else if Instant::now() >= deadline {
                return Err(AppError::new(
                    "APP_TIMEOUT",
                    "application finalization timed out waiting for process exit",
                ));
            } else {
                thread::sleep(Duration::from_millis(1));
            }
        }

        while self
            .reader_thread
            .as_ref()
            .is_some_and(|handle| !handle.is_finished())
        {
            if Instant::now() >= deadline {
                return Err(AppError::new(
                    "APP_TIMEOUT",
                    "application finalization timed out releasing protocol reader",
                ));
            }
            thread::sleep(Duration::from_millis(1));
        }
        join_finished(&mut self.reader_thread);
        self.closed = true;
        self.child.take();
        self.temp_dir.take();
        Ok(())
    }

    fn terminate_verified(&mut self) -> Result<(), AppError> {
        if self.closed {
            return Err(AppError::new(
                "APP_LIFECYCLE",
                "cannot restart a closed application",
            ));
        }
        let deadline = Instant::now() + self.timeout;
        if self
            .child
            .as_mut()
            .ok_or_else(|| AppError::new("APP_LIFECYCLE", "application process is missing"))?
            .try_wait()
            .map_err(|error| AppError::new("APP_IO", error.to_string()))?
            .is_some()
        {
            return Err(AppError::new(
                "APP_CRASH",
                "application exited before trusted termination",
            ));
        }
        if let Some(child) = self.child.as_mut() {
            child.kill().map_err(|error| {
                AppError::new(
                    "APP_LIFECYCLE",
                    format!("could not terminate application: {error}"),
                )
            })?;
        }
        if let Some(tree) = self.process_tree.as_mut() {
            tree.terminate();
        }
        self.writer.take();
        let mut exited = false;
        loop {
            if !exited {
                exited = self
                    .child
                    .as_mut()
                    .unwrap()
                    .try_wait()
                    .map_err(|error| AppError::new("APP_IO", error.to_string()))?
                    .is_some();
            }
            while let Ok(event) = self.responses.try_recv() {
                if !matches!(event, ResponseEvent::Eof) {
                    return Err(AppError::new(
                        "APP_PROTOCOL",
                        "unexpected protocol output during trusted termination",
                    ));
                }
            }
            let threads_finished = self
                .writer_thread
                .as_ref()
                .is_none_or(JoinHandle::is_finished)
                && self
                    .reader_thread
                    .as_ref()
                    .is_none_or(JoinHandle::is_finished);
            let tree_empty = self
                .process_tree
                .as_ref()
                .map(ProcessTree::is_empty)
                .transpose()?
                .unwrap_or(true);
            if exited && threads_finished && tree_empty {
                break;
            }
            if Instant::now() >= deadline {
                return Err(AppError::new(
                    "APP_TIMEOUT",
                    "trusted termination did not release application processes and pipes",
                ));
            }
            thread::sleep(Duration::from_millis(1));
        }
        join_finished(&mut self.writer_thread);
        join_finished(&mut self.reader_thread);
        while let Ok(event) = self.responses.try_recv() {
            if !matches!(event, ResponseEvent::Eof) {
                return Err(AppError::new(
                    "APP_PROTOCOL",
                    "unexpected trailing protocol output during trusted termination",
                ));
            }
        }
        self.child.take();
        self.process_tree.take();
        self.temp_dir.take();
        self.closed = true;
        Ok(())
    }

    fn shutdown(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        self.writer.take();

        if let Some(mut process_tree) = self.process_tree.take() {
            process_tree.terminate();
        }

        let mut child = self.child.take();
        if let Some(process) = child.as_mut() {
            let _ = process.kill();
        }
        let cleanup_deadline = Instant::now() + CLEANUP_LIMIT;
        let mut reaped = false;
        while Instant::now() < cleanup_deadline {
            match child.as_mut().map(Child::try_wait) {
                Some(Ok(Some(_))) | None => {
                    reaped = true;
                    break;
                }
                Some(Ok(None)) => thread::sleep(Duration::from_millis(1)),
                Some(Err(_)) => break,
            }
        }

        if reaped {
            child.take();
            self.temp_dir.take();
        } else if let Some(mut process) = child.take() {
            let temp_dir = self.temp_dir.take();
            thread::spawn(move || {
                let _ = process.wait();
                drop(temp_dir);
            });
        } else {
            self.temp_dir.take();
        }

        while Instant::now() < cleanup_deadline
            && (self
                .writer_thread
                .as_ref()
                .is_some_and(|handle| !handle.is_finished())
                || self
                    .reader_thread
                    .as_ref()
                    .is_some_and(|handle| !handle.is_finished()))
        {
            while self.responses.try_recv().is_ok() {}
            thread::sleep(Duration::from_millis(1));
        }
        join_finished(&mut self.writer_thread);
        join_finished(&mut self.reader_thread);
    }
}

impl Application for AppSession {
    fn reset(&mut self) -> Result<(), AppError> {
        if self.initialized {
            let config = self.config.clone();
            if let Err(error) = self.terminate_verified() {
                self.shutdown();
                return Err(error);
            }
            *self = Self::spawn(&config)?;
        }
        self.acknowledgement(json!({"op": "reset"}))?;
        self.initialized = true;
        Ok(())
    }

    fn call(&mut self, call: &Call) -> Result<(), AppError> {
        if call.action == "restart" {
            return Err(AppError::new(
                "APP_LIFECYCLE",
                "restart must use the trusted lifecycle operation",
            ));
        }
        self.acknowledgement(json!({
            "op": "call",
            "name": call.action,
            "args": call.args,
        }))
    }

    fn observe(&mut self, schema: &[Field]) -> Result<Value, AppError> {
        let response = self.exchange(json!({"op": "observe"}))?;
        let result = project_observation(&response, schema);
        if result.is_err() {
            self.shutdown();
        }
        result
    }

    fn finish(&mut self) -> Result<(), AppError> {
        let result = self.finish_open();
        if result.is_err() {
            self.shutdown();
        }
        result
    }

    fn restart(&mut self) -> Result<(), AppError> {
        let config = self.config.clone();
        let directory = self
            .temp_dir
            .clone()
            .ok_or_else(|| AppError::new("APP_LIFECYCLE", "application environment is closed"))?;
        if let Err(error) = self.terminate_verified() {
            self.shutdown();
            return Err(error);
        }
        *self = Self::spawn_in(&config, directory)?;
        self.initialized = true;
        Ok(())
    }
}

impl Drop for AppSession {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub fn project_observation(value: &Value, schema: &[Field]) -> Result<Value, AppError> {
    project_record(value, schema, "$")
}

fn project_record(value: &Value, schema: &[Field], path: &str) -> Result<Value, AppError> {
    let object = value
        .as_object()
        .ok_or_else(|| observation_error(path, "object", value))?;
    let mut projected = Map::new();
    for field in schema {
        let field_path = format!("{path}.{}", field.name);
        let field_value = object.get(&field.name).ok_or_else(|| {
            AppError::new(
                "APP_OBSERVATION",
                format!("observation is missing required field {field_path}"),
            )
        })?;
        projected.insert(
            field.name.clone(),
            project_value(field_value, &field.ty, &field_path)?,
        );
    }
    Ok(Value::Object(projected))
}

fn project_value(value: &Value, ty: &Type, path: &str) -> Result<Value, AppError> {
    match ty {
        Type::Bool if value.is_boolean() => Ok(value.clone()),
        Type::String if value.is_string() => Ok(value.clone()),
        Type::Int => match value.as_i64() {
            Some(number) if (-MAX_INT..=MAX_INT).contains(&number) => Ok(Value::from(number)),
            _ => Err(observation_error(path, "JSON-safe integer", value)),
        },
        Type::Float => value
            .as_f64()
            .filter(|number| number.is_finite())
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .ok_or_else(|| observation_error(path, "finite float", value)),
        Type::Optional(inner) => {
            if value.is_null() {
                Ok(Value::Null)
            } else {
                project_value(value, inner, path)
            }
        }
        Type::Null => Err(observation_error(path, "declared observable type", value)),
        Type::List(item_type) => {
            let list = value
                .as_array()
                .ok_or_else(|| observation_error(path, "list", value))?;
            let mut projected = Vec::with_capacity(list.len());
            for (index, item) in list.iter().enumerate() {
                projected.push(project_value(item, item_type, &format!("{path}[{index}]"))?);
            }
            Ok(Value::Array(projected))
        }
        Type::Record(fields) => project_record(value, fields, path),
        Type::Bool => Err(observation_error(path, "boolean", value)),
        Type::String => Err(observation_error(path, "string", value)),
    }
}

fn observation_error(path: &str, expected: &str, value: &Value) -> AppError {
    AppError::new(
        "APP_OBSERVATION",
        format!("observation field {path} must be {expected}, got {value}"),
    )
}

fn validate_acknowledgement(response: Value) -> Result<(), AppError> {
    let object = response
        .as_object()
        .ok_or_else(|| AppError::new("APP_PROTOCOL", "acknowledgement must be a JSON object"))?;
    match object.get("ok") {
        Some(Value::Bool(true)) if object.len() == 1 => Ok(()),
        Some(Value::Bool(false))
            if object.len() == 2 && object.get("error").is_some_and(Value::is_string) =>
        {
            Err(AppError::new(
                "APP_FAILURE",
                object["error"]
                    .as_str()
                    .unwrap_or("application rejected request"),
            ))
        }
        _ => Err(AppError::new(
            "APP_PROTOCOL",
            "acknowledgement must be exactly {\"ok\":true} or {\"ok\":false,\"error\":string}",
        )),
    }
}

fn request_id() -> Result<String, AppError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| {
        AppError::new(
            "APP_IO",
            format!("could not generate protocol request id: {error}"),
        )
    })?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut id = String::with_capacity(32);
    for byte in bytes {
        id.push(HEX[(byte >> 4) as usize] as char);
        id.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(id)
}

fn unwrap_response(mut response: Value, request_id: &str) -> Result<Value, AppError> {
    let object = response.as_object_mut().ok_or_else(|| {
        AppError::new(
            "APP_PROTOCOL",
            "application response must be an envelope object",
        )
    })?;
    if object.len() != 2 || object.get("id").and_then(Value::as_str) != Some(request_id) {
        return Err(AppError::new(
            "APP_PROTOCOL",
            "application response id did not match its request",
        ));
    }
    object.remove("result").ok_or_else(|| {
        AppError::new(
            "APP_PROTOCOL",
            "application response envelope is missing result",
        )
    })
}

fn remaining(deadline: Instant) -> Result<Duration, AppError> {
    deadline
        .checked_duration_since(Instant::now())
        .ok_or_else(|| AppError::new("APP_TIMEOUT", "application exchange deadline elapsed"))
}

fn write_requests(mut stdin: ChildStdin, jobs: Receiver<WriteJob>) {
    for job in jobs {
        let result = stdin
            .write_all(&job.bytes)
            .and_then(|()| stdin.flush())
            .map_err(|error| format!("could not write application request: {error}"));
        let failed = result.is_err();
        let _ = job.completion.send(result);
        if failed {
            break;
        }
    }
}

fn read_responses(stdout: ChildStdout, responses: SyncSender<ResponseEvent>) {
    let mut reader = BufReader::new(stdout);
    let mut line = Vec::new();
    loop {
        let available = match reader.fill_buf() {
            Ok(available) => available,
            Err(error) => {
                let _ = responses.send(ResponseEvent::Io(format!(
                    "could not read application response: {error}"
                )));
                return;
            }
        };
        if available.is_empty() {
            let event = if line.is_empty() {
                ResponseEvent::Eof
            } else {
                ResponseEvent::Unterminated
            };
            let _ = responses.send(event);
            return;
        }
        if let Some(newline) = available.iter().position(|byte| *byte == b'\n') {
            if line.len() + newline > RESPONSE_LINE_LIMIT {
                let _ = responses.send(ResponseEvent::TooLong);
                return;
            }
            line.extend_from_slice(&available[..newline]);
            reader.consume(newline + 1);
            if responses
                .send(ResponseEvent::Line(std::mem::take(&mut line)))
                .is_err()
            {
                return;
            }
        } else {
            let available_len = available.len();
            if line.len() + available_len > RESPONSE_LINE_LIMIT {
                let _ = responses.send(ResponseEvent::TooLong);
                return;
            }
            line.extend_from_slice(available);
            reader.consume(available_len);
        }
    }
}

fn cleanup_failed_spawn(
    mut child: Child,
    temp_dir: Arc<TempDir>,
    mut process_tree: Option<ProcessTree>,
) {
    if let Some(process_tree) = process_tree.as_mut() {
        process_tree.terminate();
    }
    let _ = child.kill();
    let deadline = Instant::now() + CLEANUP_LIMIT;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(Duration::from_millis(1)),
            Err(_) => break,
        }
    }
    let _ = thread::Builder::new()
        .name("blabla-app-reaper".into())
        .spawn(move || {
            let _ = child.wait();
            drop(temp_dir);
        });
}

fn join_finished(handle: &mut Option<JoinHandle<()>>) {
    if handle.as_ref().is_some_and(JoinHandle::is_finished)
        && let Some(handle) = handle.take()
    {
        let _ = handle.join();
    }
}
