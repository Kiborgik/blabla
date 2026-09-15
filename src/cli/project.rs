use super::heartbeat::{Heartbeat, INTERVAL};
use super::{
    ErrorReport, contract_error, emit_contract_error, emit_error, emit_run, error, verify_error,
    write_json,
};
use blabla::application::AppConfig;
use blabla::diagnostic::{Diagnostic, Location, Span};
use blabla::project::runstate::{
    Classification, Marker, new_run_id, profile_identity, read_marker, remove_marker, write_marker,
};
use blabla::project::status::{
    CompletionState, ExplainView, FINISH_COMMAND, PrimitiveView, Record, State, StatusView,
    StructureExplainView, apply_run_state, evaluate, explain_structure, explain_view, now_unix,
    primitive_view, read_record, status_view, write_record,
};
use blabla::project::{self, Layer, Project, ResolvedCommand};
use blabla::report::{CoverageStatus, RunOptions, RunReport, RunStatus};
use blabla::structure::{LayerStatus, RuleStatus, StructureReport};
use blabla::verify::Progress;
use blabla::{runtime, verify};
use serde::Serialize;
use std::ffi::OsString;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub(super) fn load(
    explicit: Option<&Path>,
    cwd: &Path,
    json: bool,
    seed: Option<u64>,
) -> Result<Project, i32> {
    let manifest_path = project::locate(explicit, cwd)
        .map_err(|diagnostic| emit_contract_error(diagnostic, json, seed))?;
    let manifest = project::read_manifest(&manifest_path)
        .map_err(|diagnostic| emit_contract_error(diagnostic, json, seed))?;
    project::load(manifest).map_err(|diagnostic| emit_contract_error(diagnostic, json, seed))
}

fn evaluate_with_run_state(project: &Project) -> blabla::project::status::Evaluation {
    let root = &project.manifest.root;
    let mut evaluation = evaluate(project, read_record(root));
    apply_run_state(&mut evaluation, project, read_marker(root));
    evaluation
}

pub(super) fn status(project: &Project, json: bool) -> i32 {
    let evaluation = evaluate_with_run_state(project);
    let structure = project.verify_structure();
    let view = status_view(project, &evaluation, &structure);
    let result = if json {
        write_json(&view)
    } else {
        write_status(&view)
    };
    if result.is_ok() { view.exit } else { 4 }
}

pub(super) fn explain(project: &Project, query: &str, json: bool) -> i32 {
    if matches!(project.lookup(query), Ok(project::Lookup::Structure(_))) {
        let structure = project.verify_structure();
        let view = match explain_structure(project, &structure, query) {
            Ok(Some(view)) => view,
            Ok(None) => unreachable!("lookup resolved a structure rule"),
            Err(diagnostic) => return emit_contract_error(diagnostic, json, None),
        };
        let result = if json {
            write_json(&view)
        } else {
            write_structure_explain(&view)
        };
        return if result.is_ok() { 0 } else { 4 };
    }
    let evaluation = evaluate_with_run_state(project);
    let view = match explain_view(project, &evaluation, query) {
        Ok(view) => view,
        Err(diagnostic) => return emit_contract_error(diagnostic, json, None),
    };
    let result = if json {
        write_json(&view)
    } else {
        write_explain(&view)
    };
    if result.is_ok() { 0 } else { 4 }
}

fn write_structure_explain(view: &StructureExplainView) -> io::Result<()> {
    let mut output = io::stdout().lock();
    let result = &view.result;
    writeln!(output, "{}\nStatus: {}", result.id, result.status.word())?;
    writeln!(
        output,
        "\nLayer:\n  STRUCTURE\nContract:\n  {}:{}",
        result.file, result.line
    )?;
    writeln!(
        output,
        "\nRule:\n  {}\n  {}",
        view.source, result.requirement
    )?;
    match (result.status, &result.observed) {
        (RuleStatus::Error, _) => writeln!(output, "\nProblem:\n  {}", result.message)?,
        (_, Some(observed)) => writeln!(
            output,
            "\nObserved:\n  {observed}{}",
            result
                .provider
                .map(|provider| format!("   ({provider} provider)"))
                .unwrap_or_default()
        )?,
        (_, None) => writeln!(output, "\nObserved:\n  {}", result.message)?,
    }
    writeln!(
        output,
        "\nStructure is evaluated live from the repository by {}; no campaign is needed.",
        view.verification
    )
}

