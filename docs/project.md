# project.bla

`project.bla` composes a project's contracts and defines its canonical verification. It is the machine entry point; `blabla status` is the agent entry point.

```text
project GlyphVault

use structure "contracts/structure/architecture.bla"

use behavior "contracts/behavior/core.bla"
use behavior "contracts/behavior/persistence.bla"
draft behavior "contracts/behavior/resources.bla"

verify behavior {
    command ["python", "glyph_vault/main.py"]
    seed 2
    cases 1
    steps 4096
    timeout_ms 1000
    shrink_budget 256
}
```

## Statements

| Statement | Meaning |
| --- | --- |
| `project <Name>` | required header |
| `use behavior "path" [as name]` | an active behavior contract; all active behavior contracts compile together against one project environment, so one file may reference types, state and actions another declares |
| `use structure "path" [as name]` | an active structure contract, evaluated statically (see `structure.md`) |
| `draft behavior "path"` / `draft structure "path"` | compiled by `check`, listed by `status`, never verified and never part of completion |
| `verify behavior { ... }` | the one canonical behavior profile: `command` is required; `seed`, `cases`, `steps`, `timeout_ms` and `shrink_budget` default to the `run` defaults |

Paths resolve from the manifest directory. The group name is the file stem or the `as` alias; rule identities are `group::label`, so `core::restart` and `sealing::restart` coexist. `mission` and `process` layers are rejected (`E_UNSUPPORTED_LAYER`); `verify structure` is rejected because structure needs no profile.

## Discovery

Commands without a file argument use the nearest `project.bla` above the working directory; `--project <file|dir>` overrides discovery. Nested projects are independent.

## Layers and completion

```text
BEHAVIOR   GREEN | YELLOW | RED | UNVERIFIED | STALE | VERIFYING | INTERRUPTED | none declared
STRUCTURE  GREEN | RED | ERROR | none declared
OVERALL    GREEN only when every active layer is GREEN and the behavior record is fresh and canonical
```

- The behavior layer is the record written by the last `blabla finish` (or project `run`) to `.blabla/status.json`. It is fresh while the active behavior contracts, the implementation tree, the files named on the command line, the profile and the verifier version are unchanged; otherwise STALE. A GREEN produced with other settings is `not canonical`. A false STALE is acceptable; a stale GREEN is not.
- The structure layer is evaluated live on every call and never recorded as current; `finish` stores the result it saw inside the record for audit only.
- `blabla finish` writes `.blabla/verifying.json` (run id, pid, start time, project and profile identity) before the campaign and removes it after the record. `status` reports VERIFYING while that process is alive and was started when the marker says, INTERRUPTED otherwise; both block completion, and a new `finish` replaces an interrupted marker.

Exit codes of `status` and `finish`: 0 OVERALL GREEN; 1 a RED layer; 2 contract or manifest error; 3 structure provider unavailable or application failure; 4 internal; 5 any other BLOCKED state. `--json` exposes `state` (behavior), `structure`, `overall` and `completion` so agents never parse English.
