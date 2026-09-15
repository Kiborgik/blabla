use blabla::application::Application;
use blabla::diagnostic::{AppError, Location, Span};
use blabla::ir::{
    Action, ActionKind, BinaryOp, Contract, Expr, ExprKind, Field, MAX_INT, Predicate, QueryOp,
    Type, UnaryOp,
};
use blabla::report::{Call, MAX_SHRINK_ATTEMPTS, RunOptions, RunStatus, ShrinkStatus, VerifyError};
use blabla::verify::run;
use serde_json::{Value, json};
use std::cell::Cell;
use std::rc::Rc;

#[derive(Clone)]
struct MemoryApp {
    initial: Value,
    state: Value,
    transition: fn(&mut Value, &Call) -> Result<(), AppError>,
}

impl MemoryApp {
    fn new(initial: Value, transition: fn(&mut Value, &Call) -> Result<(), AppError>) -> Self {
        Self {
            state: initial.clone(),
            initial,
            transition,
        }
    }
}

impl Application for MemoryApp {
    fn reset(&mut self) -> Result<(), AppError> {
        self.state = self.initial.clone();
        Ok(())
    }

    fn call(&mut self, call: &Call) -> Result<(), AppError> {
        (self.transition)(&mut self.state, call)
    }

    fn observe(&mut self, _schema: &[Field]) -> Result<Value, AppError> {
        Ok(self.state.clone())
    }
}

struct FinishControlled<A> {
    inner: A,
    finishes: Rc<Cell<usize>>,
    fail: bool,
}

impl<A: Application> Application for FinishControlled<A> {
    fn reset(&mut self) -> Result<(), AppError> {
        self.inner.reset()
    }

    fn call(&mut self, call: &Call) -> Result<(), AppError> {
        self.inner.call(call)
    }

    fn observe(&mut self, schema: &[Field]) -> Result<Value, AppError> {
        self.inner.observe(schema)
    }

    fn finish(&mut self) -> Result<(), AppError> {
        self.finishes.set(self.finishes.get() + 1);
        if self.fail {
            Err(AppError::new(
                "fixture-finish",
                "terminal bytes were invalid",
            ))
        } else {
            self.inner.finish()
        }
    }
}

fn no_change(_state: &mut Value, _call: &Call) -> Result<(), AppError> {
    Ok(())
}

fn location() -> Location {
    Location {
        file: "test.bla".into(),
        line: 1,
        column: 1,
    }
}

fn expr(kind: ExprKind, ty: Type) -> Expr {
    Expr {
        kind,
        ty,
        span: Span {
            start: 0,
            end: 1,
            line: 1,
            column: 1,
        },
    }
}

fn literal(value: Value, ty: Type) -> Expr {
    expr(ExprKind::Literal(value), ty)
}

fn load(slot: usize, ty: Type) -> Expr {
    expr(ExprKind::Load(slot), ty)
}

fn field(base: Expr, name: &str, ty: Type) -> Expr {
    expr(
        ExprKind::Field {
            base: Box::new(base),
            name: name.into(),
        },
        ty,
    )
}

fn binary(op: BinaryOp, left: Expr, right: Expr, ty: Type) -> Expr {
    expr(
        ExprKind::Binary {
            op,
            left: Box::new(left),
            right: Box::new(right),
        },
        ty,
    )
}

fn unary(op: UnaryOp, operand: Expr, ty: Type) -> Expr {
    expr(
        ExprKind::Unary {
            op,
            operand: Box::new(operand),
        },
        ty,
    )
}

fn query(op: QueryOp, list: Expr, slot: usize, body: Expr) -> Expr {
    expr(
        ExprKind::Query {
            op,
            list: Box::new(list),
            slot,
            body: Box::new(body),
        },
        Type::Bool,
    )
}

fn predicate(label: &str, expression: Expr, slots: usize) -> Predicate {
    Predicate {
        label: label.into(),
        expr: expression,
        location: location(),
        source: label.into(),
        slots,
        forbidden: false,
    }
}

fn true_predicate(label: &str) -> Predicate {
    predicate(label, literal(json!(true), Type::Bool), 3)
}

