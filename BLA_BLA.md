# BlaBla

BlaBla is executable project memory for coding agents. Important project intent becomes a compiled contract; BlaBla explores the implementation, produces minimized counterexamples when behavior breaks, checks the codebase's declared structure against the repository, and gives one honest completion signal.

This file is the **current** project authority. It carries no version history: releases are in `CHANGELOG.md`, public research evidence in `docs/research.md` and `research/`, internal dogfooding evidence in `artifacts/`.

`AGENTS.md` carries the entry path for anyone working **in this repository**: the CLI here is the working tree, reached through `cargo run --quiet --bin blabla --`, never a built or installed binary. The rest of this file, and every user-facing surface, says plain `blabla` because that is what a consumer has on PATH.

`project.bla` is the machine entry point. `blabla status` is the agent entry point: an agent entering a project learns what project it is in, what is GREEN, YELLOW, RED or ERROR, which contract owns the problem and which rule to inspect next, without reading a single contract file.

## Evidence ordering

**Agent self-reports are advisory evidence, never authoritative project state.** For any question about what is implemented or complete, prefer, in this order: the repository and working tree; deterministic tool output; `blabla status`, `check` and `finish`; test, build and compiler results; and only last, an agent's narrative.

This is a rule about which evidence to trust. It is not a permissions mechanism and it is not a layer. Correct project memory does not remove it: an agent can navigate to the right identity and still narrate a meaning the entry does not contain. Read the entry, not a summary of the entry.

Two limits on that ordering. Evidence tests claims about the implementation; it does not silently override owner intent. Mission is authoritative about what the project is for, and a planner whose evidence points elsewhere says so and names the assumption it is challenging (`policy::planner-challenges-the-plan`) rather than quietly complying or quietly overriding. And evidence does not make the verifier infallible: a GREEN is bounded by the campaign, the providers and the adapter that produced it, which is why `check --falsify` and the coverage distinction exist.

A corollary: a tool result is authoritative about what it checked, never about what it did not. `blabla check` returning GREEN proves each rule *evaluates*. It does not prove any rule *can fail*; that is a separate question, and `blabla check --falsify <contract.bla>` is the command that asks it.

## Layers

Two layers are implemented, STRUCTURE above BEHAVIOR:

```text
STRUCTURE       what must remain true of the codebase, evaluated statically from the repository
BEHAVIOR        what must remain true of the running application, verified by campaign
IMPLEMENTATION  ordinary Rust, Python, TypeScript, Go or anything else
```

**BEHAVIOR** (`docs/language.md`): `type`, `state`, `action`, `when ... expect`, `always`, `never`. State is abstract observation, not storage. The application speaks one JSON object per line behind a small adapter. Results are GREEN (every derived obligation exercised and satisfied), YELLOW (no violation, but an obligation was never exercised — **not complete**), or RED (a confirmed violation with a shrunk counterexample).

**STRUCTURE** (`docs/structure.md`): `module` bindings and labelled `require` / `forbid` rules over five fact forms — `module m`, `symbol m::Name[.member]`, `dependency m -> n | "external"`, `value m::Name contains literal`, `value m::Name maps K to V`. Facts come from a provider chosen by file extension; BlaBla inspects Python, Rust, TypeScript and JavaScript, Go, Java, C and C++, and `blabla status` prints the live list from the providers themselves. The five tree-sitter providers share one parse harness; Python and Rust keep their own backends. Results are GREEN, RED (with the observed file and line) or ERROR. Structure is evaluated live on every call and never recorded as current, so a stale structure GREEN cannot exist.

Every provider answers three ways, never two: found, established absent, and unknown. Unknown is ERROR, and it is what keeps a `forbid` from passing through analysis blindness where a language hides a reference — a Go or Java same-package use with no import, a Java wildcard import, a C include on an unseen include path, a TypeScript dynamic import of an expression. An unknown names the one declared module it could be hiding wherever the provider can bound it, so it makes exactly those rules ERROR and leaves every other dependency on that module decidable.

Rule identity is `group::label` in both layers, where the group is the contract's file stem or its `as` alias.

## Completion

