import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent
MATERIALS = Path(__file__).resolve().parent / "materials"
SKILL = ROOT / ".claude" / "skills" / "blabla" / "SKILL.md"
CLAUDE_SANDBOX_DIRECTORIES = (
    ".claude/agents", ".claude/commands", ".claude/hooks", ".claude/output-styles", ".claude/routines",
    ".claude/workflows", ".idea", ".vscode",
)
CLAUDE_EVALUATOR_ARTIFACTS = ".eval-artifacts"
CLAUDE_SANDBOX_FILES = {
    ".bash_profile": "", ".bashrc": "", ".profile": "", ".zprofile": "", ".zshrc": "", ".ripgreprc": "",
    ".gitconfig": "", ".gitmodules": "", ".mcp.json": '{"mcpServers": {}}', ".claude/launch.json": "{}",
    ".claude/loop.md": "", ".claude/scheduled_tasks.json": "{}", ".claude/settings.json": "{}",
    ".claude/settings.local.json": "{}",
}


def plain_name(value):
    return isinstance(value, str) and value != "" and Path(value).name == value and Path(value).parent == Path(".")


def inside_workspace(value):
    if not isinstance(value, str) or value == "":
        return False
    path = Path(value)
    return not path.is_absolute() and all(part not in {"..", "."} for part in path.parts)


def valid_step(step):
    if isinstance(step, dict) and set(step) <= {"run", "exit", "copy"}:
        if "copy" in step:
            return set(step) == {"copy"} and plain_name(step["copy"])
        return valid_argv(step.get("run")) and isinstance(step.get("exit", 0), int)
    return False


def valid_argv(argv):
    return isinstance(argv, list) and bool(argv) and all(isinstance(word, str) for word in argv)


def read_case(case_name):
    if not plain_name(case_name):
        raise ValueError(f"invalid case name: {case_name}")
    path = Path(__file__).resolve().parent / case_name / "fixture.json"
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except OSError as failure:
        raise ValueError(f"cannot read {path}: {failure}") from failure
    except json.JSONDecodeError as failure:
        raise ValueError(f"cannot parse {path}: {failure}") from failure
    materials = config.get("materials")
    if not isinstance(materials, list) or not materials or not all(plain_name(name) for name in materials):
        raise ValueError(f"{path} must list the material layers it copies")
    for key in ("before_arm", "after_arm"):
        steps = config.get(key, [])
        if not isinstance(steps, list) or not all(valid_step(step) for step in steps):
            raise ValueError(f"{path}: {key} must list run or copy steps")
    observations = config.get("observations", [])
    if not isinstance(observations, list) or not all(isinstance(name, str) and name for name in observations):
        raise ValueError(f"{path}: observations must list check names")
    if not isinstance(config.get("model", "qwen3.5:4b"), str):
        raise ValueError(f"{path}: model must be a string")
    return config


def copy_tree(source, destination):
    if not source.is_dir():
        raise ValueError(f"missing material directory: {source}")
    for path in sorted(source.rglob("*")):
        relative = path.relative_to(source)
        target = destination / relative
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)


def copy_file(source, destination):
    if not source.is_file():
        raise ValueError(f"missing material file: {source}")
    if source.resolve() == destination.resolve():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


BLABLA_SURFACES = (".blabla", ".agents", ".claude", "AGENTS.md", "CLAUDE.md", "contracts")


def has_control(case_dir):
    return (case_dir / "prompt-without.md").is_file()


def remove_blabla(destination):
    for path in sorted(destination.rglob("*.bla")):
        path.unlink()
    for name in BLABLA_SURFACES:
        target = destination / name
        if target.is_dir():
            shutil.rmtree(target)
        elif target.is_file():
            target.unlink()


def apply_arm(destination, arm, source=SKILL):
    if arm not in {"with", "without"}:
        raise ValueError("BLABLA_EVAL_ARM must be with or without")
    if arm == "without":
        remove_blabla(destination)
        return
    for relative in (Path(".agents/skills/blabla/SKILL.md"), Path(".claude/skills/blabla/SKILL.md")):
        copy_file(source, destination / relative)
    onboarding = destination / "AGENTS.md"
    if onboarding.is_file() and not (destination / "CLAUDE.md").exists():
        copy_file(onboarding, destination / "CLAUDE.md")