fn contract(state: Vec<Field>, actions: Vec<Action>, invariants: Vec<Predicate>) -> Contract {
    Contract {
        state,
        actions,
        invariants,
    }
}

fn options(seed: u64, cases: usize, steps: usize, shrink_budget: usize) -> RunOptions {
    RunOptions {
        seed,
        cases,
        steps,
        shrink_budget,
    }
}

#[test]
fn nested_queries_capture_outer_slots_and_restore_bindings() {
    let ints = Type::List(Box::new(Type::Int));
    let groups = Type::List(Box::new(ints.clone()));
    let state_field = Field {
        name: "groups".into(),
        ty: groups.clone(),
    };
    let groups_value = field(
        load(0, Type::Record(vec![state_field.clone()])),
        "groups",
        groups,
    );
    let outer = load(3, ints.clone());
    let inner_matches_outer_item = query(
        QueryOp::Any,
        outer.clone(),
        5,
        binary(
            BinaryOp::Equal,
            load(5, Type::Int),
            load(4, Type::Int),
            Type::Bool,
        ),
    );
    let every_item_is_in_outer = query(QueryOp::All, outer, 4, inner_matches_outer_item);
    let nested = query(QueryOp::All, groups_value, 3, every_item_is_in_outer);
    let c = contract(
        vec![state_field],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![predicate("nested", nested, 6)],
    );

    let report = run(&c, &options(4, 1, 1, 8), || {
        Ok(MemoryApp::new(json!({"groups": [[1, 2], [3]]}), no_change))
    })
    .unwrap();

    assert_eq!(report.status, RunStatus::Green);
}

#[test]
fn boolean_operators_short_circuit_dynamic_overflow() {
    let overflow = binary(
        BinaryOp::Add,
        literal(json!(MAX_INT), Type::Int),
        literal(json!(1), Type::Int),
        Type::Int,
    );
    let comparison = binary(
        BinaryOp::Equal,
        overflow,
        literal(json!(0), Type::Int),
        Type::Bool,
    );
    let c = contract(
        vec![],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![
            predicate(
                "or-short-circuit",
                binary(
                    BinaryOp::Or,
                    literal(json!(true), Type::Bool),
                    comparison.clone(),
                    Type::Bool,
                ),
                3,
            ),
            predicate(
                "and-short-circuit",
                unary(
                    UnaryOp::Not,
                    binary(
                        BinaryOp::And,
                        literal(json!(false), Type::Bool),
                        comparison,
                        Type::Bool,
                    ),
                    Type::Bool,
                ),
                3,
            ),
        ],
    );

    let report = run(&c, &options(0, 1, 1, 8), || {
        Ok(MemoryApp::new(json!({}), no_change))
    })
    .unwrap();

    assert_eq!(report.status, RunStatus::Green);
}

