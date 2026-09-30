import argparse
import hashlib
import json
import os
import re
import selectors
import signal
import stat
import subprocess
import tempfile
import time
from pathlib import Path


HOST_FIELDS = (
    "host", "version", "adapter", "checkpoints", "pauses_worker",
    "same_task_delivery", "delivery_receipts", "pre_tool_control", "gaps",
)
OUTPUT_BYTES = 16384


class OutputCapture:
    def __init__(self):
        self.prefix = bytearray()
        self.count = 0
        self.digest = hashlib.sha256()
        self.complete = False

    def observe(self, data):
        self.count += len(data)
        self.digest.update(data)
        self.prefix.extend(data[:max(0, OUTPUT_BYTES - len(self.prefix))])

    def record(self):
        return {
            "text": bytes(self.prefix).decode("utf-8", errors="replace"),
            "bytes": self.count, "sha256": self.digest.hexdigest(),
            "retained_bytes": len(self.prefix), "capture_complete": self.complete,
            "truncated": self.count > len(self.prefix) or not self.complete,
        }


def terminate_process_group(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def read_ready(selector, outputs, wait_seconds):
    for key, _ in selector.select(wait_seconds):
        try:
            data = os.read(key.fileobj.fileno(), 8192)
        except BlockingIOError:
            continue
        output = outputs[key.data]
        if data:
            output.observe(data)
        else:
            output.complete = True
            selector.unregister(key.fileobj)


def stream_process(process, outputs, deadline):
    outcome = "completed"
    with selectors.DefaultSelector() as selector:
        for name in ("stdout", "stderr"):
            stream = getattr(process, name)
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, name)
        while selector.get_map() or process.poll() is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                outcome = "timeout"
                break
            if selector.get_map():
                read_ready(selector, outputs, min(remaining, 0.05))
            else:
                time.sleep(min(remaining, 0.01))
        terminate_process_group(process)
        process.wait(timeout=1)
        drain_deadline = time.monotonic() + 0.2
        while selector.get_map() and time.monotonic() < drain_deadline:
            read_ready(selector, outputs, max(0, min(0.02, drain_deadline - time.monotonic())))
    return outcome


def capture(argv, workspace, environment, timeout_seconds, omit_output=False):
    started = time.monotonic()
    outputs = {"stdout": OutputCapture(), "stderr": OutputCapture()}
    process = None
    error = None
    exit_code = None
    outcome = "unavailable"
    try:
        if os.name != "posix":
            raise OSError("process_tree_containment_unsupported")
        process = subprocess.Popen(
            argv, cwd=workspace, env=environment, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
        )
        outcome = stream_process(process, outputs, started + timeout_seconds)
        exit_code = process.returncode if outcome == "completed" else None
    except subprocess.TimeoutExpired as exception:
        outcome = "timeout"
        error = str(exception)
    except OSError as exception:
        error = str(exception)
    finally:
        if process is not None:
            terminate_process_group(process)
            try:
                process.wait(timeout=1)
            finally:
                process.stdout.close()
                process.stderr.close()
    result = {
        "argv": list(argv), "exit": exit_code, "outcome": outcome,
        "seconds": round(time.monotonic() - started, 6),
        "stdout": outputs["stdout"].record(), "stderr": outputs["stderr"].record(),
    }
    if error is not None:
        result["error"] = error
    stdout = result["stdout"]["text"]
    stderr = result["stderr"]["text"]
    if omit_output:
        result["stdout"]["text"] = ""
        result["stderr"]["text"] = ""
        result["output_omitted"] = True
    return result, stdout, stderr


def socket_directory_state():
    if not hasattr(os, "geteuid"):
        return {"status": "unverified", "reason": "platform_not_inspected"}
    directory = Path("/tmp") / f"codex-daemon-{os.geteuid()}"
    try:
        metadata = directory.lstat()
    except FileNotFoundError:
        return {"status": "unverified", "reason": "directory_absent", "path": str(directory)}
    except OSError:
        return {"status": "unverified", "reason": "metadata_unavailable", "path": str(directory)}
    owned_private = (
        stat.S_ISDIR(metadata.st_mode)
        and metadata.st_uid == os.geteuid()
        and stat.S_IMODE(metadata.st_mode) == 0o700
    )
    return {
        "status": "metadata_only" if owned_private else "blocked",
        "reason": "socket_metadata_matches" if owned_private else "socket_directory_owner_or_mode",
        "path": str(directory), "uid": metadata.st_uid,
        "mode": format(stat.S_IMODE(metadata.st_mode), "04o"),
        "configuration_changed": False,
    }


