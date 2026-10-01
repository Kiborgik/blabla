# project.bla

The manifest composes executable contracts, registers queryable memory and defines canonical verification. `blabla status` finds the nearest `project.bla` above the working directory; `--project FILE_OR_DIR` overrides discovery. Nested projects are independent. Paths resolve from the manifest directory.

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
| `project NAME` | required header |
| `use behavior "path" [as group]` | active contracts compile together in one environment; types, state and actions may be shared across files |
| `use structure "path" [as group]` | active static contract |
| `draft behavior "path"` / `draft structure "path"` | checked/listed, never verified or counted toward completion |
| `mission "path"`, `system "path"`, `process "path"`, `goal "path"` | at most one file per memory kind |
| `knowledge "path"` | repeatable knowledge-file registration; duplicate paths are invalid |
| `voice neutral` / `voice blunt` | at most one; presentation only, neutral by default |
| `ignore "pattern"` / `ignore from "file"` | repeatable change-tracking exclusions |
| `verify behavior { … }` | one canonical behavior profile; `command` required |

Groups default to file stems; `as` supplies an alias. Same-name/same-type state declarations observe one shared value in composed behavior. Rule IDs are `group::label`. Reserved group names are `contract`, `mission`, `priority`, `knowledge`, `ruling`, `judgment`, `binding`, `system`, `responsibility`, `seam`, `role`, `policy`, `flow`, `step`, `runtime`, `task`, `goal`; use an alias for collisions (`E_RESERVED_GROUP`).

Memory is not a completion layer: `use mission/system/process/knowledge` is rejected (`E_UNSUPPORTED_LAYER`). `verify structure` is rejected because static evaluation needs no profile. Duplicate singleton memory statements and duplicate knowledge registrations are errors, never overrides.

### The verification profile

| Field | Meaning / default |
| --- | --- |
| `command ["program", "arg", …]` | launch argv; relative path-like elements resolve against the manifest root |
| `prepare ["program", "arg", …]` | optional once-per-run preparation in the manifest directory, before launch resolution; failure is a preparation error, not behavior RED |
| `seed`, `cases`, `steps`, `shrink_budget` | campaign shape; defaults 0, 16, 32, 256; shrink budget 0–256 |
| `timeout_ms` | each ordinary request/response, 1–5000 ms; default 1000 |
| `startup_ms` | first exchange after each process start, 1–60000 ms; defaults to `timeout_ms` |

Builds belong in `prepare`, outside response timeouts. Put output under `.blabla/` or an ignored path; tracked build output can immediately stale the run. BlaBla creates `.blabla/` before preparation.

```text
verify behavior {
    prepare ["go", "build", "-o", ".blabla/todo-go", "."]
    command [".blabla/todo-go"]
    timeout_ms 1000
}
```

`run FILE.bla` inside a project inherits profile timeout/startup unless overridden. Explicit `--timeout-ms` also sets startup unless `--startup-ms` is supplied. Preparation/startup/timeout settings enter the profile fingerprint.

### Ignored paths

```text
ignore from ".gitignore"
ignore ".eval-artifacts"
```

Exclusions apply to implementation fingerprints and task snapshots. Gitignore syntax is supported: blank/comment lines, `!` reinclusion, directory-only trailing `/`, anchored paths, `*`, `?`, `[…]` and `**`; last match wins, but an ignored directory prevents child reinclusion. Inline patterns anchor to the manifest; list-file patterns anchor to that file's directory. Windows declarations and ignore matching use lowercase identities; snapshots and withdrawal history preserve the observed filename spelling. Directory deliverables match those observations case-insensitively and store normalized declarations. Case-sensitive Windows directories with ambiguous file/symlink aliases or non-resolving canonical spellings are refused for task credit, including tracked descendants of directory inputs. Unix matching stays case-sensitive. Diagnostics retain written rule spelling. Only explicitly named lists are read, not nested `.gitignore` files.

