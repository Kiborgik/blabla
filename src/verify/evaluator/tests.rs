use super::*;
use crate::diagnostic::{Location, Span};
use serde_json::json;
use std::cell::Cell;

thread_local! {
    static COPIED_NODES: Cell<Option<usize>> = const { Cell::new(None) };
}

pub(super) fn observe_copy(value: &Value) {
    COPIED_NODES.with(|counter| {
        if let Some(previous) = counter.get() {
            counter.set(Some(previous + value_nodes(value)));
        }
    });
}

fn value_nodes(value: &Value) -> usize {
    1 + match value {
        Value::Array(items) => items.iter().map(value_nodes).sum(),
        Value::Object(fields) => fields.values().map(value_nodes).sum(),
        _ => 0,
    }
}

struct CopyScope(Option<usize>);

impl Drop for CopyScope {
    fn drop(&mut self) {
        COPIED_NODES.with(|counter| counter.set(self.0));
    }
}

fn measure_copies<T>(operation: impl FnOnce() -> T) -> (T, usize) {
    let _scope = CopyScope(COPIED_NODES.with(|counter| counter.replace(Some(0))));
    let result = operation();
    let count = COPIED_NODES.with(|counter| counter.get().unwrap());
    (result, count)
}

fn expression(kind: ExprKind, ty: Type) -> Expr {
    Expr {
        kind,
        ty,
        span: Span {
            start: 19,
            end: 31,
            line: 4,
            column: 7,
        },
    }
}

fn literal(value: Value) -> Expr {
    let ty = match &value {
        Value::Null => Type::Null,
        Value::Bool(_) => Type::Bool,
        Value::Number(_) => Type::Int,
        Value::String(_) => Type::String,
        Value::Array(_) => Type::List(Box::new(Type::Null)),
        Value::Object(_) => Type::Record(vec![]),
    };
    expression(ExprKind::Literal(value), ty)
}

fn load(slot: usize) -> Expr {
    expression(ExprKind::Load(slot), Type::Record(vec![]))
}

fn field(base: Expr, name: &str, ty: Type) -> Expr {
    expression(
        ExprKind::Field {
            base: Box::new(base),
            name: name.into(),
        },
        ty,
    )
}

fn selected(slot: usize) -> Expr {
    field(load(slot), "selected", Type::Bool)
}

fn binary(op: BinaryOp, left: Expr, right: Expr) -> Expr {
    expression(
        ExprKind::Binary {
            op,
            left: Box::new(left),
            right: Box::new(right),
        },
        Type::Bool,
    )
}

fn query(op: QueryOp, list: Expr, slot: usize, body: Expr) -> Expr {
    expression(
        ExprKind::Query {
            op,
            list: Box::new(list),
            slot,
            body: Box::new(body),
        },
        Type::Bool,
    )
}

fn predicate(expr: Expr) -> Predicate {
    Predicate {
        label: "selected field".into(),
        expr,
        location: Location {
            file: "loaded-fields.bla".into(),
            line: 13,
            column: 9,
        },
        source: "selected field".into(),
        slots: 5,
        forbidden: false,
    }
}

fn assert_contract_error<T: std::fmt::Debug>(
    result: Result<T, VerifyError>,
    predicate: &Predicate,
    code: &str,
    message: &str,
) {
    let actual = result.unwrap_err();
    let expected = run_diagnostic(predicate, code, message);
    match (actual, expected) {
        (VerifyError::Contract(actual), VerifyError::Contract(expected)) => {
            assert_eq!(actual.location, predicate.location);
            assert_eq!(actual.code, code);
            assert_eq!(actual, expected);
        }
        (actual, _) => panic!("expected located contract error, got {actual:?}"),
    }
}

