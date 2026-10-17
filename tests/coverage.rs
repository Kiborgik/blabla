use blabla::application::Application;
use blabla::diagnostic::AppError;
use blabla::ir::Field;
use blabla::report::{Call, RunOptions};
use blabla::semantics::compile;
use blabla::verify::run;
use serde_json::{Value, json};

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
        p["required_witness"]
            .as_str()
            .unwrap()
            .contains("sealed is true")
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

#[allow(dead_code)]
mod composed_bridge {
    include!("../bridge/structure_adapter.rs");
    pub(super) use source_cli::Campaign;

    pub(super) struct App {
        campaign: Campaign,
        scenario: Scenario,
        assignment: assignment::Assignment,
        tone: voice::Tone,
        lifecycle: lifecycle::Lifecycle,
        goals: goals::Goals,
        decisions: decisions::Decisions,
        attestation: attestation::Attestation,
        questions: questions::Questions,
        expert: expert::Expert,
        task_roles: task_roles::TaskRoles,
        effort: development_effort::DevelopmentEffort,
        delivery: goal_delivery::GoalDelivery,
    }

    impl App {
        pub(super) fn new() -> Self {
            Self::with_campaign(Campaign::new())
        }

        pub(super) fn with_campaign(campaign: Campaign) -> Self {
            Self {
                scenario: Scenario::CollectionHit,
                assignment: assignment::Assignment::new(),
                tone: voice::Tone::new(),
                lifecycle: lifecycle::Lifecycle::new(),
                goals: goals::Goals::new(),
                decisions: decisions::Decisions::new(),
                attestation: attestation::Attestation::new(),
                questions: questions::Questions::new(),
                expert: expert::Expert::new(),
                task_roles: task_roles::TaskRoles::with_campaign(campaign.clone()),
                effort: development_effort::DevelopmentEffort::with_campaign(campaign.clone()),
                delivery: goal_delivery::GoalDelivery::with_campaign(campaign.clone()),
                campaign,
            }
        }
    }

    impl blabla::application::Application for App {
        fn reset(&mut self) -> Result<(), blabla::diagnostic::AppError> {
            self.lifecycle.reset();
            *self = Self::with_campaign(self.campaign.clone());
            Ok(())
        }

        fn call(
            &mut self,
            call: &blabla::report::Call,
        ) -> Result<(), blabla::diagnostic::AppError> {
            if let Some(result) = self.task_roles.call(&call.action, &json!(call.args)) {
                return result
                    .map_err(|error| blabla::diagnostic::AppError::new("E_ACTION", error));
            }
            if let Some(result) = self.effort.call(&call.action, &json!(call.args)) {
                return result
                    .map_err(|error| blabla::diagnostic::AppError::new("E_ACTION", error));
            }
            if let Some(result) = self.delivery.call(&call.action, &json!(call.args)) {
                return result
                    .map_err(|error| blabla::diagnostic::AppError::new("E_ACTION", error));
            }
            if let Some(scenario) = Scenario::from_action(&call.action) {
                self.scenario = scenario;
            } else if !(self.assignment.call(&call.action)
                || self.tone.call(&call.action)
                || self.lifecycle.call(&call.action)
                || self.goals.call(&call.action)
                || self.decisions.call(&call.action)
                || self.attestation.call(&call.action)
                || self.questions.call(&call.action)
                || self.expert.call(&call.action))
            {
                return Err(blabla::diagnostic::AppError::new(
                    "E_ACTION",
                    "unknown composed action",
                ));
            }
            Ok(())
        }

        fn observe(
            &mut self,
            _: &[blabla::ir::Field],
        ) -> Result<Value, blabla::diagnostic::AppError> {
            let mut state = observe(self.scenario);
            for extra in [
                self.assignment.observe(),
                self.tone.observe(&self.assignment.report()),
                self.lifecycle.observe(),
                self.goals.observe(),
                self.decisions.observe(),
                self.attestation.observe(),
                self.questions.observe(),
                self.expert.observe(),
                self.task_roles.observe(),
                self.effort.observe(),
                self.delivery.observe(),
            ] {
                state
                    .as_object_mut()
                    .unwrap()
                    .extend(extra.as_object().unwrap().clone());
            }
            Ok(state)
        }

