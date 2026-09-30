use super::{emit_error, error, project as project_cli, write_json};
use blabla::expert::packet::{self};
use blabla::expert::policy::{self, AdvisoryOutcome, ExpertResult, PolicySettings};
use blabla::expert::provider::{
    self, CommandProvider, EvaluationBatchRequest, EvaluationRequest, EvaluationResponse,
    ExpertProvider, OutputKind, ProviderFailure, ProviderIdentity,
};
use blabla::expert::trace::{
    self, ExpertisePair, Provenance, RuntimeConfig, TraceError, TraceLimits, TraceRecord,
    TraceStore,
};
use blabla::expert::{DeliveryState, ExpertMode, ObservedEvent};
use blabla::project::{Project, task};
use clap::Subcommand;
use serde::Serialize;
use std::io::{self, BufRead, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

#[derive(Subcommand)]
pub(super) enum Action {
    Evaluate {
        #[arg(long)]
        config: Option<PathBuf>,
        #[arg(long, num_args = 1..)]
        provider_command: Vec<String>,
    },
    Checkpoint {
        #[arg(long)]
        event: PathBuf,
        #[arg(long)]
        config: PathBuf,
    },
    Delivery {
        request_id: String,
        #[arg(long)]
        checkpoint: String,
    },
    Receipt {
        request_id: String,
        #[arg(long, value_parser = parse_state)]
        state: DeliveryState,
        #[arg(long)]
        evidence: String,
    },
    Replay {
        trace: PathBuf,
    },
    Reevaluate {
        trace: PathBuf,
        #[arg(long)]
        config: Option<PathBuf>,
        #[arg(long, num_args = 1..)]
        provider_command: Vec<String>,
    },
    Traces {
        #[command(subcommand)]
        action: Option<TraceAction>,
    },
    Cleanup {
        #[arg(long)]
        task: String,
    },
}

#[derive(Subcommand)]
pub(super) enum TraceAction {
    Delete { run_id: String },
}

fn parse_state(value: &str) -> Result<DeliveryState, String> {
    match value {
        "proposed" => Ok(DeliveryState::Proposed),
        "delivered" => Ok(DeliveryState::Delivered),
        "acknowledged" => Ok(DeliveryState::Acknowledged),
        "declined" => Ok(DeliveryState::Declined),
        "stale" => Ok(DeliveryState::Stale),
        "observed_resolved" => Ok(DeliveryState::ObservedResolved),
        "unknown" => Ok(DeliveryState::Unknown),
        _ => Err("unknown delivery state".into()),
    }
}

fn fail(error_value: TraceError, json: bool) -> i32 {
    emit_error(
        error("expert", error_value.to_string(), None),
        json,
        if error_value == TraceError::Io { 4 } else { 2 },
    )
}

fn emit(value: &impl Serialize, json: bool) -> i32 {
    let result = if json {
        write_json(value)
    } else {
        serde_json::to_string_pretty(value)
            .map_err(io::Error::other)
            .and_then(|text| {
                use std::io::Write;
                writeln!(io::stdout().lock(), "{text}")
            })
    };
    if result.is_ok() { 0 } else { 4 }
}

fn load_config(path: Option<&Path>) -> Result<RuntimeConfig, TraceError> {
    let config = match path {
        Some(path) => trace::read_json(path, trace::MAX_CONFIG_BYTES)?,
        None => RuntimeConfig::default(),
    };
    config.validate()?;
    Ok(config)
}

fn settings<'a>(
    config: &'a RuntimeConfig,
    request: &EvaluationRequest,
) -> Option<&'a PolicySettings> {
    config
        .policies
        .iter()
        .find(|settings| settings.binding_id == request.packet.binding_id)
}

fn unverified_identity(request: &EvaluationRequest) -> ProviderIdentity {
    ProviderIdentity {
        provider: "unverified".into(),
        model: "unknown".into(),
        checkpoint: "unknown".into(),
        supported_outputs: vec![OutputKind::from(&request.judgment.output)],
        probabilities: false,
        certification: None,
    }
}

