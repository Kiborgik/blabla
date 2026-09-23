import argparse
import fnmatch
import hashlib
import json
import math
from pathlib import Path
import re
import statistics

from agent_eval_common import ROOT
from agent_eval_overview import (ARMS, ENDING_TEXT, MARKS, case_groups, check_label, esc, html_page, inline, problems,
                                 run_ending, run_labels)
from agent_eval_traces import normalize_run
from agent_eval_scorecard import efficiency_html, efficiency_markdown, efficiency_of, efficiency_rows, without_actions, write_scorecard


KINDS = {'command', 'no_command', 'accept_before_edit', 'sequence', 'unchanged', 'scope',
         'file_regex', 'file_exists', 'task_field', 'task_count', 'evidence_recorded', 'observation',
         'skill_read', 'no_skill_read', 'skill_available', 'no_spawn', 'memory_read'}


def validate_rubric(rubric):
    criteria = rubric.get('criteria', [])
    if not criteria:
        raise ValueError('A rubric needs observable criteria')
    identifiers = [criterion['id'] for criterion in criteria]
    if len(identifiers) != len(set(identifiers)):
        raise ValueError('Criterion ids must be unique')
    for criterion in criteria:
        kind = criterion.get('kind')
        if kind not in KINDS:
            raise ValueError(f'Unknown criterion kind: {kind}')
        weight = criterion.get('weight', 1)
        if isinstance(weight, bool) or not isinstance(weight, (int, float)) or not math.isfinite(weight) or weight <= 0:
            raise ValueError('Criterion weights must be finite and positive')
        if criterion.get('arm', 'both') not in ('both', 'with', 'without'):
            raise ValueError('Unknown criterion condition')
        if criterion.get('outcome', 'success') not in ('success', 'any'):
            raise ValueError('A command outcome is success or any')
        if kind in ('command', 'no_command', 'sequence'):
            prefixes = criterion.get('commands', criterion.get('argv_any', [criterion.get('argv')]))
            if not prefixes or any(not isinstance(prefix, list) or not prefix or not all(isinstance(word, str) for word in prefix) for prefix in prefixes):
                raise ValueError('Command criteria need nonempty argument prefixes')
        if 'path' in criterion:
            path = Path(criterion['path'])
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Criterion paths must stay inside the fixture')
        if kind == 'file_regex' or (kind == 'task_count' and 'pattern' in criterion):
            re.compile(criterion['pattern'])
        if kind == 'task_count' and (not isinstance(criterion.get('min'), int) or criterion['min'] < 1):
            raise ValueError('task_count needs a positive minimum')


def verdict(status, reason, evidence=()):
    return {'status': status, 'reason': reason, 'evidence': list(evidence)}


def decide(value, reason, evidence=()):
    return verdict('pass' if value else 'fail', reason, evidence)


def matching(actions, prefix):
    return [action for action in actions if any(argv[:len(prefix)] == prefix and '--help' not in argv and '-h' not in argv
            for argv in action.get('invocations', []))]


def successful(action):
    if action.get('success') is not True:
        return False
    compound = action.get('compound', False)
    success_determined = action.get('success_determined', False)
    return not compound or success_determined


def refs(actions):
    return [action['reference'] for action in actions]


def command_text(argv):
    return '`blabla ' + ' '.join(argv) + '`'


def record_name(criterion):
    return Path(criterion.get('path', '.blabla/tasks/fix-red-checks.json')).stem


OBSERVATION_TEXT = {'syntax': 'Every Python source parses',
                    'persistence': 'Saved widgets survive a restart of the store'}
FIXED_TEXT = {'accept_before_edit': 'Accepts the task before its first edit',
              'memory_read': 'Looks up its role policy',
              'skill_read': 'Opens the BlaBla skill',
              'no_skill_read': 'Leaves the BlaBla skill unopened',
              'skill_available': 'The host offers the BlaBla skill',
              'no_spawn': 'Spawns no subagent'}


