import argparse
import hashlib
import json
import math
import os
import pathlib
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import threading
import time

MAX_BYTES = 65536
SOURCE_ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE_ARGV = ['cargo', 'run', '--release', '--quiet', '--bin', 'blabla', '--']
DEVELOPMENT_SOURCE_ARGV = ['cargo', 'run', '--quiet', '--bin', 'blabla', '--']
OPERATIONS = ('enroll', 'capture-boundary', 'observe', 'prepare-wake', 'consume',
              'record-response', 'invalidate', 'start-run', 'advance', 'host-claim', 'host-result')
RESULT_KINDS = {
    'enroll': ('enrolled', 'no_advice'),
    'capture-boundary': ('boundary_captured', 'no_advice'),
    'observe': ('boundary_observed', 'no_advice'),
    'prepare-wake': ('request_reserved', 'no_advice'),
    'consume': ('consumed', 'no_advice'),
    'record-response': ('response_observed', 'no_advice'),
    'invalidate': ('invalidated', 'no_advice'),
    'start-run': ('pending', 'checkpoint_due', 'awaiting_permit', 'arm_stopped', 'arm_finished'),
    'advance': ('pending', 'checkpoint_due', 'awaiting_permit', 'arm_stopped', 'arm_finished'),
    'host-claim': ('claimed', 'refused'),
    'host-result': ('recorded', 'refused'),
    'host-next': ('pending', 'none'),
}
REFUSALS = frozenset(('invalid_input identity_mismatch epoch_mismatch origin_mismatch generation_mismatch '
    'sequence_gap task_not_accepted stale_revision stale_checkpoint unsupported_capability permit_missing '
    'permit_mismatch permit_revoked expired clock_uncertain budget_exhausted already_claimed already_consumed '
    'duplicate_delivery uncertain_delivery missing_context non_actionable runtime_changed storage_missing '
    'storage_corrupt ledger_exhausted').split())
TOOL_SURFACE = {
    'spawn_agent': {'required': ['message', 'task_name'],
                    'optional': ['fork_turns', 'model', 'reasoning_effort'], 'argument_type': 'string'},
    'list_agents': {'required': [], 'optional': ['path_prefix'], 'argument_type': 'string'},
    'followup_task': {'required': ['message', 'target'], 'optional': [], 'argument_type': 'string'},
    'wait_agent': {'required': [], 'optional': ['timeout_ms'], 'argument_type': 'integer',
                   'timeout_ms_min': 10000, 'timeout_ms_max': 3600000},
    'followup_semantics': 'may_queue_to_running_child_without_compare_and_send',
}


class Failure(Exception):
    def __init__(self, code, message, exit_code=2):
        self.code = code
        self.exit_code = exit_code
        super().__init__(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Failure('malformed', 'duplicate JSON field')
        result[key] = value
    return result


def invalid_constant(value):
    raise Failure('malformed', 'nonfinite JSON number')


def encode(value):
    try:
        raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
                         allow_nan=False).encode('utf-8')
    except (ValueError, TypeError, UnicodeError, RecursionError) as error:
        raise Failure('malformed', 'invalid JSON value') from error
    if len(raw) > MAX_BYTES:
        raise Failure('overflow', 'native object exceeds byte limit')
    return raw


def decode(raw):
    try:
        if isinstance(raw, str):
            raw = raw.encode('utf-8')
        if not isinstance(raw, bytes) or len(raw) > MAX_BYTES:
            raise Failure('overflow', 'native object exceeds byte limit')
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object,
                           parse_constant=invalid_constant)
        encode(value)
        return value
    except (ValueError, UnicodeError, RecursionError) as error:
        raise Failure('malformed', 'invalid UTF-8 JSON') from error


def read_json(path):
    try:
        with pathlib.Path(path).open('rb') as stream:
            return decode(stream.read(MAX_BYTES + 1))
    except OSError as error:
        raise Failure('io', 'cannot read request file', 4) from error


def fields(value, names):
    if not isinstance(value, dict) or set(value) != set(names.split()):
        raise Failure('malformed', 'unexpected or missing fields')


def text(value, limit=256, nonempty=True):
    if not isinstance(value, str) or (nonempty and not value):
        raise Failure('malformed', 'invalid text')
    try:
        if len(value.encode('utf-8')) > limit:
            raise Failure('overflow', 'text exceeds byte limit')
    except UnicodeError as error:
        raise Failure('malformed', 'invalid UTF-8 text') from error


def identifier(value):
    text(value)
    if re.fullmatch(r'[A-Za-z0-9_.:-]+', value) is None:
        raise Failure('malformed', 'invalid identifier')


def integer(value, minimum=0):
    if type(value) is not int or not minimum <= value <= 2 ** 64 - 1:
        raise Failure('malformed', 'invalid integer')


