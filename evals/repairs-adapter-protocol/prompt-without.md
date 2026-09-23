---
max_turns: 120
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Bash, Write, Edit, Skill]
expected_outcome: The application writes nothing but protocol responses to stdout, with the adapter module and the store unchanged.
---

You carry ONE bounded task in this project.

Task `fix-app-protocol`: running the application under its adapter stops with an application protocol error before any behavior is checked. Make the adapter protocol run correctly; the application, the adapter module and the store stay as they are.
Write only inside: `widget`, `widget.json`. Declared check: `python3 checks/restart.py`.

Run only that check, and read the whole run: exit code, every failure block, then the summary. Report what you changed, the check you ran and its exit code. Do not run anything wider than the check. Do not spawn other agents.
