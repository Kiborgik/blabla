import os
import unittest
from pathlib import Path

from app import TodoApplication, TodoStorage


class TodoApplicationTests(unittest.TestCase):
    def storage_path(self, name):
        path = Path(__file__).parent / f".{name}-{os.getpid()}.json"
        self.addCleanup(path.unlink, missing_ok=True)
        self.addCleanup(path.with_suffix(".tmp").unlink, missing_ok=True)
        return path

    def test_persists_real_state_and_reloads_it(self):
        path = self.storage_path("persistence")
        application = TodoApplication(TodoStorage(path))
        application.reset()
        application.add("milk")

        reloaded = TodoApplication(TodoStorage(path))

        self.assertEqual(
            reloaded.observe(),
            {"todos": [{"id": 1, "text": "milk", "done": False}]},
        )

    def test_noops_preserve_rows_and_current_ids_stay_unique(self):
        application = TodoApplication(TodoStorage(self.storage_path("noops")))
        application.reset()
        application.add("")
        application.add("milk")
        application.add("milk")
        application.complete(999)
        application.remove(999)

        state = application.observe()["todos"]

        self.assertEqual([todo["text"] for todo in state], ["milk", "milk"])
        self.assertEqual(len({todo["id"] for todo in state}), 2)


if __name__ == "__main__":
    unittest.main()
