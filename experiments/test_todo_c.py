import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent
COMPILER_PREPARE_TIMEOUT_SECONDS = 120 if os.name == "nt" else 30


class TodoCPersistenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build = tempfile.TemporaryDirectory()
        cls.addClassCleanup(build.cleanup)
        cls.executable = Path(build.name) / "todo-c.exe"
        subprocess.run([
            "gcc", "-std=c17", "-O1", "-I", str(ROOT / "adapters/c"),
            "-o", str(cls.executable), str(ROOT / "examples/todo-c/main.c"),
            str(ROOT / "adapters/c/blabla_adapter.c"),
        ], check=True, capture_output=True, timeout=COMPILER_PREPARE_TIMEOUT_SECONDS)

    def run_app(self, directory, requests):
        payload = "".join(
            json.dumps(dict(id=index, **request), ensure_ascii=False) + "\n"
            for index, request in enumerate(requests)
        ).encode("utf-8")
        result = subprocess.run(
            [str(self.executable)], cwd=directory, input=payload,
            capture_output=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", errors="replace"))
        self.assertEqual(result.stderr, b"")
        responses = [json.loads(line) for line in result.stdout.decode("utf-8").splitlines()]
        self.assertEqual([response["id"] for response in responses], list(range(len(requests))))
        return [response["result"] for response in responses]

    def test_restart_preserves_whitespace_and_unicode_text(self):
        for text in [" ", "\n", "\tleading", "trailing \n", '"\\\n', "é雪", " café 雪🦀", "\r\n"]:
            with self.subTest(text=text), tempfile.TemporaryDirectory() as directory:
                expected = {"todos": [{"id": 1, "text": text, "done": False}]}
                self.assertEqual(self.run_app(directory, [
                    {"op": "call", "name": "add", "args": [text]},
                    {"op": "observe"},
                ]), [{"ok": True}, expected])
                for _ in range(2):
                    self.assertEqual(self.run_app(directory, [{"op": "observe"}]), [expected])

    def test_restart_preserves_record_boundaries_and_completed_items(self):
        texts = ["first", " ", "\n\té雪\n", "last"]
        expected = {"todos": [
            {"id": index + 1, "text": text, "done": index == 2}
            for index, text in enumerate(texts)
        ]}
        with tempfile.TemporaryDirectory() as directory:
            requests = [{"op": "call", "name": "add", "args": [text]} for text in texts]
            requests += [{"op": "call", "name": "complete", "args": [3]}, {"op": "observe"}]
            self.assertEqual(self.run_app(directory, requests), [{"ok": True}] * 5 + [expected])
            self.assertEqual(self.run_app(directory, [{"op": "observe"}]), [expected])
            expected["todos"].append({"id": 5, "text": " next\n", "done": False})
            self.assertEqual(self.run_app(directory, [
                {"op": "call", "name": "add", "args": [" next\n"]},
                {"op": "observe"},
            ]), [{"ok": True}, expected])
            self.assertEqual(self.run_app(directory, [{"op": "observe"}]), [expected])


if __name__ == "__main__":
    unittest.main()
