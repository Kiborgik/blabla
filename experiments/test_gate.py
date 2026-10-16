import unittest
import sys
from pathlib import Path

from gate import REQUIRED_ORDER, STEPS, checks, ordered, rust_tests_are_clean, steps_of

PLACEHOLDERS = {"@cargo", "@python", "@out", "@blabla"}


def reordered(first, second):
    positions = {name: index for index, (name, _) in enumerate(STEPS)}
    swapped = list(STEPS)
    left, right = positions[first], positions[second]
    swapped[left], swapped[right] = swapped[right], swapped[left]
    return tuple(swapped)


def without(name):
    return tuple(step for step in STEPS if step[0] != name)


class ScheduleOrder(unittest.TestCase):
    def test_the_declared_schedule_satisfies_the_required_order(self):
        self.assertIsNone(ordered(STEPS, REQUIRED_ORDER))

    def test_every_required_name_is_in_the_schedule(self):
        names = {name for name, _ in STEPS}
        for earlier, later in REQUIRED_ORDER:
            self.assertIn(earlier, names)
            self.assertIn(later, names)

    def test_swapping_two_ordered_steps_is_rejected(self):
        for earlier, later in REQUIRED_ORDER:
            self.assertIsNotNone(ordered(reordered(earlier, later), REQUIRED_ORDER))

    def test_dropping_a_required_step_is_rejected(self):
        for earlier, later in REQUIRED_ORDER:
            self.assertIsNotNone(ordered(without(earlier), REQUIRED_ORDER))
            self.assertIsNotNone(ordered(without(later), REQUIRED_ORDER))

    def test_a_broken_schedule_stops_the_run_before_any_step(self):
        earlier, later = REQUIRED_ORDER[0]
        with self.assertRaises(SystemExit):
            steps_of(reordered(earlier, later))


class RunnerUsesTheSchedule(unittest.TestCase):
    def test_the_runner_keeps_the_declared_names_and_their_order(self):
        produced = [name for name, _ in checks(Path("."), True)]
        self.assertEqual(produced, [name for name, _ in STEPS])

    def test_every_placeholder_is_expanded(self):
        for _, command in checks(Path("."), True):
            self.assertEqual(PLACEHOLDERS.intersection(command), set())

    def test_credential_free_expert_checks_are_exact_product_gate_stages(self):
        schedule = dict(checks(Path("."), True))
        expected = {
            "systemone-provider": "test_systemone_provider.py",
            "native-expert": "test_native_expert.py",
        }
        for name, pattern in expected.items():
            self.assertIn(name, schedule)
            self.assertEqual(schedule[name], [sys.executable, "-m", "unittest", "discover", "-s", "experiments", "-p", pattern])
            self.assertEqual(sum(command == schedule[name] for _, command in checks(Path("."), True)), 1)
        names = [name for name, _ in STEPS]
        self.assertEqual(len(names), len(set(names)))
        tokens = [token for _, command in checks(Path("."), True) for token in command]
        self.assertNotIn("smoke_systemone_provider.py", tokens)
        self.assertNotIn("--allow-local-inference", tokens)

    def test_expert_check_stages_precede_completion_without_reordering_existing_steps(self):
        names = [name for name, _ in STEPS]
        for name in ("systemone-provider", "native-expert"):
            self.assertIn(name, names)
            self.assertLess(names.index("gate-schedule"), names.index(name))
            self.assertLess(names.index(name), names.index("todo-python"))
            self.assertLess(names.index(name), names.index("self-hosting-finish"))
        self.assertLess(names.index("todo-python"), names.index("self-hosting-finish"))

    def test_canonical_finish_owns_composed_behavior_without_standalone_campaigns(self):
        schedule = dict(checks(Path("."), True))
        self.assertEqual(schedule["self-hosting-finish"], ["cargo", "run", "--offline", "--quiet", "--bin", "blabla", "--", "finish"])
        self.assertEqual(schedule["bridge"], ["cargo", "build", "--offline", "--quiet", "--example", "structure-adapter"])
        self.assertEqual(schedule["bridge-tests"], ["cargo", "test", "--offline", "--quiet", "--example", "structure-adapter"])
        self.assertNotIn("questions-campaign", schedule)
        self.assertNotIn("expert-campaign", schedule)
        self.assertFalse(any(command[:2] == ("@blabla", "run") for _, command in STEPS))
        self.assertIn(("bridge", "self-hosting-finish"), REQUIRED_ORDER)
        self.assertIn(("self-hosting-finish", "self-hosting-status"), REQUIRED_ORDER)

    def test_the_offline_flag_reaches_the_commands_that_declare_it(self):
        offline = dict(checks(Path("."), True))
        online = dict(checks(Path("."), False))
        self.assertIn("--offline", offline["rust-tests"])
        self.assertNotIn("--offline", online["rust-tests"])


FAILED_LINE = "FAIL [   0.142s] (2/3) blabla::cli a_check_fails"
TIMED_OUT_LINE = "TIMEOUT [   2.001s] (3/3) blabla::cli a_check_hangs"


class RustTestLog(unittest.TestCase):
    def test_every_failed_or_timed_out_test_is_listed_once_and_the_run_is_not_clean(self):
        log = "\n".join([
            "        PASS [   0.011s] (1/3) blabla::cli a_check_passes",
            "        " + FAILED_LINE,
            "     " + TIMED_OUT_LINE,
            "────────────",
            "     Summary [   2.002s] 3 tests run: 1 passed, 2 failed, 0 skipped",
            "        " + FAILED_LINE,
            "     " + TIMED_OUT_LINE,
        ])
        summaries, failed_titles, clean = rust_tests_are_clean(log)
        self.assertEqual(failed_titles, [FAILED_LINE, TIMED_OUT_LINE])
        self.assertEqual(len(summaries), 1)
        self.assertFalse(clean)

    def test_a_run_with_a_passing_summary_and_no_failure_is_clean(self):
        log = "        PASS [   0.011s] (1/1) blabla::cli a_check_passes\n     Summary [   0.012s] 1 test run: 1 passed, 2 skipped"
        self.assertEqual(rust_tests_are_clean(log)[1:], ([], True))

    def test_a_run_without_a_summary_is_not_clean(self):
        self.assertFalse(rust_tests_are_clean("error: could not compile `blabla`")[2])


if __name__ == "__main__":
    unittest.main()
