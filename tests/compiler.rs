use blabla::ir::{BinaryOp, Expr, ExprKind, MAX_INT, QueryOp, Type, UnaryOp};
use blabla::semantics::compile;

fn hello_source() -> &'static str {
    r#"state stdout: string

action start()

when start {
    expect "greeting": after.stdout == "Hello, world!"
}
"#
}

#[test]
fn compiles_hello_world_to_a_typed_postcondition() {
    let contract = compile("hello.bla", hello_source()).unwrap();

    assert_eq!(contract.state.len(), 1);
    assert_eq!(contract.actions.len(), 1);
    let predicate = &contract.actions[0].postconditions[0];
    assert_eq!(predicate.label, "greeting");
    assert_eq!(predicate.expr.ty, Type::Bool);
    assert_eq!(predicate.location.file, "hello.bla");
    assert_eq!(predicate.location.line, 6);
    assert_eq!(predicate.location.column, 5);
    assert_eq!(predicate.source, "after.stdout == \"Hello, world!\"");
    assert_eq!(predicate.slots, 3);
    assert!(!predicate.forbidden);
    assert!(matches!(
        predicate.expr.kind,
        ExprKind::Binary {
            op: BinaryOp::Equal,
            ..
        }
    ));
}

fn todo_source() -> &'static str {
    r#"type Todo {
    id: int,
    text: string,
    done: bool
}

state todos: [Todo]

action add(text: string)
action complete(id: int)
action remove(id: int)
action restart()

when add {
    expect "empty-add-noop":
        input.text != "" or after.todos == before.todos
    expect "add-count":
        input.text == "" or count(after.todos) == count(before.todos) + 1
    expect "added-todo":
        input.text == "" or any(after.todos, t =>
            t.text == input.text and not t.done and
            not any(before.todos, old => old.id == t.id))
    expect "add-preserves-existing":
        all(before.todos, old => any(after.todos, t => t == old))
}

when complete {
    expect "complete-count": count(after.todos) == count(before.todos)
    expect "complete-updates-only-target":
        all(before.todos, old => any(after.todos, t =>
            t.id == old.id and t.text == old.text and
            ((old.id == input.id and t.done) or
             (old.id != input.id and t.done == old.done))))
    expect "missing-complete-noop":
        any(before.todos, t => t.id == input.id) or after.todos == before.todos
}

when remove {
    expect "removed-todo": not any(after.todos, t => t.id == input.id)
    expect "remove-preserves-others":
        all(before.todos, old => old.id == input.id or
            any(after.todos, t => t == old))
    expect "remove-introduces-nothing":
        all(after.todos, t => any(before.todos, old => old == t))
    expect "missing-remove-noop":
        any(before.todos, t => t.id == input.id) or after.todos == before.todos
}

when restart {
    expect "persistence": after.todos == before.todos
}

always "unique-ids" {
    unique(todos, t => t.id)
}

never "empty-text" {
    any(todos, t => t.text == "")
}
"#
}

#[test]
fn compiles_the_complete_todo_contract_with_nested_capture() {
    let contract = compile("todo.bla", todo_source()).unwrap();

    assert_eq!(contract.state.len(), 1);
    assert_eq!(contract.actions.len(), 4);
    assert_eq!(contract.actions[0].postconditions.len(), 4);
    assert_eq!(contract.actions[1].postconditions.len(), 3);
    assert_eq!(contract.actions[2].postconditions.len(), 4);
    assert_eq!(contract.actions[3].postconditions.len(), 1);
    assert_eq!(contract.invariants.len(), 2);
    assert_eq!(contract.actions[0].postconditions[2].slots, 5);
    assert_eq!(
        query_slots(&contract.actions[0].postconditions[2].expr),
        vec![3, 4]
    );
    assert_eq!(contract.invariants[0].slots, 4);
    assert_eq!(contract.invariants[1].slots, 4);
    assert!(!contract.invariants[0].forbidden);
    assert!(contract.invariants[1].forbidden);
    assert!(matches!(
        contract.invariants[1].expr.kind,
        ExprKind::Unary {
            op: UnaryOp::Not,
            ..
        }
    ));
}

#[test]
fn appends_multiple_when_blocks_in_source_order() {
    let source = r#"state value: int
action step()
when step { expect "first": after.value == before.value }
when step { expect "second": after.value == before.value }
"#;

    let contract = compile("order.bla", source).unwrap();
    let labels: Vec<_> = contract.actions[0]
        .postconditions
        .iter()
        .map(|predicate| predicate.label.as_str())
        .collect();
    assert_eq!(labels, vec!["first", "second"]);
}

