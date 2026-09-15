mod campaign;
mod corpus;
mod coverage;
mod evaluator;
mod generator;
#[cfg(test)]
mod tests;

use crate::application::Application;
use crate::diagnostic::{AppError, Diagnostic, Location, Span};
use crate::ir::{Action, ActionKind, Contract, Predicate, Type};
use crate::report::{
    Call, Failure, MAX_SHRINK_ATTEMPTS, RunOptions, RunReport, RunStatus, ShrinkReport,
    ShrinkStatus, VerifyError,
};
use coverage::{Coverage, CoverageEvent};
use evaluator::{PredicateFailure, evaluate_predicate};
use generator::{SplitMix64, generate_call};
use serde_json::{Map, Value};
use std::time::Instant;

#[derive(Clone)]
struct ObservedFailure {
    predicate: Predicate,
    before: Value,
    input: Value,
    after: Value,
    expected: Option<Value>,
    actual: Option<Value>,
}

enum ReplayOutcome {
    Pass,
    Failure(Box<ObservedFailure>),
}

struct Reduction {
    sequence: Vec<Call>,
    observed: ObservedFailure,
    status: ShrinkStatus,
    attempts: usize,
    reason: Option<String>,
}

pub fn run<A: Application, F: FnMut() -> Result<A, AppError>>(
    contract: &Contract,
    options: &RunOptions,
    make_app: F,
) -> Result<RunReport, VerifyError> {
    run_observed(contract, options, make_app, &mut |_| {})
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Progress {
    pub case_index: usize,
    pub cases: usize,
    pub actions_executed: usize,
    pub action_budget: usize,
    pub verified: usize,
    pub total: usize,
    pub shrinking: bool,
}

pub fn run_observed<A: Application, F: FnMut() -> Result<A, AppError>>(
    contract: &Contract,
    options: &RunOptions,
    mut make_app: F,
    observer: &mut dyn FnMut(&Progress),
) -> Result<RunReport, VerifyError> {
    let actions = std::rc::Rc::new(std::cell::Cell::new(0));
    campaign::campaign(
        contract,
        options,
        || {
            make_app().map(|app| CountedApplication {
                app,
                actions: actions.clone(),
            })
        },
        observer,
    )
    .map(|mut report| {
        report.metrics.total_actions = actions.get();
        report.metrics.reduction_actions = actions.get().saturating_sub(report.steps_executed);
        report
    })
}

struct CountedApplication<A> {
    app: A,
    actions: std::rc::Rc<std::cell::Cell<usize>>,
}

impl<A: Application> Application for CountedApplication<A> {
    fn reset(&mut self) -> Result<(), AppError> {
        self.app.reset()
    }
    fn call(&mut self, call: &Call) -> Result<(), AppError> {
        self.actions.set(self.actions.get() + 1);
        self.app.call(call)
    }
    fn restart(&mut self) -> Result<(), AppError> {
        self.actions.set(self.actions.get() + 1);
        self.app.restart()
    }
    fn observe(&mut self, schema: &[crate::ir::Field]) -> Result<Value, AppError> {
        self.app.observe(schema)
    }
    fn finish(&mut self) -> Result<(), AppError> {
        self.app.finish()
    }
}

fn elapsed(started: &Instant) -> u64 {
    started.elapsed().as_millis().min(u64::MAX as u128) as u64
}

fn with_coverage(
    result: Result<RunReport, VerifyError>,
    coverage: &Coverage,
    mut metrics: crate::report::CampaignMetrics,
    started: &Instant,
) -> Result<RunReport, VerifyError> {
    result.map(|mut report| {
        report.coverage_summary = coverage.summary();
        metrics.elapsed_ms = elapsed(started);
        report.metrics = metrics;
        report
    })
}

fn validate_run(contract: &Contract, options: &RunOptions) -> Result<(), VerifyError> {
    if options.cases == 0 || options.steps == 0 {
        return Err(VerifyError::Contract(Diagnostic {
            location: Location {
                file: "<run>".into(),
                line: 1,
                column: 1,
            },
            code: "BLA-RUN-BUDGET".into(),
            message: "cases and steps must both be greater than zero".into(),
        }));
    }
    if options.shrink_budget > MAX_SHRINK_ATTEMPTS {
        return Err(VerifyError::Contract(Diagnostic {
            location: Location {
                file: "<run>".into(),
                line: 1,
                column: 1,
            },
            code: "BLA-RUN-BUDGET".into(),
            message: format!("shrink budget must not exceed {MAX_SHRINK_ATTEMPTS}"),
        }));
    }
    if contract.actions.is_empty() {
        return Err(VerifyError::Contract(Diagnostic {
            location: Location {
                file: "<contract>".into(),
                line: 1,
                column: 1,
            },
            code: "BLA-RUN-CONTRACT".into(),
            message: "the contract has no actions".into(),
        }));
    }
    for action in &contract.actions {
        for param in &action.params {
            if !param.ty.is_action_parameter() {
                return Err(VerifyError::Contract(Diagnostic {
                    location: Location {
                        file: "<contract>".into(),
                        line: 1,
                        column: 1,
                    },
                    code: "BLA-RUN-PARAM".into(),
                    message: format!(
                        "action parameter {}.{} is not scalar or optional scalar",
                        action.name, param.name
                    ),
                }));
            }
        }
    }
    Ok(())
}

fn finish_failure<A: Application, F: FnMut() -> Result<A, AppError>>(
    contract: &Contract,
    options: &RunOptions,
    make_app: &mut F,
    sequences: Vec<Vec<Call>>,
    case_index: usize,
    steps_executed: usize,
    historical: ObservedFailure,
) -> Result<RunReport, VerifyError> {
    let original_sequence = sequences.get(case_index).cloned().ok_or_else(|| {
        VerifyError::Internal(format!("missing generated sequence for case {case_index}"))
    })?;
    let target_property = historical.predicate.label.clone();
    let provisional = make_failure(
        case_index,
        original_sequence.clone(),
        original_sequence.clone(),
        historical.clone(),
        ShrinkReport {
            status: ShrinkStatus::Interrupted,
            attempts: 0,
            confirmations: 0,
            reason: Some("original failure has not been confirmed".into()),
        },
    );

    let confirmed = match replay_fresh(contract, make_app, &original_sequence) {
        Ok(ReplayOutcome::Failure(found)) if found.predicate.label == target_property => *found,
        Ok(ReplayOutcome::Failure(found)) => {
            return Err(VerifyError::Unstable {
                message: format!(
                    "original replay violated {} instead of {}",
                    found.predicate.label, target_property
                ),
                failure: Box::new(provisional),
            });
        }
        Ok(ReplayOutcome::Pass) => {
            return Err(VerifyError::Unstable {
                message: format!("original replay did not reproduce {target_property}"),
                failure: Box::new(provisional),
            });
        }
        Err(VerifyError::Application(error)) => {
            return Err(VerifyError::Unstable {
                message: format!("original replay was interrupted: {}", error.message),
                failure: Box::new(provisional),
            });
        }
        Err(error) => return Err(error),
    };

    let reduction = reduce(
        contract,
        make_app,
        original_sequence.clone(),
        confirmed,
        &target_property,
        options.shrink_budget,
    )?;
    let mut shrink = ShrinkReport {
        status: reduction.status,
        attempts: reduction.attempts,
        confirmations: 1,
        reason: reduction.reason,
    };

    match replay_fresh(contract, make_app, &reduction.sequence) {
        Ok(ReplayOutcome::Failure(found)) if found.predicate.label == target_property => {
            shrink.confirmations = 2;
            let failure = make_failure(
                case_index,
                reduction.sequence,
                original_sequence,
                *found,
                shrink,
            );
            Ok(RunReport {
                verifier_version: env!("CARGO_PKG_VERSION"),
                status: RunStatus::Red,
                seed: options.seed,
                cases: options.cases,
                steps: options.steps,
                shrink_budget: options.shrink_budget,
                cases_executed: case_index + 1,
                steps_executed,
                sequences,
                coverage_summary: Default::default(),
                metrics: Default::default(),
                failure: Some(failure),
            })
        }
        Ok(ReplayOutcome::Failure(found)) => {
            let failure = make_failure(
                case_index,
                reduction.sequence,
                original_sequence,
                reduction.observed,
                shrink,
            );
            Err(VerifyError::Unstable {
                message: format!(
                    "final replay violated {} instead of {}",
                    found.predicate.label, target_property
                ),
                failure: Box::new(failure),
            })
        }
        Ok(ReplayOutcome::Pass) => {
            let failure = make_failure(
                case_index,
                reduction.sequence,
                original_sequence,
                reduction.observed,
                shrink,
            );
            Err(VerifyError::Unstable {
                message: format!("final replay did not reproduce {target_property}"),
                failure: Box::new(failure),
            })
        }
        Err(VerifyError::Application(error)) => {
            let failure = make_failure(
                case_index,
                reduction.sequence,
                original_sequence,
                reduction.observed,
                shrink,
            );
            Err(VerifyError::Unstable {
                message: format!("final replay was interrupted: {}", error.message),
                failure: Box::new(failure),
            })
        }
        Err(error) => Err(error),
    }
}

fn make_failure(
    case_index: usize,
    sequence: Vec<Call>,
    original_sequence: Vec<Call>,
    observed: ObservedFailure,
    shrink: ShrinkReport,
) -> Failure {
    Failure {
        property: observed.predicate.label.clone(),
        location: observed.predicate.location.clone(),
        case_index,
        original_sequence_length: original_sequence.len(),
        minimal_sequence_length: sequence.len(),
        sequence,
        original_sequence,
        predicate: if observed.predicate.forbidden {
            format!("not ({})", observed.predicate.source)
        } else {
            observed.predicate.source.clone()
        },
        before: observed.before,
        input: observed.input,
        after: observed.after,
        expected: observed.expected,
        actual: observed.actual,
        shrink,
    }
}

fn replay_fresh<A: Application, F: FnMut() -> Result<A, AppError>>(
    contract: &Contract,
    make_app: &mut F,
    sequence: &[Call],
) -> Result<ReplayOutcome, VerifyError> {
    let mut app = make_app().map_err(VerifyError::Application)?;
    app.reset().map_err(VerifyError::Application)?;
    let state = app
        .observe(&contract.state)
        .map_err(VerifyError::Application)?;
    if let Some(failure) = check_invariants(contract, &state)? {
        app.finish().map_err(VerifyError::Application)?;
        return Ok(ReplayOutcome::Failure(Box::new(failure)));
    }

    for call in sequence {
        let before = app
            .observe(&contract.state)
            .map_err(VerifyError::Application)?;
        if let Some(failure) = execute_step(&mut app, contract, call, &before)? {
            app.finish().map_err(VerifyError::Application)?;
            return Ok(ReplayOutcome::Failure(Box::new(failure)));
        }
    }
    app.finish().map_err(VerifyError::Application)?;
    Ok(ReplayOutcome::Pass)
}

fn execute_step<A: Application>(
    app: &mut A,
    contract: &Contract,
    call: &Call,
    before: &Value,
) -> Result<Option<ObservedFailure>, VerifyError> {
    execute_observed_step(app, contract, call, before).map(|(failure, _)| failure)
}

fn execute_observed_step<A: Application>(
    app: &mut A,
    contract: &Contract,
    call: &Call,
    before: &Value,
) -> Result<(Option<ObservedFailure>, Value), VerifyError> {
    let action = contract
        .actions
        .iter()
        .find(|action| action.name == call.action)
        .ok_or_else(|| VerifyError::Internal(format!("unknown action {}", call.action)))?;
    let input = action_input(action, call)?;
    match action.kind {
        ActionKind::Application => app.call(call),
        ActionKind::Restart => app.restart(),
    }
    .map_err(VerifyError::Application)?;
    let after = app
        .observe(&contract.state)
        .map_err(VerifyError::Application)?;
    let failure = check_after_step(contract, action, before, &input, &after)?;
    Ok((failure, after))
}

fn check_after_step(
    contract: &Contract,
    action: &Action,
    before: &Value,
    input: &Value,
    after: &Value,
) -> Result<Option<ObservedFailure>, VerifyError> {
    for predicate in &action.postconditions {
        if let Some(failure) = evaluate_predicate(predicate, [before, input, after])? {
            return Ok(Some(observed_failure(
                predicate, before, input, after, failure,
            )));
        }
    }
    check_invariants_with_context(contract, after, before, input)
}

fn check_invariants(
    contract: &Contract,
    state: &Value,
) -> Result<Option<ObservedFailure>, VerifyError> {
    check_invariants_with_context(contract, state, state, &Value::Null)
}

fn check_invariants_with_context(
    contract: &Contract,
    state: &Value,
    before: &Value,
    input: &Value,
) -> Result<Option<ObservedFailure>, VerifyError> {
    for predicate in &contract.invariants {
        if let Some(failure) = evaluate_predicate(predicate, [state, &Value::Null, &Value::Null])? {
            return Ok(Some(observed_failure(
                predicate, before, input, state, failure,
            )));
        }
    }
    Ok(None)
}

fn observed_failure(
    predicate: &Predicate,
    before: &Value,
    input: &Value,
    after: &Value,
    failure: PredicateFailure,
) -> ObservedFailure {
    ObservedFailure {
        predicate: predicate.clone(),
        before: before.clone(),
        input: input.clone(),
        after: after.clone(),
        expected: failure.expected,
        actual: failure.actual,
    }
}

fn action_input(action: &Action, call: &Call) -> Result<Value, VerifyError> {
    if action.params.len() != call.args.len() {
        return Err(VerifyError::Internal(format!(
            "call {} has {} arguments but {} were declared",
            call.action,
            call.args.len(),
            action.params.len()
        )));
    }
    let values = action
        .params
        .iter()
        .zip(&call.args)
        .map(|(param, value)| (param.name.clone(), value.clone()))
        .collect::<Map<String, Value>>();
    Ok(Value::Object(values))
}

fn reduce<A: Application, F: FnMut() -> Result<A, AppError>>(
    contract: &Contract,
    make_app: &mut F,
    original: Vec<Call>,
    confirmed: ObservedFailure,
    target_property: &str,
    budget: usize,
) -> Result<Reduction, VerifyError> {
    if budget == 0 {
        return Ok(Reduction {
            sequence: original,
            observed: confirmed,
            status: ShrinkStatus::BudgetExhausted,
            attempts: 0,
            reason: Some("candidate reduction disabled by zero shrink budget".into()),
        });
    }

    let mut retained = original;
    let mut retained_observed = confirmed;
    let mut attempts = 0;
    loop {
        let mut accepted = false;
        let mut chunk_size = retained.len();
        while chunk_size > 0 {
            let mut start = 0;
            while start < retained.len() {
                let end = (start + chunk_size).min(retained.len());
                let mut candidate = retained.clone();
                candidate.drain(start..end);
                match try_candidate(
                    contract,
                    make_app,
                    &candidate,
                    target_property,
                    &mut attempts,
                    budget,
                )? {
                    CandidateResult::Accepted(found) => {
                        retained = candidate;
                        retained_observed = *found;
                        accepted = true;
                        break;
                    }
                    CandidateResult::Rejected => {}
                    CandidateResult::BudgetExhausted => {
                        return Ok(Reduction {
                            sequence: retained,
                            observed: retained_observed,
                            status: ShrinkStatus::BudgetExhausted,
                            attempts,
                            reason: Some("candidate replay budget exhausted".into()),
                        });
                    }
                    CandidateResult::Interrupted(reason) => {
                        return Ok(Reduction {
                            sequence: retained,
                            observed: retained_observed,
                            status: ShrinkStatus::Interrupted,
                            attempts,
                            reason: Some(reason),
                        });
                    }
                }
                start += chunk_size;
            }
            if accepted {
                break;
            }
            if chunk_size == 1 {
                break;
            }
            chunk_size = (chunk_size / 2).max(1);
        }
        if accepted {
            continue;
        }

        'arguments: for call_index in 0..retained.len() {
            let action = contract
                .actions
                .iter()
                .find(|action| action.name == retained[call_index].action)
                .ok_or_else(|| {
                    VerifyError::Internal(format!(
                        "unknown retained action {}",
                        retained[call_index].action
                    ))
                })?;
            for argument_index in 0..retained[call_index].args.len() {
                for value in simpler_values(
                    &retained[call_index].args[argument_index],
                    &action.params[argument_index].ty,
                ) {
                    let mut candidate = retained.clone();
                    candidate[call_index].args[argument_index] = value;
                    match try_candidate(
                        contract,
                        make_app,
                        &candidate,
                        target_property,
                        &mut attempts,
                        budget,
                    )? {
                        CandidateResult::Accepted(found) => {
                            retained = candidate;
                            retained_observed = *found;
                            accepted = true;
                            break 'arguments;
                        }
                        CandidateResult::Rejected => {}
                        CandidateResult::BudgetExhausted => {
                            return Ok(Reduction {
                                sequence: retained,
                                observed: retained_observed,
                                status: ShrinkStatus::BudgetExhausted,
                                attempts,
                                reason: Some("candidate replay budget exhausted".into()),
                            });
                        }
                        CandidateResult::Interrupted(reason) => {
                            return Ok(Reduction {
                                sequence: retained,
                                observed: retained_observed,
                                status: ShrinkStatus::Interrupted,
                                attempts,
                                reason: Some(reason),
                            });
                        }
                    }
                }
            }
        }
        if !accepted {
            return Ok(Reduction {
                sequence: retained,
                observed: retained_observed,
                status: ShrinkStatus::FixedPoint,
                attempts,
                reason: None,
            });
        }
    }
}

