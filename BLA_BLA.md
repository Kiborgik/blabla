# BlaBla

BlaBla is executable project memory for coding agents. It turns important behavioral intent into a compiled contract, explores the implementation automatically, produces minimized counterexamples when behavior breaks, and provides a clear GREEN/YELLOW/RED completion signal.
This is the compact project authority; older plans and reports are historical evidence. Paths under `artifacts/` and `docs/superpowers/` name local gate and planning evidence that is not published with the repository; the published reproducibility package is `research/`.
The historical v0.2 acceptance requirements were demonstrated on Windows. v0.3 verification is recorded under artifacts/coverage and v0.4 under artifacts/v04. Unix execution remains unverified.
`project.bla` is the machine entry point and `blabla status` is the agent entry point: an agent entering a project learns what project it is in, what is GREEN, YELLOW or RED, which contract owns the issue and which rule to inspect next without reading any contract file.

## What BlaBla is

```text
human intent
    ↓
prose specification
    ↓
behavior.bla
    ↓
coding agent
    ↓
ordinary implementation
    ↓
BlaBla verifier
    ↓
GREEN: exercised and satisfied
YELLOW: behavior remains unexercised
RED: reproducible counterexample
ERROR: verification failed
```

The coding agent is an **untrusted implementation generator**. It may change
architecture, algorithms, storage, modules, implementation language, and data
structures. It must not silently violate `.bla` or weaken the contract to obtain GREEN.
Applications remain ordinary Rust, C++, TypeScript, Go, Python, or other software.
BlaBla is the behavioral authority.

## Core philosophy and status vocabulary

BlaBla describes **WHAT must remain true**, not **HOW it is implemented**.
State is abstract observable state. `state todos: [Todo]` may represent SQLite,
PostgreSQL, JSON, a HashMap, ECS, event sourcing, or remote storage.
Storage independence does not remove the need for faithful observations and trusted test setup.

- **IMPLEMENTED:** present in current source; this alone does not establish correctness.
- **PROVEN / OBSERVED:** supported by specified executable evidence. Current results
  are finite observations, not formal proofs of all possible behavior.
- **PLANNED:** required or proposed work that is not yet complete.
- **HYPOTHESIS:** a claim still requiring an informative experiment.

GREEN covers required semantic obligations exercised during the recorded finite campaign. YELLOW is incomplete verification, not successful completion. Fabricated observations can defeat the
boundary; BlaBla is neither a sandbox nor proof that an adapter exposes the real application.

## Current language and implementation

**IMPLEMENTED:** handwritten Rust parser → syntax AST → semantic/type checking →
typed normalized IR → evaluator/verifier. The verifier consumes IR, not syntax AST.
See `src/syntax/mod.rs`, `src/semantics/mod.rs`, `src/ir/mod.rs`, and `src/verify/`.

Keep the existing braced syntax, explicit action parameters, explicit bindings, and labels:

```text
state todos: [Todo]
action complete(id: int)
when complete {
    expect "completed-target":
        all(after.todos, item => item.id != input.id or item.done)
}
always "unique-ids" { unique(todos, item => item.id) }
never "empty-text" { any(todos, item => item.text == "") }
```

`Todo` must be declared as in `examples/todo.bla`; this fragment is illustrative.
`type` defines structured observable values; `state` defines observations, not storage;
`action` declares callable inputs; `when` supplies `before`, `input`, and `after`;
`expect` is a postcondition. `always` is an invariant; `never` is normalized to a
negated invariant while retaining its label and source location.

Current values: `bool`, JSON-safe exact `int` (±9,007,199,254,740,991), finite `float`,
`string`, named records, lists, and explicit-null `optional<T>`. Action inputs are
scalar or optional-scalar. Guard optional access with `x != null and ...` or
`x == null or ...`; no implicit int/float coercion. Nested optionals are rejected
because JSON cannot distinguish their absent states. Float JSON round trips are exact.
Comparisons, Boolean operators, checked integer `+`/`-`, `count`, `any`, `all`, and
`unique` exist. `any` with equality supplies membership without new `contains` syntax.
List equality is ordered; extra observation fields are projected away; declared fields
and types are required. Labels are globally unique, explicit property identities.
Diagnostics include file, line, column, code, and explanation.

## Current verification and protocol

**IMPLEMENTED:** `check` and `run`; `run` is already the combined run/fuzz command.
Defaults: seed 0, 16 cases, 32 actions per case, 1,000 ms response deadline,
256 candidate shrink replays. Deadlines accept 1–5,000 ms; shrinking accepts 0–256.
Existing options include `--seed`, `--cases`, `--steps`, `--json`, `--timeout-ms`,
and `--shrink-budget`; `--verbose` adds full human diagnostics.

```powershell
cargo run --offline --quiet -- check examples/todo.bla
$todoApp = (Resolve-Path examples/todo/app.py).Path
cargo run --offline --quiet -- run examples/todo.bla --seed 0 --cases 16 --steps 32 -- python $todoApp
```

