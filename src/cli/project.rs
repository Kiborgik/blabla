use super::heartbeat::{Heartbeat, INTERVAL};
use super::{
    ErrorReport, contract_error, emit_contract_error, emit_error, emit_run, error, verify_error,
    write_json,
};
use blabla::application::AppConfig;
use blabla::diagnostic::{Diagnostic, Location, Span};
use blabla::memory::knowledge::{KnowledgeExplainView, KnowledgeMemory, KnowledgeStatus};
use blabla::memory::mission::{MissionExplainView, MissionMemory, MissionStatus};
use blabla::memory::process::{ProcessExplainView, ProcessMemory, ProcessStatus};
use blabla::memory::system::{SystemExplainView, SystemMemory, SystemStatus};
use blabla::memory::{self, Memory, knowledge, mission, process, routing, system};
use blabla::project::runstate::{
    Classification, Marker, new_run_id, profile_identity, read_marker, remove_marker, write_marker,
};
use blabla::project::status::{
    CompletionState, ExplainView, FINISH_COMMAND, PrimitiveView, Record, State, StatusView,
    StructureExplainView, apply_run_state, evaluate, explain_structure, explain_view, now_unix,
    primitive_view, read_record, status_view, write_record,
};
use blabla::project::task::{self, TaskStatus};
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

pub(super) fn evaluate_with_run_state(project: &Project) -> blabla::project::status::Evaluation {
    let root = &project.manifest.root;
    let mut evaluation = evaluate(project, read_record(root));
    apply_run_state(&mut evaluation, project, read_marker(root));
    evaluation
}

#[derive(Serialize)]
struct StatusWithMemory<'a> {
    #[serde(flatten)]
    project: &'a StatusView,
    #[serde(skip_serializing_if = "Option::is_none")]
    mission_memory: Option<MissionStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_memory: Option<SystemStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    process_memory: Option<ProcessStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    knowledge_memory: Option<KnowledgeStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bounded_tasks: Option<TaskStatus>,
}

#[derive(Default)]
pub(super) struct MemoryViews {
    mission: Option<MissionStatus>,
    system: Option<SystemStatus>,
    process: Option<ProcessStatus>,
    knowledge: Option<KnowledgeStatus>,
}

struct Memories {
    mission: Memory<MissionMemory>,
    mission_file: String,
    system: Memory<SystemMemory>,
    system_file: String,
    process: Memory<ProcessMemory>,
    process_file: String,
    knowledge: Memory<KnowledgeMemory>,
    knowledge_files: Vec<String>,
}

impl Memories {
    fn views(&self) -> MemoryViews {
        MemoryViews {
            mission: mission::status(&self.mission, &self.mission_file),
            system: system::status(&self.system, &self.system_file),
            process: process::status(&self.process, &self.process_file),
            knowledge: knowledge::status(&self.knowledge, &self.knowledge_files),
        }
    }
}

