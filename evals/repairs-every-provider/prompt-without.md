---
max_turns: 120
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Bash, Write, Edit, Skill]
expected_outcome: In every language the model no longer imports the store and the store gains its save operation.
---

You carry ONE bounded task in this project.

Task `repair-all-languages`: the structure of this project is broken in every language it contains. Repair the sources in each language so the structure holds.
Write only inside: `rust`, `typescript`, `go`, `widget`, `c`. Deliverables: `rust/src/store.rs`, `rust/src/model.rs`, `typescript/store.ts`, `typescript/model.ts`, `go/store/store.go`, `go/model/model.go`, `widget/store/WidgetStore.java`, `widget/model/Widget.java`, `c/store.c`, `c/model.c`. Declared check: parse or build each language's sources.

Run only that check, and read the whole run: exit code, every failure block, then the summary. Report what you changed, the check you ran and its exit code. Do not run anything wider than the check. Do not spawn other agents.
