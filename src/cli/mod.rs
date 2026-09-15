use blabla::application::AppConfig;
use blabla::diagnostic::{Diagnostic, Location};
use blabla::project::status::CompletionView;
use blabla::report::{
    DEFAULT_CASES, DEFAULT_STEPS, DEFAULT_TIMEOUT_MS, Failure, MAX_SHRINK_ATTEMPTS, RunOptions,
    RunReport, RunStatus, VerifyError,
};
use blabla::{runtime, semantics, structure, verify};
use clap::{Parser, Subcommand, error::ErrorKind};
use serde::Serialize;
use std::ffi::{OsStr, OsString};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

mod guide;
mod heartbeat;
mod init;
mod project;

const AGENT_WORKFLOW: &str = "AGENT WORKFLOW\nThe .bla contracts are authoritative intent: executable project memory with a BEHAVIOR layer (runtime behavior) and a STRUCTURE layer (codebase constraints).\nStart with `blabla status` (it finds project.bla for you); drill into one rule with `blabla explain <rule>`.\nRead a contract only when a rule is still unclear. Run `blabla finish` after meaningful changes and before declaring work complete.\nRED: repair the violated rule using the minimized counterexample or the observed structural fact.\nYELLOW: required behavior remains unexercised; NOT COMPLETE.\nGREEN per layer means its active behavioral or structural rules passed; only OVERALL GREEN is completion.\nDo not weaken contracts or the verification profile to obtain GREEN. Full onboarding: `blabla guide agent`.";

#[derive(Parser)]
#[command(
    name = "blabla",
    version,
    about = "BlaBla is executable project memory for coding agents.",
    after_help = AGENT_WORKFLOW
)]
struct Cli {
    #[arg(long, global = true, help = "Write one machine-readable JSON report")]
    json: bool,
    #[arg(
        long,
        global = true,
        help = "Include full state and original failure traces"
    )]
    verbose: bool,
    #[arg(
        long,
        global = true,
        value_name = "PATH",
        help = "Project manifest (project.bla) or its directory; default: the nearest project.bla above the working directory"
    )]
    project: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    #[command(
        about = "Check contract syntax, names and types without an application; without FILE, check the discovered project"
    )]
    Check { file: Option<PathBuf> },
    #[command(
        about = "Generate action sequences and verify application behavior; without FILE, verify the discovered project and record its status",
        after_long_help = r#"ADAPTER PROTOCOL
Read the .bla file for the application's state, actions and required behavior.
Expose those actions through UTF-8 JSON Lines on stdin/stdout. Each request has
an opaque id. Echo that id and wrap the response value in result:

  request:  {"id":"token","op":"reset"}
  response: {"id":"token","result":{"ok":true}}

  request:  {"id":"token","op":"call","name":"ACTION","args":[]}
  response: {"id":"token","result":{"ok":true}}

  request:  {"id":"token","op":"observe"}
  response: {"id":"token","result":STATE_OBJECT}

ACTION and argument types come from action declarations. STATE_OBJECT contains
the state variables declared in the contract, with their declared types.
Return {"ok":false,"error":"message"} inside result for adapter failures.
Flush one response per request. Send logs to stderr. Exit cleanly on stdin EOF.
Keep application data in cwd: each case gets an isolated temporary directory.
Use absolute script paths when launching an interpreter.
The reserved action restart() is the BlaBla runtime primitive runtime::restart
(blabla explain runtime::restart). Persist each completed operation.