pub(super) fn explain_runtime(explicit: Option<&Path>, cwd: &Path, query: &str, json: bool) -> i32 {
    let project = project::locate(explicit, cwd)
        .ok()
        .and_then(|manifest_path| project::read_manifest(&manifest_path).ok())
        .and_then(|manifest| project::load(manifest).ok());
    let view = match primitive_view(project.as_ref(), query) {
        Ok(view) => view,
        Err(message) => return emit_error(error("contract", message, None), json, 2),
    };
    let result = if json {
        write_json(&view)
    } else {
        write_primitive(&view)
    };
    if result.is_ok() { 0 } else { 4 }
}

fn write_primitive(view: &PrimitiveView) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(
        output,
        "{}\n\nOwned by:\n  {}\n\nSemantics:",
        view.id, view.owner
    )?;
    for fact in view.semantics {
        writeln!(output, "  {}", fact.statement)?;
    }
    writeln!(output, "\n{}", view.distinction)?;
    if !view.used_by.is_empty() {
        writeln!(output, "\nUsed by:")?;
        for rule in &view.used_by {
            writeln!(output, "  {rule}")?;
        }
    }
    Ok(())
}

pub(super) fn write_runtime_primitives(
    output: &mut impl Write,
    view: &StatusView,
) -> io::Result<()> {
    if view.runtime_primitives.is_empty() {
        return Ok(());
    }
    writeln!(output, "\nRuntime primitives used:")?;
    for id in &view.runtime_primitives {
        writeln!(output, "  {id}   (blabla explain {id})")?;
    }
    Ok(())
}

#[derive(Serialize)]
struct ContractView {
    name: String,
    path: String,
    layer: Layer,
    draft: bool,
    rules: usize,
    check: String,
}

#[derive(Serialize)]
struct CheckView {
    status: &'static str,
    project: String,
    manifest: String,
    contracts: Vec<ContractView>,
    actions: usize,
    postconditions: usize,
    invariants: usize,
    forbidden: usize,
}

pub(super) fn check(project: &Project, json: bool) -> i32 {
    let mut contracts: Vec<ContractView> = project
        .groups
        .iter()
        .map(|group| ContractView {
            name: group.name.clone(),
            path: group.display.clone(),
            layer: group.layer,
            draft: false,
            rules: group.rules,
            check: "ok".into(),
        })
        .collect();
    let mut failures = Vec::new();
    for draft in &project.drafts {
        let check = match &draft.check {
            Ok(()) => "ok".to_owned(),
            Err(diagnostic) => {
                failures.push(diagnostic.clone());
                format!(
                    "{} {}:{}:{} {}",
                    diagnostic.code,
                    diagnostic.location.file,
                    diagnostic.location.line,
                    diagnostic.location.column,
                    diagnostic.message
                )
            }
        };
        contracts.push(ContractView {
            name: draft.name.clone(),
            path: draft.display.clone(),
            layer: draft.layer,
            draft: true,
            rules: 0,
            check,
        });
    }
    let contract = project.contract.as_ref();
    let view = CheckView {
        status: if failures.is_empty() { "ok" } else { "error" },
        project: project.manifest.name.clone(),
        manifest: project.manifest.path.display().to_string(),
        contracts,
        actions: contract.map(|c| c.actions.len()).unwrap_or(0),
        postconditions: contract
            .map(|c| c.actions.iter().map(|a| a.postconditions.len()).sum())
            .unwrap_or(0),
        invariants: contract
            .map(|c| c.invariants.iter().filter(|p| !p.forbidden).count())
            .unwrap_or(0),
        forbidden: contract
            .map(|c| c.invariants.iter().filter(|p| p.forbidden).count())
            .unwrap_or(0),
    };
    let result = if json {
        write_json(&view)
    } else {
        write_check(&view)
    };
    if result.is_err() {
        return 4;
    }
    if failures.is_empty() { 0 } else { 2 }
}