def literal(value, expected):
    if type(value) is not type(expected) or value != expected:
        raise Failure('malformed', 'unexpected literal')


def hexadecimal(value, length):
    if not isinstance(value, str) or re.fullmatch('[0-9a-f]{' + str(length) + '}', value) is None:
        raise Failure('malformed', 'invalid hexadecimal value')


def validate_child(value):
    fields(value, 'agent_id task_name')
    text(value['task_name'])
    if value['agent_id'] is not None:
        text(value['agent_id'])


def validate_revision(value):
    fields(value, 'acceptance_epoch task_digest paths identities')
    integer(value['acceptance_epoch'], 1)
    text(value['task_digest'])
    for name in ('paths', 'identities'):
        if not isinstance(value[name], dict):
            raise Failure('malformed', 'invalid revision map')
        for key, digest in value[name].items():
            text(key, MAX_BYTES)
            if digest is not None or name == 'identities':
                text(digest)


def validate_key(value):
    fields(value, 'run_id task acceptance_epoch child generation checkpoint_id sequence previous_sequence boundary_nonce assignment_revision')
    for name in ('run_id', 'task', 'checkpoint_id'):
        identifier(value[name])
    if not value['task'].startswith('task::'):
        raise Failure('malformed', 'task identity needs canonical prefix')
    for name in ('acceptance_epoch', 'generation'):
        integer(value[name], 1)
    integer(value['sequence'])
    if value['previous_sequence'] is not None:
        integer(value['previous_sequence'])
    hexadecimal(value['boundary_nonce'], 32)
    validate_child(value['child'])
    validate_revision(value['assignment_revision'])


def validate_wake(value):
    fields(value, 'kind schema_version run_id checkpoint_id wake_nonce')
    literal(value['kind'], 'blabla_native_wake')
    literal(value['schema_version'], 1)
    identifier(value['run_id'])
    identifier(value['checkpoint_id'])
    hexadecimal(value['wake_nonce'], 32)


def validate_host_request(value):
    encode(value)
    fields(value, 'schema_version operation_id key created deadline_boottime_ms payload')
    literal(value['schema_version'], 1)
    identifier(value['operation_id'])
    validate_key(value['key'])
    fields(value['created'], 'boot_id boottime_ms unix_ms')
    text(value['created']['boot_id'])
    integer(value['created']['boottime_ms'])
    integer(value['created']['unix_ms'])
    integer(value['deadline_boottime_ms'])
    action = value['payload']
    if not isinstance(action, dict):
        raise Failure('malformed', 'invalid host action')
    kind = action.get('kind')
    if kind == 'inspect_child':
        fields(action, 'kind')
    elif kind == 'continue_work':
        fields(action, 'kind brief brief_sha256')
        text(action['brief'], 8192, False)
        hexadecimal(action['brief_sha256'], 64)
    elif kind == 'wake_worker':
        fields(action, 'kind wake')
        validate_wake(action['wake'])
        if any(action['wake'][name] != value['key'][name] for name in ('run_id', 'checkpoint_id')):
            raise Failure('identity_mismatch', 'wake does not match request key')
    elif kind == 'await_boundary':
        fields(action, 'kind expected_nonce')
        hexadecimal(action['expected_nonce'], 32)
    else:
        raise Failure('unsupported', 'unknown host action')


def host_call(request):
    validate_host_request(request)
    action = request['payload']
    target = request['key']['child']['task_name']
    if action['kind'] == 'inspect_child':
        return {'tool': 'collaboration.list_agents', 'arguments': {'path_prefix': target}}
    if action['kind'] == 'await_boundary':
        return {'tool': 'collaboration.wait_agent', 'arguments': {'timeout_ms': 10000}}
    message = action['wake'] if action['kind'] == 'wake_worker' else {
        'kind': 'blabla_native_work', 'schema_version': 1, 'key': request['key'],
        'brief': action['brief'], 'brief_sha256': action['brief_sha256']}
    return {'tool': 'collaboration.followup_task', 'arguments': {'target': target, 'message': encode(message).decode('utf-8')}}


def one_of(value, choices):
    if not isinstance(value, str) or value not in choices:
        raise Failure('malformed', 'unexpected tag')


def validate_completion(value):
    fields(value, 'run_id checkpoint_id request_id wake_nonce refusal_nonce refusal_sha256 code')
    for name in ('run_id', 'checkpoint_id', 'request_id'):
        identifier(value[name])
    for name in ('wake_nonce', 'refusal_nonce'):
        hexadecimal(value[name], 32)
    hexadecimal(value['refusal_sha256'], 64)
    one_of(value['code'], REFUSALS)


