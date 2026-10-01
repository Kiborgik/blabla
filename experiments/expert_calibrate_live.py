import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import time

if __package__:
    from . import expert_eval as evaluator
else:
    import expert_eval as evaluator


SOURCE_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ARGV = ['cargo', 'run', '--release', '--quiet', '--bin', 'blabla', '--']
MAX_BYTES = 8 * 1024 * 1024
MAX_COMMAND_BYTES = 65536
MAX_REQUESTS = 512
MAX_FROZEN_BYTES = 32 * 1024 * 1024
NATIVE_SPEC = importlib.util.spec_from_file_location('calibration_native', SOURCE_ROOT / 'adapters/native/expert.py')
NATIVE = importlib.util.module_from_spec(NATIVE_SPEC)
NATIVE_SPEC.loader.exec_module(NATIVE)


def exact(value, names):
    return evaluator.validate_fields(value, names.split())


def canonical(value):
    return evaluator.fingerprint(value)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def decode(raw):
    if len(raw) > MAX_BYTES:
        raise ValueError('JSON exceeds byte limit')
    try:
        value = evaluator.parse_json(raw.decode('utf-8'))
        encode(value)
        return value
    except (UnicodeError, RecursionError) as error:
        raise ValueError('invalid UTF-8 JSON') from error


def encode(value):
    raw = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                     allow_nan=False).encode('utf-8') + b'\n'
    if len(raw) > MAX_BYTES:
        raise ValueError('record exceeds byte limit')
    return raw


def safe_path(root, path):
    path = Path(path)
    if not path.is_absolute():
        path = root / path
    if '..' in path.parts:
        raise ValueError('parent traversal is not allowed')
    path = path.absolute()
    relative = path.relative_to(root)
    if not relative.parts:
        raise ValueError('file path required')
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        if current.is_symlink():
            raise ValueError('symlink evidence is not allowed')
    if any(character in relative.as_posix() for character in ('\\', ':', '\0')):
        raise ValueError('invalid project-relative evidence path')
    return path


def bounded_bytes(path, limit=MAX_BYTES):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise ValueError('evidence must be a bounded regular file')
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError('evidence exceeds byte limit')
    return raw


def reference(root, path, raw, identity):
    return {'id': identity, 'path': safe_path(root, path).relative_to(root).as_posix(),
            'sha256': digest(raw)}


def write_new(root, path, raw, identity):
    path = safe_path(root, path)
    if len(raw) > MAX_BYTES:
        raise ValueError('evidence exceeds byte limit')
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    return reference(root, path, raw, identity)


def evidence_file(root, evidence):
    try:
        NATIVE.validate_reference(evidence)
    except NATIVE.Failure as error:
        raise ValueError('invalid EvidenceRef') from error
    value = evidence['path']
    if not isinstance(value, str) or not value or value.startswith('/') or any(
            part in ('', '.', '..') for part in value.split('/')):
        raise ValueError('invalid EvidenceRef path')
    path = safe_path(root, value)
    raw = bounded_bytes(path)
    if digest(raw) != evidence['sha256']:
        raise ValueError('frozen evidence fingerprint mismatch')
    return path, raw


