use super::*;
use crate::semantics::compile;
use serde_json::json;

const CONTRACT: &str = r#"
type Item { id: string, owner: optional<string>, charge: int, phase: int, locked: bool }
state items: [Item]
action lock(item: string, owner: string)
when lock {
expect "invalid": any(before.items, i => i.id == input.item and i.owner != null and i.owner == input.owner and i.phase == 1 and i.charge == 5 and not i.locked) or after.items == before.items
}
"#;

fn record(coverage: &mut Coverage, action: &str, before: &Value, input: &Value) {
    coverage.record(CoverageEvent {
        action: Some(action),
        before,
        input,
        after: before,
        sequence: &[Call {
            action: action.into(),
            args: vec![],
        }],
        action_index: 1,
        elapsed_ms: 0,
        failed: None,
    });
}

#[test]
fn matching_owner_does_not_cover_wrong_owner() {
    let c = compile("owner.bla", CONTRACT).unwrap();
    let mut coverage = Coverage::new(&c);
    record(
        &mut coverage,
        "lock",
        &json!({"items":[{"id":"A","owner":"O","charge":5,"phase":1,"locked":false}]}),
        &json!({"item":"A","owner":"O"}),
    );
    let mismatch = coverage
        .reports
        .iter()
        .find(|r| {
            r.required_witness
                .contains("not(($ 3.owner == input.owner))")
        })
        .unwrap();
    assert_eq!(mismatch.witnesses, 0);
    assert!(!coverage.complete());
}

#[test]
fn owner_mismatch_needs_otherwise_eligible_entity() {
    let c = compile("owner.bla", CONTRACT).unwrap();
    let mut coverage = Coverage::new(&c);
    let input = json!({"item":"A","owner":"WRONG"});
    record(
        &mut coverage,
        "lock",
        &json!({"items":[{"id":"A","owner":"O","charge":0,"phase":0,"locked":false}]}),
        &input,
    );
    let find = |coverage: &Coverage| {
        coverage
            .reports
            .iter()
            .find(|r| {
                r.required_witness
                    .contains("not(($ 3.owner == input.owner))")
            })
            .unwrap()
            .witnesses
    };
    assert_eq!(find(&coverage), 0);
    record(
        &mut coverage,
        "lock",
        &json!({"items":[{"id":"A","owner":"O","charge":5,"phase":1,"locked":false}]}),
        &input,
    );
    assert_eq!(find(&coverage), 1);
}

#[test]
fn absent_owner_does_not_require_impossible_bound_state_fields() {
    let c = compile("owner.bla", CONTRACT).unwrap();
    let mut coverage = Coverage::new(&c);
    record(
        &mut coverage,
        "lock",
        &json!({"items":[{"id":"A","owner":null,"charge":0,"phase":0,"locked":false}]}),
        &json!({"item":"A","owner":"O"}),
    );
    let absent = coverage
        .reports
        .iter()
        .find(|r| r.required_witness.contains("not(($ 3.owner != null))"))
        .unwrap();
    assert_eq!(absent.witnesses, 1, "{}", absent.required_witness);
}

