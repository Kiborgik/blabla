use super::{emit_error, error, project as project_cli, write_json};
use blabla::expert::calibration::{self, EvidenceRef, FitSavedRequest, MAX_FIT_BYTES};
use blabla::expert::native::{self as native_core, ExecutionIdentity};
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
use blabla::expert::{ContextSlot, DeliveryState, ExpertMode, ObservedEvent};
use blabla::project::{Project, task};
use clap::Subcommand;
mod native;
mod pilot;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, BufRead, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

#[derive(Subcommand)]
pub(super) enum Action {
    PreflightDevelopmentCalibration {
        #[arg(long)]
        input: PathBuf,
    },
    FitSaved {
        #[arg(long)]
        input: PathBuf,
    },
    Evaluate {
        #[arg(long)]
        config: Option<PathBuf>,
        #[arg(long, num_args = 1..)]
        provider_command: Vec<String>,
    },
    Native {
        #[command(subcommand)]
        action: native::Action,
    },
    Pilot {
        #[command(subcommand)]
        action: pilot::Action,
    },
    Checkpoint {
        #[arg(long)]
        event: PathBuf,
        #[arg(long)]
        config: Option<PathBuf>,
        #[arg(long)]
        experimental_run: Option<String>,
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

fn read_fit_bytes(path: &Path) -> Result<Vec<u8>, TraceError> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if std::fs::symlink_metadata(&current)?
            .file_type()
            .is_symlink()
        {
            return Err(TraceError::InvalidInput);
        }
    }
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(TraceError::InvalidInput);
    }
    if metadata.len() > MAX_FIT_BYTES as u64 {
        return Err(TraceError::LimitExceeded);
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(MAX_FIT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_FIT_BYTES {
        return Err(TraceError::LimitExceeded);
    }
    Ok(bytes)
}

fn read_fit_evidence(root: &Path, evidence: &EvidenceRef) -> Result<Vec<u8>, TraceError> {
    if evidence.path.is_empty()
        || evidence.path.contains(['\\', ':', '\0'])
        || evidence
            .path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || Path::new(&evidence.path)
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err(TraceError::InvalidInput);
    }
    let bytes = read_fit_bytes(&root.join(&evidence.path))?;
    if calibration::sha256(&bytes) != evidence.sha256 {
        return Err(TraceError::InvalidInput);
    }
    Ok(bytes)
}

fn validate_fit_artifacts(root: &Path, input: &FitSavedRequest) -> Result<(), TraceError> {
    let bytes = read_fit_evidence(root, &input.request_manifest.requests_jsonl)?;
    let mut seen = BTreeSet::new();
    for line in bytes.split_inclusive(|byte| *byte == b'\n') {
        if line.last() != Some(&b'\n') || seen.len() >= input.executions.len() {
            return Err(TraceError::InvalidInput);
        }
        let request: EvaluationRequest = trace::decode_json(line, trace::MAX_EVENT_BYTES)?;
        if !seen.insert(request.request_id.clone())
            || !input
                .executions
                .iter()
                .any(|execution| execution.request == request)
        {
            return Err(TraceError::InvalidInput);
        }
    }
    if seen.len() != input.executions.len() {
        return Err(TraceError::InvalidInput);
    }
    let mut commands = BTreeMap::new();
    for execution in &input.executions {
        let evidence = &execution.command_evidence;
        if let Some(hash) = commands.get(&evidence.path) {
            if *hash != &evidence.sha256 {
                return Err(TraceError::InvalidInput);
            }
        } else {
            read_fit_evidence(root, evidence)?;
            commands.insert(&evidence.path, &evidence.sha256);
        }
    }
    Ok(())
}

fn fit_reference(
    identity: &str,
    task: &task::Task,
    memory: &mut BTreeSet<String>,
) -> Result<(), TraceError> {
    if let Some(name) = identity.strip_prefix("task::") {
        if name != task.name {
            return Err(TraceError::InvalidInput);
        }
    } else if identity.starts_with("evidence::") {
        if !task.evidence.iter().enumerate().any(|(index, evidence)| {
            identity == format!("evidence::{}::{}", task.name, index + 1)
                && evidence.tool == "run"
                && matches!((&evidence.identity, &evidence.command),
                    (Some(task::CheckIdentity::Argv { argv }), Some(command)) if argv == command)
        }) {
            return Err(TraceError::InvalidInput);
        }
    } else {
        memory.insert(identity.to_owned());
    }
    Ok(())
}

