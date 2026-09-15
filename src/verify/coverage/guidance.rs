use super::*;
use std::collections::BTreeSet;

impl Coverage {
    pub(in crate::verify) fn unmet_fields(
        &self,
        index: usize,
        state: &Value,
        input: &Value,
    ) -> BTreeSet<String> {
        let Some(probe) = &self.plans[index] else {
            return BTreeSet::new();
        };
        let predicate = &self.predicates[probe.predicate];
        let mut result = BTreeSet::new();
        missing_route(
            &probe.route,
            &probe.witness,
            frame(predicate, [state, input, state]),
            predicate,
            &origins(&probe.route),
            &mut result,
        );
        result
    }

    pub(in crate::verify) fn action_score(
        &self,
        action: &str,
        state: &Value,
        input: &Value,
    ) -> f64 {
        let Some(effect) = self.effects.iter().find(|e| e.action == action) else {
            return 1.0;
        };
        let Some(index) = self.reports.iter().enumerate().find_map(|(i, r)| {
            (r.action.as_deref() == Some(action) && self.plans[i].is_some()).then_some(i)
        }) else {
            return 1.0;
        };
        let predicate = &self.predicates[self.plans[index].as_ref().unwrap().predicate];
        let mut slots = frame(predicate, [state, input, state]);
        slots.resize_with(effect.slots.max(slots.len()), || None);
        fitness(&effect.guard, true, &mut slots, predicate, &BTreeMap::new())
    }
}

fn missing_route(
    route: &[Route],
    witness: &Witness,
    mut slots: Vec<Option<Value>>,
    predicate: &Predicate,
    origin: &BTreeMap<usize, usize>,
    result: &mut BTreeSet<String>,
) {
    match route.split_first() {
        Some((Route::Check(expr, wanted), tail)) => {
            missing(expr, *wanted, &mut slots, predicate, origin, result);
            missing_route(tail, witness, slots, predicate, origin, result);
        }
        Some((Route::Bind(list, slot), tail)) => {
            let Ok(Value::Array(items)) = evaluate(list, &mut slots, predicate) else {
                return;
            };
            let mut best = None;
            let mut score = f64::NEG_INFINITY;
            for item in items {
                let mut next = slots.clone();
                next[*slot] = Some(item);
                let fitness = score_route(tail, witness, next.clone(), predicate, origin);
                if fitness > score {
                    score = fitness;
                    best = Some(next);
                }
            }
            if let Some(slots) = best {
                missing_route(tail, witness, slots, predicate, origin, result);
            } else {
                fields(list, origin, result);
            }
        }
        None => match witness {
            Witness::Expression(expr) => missing(expr, true, &mut slots, predicate, origin, result),
            Witness::Partition(expr, path, ..) => {
                if !witness_matches(witness, &mut slots, predicate) {
                    fields(expr, origin, result);
                    result.extend(path.iter().cloned());
                }
            }
            Witness::Domain(expr, ..) => {
                if !witness_matches(witness, &mut slots, predicate) {
                    fields(expr, origin, result);
                }
            }
        },
    }
}

fn missing(
    expr: &Expr,
    wanted: bool,
    slots: &mut [Option<Value>],
    predicate: &Predicate,
    origin: &BTreeMap<usize, usize>,
    result: &mut BTreeSet<String>,
) {
    if evaluate(expr, slots, predicate)
        .ok()
        .and_then(|v| v.as_bool())
        == Some(wanted)
    {
        return;
    }
    match &expr.kind {
        ExprKind::Unary {
            op: UnaryOp::Not,
            operand,
        } => missing(operand, !wanted, slots, predicate, origin, result),
        ExprKind::Binary {
            op: BinaryOp::And | BinaryOp::Or,
            left,
            right,
        } => {
            let all = matches!(
                expr.kind,
                ExprKind::Binary {
                    op: BinaryOp::And,
                    ..
                }
            ) == wanted;
            if all {
                missing(left, wanted, slots, predicate, origin, result);
                missing(right, wanted, slots, predicate, origin, result);
            } else {
                let a = fitness(left, wanted, slots, predicate, origin);
                let b = fitness(right, wanted, slots, predicate, origin);
                missing(
                    if a >= b { left } else { right },
                    wanted,
                    slots,
                    predicate,
                    origin,
                    result,
                );
            }
        }
        ExprKind::Query {
            op,
            list,
            slot,
            body,
        } => {
            let Ok(Value::Array(items)) = evaluate(list, slots, predicate) else {
                return;
            };
            let previous = slots[*slot].clone();
            let mut nested = origin.clone();
            nested.insert(*slot, if depends_on(list, 2, origin) { 2 } else { 0 });
            let existential = (*op == QueryOp::Any) == wanted;
            let mut best = None;
            let mut score = f64::NEG_INFINITY;
            let mut fallback = None;
            for item in items {
                slots[*slot] = Some(item.clone());
                if existential {
                    let fit = fitness(body, wanted, slots, predicate, &nested);
                    if fallback.as_ref().is_none_or(|(old, _)| fit > *old) {
                        fallback = Some((fit, item.clone()));
                    }
                    if anchors_match(body, *slot, slots, predicate) && fit > score {
                        score = fit;
                        best = Some(item);
                    }
                } else {
                    missing(body, wanted, slots, predicate, &nested, result);
                }
            }
            if existential && let Some(item) = best.or_else(|| fallback.map(|(_, item)| item)) {
                slots[*slot] = Some(item);
                missing(body, wanted, slots, predicate, &nested, result);
            }
            slots[*slot] = previous;
        }
        _ => {
            if !depends_on(expr, 2, origin) {
                fields(expr, origin, result);
            }
        }
    }
}

fn fields(expr: &Expr, origin: &BTreeMap<usize, usize>, result: &mut BTreeSet<String>) {
    match &expr.kind {
        ExprKind::Field { base, name } => {
            if depends_on(base, 0, origin) {
                result.insert(name.clone());
            }
            fields(base, origin, result);
        }
        ExprKind::Binary { left, right, .. } => {
            fields(left, origin, result);
            fields(right, origin, result);
        }
        ExprKind::Unary { operand, .. } | ExprKind::Count(operand) => {
            fields(operand, origin, result)
        }
        ExprKind::Query { list, body, .. } => {
            fields(list, origin, result);
            fields(body, origin, result);
        }
        _ => {}
    }
}

pub(super) fn anchors_match(
    expr: &Expr,
    slot: usize,
    slots: &mut [Option<Value>],
    predicate: &Predicate,
) -> bool {
    if is_identity(expr) && depends_on(expr, slot, &BTreeMap::new()) {
        return evaluate(expr, slots, predicate)
            .ok()
            .and_then(|v| v.as_bool())
            == Some(true);
    }
    match &expr.kind {
        ExprKind::Binary { left, right, .. } => {
            anchors_match(left, slot, slots, predicate)
                && anchors_match(right, slot, slots, predicate)
        }
        ExprKind::Unary { operand, .. } => anchors_match(operand, slot, slots, predicate),
        _ => true,
    }
}
