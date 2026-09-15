use super::*;
use crate::ir::{Action, ActionKind};
use serde_json::{Number, json};

fn field(name: &str, ty: Type) -> Field {
    Field {
        name: name.into(),
        ty,
    }
}

fn contract(state: Vec<Field>, params: Vec<Field>) -> Contract {
    Contract {
        state,
        actions: vec![Action {
            name: "exercise".into(),
            kind: ActionKind::Application,
            params,
            postconditions: Vec::new(),
        }],
        invariants: Vec::new(),
    }
}

fn generate_calls(contract: &Contract, observation: &Value, seed: u64, count: usize) -> Vec<Call> {
    let mut rng = SplitMix64::new(seed);
    (0..count)
        .map(|_| generate_call(contract, observation, &mut rng).unwrap())
        .collect()
}

fn float(value: f64) -> Value {
    Value::Number(Number::from_f64(value).unwrap())
}

fn full_scalar_contract() -> Contract {
    contract(
        Vec::new(),
        vec![
            field("flag", Type::Bool),
            field("count", Type::Int),
            field("ratio", Type::Float),
            field("text", Type::String),
            field("maybe_count", Type::Optional(Box::new(Type::Int))),
        ],
    )
}

#[test]
fn identical_seeds_generate_identical_512_call_sequences() {
    let contract = full_scalar_contract();
    let observation = json!({});

    let first = generate_calls(&contract, &observation, 41, 512);
    let second = generate_calls(&contract, &observation, 41, 512);

    assert_eq!(first, second);
}

#[test]
fn different_seeds_generate_different_sequences() {
    let contract = full_scalar_contract();
    let observation = json!({});

    let first = generate_calls(&contract, &observation, 41, 512);
    let second = generate_calls(&contract, &observation, 42, 512);

    assert_ne!(first, second);
}

#[test]
fn four_thousand_ninety_six_calls_cover_boundaries_random_values_and_json_types() {
    let contract = full_scalar_contract();
    let calls = generate_calls(&contract, &json!({}), 7, 4096);
    let mut booleans = Vec::new();
    let mut integers = Vec::new();
    let mut floats = Vec::new();
    let mut strings = Vec::new();

    for call in calls {
        assert_eq!(call.action, "exercise");
        assert_eq!(call.args.len(), 5);
        booleans.push(call.args[0].as_bool().unwrap());
        integers.push(call.args[1].as_i64().unwrap());
        assert!(call.args[2].as_i64().is_none());
        let generated_float = call.args[2].as_f64().unwrap();
        assert!(generated_float.is_finite());
        floats.push(generated_float);
        strings.push(call.args[3].as_str().unwrap().to_owned());
        assert!(call.args[4].is_null() || call.args[4].as_i64().is_some());
    }

    assert!(booleans.contains(&false));
    assert!(booleans.contains(&true));
    for boundary in [0, 1, -1, MAX_INT, -MAX_INT] {
        assert!(integers.contains(&boundary));
    }
    assert!(integers.iter().any(|value| (2..=16).contains(value)));
    for boundary in [0.0, 1.0, -1.0, f64::MAX, -f64::MAX] {
        assert!(floats.contains(&boundary));
    }
    assert!(floats.iter().any(|value| {
        value.abs() < 16.0 && ![0.0, 1.0, -1.0].contains(value) && value.fract() != 0.0
    }));
    for boundary in ["", "a", " ", "\"\\\n", "é"] {
        assert!(strings.iter().any(|value| value == boundary));
    }
    assert!(
        strings.iter().any(|value| {
            value.len() >= 2 && value.bytes().all(|byte| byte.is_ascii_lowercase())
        })
    );
}

