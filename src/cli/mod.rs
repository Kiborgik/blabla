use blabla::application::AppConfig;
use blabla::diagnostic::{Diagnostic, ExchangeWitness, Location};
use blabla::project::status::CompletionView;
use blabla::report::{
    DEFAULT_CASES, DEFAULT_STEPS, DEFAULT_TIMEOUT_MS, Failure, MAX_SHRINK_ATTEMPTS, RunOptions,
    RunReport, RunStatus, VerifyError,
};
use blabla::{runtime, semantics, structure, verify};
use clap::{
    CommandFactory, Parser, Subcommand,
    error::{ContextKind, ContextValue, ErrorKind},
};
use serde::Serialize;
use std::ffi::{OsStr, OsString};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

mod expert;
mod guide;
mod heartbeat;
mod init;
mod project;
mod recovery;
mod task;

const AGENT_WORKFLOW: &str = "AGENT WORKFLOW\nThe .bla contracts are authoritative intent: executable project memory with a BEHAVIOR layer (runtime behavior) and a STRUCTURE layer (codebase constraints).\nStart with `blabla status` (it finds project.bla for you); drill into one rule with `blabla explain <rule>`.\nRead a contract only when a rule is still unclear. Run `blabla finish` after meaningful changes and before declaring work complete.\n`blabla explain flow::<name>` is the development loop; `blabla task` records one bounded change and `blabla challenge` contradicts the account of it from evidence BlaBla already has.\nRED: repair the violated rule using the minimized counterexample or the observed structural fact.\nYELLOW: required behavior remains unexercised; NOT COMPLETE.\nGREEN per layer means its active behavioral or structural rules passed; only OVERALL GREEN is completion.\nDo not weaken contracts or the verification profile to obtain GREEN. Full onboarding: `blabla guide agent`.";

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
        about = "Check syntax, names and types without an application; without FILE, check active and draft contracts only",
        after_long_help = "Registered memory contents are not validated by a check without FILE. After editing memory, run blabla check FILE.bla with the edited file's path. Use blabla status to inspect registered memory and cross-file references. Checking a file does not decide project completion."
    )]
    Check {
        file: Option<PathBuf>,
        #[arg(
            long,
            help = "Ask whether each rule can be made to fail, by inverting the fact it names in the already-inspected facts; with FILE one structure contract, without FILE every active structure contract of the discovered project; writes nothing"
        )]
        falsify: bool,
    },
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
        #[arg(
            long,
            value_parser = clap::value_parser!(u64).range(1..=runtime::MAX_TIMEOUT.as_millis() as u64),
            help = "Allowance for one request and its response; defaults to 1000 ms, or the project profile's timeout_ms if given a contract FILE inside a project"
        )]
        timeout_ms: Option<u64>,
        #[arg(
            long,
            value_parser = clap::value_parser!(u64).range(1..=60000),
            help = "Allowance for the first exchange after each process start; defaults to timeout_ms, or the project profile's startup_ms if given a contract FILE inside a project"
        )]
        startup_ms: Option<u64>,
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
        about = "List registered files and discover unregistered .bla files without loading or verifying them"
    )]
    Inventory {
        #[arg(long, default_value_t = blabla::project::inventory::DEFAULT_MAX_ENTRIES as u32, value_parser = clap::value_parser!(u32).range(1..=100_000), help = "Directory-entry budget including skipped entries, plus one probe to detect overflow; incomplete discovery exits 1")]
        max_entries: u32,
    },
    #[command(
        about = "Explain one rule: owning contract, rule text, required witnesses and counterexample, or the observed structural fact; also resolves a system, responsibility or seam from the project's architectural memory"
    )]
    Explain {
        #[arg(
            help = "Rule id such as sealing::sealed-restart or architecture::no-domain-restart, a unique label, an obligation id, a runtime primitive such as runtime::restart, or a system, responsibility or seam name listed by blabla status"
        )]
        rule: String,
    },
    #[command(
        about = "Print a guide: agent workflow, contract bootstrap, behavior change, or authoring project memory"
    )]
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
            help = "Also add the AGENTS.md block and the skill under .agents/skills/blabla/ and .claude/skills/blabla/"
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
    #[command(
        about = "Record and read one bounded task: the role it was given to, the paths it may write, the deliverables it owes and the findings raised during it"
    )]
    Task {
        #[command(subcommand)]
        action: Box<TaskAction>,
    },
    #[command(
        about = "Evaluate, record, reserve and replay bounded expert advice independently of completion"
    )]
    Expert {
        #[command(subcommand)]
        action: expert::Action,
    },
    #[command(
        about = "Hold current work against recorded evidence; for an accepted task, record whether its hand-back prerequisites are clear"
    )]
    Challenge {
        #[arg(
            help = "Bounded task to challenge; without one, the project-wide challenges are reported"
        )]
        task: Option<String>,
    },
}