fn write_check(view: &CheckView) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(
        output,
        "{}",
        if view.status == "ok" { "OK" } else { "ERROR" }
    )?;
    writeln!(output, "Project: {} ({})", view.project, view.manifest)?;
    if view.contracts.is_empty() {
        writeln!(output, "Contracts: none")?;
    } else {
        writeln!(output, "Contracts:")?;
        let width = view
            .contracts
            .iter()
            .map(|contract| contract.name.len())
            .max()
            .unwrap_or(0);
        for contract in &view.contracts {
            if contract.draft {
                writeln!(
                    output,
                    "  draft   {:<9}  {:<width$}  {}  check {}",
                    contract.layer.word(),
                    contract.name,
                    contract.path,
                    contract.check
                )?;
            } else {
                writeln!(
                    output,
                    "  active  {:<9}  {:<width$}  {}  {} rules",
                    contract.layer.word(),
                    contract.name,
                    contract.path,
                    contract.rules
                )?;
            }
        }
    }
    writeln!(
        output,
        "{} actions\n{} postconditions\n{} invariants\n{} forbidden conditions",
        view.actions, view.postconditions, view.invariants, view.forbidden
    )
}

fn manifest_diagnostic(project: &Project, code: &str, message: &str) -> Diagnostic {
    Diagnostic {
        location: Location {
            file: project.manifest.path.display().to_string(),
            line: 1,
            column: 1,
        },
        code: code.into(),
        message: message.into(),
    }
}

fn no_contracts(project: &Project) -> Diagnostic {
    manifest_diagnostic(
        project,
        "E_NO_CONTRACTS",
        "project has no active contracts; change `draft behavior` to `use behavior` (or `draft structure` to `use structure`) in project.bla to make a contract authoritative",
    )
}

pub(super) fn run(
    project: &Project,
    options: RunOptions,
    timeout_ms: u64,
    application: &[OsString],
    json: bool,
    verbose: bool,
    cwd: &Path,
) -> i32 {
    let seed = options.seed;
    let written: Vec<String> = application
        .iter()
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect();
    let command = match project::resolve_command(
        &written,
        cwd,
        &project.manifest.path.display().to_string(),
        Span::default(),
    ) {
        Ok(command) => command,
        Err(diagnostic) => return emit_contract_error(diagnostic, json, Some(seed)),
    };
    let structure = project.verify_structure();
    match verify_and_record(
        project,
        options,
        timeout_ms,
        &command,
        &structure,
        None,
        &mut |_| {},
    ) {
        Ok((report, view)) => emit_run(report, json, verbose, timeout_ms, Some(&view), false),
        Err(failure) => {
            let (report, exit) = *failure;
            emit_error(report, json, exit)
        }
    }
}

fn structure_line(structure: &StructureReport) -> String {
    match structure.status {
        LayerStatus::None => "none declared".to_owned(),
        LayerStatus::Error if structure.verified + structure.violated == 0 => format!(
            "ERROR: {}",
            structure.first_error().unwrap_or("provider failure")
        ),
        status => {
            let mut line = format!(
                "{}/{} rules  {}",
                structure.verified,
                structure.total(),
                status.word()
            );
            if structure.errors > 0 {
                line.push_str(&format!("  ({} could not be evaluated)", structure.errors));
            }
            line
        }
    }
}

#[derive(Serialize)]
struct StructureOnlyOutput<'a> {
    project: &'a StatusView,
    completion: &'a blabla::project::status::CompletionView,
}

