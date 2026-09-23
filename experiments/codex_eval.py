import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from agent_eval_common import (ROOT, base_environment, build_product, endpoint_url,
                               export_campaign, has_control, model_details, observe_run, prompt_path,
                               read_prompt, resolve_model, run_process, snapshot, stage_materials,
                               subject_environment)
from grade_agent_eval import failed_run, grade_directory, run_summary, write_reports
from agent_eval_traces import codex_skill_available


def run_case(case, arm, index, campaign, env, codex, model, prepare_only):
    oracle_env = env
    run = campaign / arm / f'run-{index}'
    workspace = run / 'workspace'
    workspace.mkdir(parents=True)
    setup = subprocess.run(['bash', str(case / 'fixture.sh')], cwd=workspace,
                           env=dict(env, BLABLA_EVAL_ARM=arm), capture_output=True, text=True)
    (run / 'setup.txt').write_text(setup.stdout + setup.stderr)
    if setup.returncode:
        (run / 'summary.json').write_text(json.dumps({'execution': 'setup-failed', 'exit_code': setup.returncode}))
        raise RuntimeError(f'Fixture failed; inspect {run / "setup.txt"}')
    (run / 'before.json').write_text(json.dumps(snapshot(workspace), indent=2))
    shutil.copytree(workspace, run / 'before-workspace')
    prompt, timeout = read_prompt(prompt_path(case, arm).read_text())
    (run / 'prompt.txt').write_text(prompt)
    env = subject_environment(env, arm)
    common = ['--oss', '--local-provider', 'ollama', '-m', model, '-c', 'web_search="disabled"',
              '-c', 'features.multi_agent=false', '--sandbox', 'workspace-write', '-C', str(workspace)]
    command = [codex, 'exec', *common, '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
               '--json', '-o', str(run / 'final.txt'), prompt]
    (run / 'command.json').write_text(json.dumps(command, indent=2))
    (run / 'capabilities.json').write_text(json.dumps({'spawn_available': False}))
    if prepare_only:
        (run / 'summary.json').write_text(json.dumps({'execution': 'prepared', 'inference': False}))
        return None
    run_env = dict(env, CODEX_HOME=str(run / 'codex-home'))
    Path(run_env['CODEX_HOME']).mkdir()
    rendered = subprocess.run([codex, *common, 'debug', 'prompt-input', prompt], env=run_env,
                              capture_output=True, text=True, timeout=5, check=True)
    (run / 'prompt-input.json').write_text(rendered.stdout)
    offered = codex_skill_available(rendered.stdout)
    if offered != (arm == 'with'):
        raise RuntimeError(f'Skill catalog does not match the selected {arm} condition')
    started = time.monotonic()
    exit_code = run_process(command, workspace, run_env, run / 'trace.jsonl', run / 'stderr.txt', timeout)
    (run / 'subject-after.json').write_text(json.dumps(snapshot(workspace), indent=2))
    observe_run(run, case, oracle_env, arm)
    result = grade_directory(case, run, 'codex', arm)
    result['seconds'] = time.monotonic() - started
    result['exit_code'] = exit_code
    (run / 'summary.json').write_text(json.dumps(result, indent=2))
    print(run_summary(result), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description='Run small local agents through Codex and the shared BlaBla rubric')
    parser.add_argument('--case', choices=sorted(path.parent.name for path in (ROOT / 'evals').glob('*/rubric.json')),
                        default='carries-an-assigned-task')
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--arm', choices=('with', 'without', 'both'), default='both')
    parser.add_argument('--model')
    parser.add_argument('--endpoint')
    parser.add_argument('--codex', default='codex')
    parser.add_argument('--prepare-only', action='store_true')
    arguments = parser.parse_args()
    if sys.platform != 'linux' or arguments.runs < 1:
        parser.error('Use Linux/WSL and a positive run count')
    arguments.model = resolve_model(parser, ROOT / 'evals' / arguments.case, arguments.model)
    codex = shutil.which(arguments.codex)
    if codex is None:
        parser.error('Linux Codex is missing; install it or pass --codex')
    cache, binary = build_product()
    campaign = Path(tempfile.mkdtemp(prefix='codex-', dir=cache))
    output = ROOT / 'artifacts/agent-evals' / campaign.name
    results = []
    print(f'campaign: {campaign}\nartifacts: {output}', flush=True)
    try:
        inputs = stage_materials(campaign / 'materials')
        env = base_environment(binary)
        endpoint = endpoint_url(arguments.endpoint)
        env['CODEX_OSS_BASE_URL'] = endpoint + '/v1'
        metadata = {'host': 'codex', 'case': arguments.case, 'runs_per_arm': arguments.runs,
                    'arm': arguments.arm, 'model': arguments.model, 'prepare_only': arguments.prepare_only,
                    'codex_version': subprocess.check_output([codex, '--version'], text=True).strip(),
                    'blabla_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(), 'inputs': inputs,
                    'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
        if not arguments.prepare_only:
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
                    result = run_case(case, arm, index, campaign, env, codex, arguments.model, arguments.prepare_only)
                except Exception as failure:
                    result = failed_run(case, campaign / arm / f'run-{index}', 'codex', arm, failure)
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