def describe(criterion):
    kind = criterion['kind']
    if kind in FIXED_TEXT:
        return FIXED_TEXT[kind]
    if kind in ('command', 'no_command'):
        commands = ' or '.join(command_text(prefix) for prefix in criterion.get('argv_any', [criterion.get('argv', [])]))
        if kind == 'no_command':
            return f'Never runs {commands}'
        return f'Runs {commands}' if criterion.get('outcome', 'success') == 'any' else f'Runs {commands} successfully'
    if kind == 'sequence':
        return 'Runs ' + ', then '.join(command_text(prefix) for prefix in criterion['commands']) + ', in that order'
    if kind == 'unchanged':
        return f'Leaves `{criterion["glob"]}` unchanged'
    if kind == 'scope':
        if not criterion['paths']:
            return 'Changes no file'
        return 'Changes nothing outside ' + ', '.join(f'`{path}`' for path in criterion['paths'])
    if kind == 'file_regex':
        return f'`{criterion["path"]}` {"does not match" if criterion.get("absent") else "matches"} `{criterion["pattern"]}`'
    if kind == 'file_exists':
        return f'Writes `{criterion["path"]}`'
    if kind == 'task_field':
        return f'Task `{record_name(criterion)}` ends with {criterion["field"]} `{criterion["equals"]}`'
    if kind == 'task_count':
        text = f'Task `{record_name(criterion)}` records at least {criterion["min"]} {criterion["field"]}'
        return text + (f' matching `{criterion["pattern"]}`' if 'pattern' in criterion else '')
    if kind == 'evidence_recorded':
        return f'Task `{record_name(criterion)}` ends with a passing run of its declared check'
    name = criterion['name']
    return OBSERVATION_TEXT.get(name, f'An independent `blabla {name.replace(":", " ")}` exits {criterion.get("exit", 0)}')


HARNESS_PATHS = frozenset({
    '.bash_profile', '.bashrc', '.profile', '.zprofile', '.zshrc', '.gitconfig', '.gitmodules', '.mcp.json', '.ripgreprc',
    '.idea', '.vscode', '.eval-artifacts', '.claude/agents', '.claude/commands', '.claude/hooks', '.claude/launch.json',
    '.claude/loop.md', '.claude/output-styles', '.claude/routines', '.claude/scheduled_tasks.json', '.claude/settings.json',
    '.claude/settings.local.json', '.claude/workflows'})


PROJECT_LEVEL_CLASSES = frozenset({'verification-not-current', 'vacuous-rule'})


def harness_only_challenge(output):
    if 'Class: attribution-unknown' not in output:
        return False
    standing = re.search(r'Also standing, one challenge at a time: ([^\n]+)', output)
    if standing and not {name.strip() for name in standing.group(1).split(',')} <= PROJECT_LEVEL_CLASSES:
        return False
    paths = set()
    first = re.search(r'changed since the task opened: (\S+)', output)
    if first:
        paths.add(first.group(1))
    listed = re.search(r'changed paths carry no declaration: ([^\n]+)', output)
    if listed:
        paths.update(path.strip() for path in listed.group(1).split(','))
    return bool(paths) and paths <= HARNESS_PATHS


def harness_blocked_handbacks(actions):
    challenges = [call for call in matching(actions, ['challenge']) if call.get('end') is not None]
    blocked = []
    for ready in matching(actions, ['task', 'ready']):
        output = ready.get('output', '')
        if successful(ready) or not ('BLOCKED' in output or 'cannot be handed back' in output):
            continue
        before = [call for call in challenges if call['end'] <= ready['start']]
        after = [call for call in challenges if call['end'] > ready['start']]
        nearest = after[0] if after else before[-1] if before else None
        if nearest is not None and harness_only_challenge(nearest.get('output', '')):
            blocked.append(ready)
    return blocked


def field(document, path):
    for part in path.split('.'):
        if not isinstance(document, dict):
            return None
        document = document.get(part)
    return document


def oracle_tail(run_dir, reference):
    lines = []
    for name in reference.split(', '):
        path = run_dir / name
        if path.is_file():
            printed = [line.strip() for line in path.read_text(encoding='utf-8', errors='replace').splitlines() if line.strip()]
            if printed:
                lines.append(printed[-1][:200])
    return '; '.join(lines)


def file_hashes(workspace):
    return {path.relative_to(workspace).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in workspace.rglob('*') if path.is_file() and not path.is_symlink()}


