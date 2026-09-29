# BlaBla 0.9.0

BlaBla keeps project intent in the repository as queryable memory and executable contracts. Version 0.9 is built for an orchestrator that runs small workers: a worker says how sure it is and stops when it is not sure enough, the orchestrator asks the questions it doubts, records made under an orchestrator model while a worker holds a task are shown and challenged, and the owner's goals are judged against the rules they name.

## Breaking changes

- A registered structure contract with no rule is refused with `E_NO_RULES`; it used to report 0/0 rules GREEN.
- `task close` is refused while a record made under an orchestrator model during a worker's carry is unconfirmed; confirm it with `task confirm` after hand-back.
- `task accept` and `task decide` are refused on a task blocked by a decision below the role's floor until the orchestrator answers it.
- `blabla challenge` with no task judges goals marked done and exits 1 when one does not hold.
- `blabla run FILE` inside a project takes its timeouts from the project's `verify behavior` profile when the flags are omitted.
- A task handed back by 0.8 is challenged again before `task ready` or `task close`.

## New

- Model aliases in process memory, so a host's model id counts as the model a role permits.
- `task decide` and `task answer`, with `block_below` on a role and calibration per model in `explain role::<name>`.
- `task ask` and `task decide --on`: the orchestrator's typed questions, which a worker must pick before hand-back.
- `task confirm` and the `orchestrator-record-during-carry` challenge.
- Goals: `goal "goals.bla"`, judged in `status`, `explain goal::<name>` and the project-wide challenge, and `task open --goal`.
- `task evidence --run` shows the tail of a failing check's log.

## Fixed

- Linux: no orphaned descendant survives a restart or finish.
- A worker's hand-back survives notes, answers and concurrent work, and a record made while a check runs is kept.

The full list is in `CHANGELOG.md`.
