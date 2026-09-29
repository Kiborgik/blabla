import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import urllib.request


ROOT = Path(__file__).resolve().parent.parent
MODEL = 'qwen3.5:4b'

MODEL_SETS = {
    'haiku': {
        'qwen3.5:4b': {'api_id': 'claude-haiku-4-5-20251001', 'local_id': 'haiku-4.5'},
        'qwen3.5:9b': {'api_id': 'claude-haiku-4-5-20251001', 'local_id': 'haiku-4.5'},
    }
}


def case_model(case):
    return json.loads((case / 'fixture.json').read_text(encoding='utf-8')).get('model', MODEL)


def get_model_set(name):
    if name not in MODEL_SETS:
        raise ValueError(f'Unknown model set: {name}. Available sets: {", ".join(MODEL_SETS.keys())}')
    return MODEL_SETS[name]


def rewrite_model_names_in_file(filepath, model_mapping):
    content = filepath.read_text(encoding='utf-8')
    for old_name, mapping in model_mapping.items():
        new_name = mapping['local_id']
        content = content.replace(old_name, new_name)
    filepath.write_text(content, encoding='utf-8')


def deduplicate_process_bla_models(filepath):
    content = filepath.read_text(encoding='utf-8')
    import re
    def deduplicate_models(match):
        opening = match.group(1)
        models_str = match.group(2)
        model_list = re.findall(r'"([^"]+)"|\'([^\']+)\'|([^\s,\]]+)', models_str)
        models = [m[0] or m[1] or m[2] for m in model_list if any(m)]
        seen = set()
        dedup_models = []
        for model in models:
            if model not in seen:
                seen.add(model)
                dedup_models.append(model)
        new_models_str = ', '.join(f'"{m}"' if ':' in m or '-' in m else m for m in dedup_models)
        return f'{opening}[{new_models_str}]'

    content = re.sub(r'(model\s+)\[([^\]]+)\]', deduplicate_models, content)
    filepath.write_text(content, encoding='utf-8')


def rewrite_staged_materials(materials_dir, model_set_name):
    model_set = get_model_set(model_set_name)
    evals_dir = materials_dir / 'evals'

    if not evals_dir.exists():
        raise ValueError(f'Materials directory does not contain evals: {materials_dir}')

    case_files = ['fixture.json', 'prompt.md', 'prompt-without.md', 'rubric.json', 'case.yaml']
    grader_files = []

    for case_dir in evals_dir.iterdir():
        if not case_dir.is_dir():
            continue

        for filename in case_files:
            filepath = case_dir / filename
            if filepath.exists():
                rewrite_model_names_in_file(filepath, model_set)

        graders_dir = case_dir / 'graders'
        if graders_dir.exists():
            for grader_file in graders_dir.glob('*.md'):
                rewrite_model_names_in_file(grader_file, model_set)

    for rubric in evals_dir.glob('*/rubric.json'):
        accept_host_model_ids(rubric, model_set)

    materials_subdir = evals_dir / 'materials'
    if materials_subdir.exists():
        for process_file in materials_subdir.rglob('process.bla'):
            rewrite_model_names_in_file(process_file, model_set)
            deduplicate_process_bla_models(process_file)
            declare_host_model_aliases(process_file, model_set)


def host_model_aliases(model_set):
    return sorted({(mapping['api_id'], mapping['local_id']) for mapping in model_set.values()
                   if mapping['api_id'] != mapping['local_id']})


def declare_host_model_aliases(filepath, model_set):
    content = filepath.read_text(encoding='utf-8')
    for api_id, local_id in host_model_aliases(model_set):
        if f'alias "{api_id}"' not in content:
            content = content.rstrip('\n') + f'\n\nalias "{api_id}" {{\n    model "{local_id}"\n}}\n'
    filepath.write_text(content, encoding='utf-8')


