use crate::diagnostic::{
    ExchangeAllowance, ExchangeChildStatus, ExchangeOperation, ExchangePhase, ExchangeWitness,
    ReaderEventKind, ReaderEventMetadata, ReaderProgress, WriterProgress,
};
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub(super) struct Slot<T> {
    value: Mutex<T>,
    unavailable: AtomicBool,
}

impl<T: Copy> Slot<T> {
    pub(super) fn new(value: T) -> Self {
        Self {
            value: Mutex::new(value),
            unavailable: AtomicBool::new(false),
        }
    }

    pub(super) fn publish(&self, value: T) {
        match self.value.try_lock() {
            Ok(mut current) => *current = value,
            Err(_) => self.unavailable.store(true, Ordering::Release),
        }
    }

    fn snapshot(&self) -> Option<T> {
        let value = self.value.try_lock().ok()?;
        if self.unavailable.load(Ordering::Acquire) {
            None
        } else {
            Some(*value)
        }
    }
}

#[derive(Clone, Copy)]
pub(super) struct WriterMetadata {
    progress: WriterProgress,
    completed_at_session_ms: Option<u64>,
}

impl Slot<WriterMetadata> {
    pub(super) fn writing(&self) {
        self.publish(WriterMetadata {
            progress: WriterProgress::Writing,
            completed_at_session_ms: None,
        });
    }

    pub(super) fn completed(&self, success: bool, session_started: Instant) {
        self.publish(WriterMetadata {
            progress: if success {
                WriterProgress::Flushed
            } else {
                WriterProgress::Failed
            },
            completed_at_session_ms: Some(millis(session_started.elapsed())),
        });
    }
}

pub(super) type ReaderRecorder = Slot<ReaderProgress>;

impl ReaderRecorder {
    pub(super) fn produced(
        &self,
        ordinal: Option<u64>,
        kind: ReaderEventKind,
        bytes: usize,
        session_started: Instant,
    ) {
        self.publish(match ordinal {
            Some(ordinal) => ReaderProgress::Available {
                last_event: Some(ReaderEventMetadata {
                    ordinal,
                    kind,
                    bytes,
                    produced_at_session_ms: millis(session_started.elapsed()),
                }),
            },
            None => ReaderProgress::Unknown,
        });
    }
}

pub(super) struct Exchange {
    pub(super) request_id: String,
    pub(super) deadline: Instant,
    pub(super) writer: Arc<Slot<WriterMetadata>>,
    started: Instant,
    session_started: Instant,
    phase_started: Instant,
    operation: ExchangeOperation,
    request_bytes: usize,
    child_pid: Option<u32>,
    allowance: ExchangeAllowance,
    budget: Duration,
    phase: ExchangePhase,
    writer_received: Option<Instant>,
    reader_received: Option<Instant>,
    reader_received_ordinal: Option<u64>,
    reader_correlated_ordinal: Option<u64>,
}

pub(super) struct ExchangeStart {
    pub request_id: String,
    pub operation: ExchangeOperation,
    pub request_bytes: usize,
    pub child_pid: Option<u32>,
    pub allowance: ExchangeAllowance,
    pub budget: Duration,
    pub started: Instant,
    pub session_started: Instant,
}

impl Exchange {
    pub(super) fn new(start: ExchangeStart) -> Self {
        let ExchangeStart {
            request_id,
            operation,
            request_bytes,
            child_pid,
            allowance,
            budget,
            started,
            session_started,
        } = start;
        Self {
            request_id,
            deadline: started + budget,
            writer: Arc::new(Slot::new(WriterMetadata {
                progress: WriterProgress::Queued,
                completed_at_session_ms: None,
            })),
            started,
            session_started,
            phase_started: started,
            operation,
            request_bytes,
            child_pid,
            allowance,
            budget,
            phase: ExchangePhase::WaitWrite,
            writer_received: None,
            reader_received: None,
            reader_received_ordinal: None,
            reader_correlated_ordinal: None,
        }
    }

    pub(super) fn received_write(&mut self) {
        let now = Instant::now();
        self.writer_received = Some(now);
        self.phase_started = now;
        self.phase = ExchangePhase::WaitResponse;
    }

    pub(super) fn received_response(&mut self, ordinal: Option<u64>) {
        self.reader_received = Some(Instant::now());
        self.reader_received_ordinal = ordinal;
    }

    pub(super) fn correlated_response(&mut self) {
        self.reader_correlated_ordinal = self.reader_received_ordinal;
    }

