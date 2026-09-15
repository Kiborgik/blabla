use super::corpus::Corpus;
use super::generator::Guidance;
use super::*;
use crate::report::{CampaignMetrics, CoverageStatus, GenerationDecision};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

pub(super) fn campaign<A: Application, F: FnMut() -> Result<A, AppError>>(
    contract: &Contract,
    options: &RunOptions,
    mut make_app: F,
    observer: &mut dyn FnMut(&Progress),
) -> Result<RunReport, VerifyError> {
    validate_run(contract, options)?;
    let started = Instant::now();
    let mut coverage = Coverage::new(contract);
    let guidance = Guidance::new(contract);
    let mut corpus = Corpus::new();
    let mut growth = BTreeMap::new();
    let mut influence: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut rng = SplitMix64::new(options.seed);
    let mut sequences = Vec::new();
    let mut steps_executed = 0;
    let mut metrics = CampaignMetrics {
        action_budget: options.cases.saturating_mul(options.steps),
        ..Default::default()
    };
    let guided = contract
        .actions
        .iter()
        .any(|a| !a.postconditions.is_empty());
    for case_index in 0..options.cases {
        let mut app = make_app().map_err(VerifyError::Application)?;
        app.reset().map_err(VerifyError::Application)?;
        metrics.resets += 1;
        let state = app
            .observe(&contract.state)
            .map_err(VerifyError::Application)?;
        let failure = check_invariants(contract, &state)?;
        coverage.record(CoverageEvent {
            action: None,
            before: &state,
            input: &Value::Null,
            after: &state,
            sequence: &[],
            action_index: steps_executed,
            elapsed_ms: elapsed(&started),
            failed: failure.as_ref().map(|f| f.predicate.label.as_str()),
        });
        let mut sequence = Vec::new();
        if let Some(failure) = failure {
            metrics.detection_ms = Some(elapsed(&started));
            app.finish().map_err(VerifyError::Application)?;
            sequences.push(sequence);
            let index = sequences.len() - 1;
            observer(&progress_of(
                &coverage,
                options,
                case_index,
                steps_executed,
                true,
            ));
            let shrinking = Instant::now();
            let result = finish_failure(
                contract,
                options,
                &mut make_app,
                sequences,
                index,
                steps_executed,
                failure,
            )
            .map(|mut report| {
                report.cases_executed = case_index + 1;
                report
            });
            metrics.shrink_ms = elapsed(&shrinking);
            return with_coverage(result, &coverage, metrics, &started);
        }
        corpus.retain(guidance.signature(&state), state, &sequence, false);
        let mut replay = VecDeque::new();
        let mut target = None;
        let mut prefix_serial = None;
        let mut continuation = 0;
        for step in 0..options.steps {
            if guided && replay.is_empty() && continuation >= 12 && !coverage.complete() {
                continuation = 0;
                let targets = coverage.targets();
                target = Some(targets[rng.sample_below_rejecting_modulo_bias(targets.len())]);
                let index = target.unwrap();
                let mut best = None;
                let mut best_score = f64::NEG_INFINITY;
                for (entry_index, entry) in corpus.entries.iter().enumerate() {
                    if entry.sequence.len() + 1 >= options.steps - step {
                        continue;
                    }
                    let action = target_action(contract, &coverage, index, &mut rng);
                    let mut score: f64 = 0.0;
                    for _ in 0..4 {
                        let call = guidance.candidate(action, &entry.state, &mut rng)?;
                        score = score.max(coverage.score(
                            index,
                            &entry.state,
                            &action_input(action, &call)?,
                        ));
                    }
                    if score > best_score
                        || (score == best_score
                            && best.is_some_and(|i: usize| {
                                entry.sequence.len() < corpus.entries[i].sequence.len()
                            }))
                    {
                        best_score = score;
                        best = Some(entry_index);
                    }
                }
                if let Some(index) = best {
                    let entry = &corpus.entries[index];
                    replay = entry.sequence.iter().cloned().collect();
                    prefix_serial = Some(entry.serial);
                    sequences.push(std::mem::take(&mut sequence));
                    app.reset().map_err(VerifyError::Application)?;
                    metrics.resets += 1;
                    let state = app
                        .observe(&contract.state)
                        .map_err(VerifyError::Application)?;
                    if let Some(failure) = check_invariants(contract, &state)? {
                        coverage.record(CoverageEvent {
                            action: None,
                            before: &state,
                            input: &Value::Null,
                            after: &state,
                            sequence: &[],
                            action_index: steps_executed,
                            elapsed_ms: elapsed(&started),
                            failed: Some(&failure.predicate.label),
                        });
                        metrics.detection_ms = Some(elapsed(&started));
                        app.finish().map_err(VerifyError::Application)?;
                        sequences.push(sequence);
                        let index = sequences.len() - 1;
                        observer(&progress_of(
                            &coverage,
                            options,
                            case_index,
                            steps_executed,
                            true,
                        ));
                        let shrinking = Instant::now();
                        let result = finish_failure(
                            contract,
                            options,
                            &mut make_app,
                            sequences,
                            index,
                            steps_executed,
                            failure,
                        )
                        .map(|mut report| {
                            report.cases_executed = case_index + 1;
                            report
                        });
                        metrics.shrink_ms = elapsed(&shrinking);
                        return with_coverage(result, &coverage, metrics, &started);
                    }
                    coverage.record(CoverageEvent {
                        action: None,
                        before: &state,
                        input: &Value::Null,
                        after: &state,
                        sequence: &[],
                        action_index: steps_executed,
                        elapsed_ms: elapsed(&started),
                        failed: None,
                    });
                }
            }
            let before = app
                .observe(&contract.state)
                .map_err(VerifyError::Application)?;
            let was_replay = !replay.is_empty();
            let random;
            let call = if let Some(call) = replay.pop_front() {
                metrics.replay_actions += 1;
                random = false;
                call
            } else if guided && !coverage.complete() {
                continuation += 1;
                let targets = coverage.targets();
                if target.is_none_or(|i| !targets.contains(&i)) {
                    target = Some(targets[rng.sample_below_rejecting_modulo_bias(targets.len())]);
                }
                let index = target.unwrap();
                random = rng.sample_below_rejecting_modulo_bias(4) == 0;
                if random {
                    generate_call(contract, &before, &mut rng)?
                } else {
                    let population = coverage
                        .population_field(index, &before)
                        .and_then(|field| growth.get(&field));
                    let wanted = population
                        .and_then(|name| contract.actions.iter().find(|a| &a.name == name))
                        .unwrap_or_else(|| target_action(contract, &coverage, index, &mut rng));
                    let candidate = if population.is_some() {
                        guidance.growing_candidate(wanted, &before, &mut rng)?
                    } else {
                        best_call(wanted, &before, &guidance, &coverage, index, &mut rng)?
                    };
                    let score = coverage.score(index, &before, &action_input(wanted, &candidate)?);
                    if population.is_some()
                        || score >= 0.999
                        || rng.sample_below_rejecting_modulo_bias(3) == 0
                    {
                        candidate
                    } else {
                        let missing = coverage.unmet_fields(
                            index,
                            &before,
                            &action_input(wanted, &candidate)?,
                        );
                        let related: Vec<_> = contract
                            .actions
                            .iter()
                            .filter(|a| {
                                influence
                                    .get(&a.name)
                                    .is_some_and(|fields| !fields.is_disjoint(&missing))
                            })
                            .collect();
                        let action = if related.is_empty() {
                            &contract.actions
                                [rng.sample_below_rejecting_modulo_bias(contract.actions.len())]
                        } else {
                            related[rng.sample_below_rejecting_modulo_bias(related.len())]
                        };
                        preparation_call(action, &before, &guidance, &coverage, &mut rng)?
                    }
                }
            } else {
                target = None;
                continuation += 1;
                random = true;
                generate_call(contract, &before, &mut rng)?
            };
            metrics.decisions.push(GenerationDecision {
                action_index: steps_executed + 1,
                target: target.map(|i| coverage.reports[i].id.clone()),
                prefix: if was_replay { prefix_serial } else { None },
                random,
            });
            let action = contract
                .actions
                .iter()
                .find(|a| a.name == call.action)
                .unwrap();
            let input = action_input(action, &call)?;
            let (failure, after) = execute_observed_step(&mut app, contract, &call, &before)?;
            changed_fields(
                &before,
                &after,
                influence.entry(action.name.clone()).or_default(),
            );
            for field in &contract.state {
                if let (Some(old), Some(new)) = (
                    before.get(&field.name).and_then(Value::as_array),
                    after.get(&field.name).and_then(Value::as_array),
                ) && new.len() > old.len()
                {
                    growth
                        .entry(field.name.clone())
                        .or_insert_with(|| action.name.clone());
                }
            }
            sequence.push(call);
            steps_executed += 1;
            let old_verified = coverage.reports.iter().filter(|r| r.witnesses > 0).count();
            coverage.record(CoverageEvent {
                action: Some(&action.name),
                before: &before,
                input: &input,
                after: &after,
                sequence: &sequence,
                action_index: steps_executed,
                elapsed_ms: elapsed(&started),
                failed: failure.as_ref().map(|f| f.predicate.label.as_str()),
            });
            let new_verified = coverage.reports.iter().filter(|r| r.witnesses > 0).count();
            observer(&progress_of(
                &coverage,
                options,
                case_index,
                steps_executed,
                false,
            ));
            if !was_replay {
                corpus.retain(
                    guidance.signature(&after),
                    after,
                    &sequence,
                    new_verified > old_verified,
                );
            }
            metrics.corpus_size = corpus.entries.len();
            metrics.corpus_peak = corpus.peak;
            if coverage.complete() && metrics.actions_to_full_coverage.is_none() {
                metrics.actions_to_full_coverage = Some(steps_executed);
                metrics.time_to_full_coverage_ms = Some(elapsed(&started));
            }
            if let Some(failure) = failure {
                metrics.detection_ms = Some(elapsed(&started));
                app.finish().map_err(VerifyError::Application)?;
                sequences.push(sequence);
                let index = sequences.len() - 1;
                observer(&progress_of(
                    &coverage,
                    options,
                    case_index,
                    steps_executed,
                    true,
                ));
                let shrinking = Instant::now();
                let result = finish_failure(
                    contract,
                    options,
                    &mut make_app,
                    sequences,
                    index,
                    steps_executed,
                    failure,
                )
                .map(|mut r| {
                    r.cases_executed = case_index + 1;
                    r
                });
                metrics.shrink_ms = elapsed(&shrinking);
                return with_coverage(result, &coverage, metrics, &started);
            }
        }
        app.finish().map_err(VerifyError::Application)?;
        sequences.push(sequence);
    }
    metrics.elapsed_ms = elapsed(&started);
    Ok(RunReport {
        verifier_version: env!("CARGO_PKG_VERSION"),
        status: if coverage.complete() {
            RunStatus::Green
        } else {
            RunStatus::Yellow
        },
        seed: options.seed,
        cases: options.cases,
        steps: options.steps,
        shrink_budget: options.shrink_budget,
        cases_executed: options.cases,
        steps_executed,
        sequences,
        coverage_summary: coverage.summary(),
        metrics,
        failure: None,
    })
}