def validate_marker(value):
    if not isinstance(value, dict):
        raise Failure('malformed', 'invalid native marker')
    names = {
        'blabla_native_ready': 'run_id task acceptance_epoch',
        'blabla_native_probe_ready': 'proof_id',
        'blabla_native_probe_response': 'proof_id nonce',
        'blabla_native_boundary': 'run_id task acceptance_epoch child_attestation generation sequence boundary_nonce capture_id capture_sha256',
        'blabla_native_response': 'run_id checkpoint_id request_id wake_nonce consume_nonce result_sha256 child_attestation disposition',
        'blabla_native_no_advice': 'completion child_attestation',
    }
    kind = value.get('kind')
    one_of(kind, names)
    fields(value, 'kind schema_version ' + names[kind])
    literal(value['schema_version'], 1)
    for name in ('run_id', 'task', 'proof_id', 'capture_id', 'checkpoint_id', 'request_id'):
        if name in value:
            identifier(value[name])
    if 'task' in value and not value['task'].startswith('task::'):
        raise Failure('malformed', 'task identity needs canonical prefix')
    for name in ('acceptance_epoch', 'generation', 'sequence'):
        if name in value:
            integer(value[name], 1)
    for name in ('nonce', 'boundary_nonce', 'wake_nonce', 'consume_nonce'):
        if name in value:
            hexadecimal(value[name], 32)
    for name in ('capture_sha256', 'result_sha256'):
        if name in value:
            hexadecimal(value[name], 64)
    if 'child_attestation' in value:
        validate_child(value['child_attestation'])
    if 'completion' in value:
        validate_completion(value['completion'])
    if 'disposition' in value:
        one_of(value['disposition'], ('acknowledged', 'declined'))


def validate_sent(value):
    if not isinstance(value, dict):
        raise Failure('malformed', 'invalid sent protocol')
    kind = value.get('kind')
    one_of(kind, ('probe', 'wake', 'work'))
    if kind == 'work':
        fields(value, 'kind message_sha256')
        hexadecimal(value['message_sha256'], 64)
    else:
        fields(value, 'kind message')
        if kind == 'wake':
            validate_wake(value['message'])
        else:
            message = value['message']
            fields(message, 'kind schema_version proof_id nonce')
            literal(message['kind'], 'blabla_native_probe')
            literal(message['schema_version'], 1)
            identifier(message['proof_id'])
            hexadecimal(message['nonce'], 32)


def validate_observation(value):
    encode(value)
    fields(value, 'kind schema_version record_id coordinator capture_session local_sequence operation_id attestation projection')
    literal(value['kind'], 'native_tool_observation')
    literal(value['schema_version'], 1)
    literal(value['attestation'], 'coordinator_observed_native_surface')
    identifier(value['record_id'])
    validate_child(value['coordinator'])
    hexadecimal(value['capture_session'], 32)
    integer(value['local_sequence'], 1)
    if value['operation_id'] is not None:
        identifier(value['operation_id'])
    projected = value['projection']
    if not isinstance(projected, dict):
        raise Failure('malformed', 'invalid native projection')
    kind = projected.get('kind')
    if kind == 'tool_surface':
        fields(projected, 'kind source surface')
        literal(projected['source'], 'exposed_tool_contract')
        if encode(projected['surface']) != encode(TOOL_SURFACE):
            raise Failure('unsupported_capability', 'exposed native invocation contract changed')
    elif kind == 'spawn':
        fields(projected, 'kind tool requested_task_name returned')
        literal(projected['tool'], 'collaboration.spawn_agent')
        text(projected['requested_task_name'])
        validate_child(projected['returned'])
    elif kind == 'status':
        fields(projected, 'kind tool path_prefix selected')
        literal(projected['tool'], 'collaboration.list_agents')
        if projected['path_prefix'] is not None:
            text(projected['path_prefix'])
        selected = projected['selected']
        if selected is not None:
            if not isinstance(selected, dict):
                raise Failure('malformed', 'invalid selected native status')
            one_of(selected.get('kind'), ('completed', 'running', 'unknown'))
            fields(selected, 'kind agent_name agent_id' + (' marker' if selected['kind'] == 'completed' else ''))
            validate_child({'task_name': selected['agent_name'], 'agent_id': selected['agent_id']})
            if selected['kind'] == 'completed':
                validate_marker(selected['marker'])
    elif kind == 'followup':
        fields(projected, 'kind tool target_task_name sent outcome')
        literal(projected['tool'], 'collaboration.followup_task')
        text(projected['target_task_name'])
        validate_sent(projected['sent'])
        one_of(projected['outcome'], ('returned_without_error', 'explicit_rejection', 'unknown'))
    elif kind == 'completion':
        fields(projected, 'kind source origin marker')
        literal(projected['source'], 'native_completion_notification')
        validate_child(projected['origin'])
        validate_marker(projected['marker'])
    elif kind == 'not_invoked':
        fields(projected, 'kind tool reason')
        one_of(projected['tool'], ('collaboration.list_agents', 'collaboration.followup_task', 'collaboration.wait_agent'))
        one_of(projected['reason'], ('cancelled_before_call', 'deadline_before_call'))
    elif kind == 'unavailable':
        fields(projected, 'kind source reason')
        one_of(projected['source'], ('collaboration.spawn_agent', 'collaboration.list_agents',
            'collaboration.followup_task', 'collaboration.wait_agent', 'native_completion_notification', 'exposed_tool_contract'))
        one_of(projected['reason'], ('missing_result', 'unrecognized_shape', 'ambiguous_origin', 'tool_error'))
    else:
        raise Failure('malformed', 'unknown native projection')


