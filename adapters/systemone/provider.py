import argparse
import http.client
import ipaddress
import json
import math
import socket
import sys
import threading
import time
from urllib.parse import urlsplit

MODEL = 'kev-latest'
MAX_BYTES = 65536
TOLERANCE = 1e-3


class Failure(Exception):
    def __init__(self, kind, diagnostic):
        self.kind = kind
        self.diagnostic = diagnostic[:2048]
        super().__init__(self.diagnostic)


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise Failure('malformed', 'duplicate JSON key')
        value[key] = item
    return value


def decode(raw):
    def invalid_constant(value):
        raise Failure('malformed', 'nonfinite JSON number')
    try:
        return json.loads(raw, object_pairs_hook=unique_object, parse_constant=invalid_constant)
    except (ValueError, UnicodeError) as error:
        raise Failure('malformed', 'invalid JSON') from error


def finite(value, minimum=0.0, maximum=None):
    try:
        valid = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
    except OverflowError:
        valid = False
    if not valid:
        raise Failure('malformed', 'invalid numeric value')
    if value < minimum or (maximum is not None and value > maximum):
        raise Failure('malformed', 'numeric value out of range')
    return value


def exact_fields(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= set(value) or set(value) - set(required) - set(optional):
        raise Failure('malformed', 'unexpected or missing fields')


def state(request):
    packet = request['packet']
    exact_fields(packet, ('event', 'binding_id', 'revision', 'context', 'references', 'history', 'accounting', 'hash'))
    return json.dumps({key: packet[key] for key in ('event', 'revision', 'context', 'references', 'history')},
                      sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def question(request):
    exact_fields(request, ('request_id', 'packet', 'judgment', 'question_fingerprint', 'template_fingerprint'))
    if not isinstance(request['request_id'], str) or not request['request_id']:
        raise Failure('malformed', 'invalid request identity')
    judgment = request['judgment']
    exact_fields(judgment, ('name', 'pack', 'purpose', 'question', 'criteria', 'requires', 'optional', 'output', 'templates'))
    output = judgment['output']
    kind = output['kind']
    text = [judgment['question'], judgment['criteria']]
    result = {'type': kind}
    if kind == 'choice':
        exact_fields(output, ('kind', 'alternatives'))
        labels = output['alternatives']
        result['criteria'] = {label: label for label in labels}
    elif kind == 'score':
        exact_fields(output, ('kind', 'levels'))
        labels = output['levels']
        result['criteria'] = labels
    elif kind == 'noul':
        exact_fields(output, ('kind', 'proposition'))
        labels = None
        text.append(output['proposition'])
    else:
        raise Failure('unsupported', 'unsupported output')
    if labels is not None and (not isinstance(labels, list) or len(labels) < 2 or
                              any(not isinstance(label, str) or not label for label in labels) or len(set(labels)) != len(labels)):
        raise Failure('malformed', 'invalid output labels')
    if any(not isinstance(part, str) or not part for part in text):
        raise Failure('malformed', 'empty question instructions')
    result['instructions'] = '\n'.join(text)
    return result


def endpoint_parts(endpoint):
    parts = urlsplit(endpoint)
    if parts.scheme != 'http' or parts.username or parts.password or parts.query or parts.fragment or parts.path not in ('', '/'):
        raise Failure('transport', 'endpoint must be a credential-free loopback HTTP origin')
    try:
        loopback = parts.hostname == 'localhost' or ipaddress.ip_address(parts.hostname).is_loopback
    except (ValueError, TypeError):
        loopback = False
    if not loopback:
        raise Failure('transport', 'only loopback deployments are supported')
    return '127.0.0.1' if parts.hostname == 'localhost' else parts.hostname, parts.port or 80


def remaining(deadline):
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise Failure('timeout', 'original request deadline elapsed')
    return seconds


def exchange_http(endpoint, path, deadline, payload=None):
    host, port = endpoint_parts(endpoint)
    connection = http.client.HTTPConnection(host, port, timeout=remaining(deadline))
    stopped = threading.Event()
    expired = threading.Event()
    monitor = None
    response = None
    transport = None
    try:
        raw = None if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        if raw is not None and len(raw) > MAX_BYTES:
            raise Failure('malformed', 'request exceeds byte limit')
        connection.connect()
        transport = connection.sock
        def expire_transport():
            if not stopped.wait(max(0.0, deadline - time.monotonic())):
                expired.set()
                try:
                    transport.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
        monitor = threading.Thread(target=expire_transport, name='blabla-systemone-deadline')
        monitor.start()
        connection.request('GET' if payload is None else 'POST', path, body=raw,
                           headers={} if raw is None else {'Content-Type': 'application/json'})
        if connection.sock:
            connection.sock.settimeout(remaining(deadline))
        response = connection.getresponse()
        remaining(deadline)
        if response.status != 200:
            raise Failure('transport', 'HTTP status ' + str(response.status))
        chunks = []
        count = 0
        while True:
            if connection.sock:
                connection.sock.settimeout(remaining(deadline))
            else:
                remaining(deadline)
            chunk = response.read1(min(4096, MAX_BYTES + 1 - count))
            if not chunk:
                break
            chunks.append(chunk)
            count += len(chunk)
            if count > MAX_BYTES:
                raise Failure('malformed', 'response exceeds byte limit')
        remaining(deadline)
        return decode(b''.join(chunks)), response.getheader('x-typesafe-request-id')
    except (TimeoutError, socket.timeout) as error:
        raise Failure('timeout', 'HTTP deadline elapsed') from error
    except (OSError, http.client.HTTPException) as error:
        if expired.is_set() or time.monotonic() >= deadline:
            raise Failure('timeout', 'original HTTP deadline elapsed') from error
        raise Failure('transport', 'HTTP transport failed') from error
    finally:
        stopped.set()
        if monitor is not None:
            monitor.join()
        if response is not None:
            response.close()
        connection.close()
        if transport is not None:
            transport.close()


def identity(checkpoint='unknown'):
    return {'provider': 'systemone', 'model': MODEL, 'checkpoint': checkpoint,
            'supported_outputs': ['choice', 'noul', 'score'], 'probabilities': True, 'certification': None}


def response(request, provider, started, outcome, diagnostic=None, usage=None, request_id=None):
    total = int((time.monotonic() - started) * 1000)
    return {'request_id': request.get('request_id', ''), 'packet_hash': request.get('packet', {}).get('hash', ''),
            'question_fingerprint': request.get('question_fingerprint', ''),
            'template_fingerprint': request.get('template_fingerprint', ''), 'provider': provider,
            'timing': {'queue_ms': 0, 'inference_ms': total, 'total_ms': total},
            'usage': usage or {'input_tokens': None, 'output_tokens': None, 'reported_latency_ms': None},
            'provider_request_id': request_id, 'self_report': None, 'diagnostic': diagnostic, 'outcome': outcome}


def distribution(values, labels):
    if not isinstance(values, dict) or set(values) != set(labels):
        raise Failure('malformed', 'distribution keys differ from declared labels')
    result = [finite(values[label], maximum=1) for label in labels]
    if abs(sum(result) - 1) > TOLERANCE:
        raise Failure('malformed', 'distribution is not normalized')
    return result


def translate(request, answer):
    output = request['judgment']['output']
    kind = output['kind']
    if not isinstance(answer, dict) or answer.get('type') != kind:
        raise Failure('malformed', 'answer type differs from judgment')
    confidence = answer.get('confidence')
    if confidence is not None:
        finite(confidence, maximum=1)
    if kind == 'choice':
        exact_fields(answer, ('type', 'choice', 'probabilities', 'confidence'))
        labels = output['alternatives']
        distribution(answer['probabilities'], labels)
        if answer['choice'] not in labels:
            raise Failure('malformed', 'choice is not declared')
        return {'kind': kind, 'pick': answer['choice'], 'probabilities': answer['probabilities'], 'confidence': confidence}
    if kind == 'noul':
        exact_fields(answer, ('type', 'noul'))
        return {'kind': kind, 'value': None, 'probability': finite(answer['noul'], maximum=1), 'confidence': None}
    exact_fields(answer, ('type', 'score', 'probabilities', 'legend', 'confidence'))
    levels = output['levels']
    labels = [str(index) for index in range(len(levels))]
    expected_legend = dict(zip(labels, levels))
    if answer['legend'] != expected_legend:
        raise Failure('malformed', 'score legend differs from ordered levels')
    values = distribution(answer['probabilities'], labels)
    expectation = finite(answer['score'], maximum=len(levels) - 1)
    if abs(expectation - sum(index * value for index, value in enumerate(values))) > TOLERANCE:
        raise Failure('malformed', 'score expectation differs from distribution')
    return {'kind': kind, 'level': None, 'distribution': values, 'expectation': expectation, 'confidence': confidence}


def evaluate_requests(requests, endpoint, timeout_seconds):
    started = time.monotonic()
    provider = identity()
    try:
        finite(timeout_seconds, minimum=0.000001)
        deadline = started + timeout_seconds
        if not 1 <= len(requests) <= 4:
            raise Failure('malformed', 'batch must contain one to four questions')
        questions = {item['request_id']: question(item) for item in requests}
        if len(questions) != len(requests):
            raise Failure('malformed', 'duplicate request identity')
        states = [state(item) for item in requests]
        if any(value != states[0] for value in states[1:]):
            raise Failure('malformed', 'batch context differs')
        models, _ = exchange_http(endpoint, '/v1/models', deadline)
        model = [item for item in models['models'] if item['name'] == MODEL]
        if len(model) != 1 or not isinstance(model[0].get('run'), str) or not model[0]['run']:
            raise Failure('unverified', 'configured model provenance is absent')
        provider = identity(model[0]['run'])
        value, request_id = exchange_http(endpoint, '/v1/systemone', deadline,
                                 {'state': states[0], 'model': MODEL, 'questions': questions})
        exact_fields(value, ('model', 'answers', 'usage', 'latency_ms'))
        if value['model'] != MODEL:
            raise Failure('identity_mismatch', 'response model differs from configured model')
        if not isinstance(value['answers'], dict) or set(value['answers']) != set(questions):
            raise Failure('malformed', 'answer request identities differ')
        exact_fields(value['usage'], ('input_tokens', 'output_tokens'))
        for count in value['usage'].values():
            if type(count) is not int or count < 0:
                raise Failure('malformed', 'invalid token usage')
        usage = {**value['usage'], 'reported_latency_ms': finite(value['latency_ms'])}
        if request_id is not None and len(request_id.encode()) > 2048:
            raise Failure('malformed', 'provider request ID exceeds byte limit')
        results = []
        for item in requests:
            try:
                outcome = {'Ok': translate(item, value['answers'][item['request_id']])}
                diagnostic = None
            except Failure as error:
                outcome = {'Err': error.kind}
                diagnostic = error.diagnostic
            results.append(response(item, provider, started, outcome, diagnostic, usage, request_id))
        remaining(deadline)
        return results
    except Failure as error:
        return [response(item, provider, started, {'Err': error.kind}, error.diagnostic) for item in requests]
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        return [response(item, provider, started, {'Err': 'malformed'}, 'invalid request or response shape') for item in requests]


def evaluate(request, endpoint, timeout_seconds):
    return evaluate_requests([request], endpoint, timeout_seconds)[0]


def evaluate_batch(batch, endpoint, timeout_seconds):
    started = time.monotonic()
    items = batch.get('requests', []) if isinstance(batch, dict) else []
    try:
        exact_fields(batch, ('batch_id', 'requests'))
        if not isinstance(items, list) or not isinstance(batch['batch_id'], str) or not batch['batch_id'] or len(batch['batch_id'].encode()) > 256:
            raise Failure('malformed', 'invalid batch identity or requests')
    except Failure as error:
        return {'batch_id': batch.get('batch_id', '') if isinstance(batch, dict) else '',
                'responses': [response(item, identity(), started, {'Err': error.kind}, error.diagnostic)
                              for item in items if isinstance(item, dict)] if isinstance(items, list) else []}
    return {'batch_id': batch['batch_id'], 'responses': evaluate_requests(items, endpoint, timeout_seconds)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--endpoint', required=True)
    parser.add_argument('--timeout-seconds', type=float, default=10)
    parser.add_argument('--checkpoint')
    parser.add_argument('--certification')
    args = parser.parse_args()
    raw = sys.stdin.buffer.readline(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES or not raw.endswith(b'\n'):
        raise Failure('malformed', 'input must be one bounded JSON line')
    envelope = decode(raw)
    if envelope.get('kind') == 'single':
        exact_fields(envelope, ('kind', 'request'))
        result = evaluate(envelope['request'], args.endpoint, args.timeout_seconds)
        responses = [result]
        envelope = {'kind': 'single', 'response': result}
    elif envelope.get('kind') == 'batch':
        exact_fields(envelope, ('kind', 'batch'))
        result = evaluate_batch(envelope['batch'], args.endpoint, args.timeout_seconds)
        responses = result['responses']
        envelope = {'kind': 'batch', 'batch': result}
    else:
        raise Failure('malformed', 'unknown command envelope')
    for result in responses:
        if args.checkpoint and result['provider']['checkpoint'] != args.checkpoint:
            result['outcome'] = {'Err': 'identity_mismatch'}
            result['diagnostic'] = 'runtime checkpoint differs from configured checkpoint'
        elif args.certification and args.checkpoint:
            result['provider']['certification'] = args.certification
    sys.stdout.write(json.dumps(envelope, ensure_ascii=False, allow_nan=False) + '\n')


if __name__ == '__main__':
    try:
        main()
    except Failure as error:
        sys.stderr.write(error.diagnostic + '\n')
        sys.exit(1)