fn progress_of(
    coverage: &Coverage,
    options: &RunOptions,
    case_index: usize,
    actions_executed: usize,
    shrinking: bool,
) -> Progress {
    Progress {
        case_index,
        cases: options.cases,
        actions_executed,
        action_budget: options.cases.saturating_mul(options.steps),
        verified: coverage
            .reports
            .iter()
            .filter(|report| report.status == CoverageStatus::Verified)
            .count(),
        total: coverage.reports.len(),
        shrinking,
    }
}

fn changed_fields(before: &Value, after: &Value, fields: &mut BTreeSet<String>) {
    if before == after {
        return;
    }
    match (before, after) {
        (Value::Object(old), Value::Object(new)) => {
            for (key, value) in new {
                if let Some(previous) = old.get(key)
                    && previous != value
                {
                    fields.insert(key.clone());
                    changed_fields(previous, value, fields);
                }
            }
        }
        (Value::Array(old), Value::Array(new)) => {
            for (a, b) in old.iter().zip(new) {
                changed_fields(a, b, fields);
            }
        }
        _ => {}
    }
}

fn preparation_call(
    action: &Action,
    state: &Value,
    guidance: &Guidance,
    coverage: &Coverage,
    rng: &mut SplitMix64,
) -> Result<Call, VerifyError> {
    let mut best = guidance.candidate(action, state, rng)?;
    let mut score = coverage.action_score(&action.name, state, &action_input(action, &best)?);
    for _ in 0..15 {
        let candidate = guidance.candidate(action, state, rng)?;
        let next = coverage.action_score(&action.name, state, &action_input(action, &candidate)?);
        if next > score {
            best = candidate;
            score = next;
        }
    }
    Ok(best)
}