def probe(codex: str, workspace: Path, timeout_seconds: int = 60) -> dict:
    if isinstance(timeout_seconds, bool) or timeout_seconds <= 0:
        raise ValueError("timeout_seconds must be positive")
    workspace = Path(workspace).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    home = Path(tempfile.mkdtemp(prefix="discovery-home-", dir=workspace))
    environment = dict(os.environ)
    environment["CODEX_HOME"] = str(home)
    commands = []
    requests = (
        [codex, "--version"],
        [codex, "exec", "--help"],
        [codex, "app-server", "--help"],
        [codex, "app-server", "generate-json-schema", "--help"],
        [codex, "app-server", "generate-json-schema", "--out", str(home / "schema")],
    )
    for argv in requests:
        record, _, _ = capture(argv, workspace, environment, timeout_seconds)
        commands.append(record)
    login, stdout, stderr = capture(
        [codex, "login", "status"], workspace, dict(os.environ), timeout_seconds,
        omit_output=True,
    )
    commands.append(login)
    reported_login = login["exit"] == 0 and "Logged in using ChatGPT" in (stdout + stderr)
    match = re.fullmatch(r"codex-cli\s+(\S+)\s*", commands[0]["stdout"]["text"])
    version = match.group(1) if commands[0]["exit"] == 0 and match else "unverified"
    schemas = []
    schema_root = home / "schema"
    if commands[4]["exit"] == 0 and schema_root.is_dir():
        for path in sorted(schema_root.rglob("*.json")):
            if path.is_symlink() or not path.is_file():
                continue
            contents = path.read_bytes()
            schemas.append({
                "path": path.relative_to(home).as_posix(), "bytes": len(contents),
                "sha256": hashlib.sha256(contents).hexdigest(),
            })
    capabilities = {
        "host": "codex-cli", "version": version, "adapter": "unverified",
        "checkpoints": [], "pauses_worker": False, "same_task_delivery": False,
        "delivery_receipts": False, "pre_tool_control": False,
        "gaps": ["No live checkpoint observed", "No same-task advisory marker receipt"],
    }
    luna = {
        "status": "unverified", "provider": "codex-cli",
        "requested_model": "gpt-6-luna", "requested_reasoning": "low",
        "model": None, "checkpoint": None, "supported_outputs": [],
        "probabilities": False, "certification": None,
        "reason": "no_successful_repository_subprocess_inference",
    }
    return {
        "status": "unverified", "capabilities": capabilities,
        "commands": commands, "schema_files": schemas,
        "authentication": {
            "status": "unverified", "reported_login": reported_login,
            "reason": "login_report_only" if reported_login else "login_status_failed",
        },
        "providers": {
            "luna": luna,
            "jev": {"status": "unverified", "supported_outputs": [], "reason": "no_endpoint"},
        },
        "runtime": socket_directory_state(),
        "safety": {"global_configuration_changes": False, "credentials_read": False,
                   "live_execution_attempted": False},
    }


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_key")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("non_finite_json")


def validate_luna_output(output, kind, labels=()):
    try:
        answer = json.loads(output, object_pairs_hook=unique_object, parse_constant=reject_constant)
    except (ValueError, TypeError):
        return {"outcome": "malformed", "reason": "invalid_json"}
    fields = {"choice": "pick", "noul": "value", "score": "level"}
    field = fields.get(kind)
    if not isinstance(answer, dict) or field is None or set(answer) != {field}:
        return {"outcome": "malformed", "reason": "answer_fields"}
    value = answer[field]
    if kind == "noul":
        valid = value is None or isinstance(value, bool)
    else:
        valid = isinstance(value, str) and value in labels
    if not valid:
        return {"outcome": "malformed", "reason": "answer_value"}
    return {"outcome": "valid", "answer": answer}


def main():
    parser = argparse.ArgumentParser(description="Discover Codex interfaces without certifying live delivery.")
    parser.add_argument("--codex", default="codex")
    parser.add_argument("--out", type=Path, default=Path("artifacts/expert-host"))
    parser.add_argument("--timeout-seconds", type=int, default=60)
    arguments = parser.parse_args()
    result = probe(arguments.codex, arguments.out, arguments.timeout_seconds)
    target = arguments.out / "capabilities.json"
    target.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "record": str(target)}))


if __name__ == "__main__":
    main()