def evaluate(criterion, normalized, workspace, before, after, observations):
    kind = criterion['kind']
    actions = normalized['actions']
    if kind in ('command', 'no_command'):
        prefixes = criterion.get('argv_any', [criterion.get('argv', [])])
        calls = [action for action in actions if any(action in matching(actions, prefix) for prefix in prefixes)]
        if kind == 'no_command':
            return decide(not calls, f'{len(calls)} matching invocations observed', refs(calls))
        if criterion.get('outcome', 'success') == 'any':
            completed = [call for call in calls if call.get('end') is not None
                         and (not call.get('compound') or call.get('ordering_determined'))]
            if completed:
                return verdict('pass', 'Command ran to completion; its exit code is not required', refs(completed))
            if calls:
                return verdict('unknown', 'Command appears only in an ambiguous or unfinished tool call', refs(calls))
            return verdict('fail', 'No matching command execution', [])
        passed = [call for call in calls if successful(call)]
        if passed:
            return verdict('pass', 'Successful command execution observed', refs(passed))
        if any(call.get('success') is None or (call.get('compound') and not call.get('ordering_determined')) for call in calls):
            return verdict('unknown', 'Command appears in an ambiguous or unfinished tool call', refs(calls))
        if any(call.get('compound') and call.get('success') is True and not call.get('success_determined') for call in calls):
            return verdict('unknown', 'Command success cannot be determined for compound invocation', refs(calls))
        if any(call.get('compound') and call.get('ordering_determined') and call.get('success') is False for call in calls):
            return verdict('unknown', 'Compound order determined but segment failure identity unknown', refs(calls))
        return verdict('fail', 'No successful matching command execution', refs(calls))
    if kind == 'accept_before_edit':
        accept_calls = matching(actions, ['task', 'accept'])
        accepts = [call for call in accept_calls if successful(call)]
        edits = [call for call in actions if call.get('mutation') in ('yes', 'maybe')]
        if not edits:
            return verdict('unknown', 'No observable implementation edit')
        first = min(edits, key=lambda call: call['start'])
        prior = [call for call in accepts if call.get('end') is not None and call['end'] < first['start']]
        if prior:
            return verdict('pass', 'Acceptance completed before the first possible implementation write', refs(prior + [first]))
        ambiguous_accepts = [call for call in accept_calls
                             if call.get('compound') and call.get('ordering_determined') and not call.get('success_determined')
                             and call.get('end') is not None and call['end'] < first['start']]
        if ambiguous_accepts:
            return verdict('unknown', 'Acceptance sits in a compound call whose success cannot be determined', refs(ambiguous_accepts + [first]))
        is_compound_unknown = first.get('compound') and not first.get('ordering_determined', False)
        if is_compound_unknown or first.get('mutation') == 'maybe' or first.get('success') is not True:
            return verdict('unknown', 'First possible edit cannot be ordered confidently', refs([first]))
        return verdict('fail', 'No acceptance completed before the first implementation write', refs([first]))
    if kind == 'sequence':
        previous_end = 0
        evidence = []
        for prefix in criterion['commands']:
            calls = matching(actions, prefix)
            candidates = [call for call in calls if successful(call) and call['start'] > previous_end]
            if not candidates:
                required = [matching(actions, command) for command in criterion['commands']]
                missing = any(not any(call.get('success') is not False or (call.get('compound') and not call.get('ordering_determined', False)) for call in matches)
                              for matches in required)
                ambiguous = [call for matches in required for call in matches
                             if (call.get('compound') and not call.get('ordering_determined', False)) or call.get('success') is None]
                return verdict('unknown' if ambiguous and not missing else 'fail',
                               f'No proven successful {" ".join(prefix)} after the preceding step', evidence + refs(calls + ambiguous))
            selected = min(candidates, key=lambda call: call['end'])
            previous_end = selected['end']
            evidence.extend(refs([selected]))
        return verdict('pass', 'Required successful command sequence observed', evidence)
    if kind == 'unchanged':
        if before is None:
            return verdict('unknown', 'Trusted initial file hashes are unavailable')
        paths = {path for path in before.keys() | after.keys()
                 if fnmatch.fnmatch(path, criterion['glob']) and '__pycache__' not in Path(path).parts}
        changed = sorted(path for path in paths if before.get(path) != after.get(path))
        written = [action for action in actions if action.get('success') is True and action.get('kind') == 'write'
                   and any(path and fnmatch.fnmatch(path.replace('\\', '/'), criterion['glob']) for path in action.get('paths', []))]
        if written:
            return verdict('fail', 'A protected path was explicitly written, even if later restored', refs(written))
        return decide(not changed, 'Changed protected paths: ' + ', '.join(changed) if changed else 'Protected hashes match',
                      ['before.json', *changed])
    if kind == 'scope':
        if before is None:
            return verdict('unknown', 'Trusted initial file hashes are unavailable')
        changed = [path for path in before.keys() | after.keys() if before.get(path) != after.get(path)
                   and not path.startswith('.blabla/') and '__pycache__' not in Path(path).parts]
        outside = [path for path in changed if not any(path == scope or path.startswith(scope.rstrip('/') + '/')
                                                     for scope in criterion['paths'])]
        return decide(not outside, 'Out-of-scope changes: ' + ', '.join(sorted(outside)) if outside else 'Changes stay in declared scope', outside)
    if kind in ('file_regex', 'file_exists'):
        target = workspace / criterion['path']
        if kind == 'file_exists':
            return decide(target.is_file(), 'File existence observed', [criterion['path']])
        if not target.is_file():
            return verdict('fail', 'Required source file is absent', [criterion['path']])
        found = re.search(criterion['pattern'], target.read_text(encoding='utf-8'), re.MULTILINE) is not None
        return decide(found != criterion.get('absent', False), 'Pattern found in the file' if found else 'Pattern not found in the file',
                      [criterion['path']])
    if kind in ('task_field', 'task_count', 'evidence_recorded'):
        target = workspace / criterion.get('path', '.blabla/tasks/fix-red-checks.json')
        if not target.exists():
            return verdict('fail', 'Task record is absent', [target.relative_to(workspace).as_posix()])
        try:
            task = json.loads(target.read_text(encoding='utf-8'))
        except (ValueError, OSError):
            return verdict('fail', 'Task record is unreadable', [target.relative_to(workspace).as_posix()])
        if kind == 'task_field':
            actual = field(task, criterion['field'])
            blocked = [call for call in actions if call.get('harness_blocked')]
            if criterion['field'] == 'state' and criterion['equals'] == 'ready' and actual != 'ready' and blocked:
                return verdict('pass', 'Hand-back refused only for paths the evaluator planted; counted as ready', refs(blocked))
            return decide(actual == criterion['equals'], f'{criterion["field"]} = {actual!r}', [target.relative_to(workspace).as_posix()])
        if kind == 'task_count':
            rows = field(task, criterion['field'])
            rows = rows if isinstance(rows, list) else []
            if 'pattern' in criterion:
                rows = [row for row in rows if re.search(criterion['pattern'], json.dumps(row), re.MULTILINE)]
            return decide(len(rows) >= criterion['min'], f'{len(rows)} matching {criterion["field"]} rows recorded',
                          [target.relative_to(workspace).as_posix()])
        entries = [entry for entry in task.get('evidence', []) if entry.get('check') == task.get('check')]
        return decide(bool(entries) and entries[-1].get('exit') == 0, 'Latest evidence must answer the declared check successfully',
                      [target.relative_to(workspace).as_posix()])
    if kind == 'observation':
        observation = observations.get(criterion['name'])
        if observation is None:
            return verdict('unknown', 'Independent observation is unavailable')
        expected = criterion.get('exit', 0)
        reason = observation.get('reason', 'Independent check result')
        reference = observation.get('reference', 'observations.json')
        if observation.get('exit') != expected:
            reason += f', expected {expected}' if 'exited' in reason else f': exit {observation.get("exit")}, expected {expected}'
            tail = oracle_tail(workspace.parent, reference)
            if tail:
                reason += f'; it printed: {tail}'
        return decide(observation.get('exit') == expected, reason, [reference])
    if kind == 'memory_read':
        reads = [action for action in actions if any(argv[:1] == ['explain'] and len(argv) > 1 and argv[1].startswith('role::')
                                                     for argv in action.get('invocations', []))]
        reads.extend(action for action in actions if action.get('success') is True and (
            action['kind'] == 'read' and action.get('path', '').endswith('process.bla')
            or action['kind'] == 'command' and re.search(r'\bcat\b[^\n]*process\.bla', action.get('command', ''))))
        found = any(action.get('success') is True for action in reads)
        return decide(found, 'Role policy lookup observed' if found else 'No role policy lookup observed', refs(reads))
    if kind in ('skill_read', 'no_skill_read'):
        reads = [action for action in actions if action.get('success') is True and (
            action['kind'] == 'skill' and action.get('skill', '').split(':')[-1] == 'blabla'
            or action['kind'] == 'read' and 'blabla/SKILL.md' in action.get('path', '').replace('\\', '/')
            or action['kind'] == 'command' and re.search(r'\bcat\b[^\n]*blabla/SKILL\.md', action.get('command', '')))]
        return decide(bool(reads) if kind == 'skill_read' else not reads, f'{len(reads)} explicit skill reads observed', refs(reads))
    if kind == 'skill_available':
        available = normalized.get('skill_available')
        if available is None:
            return verdict('unknown', 'Host skill catalog evidence is unavailable')
        return decide(available == criterion.get('equals', True), 'Observed host skill catalog', ['prompt-input.json or trace init'])
    if kind == 'no_spawn':
        if normalized.get('spawn_available') is False:
            return verdict('not_applicable', 'Subagent tools were disabled by the harness')
        if normalized.get('spawn_available') is None:
            return verdict('unknown', 'Subagent capability is not recorded')
        calls = [action for action in actions if action['kind'] == 'spawn']
        return decide(not calls, f'{len(calls)} spawn attempts', refs(calls))
    raise ValueError(f'Unknown criterion kind: {kind}')