def new_probe_challenge(proof_id, coordinator):
    identifier(proof_id)
    validate_child(coordinator)
    session = secrets.token_hex(16)
    nonce = secrets.token_hex(16)
    while nonce == session:
        nonce = secrets.token_hex(16)
    return {'kind': 'native_probe_challenge', 'schema_version': 1, 'proof_id': proof_id,
            'coordinator': coordinator, 'capture_session': session, 'nonce': nonce}


def evidence_path(path):
    text(path, MAX_BYTES)
    parts = pathlib.PurePosixPath(path)
    if parts.is_absolute() or parts.as_posix() != path or any(part in ('.', '..') for part in parts.parts) or '\\' in path or pathlib.PureWindowsPath(path).drive:
        raise Failure('malformed', 'evidence path must be normalized and project-relative')
    if not parts.parts:
        raise Failure('malformed', 'empty evidence path')
    return parts


def evidence_descriptor(path, flags):
    parts = evidence_path(path)
    nofollow = getattr(os, 'O_NOFOLLOW', 0)
    if os.open in os.supports_dir_fd and hasattr(os, 'O_DIRECTORY'):
        directory = os.open('.', os.O_RDONLY | os.O_DIRECTORY)
        try:
            for part in parts.parts[:-1]:
                following = os.open(part, os.O_RDONLY | os.O_DIRECTORY | nofollow, dir_fd=directory)
                os.close(directory)
                directory = following
            return os.open(parts.parts[-1], flags | nofollow, 0o600, dir_fd=directory)
        finally:
            os.close(directory)
    current = pathlib.Path.cwd()
    for part in parts.parts:
        current /= part
        if current.is_symlink():
            raise Failure('malformed', 'evidence path contains a symlink')
    return os.open(current, flags | nofollow, 0o600)