fn target_action<'a>(
    contract: &'a Contract,
    coverage: &Coverage,
    index: usize,
    rng: &mut SplitMix64,
) -> &'a Action {
    coverage.reports[index]
        .action
        .as_ref()
        .and_then(|name| contract.actions.iter().find(|a| a.name == *name))
        .unwrap_or_else(|| {
            &contract.actions[rng.sample_below_rejecting_modulo_bias(contract.actions.len())]
        })
}

fn best_call(
    action: &Action,
    state: &Value,
    guidance: &Guidance,
    coverage: &Coverage,
    target: usize,
    rng: &mut SplitMix64,
) -> Result<Call, VerifyError> {
    let mut best = guidance.candidate(action, state, rng)?;
    let mut score = coverage.score(target, state, &action_input(action, &best)?);
    for _ in 0..15 {
        let candidate = guidance.candidate(action, state, rng)?;
        for (index, value) in candidate.args.iter().enumerate() {
            let mut changed = best.clone();
            changed.args[index] = value.clone();
            let next = coverage.score(target, state, &action_input(action, &changed)?);
            if next > score {
                best = changed;
                score = next;
            }
        }
        let next = coverage.score(target, state, &action_input(action, &candidate)?);
        if next > score {
            best = candidate;
            score = next;
        }
    }
    Ok(best)
}