def accept_host_model_ids(rubric_path, model_set):
    rubric = json.loads(rubric_path.read_text(encoding='utf-8'))
    names = {local_id: api_id for api_id, local_id in host_model_aliases(model_set)}
    changed = False
    for criterion in rubric.get('criteria', []):
        if criterion.get('kind') == 'task_field' and criterion.get('field') == 'accepted.model' and criterion.get('equals') in names:
            criterion['equals_any'] = [criterion['equals'], names[criterion['equals']]]
            changed = True
    if changed:
        rubric_path.write_text(json.dumps(rubric, indent=2) + '\n', encoding='utf-8')


def resolve_model(parser, case, requested):
    declared = case_model(case)
    if requested is not None and requested != declared:
        parser.error(f'{case.name} declares model {declared} in its fixture and prompt; change both inputs instead of --model')
    return declared


def read_prompt(text):
    _, settings, prompt = text.split('---', 2)
    timeout = int(re.search(r'^timeout_seconds:\s*(\d+)\s*$', settings, re.MULTILINE)[1])
    return prompt.strip(), timeout


def snapshot(root):
    return {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(root.rglob('*')) if path.is_file() and not path.is_symlink()}


def endpoint_url(value):
    if value:
        return value.rstrip('/')
    route = subprocess.check_output(['ip', 'route', 'show', 'default'], text=True).split()
    return f'http://{route[route.index("via") + 1]}:11434'


def build_product():
    cache = Path.home() / '.cache/blabla-agent-evals'
    cache.mkdir(parents=True, exist_ok=True)
    subprocess.run(['cargo', 'build', '--quiet', '--locked', '--bin', 'blabla',
                    '--target-dir', str(cache / 'build')], cwd=ROOT, check=True)
    return cache, cache / 'build/debug/blabla'


SUITE_DOCUMENTS = {'README.md', 'findings.md', 'coverage.json'}


def ignore_unstaged(directory, names):
    ignored = {name for name in names if name in {'results', '__pycache__'}}
    if Path(directory) == ROOT / 'evals':
        ignored |= SUITE_DOCUMENTS & set(names)
    return ignored


