import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parent.parent
ADAPTER = ROOT / "adapters/python/blabla_adapter.py"
SPEC = importlib.util.spec_from_file_location("blabla_python_adapter", ADAPTER)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PythonAdapterTests(unittest.TestCase):
    def run_adapter(self, payload, encoding, observation="{'values': values}"):
        program = (
            "import sys\n"
            f"sys.path.insert(0, {str(ADAPTER.parent)!r})\n"
            "from blabla_adapter import Adapter\n"
            "values = []\n"
            f"adapter = Adapter(values.clear, lambda: {observation})\n"
            "adapter.action('add', 1, lambda args: values.append(args.string(0)))\n"
            "raise SystemExit(adapter.serve())\n"
        )
        return subprocess.run(
            [sys.executable, "-c", program],
            input=payload,
            capture_output=True,
            env=dict(os.environ, PYTHONIOENCODING=encoding),
            timeout=10,
        )

    def test_default_stdio_round_trips_utf8_text_and_opaque_ids_under_cp1252(self):
        text = "caf\u00e9 \u96ea \U0001f980"
        call_id = {"request": "\u00e9\u96ea\U0001f642"}
        observe_id = ["d\u00e9j\u00e0", "\U0001f980", 17]
        requests = [
            {"id": call_id, "op": "call", "name": "add", "args": [text]},
            {"id": observe_id, "op": "observe"},
        ]
        payload = "".join(json.dumps(request, ensure_ascii=False) + "\n" for request in requests).encode("utf-8")

        result = self.run_adapter(payload, "cp1252")

        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", errors="replace"))
        responses = [json.loads(line) for line in result.stdout.decode("utf-8").splitlines()]
        self.assertEqual(responses, [
            {"id": call_id, "result": {"ok": True}},
            {"id": observe_id, "result": {"values": [text]}},
        ])
        self.assertEqual(result.stderr, b"")

    def test_default_protocol_streams_use_utf8_strict_encoding(self):
        result = self.run_adapter(
            b'{"id":1,"op":"observe"}\n',
            "cp1252:replace",
            "{'stdin': [sys.stdin.encoding, sys.stdin.errors], 'stdout': [sys.stdout.encoding, sys.stdout.errors]}",
        )

        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", errors="replace"))
        self.assertEqual(json.loads(result.stdout.decode("utf-8")), {
            "id": 1,
            "result": {"stdin": ["utf-8", "strict"], "stdout": ["utf-8", "strict"]},
        })

    def test_default_stdio_rejects_malformed_utf8_even_with_permissive_environment(self):
        payload = b'{"id":1,"op":"call","name":"add","args":["\xff"]}\n'
        for encoding in ("cp1252", "utf-8:ignore"):
            with self.subTest(encoding=encoding):
                result = self.run_adapter(payload, encoding)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, b"")
                self.assertIn(b"UnicodeDecodeError", result.stderr)

    def test_injected_text_streams_preserve_unicode_and_malformed_json_logging(self):
        text = "caf\u00e9 \u96ea \U0001f980"
        opaque_id = {"request": "\u00e9\u96ea"}
        source = io.StringIO("not json\n" + json.dumps({"id": opaque_id, "op": "observe"}, ensure_ascii=False) + "\n")
        sink = io.StringIO()
        logs = io.StringIO()
        adapter = MODULE.Adapter(lambda: None, lambda: {"text": text})

        self.assertEqual(adapter.serve(source=source, sink=sink, logs=logs), 0)

        self.assertEqual(json.loads(sink.getvalue()), {"id": opaque_id, "result": {"text": text}})
        self.assertIn("unreadable request:", logs.getvalue())
        self.assertFalse(any(stream.closed for stream in (source, sink, logs)))


if __name__ == "__main__":
    unittest.main()
