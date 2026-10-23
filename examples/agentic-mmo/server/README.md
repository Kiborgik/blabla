# Authoritative Worker

The Worker uses the same deterministic engine as the local observatory. Public reads are observational. Deployment, browser visits and GET requests never start or advance a hosted world.

## Configuration and access

`server/worker.ts` exports `createWorker(assetResponder?, { now? })` and a default `fetch(request, environment)` Worker. API routes take precedence over optional embedded assets.

- `DB`: logical D1 binding provisioned by Sites.
- `WORLD_ID`: optional world identifier, default `main`.
- `AGENT_WRITER_USER_IDS`: comma-separated enrolled Site-scoped authenticated user IDs. Empty denies writes.

Sites authenticates callers and injects `oai-authenticated-user-id`. Do not expose a route that bypasses that trust boundary. A raw bearer, body field or display name does not enroll a writer. Cross-origin writes are rejected. The public spectator needs no sign-in and has no faction commands.

## Fresh worlds only

**NO MIGRATIONS BEFORE RELEASE.** Initialize an empty world with a seed, explicit UTC epoch and optional registered starting rules. Unknown rule IDs and existing worlds are refused; initialization never replaces or upgrades a saved world. `POST /api/release-apply` and the former MCP `apply_release` name return `pre_release_migration_disabled` through the existing access boundary. Tool discovery omits the migration tool. History readers accept only current action, Director, clock, strategy and calendar transitions; retired migration command records are unsupported.

Do not delete external stored data to expose new content. Current-version restart and atomic writes remain required. This game policy does not remove the server's database schema setup.

## Public reads

| Route | Result |
| --- | --- |
| `GET /api/world` | Initial/current persisted world; conditional ETag reads supported |
| `GET /api/observe?seat=0` | Exact legal choices, facts and admission metadata |
| `GET /api/history?after=0&limit=50` | Bounded chronological transitions, frames and public provenance |
| `GET /api/chronicle?after=0&limit=50` | Events/provenance without state snapshots |
| `GET /api/simulation` | Configured policies and last actual wake, not scheduler health |

History pages are capped at 200; follow `nextRevision` only when `hasMore`. Public provenance redacts internal operator identities. Reads do not initialize state, perform clock catchup or rewrite history.

Observation may select `compact-trade-v1` for factored complete choices, or `compact-trade-pages-v1` for pages of 20 complete actions. Retain first-page context and follow its opaque `choiceCursor`. Cursors bind world, revision, seat, time and projected facts. A stale cursor requires a fresh observation; it is not a reservation. Omit the selector for the default format.

## Authenticated operations

POST bodies are JSON and limited to 64 KiB. Use stable unique command IDs and read the actual response before retrying. Revision or changed-idempotency conflicts return 409.

| Route | Essential fields |
| --- | --- |
| `/api/init` | `seed`, `clockEpoch`, `commandId`; optional `registeredRulesId` |
| `/api/action` | `seat`, `expectedRevision`, exact `action` or indexed `choice`, `model`, `commandId` |
| `/api/tick` | `expectedRevision`, `kind`, `intervalId`, `timestamp`; event/target/selector where required |
| `/api/catchup` | `expectedRevision`, `timestamp`, `commandId` |
| `/api/strategy-catchup` | `expectedRevision`, `timestamp`, `commandId` |
| `/api/history-advance` | Current revision, exact cause, reason, years, timestamp, model and command ID |
| `/api/simulation/activate` | `expectedRevision`, `enabled`, `commandId` |
| `/api/simulation/run` | `commandId` |

Copy exact currently observed actions and selectors; examples and catalogue IDs do not establish legality. Numeric choices are revision-strict. Supported exact actions can revalidate the same intention after unrelated commits, never choose replacements. The `strategy-action` action envelope atomically realizes bounded due upkeep and validates its exact inner action at the original revision; refusal commits neither. Large backlogs require explicit upkeep-only calls first.

Calendar catchup realizes at most 240 due six-minute intervals; strategic catchup realizes at most 60 one-minute economy beats. Inspect remaining backlog and use returned revisions. Host time governs tactical admission. An intentional history advance records an actual cause and never installs new rules.

## MCP and autonomous hosting

`POST /mcp` supports stateless Streamable HTTP initialization, discovery and calls. `GET /mcp` returns 405; no SSE stream is provided. Discover current tools rather than relying on a copied list. `whoami` returns the authenticated caller's Site-scoped ID for explicit enrollment. Sites manages the connection/authentication; do not derive enrollment from a platform account ID.

Activation enables or pauses supported versioned server policies without taking a game action. A wake uses one host timestamp, clears bounded backlog and chooses at most one legal action per actor for the current window. Missed tactical allowances do not accumulate. Unsupported policy versions fail before writes. The browser's current local policy is not automatically supported or activated on the host.

No native cron is installed by this source. Unattended hosting needs a separately configured supported wake source and verified authenticated readback. Status reports the last completed wake, not continuous activity.

## Persistence and build

D1 atomically commits the conditional world update, transition and receipt. Duplicate identical requests return their original accepted result; changed payloads conflict. Reconcile uncertain transport/database outcomes through the original receipt rather than issuing a replacement action. Current state and public frames are validated before exposure. Policy memories and exact provenance persist across Worker restarts.

`server/schema.ts` and `server/drizzle.config.ts` define database schema generation. Package the generated `server/migrations/` SQL, snapshots and journal together; handlers do not run DDL. Do not edit already-applied schema metadata.

From the game directory, `npm run build` creates the browser assets and embeds them in `dist/server/index.js`, records source/output provenance and verifies the bundle. Local SQL/authorization tests do not establish managed D1 provisioning, OAuth enrollment or deployed scheduling. Publication, runtime enrollment and deployment remain separate operations.
