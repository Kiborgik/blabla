use super::packet::{ExpertPacket, bounded};
use super::{ExpertLimits, ExpertMode};
use crate::memory::knowledge::{Judgment, JudgmentOutput};
use crate::runtime::process_tree::{self, ProcessTree};
use crate::runtime::strict_json::StrictValue;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

pub const PROBABILITY_TOLERANCE: f64 = 1e-3;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputKind {
    Choice,
    Noul,
    Score,
}

impl From<&JudgmentOutput> for OutputKind {
    fn from(output: &JudgmentOutput) -> Self {
        match output {
            JudgmentOutput::Choice { .. } => Self::Choice,
            JudgmentOutput::Noul { .. } => Self::Noul,
            JudgmentOutput::Score { .. } => Self::Score,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderIdentity {
    pub provider: String,
    pub model: String,
    pub checkpoint: String,
    pub supported_outputs: Vec<OutputKind>,
    pub probabilities: bool,
    pub certification: Option<String>,
}

impl ProviderIdentity {
    pub fn require_mode(&self, mode: ExpertMode) -> Result<(), ProviderFailure> {
        if mode != ExpertMode::Off
            && (!valid_identity(self)
                || (mode == ExpertMode::Advisory
                    && self
                        .certification
                        .as_ref()
                        .is_none_or(|value| value.trim().is_empty())))
        {
            Err(ProviderFailure::Unverified)
        } else {
            Ok(())
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TypedAnswer {
    Choice {
        pick: String,
        probabilities: Option<BTreeMap<String, f64>>,
        confidence: Option<f64>,
    },
    Noul {
        value: Option<bool>,
        probability: Option<f64>,
        confidence: Option<f64>,
    },
    Score {
        level: Option<String>,
        distribution: Option<Vec<f64>>,
        expectation: Option<f64>,
        confidence: Option<f64>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderFailure {
    Unsupported,
    Unverified,
    Timeout,
    Cancelled,
    Transport,
    Malformed,
    IdentityMismatch,
}

impl std::fmt::Display for ProviderFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Unsupported => "unsupported",
            Self::Unverified => "unverified",
            Self::Timeout => "timeout",
            Self::Cancelled => "cancelled",
            Self::Transport => "transport",
            Self::Malformed => "malformed",
            Self::IdentityMismatch => "identity_mismatch",
        })
    }
}
impl std::error::Error for ProviderFailure {}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvaluationRequest {
    pub request_id: String,
    pub packet: ExpertPacket,
    pub judgment: Judgment,
    pub question_fingerprint: String,
    pub template_fingerprint: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvaluationBatchRequest {
    pub batch_id: String,
    pub requests: Vec<EvaluationRequest>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvaluationTiming {
    pub queue_ms: u64,
    pub inference_ms: u64,
    pub total_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderUsage {
    pub input_tokens: Option<usize>,
    pub output_tokens: Option<usize>,
    pub reported_latency_ms: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvaluationResponse {
    pub request_id: String,
    pub packet_hash: String,
    pub question_fingerprint: String,
    pub template_fingerprint: String,
    pub provider: ProviderIdentity,
    pub timing: EvaluationTiming,
    pub usage: ProviderUsage,
    pub provider_request_id: Option<String>,
    pub self_report: Option<String>,
    pub diagnostic: Option<String>,
    pub outcome: Result<TypedAnswer, ProviderFailure>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvaluationBatchResponse {
    pub batch_id: String,
    pub responses: Vec<EvaluationResponse>,
}

fn valid_identity(identity: &ProviderIdentity) -> bool {
    [&identity.provider, &identity.model, &identity.checkpoint]
        .iter()
        .all(|value| !value.trim().is_empty() && value.len() <= 256)
        && !identity.supported_outputs.is_empty()
        && identity.supported_outputs.len() <= 3
        && identity
            .supported_outputs
            .iter()
            .enumerate()
            .all(|(index, output)| !identity.supported_outputs[..index].contains(output))
        && identity
            .certification
            .as_ref()
            .is_none_or(|value| value.len() <= 2048)
}

fn unit(value: f64) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}
fn normalized(values: impl IntoIterator<Item = f64>) -> bool {
    let values: Vec<_> = values.into_iter().collect();
    !values.is_empty()
        && values.iter().copied().all(unit)
        && (values.iter().sum::<f64>() - 1.0).abs() <= PROBABILITY_TOLERANCE
}

fn valid_answer(judgment: &Judgment, answer: &TypedAnswer, probabilities: bool) -> bool {
    match (&judgment.output, answer) {
        (
            JudgmentOutput::Choice { alternatives },
            TypedAnswer::Choice {
                pick,
                probabilities: values,
                confidence,
            },
        ) => {
            alternatives.len() >= 2
                && alternatives.iter().collect::<BTreeSet<_>>().len() == alternatives.len()
                && alternatives.contains(pick)
                && confidence.is_none_or(unit)
                && (probabilities || (values.is_none() && confidence.is_none()))
                && values.as_ref().is_none_or(|values| {
                    values.keys().collect::<BTreeSet<_>>()
                        == alternatives.iter().collect::<BTreeSet<_>>()
                        && normalized(values.values().copied())
                })
        }
        (
            JudgmentOutput::Noul { proposition },
            TypedAnswer::Noul {
                value,
                probability,
                confidence,
            },
        ) => {
            !proposition.trim().is_empty()
                && (value.is_some() || probability.is_some())
                && probability.is_none_or(unit)
                && confidence.is_none_or(unit)
                && (probabilities || (probability.is_none() && confidence.is_none()))
        }
        (
            JudgmentOutput::Score { levels },
            TypedAnswer::Score {
                level,
                distribution,
                expectation,
                confidence,
            },
        ) => {
            levels.len() >= 2
                && levels.iter().collect::<BTreeSet<_>>().len() == levels.len()
                && (level.is_some() || distribution.is_some())
                && level.as_ref().is_none_or(|value| levels.contains(value))
                && confidence.is_none_or(unit)
                && (probabilities
                    || (distribution.is_none() && expectation.is_none() && confidence.is_none()))
                && expectation.is_none_or(|value| {
                    value.is_finite() && value >= 0.0 && value <= (levels.len() - 1) as f64
                })
                && (expectation.is_none() || distribution.is_some())
                && distribution.as_ref().is_none_or(|values| {
                    values.len() == levels.len()
                        && normalized(values.iter().copied())
                        && expectation.is_none_or(|expected| {
                            (expected
                                - values
                                    .iter()
                                    .enumerate()
                                    .map(|(index, value)| index as f64 * value)
                                    .sum::<f64>())
                            .abs()
                                <= PROBABILITY_TOLERANCE
                        })
                })
        }
        _ => false,
    }
}

pub fn validate_response(
    request: &EvaluationRequest,
    response: EvaluationResponse,
) -> Result<EvaluationResponse, ProviderFailure> {
    if request.request_id != response.request_id
        || request.packet.hash != response.packet_hash
        || request.question_fingerprint != response.question_fingerprint
        || request.template_fingerprint != response.template_fingerprint
    {
        return Err(ProviderFailure::IdentityMismatch);
    }
    if !valid_identity(&response.provider)
        || response
            .self_report
            .as_ref()
            .is_some_and(|value| value.len() > 2048)
        || response
            .diagnostic
            .as_ref()
            .is_some_and(|value| value.len() > 2048)
        || response
            .provider_request_id
            .as_ref()
            .is_some_and(|value| value.len() > 2048)
        || response
            .usage
            .reported_latency_ms
            .is_some_and(|value| !value.is_finite() || value < 0.0)
        || response.timing.inference_ms > response.timing.total_ms
        || response.timing.queue_ms > response.timing.total_ms
    {
        return Err(ProviderFailure::Malformed);
    }
    if let Ok(answer) = &response.outcome {
        if !response
            .provider
            .supported_outputs
            .contains(&OutputKind::from(&request.judgment.output))
        {
            return Err(ProviderFailure::Unsupported);
        }
        if !valid_answer(&request.judgment, answer, response.provider.probabilities) {
            return Err(ProviderFailure::Malformed);
        }
    }
    Ok(response)
}

pub fn validate_batch(batch: &EvaluationBatchRequest) -> Result<(), ProviderFailure> {
    if batch.batch_id.trim().is_empty()
        || batch.batch_id.len() > 256
        || !(1..=4).contains(&batch.requests.len())
    {
        return Err(ProviderFailure::Malformed);
    }
    let mut ids = BTreeSet::new();
    let first = &batch.requests[0].packet;
    for request in &batch.requests {
        let packet = &request.packet;
        if request.request_id.trim().is_empty()
            || request.request_id.len() > 256
            || !ids.insert(&request.request_id)
            || packet.event != first.event
            || packet.revision != first.revision
            || packet.context != first.context
            || packet.references != first.references
            || packet.history != first.history
        {
            return Err(ProviderFailure::Malformed);
        }
    }
    Ok(())
}

pub fn failure_response(
    request: &EvaluationRequest,
    identity: &ProviderIdentity,
    failure: ProviderFailure,
    diagnostic: Option<String>,
) -> EvaluationResponse {
    EvaluationResponse {
        request_id: request.request_id.clone(),
        packet_hash: request.packet.hash.clone(),
        question_fingerprint: request.question_fingerprint.clone(),
        template_fingerprint: request.template_fingerprint.clone(),
        provider: identity.clone(),
        timing: EvaluationTiming {
            queue_ms: 0,
            inference_ms: 0,
            total_ms: 0,
        },
        usage: ProviderUsage {
            input_tokens: None,
            output_tokens: None,
            reported_latency_ms: None,
        },
        provider_request_id: None,
        self_report: None,
        diagnostic: diagnostic.map(|value| bounded(&value, 2048).0),
        outcome: Err(failure),
    }
}

pub trait ExpertProvider {
    fn evaluate(
        &mut self,
        request: &EvaluationRequest,
        deadline: Instant,
        cancelled: &AtomicBool,
    ) -> EvaluationResponse;
    fn evaluate_batch(
        &mut self,
        batch: &EvaluationBatchRequest,
        deadline: Instant,
        cancelled: &AtomicBool,
    ) -> EvaluationBatchResponse {
        let unavailable = ProviderIdentity {
            provider: "unavailable".into(),
            model: "unavailable".into(),
            checkpoint: "unavailable".into(),
            supported_outputs: vec![OutputKind::Choice, OutputKind::Noul, OutputKind::Score],
            probabilities: false,
            certification: None,
        };
        if let Err(error) = validate_batch(batch) {
            return batch_failure(batch, &unavailable, error, None);
        }
        let responses = batch
            .requests
            .iter()
            .map(|request| {
                if let Err(error) = interrupted(deadline, cancelled) {
                    return failure_response(request, &unavailable, error, None);
                }
                let response = self.evaluate(request, deadline, cancelled);
                let identity = response.provider.clone();
                match interrupted(deadline, cancelled)
                    .and_then(|_| validate_response(request, response))
                {
                    Ok(response) => response,
                    Err(error) => failure_response(request, &identity, error, None),
                }
            })
            .collect();
        EvaluationBatchResponse {
            batch_id: batch.batch_id.clone(),
            responses,
        }
    }
}

pub struct FakeProvider {
    identity: ProviderIdentity,
    outcomes: VecDeque<Result<TypedAnswer, ProviderFailure>>,
}
impl FakeProvider {
    pub fn new(
        identity: ProviderIdentity,
        outcomes: Vec<Result<TypedAnswer, ProviderFailure>>,
    ) -> Self {
        Self {
            identity,
            outcomes: outcomes.into(),
        }
    }
}
impl ExpertProvider for FakeProvider {
    fn evaluate(
        &mut self,
        request: &EvaluationRequest,
        deadline: Instant,
        cancelled: &AtomicBool,
    ) -> EvaluationResponse {
        let mut response =
            failure_response(request, &self.identity, ProviderFailure::Unsupported, None);
        response.outcome = if cancelled.load(Ordering::Acquire) {
            Err(ProviderFailure::Cancelled)
        } else if Instant::now() >= deadline {
            Err(ProviderFailure::Timeout)
        } else {
            self.outcomes
                .pop_front()
                .unwrap_or(Err(ProviderFailure::Unsupported))
        };
        match validate_response(request, response) {
            Ok(response) => response,
            Err(error) => failure_response(request, &self.identity, error, None),
        }
    }
    fn evaluate_batch(
        &mut self,
        batch: &EvaluationBatchRequest,
        deadline: Instant,
        cancelled: &AtomicBool,
    ) -> EvaluationBatchResponse {
        if let Err(error) = validate_batch(batch) {
            return batch_failure(batch, &self.identity, error, None);
        }
        EvaluationBatchResponse {
            batch_id: batch.batch_id.clone(),
            responses: batch
                .requests
                .iter()
                .map(|request| self.evaluate(request, deadline, cancelled))
                .collect(),
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum CommandRequest<'a> {
    Single { request: &'a EvaluationRequest },
    Batch { batch: &'a EvaluationBatchRequest },
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum CommandResponse {
    Single { response: Box<EvaluationResponse> },
    Batch { batch: EvaluationBatchResponse },
}

pub struct CommandProvider {
    argv: Vec<String>,
    identity: ProviderIdentity,
    limits: ExpertLimits,
}
impl CommandProvider {
    pub fn new(
        argv: Vec<String>,
        identity: ProviderIdentity,
        limits: ExpertLimits,
    ) -> Result<Self, ProviderFailure> {
        if argv.is_empty()
            || argv.iter().any(|value| value.contains('\0'))
            || argv[0].is_empty()
            || !valid_identity(&identity)
            || limits.concurrency != 1
            || limits.retries > 1
            || limits.request_timeout_ms == 0
            || limits.packet_bytes == 0
            || limits.excerpt_bytes == 0
        {
            return Err(ProviderFailure::Malformed);
        }
        Ok(Self {
            argv,
            identity,
            limits,
        })
    }

    fn exchange(
        &self,
        request: &CommandRequest<'_>,
        deadline: Instant,
        cancelled: &AtomicBool,
    ) -> Result<CommandResponse, (ProviderFailure, Option<String>)> {
        let mut bytes =
            serde_json::to_vec(request).map_err(|_| (ProviderFailure::Malformed, None))?;
        let limit = self.limits.packet_bytes.saturating_mul(4);
        if bytes.len() >= limit {
            return Err((ProviderFailure::Malformed, None));
        }
        bytes.push(b'\n');
        let started = Instant::now();
        let deadline = deadline.min(
            started
                .checked_add(Duration::from_millis(self.limits.request_timeout_ms))
                .unwrap_or(deadline),
        );
        for attempt in 0..=self.limits.retries {
            let result = self.attempt(bytes.clone(), limit, deadline, cancelled);
            match result {
                Err((ProviderFailure::Transport, _))
                    if attempt == 0
                        && self.limits.retries == 1
                        && Instant::now() < deadline
                        && !cancelled.load(Ordering::Acquire) =>
                {
                    continue;
                }
                result => return result,
            }
        }
        Err((ProviderFailure::Transport, None))
    }

    fn attempt(
        &self,
        bytes: Vec<u8>,
        output_limit: usize,
        deadline: Instant,
        cancelled: &AtomicBool,
    ) -> Result<CommandResponse, (ProviderFailure, Option<String>)> {
        interrupted(deadline, cancelled).map_err(|error| (error, None))?;
        let mut command = Command::new(&self.argv[0]);
        command
            .args(&self.argv[1..])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        process_tree::configure(&mut command);
        let mut child = command
            .spawn()
            .map_err(|_| (ProviderFailure::Transport, None))?;
        let tree = match ProcessTree::attach(&mut child) {
            Ok(tree) => tree,
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err((ProviderFailure::Transport, None));
            }
        };
        let mut session = ProviderProcess { child, tree };
        let mut stdin = session
            .child
            .stdin
            .take()
            .ok_or((ProviderFailure::Transport, None))?;
        let stdout = session
            .child
            .stdout
            .take()
            .ok_or((ProviderFailure::Transport, None))?;
        let stderr = session
            .child
            .stderr
            .take()
            .ok_or((ProviderFailure::Transport, None))?;
        let (sender, receiver) = mpsc::channel();
        let writer = sender.clone();
        thread::spawn(move || {
            let result = stdin
                .write_all(&bytes)
                .and_then(|_| stdin.flush())
                .map(|_| Vec::new())
                .map_err(|_| ProviderFailure::Transport);
            let _ = writer.send((0, result));
        });
        for (channel, pipe, limit) in [
            (1, Box::new(stdout) as Box<dyn Read + Send>, output_limit),
            (
                2,
                Box::new(stderr) as Box<dyn Read + Send>,
                self.limits.excerpt_bytes,
            ),
        ] {
            let sender = sender.clone();
            thread::spawn(move || {
                let _ = sender.send((channel, read_bounded(pipe, limit)));
            });
        }
        drop(sender);
        let mut output = None;
        let mut diagnostic = None;
        let mut done = [false; 3];
        loop {
            interrupted(deadline, cancelled).map_err(|error| (error, diagnostic.clone()))?;
            match receiver.recv_timeout(
                deadline
                    .saturating_duration_since(Instant::now())
                    .min(Duration::from_millis(5)),
            ) {
                Ok((channel, result)) => {
                    done[channel] = true;
                    let bytes = result.map_err(|error| (error, diagnostic.clone()))?;
                    if channel == 1 {
                        output = Some(bytes);
                    } else if channel == 2 && !bytes.is_empty() {
                        diagnostic = Some(
                            bounded(&String::from_utf8_lossy(&bytes), self.limits.excerpt_bytes).0,
                        );
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) if !done.iter().all(|done| *done) => {
                    return Err((ProviderFailure::Transport, diagnostic));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    thread::sleep(Duration::from_millis(1));
                }
            }
            let status = session
                .child
                .try_wait()
                .map_err(|_| (ProviderFailure::Transport, diagnostic.clone()))?;
            if done.iter().all(|done| *done)
                && let Some(status) = status
            {
                interrupted(deadline, cancelled).map_err(|error| (error, diagnostic.clone()))?;
                let bytes = output.ok_or((ProviderFailure::Transport, diagnostic.clone()))?;
                if bytes.is_empty() && !status.success() {
                    return Err((ProviderFailure::Transport, diagnostic));
                }
                if !bytes.ends_with(b"\n")
                    || bytes.iter().filter(|byte| **byte == b'\n').count() != 1
                {
                    return Err((ProviderFailure::Malformed, diagnostic));
                }
                let StrictValue(value) = serde_json::from_slice::<StrictValue>(&bytes)
                    .map_err(|_| (ProviderFailure::Malformed, diagnostic.clone()))?;
                let response = serde_json::from_value(value)
                    .map_err(|_| (ProviderFailure::Malformed, diagnostic.clone()))?;
                if !status.success() {
                    return Err((ProviderFailure::Transport, diagnostic));
                }
                return Ok(response);
            }
        }
    }

    fn checked(
        &self,
        request: &EvaluationRequest,
        response: EvaluationResponse,
        deadline: Instant,
        cancelled: &AtomicBool,
    ) -> EvaluationResponse {
        let result = interrupted(deadline, cancelled).and_then(|_| {
            if response.provider != self.identity {
                Err(ProviderFailure::IdentityMismatch)
            } else {
                validate_response(request, response)
            }
        });
        match result {
            Ok(response) => response,
            Err(error) => failure_response(request, &self.identity, error, None),
        }
    }
}

impl ExpertProvider for CommandProvider {
    fn evaluate(
        &mut self,
        request: &EvaluationRequest,
        deadline: Instant,
        cancelled: &AtomicBool,
    ) -> EvaluationResponse {
        let started = Instant::now();
        let deadline = deadline.min(
            started
                .checked_add(Duration::from_millis(self.limits.request_timeout_ms))
                .unwrap_or(deadline),
        );
        let result = self.exchange(&CommandRequest::Single { request }, deadline, cancelled);
        let mut response = match result {
            Ok(CommandResponse::Single { response }) => {
                self.checked(request, *response, deadline, cancelled)
            }
            Ok(_) => failure_response(request, &self.identity, ProviderFailure::Malformed, None),
            Err((failure, diagnostic)) => {
                failure_response(request, &self.identity, failure, diagnostic)
            }
        };
        response.timing = elapsed_timing(started);
        response
    }
    fn evaluate_batch(
        &mut self,
        batch: &EvaluationBatchRequest,
        deadline: Instant,
        cancelled: &AtomicBool,
    ) -> EvaluationBatchResponse {
        let started = Instant::now();
        let deadline = deadline.min(
            started
                .checked_add(Duration::from_millis(self.limits.request_timeout_ms))
                .unwrap_or(deadline),
        );
        if let Err(error) = validate_batch(batch) {
            return batch_failure(batch, &self.identity, error, None);
        }
        let result = self.exchange(&CommandRequest::Batch { batch }, deadline, cancelled);
        let mut response = match result {
            Ok(CommandResponse::Batch { batch: response }) => {
                let response_ids: BTreeSet<_> = response
                    .responses
                    .iter()
                    .map(|response| &response.request_id)
                    .collect();
                let request_ids: BTreeSet<_> = batch
                    .requests
                    .iter()
                    .map(|request| &request.request_id)
                    .collect();
                if response.batch_id != batch.batch_id
                    || response.responses.len() != batch.requests.len()
                    || response_ids != request_ids
                {
                    return batch_failure(
                        batch,
                        &self.identity,
                        ProviderFailure::IdentityMismatch,
                        None,
                    );
                }
                let mut responses: BTreeMap<_, _> = response
                    .responses
                    .into_iter()
                    .map(|response| (response.request_id.clone(), response))
                    .collect();
                EvaluationBatchResponse {
                    batch_id: batch.batch_id.clone(),
                    responses: batch
                        .requests
                        .iter()
                        .map(|request| {
                            self.checked(
                                request,
                                responses
                                    .remove(&request.request_id)
                                    .expect("response identity checked"),
                                deadline,
                                cancelled,
                            )
                        })
                        .collect(),
                }
            }
            Ok(_) => batch_failure(batch, &self.identity, ProviderFailure::Malformed, None),
            Err((error, diagnostic)) => batch_failure(batch, &self.identity, error, diagnostic),
        };
        for result in &mut response.responses {
            result.timing = elapsed_timing(started);
        }
        response
    }
}

fn elapsed_timing(started: Instant) -> EvaluationTiming {
    let elapsed = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
    EvaluationTiming {
        queue_ms: 0,
        inference_ms: elapsed,
        total_ms: elapsed,
    }
}

fn batch_failure(
    batch: &EvaluationBatchRequest,
    identity: &ProviderIdentity,
    error: ProviderFailure,
    diagnostic: Option<String>,
) -> EvaluationBatchResponse {
    EvaluationBatchResponse {
        batch_id: batch.batch_id.clone(),
        responses: batch
            .requests
            .iter()
            .map(|request| failure_response(request, identity, error, diagnostic.clone()))
            .collect(),
    }
}
fn interrupted(deadline: Instant, cancelled: &AtomicBool) -> Result<(), ProviderFailure> {
    if cancelled.load(Ordering::Acquire) {
        Err(ProviderFailure::Cancelled)
    } else if Instant::now() >= deadline {
        Err(ProviderFailure::Timeout)
    } else {
        Ok(())
    }
}
fn read_bounded(mut pipe: Box<dyn Read + Send>, limit: usize) -> Result<Vec<u8>, ProviderFailure> {
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let count = pipe
            .read(&mut buffer)
            .map_err(|_| ProviderFailure::Transport)?;
        if count == 0 {
            return Ok(bytes);
        }
        if bytes.len().saturating_add(count) > limit {
            return Err(ProviderFailure::Malformed);
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
}
struct ProviderProcess {
    child: Child,
    tree: ProcessTree,
}
impl ProviderProcess {
    fn reap_terminated_tree(&self, child_exited: bool) -> bool {
        if !child_exited {
            return false;
        }
        self.tree.reap_descendants();
        self.tree.is_empty().unwrap_or(false)
    }
}
impl Drop for ProviderProcess {
    fn drop(&mut self) {
        self.tree.terminate();
        let _ = self.child.kill();
        let deadline = Instant::now() + Duration::from_millis(250);
        let mut exited = false;
        loop {
            if !exited {
                exited = self.child.try_wait().ok().flatten().is_some();
            }
            if self.reap_terminated_tree(exited) || Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(1));
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn descendant_reaping_preserves_unobserved_direct_child_exit() {
        let mut command = Command::new("sh");
        command.args(["-c", "exit 17"]);
        process_tree::configure(&mut command);
        let mut child = command.spawn().unwrap();
        let tree = ProcessTree::attach(&mut child).unwrap();
        let mut process = ProviderProcess { child, tree };
        let mut status = std::mem::MaybeUninit::<libc::siginfo_t>::uninit();
        assert_eq!(
            unsafe {
                libc::waitid(
                    libc::P_PID,
                    process.child.id(),
                    status.as_mut_ptr(),
                    libc::WEXITED | libc::WNOWAIT,
                )
            },
            0
        );

        assert!(!process.reap_terminated_tree(false));
        assert_eq!(process.child.try_wait().unwrap().unwrap().code(), Some(17));
        assert!(process.reap_terminated_tree(true));
    }
}
