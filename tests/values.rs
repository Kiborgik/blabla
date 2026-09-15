use blabla::application::AppConfig;
use blabla::ir::{Field, Type};
use blabla::report::{RunOptions, RunStatus};
use blabla::runtime::{AppSession, project_observation};
use blabla::semantics::compile;
use blabla::verify::run;
use serde_json::json;
use std::path::Path;
use std::time::Duration;

#[test]
fn finite_float_and_null_inputs_survive_the_jsonl_boundary_exactly() {
    let contract = compile(
        "echo.bla",
        r#"
state value: optional<float>
action echo(input_value: optional<float>)
when echo { expect "echoed": after.value == input.input_value }
"#,
    )
    .unwrap();
    let config = AppConfig {
        executable: "python".into(),
        args: vec![
            Path::new("tests/fixtures/values/app.py")
                .canonicalize()
                .unwrap()
                .into_os_string(),
        ],
        timeout: Duration::from_secs(1),
    };
    let options = RunOptions {
        seed: 1234,
        cases: 1,
        steps: 512,
        shrink_budget: 32,
    };
    let report = run(&contract, &options, || AppSession::spawn(&config)).unwrap();
    assert_eq!(report.status, RunStatus::Green, "{:?}", report.failure);
}

#[test]
fn optional_observations_accept_null_but_require_the_field_and_inner_type() {
    let schema = [Field {
        name: "value".into(),
        ty: Type::Optional(Box::new(Type::Float)),
    }];
    assert_eq!(
        project_observation(&json!({"value":null}), &schema).unwrap(),
        json!({"value":null})
    );
    let value = project_observation(&json!({"value":1}), &schema).unwrap();
    assert_eq!(value["value"].as_f64(), Some(1.0));
    assert!(value["value"].as_i64().is_none());
    assert!(project_observation(&json!({}), &schema).is_err());
    assert!(project_observation(&json!({"value":true}), &schema).is_err());
    assert!(project_observation(&json!({"value":"1.0"}), &schema).is_err());
}
