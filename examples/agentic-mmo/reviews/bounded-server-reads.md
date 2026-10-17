# Bounded server reads review

Reviewer: gpt-6-astra. Reviewed 2026-10-16 UTC. The broad implementation retains the pre-policy gpt-6.1-sol authorship recorded on `implement-agent-interface`. After identifying the parser defect below, this reviewer received a separate instruction to author its narrow repair under the existing implementation task. That repair requires the orchestrator's independent deciding-diff review; the review below is not self-approval of it.

## Verdict

One narrow HTTP interoperability defect was found and repaired, pending the orchestrator's independent review. The bounded chronicle projection, existing authenticated write boundary, CAS transaction, full replay history and optional trade-state validation otherwise passed this focused review of the predecessor implementation. This is not a project-completion or hosted-quota verdict.

## Finding 1: matching entity-tag lists lose the fast path when they contain empty elements

`server/worker.ts:29-42` parses an entity tag immediately at the start of every loop. After a trailing comma, or before a leading or doubled comma, the expression fails and returns false even if a matching tag was already found. For a world at revision 0, `If-None-Match: W/"world-v1-main-0",` therefore reaches the full-read branch instead of the bodyless 304 branch. Leading and interior empty elements have the same problem.

RFC 9110 section 13.1.2 defines this field as `"*" / #entity-tag`; section 5.6.1.2 requires recipients to tolerate a reasonable number of empty list elements. The current ordinary-list tests do not exercise that rule. The practical consequence is unnecessary snapshot loading, parsing and transfer for an unchanged representation. No write authorization or persisted state is bypassed.

Repair the list parser with bounded handling of empty elements and add focused cases for leading, trailing and repeated separators. Preserve weak comparison, opaque tags containing commas, whole-field rejection of malformed nonempty members, wildcard handling, and the one-query/no-body/no-write guarantee.

Repair status: a prospective regression reached a real `200 !== 304` assertion failure with the original parser, while the other 77 tests passed. The narrowly amended parser accepts up to 32 empty elements and still rejects malformed nonempty members or a mixed wildcard list. The new test checks leading, trailing and doubled separators, opaque commas, the 32/33-element boundary, one revision-only query, no body and no persistent changes. The exact protocol check subsequently passed 78 tests and scoped lint. Authorship of this correction is gpt-6-astra; independent acceptance belongs to the orchestrator.

Primary reference: https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.2 and https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2.

## Verified implementation

- `server/public-protocol.ts` contains type-only domain imports and shared public DTOs. Hosted provenance extends the public shape with its private operator field; both HTTP history paths use the same explicit public projection.
- A matching normal ETag reads only `revision` with a `world_id` equality lookup. The test deliberately corrupts both snapshot JSON strings after obtaining an ETag, then verifies a bodyless 304, no snapshot columns, no database batch and unchanged `total_changes()`. This establishes avoided application snapshot loading and parsing, not a claim about managed-provider billing.
- A mismatched tag performs a full validated read and derives the returned ETag from that read's actual revision. World ID and representation version are included in the tag. Uninitialized or unavailable databases retain their explicit errors.
- Chronicle pagination validates a safe nonnegative cursor and a limit of 1–200 before SQL. It selects at most `limit + 1` rows, orders by `end_revision`, uses no offset and omits `state_json` from the selected columns. SQLite's actual query plan uses the existing `(world_id, end_revision)` primary-key index without a temporary sort. No extra index or migration is needed for this query shape.
- Cursor evidence includes an action from revision 0 to 1 followed by a three-tick transition from 1 to 4. Paging follows end revisions rather than assuming one row per revision.
- Full `/api/history` still loads and validates snapshots, retains exact transition inputs and supports replay through the shared engine. Chronicle does not discard or rewrite snapshots or receipts; its ability to read a chronicle when a separate stored snapshot is corrupt does not claim that snapshot is valid.
- The route additions are read-only. Protected REST and MCP mutations retain enrolled platform identity, same-origin checks, bounded payloads and the existing repository transaction. Tests exercise competing revisions, identical retries, changed idempotency payloads and rollback of the complete state/transition/receipt batch.
- Optional trade validation checks field shapes, finite resources, references, immutable consent terms, cadence, lifecycle counters and pair bounds. The 31 mutation cases reject malformed data. Positive cases retain worlds without optional trade fields, legacy routes, archived recipe identities and stopped agreements whose old due date is in the past. CLI and hosted corrupt-data checks preserve stored bytes rather than reseeding or repairing.

## Measured evidence

The exact declared check, `node scripts/check-task.ts protocol`, ran via BlaBla on current source. All 77 tests passed, followed by a successful scoped lint child. The complete child log was read; both child exit codes were 0.

For the same one-action/three-clock-tick history containing two transitions, the serialized full history page was 48,320 bytes and the chronicle projection was 1,947 bytes, a 95.97% reduction. The unchanged world response body was 0 bytes. These are uncompressed local fixture measurements, not live network compression or platform quota measurements.

Official query-plan guidance consulted: https://developers.cloudflare.com/d1/best-practices/use-indexes/.

## Intent and limits

The existing authoritative-host and bounded-world-data responsibilities already cover conditional reads and indexed projections. This patch does not require a new system, duplicated contract or changed simulation rule. The deliberate-data-lifecycle goal remains open: retention, checkpointing, compatible future migrations and managed-host limits are not established by these tests. Current and archived states and deduplication receipts remain intact.

Independent review inspected current mission, systems, process, registered contracts and relevant engineering, testing, reviewing and design guidance. Shared DTOs and pagination centralize common protocol knowledge; authorization, persistence and domain validation retain separate responsibilities. No framework, migration, pruning or source comment was introduced by this review.

Durable wake support, actual Sites quotas, physical D1 row-work billing, deployed header behavior and live scheduled execution require separate integration evidence. This review does not infer those from generic D1 Free limits, a locally passing adapter or a scheduled declaration.
