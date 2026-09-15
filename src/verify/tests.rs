use super::*;
use crate::ir::Field;
use crate::semantics::compile;
use serde_json::json;
use std::cell::RefCell;
use std::rc::Rc;

struct TraceApp {
    state: Value,
    events: Rc<RefCell<Vec<String>>>,
}

impl Application for TraceApp {
    fn reset(&mut self) -> Result<(), AppError> {
        self.state = json!({"armed":false,"target":true,"other":true});
        self.events.borrow_mut().push("reset".into());
        Ok(())
    }
    fn call(&mut self, call: &Call) -> Result<(), AppError> {
        self.events.borrow_mut().push(call.action.clone());
        match call.action.as_str() {
            "B" => self.state["armed"] = json!(true),
            "D" if self.state["armed"] == true => self.state["target"] = json!(false),
            "D" => self.state["other"] = json!(false),
            _ => {}
        }
        Ok(())
    }
    fn observe(&mut self, _schema: &[Field]) -> Result<Value, AppError> {
        self.events.borrow_mut().push("observe".into());
        Ok(self.state.clone())
    }
    fn finish(&mut self) -> Result<(), AppError> {
        self.events.borrow_mut().push("finish".into());
        Ok(())
    }
}

#[test]
fn shrinker_removes_a_c_e_and_preserves_target_instead_of_other() {
    let contract = compile(
        "trace.bla",
        r#"
state armed: bool
state target: bool
state other: bool
action A()
action B()
action C()
action D()
action E()
always "target" { target }
always "other" { other }
"#,
    )
    .unwrap();
    let original: Vec<_> = ["A", "B", "C", "D", "E"]
        .into_iter()
        .map(|name| Call {
            action: name.into(),
            args: vec![],
        })
        .collect();
    let mut factory = || {
        Ok(TraceApp {
            state: Value::Null,
            events: Rc::default(),
        })
    };
    let ReplayOutcome::Failure(failure) = replay_fresh(&contract, &mut factory, &original).unwrap()
    else {
        panic!("fixture must fail")
    };
    assert_eq!(failure.predicate.label, "target");
    let reduced = reduce(&contract, &mut factory, original, *failure, "target", 128).unwrap();
    assert_eq!(
        reduced
            .sequence
            .iter()
            .map(|call| call.action.as_str())
            .collect::<Vec<_>>(),
        ["B", "D"]
    );
    assert_eq!(reduced.status, ShrinkStatus::FixedPoint);
    let ReplayOutcome::Failure(failure) =
        replay_fresh(&contract, &mut factory, &reduced.sequence).unwrap()
    else {
        panic!("reduced trace must fail")
    };
    assert_eq!(failure.predicate.label, "target");
}

#[test]
fn generation_and_replay_observe_immediately_before_and_after_every_action() {
    let contract = compile("sequence.bla", r#"action A() always "safe" { true }"#).unwrap();
    let events = Rc::new(RefCell::new(Vec::new()));
    let mut factory = || {
        Ok(TraceApp {
            state: Value::Null,
            events: events.clone(),
        })
    };
    let options = RunOptions {
        seed: 0,
        cases: 1,
        steps: 2,
        shrink_budget: 0,
    };
    let report = run(&contract, &options, &mut factory).unwrap();
    let expected = [
        "reset", "observe", "observe", "A", "observe", "observe", "A", "observe", "finish",
    ];
    assert_eq!(*events.borrow(), expected);
    events.borrow_mut().clear();
    assert!(matches!(
        replay_fresh(&contract, &mut factory, &report.sequences[0]).unwrap(),
        ReplayOutcome::Pass
    ));
    assert_eq!(*events.borrow(), expected);
}

#[test]
fn optional_and_float_evaluation_preserves_guards_arithmetic_and_unique_equality() {
    let contract = compile(
        "values.bla",
        r#"
state reading: optional<float>
state values: [optional<float>]
action inspect()
always "guard" { reading == null or reading > 0.0 }
always "arithmetic" { -1.5 + 2.25 == 0.75 and 4.0 - 0.5 == 3.5 }
always "unique" { unique(values, item => item) }
"#,
    )
    .unwrap();
    assert!(
        check_invariants(&contract, &json!({"reading":null,"values":[null,1.25,2.0]}))
            .unwrap()
            .is_none()
    );
    let failure = check_invariants(&contract, &json!({"reading":1.0,"values":[-0.0,0.0]}))
        .unwrap()
        .unwrap();
    assert_eq!(failure.predicate.label, "unique");
    let overflow = compile("overflow.bla", r#"action inspect() always "finite" { 1.7976931348623157e308 + 1.7976931348623157e308 == 0.0 }"#).unwrap();
    assert!(
        matches!(check_invariants(&overflow, &json!({})), Err(VerifyError::Contract(Diagnostic { code, .. })) if code == "BLA-EVAL-FLOAT")
    );
}
