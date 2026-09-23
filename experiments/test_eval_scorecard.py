import json
from pathlib import Path
import tempfile
import unittest

from agent_eval_scorecard import build_scorecard, efficiency_of, write_scorecard


def criterion(identifier, status, weight=1, scored=True, reason="reason", evidence=None):
    return {"id": identifier, "status": status, "weight": weight, "scored": scored,
            "reason": reason, "evidence": evidence or []}


def run(case, host, arm, run_id, criteria):
    return {"case": case, "host": host, "arm": arm, "run": run_id, "valid": True, "criteria": criteria}


class ScorecardTests(unittest.TestCase):
    def test_weighted_points_unknown_bounds_and_diagnostic_exclusion(self):
        results = [run("case", "claude", "with", "1", [
            criterion("pass", "pass", 3), criterion("fail", "fail", 2),
            criterion("unknown", "unknown", 4), criterion("na", "not_applicable", 9),
            criterion("diagnostic", "pass", 20, scored=False),
        ])]
        coverage = {
            "systems": [{"id": "system", "title": "System", "authority": "owner"}],
            "capabilities": [{"id": "cap", "system": "system", "checks": [{"case": "case", "criterion": "pass"},
                {"case": "case", "criterion": "fail"}, {"case": "case", "criterion": "unknown"},
                {"case": "case", "criterion": "na"}, {"case": "case", "criterion": "diagnostic"}]}],
        }
        row = build_scorecard(results, coverage)["systems"]["rows"][0]
        self.assertEqual(row["points"]["earned"], 3)
        self.assertEqual(row["points"]["lost"], 2)
        self.assertEqual(row["points"]["unknown"], 4)
        self.assertEqual(row["points"]["available"], 9)
        self.assertEqual(row["points"]["lower"], 3)
        self.assertEqual(row["points"]["upper"], 7)
        self.assertFalse(row["points"]["complete"])
        self.assertEqual(row["points"]["diagnostic"], 1)
        self.assertEqual(row["points"]["not_applicable"], 1)

    def test_system_deduplicates_but_capabilities_and_behaviors_each_have_views(self):
        results = [run("case", "codex", "with", "1", [criterion("shared", "pass", 2)])]
        coverage = {
            "systems": [{"id": "sys", "title": "System", "authority": "owner"}],
            "capabilities": [{"id": "cap", "system": "sys", "checks": [{"case": "case", "criterion": "shared"}, {"case": "case", "criterion": "shared"}]}],
            "behaviors": [{"id": "behavior", "checks": [{"case": "case", "criterion": "shared"}]}],
        }
        scorecard = build_scorecard(results, coverage)
        self.assertEqual(scorecard["systems"]["rows"][0]["points"]["available"], 2)
        self.assertEqual(scorecard["capabilities"]["rows"][0]["points"]["earned"], 2)
        self.assertEqual(scorecard["behaviors"]["rows"][0]["points"]["earned"], 2)

    def test_a_case_or_criterion_the_runs_lack_is_reported_unmeasured(self):
        results = [run("present", "claude", "with", "1", [criterion("known", "pass")])]
        coverage = {
            "systems": [{"id": "sys", "title": "System", "authority": "owner"}],
            "capabilities": [{"id": "cap", "system": "sys", "checks": [
                {"case": "future", "criterion": "new"}, {"case": "present", "criterion": "known"}]}],
        }
        scorecard = build_scorecard(results, coverage)
        row = scorecard["systems"]["rows"][0]
        self.assertEqual(row["points"]["earned"], 1)
        self.assertFalse(row["points"]["complete"])
        self.assertIn("future/new", row["missing"][0])
        renamed = build_scorecard(results, {"capabilities": [{"id": "renamed", "checks": [{"case": "present", "criterion": "absent"}]}]})
        self.assertEqual(renamed["capabilities"]["rows"][0]["points"]["status"], "UNMEASURED")
        self.assertIn("present/absent", renamed["capabilities"]["rows"][0]["missing"][0])

        empty = build_scorecard(results, {"capabilities": [{"id": "future-cap", "checks": [{"case": "future", "criterion": "new"}]}]})
        self.assertEqual(empty["capabilities"]["rows"][0]["points"]["status"], "UNMEASURED")
        self.assertEqual(empty["absent_cases"], ["future"])
        self.assertEqual(empty["missing"]["capabilities"], [])

    def test_with_without_delta_requires_equal_nonzero_exposure(self):
        results = [
            run("case", "claude", "with", "1", [criterion("shared", "pass", 2), criterion("only-with", "pass", 1)]),
            run("case", "claude", "without", "1", [criterion("shared", "fail", 2)]),
        ]
        coverage = {"behaviors": [{"id": "b", "checks": [{"case": "case", "criterion": "shared"}]}]}
        delta = build_scorecard(results, coverage)["behaviors"]["deltas"][0]
        self.assertTrue(delta["comparable"])
        self.assertEqual((delta["lower"], delta["upper"]), (2, 2))
        unequal = {"behaviors": [{"id": "b", "checks": [{"case": "case", "criterion": "only-with"}]}]}
        delta = build_scorecard(results, unequal)["behaviors"]["deltas"][0]
        self.assertFalse(delta["comparable"])
        self.assertIsNone(delta["lower"])

    def test_delta_rejects_multiplicity_or_weight_mismatch(self):
        results = [
            run("case", "claude", "with", "1", [criterion("x", "pass", 2)]),
            run("case", "claude", "with", "2", [criterion("x", "pass", 2)]),
            run("case", "claude", "without", "1", [criterion("x", "pass", 2)]),
        ]
        coverage = {"behaviors": [{"id": "b", "checks": [{"case": "case", "criterion": "x"}]}]}
        delta = build_scorecard(results, coverage)["behaviors"]["deltas"][0]
        self.assertFalse(delta["comparable"])

        results[2]["criteria"][0]["weight"] = 3
        results.append(run("case", "claude", "without", "2", [criterion("x", "pass", 3)]))
        delta = build_scorecard(results, coverage)["behaviors"]["deltas"][0]
        self.assertFalse(delta["comparable"])

    def test_invalid_run_is_unknown_and_missing_capability_gap_reaches_system(self):
        invalid = run("case", "claude", "with", "1", [criterion("x", "pass", 4)])
        invalid["valid"] = False
        results = [invalid]
        coverage = {
            "systems": [{"id": "sys", "title": "System", "authority": "owner"}],
            "capabilities": [{"id": "cap", "system": "sys", "checks": [{"case": "case", "criterion": "x"}], "missing": ["future case is not staged"]}],
        }
        scorecard = build_scorecard(results, coverage)
        row = scorecard["capabilities"]["rows"][0]
        self.assertEqual(row["points"]["earned"], 0)
        self.assertEqual(row["points"]["unknown"], 4)
        self.assertFalse(row["points"]["complete"])
        self.assertIn("future case is not staged", scorecard["systems"]["rows"][0]["missing"])

    def test_zero_observation_and_html_escaping(self):
        results = [run("case", "claude", "with", "1", [criterion("x", "pass", reason="<unsafe>", evidence=["a&b"])])]
        coverage = {
            "capabilities": [{"id": "<cap>", "title": "<Title>", "checks": [{"case": "case", "criterion": "x"}], "missing": ["future gap"]}],
            "behaviors": [{"id": "behavior", "title": "Behavior", "checks": [{"case": "case", "criterion": "x"}] }],
        }
        scorecard = build_scorecard(results, coverage)
        row = scorecard["capabilities"]["rows"][0]
        self.assertEqual(row["points"]["available"], 1)
        self.assertFalse(row["points"]["complete"])
        with tempfile.TemporaryDirectory() as directory:
            write_scorecard(results, coverage, directory)
            page = Path(directory, "scorecard.html").read_text()
            self.assertIn("&lt;Title&gt;", page)
            self.assertNotIn("<Title>", page)
            self.assertIn("With", page)
            self.assertIn("Without", page)
            self.assertIn("Behaviors", page)
            self.assertTrue(Path(directory, "scorecard.json").is_file())
            self.assertTrue(Path(directory, "scorecard.md").is_file())

    def test_efficiency_appears_in_scorecard(self):
        results = [
            run("case1", "claude", "with", "1", [criterion("x", "pass")]),
            run("case1", "claude", "with", "2", [criterion("x", "pass")]),
            run("case1", "codex", "with", "1", [criterion("x", "pass")]),
        ]
        coverage = {"capabilities": [{"id": "cap", "checks": [{"case": "case1", "criterion": "x"}]}]}
        results[0].update(seconds=10.0, actions=[{"kind": "command", "invocations": [["status"]]}, {"kind": "write"}])
        results[1].update(seconds=11.0, actions=[{"kind": "command", "invocations": [["status"], ["finish"]]}])
        with tempfile.TemporaryDirectory() as directory:
            scorecard = write_scorecard(results, coverage, directory)
            rows = {(row["host"], row["arm"]): row for row in scorecard["efficiency"]}
            self.assertEqual(rows[("claude", "with")]["seconds"], {"median": 10.5, "min": 10.0, "max": 11.0, "runs": 2})
            self.assertEqual(rows[("claude", "with")]["blabla_invocations"]["median"], 1.5)
            self.assertEqual(rows[("claude", "with")]["file_edits"], {"median": 0.5, "min": 0, "max": 1, "runs": 2})
            self.assertIsNone(rows[("codex", "with")]["seconds"])
            self.assertNotIn("actions", scorecard["runs"][0])
            self.assertEqual(rows[("codex", "with")]["total_actions"], {"median": 0, "min": 0, "max": 0, "runs": 1})
            self.assertIsNone(rows[("codex", "with")]["actions_to_done"])
            self.assertTrue(Path(directory, "scorecard.md").is_file())
            self.assertTrue(Path(directory, "scorecard.html").is_file())

    def test_done_is_the_first_passing_check_after_the_last_source_edit(self):
        actions = [
            {"kind": "command", "command": "blabla status", "invocations": [["status"]], "success": False},
            {"kind": "write", "paths": ["widget/store.py"]},
            {"kind": "command", "command": "blabla status", "invocations": [["status"]], "success": False},
            {"kind": "write", "paths": ["widget/model.py"]},
            {"kind": "command", "command": "blabla status", "invocations": [["status"]], "success": True},
            {"kind": "write", "paths": [".blabla/tasks/fix.json"]},
            {"kind": "command", "command": "blabla challenge fix", "invocations": [["challenge", "fix"]], "success": False},
        ]
        result = run("case1", "claude", "with", "1", [criterion("x", "pass")])
        result.update(actions=actions, check="blabla status")
        measures = efficiency_of(result)
        self.assertEqual((measures["actions_to_done"], measures["actions_after_done"]), (5, 2))
        result.update(check="python3 checks/restart.py")
        self.assertIsNone(efficiency_of(result)["actions_to_done"])
        actions[4] = {"kind": "command", "command": "python3 checks/restart.py 2>&1", "invocations": [], "success": True}
        self.assertEqual(efficiency_of(result)["actions_to_done"], 5)


if __name__ == "__main__":
    unittest.main()