#[derive(Subcommand)]
enum TaskAction {
    #[command(about = "Record a bounded task and snapshot the tree it starts from")]
    Open {
        name: String,
        #[arg(long, help = "The role carrying it, as declared by process memory")]
        role: String,
        #[arg(long, help = "What the task is, in one sentence")]
        statement: String,
        #[arg(
            long,
            value_name = "PATH",
            num_args = 1..,
            help = "A path the task may write; repeat or list several"
        )]
        scope: Vec<String>,
        #[arg(
            long,
            value_name = "PATH",
            num_args = 1..,
            help = "A path the task owes as a deliverable; repeat or list several"
        )]
        deliverable: Vec<String>,
        #[arg(
            long,
            value_name = "PROG",
            num_args = 1..,
            allow_hyphen_values = true,
            help = "The check that covers this task: a program and its arguments, run without a shell and recorded as its evidence"
        )]
        check: Vec<String>,
        #[arg(long, value_name = "PATH", num_args = 1.., help = "Check inputs; defaults to write scope. Deliverables are always included")]
        input: Vec<String>,
        #[arg(long, help = "The declared goal this task serves")]
        goal: Option<String>,
        #[arg(
            long,
            value_name = "NAME",
            help = "The distinct existing task this review inspects"
        )]
        review_of: Option<String>,
        #[arg(
            long,
            value_name = "PACK",
            help = "A consulted pack this task must assess; repeat for several. When none is named, every pack the role consults is required"
        )]
        lens: Vec<String>,
        #[arg(
            long,
            value_name = "PATH",
            num_args = 1..,
            help = "A file in the write scope whose opened contents the check must fail on; repeat or list several"
        )]
        falsify: Vec<String>,
        #[arg(
            long,
            help = "Ask hand-back for one claim per affected intent: each system whose paths the write scope falls in, and the goal"
        )]
        intent: bool,
    },
    #[command(about = "Record something discovered during the task that is not yet settled")]
    Finding { name: String, statement: String },
    #[command(
        about = "Say what the carrying role did about a finding; the orchestrator still resolves it"
    )]
    Addressed {
        name: String,
        id: usize,
        statement: String,
        #[arg(
            long,
            value_name = "ID",
            help = "The model carrying the task; must be one its role permits"
        )]
        model: String,
    },
    #[command(about = "Record what settled a finding; the evidence is your claim, never BlaBla's")]
    Resolve {
        name: String,
        id: usize,
        #[arg(
            long,
            help = "What settled it: a file, a line, a command and what it showed"
        )]
        evidence: String,
        #[arg(
            long,
            value_name = "ID",
            help = "The orchestrator model settling it; must be one role::orchestrator permits"
        )]
        model: String,
    },
    #[command(
        about = "Ask the carrying role a typed question it must pick before hand-back; the pick is measured against the question's floor, which is never below the role's"
    )]
    Ask {
        name: String,
        question: String,
        #[arg(
            long,
            value_name = "A,B,C",
            help = "The options of a choice, comma-separated; without it the question is yes-no"
        )]
        options: Vec<String>,
        #[arg(
            long,
            allow_negative_numbers = true,
            help = "The confidence a pick needs to stand, 0-100 and not below the carrying role's block_below; default: the role's floor"
        )]
        floor: Option<i64>,
        #[arg(
            long,
            value_name = "ID",
            help = "The orchestrator model asking; must be one role::orchestrator permits"
        )]
        model: String,
    },
    #[command(
        about = "Ask a call you are not sure of as a typed question with the option you would pick and how sure you are, or pick a question the orchestrator asked with --on; below the floor the task is BLOCKED until the orchestrator answers"
    )]
    Decide {
        name: String,
        question: Option<String>,
        #[arg(
            long,
            value_name = "QUESTION-ID",
            help = "Pick the question the orchestrator asked under this id; its text and options come from the question"
        )]
        on: Option<String>,
        #[arg(
            long,
            help = "The option you would pick: yes or no, or one of --options"
        )]
        pick: String,
        #[arg(
            long,
            allow_negative_numbers = true,
            help = "How sure you are of the pick, as a whole-number percentage 0-100"
        )]
        confidence: i64,
        #[arg(
            long,
            value_name = "ID",
            help = "The model carrying the task; must be one its role permits"
        )]
        model: String,
        #[arg(
            long,
            value_name = "A,B,C",
            help = "The options of a choice, comma-separated; without it the question is yes-no"
        )]
        options: Vec<String>,
    },
    #[command(
        about = "Answer a decision: settle one below the floor or review one that stood; a different pick overrules it. The worker resumes with task accept"
    )]
    Answer {
        name: String,
        id: usize,
        #[arg(long, help = "The option the orchestrator picks")]
        pick: String,
        #[arg(long, help = "Why, in words the worker acts on")]
        reason: String,
        #[arg(
            long,
            value_name = "ID",
            help = "The orchestrator model answering; must be one role::orchestrator permits"
        )]
        model: String,
    },
    #[command(
        about = "After hand-back, confirm every record made under an orchestrator model while a worker carried the task; refused while the task is carried, the list is kept and --model stays an attestation, not proof"
    )]
    Confirm {
        name: String,
        #[arg(
            long,
            value_name = "ID",
            help = "The orchestrator model confirming; must be one role::orchestrator permits"
        )]
        model: String,
    },
    #[command(about = "Record a note on the task that is not unsettled work")]
    Note { name: String, statement: String },
    #[command(
        about = "Widen a bounded task's write scope deliberately, or release a path that has not changed since the task opened"
    )]
    Scope {
        name: String,
        #[arg(
            long,
            value_name = "PATH",
            num_args = 1..,
            required_unless_present = "remove",
            conflicts_with = "remove",
            help = "A path to add to the write scope; repeat or list several"
        )]
        add: Vec<String>,
        #[arg(
            long,
            value_name = "PATH",
            num_args = 1..,
            required_unless_present = "add",
            conflicts_with = "add",
            help = "A path to release from the write scope; refused when the path, or a file under it, changed since the task opened"
        )]
        remove: Vec<String>,
        #[arg(
            long,
            value_name = "ID",
            help = "The orchestrator model recording the amendment; an attestation, not proof"
        )]
        model: Option<String>,
    },

    #[command(about = "Replace the statement of a task that is not closed or withdrawn")]
    Statement {
        name: String,
        #[arg(help = "The new statement of the task, in one sentence")]
        text: String,
        #[arg(
            long,
            value_name = "ID",
            help = "The orchestrator model recording the amendment; an attestation, not proof"
        )]
        model: Option<String>,
    },
    #[command(
        about = "Accept the result of a bounded task and close it; refused while a grounded challenge stands"
    )]
    Close {
        name: String,
        #[arg(long, help = "The model recording the acceptance of the result")]
        model: String,
        #[arg(
            long,
            group = "result_mode",
            help = "Accept only the current bounded result after qualified implementation-only verification drift"
        )]
        bounded: bool,
        #[arg(
            long,
            requires = "result_mode",
            help = "Owner reason for the explicitly bounded result"
        )]
        reason: Option<String>,
    },
    #[command(about = "Withdraw an assignment, release ownership and retain unresolved changes")]
    Withdraw {
        name: String,
        #[arg(long)]
        reason: String,
        #[arg(long)]
        model: String,
    },
    #[command(
        about = "Reconcile a withdrawn path against current evidence from a closed successor"
    )]
    ReconcileWithdrawal {
        name: String,
        #[arg(num_args = 1.., required = true, value_name = "PATH")]
        path: Vec<String>,
        #[arg(long)]
        successor: String,
        #[arg(long)]
        model: String,
    },
    #[command(about = "Show one bounded task, or every recorded task without a name")]
    Show { name: Option<String> },
    #[command(about = "Explain receipt-relative task freshness without changing records")]
    Freshness { name: String },
    #[command(about = "Accept a task and record which model took it")]
    Accept {
        name: String,
        #[arg(long, help = "The model that accepted the task")]
        model: String,
        #[arg(
            long,
            requires = "reason",
            help = "Guarded original execution reuse for an ACCEPTED/READY review"
        )]
        reuse_evidence: bool,
        #[arg(long, requires = "reuse_evidence")]
        reason: Option<String>,
    },
    #[command(about = "Block a task due to a reason and record it as a finding")]
    Block { name: String, reason: String },
    #[command(
        about = "Mark a task as ready for review, recording its goal outcome, intent claims, lens assessments and notes in the same write"
    )]
    Ready {
        name: String,
        #[arg(
            long,
            value_name = "OUTCOME",
            help = "The goal outcome claimed: delivered, partial, blocked or not-applicable; required when the task serves a goal"
        )]
        outcome: Option<String>,
        #[arg(
            long,
            num_args = 2,
            value_names = ["PACK", "TEXT"],
            action = clap::ArgAction::Append,
            help = "One lens assessment, recorded as task lens would; repeat for several"
        )]
        lens: Vec<String>,
        #[arg(
            long,
            value_name = "TEXT",
            help = "A note, recorded as task note would; repeat for several"
        )]
        note: Vec<String>,
        #[arg(
            long,
            value_name = "INTENT=CLAIM",
            help = "One claim for an affected intent, updated or unchanged; repeat for several"
        )]
        claim: Vec<String>,
    },
    #[command(about = "Report time per task phase from the record, without writing anything")]
    Budget { name: String },
    #[command(
        about = "Append an assessment against one lens the role consults, named by its knowledge pack"
    )]
    Lens {
        name: String,
        lens: String,
        statement: String,
        #[arg(
            long,
            value_name = "MODEL",
            help = "The accepted model recording this assessment; refused when it is not the accepted model"
        )]
        model: Option<String>,
    },
    #[command(about = "Propose an alternative model with a reason")]
    ProposeModel {
        name: String,
        model: String,
        #[arg(long, help = "Why this model is proposed")]
        reason: String,
    },
    #[command(about = "Record the owner's ruling on a proposed model")]
    ApproveModel {
        name: String,
        model: String,
        #[arg(long, help = "The owner's ruling, transcribed from their words")]
        approval: String,
    },
    #[command(
        about = "Declare the check that covers this task, or correct the one it declares; a result is bound to the check it answers"
    )]
    Check {
        name: String,
        #[arg(
            long,
            value_name = "PROG",
            num_args = 1..,
            allow_hyphen_values = true,
            help = "The check: a program and its arguments, run without a shell"
        )]
        check: Vec<String>,
        #[arg(long, value_name = "PATH", num_args = 1.., help = "Replace the check inputs; omission preserves the current binding. Deliverables are always included")]
        input: Vec<String>,
        #[arg(
            long,
            conflicts_with = "input",
            help = "Explicitly reset check inputs to the write-scope default; deliverables remain included"
        )]
        reset_inputs: bool,
        #[arg(long, value_name = "PATH", num_args = 1.., help = "Also add write-scope paths in the same atomic check amendment")]
        add_scope: Vec<String>,
        #[arg(
            long,
            value_name = "ID",
            help = "The orchestrator model recording the amendment; an attestation, not proof"
        )]
        model: Option<String>,
    },
    #[command(
        about = "Add or remove a deliverable the task owes; a record that lost one owes it again once it is named"
    )]
    Deliverable {
        name: String,
        #[arg(long, value_name = "PATH", num_args = 1.., help = "Paths to add to the task's deliverables")]
        add: Vec<String>,
        #[arg(
            long,
            value_name = "PATH",
            conflicts_with = "add",
            help = "Path to remove from deliverables; a directory withdraws every file owed under it"
        )]
        remove: Option<String>,
        #[arg(
            long,
            requires = "remove",
            help = "Reason the deliverable was withdrawn"
        )]
        reason: Option<String>,
        #[arg(
            long,
            value_name = "ID",
            requires = "remove",
            help = "The orchestrator model making this withdrawal"
        )]
        model: Option<String>,
    },
    #[command(
        about = "Record the outcome of the task's declared check, bound to the inputs it saw: the write scope or declared inputs, plus the deliverables"
    )]
    #[command(group(clap::ArgGroup::new("outcome").required(true).args(["exit", "run"])))]
    Evidence {
        name: String,
        #[arg(long, requires = "tool", help = "Exit code the check reported")]
        exit: Option<i32>,
        #[arg(
            long,
            requires = "exit",
            conflicts_with = "run",
            help = "Tool that produced it, such as cargo or pytest"
        )]
        tool: Option<String>,
        #[arg(long, help = "Execute the declared check and record what it reported")]
        run: bool,
        #[arg(
            long,
            requires = "run",
            conflicts_with = "exit",
            help = "After recording the check, return status 1 if its numeric exit was nonzero"
        )]
        fail_on_check: bool,
    },
    #[command(
        about = "Run the declared check against the opened contents of the task's falsify paths and record whether it fails; the current files are restored"
    )]
    Falsify { name: String },
    #[command(
        about = "State where a changed path came from: the task itself, concurrent work, or unknown"
    )]
    Attribute {
        name: String,
        #[arg(required = true, num_args = 1.., value_name = "PATH")]
        paths: Vec<String>,
        #[arg(long, help = "task, concurrent or unknown")]
        kind: String,
        #[arg(
            long,
            value_name = "ID",
            help = "The orchestrator model deciding the origin; must be one role::orchestrator permits"
        )]
        model: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    exchange_witness: Option<Box<ExchangeWitness>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    suggested: Option<String>,
}

