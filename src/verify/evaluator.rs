use super::run_diagnostic;
use crate::ir::{BinaryOp, Expr, ExprKind, MAX_INT, Predicate, QueryOp, Type, UnaryOp};
use crate::report::VerifyError;
use serde_json::Value;

pub(super) struct PredicateFailure {
    pub expected: Option<Value>,
    pub actual: Option<Value>,
}

pub(super) fn evaluate_predicate(
    predicate: &Predicate,
    contexts: [&Value; 3],
) -> Result<Option<PredicateFailure>, VerifyError> {
    let mut slots = vec![None; predicate.slots.max(3)];
    for (index, value) in contexts.into_iter().enumerate() {
        slots[index] = Some(value.clone());
    }
    let result = evaluate(&predicate.expr, &mut slots, predicate)?;
    match result.as_bool() {
        Some(true) => Ok(None),
        Some(false) => {
            let (expected, actual) = equality_operands(&predicate.expr, &mut slots, predicate)?;
            Ok(Some(PredicateFailure { expected, actual }))
        }
        None => Err(run_diagnostic(
            predicate,
            "BLA-EVAL-TYPE",
            format!(
                "predicate {} did not evaluate to a Boolean",
                predicate.label
            ),
        )),
    }
}

fn equality_operands(
    expression: &Expr,
    slots: &mut [Option<Value>],
    predicate: &Predicate,
) -> Result<(Option<Value>, Option<Value>), VerifyError> {
    match &expression.kind {
        ExprKind::Binary {
            op: BinaryOp::Equal | BinaryOp::NotEqual,
            left,
            right,
        } => {
            let actual = evaluate(left, slots, predicate)?;
            let expected = evaluate(right, slots, predicate)?;
            Ok((Some(expected), Some(actual)))
        }
        _ => Ok((None, None)),
    }
}

pub(super) fn evaluate(
    expression: &Expr,
    slots: &mut [Option<Value>],
    predicate: &Predicate,
) -> Result<Value, VerifyError> {
    match &expression.kind {
        ExprKind::Literal(value) => {
            if let Some(integer) = value.as_i64() {
                checked_json_integer(integer, predicate)?;
            }
            Ok(value.clone())
        }
        ExprKind::Load(slot) => slots.get(*slot).and_then(Clone::clone).ok_or_else(|| {
            run_diagnostic(
                predicate,
                "BLA-EVAL-SLOT",
                format!("binding slot {slot} is unavailable"),
            )
        }),
        ExprKind::Field { base, name } => {
            let value = evaluate(base, slots, predicate)?;
            value
                .as_object()
                .and_then(|object| object.get(name))
                .cloned()
                .ok_or_else(|| {
                    run_diagnostic(
                        predicate,
                        "BLA-EVAL-FIELD",
                        format!("field {name} is unavailable"),
                    )
                })
        }
        ExprKind::Unary { op, operand } => {
            let value = evaluate(operand, slots, predicate)?;
            match op {
                UnaryOp::Not => value
                    .as_bool()
                    .map(|boolean| Value::Bool(!boolean))
                    .ok_or_else(|| {
                        run_diagnostic(predicate, "BLA-EVAL-TYPE", "not requires a Boolean")
                    }),
                UnaryOp::Negate => {
                    if operand.ty == Type::Float {
                        return finite_float(-float(&value, predicate)?, predicate);
                    }
                    let integer = integer(&value, predicate)?;
                    let result = integer.checked_neg().ok_or_else(|| {
                        run_diagnostic(predicate, "BLA-EVAL-INT", "integer negation overflowed")
                    })?;
                    checked_json_integer(result, predicate).map(Value::from)
                }
            }
        }
        ExprKind::Binary { op, left, right } => evaluate_binary(*op, left, right, slots, predicate),
        ExprKind::Count(list) => {
            let value = evaluate(list, slots, predicate)?;
            let length = value
                .as_array()
                .ok_or_else(|| run_diagnostic(predicate, "BLA-EVAL-TYPE", "count requires a list"))?
                .len();
            let integer = i64::try_from(length).map_err(|_| {
                run_diagnostic(
                    predicate,
                    "BLA-EVAL-INT",
                    "list length exceeds integer range",
                )
            })?;
            checked_json_integer(integer, predicate).map(Value::from)
        }
        ExprKind::Query {
            op,
            list,
            slot,
            body,
        } => {
            let value = evaluate(list, slots, predicate)?;
            let items = value.as_array().ok_or_else(|| {
                run_diagnostic(
                    predicate,
                    "BLA-EVAL-TYPE",
                    "collection query requires a list",
                )
            })?;
            if *slot >= slots.len() {
                return Err(run_diagnostic(
                    predicate,
                    "BLA-EVAL-SLOT",
                    format!("binding slot {slot} is outside the predicate frame"),
                ));
            }
            let previous = slots[*slot].take();
            let result = evaluate_query(*op, items, *slot, body, slots, predicate);
            slots[*slot] = previous;
            result
        }
    }
}

