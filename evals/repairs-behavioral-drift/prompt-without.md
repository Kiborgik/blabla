---
max_turns: 120
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Bash, Write, Edit, Skill]
expected_outcome: WidgetStore persists nonempty widgets across a real process restart while the application and adapter remain unchanged.
---

You carry ONE bounded task in this project.

Task `persist-widgets`: repair `widget/store.py` so the existing WidgetStore API persists widgets across a real process restart. The application and the adapter stay as they are.
Write only inside: `widget`, `widget.json`. Deliverables: `widget/store.py`. Declared check: `python3 checks/restart.py`.

Run only that check, and read the whole run: exit code, every failure block, then the summary. Report what you changed, the check you ran and its exit code. Do not run anything wider than the check. Do not spawn other agents.