WORKFLOW
The .bla contract is this project's executable memory and authoritative behavioral intent.
Read it when behavior is unclear. Run BlaBla after meaningful changes and before completion.
RED: repair behavior using minimized counterexamples. YELLOW: inspect remaining coverage targets.
GREEN: required behavioral obligations were meaningfully exercised and passed.
Do not weaken the contract merely to make verification pass. Reuse --seed to reproduce a run."#
    )]
    Run {
        file: Option<PathBuf>,
        #[arg(long, default_value_t = 0)]
        seed: u64,
        #[arg(long, default_value_t = DEFAULT_CASES, value_parser = positive_count)]
        cases: usize,
        #[arg(long, default_value_t = DEFAULT_STEPS, value_parser = positive_count)]
        steps: usize,
        #[arg(long, default_value_t = MAX_SHRINK_ATTEMPTS, value_parser = bounded_shrink_count, help = "Candidate shrink replays (0..256); zero keeps confirmation only")]
        shrink_budget: usize,
        #[arg(long, default_value_t = DEFAULT_TIMEOUT_MS, value_parser = clap::value_parser!(u64).range(1..=5000))]
        timeout_ms: u64,
        #[arg(last = true, required = true, num_args = 1.., help = "Application executable and arguments; in a project, relative paths resolve against the working directory")]
        application: Vec<OsString>,
    },
    #[command(
        about = "Verify structure and run the canonical behavior profile, then decide completion: exit 0 only for OVERALL GREEN"
    )]
    Finish,
    #[command(
        about = "Show the project's BEHAVIOR, STRUCTURE and OVERALL status with the completion gate: the agent entry point (exit 0 only for OVERALL GREEN)"
    )]
    Status,
    #[command(
        about = "Explain one rule: owning contract, rule text, required witnesses and counterexample, or the observed structural fact"
    )]
    Explain {
        #[arg(
            help = "Rule id such as sealing::sealed-restart or architecture::no-domain-restart, a unique label, an obligation id, or a runtime primitive such as runtime::restart"
        )]
        rule: String,
    },
    #[command(about = "Print a guide: agent workflow, contract bootstrap, or behavior change")]
    Guide {
        #[arg(value_enum)]
        topic: Option<guide::Topic>,
    },
    #[command(
        about = "Create project.bla with a draft starter contract; --agents adds an AGENTS.md block and a portable skill"
    )]
    Init {
        #[arg(
            long,
            value_name = "DIR",
            help = "Project directory; default: the working directory"
        )]
        dir: Option<PathBuf>,
        #[arg(long, help = "Project name; default: derived from the directory name")]
        name: Option<String>,
        #[arg(
            long,
            help = "Also add the AGENTS.md block and .agents/skills/blabla/SKILL.md"
        )]
        agents: bool,
        #[arg(
            long,
            help = "Print the plan and the AGENTS.md block without writing anything"
        )]
        dry_run: bool,
        #[arg(
            long,
            value_name = "ARG",
            num_args = 1..,
            help = "Application command for the canonical verification profile, e.g. --command python ./main.py"
        )]
        command: Vec<String>,
    },
}

#[derive(Serialize)]
struct CheckReport {
    status: &'static str,
    actions: usize,
    postconditions: usize,
    invariants: usize,
    forbidden: usize,
}

#[derive(Serialize)]
struct ErrorReport {
    status: &'static str,
    category: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completion: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    diagnostic: Option<Diagnostic>,
    #[serde(skip_serializing_if = "Option::is_none")]
    evidence: Option<Box<Failure>>,
}

fn positive_count(value: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .ok()
        .filter(|n| *n > 0)
        .ok_or_else(|| "must be a positive integer".into())
}

fn bounded_shrink_count(value: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .ok()
        .filter(|n| *n <= MAX_SHRINK_ATTEMPTS)
        .ok_or_else(|| "must be an integer from 0 through 256".into())
}

fn write_json(value: &impl Serialize) -> io::Result<()> {
    let mut output = io::stdout().lock();
    serde_json::to_writer(&mut output, value)?;
    writeln!(output)
}

fn emit_error(error: ErrorReport, json: bool, exit: i32) -> i32 {
    let result = if json {
        write_json(&error)
    } else {
        let mut output = io::stderr().lock();
        (|| {
            writeln!(output, "ERROR [{}]: {}", error.category, error.message)?;
            if let Some(seed) = error.seed {
                writeln!(output, "seed: {seed}")?;
            }
            if let Some(diagnostic) = error.diagnostic {
                writeln!(
                    output,
                    "{}:{}:{} [{}] {}",
                    diagnostic.location.file,
                    diagnostic.location.line,
                    diagnostic.location.column,
                    diagnostic.code,
                    diagnostic.message
                )?;
            }
            if error.completion.is_some() {
                writeln!(
                    output,
                    "\nCOMPLETION GATE: BLOCKED (verification did not run to a result)"
                )?;
            }
            Ok(())
        })()
    };
    if result.is_ok() { exit } else { 4 }
}

fn error(category: &'static str, message: impl Into<String>, seed: Option<u64>) -> ErrorReport {
    ErrorReport {
        status: "error",
        category,
        message: message.into(),
        code: None,
        seed,
        completion: None,
        diagnostic: None,
        evidence: None,
    }
}