def finite_seconds(value, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 < value <= maximum:
        raise ValueError('invalid command or collection time budget')
    return value


def exchange(argv, cwd, stdin, timeout, max_bytes):
    finite_seconds(timeout, 600)
    if os.name != 'posix':
        raise ValueError('bounded calibration process containment requires POSIX')
    if not isinstance(stdin, bytes) or len(stdin) > MAX_COMMAND_BYTES or not 0 < max_bytes <= MAX_BYTES:
        raise ValueError('invalid command byte budget')
    result = {'stdout': b'', 'stderr': b'', 'exit_code': None, 'status': 'spawn_failed',
              'stdout_complete': False, 'stderr_complete': False, 'stdin_complete': False,
              'elapsed_ms': 0}
    started = time.monotonic()
    try:
        process = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True)
    except OSError:
        return result
    streams = {'stdin': process.stdin, 'stdout': process.stdout, 'stderr': process.stderr}
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    offset = 0
    result['status'] = 'completed'
    try:
        with selectors.DefaultSelector() as selector:
            for name, stream in streams.items():
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_WRITE if name == 'stdin' else selectors.EVENT_READ, name)
            while selector.get_map():
                remaining = started + timeout - time.monotonic()
                if remaining <= 0:
                    result['status'] = 'timeout'
                    break
                for key, unused in selector.select(min(remaining, .1)):
                    name, stream = key.data, key.fileobj
                    if name == 'stdin':
                        try:
                            offset += os.write(stream.fileno(), stdin[offset:offset + 65536]) if offset < len(stdin) else 0
                        except BrokenPipeError:
                            selector.unregister(stream)
                            stream.close()
                            if offset != len(stdin):
                                result['status'] = 'io_error'
                            continue
                        if offset == len(stdin):
                            result['stdin_complete'] = True
                            selector.unregister(stream)
                            stream.close()
                    else:
                        raw = os.read(stream.fileno(), min(65536, max_bytes + 1 - len(buffers[name])))
                        if not raw:
                            result[name + '_complete'] = True
                            selector.unregister(stream)
                            stream.close()
                        else:
                            buffers[name].extend(raw)
                            if len(buffers[name]) > max_bytes:
                                del buffers[name][max_bytes:]
                                result['status'] = 'overflow'
                if result['status'] != 'completed':
                    break
            if result['status'] == 'completed':
                process.wait(timeout=max(.001, started + timeout - time.monotonic()))
    except subprocess.TimeoutExpired:
        result['status'] = 'timeout'
    except OSError:
        result['status'] = 'io_error'
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            result['status'] = 'cleanup_uncertain'
        for stream in streams.values():
            stream.close()
        result.update({name: bytes(value) for name, value in buffers.items()})
        result['exit_code'] = process.returncode
        result['elapsed_ms'] = int((time.monotonic() - started) * 1000)
    return result


class FrozenInputs:
    def __init__(self, root):
        self.root = root
        self.files = {}
        self.absent = set()
        self.total_bytes = 0

    def remember(self, path, raw):
        if path not in self.files:
            self.total_bytes += len(raw)
        if self.total_bytes > MAX_FROZEN_BYTES:
            raise ValueError('frozen inputs exceed aggregate byte budget')
        self.files[path] = raw

    def read(self, path, identity):
        path = safe_path(self.root, path)
        raw = bounded_bytes(path)
        if path in self.files and self.files[path] != raw:
            raise ValueError('frozen input changed while loading')
        self.remember(path, raw)
        return raw, reference(self.root, path, raw, identity)

    def include(self, evidence):
        path, raw = evidence_file(self.root, evidence)
        if path in self.files and self.files[path] != raw:
            raise ValueError('frozen input changed during preflight')
        self.remember(path, raw)

    def verify(self):
        for path in self.absent:
            if os.path.lexists(safe_path(self.root, path)):
                raise ValueError('absent frozen revision path was created')
        for path, raw in self.files.items():
            if bounded_bytes(safe_path(self.root, path)) != raw:
                raise ValueError('frozen input changed; collection cannot continue')


