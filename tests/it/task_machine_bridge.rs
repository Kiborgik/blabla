use crate::component::Component;
use crate::source_cli::Campaign;
use crate::task_machine::TaskMachine;
use serde_json::{Value, json};
use std::path::PathBuf;

fn machine() -> TaskMachine {
    TaskMachine::with_campaign(Campaign::with_executable(PathBuf::from(env!(
        "CARGO_BIN_EXE_blabla"
    ))))
}

fn act(machine: &mut TaskMachine, name: &str, args: Value) -> Value {
    machine
        .call(name, &args)
        .expect("a task-machine action")
        .unwrap();
    machine.observe(&Value::Null)
}

fn opened(shape: [bool; 4]) -> (TaskMachine, Value) {
    let mut machine = machine();
    let observed = act(&mut machine, "machine_fixture", json!(shape));
    (machine, observed)
}

const SCOPED: [bool; 4] = [false, false, false, true];
const GOAL: [bool; 4] = [true, false, false, true];
const INTENT: [bool; 4] = [false, true, false, true];
const EMPTY: [bool; 4] = [false, false, true, true];
const RED_GOAL_WITHOUT_SCOPE: [bool; 4] = [true, false, true, false];

fn raw_ready(machine: &mut TaskMachine, outcome: &str, lens: bool, intent: bool) -> Value {
    act(machine, "ready", json!([outcome, lens, intent]))
}

fn handed_back(machine: &mut TaskMachine, outcome: &str) -> Value {
    act(machine, "hand_back", json!([outcome]))
}

fn verified(shape: [bool; 4]) -> TaskMachine {
    let (mut machine, _) = opened(shape);
    act(&mut machine, "accept", json!([PINNED]));
    act(&mut machine, "run_evidence", json!([]));
    machine
}

fn decided(observed: &Value, state: &str, refused: bool) {
    assert_eq!(observed["task_state"], state, "{observed}");
    assert_eq!(observed["refused"], refused, "{observed}");
    assert_eq!(observed["record_unchanged"], refused, "{observed}");
}

const PINNED: &str = "pinned:9b";

#[test]
fn no_action_before_a_fixture_changes_the_absent_task() {
    let mut machine = machine();
    let initial = machine.observe(&Value::Null);
    assert_eq!(initial["machine_ready"], false);
    assert_eq!(initial["task_state"], "none");
    assert_eq!(initial["refused"], false);
    assert_eq!(initial["record_unchanged"], true);
    for (name, args) in [
        ("accept", json!([PINNED])),
        ("block", json!([])),
        ("run_evidence", json!([])),
        ("claim_evidence", json!([0])),
        ("change_input", json!([])),
        ("touch_outside_scope", json!([])),
        ("ready", json!(["", false, false])),
        ("ready", json!(["delivered", true, true])),
        ("close", json!([false, false])),
        ("close", json!([true, true])),
        ("withdraw", json!([])),
        ("inspect_budget", json!([])),
        ("inspect_views", json!([])),
        ("release_scope", json!([true])),
        ("release_scope", json!([false])),
        ("prepare_handback", json!([])),
        ("hand_back", json!([""])),
    ] {
        assert_eq!(act(&mut machine, name, args), initial, "{name}");
    }
}

#[test]
fn the_fixture_opens_one_task_shaped_by_its_inputs() {
    for shape in [SCOPED, INTENT, RED_GOAL_WITHOUT_SCOPE] {
        let [goal, intent, empty_scope, _] = shape;
        let (_, observed) = opened(shape);
        assert_eq!(observed["machine_ready"], true);
        assert_eq!(observed["task_state"], "open");
        assert_eq!(observed["refused"], false);
        assert_eq!(observed["record_unchanged"], false);
        assert_eq!(observed["serves_goal"], goal);
        assert_eq!(observed["asks_intent"], intent);
        assert_eq!(observed["affected_intents"], if intent { 1 } else { 0 });
        assert_eq!(observed["scope_empty"], empty_scope);
        assert_eq!(observed["scope_paths"], if empty_scope { 0 } else { 2 });
        assert_eq!(observed["evidence_kind"], "");
        assert_eq!(observed["any_evidence_current"], false);
        assert_eq!(observed["run_evidence_current"], false);
        assert_eq!(observed["evidence_passing"], false);
        assert_eq!(observed["open_findings"], 0);
        assert_eq!(observed["residual_findings"], 0);
        assert_eq!(observed["lens_assessments"], 0);
        assert_eq!(observed["intent_claims"], 0);
        assert_eq!(observed["model_challenged"], false);
        assert_eq!(observed["tree_matches_opening"], true);
    }
}