fn contract_error(diagnostic: Diagnostic, seed: Option<u64>) -> (ErrorReport, i32) {
    let mut report = error("contract", diagnostic.message.clone(), seed);
    report.diagnostic = Some(diagnostic);
    (report, 2)
}

fn emit_contract_error(diagnostic: Diagnostic, json: bool, seed: Option<u64>) -> i32 {
    let (report, exit) = contract_error(diagnostic, seed);
    emit_error(report, json, exit)
}

fn verify_error(failure: VerifyError, seed: u64) -> (ErrorReport, i32) {
    match failure {
        VerifyError::Contract(diagnostic) => contract_error(diagnostic, Some(seed)),
        VerifyError::Application(failure) => {
            let mut report = error(
                "application",
                format!("[{}] {}", failure.code, failure.message),
                Some(seed),
            );
            report.code = Some(failure.code);
            (report, 3)
        }
        VerifyError::Unstable { message, failure } => {
            let mut report = error("unstable_reproduction", message, Some(seed));
            report.evidence = Some(failure);
            (report, 3)
        }
        VerifyError::Internal(message) => (error("internal", message, Some(seed)), 4),
    }
}

fn emit_verify_error(failure: VerifyError, json: bool, seed: u64) -> i32 {
    let (report, exit) = verify_error(failure, seed);
    emit_error(report, json, exit)
}

#[derive(Serialize)]
struct RunOutput<'a> {
    timeout_ms: u64,
    #[serde(flatten)]
    report: &'a RunReport,
    #[serde(skip_serializing_if = "Option::is_none")]
    project: Option<&'a blabla::project::status::StatusView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completion: Option<&'a CompletionView>,
}

fn emit_run(
    report: RunReport,
    json: bool,
    verbose: bool,
    timeout_ms: u64,
    project: Option<&blabla::project::status::StatusView>,
    gate: bool,
) -> i32 {
    let behavior_exit = match (&report.status, &report.failure) {
        (RunStatus::Green, None)
            if report.coverage_summary.unexercised == 0
                && report.coverage_summary.violated == 0 =>
        {
            0
        }
        (RunStatus::Yellow, None)
            if report.coverage_summary.unexercised > 0 && report.coverage_summary.violated == 0 =>
        {
            5
        }
        (RunStatus::Red, Some(_)) if report.coverage_summary.violated > 0 => 1,
        _ => {
            return emit_error(
                error(
                    "internal",
                    "inconsistent verifier report",
                    Some(report.seed),
                ),
                json,
                4,
            );
        }
    };
    let exit = match project {
        Some(view) if gate => view.exit,
        _ => behavior_exit,
    };
    let result = if json {
        write_json(&RunOutput {
            timeout_ms,
            report: &report,
            project,
            completion: if gate {
                project.map(|view| &view.completion)
            } else {
                None
            },
        })
    } else {
        write_human_run(&report, verbose).and_then(|()| match project {
            Some(view) => {
                let mut output = io::stdout().lock();
                writeln!(output, "\nProject: {}\n", view.project)?;
                project::write_layers(&mut output, view)?;
                project::write_contracts(&mut output, view)?;
                project::write_structure_issues(&mut output, view)?;
                project::write_next(&mut output, view)?;
                writeln!(
                    output,
                    "\nRecorded to {}; blabla status shows this result until contracts, implementation or the verification profile change.",
                    blabla::project::status::record_path(Path::new(&view.manifest).parent().unwrap_or(Path::new(".")))
                        .display()
                )?;
                if gate {
                    project::write_gate(&mut output, view)
                } else {
                    project::write_completion(&mut output, view)
                }
            }
            None => Ok(()),
        })
    };
    if result.is_ok() { exit } else { 4 }
}