def load_inputs(protocol_path, development_path, manifest_path, plan_path, config_path, root):
    frozen = FrozenInputs(root)
    documents, references = {}, {}
    for name, path in (('protocol', protocol_path), ('manifest', manifest_path),
                       ('plan', plan_path), ('config', config_path)):
        raw, references[name] = frozen.read(path, name)
        documents[name] = decode(raw)
    protocol, manifest, plan, config = (documents[name] for name in ('protocol', 'manifest', 'plan', 'config'))
    evaluator.validate_protocol(protocol)
    exact(manifest, 'kind schema_version development_manifest_sha256 requests_jsonl cases')
    exact(plan, 'kind schema_version protocol_sha256 development_manifest_sha256 holdout_manifest_sha256 request_manifest_sha256 provider limits groups')
    exact(config, 'mode provider host policies limits trace_limits promotions')
    exact(config['provider'], 'identity argv')
    if (manifest['kind'] != 'real_calibration_requests' or manifest['schema_version'] != 1
            or plan['kind'] != 'typed_development_fit_plan' or plan['schema_version'] != 1
            or plan['protocol_sha256'] != canonical(protocol)
            or plan['request_manifest_sha256'] != canonical(manifest)
            or plan['development_manifest_sha256'] != protocol['datasets']['development']['manifest_sha256']
            or plan['development_manifest_sha256'] != manifest['development_manifest_sha256']
            or plan['holdout_manifest_sha256'] != protocol['datasets']['holdout']['manifest_sha256']
            or config['provider']['identity'] != plan['provider'] or config['limits'] != plan['limits']
            or config['mode'] != 'shadow' or config['promotions'] or config['limits']['retries'] != 0):
        raise ValueError('frozen protocol, request manifest, fit plan or runtime mismatch')
    development_path = safe_path(root, development_path)
    dev_raw, unused = frozen.read(development_path / 'manifest.json', 'development')
    dev_manifest = decode(dev_raw)
    if dev_manifest.get('split') != 'development':
        raise ValueError('only development inputs may be opened')
    for name in ('cases.jsonl', 'observations.jsonl'):
        frozen.read(development_path / name, 'development-' + name.replace('.', '-'))
    development = evaluator.load_split(development_path, protocol, 'development')
    if frozen.files[development_path / 'observations.jsonl'] != b'':
        raise ValueError('real calibration requires an empty pre-inference observations file')
    if not isinstance(manifest['cases'], list) or not 1 <= len(manifest['cases']) <= 256:
        raise ValueError('invalid development case count')
    groups = {group['group_id']: group for group in plan['groups']}
    cases = {case['case_id']: case for case in development['cases']}
    if len(groups) != len(plan['groups']) or not 1 <= len(groups) <= 4:
        raise ValueError('duplicate or invalid candidate groups')
    assigned_ids, case_ids = [], []
    for case in manifest['cases']:
        exact(case, 'case_id group_id primary_request_id selection_request_id gold')
        exact(case['gold'], 'justified_nudge acceptable_reference_sets')
        original = cases.get(case['case_id'])
        group = groups.get(case['group_id'])
        if (original is None or group is None or original['family'] != group['family']
                or any(original['gold'].get(key) != value for key, value in case['gold'].items())
                or not isinstance(case['gold']['justified_nudge'], bool)):
            raise ValueError('development gold or group mapping mismatch')
        case_ids.append(case['case_id'])
        assigned_ids.append(case['primary_request_id'])
        if case['selection_request_id'] is not None:
            assigned_ids.append(case['selection_request_id'])
    if case_ids != development['manifest']['case_ids'] or len(set(assigned_ids)) != len(assigned_ids):
        raise ValueError('development identities mismatch or duplicate requests')
    request_path, request_raw = evidence_file(root, manifest['requests_jsonl'])
    frozen.include(manifest['requests_jsonl'])
    lines = request_raw.splitlines(keepends=True)
    if not 1 <= len(lines) <= MAX_REQUESTS or any(not line.endswith(b'\n') or len(line) > MAX_COMMAND_BYTES for line in lines):
        raise ValueError('requests must be bounded newline-terminated JSONL')
    requests = [decode(line) for line in lines]
    for request in requests:
        exact(request, 'request_id packet judgment question_fingerprint template_fingerprint')
        for path, value in request['packet']['revision']['paths'].items():
            if value is None:
                frozen.absent.add(safe_path(root, path))
    ids = [request['request_id'] for request in requests]
    if len(ids) != len(set(ids)) or set(ids) != set(assigned_ids):
        raise ValueError('request JSONL does not match the frozen manifest')
    by_id = {request['request_id']: request for request in requests}
    for case in manifest['cases']:
        for reference_set in case['gold']['acceptable_reference_sets']:
            if any(item not in by_id[case['primary_request_id']]['packet']['references'] for item in reference_set):
                raise ValueError('development gold references are absent from its frozen packet')
    frozen.verify()
    return frozen, documents, references, requests, lines


