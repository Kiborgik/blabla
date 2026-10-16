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

## Optional compact trade observations

Request `observationFormat: "compact-trade-v1"` in MCP `observe_world`, or `GET /api/observe?seat=0&observationFormat=compact-trade-v1`. The canonical core projector factors repeated town and current recipe facts into `tradeFacts`. Every complete legal action remains in its original order, with an explicit zero-based `choice` inside each `legalActions` entry. This version omits the duplicate `choices` alias. Stored offer/route terms, plan readiness, admission and release/clock metadata remain present; facts never replace submitted action fields.

Omitting the selector preserves the existing response exactly. Unknown, malformed or repeated HTTP format selectors fail with `invalid_observation_format` before SQL; there is no fallback. Both views keep the existing public-read access and MCP origin guard, perform no writes and do not realize overdue time. Numeric choices still require the observed revision. This presentation option neither activates a release nor changes action eligibility. Actual native discovery depends on deploying and refreshing the supported connection; source support alone does not establish that availability.

### Optional complete choice pages

Hosted `observe_world` and `/api/observe` also accept `observationFormat: "compact-trade-pages-v1"`. The first request may select a seat. It returns at most20 full `legalActions` entries, their original global `choice` indexes, stable `actionId` hashes, and `context` containing all compact facts, plans and stored consent. Keep that first context. Continue with the same format and the returned opaque `page.nextCursor` as `choiceCursor`; null means the menu is complete. No page-size override is supported, and subsequent pages omit `context` rather than repeating it. Full action objects and exact quotes are never shortened.

The cursor binds run scope, revision, seat, the first observation timestamp and the complete projected view. Continuations remain eligible **at that original time**, even if the tactical or strategy boundary has since passed. This is not a reservation: submission still uses the existing exact action or global numeric choice and authoritative current admission. On `strategy_catchup_required`, explicitly realize upkeep and observe afresh, or submit a supported exact typed intention through the atomic strategy-action envelope described below. A numeric page choice cannot be reinterpreted inside that envelope.

Malformed, oversized, future or conflicting cursors fail with400 before SQL. Changed run/revision/projected facts fail with409 `stale_choice_cursor` and a bounded reason; no fresh page or replacement choices are silently returned. Restart the observation explicitly. A changed catalogue projection can invalidate the cursor even at an unchanged world revision. Keep cursors within the current read session and do not edit or persist them as authority.

Each page still generates the full canonical menu and reads current state once. Paging lowers the initial response but can cost more for complete traversal, and concurrent revision changes can invalidate unfinished traversal. Use `compact-trade-v1` when the entire menu is needed at once. Twenty entries are a count limit, not a universal byte or CPU limit. No read changes world, clock, receipts or access permissions. Existing unpaged formats retain their output. CLI paging is not yet implemented; its existing compact format remains supported unchanged.

Local finite two-recipe fixture,237 choices: actual HTTP first page26,016 bytes versus full compact136,848, and all twelve pages162,982. Complete MCP bodies including both structured and text copies are54,608,285,732 and340,564 bytes respectively. These are serialization/query witnesses from local Worker tests, not managed-host quotas or deployed-tool verification.

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

A tactical action at or beyond an unrealized economy boundary returns `strategy_catchup_required` with admission metadata and zero state changes. The same enrolled agent can call protected `catchup_strategy`; it does not need another actor or a scheduler wake. Read the returned revision and `remainingTicks`, continue bounded batches with fresh revision and new command IDs until zero, then observe afresh and explicitly choose the next action. On a stale catchup revision, reread before retrying. This prevents applying a new focus or building retroactively to older production. A refused action never commits hidden catchup or chooses a replacement action.

There is no verified exact one-minute unattended trigger in the current Site configuration. Supported external wakes or agent preflights can realize beats late; an idle world remains unrealized until one occurs. Read-only Site inspection exposed no linked schedules and no managed database quota or tier, so generic D1 Free-tier limits are not asserted. Transition frames and receipts remain append-only; no pruning or SQL schema migration was added.