def write_observation(observation, path):
    validate_observation(observation)
    raw = encode(observation) + b'\n'
    if len(raw) > MAX_BYTES:
        raise Failure('overflow', 'evidence exceeds byte limit')
    try:
        with os.fdopen(evidence_descriptor(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL), 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
    except OSError as error:
        raise Failure('io', 'cannot create evidence; preserve existing or uncertain file', 4) from error
    return {'id': observation['record_id'], 'path': path, 'sha256': hashlib.sha256(raw).hexdigest()}


def verify_observation(observation, evidence):
    validate_observation(observation)
    fields(evidence, 'id path sha256')
    identifier(evidence['id'])
    hexadecimal(evidence['sha256'], 64)
    try:
        with os.fdopen(evidence_descriptor(evidence['path'], os.O_RDONLY), 'rb') as stream:
            raw = stream.read(MAX_BYTES + 1)
    except OSError as error:
        raise Failure('io', 'cannot read evidence file', 4) from error
    saved = decode(raw)
    validate_observation(saved)
    if hashlib.sha256(raw).hexdigest() != evidence['sha256'] or evidence['id'] != saved['record_id'] or encode(saved) != encode(observation):
        raise Failure('identity_mismatch', 'observation does not match saved evidence')


def correlate_origin(observed, enrolled):
    if observed['task_name'] != enrolled['task_name'] or (observed['agent_id'] is not None and observed['agent_id'] != enrolled['agent_id']):
        raise Failure('origin_mismatch', 'native origin differs from enrolled child')
    return enrolled


def bind_marker(request, marker):
    key = request['key']
    kind = marker['kind']
    if kind not in ('blabla_native_ready', 'blabla_native_boundary', 'blabla_native_response', 'blabla_native_no_advice'):
        raise Failure('identity_mismatch', 'probe marker cannot complete a run operation')
    identity = marker['completion'] if kind == 'blabla_native_no_advice' else marker
    for name, code in (('run_id', 'identity_mismatch'), ('task', 'identity_mismatch'),
                       ('acceptance_epoch', 'epoch_mismatch'), ('generation', 'generation_mismatch'),
                       ('checkpoint_id', 'identity_mismatch')):
        if name in identity and identity[name] != key[name]:
            raise Failure(code, 'native marker identity differs from request')
    if 'child_attestation' in marker and marker['child_attestation'] != key['child']:
        raise Failure('identity_mismatch', 'worker attestation differs from enrolled child')
    if kind == 'blabla_native_ready' and key['sequence'] != 0:
        raise Failure('stale_checkpoint', 'initial readiness cannot replace a completed work boundary')
    if kind == 'blabla_native_boundary' and marker['boundary_nonce'] != key['boundary_nonce']:
        raise Failure('identity_mismatch', 'boundary nonce differs from request')
    if request['payload']['kind'] == 'await_boundary':
        nonce = identity.get('boundary_nonce', identity.get('wake_nonce'))
        if nonce != request['payload']['expected_nonce']:
            raise Failure('identity_mismatch', 'completion nonce differs from awaited request')


def normalize_event(request, observation, evidence):
    validate_host_request(request)
    verify_observation(observation, evidence)
    if observation['operation_id'] != request['operation_id']:
        raise Failure('identity_mismatch', 'observation belongs to another operation')
    projected = observation['projection']
    action = request['payload']['kind']
    expected_call = host_call(request)
    source = projected.get('tool', projected.get('source'))
    allowed_sources = {expected_call['tool']}
    if action == 'await_boundary':
        allowed_sources.add('native_completion_notification')
    if source not in allowed_sources:
        raise Failure('identity_mismatch', 'observation source differs from requested operation')
    kind = projected['kind']
    if kind == 'unavailable':
        reason = {'unrecognized_shape': 'missing_result'}.get(projected['reason'], projected['reason'])
        outcome = {'kind': 'unknown', 'reason': reason}
    elif kind == 'not_invoked':
        outcome = {'kind': 'not_invoked', 'reason': projected['reason']}
    elif action == 'inspect_child' and kind == 'status':
        if projected['path_prefix'] != request['key']['child']['task_name']:
            raise Failure('identity_mismatch', 'status query differs from enrolled target')
        selected = projected['selected']
        status = 'missing'
        if selected is not None:
            correlate_origin({'task_name': selected['agent_name'], 'agent_id': selected['agent_id']}, request['key']['child'])
            if selected['kind'] == 'completed':
                bind_marker(request, selected['marker'])
                status = 'idle'
            elif selected['kind'] == 'running':
                status = 'running'
        outcome = {'kind': 'child_status', 'child': request['key']['child'], 'status': status}
    elif action in ('continue_work', 'wake_worker') and kind == 'followup':
        if projected['target_task_name'] != request['key']['child']['task_name']:
            raise Failure('origin_mismatch', 'followup target differs from enrolled child')
        sent = {'kind': 'wake', 'message': request['payload']['wake']} if action == 'wake_worker' else {
            'kind': 'work', 'message_sha256': hashlib.sha256(expected_call['arguments']['message'].encode('utf-8')).hexdigest()}
        if encode(projected['sent']) != encode(sent):
            raise Failure('identity_mismatch', 'actual sent content differs from request')
        if projected['outcome'] == 'returned_without_error':
            outcome = {'kind': 'wake_accepted' if action == 'wake_worker' else 'continuation_accepted', 'child': request['key']['child']}
        else:
            outcome = {'kind': 'unknown', 'reason': 'tool_error' if projected['outcome'] == 'explicit_rejection' else 'missing_result'}
    elif action == 'await_boundary' and kind == 'completion':
        origin = correlate_origin(projected['origin'], request['key']['child'])
        marker = projected['marker']
        bind_marker(request, marker)
        if marker['kind'] == 'blabla_native_boundary':
            outcome = {'kind': 'boundary_returned', 'origin': origin, 'marker': marker}
        elif marker['kind'] in ('blabla_native_response', 'blabla_native_no_advice'):
            outcome = {'kind': 'worker_response', 'origin': origin, 'response': marker}
        else:
            raise Failure('identity_mismatch', 'unexpected awaited marker')
    else:
        raise Failure('identity_mismatch', 'projection does not match requested action')
    result = {'schema_version': 1, 'operation_id': request['operation_id'],
              'request_sha256': hashlib.sha256(encode(request)).hexdigest(), 'key': request['key'],
              'evidence': evidence, 'payload': outcome}
    encode(result)
    return result


def array(value, validate, limit=MAX_BYTES):
    if not isinstance(value, list) or len(value) > limit:
        raise Failure('malformed', 'invalid bounded array')
    for item in value:
        validate(item)


def validate_clock(value):
    fields(value, 'boot_id boottime_ms unix_ms')
    text(value['boot_id'])
    integer(value['boottime_ms'])
    integer(value['unix_ms'])


def validate_checkpoint(value):
    fields(value, 'key selected')
    validate_key(value['key'])
    def binding(item):
        fields(item, 'binding_id revision packet_hash question_fingerprint template_fingerprint')
        identifier(item['binding_id'])
        if not item['binding_id'].startswith('binding::'):
            raise Failure('malformed', 'binding identity needs canonical prefix')
        validate_revision(item['revision'])
        for name in ('packet_hash', 'question_fingerprint', 'template_fingerprint'):
            text(item[name])
    array(value['selected'], binding, 4)


def validate_native_event(value):
    fields(value, 'event_id run_id task checkpoint_id sequence previous_sequence unix_ms kind host observations')
    for name in ('event_id', 'run_id', 'task', 'checkpoint_id'):
        identifier(value[name])
    for name in ('sequence', 'unix_ms'):
        integer(value[name])
    if value['previous_sequence'] is not None:
        integer(value['previous_sequence'])
    literal(value['kind'], 'turn_end')
    literal(value['observations'], [])
    host = value['host']
    fields(host, 'host version adapter checkpoints pauses_worker same_task_delivery delivery_receipts pre_tool_control gaps')
    for name in ('host', 'version', 'adapter'):
        text(host[name])
    for name in ('pauses_worker', 'same_task_delivery', 'delivery_receipts', 'pre_tool_control'):
        if type(host[name]) is not bool:
            raise Failure('malformed', 'invalid host capability Boolean')
    array(host['checkpoints'], lambda kind: one_of(kind, ('plan', 'tool_call', 'tool_result', 'claim', 'turn_end', 'review')))
    array(host['gaps'], lambda item: text(item, 2048))


def validate_authority(value):
    fields(value, 'kind run_id permit_id permit_sha256')
    literal(value['kind'], 'experimental')
    identifier(value['run_id'])
    identifier(value['permit_id'])
    hexadecimal(value['permit_sha256'], 64)


def validate_expert_result(value):
    fields(value, 'request_id packet_hash outcome references template message reason')
    identifier(value['request_id'])
    text(value['packet_hash'])
    one_of(value['outcome'], ('silence', 'abstain', 'nudge', 'escalation'))
    array(value['references'], identifier, 4)
    if value['template'] is not None:
        one_of(value['template'], ('read_identity', 'cite_evidence', 'reconsider_approach', 'ask_owner'))
    if value['message'] is not None:
        text(value['message'], 2048, False)
    text(value['reason'], 2048, False)


def validate_reference(value):
    fields(value, 'id path sha256')
    identifier(value['id'])
    hexadecimal(value['sha256'], 64)
    evidence_path(value['path'])


def validate_receipt(value):
    fields(value, 'request_id idempotency_key key recorded category')
    identifier(value['request_id'])
    text(value['idempotency_key'])
    validate_key(value['key'])
    validate_clock(value['recorded'])
    category = value['category']
    if not isinstance(category, dict):
        raise Failure('malformed', 'invalid receipt category')
    names = {'transport_accepted': 'operation_id evidence', 'exposure_attempted': 'consume_nonce result_sha256',
             'acknowledged': 'response_operation_id evidence', 'declined': 'response_operation_id evidence',
             'observed_resolved': 'task_evidence_id', 'not_exposed': 'reason refusal_sha256', 'unknown': 'reason'}
    kind = category.get('kind')
    one_of(kind, names)
    fields(category, 'kind ' + names[kind])
    for name in ('operation_id', 'response_operation_id', 'task_evidence_id'):
        if name in category:
            identifier(category[name])
    if 'evidence' in category:
        validate_reference(category['evidence'])
    if kind == 'exposure_attempted':
        hexadecimal(category['consume_nonce'], 32)
        hexadecimal(category['result_sha256'], 64)
    if kind == 'not_exposed':
        one_of(category['reason'], ('cancelled_before_consume', 'stale_before_consume', 'consume_refused'))
        if category['refusal_sha256'] is not None:
            hexadecimal(category['refusal_sha256'], 64)
    if kind == 'unknown':
        one_of(category['reason'], ('dispatch_result_missing', 'consume_result_missing', 'response_deadline', 'storage_uncertain'))


def validate_native_result(operation, value):
    if not isinstance(value, dict):
        raise Failure('malformed', 'core output must be an object')
    kind = value.get('kind')
    one_of(kind, RESULT_KINDS[operation])
    names = {
        'enrolled': 'key', 'boundary_captured': 'marker', 'boundary_observed': 'checkpoint event',
        'request_reserved': 'checkpoint request_id idempotency_key host_operation',
        'consumed': 'checkpoint request_id idempotency_key consume_nonce result_sha256 result authority',
        'response_observed': 'request_id receipt', 'invalidated': 'run_id generation',
        'no_advice': 'code completion', 'pending': 'request', 'checkpoint_due': 'observation',
        'awaiting_permit': 'run_id', 'arm_stopped': 'run_id code', 'arm_finished': 'run_id',
        'none': 'run_id', 'claimed': 'operation_id', 'recorded': 'operation_id', 'refused': 'code',
    }
    fields(value, 'kind ' + names[kind])
    for name in ('run_id', 'request_id', 'operation_id'):
        if name in value:
            identifier(value[name])
    if 'code' in value:
        one_of(value['code'], REFUSALS)
    if 'generation' in value:
        integer(value['generation'], 1)
    if 'idempotency_key' in value:
        text(value['idempotency_key'])
    for name, validate in (('key', validate_key), ('checkpoint', validate_checkpoint),
                           ('event', validate_native_event), ('host_operation', validate_host_request),
                           ('request', validate_host_request), ('result', validate_expert_result),
                           ('authority', validate_authority), ('receipt', validate_receipt)):
        if name in value:
            validate(value[name])
    if 'marker' in value:
        validate_marker(value['marker'])
        literal(value['marker']['kind'], 'blabla_native_boundary')
    if kind == 'consumed':
        hexadecimal(value['consume_nonce'], 32)
        hexadecimal(value['result_sha256'], 64)
    if kind == 'no_advice' and value['completion'] is not None:
        validate_completion(value['completion'])
        literal(value['completion']['code'], value['code'])
    if kind == 'checkpoint_due':
        observed = value['observation']
        fields(observed, 'schema_version kind key boundary_operation_id idle_operation_id config_sha256')
        literal(observed['schema_version'], 1)
        literal(observed['kind'], 'observe')
        validate_key(observed['key'])
        identifier(observed['boundary_operation_id'])
        identifier(observed['idle_operation_id'])
        hexadecimal(observed['config_sha256'], 64)


def validate_checkpoint_output(value):
    fields(value, 'execution mode capture_status provider_calls proposal_ids captured omitted_evaluations usage')
    modes = ('off', 'shadow', 'advisory')
    one_of(value['mode'], modes)
    one_of(value['capture_status'], ('disabled', 'abstained', 'captured'))
    for name in ('provider_calls', 'captured', 'omitted_evaluations'):
        integer(value[name])
    array(value['proposal_ids'], identifier, 4)
    execution = value['execution']
    if not isinstance(execution, dict):
        raise Failure('malformed', 'invalid execution identity')
    one_of(execution.get('kind'), ('ordinary', 'experimental'))
    if execution['kind'] == 'ordinary':
        fields(execution, 'kind')
    else:
        fields(execution, 'kind run_id experiment_id arm protocol_sha256 native_plan_sha256 authority capability_sha256')
        identifier(execution['run_id'])
        identifier(execution['experiment_id'])
        one_of(execution['arm'], modes)
        for name in ('protocol_sha256', 'native_plan_sha256', 'capability_sha256'):
            hexadecimal(execution[name], 64)
        if execution['authority'] is not None:
            validate_authority(execution['authority'])
    usage = value['usage']
    fields(usage, 'input_tokens output_tokens reported_latency_ms')
    for name in ('input_tokens', 'output_tokens'):
        if usage[name] is not None:
            integer(usage[name])
    latency = usage['reported_latency_ms']
    if latency is not None and (type(latency) not in (int, float) or not math.isfinite(latency) or latency < 0):
        raise Failure('malformed', 'invalid reported latency')


def stop_owned(process):
    try:
        if os.name == 'posix':
            os.killpg(process.pid, signal.SIGKILL)
        elif process.poll() is None:
            process.kill()
    except ProcessLookupError:
        pass


def exchange(argv, cwd, timeout):
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0:
        raise Failure('malformed', 'timeout must be a positive finite number')
    try:
        process = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=os.name == 'posix')
    except OSError as error:
        raise Failure('io', 'cannot start core CLI', 4) from error
    output = {}
    errors = []
    deadline = time.monotonic() + timeout
    def collect(name, stream):
        try:
            output[name] = stream.read(MAX_BYTES + 1)
            if len(output[name]) > MAX_BYTES:
                errors.append('overflow')
                stop_owned(process)
        except OSError:
            errors.append('io')
            stop_owned(process)
    readers = [threading.Thread(target=collect, args=(name, stream))
               for name, stream in (('stdout', process.stdout), ('stderr', process.stderr))]
    for reader in readers:
        reader.start()
    try:
        process.wait(timeout=max(.001, deadline - time.monotonic()))
        for reader in readers:
            reader.join(max(0, deadline - time.monotonic()))
        if any(reader.is_alive() for reader in readers):
            raise subprocess.TimeoutExpired(argv, timeout)
    except subprocess.TimeoutExpired:
        errors.append('timeout')
    finally:
        stop_owned(process)
        process.wait()
        for reader in readers:
            reader.join()
        process.stdout.close()
        process.stderr.close()
    if errors:
        raise Failure(errors[0], 'core output uncertain; reconcile durable state before any further action', 4)
    if process.returncode:
        diagnostic = (output['stderr'] or output['stdout'])[:2048].decode('utf-8', errors='replace').strip()
        raise Failure('core', 'core rejected the operation; no retry was attempted: ' + diagnostic,
                      process.returncode if process.returncode in (2, 4) else 4)
    return output['stdout']