#[test]
fn loaded_field_copies_only_the_selected_value() {
    let mut measurements = Vec::new();
    for slot in [0, 1, 2, 4] {
        for width in [0, 64] {
            let binding = json!({"selected": true, "unused": vec!["unrelated"; width]});
            let mut slots = vec![None; 5];
            slots[slot] = Some(binding);
            let predicate = predicate(selected(slot));
            let (result, nodes) =
                measure_copies(|| evaluate(&predicate.expr, &mut slots, &predicate));
            assert_eq!(result.unwrap(), json!(true));
            measurements.push((slot, width, nodes));
        }
    }
    assert_eq!(
        measurements,
        vec![
            (0, 0, 1),
            (0, 64, 1),
            (1, 0, 1),
            (1, 64, 1),
            (2, 0, 1),
            (2, 64, 1),
            (4, 0, 1),
            (4, 64, 1),
        ]
    );
}

#[test]
fn selected_values_remain_owned_without_copying_siblings() {
    let mut measurements = Vec::new();
    for (value, expected_nodes) in [
        (json!(false), 1),
        (Value::Null, 1),
        (json!("owned"), 1),
        (json!([1, {"nested": [false, null]}]), 6),
        (json!({"list": [1, 2], "name": "value"}), 5),
    ] {
        let mut slots = vec![Some(json!({
            "selected": value,
            "unused": vec!["unrelated"; 64],
            "unvalidated": MAX_INT + 1,
        }))];
        let original = slots.clone();
        let predicate = predicate(selected(0));
        let (result, nodes) = measure_copies(|| evaluate(&predicate.expr, &mut slots, &predicate));
        let mut owned = result.unwrap();
        assert_eq!(owned, value);
        match &mut owned {
            Value::Array(items) => items[1]["nested"][0] = json!("changed"),
            Value::Object(fields) => fields.get_mut("list").unwrap()[0] = json!("changed"),
            _ => owned = json!({"replacement": true}),
        }
        assert_ne!(owned, value);
        drop(owned);
        assert_eq!(slots, original);
        measurements.push((nodes, expected_nodes));
    }
    assert!(
        measurements
            .iter()
            .all(|(actual, expected)| actual == expected),
        "copied/selected subtree nodes: {measurements:?}"
    );
}

#[test]
fn standalone_load_and_nonload_fields_keep_owned_results() {
    let binding = json!({"selected": {"items": [true, false]}, "unused": [1, 2, 3]});
    let mut slots = vec![Some(binding.clone())];
    let predicate = predicate(load(0));
    let (result, nodes) = measure_copies(|| evaluate(&predicate.expr, &mut slots, &predicate));
    assert_eq!(nodes, 9);
    let mut owned = result.unwrap();
    assert_eq!(owned, binding);
    owned["selected"]["items"][0] = json!("changed");
    assert_eq!(slots[0].as_ref().unwrap(), &binding);

    let literal_base = field(literal(json!({"selected": false})), "selected", Type::Bool);
    assert_eq!(
        evaluate(&literal_base, &mut slots, &predicate).unwrap(),
        json!(false)
    );
    let nested = field(
        field(load(0), "selected", Type::Record(vec![])),
        "items",
        Type::List(Box::new(Type::Bool)),
    );
    let mut owned = evaluate(&nested, &mut slots, &predicate).unwrap();
    assert_eq!(owned, json!([true, false]));
    owned[0] = json!("changed");
    assert_eq!(slots[0].as_ref().unwrap(), &binding);
}