OUTCOME_KINDS = {'unchanged', 'scope', 'file_regex', 'file_exists'}


def applies_without_blabla(criterion, before, after):
    kind = criterion['kind']
    if kind == 'observation':
        return criterion['name'] in ('syntax', 'persistence')
    if kind == 'unchanged':
        paths = before.keys() | after.keys() if before is not None else after.keys()
        return any(fnmatch.fnmatch(path, criterion['glob']) for path in paths)
    return kind in OUTCOME_KINDS


def grade_run(rubric, normalized, workspace, before, arm, observations=None):
    validate_rubric(rubric)
    results = []
    after = file_hashes(workspace)
    for call in harness_blocked_handbacks(normalized.get('actions', [])):
        call.update(success=True, success_determined=True, harness_blocked=True)
    for criterion in rubric['criteria']:
        result = {'id': criterion['id'], 'description': describe(criterion), 'weight': criterion.get('weight', 1),
                  'required': criterion.get('required', False), 'scored': criterion.get('scored', True),
                  'shared': applies_without_blabla(criterion, before, after)}
        if criterion.get('arm', 'both') not in ('both', arm):
            result.update(verdict('not_applicable', 'Criterion belongs to the other condition'))
        elif arm == 'without' and not result['shared']:
            result.update(verdict('not_applicable', 'Needs BlaBla, which this arm does not have'))
        elif not normalized.get('gradable', normalized['complete']):
            result.update(verdict('unknown', 'Execution did not produce a complete trace'))
        else:
            result.update(evaluate(criterion, normalized, workspace, before, after, observations or {}))
        results.append(result)
    applicable = [result for result in results if result['scored'] and result['status'] != 'not_applicable']
    total = sum(result['weight'] for result in applicable)
    unknown = any(result['status'] == 'unknown' for result in results if result['scored'] or result['required'])
    score = None if not total or unknown else sum(result['weight'] for result in applicable if result['status'] == 'pass') / total
    required = [result for result in results if result['required'] and result['status'] != 'not_applicable']
    gradable = normalized.get('gradable', normalized['complete'])
    return {'valid': gradable, 'terminal': normalized.get('terminal', 'success' if normalized['complete'] else 'error'),
            'arm': arm, 'score': score, 'applicable_weight': total,
            'observed_weight': sum(result['weight'] for result in applicable if result['status'] != 'unknown'),
            'passed': gradable and bool(required) and all(result['status'] == 'pass' for result in required),
            'criteria': results, 'diagnostics': normalized['diagnostics']}


