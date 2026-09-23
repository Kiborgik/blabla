---
max_turns: 120
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Bash, Write, Edit, Skill]
expected_outcome: The worker repairs both Python sources inside the widget package without touching anything else.
---

You carry ONE bounded task in this project.

Task `fix-red-checks`: repair the two failing structure rules without changing declared intent.
Write only inside: `widget`. Deliverables: `widget/store.py`, `widget/model.py`. Declared check: `python3 -m compileall -q widget`.

Run only that check, and read the whole run: exit code, every failure block, then the summary. Report what you changed, the check you ran and its exit code. Do not run anything wider than the check. Do not spawn other agents.