pub(super) fn finish(project: &Project, json: bool, verbose: bool) -> i32 {
    let blocked = |failure: Box<(ErrorReport, i32)>| {
        let (mut report, exit) = *failure;
        report.completion = Some("error");
        emit_error(report, json, exit)
    };
    let root = project.manifest.root.clone();
    let structure = project.verify_structure();
    if !project.has_behavior() {
        if !project.has_structure() {
            return blocked(Box::new(contract_error(no_contracts(project), None)));
        }
        let evaluation = evaluate_with_run_state(project);
        let view = status_view(project, &evaluation, &structure);
        let result = if json {
            write_json(&StructureOnlyOutput {
                project: &view,
                completion: &view.completion,
            })
        } else {
            let mut output = io::stdout().lock();
            writeln!(output, "BlaBla finish\n\nProject: {}\n", view.project)
                .and_then(|()| write_layers(&mut output, &view))
                .and_then(|()| write_contracts(&mut output, &view))
                .and_then(|()| write_structure_issues(&mut output, &view))
                .and_then(|()| write_next(&mut output, &view))
                .and_then(|()| write_gate(&mut output, &view))
        };
        return if result.is_ok() { view.exit } else { 4 };
    }
    let Some(profile) = &project.manifest.profile else {
        return blocked(Box::new(contract_error(
            manifest_diagnostic(
                project,
                "E_NO_VERIFY_PROFILE",
                "project.bla has no canonical verification profile; add `verify behavior { command [\"program\", \"argument\", ...] steps <n> ... }` so blabla finish can run it",
            ),
            None,
        )));
    };
    let command = match project.launch() {
        Ok(Some(command)) => command,
        Ok(None) => unreachable!("profile presence was checked"),
        Err(diagnostic) => {
            return blocked(Box::new(contract_error(diagnostic, Some(profile.seed))));
        }
    };
    let options = RunOptions {
        seed: profile.seed,
        cases: profile.cases,
        steps: profile.steps,
        shrink_budget: profile.shrink_budget,
    };
    let evaluation = evaluate_with_run_state(project);
    if let Some(run) = &evaluation.run_state
        && run.classification == Classification::Verifying
    {
        return blocked(Box::new(contract_error(
            manifest_diagnostic(
                project,
                "E_FINISH_RUNNING",
                &format!(
                    "another {FINISH_COMMAND} is running (started at {}, pid {}); wait for it or stop that process before starting a new verification",
                    run.started_at, run.pid
                ),
            ),
            Some(profile.seed),
        )));
    }
    let run_id = new_run_id();
    let marker = Marker {
        run_id: run_id.clone(),
        pid: std::process::id(),
        started_unix: now_unix(),
        verifier_version: env!("CARGO_PKG_VERSION").into(),
        project_identity: project.identity.clone(),
        profile_identity: profile_identity(Some(profile)),
        profile: Some(profile.clone()),
    };
    if let Err(failure) = write_marker(&root, &marker) {
        let _ = writeln!(
            io::stderr(),
            "warning: could not record the verification run state: {failure}"
        );
    }
    let sink: Box<dyn Write> = if json {
        Box::new(io::stderr())
    } else {
        Box::new(io::stdout())
    };
    let mut heartbeat = Heartbeat::new(sink, INTERVAL);
    heartbeat.header(
        &structure_line(&structure),
        &format!(
            "starting canonical verification (seed {}, {} cases x {} actions; {})",
            profile.seed,
            profile.cases,
            profile.steps,
            profile.command.join(" ")
        ),
    );
    let outcome = verify_and_record(
        project,
        options,
        profile.timeout_ms,
        &command,
        &structure,
        Some(run_id),
        &mut |progress| heartbeat.observe(progress, Instant::now()),
    );
    heartbeat.finish();
    if let Err(failure) = remove_marker(&root) {
        let _ = writeln!(
            io::stderr(),
            "warning: could not clear the verification run state: {failure}"
        );
    }
    match outcome {
        Ok((report, view)) => {
            emit_run(report, json, verbose, profile.timeout_ms, Some(&view), true)
        }
        Err(failure) => blocked(failure),
    }
}