enum CandidateResult {
    Accepted(Box<ObservedFailure>),
    Rejected,
    BudgetExhausted,
    Interrupted(String),
}

fn try_candidate<A: Application, F: FnMut() -> Result<A, AppError>>(
    contract: &Contract,
    make_app: &mut F,
    candidate: &[Call],
    target_property: &str,
    attempts: &mut usize,
    budget: usize,
) -> Result<CandidateResult, VerifyError> {
    if *attempts >= budget {
        return Ok(CandidateResult::BudgetExhausted);
    }
    *attempts += 1;
    match replay_fresh(contract, make_app, candidate) {
        Ok(ReplayOutcome::Failure(found)) if found.predicate.label == target_property => {
            Ok(CandidateResult::Accepted(found))
        }
        Ok(ReplayOutcome::Failure(_)) | Ok(ReplayOutcome::Pass) => Ok(CandidateResult::Rejected),
        Err(VerifyError::Application(error)) => Ok(CandidateResult::Interrupted(format!(
            "candidate replay interrupted: {}",
            error.message
        ))),
        Err(error) => Err(error),
    }
}

fn simpler_values(value: &Value, ty: &Type) -> Vec<Value> {
    let mut values = match ty {
        Type::Optional(inner) if !value.is_null() => {
            let mut candidates = vec![Value::Null];
            candidates.extend(simpler_values(value, inner));
            candidates
        }
        Type::Float => value
            .as_f64()
            .map(|number| {
                [0.0, 1.0, -1.0, number / 2.0]
                    .into_iter()
                    .filter(|candidate| candidate.abs() < number.abs())
                    .filter_map(serde_json::Number::from_f64)
                    .map(Value::Number)
                    .collect()
            })
            .unwrap_or_default(),
        Type::Bool => match value.as_bool() {
            Some(true) => vec![Value::Bool(false)],
            _ => Vec::new(),
        },
        Type::Int => value
            .as_i64()
            .map(|number| {
                let mut candidates = vec![0, 1, -1, number / 2];
                candidates.retain(|candidate| {
                    integer_complexity(*candidate) < integer_complexity(number)
                });
                candidates.into_iter().map(Value::from).collect()
            })
            .unwrap_or_default(),
        Type::String => value
            .as_str()
            .map(|text| {
                let chars = text.chars().collect::<Vec<_>>();
                let mut candidates = vec![String::new()];
                if chars.len() > 1 {
                    candidates.push(chars[..chars.len() / 2].iter().collect());
                    candidates.push(chars[..1].iter().collect());
                }
                candidates.into_iter().map(Value::String).collect()
            })
            .unwrap_or_default(),
        Type::List(_) | Type::Record(_) | Type::Null | Type::Optional(_) => Vec::new(),
    };
    values.retain(|candidate| candidate != value);
    deduplicate(&mut values);
    values
}

fn integer_complexity(value: i64) -> u64 {
    value.unsigned_abs() * 2 + u64::from(value.is_negative())
}

fn deduplicate(values: &mut Vec<Value>) {
    let mut unique = Vec::with_capacity(values.len());
    for value in values.drain(..) {
        if !unique.contains(&value) {
            unique.push(value);
        }
    }
    *values = unique;
}

fn run_diagnostic(predicate: &Predicate, code: &str, message: impl Into<String>) -> VerifyError {
    VerifyError::Contract(Diagnostic::new(
        &predicate.location.file,
        Span {
            start: 0,
            end: 0,
            line: predicate.location.line,
            column: predicate.location.column,
        },
        code,
        message,
    ))
}