Duplicate declarations are `E_DUPLICATE_IGNORE`; malformed declarations are `E_MANIFEST_IGNORE`; missing/outside lists are `E_IGNORE_LIST_MISSING` / `E_IGNORE_LIST_OUTSIDE`. The manifest, contracts, registered memory and ignore lists remain tracked regardless of patterns. Built-in `project::SKIPPED_DIRECTORIES` remain skipped. Task inputs and deliverables use normalized project-relative paths: root/escape paths, `..` components, symlinks, built-in skipped directories and ignored paths are refused atomically. Ordinary absent in-root paths remain valid dependencies: their null digest changes when a tracked file appears. An existing regular file named `target`, for example, remains tracked because the built-in exclusion applies to directories. Legacy unobservable declarations remain readable history but cannot support current evidence, hand-back, review, approval or expert resolution credit.

### The diagnostic voice

`voice blunt` appends a blunt rendering to the neutral statement of a contradiction. It cannot remove evidence/uncertainty, change JSON, verdicts, exits or task transitions, or escalate itself. Honest failures and reported blockers receive no blunt rendering.

## Canonical identities

Copy the IDs that commands print. `status` lists coarse identities even when GREEN; `explain` expands them and prints finer ones.

| Identity | Object |
| --- | --- |
| `contract::<group>` / `<group>::<label>` | contract / rule |
| `mission::<name>` / `priority::<name>` | purpose and non-goals / tradeoff priority |
| `system::<name>` / `responsibility::<name>` / `seam::<name>` | architectural part / its responsibility / crossing value |
| `role::<name>` / `policy::<name>` | actor authority / expectation |
| `flow::<name>` / `step::<name>` | ordered workflow / one step |
| `knowledge::<pack>` / `ruling::<pack>::<name>` | portable expertise / one ruling |
| `judgment::<pack>::<name>` / `binding::<name>` | fixed typed expert question / project-local routing |
| `goal::<name>` | objective with current expectation verdicts |
| `runtime::<name>` | BlaBla-controlled runtime primitive |

Ruling/judgment names are unique within their kind and pack, but can repeat across packs. A bare group responds with its `contract::` command (`E_COARSE_IDENTITY`); unique rule labels are conveniences. Ambiguous labels or cross-namespace names are refused with canonical alternatives (`E_AMBIGUOUS_RULE`, `E_AMBIGUOUS_IDENTITY`). Tasks use `task show NAME` rather than this explain table.

## Project memory

Memory uses `.bla` declarations, not JSON. Register each file explicitly:

```text
mission "mission.bla"
system "system.bla"
process "process.bla"
knowledge "knowledge/engineering.bla"
goal "goals.bla"
```

Memory states are `present`, `missing`, `unreadable`, `invalid`, `unregistered`. Validation checks syntax, fields, names and references **within memory**, not whether the code follows it. No memory state changes `OVERALL`. `blabla check FILE.bla` reports VALID/INVALID during authoring; `blabla guide memory` gives the short procedure.

Names start with a letter/digit and continue with letters, digits, `_` or `-`. Unknown declarations/fields, duplicate fields and invalid references are errors. Ordinary `purpose`, `statement`, path, verification and model values are text. A registered `.json` memory file is unreadable; unregistered files are not loaded.

### Declaration fields

Required fields appear first; brackets below mark optional fields, not literal syntax. Lists use `["a", "b"]`; a single text item can be quoted alone where the field accepts it.

| Declaration | Fields |
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

