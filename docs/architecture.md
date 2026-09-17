# Architecture

The current implementation, so that a later restructuring does not have to be reconstructed from source. This describes what exists. It invents no future layer.

Three concerns live in this repository. Keeping them apart is the point of the layout: only one of them decides completion.

## Authored project memory

```text
project.bla  ->  src/memory/*  ->  Mission | System | Process | Knowledge
                                            |
                                   status | explain
```

Registered by the manifest, parsed and validated within project memory, never checked against the repository. It answers what the project is for, how it is divided, who does what and what expertise applies. **It does not participate in `OVERALL`.**

## Completion

```text
                          blabla (src/main.rs -> src/cli)
                                      |
                        project layer (src/project)
                     manifest, discovery, composition,
                     identity, fingerprint, run state
                        /                        \
        BEHAVIOR pipeline                     STRUCTURE pipeline
        src/syntax                            src/structure/syntax.rs
            |  parser                              |  parser
        src/semantics                         structure IR
            |  checking, project composition       |
        src/ir                                src/structure/mod.rs
            |  typed contract IR                   |  rule evaluator
        src/verify                            Provider trait
            |  coverage-guided campaign        /            \
        src/application (Application trait)  python.rs      rust.rs
            |  adapter boundary               |               |
        src/runtime                          isolated        syn,
            process, JSON Lines, containment  interpreter    in-process
                        \                        /
                          src/report, src/project/status.rs
                                      |
                                  completion
```

The two pipelines are independent. They meet only in the project layer, which composes both into one completion answer, and in the report layer, which renders both.

## Development state

```text
.blabla/tasks/*.json  <->  src/project/task.rs  ->  src/skeptic.rs  ->  blabla challenge
```

A bounded task is machine state written by BlaBla: write scope, deliverables, findings and the tree snapshot a task opened against. The skeptic reads that record plus the current tree, the completion state and a falsification verdict, and forms at most one grounded challenge. **This is neither authored memory nor a completion layer.**

## CLI surfaces

```text
status | explain | check | run | finish | task | challenge | guide | init
```

## Components

| Path | Responsibility |
| --- | --- |
| `src/main.rs`, `src/cli/mod.rs` | argument parsing (`Cli`, `Command`), single-file commands, JSON and human emission, and `run_guarded`, which turns an internal panic into exit 4 instead of a behavioral failure |
| `src/cli/project.rs` | the project-mode commands: `status`, `explain`, `check`, `finish` |
| `src/cli/task.rs` | the `task` subcommands and the `challenge` rendering |
| `src/memory/mod.rs`, `syntax.rs` | the shared `.bla` memory parser, the `Memory<T>` states and the field/reference validation every kind reuses |
| `src/memory/mission.rs`, `system.rs`, `process.rs`, `knowledge.rs` | one memory kind each: its declarations, its validation and its `status` and `explain` views |
| `src/memory/routing.rs` | the one-way references from System and Process into Knowledge packs |
| `src/project/task.rs` | the bounded task record: scope, deliverables, findings, the tree snapshot and the per-file digests it is compared against |
| `src/skeptic.rs` | the challenge classes, the evidence they rest on and the single grounded challenge chosen from them |
| `src/cli/guide.rs`, `src/cli/init.rs` | the canonical onboarding texts, and project scaffolding including the managed `AGENTS.md` block and the portable skill |
| `src/cli/heartbeat.rs` | progress lines during a long campaign, through an observer that leaves the logical campaign untouched |
| `src/project/mod.rs` | `Manifest`, `Profile`, `Project`; manifest parsing, upward discovery, multi-contract composition, rule identity, command resolution, and the FNV-1a implementation fingerprint |
| `src/project/status.rs` | the status record, the layer views and the completion computation |
| `src/project/runstate.rs` | the `.blabla/verifying.json` marker: run id, pid, start time, project and profile identity |
| `src/syntax/mod.rs` | the behavior parser, producing a syntax AST |
| `src/semantics/mod.rs` | semantic and type checking; compiles a list of units against one project environment, so single-file compilation is the one-unit case |
| `src/ir/mod.rs` | the typed, normalized contract IR |
| `src/verify/mod.rs` | executes multi-action sequences with fresh before and after observations, checks rules, and shrinks failures |
| `src/verify/coverage.rs` | derives stable semantic obligations from typed expressions and labels |
| `src/verify/campaign.rs`, `generator.rs`, `corpus.rs`, `evaluator.rs` | campaign loop, seeded generation with typed-literal guidance, the bounded prefix corpus, and predicate evaluation |
| `src/application.rs` | the `Application` trait: the adapter boundary |
| `src/runtime/mod.rs` | the real adapter: isolated temporary working directory per case, one JSON object per line, correlated request ids |
| `src/runtime/process_tree.rs` | process containment, Windows Job Objects and Unix process groups |
| `src/runtime/primitives.rs` | the single canonical source for BlaBla-controlled runtime primitive semantics |
| `src/structure/syntax.rs` | the structure contract parser and layer detection |
| `src/structure/mod.rs` | the structure IR, the inspection step, the rule evaluator, the `Provider` trait and the provider registry |
| `src/structure/falsify.rs` | the counterfactual fact map and the per-rule falsification verdict behind `blabla check --falsify` |
| `src/structure/python.rs`, `python_facts.py` | the Python provider and its embedded extractor |
| `src/structure/rust.rs` | the Rust provider |
| `src/report.rs`, `src/diagnostic.rs` | the report and diagnostic shapes both renderings read from |

