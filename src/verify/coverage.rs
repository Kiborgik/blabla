use super::evaluator::evaluate;
use crate::ir::{
    ActionKind, BinaryOp, Contract, Expr, ExprKind, Predicate, QueryOp, Type, UnaryOp,
};
use crate::report::{Call, CoverageObligation, CoverageStatus, CoverageSummary};
use serde_json::Value;
use std::collections::BTreeMap;
mod guidance;
#[cfg(test)]
mod tests;

#[derive(Clone, Debug)]
pub(super) enum Route {
    Check(Expr, bool),
    Bind(Expr, usize),
}

#[derive(Clone, Debug)]
enum Witness {
    Expression(Expr),
    Domain(Expr, usize, Expr),
    Partition(Expr, Vec<String>, Partition, Expr),
}

#[derive(Clone, Debug)]
enum Partition {
    Boolean(bool),
    Present(bool),
    Different(Value),
    Nonempty,
}

#[derive(Clone, Debug)]
struct Probe {
    predicate: usize,
    route: Vec<Route>,
    witness: Witness,
}

#[derive(Clone, Copy)]
struct Definition<'a> {
    predicate: usize,
    action: Option<&'a str>,
    restart: bool,
}

pub(super) struct CoverageEvent<'a> {
    pub(super) action: Option<&'a str>,
    pub(super) before: &'a Value,
    pub(super) input: &'a Value,
    pub(super) after: &'a Value,
    pub(super) sequence: &'a [Call],
    pub(super) action_index: usize,
    pub(super) elapsed_ms: u64,
    pub(super) failed: Option<&'a str>,
}

pub(super) struct Coverage {
    predicates: Vec<Predicate>,
    plans: Vec<Option<Probe>>,
    pub(super) reports: Vec<CoverageObligation>,
    effects: Vec<Effect>,
}

struct Effect {
    action: String,
    guard: Expr,
    expected: Expr,
    slots: usize,
}

impl Coverage {
    pub(super) fn new(contract: &Contract) -> Self {
        let mut coverage = Self {
            predicates: Vec::new(),
            plans: Vec::new(),
            reports: Vec::new(),
            effects: effects(contract),
        };
        for action in &contract.actions {
            coverage.plans.push(None);
            coverage.reports.push(obligation(
                format!("action/{}", action.name),
                &action.name,
                Some(&action.name),
                None,
                format!("execute {} and check its resulting behavior", action.name),
            ));
            for predicate in &action.postconditions {
                coverage.derive(
                    predicate,
                    Some(&action.name),
                    action.kind == ActionKind::Restart,
                );
            }
        }
        for predicate in &contract.invariants {
            coverage.derive(predicate, None, false);
        }
        coverage
    }

    fn derive(&mut self, predicate: &Predicate, action: Option<&str>, restart: bool) {
        let index = self.predicates.len();
        self.predicates.push(predicate.clone());
        self.discover(
            Definition {
                predicate: index,
                action,
                restart,
            },
            &normalize(&predicate.expr, false),
            Vec::new(),
            "root".into(),
        );
    }

    fn push(
        &mut self,
        definition: Definition<'_>,
        route: Vec<Route>,
        witness: Witness,
        path: &str,
        description: String,
    ) {
        let Definition {
            predicate: index,
            action,
            ..
        } = definition;
        let predicate = &self.predicates[index];
        let id = format!("{}/{}", predicate.label, path);
        let label = predicate.label.clone();
        let location = predicate.location.clone();
        self.plans.push(Some(Probe {
            predicate: index,
            route,
            witness,
        }));
        self.reports
            .push(obligation(id, &label, action, Some(location), description));
    }