fn validate_fit_project<'a>(
    project: &Project,
    manifest: &calibration::CalibrationRequestManifest,
    requests: impl IntoIterator<Item = &'a EvaluationRequest>,
    current_limits: Option<&blabla::expert::ExpertLimits>,
) -> Result<(), TraceError> {
    if !blabla::project::expert::validate_bindings(project).is_empty() {
        return Err(TraceError::InvalidInput);
    }
    let (judgments, bindings) = trace::definitions(project)?;
    let mut references = BTreeSet::new();
    for request in requests {
        let packet = &request.packet;
        let name = packet
            .event
            .task
            .strip_prefix("task::")
            .ok_or(TraceError::InvalidInput)?;
        if name.is_empty()
            || name.len() > 128
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(TraceError::InvalidInput);
        }
        let task = task::read(&project.manifest.root, name)
            .map_err(|_| TraceError::Io)?
            .ok_or(TraceError::InvalidInput)?;
        let binding = bindings
            .iter()
            .find(|binding| binding.id() == packet.binding_id)
            .ok_or(TraceError::InvalidInput)?;
        if task.name != name
            || !binding.roles.iter().any(|role| {
                role.trim_start_matches("role::") == task.role.trim_start_matches("role::")
            })
            || !binding.checkpoints.contains(&packet.event.kind)
            || packet.revision.identities.get(&binding.id()) != Some(&packet::digest(binding))
            || judgments
                .iter()
                .find(|judgment| judgment.id() == binding.judgment)
                != Some(&request.judgment)
        {
            return Err(TraceError::InvalidInput);
        }
        if let Some(limits) = current_limits {
            if task.state != "accepted" || packet.revision.acceptance_epoch != task.acceptance_epoch
            {
                return Err(TraceError::InvalidInput);
            }
            let stamp = &packet.event;
            let event = ObservedEvent {
                event_id: stamp.event_id.clone(),
                run_id: stamp.run_id.clone(),
                task: stamp.task.clone(),
                checkpoint_id: stamp.checkpoint_id.clone(),
                sequence: stamp.sequence,
                previous_sequence: stamp.previous_sequence,
                unix_ms: stamp.unix_ms,
                kind: stamp.kind,
                host: stamp.host.clone(),
                observations: packet
                    .context
                    .values()
                    .flat_map(packet::ContextValue::observations)
                    .filter(|observation| !observation.capture.starts_with("local:"))
                    .cloned()
                    .collect(),
            };
            let rebuilt = blabla::project::expert::build_packet(
                project,
                &task,
                &event,
                binding,
                limits,
                &packet.history,
            )
            .map_err(|_| TraceError::InvalidInput)?;
            if rebuilt != *packet {
                return Err(TraceError::InvalidInput);
            }
        }
        for (slot, context) in &packet.context {
            if matches!(
                slot,
                ContextSlot::Goal
                    | ContextSlot::Mission
                    | ContextSlot::System
                    | ContextSlot::Candidates
                    | ContextSlot::Rules
            ) {
                let declared = binding.context.get(slot).cloned().unwrap_or_else(|| {
                    if *slot == ContextSlot::Goal {
                        task.goal
                            .as_ref()
                            .map(|goal| {
                                if goal.starts_with("goal::") {
                                    goal.clone()
                                } else {
                                    format!("goal::{goal}")
                                }
                            })
                            .into_iter()
                            .collect()
                    } else {
                        Vec::new()
                    }
                });
                if context
                    .observations()
                    .iter()
                    .any(|observation| !declared.contains(&observation.id))
                {
                    return Err(TraceError::InvalidInput);
                }
            }
        }
        for identity in packet.references.keys() {
            fit_reference(identity, &task, &mut references)?;
        }
        for case in manifest
            .cases
            .iter()
            .filter(|case| case.primary_request_id == request.request_id)
        {
            for identity in case.gold.acceptable_reference_sets.iter().flatten() {
                fit_reference(identity, &task, &mut references)?;
            }
        }
    }
    blabla::project::expert::resolve_references(project, &references)
        .map_err(|_| TraceError::InvalidInput)?;
    Ok(())
}

