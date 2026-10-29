use blabla::application::Application;
use blabla::diagnostic::AppError;
use blabla::ir::Field;
use blabla::report::{
    Call, CampaignReport, CoverageStatus, RunOptions, RunReport, RunStatus, VerifyError,
};
use blabla::semantics::compile;
use blabla::verify::{Campaign, Progress, campaign_seed, run, run_campaigns};
use serde_json::{Value, json};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::Duration;

struct FixedApp {
    state: Value,
    break_on_call: bool,
}

impl Application for FixedApp {
    fn reset(&mut self) -> Result<(), AppError> {
        Ok(())
    }

    fn call(&mut self, _: &Call) -> Result<(), AppError> {
        if self.break_on_call {
            self.state["value"] = json!(9);
        }
        Ok(())
    }

    fn observe(&mut self, _: &[Field]) -> Result<Value, AppError> {
        Ok(self.state.clone())
    }

    fn restart(&mut self) -> Result<(), AppError> {
        self.call(&Call {
            action: "restart".into(),
            args: vec![],
        })
    }
}

fn campaign(source: &str, state: Value, broken: bool) -> Value {
    let contract = compile("coverage.bla", source).unwrap();
    serde_json::to_value(
        run(
            &contract,
            &RunOptions {
                seed: 0,
                cases: 1,
                steps: 8,
                shrink_budget: 32,
            },
            || {
                Ok(FixedApp {
                    state: state.clone(),
                    break_on_call: broken,
                })
            },
        )
        .unwrap(),
    )
    .unwrap()
}

const GUARDED: &str = r#"
state sealed: bool
state value: int
action inspect()
when inspect { expect "protected": not before.sealed or after.value == before.value }
"#;

#[test]
fn guard_never_true_is_yellow() {
    let report = campaign(GUARDED, json!({"sealed":false,"value":1}), false);
    assert_eq!(report["status"], "yellow", "{report}");
    assert!(report["unexercised"].as_u64().unwrap() > 0);
}

#[test]
fn witnessed_guard_passes_green() {
    let report = campaign(GUARDED, json!({"sealed":true,"value":1}), false);
    assert_eq!(report["status"], "green", "{report}");
}

#[test]
fn witnessed_guard_failure_is_red() {
    let report = campaign(GUARDED, json!({"sealed":true,"value":1}), true);
    assert_eq!(report["status"], "red", "{report}");
    assert_eq!(report["property"], "protected");
    assert_eq!(report["minimal_sequence_length"], 1);
    assert_eq!(report["metrics"]["total_actions"], 3);
    assert_eq!(report["metrics"]["reduction_actions"], 2);
    assert_eq!(report["coverage"][0]["evaluations"], 1);
}

#[test]
fn empty_quantifier_domain_is_yellow() {
    let report = campaign(
        r#"
state values: [int]
action inspect()
always "positive" { all(values, value => value > 0) }
"#,
        json!({"values":[]}),
        false,
    );
    assert_eq!(report["status"], "yellow", "{report}");
}

#[test]
fn nonempty_applicable_domain_is_verified() {
    let report = campaign(
        r#"
state values: [int]
action inspect()
always "positive" { all(values, value => value > 0) }
"#,
        json!({"values":[1]}),
        false,
    );
    assert_eq!(report["status"], "green", "{report}");
}

#[test]
fn nested_guarded_domain_is_not_vacuously_verified() {
    let report = campaign(
        r#"
type Item { sealed: bool, value: int }
state items: [Item]
action inspect()
always "protected" { all(items, item => not item.sealed or item.value == 1) }
"#,
        json!({"items":[{"sealed":false,"value":1}]}),
        false,
    );
    assert_eq!(report["status"], "yellow", "{report}");
}

#[test]
fn restart_without_relevant_state_is_yellow() {
    let report = campaign(
        r#"
state sealed: bool
action restart()
when restart { expect "durable": after.sealed == before.sealed }
"#,
        json!({"sealed":false}),
        false,
    );
    assert_eq!(report["status"], "yellow", "{report}");
}

#[test]
fn equivalent_guard_forms_cannot_award_vacuous_green() {
    for expression in [
        "not (before.sealed and after.value != before.value)",
        "(not before.sealed or after.value == before.value) == true",
        "after.value == before.value or not before.sealed",
    ] {
        let source = format!(
            "state sealed: bool\nstate value: int\naction inspect()\nwhen inspect {{ expect \"guarded\": {expression} }}"
        );
        assert_eq!(
            campaign(&source, json!({"sealed":false,"value":1}), false)["status"],
            "yellow",
            "{expression}"
        );
        assert_eq!(
            campaign(&source, json!({"sealed":true,"value":1}), false)["status"],
            "green",
            "{expression}"
        );
    }
}