    fn discover(
        &mut self,
        definition: Definition<'_>,
        expression: &Expr,
        route: Vec<Route>,
        path: String,
    ) {
        let Definition {
            action, restart, ..
        } = definition;
        match &expression.kind {
            ExprKind::Binary {
                op: BinaryOp::Or,
                left,
                right,
            } => {
                let sources = origins(&route);
                if action.is_some()
                    && depends_on(left, 2, &sources)
                    && !depends_on(right, 2, &sources)
                {
                    let mut reordered = expression.clone();
                    reordered.kind = ExprKind::Binary {
                        op: BinaryOp::Or,
                        left: right.clone(),
                        right: left.clone(),
                    };
                    self.discover(definition, &reordered, route, path);
                    return;
                }
                if let ExprKind::Literal(Value::Bool(value)) = &left.kind {
                    let selected = if *value { left } else { right };
                    self.discover(definition, selected, route, format!("{path}.constant"));
                    return;
                }
                if (action.is_some()
                    && !depends_on(left, 2, &sources)
                    && depends_on(right, 2, &sources))
                    || matches!(
                        left.kind,
                        ExprKind::Unary {
                            op: UnaryOp::Not,
                            ..
                        }
                    )
                {
                    let mut next = route.clone();
                    next.push(Route::Check(*left.clone(), false));
                    self.discover(definition, right, next, format!("{path}.effect"));
                    if !matches!(
                        left.kind,
                        ExprKind::Unary {
                            op: UnaryOp::Not,
                            ..
                        }
                    ) && is_preservation(right, &sources)
                    {
                        self.invalid_probes(definition, left, &route, &path);
                    }
                } else {
                    for (name, branch) in [("left", left), ("right", right)] {
                        let mut next = route.clone();
                        if name == "right" {
                            next.push(Route::Check(*left.clone(), false));
                        }
                        next.push(Route::Check(*branch.clone(), true));
                        self.discover(definition, branch, next, format!("{path}.{name}"));
                    }
                }
            }
            ExprKind::Binary {
                op: BinaryOp::And,
                left,
                right,
            } => {
                self.discover(definition, left, route.clone(), format!("{path}.left"));
                let mut right_route = route;
                if !depends_on(left, 2, &origins(&right_route)) {
                    right_route.push(Route::Check(*left.clone(), true));
                }
                self.discover(definition, right, right_route, format!("{path}.right"));
            }
            ExprKind::Query {
                op: QueryOp::All | QueryOp::Any,
                list,
                slot,
                body,
            } => {
                let mut next = route;
                next.push(Route::Bind(*list.clone(), *slot));
                if matches!(
                    expression.kind,
                    ExprKind::Query {
                        op: QueryOp::Any,
                        ..
                    }
                ) {
                    next.push(Route::Check(*body.clone(), true));
                }
                self.discover(definition, body, next, format!("{path}.member"));
            }
            ExprKind::Query {
                op: QueryOp::Unique,
                list,
                ..
            } => {
                self.push(
                    definition,
                    route,
                    Witness::Domain(*list.clone(), 2, expression.clone()),
                    &path,
                    format!("{} has at least two members and unique keys", render(list)),
                );
            }
            ExprKind::Unary {
                op: UnaryOp::Not,
                operand,
            } if matches!(operand.kind, ExprKind::Query { .. }) => {
                if let ExprKind::Query { list, .. } = &operand.kind {
                    self.push(
                        definition,
                        route,
                        Witness::Domain(*list.clone(), 1, expression.clone()),
                        &path,
                        format!(
                            "{} is nonempty while {} holds",
                            render(list),
                            render(expression)
                        ),
                    );
                }
            }
            _ => {
                self.push(
                    definition,
                    route.clone(),
                    Witness::Expression(expression.clone()),
                    &path,
                    describe(&route, expression),
                );
                if restart {
                    self.lifecycle(definition, expression, &route, &path);
                }
            }
        }
    }

    fn lifecycle(
        &mut self,
        definition: Definition<'_>,
        expression: &Expr,
        route: &[Route],
        path: &str,
    ) {
        let ExprKind::Binary {
            op: BinaryOp::Equal,
            left,
            right,
        } = &expression.kind
        else {
            return;
        };
        let source = origins(route);
        let before = if depends_on(left, 0, &source) && depends_on(right, 2, &source) {
            Some(*left.clone())
        } else if depends_on(right, 0, &source) && depends_on(left, 2, &source) {
            Some(*right.clone())
        } else if depends_on(left, 2, &source) {
            before_equivalent(left, route)
        } else if depends_on(right, 2, &source) {
            before_equivalent(right, route)
        } else {
            None
        };
        let Some(before) = before else { return };
        let target = match (&left.kind, &right.kind) {
            (ExprKind::Literal(value), _) | (_, ExprKind::Literal(value)) => Some(value.clone()),
            _ => None,
        };
        let mut partitions = Vec::new();
        partition_types(&before.ty, Vec::new(), target.as_ref(), &mut partitions);
        for (suffix, fields, partition) in partitions {
            let description = format!(
                "trusted restart with {}{} {} before restart; {} passes after restart",
                render(&before),
                fields.iter().map(|s| format!(".{s}")).collect::<String>(),
                partition.description(),
                render(expression)
            );
            self.push(
                definition,
                route.to_vec(),
                Witness::Partition(before.clone(), fields, partition, expression.clone()),
                &format!("{path}.restart.{suffix}"),
                description,
            );
        }
    }

    fn invalid_probes(
        &mut self,
        definition: Definition<'_>,
        guard: &Expr,
        route: &[Route],
        path: &str,
    ) {
        let mut atoms = Vec::new();
        guard_atoms(guard, &mut Vec::new(), &mut atoms);
        for (position, atom) in atoms {
            if matches!(atom.kind, ExprKind::Literal(_)) {
                continue;
            }
            let fault = if is_identity(&atom) {
                missing_identity(guard, &position, &atom)
            } else {
                fault_guard(guard, &position, &atom)
            };
            let mut next = route.to_vec();
            next.push(Route::Check(guard.clone(), false));
            next.push(Route::Check(fault.clone(), true));
            let changing = if is_boolean_test(&atom) {
                self.effects
                    .iter()
                    .find(|effect| {
                        definition.action == Some(effect.action.as_str())
                            && render(&effect.guard) == render(guard)
                            && numeric_input(&effect.expected)
                    })
                    .map(|effect| (effect.expected.clone(), effect.slots))
            } else {
                None
            };
            let change_description = if let Some((expected, slots)) = changing {
                self.predicates[definition.predicate].slots =
                    self.predicates[definition.predicate].slots.max(slots);
                next.push(Route::Check(expected, false));
                "; the enabling numeric effect would change state"
            } else {
                ""
            };
            let name = position
                .iter()
                .map(usize::to_string)
                .collect::<Vec<_>>()
                .join(".");
            self.push(
                definition,
                next,
                Witness::Expression(boolean(true)),
                &format!("{path}.invalid.{name}"),
                format!(
                    "invalid operation with {}; {} must be false{}",
                    render(&fault),
                    render(guard),
                    change_description
                ),
            );
        }
    }