`src/runtime/mod.rs` runs an application in an isolated temporary working directory.
Interpreter script arguments must be absolute. Protocol is one UTF-8 JSON object per
line, correlated by opaque request IDs; flush every response. Example:

```json
{"id":"r1","op":"call","name":"add","args":["milk"]}
{"id":"r1","result":{"ok":true}}
{"id":"r2","op":"observe"}
{"id":"r2","result":{"todos":[{"id":1,"text":"milk","done":false}]}}
```

Reset creates a fresh directory/process and uses an acknowledged initialization
request. Restart reuses the directory, forcibly terminates and verifies the old
process tree, launches a fresh process without reset, then observes and checks rules.
The existing zero-argument `action restart()` lowers to a distinct IR operation;
it is never an application command. Logs belong on **stderr**; stdout
is exclusively protocol. Runtime rejects duplicate JSON keys and validates envelopes, acknowledgements, observations,
line size, deadlines, EOF and final process exit. Windows Job Objects / Unix process
groups provide process containment; the Windows implementation has recorded tests.
Unix execution is not established by that evidence.

`src/verify/coverage.rs` derives stable semantic obligations from typed expressions and existing labels. Guarded effects require the selected guard and relevant bound entity; compound invalid operations have distinct witnesses. Quantified coverage requires applicable members, and uniqueness requires a pair. Persistence partitions require actual trusted restart with meaningful prestate, including true Boolean features and nondefault reset values. A label evaluation alone cannot make its child obligations GREEN.

`src/verify/generator.rs` retains seeded SplitMix64 and the original generic scalar sampler. Guidance mines typed contract literals and nearby values, preserves record/field associations, and deliberately generates matching and wrong inputs. `src/verify/corpus.rs` stores at most 128 useful prefixes with deterministic replacement and selection. Prefixes are reconstructed through reset and checked execution, never by injecting snapshots. Replay actions consume the configured budget; shrinking and confirmation actions are reported separately. Observed action-to-field changes guide missing prerequisites; collection-growth information helps reach nonempty/pair witnesses. The generator favors relevant actions and viable inputs while retaining random exploration.

Generation, target selection, corpus decisions and coverage facts are reproducible for the same contract, build, settings, seed and deterministic application/setup. Elapsed timings and opaque protocol request IDs are not deterministic decisions. Campaigns continue through the configured budget and record the first action/time at which all required coverage was reached; a later violation still produces RED.

`src/verify/mod.rs` executes actual multi-action sequences with a fresh BEFORE and
AFTER observation for every step, checks initial invariants and post-action rules,
and replays reductions in fresh environments. Shrinking removes chunks
and simplifies arguments only when the **same property label** fails. Original and reduced
traces are confirmed. Reports distinguish fixed point, exhausted budget, and interruption;
none means globally shortest. Human and JSON reports already carry concrete failure evidence.
Exit codes: 0 GREEN (or successful compile-only check); 1 RED confirmed behavioral violation; 2 source/evaluation/invocation error; 3 application/protocol or unstable reproduction; 4 internal verifier failure; 5 YELLOW incomplete behavioral coverage. Compile-only check reports OK, not behavioral GREEN.

## v0.4 project layer

**IMPLEMENTED:** `src/project/mod.rs` (manifest, discovery, composition, identity, fingerprint), `src/project/status.rs` (status record and views), `src/cli/project.rs`, `src/cli/guide.rs`, `src/cli/init.rs`. The compiler in `src/semantics/mod.rs` compiles a list of units against one project environment; single-file `compile` is the one-unit case with bare labels, so every v0.3 contract, diagnostic and label is unchanged.

Manifest grammar, using the contract lexer (identifiers, double-quoted strings, no comments):

```text
manifest   := "project" IDENT statement*
statement  := ("use" | "draft") layer STRING [ "as" IDENT ]
layer      := IDENT
```

Only `behavior` is a valid layer; `mission`, `process` and `structure` parse and fail with `E_UNSUPPORTED_LAYER`. Paths resolve from the manifest directory and may leave it. The group name is the `as` alias or the file stem. Manifest errors: `E_PROJECT_HEADER`, `E_MANIFEST_STATEMENT`, `E_UNSUPPORTED_LAYER`, `E_DUPLICATE_USE`, `E_DUPLICATE_GROUP`, `E_MISSING_CONTRACT`, `E_MANIFEST_AS_CONTRACT` (a manifest cannot be included as a contract, so inclusion cannot recurse). A manifest with only drafts is valid.

Discovery: commands without a contract file argument (`status`, `explain`, `check`, `run`) walk from the working directory upward and use the nearest `project.bla`; `--project <file|dir>` overrides; none found is `E_NO_PROJECT` (exit 2). Nested projects are independent; nothing is inherited or merged. Commands with an explicit `.bla` argument never discover and never record.