class CoreCLI:
    def __init__(self, project=None, blabla_argv=None, timeout=120):
        self.project = pathlib.Path(project or pathlib.Path.cwd()).resolve()
        if blabla_argv is not None and not isinstance(blabla_argv, list):
            raise Failure('malformed', 'blabla argv must be a JSON string array')
        source = SOURCE_ROOT is not None and (SOURCE_ROOT / 'Cargo.toml').is_file() and (SOURCE_ROOT / 'src/cli/expert.rs').is_file()
        if source and blabla_argv is not None and blabla_argv not in (SOURCE_ARGV, DEVELOPMENT_SOURCE_ARGV):
            raise Failure('source_required', 'this checkout requires current-source Cargo')
        self.argv = list(blabla_argv if blabla_argv is not None else SOURCE_ARGV if source else ['blabla'])
        if not self.argv or isinstance(blabla_argv, str) or any(not isinstance(item, str) or not item or '\0' in item for item in self.argv):
            raise Failure('malformed', 'blabla argv must be a nonempty JSON string array')
        self.cwd = SOURCE_ROOT if source else self.project
        self.timeout = timeout

    def call(self, arguments, request=None, flag='--request'):
        with tempfile.TemporaryDirectory(prefix='blabla-native-') as temporary:
            argv = self.argv + ['expert'] + list(arguments)
            if request is not None:
                if not isinstance(request, dict):
                    raise Failure('malformed', 'request must be a JSON object')
                path = pathlib.Path(temporary) / 'request.json'
                path.write_bytes(encode(request))
                argv += [flag, str(path)]
            argv += ['--project', str(self.project), '--json']
            raw = exchange(argv, self.cwd, self.timeout)
            try:
                result = decode(raw)
                if arguments[0] == 'native':
                    validate_native_result(arguments[1], result)
                else:
                    validate_checkpoint_output(result)
                return result
            except (Failure, KeyError, TypeError, ValueError, OverflowError) as error:
                raise Failure('uncertain_output', 'core output is incomplete or invalid; reconcile durable state without retrying', 4) from error

    def invoke(self, operation, request):
        if operation not in OPERATIONS:
            raise Failure('unsupported', 'unknown native operation')
        return self.call(['native', operation], request)

    def host_next(self, run_id):
        return self.call(['native', 'host-next', '--run', run_id])

    def checkpoint(self, run_id, event):
        return self.call(['checkpoint', '--experimental-run', run_id], event, '--event')


