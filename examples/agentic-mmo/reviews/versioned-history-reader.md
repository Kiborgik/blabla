# Independent versioned history reader review

Reviewed 2026-10-16 by actual gpt-6-astra/high, separate from the gpt-6-astra/xhigh reader author. Scope: the four deliverables of `read-versioned-history-snapshots`, their complete author evidence and existing encoding research/review. No production source was changed by this review.

## Verdict

Accept the bounded reader compatibility implementation and the reviewed correction for finding 1, subject to current focused evidence and owner integration. The independent review found a real pre-existing row/frame consistency defect at the touched seam; the server owner added the narrow guard and prospective tests. This review does not approve encoded writes, migration, deletion, live activation or a managed-runtime resource budget.

## Format and failure boundary

`server/snapshot-codec.ts` recognizes only the exact 16-byte ASCII `blabla-snapshot:` prefix. Unmarked strings retain the legacy raw JSON path and its size acceptance, including whitespace and Unicode. There is no fallback after a recognized marker fails.

The JSON following the marker is limited to 200 KiB before parsing: a code-unit precheck avoids allocating UTF-8 for obviously excessive input, followed by an actual UTF-8 byte check. It requires exactly five correctly typed fields, integral version and length, lowercase 64-digit SHA-256, and identical JSON reserialization. The latter rejects duplicate fields and noncanonical whitespace/escapes; field insertion order is not fixed. Only version 1 and gzip are supported. Compressed bytes are bounded at 144 KiB through both base64 length and decoded binary checks; round-trip base64 equality rejects noncanonical padding bits. Declared decoded bytes must be within 128 KiB, inclusively.

Compressed input is fed in 1 KiB chunks. Each output chunk is checked against the remaining declared allowance before retention; overflow/error cancels the reader and releases its lock. Successful output must have the exact declared byte length and SHA-256, then pass fatal UTF-8 decoding, JSON parsing and the existing `assertWorld` canonical state validator. The UTF-8 decoder preserves a BOM rather than silently discarding it. Unknown encodings, bad metadata, malformed streams, hashes and lengths fail explicitly with typed 503 errors; invalid decoded JSON/worlds retain their existing typed 503 categories.

The author guard-removal run genuinely fails the expansion assertion with late corruption instead of the early decoded-limit error. Source restores that guard. Retained chunks and the final contiguous copy coexist briefly; the 128 KiB payload cap is not a total-process memory limit. Runtime-owned delivered chunks, internal stream buffers, CPU time and concurrent request costs are not bounded by these tests. Strict truncated/trailing/concatenated gzip rejection is demonstrated locally; the actual managed deployment's compatibility behavior is still unverified.

## Repository and durable behavior

`WorldRepository.history` retains its indexed revision cursor and 1–200 row limit, then awaits each historical decode sequentially. DTOs, ordering, pagination and public identity redaction remain unchanged. Chronicle queries still omit snapshots entirely. Initial/current reads still parse raw JSON; initialization and mutation still write raw `JSON.stringify` values for state, transitions, events, provenance and receipts. No schema, transaction, admission, authentication, CAS or retry path was added or altered by this reader seam.

The new hosted tests independently gzip real stored frames with Node zlib. They demonstrate mixed raw/encoded pages, database reopen, exact decoded state equality, cursor continuation, and replay through actual action/clock transitions. A ten-transition recovery fixture additionally replays real releases, action, strategy catch-up and Director damage frames. Duplicate retry after reopen keeps the original accepted revision, returns the existing receipt and makes zero SQLite changes. Other existing hosted cases retain concurrent retries and transaction rollback coverage.

Corrupt encoded history returns 503 without changing the current world, receipts or any SQL row. World and chronicle reads remain available. A subsequent real mutation still writes a raw historical frame; an encoded current-state value remains rejected. Tests exercise actual repository/worker paths rather than a second state model.

## Existing consistency gap and next gates

A read-only synthetic database-row probe reproduced this result for both raw and correctly encoded gzip: `start_revision=0`, `end_revision=1`, with a valid `createWorld` snapshot whose `revision=0`, was returned by the pre-correction `history` unchanged. That reader validated each world and the row's revision range separately, without comparing `state.revision` with `end_revision`. A valid hash detects damaged bytes, not substitution of another internally valid frame. This is present in the legacy raw path too; it is not a regression introduced by gzip support.

Parent explicitly authorized the server owner to correct this within the current reader scope. Reviewed the single `state.revision !== row.end_revision` guard after decoding and before returning a frame. The two prospective raw/encoded tests first failed with actual 200 instead of 503, then passed with typed `corrupt_history`, unchanged current state/receipts/SQL change count, and successful reads after restoring correct frames. Full correction RED/GREEN logs are `/tmp/history-frame-revision-red.log` and `/tmp/history-frame-revision-green.log` (69 pass/two fail, then 71 pass). The correction addresses finding 1; final resolution belongs to the parent. The comparison does not prove full transition semantics or historical replay authenticity.

Before any encoded writer, retain the existing gates from `reviews/snapshot-encoding.md`: aggregate decoded-page byte budgeting with deterministic cursor progress, actual supported-runtime malformed-stream verification, and rollback to a dual-reader-capable release. Raw frames intentionally remain uncapped here, so neither a 200-row page nor sequential decoding establishes a byte budget for a complete page. The marker adds 16 bytes per encoded frame beyond the historical prototype's measured envelope; its old storage totals are not a measurement of this production format. No hosted quota, billing, compression activation or performance improvement is inferred.

## Evidence and freshness

Read all of `/tmp/history-codec-red.log` (59 pass, nine genuine runtime failures against the old raw reader plus compiling stub), `/tmp/history-codec-bound-counterexample.log` (68 pass, one intended guard-removal failure), and both complete author 69-test GREEN logs, ending at `.blabla/scratch/read-versioned-history-snapshots/evidence-2-5-1792155565644356699.log`. The author confirmed all four source/test deliverables frozen and scoped strict lint passing.

Independent declared check: `node --test tests/snapshot-codec.test.ts tests/hosting.test.ts`; its actual run, full output and exit are recorded on `review-versioned-history-reader`. Reuse the closed encoding research rather than rerunning its 1,000-frame measurement. Shared charter changes under `core` are a concrete freshness boundary for these task inputs; a stale receipt is not a new codec failure or authority to claim later source was measured.
