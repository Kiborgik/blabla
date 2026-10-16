# BlaBla 0.11.0

Small coding models drift from the goal and say "done" too early. BlaBla catches that: a human or a strong model writes the intent once, as contracts, and cheap models do bounded work that BlaBla checks. Version 0.11 adds the check that catches the most common false "done": `task falsify` runs a task's tests against the code as it was before the task, and the hand-back waits until they fail there and pass now. In BlaBla's own dogfooding it caught small-model tests that passed without the change they claimed to prove. The docs are about four times shorter and say the idea plainly, and the frictions two dogfooding rounds with small worker models and independent reviewers ran into are fixed. Falsify's benefit with local models is not measured yet.

## Added

- `task open --falsify PATH` and `task falsify NAME`: the check runs in a copy of the tree on the current files and on the files as they were at open, and hand-back waits until it passed on the first and failed on the second. It judges the whole check; the copy holds only the tree snapshot, so a check that needs an ignored directory or a file outside the project root reports that it cannot judge
- `task show` and `task evidence --run` print the latest evidence and the lens assessments
- `task open --lens PACK` names the lenses a task must assess
- Every `blabla expert` subcommand describes itself in `--help`
- Gate steps that fail on a broken markdown link or anchor and on a version mismatch
- `task show` lists what a task changed, its falsify state and a review target's changes; `task finding` prints the new id; `status` splits a goal's unheld expectations into not held, unverified and unresolved
- `task statement NAME TEXT` amends a live task's statement; an option written after `--check-argv` or `--argv` is reported instead of silently joining the check

## Changed

- A task assigned to role `orchestrator` needs no `task confirm` for its own amendments; other roles are unchanged

- README, project rules, workflow, language, structure, project, expert and adapter docs are rewritten short, in plain English, with tables where people read them
- The native host schema is replaced by a short wire-contract section in `adapters/native/README.md`; the Rust types are the schema
- Test ownership moved into `CONTRIBUTING.md`
- The text printed after every `task` command is shorter
- Tests run faster: BlaBla's own `finish` runs 4,096 actions instead of 16,384 (every obligation is covered by action 2,318), debug builds use `opt-level = 1`, the gate runs Rust tests in parallel through `cargo-nextest`, experiment-only tests are gone, and Windows CI runs tests in parallel
- Project memory states the drift and overconfidence problem; its prose is shorter and its existing identities are unchanged
- Systems own whole directories in project memory, so new files are never unowned
- New goals: `goal::short-plain-docs` and one per fix, each expecting the rule that checks it

## Fixed

- Recording or resolving findings no longer makes a review stale, and resolving a finding no longer voids the challenge receipt
- A path that becomes ignored while a task is open no longer counts as its change
- `challenge NAME` leads with what blocks the hand-back, and a BLOCKED task's route names its unresolved findings
- `task reconcile-withdrawal` accepts a successor whose write scope covers the path, and a reconciliation stands once recorded instead of coming back after later edits
- Without a declared `role::orchestrator`, an optional `--model` on an amendment is recorded instead of refused, and `task open` says which verbs will need the role

A review made before 0.11 on a target with findings goes stale once; accept, check and challenge it again. Windows CI failed the self-hosting `finish` once and passed it on the next run; the cause is not known yet.

No contract syntax or exit code changed; task JSON gains optional `lenses`, `falsify` and `falsifications` fields. History files are unchanged.

See the [full changelog](https://github.com/Kiborgik/blabla/blob/v0.11.0/CHANGELOG.md#0110-2026-10-11).