fn fit_saved(project: &Project, path: &Path) -> Result<Vec<u8>, TraceError> {
    let input = calibration::decode_fit_saved(&read_fit_bytes(path)?)?;
    let root = &project.manifest.root;
    let protocol = read_fit_evidence(root, &input.protocol_evidence)?;
    let plan = read_fit_evidence(root, &input.plan_evidence)?;
    let manifest = read_fit_evidence(root, &input.manifest_evidence)?;
    let context = calibration::validate_fit_context(&input, &protocol, &plan, &manifest)?;
    validate_fit_artifacts(root, &input)?;
    validate_fit_project(
        project,
        &input.request_manifest,
        input.executions.iter().map(|execution| &execution.request),
        None,
    )?;
    calibration::encode_fit_result(&calibration::fit_saved(&input, &context)?)
}

fn preflight_file(root: &Path, path: &Path) -> Result<EvidenceRef, TraceError> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| TraceError::InvalidInput)?;
    let path = relative.to_string_lossy().replace('\\', "/");
    if path.is_empty()
        || path.contains([':', '\0'])
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(TraceError::InvalidInput);
    }
    let bytes = read_fit_bytes(&root.join(&path))?;
    Ok(EvidenceRef {
        id: format!("file-{}", calibration::sha256(path.as_bytes())),
        path,
        sha256: calibration::sha256(&bytes),
    })
}

fn preflight_project_files(
    manifest: &blabla::project::Manifest,
) -> Result<Vec<EvidenceRef>, TraceError> {
    let root = &manifest.root;
    let mut paths = BTreeSet::from([manifest.path.clone()]);
    paths.extend(manifest.entries.iter().map(|entry| entry.path.clone()));
    paths.extend(
        manifest
            .knowledge
            .iter()
            .chain(manifest.mission.iter())
            .chain(manifest.system.iter())
            .chain(manifest.process.iter())
            .chain(manifest.goal.iter())
            .map(|entry| entry.path.clone()),
    );
    paths.extend(
        manifest
            .ignores
            .iter()
            .filter_map(|declaration| match declaration {
                blabla::project::ignore::IgnoreDeclaration::List { path, .. } => Some(path.clone()),
                _ => None,
            }),
    );
    paths
        .iter()
        .map(|path| preflight_file(root, path))
        .collect()
}

fn preflight_development(
    project: &Project,
    path: &Path,
    mut files: Vec<EvidenceRef>,
) -> Result<calibration::PreflightDevelopmentResult, TraceError> {
    let input: calibration::PreflightDevelopmentRequest =
        trace::decode_json(&read_fit_bytes(path)?, MAX_FIT_BYTES)?;
    let root = &project.manifest.root;
    let protocol = read_fit_evidence(root, &input.protocol_evidence)?;
    let plan = read_fit_evidence(root, &input.plan_evidence)?;
    let manifest = read_fit_evidence(root, &input.manifest_evidence)?;
    let config = read_fit_evidence(root, &input.runtime_config_evidence)?;
    let inputs =
        calibration::preflight_development_inputs(&input, &protocol, &plan, &manifest, &config)?;
    let requests = read_fit_evidence(root, inputs.requests_evidence())?;
    let mut preflight = calibration::preflight_development_calibration(inputs, &requests)?;
    let mut paths = BTreeSet::new();
    for request in &preflight.requests {
        let name = request
            .packet
            .event
            .task
            .strip_prefix("task::")
            .ok_or(TraceError::InvalidInput)?;
        if name.is_empty()
            || name.len() > 128
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(TraceError::InvalidInput);
        }
        paths.insert(root.join(format!(".blabla/tasks/{name}.json")));
        for (path, digest) in &request.packet.revision.paths {
            if digest.is_some() {
                paths.insert(root.join(path));
            }
        }
    }
    for path in paths {
        files.push(preflight_file(root, &path)?);
    }
    validate_fit_project(
        project,
        &preflight.request_manifest,
        &preflight.requests,
        Some(&preflight.plan.limits),
    )?;
    for evidence in &files {
        read_fit_evidence(root, evidence)?;
    }
    preflight.result.referenced_files.extend(files);
    preflight
        .result
        .referenced_files
        .sort_by(|a, b| (&a.path, &a.id).cmp(&(&b.path, &b.id)));
    let mut hashes = BTreeMap::new();
    for evidence in &preflight.result.referenced_files {
        if hashes
            .insert(&evidence.path, &evidence.sha256)
            .is_some_and(|old| old != &evidence.sha256)
        {
            return Err(TraceError::InvalidInput);
        }
    }
    preflight
        .result
        .referenced_files
        .dedup_by(|a, b| a.path == b.path);
    Ok(preflight.result)
}