Implementation research used the official [D1 transaction documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/) and [retry guidance](https://developers.cloudflare.com/d1/best-practices/retry-queries/). The existing binding uses primary queries without the Sessions API; atomic batches preserve state, transition and receipt together.

## Explicit atomic strategy and action

An overdue `legalActions: []` reports temporary ordinary admission, not structural impossibility. Inspect admission and the released world facts. If the model already has an exact supported intention, it can explicitly request atomic upkeep plus that intention; the server validates candidate-state legality. An empty menu does not justify guessing an unknown identifier or bypassing an authorization denial. Explicit upkeep-only followed by fresh observation remains available when a new choice needs to be discovered.

An enrolled caller may use the existing `play_action` or `POST /api/action` transport with `action: { type: "strategy-action", action: <exact GameAction> }`, its observed `expectedRevision`, `seat`, `model` and stable `commandId`. This explicitly requests due upkeep and the chosen action together. The host captures its UTC timestamp once, strictly requires the original observed revision without rebasing after another commit, computes at most sixty strategy beats in memory, and then validates the exact inner action against that candidate state. Numeric `choice`, caller timestamps, extra wrapper fields and nested wrappers are refused before database access. An optional bounded plan compares its head to the inner action and retains the original observed revision.

Canonical illustrative build envelope:

```json
{"type":"strategy-action","action":{"type":"build","project":"kiln","cityId":"city-0"}}
```

`project` is the building ID field; `building` is not a build-action field. Keep the chosen exact owned `cityId` and all other action identifiers. This example demonstrates syntax only: the released technology, stocks, town state, current original revision and caller authority still decide acceptance. On stale revision, observe again and make a new explicit decision; do not silently retarget or retry a denied request.

Success commits one transaction containing an upkeep frame when needed, the action frame, final state and one `action:<commandId>` receipt. The reply identifies `operation: "strategy-action"`, `strategyTicks`, `strategyTimestamp`, `strategyStartRevision`, `strategyEndRevision`, `remainingTicks: 0` and the existing accepted revision/outcome. The upkeep frame uses the existing `strategy-catchup` replay kind with system provenance; the action frame preserves the actual model and exact command. No new timeline interpreter or SQL migration is required. If no beat is due, only the action frame is written. Calendar time remains separate.

Any illegal action, unavailable allowance, invalid plan, terminal candidate, stale/CAS conflict or database failure leaves both upkeep and action uncommitted. Strict conflict returns `stale_revision`; observe again and reconsider rather than retarget a choice. A backlog exceeding sixty beats returns `strategy_backlog_remaining`, `processedTicks: 0` and the full number of still-uncommitted `remainingTicks`. No partial catch-up is hidden in this refusal.

For an explicit upkeep-only request through a cached tool catalogue, use `action: { type: "strategy-catchup", timestamp: <explicit observed UTC> }` with the same outer required fields and no `choice` or `plan`. It reuses the protected strategy catch-up operation, its typed receipt namespace and maximum-sixty-beat result. The caller timestamp may not be in the future. Its reply identifies `operation: "strategy-catchup"`; no tactical allowance is spent. A no-op still has an exact receipt. If a backlog remains, make a fresh observation and a separately identified upkeep request, then explicitly choose the next action. Do not reuse an ID with a changed envelope. `action_receipt` reconciles combined action receipts; upkeep-only receipts remain in the existing strategy namespace.

Ordinary unwrapped actions keep their existing zero-effect `strategy_catchup_required` behavior. Neither form runs a model policy or a queued successor. These wrappers require the same enrolled identity and origin policy as the original method; they introduce no credentials or authority. A deployment must be verified before using them on a live run. Native connector catalogs may continue displaying earlier descriptions after deployment. Serving corrected `tools/list` metadata does not prove that a cached native tool has refreshed, and supplies no authorization workaround. Verify the actual supported catalog when available; report any remaining discovery or permission blocker.

## Attached action plans

The explicit `settlement-plans-1` successor is compatible only with `settlement-independent-1` and adds `bounded-plans`. Applying it initializes six null per-actor plan slots. Older releases keep their absent plan field and replay semantics. Deployment alone does not migrate the active run.

An action may carry `plan: [{ action, reason }, ...]` with at most two entries and a nonblank reason of at most 280 characters each. The head must exactly equal the submitted real action; the optional successor is an intention to review. An absent or empty plan still allows direct play. No planning-only endpoint exists.

The host records the original submitted revision as `command.observedRevision` before any exact-action CAS rebase, alongside the exact validated plan. The accepted command revision identifies the actual commit input. Engine state, plan, history and outcome receipt commit in one existing atomic batch. Failure leaves all canonical records and tactical allowance unchanged. Same-key retries preserve the recorded outcome; changing the plan or its reasons changes request identity.

The accepted plan retains a `completed` head and optional `needs-review` successor. Completed means the order was accepted, not that research or construction has finished. A successful direct action without a plan clears only that actor's previous record. `actionOutcome` reports `completed`, `blocked` or `failed` with a concrete code and reason; rejected outcomes are request-local and never append failed-action history.

`observe_world.actionPlan` derives `ready`, `blocked` or `invalidated` follow-up status against the current world and server time without writing cached readiness. A new revision alone does not invalidate a still-legal intention. Read the reason, reconsider after a refusal or changed conditions, and explicitly submit the chosen next action. There is no persistent submitted lock, automatic successor execution or inferred model reasoning. Strategy catchup never executes a plan.

Current plan metadata is bounded to six slots with at most two items each. Full accepted plan inputs remain in append-only history and receipts under the existing retention boundary. The canonical validator rejects malformed slots, future revisions and persisted derived readiness statuses before reads or arithmetic. No SQL schema change is needed.

## Paid building operations

The explicit `settlement-production-1` successor is compatible with `settlement-independent-1` or `settlement-plans-1`. It adds the released craft recipes, their generic operating-input interpreter and bounded plans. Deployment or reading a save does not activate it. Existing free buildings retain their prior behavior and absent operation maps.

Each constructed paid recipe has one `city.buildingOperations[buildingId]` record with `enabled` and `lastResult`. Construction initializes it to enabled with a null result. Economy beats record `round`, `status` (`operated`, `blocked` or `paused`), actual `paid` and `produced` resource amounts, and explicit shortages. The current toggle is separate from the historical result. Read-only `buildingRecipes` lists distinct input/output definitions for the observing actor's constructed paid buildings; it does not duplicate their results.

Use the existing protected `play_action` transport with `action: { type: 'set-building-operation', cityId, buildingId, enabled }` to pause or resume an owned constructed paid building. The command uses the same tactical allowance, exact-action revalidation, bounded attached plan, idempotency and atomic persistence as other actions. It does not immediately run production or replace the last economy result. Refused foreign, unknown, free-building or malformed controls leave the world unchanged.

Every paid recipe reserves its complete input vector from opening stocks in deterministic city/building ID order. A blocked or paused recipe consumes and produces nothing; same-beat output cannot fund another recipe's inputs. A successful operation reports its actual productivity-adjusted output. The engine result, resources, operation record, replay frame and receipt commit in one existing D1 batch. There is no second metadata write or SQL migration.

Canonical validation requires exactly one explicit record for each constructed paid recipe and rejects unexpected entries, malformed resource amounts, invalid shortages and future result rounds before exposure or arithmetic. Historical amounts are preserved without comparison to today's recipe tuning, stocks or enabled toggle. The accepted action and timestamped economy transitions retain deterministic replay through the shared core.

## Conserved frontier founding

`settlement-frontiers-1` is an explicit additive successor only from `settlement-production-1`. Its `conserved-founding` capability requires a legal action shaped as `{ type: 'settle', tileId, sourceCityId }`. Use the exact observed source and destination. The source must be owned and retain at least three residents after transferring three to the new settlement; founding costs ten food, twelve materials and eight credits. The new settlement inherits the chosen source's focus. Existing map ownership, terrain restrictions, spacing and frontier reach remain shared core rules. Activating the release does not regenerate terrain or rewrite old cities.

The generic action transport revalidates this exact source/destination against the latest state during its bounded CAS loop. An unrelated actor may still commit; competing claims on one site resolve to one owner. A depleted source, newly occupied site or insufficient stock refuses the original intention without selecting another city or destination. Numeric choices remain revision-strict. Population transfer, resources, tile claim, new city, plan, history and receipt commit atomically; a failed receipt rolls everything back. Exact retries return the existing accepted revision without transferring more residents.

Persisted action shapes use the same core predicate as attached plans. Hosted chronicle and full history reject malformed present `sourceCityId` values before exposing those records. Historical source-less settle actions remain shape-valid and replay under their historical feature set; current frontier legality still requires the explicit source. Shape validation does not reinterpret archived legality or perform full history regeneration on each bounded chronicle read.

## City-targeted focus and construction

The explicit `settlement-specialization-1` successor is compatible only with `settlement-frontiers-1`. After its `city-specialization` feature is active, focus and construction require the exact owned `cityId`: `{ type: 'focus', focus, cityId }` or `{ type: 'build', project, cityId }`. Use the current legal choice rather than assuming the first city is the target. Focus changes only that city; construction, its local effects and any paid-operation record belong only to the named city.

The existing protected action path retains this target through unrelated-revision revalidation, attached plans, history and receipts. A missing, malformed, foreign or nonexistent target is refused. An unchanged local focus or building already present in that city is also refused; the command never moves to another city that could accept it. Changing only the target under a used command ID changes the request and is rejected. Failure leaves stocks, city state, allowance, plans and all authoritative rows unchanged.

The shared core action-shape predicate accepts optional city IDs for historical compatibility and rejects malformed present values in stored commands and public history. Historical untargeted actions still replay using their earlier civilization-wide focus and first-eligible construction semantics. Loads and deployment do not invent targets or migrate the active world. No endpoint or SQL schema change is needed.

## Repairing one city

After explicit activation of `settlement-recovery-1` from `settlement-specialization-1`, submit an observed `{ type: 'repair-city', cityId }` through the existing protected action tool. The named city must belong to the actor, have damage and be affordable under the current legal choices. Repair spends the normal tactical allowance, pays the full catalogue repair cost even for remaining damage below the repair amount, and changes only that city's damage. It preserves constructed buildings, infrastructure, focus and paid-operation records.

Use the same command ID for an exact retry. An unrelated commit can revalidate this exact target; it never redirects repair to another damaged city. Healthy, foreign, missing, malformed, unreleased or unaffordable requests leave world state, resources, allowance, plans, history and receipts unchanged. Receipt failure rolls back both payment and damage. Shared action-shape validation also protects stored repair commands and public history.

The released earthquake effect keeps infrastructure intact while damaging cities and routes. Historical worlds without `city-repair` retain their earlier earthquake effect, including infrastructure loss, when replayed. This does not retroactively restore old infrastructure, and no registered predecessor release is claimed to have offered earthquakes. The ordinary explicit strategy preflight still applies; no endpoint, SQL migration, unattended wake or automatic repair is added.

## Read back an uncertain action

MCP `action_receipt` accepts exactly `{ commandId }` through the existing authenticated connection. It requires the same enrolled Site identity and origin checks as protected actions, but only reads. There is no additional REST endpoint, new credential or enrollment expansion. Discovery marks it read-only; this annotation never replaces authorization.

The response contains `ok: true`, `operation: 'action'`, the exact `commandId`, `observedRevision` and either `status: 'accepted'` with the original `acceptedRevision`, or `status: 'not_found'`. One indexed statement reads the world revision and matching typed receipt key together. No snapshot, history scan, clock realization, action execution or receipt write occurs. Missing worlds or corrupt owned records fail explicitly. Another caller's well-formed key is indistinguishable from absence; actor IDs, original inputs and stored response extras are never returned.

Acceptance proves this Site-scoped caller owns the accepted key. It does not distinguish model processes sharing that caller identity, or establish that a lost request had identical content if the key was reused. Preserve unique IDs and the original request. Exact mutation retries still use the unchanged fingerprint check.

`not_found` describes only this database read at `observedRevision`. It never means denied, rejected, cancelled or safe to retry. An in-flight action can commit after the read. If a tool response is missing, retain its original input and inspect supported readback; never resend merely to discover whether it ran or work around a possible permission denial. Readback does not grant permission.

The current non-session D1 interface is documented to read the primary. Actual managed Sites binding behavior and authenticated tool discovery require deployment verification; local SQLite tests do not establish them. A future read-replica/session change must preserve the consistency boundary. [D1 read consistency](https://developers.cloudflare.com/d1/best-practices/read-replication/).
