import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import sys
import tempfile
import time

from agent_eval_common import (ROOT, base_environment, build_product, endpoint_url,
                               export_campaign, get_model_set, has_control, model_details, observe_run,
                               prompt_path, read_prompt, resolve_model, rewrite_staged_materials,
                               run_process, snapshot, stage_materials, subject_environment)
from collect_claude_eval import sandbox_paths
from grade_agent_eval import failed_run, grade_directory, run_summary, write_reports


def native_scaffold(native, case_name, env, arm):
    case = native / 'evals' / case_name
    wrapper = case / 'fixture-native.sh'
    settings = {'PATH': env['PATH'], 'PYTHONDONTWRITEBYTECODE': '1',
                'BLABLA_EVAL_ARM': arm, 'BLABLA_EVAL_HOST': 'claude',
                'BLABLA_EVAL_CAPTURE_ROOT': str(native / 'captures')}
    if 'BLABLA_EVAL_EXPECTED_SHA256' in env:
        settings['BLABLA_EVAL_EXPECTED_SHA256'] = env['BLABLA_EVAL_EXPECTED_SHA256']
    wrapper.write_text('set -eu\n' + ''.join(f'export {key}={shlex.quote(value)}\n' for key, value in settings.items())
                       + 'for startup in "$HOME/.bashrc" "$HOME/.profile"; do\n'
                       + '  [ -e "$startup" ] || : > "$startup" 2>/dev/null || true\n'
                       + '  [ -r "$startup" ] || chmod u+r "$startup" 2>/dev/null || : > "$startup" 2>/dev/null || true\n'
                       + 'done\n'
                       + 'ls -la "$HOME" > "$BLABLA_EVAL_CAPTURE_ROOT/home-listing.txt" 2>&1 || true\n'
                       + f'exec bash {shlex.quote(str(case / "fixture.sh"))}\n')
    config = case / 'case.yaml'
    text = config.read_text()
    original = 'scaffold_script: fixture.sh'
    if text.count(original) != 1:
        raise ValueError('Native case must name the shared fixture.sh exactly once')
    config.write_text(text.replace(original, 'scaffold_script: fixture-native.sh'))
    if arm == 'without':
        shutil.copyfile(case / 'prompt-without.md', case / 'prompt.md')


def collect_run(native, run, case_name, arm, expected_binary):
    report = json.loads((native / 'results/aggregate-result.json').read_text())
    sandboxes = sandbox_paths(report)
    if len(sandboxes) != 1:
        raise RuntimeError('A single native evaluation must identify exactly one retained sandbox')
    sandbox = sandboxes[0]
    subprocess.run(['chmod', '-R', 'u+rwX', str(sandbox)], check=True)
    source = next((sandbox / path for path in ('sealed/home/cwd', 'home/cwd') if (sandbox / path).is_dir()), None)
    if source is None:
        raise RuntimeError('Native evaluator did not retain the subject workspace')
    shutil.copytree(source, run / 'workspace')
    shutil.copyfile(sandbox / 'out/trace.jsonl', run / 'trace.jsonl')
    capture = native / 'captures' / sandbox.name
    if not (capture / 'before.json').exists():
        raise RuntimeError('Trusted pre-subject fixture capture is missing')
    captured = json.loads((capture / 'metadata.json').read_text())
    if captured['case'] != case_name:
        raise RuntimeError('Fixture capture case differs from the requested case')
    if captured['arm'] != arm or captured.get('blabla_sha256') != expected_binary:
        raise RuntimeError('Fixture capture arm or executable differs from the requested condition')
    shutil.copyfile(capture / 'before.json', run / 'before.json')
    shutil.copyfile(capture / 'metadata.json', run / 'fixture-metadata.json')
    shutil.copytree(capture / 'before-workspace', run / 'before-workspace')
    shutil.copytree(native / 'results', run / 'native-report')
    (run / 'subject-after.json').write_text(json.dumps(snapshot(run / 'workspace'), indent=2))


DIRECT_TOOLS = 'Bash,Write,Edit,Read,Glob,Grep,Skill'


def direct_environment(env, arm):
    return {key: value for key, value in subject_environment(env, arm).items()
            if not key.startswith(('CLAUDE_', 'CLAUDECODE'))}


def direct_command(claude, model):
    return [claude, '-p', '--model', model, '--output-format', 'stream-json', '--verbose',
            '--setting-sources', 'project', '--tools', DIRECT_TOOLS, '--allowedTools', DIRECT_TOOLS]


