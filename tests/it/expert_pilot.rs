use blabla::expert::pilot::{Clock, Refusal};

#[test]
fn clock_detects_boot_backward_and_elapsed_discontinuities() {
    let prior = Clock {
        boot_id: "boot-a".into(),
        boottime_ms: 5000,
        unix_ms: 10000,
    };
    let current = Clock {
        boot_id: "boot-a".into(),
        boottime_ms: 6000,
        unix_ms: 11000,
    };
    assert_eq!(current.check_after(&prior), Ok(()));
    for bad in [
        Clock {
            boot_id: "boot-b".into(),
            ..current.clone()
        },
        Clock {
            boottime_ms: 4999,
            ..current.clone()
        },
        Clock {
            unix_ms: 9999,
            ..current.clone()
        },
        Clock {
            unix_ms: 13001,
            ..current.clone()
        },
    ] {
        assert_eq!(bad.check_after(&prior), Err(Refusal::ClockUncertain));
    }
}

#[test]
fn budget_charge_is_atomic_and_exhaustion_never_refills() {
    use blabla::expert::pilot::{Budgets, Spent};
    let limits = Budgets {
        provider_attempts: 2,
        evaluated_questions: 3,
        delivery_attempts: 1,
        max_wall_ms: 1000,
    };
    let mut spent = Spent::default();
    spent.charge(&limits, 1, 2, 0).unwrap();
    let saved = spent.clone();
    assert_eq!(
        spent.charge(&limits, 1, 2, 0),
        Err(Refusal::BudgetExhausted)
    );
    assert_eq!(spent, saved);
    spent.charge(&limits, 1, 1, 1).unwrap();
    let mut reopened: Spent = serde_json::from_slice(&serde_json::to_vec(&spent).unwrap()).unwrap();
    assert_eq!(
        reopened.charge(&limits, 1, 1, 0),
        Err(Refusal::BudgetExhausted)
    );
    assert_eq!(
        reopened.charge(&limits, 0, 0, 1),
        Err(Refusal::BudgetExhausted)
    );
}

#[test]
fn old_feasibility_and_production_promotion_shapes_cannot_issue_permits() {
    use blabla::expert::{native, pilot::PermitRequest, trace::PromotionRecord};
    assert!(
        native::decode::<PermitRequest>(
            br#"{"schema_version":1,"initial_completed":true,"general_delivery_certified":false}"#
        )
        .is_err()
    );
    assert!(
        serde_json::from_str::<PromotionRecord>(
            r#"{"kind":"experimental_permit","promotion_eligible":false}"#
        )
        .is_err()
    );
}
