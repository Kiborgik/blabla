use super::coverage::Coverage;
use super::generator::SplitMix64;
use super::{Budget, Progress, elapsed, run_counted};
use crate::application::Application;
use crate::diagnostic::{AppError, Diagnostic, Location};
use crate::ir::{Contract, Field};
use crate::report::{
    Call, CampaignMetrics, CampaignReport, RunOptions, RunReport, RunStatus, VerifyError,
};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::BTreeSet;
use std::rc::Rc;
use std::sync::{Mutex, MutexGuard, PoisonError, mpsc};
use std::thread;
use std::time::Instant;

#[derive(Clone, Debug)]
pub struct Campaign {
    pub contracts: Vec<String>,
    pub key: u64,
    pub contract: Contract,
}

pub fn campaign_seed(seed: u64, key: u64) -> u64 {
    SplitMix64::new(seed ^ key).next_u64()
}

pub fn run_campaigns<A, F>(
    campaigns: &[Campaign],
    options: &RunOptions,
    jobs: usize,
    make_app: F,
    observer: &mut dyn FnMut(&Progress),
) -> Result<RunReport, VerifyError>
where
    A: Application,
    F: Fn() -> Result<A, AppError> + Sync,
{
    if campaigns.is_empty() {
        return Err(VerifyError::Internal("no behavior campaign to run".into()));
    }
    let started = Instant::now();
    let union: Vec<Field> = campaigns
        .iter()
        .flat_map(|campaign| campaign.contract.state.iter().cloned())
        .collect();
    let owned: Vec<usize> = campaigns
        .iter()
        .map(|campaign| Coverage::new(&campaign.contract).reports.len())
        .collect();
    let total = owned.iter().sum();
    let shares = shares(&owned, total, options.cases);
    let action_budget = shares.iter().sum::<usize>().saturating_mul(options.steps);
    let next = Mutex::new(Some(0));
    let (sender, events) = mpsc::channel();
    let mut finished: Vec<Option<Result<Run<'_>, VerifyError>>> =
        campaigns.iter().map(|_| None).collect();
    thread::scope(|scope| {
        for _ in 0..jobs.clamp(1, campaigns.len()) {
            let sender = sender.clone();
            let (next, union, shares, make_app, started) =
                (&next, &union, &shares, &make_app, &started);
            scope.spawn(move || {
                while let Some(index) = claim(next, campaigns.len()) {
                    let campaign = &campaigns[index];
                    let seeded = RunOptions {
                        seed: campaign_seed(options.seed, campaign.key),
                        cases: shares[index],
                        ..options.clone()
                    };
                    let offset = elapsed(started);
                    let result = run_campaign(
                        campaigns,
                        campaign,
                        union,
                        &seeded,
                        make_app,
                        &mut |progress| {
                            let _ = sender.send(Event::Progress(index, *progress));
                        },
                    );
                    if result.is_err() {
                        *lock(next) = None;
                    }
                    let _ = sender.send(Event::Done(
                        index,
                        Box::new(result.map(|report| Run {
                            campaign,
                            seed: seeded.seed,
                            offset,
                            report,
                        })),
                    ));
                }
            });
        }
        drop(sender);
        let mut counted = vec![(0, 0); campaigns.len()];
        for event in events {
            match event {
                Event::Progress(index, progress) => {
                    counted[index] = (progress.actions_executed, progress.verified);
                    observer(&Progress {
                        actions_executed: counted.iter().map(|(actions, _)| actions).sum(),
                        action_budget,
                        verified: counted.iter().map(|(_, verified)| verified).sum(),
                        total,
                        ..progress
                    });
                }
                Event::Done(index, result) => {
                    if let Ok(run) = &*result {
                        counted[index] = (
                            run.report.steps_executed,
                            run.report.coverage_summary.verified,
                        );
                    }
                    finished[index] = Some(*result);
                }
            }
        }
    });
    let runs = finished
        .into_iter()
        .map(|slot| {
            slot.unwrap_or_else(|| {
                Err(VerifyError::Internal(
                    "a campaign was never scheduled".into(),
                ))
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(aggregate(options, runs, elapsed(&started)))
}

enum Event<'a> {
    Progress(usize, Progress),
    Done(usize, Box<Result<Run<'a>, VerifyError>>),
}

fn claim(next: &Mutex<Option<usize>>, count: usize) -> Option<usize> {
    let mut next = lock(next);
    let index = next.filter(|&index| index < count)?;
    *next = Some(index + 1);
    Some(index)
}

fn lock(next: &Mutex<Option<usize>>) -> MutexGuard<'_, Option<usize>> {
    next.lock().unwrap_or_else(PoisonError::into_inner)
}

fn run_campaign<A: Application>(
    campaigns: &[Campaign],
    campaign: &Campaign,
    union: &[Field],
    options: &RunOptions,
    make_app: &impl Fn() -> Result<A, AppError>,
    observer: &mut dyn FnMut(&Progress),
) -> Result<RunReport, VerifyError> {
    let outside: Vec<String> = union
        .iter()
        .filter(|field| !campaign.contract.state.contains(field))
        .map(|field| field.name.clone())
        .collect();
    let coupling = Rc::new(RefCell::new(None));
    let result = run_counted(
        &campaign.contract,
        options,
        Budget::Ceiling,
        || {
            make_app().map(|app| Guarded {
                app,
                union,
                outside: &outside,
                baseline: None,
                pending: None,
                coupling: coupling.clone(),
            })
        },
        observer,
    );
    match coupling.take() {
        Some(found) => Err(coupling_error(campaigns, campaign, found)),
        None => result,
    }
}

fn shares(owned: &[usize], total: usize, cases: usize) -> Vec<usize> {
    let pool = cases.saturating_mul(owned.len());
    owned
        .iter()
        .map(|&count| pool.saturating_mul(count).div_ceil(total.max(1)).max(1))
        .collect()
}

struct Coupling {
    action: String,
    fields: Vec<String>,
}

struct Guarded<'a, A> {
    app: A,
    union: &'a [Field],
    outside: &'a [String],
    baseline: Option<Vec<Option<Value>>>,
    pending: Option<String>,
    coupling: Rc<RefCell<Option<Coupling>>>,
}

impl<A: Application> Application for Guarded<'_, A> {
    fn reset(&mut self) -> Result<(), AppError> {
        self.baseline = None;
        self.pending = None;
        self.app.reset()
    }

    fn call(&mut self, call: &Call) -> Result<(), AppError> {
        self.pending = Some(call.action.clone());
        self.app.call(call)
    }

    fn restart(&mut self) -> Result<(), AppError> {
        self.pending = Some("restart".into());
        self.app.restart()
    }

    fn observe(&mut self, schema: &[Field]) -> Result<Value, AppError> {
        let observed = self.app.observe(self.union)?;
        let Some(object) = observed.as_object() else {
            return Ok(observed);
        };
        let outside: Vec<Option<Value>> = self
            .outside
            .iter()
            .map(|name| object.get(name).cloned())
            .collect();
        if let (Some(action), Some(baseline)) = (self.pending.take(), &self.baseline) {
            let fields: Vec<String> = self
                .outside
                .iter()
                .zip(baseline.iter().zip(&outside))
                .filter(|(_, (was, is))| was != is)
                .map(|(name, _)| name.clone())
                .collect();
            if !fields.is_empty() {
                *self.coupling.borrow_mut() = Some(Coupling { action, fields });
                return Err(AppError::new(
                    "APP_COUPLING",
                    "an action changed state that another campaign verifies",
                ));
            }
        }
        self.baseline = Some(outside);
        Ok(Value::Object(
            schema
                .iter()
                .filter_map(|field| {
                    object
                        .get(&field.name)
                        .map(|value| (field.name.clone(), value.clone()))
                })
                .collect(),
        ))
    }

    fn finish(&mut self) -> Result<(), AppError> {
        self.app.finish()
    }
}

fn coupling_error(campaigns: &[Campaign], campaign: &Campaign, coupling: Coupling) -> VerifyError {
    let owners: BTreeSet<String> = campaigns
        .iter()
        .filter(|other| {
            other
                .contract
                .state
                .iter()
                .any(|field| coupling.fields.contains(&field.name))
        })
        .flat_map(|other| qualified(&other.contracts))
        .collect();
    VerifyError::Contract(Diagnostic {
        location: Location {
            file: "<run>".into(),
            line: 1,
            column: 1,
        },
        code: "BLA-RUN-COUPLING".into(),
        message: format!(
            "action {} of {} changed {} of {}, which verify in a separate campaign; declare that state in both contracts so they verify together",
            coupling.action,
            qualified(&campaign.contracts).join(", "),
            coupling.fields.join(", "),
            owners.into_iter().collect::<Vec<_>>().join(", ")
        ),
    })
}

fn qualified(contracts: &[String]) -> Vec<String> {
    contracts
        .iter()
        .map(|name| format!("contract::{name}"))
        .collect()
}

struct Run<'a> {
    campaign: &'a Campaign,
    seed: u64,
    offset: u64,
    report: RunReport,
}

