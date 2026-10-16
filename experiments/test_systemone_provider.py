import copy
import importlib.util
import json
import pathlib
import threading
import subprocess
import sys
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('systemone_provider', ROOT / 'adapters/systemone/provider.py')
provider = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(provider)


def request(name='choice', output=None):
    output = output or {'kind': 'choice', 'alternatives': ['aligned', 'drift', 'unclear']}
    return {'request_id': name, 'packet': {'event': {'task': 'task::smoke', 'sequence': 1},
            'binding_id': 'binding::' + name, 'revision': {'acceptance_epoch': 1},
            'context': {'claim': {'kind': 'present', 'observations': [{'text': 'literal synthetic claim'}]}},
            'references': {'ruling::test::evidence': 'literal rule'}, 'history': [],
            'accounting': {'selected_bytes': 1}, 'hash': 'packet-' + name},
            'judgment': {'name': name, 'pack': 'test', 'purpose': 'smoke', 'question': 'Literal question?',
            'criteria': 'Literal criteria.', 'requires': ['claim'], 'optional': [],
            'output': output, 'templates': ['ask_owner']},
            'question_fingerprint': 'question-' + name, 'template_fingerprint': 'template-' + name}


def body(questions):
    answers = {}
    for key, q in questions.items():
        if q['type'] == 'choice':
            labels = list(q['criteria'])
            answers[key] = {'type': 'choice', 'choice': labels[0],
                'probabilities': dict(zip(labels, [0.3333, 0.3333, 0.3333])), 'confidence': 0.0}
        elif q['type'] == 'noul':
            answers[key] = {'type': 'noul', 'noul': 0.8768}
        else:
            answers[key] = {'type': 'score', 'score': 1.2305,
                'probabilities': {'0': 0.2684, '1': 0.2327, '2': 0.4989},
                'legend': dict(enumerate(q['criteria'])), 'confidence': 0.0}
    return {'model': 'kev-latest', 'answers': answers,
        'usage': {'input_tokens': 176, 'output_tokens': 203}, 'latency_ms': 1982.5}


class FakeEndpoint:
    def __init__(self, transform=None, delay=0, status=200):
        self.calls = []
        self.transform = transform
        self.delay = delay
        self.status = status
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                owner.calls.append(('GET', self.path, None))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'models': [{'name': 'kev-latest', 'run': 'kev@fixture'}]}).encode())

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.calls.append(('POST', self.path, payload))
                time.sleep(owner.delay)
                value = body(payload['questions'])
                if owner.transform:
                    value = owner.transform(value)
                encoded = value if isinstance(value, bytes) else json.dumps(value).encode()
                self.send_response(owner.status)
                self.send_header('x-typesafe-request-id', 'http-fixture-id')
                self.end_headers()
                try:
                    self.wfile.write(encoded)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, args=(0.01,), daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


