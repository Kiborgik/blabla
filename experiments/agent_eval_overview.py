import argparse
import html
import json
from pathlib import Path
import re


CHART_JS = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'
FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap'

STYLE = """
:root{--paper:#f4f4f1;--panel:#ffffff;--ink:#16191d;--muted:#5f6871;--line:#d8dbd6;--with:#0f766e;--without:#a39e98;
--up:#15803d;--down:#b45309;--unknown:#e6e8e4;--accent:#0f766e;--tile:#e9eae5;--good:#dcfce7;--bad:#fde8d2;--mid:#f3f4f6}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--paper:#131517;--panel:#1b1e22;--ink:#e8e9e6;--muted:#9aa2a9;--line:#31363c;
--with:#2dd4bf;--without:#6e6862;--up:#4ade80;--down:#f0a35c;--unknown:#2a2f35;--accent:#2dd4bf;--tile:#22262b;--good:#14532d;--bad:#5a3410;--mid:#2a2f35}}
:root[data-theme="dark"]{--paper:#131517;--panel:#1b1e22;--ink:#e8e9e6;--muted:#9aa2a9;--line:#31363c;
--with:#2dd4bf;--without:#6e6862;--up:#4ade80;--down:#f0a35c;--unknown:#2a2f35;--accent:#2dd4bf;--tile:#22262b;--good:#14532d;--bad:#5a3410;--mid:#2a2f35}
body{background:var(--paper);color:var(--ink);font:16px/1.55 "IBM Plex Sans",system-ui,sans-serif;margin:0;padding-block:0 4rem;padding-inline:clamp(16px,4vw,48px)}
main{max-width:1100px;margin:0 auto}
h1,h2,h3,h4{font-family:Fraunces,Georgia,serif;font-weight:600;text-wrap:balance;line-height:1.15;margin:0}
h1{font-size:clamp(2rem,4.2vw,3.2rem);margin-top:2rem;max-width:22ch}
h2{font-size:1.7rem;margin-top:3.5rem;padding-top:1.25rem;border-top:1px solid var(--line)}
h3{font-size:1.2rem;margin-top:1.75rem}
h4{font-size:1rem;margin:0;font-family:"IBM Plex Sans",system-ui,sans-serif;font-weight:600}
p{max-width:68ch}
.lede{font-size:1.15rem;color:var(--muted);max-width:68ch;margin-top:.75rem}
.eyebrow{font:500 .75rem/1 "IBM Plex Mono",monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-top:2.5rem}
.verdicts{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;margin-top:2rem}
.verdict{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:20px 22px}
.verdict header{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap}
.verdict .runs{font-size:.85rem;color:var(--muted)}
.big{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:12px;margin-top:14px}
.big b{display:block;font:500 2.6rem/1 "IBM Plex Mono",monospace;font-variant-numeric:tabular-nums}
.big span{display:block;font-size:.8rem;color:var(--muted);margin-top:.4rem}
.big .with b{color:var(--with)}
.big .arrow{font:500 1.2rem/1 "IBM Plex Mono",monospace;padding-bottom:1.6rem;color:var(--muted)}
.arrow.up{color:var(--up)}.arrow.down{color:var(--down)}
.measures{margin-top:16px;border-top:1px solid var(--line)}
.measures div{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:8px;padding:.45rem 0;border-bottom:1px solid var(--line);font-size:.9rem;font-variant-numeric:tabular-nums}
.measures div span:first-child{color:var(--muted)}
.measures div span:not(:first-child){text-align:right;font-family:"IBM Plex Mono",monospace}
.measures .head span{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-family:"IBM Plex Sans",system-ui,sans-serif}
.measures .better{color:var(--up);font-weight:600}
.only{margin-top:22px;padding-top:14px;border-top:2px solid var(--line)}
.only h4{margin:0;font:600 .95rem/1.3 "IBM Plex Sans",system-ui,sans-serif}
.only p{margin:.35rem 0 0;font-size:.85rem;color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:1.5rem}
.tile{background:var(--tile);padding:14px 16px;border-radius:6px}
.tile b{display:block;font:500 2rem/1.1 "IBM Plex Mono",monospace;font-variant-numeric:tabular-nums}
.tile span{display:block;font-size:.85rem;color:var(--muted);margin-top:.35rem}
.chart{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:16px;margin-top:1rem}
.chart canvas{max-width:100%}
.legend{display:flex;flex-wrap:wrap;gap:1rem;font-size:.85rem;color:var(--muted);margin-top:.5rem}
.legend i{display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:-1px;margin-right:6px}
.note{font-size:.9rem;color:var(--muted);max-width:68ch;margin-top:.5rem}
table{border-collapse:collapse;width:100%;font-size:.92rem;font-variant-numeric:tabular-nums;margin-top:1rem}
th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:.78rem;letter-spacing:.04em;text-transform:uppercase}
td.num,th.num{text-align:right}
.grid td.cell{text-align:center;font-family:"IBM Plex Mono",monospace;font-size:.85rem;border-left:1px solid var(--paper);border-right:1px solid var(--paper);min-width:92px}
.grid td.cell small{display:block;font-size:.72rem;color:var(--muted);font-family:"IBM Plex Sans",system-ui,sans-serif}
.grid td.case{font-weight:500}
.scroll{overflow-x:auto}
th.mark,td.mark{text-align:center;min-width:64px}
td.mark{font:600 1rem/1 "IBM Plex Mono",monospace}
td.mark.pass{color:var(--up)}td.mark.fail{color:var(--down)}td.mark.unknown{color:var(--ink)}td.mark.not_applicable{color:var(--muted)}
td.check small{display:block;margin-top:.15rem;color:var(--muted);font:400 .75rem/1.3 "IBM Plex Mono",monospace}
td.nowrap,th.nowrap{white-space:nowrap}
h2 small.host{font:500 .8rem/1 "IBM Plex Mono",monospace;color:var(--muted);letter-spacing:.06em;margin-left:.5rem}
.why{padding-left:1.2rem;max-width:80ch}
.why li{margin:.4rem 0}
.why li.none{list-style:none;color:var(--muted)}
.prose{max-width:72ch}
.prose ul{padding-left:1.2rem}
.prose li{margin:.35rem 0}
.prose code,code{font-family:"IBM Plex Mono",monospace;font-size:.9em;background:var(--tile);padding:.05em .3em;border-radius:3px}
a{color:var(--accent)}
details{margin-top:1rem}
summary{cursor:pointer;color:var(--accent);font-weight:500}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);font-size:.85rem;color:var(--muted)}
@media (max-width:520px){.big{grid-template-columns:1fr}.big .arrow{padding:0}}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
"""


