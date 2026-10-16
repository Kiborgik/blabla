# project.bla

The manifest lists the contracts, registers memory and sets the one canonical verification profile. `blabla status` finds the nearest `project.bla` above the working directory; `--project PATH` overrides that. Paths resolve from the manifest's directory. Nested projects are independent.

```text
project GlyphVault
use structure "contracts/structure/architecture.bla"
use behavior "contracts/behavior/core.bla"
draft behavior "contracts/behavior/resources.bla"
mission "mission.bla"
ignore from ".gitignore"

verify behavior {
    command ["python", "glyph_vault/main.py"]
    seed 2
    steps 4096
}
```

## Statements

| Statement | Meaning |
| --- | --- |
| `project NAME` | required header |
| `use behavior "path" [as group]` | active behavior contract; all of them compile together and may share types, state and actions |
| `use structure "path" [as group]` | active structure contract |
| `draft behavior\|structure "path"` | checked and listed, never counted toward done |
| `mission`, `system`, `process`, `goal "path"` | one memory file per kind |
| `knowledge "path"` | any number of knowledge files |
| `voice neutral\|blunt` | presentation only; `blunt` adds a blunt line to a contradiction and changes nothing else |
| `ignore "pattern"` / `ignore from "file"` | gitignore-style exclusions from fingerprints and task snapshots |
| `verify behavior { … }` | the canonical profile |

Group names default to the file stem; rule IDs are `group::label`. These group names are reserved and need an `as` alias: `contract`, `mission`, `priority`, `knowledge`, `ruling`, `judgment`, `binding`, `system`, `responsibility`, `seam`, `role`, `policy`, `flow`, `step`, `runtime`, `task`, `goal`. Memory is never a layer, so `use mission` is an error, and so is `verify structure`.

| Profile field | Meaning / default |
| --- | --- |
| `command [...]` | launch argv; relative paths resolve from the manifest (required) |
| `prepare [...]` | optional build step, run once before launch; write output under `.blabla/` or an ignored path, or the run goes STALE |
| `seed`, `cases`, `steps`, `shrink_budget` | 0, 16, 32, 256 (max 256) |
| `timeout_ms` | per response, 1–5000; default 1000 |
| `startup_ms` | first exchange after each start, up to 60000; default `timeout_ms` |

**Ignore rules** use gitignore syntax, including `!` and `**`; the last match wins. Only the lists you name are read, never nested `.gitignore` files, and a list's patterns anchor to its own directory. The manifest, contracts, memory and ignore lists are always tracked. Windows paths match without case; Unix paths match with case.

## Canonical identities

Copy the IDs that commands print. `status` lists the coarse ones; `explain` opens them and prints finer ones.

| Identity | Object |
| --- | --- |
| `contract::<group>` / `<group>::<label>` | contract / rule |
| `mission::<name>` / `priority::<name>` | purpose and non-goals / tradeoff priority |
| `system::<name>` / `responsibility::<name>` / `seam::<name>` | part of the code / what it owns / value crossing a boundary |
| `role::<name>` / `policy::<name>` | who acts / what they must do |
| `flow::<name>` / `step::<name>` | ordered workflow / one step |
| `knowledge::<pack>` / `ruling::<pack>::<name>` | reusable expertise / one ruling |
| `judgment::<pack>::<name>` / `binding::<name>` | expert question / where it applies |
| `goal::<name>` | objective with live verdicts |
| `runtime::<name>` | BlaBla's own runtime primitive |

Ambiguous names are refused with the canonical alternatives. Tasks use `task show NAME`, not `explain`.

## Memory

Register each `.bla` memory file in `project.bla`. Validation checks syntax, fields and references inside memory, never against the code, and no memory state changes OVERALL. `blabla check FILE.bla` validates one file; `blabla guide memory` shows the shapes. Names start with a letter or digit, then letters, digits, `_` or `-`.

| Declaration | Fields ([optional]) |
| --- | --- |
| `mission "name"` | `statement`; [`non_goals`] |
| `priority "name"` | `statement` |
| `system "name"` | `purpose`; [`paths`, `knowledge`] |
| `responsibility "name"` | `owner`, `statement` |
| `seam "name"` | `between`, `value`, `statement`; [`moves_with`] |
| `role "name"` | `purpose`; [`owns`, `verification`, `model`, `consult`, `block_below`] |
| `policy "name"` | `statement`, `applies_to`; [`consult`] |
| `flow "name"` | `purpose` |
| `step "name"` | `flow`, `role`, `statement`; [`command`] |
| `alias "name"` | `model` |
| `knowledge "pack"` | `purpose` |
| `ruling "name"` | `pack`, `statement` |
| `goal "name"` | `statement`, `expect`, `state`; [`serves`] |

- A seam has exactly two sides, both declared systems. A role's `block_below "70"` sets its decision floor (0–100, default 0). A model alias must point at a model a role declares
- A flow's steps run in source order; a step's `command` names a route and never runs it
- Routing goes into knowledge: systems use `knowledge [...]`, roles and policies use `consult [...]`. A ruling has only `pack` and `statement`, so another project can reuse the pack file by path, with no registry. Knowledge never widens a task's scope
- Judgment and binding fields: [Expert](expert.md)

### Goals

```text
goal "durable-todos" {
    statement "Completed operations survive a process restart."
    expect ["core::persistence"]
    state "active"
}
```

`expect` lists rule or contract identities and must not be empty. `state` is `active`, `done` or `dropped`; optional `serves` names mission priorities. Every view judges each expectation live: `held` (GREEN), `not-held` (RED, YELLOW or ERROR), `unverified` (behavior not current) or `unresolved` (no such identity). Held contracts do not prove the goal's prose, look or feel: `status` sends an active goal whose expectations hold to outcome review, and only the owner marks it done. A done goal with an unmet expectation raises `goal-outcome-unmet`. `task open --goal NAME` links a task to a goal. Editing goal memory stales the behavior record like any tracked file. Goals never decide done.

## Layers and completion

```text
BEHAVIOR   GREEN | YELLOW | RED | UNVERIFIED | STALE | VERIFYING | INTERRUPTED | none declared
STRUCTURE  GREEN | RED | ERROR | none declared
OVERALL    GREEN only when every active layer is GREEN and at least one is active
```

`finish` never trusts a cached result: it runs the canonical profile, checks structure live and records `.blabla/status.json`. A GREEN under other settings is not canonical. Behavior goes STALE when a contract, the implementation tree, a command-line input, the profile or the verifier changes; code loaded implicitly from outside the project tree, and not named on the command line, is not tracked. A run in progress is VERIFYING and a dead one is INTERRUPTED; both block done.

Exit codes of `status` and `finish`: **0** OVERALL GREEN; **1** a RED layer; **2** contract or manifest error; **3** structure provider or application failure; **4** internal error; **5** any other blocked state. Read JSON fields instead of English: `status --json` has `state`, `structure`, `overall` and `completion`; `finish --json` nests that view under `project`, beside its run and completion data. `check` and `check --falsify` help authoring and never decide done.