```text
BEHAVIOR   GREEN | YELLOW | RED | UNVERIFIED | STALE | VERIFYING | INTERRUPTED | none declared
STRUCTURE  GREEN | RED | ERROR | none declared
OVERALL    GREEN only when every active layer is GREEN and at least one is active
```

`blabla finish` is the only authoritative completion command: it never trusts the cached record, runs the canonical `verify behavior` profile, evaluates structure live, and writes `.blabla/status.json`. `blabla status` reads that record and reports STALE whenever the contracts, the implementation tree, the profile or the verifier version have moved. A false STALE is acceptable; a stale GREEN is not. Exit codes and staleness dimensions: `docs/project.md`.

**Standalone `blabla check <contract.bla>` is not a completion signal.** It evaluates one structure contract against the real project root while that contract is still being authored, so an author learns whether their rules evaluate before integration. `status` and `finish` remain the only authority over the whole project.

**`blabla check --falsify` is not one either**, in either of its forms. With a contract it asks whether each rule of that one contract can be made to fail; with no argument it asks the same of every active structure contract the project declares, in a single pass, which is the project-wide falsification the orchestrator role owns. Drafts are excluded and named, behavior contracts are not examined, and a project with no active structure contract is an error rather than a success, because nothing was proven. Either way it works by inverting the fact the rule names inside the facts the providers already reported and re-deciding the rule; it writes nothing, launches nothing, and neither `status` nor `finish` reads it. What it establishes is bounded and stated in its own output: a FALSIFIABLE verdict says the evaluator's answer depends on the fact the rule names, not that the rule names the right project concept and not that a real source edit would produce those facts.

## Semantic invariants

These are not preferences. A change that breaks one is a reversal, not a refinement.

- **WHAT, never HOW.** Contracts describe what must remain true. `state todos: [Todo]` may be SQLite, JSON, a HashMap or a remote service.
- **Every status is truthful.** GREEN means exercised and satisfied under the recorded finite campaign. YELLOW means incomplete verification, not success. RED means a reproduced violation.
- **Unevaluable is never GREEN.** Where BlaBla cannot truthfully establish a fact it reports ERROR, and ERROR blocks completion exactly like RED. Hence: a module with no provider is ERROR; a payload the provider cannot read statically is ERROR rather than absent; a dependency target that could never be observed is ERROR rather than a satisfied `forbid`.
- **A contract is never weakened to obtain GREEN.** The coding agent is an untrusted implementation generator: it may change architecture, algorithms, storage, modules and language, but it may not edit a contract or the verification profile to pass. Changing intended behavior is a separate contract-authoring act (`blabla guide change`).
- **Absent and unreadable are different facts.** "The gate step is gone" is a regression; "we cannot see what the gate step runs" is not. The first is RED, the second ERROR, and they are never conflated.
- **Project and tool state outrank agent narrative.** See the evidence ordering above.
- **Determinism.** The same repository, contracts, build, settings and seed produce the same facts, rule ids and output ordering. Elapsed timings and opaque protocol request ids are not decisions.

## Trust boundaries

- **The application's observations are trusted.** BlaBla is not a sandbox and cannot prove that an adapter exposes the real application. Fabricated observations defeat the boundary.
- **Structure providers never execute project code.** The Python provider runs one isolated interpreter per verification with BlaBla's embedded `ast` extractor; the Rust provider parses with `syn` in-process. Neither imports, initialises nor evaluates anything from the project.
- **Behavior verification is finite and heuristic.** A campaign is a bounded search, never a proof over all inputs.
- **Process containment is verified on Windows only.** Job Objects and Unix process groups both exist in the implementation; only the Windows path has recorded tests. Unix execution remains unverified.
- **The staleness fingerprint has a documented blind spot:** modules loaded from outside the manifest tree and not named on the command line are not covered.

## Architecture

`docs/architecture.md` is the current component map and the stable seams. In one line: a CLI and project layer over two independent pipelines — behavior parser to semantics to typed IR to a coverage-guided verifier across a trusted runtime boundary, and structure parser to structure IR to a provider interface with a Python and a Rust provider — reported through `status`, `explain`, `check` and `finish`.