## Stable seams

Changing one of these is an interface change with consequences beyond its own file.

**`Application`** (`src/application.rs`) — `reset`, `call`, `observe`, `restart`, `finish`. Everything above it works in terms of observations, so the verifier never knows whether it is driving a real process. `restart` defaults to an `APP_LIFECYCLE` error, so an adapter that cannot provide trusted process restart says so rather than faking it.

**`Provider`** (`src/structure/mod.rs`) — `id`, `handles`, `symbol_depth`, `inspect`, `external_target_error`. A provider adds a language. It never adds a fact, and the contract grammar does not change when one is added. `handles` selects by file extension and the first match wins.

**`ModuleFacts`** (`src/structure/mod.rs`) — the fact shape every provider produces: existence, a parse error, symbols, imports, literal collections, key/payload entries, and unsupported names. It derives `Deserialize` because the Python provider delivers it as JSON over a pipe; the Rust provider constructs it directly in process. Both go through the same evaluator, so rule semantics cannot drift between languages.

**The typed IR** (`src/ir/mod.rs`) — the verifier consumes IR, never the syntax AST. Coverage obligations, failures, shrinking and rule ids are all defined over it.

**`RunReport`** (`src/report.rs`) — the human rendering and the `--json` rendering are two views of one value. Neither computes anything the other does not see.

**`Task`** (`src/project/task.rs`) — everything the skeptic knows about a change in flight crosses as this record. The skeptic reads no chat, no agent report and no diff of its own, so a challenge can rest only on what was written down at assignment and what the tree says now. A new class of challenge therefore cannot be added without first adding its evidence to the record. This is `seam::bounded-task` in `system.bla`.

**The on-disk state** — everything BlaBla writes lives under `.blabla/`:

```text
.blabla/status.json      the verifier version, project identity, implementation fingerprint,
                         application command, options and run report
.blabla/verifying.json   the in-flight campaign marker: run id, pid, start time, identities
.blabla/tasks/*.json     one bounded task record each
```

`status` compares identities and reports STALE on any difference. Structure results are stored in the record for audit only and are never read back as current. None of this is authored memory and none of it reaches `OVERALL`.

**`runtime/primitives.rs`** — every agent-facing surface renders runtime primitive semantics from this one table. No surface carries its own prose copy, and a rule's dependency on a primitive is derived from the typed IR rather than annotated in the contract.

## Three properties worth keeping

**Structure is never cached.** It is evaluated live on every `status`, `check` and `finish`. This is why a stale structure GREEN cannot exist, and it is the reason the structure pipeline needs no verification profile.

**Inspection and decision are separate steps.** `inspect` materialises one `ModuleFacts` map per invocation; `verify` decides every rule against it. Because deciding is a pure function of that map, `blabla check --falsify` can decide a rule a second time against a counterfactual map built from the same facts, with no second inspection, no subprocess and nothing written. Falsification adds no fact and no rule semantics of its own — it calls the one evaluator with a different input.

**Single-file and project modes share one path.** A project compiles a list of units against one environment; a single file is the one-unit case with bare labels. There is no second compiler, so a diagnostic cannot differ between the two modes.

## Self-hosting contracts

The repository's own `project.bla` binds six structure contracts over BlaBla's Python tooling, its structure subsystem and its skeptic. `contracts/rust.bla` constrains the seams above: the `Provider` trait and its four required methods, the provider registry, the inspected extensions, both providers' entry points, the challenge entry point, classes and evidence seam, and the layering boundaries.

The `forbid dependency` rules are what keep the three concerns apart — the structure pipeline independent of the behavior pipeline, and the skeptic below the CLI, reading no source provider and running no campaign. They are checked on every `blabla status`.
