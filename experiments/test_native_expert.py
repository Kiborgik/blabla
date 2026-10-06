import copy
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
HELPER = ROOT / 'adapters/native/expert.py'


def load_helper():
    if not HELPER.exists():
        return None
    spec = importlib.util.spec_from_file_location('native_expert', HELPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


native = load_helper()


def child(name='/root/native_fixture'):
    return {'agent_id': None, 'task_name': name}


def host_request(kind='wake_worker'):
    key = {'run_id': 'run-1', 'task': 'task::fixture', 'acceptance_epoch': 1,
           'child': child(), 'generation': 1, 'checkpoint_id': 'checkpoint-1',
           'sequence': 1, 'previous_sequence': 0, 'boundary_nonce': 'a' * 32,
           'assignment_revision': {'acceptance_epoch': 1, 'task_digest': 'revision-1',
                                   'paths': {}, 'identities': {}}}
    payload = {'kind': kind}
    if kind == 'wake_worker':
        payload['wake'] = {'kind': 'blabla_native_wake', 'schema_version': 1, 'run_id': 'run-1',
                           'checkpoint_id': 'checkpoint-1', 'wake_nonce': 'b' * 32}
    if kind == 'continue_work':
        payload.update(brief='Finish the bounded task.', brief_sha256='c' * 64)
    if kind == 'await_boundary':
        payload['expected_nonce'] = 'a' * 32
    return {'schema_version': 1, 'operation_id': 'op-1', 'key': key,
            'created': {'boot_id': 'boot-1', 'boottime_ms': 1000, 'unix_ms': 10000},
            'deadline_boottime_ms': 2000, 'payload': payload}


def observation(projection):
    return {'kind': 'native_tool_observation', 'schema_version': 1, 'record_id': 'record-1',
            'coordinator': child('/root'), 'capture_session': 'e' * 32, 'local_sequence': 1,
            'operation_id': 'op-1', 'attestation': 'coordinator_observed_native_surface',
            'projection': projection}


def boundary():
    return {'kind': 'blabla_native_boundary', 'schema_version': 1, 'run_id': 'run-1',
            'task': 'task::fixture', 'acceptance_epoch': 1, 'child_attestation': child(),
            'generation': 1, 'sequence': 2, 'boundary_nonce': 'a' * 32,
            'capture_id': 'capture-1', 'capture_sha256': 'f' * 64}


def consumed_result():
    return {'kind': 'consumed', 'checkpoint': {'key': host_request()['key'], 'selected': []},
            'request_id': 'request-1', 'idempotency_key': 'suppression-1',
            'consume_nonce': 'a' * 32, 'result_sha256': 'b' * 64,
            'result': {'request_id': 'request-1', 'packet_hash': 'packet-1', 'outcome': 'nudge',
                       'references': ['task::fixture'], 'template': 'cite_evidence',
                       'message': 'Check current evidence.', 'reason': 'unsupported_claim'},
            'authority': {'kind': 'experimental', 'run_id': 'run-1', 'permit_id': 'permit-1',
                          'permit_sha256': 'c' * 64}}


class NativeEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(hasattr(native, 'normalize_event'), 'native observation normalizer is missing')
        self.temporary = tempfile.TemporaryDirectory()
        previous = pathlib.Path.cwd()
        self.addCleanup(self.temporary.cleanup)
        self.addCleanup(os.chdir, previous)
        os.chdir(self.temporary.name)

    def normalize(self, request, projected):
        observed = observation(projected)
        evidence = native.write_observation(observed, 'record.json')
        return native.normalize_event(request, observed, evidence)

    def test_matching_observed_origin_yields_boundary_with_null_agent_id(self):
        request = host_request('await_boundary')
        marker = boundary()
        result = self.normalize(request, {'kind': 'completion', 'source': 'native_completion_notification',
                                         'origin': child(), 'marker': marker})
        self.assertEqual(result['payload'], {'kind': 'boundary_returned', 'origin': child(), 'marker': marker})
        self.assertEqual(result['key'], request['key'])

    def test_worker_attestation_cannot_override_wrong_native_origin(self):
        with self.assertRaises(native.Failure) as failure:
            self.normalize(host_request('await_boundary'), {'kind': 'completion',
                'source': 'native_completion_notification', 'origin': child('/root/other'), 'marker': boundary()})
        self.assertEqual(failure.exception.code, 'origin_mismatch')

    def test_missing_source_id_is_correlated_without_fabricating_evidence(self):
        request = host_request('await_boundary')
        request['key']['child']['agent_id'] = 'observed-spawn-id'
        marker = boundary()
        marker['child_attestation'] = request['key']['child']
        projected = {'kind': 'completion', 'source': 'native_completion_notification',
                     'origin': child(), 'marker': marker}
        result = self.normalize(request, projected)
        self.assertEqual(result['payload']['origin'], request['key']['child'])
        self.assertIsNone(projected['origin']['agent_id'])
        observed = observation(copy.deepcopy(projected))
        observed['projection']['origin']['agent_id'] = 'conflicting-id'
        evidence = native.write_observation(observed, 'conflicting.json')
        with self.assertRaises(native.Failure) as failure:
            native.normalize_event(request, observed, evidence)
        self.assertEqual(failure.exception.code, 'origin_mismatch')

    def test_wrong_task_epoch_or_generation_rejected_before_core_result(self):
        for field, value, code in (('task', 'task::other', 'identity_mismatch'),
                                   ('acceptance_epoch', 2, 'epoch_mismatch'),
                                   ('generation', 2, 'generation_mismatch')):
            with self.subTest(field=field):
                marker = boundary()
                marker[field] = value
                observed = observation({'kind': 'completion', 'source': 'native_completion_notification',
                                        'origin': child(), 'marker': marker})
                evidence = native.write_observation(observed, field + '.json')
                with self.assertRaises(native.Failure) as failure:
                    native.normalize_event(host_request('await_boundary'), observed, evidence)
                self.assertEqual(failure.exception.code, code)

    def test_unknown_followup_never_becomes_transport_accepted(self):
        request = host_request()
        result = self.normalize(request, {'kind': 'followup', 'tool': 'collaboration.followup_task',
            'target_task_name': child()['task_name'], 'sent': {'kind': 'wake', 'message': request['payload']['wake']},
            'outcome': 'unknown'})
        self.assertEqual(result['payload'], {'kind': 'unknown', 'reason': 'missing_result'})

    def test_actual_followup_identity_only_yields_transport_acceptance(self):
        request = host_request('continue_work')
        call = native.host_call(request)
        projected = {'kind': 'followup', 'tool': 'collaboration.followup_task',
            'target_task_name': child()['task_name'], 'sent': {'kind': 'work',
                'message_sha256': hashlib.sha256(call['arguments']['message'].encode()).hexdigest()},
            'outcome': 'returned_without_error'}
        result = self.normalize(request, projected)
        self.assertEqual(result['payload'], {'kind': 'continuation_accepted', 'child': child()})
        self.assertEqual(result['request_sha256'], hashlib.sha256(native.encode(request)).hexdigest())
        observed = observation(copy.deepcopy(projected))
        observed['projection']['sent']['message_sha256'] = '0' * 64
        evidence = native.write_observation(observed, 'wrong-message.json')
        with self.assertRaises(native.Failure):
            native.normalize_event(request, observed, evidence)

    def test_completed_status_is_only_request_bound_idle_candidate(self):
        request = host_request('inspect_child')
        marker = boundary()
        marker['sequence'] = request['key']['sequence']
        result = self.normalize(request, {'kind': 'status', 'tool': 'collaboration.list_agents',
            'path_prefix': child()['task_name'], 'selected': {'kind': 'completed',
                'agent_name': child()['task_name'], 'agent_id': None, 'marker': marker}})
        self.assertEqual(result['payload'], {'kind': 'child_status', 'child': child(), 'status': 'idle'})

    def test_wait_summary_does_not_establish_completion(self):
        result = self.normalize(host_request('await_boundary'), {'kind': 'unavailable',
            'source': 'collaboration.wait_agent', 'reason': 'missing_result'})
        self.assertEqual(result['payload'], {'kind': 'unknown', 'reason': 'missing_result'})

    def test_no_call_and_wrong_operation_remain_distinct(self):
        request = host_request()
        projected = {'kind': 'not_invoked', 'tool': 'collaboration.followup_task',
                     'reason': 'cancelled_before_call'}
        result = self.normalize(request, projected)
        self.assertEqual(result['payload'], {'kind': 'not_invoked', 'reason': 'cancelled_before_call'})
        observed = observation(projected)
        observed['operation_id'] = None
        evidence = native.write_observation(observed, 'bootstrap.json')
        with self.assertRaises(native.Failure):
            native.normalize_event(request, observed, evidence)

    def test_no_advice_response_is_preserved_without_acknowledgment(self):
        completion = {'run_id': 'run-1', 'checkpoint_id': 'checkpoint-1', 'request_id': 'request-1',
                      'wake_nonce': 'a' * 32, 'refusal_nonce': 'c' * 32, 'refusal_sha256': 'd' * 64,
                      'code': 'stale_revision'}
        response = {'kind': 'blabla_native_no_advice', 'schema_version': 1,
                    'completion': completion, 'child_attestation': child()}
        result = self.normalize(host_request('await_boundary'), {'kind': 'completion',
            'source': 'native_completion_notification', 'origin': child(), 'marker': response})
        self.assertEqual(result['payload'], {'kind': 'worker_response', 'origin': child(), 'response': response})
        self.assertNotIn('disposition', result['payload']['response'])

    def test_evidence_is_create_only_and_bound_to_saved_bytes(self):
        observed = observation({'kind': 'unavailable', 'source': 'collaboration.followup_task', 'reason': 'missing_result'})
        evidence = native.write_observation(observed, 'record.json')
        self.assertTrue(pathlib.Path('record.json').read_bytes().endswith(b'\n'))
        with self.assertRaises(native.Failure):
            native.write_observation(observed, 'record.json')
        changed = copy.deepcopy(observed)
        changed['projection']['reason'] = 'tool_error'
        with self.assertRaises(native.Failure):
            native.normalize_event(host_request(), changed, evidence)
        pathlib.Path('record.json').write_bytes(b'{}')
        with self.assertRaises(native.Failure):
            native.normalize_event(host_request(), observed, evidence)
        for path in ('../escape.json', '/tmp/escape.json', 'a/../b.json'):
            with self.subTest(path=path), self.assertRaises(native.Failure):
                native.write_observation(observed, path)

    @unittest.skipUnless(os.name == 'posix', 'POSIX symlink and descriptor path traversal')
    def test_evidence_rejects_symlink_in_parent_or_final_component(self):
        observed = observation({'kind': 'unavailable', 'source': 'collaboration.followup_task', 'reason': 'missing_result'})
        native.write_observation(observed, 'actual.json')
        pathlib.Path('linked.json').symlink_to('actual.json')
        evidence = {'id': observed['record_id'], 'path': 'linked.json',
                    'sha256': hashlib.sha256(pathlib.Path('actual.json').read_bytes()).hexdigest()}
        with self.assertRaises(native.Failure):
            native.normalize_event(host_request(), observed, evidence)
        pathlib.Path('linked-parent').symlink_to('.', target_is_directory=True)
        with self.assertRaises(native.Failure):
            native.write_observation(observed, 'linked-parent/new.json')
        self.assertFalse(pathlib.Path('new.json').exists())

    def test_unknown_projection_fields_and_claimed_host_facts_are_rejected(self):
        observed = observation({'kind': 'completion', 'source': 'native_completion_notification',
                                'origin': child(), 'marker': boundary()})
        observed['projection']['marker']['fact'] = {'verified': True}
        with self.assertRaises(native.Failure):
            native.write_observation(observed, 'record.json')
        observed = observation({'kind': 'unavailable', 'source': 'collaboration.followup_task', 'reason': 'missing_result'})
        observed['coordinator']['agent_id'] = False
        with self.assertRaises(native.Failure):
            native.write_observation(observed, 'record.json')

    def test_probe_challenge_is_fresh_and_not_a_core_nonce_constructor(self):
        first = native.new_probe_challenge('proof-1', child('/root'))
        second = native.new_probe_challenge('proof-1', child('/root'))
        self.assertEqual(set(first), {'kind', 'schema_version', 'proof_id', 'coordinator', 'capture_session', 'nonce'})
        self.assertEqual(first['kind'], 'native_probe_challenge')
        self.assertEqual(len({first['capture_session'], first['nonce'], second['capture_session'], second['nonce']}), 4)

    def test_tool_surface_must_equal_literal_current_contract(self):
        observed = observation({'kind': 'tool_surface', 'source': 'exposed_tool_contract',
                                'surface': copy.deepcopy(native.TOOL_SURFACE)})
        observed['operation_id'] = None
        native.write_observation(observed, 'surface.json')
        observed['projection']['surface']['followup_task']['optional'].append('expected_turn')
        with self.assertRaises(native.Failure) as failure:
            native.write_observation(observed, 'changed.json')
        self.assertEqual(failure.exception.code, 'unsupported_capability')


class NativeHostProjectionTests(unittest.TestCase):
    def test_wake_is_exact_request_only_message(self):
        self.assertTrue(hasattr(native, 'host_call'), 'host call projection is missing')
        request = host_request()
        call = native.host_call(request)
        self.assertEqual(call['tool'], 'collaboration.followup_task')
        self.assertEqual(call['arguments']['target'], child()['task_name'])
        self.assertEqual(json.loads(call['arguments']['message']), request['payload']['wake'])
        request['payload']['wake']['advice'] = 'secret template'
        with self.assertRaises(native.Failure):
            native.host_call(request)

    def test_work_and_inspection_target_observed_native_task_name(self):
        self.assertTrue(hasattr(native, 'host_call'), 'host call projection is missing')
        request = host_request('continue_work')
        call = native.host_call(request)
        message = json.loads(call['arguments']['message'])
        self.assertEqual(message, {'kind': 'blabla_native_work', 'schema_version': 1,
                                  'key': request['key'], 'brief': request['payload']['brief'],
                                  'brief_sha256': request['payload']['brief_sha256']})
        self.assertEqual(native.host_call(host_request('inspect_child')),
                         {'tool': 'collaboration.list_agents', 'arguments': {'path_prefix': child()['task_name']}})

    def test_invalid_versions_boolean_epoch_and_unknown_actions_fail_closed(self):
        self.assertTrue(hasattr(native, 'host_call'), 'host call projection is missing')
        for field, value in (('schema_version', True), ('schema_version', 2), ('surprise', 1)):
            request = host_request()
            request[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(native.Failure):
                native.host_call(request)
        request = host_request()
        request['key']['acceptance_epoch'] = True
        with self.assertRaises(native.Failure):
            native.host_call(request)
        with self.assertRaises(native.Failure):
            native.host_call(host_request('invented_send'))


class NativeTransportTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(native, 'native host helper has not been implemented')

    def test_strict_utf8_json_and_resource_bound(self):
        self.assertEqual(native.decode(b'{"schema_version":1}'), {'schema_version': 1})
        for raw in (b'{"x":1,"x":2}', b'{"x":NaN}', b'{} {}', b'```json\n{}\n```',
                    b'{"x":"\xff"}', b' ' * 65537):
            with self.subTest(raw=raw[:30]), self.assertRaises(native.Failure):
                native.decode(raw)

    def test_repository_dispatch_is_source_cargo_with_explicit_argv(self):
        observed = []
        def exchange(argv, cwd, timeout):
            observed.append((argv, cwd, timeout))
            request = pathlib.Path(argv[argv.index('--request') + 1])
            self.assertEqual(native.decode(request.read_bytes()), {'schema_version': 1, 'kind': 'advance'})
            return b'{"kind":"arm_finished","run_id":"run-1"}'
        core = native.CoreCLI(project=ROOT)
        with patch.object(native, 'exchange', exchange):
            self.assertEqual(core.invoke('advance', {'schema_version': 1, 'kind': 'advance'})['kind'], 'arm_finished')
        argv, cwd, timeout = observed[0]
        self.assertEqual(argv[:7], ['cargo', 'run', '--release', '--quiet', '--bin', 'blabla', '--'])
        self.assertEqual(argv[7:10], ['expert', 'native', 'advance'])
        self.assertIn('--json', argv)
        self.assertEqual(cwd, ROOT)
        self.assertGreater(timeout, 0)
        self.assertFalse(pathlib.Path(argv[argv.index('--request') + 1]).exists())
        with self.assertRaises(native.Failure):
            native.CoreCLI(project=ROOT, blabla_argv=['blabla'])

    def test_explicit_source_profiles_keep_the_source_execution_boundary(self):
        release = ['cargo', 'run', '--release', '--quiet', '--bin', 'blabla', '--']
        development = ['cargo', 'run', '--quiet', '--bin', 'blabla', '--']
        for prefix in (release, development):
            with self.subTest(prefix=prefix), patch.object(
                native, 'exchange', return_value=b'{"kind":"arm_finished","run_id":"run-1"}'
            ) as exchange:
                try:
                    core = native.CoreCLI(project=ROOT, blabla_argv=prefix)
                except native.Failure as error:
                    self.fail(f'valid current-source profile rejected: {error}')
                core.invoke('advance', {'schema_version': 1, 'kind': 'advance'})
                self.assertEqual(exchange.call_args.args[0][:len(prefix)], prefix)
        for prefix in (['target/release/blabla'], release[:-1] + ['--manifest-path', 'other/Cargo.toml', '--']):
            with self.subTest(prefix=prefix), self.assertRaises(native.Failure) as failure:
                native.CoreCLI(project=ROOT, blabla_argv=prefix)
            self.assertEqual(failure.exception.code, 'source_required')

    def test_unknown_operation_is_rejected_before_dispatch(self):
        with patch.object(native, 'exchange') as exchange:
            with self.assertRaises(native.Failure):
                native.CoreCLI(project=ROOT).invoke('promote', {})
            exchange.assert_not_called()

    def test_unrecognized_core_result_is_not_accepted_or_retried(self):
        for output in (b'[]', b'{"kind":"delivered"}', b'{"kind":"claimed"}'):
            with self.subTest(output=output), patch.object(native, 'exchange', return_value=output) as exchange:
                with self.assertRaises(native.Failure) as failure:
                    native.CoreCLI(project=ROOT).invoke('advance', {})
                self.assertEqual(failure.exception.exit_code, 4)
                self.assertEqual(exchange.call_count, 1)

    def test_zero_exit_empty_malformed_or_truncated_consume_output_is_uncertain(self):
        for output in (b'', b'not-json', b'{"kind":"consumed"'):
            with self.subTest(output=output), patch.object(native, 'exchange', return_value=output) as exchange:
                with self.assertRaises(native.Failure) as failure:
                    native.CoreCLI(project=ROOT).invoke('consume', {})
                self.assertEqual(failure.exception.exit_code, 4)
                self.assertEqual(exchange.call_count, 1)

    def test_allowed_result_tag_requires_complete_closed_payload(self):
        missing = consumed_result()
        del missing['consume_nonce']
        unknown = consumed_result()
        unknown['result']['unrecognized'] = True
        cases = [('consume', {'kind': 'consumed'}), ('consume', missing), ('consume', unknown),
                 ('host-claim', {'kind': 'claimed'}),
                 ('host-claim', {'kind': 'claimed', 'operation_id': 'op-1', 'unrecognized': True})]
        for operation, result in cases:
            with self.subTest(operation=operation, result=result), patch.object(native, 'exchange', return_value=native.encode(result)) as exchange:
                with self.assertRaises(native.Failure) as failure:
                    native.CoreCLI(project=ROOT).invoke(operation, {})
                self.assertEqual(failure.exception.exit_code, 4)
                self.assertEqual(exchange.call_count, 1)
        result = consumed_result()
        with patch.object(native, 'exchange', return_value=native.encode(result)):
            self.assertEqual(native.CoreCLI(project=ROOT).invoke('consume', {}), result)

    def test_malformed_caller_input_is_still_exit_two_before_dispatch(self):
        with patch.object(native, 'exchange') as exchange:
            for request in ([], {'bad': float('nan')}):
                with self.subTest(request=request), self.assertRaises(native.Failure) as failure:
                    native.CoreCLI(project=ROOT).invoke('consume', request)
                self.assertEqual(failure.exception.exit_code, 2)
            exchange.assert_not_called()

    def test_installed_argv_is_a_string_array_and_malformed_cli_fails_cleanly(self):
        with patch.object(native, 'SOURCE_ROOT', None):
            self.assertEqual(native.CoreCLI(project=ROOT, blabla_argv=['blabla', '--verbose']).argv,
                             ['blabla', '--verbose'])
            with self.assertRaises(native.Failure):
                native.CoreCLI(project=ROOT, blabla_argv={'blabla': True})
        result = subprocess.run([sys.executable, str(HELPER), '--blabla-argv', '[broken',
                                 'host-next', '--run', 'run-1'], capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stderr)['code'], 'malformed')

    def test_checkpoint_and_receipt_preserve_core_outcomes(self):
        operations = []
        completion = {'refusal_nonce': 'b' * 32, 'code': 'stale_revision'}
        class Core:
            def invoke(self, operation, request):
                operations.append((operation, request))
                return {'kind': 'no_advice', 'code': 'stale_revision', 'completion': completion}
        request = {'schema_version': 1, 'kind': 'observe'}
        self.assertEqual(native.handle_checkpoint(Core(), request), {
            'boundary': {'kind': 'no_advice', 'code': 'stale_revision', 'completion': completion},
            'evaluation': None})
        response = {'schema_version': 1, 'kind': 'record_response'}
        self.assertEqual(native.record_receipt(Core(), response)['completion'], completion)
        self.assertEqual(operations, [('observe', request), ('record-response', response)])

    def test_checkpoint_uses_only_core_returned_empty_event(self):
        event = {'task': 'task::fixture', 'observations': []}
        boundary = {'kind': 'boundary_observed', 'checkpoint': {}, 'event': event}
        class Core:
            def invoke(self, operation, request):
                return boundary
            def checkpoint(self, run_id, captured):
                self.captured = (run_id, captured)
                return {'results': []}
        core = Core()
        self.assertEqual(native.handle_checkpoint(core, {'key': {'run_id': 'run-1'}}),
                         {'boundary': boundary, 'evaluation': {'results': []}})
        self.assertEqual(core.captured, ('run-1', event))

    def test_core_state_is_reconsulted_after_duplicate_and_restart(self):
        results = [b'{"kind":"claimed","operation_id":"op-1"}',
                   b'{"kind":"refused","code":"already_claimed"}']
        with patch.object(native, 'exchange', side_effect=results) as exchange:
            first = native.CoreCLI(project=ROOT).invoke('host-claim', {})
            second = native.CoreCLI(project=ROOT).invoke('host-claim', {})
        self.assertEqual(first['kind'], 'claimed')
        self.assertEqual(second, {'kind': 'refused', 'code': 'already_claimed'})
        self.assertEqual(exchange.call_count, 2)

    def test_uncertain_dispatch_is_never_retried(self):
        with patch.object(native, 'exchange', side_effect=native.Failure('io', 'lost output', 4)) as exchange:
            with self.assertRaises(native.Failure):
                native.CoreCLI(project=ROOT).invoke('consume', {})
            self.assertEqual(exchange.call_count, 1)

    def test_actual_subprocess_bounds_stdout_and_reaps_timeout(self):
        with self.assertRaises(native.Failure):
            native.exchange([sys.executable, '-c', 'print("x" * 65537)'], ROOT, 5)
        with self.assertRaises(native.Failure):
            native.exchange([sys.executable, '-c', 'import time; time.sleep(10)'], ROOT, .05)
        self.assertEqual(native.decode(native.exchange([sys.executable, '-c', 'print("{}")'], ROOT, 5)), {})

    def test_core_rejection_keeps_bounded_diagnostic(self):
        with self.assertRaises(native.Failure) as failure:
            native.exchange([sys.executable, '-c',
                             'import sys; print("native route unavailable", file=sys.stderr); sys.exit(2)'], ROOT, 5)
        self.assertEqual(failure.exception.exit_code, 2)
        self.assertIn('native route unavailable', str(failure.exception))


if __name__ == '__main__':
    unittest.main()