def validate_preflight(value, documents, requests, references, frozen):
    exact(value, 'kind schema_version protocol_sha256 fit_plan_sha256 request_manifest_sha256 runtime_config_sha256 provider_argv_sha256 development_manifest_sha256 holdout_manifest_sha256 request_ids referenced_files provider_calls delivery_attempts')
    for field in ('schema_version', 'provider_calls', 'delivery_attempts'):
        unsigned(value[field])
    plan, config = documents['plan'], documents['config']
    expected = {'kind': 'preflighted_development_calibration', 'schema_version': 1,
                'protocol_sha256': plan['protocol_sha256'], 'fit_plan_sha256': canonical(plan),
                'request_manifest_sha256': plan['request_manifest_sha256'],
                'runtime_config_sha256': canonical(config),
                'provider_argv_sha256': canonical(config['provider']['argv']),
                'development_manifest_sha256': plan['development_manifest_sha256'],
                'holdout_manifest_sha256': plan['holdout_manifest_sha256'],
                'request_ids': [request['request_id'] for request in requests],
                'provider_calls': 0, 'delivery_attempts': 0}
    if any(value[key] != expected_value for key, expected_value in expected.items()):
        raise ValueError('core preflight does not bind these frozen inputs')
    seen = {}
    for evidence in value['referenced_files']:
        frozen.include(evidence)
        if evidence['path'] in seen:
            raise ValueError('duplicate preflight file references')
        seen[evidence['path']] = evidence['sha256']
    for evidence in list(references.values()) + [documents['manifest']['requests_jsonl']]:
        if seen.get(evidence['path']) != evidence['sha256']:
            raise ValueError('preflight omitted a frozen input')
    frozen.verify()


def one_json_line(raw):
    if not raw.endswith(b'\n') or len(raw.splitlines()) != 1:
        raise ValueError('missing, duplicate or truncated terminal JSON line')
    return decode(raw)


def unsigned(value):
    evaluator.integer(value)
    if value > 2 ** 64 - 1:
        raise ValueError('integer exceeds u64')


def validate_expert_result(value):
    try:
        NATIVE.validate_expert_result(value)
    except NATIVE.Failure as error:
        raise ValueError('invalid core expert result') from error