        fn finish(&mut self) -> Result<(), blabla::diagnostic::AppError> {
            self.lifecycle.reset();
            Ok(())
        }
    }
}

#[test]
fn effort_composed_probe_uses_real_dispatch_and_preserves_legacy_state() {
    let mut app = composed_bridge::App::new();
    let initial = app.observe(&[]).unwrap();
    app.call(&Call {
        action: "positive_phase_fixture".into(),
        args: vec![],
    })
    .unwrap();
    assert_eq!(app.observe(&[]).unwrap()["eligible"], true);
    app.call(&Call {
        action: "switch_phase".into(),
        args: vec![],
    })
    .unwrap();
    let positive = app.observe(&[]).unwrap();
    assert_eq!(positive["succeeded"], true);
    assert_eq!(positive["phase_interval_count"], 1);
    for (key, value) in initial.as_object().unwrap() {
        if ![
            "phase_fixture_initialized",
            "eligible",
            "succeeded",
            "records_unchanged",
            "intervals_nonoverlapping",
            "freshness_preserved",
            "phase_exit",
            "phase_interval_count",
        ]
        .contains(&key.as_str())
        {
            assert_eq!(&positive[key], value, "{key}");
        }
    }
    app.call(&Call {
        action: "threshold_budget_fixture".into(),
        args: vec![],
    })
    .unwrap();
    assert_eq!(app.observe(&[]).unwrap()["budget_fixture_qualified"], true);
    app.call(&Call {
        action: "inspect_budget".into(),
        args: vec![],
    })
    .unwrap();
    let budget = app.observe(&[]).unwrap();
    assert_eq!(budget["budget"]["active_seconds"], 100);
    assert_eq!(budget["budget"]["overhead_seconds"], 20);
    assert_eq!(budget["budget"]["observed_target"], "within");
    app.call(&Call {
        action: "report_module_unreported".into(),
        args: vec![],
    })
    .unwrap();
    let changed = app.observe(&[]).unwrap();
    assert_eq!(changed["determinable"], false);
    for (key, value) in budget.as_object().unwrap() {
        if !["determinable", "verdicts"].contains(&key.as_str()) {
            assert_eq!(&changed[key], value, "{key}");
        }
    }
    app.reset().unwrap();
    assert_eq!(app.observe(&[]).unwrap(), initial);
    app.finish().unwrap();
}

fn reordered_composed_contract() -> blabla::ir::Contract {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let manifest = blabla::project::read_manifest(&root.join("project.bla")).unwrap();
    let profile = manifest.profile.as_ref().unwrap();
    assert_eq!(
        (
            profile.seed,
            profile.cases,
            profile.steps,
            profile.shrink_budget
        ),
        (0, 8, 512, 256)
    );
    let mut sources: Vec<_> = manifest
        .entries
        .iter()
        .filter(|entry| !entry.draft && entry.layer == blabla::project::Layer::Behavior)
        .map(|entry| {
            (
                entry.group.clone(),
                entry.display.clone(),
                std::fs::read_to_string(&entry.path).unwrap(),
            )
        })
        .collect();
    assert!(sources.iter().any(|(group, _, _)| group == "questions"));
    assert!(sources.iter().any(|(group, _, _)| group == "expert"));
    assert!(
        sources
            .iter()
            .any(|(group, _, _)| group == "task-role-resolution")
    );
    let unrelated = sources
        .iter()
        .position(|(group, _, _)| group == "goals")
        .unwrap();
    sources[unrelated].0 = "unrelated".into();
    sources.swap(0, unrelated);
    let parsed: Vec<_> = sources
        .iter()
        .map(|(_, file, source)| blabla::syntax::parse(file, source).unwrap())
        .collect();
    let units: Vec<_> = sources
        .iter()
        .zip(&parsed)
        .map(|((group, file, source), syntax)| blabla::semantics::Unit {
            file,
            source,
            group: Some(group),
            declarations: &syntax.declarations,
        })
        .collect();
    blabla::semantics::compile_units(&units).unwrap()
}

