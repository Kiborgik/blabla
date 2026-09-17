import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLABLA = [
    "cargo", "run", "--quiet",
    "--manifest-path", str(ROOT / "Cargo.toml"),
    "--bin", "blabla", "--",
]
PYTHON = sys.executable
GLYPH_CONTRACT = ROOT / "artifacts" / "glyph-vault" / "feature" / "behavior.bla"
GLYPH_APP = ROOT / "artifacts" / "glyph-vault" / "feature_reference" / "glyph_vault" / "main.py"
GLYPH_BASELINE = ROOT / "artifacts" / "coverage" / "final-003" / "clean.json"
GLYPH_EXAMPLE = ROOT / "examples" / "glyph-vault"
BROKEN_FIXTURES = [
    ROOT / "tests" / "fixtures" / "structure" / "glyph-durable-id",
    ROOT / "tests" / "fixtures" / "structure" / "glyph-dead-restart",
]

def checks(offline):
    cargo = ["--offline"] if offline else []
    return [
        ("stress-tests", ["cargo", "test", *cargo, "--", "--ignored"]),
        ("scorer-tests", [PYTHON, "-m", "unittest", "discover", "-s", "experiments", "-p", "test_*.py"]),
    ]

HISTORICAL = [
    ("gate-v05", [PYTHON, "experiments/gate_v05.py", "--tag", "reproduction"]),
    ("gate-v04", [PYTHON, "experiments/gate_v04.py"]),
]


def run(command, cwd=None, timeout=3600):
    started = time.perf_counter()
    completed = subprocess.run(
        command,
        cwd=cwd or ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    return completed.returncode, completed.stdout, completed.stderr, time.perf_counter() - started


def logical(document):
    return {
        "status": document["status"],
        "verified": document["verified"],
        "unexercised": document["unexercised"],
        "violated": document["violated"],
        "steps_executed": document["steps_executed"],
        "actions_to_full_coverage": document["metrics"]["actions_to_full_coverage"],
        "coverage": [(item["id"], item["status"], item["first_witness_action"], item["witnesses"]) for item in document["coverage"]],
        "sequences": document["sequences"],
    }


def require_frozen_inputs():
    missing = [path for path in (GLYPH_CONTRACT, GLYPH_APP, GLYPH_BASELINE) if not path.exists()]
    if missing:
        names = ", ".join(str(path.relative_to(ROOT)).replace("\\", "/") for path in missing)
        raise SystemExit(
            f"frozen Glyph reproduction needs untracked local evidence that is absent: {names}; "
            "run with --skip-glyph to state that this run does not cover it"
        )


def glyph_frozen(out):
    command = [
        *BLABLA, "run", str(GLYPH_CONTRACT),
        "--seed", "0", "--cases", "1", "--steps", "4096",
        "--timeout-ms", "1000", "--shrink-budget", "256", "--json",
        "--", PYTHON, str(GLYPH_APP),
    ]
    exit_code, stdout, stderr, seconds = run(command)
    (out / "glyph-clean.json").write_text(stdout, encoding="utf-8")
    report = json.loads(stdout)
    baseline = json.loads(GLYPH_BASELINE.read_text(encoding="utf-8"))
    identical = logical(report) == logical(baseline)
    print(f"glyph-frozen: exit {exit_code} {report['status']} identical={identical} in {seconds:.1f}s", flush=True)
    return {
        "exit": exit_code,
        "seconds": seconds,
        "status": report["status"],
        "steps_executed": report["steps_executed"],
        "logical_facts_identical_to_v03_final": identical,
        "green": exit_code == 0 and identical,
        "stderr": stderr.strip()[-400:],
    }


def finish_project(directory, name, out):
    exit_code, stdout, stderr, seconds = run([*BLABLA, "--json", "finish"], cwd=directory)
    (out / f"{name}-finish.json").write_text(stdout, encoding="utf-8")
    document = json.loads(stdout) if stdout.strip() else {}
    project = document.get("project", {})
    structure = project.get("structure", {})
    summary = {
        "directory": str(directory.relative_to(ROOT)).replace("\\", "/"),
        "exit": exit_code,
        "seconds": seconds,
        "behavior": document.get("status"),
        "structure": structure.get("status"),
        "structure_red_rules": [rule["id"] for rule in structure.get("rules", []) if rule["status"] == "red"],
        "overall": project.get("overall", {}).get("status"),
        "stderr_tail": stderr.strip()[-400:],
    }
    print(f"glyph-layers {name}: exit {exit_code} behavior={summary['behavior']} structure={summary['structure']} overall={summary['overall']} in {seconds:.1f}s", flush=True)
    return summary


def glyph_layers(out):
    results = {"clean": finish_project(GLYPH_EXAMPLE, "glyph-clean-project", out)}
    for fixture in BROKEN_FIXTURES:
        results[fixture.name] = finish_project(fixture, fixture.name, out)
    expected = {"clean": ("green", 0), "glyph-durable-id": ("red", 1), "glyph-dead-restart": ("red", 1)}
    green = all(results[name]["structure"] == structure and results[name]["exit"] == exit_code for name, (structure, exit_code) in expected.items())
    return {"projects": results, "green": green}


def main():
    parser = argparse.ArgumentParser(description="BlaBla research gate: slow reproduction and research evidence. Never part of product development.")
    parser.add_argument("--tag", default="local")
    parser.add_argument("--out", default="artifacts/research")
    parser.add_argument("--historical", action="store_true", help="also replay the frozen v0.4 and v0.5 release gates")
    parser.add_argument("--offline", action="store_true", help="resolve cargo dependencies from the local cache only; for local runs, never for CI")
    parser.add_argument("--skip-glyph", action="store_true", help="state that this run does not cover the 4096-step Glyph reproduction; required where its untracked baselines are absent")
    arguments = parser.parse_args()
    out = ROOT / arguments.out
    out.mkdir(parents=True, exist_ok=True)

    results = []
    for name, command in checks(arguments.offline) + (HISTORICAL if arguments.historical else []):
        exit_code, stdout, stderr, seconds = run(command)
        (out / f"{arguments.tag}-{name}.log").write_text(stdout + stderr, encoding="utf-8")
        results.append({"name": name, "command": command, "exit": exit_code, "seconds": seconds})
        print(f"{name}: exit {exit_code} in {seconds:.1f}s", flush=True)

    if not arguments.skip_glyph:
        require_frozen_inputs()
    frozen = None if arguments.skip_glyph else glyph_frozen(out)
    layers = None if arguments.skip_glyph else glyph_layers(out)
    green = (
        all(result["exit"] == 0 for result in results)
        and (frozen is None or frozen["green"])
        and (layers is None or layers["green"])
    )
    summary = {
        "tag": arguments.tag,
        "gate": "research",
        "green": green,
        "historical_replayed": arguments.historical,
        "seconds": sum(result["seconds"] for result in results) + (frozen["seconds"] if frozen else 0) + (sum(p["seconds"] for p in layers["projects"].values()) if layers else 0),
        "checks": results,
        "glyph_frozen": frozen,
        "glyph_layers": layers,
    }
    (out / f"summary-{arguments.tag}.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print(f"\nresearch gate: {'GREEN' if green else 'RED'} in {summary['seconds']:.1f}s", flush=True)
    return 0 if green else 1


if __name__ == "__main__":
    sys.exit(main())