def prepare_workspace(case, run, env, arm):
    workspace = run / 'workspace'
    workspace.mkdir()
    subprocess.run(['bash', str(case / 'fixture.sh')], cwd=workspace,
                   env=dict(env, BLABLA_EVAL_ARM=arm), check=True, capture_output=True, text=True)
    (run / 'before.json').write_text(json.dumps(snapshot(workspace), indent=2))
    return workspace


def conclude_run(run, case, env, arm, started, driver, **exits):
    observe_run(run, case, env, arm)
    result = grade_directory(case, run, 'claude', arm)
    offered = next((json.loads(line).get('skills') for line in (run / 'trace.jsonl').read_text().splitlines()
                    if json.loads(line).get('subtype') == 'init'), None)
    if offered is None or any(name.split(':')[-1] == 'blabla' for name in offered) != (arm == 'with'):
        raise RuntimeError(f'{driver} skill catalog does not match the selected condition')
    result.update(seconds=time.monotonic() - started, **exits)
    (run / 'summary.json').write_text(json.dumps(result, indent=2))
    print(run_summary(result), flush=True)
    return result


def run_direct(case, arm, run, campaign, env, claude, model, timeout):
    workspace = prepare_workspace(case, run, env, arm)
    shutil.copytree(workspace, run / 'before-workspace')
    if arm == 'with':
        skill = workspace / '.claude/skills/blabla/SKILL.md'
        skill.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(campaign / 'materials/.claude/skills/blabla/SKILL.md', skill)
    command = direct_command(claude, model)
    (run / 'command.json').write_text(json.dumps(command, indent=2))
    started = time.monotonic()
    with (run / 'prompt.txt').open('rb') as prompt:
        exit_code = run_process(command, workspace, direct_environment(env, arm),
                                run / 'trace.jsonl', run / 'stderr.txt', timeout, prompt)
    (run / 'subject-after.json').write_text(json.dumps(snapshot(workspace), indent=2))
    return conclude_run(run, case, env, arm, started, 'Direct', direct_exit=exit_code)


def run_case(case, arm, index, campaign, env, claude, model, prepare_only, driver):
    run = campaign / arm / f'run-{index}'
    run.mkdir(parents=True)
    prompt, timeout = read_prompt(prompt_path(case, arm).read_text())
    (run / 'prompt.txt').write_text(prompt)
    (run / 'capabilities.json').write_text(json.dumps({'spawn_available': False}))
    if prepare_only:
        prepare_workspace(case, run, env, arm)
        (run / 'summary.json').write_text(json.dumps({'execution': 'prepared', 'inference': False}))
        return None
    if driver == 'direct':
        return run_direct(case, arm, run, campaign, env, claude, model, timeout)
    native = campaign / 'native' / arm / f'run-{index}'
    shutil.copytree(campaign / 'materials', native)
    if arm == 'with':
        shutil.copytree(ROOT / '.claude-plugin', native / '.claude-plugin')
        shutil.copytree(native / '.claude/skills', native / 'skills')
    else:
        (native / '.claude/skills/blabla/SKILL.md').unlink()
    native_scaffold(native, case.name, env, arm)
    run_env = dict(subject_environment(env, arm), BLABLA_EVAL_ARM=arm, BLABLA_EVAL_CAPTURE_ROOT=str(native / 'captures'))
    command = [claude, 'plugin', 'eval', str(native), '--trust-plugin', '--scaffold', '--no-publish',
               '--keep-temp', '--ablation', 'none', '--runs', '1', '--case', case.name,
               '--model', model, '--output-dir', str(native / 'results'), '--allow-tools', 'Bash', 'Write', 'Edit']
    (run / 'command.json').write_text(json.dumps(command, indent=2))
    started = time.monotonic()
    exit_code = run_process(command, native, run_env, run / 'native-stdout.txt', run / 'stderr.txt', timeout)
    if not (native / 'results/aggregate-result.json').exists():
        raise RuntimeError(f'Native evaluator exited {exit_code} without a report; see {run}')
    collect_run(native, run, case.name, arm, env['BLABLA_EVAL_EXPECTED_SHA256'])
    return conclude_run(run, case, env, arm, started, 'Native', native_exit=exit_code)


