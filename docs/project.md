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
| `mission "path"` | registers this project's mission memory, at most once; not a layer, never decides completion (see below) |
| `system "path"` | registers this project's system memory, at most once; not a layer, never decides completion (see below) |
| `process "path"` | registers this project's process memory, at most once; not a layer, never decides completion (see below) |
| `knowledge "path"` | registers one reusable knowledge pack file; repeatable, not a layer, never decides completion (see below) |
| `voice <name>` | the diagnostic voice for human output, at most once: `neutral` (the default) or `blunt`; it changes no verdict, no exit code and no `--json` field (see below) |
| `ignore "pattern"` | leaves the paths one gitignore-syntax pattern matches out of change tracking; repeatable (see below) |
| `ignore from "file"` | leaves out every path the patterns listed in that file match, such as `.gitignore`; repeatable (see below) |
| `verify behavior { ... }` | the one canonical behavior profile: `command` is required; `prepare`, `seed`, `cases`, `steps`, `timeout_ms`, `startup_ms` and `shrink_budget` are optional |

### The verification profile

| Field | Meaning |
| --- | --- |
| `command ["program", "argument", ...]` | the application launch; relative path-like elements resolve against the manifest directory |
| `prepare ["program", "argument", ...]` | run once, before the command is resolved and before any process is spawned, in the manifest directory; a non-zero exit is a preparation error naming the command, its code and its output, never a behavior RED |
| `timeout_ms` | the allowance for one request and its response, at most 5000 |
| `startup_ms` | the allowance for the FIRST exchange after each process start, at most 60000; defaults to `timeout_ms` |
| `seed`, `cases`, `steps`, `shrink_budget` | the campaign shape; they default to the `run` defaults |

`prepare` exists because a compiled application must be built before it is launched, and a build
does not belong inside a per-response timeout. `startup_ms` exists for the same reason one level
down: a process that boots slowly should not force `timeout_ms` up for the other eight thousand
exchanges. Both enter the profile fingerprint, so changing either makes a recorded run stale.

**Write preparation output under `.blabla/` or an ignored path.** `project::fingerprint` walks the
whole tree except the directories in `project::SKIPPED_DIRECTORIES` and the paths `ignore` leaves
out, so a build artifact written anywhere else changes the implementation fingerprint after `finish`
has recorded the run against it, and the next `status` reports STALE. BlaBla creates `.blabla/`
before running `prepare` so a fresh clone needs no setup step.

```text
verify behavior {
    prepare ["go", "build", "-o", ".blabla/todo-go", "."]
    command [".blabla/todo-go"]
    timeout_ms 1000
}
```

### The diagnostic voice

`voice blunt` changes how a standing challenge READS and nothing else. The blunt rendering is
appended to the neutral statement rather than replacing it, so no evidence, hedge or uncertainty can
be dropped by choosing a voice; the machine-readable report is byte-identical under either voice;
and the exit code, the rule verdicts and the task transitions are untouched. Only a contradiction
has a blunt rendering — an honest failure or a reported blocker never does, because those are not
contradictions. A project that declares no voice gets the neutral one, and nothing can escalate it.
`contracts/voice.bla` holds all of that to the real adjudication path.

### Ignored paths

BlaBla measures the working tree twice: the implementation fingerprint that makes a recorded run
stale, and the snapshot a bounded task compares against to find what changed since it opened. Build
outputs, caches and files a host writes into the project belong in neither.

```text
ignore from ".gitignore"
ignore ".eval-artifacts"
```

`ignore from "file"` reads one gitignore file; `ignore "pattern"` adds one pattern of the same
syntax, anchored to the manifest directory. Both repeat, the same declaration twice is
`E_DUPLICATE_IGNORE`, and an `ignore` without a quoted pattern or file is `E_MANIFEST_IGNORE`. A listed file's patterns anchor to that file's own directory, as git reads
them: blank lines and `#` comments are skipped, `!` re-includes, a trailing `/` matches directories
only, a `/` at the start or in the middle anchors the pattern, `*`, `?`, `[...]` and `**` match as in
git, the last matching pattern decides, and a file under an ignored directory cannot be re-included.
Only the files the manifest names are read; nested `.gitignore` files are not discovered. A list
file that cannot be read is `E_IGNORE_LIST_MISSING`, and one outside the project is
`E_IGNORE_LIST_OUTSIDE`, never an empty list.