fn evaluate_request(
    request: &EvaluationRequest,
    config: &RuntimeConfig,
    command: &[String],
) -> EvaluationResponse {
    if trace::validate_selected(request).is_err() {
        return provider::failure_response(
            request,
            &unverified_identity(request),
            ProviderFailure::Malformed,
            None,
        );
    }
    let Some(configured) = &config.provider else {
        return provider::failure_response(
            request,
            &unverified_identity(request),
            ProviderFailure::Unverified,
            None,
        );
    };
    if config.mode == ExpertMode::Off {
        return provider::failure_response(
            request,
            &configured.identity,
            ProviderFailure::Cancelled,
            None,
        );
    }
    let argv = if command.is_empty() {
        configured.argv.clone()
    } else {
        command.to_vec()
    };
    let mut provider =
        match CommandProvider::new(argv, configured.identity.clone(), config.limits.clone()) {
            Ok(provider) => provider,
            Err(failure) => {
                return provider::failure_response(request, &configured.identity, failure, None);
            }
        };
    provider.evaluate(
        request,
        Instant::now() + Duration::from_millis(config.limits.request_timeout_ms),
        &AtomicBool::new(false),
    )
}

#[derive(Serialize)]
struct Evaluated {
    response: EvaluationResponse,
    result: ExpertResult,
    provenance: Provenance,
    mode: ExpertMode,
}

fn evaluate_lines(config: &RuntimeConfig, command: &[String], json: bool) -> i32 {
    let mut input = io::stdin().lock();
    let mut total = 0usize;
    let mut lines = 0usize;
    loop {
        let mut line = Vec::new();
        let read = match input
            .by_ref()
            .take((trace::MAX_EVENT_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)
        {
            Ok(read) => read,
            Err(_) => return fail(TraceError::Io, json),
        };
        if read == 0 {
            return 0;
        }
        lines += 1;
        total = total.saturating_add(read);
        if line.len() > trace::MAX_EVENT_BYTES
            || total > 1_048_576
            || lines > 64
            || line.last() != Some(&b'\n')
        {
            return fail(TraceError::LimitExceeded, json);
        }
        let request: EvaluationRequest = match trace::decode_json(&line, trace::MAX_EVENT_BYTES) {
            Ok(request) => request,
            Err(error) => return fail(error, json),
        };
        if trace::validate_selected(&request).is_err()
            || packet::validate_packet(&request.packet, &request.judgment, &config.limits).is_err()
            || request.question_fingerprint != policy::question_fingerprint(&request.judgment)
            || request.template_fingerprint != policy::template_fingerprint(&request.judgment)
        {
            return fail(TraceError::InvalidInput, json);
        }
        let response = evaluate_request(&request, config, command);
        let result = settings(config, &request)
            .map(|settings| policy::decide(&request, &response, settings, &request.packet.history))
            .unwrap_or_else(|| {
                policy::outcome(&request, AdvisoryOutcome::Abstain, "missing_policy")
            });
        let exit = emit(
            &Evaluated {
                response,
                result,
                provenance: Provenance::Imported,
                mode: if config.mode == ExpertMode::Off {
                    ExpertMode::Off
                } else {
                    ExpertMode::Shadow
                },
            },
            json,
        );
        if exit != 0 {
            return exit;
        }
    }
}

struct CheckpointOutput {
    mode: ExpertMode,
    provider_calls: usize,
    results: Vec<CheckpointResult>,
    usage: provider::ProviderUsage,
}
struct CheckpointResult {
    binding_id: String,
    request_id: Option<String>,
    reason: Option<String>,
}
impl Serialize for CheckpointOutput {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let ids = self
            .results
            .iter()
            .filter_map(|result| result.request_id.as_ref())
            .collect::<Vec<_>>();
        let mut output = serializer.serialize_struct("CheckpointCapture", 7)?;
        output.serialize_field("mode", &self.mode)?;
        output.serialize_field(
            "capture_status",
            if self.mode == ExpertMode::Off {
                "disabled"
            } else if ids.is_empty() {
                "abstained"
            } else {
                "captured"
            },
        )?;
        output.serialize_field("provider_calls", &self.provider_calls)?;
        output.serialize_field("proposal_ids", &ids)?;
        output.serialize_field("captured", &ids.len())?;
        output.serialize_field(
            "omitted_evaluations",
            &self
                .results
                .iter()
                .filter(|result| result.request_id.is_none())
                .count(),
        )?;
        output.serialize_field("usage", &self.usage)?;
        output.end()
    }
}

