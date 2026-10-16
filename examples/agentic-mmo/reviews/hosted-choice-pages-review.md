# Independent review: hosted complete choice pages

Reviewer: gpt-6-astra, 2026-10-16 16:00 UTC. Task `review-hosted-choice-pages`; target `implement-choice-page-protocol`.

## Verdict and scope

No blocking mismatch found in the shared paging protocol or HTTP/MCP forwarding. The new opt-in view preserves the complete ordered menu, binds continuations to the original view and observation time, and keeps read and mutation authority separate. Source acceptance is bounded to these transports. CLI async integration, managed deployment and actual native tool discovery are separate work.

Read the complete shared protocol, relevant Worker dispatch and repository read path, all twelve pure and ten hosted paging tests, the prior compact-host regression boundary, the draft contract and the author's implementation report. The underlying compact projection and exact-action semantics retain their previous independent evidence; this review does not repeat the whole engine review.

## Complete, time-bound observations

The page limit is twenty, with global indexes and a terminal null cursor. Page zero alone contains the complete canonical context: town/recipe facts, resources, plans, offers, retained agreements and hosted release/clock metadata. Later pages retain the same digest and observation time. A zero-action view still returns its context and a terminal page. Detached results cannot mutate stored state or shared catalogue facts.

The run fingerprint hashes the selected read scope and persisted initial state. Revision is checked before projection; a canonical SHA-256 digest then binds the complete indexed compact view, format/order version, seat and pinned observation time. Changed current catalogue facts or same-revision projected world facts refuse with `stale_choice_cursor`, rather than silently producing a replacement menu. This fingerprint is not a durable archive-generation ID; identical scope/initial content after a future reset requires its own run-admission design.

Time pinning is intentional. A continuation may describe choices legal at its original observation even after the next tactical or economy boundary passes. It neither reserves them nor realizes overdue time. The normal command boundary must still revalidate present admission and the exact typed action. Hosted cursors cannot be structural-null or come from the future. CLI structural time is tested only at the pure protocol seam, not claimed as an implemented CLI transport.

Action identities hash the entire typed intention with recursively sorted object keys. Object-key order is irrelevant, while exact towns, partner, recipe, offer and acceptance value remain significant. These hashes are read metadata, not authorization tokens or a new action submission route. The existing global numeric choice and exact-intent protections remain authoritative.

## Refusal, storage and access boundary

Strict parsing occurs before the repository SELECT. It checks the bounded canonical base64url cursor, exact version/shape, lowercase hashes, safe integers, offset alignment, UTC timestamp, seat agreement and unsupported controls. Duplicate HTTP controls are not silently folded into a valid paged request. A supplied cursor cannot be ignored by an unpaged format. Cursor decoding rejects extra JSON fields, noncanonical encodings, malformed UTF-8 and values exceeding the 2,048-character ASCII bound. Invalid projected offsets require the actual view and then refuse without replacement actions.

Repository construction remains before parsing, so a missing database binding retains its existing availability error. With a bound database, malformed selectors make zero SQL reads. Valid pages use one actual state SELECT each. The Worker preserves explicit corrupt-state errors and maps projection staleness to the existing HTTP/MCP error envelope, including 409 and bounded reason/current-revision details. It exposes no successful replacement result on that failure path.

Public observations remain public. MCP origin checking is unchanged, and all mutation routes still pass the existing authenticated enrolled-writer boundary. No cursor storage, receipt, migration, clock catch-up, action submission, SQL schema or new credential is introduced. The current implementation generates the complete compact view for each page; count-bounded output is not bounded arbitrary-world bytes or reduced generation CPU.

## Exact evidence and measured limits

The full author final log `.blabla/scratch/implement-choice-page-protocol/evidence-2-6-1792165924694983924.log` was read: 32 tests pass, consisting of twelve pure protocol, ten hosted paging and ten prior compact-host regressions. The scoped lint log `/tmp/choice-pages-lint.log` contains only the existing npm environment warning. The independent declared command is `node --test tests/choice-pages.test.ts tests/hosted-choice-pages.test.ts tests/compact-host-observation.test.ts`; its final result is recorded in this review's ledger after this report text is fixed.

The finite hosted fixture contains 25 validator-accepted synthetic towns and 237 choices, including 200 exact trade proposals. Its compatible release chain is real; the extra towns are fixture data, not a legal founding or live-play claim. Twelve actual HTTP pages and twelve MCP pages reconstruct every original typed action in canonical order, retain immutable pending/accepted terms under catalogue changes, and pin the original time across a due-strategy boundary.

Actual local Worker response-body measurements in that fixture are:

- HTTP: existing compact 136,848 bytes; first page 26,016; all twelve pages 162,982.
- Complete MCP response: existing compact 285,732 bytes; first page 54,608; all twelve pages 340,564. Both structured content and its text copy are counted and compared.
- Each full traversal plus its compact control performs thirteen SELECTs and zero writes. Table snapshots and SQLite total-changes counts remain unchanged.

This is approximately 81% less first-response data and approximately 19% more data if every page is consumed. It is not a token, latency, peak-memory, managed-provider or universal-size result. The one-recipe compact regression fixture is different and retains its earlier byte assertions; its measurements must not be mixed with the two-recipe paging control.

The tests also cover actual persisted revision changes, equal-revision scopes, current-catalogue staleness, unknown or hostile controls, future/conflicting cursors, corrupt JSON, result detachment and anonymous/unenrolled read compatibility. Artificial changes and deliberately corrupted rows are clearly test seams. No production security mutation campaign or deployed paging use is inferred.

## Remaining useful boundary

The next transport step is the separately assigned awaited CLI integration; it must not place a Promise into the existing synchronous JSONL serializer. After authorized publication, verify the new selector through actual discovery and one supported read, then a continuation with the same view identity. Preserve the existing default/compact client path. Current live independent gameplay and genuine trade actions are separate from these synthetic protocol witnesses.
