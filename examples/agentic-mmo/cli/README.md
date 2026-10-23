# Headless world interface

Run with Node 24. The default store is `.blabla/world.json` in the working directory; `--state PATH` selects another store. No renderer or runtime language-model API is required.

```sh
node /path/to/examples/agentic-mmo/cli/main.ts init --seed 17
node /path/to/examples/agentic-mmo/cli/main.ts observe
node /path/to/examples/agentic-mmo/cli/main.ts action --seat 0 --revision 0 --choice 0 --model gpt-6-astra --id first-choice
node /path/to/examples/agentic-mmo/cli/main.ts replay --out replay.json
```

The action example applies only if that exact observed choice is currently legal. Five civilization seats and the Director use seats 0–5. `--model` records the submitter; it does not describe built-in policies as language-model players.

## NO MIGRATIONS BEFORE RELEASE

`init --rules REGISTERED_ID` chooses a fresh starting configuration; `--clock-epoch UTC` supplies an explicit cadence epoch. Unknown IDs and existing stores are refused. There is no production state-in/state-out release upgrader. `release-apply` returns `pre_release_migration_disabled` before loading or writing a world.

Use a clearly distinct new state path for a fresh version; do not silently overwrite or delete an external save. Current-version restart, resource accounting and exact replay remain required. Historical release records are inert decoding support, not a migration interface.

## Observe and act

`observe --seat N --at UTC` returns the current revision, legal actions and admission timing. Independent worlds need explicit action timestamps. Untimestamped observations cannot promise timed admission.

Submit either the observed `--choice N` or the complete `--action JSON`, with `--seat`, `--revision`, `--model`, `--id` and `--at` where required. Numeric choices are revision-strict. Exact actions may revalidate the same target after unrelated revisions; they never redirect to another town, route or partner. Copy current legal action fields instead of inventing identifiers.

An optional `--plan JSON` contains at most two reasoned exact actions; the first must match the submitted action. Follow-up plans are recorded intentions, not automatic execution or reserved resources.

Keep the same command ID and identical payload for an uncertain retry. A duplicate returns its original receipt without charging again. A changed payload under that ID is refused. Refused valid operations return `ok: false`; read that field rather than relying only on process exit status. Malformed CLI syntax exits nonzero.

`observe --observation-format compact-trade-v1` returns factored facts and all complete indexed legal actions without the duplicate choices alias. The default format is unchanged when omitted. Hosted cursor paging is described in [server usage](../server/README.md); CLI paging is not implemented.

## Explicit time

- `catchup --revision N --at UTC --id ID` realizes up to 240 due calendar intervals.
- `strategy-catchup --revision N --at UTC --id ID` realizes up to 60 due economy beats.
- `tick --revision N --kind event --interval ID --at UTC --event EVENT --target N --model MODEL` submits an exact Director event. Qualified regional events also require the complete observed `--regional JSON` selector.
- `history-advance` takes revision, `--cause-kind`, `--cause-id`, `--reason`, `--years`, timestamp, model and command ID. The cause must already exist; this operation does not install rules.

Inspect `remainingTicks`, continue explicit bounded catchup if needed, then observe again. Clock catchup records clock mechanics, not agent decisions. No CLI timer or unattended scheduler is installed. Routine event/review ticks do not add calendar years.

## JSONL

With no arguments, or `serve`, the CLI reads the shared BlaBla JSONL transport. Responses preserve request IDs:

```jsonl
{"id":1,"op":"init","seed":17}
{"id":2,"op":"observe","seat":0}
{"id":3,"op":"action","seat":0,"expectedRevision":0,"choice":0,"model":"gpt-6-astra","commandId":"first-choice"}
{"id":4,"op":"replay"}
```

The protocol uses `expectedRevision`, `timestamp`, `commandId`, `registeredRulesId` and typed action fields rather than CLI flag names. Malformed JSON/non-object lines are reported on stderr and skipped; later requests continue. Protocol refusals return `ok: false`.

## Persistence, replay and contracts

A process lock, synced temporary file and atomic rename commit state, commands, frames and provenance together. Restart loads the last committed revision. Corrupt or incompatible data fails without repair, reseeding or overwrite. Replay exports only actual accepted history; an unfinished world stays unfinished. Follow the recorded timeline, not just its ordinary-action subset, when reproducing clock and strategic transitions.

`cli/adapter.ts` exposes BlaBla contract `reset`, `call` and `observe` through the shared TypeScript adapter. It uses a separate `.blabla/contract-world.json`; reset replaces only that probe world, while restart reloads it. Registered probes exercise real engine operations from explicitly constructed prerequisites. They are not model play or proof of a naturally earned full campaign. Keep source receipts, focused regressions and organic observation separately attributed.