`system.bla`, registered by `system "system.bla"` in `project.bla`, carries that same map in queryable form: the systems the repository is divided into, the responsibility each one holds, and the seams between them with the value that crosses. `blabla status` lists the system identities; `blabla explain system::<name>` opens one and names the `responsibility::<name>` and `seam::<name>` identities under it. It is architectural memory — validated against itself for syntax, fields, names and internal references, never checked against the repository, and never part of completion. Registration is explicit: a memory file the manifest does not register is not read.

`process.bla`, registered by `process "process.bla"`, answers the other question: who is expected to do what while the project is being developed. It declares `role`, `policy`, `flow` and `step`. The roles are `role::orchestrator`, `role::worker` and `role::reviewer`; the policies bind them on write scope, integration and contract ownership, which verification each may run, independent review of a worker's patch, and the standing that agent reports have. `flow::development` orders those roles into the development loop, one `step` at a time, each naming the roles that may carry it and the command that runs it.

**Process is advisory. BlaBla describes the intended authority and workflow and does not prevent an agent from bypassing it**, which is why `status` prints `PROCESS  ADVISORY` and every role, policy, flow and step view repeats it. Process memory is not a layer, takes no part in completion, and its `owns` entries are orchestration authority, unrelated to the `responsibility::<name>` identities of System memory.

`mission.bla`, registered by `mission "mission.bla"`, answers why any of it matters: one `mission` statement, the `priority` declarations that decide a tradeoff when two goods conflict, and the non-goals. It is authoritative about owner intent and is still not a layer — a planner that finds the evidence points elsewhere is expected to say so rather than comply.

`knowledge/*.bla`, registered by one `knowledge "path"` statement per file, holds reusable expertise: a `knowledge` pack and the `ruling` declarations inside it. A ruling has exactly two fields, `pack` and `statement`, so nothing in a pack can name a system, a role, a contract or a path, and the same file can be registered by another project unchanged. That is the whole reuse mechanism: a path, no registry, no versions, nothing fetched. A ruling identity is `ruling::<pack>::<name>` — the one three-segment identity in BlaBla, carrying its pack because two independently written packs may legitimately declare the same ruling name and a consuming project must not break over it.

Routing points **into** Knowledge and never out of it: `system "…" { knowledge [...] }` says these packs are relevant to work here, `role`/`policy { consult [...] }` says this actor or expectation should read them. An entry naming a pack no registered knowledge memory declares makes the referring memory `invalid`, with the cause named; there is no warning state, because a pointer that resolves nowhere is the "unevaluable is never GREEN" failure one level up. **A ruling is expertise, never permission to widen a task** — scope comes from the assignment and from `role::<name>`.

All four are authored in BlaBla's own `.bla` syntax, because authored project memory is BlaBla's to represent. JSON stays where it belongs: machine state under `.blabla/`, the `--json` surfaces, and generated artifacts.

## Development state

Authored memory says how the project is meant to work. A **bounded task** records one actual change in flight: the role carrying it, the paths it may write, the deliverables it owes, the findings raised against it, and a snapshot of the tree it opened against. It lives in `.blabla/tasks/<name>.json` beside the status record and the run marker — machine state, written by BlaBla, registered by no manifest, validated for truth by nothing, and reaching no layer.

`blabla challenge` reads that record, the tree measured against its snapshot, the completion state and a falsification verdict, and reports at most one discrepancy it can ground in them. A class with no evidence behind it says which evidence it lacked rather than reporting that it found nothing. It is a deterministic check over recorded facts, not a code reviewer: it reads no meaning from source code, decides no correctness, and `finish` keeps its verdict and its exit code. Classes and limits: `docs/agent-workflow.md`.

Project verification and task acceptance are different questions. `finish` decides whether the project is complete. A task's transitions decide only whether one handoff is in order, and they are the one place Process leaves prose: `ready` needs an acceptance on record, `close` is refused while a grounded challenge stands, and a closed task accepts no amendment. Everything else in Process stays advisory. Neither a clean task record nor `OVERALL GREEN` alone establishes everything: the record shows what was recorded rather than what was done, and GREEN is bounded by the campaign that produced it. The worker's routes through that lifecycle are printed by `task show` and by `guide loop` from one source, and `contracts/onboarding.bla` holds the entry to them.

## Agent workflow

