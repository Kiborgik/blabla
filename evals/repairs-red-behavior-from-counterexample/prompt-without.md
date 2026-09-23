---
max_turns: 120
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Bash, Write, Edit, Skill]
expected_outcome: Everything WidgetStore saves is read back by a fresh process, with the application and adapter unchanged.
---

You carry ONE bounded task in this project.

Task `fix-red-counterexample`: the last behavior check of the persistence path failed: after a restart the application did not hold exactly the widgets it held before. Find the fault inside the `widget` package, repair it, and check again until it holds. The application and the adapter stay as they are.
Write only inside: `widget`, `widget.json`. Declared check: `python3 checks/restart.py`.

Run only that check, and read the whole run: exit code, every failure block, then the summary. Report what you changed, the check you ran and its exit code. Do not run anything wider than the check. Do not spawn other agents.
