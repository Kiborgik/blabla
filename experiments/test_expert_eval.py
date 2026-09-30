import copy
import importlib.util
import json
import math
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "experiments" / "expert_eval.py"
DATA = ROOT / "evals" / "expert-loop"
SPEC = importlib.util.spec_from_file_location("expert_eval", SOURCE) if SOURCE.exists() else None
EVAL = importlib.util.module_from_spec(SPEC) if SPEC else None
if SPEC:
    SPEC.loader.exec_module(EVAL)


def case(name, nudge=True, judgment="claim-support"):
    return {"case_id": name, "family": judgment, "judgment": judgment,
            "binding_id": "binding::" + judgment, "task_id": "task::frozen",
            "checkpoint_id": name, "snapshot_fingerprint": "snapshot",
            "question_fingerprint": "question", "template_fingerprint": "template",
            "scenario": "normal", "input": {},
            "gold": {"justified_nudge": nudge, "label": "candidate-2" if judgment == "expertise-selection" else "unsupported"}}


def run(name="r", evidence_kind="fixture", arm="shadow"):
    return {"run_id": name, "task_id": "task::frozen", "arm": arm,
            "evidence_kind": evidence_kind, "provider": {"provider": "fixture", "model": "fixed", "checkpoint": "v1"},
            "status": "completed", "snapshot_fingerprint": "snapshot",
            "controls": {"worker": "fixed", "tools": "fixed", "host": "fixed", "onboarding": "fixed", "rules": "fixed", "environment": "fixed"},
            "budget": {"wall_ms": 600000, "calls": 20, "cost": 0},
            "wall_ms": 10, "calls": 0, "cost": 0, "worker_overhead_ms": 0, "correctness": "pass", "scope": "pass",
            "grader": {"independent": True, "evidence_ids": ["grading"]},
            "owner_interventions": 0, "steering_ms": 0, "rework_ms": 0}


