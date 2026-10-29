import argparse
import asyncio
import codecs
from contextlib import nullcontext
import io
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTHON = sys.executable


STEPS = (
    ("fmt", ("cargo", "fmt", "--all", "--", "--check")),
    ("clippy", ("cargo", "clippy", "@cargo", "--all-targets", "--", "-D", "warnings")),
    ("rust-tests", ("cargo", "nextest", "run", "@cargo", "--no-fail-fast", "--color", "never")),
    ("gate-schedule", ("@python", "-m", "unittest", "discover", "-s", "experiments", "-p", "test_gate*.py")),
    ("systemone-provider", ("@python", "-m", "unittest", "discover", "-s", "experiments", "-p", "test_systemone_provider.py")),
    ("native-expert", ("@python", "-m", "unittest", "discover", "-s", "experiments", "-p", "test_native_expert.py")),
    ("todo-python", ("@python", "-m", "unittest", "discover", "-s", "examples/todo", "-p", "test_*.py")),
    ("bridge", ("cargo", "build", "@cargo", "--quiet", "--example", "structure-adapter")),
    ("bridge-tests", ("cargo", "test", "@cargo", "--quiet", "--example", "structure-adapter")),
    ("self-hosting-finish", ("@blabla", "finish")),
    ("self-hosting-status", ("@blabla", "status")),
    ("example-python", ("@blabla", "--project", "examples/todo", "finish")),
    ("example-typescript", ("@blabla", "--project", "examples/todo-ts", "finish")),
    ("example-go", ("@blabla", "--project", "examples/todo-go", "finish")),
    ("example-c", ("@blabla", "--project", "examples/todo-c", "finish")),
    ("example-cpp", ("@blabla", "--project", "examples/todo-cpp", "finish")),
    ("example-java", ("@blabla", "--project", "examples/todo-java", "finish")),
    ("audit", ("@python", "experiments/audit_public_tree.py", "--out", "@out")),
    ("docs-links", ("@python", "experiments/check_text.py", "links")),
    ("versions", ("@python", "experiments/check_text.py", "versions")),
    ("diagrams", ("@python", "experiments/render_diagrams.py", "--check")),
)

REQUIRED_ORDER = (
    ("bridge", "self-hosting-finish"),
    ("self-hosting-finish", "self-hosting-status"),
)


def ordered(steps, required):
    positions = {name: index for index, (name, _) in enumerate(steps)}
    for earlier, later in required:
        missing = [name for name in (earlier, later) if name not in positions]
        if missing:
            return f"the schedule does not contain {', '.join(missing)}"
        if positions[earlier] >= positions[later]:
            return f"{earlier} must run before {later}"
    return None


def checks(out, offline):
    cargo = ["--offline"] if offline else []
    expansions = {
        "@cargo": cargo,
        "@python": [PYTHON],
        "@out": [str(out / "audit.json")],
        "@blabla": ["cargo", "run", *cargo, "--quiet", "--bin", "blabla", "--"],
    }
    return [
        (name, [part for token in tokens for part in expansions.get(token, [token])])
        for name, tokens in steps_of(STEPS)
    ]


def steps_of(steps):
    violation = ordered(steps, REQUIRED_ORDER)
    if violation is not None:
        raise SystemExit(f"gate schedule: {violation}")
    return steps


class CommandProgress(asyncio.SubprocessProtocol):
    def __init__(self, artifact):
        self.artifact = artifact
        self.output = []
        self.decoder = io.IncrementalNewlineDecoder(
            codecs.getincrementaldecoder("utf-8")("replace"), translate=True,
        )
        self.finished = asyncio.get_running_loop().create_future()
        self.error = None

    def connection_made(self, transport):
        self.transport = transport

    def emit(self, text):
        self.output.append(text)
        if self.artifact is not None:
            self.artifact.write(text)
            self.artifact.flush()
        print(text, end="", flush=True)

    def pipe_data_received(self, fd, data):
        try:
            self.emit(self.decoder.decode(data))
        except Exception as error:
            self.error = error
            self.transport.close()

    def pipe_connection_lost(self, fd, error):
        self.error = self.error or error
        if error is not None:
            self.transport.close()

    def connection_lost(self, error):
        self.error = self.error or error
        self.finished.set_result(None)


async def run_streaming(command, timeout, artifact, started):
    loop = asyncio.get_running_loop()
    progress = CommandProgress(artifact)
    transport, _ = await loop.subprocess_exec(
        lambda: progress, *command, cwd=ROOT,
        stdin=None, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    timed_out = False
    try:
        remaining = max(0, timeout - (time.perf_counter() - started))
        try:
            await asyncio.wait_for(asyncio.shield(progress.finished), remaining)
        except TimeoutError:
            timed_out = True
            transport.close()
            await progress.finished
        if progress.error is not None:
            raise progress.error
        progress.emit(progress.decoder.decode(b"", final=True))
        if timed_out:
            progress.emit(f"\ngate command timed out after {timeout:g} seconds: {command!r}\n")
        return 124 if timed_out else transport.get_returncode(), "".join(progress.output)
    finally:
        transport.close()


def run(command, timeout=1800, log_path=None):
    started = time.perf_counter()
    with log_path.open("w", encoding="utf-8", newline="\n") if log_path is not None else nullcontext() as artifact:
        code, output = asyncio.run(run_streaming(command, timeout, artifact, started))
    return code, output, time.perf_counter() - started


FAILED_STATUSES = ("FAIL", "TIMEOUT", "SIGSEGV", "SIGABRT", "SIGBUS", "SIGILL", "ABORT", "LEAK-FAIL")


def rust_tests_are_clean(log):
    lines = [line.strip() for line in log.splitlines()]
    summaries = [line for line in lines if line.startswith("Summary [")]
    failed_titles = list(dict.fromkeys(line for line in lines if line.split(" [", 1)[0] in FAILED_STATUSES))
    counted = all(" failed" not in line for line in summaries)
    return summaries, failed_titles, bool(summaries) and counted and not failed_titles


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="BlaBla product gate: current product health only.")
    parser.add_argument("--tag", default="local")
    parser.add_argument("--out", default="artifacts/gate")
    parser.add_argument("--offline", action="store_true", help="resolve cargo dependencies from the local cache only; for local runs, never for CI")
    arguments = parser.parse_args()
    out = ROOT / arguments.out
    out.mkdir(parents=True, exist_ok=True)

    results = []
    rust_log = ""
    for name, command in checks(out, arguments.offline):
        print(f"{name}: starting {command!r}", flush=True)
        exit_code, log, seconds = run(command, log_path=out / f"{arguments.tag}-{name}.log")
        if name == "rust-tests":
            rust_log = log
        results.append({"name": name, "command": command, "exit": exit_code, "seconds": seconds})
        print(f"{name}: exit {exit_code} in {seconds:.1f}s", flush=True)

    summaries, failed_titles, clean = rust_tests_are_clean(rust_log)
    green = all(result["exit"] == 0 for result in results) and clean
    summary = {
        "tag": arguments.tag,
        "gate": "product",
        "green": green,
        "seconds": sum(result["seconds"] for result in results),
        "checks": results,
        "rust_test_summaries": summaries,
        "rust_failed_titles": failed_titles,
    }
    (out / f"summary-{arguments.tag}.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in summary.items() if key != "checks"}, indent=2))
    print(f"\nproduct gate: {'GREEN' if green else 'RED'} in {summary['seconds']:.1f}s", flush=True)
    return 0 if green else 1


if __name__ == "__main__":
    sys.exit(main())
