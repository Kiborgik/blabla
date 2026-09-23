import json
from pathlib import Path
import re
import shlex


def codex_skill_available(prompt):
    def objects(value):
        if isinstance(value, dict):
            yield value
            for child in value.values():
                yield from objects(child)
        elif isinstance(value, list):
            for child in value:
                yield from objects(child)
    try:
        document = json.loads(prompt)
    except ValueError:
        return None
    for message in objects(document):
        if message.get('role') != 'developer':
            continue
        for item in message.get('content', []):
            text = item.get('text', '') if isinstance(item, dict) else ''
            if '<skills_instructions>' in text:
                return re.search(r'^- blabla:', text, re.MULTILINE) is not None
    return None


def shell_body(command):
    try:
        words = shlex.split(command)
    except ValueError:
        return command
    if words and Path(words[0]).name in ('bash', 'sh', 'zsh', 'dash'):
        for index, word in enumerate(words[:-1]):
            if word in ('-c', '-lc'):
                return words[index + 1]
    return command


def command_facts(command, exit_code=None):
    body = shell_body(command)
    try:
        lexer = shlex.shlex(body, posix=True, punctuation_chars=';&|<>()')
        lexer.whitespace_split = True
        lexer.commenters = ''
        words = list(lexer)
    except ValueError:
        return {'invocations': [], 'compound': True, 'mutation': 'maybe'}
    segments, current, connectors = [], [], []
    for word in words:
        if word in (';', '&&', '||', '|', '&'):
            segments.append(current)
            connectors.append(word)
            current = []
        else:
            current.append(word)
    segments.append(current)
    invocations = []
    mutations = []
    for segment in segments:
        while segment and (segment[0] == 'env' or re.match(r'^[A-Za-z_][A-Za-z_0-9]*=', segment[0])):
            segment = segment[1:]
        if not segment:
            continue
        executable = Path(segment[0]).name
        if executable in ('blabla', 'blabla.exe'):
            arguments = []
            skip = False
            for word in segment[1:]:
                if skip:
                    skip = False
                    continue
                if word == '--project':
                    skip = True
                elif word not in ('--json', '--verbose') and not word.startswith('--project='):
                    arguments.append(word)
            invocations.append(arguments)
            mutations.append('yes' if arguments[:1] == ['init'] else 'no')
        elif any(word in ('>', '>>', '>|', '&>') and index + 1 < len(segment)
                 and segment[index + 1] != '/dev/null' for index, word in enumerate(segment)) or executable in ('tee', 'touch', 'rm', 'mv', 'cp', 'install'):
            mutations.append('yes')
        elif executable == 'sed' and any(word.startswith('-i') for word in segment[1:]):
            mutations.append('yes')
        elif executable in ('cat', 'ls', 'pwd', 'find', 'rg', 'grep', 'head', 'tail', 'echo', 'printf', 'wc', 'stat', 'which', 'command', 'cd', 'test'):
            mutations.append('no')
        elif executable == 'git' and segment[1:2] in (['status'], ['diff'], ['show'], ['log']):
            mutations.append('no')
        else:
            mutations.append('maybe')
    mutation = 'yes' if 'yes' in mutations else 'maybe' if 'maybe' in mutations else 'no'
    lines = body.strip().splitlines()
    heredoc = False
    if '<<' in words and len(lines) > 1 and words[0] in ('cat', 'tee'):
        delimiter = words[words.index('<<') + 1]
        heredoc = lines[-1].strip() == delimiter and all(line.strip() != delimiter for line in lines[1:-1])
    is_compound = len(segments) > 1 or ('\n' in body and not heredoc)
    ordering_determined = False
    success_determined = False
    if is_compound and len(connectors) > 0:
        ambiguous_connectors = set(connectors) & {'||', '|', '&'}
        has_subshell = '(' in words or '$(' in body
        has_backtick = '`' in body
        has_redirection = any(word in ('>', '>>', '>|', '&>', '<', '<<') for word in words)
        if not ambiguous_connectors and not has_subshell and not has_backtick and not has_redirection and not heredoc:
            all_connectors_and = set(connectors) == {'&&'}
            ordering_determined = True
            if all_connectors_and and exit_code == 0:
                success_determined = True
    result = {'invocations': invocations, 'compound': is_compound, 'mutation': mutation}
    if ordering_determined:
        result['ordering_determined'] = True
    if success_determined:
        result['success_determined'] = True
    return result


def action(identifier, order, kind, **values):
    return {'id': identifier, 'start': order, 'end': None, 'kind': kind,
            'success': None, 'output': '', 'reference': f'trace.jsonl:{order}', **values}