def main():
    parser = argparse.ArgumentParser(description='Run small local agents through Claude and the shared BlaBla rubric')
    parser.add_argument('--case', choices=sorted(path.parent.name for path in (ROOT / 'evals').glob('*/rubric.json')),
                        default='carries-an-assigned-task')
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--arm', choices=('with', 'without', 'both'), default='both')
    parser.add_argument('--model')
    parser.add_argument('--backend', choices=('ollama', 'anthropic'), default='ollama',
                        help='Backend to use for model inference')
    parser.add_argument('--model-set', help='Model set name to use for mapping models (required with --backend anthropic)')
    parser.add_argument('--endpoint', default=os.environ.get('ANTHROPIC_BASE_URL'))
    parser.add_argument('--claude', default='claude')
    parser.add_argument('--driver', choices=('plugin', 'direct'), default='plugin',
                        help='Driver to use for evaluation')
    parser.add_argument('--prepare-only', action='store_true')
    arguments = parser.parse_args()
    if sys.platform != 'linux' or arguments.runs < 1:
        parser.error('Use Linux/WSL and a positive run count')

    if arguments.model_set and arguments.backend != 'anthropic':
        parser.error('--model-set can only be used with --backend anthropic')
    if arguments.backend == 'anthropic' and not arguments.model_set:
        parser.error('--model-set is required when using --backend anthropic')

    case_dir = ROOT / 'evals' / arguments.case
    if arguments.model_set:
        try:
            model_set = get_model_set(arguments.model_set)
        except ValueError as e:
            parser.error(str(e))
        declared_model = resolve_model(parser, case_dir, arguments.model)
        if declared_model not in model_set:
            parser.error(f'Model {declared_model} not in model set {arguments.model_set}')
        api_model = model_set[declared_model]['api_id']
    else:
        arguments.model = resolve_model(parser, case_dir, arguments.model)
        api_model = arguments.model

    claude = shutil.which(arguments.claude)
    if claude is None:
        parser.error('Native Linux Claude is missing')
    cache, binary = build_product()
    campaign = Path(tempfile.mkdtemp(prefix='claude-', dir=cache))
    output = ROOT / 'artifacts/agent-evals' / campaign.name
    results = []
    print(f'campaign: {campaign}\nartifacts: {output}', flush=True)
    with tempfile.TemporaryDirectory(prefix='bin-', dir=cache) as bin_dir:
        executable = Path(bin_dir) / 'blabla'
        shutil.copy2(binary, executable)
        try:
            inputs = stage_materials(campaign / 'materials')

            if arguments.model_set:
                rewrite_staged_materials(campaign / 'materials', arguments.model_set)

            env = base_environment(executable)

            if arguments.backend == 'anthropic':
                pass
            else:
                endpoint = endpoint_url(arguments.endpoint)
                env.update(ANTHROPIC_BASE_URL=endpoint, ANTHROPIC_AUTH_TOKEN='ollama')

            metadata = {'host': 'claude', 'case': arguments.case, 'runs_per_arm': arguments.runs,
                        'arm': arguments.arm, 'model': api_model, 'prepare_only': arguments.prepare_only,
                        'driver': arguments.driver, 'backend': arguments.backend, 'claude_version': subprocess.check_output([claude, '--version'], text=True).strip(),
                        'blabla_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(), 'inputs': inputs,
                        'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
            if arguments.model_set:
                metadata['model_set'] = arguments.model_set
            if not arguments.prepare_only and arguments.backend == 'ollama':
                endpoint = endpoint_url(arguments.endpoint)
                metadata.update(model_details(endpoint, arguments.model))
            (campaign / 'metadata.json').write_text(json.dumps(metadata, indent=2))
            for index in range(1, arguments.runs + 1):
                arms = ('with', 'without') if arguments.arm == 'both' else (arguments.arm,)
                if index % 2 == 0:
                    arms = tuple(reversed(arms))
                for arm in arms:
                    case = campaign / 'materials/evals' / arguments.case
                    if arm == 'without' and not has_control(case):
                        print(f'without: {arguments.case} exists only with BlaBla; no control arm', flush=True)
                        continue
                    print(f'{arm}: run {index}/{arguments.runs}', flush=True)
                    try:
                        result = run_case(case, arm, index, campaign, env, claude, api_model, arguments.prepare_only, arguments.driver)
                    except Exception as failure:
                        result = failed_run(case, campaign / arm / f'run-{index}', 'claude', arm, failure)
                        results.append(result)
                        print(str(failure), file=sys.stderr)
                        return 2
                    if result is not None:
                        results.append(result)
            return 0
        finally:
            if results:
                write_reports(results, campaign)
            export_campaign(campaign, output)


if __name__ == '__main__':
    sys.exit(main())