fn memories(project: &Project) -> Memories {
    let root = &project.manifest.root;
    let (mission_memory, mission_file) = match &project.manifest.mission {
        Some(entry) => (
            memory::read(
                &entry.path,
                &entry.display,
                mission::build,
                mission::validate,
            ),
            entry.display.clone(),
        ),
        None => (
            memory::unregistered(root, mission::FILE_NAME, "mission"),
            mission::FILE_NAME.to_owned(),
        ),
    };
    let knowledge_files: Vec<String> = project
        .manifest
        .knowledge
        .iter()
        .map(|entry| entry.display.clone())
        .collect();
    let knowledge_memory = if project.manifest.knowledge.is_empty() {
        memory::unregistered_directory(root, knowledge::DIRECTORY, "knowledge")
    } else {
        let entries: Vec<(&Path, &str)> = project
            .manifest
            .knowledge
            .iter()
            .map(|entry| (entry.path.as_path(), entry.display.as_str()))
            .collect();
        memory::read_all(&entries, knowledge::build, knowledge::validate)
    };
    let (system_memory, system_file) = match &project.manifest.system {
        Some(entry) => (
            memory::read(&entry.path, &entry.display, system::build, system::validate),
            entry.display.clone(),
        ),
        None => (
            memory::unregistered(root, system::FILE_NAME, "system"),
            system::FILE_NAME.to_owned(),
        ),
    };
    let (process_memory, process_file) = match &project.manifest.process {
        Some(entry) => (
            memory::read(
                &entry.path,
                &entry.display,
                process::build,
                process::validate,
            ),
            entry.display.clone(),
        ),
        None => (
            memory::unregistered(root, process::FILE_NAME, "process"),
            process::FILE_NAME.to_owned(),
        ),
    };
    let system_routing = system_memory
        .present()
        .map(|memory| routing::system_problems(memory, &knowledge_memory))
        .unwrap_or_default();
    let process_routing = process_memory
        .present()
        .map(|memory| routing::process_problems(memory, &knowledge_memory))
        .unwrap_or_default();
    Memories {
        mission: mission_memory,
        mission_file,
        system: system_memory.with_problems(system_routing),
        system_file,
        process: process_memory.with_problems(process_routing),
        process_file,
        knowledge: knowledge_memory,
        knowledge_files,
    }
}

fn identities(project: &Project, query: &str) -> Vec<String> {
    let loaded = memories(project);
    let mut names = mission::canonical(&loaded.mission, query);
    names.extend(knowledge::canonical(&loaded.knowledge, query));
    names.extend(system::canonical(&loaded.system, query));
    names.extend(process::canonical(&loaded.process, query));
    names
}

pub(super) fn status(project: &Project, json: bool) -> i32 {
    let evaluation = evaluate_with_run_state(project);
    let structure = project.verify_structure();
    let view = status_view(project, &evaluation, &structure);
    let views = memories(project).views();
    let tasks = task::status(&project.manifest.root);
    let result = if json {
        write_json(&StatusWithMemory {
            project: &view,
            mission_memory: views.mission,
            system_memory: views.system,
            process_memory: views.process,
            knowledge_memory: views.knowledge,
            bounded_tasks: tasks,
        })
    } else {
        write_status(&view, &views, tasks.as_ref())
    };
    if result.is_ok() { view.exit } else { 4 }
}