fn suggested_argument(failure: &clap::Error) -> Option<String> {
    match failure.get(ContextKind::SuggestedArg)? {
        ContextValue::String(argument) => Some(argument.clone()),
        ContextValue::Strings(arguments) => arguments.first().cloned(),
        _ => None,
    }
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

fn write_view<T: Serialize>(
    json: bool,
    view: &T,
    render: impl FnOnce(&T) -> io::Result<()>,
) -> io::Result<()> {
    if json { write_json(view) } else { render(view) }
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
            if let Some(witness) = &error.exchange_witness {
                writeln!(
                    output,
                    "exchange: request_id={} op={:?} pid={:?} bytes={} allowance={:?} budget_ms={} phase={:?} elapsed_ms={} phase_elapsed_ms={} remaining_ms={} child_before_cleanup={:?}; transport: writer={:?} completion_received={} reader={:?} received_ordinal={:?} correlated_ordinal={:?}",
                    witness.request_id,
                    witness.operation,
                    witness.child_pid,
                    witness.request_bytes,
                    witness.allowance,
                    witness.budget_ms,
                    witness.phase,
                    witness.elapsed_ms,
                    witness.phase_elapsed_ms,
                    witness.remaining_ms,
                    witness.child_status,
                    witness.writer_produced,
                    witness.writer_completion_received,
                    witness.reader_produced,
                    witness.reader_received_ordinal,
                    witness.reader_correlated_ordinal,
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
        exchange_witness: None,
        suggested: None,
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
            report.exchange_witness = failure.exchange_witness;
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
    #[serde(skip_serializing_if = "Option::is_none")]
    challenge: Option<&'a blabla::skeptic::ChallengeReport>,
}

#[derive(Clone, Copy)]
pub(super) struct Rendering {
    pub(super) json: bool,
    pub(super) verbose: bool,
    pub(super) voice: blabla::voice::Voice,
}

fn emit_run(
    report: RunReport,
    shown: Rendering,
    timeout_ms: u64,
    project: Option<&blabla::project::status::StatusView>,
    gate: bool,
    challenge: Option<&blabla::skeptic::ChallengeReport>,
) -> i32 {
    let Rendering {
        json,
        verbose,
        voice,
    } = shown;
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
            challenge,
        })
    } else {
        write_human_run(&report, verbose).and_then(|()| match project {
            Some(view) => {
                let mut output = io::stdout().lock();
                writeln!(output, "\nProject: {}\n", view.project)?;
                project::write_layers(&mut output, view)?;
                project::write_contracts(&mut output, view)?;
                project::write_structure_issues(&mut output, view)?;
                project::write_next(&mut output, view, &project::MemoryViews::default())?;
                writeln!(
                    output,
                    "\nRecorded to {}; blabla status shows this result until contracts, implementation or the verification profile change.",
                    blabla::project::status::record_path(Path::new(&view.manifest).parent().unwrap_or(Path::new(".")))
                        .display()
                )?;
                if gate {
                    project::write_gate(&mut output, view)?;
                } else {
                    project::write_completion(&mut output, view)?;
                }
                match challenge {
                    Some(report) => {
                        project::write_standing_challenge(&mut output, report, voice, verbose)
                    }
                    None => Ok(()),
                }
            }
            None => Ok(()),
        })
    };
    if result.is_ok() { exit } else { 4 }
}

