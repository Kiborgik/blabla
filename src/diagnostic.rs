use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    pub line: usize,
    pub column: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Location {
    pub file: String,
    pub line: usize,
    pub column: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    pub location: Location,
    pub code: String,
    pub message: String,
}

impl Diagnostic {
    pub fn new(file: &str, span: Span, code: &str, message: impl Into<String>) -> Self {
        Self {
            location: Location {
                file: file.into(),
                line: span.line,
                column: span.column,
            },
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exchange_witness: Option<Box<ExchangeWitness>>,
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            exchange_witness: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ExchangeWitness {
    pub request_id: String,
    pub operation: ExchangeOperation,
    pub request_bytes: usize,
    pub child_pid: Option<u32>,
    pub allowance: ExchangeAllowance,
    pub budget_ms: u64,
    pub phase: ExchangePhase,
    pub elapsed_ms: u64,
    pub phase_elapsed_ms: u64,
    pub remaining_ms: u64,
    pub captured_at_session_ms: u64,
    pub writer_produced: WriterProgress,
    pub writer_completed_at_session_ms: Option<u64>,
    pub writer_completion_received: bool,
    pub writer_received_at_session_ms: Option<u64>,
    pub reader_produced: ReaderProgress,
    pub reader_received_ordinal: Option<u64>,
    pub reader_received_at_session_ms: Option<u64>,
    pub reader_correlated_ordinal: Option<u64>,
    pub child_status: ExchangeChildStatus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExchangeOperation {
    Reset,
    Call,
    Observe,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExchangeAllowance {
    Startup,
    Response,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExchangePhase {
    WaitWrite,
    WaitResponse,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WriterProgress {
    Queued,
    Writing,
    Flushed,
    Failed,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ReaderProgress {
    Available {
        last_event: Option<ReaderEventMetadata>,
    },
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct ReaderEventMetadata {
    pub ordinal: u64,
    pub kind: ReaderEventKind,
    pub bytes: usize,
    pub produced_at_session_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReaderEventKind {
    Line,
    Eof,
    Unterminated,
    TooLong,
    Io,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ExchangeChildStatus {
    Running,
    Exited { success: bool, code: Option<i32> },
    Unknown,
}
