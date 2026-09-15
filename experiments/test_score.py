import unittest
import uuid
from pathlib import Path

from score import score_application


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "examples" / "todo" / "app.py"
SCRATCH = ROOT / "artifacts" / "scratch" / "score-tests"


class ScorerTests(unittest.TestCase):
    def setUp(self):
        SCRATCH.mkdir(parents=True, exist_ok=True)
        self.directory = SCRATCH / uuid.uuid4().hex
        self.directory.mkdir()

    def variant(self, original, replacement):
        source = APP.read_text(encoding="utf-8")
        self.assertEqual(source.count(original), 1)
        app = self.directory / "app.py"
        app.write_text(source.replace(original, replacement), encoding="utf-8")
        return app

    def test_normal_application_passes_all_core_requirements(self):
        report = score_application(APP, 0)
        self.assertEqual(report["failed"], 0, report)
        self.assertEqual(report["passed"], 8)

    def test_persistence_loss_is_scored_independently(self):
        app = self.variant("        os.replace(temporary, self.path)", "        temporary.unlink()")
        report = score_application(app, 0)
        checks = {check["name"]: check for check in report["checks"]}
        self.assertFalse(checks["restart-preserves-data"]["passed"], report)
        self.assertTrue(checks["add-preserves-existing"]["passed"], report)

    def test_empty_add_and_identity_regressions_are_detected(self):
        for original, replacement, name in [
            ('        if text == "":\n            return', '        if False:\n            return', "empty-add-noop"),
            ('        next_id = max((todo["id"] for todo in self.todos), default=0) + 1', "        next_id = 1", "duplicate-text-and-identity"),
        ]:
            app = self.variant(original, replacement)
            report = score_application(app, 0)
            checks = {check["name"]: check for check in report["checks"]}
            self.assertFalse(checks[name]["passed"], report)

    def test_trailing_output_cannot_count_as_success(self):
        app = self.directory / "app.py"
        app.write_text(APP.read_text(encoding="utf-8") + '\nprint("{}", flush=True)\n', encoding="utf-8")
        report = score_application(app, 0)
        self.assertEqual(report["passed"], 0, report)
        self.assertEqual(report["failed"], 8)


if __name__ == "__main__":
    unittest.main()
