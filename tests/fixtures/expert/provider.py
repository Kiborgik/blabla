import json
import pathlib
import subprocess
import sys
import time

mode = sys.argv[1]
raw = sys.stdin.readline()
envelope = json.loads(raw)
requests = [envelope['request']] if envelope['kind'] == 'single' else envelope['batch']['requests']
if mode == 'descendant':
    child = subprocess.Popen([sys.executable, '-c', 'import pathlib,sys,time;time.sleep(.5);pathlib.Path(sys.argv[1]).write_text("late")', sys.argv[2]])
    pathlib.Path(sys.argv[3]).write_text(str(child.pid))
    time.sleep(10)
if mode == 'slow':
    time.sleep(1)
if mode in ('retry', 'retry-slow'):
    log = pathlib.Path(sys.argv[2])
    count = len(log.read_text().splitlines()) if log.exists() else 0
    with log.open('a') as stream:
        stream.write(raw)
    if count == 0 or mode == 'retry-slow':
        if mode == 'retry-slow':
            time.sleep(.10)
        sys.exit(1)
if mode == 'stdout-flood':
    sys.stdout.write('x' * 100000)
    sys.stdout.flush()
    time.sleep(10)
if mode == 'stderr-flood':
    sys.stderr.write('x' * 100000)
    sys.stderr.flush()
    time.sleep(10)
if mode == 'malformed-retry':
    with pathlib.Path(sys.argv[2]).open('a') as stream:
        stream.write(raw)
if mode in ('malformed', 'malformed-retry'):
    print('not json')
    sys.exit(0)


def answer(request):
    output = request['judgment']['output']
    if output['kind'] == 'choice':
        labels = output['alternatives']
        return {'kind': 'choice', 'pick': labels[0], 'probabilities': dict.fromkeys(labels, 1 / len(labels)), 'confidence': 0}
    if output['kind'] == 'noul':
        return {'kind': 'noul', 'value': None, 'probability': .7, 'confidence': None}
    return {'kind': 'score', 'level': None, 'distribution': [.2, .3, .5], 'expectation': 1.3, 'confidence': 0}


def response(request):
    return {'request_id': request['request_id'], 'packet_hash': request['packet']['hash'],
            'question_fingerprint': request['question_fingerprint'], 'template_fingerprint': request['template_fingerprint'],
            'provider': {'provider': 'fixture', 'model': 'fixture-model', 'checkpoint': 'fixture-checkpoint',
                         'supported_outputs': ['choice', 'noul', 'score'], 'probabilities': True, 'certification': 'local-fixture-only'},
            'timing': {'queue_ms': 0, 'inference_ms': 1, 'total_ms': 1},
            'usage': {'input_tokens': None, 'output_tokens': None, 'reported_latency_ms': None},
            'provider_request_id': None, 'self_report': None, 'diagnostic': None, 'outcome': {'Ok': answer(request)}}


responses = [response(request) for request in requests]
if mode == 'partial':
    responses[-1]['outcome'] = {'Err': 'unsupported'}
if mode == 'wrong-identity':
    responses[0]['provider']['checkpoint'] = 'forged'
if mode == 'extra':
    responses[0]['outcome']['Ok']['extra'] = 'forged'
result = {'kind': 'single', 'response': responses[0]} if envelope['kind'] == 'single' else {'kind': 'batch', 'batch': {'batch_id': envelope['batch']['batch_id'], 'responses': responses}}
encoded = json.dumps(result)
if mode == 'duplicate':
    encoded = encoded.replace('"pick":', '"pick":"forged","pick":')
if mode == 'overflow':
    encoded = encoded.replace('0.3333333333333333', '1e999')
if mode == 'unterminated':
    sys.stdout.write(encoded)
elif mode == 'two-lines':
    print(encoded)
    print(encoded)
else:
    print(encoded)
