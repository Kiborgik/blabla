import json
from pathlib import Path
import shutil
import subprocess
import sys


def sandbox_paths(document):
    paths = set()
    for case in document.get('cases', []):
        for runs in case.get('arms', {}).values():
            for run in runs:
                trace = Path(run.get('tracePath') or '')
                if (trace.name == 'trace.jsonl' and trace.parent.name == 'out'
                        and trace.parent.parent.parent == Path('/tmp')
                        and trace.parent.parent.name.startswith('claude-eval-')):
                    paths.add(trace.parent.parent)
    return sorted(paths)


def collect(stage, output):
    failures = []
    for report in (stage / 'evals/results').glob('*/aggregate-result.json'):
        for sandbox in sandbox_paths(json.loads(report.read_text())):
            if not sandbox.is_dir():
                failures.append(f'missing retained sandbox: {sandbox.name}')
                continue
            subprocess.run(['chmod', '-R', 'u+rwX', str(sandbox)], check=True)
            destination = stage / 'retained' / sandbox.name
            destination.mkdir(parents=True, exist_ok=True)
            trace = sandbox / 'out/trace.jsonl'
            if trace.exists():
                shutil.copyfile(trace, destination / 'trace.jsonl')
            else:
                failures.append(f'missing trace: {sandbox.name}')
            workspace = next((sandbox / path for path in ('sealed/home/cwd', 'home/cwd')
                              if (sandbox / path).is_dir()), None)
            if workspace is None:
                failures.append(f'missing workspace: {sandbox.name}')
            else:
                shutil.copytree(workspace, destination / 'workspace', dirs_exist_ok=True)
    (stage / 'collection.json').write_text(json.dumps({'limitations': failures}, indent=2))
    shutil.copytree(stage, output, dirs_exist_ok=True)
    for failure in failures:
        print(failure, file=sys.stderr)


if __name__ == '__main__':
    collect(Path(sys.argv[1]), Path(sys.argv[2]))
