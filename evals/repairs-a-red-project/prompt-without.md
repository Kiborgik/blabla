---
max_turns: 120
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Bash, Write, Edit, Skill]
expected_outcome: The model module no longer imports the store and the store gains a save method, with both Python sources still parsing.
---

You carry ONE bounded task in this project.

Task `repair-structure`: the structure checks of this project fail. Find what is wrong in the `widget` package and repair it in the Python sources without changing declared intent.
Write only inside: `widget`. Deliverables: `widget/model.py`, `widget/store.py`. Declared check: `python3 -m compileall -q widget`.

Run only that check, and read the whole run: exit code, every failure block, then the summary. Report what you changed, the check you ran and its exit code. Do not run anything wider than the check. Do not spawn other agents.
