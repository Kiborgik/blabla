# BlaBla 0.11.0

Small coding models drift from the goal and say "done" too early. BlaBla catches that: a human or a strong model writes the intent once, as contracts, and cheap models do bounded work that BlaBla checks. Version 0.11 says this plainly, makes the docs about four times shorter, and fixes the frictions a dogfooding round with small worker models and independent reviewers ran into.

## Added

- `task show` and `task evidence --run` print the latest evidence and the lens assessments
- `task open --lens PACK` names the lenses a task must assess
- Every `blabla expert` subcommand describes itself in `--help`
- Gate steps that fail on a broken markdown link or anchor and on a version mismatch
- `task open --falsify PATH` and `task falsify NAME`: the check runs in a copy of the tree on the current files and on the files as they were at open, and hand-back waits until it passed on the first and failed on the second
- `task show` lists what a task changed, its falsify state and a review target's changes; `task finding` prints the new id; `status` splits a goal's unheld expectations into not held, unverified and unresolved
- `task statement NAME TEXT` amends a live task's statement; an option written after `--check-argv` or `--argv` is reported instead of silently joining the check

## Changed

- A task assigned to role `orchestrator` needs no `task confirm` for its own amendments; other roles are unchanged

- README, project rules, workflow, language, structure, project, expert and adapter docs are rewritten short, in plain English, with tables where people read them
- The native host schema is replaced by a short wire-contract section in `adapters/native/README.md`; the Rust types are the schema
- Test ownership moved into `CONTRIBUTING.md`
- The text printed after every `task` command is shorter
- Project memory states the drift and overconfidence problem; its prose is shorter and its existing identities are unchanged
- Systems own whole directories in project memory, so new files are never unowned
- New goals: `goal::short-plain-docs` and one per fix, each expecting the rule that checks it

## Fixed

- Recording or resolving findings no longer makes a review stale, and resolving a finding no longer voids the challenge receipt
- A path that becomes ignored while a task is open no longer counts as its change
- `challenge NAME` leads with what blocks the hand-back, and a BLOCKED task's route names its unresolved findings
- `task reconcile-withdrawal` accepts a successor whose write scope covers the path, as evidence already did

A review made before 0.11 on a target with findings goes stale once; accept, check and challenge it again. Windows CI failed the self-hosting `finish` once and passed it on the next run; the cause is not known yet.

No contract syntax or exit code changed; task JSON gains optional `lenses`, `falsify` and `falsifications` fields. History files are unchanged.

See the [full changelog](https://github.com/Kiborgik/blabla/blob/v0.11.0/CHANGELOG.md#0110-2026-10-11).