#[test]
fn an_exact_model_admits_itself_and_challenges_its_neighbour() {
    let (mut machine, _) = opened(SCOPED);
    let admitted = act(&mut machine, "accept", json!([PINNED]));
    decided(&admitted, "accepted", false);
    assert_eq!(admitted["model_challenged"], false);
    let neighbour = act(&mut machine, "accept", json!(["pinned:4b"]));
    decided(&neighbour, "accepted", false);
    assert_eq!(neighbour["model_challenged"], true);
}

#[test]
fn a_model_family_admits_its_members_and_reacceptance_keeps_executed_evidence() {
    let (mut machine, _) = opened(SCOPED);
    let member = act(&mut machine, "accept", json!(["family-1"]));
    decided(&member, "accepted", false);
    assert_eq!(member["model_challenged"], false);
    let run = act(&mut machine, "run_evidence", json!([]));
    assert_eq!(run["run_evidence_current"], true);
    let resumed = act(&mut machine, "accept", json!(["family-2"]));
    decided(&resumed, "accepted", false);
    assert_eq!(resumed["model_challenged"], false);
    assert_eq!(resumed["evidence_kind"], "executed");
    assert_eq!(resumed["run_evidence_current"], true);
}

#[test]
fn block_moves_only_an_accepted_task_and_leaves_its_finding_open() {
    let (mut machine, _) = opened(SCOPED);
    let early = act(&mut machine, "block", json!([]));
    decided(&early, "open", true);
    assert_eq!(early["open_findings"], 0);
    act(&mut machine, "accept", json!([PINNED]));
    let blocked = act(&mut machine, "block", json!([]));
    decided(&blocked, "blocked", false);
    assert_eq!(blocked["open_findings"], 1);
    let resumed = act(&mut machine, "accept", json!([PINNED]));
    decided(&resumed, "accepted", false);
    assert_eq!(resumed["open_findings"], 1);
}

#[test]
fn run_evidence_is_executed_and_a_changed_input_stales_it() {
    let (mut machine, _) = opened(SCOPED);
    let early = act(&mut machine, "run_evidence", json!([]));
    decided(&early, "open", true);
    assert_eq!(early["evidence_kind"], "");
    act(&mut machine, "accept", json!([PINNED]));
    let run = act(&mut machine, "run_evidence", json!([]));
    decided(&run, "accepted", false);
    assert_eq!(run["evidence_kind"], "executed");
    assert_eq!(run["run_evidence_current"], true);
    assert_eq!(run["evidence_passing"], true);
    let changed = act(&mut machine, "change_input", json!([]));
    assert_eq!(changed["refused"], false);
    assert_eq!(changed["record_unchanged"], true);
    assert_eq!(changed["task_state"], "accepted");
    assert_eq!(changed["evidence_kind"], "executed");
    assert_eq!(changed["run_evidence_current"], false);
    assert_eq!(changed["tree_matches_opening"], false);
}

#[test]
fn a_changed_input_follows_the_scope_after_a_release() {
    let (mut machine, _) = opened([false, false, false, false]);
    act(&mut machine, "release_scope", json!([false]));
    let prepared = act(&mut machine, "prepare_handback", json!([]));
    assert_eq!(prepared["run_evidence_current"], true);
    let changed = act(&mut machine, "change_input", json!([]));
    assert_eq!(changed["refused"], false);
    assert_eq!(changed["record_unchanged"], true);
    assert_eq!(changed["evidence_kind"], "executed");
    assert_eq!(changed["run_evidence_current"], false);
}

#[test]
fn with_no_input_left_a_change_is_refused_and_touches_nothing() {
    let (mut machine, _) = opened(SCOPED);
    act(&mut machine, "release_scope", json!([false]));
    act(&mut machine, "release_scope", json!([false]));
    let unchanged = act(&mut machine, "change_input", json!([]));
    assert_eq!(unchanged["scope_paths"], 0);
    assert_eq!(unchanged["refused"], true);
    assert_eq!(unchanged["record_unchanged"], true);
    assert_eq!(unchanged["tree_matches_opening"], true);
}

