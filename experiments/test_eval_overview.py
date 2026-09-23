import json
from pathlib import Path
import tempfile
import unittest

from agent_eval_overview import build, markdown_section


class OverviewTests(unittest.TestCase):
    def suite(self, root):
        runs = [{'case': 'c', 'host': 'codex', 'arm': arm, 'run': f'{arm}-1', 'valid': valid, 'passed': passed, 'score': None,
                 'criteria': [], 'diagnostics': diagnostics}
                for arm, valid, passed, diagnostics in (('with', True, True, []),
                                                        ('without', False, False, [{'message': 'api_error: exceeded the output token maximum'}]))]
        grades = {'runs': runs,
                  'aggregates': [{'case': 'c', 'host': 'codex', 'arm': 'with', 'runs': 1, 'complete': 1, 'passed': 1, 'mean_score': 0.5},
                                 {'case': 'c', 'host': 'codex', 'arm': 'without', 'runs': 1, 'complete': 0, 'passed': 0, 'mean_score': None}],
                  'efficiency': [{'case': 'c', 'host': 'codex', 'arm': 'with', 'seconds': {'median': 12.0}, 'blabla_invocations': {'median': 3}}]}
        scorecard = {'capabilities': {
            'rows': [{'id': 'x', 'title': 'Do the thing', 'host': 'codex', 'arm': 'with', 'points': {'available': 4}},
                     {'id': 'x', 'title': 'Do the thing', 'host': 'codex', 'arm': 'without', 'points': {'available': 4}}],
            'deltas': [{'id': 'x', 'host': 'codex', 'comparable': True, 'lower': 1, 'upper': 3, 'available': 4}]},
            'missing': {'capabilities': ['nothing about y'], 'behaviors': []}}
        (root / 'grades.json').write_text(json.dumps(grades), encoding='utf-8')
        (root / 'scorecard.json').write_text(json.dumps(scorecard), encoding='utf-8')
        (root / 'manifest.json').write_text(json.dumps({'models': {'c': 'qwen3.5:4b'}, 'started_utc': '20260922T000000Z'}), encoding='utf-8')

    def test_overview_page_carries_counts_charts_and_prose(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.suite(root)
            notes = root / 'notes.md'
            notes.write_text('# Findings\n\n## Campaign 9: test\n\nA paragraph with `code`.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- one\n- two\n\n## Other\n\nnot this\n', encoding='utf-8')
            payload = build(root, notes, 'Campaign 9')
            page = (root / 'overview.html').read_text(encoding='utf-8')
            self.assertEqual(payload['headline']['runs'], 2)
            self.assertEqual(payload['headline']['complete'], 1)
            self.assertEqual(payload['headline']['capped'], 1)
            self.assertEqual(payload['capabilities'][0]['low'], 25.0)
            self.assertEqual(payload['capabilities'][0]['high'], 75.0)
            self.assertIn('id="diff-codex"', page)
            self.assertIn('class="grid"', page)
            self.assertIn('data-case="c" data-host="codex" data-arm="with" data-passed="1" data-runs="1"', page)
            self.assertIn('class="why" data-case="c"', page)
            self.assertIn('id="seconds"', page)
            self.assertIn('<td>1</td><td>2</td>', page)
            self.assertIn('<li>one</li>', page)
            self.assertNotIn('not this', page)
            self.assertIn('nothing about y', page)

    def test_missing_notes_section_is_left_out(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.suite(root)
            self.assertEqual(markdown_section(root / 'absent.md', 'x'), [])
            build(root, None, None)
            self.assertNotIn('Reading the campaign', (root / 'overview.html').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