pub(super) fn explain(project: &Project, query: &str, json: bool) -> i32 {
    let resolved = match project.resolve(query, &identities(project, query)) {
        Ok(resolved) => resolved,
        Err(diagnostic) => return emit_contract_error(diagnostic, json, None),
    };
    match resolved {
        project::Resolution::Memory(id) => {
            let loaded = memories(project);
            let result = if let Some(view) = mission::explain(&loaded.mission, &id) {
                if json {
                    write_json(&view)
                } else {
                    write_mission_explain(&view)
                }
            } else if let Some(view) = knowledge::explain(&loaded.knowledge, &id) {
                if json {
                    write_json(&view)
                } else {
                    write_knowledge_explain(&view)
                }
            } else if let Some(view) = system::explain(&loaded.system, &id) {
                if json {
                    write_json(&view)
                } else {
                    write_system_explain(&view)
                }
            } else {
                let Some(view) = process::explain(&loaded.process, &id) else {
                    unreachable!("resolve matched a memory identity")
                };
                if json {
                    write_json(&view)
                } else {
                    write_process_explain(&view)
                }
            };
            return if result.is_ok() { 0 } else { 4 };
        }
        project::Resolution::Project(project::Lookup::Contract(group)) => {
            let evaluation = evaluate_with_run_state(project);
            let structure = project.verify_structure();
            let status = status_view(project, &evaluation, &structure);
            let view = contract_view(project, &status, group);
            let result = if json {
                write_json(&view)
            } else {
                write_contract_explain(&view)
            };
            return if result.is_ok() { 0 } else { 4 };
        }
        project::Resolution::Project(project::Lookup::Structure(_)) => {
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
        project::Resolution::Project(_) => {}
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

#[derive(Serialize)]
struct ContractRuleView {
    id: String,
    status: Option<&'static str>,
}

#[derive(Serialize)]
struct ContractExplainView {
    id: String,
    kind: &'static str,
    group: String,
    layer: Layer,
    path: String,
    state: Option<&'static str>,
    counts: blabla::project::status::RuleCounts,
    errors: usize,
    rules: Vec<ContractRuleView>,
}

fn contract_view(
    project: &Project,
    view: &StatusView,
    group: &blabla::project::Group,
) -> ContractExplainView {
    let entry = view.groups.iter().find(|row| row.name == group.name);
    let structure: Vec<ContractRuleView> = view
        .structure
        .rules
        .iter()
        .filter(|rule| rule.group.as_deref() == Some(group.name.as_str()))
        .map(|rule| ContractRuleView {
            id: rule.id.clone(),
            status: Some(rule.status.word()),
        })
        .collect();
    let rules = if structure.is_empty() {
        project
            .rules
            .iter()
            .filter(|rule| rule.group == group.name)
            .map(|rule| ContractRuleView {
                id: rule.id.clone(),
                status: None,
            })
            .collect()
    } else {
        structure
    };
    ContractExplainView {
        id: format!("contract::{}", group.name),
        kind: "contract",
        group: group.name.clone(),
        layer: group.layer,
        path: group.display.clone(),
        state: entry.and_then(|row| row.word()),
        counts: entry.map(|row| row.counts).unwrap_or_default(),
        errors: entry.map(|row| row.errors).unwrap_or(0),
        rules,
    }
}

fn write_contract_explain(view: &ContractExplainView) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(output, "{}\nKind: contract", view.id)?;
    writeln!(
        output,
        "\nLayer:\n  {}\nContract:\n  {}",
        view.layer.word().to_uppercase(),
        view.path
    )?;
    match view.state {
        Some(word) => writeln!(
            output,
            "\nState:\n  {}/{} rules  {word}{}",
            view.counts.green,
            view.counts.total,
            if view.errors > 0 {
                format!("  ({} could not be evaluated)", view.errors)
            } else {
                String::new()
            }
        )?,
        None => writeln!(output, "\nState:\n  {} rules", view.counts.total)?,
    }
    if view.rules.is_empty() {
        return writeln!(output, "\nThis contract declares no rules.");
    }
    writeln!(output, "\nRules:")?;
    for rule in &view.rules {
        match rule.status {
            Some(word) => writeln!(output, "  {word:<6}  blabla explain {}", rule.id)?,
            None => writeln!(output, "  blabla explain {}", rule.id)?,
        }
    }
    Ok(())
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

fn write_process_explain(view: &ProcessExplainView) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(
        output,
        "{}
Kind: {}",
        view.id, view.kind
    )?;
    writeln!(
        output,
        "
Statement:
  {}",
        view.statement
    )?;
    if !view.owns.is_empty() {
        writeln!(
            output,
            "
Owns:"
        )?;
        for item in &view.owns {
            writeln!(output, "  {item}")?;
        }
    }
    if let Some(verification) = &view.verification {
        writeln!(
            output,
            "
Verification:
  {verification}"
        )?;
    }
    if !view.model.is_empty() {
        writeln!(
            output,
            "
Model choices:
  {}",
            view.model.join("  ")
        )?;
    }
    if let Some(flow) = &view.flow {
        writeln!(
            output,
            "
Part of:
  {flow}"
        )?;
    }
    if !view.applies_to.is_empty() {
        writeln!(
            output,
            "
{}:
  {}",
            if view.kind == "step" {
                "Carried by"
            } else {
                "Applies to"
            },
            view.applies_to.join("  ")
        )?;
    }
    if let Some(command) = &view.command {
        writeln!(
            output,
            "
Command:
  {command}"
        )?;
    }
    if !view.steps.is_empty() {
        writeln!(
            output,
            "
{}:",
            if view.kind == "flow" {
                "Steps, in order"
            } else {
                "Steps it carries"
            }
        )?;
        for step in &view.steps {
            writeln!(output, "  {step}")?;
        }
        if let Some(first) = view
            .steps
            .first()
            .and_then(|step| step.split_whitespace().next())
        {
            writeln!(
                output,
                "  blabla explain {first}   what the step is, what carries it and the command that runs it"
            )?;
        }
    }
    if !view.policies.is_empty() {
        writeln!(
            output,
            "
Policies:"
        )?;
        for policy in &view.policies {
            writeln!(output, "  {policy}")?;
        }
    }
    if !view.consult.is_empty() {
        writeln!(
            output,
            "
Consult:
  {}",
            view.consult.join("  ")
        )?;
    }
    writeln!(
        output,
        "
{}",
        view.authority
    )
}

fn write_system_explain(view: &SystemExplainView) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(output, "{}\nKind: {}", view.id, view.kind)?;
    writeln!(output, "\nStatement:\n  {}", view.statement)?;
    if let Some(owner) = &view.owner {
        writeln!(output, "\nOwned by:\n  {owner}")?;
    }
    if !view.between.is_empty() {
        writeln!(output, "\nBetween:\n  {}", view.between.join("  and  "))?;
    }
    if let Some(value) = &view.value {
        writeln!(output, "\nValue that crosses:\n  {value}")?;
    }
    if !view.paths.is_empty() {
        writeln!(output, "\nPaths:")?;
        for path in &view.paths {
            writeln!(output, "  {path}")?;
        }
    }
    if !view.owns.is_empty() {
        writeln!(output, "\nOwns:")?;
        for responsibility in &view.owns {
            writeln!(output, "  {responsibility}")?;
        }
    }
    if !view.seams.is_empty() {
        writeln!(output, "\nSeams:")?;
        for seam in &view.seams {
            writeln!(output, "  {seam}")?;
        }
    }
    if !view.moves_with.is_empty() {
        writeln!(output, "\nMoves with:")?;
        for path in &view.moves_with {
            writeln!(output, "  {path}")?;
        }
    }
    if !view.knowledge.is_empty() {
        writeln!(output, "\nKnowledge:\n  {}", view.knowledge.join("  "))?;
    }
    writeln!(output, "\n{}", view.authority)
}

fn write_mission_explain(view: &MissionExplainView) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(output, "{}\nKind: {}", view.id, view.kind)?;
    writeln!(output, "\nStatement:\n  {}", view.statement)?;
    if !view.priorities.is_empty() {
        writeln!(output, "\nPriorities:")?;
        for priority in &view.priorities {
            writeln!(output, "  {priority}")?;
        }
    }
    if !view.non_goals.is_empty() {
        writeln!(output, "\nNon-goals:")?;
        for non_goal in &view.non_goals {
            writeln!(output, "  {non_goal}")?;
        }
    }
    writeln!(output, "\n{}", view.authority)
}