    pub(super) fn record(&mut self, event: CoverageEvent<'_>) {
        let CoverageEvent {
            action,
            before,
            input,
            after,
            sequence,
            action_index,
            elapsed_ms,
            failed,
        } = event;
        let mut failed_recorded = false;
        for index in 0..self.reports.len() {
            let report = &self.reports[index];
            if report
                .action
                .as_deref()
                .is_some_and(|name| Some(name) != action)
            {
                continue;
            }
            let (matched, failed_here) = if let Some(probe) = &self.plans[index] {
                let predicate = &self.predicates[probe.predicate];
                let contexts = if report.action.is_none() {
                    [after, &Value::Null, &Value::Null]
                } else {
                    [before, input, after]
                };
                let slots = frame(predicate, contexts);
                let matched = route_matches(&probe.route, &probe.witness, slots.clone(), predicate);
                let failed_here = failed == Some(report.property.as_str())
                    && route_failure(
                        &probe.route,
                        &probe.witness,
                        slots,
                        predicate,
                        &origins(&probe.route),
                        report.id.contains(".invalid."),
                    );
                (matched, failed_here)
            } else {
                (action.is_some(), false)
            };
            let report = &mut self.reports[index];
            report.evaluations += 1;
            if failed_here {
                report.failures += 1;
                report.status = CoverageStatus::Violated;
                report.reason =
                    Some("The behavioral property was violated in this witness context".into());
                failed_recorded = true;
            } else if matched && failed != Some(report.property.as_str()) {
                report.witnesses += 1;
                report.passes += 1;
                if report.failures == 0 {
                    report.status = CoverageStatus::Verified;
                    report.reason = None;
                }
                if report.first_witness_trace.is_none() {
                    report.first_witness_trace = Some(sequence.to_vec());
                    report.first_witness_action = Some(action_index);
                    report.first_witness_ms = Some(elapsed_ms);
                }
                if report
                    .shortest_witness_trace
                    .as_ref()
                    .is_none_or(|old| sequence.len() < old.len())
                {
                    report.shortest_witness_trace = Some(sequence.to_vec());
                }
            }
        }
        if let Some(label) = failed.filter(|_| !failed_recorded)
            && let Some(report) = self.reports.iter_mut().find(|r| r.property == label)
        {
            report.failures += 1;
            report.status = CoverageStatus::Violated;
            report.reason = Some("The behavioral property was violated".into());
        }
    }

    pub(super) fn summary(&self) -> CoverageSummary {
        let mut result = CoverageSummary {
            coverage: self.reports.clone(),
            ..CoverageSummary::default()
        };
        for report in &self.reports {
            match report.status {
                CoverageStatus::Verified => result.verified += 1,
                CoverageStatus::Unexercised => result.unexercised += 1,
                CoverageStatus::Violated => result.violated += 1,
            }
        }
        result
    }

    pub(super) fn complete(&self) -> bool {
        self.reports
            .iter()
            .all(|r| r.status == CoverageStatus::Verified)
    }

    pub(super) fn targets(&self) -> Vec<usize> {
        self.reports
            .iter()
            .enumerate()
            .filter_map(|(i, r)| (r.status == CoverageStatus::Unexercised).then_some(i))
            .collect()
    }

    pub(super) fn score(&self, index: usize, state: &Value, input: &Value) -> f64 {
        let Some(probe) = &self.plans[index] else {
            return 1.0;
        };
        let predicate = &self.predicates[probe.predicate];
        let slots = frame(predicate, [state, input, state]);
        score_route(
            &probe.route,
            &probe.witness,
            slots,
            predicate,
            &origins(&probe.route),
        )
    }

    pub(super) fn population_field(&self, index: usize, state: &Value) -> Option<String> {
        let probe = self.plans[index].as_ref()?;
        for step in &probe.route {
            if let Route::Bind(list, _) = step
                && let ExprKind::Field { base, name } = &list.kind
                && matches!(base.kind, ExprKind::Load(0) | ExprKind::Load(2))
                && state
                    .get(name)
                    .and_then(Value::as_array)
                    .is_some_and(Vec::is_empty)
            {
                return Some(name.clone());
            }
        }
        let Witness::Domain(expr, minimum, _) = &probe.witness else {
            return None;
        };
        let ExprKind::Field { base, name } = &expr.kind else {
            return None;
        };
        if matches!(base.kind, ExprKind::Load(0)) && state.get(name)?.as_array()?.len() < *minimum {
            Some(name.clone())
        } else {
            None
        }
    }
}