fn preflight_command(
    explicit: Option<&Path>,
    cwd: &Path,
    input: &Path,
) -> Result<calibration::PreflightDevelopmentResult, TraceError> {
    let path = blabla::project::locate(explicit, cwd).map_err(|_| TraceError::InvalidInput)?;
    read_fit_bytes(&path)?;
    let manifest = blabla::project::read_manifest(&path).map_err(|_| TraceError::InvalidInput)?;
    let files = preflight_project_files(&manifest)?;
    let project = blabla::project::load(manifest).map_err(|_| TraceError::InvalidInput)?;
    preflight_development(&project, input, files)
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
    execution: ExecutionIdentity,
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
        let mut output = serializer.serialize_struct("CheckpointCapture", 8)?;
        output.serialize_field("execution", &self.execution)?;
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

fn checkpoint(
    project: &Project,
    event_path: &Path,
    config: &RuntimeConfig,
    experimental_run: Option<&str>,
    json: bool,
) -> i32 {
    let store = match TraceStore::new(&project.manifest.root, config.trace_limits.clone()) {
        Ok(store) => store,
        Err(error) => return fail(error, json),
    };
    let experimental = if let Some(run) = experimental_run {
        let event: ObservedEvent = match trace::read_json(event_path, trace::MAX_EVENT_BYTES) {
            Ok(event) => event,
            Err(error) => return fail(error, json),
        };
        match native_core::run::checkpoint_input(&store, project, run, &event, Some(config)) {
            Ok((_, capture, execution)) => Some((capture, execution)),
            Err(error) => return native::fail(error, json),
        }
    } else {
        if let Err(error) = store.set_runtime(config) {
            return fail(error, json);
        }
        None
    };
    let execution = experimental
        .as_ref()
        .map(|(_, e)| e.clone())
        .unwrap_or(ExecutionIdentity::Ordinary);
    if config.mode == ExpertMode::Off {
        if let Some(run) = experimental_run
            && let Err(error) = native_core::run::store_records(&store, project, run, &mut [])
        {
            return native::fail(error, json);
        }
        return emit(
            &CheckpointOutput {
                execution: execution.clone(),
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
            &serde_json::json!({"execution":execution,"mode":"shadow","capture_status":"abstained","provider_calls":0,"proposal_ids":[],"captured":1,"omitted_evaluations":0,"observation_gaps":event.host.gaps}),
            json,
        );
    }
    if experimental.is_none()
        && let Err(error) = store.advance_checkpoint(&event)
    {
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
                &serde_json::json!({"execution":execution,"mode":"shadow","capture_status":"abstained","provider_calls":0,"proposal_ids":[],"captured":1,"omitted_evaluations":0}),
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
                execution: execution.clone(),
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
    let (judgments, bindings) = match trace::selected_bindings(project, &task, &event, config) {
        Ok(value) => value,
        Err(error) => return fail(error, json),
    };
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
        let mut projected_event = event.clone();
        let projected_history;
        let selected_history = if let Some((capture, _)) = &experimental {
            let Some(projection) = capture
                .projections
                .iter()
                .find(|p| p.binding_id == binding.id())
            else {
                results.push(CheckpointResult {
                    binding_id: binding.id(),
                    request_id: None,
                    reason: Some("judgment_budget".into()),
                });
                continue;
            };
            projected_event.observations = projection.observations.clone();
            projected_history = projection.history.clone();
            &projected_history
        } else {
            &history
        };
        let packet = match blabla::project::expert::build_packet(
            project,
            &task,
            &projected_event,
            binding,
            &config.limits,
            selected_history,
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
        if let Some((capture, _)) = &experimental
            && capture
                .projections
                .iter()
                .find(|p| p.binding_id == binding.id())
                .is_none_or(|p| p.revision != packet.revision || p.packet_hash != packet.hash)
        {
            return native::fail(
                blabla::expert::pilot::Error::Refused(
                    blabla::expert::pilot::Refusal::StaleRevision,
                ),
                json,
            );
        }
        let request = EvaluationRequest {
            request_id: if experimental.is_some() {
                format!(
                    "native-request-{}",
                    packet::digest(&(
                        &event.run_id,
                        &event.event_id,
                        &event.task,
                        &event.checkpoint_id,
                        &binding.id(),
                        packet.revision.acceptance_epoch
                    ))
                )
            } else {
                request_id(&event, &binding.id())
            },
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
            let timeout = if let Some(run) = experimental_run {
                match native_core::run::reserve_provider(&store, project, run, &group) {
                    Ok((_, deadline)) => match blabla::expert::pilot::Clock::now() {
                        Ok(clock) => match deadline
                            .checked_sub(clock.boottime_ms)
                            .filter(|remaining| *remaining > 0)
                        {
                            Some(remaining) => remaining,
                            None => {
                                return native::fail(
                                    blabla::expert::pilot::Error::Refused(
                                        blabla::expert::pilot::Refusal::Expired,
                                    ),
                                    json,
                                );
                            }
                        },
                        Err(error) => return native::fail(error, json),
                    },
                    Err(error) => return native::fail(error, json),
                }
            } else {
                config.limits.request_timeout_ms
            };
            let mut provider = match CommandProvider::new(
                configured.argv.clone(),
                configured.identity.clone(),
                config.limits.clone(),
            ) {
                Ok(provider) => provider,
                Err(_) => return fail(TraceError::InvalidInput, json),
            };
            provider_calls += 1;
            let deadline = Instant::now() + Duration::from_millis(timeout);
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
            if experimental.is_none()
                && config.mode == ExpertMode::Advisory
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
        if experimental.is_none()
            && let Err(error) = store.record(record)
        {
            return fail(error, json);
        }
        results.push(CheckpointResult {
            binding_id: record.request.packet.binding_id.clone(),
            request_id: Some(record.request.request_id.clone()),
            reason: None,
        });
    }
    if let Some(run) = experimental_run
        && let Err(error) = native_core::run::store_records(&store, project, run, &mut records)
    {
        return native::fail(error, json);
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
            execution: execution.clone(),
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
        Action::PreflightDevelopmentCalibration { input } => {
            match preflight_command(explicit, cwd, &input) {
                Ok(result) => emit(&result, json),
                Err(error) => fail(error, json),
            }
        }
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
            match native_core::replay_report(&record) {
                Ok(result) => emit(&result, json),
                Err(_) => fail(TraceError::InvalidInput, json),
            }
        }
        action => {
            let project = match project_cli::load(explicit, cwd, json, None) {
                Ok(project) => project,
                Err(exit) => return exit,
            };
            if let Action::FitSaved { input } = action {
                return match fit_saved(&project, &input) {
                    Ok(bytes) => {
                        use std::io::Write;
                        if io::stdout().lock().write_all(&bytes).is_ok() {
                            0
                        } else {
                            4
                        }
                    }
                    Err(error) => fail(error, json),
                };
            }
            match action {
                Action::Native { action } => return native::run(&project, action, json),
                Action::Pilot { action } => return pilot::run(&project, action, json),
                Action::Checkpoint {
                    event,
                    config,
                    experimental_run,
                } => {
                    let selected = if let Some(run) = &experimental_run {
                        let store =
                            match TraceStore::new(&project.manifest.root, TraceLimits::default()) {
                                Ok(s) => s,
                                Err(e) => return fail(e, json),
                            };
                        let frozen = match native_core::run::runtime_config(&store, run) {
                            Ok(c) => c,
                            Err(e) => return native::fail(e, json),
                        };
                        if let Some(path) = &config {
                            let supplied = match load_config(Some(path)) {
                                Ok(c) => c,
                                Err(e) => return fail(e, json),
                            };
                            let raw_hash = match std::fs::read(path) {
                                Ok(bytes) => calibration::sha256(&bytes),
                                Err(_) => return fail(TraceError::Io, json),
                            };
                            let expected_hash =
                                match native_core::run::runtime_config_sha256(&store, run) {
                                    Ok(hash) => hash,
                                    Err(error) => return native::fail(error, json),
                                };
                            if supplied != frozen || raw_hash != expected_hash {
                                return native::fail(
                                    blabla::expert::pilot::Error::Refused(
                                        blabla::expert::pilot::Refusal::RuntimeChanged,
                                    ),
                                    json,
                                );
                            }
                        }
                        frozen
                    } else {
                        let Some(path) = config else {
                            return fail(TraceError::InvalidInput, json);
                        };
                        match load_config(Some(&path)) {
                            Ok(c) => c,
                            Err(e) => return fail(e, json),
                        }
                    };
                    return checkpoint(
                        &project,
                        &event,
                        &selected,
                        experimental_run.as_deref(),
                        json,
                    );
                }
                _ => (),
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
