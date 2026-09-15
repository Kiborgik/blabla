use blabla::semantics::compile;

#[test]
fn compiles_guarded_optional_float_observations_and_inputs() {
    let source = r#"
state reading: optional<float>
action set(value: optional<float>)
when set { expect "assigned": after.reading == input.value }
always "nonnegative" { reading == null or reading >= 0.0 }
"#;
    assert!(compile("reading.bla", source).is_ok());
}

#[test]
fn rejects_parameters_on_trusted_restart() {
    let source = r#"action restart(value: int) always "safe" { true }"#;
    let error = compile("restart.bla", source).unwrap_err();
    assert_eq!(error.code, "E_RESTART_PARAMETERS");
}

#[test]
fn optional_guards_cover_records_lists_and_nested_binders() {
    let source = r#"
type Item { value: optional<float> }
state entry: optional<Item>
state items: optional<[Item]>
action inspect()
always "entry" { entry == null or entry.value == null or entry.value >= -1.25e2 }
always "items" { items == null or all(items, item => item.value == null or item.value <= 1.0) }
"#;
    let result = compile("optional.bla", source);
    assert!(result.is_ok(), "{result:?}");
}

#[test]
fn rejects_unguarded_optionals_mixed_numbers_and_nonfinite_literals() {
    for (expression, code) in [
        ("reading >= 0.0", "E_TYPE_MISMATCH"),
        ("reading != null or reading >= 0.0", "E_TYPE_MISMATCH"),
        ("1.0 == 1", "E_TYPE_MISMATCH"),
        ("1e999 == 0.0", "E_FLOAT_RANGE"),
        ("1e == 0.0", "E_NUMBER"),
    ] {
        let source = format!(
            "state reading: optional<float> action inspect() always \"valid\" {{ {expression} }}"
        );
        let error = compile("invalid.bla", &source).unwrap_err();
        assert_eq!(error.code, code, "{expression}");
        assert_eq!(error.location.file, "invalid.bla");
        assert!(error.location.column > 1);
    }
}
