#[path = "../bridge/source_cli.rs"]
mod source_cli;
use serde_json::{Value, json};
#[path = "../bridge/goal_delivery.rs"]
mod goal_delivery;

fn call(probe: &mut goal_delivery::GoalDelivery, name: &str, args: Value) {
    probe
        .call(name, &args)
        .expect("actual delivery action must be bound")
        .unwrap();
}

#[test]
fn accepted_assignment_and_partial_claim_use_the_actual_cli() {
    let _guard = serial();
    let mut probe = goal_delivery::GoalDelivery::new();
    assert_eq!(probe.observe()["delivery_fixture_initialized"], false);
    call(&mut probe, "delivery_fixture", json!([0]));
    assert_eq!(probe.observe()["delivery_accept_eligible"], true);
    call(&mut probe, "accept_delivery_assignment", json!([]));
    assert_eq!(probe.observe()["delivery_applicable_goals_retained"], true);
    call(&mut probe, "delivery_fixture", json!([1]));
    call(&mut probe, "record_delivery_claim", json!([]));
    assert_eq!(probe.observe()["delivery_operation_succeeded"], true);
    assert_eq!(probe.observe()["delivery_partial_or_blocked"], true);
    probe.reset();
    assert_eq!(probe.observe()["delivery_fixture_initialized"], false);
}

fn serial() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|p| p.into_inner())
}