def handle_checkpoint(core, request):
    boundary = core.invoke('observe', request)
    evaluation = None
    if boundary.get('kind') == 'boundary_observed':
        evaluation = core.checkpoint(request['key']['run_id'], boundary['event'])
    return {'boundary': boundary, 'evaluation': evaluation}


def record_receipt(core, request):
    return core.invoke('record-response', request)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Bounded cooperative native host/core rendezvous')
    parser.add_argument('--project', type=pathlib.Path)
    parser.add_argument('--blabla-argv')
    parser.add_argument('--timeout', type=float, default=120)
    commands = parser.add_subparsers(dest='operation', required=True)
    for operation in OPERATIONS:
        commands.add_parser(operation).add_argument('--request', required=True, type=pathlib.Path)
    commands.add_parser('host-next').add_argument('--run', required=True)
    args = parser.parse_args(argv)
    try:
        core = CoreCLI(args.project, decode(args.blabla_argv) if args.blabla_argv is not None else None, args.timeout)
        result = core.host_next(args.run) if args.operation == 'host-next' else core.invoke(args.operation, read_json(args.request))
        sys.stdout.buffer.write(encode(result) + b'\n')
        sys.stdout.buffer.flush()
        return 0
    except Failure as error:
        print(json.dumps({'kind': 'helper_error', 'code': error.code, 'message': str(error)}), file=sys.stderr)
        return error.exit_code
    except OSError:
        print('native output unavailable; do not retry a possible exposure', file=sys.stderr)
        return 4


if __name__ == '__main__':
    raise SystemExit(main())