fn effects(contract: &Contract) -> Vec<Effect> {
    let mut result = Vec::new();
    for action in &contract.actions {
        for predicate in &action.postconditions {
            if let ExprKind::Binary {
                op: BinaryOp::Or,
                left,
                right,
            } = &predicate.expr.kind
                && !depends_on(left, 2, &BTreeMap::new())
                && depends_on(right, 2, &BTreeMap::new())
                && !is_preservation(right, &BTreeMap::new())
            {
                result.push(Effect {
                    action: action.name.clone(),
                    guard: normalize(left, true),
                    expected: *right.clone(),
                    slots: predicate.slots,
                });
            }
        }
    }
    result
}

fn numeric_input(expr: &Expr) -> bool {
    match &expr.kind {
        ExprKind::Field { base, .. } => {
            matches!(base.kind, ExprKind::Load(1)) && matches!(expr.ty, Type::Int | Type::Float)
        }
        ExprKind::Binary { left, right, .. } => numeric_input(left) || numeric_input(right),
        ExprKind::Unary { operand, .. } | ExprKind::Count(operand) => numeric_input(operand),
        ExprKind::Query { list, body, .. } => numeric_input(list) || numeric_input(body),
        _ => false,
    }
}

fn normalize(expr: &Expr, inverted: bool) -> Expr {
    match &expr.kind {
        ExprKind::Unary {
            op: UnaryOp::Not,
            operand,
        } => normalize(operand, !inverted),
        ExprKind::Literal(Value::Bool(value)) => {
            let mut result = expr.clone();
            result.kind = ExprKind::Literal(Value::Bool(*value ^ inverted));
            result
        }
        ExprKind::Binary {
            op: BinaryOp::Equal | BinaryOp::NotEqual,
            left,
            right,
        } if left.ty == Type::Bool => {
            let literal = match (&left.kind, &right.kind) {
                (ExprKind::Literal(Value::Bool(value)), _) => Some((*value, &**right)),
                (_, ExprKind::Literal(Value::Bool(value))) => Some((*value, &**left)),
                _ => None,
            };
            if let Some((value, operand)) = literal {
                let not_equal = matches!(
                    expr.kind,
                    ExprKind::Binary {
                        op: BinaryOp::NotEqual,
                        ..
                    }
                );
                normalize(operand, inverted ^ !value ^ not_equal)
            } else if inverted {
                negate(expr.clone())
            } else {
                expr.clone()
            }
        }
        ExprKind::Binary {
            op: BinaryOp::And | BinaryOp::Or,
            left,
            right,
        } => {
            let and = matches!(
                expr.kind,
                ExprKind::Binary {
                    op: BinaryOp::And,
                    ..
                }
            ) ^ inverted;
            let mut result = expr.clone();
            result.kind = ExprKind::Binary {
                op: if and { BinaryOp::And } else { BinaryOp::Or },
                left: Box::new(normalize(left, inverted)),
                right: Box::new(normalize(right, inverted)),
            };
            result
        }
        ExprKind::Query {
            op: QueryOp::Any | QueryOp::All,
            list,
            slot,
            body,
        } if inverted => {
            let mut result = expr.clone();
            let op = if matches!(
                expr.kind,
                ExprKind::Query {
                    op: QueryOp::Any,
                    ..
                }
            ) {
                QueryOp::All
            } else {
                QueryOp::Any
            };
            result.kind = ExprKind::Query {
                op,
                list: list.clone(),
                slot: *slot,
                body: Box::new(normalize(body, true)),
            };
            result
        }
        ExprKind::Query {
            op,
            list,
            slot,
            body,
        } => {
            let mut result = expr.clone();
            result.kind = ExprKind::Query {
                op: *op,
                list: list.clone(),
                slot: *slot,
                body: Box::new(normalize(body, false)),
            };
            if inverted { negate(result) } else { result }
        }
        _ => {
            if inverted {
                negate(expr.clone())
            } else {
                expr.clone()
            }
        }
    }
}

fn frame(predicate: &Predicate, contexts: [&Value; 3]) -> Vec<Option<Value>> {
    let mut slots = vec![None; predicate.slots.max(3)];
    for (slot, value) in contexts.into_iter().enumerate() {
        slots[slot] = Some(value.clone());
    }
    slots
}

fn route_matches(
    route: &[Route],
    witness: &Witness,
    mut slots: Vec<Option<Value>>,
    predicate: &Predicate,
) -> bool {
    match route.split_first() {
        Some((Route::Check(expr, wanted), tail)) => {
            evaluate(expr, &mut slots, predicate)
                .ok()
                .and_then(|v| v.as_bool())
                == Some(*wanted)
                && route_matches(tail, witness, slots, predicate)
        }
        Some((Route::Bind(list, slot), tail)) => {
            let Ok(Value::Array(items)) = evaluate(list, &mut slots, predicate) else {
                return false;
            };
            items.into_iter().any(|item| {
                let mut next = slots.clone();
                next[*slot] = Some(item);
                route_matches(tail, witness, next, predicate)
            })
        }
        None => witness_matches(witness, &mut slots, predicate),
    }
}

