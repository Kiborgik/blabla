---
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Bash, Write, Edit, Skill]
expected_outcome: WidgetStore gains a save method that preserves the list of Widget objects across a new process.
---

Implement `WidgetStore.save(widgets)` so a later process can load the same list of Widget objects through `load()`. Preserve the existing Widget and WidgetStore APIs.
