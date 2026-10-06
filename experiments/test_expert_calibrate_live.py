import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import expert_eval as evaluator


SOURCE = Path(__file__).with_name('expert_calibrate_live.py')
SPEC = importlib.util.spec_from_file_location('expert_calibrate_live', SOURCE) if SOURCE.exists() else None
LIVE = importlib.util.module_from_spec(SPEC) if SPEC else None
if SPEC:
    SPEC.loader.exec_module(LIVE)


class CalibrationCollectorTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(LIVE, 'real calibration collector is absent')
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.provider = {'provider': 'synthetic-test', 'model': 'not-real', 'checkpoint': 'test-only',
                         'supported_outputs': ['choice'], 'probabilities': True, 'certification': None}
        self.requests = [self.request('request-' + str(index)) for index in range(2)]
        self.cases = [{'case_id': 'case-' + str(index), 'family': 'goal-drift',
                       'input': {'synthetic': index},
                       'snapshot_fingerprint': evaluator.fingerprint({'synthetic': index}),
                       'gold': {'justified_nudge': True, 'acceptable_reference_sets': [['goal::synthetic']]}}
                      for index in range(2)]
        self.manifest = {'kind': 'real_calibration_requests', 'schema_version': 1,
                         'development_manifest_sha256': '', 'requests_jsonl': {},
                         'cases': [{'case_id': case['case_id'], 'group_id': 'group',
                                    'primary_request_id': request['request_id'], 'selection_request_id': None,
                                    'gold': case['gold']} for case, request in zip(self.cases, self.requests)]}
        self.policy = {'synthetic': 'settings-owned-by-core'}
        self.plan = {'kind': 'typed_development_fit_plan', 'schema_version': 1,
                     'protocol_sha256': '', 'development_manifest_sha256': '',
                     'holdout_manifest_sha256': 'f' * 64, 'request_manifest_sha256': '',
                     'provider': self.provider, 'limits': {'retries': 0, 'concurrency': 1,
                     'request_timeout_ms': 1000}, 'groups': [{'group_id': 'group', 'family': 'goal-drift',
                     'primary_binding': 'binding::goal-alignment', 'selection_binding': None,
                     'candidates': [{'candidate_id': 'only', 'primary': self.policy, 'selection': None}],
                     'objective': {'synthetic': 'core validates this'}}]}
        self.protocol = evaluator.read_json(evaluator.DEFAULT_DATA / 'protocol.json')
        self.protocol['datasets']['holdout']['manifest_sha256'] = self.plan['holdout_manifest_sha256']
        self.config = {'mode': 'shadow', 'provider': {'identity': self.provider, 'argv': ['never-run-provider']},
                       'host': None, 'policies': [], 'limits': self.plan['limits'],
                       'trace_limits': {}, 'promotions': []}
        self.paths = {key: self.root / name for key, name in (
            ('protocol', 'protocol.json'), ('development', 'development'), ('requests', 'manifest.json'),
            ('plan', 'plan.json'), ('config', 'config.json'), ('output', 'real.json'))}
        self.paths['development'].mkdir()
        self.write_inputs()
        self.calls = []
        self.answers = [self.evaluated(request) for request in self.requests]
        self.preflight_error = False
        self.fit_error = False
        self.fit_status = 'eligible'
        self.after_evaluate = None

    def request(self, request_id):
        return {'request_id': request_id, 'packet': {'hash': 'synthetic-packet-' + request_id,
                'references': {'goal::synthetic': {}}, 'revision': {'paths': {'absent.txt': None}}}, 'judgment': {},
                'question_fingerprint': 'synthetic-question', 'template_fingerprint': 'synthetic-template'}

    def put(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False) + '\n', encoding='utf-8')

    def reference(self, path, identity):
        return {'id': identity, 'path': str(path.relative_to(self.root)), 'sha256': evaluator.file_hash(path)}

    def write_inputs(self, observations=b''):
        development = self.paths['development']
        (development / 'cases.jsonl').write_text(''.join(json.dumps(case) + '\n' for case in self.cases))
        (development / 'observations.jsonl').write_bytes(observations)
        self.put(development / 'manifest.json', {'schema_version': 1, 'split': 'development',
                 'evidence_kind': 'synthetic-inputs-independent-gold', 'label_author': 'synthetic-test',
                 'count': len(self.cases), 'files': {name: evaluator.file_hash(development / name)
                 for name in ('cases.jsonl', 'observations.jsonl')},
                 'case_ids': [case['case_id'] for case in self.cases]})
        development_sha = evaluator.file_hash(development / 'manifest.json')
        self.protocol['datasets']['development']['manifest_sha256'] = development_sha
        self.put(self.paths['protocol'], self.protocol)
        requests_path = self.root / 'requests.jsonl'
        requests_path.write_text(''.join(json.dumps(request) + '\n' for request in self.requests))
        self.manifest['requests_jsonl'] = self.reference(requests_path, 'requests')
        self.manifest['development_manifest_sha256'] = development_sha
        self.put(self.paths['requests'], self.manifest)
        self.plan['protocol_sha256'] = evaluator.fingerprint(self.protocol)
        self.plan['development_manifest_sha256'] = development_sha
        self.plan['request_manifest_sha256'] = evaluator.fingerprint(self.manifest)
        self.put(self.paths['plan'], self.plan)
        self.put(self.paths['config'], self.config)

    def evaluated(self, request):
        response = {'request_id': request['request_id'], 'packet_hash': request['packet']['hash'],
                    'question_fingerprint': request['question_fingerprint'],
                    'template_fingerprint': request['template_fingerprint'], 'provider': self.provider,
                    'timing': {'queue_ms': 0, 'inference_ms': 1, 'total_ms': 1},
                    'usage': {'input_tokens': None, 'output_tokens': 4, 'reported_latency_ms': 1.25},
                    'provider_request_id': None, 'self_report': None, 'diagnostic': None,
                    'outcome': {'Ok': {'kind': 'choice', 'pick': 'drift',
                                      'probabilities': {'drift': .8, 'aligned': .2}, 'confidence': None}}}
        result = {'request_id': request['request_id'], 'packet_hash': request['packet']['hash'],
                  'outcome': 'abstain', 'references': [], 'template': None, 'message': None,
                  'reason': 'synthetic-provisional-result-is-not-fit'}
        return {'response': response, 'result': result, 'provenance': 'imported', 'mode': 'shadow'}

    def capture(self, stdout=b'', exit_code=0, status='completed'):
        return {'stdout': stdout, 'stderr': b'', 'exit_code': exit_code, 'status': status,
                'stdout_complete': status == 'completed', 'stderr_complete': status == 'completed',
                'stdin_complete': status == 'completed', 'elapsed_ms': 1}

    def transport(self, argv, cwd, stdin, timeout, max_bytes):
        self.calls.append((argv, stdin))
        self.assertEqual(argv[:7], ['cargo', 'run', '--release', '--quiet', '--bin', 'blabla', '--'])
        operation = argv[8]
        if operation == 'preflight-development-calibration':
            if self.preflight_error:
                return self.capture(b'{"error":"synthetic refusal"}\n', exit_code=2)
            result = {'kind': 'preflighted_development_calibration', 'schema_version': 1,
                      'protocol_sha256': evaluator.fingerprint(self.protocol),
                      'fit_plan_sha256': evaluator.fingerprint(self.plan),
                      'request_manifest_sha256': evaluator.fingerprint(self.manifest),
                      'runtime_config_sha256': evaluator.fingerprint(self.config),
                      'provider_argv_sha256': evaluator.fingerprint(self.config['provider']['argv']),
                      'development_manifest_sha256': self.plan['development_manifest_sha256'],
                      'holdout_manifest_sha256': self.plan['holdout_manifest_sha256'],
                      'request_ids': [request['request_id'] for request in self.requests],
                      'referenced_files': [self.reference(self.paths[key], key)
                                           for key in ('protocol', 'requests', 'plan', 'config')]
                                          + [self.manifest['requests_jsonl']],
                      'provider_calls': 0, 'delivery_attempts': 0}
        elif operation == 'evaluate':
            index = sum(call[0][8] == 'evaluate' for call in self.calls) - 1
            self.assertEqual(evaluator.parse_json(stdin), self.requests[index])
            answer = self.answers[index]
            if self.after_evaluate:
                self.after_evaluate()
            if isinstance(answer, bytes):
                return self.capture(answer)
            if 'stdout' in answer:
                return answer
            result = answer
        elif operation == 'fit-saved':
            self.fit_input = evaluator.read_json(Path(argv[argv.index('--input') + 1]))
            if self.fit_error:
                return self.capture(b'{"error":"synthetic refusal"}\n', exit_code=2)
            selected = self.policy if self.fit_status == 'eligible' else None
            result = {'kind': 'fitted_saved_development', 'schema_version': 1,
                      'fit_plan_sha256': evaluator.fingerprint(self.plan),
                      'request_manifest_sha256': evaluator.fingerprint(self.manifest),
                      'executions_sha256': evaluator.fingerprint(self.fit_input['executions']),
                      'groups': [{'group_id': 'group', 'selected_candidate_id': 'only' if selected else None,
                                  'selected_primary': selected, 'selected_selection': None,
                                  'status': self.fit_status, 'candidates': [{'candidate_id': 'only',
                                      'results': [{'case_id': case['case_id'],
                                                   'result': self.evaluated(request)['result']}
                                                  for case, request in zip(self.cases, self.requests)],
                                      'planned': 2, 'evaluable': 2, 'proposed': 2, 'false_proposed': 0,
                                      'justified': 2, 'missed_correct': 0, 'provider_failures': 0,
                                      'feasible': selected is not None}]}],
                      'provider_calls': 0, 'delivery_attempts': 0, 'promotion_records': []}
        else:
            self.fail('unexpected source CLI operation: ' + operation)
        return self.capture(json.dumps(result).encode() + (b'' if operation == 'fit-saved' else b'\n'))

    def collect(self, **kwargs):
        return LIVE.calibrate_live(self.paths['protocol'], self.paths['development'], self.paths['requests'],
             self.paths['plan'], self.paths['config'], self.root, self.paths['output'],
             transport=self.transport, **kwargs)

    def operations(self):
        return [call[0][8] for call in self.calls]

    def test_eligible_preserves_typed_responses_and_exact_selected_policy(self):
        result = self.collect()
        self.assertEqual(self.operations(), ['preflight-development-calibration', 'evaluate', 'evaluate', 'fit-saved'])
        self.assertEqual(result['status'], 'eligible')
        self.assertEqual(result['selected'], [self.policy])
        self.assertEqual([item['response'] for item in result['executions']],
                         [item['response'] for item in self.answers])
        self.assertEqual(result['executions'], self.fit_input['executions'])
        self.assertEqual(result['policy_sha256'], evaluator.fingerprint([self.policy]))
        self.assertEqual(evaluator.read_json(self.paths['output']), result)
        self.assertFalse((self.root / 'holdout').exists())
        with self.assertRaises((ValueError, OSError)):
            self.collect()
        self.assertEqual(len(self.calls), 4)

    def test_fit_status_preserves_all_none_and_mixed_group_selection(self):
        plan = copy.deepcopy(self.plan)
        plan['groups'] = [copy.deepcopy(plan['groups'][0]) for unused in range(2)]
        manifest = copy.deepcopy(self.manifest)
        for index, group in enumerate(plan['groups']):
            group['group_id'] = 'group-' + str(index)
            group['candidates'][0]['primary'] = {'synthetic': 'selected-policy-' + str(index)}
            manifest['cases'][index]['group_id'] = group['group_id']
        documents = {'plan': plan, 'manifest': manifest}
        executions = [{'request': request, 'response': answer['response'],
                       'command_evidence': {'id': 'synthetic', 'path': 'synthetic.json', 'sha256': 'a' * 64}}
                      for request, answer in zip(self.requests, self.answers)]
        for eligibility in ((True, True), (False, False), (True, False), (False, True)):
            with self.subTest(eligibility=eligibility):
                groups = []
                expected = []
                for index, (group, eligible) in enumerate(zip(plan['groups'], eligibility)):
                    policy = group['candidates'][0]['primary'] if eligible else None
                    if eligible:
                        expected.append(policy)
                    groups.append({'group_id': group['group_id'],
                        'selected_candidate_id': 'only' if eligible else None,
                        'selected_primary': policy, 'selected_selection': None,
                        'status': 'eligible' if eligible else 'no_feasible_candidate',
                        'candidates': [{'candidate_id': 'only',
                            'results': [{'case_id': manifest['cases'][index]['case_id'],
                                         'result': self.answers[index]['result']}],
                            'planned': 1, 'evaluable': 1, 'proposed': 1 if eligible else 0,
                            'false_proposed': 0, 'justified': 1, 'missed_correct': 0 if eligible else 1,
                            'provider_failures': 0, 'feasible': eligible}]})
                fitted = {'kind': 'fitted_saved_development', 'schema_version': 1,
                    'fit_plan_sha256': evaluator.fingerprint(plan),
                    'request_manifest_sha256': evaluator.fingerprint(manifest),
                    'executions_sha256': evaluator.fingerprint(executions), 'groups': groups,
                    'provider_calls': 0, 'delivery_attempts': 0, 'promotion_records': []}
                selected, status = LIVE.validate_fit(fitted, documents, executions)
                self.assertEqual(selected, expected)
                self.assertEqual(status, 'eligible' if expected else 'no_feasible_policy')

    def test_typed_provider_failure_is_retained_and_no_feasible_is_honest(self):
        self.answers[0]['response']['outcome'] = {'Err': 'transport'}
        self.fit_status = 'no_feasible_candidate'
        result = self.collect()
        self.assertEqual(result['status'], 'no_feasible_policy')
        self.assertEqual(result['selected'], [])
        self.assertEqual(result['executions'][0]['response']['outcome'], {'Err': 'transport'})
        self.assertIsNotNone(result['fitted_result'])

    def test_typed_timeout_is_retained_but_stops_collection_without_fitting(self):
        self.answers[0]['response']['outcome'] = {'Err': 'timeout'}
        result = self.collect()
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(self.operations(), ['preflight-development-calibration', 'evaluate'])
        self.assertEqual(result['executions'][0]['response'], self.answers[0]['response'])
        self.assertIsNone(result['fitted_result'])
        receipt = evaluator.read_json(self.paths['output'].with_name(self.paths['output'].name + '.evidence') / 'collection.json')
        self.assertEqual([request['status'] for request in receipt['requests']], ['failed', 'not_attempted'])

    def test_protocol_gold_runtime_and_fixture_mismatch_stop_before_any_command(self):
        mutations = ('protocol', 'gold', 'runtime', 'observations', 'request_shape')
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.manifest['cases'][0]['gold'] = self.cases[0]['gold']
                self.config['provider']['identity'] = self.provider
                self.write_inputs()
                if mutation == 'protocol':
                    self.plan['protocol_sha256'] = '0' * 64
                    self.put(self.paths['plan'], self.plan)
                elif mutation == 'gold':
                    self.manifest['cases'][0]['gold'] = {'justified_nudge': False, 'acceptable_reference_sets': []}
                    self.put(self.paths['requests'], self.manifest)
                    self.plan['request_manifest_sha256'] = evaluator.fingerprint(self.manifest)
                    self.put(self.paths['plan'], self.plan)
                elif mutation == 'runtime':
                    self.config['provider']['identity'] = dict(self.provider, model='different')
                    self.put(self.paths['config'], self.config)
                elif mutation == 'observations':
                    self.write_inputs(b'{"authored_answer":"never a live response"}\n')
                else:
                    self.requests[0]['packet']['revision']['paths'] = []
                    self.write_inputs()
                with self.assertRaises(ValueError):
                    self.collect()
                self.assertEqual(self.calls, [])

    def test_core_preflight_refusal_never_calls_provider(self):
        self.preflight_error = True
        result = self.collect()
        self.assertEqual(self.operations(), ['preflight-development-calibration'])
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['executions'], [])

    def test_uncertain_terminal_capture_stops_without_retry_or_fit(self):
        valid = json.dumps(self.answers[0]).encode()
        invalid = (b'', valid, valid + b'\n' + valid + b'\n',
                   b'{"response":1,"response":2}\n',
                   self.capture(valid + b'\n', status='timeout'))
        for index, answer in enumerate(invalid):
            with self.subTest(index=index):
                self.paths['output'] = self.root / ('uncertain-' + str(index) + '.json')
                self.calls = []
                self.answers[0] = answer
                result = self.collect()
                self.assertEqual(self.operations(), ['preflight-development-calibration', 'evaluate'])
                self.assertEqual(result['status'], 'incomplete')
                self.assertEqual(result['executions'], [])
                self.assertIsNone(result['fitted_result'])
                receipt_path = self.paths['output'].with_name(self.paths['output'].name + '.evidence') / 'collection.json'
                receipt = evaluator.read_json(receipt_path)
                self.assertEqual(receipt['requests'][1]['status'], 'not_attempted')

    def test_fit_failure_preserves_observed_executions_without_selection(self):
        self.fit_error = True
        result = self.collect()
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(len(result['executions']), 2)
        self.assertEqual(result['selected'], [])
        self.assertIsNone(result['fitted_result'])

    def test_changed_frozen_input_stops_before_next_request(self):
        self.after_evaluate = lambda: self.paths['protocol'].write_text('{}\n')
        result = self.collect()
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(len(result['executions']), 1)
        self.assertEqual(self.operations(), ['preflight-development-calibration', 'evaluate'])

    def test_absent_revision_dependency_created_during_collection_stops(self):
        self.after_evaluate = lambda: (self.root / 'absent.txt').write_text('changed')
        result = self.collect()
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(len(result['executions']), 1)
        self.assertEqual(self.operations(), ['preflight-development-calibration', 'evaluate'])

    def test_malformed_typed_answer_stops_before_next_request(self):
        self.answers[0]['response']['outcome']['Ok']['probabilities'] = {'drift': float('inf')}
        result = self.collect()
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(self.operations(), ['preflight-development-calibration', 'evaluate'])
        self.assertEqual(result['executions'], [])

    def test_boolean_preflight_counter_is_not_zero_provider_calls(self):
        original = self.transport
        def corrupted(argv, cwd, stdin, timeout, max_bytes):
            result = original(argv, cwd, stdin, timeout, max_bytes)
            if argv[8] == 'preflight-development-calibration':
                value = evaluator.parse_json(result['stdout'])
                value['provider_calls'] = False
                result['stdout'] = json.dumps(value).encode() + b'\n'
            return result
        self.transport = corrupted
        result = self.collect()
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(self.operations(), ['preflight-development-calibration'])

    def test_unknown_fitter_score_fields_fail_closed(self):
        original = self.transport
        def corrupted(argv, cwd, stdin, timeout, max_bytes):
            result = original(argv, cwd, stdin, timeout, max_bytes)
            if argv[8] == 'fit-saved':
                value = evaluator.parse_json(result['stdout'])
                value['groups'][0]['candidates'][0]['invented'] = True
                result['stdout'] = json.dumps(value).encode() + b'\n'
            return result
        self.transport = corrupted
        result = self.collect()
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['selected'], [])

    def test_symlink_request_file_and_nonterminated_jsonl_reject_before_any_command(self):
        request_path = self.root / 'requests.jsonl'
        request_path.write_bytes(request_path.read_bytes().rstrip(b'\n'))
        self.manifest['requests_jsonl']['sha256'] = evaluator.file_hash(request_path)
        self.put(self.paths['requests'], self.manifest)
        self.plan['request_manifest_sha256'] = evaluator.fingerprint(self.manifest)
        self.put(self.paths['plan'], self.plan)
        with self.assertRaises(ValueError):
            self.collect()
        target = self.root / 'original.jsonl'
        request_path.rename(target)
        try:
            request_path.symlink_to(target)
        except OSError:
            self.skipTest('symlink creation is unavailable')
        with self.assertRaises(ValueError):
            self.collect()
        self.assertEqual(self.calls, [])

    @unittest.skipUnless(hasattr(os, 'mkfifo'), 'FIFO checks need POSIX')
    def test_nonregular_input_cannot_block_the_loader(self):
        fifo = self.root / 'fifo'
        os.mkfifo(fifo)
        program = ('import sys, json; from experiments import expert_calibrate_live as live\n'
                   'try:\n live.bounded_bytes(sys.argv[1])\n print(json.dumps(False))\n'
                   'except ValueError:\n print(json.dumps(True))')
        output = subprocess.run([sys.executable, '-c', program, str(fifo)], cwd=evaluator.ROOT,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=1)
        self.assertEqual(output.returncode, 0, output.stderr.decode())
        self.assertIs(evaluator.parse_json(output.stdout), True)

    def test_module_imports_from_package_without_sibling_sys_path(self):
        environment = dict(os.environ)
        environment.pop('PYTHONPATH', None)
        output = subprocess.run([sys.executable, '-c',
            'import experiments.expert_calibrate_live as live; import json; print(json.dumps(callable(live.calibrate_live)))'],
            cwd=evaluator.ROOT, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        self.assertEqual(output.returncode, 0, output.stderr.decode())
        self.assertIs(evaluator.parse_json(output.stdout), True)

    def test_bounded_transport_captures_bytes_and_terminates_overflow_and_timeout(self):
        if os.name != 'posix':
            self.skipTest('process-group containment is POSIX-only')
        capture = LIVE.exchange([sys.executable, '-c', 'import sys; print(sys.stdin.read())'],
                                self.root, b'synthetic input', 2, 1024)
        self.assertEqual(capture['status'], 'completed')
        self.assertEqual(capture['stdout'], b'synthetic input\n')
        overflow = LIVE.exchange([sys.executable, '-c', 'print("x" * 100000)'], self.root, b'', 2, 128)
        self.assertEqual(overflow['status'], 'overflow')
        self.assertLessEqual(len(overflow['stdout']), 128)
        timeout = LIVE.exchange([sys.executable, '-c', 'import time; time.sleep(20)'],
                                self.root, b'', .05, 128)
        self.assertEqual(timeout['status'], 'timeout')


if __name__ == '__main__':
    unittest.main()