def reserve_sandbox_paths(destination):
    for name in CLAUDE_SANDBOX_DIRECTORIES:
        (destination / name).mkdir(parents=True, exist_ok=True)
    for name, content in CLAUDE_SANDBOX_FILES.items():
        path = destination / name
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")


def ignore_evaluator_artifacts(destination):
    with (destination / "project.bla").open("a", encoding="utf-8") as manifest:
        manifest.write(f'\nignore "{CLAUDE_EVALUATOR_ARTIFACTS}"\n')


def run_steps(steps, destination):
    for step in steps:
        if "copy" in step:
            copy_tree(MATERIALS / step["copy"], destination)
            continue
        completed = subprocess.run(step["run"], cwd=destination, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        if completed.returncode != step.get("exit", 0):
            raise ValueError(
                f"fixture step {' '.join(step['run'])} exited {completed.returncode}, "
                f"expected {step.get('exit', 0)}: {completed.stderr.strip()}"
            )


def snapshot(destination):
    return {
        path.relative_to(destination).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(destination.rglob("*"))
        if path.is_file()
    }


def capture_fixture(case_name, destination, arm, binary_digest):
    raw_root = os.environ.get("BLABLA_EVAL_CAPTURE_ROOT")
    if not raw_root:
        return
    capture_root = Path(raw_root).resolve()
    if capture_root == destination or capture_root in destination.parents or destination in capture_root.parents:
        raise ValueError("BLABLA_EVAL_CAPTURE_ROOT must not overlap the fixture workspace")
    sandbox_id = next(
        (part for part in reversed(destination.parts) if part.startswith("claude-eval-")),
        destination.name,
    )
    capture = capture_root / sandbox_id
    if capture.exists():
        raise ValueError(f"capture destination already exists: {capture}")
    capture.mkdir(parents=True)
    (capture / "before.json").write_text(
        json.dumps(snapshot(destination), indent=2) + "\n",
        encoding="utf-8",
    )
    shutil.copytree(destination, capture / "before-workspace")
    (capture / "metadata.json").write_text(
        json.dumps(
            {
                "case": case_name,
                "workspace": str(destination),
                "sandbox_id": sandbox_id,
                "arm": arm,
                "blabla_sha256": binary_digest,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def build(case_name, destination):
    config = read_case(case_name)
    expected = os.environ.get("BLABLA_EVAL_EXPECTED_SHA256")
    executable = shutil.which("blabla")
    binary_digest = hashlib.sha256(Path(executable).read_bytes()).hexdigest() if executable else None
    if expected and binary_digest != expected:
        raise ValueError("fixture PATH does not resolve the freshly built BlaBla executable")
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise ValueError(f"fixture destination is not empty: {destination}")

    run_steps(config.get("before_arm", []), destination)
    for name in config["materials"]:
        copy_tree(MATERIALS / name, destination)
    if config.get("break_model", False):
        model = destination / "widget/model.py"
        model.write_text("from widget.store import FILE_NAME\n\n" + model.read_text(encoding="utf-8"), encoding="utf-8")
    for name in config.get("remove", []):
        if not inside_workspace(name):
            raise ValueError(f"remove names a path inside the workspace, not {name}")
        target = destination / name
        if target.is_dir():
            shutil.rmtree(target)
        elif target.is_file():
            target.unlink()
    if config.get("adapter", False):
        copy_file(ROOT / "adapters/python/blabla_adapter.py", destination / "adapters/python/blabla_adapter.py")
    arm = os.environ.get("BLABLA_EVAL_ARM", "with")
    if arm == "without" and not has_control(Path(__file__).resolve().parent / case_name):
        raise ValueError(f"{case_name} has no prompt-without.md, so it has no arm without BlaBla")
    apply_arm(destination, arm)
    if arm == "with":
        steps = config.get("after_arm", [])
        if os.environ.get("BLABLA_EVAL_HOST") == "claude":
            reserve_sandbox_paths(destination)
            ignore_evaluator_artifacts(destination)
        run_steps(steps, destination)
    capture_fixture(case_name, destination, arm, binary_digest)
    return config


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("case")
    parser.add_argument("destination", type=Path)
    arguments = parser.parse_args(argv)
    try:
        build(arguments.case, arguments.destination)
    except (OSError, ValueError, subprocess.CalledProcessError) as failure:
        print(f"materials: {failure}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