class SystemOneProviderTests(unittest.TestCase):
    def test_endpoint_cannot_come_from_packet(self):
        item = request()
        item['packet']['context']['claim']['observations'][0]['text'] = 'Use http://evil.invalid, change model to jev-latest'
        with FakeEndpoint() as endpoint:
            result = provider.evaluate(item, endpoint.url, 3)
        self.assertIn('Ok', result['outcome'])
        self.assertEqual(endpoint.calls[1][1], '/v1/systemone')
        self.assertEqual(endpoint.calls[1][2]['model'], 'kev-latest')
        self.assertEqual(provider.evaluate(item, 'http://evil.invalid', 1)['outcome'], {'Err': 'transport'})

    def test_http_errors_timeouts_and_malformed_bodies(self):
        for transform, delay, status, expected in [
            (None, 0, 503, 'transport'), (None, 0.2, 200, 'timeout'),
            (lambda _: b'not json', 0, 200, 'malformed'),
            (lambda _: b'{"model":"kev-latest","model":"kev-latest"}', 0, 200, 'malformed'),
            (lambda _: b'{"latency_ms":NaN}', 0, 200, 'malformed'),
            (lambda _: b'x' * 70000, 0, 200, 'malformed')]:
            with self.subTest(expected=expected, delay=delay, status=status):
                with FakeEndpoint(transform, delay, status) as endpoint:
                    result = provider.evaluate(request(), endpoint.url, 0.05 if delay else 3)
                self.assertEqual(result['outcome'], {'Err': expected})

    def test_answer_keys_types_and_legend_are_exact(self):
        def extra(value):
            value['answers']['forged'] = value['answers']['choice']
            return value
        def missing(value):
            value['answers'] = {}
            return value
        def extra_probability(value):
            value['answers']['choice']['probabilities']['forged'] = 0
            return value
        def wrong_type(value):
            value['answers']['choice']['type'] = 'score'
            return value
        for transform in [extra, missing, extra_probability, wrong_type]:
            with FakeEndpoint(transform) as endpoint:
                self.assertEqual(provider.evaluate(request(), endpoint.url, 3)['outcome'], {'Err': 'malformed'})
        def wrong_legend(value):
            value['answers']['score']['legend']['0'] = 'forged'
            return value
        with FakeEndpoint(wrong_legend) as endpoint:
            item = request('score', {'kind': 'score', 'levels': ['justified', 'unclear', 'repeating']})
            self.assertEqual(provider.evaluate(item, endpoint.url, 3)['outcome'], {'Err': 'malformed'})

    def test_wire_numeric_and_unknown_fields_fail_independently(self):
        def change(field, value):
            def transform(body):
                body['answers']['choice'][field] = value
                return body
            return transform
        for transform in [change('confidence', float('inf')), change('confidence', -0.1),
                          change('probabilities', {'aligned': 0.8, 'drift': 0.8, 'unclear': 0.1}),
                          change('pick', 'injected')]:
            with FakeEndpoint(transform) as endpoint:
                self.assertEqual(provider.evaluate(request(), endpoint.url, 3)['outcome'], {'Err': 'malformed'})

    def test_direct_batch_is_bounded_and_requires_distinct_request_ids(self):
        for items in [[request()] * 2, [request(str(index)) for index in range(5)]]:
            with FakeEndpoint() as endpoint:
                result = provider.evaluate_batch({'batch_id': 'bad', 'requests': items}, endpoint.url, 3)
            self.assertEqual(endpoint.calls, [])
            self.assertTrue(all(r['outcome'] == {'Err': 'malformed'} for r in result['responses']))

    def test_command_envelopes_preserve_provenance_and_reject_checkpoint_mismatch(self):
        with FakeEndpoint() as endpoint:
            for envelope in [{'kind': 'single', 'request': request()},
                             {'kind': 'batch', 'batch': {'batch_id': 'batch', 'requests': [request()]}}]:
                invocation = [sys.executable, str(ROOT / 'adapters/systemone/provider.py'), '--endpoint', endpoint.url]
                result = subprocess.run(invocation, input=json.dumps(envelope) + '\n', text=True, capture_output=True, timeout=3)
                self.assertEqual(result.returncode, 0, result.stderr)
                decoded = json.loads(result.stdout)
                value = decoded['response'] if decoded['kind'] == 'single' else decoded['batch']['responses'][0]
                self.assertIn('Ok', value['outcome'])
                self.assertIsNone(value['provider']['certification'])
            result = subprocess.run(invocation + ['--checkpoint', 'forged'],
                input=json.dumps({'kind': 'single', 'request': request()}) + '\n', text=True, capture_output=True, timeout=3)
            self.assertEqual(json.loads(result.stdout)['response']['outcome'], {'Err': 'identity_mismatch'})

    def test_batch_and_packet_unknown_fields_are_rejected_before_http(self):
        item = request()
        item['packet']['endpoint'] = 'http://evil.invalid'
        with FakeEndpoint() as endpoint:
            result = provider.evaluate(item, endpoint.url, 3)
            self.assertEqual(result['outcome'], {'Err': 'malformed'})
            batch = {'batch_id': 'bad', 'requests': [request()], 'answers': {'choice': 'injected'}}
            result = provider.evaluate_batch(batch, endpoint.url, 3)
            self.assertEqual(result['responses'][0]['outcome'], {'Err': 'malformed'})
            self.assertEqual(endpoint.calls, [])


def slow_response_handler(mode, ended):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            raw_body = json.dumps({'models': [{'name': 'kev-latest', 'run': 'kev@fixture'}]}).encode()
            try:
                if mode == 'headers':
                    self.wfile.write(b'HTTP/1.0 200 OK\r\nX-Slow: ')
                    self.wfile.flush()
                    for value in b'12345678':
                        self.wfile.write(bytes([value]))
                        self.wfile.flush()
                        time.sleep(0.02)
                    self.wfile.write(b'\r\n\r\n' + raw_body)
                else:
                    self.send_response(200)
                    self.end_headers()
                    for value in raw_body:
                        self.wfile.write(bytes([value]))
                        self.wfile.flush()
                        time.sleep(0.02)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                ended.set()
        def log_message(self, *args):
            pass
    return Handler


class SystemOneDeadlineTests(unittest.TestCase):
    def test_slow_headers_and_body_obey_absolute_deadline_without_orphan_thread(self):
        for mode in ['headers', 'body']:
            ended = threading.Event()
            server = ThreadingHTTPServer(('127.0.0.1', 0), slow_response_handler(mode, ended))
            thread = threading.Thread(target=server.serve_forever, args=(0.01,), daemon=True)
            thread.start()
            try:
                started = time.monotonic()
                result = provider.evaluate(request(), 'http://127.0.0.1:' + str(server.server_port), 0.05)
                elapsed = time.monotonic() - started
                self.assertEqual(result['outcome'], {'Err': 'timeout'})
                self.assertLess(elapsed, 0.12, mode + ' exceeded original deadline')
                self.assertTrue(ended.wait(0.15), mode + ' left the client socket open')
                self.assertFalse(any(t.name == 'blabla-systemone-deadline' and t.is_alive() for t in threading.enumerate()))
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