fn witness_matches(witness: &Witness, slots: &mut [Option<Value>], predicate: &Predicate) -> bool {
    match witness {
        Witness::Expression(expr) => {
            evaluate(expr, slots, predicate)
                .ok()
                .and_then(|v| v.as_bool())
                == Some(true)
        }
        Witness::Domain(expr, minimum, _) => evaluate(expr, slots, predicate)
            .ok()
            .and_then(|v| v.as_array().map(Vec::len))
            .is_some_and(|n| n >= *minimum),
        Witness::Partition(expr, fields, partition, _) => evaluate(expr, slots, predicate)
            .ok()
            .is_some_and(|v| partition_value(&v, fields, partition)),
    }
}

fn route_failure(
    route: &[Route],
    witness: &Witness,
    mut slots: Vec<Option<Value>>,
    predicate: &Predicate,
    origin: &BTreeMap<usize, usize>,
    invalid: bool,
) -> bool {
    match route.split_first() {
        Some((Route::Check(expr, wanted), tail)) => {
            let applicable = if depends_on(expr, 2, origin) {
                fitness(expr, *wanted, &mut slots, predicate, origin) >= 1.0
            } else {
                evaluate(expr, &mut slots, predicate)
                    .ok()
                    .and_then(|v| v.as_bool())
                    == Some(*wanted)
            };
            applicable && route_failure(tail, witness, slots, predicate, origin, invalid)
        }
        Some((Route::Bind(list, slot), tail)) => {
            let Ok(Value::Array(items)) = evaluate(list, &mut slots, predicate) else {
                return false;
            };
            items.into_iter().any(|item| {
                let mut next = slots.clone();
                next[*slot] = Some(item);
                route_failure(tail, witness, next, predicate, origin, invalid)
            })
        }
        None => {
            if matches!(witness, Witness::Partition(..))
                && !witness_matches(witness, &mut slots, predicate)
            {
                return false;
            }
            let expr = match witness {
                Witness::Expression(expr) => {
                    if invalid {
                        &predicate.expr
                    } else {
                        expr
                    }
                }
                Witness::Domain(_, _, expected) | Witness::Partition(_, _, _, expected) => expected,
            };
            evaluate(expr, &mut slots, predicate)
                .ok()
                .and_then(|v| v.as_bool())
                == Some(false)
        }
    }
}

fn partition_value(value: &Value, fields: &[String], partition: &Partition) -> bool {
    if let Value::Array(items) = value {
        return items.iter().any(|v| partition_value(v, fields, partition));
    }
    if let Some((field, tail)) = fields.split_first() {
        return value
            .get(field)
            .is_some_and(|v| partition_value(v, tail, partition));
    }
    match partition {
        Partition::Boolean(wanted) => value.as_bool() == Some(*wanted),
        Partition::Present(wanted) => value.is_null() != *wanted,
        Partition::Different(other) => value != other,
        Partition::Nonempty => value.as_str().is_some_and(|s| !s.is_empty()),
    }
}

impl Partition {
    fn description(&self) -> String {
        match self {
            Self::Boolean(value) => format!("is {value}"),
            Self::Present(value) => if *value { "is present" } else { "is null" }.into(),
            Self::Different(value) => format!("differs from {value}"),
            Self::Nonempty => "is nonempty".into(),
        }
    }
}

fn partition_types(
    ty: &Type,
    fields: Vec<String>,
    target: Option<&Value>,
    out: &mut Vec<(String, Vec<String>, Partition)>,
) {
    let prefix = fields.join(".");
    match ty {
        Type::Record(members) => {
            for member in members {
                let mut next = fields.clone();
                next.push(member.name.clone());
                partition_types(&member.ty, next, None, out);
            }
        }
        Type::List(inner) => partition_types(inner, fields, None, out),
        Type::Bool => {
            for value in [false, true] {
                out.push((
                    format!("{prefix}.bool.{value}"),
                    fields.clone(),
                    Partition::Boolean(value),
                ));
            }
        }
        Type::Optional(inner) => {
            for value in [false, true] {
                out.push((
                    format!("{prefix}.present.{value}"),
                    fields.clone(),
                    Partition::Present(value),
                ));
            }
            partition_types(inner, fields, None, out);
        }
        Type::Int | Type::Float => out.push((
            format!("{prefix}.nondefault"),
            fields,
            Partition::Different(target.cloned().unwrap_or_else(|| {
                if *ty == Type::Float {
                    Value::from(0.0)
                } else {
                    Value::from(0)
                }
            })),
        )),
        Type::String => out.push((format!("{prefix}.nonempty"), fields, Partition::Nonempty)),
        Type::Null => {}
    }
}

fn origins(route: &[Route]) -> BTreeMap<usize, usize> {
    let mut result = BTreeMap::from([(0, 0), (1, 1), (2, 2)]);
    for step in route {
        if let Route::Bind(list, slot) = step {
            let origin = if depends_on(list, 0, &result) {
                0
            } else if depends_on(list, 2, &result) {
                2
            } else {
                1
            };
            result.insert(*slot, origin);
        }
    }
    result
}

