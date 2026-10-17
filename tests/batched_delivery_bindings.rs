use serde_json::{Value, json};
use std::io::Write;
#[path = "../bridge/goal_delivery.rs"]
mod goal_delivery;

fn call(probe: &mut goal_delivery::GoalDelivery, name: &str, args: Value) {
    probe
        .call(name, &args)
        .expect("prospective batch action must be bound")
        .unwrap();
}
fn serial() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|p| p.into_inner())
}

#[test]
fn actual_assigned_sources_record_distinct_verdicts_and_refusals_preserve_bytes() {
    let _guard = serial();
    for kind in 0..8 {
        let mut probe = goal_delivery::GoalDelivery::new();
        call(&mut probe, "delivery_batch_fixture", json!([kind]));
        let before = probe.observe();
        assert_eq!(before["delivery_batch_initialized"], true);
        let positive = kind < 2;
        assert_eq!(
            before["delivery_selected_review_eligible"], positive,
            "{kind}: {before}"
        );
        assert_eq!(
            before["delivery_batch_review"]["task"]["review_of"]["task"],
            "work"
        );
        assert_eq!(
            before["delivery_batch_review"]["task"]["delivery_review_targets"][0]["task"],
            "secondary"
        );
        if kind == 4 {
            assert_eq!(
                before["delivery_batch_review"]["review_current"], true,
                "artifact-only drift must leave target revision current"
            );
            assert_eq!(
                before["delivery_batch_selected_task"]["delivery"]["claims_current"],
                false
            );
        }
        if positive {
            assert_eq!(before["delivery_batch_review"]["task"]["state"], "accepted");
            assert_eq!(
                before["delivery_batch_review"]["task"]["accepted"]["model"],
                "reviewer"
            );
            assert_eq!(
                before["delivery_batch_selected_task"]["delivery"]["claims_current"],
                true
            );
            assert_eq!(before["delivery_selected_source_assigned"], true);
            assert_eq!(before["delivery_selected_source_current"], true);
        }
        call(&mut probe, "review_explicit_delivery_source", json!([]));
        let after = probe.observe();
        assert_eq!(
            after["delivery_operation_succeeded"], positive,
            "{kind}: {after}"
        );
        assert_eq!(after["delivery_exit"], if positive { 0 } else { 2 });
        assert_eq!(after["delivery_other_source_verdicts_preserved"], true);
        assert_eq!(after["delivery_source_records_unchanged"], true);
        if positive {
            assert_eq!(after["delivery_selected_verdict_recorded"], true);
            let verdicts = after["delivery_batch_review"]["task"]["delivery_reviews"]
                .as_array()
                .unwrap();
            assert_eq!(verdicts.len(), 2);
            assert!(verdicts.iter().any(|v| v["source_task"] == "work"));
            assert!(verdicts.iter().any(|v| v["source_task"] == "secondary"));
            call(&mut probe, "review_explicit_delivery_source", json!([]));
            assert_eq!(probe.observe()["delivery_operation_succeeded"], true);
            assert_eq!(
                probe.observe()["delivery_batch_review"]["task"]["delivery_reviews"]
                    .as_array()
                    .unwrap()
                    .len(),
                2
            );
        } else {
            assert_eq!(after["delivery_records_unchanged"], true);
        }
        assert_ne!(evaluate(&before, &after), blabla::report::RunStatus::Red);
        for field in if positive {
            vec![
                "delivery_operation_succeeded",
                "delivery_selected_verdict_recorded",
                "delivery_other_source_verdicts_preserved",
                "delivery_source_records_unchanged",
            ]
        } else {
            vec![
                "delivery_records_unchanged",
                "delivery_other_source_verdicts_preserved",
                "delivery_source_records_unchanged",
            ]
        } {
            let mut bad = after.clone();
            bad[field] = json!(false);
            assert_eq!(
                evaluate(&before, &bad),
                blabla::report::RunStatus::Red,
                "{kind}/{field}"
            );
        }
        if !positive {
            let mut bad = after.clone();
            bad["delivery_operation_succeeded"] = json!(true);
            assert_eq!(evaluate(&before, &bad), blabla::report::RunStatus::Red);
        }
        writeln!(
            std::io::stderr(),
            "batch{kind}: setup={}ms action={}ms",
            before["delivery_request_millis"],
            after["delivery_request_millis"]
        )
        .unwrap();
    }
}