LEGEND = 'Marks: ✓ passed, ✗ failed, ? unknown, – does not apply to this arm.'
SHARED_NOTE = ('Shared checks are the scored checks both arms face in a case: sources, protected files, scope, persistence. '
               'BlaBla-only checks are the ones only the arm with BlaBla faces: acceptance, evidence, hand-back, contracts, the gate. '
               'A run passes when every required check it faces passes; an unknown check never counts as passed.')
PURPOSE = 'Diagnostic evidence of how BlaBla works with coding agents, not a model ranking.'


def run_summary(result):
    score = 'unknown' if result['score'] is None else f'{result["score"]:.0%}'
    verdict = 'passed' if result['passed'] else 'did not pass'
    lines = [f'  {verdict} its required checks · score {score} · {ENDING_TEXT[run_ending(result)]} · {result.get("seconds") or 0:.0f} s']
    for status, label in (('fail', 'failed'), ('unknown', 'unknown')):
        names = [criterion['id'] for criterion in result['criteria'] if criterion['status'] == status]
        if names:
            lines.append(f'  {label}: ' + ', '.join(names))
    return '\n'.join(lines)


def mark_comparable(results):
    faced = {}
    for run in results:
        ids = {criterion['id'] for criterion in run['criteria']
               if criterion.get('scored', True) and criterion['status'] != 'not_applicable'}
        faced.setdefault((run['case'], run['host']), {}).setdefault(run['arm'], []).append(ids)
    comparable = {key: set.intersection(*arms['with'], *arms['without']) if set(ARMS) <= arms.keys() else set()
                  for key, arms in faced.items()}
    for run in results:
        for criterion in run['criteria']:
            criterion['comparable'] = criterion['id'] in comparable[(run['case'], run['host'])]
    return comparable


