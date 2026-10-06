import copy
import contextlib
import hashlib
import importlib.util
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

import expert_eval
from test_native_expert import child, host_request, native, observation, boundary


PATH = pathlib.Path(__file__).with_name('expert_native_live.py')
if PATH.exists():
    SPEC = importlib.util.spec_from_file_location('expert_native_live', PATH)
    runner = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(runner)
    native = runner.native
else:
    runner = None


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(value, indent=2) + '\n').encode()
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


class SyntheticCore:
    def __init__(self, project, script):
        self.project = pathlib.Path(project).resolve()
        self.script = script
        self.calls = []

    def invoke(self, operation, request):
        self.calls.append((operation, copy.deepcopy(request)))
        expected, result = self.script.pop(0)
        if operation != expected:
            raise AssertionError((operation, expected))
        if isinstance(result, Exception):
            raise result
        return copy.deepcopy(result)

    def checkpoint(self, run_id, event):
        return self.invoke('checkpoint', {'run_id': run_id, 'event': event})


@contextlib.contextmanager
def windows_filesystem(roots, attributes=None):
    windows = pathlib.PureWindowsPath
    attributes = attributes or {}
    read = runner.read_bytes
    with contextlib.ExitStack() as stack:
        stack.enter_context(mock.patch.object(runner, 'pathlib', SimpleNamespace(Path=windows)))
        for name, function in {
            'is_dir': lambda path: True,
            'is_file': lambda path: True,
            'is_symlink': lambda path: False,
            'lstat': lambda path: SimpleNamespace(st_mode=stat.S_IFDIR,
                st_file_attributes=attributes.get(path, 0)),
            'resolve': lambda path, strict=False: windows(str(path).replace('WORKSP~1', 'workspace')),
        }.items():
            stack.enter_context(mock.patch.object(windows, name, function, create=True))
        stack.enter_context(mock.patch.object(runner, 'read_bytes',
            side_effect=lambda root, relative, *limit: read(roots[root.name], relative, *limit)))
        yield


class NativeLiveImportTests(unittest.TestCase):
    def test_package_import_in_fresh_process_without_sibling_pythonpath(self):
        result = subprocess.run([sys.executable, '-E', '-c',
            "import experiments.expert_native_live as live; "
            "assert callable(live.live_native); "
            "assert live.expert_eval.__name__ == 'experiments.expert_eval'"],
            cwd=PATH.parents[1], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)


class NativeLiveTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(callable(getattr(runner, 'live_native', None)), 'resumable live entry point is missing')
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.protocol = expert_eval.read_json(expert_eval.DEFAULT_DATA / 'protocol.json')
        self.roots = {mode: self.root / mode for mode in expert_eval.ARMS}
        self.plan = {'kind': 'native_matched_run_plan', 'schema_version': 1,
            'experiment_id': 'synthetic-native-live', 'protocol_sha256': expert_eval.fingerprint(self.protocol),
            'phase': 'pilot', 'capability': {'host': self.protocol['host']['capabilities']},
            'provider': {'provider': 'synthetic'}, 'calibration': {'id': 'calibration', 'path': 'calibration.json', 'sha256': 'a' * 64},
            'controls_sha256': expert_eval.fingerprint(self.protocol['pilot']['controls']),
            'snapshot_files': {}, 'arms': [], 'order': list(expert_eval.ARMS),
            'host_operation_timeout_ms': 1000, 'response_timeout_ms': 1000}
        for mode, root in self.roots.items():
            root.mkdir()
            (root / 'workspace').mkdir()
            (root / 'project.bla').write_text('synthetic project placeholder\n')
            config_hash = save(root / 'configs' / (mode + '.json'), {'mode': mode})
            grading_hash = save(root / 'grading.json', {'kind': 'synthetic-grading-spec'})
            self.plan['arms'].append({'run_id': mode, 'matched_task_id': 'matched', 'repeat': 1,
                'arm': mode, 'task': 'task::fixture', 'acceptance_epoch': 1, 'child': child(),
                'coordinator': child('/root'), 'workspace': 'workspace',
                'initial_assignment_revision': host_request()['key']['assignment_revision'],
                'frozen_brief': 'Finish the bounded task.',
                'brief_sha256': hashlib.sha256(b'Finish the bounded task.').hexdigest(),
                'runtime_config': {'id': 'config-' + mode, 'path': 'configs/' + mode + '.json', 'sha256': config_hash},
                'budgets': {'provider_attempts': 0 if mode == 'off' else 2,
                    'evaluated_questions': 0 if mode == 'off' else 2,
                    'delivery_attempts': 1 if mode == 'advisory' else 0, 'max_wall_ms': 600000},
                'grading_spec': {'id': 'grading', 'path': 'grading.json', 'sha256': grading_hash}})
        for root in self.roots.values():
            for arm in self.plan['arms']:
                save(root / arm['runtime_config']['path'], {'mode': arm['arm']})
        self.freeze()
        self.cores = {}

    def freeze(self):
        for root in self.roots.values():
            save(root / 'plan.json', self.plan)
            save(root / 'protocol.json', self.protocol)

    def pending(self, mode='off', kind='inspect_child'):
        request = host_request(kind)
        request['key']['run_id'] = mode
        return {'kind': 'pending', 'request': request}

    def core(self, mode, script):
        core = SyntheticCore(self.roots[mode], script)
        self.cores[core.project] = core
        return core

    def run_live(self):
        return runner.live_native('protocol.json', 'plan.json', self.roots,
                                  core_factory=lambda project: self.cores[pathlib.Path(project)])

    def test_pending_restart_returns_same_operation_without_host_execution(self):
        pending = self.pending()
        core = self.core('off', [('start-run', pending), ('start-run', pending)])
        first = self.run_live()
        second = self.run_live()
        self.assertEqual(first['status'], 'pending_host')
        self.assertEqual(first['rendezvous'], second['rendezvous'])
        self.assertEqual(first['rendezvous']['operation'], pending['request'])
        self.assertEqual([call[0] for call in core.calls], ['start-run', 'start-run'])
        self.assertEqual(first['planned_runs'], 3)
        self.assertEqual(first['completed_runs'], 0)
        self.assertTrue(all(run['calls'] is None and run['cost'] is None for run in first['runs']))

    def test_exact_raw_plan_and_protocol_are_frozen_but_advance_uses_canonical_hash(self):
        due = self.checkpoint_due('off')
        core = self.core('off', [('start-run', due), ('observe', self.observed(due)),
            ('checkpoint', self.evaluation('off')), ('advance', self.pending())])
        self.run_live()
        start = core.calls[0][1]
        self.assertEqual(start['native_plan']['sha256'], hashlib.sha256((self.roots['off'] / 'plan.json').read_bytes()).hexdigest())
        self.assertEqual(start['protocol']['sha256'], hashlib.sha256((self.roots['off'] / 'protocol.json').read_bytes()).hexdigest())
        self.assertEqual(core.calls[-1][1]['native_plan_sha256'], expert_eval.fingerprint(self.plan))
        self.assertNotEqual(start['native_plan']['sha256'], core.calls[-1][1]['native_plan_sha256'])

    def checkpoint_due(self, mode):
        key = self.pending(mode)['request']['key']
        return {'kind': 'checkpoint_due', 'observation': {'schema_version': 1, 'kind': 'observe',
            'key': key, 'boundary_operation_id': 'boundary-operation', 'idle_operation_id': 'idle-operation',
            'config_sha256': next(a for a in self.plan['arms'] if a['run_id'] == mode)['runtime_config']['sha256']}}

    def observed(self, due):
        key = due['observation']['key']
        return {'kind': 'boundary_observed', 'checkpoint': {'key': key, 'selected': []},
            'event': {'event_id': 'event', 'run_id': key['run_id'], 'task': key['task'],
                'checkpoint_id': key['checkpoint_id'], 'sequence': key['sequence'],
                'previous_sequence': key['previous_sequence'], 'unix_ms': 10000, 'kind': 'turn_end',
                'host': self.protocol['host']['capabilities'], 'observations': []}}

    def evaluation(self, mode):
        return {'execution': {'kind': 'experimental', 'run_id': mode, 'experiment_id': self.plan['experiment_id'],
            'arm': mode, 'protocol_sha256': hashlib.sha256((self.roots[mode] / 'protocol.json').read_bytes()).hexdigest(),
            'native_plan_sha256': hashlib.sha256((self.roots[mode] / 'plan.json').read_bytes()).hexdigest(),
            'authority': None, 'capability_sha256': expert_eval.fingerprint(self.plan['capability'])},
            'mode': mode, 'capture_status': 'disabled' if mode == 'off' else 'abstained',
            'provider_calls': 0 if mode == 'off' else 1, 'proposal_ids': [], 'captured': 0,
            'omitted_evaluations': 0, 'usage': {'input_tokens': None, 'output_tokens': None, 'reported_latency_ms': None}}

    def test_checkpoint_bridge_observes_before_evaluating_core_event_only(self):
        due = self.checkpoint_due('off')
        observed = self.observed(due)
        core = self.core('off', [('start-run', due), ('observe', observed),
            ('checkpoint', self.evaluation('off')), ('advance', self.pending())])
        report = self.run_live()
        self.assertEqual(core.calls[1], ('observe', due['observation']))
        self.assertEqual(core.calls[2], ('checkpoint', {'run_id': 'off', 'event': observed['event']}))
        self.assertEqual(report['runs'][0]['checkpoints'][0]['evaluation']['provider_calls'], 0)
        self.assertEqual(report['runs'][0]['calls'], None)

    def test_shadow_has_no_exposure_or_host_side_effect(self):
        self.core('off', [('start-run', {'kind': 'arm_finished', 'run_id': 'off'})])
        due = self.checkpoint_due('shadow')
        core = self.core('shadow', [('start-run', due), ('observe', self.observed(due)),
            ('checkpoint', self.evaluation('shadow')), ('advance', self.pending('shadow'))])
        report = self.run_live()
        self.assertEqual(report['rendezvous']['run_id'], 'shadow')
        self.assertEqual([c[0] for c in core.calls], ['start-run', 'observe', 'checkpoint', 'advance'])
        self.assertIsNone(report['runs'][1]['acknowledged'])
        self.assertIsNone(report['runs'][1]['observed_correction'])

    def test_all_host_finished_still_requires_independent_grading(self):
        for mode in self.roots:
            self.core(mode, [('start-run', {'kind': 'arm_finished', 'run_id': mode})])
        report = self.run_live()
        self.assertEqual(report['status'], 'incomplete')
        self.assertEqual(report['host_status'], 'finished')
        self.assertEqual(report['incomplete_runs'], 3)
        self.assertEqual(report['completed_runs'], 0)
        self.assertTrue(all(run['status'] == 'incomplete' and run['correctness'] is None for run in report['runs']))
        self.assertEqual(report['promotion_records'], [])

    def test_awaiting_permit_preserves_remaining_arms(self):
        self.core('off', [('start-run', {'kind': 'arm_finished', 'run_id': 'off'})])
        self.core('shadow', [('start-run', {'kind': 'arm_finished', 'run_id': 'shadow'})])
        core = self.core('advisory', [('start-run', {'kind': 'awaiting_permit', 'run_id': 'advisory'})])
        report = self.run_live()
        self.assertEqual(report['rendezvous'], {'kind': 'awaiting_permit', 'experiment_id': self.plan['experiment_id'], 'run_id': 'advisory'})
        self.assertEqual(len(core.calls), 1)

    def test_stopped_reason_and_unstarted_arms_survive(self):
        self.core('off', [('start-run', {'kind': 'arm_stopped', 'run_id': 'off', 'code': 'runtime_changed'})])
        report = self.run_live()
        self.assertEqual(report['status'], 'stopped')
        self.assertEqual(report['rendezvous']['reason'], 'runtime_changed')
        self.assertEqual([r['host_status'] for r in report['runs']], ['stopped', 'not_started', 'not_started'])

    def test_lost_output_is_uncertain_without_retry_or_fabricated_step(self):
        core = self.core('off', [('start-run', native.Failure('uncertain_output', 'synthetic lost stdout', 4))])
        report = self.run_live()
        self.assertEqual(report['status'], 'uncertain')
        self.assertIsNone(report['rendezvous'])
        self.assertEqual(report['uncertainty']['code'], 'uncertain_output')
        self.assertEqual(len(core.calls), 1)

    def test_no_advice_null_completion_is_preserved_and_never_evaluated(self):
        due = self.checkpoint_due('off')
        refusal = {'kind': 'no_advice', 'code': 'stale_revision', 'completion': None}
        core = self.core('off', [('start-run', due), ('observe', refusal)])
        report = self.run_live()
        self.assertEqual(report['status'], 'stopped')
        self.assertEqual(report['runs'][0]['checkpoints'], [{'boundary': refusal, 'evaluation': None}])
        self.assertEqual(report['runs'][0]['core_result'], refusal)
        self.assertEqual(len(core.calls), 2)

    def test_wrong_origin_core_refusal_is_forwarded_without_host_result_synthesis(self):
        refusal = {'kind': 'arm_stopped', 'run_id': 'off', 'code': 'origin_mismatch'}
        core = self.core('off', [('start-run', refusal)])
        report = self.run_live()
        self.assertEqual(report['runs'][0]['core_result'], refusal)
        self.assertEqual(report['rendezvous']['reason'], 'origin_mismatch')
        self.assertEqual([call[0] for call in core.calls], ['start-run'])

    def test_pending_request_uses_existing_wrong_origin_normalization_rejection(self):
        pending = self.pending(kind='await_boundary')
        self.core('off', [('start-run', pending)])
        forwarded = self.run_live()['rendezvous']['operation']
        marker = boundary()
        marker['run_id'] = 'off'
        observed = observation({'kind': 'completion', 'source': 'native_completion_notification',
            'origin': child('/root/wrong-origin'), 'marker': marker})
        previous = pathlib.Path.cwd()
        try:
            os.chdir(self.roots['off'])
            evidence = native.write_observation(observed, 'synthetic-wrong-origin.json')
            with self.assertRaises(native.Failure) as failure:
                native.normalize_event(forwarded, observed, evidence)
        finally:
            os.chdir(previous)
        self.assertEqual(failure.exception.code, 'origin_mismatch')
        self.assertEqual(forwarded, pending['request'])

    def test_no_advice_completion_is_retained_verbatim_without_consuming(self):
        due = self.checkpoint_due('off')
        completion = {'run_id': 'off', 'checkpoint_id': 'checkpoint-1', 'request_id': 'request-1',
            'wake_nonce': 'a' * 32, 'refusal_nonce': 'b' * 32, 'refusal_sha256': 'c' * 64,
            'code': 'stale_revision'}
        refusal = {'kind': 'no_advice', 'code': 'stale_revision', 'completion': completion}
        core = self.core('off', [('start-run', due), ('observe', refusal)])
        report = self.run_live()
        self.assertEqual(report['runs'][0]['core_result'], refusal)
        self.assertIsNone(report['runs'][0]['acknowledged'])
        self.assertIsNone(report['runs'][0]['observed_correction'])
        self.assertEqual([call[0] for call in core.calls], ['start-run', 'observe'])

    def test_checkpoint_loss_after_observe_does_not_retry_or_report_no_advice(self):
        due = self.checkpoint_due('off')
        core = self.core('off', [('start-run', due), ('observe', self.observed(due)),
            ('checkpoint', native.Failure('uncertain_output', 'synthetic lost checkpoint stdout', 4))])
        report = self.run_live()
        self.assertEqual(report['status'], 'uncertain')
        self.assertIsNone(report['rendezvous'])
        self.assertIsNone(report['runs'][0]['core_result'])
        self.assertEqual([call[0] for call in core.calls], ['start-run', 'observe', 'checkpoint'])

    def test_repeated_checkpoint_is_uncertain_before_another_observe(self):
        due = self.checkpoint_due('off')
        core = self.core('off', [('start-run', due), ('observe', self.observed(due)),
            ('checkpoint', self.evaluation('off')), ('advance', due)])
        report = self.run_live()
        self.assertEqual(report['status'], 'uncertain')
        self.assertEqual([call[0] for call in core.calls].count('observe'), 1)

    def test_wrong_boundary_event_is_rejected_before_provider_evaluation(self):
        due = self.checkpoint_due('off')
        observed = self.observed(due)
        observed['event']['run_id'] = 'other'
        core = self.core('off', [('start-run', due), ('observe', observed)])
        self.assertEqual(self.run_live()['status'], 'uncertain')
        self.assertEqual([call[0] for call in core.calls], ['start-run', 'observe'])

    def test_wrong_frozen_evaluation_identity_never_advances(self):
        due = self.checkpoint_due('off')
        evaluation = self.evaluation('off')
        evaluation['execution']['native_plan_sha256'] = 'f' * 64
        core = self.core('off', [('start-run', due), ('observe', self.observed(due)), ('checkpoint', evaluation)])
        self.assertEqual(self.run_live()['status'], 'uncertain')
        self.assertEqual([call[0] for call in core.calls], ['start-run', 'observe', 'checkpoint'])

    def test_non_advisory_wake_is_never_forwarded(self):
        self.core('off', [('start-run', self.pending(kind='wake_worker'))])
        report = self.run_live()
        self.assertEqual(report['status'], 'uncertain')
        self.assertIsNone(report['rendezvous'])

    def test_missing_or_overlapping_root_mappings_fail_before_dispatch(self):
        self.roots['shadow'] = self.roots['off']
        with self.assertRaises(ValueError):
            self.run_live()
        del self.roots['shadow']
        with self.assertRaises(ValueError):
            self.run_live()

    def test_windows_short_roots_use_canonical_identity(self):
        roots = {mode: pathlib.PureWindowsPath('C:/Fixture/WORKSP~1/Temp') / mode for mode in self.roots}
        with windows_filesystem(self.roots):
            frozen = runner.freeze_inputs('protocol.json', 'plan.json', roots)[2]
        self.assertEqual(frozen, {mode: pathlib.PureWindowsPath('C:/Fixture/workspace/Temp') / mode
            for mode in self.roots})

    def test_windows_aliases_cannot_hide_overlapping_roots(self):
        for other in ('C:/Fixture/workspace/Temp/off', 'C:/Fixture/workspace/Temp/off/nested'):
            with self.subTest(other=other):
                roots = {mode: pathlib.PureWindowsPath('C:/Fixture/WORKSP~1/Temp') / mode for mode in self.roots}
                roots['shadow'] = pathlib.PureWindowsPath(other)
                with windows_filesystem(self.roots), self.assertRaisesRegex(ValueError, 'disjoint'):
                    runner.freeze_inputs('protocol.json', 'plan.json', roots)

    def test_windows_reparse_roots_ancestors_and_inputs_are_rejected(self):
        roots = {mode: pathlib.PureWindowsPath('C:/Fixture/workspace/Temp') / mode for mode in self.roots}
        for path in (roots['off'], roots['off'].parent, roots['off'] / 'project.bla', roots['off'] / 'workspace'):
            with self.subTest(path=path), windows_filesystem(self.roots, {path: stat.FILE_ATTRIBUTE_REPARSE_POINT}):
                with self.assertRaisesRegex(ValueError, 'symlink|reparse'):
                    runner.freeze_inputs('protocol.json', 'plan.json', roots)

    def test_relative_traversing_and_symlinked_roots_are_rejected(self):
        original = self.roots['off']
        link = self.root / 'linked'
        link.symlink_to(original, target_is_directory=True)
        for root in (pathlib.Path('off'), original / '..' / 'off', link, link / 'workspace'):
            with self.subTest(root=root), self.assertRaisesRegex(ValueError, 'absolute nonsymlink'):
                runner.freeze_inputs('protocol.json', 'plan.json', dict(self.roots, off=root))

    def test_relative_input_traversal_is_rejected_before_dispatch(self):
        with self.assertRaises(native.Failure):
            runner.live_native('../protocol.json', 'plan.json', self.roots)

    def test_absolute_input_paths_are_not_reinterpreted_across_roots(self):
        with self.assertRaises(native.Failure):
            runner.live_native(self.roots['off'] / 'protocol.json', 'plan.json', self.roots)

    def test_malformed_core_success_is_uncertain(self):
        self.core('off', [('start-run', {'kind': 'pending'})])
        report = self.run_live()
        self.assertEqual(report['status'], 'uncertain')
        self.assertIsNone(report['rendezvous'])

    def test_wrong_run_pending_is_not_forwarded_to_host(self):
        self.core('off', [('start-run', self.pending('advisory'))])
        report = self.run_live()
        self.assertEqual(report['status'], 'uncertain')
        self.assertIsNone(report['rendezvous'])

    def test_mismatched_project_copies_are_rejected_before_calls(self):
        save(self.roots['shadow'] / 'plan.json', dict(self.plan, experiment_id='changed'))
        with self.assertRaises((ValueError, native.Failure)):
            self.run_live()
        self.assertEqual(self.cores, {})

    def test_changed_config_is_rejected_before_calls(self):
        save(self.roots['shadow'] / 'configs/shadow.json', {'mode': 'advisory'})
        with self.assertRaises((ValueError, native.Failure)):
            self.run_live()

    def test_exact_roots_required_and_symlink_input_rejected(self):
        original = self.roots['off'] / 'plan.json'
        original.rename(original.with_suffix('.saved'))
        original.symlink_to(original.with_suffix('.saved').name)
        with self.assertRaises((ValueError, native.Failure)):
            self.run_live()


if __name__ == '__main__':
    unittest.main()