```text
blabla status                     what project this is, what is GREEN, what to inspect next
blabla explain contract::<group>  one contract: its path, its state, the id of every rule
blabla explain <group>::<label>   one rule, its evidence, its counterexample or observed fact
blabla explain mission::<name>    why the project exists, what decides a tradeoff, the non-goals
blabla explain system::<name>     one system, the responsibilities it owns and the packs it needs
blabla explain role::<name>       one role, what it owns, the policies that bind it, what it consults
blabla explain knowledge::<pack>  one pack and the identity of every ruling in it
blabla explain flow::<name>       the development loop, one line per step
blabla task open <name> ...       orchestrator: record the bounded change, its scope, deliverables and check
blabla task accept <name> --model <id>   worker: take the assignment before changing anything
# change ordinary application code, run the declared check, record what the whole run reported:
blabla task evidence <name> --exit <code> --tool <tool>
blabla challenge <name>           one discrepancy grounded in the task record and the tree
blabla task ready <name>          hand back; closing is the orchestrator's decision
blabla task close <name> --model <id>    accept the result; refused while a grounded challenge stands
blabla finish                     canonical behavior campaign plus live structure evaluation
```

Every explainable object has exactly one canonical identity, and the command before it prints that identity, so an agent never constructs one: `contract::<group>`, `<group>::<label>`, `mission::<name>`, `priority::<name>`, `system::<name>`, `responsibility::<name>`, `seam::<name>`, `role::<name>`, `policy::<name>`, `flow::<name>`, `step::<name>`, `knowledge::<pack>`, `ruling::<pack>::<name>`, `runtime::<name>`. `status` lists every coarse identity even when the project is entirely GREEN, and a name matching more than one object is refused with every canonical command rather than resolved to one of them (`docs/project.md`).

Only `OVERALL GREEN` is completion. `blabla explain runtime::<id>` gives the semantics of a BlaBla-controlled runtime primitive; `action restart()` is `runtime::restart` and must never be given an application-level implementation. `blabla check <contract.bla>` is for authoring a structure contract. `blabla init --agents` writes a managed `AGENTS.md` block and a portable skill; `blabla guide agent|bootstrap|change|memory|loop` are the canonical onboarding, contract-authoring, behavior-change, memory-authoring and development-loop texts. Full workflow: `docs/agent-workflow.md`.

## Self-hosting

**In this repository, run BlaBla through Cargo, never an installed binary:**

```text
cargo run --quiet --bin blabla -- status
cargo run --quiet --bin blabla -- explain contract::rust
cargo run --quiet --bin blabla -- check --falsify contracts/rust.bla
cargo run --quiet --bin blabla -- finish
```

Cargo guarantees the CLI reflects the working tree. An installed or copied `blabla.exe` lags behind the semantics being developed, and a self-hosted GREEN produced by a stale binary says nothing about the source that produced it. `experiments/gate.py` runs its own `status` and `finish` checks this way for the same reason.

This is a rule about developing BlaBla itself. Everywhere else — user-facing documentation, `blabla guide agent`, the generated `AGENTS.md` block and every example for an ordinary project — the command is plain `blabla`, because that is what a consumer has on PATH.

BlaBla is a BlaBla project. The root `project.bla` registers `mission.bla`, `system.bla`, `process.bla` and the `engineering`, `testing`, `reviewing` and `design` knowledge packs, and carries active structure and behavior contracts and no drafts:

```text
extractor    src/structure/python_facts.py      the embedded fact extractor
publication  experiments/audit_public_tree.py   the public-tree auditor
secrets      experiments/audit_public_tree.py   its secret patterns and exemptions
gate         experiments/gate_v05.py            the frozen v0.5 release gate, contracted to keep that reproduction intact
schedule     experiments/gate.py                the production gate's step list and the order it must run in
diagrams     experiments/render_diagrams.py     the diagram drift gate
rust         src/structure/*.rs                 the structure subsystem and its seams
providers    src/structure/*.rs                 the provider seam, the shared parse harness and the advertised extensions
workflow     src/project/task.rs, src/cli/*.rs  the bounded-task record, its verbs and the recovery build
onboarding   src/cli/init.rs, src/cli/task.rs   the portable entry and the routes an assignment view owes a worker
evaluator    (behavior)                         found, absent and unknown, driven through the real evaluator
assignment   (behavior)                         the bounded-task lifecycle, driven through real records
voice        (behavior)                         that a diagnostic voice changes wording and nothing else
```