fn verify_and_record(
    project: &Project,
    options: RunOptions,
    timeout_ms: u64,
    command: &ResolvedCommand,
    structure: &StructureReport,
    run_id: Option<String>,
    observer: &mut dyn FnMut(&Progress),
) -> Result<(RunReport, StatusView), Box<(ErrorReport, i32)>> {
    let seed = options.seed;
    let Some(contract) = &project.contract else {
        return Err(Box::new(contract_error(no_contracts(project), Some(seed))));
    };
    let config = AppConfig {
        executable: command.program.clone(),
        args: command.args.clone(),
        timeout: Duration::from_millis(timeout_ms),
    };
    let report = verify::run_observed(
        contract,
        &options,
        || runtime::AppSession::spawn(&config),
        observer,
    )
    .map_err(|failure| Box::new(verify_error(failure, seed)))?;
    let output = super::RunOutput {
        timeout_ms,
        report: &report,
        project: None,
        completion: None,
    };
    let value = serde_json::to_value(&output)
        .map_err(|failure| Box::new((error("internal", failure.to_string(), Some(seed)), 4)))?;
    let files = fingerprinted_files(&config.executable, &config.args);
    let record = Record {
        verifier_version: env!("CARGO_PKG_VERSION").into(),
        project: project.manifest.name.clone(),
        manifest: project.manifest.path.display().to_string(),
        project_identity: project.identity.clone(),
        implementation_fingerprint: project.fingerprint(&files),
        fingerprinted_files: files
            .iter()
            .map(|file| file.display().to_string())
            .collect(),
        application: command.written.clone(),
        timeout_ms,
        profile: project.manifest.profile.clone(),
        run_id,
        structure: serde_json::to_value(structure).ok(),
        recorded_unix: now_unix(),
        report: value,
    };
    if let Err(failure) = write_record(&project.manifest.root, &record) {
        let _ = writeln!(
            io::stderr(),
            "warning: could not record project status: {failure}"
        );
    }
    let evaluation = evaluate(project, Ok(Some(record)));
    Ok((report, status_view(project, &evaluation, structure)))
}

fn fingerprinted_files(executable: &Path, args: &[OsString]) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut consider = |candidate: PathBuf| {
        if candidate.is_absolute() && candidate.is_file() && !files.contains(&candidate) {
            files.push(candidate);
        }
    };
    consider(executable.to_path_buf());
    for argument in args {
        consider(PathBuf::from(argument));
    }
    files
}

fn state_word(status: &CoverageStatus) -> &'static str {
    match status {
        CoverageStatus::Verified => "GREEN",
        CoverageStatus::Unexercised => "YELLOW",
        CoverageStatus::Violated => "RED",
    }
}

fn run_word(status: &RunStatus) -> &'static str {
    match status {
        RunStatus::Green => "GREEN",
        RunStatus::Yellow => "YELLOW",
        RunStatus::Red => "RED",
    }
}

fn application_line(view: &StatusView) -> String {
    view.recorded
        .as_ref()
        .filter(|recorded| !recorded.application.is_empty())
        .map(|recorded| recorded.application.join(" "))
        .unwrap_or_else(|| "<application>".into())
}

fn verification_line(view: &StatusView) -> String {
    match view.completion.command {
        Some(command) => command.to_owned(),
        None => format!("blabla run -- {}", application_line(view)),
    }
}

pub(super) fn write_completion(output: &mut impl Write, view: &StatusView) -> io::Result<()> {
    writeln!(
        output,
        "\nCompletion:  {}  ({})",
        view.completion.state.word(),
        view.completion.reason
    )?;
    if let (Some(command), Some(profile)) = (view.completion.command, &view.profile) {
        writeln!(
            output,
            "Canonical verification:  {command}  (seed {}, {} cases x {} actions, timeout {} ms, shrink budget {}; {})",
            profile.seed,
            profile.cases,
            profile.steps,
            profile.timeout_ms,
            profile.shrink_budget,
            profile.command.join(" ")
        )?;
    }
    Ok(())
}

pub(super) fn write_gate(output: &mut impl Write, view: &StatusView) -> io::Result<()> {
    writeln!(
        output,
        "\nCOMPLETION GATE: {}",
        view.completion.state.word()
    )?;
    match view.completion.state {
        CompletionState::Green => writeln!(
            output,
            "Work may be declared complete: {}.",
            view.completion.reason
        ),
        _ => writeln!(
            output,
            "{}. Completion is not allowed until {FINISH_COMMAND} reports OVERALL GREEN.",
            view.completion.reason
        ),
    }
}

