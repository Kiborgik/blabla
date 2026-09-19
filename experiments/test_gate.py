import unittest
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

    def test_the_offline_flag_reaches_the_commands_that_declare_it(self):
        offline = dict(checks(Path("."), True))
        online = dict(checks(Path("."), False))
        self.assertIn("--offline", offline["rust-tests"])
        self.assertNotIn("--offline", online["rust-tests"])


if __name__ == "__main__":
    unittest.main()
