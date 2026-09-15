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
OUT = ROOT / "artifacts" / "v05"
BINARY = ROOT / "target" / "debug" / ("blabla.exe" if os.name == "nt" else "blabla")
LIFECYCLE_APP = ROOT / "tests" / "fixtures" / "lifecycle" / "app.py"
GLYPH_CONTRACT = ROOT / "artifacts" / "glyph-vault" / "feature" / "behavior.bla"
GLYPH_APP = ROOT / "artifacts" / "glyph-vault" / "feature_reference" / "glyph_vault" / "main.py"
GLYPH_BASELINE = ROOT / "artifacts" / "coverage" / "final-003" / "clean.json"
GLYPH_EXAMPLE = ROOT / "examples" / "glyph-vault"
BROKEN_FIXTURES = [
    ROOT / "tests" / "fixtures" / "structure" / "glyph-durable-id",
    ROOT / "tests" / "fixtures" / "structure" / "glyph-dead-restart",
]
PYTHON = sys.executable

GATES = [
    ("fmt", ["cargo", "fmt", "--all", "--", "--check"]),
    ("clippy", ["cargo", "clippy", "--offline", "--all-targets", "--", "-D", "warnings"]),
    ("rust-tests", ["cargo", "test", "--offline"]),
    ("build", ["cargo", "build", "--offline"]),
    ("todo-python", [PYTHON, "-m", "unittest", "discover", "-s", "examples/todo", "-p", "test_*.py"]),
    ("experiment-python", [PYTHON, "-m", "unittest", "discover", "-s", "experiments", "-p", "test_*.py"]),
    ("diagrams", [PYTHON, "experiments/render_diagrams.py", "--check"]),
    ("audit", [PYTHON, "experiments/audit_public_tree.py", "--out", "artifacts/v05/audit.json"]),
]