struct ProgressApp {
    counter: i64,
}

impl Application for ProgressApp {
    fn reset(&mut self) -> Result<(), AppError> {
        self.counter = 0;
        Ok(())
    }
    fn call(&mut self, call: &Call) -> Result<(), AppError> {
        if call.action == "advance" {
            self.counter = (self.counter + 1).min(3);
        }
        Ok(())
    }
    fn observe(&mut self, _: &[Field]) -> Result<Value, AppError> {
        Ok(json!({"counter":self.counter}))
    }
}

#[test]
fn corpus_replays_useful_prefixes_with_one_case_and_deterministic_decisions() {
    let c = compile(
        "progress.bla",
        r#"
state counter: int
action advance()
action inspect()
when advance { expect "monotonic": after.counter >= before.counter }
when inspect { expect "rare": before.counter != 99 or after.counter == before.counter }
always "bounded" { counter <= 3 }
"#,
    )
    .unwrap();
    let options = RunOptions {
        seed: 0,
        cases: 1,
        steps: 128,
        shrink_budget: 32,
    };
    let first = run(&c, &options, || Ok(ProgressApp { counter: 0 })).unwrap();
    let second = run(&c, &options, || Ok(ProgressApp { counter: 0 })).unwrap();
    assert!(first.metrics.replay_actions > 0, "{:?}", first.metrics);
    assert!(first.metrics.corpus_size <= 128);
    assert_eq!(first.sequences.iter().map(Vec::len).sum::<usize>(), 128);
    assert_eq!(first.metrics.total_actions, 128);
    assert_eq!(first.metrics.decisions, second.metrics.decisions);
    assert_eq!(first.sequences, second.sequences);
    assert!(first.metrics.decisions.iter().any(|d| d.random));
    assert!(first.metrics.decisions.iter().any(|d| !d.random));
    assert_eq!(first.status, second.status);
    let facts = |report: blabla::report::RunReport| {
        report
            .coverage_summary
            .coverage
            .into_iter()
            .map(|p| {
                (
                    p.id,
                    p.status,
                    p.evaluations,
                    p.witnesses,
                    p.first_witness_action,
                    p.shortest_witness_trace,
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(facts(first), facts(second));
}

#[test]
fn uniqueness_requires_a_pair_and_negative_any_requires_a_nonempty_domain() {
    let unique =
        r#"state values: [int] action inspect() always "distinct" { unique(values, v => v) }"#;
    assert_eq!(
        campaign(unique, json!({"values":[1]}), false)["status"],
        "yellow"
    );
    assert_eq!(
        campaign(unique, json!({"values":[1,2]}), false)["status"],
        "green"
    );
    let negative =
        r#"state values: [int] action inspect() never "negative" { any(values, v => v < 0) }"#;
    assert_eq!(
        campaign(negative, json!({"values":[]}), false)["status"],
        "yellow"
    );
    assert_eq!(
        campaign(negative, json!({"values":[1]}), false)["status"],
        "green"
    );
}

#[test]
fn aggregate_restart_equality_requires_true_feature_state() {
    let source = r#"
type Item { id: string, sealed: bool }
state items: [Item]
action restart()
when restart { expect "durable": after.items == before.items }
"#;
    let report = campaign(source, json!({"items":[{"id":"A","sealed":false}]}), false);
    assert_eq!(report["status"], "yellow");
    assert!(report["coverage"].as_array().unwrap().iter().any(|p| {
        p["id"]
            .as_str()
            .unwrap()
            .ends_with(".restart.sealed.bool.true")
            && p["witnesses"] == 0
    }));
}

#[test]
fn forbidden_guarded_query_cannot_pass_without_its_relevant_state() {
    let source = r#"
type Item { sealed: bool, value: int }
state items: [Item]
action inspect()
never "bad-sealed" { any(items, i => i.sealed and i.value != 1) }
"#;
    assert_eq!(
        campaign(source, json!({"items":[{"sealed":false,"value":1}]}), false)["status"],
        "yellow"
    );
    assert_eq!(
        campaign(source, json!({"items":[{"sealed":true,"value":1}]}), false)["status"],
        "green"
    );
}

#[test]
fn corpus_replay_checks_invariants_and_preserves_failure_identity() {
    struct ReplayFault {
        counter: i64,
        resets: std::rc::Rc<std::cell::Cell<usize>>,
    }
    impl Application for ReplayFault {
        fn reset(&mut self) -> Result<(), AppError> {
            self.counter = 0;
            self.resets.set(self.resets.get() + 1);
            Ok(())
        }
        fn call(&mut self, call: &Call) -> Result<(), AppError> {
            if call.action == "advance" {
                self.counter = if self.resets.get() > 1 {
                    100
                } else {
                    (self.counter + 1).min(3)
                };
            }
            Ok(())
        }
        fn observe(&mut self, _: &[Field]) -> Result<Value, AppError> {
            Ok(json!({"counter":self.counter}))
        }
    }
    let c = compile(
        "replay.bla",
        r#"
state counter: int
action advance()
action inspect()
when advance { expect "monotonic": after.counter >= before.counter }
when inspect { expect "rare": before.counter != 99 or after.counter == before.counter }
always "bounded" { counter <= 3 }
"#,
    )
    .unwrap();
    let resets = std::rc::Rc::new(std::cell::Cell::new(0));
    let report = run(
        &c,
        &RunOptions {
            seed: 0,
            cases: 1,
            steps: 128,
            shrink_budget: 32,
        },
        || {
            Ok(ReplayFault {
                counter: 0,
                resets: resets.clone(),
            })
        },
    )
    .unwrap();
    assert_eq!(report.status, blabla::report::RunStatus::Red);
    assert!(report.metrics.decisions.last().unwrap().prefix.is_some());
    let failure = report.failure.unwrap();
    assert_eq!(failure.property, "bounded");
    assert_eq!(failure.minimal_sequence_length, 1);
}

#[test]
fn invariant_failure_during_corpus_reset_has_consistent_campaign_evidence() {
    struct ResetFault {
        counter: i64,
        resets: std::rc::Rc<std::cell::Cell<usize>>,
    }
    impl Application for ResetFault {
        fn reset(&mut self) -> Result<(), AppError> {
            self.resets.set(self.resets.get() + 1);
            self.counter = if self.resets.get() > 1 { 100 } else { 0 };
            Ok(())
        }
        fn call(&mut self, call: &Call) -> Result<(), AppError> {
            if call.action == "advance" {
                self.counter = (self.counter + 1).min(3);
            }
            Ok(())
        }
        fn observe(&mut self, _: &[Field]) -> Result<Value, AppError> {
            Ok(json!({"counter":self.counter}))
        }
    }
    let c = compile(
        "reset.bla",
        r#"
state counter: int
action advance()
action inspect()
when advance { expect "monotonic": after.counter >= before.counter }
when inspect { expect "rare": before.counter != 99 or after.counter == before.counter }
always "bounded" { counter <= 3 }
"#,
    )
    .unwrap();
    let resets = std::rc::Rc::new(std::cell::Cell::new(0));
    let report = run(
        &c,
        &RunOptions {
            seed: 0,
            cases: 1,
            steps: 128,
            shrink_budget: 32,
        },
        || {
            Ok(ResetFault {
                counter: 0,
                resets: resets.clone(),
            })
        },
    )
    .unwrap();
    assert_eq!(report.status, blabla::report::RunStatus::Red);
    assert_eq!(report.cases_executed, 1);
    assert!(report.coverage_summary.violated > 0);
    assert!(report.metrics.detection_ms.is_some());
    assert_eq!(report.failure.unwrap().property, "bounded");
}

#[test]
fn absent_binding_context_does_not_retain_disjunctive_numeric_atoms() {
    let source = "type Item {\n    id: string,\n    keeper: optional<string>,\n    charge: int\n}\nstate items: [Item]\naction mark(vault: string)\nwhen mark {\n    expect \"mark-invalid-noop\":\n        any(before.items, v => v.id == input.vault and v.keeper != null and (v.charge == 1 or v.charge == 3)) or after.items == before.items\n}\n";
    let contract = compile("coverage.bla", source).unwrap();
    let state = json!({"items": [
        {"id": "A", "keeper": "k", "charge": 1},
        {"id": "B", "keeper": null, "charge": 0},
        {"id": "C", "keeper": "k", "charge": 2}
    ]});
    let report = serde_json::to_value(
        run(
            &contract,
            &RunOptions {
                seed: 0,
                cases: 1,
                steps: 64,
                shrink_budget: 32,
            },
            || {
                Ok(FixedApp {
                    state: state.clone(),
                    break_on_call: false,
                })
            },
        )
        .unwrap(),
    )
    .unwrap();
    let unexercised: Vec<&Value> = report["coverage"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|obligation| obligation["status"] == "unexercised")
        .collect();
    assert!(unexercised.is_empty(), "{unexercised:?}");
    assert_eq!(report["status"], "green");
}

const LADDER: &str = r#"
state level: int
action climb()
action fall()
when climb { expect "summit-keeps-climbing": before.level < 6 or after.level == before.level + 1 }
when fall { expect "fall-resets": after.level == 0 }
"#;

const MARKS: &str = r#"
state marks: int
action mark()
when mark { expect "mark-counts": after.marks == before.marks + 1 }
"#;

const LOW: &str = r#"
state level: int
action climb()
always "level-stays-low" { level < 3 }
"#;

const UNREACHABLE: &str = r#"
state level: int
action climb()
when climb { expect "climbing-never-starts-below-zero": before.level >= 0 or after.level == 0 }
"#;

fn noise() -> String {
    std::iter::once("state noise: int\n".to_owned())
        .chain((1..=30).map(|n| {
            format!(
                "action n{n:02}()\nwhen n{n:02} {{ expect \"n{n:02}-keeps-noise\": after.noise == before.noise }}\n"
            )
        }))
        .collect()
}

#[derive(Default)]
struct Rooms {
    level: i64,
    marks: i64,
    noise: i64,
    leak: bool,
}

impl Application for Rooms {
    fn reset(&mut self) -> Result<(), AppError> {
        *self = Rooms {
            leak: self.leak,
            ..Rooms::default()
        };
        Ok(())
    }

    fn call(&mut self, call: &Call) -> Result<(), AppError> {
        match call.action.as_str() {
            "climb" => {
                self.level += 1;
                self.noise += i64::from(self.leak);
            }
            "fall" => self.level = 0,
            "mark" => self.marks += 1,
            _ => {}
        }
        Ok(())
    }

    fn observe(&mut self, _: &[Field]) -> Result<Value, AppError> {
        Ok(json!({"level": self.level, "marks": self.marks, "noise": self.noise}))
    }
}

fn campaign_of(name: &str, key: u64, source: &str) -> Campaign {
    Campaign {
        contracts: vec![name.to_owned()],
        key,
        contract: compile(&format!("{name}.bla"), source).unwrap(),
    }
}

fn grouped() -> RunOptions {
    RunOptions {
        seed: 0,
        cases: 2,
        steps: 128,
        shrink_budget: 32,
    }
}

fn rooms(
    campaigns: &[Campaign],
    leak: bool,
    options: &RunOptions,
) -> Result<RunReport, VerifyError> {
    run_campaigns(
        campaigns,
        options,
        2,
        || {
            Ok(Rooms {
                leak,
                ..Rooms::default()
            })
        },
        &mut |_| {},
    )
}

fn campaign_statuses(report: &RunReport) -> Vec<RunStatus> {
    report
        .campaigns
        .iter()
        .map(|campaign| campaign.status.clone())
        .collect()
}

fn contract_code(result: Result<RunReport, VerifyError>) -> String {
    match result {
        Err(VerifyError::Contract(diagnostic)) => diagnostic.code,
        other => panic!(
            "expected a contract error: {:?}",
            other.map(|report| report.status)
        ),
    }
}

#[test]
fn adding_a_smaller_unrelated_campaign_leaves_another_campaigns_result_unchanged() {
    let ladder = campaign_of("ladder", 1, LADDER);
    let alone = rooms(std::slice::from_ref(&ladder), false, &grouped()).unwrap();
    let crowded = rooms(&[ladder, campaign_of("marks", 2, MARKS)], false, &grouped()).unwrap();
    assert!(alone.campaigns[0].steps_executed < alone.campaigns[0].ceiling);
    assert!(crowded.campaigns[0].ceiling >= alone.campaigns[0].ceiling);
    let count = alone.coverage_summary.coverage.len();
    let facts = |report: &RunReport| {
        report
            .coverage_summary
            .coverage
            .iter()
            .take(count)
            .map(|obligation| {
                (
                    obligation.id.clone(),
                    obligation.status.clone(),
                    obligation.evaluations,
                    obligation.witnesses,
                    obligation.first_witness_action,
                    obligation.first_witness_trace.clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(facts(&crowded), facts(&alone));
    assert_eq!(alone.campaigns[0].seed, crowded.campaigns[0].seed);
    assert_eq!(alone.campaigns[0].seed, campaign_seed(0, 1));
    let summit: Vec<(CoverageStatus, usize)> = alone
        .coverage_summary
        .coverage
        .iter()
        .filter(|obligation| obligation.property == "summit-keeps-climbing")
        .map(|obligation| {
            (
                obligation.status.clone(),
                obligation.first_witness_trace.as_ref().map_or(0, Vec::len),
            )
        })
        .collect();
    let statuses: Vec<&CoverageStatus> = summit.iter().map(|(status, _)| status).collect();
    assert_eq!(statuses, vec![&CoverageStatus::Verified; summit.len()]);
    assert!(summit.iter().map(|(_, length)| *length).max() >= Some(7));
}

#[test]
fn each_campaign_runs_under_its_own_ceiling_with_a_seed_derived_from_its_contracts() {
    let options = grouped();
    let report = rooms(
        &[
            campaign_of("ladder", 1, LADDER),
            campaign_of("marks", 2, MARKS),
            campaign_of("noise", 3, &noise()),
        ],
        false,
        &options,
    )
    .unwrap();
    assert_eq!(report.seed, options.seed);
    assert_eq!(
        report.metrics.action_budget,
        report
            .campaigns
            .iter()
            .map(|campaign| campaign.ceiling)
            .sum::<usize>()
    );
    let seeds: Vec<u64> = report
        .campaigns
        .iter()
        .map(|campaign| campaign.seed)
        .collect();
    assert_eq!(seeds, [1, 2, 3].map(|key| campaign_seed(options.seed, key)));
    assert!(seeds[0] != seeds[1] && seeds[1] != seeds[2] && seeds[0] != seeds[2]);
    for campaign in &report.campaigns {
        assert_eq!(campaign.ceiling % options.steps, 0);
        assert!(campaign.ceiling >= options.steps);
        assert!(campaign.steps_executed <= campaign.ceiling);
        assert!(campaign.elapsed_ms <= report.metrics.elapsed_ms);
    }
    assert_eq!(
        report.steps_executed,
        report
            .campaigns
            .iter()
            .map(|campaign| campaign.steps_executed)
            .sum::<usize>()
    );
    assert_eq!(
        report.sequences.iter().map(Vec::len).sum::<usize>(),
        report.steps_executed
    );
}

#[test]
fn a_campaign_stops_once_it_has_run_twice_the_actions_full_coverage_took() {
    let options = RunOptions {
        seed: 0,
        cases: 4,
        steps: 256,
        shrink_budget: 32,
    };
    let report = rooms(
        &[
            campaign_of("ladder", 1, LADDER),
            campaign_of("marks", 2, MARKS),
            campaign_of("unreachable", 4, UNREACHABLE),
        ],
        false,
        &options,
    )
    .unwrap();
    for covered in &report.campaigns[..2] {
        let reached = covered.actions_to_full_coverage.unwrap();
        assert_eq!(covered.status, RunStatus::Green);
        assert_eq!(
            covered.steps_executed,
            (2 * reached).max(options.steps).min(covered.ceiling)
        );
    }
    assert_eq!(report.campaigns[1].actions_to_full_coverage, Some(1));
    assert_eq!(report.campaigns[1].steps_executed, options.steps);
    assert_eq!(report.campaigns[1].cases_executed, 1);
    let open = &report.campaigns[2];
    assert_eq!(open.actions_to_full_coverage, None);
    assert_eq!(open.steps_executed, open.ceiling);
    assert_eq!(open.cases_executed, open.ceiling / options.steps);
}

fn owned_obligations(campaign: &CampaignReport) -> usize {
    campaign.verified + campaign.unexercised + campaign.violated
}

fn ceilings(report: &RunReport) -> Vec<usize> {
    report
        .campaigns
        .iter()
        .map(|campaign| campaign.ceiling)
        .collect()
}

#[test]
fn a_campaign_ceiling_is_its_obligation_share_of_the_pool_and_never_below_one_case() {
    let options = RunOptions {
        seed: 0,
        cases: 2,
        steps: 32,
        shrink_budget: 32,
    };
    let report = rooms(
        &[
            campaign_of("noise", 2, &noise()),
            campaign_of("marks", 3, MARKS),
        ],
        false,
        &options,
    )
    .unwrap();
    let owned: Vec<usize> = report.campaigns.iter().map(owned_obligations).collect();
    let total: usize = owned.iter().sum();
    let pool = report.campaigns.len() * options.cases;
    let expected: Vec<usize> = owned
        .iter()
        .map(|&count| (pool * count).div_ceil(total).max(1) * options.steps)
        .collect();
    assert_eq!(ceilings(&report), expected);
    for (ceiling, count) in expected.iter().zip(&owned) {
        assert!(ceiling / options.steps * total >= pool * count);
    }
    assert!(expected[0] > expected[1]);
    assert_eq!(expected[1], options.steps);
    assert_eq!(report.campaigns[1].steps_executed, options.steps);
    assert_eq!(report.campaigns[1].cases_executed, 1);
    assert_eq!(report.metrics.action_budget, expected.iter().sum::<usize>());
}

#[test]
fn adding_an_unrelated_small_contract_keeps_a_big_groups_proportional_share() {
    let options = RunOptions {
        seed: 0,
        cases: 4,
        steps: 32,
        shrink_budget: 32,
    };
    let before = rooms(
        &[
            campaign_of("noise", 2, &noise()),
            campaign_of("ladder", 1, LADDER),
        ],
        false,
        &options,
    )
    .unwrap();
    let after = rooms(
        &[
            campaign_of("noise", 2, &noise()),
            campaign_of("ladder", 1, LADDER),
            campaign_of("marks", 3, MARKS),
        ],
        false,
        &options,
    )
    .unwrap();
    let (before, after) = (ceilings(&before), ceilings(&after));
    assert!(before[0] > before[1]);
    assert!(after[0] + after[2] >= before[0]);
    assert!(after[2] >= options.steps);
}

#[test]
fn a_shallow_contract_is_still_searched_for_one_full_case() {
    let report = rooms(&[campaign_of("low", 5, LOW)], false, &grouped()).unwrap();
    assert_eq!(report.status, RunStatus::Red);
    assert_eq!(
        report.failure.map(|failure| failure.property),
        Some("level-stays-low".to_owned())
    );
}

#[test]
fn a_yellow_campaign_makes_the_aggregate_yellow() {
    let report = rooms(
        &[
            campaign_of("marks", 2, MARKS),
            campaign_of("unreachable", 4, UNREACHABLE),
        ],
        false,
        &grouped(),
    )
    .unwrap();
    assert_eq!(report.status, RunStatus::Yellow);
    assert!(report.failure.is_none());
    assert!(report.coverage_summary.unexercised > 0);
    assert_eq!(report.coverage_summary.violated, 0);
    assert_eq!(
        campaign_statuses(&report),
        [RunStatus::Green, RunStatus::Yellow]
    );
}

#[test]
fn a_red_campaign_is_reported_while_every_other_campaign_still_runs() {
    let report = rooms(
        &[
            campaign_of("noise", 2, &noise()),
            campaign_of("low", 5, LOW),
            campaign_of("marks", 3, MARKS),
        ],
        false,
        &grouped(),
    )
    .unwrap();
    assert_eq!(report.status, RunStatus::Red);
    assert_eq!(
        campaign_statuses(&report),
        [RunStatus::Green, RunStatus::Red, RunStatus::Green]
    );
    assert!(report.campaigns[2].steps_executed > 0);
    let failure = report.failure.as_ref().unwrap();
    assert_eq!(failure.property, "level-stays-low");
    assert_eq!(
        report.sequences[failure.case_index],
        failure.original_sequence
    );
    assert_eq!(
        report.campaigns[1]
            .failure
            .as_ref()
            .map(|failure| failure.case_index),
        Some(failure.case_index)
    );
    assert!(report.coverage_summary.violated > 0);
}

#[test]
fn an_action_changing_another_campaigns_state_is_a_coupling_error() {
    let campaigns = [
        campaign_of("ladder", 1, LADDER),
        campaign_of("noise", 2, &noise()),
    ];
    assert_eq!(
        contract_code(rooms(&campaigns, true, &grouped())),
        "BLA-RUN-COUPLING"
    );
    assert!(rooms(&campaigns, false, &grouped()).is_ok());
}

#[test]
fn aggregated_coverage_lists_every_composed_obligation_once() {
    let composed = compile("composed.bla", &format!("{LADDER}{MARKS}")).unwrap();
    let single = run(
        &composed,
        &RunOptions {
            seed: 0,
            cases: 1,
            steps: 1,
            shrink_budget: 0,
        },
        || Ok(Rooms::default()),
    )
    .unwrap();
    let report = rooms(
        &[
            campaign_of("ladder", 1, LADDER),
            campaign_of("marks", 2, MARKS),
        ],
        false,
        &grouped(),
    )
    .unwrap();
    let ids = |report: &RunReport| {
        let mut ids: Vec<String> = report
            .coverage_summary
            .coverage
            .iter()
            .map(|obligation| obligation.id.clone())
            .collect();
        ids.sort();
        ids
    };
    assert_eq!(ids(&report), ids(&single));
    let summary = &report.coverage_summary;
    assert_eq!(
        summary.verified + summary.unexercised + summary.violated,
        summary.coverage.len()
    );
}

#[test]
fn progress_counts_actions_and_obligations_across_campaigns() {
    let options = grouped();
    let mut seen: Vec<Progress> = Vec::new();
    let report = run_campaigns(
        &[
            campaign_of("ladder", 1, LADDER),
            campaign_of("marks", 2, MARKS),
        ],
        &options,
        2,
        || Ok(Rooms::default()),
        &mut |progress| seen.push(*progress),
    )
    .unwrap();
    let total = report.coverage_summary.coverage.len();
    let budgets: Vec<(usize, usize)> = seen
        .iter()
        .map(|progress| (progress.action_budget, progress.total))
        .collect();
    assert_eq!(
        budgets,
        vec![(report.metrics.action_budget, total); seen.len()]
    );
    let executed: Vec<usize> = seen
        .iter()
        .map(|progress| progress.actions_executed)
        .collect();
    let mut ordered = executed.clone();
    ordered.sort_unstable();
    assert_eq!(executed, ordered);
    assert_eq!(executed.last(), Some(&report.steps_executed));
}

#[test]
fn a_campaign_without_actions_is_a_located_contract_error() {
    let mut idle = campaign_of("idle", 6, LOW);
    idle.contract.actions.clear();
    assert_eq!(
        contract_code(rooms(
            &[campaign_of("marks", 2, MARKS), idle],
            false,
            &grouped()
        )),
        "BLA-RUN-CONTRACT"
    );
}

const BOOM: &str = r#"
state booms: int
action boom()
when boom { expect "boom-counts": after.booms == before.booms + 1 }
"#;

const BLAST: &str = r#"
state blasts: int
action blast()
when blast { expect "blast-counts": after.blasts == before.blasts + 1 }
"#;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Hold {
    Never,
    UntilCrowded,
    UntilFailed,
}

#[derive(Default)]
struct Ledger {
    live: usize,
    peak: usize,
    calls: Vec<String>,
    failed: bool,
    crowded_at_failure: bool,
    held: bool,
}

#[derive(Default)]
struct Stage {
    ledger: Mutex<Ledger>,
    changed: Condvar,
}

impl Stage {
    fn actor(&self, hold: Hold) -> Actor<'_> {
        let mut ledger = self.ledger();
        ledger.live += 1;
        ledger.peak = ledger.peak.max(ledger.live);
        self.changed.notify_all();
        Actor {
            rooms: Rooms::default(),
            stage: self,
            hold,
        }
    }

    fn ledger(&self) -> MutexGuard<'_, Ledger> {
        self.ledger.lock().unwrap()
    }

    fn call(&self, action: &str, hold: Hold) -> Result<(), AppError> {
        let mut ledger = self.ledger();
        ledger.calls.push(action.to_owned());
        match action {
            "boom" => {
                if hold != Hold::Never {
                    ledger = self.wait_while(ledger, |ledger| ledger.live < 2);
                }
                ledger.failed = true;
                ledger.crowded_at_failure = ledger.live > 1;
                self.changed.notify_all();
                return Err(AppError::new("APP_BOOM", "the application failed"));
            }
            "blast" => return Err(AppError::new("APP_BLAST", "the application failed")),
            _ => {}
        }
        if hold != Hold::Never && !ledger.held {
            ledger.held = true;
            drop(self.wait_while(ledger, |ledger| match hold {
                Hold::UntilCrowded => ledger.peak < 2,
                Hold::UntilFailed => !ledger.failed,
                Hold::Never => false,
            }));
        }
        Ok(())
    }

    fn wait_while<'a>(
        &self,
        ledger: MutexGuard<'a, Ledger>,
        waiting: impl FnMut(&mut Ledger) -> bool,
    ) -> MutexGuard<'a, Ledger> {
        self.changed
            .wait_timeout_while(ledger, Duration::from_secs(5), waiting)
            .unwrap()
            .0
    }
}

struct Actor<'a> {
    rooms: Rooms,
    stage: &'a Stage,
    hold: Hold,
}

impl Application for Actor<'_> {
    fn reset(&mut self) -> Result<(), AppError> {
        self.rooms.reset()
    }

    fn call(&mut self, call: &Call) -> Result<(), AppError> {
        self.stage.call(&call.action, self.hold)?;
        self.rooms.call(call)
    }

    fn observe(&mut self, fields: &[Field]) -> Result<Value, AppError> {
        let mut state = self.rooms.observe(fields)?;
        state["booms"] = json!(0);
        state["blasts"] = json!(0);
        Ok(state)
    }
}

impl Drop for Actor<'_> {
    fn drop(&mut self) {
        self.stage.ledger().live -= 1;
    }
}

