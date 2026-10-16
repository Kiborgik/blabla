# Headless agent interface

Run these commands from the directory where you want the world saved. The default durable store is `.blabla/world.json`. The application script may use an absolute path, and no renderer is needed.

```sh
node /absolute/path/to/examples/agentic-mmo/cli/main.ts init --seed 17
node /absolute/path/to/examples/agentic-mmo/cli/main.ts observe
node /absolute/path/to/examples/agentic-mmo/cli/main.ts action --seat 0 --revision 0 --choice 0 --model gpt-6.1-sol --id unique-turn-id
node /absolute/path/to/examples/agentic-mmo/cli/main.ts replay --out replay.json
```

An observation includes `activeSeat`, `revision`, the engine's `legalActions`, and indexed `choices`. Read the current observation, choose an available action, and submit the same revision. Five civilization seats and the Director occupy seats 0 through 5. The engine decides legality and turn order. Turns are independent of animation.

`action` requires `--model`. This identifies the submitting development model; it does not turn a scripted policy into a language model. The durable provenance log records each accepted action's model, seat, action, committed revision, command id and timestamp. Contract-generated actions are explicitly `contract-probe`, with no model identity.

A safe retry supplies the same `--id` and exact command payload. It returns `duplicate: true` without advancing the world again. Reusing an id with changed content is refused. A stale revision, wrong seat or invalid action does not change engine state. Two concurrent processes cannot commit the same revision. A missing id receives a new one; retry safety then requires using the id returned in the reply.

Use `--action '{"type":"wait"}'` instead of `--choice` to submit an exact currently legal action. `--state /path/world.json` selects a different local store for the one-shot commands. `init` refuses to replace an existing world.

## JSONL

Starting `main.ts` without arguments, or with `serve`, uses the repository's shared BlaBla JSONL transport. Each response preserves the request's id:

```jsonl
{"id":1,"op":"init","seed":17}
{"id":2,"op":"observe","seat":0}
{"id":3,"op":"action","seat":0,"expectedRevision":0,"choice":0,"model":"gpt-6.1-sol","commandId":"unique-turn-id"}
{"id":4,"op":"replay"}
```

Malformed JSON and non-object lines are reported on stderr and skipped; subsequent requests are still handled. Protocol errors return `ok: false`. One-shot commands emit one JSON result. Refused valid requests exit zero so agents should always read `ok`; malformed command-line syntax exits nonzero.

## Durable replay

State, commands, committed frames and provenance are written together via a synced temporary file and atomic rename. A process lock serializes writers. Restarting the process loads the last committed revision. Corrupt or incompatible stores fail without resetting or overwriting the file.

Replay exports contain only actions actually accepted in that local world. An unfinished world remains unfinished. No offline autoplay is performed. Development-agent identities are recorded assertions from their submitting process; local files are not an authenticated shared server or tamper-proof audit ledger.

The current released feature set determines available in-world progression. Round completion alone does not advance the calendar or unlock future ages. This interface supports the persistent development world and its actual shipped capabilities.

## BlaBla contract bridge

`node /absolute/path/to/examples/agentic-mmo/cli/adapter.ts` provides the contract `reset`, `call` and `observe` operations by importing `adapters/typescript/blabla_adapter.ts`. Its application actions are `play(seat, choice)`, `hold()` and `restart()`. Choices must be nonnegative in-range integers; invalid choices set `last_valid: false` without advancing revision. `hold` derives the active seat's legal wait choice and submits it through the same engine/store path, recording contract-probe provenance. Six holds complete a real round and resolve its economy.

Generated contract campaigns use `.blabla/contract-world.json`, separate from genuine development play. `reset` replaces only this probe world. `restart` reloads the existing probe world. The external shared adapter is outside this nested project's tree fingerprint, so verification should explicitly name that repository input when comparing evidence across adapter changes.

## Authoritative Director clock

A host opts a new world into the clock with an explicit UTC epoch:

```sh
node cli/main.ts init --seed 17 --clock-epoch 2026-10-16T07:00:00.000Z
node cli/main.ts catchup --revision 0 --at 2026-10-16T07:18:00.000Z --id host-clock-check-1
node cli/main.ts tick --revision 3 --kind event --interval event-1 --at 2026-10-16T07:18:00.000Z --event calm --target 0 --model gpt-6.1-sol
```

