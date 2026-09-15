use super::{CandidatePools, SplitMix64, collect_record, generate_value, push_unique};
use crate::ir::{Action, BinaryOp, Contract, Expr, ExprKind, MAX_INT, Type};
use crate::report::{Call, VerifyError};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(in crate::verify) struct Guidance {
    pub(in crate::verify) literals: Vec<(Type, Value)>,
    relations: BTreeMap<(String, String), String>,
    schema: Vec<crate::ir::Field>,
    identities: BTreeSet<String>,
}

impl Guidance {
    pub(in crate::verify) fn new(contract: &Contract) -> Self {
        let mut result = Self {
            literals: Vec::new(),
            relations: BTreeMap::new(),
            schema: contract.state.clone(),
            identities: BTreeSet::new(),
        };
        for action in &contract.actions {
            for predicate in &action.postconditions {
                result.mine(&predicate.expr, Some(&action.name));
            }
        }
        for predicate in &contract.invariants {
            result.mine(&predicate.expr, None);
        }
        result
    }

    fn mine(&mut self, expr: &Expr, action: Option<&str>) {
        match &expr.kind {
            ExprKind::Literal(value) => {
                if matches!(expr.ty, Type::Int | Type::Float | Type::String | Type::Bool) {
                    self.literal(expr.ty.clone(), value.clone());
                    if expr.ty == Type::Int
                        && let Some(n) = value.as_i64()
                    {
                        for v in [n.checked_sub(1), n.checked_add(1)]
                            .into_iter()
                            .flatten()
                            .filter(|v| (-MAX_INT..=MAX_INT).contains(v))
                        {
                            self.literal(Type::Int, Value::from(v));
                        }
                    }
                    if expr.ty == Type::Float
                        && let Some(n) = value.as_f64()
                    {
                        for v in [n - 1.0, n + 1.0].into_iter().filter(|v| v.is_finite()) {
                            self.literal(Type::Float, Value::from(v));
                        }
                    }
                }
            }
            ExprKind::Binary { op, left, right } => {
                if *op == BinaryOp::Equal
                    && let Some(action) = action
                {
                    for (input, observed) in [(&**left, &**right), (&**right, &**left)] {
                        if let ExprKind::Field {
                            base,
                            name: parameter,
                        } = &input.kind
                            && matches!(base.kind, ExprKind::Load(1))
                            && let ExprKind::Field { name: field, .. } = &observed.kind
                        {
                            self.relations
                                .entry((action.into(), parameter.clone()))
                                .or_insert_with(|| field.clone());
                        }
                    }
                }
                self.mine(left, action);
                self.mine(right, action);
            }
            ExprKind::Field { base, .. }
            | ExprKind::Count(base)
            | ExprKind::Unary { operand: base, .. } => self.mine(base, action),
            ExprKind::Query { op, list, body, .. } => {
                if *op == crate::ir::QueryOp::Unique
                    && let ExprKind::Field { name, .. } = &body.kind
                {
                    self.identities.insert(name.clone());
                }
                self.mine(list, action);
                self.mine(body, action);
            }
            ExprKind::Load(_) => {}
        }
    }

    fn literal(&mut self, ty: Type, value: Value) {
        if !self.literals.iter().any(|(t, v)| *t == ty && *v == value) {
            self.literals.push((ty, value));
        }
    }

    pub(in crate::verify) fn candidate(
        &self,
        action: &Action,
        state: &Value,
        rng: &mut SplitMix64,
    ) -> Result<Call, VerifyError> {
        let mut records = Vec::new();
        collect_records(state, &mut records);
        let mut pools = CandidatePools::default();
        collect_record(state, &self.schema, &mut pools);
        let mut primary = None;
        let mut args = Vec::new();
        for parameter in &action.params {
            let field = self
                .relations
                .get(&(action.name.clone(), parameter.name.clone()))
                .unwrap_or(&parameter.name);
            let identity =
                field == "id" || field.ends_with("_id") || self.identities.contains(field);
            let matching: Vec<_> = records
                .iter()
                .enumerate()
                .filter(|(_, r)| r.get(field).is_some_and(|v| compatible(v, &parameter.ty)))
                .collect();
            let category = rng.sample_below_rejecting_modulo_bias(10);
            let value = if identity && !matching.is_empty() {
                if category < 9 {
                    let (index, record) =
                        matching[rng.sample_below_rejecting_modulo_bias(matching.len())];
                    if primary.is_none() {
                        primary = Some(index);
                    }
                    record[field].clone()
                } else {
                    self.wrong(&parameter.ty, &pools, rng)?
                }
            } else if matches!(parameter.ty, Type::String | Type::Optional(_))
                && let Some(record) = primary.and_then(|i| records.get(i))
                && let Some(value) = record.get(field).filter(|v| compatible(v, &parameter.ty))
            {
                if category < 8 {
                    value.clone()
                } else {
                    different(value, &parameter.ty)
                }
            } else if matches!(parameter.ty, Type::Int | Type::Float) && category < 6 {
                let values: Vec<_> = self
                    .literals
                    .iter()
                    .filter(|(ty, _)| *ty == parameter.ty)
                    .collect();
                if values.is_empty() {
                    generate_value(&parameter.ty, &pools, rng)?
                } else {
                    values[rng.sample_below_rejecting_modulo_bias(values.len())]
                        .1
                        .clone()
                }
            } else if matches!(parameter.ty, Type::String | Type::Bool)
                && category < 2
                && self.literals.iter().any(|(ty, _)| *ty == parameter.ty)
            {
                let values: Vec<_> = self
                    .literals
                    .iter()
                    .filter(|(ty, _)| *ty == parameter.ty)
                    .collect();
                values[rng.sample_below_rejecting_modulo_bias(values.len())]
                    .1
                    .clone()
            } else if !matching.is_empty() && category < 5 {
                matching[rng.sample_below_rejecting_modulo_bias(matching.len())].1[field].clone()
            } else {
                generate_value(&parameter.ty, &pools, rng)?
            };
            args.push(value);
        }
        Ok(Call {
            action: action.name.clone(),
            args,
        })
    }