#[test]
fn arithmetic_outside_json_safe_integer_range_is_a_located_contract_error() {
    let c = contract(
        vec![],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![predicate(
            "overflow",
            binary(
                BinaryOp::Equal,
                binary(
                    BinaryOp::Add,
                    literal(json!(MAX_INT), Type::Int),
                    literal(json!(1), Type::Int),
                    Type::Int,
                ),
                literal(json!(0), Type::Int),
                Type::Bool,
            ),
            3,
        )],
    );

    let error = run(&c, &options(0, 1, 1, 8), || {
        Ok(MemoryApp::new(json!({}), no_change))
    })
    .unwrap_err();

    match error {
        VerifyError::Contract(diagnostic) => {
            assert_eq!(diagnostic.location, location());
            assert_eq!(diagnostic.code, "BLA-EVAL-INT");
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[test]
fn same_seed_reproduces_every_generated_concrete_call() {
    let c = contract(
        vec![],
        vec![
            Action {
                kind: ActionKind::Application,
                name: "alpha".into(),
                params: vec![
                    Field {
                        name: "number".into(),
                        ty: Type::Int,
                    },
                    Field {
                        name: "text".into(),
                        ty: Type::String,
                    },
                    Field {
                        name: "flag".into(),
                        ty: Type::Bool,
                    },
                ],
                postconditions: vec![],
            },
            Action {
                kind: ActionKind::Application,
                name: "beta".into(),
                params: vec![],
                postconditions: vec![],
            },
        ],
        vec![true_predicate("safe")],
    );
    let run_once = || {
        run(&c, &options(991, 3, 12, 8), || {
            Ok(MemoryApp::new(json!({}), no_change))
        })
        .unwrap()
    };

    let first = run_once();
    let second = run_once();

    assert_eq!(first.sequences, second.sequences);
    assert_eq!(first.steps_executed, 36);
    assert_eq!(first.cases_executed, 3);
}

#[test]
fn observed_primitives_are_used_as_generic_action_arguments() {
    let c = contract(
        vec![Field {
            name: "live".into(),
            ty: Type::List(Box::new(Type::Int)),
        }],
        vec![Action {
            kind: ActionKind::Application,
            name: "probe".into(),
            params: vec![Field {
                name: "value".into(),
                ty: Type::Int,
            }],
            postconditions: vec![],
        }],
        vec![true_predicate("safe")],
    );

    let report = run(&c, &options(7, 2, 32, 8), || {
        Ok(MemoryApp::new(json!({"live": [424242]}), no_change))
    })
    .unwrap();

    assert!(
        report
            .sequences
            .iter()
            .flatten()
            .any(|call| call.args == [json!(424242)])
    );
}

#[test]
fn initial_invariant_failure_has_an_empty_counterexample() {
    let state_field = Field {
        name: "ok".into(),
        ty: Type::Bool,
    };
    let invariant = predicate(
        "initial",
        field(
            load(0, Type::Record(vec![state_field.clone()])),
            "ok",
            Type::Bool,
        ),
        3,
    );
    let c = contract(
        vec![state_field],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![invariant],
    );

    let report = run(&c, &options(0, 1, 2, 12), || {
        Ok(MemoryApp::new(json!({"ok": false}), no_change))
    })
    .unwrap();
    let failure = report.failure.unwrap();

    assert_eq!(report.status, RunStatus::Red);
    assert!(failure.sequence.is_empty());
    assert!(failure.original_sequence.is_empty());
    assert_eq!(failure.property, "initial");
    assert_eq!(failure.shrink.status, ShrinkStatus::FixedPoint);
    assert_eq!(failure.shrink.attempts, 0);
    assert_eq!(failure.shrink.confirmations, 2);
}

#[test]
fn equality_failure_retains_both_operands() {
    fn set_two(state: &mut Value, _call: &Call) -> Result<(), AppError> {
        state["x"] = json!(2);
        Ok(())
    }

    let state_field = Field {
        name: "x".into(),
        ty: Type::Int,
    };
    let equals_one = binary(
        BinaryOp::Equal,
        field(
            load(2, Type::Record(vec![state_field.clone()])),
            "x",
            Type::Int,
        ),
        literal(json!(1), Type::Int),
        Type::Bool,
    );
    let c = contract(
        vec![state_field],
        vec![Action {
            kind: ActionKind::Application,
            name: "break".into(),
            params: vec![],
            postconditions: vec![predicate("x-one", equals_one, 3)],
        }],
        vec![],
    );

    let report = run(&c, &options(0, 1, 1, 0), || {
        Ok(MemoryApp::new(json!({"x": 1}), set_two))
    })
    .unwrap();
    let failure = report.failure.unwrap();

    assert_eq!(failure.actual, Some(json!(2)));
    assert_eq!(failure.expected, Some(json!(1)));
    assert_eq!(failure.shrink.status, ShrinkStatus::BudgetExhausted);
    assert_eq!(failure.shrink.confirmations, 2);
}

#[test]
fn zero_campaign_budgets_are_rejected_but_zero_shrink_budget_is_valid() {
    let c = contract(
        vec![],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![true_predicate("safe")],
    );

    for invalid in [options(0, 0, 1, 0), options(0, 1, 0, 0)] {
        match run(&c, &invalid, || Ok(MemoryApp::new(json!({}), no_change))).unwrap_err() {
            VerifyError::Contract(diagnostic) => assert_eq!(diagnostic.code, "BLA-RUN-BUDGET"),
            other => panic!("unexpected error: {other:?}"),
        }
    }

    let valid = run(&c, &options(0, 1, 1, 0), || {
        Ok(MemoryApp::new(json!({}), no_change))
    })
    .unwrap();
    assert_eq!(valid.status, RunStatus::Green);
}

#[test]
fn library_accepts_the_shared_shrink_limit_and_rejects_larger_values() {
    let c = contract(
        vec![],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![true_predicate("safe")],
    );

    let accepted = run(&c, &options(0, 1, 1, MAX_SHRINK_ATTEMPTS), || {
        Ok(MemoryApp::new(json!({}), no_change))
    })
    .unwrap();
    assert_eq!(accepted.status, RunStatus::Green);

    match run(&c, &options(0, 1, 1, MAX_SHRINK_ATTEMPTS + 1), || {
        Ok(MemoryApp::new(json!({}), no_change))
    })
    .unwrap_err()
    {
        VerifyError::Contract(diagnostic) => assert_eq!(diagnostic.code, "BLA-RUN-BUDGET"),
        other => panic!("unexpected error: {other:?}"),
    }
}

#[test]
fn unstable_final_confirmation_preserves_historical_failure() {
    let invocation = Rc::new(Cell::new(0));
    let state_field = Field {
        name: "ok".into(),
        ty: Type::Bool,
    };
    let invariant = predicate(
        "unstable",
        field(
            load(0, Type::Record(vec![state_field.clone()])),
            "ok",
            Type::Bool,
        ),
        3,
    );
    let c = contract(
        vec![state_field],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![invariant],
    );

    let result = run(&c, &options(0, 1, 1, 0), {
        let invocation = invocation.clone();
        move || {
            let current = invocation.get();
            invocation.set(current + 1);
            let ok = current >= 2;
            Ok(MemoryApp::new(json!({"ok": ok}), no_change))
        }
    });

    match result.unwrap_err() {
        VerifyError::Unstable { failure, .. } => {
            assert_eq!(failure.property, "unstable");
            assert!(failure.original_sequence.is_empty());
            assert_eq!(failure.shrink.confirmations, 1);
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[test]
fn unary_negation_accepts_both_json_safe_boundaries() {
    let lower = unary(
        UnaryOp::Negate,
        literal(json!(MAX_INT), Type::Int),
        Type::Int,
    );
    let upper = unary(
        UnaryOp::Negate,
        literal(json!(-MAX_INT), Type::Int),
        Type::Int,
    );
    let valid = binary(
        BinaryOp::And,
        binary(
            BinaryOp::Equal,
            lower,
            literal(json!(-MAX_INT), Type::Int),
            Type::Bool,
        ),
        binary(
            BinaryOp::Equal,
            upper,
            literal(json!(MAX_INT), Type::Int),
            Type::Bool,
        ),
        Type::Bool,
    );
    let c = contract(
        vec![],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![predicate("boundaries", valid, 3)],
    );

    let report = run(&c, &options(0, 1, 1, 8), || {
        Ok(MemoryApp::new(json!({}), no_change))
    })
    .unwrap();

    assert_eq!(report.status, RunStatus::Green);
}

#[test]
fn empty_collection_queries_are_total_and_forbidden_metadata_is_not_negated_again() {
    let list_type = Type::List(Box::new(Type::Int));
    let state_field = Field {
        name: "values".into(),
        ty: list_type.clone(),
    };
    let values = field(
        load(0, Type::Record(vec![state_field.clone()])),
        "values",
        list_type,
    );
    let all_empty = query(
        QueryOp::All,
        values.clone(),
        3,
        literal(json!(false), Type::Bool),
    );
    let no_any = unary(
        UnaryOp::Not,
        query(
            QueryOp::Any,
            values.clone(),
            3,
            literal(json!(true), Type::Bool),
        ),
        Type::Bool,
    );
    let unique_empty = query(QueryOp::Unique, values, 3, load(3, Type::Int));
    let mut normalized_never = true_predicate("normalized-never");
    normalized_never.forbidden = true;
    let c = contract(
        vec![state_field],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![
            predicate("all-empty", all_empty, 4),
            predicate("any-empty", no_any, 4),
            predicate("unique-empty", unique_empty, 4),
            normalized_never,
        ],
    );

    let report = run(&c, &options(0, 1, 1, 16), || {
        Ok(MemoryApp::new(json!({"values": []}), no_change))
    })
    .unwrap();

    assert_eq!(report.status, RunStatus::Yellow);
    assert!(report.failure.is_none());
    assert_eq!(report.coverage_summary.unexercised, 3);
    assert!(
        report
            .coverage_summary
            .coverage
            .iter()
            .any(|p| p.property == "normalized-never" && p.witnesses > 0)
    );
}

#[test]
fn forbidden_failure_reports_the_normalized_predicate_text() {
    let state_field = Field {
        name: "bad".into(),
        ty: Type::Bool,
    };
    let mut forbidden = predicate(
        "forbidden",
        unary(
            UnaryOp::Not,
            field(
                load(0, Type::Record(vec![state_field.clone()])),
                "bad",
                Type::Bool,
            ),
            Type::Bool,
        ),
        3,
    );
    forbidden.source = "bad".into();
    forbidden.forbidden = true;
    let c = contract(
        vec![state_field],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![forbidden],
    );

    let report = run(&c, &options(0, 1, 1, 0), || {
        Ok(MemoryApp::new(json!({"bad": true}), no_change))
    })
    .unwrap();

    assert_eq!(report.failure.unwrap().predicate, "not (bad)");
}

#[test]
fn every_successful_generation_case_is_finished() {
    let finishes = Rc::new(Cell::new(0));
    let c = contract(
        vec![],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![true_predicate("safe")],
    );

    let report = run(&c, &options(0, 3, 1, 0), {
        let finishes = finishes.clone();
        move || {
            Ok(FinishControlled {
                inner: MemoryApp::new(json!({}), no_change),
                finishes: finishes.clone(),
                fail: false,
            })
        }
    })
    .unwrap();

    assert_eq!(report.status, RunStatus::Green);
    assert_eq!(finishes.get(), 3);
}

#[test]
fn generation_failure_is_not_accepted_when_finish_fails() {
    let finishes = Rc::new(Cell::new(0));
    let state_field = Field {
        name: "ok".into(),
        ty: Type::Bool,
    };
    let c = contract(
        vec![state_field.clone()],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![predicate(
            "unsafe",
            field(load(0, Type::Record(vec![state_field])), "ok", Type::Bool),
            3,
        )],
    );

    let error = run(&c, &options(0, 1, 1, 0), {
        let finishes = finishes.clone();
        move || {
            Ok(FinishControlled {
                inner: MemoryApp::new(json!({"ok": false}), no_change),
                finishes: finishes.clone(),
                fail: true,
            })
        }
    })
    .unwrap_err();

    match error {
        VerifyError::Application(error) => assert_eq!(error.code, "fixture-finish"),
        other => panic!("unexpected error: {other:?}"),
    }
    assert_eq!(finishes.get(), 1);
}

#[test]
fn unique_detects_duplicate_scalar_keys_and_list_equality_is_ordered() {
    let list_type = Type::List(Box::new(Type::Int));
    let state_field = Field {
        name: "values".into(),
        ty: list_type.clone(),
    };
    let values = field(
        load(0, Type::Record(vec![state_field.clone()])),
        "values",
        list_type.clone(),
    );
    let c = contract(
        vec![state_field],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![
            predicate(
                "unique-values",
                query(QueryOp::Unique, values.clone(), 3, load(3, Type::Int)),
                4,
            ),
            predicate(
                "ordered-values",
                binary(
                    BinaryOp::Equal,
                    values,
                    literal(json!([1, 2]), list_type),
                    Type::Bool,
                ),
                3,
            ),
        ],
    );

    let report = run(&c, &options(0, 1, 1, 16), || {
        Ok(MemoryApp::new(json!({"values": [2, 2]}), no_change))
    })
    .unwrap();
    let failure = report.failure.unwrap();

    assert_eq!(failure.property, "unique-values");

    let ordered_only = contract(
        vec![Field {
            name: "values".into(),
            ty: Type::List(Box::new(Type::Int)),
        }],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![predicate(
            "ordered-values",
            binary(
                BinaryOp::Equal,
                field(
                    load(
                        0,
                        Type::Record(vec![Field {
                            name: "values".into(),
                            ty: Type::List(Box::new(Type::Int)),
                        }]),
                    ),
                    "values",
                    Type::List(Box::new(Type::Int)),
                ),
                literal(json!([1, 2]), Type::List(Box::new(Type::Int))),
                Type::Bool,
            ),
            3,
        )],
    );
    let report = run(&ordered_only, &options(0, 1, 1, 16), || {
        Ok(MemoryApp::new(json!({"values": [2, 1]}), no_change))
    })
    .unwrap();

    assert_eq!(report.failure.unwrap().property, "ordered-values");
}

#[test]
fn postconditions_bind_before_input_and_after_slots() {
    fn assign(state: &mut Value, call: &Call) -> Result<(), AppError> {
        state["value"] = call.args[0].clone();
        Ok(())
    }

    let state_field = Field {
        name: "value".into(),
        ty: Type::Int,
    };
    let param = Field {
        name: "next".into(),
        ty: Type::Int,
    };
    let matches_input = binary(
        BinaryOp::Equal,
        field(
            load(2, Type::Record(vec![state_field.clone()])),
            "value",
            Type::Int,
        ),
        field(
            load(1, Type::Record(vec![param.clone()])),
            "next",
            Type::Int,
        ),
        Type::Bool,
    );
    let preserves_no_required_value = binary(
        BinaryOp::Equal,
        field(
            load(0, Type::Record(vec![state_field.clone()])),
            "value",
            Type::Int,
        ),
        field(
            load(0, Type::Record(vec![state_field.clone()])),
            "value",
            Type::Int,
        ),
        Type::Bool,
    );
    let c = contract(
        vec![state_field],
        vec![Action {
            kind: ActionKind::Application,
            name: "assign".into(),
            params: vec![param],
            postconditions: vec![
                predicate("input", matches_input, 3),
                predicate("before", preserves_no_required_value, 3),
            ],
        }],
        vec![],
    );

    let report = run(&c, &options(10, 1, 8, 16), || {
        Ok(MemoryApp::new(json!({"value": 0}), assign))
    })
    .unwrap();

    assert_eq!(report.status, RunStatus::Green);
}

#[derive(Clone)]
struct ArmingApp {
    state: Value,
}

impl ArmingApp {
    fn new() -> Self {
        Self {
            state: json!({"target_ok": true, "other_ok": true, "armed": false}),
        }
    }
}

impl Application for ArmingApp {
    fn reset(&mut self) -> Result<(), AppError> {
        self.state = json!({"target_ok": true, "other_ok": true, "armed": false});
        Ok(())
    }

    fn call(&mut self, call: &Call) -> Result<(), AppError> {
        match call.action.as_str() {
            "prepare" => self.state["armed"] = json!(true),
            "break" if self.state["armed"] == json!(true) => self.state["target_ok"] = json!(false),
            "break" => self.state["other_ok"] = json!(false),
            _ => {}
        }
        Ok(())
    }

    fn observe(&mut self, _schema: &[Field]) -> Result<Value, AppError> {
        Ok(self.state.clone())
    }
}

#[test]
fn shrinking_keeps_a_producer_when_removing_it_changes_the_failed_property() {
    let fields = vec![
        Field {
            name: "target_ok".into(),
            ty: Type::Bool,
        },
        Field {
            name: "other_ok".into(),
            ty: Type::Bool,
        },
        Field {
            name: "armed".into(),
            ty: Type::Bool,
        },
    ];
    let state_type = Type::Record(fields.clone());
    let invariant = |label: &str, name: &str| {
        predicate(
            label,
            field(load(0, state_type.clone()), name, Type::Bool),
            3,
        )
    };
    let c = contract(
        fields,
        vec![
            Action {
                kind: ActionKind::Application,
                name: "prepare".into(),
                params: vec![],
                postconditions: vec![],
            },
            Action {
                kind: ActionKind::Application,
                name: "break".into(),
                params: vec![],
                postconditions: vec![],
            },
        ],
        vec![
            invariant("target", "target_ok"),
            invariant("other", "other_ok"),
        ],
    );

    let report = run(&c, &options(6, 1, 32, 128), || Ok(ArmingApp::new())).unwrap();
    let failure = report.failure.unwrap();

    assert_eq!(failure.property, "target");
    assert_eq!(
        failure
            .sequence
            .iter()
            .map(|call| call.action.as_str())
            .collect::<Vec<_>>(),
        ["prepare", "break"]
    );
    assert_eq!(failure.shrink.status, ShrinkStatus::FixedPoint);
}

#[derive(Clone)]
struct NonemptyBreaksApp {
    safe: bool,
}

impl Application for NonemptyBreaksApp {
    fn reset(&mut self) -> Result<(), AppError> {
        self.safe = true;
        Ok(())
    }

    fn call(&mut self, call: &Call) -> Result<(), AppError> {
        self.safe = call.args[0] == json!("");
        Ok(())
    }

    fn observe(&mut self, _schema: &[Field]) -> Result<Value, AppError> {
        Ok(json!({"safe": self.safe}))
    }
}

fn nonempty_breaks_contract() -> Contract {
    let state_field = Field {
        name: "safe".into(),
        ty: Type::Bool,
    };
    contract(
        vec![state_field.clone()],
        vec![Action {
            kind: ActionKind::Application,
            name: "write".into(),
            params: vec![Field {
                name: "text".into(),
                ty: Type::String,
            }],
            postconditions: vec![],
        }],
        vec![predicate(
            "safe",
            field(load(0, Type::Record(vec![state_field])), "safe", Type::Bool),
            3,
        )],
    )
}

#[test]
fn shrinking_removes_calls_and_reduces_arguments_with_decreasing_complexity() {
    let c = nonempty_breaks_contract();

    let report = run(&c, &options(5, 1, 32, 128), || {
        Ok(NonemptyBreaksApp { safe: true })
    })
    .unwrap();
    let generated_failure = report.sequences[0].clone();
    let failure = report.failure.unwrap();

    assert_eq!(failure.sequence.len(), 1);
    assert_eq!(failure.sequence[0].action, "write");
    assert_eq!(
        failure.sequence[0].args[0]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        1
    );
    assert_eq!(failure.original_sequence, generated_failure);
    assert!(failure.original_sequence.len() >= failure.sequence.len());
    assert_eq!(failure.shrink.status, ShrinkStatus::FixedPoint);
}

#[test]
fn candidate_attempts_stop_exactly_at_the_shrink_budget() {
    let c = nonempty_breaks_contract();

    let report = run(&c, &options(5, 1, 32, 1), || {
        Ok(NonemptyBreaksApp { safe: true })
    })
    .unwrap();
    let failure = report.failure.unwrap();

    assert_eq!(failure.shrink.status, ShrinkStatus::BudgetExhausted);
    assert_eq!(failure.shrink.attempts, 1);
    assert_eq!(failure.shrink.confirmations, 2);
}

#[test]
fn protocol_error_during_candidate_reduction_interrupts_but_finally_confirms() {
    let c = nonempty_breaks_contract();
    let invocation = Rc::new(Cell::new(0));

    let report = run(&c, &options(5, 1, 32, 128), {
        let invocation = invocation.clone();
        move || {
            let current = invocation.get();
            invocation.set(current + 1);
            if current == 2 {
                Err(AppError::new("fixture-protocol", "candidate failed"))
            } else {
                Ok(NonemptyBreaksApp { safe: true })
            }
        }
    })
    .unwrap();
    let failure = report.failure.unwrap();

    assert_eq!(failure.shrink.status, ShrinkStatus::Interrupted);
    assert_eq!(failure.shrink.attempts, 1);
    assert_eq!(failure.shrink.confirmations, 2);
    assert!(failure.shrink.reason.unwrap().contains("candidate failed"));
}

#[test]
fn finish_error_during_candidate_reduction_interrupts_then_finally_confirms() {
    let c = nonempty_breaks_contract();
    let invocation = Rc::new(Cell::new(0));
    let finishes = Rc::new(Cell::new(0));

    let report = run(&c, &options(5, 1, 32, 128), {
        let invocation = invocation.clone();
        let finishes = finishes.clone();
        move || {
            let current = invocation.get();
            invocation.set(current + 1);
            Ok(FinishControlled {
                inner: NonemptyBreaksApp { safe: true },
                finishes: finishes.clone(),
                fail: current == 2,
            })
        }
    })
    .unwrap();
    let failure = report.failure.unwrap();

    assert_eq!(failure.shrink.status, ShrinkStatus::Interrupted);
    assert_eq!(failure.shrink.attempts, 1);
    assert_eq!(failure.shrink.confirmations, 2);
    assert!(
        failure
            .shrink
            .reason
            .unwrap()
            .contains("terminal bytes were invalid")
    );
    assert_eq!(finishes.get(), 4);
}

#[test]
fn finish_error_during_final_confirmation_is_unstable_after_one_confirmation() {
    let invocation = Rc::new(Cell::new(0));
    let finishes = Rc::new(Cell::new(0));
    let state_field = Field {
        name: "ok".into(),
        ty: Type::Bool,
    };
    let c = contract(
        vec![state_field.clone()],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![predicate(
            "unsafe",
            field(load(0, Type::Record(vec![state_field])), "ok", Type::Bool),
            3,
        )],
    );

    let error = run(&c, &options(0, 1, 1, 0), {
        let invocation = invocation.clone();
        let finishes = finishes.clone();
        move || {
            let current = invocation.get();
            invocation.set(current + 1);
            Ok(FinishControlled {
                inner: MemoryApp::new(json!({"ok": false}), no_change),
                finishes: finishes.clone(),
                fail: current == 2,
            })
        }
    })
    .unwrap_err();

    match error {
        VerifyError::Unstable { failure, .. } => {
            assert_eq!(failure.property, "unsafe");
            assert_eq!(failure.shrink.confirmations, 1);
        }
        other => panic!("unexpected error: {other:?}"),
    }
    assert_eq!(finishes.get(), 3);
}

#[test]
fn finish_error_during_original_confirmation_reports_zero_confirmations() {
    let invocation = Rc::new(Cell::new(0));
    let finishes = Rc::new(Cell::new(0));
    let state_field = Field {
        name: "ok".into(),
        ty: Type::Bool,
    };
    let c = contract(
        vec![state_field.clone()],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![predicate(
            "unsafe",
            field(load(0, Type::Record(vec![state_field])), "ok", Type::Bool),
            3,
        )],
    );

    let error = run(&c, &options(0, 1, 1, 0), {
        let invocation = invocation.clone();
        let finishes = finishes.clone();
        move || {
            let current = invocation.get();
            invocation.set(current + 1);
            Ok(FinishControlled {
                inner: MemoryApp::new(json!({"ok": false}), no_change),
                finishes: finishes.clone(),
                fail: current == 1,
            })
        }
    })
    .unwrap_err();

    match error {
        VerifyError::Unstable { failure, .. } => {
            assert_eq!(failure.property, "unsafe");
            assert_eq!(failure.shrink.confirmations, 0);
        }
        other => panic!("unexpected error: {other:?}"),
    }
    assert_eq!(finishes.get(), 2);
}

#[test]
fn application_failure_during_campaign_is_not_reported_as_a_property_failure() {
    let c = contract(
        vec![],
        vec![Action {
            kind: ActionKind::Application,
            name: "tick".into(),
            params: vec![],
            postconditions: vec![],
        }],
        vec![true_predicate("safe")],
    );

    let error = run::<MemoryApp, _>(&c, &options(0, 1, 1, 8), || {
        Err(AppError::new("fixture-protocol", "could not start"))
    })
    .unwrap_err();

    match error {
        VerifyError::Application(error) => assert_eq!(error.code, "fixture-protocol"),
        other => panic!("unexpected error: {other:?}"),
    }
}
