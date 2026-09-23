import json
import os
from pathlib import Path
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


if __name__ == '__main__':
    unittest.main()