What BlaBla's authority rests on is always tracked, whatever the patterns say: the manifest, every
contract, every registered memory file and every ignore list. An edit to `.gitignore` is therefore
itself a change a task sees, so a worker cannot hide its work by ignoring it. A path a rule leaves
out can never be observed, so `task open`, `task check` and `task deliverable --add` refuse to
declare an ignored deliverable or input and name the rule, rather than letting it read later as absent. The built-in
directories in `project::SKIPPED_DIRECTORIES` stay left out with or without `ignore`.

Paths resolve from the manifest directory. The group name is the file stem or the `as` alias; rule identities are `group::label`, so `core::restart` and `sealing::restart` coexist. `verify structure` is rejected because structure needs no profile. A second `mission`, `system` or `process` statement is `E_DUPLICATE_MISSION`, `E_DUPLICATE_SYSTEM` or `E_DUPLICATE_PROCESS`; the same knowledge path registered twice is `E_DUPLICATE_KNOWLEDGE`. `use mission`, `use system`, `use process` and `use knowledge` are all `E_UNSUPPORTED_LAYER`, because project memory is not a layer.

A group may not be named `contract`, `mission`, `priority`, `knowledge`, `ruling`, `system`, `responsibility`, `seam`, `role`, `policy`, `flow`, `step`, `runtime` or `task` (`E_RESERVED_GROUP`): each of those prefixes names a kind of canonical identity, so a group of that name would make `seam::x` mean two things. Use `as <name>` to give such a contract another group.

## Canonical identities

Every object BlaBla can explain has exactly one identity, and the command that displays an object prints that identity, so a caller never constructs one.

| Identity | Object |
| --- | --- |
| `contract::<group>` | one contract: its path, its state and the canonical id of every rule it owns |
| `<group>::<label>` | one rule |
| `mission::<name>` | the project's mission: its statement, its priorities and its non-goals |
| `priority::<name>` | one priority and what it outranks |
| `knowledge::<pack>` | one knowledge pack: its purpose and the canonical id of every ruling it holds |
| `ruling::<pack>::<name>` | one ruling, in full |
| `system::<name>` | one system from system memory |
| `responsibility::<name>` | one responsibility, and the system that owns it |
| `seam::<name>` | one seam, the value that crosses it and what moves with it |
| `role::<name>` | one role from process memory, what it owns and the policies that bind it |
| `policy::<name>` | one policy and the roles it applies to |
| `flow::<name>` | the development loop: one line per step, in order |
| `step::<name>` | one step, the flow it belongs to, the roles that carry it and its command |
| `runtime::<name>` | one BlaBla-controlled runtime primitive |

`ruling::<pack>::<name>` is the one identity with three segments, and it carries its pack deliberately: two reusable packs written by different authors may both declare `smallest-correct-change`, and a consuming project that registers both must not become invalid over a name collision neither author could have foreseen. Ruling names are unique inside a pack and free to repeat between packs.

`blabla status` lists every `contract::<group>`, `mission::<name>`, `knowledge::<pack>`, `system::<name>` and `role::<name>` the project has, including when every rule is GREEN, so `status` → coarse identity → `explain` → finer identity → `explain` reaches any rule, priority, ruling, responsibility, seam or policy without guessing a separator.

A name that is not one of these is a convenience, not an identity: a unique rule label still resolves, a group name alone answers with `blabla explain contract::<group>` (`E_COARSE_IDENTITY`), an ambiguous name answers with the canonical commands it matched (`E_AMBIGUOUS_RULE`), and a name that matches in more than one namespace is refused rather than resolved to one of them (`E_AMBIGUOUS_IDENTITY`).

## Project memory

`mission "path"`, `system "path"`, `process "path"` and `knowledge "path"` register authored project memory. All four are written in BlaBla's own `.bla` syntax: a declaration keyword, a quoted name and a brace block of fields.

