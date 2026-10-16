# Read back an uncertain action receipt

Research-only recommendation, 2026-10-16. No handler, schema, credential or live database operation was added. The discarded Verdant response remains unclassified by this research.

## Finding

No currently implemented read gives authenticated, per-caller command-receipt reconciliation. Add one read-only MCP tool, `action_receipt`, scoped initially to `play_action`. It should look up the existing `action:<commandId>` receipt and world revision in one indexed statement, authorize the existing enrolled Site caller and return only a small whitelisted outcome. Do not resend an uncertain action merely to discover whether it ran.

### What exists now

- `server/repository.ts`: private `receipt(key, fingerprint)` compares the complete canonical request, then reads the current world and returns the stored success with a refreshed revision. It is called inside mutation methods, not exposed as a read-only operation. Calling `play_action` to reach it can execute an uncommitted request; this is unsuitable for uncertainty involving a possible permission denial.
- `world_receipts` has primary key `(world_id, receipt_key)`, plus canonical `request_json` and `response_json`. The request records `actorUserId`, operation and input. Successful state-changing operations commit receipt, transition and state atomically. Successful no-op catchups can write only a receipt. Refused commands have no durable rejection receipt.
- `GET /api/chronicle?after=<observedRevision>&limit=50` exposes ordered `entries`, `hasMore` and `nextRevision`. Entries include `startRevision`, `endRevision`, transition, events and public provenance `{kind, model, seat, commandId, recordedAt}`. Follow its returned cursor. A matching command ID and transition corroborate a committed action, but public provenance intentionally omits authenticated ownership. This is not a private receipt lookup; no-op successes need not appear.
- `/api/history` adds full frames without adding receipt ownership. `/api/world`, `/api/observe` and MCP `observe_world` show current facts, not the outcome of a particular call. An active seat or unchanged state cannot identify a connector denial, transport failure or an uncommitted command.
- Source MCP discovery and the native catalog inspected at 13:30 expose no receipt-read tool. `whoami` proves only the current caller identity/enrollment. Source capability, deployed capability and native discovery must each be verified when the proposed tool ships.

These claims come from `server/repository.ts`, `server/worker.ts`, `server/public-protocol.ts`, `server/schema.ts` and `server/README.md`, not a query of protected data.

## Minimal proposed contract

MCP tool `action_receipt`, `annotations: {readOnlyHint: true}`, invoked through the existing authenticated `POST /mcp` connection. No additional REST route or generic SQL surface is needed for this slice.

Input is exactly `{commandId: string}`. Reuse the existing nonblank, maximum-200-character command-ID validation and preserve the submitted value exactly; do not trim or normalize the receipt key. No caller ID, seat, world selector, original action, credential or expected revision is accepted.

Success branches:

- `{ok: true, operation: "action", commandId, status: "accepted", observedRevision, acceptedRevision}`
- `{ok: true, operation: "action", commandId, status: "not_found", observedRevision}`

`observedRevision` is read in the same SQL statement as the receipt. `acceptedRevision` is the validated original committed revision, never replaced by the latest revision. Explicitly construct these response fields; never spread `request_json` or `response_json`. Preserve `no-store` responses. The tool must not call a mutation path, advance time, consume allowance, create a missing receipt or run an agent policy.

`accepted` proves that this Site-scoped caller owns the accepted action key in the selected world. It does not identify a particular model process sharing that caller identity, or prove a discarded request had identical content if the caller reused its command ID. The caller must retain unique IDs and its original intent. Existing exact-retry fingerprint checks stay unchanged.

`not_found` means no matching accepted receipt for this authenticated caller in that database read, whose world revision is reported. It does not mean rejected, denied, cancelled, never attempted or safe to retry. A pending request can commit after this read. This distinction also matters if the interface is later expanded to receipt-only operations, since those can commit without advancing world revision.

## Authorization, query and corruption boundaries

1. Reuse the existing platform-injected identity, explicit writer enrollment and origin checks before database access. An unauthenticated caller gets 401; an unenrolled caller gets 403. No new credential, permission expansion or enrollment path. Read-only annotations do not provide authorization.
2. Resolve the world only from the existing server configuration. Use one prepared point lookup: select `world_state.revision` with a left join to `world_receipts` on the same `world_id` and exact typed receipt key. Both existing primary keys apply; at most one receipt row is returned. Do not select snapshots or scan history.
3. Parse ownership only inside the trusted server. A well-formed other-caller receipt returns the same `not_found` shape as a missing receipt, without parsing or disclosing its response. Do not return actor IDs, stored request, action parameters, fingerprints or a conflicting-owner distinction. Private audit fields must not reach logs either.
4. Validate an owned stored request's operation and command ID against the selected key. Validate the stored success and safe integer revisions, with `0 <= acceptedRevision <= observedRevision`. Invalid stored ownership or malformed owned data is unavailable/corrupt (503), never fabricated absence or acceptance. A missing world is `world_not_initialized` (503). No repair occurs during readback.
5. A single statement avoids combining an old receipt lookup with a newer world revision. Cloudflare documents that non-session D1 queries use the primary; the current adapter uses that interface. This is documented provider behavior, not an independent verification of the managed Sites binding. If read sessions/replicas are introduced, require a primary-first read or an appropriate known bookmark before making freshness claims. The lost response cannot supply a missing write bookmark. [D1 read consistency](https://developers.cloudflare.com/d1/best-practices/read-replication/).

MCP supports input/output schemas, structured results and tool annotations; annotations are hints and proper access control remains necessary. Return the same minimal object in `structuredContent` and serialized text using the current dispatcher. [MCP tools, version 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).

## Deciding implementation tests

- Accepted action, later unrelated commits and process restart preserve the original accepted revision while reporting the current read revision.
- Missing and well-formed other-caller keys have identical responses; missing identity, unenrolled identity, forged body identity and foreign origin never expose private results.
- Invalid IDs fail before SQL; each valid initialized-world read uses one indexed query, returns at most one receipt and reads no snapshot. Database changes remain zero on every branch.
- A commit interleaving with lookup yields either a consistent pre-commit absence or post-commit acceptance, never contradictory revisions. A rolled-back action has no success receipt.
- Corrupt owned receipts and invalid ownership do not become accepted/not_found. Response and logs contain no stored requests, audit identities or unapproved fields.
- Existing identical retry, changed-content conflict, atomic rollback and public-history redaction regressions remain green. No implementation test may resubmit the actual uncertain live command.
- Verify actual deployed authenticated tool discovery and one explicitly authorized known receipt through the supported connection before claiming this capability is usable. No custom authentication headers or alternate route around a denial.

## Immediate operational disposition

Preserve the uncertain command ID and original input. Retain and inspect complete tool results in future calls. Public chronicle can provide corroborating committed facts; lack of a matching entry is not a denial diagnosis. If the original outcome cannot be recovered through supported records, report uncertainty and pause the dependent action. Any permission retry remains governed by the original permission boundary, not by receipt absence.

The declared `node --test tests/snapshot-codec.test.ts` is an eight-test baseline regression only. It does not exercise or prove the proposed receipt transport, caller isolation, hosted consistency or the uncertain live outcome. Those require the scoped successor and tests above.