#[test]
fn decodes_json_strings_and_tracks_utf8_byte_spans() {
    let source = "state stdout: string\naction start()\nwhen start {\n  expect \"λ\": after.stdout == \"snowman: \\u2603\"\n}\n";
    let contract = compile("unicode.bla", source).unwrap();
    let predicate = &contract.actions[0].postconditions[0];

    assert_eq!(predicate.label, "λ");
    assert_eq!(predicate.location.line, 4);
    assert_eq!(predicate.location.column, 3);
    assert_eq!(
        predicate.expr.span.start,
        source.find("after.stdout").unwrap()
    );
    let ExprKind::Binary { right, .. } = &predicate.expr.kind else {
        panic!()
    };
    let ExprKind::Literal(value) = &right.kind else {
        panic!()
    };
    assert_eq!(value, "snowman: ☃");
}

#[test]
fn applies_boolean_arithmetic_and_comparison_precedence() {
    let source = r#"action check()
when check { expect "precedence": true or false and 1 + 2 == 3 }
"#;
    let contract = compile("precedence.bla", source).unwrap();
    let expr = &contract.actions[0].postconditions[0].expr;

    let ExprKind::Binary {
        op: BinaryOp::Or,
        right,
        ..
    } = &expr.kind
    else {
        panic!()
    };
    let ExprKind::Binary {
        op: BinaryOp::And,
        right,
        ..
    } = &right.kind
    else {
        panic!()
    };
    let ExprKind::Binary {
        op: BinaryOp::Equal,
        left,
        ..
    } = &right.kind
    else {
        panic!()
    };
    assert!(matches!(
        left.kind,
        ExprKind::Binary {
            op: BinaryOp::Add,
            ..
        }
    ));
}

#[test]
fn accepts_empty_state_and_json_safe_integer_boundaries() {
    let source = format!(
        "action ping(value: int)\nwhen ping {{ expect \"bounds\": input.value == {MAX_INT} or input.value == -{MAX_INT} }}\n"
    );
    let contract = compile("bounds.bla", &source).unwrap();

    assert!(contract.state.is_empty());
    assert_eq!(contract.actions[0].params[0].ty, Type::Int);
}

#[test]
fn accepts_an_empty_record_when_an_invariant_defines_behavior() {
    let source = r#"type Empty {}
state value: Empty
action ping()
always "stable" { value == value }
"#;
    let contract = compile("empty-record.bla", source).unwrap();

    assert_eq!(contract.state[0].ty, Type::Record(Vec::new()));
    assert!(contract.actions[0].postconditions.is_empty());
    assert_eq!(contract.invariants.len(), 1);
}

#[test]
fn treats_record_types_as_structural_independent_of_field_order() {
    let source = r#"type Left { id: int, name: string }
type Right { name: string, id: int }
state left: Left
state right: Right
action compare()
always "same-shape" { left == right }
"#;

    let contract = compile("structural.bla", source).unwrap();
    assert_eq!(contract.invariants[0].expr.ty, Type::Bool);
}