Judgment/binding field schemas are in [Expert](expert.md#fixed-expert-judgments-and-bindings).

Exactly one mission declaration is required in registered mission memory. A responsibility owner and both sides of a seam must name declared systems; each seam has exactly two sides. A role's `owns` denotes orchestration authority, not System responsibilities. `verification` and model IDs are opaque strings, not built-in enums. Model aliases must point to a model declared by a role; accepting the alias counts as that permitted model.

A role's quoted `block_below "70"` sets a whole-number decision floor, 0–100, default 0. Each decision retains the floor it was measured against; later policy edits do not rewrite it. Out-of-range floors make memory invalid; nonintegers make it unreadable. [Decisions and questions](agent-workflow.md#asking-instead-of-guessing)

A flow's steps occur in source order. Each step names its declared flow and allowed roles; `command` describes a route, it does not execute it. Empty flows and unresolved flow/role references are invalid. `explain flow::NAME` lists IDs/roles/commands; `explain step::NAME` opens the statement.

### Reusable knowledge and routing

```text
knowledge "engineering" { purpose "Scope, duplication and falsification." }
ruling "smallest-correct-change" {
    pack "engineering"
    statement "Change only what the assignment requires."
}
```

Systems use `knowledge ["engineering"]` for relevant packs; roles/policies use `consult ["engineering"]` for expected consultation. Routing goes **into** Knowledge. Packs contain no project paths, roles or contract bindings; a ruling has only `pack` and `statement`. Mission has no routing field. Unresolved routes make the referring memory invalid with the cause named.

Register any number of knowledge files; parse errors retain their source file. Pack names must be unique across them and each pack must contain a ruling or judgment. Reuse a pack by path, including `knowledge "../shared-knowledge/engineering.bla"`; there is no registry or fetcher. An out-of-root pack is not walked by the implementation fingerprint/public-tree audit, unlike an in-root pack. This tracking asymmetry does not grant it verification authority. Knowledge never expands task scope.

### Goals

```text
goal "durable-todos" {
    statement "Completed operations survive a process restart."
    expect ["core::persistence"]
    state "active"
}
```

`expect` must be nonempty and contain canonical `contract::<group>` or `<group>::<label>` forms. Existence is checked when shown, not during grammar validation. `state` is `active`, `done` or `dropped`; duplicate goal names are invalid. Optional `serves` names priorities in valid registered mission memory; without mission it must be empty.

Goals are judged from the current project view on every display, never cached:

| Verdict | Meaning |
| --- | --- |
| `held` | current rule/contract GREEN |
| `not-held` | RED, YELLOW or ERROR |
| `unverified` | behavior STALE, UNVERIFIED, VERIFYING or INTERRUPTED |
| `unresolved` | identity does not exist |

`status` lists active goals and points to those ready to mark done. A done goal with an unmet expectation can ground project-only `goal-outcome-unmet`; active/dropped goals do not. Missing/unreadable/invalid goal memory is reported without judging goals. `finish` never judges goals for completion.

`task open NAME --goal GOAL_NAME` must name a declared goal; views link the task and goal. Editing in-root goal memory, including marking done, stales the behavior record just like other tracked source. Rerun `finish` for current behavior expectations.

## Layers and completion

```text
BEHAVIOR   GREEN | YELLOW | RED | UNVERIFIED | STALE | VERIFYING | INTERRUPTED | none declared
STRUCTURE  GREEN | RED | ERROR | none declared
OVERALL    GREEN only when every active layer is GREEN and at least one is active
```

`finish` never trusts cached completion: it runs the canonical behavior profile, evaluates structure live and records `.blabla/status.json`. Behavior must be fresh **and canonical**; a GREEN run under other settings is not canonical. `status` reports the record with current freshness and live structure. Drafts, memory, goals, tasks and experts do not decide the gate.

Freshness covers active behavior contracts, implementation tree, command-line file inputs, profile and verifier version. Changes yield STALE. Implicitly loaded code outside the manifest tree and unnamed on the command line is a known blind spot. Structure stored in a run record is audit history only, never current evidence.

Before a campaign, `.blabla/verifying.json` records run/pid/start/project/profile identity. A matching live process yields VERIFYING; otherwise INTERRUPTED. Both block completion. A new `finish` replaces an interrupted marker; a killed or detached run cannot leave current GREEN.

`status`/`finish` exits: **0** OVERALL GREEN; **1** a RED layer; **2** contract/manifest error; **3** unavailable structure provider or application failure; **4** internal error; **5** other BLOCKED states. `status --json` exposes behavior `state`, `structure`, `overall` and `completion`; `finish --json` nests that view under `project` alongside its run/completion data. Use fields instead of parsing English.

Standalone `check` validates/evaluates the selected file; `check --falsify` tests static rule sensitivity. Neither certifies completion. [Behavior results](language.md#verification-results) · [structure authoring](structure.md#falsification)

## Fixed expert judgments and bindings

[The expert reference](expert.md#fixed-expert-judgments-and-bindings) owns the complete declaration, slot, template and runtime schemas. `status`, `explain` and `check` load definitions without contacting a provider. Valid bindings default to shadow; host/provider capability remains unknown without runtime evidence. Advice is outside completion.

## 0.10 task-record revalidation

Task records are separate machine state. The [workflow upgrade procedure](agent-workflow.md#upgrading-task-records-to-010) covers legacy evidence, acceptance epochs, lenses, explicit reviews, withdrawal and JSON changes. Preserve old records as history; do not interpret them as current approval. [Breaking notes](../CHANGELOG.md#0100-unreleased)