def stage_materials(destination):
    shutil.copytree(ROOT / 'evals', destination / 'evals', ignore=ignore_unstaged)
    shutil.copytree(ROOT / 'adapters/python', destination / 'adapters/python', ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(ROOT / '.claude/skills/blabla', destination / '.claude/skills/blabla')
    return snapshot(destination)


def model_details(endpoint, name):
    with urllib.request.urlopen(endpoint + '/api/tags', timeout=5) as response:
        matches = [model for model in json.load(response)['models'] if model['name'] == name]
    if not matches:
        raise ValueError(f'Local model {name} is not installed')
    with urllib.request.urlopen(endpoint + '/api/version', timeout=5) as response:
        version = json.load(response)
    return {'model_info': matches[0], 'ollama': version}


SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
SUBJECT_STUBS = ('git', 'find', 'env', 'stat', 'sha256sum', 'md5sum', 'node', 'npm', 'npx', 'curl', 'wget', 'chmod',
                 'tree', 'file', 'xargs', 'ssh', 'scp')


def subject_tools(cache):
    stubs = Path(cache) / 'subject-stubs'
    shutil.rmtree(stubs, ignore_errors=True)
    stubs.mkdir(parents=True)
    for tool in SUBJECT_STUBS:
        stub = stubs / tool
        stub.write_text(f'#!/bin/sh\necho "{tool}: not available in this workspace" >&2\nexit 127\n')
        stub.chmod(0o755)
    return stubs


def base_environment(binary):
    return dict(os.environ, PYTHONDONTWRITEBYTECODE='1',
                BLABLA_EVAL_EXPECTED_SHA256=hashlib.sha256(binary.read_bytes()).hexdigest(),
                BLABLA_EVAL_SUBJECT_TOOLS=str(subject_tools(binary.parent.parent)),
                PATH=f'{binary.parent}:{SYSTEM_PATH}')


def subject_environment(env, arm):
    subject = {key: value for key, value in env.items()
               if key not in ('BLABLA_EVAL_EXPECTED_SHA256', 'BLABLA_EVAL_SUBJECT_TOOLS')}
    stubs = env['BLABLA_EVAL_SUBJECT_TOOLS']
    subject['PATH'] = f'{env["PATH"].split(":")[0]}:{stubs}:{SYSTEM_PATH}' if arm == 'with' else f'{stubs}:{SYSTEM_PATH}'
    if arm == 'with':
        subject['BLABLA_EVAL_EXPECTED_SHA256'] = env['BLABLA_EVAL_EXPECTED_SHA256']
    return subject


def has_control(case):
    return (case / 'prompt-without.md').is_file()


def prompt_path(case, arm):
    return case / ('prompt-without.md' if arm == 'without' else 'prompt.md')


def run_process(command, workspace, env, stdout, stderr, timeout, stdin=subprocess.DEVNULL):
    with stdout.open('w') as output, stderr.open('w') as errors:
        process = subprocess.Popen(command, cwd=workspace, env=env, stdout=output, stderr=errors,
                                   stdin=stdin, start_new_session=True)
        try:
            return process.wait(timeout=timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            return 124 if isinstance(error, subprocess.TimeoutExpired) else 130


def capture(command, cwd, env, destination):
    try:
        result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, timeout=5)
        code, output = result.returncode, result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        code, output = 124, 'Independent check exceeded its five-second limit.'
    destination.write_text(output, encoding='utf-8')
    return {'exit': code, 'reason': f'Independent check exited {code}', 'reference': destination.name}


def observe_one(name, observed, env, run):
    label = name.replace(':', '-').replace('/', '-')
    target = run / f'oracle-{label}.txt'
    if name == 'syntax':
        syntax = ['python3', '-c', 'import ast,pathlib; [ast.parse(p.read_text()) for p in pathlib.Path("widget").rglob("*.py")]']
        return capture(syntax, observed, env, target)
    if name == 'persistence':
        write = 'from widget.model import Widget; from widget.store import WidgetStore; s=WidgetStore(); s.save([Widget(1,"quote\\\" and unicode λ"),Widget(2,"second")])'
        read = 'from widget.store import WidgetStore\nrows=WidgetStore().load()\nif [(w.id,w.text) for w in rows] != [(1,"quote\\\" and unicode λ"),(2,"second")]: raise SystemExit(repr(rows))'
        first = capture(['python3', '-c', write], observed, env, run / 'oracle-save.txt')
        second = capture(['python3', '-c', read], observed, env, run / 'oracle-restart.txt')
        return {'exit': 0 if first['exit'] == second['exit'] == 0 else 1,
                'reason': 'Store roundtrip across separate Python processes', 'reference': 'oracle-save.txt, oracle-restart.txt'}
    command, _, argument = name.partition(':')
    if command in ('finish', 'status'):
        return capture(['blabla', command], observed, env, target)
    if command == 'challenge' and argument:
        return capture(['blabla', 'challenge', argument], observed, env, target)
    if command == 'check' and argument:
        return capture(['blabla', 'check', argument], observed, env, target)
    raise ValueError(f'Unknown observation {name}')


OUTCOME_OBSERVATIONS = ('syntax', 'persistence')


def observe_run(run, case, env, arm='with'):
    observations = {}
    workspace = run / 'workspace'
    config = json.loads((case / 'fixture.json').read_text())
    with tempfile.TemporaryDirectory(prefix='blabla-oracle-') as directory:
        observed = Path(directory) / 'workspace'
        shutil.copytree(workspace, observed)
        for name in config.get('observations', []):
            if arm == 'without' and name not in OUTCOME_OBSERVATIONS:
                continue
            observations[name] = observe_one(name, observed, env, run)
    (run / 'observations.json').write_text(json.dumps(observations, indent=2), encoding='utf-8')
    return observations


def export_campaign(campaign, output):
    def ignored(directory, names):
        parts = Path(directory).relative_to(campaign).parts
        if not parts:
            return [name for name in names if name == 'native']
        return ['codex-home'] if len(parts) == 2 and parts[0] in ('with', 'without') else []
    shutil.copytree(campaign, output, dirs_exist_ok=True, ignore=ignored)
