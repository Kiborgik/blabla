import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

from agent_eval_common import ROOT, case_model, endpoint_url, has_control, model_details
from agent_eval_overview import build as write_overview
from grade_agent_eval import grade_directory, write_reports


def unload(endpoint, model):
    request = urllib.request.Request(endpoint + '/api/generate',
                                     data=json.dumps({'model': model, 'keep_alive': 0}).encode(),
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def campaign_rows(campaign):
    metadata = json.loads((campaign / 'metadata.json').read_text())
    case = campaign / 'materials/evals' / metadata['case']
    rows = []
    for summary in sorted(campaign.glob('*/run-*/summary.json')):
        recorded = json.loads(summary.read_text())
        if 'criteria' not in recorded:
            continue
        run_dir = summary.parent
        if (run_dir / 'trace.jsonl').exists() and (run_dir / 'workspace').is_dir():
            row = grade_directory(case, run_dir, metadata['host'], run_dir.parent.name)
            for key in ('seconds', 'exit_code', 'native_exit', 'direct_exit'):
                if key in recorded:
                    row[key] = recorded[key]
        else:
            row = recorded
        row['run'] = f'{campaign.name}/{row["run"]}'
        rows.append(row)
    return rows


def regrade(suite, notes, section):
    manifest = json.loads((suite / 'manifest.json').read_text())
    results = []
    for entry in manifest['campaigns']:
        if entry.get('path'):
            campaign = suite.parent / Path(entry['path']).name
            results.extend(campaign_rows(campaign))
    write_reports(results, suite)
    write_overview(suite, notes, section)
    print(f'regraded {len(results)} runs into {suite}', flush=True)
    return 0


def main():
    parser = argparse.ArgumentParser(description='Run every eval case through both hosts and grade the suite')
    parser.add_argument('label', help='suite name, for example pilot or final')
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--cases', nargs='*', help='case names; default: every case with a rubric')
    parser.add_argument('--hosts', nargs='*', default=['claude', 'codex'], choices=['claude', 'codex'])
    parser.add_argument('--endpoint')
    parser.add_argument('--codex', default=str(Path.home() / '.cache/blabla-codex-eval/tools/codex-x86_64-unknown-linux-musl'))
    parser.add_argument('--regrade', type=Path, help='re-render the reports of a finished suite directory without running anything')
    parser.add_argument('--notes', type=Path, default=ROOT / 'evals/findings.md', help='Markdown file whose section the overview page embeds')
    parser.add_argument('--section', help='heading text selecting the section of --notes for the overview page')
    arguments = parser.parse_args()
    if arguments.regrade:
        return regrade(arguments.regrade.resolve(), arguments.notes, arguments.section)
    if sys.platform != 'linux' or arguments.runs < 1:
        parser.error('Use Linux/WSL and a positive run count')
    available = sorted(path.parent.name for path in (ROOT / 'evals').glob('*/rubric.json'))
    cases = arguments.cases or available
    unknown = sorted(set(cases) - set(available))
    if unknown:
        parser.error('Unknown cases: ' + ', '.join(unknown))
    endpoint = endpoint_url(arguments.endpoint)
    models = {case: case_model(ROOT / 'evals' / case) for case in cases}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    out = ROOT / 'artifacts/agent-evals' / f'{arguments.label}-suite-{stamp}'
    out.mkdir(parents=True)
    jobs = [(case, host) for index, case in enumerate(cases)
            for host in (arguments.hosts if index % 2 == 0 else list(reversed(arguments.hosts)))]
    controls = {case: has_control(ROOT / 'evals' / case) for case in cases}
    manifest = {'label': arguments.label, 'cases': cases, 'hosts': arguments.hosts,
                'arms': {'with': 'BlaBla present: manifest, contracts, task record, onboarding, skill, CLI',
                         'without': 'none of it; the plain-language task from prompt-without.md'},
                'controls': controls, 'runs_per_arm': arguments.runs,
                'subjects': sum(2 if controls[case] else 1 for case, _ in jobs) * arguments.runs, 'models': models,
                'started_utc': stamp, 'campaigns': [],
                'runner_inputs': {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                                  for path in sorted((ROOT / 'experiments').glob('*eval*.py'))},
                'model_details': {model: model_details(endpoint, model) for model in sorted(set(models.values()))}}
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print('suite: ' + str(out), flush=True)
    results = []
    basis = None
    exit_code = 0
    try:
        for case, host in jobs:
            command = ['python3', str(ROOT / 'experiments' / f'{host}_eval.py'),
                       '--case', case, '--runs', str(arguments.runs), '--arm', 'both', '--endpoint', endpoint]
            if host == 'codex':
                command += ['--codex', arguments.codex]
            print(f'job: {host} / {case} / {arguments.runs} per arm / {models[case]}', flush=True)
            campaign = None
            with (out / f'{host}-{case}.log').open('w') as log:
                process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE,
                                           stderr=subprocess.STDOUT, text=True)
                for line in process.stdout:
                    log.write(line)
                    log.flush()
                    print(line, end='', flush=True)
                    if line.startswith('artifacts: '):
                        campaign = Path(line.strip().split(': ', 1)[1])
                code = process.wait()
            entry = {'host': host, 'case': case, 'exit': code, 'path': str(campaign) if campaign else None}
            manifest['campaigns'].append(entry)
            if campaign and (campaign / 'metadata.json').exists():
                metadata = json.loads((campaign / 'metadata.json').read_text())
                current = {'blabla_sha256': metadata['blabla_sha256'], 'inputs': metadata['inputs']}
                if basis is None:
                    basis = current
                    manifest['frozen_inputs'] = basis
                elif current != basis:
                    raise RuntimeError('BlaBla binary or shared materials changed during the suite')
            if campaign and (campaign / 'grades.json').exists():
                results.extend(campaign_rows(campaign))
                write_reports(results, out)
            (out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
            if code:
                exit_code = code
                break
    except BaseException:
        exit_code = 2
        raise
    finally:
        manifest['finished_utc'] = datetime.now(timezone.utc).isoformat()
        manifest['exit'] = exit_code
        manifest['unload'] = {model: unload(endpoint, model) for model in sorted(set(models.values()))}
        (out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        if results:
            write_overview(out, arguments.notes, arguments.section)
        print('suite result: ' + str(out), flush=True)
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