pub(super) fn depends_on(expr: &Expr, root: usize, origins: &BTreeMap<usize, usize>) -> bool {
    match &expr.kind {
        ExprKind::Load(slot) => origins.get(slot).copied().unwrap_or(*slot) == root,
        ExprKind::Field { base, .. }
        | ExprKind::Count(base)
        | ExprKind::Unary { operand: base, .. } => depends_on(base, root, origins),
        ExprKind::Binary { left, right, .. } => {
            depends_on(left, root, origins) || depends_on(right, root, origins)
        }
        ExprKind::Query {
            list, body, slot, ..
        } => {
            let mut nested = origins.clone();
            let origin = if depends_on(list, 0, origins) {
                0
            } else if depends_on(list, 2, origins) {
                2
            } else {
                1
            };
            nested.insert(*slot, origin);
            depends_on(list, root, origins) || depends_on(body, root, &nested)
        }
        ExprKind::Literal(_) => false,
    }
}

fn before_equivalent(expr: &Expr, route: &[Route]) -> Option<Expr> {
    let mut result = expr.clone();
    match &mut result.kind {
        ExprKind::Load(slot) if *slot == 2 => *slot = 0,
        ExprKind::Load(slot) => {
            let source = origins(route);
            if source.get(slot) != Some(&2) {
                return None;
            }
            let found = route.iter().rev().find_map(|step| match step {
                Route::Bind(list, candidate) if source.get(candidate) == Some(&0) => {
                    if let Type::List(inner) = &list.ty {
                        (inner.as_ref() == &expr.ty).then_some(*candidate)
                    } else {
                        None
                    }
                }
                _ => None,
            })?;
            *slot = found;
        }
        ExprKind::Field { base, .. } => **base = before_equivalent(base, route)?,
        _ => return None,
    }
    Some(result)
}

fn describe(route: &[Route], expr: &Expr) -> String {
    let conditions = route
        .iter()
        .map(|step| match step {
            Route::Check(expr, value) => format!("{} = {value}", render(expr)),
            Route::Bind(list, slot) => format!("member $ {slot} exists in {}", render(list)),
        })
        .collect::<Vec<_>>();
    if conditions.is_empty() {
        format!("evaluate {} successfully", render(expr))
    } else {
        format!(
            "{}; evaluate {} successfully",
            conditions.join("; "),
            render(expr)
        )
    }
}

pub(super) fn render(expr: &Expr) -> String {
    match &expr.kind {
        ExprKind::Literal(value) => value.to_string(),
        ExprKind::Load(slot) => match slot {
            0 => "before".into(),
            1 => "input".into(),
            2 => "after".into(),
            _ => format!("$ {slot}"),
        },
        ExprKind::Field { base, name } => format!("{}.{name}", render(base)),
        ExprKind::Unary { op, operand } => format!(
            "{}({})",
            if *op == UnaryOp::Not { "not" } else { "-" },
            render(operand)
        ),
        ExprKind::Binary { op, left, right } => format!(
            "({} {} {})",
            render(left),
            match op {
                BinaryOp::Equal => "==",
                BinaryOp::NotEqual => "!=",
                BinaryOp::Less => "<",
                BinaryOp::LessEqual => "<=",
                BinaryOp::Greater => ">",
                BinaryOp::GreaterEqual => ">=",
                BinaryOp::And => "and",
                BinaryOp::Or => "or",
                BinaryOp::Add => "+",
                BinaryOp::Subtract => "-",
            },
            render(right)
        ),
        ExprKind::Count(list) => format!("count({})", render(list)),
        ExprKind::Query {
            op,
            list,
            slot,
            body,
        } => format!("{op:?}({}, $ {slot} => {})", render(list), render(body)),
    }
}

fn boolean(value: bool) -> Expr {
    Expr {
        kind: ExprKind::Literal(Value::Bool(value)),
        ty: Type::Bool,
        span: crate::diagnostic::Span {
            start: 0,
            end: 0,
            line: 1,
            column: 1,
        },
    }
}

fn negate(expr: Expr) -> Expr {
    Expr {
        span: expr.span,
        ty: Type::Bool,
        kind: ExprKind::Unary {
            op: UnaryOp::Not,
            operand: Box::new(expr),
        },
    }
}

fn guard_atoms(expr: &Expr, path: &mut Vec<usize>, out: &mut Vec<(Vec<usize>, Expr)>) {
    match &expr.kind {
        ExprKind::Binary {
            op: BinaryOp::And,
            left,
            right,
        } => {
            path.push(0);
            guard_atoms(left, path, out);
            path.pop();
            path.push(1);
            guard_atoms(right, path, out);
            path.pop();
        }
        ExprKind::Query {
            op: QueryOp::Any,
            body,
            ..
        } => {
            path.push(2);
            guard_atoms(body, path, out);
            path.pop();
        }
        _ => out.push((path.clone(), expr.clone())),
    }
}

fn is_preservation(expr: &Expr, origin: &BTreeMap<usize, usize>) -> bool {
    let ExprKind::Binary {
        op: BinaryOp::Equal,
        left,
        right,
    } = &expr.kind
    else {
        return false;
    };
    let states = (depends_on(left, 0, origin) && depends_on(right, 2, origin))
        || (depends_on(left, 2, origin) && depends_on(right, 0, origin));
    fn path(expr: &Expr) -> Option<Vec<String>> {
        match &expr.kind {
            ExprKind::Load(_) => Some(Vec::new()),
            ExprKind::Field { base, name } => {
                let mut p = path(base)?;
                p.push(name.clone());
                Some(p)
            }
            _ => None,
        }
    }
    states && path(left).is_some() && path(left) == path(right)
}