fn request_id(event: &ObservedEvent, binding: &str) -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "request-{}",
        packet::digest(&(
            &event.run_id,
            &event.event_id,
            &event.task,
            binding,
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
    )
}

fn checkpoint(project: &Project, event_path: &Path, config: &RuntimeConfig, json: bool) -> i32 {
    let store = match TraceStore::new(&project.manifest.root, config.trace_limits.clone()) {
        Ok(store) => store,
        Err(error) => return fail(error, json),
    };
    if let Err(error) = store.set_runtime(config) {
        return fail(error, json);
    }
    if config.mode == ExpertMode::Off {
        return emit(
            &CheckpointOutput {
                mode: ExpertMode::Off,
                provider_calls: 0,
                results: vec![],
                usage: provider::ProviderUsage {
                    input_tokens: Some(0),
                    output_tokens: Some(0),
                    reported_latency_ms: Some(0.0),
                },
            },
            json,
        );
    }
    let event: ObservedEvent = match trace::read_json(event_path, trace::MAX_EVENT_BYTES) {
        Ok(event) => event,
        Err(error) => return fail(error, json),
    };
    if let Err(error) = trace::validate_event_structure(&event) {
        return fail(error, json);
    }
    if !event.host.gaps.is_empty()
        || matches!(
            packet::validate_event(&blabla::expert::EventStamp::from(&event)),
            Err(packet::PacketError::SequenceGap)
        )
    {
        let reason = if event.host.gaps.is_empty() {
            "event_sequence_gap"
        } else {
            "host_observation_gaps"
        };
        if let Err(error) = store.capture(&event, None, reason) {
            return fail(error, json);
        }
        return emit(
            &serde_json::json!({"mode":"shadow","capture_status":"abstained","provider_calls":0,"proposal_ids":[],"captured":1,"omitted_evaluations":0,"observation_gaps":event.host.gaps}),
            json,
        );
    }
    if let Err(error) = store.advance_checkpoint(&event) {
        if matches!(error, TraceError::LedgerExhausted | TraceError::Stale) {
            let reason = if error == TraceError::LedgerExhausted {
                "ledger_exhausted"
            } else {
                "stale_checkpoint"
            };
            if let Err(error) = store.capture(&event, None, reason) {
                return fail(error, json);
            }
            return emit(
                &serde_json::json!({"mode":"shadow","capture_status":"abstained","provider_calls":0,"proposal_ids":[],"captured":1,"omitted_evaluations":0}),
                json,
            );
        }
        return fail(error, json);
    }
    let Some(task_name) = event.task.strip_prefix("task::") else {
        return fail(TraceError::InvalidInput, json);
    };
    let task = match task::read(&project.manifest.root, task_name) {
        Ok(Some(task)) => task,
        Ok(None) => return fail(TraceError::Missing, json),
        Err(_) => return fail(TraceError::Io, json),
    };
    if task.state != "accepted" {
        return emit(
            &CheckpointOutput {
                mode: ExpertMode::Shadow,
                provider_calls: 0,
                results: vec![CheckpointResult {
                    binding_id: String::new(),
                    request_id: None,
                    reason: Some("task_not_accepted".into()),
                }],
                usage: provider::ProviderUsage {
                    input_tokens: Some(0),
                    output_tokens: Some(0),
                    reported_latency_ms: Some(0.0),
                },
            },
            json,
        );
    }
    let (judgments, mut bindings) = match trace::definitions(project) {
        Ok(definitions) => definitions,
        Err(error) => return fail(error, json),
    };
    bindings.retain(|binding| {
        binding
            .roles
            .iter()
            .any(|role| role.trim_start_matches("role::") == task.role.trim_start_matches("role::"))
            && binding.checkpoints.contains(&event.kind)
    });
    bindings.sort_by(|a, b| {
        let priority = |binding: &blabla::memory::process::JudgmentBinding| {
            config
                .policies
                .iter()
                .find(|settings| settings.binding_id == binding.id())
                .map_or(policy::ConcernKind::Expertise, |settings| settings.concern)
        };
        (priority(a), a.id()).cmp(&(priority(b), b.id()))
    });
    let history = match store.history(&event.task, task.acceptance_epoch) {
        Ok(history) => history,
        Err(error) => return fail(error, json),
    };
    let mut requests = Vec::new();
    let mut results = Vec::new();
    for binding in &bindings {
        let Some(judgment) = judgments
            .iter()
            .find(|judgment| judgment.id() == binding.judgment)
        else {
            return fail(TraceError::InvalidInput, json);
        };
        if requests.len() >= config.limits.judgments_per_checkpoint {
            results.push(CheckpointResult {
                binding_id: binding.id(),
                request_id: None,
                reason: Some("judgment_budget".into()),
            });
            continue;
        }
        let packet = match blabla::project::expert::build_packet(
            project,
            &task,
            &event,
            binding,
            &config.limits,
            &history,
        ) {
            Ok(packet) => packet,
            Err(error) => {
                results.push(CheckpointResult {
                    binding_id: binding.id(),
                    request_id: None,
                    reason: Some(error.code().into()),
                });
                continue;
            }
        };
        let request = EvaluationRequest {
            request_id: request_id(&event, &binding.id()),
            packet,
            judgment: judgment.clone(),
            question_fingerprint: policy::question_fingerprint(judgment),
            template_fingerprint: policy::template_fingerprint(judgment),
        };
        if trace::validate_selected(&request).is_err()
            || packet::validate_packet(&request.packet, judgment, &config.limits).is_err()
        {
            results.push(CheckpointResult {
                binding_id: binding.id(),
                request_id: None,
                reason: Some("missing_required_context".into()),
            });
            continue;
        }
        if settings(config, &request)
            .is_none_or(|settings| policy::validate_settings(settings, judgment).is_err())
        {
            results.push(CheckpointResult {
                binding_id: binding.id(),
                request_id: None,
                reason: Some("missing_policy".into()),
            });
            continue;
        }
        requests.push(request);
    }
    let expertise_present = requests
        .iter()
        .filter(|request| {
            matches!(
                request.judgment.name.as_str(),
                "expertise-useful" | "expertise-selection"
            )
        })
        .count();
    if expertise_present == 1 {
        requests.retain(|request| {
            if matches!(
                request.judgment.name.as_str(),
                "expertise-useful" | "expertise-selection"
            ) {
                results.push(CheckpointResult {
                    binding_id: request.packet.binding_id.clone(),
                    request_id: None,
                    reason: Some("expertise_pair_budget".into()),
                });
                false
            } else {
                true
            }
        });
    }
    let mut records = Vec::new();
    requests.retain(|request| {
        if trace::deterministic_result(request, Provenance::LocalCheckpoint).is_some() {
            let identity = config
                .provider
                .as_ref()
                .map(|provider| provider.identity.clone())
                .unwrap_or_else(|| unverified_identity(request));
            let response =
                provider::failure_response(request, &identity, ProviderFailure::Unsupported, None);
            if let Ok(mut record) = TraceRecord::new(
                request.clone(),
                response,
                settings(config, request).unwrap().clone(),
                ExpertMode::Shadow,
                Provenance::LocalCheckpoint,
                None,
                config.limits.clone(),
            ) {
                record.runtime_fingerprint = Some(packet::digest(config));
                records.push(record);
            }
            false
        } else {
            true
        }
    });
    let mut provider_calls = 0usize;
    while !requests.is_empty() {
        let first = requests.remove(0);
        let mut group = vec![first];
        let mut index = 0;
        while index < requests.len() && group.len() < 4 {
            let mut proposed = group.clone();
            proposed.push(requests[index].clone());
            if provider::validate_batch(&EvaluationBatchRequest {
                batch_id: "compatibility".into(),
                requests: proposed,
            })
            .is_ok()
            {
                group.push(requests.remove(index));
            } else {
                index += 1;
            }
        }
        let batch_id = format!(
            "batch-{}",
            packet::digest(
                &group
                    .iter()
                    .map(|request| &request.request_id)
                    .collect::<Vec<_>>()
            )
        );
        let responses = if let Some(configured) = &config.provider {
            let mut provider = match CommandProvider::new(
                configured.argv.clone(),
                configured.identity.clone(),
                config.limits.clone(),
            ) {
                Ok(provider) => provider,
                Err(_) => return fail(TraceError::InvalidInput, json),
            };
            provider_calls += 1;
            let deadline = Instant::now() + Duration::from_millis(config.limits.request_timeout_ms);
            if group.len() == 1 {
                vec![provider.evaluate(&group[0], deadline, &AtomicBool::new(false))]
            } else {
                provider
                    .evaluate_batch(
                        &EvaluationBatchRequest {
                            batch_id: batch_id.clone(),
                            requests: group.clone(),
                        },
                        deadline,
                        &AtomicBool::new(false),
                    )
                    .responses
            }
        } else {
            group
                .iter()
                .map(|request| {
                    provider::failure_response(
                        request,
                        &unverified_identity(request),
                        ProviderFailure::Unverified,
                        None,
                    )
                })
                .collect()
        };
        let paired = group
            .iter()
            .zip(&responses)
            .find(|(request, _)| request.judgment.name == "expertise-selection");
        for (request, response) in group.iter().zip(&responses) {
            let settings = settings(config, request).unwrap().clone();
            let mut record = match TraceRecord::new(
                request.clone(),
                response.clone(),
                settings,
                ExpertMode::Shadow,
                Provenance::LocalCheckpoint,
                if group.len() > 1 {
                    Some(batch_id.clone())
                } else {
                    None
                },
                config.limits.clone(),
            ) {
                Ok(record) => record,
                Err(error) => return fail(error, json),
            };
            record.runtime_fingerprint = Some(packet::digest(config));
            if request.judgment.name == "expertise-useful" {
                if let Some((pair_request, pair_response)) = paired {
                    record.expertise_pair = Some(Box::new(ExpertisePair {
                        request: pair_request.clone(),
                        response: pair_response.clone(),
                        settings: settings_for(config, pair_request).unwrap().clone(),
                    }));
                    if let Err(error) = trace::apply_expertise_pair(&mut record) {
                        return fail(error, json);
                    }
                } else {
                    trace::suppress(&mut record, "expertise_pair_missing");
                }
            }
            if config.mode == ExpertMode::Advisory
                && trace::promotion_matches(config, &record, &record.request.packet)
            {
                record.mode = ExpertMode::Advisory;
            }
            if let Err(error) = trace::check_current(project, &mut record, &store) {
                return fail(error, json);
            }
            records.push(record);
        }
    }
    records.sort_by(|a, b| trace::record_priority(a).cmp(&trace::record_priority(b)));
    let mut proposed = false;
    for record in &mut records {
        if matches!(
            record.result.outcome,
            AdvisoryOutcome::Nudge | AdvisoryOutcome::Escalation
        ) {
            if proposed {
                trace::suppress(record, "checkpoint_budget");
            } else {
                proposed = true;
            }
        }
        if let Err(error) = store.record(record) {
            return fail(error, json);
        }
        results.push(CheckpointResult {
            binding_id: record.request.packet.binding_id.clone(),
            request_id: Some(record.request.request_id.clone()),
            reason: None,
        });
    }
    for result in &results {
        if let Some(reason) = &result.reason
            && let Err(error) = store.capture(
                &event,
                if result.binding_id.is_empty() {
                    None
                } else {
                    Some(result.binding_id.clone())
                },
                reason,
            )
        {
            return fail(error, json);
        }
    }
    let mode = if records
        .iter()
        .any(|record| record.mode == ExpertMode::Advisory)
    {
        ExpertMode::Advisory
    } else {
        ExpertMode::Shadow
    };
    emit(
        &CheckpointOutput {
            mode,
            provider_calls,
            usage: trace::aggregate_usage(&records),
            results,
        },
        json,
    )
}

