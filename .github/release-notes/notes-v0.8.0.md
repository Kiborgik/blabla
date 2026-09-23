# BlaBla 0.8.0

BlaBla keeps project intent in the repository as queryable memory and executable contracts. Version 0.8 is the first release without the alpha label: it tightens the bounded-task workflow, lets a project leave generated paths out of change tracking, and states what a user can rely on between releases.

## What 0.8 promises

BlaBla is still pre-1.0. From this release on, a change to contract syntax, CLI options, JSON fields or exit codes ships only in a minor release (0.9, 0.10, …) and is listed under **Breaking** in `CHANGELOG.md`. A patch release (0.8.x) never makes one. There are no compatibility modes: a breaking change is announced, not shimmed.

## Breaking changes

- `task attribute` now belongs to the orchestrator. It requires `--model` naming a model `role::orchestrator` permits, records that model on the attribution, and is no longer among a worker's routes, so a worker cannot declare its own out-of-scope change concurrent. It also refuses a path that has not changed since the task opened.
- `task resolve` belongs to the orchestrator too: it requires `--model` and records that model on the resolution.
- `task resolve`, `task attribute` and `task deliverable --remove` need process memory that declares `role "orchestrator"`, and `task addressed` needs the task's role declared. Without it they exit 2, and the error names the files to add: `process "process.bla"` in `project.bla` and the role in that file.
- A finding's `resolution` in the task record and in `task show --json` is now an object carrying `evidence` and, when recorded, `model`, where it was a string. Records holding the old string still load.
- Commands that change a task print one line, the record's identity and state. Only `task open` and `task show` print the whole record; `--json` still writes the whole record.
- READY requires current successful evidence and an explicit assignment challenge receipt tied to the task's own paths. `task close` checks both again, and a task that changed after hand-back is accepted again before any further work.
- `task evidence` is refused unless the task is ACCEPTED, and a result binds the write scope, or the declared inputs, as well as the deliverables. Evidence `inputs` in the task record map each such path to a digest or `null`.
- A task left ACCEPTED or READY by 0.7 has no challenge receipt and evidence over its deliverables only: accept it, record evidence and challenge it again before `task ready` or `task close`.
- `task accept` on an ACCEPTED task re-records the acceptance and clears the receipt, where it was refused with exit 2.
- `blabla challenge <name>` on a task that is not closed exits on its assignment check: 0 when the assignment is clear, 1 when it needs attention, so a project-wide challenge such as verification not current no longer fails it. On an ACCEPTED task it records the challenge receipt, and `--json` adds `assignment_clear`.
- `declared-check-failed`, `readiness-without-evidence` and `lens-unassessed` ground on an ACCEPTED task as well as a READY one, so a role that consults knowledge packs records a `task lens` for each before `task ready`.
- `status --json` reports a task's `state` as `OPEN`, `ACCEPTED`, `BLOCKED`, `READY` or `CLOSED`, where it was `OPEN` or `CLOSED`.
- `status --json` and `explain --json` no longer carry the process `enforcement` field, and `status` prints `PROCESS` without `ADVISORY`.

## New task commands

- `task note` keeps text on a record without adding unsettled work.
- `task addressed <name> <id> "..." --model <id>` lets the carrying role say what it did about a finding; an addressed finding blocks neither hand-back nor `task close`, and resolving it stays the orchestrator's job.
- `task open --check-argv` and `task check --argv` declare a check as a program and its arguments; a task declares that or a command, never both. `task evidence --run` runs it from the project root without a shell, timeout or process containment, keeps its output in `.blabla/scratch/<name>/evidence-<n>.log` and records the exit code BlaBla observed. `--check-argv` and `--argv` take every argument after them, so they go last.
- `task open --input` and `task check --input` declare what the check reads; the default is the write scope, and the deliverables are always included.
- `task deliverable --remove <path> --reason "..." --model <id>` withdraws what the task owes as the orchestrator's decision, a directory withdrawing every file owed under it. The record keeps why, a path the task does not owe is refused, and `--remove` does not combine with `--add`.
- `task attribute` takes several paths, and the attribution-unknown challenge lists every undeclared path at once.

## Leaving paths out of change tracking

`project.bla` can now say which paths do not count as changes:

```text
ignore from ".gitignore"
ignore "pattern"
```

Ignored paths leave the implementation fingerprint and the task snapshot, so build output and local artifacts no longer make a recorded run stale or turn up as unexplained changes in a task. The manifest, contracts, registered memory and the ignore lists themselves stay tracked whatever the patterns say, and `task open`, `task check` and `task deliverable --add` refuse an ignored deliverable or input. A malformed or duplicate `ignore` is `E_MANIFEST_IGNORE` or `E_DUPLICATE_IGNORE`, and a list file that is missing or outside the project is `E_IGNORE_LIST_MISSING` or `E_IGNORE_LIST_OUTSIDE`, which stops the project from loading rather than reading as an empty list.

## Clearer hand-back

A clear challenge on an accepted task names the next step, `blabla task ready <name>`, and while a task is in the worker's hands a stale project verification is left to the orchestrator rather than sending the worker to `blabla finish`. When a challenge finds a changed path nobody declared, it tells a worker who made that change to restore it or record why with `task block` and stop. The onboarding block says deciding project completion belongs to the orchestrator, never to a worker on a task, and the worker and reviewer agent briefs say the task record is written only through `task` commands.

The challenge receipt behind READY is tied to the task's own paths, so an orchestrator's integration edit elsewhere does not void an open hand-back. A changed path inside another open task's scope is attributed to that task. `task show` prints the routes for the task's current state, offers `task lens` while the task is ACCEPTED, and a worker's view never names `finish`. `status` names task records it cannot read, says GREEN does not close unfinished tasks, and with several open tasks asks for an explicit `blabla challenge <name>`.

Agent-facing text in `explain`, `check`, `guide` and the onboarding block now says Process roles, policies and flows bind the role that carries the work, instead of calling them advisory. What BlaBla does and does not enforce is stated in the README: policies and flows are not enforced, while the task commands enforce the recorded hand-back and close prerequisites, the permitted models on `addressed`, `resolve`, `attribute` and `deliverable --remove`, and a few declaration rules.

## Fixes

- Task state labels in task views, directory deliverables and the freshness of check inputs shared between tasks.
- The distinction between an assignment hand-back and project verification.
- Generated skill YAML metadata, and task listings now route to `task show`.
- A task's `state` decides whether it is open, so a stray `closed_unix` no longer closes an open task; a record written by 0.6, which carries no `state`, still reads as closed.
- Standalone `blabla check <contract.bla>` prints the contract's status, `ERROR` or `RED`, on its first line where it always printed `OK`; exit codes and `--json` are unchanged.

## Agent integration smoke tests

`evals/` holds a diagnostic suite that runs small local models through Claude Code and Codex CLI, with and without BlaBla, over the same cases. It triages onboarding and workflow failures; it is not a benchmark or a model ranking. See `evals/README.md` for how to run it.

## Limitations

- Verification is bounded and heuristic. GREEN means the declared obligations were exercised and satisfied under the recorded campaign, not that the software has been proved correct.
- Adapter observations are trusted. BlaBla is not a sandbox, and process guidance does not enforce agent actions.
- Project memory is checked for internal consistency, not independently proved against the repository.
- Process containment is tested on Windows and Linux; macOS is untested.
- Compiled examples require their toolchains on `PATH`. Requires Rust 1.90 or newer.