    fn wrong(
        &self,
        ty: &Type,
        pools: &CandidatePools,
        rng: &mut SplitMix64,
    ) -> Result<Value, VerifyError> {
        let mut value = generate_value(ty, pools, rng)?;
        for _ in 0..(pools.strings.len() + pools.integers.len() + 2) {
            let exists = match ty {
                Type::String => pools.strings.contains(&value),
                Type::Int => pools.integers.contains(&value),
                _ => false,
            };
            if !exists {
                break;
            }
            value = different(&value, ty);
        }
        Ok(value)
    }

    pub(in crate::verify) fn growing_candidate(
        &self,
        action: &Action,
        state: &Value,
        rng: &mut SplitMix64,
    ) -> Result<Call, VerifyError> {
        let mut call = self.candidate(action, state, rng)?;
        let mut pools = CandidatePools::default();
        collect_record(state, &self.schema, &mut pools);
        for (index, parameter) in action.params.iter().enumerate() {
            let field = self
                .relations
                .get(&(action.name.clone(), parameter.name.clone()))
                .unwrap_or(&parameter.name);
            if self.identities.contains(field) {
                call.args[index] = self.wrong(&parameter.ty, &pools, rng)?;
            }
        }
        Ok(call)
    }

    pub(in crate::verify) fn signature(&self, state: &Value) -> String {
        let mut strings = Vec::new();
        self.signature_value(state, &mut strings).to_string()
    }

    fn signature_value(&self, value: &Value, strings: &mut Vec<Value>) -> Value {
        match value {
            Value::Object(object) => Value::Object(
                object
                    .iter()
                    .map(|(k, v)| (k.clone(), self.signature_value(v, strings)))
                    .collect(),
            ),
            Value::Array(items) => Value::Array(
                items
                    .iter()
                    .map(|v| self.signature_value(v, strings))
                    .collect(),
            ),
            Value::String(s) => {
                if self
                    .literals
                    .iter()
                    .any(|(ty, literal)| *ty == Type::String && literal == value)
                {
                    return Value::String(format!("literal:{value}"));
                }
                if s.is_empty() {
                    return Value::String("empty".into());
                }
                push_unique(strings, value);
                Value::String(format!(
                    "string:{}",
                    strings.iter().position(|v| v == value).unwrap()
                ))
            }
            Value::Number(n) => {
                let v = n.as_f64().unwrap_or_default();
                let mut values: Vec<_> = self
                    .literals
                    .iter()
                    .filter_map(|(_, v)| v.as_f64())
                    .collect();
                values.sort_by(f64::total_cmp);
                values.dedup();
                if let Some(index) = values.iter().position(|n| *n == v) {
                    Value::String(format!("equal:{index}"))
                } else {
                    Value::String(format!("region:{}", values.partition_point(|n| *n < v)))
                }
            }
            _ => value.clone(),
        }
    }
}

fn compatible(value: &Value, ty: &Type) -> bool {
    match ty {
        Type::Bool => value.is_boolean(),
        Type::Int => value.as_i64().is_some(),
        Type::Float => value.is_f64(),
        Type::String => value.is_string(),
        Type::Optional(inner) => value.is_null() || compatible(value, inner),
        _ => false,
    }
}

fn different(value: &Value, ty: &Type) -> Value {
    match (value, ty) {
        (Value::String(s), _) => Value::String(format!("{s}~")),
        (Value::Bool(b), _) => Value::Bool(!b),
        (_, Type::Int) => Value::from(if value.as_i64() == Some(MAX_INT) {
            -MAX_INT
        } else {
            value.as_i64().unwrap_or_default() + 1
        }),
        (_, Type::Float) => Value::from(if value.as_f64() == Some(0.0) {
            1.0
        } else {
            0.0
        }),
        (_, Type::Optional(inner)) => {
            if value.is_null() {
                different(value, inner)
            } else {
                Value::Null
            }
        }
        (_, Type::String) => Value::String("x".into()),
        (_, Type::Bool) => Value::Bool(true),
        _ => Value::Null,
    }
}

fn collect_records<'a>(value: &'a Value, records: &mut Vec<&'a Map<String, Value>>) {
    match value {
        Value::Object(object) => {
            records.push(object);
            for value in object.values() {
                collect_records(value, records);
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_records(value, records);
            }
        }
        _ => {}
    }
}