#[test]
fn loaded_fields_distinguish_missing_null_and_wrong_types() {
    for (slot, mut slots) in [
        (0, vec![]),
        (0, vec![None]),
        (3, vec![Some(json!({"selected": true}))]),
    ] {
        let predicate = predicate(selected(slot));
        assert_contract_error(
            evaluate(&predicate.expr, &mut slots, &predicate),
            &predicate,
            "BLA-EVAL-SLOT",
            &format!("binding slot {slot} is unavailable"),
        );
    }
    for value in [
        json!({}),
        Value::Null,
        json!(false),
        json!(3),
        json!("text"),
        json!([]),
    ] {
        let mut slots = vec![Some(value)];
        let predicate = predicate(selected(0));
        assert_contract_error(
            evaluate(&predicate.expr, &mut slots, &predicate),
            &predicate,
            "BLA-EVAL-FIELD",
            "field selected is unavailable",
        );
    }
    let mut slots = vec![Some(json!({"selected": null, "unvalidated": MAX_INT + 1}))];
    let predicate = predicate(selected(0));
    assert_eq!(
        evaluate(&predicate.expr, &mut slots, &predicate).unwrap(),
        Value::Null
    );
    let misuse = expression(
        ExprKind::Unary {
            op: UnaryOp::Not,
            operand: Box::new(selected(0)),
        },
        Type::Bool,
    );
    assert_contract_error(
        evaluate(&misuse, &mut slots, &predicate),
        &predicate,
        "BLA-EVAL-TYPE",
        "not requires a Boolean",
    );
    let missing_base = field(
        field(load(0), "missing_base", Type::Record(vec![])),
        "selected",
        Type::Bool,
    );
    assert_contract_error(
        evaluate(&missing_base, &mut slots, &predicate),
        &predicate,
        "BLA-EVAL-FIELD",
        "field missing_base is unavailable",
    );
}

#[test]
fn field_failures_preserve_short_circuiting() {
    for (op, left, skipped) in [
        (BinaryOp::And, false, true),
        (BinaryOp::And, true, false),
        (BinaryOp::Or, true, true),
        (BinaryOp::Or, false, false),
    ] {
        let mut slots = vec![Some(json!({"selected": left}))];
        let predicate = predicate(binary(op, selected(0), selected(1)));
        let result = evaluate(&predicate.expr, &mut slots, &predicate);
        if skipped {
            assert_eq!(result.unwrap(), json!(left));
        } else {
            assert_contract_error(
                result,
                &predicate,
                "BLA-EVAL-SLOT",
                "binding slot 1 is unavailable",
            );
        }
    }
    for op in [BinaryOp::And, BinaryOp::Or, BinaryOp::Equal] {
        let mut slots = vec![Some(json!({}))];
        let predicate = predicate(binary(op, selected(0), selected(1)));
        assert_contract_error(
            evaluate(&predicate.expr, &mut slots, &predicate),
            &predicate,
            "BLA-EVAL-FIELD",
            "field selected is unavailable",
        );
    }
    for op in [BinaryOp::And, BinaryOp::Or] {
        let mut slots = vec![Some(json!({"selected": "not Boolean"}))];
        let predicate = predicate(binary(op, selected(0), selected(1)));
        assert_contract_error(
            evaluate(&predicate.expr, &mut slots, &predicate),
            &predicate,
            "BLA-EVAL-TYPE",
            "expected a Boolean value",
        );
    }
    let mut slots = vec![Some(json!({"selected": true}))];
    let predicate = predicate(binary(BinaryOp::Equal, selected(0), selected(1)));
    assert_contract_error(
        evaluate(&predicate.expr, &mut slots, &predicate),
        &predicate,
        "BLA-EVAL-SLOT",
        "binding slot 1 is unavailable",
    );
}