pub(super) fn write_layers(output: &mut impl Write, view: &StatusView) -> io::Result<()> {
    let behavior_contracts = view
        .groups
        .iter()
        .filter(|group| group.layer == Layer::Behavior)
        .count();
    match view.state {
        State::Green | State::Yellow | State::Red => {
            writeln!(
                output,
                "BEHAVIOR   {}/{} rules  {}",
                view.rules.green,
                view.rules.total,
                view.state.word()
            )?;
            writeln!(
                output,
                "           GREEN {}  YELLOW {}  RED {}; actions {}/{} exercised",
                view.rules.green,
                view.rules.yellow,
                view.rules.red,
                view.actions.exercised,
                view.actions.total
            )?;
        }
        State::Unverified => writeln!(
            output,
            "BEHAVIOR   UNVERIFIED (no recorded run); {} rules in {} contracts",
            view.rules.total, behavior_contracts
        )?,
        State::Stale => {
            let recorded = view.recorded.as_ref();
            writeln!(
                output,
                "BEHAVIOR   STALE ({} changed since the recorded run); {} rules in {} contracts",
                recorded
                    .map(|recorded| recorded.stale.join(", "))
                    .unwrap_or_default(),
                view.rules.total,
                behavior_contracts
            )?;
            write_last_recorded(output, view)?;
        }
        State::Verifying => {
            let run = view.run_state.as_ref();
            writeln!(
                output,
                "BEHAVIOR   VERIFYING ({FINISH_COMMAND} started at {}, pid {})",
                run.map(|run| run.started_at.as_str()).unwrap_or("unknown"),
                run.map(|run| run.pid).unwrap_or(0)
            )?;
        }
        State::Interrupted => {
            writeln!(
                output,
                "BEHAVIOR   INTERRUPTED (a {FINISH_COMMAND} started at {} did not complete)",
                view.run_state
                    .as_ref()
                    .map(|run| run.started_at.as_str())
                    .unwrap_or("unknown")
            )?;
            write_last_recorded(output, view)?;
        }
        State::NoActiveContracts => {
            if view
                .drafts
                .iter()
                .any(|draft| draft.layer == Layer::Behavior)
            {
                writeln!(output, "BEHAVIOR   none declared (drafts only)")?;
            } else {
                writeln!(output, "BEHAVIOR   none declared")?;
            }
        }
    }
    let structure = &view.structure;
    match structure.status {
        LayerStatus::None => writeln!(output, "STRUCTURE  none declared")?,
        status => {
            writeln!(
                output,
                "STRUCTURE  {}/{} rules  {}{}",
                structure.verified,
                structure.total(),
                status.word(),
                if structure.errors > 0 {
                    format!("  ({} could not be evaluated)", structure.errors)
                } else {
                    String::new()
                }
            )?;
        }
    }
    match view.overall.status {
        blabla::project::status::OverallStatus::Green => writeln!(output, "OVERALL    GREEN"),
        blabla::project::status::OverallStatus::Blocked => {
            writeln!(output, "OVERALL    BLOCKED  ({})", view.overall.reason)
        }
    }
}

fn write_last_recorded(output: &mut impl Write, view: &StatusView) -> io::Result<()> {
    if let Some(recorded) = &view.recorded {
        writeln!(
            output,
            "           last recorded: {} {}/{} obligations at {}",
            run_word(&recorded.status),
            recorded.verified,
            recorded.verified + recorded.unexercised + recorded.violated,
            recorded.recorded_at
        )?;
    }
    Ok(())
}

pub(super) fn write_structure_issues(output: &mut impl Write, view: &StatusView) -> io::Result<()> {
    let issues: Vec<_> = view
        .structure
        .rules
        .iter()
        .filter(|rule| rule.status != RuleStatus::Green)
        .collect();
    if issues.is_empty() {
        return Ok(());
    }
    writeln!(output, "\nStructure violations:")?;
    let width = issues.iter().map(|rule| rule.id.len()).max().unwrap_or(0);
    for rule in issues {
        writeln!(
            output,
            "  {:<5}  {:<width$}  {}",
            rule.status.word(),
            rule.id,
            rule.observed.as_deref().unwrap_or(&rule.message)
        )?;
    }
    Ok(())
}