#[test]
fn reordered_composed_contract_preserves_targeted_witness() {
    let options = RunOptions {
        seed: 0,
        cases: 8,
        steps: 512,
        shrink_budget: 256,
    };
    let contract = reordered_composed_contract();
    let campaign = composed_bridge::Campaign::new();
    let report = run(&contract, &options, || {
        Ok(composed_bridge::App::with_campaign(campaign.clone()))
    })
    .unwrap();
    let missed: Vec<_> = report
        .coverage_summary
        .coverage
        .iter()
        .filter(|obligation| obligation.status != blabla::report::CoverageStatus::Verified)
        .map(|obligation| &obligation.id)
        .collect();
    eprintln!(
        "reordered=true status={:?} executed={} replayed={} resets={} full_coverage={:?} failure={:?}",
        report.status,
        report.metrics.total_actions,
        report.metrics.replay_actions,
        report.metrics.resets,
        report.metrics.actions_to_full_coverage,
        report.failure.as_ref().map(|failure| &failure.property)
    );
    assert!(
        missed.is_empty(),
        "reordered=true: {} missed, first {:?}",
        missed.len(),
        missed.iter().take(8).collect::<Vec<_>>()
    );
    for id in [
        "assignment::an-unapproved-outside-model-may-not-address-findings/root.left.effect",
        "assignment::a-failing-check-is-visible-at-hand-back/root.right.member",
    ] {
        let witness = report
            .coverage_summary
            .coverage
            .iter()
            .find(|obligation| obligation.id == id)
            .unwrap();
        assert!(witness.witnesses > 0, "{id}");
        assert!(
            witness
                .first_witness_trace
                .as_ref()
                .is_some_and(|trace| trace.len() > 1),
            "{id}"
        );
    }
    assert_eq!(report.status, blabla::report::RunStatus::Green);
    assert_eq!(report.metrics.action_budget, 4096);
    assert_eq!(report.metrics.total_actions, 4096);
    assert!(report.metrics.replay_actions > 0);
}

#[test]
fn goal_delivery_composed_probe() {
    let mut app = composed_bridge::App::new();
    let initial = app.observe(&[]).unwrap();
    assert_eq!(initial["delivery_fixture_initialized"], false);
    for _ in 0..8 {
        app.reset().unwrap();
        assert_eq!(app.observe(&[]).unwrap(), initial);
    }
    app.call(&Call {
        action: "delivery_fixture".into(),
        args: vec![json!(1)],
    })
    .unwrap();
    assert_eq!(app.observe(&[]).unwrap()["delivery_claim_eligible"], true);
    app.call(&Call {
        action: "record_delivery_claim".into(),
        args: vec![],
    })
    .unwrap();
    let claimed = app.observe(&[]).unwrap();
    assert_eq!(claimed["delivery_operation_succeeded"], true);
    for (key, value) in initial.as_object().unwrap() {
        if !key.starts_with("delivery_") {
            assert_eq!(&claimed[key], value, "{key}");
        }
    }
    app.call(&Call {
        action: "threshold_budget_fixture".into(),
        args: vec![],
    })
    .unwrap();
    app.call(&Call {
        action: "inspect_budget".into(),
        args: vec![],
    })
    .unwrap();
    app.call(&Call {
        action: "report_module_unreported".into(),
        args: vec![],
    })
    .unwrap();
    let independent = app.observe(&[]).unwrap();
    assert_eq!(independent["budget_fixture_qualified"], true);
    assert_eq!(independent["determinable"], false);
    for (key, value) in claimed.as_object().unwrap() {
        if key.starts_with("delivery_") {
            assert_eq!(&independent[key], value, "{key}");
        }
    }
    app.call(&Call {
        action: "delivery_fixture".into(),
        args: vec![json!(3)],
    })
    .unwrap();
    app.call(&Call {
        action: "record_delivery_claim".into(),
        args: vec![],
    })
    .unwrap();
    let refused = app.observe(&[]).unwrap();
    assert_eq!(refused["delivery_operation_succeeded"], false);
    assert_eq!(refused["delivery_records_unchanged"], true);
    for (key, value) in independent.as_object().unwrap() {
        if !key.starts_with("delivery_") {
            assert_eq!(&refused[key], value, "{key}");
        }
    }
    let error = app
        .call(&Call {
            action: "delivery_fixture".into(),
            args: vec![json!("invalid")],
        })
        .unwrap_err();
    assert_eq!(error.code, "E_ACTION");
    assert!(!error.message.contains("unknown composed action"));
    assert_eq!(app.observe(&[]).unwrap(), refused);
    app.reset().unwrap();
    assert_eq!(app.observe(&[]).unwrap(), initial);
}

