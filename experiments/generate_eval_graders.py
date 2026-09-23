import argparse
import json
from pathlib import Path
import re


def native_definition(criterion):
    kind = criterion['kind']
    definition = {'weight': criterion.get('weight', 1)}
    if kind == 'file_regex':
        definition.update(type='regex', target={'source': 'file', 'path': criterion['path']}, pattern=criterion['pattern'])
        if criterion.get('absent'):
            definition['match'] = 'not_contains'
    elif kind == 'file_exists':
        definition.update(type='file_exists', path=criterion['path'])
    elif kind in ('command', 'no_command'):
        prefixes = criterion.get('argv_any', [criterion.get('argv', [])])
        alternatives = ['\\s+'.join(re.escape(word) for word in prefix) for prefix in prefixes]
        definition.update(type='tool_used', tool='Bash', input_match=r'blabla\s+(?:' + '|'.join(alternatives) + ')')
        definition.update({'min': 0, 'max': 0} if kind == 'no_command' else {'min': 1})
    elif kind in ('skill_read', 'no_skill_read'):
        definition.update(type='tool_used', tool='Skill', input_match=r'"skill"\s*:\s*"(?:[\w-]+:)?blabla"')
        if kind == 'no_skill_read':
            definition.update(min=0, max=0, arm='both')
    else:
        return None
    return '---\n' + '\n'.join(f'{key}: {json.dumps(value)}' for key, value in definition.items()) + '\n---\n'


def generate(case, check=False):
    rubric = json.loads((case / 'rubric.json').read_text(encoding='utf-8'))
    expected = {criterion['id'] + '.md': text for criterion in rubric['criteria']
                if (text := native_definition(criterion)) is not None}
    directory = case / 'graders'
    actual = {path.name: path.read_text(encoding='utf-8') for path in directory.glob('*.md')}
    if check:
        return actual == expected
    directory.mkdir(exist_ok=True)
    for name in actual.keys() - expected.keys():
        (directory / name).unlink()
    for name, text in expected.items():
        (directory / name).write_text(text, encoding='utf-8')
    return True


def main():
    parser = argparse.ArgumentParser(description='Generate supplemental native Claude graders from the common rubric')
    parser.add_argument('--check', action='store_true')
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parent.parent / 'evals'
    results = [generate(path.parent, arguments.check) for path in sorted(root.glob('*/rubric.json'))]
    if not all(results):
        raise SystemExit('Native grader files differ from their authoritative rubric')


if __name__ == '__main__':
    main()
