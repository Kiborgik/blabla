import unittest
import sys
from pathlib import Path

from gate import REQUIRED_ORDER, STEPS, checks, ordered, steps_of

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
            "expert-host-probe": "test_expert_host_probe.py",
            "systemone-provider": "test_systemone_provider.py",
            "expert-evaluation": "test_expert_eval.py",
        }
        for name, pattern in expected.items():
            self.assertIn(name, schedule)
            self.assertEqual(schedule[name], [sys.executable, "-m", "unittest", "discover", "-s", "experiments", "-p", pattern])
        tokens = [token for _, command in checks(Path("."), True) for token in command]
        self.assertNotIn("smoke_systemone_provider.py", tokens)
        self.assertNotIn("--allow-local-inference", tokens)

    def test_expert_check_stages_precede_completion_without_reordering_existing_steps(self):
        names = [name for name, _ in STEPS]
        for name in ("expert-host-probe", "systemone-provider", "expert-evaluation"):
            self.assertIn(name, names)
            self.assertLess(names.index("gate-schedule"), names.index(name))
            self.assertLess(names.index(name), names.index("todo-python"))
            self.assertLess(names.index(name), names.index("self-hosting-finish"))

    def test_the_expert_campaign_uses_the_current_source_bridge_at_the_canonical_budget(self):
        schedule = dict(checks(Path("."), True))
        self.assertIn("expert-campaign", schedule)
        self.assertEqual(schedule["expert-campaign"], ["cargo", "run", "--offline", "--quiet", "--bin", "blabla", "--", "run", "contracts/expert.bla", "--cases", "32", "--steps", "512", "--timeout-ms", "5000", "--", "target/debug/examples/structure-adapter"])
        self.assertIn(("bridge", "expert-campaign"), REQUIRED_ORDER)
        self.assertIn(("expert-campaign", "self-hosting-finish"), REQUIRED_ORDER)

    def test_the_offline_flag_reaches_the_commands_that_declare_it(self):
        offline = dict(checks(Path("."), True))
        online = dict(checks(Path("."), False))
        self.assertIn("--offline", offline["rust-tests"])
        self.assertNotIn("--offline", online["rust-tests"])


if __name__ == "__main__":
    unittest.main()