```text
mission "blabla" {
    statement "Move the project reasoning an agent needs out of transient chat context and into executable, queryable project memory."
    non_goals ["Replace frontier models.", "Enforce Mission, Knowledge or Process."]
}

priority "truthful-over-convenient" { statement "…" }

knowledge "engineering" { purpose "Scope, duplication, abstraction and falsification." }

ruling "reuse-before-reinvention" {
    pack "engineering"
    statement "Before adding an implementation, establish whether the capability already exists…"
}

system "structure-providers" {
    purpose "Turn one source file of one language into ModuleFacts, without executing it."
    paths ["src/structure/python.rs", "src/structure/rust.rs"]
}

responsibility "inspect-source" { owner "structure-providers"  statement "…" }

seam "provider" {
    between ["structure-eval", "structure-providers"]
    value "ModuleFacts"
    statement "…"
    moves_with ["src/structure/mod.rs", "docs/structure.md"]
}

role "worker" {
    purpose "Carry out one bounded task inside the write scope its orchestrator assigned."
    owns ["the smallest correct edit inside its write scope"]
    verification "focused"
    model "qwen3.5:4b"
}

policy "explicit-write-scope" { statement "…"  applies_to ["worker"] }

flow "development" { purpose "One bounded change, from recovering what the project already decided through to the gate." }

step "assign" {
    flow "development"
    role ["orchestrator"]
    statement "Record the bounded task before the work starts."
    command "blabla task open <name> --role worker --scope <path> --deliverable <path>"
}
```

Each kind answers one question, and none of them repeats another's content.

| Memory | Declares | Answers |
| --- | --- | --- |
| Mission | `mission`, `priority` | why this matters to the project and the owner |
| System | `system`, `responsibility`, `seam` | what part of the project is being touched |
| Process | `role`, `policy`, `flow`, `step` | who is expected to do what, in what order, and when knowledge is consulted |
| Knowledge | `knowledge`, `ruling` | the expertise itself, reusable across projects |

A role's `owns` is orchestration authority and has nothing to do with a `responsibility::<name>`.

**A flow is the order the roles are meant to be used in.** `flow` carries only a `purpose`; its steps are separate `step` declarations naming the flow they belong to, and their order in the file is the flow's order. A step takes `flow`, `role` (every role that may carry it) and `statement`, plus an optional `command`. A flow that declares no step is invalid, and a step naming an undeclared flow or role makes the process memory invalid, with each cause reported separately. `explain flow::<name>` prints one line per step — its identity, its roles and its command, never its statement — and `explain step::<name>` carries the statement, the same asymmetry a pack has with its rulings. A `command` names the command that carries the step.

**Routing points into Knowledge and never out of it.** A system names the packs its work commonly needs; a role or a policy names the packs it is expected to consult:

```text
system "structure-eval"          { …  knowledge ["testing"] }
role   "worker"                  { …  consult ["engineering", "testing"] }
policy "verification-ownership"  { …  consult ["testing"] }
```

The two field names carry different claims and are not collapsed into one: `knowledge` on a system says these packs are relevant here, `consult` on a role or policy says you are expected to read them. A `ruling` has exactly two fields, `pack` and `statement`, and nothing in a pack can name a system, a role, a contract or a path — which is what makes a pack portable between projects and why reuse needs no registry, no versions and no fetcher. Mission carries no routing field at all.

A `knowledge` or `consult` entry naming a pack no registered knowledge memory declares makes the **referring** memory `invalid`, and the message says which cause it is: no knowledge memory registered, or no pack of that name declared. There is no warning state — a routing pointer that resolves nowhere fails the way an unevaluable structure fact is ERROR rather than a satisfied `forbid`.

**Mission is authoritative about intent, not a gate.** It says what the project is for and what decides a tradeoff, and a planner that finds the evidence points elsewhere is expected to say so. **Knowledge is expertise, never permission to widen a task** — scope comes from the assignment and from `role::<name>`.

A project registers at most one mission file, one system file, one process file, and any number of knowledge files. Every knowledge file is parsed separately, so a diagnostic names the file it came from, and the packs then form one knowledge memory for the project.