def normalize_events(host, events):
    actions = {}
    complete = False
    terminal = 'error'
    turns = None
    diagnostics = []
    skill_available = None
    spawn_available = False if host == 'codex' else None
    tokens = None
    for number, event in enumerate(events, 1):
        kind = event.get('type')
        if host == 'codex':
            if kind == 'turn.completed':
                complete = True
                usage = event.get('usage') or {}
                if usage:
                    tokens = {'prompt': usage.get('input_tokens', 0), 'cached': usage.get('cached_input_tokens', 0),
                              'output': usage.get('output_tokens', 0)}
            if kind in ('error', 'turn.failed'):
                diagnostics.append({'reference': f'trace.jsonl:{number}', 'message': event.get('message', str(event))})
            item = event.get('item', {})
            item_type = item.get('type')
            identifier = item.get('id', str(number))
            if item_type == 'error':
                diagnostics.append({'reference': f'trace.jsonl:{number}', 'message': item.get('message', '')})
            if item_type == 'command_execution' and kind in ('item.started', 'item.completed'):
                command = item.get('command', '')
                entry = actions.setdefault(identifier, action(identifier, number, 'command', command=command, **command_facts(command)))
                if kind == 'item.completed':
                    code = item.get('exit_code')
                    entry.update(end=number, success=code == 0 if code is not None else None,
                                 exit_code=code, output=item.get('aggregated_output', ''))
                    facts = command_facts(command, code)
                    if 'ordering_determined' in facts:
                        entry['ordering_determined'] = facts['ordering_determined']
                    elif 'ordering_determined' in entry:
                        del entry['ordering_determined']
                    if 'success_determined' in facts:
                        entry['success_determined'] = facts['success_determined']
                    elif 'success_determined' in entry:
                        del entry['success_determined']
            if item_type == 'file_change' and kind in ('item.started', 'item.completed'):
                entry = actions.setdefault(identifier, action(identifier, number, 'write', mutation='yes',
                    paths=[change.get('path') for change in item.get('changes', [])]))
                if kind == 'item.completed':
                    entry.update(end=number, success=item.get('status') == 'completed')
        else:
            if kind == 'system' and event.get('subtype') == 'init':
                skills = event.get('skills')
                if skills is not None:
                    skill_available = any(name.split(':')[-1] == 'blabla' for name in skills)
                tools = event.get('tools', [])
                spawn_available = any(name in tools for name in ('Agent', 'Task'))
            if kind == 'result':
                complete = not event.get('is_error', False) and event.get('subtype', 'success') == 'success'
                terminal = event.get('subtype', 'success')
                turns = event.get('num_turns', turns)
                usage = event.get('usage') or {}
                if usage:
                    tokens = {'prompt': usage.get('input_tokens', 0),
                              'cached': usage.get('cache_creation_input_tokens', 0) + usage.get('cache_read_input_tokens', 0),
                              'output': usage.get('output_tokens', 0)}
                if not complete:
                    diagnostics.append({'reference': f'trace.jsonl:{number}',
                                        'message': f'{event.get("terminal_reason", event.get("subtype", "error"))}: {event.get("result", "")}'})
            message = event.get('message', {})
            if not isinstance(message, dict):
                continue
            content = message.get('content', [])
            if not isinstance(content, list):
                continue
            for block in content:
                if block.get('type') == 'tool_use':
                    identifier = block['id']
                    tool = block.get('name')
                    arguments = block.get('input', {})
                    if tool == 'Bash':
                        command = arguments.get('command', '')
                        entry = action(identifier, number, 'command', command=command, **command_facts(command))
                    elif tool in ('Write', 'Edit', 'NotebookEdit'):
                        entry = action(identifier, number, 'write', mutation='yes', paths=[arguments.get('file_path', arguments.get('notebook_path'))])
                    elif tool == 'Skill':
                        entry = action(identifier, number, 'skill', skill=arguments.get('skill', ''))
                    elif tool == 'Read':
                        entry = action(identifier, number, 'read', path=arguments.get('file_path', ''))
                    elif tool in ('Agent', 'Task'):
                        entry = action(identifier, number, 'spawn')
                    else:
                        entry = action(identifier, number, 'other', tool=tool)
                    actions.setdefault(identifier, entry)
                if block.get('type') == 'tool_result':
                    entry = actions.get(block.get('tool_use_id'))
                    if entry is not None:
                        output = block.get('content', '')
                        entry.update(end=number, success=not block.get('is_error', False),
                                     output=output if isinstance(output, str) else json.dumps(output))
                        if entry.get('kind') == 'command':
                            command = entry.get('command', '')
                            facts = command_facts(command, 0 if entry['success'] else 1)
                            if 'ordering_determined' in facts:
                                entry['ordering_determined'] = facts['ordering_determined']
                            elif 'ordering_determined' in entry:
                                del entry['ordering_determined']
                            if 'success_determined' in facts:
                                entry['success_determined'] = facts['success_determined']
                            elif 'success_determined' in entry:
                                del entry['success_determined']
    return {'host': host, 'complete': complete, 'terminal': terminal, 'gradable': complete or terminal == 'error_max_turns',
            'actions': list(actions.values()), 'tokens': tokens, 'turns': turns if turns is not None else len(actions),
            'skill_available': skill_available, 'spawn_available': spawn_available, 'diagnostics': diagnostics}


def normalize_run(host, run_dir):
    run_dir = Path(run_dir)
    trace = run_dir / 'trace.jsonl'
    events, malformed = [], []
    if trace.exists():
        for number, line in enumerate(trace.read_text(encoding='utf-8').splitlines(), 1):
            try:
                events.append(json.loads(line))
            except ValueError:
                malformed.append(number)
    normalized = normalize_events(host, events)
    if malformed:
        normalized['complete'] = False
        normalized['gradable'] = False
        normalized['diagnostics'].append({'message': 'Malformed trace lines', 'lines': malformed})
    prompt = run_dir / 'prompt-input.json'
    if host == 'codex' and prompt.exists():
        normalized['skill_available'] = codex_skill_available(prompt.read_text(encoding='utf-8'))
    capabilities = run_dir / 'capabilities.json'
    if capabilities.exists():
        recorded = json.loads(capabilities.read_text(encoding='utf-8'))
        normalized['spawn_available'] = recorded.get('spawn_available', normalized['spawn_available'])
    return normalized