#[test]
fn batched_delivery_composed_probe() {
    let mut app = composed_bridge::App::new();
    let initial = app.observe(&[]).unwrap();
    assert_eq!(initial["delivery_batch_initialized"], false);
    assert_eq!(initial["delivery_fixture_initialized"], false);
    for _ in 0..8 {
        app.reset().unwrap();
        assert_eq!(app.observe(&[]).unwrap(), initial);
    }
    let invoke = |app: &mut composed_bridge::App, action: &str, args: Vec<Value>| {
        app.call(&Call {
            action: action.into(),
            args,
        })
        .unwrap();
    };
    invoke(&mut app, "delivery_fixture", vec![json!(1)]);
    let legacy = app.observe(&[]).unwrap()["delivery_task"].clone();
    invoke(&mut app, "delivery_batch_fixture", vec![json!(0)]);
    let before = app.observe(&[]).unwrap();
    assert_eq!(before["delivery_selected_source_assigned"], true);
    assert_eq!(before["delivery_selected_source_current"], true);
    assert_eq!(before["delivery_selected_review_eligible"], true);
    assert_eq!(before["delivery_task"], legacy);
    invoke(&mut app, "review_explicit_delivery_source", vec![]);
    let reviewed = app.observe(&[]).unwrap();
    assert_eq!(reviewed["delivery_operation_succeeded"], true);
    assert_eq!(reviewed["delivery_selected_verdict_recorded"], true);
    assert_eq!(reviewed["delivery_other_source_verdicts_preserved"], true);
    assert_eq!(reviewed["delivery_source_records_unchanged"], true);
    assert_eq!(reviewed["delivery_task"], legacy);
    assert_eq!(
        reviewed["delivery_batch_review"]["task"]["delivery_reviews"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    for (key, value) in initial.as_object().unwrap() {
        if !key.starts_with("delivery_") {
            assert_eq!(&reviewed[key], value, "{key}");
        }
    }
    invoke(&mut app, "threshold_budget_fixture", vec![]);
    invoke(&mut app, "inspect_budget", vec![]);
    invoke(&mut app, "report_module_unreported", vec![]);
    let independent = app.observe(&[]).unwrap();
    assert_eq!(independent["budget_fixture_qualified"], true);
    assert_eq!(independent["determinable"], false);
    for (key, value) in reviewed.as_object().unwrap() {
        if key.starts_with("delivery_") {
            assert_eq!(&independent[key], value, "{key}");
        }
    }
    invoke(&mut app, "delivery_batch_fixture", vec![json!(2)]);
    assert_eq!(
        app.observe(&[]).unwrap()["delivery_selected_source_assigned"],
        false
    );
    invoke(&mut app, "review_explicit_delivery_source", vec![]);
    let refused = app.observe(&[]).unwrap();
    assert_eq!(refused["delivery_operation_succeeded"], false);
    assert_eq!(refused["delivery_exit"], 2);
    assert_eq!(refused["delivery_records_unchanged"], true);
    assert_eq!(refused["delivery_other_source_verdicts_preserved"], true);
    assert_eq!(refused["delivery_source_records_unchanged"], true);
    assert_eq!(refused["delivery_task"], legacy);
    for (key, value) in independent.as_object().unwrap() {
        if !key.starts_with("delivery_") {
            assert_eq!(&refused[key], value, "{key}");
        }
    }
    let batch = refused["delivery_batch_review"].clone();
    invoke(&mut app, "record_delivery_claim", vec![]);
    assert_eq!(
        app.observe(&[]).unwrap()["delivery_operation_succeeded"],
        true
    );
    assert_eq!(app.observe(&[]).unwrap()["delivery_batch_review"], batch);
    let stable = app.observe(&[]).unwrap();
    let error = app
        .call(&Call {
            action: "delivery_batch_fixture".into(),
            args: vec![json!("invalid")],
        })
        .unwrap_err();
    assert_eq!(error.code, "E_ACTION");
    assert!(!error.message.contains("unknown composed action"));
    assert_eq!(app.observe(&[]).unwrap(), stable);
    app.reset().unwrap();
    assert_eq!(app.observe(&[]).unwrap(), initial);
}
