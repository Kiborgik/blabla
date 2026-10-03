import io
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

from gate import ROOT, STEPS
from run_historical_tests import iter_tests, partition_tests, split_suite

CASE_SOURCE = "import unittest\nclass Case(unittest.TestCase):\n    def test_case(self):\n        pass\n"


def experiment_step(pattern):
    return (pattern, ("@python", "-m", "unittest", "discover", "-s", "experiments", "-p", pattern))


class HistoricalTests(unittest.TestCase):
    def fixture(self, sources):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        names = {}
        for label, source in sources.items():
            name = "test_" + label + "_" + uuid.uuid4().hex
            names[label] = name
            (root / (name + ".py")).write_text(source, encoding="utf-8")
            self.addCleanup(sys.modules.pop, name, None)
        original_path = sys.path[:]
        self.addCleanup(setattr, sys, "path", original_path)
        return root, names

    def ids(self, suite):
        return [test.id() for test in iter_tests(suite)]

    def test_real_discovery_is_an_exact_disjoint_union_of_gate_and_historical_tests(self):
        historical, owned = partition_tests()
        historical_ids, owned_ids = self.ids(historical), self.ids(owned)
        loader = unittest.TestLoader()
        all_ids = self.ids(loader.discover(str(ROOT / "experiments"), pattern="test_*.py"))
        self.assertEqual(loader.errors, [])
        self.assertTrue(historical_ids)
        self.assertTrue(owned_ids)
        self.assertEqual(set(historical_ids).intersection(owned_ids), set())
        self.assertCountEqual(historical_ids + owned_ids, all_ids)
        self.assertEqual(len(set(all_ids)), len(all_ids))
        gate_ids = []
        for _, command in STEPS:
            if command[:4] == ("@python", "-m", "unittest", "discover") and command[command.index("-s") + 1] == "experiments":
                loader = unittest.TestLoader()
                gate_ids.extend(self.ids(loader.discover(str(ROOT / "experiments"), pattern=command[command.index("-p") + 1])))
                self.assertEqual(loader.errors, [])
        self.assertCountEqual(owned_ids, gate_ids)
        discovered_modules = {test.__class__.__module__ for test in iter_tests(historical)}
        discovered_modules.update(test.__class__.__module__ for test in iter_tests(owned))
        self.assertEqual(discovered_modules, {path.stem for path in (ROOT / "experiments").glob("test_*.py")})

    def test_new_historical_files_are_included_once_and_other_gate_directories_are_ignored(self):
        root, names = self.fixture(dict.fromkeys(("owned", "historical", "future"), CASE_SOURCE))
        steps = (experiment_step(names["owned"] + ".py"), ("todo", ("@python", "-m", "unittest", "discover", "-s", "examples/todo", "-p", "test_*.py")))
        historical, owned = partition_tests(root, steps)
        self.assertCountEqual(self.ids(historical), [names[label] + ".Case.test_case" for label in ("historical", "future")])
        self.assertEqual(self.ids(owned), [names["owned"] + ".Case.test_case"])

    def test_overlapping_gate_patterns_are_rejected(self):
        root, names = self.fixture({"owned": CASE_SOURCE})
        with self.assertRaisesRegex(ValueError, "multiple gate stages"):
            partition_tests(root, (experiment_step("test_*.py"), experiment_step(names["owned"] + ".py")))

    def test_gate_patterns_cannot_name_an_undiscovered_file(self):
        root, _ = self.fixture({"historical": CASE_SOURCE})
        with self.assertRaisesRegex(ValueError, "unknown gate pattern"):
            partition_tests(root, (experiment_step("test_missing.py"),))

    def test_duplicate_test_ids_are_rejected(self):
        root, _ = self.fixture({"duplicate": CASE_SOURCE + "def load_tests(loader, tests, pattern):\n    return unittest.TestSuite([Case('test_case'), Case('test_case')])\n"})
        with self.assertRaisesRegex(ValueError, "duplicate test"):
            partition_tests(root, ())

    def test_unknown_test_membership_is_rejected(self):
        root, _ = self.fixture({"unknown": CASE_SOURCE + "Case.__module__ = 'unknown_test_module'\n"})
        with self.assertRaisesRegex(ValueError, "unknown test module"):
            partition_tests(root, ())

    def test_a_test_file_with_no_discovered_members_is_rejected(self):
        root, _ = self.fixture({"empty": ""})
        with self.assertRaisesRegex(ValueError, "undiscovered test modules"):
            partition_tests(root, ())

    def test_import_errors_propagate_before_tests_run(self):
        root, _ = self.fixture({"broken": "raise ImportError('historical discovery sentinel')\n"})
        with self.assertRaisesRegex(RuntimeError, "historical discovery sentinel"):
            partition_tests(root, ())

    def test_custom_historical_suite_lifecycle_is_preserved(self):
        root, names = self.fixture({"custom": CASE_SOURCE + "RUNS = 0\nclass LifecycleSuite(unittest.TestSuite):\n    def run(self, result, debug=False):\n        global RUNS\n        RUNS += 1\n        return super().run(result, debug)\ndef load_tests(loader, tests, pattern):\n    return LifecycleSuite(tests)\n"})
        historical, owned = partition_tests(root, ())
        self.assertEqual(owned.countTestCases(), 0)
        result = unittest.TextTestRunner(stream=io.StringIO()).run(historical)
        self.assertTrue(result.wasSuccessful())
        self.assertEqual(result.testsRun, 1)
        self.assertEqual(sys.modules[names["custom"]].RUNS, 1)

    def test_a_custom_suite_cannot_be_split_across_gate_ownership(self):
        class LifecycleSuite(unittest.TestSuite):
            pass

        historical = type("Historical", (unittest.TestCase,), {"__module__": "historical", "runTest": lambda self: None})
        owned = type("Owned", (unittest.TestCase,), {"__module__": "owned", "runTest": lambda self: None})
        with self.assertRaisesRegex(ValueError, "custom suite crosses gate ownership"):
            split_suite(LifecycleSuite([historical(), owned()]), {"historical": False, "owned": True})


if __name__ == "__main__":
    unittest.main()
