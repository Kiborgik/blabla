use super::*;
use crate::semantics::compile;
use serde_json::json;

fn legacy_best_call(
    action: &Action,
    state: &Value,
    guidance: &Guidance,
    coverage: &Coverage,
    target: usize,
    rng: &mut SplitMix64,
) -> Result<Call, VerifyError> {
    let mut best = guidance.candidate(action, state, rng)?;
    let mut score = coverage.score(target, state, &action_input(action, &best)?);
    for _ in 0..15 {
        let candidate = guidance.candidate(action, state, rng)?;
        for (index, value) in candidate.args.iter().enumerate() {
            let mut changed = best.clone();
            changed.args[index] = value.clone();
            let next = coverage.score(target, state, &action_input(action, &changed)?);
            if next > score {
                best = changed;
                score = next;
            }
        }
        let next = coverage.score(target, state, &action_input(action, &candidate)?);
        if next > score {
            best = candidate;
            score = next;
        }
    }
    Ok(best)
}

fn legacy_preparation_call(
    action: &Action,
    state: &Value,
    guidance: &Guidance,
    coverage: &Coverage,
    rng: &mut SplitMix64,
) -> Result<Call, VerifyError> {
    let mut best = guidance.candidate(action, state, rng)?;
    let mut score = coverage.action_score(&action.name, state, &action_input(action, &best)?);
    for _ in 0..15 {
        let candidate = guidance.candidate(action, state, rng)?;
        let next = coverage.action_score(&action.name, state, &action_input(action, &candidate)?);
        if next > score {
            best = candidate;
            score = next;
        }
    }
    Ok(best)
}

fn assert_next_draws_match(actual: &mut SplitMix64, expected: &mut SplitMix64) {
    for bound in [usize::MAX, 81, 340, 4, 3, 2, 1] {
        assert_eq!(
            actual.sample_below_rejecting_modulo_bias(bound),
            expected.sample_below_rejecting_modulo_bias(bound)
        );
    }
}

fn scoring_contract() -> Contract {
    compile(
        "scoring.bla",
        r#"
state value: int
state sealed: bool
action inspect()
action set(value: int)
when inspect { expect "preserved": not before.sealed or after.value == before.value }
when set { expect "set": after.value == input.value }
always "rare" { value != 99 or sealed }
"#,
    )
    .unwrap()
}

#[test]
fn prefix_scoring_preserves_zero_floor_nan_and_parameterized_repetitions() {
    let contract = scoring_contract();
    for action in &contract.actions {
        for score in [
            f64::NEG_INFINITY,
            -1.0,
            -0.0,
            0.0,
            0.5,
            1.0,
            f64::INFINITY,
            f64::NAN,
        ] {
            let expected = (0..4).fold(0.0_f64, |old, _| old.max(score));
            let mut calls = 0;
            let actual = prefix_score(action, || {
                calls += 1;
                Ok(score)
            })
            .unwrap();
            assert_eq!(actual.to_bits(), expected.to_bits());
            assert_eq!(calls, if action.params.is_empty() { 1 } else { 4 });
        }
    }
    let mut scores = [f64::NAN, -1.0, 0.5, 1.0].into_iter();
    assert_eq!(
        prefix_score(&contract.actions[1], || Ok(scores.next().unwrap())).unwrap(),
        1.0
    );
    assert!(scores.next().is_none());
    let mut calls = 0;
    let result = prefix_score(&contract.actions[1], || {
        calls += 1;
        Err(VerifyError::Internal("candidate failed".into()))
    });
    assert!(matches!(result, Err(VerifyError::Internal(message)) if message == "candidate failed"));
    assert_eq!(calls, 1);
}

