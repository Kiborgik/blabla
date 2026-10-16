# Archive a run and start a named successor

Research-only recommendation, 2026-10-16, actual Astra/xhigh server owner. No lifecycle implementation, migration, live query or activation occurred.

## Decision and current boundary

Keep each run's existing rows in place. Add a small run catalogue and durable active-run pointer, then one explicit atomic `archive_restart` operation. Do not copy history, overwrite the old world, change `WORLD_ID` to simulate a restart, or make deployment/reload choose a new seed.

Current source supports the storage foundation but not this lifecycle:

- `world_state` is keyed by `world_id`; transitions by `(world_id,end_revision)` and receipts by `(world_id,receipt_key)`. Foreign keys preserve their parent. These already separate physical runs. The Worker always selects the configured `WORLD_ID` (default `main`); there is no catalogue, archived flag, active pointer or public run selector.
- Initialization inserts once and refuses an existing world. Hosted mutations atomically persist state, transition and typed receipt with revision CAS. Exact direct actions may rebase up to eight attempts. **Revision alone cannot identify a run:** a delayed old-run action must never rebase onto the successor.
- Current/initial snapshots and all historical frames remain available. History uses indexed, two-query byte-budgeted pages; chronicle omits snapshots. Private action readback is caller-scoped. Public provenance excludes authenticated actor IDs.
- CLI persistence is one locked JSON file with fsync/rename. `initialize(reset=true)` exists internally, but public CLI/protocol initialization passes false. That reset helper is replacement, not archival. `replay()` reads the whole local campaign and labels provenance; it is not a bounded hosted export.
- `createWorld` still starts foundations 1. The release registry defines compatible successors, not start-at-release templates or incompatibility declarations. `outcome` exists and terminal guards consume it, but no current engine path produces a victory or universal-collapse outcome. Population loss floors at one. Do not invent eligibility from a caller's reason, low stock or an arbitrary turn limit.

The existing goal's `lifecycle::*` expectations are unresolved and unregistered. A parent-owned lifecycle contract and prospective witnesses must precede implementation. The draft future-outcomes restart rule alone does not specify this operation.

## Minimal persistent and protocol seam

Proposed additive tables, not changes to existing snapshot bytes:

1. `world_heads(scope_id PRIMARY KEY, active_run_id, generation)`: `scope_id` is the stable configured namespace, initially the existing `WORLD_ID`; generation is a nonnegative safe integer.
2. `world_runs(run_id PRIMARY KEY REFERENCES world_state, scope_id, generation, name, registered_at, created_at, archived_at, final_revision, archive_cause_json, successor_run_id, archive_receipt_key, initial_sha256, final_sha256, source_digest)`, with unique `(scope_id,generation)` for indexed catalogue traversal. Nullable legacy creation time/source/hash means unknown, not invented provenance. Archive fields are set together once; active membership is decided by the head, not a second independently mutable active flag.

Retain the existing receipt table. Store `archive-restart:<commandId>` under the **source run**, with the existing canonical operation/input/caller fingerprint and a whitelisted response. The source run ID keeps the receipt reachable after several restarts. No receipt pruning or expiry is proposed.

Proposed input: `{expectedRunId, expectedGeneration, expectedRevision, newRunId, name, seed, targetReleaseId, cause, commandId, model}`. New IDs use a bounded ASCII slug; names are nonblank, at most 160 UTF-8 bytes; public explanation at most 512 bytes. Preserve exact values and reject malformed/extra fields before SQL. Never interpret a name as a path, SQL fragment or permission. IDs are unique; duplicate display names may be disambiguated by ID. Host UTC supplies the new clock/strategy epoch, so no inherited idle backlog appears.

The target is one exact registered startable release, never a mutable `current` alias or arbitrary feature list. A small core-owned constructor must initialize that release's required fields and return a canonical revision-zero initial state. Reuse feature initialization semantics; do not fake historical release commands or patch host-only fields. This constructor and startability declaration are prerequisites, not existing capabilities.

`cause` must bind either an actual committed terminal result or an explicitly registered incompatible source/target restart declaration. The latter must be distinguished from an unknown target, missing direct compatible edge or unfinished feature. Victory, all-collapse and incompatible expansion remain refused until their corresponding authoritative predicate exists. No automatic restart trigger is proposed.

## Atomic commit and retries

