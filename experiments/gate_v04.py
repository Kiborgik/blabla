import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "artifacts" / "v04"
BINARY = ROOT / "target" / "debug" / ("blabla.exe" if os.name == "nt" else "blabla")
LIFECYCLE_APP = ROOT / "tests" / "fixtures" / "lifecycle" / "app.py"
GLYPH_CONTRACT = ROOT / "artifacts" / "glyph-vault" / "feature" / "behavior.bla"
GLYPH_APP = ROOT / "artifacts" / "glyph-vault" / "feature_reference" / "glyph_vault" / "main.py"
GLYPH_BASELINE = ROOT / "artifacts" / "coverage" / "final-003" / "clean.json"
PYTHON = sys.executable

GATES = [
    ("fmt", ["cargo", "fmt", "--all", "--", "--check"]),
    ("clippy", ["cargo", "clippy", "--offline", "--all-targets", "--", "-D", "warnings"]),
    ("rust-tests", ["cargo", "test", "--offline"]),
    ("build", ["cargo", "build", "--offline"]),
    ("todo-python", [PYTHON, "-m", "unittest", "discover", "-s", "examples/todo", "-p", "test_*.py"]),
    ("experiment-python", [PYTHON, "-m", "unittest", "discover", "-s", "experiments", "-p", "test_*.py"]),
]


def run(command, cwd=None, timeout=1800):
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


