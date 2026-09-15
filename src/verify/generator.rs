use crate::diagnostic::{Diagnostic, Location};
use crate::ir::{Contract, Field, MAX_INT, Type};
use crate::report::{Call, VerifyError};
use serde_json::Value;
mod guidance;
pub(super) use guidance::Guidance;

#[cfg(test)]
mod tests;

pub(super) struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub(super) fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e3779b97f4a7c15);
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
        value ^ (value >> 31)
    }

    pub(super) fn sample_below_rejecting_modulo_bias(&mut self, bound: usize) -> usize {
        let bound = bound as u64;
        let acceptance_zone = u64::MAX - u64::MAX % bound;
        loop {
            let value = self.next_u64();
            if value < acceptance_zone {
                return (value % bound) as usize;
            }
        }
    }
}

#[derive(Default)]
struct CandidatePools {
    booleans: Vec<Value>,
    integers: Vec<Value>,
    floats: Vec<Value>,
    strings: Vec<Value>,
}

pub(super) fn generate_call(
    contract: &Contract,
    observation: &Value,
    rng: &mut SplitMix64,
) -> Result<Call, VerifyError> {
    let action = &contract.actions[rng.sample_below_rejecting_modulo_bias(contract.actions.len())];
    let mut pools = CandidatePools::default();
    collect_record(observation, &contract.state, &mut pools);
    let mut args = Vec::with_capacity(action.params.len());
    for parameter in &action.params {
        args.push(generate_value(&parameter.ty, &pools, rng)?);
    }
    Ok(Call {
        action: action.name.clone(),
        args,
    })
}

fn collect_record(value: &Value, fields: &[Field], pools: &mut CandidatePools) {
    let Some(object) = value.as_object() else {
        return;
    };
    for field in fields {
        if let Some(value) = object.get(&field.name) {
            collect_value(value, &field.ty, pools);
        }
    }
}

fn collect_value(value: &Value, ty: &Type, pools: &mut CandidatePools) {
    match ty {
        Type::Bool if value.is_boolean() => push_unique(&mut pools.booleans, value),
        Type::Int if value.as_i64().is_some() => push_unique(&mut pools.integers, value),
        Type::Float => {
            if let Some(number) = value
                .as_f64()
                .filter(|number| number.is_finite())
                .and_then(serde_json::Number::from_f64)
            {
                push_unique(&mut pools.floats, &Value::Number(number));
            }
        }
        Type::Optional(inner) if !value.is_null() => collect_value(value, inner, pools),
        Type::String if value.is_string() => push_unique(&mut pools.strings, value),
        Type::List(item_type) => {
            if let Some(items) = value.as_array() {
                for item in items {
                    collect_value(item, item_type, pools);
                }
            }
        }
        Type::Record(fields) => collect_record(value, fields, pools),
        Type::Bool | Type::Int | Type::String | Type::Null | Type::Optional(_) => {}
    }
}

fn push_unique(values: &mut Vec<Value>, value: &Value) {
    if !values.contains(value) {
        values.push(value.clone());
    }
}

fn generate_value(
    ty: &Type,
    pools: &CandidatePools,
    rng: &mut SplitMix64,
) -> Result<Value, VerifyError> {
    if let Type::Optional(inner) = ty {
        if !inner.is_scalar() {
            return Err(parameter_error());
        }
        return if rng.sample_below_rejecting_modulo_bias(4) == 0 {
            Ok(Value::Null)
        } else {
            generate_value(inner, pools, rng)
        };
    }
    let observed = match ty {
        Type::Bool => &pools.booleans,
        Type::Int => &pools.integers,
        Type::Float => &pools.floats,
        Type::String => &pools.strings,
        Type::List(_) | Type::Record(_) | Type::Null | Type::Optional(_) => {
            return Err(parameter_error());
        }
    };
    let category = if observed.is_empty() {
        rng.sample_below_rejecting_modulo_bias(2) + 2
    } else {
        rng.sample_below_rejecting_modulo_bias(4)
    };
    if category < 2 {
        return Ok(observed[rng.sample_below_rejecting_modulo_bias(observed.len())].clone());
    }
    if category == 2 {
        return Ok(boundary_value(ty, rng));
    }
    Ok(random_value(ty, rng))
}

fn boundary_value(ty: &Type, rng: &mut SplitMix64) -> Value {
    match ty {
        Type::Bool => Value::Bool(rng.sample_below_rejecting_modulo_bias(2) == 1),
        Type::Int => {
            let values = [0, 1, -1, MAX_INT, -MAX_INT];
            Value::from(values[rng.sample_below_rejecting_modulo_bias(values.len())])
        }
        Type::String => {
            let values = ["", "a", " ", "\"\\\n", "é"];
            Value::String(values[rng.sample_below_rejecting_modulo_bias(values.len())].into())
        }
        Type::Float => {
            let values = [0.0, 1.0, -1.0, f64::MAX, -f64::MAX];
            Value::from(values[rng.sample_below_rejecting_modulo_bias(values.len())])
        }
        Type::List(_) | Type::Record(_) | Type::Optional(_) | Type::Null => unreachable!(),
    }
}

fn random_value(ty: &Type, rng: &mut SplitMix64) -> Value {
    match ty {
        Type::Bool => Value::Bool(rng.sample_below_rejecting_modulo_bias(2) == 1),
        Type::Int => Value::from(rng.sample_below_rejecting_modulo_bias(33) as i64 - 16),
        Type::Float => {
            Value::from(rng.sample_below_rejecting_modulo_bias(32_001) as f64 / 1000.0 - 16.0)
        }
        Type::String => {
            let length = rng.sample_below_rejecting_modulo_bias(6);
            let mut value = String::with_capacity(length);
            for _ in 0..length {
                value.push((b'a' + rng.sample_below_rejecting_modulo_bias(26) as u8) as char);
            }
            Value::String(value)
        }
        Type::List(_) | Type::Record(_) | Type::Optional(_) | Type::Null => unreachable!(),
    }
}

fn parameter_error() -> VerifyError {
    VerifyError::Contract(Diagnostic {
        location: Location {
            file: "<contract>".into(),
            line: 1,
            column: 1,
        },
        code: "BLA-RUN-PARAM".into(),
        message: "generated action parameters must be scalar or optional scalar".into(),
    })
}