The three behavior contracts are driven by one adapter, `bridge/structure_adapter.rs`, which is a Cargo example: build it from the current source before `finish`, or run `experiments/gate.py`, which does it for you. A stale bridge verifies source that is no longer there.

BlaBla self-hosts with every active rule GREEN and OVERALL GREEN. Run `cargo run --quiet --bin blabla -- status` for the current rule count and state; the CLI is authoritative, and a count written into this file rots the moment a contract grows. Per-rule falsification evidence is kept under `artifacts/`.

## Preparation, startup and response

Three different things, kept apart because conflating them hides defects. `prepare` is work done once before any process is spawned — a build, typically — and it is outside the verifier's timeouts because a build is not a response. `startup_ms` is the allowance for the first exchange after each process start, which every case pays afresh. `timeout_ms` is the allowance for one ordinary response, and separating the first two from it is what lets it stay tight. All three enter the profile fingerprint. Preparation output belongs under `.blabla/`, which the implementation fingerprint does not walk; anywhere else, the build invalidates the run it was preparing. Full semantics: `docs/project.md`.

## The diagnostic voice

`voice blunt` in `project.bla` is an owner-selected wording for a standing challenge, and it is presentation over the same evidence. The blunt sentence is appended to the neutral one rather than replacing it, so nothing can be dropped by choosing a voice; the machine-readable report is byte-identical under either; and the verdicts, the exit code and the task transitions are untouched. Only a contradiction has a blunt rendering — an honest failure or a reported blocker is not a contradiction and never meets one. The default is neutral and nothing escalates it. `contracts/voice.bla` holds all of that to the real adjudication path rather than to a style guide.

## Non-goals

Do not redesign this into a general-purpose language, a BDD framework, a Spec Kit clone, a theorem prover, an agent orchestrator, or a TLA+/Dafny/P replacement. No arbitrary loops or user functions, no classes or inheritance, no algorithms or implementation code, no package system, no distributed or temporal verification, no parallel actors, no IDE or LSP, no prose-to-contract generation, no formal completeness claims. Keep one current contract language and one current API: no versioned schemas, no migrations, no compatibility branches.

Structure does not check call order, line counts, naming style, or anything needing execution or type inference. Those are behavior, or they are style and belong outside the contract.

There are no mission, process or knowledge **layers**: each is registered by its own statement, and `use mission`, `use process` and `use knowledge` are rejected (`E_UNSUPPORTED_LAYER`) because project memory never decides completion. `verify structure` is rejected because structure needs no profile. Reusable Knowledge is mounted by path only — no registry, marketplace, dependency manager or network fetch exists today, which is a scope decision rather than a permanent boundary. `blabla context` was evaluated and declined: its content is a subset of `status`, and a second entry command splits onboarding.

## Open questions

Whether executable project memory actually reduces handoff cost, whether each memory kind earns its place, and where smaller models are useful are open questions, not settled results. What evidence exists is recorded in `docs/research.md` and `research/`; it is not restated here, because this file carries current project truth rather than findings.

## Canonical documents

| Document | Holds |
| --- | --- |
| `docs/language.md` | the behavior language and the adapter protocol |
| `docs/structure.md` | the structure language and provider semantics |
| `docs/project.md` | the manifest, composition, discovery and completion |
| `docs/architecture.md` | the current implementation map and its seams |
| `mission.bla` | why the project exists, what decides a tradeoff and what it will not become; authoritative about intent, never a gate |
| `system.bla` | the same map as queryable architectural memory, registered by `project.bla` and reachable through `status` and `explain` |
| `process.bla` | who is expected to do what during development, and the authority boundaries between them; advisory, never enforced |
| `knowledge/` | reusable expertise packs and their rulings, routed to from System and Process, reusable in another project by path |
| `docs/agent-workflow.md` | how an agent uses BlaBla |
| `docs/research.md` | public research evidence |
| `CHANGELOG.md` | what changed in each release |
| `artifacts/` | internal dogfooding evidence, not published |
