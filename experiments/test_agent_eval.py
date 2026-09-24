import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import agent_eval_common as common
import agent_eval_traces
import collect_claude_eval
import claude_eval
from generate_eval_graders import generate


class EvaluationEvidenceTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'linux', 'Native scaffold uses Bash')
    def test_native_scaffold_restores_fixture_environment_after_host_scrubbing(self):
        with tempfile.TemporaryDirectory(prefix='native scaffold ') as directory:
            root = Path(directory)
            case = root / 'evals/probe'
            case.mkdir(parents=True)
            (case / 'case.yaml').write_text('context:\n  scaffold_script: fixture.sh\n')
            (case / 'fixture.sh').write_text('python3 -c \'import json,os; print(json.dumps({k:os.environ[k] for k in ["PATH","BLABLA_EVAL_ARM","BLABLA_EVAL_HOST","BLABLA_EVAL_CAPTURE_ROOT"]}))\'\n')
            (case / 'prompt-without.md').write_text('brief without BlaBla\n')
            env = {'PATH': '/usr/bin:/bin'}
            claude_eval.native_scaffold(root, 'probe', env, 'without')
            self.assertEqual((case / 'prompt.md').read_bytes(), (case / 'prompt-without.md').read_bytes())
            result = common.subprocess.run(['bash', str(case / 'fixture-native.sh')],
                env={'PATH': '/usr/bin:/bin', 'HOME': str(root)}, capture_output=True, text=True, check=True)
            actual = json.loads(result.stdout)
            self.assertEqual(actual['PATH'], env['PATH'])
            self.assertEqual(actual['BLABLA_EVAL_ARM'], 'without')
            self.assertEqual(actual['BLABLA_EVAL_HOST'], 'claude')
            self.assertEqual(actual['BLABLA_EVAL_CAPTURE_ROOT'], str(root / 'captures'))
            self.assertIn('scaffold_script: fixture-native.sh', (case / 'case.yaml').read_text())
            for startup in ('.bashrc', '.profile'):
                self.assertTrue(os.access(root / startup, os.R_OK), startup)

    def test_export_omits_host_cache_but_preserves_same_named_subject_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            campaign = root / 'campaign'
            for name in ('with/run-1/codex-home/.tmp/cache', 'with/run-1/workspace/codex-home/data',
                         'with/run-1/summary.json', 'without/run-1/trace.jsonl',
                         'native/with/run-1/evals/case/prompt.md', 'with/run-1/workspace/native/kept'):
                path = campaign / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(name)
            output = root / 'output'
            common.export_campaign(campaign, output)
            self.assertFalse((output / 'native').exists())
            self.assertTrue((output / 'with/run-1/workspace/native/kept').exists())
            self.assertFalse((output / 'with/run-1/codex-home').exists())
            self.assertTrue((output / 'with/run-1/workspace/codex-home/data').exists())
            self.assertTrue((output / 'with/run-1/summary.json').exists())
            self.assertTrue((output / 'without/run-1/trace.jsonl').exists())

    def test_claude_collection_uses_only_reported_sandboxes(self):
        report = {'cases': [{'arms': {'with': [
            {'tracePath': '/tmp/claude-eval-valid/out/trace.jsonl'},
            {'tracePath': '/tmp/unrelated/out/trace.jsonl'},
            {'tracePath': '/other/claude-eval-invalid/out/trace.jsonl'},
            {'tracePath': None},
        ]}}]}
        self.assertEqual(collect_claude_eval.sandbox_paths(report), [Path('/tmp/claude-eval-valid')])

    def test_subject_path_holds_only_the_tool_directory_and_blabla_with_it(self):
        env = {'PATH': '/cache/bin-x:/usr/bin', 'BLABLA_EVAL_EXPECTED_SHA256': 'abc',
               'BLABLA_EVAL_SUBJECT_TOOLS': '/cache/subject-bin', 'HOME': '/home/x'}
        with_arm = common.subject_environment(env, 'with')
        without_arm = common.subject_environment(env, 'without')
        self.assertEqual(with_arm['PATH'], f'/cache/bin-x:/cache/subject-bin:{common.SYSTEM_PATH}')
        self.assertEqual(without_arm['PATH'], f'/cache/subject-bin:{common.SYSTEM_PATH}')
        self.assertEqual(with_arm['BLABLA_EVAL_EXPECTED_SHA256'], 'abc')
        self.assertNotIn('BLABLA_EVAL_EXPECTED_SHA256', without_arm)
        self.assertNotIn('BLABLA_EVAL_SUBJECT_TOOLS', with_arm)
        self.assertEqual(with_arm['HOME'], '/home/x')
        for banned in ('git', 'find', 'env', 'curl', 'node', 'sha256sum', 'stat'):
            self.assertIn(banned, common.SUBJECT_STUBS)
        with tempfile.TemporaryDirectory() as directory:
            stubs = common.subject_tools(directory)
            self.assertEqual(sorted(path.name for path in stubs.iterdir()), sorted(common.SUBJECT_STUBS))
            self.assertIn('exit 127', (stubs / 'git').read_text())

    def test_prompt_excludes_native_settings(self):
        prompt, timeout = common.read_prompt('---\nmax_turns: 120\ntimeout_seconds: 1800\n---\n\nFix it.\n')
        self.assertEqual(prompt, 'Fix it.')
        self.assertEqual(timeout, 1800)

    def test_coverage_names_only_criteria_the_rubrics_define(self):
        defined = {(rubric.parent.name, criterion['id']) for rubric in (common.ROOT / 'evals').glob('*/rubric.json')
                   for criterion in json.loads(rubric.read_text(encoding='utf-8'))['criteria']}
        coverage = json.loads((common.ROOT / 'evals/coverage.json').read_text(encoding='utf-8'))
        for axis in ('systems', 'capabilities', 'behaviors'):
            for item in coverage.get(axis, []):
                for check in item.get('checks', []):
                    with self.subTest(item=item['id'], check=check):
                        self.assertIn((check['case'], check['criterion']), defined)

    def test_native_graders_are_projections_of_the_current_rubrics(self):
        for rubric in (common.ROOT / 'evals').glob('*/rubric.json'):
            with self.subTest(case=rubric.parent.name):
                self.assertTrue(generate(rubric.parent, check=True))

    def test_both_hosts_receive_identical_shared_bundles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = common.stage_materials(root / 'claude')
            second = common.stage_materials(root / 'codex')
            self.assertEqual(first, second)
            self.assertIn('adapters/python/blabla_adapter.py', first)
            self.assertIn('evals/materials.py', first)
            self.assertIn('evals/materials/behavior-rules/README.md', first)
            for document in ('README.md', 'findings.md', 'coverage.json'):
                self.assertNotIn(f'evals/{document}', first)

    def test_model_set_retrieval_works_for_known_sets(self):
        model_set = common.get_model_set('haiku')
        self.assertIn('qwen3.5:4b', model_set)
        self.assertIn('qwen3.5:9b', model_set)
        self.assertEqual(model_set['qwen3.5:4b']['api_id'], 'claude-haiku-4-5-20251001')
        self.assertEqual(model_set['qwen3.5:4b']['local_id'], 'haiku-4.5')
        self.assertEqual(model_set['qwen3.5:9b']['api_id'], 'claude-haiku-4-5-20251001')
        self.assertEqual(model_set['qwen3.5:9b']['local_id'], 'haiku-4.5')

    def test_model_set_retrieval_rejects_unknown_sets(self):
        with self.assertRaises(ValueError) as context:
            common.get_model_set('unknown-set')
        self.assertIn('Unknown model set', str(context.exception))

    def test_rewrite_model_names_in_fixture_json(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_file = root / 'fixture.json'
            fixture_file.write_text('{"model": "qwen3.5:4b", "other": "qwen3.5:9b"}')
            model_set = common.get_model_set('haiku')
            common.rewrite_model_names_in_file(fixture_file, model_set)
            content = fixture_file.read_text()
            self.assertNotIn('qwen3.5:4b', content)
            self.assertNotIn('qwen3.5:9b', content)
            self.assertIn('haiku-4.5', content)

    def test_rewrite_model_names_in_prompt_md(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prompt_file = root / 'prompt.md'
            prompt_file.write_text('You are running as model `qwen3.5:4b`. Please proceed.')
            model_set = common.get_model_set('haiku')
            common.rewrite_model_names_in_file(prompt_file, model_set)
            content = prompt_file.read_text()
            self.assertNotIn('qwen3.5:4b', content)
            self.assertIn('haiku-4.5', content)

    def test_rewrite_model_names_in_rubric_json(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rubric_file = root / 'rubric.json'
            rubric_file.write_text('{"criteria": [{"equals": "qwen3.5:4b"}]}')
            model_set = common.get_model_set('haiku')
            common.rewrite_model_names_in_file(rubric_file, model_set)
            content = rubric_file.read_text()
            self.assertNotIn('qwen3.5:4b', content)
            self.assertIn('haiku-4.5', content)

    def test_deduplicate_process_bla_models(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            process_file = root / 'process.bla'
            original = '''role "worker" {
    model ["qwen3.5:9b", "qwen3.5:4b", "haiku-4.5", "qwen3.5:9b", "qwen3.5:4b"]
}'''
            process_file.write_text(original)
            common.deduplicate_process_bla_models(process_file)
            content = process_file.read_text()
            self.assertIn('model ["qwen3.5:9b", "qwen3.5:4b", "haiku-4.5"]', content)
            self.assertEqual(content.count('"qwen3.5:9b"'), 1)
            self.assertEqual(content.count('"qwen3.5:4b"'), 1)
            self.assertEqual(content.count('"haiku-4.5"'), 1)

    def test_rewrite_staged_materials_rewrites_all_file_types(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            materials = root / 'materials'
            evals = materials / 'evals'

            case_dir = evals / 'test-case'
            case_dir.mkdir(parents=True)
            (case_dir / 'fixture.json').write_text('{"model": "qwen3.5:4b"}')
            (case_dir / 'prompt.md').write_text('Model: qwen3.5:4b')
            (case_dir / 'prompt-without.md').write_text('Model: qwen3.5:9b')
            (case_dir / 'rubric.json').write_text('{"model": "qwen3.5:4b"}')
            (case_dir / 'case.yaml').write_text('model: qwen3.5:4b')

            graders = case_dir / 'graders'
            graders.mkdir()
            (graders / 'test-grader.md').write_text('Check qwen3.5:4b')

            materials_sub = evals / 'materials'
            materials_sub.mkdir()
            (materials_sub / 'process.bla').write_text('role "worker" { model ["qwen3.5:9b", "qwen3.5:4b"] }')

            common.rewrite_staged_materials(materials, 'haiku')

            self.assertIn('haiku-4.5', (case_dir / 'fixture.json').read_text())
            self.assertIn('haiku-4.5', (case_dir / 'prompt.md').read_text())
            self.assertIn('haiku-4.5', (case_dir / 'prompt-without.md').read_text())
            self.assertIn('haiku-4.5', (case_dir / 'rubric.json').read_text())
            self.assertIn('haiku-4.5', (case_dir / 'case.yaml').read_text())
            self.assertIn('haiku-4.5', (graders / 'test-grader.md').read_text())

            process_content = (materials_sub / 'process.bla').read_text()
            self.assertIn('haiku-4.5', process_content)
            role_models = process_content.split('model [', 1)[1].split(']', 1)[0]
            self.assertEqual(role_models.count('"haiku-4.5"'), 1)

    def test_staged_process_memory_declares_the_host_model_id_once(self):
        with tempfile.TemporaryDirectory() as directory:
            materials = Path(directory) / 'materials'
            process = materials / 'evals' / 'materials' / 'process.bla'
            process.parent.mkdir(parents=True)
            process.write_text('role "worker" {\n    model ["qwen3.5:9b", "qwen3.5:4b"]\n}\n')
            common.rewrite_staged_materials(materials, 'haiku')
            common.rewrite_staged_materials(materials, 'haiku')
            content = process.read_text()
            self.assertEqual(content.count('alias "claude-haiku-4-5-20251001" {\n    model "haiku-4.5"\n}'), 1)

    def test_the_accepted_model_criterion_takes_the_host_id_its_alias_names(self):
        import grade_agent_eval
        with tempfile.TemporaryDirectory() as directory:
            rubric = Path(directory) / 'rubric.json'
            rubric.write_text(json.dumps({'criteria': [{'id': 'accepts-correct-model', 'kind': 'task_field',
                                                        'required': True, 'field': 'accepted.model', 'equals': 'haiku-4.5'}]}))
            common.accept_host_model_ids(rubric, common.get_model_set('haiku'))
            criterion = json.loads(rubric.read_text())['criteria'][0]
            workspace = Path(directory) / 'workspace'
            record = workspace / '.blabla/tasks/fix-red-checks.json'
            record.parent.mkdir(parents=True)
            for model, status in (('claude-haiku-4-5-20251001', 'pass'), ('haiku-4.5', 'pass'), ('claude-opus-5-5', 'fail')):
                record.write_text(json.dumps({'accepted': {'model': model}}))
                result = grade_agent_eval.evaluate(criterion, {'actions': []}, workspace, None, None, {})
                self.assertEqual(result['status'], status, model)

    def test_model_set_rejected_when_backend_is_ollama(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                ['python3', str(common.ROOT / 'experiments/claude_eval.py'),
                 '--backend', 'ollama', '--model-set', 'haiku',
                 '--case', 'carries-an-assigned-task', '--runs', '1', '--prepare-only'],
                cwd=directory, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn('--model-set can only be used with --backend anthropic', result.stderr)

    @unittest.skipUnless(sys.platform == 'linux', 'The evaluation runner executes Linux tools')
    def test_post_challenge_cannot_mutate_the_subjects_task_record(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = root / 'run'
            workspace = run / 'workspace'
            task = workspace / '.blabla/tasks/work.json'
            task.parent.mkdir(parents=True)
            task.write_text('{"state":"accepted"}')
            (workspace / 'project.bla').write_text('project Test')
            case = root / 'case'
            case.mkdir()
            (case / 'fixture.json').write_text('{"materials":["shared"],"observations":["challenge:work"]}')
            binary = root / 'bin/blabla'
            binary.parent.mkdir()
            binary.write_text('#!/usr/bin/env python3\nimport pathlib,sys\nif "challenge" in sys.argv: pathlib.Path(".blabla/tasks/work.json").write_text("changed by oracle")\n')
            binary.chmod(0o755)
            before = common.snapshot(workspace)
            observations = common.observe_run(run, case, dict(os.environ, PATH=str(binary.parent) + ':' + os.environ['PATH']))
            self.assertEqual(before, common.snapshot(workspace))
            self.assertEqual(observations['challenge:work']['exit'], 0)

    def test_and_chain_of_two_blabla_calls_is_ordered(self):
        facts = agent_eval_traces.command_facts('blabla task show x && blabla task accept x')
        self.assertTrue(facts['compound'])
        self.assertTrue(facts['ordering_determined'])
        self.assertEqual(facts['invocations'], [['task', 'show', 'x'], ['task', 'accept', 'x']])

    def test_semicolon_chain_of_two_blabla_calls_is_ordered(self):
        facts = agent_eval_traces.command_facts('blabla a; blabla b')
        self.assertTrue(facts['compound'])
        self.assertTrue(facts['ordering_determined'])
        self.assertEqual(facts['invocations'], [['a'], ['b']])

    def test_compound_with_pipe_stays_ambiguous(self):
        facts = agent_eval_traces.command_facts('blabla a | blabla b')
        self.assertTrue(facts['compound'])
        self.assertNotIn('ordering_determined', facts)

    def test_compound_with_redirection_stays_ambiguous(self):
        facts = agent_eval_traces.command_facts('blabla a > /tmp/out && blabla b')
        self.assertTrue(facts['compound'])
        self.assertNotIn('ordering_determined', facts)

    def test_and_chain_two_unrelated_commands_is_ordered(self):
        facts = agent_eval_traces.command_facts('blabla a && blabla b')
        self.assertTrue(facts['compound'])
        self.assertTrue(facts['ordering_determined'])

    def test_and_chain_with_exit_zero_determines_success(self):
        facts = agent_eval_traces.command_facts('blabla task accept fix --model small && python custom.py', 0)
        self.assertTrue(facts['compound'])
        self.assertTrue(facts['ordering_determined'])
        self.assertTrue(facts['success_determined'])

    def test_and_chain_with_nonzero_exit_does_not_determine_success(self):
        facts = agent_eval_traces.command_facts('blabla task accept fix --model small && python custom.py', 1)
        self.assertTrue(facts['compound'])
        self.assertTrue(facts['ordering_determined'])
        self.assertNotIn('success_determined', facts)

    def test_semicolon_chain_with_exit_zero_does_not_determine_success(self):
        facts = agent_eval_traces.command_facts('blabla task accept fix --model small; echo done', 0)
        self.assertTrue(facts['compound'])
        self.assertTrue(facts['ordering_determined'])
        self.assertNotIn('success_determined', facts)

    def test_semicolon_chain_with_nonzero_exit_does_not_determine_success(self):
        facts = agent_eval_traces.command_facts('blabla task accept fix --model small; echo done', 1)
        self.assertTrue(facts['compound'])
        self.assertTrue(facts['ordering_determined'])
        self.assertNotIn('success_determined', facts)

    def test_mixed_connectors_are_ordered_but_success_not_determined(self):
        facts = agent_eval_traces.command_facts('blabla task accept x && blabla challenge x; echo done', 0)
        self.assertTrue(facts['compound'])
        self.assertTrue(facts['ordering_determined'])
        self.assertNotIn('success_determined', facts)

    @unittest.skipUnless(sys.platform == 'linux', 'The direct driver runs a fixture with Bash')
    def test_direct_driver_runs_claude_in_the_workspace_with_its_tools_allowed(self):
        with tempfile.TemporaryDirectory() as directory:
            run, recorded, _ = run_direct_case(Path(directory), 'with', exit_code=3)
            argv = recorded['argv']
            self.assertEqual(json.loads((run / 'command.json').read_text()), argv)
            self.assertIn('-p', argv)
            self.assertIn('--verbose', argv)
            self.assertEqual(argv[argv.index('--model') + 1], 'test-model')
            self.assertEqual(argv[argv.index('--output-format') + 1], 'stream-json')
            self.assertEqual(argv[argv.index('--setting-sources') + 1], 'project')
            tools = {'Bash', 'Write', 'Edit', 'Read', 'Glob', 'Grep', 'Skill'}
            self.assertEqual(set(argv[argv.index('--tools') + 1].split(',')), tools)
            self.assertEqual(set(argv[argv.index('--allowedTools') + 1].split(',')), tools)
            self.assertEqual(Path(recorded['cwd']).resolve(), (run / 'workspace').resolve())
            self.assertEqual(recorded['stdin'], 'Carry the task.')
            self.assertEqual(json.loads((run / 'trace.jsonl').read_text().splitlines()[0])['subtype'], 'init')
            self.assertEqual(json.loads((run / 'summary.json').read_text())['direct_exit'], 3)

    @unittest.skipUnless(sys.platform == 'linux', 'The direct driver runs a fixture with Bash')
    def test_direct_subject_environment_carries_no_host_claude_variable(self):
        for arm in ('with', 'without'):
            with self.subTest(arm=arm), tempfile.TemporaryDirectory() as directory:
                _, recorded, env = run_direct_case(Path(directory), arm)
                seen = recorded['env']
                self.assertEqual([key for key in seen if key.startswith(('CLAUDE_', 'CLAUDECODE'))], [])
                self.assertEqual(seen['ANTHROPIC_BASE_URL'], 'https://api.example.test')
                self.assertEqual(seen['HOME'], env['HOME'])
                self.assertEqual(seen['PATH'], common.subject_environment(env, arm)['PATH'])
                self.assertNotIn('BLABLA_EVAL_SUBJECT_TOOLS', seen)
                if arm == 'with':
                    self.assertEqual(seen['BLABLA_EVAL_EXPECTED_SHA256'], env['BLABLA_EVAL_EXPECTED_SHA256'])
                else:
                    self.assertNotIn('BLABLA_EVAL_EXPECTED_SHA256', seen)

    @unittest.skipUnless(sys.platform == 'linux', 'The direct driver runs a fixture with Bash')
    def test_direct_subject_finds_the_blabla_skill_only_on_the_with_arm(self):
        for arm in ('with', 'without'):
            with self.subTest(arm=arm), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                run, recorded, _ = run_direct_case(root, arm)
                self.assertEqual(recorded['skill'], STAGED_SKILL if arm == 'with' else None)
                if arm == 'without':
                    self.assertEqual(list((run / 'workspace').rglob('SKILL.md')), [])

    @unittest.skipUnless(sys.platform == 'linux', 'The direct driver runs a fixture with Bash')
    def test_direct_driver_rejects_a_skill_catalog_that_contradicts_the_arm(self):
        for arm, skills in (('with', ['update-config']), ('without', ['update-config', 'blabla'])):
            with self.subTest(arm=arm), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(RuntimeError):
                    run_direct_case(Path(directory), arm, skills=skills)
                self.assertFalse((Path(directory) / 'campaign' / arm / 'run-1/summary.json').exists())


STAGED_SKILL = '---\nname: blabla\ndescription: staged for this campaign\n---\n'


def run_direct_case(root, arm, skills=None, exit_code=0):
    offered = skills if skills is not None else (['update-config', 'blabla'] if arm == 'with' else ['update-config'])
    record = root / 'recorded.json'
    trace = '\n'.join(json.dumps(event) for event in (
        {'type': 'system', 'subtype': 'init', 'skills': offered, 'tools': ['Bash']},
        {'type': 'result', 'subtype': 'success', 'is_error': False, 'num_turns': 1, 'permission_denials': []}))
    tools = root / 'bin'
    tools.mkdir()
    fake_claude = tools / 'claude'
    fake_claude.write_text(
        f'#!{sys.executable}\n'
        'import json, os, sys\n'
        'from pathlib import Path\n'
        'skill = Path(".claude/skills/blabla/SKILL.md")\n'
        f'Path({str(record)!r}).write_text(json.dumps({{"argv": sys.argv, "cwd": os.getcwd(), "stdin": sys.stdin.read(),'
        ' "env": dict(os.environ), "skill": skill.read_text() if skill.is_file() else None}))\n'
        f'print({trace!r})\n'
        f'sys.exit({exit_code})\n')
    fake_claude.chmod(0o755)
    fake_blabla = tools / 'blabla'
    fake_blabla.write_text('#!/bin/sh\nexit 0\n')
    fake_blabla.chmod(0o755)
    case = root / 'campaign/materials/evals/probe'
    case.mkdir(parents=True)
    (case / 'fixture.sh').write_text("printf 'x = 1\\n' > app.py\n")
    (case / 'fixture.json').write_text('{}')
    for prompt in ('prompt.md', 'prompt-without.md'):
        (case / prompt).write_text('---\ntimeout_seconds: 30\n---\n\nCarry the task.\n')
    (case / 'rubric.json').write_text(json.dumps({'criteria': [
        {'id': 'app-kept', 'kind': 'file_regex', 'weight': 1, 'required': True, 'path': 'app.py', 'pattern': 'x = 1'}]}))
    staged = root / 'campaign/materials/.claude/skills/blabla/SKILL.md'
    staged.parent.mkdir(parents=True)
    staged.write_text(STAGED_SKILL)
    env = dict(common.base_environment(fake_blabla), HOME=str(root / 'home'), CLAUDECODE='1',
               CLAUDE_CODE_ENTRYPOINT='remote', CLAUDE_CODE_SESSION_ID='host-session', CLAUDE_PID='1',
               ANTHROPIC_BASE_URL='https://api.example.test')
    claude = shutil.which('claude', path=env['PATH'])
    with contextlib.redirect_stdout(io.StringIO()):
        claude_eval.run_case(case, arm, 1, root / 'campaign', env, claude, 'test-model', False, 'direct')
    return root / 'campaign' / arm / 'run-1', json.loads(record.read_text()), env


if __name__ == '__main__':
    unittest.main()