def esc(value):
    return html.escape(str(value), quote=True)


def html_page(title, parts):
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{esc(title)}</title><link rel="stylesheet" href="{FONTS}"><style>{STYLE}</style></head><body><main>'
            + '\n'.join(parts) + '</main></body></html>')


ARMS = ('with', 'without')
MARKS = {'pass': '✓', 'fail': '✗', 'unknown': '?', 'not_applicable': '–'}
ENDING_TEXT = {'finished': 'finished',
               'turn limit': "stopped at the host's turn limit; graded on what it left behind",
               'incomplete': 'did not finish; every check it faces is unknown',
               'harness failed': 'the harness failed before the agent finished; every check it faces is unknown'}


def run_ending(run):
    if run.get('execution') == 'harness-failed':
        return 'harness failed'
    if not run.get('valid'):
        return 'incomplete'
    return 'turn limit' if run.get('terminal') == 'error_max_turns' else 'finished'


def case_groups(runs):
    groups = {}
    for run in runs:
        groups.setdefault((run['case'], run['host']), []).append(run)
    for members in groups.values():
        members.sort(key=lambda run: (ARMS.index(run['arm']), str(run['run'])))
    return groups


def run_labels(runs):
    counts = {}
    labels = []
    for run in runs:
        counts[run['arm']] = counts.get(run['arm'], 0) + 1
        labels.append(f'{run["arm"]} {counts[run["arm"]]}')
    return labels


def check_label(criterion):
    return f'{criterion.get("description", criterion["id"])} ({criterion["id"]})'


def diagnostic_lines(run):
    lines = []
    for diagnostic in run.get('diagnostics', []):
        message = str(diagnostic.get('message', diagnostic) if isinstance(diagnostic, dict) else diagnostic).strip().rstrip(':').strip()
        if message and not (run.get('terminal') == 'error_max_turns' and message.startswith('max_turns')):
            lines.append(message)
    return lines


def problems(run):
    ending = run_ending(run)
    found = [] if ending == 'finished' else [f'The run {ENDING_TEXT[ending]}.']
    found.extend(f'Host diagnostic: {message}' for message in diagnostic_lines(run))
    if not run.get('valid'):
        return found
    for criterion in run.get('criteria', []):
        if criterion['status'] not in ('fail', 'unknown'):
            continue
        reason = criterion.get('reason', '')
        evidence = [item for item in criterion.get('evidence', []) if item and item not in reason]
        text = f'{MARKS[criterion["status"]]} {check_label(criterion)}: {reason}'
        if evidence:
            text += '; see ' + ', '.join(f'`{item}`' for item in evidence)
        found.append(text + ('' if criterion.get('scored', True) else ' (not scored)'))
    return found