Composition: all active contracts are parsed, their declarations collected, compatible repeats shared and the whole checked against the project environment, so one contract may attach `when` rules to actions declared in another or hold only types and state. Repeats inside one file keep `E_DUPLICATE_TYPE`/`E_DUPLICATE_STATE`/`E_DUPLICATE_ACTION`/`E_DUPLICATE_LABEL`; repeats across files are shared when the resolved structures are identical and otherwise fail with `E_INCOMPATIBLE_TYPE`/`E_INCOMPATIBLE_STATE`/`E_INCOMPATIBLE_ACTION` naming every declaring file. Diagnostics, `Predicate.location` and `Predicate.source` keep the owning file; an error inside a shared type is attributed to the file that declares it. `E_NO_ACTIONS` and `E_NO_PREDICATES` apply to the project. Rule identity is `group::label`; labels are unique per group and the IR label carries the qualified id, so coverage obligation ids, `Failure.property`, shrinking, run output, `status` and `explain` agree.

Status record: project-mode `run` writes `.blabla/status.json` beside the manifest with the verifier version, project identity (manifest text and active contract sources), an implementation fingerprint (FNV-1a over every file under the manifest directory except `.blabla`, `.git`, `target`, `node_modules`, `__pycache__`, `.venv`, `venv`, `.hypothesis`, `.serena`, `.idea`, `.vscode`, `.pytest_cache`, the manifest and the referenced contracts, plus the files named on the application command line), the application command, the options and the full run report. `status` and `explain` read it and compare all three identities; any difference is STALE (exit 5). False STALE is acceptable; stale GREEN is impossible while contracts, verifier or the fingerprinted implementation differ. Modules loaded from outside the manifest tree and not named on the command line are the documented blind spot.

Status view: rules are labeled predicates; a rule is RED if any of its obligations is violated, YELLOW if any is unexercised, else GREEN; `action/<name>` obligations are reported on a separate line. `Next` lists at most three rules, RED first, then YELLOW by unexercised obligations. States and exits: GREEN 0; YELLOW, UNVERIFIED (no record), STALE and NO ACTIVE CONTRACTS (drafts only) 5; RED 1; manifest or composition error 2. A project with zero active rules never renders GREEN. `explain <rule>` accepts `group::label`, a label unique across groups, or an obligation id; ambiguity is `E_AMBIGUOUS_RULE` and no match is `E_UNKNOWN_RULE`.

Drafts: `draft behavior "path"` registers a contract that `check` compiles standalone and composed with the active set, that `status` lists as not authoritative and not verified, and that contributes nothing to composition, counts or `Next`. Promotion is a human editing `draft` to `use`. `init` creates `project.bla`, a draft starter, and with `--agents` a managed `<!-- blabla:start -->`/`<!-- blabla:end -->` block in `AGENTS.md` (created, appended, updated in place, or refused on a lone marker) and `.agents/skills/blabla/SKILL.md`; it never overwrites and `--dry-run` writes nothing. `guide agent|bootstrap|change` are the canonical onboarding, contract-authoring and behavior-change texts; the skill points at them instead of duplicating them.

## v0.4.1 completion gate

**IMPLEMENTED:** the manifest carries one canonical verification profile and `blabla finish` is the authoritative completion command. Grammar extension:

```text
statement  := ("use" | "draft") layer STRING [ "as" IDENT ]
            | "verify" layer "{" field* "}"
field      := "command" "[" STRING ("," STRING)* [","] "]"
            | ("seed" | "cases" | "steps" | "timeout_ms" | "shrink_budget") INTEGER
```

`command` is required (non-empty, quoted elements); the settings default to the `run` defaults (seed 0, cases 16, steps 32, timeout 1000 ms, shrink budget 256) and share the CLI's ranges (cases and steps at least 1, timeout 1..5000 ms, shrink budget 0..256). A second block is `E_DUPLICATE_PROFILE`; an unknown, repeated or out-of-range field is `E_PROFILE_FIELD`; a missing or malformed command is `E_PROFILE_COMMAND`. The profile is operational configuration, not a planning layer; mission, process and structure remain documented future work.

Launch: a command element that starts with `-` is a literal; an element that contains a path separator or names a regular file in the base directory is a path, resolved against the base and required to exist before launch, otherwise `E_APPLICATION_PATH` (exit 2) naming the element and the base. The profile's base is the manifest directory; `blabla run -- ...` in project mode uses the invocation directory; single-file `run FILE -- ...` keeps the v0.3 behavior. The application still runs in an isolated temporary directory per case, so persistence semantics are unchanged; a process that cannot start remains `APP_SPAWN` (exit 3), never RED. Residual documented trap: a bare literal argument equal to the name of a file in the base directory is resolved to that file.

`finish`: requires active contracts (`E_NO_CONTRACTS`) and a profile (`E_NO_VERIFY_PROFILE`, exit 2), never trusts the cached record, runs the profile, writes the same `.blabla/status.json` record as `run` (now with the profile snapshot), prints the run report, the project block and `COMPLETION GATE: GREEN` or `COMPLETION GATE: BLOCKED` with one reason line, and exits 0 for GREEN, 5 for YELLOW, 1 for RED, 2/3/4 for contract, application and internal errors. JSON adds `completion` (`state`, `allowed`, `command`, `reason`); error reports add `"completion": "error"`. STALE is not a `finish` outcome: `finish` is what resolves it.