pub(super) fn write_contracts(output: &mut impl Write, view: &StatusView) -> io::Result<()> {
    if !view.groups.is_empty() {
        writeln!(output, "\nContracts:")?;
        let width = view
            .groups
            .iter()
            .map(|group| group.name.len())
            .max()
            .unwrap_or(0)
            .max(12);
        for group in &view.groups {
            match group.word() {
                Some(word) => writeln!(
                    output,
                    "  {:<9}  {:<width$}  {:>7}  {:<7}  {}",
                    group.layer.word(),
                    group.name,
                    format!("{}/{}", group.counts.green, group.counts.total),
                    word,
                    group.path
                )?,
                None => writeln!(
                    output,
                    "  {:<9}  {:<width$}  {} rules  {}",
                    group.layer.word(),
                    group.name,
                    group.counts.total,
                    group.path
                )?,
            }
        }
    }
    if !view.drafts.is_empty() {
        writeln!(output, "\nDrafts (not authoritative, not verified):")?;
        let width = view
            .drafts
            .iter()
            .map(|draft| draft.name.len())
            .max()
            .unwrap_or(0)
            .max(12);
        for draft in &view.drafts {
            writeln!(
                output,
                "  {:<9}  {:<width$}  {}  check {}",
                draft.layer.word(),
                draft.name,
                draft.path,
                draft.check
            )?;
        }
    }
    Ok(())
}

pub(super) fn write_next(output: &mut impl Write, view: &StatusView) -> io::Result<()> {
    writeln!(output, "\nNext:")?;
    if view.completion.allowed {
        return writeln!(output, "  nothing to inspect; every active rule is GREEN");
    }
    if !view.next.is_empty() {
        for rule in &view.next {
            writeln!(output, "  blabla explain {}", rule.id)?;
        }
        return Ok(());
    }
    match view.state {
        State::Verifying => writeln!(
            output,
            "  wait for the running {FINISH_COMMAND} (pid {}), then blabla status",
            view.run_state.as_ref().map(|run| run.pid).unwrap_or(0)
        ),
        State::NoActiveContracts => writeln!(
            output,
            "  promote a draft: change `draft behavior` to `use behavior` in project.bla, then {}",
            verification_line(view)
        ),
        _ => writeln!(output, "  {}", verification_line(view)),
    }
}

fn write_status(view: &StatusView) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(output, "BlaBla: executable project memory\n")?;
    writeln!(
        output,
        "Project:   {}   ({})\n",
        view.project, view.manifest
    )?;
    write_layers(&mut output, view)?;
    if let Some(failure) = &view.record_error {
        writeln!(output, "Recorded run unreadable: {failure}")?;
    }
    write_contracts(&mut output, view)?;
    write_structure_issues(&mut output, view)?;
    write_runtime_primitives(&mut output, view)?;
    write_next(&mut output, view)?;
    if let Some(recorded) = &view.recorded {
        writeln!(
            output,
            "\nRecorded run: seed {}, cases {}, steps {} ({} executed), timeout {} ms; application: {}; at {}{}",
            recorded.seed,
            recorded.cases,
            recorded.steps,
            recorded.steps_executed,
            recorded.timeout_ms,
            recorded.application.join(" "),
            recorded.recorded_at,
            if recorded.stale.is_empty() {
                "; contracts, implementation and profile unchanged since"
            } else {
                ""
            }
        )?;
    }
    write_completion(&mut output, view)?;
    let verification = verification_line(view);
    let closing = match view.completion.state {
        CompletionState::Green => {
            "Every active layer is GREEN: completion allowed.".to_owned()
        }
        CompletionState::Yellow => format!(
            "YELLOW means NOT COMPLETE. Supply the missing witnesses, then {verification} until GREEN."
        ),
        CompletionState::Red => format!(
            "RED means NOT COMPLETE. Repair the counterexample, then {verification} until GREEN."
        ),
        CompletionState::StructureRed => {
            "STRUCTURE RED means NOT COMPLETE. Repair the structure violations listed above; blabla status re-evaluates structure live.".to_owned()
        }
        CompletionState::StructureError => {
            "STRUCTURE could not be evaluated: completion stays BLOCKED until the provider problem is fixed and blabla status reports GREEN.".to_owned()
        }
        CompletionState::Verifying => {
            format!("A {FINISH_COMMAND} is running; wait for its result before declaring completion.")
        }
        CompletionState::Interrupted => format!(
            "The last {FINISH_COMMAND} did not complete. Before declaring completion: {verification} must run to a result and report GREEN."
        ),
        CompletionState::NoActiveContracts => format!(
            "Before declaring completion: promote a contract, then {verification} until GREEN."
        ),
        CompletionState::Stale
        | CompletionState::Unverified
        | CompletionState::NotCanonical
        | CompletionState::NoProfile => {
            format!("Before declaring completion: {verification} must report OVERALL GREEN.")
        }
    };
    writeln!(output, "\n{closing}")
}