def observation(name, outcome="nudge", run_id="r", **values):
    result = {"case_id": name, "run_id": run_id, "outcome": outcome,
              "evaluable": True, "current": True,
              "snapshot_fingerprint": "snapshot", "question_fingerprint": "question",
              "template_fingerprint": "template", "delivery": None, "latency": None,
              "usage": None, "acknowledged": False, "correction_evidence_ids": []}
    result.update(values)
    return result


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(EVAL, "evaluation implementation is absent")

    def score(self, cases, observations, runs=None):
        return EVAL.score(cases, observations, runs or [run()])

    def test_false_nudge_denominator_counts_all_proposed(self):
        m = self.score([case("yes"), case("no", False)], [observation("yes"), observation("no")])["metrics"]
        self.assertEqual(m["would_nudge"], {"numerator": 2, "denominator": 2, "rate": 1.0})
        self.assertEqual(m["false_would_nudge"], {"numerator": 1, "denominator": 2, "rate": 0.5})
        self.assertEqual(m["delivered_nudges"], 0)
        self.assertEqual(m["simulated_deliveries"], 0)

    def test_missed_denominator_retains_silence_abstain_failure_missing(self):
        cases = [case(name) for name in ("n", "s", "a", "f", "m")]
        obs = [observation("n"), observation("s", "silence"), observation("a", "abstain"), observation("f", "failure", evaluable=False)]
        m = self.score(cases, obs)["metrics"]
        self.assertEqual(m["missed_would_nudge"], {"numerator": 4, "denominator": 5, "rate": 0.8})
        self.assertEqual(m["planned_checkpoints"], 5)
        self.assertEqual(m["observed_checkpoints"], 4)
        self.assertEqual(m["evaluable_checkpoints"], 3)
        self.assertEqual(m["abstentions"], 1)
        self.assertEqual(m["failures"], 1)

    def test_live_delivery_and_acknowledgment_do_not_imply_correction(self):
        r = run(evidence_kind="matched_live_expanded", arm="advisory")
        o = observation("n", delivery={"receipt_id": "d", "same_task": True, "event_to_delivery_ms": 20}, acknowledged=True)
        m = self.score([case("n")], [o], [r])["metrics"]
        self.assertEqual(m["delivered_nudges"], 1)
        self.assertEqual(m["acknowledgments"], 1)
        self.assertEqual(m["observed_corrections"], 0)
        self.assertEqual(m["false_nudge"]["denominator"], 1)

    def test_fixture_receipts_remain_simulated(self):
        o = observation("n", delivery={"receipt_id": "d", "same_task": True, "event_to_delivery_ms": 20}, acknowledged=True, correction_evidence_ids=["later-observation"])
        m = self.score([case("n")], [o])["metrics"]
        self.assertEqual(m["delivered_nudges"], 0)
        self.assertEqual(m["simulated_deliveries"], 1)
        self.assertEqual(m["acknowledgments"], 0)
        self.assertEqual(m["observed_corrections"], 0)

    def test_stale_and_duplicate_results_never_hide_missing_opportunity(self):
        observations = [observation("n", current=False), observation("n")]
        m = self.score([case("n")], observations)["metrics"]
        self.assertEqual(m["stale_rejections"], 1)
        self.assertEqual(m["duplicate_rejections"], 1)
        self.assertEqual(m["would_nudge"]["numerator"], 0)
        self.assertEqual(m["missed_would_nudge"]["numerator"], 1)

    def test_snapshot_or_question_mismatch_rejects_result(self):
        for key in ("snapshot_fingerprint", "question_fingerprint", "template_fingerprint"):
            with self.subTest(key=key):
                m = self.score([case("n")], [observation("n", **{key: "different"})])["metrics"]
                self.assertEqual(m["stale_rejections"], 1)
                self.assertEqual(m["would_nudge"]["numerator"], 0)

    def test_provider_and_judgment_groups_preserve_missing_denominators(self):
        first, second = run("one"), run("two")
        second["provider"]["model"] = "other"
        result = self.score([case("n")], [observation("n", run_id="one")], [first, second])
        self.assertEqual(len(result["groups"]), 2)
        self.assertEqual(result["metrics"]["missed_would_nudge"]["denominator"], 2)
        self.assertEqual(sorted(g["metrics"]["missed_would_nudge"]["numerator"] for g in result["groups"]), [0, 1])

    def test_incomplete_runs_are_separate_from_completed_grades_and_time(self):
        incomplete = run("blocked")
        incomplete.update(status="blocked", stop_reason="protected_runtime", correctness=None, scope=None, wall_ms=None)
        result = self.score([case("n")], [], [incomplete])
        self.assertEqual(result["runs"]["planned"], 1)
        self.assertEqual(result["runs"]["completed"], 0)
        self.assertEqual(result["runs"]["incomplete"], 1)
        self.assertIsNone(result["runs"]["steering_ms_per_completed_task"])
        self.assertEqual(result["metrics"]["missed_would_nudge"]["denominator"], 1)

    def test_usage_deduplicates_only_explicit_shared_batch(self):
        common = {"calls": 1, "input_tokens": 100, "output_tokens": 10, "cost": None, "local_batch_id": "batch", "provider_request_id": "shared"}
        obs = [observation("a", usage=common), observation("b", usage=common)]
        m = self.score([case("a"), case("b")], obs)["metrics"]
        self.assertEqual(m["calls"], 1)
        self.assertEqual(m["input_tokens"], 100)
        for o in obs:
            o["usage"] = {**common, "local_batch_id": None}
        self.assertEqual(self.score([case("a"), case("b")], obs)["metrics"]["calls"], 2)

    def test_failed_and_stale_evaluations_keep_measured_usage(self):
        usage = {"calls": 1, "input_tokens": 100, "output_tokens": 10, "cost": 0, "local_batch_id": None}
        observations = [observation("f", "failure", evaluable=False, usage=usage), observation("s", current=False, usage=usage)]
        m = self.score([case("f"), case("s")], observations)["metrics"]
        self.assertEqual(m["calls"], 2)
        self.assertEqual(m["input_tokens"], 200)
        self.assertEqual(m["measurable_cost"], 0)

    def test_missing_token_usage_is_unknown_and_not_zero_or_error(self):
        m = self.score([case("n")], [observation("n", usage={"calls": 1, "input_tokens": None, "output_tokens": 3, "cost": None})])["metrics"]
        self.assertEqual(m["calls"], 1)
        self.assertIsNone(m["input_tokens"])
        self.assertEqual(m["input_tokens_missing"], 1)
        self.assertEqual(m["output_tokens"], 3)

    def test_unknown_owner_interventions_are_not_reported_as_zero(self):
        r = run()
        r["owner_interventions"] = None
        result = self.score([case("n")], [observation("n")], [r])
        self.assertIsNone(result["runs"]["owner_interventions"])

    def test_latency_missing_component_is_visible_not_invented(self):
        o = observation("n", latency={"retrieval_ms": 3, "inference_ms": 10, "queue_ms": None, "delivery_ms": None}, delivery={"receipt_id": "d", "same_task": True, "event_to_delivery_ms": 25})
        m = self.score([case("n")], [o], [run(evidence_kind="matched_live_expanded", arm="advisory")])["metrics"]
        self.assertEqual(m["event_to_delivery_ms"]["p95"], 25)
        self.assertEqual(m["latency_components"]["queue_ms"]["missing"], 1)
        self.assertIsNone(m["latency_components"]["queue_ms"]["p95"])

    def test_selection_alone_never_counts_as_expertise_advice(self):
        c = case("selection", judgment="expertise-selection")
        c["family"] = "expertise"
        o = observation("selection", selected_candidate="candidate-1", pair_id="pair")
        m = self.score([c], [o])["metrics"]
        self.assertEqual(m["would_nudge"]["numerator"], 0)
        self.assertEqual(m["missed_would_nudge"]["denominator"], 0)
        self.assertEqual(m["selection_only"], 1)

    def test_usefulness_requires_current_independent_selection(self):
        cases = [case("useful", judgment="expertise-useful"), case("selection", judgment="expertise-selection")]
        for c in cases:
            c["family"] = "expertise"
        useful = observation("useful", pair_id="pair")
        selection = observation("selection", selected_candidate="candidate-2", pair_id="pair")
        self.assertEqual(self.score(cases, [useful])["metrics"]["would_nudge"]["numerator"], 0)
        complete = self.score(cases, [useful, selection])
        self.assertEqual(complete["metrics"]["would_nudge"]["numerator"], 1)
        useful_group = next(g for g in complete["groups"] if g["judgment"] == "expertise-useful")
        self.assertEqual(useful_group["metrics"]["would_nudge"]["numerator"], 1)
        selection["current"] = False
        self.assertEqual(self.score(cases, [useful, selection])["metrics"]["would_nudge"]["numerator"], 0)

    def test_wrong_expertise_candidate_is_false_without_hiding_proposal(self):
        cases = [case("useful", judgment="expertise-useful"), case("selection", judgment="expertise-selection")]
        for c in cases:
            c["family"] = "expertise"
        cases[1]["gold"]["label"] = "candidate-1"
        observations = [observation("useful", pair_id="pair", delivery={"receipt_id": "d", "same_task": True, "event_to_delivery_ms": 20}), observation("selection", selected_candidate="candidate-4", pair_id="pair")]
        m = self.score(cases, observations, [run(evidence_kind="matched_live_expanded", arm="advisory")])["metrics"]
        self.assertEqual(m["would_nudge"]["numerator"], 1)
        self.assertEqual(m["false_would_nudge"], {"numerator": 1, "denominator": 1, "rate": 1.0})
        self.assertEqual(m["false_nudge"], {"numerator": 1, "denominator": 1, "rate": 1.0})
        self.assertEqual(m["missed_nudge"]["numerator"], 1)
        self.assertEqual(m["selection_errors"], 1)
        self.assertEqual(m["selection_evaluated"], 1)

    def test_failed_selection_flag_cannot_enable_joint_advice(self):
        cases = [case("useful", judgment="expertise-useful"), case("selection", judgment="expertise-selection")]
        for c in cases:
            c["family"] = "expertise"
        obs = [observation("useful", pair_id="pair"), observation("selection", "failure", selected_candidate="candidate-2", pair_id="pair", evaluable=True)]
        self.assertEqual(self.score(cases, obs)["metrics"]["would_nudge"]["numerator"], 0)

    def test_expertise_selection_must_share_exact_snapshot(self):
        cases = [case("useful", judgment="expertise-useful"), case("selection", judgment="expertise-selection")]
        for c in cases:
            c["family"] = "expertise"
        cases[1]["snapshot_fingerprint"] = "other-context"
        obs = [observation("useful", pair_id="pair"), observation("selection", selected_candidate="candidate-1", pair_id="pair", snapshot_fingerprint="other-context")]
        self.assertEqual(self.score(cases, obs)["metrics"]["would_nudge"]["numerator"], 0)

    def test_conflicting_shared_usage_is_not_silently_deduplicated(self):
        common = {"calls": 1, "input_tokens": 100, "output_tokens": 10, "cost": 0, "local_batch_id": "batch", "provider_request_id": "shared"}
        obs = [observation("a", usage=common), observation("b", usage={**common, "input_tokens": 101})]
        with self.assertRaisesRegex(ValueError, "shared.*usage"):
            self.score([case("a"), case("b")], obs)

    def test_correction_requires_resolved_current_observation_evidence(self):
        o = observation("n", delivery={"receipt_id": "d", "same_task": True, "event_to_delivery_ms": 20}, correction_evidence_ids=["invented"])
        m = self.score([case("n")], [o], [run(evidence_kind="matched_live_expanded", arm="advisory")])["metrics"]
        self.assertEqual(m["observed_corrections"], 0)
        self.assertEqual(m["unresolved_corrections"], 1)
        o["correction_observations"] = [{"id": "invented", "source": "host_observation", "current": True, "observed_after_delivery": True, "task_id": "task::frozen", "capture_sha256": "a" * 64}]
        self.assertEqual(self.score([case("n")], [o], [run(evidence_kind="matched_live_expanded", arm="advisory")])["metrics"]["observed_corrections"], 1)

    def test_live_shadow_receipts_are_counted_as_invalid_real_deliveries(self):
        o = observation("n", delivery={"receipt_id": "d", "same_task": True, "event_to_delivery_ms": 20})
        m = self.score([case("n")], [o], [run(evidence_kind="matched_live_expanded", arm="shadow")])["metrics"]
        self.assertEqual(m["delivered_nudges"], 1)
        self.assertEqual(m["false_nudge"], {"numerator": 1, "denominator": 1, "rate": 1.0})
        self.assertEqual(m["invalid_delivery_receipts"], 1)

    def test_known_wrong_task_delivery_remains_false_and_missed(self):
        o = observation("n", delivery={"receipt_id": "wrong-task", "same_task": False, "event_to_delivery_ms": 20})
        m = self.score([case("n")], [o], [run(evidence_kind="matched_live_expanded", arm="advisory")])["metrics"]
        self.assertEqual(m["delivered_nudges"], 1)
        self.assertEqual(m["false_nudge"], {"numerator": 1, "denominator": 1, "rate": 1.0})
        self.assertEqual(m["missed_nudge"]["numerator"], 1)
        self.assertEqual(m["invalid_delivery_receipts"], 1)
        o["delivery"].pop("same_task")
        self.assertEqual(self.score([case("n")], [o], [run(evidence_kind="matched_live_expanded", arm="advisory")])["metrics"]["delivered_nudges"], 0)

    def test_stale_real_delivery_stays_in_false_nudge_denominator(self):
        o = observation("n", current=False, delivery={"receipt_id": "d", "same_task": True, "event_to_delivery_ms": 20})
        m = self.score([case("n")], [o], [run(evidence_kind="matched_live_expanded", arm="advisory")])["metrics"]
        self.assertEqual(m["delivered_nudges"], 1)
        self.assertEqual(m["false_nudge"], {"numerator": 1, "denominator": 1, "rate": 1.0})
        self.assertEqual(m["stale_rejections"], 1)
        self.assertEqual(m["missed_nudge"]["numerator"], 1)

    def test_duplicate_actual_receipt_does_not_double_count_delivery(self):
        o = observation("n", delivery={"receipt_id": "d", "same_task": True, "event_to_delivery_ms": 20})
        m = self.score([case("n")], [o, copy.deepcopy(o)], [run(evidence_kind="matched_live_expanded", arm="advisory")])["metrics"]
        self.assertEqual(m["delivered_nudges"], 1)
        self.assertEqual(m["duplicate_rejections"], 1)
        second = copy.deepcopy(o)
        second["delivery"]["receipt_id"] = "different-delivery"
        m = self.score([case("n")], [o, second], [run(evidence_kind="matched_live_expanded", arm="advisory")])["metrics"]
        self.assertEqual(m["delivered_nudges"], 2)
        self.assertEqual(m["false_nudge"]["numerator"], 1)

    def test_numeric_overflow_is_rejected_as_invalid_metric(self):
        with self.assertRaises(ValueError):
            EVAL.quantiles([10 ** 309])

    def test_zero_denominators_are_unknown(self):
        m = self.score([case("n", False)], [observation("n", "silence")])["metrics"]
        self.assertIsNone(m["false_would_nudge"]["rate"])
        self.assertIsNone(m["missed_would_nudge"]["rate"])
        self.assertIsNone(EVAL.exact_upper(0, 0))

    def test_exact_one_sided_binomial_upper_bound_edges(self):
        self.assertAlmostEqual(EVAL.exact_upper(0, 60), 1 - 0.05 ** (1 / 60), places=10)
        self.assertEqual(EVAL.exact_upper(60, 60), 1.0)
        self.assertLess(EVAL.exact_upper(0, 60), 0.05)
        self.assertGreater(EVAL.exact_upper(1, 60), 0.05)
        self.assertAlmostEqual(EVAL.exact_upper(1, 2), math.sqrt(0.95), places=10)
        with self.assertRaises(ValueError):
            EVAL.exact_upper(2, 1)

    def test_latency_quantile_uses_declared_nearest_rank(self):
        self.assertEqual(EVAL.quantiles(list(range(1, 21)))["p95"], 19)
        self.assertEqual(EVAL.quantiles([4])["p50"], 4)
        self.assertIsNone(EVAL.quantiles([])["p95"])

    def test_split_manifests_are_frozen_and_distinct(self):
        protocol = EVAL.load_protocol(DATA / "protocol.json")
        development = EVAL.load_split(DATA / "development", protocol, "development")
        holdout = EVAL.load_split(DATA / "holdout", protocol, "holdout")
        self.assertTrue(development["cases"])
        self.assertEqual({c["family"] for c in development["cases"]}, {"goal-drift", "expertise", "claim-support", "failed-approach"})
        self.assertFalse({c["snapshot_fingerprint"] for c in development["cases"]} & {c["snapshot_fingerprint"] for c in holdout["cases"]})
        self.assertEqual({c["scenario"] for c in holdout["cases"]}, {"normal", "ambiguous", "justified_repeat", "owner_approved_goal_change", "adversarial", "stale_evidence", "justified_intervention", "missing_context"})

    def test_development_calibration_preserves_expertise_pair_context(self):
        protocol = EVAL.load_protocol(DATA / "protocol.json")
        result = EVAL.calibrate(DATA / "development", protocol)
        useful = next(policy for policy in result["policies"] if policy["judgment"] == "expertise-useful")
        self.assertGreater(useful["candidates"][0]["false_would_nudge"]["denominator"], 0)
        self.assertTrue(useful["pair_required"])

    def test_holdout_cannot_be_loaded_by_calibration(self):
        protocol = EVAL.load_protocol(DATA / "protocol.json")
        with self.assertRaisesRegex(ValueError, "development"):
            EVAL.calibrate(DATA / "holdout", protocol)

    def test_modified_or_relabelled_data_cannot_pass_frozen_manifest(self):
        protocol = EVAL.load_protocol(DATA / "protocol.json")
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "development"
            target.mkdir()
            for p in (DATA / "holdout").iterdir():
                (target / p.name).write_bytes(p.read_bytes())
            manifest_path = target / "manifest.json"
            manifest = json.loads(manifest_path.read_text())
            manifest["split"] = "development"
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                EVAL.calibrate(target, protocol)

    def test_calibration_never_reads_holdout_files(self):
        protocol = EVAL.load_protocol(DATA / "protocol.json")
        original = Path.read_bytes
        def guarded(path):
            self.assertNotIn("holdout", path.parts)
            return original(path)
        with patch.object(Path, "read_bytes", guarded):
            result = EVAL.calibrate(DATA / "development", protocol)
        self.assertEqual(result["fit_split"], "development")
        self.assertEqual(result["promotion_records"], [])

    def test_small_fixture_quality_never_promotes(self):
        protocol = EVAL.load_protocol(DATA / "protocol.json")
        result = EVAL.replay(DATA / "holdout", protocol)
        self.assertEqual(result["evidence_kind"], "fixture_replay")
        self.assertEqual(result["promotion_records"], [])
        self.assertTrue(all(p["mode"] == "shadow" for p in result["promotion_assessment"]))
        self.assertEqual(result["metrics"]["delivered_nudges"], 0)

    def test_matched_arms_require_identical_snapshot_controls_and_budgets(self):
        arms = [run(arm, "matched_live_pilot", arm) for arm in ("off", "shadow", "advisory")]
        self.assertTrue(EVAL.validate_matched(arms)["matched"])
        for key in ("snapshot_fingerprint", "controls", "budget"):
            changed = copy.deepcopy(arms)
            changed[1][key] = "changed"
            self.assertFalse(EVAL.validate_matched(changed)["matched"])

    def test_missing_duplicate_arms_are_not_matched(self):
        arms = [run(arm, "matched_live_pilot", arm) for arm in ("off", "shadow", "advisory")]
        self.assertFalse(EVAL.validate_matched(arms[:2])["matched"])
        self.assertFalse(EVAL.validate_matched(arms + [arms[0]])["matched"])

    def test_pilot_and_fixture_cannot_pass_live_conclusion(self):
        arms = [run(arm, "matched_live_pilot", arm) for arm in ("off", "shadow", "advisory")]
        self.assertFalse(EVAL.live_conclusion(arms, phase="pilot")["passed"])
        for r in arms:
            r["evidence_kind"] = "fixture"
        self.assertFalse(EVAL.live_conclusion(arms, phase="expanded")["passed"])

    def test_expanded_requires_independent_grades_and_observed_steering_reduction(self):
        arms = [run(arm, "matched_live_expanded", arm) for arm in ("off", "shadow", "advisory")]
        arms[0]["steering_ms"] = 100
        arms[2]["steering_ms"] = 50
        self.assertTrue(EVAL.live_conclusion(arms, phase="expanded")["passed"])
        arms[2]["grader"]["independent"] = False
        self.assertFalse(EVAL.live_conclusion(arms, phase="expanded")["passed"])

    def test_current_blocked_host_reports_every_planned_arm_without_launch(self):
        protocol = EVAL.load_protocol(DATA / "protocol.json")
        with patch("subprocess.Popen") as launch:
            result = EVAL.live(protocol, DATA)
        launch.assert_not_called()
        self.assertEqual(result["status"], "blocked")
        self.assertEqual([r["arm"] for r in result["runs"]], ["off", "shadow", "advisory"])
        self.assertTrue(all(r["status"] == "blocked" for r in result["runs"]))
        self.assertEqual(result["planned_runs"], 3)
        self.assertEqual(result["completed_runs"], 0)
        self.assertEqual(result["promotion_records"], [])

    def test_run_case_join_is_exact_and_not_cross_product(self):
        cases = [case("a"), case("b")]
        cases[0]["task_id"], cases[1]["task_id"] = "task::a", "task::b"
        runs = [run("ra"), run("rb")]
        runs[0]["task_id"], runs[1]["task_id"] = "task::a", "task::b"
        result = self.score(cases, [observation("a", run_id="ra"), observation("b", run_id="rb")], runs)
        self.assertEqual(result["metrics"]["planned_checkpoints"], 2)
        self.assertEqual(result["metrics"]["coverage"]["rate"], 1.0)
        self.assertEqual(result["metrics"]["missed_would_nudge"]["numerator"], 0)
        self.assertEqual([g["task_ids"] for g in result["groups"]], [["task::a"], ["task::b"]])
        with self.assertRaisesRegex(ValueError, "outside planned"):
            self.score(cases, [observation("b", run_id="ra")], runs)

    def test_fixture_runs_can_explicitly_assign_multiple_task_cases(self):
        cases = [case("a"), case("b")]
        cases[0]["task_id"], cases[1]["task_id"] = "task::a", "task::b"
        r = run()
        r["case_ids"] = ["a", "b"]
        self.assertEqual(self.score(cases, [observation("a"), observation("b")], [r])["metrics"]["planned_checkpoints"], 2)

    def test_provider_question_and_template_metrics_are_not_pooled(self):
        cases = [case("one"), case("two")]
        cases[1]["question_fingerprint"] = "changed-question"
        obs = [observation("one"), observation("two", question_fingerprint="changed-question")]
        result = self.score(cases, obs)
        self.assertEqual(len(result["groups"]), 2)
        self.assertEqual({group["question_fingerprint"] for group in result["groups"]}, {"question", "changed-question"})

    def test_matched_runs_reject_provider_changes(self):
        arms = [run(arm, "matched_live_pilot", arm) for arm in ("off", "shadow", "advisory")]
        arms[2]["provider"]["model"] = "different"
        self.assertFalse(EVAL.validate_matched(arms)["matched"])

    def test_expanded_requires_observed_wall_call_and_cost_budgets(self):
        for field in ("wall_ms", "calls", "cost"):
            with self.subTest(field=field):
                arms = [run(arm, "matched_live_expanded", arm) for arm in ("off", "shadow", "advisory")]
                arms[0]["steering_ms"] = 100
                arms[2]["steering_ms"] = 50
                arms[2][field] = None
                result = EVAL.live_conclusion(arms, "expanded")
                self.assertFalse(result["passed"])
                self.assertIn("run_budget_measurements_missing", result["issues"])

    def test_missing_steering_baseline_does_not_count_as_zero(self):
        arms = [run(arm, "matched_live_expanded", arm) for arm in ("off", "shadow", "advisory")]
        arms[0]["steering_ms"] = None
        result = EVAL.live_conclusion(arms, "expanded")
        self.assertFalse(result["passed"])
        self.assertIn("steering_unobserved", result["issues"])

    def test_live_conclusion_rejects_run_budget_overage(self):
        arms = [run(arm, "matched_live_expanded", arm) for arm in ("off", "shadow", "advisory")]
        arms[0]["steering_ms"] = 100
        arms[2]["steering_ms"] = 50
        arms[2]["wall_ms"] = 600001
        result = EVAL.live_conclusion(arms, "expanded")
        self.assertFalse(result["passed"])
        self.assertIn("run_budget_exceeded", result["issues"])

    def test_protocol_and_split_digest_fingerprints_are_retained_in_calibration(self):
        protocol = EVAL.load_protocol(DATA / "protocol.json")
        result = EVAL.calibrate(DATA / "development", protocol)
        for policy in result["policies"]:
            self.assertIn("provider", policy)
            self.assertIn("question_fingerprint", policy)
            self.assertIn("template_fingerprint", policy)
            self.assertEqual(policy["development_fingerprint"], protocol["datasets"]["development"]["manifest_sha256"])

    def test_unknown_observation_identity_is_an_error(self):
        with self.assertRaisesRegex(ValueError, "outside planned"):
            self.score([case("n")], [observation("invented")])

    def test_false_and_nonfinite_usage_are_rejected(self):
        for value in (True, -1, float("inf"), 0.5):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.score([case("n")], [observation("n", usage={"calls": value})])

    def test_protocol_rejects_unapproved_or_nonfinite_budgets(self):
        protocol = EVAL.load_protocol(DATA / "protocol.json")
        for invalid in (float("nan"), -1, True):
            changed = copy.deepcopy(protocol)
            changed["budgets"]["goal-drift"]["p95_delivery_ms"] = invalid
            with self.assertRaises(ValueError):
                EVAL.validate_protocol(changed)

    def test_protocol_rejects_nonobject_and_unknown_fields(self):
        for invalid in ([], None, "protocol", 1):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                EVAL.validate_protocol(invalid)
        protocol = EVAL.load_protocol(DATA / "protocol.json")
        changed = copy.deepcopy(protocol)
        changed["unexpected_security_mode"] = "ignored"
        with self.assertRaises(ValueError):
            EVAL.validate_protocol(changed)
        changed = copy.deepcopy(protocol)
        changed["budgets"]["goal-drift"]["unexpected"] = "ignored"
        with self.assertRaises(ValueError):
            EVAL.validate_protocol(changed)
        changed = copy.deepcopy(protocol)
        changed["pilot"]["controls"] = []
        with self.assertRaises(ValueError):
            EVAL.validate_protocol(changed)

    def test_cli_nonobject_protocol_is_controlled_invalid_input(self):
        with tempfile.TemporaryDirectory() as directory:
            protocol = Path(directory) / "protocol.json"
            protocol.write_text("[]")
            result = subprocess.run([sys.executable, str(SOURCE), "live", "--protocol", str(protocol), "--out", str(Path(directory) / "out.json")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("Traceback", result.stderr)
        self.assertIn("expert evaluation failed", result.stderr)

    def test_duplicate_json_keys_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "duplicate.json"
            p.write_text('{"split":"development","split":"holdout"}')
            with self.assertRaisesRegex(ValueError, "duplicate"):
                EVAL.read_json(p)

    def runtime_fixture(self, path):
        result = {"request_id": "request-1", "packet_hash": "packet", "outcome": "nudge", "references": [], "template": None, "message": None, "reason": "fixture"}
        record = {"request": {"request_id": "request-1", "packet": {"hash": "packet", "event": {"run_id": "fixture-run", "task": "task::fixture"}}, "question_fingerprint": "runtime-question", "template_fingerprint": "runtime-template"}, "response": {"provider": {"provider": "fixture", "model": "fixed", "checkpoint": "v1"}}, "result": result, "implementation_fingerprints": {"policy": "fixed"}, "provenance": "imported", "mode": "shadow"}
        path.write_text(json.dumps(record))
        return result

    def test_runtime_replay_calls_only_source_cli_twice_and_has_no_delivery_credit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trace.json"
            expected = self.runtime_fixture(path)
            calls = []
            def capture(argv, workspace, environment, timeout):
                calls.append(argv)
                return {"outcome": "completed", "exit": 0, "stdout": {"capture_complete": True, "truncated": False}, "stderr": {"capture_complete": True, "truncated": False}}, json.dumps(expected), ""
            result = EVAL.runtime_replay(path, capture_fn=capture)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][:7], ["cargo", "run", "--quiet", "--bin", "blabla", "--", "expert"])
        self.assertEqual(calls[0][7], "replay")
        self.assertEqual(result["status"], "replayed")
        self.assertEqual(result["delivered_nudges"], 0)
        self.assertEqual(result["promotion_records"], [])
        self.assertEqual(result["question_fingerprint"], "runtime-question")
        self.assertEqual(result["evidence_kind"], "runtime_fixture_replay")

    def test_runtime_replay_mismatch_failure_and_truncation_are_incomplete(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trace.json"
            expected = self.runtime_fixture(path)
            for mode in ("mismatch", "failure", "truncated"):
                with self.subTest(mode=mode):
                    def capture(argv, workspace, environment, timeout):
                        output = {**expected, "reason": "different"} if mode == "mismatch" else expected
                        return {"outcome": "completed", "exit": 2 if mode == "failure" else 0, "stdout": {"capture_complete": True, "truncated": mode == "truncated"}, "stderr": {"capture_complete": True, "truncated": False}}, json.dumps(output), ""
                    result = EVAL.runtime_replay(path, capture_fn=capture)
                    self.assertEqual(result["status"], "incomplete")
                    self.assertEqual(result["promotion_records"], [])

    def test_runtime_trace_size_rejected_before_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trace.json"
            path.write_bytes(b"x" * 262145)
            def never(*args):
                self.fail("oversized trace reached source CLI")
            with self.assertRaises(ValueError):
                EVAL.runtime_replay(path, capture_fn=never)

    def test_cli_replay_and_blocked_live_emit_self_contained_records(self):
        with tempfile.TemporaryDirectory() as directory:
            for command in (("replay", "--split", "holdout"), ("live", "--protocol", str(DATA / "protocol.json"))):
                out = Path(directory) / (command[0] + ".json")
                completed = subprocess.run([sys.executable, str(SOURCE), *command, "--out", str(out)], cwd=ROOT, capture_output=True, text=True)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                record = json.loads(out.read_text())
                self.assertEqual(record["promotion_records"], [])
                self.assertIn("protocol_fingerprint", record)


if __name__ == "__main__":
    unittest.main()
