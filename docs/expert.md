# Bounded expert evaluation

The expert is advisory memory. It never changes deterministic verdicts, task acceptance, verifier exit codes, or `finish`. Without expert configuration, ordinary project behavior is unchanged. Off makes zero provider calls. Shadow records diagnostic proposals without delivering advice. Advisory is unavailable without a matching, expanded matched-live promotion record, a certified configured provider, and a verified eligible host. There is currently no passing production promotion record; synthetic calls, replay, a manual checkpoint, or a working local transport do not establish one.

## Trust and participant output

Knowledge declares fixed Choice, Noul, and ordered Score questions and allowed templates. Process binds those questions to registered identities, roles, and checkpoints. Runtime configuration is explicit and separate from event/packet text. Provider endpoint, executable, identity, calibration, and host authority cannot come from a packet.

`expert checkpoint` loads the current local task and registered memory and builds bounded packets. Supplied host observations retain their source kind; they cannot manufacture local command facts or reference arbitrary files. Imported `expert evaluate` requests remain untrusted even when their hashes, source kinds, capture strings, or claimed facts look local. Evaluation, reevaluation, and replay are observer diagnostics and cannot certify provenance or reserve delivery.

Checkpoint stdout is participant-safe metadata in every mode: effective mode, capture status, opaque proposal IDs, counts, and usage. It never reveals the proposed outcome, concern, references, template, or message. A truthful nonempty host observation gap produces a bounded recorded abstention, exit 0, and zero provider calls. Gaps are retained, never cleared to obtain eligibility. A newer nonactionable capture invalidates older proposals; an older replay cannot move the checkpoint watermark backward. Malformed or credential-shaped metadata is invalid input.

Only `expert delivery` can return a participant-facing intervention. Explicit trace/replay/evaluate diagnostics contain selected reasoning inputs and would-be advice; keep them with an observer when running a shadow evaluation.

## Commands

Run these through `cargo run --quiet --bin blabla --` when working in this repository. Installed projects use `blabla`.

- `expert evaluate --config CONFIG --provider-command PROGRAM ARG... --json`: bounded JSONL `EvaluationRequest` on stdin; one `EvaluationResponse` plus `ExpertResult` per line. Without a configured identity/policy, evaluation stays unverified/abstaining. No imported request is eligible for delivery
- `expert checkpoint --event EVENT --config CONFIG --json`: capture the current checkpoint, build eligible local packets, evaluate independent questions, and retain proposals. The default output contains no advice
- `expert delivery REQUEST_ID --checkpoint CHECKPOINT_ID --json`: recheck current registered definitions, task/dependency revision, configuration, promotion, and host checkpoint under task/expert store locks; reserve before returning any template
- `expert receipt REQUEST_ID --state STATE --evidence ID --json`: append a request-bound host receipt or current local corrective check evidence
- `expert replay TRACE --json`: recompute the saved decision without a provider or network. Reject incompatible implementation fingerprints and changed decisions
- `expert reevaluate TRACE --config CONFIG --provider-command PROGRAM ARG... --json`: make a separate imported/shadow model comparison with a new request identity; never inherit delivery authority
- `expert traces --json`: inspect retained payload metadata and bounded skipped/gapped captures
- `expert traces delete RUN_ID --json`: delete that run's trace payloads. Keep the suppression ledger and omission metadata
- `expert cleanup --task TASK --json`: explicitly remove ledger/checkpoint state for a locally terminal task. Refuse open tasks

Put global options before `--provider-command` when convenient. Provider flags can be specified in trusted configuration; a repeated `--provider-command=--FLAG` also supplies a hyphenated argv item. Commands and JSON/human output use the same typed values. Exit 0 means a valid typed outcome, including abstention or provider failure; invalid input/configuration is 2; I/O failure is 4. These exits do not alter other commands.

## Trusted runtime configuration

The strict JSON configuration has exactly these fields:

- `mode`: `off`, `shadow`, or `advisory`; default library configuration is shadow
- `provider`: null or `{identity, argv}`. Identity includes provider, model, checkpoint, supported output kinds, probability capability, and an optional certification evidence reference. A certification string alone is insufficient for delivery
- `host`: null or exact `HostCapabilities`; host/version/adapter/checkpoint flags must match the selected event and promotion. Advisory requires a paused worker, same-task delivery, receipts, and no observation gaps
- `policies`: bounded per-binding `PolicySettings`, each with a fixed concern family, ordered fixed rules, and a calibration record
- `limits`: packet bytes, excerpt bytes, history entries, judgments per checkpoint, request timeout, concurrency, retries, and deliveries per checkpoint
- `trace_limits`: retention days, total trace payload bytes, and unresolved concerns per task
- `promotions`: bounded `PromotionRecord` entries; no automatic promotion is inferred from smoke tests or replay

