# BlaBla

**Executable project memory for coding agents.**

[![CI](https://github.com/Kiborgik/blabla/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Kiborgik/blabla/actions/workflows/ci.yml)
![status: experimental alpha](https://img.shields.io/badge/status-experimental%20alpha-orange)
![version 0.5.0-alpha](https://img.shields.io/badge/version-0.5.0--alpha-blue)
![license MIT](https://img.shields.io/badge/license-MIT-green)
![Rust stable](https://img.shields.io/badge/rust-stable-black)
![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22761364.svg)](https://doi.org/10.5281/zenodo.22761364)

Coding agents are good at making changes. The hard part is carrying every old requirement, edge case and architecture decision through a long project or a fresh session.

BlaBla moves the parts that matter into small executable contracts. Agents can ask what is wrong, inspect one rule at a time, and use `blabla finish` as a completion gate instead of reconstructing the whole project from chat history.

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

BlaBla currently has two contract layers:

- **`behavior.bla`** describes observable runtime behavior: state, actions, postconditions and invariants.
- **`structure.bla`** describes static codebase boundaries: modules, symbols, dependencies and literal collections.

`project.bla` composes them and defines the canonical verification profile.

The normal agent workflow is deliberately small:

![BlaBla agent workflow: AGENTS.md points the agent to blabla status; status names the layer and rules needing attention; blabla explain shows one rule and its evidence; the agent edits ordinary code and runs blabla finish; only OVERALL GREEN means completion.](docs/assets/agent-workflow.svg)

```text
blabla status
blabla explain <rule>
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

v0.5 ships one structure provider: Python. It parses source with Python's `ast` module in an isolated interpreter and never imports or executes project code.

Full reference: [docs/structure.md](docs/structure.md).

## Quick start

Requirements: stable Rust and Python 3.10+ on `PATH`.

Install the published prerelease. The explicit version is required because `0.5.0-alpha` is a prerelease:

```bash
cargo install blabla --version 0.5.0-alpha
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
blabla 0.5.0-alpha
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

The two contracts are small: [`examples/todo.bla`](examples/todo.bla) for behavior and [`examples/todo/structure.bla`](examples/todo/structure.bla) for structure.

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

More detail: [project](docs/project.md) · [agent workflow](docs/agent-workflow.md) · [language](docs/language.md) · [structure](docs/structure.md)

## A first experiment

The original motivation was context and handoff drift, so I tested BlaBla on one synthetic project across four fresh Haiku sessions. All three conditions received the same underlying intent in different forms:

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

The important caveat: this is **one model, one synthetic project, one chain per condition**. It is an observation worth reproducing, not a statistical claim. The token difference came mainly from fewer turns and verification loops, not from shaving a few KB off the first prompt.

The benchmark also directly motivated the structure layer: one condition kept passing every runtime check while violating the requested persistence shape. Behavior alone could not see it.

Methodology, prompts, scorers and results: [docs/research.md](docs/research.md) and [research/](research/).

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
- the structure provider is Python-only in v0.5
- structural facts are limited to modules, symbols, dependencies and literal collection membership
- dynamic Python imports/attributes and non-literal values may be invisible
- adapter observations are trusted
- no distributed/temporal verification
- no process or mission layer yet
- v0.5.0-alpha has limited external testing; language and JSON/CLI APIs may change

## Roadmap

No dates. Current directions: more structure providers, benchmark replication, higher-level process/orchestrator contracts, and mission-level executable intent.

## Contributing

False GREEN reports are especially useful: if BlaBla says GREEN while a declared rule is actually violated, please open an issue with the contract, profile/seed, version, platform and a minimal reproduction if possible.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Citation

See [CITATION.cff](CITATION.cff).

## License

MIT — see [LICENSE](LICENSE).