def validate_response(value, request, provider):
    exact(value, 'response result provenance mode')
    response = value['response']
    exact(response, 'request_id packet_hash question_fingerprint template_fingerprint provider timing usage provider_request_id self_report diagnostic outcome')
    if (response['request_id'] != request['request_id'] or response['packet_hash'] != request['packet']['hash']
            or response['question_fingerprint'] != request['question_fingerprint']
            or response['template_fingerprint'] != request['template_fingerprint']
            or canonical(response['provider']) != canonical(provider) or value['mode'] != 'shadow' or value['provenance'] != 'imported'):
        raise ValueError('terminal response identity mismatch')
    exact(response['timing'], 'queue_ms inference_ms total_ms')
    for timing in response['timing'].values():
        unsigned(timing)
    if any(response['timing'][name] > response['timing']['total_ms'] for name in ('queue_ms', 'inference_ms')):
        raise ValueError('invalid response timing')
    exact(response['usage'], 'input_tokens output_tokens reported_latency_ms')
    for name in ('input_tokens', 'output_tokens'):
        if response['usage'][name] is not None:
            unsigned(response['usage'][name])
    if response['usage']['reported_latency_ms'] is not None:
        evaluator.number(response['usage']['reported_latency_ms'])
    for name in ('provider_request_id', 'self_report', 'diagnostic'):
        if response[name] is not None and (not isinstance(response[name], str) or len(response[name].encode()) > 2048):
            raise ValueError('invalid nullable response text')
    outcome = response['outcome']
    if not isinstance(outcome, dict) or set(outcome) not in ({'Ok'}, {'Err'}):
        raise ValueError('invalid typed terminal outcome')
    if 'Err' in outcome:
        if outcome['Err'] not in ('unsupported', 'unverified', 'timeout', 'cancelled', 'transport', 'malformed', 'identity_mismatch'):
            raise ValueError('unknown provider failure')
    else:
        answer = outcome['Ok']
        shapes = {'choice': 'kind pick probabilities confidence', 'noul': 'kind value probability confidence',
                  'score': 'kind level distribution expectation confidence'}
        if not isinstance(answer, dict) or answer.get('kind') not in shapes:
            raise ValueError('unknown typed answer')
        exact(answer, shapes[answer['kind']])
        for name in ('confidence', 'probability'):
            if answer.get(name) is not None:
                evaluator.number(answer[name], 0, 1)
        if answer['kind'] == 'choice':
            if not isinstance(answer['pick'], str):
                raise ValueError('invalid choice label')
            probabilities = answer['probabilities']
            if probabilities is not None:
                if not isinstance(probabilities, dict):
                    raise ValueError('invalid choice probabilities')
                for probability in probabilities.values():
                    evaluator.number(probability, 0, 1)
        elif answer['kind'] == 'noul':
            if answer['value'] is not None and not isinstance(answer['value'], bool):
                raise ValueError('invalid noul value')
        else:
            if answer['level'] is not None and not isinstance(answer['level'], str):
                raise ValueError('invalid score level')
            if answer['distribution'] is not None:
                if not isinstance(answer['distribution'], list):
                    raise ValueError('invalid score distribution')
                for probability in answer['distribution']:
                    evaluator.number(probability, 0, 1)
            if answer['expectation'] is not None:
                evaluator.number(answer['expectation'])
    result = value['result']
    validate_expert_result(result)
    if result['request_id'] != request['request_id'] or result['packet_hash'] != request['packet']['hash']:
        raise ValueError('provisional result identity mismatch')
    return response


def validate_fit(result, documents, executions):
    exact(result, 'kind schema_version fit_plan_sha256 request_manifest_sha256 executions_sha256 groups provider_calls delivery_attempts promotion_records')
    plan = documents['plan']
    for field in ('schema_version', 'provider_calls', 'delivery_attempts'):
        unsigned(result[field])
    if (result['kind'] != 'fitted_saved_development' or result['schema_version'] != 1
            or result['fit_plan_sha256'] != canonical(plan)
            or result['request_manifest_sha256'] != canonical(documents['manifest'])
            or result['executions_sha256'] != canonical(executions)
            or result['provider_calls'] != 0 or result['delivery_attempts'] != 0 or result['promotion_records']):
        raise ValueError('pure fitter result identity mismatch')
    if [group['group_id'] for group in result['groups']] != [group['group_id'] for group in plan['groups']]:
        raise ValueError('fitter group identities mismatch')
    selected = []
    for group, declaration in zip(result['groups'], plan['groups']):
        exact(group, 'group_id selected_candidate_id selected_primary selected_selection status candidates')
        if [score['candidate_id'] for score in group['candidates']] != [item['candidate_id'] for item in declaration['candidates']]:
            raise ValueError('fitter candidate identities mismatch')
        expected_cases = [case['case_id'] for case in documents['manifest']['cases'] if case['group_id'] == group['group_id']]
        for score in group['candidates']:
            exact(score, 'candidate_id results planned evaluable proposed false_proposed justified missed_correct provider_failures feasible')
            if not isinstance(score['feasible'], bool):
                raise ValueError('invalid feasibility type')
            for name in ('planned', 'evaluable', 'proposed', 'false_proposed', 'justified', 'missed_correct', 'provider_failures'):
                unsigned(score[name])
            if [decision['case_id'] for decision in score['results']] != expected_cases:
                raise ValueError('fitter case identities mismatch')
            for decision in score['results']:
                exact(decision, 'case_id result')
                validate_expert_result(decision['result'])
        if group['status'] == 'no_feasible_candidate':
            if any(group[key] is not None for key in ('selected_candidate_id', 'selected_primary', 'selected_selection')):
                raise ValueError('infeasible group contains a selected policy')
        elif group['status'] == 'eligible':
            candidates = [item for item in declaration['candidates'] if item['candidate_id'] == group['selected_candidate_id']]
            if len(candidates) != 1 or candidates[0]['primary'] != group['selected_primary'] or candidates[0]['selection'] != group['selected_selection']:
                raise ValueError('fitter changed a frozen policy')
            selected.append(group['selected_primary'])
            if group['selected_selection'] is not None:
                selected.append(group['selected_selection'])
        else:
            raise ValueError('unknown fitter outcome')
    return selected, 'eligible' if selected else 'no_feasible_policy'