#[test]
fn batch_and_legacy_fixtures_remain_isolated_in_both_directions() {
    let _guard = serial();
    let mut probe = goal_delivery::GoalDelivery::new();
    call(&mut probe, "delivery_fixture", json!([1]));
    let legacy = probe.observe()["delivery_task"].clone();
    call(&mut probe, "delivery_batch_fixture", json!([0]));
    assert_eq!(probe.observe()["delivery_task"], legacy);
    call(&mut probe, "review_explicit_delivery_source", json!([]));
    assert_eq!(probe.observe()["delivery_task"], legacy);
    let batch = probe.observe()["delivery_batch_review"].clone();
    call(&mut probe, "record_delivery_claim", json!([]));
    assert_eq!(probe.observe()["delivery_operation_succeeded"], true);
    assert_eq!(probe.observe()["delivery_batch_review"], batch);
    call(&mut probe, "inspect_delivery_reminders", json!([]));
    assert_eq!(probe.observe()["delivery_batch_review"], batch);
    call(&mut probe, "delivery_fixture", json!([0]));
    assert_eq!(probe.observe()["delivery_batch_review"], batch);
}

#[test]
fn lazy_reset_hostile_arguments_and_two_instances_have_bounded_real_behavior() {
    let _guard = serial();
    let mut a = goal_delivery::GoalDelivery::new();
    let mut b = goal_delivery::GoalDelivery::new();
    let empty = a.observe();
    assert_eq!(empty["delivery_batch_initialized"], false);
    let start = std::time::Instant::now();
    for _ in 0..152 {
        a.reset();
        assert_eq!(a.observe(), empty);
    }
    writeln!(
        std::io::stderr(),
        "152 untouched resets: {:?}",
        start.elapsed()
    )
    .unwrap();
    for args in [
        json!(null),
        json!([]),
        json!([1, 2]),
        json!(["0"]),
        json!([u64::MAX]),
    ] {
        assert!(a.call("delivery_batch_fixture", &args).unwrap().is_err());
        assert_eq!(a.observe(), empty);
    }
    assert!(
        a.call("review_explicit_delivery_source", &json!([1]))
            .unwrap()
            .is_err()
    );
    assert!(a.call("unknown", &json!([])).is_none());
    call(&mut a, "delivery_batch_fixture", json!([i64::MIN]));
    let stable = a.observe();
    assert_eq!(b.observe(), empty);
    call(&mut b, "delivery_batch_fixture", json!([i64::MAX]));
    assert_eq!(a.observe(), stable);
    b.reset();
    assert_eq!(b.observe(), empty);
    call(&mut b, "review_explicit_delivery_source", json!([]));
    assert_eq!(b.observe()["delivery_batch_initialized"], true);
    assert_eq!(b.observe()["delivery_operation_succeeded"], true);
    assert_eq!(b.observe()["delivery_records_unchanged"], false);
    assert_eq!(a.observe(), stable);
}

#[derive(Clone)]
struct Pair {
    before: Value,
    after: Value,
    called: bool,
}
impl blabla::application::Application for Pair {
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
fn evaluate(before: &Value, after: &Value) -> blabla::report::RunStatus {
    let source = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/contracts/goal-delivery.bla"
    ))
    .unwrap();
    let mut contract = blabla::semantics::compile("goal-delivery.bla", &source).unwrap();
    contract
        .actions
        .retain(|a| a.name == "review_explicit_delivery_source");
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
            Ok(Pair {
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
fn batch_setup_contains_only_its_real_sources_and_assigned_review() {
    let _guard = serial();
    let mut probe = goal_delivery::GoalDelivery::new();
    call(&mut probe, "delivery_batch_fixture", json!([0]));
    assert_eq!(
        probe.observe()["delivery_batch_task_names"],
        json!(["batch", "secondary", "work"])
    );
    assert_eq!(probe.observe()["delivery_selected_review_eligible"], true);
}