def run_points(run, comparable):
    rows = [criterion for criterion in run['criteria'] if criterion.get('scored', True)
            and criterion['status'] != 'not_applicable' and criterion.get('comparable', False) == comparable]
    available = sum(criterion['weight'] for criterion in rows)
    if not available:
        return None
    if not run.get('valid') or any(criterion['status'] == 'unknown' for criterion in rows):
        return 'unknown'
    return sum(criterion['weight'] for criterion in rows if criterion['status'] == 'pass') / available


def mean_points(runs, comparable):
    values = [value for value in (run_points(run, comparable) for run in runs) if value is not None]
    if not values:
        return None
    if 'unknown' in values:
        return 'unknown'
    return sum(values) / len(values)


def percent(value):
    if value is None:
        return '–'
    return 'unknown' if value == 'unknown' else f'{value:.0%}'


def check_rows(runs):
    rows = {}
    for run in runs:
        for criterion in run['criteria']:
            rows.setdefault(criterion['id'], criterion)
    return list(rows.values())


def run_path(run):
    prefix, _, name = str(run['run']).rpartition('/')
    return '/'.join(part for part in (prefix, run['arm'], name) if part)


def weight_text(criterion):
    if not criterion.get('scored', True):
        return 'not scored'
    return f'{criterion["weight"]:g}' + (', required' if criterion.get('required') else '')


def aggregate(case, host, arm, runs):
    rates = {}
    for run in runs:
        for criterion in run['criteria']:
            counts = rates.setdefault(criterion['id'], {status: 0 for status in MARKS})
            counts[criterion['status']] += 1
    scores = [run['score'] for run in runs if run['valid'] and run['score'] is not None]
    seconds = [run['seconds'] for run in runs if run.get('seconds') is not None]
    endings = [run_ending(run) for run in runs]
    return {'case': case, 'host': host, 'arm': arm, 'runs': len(runs),
            'complete': sum(run['valid'] for run in runs), 'passed': sum(run['passed'] for run in runs),
            'endings': {ending: endings.count(ending) for ending in ENDING_TEXT if ending in endings},
            'mean_score': sum(scores) / len(scores) if scores else None, 'fully_scored_runs': len(scores),
            'comparable_score': mean_points(runs, True), 'blabla_only_score': mean_points(runs, False),
            'median_seconds': statistics.median(seconds) if seconds else None, 'criteria': rates}


def comparisons(groups, aggregates, comparable):
    lookup = {(group['case'], group['host'], group['arm']): group for group in aggregates}
    deltas = []
    for (case, host), runs in groups.items():
        pair = [lookup.get((case, host, arm)) for arm in ARMS]
        if None in pair:
            continue
        ids = comparable[(case, host)]
        scores = [group['comparable_score'] for group in pair]
        complete = all(isinstance(score, float) for score in scores)
        deltas.append({'case': case, 'host': host, 'checks': len(ids),
                       'points': sum(row['weight'] for row in check_rows(runs) if row['id'] in ids),
                       'with': scores[0], 'without': scores[1],
                       'with_minus_without': scores[0] - scores[1] if complete else None,
                       'reason': 'Descriptive difference over the checks both arms face' if complete
                       else 'No complete comparison: a run is unknown or the arms share no check'})
    return deltas


def comparison_text(delta):
    arms = f'{percent(delta["with"])} with BlaBla, {percent(delta["without"])} without'
    if delta['with_minus_without'] is None:
        return f'no complete comparison ({arms}); a run is unknown or the arms share no check.'
    return (f'**{delta["with_minus_without"] * 100:+.0f} points**: {arms}, over the {delta["checks"]} checks '
            f'({delta["points"]:g} points) both arms face.')


def endings_text(group):
    return ', '.join(f'{count} {ending}' for ending, count in group['endings'].items())


def seconds_text(value):
    if value is None:
        return '–'
    return f'{value / 60:.0f} min' if value >= 120 else f'{value:.0f} s'


def md(text):
    return str(text).replace('|', '\\|').replace('\n', ' ')


def summary_cells(group):
    return [group['case'], group['host'], group['arm'], str(group['runs']), endings_text(group),
            f'{group["passed"]}/{group["runs"]}', percent(group['comparable_score']),
            percent(group['blabla_only_score']), seconds_text(group['median_seconds'])]


SUMMARY_HEADERS = ('Case', 'Host', 'Arm', 'Runs', 'Ended', 'Passed', 'Shared checks', 'BlaBla-only checks', 'Median time')
NUMERIC = {'Runs', 'Passed', 'Shared checks', 'BlaBla-only checks', 'Median time'}