fn write_human_run(report: &RunReport, verbose: bool) -> io::Result<()> {
    let mut output = io::stdout().lock();
    let status = project::run_word(&report.status);
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
        report.cases_executed,
        report.metrics.action_budget / report.steps
    )?;
    writeln!(output, "actions checked: {}", report.steps_executed)?;
    if !report.campaigns.is_empty() {
        writeln!(output, "campaigns: {}", report.campaigns.len())?;
    }
    if verbose {
        for campaign in &report.campaigns {
            writeln!(
                output,
                "  {}  {}  seed {}  {} / {} actions  full coverage at {}",
                campaign
                    .contracts
                    .iter()
                    .map(|name| format!("contract::{name}"))
                    .collect::<Vec<_>>()
                    .join(", "),
                project::run_word(&campaign.status),
                campaign.seed,
                campaign.steps_executed,
                campaign.ceiling,
                campaign
                    .actions_to_full_coverage
                    .map_or_else(|| "none".to_owned(), |actions| actions.to_string())
            )?;
        }
    }
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

#[derive(Serialize)]
pub(super) struct CapabilityReport {
    pub(super) providers: Vec<structure::Capability>,
    pub(super) inspected_extensions: &'static [&'static str],
}

impl CapabilityReport {
    pub(super) fn of(root: &Path) -> CapabilityReport {
        CapabilityReport {
            providers: structure::capabilities(root, &structure::default_providers()),
            inspected_extensions: &structure::INSPECTED_EXTENSIONS,
        }
    }