#[test]
fn a_claimed_exit_is_recorded_as_claimed_and_an_unrepresentable_one_is_refused() {
    let (mut machine, _) = opened(EMPTY);
    act(&mut machine, "accept", json!([PINNED]));
    let claimed = act(&mut machine, "claim_evidence", json!([3]));
    decided(&claimed, "accepted", false);
    assert_eq!(claimed["evidence_kind"], "claimed");
    assert_eq!(claimed["evidence_passing"], false);
    assert_eq!(claimed["run_evidence_current"], false);
    let unrepresentable = act(
        &mut machine,
        "claim_evidence",
        json!([i64::from(i32::MAX) + 1]),
    );
    decided(&unrepresentable, "accepted", true);
    assert_eq!(unrepresentable["evidence_kind"], "claimed");
}

#[test]
fn a_claimed_passing_exit_is_current_evidence_without_being_run_evidence() {
    let (mut machine, _) = opened(EMPTY);
    act(&mut machine, "accept", json!([PINNED]));
    let claimed = act(&mut machine, "claim_evidence", json!([0]));
    assert_eq!(claimed["evidence_kind"], "claimed");
    assert_eq!(claimed["any_evidence_current"], true);
    assert_eq!(claimed["run_evidence_current"], false);
}

#[test]
fn a_change_outside_the_scope_breaks_the_match_with_the_opening() {
    let (mut machine, _) = opened(SCOPED);
    let touched = act(&mut machine, "touch_outside_scope", json!([]));
    assert_eq!(touched["refused"], false);
    assert_eq!(touched["record_unchanged"], true);
    assert_eq!(touched["task_state"], "open");
    assert_eq!(touched["tree_matches_opening"], false);
}

#[test]
fn a_verified_task_hands_back_closes_and_then_refuses_every_resumption() {
    let (mut machine, _) = opened(SCOPED);
    let early = raw_ready(&mut machine, "", true, false);
    decided(&early, "open", true);
    act(&mut machine, "accept", json!([PINNED]));
    let unverified = raw_ready(&mut machine, "", true, false);
    decided(&unverified, "accepted", true);
    assert_eq!(unverified["lens_assessments"], 0);
    act(&mut machine, "run_evidence", json!([]));
    let unassessed = raw_ready(&mut machine, "", false, false);
    decided(&unassessed, "accepted", true);
    assert_eq!(unassessed["lens_assessments"], 0);
    let goalless = raw_ready(&mut machine, "delivered", true, false);
    decided(&goalless, "accepted", true);
    assert_eq!(goalless["lens_assessments"], 0);
    let ready = raw_ready(&mut machine, "", true, false);
    decided(&ready, "ready", false);
    assert_eq!(ready["lens_assessments"], 1);
    assert_eq!(ready["residual_findings"], 0);
    let closed = act(&mut machine, "close", json!([false, false]));
    decided(&closed, "closed", false);
    let resumed = act(&mut machine, "accept", json!([PINNED]));
    decided(&resumed, "closed", true);
    let withdrawn = act(&mut machine, "withdraw", json!([]));
    decided(&withdrawn, "closed", true);
}

#[test]
fn a_goal_task_hands_back_only_with_a_known_outcome_and_a_partial_one_leaves_a_residual() {
    let mut machine = verified(GOAL);
    let silent = raw_ready(&mut machine, "", true, false);
    decided(&silent, "accepted", true);
    let unknown = raw_ready(&mut machine, "finished", true, false);
    decided(&unknown, "accepted", true);
    assert_eq!(unknown["residual_findings"], 0);
    assert_eq!(unknown["lens_assessments"], 0);
    let partial = raw_ready(&mut machine, "partial", true, false);
    decided(&partial, "ready", false);
    assert_eq!(partial["residual_findings"], 1);
    assert_eq!(partial["open_findings"], 0);
    assert_eq!(partial["lens_assessments"], 1);
    let closed = act(&mut machine, "close", json!([false, false]));
    decided(&closed, "closed", false);
    assert_eq!(closed["residual_findings"], 1);
}

#[test]
fn an_intent_task_hands_back_only_with_a_claim_for_each_affected_intent() {
    let mut machine = verified(INTENT);
    let unclaimed = raw_ready(&mut machine, "", true, false);
    decided(&unclaimed, "accepted", true);
    assert_eq!(unclaimed["intent_claims"], 0);
    let claimed = raw_ready(&mut machine, "", true, true);
    decided(&claimed, "ready", false);
    assert_eq!(claimed["intent_claims"], 1);
    assert_eq!(claimed["lens_assessments"], 1);
}

