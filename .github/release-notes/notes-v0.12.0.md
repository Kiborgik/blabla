# BlaBla 0.12.0

Small coding models drift from the goal and say "done" too early. BlaBla catches that: a human or a strong model writes the intent once, as contracts, and cheap models do bounded work that BlaBla checks. Version 0.12 was built while dogfooding BlaBla on a real project: a zero-player civilization game, a procedural world whose towns, trade and research grow on their own while people watch. Building it through BlaBla's task workflow showed where handing work back and forth cost the most, and this release removes that cost. A hand-back is one command, the task lifecycle is one table, evidence BlaBla ran survives a resume, and `finish` runs independent contract groups in parallel, so BlaBla's own behavior verification takes under a minute. The 0.12 work itself ran through BlaBla's tasks, challenges and `finish`.

## Breaking and upgrade

- 0.12 reads only task records it wrote. Close or withdraw every open task with the BlaBla that opened it, or move closed history out of `.blabla/tasks/`; the upgrade note in `docs/agent-workflow.md` explains how
- A task declares its check one way, `--check PROG ARG…`; `--check-argv`, `task check --argv` and the shell-string form are gone
- `finish` runs one campaign per group of behavior contracts that share state or actions, each with its own derived seed, so recorded sequences differ from 0.11; a record written by 0.11 shows STALE until `finish` runs

## Added

- `task ready` takes the lens assessments, notes, goal outcome and intent claims in one write and runs the assignment challenge; a refused ready records nothing
- A task that serves a goal hands back with `delivered`, `partial`, `blocked` or `not-applicable`; `partial` and `blocked` leave a residual finding that survives close without blocking it
- `task open --intent`, `task budget`, `task scope --remove`, role model lists that name a family such as `sonnet-*`, the structure fact `lines MODULE <= N` and the profile field `jobs`
- `run` and `finish` start the application in `.blabla/run/<pid>/` and refuse to record a run during which the implementation changed

## Changed

- Evidence BlaBla executed stays current across a new acceptance while its check and inputs are unchanged; an exit given with `--exit` is shown as claimed
- Task states, the commands that move them and the guards on each move are one table that challenge, hand-back, close and `task show` all read, and `task show` attributes changed paths exactly as `challenge` does
- Campaigns share one case pool by the obligations they own and stop after twice the actions their full coverage took
- Command output is shorter, and on Windows supervised processes start faster
- The agent workflow, the skill and the guides describe only 0.12

## Removed

- The game example now lives in its own repository

See the [full changelog](https://github.com/Kiborgik/blabla/blob/v0.12.0/CHANGELOG.md#0120-2026-10-29).