def markdown_report(groups, aggregates, deltas, efficiency):
    lines = ['# BlaBla evaluation report', '', PURPOSE, '', '## Summary', '',
             '| ' + ' | '.join(SUMMARY_HEADERS) + ' |',
             '|' + ''.join(' ---: |' if header in NUMERIC else ' --- |' for header in SUMMARY_HEADERS)]
    lines.extend('| ' + ' | '.join(md(cell) for cell in summary_cells(group)) + ' |' for group in aggregates)
    lines.extend(['', SHARED_NOTE])
    if deltas:
        lines.extend(['', '## With BlaBla against without', ''])
        lines.extend(f'- **{md(delta["case"])}** ({md(delta["host"])}): {comparison_text(delta)}' for delta in deltas)
    lines.extend(efficiency_markdown(efficiency))
    for (case, host), runs in groups.items():
        labels = run_labels(runs)
        cells = [{criterion['id']: criterion for criterion in run['criteria']} for run in runs]
        lines.extend(['', f'## {case} ({host})', '', LEGEND, '',
                      '| Check | Weight | ' + ' | '.join(labels) + ' |', '| --- | --- |' + ' :---: |' * len(runs)])
        for row in check_rows(runs):
            marks = ' | '.join(MARKS[cell[row['id']]['status']] if row['id'] in cell else ' ' for cell in cells)
            lines.append(f'| {md(check_label(row))} | {weight_text(row)} | {marks} |')
        lines.extend(['', 'Runs: ' + ', '.join(f'{label} is `{run_path(run)}`' for label, run in zip(labels, runs)) + '.'])
        notes = [(label, text) for label, run in zip(labels, runs) for text in problems(run)]
        if notes:
            lines.extend(['', 'What did not pass:', ''])
            lines.extend(f'- **{label}**: {md(text)}' for label, text in notes)
    return '\n'.join(lines) + '\n'


def html_report(groups, aggregates, deltas, efficiency):
    parts = ['<p class="eyebrow">BlaBla agent evaluation</p>', '<h1>Evaluation report</h1>', f'<p class="lede">{esc(PURPOSE)}</p>',
             '<h2>Summary</h2>', '<div class="scroll"><table><tr>'
             + ''.join(f'<th{" class=num" if header in NUMERIC else ""}>{header}</th>' for header in SUMMARY_HEADERS) + '</tr>']
    for group in aggregates:
        cells = ''.join(f'<td{" class=num" if header in NUMERIC else ""}>{esc(cell)}</td>'
                        for header, cell in zip(SUMMARY_HEADERS, summary_cells(group)))
        parts.append(f'<tr data-case="{esc(group["case"])}" data-arm="{group["arm"]}" data-passed="{group["passed"]}" data-runs="{group["runs"]}">{cells}</tr>')
    parts.extend(['</table></div>', f'<p class="note">{esc(SHARED_NOTE)}</p>'])
    if deltas:
        parts.append('<h2>With BlaBla against without</h2><ul class="why">')
        parts.extend(f'<li data-case="{esc(delta["case"])}"><b>{esc(delta["case"])}</b> ({esc(delta["host"])}): {inline(comparison_text(delta))}</li>'
                     for delta in deltas)
        parts.append('</ul>')
    parts.extend(efficiency_html(efficiency))
    for (case, host), runs in groups.items():
        labels = run_labels(runs)
        cells = [{criterion['id']: criterion for criterion in run['criteria']} for run in runs]
        parts.extend([f'<h2>{esc(case)} <small class="host">{esc(host)}</small></h2>', f'<p class="note">{esc(LEGEND)}</p>',
                      '<div class="scroll"><table class="checks"><tr><th>Check</th><th>Weight</th>'
                      + ''.join(f'<th class="mark">{esc(label)}</th>' for label in labels) + '</tr>'])
        for row in check_rows(runs):
            marks = ''.join(f'<td class="mark {cell[row["id"]]["status"]}" data-status="{cell[row["id"]]["status"]}">{MARKS[cell[row["id"]]["status"]]}</td>'
                            if row['id'] in cell else '<td class="mark"></td>' for cell in cells)
            parts.append(f'<tr data-check="{esc(row["id"])}"><td class="check">{inline(row.get("description", row["id"]))}<small>{esc(row["id"])}</small></td>'
                         f'<td class="nowrap">{esc(weight_text(row))}</td>{marks}</tr>')
        parts.append('</table></div>')
        parts.append('<p class="note">Runs: ' + ', '.join(f'{esc(label)} is <code>{esc(run_path(run))}</code>' for label, run in zip(labels, runs)) + '.</p>')
        notes = [(label, text) for label, run in zip(labels, runs) for text in problems(run)]
        if notes:
            parts.append('<h3>What did not pass</h3><ul class="why">')
            parts.extend(f'<li><b>{esc(label)}</b>: {inline(text)}</li>' for label, text in notes)
            parts.append('</ul>')
    parts.append('<footer>Aggregates, deltas and every criterion with its evidence are in grades.json; capability coverage is in scorecard.html.</footer>')
    return html_page('BlaBla evaluation report', parts)


