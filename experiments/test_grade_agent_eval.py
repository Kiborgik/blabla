import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from agent_eval_traces import command_facts, normalize_events
from grade_agent_eval import grade_run, write_reports


class GradingTests(unittest.TestCase):
    def test_restored_contract_still_fails_after_an_observed_write(self):
        import hashlib
        before = {'project.bla': hashlib.sha256(b'original').hexdigest()}
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'file_change',
                   'status': 'completed', 'changes': [{'path': 'project.bla', 'kind': 'update'}]}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'contracts', 'kind': 'unchanged', 'glob': '*.bla', 'weight': 1}],
                                events, files={'project.bla': 'original'}, before=before)
        self.assertEqual(result['criteria'][0]['status'], 'fail')

    def test_empty_command_prefix_is_rejected(self):
        with self.assertRaises(ValueError):
            self.run_grade([{'id': 'accept', 'kind': 'command', 'argv': [], 'weight': 1}], [{'type': 'turn.completed'}])

    def test_help_does_not_count_as_executing_a_command(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                   'command': 'blabla task evidence --help', 'exit_code': 0}}, {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'evidence', 'kind': 'command', 'argv': ['task', 'evidence'], 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'fail')

    def run_grade(self, criteria, events, host='codex', files=None, before=None, arm='with'):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            for path, content in (files or {}).items():
                target = workspace / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content)
            normalized = normalize_events(host, events)
            return grade_run({'criteria': criteria}, normalized, workspace, before, arm)

    def test_the_arm_without_blabla_grades_outcome_criteria_only(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla status', 'exit_code': 0}}, {'type': 'turn.completed'}]
        criteria = [{'id': 'status', 'kind': 'command', 'argv': ['status'], 'weight': 1, 'required': True},
                    {'id': 'green', 'kind': 'observation', 'name': 'status', 'weight': 1, 'required': True},
                    {'id': 'syntax', 'kind': 'observation', 'name': 'syntax', 'weight': 1, 'required': True},
                    {'id': 'contracts', 'kind': 'unchanged', 'glob': '*.bla', 'weight': 1, 'required': True},
                    {'id': 'save', 'kind': 'file_regex', 'path': 'store.py', 'pattern': 'def save', 'weight': 2, 'required': True}]
        result = grade_run({'criteria': criteria}, normalize_events('codex', events), Path(tempfile.mkdtemp()), {}, 'without',
                           {'syntax': {'exit': 0, 'reason': 'ok', 'reference': 'oracle'}})
        statuses = {row['id']: row['status'] for row in result['criteria']}
        self.assertEqual(statuses['status'], 'not_applicable')
        self.assertEqual(statuses['green'], 'not_applicable')
        self.assertEqual(statuses['contracts'], 'not_applicable')
        self.assertEqual(statuses['syntax'], 'pass')
        self.assertEqual(statuses['save'], 'fail')
        self.assertEqual({row['id']: row['shared'] for row in result['criteria']},
                         {'status': False, 'green': False, 'syntax': True, 'contracts': False, 'save': True})
        self.assertEqual(result['applicable_weight'], 3)
        with_arm = grade_run({'criteria': criteria}, normalize_events('codex', events), Path(tempfile.mkdtemp()), {}, 'with',
                             {'syntax': {'exit': 0, 'reason': 'ok', 'reference': 'oracle'}})
        self.assertEqual({row['id']: row['status'] for row in with_arm['criteria']}['status'], 'pass')

    def test_hand_back_refused_only_for_evaluator_planted_paths_counts_as_ready(self):
        planted = ('CHALLENGE  bounded task fix\n\nI cannot attribute .bash_profile.\n\nEvidence:\n'
                   '  changed since the task opened: .bash_profile\n'
                   '  3 changed paths carry no declaration: .bash_profile, .bashrc, .eval-artifacts\n\nClass: attribution-unknown\n')
        def events(challenge_output):
            return [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                      'command': 'blabla task ready fix', 'exit_code': 2,
                      'aggregated_output': 'ERROR [task]: task "fix" cannot be handed back from "accepted": run blabla challenge fix'}},
                    {'type': 'item.completed', 'item': {'id': 'b', 'type': 'command_execution',
                      'command': 'blabla challenge fix', 'exit_code': 1, 'aggregated_output': challenge_output}},
                    {'type': 'turn.completed'}]
        criteria = [{'id': 'ready', 'kind': 'task_field', 'field': 'state', 'equals': 'ready', 'path': 'record.json',
                     'weight': 2, 'required': True},
                    {'id': 'order', 'kind': 'sequence', 'commands': [['task', 'ready']], 'weight': 1, 'required': True}]
        files = {'record.json': json.dumps({'state': 'accepted'})}
        result = self.run_grade(criteria, events(planted), files=files)
        self.assertEqual([row['status'] for row in result['criteria']], ['pass', 'pass'])
        self.assertIn('planted', result['criteria'][0]['reason'])
        own = planted.replace('.eval-artifacts', 'widget/extra.py')
        result = self.run_grade(criteria, events(own), files=files)
        self.assertEqual([row['status'] for row in result['criteria']], ['fail', 'fail'])
        standing = planted + 'Also standing, one challenge at a time: unresolved-finding\n'
        result = self.run_grade(criteria, events(standing), files=files)
        self.assertEqual(result['criteria'][0]['status'], 'fail')
        project_wide = planted + 'Also standing, one challenge at a time: verification-not-current\n'
        result = self.run_grade(criteria, events(project_wide), files=files)
        self.assertEqual(result['criteria'][0]['status'], 'pass')

    def test_a_run_cut_at_the_turn_limit_is_graded_on_what_it_left(self):
        events = [{'type': 'assistant', 'message': {'content': [
                      {'type': 'tool_use', 'id': 'a', 'name': 'Bash', 'input': {'command': 'blabla status'}}]}},
                  {'type': 'user', 'message': {'content': [
                      {'type': 'tool_result', 'tool_use_id': 'a', 'content': 'GREEN', 'is_error': False}]}},
                  {'type': 'result', 'subtype': 'error_max_turns', 'is_error': True, 'result': 'max turns reached'}]
        criteria = [{'id': 'status', 'kind': 'command', 'argv': ['status'], 'weight': 1, 'required': True}]
        result = self.run_grade(criteria, events, host='claude')
        self.assertTrue(result['valid'])
        self.assertEqual(result['terminal'], 'error_max_turns')
        self.assertEqual(result['criteria'][0]['status'], 'pass')
        api = list(events[:2]) + [{'type': 'result', 'subtype': 'error_during_execution', 'is_error': True, 'result': 'api error'}]
        result = self.run_grade(criteria, api, host='claude')
        self.assertFalse(result['valid'])
        self.assertEqual(result['criteria'][0]['status'], 'unknown')

    def test_failed_command_never_passes_as_successful_evidence(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                   'command': 'blabla task evidence fix --exit 0 --tool blabla status', 'exit_code': 2}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'evidence', 'kind': 'command', 'argv': ['task', 'evidence'],
                                 'weight': 1, 'required': True}], events)
        self.assertEqual(result['criteria'][0]['status'], 'fail')
        self.assertEqual(result['score'], 0)
        self.assertFalse(result['passed'])

    def test_equivalent_host_events_receive_identical_grades(self):
        codex = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla status', 'exit_code': 0}}, {'type': 'turn.completed'}]
        claude = [{'type': 'assistant', 'message': {'content': [
                  {'type': 'tool_use', 'id': 'a', 'name': 'Bash', 'input': {'command': 'blabla status'}}]}},
                  {'type': 'user', 'message': {'content': [
                  {'type': 'tool_result', 'tool_use_id': 'a', 'content': 'GREEN'}]}},
                  {'type': 'result', 'is_error': False}]
        criterion = [{'id': 'status', 'kind': 'command', 'argv': ['status'], 'weight': 2}]
        first = self.run_grade(criterion, codex)
        second = self.run_grade(criterion, claude, 'claude')
        self.assertEqual(first['score'], second['score'])
        self.assertEqual(first['criteria'][0]['status'], second['criteria'][0]['status'])

    def test_acceptance_after_write_fails_ordering(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'cat > widget/store.py <<EOF\npass\nEOF', 'exit_code': 0}},
                  {'type': 'item.completed', 'item': {'id': 'b', 'type': 'command_execution',
                  'command': 'blabla task accept fix --model small', 'exit_code': 0}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'ordered', 'kind': 'accept_before_edit', 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'fail')

    def test_discarded_stderr_is_not_an_implementation_edit(self):
        for command in ('grep -r save widget 2>/dev/null || echo absent',
                        'cat widget/store.py >/dev/null', 'grep save widget/store.py 2>&1'):
            self.assertEqual(command_facts(command)['mutation'], 'no', command)
        self.assertEqual(command_facts('cat widget/store.py > widget/copy.py')['mutation'], 'yes')

    def test_native_read_result_without_optional_error_flag_is_successful(self):
        events = [{'type': 'assistant', 'message': {'content': [
                   {'type': 'tool_use', 'id': 'read', 'name': 'Read', 'input': {'file_path': 'process.bla'}}]}},
                  {'type': 'user', 'message': {'content': [
                   {'type': 'tool_result', 'tool_use_id': 'read', 'content': 'role worker'}]}},
                  {'type': 'result', 'is_error': False}]
        result = self.run_grade([{'id': 'policy', 'kind': 'memory_read', 'weight': 1}], events, 'claude')
        self.assertEqual(result['criteria'][0]['status'], 'pass')
        events[1]['message']['content'][0]['is_error'] = True
        result = self.run_grade([{'id': 'policy', 'kind': 'memory_read', 'weight': 1}], events, 'claude')
        self.assertEqual(result['criteria'][0]['status'], 'fail')

    def test_determined_order_with_semicolon_passes(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla task accept fix --model small', 'exit_code': 0}},
                  {'type': 'item.completed', 'item': {'id': 'b', 'type': 'command_execution',
                  'command': 'touch widget/store.py', 'exit_code': 0}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'ordered', 'kind': 'accept_before_edit', 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'pass')
        self.assertEqual(result['score'], 1.0)

    def test_semicolon_compound_accept_before_edit_is_unknown(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla task accept fix --model small; echo done', 'exit_code': 0}},
                  {'type': 'item.completed', 'item': {'id': 'b', 'type': 'command_execution',
                  'command': 'touch widget/store.py', 'exit_code': 0}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'ordered', 'kind': 'accept_before_edit', 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'unknown')

    def test_clean_acceptance_before_edit_passes_beside_an_ambiguous_compound(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla task accept fix --model small', 'exit_code': 0}},
                  {'type': 'item.completed', 'item': {'id': 'b', 'type': 'command_execution',
                  'command': 'blabla task accept fix --model small; echo done', 'exit_code': 0}},
                  {'type': 'item.completed', 'item': {'id': 'c', 'type': 'command_execution',
                  'command': 'touch widget/store.py', 'exit_code': 0}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'ordered', 'kind': 'accept_before_edit', 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'pass')

    def test_and_chain_accept_with_exit_zero_proves_success(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla task accept fix --model small && python custom.py', 'exit_code': 0}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'accept', 'kind': 'command', 'argv': ['task', 'accept'], 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'pass')

    def test_and_chain_with_nonzero_exit_is_unknown(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla task accept fix --model small && python custom.py', 'exit_code': 1}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'accept', 'kind': 'command', 'argv': ['task', 'accept'], 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'unknown')

    def test_semicolon_compound_command_unknown_for_success(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla task accept fix --model small; echo done', 'exit_code': 0}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'accept', 'kind': 'command', 'argv': ['task', 'accept'], 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'unknown')

    def test_pipe_compound_order_is_unknown(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla task accept fix --model small | python custom.py', 'exit_code': 0}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'ordered', 'kind': 'accept_before_edit', 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'unknown')
        self.assertIsNone(result['score'])

    def test_or_connector_compound_order_is_unknown(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla task accept fix --model small || python custom.py', 'exit_code': 0}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'ordered', 'kind': 'accept_before_edit', 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'unknown')
        self.assertIsNone(result['score'])

    def test_subshell_compound_order_is_unknown(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla task accept fix --model small; (python custom.py)', 'exit_code': 0}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'ordered', 'kind': 'accept_before_edit', 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'unknown')
        self.assertIsNone(result['score'])

    def test_backtick_compound_order_is_unknown(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla task accept fix --model small; `python custom.py`', 'exit_code': 0}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'ordered', 'kind': 'accept_before_edit', 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'unknown')
        self.assertIsNone(result['score'])

    def test_command_substitution_compound_order_is_unknown(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla task accept fix --model small; echo $(python custom.py)', 'exit_code': 0}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'ordered', 'kind': 'accept_before_edit', 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'unknown')
        self.assertIsNone(result['score'])

    def test_heredoc_compound_order_is_unknown(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'cat > /tmp/file <<EOF\necho content\nEOF; python custom.py', 'exit_code': 0}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'ordered', 'kind': 'accept_before_edit', 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'unknown')
        self.assertIsNone(result['score'])

    def test_later_proven_check_does_not_hide_an_earlier_ambiguous_sequence(self):
        commands = ['blabla status | cat widget/model.py', 'blabla task evidence work --exit 0 --tool check',
                    'blabla challenge work', 'blabla task ready work', 'blabla status']
        events = [{'type': 'item.completed', 'item': {'id': str(index), 'type': 'command_execution',
                   'command': command, 'exit_code': 0}} for index, command in enumerate(commands)]
        events.append({'type': 'turn.completed'})
        criterion = [{'id': 'order', 'kind': 'sequence', 'weight': 1,
                      'commands': [['status'], ['task', 'evidence'], ['challenge'], ['task', 'ready']]}]
        result = self.run_grade(criterion, events)
        self.assertEqual(result['criteria'][0]['status'], 'unknown')
        events[2]['item']['exit_code'] = 2
        result = self.run_grade(criterion, events)
        self.assertEqual(result['criteria'][0]['status'], 'fail')

    def test_mentioning_a_command_is_not_executing_it(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'echo "blabla task accept fix --model small"', 'exit_code': 0}},
                  {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'accept', 'kind': 'command', 'argv': ['task', 'accept'], 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'fail')

    def test_a_command_criterion_may_accept_any_completed_exit(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'blabla status', 'exit_code': 1}}, {'type': 'turn.completed'}]
        strict = self.run_grade([{'id': 'status', 'kind': 'command', 'argv': ['status'], 'weight': 1}], events)
        self.assertEqual(strict['criteria'][0]['status'], 'fail')
        lenient = self.run_grade([{'id': 'status', 'kind': 'command', 'argv': ['status'], 'weight': 1, 'outcome': 'any'}], events)
        self.assertEqual(lenient['criteria'][0]['status'], 'pass')
        unfinished = [{'type': 'item.started', 'item': {'id': 'a', 'type': 'command_execution', 'command': 'blabla status'}},
                      {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'status', 'kind': 'command', 'argv': ['status'], 'weight': 1, 'outcome': 'any'}], unfinished)
        self.assertEqual(result['criteria'][0]['status'], 'unknown')
        with self.assertRaises(ValueError):
            self.run_grade([{'id': 'status', 'kind': 'command', 'argv': ['status'], 'weight': 1, 'outcome': 'sometimes'}], events)

    def test_task_count_reads_rows_on_a_named_record(self):
        record = json.dumps({'assessments': [{'lens': 'reviewing', 'statement': 'read'}],
                             'findings': [{'id': 1, 'statement': 'save persists nothing'}]})
        files = {'.blabla/tasks/review.json': record}
        criteria = [{'id': 'lenses', 'kind': 'task_count', 'weight': 1, 'path': '.blabla/tasks/review.json',
                     'field': 'assessments', 'min': 2},
                    {'id': 'finding', 'kind': 'task_count', 'weight': 1, 'path': '.blabla/tasks/review.json',
                     'field': 'findings', 'min': 1, 'pattern': 'persists'},
                    {'id': 'absent', 'kind': 'task_count', 'weight': 1, 'path': '.blabla/tasks/missing.json',
                     'field': 'findings', 'min': 1}]
        result = self.run_grade(criteria, [{'type': 'turn.completed'}], files=files)
        self.assertEqual([row['status'] for row in result['criteria']], ['fail', 'pass', 'fail'])
        with self.assertRaises(ValueError):
            self.run_grade([{'id': 'zero', 'kind': 'task_count', 'weight': 1, 'field': 'findings', 'min': 0}],
                           [{'type': 'turn.completed'}])

    def test_contract_hash_detects_shell_edit(self):
        import hashlib
        before = {'project.bla': hashlib.sha256(b'original').hexdigest()}
        result = self.run_grade([{'id': 'contracts', 'kind': 'unchanged', 'glob': '*.bla', 'weight': 2}],
                                [{'type': 'turn.completed'}], files={'project.bla': 'weakened'}, before=before)
        self.assertEqual(result['criteria'][0]['status'], 'fail')

    def test_bytecode_caches_never_count_as_a_changed_protected_path(self):
        before = {'adapters/python/blabla_adapter.py': 'a'}
        result = self.run_grade([{'id': 'adapter', 'kind': 'unchanged', 'glob': 'adapters/*', 'weight': 1, 'required': True}],
                                [{'type': 'turn.completed'}], before=before,
                                files={'adapters/python/blabla_adapter.py': 'x',
                                       'adapters/python/__pycache__/blabla_adapter.cpython-314.pyc': 'y'})
        self.assertEqual(result['criteria'][0]['status'], 'fail')
        import hashlib
        before = {'adapters/python/blabla_adapter.py': hashlib.sha256(b'x').hexdigest()}
        result = self.run_grade([{'id': 'adapter', 'kind': 'unchanged', 'glob': 'adapters/*', 'weight': 1, 'required': True}],
                                [{'type': 'turn.completed'}], before=before,
                                files={'adapters/python/blabla_adapter.py': 'x',
                                       'adapters/python/__pycache__/blabla_adapter.cpython-314.pyc': 'y'})
        self.assertEqual(result['criteria'][0]['status'], 'pass')

    def test_missing_baseline_is_unknown_not_unchanged(self):
        result = self.run_grade([{'id': 'contracts', 'kind': 'unchanged', 'glob': '*.bla', 'weight': 1}],
                                [{'type': 'turn.completed'}], files={'project.bla': 'anything'})
        self.assertEqual(result['criteria'][0]['status'], 'unknown')

    def test_missing_trace_is_invalid_not_success(self):
        result = self.run_grade([{'id': 'status', 'kind': 'command', 'argv': ['status'], 'weight': 1}], [])
        self.assertFalse(result['valid'])
        self.assertIsNone(result['score'])

    def test_not_grounded_text_cannot_satisfy_a_challenge(self):
        events = [{'type': 'item.completed', 'item': {'id': 'a', 'type': 'command_execution',
                  'command': 'cat notes.txt', 'exit_code': 0,
                  'aggregated_output': 'Not grounded: work-without-acceptance'}}, {'type': 'turn.completed'}]
        result = self.run_grade([{'id': 'challenge', 'kind': 'command', 'argv': ['challenge'], 'weight': 1}], events)
        self.assertEqual(result['criteria'][0]['status'], 'fail')

    def test_disabled_spawning_is_not_a_compliance_pass(self):
        result = self.run_grade([{'id': 'no-spawn', 'kind': 'no_spawn', 'weight': 1}],
                                [{'type': 'turn.completed'}])
        self.assertEqual(result['criteria'][0]['status'], 'not_applicable')
        self.assertIsNone(result['score'])

    def test_write_reports_computes_efficiency_stats(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            out_dir = Path(temp_dir)
            coverage_dir = Path(temp_dir) / 'evals'
            coverage_dir.mkdir(parents=True, exist_ok=True)
            coverage_file = coverage_dir / 'coverage.json'
            coverage_file.write_text(json.dumps({'systems': [], 'capabilities': [], 'behaviors': []}), encoding='utf-8')
            results = [{
                'case': 'test_case',
                'host': 'test_host',
                'arm': 'with',
                'run': 'test_run_1',
                'score': 0.5,
                'valid': True,
                'passed': False,
                'criteria': [
                    {'id': 'test_criterion', 'status': 'pass', 'weight': 1, 'evidence': [], 'reason': 'test'}
                ],
                'diagnostics': [],
                'seconds': 10.5,
                'actions': [
                    {'kind': 'command', 'command': 'blabla status', 'invocations': [['status']]},
                    {'kind': 'command', 'command': 'blabla task accept fix --model small', 'invocations': [['task', 'accept', 'fix', '--model', 'small']]},
                    {'kind': 'write', 'paths': ['file1.py']},
                    {'kind': 'read', 'path': 'file2.py'},
                    {'kind': 'command', 'command': 'ls -la', 'invocations': []}
                ]
            }, {
                'case': 'test_case',
                'host': 'test_host',
                'arm': 'with',
                'run': 'test_run_2',
                'score': 0.6,
                'valid': True,
                'passed': False,
                'criteria': [
                    {'id': 'test_criterion', 'status': 'pass', 'weight': 1, 'evidence': [], 'reason': 'test'}
                ],
                'diagnostics': [],
                'seconds': 12.0,
                'actions': [
                    {'kind': 'command', 'command': 'cargo run --quiet --bin blabla -- status', 'invocations': [['status']]},
                    {'kind': 'write', 'paths': ['file3.py']},
                    {'kind': 'write', 'paths': ['file4.py']}
                ]
            }]
            with mock.patch('grade_agent_eval.ROOT', Path(temp_dir)):
                report = write_reports(results, out_dir)
            self.assertIn('efficiency', report)
            self.assertEqual(len(report['efficiency']), 1)
            eff = report['efficiency'][0]
            self.assertEqual(eff['case'], 'test_case')
            self.assertEqual(eff['host'], 'test_host')
            self.assertEqual(eff['arm'], 'with')
            self.assertEqual(eff['seconds'], {'median': 11.25, 'min': 10.5, 'max': 12.0, 'runs': 2})
            self.assertEqual(eff['total_actions']['median'], 4)
            self.assertEqual(eff['blabla_invocations']['median'], 1.5)
            self.assertEqual(eff['file_edits']['median'], 1.5)
            grades_file = out_dir / 'grades.json'
            grades = json.loads(grades_file.read_text(encoding='utf-8'))
            self.assertIn('efficiency', grades)
            self.assertNotIn('actions', grades['runs'][0])
            scorecard = json.loads((out_dir / 'scorecard.json').read_text(encoding='utf-8'))
            self.assertEqual(scorecard['efficiency'], report['efficiency'])
            self.assertNotIn('actions', scorecard['runs'][0])

    def test_write_reports_creates_scorecard(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            out_dir = Path(temp_dir)
            coverage_dir = Path(temp_dir) / 'evals'
            coverage_dir.mkdir(parents=True, exist_ok=True)
            coverage_file = coverage_dir / 'coverage.json'
            coverage_file.write_text(json.dumps({'systems': [], 'capabilities': [], 'behaviors': []}), encoding='utf-8')
            results = [{
                'case': 'test_case',
                'host': 'test_host',
                'arm': 'with',
                'run': 'test_run_1',
                'score': 0.5,
                'valid': True,
                'passed': False,
                'criteria': [
                    {'id': 'test_criterion', 'status': 'pass', 'weight': 1, 'evidence': [], 'reason': 'test'}
                ],
                'diagnostics': [],
                'actions': []
            }]
            with mock.patch('grade_agent_eval.ROOT', Path(temp_dir)):
                write_reports(results, out_dir)
            scorecard_file = out_dir / 'scorecard.json'
            self.assertTrue(scorecard_file.exists(), 'scorecard.json was not created')
            scorecard = json.loads(scorecard_file.read_text(encoding='utf-8'))
            self.assertIn('purpose', scorecard)
            self.assertIn('runs', scorecard)
            self.assertTrue((out_dir / 'scorecard.md').exists(), 'scorecard.md was not created')
            self.assertTrue((out_dir / 'scorecard.html').exists(), 'scorecard.html was not created')
            self.assertTrue((out_dir / 'report.md').is_file(), 'report.md was not created')
            self.assertIn('data-case="test_case"', (out_dir / 'report.html').read_text(encoding='utf-8'))

    def test_comparison_counts_only_checks_both_arms_face(self):
        def row(identifier, status, weight=2):
            return {'id': identifier, 'status': status, 'weight': weight, 'required': True, 'scored': True,
                    'reason': 'r', 'evidence': []}
        def run(arm, criteria):
            return {'case': 'c', 'host': 'claude', 'arm': arm, 'run': f'{arm}-1', 'valid': True, 'passed': False,
                    'score': None, 'terminal': 'success', 'criteria': criteria, 'diagnostics': [], 'actions': []}
        results = [run('with', [row('contracts', 'pass'), row('accept', 'pass'), row('source', 'pass'), row('scope', 'fail')]),
                   run('without', [row('contracts', 'not_applicable'), row('accept', 'not_applicable'),
                                   row('source', 'fail'), row('scope', 'fail')])]
        with tempfile.TemporaryDirectory() as temp_dir:
            out_dir = Path(temp_dir)
            (out_dir / 'evals').mkdir()
            (out_dir / 'evals/coverage.json').write_text(json.dumps({'systems': [], 'capabilities': [], 'behaviors': []}))
            with mock.patch('grade_agent_eval.ROOT', out_dir):
                report = write_reports(results, out_dir)
        flags = {(entry['arm'], criterion['id']): criterion['comparable'] for entry in report['runs'] for criterion in entry['criteria']}
        self.assertEqual({key for key, value in flags.items() if value},
                         {('with', 'source'), ('with', 'scope'), ('without', 'source'), ('without', 'scope')})
        scores = {group['arm']: (group['comparable_score'], group['blabla_only_score']) for group in report['aggregates']}
        self.assertEqual(scores, {'with': (0.5, 1.0), 'without': (0.0, None)})
        delta = report['deltas'][0]
        self.assertEqual((delta['checks'], delta['points'], delta['with_minus_without']), (2, 4, 0.5))

    def test_every_rubric_check_has_a_description(self):
        from grade_agent_eval import describe
        for rubric in (Path(__file__).resolve().parent.parent / 'evals').glob('*/rubric.json'):
            for criterion in json.loads(rubric.read_text(encoding='utf-8'))['criteria']:
                with self.subTest(case=rubric.parent.name, criterion=criterion['id']):
                    description = describe(criterion)
                    self.assertIsInstance(description, str)
                    self.assertTrue(description.strip())


if __name__ == '__main__':
    unittest.main()