fn staged(
    campaigns: &[Campaign],
    jobs: usize,
    hold: Hold,
    stage: &Stage,
) -> Result<RunReport, VerifyError> {
    run_campaigns(
        campaigns,
        &grouped(),
        jobs,
        || Ok(stage.actor(hold)),
        &mut |_| {},
    )
}

fn untimed(report: &RunReport) -> Value {
    fn strip(value: &mut Value) {
        match value {
            Value::Object(map) => {
                map.retain(|key, _| !key.ends_with("_ms"));
                map.values_mut().for_each(strip);
            }
            Value::Array(items) => items.iter_mut().for_each(strip),
            _ => {}
        }
    }
    let mut value = serde_json::to_value(report).unwrap();
    strip(&mut value);
    value
}

#[test]
fn parallel_campaigns_report_exactly_what_a_serial_run_reports() {
    let campaigns = [
        campaign_of("ladder", 1, LADDER),
        campaign_of("marks", 2, MARKS),
        campaign_of("noise", 3, &noise()),
        campaign_of("low", 5, LOW),
        campaign_of("unreachable", 4, UNREACHABLE),
    ];
    let serial = staged(&campaigns, 1, Hold::Never, &Stage::default()).unwrap();
    let parallel = staged(&campaigns, 3, Hold::UntilCrowded, &Stage::default()).unwrap();
    assert_eq!(parallel.status, RunStatus::Red);
    assert_eq!(untimed(&parallel), untimed(&serial));
}