Use the existing prepared D1 batch interface. Its documented transaction semantics roll back the sequence on statement failure; a successful statement affecting zero rows is not a rollback signal. [D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

1. Authorize the existing enrolled Site identity and origin, validate input, and point-read the source receipt. An identical owned request returns its original source/final and successor/initial identities; changed input or caller conflicts. Do this before rejecting an already archived source, permitting exact read-only retries.
2. Read head, source catalogue and canonical source state together; require exact run, generation and revision. Validate cause and construct the bounded successor without writing. Do not realize overdue clock/strategy work implicitly.
3. In one batch, conditionally insert the source lifecycle receipt only when all source/head predicates still hold; insert the new state and catalogue; seal the source catalogue with its unchanged final revision/hash/cause; switch the head to the successor and generation plus one. Every subsequent statement must be gated by that exact newly eligible receipt and unchanged head predicate. The final switch also requires the matching sealed source and created successor. A stale first guard must make **all** statements no-ops; a uniqueness/constraint error must roll back everything. Prove this dependency chain in real SQLite tests, rather than checking affected rows after an unsafe batch already committed.
4. Inspect results; on a race or lost response, look up the original source receipt and return it if identical. Otherwise report stale/conflict and require a fresh explicit decision. Do not rebase a lifecycle operation onto a different revision/run or automatically choose another name, cause or seed. Database failures are not blindly retried.

Response: `{ok:true, operation:'archive-restart', commandId, archivedRunId, archivedRevision, newRunId, initialRevision:0, generation, archivedAt}`, with `duplicate` on exact retry. A current-head read is separate from this immutable result. Unknown transport outcome remains uncertain until supported readback; receipt absence does not diagnose a permission denial or authorize resubmission.

Archive is a service lifecycle fact, outside either world's action timeline. The old state, outcome, clock, plans, initial snapshot, transitions and pre-existing receipts remain byte-identical. Its archive summary links to the new initial snapshot. Nothing carries old tactical allowances, plans, offers or unpaid commitments into the new run. An explicitly incompatible restart may leave unfinished commitments in the frozen archive; its public reason must say so.

## Isolation, reads and authorization

- All mutation paths, including no-op catchups, initialization and releases, must bind a run before receipt lookup and enforce the active head in their SQL commit guards. Within-run exact-action CAS remains unchanged. After lifecycle activation, missing run identity is refused; revision cannot substitute. A staged compatibility window can accept omitted identity only while generation zero still points at the original legacy run.
- Keep the run selector outside the legacy operation fingerprint when adapting old requests: the existing receipt namespace already binds its run. This permits an exact old request plus explicit archive selection to reconcile its original receipt. Never rewrite stored fingerprints. Archived requests without an existing identical success cannot write.
- Add database guards against updates/deletes of archived state and inserts/updates/deletes of its transitions/receipts. Insert the lifecycle receipt before sealing. This protects against an old Worker request already in flight; application checks alone do not constrain old SQL. No unarchive path is included.
- Public `/api/runs` lists only the configured scope, default 20/max 100, keyset cursor by generation and `limit+1`, with bounded name/reason and whitelisted metadata. No snapshots, caller IDs or request JSON in catalogue rows. Public `/api/world`, `/api/history` and `/api/chronicle` gain explicit validated `runId` selection within that scope; omission follows the head. Return the resolved run ID/generation and bind subsequent cursors to it, never mix pages across a pointer change.
- Reuse history's 1 MiB input/output targets, complete oversized legacy singleton exception, encoded hard caps, sequential decode and existing `(world_id,end_revision)` index. Catalogue lookup adds at most one indexed membership/head read, not a history scan. Chronicle stays max 200 rows without snapshots; this is not a new chronicle byte-limit claim. Private `action_receipt` needs explicit archived run selection with its same ownership projection. Archived reads never tick or initialize.
- World ETags include the resolved run ID and revision. The browser currently identifies runs by initial seed/epoch and accepts any different identity; add explicit run ID and monotonic head generation so a delayed old response cannot replace the new run. A deliberately pinned archive view is a separate read-only viewing mode. No browser restart button.
- Reuse existing authentication/enrollment/origin checks; a model label is not authority. Today every enrolled writer has the same application privileges, so an owner-only administrative distinction must not be claimed. Before enabling this consequential tool, explicitly accept that existing caller boundary or separately authorize a narrower operation policy. No new credential or grant is implied by this design.

## Migration, rollback and executable successor

Generate a later additive Drizzle migration with SQL/snapshot/journal, preserving migration 0000. Register each existing physical world as generation-zero in its own existing namespace without rewriting its JSON, receipt or transition rows. Legacy `created_at` stays unknown; registration time is not world creation time. Schema migration may add metadata/guards, but must not switch a head or start a run. Keep the operation disabled until run-aware writers, readers, clients and archive guards are deployed and checked. Provider migration documentation does not verify the managed Sites application path. [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/).

Before the first switch, additive data can remain unused by a compatible reader. After a switch, rolling back to the current pre-lifecycle Worker would address the old configured world and ignore the pointer. Do not call that a safe rollback. Use a lifecycle-aware previous build or a read-only maintenance mode, retaining both runs; never reverse the pointer or delete the successor as error recovery. SQLite transaction behavior supports local failure-injection tests, not a claim about deployed backup recovery. [SQLite transactions](https://www.sqlite.org/lang_transaction.html).

First successor: register the lifecycle contract and write prospective repository/protocol tests for the two-table identity/atomicity seam, with core supplying explicit eligibility and start-at-release construction. Required witnesses:

1. Migrate an inhabited legacy fixture, including raw/encoded archive frames and no-op receipts: all old bytes/hashes and retry results survive. No seed, revision, clock or release changes on migration/reload.
2. Accepted authorized restart produces exactly one sealed run, one named successor, one head increment and one receipt. Close/reopen the actual SQLite file and read both worlds, every paged frame and the original receipt. Stored-frame replay remains accessible without regeneration.
3. Race action versus restart and two different restart requests: exactly one eligible serialization wins; no old action reaches the successor. Race identical restarts: one successor/receipt, duplicate response. Reuse the key with another name, seed, target, cause or caller: zero changes.
4. Force failure at each batch statement, including receipt/catalogue/head writes, and force the initial CAS guard to miss: no orphan successor, partial archive or changed active pointer. Simulate a lost post-commit response and return the original receipt after process restart.
5. Refuse stale/missing run identity, wrong scope, archived mutation, malformed names, colliding ID, unknown/non-startable target, unproven ending, false incompatibility, unauthorized/unenrolled/foreign-origin calls and corrupt source with zero writes. Direct old-style SQL against archived rows must also fail.
6. Page all old history exactly once; prove indexed plans, bounded row/byte selection, no empty `hasMore` loop and detached zero-write reads. Keep other-caller receipt absence indistinguishable and public output free of private audit fields. Delayed generation-zero browser replies cannot replace generation one, even with repeated seed/epoch.

Local CLI archive support should be separate: its one-file rename does not atomically coordinate two run files and a pointer. Keep ordinary reload/replay working; do not expose its internal reset as the hosted lifecycle operation.

Retaining frames gives faithful historical viewing. Regenerating them forever still needs preserved historical interpreters/catalogues; a source digest alone does not supply those. Archiving in place saves no storage. Prior measured snapshot duplication remains relevant, but this design introduces no encoding writer, deletion, quotas, native-memory or CPU guarantee.

## Research pins and evidence boundary

Inspected `server/{schema,repository,worker,action-receipt,history-budget,public-protocol}.ts`, migration 0000, CLI store/protocol/main, core types/release/initialization/evolution, browser live identity, mission/goals and prior storage/receipt research. Source SHA-256 at inspection:

- Repository: `a96c2d0acd1532cc56188544896fc8969c97189a596199135502ae318241a69c`
- Worker: `be498e1455b49246045521a01ecb2ec5764e317ef95ab9937b4e3f17631c2e91`
- Migration 0000: `4df9c9da6895ee4e794f4b387d48d2887600819b75869d963dee6596c83d1ec5`
- CLI store: `24ce54349908725ac64bcd9be49689168070b05ef0cd1b116b38b8b60e37d3b0`
- Release registry: `b8e03e1ed323c0d8fab9e22883edede97b608440329e9f48c390bf58df56e808`
- Browser live identity: `06e9bfd767b72ef18c7cf5ff239f9ec9867d0302de4b2434f1c29701bf2de59f`

The declared `node --test tests/content.test.ts` is a catalogue regression baseline only. It cannot prove any proposed archive operation, authorization change, migration, rollback or managed deployment. No lifecycle tests have been authored or run in this report-only task.