`status`: the record is additionally stale when its profile snapshot differs from the current profile (dimension `profile`; the project identity now hashes the project name, the active entries and their sources, so a profile edit reports exactly `profile`). A record is canonical when its written command, seed, cases, steps, shrink budget and timeout equal the profile's. `completion.state` is `green` only for a fresh canonical GREEN; otherwise `yellow`, `red`, `stale`, `unverified`, `not_canonical` (a fresh GREEN produced with other settings), `no_active_contracts`, or, without a profile, the behavior state itself (so every v0.4 project keeps its exits). `status` exits 0 only when completion is allowed; a fresh non-canonical GREEN exits 5. Human output adds `Completion: GREEN|BLOCKED (reason)` and `Canonical verification: blabla finish (settings; command)`; `Next` names `blabla finish` wherever it named `blabla run -- <application>` when a profile exists. The YELLOW footer of every run names the seed, cases and actions that left obligations unexercised.

Onboarding: the AGENTS.md block, `guide agent`, `guide change`, the skill and the `--help` footer say `blabla finish` before declaring completion, that only GREEN means behavioral completion, that YELLOW means NOT COMPLETE, and that contracts and the profile must not be weakened to obtain GREEN. `init --command <program> [args...]` writes the profile with the default settings spelled out; without it `init` writes no profile (it cannot know the application) and prints the block to add. `blabla context` was evaluated and not added: its content is a subset of `status`, and a second entry command splits onboarding.

## v0.4.2 self-describing runtime semantics

**IMPLEMENTED:** BlaBla executable project memory includes both project behavioral contracts and the semantics of BlaBla-controlled runtime primitives used by those contracts. `src/runtime/primitives.rs` is the one canonical source: each primitive has a stable identity (`runtime::restart`), an owner (`BlaBla verifier`), a one-line summary, semantic facts (`process_recreated`, `process_memory_preserved`, `persistent_environment_preserved`, `reset_requested`, each a key, a Boolean and a statement) and the distinction from an application-level action. Every agent-facing surface renders from it; no surface carries its own prose copy.

Dependencies are derived from the typed IR, not annotated: a rule attached to an action of `ActionKind::Restart` depends on `runtime::restart` (`Rule.runtime` in `src/project/mod.rs`), so no contract author writes `depends`, and the `.bla` grammar is unchanged. `runtime::reset` is not a primitive: reset is the per-case initialization request the application implements, and no rule can reference it.

Surfaces: `blabla explain runtime::<id>` prints `Owned by`, `Semantics`, the distinction line and, inside a project, `Used by` with every dependent rule id (JSON: `id`, `owner`, `summary`, `semantics[]`, `distinction`, `used_by[]`); it works without a project and an unknown id lists the known primitives (exit 2). `blabla explain <rule>` shows `Depends on:` after the action line and `More: blabla explain runtime::<id>` at the end (JSON `depends_on[]`; also for `action/restart`). `blabla status` adds `Runtime primitives used:` with the identities of the primitives active rules depend on and the explain command (JSON `runtime_primitives[]`), nothing more. `guide agent` states the generic concept only; the generated AGENTS.md block is unchanged; the `run --help` footer and the README point at `blabla explain runtime::restart` instead of describing restart. The progressive-disclosure hierarchy is AGENTS.md or `status`, the relevant rule, `explain <rule>`, `explain runtime::<id>`, full contract source only when necessary.

## v0.5.0-alpha structure layer and completion hardening

**IMPLEMENTED (2026-09-14):** executable project memory has two implemented layers, STRUCTURE above BEHAVIOR (the documented hierarchy stays MISSION → PROCESS → STRUCTURE → BEHAVIOR → IMPLEMENTATION; mission and process remain research). `project.bla` accepts `use structure "path"` and `draft structure "path"`; `verify structure` is rejected because structure needs no profile. A structure contract (`docs/structure.md`) declares `module <name> "<path>"` bindings and labelled rules `require "label": fact` / `forbid "label": fact` over four facts: `module m`, `symbol m::Name[.member]`, `dependency m -> n | "external"`, `value m::Name contains literal`. Rule identity is `group::label` as for behavior; labels are unique per contract; an undeclared module, an unknown fact, a mixed-layer file, a duplicate module or label fail deterministically with positions. Owner rulings: Option A flat labelled rules over the block and predicate alternatives; no file header, the manifest fixes the layer and a file whose first declaration is `module` is a structure contract.

Structure is evaluated live from the repository on every `status`, `finish` and project `check`, never recorded as current (a stale structure GREEN cannot exist; `finish` stores what it saw for audit only). Facts come from a provider chosen by file extension behind the `Provider` trait in `src/structure/mod.rs`; v0.5 ships the Python provider (`src/structure/python.rs`), one interpreter run per verification in isolated mode with BlaBla's embedded `ast` extractor (`python_facts.py`) that reads source text, parses it and never imports or executes project code (tests assert the extractor has no `exec`, `eval`, `__import__`, `importlib`, `compile` or `re`, and that a module with top-level side effects leaves none). A rule is GREEN, RED (with the observed file and line) or ERROR (no provider, interpreter missing, module unparsable, constant not a literal collection, symbol deeper than the provider reports); ERROR blocks completion exactly like RED. A missing module file is observed state: `require` RED, `forbid` GREEN.