- None is **a layer**. `OVERALL` is decided by the active completion layers alone, and no state of any project memory — unregistered, missing, unreadable or invalid — changes it.
- Each is **validated within project memory**: syntax, required and unknown fields, duplicate fields, identity-safe names, and references (a responsibility owner and each seam side name a declared system; each `applies_to` names a declared role; each `ruling` names a declared pack; each `knowledge` and `consult` entry names a registered pack). **Project memory is never checked against the repository** — that half is what keeps it out of completion and out of a false RED. An unknown declaration or field is an error, never ignored.
- Exactly **one `mission` declaration** per project; a second is an error naming the first. Ruling names are unique inside a pack; pack names are unique across every registered knowledge file. A pack that declares no ruling is invalid, because routing would point at nothing.
- A **name must be identity-safe** — it starts with a letter or digit and continues with letters, digits, `_` or `-` — because it becomes part of a canonical identity. `purpose`, `statement`, `paths`, `verification` and `model` are ordinary text.
- **`verification` and `model` are opaque strings.** BlaBla keeps no enum of verification tiers and no enum of models, and infers nothing about either. `model` records the topology a project chose, so an orchestrator does not silently substitute a different one.
- **Process memory describes the intended authority and workflow.** `status` lists its roles, and every role and policy view names what binds the role that carries the work.
- **Registration is explicit.** A `mission.bla`, `system.bla`, `process.bla` or a `.bla` file under `knowledge/` that no statement registers is not read; `status` reports it as `unregistered` and names the statement that would register it. There is no JSON fallback: a registered path ending in `.json` is reported as unreadable with that reason.
- **A knowledge path may point outside the project.** `knowledge "../shared-knowledge/engineering.bla"` is how one pack is reused across projects; there is no registry and nothing is fetched. A pack outside the manifest root is not walked by the implementation fingerprint and is not seen by a public-tree audit, so editing an in-root pack marks the behavior record STALE while editing an out-of-root one does not. Both are false STALEs at worst, which the project accepts, but the asymmetry is real.
- `status` reports `state` as `present`, `missing` (registered, no file there), `unreadable`, `invalid` or `unregistered`.
- `blabla check <file.bla>` validates a memory file while it is being authored and reports **VALID** or **INVALID**. It is not a completion signal and implies no enforcement; `status` and `finish` remain the authority over the project.
- `blabla guide memory` is the authoring procedure in short form: what each kind answers, the declaration and registration shape, the direction routing runs, and the authoring loop. This document is its full reference, and the guide exists so that authoring does not begin by loading this document.

## Discovery

Commands without a file argument use the nearest `project.bla` above the working directory; `--project <file|dir>` overrides discovery. Nested projects are independent.

## Layers and completion

```text
BEHAVIOR   GREEN | YELLOW | RED | UNVERIFIED | STALE | VERIFYING | INTERRUPTED | none declared
STRUCTURE  GREEN | RED | ERROR | none declared
OVERALL    GREEN only when every active layer is GREEN and the behavior record is fresh and canonical
```

- The behavior layer is the record written by the last `blabla finish` (or project `run`) to `.blabla/status.json`. It is fresh while the active behavior contracts, the implementation tree, the files named on the command line, the profile and the verifier version are unchanged; otherwise STALE. A GREEN produced with other settings is `not canonical`. A false STALE is acceptable; a stale GREEN is not.
- The structure layer is evaluated live on every call and never recorded as current; `finish` stores the result it saw inside the record for audit only. `blabla check <contract.bla>` evaluates one structure contract on its own against the real project root while it is being authored, and `blabla check --falsify <contract.bla>` asks whether each of its rules can be made to fail; both are authoring checks, neither is a completion signal, and neither writes anything.
- `blabla finish` writes `.blabla/verifying.json` (run id, pid, start time, project and profile identity) before the campaign and removes it after the record. `status` reports VERIFYING while that process is alive and was started when the marker says, INTERRUPTED otherwise; both block completion, and a new `finish` replaces an interrupted marker.

Exit codes of `status` and `finish`: 0 OVERALL GREEN; 1 a RED layer; 2 contract or manifest error; 3 structure provider unavailable or application failure; 4 internal; 5 any other BLOCKED state. `--json` exposes `state` (behavior), `structure`, `overall` and `completion` so agents never parse English.