def gates(tag):
    results = []
    for name, command in GATES:
        exit_code, stdout, stderr, seconds = run(command)
        log = OUT / f"gate-{tag}-{name}.log"
        log.write_text(stdout + stderr, encoding="utf-8")
        results.append({"name": name, "command": command, "exit": exit_code, "seconds": seconds, "log": log.name})
        print(f"{name}: exit {exit_code} in {seconds:.1f}s", flush=True)
    (OUT / f"gates-{tag}.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    return results


def test_lines_are_clean(tag):
    log = (OUT / f"gate-{tag}-rust-tests.log").read_text(encoding="utf-8")
    summaries = [line for line in log.splitlines() if line.startswith("test result:")]
    failed_titles = [line for line in log.splitlines() if line.startswith("test ") and line.rstrip().endswith("FAILED")]
    return summaries, failed_titles


def contracts():
    baseline = json.loads((ROOT / "artifacts" / "coverage" / "contracts.json").read_text(encoding="utf-8"))
    results = []
    for entry in baseline["contracts"]:
        path = ROOT / entry["path"]
        exit_code, stdout, stderr, _ = run([str(BINARY), "check", str(path), "--json"])
        results.append({"path": entry["path"], "exit": exit_code, "report": json.loads(stdout) if stdout.strip() else None, "stderr": stderr.strip()})
    projects = []
    for manifest in sorted(ROOT.glob("tests/fixtures/projects/**/project.bla")):
        exit_code, stdout, stderr, _ = run([str(BINARY), "--project", str(manifest), "check", "--json"])
        projects.append({"manifest": str(manifest.relative_to(ROOT)).replace("\\", "/"), "exit": exit_code, "report": json.loads(stdout) if stdout.strip() else None, "stderr": stderr.strip()})
    (OUT / "contracts.json").write_text(json.dumps({"contracts": results, "projects": projects}, indent=2), encoding="utf-8")
    return results, projects


def capture(name, steps, cwd):
    lines = []
    exits = []
    for command in steps:
        display = " ".join("blabla" if part == str(BINARY) else part for part in command)
        exit_code, stdout, stderr, _ = run(command, cwd=cwd)
        exits.append(exit_code)
        lines.append(f"$ {display}\n{stdout}{stderr}[exit {exit_code}]\n")
    (OUT / "demos" / f"{name}.txt").write_text("\n".join(lines), encoding="utf-8")
    return exits


def demos():
    (OUT / "demos").mkdir(parents=True, exist_ok=True)
    fixtures = ROOT / "tests" / "fixtures" / "projects"
    app = str(LIFECYCLE_APP)
    summary = {}
    with tempfile.TemporaryDirectory() as temp:
        temp = Path(temp)
        simple = temp / "simple"
        shutil.copytree(fixtures / "simple", simple)
        summary["simple"] = capture(
            "simple",
            [
                [str(BINARY), "status"],
                [str(BINARY), "run", "--cases", "2", "--steps", "12", "--", PYTHON, app, "persistent"],
                [str(BINARY), "status"],
                [str(BINARY), "explain", "persistence"],
            ],
            simple,
        )
        multi = temp / "multi"
        shutil.copytree(fixtures / "multi", multi)
        summary["multi"] = capture(
            "multi",
            [
                [str(BINARY), "check"],
                [str(BINARY), "run", "--cases", "2", "--steps", "12", "--", PYTHON, app, "persistent"],
                [str(BINARY), "status"],
                [str(BINARY), "run", "--cases", "1", "--steps", "8", "--shrink-budget", "16", "--", PYTHON, app, "memory"],
                [str(BINARY), "status"],
                [str(BINARY), "explain", "persistence::persistence"],
                [str(BINARY), "explain", "increment"],
            ],
            multi / "contracts" / "behavior",
        )
        nested = temp / "nested"
        shutil.copytree(fixtures / "nested", nested)
        summary["nested"] = capture(
            "nested",
            [
                [str(BINARY), "status"],
                [str(BINARY), "--project", str(nested), "status"],
            ],
            nested / "apps" / "server" / "src" / "domain",
        )
        collision = temp / "collision"
        shutil.copytree(fixtures / "collision", collision)
        summary["collision"] = capture(
            "collision",
            [
                [str(BINARY), "check"],
                [str(BINARY), "--json", "check"],
            ],
            collision,
        )
        fresh = temp / "fresh"
        fresh.mkdir()
        (fresh / "AGENTS.md").write_text("# Fresh app\n\nExisting agent notes stay here.\n", encoding="utf-8")
        summary["init"] = capture(
            "init",
            [
                [str(BINARY), "init", "--agents", "--dry-run"],
                [str(BINARY), "init", "--agents"],
                [str(BINARY), "init", "--agents"],
                [str(BINARY), "check"],
                [str(BINARY), "status"],
                [str(BINARY), "run", "--", PYTHON, app, "persistent"],
            ],
            fresh,
        )
        (OUT / "demos" / "init-AGENTS.md").write_text((fresh / "AGENTS.md").read_text(encoding="utf-8"), encoding="utf-8")
        (OUT / "demos" / "init-project.bla").write_text((fresh / "project.bla").read_text(encoding="utf-8"), encoding="utf-8")
        (OUT / "demos" / "init-SKILL.md").write_text((fresh / ".agents" / "skills" / "blabla" / "SKILL.md").read_text(encoding="utf-8"), encoding="utf-8")
        stale = temp / "stale"
        shutil.copytree(fixtures / "simple", stale)
        run([str(BINARY), "run", "--cases", "2", "--steps", "12", "--", PYTHON, app, "persistent"], cwd=stale)
        (stale / "src").mkdir()
        (stale / "src" / "main.py").write_text("print('changed')\n", encoding="utf-8")
        summary["stale"] = capture("stale", [[str(BINARY), "status"]], stale)
        empty = temp / "empty"
        empty.mkdir()
        summary["no-project"] = capture("no-project", [[str(BINARY), "status"]], empty)
        profiled = temp / "profiled"
        shutil.copytree(fixtures / "simple", profiled)
        shutil.copy(LIFECYCLE_APP, profiled / "app.py")
        manifest = (fixtures / "simple" / "project.bla").read_text(encoding="utf-8")
        profile = "\nverify behavior {\n    command [\"python\", \"app.py\", \"persistent\"]\n    seed 0\n    cases 2\n    steps %d\n    timeout_ms 1000\n    shrink_budget 256\n}\n"
        (profiled / "project.bla").write_text(manifest + profile % 12, encoding="utf-8")
        summary["finish"] = capture(
            "finish",
            [
                [str(BINARY), "status"],
                [str(BINARY), "finish"],
                [str(BINARY), "status"],
                [str(BINARY), "run", "--cases", "1", "--steps", "1", "--", PYTHON, "app.py", "persistent"],
                [str(BINARY), "status"],
                [str(BINARY), "--json", "finish"],
            ],
            profiled,
        )
        (profiled / "project.bla").write_text(manifest + profile % 1, encoding="utf-8")
        summary["finish-blocked"] = capture(
            "finish-blocked",
            [
                [str(BINARY), "status"],
                [str(BINARY), "finish"],
                [str(BINARY), "status"],
            ],
            profiled / "contracts",
        )
        (profiled / "project.bla").write_text(manifest + "\nverify behavior {\n    command [\"python\", \"missing/app.py\"]\n}\n", encoding="utf-8")
        summary["finish-path"] = capture("finish-path", [[str(BINARY), "finish"], [str(BINARY), "--json", "finish"]], profiled)
        summary["finish-no-profile"] = capture("finish-no-profile", [[str(BINARY), "finish"]], simple)
        commanded = temp / "commanded"
        commanded.mkdir()
        summary["init-command"] = capture(
            "init-command",
            [[str(BINARY), "init", "--agents", "--command", "python", "./main.py"], [str(BINARY), "status"]],
            commanded,
        )
        (OUT / "demos" / "init-command-project.bla").write_text((commanded / "project.bla").read_text(encoding="utf-8"), encoding="utf-8")
    summary["guides"] = capture(
        "guides",
        [
            [str(BINARY), "--help"],
            [str(BINARY), "guide"],
            [str(BINARY), "guide", "agent"],
            [str(BINARY), "guide", "bootstrap"],
            [str(BINARY), "guide", "change"],
        ],
        ROOT,
    )
    return summary


def glyph():
    command = [
        str(BINARY),
        "run",
        str(GLYPH_CONTRACT),
        "--seed",
        "0",
        "--cases",
        "1",
        "--steps",
        "4096",
        "--timeout-ms",
        "1000",
        "--shrink-budget",
        "256",
        "--json",
        "--",
        PYTHON,
        str(GLYPH_APP),
    ]
    exit_code, stdout, stderr, seconds = run(command, timeout=1800)
    (OUT / "glyph-clean.json").write_text(stdout, encoding="utf-8")
    report = json.loads(stdout)
    baseline = json.loads(GLYPH_BASELINE.read_text(encoding="utf-8"))

    def logical(document):
        return {
            "status": document["status"],
            "verified": document["verified"],
            "unexercised": document["unexercised"],
            "violated": document["violated"],
            "steps_executed": document["steps_executed"],
            "actions_to_full_coverage": document["metrics"]["actions_to_full_coverage"],
            "coverage": [
                (item["id"], item["status"], item["first_witness_action"], item["witnesses"])
                for item in document["coverage"]
            ],
            "sequences": document["sequences"],
        }

    identical = logical(report) == logical(baseline)
    summary = {
        "command": command,
        "exit": exit_code,
        "seconds": seconds,
        "status": report["status"],
        "verified": report["verified"],
        "unexercised": report["unexercised"],
        "violated": report["violated"],
        "steps_executed": report["steps_executed"],
        "actions_to_full_coverage": report["metrics"]["actions_to_full_coverage"],
        "logical_facts_identical_to_v03_final": identical,
        "stderr": stderr.strip(),
    }
    (OUT / "glyph-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"glyph: exit {exit_code} {report['status']} {report['verified']}/{report['verified'] + report['unexercised'] + report['violated']} identical={identical} in {seconds:.1f}s", flush=True)
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True)
    parser.add_argument("--skip-glyph", action="store_true")
    parser.add_argument("--out", default="v04")
    arguments = parser.parse_args()
    global OUT
    OUT = ROOT / "artifacts" / arguments.out
    OUT.mkdir(parents=True, exist_ok=True)
    gate_results = gates(arguments.tag)
    summaries, failed_titles = test_lines_are_clean(arguments.tag)
    contract_results, project_results = contracts()
    demo_summary = demos()
    glyph_summary = None if arguments.skip_glyph else glyph()
    overall = {
        "tag": arguments.tag,
        "gates_green": all(result["exit"] == 0 for result in gate_results),
        "rust_test_summaries": summaries,
        "rust_failed_titles": failed_titles,
        "existing_contracts_compiled": all(result["exit"] == 0 for result in contract_results),
        "fixture_projects": [(project["manifest"], project["exit"]) for project in project_results],
        "demos": demo_summary,
        "glyph": glyph_summary,
    }
    (OUT / f"summary-{arguments.tag}.json").write_text(json.dumps(overall, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in overall.items() if key not in {"demos"}}, indent=2))


if __name__ == "__main__":
    main()