Completion is layered: `BEHAVIOR` (the recorded canonical campaign, now also VERIFYING or INTERRUPTED), `STRUCTURE` (live) and `OVERALL`, GREEN only when every active layer is GREEN and at least one is active; a structure-only project finishes without a campaign. `status`, `finish` and their JSON (`state`, `structure`, `overall`, `completion` with `structure_red`, `structure_error`, `verifying`, `interrupted`) expose the same facts; exits are 0 OVERALL GREEN, 1 any RED layer, 3 provider unavailable, 5 otherwise BLOCKED. `blabla explain <structure rule>` prints the layer, contract line, rule text, requirement and the observed fact. `Next` lists structure violations before behavior rules.

`blabla finish` flushes `COMPLETION GATE: VERIFYING` with the structure line and the profile before the campaign, prints one progress line at most every two seconds (`241/355 obligations   812/4096 actions`) through a campaign observer that leaves the logical campaign untouched, and writes `.blabla/verifying.json` (`run_id`, `pid`, `started_unix`, verifier version, project and profile identity) before the campaign and removes it after the record. `status` classifies a marker: identities differ → INTERRUPTED; pid alive and started no later than the marker plus two seconds → VERIFYING (a reused pid is INTERRUPTED); pid dead → INTERRUPTED; a record carrying the marker's `run_id` → completed and ignored. Both block completion; a second `finish` is refused (`E_FINISH_RUNNING`) only while a live run exists, so an interrupted run never blocks permanently and never leaves a current GREEN. Early completion of the campaign was evaluated and not implemented: stopping at full coverage would change the frozen Glyph facts and weaken the stress budget the profile promises.

Acceptance evidence: `examples/glyph-vault` (the stage-4 handoff reference with seven behavior contracts and a 47-rule structure contract) is BEHAVIOR 355/355, STRUCTURE 47/47, OVERALL GREEN under the frozen profile; `tests/fixtures/structure/glyph-durable-id` (the Condition B deviation) and `glyph-dead-restart` (the Condition C leftover) keep behavior GREEN and are STRUCTURE RED, OVERALL BLOCKED. The frozen sealing-only Glyph campaign remains logically identical to the v0.3 final run. Gate: `python experiments/gate_v05.py --tag <n>` (report `artifacts/v05/final-report.md`).

Release: version `0.5.0-alpha`, MIT license, `CONTRIBUTING.md`, `SECURITY.md`, `CITATION.cff`, `CHANGELOG.md`, GitHub Actions CI for Windows and Linux, release workflow for tagged builds, `docs/` (language, project, structure, agent workflow, research) and `docs/diagrams/` (Mermaid sources with generated SVGs gated against drift), the curated `research/haiku-handoff/` package. `artifacts/` and `release/` stay unpublished internal evidence; links into it below are historical.

## Evidence and its limits

**PROVEN / OBSERVED, historical:** `REPORT.md` links the retained experimental records.
Do not rerun these experiments merely to reconfirm them.

- Todo: PASS → injected persistence bug detected → restored implementation PASS.
  This exercised application-controlled reload, not trusted process restart.
- Luna/low used BlaBla from a minimal request and repaired invocation/protocol issues.
- Spark/low followed `.bla` over contradictory prose: renewal replaces lifetime,
  expiry is exactly at zero, release requires the matching holder.
- Three inserted lease defects were repaired from failures with the contract unchanged,
  without administrator bug locations or implementation fixes. Reduced traces included
  `claim("é", "n", 6); tick(6)`, `claim("cak", " ", 1); release("cak", "")`, and
  `claim("é", "d", 1); renew("é", "d", 1)`.
- Repeated modifications ended **prose only 3/3 passing; BlaBla 3/3 passing**.
  Reduced accumulated drift is **NOT demonstrated**; it remains a **HYPOTHESIS**.
- Recorded prior gates: 67 Rust tests, two Todo Python tests, formatting, Clippy, and build passed.
  Those are historical results, not a new v0.2 gate.

**OBSERVED, alignment inspection 2026-09-13:** four existing focused verifier tests passed:
`same_seed_reproduces_every_generated_concrete_call`,
`observed_primitives_are_used_as_generic_action_arguments`,
`shrinking_keeps_a_producer_when_removing_it_changes_the_failed_property`, and
`shrinking_removes_calls_and_reduces_arguments_with_decreasing_complexity`.
Each was run with `cargo test --offline --test verifier <name> -- --exact`.

## v0.2 upgrade

**IMPLEMENTED:** the existing compiler, generator, shrinker, contract labels, protocol
correlation, and product rules are retained. The integrated changes are:

1. Trusted lifecycle and reset isolation replace application-controlled reload promises.
   The memory-only fixture passes normal operations and fails actual restart; persistent
   storage passes. Saving only on clean exit fails. Process/descendant exit and directory
   preservation/cleanup are checked by the lifecycle tests on Windows.
2. Generation and replay share step execution and use fresh observations. Direct tests
   cover seeds, boundaries, Unicode, random values, nested observed values, and optionals.
3. The explicit `A,B,C,D,E` shrink fixture reduces to `B,D`, retaining the target property.
   Removing same-property matching experimentally made that test fail by retaining only `D`.
   Removing fresh BEFORE observation also made its regression test fail. Both mutations
   were restored; evidence is in `artifacts/upgrade/skeptic-mutations.json`.
4. Human output gives `FAIL <property>`, seed, counterexample, expected/actual, and lengths.
   JSON includes `minimal_sequence`, `original_sequence`, both lengths, settings, and verifier
   version. Application errors have distinct machine codes; internal panics exit 4.
5. Float/optional support spans syntax, semantic checking, IR, evaluation, generation,
   shrinking, and observation validation. A real 512-step float echo exposed and fixed
   a JSON parser precision error using exact float round-trip parsing.
6. Todo uses actual process restart. Canonical `examples/leases.bla` and `examples/leases/app.py`
   preserve the three historical semantic rules and add real persistence. Historical
   experiment artifacts are unchanged. The 512-action Todo input-coverage test uses four
   bounded CLI batches; its existing five-second per-invocation deadline is unchanged.

Execution finished inline after stopping the initially approved generator subagent at
the user's request; its test draft was retained. No commits or agent research experiments were made.

## v0.2 verification evidence

**OBSERVED, 2026-09-13:** all 98 Rust tests and six Python tests passed. Formatting,
Clippy with warnings denied, and build passed. Exact commands and logs are recorded in
`artifacts/upgrade/gates.json`:

```powershell
cargo fmt --all -- --check
cargo clippy --offline --all-targets -- -D warnings
cargo test --offline
cargo build --offline
python -m unittest discover -s examples/todo -p "test_*.py"
python -m unittest discover -s experiments -p "test_*.py"
```

Hello, Todo, canonical leases, and the unchanged archived lease contract compile.
Actual CLI campaigns with `--seed 1234 --cases 1 --steps 512 --json` passed for both
Todo and leases. Full commands, outcomes, and timings: `artifacts/upgrade/campaigns.json`.
`tests/lifecycle.rs` demonstrates memory-only normal-operation PASS / trusted-restart FAIL,
persistent PASS, process/descendant termination, reset isolation, and restart error handling.

A disposable Todo copy with persistence writes disabled failed property `persistence`, seed 0:

```text
original: restart(); add("rqxi"); restart()
minimal:  add("r"); restart()
expected todos: [{"id":1,"text":"r","done":false}]
actual todos:   []
```

Reduction reached a local fixed point, with two confirmation replays. The repeated seeded
command produced identical JSON evidence. See `artifacts/upgrade/todo-failure.json`,
`todo-failure-replay.json`, and `todo-failure-human.txt`; `identities.json` records hashes.
The scorer's current core restart check now kills/recreates the process independently;
its four tests pass. Historical experiment records were not rescored.

Remaining limits: finite campaigns, bounded/local shrinking, heuristic scalar input reuse,
trust in observation fidelity and library adapters, and local-directory test isolation.
Remote storage setup, power-loss durability, and Unix lifecycle execution are not certified.
The Windows verifier is ready for a separately approved three-way benchmark pilot.

## Boundaries and next research

Do not redesign this into a general language, BDD framework, Spec Kit clone, theorem prover,
agent orchestrator, or TLA+/Dafny/P replacement. No arbitrary loops/functions, classes,
inheritance, algorithms, implementation code, package system, distributed verification,
temporal operators, parallel actors, IDE/LSP, prose-to-contract generation, or formal completeness.
Keep one current contract/API; do not add versioned schemas, migrations, or compatibility branches.

After v0.2 passes every required acceptance item, **propose, do not automatically run**, a
three-way weak-model repair comparison: prose; prose plus conventional/property tests;
prose plus BlaBla. Supply equivalent behavioral intent, use roughly 20–50 semantic mutations,
hide bug locations, and record repairs/failures, iterations, tokens where available,
regressions, human hints, tool calls, and elapsed time. Existing evidence does not establish
an advantage over conventional protected tests.

## Current agent workflow and research direction

The .bla contracts are authoritative executable project memory. Start with `blabla status`, drill into one rule with `blabla explain <rule>`, read a contract only when behavior is still unclear, implement normally, and run BlaBla after meaningful changes and before completion. RED means repair the minimized counterexample. YELLOW means inspect unexercised targets and continue verification. Only GREEN in `blabla status` is a behavioral completion signal. Do not modify a contract merely to make verification pass; a change of intended behavior is a separate contract-author phase (`blabla guide change`). Contract bootstrap treats requirements above specs above tests above docs above the current implementation, reports conflicts and unknowns for a human, and keeps drafts non-authoritative until promoted (`blabla guide bootstrap`).

