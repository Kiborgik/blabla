import argparse
import importlib.metadata
import importlib.util
import json
import os
import pathlib
import socket
import subprocess
import sys
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('systemone_provider', ROOT / 'adapters/systemone/provider.py')
provider = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(provider)
REVISION = '9a45d25eb2ab761841196625383fa1dff0e56c1e'
CHECKPOINT = 'jaredpalmer/kev-0.8b@' + REVISION


def requests():
    packet = {'event': {'event_id': 'synthetic-event', 'run_id': 'synthetic-run', 'task': 'task::smoke',
        'checkpoint_id': 'synthetic-claim', 'sequence': 1, 'previous_sequence': None, 'unix_ms': 1,
        'kind': 'claim', 'host': {'host': 'smoke-only', 'version': '1', 'adapter': 'synthetic',
        'checkpoints': ['claim'], 'pauses_worker': False, 'same_task_delivery': False,
        'delivery_receipts': False, 'pre_tool_control': False, 'gaps': []}},
        'revision': {'acceptance_epoch': 1, 'task_digest': 'synthetic', 'paths': {}, 'identities': {}},
        'context': {'claim': {'kind': 'present', 'observations': [{'id': 'synthetic-claim', 'slot': 'claim',
        'kind': 'worker_statement', 'capture': 'synthetic', 'observed_revision': 'synthetic',
        'text': 'The test command exited 0. No tests failed. The claim says that the test command passed.', 'fact': None}]}},
        'references': {}, 'history': [], 'accounting': {'selected_bytes': 87, 'omitted_bytes': 0,
        'estimated_tokens': 22, 'provider_tokens': None}, 'hash': 'synthetic'}
    outputs = {'choice': {'kind': 'choice', 'alternatives': ['supported', 'unsupported', 'unclear']},
        'noul': {'kind': 'noul', 'proposition': 'The supplied text states the test command passed.'},
        'score': {'kind': 'score', 'levels': ['unsupported', 'unclear', 'supported']}}
    return [{'request_id': 'smoke-' + kind, 'packet': {**packet, 'binding_id': 'binding::' + kind},
        'judgment': {'name': kind, 'pack': 'smoke', 'purpose': 'Synthetic transport smoke only.',
        'question': 'Does the supplied text state that the test command passed?',
        'criteria': 'Use only the supplied literal text. Missing evidence is unclear.',
        'requires': ['claim'], 'optional': [], 'output': output, 'templates': ['ask_owner']},
        'question_fingerprint': 'synthetic-question-' + kind, 'template_fingerprint': 'synthetic-template'}
        for kind, output in outputs.items()]


def local_versions(runtime):
    command = [str(runtime / 'venv/bin/python'), '-c',
        'import importlib.metadata,json,platform; print(json.dumps({"python":platform.python_version(),"packages":{n:importlib.metadata.version(n) for n in ["torch","transformers","peft","huggingface-hub","typesafe-sdk","fastapi","uvicorn"]}}))']
    return json.loads(subprocess.check_output(command, text=True, timeout=15))


def resource_state(pid):
    status = pathlib.Path('/proc/' + str(pid) + '/status').read_text()
    memory = pathlib.Path('/proc/meminfo').read_text()
    rss = int(next(line.split()[1] for line in status.splitlines() if line.startswith('VmRSS:'))) * 1024
    available = int(next(line.split()[1] for line in memory.splitlines() if line.startswith('MemAvailable:'))) * 1024
    return rss, available