Defaults are 16,384 packet bytes, 2,048 excerpt bytes, 8 history entries, 4 judgments per checkpoint, 10,000 ms timeout, concurrency 1, retries 0, and one delivery per checkpoint. Configuration cannot exceed the packet/excerpt/history/question bounds; timeout is at most 60,000 ms, concurrency remains 1, retries at most 1, and delivery budget remains 1. Resource settings are recorded and shown by status. Whole JSON values, nested strings, files, and stdin are bounded; duplicate keys, unknown fields, unknown enum values, unsafe metadata, and credential-shaped selected values fail closed. Diagnostic/self-report/provider-request strings are bounded and redacted before persistence. No full transcript is accepted.

Trace defaults are 7 days, 16 MiB of payload, and 64 unresolved concerns per task. Configured lower limits apply to delivery, receipts, recording, and listing, including after restart. Retention runs on capture/record/update/list operations, oldest payload first, and records omissions. Metadata has separate finite bounds. Exhaustion abstains instead of evicting deduplication state. Store ancestors and leaf files must not be symlinks.

## Fixed policy and calibration

Each rule selects an explicit outcome using one fixed predicate: Choice label, Noul literal Boolean, Noul probability for a specified Boolean, Score label, or upper Score-tail probability. Probability thresholds exist only in the matching calibration record, keyed by rule ID. There are no expressions, executable templates, arbitrary output schemas, or generated intervention prose.

Calibration matches the exact provider/model/checkpoint, complete question fingerprint, fixed-template fingerprint, and policy mapping fingerprint. A definition or provider change does not inherit earlier calibration. Raw distributions are preserved; values within the provider's 1e-3 rounding tolerance of a calibrated threshold abstain. Probability-only Noul and distribution-only Score answers do not acquire invented Boolean/label values.

Selection alone cannot recommend expertise. Usefulness and selection evaluate independently over byte-identical candidate context; schedule both together or record a visible omission. An actionable usefulness decision still needs a valid matching selection of a resolved candidate. Unknown references abstain before rendering. Fixed templates contain only bounded selected IDs and existing read/reconsider/ask-owner routes and never execute commands or change scope.

Locally observed existing task/check blockers precede semantic judgments, followed by goal drift, unsupported claim, repeated approach, and expertise, with stable binding-ID ties and one proposal/delivery budget. Imported facts cannot gain that local authority.

Promotion additionally matches provider, host, binding, question, templates, calibration, mapping, implementation, frozen snapshot, protocol, and holdout evidence. Only `matched_live_expanded` qualifies; replay, synthetic, and pilot records cannot. The frozen families require one-sided 95% Clopper-Pearson false-nudge upper bounds at most 0.05 for goal/claim/retry and 0.10 for the expertise pair, at least 60/30 held-out deliveries respectively, at least 20 justified opportunities, at least 0.90 evaluable checkpoint coverage, and complete end-to-end p95 latency at most 3,000 ms for goal/expertise or 1,500 ms for claim/retry. Current successful locally captured evidence must resolve. These checks do not themselves manufacture a live result. Test-only promotion fixtures are isolated temporary test data and are not production evidence.

## Reservation, receipts, and replay

The compact suppression ledger is separate from payload retention. Reservation identity includes task, acceptance, binding, relevant revision, material evidence, concern, and target. Event IDs, passage of time, timestamps, acknowledgment history, and incidental observation IDs do not reopen an unchanged concern. A materially changed concern receives a separate key and preserves prior reservations/receipts.

A reservation is `unknown` before stdout is written. A restart or ambiguous host write cannot redeliver it. An uncertain reservation blocks the same concern even after material changes until request-bound reconciliation establishes what happened. This is reserve-before-send, not exactly-once transport.

Host receipt observations are bounded JSON text with `request_id`, `idempotency_key`, and `state`: `delivered`, `acknowledged`, `declined`, `unknown`, or `not_delivered`. They must come from the matching current host checkpoint and observation ID. Arbitrary acknowledgment prose is insufficient. CLI receipt state `proposed` consumes an explicit matching `not_delivered` reconciliation; it is the only no-delivery retry path. Acknowledgment or decline never resolves a concern.

`observed_resolved` requires current, locally captured, successful declared-check evidence after reservation and a material corrective change. An identical successful rerun, a new evidence ID, or a new timestamp is insufficient. The record does not close a task or resolve its findings. Terminal cleanup is separate and explicit.

A trace keeps only selected request/response data, settings, source provenance, resource accounting, implementation fingerprints, suppression reasons, and typed receipts. Replay computes from those saved values and requires byte-stable decisions with the current compatible implementation. Deleting payload does not resolve a concern or grant a fresh nudge. Provider-reported shared batch usage remains repeated verbatim in each response; aggregate it once per local batch ID plus provider identity/request ID when present. Do not globally deduplicate arbitrary provider IDs or divide batch usage into invented per-question counts.

Local Kev transport smoke, blocked Luna/Codex protected-runtime access, and unverified Jev remain separate capability facts. This expert core is not a universal host hook or an autonomous task/remediation runner.