fn write_human_run(report: &RunReport, verbose: bool) -> io::Result<()> {
    let mut output = io::stdout().lock();
    let status = match report.status {
        RunStatus::Green => "GREEN",
        RunStatus::Yellow => "YELLOW",
        RunStatus::Red => "RED",
    };
    let coverage = &report.coverage_summary;
    let total = coverage.verified + coverage.unexercised + coverage.violated;
    writeln!(
        output,
        "BlaBla\n\nBEHAVIOR  {}/{}  {status}",
        coverage.verified, total
    )?;
    writeln!(
        output,
        "\nCoverage:\n  GREEN   {}\n  YELLOW  {}\n  RED     {}",
        coverage.verified, coverage.unexercised, coverage.violated
    )?;
    writeln!(
        output,
        "\nActions: {} / {} budget",
        report.steps_executed, report.metrics.action_budget
    )?;
    writeln!(output, "seed: {}", report.seed)?;
    writeln!(
        output,
        "cases checked: {} / {}",
        report.cases_executed, report.cases
    )?;
    writeln!(output, "actions checked: {}", report.steps_executed)?;
    if let Some(failure) = &report.failure {
        writeln!(output, "\n{} violated", failure.property)?;
        let fixed = failure.shrink.status == blabla::report::ShrinkStatus::FixedPoint;
        writeln!(
            output,
            "\n{} sequence:",
            if fixed { "minimal" } else { "reduced" }
        )?;
        write_calls(&mut output, &failure.sequence)?;
        writeln!(output, "\npredicate: {}", failure.predicate)?;
        if let (Some(expected), Some(actual)) = (&failure.expected, &failure.actual) {
            writeln!(output, "expected: {expected}")?;
            writeln!(output, "actual: {actual}")?;
        } else {
            writeln!(output, "expected predicate: true\nactual predicate: false")?;
        }
        writeln!(
            output,
            "\noriginal sequence length: {}",
            failure.original_sequence_length
        )?;
        writeln!(
            output,
            "minimal sequence length: {}",
            failure.minimal_sequence_length
        )?;
        writeln!(
            output,
            "counterexample reduction: {}",
            serde_json::to_string(&failure.shrink.status)?
        )?;
        if let Some(reason) = &failure.shrink.reason {
            writeln!(output, "reduction stopped: {reason}")?;
        }
        if verbose {
            writeln!(
                output,
                "source: {}:{}:{}",
                failure.location.file, failure.location.line, failure.location.column
            )?;
            writeln!(output, "before: {}", failure.before)?;
            writeln!(output, "input: {}", failure.input)?;
            writeln!(output, "after: {}", failure.after)?;
            writeln!(
                output,
                "candidate replays: {}; confirmations: {}",
                failure.shrink.attempts, failure.shrink.confirmations
            )?;
            writeln!(output, "original sequence:")?;
            write_calls(&mut output, &failure.original_sequence)?;
        }
    }
    if report.status == RunStatus::Yellow {
        writeln!(output, "\nUnexercised:")?;
        for obligation in &coverage.coverage {
            if obligation.status != blabla::report::CoverageStatus::Unexercised {
                continue;
            }
            writeln!(
                output,
                "  {}\n    evaluations: {}; meaningful witnesses: {}\n    Required witness: {}",
                obligation.id,
                obligation.evaluations,
                obligation.witnesses,
                obligation.required_witness
            )?;
        }
        writeln!(
            output,
            "\nBehavior is not fully verified under seed {}, {} cases x {} actions. NOT COMPLETE.",
            report.seed, report.cases, report.steps
        )?;
    } else if report.status == RunStatus::Green {
        writeln!(
            output,
            "\nNo behavioral drift detected in the recorded campaign. GREEN."
        )?;
    }
    Ok(())
}

fn write_calls(output: &mut impl Write, calls: &[blabla::report::Call]) -> io::Result<()> {
    if calls.is_empty() {
        writeln!(output, "  (initial state; no actions)")?;
    }
    for (index, call) in calls.iter().enumerate() {
        let arguments = call
            .args
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        writeln!(output, "  {}. {}({})", index + 1, call.action, arguments)?;
    }
    Ok(())
}