    pub(super) fn snapshot(
        self,
        reader: &ReaderRecorder,
        child: Option<&mut Child>,
    ) -> ExchangeWitness {
        let writer = self.writer.snapshot();
        let reader_produced = reader.snapshot().unwrap_or(ReaderProgress::Unknown);
        let child_status = match child.map(Child::try_wait) {
            Some(Ok(None)) => ExchangeChildStatus::Running,
            Some(Ok(Some(status))) => ExchangeChildStatus::Exited {
                success: status.success(),
                code: status.code(),
            },
            Some(Err(_)) | None => ExchangeChildStatus::Unknown,
        };
        let now = Instant::now();
        ExchangeWitness {
            request_id: self.request_id,
            operation: self.operation,
            request_bytes: self.request_bytes,
            child_pid: self.child_pid,
            allowance: self.allowance,
            budget_ms: millis(self.budget),
            phase: self.phase,
            elapsed_ms: millis(now.saturating_duration_since(self.started)),
            phase_elapsed_ms: millis(now.saturating_duration_since(self.phase_started)),
            remaining_ms: millis(self.deadline.saturating_duration_since(now)),
            captured_at_session_ms: millis(now.saturating_duration_since(self.session_started)),
            writer_produced: writer.map_or(WriterProgress::Unknown, |value| value.progress),
            writer_completed_at_session_ms: writer.and_then(|value| value.completed_at_session_ms),
            writer_completion_received: self.writer_received.is_some(),
            writer_received_at_session_ms: self
                .writer_received
                .map(|at| millis(at.saturating_duration_since(self.session_started))),
            reader_produced,
            reader_received_ordinal: self.reader_received_ordinal,
            reader_received_at_session_ms: self
                .reader_received
                .map(|at| millis(at.saturating_duration_since(self.session_started))),
            reader_correlated_ordinal: self.reader_correlated_ordinal,
            child_status,
        }
    }
}

fn millis(duration: Duration) -> u64 {
    duration.as_millis().try_into().unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending() -> Exchange {
        let started = Instant::now();
        Exchange::new(ExchangeStart {
            request_id: "0".repeat(32),
            operation: ExchangeOperation::Observe,
            request_bytes: 71,
            child_pid: Some(123),
            allowance: ExchangeAllowance::Response,
            budget: Duration::from_millis(100),
            started,
            session_started: started,
        })
    }

    #[test]
    fn produced_events_are_not_received_or_correlated() {
        let exchange = pending();
        let reader = ReaderRecorder::new(ReaderProgress::Available { last_event: None });
        exchange.writer.completed(true, exchange.session_started);
        reader.produced(
            Some(7),
            ReaderEventKind::Line,
            123,
            exchange.session_started,
        );
        let witness = exchange.snapshot(&reader, None);
        assert_eq!(witness.writer_produced, WriterProgress::Flushed);
        assert!(!witness.writer_completion_received);
        assert!(witness.writer_received_at_session_ms.is_none());
        assert!(matches!(
            witness.reader_produced,
            ReaderProgress::Available {
                last_event: Some(ReaderEventMetadata {
                    ordinal: 7,
                    bytes: 123,
                    ..
                })
            }
        ));
        assert_eq!(witness.reader_received_ordinal, None);
        assert_eq!(witness.reader_correlated_ordinal, None);
        assert_eq!(witness.child_status, ExchangeChildStatus::Unknown);
    }

    #[test]
    fn producer_failure_is_not_inferred_as_receipt() {
        let exchange = pending();
        let reader = ReaderRecorder::new(ReaderProgress::Available { last_event: None });
        exchange.writer.completed(false, exchange.session_started);
        let witness = exchange.snapshot(&reader, None);
        assert_eq!(witness.writer_produced, WriterProgress::Failed);
        assert!(witness.writer_completed_at_session_ms.is_some());
        assert!(!witness.writer_completion_received);
        assert!(witness.writer_received_at_session_ms.is_none());
    }

    #[test]
    fn receipt_does_not_claim_correlation_until_validation() {
        let mut exchange = pending();
        exchange.received_write();
        exchange.received_response(Some(7));
        assert_eq!(exchange.reader_received_ordinal, Some(7));
        assert_eq!(exchange.reader_correlated_ordinal, None);
        exchange.correlated_response();
        assert_eq!(exchange.reader_correlated_ordinal, Some(7));
    }

    #[test]
    fn contended_snapshot_is_unknown_and_never_waits() {
        let exchange = pending();
        let writer = Arc::clone(&exchange.writer);
        let reader = ReaderRecorder::new(ReaderProgress::Available { last_event: None });
        let _writer_guard = writer.value.lock().unwrap();
        let _reader_guard = reader.value.lock().unwrap();
        let witness = exchange.snapshot(&reader, None);
        assert_eq!(witness.writer_produced, WriterProgress::Unknown);
        assert_eq!(witness.reader_produced, ReaderProgress::Unknown);
        let value = serde_json::to_value(witness).unwrap();
        assert_eq!(value["writer_produced"], "unknown");
        assert_eq!(value["reader_produced"]["status"], "unknown");
        assert!(value["writer_completed_at_session_ms"].is_null());
    }

    #[test]
    fn missed_publication_does_not_masquerade_as_no_event() {
        let reader = ReaderRecorder::new(ReaderProgress::Available { last_event: None });
        let guard = reader.value.lock().unwrap();
        reader.produced(Some(1), ReaderEventKind::Line, 123, Instant::now());
        drop(guard);
        assert_eq!(reader.snapshot(), None);
        reader.produced(Some(2), ReaderEventKind::Eof, 0, Instant::now());
        assert_eq!(reader.snapshot(), None);
    }

    #[test]
    fn poisoned_metadata_is_unknown_not_a_protocol_failure() {
        let reader = ReaderRecorder::new(ReaderProgress::Available { last_event: None });
        let _ = std::panic::catch_unwind(|| {
            let _guard = reader.value.lock().unwrap();
            panic!("poison metadata only");
        });
        reader.produced(Some(1), ReaderEventKind::Io, 0, Instant::now());
        assert_eq!(reader.snapshot(), None);
    }
}