#[test]
fn nested_observations_are_reused_by_compatible_type_across_field_names() {
    let state = vec![field(
        "source",
        Type::List(Box::new(Type::Record(vec![
            field("enabled", Type::Bool),
            field("identifier", Type::Int),
            field("measurement", Type::Float),
            field("label", Type::Optional(Box::new(Type::String))),
            field("absent", Type::Optional(Box::new(Type::Int))),
        ]))),
    )];
    let contract = contract(
        state,
        vec![
            field("different_bool_name", Type::Bool),
            field("different_int_name", Type::Int),
            field("different_float_name", Type::Float),
            field("different_string_name", Type::String),
        ],
    );
    let int_sentinel = MAX_INT - 7;
    let float_sentinel = 12_345.25;
    let string_sentinel = "observed sentinel";
    let observation = json!({
        "source": [{
            "enabled": true,
            "identifier": int_sentinel,
            "measurement": float_sentinel,
            "label": string_sentinel,
            "absent": null
        }]
    });
    let mut pools = CandidatePools::default();

    collect_record(&observation, &contract.state, &mut pools);

    assert_eq!(pools.booleans, vec![Value::Bool(true)]);
    assert_eq!(pools.integers, vec![Value::from(int_sentinel)]);
    assert_eq!(pools.floats, vec![float(float_sentinel)]);
    assert_eq!(pools.strings, vec![Value::String(string_sentinel.into())]);

    let calls = generate_calls(&contract, &observation, 91, 512);
    assert!(calls.iter().any(|call| call.args[0] == Value::Bool(true)));
    assert!(calls.iter().any(|call| call.args[1] == int_sentinel));
    assert!(
        calls
            .iter()
            .any(|call| call.args[2] == float(float_sentinel))
    );
    assert!(
        calls
            .iter()
            .any(|call| call.args[3] == Value::String(string_sentinel.into()))
    );
}

#[test]
fn integer_observations_do_not_enter_the_float_pool() {
    let state = vec![field("whole", Type::Int), field("numeric", Type::Float)];
    let observation = json!({"whole": 73, "numeric": 7});
    let mut pools = CandidatePools::default();

    collect_record(&observation, &state, &mut pools);

    assert_eq!(pools.integers, vec![Value::from(73)]);
    assert_eq!(pools.floats, vec![float(7.0)]);
    assert!(pools.floats[0].as_i64().is_none());
}

#[test]
fn optional_scalars_generate_null_and_nonnull_typed_values() {
    let contract = contract(
        Vec::new(),
        vec![
            field("maybe_bool", Type::Optional(Box::new(Type::Bool))),
            field("maybe_int", Type::Optional(Box::new(Type::Int))),
            field("maybe_float", Type::Optional(Box::new(Type::Float))),
            field("maybe_string", Type::Optional(Box::new(Type::String))),
        ],
    );
    let calls = generate_calls(&contract, &json!({}), 811, 512);

    for index in 0..4 {
        assert!(calls.iter().any(|call| call.args[index].is_null()));
        assert!(calls.iter().any(|call| !call.args[index].is_null()));
    }
    for call in calls {
        assert!(call.args[0].is_null() || call.args[0].is_boolean());
        assert!(call.args[1].is_null() || call.args[1].as_i64().is_some());
        assert!(
            call.args[2].is_null()
                || (call.args[2].as_i64().is_none()
                    && call.args[2].as_f64().is_some_and(f64::is_finite))
        );
        assert!(call.args[3].is_null() || call.args[3].is_string());
    }
}

#[test]
fn observed_boundary_and_random_categories_retain_their_weights() {
    let observed_contract = contract(
        vec![field("measurement", Type::Float)],
        vec![field("different_name", Type::Float)],
    );
    let calls = generate_calls(
        &observed_contract,
        &json!({"measurement": 12_345.25}),
        333,
        4096,
    );
    let boundaries = [0.0, 1.0, -1.0, f64::MAX, -f64::MAX];
    let observed = calls
        .iter()
        .filter(|call| call.args[0] == float(12_345.25))
        .count();
    let boundary = calls
        .iter()
        .filter(|call| boundaries.contains(&call.args[0].as_f64().unwrap()))
        .count();
    let random = calls.len() - observed - boundary;

    assert!((1843..=2253).contains(&observed));
    assert!((819..=1229).contains(&boundary));
    assert!((819..=1229).contains(&random));

    let unobserved_contract = contract(Vec::new(), vec![field("value", Type::Float)]);
    let calls = generate_calls(&unobserved_contract, &json!({}), 334, 4096);
    let boundary = calls
        .iter()
        .filter(|call| boundaries.contains(&call.args[0].as_f64().unwrap()))
        .count();
    let random = calls.len() - boundary;

    assert!((1843..=2253).contains(&boundary));
    assert!((1843..=2253).contains(&random));
}