fn execute(cli: Cli) -> i32 {
    let json = cli.json;
    let cwd = match std::env::current_dir() {
        Ok(cwd) => cwd,
        Err(failure) => return emit_error(error("invocation", failure.to_string(), None), json, 2),
    };
    let explicit = cli.project.as_deref();
    match cli.command {
        Command::Guide { topic } => {
            let text = guide::text(topic);
            let result = if json {
                #[derive(Serialize)]
                struct GuideOutput<'a> {
                    topic: Option<guide::Topic>,
                    text: &'a str,
                }
                write_json(&GuideOutput { topic, text })
            } else {
                io::stdout().lock().write_all(text.as_bytes())
            };
            if result.is_ok() { 0 } else { 4 }
        }
        Command::Init {
            dir,
            name,
            agents,
            dry_run,
            command,
        } => {
            let dir = match dir {
                Some(dir) if dir.is_absolute() => dir,
                Some(dir) => cwd.join(dir),
                None => cwd,
            };
            match init::run(&init::Options {
                dir,
                name,
                agents,
                dry_run,
                command,
            }) {
                Ok(outcome) => emit_init(&outcome, json),
                Err(message) => emit_error(error("init", message, None), json, 2),
            }
        }
        Command::Status => match project::load(explicit, &cwd, json, None) {
            Ok(project) => project::status(&project, json),
            Err(exit) => exit,
        },
        Command::Finish => match project::load(explicit, &cwd, json, None) {
            Ok(project) => project::finish(&project, json, cli.verbose),
            Err(exit) => exit,
        },
        Command::Explain { rule } if rule.starts_with(runtime::primitives::PREFIX) => {
            project::explain_runtime(explicit, &cwd, &rule, json)
        }
        Command::Explain { rule } => match project::load(explicit, &cwd, json, None) {
            Ok(project) => project::explain(&project, &rule, json),
            Err(exit) => exit,
        },
        Command::Check { file: None } => match project::load(explicit, &cwd, json, None) {
            Ok(project) => project::check(&project, json),
            Err(exit) => exit,
        },
        Command::Check { file: Some(file) } => check_file(&file, json),
        Command::Run {
            file,
            seed,
            cases,
            steps,
            shrink_budget,
            timeout_ms,
            application,
        } => {
            let options = RunOptions {
                seed,
                cases,
                steps,
                shrink_budget,
            };
            match file {
                None => match project::load(explicit, &cwd, json, Some(seed)) {
                    Ok(project) => project::run(
                        &project,
                        options,
                        timeout_ms,
                        &application,
                        json,
                        cli.verbose,
                        &cwd,
                    ),
                    Err(exit) => exit,
                },
                Some(file) => {
                    let contract = match compile_file(&file, json, Some(seed)) {
                        Ok(contract) => contract,
                        Err(exit) => return exit,
                    };
                    let mut executable = PathBuf::from(&application[0]);
                    if executable.is_relative() && executable.components().count() > 1 {
                        executable = cwd.join(executable);
                    }
                    let config = AppConfig {
                        executable,
                        args: application[1..].to_vec(),
                        timeout: Duration::from_millis(timeout_ms),
                    };
                    match verify::run(&contract, &options, || runtime::AppSession::spawn(&config)) {
                        Ok(report) => emit_run(report, json, cli.verbose, timeout_ms, None, false),
                        Err(failure) => emit_verify_error(failure, json, seed),
                    }
                }
            }
        }
    }
}

fn read_source(file: &Path, json: bool, seed: Option<u64>) -> Result<String, i32> {
    std::fs::read_to_string(file).map_err(|failure| {
        emit_contract_error(
            Diagnostic {
                location: Location {
                    file: file.to_string_lossy().into_owned(),
                    line: 1,
                    column: 1,
                },
                code: "E_SOURCE_IO".into(),
                message: failure.to_string(),
            },
            json,
            seed,
        )
    })
}

fn compile_file(file: &Path, json: bool, seed: Option<u64>) -> Result<blabla::ir::Contract, i32> {
    let filename = file.to_string_lossy();
    let source = read_source(file, json, seed)?;
    semantics::compile(&filename, &source)
        .map_err(|diagnostic| emit_contract_error(diagnostic, json, seed))
}

#[derive(Serialize)]
struct StructureCheckReport {
    status: &'static str,
    layer: &'static str,
    modules: usize,
    rules: usize,
}

fn check_file(file: &Path, json: bool) -> i32 {
    let source = match read_source(file, json, None) {
        Ok(source) => source,
        Err(exit) => return exit,
    };
    if !structure::syntax::is_structure_source(&source) {
        return match compile_file(file, json, None) {
            Ok(contract) => emit_check(&contract, json),
            Err(exit) => exit,
        };
    }
    let filename = file.to_string_lossy();
    let root = file.parent().unwrap_or(Path::new("."));
    let contract = match structure::syntax::parse(&filename, &source, root, None) {
        Ok(contract) => contract,
        Err(diagnostic) => return emit_contract_error(diagnostic, json, None),
    };
    let report = StructureCheckReport {
        status: "ok",
        layer: "structure",
        modules: contract.modules.len(),
        rules: contract.rules.len(),
    };
    let result = if json {
        write_json(&report)
    } else {
        writeln!(
            io::stdout().lock(),
            "OK\nstructure contract\n{} modules\n{} rules",
            report.modules,
            report.rules
        )
    };
    if result.is_ok() { 0 } else { 4 }
}

