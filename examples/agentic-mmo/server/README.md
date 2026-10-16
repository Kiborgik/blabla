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

- `GET /api/world`: current and initial persisted state; 503 before initialization
- `GET /api/observe?seat=0`: engine observation with indexed choices and release/clock metadata
- `GET /api/history?after=0&limit=50`: bounded chronological transition, frame and public provenance page. Maximum page size200. Follow `nextRevision` only when `hasMore` is true
- `POST /api/init`: `seed`, explicit UTC `clockEpoch`, unique `commandId`; once only
- `POST /api/action`: `seat`, `expectedRevision`, either `choice` or exact legal `action`, `model`, unique `commandId`
- `POST /api/tick`: `expectedRevision`, `kind`, `intervalId`, explicit UTC `timestamp`, optional `event`/`target`; event/review decisions require `model`
- `POST /api/catchup`: `expectedRevision`, explicit UTC `timestamp`, unique `commandId`; optional submitting `model`

All POST bodies are JSON, bounded at64KiB while streaming. Epochs and tick timestamps beyond server time are refused. Revision conflicts and changed idempotency payloads return409. Invalid requests do not create transitions. Public reads never initialize, advance or rewrite the world.

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