fn aggregate(options: &RunOptions, runs: Vec<Run<'_>>, elapsed_ms: u64) -> RunReport {
    let mut total = RunReport {
        verifier_version: env!("CARGO_PKG_VERSION"),
        status: RunStatus::Green,
        seed: options.seed,
        cases: options.cases,
        steps: options.steps,
        shrink_budget: options.shrink_budget,
        cases_executed: 0,
        steps_executed: 0,
        sequences: Vec::new(),
        coverage_summary: Default::default(),
        metrics: CampaignMetrics {
            actions_to_full_coverage: Some(0),
            time_to_full_coverage_ms: Some(0),
            elapsed_ms,
            ..Default::default()
        },
        failure: None,
        campaigns: Vec::new(),
    };
    for run in runs {
        let RunReport {
            status,
            cases_executed,
            steps_executed,
            sequences,
            coverage_summary: summary,
            metrics,
            failure,
            ..
        } = run.report;
        let actions = total.steps_executed;
        let failure = failure.map(|mut failure| {
            failure.case_index += total.sequences.len();
            failure
        });
        total.status = worse(&total.status, &status);
        total.cases_executed += cases_executed;
        total.steps_executed += steps_executed;
        total.sequences.extend(sequences);
        total.coverage_summary.verified += summary.verified;
        total.coverage_summary.unexercised += summary.unexercised;
        total.coverage_summary.violated += summary.violated;
        total
            .coverage_summary
            .coverage
            .extend(summary.coverage.into_iter().map(|mut obligation| {
                obligation.first_witness_action =
                    obligation.first_witness_action.map(|index| index + actions);
                obligation
            }));
        let sum = &mut total.metrics;
        sum.action_budget += metrics.action_budget;
        sum.total_actions += metrics.total_actions;
        sum.reduction_actions += metrics.reduction_actions;
        sum.replay_actions += metrics.replay_actions;
        sum.resets += metrics.resets;
        sum.corpus_size += metrics.corpus_size;
        sum.corpus_peak = sum.corpus_peak.max(metrics.corpus_peak);
        sum.actions_to_full_coverage = sum
            .actions_to_full_coverage
            .zip(metrics.actions_to_full_coverage)
            .map(|(before, after)| before + after);
        sum.time_to_full_coverage_ms = sum
            .time_to_full_coverage_ms
            .zip(metrics.time_to_full_coverage_ms)
            .map(|(before, after)| before + after);
        sum.detection_ms = sum
            .detection_ms
            .or(metrics.detection_ms.map(|ms| run.offset + ms));
        sum.shrink_ms += metrics.shrink_ms;
        sum.decisions
            .extend(metrics.decisions.into_iter().map(|mut decision| {
                decision.action_index += actions;
                decision
            }));
        total.campaigns.push(CampaignReport {
            contracts: run.campaign.contracts.clone(),
            seed: run.seed,
            status,
            cases_executed,
            steps_executed,
            ceiling: metrics.action_budget,
            elapsed_ms: metrics.elapsed_ms,
            actions_to_full_coverage: metrics.actions_to_full_coverage,
            verified: summary.verified,
            unexercised: summary.unexercised,
            violated: summary.violated,
            failure: failure.clone(),
        });
        if total.failure.is_none() {
            total.failure = failure;
        }
    }
    total
}

fn worse(left: &RunStatus, right: &RunStatus) -> RunStatus {
    match (left, right) {
        (RunStatus::Red, _) | (_, RunStatus::Red) => RunStatus::Red,
        (RunStatus::Yellow, _) | (_, RunStatus::Yellow) => RunStatus::Yellow,
        _ => RunStatus::Green,
    }
}