fn emit_check(contract: &blabla::ir::Contract, json: bool) -> i32 {
    let report = CheckReport {
        status: "ok",
        actions: contract.actions.len(),
        postconditions: contract
            .actions
            .iter()
            .map(|a| a.postconditions.len())
            .sum(),
        invariants: contract.invariants.iter().filter(|p| !p.forbidden).count(),
        forbidden: contract.invariants.iter().filter(|p| p.forbidden).count(),
    };
    let result = if json {
        write_json(&report)
    } else {
        writeln!(
            io::stdout().lock(),
            "OK\n{} actions\n{} postconditions\n{} invariants\n{} forbidden conditions",
            report.actions,
            report.postconditions,
            report.invariants,
            report.forbidden
        )
    };
    if result.is_ok() { 0 } else { 4 }
}

fn emit_init(outcome: &init::Outcome, json: bool) -> i32 {
    let result = if json {
        write_json(outcome)
    } else {
        let mut output = io::stdout().lock();
        (|| {
            writeln!(
                output,
                "BlaBla init{}: {} (project {})",
                if outcome.dry_run { " (dry run)" } else { "" },
                outcome.directory,
                outcome.name
            )?;
            for step in &outcome.steps {
                writeln!(output, "  {:<13} {}", step.action, step.path)?;
            }
            if let Some(parent) = &outcome.nested_in {
                writeln!(
                    output,
                    "note: an ancestor project exists at {parent}; this directory is a nested project and the nearest manifest wins"
                )?;
            }
            if outcome.dry_run
                && let Some(block) = &outcome.agents_block
            {
                writeln!(output, "\nAGENTS.md block:\n{block}")?;
            }
            writeln!(
                output,
                "\nThe starter contract is a draft: promote it by changing `draft behavior` to `use behavior` in project.bla once it states intended behavior.{}\nNext: blabla status",
                if outcome.profile {
                    ""
                } else {
                    "\nAdd the canonical verification to project.bla so `blabla finish` can run it:\n  verify behavior {\n      command [\"python\", \"./main.py\"]\n      steps 4096\n  }"
                }
            )
        })()
    };
    if result.is_ok() { 0 } else { 4 }
}

pub fn main() -> i32 {
    let arguments: Vec<OsString> = std::env::args_os().collect();
    let verifier_arguments: Vec<&OsStr> = arguments
        .iter()
        .skip(1)
        .map(OsString::as_os_str)
        .take_while(|a| *a != OsStr::new("--"))
        .collect();
    let json = verifier_arguments.contains(&OsStr::new("--json"));
    let seed = verifier_arguments
        .windows(2)
        .find(|pair| pair[0] == OsStr::new("--seed"))
        .and_then(|pair| pair[1].to_str()?.parse::<u64>().ok());
    let cli = match Cli::try_parse_from(arguments) {
        Ok(cli) => cli,
        Err(failure)
            if matches!(
                failure.kind(),
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion
            ) =>
        {
            return if failure.print().is_ok() { 0 } else { 4 };
        }
        Err(failure) => return emit_error(error("invocation", failure.to_string(), seed), json, 2),
    };
    let run_seed = match &cli.command {
        Command::Run { seed, .. } => Some(*seed),
        _ => None,
    };
    let verbose = cli.verbose;
    run_guarded(|| execute(cli), json, run_seed, verbose)
}

fn run_guarded(
    operation: impl FnOnce() -> i32 + std::panic::UnwindSafe,
    json: bool,
    seed: Option<u64>,
    verbose: bool,
) -> i32 {
    let hook = if verbose {
        None
    } else {
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        Some(hook)
    };
    let result = std::panic::catch_unwind(operation);
    if let Some(hook) = hook {
        std::panic::set_hook(hook);
    }
    match result {
        Ok(exit) => exit,
        Err(_) => emit_error(error("internal", "verifier panicked", seed), json, 4),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn internal_panics_exit_four_instead_of_becoming_behavioral_failures() {
        assert_eq!(
            super::run_guarded(
                || panic!("injected internal failure"),
                true,
                Some(17),
                false
            ),
            4
        );
    }
}
