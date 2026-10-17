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

`strategy-catchup --revision N --at UTC --id ID` is a separate protected-host equivalent, also available as JSONL `op: "strategy-catchup"`. It realizes at most sixty due one-minute economy beats and reports remaining work. Repeated no-due strategy calls retain durable receipts without inventing replay frames. Refused independent commands preserve the original campaign bytes. On `strategy_catchup_required`, the caller can perform this preflight itself: read the result, continue bounded batches with fresh revisions and IDs until `remainingTicks` is zero, observe again, then choose and explicitly submit an action. No other actor or scheduler wake is required. No CLI timer or automated agent decision is installed.

Independent observations have `activeSeat: null` and admission timing. `observe --at UTC` checks admission and plan readiness at an explicit time; JSONL observations accept `timestamp`. Untimestamped local observations list structural intents and leave follow-up timing as `needs-review`. The explicit action timestamp is always revalidated on submission. The replay timeline includes `strategy-catchup`, replayed through `catchUpStrategy`, and timestamped release/action commands.

## Bounded plans attached to real actions

After explicitly applying `settlement-plans-1` from `settlement-independent-1`, an action accepts `--plan '[{"action":{"type":"wait"},"reason":"Reassess reserves before spending"}]'`, or the equivalent JSONL `plan` array. A plan has at most two items, each with an exact action and nonblank reason of at most 280 characters. Its first action must match the actual submitted `--action` or selected `--choice`. No separate planning command exists, so adding intent requires taking a real legal action.

The accepted record contains a `completed` head and optional `needs-review` follow-up, the original observed revision and actual committed revision. The CLI stamps original `expectedRevision` before exact-action rebasing and preserves both revisions and the exact plan in replay. Successful retries return the same durable `actionOutcome`; changed reasons under the same command ID are refused. Invalid plans, including unreleased nonempty attachments, leave original campaign bytes unchanged.

Read the detached `actionPlan` and `actionOutcome` status, code and reason. A successor may be ready, blocked or invalidated by current circumstances. It never reserves resources or executes automatically, including during strategy catchup. Reconsider and explicitly submit a chosen action after observing a result or changed conditions. An absent or empty attachment allows direct play and clears only that actor's previous plan after success; refusal preserves prior intent. Completed means the order was accepted, not that an ongoing project has finished.

## Paid building operation records

After explicitly applying `settlement-production-1` from `settlement-independent-1` or `settlement-plans-1`, the existing `action` command accepts `--action '{"type":"set-building-operation","cityId":"city-0","buildingId":"irrigation","enabled":false}'` with seat, revision, timestamp, model and command ID. Set `enabled` to true to resume. This is an ordinary owner-only tactical action, and it can be the head or reviewed successor of a bounded attached plan.

The city's `buildingOperations` record keeps the current toggle and the most recent economy result separately. Pausing preserves the previous result until another explicit strategy beat records `paused`; resuming also waits for a beat. An `operated` result reports actual paid inputs and produced outputs. A `blocked` result names each input shortage and has empty paid/produced maps. Allocation uses opening stocks, so same-beat output cannot pay another recipe's input. Distinct `buildingRecipes` definitions accompany observations without duplicating historical results.

Operation records travel with the same atomic campaign write and exact replay timeline as resources and plans. Invalid controls preserve file bytes; exact retries return the original receipt. Legacy free buildings retain absent operation maps. Corrupt records fail closed without repair, defaults or a rewritten save.

## Explicit frontier sources

After explicitly applying `settlement-frontiers-1` from `settlement-production-1`, select an observed `{ "type": "settle", "tileId": 21, "sourceCityId": "city-0" }` action and pass it through the usual `--action` command with seat, revision, timestamp, model and command ID. The numbers above are illustrative; only the current legal choices establish valid sources and sites. Three residents move from the named owned city, which must keep at least three; food, material and credit costs are paid once. The new city's focus comes from that named source.

An exact action can be revalidated after an unrelated revision, but never swaps its source or destination. On refusal, observe and decide again. A numeric choice is tied to its observed revision. Separate-process retries preserve the original command and receipt, and failed independent commands leave campaign bytes unchanged.

Saved commands and action timeline entries now share the core action-shape predicate. A malformed present source fails closed before replay export or further writes. An absent source remains valid for historical settle commands, preserving their original feature-gated replay behavior rather than inventing a migration or population correction.

## Choosing one city

After explicitly applying `settlement-specialization-1` from `settlement-frontiers-1`, copy the exact owned `cityId` from an observed focus or build choice into `--action`, for example `{"type":"focus","focus":"growth","cityId":"city-0"}`. Construction uses `{"type":"build","project":"farm","cityId":"city-0"}`. These examples describe the shape; current legal choices determine valid targets and projects.

Only the named city changes. A failed, foreign or already-satisfied target is never redirected to a different city, even during an exact-action rebase. Numeric choices stay revision-strict. Attached plans and replay retain the target and original observed revision; changing the target under the same command ID is refused. Independent refusals preserve campaign bytes.

Historical untargeted focus/build commands remain readable and replay their original all-city focus or first-eligible build behavior before the feature was released. Malformed present IDs fail the shared shape check on saved commands and timeline entries; no load-time target inference or save rewrite occurs.

## Repairing a damaged city

After explicitly applying `settlement-recovery-1` from `settlement-specialization-1`, select a current repair choice and submit `--action '{"type":"repair-city","cityId":"city-0"}'` with the usual seat, observed revision, explicit timestamp, model and command ID. The example gives the shape; current ownership, damage and available resources determine legality. Partial repairs pay the full catalogue cost, and an accepted repair uses the actor's normal allowance.

An exact retry returns its durable receipt without paying again. The target survives stale exact-action revalidation, bounded attached plans, process restart and replay. Invalid, healthy, foreign or unaffordable targets leave independent campaign bytes unchanged and are never replaced by another city. A failed request needs a fresh observation and an explicit model decision; no repair queue runs itself.

Current earthquake effects preserve infrastructure and leave repairable damage. Historical saves without `city-repair` continue replaying their original effects; loading never rewrites old damage or infrastructure. Malformed stored repair shapes fail closed through the shared action predicate. When a strategy beat is due, use explicit `strategy-catchup`, inspect remaining ticks, observe again and choose the next real action.

## Compact trade observations

Opt in for one read with `observe --seat 0 --at UTC --observation-format compact-trade-v1`, or JSONL `{"op":"observe","seat":0,"timestamp":"2026-10-16T00:00:00.000Z","observationFormat":"compact-trade-v1"}`. Use the intended explicit observation time; the example is illustrative. The response identifies its format and includes deduplicated `tradeFacts.cities`, current proposal `tradeFacts.recipes` and shared explanation semantics. Town facts derive from canonical site production; base yields precede focus, productivity, buildings and upkeep. Geometric hex distance is not a traversed path or travel time.

This versioned opt-in returns every legal action in its original order with a `choice` index on each `legalActions` entry. It omits the duplicate `choices` alias. Copy the full `action` into a normal submission, or use its numeric `choice` with the observed revision. Numeric choices remain revision-strict. Two-item plans, admission checks and explicit submission rules are unchanged; observation never executes an action or advances the world.

Pending offers and accepted agreements retain their authoritative snapshotted terms. Current recipe facts never replace old consent. Omitting the selector preserves the original observation, including unindexed `legalActions` and indexed `choices`. Unsupported or malformed format values fail before reading the durable save or acquiring its lock. The selector is accepted only on observation requests; it is rejected on other JSONL operations and is not a command setting stored in the world.