fn write_knowledge_explain(view: &KnowledgeExplainView) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(output, "{}\nKind: {}", view.id, view.kind)?;
    writeln!(output, "\nStatement:\n  {}", view.statement)?;
    if let Some(pack) = &view.pack {
        writeln!(output, "\nPack:\n  {pack}")?;
    }
    if !view.rulings.is_empty() {
        writeln!(output, "\nRulings:")?;
        for ruling in &view.rulings {
            writeln!(output, "  {ruling}")?;
        }
        writeln!(
            output,
            "\nEach ruling is explained on demand; this view lists identities so a pack costs one line per ruling instead of one paragraph."
        )?;
    }
    writeln!(output, "\n{}", view.authority)
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
        Ok((report, view)) => emit_run(report, json, verbose, timeout_ms, Some(&view), false, None),
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
    challenge: &'a blabla::skeptic::ChallengeReport,
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
        let challenge = super::task::standing(project, &view);
        let result = if json {
            write_json(&StructureOnlyOutput {
                project: &view,
                completion: &view.completion,
                challenge: &challenge,
            })
        } else {
            let mut output = io::stdout().lock();
            writeln!(output, "BlaBla finish\n\nProject: {}\n", view.project)
                .and_then(|()| write_layers(&mut output, &view))
                .and_then(|()| write_contracts(&mut output, &view))
                .and_then(|()| write_structure_issues(&mut output, &view))
                .and_then(|()| write_next(&mut output, &view, &MemoryViews::default()))
                .and_then(|()| write_gate(&mut output, &view))
                .and_then(|()| write_standing_challenge(&mut output, &challenge))
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
            let challenge = super::task::standing(project, &view);
            emit_run(
                report,
                json,
                verbose,
                profile.timeout_ms,
                Some(&view),
                true,
                Some(&challenge),
            )
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
        challenge: None,
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

pub(super) fn write_standing_challenge(
    output: &mut impl Write,
    report: &blabla::skeptic::ChallengeReport,
) -> io::Result<()> {
    let Some(challenge) = &report.challenge else {
        return Ok(());
    };
    writeln!(output, "\nSTANDING CHALLENGE ({})", challenge.class.word())?;
    writeln!(output, "{}", challenge.statement)?;
    for line in &challenge.evidence {
        writeln!(output, "  {line}")?;
    }
    writeln!(
        output,
        "Reconcile it or say why it does not hold; it changes no verdict above. Full evidence: blabla challenge"
    )
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
        let identity =
            |group: &blabla::project::status::GroupView| format!("contract::{}", group.name);
        let width = view
            .groups
            .iter()
            .map(|group| identity(group).len())
            .max()
            .unwrap_or(0)
            .max(12);
        for group in &view.groups {
            match group.word() {
                Some(word) => writeln!(
                    output,
                    "  {:<9}  {:<width$}  {:>7}  {:<7}  {}",
                    group.layer.word(),
                    identity(group),
                    format!("{}/{}", group.counts.green, group.counts.total),
                    word,
                    group.path
                )?,
                None => writeln!(
                    output,
                    "  {:<9}  {:<width$}  {} rules  {}",
                    group.layer.word(),
                    identity(group),
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

fn write_mission_line(output: &mut impl Write, memory: Option<&MissionStatus>) -> io::Result<()> {
    let Some(memory) = memory else {
        return Ok(());
    };
    match (memory.state, &memory.mission) {
        ("present", Some(mission)) => writeln!(
            output,
            "MISSION    {mission}  {} priorities  {} non-goals   (memory only; never part of completion)",
            memory.priorities, memory.non_goals
        ),
        _ => writeln!(
            output,
            "MISSION    {} is {}; no owner intent is available (completion is unaffected)",
            memory.file, memory.state
        ),
    }
}

fn write_mission_memory(output: &mut impl Write, memory: Option<&MissionStatus>) -> io::Result<()> {
    let Some(memory) = memory else {
        return Ok(());
    };
    writeln!(output, "\nMission memory ({}):", memory.file)?;
    if memory.state != "present" {
        for problem in &memory.problems {
            writeln!(output, "  {problem}")?;
        }
        return writeln!(
            output,
            "  {}\n  Fix the file or remove the registration; nothing about completion depends on it.",
            memory.authority
        );
    }
    if let Some(mission) = &memory.mission {
        writeln!(output, "  {mission}")?;
        writeln!(
            output,
            "  blabla explain {mission}   the goal, the priorities that decide a tradeoff and the non-goals"
        )?;
    }
    writeln!(output, "  {}", memory.authority)
}

fn write_knowledge_line(
    output: &mut impl Write,
    memory: Option<&KnowledgeStatus>,
) -> io::Result<()> {
    let Some(memory) = memory else {
        return Ok(());
    };
    match memory.state {
        "present" => writeln!(
            output,
            "KNOWLEDGE  {} packs  {} rulings   (memory only; never part of completion)",
            memory.packs.len(),
            memory.rulings
        ),
        _ => writeln!(
            output,
            "KNOWLEDGE  {} is {}; no reusable expertise is available (completion is unaffected)",
            files(&memory.files),
            memory.state
        ),
    }
}

fn write_knowledge_memory(
    output: &mut impl Write,
    memory: Option<&KnowledgeStatus>,
) -> io::Result<()> {
    let Some(memory) = memory else {
        return Ok(());
    };
    writeln!(output, "\nKnowledge memory ({}):", files(&memory.files))?;
    if memory.state != "present" {
        for problem in &memory.problems {
            writeln!(output, "  {problem}")?;
        }
        return writeln!(
            output,
            "  {}\n  Fix the file or remove the registration; nothing about completion depends on it.",
            memory.authority
        );
    }
    for chunk in memory.packs.chunks(4) {
        writeln!(output, "  {}", chunk.join("  "))?;
    }
    if let Some(first) = memory.packs.first() {
        writeln!(
            output,
            "  blabla explain {first}   its purpose and the identity of every ruling it holds"
        )?;
    }
    writeln!(output, "  {}", memory.authority)
}

fn files(names: &[String]) -> String {
    if names.is_empty() {
        return knowledge::DIRECTORY.to_owned();
    }
    names.join(", ")
}

fn write_process_line(output: &mut impl Write, memory: Option<&ProcessStatus>) -> io::Result<()> {
    let Some(memory) = memory else {
        return Ok(());
    };
    match memory.state {
        "present" => writeln!(
            output,
            "PROCESS    ADVISORY  {} roles  {} policies  {} flows  {} steps   (memory only; never part of completion; not enforced)",
            memory.roles.len(),
            memory.policies,
            memory.flows.len(),
            memory.steps
        ),
        _ => writeln!(
            output,
            "PROCESS    ADVISORY  {} is {}; no process memory is available (completion is unaffected)",
            memory.file, memory.state
        ),
    }
}

fn write_process_memory(output: &mut impl Write, memory: Option<&ProcessStatus>) -> io::Result<()> {
    let Some(memory) = memory else {
        return Ok(());
    };
    writeln!(
        output,
        "
Process memory ({}):",
        memory.file
    )?;
    if memory.state != "present" {
        for problem in &memory.problems {
            writeln!(output, "  {problem}")?;
        }
        return writeln!(
            output,
            "  {}
  Fix the file or remove the registration; nothing about completion depends on it.",
            memory.authority
        );
    }
    writeln!(output, "  {}", memory.roles.join("  "))?;
    if !memory.flows.is_empty() {
        writeln!(output, "  {}", memory.flows.join("  "))?;
    }
    if let Some(first) = memory.roles.first() {
        writeln!(
            output,
            "  blabla explain {first}   its purpose, what it owns, its verification tier and the policies that bind it"
        )?;
    }
    if let Some(first) = memory.flows.first() {
        writeln!(
            output,
            "  blabla explain {first}   the order the roles are meant to be used in, one line per step"
        )?;
    }
    writeln!(output, "  {}", memory.authority)
}

fn write_system_line(output: &mut impl Write, memory: Option<&SystemStatus>) -> io::Result<()> {
    let Some(memory) = memory else {
        return Ok(());
    };
    match memory.state {
        "present" => writeln!(
            output,
            "SYSTEM     {} systems  {} responsibilities  {} seams   (memory only; never part of completion)",
            memory.systems.len(),
            memory.responsibilities,
            memory.seams
        ),
        _ => writeln!(
            output,
            "SYSTEM     {} is {}; no architectural memory is available (completion is unaffected)",
            memory.file, memory.state
        ),
    }
}

fn write_system_memory(output: &mut impl Write, memory: Option<&SystemStatus>) -> io::Result<()> {
    let Some(memory) = memory else {
        return Ok(());
    };
    writeln!(output, "\nSystem memory ({}):", memory.file)?;
    if memory.state != "present" {
        for problem in &memory.problems {
            writeln!(output, "  {problem}")?;
        }
        return writeln!(
            output,
            "  {}\n  Fix the file or remove it; nothing about completion depends on it.",
            memory.authority
        );
    }
    for chunk in memory.systems.chunks(4) {
        writeln!(output, "  {}", chunk.join("  "))?;
    }
    if let Some(first) = memory.systems.first() {
        writeln!(
            output,
            "  blabla explain {first}   its purpose, paths, the responsibilities it owns and its seams"
        )?;
    }
    writeln!(output, "  {}", memory.authority)
}

pub(super) fn write_next(
    output: &mut impl Write,
    view: &StatusView,
    views: &MemoryViews,
) -> io::Result<()> {
    writeln!(output, "\nNext:")?;
    if view.completion.allowed {
        writeln!(
            output,
            "  every active rule is GREEN; inspect the declared intent instead:"
        )?;
        if let Some(group) = view.groups.first() {
            writeln!(output, "  blabla explain contract::{}", group.name)?;
        }
        if let Some(first) = views
            .mission
            .as_ref()
            .filter(|memory| memory.state == "present")
            .and_then(|memory| memory.mission.as_ref())
        {
            writeln!(output, "  blabla explain {first}")?;
        }
        if let Some(first) = views
            .system
            .as_ref()
            .filter(|memory| memory.state == "present")
            .and_then(|memory| memory.systems.first())
        {
            writeln!(output, "  blabla explain {first}")?;
        }
        if let Some(first) = views
            .process
            .as_ref()
            .filter(|memory| memory.state == "present")
            .and_then(|memory| memory.roles.first())
        {
            writeln!(output, "  blabla explain {first}")?;
        }
        if let Some(first) = views
            .knowledge
            .as_ref()
            .filter(|memory| memory.state == "present")
            .and_then(|memory| memory.packs.first())
        {
            writeln!(output, "  blabla explain {first}")?;
        }
        return Ok(());
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

fn write_bounded_tasks(output: &mut impl Write, tasks: Option<&TaskStatus>) -> io::Result<()> {
    let Some(tasks) = tasks else {
        return Ok(());
    };
    writeln!(output, "\nBounded tasks ({}):", tasks.directory)?;
    for task in &tasks.tasks {
        writeln!(
            output,
            "  {}   {}   {}   {} deliverables, {} unresolved",
            task.id, task.state, task.role, task.deliverables, task.unresolved
        )?;
    }
    writeln!(
        output,
        "  blabla challenge   hold this work against the evidence BlaBla already has and state one grounded challenge"
    )?;
    writeln!(output, "  {}", tasks.authority)
}

fn write_status(
    view: &StatusView,
    views: &MemoryViews,
    tasks: Option<&TaskStatus>,
) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(output, "BlaBla: executable project memory\n")?;
    writeln!(
        output,
        "Project:   {}   ({})\n",
        view.project, view.manifest
    )?;
    write_layers(&mut output, view)?;
    write_mission_line(&mut output, views.mission.as_ref())?;
    write_system_line(&mut output, views.system.as_ref())?;
    write_process_line(&mut output, views.process.as_ref())?;
    write_knowledge_line(&mut output, views.knowledge.as_ref())?;
    if let Some(failure) = &view.record_error {
        writeln!(output, "Recorded run unreadable: {failure}")?;
    }
    write_contracts(&mut output, view)?;
    write_mission_memory(&mut output, views.mission.as_ref())?;
    write_system_memory(&mut output, views.system.as_ref())?;
    write_process_memory(&mut output, views.process.as_ref())?;
    write_knowledge_memory(&mut output, views.knowledge.as_ref())?;
    write_bounded_tasks(&mut output, tasks)?;
    write_structure_issues(&mut output, view)?;
    write_runtime_primitives(&mut output, view)?;
    write_next(&mut output, view, views)?;
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
