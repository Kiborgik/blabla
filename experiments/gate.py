import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTHON = sys.executable


def checks(out, offline):
    cargo = ["--offline"] if offline else []
    blabla = ["cargo", "run", *cargo, "--quiet", "--bin", "blabla", "--"]
    return [
        ("fmt", ["cargo", "fmt", "--all", "--", "--check"]),
        ("clippy", ["cargo", "clippy", *cargo, "--all-targets", "--", "-D", "warnings"]),
        ("rust-tests", ["cargo", "test", *cargo]),
        ("todo-python", [PYTHON, "-m", "unittest", "discover", "-s", "examples/todo", "-p", "test_*.py"]),
        ("self-hosting-status", [*blabla, "status"]),
        ("self-hosting-finish", [*blabla, "finish"]),
        ("audit", [PYTHON, "experiments/audit_public_tree.py", "--out", str(out / "audit.json")]),
        ("diagrams", [PYTHON, "experiments/render_diagrams.py", "--check"]),
    ]


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
    rust_log = ""
    for name, command in checks(out, arguments.offline):
        exit_code, log, seconds = run(command)
        (out / f"{arguments.tag}-{name}.log").write_text(log, encoding="utf-8")
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