#[test]
fn no_more_campaigns_than_jobs_run_at_once() {
    let stage = Stage::default();
    staged(
        &[
            campaign_of("ladder", 1, LADDER),
            campaign_of("marks", 2, MARKS),
            campaign_of("noise", 3, &noise()),
        ],
        2,
        Hold::UntilCrowded,
        &stage,
    )
    .unwrap();
    assert_eq!(stage.ledger().peak, 2);
}

#[test]
fn a_failing_campaign_reports_the_lowest_failure_and_starts_nothing_after_it() {
    let campaigns = [
        campaign_of("ladder", 1, LADDER),
        campaign_of("boom", 7, BOOM),
        campaign_of("marks", 2, MARKS),
        campaign_of("blast", 8, BLAST),
    ];
    for (jobs, hold) in [
        (1, Hold::Never),
        (2, Hold::UntilFailed),
        (4, Hold::UntilFailed),
    ] {
        let stage = Stage::default();
        let code = match staged(&campaigns, jobs, hold, &stage) {
            Err(VerifyError::Application(failure)) => failure.code,
            other => panic!(
                "expected an application error under {jobs} jobs: {:?}",
                other.map(|report| report.status)
            ),
        };
        assert_eq!(code, "APP_BOOM", "{jobs} jobs");
        let ledger = stage.ledger();
        assert_eq!(ledger.crowded_at_failure, jobs > 1, "{jobs} jobs");
        if jobs < campaigns.len() {
            let later: Vec<&String> = ledger
                .calls
                .iter()
                .filter(|call| *call == "mark" || *call == "blast")
                .collect();
            assert!(later.is_empty(), "{jobs} jobs: {later:?}");
        }
    }
}