def launch(runtime, port, output):
    environment = dict(os.environ)
    environment.update({'HF_HOME': str(runtime / 'cache/huggingface'), 'HF_HUB_OFFLINE': '1',
        'TRANSFORMERS_OFFLINE': '1', 'HF_HUB_DISABLE_TELEMETRY': '1', 'OMP_NUM_THREADS': '4',
        'MKL_NUM_THREADS': '4', 'OPENBLAS_NUM_THREADS': '4', 'TOKENIZERS_PARALLELISM': 'false',
        'PYTHONUNBUFFERED': '1', 'KEV_PREFIX_MAX_TOKENS': '2048'})
    argv = [str(runtime / 'venv/bin/python'), '-m', 'kev.serve', '--run', CHECKPOINT,
            '--host', '127.0.0.1', '--port', str(port)]
    log = (output.parent / 'systemone-server.log').open('w')
    process = subprocess.Popen(argv, cwd=runtime / 'repo', env=environment,
                               stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    return process, log, argv


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--allow-local-inference', action='store_true', required=True)
    parser.add_argument('--runtime-root', type=pathlib.Path)
    parser.add_argument('--endpoint')
    parser.add_argument('--port', type=int, default=18019)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    if bool(args.runtime_root) == bool(args.endpoint):
        parser.error('choose an existing endpoint or isolated runtime root')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    record = {'scope': 'synthetic local transport only; no accuracy, calibration or advisory certification',
              'checkpoint': CHECKPOINT, 'status': 'running', 'rows': [], 'peak_rss_bytes': 0,
              'wire_calls': [], 'timestamp_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    original_exchange = provider.exchange_http
    def record_exchange(endpoint, path, deadline, payload=None):
        value, request_id = original_exchange(endpoint, path, deadline, payload)
        record['wire_calls'].append({'path': path, 'payload': payload, 'body': value, 'provider_request_id': request_id})
        return value, request_id
    provider.exchange_http = record_exchange
    process = None
    log = None
    stop = threading.Event()
    monitor = None
    endpoint = args.endpoint or 'http://127.0.0.1:' + str(args.port)
    record['endpoint'] = endpoint
    try:
        if args.runtime_root:
            record['versions'] = local_versions(args.runtime_root)
            record['source_revision'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'],
                cwd=args.runtime_root / 'repo', text=True, timeout=5).strip()
            process, log, argv = launch(args.runtime_root, args.port, args.output)
            record['argv'] = argv
            record['server_pid'] = process.pid
            def watch():
                while not stop.wait(0.2):
                    try:
                        rss, available = resource_state(process.pid)
                        record['peak_rss_bytes'] = max(record['peak_rss_bytes'], rss)
                        record['min_available_bytes'] = min(record.get('min_available_bytes', available), available)
                        if rss > 7.5 * 1024 ** 3 or available < 700 * 1024 ** 2:
                            record['resource_stop'] = True
                            process.terminate()
                            return
                    except (FileNotFoundError, StopIteration, ProcessLookupError):
                        return
            monitor = threading.Thread(target=watch, daemon=True)
            monitor.start()
        readiness_deadline = time.monotonic() + 60
        while True:
            if process is not None and process.poll() is not None:
                raise RuntimeError('local server exited during startup')
            try:
                models, _ = provider.exchange_http(endpoint, '/v1/models', time.monotonic() + 1)
                break
            except provider.Failure:
                if time.monotonic() >= readiness_deadline:
                    raise TimeoutError('local endpoint did not become ready')
                time.sleep(0.25)
        record['models_before'] = models
        record['startup_seconds'] = time.monotonic() - started
        for item in requests():
            response = provider.evaluate(item, endpoint, 20)
            record['rows'].append({'kind': 'single', 'request': item, 'response': response})
            if 'Ok' not in response['outcome'] or response['provider']['checkpoint'] != CHECKPOINT:
                raise RuntimeError('typed single translation failed: ' + json.dumps(response['outcome']))
        batch = {'batch_id': 'synthetic-independent-batch', 'requests': requests()}
        response = provider.evaluate_batch(batch, endpoint, 30)
        record['rows'].append({'kind': 'batch', 'request': batch, 'response': response})
        if len(response['responses']) != 3 or any('Ok' not in item['outcome'] or item['provider']['checkpoint'] != CHECKPOINT for item in response['responses']):
            raise RuntimeError('typed independent batch translation failed')
        record['models_after'] = provider.exchange_http(endpoint, '/v1/models', time.monotonic() + 2)[0]
        record['status'] = 'success'
    except Exception as error:
        record['status'] = 'failed'
        record['error'] = repr(error)
    finally:
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            stop.set()
            if monitor:
                monitor.join(timeout=2)
            log.close()
            record['server_exit_code'] = process.returncode
            record['server_stopped'] = process.poll() is not None
            probe = socket.socket()
            probe.settimeout(1)
            record['port_closed'] = probe.connect_ex(('127.0.0.1', args.port)) != 0
            probe.close()
            if not record['server_stopped'] or not record['port_closed']:
                record['status'] = 'failed'
                record['error'] = 'local server cleanup not confirmed'
        record['wall_seconds'] = time.monotonic() - started
        args.output.write_text(json.dumps(record, indent=2, ensure_ascii=False, allow_nan=False) + '\n')
    print(json.dumps({key: record[key] for key in ('status', 'checkpoint', 'wall_seconds')}, allow_nan=False))
    return 0 if record['status'] == 'success' else 1


if __name__ == '__main__':
    sys.exit(main())
