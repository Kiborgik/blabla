# Bounded expert evaluation

The expert layer asks fixed questions about selected project context: goal drift, useful expertise, claim support and repeated failed approaches. A validated answer passes through deterministic policy into silence, abstention or fixed-template advice. It never changes task acceptance, verifier verdicts, exits or `OVERALL`.

**Current status: experimental, 0.10 unreleased.** The core, provider transports, saved-policy fitting and cooperative native host protocol are implemented. Repository bindings remain shadow-only, with **zero promoted judgments**. Real Kev calibration completed but selected **no feasible policy**; a smaller rendering diagnostic also failed to qualify one. Runtime expert benefit, improved correctness and reduced owner steering are not established. [Evidence and limits](design/0.10-release-evidence.md) · [dogfooding boundary](evidence/rts-dogfooding.md#runtime-expert-boundary)

## Where it runs

| Route | What actually happens |
| --- | --- |
| Ordinary project commands | `status`, `explain`, `check` and verification do not call a provider |
| `off` | no provider calls |
| `shadow` | an explicitly captured checkpoint can evaluate bounded questions and retain diagnostics; no participant advice |
| Ordinary `advisory` | requires matching expanded matched-live promotion, qualified provider and verified host pause/same-task/receipt capabilities |
| Native experiment | separate explicitly permitted, non-promotion-eligible protocol at completed, idle between-turn boundaries; no general host interception |

Declaring a binding does not install a hook. An integration must observe a real boundary and supply its typed event. The installed Codex CLI route remains blocked/unverified; Luna repository inference and Jev remain unverified. The separate native adapter uses model-side `collaboration` tools, not that blocked CLI route. [Historical host probe](design/0.10-host-capabilities.md) · [native adapter](../adapters/native/README.md)

## Fixed expert judgments and bindings

Register Knowledge and Process files through the ordinary [manifest statements](project.md#statements). A portable knowledge question:

```text
knowledge "expert-review" { purpose "Check claims against selected evidence." }
judgment "claim-support" {
    pack "expert-review"
    purpose "Check one claim."
    requires ["claim", "evidence"]
    question "Does the supplied evidence support the stated claim?"
    criteria "Missing or unrelated evidence does not establish the claim."
    output "noul"
    proposition "The evidence supports the claim."
    templates ["cite-evidence"]
}
```

A project-local Process binding (the role is declared in the same memory):

```text
role "worker" { purpose "Carry a bounded implementation task." }
binding "claim-check" {
    judgment "judgment::expert-review::claim-support"
    roles ["worker"]
    checkpoints ["tool-result", "claim", "turn-end"]
}
```

Judgments require `pack`, `purpose`, `requires`, `question`, nonempty `criteria`, `output` and `templates`. Optional `optional` slots must be disjoint from `requires`. Exactly one output shape is allowed:

| Output | Extra field |
| --- | --- |
| `"choice"` | `alternatives ["first", "second"]`: at least two distinct identity-safe labels |
| `"noul"` | nonempty `proposition "…"` |
| `"score"` | `levels ["low", "high"]`: at least two distinct labels in ascending order, zero-based ordinals; no numeric weights |

Output-specific fields from other shapes, duplicate slots/templates and arbitrary schemas are rejected. Slots are exactly `task`, `goal`, `mission`, `proposal`, `claim`, `evidence`, `attempts`, `candidates`, `rules`, `system`.

Bindings require `judgment`, local `roles` and `checkpoints`. Checkpoints are `plan`, `tool-call`, `tool-result`, `claim`, `turn-end`, `review`. Optional lists bind `goal`, `mission`, `system`, `rules` and `candidates` to existing canonical identities of the corresponding kinds. `rules` accepts rules/contracts/rulings; at most four candidates can be packs/rulings. Ordered candidates map to `candidate-1`…`candidate-4`; selection can also return `none`.

The selected task supplies `task`; its declared goal supplies fallback `goal`. Proposal, claim, evidence and attempts come from typed observations/history, never arbitrary paths or a `slot=value` language. Valid declarations can still lack required runtime context and must abstain.

Templates are fixed: `read-identity` needs goal/mission/candidate/rule/system context; `cite-evidence` needs evidence; `reconsider-approach` needs proposal/attempts; `ask-owner` addresses the selected task. Binding validation rejects unsuppliable template references. Text and IDs are inert data, never commands or permission to widen scope.

`status` lists binding counts/IDs; pack/role views lead to `explain judgment::PACK::NAME` and `explain binding::NAME`, with definitions and source files. Judgments without bindings report off; valid bindings default to shadow. Authored names use hyphens; JSON enums use snake_case.

## Evaluation and trust

The runtime builds an `ExpertPacket` from selected local task revisions, registered identities, bounded host observations and recent history. It tracks provenance, missing/truncated slots and resource accounting. It never accepts a full transcript. Trusted configuration, not packet text, supplies executables, endpoints, provider identity, calibration and host authority.

`EvaluationRequest`/`EvaluationResponse` identities and typed outputs are validated before `policy::decide`. Imported requests remain imported even if their hashes or claimed source kinds look local. Worker self-reports are not probabilities or authenticated facts. Missing context, unknown references, invalid answers and stale revisions prevent actionable advice.

Each policy rule uses one fixed predicate: Choice label, Noul Boolean or probability for a specified Boolean, Score label or upper-tail probability. Calibration binds provider/model/checkpoint, question, templates and mapping fingerprints. Changes require recalibration. Raw distributions are preserved; values within `1e-3` of a calibrated probability threshold abstain. Probability-only/distribution-only answers do not gain invented Boolean/label values.

Expertise usefulness and selection are independent questions over byte-identical candidate context. Schedule both or record an omission; selection alone never causes advice. Locally established task/check blockers precede goal drift, unsupported claims, repeated approaches and expertise, with stable binding-ID ties and one proposal/delivery budget.

Checkpoint stdout contains participant-safe metadata, not outcomes, references or advice. Host/sequence gaps are retained as abstentions with zero provider calls. Newer nonactionable captures invalidate older proposals; old replay cannot move the checkpoint watermark backward. Evaluation/replay/trace diagnostics can contain would-be advice and belong with the observer during shadow runs.

## Commands

Installed projects use `blabla`; this repository uses `cargo run --release --quiet --bin blabla --`. All commands expose `--help` and `--json`.

| Command after `blabla expert` | Purpose |
| --- | --- |
| `evaluate --config CONFIG --provider-command PROGRAM ARG…` | bounded JSONL requests on stdin; typed responses/results, never delivery authority |
| `checkpoint --event EVENT --config CONFIG` | local capture, packet selection, evaluation and retained proposal IDs; no advice on stdout |
| `delivery REQUEST_ID --checkpoint CHECKPOINT_ID` | ordinary advisory revalidation and reserve-before-return |
| `receipt REQUEST_ID --state STATE --evidence ID` | request-bound host receipt or locally observed corrective check evidence |
| `replay TRACE` | recompute a saved decision without a model/network; reject incompatible implementation fingerprints or changed decisions |
| `reevaluate TRACE --config CONFIG --provider-command PROGRAM ARG…` | separate imported/shadow comparison with a new request ID |
| `preflight-development-calibration --input FILE` | read-only frozen-input/project validation before collection; no provider calls |
| `fit-saved --input FILE` | validate saved actual response/evidence inputs and select feasible declared policy candidates; does not collect responses |
| `traces` / `traces delete RUN_ID` | list retained metadata / remove payload while retaining suppression/omission state |
| `cleanup --task TASK` | explicitly remove terminal-task ledger/checkpoint state; refuse open tasks |
| `native …` / `pilot issue\|show\|revoke …` | cooperative host operations / scoped experimental permits; see below |

Place global options before `--provider-command`; trusted configuration can carry provider flags, or repeated `--provider-command=--FLAG` supplies a hyphenated argv item. Ordinary expert exit 0 means a typed result, including abstention/provider failure; 2 is invalid input/configuration, 4 is I/O failure. Native results can also be typed refusal/no-advice at exit 0. Inspect the returned tag, not only the exit.

## Trusted runtime configuration

Strict JSON `RuntimeConfig` has exactly `mode`, `provider`, `host`, `policies`, `limits`, `trace_limits`, `promotions`. Provider is null or `{identity, argv}`; host is null or `HostCapabilities`. No configured provider is supplied by default. A certification string alone grants no delivery authority. Exact public types: [expert](../src/expert/mod.rs), [provider](../src/expert/provider.rs), [policy](../src/expert/policy.rs), [trace/configuration](../src/expert/trace.rs).

| Limit | Default / maximum |
| --- | --- |
| Packet / excerpt | 16,384 / 2,048 bytes, also their maxima |
| History / questions per checkpoint | 8 / 4, also their maxima |
| Request timeout | 10,000 / 60,000 ms |
| Concurrency / retries / delivery budget | 1 / 0 / 1; maxima 1 / 1 / 1 |
| Trace retention / payload / unresolved concerns | 7 days / 16 MiB / 64 per task |

JSON values, strings, files and stdin are bounded. Duplicate/unknown fields, invalid enums, unsafe or credential-shaped selected data fail closed. Diagnostic strings are bounded/redacted before persistence; store ancestors/leaves must not be symlinks. Retention runs on capture/record/update/list, removes oldest payload and records omissions. Lower configured limits persist across restarts. Metadata is independently bounded; ledger exhaustion abstains instead of discarding deduplication state.

## Reservation, receipts and replay

Ordinary `delivery` rechecks current definitions, configuration, selected task/dependency revision, host checkpoint and promotion under task/expert locks. It records an **unknown** reservation before exposing a template. This is reserve-before-send, not exactly-once transport.

Suppression identity binds task, acceptance, binding, relevant revision, material evidence, concern and target. Event IDs, timestamps, acknowledgment or elapsed time do not reopen a concern. Material changes can create a distinct key, but uncertain delivery keeps the concern blocked until request-bound reconciliation establishes what happened.

Host receipt observations are strict JSON with `request_id`, `idempotency_key` and `state`: `delivered`, `acknowledged`, `declined`, `unknown`, `not_delivered`. They must match the current host checkpoint/observation. CLI receipt `proposed` consumes matching verified `not_delivered` reconciliation; it is the explicit no-delivery retry route. Retries retain earlier ledger/receipt history. Acknowledgment/decline does not resolve a concern.

`observed_resolved` needs current local successful declared-check evidence **after reservation and a material corrective change**. An identical rerun/new timestamp is insufficient. This does not close a task or resolve its findings. Payload deletion does not resolve a concern or renew a nudge budget.

Replay uses saved selected data, policy/settings, fingerprints and receipts; compatible decisions must remain byte-stable. Shared provider batch usage is preserved verbatim per response and aggregated once per local batch plus provider identity/request ID when present. Do not invent per-question token allocations or globally deduplicate arbitrary provider IDs.

## Cooperative native experiments

The [native host schema](design/0.10-native-host-schema.md) defines closed requests and admission. The [adapter README and host skill](../adapters/native/README.md) define operation and recovery. Rust owns revisions, permits, budgets, deadlines, reservations and receipts; Python validates projections and calls the source CLI; the host skill performs actual `collaboration` tool calls.

1. Obtain a fresh actual tool-surface/nonce proof and enroll an already accepted, initially idle worker with correlated spawn/completion/status evidence
2. Start the frozen run; obtain and claim the core's exact pending host operation, call the actual tool once and retain its bounded result
3. Capture the completed worker boundary, re-observe idle state and evaluate only the core-returned event using `checkpoint --experimental-run RUN`
4. Prepare a compact Wake; the worker consumes it as its first task-affecting action. Only that consume route may expose experimentally reserved advice
5. Record transport, exposure, response and independently observed correction as distinct evidence; invalidate on replacement, missed boundary or unexpected continuation

There is no atomic idle-to-send primitive, platform-authenticated child identity, in-turn observation/control or detection of arbitrary out-of-band continuation. General pause/same-task/receipt/pre-tool capabilities stay false. A nonce exchange does not qualify the host or authorize an experiment. Experimental permits are scoped, revocable and explicitly non-promotion-eligible; they do not bypass ordinary advisory promotion.

Lost mutating-call output is uncertainty, not permission to retry. Lost consume output must not be retried to recover advice. Reconcile the existing operation or stop; a new filename, restart or expired payload never replenishes budget.

Real-response collection uses `experiments/expert_eval.py calibrate-live`; resumable native runs use `live --native-plan`. Legacy authored calibration/replay and old feasibility receipts cannot substitute for either. [Calibration and frozen-input schema](design/0.10-native-host-schema.md#10-tracereplay-identity-and-real-provider-calibration)

## Qualification is separate from implementation

Ordinary promotion requires `matched_live_expanded` evidence matching provider, host, binding, question, templates, calibration, policy, implementation, frozen snapshot, protocol and holdout. Replay, synthetic and pilot evidence cannot qualify.

Frozen criteria: one-sided 95% Clopper–Pearson false-nudge upper bounds ≤0.05 for goal/claim/retry and ≤0.10 for expertise; at least 60/30 held-out deliveries respectively; ≥20 justified opportunities; ≥0.90 evaluable coverage; complete end-to-end p95 latency ≤3,000 ms for goal/expertise or ≤1,500 ms for claim/retry. Matching current successful local evidence must resolve. These checks validate evidence; they do not manufacture it.

The self-hosting bridge exercises actual deterministic policy and revision logic with authored fixtures, without a model/network dependency. Its GREEN cannot establish host delivery, provider quality or worker benefit. Successful Kev transport and unsuccessful real calibration remain separate findings; no qualification or speed/steering claim follows from either.