#[test]
fn an_intent_task_with_no_affected_intent_hands_back_without_claims() {
    let mut machine = verified([false, true, true, true]);
    let accepted = machine.observe(&Value::Null);
    assert_eq!(accepted["asks_intent"], true);
    assert_eq!(accepted["affected_intents"], 0);
    let ready = raw_ready(&mut machine, "", true, true);
    decided(&ready, "ready", false);
    assert_eq!(ready["intent_claims"], 0);
}

#[test]
fn the_budget_reads_the_task_without_writing_it() {
    let mut machine = verified(SCOPED);
    let budget = act(&mut machine, "inspect_budget", json!([]));
    assert_eq!(budget["refused"], false);
    assert_eq!(budget["record_unchanged"], true);
    assert_eq!(budget["task_state"], "accepted");
}

#[test]
fn show_and_both_challenges_agree_on_attribution_spelling_and_the_project() {
    let (mut machine, _) = opened(SCOPED);
    for action in ["inspect_views", "touch_outside_scope", "inspect_views"] {
        act(&mut machine, action, json!([]));
    }
    let viewed = machine.observe(&Value::Null);
    assert_eq!(viewed["refused"], false);
    assert_eq!(viewed["tree_matches_opening"], false);
    for field in [
        "show_matches_challenge",
        "scope_spelling_kept",
        "unnamed_challenge_is_project_wide",
    ] {
        assert_eq!(viewed[field], true, "{field}: {viewed}");
    }
    let moved = act(&mut machine, "accept", json!([PINNED]));
    assert_eq!(moved["show_matches_challenge"], false);
}

#[test]
fn an_unchanged_path_leaves_the_scope_and_a_changed_one_stays() {
    let (mut machine, _) = opened(SCOPED);
    let released = act(&mut machine, "release_scope", json!([false]));
    decided(&released, "open", false);
    assert_eq!(released["scope_paths"], 1);
    let kept = act(&mut machine, "release_scope", json!([true]));
    decided(&kept, "open", true);
    assert_eq!(kept["scope_paths"], 1);
    let emptied = act(&mut machine, "release_scope", json!([false]));
    decided(&emptied, "open", false);
    assert_eq!(emptied["scope_paths"], 0);
    assert_eq!(emptied["scope_empty"], true);
    let outside = act(&mut machine, "release_scope", json!([true]));
    decided(&outside, "open", true);
    assert_eq!(outside["scope_paths"], 0);
}

#[test]
fn preparing_a_hand_back_accepts_a_family_member_with_executed_evidence() {
    let (mut machine, _) = opened(SCOPED);
    let prepared = act(&mut machine, "prepare_handback", json!([]));
    assert_eq!(prepared["task_state"], "accepted");
    assert_eq!(prepared["refused"], false);
    assert_eq!(prepared["model_challenged"], false);
    assert_eq!(prepared["evidence_kind"], "executed");
    assert_eq!(prepared["run_evidence_current"], true);
}

#[test]
fn every_fixture_shape_hands_back_and_closes_and_then_preparing_changes_nothing() {
    for shape in [
        SCOPED,
        GOAL,
        INTENT,
        [true, true, false, true],
        [false, true, true, true],
        RED_GOAL_WITHOUT_SCOPE,
    ] {
        let (mut machine, fresh) = opened(shape);
        let outcome = if shape[0] { "delivered" } else { "" };
        let ready = handed_back(&mut machine, outcome);
        decided(&ready, "ready", false);
        assert_eq!(ready["lens_assessments"], 1, "{shape:?}");
        assert_eq!(
            ready["intent_claims"], fresh["affected_intents"],
            "{shape:?}"
        );
        assert_eq!(ready["residual_findings"], 0, "{shape:?}");
        let closed = act(&mut machine, "close", json!([false, false]));
        decided(&closed, "closed", false);
        assert_eq!(closed["project_green"], shape[3], "{shape:?}");
        let idle = handed_back(&mut machine, outcome);
        assert_eq!(idle["task_state"], "closed", "{shape:?}");
        assert_eq!(idle["refused"], false, "{shape:?}");
        assert_eq!(idle["record_unchanged"], true, "{shape:?}");
    }
}

