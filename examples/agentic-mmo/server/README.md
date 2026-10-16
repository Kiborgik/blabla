# Authoritative hosting seam

This Worker uses the same pure game engine as the local agents. It has no Node filesystem dependency, browser-driven clock, autonomous agent policy or paid model API.

`server/worker.ts` exports `createWorker(assetResponder?, { now? })` and a default Worker with `fetch(request, environment)`. The optional asset responder returns a normal `Response` or null for a request. Integration can bundle an embedded asset map and pass its responder here; there is no assumed `ASSETS` binding. API routes take precedence over asset responses.

## Environment

- `DB`: the logical D1 binding provisioned by Sites
- `WORLD_ID`: optional run identifier; default `main`. Use a clearly named fresh online run and preserve existing local development histories separately
- `AGENT_WRITER_USER_IDS`: comma-separated, explicitly enrolled Site-scoped authenticated user ids. Missing or empty means all writes are denied

A raw bearer, request body user id, display name or Site account access-list id does not enroll a writer. The Worker relies on Sites dispatch to authenticate callers and inject the `oai-authenticated-user-id` header. Never expose this Worker through a route that bypasses that platform trust boundary.

The public spectator needs no sign-in. Authoritative writes require both a platform-authenticated identity and an explicit writer allowlist match. No custom credential is generated or stored by this source. Cross-origin writes are rejected. Internal verified operator ids are stored for audit and redacted from public history.

## HTTP routes

- `GET /api/world`: current and initial persisted state, with a weak world/revision/representation-version ETag; 503 before initialization. Send that ETag in `If-None-Match` to receive a bodyless304 when unchanged. Matching conditional reads select only the indexed revision, never load or parse snapshot JSON, and perform no writes. Weak/strong equivalents, valid tag lists and wildcard are supported. Changed reads retain the existing200 envelope and return an ETag for the actual state read
- `GET /api/observe?seat=0`: engine observation with indexed choices and release/clock metadata
- `GET /api/history?after=0&limit=50`: bounded chronological transition, frame and public provenance page. Maximum page size200. Follow `nextRevision` only when `hasMore` is true
- `GET /api/chronicle?after=0&limit=50`: the same bounded chronological transition, events and public provenance page without state snapshots. Its SQL never selects `state_json`. The existing `(world_id,end_revision)` primary-key index supports cursor traversal without an offset or duplicate index. This additive projection leaves full history and receipts intact
- `POST /api/init`: `seed`, explicit UTC `clockEpoch`, unique `commandId`; once only
- `POST /api/action`: `seat`, `expectedRevision`, either `choice` or exact legal `action`, `model`, unique `commandId`
- `POST /api/tick`: `expectedRevision`, `kind`, `intervalId`, explicit UTC `timestamp`, optional `event`/`target`; event/review decisions require `model`
- `POST /api/catchup`: `expectedRevision`, explicit UTC `timestamp`, unique `commandId`; optional submitting `model`

All POST bodies are JSON, bounded at64KiB while streaming. Epochs and tick timestamps beyond server time are refused. Revision conflicts and changed idempotency payloads return409. Invalid requests do not create transitions. Public reads never initialize, advance or rewrite the world.

`server/public-protocol.ts` owns pure shared public world, transition, provenance and page types. Consumers can import its types without loading server runtime. Chronicle and history redact the internal operator id through the same projection. Cache policy remains `no-store`; a viewer may retain its verified snapshot and ETag in memory for explicit conditional polling.

## MCP and explicit enrollment

`POST /mcp` provides stateless Streamable HTTP initialization, ping, tool discovery and calls using protocol version2025-06-18. `GET /mcp` returns405 because there is no SSE stream. It exposes `whoami`, `observe_world`, `initialize_world`, `play_action`, `director_tick` and `catchup_clock`.

Sites manages OAuth and connection authentication. Publish with the supported MCP capability, retrieve the provisioned plugin connection, and have the user install/connect it through the platform flow. Use a genuine authenticated `whoami` call to obtain the Site-scoped id before explicit operator enrollment. `whoami` requires identity but does not require writer enrollment. It returns only that caller's identity and enrollment status.

Enrollment remains a separate authorized runtime configuration step. Do not infer the Site-scoped id from the platform account id. A service bypass header alone creates no user identity. After enrollment, verify a protected write through the actual intended unattended connection and read back its persisted result before claiming hosted agents or schedules work.

## Durable writes and replay

`server/schema.ts` is the Drizzle schema. `server/drizzle.config.ts` generates the schema-only migration directory using pinned official `drizzle-kit@0.31.11` and `drizzle-orm@0.45.4`. From this project root, run `npx --no-install drizzle-kit generate --config server/drizzle.config.ts --name world` after a schema change. The initial migration, snapshot and `meta/_journal.json` were produced by that generator, with no seed or runtime DDL. Package the complete `server/migrations/` directory under the supported hosted Drizzle migration path, preserving the SQL, snapshot and journal together. Applied migration metadata is immutable; generate a later migration for future changes. No handler creates or alters tables.

D1 stores a bounded current/initial world row, append-only transition rows, and typed idempotency receipts. An atomic D1 batch conditionally inserts a transition only at the expected revision, CAS-updates the world, and inserts its receipt. All three roll back together on a statement failure. Action, Director and catchup receipts occupy distinct namespaces. Duplicate identical requests return the existing receipt; changed content is refused.

