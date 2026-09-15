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
