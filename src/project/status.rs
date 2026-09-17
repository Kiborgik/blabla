use super::runstate::{Classification, Marker, classify, profile_identity};
use super::{Layer, Lookup, Profile, Project, Rule};
use crate::diagnostic::{Diagnostic, Location};
use crate::report::{Call, CoverageStatus, RunStatus};
use crate::runtime::primitives::{self, Fact};
use crate::structure::{LayerStatus, RuleResult, RuleStatus, StructureReport};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const RECORD_DIRECTORY: &str = ".blabla";
pub const RECORD_FILE: &str = "status.json";
pub const NEXT_LIMIT: usize = 3;
pub const FINISH_COMMAND: &str = "blabla finish";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Record {
    pub verifier_version: String,
    pub project: String,
    pub manifest: String,
    pub project_identity: String,
    pub implementation_fingerprint: String,
    pub fingerprinted_files: Vec<String>,
    pub application: Vec<String>,
    pub timeout_ms: u64,
    #[serde(default)]
    pub profile: Option<Profile>,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub structure: Option<Value>,
    pub recorded_unix: u64,
    pub report: Value,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RecordedReport {
    pub status: RunStatus,
    pub seed: u64,
    pub cases: usize,
    pub steps: usize,
    pub shrink_budget: usize,
    pub steps_executed: usize,
    pub verified: usize,
    pub unexercised: usize,
    pub violated: usize,
    pub coverage: Vec<RecordedObligation>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RecordedObligation {
    pub id: String,
    pub property: String,
    pub action: Option<String>,
    pub location: Option<Location>,
    pub required_witness: String,
    pub status: CoverageStatus,
    pub evaluations: usize,
    pub witnesses: usize,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RecordedFailure {
    pub property: String,
    pub minimal_sequence: Vec<Call>,
    pub original_sequence_length: usize,
    pub minimal_sequence_length: usize,
    pub predicate: String,
    pub expected: Option<Value>,
    pub actual: Option<Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Green,
    Yellow,
    Red,
    Unverified,
    Stale,
    Verifying,
    Interrupted,
    NoActiveContracts,
}

impl State {
    pub fn exit(self) -> i32 {
        match self {
            State::Green => 0,
            State::Red => 1,
            State::Yellow
            | State::Unverified
            | State::Stale
            | State::Verifying
            | State::Interrupted
            | State::NoActiveContracts => 5,
        }
    }

    pub fn word(self) -> &'static str {
        match self {
            State::Green => "GREEN",
            State::Yellow => "YELLOW",
            State::Red => "RED",
            State::Unverified => "UNVERIFIED",
            State::Stale => "STALE",
            State::Verifying => "VERIFYING",
            State::Interrupted => "INTERRUPTED",
            State::NoActiveContracts => "NO ACTIVE CONTRACTS",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompletionState {
    Green,
    Yellow,
    Red,
    Stale,
    Unverified,
    Verifying,
    Interrupted,
    NotCanonical,
    NoProfile,
    NoActiveContracts,
    StructureRed,
    StructureError,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OverallStatus {
    Green,
    Blocked,
}

impl OverallStatus {
    pub fn word(self) -> &'static str {
        match self {
            OverallStatus::Green => "GREEN",
            OverallStatus::Blocked => "BLOCKED",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct OverallView {
    pub status: OverallStatus,
    pub reason: String,
    pub exit: i32,
}

#[derive(Clone, Debug, Serialize)]
pub struct RunStateView {
    pub classification: Classification,
    pub run_id: String,
    pub pid: u32,
    pub started_at: String,
}

impl CompletionState {
    pub fn word(self) -> &'static str {
        match self {
            CompletionState::Green => "GREEN",
            _ => "BLOCKED",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct CompletionView {
    pub state: CompletionState,
    pub allowed: bool,
    pub command: Option<&'static str>,
    pub reason: String,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct RuleCounts {
    pub total: usize,
    pub green: usize,
    pub yellow: usize,
    pub red: usize,
}

impl RuleCounts {
    fn add(&mut self, state: State) {
        self.total += 1;
        match state {
            State::Green => self.green += 1,
            State::Red => self.red += 1,
            _ => self.yellow += 1,
        }
    }

    fn state(&self) -> State {
        if self.red > 0 {
            State::Red
        } else if self.yellow > 0 {
            State::Yellow
        } else {
            State::Green
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ActionCounts {
    pub total: usize,
    pub exercised: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct GroupView {
    pub name: String,
    pub path: String,
    pub layer: Layer,
    pub counts: RuleCounts,
    pub state: Option<State>,
    pub structure: Option<LayerStatus>,
    pub errors: usize,
}

impl GroupView {
    pub fn word(&self) -> Option<&'static str> {
        self.state
            .map(State::word)
            .or_else(|| self.structure.map(LayerStatus::word))
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct DraftView {
    pub name: String,
    pub path: String,
    pub layer: Layer,
    pub check: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct RuleView {
    pub id: String,
    pub group: String,
    pub label: String,
    pub file: String,
    pub line: usize,
    pub state: State,
    pub unexercised: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct RecordedView {
    pub status: RunStatus,
    pub verified: usize,
    pub unexercised: usize,
    pub violated: usize,
    pub seed: u64,
    pub cases: usize,
    pub steps: usize,
    pub steps_executed: usize,
    pub shrink_budget: usize,
    pub timeout_ms: u64,
    pub application: Vec<String>,
    pub recorded_at: String,
    pub stale: Vec<&'static str>,
    pub canonical: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct StatusView {
    pub project: String,
    pub manifest: String,
    pub state: State,
    pub exit: i32,
    pub completion: CompletionView,
    pub profile: Option<Profile>,
    pub rules: RuleCounts,
    pub actions: ActionCounts,
    pub groups: Vec<GroupView>,
    pub drafts: Vec<DraftView>,
    pub next: Vec<RuleView>,
    pub runtime_primitives: Vec<&'static str>,
    pub recorded: Option<RecordedView>,
    pub record_error: Option<String>,
    pub run_state: Option<RunStateView>,
    pub structure: StructureReport,
    pub overall: OverallView,
}

#[derive(Clone, Debug, Serialize)]
pub struct StructureExplainView {
    pub layer: &'static str,
    #[serde(flatten)]
    pub result: RuleResult,
    pub source: String,
    pub verification: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct ExplainView {
    pub layer: &'static str,
    pub id: String,
    pub group: Option<String>,
    pub label: String,
    pub file: Option<String>,
    pub line: Option<usize>,
    pub source: Option<String>,
    pub action: Option<String>,
    pub depends_on: Vec<&'static str>,
    pub state: State,
    pub verification: String,
    pub obligations: Vec<RecordedObligation>,
    pub failure: Option<RecordedFailure>,
    pub recorded: Option<RecordedView>,
}

pub struct Evaluation {
    pub report: Option<RecordedReport>,
    pub failure: Option<RecordedFailure>,
    pub recorded: Option<RecordedView>,
    pub stale: bool,
    pub canonical: bool,
    pub record_error: Option<String>,
    pub run_state: Option<RunStateView>,
    pub record_run_id: Option<String>,
}

pub fn apply_run_state(
    evaluation: &mut Evaluation,
    project: &Project,
    marker: Result<Option<Marker>, String>,
) {
    let marker = match marker {
        Ok(None) => return,
        Ok(Some(marker)) => marker,
        Err(message) => {
            evaluation.run_state = Some(RunStateView {
                classification: Classification::Interrupted,
                run_id: String::new(),
                pid: 0,
                started_at: message,
            });
            return;
        }
    };
    let classification = classify(
        &marker,
        &project.identity,
        &profile_identity(project.manifest.profile.as_ref()),
        evaluation.record_run_id.as_deref(),
    );
    if classification == Classification::Completed {
        return;
    }
    evaluation.run_state = Some(RunStateView {
        classification,
        run_id: marker.run_id,
        pid: marker.pid,
        started_at: format_unix(marker.started_unix),
    });
}

pub fn record_path(root: &Path) -> PathBuf {
    root.join(RECORD_DIRECTORY).join(RECORD_FILE)
}

pub fn write_record(root: &Path, record: &Record) -> std::io::Result<PathBuf> {
    let path = record_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_vec_pretty(record).map_err(std::io::Error::other)?;
    std::fs::write(&path, text)?;
    Ok(path)
}

pub fn read_record(root: &Path) -> Result<Option<Record>, String> {
    let path = record_path(root);
    if !path.is_file() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|failure| format!("cannot read {}: {failure}", path.display()))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|failure| format!("cannot parse {}: {failure}", path.display()))
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

pub fn format_unix(seconds: u64) -> String {
    let days = i64::try_from(seconds / 86_400).unwrap_or(0);
    let remainder = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        remainder / 3_600,
        (remainder % 3_600) / 60,
        remainder % 60
    )
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = (shifted - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

pub fn evaluate(project: &Project, record: Result<Option<Record>, String>) -> Evaluation {
    let (record, record_error) = match record {
        Ok(record) => (record, None),
        Err(message) => (None, Some(message)),
    };
    let Some(record) = record else {
        return Evaluation {
            report: None,
            failure: None,
            recorded: None,
            stale: false,
            canonical: false,
            record_error,
            run_state: None,
            record_run_id: None,
        };
    };
    let report: Result<RecordedReport, _> = serde_json::from_value(record.report.clone());
    let report = match report {
        Ok(report) => report,
        Err(failure) => {
            return Evaluation {
                report: None,
                failure: None,
                recorded: None,
                stale: false,
                canonical: false,
                record_error: Some(format!("recorded report is unreadable: {failure}")),
                run_state: None,
                record_run_id: record.run_id.clone(),
            };
        }
    };
    let failure = if report.status == RunStatus::Red {
        serde_json::from_value(record.report.clone()).ok()
    } else {
        None
    };
    let files: Vec<PathBuf> = record
        .fingerprinted_files
        .iter()
        .map(PathBuf::from)
        .collect();
    let mut stale = Vec::new();
    if record.verifier_version != env!("CARGO_PKG_VERSION") {
        stale.push("verifier");
    }
    if record.project_identity != project.identity {
        stale.push("contracts");
    }
    if record.implementation_fingerprint != project.fingerprint(&files) {
        stale.push("implementation");
    }
    if record.profile != project.manifest.profile {
        stale.push("profile");
    }
    let canonical = project.manifest.profile.as_ref().is_some_and(|profile| {
        profile.command == record.application
            && profile.seed == report.seed
            && profile.cases == report.cases
            && profile.steps == report.steps
            && profile.shrink_budget == report.shrink_budget
            && profile.timeout_ms == record.timeout_ms
    });
    let recorded = RecordedView {
        status: report.status.clone(),
        verified: report.verified,
        unexercised: report.unexercised,
        violated: report.violated,
        seed: report.seed,
        cases: report.cases,
        steps: report.steps,
        steps_executed: report.steps_executed,
        shrink_budget: report.shrink_budget,
        timeout_ms: record.timeout_ms,
        application: record.application.clone(),
        recorded_at: format_unix(record.recorded_unix),
        stale: stale.clone(),
        canonical,
    };
    Evaluation {
        report: Some(report),
        failure,
        recorded: Some(recorded),
        stale: !stale.is_empty(),
        canonical,
        record_error,
        run_state: None,
        record_run_id: record.run_id.clone(),
    }
}

fn completion(
    project: &Project,
    evaluation: &Evaluation,
    state: State,
    structure: &StructureReport,
) -> CompletionView {
    let behavior_active = project.has_behavior();
    let structure_active = project.has_structure();
    let has_profile = project.manifest.profile.is_some();
    let command = (has_profile || !behavior_active).then_some(FINISH_COMMAND);
    let (completion_state, reason) = if !behavior_active && !structure_active {
        (
            CompletionState::NoActiveContracts,
            "no active contracts; promote a draft with `use behavior` or `use structure` in project.bla".to_owned(),
        )
    } else if structure.status == LayerStatus::Red {
        (
            CompletionState::StructureRed,
            format!(
                "structure: {} of {} rules violated",
                structure.violated,
                structure.total()
            ),
        )
    } else if structure.status == LayerStatus::Error {
        (
            CompletionState::StructureError,
            format!(
                "structure could not be evaluated: {}",
                structure.first_error().unwrap_or("provider failure")
            ),
        )
    } else if behavior_active {
        let (behavior_state, behavior_reason) = behavior_completion(project, evaluation, state);
        if behavior_state == CompletionState::Green && structure_active {
            (
                CompletionState::Green,
                "canonical verification and structure are GREEN".to_owned(),
            )
        } else {
            (behavior_state, behavior_reason)
        }
    } else {
        (
            CompletionState::Green,
            "structure is GREEN; no behavior contracts are active".to_owned(),
        )
    };
    CompletionView {
        state: completion_state,
        allowed: completion_state == CompletionState::Green,
        command,
        reason,
    }
}

fn behavior_completion(
    project: &Project,
    evaluation: &Evaluation,
    state: State,
) -> (CompletionState, String) {
    let has_profile = project.manifest.profile.is_some();
    match state {
        State::NoActiveContracts => (
            CompletionState::NoActiveContracts,
            "no active contracts; promote a draft with `use behavior` in project.bla".to_owned(),
        ),
        State::Verifying => (
            CompletionState::Verifying,
            format!(
                "{FINISH_COMMAND} is running (started at {}, pid {})",
                evaluation
                    .run_state
                    .as_ref()
                    .map(|run| run.started_at.as_str())
                    .unwrap_or("unknown"),
                evaluation.run_state.as_ref().map(|run| run.pid).unwrap_or(0)
            ),
        ),
        State::Interrupted => (
            CompletionState::Interrupted,
            format!(
                "a {FINISH_COMMAND} started at {} did not complete; run it again",
                evaluation
                    .run_state
                    .as_ref()
                    .map(|run| run.started_at.as_str())
                    .unwrap_or("unknown")
            ),
        ),
        _ if !has_profile => (
            match state {
                State::Green => CompletionState::Green,
                State::Yellow => CompletionState::Yellow,
                State::Red => CompletionState::Red,
                State::Stale => CompletionState::Stale,
                State::Unverified
                | State::Verifying
                | State::Interrupted
                | State::NoActiveContracts => CompletionState::Unverified,
            },
            "project.bla has no `verify behavior { command [...] }` profile; completion follows the recorded run until one is added".to_owned(),
        ),
        State::Stale => (
            CompletionState::Stale,
            format!(
                "{} changed since the recorded run",
                evaluation
                    .recorded
                    .as_ref()
                    .map(|recorded| recorded.stale.join(", "))
                    .unwrap_or_default()
            ),
        ),
        State::Unverified => (
            CompletionState::Unverified,
            "no recorded canonical verification".to_owned(),
        ),
        _ if !evaluation.canonical => (
            CompletionState::NotCanonical,
            "the recorded run did not use the canonical verification profile".to_owned(),
        ),
        State::Green => (
            CompletionState::Green,
            "canonical verification is GREEN".to_owned(),
        ),
        State::Yellow => (
            CompletionState::Yellow,
            format!(
                "{} obligations remain unverified under the canonical profile",
                evaluation
                    .recorded
                    .as_ref()
                    .map(|recorded| recorded.unexercised)
                    .unwrap_or(0)
            ),
        ),
        State::Red => (
            CompletionState::Red,
            format!(
                "{} obligations violated",
                evaluation
                    .recorded
                    .as_ref()
                    .map(|recorded| recorded.violated)
                    .unwrap_or(0)
            ),
        ),
    }
}

fn rule_obligations<'a>(rule: &Rule, report: &'a RecordedReport) -> Vec<&'a RecordedObligation> {
    report
        .coverage
        .iter()
        .filter(|obligation| obligation.property == rule.id)
        .collect()
}

fn obligations_state(obligations: &[&RecordedObligation]) -> State {
    if obligations
        .iter()
        .any(|obligation| obligation.status == CoverageStatus::Violated)
    {
        State::Red
    } else if obligations.is_empty()
        || obligations
            .iter()
            .any(|obligation| obligation.status == CoverageStatus::Unexercised)
    {
        State::Yellow
    } else {
        State::Green
    }
}

fn rule_view(rule: &Rule, report: Option<&RecordedReport>, fallback: State) -> RuleView {
    let (state, unexercised) = match report {
        Some(report) => {
            let obligations = rule_obligations(rule, report);
            (
                obligations_state(&obligations),
                obligations
                    .iter()
                    .filter(|obligation| obligation.status == CoverageStatus::Unexercised)
                    .count(),
            )
        }
        None => (fallback, 0),
    };
    RuleView {
        id: rule.id.clone(),
        group: rule.group.clone(),
        label: rule.label.clone(),
        file: rule.file.clone(),
        line: rule.line,
        state,
        unexercised,
    }
}

fn run_state_of(evaluation: &Evaluation) -> Option<State> {
    evaluation
        .run_state
        .as_ref()
        .map(|run| match run.classification {
            Classification::Verifying => State::Verifying,
            Classification::Interrupted | Classification::Completed => State::Interrupted,
        })
}

pub fn status_view(
    project: &Project,
    evaluation: &Evaluation,
    structure: &StructureReport,
) -> StatusView {
    let run_state = run_state_of(evaluation);
    let usable = if evaluation.stale || run_state.is_some() {
        None
    } else {
        evaluation.report.as_ref()
    };
    let fallback = match run_state {
        Some(state) => state,
        None if evaluation.stale => State::Stale,
        None => State::Unverified,
    };
    let rule_views: Vec<RuleView> = project
        .rules
        .iter()
        .map(|rule| rule_view(rule, usable, fallback))
        .collect();
    let mut rules = RuleCounts::default();
    let mut groups: Vec<GroupView> = project
        .groups
        .iter()
        .map(|group| GroupView {
            name: group.name.clone(),
            path: group.display.clone(),
            layer: group.layer,
            counts: RuleCounts::default(),
            state: None,
            structure: None,
            errors: 0,
        })
        .collect();
    for view in &rule_views {
        rules.add(view.state);
        if let Some(group) = groups
            .iter_mut()
            .find(|group| group.layer == Layer::Behavior && group.name == view.group)
        {
            group.counts.add(view.state);
        }
    }
    for group in &mut groups {
        match group.layer {
            Layer::Behavior => {
                if usable.is_some() {
                    group.state = Some(group.counts.state());
                }
            }
            Layer::Structure => {
                let results: Vec<&RuleResult> = structure
                    .rules
                    .iter()
                    .filter(|result| result.group.as_deref() == Some(group.name.as_str()))
                    .collect();
                group.counts.total = results.len();
                group.counts.green = results
                    .iter()
                    .filter(|result| result.status == RuleStatus::Green)
                    .count();
                group.counts.red = results
                    .iter()
                    .filter(|result| result.status == RuleStatus::Red)
                    .count();
                group.errors = results
                    .iter()
                    .filter(|result| result.status == RuleStatus::Error)
                    .count();
                group.structure = Some(if group.counts.red > 0 {
                    LayerStatus::Red
                } else if group.errors > 0 {
                    LayerStatus::Error
                } else {
                    LayerStatus::Green
                });
            }
        }
    }
    let actions_total = project
        .contract
        .as_ref()
        .map(|contract| contract.actions.len())
        .unwrap_or(0);
    let actions_exercised = usable
        .map(|report| {
            report
                .coverage
                .iter()
                .filter(|obligation| {
                    obligation.id.starts_with("action/")
                        && obligation.status == CoverageStatus::Verified
                })
                .count()
        })
        .unwrap_or(0);
    let state = if !project.has_behavior() {
        State::NoActiveContracts
    } else if let Some(run_state) = run_state {
        run_state
    } else if evaluation.stale {
        State::Stale
    } else {
        match usable {
            None => State::Unverified,
            Some(report) => match report.status {
                RunStatus::Green if rules.total > 0 && rules.green == rules.total => State::Green,
                RunStatus::Green => State::Yellow,
                RunStatus::Yellow => State::Yellow,
                RunStatus::Red => State::Red,
            },
        }
    };
    let mut next: Vec<RuleView> = structure
        .rules
        .iter()
        .filter(|result| result.status != RuleStatus::Green)
        .map(|result| RuleView {
            id: result.id.clone(),
            group: result.group.clone().unwrap_or_default(),
            label: result.label.clone(),
            file: result.file.clone(),
            line: result.line,
            state: if result.status == RuleStatus::Red {
                State::Red
            } else {
                State::Yellow
            },
            unexercised: 0,
        })
        .collect();
    if usable.is_some() {
        next.extend(
            rule_views
                .iter()
                .filter(|view| view.state == State::Red)
                .cloned(),
        );
        let mut yellow: Vec<RuleView> = rule_views
            .iter()
            .filter(|view| view.state == State::Yellow)
            .cloned()
            .collect();
        yellow.sort_by_key(|view| std::cmp::Reverse(view.unexercised));
        next.extend(yellow);
    }
    next.truncate(NEXT_LIMIT);
    let completion = completion(project, evaluation, state, structure);
    let exit = if completion.allowed {
        0
    } else if state == State::Red || structure.status == LayerStatus::Red {
        1
    } else if structure.status == LayerStatus::Error {
        3
    } else {
        5
    };
    let overall = OverallView {
        status: if completion.allowed {
            OverallStatus::Green
        } else {
            OverallStatus::Blocked
        },
        reason: completion.reason.clone(),
        exit,
    };
    StatusView {
        project: project.manifest.name.clone(),
        manifest: project.manifest.path.display().to_string(),
        state,
        exit,
        completion,
        profile: project.manifest.profile.clone(),
        rules,
        actions: ActionCounts {
            total: actions_total,
            exercised: actions_exercised,
        },
        groups,
        drafts: project
            .drafts
            .iter()
            .map(|draft| DraftView {
                name: draft.name.clone(),
                path: draft.display.clone(),
                layer: draft.layer,
                check: match &draft.check {
                    Ok(()) => "ok".into(),
                    Err(diagnostic) => format!(
                        "{} at {}:{}:{}: {}",
                        diagnostic.code,
                        diagnostic.location.file,
                        diagnostic.location.line,
                        diagnostic.location.column,
                        diagnostic.message
                    ),
                },
            })
            .collect(),
        next,
        runtime_primitives: project.runtime_primitives(),
        recorded: evaluation.recorded.clone(),
        record_error: evaluation.record_error.clone(),
        run_state: evaluation.run_state.clone(),
        structure: structure.clone(),
        overall,
    }
}

pub fn explain_structure(
    project: &Project,
    structure: &StructureReport,
    query: &str,
) -> Result<Option<StructureExplainView>, Diagnostic> {
    let Lookup::Structure(rule) = project.lookup(query)? else {
        return Ok(None);
    };
    let result = structure
        .result(&rule.id)
        .cloned()
        .ok_or_else(|| Diagnostic {
            location: rule.location.clone(),
            code: "E_INTERNAL".into(),
            message: format!("structure rule {} was not evaluated", rule.id),
        })?;
    Ok(Some(StructureExplainView {
        layer: "structure",
        result,
        source: rule.source.clone(),
        verification: "blabla status",
    }))
}

#[derive(Clone, Debug, Serialize)]
pub struct PrimitiveView {
    pub id: &'static str,
    pub owner: &'static str,
    pub summary: &'static str,
    pub semantics: &'static [Fact],
    pub distinction: &'static str,
    pub used_by: Vec<String>,
}

pub fn primitive_view(project: Option<&Project>, query: &str) -> Result<PrimitiveView, String> {
    let Some(primitive) = primitives::find(query) else {
        return Err(format!(
            "no runtime primitive matches '{query}'; known primitives: {}",
            primitives::ids().join(", ")
        ));
    };
    Ok(PrimitiveView {
        id: primitive.id,
        owner: primitive.owner,
        summary: primitive.summary,
        semantics: primitive.semantics,
        distinction: primitive.distinction,
        used_by: project
            .map(|project| {
                project
                    .rules_using(primitive.id)
                    .into_iter()
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
    })
}

pub fn explain_view(
    project: &Project,
    evaluation: &Evaluation,
    query: &str,
) -> Result<ExplainView, Diagnostic> {
    let run_state = run_state_of(evaluation);
    let usable = if evaluation.stale || run_state.is_some() {
        None
    } else {
        evaluation.report.as_ref()
    };
    let fallback = match run_state {
        Some(state) => state,
        None if evaluation.stale => State::Stale,
        None => State::Unverified,
    };
    let subject = match project.lookup(query)? {
        Lookup::Contract(group) => {
            unreachable!("the contract view is rendered before {}", group.name)
        }
        Lookup::Structure(rule) => {
            return Err(Diagnostic {
                location: rule.location.clone(),
                code: "E_STRUCTURE_RULE".into(),
                message: format!(
                    "{} is a structure rule; explain it through the structure layer",
                    rule.id
                ),
            });
        }
        Lookup::Rule(rule) => Subject {
            id: rule.id.clone(),
            group: Some(rule.group.clone()),
            label: rule.label.clone(),
            file: Some(rule.file.clone()),
            line: Some(rule.line),
            source: Some(rule.source.clone()),
            action: rule.action.clone(),
            depends_on: rule.runtime.into_iter().collect(),
            by_property: true,
        },
        Lookup::Action(name) => Subject {
            id: format!("action/{name}"),
            group: None,
            label: name.clone(),
            file: None,
            line: None,
            source: None,
            depends_on: project
                .contract
                .as_ref()
                .and_then(|contract| contract.actions.iter().find(|action| action.name == name))
                .and_then(|action| primitives::for_action(action.kind))
                .map(|primitive| primitive.id)
                .into_iter()
                .collect(),
            action: Some(name),
            by_property: false,
        },
    };
    let obligations: Vec<RecordedObligation> = usable
        .map(|report| {
            report
                .coverage
                .iter()
                .filter(|obligation| subject.matches(obligation))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    let state = match usable {
        Some(_) => obligations_state(&obligations.iter().collect::<Vec<_>>()),
        None => fallback,
    };
    let failure = evaluation
        .failure
        .as_ref()
        .filter(|failure| usable.is_some() && failure.property == subject.id)
        .cloned();
    let verification = match &project.manifest.profile {
        Some(_) => FINISH_COMMAND.to_owned(),
        None => format!(
            "blabla run -- {}",
            evaluation
                .recorded
                .as_ref()
                .filter(|recorded| !recorded.application.is_empty())
                .map(|recorded| recorded.application.join(" "))
                .unwrap_or_else(|| "<application>".into())
        ),
    };
    Ok(ExplainView {
        layer: "behavior",
        id: subject.id,
        group: subject.group,
        label: subject.label,
        file: subject.file,
        line: subject.line,
        source: subject.source,
        action: subject.action,
        depends_on: subject.depends_on,
        state,
        verification,
        obligations,
        failure,
        recorded: evaluation.recorded.clone(),
    })
}

struct Subject {
    id: String,
    group: Option<String>,
    label: String,
    file: Option<String>,
    line: Option<usize>,
    source: Option<String>,
    action: Option<String>,
    depends_on: Vec<&'static str>,
    by_property: bool,
}

impl Subject {
    fn matches(&self, obligation: &RecordedObligation) -> bool {
        if self.by_property {
            obligation.property == self.id
        } else {
            obligation.id == self.id
        }
    }
}