#[test]
fn optimized_call_selection_matches_legacy_calls_scores_and_rng() {
    let contract = scoring_contract();
    let guidance = Guidance::new(&contract);
    let coverage = Coverage::new(&contract);
    for state in [
        json!({"value":0,"sealed":false}),
        json!({"value":99,"sealed":true}),
        json!({"value":-99,"sealed":true}),
    ] {
        let original = state.clone();
        for seed in [0, 1, 99, u64::MAX] {
            for action in &contract.actions {
                for target in 0..coverage.reports.len() {
                    let mut actual_rng = SplitMix64::new(seed);
                    let mut expected_rng = SplitMix64::new(seed);
                    let actual = best_call(
                        action,
                        &state,
                        &guidance,
                        &coverage,
                        target,
                        &mut actual_rng,
                    )
                    .unwrap();
                    let expected = legacy_best_call(
                        action,
                        &state,
                        &guidance,
                        &coverage,
                        target,
                        &mut expected_rng,
                    )
                    .unwrap();
                    assert_eq!(actual, expected);
                    assert_eq!(
                        coverage
                            .score(target, &state, &action_input(action, &actual).unwrap())
                            .to_bits(),
                        coverage
                            .score(target, &state, &action_input(action, &expected).unwrap())
                            .to_bits()
                    );
                    assert_next_draws_match(&mut actual_rng, &mut expected_rng);
                }
                let mut actual_rng = SplitMix64::new(seed);
                let mut expected_rng = SplitMix64::new(seed);
                let actual =
                    preparation_call(action, &state, &guidance, &coverage, &mut actual_rng)
                        .unwrap();
                let expected = legacy_preparation_call(
                    action,
                    &state,
                    &guidance,
                    &coverage,
                    &mut expected_rng,
                )
                .unwrap();
                assert_eq!(actual, expected);
                assert_next_draws_match(&mut actual_rng, &mut expected_rng);
            }
        }
        assert_eq!(state, original);
    }
}

#[test]
fn optimized_prefix_scores_preserve_rng_and_shortest_prefix_ties() {
    let contract = scoring_contract();
    let guidance = Guidance::new(&contract);
    let coverage = Coverage::new(&contract);
    let states = [
        json!({"value":0,"sealed":false}),
        json!({"value":0,"sealed":false}),
        json!({"value":99,"sealed":true}),
    ];
    let lengths = [7, 2, 4];
    for target in 0..coverage.reports.len() {
        let mut actual_rng = SplitMix64::new(42);
        let mut expected_rng = SplitMix64::new(42);
        let mut actual_best = None;
        let mut expected_best = None;
        let mut actual_best_score = f64::NEG_INFINITY;
        let mut expected_best_score = f64::NEG_INFINITY;
        for (entry, state) in states.iter().enumerate() {
            let action = target_action(&contract, &coverage, target, &mut actual_rng);
            let expected_action = target_action(&contract, &coverage, target, &mut expected_rng);
            assert_eq!(action.name, expected_action.name);
            let actual = prefix_score(action, || {
                let call = guidance.candidate(action, state, &mut actual_rng)?;
                Ok(coverage.preparation_score(target, state, &action_input(action, &call)?))
            })
            .unwrap();
            let mut expected = 0.0_f64;
            for _ in 0..4 {
                let call = guidance
                    .candidate(expected_action, state, &mut expected_rng)
                    .unwrap();
                expected = expected.max(coverage.preparation_score(
                    target,
                    state,
                    &action_input(expected_action, &call).unwrap(),
                ));
            }
            assert_eq!(actual.to_bits(), expected.to_bits());
            if actual > actual_best_score
                || (actual == actual_best_score
                    && actual_best.is_some_and(|old: usize| lengths[entry] < lengths[old]))
            {
                actual_best_score = actual;
                actual_best = Some(entry);
            }
            if expected > expected_best_score
                || (expected == expected_best_score
                    && expected_best.is_some_and(|old: usize| lengths[entry] < lengths[old]))
            {
                expected_best_score = expected;
                expected_best = Some(entry);
            }
        }
        assert_eq!(actual_best, expected_best);
        assert_next_draws_match(&mut actual_rng, &mut expected_rng);
    }
}