#[test]
fn rejects_invalid_contracts_with_located_stable_diagnostics() {
    let too_large = MAX_INT + 1;
    let cases = [
        ("", "E_NO_ACTIONS"),
        ("action run()", "E_NO_PREDICATES"),
        ("always \"only\" { true }", "E_NO_ACTIONS"),
        ("wat nope", "E_DECLARATION"),
        (
            r#"action a() when a { expect "p": "\q" == "" }"#,
            "E_STRING",
        ),
        (
            r#"action a() when a { expect "p": "unterminated }"#,
            "E_STRING",
        ),
        (
            "type int {} action a() always \"p\" { true }",
            "E_DUPLICATE_TYPE",
        ),
        (
            "type R {} type R {} action a() always \"p\" { true }",
            "E_DUPLICATE_TYPE",
        ),
        (
            "state x: int state x: int action a() always \"p\" { true }",
            "E_DUPLICATE_STATE",
        ),
        (
            "action a() action a() always \"p\" { true }",
            "E_DUPLICATE_ACTION",
        ),
        (
            "type R { x: int, x: int } action a() always \"p\" { true }",
            "E_DUPLICATE_FIELD",
        ),
        (
            "action a(x: int, x: int) always \"p\" { true }",
            "E_DUPLICATE_FIELD",
        ),
        (
            "state x: Missing action a() always \"p\" { true }",
            "E_UNKNOWN_TYPE",
        ),
        (
            "type R { child: R } action a() always \"p\" { true }",
            "E_RECURSIVE_TYPE",
        ),
        (
            "type A { b: B } type B { a: A } action a() always \"p\" { true }",
            "E_RECURSIVE_TYPE",
        ),
        (
            "type R {} action a(value: R) always \"p\" { true }",
            "E_ACTION_PARAMETER_TYPE",
        ),
        (
            "action a() when missing { expect \"p\": true }",
            "E_UNKNOWN_ACTION",
        ),
        (
            "action a() always \"p\" { true } never \"p\" { false }",
            "E_DUPLICATE_LABEL",
        ),
        (
            "state x: int action a() when a { expect \"p\": x == 1 }",
            "E_UNKNOWN_NAME",
        ),
        (
            "action a(x: int) when a { expect \"p\": x == 1 }",
            "E_UNKNOWN_NAME",
        ),
        (
            "action a() when a { expect \"p\": input.missing == 1 }",
            "E_UNKNOWN_FIELD",
        ),
        (
            "action a(x: int) when a { expect \"p\": input.x.value == 1 }",
            "E_FIELD_BASE",
        ),
        (
            "action a() when a { expect \"p\": 1 == true }",
            "E_TYPE_MISMATCH",
        ),
        ("action a() when a { expect \"p\": 1 }", "E_TYPE_MISMATCH"),
        (
            "action a() when a { expect \"p\": count() == 0 }",
            "E_ARITY",
        ),
        (
            "action a() when a { expect \"p\": count(1) == 0 }",
            "E_TYPE_MISMATCH",
        ),
        (
            "state xs: [int] action a() always \"p\" { any(xs, true) }",
            "E_BINDER_REQUIRED",
        ),
        (
            "state xs: [int] action a() always \"p\" { any(xs, x => x) }",
            "E_TYPE_MISMATCH",
        ),
        (
            "type R { x: int } state xs: [R] action a() always \"p\" { unique(xs, x => x) }",
            "E_UNIQUE_KEY_TYPE",
        ),
        (
            "state xs: [int] action a() when a { expect \"p\": any(before.xs, before => true) }",
            "E_RESERVED_NAME",
        ),
        (
            "state xs: [[int]] action a() always \"p\" { all(xs, x => all(x, x => true)) }",
            "E_BINDING_SHADOW",
        ),
        (
            "action a() always \"p\" { before == before }",
            "E_UNKNOWN_NAME",
        ),
        (
            "action a() when a { expect \"p\": todos == todos }",
            "E_UNKNOWN_NAME",
        ),
        (
            "action a() when a { expect \"p\": 1 < 2 < 3 }",
            "E_CHAINED_COMPARISON",
        ),
        (
            "action a() when a { expect \"p\": 1 == 1 == true }",
            "E_CHAINED_COMPARISON",
        ),
        (
            "action a() when a { expect \"p\": mystery() }",
            "E_UNKNOWN_FUNCTION",
        ),
        (
            "state xs: [int] action a() always \"p\" { x => true }",
            "E_LAMBDA_CONTEXT",
        ),
    ];

    for (source, expected_code) in cases {
        let error = compile("bad.bla", source).unwrap_err();
        assert_eq!(
            error.code, expected_code,
            "source: {source}\nerror: {error:?}"
        );
        assert_eq!(error.location.file, "bad.bla");
        assert!(error.location.line >= 1);
        assert!(error.location.column >= 1);
    }

    let source = format!("action a() when a {{ expect \"p\": {too_large} == 0 }}");
    assert_eq!(
        compile("large.bla", &source).unwrap_err().code,
        "E_INTEGER_RANGE"
    );
}

#[test]
fn rejects_unknown_input_at_its_field_location() {
    let source = "action run(id: int)\nwhen run {\n    expect \"bad\": input.missing == 1\n}\n";
    let error = compile("located.bla", source).unwrap_err();

    assert_eq!(error.code, "E_UNKNOWN_FIELD");
    assert_eq!(error.location.line, 3);
    assert_eq!(error.location.column, 25);
}

#[test]
fn rejects_reserved_state_names_at_their_declarations() {
    for name in [
        "true", "false", "not", "and", "or", "before", "input", "after",
    ] {
        let source = format!("state {name}: bool\naction tick()\nalways \"safe\" {{ true }}\n");
        let error = compile("reserved-state.bla", &source).unwrap_err();

        assert_eq!(error.code, "E_RESERVED_NAME", "name: {name}");
        assert_eq!(error.location.line, 1, "name: {name}");
        assert_eq!(error.location.column, 7, "name: {name}");
        assert!(error.message.contains(name));
    }
}