Transition rows carry exact engine inputs, resulting frame/events and provenance. Clock mechanics with no submitted model are labeled `clock-service`, model null. They are never described as LLM decisions. Replay regeneration follows the ordered transition union through the same engine. A catchup transition can cover several clock revisions.

Current, initial and history frame states are checked using the shared canonical world validator before exposure or engine arithmetic. Incompatible/corrupt data fails closed without automatic repair or a new seed.

## Clock realization

The engine's persisted epoch defines six-minute intervals worth ten calendar years. A protected catchup realizes due intervals, at most240 per request, with `remainingTicks` indicating further bounded work. Civilization turns and public readers are independent of that clock.

This source neither installs a cron nor claims exact six-minute execution. A ten-minute external scheduler can realize six-minute ticks late and must report that latency honestly. The host should retain the same supported connection, observe the current revision, submit catchup with a current UTC timestamp, retry a stale revision after rereading, and continue bounded batches while work remains.

## Verification boundary

Focused tests execute the real SQL using Node SQLite through a small D1-shaped adapter, exercising transaction rollback, competing revisions, receipt races, restart persistence, malformed input, corruption and authorization policy. These tests do not establish hosted D1 provisioning, Sites header sanitization, successful OAuth enrollment, the remote MCP connection or unattended scheduling. Those require explicit integration verification after publication. Anonymous header-spoof attempts must be denied by the deployed platform path before writer enrollment.

## Explicit evolution operations

Protected REST writes and MCP tools share the same repository, atomic CAS and authorization:

- `POST /api/release-apply`, MCP `apply_release`: `expectedRevision`, exact `expectedFromReleaseId`, exact `targetReleaseId`, `model`, stable `commandId`
- `POST /api/history-advance`, MCP `advance_history`: `expectedRevision`, `cause: { kind: 'feature' | 'event', id }`, `reason`, nonnegative safe-integer `deltaYears`, explicit UTC `timestamp`, `model`, stable `commandId`

History timestamps beyond server time are refused. Features must already be released; event causes must reference actual retained events. The core snapshots the evidence in a durable cause receipt, so later trimming of recent events cannot make the same cause eligible again. Exact retries return the operation-scoped transport receipt. A changed payload, stale revision or repeated cause never partially updates the world or audit history.

Release application uses an immutable registered compatible successor with exact source/target IDs, never arbitrary caller features or a mutable current-release alias. No load-time or deploy-time migration occurs. Public reads preserve older worlds with an absent optional history ledger. The first accepted explicit advance creates the ledger; malformed existing ledger entries fail canonical validation before exposure or arithmetic.

The append-only transition union includes `release-apply` and `history-advance` with their exact commands. Replay those through the same engine exports. Explicit year jumps leave clock epoch and tick accounting unchanged; normal six-minute intervals still add ten years. Routine Director events and reviews add zero years. Neither operation consumes tactical seats or rounds. The durable state ledger currently grows with intentional distinct event causes; a future archive design is needed before that ledger approaches the D1 row-size limit.

These source capabilities do not claim that a previously published frozen Worker has been updated. Deployment, authenticated capability discovery and actual operation readback are separate integration verification.

## Independent actor admission

The registered `settlement-independent-1` successor activates independent admission only through an explicit compatible release operation. The host stamps its UTC activation epoch; it never accrues strategy work from before activation. Existing snapshots and sequential actions retain their original rules and inputs. Deploying this source does not apply the release.

Each of the six ordinary actors has a data-defined tactical allowance, currently one accepted action per ten-second window, with no accumulating idle allowance. `activeSeat` is null in independent observations. Admission metadata reports the earliest next action and next economy boundary. Hosted observations additionally report `serverTimestamp` and filter choices using that receipt time. Action and release timestamps are authoritative host time; an actor cannot buy more allowance by supplying its own future time.

Exact submitted actions may be revalidated against the current world after unrelated revision changes, with at most eight CAS attempts and one frozen receipt timestamp. The engine rechecks ownership, resources, targets and allowance on each attempt. Numeric choices always require their observed revision. No retry changes an actor's choice. Duplicate receipt lookup also runs before returning a final failure, covering a duplicate that commits between the first receipt lookup and the snapshot read. Database errors are not blindly retried.

`POST /api/strategy-catchup` and MCP `catchup_strategy` take `expectedRevision`, explicit UTC `timestamp`, stable `commandId` and optional submitting `model`. They use the existing authenticated writer boundary and atomic state/history/receipt batch. Each call realizes at most sixty due one-minute economy beats and reports `remainingTicks`. No actor check-in is required. Production, research and standing agreements resolve on these beats; the six-minute calendar remains separate. The timeline records `strategy-catchup` and its exact timestamp for deterministic replay.

A tactical action at or beyond an unrealized economy boundary returns `strategy_catchup_required` with admission metadata and zero state changes. The authorized controller must realize due beats, then the model observes and explicitly submits its intended action. This prevents applying a new focus or building retroactively to older production. A refused action never commits hidden catchup. This slice does not execute queued plans or synthesize agent moves.

There is no verified exact one-minute unattended trigger in the current Site configuration. Supported external wakes can realize beats late; an absent or delayed controller can delay admission at a due boundary. Read-only Site inspection exposed no linked schedules and no managed database quota or tier, so generic D1 Free-tier limits are not asserted. Transition frames and receipts remain append-only; no pruning or SQL schema migration was added.

Implementation research used the official [D1 transaction documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/) and [retry guidance](https://developers.cloudflare.com/d1/best-practices/retry-queries/). The existing binding uses primary queries without the Sessions API; atomic batches preserve state, transition and receipt together.
