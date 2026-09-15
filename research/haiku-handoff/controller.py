import argparse
import difflib
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
BINARY = ROOT / "target" / "debug" / ("blabla.exe" if os.name == "nt" else "blabla")
ARCHITECTURE = ROOT / "artifacts" / "glyph-vault" / "architecture.md"
DEPENDENCIES = ROOT / "artifacts" / "glyph-vault" / "dependencies"
DRIVER_DIR = ROOT / "artifacts" / "glyph-vault" / "base" / "tests"
PYTHON = sys.executable
PACKAGES = HERE / "packages"
REQUIREMENTS = PACKAGES / "requirements"
RUNS = HERE / "runs"
PREP = HERE / "prep"
MANIFEST = HERE / "manifest.json"
C_RUNS = RUNS / "C-v042"
MANIFEST_C = HERE / "manifest-C.json"
TEMPLATE_C = PREP / "template-C-v042"
TEMPLATES_C = PREP / "templates-C-v042.json"
VALIDATION_C = "validation-v042"
FROZEN_KEYS = ["contracts_sha256", "reference_sha256", "packages_sha256", "requirements_sha256", "architecture_sha256", "scoring_sha256", "scorer_files_by_stage", "canonical_profile", "template_c_sha256"]
STAGES = [1, 2, 3, 4]
CONDITIONS = ["A", "B", "C"]
MODEL = "claude-haiku-4-5-20251001"
SHELL_PATTERNS = ["python *", "python3 *", "py *", "blabla *", "blabla.exe *", "ls *", "dir *", "cat *", "type *", "find *", "pwd", "cd *", "Get-ChildItem *", "Get-Content *", "Get-Location", "Set-Location *", "echo *", "Write-Output *"]
ALLOWED_TOOLS = [f"Bash({pattern})" for pattern in SHELL_PATTERNS] + [f"PowerShell({pattern})" for pattern in SHELL_PATTERNS]
SESSION_BUDGET_USD = 10
TOTAL_BUDGET_USD = 40
WALL_CLOCK_SECONDS = 40 * 60
TOOL_TIMEOUT_MS = 600000
CLAUDE_FLAGS = ["--model", MODEL, "--safe-mode", "--strict-mcp-config", "--no-session-persistence", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--permission-prompts", "none", "--max-budget-usd", str(SESSION_BUDGET_USD)]
AGENTS_HEADER = "# Glyph Vault\n\nLayer rules for this repository: architecture.md.\n\n"
SCORER_FILES = {
    1: ["test_behavior.py", "test_sealing.py", "test_quarantine.py", "test_resonance.py"],
    2: ["test_behavior.py", "test_sealing.py", "test_quarantine.py", "test_resonance.py", "test_echo.py"],
    3: ["test_behavior.py", "test_sealing.py", "test_quarantine.py", "test_resonance.py", "test_echo.py"],
    4: ["test_behavior.py", "test_sealing.py", "test_quarantine.py", "test_resonance.py", "test_echo.py", "test_recovery.py"],
}
REQUIREMENT_FILES = {
    1: ["core-and-sealing.md", "quarantine.md", "resonance.md"],
    2: ["core-and-sealing.md", "quarantine.md", "resonance.md", "echo.md"],
    3: ["core-and-sealing.md", "quarantine.md", "resonance.md", "echo.md", "persistence-refactor.md"],
    4: ["core-and-sealing.md", "quarantine.md", "resonance.md", "echo.md", "persistence-refactor.md", "recovery.md"],
}
DECISION_FILES = {
    1: ["decisions-base.md", "decisions-resonance.md"],
    2: ["decisions-base.md", "decisions-resonance.md", "decisions-echo.md"],
    3: ["decisions-base.md", "decisions-resonance.md", "decisions-echo.md"],
    4: ["decisions-base.md", "decisions-resonance.md", "decisions-echo.md", "decisions-persistence.md", "decisions-recovery.md"],
}
SKIP_HASH = (".blabla", "__pycache__", ".test-data")
VERIFICATION_WORDS = ("python", "python3", "py", "blabla")
DOC_SUFFIXES = (".md", ".txt", ".bla")
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
INVALIDITY = [
    "model id, Claude Code flags, allowed tools or budgets differ from the manifest",
    "controller.py, a stage contract, a stage reference, a package, a requirements file, a scorer, the driver or the blabla binary hash differs from the manifest",
    "a workspace is touched by anyone but the subject between prepare and run, or a stage does not start from the previous stage's final tree of the same condition",
    "a run directory is reused, resumed or continued after the subject stopped",
    "a subject receives any hint, fix, file pointer or interpretation from the controller or a human, or a branch is repaired between stages",
    "the canonical profile in the stage manifests or the controller's diagnostic campaign differs from the frozen profile",
]


def read(path):
    return Path(path).read_text(encoding="utf-8")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def text_sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def tree_hashes(root, skip=SKIP_HASH):
    result = {}
    for path in sorted(Path(root).rglob("*")):
        if path.is_file() and not any(part in skip for part in path.relative_to(root).parts):
            result[str(path.relative_to(root)).replace("\\", "/")] = sha256(path)
    return result


def hashes_of(directory, pattern="*"):
    return {path.name: sha256(path) for path in sorted(Path(directory).glob(pattern)) if path.is_file()}


def run(command, cwd=None, env=None, timeout=3600):
    started = time.perf_counter()
    completed = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return completed.returncode, completed.stdout, completed.stderr, time.perf_counter() - started


def copy_app(workspace, stage=0):
    shutil.copytree(HERE / "reference" / f"stage-{stage}", workspace / "glyph_vault", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy(ARCHITECTURE, workspace / "architecture.md")


def contract_files(stage):
    return sorted((HERE / "contracts" / f"stage-{stage}").glob("*.bla"))


def install_contracts(workspace, stage):
    behavior = workspace / "contracts" / "behavior"
    behavior.mkdir(parents=True, exist_ok=True)
    for file in contract_files(stage):
        shutil.copy(file, workspace / "project.bla" if file.name == "project.bla" else behavior / file.name)


def authoritative_path(workspace, name):
    return workspace / "project.bla" if name == "project.bla" else workspace / "contracts" / "behavior" / name


def contract_hashes(workspace, stage):
    hashes = {}
    for file in contract_files(stage):
        target = authoritative_path(workspace, file.name)
        hashes[file.name] = sha256(target) if target.exists() else None
    authoritative = {file.name for file in contract_files(stage)}
    for path in sorted(workspace.rglob("*.bla")):
        relative = str(path.relative_to(workspace)).replace("\\", "/")
        if path.name in authoritative and path == authoritative_path(workspace, path.name):
            continue
        hashes[f"extra:{relative}"] = sha256(path)
    return hashes


def contract_tampering(workspace, stage):
    differences = []
    for file in contract_files(stage):
        target = authoritative_path(workspace, file.name)
        if not target.exists():
            differences.append({"file": file.name, "state": "missing"})
        elif sha256(target) != sha256(file):
            diff = list(difflib.unified_diff(read(file).splitlines(), read(target).splitlines(), fromfile=f"authoritative/{file.name}", tofile=f"subject/{file.name}", lineterm=""))
            differences.append({"file": file.name, "state": "modified", "diff": diff})
    for key in contract_hashes(workspace, stage):
        if key.startswith("extra:"):
            differences.append({"file": key[len("extra:"):], "state": "added"})
    return differences


def restore_contracts(workspace, stage):
    removed = []
    for path in sorted((workspace / "contracts").rglob("*.bla")) if (workspace / "contracts").exists() else []:
        if path != authoritative_path(workspace, path.name) or path.name not in {file.name for file in contract_files(stage)}:
            removed.append(str(path.relative_to(workspace)).replace("\\", "/"))
            path.unlink()
    install_contracts(workspace, stage)
    return removed


def blabla(workspace, arguments, extra_env=None):
    env = dict(os.environ)
    if extra_env:
        env.update(extra_env)
    return run([str(BINARY), "--project", str(workspace), *arguments], cwd=workspace, env=env)


def finish(workspace):
    exit_code, stdout, stderr, seconds = blabla(workspace, ["--json", "finish"])
    return exit_code, (json.loads(stdout) if stdout.strip() else None), stderr, seconds


def campaign_summary(exit_code, report, stderr, seconds):
    if report is None:
        return {"exit": exit_code, "seconds": seconds, "stderr": stderr.strip()}
    summary = {
        "exit": exit_code,
        "seconds": round(seconds, 1),
        "status": report.get("status"),
        "completion": report.get("completion", {}).get("state") if isinstance(report.get("completion"), dict) else report.get("completion"),
        "verified": report.get("verified"),
        "unexercised": report.get("unexercised"),
        "violated": report.get("violated"),
        "steps_executed": report.get("steps_executed"),
        "actions_to_full_coverage": report.get("metrics", {}).get("actions_to_full_coverage"),
        "groups": [(group["name"], group["counts"]["green"], group["counts"]["total"]) for group in report.get("project", {}).get("groups", [])],
        "unexercised_ids": [item["id"] for item in report.get("coverage", []) if item["status"] == "unexercised"],
    }
    if report.get("status") == "red":
        summary["property"] = report.get("property")
        summary["original_sequence_length"] = report.get("original_sequence_length")
        summary["minimal_sequence_length"] = report.get("minimal_sequence_length")
        summary["minimal_sequence"] = report.get("minimal_sequence")
    if "category" in report:
        summary["error"] = {"category": report.get("category"), "message": report.get("message"), "code": report.get("code")}
    return summary


def scorer_environment(workspace, stage):
    env = dict(os.environ)
    env["GLYPH_APP"] = str(workspace / "glyph_vault" / "main.py")
    env["GLYPH_STAGE"] = str(stage)
    env["PYTHONPATH"] = str(DEPENDENCIES)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def parse_results(stdout):
    passed = sorted({line.split(" ", 1)[1].strip() for line in stdout.splitlines() if line.startswith("PASSED ")})
    failed = sorted({line.split(" ", 1)[1].split(" - ")[0].strip() for line in stdout.splitlines() if line.startswith("FAILED ")})
    errors = sorted({line.split(" ", 1)[1].split(" - ")[0].strip() for line in stdout.splitlines() if line.startswith("ERROR ")})
    return passed, failed, errors


def score(workspace, stage, log_path):
    env = scorer_environment(workspace, stage)
    scoring = HERE / "scoring"
    behavior = run([PYTHON, "-m", "pytest", "-q", "-rA", "-p", "no:cacheprovider", *SCORER_FILES[stage]], cwd=scoring, env=env, timeout=1800)
    architecture = run([PYTHON, "-m", "pytest", "-q", "-rA", "-p", "no:cacheprovider", "test_architecture.py"], cwd=scoring, env=env, timeout=600)
    Path(log_path).with_suffix(".behavior.log").write_text(behavior[1] + behavior[2], encoding="utf-8")
    Path(log_path).with_suffix(".architecture.log").write_text(architecture[1] + architecture[2], encoding="utf-8")
    passed, failed, errors = parse_results(behavior[1])
    summary_line = next((line for line in reversed(behavior[1].splitlines()) if "passed" in line or "failed" in line or "error" in line), "")
    return {
        "stage": stage,
        "behavior": "PASS" if behavior[0] == 0 else "FAIL",
        "behavior_exit": behavior[0],
        "behavior_summary": summary_line.strip(),
        "checks_total": len(passed) + len(failed) + len(errors),
        "checks_passed": len(passed),
        "behavior_failed": failed + errors,
        "behavior_passed": passed,
        "behavior_seconds": round(behavior[3], 1),
        "architecture": "PASS" if architecture[0] == 0 else "FAIL",
        "architecture_exit": architecture[0],
        "architecture_failures": [line for line in architecture[1].splitlines() if line.startswith("E   ") or " is missing" in line or "violat" in line][:40],
        "architecture_seconds": round(architecture[3], 1),
    }


def by_file(ids):
    return {check: check.split("::", 1)[0] for check in ids}


def drift(current, previous):
    if previous is None:
        return {"old_checks_failing": 0, "regressions_introduced": [], "regressions_recovered": [], "regressions_remaining": [], "new_feature_failed": current["behavior_failed"]}
    old_files = set(SCORER_FILES[previous["stage"]])
    old_failed_now = [check for check in current["behavior_failed"] if by_file([check])[check] in old_files]
    previously_failed = set(previous["behavior_failed"])
    return {
        "old_checks_failing": len(old_failed_now),
        "regressions_introduced": [check for check in old_failed_now if check not in previously_failed],
        "regressions_recovered": sorted(check for check in previously_failed if check in current["behavior_passed"]),
        "regressions_remaining": [check for check in old_failed_now if check in previously_failed],
        "new_feature_failed": [check for check in current["behavior_failed"] if by_file([check])[check] not in old_files],
    }


def application_answers(workspace):
    sys.path.insert(0, str(DRIVER_DIR))
    from driver import Session

    os.environ["GLYPH_APP"] = str(workspace / "glyph_vault" / "main.py")
    try:
        session = Session()
        try:
            rows = session.observe()
            return isinstance(rows, list) and len(rows) == 3, None
        finally:
            session.close()
    except Exception as failure:
        return False, repr(failure)


def workspace_from(out, name, stage, reference_stage=None):
    workspace = out / name
    if workspace.exists():
        shutil.rmtree(workspace)
    workspace.mkdir(parents=True)
    copy_app(workspace, stage if reference_stage is None else reference_stage)
    install_contracts(workspace, stage)
    return workspace


MUTATIONS = {
    1: ("domain.py", [("        if vault.phase == 0 and vault.charge > 5:\n            vault.charge = 5\n            vault.resonance = 0\n        else:\n            vault.resonance += 1\n", "        if vault.phase == 0 and vault.charge > 5:\n            vault.charge = 5\n        if vault.phase == 0:\n            vault.resonance = 0\n        else:\n            vault.resonance += 1\n")], "rotate resets resonance on every return instead of only when the cap fires"),
    2: ("domain.py", [(" or origin.resonance < 1 or origin.phase != destination.phase:", " or origin.resonance < 1:")], "echo ignores the equal-phase requirement"),
    3: (None, [("model.py", 'DURABLE_FIELDS = ("keeper", "glyph", "charge", "sealed", "quarantined")', 'DURABLE_FIELDS = ("keeper", "glyph", "charge", "sealed", "quarantined", "resonance")'), ("model.py", "    sealed: bool\n    quarantined: bool\n", "    sealed: bool\n    quarantined: bool\n    resonance: int = 0\n"), ("domain.py", "item.sealed, item.quarantined)", "item.sealed, item.quarantined, item.resonance)"), ("domain.py", "v.sealed, v.quarantined) for v in", "v.sealed, v.quarantined, v.resonance) for v in")], "the refactored store persists resonance"),
    4: ("domain.py", [("        vault.quarantined = False\n        vault.phase = 0\n        vault.resonance = 0\n", "        vault.quarantined = False\n        vault.phase = 0\n        vault.resonance = 0\n        if vault.charge > 5:\n            vault.charge = 5\n")], "recover applies rotate's return cap"),
}


def apply_mutation(workspace, stage):
    file, edits, description = MUTATIONS[stage]
    for edit in edits:
        target_name, needle, replacement = (file, *edit) if file else edit
        target = workspace / "glyph_vault" / target_name
        source = read(target)
        assert source.count(needle) == 1, (stage, target_name, source.count(needle))
        target.write_text(source.replace(needle, replacement), encoding="utf-8")
    return description


def validate(out, stages):
    out.mkdir(parents=True, exist_ok=True)
    results = {}
    for stage in stages:
        entry = {}
        reference = workspace_from(out, f"reference-stage-{stage}", stage)
        exit_code, report, stderr, seconds = finish(reference)
        (out / f"reference-stage-{stage}-finish.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        entry["reference_finish"] = campaign_summary(exit_code, report, stderr, seconds)
        entry["reference_scorer"] = score(reference, stage, out / f"reference-stage-{stage}-scorer")
        previous = workspace_from(out, f"previous-stage-{stage}", stage, reference_stage=stage - 1)
        entry["previous_reference_scorer"] = score(previous, stage, out / f"previous-stage-{stage}-scorer")
        previous_finish = finish(previous)
        entry["previous_reference_finish"] = campaign_summary(*previous_finish)
        mutated = workspace_from(out, f"mutation-stage-{stage}", stage)
        entry["mutation"] = apply_mutation(mutated, stage)
        exit_code, report, stderr, seconds = finish(mutated)
        (out / f"mutation-stage-{stage}-finish.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        entry["mutation_finish"] = campaign_summary(exit_code, report, stderr, seconds)
        entry["mutation_scorer"] = score(mutated, stage, out / f"mutation-stage-{stage}-scorer")
        results[stage] = entry
        print(json.dumps({
            "stage": stage,
            "reference_finish": {key: entry["reference_finish"].get(key) for key in ("status", "verified", "unexercised", "seconds", "actions_to_full_coverage")},
            "reference_scorer": (entry["reference_scorer"]["behavior"], entry["reference_scorer"]["checks_passed"], entry["reference_scorer"]["architecture"]),
            "previous_scorer": (entry["previous_reference_scorer"]["behavior"], len(entry["previous_reference_scorer"]["behavior_failed"]), entry["previous_reference_scorer"]["architecture"]),
            "previous_finish": {key: entry["previous_reference_finish"].get(key) for key in ("status", "error")},
            "mutation": entry["mutation"],
            "mutation_finish": {key: entry["mutation_finish"].get(key) for key in ("status", "property", "original_sequence_length", "minimal_sequence_length", "seconds")},
            "mutation_scorer": (entry["mutation_scorer"]["behavior"], len(entry["mutation_scorer"]["behavior_failed"])),
        }), flush=True)
        (out / "validation.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    return results


def build_templates():
    template = PREP / "template"
    if template.exists():
        shutil.rmtree(template)
    template.mkdir(parents=True)
    copy_app(template)
    template_c = PREP / "template-C"
    if template_c.exists():
        shutil.rmtree(template_c)
    template_c.mkdir(parents=True)
    copy_app(template_c)
    install_contracts(template_c, 0)
    init_exit, init_out, init_err, _ = blabla(template_c, ["init", "--agents"])
    if init_exit != 0:
        raise SystemExit(f"init failed: {init_out}{init_err}")
    agents = template_c / "AGENTS.md"
    agents.write_text(AGENTS_HEADER + read(agents), encoding="utf-8")
    (PACKAGES / "C-AGENTS.md").write_text(read(agents), encoding="utf-8")
    exit_code, report, stderr, seconds = finish(template_c)
    if exit_code != 0:
        raise SystemExit(f"template-C canonical finish did not reach GREEN: {stderr}")
    summary = {"template": tree_hashes(template), "template_c": tree_hashes(template_c), "template_c_finish": campaign_summary(exit_code, report, stderr, seconds), "agents_md": read(agents)}
    (PREP / "templates.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in summary.items() if key != "agents_md"}, indent=2))
    print(summary["agents_md"])
    return summary


def package_text(condition, stage, workspace=None):
    if condition == "A":
        requirements = "\n".join(read(REQUIREMENTS / name) for name in REQUIREMENT_FILES[stage])
        decisions = "".join(read(REQUIREMENTS / name) for name in DECISION_FILES[stage])
        return "# Project context\n\n" + requirements + "\n# Architecture\n\n" + read(ARCHITECTURE) + "\n" + decisions
    if condition == "B":
        return read(PACKAGES / f"stage-{stage}" / "B-summary.md")
    if condition == "C":
        agents = read(workspace / "AGENTS.md") if workspace is not None else read(PACKAGES / "C-AGENTS.md")
        return "# Repository onboarding (AGENTS.md)\n\n" + agents
    raise ValueError(condition)


def prompt_text(condition, stage, workspace=None):
    return read(PACKAGES / f"stage-{stage}" / "task.txt") + "\n---\n\n" + package_text(condition, stage, workspace)


def run_dir_for(condition, stage):
    if condition == "C":
        return C_RUNS / f"stage-{stage}"
    return RUNS / condition / f"stage-{stage}"


def manifest_for(condition):
    return MANIFEST_C if condition == "C" else MANIFEST


def build_template_c():
    if TEMPLATE_C.exists():
        shutil.rmtree(TEMPLATE_C)
    TEMPLATE_C.mkdir(parents=True)
    copy_app(TEMPLATE_C)
    install_contracts(TEMPLATE_C, 0)
    init_exit, init_out, init_err, _ = blabla(TEMPLATE_C, ["init", "--agents"])
    if init_exit != 0:
        raise SystemExit(f"init failed: {init_out}{init_err}")
    agents = TEMPLATE_C / "AGENTS.md"
    agents.write_text(AGENTS_HEADER + read(agents), encoding="utf-8")
    if read(agents) != read(PACKAGES / "C-AGENTS.md"):
        raise SystemExit("generated AGENTS.md differs from the frozen onboarding text packages/C-AGENTS.md")
    exit_code, report, stderr, seconds = finish(TEMPLATE_C)
    if exit_code != 0:
        raise SystemExit(f"template-C canonical finish did not reach GREEN: {stderr}")
    hashes = tree_hashes(TEMPLATE_C)
    baseline = json.loads(read(MANIFEST))["template_c_sha256"]
    differences = sorted(path for path in set(hashes) | set(baseline) if hashes.get(path) != baseline.get(path))
    if differences:
        raise SystemExit(f"template-C differs from the frozen A/B-era template: {differences}")
    summary = {"template_c": hashes, "template_c_finish": campaign_summary(exit_code, report, stderr, seconds), "blabla": {"binary_sha256": sha256(BINARY), "version": run([str(BINARY), "--version"], cwd=HERE, timeout=60)[1].strip()}, "agents_md": read(agents)}
    TEMPLATES_C.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in summary.items() if key != "agents_md"}, indent=2))
    return summary


def summary_metrics(stage):
    text = read(PACKAGES / f"stage-{stage}" / "B-summary.md")
    metrics = {"bytes": len(text.encode("utf-8")), "lines": len(text.splitlines())}
    if stage > 1:
        previous = read(PACKAGES / f"stage-{stage - 1}" / "B-summary.md").splitlines()
        diff = list(difflib.unified_diff(previous, text.splitlines(), lineterm=""))
        metrics["lines_added"] = sum(1 for line in diff if line.startswith("+") and not line.startswith("+++"))
        metrics["lines_removed"] = sum(1 for line in diff if line.startswith("-") and not line.startswith("---"))
    return metrics


def clean_caches(workspace):
    for path in list(workspace.rglob("__pycache__")) + list(workspace.rglob(".test-data")):
        shutil.rmtree(path, ignore_errors=True)


def prepare(condition, stage):
    run_dir = run_dir_for(condition, stage)
    if run_dir.exists():
        raise SystemExit(f"{run_dir} exists; refusing to overwrite a run directory")
    workspace = run_dir / "work"
    preparation = {"condition": condition, "stage": stage}
    if stage == 1:
        source = TEMPLATE_C if condition == "C" else PREP / "template"
        preparation["source"] = str(source)
        shutil.copytree(source, workspace, ignore=shutil.ignore_patterns("__pycache__", ".test-data"))
    else:
        previous_dir = run_dir_for(condition, stage - 1)
        if not (previous_dir / "final-files.json").exists():
            raise SystemExit(f"{previous_dir} has no final-files.json; the previous stage's subject must have stopped first")
        if (previous_dir / "broken.json").exists():
            raise SystemExit(f"chain {condition} is BROKEN at stage {stage - 1}; stage {stage} is not run")
        preparation["source"] = str(previous_dir / "work")
        shutil.copytree(previous_dir / "work", workspace, ignore=shutil.ignore_patterns("__pycache__", ".test-data"))
        preparation["previous_final_files"] = json.loads(read(previous_dir / "final-files.json"))
    answers, failure = application_answers(workspace)
    clean_caches(workspace)
    if not answers:
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "broken.json").write_text(json.dumps({"condition": condition, "stage": stage, "reason": "application does not answer reset/observe", "detail": failure}, indent=2), encoding="utf-8")
        raise SystemExit(f"chain {condition} is BROKEN before stage {stage}: {failure}")
    before_landing = tree_hashes(workspace)
    if condition == "C":
        if stage > 1:
            preparation["contract_audit_inherited"] = {"hashes": contract_hashes(workspace, stage - 1), "tampering": contract_tampering(workspace, stage - 1)}
        status_before = blabla(workspace, ["status"])
        preparation["status_before_landing"] = {"exit": status_before[0], "stdout": status_before[1]}
        preparation["contracts_removed_before_landing"] = restore_contracts(workspace, stage)
        preparation["contract_hashes_after_landing"] = contract_hashes(workspace, stage)
        if contract_tampering(workspace, stage):
            raise SystemExit("landed contracts do not match the authoritative stage contracts")
        status_after = blabla(workspace, ["status"])
        preparation["status_after_landing"] = {"exit": status_after[0], "stdout": status_after[1], "stderr": status_after[2]}
        tools = run_dir / "tools"
        tools.mkdir(parents=True)
        shutil.copy(BINARY, tools / BINARY.name)
        preparation["blabla_sha256"] = sha256(tools / BINARY.name)
    else:
        preparation["b_summary"] = summary_metrics(stage) if condition == "B" else None
    prompt = prompt_text(condition, stage)
    (run_dir / "prompt.txt").write_text(prompt, encoding="utf-8")
    if manifest_for(condition).exists():
        manifest = verify_manifest(condition, stage, workspace, before_landing)
        expected = manifest["prompts"][condition][str(stage)]["sha256"]
        if text_sha256(prompt) != expected:
            raise SystemExit("INVALID preparation: prompt differs from the frozen prompt")
        preparation["manifest_frozen_at_utc"] = manifest["frozen_at_utc"]
    started = {
        **preparation,
        "prompt_sha256": text_sha256(prompt),
        "prompt_bytes": len(prompt.encode("utf-8")),
        "workspace_files": tree_hashes(workspace),
        "prepared_unix": time.time(),
    }
    (run_dir / "started.json").write_text(json.dumps(started, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in started.items() if key not in {"workspace_files", "previous_final_files", "status_before_landing", "status_after_landing"}}, indent=2))
    if condition == "C":
        print(preparation["status_after_landing"]["stdout"])


def subject_environment(run_dir, condition):
    env = dict(os.environ)
    if condition == "C":
        env["PATH"] = str(Path(run_dir) / "tools") + os.pathsep + env.get("PATH", "")
        env["Path"] = env["PATH"]
    env["BASH_DEFAULT_TIMEOUT_MS"] = str(TOOL_TIMEOUT_MS)
    env["BASH_MAX_TIMEOUT_MS"] = str(TOOL_TIMEOUT_MS)
    for key in [name for name in env if name.startswith("CLAUDE_CODE_") or name in {"ANTHROPIC_MODEL", "CLAUDE_MODEL"}]:
        env.pop(key, None)
    return env


def run_subject(condition, stage):
    run_dir = run_dir_for(condition, stage)
    started = json.loads(read(run_dir / "started.json"))
    workspace = run_dir / "work"
    if tree_hashes(workspace) != started["workspace_files"]:
        raise SystemExit("workspace changed since preparation; the run is INVALID before it starts")
    if (run_dir / "transcript.jsonl").exists():
        raise SystemExit("this run directory already holds a transcript; prepare a fresh one")
    if manifest_for(condition).exists() and sha256(HERE / "controller.py") != json.loads(read(manifest_for(condition)))["controller_sha256"]:
        raise SystemExit("INVALID: controller.py changed since freeze")
    spent = total_cost_so_far()
    if spent >= TOTAL_BUDGET_USD:
        raise SystemExit(f"total benchmark budget exhausted: ${spent:.2f} of ${TOTAL_BUDGET_USD}")
    prompt = read(run_dir / "prompt.txt")
    command = ["claude", "-p", *CLAUDE_FLAGS, "--allowedTools", *ALLOWED_TOOLS]
    env = subject_environment(run_dir, condition)
    timing = {"started_unix": time.time(), "prompt_delivery": "stdin"}
    started_perf = time.perf_counter()
    timeline = []
    with (run_dir / "transcript.jsonl").open("w", encoding="utf-8") as transcript, (run_dir / "stderr.log").open("w", encoding="utf-8") as errors:
        process = subprocess.Popen(command, cwd=workspace, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, text=True, encoding="utf-8", errors="replace", shell=(os.name == "nt"))

        def pump():
            for index, line in enumerate(process.stdout):
                transcript.write(line)
                transcript.flush()
                timeline.append({"line": index, "t": round(time.perf_counter() - started_perf, 3)})

        reader = threading.Thread(target=pump, daemon=True)
        reader.start()
        process.stdin.write(prompt)
        process.stdin.close()
        try:
            exit_code = process.wait(timeout=WALL_CLOCK_SECONDS)
            timing["timed_out"] = False
        except subprocess.TimeoutExpired:
            process.kill()
            exit_code = process.wait()
            timing["timed_out"] = True
        reader.join(timeout=30)
    timing["exit"] = exit_code
    timing["ended_unix"] = time.time()
    timing["wall_seconds"] = time.perf_counter() - started_perf
    timing["command"] = command + ["< prompt.txt"]
    (run_dir / "timing.json").write_text(json.dumps(timing, indent=2), encoding="utf-8")
    (run_dir / "timeline.json").write_text(json.dumps(timeline), encoding="utf-8")
    final = tree_hashes(workspace)
    (run_dir / "final-files.json").write_text(json.dumps(final, indent=2), encoding="utf-8")
    write_diff(run_dir, started["workspace_files"], final)
    if condition == "C":
        audit = {
            "stage": stage,
            "authoritative_hashes": {file.name: sha256(file) for file in contract_files(stage)},
            "before_subject": started.get("contract_hashes_after_landing"),
            "after_subject": contract_hashes(workspace, stage),
            "tampering": contract_tampering(workspace, stage),
        }
        audit["tampered"] = bool(audit["tampering"])
        (run_dir / "contract-audit.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
        print(json.dumps({"contract_tampering": audit["tampering"]}, indent=2))
    print(json.dumps(timing, indent=2))


def write_diff(run_dir, before, after):
    workspace = Path(run_dir) / "work"
    started = json.loads(read(Path(run_dir) / "started.json"))
    source = Path(started["source"])
    lines_added = lines_removed = 0
    changed = []
    output = []
    for path in sorted(set(before) | set(after)):
        if before.get(path) == after.get(path):
            continue
        old_text = read(source / path).splitlines() if path in before and (source / path).exists() else []
        new_text = read(workspace / path).splitlines() if path in after and (workspace / path).exists() else []
        diff = list(difflib.unified_diff(old_text, new_text, fromfile=f"a/{path}", tofile=f"b/{path}", lineterm=""))
        added = sum(1 for line in diff if line.startswith("+") and not line.startswith("+++"))
        removed = sum(1 for line in diff if line.startswith("-") and not line.startswith("---"))
        lines_added += added
        lines_removed += removed
        changed.append({"path": path, "added": added, "removed": removed, "status": "modified" if path in before and path in after else ("created" if path in after else "deleted")})
        output.extend(diff)
    (Path(run_dir) / "changes.diff").write_text("\n".join(output) + "\n", encoding="utf-8")
    application = [entry for entry in changed if entry["path"].startswith("glyph_vault/") and not Path(entry["path"]).name.startswith("test")]
    tests = [entry for entry in changed if Path(entry["path"]).name.startswith("test") or "/tests/" in entry["path"] or entry["path"].startswith("tests/")]
    summary = {
        "files_changed": changed,
        "application_files_changed": len(application),
        "test_files_changed": len(tests),
        "other_files_changed": len(changed) - len(application) - len(tests),
        "lines_added": lines_added,
        "lines_removed": lines_removed,
        "application_lines_added": sum(entry["added"] for entry in application),
        "application_lines_removed": sum(entry["removed"] for entry in application),
        "test_lines_added": sum(entry["added"] for entry in tests),
        "modules_affected": sorted({Path(entry["path"]).stem for entry in application}),
        "contract_files_changed": [entry["path"] for entry in changed if entry["path"].endswith(".bla")],
    }
    (Path(run_dir) / "patch-metrics.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(text_of(part) for part in content)
    if isinstance(content, dict):
        return str(content.get("text", ""))
    return ""


def measure(condition, stage):
    run_dir = run_dir_for(condition, stage)
    lines = read(run_dir / "transcript.jsonl").splitlines()
    events = [(index, json.loads(line)) for index, line in enumerate(lines) if line.strip()]
    timeline = {entry["line"]: entry["t"] for entry in json.loads(read(run_dir / "timeline.json"))} if (run_dir / "timeline.json").exists() else {}
    usage = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
    contexts = []
    tool_calls = []
    results = {}
    turns = 0
    seen = set()
    final = None
    for index, event in events:
        kind = event.get("type")
        if kind == "assistant":
            message = event.get("message", {})
            identity = message.get("id") or f"event-{index}"
            if identity not in seen:
                seen.add(identity)
                turns += 1
                used = message.get("usage", {}) or {}
                for key in usage:
                    usage[key] += int(used.get(key, 0) or 0)
                contexts.append(sum(int(used.get(key, 0) or 0) for key in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")))
            for block in message.get("content", []) or []:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    tool_calls.append({"id": block.get("id"), "name": block.get("name"), "input": block.get("input", {}) or {}, "turn": turns, "t": timeline.get(index)})
        elif kind == "user":
            content = event.get("message", {}).get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        results[block.get("tool_use_id")] = text_of(block.get("content"))
        elif kind == "result":
            final = event
    classified = []
    for call in tool_calls:
        name = call["name"]
        entry = {"turn": call["turn"], "name": name, "t": call["t"]}
        if name in {"Bash", "PowerShell"}:
            command = str(call["input"].get("command", ""))
            entry["command"] = command
            entry["verification"] = any(re.search(rf"(^|[\s/\\]){word}(\.exe)?(\s|$)", command) for word in VERIFICATION_WORDS)
            if re.search(r"(^|[\s/\\])blabla(\.exe)?\s", command + " "):
                words = re.split(r"\s+", command.strip())
                position = next(i for i, word in enumerate(words) if re.search(r"blabla(\.exe)?$", word))
                entry["blabla"] = words[position + 1] if position + 1 < len(words) else ""
                output = results.get(call["id"], "")
                status_line = re.search(r"BEHAVIOR\s+(\d+)/(\d+)\s+(GREEN|YELLOW|RED)", output)
                if status_line:
                    entry["blabla_outcome"] = status_line.group(3)
                    entry["obligations"] = f"{status_line.group(1)}/{status_line.group(2)}"
                elif "Permission for this tool use was denied" in output:
                    entry["blabla_outcome"] = "DENIED"
                elif re.search(r"ERROR \[", output):
                    entry["blabla_outcome"] = "ERROR"
                else:
                    entry["blabla_outcome"] = next((word for word in ("STALE", "UNVERIFIED", "GREEN", "YELLOW", "RED") if word in output), None)
                gate = re.search(r"COMPLETION GATE: (GREEN|BLOCKED)", output)
                if gate:
                    entry["gate"] = gate.group(1)
                violated = re.search(r"^(\S+) violated", output, re.MULTILINE)
                if violated:
                    original = re.search(r"original sequence length: (\d+)", output)
                    minimal = re.search(r"minimal sequence length: (\d+)", output)
                    entry["counterexample"] = {"property": violated.group(1), "original_length": int(original.group(1)) if original else None, "minimal_length": int(minimal.group(1)) if minimal else None}
                explained = re.match(r"^(\S+)\nStatus:", output)
                if entry["blabla"] == "explain" and explained:
                    entry["rule"] = explained.group(1)
                elif entry["blabla"] == "explain" and position + 2 < len(words):
                    entry["rule"] = words[position + 2].strip("\"'")
                entry["runtime_visible"] = "runtime::" in output
                if entry["blabla"] == "explain":
                    entry["dependency_shown"] = "Depends on:" in output
                    entry["runtime_explained"] = bool(re.match(r"^runtime::\S+\n", output))
            for match in re.finditer(r"(?:^|[\s;&|(])(?:cat|type|Get-Content|gc)\s+(?:-Path\s+)?[\"']?([^\s\"';&|)]+)", command):
                entry.setdefault("shell_reads", []).append(match.group(1).replace("\\", "/"))
        elif name in EDIT_TOOLS or name == "Read":
            entry["path"] = str(call["input"].get("file_path", call["input"].get("path", ""))).replace("\\", "/")
        elif name in {"Glob", "Grep"}:
            entry["pattern"] = str(call["input"].get("pattern", ""))
        classified.append(entry)
    reads = [entry["path"] for entry in classified if entry["name"] == "Read"]
    edits = [entry for entry in classified if entry["name"] in EDIT_TOOLS]
    rounds = 0
    in_round = False
    for entry in classified:
        if entry["name"] in EDIT_TOOLS and "/glyph_vault/" in entry.get("path", "") and not Path(entry.get("path", "")).name.startswith("test"):
            if not in_round:
                rounds += 1
                in_round = True
        elif entry.get("verification"):
            in_round = False
    first_edit = next((i for i, entry in enumerate(classified) if entry["name"] in EDIT_TOOLS), None)
    first_app_edit = next((entry for entry in classified if entry["name"] in EDIT_TOOLS and "/glyph_vault/" in entry.get("path", "")), None)
    before_edit = classified[:first_edit] if first_edit is not None else classified
    blabla_calls = [entry for entry in classified if "blabla" in entry]
    finishes = [entry for entry in blabla_calls if entry.get("blabla") == "finish"]
    runs = [entry for entry in blabla_calls if entry.get("blabla") in {"finish", "run"}]
    final_text = (final or {}).get("result") or ""
    shell_reads = [path for entry in classified for path in entry.get("shell_reads", [])]
    any_reads = reads + shell_reads
    bla_read_any = sorted({path for path in any_reads if path.endswith(".bla")})
    explains = [entry for entry in blabla_calls if entry.get("blabla") == "explain"]
    first_runtime = next(((index, entry) for index, entry in enumerate(classified) if entry.get("runtime_visible")), None)
    runtime_discovery = {
        "runtime_dependent_rules_explained": sorted({entry["rule"] for entry in explains if entry.get("dependency_shown") and entry.get("rule")}),
        "dependency_shown_by_explain": any(entry.get("dependency_shown") for entry in explains),
        "runtime_primitives_explained": sorted({entry["rule"] for entry in explains if entry.get("runtime_explained") and entry.get("rule")}),
        "explain_runtime_restart_called": any(entry.get("rule") == "runtime::restart" for entry in explains),
        "surfaces_showing_runtime": sorted({entry.get("blabla") or "" for entry in blabla_calls if entry.get("runtime_visible")}),
        "first_runtime_visible": {"turn": first_runtime[1]["turn"], "tool_index": first_runtime[0], "surface": first_runtime[1].get("blabla"), "seconds": first_runtime[1].get("t")} if first_runtime else None,
    }
    disclosure = {
        "status_only": not explains and not bla_read_any,
        "rules_explained": sorted({entry["rule"] for entry in explains if entry.get("rule") and not entry["rule"].startswith("runtime::")}),
        "runtime_primitives_explained": runtime_discovery["runtime_primitives_explained"],
        "full_contracts_read": bla_read_any,
        "bla_files_read_count": len(bla_read_any),
        "persistence_bla_read": any(path.endswith("persistence.bla") for path in bla_read_any),
        "project_docs_read": sorted({path for path in any_reads if path.endswith((".md", ".txt"))}),
        "shell_file_reads": shell_reads,
    }
    metrics = {
        "condition": condition,
        "stage": stage,
        "runtime_discovery": runtime_discovery,
        "disclosure": disclosure,
        "turns": (final or {}).get("num_turns"),
        "api_calls": turns,
        "tool_calls": len(classified),
        "tool_calls_by_name": {name: sum(1 for entry in classified if entry["name"] == name) for name in sorted({entry["name"] for entry in classified})},
        "edits": len(edits),
        "edit_rounds": rounds,
        "verification_attempts": sum(1 for entry in classified if entry.get("verification")),
        "handoff": {
            "turns_before_first_edit": classified[first_edit]["turn"] - 1 if first_edit is not None else turns,
            "tools_before_first_edit": len(before_edit),
            "files_read_before_first_edit": sorted({entry["path"] for entry in before_edit if entry["name"] == "Read"}),
            "seconds_before_first_edit": classified[first_edit]["t"] if first_edit is not None else None,
            "seconds_before_first_application_edit": first_app_edit["t"] if first_app_edit else None,
            "first_action": classified[0] if classified else None,
        },
        "files_read_total": len(reads),
        "files_read_distinct": sorted(set(reads)),
        "docs_read": [path for path in reads if path.endswith(DOC_SUFFIXES)],
        "docs_reread": {path: reads.count(path) for path in set(reads) if path.endswith(DOC_SUFFIXES) and reads.count(path) > 1},
        "bla_files_read": sorted({path for path in reads if path.endswith(".bla")}),
        "test_files_read": sorted({path for path in reads if Path(path).name.startswith("test")}),
        "searches": [entry for entry in classified if entry["name"] in {"Glob", "Grep"}],
        "blabla": {
            "status_calls": sum(1 for entry in blabla_calls if entry.get("blabla") == "status"),
            "explain_calls": sum(1 for entry in blabla_calls if entry.get("blabla") == "explain"),
            "rules_explained": sorted({entry["rule"] for entry in blabla_calls if entry.get("rule")}),
            "finish_calls": len(finishes),
            "run_calls": sum(1 for entry in blabla_calls if entry.get("blabla") == "run"),
            "first_status_turn": next((entry["turn"] for entry in blabla_calls if entry.get("blabla") == "status"), None),
            "first_status_seconds": next((entry["t"] for entry in blabla_calls if entry.get("blabla") == "status"), None),
            "progression": [(entry["turn"], entry.get("blabla"), entry.get("blabla_outcome"), entry.get("obligations"), entry.get("gate")) for entry in blabla_calls],
            "counterexamples": [entry["counterexample"] for entry in blabla_calls if entry.get("counterexample")],
            "green_turn": next((entry["turn"] for entry in runs if entry.get("blabla_outcome") == "GREEN"), None),
            "green_seconds": next((entry["t"] for entry in runs if entry.get("blabla_outcome") == "GREEN"), None),
            "last_outcome": next((entry.get("blabla_outcome") for entry in reversed(runs)), None),
            "last_gate": next((entry.get("gate") for entry in reversed(finishes) if entry.get("gate")), None),
        },
        "usage": usage,
        "total_input_tokens": usage["input_tokens"] + usage["cache_creation_input_tokens"] + usage["cache_read_input_tokens"],
        "context_per_turn": contexts,
        "first_turn_context_tokens": contexts[0] if contexts else None,
        "max_context_tokens": max(contexts) if contexts else 0,
        "result_usage": (final or {}).get("usage"),
        "model_usage": (final or {}).get("modelUsage"),
        "total_cost_usd": (final or {}).get("total_cost_usd"),
        "duration_ms": (final or {}).get("duration_ms"),
        "duration_api_ms": (final or {}).get("duration_api_ms"),
        "stop_reason": (final or {}).get("stop_reason"),
        "subtype": (final or {}).get("subtype"),
        "permission_denials": len((final or {}).get("permission_denials") or []),
        "final_text": final_text,
        "prompt_bytes": len(read(run_dir / "prompt.txt").encode("utf-8")),
    }
    (run_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    (run_dir / "tool-calls.json").write_text(json.dumps(classified, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in metrics.items() if key not in {"context_per_turn", "searches", "files_read_distinct", "result_usage", "model_usage", "final_text", "docs_read"}}, indent=2))
    return metrics


def score_run(condition, stage):
    run_dir = run_dir_for(condition, stage)
    workspace = run_dir / "work"
    current = score(workspace, stage, run_dir / "scoring")
    previous_dir = run_dir_for(condition, stage - 1)
    if stage > 1 and not (previous_dir / "scoring.json").exists():
        raise SystemExit(f"{previous_dir} has no scoring.json; score the previous stage before this one so drift accounting stays ordered")
    previous = json.loads(read(previous_dir / "scoring.json"))["scorer"] if stage > 1 else None
    diagnostic = run_dir / "blabla-diagnostic"
    if diagnostic.exists():
        shutil.rmtree(diagnostic)
    shutil.copytree(workspace, diagnostic, ignore=shutil.ignore_patterns("__pycache__", ".test-data", ".blabla"))
    restore_contracts(diagnostic, stage)
    exit_code, report, stderr, seconds = finish(diagnostic)
    (run_dir / "blabla-final.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    metrics = json.loads(read(run_dir / "metrics.json")) if (run_dir / "metrics.json").exists() else {}
    final_text = (metrics.get("final_text") or "").lower()
    claimed = any(word in final_text for word in ("complete", "done", "implemented", "finished", "ready", "passes", "verified", "green"))
    restart_rules = {}
    for item in (report or {}).get("coverage") or []:
        if item.get("action") == "restart" and not item["id"].startswith("action/"):
            statuses = restart_rules.setdefault(item["property"], {})
            statuses[item["status"]] = statuses.get(item["status"], 0) + 1
    added_by_file = {}
    current_file = None
    for line in (read(run_dir / "changes.diff") if (run_dir / "changes.diff").exists() else "").splitlines():
        if line.startswith("+++ b/"):
            current_file = line[len("+++ b/"):]
        elif line.startswith("+") and not line.startswith("+++") and current_file and current_file.startswith("glyph_vault/"):
            added_by_file.setdefault(current_file, []).append(line[1:])
    restart_mentions = {path: [line.strip() for line in lines if re.search(r"restart", line, re.IGNORECASE)] for path, lines in added_by_file.items()}
    restart_mentions = {path: lines for path, lines in restart_mentions.items() if lines}
    handles_restart_action = any(re.search(r"[\"']restart[\"']", line) for lines in restart_mentions.values() for line in lines)
    runtime_semantics = {
        "restart_rule_obligations": restart_rules,
        "restart_rules_violated": sorted(rule for rule, statuses in restart_rules.items() if "violated" in statuses),
        "application_lines_mentioning_restart": restart_mentions,
        "application_handles_a_restart_action": handles_restart_action,
        "distinguished_trusted_restart": bool(restart_rules) and not any("violated" in statuses for statuses in restart_rules.values()) and not handles_restart_action,
    }
    result = {
        "condition": condition,
        "stage": stage,
        "scorer": current,
        "drift": drift(current, previous),
        "runtime_semantics": runtime_semantics,
        "blabla_canonical_finish_on_final_workspace": campaign_summary(exit_code, report, stderr, seconds),
        "completion_claim": {
            "declared_complete": claimed,
            "scorer_pass": current["behavior"] == "PASS" and current["architecture"] == "PASS",
            "incorrect_completion_claim": claimed and not (current["behavior"] == "PASS"),
            "subject_blabla_last_outcome": (metrics.get("blabla") or {}).get("last_outcome"),
            "subject_blabla_last_gate": (metrics.get("blabla") or {}).get("last_gate"),
            "declared_complete_while_blabla_not_green": claimed and condition == "C" and (metrics.get("blabla") or {}).get("last_outcome") not in (None, "GREEN"),
            "behavioral_green_but_refactor_missing": stage == 3 and current["architecture"] == "FAIL" and exit_code == 0,
            "subject_finish_green_while_architecture_fail": stage == 3 and current["architecture"] == "FAIL" and (metrics.get("blabla") or {}).get("last_outcome") == "GREEN",
        },
        "contract_audit": json.loads(read(run_dir / "contract-audit.json")) if condition == "C" and (run_dir / "contract-audit.json").exists() else None,
    }
    (run_dir / "scoring.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key not in {"scorer"}}, indent=2))
    print(json.dumps({key: current[key] for key in ("behavior", "behavior_summary", "behavior_failed", "architecture", "architecture_failures")}, indent=2))
    return result


def total_cost_so_far():
    total = 0.0
    for path in [*RUNS.glob("A/stage-*/metrics.json"), *RUNS.glob("B/stage-*/metrics.json"), *C_RUNS.glob("stage-*/metrics.json")]:
        total += float(json.loads(read(path)).get("total_cost_usd") or 0)
    return total


def freeze_c():
    if not TEMPLATES_C.exists():
        raise SystemExit("build the C template first: templates --condition C")
    baseline = json.loads(read(MANIFEST))
    version = run(["claude", "--version"], cwd=HERE, timeout=60)[1].strip()
    blabla_version = run([str(BINARY), "--version"], cwd=HERE, timeout=60)[1].strip()
    templates = json.loads(read(TEMPLATES_C))
    prompts = {"C": {}}
    for stage in STAGES:
        text = prompt_text("C", stage)
        prompts["C"][str(stage)] = {"sha256": text_sha256(text), "bytes": len(text.encode("utf-8")), "lines": len(text.splitlines())}
    profile = read(HERE / "contracts" / "stage-1" / "project.bla").split("verify behavior")[1]
    manifest = {
        "name": "haiku-handoff-benchmark-C-v042",
        "condition": "C",
        "baseline_manifest": "manifest.json",
        "baseline_frozen_at_utc": baseline["frozen_at_utc"],
        "frozen_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "research_question": baseline["research_question"],
        "model": {"id": MODEL, "claude_code_version": version, "flags": CLAUDE_FLAGS, "allowed_tools": ALLOWED_TOOLS, "effort": "default (flag unset)", "system_prompt": baseline["model"]["system_prompt"], "wall_clock_seconds": WALL_CLOCK_SECONDS, "max_budget_usd_per_session": SESSION_BUDGET_USD, "max_budget_usd_total": TOTAL_BUDGET_USD, "tool_timeout_ms": TOOL_TIMEOUT_MS},
        "stages": STAGES,
        "execution_order": {"C": [f"C{stage}" for stage in STAGES]},
        "sequential_chain": "C1, C2, C3, C4 strictly sequential; stage N is measured and scored before stage N+1 is prepared; no other subject session runs concurrently",
        "fresh_context_every_stage": True,
        "branch_continuity": baseline["branch_continuity"],
        "stage_3_interpretation": baseline["stage_3_interpretation"],
        "template_c_sha256": templates["template_c"],
        "template_c_finish": templates["template_c_finish"],
        "contracts_sha256": {str(stage): hashes_of(HERE / "contracts" / f"stage-{stage}") for stage in [0, *STAGES]},
        "reference_sha256": {str(stage): hashes_of(HERE / "reference" / f"stage-{stage}", "*.py") for stage in [0, *STAGES]},
        "packages_sha256": {**{f"stage-{stage}/{path.name}": sha256(path) for stage in STAGES for path in sorted((PACKAGES / f"stage-{stage}").glob("*")) if path.is_file()}, "C-AGENTS.md": sha256(PACKAGES / "C-AGENTS.md")},
        "requirements_sha256": hashes_of(REQUIREMENTS),
        "architecture_sha256": sha256(ARCHITECTURE),
        "scoring_sha256": {**hashes_of(HERE / "scoring", "*.py"), "driver.py": sha256(DRIVER_DIR / "driver.py")},
        "scorer_files_by_stage": SCORER_FILES,
        "prompts": prompts,
        "canonical_profile": "verify behavior" + profile.strip(),
        "blabla": {"binary_sha256": sha256(BINARY), "version": blabla_version},
        "python": sys.version,
        "python_executable": PYTHON,
        "controller_sha256": sha256(HERE / "controller.py"),
        "validation": f"prep/{VALIDATION_C}/validation.json",
        "invalidity": INVALIDITY,
    }
    unchanged = {key: json.loads(json.dumps(manifest[key])) == baseline[key] for key in FROZEN_KEYS}
    unchanged["model"] = manifest["model"] == baseline["model"]
    unchanged["prompts.C"] = manifest["prompts"]["C"] == baseline["prompts"]["C"]
    unchanged["python"] = manifest["python"] == baseline["python"]
    manifest["unchanged_from_baseline"] = unchanged
    manifest["changed_from_baseline"] = {"blabla": {"baseline": baseline["blabla"], "current": manifest["blabla"]}, "controller_sha256": {"baseline": baseline["controller_sha256"], "current": manifest["controller_sha256"]}, "runs_dir": str(C_RUNS.relative_to(HERE)).replace("\\", "/"), "template_dir": str(TEMPLATE_C.relative_to(HERE)).replace("\\", "/")}
    drifted = sorted(key for key, same in unchanged.items() if not same)
    if drifted:
        raise SystemExit(f"C re-freeze would change frozen inputs beyond the binary and the controller: {drifted}")
    MANIFEST_C.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in manifest.items() if key not in {"template_c_sha256", "contracts_sha256", "reference_sha256", "packages_sha256", "requirements_sha256", "scoring_sha256", "template_c_finish"}}, indent=2))
    return manifest


def freeze():
    if not (PREP / "templates.json").exists():
        raise SystemExit("build templates first")
    version = run(["claude", "--version"], cwd=HERE, timeout=60)[1].strip()
    blabla_version = run([str(BINARY), "--version"], cwd=HERE, timeout=60)[1].strip()
    templates = json.loads(read(PREP / "templates.json"))
    prompts = {condition: {} for condition in CONDITIONS}
    for stage in STAGES:
        for condition in CONDITIONS:
            text = prompt_text(condition, stage)
            prompts[condition][str(stage)] = {"sha256": text_sha256(text), "bytes": len(text.encode("utf-8")), "lines": len(text.splitlines())}
    profile = read(HERE / "contracts" / "stage-1" / "project.bla").split("verify behavior")[1]
    manifest = {
        "name": "haiku-handoff-benchmark",
        "frozen_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "research_question": "Can BlaBla preserve correctness across repeated fresh-agent handoffs while reducing the project context and rediscovery work each new agent requires?",
        "model": {"id": MODEL, "claude_code_version": version, "flags": CLAUDE_FLAGS, "allowed_tools": ALLOWED_TOOLS, "effort": "default (flag unset)", "system_prompt": "Claude Code default under --safe-mode: no user CLAUDE.md, skills, plugins, hooks or MCP servers", "wall_clock_seconds": WALL_CLOCK_SECONDS, "max_budget_usd_per_session": SESSION_BUDGET_USD, "max_budget_usd_total": TOTAL_BUDGET_USD, "tool_timeout_ms": TOOL_TIMEOUT_MS},
        "conditions": CONDITIONS,
        "stages": STAGES,
        "execution_order": {condition: [f"{condition}{stage}" for stage in STAGES] for condition in CONDITIONS},
        "parallel_chains": "the three conditions run as independent concurrent chains (owner ruling 2026-09-14); stage N+1 of a chain starts as soon as stage N's subject has stopped; measure and score of stage N run concurrently with stage N+1's subject, scoring ordered within a chain; wall-clock columns therefore include contention between chains and scorers",
        "fresh_context_every_stage": True,
        "branch_continuity": "stage N+1 of a condition starts from the exact final tree of stage N of the same condition; caches removed; for Condition C the controller-owned contracts are audited (hashes before and after every subject, tampering recorded as an intent-drift event with diffs), any subject contract edit is discarded, and the stage's authoritative contracts are re-landed; application and other source changes are preserved",
        "stage_3_interpretation": "BlaBla may be GREEN at the start of Stage 3; GREEN is behavioral completion only, the architecture scorer decides whether the refactor happened; no structure layer is added",
        "template_sha256": templates["template"],
        "template_c_sha256": templates["template_c"],
        "contracts_sha256": {str(stage): hashes_of(HERE / "contracts" / f"stage-{stage}") for stage in [0, *STAGES]},
        "reference_sha256": {str(stage): hashes_of(HERE / "reference" / f"stage-{stage}", "*.py") for stage in [0, *STAGES]},
        "packages_sha256": {**{f"stage-{stage}/{path.name}": sha256(path) for stage in STAGES for path in sorted((PACKAGES / f"stage-{stage}").glob("*")) if path.is_file()}, "C-AGENTS.md": sha256(PACKAGES / "C-AGENTS.md")},
        "requirements_sha256": hashes_of(REQUIREMENTS),
        "architecture_sha256": sha256(ARCHITECTURE),
        "scoring_sha256": {**hashes_of(HERE / "scoring", "*.py"), "driver.py": sha256(DRIVER_DIR / "driver.py")},
        "scorer_files_by_stage": SCORER_FILES,
        "prompts": prompts,
        "b_summary_metrics": {str(stage): summary_metrics(stage) for stage in STAGES},
        "canonical_profile": "verify behavior" + profile.strip(),
        "blabla": {"binary_sha256": sha256(BINARY), "version": blabla_version},
        "python": sys.version,
        "python_executable": PYTHON,
        "controller_sha256": sha256(HERE / "controller.py"),
        "validation": "prep/validation.json",
        "invalidity": INVALIDITY,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in manifest.items() if key not in {"template_sha256", "template_c_sha256", "contracts_sha256", "reference_sha256", "packages_sha256", "requirements_sha256", "scoring_sha256"}}, indent=2))
    return manifest


def verify_manifest(condition, stage, workspace, before_landing):
    manifest = json.loads(read(manifest_for(condition)))
    problems = []
    if condition == "C" and manifest.get("condition") != "C":
        problems.append("manifest-C.json is not a Condition C manifest")
    if sha256(HERE / "controller.py") != manifest["controller_sha256"]:
        problems.append("controller.py changed since freeze")
    if sha256(BINARY) != manifest["blabla"]["binary_sha256"]:
        problems.append("blabla binary changed since freeze")
    for key in [0, *STAGES]:
        if hashes_of(HERE / "contracts" / f"stage-{key}") != manifest["contracts_sha256"][str(key)]:
            problems.append(f"stage-{key} contracts changed since freeze")
    if hashes_of(REQUIREMENTS) != manifest["requirements_sha256"]:
        problems.append("requirements changed since freeze")
    packages = {**{f"stage-{s}/{path.name}": sha256(path) for s in STAGES for path in sorted((PACKAGES / f"stage-{s}").glob("*")) if path.is_file()}, "C-AGENTS.md": sha256(PACKAGES / "C-AGENTS.md")}
    if packages != manifest["packages_sha256"]:
        problems.append("packages changed since freeze")
    if {**hashes_of(HERE / "scoring", "*.py"), "driver.py": sha256(DRIVER_DIR / "driver.py")} != manifest["scoring_sha256"]:
        problems.append("scorer changed since freeze")
    if stage == 1:
        expected = manifest["template_c_sha256" if condition == "C" else "template_sha256"]
        if before_landing != expected:
            problems.append("stage-1 workspace differs from the frozen template")
        if condition == "C" and read(workspace / "AGENTS.md") != read(PACKAGES / "C-AGENTS.md"):
            problems.append("AGENTS.md differs from the frozen onboarding text")
    if condition == "C" and contract_tampering(workspace, stage):
        problems.append("landed contracts differ from the frozen stage contracts")
    if problems:
        raise SystemExit("INVALID preparation: " + "; ".join(problems))
    return manifest


def write_prompts():
    sizes = {}
    for stage in STAGES:
        for condition in CONDITIONS:
            text = prompt_text(condition, stage)
            (PACKAGES / f"stage-{stage}" / f"prompt-{condition}.txt").write_text(text, encoding="utf-8")
            sizes[f"{condition}{stage}"] = {"bytes": len(text.encode("utf-8")), "lines": len(text.splitlines())}
    print(json.dumps(sizes, indent=2))
    return sizes


def load_json(path):
    return json.loads(read(path)) if Path(path).exists() else None


def stage_row(condition, stage):
    run_dir = run_dir_for(condition, stage)
    metrics = load_json(run_dir / "metrics.json")
    scoring = load_json(run_dir / "scoring.json")
    patch = load_json(run_dir / "patch-metrics.json")
    timing = load_json(run_dir / "timing.json")
    started = load_json(run_dir / "started.json")
    if not (metrics and scoring and patch and timing):
        return None
    usage = metrics.get("result_usage") or metrics["usage"]
    return {
        "condition": condition,
        "stage": stage,
        "behavior": scoring["scorer"]["behavior"],
        "behavior_summary": scoring["scorer"]["behavior_summary"],
        "checks_passed": scoring["scorer"]["checks_passed"],
        "checks_total": scoring["scorer"]["checks_total"],
        "architecture": scoring["scorer"]["architecture"],
        "initial_context_bytes": started["prompt_bytes"],
        "first_turn_context_tokens": metrics.get("first_turn_context_tokens"),
        "input_tokens": usage.get("input_tokens", 0),
        "cache_creation_input_tokens": usage.get("cache_creation_input_tokens", 0),
        "cache_read_input_tokens": usage.get("cache_read_input_tokens", 0),
        "total_input_tokens": usage.get("input_tokens", 0) + usage.get("cache_creation_input_tokens", 0) + usage.get("cache_read_input_tokens", 0),
        "output_tokens": usage.get("output_tokens", 0),
        "thinking_tokens": ((usage.get("output_tokens_details") or {}).get("thinking_tokens")),
        "cost_usd": metrics.get("total_cost_usd") or 0,
        "wall_seconds": timing["wall_seconds"],
        "turns": metrics.get("turns"),
        "tool_calls": metrics["tool_calls"],
        "edit_rounds": metrics["edit_rounds"],
        "verification_attempts": metrics["verification_attempts"],
        "files_changed": len(patch["files_changed"]),
        "application_files_changed": patch["application_files_changed"],
        "test_files_changed": patch["test_files_changed"],
        "lines_added": patch["lines_added"],
        "lines_removed": patch["lines_removed"],
        "test_lines_added": patch["test_lines_added"],
        "regressions_introduced": scoring["drift"]["regressions_introduced"],
        "regressions_remaining": scoring["drift"]["regressions_remaining"],
        "regressions_recovered": scoring["drift"]["regressions_recovered"],
        "old_checks_failing": scoring["drift"]["old_checks_failing"],
        "new_feature_failed": scoring["drift"]["new_feature_failed"],
        "handoff": metrics["handoff"],
        "docs_read": metrics["docs_read"],
        "docs_reread": metrics["docs_reread"],
        "test_files_read": metrics["test_files_read"],
        "files_read_total": metrics["files_read_total"],
        "bla_files_read": metrics["bla_files_read"],
        "blabla": metrics["blabla"],
        "runtime_discovery": metrics.get("runtime_discovery"),
        "disclosure": metrics.get("disclosure"),
        "runtime_semantics": scoring.get("runtime_semantics"),
        "completion_claim": scoring["completion_claim"],
        "contract_audit": scoring.get("contract_audit"),
        "blabla_canonical_finish": {key: scoring["blabla_canonical_finish_on_final_workspace"].get(key) for key in ("status", "verified", "unexercised", "violated", "property", "error")},
        "b_summary": (started or {}).get("b_summary"),
        "stop_reason": metrics.get("stop_reason"),
        "timed_out": timing.get("timed_out"),
        "final_text": metrics.get("final_text"),
    }


def report():
    rows = {condition: [row for row in (stage_row(condition, stage) for stage in STAGES) if row] for condition in CONDITIONS}
    cumulative = []
    for condition in CONDITIONS:
        stages = rows[condition]
        if not stages:
            continue
        last = stages[-1]
        cumulative.append({
            "condition": condition,
            "stages_run": len(stages),
            "final_behavior": f"{last['behavior']} {last['checks_passed']}/{last['checks_total']}",
            "final_architecture": last["architecture"],
            "total_initial_context_bytes": sum(row["initial_context_bytes"] for row in stages),
            "total_input_tokens": sum(row["total_input_tokens"] for row in stages),
            "total_output_tokens": sum(row["output_tokens"] for row in stages),
            "total_cost_usd": round(sum(row["cost_usd"] for row in stages), 3),
            "total_wall_seconds": round(sum(row["wall_seconds"] for row in stages)),
            "total_turns": sum(row["turns"] or 0 for row in stages),
            "total_tools": sum(row["tool_calls"] for row in stages),
            "total_edit_rounds": sum(row["edit_rounds"] for row in stages),
            "total_files_changed": sum(row["files_changed"] for row in stages),
            "total_lines_added": sum(row["lines_added"] for row in stages),
            "total_lines_removed": sum(row["lines_removed"] for row in stages),
            "regressions_introduced": sum(len(row["regressions_introduced"]) for row in stages),
            "regressions_remaining": last["old_checks_failing"],
            "docs_reread_total": sum(sum(row["docs_reread"].values()) for row in stages),
            "self_authored_test_lines": sum(row["test_lines_added"] for row in stages),
        })
    header = "| Condition | Final Behavior | Final Architecture | Total Initial Context | Total Input Tokens | Total Output Tokens | Total Cost | Total Time | Total Turns | Total Tools | Total Edit Rounds | Total Files Changed | Total Lines +/- | Regressions Introduced | Regressions Remaining |"
    lines = [header, "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for row in cumulative:
        lines.append(f"| {row['condition']} ({row['stages_run']} stages) | {row['final_behavior']} | {row['final_architecture']} | {row['total_initial_context_bytes']:,} B | {row['total_input_tokens']:,} | {row['total_output_tokens']:,} | ${row['total_cost_usd']:.3f} | {row['total_wall_seconds']} s | {row['total_turns']} | {row['total_tools']} | {row['total_edit_rounds']} | {row['total_files_changed']} | +{row['total_lines_added']} / -{row['total_lines_removed']} | {row['regressions_introduced']} | {row['regressions_remaining']} |")
    stage_lines = ["| Stage | Condition | Behavior | Architecture | Initial Context | Total Input Tokens | Output Tokens | Cost | Time | Turns | Tools | Edit Rounds | Files Changed | Lines +/- | Regressions Introduced | Old Checks Failing |", "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for stage in STAGES:
        for condition in CONDITIONS:
            row = next((row for row in rows[condition] if row["stage"] == stage), None)
            if row:
                stage_lines.append(f"| {stage} | {condition} | {row['behavior']} {row['checks_passed']}/{row['checks_total']} | {row['architecture']} | {row['initial_context_bytes']:,} B / {row['first_turn_context_tokens']:,} tok | {row['total_input_tokens']:,} | {row['output_tokens']:,} | ${row['cost_usd']:.3f} | {row['wall_seconds']:.0f} s | {row['turns']} | {row['tool_calls']} | {row['edit_rounds']} | {row['files_changed']} | +{row['lines_added']} / -{row['lines_removed']} | {len(row['regressions_introduced'])} | {row['old_checks_failing']} |")
    (HERE / "results-v042.json").write_text(json.dumps({"cumulative": cumulative, "stages": rows}, indent=2), encoding="utf-8")
    text = "\n".join(lines) + "\n\n" + "\n".join(stage_lines)
    (HERE / "results-v042.md").write_text(text + "\n", encoding="utf-8")
    print(text)
    return cumulative, rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["validate", "templates", "freeze", "write-prompts", "prepare", "run", "measure", "score", "report", "summary-metrics"])
    parser.add_argument("--condition", choices=CONDITIONS)
    parser.add_argument("--stage", type=int, choices=STAGES)
    parser.add_argument("--stages", default="1,2,3,4")
    parser.add_argument("--validation-dir", default="validation")
    arguments = parser.parse_args()
    if arguments.command == "validate":
        validate(PREP / arguments.validation_dir, [int(value) for value in arguments.stages.split(",")])
    elif arguments.command == "templates":
        build_template_c() if arguments.condition == "C" else build_templates()
    elif arguments.command == "freeze":
        freeze_c() if arguments.condition == "C" else freeze()
    elif arguments.command == "write-prompts":
        write_prompts()
    elif arguments.command == "summary-metrics":
        print(json.dumps({stage: summary_metrics(stage) for stage in STAGES}, indent=2))
    elif arguments.command == "report":
        report()
    else:
        if arguments.condition is None or arguments.stage is None:
            raise SystemExit("--condition and --stage are required")
        if arguments.command == "prepare":
            prepare(arguments.condition, arguments.stage)
        elif arguments.command == "run":
            run_subject(arguments.condition, arguments.stage)
        elif arguments.command == "measure":
            measure(arguments.condition, arguments.stage)
        elif arguments.command == "score":
            score_run(arguments.condition, arguments.stage)


if __name__ == "__main__":
    main()