class Collector:
    def __init__(self, root, directory, transport, timeout, deadline):
        self.root, self.directory = root, directory
        self.transport, self.timeout, self.deadline = transport, timeout, deadline
        self.commands = []

    def call(self, operation, arguments, stdin=b'', max_bytes=MAX_BYTES):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise ValueError('collection wall-time budget exhausted')
        argv = SOURCE_ARGV + ['expert', operation] + arguments + ['--project', str(self.root), '--json']
        name = str(len(self.commands)).zfill(4) + '-' + operation
        intent = {'argv': argv, 'cwd': str(SOURCE_ROOT), 'stdin_sha256': digest(stdin), 'status': 'started'}
        write_new(self.root, self.directory / (name + '.started.json'), encode(intent), name + '-started')
        captured = dict(self.transport(argv, SOURCE_ROOT, stdin, min(self.timeout, remaining), max_bytes))
        stdout = captured.pop('stdout')
        stderr = captured.pop('stderr')
        if not isinstance(stdout, bytes) or not isinstance(stderr, bytes) or max(len(stdout), len(stderr)) > max_bytes:
            raise ValueError('transport violated its output byte budget')
        receipt = dict(intent, **captured)
        receipt['stdout'] = write_new(self.root, self.directory / (name + '.stdout'), stdout, name + '-stdout')
        receipt['stderr'] = write_new(self.root, self.directory / (name + '.stderr'), stderr, name + '-stderr')
        raw = encode(receipt)
        if len(raw) > MAX_COMMAND_BYTES:
            raise ValueError('command receipt exceeds admission byte budget')
        evidence = write_new(self.root, self.directory / (name + '.json'), raw, name)
        self.commands.append(evidence)
        complete = (captured['status'] == 'completed' and captured['exit_code'] == 0
                    and captured['stdin_complete'] and captured['stdout_complete'] and captured['stderr_complete'])
        return stdout, evidence, complete


