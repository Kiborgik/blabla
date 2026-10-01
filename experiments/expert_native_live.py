import hashlib
import importlib.util
import pathlib

if __package__:
    from . import expert_eval
else:
    import expert_eval


SPEC = importlib.util.spec_from_file_location('blabla_native_live_adapter',
    pathlib.Path(__file__).resolve().parents[1] / 'adapters/native/expert.py')
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


def checked_path(root, relative):
    parts = native.evidence_path(relative)
    path = root
    for part in parts.parts:
        path /= part
        if path.is_symlink():
            raise ValueError('native input path contains a symlink')
    return path


def read_bytes(root, relative, limit=native.MAX_BYTES):
    path = checked_path(root, relative)
    if not path.is_file() or path.stat().st_size > limit:
        raise ValueError('native input is missing or exceeds byte limit')
    with path.open('rb') as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError('native input exceeds byte limit')
    return raw


def reference(record_id, path, raw):
    return {'id': record_id, 'path': path, 'sha256': hashlib.sha256(raw).hexdigest()}


def freeze_inputs(protocol_path, native_plan_path, project_roots):
    protocol_path, native_plan_path = str(protocol_path), str(native_plan_path)
    native.evidence_path(protocol_path)
    native.evidence_path(native_plan_path)
    if not isinstance(project_roots, dict) or not project_roots:
        raise ValueError('explicit run-to-project roots required')
    roots = {}
    for run_id, value in project_roots.items():
        native.identifier(run_id)
        root = pathlib.Path(value)
        if not root.is_absolute() or not root.is_dir() or root != root.resolve():
            raise ValueError('prepared project root must be an absolute nonsymlink directory')
        if not (root / 'project.bla').is_file() or (root / 'project.bla').is_symlink():
            raise ValueError('exact prepared project root needs project.bla')
        roots[run_id] = root
    values = list(roots.values())
    if any(a == b or a in b.parents or b in a.parents for i, a in enumerate(values) for b in values[i + 1:]):
        raise ValueError('prepared arm project roots must be disjoint')
    root = values[0]
    plan_raw = read_bytes(root, native_plan_path)
    protocol_raw = read_bytes(root, protocol_path, expert_eval.MAX_FILE_BYTES)
    plan = native.decode(plan_raw)
    protocol = expert_eval.validate_protocol(expert_eval.parse_json(protocol_raw))
    native.fields(plan, 'kind schema_version experiment_id protocol_sha256 phase capability provider calibration controls_sha256 snapshot_files arms order host_operation_timeout_ms response_timeout_ms')
    native.literal(plan['kind'], 'native_matched_run_plan')
    native.literal(plan['schema_version'], 1)
    native.identifier(plan['experiment_id'])
    native.one_of(plan['phase'], ('pilot', 'expanded'))
    native.hexadecimal(plan['protocol_sha256'], 64)
    if plan['protocol_sha256'] != expert_eval.fingerprint(protocol):
        raise ValueError('native plan does not identify the frozen protocol')
    native.array(plan['order'], native.identifier, 192)
    if not isinstance(plan['arms'], list) or not 3 <= len(plan['arms']) <= 192:
        raise ValueError('native plan requires its complete arm list')
    arms = {}
    for arm in plan['arms']:
        native.fields(arm, 'run_id matched_task_id repeat arm task acceptance_epoch child coordinator workspace initial_assignment_revision frozen_brief brief_sha256 runtime_config budgets grading_spec')
        native.identifier(arm['run_id'])
        native.identifier(arm['matched_task_id'])
        native.identifier(arm['task'])
        native.integer(arm['repeat'], 1)
        native.integer(arm['acceptance_epoch'], 1)
        native.one_of(arm['arm'], expert_eval.ARMS)
        native.validate_child(arm['child'])
        native.validate_child(arm['coordinator'])
        native.validate_reference(arm['runtime_config'])
        native.validate_reference(arm['grading_spec'])
        native.evidence_path(arm['workspace'])
        if arm['run_id'] in arms:
            raise ValueError('duplicate native run identity')
        arms[arm['run_id']] = arm
    if len(plan['order']) != len(arms) or set(plan['order']) != set(arms) or set(roots) != set(arms):
        raise ValueError('native order and explicit project roots must match every planned run exactly')
    for run_id, root in roots.items():
        if read_bytes(root, native_plan_path) != plan_raw or read_bytes(root, protocol_path, expert_eval.MAX_FILE_BYTES) != protocol_raw:
            raise ValueError('prepared projects do not contain identical frozen plan and protocol bytes')
        if not checked_path(root, arms[run_id]['workspace']).is_dir():
            raise ValueError('frozen workspace is missing from the exact prepared project')
        for arm in arms.values():
            for name in ('runtime_config', 'grading_spec'):
                ref = arm[name]
                if hashlib.sha256(read_bytes(root, ref['path'])).hexdigest() != ref['sha256']:
                    raise ValueError('frozen ' + name + ' evidence changed')
    return protocol, plan, roots, reference('native-plan', native_plan_path, plan_raw), reference('protocol', protocol_path, protocol_raw)