`tick` and `catchup` are also JSONL operations with `expectedRevision` and `timestamp`. A tick takes `kind`, `intervalId`, `event` and `target`; event and review decisions require the submitting model. Clock catchup with no model is labeled `clock-service`, model null. These are deterministic clock mechanics rather than language-model decisions.

The authoritative clock adds ten calendar years per elapsed six-minute interval. It does not consume civilization turns or unlock unreleased features. Event and review ticks add no calendar years. A catchup call processes at most 240 due clock ticks and returns `remainingTicks`; a host should submit another current-revision request until it reaches zero. No local timer runs in this CLI. A host scheduler or server supplies timestamps independently of viewers. A world without an epoch rejects catchup rather than choosing a time silently.

Exported `timeline` preserves action, Director-tick and clock-catchup operations in order, with matching committed frames and provenance. A catchup frame can cover several clock revisions; `commands` contains ordinary turn commands only. Replay regeneration must follow `timeline` when present. Legacy action-only histories gain an inferred timeline when read, with no rewrite just for reading. Clock epochs and ongoing rules are never silently changed.

## Intentional history and compatible releases

`release-apply` applies one immutable registered successor to this run. Supply the exact source and target IDs, current revision, model and stable command id:

```sh
node cli/main.ts release-apply --revision 0 --from settlement-foundations-1 --to settlement-foundations-2 --model gpt-6.1-sol --id ship-foundations-2
node cli/main.ts history-advance --revision 1 --cause-kind feature --cause-id history-advancement --reason 'Verified delivery of intentional history progression' --years 75 --at 2026-10-16T08:00:00.000Z --model gpt-6.1-sol --id delivered-history-advance
```

The corresponding JSONL operations are `release-apply` with `expectedRevision`, `expectedFromReleaseId`, `targetReleaseId`, `model`, `commandId`; and `history-advance` with `expectedRevision`, `cause: { kind: 'feature' | 'event', id }`, `reason`, `deltaYears`, `timestamp`, `model`, `commandId`.

History advancement requires its shipped capability and a released feature or an actual retained event as evidence. The core records a durable receipt keyed by cause kind and id, including before/after years and an evidence snapshot. One cause advances history at most once; exact transport retries return the earlier receipt. Explicit jumps preserve the original clock epoch and tick count, so the next normal six-minute interval still adds ten years. Ordinary event/review ticks remain zero-year decisions, and tactical turns remain independent.

Release application accepts registered additive compatibility only. It changes released capabilities without resetting settlements, turns, the clock or prior history. Loads and deployments never apply releases automatically. Older worlds may have no history ledger; reading them leaves it absent, and the first accepted explicit advancement creates it. Legacy pre-clock worlds still require a separately authorized host migration before system operations.

The replay timeline adds typed `release-apply` and `history-advance` commands. Replay exact recorded target IDs through `applyRelease`, never a future mutable current-release alias. Existing action, tick and catchup entries keep their original inputs. Each operation has a distinct receipt namespace, including when a caller reuses the same text id across operations.

## Independent actions and economy beats

Apply the explicit compatible `settlement-independent-1` release with `--at` to set the independent cadence epoch. Older worlds remain sequential. Independent `action` commands also require `--at`; the CLI never reads the clock to decide their tactical allowance. An exact `--action` can be revalidated after unrelated revisions while holding the local writer lock. A numeric `--choice` remains revision-strict. Timestamps are part of idempotency identity and recorded engine commands.

`strategy-catchup --revision N --at UTC --id ID` is a separate protected-host equivalent, also available as JSONL `op: "strategy-catchup"`. It realizes at most sixty due one-minute economy beats and reports remaining work. Repeated no-due strategy calls retain durable receipts without inventing replay frames. Refused independent commands preserve the original campaign bytes. A due strategic boundary must be realized before another action can be admitted, so delayed host wakes may delay play. No CLI timer or automated agent decision is installed.

Independent observations have `activeSeat: null` and admission timing. Untimestamped local observations list structural intents; the explicit action timestamp is revalidated on submission. The replay timeline includes `strategy-catchup`, replayed through `catchUpStrategy`, and timestamped release/action commands. No active two-item plan queue is claimed in this slice.