fn is_identity(expr: &Expr) -> bool {
    let ExprKind::Binary {
        op: BinaryOp::Equal,
        left,
        right,
    } = &expr.kind
    else {
        return false;
    };
    [(&**left,&**right),(&**right,&**left)].into_iter().any(|(field,input)| {
        matches!(&field.kind, ExprKind::Field { name, .. } if name == "id" || name.ends_with("_id"))
            && depends_on(input,1,&BTreeMap::new())
    })
}

fn is_owner_match(expr: &Expr) -> bool {
    let ExprKind::Binary {
        op: BinaryOp::Equal,
        left,
        right,
    } = &expr.kind
    else {
        return false;
    };
    !is_identity(expr)
        && (depends_on(left, 1, &BTreeMap::new()) || depends_on(right, 1, &BTreeMap::new()))
        && matches!(left.ty, Type::String | Type::Optional(_))
}

fn is_boolean_test(expr: &Expr) -> bool {
    matches!(&expr.kind, ExprKind::Field { .. } if expr.ty == Type::Bool)
        || matches!(&expr.kind, ExprKind::Unary { op: UnaryOp::Not, operand } if matches!(operand.kind, ExprKind::Field { .. }) && operand.ty == Type::Bool)
}

fn state_numeric(expr: &Expr) -> bool {
    match &expr.kind {
        ExprKind::Binary {
            op:
                BinaryOp::Equal
                | BinaryOp::NotEqual
                | BinaryOp::Less
                | BinaryOp::LessEqual
                | BinaryOp::Greater
                | BinaryOp::GreaterEqual,
            left,
            ..
        } => matches!(left.ty, Type::Int | Type::Float) && has_observation(expr),
        _ => false,
    }
}

fn has_observation(expr: &Expr) -> bool {
    match &expr.kind {
        ExprKind::Load(slot) => *slot != 1,
        ExprKind::Field { base, .. }
        | ExprKind::Unary { operand: base, .. }
        | ExprKind::Count(base) => has_observation(base),
        ExprKind::Binary { left, right, .. } => has_observation(left) || has_observation(right),
        ExprKind::Query { list, body, .. } => has_observation(list) || has_observation(body),
        ExprKind::Literal(_) => false,
    }
}

fn input_relation(expr: &Expr) -> bool {
    matches!(&expr.kind, ExprKind::Binary { op: BinaryOp::Equal | BinaryOp::NotEqual, left, right }
        if matches!(&left.kind, ExprKind::Field { base, .. } if matches!(base.kind, ExprKind::Load(1)))
        && matches!(&right.kind, ExprKind::Field { base, .. } if matches!(base.kind, ExprKind::Load(1))))
}

fn fault_guard(expr: &Expr, selected: &[usize], atom: &Expr) -> Expr {
    if selected.is_empty() {
        return negate(expr.clone());
    }
    let mut result = expr.clone();
    match &mut result.kind {
        ExprKind::Binary {
            op: BinaryOp::And,
            left,
            right,
        } => {
            if selected[0] == 0 {
                **left = fault_guard(left, &selected[1..], atom);
                **right = retain_context(right, atom);
            } else {
                **right = fault_guard(right, &selected[1..], atom);
                **left = retain_context(left, atom);
            }
        }
        ExprKind::Query { body, .. } => **body = fault_guard(body, &selected[1..], atom),
        _ => {}
    }
    result
}

fn retain_context(expr: &Expr, atom: &Expr) -> Expr {
    if is_owner_match(atom) {
        return expr.clone();
    }
    if (is_boolean_test(atom) || input_relation(atom)) && state_numeric(expr) {
        return boolean(true);
    }
    let absent = matches!(&atom.kind, ExprKind::Binary { op: BinaryOp::NotEqual, left, right } if left.ty != Type::Bool && (matches!(left.kind,ExprKind::Literal(Value::Null)) || matches!(right.kind,ExprKind::Literal(Value::Null))));
    if absent && (is_owner_match(expr) || state_numeric(expr) || is_boolean_test(expr)) {
        return boolean(true);
    }
    let mut result = expr.clone();
    match &mut result.kind {
        ExprKind::Binary {
            op: BinaryOp::And | BinaryOp::Or,
            left,
            right,
        } => {
            **left = retain_context(left, atom);
            **right = retain_context(right, atom);
        }
        ExprKind::Query { body, .. } => **body = retain_context(body, atom),
        _ => {}
    }
    result
}