def run(command, cwd=None, timeout=1800, env=None):
    started = time.perf_counter()
    completed = subprocess.run(
        command,
        cwd=cwd or ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        env=env,
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
    for path in [GLYPH_EXAMPLE / "contracts" / "structure" / "architecture.bla", ROOT / "examples" / "todo" / "structure.bla"]:
        exit_code, stdout, stderr, _ = run([str(BINARY), "check", str(path), "--json"])
        results.append({"path": str(path.relative_to(ROOT)).replace("\\", "/"), "exit": exit_code, "report": json.loads(stdout) if stdout.strip() else None, "stderr": stderr.strip()})
    projects = []
    manifests = sorted(ROOT.glob("tests/fixtures/projects/**/project.bla")) + sorted(ROOT.glob("tests/fixtures/structure/*/project.bla")) + [GLYPH_EXAMPLE / "project.bla", ROOT / "examples" / "todo" / "project.bla"]
    for manifest in manifests:
        exit_code, stdout, stderr, _ = run([str(BINARY), "--project", str(manifest), "check", "--json"])
        projects.append({"manifest": str(manifest.relative_to(ROOT)).replace("\\", "/"), "exit": exit_code, "report": json.loads(stdout) if stdout.strip() else None, "stderr": stderr.strip()})
    (OUT / "contracts.json").write_text(json.dumps({"contracts": results, "projects": projects}, indent=2), encoding="utf-8")
    return results, projects


def capture(name, steps, cwd, env=None):
    lines = []
    exits = []
    for command in steps:
        display = " ".join("blabla" if part == str(BINARY) else part for part in command)
        exit_code, stdout, stderr, _ = run(command, cwd=cwd, env=env)
        exits.append(exit_code)
        lines.append(f"$ {display}\n{stdout}{stderr}[exit {exit_code}]\n")
    (OUT / "demos" / f"{name}.txt").write_text("\n".join(lines), encoding="utf-8")
    return exits


def copy_fixture(name, target):
    shutil.copytree(ROOT / "tests" / "fixtures" / "projects" / name, target)
    shutil.copy(LIFECYCLE_APP, target / "app.py")


def demos():
    (OUT / "demos").mkdir(parents=True, exist_ok=True)
    summary = {}
    with tempfile.TemporaryDirectory() as temp:
        temp = Path(temp)
        layered = temp / "layered"
        copy_fixture("layered", layered)
        summary["layered"] = capture(
            "layered",
            [
                [str(BINARY), "status"],
                [str(BINARY), "finish"],
                [str(BINARY), "status"],
                [str(BINARY), "--json", "status"],
                [str(BINARY), "explain", "architecture::no-socket"],
                [str(BINARY), "check"],
            ],
            layered,
        )
        broken = temp / "layered-broken"
        copy_fixture("layered", broken)
        (broken / "contracts" / "structure" / "architecture.bla").write_text(
            "module app \"app.py\"\n\nrequire \"storage-declared\": symbol app::storage\nforbid  \"no-subprocess\":   dependency app -> \"subprocess\"\nforbid  \"no-marker\":       symbol app::marker\n",
            encoding="utf-8",
        )
        summary["layered-structure-red"] = capture(
            "layered-structure-red",
            [
                [str(BINARY), "finish"],
                [str(BINARY), "status"],
                [str(BINARY), "explain", "no-subprocess"],
                [str(BINARY), "--json", "explain", "no-subprocess"],
            ],
            broken,
        )
        yellow = temp / "layered-yellow"
        copy_fixture("layered", yellow)
        manifest = (yellow / "project.bla").read_text(encoding="utf-8").replace("steps 12", "steps 1")
        (yellow / "project.bla").write_text(manifest, encoding="utf-8")
        summary["layered-behavior-yellow"] = capture("layered-behavior-yellow", [[str(BINARY), "finish"], [str(BINARY), "status"]], yellow)
        structure_only = temp / "structure-only"
        copy_fixture("layered", structure_only)
        (structure_only / "project.bla").write_text("project StructureOnly\n\nuse structure \"contracts/structure/architecture.bla\"\n", encoding="utf-8")
        summary["structure-only"] = capture("structure-only", [[str(BINARY), "finish"], [str(BINARY), "status"]], structure_only)
        no_python = temp / "no-python"
        copy_fixture("layered", no_python)
        env = dict(os.environ)
        env["PATH"] = ""
        env.pop("Path", None)
        summary["provider-missing"] = capture("provider-missing", [[str(BINARY), "status"], [str(BINARY), "--json", "status"]], no_python, env=env)
        todo = temp / "todo"
        shutil.copytree(ROOT / "examples" / "todo", todo, ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copy(ROOT / "examples" / "todo.bla", temp / "todo.bla")
        summary["todo"] = capture("todo", [[str(BINARY), "status"], [str(BINARY), "finish"], [str(BINARY), "status"]], todo)
        summary["quickstart"] = quickstart(temp / "quickstart")
    summary["glyph-status"] = capture("glyph-status", [[str(BINARY), "status"], [str(BINARY), "--json", "status"]], GLYPH_EXAMPLE)
    summary["guides"] = capture(
        "guides",
        [[str(BINARY), "--help"], [str(BINARY), "--version"], [str(BINARY), "guide", "agent"], [str(BINARY), "guide", "bootstrap"], [str(BINARY), "guide", "change"]],
        ROOT,
    )
    return summary


def quickstart(directory):
    directory.mkdir()
    shutil.copy(ROOT / "examples" / "hello" / "app.py", directory / "app.py")
    steps = [[str(BINARY), "init", "--agents", "--command", "python", "app.py"]]
    exits = capture("quickstart-init", steps, directory)
    (directory / "contracts" / "behavior" / "core.bla").write_text((ROOT / "examples" / "hello.bla").read_text(encoding="utf-8"), encoding="utf-8")
    manifest = (directory / "project.bla").read_text(encoding="utf-8").replace("draft behavior", "use behavior")
    (directory / "project.bla").write_text(manifest, encoding="utf-8")
    exits += capture("quickstart-behavior", [[str(BINARY), "check"], [str(BINARY), "finish"], [str(BINARY), "status"]], directory)
    (directory / "contracts" / "structure").mkdir()
    (directory / "contracts" / "structure" / "layout.bla").write_text(
        "module app \"app.py\"\n\nrequire \"emit-helper\": symbol app::emit\nforbid  \"no-network\":  dependency app -> \"socket\"\n",
        encoding="utf-8",
    )
    manifest = (directory / "project.bla").read_text(encoding="utf-8").replace("use behavior", "use structure \"contracts/structure/layout.bla\"\nuse behavior", 1)
    (directory / "project.bla").write_text(manifest, encoding="utf-8")
    exits += capture("quickstart-structure", [[str(BINARY), "finish"], [str(BINARY), "status"], [str(BINARY), "explain", "layout::no-network"]], directory)
    return exits


def glyph_frozen():
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
            "coverage": [(item["id"], item["status"], item["first_witness_action"], item["witnesses"]) for item in document["coverage"]],
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
    print(f"glyph frozen: exit {exit_code} {report['status']} identical={identical} in {seconds:.1f}s", flush=True)
    return summary


def finish_project(directory, name):
    exit_code, stdout, stderr, seconds = run([str(BINARY), "--json", "finish"], cwd=directory, timeout=1800)
    (OUT / f"{name}-finish.json").write_text(stdout, encoding="utf-8")
    document = json.loads(stdout) if stdout.strip() else {}
    human_exit, human, human_err, _ = run([str(BINARY), "status"], cwd=directory)
    (OUT / "demos" / f"{name}-status.txt").write_text(f"$ blabla status\n{human}{human_err}[exit {human_exit}]\n", encoding="utf-8")
    project = document.get("project", {})
    summary = {
        "directory": str(directory.relative_to(ROOT)).replace("\\", "/"),
        "exit": exit_code,
        "seconds": seconds,
        "behavior": document.get("status"),
        "verified": document.get("verified"),
        "unexercised": document.get("unexercised"),
        "violated": document.get("violated"),
        "structure": project.get("structure", {}).get("status"),
        "structure_verified": project.get("structure", {}).get("verified"),
        "structure_violated": project.get("structure", {}).get("violated"),
        "structure_red_rules": [rule["id"] for rule in project.get("structure", {}).get("rules", []) if rule["status"] == "red"],
        "overall": project.get("overall", {}).get("status"),
        "completion": document.get("completion", {}).get("state"),
        "status_exit": human_exit,
        "stderr_tail": stderr.strip()[-400:],
    }
    print(f"{name}: exit {exit_code} behavior={summary['behavior']} structure={summary['structure']} overall={summary['overall']} in {seconds:.1f}s", flush=True)
    return summary


def glyph_layers():
    results = {"clean": finish_project(GLYPH_EXAMPLE, "glyph-clean")}
    for fixture in BROKEN_FIXTURES:
        results[fixture.name] = finish_project(fixture, fixture.name)
    (OUT / "glyph-layers.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True)
    parser.add_argument("--skip-glyph", action="store_true")
    parser.add_argument("--out", default="v05")
    arguments = parser.parse_args()
    global OUT
    OUT = ROOT / "artifacts" / arguments.out
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "demos").mkdir(exist_ok=True)
    gate_results = gates(arguments.tag)
    summaries, failed_titles = test_lines_are_clean(arguments.tag)
    contract_results, project_results = contracts()
    demo_summary = demos()
    glyph_summary = None if arguments.skip_glyph else glyph_frozen()
    layers = None if arguments.skip_glyph else glyph_layers()
    overall = {
        "tag": arguments.tag,
        "version": run([str(BINARY), "--version"])[1].strip(),
        "gates_green": all(result["exit"] == 0 for result in gate_results),
        "rust_test_summaries": summaries,
        "rust_failed_titles": failed_titles,
        "existing_contracts_compiled": all(result["exit"] == 0 for result in contract_results),
        "fixture_projects": [(project["manifest"], project["exit"]) for project in project_results],
        "demos": demo_summary,
        "glyph_frozen": glyph_summary,
        "glyph_layers": layers,
    }
    (OUT / f"summary-{arguments.tag}.json").write_text(json.dumps(overall, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in overall.items() if key not in {"demos"}}, indent=2))


if __name__ == "__main__":
    main()