def match_key(key, arm):
    for key_name, arm_name in (('run_id', 'run_id'), ('task', 'task'), ('acceptance_epoch', 'acceptance_epoch'), ('child', 'child')):
        if key[key_name] != arm[arm_name]:
            raise native.Failure('uncertain_output', 'core output belongs to a different enrolled arm', 4)


class CheckedCore:
    def __init__(self, core, arm, plan, plan_ref, protocol_ref):
        self.core, self.arm, self.plan = core, arm, plan
        self.plan_ref, self.protocol_ref = plan_ref, protocol_ref

    def invoke(self, operation, request):
        value = self.core.invoke(operation, request)
        try:
            native.validate_native_result(operation, value)
            kind = value['kind']
            if 'run_id' in value and value['run_id'] != self.arm['run_id']:
                raise ValueError('wrong run')
            if kind == 'pending':
                match_key(value['request']['key'], self.arm)
                if self.arm['arm'] != 'advisory' and value['request']['payload']['kind'] == 'wake_worker':
                    raise ValueError('unexpected exposure operation')
            if kind == 'checkpoint_due':
                match_key(value['observation']['key'], self.arm)
                if value['observation']['config_sha256'] != self.arm['runtime_config']['sha256']:
                    raise ValueError('wrong frozen configuration')
            if kind == 'boundary_observed':
                if value['checkpoint']['key'] != request['key']:
                    raise ValueError('wrong checkpoint')
                event = value['event']
                if any(event[name] != request['key'][name] for name in ('run_id', 'task', 'checkpoint_id', 'sequence', 'previous_sequence')):
                    raise ValueError('wrong checkpoint event')
        except (native.Failure, KeyError, TypeError, ValueError, OverflowError) as error:
            raise native.Failure('uncertain_output', 'core output is incomplete or mismatched; reconcile without retrying', 4) from error
        return value

    def checkpoint(self, run_id, event):
        value = self.core.checkpoint(run_id, event)
        try:
            native.validate_checkpoint_output(value)
            execution = value['execution']
            expected = {'kind': 'experimental', 'run_id': self.arm['run_id'],
                'experiment_id': self.plan['experiment_id'], 'arm': self.arm['arm'],
                'native_plan_sha256': self.plan_ref['sha256'], 'protocol_sha256': self.protocol_ref['sha256'],
                'capability_sha256': expert_eval.fingerprint(self.plan['capability'])}
            if any(execution.get(name) != item for name, item in expected.items()) or value['mode'] != self.arm['arm']:
                raise ValueError('wrong experimental evaluation identity')
            if self.arm['arm'] != 'advisory' and execution['authority'] is not None:
                raise ValueError('unexpected experimental authority')
            if self.arm['arm'] == 'off' and value['provider_calls'] != 0:
                raise ValueError('unexpected off-arm provider execution')
        except (native.Failure, KeyError, TypeError, ValueError, OverflowError) as error:
            raise native.Failure('uncertain_output', 'checkpoint output is incomplete or mismatched; reconcile without retrying', 4) from error
        return value


def planned_run(arm, root, plan, protocol):
    return {'run_id': arm['run_id'], 'task_id': arm['matched_task_id'], 'task': arm['task'],
        'repeat': arm['repeat'], 'arm': arm['arm'], 'project_root': str(root), 'workspace': arm['workspace'],
        'evidence_kind': 'matched_live_' + plan['phase'], 'status': 'not_started', 'host_status': 'not_started',
        'runtime_config': arm['runtime_config'], 'grading_spec': arm['grading_spec'],
        'snapshot_fingerprint': expert_eval.fingerprint(plan['snapshot_files']),
        'controls': protocol['pilot']['controls'], 'provider': plan['provider'], 'budgets': arm['budgets'],
        'checkpoints': [], 'core_result': None, 'stop_reason': None,
        'correctness': None, 'scope': None, 'grader': None, 'owner_interventions': None,
        'steering_ms': None, 'rework_ms': None, 'worker_overhead_ms': None, 'wall_ms': None,
        'calls': None, 'cost': None, 'acknowledged': None, 'observed_correction': None}