#[test]
fn qualified_positive_and_refused_operations_preserve_actual_records() {
    let _guard = serial();
    for (kind, action, args, eligibility, positive) in [
        (0, "accept_delivery_assignment", json!([]), "accept", true),
        (2, "accept_delivery_assignment", json!([]), "accept", false),
        (1, "record_delivery_claim", json!([]), "claim", true),
        (3, "record_delivery_claim", json!([]), "claim", false),
        (11, "record_delivery_claim", json!([]), "claim", false),
        (4, "ready_delivery_task", json!([]), "ready", true),
        (1, "ready_delivery_task", json!([]), "ready", false),
        (5, "record_delivery_review", json!([]), "review", true),
        (12, "record_delivery_review", json!([]), "review", false),
        (
            5,
            "close_delivery_task",
            json!([false]),
            "ordinary_close",
            false,
        ),
        (
            5,
            "close_delivery_task",
            json!([true]),
            "bounded_close",
            false,
        ),
        (
            6,
            "close_delivery_task",
            json!([false]),
            "ordinary_close",
            true,
        ),
        (
            6,
            "close_delivery_task",
            json!([true]),
            "bounded_close",
            false,
        ),
        (
            7,
            "close_delivery_task",
            json!([true]),
            "bounded_close",
            true,
        ),
        (
            7,
            "close_delivery_task",
            json!([false]),
            "ordinary_close",
            false,
        ),
        (
            13,
            "close_delivery_task",
            json!([false]),
            "ordinary_close",
            false,
        ),
        (
            14,
            "close_delivery_task",
            json!([false]),
            "ordinary_close",
            true,
        ),
        (8, "resolve_delivery_origin", json!([]), "resolution", true),
        (9, "resolve_delivery_origin", json!([]), "resolution", false),
        (
            10,
            "resolve_delivery_origin",
            json!([]),
            "resolution",
            false,
        ),
    ] {
        let mut probe = goal_delivery::GoalDelivery::new();
        call(&mut probe, "delivery_fixture", json!([kind]));
        let before = probe.observe();
        assert_eq!(
            before[format!("delivery_{eligibility}_eligible")],
            positive,
            "kind{kind}: {before}"
        );
        call(&mut probe, action, args.clone());
        let after = probe.observe();
        assert_eq!(
            after["delivery_operation_succeeded"], positive,
            "kind{kind}: {after}"
        );
        assert_eq!(after["delivery_exit"], if positive { 0 } else { 2 });
        assert_ne!(
            evaluate_pair(action, &args, &before, &after),
            blabla::report::RunStatus::Red,
            "real pair kind{kind}"
        );
        let mut mutation = after.clone();
        mutation[if action == "close_delivery_task" && positive {
            "delivery_source_closed"
        } else if action == "ready_delivery_task" && positive {
            "delivery_current_claims_complete"
        } else if action == "resolve_delivery_origin" && positive {
            "delivery_exact_origin_resolved"
        } else {
            "delivery_operation_succeeded"
        }] = json!(!positive);
        assert_eq!(
            evaluate_pair(action, &args, &before, &mutation),
            blabla::report::RunStatus::Red,
            "adversarial result kind{kind}"
        );
        if !positive {
            let mut changed = after.clone();
            changed["delivery_records_unchanged"] = json!(false);
            assert_eq!(
                evaluate_pair(action, &args, &before, &changed),
                blabla::report::RunStatus::Red
            );
        }

        for key in [
            "contract_authority_preserved",
            "history_preserved",
            "other_origins_preserved",
            "views_agree",
        ] {
            assert_eq!(
                after[format!("delivery_{key}")],
                true,
                "kind{kind}/{key}: {after}"
            );
        }
        if !positive {
            assert_eq!(after["delivery_records_unchanged"], true);
        }
        if matches!(action, "close_delivery_task" | "resolve_delivery_origin") {
            let mut changed = after.clone();
            changed["delivery_contract_authority_preserved"] = json!(false);
            assert_eq!(
                evaluate_pair(action, &args, &before, &changed),
                blabla::report::RunStatus::Red
            );
        }
        if positive && action == "close_delivery_task" {
            let mut lost = after.clone();
            lost["delivery_residual_visible"] = json!(false);
            assert_eq!(
                evaluate_pair(action, &args, &before, &lost),
                blabla::report::RunStatus::Red
            );
        }
        if positive && action == "resolve_delivery_origin" {
            for field in [
                "delivery_other_origins_preserved",
                "delivery_history_preserved",
            ] {
                let mut lost = after.clone();
                lost[field] = json!(false);
                assert_eq!(
                    evaluate_pair(action, &args, &before, &lost),
                    blabla::report::RunStatus::Red
                );
            }
        }

        if positive && action == "close_delivery_task" {
            assert_eq!(after["delivery_source_closed"], true);
            assert_eq!(after["delivery_residual_expected"], true);
            assert_eq!(after["delivery_residual_visible"], true);
        }
        if positive && action == "resolve_delivery_origin" {
            assert_eq!(after["delivery_exact_origin_resolved"], true);
            assert_eq!(after["delivery_residual_expected"], false);
            assert!(
                after["delivery_project"]["delivery"]["residuals"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|r| r["origin_task"] == "other")
            );
            call(&mut probe, action, args);
            assert_eq!(probe.observe()["delivery_operation_succeeded"], false);
            assert_eq!(probe.observe()["delivery_records_unchanged"], true);
        }
        let before_inspect = probe.observe();
        call(&mut probe, "inspect_delivery_reminders", json!([]));
        let inspected = probe.observe();
        assert_ne!(
            evaluate_pair(
                "inspect_delivery_reminders",
                &json!([]),
                &before_inspect,
                &inspected
            ),
            blabla::report::RunStatus::Red
        );
        for field in ["delivery_records_unchanged", "delivery_views_agree"] {
            let mut changed = inspected.clone();
            changed[field] = json!(false);
            assert_eq!(
                evaluate_pair(
                    "inspect_delivery_reminders",
                    &json!([]),
                    &before_inspect,
                    &changed
                ),
                blabla::report::RunStatus::Red
            );
        }
        assert_eq!(probe.observe()["delivery_records_unchanged"], true);
        assert_eq!(probe.observe()["delivery_operation_succeeded"], false);
        assert_eq!(probe.observe()["delivery_exit"], Value::Null);
        eprintln!(
            "fixture{kind} {action}: setup={}ms action={}ms",
            before["delivery_request_millis"], after["delivery_request_millis"]
        );
    }
}