fn settings_for<'a>(
    config: &'a RuntimeConfig,
    request: &EvaluationRequest,
) -> Option<&'a PolicySettings> {
    settings(config, request)
}

pub(super) fn execute(action: Action, explicit: Option<&Path>, cwd: &Path, json: bool) -> i32 {
    match action {
        Action::Evaluate {
            config,
            provider_command,
        } => match load_config(config.as_deref()) {
            Ok(config) => evaluate_lines(&config, &provider_command, json),
            Err(error) => fail(error, json),
        },
        Action::Replay { trace: path } => {
            let record: TraceRecord = match trace::read_json(&path, trace::MAX_TRACE_BYTES) {
                Ok(record) => record,
                Err(error) => return fail(error, json),
            };
            match trace::replay(&record) {
                Ok(result) => emit(&result, json),
                Err(_) => fail(TraceError::InvalidInput, json),
            }
        }
        action => {
            let project = match project_cli::load(explicit, cwd, json, None) {
                Ok(project) => project,
                Err(exit) => return exit,
            };
            if let Action::Checkpoint { event, config } = action {
                return match load_config(Some(&config)) {
                    Ok(config) => checkpoint(&project, &event, &config, json),
                    Err(error) => fail(error, json),
                };
            }
            let store = match TraceStore::new(&project.manifest.root, TraceLimits::default()) {
                Ok(store) => store,
                Err(error) => return fail(error, json),
            };
            match action {
                Action::Delivery {
                    request_id,
                    checkpoint,
                } => match store.reserve(&request_id, &checkpoint, &project) {
                    Ok(delivery) => emit(&delivery, json),
                    Err(error) => fail(error, json),
                },
                Action::Receipt {
                    request_id,
                    state,
                    evidence,
                } => match store.receipt(&request_id, state, &evidence, &project) {
                    Ok(receipt) => emit(&receipt, json),
                    Err(error) => fail(error, json),
                },
                Action::Traces { action: None } => match store
                    .traces()
                    .and_then(|traces| store.captures().map(|captures| (traces, captures)))
                {
                    Ok((traces, captures)) => emit(
                        &serde_json::json!({"traces":traces,"captures":captures}),
                        json,
                    ),
                    Err(error) => fail(error, json),
                },
                Action::Traces {
                    action: Some(TraceAction::Delete { run_id }),
                } => match store.delete_run(&run_id) {
                    Ok(deleted) => emit(
                        &serde_json::json!({"run_id":run_id,"deleted":deleted}),
                        json,
                    ),
                    Err(error) => fail(error, json),
                },
                Action::Cleanup { task } => match store
                    .cleanup_terminal(task.trim_start_matches("task::"))
                {
                    Ok(removed) => emit(&serde_json::json!({"task":task,"removed":removed}), json),
                    Err(error) => fail(error, json),
                },
                Action::Reevaluate {
                    trace: path,
                    config,
                    provider_command,
                } => {
                    let mut record: TraceRecord =
                        match trace::read_json(&path, trace::MAX_TRACE_BYTES) {
                            Ok(record) => record,
                            Err(error) => return fail(error, json),
                        };
                    if trace::replay(&record).is_err() {
                        return fail(TraceError::InvalidInput, json);
                    }
                    let config = match load_config(config.as_deref()) {
                        Ok(config) => config,
                        Err(error) => return fail(error, json),
                    };
                    record.request.request_id = request_id(
                        &ObservedEvent {
                            event_id: record.request.packet.event.event_id.clone(),
                            run_id: record.request.packet.event.run_id.clone(),
                            task: record.request.packet.event.task.clone(),
                            checkpoint_id: record.request.packet.event.checkpoint_id.clone(),
                            sequence: record.request.packet.event.sequence,
                            previous_sequence: record.request.packet.event.previous_sequence,
                            unix_ms: record.request.packet.event.unix_ms,
                            kind: record.request.packet.event.kind,
                            host: record.request.packet.event.host.clone(),
                            observations: vec![],
                        },
                        &record.request.packet.binding_id,
                    );
                    let response = evaluate_request(&record.request, &config, &provider_command);
                    let Some(settings) = settings(&config, &record.request) else {
                        return emit(
                            &Evaluated {
                                result: policy::outcome(
                                    &record.request,
                                    AdvisoryOutcome::Abstain,
                                    "missing_policy",
                                ),
                                response,
                                provenance: Provenance::Imported,
                                mode: ExpertMode::Shadow,
                            },
                            json,
                        );
                    };
                    let comparison = match TraceRecord::new(
                        record.request,
                        response,
                        settings.clone(),
                        ExpertMode::Shadow,
                        Provenance::Imported,
                        None,
                        config.limits.clone(),
                    ) {
                        Ok(record) => record,
                        Err(error) => return fail(error, json),
                    };
                    match store.record(&comparison) {
                        Ok(()) => emit(&comparison, json),
                        Err(error) => fail(error, json),
                    }
                }
                _ => unreachable!(),
            }
        }
    }
}