def live_native(protocol_path, native_plan_path, project_roots, *, core_factory=None):
    protocol, plan, roots, plan_ref, protocol_ref = freeze_inputs(protocol_path, native_plan_path, project_roots)
    arms = {arm['run_id']: arm for arm in plan['arms']}
    runs = [planned_run(arms[run_id], roots[run_id], plan, protocol) for run_id in plan['order']]
    report = {'schema_version': 1, 'status': 'incomplete', 'evidence_kind': 'matched_live_' + plan['phase'],
        'experiment_id': plan['experiment_id'], 'protocol_fingerprint': expert_eval.fingerprint(protocol),
        'protocol': protocol_ref, 'native_plan': plan_ref, 'native_plan_fingerprint': expert_eval.fingerprint(plan),
        'host': protocol['host'], 'host_status': 'not_finished', 'planned_runs': len(runs),
        'completed_runs': 0, 'incomplete_runs': len(runs), 'runs': runs,
        'rendezvous': None, 'uncertainty': None, 'promotion_records': [],
        'issues': ['independent_grade_missing'], 'measurements': 'unavailable',
        'checkpoint_scope': 'current invocation only; not aggregate run measurements'}
    for run in runs:
        arm = arms[run['run_id']]
        operation = 'start-run'
        try:
            raw_core = (core_factory or native.CoreCLI)(project=roots[run['run_id']])
            if pathlib.Path(raw_core.project) != roots[run['run_id']]:
                raise ValueError('transport project differs from the exact prepared root')
            core = CheckedCore(raw_core, arm, plan, plan_ref, protocol_ref)
            result = core.invoke(operation, {'schema_version': 1, 'kind': 'start_run', 'run_id': run['run_id'],
                'native_plan': plan_ref, 'protocol': protocol_ref})
            seen = set()
            while result['kind'] == 'checkpoint_due':
                operation = 'checkpoint'
                identity = expert_eval.fingerprint(result['observation'])
                if identity in seen:
                    raise native.Failure('uncertain_output', 'core repeated a checkpoint; no retry attempted', 4)
                seen.add(identity)
                checkpoint = native.handle_checkpoint(core, result['observation'])
                run['checkpoints'].append(checkpoint)
                if checkpoint['boundary']['kind'] == 'no_advice':
                    result = checkpoint['boundary']
                    break
                operation = 'advance'
                result = core.invoke(operation, {'schema_version': 1, 'kind': 'advance', 'run_id': run['run_id'],
                    'native_plan_sha256': expert_eval.fingerprint(plan), 'coordinator': arm['coordinator']})
            run['core_result'] = result
            kind = result['kind']
            if kind == 'arm_finished':
                run.update(status='incomplete', host_status='finished', stop_reason='independent_grade_missing')
                continue
            step = {'experiment_id': plan['experiment_id'], 'run_id': run['run_id']}
            if kind == 'pending':
                step.update(kind='pending_host', operation=result['request'])
                run.update(status='pending_host', host_status='pending_host')
            elif kind == 'awaiting_permit':
                step.update(kind='awaiting_permit')
                run.update(status='awaiting_permit', host_status='awaiting_permit')
            else:
                step.update(kind='stopped', reason=result['code'])
                run.update(status='stopped', host_status='refused' if kind == 'no_advice' else 'stopped', stop_reason=result['code'])
            report.update(status=step['kind'], rendezvous=step)
            return report
        except native.Failure as error:
            uncertain = error.exit_code == 4
            status = 'uncertain' if uncertain else 'rejected'
            run.update(status=status, host_status=status, stop_reason=error.code)
            report.update(status=status, uncertainty={'run_id': run['run_id'], 'operation': operation,
                'code': error.code, 'exit_code': error.exit_code, 'detail': str(error)})
            return report
    report['host_status'] = 'finished'
    return report
