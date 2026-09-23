# BlaBla

**Executable, queryable project memory for coding agents.**

[![CI](https://github.com/Kiborgik/blabla/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Kiborgik/blabla/actions/workflows/ci.yml)
![status: pre-1.0](https://img.shields.io/badge/status-pre--1.0-yellow)
![version 0.8.0](https://img.shields.io/badge/version-0.8.0-blue)
![license MIT](https://img.shields.io/badge/license-MIT-green)
![Rust stable](https://img.shields.io/badge/rust-stable-black)
![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22761364.svg)](https://doi.org/10.5281/zenodo.22761364)

Coding agents can change code quickly. The harder problem is carrying project intent, architecture, constraints and unfinished findings across fresh sessions and different models.

BlaBla keeps that information in the repository. Agents enter through `blabla status`, follow canonical identities with `blabla explain`, work inside a bounded task when the project uses that workflow, and finish against deterministic project evidence instead of reconstructing the project from chat history.

BlaBla has two executable completion layers, Behavior and Structure, plus four queryable memory kinds: Mission, System, Process and Knowledge. Project memory informs the work; it does not decide completion.

![BlaBla concept: human intent becomes project.bla composing behavior and structure contracts; a coding agent reads them through blabla status and explain, writes an ordinary implementation, and runs blabla finish, which reports OVERALL GREEN only when every active contract is satisfied.](docs/assets/concept.svg)

## What it looks like

```text
$ blabla status

Project:   GlyphVault

BEHAVIOR   54/54 rules  GREEN
STRUCTURE  47/47 rules  GREEN
OVERALL    GREEN

Completion:  GREEN
```

Break an architecture rule while leaving runtime behavior intact:

```text
$ blabla status

BEHAVIOR   54/54 rules  GREEN
STRUCTURE  45/47 rules  RED
OVERALL    BLOCKED

Structure violations:
  RED    architecture::no-domain-restart    glyph_vault/domain.py:86 defines VaultDomain.restart
  RED    architecture::no-protocol-restart  glyph_vault/protocol.py:4 ARGUMENTS contains "restart"

Next:
  blabla explain architecture::no-domain-restart
```

Those are abridged outputs from the included Glyph Vault fixtures.

## The idea

Two kinds of thing live in a BlaBla project, and the difference matters.

| Kind | Purpose |
| --- | --- |
| Mission | project purpose, priorities and non-goals |
| System | architecture, responsibilities and seams |
| Process | roles, policies and development flows |
| Knowledge | reusable engineering/project expertise |
| Structure | executable static-code invariants |
| Behavior | executable runtime invariants |

Structure and Behavior are checked and decide completion. Mission, System, Process and Knowledge are queried; they inform the work and never reach `OVERALL`.

`project.bla` composes the contracts, registers the memory, and defines the canonical verification profile.

The normal agent workflow is deliberately small:

![BlaBla agent workflow: AGENTS.md points the agent to blabla status; status names the layer and rules needing attention; blabla explain shows one rule and its evidence; the agent edits ordinary code and runs blabla finish; only OVERALL GREEN means completion.](docs/assets/agent-workflow.svg)

```text
blabla status
blabla explain <group>::<label>
# edit ordinary application code
blabla finish
```

The agent does not need to load every contract. `status` points at the relevant rule; `explain` expands only that rule; `finish` decides whether the declared project state is complete.

## GREEN, YELLOW, RED

| State | Meaning |
| --- | --- |
| **GREEN** | active declared obligations were exercised and satisfied under the configured verifier |
| **YELLOW** | no violation was found, but required behavioral coverage is still missing |
| **RED** | a declared behavioral or structural rule was violated |
| **BLOCKED** | overall completion is not allowed because some layer is not GREEN |

`GREEN` is not a mathematical proof. Behavior verification is bounded and heuristic. It says the declared obligations were exercised and satisfied under the project’s configured campaign.

## Behavior contracts

A behavior contract describes what must be observable, not how the application implements it.

```text
type Todo { id: int, text: string, done: bool }

state todos: [Todo]

action add(text: string)
action complete(id: int)
action restart()

when add {
    expect "empty-add-noop": input.text != "" or after.todos == before.todos
    expect "add-count":      input.text == "" or count(after.todos) == count(before.todos) + 1
}

when restart {
    expect "persistence": after.todos == before.todos
}

always "unique-ids" { unique(todos, t => t.id) }
never  "empty-text" { any(todos, t => t.text == "") }
```

The verifier generates action sequences, tracks whether meaningful branches were actually exercised, and shrinks failures while preserving the failing rule. `action restart()` is a BlaBla-controlled process restart; `blabla explain runtime::restart` shows its exact semantics.

Full reference: [docs/language.md](docs/language.md).

## Structure contracts

Structure contracts cover codebase facts that runtime behavior cannot see.

```text
module model  "glyph_vault/model.py"
module domain "glyph_vault/domain.py"
module store  "glyph_vault/store.py"

require "durable-fields":              symbol model::DURABLE_FIELDS
forbid  "domain-independent-of-store": dependency domain -> store
forbid  "domain-no-json":              dependency domain -> "json"
require "durable-keeper":              value model::DURABLE_FIELDS contains "keeper"
forbid  "id-is-the-key":               value model::DURABLE_FIELDS contains "id"
forbid  "no-domain-restart":           symbol domain::VaultDomain.restart
```

Structure providers are chosen by file extension. Python is parsed with Python's own `ast` module in an isolated interpreter; Rust is parsed in-process with `syn`; TypeScript and JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`), Go (`.go`), Java (`.java`), C (`.c`) and C++ (`.h`, `.hpp`, `.hh`, `.hxx`, `.cpp`, `.cc`, `.cxx`) are parsed in-process with tree-sitter, all five sharing one parse harness. None imports or executes project code, and none adds a fact — a provider adds a language. A module in any other language is ERROR for every rule that names it, and `blabla status` prints the live list rather than a copy of it.

Every provider answers three ways, not two: found, established absent, and unknown. Unknown is ERROR. That third answer is what stops a `forbid` from passing through analysis blindness where a language can hide a reference — two Go or Java files in one package need no import between them, a Java wildcard import can supply any type in its package, a C `#include` may sit on a path the build system supplies, a dynamic `import()` of an expression could resolve anywhere. An unknown names the one declared module it could be hiding wherever the provider can bound it, so it makes exactly those rules ERROR and leaves every other dependency on that module decidable.

`blabla check --falsify` asks a second question: can each rule actually be made to fail? A rule that reports `VACUOUS` is GREEN for a reason unrelated to the project.

Full reference: [docs/structure.md](docs/structure.md).

## Project memory

Contracts say what must remain true. Project memory says the rest of what an agent would otherwise be told in chat, and it is queried rather than read whole.

| Memory | Declares | Answers |
| --- | --- | --- |
| Mission | `mission`, `priority` | why the project exists and what decides a tradeoff |
| System | `system`, `responsibility`, `seam` | what part is being touched and who owns it |
| Process | `role`, `policy`, `flow`, `step` | who is expected to do what, and in what order |
| Knowledge | `knowledge`, `ruling` | reusable expertise, portable between projects |

```text
mission   "mission.bla"
system    "system.bla"
process   "process.bla"
knowledge "knowledge/engineering.bla"
```

```text
blabla status                                       every declared kind and its state
blabla explain system::cli                          one system, its responsibilities and its seams
blabla explain knowledge::testing                   a pack's purpose and the id of every ruling in it
blabla explain ruling::testing::read-the-whole-run  one ruling, in full
```

Surveying a pack costs one line per ruling; reading a ruling costs one more `explain`. An agent loads the entry it needs, not the file.

Project memory is validated within itself, never against the repository, and never reaches `OVERALL`. A project that declares none of it is not thereby incomplete. Process policies and flows are advisory: BlaBla describes the intended authority and does not enforce it. The task commands enforce the recorded hand-back and close prerequisites, the permitted models on `addressed`, `resolve`, `attribute` and `deliverable --remove`, and a few declaration rules: no ignored deliverable or input, no attribution of an unchanged path, no change to a closed record.

`blabla guide memory` is the authoring procedure; `blabla check <file>.bla` validates a memory file while it is still being written. Full reference: [docs/project.md](docs/project.md).

## The development loop

A project that wants it can describe how work moves between agents:

```text
status → explain relevant memory → task → accept → implement → declared check
       → challenge → hand-back → review/findings → integrate → close → finish
```

Process declares that flow as ordered `flow` and `step` entries. It describes the loop; it does not schedule work or launch agents.

A **bounded task** carries one change across a handoff: the paths it may write, the deliverables it owes, and the findings raised against it. Tasks live under `.blabla/tasks/` as transient machine state — not authored memory, not validated for truth, not part of completion.

`blabla challenge` checks that recorded account against evidence BlaBla already holds and reports one concrete discrepancy, such as a deliverable that never changed or a finding left unresolved. For a selected ACCEPTED task it records or clears the explicit assignment challenge receipt; a project-only inspection remains nonmutating. It is a deterministic check, not a semantic code reviewer, and it does not change what `finish` decides or what it exits with.

```text
blabla status
blabla explain flow::development
blabla task open <name> ...              orchestrator: scope, deliverables and the check that covers it
blabla task accept <name> --model <id>   worker: take the assignment before changing anything
# implement, run the declared check, then record what the whole run reported:
blabla task evidence <name> --exit <code> --tool <tool>
blabla challenge <name>
blabla task ready <name>                 hand back; closing is the orchestrator's decision
blabla task close <name> --model <id>    refused while a grounded challenge stands
blabla finish
```

`blabla task show <name>` prints those routes for one assignment, and `blabla guide loop` prints the same routes from the same source. Tasks render `OPEN`, `ACCEPTED`, `BLOCKED`, `READY` or `CLOSED`. Evidence is accepted only in ACCEPTED; READY requires current successful declared evidence plus an explicit assignment challenge receipt tied to the task's own paths. An edit inside the write scope, the deliverables or the declared inputs, new evidence, findings or policy metadata invalidate that receipt, so a READY worker accepts again before changing anything; an edit anywhere else, including a path attributed to concurrent work, leaves it standing. Project verification and task acceptance are different questions: `finish` decides whether the project is complete, while task transitions decide whether one handoff is ready for review.

The classes it can report, and their limits: [docs/agent-workflow.md](docs/agent-workflow.md).

## Quick start

Requirements: stable Rust, plus Python 3.10+ on `PATH` if a structure contract names a `.py` module.

Install the published release:

```bash
cargo install blabla
```

Or build from source:

```bash
git clone https://github.com/Kiborgik/blabla.git blabla
cd blabla
cargo build --release
```

The binary is `target/release/blabla` (`blabla.exe` on Windows).

```text
$ blabla --version
blabla 0.8.0
```

### Try the Todo example

```text
$ cd examples/todo
$ blabla status

BEHAVIOR   UNVERIFIED
STRUCTURE  6/6 rules  GREEN
OVERALL    BLOCKED

Next:
  blabla finish
```

```text
$ blabla finish

COMPLETION GATE: VERIFYING
...
BEHAVIOR   14/14 rules  GREEN
STRUCTURE  6/6 rules   GREEN
OVERALL    GREEN

COMPLETION GATE: GREEN
```

The two contracts are small: [`examples/todo.bla`](examples/todo.bla) for behavior, shared by every language, and [`examples/todo/todo-python.bla`](examples/todo/todo-python.bla) for structure, which lives beside the Python sources it names. **The same behavior contract is satisfied by six applications in six languages** — Python, [TypeScript](examples/todo-ts), [Go](examples/todo-go), [C](examples/todo-c), [C++](examples/todo-cpp) and [Java](examples/todo-java) — each with its own structure contract. Each application holds only storage, domain logic and a table of actions; the JSON Lines loop lives once per language in [`adapters/`](adapters/README.md) and is copied or imported, never rewritten.

A compiled application is built by the profile's `prepare` command before anything is launched, so a cold build never runs inside the per-response timeout:

```text
verify behavior {
    prepare ["go", "build", "-o", ".blabla/todo-go", "."]
    command [".blabla/todo-go"]
    timeout_ms 1000
}
```

### Start a project

```text
blabla init --agents --command python ./main.py
blabla status
```

`init` creates `project.bla`, a draft behavior contract, a small managed BlaBla block in `AGENTS.md`, and a portable agent skill. It does not overwrite existing files. Drafts are checked but do not count toward completion until they are promoted to active contracts.

## How it works

![BlaBla architecture: project.bla composes behavior and structure contracts; behavior contracts compile to typed IR and are checked by a coverage-guided verifier against the application; structure contracts compile to structure IR and are evaluated through a language provider; status, explain and finish expose both layers.](docs/assets/architecture.svg)

A project manifest is mostly composition plus one canonical behavior profile:

```text
project GlyphVault

use behavior  "contracts/behavior/core.bla"
use behavior  "contracts/behavior/persistence.bla"
use structure "contracts/structure/architecture.bla"

verify behavior {
    command ["python", "glyph_vault/main.py"]
    seed 0
    cases 1
    steps 4096
    timeout_ms 1000
    shrink_budget 256
}
```

`blabla status` finds the nearest `project.bla`. `blabla finish` runs the canonical profile, evaluates structure live, and exits 0 only when every active layer is GREEN. Long runs print progress and an interrupted verification never leaves a current GREEN behind.

The behavior adapter is a small synchronous JSON Lines protocol (`reset`, `call`, `observe`). Logs go to stderr. Protocol errors, crashes and timeouts are reported separately from contract violations.

More detail: [architecture](docs/architecture.md) · [project](docs/project.md) · [agent workflow](docs/agent-workflow.md) · [language](docs/language.md) · [structure](docs/structure.md)

## Experiments

[docs/research.md](docs/research.md) records several: an earlier small-model diagnostic, whose lasting result was the GREEN/YELLOW distinction rather than a score; the rules a memory-utility comparison follows; and the historical handoff benchmark below, which carries stated limits.

The current Claude Code and Codex smoke suite is a separate diagnostic. Eleven cases use the
same `evals/materials.py` builder and shared material: navigating project memory, repairing
structure in Python, Rust, TypeScript, Go, Java and C, carrying an assignment and reporting one
that cannot be done, repairing behavior from a recorded counterexample, diagnosing YELLOW,
repairing an adapter protocol fault, and reviewing a hand-back. Orchestrator work is not given to
the small models, so bootstrapping, recovery and project-wide falsification go unmeasured. The subjects are small local
models, `qwen3.5:4b` as worker and `qwen3.5:9b` as reviewer, run through both hosts with and
without BlaBla. Both hosts stage fresh source builds, capture fixture inputs outside the subject
workspace, and use the same case contract and grading logic. It measures observed agent behavior
per criterion, with the unmeasured capabilities named; it does not replace product gates or turn a
campaign into a model ranking. See [evals/README.md](evals/README.md) for commands and limitations
and [evals/findings.md](evals/findings.md) for what preparing the suite found.

The two arms are with BlaBla and without BlaBla, on the same project: both carry the same
`README.md` stating the project's rules in plain prose, as an ordinarily documented repository
would. With BlaBla, the agent also has the manifest, the contracts, the task record, the
onboarding block, the skill and the CLI; without it, the same job is stated in plain language and
nothing of BlaBla is in the workspace or on the PATH. The comparison is made on the outcome checks both arms can face, and on time, tool
actions and tokens; the BlaBla workflow checks are scored on the BlaBla side only. Cases that
only exist with BlaBla, a hand-back, a review, a YELLOW diagnosis, have no control arm.

The original motivation was context and handoff drift, so the historical benchmark tested one synthetic project across four fresh Haiku sessions. All three conditions received the same underlying intent in different forms:

- **A:** growing full prose: requirements, architecture and recorded decisions
- **B:** a maintained compact human summary
- **C:** a small `AGENTS.md` onboarding block; the repository carried the contracts and completion gate

A hidden scorer checked 106 behaviors at the final stage, plus architecture independently.

| Condition | Behavior | Architecture | Aggregate input tokens | Cost | Turns | Tools |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Full prose | 106/106 | PASS | 8.55M | $1.78 | 181 | 177 |
| Human summary | 106/106 | FAIL from stage 3 | 6.57M | $1.45 | 160 | 156 |
| BlaBla | 106/106 | PASS | 2.51M | $0.62 | 91 | 86 |

In this run, the BlaBla condition used about **29% of the aggregate input tokens, 35% of the cost, 58% of the wall time, and roughly half the turns/tools** of the full-prose condition while preserving behavior and architecture with zero regressions.

The important caveat: this is **one model, one synthetic project, one chain per condition**, with project, contracts, prose and summaries written by the same author. It is an observation worth reproducing, not a statistical claim. The token difference came mainly from fewer turns and verification loops, not from shaving a few KB off the first prompt.

The benchmark also directly motivated the structure layer: one condition kept passing every runtime check while violating the requested persistence shape. Behavior alone could not see it.

Methodology, prompts, scorers and results: [docs/research.md](docs/research.md) and [research/](research/).

For active Claude Code and Codex integration smoke tests, see [evals/README.md](evals/README.md).
These small local runs triage onboarding and workflow failures; their [findings](evals/findings.md)
are separate from published research, and raw traces and workspaces stay out of Git.

## What BlaBla is not

- not a replacement programming language
- not a theorem prover
- not a guarantee of arbitrary software correctness
- not an agent orchestration framework
- not a replacement for ordinary tests
- not Spec Kit: it does not generate plans or implementation code

It is a small executable boundary around the parts of project intent you choose to declare.

## Current limitations

- behavior verification is bounded and heuristic
- behavior absent from the contracts is not verified
- structure inspects Python, Rust, TypeScript and JavaScript, Go, Java, C and C++; a module in any other language is ERROR for every rule naming it
- structural facts are limited to modules, symbols, dependencies, literal collection membership and key/payload association
- dynamic Python imports/attributes and non-literal values may be invisible
- Rust structure does no name or type resolution, no re-export or alias chasing and no macro expansion; a `use` route that reaches no file and leaves more than one segment is an unknown scoped to the module it could be hiding rather than a guessed edge, so rules naming that module are ERROR
- TypeScript structure does no type resolution, resolves no `tsconfig` path aliases, follows no re-export chain beyond one direct `export ... from`, and inspects neither namespaces nor decorators
- Go structure reads no build tags and no cgo, and a reference between two files of one package is an unknown rather than an absent dependency
- Java structure reads no classpath, no reflection and no annotation processing; a wildcard import and a same-package reference are unknowns
- C and C++ structure runs no preprocessor: both arms of an `#ifdef` contribute symbols, a macro-generated declaration is invisible, `-D` and `-I` are unknown, and a header whose brace is opened in one preprocessor conditional and closed in another is unparseable
- a `dependency` rule whose target module lies outside the project root cannot be observed, because the name it would be matched against is the target's path from the manifest directory
- a scalar constant cannot be contracted; `value` reads literal collections, not single values
- adapter observations are trusted
- no distributed/temporal verification
- project memory is validated only within itself: it is never checked against the repository, never reaches `OVERALL`, and Process policies and flows are advisory rather than enforced
- a challenge sees only what was recorded: an unopened task, an undeclared deliverable and an unwritten finding are all invisible to it
- process containment is tested on Windows and Linux in CI; macOS is untested
- BlaBla is pre-1.0 with limited external testing: a change to contract syntax, CLI options, JSON fields or exit codes ships only in a minor release and is listed under **Breaking** in `CHANGELOG.md`; a patch release never makes one

## Roadmap

No dates. Current directions include improving the development-loop handoff, evaluating where smaller models are useful, reproducing the project-memory results on more projects and models, and adding structure providers only where they expose useful invariants.

## Contributing

False GREEN reports are especially useful: if BlaBla says GREEN while a declared rule is actually violated, please open an issue with the contract, profile/seed, version, platform and a minimal reproduction if possible.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Citation

See [CITATION.cff](CITATION.cff).

## License

MIT — see [LICENSE](LICENSE).
