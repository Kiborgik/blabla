import os
from pathlib import Path
import json
import re
import shutil
import subprocess
import sys
import unittest
import uuid


ROOT = Path(__file__).resolve().parent.parent
BUILDER = ROOT / "evals/materials.py"
SKILL = ROOT / ".claude/skills/blabla/SKILL.md"


class TestDirectory:
    def __init__(self):
        base = ROOT / ".eval-materials-test"
        base.mkdir(exist_ok=True)
        self.path = base / uuid.uuid4().hex
        self.path.mkdir()
        self.name = str(self.path)

    def cleanup(self):
        shutil.rmtree(self.path, ignore_errors=True)


class EvalMaterialsTests(unittest.TestCase):
    def make_probe(self, root):
        binary = root / "bin"
        binary.mkdir()
        probe = binary / "probe.py"
        probe.write_text(
            "import sys\n"
            "from pathlib import Path\n"
            "if sys.argv[1:2] == ['init']:\n"
            "    Path('AGENTS.md').write_text('generated onboarding')\n"
            "    for path in ('.agents/skills/blabla/SKILL.md', '.claude/skills/blabla/SKILL.md'):\n"
            "        target = Path(path)\n"
            "        target.parent.mkdir(parents=True, exist_ok=True)\n"
            f"        target.write_bytes(Path({str(SKILL)!r}).read_bytes())\n"
            "present = all((Path.cwd() / path).is_file() for path in (\n"
            "    '.agents/skills/blabla/SKILL.md',\n"
            "    '.claude/skills/blabla/SKILL.md',\n"
            "))\n"
            "line = sys.argv[1] + (' with' if present else ' without') + (' reserved' if Path('.bashrc').exists() else ' unreserved')\n"
            "manifest = Path('project.bla')\n"
            "ignoring = manifest.is_file() and 'ignore \".eval-artifacts\"' in manifest.read_text()\n"
            "line += ' ignoring' if ignoring else ' tracking'\n"
            "with Path('.fake-blabla-observed').open('a') as log:\n"
            "    log.write(line + '\\n')\n",
            encoding="utf-8",
        )
        if os.name == "nt":
            executable = binary / "blabla.cmd"
            executable.write_text(f'@echo off\n"{sys.executable}" "%~dp0probe.py"\n', encoding="utf-8")
        else:
            executable = binary / "blabla"
            executable.write_text(f"#!{sys.executable}\nexec(open({str(probe)!r}).read())\n", encoding="utf-8")
            executable.chmod(0o755)
        return binary

    def build(self, case, arm="with", fake_blabla=False, host=None):
        temporary = TestDirectory()
        self.addCleanup(temporary.cleanup)
        destination = temporary.path / "workspace"
        environment = dict(os.environ, BLABLA_EVAL_ARM=arm)
        environment.pop("BLABLA_EVAL_HOST", None)
        if host:
            environment["BLABLA_EVAL_HOST"] = host
        if fake_blabla:
            probe = self.make_probe(Path(temporary.name))
            environment["PATH"] = str(probe) + os.pathsep + environment.get("PATH", "")
        result = subprocess.run(
            [sys.executable, str(BUILDER), case, str(destination)],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return temporary, destination

    def assert_skill_arm(self, destination, arm):
        agents = destination / ".agents/skills/blabla/SKILL.md"
        claude = destination / ".claude/skills/blabla/SKILL.md"
        if arm == "with":
            self.assertEqual(agents.read_bytes(), SKILL.read_bytes())
            self.assertEqual(claude.read_bytes(), SKILL.read_bytes())
        else:
            self.assertFalse(agents.exists())
            self.assertFalse(claude.exists())
            self.assertFalse(list(destination.rglob("*.bla")))
            for name in (".blabla", ".agents", ".claude", "AGENTS.md", "contracts"):
                self.assertFalse((destination / name).exists(), name)

    def test_all_cases_share_builder_and_blabla_arms(self):
        broken_models = []
        widget_contracts = []
        cases = (
            "carries-an-assigned-task",
            "repairs-a-red-project",
            "ignores-a-project-with-no-contracts",
            "repairs-behavioral-drift",
        )
        if os.name == "nt":
            cases = cases[1:]
        for case in cases:
            for arm in ("with", "without"):
                temporary, destination = self.build(case, arm, case == "carries-an-assigned-task")
                self.assertFalse((destination / "contracts").exists())
                self.addCleanup(temporary.cleanup)
                self.assert_skill_arm(destination, arm)
                if case in {"carries-an-assigned-task", "repairs-a-red-project"}:
                    broken_models.append((case, (destination / "widget/model.py").read_bytes()))
                if case in {"carries-an-assigned-task", "repairs-a-red-project"} and arm == "with":
                    widget_contracts.append((destination / "widget.bla").read_bytes())
                if case == "carries-an-assigned-task" and arm == "with":
                    self.assertTrue((destination / "AGENTS.md").is_file())
        self.assertEqual(len({source for _, source in broken_models}), 1)
        if len(widget_contracts) > 1:
            self.assertEqual(len(set(widget_contracts)), 1)
        self.assertEqual(
            (ROOT / "adapters/python/blabla_adapter.py").read_bytes(),
            (self.build("repairs-behavioral-drift", "with")[1] / "adapters/python/blabla_adapter.py").read_bytes(),
        )

    def test_assignment_applies_skill_arm_before_task_open(self):
        if os.name == "nt":
            self.skipTest("the shell probe is exercised in the Linux staging host")
        for arm in ("with", "without"):
            temporary, destination = self.build("carries-an-assigned-task", arm, True)
            self.addCleanup(temporary.cleanup)
            opened = [call for call in self.probe_calls(destination) if call[0] == "task"]
            self.assertEqual([call[1] for call in opened], ["with"] if arm == "with" else [])

    def probe_calls(self, destination):
        return [line.split() for line in (destination / ".fake-blabla-observed").read_text().splitlines()]

    def test_claude_host_reserves_its_sandbox_paths_and_ignores_the_evaluators_before_the_task_opens(self):
        if os.name == "nt":
            self.skipTest("the shell probe is exercised in the Linux staging host")
        _, reserved = self.build("carries-an-assigned-task", "with", True, host="claude")
        self.assertEqual([call[2:] for call in self.probe_calls(reserved) if call[0] == "task"], [["reserved", "ignoring"]])
        self.assertFalse((reserved / ".eval-artifacts").exists())
        self.assertTrue((reserved / ".claude/agents").is_dir())
        for name in (".mcp.json", ".claude/settings.json", ".claude/scheduled_tasks.json"):
            json.loads((reserved / name).read_text(encoding="utf-8"))
        for arm, host in (("with", None), ("without", "claude")):
            _, plain = self.build("carries-an-assigned-task", arm, True, host=host)
            self.assertNotIn("ignoring", [word for call in self.probe_calls(plain) for word in call])
            self.assertFalse((plain / ".bashrc").exists(), (arm, host))
            self.assertFalse((plain / ".claude/agents").exists(), (arm, host))

    def test_the_grader_knows_every_path_the_builder_reserves(self):
        import importlib.util
        from grade_agent_eval import HARNESS_PATHS
        spec = importlib.util.spec_from_file_location("eval_materials_builder", BUILDER)
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        reserved = set(builder.CLAUDE_SANDBOX_DIRECTORIES) | set(builder.CLAUDE_SANDBOX_FILES) | {builder.CLAUDE_EVALUATOR_ARTIFACTS}
        self.assertEqual(HARNESS_PATHS, reserved)

    def test_the_arm_without_blabla_keeps_a_rules_doc_naming_every_contract_rule(self):
        if os.name == "nt":
            self.skipTest("the shell probe is exercised in the Linux staging host")
        label = re.compile(r'^\s*(?:require|forbid|expect|always|never|ruling)\s+"([^"]+)"', re.MULTILINE)
        for case in sorted(path.parent for path in (ROOT / "evals").glob("*/rubric.json")):
            if not (case / "prompt-without.md").is_file():
                continue
            fixture = json.loads((case / "fixture.json").read_text(encoding="utf-8"))
            removed = fixture.get("remove", [])
            contracts = {}
            for layer in fixture["materials"]:
                source = ROOT / "evals/materials" / layer
                for contract in source.rglob("*.bla"):
                    relative = contract.relative_to(source).as_posix()
                    if not any(relative == prefix or relative.startswith(prefix + "/") for prefix in removed):
                        contracts[relative] = contract
            rules = {name for contract in contracts.values() for name in label.findall(contract.read_text(encoding="utf-8"))}
            if not rules:
                continue
            _, without = self.build(case.name, "without", True)
            doc = (without / "README.md").read_text(encoding="utf-8")
            for name in sorted(rules):
                self.assertIn(f"`{name}`", doc, f"{case.name}: {name}")

    def test_a_case_that_exists_only_with_blabla_refuses_the_arm_without_it(self):
        temporary = TestDirectory()
        self.addCleanup(temporary.cleanup)
        result = subprocess.run(
            [sys.executable, str(BUILDER), "diagnoses-yellow-verification", str(temporary.path / "workspace")],
            cwd=ROOT, env=dict(os.environ, BLABLA_EVAL_ARM="without"), capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no arm without BlaBla", result.stderr)
        for case in sorted(path.parent for path in (ROOT / "evals").glob("*/rubric.json")):
            if (case / "prompt-without.md").is_file():
                self.assertNotIn("blabla", (case / "prompt-without.md").read_text(encoding="utf-8").lower(), case.name)

    def test_both_prompts_are_the_brief_for_the_fixture_task(self):
        briefs = {role: (ROOT / f".claude/agents/blabla-{role}.md").read_text(encoding="utf-8").split("---", 2)[2].strip()
                  for role in ("worker", "reviewer")}
        for case in sorted(path.parent for path in (ROOT / "evals").glob("*/rubric.json")):
            fixture = json.loads((case / "fixture.json").read_text(encoding="utf-8"))
            opens = [step["run"] for step in fixture.get("after_arm", []) if step.get("run", [])[1:3] == ["task", "open"]]
            if not opens:
                continue
            argv = opens[-1]
            name = argv[3]
            role = argv[argv.index("--role") + 1]
            with_prompt = (case / "prompt.md").read_text(encoding="utf-8")
            self.assertIn(briefs[role], with_prompt, case.name)
            self.assertIn(f"assigned the task `{name}`", with_prompt, case.name)
            without = case / "prompt-without.md"
            if not without.is_file():
                continue
            text = without.read_text(encoding="utf-8")
            self.assertIn(f"Task `{name}`", text, case.name)
            for flag in ("--scope", "--deliverable"):
                for index, word in enumerate(argv):
                    if word == flag:
                        self.assertIn(f"`{argv[index + 1]}`", text, f"{case.name}: {argv[index + 1]}")

    def test_bare_case_contains_no_project_or_contract(self):
        temporary, destination = self.build("ignores-a-project-with-no-contracts", "with")
        self.addCleanup(temporary.cleanup)
        self.assertFalse((destination / "project.bla").exists())
        self.assertNotIn("from widget.store", (destination / "widget/model.py").read_text())
        self.assertFalse(list(destination.rglob("*.bla")))
        self.assertTrue((destination / "widget/model.py").is_file())
        self.assertTrue((destination / "widget/store.py").is_file())

    def test_behavior_material_has_real_profile_and_broken_persistence(self):
        temporary, destination = self.build("repairs-behavioral-drift", "with")
        self.addCleanup(temporary.cleanup)
        project = (destination / "project.bla").read_text()
        store = (destination / "widget/store.py").read_text()
        app = (destination / "app.py").read_text()
        self.assertTrue((destination / "structure.bla").is_file())
        self.assertTrue((destination / "behavior.bla").is_file())
        self.assertIn('command ["python3", "app.py"]', project)
        self.assertIn("cases 4", project)
        self.assertIn("steps 32", project)
        self.assertIn("def save(self, widgets):", store)
        self.assertIn("return None", store)
        self.assertIn("from blabla_adapter import Adapter", app)
        self.assertIn('adapter.action("add", 1', app)
        self.assertNotIn('adapter.action("restart"', app)

    def test_the_counterexample_fault_passes_the_declared_check_while_the_behavior_contract_is_red(self):
        if os.name == "nt":
            self.skipTest("the behavior contract launches python3, which the Linux staging host provides")
        for arm in ("with", "without"):
            _, destination = self.build("repairs-red-behavior-from-counterexample", arm)
            check = subprocess.run([sys.executable, "checks/restart.py"], cwd=destination, capture_output=True, text=True)
            self.assertEqual(check.returncode, 0, check.stdout + check.stderr)

    def test_fixture_wrappers_delegate_to_shared_builder(self):
        cases = sorted(path.parent for path in (ROOT / "evals").glob("*/rubric.json"))
        self.assertGreaterEqual(len(cases), 4)
        for case in cases:
            script = (case / "fixture.sh").read_text()
            self.assertIn("materials.py", script)
            self.assertIn(case.name, script)
            self.assertNotIn("cat >", script)
            config = json.loads((case / "fixture.json").read_text(encoding="utf-8"))
            prompt = (case / "prompt.md").read_text(encoding="utf-8")
            model = config.get("model", "qwen3.5:4b")
            if "running as model" in prompt:
                self.assertIn(f"`{model}`", prompt)
            for name in config["materials"]:
                self.assertTrue((ROOT / "evals/materials" / name).is_dir(), name)
            for step in config.get("before_arm", []) + config.get("after_arm", []):
                if "copy" in step:
                    self.assertTrue((ROOT / "evals/materials" / step["copy"]).is_dir(), step["copy"])

    def test_every_rubric_criterion_refers_to_a_declared_observation(self):
        for rubric_path in sorted((ROOT / "evals").glob("*/rubric.json")):
            rubric = json.loads(rubric_path.read_text(encoding="utf-8"))
            config = json.loads((rubric_path.parent / "fixture.json").read_text(encoding="utf-8"))
            declared = set(config.get("observations", []))
            for criterion in rubric["criteria"]:
                if criterion["kind"] == "observation":
                    self.assertIn(criterion["name"], declared, f"{rubric_path.parent.name}: {criterion['id']}")

    def test_a_fixture_step_that_exits_unexpectedly_stops_the_build(self):
        temporary = TestDirectory()
        self.addCleanup(temporary.cleanup)
        case = temporary.path / "evals" / "probe"
        case.mkdir(parents=True)
        shutil.copy2(BUILDER, temporary.path / "evals" / "materials.py")
        shutil.copytree(ROOT / "evals/materials/shared", temporary.path / "evals/materials/shared")
        (temporary.path / ".claude/skills/blabla").mkdir(parents=True)
        shutil.copy2(SKILL, temporary.path / ".claude/skills/blabla/SKILL.md")
        (case / "fixture.json").write_text(
            json.dumps({"materials": ["shared"],
                        "after_arm": [{"run": [sys.executable, "-c", "raise SystemExit(3)"], "exit": 0}]}),
            encoding="utf-8",
        )
        result = subprocess.run(
            [sys.executable, str(temporary.path / "evals" / "materials.py"), "probe", str(temporary.path / "workspace")],
            cwd=ROOT, env=dict(os.environ, BLABLA_EVAL_ARM="with"), capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exited 3", result.stderr)

    def test_optional_capture_is_outside_workspace_and_records_before_state(self):
        temporary = TestDirectory()
        self.addCleanup(temporary.cleanup)
        destination = temporary.path / "workspace"
        capture_root = temporary.path / "captures"
        environment = dict(os.environ, BLABLA_EVAL_CAPTURE_ROOT=str(capture_root))
        result = subprocess.run(
            [sys.executable, str(BUILDER), "repairs-a-red-project", str(destination)],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        capture = capture_root / destination.name
        self.assertEqual(json.loads((capture / "metadata.json").read_text())["case"], "repairs-a-red-project")
        self.assertTrue((capture / "before-workspace/project.bla").is_file())
        self.assertIn("widget/model.py", json.loads((capture / "before.json").read_text()))

    def test_wrong_executable_identity_stops_before_fixture_creation(self):
        temporary = TestDirectory()
        self.addCleanup(temporary.cleanup)
        destination = temporary.path / "workspace"
        result = subprocess.run(
            [sys.executable, str(BUILDER), "repairs-a-red-project", str(destination)],
            cwd=ROOT, env=dict(os.environ, BLABLA_EVAL_EXPECTED_SHA256="wrong"),
            capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("freshly built BlaBla", result.stderr)
        self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
