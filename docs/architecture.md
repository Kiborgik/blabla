# Architecture

Two independent verification pipelines meet in the project/report layer. Authored memory, task state and optional expert advice sit alongside them; only Behavior and Structure decide completion.

![Project composition feeds typed behavior verification and live static structure evaluation. Memory is queried; task records feed the skeptic; explicit host checkpoints feed bounded expert policy. Only the two verification pipelines reach finish and OVERALL.](assets/architecture.svg)

[Diagram text alternatives](diagrams/README.md#architecture) · queryable map: `blabla explain system::<name>`

## Components

| Path | Responsibility |
| --- | --- |
| `src/cli/` | argument parsing, status/explain/check/run/finish, task and expert commands, managed onboarding and progress; human/JSON output from shared views |
| `src/project/` | manifest discovery/composition, profile resolution, identities, fingerprints, status and run markers |
| `src/syntax/` → `src/semantics/` → `src/ir/` | parse and type-check behavior into normalized IR; single-file compilation is one-unit composition |
| `src/verify/` | seeded generation, typed-literal guidance, prefix corpus, semantic coverage, predicate evaluation and counterexample shrinking |
| `src/application.rs`, `src/runtime/` | observation boundary, UTF-8 JSON Lines, per-case temporary directory, trusted restart, response/startup timeouts and process-tree containment |
| `src/structure/` | structure parser/IR, inspection, one fact evaluator, provider registry and in-memory falsification |
| `src/structure/python.rs`, `python_facts.py` | isolated Python interpreter with embedded `ast` extractor |
| `src/structure/rust.rs` | in-process `syn` parsing |
| `src/structure/treesitter.rs` | shared parse/error/line/fact harness for TypeScript/JavaScript, Go, Java, C and C++ walks |
| `src/memory/` | `.bla` parsing, each memory kind, internal validation and routing into knowledge packs |
| `src/project/task.rs`, `task/revision.rs`, `task/store.rs` | bounded assignments, shared relevant-revision identity, exact evidence/review bindings and atomic ownership transactions |
| `src/skeptic.rs` | one grounded challenge from records, tree, completion and falsification; no semantic code review |
| `src/project/expert.rs`, `src/expert/packet.rs` | registered judgment/binding resolution and selected packets with bounded context/provenance |
| `src/expert/provider.rs`, `adapters/systemone/provider.py` | strict typed response validation, subprocess exchange and local SystemOne HTTP transport |
| `src/expert/policy.rs`, `trace.rs` | pure policy/templates, replay, bounded payload retention, final freshness checks, reservation and suppression ledger |
| `src/expert/calibration.rs` | pure development preflight and fitting over saved validated responses |
| `src/expert/native/`, `pilot/`, `adapters/native/` | scoped experimental authority and cooperative completed-idle-turn host protocol; Python validates projections, the host skill calls native tools |
| `experiments/expert_calibrate_live.py`, `expert_native_live.py` | bounded real-response collection and resumable native-run orchestration; no independent policy implementation |
| `src/report.rs`, `diagnostic.rs`, `voice.rs` | shared report/diagnostic shapes and presentation-only voice |

## Stable seams

- **`Application`**: `reset`, `call`, `observe`, `restart`, `finish`. The verifier consumes observations, not process details. Unsupported trusted restart defaults to `APP_LIFECYCLE`
- **`Provider`**: `id`, `extensions`, `symbol_depth`, `handles`, `inspect`, `external_target_error`. First matching extension selects it. A successful inspection must return a record for every requested module; silence is ERROR, not absence
- **`ModuleFacts`**: existence/error, symbols/imports, literal collections, key/payload entries and unsupported values. Python serializes it; in-process providers construct it. All share one evaluator and fact grammar
- **Typed IR / `RunReport`**: coverage, failures, shrinking and IDs are defined over IR; human and JSON render the same report value
- **`Task` / relevant revision**: assignment declarations and observed tree/evidence enter the skeptic and freshness checks here. New challenge classes need grounded data, not agent narrative
- **Expert request/response/result**: selected `EvaluationRequest` plus validated `EvaluationResponse` enters pure policy. `ExpertResult` is advice, never a verifier verdict. Reservation/consume recheck the current selected revision and execution authority
- **Native wire / permit**: closed operation, observation, Wake and receipt types preserve experimental identity and uncertain delivery. General host capabilities cannot be inferred from this narrower cooperative protocol
- **`runtime/primitives.rs`**: the single table every agent-facing surface uses for runtime primitive semantics; dependencies are derived from typed IR

Public definitions and exact host admission: [expert reference](expert.md) · [native schema](design/0.10-native-host-schema.md).

## State and trust

```text
project.bla + registered *.bla    authored intent and contract definitions
.blabla/status.json              recorded behavior campaign and audit data
.blabla/verifying.json           in-flight process/run identity
.blabla/tasks/*.json             assignments, snapshots, findings and evidence
.blabla/expert/                  runtime settings, bounded traces, reservations and receipts
```

Behavior records receive freshness/canonical checks; structure is always evaluated live. Memory validity, task lifecycle and expert policy have separate authorities described in [Project](project.md), [Agent workflow](agent-workflow.md) and [BLA_BLA.md](../BLA_BLA.md#trust-boundaries).

Inspection is separate from decision: providers build facts once; the evaluator decides rules. Falsification changes only that in-memory fact map and reruns the same evaluator, without source edits or a second inspection. It tests rule sensitivity, not semantic intent.

Expert calls are explicit at supported host boundaries. They are absent from deterministic verification. Ordinary advisory promotion and scoped native experiments share policy/freshness logic but have distinct admission. Neither route supplies universal hooks, authenticated worker identity or autonomous remediation.

## Self-hosting

`project.bla` registers the current inventory; use `status` rather than a copied count. The current-source `structure-adapter` bridge translates contracts into calls to real evaluator, task, goal and expert functions. Expert fixtures exercise pure decision/revision seams without a model or network. They are not host-delivery or quality evidence.

Structural dependency rules keep verification pipelines, skeptic and expert concerns separated. The orchestrator's product gate rebuilds the bridge, runs composed canonical `finish` and reads current `status`. [Verification ownership](test-ownership.md) · [contribution checks](../CONTRIBUTING.md#verification)