#[test]
fn null_is_rejected_as_a_generated_input_type() {
    let contract = contract(Vec::new(), vec![field("invalid", Type::Null)]);
    let error = generate_call(&contract, &json!({}), &mut SplitMix64::new(0)).unwrap_err();

    assert!(matches!(error, VerifyError::Contract(_)));
}

#[test]
fn contract_literals_and_neighbors_are_preferred() {
    let c = crate::semantics::compile("literal.bla", "state charge: int\naction charge(value: int)\nwhen charge { expect \"charged\": after.charge == 5 }").unwrap();
    let guidance = Guidance::new(&c);
    for value in [4, 5, 6] {
        assert!(
            guidance
                .literals
                .iter()
                .any(|(ty, v)| *ty == Type::Int && *v == json!(value))
        );
    }
}

#[test]
fn name_affinity_and_deliberate_wrong_values_preserve_record_relationships() {
    let c = crate::semantics::compile("owner.bla", r#"
type Item { id: string, owner: string }
state items: [Item]
action operate(item: string, owner: string)
when operate { expect "owned": any(before.items, i => i.id == input.item and i.owner == input.owner) or after.items == before.items }
"#).unwrap();
    let guidance = Guidance::new(&c);
    let state = json!({"items":[{"id":"X","owner":"OX"},{"id":"Y","owner":"OY"}]});
    let mut rng = SplitMix64::new(0);
    let calls: Vec<_> = (0..256)
        .map(|_| guidance.candidate(&c.actions[0], &state, &mut rng).unwrap())
        .collect();
    let matched = calls
        .iter()
        .filter(|c| {
            (c.args[0] == "X" && c.args[1] == "OX") || (c.args[0] == "Y" && c.args[1] == "OY")
        })
        .count();
    assert!(matched > 100, "matched {matched}");
    assert!(calls.iter().any(|c| c.args[0] == "X" && c.args[1] != "OX"));
    assert!(calls.iter().any(|c| c.args[0] != "X" && c.args[0] != "Y"));
}

#[test]
fn string_literals_are_generated_and_distinguish_behavioral_frontiers() {
    let c = crate::semantics::compile(
        "roles.bla",
        r#"
state role: string
action set(role: string)
when set { expect "assigned": after.role == input.role }
always "role" { role == "guest" or role == "administrator" }
"#,
    )
    .unwrap();
    let guidance = Guidance::new(&c);
    let mut rng = SplitMix64::new(0);
    let calls: Vec<_> = (0..256)
        .map(|_| {
            guidance
                .candidate(&c.actions[0], &json!({"role":"guest"}), &mut rng)
                .unwrap()
        })
        .collect();
    assert!(
        calls
            .iter()
            .filter(|c| c.args[0] == "administrator")
            .count()
            > 10
    );
    assert_ne!(
        guidance.signature(&json!({"role":"guest"})),
        guidance.signature(&json!({"role":"administrator"}))
    );
}

#[test]
fn name_affinity_does_not_coerce_integer_ids_to_float_arguments() {
    let c = contract(vec![field("id", Type::Int)], vec![field("id", Type::Float)]);
    let guidance = Guidance::new(&c);
    let mut rng = SplitMix64::new(0);
    for _ in 0..64 {
        let call = guidance
            .candidate(&c.actions[0], &json!({"id":12345}), &mut rng)
            .unwrap();
        assert!(call.args[0].is_f64(), "{:?}", call.args);
    }
}