fn evaluate_binary(
    op: BinaryOp,
    left: &Expr,
    right: &Expr,
    slots: &mut [Option<Value>],
    predicate: &Predicate,
) -> Result<Value, VerifyError> {
    if op == BinaryOp::And {
        let left_value = boolean(&evaluate(left, slots, predicate)?, predicate)?;
        if !left_value {
            return Ok(Value::Bool(false));
        }
        return boolean(&evaluate(right, slots, predicate)?, predicate).map(Value::Bool);
    }
    if op == BinaryOp::Or {
        let left_value = boolean(&evaluate(left, slots, predicate)?, predicate)?;
        if left_value {
            return Ok(Value::Bool(true));
        }
        return boolean(&evaluate(right, slots, predicate)?, predicate).map(Value::Bool);
    }

    let left_value = evaluate(left, slots, predicate)?;
    let right_value = evaluate(right, slots, predicate)?;
    if left.ty == Type::Float && !matches!(op, BinaryOp::Equal | BinaryOp::NotEqual) {
        let a = float(&left_value, predicate)?;
        let b = float(&right_value, predicate)?;
        return match op {
            BinaryOp::Less => Ok(Value::Bool(a < b)),
            BinaryOp::LessEqual => Ok(Value::Bool(a <= b)),
            BinaryOp::Greater => Ok(Value::Bool(a > b)),
            BinaryOp::GreaterEqual => Ok(Value::Bool(a >= b)),
            BinaryOp::Add => finite_float(a + b, predicate),
            BinaryOp::Subtract => finite_float(a - b, predicate),
            _ => unreachable!(),
        };
    }
    match op {
        BinaryOp::Equal => Ok(Value::Bool(left_value == right_value)),
        BinaryOp::NotEqual => Ok(Value::Bool(left_value != right_value)),
        BinaryOp::Less => compare(&left_value, &right_value, predicate, |a, b| a < b),
        BinaryOp::LessEqual => compare(&left_value, &right_value, predicate, |a, b| a <= b),
        BinaryOp::Greater => compare(&left_value, &right_value, predicate, |a, b| a > b),
        BinaryOp::GreaterEqual => compare(&left_value, &right_value, predicate, |a, b| a >= b),
        BinaryOp::Add => arithmetic(&left_value, &right_value, predicate, i64::checked_add),
        BinaryOp::Subtract => arithmetic(&left_value, &right_value, predicate, i64::checked_sub),
        BinaryOp::And | BinaryOp::Or => unreachable!(),
    }
}

fn evaluate_query(
    op: QueryOp,
    items: &[Value],
    slot: usize,
    body: &Expr,
    slots: &mut [Option<Value>],
    predicate: &Predicate,
) -> Result<Value, VerifyError> {
    match op {
        QueryOp::Any => {
            for item in items {
                slots[slot] = Some(item.clone());
                if boolean(&evaluate(body, slots, predicate)?, predicate)? {
                    return Ok(Value::Bool(true));
                }
            }
            Ok(Value::Bool(false))
        }
        QueryOp::All => {
            for item in items {
                slots[slot] = Some(item.clone());
                if !boolean(&evaluate(body, slots, predicate)?, predicate)? {
                    return Ok(Value::Bool(false));
                }
            }
            Ok(Value::Bool(true))
        }
        QueryOp::Unique => {
            let mut keys = Vec::with_capacity(items.len());
            for item in items {
                slots[slot] = Some(item.clone());
                let key = evaluate(body, slots, predicate)?;
                if !matches!(
                    key,
                    Value::Null | Value::Bool(_) | Value::String(_) | Value::Number(_)
                ) {
                    return Err(run_diagnostic(
                        predicate,
                        "BLA-EVAL-TYPE",
                        "unique keys must be scalar or null values",
                    ));
                }
                if keys.contains(&key) {
                    return Ok(Value::Bool(false));
                }
                keys.push(key);
            }
            Ok(Value::Bool(true))
        }
    }
}

fn float(value: &Value, predicate: &Predicate) -> Result<f64, VerifyError> {
    value
        .as_f64()
        .filter(|number| number.is_finite())
        .ok_or_else(|| run_diagnostic(predicate, "BLA-EVAL-TYPE", "expected a finite float"))
}

fn finite_float(value: f64, predicate: &Predicate) -> Result<Value, VerifyError> {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .ok_or_else(|| {
            run_diagnostic(
                predicate,
                "BLA-EVAL-FLOAT",
                "float arithmetic produced a nonfinite value",
            )
        })
}

fn compare(
    left: &Value,
    right: &Value,
    predicate: &Predicate,
    operation: impl FnOnce(i64, i64) -> bool,
) -> Result<Value, VerifyError> {
    Ok(Value::Bool(operation(
        integer(left, predicate)?,
        integer(right, predicate)?,
    )))
}

fn arithmetic(
    left: &Value,
    right: &Value,
    predicate: &Predicate,
    operation: fn(i64, i64) -> Option<i64>,
) -> Result<Value, VerifyError> {
    let result =
        operation(integer(left, predicate)?, integer(right, predicate)?).ok_or_else(|| {
            run_diagnostic(predicate, "BLA-EVAL-INT", "integer arithmetic overflowed")
        })?;
    checked_json_integer(result, predicate).map(Value::from)
}

fn boolean(value: &Value, predicate: &Predicate) -> Result<bool, VerifyError> {
    value
        .as_bool()
        .ok_or_else(|| run_diagnostic(predicate, "BLA-EVAL-TYPE", "expected a Boolean value"))
}

fn integer(value: &Value, predicate: &Predicate) -> Result<i64, VerifyError> {
    let integer = value
        .as_i64()
        .ok_or_else(|| run_diagnostic(predicate, "BLA-EVAL-TYPE", "expected an integer value"))?;
    checked_json_integer(integer, predicate)
}

fn checked_json_integer(value: i64, predicate: &Predicate) -> Result<i64, VerifyError> {
    if (-MAX_INT..=MAX_INT).contains(&value) {
        Ok(value)
    } else {
        Err(run_diagnostic(
            predicate,
            "BLA-EVAL-INT",
            format!("integer {value} is outside the exact JSON-safe range"),
        ))
    }
}