    pub(super) fn write(&self, output: &mut impl Write) -> io::Result<()> {
        writeln!(output, "\nStructure providers:")?;
        for capability in &self.providers {
            let reach = match &capability.unavailable {
                Some(reason) => format!("cannot run here: {reason}"),
                None => format!("symbols {} deep", capability.symbol_depth),
            };
            writeln!(
                output,
                "  {:<12} {:<28} {reach}",
                capability.provider,
                capability.extensions.join(" ")
            )?;
        }
        writeln!(
            output,
            "  A file BlaBla cannot inspect has no observed fact; a rule over it is unevaluable, never GREEN."
        )
    }
}

fn verb(command: &Command) -> &'static str {
    match command {
        Command::Check { .. } => "check",
        Command::Run { .. } => "run",
        Command::Finish => "finish",
        Command::Status => "status",
        Command::Inventory { .. } => "inventory",
        Command::Explain { .. } => "explain",
        Command::Guide { .. } => "guide",
        Command::Init { .. } => "init",
        Command::Task { .. } => "task",
        Command::Challenge { .. } => "challenge",
        Command::Expert { .. } => "expert",
    }
}

fn execute(cli: Cli) -> i32 {
    let json = cli.json;
    let cwd = match std::env::current_dir() {
        Ok(cwd) => cwd,
        Err(failure) => return emit_error(error("invocation", failure.to_string(), None), json, 2),
    };
    let explicit = cli.project.as_deref();
    if let Some(identity) = recovery::running()
        && let Some(message) = recovery::withhold(identity, verb(&cli.command))
    {
        return emit_error(error("recovery", message, None), json, 2);
    }
    match cli.command {
        Command::Expert { action } => expert::execute(action, explicit, &cwd, json),
        Command::Guide { topic } => {
            let text = guide::text(topic);
            let result = if json {
                #[derive(Serialize)]
                struct GuideOutput<'a> {
                    topic: Option<guide::Topic>,
                    text: &'a str,
                }
                write_json(&GuideOutput {
                    topic,
                    text: text.as_ref(),
                })
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
            Ok(project) => project::status(&project, json, cli.verbose),
            Err(exit) => exit,
        },
        Command::Inventory { max_entries } => {
            project::inventory(explicit, &cwd, json, max_entries as usize)
        }
        Command::Finish => match project::load(explicit, &cwd, json, None) {
            Ok(project) => project::finish(&project, json, cli.verbose),
            Err(exit) => exit,
        },
        Command::Task { action } => match project::load(explicit, &cwd, json, None) {
            Ok(loaded) => task::execute(&loaded, *action, json, cli.verbose),
            Err(exit) => exit,
        },
        Command::Challenge { task: name } => match project::load(explicit, &cwd, json, None) {
            Ok(loaded) => task::challenge_locked(&loaded, name.as_deref(), json),
            Err(exit) => exit,
        },
        Command::Explain { rule } if rule.starts_with(runtime::primitives::PREFIX) => {
            project::explain_runtime(explicit, &cwd, &rule, json)
        }
        Command::Explain { rule } => match project::load(explicit, &cwd, json, None) {
            Ok(project) => project::explain(&project, &rule, json),
            Err(exit) => exit,
        },
        Command::Check {
            file: Some(file),
            falsify: true,
        } => falsify_file(&file, json),
        Command::Check {
            file: None,
            falsify: true,
        } => falsify_project(explicit, &cwd, json),
        Command::Check {
            file: None,
            falsify: false,
        } => match project::load(explicit, &cwd, json, None) {
            Ok(project) => project::check(&project, json),
            Err(exit) => exit,
        },
        Command::Check {
            file: Some(file),
            falsify: false,
        } => check_file(&file, json),
        Command::Run {
            file,
            seed,
            cases,
            steps,
            shrink_budget,
            timeout_ms,
            startup_ms,
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
                        timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS),
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
                    let (profile_timeout_ms, profile_startup_ms) = (|| {
                        let manifest_path = blabla::project::locate(explicit, &cwd).ok()?;
                        let manifest = blabla::project::read_manifest(&manifest_path).ok()?;
                        let profile = manifest.profile.as_ref()?;
                        let timeout = Some(profile.timeout_ms);
                        let startup = Some(profile.startup());
                        Some((timeout, startup))
                    })()
                    .unwrap_or((None, None));

                    let resolved_timeout_ms = timeout_ms
                        .or(profile_timeout_ms)
                        .unwrap_or(DEFAULT_TIMEOUT_MS);

                    let resolved_startup_ms = startup_ms
                        .or_else(|| {
                            if timeout_ms.is_some() {
                                Some(resolved_timeout_ms)
                            } else {
                                profile_startup_ms
                            }
                        })
                        .unwrap_or(resolved_timeout_ms);
                    let mut executable = PathBuf::from(&application[0]);
                    if executable.is_relative() && executable.components().count() > 1 {
                        executable = cwd.join(executable);
                    }
                    let config = AppConfig::launched(
                        executable,
                        application[1..].to_vec(),
                        Duration::from_millis(resolved_timeout_ms),
                    )
                    .booting_within(Duration::from_millis(resolved_startup_ms));
                    match verify::run(&contract, &options, || runtime::AppSession::spawn(&config)) {
                        Ok(report) => emit_run(
                            report,
                            Rendering {
                                json,
                                verbose: cli.verbose,
                                voice: blabla::voice::Voice::default(),
                            },
                            resolved_timeout_ms,
                            None,
                            false,
                            None,
                        ),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    project: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    evaluated: Option<StructureCheckEvaluation>,
}

#[derive(Serialize)]
struct StructureCheckEvaluation {
    state: &'static str,
    verified: usize,
    total: usize,
    issues: Vec<StructureCheckIssue>,
}

#[derive(Serialize)]
struct StructureCheckIssue {
    id: String,
    status: &'static str,
    observed: Option<String>,
    message: String,
}

fn check_file(file: &Path, json: bool) -> i32 {
    let source = match read_source(file, json, None) {
        Ok(source) => source,
        Err(exit) => return exit,
    };
    if let Some(kind) = blabla::memory::syntax::kind(&file.to_string_lossy(), &source) {
        return check_memory(file, &source, kind, json);
    }
    if !structure::syntax::is_structure_source(&source) {
        return match compile_file(file, json, None) {
            Ok(contract) => emit_check(&contract, json),
            Err(exit) => exit,
        };
    }
    let filename = file.to_string_lossy();
    let here = file
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let manifest = blabla::project::locate(None, here).ok();
    let root = manifest.as_ref().map_or(here, |path| {
        path.parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or(Path::new("."))
    });
    let group = registered_group(manifest.as_deref(), file);
    let contract = match structure::syntax::parse(&filename, &source, root, group.as_deref()) {
        Ok(contract) => contract,
        Err(diagnostic) => return emit_contract_error(diagnostic, json, None),
    };
    let ignore = manifest
        .as_deref()
        .and_then(|path| blabla::project::read_manifest(path).ok())
        .and_then(|loaded| blabla::project::load(loaded).ok())
        .map(|project| project.ignore)
        .unwrap_or_default();
    let evaluation = manifest.as_ref().map(|_| {
        structure::verify_with(
            std::slice::from_ref(&contract),
            root,
            &structure::default_providers(),
            &ignore,
        )
    });
    let exit = match &evaluation {
        Some(report) => match report.status {
            structure::LayerStatus::Red => 1,
            structure::LayerStatus::Error => 3,
            _ => 0,
        },
        None => 0,
    };
    let report = StructureCheckReport {
        status: match exit {
            1 => "red",
            3 => "error",
            _ => "ok",
        },
        layer: "structure",
        modules: contract.modules.len(),
        rules: contract.rules.len(),
        project: manifest.as_ref().map(|path| path.display().to_string()),
        evaluated: evaluation.as_ref().map(|report| StructureCheckEvaluation {
            state: report.status.word(),
            verified: report.verified,
            total: report.total(),
            issues: report
                .rules
                .iter()
                .filter(|rule| rule.status != structure::RuleStatus::Green)
                .map(|rule| StructureCheckIssue {
                    id: rule.id.clone(),
                    status: rule.status.word(),
                    observed: rule.observed.clone(),
                    message: rule.message.clone(),
                })
                .collect(),
        }),
    };
    let result = if json {
        write_json(&report)
    } else {
        let mut output = io::stdout().lock();
        writeln!(
            output,
            "{}\nstructure contract\n{} modules\n{} rules",
            report.status.to_uppercase(), report.modules, report.rules
        )
        .and_then(|()| match (&report.project, &report.evaluated) {
            (Some(manifest), Some(evaluated)) => {
                writeln!(
                    output,
                    "\nEvaluated against {manifest}\n{}/{} rules  {}",
                    evaluated.verified, evaluated.total, evaluated.state
                )?;
                for issue in &evaluated.issues {
                    writeln!(
                        output,
                        "  {:<6} {}  {}",
                        issue.status,
                        issue.id,
                        issue.observed.as_deref().unwrap_or(&issue.message)
                    )?;
                }
                if let Some(group) = &group {
                    writeln!(
                        output,
                        "\nblabla explain contract::{group}   this contract's rules and their canonical ids"
                    )?;
                }
                writeln!(
                    output,
                    "\nThis is one contract, not the project; blabla status and blabla finish remain the completion signal."
                )
            }
            _ => writeln!(
                output,
                "\nNo project.bla was found above this file, so its modules were not evaluated."
            ),
        })
    };
    if result.is_ok() { exit } else { 4 }
}

#[derive(Serialize)]
struct MemoryCheckReport<'a> {
    status: &'static str,
    memory: &'static str,
    file: &'a str,
    declarations: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    problems: Vec<String>,
    completion: &'static str,
}

fn check_memory(file: &Path, source: &str, kind: &'static str, json: bool) -> i32 {
    let display = file.to_string_lossy().into_owned();
    let blocks = match blabla::memory::syntax::parse(&display, source) {
        Ok(blocks) => blocks,
        Err(diagnostic) => return emit_contract_error(diagnostic, json, None),
    };
    let problems = match kind {
        "system" => match blabla::memory::system::build(&blocks) {
            Ok(built) => blabla::memory::system::validate(&built),
            Err(diagnostic) => return emit_contract_error(diagnostic, json, None),
        },
        "mission" => match blabla::memory::mission::build(&blocks) {
            Ok(built) => blabla::memory::mission::validate(&built),
            Err(diagnostic) => return emit_contract_error(diagnostic, json, None),
        },
        "knowledge" => match blabla::memory::knowledge::build(&blocks) {
            Ok(built) => blabla::memory::knowledge::validate(&built),
            Err(diagnostic) => return emit_contract_error(diagnostic, json, None),
        },
        "goal" => match blabla::memory::goal::build(&blocks) {
            Ok(built) => blabla::memory::goal::validate(&built),
            Err(diagnostic) => return emit_contract_error(diagnostic, json, None),
        },
        _ => match blabla::memory::process::build(&blocks) {
            Ok(built) => blabla::memory::process::validate(&built),
            Err(diagnostic) => return emit_contract_error(diagnostic, json, None),
        },
    };
    let valid = problems.is_empty();
    let report = MemoryCheckReport {
        status: if valid { "valid" } else { "invalid" },
        memory: kind,
        file: &display,
        declarations: blocks.len(),
        problems: problems.clone(),
        completion: "none",
    };
    let result = if json {
        write_json(&report)
    } else {
        let mut output = io::stdout().lock();
        writeln!(
            output,
            "{}\n{kind} memory\n{} declarations",
            if valid { "VALID" } else { "INVALID" },
            blocks.len()
        )
        .and_then(|()| {
            for problem in &problems {
                writeln!(output, "  {problem}")?;
            }
            if kind == "process" {
                writeln!(
                    output,
                    "\nVALID means the file is well formed and every reference resolves; the roles, policies and flows it declares bind the role that carries the work."
                )?;
            }
            if kind == "goal" {
                writeln!(
                    output,
                    "\nThis check reads the goals alone: it cannot see whether each `serves` names a declared priority or whether an expectation holds, which `blabla status` and `blabla explain goal::<name>` report against the registered project."
                )?;
            }
            if kind == "knowledge" {
                writeln!(
                    output,
                    "\nA ruling is reusable expertise, never an instruction to widen a task. This check reads the pack alone: it cannot see whether a system or a policy routes to it, which `blabla status` reports against the registered project."
                )?;
            }
            writeln!(
                output,
                "\nThis validates the file against itself: syntax, fields, names and internal references. It is never checked against the repository, and neither VALID nor INVALID takes part in completion."
            )
        })
    };
    if result.is_err() {
        return 4;
    }
    if valid { 0 } else { 2 }
}

fn registered_group(manifest: Option<&Path>, file: &Path) -> Option<String> {
    let same = |left: &Path, right: &Path| match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    };
    manifest
        .and_then(|path| blabla::project::read_manifest(path).ok())
        .and_then(|parsed| {
            parsed
                .entries
                .iter()
                .find(|entry| same(&entry.path, file))
                .map(|entry| entry.group.clone())
        })
        .or_else(|| {
            file.file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
        })
}

