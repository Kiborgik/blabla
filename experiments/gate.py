import argparse
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
    ("rust-tests", ("cargo", "test", "@cargo")),
    ("gate-schedule", ("@python", "-m", "unittest", "discover", "-s", "experiments", "-p", "test_gate*.py")),
    ("todo-python", ("@python", "-m", "unittest", "discover", "-s", "examples/todo", "-p", "test_*.py")),
    ("bridge", ("cargo", "build", "@cargo", "--quiet", "--example", "structure-adapter")),
    ("bridge-tests", ("cargo", "test", "@cargo", "--quiet", "--example", "structure-adapter")),
    ("questions-campaign", ("@blabla", "run", "contracts/questions.bla", "--cases", "32", "--steps", "512", "--timeout-ms", "5000", "--", "target/debug/examples/structure-adapter")),
    ("self-hosting-finish", ("@blabla", "finish")),
    ("self-hosting-status", ("@blabla", "status")),
    ("example-python", ("@blabla", "--project", "examples/todo", "finish")),
    ("example-typescript", ("@blabla", "--project", "examples/todo-ts", "finish")),
    ("example-go", ("@blabla", "--project", "examples/todo-go", "finish")),
    ("example-c", ("@blabla", "--project", "examples/todo-c", "finish")),
    ("example-cpp", ("@blabla", "--project", "examples/todo-cpp", "finish")),
    ("example-java", ("@blabla", "--project", "examples/todo-java", "finish")),
    ("audit", ("@python", "experiments/audit_public_tree.py", "--out", "@out")),
    ("diagrams", ("@python", "experiments/render_diagrams.py", "--check")),
)

REQUIRED_ORDER = (
    ("bridge", "self-hosting-finish"),
    ("bridge", "questions-campaign"),
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


def run(command, timeout=1800):
    started = time.perf_counter()
    completed = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    return completed.returncode, completed.stdout + completed.stderr, time.perf_counter() - started


def rust_tests_are_clean(log):
    summaries = [line for line in log.splitlines() if line.startswith("test result:")]
    failed_titles = [line for line in log.splitlines() if line.startswith("test ") and line.rstrip().endswith("FAILED")]
    counted = all(" 0 failed;" in line for line in summaries)
    return summaries, failed_titles, bool(summaries) and counted and not failed_titles


def main():
    parser = argparse.ArgumentParser(description="BlaBla product gate: current product health only.")
    parser.add_argument("--tag", default="local")
    parser.add_argument("--out", default="artifacts/gate")
    parser.add_argument("--offline", action="store_true", help="resolve cargo dependencies from the local cache only; for local runs, never for CI")
    arguments = parser.parse_args()
    out = ROOT / arguments.out
    out.mkdir(parents=True, exist_ok=True)

    results = []
    logs = []
    rust_log = ""
    try:
        for name, command in checks(out, arguments.offline):
            exit_code, log, seconds = run(command)
            logs.append((name, log))
            if name == "rust-tests":
                rust_log = log
            results.append({"name": name, "command": command, "exit": exit_code, "seconds": seconds})
            print(f"{name}: exit {exit_code} in {seconds:.1f}s", flush=True)
    finally:
        for name, log in logs:
            (out / f"{arguments.tag}-{name}.log").write_text(log, encoding="utf-8")

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