def calibrate_live(protocol_path, development_path, request_manifest_path, fit_plan_path,
                   runtime_config_path, project_path, output_path, *, timeout=120,
                   max_wall_seconds=600, transport=None):
    finite_seconds(timeout, 120)
    finite_seconds(max_wall_seconds, 600)
    root = Path(project_path).absolute()
    if root.name == 'project.bla':
        root = root.parent
    safe_path(root, root / 'project.bla')
    try:
        frozen, documents, references, requests, lines = load_inputs(
            protocol_path, development_path, request_manifest_path, fit_plan_path, runtime_config_path, root)
    except (KeyError, TypeError, AttributeError, OverflowError, RecursionError) as error:
        raise ValueError('malformed frozen calibration input') from error
    output_path = safe_path(root, output_path)
    if output_path.exists():
        raise ValueError('calibration output already exists; no retry is permitted')
    directory = output_path.with_name(output_path.name + '.evidence')
    safe_path(root, directory).mkdir(mode=0o700)
    collector = Collector(root, directory, transport or exchange, timeout, time.monotonic() + max_wall_seconds)
    plan, config = documents['plan'], documents['config']
    result = {'kind': 'real_provider_development_calibration', 'schema_version': 1,
              'protocol_sha256': plan['protocol_sha256'],
              'development_manifest_sha256': plan['development_manifest_sha256'],
              'holdout_manifest_sha256': plan['holdout_manifest_sha256'],
              'request_manifest': references['manifest'], 'fit_plan': references['plan'], 'fitted_result': None,
              'provider': plan['provider'], 'provider_argv_sha256': canonical(config['provider']['argv']),
              'runtime_config_sha256': canonical(config), 'executions': [], 'selected': [],
              'policy_sha256': canonical([]), 'status': 'incomplete', 'promotion_records': []}
    receipt = {'kind': 'development_collection_receipt', 'schema_version': 1, 'status': 'incomplete',
               'stop_reason': None, 'commands': collector.commands,
               'requests': [{'request_id': request['request_id'], 'status': 'not_attempted', 'command_evidence': None}
                            for request in requests]}
    try:
        preflight_input = {'kind': 'preflight_development_calibration', 'schema_version': 1,
                           'protocol_evidence': references['protocol'], 'plan_evidence': references['plan'],
                           'manifest_evidence': references['manifest'], 'runtime_config_evidence': references['config']}
        preflight_path = directory / 'preflight-input.json'
        write_new(root, preflight_path, encode(preflight_input), 'preflight-input')
        raw, unused, complete = collector.call('preflight-development-calibration', ['--input', str(preflight_path)])
        if not complete:
            raise ValueError('core preflight failed or is unavailable; no provider call authorized')
        preflight = one_json_line(raw)
        validate_preflight(preflight, documents, requests, references, frozen)
        for name in ('protocol_sha256', 'provider_argv_sha256', 'runtime_config_sha256'):
            result[name] = preflight[name]
        config_copy = directory / 'runtime-config.json'
        frozen.include(write_new(root, config_copy, frozen.files[safe_path(root, runtime_config_path)], 'runtime-config'))
        for request, line, terminal in zip(requests, lines, receipt['requests']):
            frozen.verify()
            terminal['status'] = 'uncertain'
            raw, command, complete = collector.call('evaluate', ['--config', str(config_copy)], line, MAX_COMMAND_BYTES)
            terminal['command_evidence'] = command
            if not complete:
                raise ValueError('command capture is uncertain; request will not be retried')
            if not raw:
                terminal['status'] = 'missing'
                raise ValueError('terminal response is missing; request will not be retried')
            response = validate_response(one_json_line(raw), request, plan['provider'])
            terminal['status'] = 'failed' if 'Err' in response['outcome'] else 'complete'
            result['executions'].append({'request': request, 'response': response, 'command_evidence': command})
            if response['outcome'] == {'Err': 'timeout'}:
                raise ValueError('provider timeout stopped collection; retained terminal response will not be retried')
        frozen.verify()
        fit_input = {'kind': 'fit_saved_development', 'schema_version': 1,
                     'protocol_evidence': references['protocol'], 'plan': plan, 'plan_evidence': references['plan'],
                     'request_manifest': documents['manifest'], 'manifest_evidence': references['manifest'],
                     'executions': result['executions']}
        fit_path = directory / 'fit-input.json'
        write_new(root, fit_path, encode(fit_input), 'fit-input')
        raw, unused, complete = collector.call('fit-saved', ['--input', str(fit_path)])
        if not complete:
            raise ValueError('pure fitting failed or capture is uncertain')
        fitted = decode(raw)
        selected, status = validate_fit(fitted, documents, result['executions'])
        frozen.verify()
        result['fitted_result'] = write_new(root, directory / 'fitted-result.json', raw, 'fitted-result')
        result['selected'], result['status'] = selected, status
        result['policy_sha256'] = canonical(selected)
    except (ValueError, KeyError, TypeError, OSError, OverflowError, RecursionError) as error:
        receipt['stop_reason'] = str(error)[:2048]
    receipt['status'] = result['status']
    write_new(root, directory / 'collection.json', encode(receipt), 'collection')
    write_new(root, output_path, encode(result), 'real-calibration')
    return result