#[test]
fn missing_nested_identifier_is_bound_in_its_own_query() {
    let c=compile("nested.bla",r#"
type Item { id: string, owner: string }
state items: [Item]
action move(source: string, target: string)
when move { expect "invalid": any(before.items, a => a.id == input.source and any(before.items, b => b.id == input.target)) or after.items == before.items }
"#).unwrap();
    let mut coverage = Coverage::new(&c);
    record(
        &mut coverage,
        "move",
        &json!({"items":[{"id":"A","owner":"O"}]}),
        &json!({"source":"A","target":"missing"}),
    );
    let missing = coverage
        .reports
        .iter()
        .find(|r| {
            r.id.contains("invalid.")
                && r.required_witness.starts_with("invalid operation")
                && r.required_witness.contains("not(Any(before.items, $ 4")
        })
        .unwrap();
    assert_eq!(missing.witnesses, 1);
}

#[test]
fn obligation_identity_is_independent_of_source_filename_and_execution_order() {
    let first = Coverage::new(&compile("one.bla", CONTRACT).unwrap());
    let second = Coverage::new(&compile("another/location.bla", CONTRACT).unwrap());
    assert_eq!(
        first.reports.iter().map(|r| &r.id).collect::<Vec<_>>(),
        second.reports.iter().map(|r| &r.id).collect::<Vec<_>>()
    );
}

#[test]
fn locked_unrelated_entity_does_not_witness_locked_target() {
    let c = compile("owner.bla", CONTRACT).unwrap();
    let mut coverage = Coverage::new(&c);
    record(
        &mut coverage,
        "lock",
        &json!({"items":[{"id":"A","owner":"O","charge":5,"phase":1,"locked":true}]}),
        &json!({"item":"missing","owner":"O"}),
    );
    let locked = coverage
        .reports
        .iter()
        .find(|r| r.required_witness.contains("not(not($ 3.locked))"))
        .unwrap();
    assert_eq!(locked.witnesses, 0);
}

#[test]
fn aliased_endpoints_do_not_require_opposite_states_of_the_same_entity() {
    let c=compile("alias.bla",r#"
type Item { id: string, phase: int }
state items: [Item]
action move(source: string, target: string)
when move { expect "invalid": input.source != input.target and any(before.items, a => a.id == input.source and any(before.items, b => b.id == input.target and b.phase != a.phase)) or after.items == before.items }
"#).unwrap();
    let mut coverage = Coverage::new(&c);
    record(
        &mut coverage,
        "move",
        &json!({"items":[{"id":"A","phase":0}]}),
        &json!({"source":"A","target":"A"}),
    );
    let alias = coverage
        .reports
        .iter()
        .find(|r| {
            r.required_witness
                .contains("not((input.source != input.target))")
        })
        .unwrap();
    assert_eq!(alias.witnesses, 1, "{}", alias.required_witness);
}

#[test]
fn failing_field_does_not_mark_other_fields_violated() {
    let c = compile(
        "fields.bla",
        r#"
state x: int
state y: int
action inspect()
when inspect { expect "fields": after.x == before.x and after.y == before.y }
"#,
    )
    .unwrap();
    let mut coverage = Coverage::new(&c);
    coverage.record(CoverageEvent {
        action: Some("inspect"),
        before: &json!({"x":1,"y":2}),
        input: &json!({}),
        after: &json!({"x":9,"y":2}),
        sequence: &[],
        action_index: 1,
        elapsed_ms: 0,
        failed: Some("fields"),
    });
    assert_eq!(coverage.summary().violated, 1);
    let y = coverage
        .reports
        .iter()
        .find(|r| r.id == "fields/root.right")
        .unwrap();
    assert_eq!(y.failures, 0);
}

#[test]
fn optional_record_presence_does_not_cover_its_persistent_feature() {
    let c = compile(
        "optional.bla",
        r#"
type Item { sealed: bool }
state item: optional<Item>
action restart()
when restart { expect "durable": after.item == before.item }
"#,
    )
    .unwrap();
    let mut coverage = Coverage::new(&c);
    record(&mut coverage, "restart", &json!({"item":null}), &json!({}));
    record(
        &mut coverage,
        "restart",
        &json!({"item":{"sealed":false}}),
        &json!({}),
    );
    assert!(!coverage.complete());
    assert!(
        coverage
            .reports
            .iter()
            .any(|p| p.required_witness.contains("sealed is true") && p.witnesses == 0)
    );
}

#[test]
fn lost_true_state_does_not_violate_the_unexercised_false_partition() {
    let c = compile(
        "flag.bla",
        r#"
state sealed: bool
action restart()
when restart { expect "durable": after.sealed == before.sealed }
"#,
    )
    .unwrap();
    let mut coverage = Coverage::new(&c);
    coverage.record(CoverageEvent {
        action: Some("restart"),
        before: &json!({"sealed":true}),
        input: &json!({}),
        after: &json!({"sealed":false}),
        sequence: &[],
        action_index: 1,
        elapsed_ms: 0,
        failed: Some("durable"),
    });
    let absent = coverage
        .reports
        .iter()
        .find(|r| r.id.ends_with("bool.false"))
        .unwrap();
    let present = coverage
        .reports
        .iter()
        .find(|r| r.id.ends_with("bool.true"))
        .unwrap();
    assert_eq!(absent.failures, 0);
    assert_eq!(present.failures, 1);
}

#[test]
fn blocked_numeric_effect_requires_an_input_that_would_change_state() {
    let c=compile("numeric.bla",r#"
type Item { id: string, locked: bool, value: int }
state items: [Item]
action apply(id: string, amount: int)
when apply {
expect "invalid": any(before.items, i => i.id == input.id and not i.locked) or after.items == before.items
expect "effect": not any(before.items, i => i.id == input.id and not i.locked) or all(before.items, old => any(after.items, now => now.id == old.id and now.locked == old.locked and ((old.id == input.id and now.value == old.value + input.amount) or (old.id != input.id and now.value == old.value))))
}

"#).unwrap();
    let mut coverage = Coverage::new(&c);
    let state = json!({"items":[{"id":"A","locked":true,"value":5}]});
    record(
        &mut coverage,
        "apply",
        &state,
        &json!({"id":"A","amount":0}),
    );
    let find = |c: &Coverage| {
        c.reports
            .iter()
            .find(|r| r.required_witness.contains("not(not($ 3.locked))"))
            .unwrap()
            .witnesses
    };
    assert_eq!(find(&coverage), 0);
    record(
        &mut coverage,
        "apply",
        &state,
        &json!({"id":"A","amount":1}),
    );
    assert_eq!(find(&coverage), 1);
}

#[test]
fn missing_fields_belong_to_the_selected_entity() {
    let c = compile("owner.bla", CONTRACT).unwrap();
    let coverage = Coverage::new(&c);
    let index = coverage
        .reports
        .iter()
        .position(|r| {
            r.required_witness
                .contains("not(($ 3.owner == input.owner))")
        })
        .unwrap();
    let state = json!({"items":[{"id":"A","owner":"O","charge":5,"phase":0,"locked":false},{"id":"B","owner":"P","charge":5,"phase":1,"locked":false}]});
    let fields = coverage.unmet_fields(index, &state, &json!({"item":"A","owner":"wrong"}));
    assert!(fields.contains("phase"), "{fields:?}");
    assert!(!fields.contains("id"), "{fields:?}");
}