#[derive(Serialize)]
struct FalsificationReport<'a> {
    status: &'static str,
    operation: &'static str,
    layer: &'static str,
    contract: String,
    project: String,
    completion: &'static str,
    inspections: usize,
    total: usize,
    falsifiable: usize,
    vacuous: usize,
    unevaluable: usize,
    limits: &'static [&'static str],
    rules: &'a [structure::falsify::RuleFalsification],
}

#[derive(Serialize)]
struct ProjectFalsificationReport<'a> {
    status: &'static str,
    operation: &'static str,
    layer: &'static str,
    scope: &'static str,
    project: String,
    contracts: Vec<String>,
    active_structure: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    excluded_drafts: Vec<String>,
    completion: &'static str,
    inspections: usize,
    total: usize,
    falsifiable: usize,
    vacuous: usize,
    unevaluable: usize,
    limits: &'static [&'static str],
    rules: &'a [structure::falsify::RuleFalsification],
}

fn falsify_project(explicit: Option<&Path>, cwd: &Path, json: bool) -> i32 {
    let loaded = match project::load(explicit, cwd, json, None) {
        Ok(loaded) => loaded,
        Err(exit) => return exit,
    };
    let excluded_drafts: Vec<String> = loaded
        .drafts
        .iter()
        .filter(|draft| draft.layer == blabla::project::Layer::Structure)
        .map(|draft| draft.name.clone())
        .collect();
    if loaded.structure.is_empty() {
        let drafted = if excluded_drafts.is_empty() {
            String::new()
        } else {
            format!(
                "; {} structure contract(s) are drafts and a draft is never falsified: {}",
                excluded_drafts.len(),
                excluded_drafts.join(", ")
            )
        };
        return emit_error(
            error(
                "project",
                format!(
                    "{} declares no active structure contract, so nothing was falsified{drafted}",
                    loaded.manifest.name
                ),
                None,
            ),
            json,
            2,
        );
    }
    let report = structure::falsify::falsify(
        &loaded.structure,
        &loaded.manifest.root,
        &structure::default_providers(),
        &loaded.ignore,
    );
    let exit = report.exit_code();
    let contracts: Vec<String> = loaded
        .structure
        .iter()
        .map(|contract| {
            contract
                .group
                .clone()
                .unwrap_or_else(|| contract.file.clone())
        })
        .collect();
    let view = ProjectFalsificationReport {
        status: match exit {
            1 => "vacuous",
            3 => "unevaluable",
            _ => "ok",
        },
        operation: "falsify",
        layer: "structure",
        scope: "project",
        project: loaded.manifest.path.display().to_string(),
        active_structure: contracts.len(),
        contracts,
        excluded_drafts,
        completion: "not a completion signal",
        inspections: report.invocations,
        total: report.total,
        falsifiable: report.falsifiable,
        vacuous: report.vacuous,
        unevaluable: report.unevaluable,
        limits: &structure::falsify::LIMITS,
        rules: &report.rules,
    };
    let result = if json {
        write_json(&view)
    } else {
        emit_project_falsification(&view)
    };
    if result.is_ok() { exit } else { 4 }
}