#[test]
fn query_field_reads_restore_bindings_on_success_and_failure() {
    let original = vec![
        None,
        None,
        None,
        Some(json!({"selected": "outer sentinel"})),
        None,
    ];
    for (op, items, expected) in [
        (QueryOp::All, json!([]), true),
        (QueryOp::Any, json!([]), false),
        (
            QueryOp::All,
            json!([{"selected": true}, {"selected": true}]),
            true,
        ),
        (
            QueryOp::All,
            json!([{"selected": true}, {"selected": false}, {}]),
            false,
        ),
        (
            QueryOp::Any,
            json!([{"selected": false}, {"selected": true}, {}]),
            true,
        ),
        (QueryOp::Any, json!([{"selected": false}]), false),
        (QueryOp::Unique, json!([]), true),
        (
            QueryOp::Unique,
            json!([{"selected": null}, {"selected": false}, {"selected": "key"}]),
            true,
        ),
        (
            QueryOp::Unique,
            json!([{"selected": null}, {"selected": null}, {}]),
            false,
        ),
    ] {
        let mut slots = original.clone();
        let predicate = predicate(query(op, literal(items), 3, selected(3)));
        assert_eq!(
            evaluate(&predicate.expr, &mut slots, &predicate).unwrap(),
            json!(expected)
        );
        assert_eq!(slots, original);
    }
    for (op, items, code, message) in [
        (
            QueryOp::All,
            json!([{"selected": true}, {}]),
            "BLA-EVAL-FIELD",
            "field selected is unavailable",
        ),
        (
            QueryOp::Any,
            json!([{"selected": false}, {}]),
            "BLA-EVAL-FIELD",
            "field selected is unavailable",
        ),
        (
            QueryOp::All,
            json!([{"selected": null}]),
            "BLA-EVAL-TYPE",
            "expected a Boolean value",
        ),
        (
            QueryOp::Unique,
            json!([{"selected": []}]),
            "BLA-EVAL-TYPE",
            "unique keys must be scalar or null values",
        ),
    ] {
        let mut slots = original.clone();
        let predicate = predicate(query(op, literal(items), 3, selected(3)));
        assert_contract_error(
            evaluate(&predicate.expr, &mut slots, &predicate),
            &predicate,
            code,
            message,
        );
        assert_eq!(slots, original);
    }
    for inner in [json!([{"selected": true}]), json!([{}])] {
        let mut slots = original.clone();
        let nested = query(
            QueryOp::All,
            field(load(3), "items", Type::List(Box::new(Type::Record(vec![])))),
            4,
            binary(BinaryOp::And, selected(3), selected(4)),
        );
        let predicate = predicate(query(
            QueryOp::All,
            literal(json!([{"selected": true, "items": inner}])),
            3,
            nested,
        ));
        let result = evaluate(&predicate.expr, &mut slots, &predicate);
        if inner[0].get("selected").is_some() {
            assert_eq!(result.unwrap(), json!(true));
        } else {
            assert_contract_error(
                result,
                &predicate,
                "BLA-EVAL-FIELD",
                "field selected is unavailable",
            );
        }
        assert_eq!(slots, original);
    }
    let mut slots = original.clone();
    let shadowed = query(
        QueryOp::Any,
        literal(json!([{"selected": true}])),
        3,
        selected(3),
    );
    let predicate = predicate(query(
        QueryOp::All,
        literal(json!([{"selected": true}])),
        3,
        binary(BinaryOp::And, shadowed, selected(3)),
    ));
    assert_eq!(
        evaluate(&predicate.expr, &mut slots, &predicate).unwrap(),
        json!(true)
    );
    assert_eq!(slots, original);
}

#[test]
fn selected_equality_failures_keep_exact_operands() {
    for (left, right) in [
        (json!(false), json!(true)),
        (Value::Null, json!("not null")),
        (
            json!([1, {"nested": [false, null]}]),
            json!([1, {"nested": [true, null]}]),
        ),
        (json!({"selected": "before"}), json!({"selected": "after"})),
    ] {
        let before = json!({"selected": left, "unused": [1, 2, 3]});
        let input = json!({"selected": "input"});
        let after = json!({"selected": right, "unused": [4, 5, 6]});
        let predicate = predicate(binary(BinaryOp::Equal, selected(0), selected(2)));
        let failure = evaluate_predicate(&predicate, [&before, &input, &after])
            .unwrap()
            .unwrap();
        assert_eq!(failure.actual, Some(left.clone()));
        assert_eq!(failure.expected, Some(right));
        assert!(
            evaluate_predicate(&predicate, [&before, &input, &before])
                .unwrap()
                .is_none()
        );
        let not_equal = self::predicate(binary(BinaryOp::NotEqual, selected(0), selected(2)));
        let failure = evaluate_predicate(&not_equal, [&before, &input, &before])
            .unwrap()
            .unwrap();
        assert_eq!(failure.actual, Some(left.clone()));
        assert_eq!(failure.expected, Some(left));
    }
}