The observed small-model onboarding diagnostic scored 47/50 with zero regressions, 96.72 seconds, 22 tools, two edit rounds and a small patch. It remains diagnostic because a UI-only profile flag changed the frozen hash. Its saved trace had 518 seal calls and zero eligible sealing opportunities. Those retained results are not rerun by this upgrade.

The hypothesis is that meaningful coverage and guidance can turn incomplete behavioral implementation into reliably detected remaining work. Small models may gain capability and guidance; large models may gain context compression and reliability; orchestrators may eventually gain mission/process stability. None of those scaling effects is established by v0.3 alone.

Primary research question: how much context can executable intent replace without reducing agent performance? [Future context research](docs/context-research.md) preserves the full-context, compact-human-summary and small-orientation-plus-BlaBla experiment, fresh contexts, equal underlying intent, token/context/tool/time/correctness/regression metrics, handoffs and progressive disclosure.

Future hierarchy remains MISSION -> PROCESS -> STRUCTURE -> BEHAVIOR -> IMPLEMENTATION. `project.bla` composes the BEHAVIOR layer (`use behavior`) and, since v0.5, the STRUCTURE layer (`use structure`); mission.bla, process.bla, a supervisor/tool proxy and a context server are documentation-only directions, and `use mission|process` is rejected. A `blabla context` command is not implemented; `status` is the compact orientation. The agent must not control a future ALLOW/DENY gate. Nested-project inheritance, token-reduction claims and strong-model improvements are not established by v0.4.

## v0.3 final verification

**IMPLEMENTED / OBSERVED:** trustworthy GREEN/YELLOW/RED with distinct ERROR handling, stable semantic coverage obligations, explicit vacuity and lifecycle witnesses, bounded prefix replay, typed literal/boundary mining, correlated name/key reuse, deliberate wrong inputs, observed action-field guidance, human/JSON progress and concise agent onboarding. YELLOW exits 5. Existing source-language and trusted runtime behavior are retained.

The final gate passed 132 Rust tests, six Python tests, formatting, Clippy with warnings denied and build. All 24 existing .bla contracts compiled. With the unchanged Glyph Vault reference and frozen seed 0 / cases 1 / steps 4096 / timeout 1000 ms / shrink budget 256, the clean campaign verified 176/176 obligations. Full coverage was reached at action 510 in 8.065 seconds; the campaign continued through 4096 actions and returned GREEN after 50.861 seconds. The repeated run reproduced all logical generation, corpus and coverage facts.

Meaningful witnesses included five eligible seals, three wrong-keeper seals, one sealed pulse, three sealed rotates, two sealed releases, two sealed-source transfers, five sealed-target transfers, 136 sealed-state restarts and 17 phase-reset restarts. Counts overlap and are not added into a score.

All three disposable mutations were found automatically under that same configuration: wrong keeper sealing at action 382, sealed pulse mutation at 318, and lost sealing across restart at 322. Their original/reduced sequence lengths were 21/5, 30/6 and 34/6 respectively. Each reduction reached the existing local fixed point, with original/reduced confirmation and independent real-process replay. These are not globally shortest proofs.

Complete final report and item-by-item acceptance checklist (`artifacts/coverage/final-report.md`), machine checklist (`artifacts/coverage/acceptance-checklist.json`), final gates (`artifacts/coverage/gates-004.json`), and frozen acceptance evidence (`artifacts/coverage/final-003/summary.json`) retain exact commands, timings, identities, witness traces, prior misses and limitations. The reference and contract hashes are unchanged. No subagents, commits or Qwen/Ollama/context-compression benchmark runs were made.

## v0.4 final verification

**IMPLEMENTED / OBSERVED, 2026-09-14:** the project layer (manifest, discovery, project-aware compilation, `group::label` identities, status record with contract, implementation and verifier staleness, `status`, `explain`, `guide`, `init` with draft starter, managed AGENTS.md block and portable skill) with every acceptance item PASS in the v0.4 final report (`artifacts/v04/final-report.md`) and machine checklist (`artifacts/v04/acceptance-checklist.json`).

The final gate (gates-003.json (`artifacts/v04/gates-003.json`)) passed formatting, Clippy with warnings denied, the complete Rust test run with zero failed titles, build and both Python suites. Between gates 001 and 003 one coverage-engine correction landed: `retain_context` now recurses into `or` as well as `and`, so an invalid-context witness no longer retains a disjunctive numeric condition that the faulted binding makes impossible (regression test in `tests/coverage.rs`). All 24 existing contracts compile (contracts.json (`artifacts/v04/contracts.json`)); the collision fixture fails by design. The frozen Glyph Vault campaign was repeated with the v0.4 binary under the unchanged seed 0 / cases 1 / steps 4096 / timeout 1000 ms / shrink budget 256 configuration: GREEN 176/176, full coverage at action 510, and every logical fact (coverage ids, statuses, first witness actions, witness counts, sequences) identical to the v0.3 final run (glyph-summary.json (`artifacts/v04/glyph-summary.json`)). Demo transcripts for the simple, multi-contract, nested, collision, stale, no-project and init flows are under artifacts/v04/demos (`artifacts/v04/demos`).