#[test]
fn a_hand_back_sends_only_an_outcome_the_task_can_take() {
    let (mut goalless, _) = opened(SCOPED);
    let dropped = handed_back(&mut goalless, "partial");
    decided(&dropped, "ready", false);
    assert_eq!(dropped["residual_findings"], 0);
    let (mut goal, _) = opened(GOAL);
    let defaulted = handed_back(&mut goal, "finished");
    decided(&defaulted, "ready", false);
    assert_eq!(defaulted["residual_findings"], 0);
}

#[test]
fn a_close_after_an_outside_change_measures_the_project_and_refuses_a_red_one() {
    let (mut green, _) = opened(SCOPED);
    handed_back(&mut green, "");
    let measured = act(&mut green, "close", json!([true, false]));
    assert_eq!(measured["tree_matches_opening"], false);
    assert_eq!(measured["project_green"], true);
    assert_eq!(measured["record_unchanged"], measured["refused"]);
    let (mut red, _) = opened(RED_GOAL_WITHOUT_SCOPE);
    handed_back(&mut red, "delivered");
    let refused = act(&mut red, "close", json!([true, false]));
    decided(&refused, "ready", true);
    assert_eq!(refused["tree_matches_opening"], false);
    assert_eq!(refused["project_green"], false);
    let (mut broken, _) = opened(SCOPED);
    handed_back(&mut broken, "");
    let broken_close = act(&mut broken, "close", json!([false, true]));
    decided(&broken_close, "ready", true);
    assert_eq!(broken_close["tree_matches_opening"], false);
    assert_eq!(broken_close["project_green"], false);
}

#[test]
fn a_handed_back_task_can_still_be_withdrawn() {
    let (mut machine, _) = opened(GOAL);
    handed_back(&mut machine, "delivered");
    let withdrawn = act(&mut machine, "withdraw", json!([]));
    decided(&withdrawn, "withdrawn", false);
}

#[test]
fn a_partial_hand_back_of_a_goal_task_leaves_one_residual() {
    let (mut machine, _) = opened(GOAL);
    let partial = handed_back(&mut machine, "partial");
    decided(&partial, "ready", false);
    assert_eq!(partial["residual_findings"], 1);
    assert_eq!(partial["open_findings"], 0);
    assert_eq!(partial["lens_assessments"], 1);
}

#[test]
fn an_intent_hand_back_records_a_claim_for_each_affected_intent() {
    let (mut machine, fresh) = opened([true, true, false, true]);
    assert_eq!(fresh["affected_intents"], 2);
    let claimed = handed_back(&mut machine, "delivered");
    decided(&claimed, "ready", false);
    assert_eq!(claimed["intent_claims"], 2);
    assert_eq!(claimed["residual_findings"], 0);
}

#[test]
fn withdraw_ends_a_live_task_once() {
    let (mut machine, _) = opened(RED_GOAL_WITHOUT_SCOPE);
    let withdrawn = act(&mut machine, "withdraw", json!([]));
    decided(&withdrawn, "withdrawn", false);
    let again = act(&mut machine, "withdraw", json!([]));
    decided(&again, "withdrawn", true);
}

#[test]
fn malformed_arguments_are_errors_and_foreign_actions_are_left_to_other_components() {
    let mut machine = machine();
    let initial = machine.observe(&Value::Null);
    for (name, args) in [
        ("machine_fixture", json!([true])),
        ("machine_fixture", json!(null)),
        ("machine_fixture", json!([true, false, true, 1])),
        ("accept", json!([1])),
        ("accept", json!([])),
        ("claim_evidence", json!(["0"])),
        ("claim_evidence", json!([1.5])),
        ("ready", json!(["", false])),
        ("ready", json!(["", 1, false])),
        ("block", json!([1])),
        ("close", json!({})),
        ("close", json!([])),
        ("close", json!([false])),
        ("inspect_budget", json!([1])),
        ("inspect_views", json!([false])),
        ("release_scope", json!(["x"])),
        ("release_scope", json!([])),
        ("prepare_handback", json!([true])),
        ("hand_back", json!([1])),
    ] {
        assert!(
            machine
                .call(name, &args)
                .expect("a task-machine action")
                .is_err(),
            "{name} {args}"
        );
    }
    assert!(machine.call("open_requested_role", &json!([])).is_none());
    assert_eq!(machine.observe(&Value::Null), initial);
}