fn missing_identity(expr: &Expr, selected: &[usize], atom: &Expr) -> Expr {
    if selected.is_empty() {
        return negate(atom.clone());
    }
    if let ExprKind::Query { list, slot, .. } = &expr.kind
        && selected.first() == Some(&2)
        && depends_on(atom, *slot, &BTreeMap::new())
    {
        return negate(Expr {
            ty: Type::Bool,
            span: expr.span,
            kind: ExprKind::Query {
                op: QueryOp::Any,
                list: list.clone(),
                slot: *slot,
                body: Box::new(atom.clone()),
            },
        });
    }
    let mut result = expr.clone();
    if let ExprKind::Query { body, .. } = &mut result.kind
        && selected.first() == Some(&2)
    {
        **body = missing_identity(body, &selected[1..], atom);
    }
    if let ExprKind::Binary {
        op: BinaryOp::And,
        left,
        right,
    } = &mut result.kind
    {
        if selected.first() == Some(&0) {
            **left = missing_identity(left, &selected[1..], atom);
        } else if selected.first() == Some(&1) {
            **right = missing_identity(right, &selected[1..], atom);
        }
    }
    result
}

fn score_route(
    route: &[Route],
    witness: &Witness,
    mut slots: Vec<Option<Value>>,
    predicate: &Predicate,
    origin: &BTreeMap<usize, usize>,
) -> f64 {
    match route.split_first() {
        Some((Route::Check(expr, wanted), tail)) => {
            let a = fitness(expr, *wanted, &mut slots, predicate, origin);
            let b = score_route(tail, witness, slots, predicate, origin);
            (a + b) / 2.0
        }
        Some((Route::Bind(list, slot), tail)) => {
            let Ok(Value::Array(items)) = evaluate(list, &mut slots, predicate) else {
                return 0.0;
            };
            items
                .into_iter()
                .map(|item| {
                    let mut next = slots.clone();
                    next[*slot] = Some(item);
                    score_route(tail, witness, next, predicate, origin)
                })
                .fold(0.0, f64::max)
        }
        None => match witness {
            Witness::Partition(..) | Witness::Domain(..) => {
                if witness_matches(witness, &mut slots, predicate) {
                    1.0
                } else {
                    0.0
                }
            }
            Witness::Expression(expr) => fitness(expr, true, &mut slots, predicate, origin),
        },
    }
}

pub(super) fn fitness(
    expr: &Expr,
    wanted: bool,
    slots: &mut [Option<Value>],
    predicate: &Predicate,
    origin: &BTreeMap<usize, usize>,
) -> f64 {
    match &expr.kind {
        ExprKind::Binary {
            op: BinaryOp::And,
            left,
            right,
        } => {
            let a = fitness(left, wanted, slots, predicate, origin);
            let b = fitness(right, wanted, slots, predicate, origin);
            if wanted { (a + b) / 2.0 } else { a.max(b) }
        }
        ExprKind::Binary {
            op: BinaryOp::Or,
            left,
            right,
        } => {
            let a = fitness(left, wanted, slots, predicate, origin);
            let b = fitness(right, wanted, slots, predicate, origin);
            if wanted { a.max(b) } else { (a + b) / 2.0 }
        }
        ExprKind::Unary {
            op: UnaryOp::Not,
            operand,
        } => fitness(operand, !wanted, slots, predicate, origin),
        ExprKind::Query {
            op,
            list,
            slot,
            body,
        } => {
            let Ok(Value::Array(items)) = evaluate(list, slots, predicate) else {
                return 0.0;
            };
            let previous = slots[*slot].clone();
            let mut nested = origin.clone();
            nested.insert(*slot, if depends_on(list, 2, origin) { 2 } else { 0 });
            let scores = items
                .into_iter()
                .map(|item| {
                    slots[*slot] = Some(item);
                    fitness(body, wanted, slots, predicate, &nested)
                })
                .collect::<Vec<_>>();
            slots[*slot] = previous;
            if (*op == QueryOp::Any) == wanted {
                scores.into_iter().fold(0.0, f64::max)
            } else if scores.is_empty() {
                1.0
            } else {
                scores.iter().sum::<f64>() / scores.len() as f64
            }
        }
        _ if depends_on(expr, 2, origin) => 1.0,
        _ => {
            if evaluate(expr, slots, predicate)
                .ok()
                .and_then(|v| v.as_bool())
                == Some(wanted)
            {
                return 1.0;
            }
            if let ExprKind::Binary { op, left, right } = &expr.kind
                && ((*op == BinaryOp::Equal && wanted) || (*op == BinaryOp::NotEqual && !wanted))
                && let (Ok(a), Ok(b)) = (
                    evaluate(left, slots, predicate),
                    evaluate(right, slots, predicate),
                )
                && let (Some(a), Some(b)) = (a.as_f64(), b.as_f64())
            {
                return 0.5 / (1.0 + (a - b).abs());
            }
            0.0
        }
    }
}

fn obligation(
    id: String,
    property: &str,
    action: Option<&str>,
    location: Option<crate::diagnostic::Location>,
    description: String,
) -> CoverageObligation {
    CoverageObligation {
        id,
        property: property.into(),
        action: action.map(str::to_owned),
        location,
        required_witness: description.clone(),
        status: CoverageStatus::Unexercised,
        evaluations: 0,
        witnesses: 0,
        passes: 0,
        failures: 0,
        first_witness_action: None,
        first_witness_ms: None,
        first_witness_trace: None,
        shortest_witness_trace: None,
        reason: Some(format!("No successful meaningful witness: {description}")),
    }
}