fn falsify_file(file: &Path, json: bool) -> i32 {
    let source = match read_source(file, json, None) {
        Ok(source) => source,
        Err(exit) => return exit,
    };
    if !structure::syntax::is_structure_source(&source) {
        let display = file.display();
        let (code, reason) = match blabla::memory::syntax::kind(&file.to_string_lossy(), &source) {
            Some(kind) => (
                "BLA-FALSIFY-MEMORY",
                format!(
                    "--falsify inverts a structural fact; {display} declares {kind} memory, which states no rule to invert. blabla check {display} validates it instead"
                ),
            ),
            None => (
                "BLA-FALSIFY-BEHAVIOR",
                format!(
                    "--falsify inspects structure contracts; {display} declares behavior, whose rules are falsified by running a campaign against an application rather than by inverting a structural fact"
                ),
            ),
        };
        let mut report = error("usage", reason, None);
        report.code = Some(code.to_string());
        return emit_error(report, json, 2);
    }
    let here = file.parent().unwrap_or(Path::new("."));
    let Ok(manifest) = blabla::project::locate(None, here) else {
        return emit_error(
            error(
                "project",
                format!(
                    "no project.bla above {}: falsification reads the facts this contract's modules resolve to, and without a manifest no module is inspected",
                    file.display()
                ),
                None,
            ),
            json,
            2,
        );
    };
    let root = manifest.parent().unwrap_or(here).to_path_buf();
    let group = registered_group(Some(&manifest), file);
    let contract =
        match structure::syntax::parse(&file.to_string_lossy(), &source, &root, group.as_deref()) {
            Ok(contract) => contract,
            Err(diagnostic) => return emit_contract_error(diagnostic, json, None),
        };
    let report = structure::falsify::falsify(
        std::slice::from_ref(&contract),
        &root,
        &structure::default_providers(),
        &blabla::project::ignore::Ignore::default(),
    );
    let exit = report.exit_code();
    let view = FalsificationReport {
        status: match exit {
            1 => "vacuous",
            3 => "unevaluable",
            _ => "ok",
        },
        operation: "falsify",
        layer: "structure",
        contract: file.display().to_string(),
        project: manifest.display().to_string(),
        completion: "not a completion signal",
        inspections: report.invocations,
        total: report.total,
        falsifiable: report.falsifiable,
        vacuous: report.vacuous,
        unevaluable: report.unevaluable,
        limits: &structure::falsify::LIMITS,
        rules: &report.rules,
    };
    let result = if json {
        write_json(&view)
    } else {
        emit_falsification(&view)
    };
    if result.is_ok() { exit } else { 4 }
}