#[test]
fn resets_hostile_selectors_and_two_instances_are_isolated() {
    let _guard = serial();
    let mut a = goal_delivery::GoalDelivery::new();
    let mut b = goal_delivery::GoalDelivery::new();
    let empty = a.observe();
    let start = std::time::Instant::now();
    for _ in 0..152 {
        a.reset();
        assert_eq!(a.observe(), empty);
    }
    eprintln!("152 unused reset/observe pairs: {:?}", start.elapsed());
    call(&mut a, "delivery_fixture", json!([i64::MIN]));
    assert_eq!(b.observe(), empty);
    let stable = a.observe();
    call(&mut b, "delivery_fixture", json!([i64::MAX]));
    assert_eq!(a.observe(), stable);
    for args in [
        json!(null),
        json!([]),
        json!([1, 2]),
        json!(["1"]),
        json!([u64::MAX]),
    ] {
        assert!(a.call("delivery_fixture", &args).unwrap().is_err());
        assert_eq!(a.observe(), stable);
    }
    assert!(a.call("close_delivery_task", &json!([0])).unwrap().is_err());
    assert!(
        a.call("record_delivery_claim", &json!([false]))
            .unwrap()
            .is_err()
    );
    assert!(a.call("unknown", &json!([])).is_none());
    assert_eq!(a.observe(), stable);
    b.reset();
    assert_eq!(b.observe(), empty);
    assert_eq!(a.observe(), stable);
}

#[derive(Clone)]
struct ObservedPair {
    before: Value,
    after: Value,
    called: bool,
}
impl blabla::application::Application for ObservedPair {
    fn reset(&mut self) -> Result<(), blabla::diagnostic::AppError> {
        self.called = false;
        Ok(())
    }
    fn call(&mut self, _: &blabla::report::Call) -> Result<(), blabla::diagnostic::AppError> {
        self.called = true;
        Ok(())
    }
    fn observe(&mut self, _: &[blabla::ir::Field]) -> Result<Value, blabla::diagnostic::AppError> {
        Ok(if self.called {
            self.after.clone()
        } else {
            self.before.clone()
        })
    }
}
fn evaluate_pair(
    action: &str,
    args: &Value,
    before: &Value,
    after: &Value,
) -> blabla::report::RunStatus {
    let source = std::fs::read_to_string(format!(
        "{}/contracts/goal-delivery.bla",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    let source = if action == "close_delivery_task" {
        source
            .replace(
                "input.bounded",
                if args[0] == true { "true" } else { "false" },
            )
            .replace(
                "close_delivery_task(bounded: bool)",
                "close_delivery_task()",
            )
    } else {
        source
    };
    let mut contract = blabla::semantics::compile("goal-delivery.bla", &source).unwrap();
    contract.actions.retain(|a| a.name == action);
    assert_eq!(contract.actions.len(), 1);
    blabla::verify::run(
        &contract,
        &blabla::report::RunOptions {
            seed: 0,
            cases: 1,
            steps: 1,
            shrink_budget: 0,
        },
        || {
            Ok(ObservedPair {
                before: before.clone(),
                after: after.clone(),
                called: false,
            })
        },
    )
    .unwrap()
    .status
}

#[test]
fn first_use_is_real_and_unused_inspection_is_allocation_free() {
    let _guard = serial();
    for (action, args, success) in [
        ("record_delivery_claim", json!([]), true),
        ("close_delivery_task", json!([false]), false),
        ("record_delivery_review", json!([]), false),
    ] {
        let mut probe = goal_delivery::GoalDelivery::new();
        let empty = probe.observe();
        call(&mut probe, "inspect_delivery_reminders", json!([]));
        assert_eq!(probe.observe(), empty);
        call(&mut probe, action, args);
        assert_eq!(probe.observe()["delivery_fixture_initialized"], true);
        assert_eq!(probe.observe()["delivery_operation_succeeded"], success);
        assert_eq!(probe.observe()["delivery_records_unchanged"], false);
    }
}
