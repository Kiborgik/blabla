import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import tracemalloc
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import probe_expert_host as host_probe
from probe_expert_host import OUTPUT_BYTES, capture, probe, validate_luna_output


class ExpertHostProbe(unittest.TestCase):
    def fake_cli(self, argv, **kwargs):
        arguments = argv[1:]
        if arguments == ["--version"]:
            return subprocess.CompletedProcess(argv, 0, "codex-cli 0.159.0-alpha.7\n", "")
        if arguments == ["login", "status"]:
            return subprocess.CompletedProcess(argv, 0, "Logged in using ChatGPT\n", "")
        return subprocess.CompletedProcess(argv, 0, "--json --output-schema turn/steer additionalContext", "")

    def fake_capture(self, handler):
        def fixture(argv, workspace, environment, timeout_seconds, omit_output=False):
            completed = handler(argv)
            result = {"argv": list(argv), "exit": completed.returncode, "outcome": "completed",
                      "stdout": {"text": "" if omit_output else completed.stdout},
                      "stderr": {"text": "" if omit_output else completed.stderr}}
            return result, completed.stdout, completed.stderr
        return fixture

    def test_probe_does_not_infer_delivery_from_cli_presence(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("probe_expert_host.capture", side_effect=self.fake_capture(self.fake_cli)):
                result = probe("codex-fixture", Path(directory))
        capabilities = result["capabilities"]
        self.assertEqual(capabilities["version"], "0.159.0-alpha.7")
        self.assertEqual(capabilities["checkpoints"], [])
        for key in ("pauses_worker", "same_task_delivery", "delivery_receipts", "pre_tool_control"):
            self.assertIs(capabilities[key], False)
        self.assertEqual(result["providers"]["luna"]["status"], "unverified")
        self.assertEqual(result["providers"]["luna"]["supported_outputs"], [])

    def test_auth_failure_is_unverified(self):
        def failed_auth(argv, **kwargs):
            if argv[1:] == ["login", "status"]:
                return subprocess.CompletedProcess(argv, 1, "", "Not logged in")
            return self.fake_cli(argv, **kwargs)

        with tempfile.TemporaryDirectory() as directory:
            with patch("probe_expert_host.capture", side_effect=self.fake_capture(failed_auth)):
                result = probe("codex-fixture", Path(directory))
        self.assertEqual(result["authentication"]["status"], "unverified")
        self.assertIs(result["authentication"]["reported_login"], False)
        self.assertEqual(result["authentication"]["reason"], "login_status_failed")
        self.assertEqual(result["providers"]["luna"]["status"], "unverified")

    def test_login_report_on_stderr_is_discovery_only(self):
        def stderr_login(argv, **kwargs):
            if argv[1:] == ["login", "status"]:
                return subprocess.CompletedProcess(argv, 0, "", "Logged in using ChatGPT\n")
            return self.fake_cli(argv, **kwargs)

        with tempfile.TemporaryDirectory() as directory:
            with patch("probe_expert_host.capture", side_effect=self.fake_capture(stderr_login)):
                result = probe("codex-fixture", Path(directory))
        self.assertIs(result["authentication"]["reported_login"], True)
        self.assertEqual(result["authentication"]["status"], "unverified")
        self.assertEqual(result["authentication"]["reason"], "login_report_only")
        self.assertEqual(result["commands"][-1]["stdout"]["text"], "")
        self.assertEqual(result["commands"][-1]["stderr"]["text"], "")

    def test_probe_never_edits_global_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assert_global_configuration_unchanged(Path(directory))

    def test_probe_preserves_global_configuration_through_noncanonical_workspace(self):
        with tempfile.TemporaryDirectory() as directory:
            alias = Path(directory) / "path-alias"
            alias.mkdir()
            self.assert_global_configuration_unchanged(alias / "..")

    def assert_global_configuration_unchanged(self, root):
        global_home = root / "global-codex"
        global_home.mkdir()
        config = global_home / "config.toml"
        hooks = global_home / "hooks.json"
        config.write_bytes(b'model = "unchanged"\n')
        hooks.write_bytes(b'{"hooks":{}}\n')
        before = {path.name: path.read_bytes() for path in global_home.iterdir()}
        environment = dict(os.environ)
        with patch.dict(os.environ, {"CODEX_HOME": str(global_home)}):
            with patch("probe_expert_host.capture", side_effect=self.fake_capture(self.fake_cli)) as run:
                probe("codex-fixture", root / "workspace")
            after = {path.name: path.read_bytes() for path in global_home.iterdir()}
            discovery_calls = [call for call in run.call_args_list if call.args[0][1:] != ["login", "status"]]
            self.assertTrue(discovery_calls)
            for call in discovery_calls:
                home = Path(call.args[2]["CODEX_HOME"]).resolve()
                self.assertNotEqual(home, global_home.resolve())
                self.assertTrue(home.is_relative_to((root / "workspace").resolve()))
                self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", call.args[0])
                self.assertNotIn("--dangerously-bypass-hook-trust", call.args[0])
        self.assertEqual(before, after)
        self.assertEqual(environment, dict(os.environ))

    def test_missing_cli_records_unverified_without_raising(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("probe_expert_host.subprocess.Popen", side_effect=FileNotFoundError("missing")):
                result = probe("missing-codex", Path(directory))
        self.assertEqual(result["status"], "unverified")
        self.assertTrue(all(item["outcome"] == "unavailable" for item in result["commands"]))

    def test_timeout_records_no_success_or_delivery(self):
        if host_probe.os.name != "posix":
            self.skipTest("POSIX timeout fixture")
        with tempfile.TemporaryDirectory() as directory:
            with patch("probe_expert_host.subprocess.Popen", side_effect=subprocess.TimeoutExpired("codex", 1)):
                result = probe("codex-fixture", Path(directory), 1)
        self.assertTrue(all(item["outcome"] == "timeout" for item in result["commands"]))
        self.assertIs(result["capabilities"]["same_task_delivery"], False)

    def test_unsupported_platform_records_unavailable_without_starting_processes(self):
        environment = dict(os.environ)
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            with patch("probe_expert_host.os", SimpleNamespace(name="nt", environ=environment)):
                with patch("probe_expert_host.subprocess.Popen") as launch:
                    result = probe("codex-fixture", workspace, 1)
                    launch.assert_not_called()
        self.assertEqual(result["status"], "unverified")
        self.assertEqual(len(result["commands"]), 6)
        for command in result["commands"]:
            self.assertEqual(command["outcome"], "unavailable")
            self.assertIsNone(command["exit"])
            self.assertEqual(command["error"], "process_tree_containment_unsupported")
        self.assertIs(result["capabilities"]["same_task_delivery"], False)
        self.assertEqual(result["providers"]["luna"]["status"], "unverified")

    def test_invalid_timeout_is_rejected_before_starting_process(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("probe_expert_host.subprocess.Popen") as run:
                with self.assertRaises(ValueError):
                    probe("codex-fixture", Path(directory), 0)
                run.assert_not_called()

    @unittest.skipUnless(os.name == "posix", "POSIX streaming capture")
    def test_capture_limits_memory_and_retained_output_while_hashing_every_byte(self):
        block = b"x" * 8192
        amount = 4 * 1024 * 1024
        script = "import os; block=b'x'*8192; [(os.write(1,block),os.write(2,block)) for _ in range(512)]"
        with tempfile.TemporaryDirectory() as directory:
            tracemalloc.start()
            try:
                result, stdout, stderr = capture(
                    [sys.executable, "-c", script], Path(directory), dict(os.environ), 5,
                )
                _, peak = tracemalloc.get_traced_memory()
            finally:
                tracemalloc.stop()
        self.assertEqual(result["exit"], 0)
        self.assertEqual(result["outcome"], "completed")
        self.assertLessEqual(len(stdout.encode("utf-8")), OUTPUT_BYTES)
        self.assertLessEqual(len(stderr.encode("utf-8")), OUTPUT_BYTES)
        self.assertLess(peak, 2 * 1024 * 1024)
        expected_hash = hashlib.sha256()
        for _ in range(amount // len(block)):
            expected_hash.update(block)
        for stream in ("stdout", "stderr"):
            self.assertEqual(result[stream]["bytes"], amount)
            self.assertEqual(result[stream]["sha256"], expected_hash.hexdigest())
            self.assertIs(result[stream]["truncated"], True)

    @unittest.skipUnless(os.name == "posix", "POSIX streaming capture")
    def test_capture_hashes_raw_bytes_without_newline_or_decoding_normalization(self):
        raw = b"first\r\nsecond\r\n\xff\x00last"
        script = "import os; os.write(1," + repr(raw) + ")"
        with tempfile.TemporaryDirectory() as directory:
            result, _, _ = capture([sys.executable, "-c", script], Path(directory), dict(os.environ), 5)
        self.assertEqual(result["stdout"]["bytes"], len(raw))
        self.assertEqual(result["stdout"]["sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(result["stdout"]["text"], raw.decode("utf-8", errors="replace"))

    @unittest.skipUnless(os.name == "posix", "POSIX process-group fixture")
    def test_capture_timeout_terminates_descendants_before_they_can_act(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / "descendant-acted"
            pidfile = root / "descendant-pid"
            child = "import time; from pathlib import Path; time.sleep(1.2); Path(" + repr(str(marker)) + ").write_text('late'); time.sleep(20)"
            parent = ("import subprocess,sys,time; from pathlib import Path; "
                      "child=subprocess.Popen([sys.executable,'-c'," + repr(child) + "],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); "
                      "Path(" + repr(str(pidfile)) + ").write_text(str(child.pid)); time.sleep(20)")
            try:
                started = time.monotonic()
                result, _, _ = capture([sys.executable, "-c", parent], root, dict(os.environ), 0.3)
                self.assertLess(time.monotonic() - started, 2)
                self.assertEqual(result["outcome"], "timeout")
                self.assertIsNone(result["exit"])
                self.assertTrue(pidfile.exists())
                time.sleep(1.3)
                self.assertFalse(marker.exists())
            finally:
                if pidfile.exists():
                    try:
                        os.kill(int(pidfile.read_text()), signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    def test_luna_structured_outputs_are_typed_without_probability_claims(self):
        cases = (("choice", {"pick": "hold"}, ["hold", "continue"]),
                 ("noul", {"value": True}, []),
                 ("noul", {"value": None}, []),
                 ("score", {"level": "high"}, ["low", "high"]))
        for kind, answer, labels in cases:
            with self.subTest(kind=kind, answer=answer):
                result = validate_luna_output(json.dumps(answer), kind, labels)
                self.assertEqual(result["outcome"], "valid")
                self.assertEqual(result["answer"], answer)
                self.assertNotIn("probability", result)

    def test_luna_malformed_outputs_are_explicit_failures(self):
        cases = (("choice", '{"pick":"unknown"}', ["hold", "continue"]),
                 ("choice", '{"pick":"hold","probability":0.9}', ["hold", "continue"]),
                 ("choice", '{"pick":"hold","pick":"continue"}', ["hold", "continue"]),
                 ("noul", '{"value":1}', []),
                 ("noul", '{"value":"true"}', []),
                 ("score", '{"level":"middle"}', ["low", "high"]),
                 ("score", '```json\n{"level":"high"}\n```', ["low", "high"]),
                 ("noul", '[]', []),
                 ("noul", '{"value":NaN}', []))
        for kind, output, labels in cases:
            with self.subTest(kind=kind, output=output):
                result = validate_luna_output(output, kind, labels)
                self.assertEqual(result["outcome"], "malformed")
                self.assertNotIn("answer", result)


if __name__ == "__main__":
    unittest.main()