def inline(text):
    text = esc(text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    return text


def markdown_section(path, heading):
    if not path or not Path(path).exists():
        return []
    lines = Path(path).read_text(encoding='utf-8').splitlines()
    start = next((index for index, line in enumerate(lines) if line.startswith('## ') and heading in line), None)
    if start is None:
        return []
    body = []
    for line in lines[start + 1:]:
        if line.startswith('## '):
            break
        body.append(line)
    return render_markdown(body)


def render_markdown(lines):
    out = []
    paragraph = []
    table = []
    bullets = []

    def flush():
        nonlocal paragraph, table, bullets
        if paragraph:
            out.append('<p>' + inline(' '.join(paragraph)) + '</p>')
            paragraph = []
        if table:
            rows = [row for row in table if not re.match(r'^\|\s*-', row)]
            cells = [[cell.strip() for cell in row.strip().strip('|').split('|')] for row in rows]
            if cells:
                out.append('<div class="scroll"><table><tr>' + ''.join(f'<th>{inline(c)}</th>' for c in cells[0]) + '</tr>'
                           + ''.join('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in row) + '</tr>' for row in cells[1:]) + '</table></div>')
            table = []
        if bullets:
            out.append('<ul>' + ''.join(f'<li>{inline(item)}</li>' for item in bullets) + '</ul>')
            bullets = []

    for line in lines:
        if line.startswith('### '):
            flush()
            out.append(f'<h3>{inline(line[4:])}</h3>')
        elif line.startswith('|'):
            if paragraph or bullets:
                flush()
            table.append(line)
        elif line.startswith('- '):
            if paragraph or table:
                flush()
            bullets.append(line[2:])
        elif line.startswith('  ') and bullets:
            bullets[-1] += ' ' + line.strip()
        elif line.strip() == '':
            flush()
        else:
            if table or bullets:
                flush()
            paragraph.append(line.strip())
    flush()
    return out


def load(out_dir):
    out_dir = Path(out_dir)
    grades = json.loads((out_dir / 'grades.json').read_text(encoding='utf-8'))
    scorecard = json.loads((out_dir / 'scorecard.json').read_text(encoding='utf-8'))
    manifest_path = out_dir / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
    return grades, scorecard, manifest


def headline(grades):
    runs = grades['runs']
    hosts = sorted({run['host'] for run in runs})
    facts = {'runs': len(runs), 'complete': sum(1 for run in runs if run.get('valid')),
             'capped': sum(1 for run in runs if not run.get('valid') and any('output token' in d.get('message', '') for d in run.get('diagnostics', []))),
             'cut': sum(1 for run in runs if run.get('terminal') == 'error_max_turns'),
             'hosts': hosts, 'cases': len({run['case'] for run in runs}),
             'passes': {f'{host}/{arm}': sum(1 for run in runs if run['host'] == host and run['arm'] == arm and run.get('passed'))
                        for host in hosts for arm in ('with', 'without')}}
    return facts


def median(values):
    values = sorted(value for value in values if value is not None)
    if not values:
        return None
    middle = len(values) // 2
    return values[middle] if len(values) % 2 else (values[middle - 1] + values[middle]) / 2


MEASURES = (('seconds', 'Wall time per run', 's', True), ('turns', 'Turns per run', '', True),
            ('total_actions', 'Tool actions per run', '', True),
            ('actions_to_done', 'Actions until done: the check passed after the last source edit', '', True),
            ('actions_after_done', 'Actions after done', '', True),
            ('prompt_tokens', 'New prompt tokens per run, computed by the GPU', '', True),
            ('cached_tokens', 'Cached prompt tokens per run, re-sent context served from cache', '', True),
            ('output_tokens', 'Output tokens per run', '', True))


def points(selected, shared=None):
    earned = available = unknown = 0
    for run in selected:
        for criterion in run.get('criteria', []):
            if not criterion.get('scored', True) or criterion['status'] == 'not_applicable':
                continue
            if shared is not None and criterion.get('comparable', False) != shared:
                continue
            weight = criterion.get('weight', 1)
            available += weight
            status = criterion['status'] if run.get('valid', True) else 'unknown'
            if status == 'pass':
                earned += weight
            elif status == 'unknown':
                unknown += weight
    return {'earned': earned, 'available': available, 'unknown': unknown,
            'percent': round(100 * earned / available) if available else None,
            'unknown_percent': round(100 * unknown / available) if available else None}


def passed_shared(run):
    if not run.get('valid'):
        return False
    shared = [criterion for criterion in run.get('criteria', [])
              if criterion.get('scored', True) and criterion['status'] != 'not_applicable' and criterion.get('comparable', False)]
    return bool(shared) and all(criterion['status'] == 'pass' for criterion in shared)


def arm_summary(selected):
    complete = [run for run in selected if run.get('valid')]
    commands = [run.get('measures', {}).get('blabla_invocations') or 0 for run in complete]
    return {'runs': len(selected), 'complete': len(complete), 'cases': sorted({run['case'] for run in selected}),
            'passed': sum(1 for run in selected if run.get('passed')),
            'passed_shared': sum(1 for run in selected if passed_shared(run)),
            'outcome': points(selected, True), 'workflow': points(selected, False), 'all': points(selected),
            'used_blabla': sum(1 for value in commands if value > 0),
            'mean_commands': round(sum(commands) / len(commands), 1) if commands else None,
            'measures': {key: median(run.get('measures', {}).get(key) for run in complete) for key, _, _, _ in MEASURES}}


def verdicts(grades):
    runs = grades['runs']
    result = {}
    for host in sorted({run['host'] for run in runs}):
        host_runs = [run for run in runs if run['host'] == host]
        paired = ({run['case'] for run in host_runs if run['arm'] == 'with'}
                  & {run['case'] for run in host_runs if run['arm'] == 'without'})
        result[host] = {
            arm: arm_summary([run for run in host_runs if run['arm'] == arm and run['case'] in paired])
            for arm in ('with', 'without')}
        result[host]['only'] = arm_summary([run for run in host_runs if run['arm'] == 'with' and run['case'] not in paired])
    return result


def native_reports(out_dir, manifest):
    rows = []
    for entry in manifest.get('campaigns', []):
        if entry.get('host') != 'claude' or not entry.get('path'):
            continue
        campaign = Path(out_dir).parent / Path(entry['path']).name
        for aggregate in sorted(campaign.glob('*/run-*/native-report/aggregate-result.json')):
            arm = aggregate.parts[-4]
            run = aggregate.parts[-3]
            document = json.loads(aggregate.read_text(encoding='utf-8'))
            for case in document.get('cases', []):
                for attempt in [attempt for attempts in case.get('arms', {}).values() for attempt in attempts]:
                    rows.append({'case': case['name'], 'arm': arm, 'run': run, 'score': attempt.get('score'),
                                 'passed': attempt.get('passed'), 'turns': attempt.get('turns'),
                                 'seconds': attempt.get('durationSeconds'), 'error': attempt.get('error'),
                                 'report': f'../{campaign.name}/{arm}/{run}/native-report/report.html'})
    return rows


def capability_bars(scorecard):
    rows = {}
    for row in scorecard['capabilities']['rows']:
        rows[(row['id'], row['host'], row['arm'])] = row
    bars = []
    for delta in scorecard['capabilities']['deltas']:
        if not delta['comparable']:
            continue
        with_row = rows.get((delta['id'], delta['host'], 'with'))
        available = delta.get('available') or 0
        if not available or with_row is None:
            continue
        bars.append({'label': with_row['title'], 'host': delta['host'],
                     'low': round(100 * delta['lower'] / available, 1), 'high': round(100 * delta['upper'] / available, 1),
                     'available': available})
    return bars


def case_bars(grades):
    return [{'case': group['case'], 'host': group['host'], 'arm': group['arm'], 'mean': group['mean_score'],
             'shared': group.get('comparable_score'), 'blabla_only': group.get('blabla_only_score'),
             'passed': group['passed'], 'runs': group['runs'], 'complete': group['complete']}
            for group in grades['aggregates']]


def native_ending(error):
    if not error:
        return 'finished'
    text = str(error)
    if 'maximum number of turns' in text:
        return 'turn limit'
    first = text.strip().splitlines()[0] if text.strip() else text
    return first if len(first) <= 80 else first[:79] + '…'


def share(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def grid_cell(row, paired):
    if row is None:
        return '<td class="cell" style="background:var(--mid)">–<small>no arm without BlaBla</small></td>'
    value = share(row['shared']) if paired else share(row['blabla_only']) if row['blabla_only'] is not None else share(row['mean'])
    notes = [f'{row["passed"]}/{row["runs"]} passed']
    if paired and row['arm'] == 'with' and share(row['blabla_only']) is not None:
        notes.append(f'BlaBla-only {share(row["blabla_only"]) * 100:.0f}%')
    if row['complete'] < row['runs']:
        notes.append(f'{row["runs"] - row["complete"]} incomplete')
    attributes = f'data-case="{esc(row["case"])}" data-host="{esc(row["host"])}" data-arm="{row["arm"]}" data-passed="{row["passed"]}" data-runs="{row["runs"]}"'
    if value is None:
        return f'<td class="cell" {attributes} style="background:var(--mid)">unknown<small>{esc(", ".join(notes))}</small></td>'
    shade = f'color-mix(in srgb, var(--good) {int(value * 100)}%, var(--bad))'
    return f'<td class="cell" {attributes} style="background:{shade}">{value * 100:.0f}%<small>{esc(", ".join(notes))}</small></td>'


def trouble_sections(grades):
    parts = []
    for (case, host), runs in case_groups(grades['runs']).items():
        notes = [(label, text) for label, run in zip(run_labels(runs), runs) for text in problems(run)]
        parts.append(f'<h3>{esc(case)} <small class="host">{esc(host)}</small></h3><ul class="why" data-case="{esc(case)}">')
        if notes:
            parts.extend(f'<li><b>{esc(label)}</b>: {inline(text)}</li>' for label, text in notes)
        else:
            parts.append('<li class="none">Every run passed every check it faced.</li>')
        parts.append('</ul>')
    return parts


def efficiency_bars(grades):
    return [{'case': row['case'], 'host': row['host'], 'arm': row['arm'],
             'seconds': row['seconds']['median'] if row.get('seconds') else None,
             'calls': row['blabla_invocations']['median'] if row.get('blabla_invocations') else None}
            for row in grades.get('efficiency', [])]


SCRIPT = """
const data = DATA;
const css = getComputedStyle(document.documentElement);
const token = name => css.getPropertyValue(name).trim();
Chart.defaults.color = token('--muted');
Chart.defaults.borderColor = token('--line');
Chart.defaults.font.family = '"IBM Plex Sans", system-ui, sans-serif';
const hosts = data.headline.hosts;
const short = label => label.length > 46 ? label.slice(0, 44) + '…' : label;

function differenceChart(host, element) {
  const bars = data.capabilities.filter(bar => bar.host === host).sort((a, b) => (b.low + b.high) - (a.low + a.high));
  const certain = bar => bar.low > 0 ? [0, bar.low] : bar.high < 0 ? [bar.high, 0] : null;
  const tone = bar => bar.low > 0 ? token('--up') : bar.high < 0 ? token('--down') : token('--muted');
  new Chart(element, {
    type: 'bar',
    data: {labels: bars.map(bar => short(bar.label)),
      datasets: [
        {label: 'possible', data: bars.map(bar => [bar.low, bar.high]), grouped: false,
          backgroundColor: token('--unknown'), borderColor: bars.map(tone), borderWidth: 1, borderSkipped: false, barPercentage: 0.7},
        {label: 'certain', data: bars.map(certain), grouped: false,
          backgroundColor: bars.map(tone), borderWidth: 0, borderSkipped: false, barPercentage: 0.7}]},
    options: {indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {legend: {display: false}, tooltip: {filter: item => item.datasetIndex === 0, callbacks: {label: item => {
        const bar = bars[item.dataIndex];
        return bar.low === bar.high ? `${bar.low}% of ${bar.available} points, every run complete` : `${bar.low}% to ${bar.high}% of ${bar.available} points`;}}}},
      scales: {x: {min: -100, max: 100, ticks: {callback: value => value + '%'}, grid: {color: token('--line')}},
        y: {ticks: {autoSkip: false, font: {size: 11}}, grid: {display: false}}}}});
  element.parentElement.style.height = (bars.length * 22 + 60) + 'px';
}

function secondsChart(element) {
  const rows = data.efficiency;
  const cases = [...new Set(rows.map(row => row.case))];
  const datasets = [];
  for (const host of hosts) for (const arm of ['with', 'without']) {
    datasets.push({label: `${host}, ${arm} BlaBla`, data: cases.map(name => {
      const row = rows.find(r => r.case === name && r.host === host && r.arm === arm);
      return row && row.seconds !== null ? Math.round(row.seconds) : null;}),
      backgroundColor: arm === 'with' ? token('--with') : token('--without'),
      borderColor: host === hosts[0] ? 'transparent' : token('--ink'), borderWidth: host === hosts[0] ? 0 : 1});
  }
  new Chart(element, {type: 'bar', data: {labels: cases, datasets},
    options: {indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {legend: {position: 'top'}},
      scales: {x: {beginAtZero: true, title: {display: true, text: 'median seconds per run'}, grid: {color: token('--line')}},
        y: {ticks: {autoSkip: false, font: {size: 11}}, grid: {display: false}}}}});
  element.parentElement.style.height = (cases.length * 34 + 90) + 'px';
}

document.fonts.ready.then(() => {
  for (const host of hosts) {
    const diff = document.getElementById('diff-' + host);
    if (diff) differenceChart(host, diff);
  }
  const seconds = document.getElementById('seconds');
  if (seconds) secondsChart(seconds);
});
"""


def build(out_dir, notes=None, section=None):
    grades, scorecard, manifest = load(out_dir)
    facts = headline(grades)
    payload = {'headline': facts, 'capabilities': capability_bars(scorecard), 'cases': case_bars(grades),
               'efficiency': efficiency_bars(grades)}
    models = manifest.get('models', {})
    model_names = sorted(set(models.values()))
    stamp = manifest.get('started_utc', Path(out_dir).name)
    title = 'BlaBla campaign ' + stamp[:8] if stamp[:8].isdigit() else 'BlaBla campaign'
    verdict = verdicts(grades)
    parts = [f'<title>{esc(title)}</title>', f'<link rel="stylesheet" href="{FONTS}">', f'<style>{STYLE}</style>', '<main>']
    parts.append('<p class="eyebrow">BlaBla agent integration campaign</p>')
    parts.append('<h1>Does BlaBla help a small local model do the job?</h1>')
    paired_cases = sorted({case for host in verdict.values() for case in host['with']['cases']})
    only_cases = sorted({case for host in verdict.values() for case in host['only']['cases']})
    parts.append(f'<p class="lede">{facts["runs"]} runs across {facts["cases"]} cases on {len(facts["hosts"])} coding-agent host{"s" if len(facts["hosts"]) != 1 else ""}. '
                 f'{len(paired_cases)} cases were run both ways: with BlaBla, the agent gets the project manifest, the contracts, the task record, the onboarding block, the skill and the CLI; '
                 'without BlaBla it gets none of that: the same job in plain language, over the same sources and the same rules document. '
                 + (f'{len(only_cases)} more exist only with BlaBla and are reported on their own. ' if only_cases else '') +
                 'The card compares the two arms on the cases run both ways, on the checks both arms face, and shows what each arm cost.</p>')
    if model_names:
        parts.append('<p class="note">Subjects: ' + ', '.join(f'<code>{esc(m)}</code>' for m in model_names) + '. '
                     f'{facts["complete"]} of {facts["runs"]} runs graded. '
                     f'Stopped at the host\'s turn limit and graded on what they left behind: {facts["cut"]}. '
                     f'Ended at a host output or context limit and counted as unknown, never as a pass: {facts["capped"]}.</p>')

    parts.append('<div class="verdicts">')
    for host in facts['hosts']:
        arms = verdict[host]
        with_arm, without_arm = arms['with'], arms['without']
        with_points, without_points = with_arm['outcome'], without_arm['outcome']
        gain = (with_points['percent'] or 0) - (without_points['percent'] or 0)
        arrow = 'up' if gain > 0 else 'down' if gain < 0 else ''
        sign = '+' if gain > 0 else ''
        only = arms['only']
        parts.append(f'<section class="verdict"><header><h3>{esc(host)}</h3><span class="runs">{len(with_arm["cases"])} cases run both ways, '
                     f'{with_arm["runs"] + without_arm["runs"]} runs, {with_arm["complete"] + without_arm["complete"]} completed</span></header>')
        parts.append('<div class="big">'
                     f'<div class="with"><b>{with_points["percent"] if with_points["percent"] is not None else "–"}%</b><span>of the job right, with BlaBla'
                     + (f' ({with_points["unknown_percent"]}% unknown)' if with_points['unknown_percent'] else '') + '</span></div>'
                     f'<div class="arrow {arrow}">{sign}{gain}</div>'
                     f'<div><b>{without_points["percent"] if without_points["percent"] is not None else "–"}%</b><span>without BlaBla'
                     + (f' ({without_points["unknown_percent"]}% unknown)' if without_points['unknown_percent'] else '') + '</span></div></div>')
        parts.append('<div class="measures"><div class="head"><span></span><span>with BlaBla</span><span>without</span></div>')
        parts.append(f'<div><span>Runs that got every shared check right</span><span{" class=better" if with_arm["passed_shared"] > without_arm["passed_shared"] else ""}>{with_arm["passed_shared"]} of {with_arm["runs"]}</span>'
                     f'<span{" class=better" if without_arm["passed_shared"] > with_arm["passed_shared"] else ""}>{without_arm["passed_shared"]} of {without_arm["runs"]}</span></div>')
        parts.append(f'<div><span>Runs completed</span><span>{with_arm["complete"]} of {with_arm["runs"]}</span><span>{without_arm["complete"]} of {without_arm["runs"]}</span></div>')
        for key, label, unit, lower_is_better in MEASURES:
            left, right = with_arm['measures'].get(key), without_arm['measures'].get(key)
            def cell(value, other):
                if value is None:
                    return '<span>–</span>'
                better = lower_is_better is not None and other is not None and (value < other if lower_is_better else value > other)
                return f'<span{" class=better" if better else ""}>{value:,.0f}{unit}</span>'
            parts.append(f'<div><span>{esc(label)}</span>{cell(left, right)}{cell(right, left)}</div>')
        workflow = with_arm['workflow']
        if workflow['available']:
            parts.append(f'<div><span>BlaBla workflow points, scored with BlaBla only</span><span>{workflow["percent"] if workflow["percent"] is not None else "–"}%'
                         + (f' ({workflow["unknown_percent"]}% unknown)' if workflow['unknown_percent'] else '') + '</span><span>–</span></div>')
            parts.append(f'<div><span>Runs that also got every workflow check right</span><span>{with_arm["passed"]} of {with_arm["runs"]}</span><span>–</span></div>')
        parts.append(f'<div><span>Runs that used BlaBla at least once</span><span>{with_arm["used_blabla"]} of {with_arm["complete"]}</span><span>–</span></div>')
        if with_arm['mean_commands'] is not None:
            parts.append(f'<div><span>BlaBla commands, mean per run</span><span>{with_arm["mean_commands"]}</span><span>–</span></div>')
        parts.append('</div>')
        if only['runs']:
            only_points = only['all']
            parts.append(f'<div class="only"><h4>Only possible with BlaBla</h4><p>{len(only["cases"])} cases with no plain-language equivalent: '
                         + ', '.join(esc(case) for case in only['cases']) + '.</p>')
            parts.append('<div class="measures"><div class="head"><span></span><span>with BlaBla</span><span></span></div>')
            parts.append(f'<div><span>Of the job right</span><span>{only_points["percent"] if only_points["percent"] is not None else "–"}%'
                         + (f' ({only_points["unknown_percent"]}% unknown)' if only_points['unknown_percent'] else '') + '</span><span></span></div>')
            parts.append(f'<div><span>Runs that passed every applicable check</span><span>{only["passed"]} of {only["runs"]}</span><span></span></div>')
            parts.append(f'<div><span>Runs completed</span><span>{only["complete"]} of {only["runs"]}</span><span></span></div>')
            parts.append(f'<div><span>Runs that used BlaBla at least once</span><span>{only["used_blabla"]} of {only["complete"]}</span><span></span></div>')
            if only['mean_commands'] is not None:
                parts.append(f'<div><span>BlaBla commands, mean per run</span><span>{only["mean_commands"]}</span><span></span></div>')
            parts.append('</div></div>')
        parts.append('</section>')
    parts.append('</div>')
    parts.append('<p class="note">"Of the job right" is the share of points earned on the checks both arms face in each case, counted the same way in both arms: '
                 'the sources parse, the right symbols exist, the store persists, protected files stay untouched, the write scope holds. '
                 'A check only one arm faces, such as leaving the contracts untouched, never enters it. It counts an incomplete run as earning nothing. '
                 'The BlaBla workflow points, acceptance, evidence, challenge, hand-back, are scored on the BlaBla side only and never enter the comparison. '
                 'Medians are over completed runs. Green marks the arm that did better on that line; fewer tokens, actions and seconds count as better.</p>')

    parts.append('<h2>Case by case</h2>')
    parts.append('<p>Each cell is the share of points on the checks both arms face in that case, so the two columns compare like with like; '
                 'a case that exists only with BlaBla shows its whole score instead. Under it: runs that passed every required check they faced, '
                 'and for the arm with BlaBla its share on the checks only that arm faces. Darker green is better; grey has no complete score.</p>')
    cases = list(dict.fromkeys(row['case'] for row in payload['cases']))
    lookup = {(row['case'], row['host'], row['arm']): row for row in payload['cases']}
    parts.append('<div class="scroll"><table class="grid"><tr><th>Case</th>' + ''.join(f'<th class="num">{esc(host)}<br>{arm} BlaBla</th>' for host in facts['hosts'] for arm in ('with', 'without')) + '</tr>')
    for case in cases:
        parts.append(f'<tr><td class="case">{esc(case)}</td>')
        for host in facts['hosts']:
            paired = all((case, host, arm) in lookup for arm in ARMS)
            parts.extend(grid_cell(lookup.get((case, host, arm)), paired) for arm in ARMS)
        parts.append('</tr>')
    parts.append('</table></div>')
    parts.append('<h2>What each run got wrong</h2>')
    parts.append('<p>Every check a run failed or could not settle, with the grader\'s reason and the evidence it read. '
                 'The full check-by-run matrix for every case is in report.html.</p>')
    parts.extend(trouble_sections(grades))

    parts.append('<h2>Where BlaBla helped, and where it got in the way</h2>')
    parts.append('<p>One bar per capability that both arms can face: points with BlaBla minus points without, as a share of the points available. '
                 'Capabilities that need BlaBla, the record, the challenge, the gate, are not comparable and do not appear. '
                 'Solid bars are settled by complete runs; the pale part is the span the incomplete runs leave open. Bars entirely right of zero are gains; entirely left, losses.</p>')
    parts.append('<div class="legend"><span><i style="background:var(--up)"></i>gain</span><span><i style="background:var(--down)"></i>loss</span><span><i style="background:var(--unknown);border:1px solid var(--muted)"></i>open span from incomplete runs</span></div>')
    for host in facts['hosts']:
        parts.append(f'<h3>{esc(host)}</h3><div class="chart"><canvas id="diff-{esc(host)}"></canvas></div>')

    parts.append('<h2>What each case cost</h2>')
    parts.append('<p>Median wall time per run by case, host and arm. Time and tokens never enter a score; they show what BlaBla costs or saves on the same job.</p>')
    parts.append('<div class="chart"><canvas id="seconds"></canvas></div>')

    prose = markdown_section(notes, section) if notes and section else []
    if prose:
        parts.append('<h2>Reading the campaign</h2><div class="prose">' + '\n'.join(prose) + '</div>')

    native = native_reports(out_dir, manifest)
    if native:
        parts.append('<h2>Claude Code\'s own evaluator</h2>')
        parts.append('<p>The with-BlaBla runs on Claude Code went through <code>claude plugin eval</code> with BlaBla loaded as a plugin, and the without-BlaBla runs through the same evaluator with nothing of BlaBla in the workspace. '
                     'Its graders are projections of the shared rubric, the file and command checks only, so its score is a subset of the one above. Each link opens the evaluator\'s own report for that run.</p>')
        parts.append('<div class="scroll"><table><tr><th>Case</th><th>Arm</th><th>Run</th><th class="num">Native score</th><th>Native pass</th><th class="num">Turns</th><th class="num">Seconds</th><th>Ended</th><th>Report</th></tr>')
        for row in native:
            score = '–' if row['score'] is None else f'{row["score"]:.2f}'
            ended = esc(native_ending(row['error']))
            parts.append(f'<tr><td>{esc(row["case"])}</td><td>{esc(row["arm"])}</td><td class="nowrap">{esc(row["run"])}</td><td class="num">{score}</td><td>{"yes" if row["passed"] else "no"}</td>'
                         f'<td class="num">{row["turns"] if row["turns"] is not None else "–"}</td><td class="num">{row["seconds"] if row["seconds"] is not None else "–"}</td><td>{ended}</td>'
                         f'<td><a href="{esc(row["report"])}">open</a></td></tr>')
        parts.append('</table></div>')

    missing = scorecard.get('missing', {})
    entries = list(dict.fromkeys(missing.get('capabilities', []) + missing.get('behaviors', [])))
    if entries:
        parts.append('<details><summary>What this campaign does not measure</summary><ul class="prose">' + ''.join(f'<li>{esc(entry)}</li>' for entry in entries) + '</ul></details>')

    details = []
    for name, info in manifest.get('model_details', {}).items():
        digest = info.get('model_info', {}).get('digest', '')[:12]
        details.append(f'{esc(name)} {esc(digest)}')
    frozen = manifest.get('frozen_inputs', {}).get('blabla_sha256', '')[:12]
    parts.append('<footer>' + ' · '.join(filter(None, [esc(Path(out_dir).name), 'models ' + ', '.join(details) if details else '', f'BlaBla build {esc(frozen)}' if frozen else '',
                 'per-run evidence in report.html and scorecard.html'])) + '</footer>')
    parts.append('</main>')
    parts.append(f'<script src="{CHART_JS}"></script>')
    parts.append('<script>' + SCRIPT.replace('DATA', json.dumps(payload)) + '</script>')
    page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + '\n'.join(parts) + '</body></html>'
    (Path(out_dir) / 'overview.html').write_text(page, encoding='utf-8')
    return payload


def main():
    parser = argparse.ArgumentParser(description='Render a readable overview page for a graded suite or campaign')
    parser.add_argument('out_dir', type=Path)
    parser.add_argument('--notes', type=Path, help='a Markdown file whose section is embedded as prose')
    parser.add_argument('--section', help='the heading text that selects the section of --notes')
    arguments = parser.parse_args()
    build(arguments.out_dir, arguments.notes, arguments.section)
    print(f'overview: {arguments.out_dir / "overview.html"}')


if __name__ == '__main__':
    main()