#[test]
fn rejects_reserved_binder_names_at_their_declarations() {
    for name in [
        "true", "false", "not", "and", "or", "before", "input", "after",
    ] {
        let source = format!(
            "state values: [bool]\naction tick()\nalways \"safe\" {{\n    any(values, {name} => true)\n}}\n"
        );
        let error = compile("reserved-binder.bla", &source).unwrap_err();

        assert_eq!(error.code, "E_RESERVED_NAME", "name: {name}");
        assert_eq!(error.location.line, 4, "name: {name}");
        assert_eq!(error.location.column, 17, "name: {name}");
        assert!(error.message.contains(name));
    }
}

fn query_slots(expr: &Expr) -> Vec<usize> {
    let mut slots = Vec::new();
    collect_query_slots(expr, &mut slots);
    slots
}

fn collect_query_slots(expr: &Expr, slots: &mut Vec<usize>) {
    match &expr.kind {
        ExprKind::Field { base, .. }
        | ExprKind::Unary { operand: base, .. }
        | ExprKind::Count(base) => {
            collect_query_slots(base, slots);
        }
        ExprKind::Binary { left, right, .. } => {
            collect_query_slots(left, slots);
            collect_query_slots(right, slots);
        }
        ExprKind::Query {
            op,
            list,
            slot,
            body,
        } => {
            assert!(matches!(op, QueryOp::Any | QueryOp::All | QueryOp::Unique));
            slots.push(*slot);
            collect_query_slots(list, slots);
            collect_query_slots(body, slots);
        }
        ExprKind::Literal(_) | ExprKind::Load(_) => {}
    }
}

fn unit<'a>(
    file: &'a str,
    source: &'a str,
    group: &'a str,
    syntax: &'a blabla::syntax::Contract,
) -> blabla::semantics::Unit<'a> {
    blabla::semantics::Unit {
        file,
        source,
        group: Some(group),
        declarations: &syntax.declarations,
    }
}

#[test]
fn compiles_units_against_the_project_environment_with_owning_file_diagnostics() {
    let core = "type Item {\n    id: int,\n    text: string\n}\n\nstate items: [Item]\n\naction add(text: string)\n\nwhen add {\n    expect \"add-count\": input.text == \"\" or count(after.items) == count(before.items) + 1\n}\n";
    let feature = "action restart()\n\nwhen add {\n    expect \"add-count\": all(before.items, old => any(after.items, item => item == old))\n}\n\nwhen restart {\n    expect \"persistence\": after.items == before.items\n}\n";
    let core_syntax = blabla::syntax::parse("core.bla", core).unwrap();
    let feature_syntax = blabla::syntax::parse("feature.bla", feature).unwrap();
    let contract = blabla::semantics::compile_units(&[
        unit("core.bla", core, "core", &core_syntax),
        unit("feature.bla", feature, "feature", &feature_syntax),
    ])
    .unwrap();
    assert_eq!(contract.actions.len(), 2);
    let labels: Vec<&str> = contract.actions[0]
        .postconditions
        .iter()
        .map(|predicate| predicate.label.as_str())
        .collect();
    assert_eq!(labels, ["core::add-count", "feature::add-count"]);
    let shared = &contract.actions[0].postconditions[1];
    assert_eq!(shared.location.file, "feature.bla");
    assert_eq!(shared.location.line, 4);
    assert_eq!(
        shared.source,
        "all(before.items, old => any(after.items, item => item == old))"
    );
    assert_eq!(
        contract.actions[1].postconditions[0].label,
        "feature::persistence"
    );

    let broken_type = "type Tag {\n    name: missing\n}\n";
    let user = "type Item {\n    id: int,\n    tag: Tag\n}\n\nstate items: [Item]\n\naction add(text: string)\n\nwhen add {\n    expect \"kept\": count(after.items) >= 0\n}\n";
    let broken_syntax = blabla::syntax::parse("tags.bla", broken_type).unwrap();
    let user_syntax = blabla::syntax::parse("user.bla", user).unwrap();
    let failure = blabla::semantics::compile_units(&[
        unit("user.bla", user, "user", &user_syntax),
        unit("tags.bla", broken_type, "tags", &broken_syntax),
    ])
    .unwrap_err();
    assert_eq!(failure.code, "E_UNKNOWN_TYPE");
    assert_eq!(failure.location.file, "tags.bla");
    assert_eq!(failure.location.line, 2);

    let single = compile("solo.bla", core).unwrap();
    assert_eq!(single.actions[0].postconditions[0].label, "add-count");
}