def write_reports(results, out_dir):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    comparable = mark_comparable(results)
    groups = case_groups(results)
    aggregates = [aggregate(case, host, arm, [run for run in runs if run['arm'] == arm])
                  for (case, host), runs in groups.items() for arm in ARMS if any(run['arm'] == arm for run in runs)]
    deltas = comparisons(groups, aggregates, comparable)
    efficiency = efficiency_rows(results)
    runs = without_actions(results)
    for row, result in zip(runs, results):
        row['measures'] = efficiency_of(result)
    report = {'purpose': PURPOSE, 'runs': runs, 'aggregates': aggregates, 'deltas': deltas, 'efficiency': efficiency}
    (out_dir / 'grades.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    (out_dir / 'report.md').write_text(markdown_report(groups, aggregates, deltas, efficiency), encoding='utf-8')
    (out_dir / 'report.html').write_text(html_report(groups, aggregates, deltas, efficiency), encoding='utf-8')
    coverage_path = ROOT / 'evals' / 'coverage.json'
    if not coverage_path.exists():
        raise FileNotFoundError(f"Coverage file not found: {coverage_path}")
    coverage = json.loads(coverage_path.read_text(encoding='utf-8'))
    write_scorecard(results, coverage, out_dir)
    return report


def declared_check(case_dir, arm):
    if arm == 'without':
        prompt = case_dir / 'prompt-without.md'
        found = re.search(r'Declared check: `([^`]+)`', prompt.read_text(encoding='utf-8')) if prompt.exists() else None
        return found.group(1) if found else None
    fixture = case_dir / 'fixture.json'
    if not fixture.exists():
        return None
    for step in json.loads(fixture.read_text(encoding='utf-8')).get('after_arm', []):
        argv = step.get('run', [])
        if argv[1:3] == ['task', 'open'] and '--check' in argv:
            return argv[argv.index('--check') + 1]
    return None


def grade_directory(case_dir, run_dir, host, arm):
    rubric = json.loads((case_dir / 'rubric.json').read_text(encoding='utf-8'))
    before_path = run_dir / 'before.json'
    before = json.loads(before_path.read_text(encoding='utf-8')) if before_path.exists() else None
    observed_path = run_dir / 'observations.json'
    observations = json.loads(observed_path.read_text(encoding='utf-8')) if observed_path.exists() else {}
    normalized = normalize_run(host, run_dir)
    result = grade_run(rubric, normalized, run_dir / 'workspace', before, arm, observations)
    result.update(case=case_dir.name, host=host, run=run_dir.name, actions=normalized.get('actions', []),
                  tokens=normalized.get('tokens'), turns=normalized.get('turns'), check=declared_check(case_dir, arm))
    return result


def failed_run(case_dir, run_dir, host, arm, failure):
    rubric = json.loads((case_dir / 'rubric.json').read_text(encoding='utf-8'))
    normalized = {'host': host, 'complete': False, 'actions': [], 'skill_available': None,
                  'spawn_available': None, 'diagnostics': [{'message': str(failure)}]}
    result = grade_run(rubric, normalized, run_dir / 'workspace', None, arm)
    result.update(case=case_dir.name, host=host, run=run_dir.name, execution='harness-failed')
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / 'summary.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


def main():
    parser = argparse.ArgumentParser(description='Replay shared BlaBla grading without model calls')
    parser.add_argument('campaign', type=Path)
    arguments = parser.parse_args()
    metadata = json.loads((arguments.campaign / 'metadata.json').read_text())
    results = []
    for arm in ('with', 'without'):
        for run in sorted((arguments.campaign / arm).glob('run-*')):
            case = arguments.campaign / 'materials/evals' / metadata['case']
            results.append(grade_directory(case, run, metadata['host'], arm))
    write_reports(results, arguments.campaign)


if __name__ == '__main__':
    main()