No subagents or commits were made. A deterministic agent-discovery simulation is part of the test suite; the bootstrap-quality experiment remains separately approvable.

## Haiku benchmark (2026-09-14)

**OBSERVED:** frozen `claude-haiku-4-5-20251001` subjects added a quarantine feature to the Glyph Vault sealing reference composed as a four-contract project (design, validation and manifests under artifacts/haiku-benchmark (`artifacts/haiku-benchmark/README.md`); results in REPORT.md (`artifacts/haiku-benchmark/REPORT.md`)). Conditions A (full prose), B (compact human summary), C (tiny onboarding plus BlaBla) and the C rerun C2 all passed the 70 hidden behavioral checks and the architecture check with zero regressions; every final workspace is GREEN 241/241 under the frozen campaign. The first C subject discovered `blabla status` but invoked it as `python -m blabla`, never reached the executable and verified with its own scripts; the generated AGENTS.md block and `guide agent` now state that `blabla` is a command-line tool and show `blabla run -- <application command>`. Under that block C2 ran `blabla status` first, repaired two real defects from minimized counterexamples (quarantine lost on restart, seal accepting a quarantined vault), wrote no tests of its own, had the fewest turns and tool calls of the BlaBla runs, and then declared completion at YELLOW 236/241 under the default 512-action budget, calling it GREEN; the frozen 4096-action campaign on that code is GREEN. Total input tokens tracked turn count (1.7 to 2.1 million per subject), not the initial package (12.6 KB, 4.1 KB, 1 KB), so context compression is not demonstrated by a single-feature task. Recorded product findings: the YELLOW footer should name the budget flags and the recorded settings; `run` should resolve or reject a relative interpreter script path instead of crashing the application. Both landed in v0.4.1 (the completion gate section above); the handoff experiment below is prepared and awaits approval.

## Handoff benchmark (2026-09-14)

**OBSERVED (Conditions A and B):** the sessions ran under the frozen manifest with the owner's correction that contracts are controller-owned. Results in REPORT.md (`artifacts/handoff-benchmark/REPORT.md`): A and B preserved behavior through all four handoffs with zero regressions; B failed the architecture check from Stage 3 on by keeping `id` in `DURABLE_FIELDS`, a refactor deviation that passed every behavioral instrument.

**OBSERVED (Condition C under v0.4.2):** the C chain ran fresh from the Stage-0 template under manifest-C.json (`artifacts/handoff-benchmark/manifest-C.json`), which differs from the A/B freeze only in the BlaBla binary and the controller hash. Results in REPORT-v042.md (`artifacts/handoff-benchmark/REPORT-v042.md`): C preserved behavior (106/106) and architecture through all four handoffs with zero regressions, with 4,715 B of supplied context against 71,747 B (A) and 22,468 B (B), 2.5 M total input tokens against 8.5 M and 6.6 M, and no self-authored tests. In C1 the subject first persisted resonance and added an application-level restart action (RED twice on `resonance::restart-resets-resonance`), then reached `blabla explain runtime::restart` through the rule explain and made the field transient (GREEN). C2 and C3 never observed their `blabla finish` result because the subject gave the 60-second campaign a 30-second tool timeout and the harness backgrounded it; C3 declared completion at STALE. The independent scorer found both correct.

**DESIGN:** artifacts/handoff-benchmark (`artifacts/handoff-benchmark/README.md`) froze a four-stage, three-condition, twelve-session Haiku experiment on the quarantine-landed Glyph Vault: Stage 1 resonance (a transient counter moved by rotate's cap ordering and pulse's phase modes, spent by `attune`), Stage 2 echo (moves resonance between equal-phase vaults, reusing the quarantine transfer-in rule), Stage 3 a persistence refactor with no behavior change (`DURABLE_FIELDS`, keyed JSON, atomic write; scored by the unchanged behavior scorer plus an architecture shape check), Stage 4 recovery (leaves quarantine on resonance 3 or more, resets phase without the return cap, needs fresh resonance after any restart). Every stage of a condition starts from the previous stage's final tree; Condition A receives the growing requirements and decisions, Condition B a maintained summary whose byte and diff growth is recorded, Condition C only the task and the generated `AGENTS.md`, with the stage contracts landed by the controller and `blabla finish` under the frozen profile (seed 2, 1 case, 4096 actions) as the completion gate. Hidden references, per-stage scorers with check ids for drift accounting, one behavioral mutation per stage, three concurrent condition chains with stages sequential within a chain, a 600 s tool timeout for every condition, $10 per session and $40 in total are frozen in `manifest.json`. The research question is whether executable project memory lets fresh agents inherit a mature project's intent more cheaply and reliably than repeated prose or maintained summaries; the v0.4.2 Condition C run above answers it for this project with one run per cell, so it remains an observation, not a statistical claim.