fn write_explain(view: &ExplainView) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(output, "{}", view.id)?;
    let suffix = match (view.state, &view.recorded) {
        (State::Unverified, _) => format!(" (no recorded run; run {})", view.verification),
        (State::Stale, Some(recorded)) => format!(
            " ({} changed since the recorded run; rerun {})",
            recorded.stale.join(", "),
            view.verification
        ),
        (State::Verifying, _) => format!(" ({} is running)", view.verification),
        (State::Interrupted, _) => format!(
            " (the last {} did not complete; rerun it)",
            view.verification
        ),
        _ => String::new(),
    };
    writeln!(output, "Status: {}{suffix}", view.state.word())?;
    match (&view.file, &view.line) {
        (Some(file), Some(line)) => writeln!(output, "\nContract:\n  {file}:{line}")?,
        _ => writeln!(
            output,
            "\nContract:\n  action declared by the project contracts"
        )?,
    }
    if let Some(action) = &view.action {
        writeln!(output, "Action: {action}")?;
    }
    if !view.depends_on.is_empty() {
        writeln!(output, "Depends on:")?;
        for id in &view.depends_on {
            writeln!(output, "  {id}")?;
        }
    }
    if let Some(source) = &view.source {
        writeln!(output, "\nRule:\n  {source}")?;
    }
    if let Some(recorded) = &view.recorded
        && matches!(view.state, State::Green | State::Yellow | State::Red)
    {
        writeln!(output, "\nCoverage (recorded run, seed {}):", recorded.seed)?;
        for obligation in &view.obligations {
            writeln!(
                output,
                "  {:<7} {}  evaluations {}, witnesses {}",
                state_word(&obligation.status),
                obligation.id,
                obligation.evaluations,
                obligation.witnesses
            )?;
            if obligation.status == CoverageStatus::Unexercised {
                writeln!(
                    output,
                    "    Required witness: {}",
                    obligation.required_witness
                )?;
            }
        }
    }
    if let Some(failure) = &view.failure {
        writeln!(output, "\nMinimal counterexample:")?;
        super::write_calls(&mut output, &failure.minimal_sequence)?;
        writeln!(output, "\npredicate: {}", failure.predicate)?;
        if let (Some(expected), Some(actual)) = (&failure.expected, &failure.actual) {
            writeln!(output, "expected: {expected}")?;
            writeln!(output, "actual: {actual}")?;
        } else {
            writeln!(output, "expected predicate: true\nactual predicate: false")?;
        }
        writeln!(
            output,
            "original sequence length: {}\nminimal sequence length: {}",
            failure.original_sequence_length, failure.minimal_sequence_length
        )?;
    }
    if !view.depends_on.is_empty() {
        writeln!(output, "\nMore:")?;
        for id in &view.depends_on {
            writeln!(output, "  blabla explain {id}")?;
        }
    }
    Ok(())
}