fn emit_project_falsification(view: &ProjectFalsificationReport<'_>) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(
        output,
        "FALSIFICATION  {} active structure contracts",
        view.active_structure
    )?;
    writeln!(output, "Evaluated against {}", view.project)?;
    writeln!(output, "Scope: {}", view.contracts.join(", "))?;
    if !view.excluded_drafts.is_empty() {
        writeln!(
            output,
            "Excluded: {} (a draft is never falsified)",
            view.excluded_drafts.join(", ")
        )?;
    }
    writeln!(
        output,
        "{} rules  {} falsifiable  {} vacuous  {} unevaluable  ({} inspection, nothing written)\n",
        view.total, view.falsifiable, view.vacuous, view.unevaluable, view.inspections
    )?;
    write_falsification_rules(&mut output, view.rules)?;
    writeln!(output)?;
    for limit in view.limits {
        writeln!(output, "{limit}")?;
    }
    writeln!(
        output,
        "\nExit 0 every rule falsifiable, 1 any vacuous, 3 any unevaluable."
    )
}

fn write_falsification_rules(
    output: &mut impl Write,
    rules: &[structure::falsify::RuleFalsification],
) -> io::Result<()> {
    let width = rules.iter().map(|rule| rule.id.len()).max().unwrap_or(0);
    for rule in rules {
        let transition = match rule.counterfactual_status {
            Some(status) => format!("{} -> {}", rule.status.word(), status.word()),
            None => rule.status.word().to_owned(),
        };
        let detail = rule
            .finding
            .as_deref()
            .or(rule.counterfactual.as_deref())
            .unwrap_or_default();
        writeln!(
            output,
            "  {:<11}  {:<width$}  {:<15}  {detail}",
            rule.verdict.word(),
            rule.id,
            transition
        )?;
    }
    Ok(())
}

fn emit_falsification(view: &FalsificationReport<'_>) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(output, "FALSIFICATION  {}", view.contract)?;
    writeln!(output, "Evaluated against {}", view.project)?;
    writeln!(
        output,
        "{} rules  {} falsifiable  {} vacuous  {} unevaluable  ({} inspection, nothing written)\n",
        view.total, view.falsifiable, view.vacuous, view.unevaluable, view.inspections
    )?;
    write_falsification_rules(&mut output, view.rules)?;
    writeln!(output)?;
    for limit in view.limits {
        writeln!(output, "{limit}")?;
    }
    writeln!(
        output,
        "\nExit 0 every rule falsifiable, 1 any vacuous, 3 any unevaluable."
    )
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

pub(crate) use blabla::project::command_line;

fn swallowed_options(action: &TaskAction) -> Vec<String> {
    let (subcommand, argv) = match action {
        TaskAction::Open { check, .. } => ("open", check),
        TaskAction::Check { check, .. } => ("check", check),
        _ => return Vec::new(),
    };
    let root = Cli::command();
    let Some(definition) = root
        .find_subcommand("task")
        .and_then(|task| task.find_subcommand(subcommand))
    else {
        return Vec::new();
    };
    argv.iter()
        .filter(|element| {
            definition.get_arguments().any(|arg| {
                arg.get_long()
                    .is_some_and(|long| element.as_str() == format!("--{long}"))
            })
        })
        .cloned()
        .collect()
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
        Err(failure) => {
            let mut report = error("invocation", failure.to_string(), seed);
            report.suggested = suggested_argument(&failure);
            return emit_error(report, json, 2);
        }
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
