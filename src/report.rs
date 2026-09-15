use crate::diagnostic::{AppError, Diagnostic, Location};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_SHRINK_ATTEMPTS: usize = 256;
pub const DEFAULT_CASES: usize = 16;
pub const DEFAULT_STEPS: usize = 32;
pub const DEFAULT_TIMEOUT_MS: u64 = 1000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Call {
    pub action: String,
    pub args: Vec<Value>,
}

#[derive(Clone, Debug)]
pub struct RunOptions {
    pub seed: u64,
    pub cases: usize,
    pub steps: usize,
    pub shrink_budget: usize,
}

impl Default for RunOptions {
    fn default() -> Self {
        Self {
            seed: 0,
            cases: DEFAULT_CASES,
            steps: DEFAULT_STEPS,
            shrink_budget: MAX_SHRINK_ATTEMPTS,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Green,
    Yellow,
    Red,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoverageStatus {
    Verified,
    Unexercised,
    Violated,
}

#[derive(Clone, Debug, Serialize)]
pub struct CoverageObligation {
    pub id: String,
    pub property: String,
    pub action: Option<String>,
    pub location: Option<Location>,
    pub required_witness: String,
    pub status: CoverageStatus,
    pub evaluations: usize,
    pub witnesses: usize,
    pub passes: usize,
    pub failures: usize,
    pub first_witness_action: Option<usize>,
    pub first_witness_ms: Option<u64>,
    pub first_witness_trace: Option<Vec<Call>>,
    pub shortest_witness_trace: Option<Vec<Call>>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct CoverageSummary {
    pub verified: usize,
    pub unexercised: usize,
    pub violated: usize,
    pub coverage: Vec<CoverageObligation>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct CampaignMetrics {
    pub action_budget: usize,
    pub total_actions: usize,
    pub reduction_actions: usize,
    pub replay_actions: usize,
    pub resets: usize,
    pub corpus_size: usize,
    pub corpus_peak: usize,
    pub actions_to_full_coverage: Option<usize>,
    pub time_to_full_coverage_ms: Option<u64>,
    pub elapsed_ms: u64,
    pub detection_ms: Option<u64>,
    pub shrink_ms: u64,
    pub decisions: Vec<GenerationDecision>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GenerationDecision {
    pub action_index: usize,
    pub target: Option<String>,
    pub prefix: Option<usize>,
    pub random: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct RunReport {
    pub verifier_version: &'static str,
    pub status: RunStatus,
    pub seed: u64,
    pub cases: usize,
    pub steps: usize,
    pub shrink_budget: usize,
    pub cases_executed: usize,
    pub steps_executed: usize,
    pub sequences: Vec<Vec<Call>>,
    #[serde(flatten)]
    pub coverage_summary: CoverageSummary,
    pub metrics: CampaignMetrics,
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    pub failure: Option<Failure>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Failure {
    pub property: String,
    pub location: Location,
    pub case_index: usize,
    pub original_sequence_length: usize,
    pub minimal_sequence_length: usize,
    #[serde(rename = "minimal_sequence")]
    pub sequence: Vec<Call>,
    pub original_sequence: Vec<Call>,
    pub predicate: String,
    pub before: Value,
    pub input: Value,
    pub after: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual: Option<Value>,
    pub shrink: ShrinkReport,
}

#[derive(Clone, Debug, Serialize)]
pub struct ShrinkReport {
    pub status: ShrinkStatus,
    pub attempts: usize,
    pub confirmations: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShrinkStatus {
    FixedPoint,
    BudgetExhausted,
    Interrupted,
}

#[derive(Debug)]
pub enum VerifyError {
    Contract(Diagnostic),
    Application(AppError),
    Unstable {
        message: String,
        failure: Box<Failure>,
    },
    Internal(String),
}
