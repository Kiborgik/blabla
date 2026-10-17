# Revision-bound choice pages: bounded design

2026-10-16. Research and finite local experiment by actual gpt-6-astra/xhigh. No production paging implementation or live request is included.

## Recommendation

Build one optional `compact-trade-pages-v1` observation format, with 20 complete choices per page, full compact context only on the first page, and stateless continuation cursors. Keep both existing formats unchanged. This is useful when an agent examines a small portion of a large menu. Keep `compact-trade-v1` for clients that need every choice in one call. Do not build separate fact pages now: the measured fact table is small, and splitting it adds dependent reads and incomplete-choice assembly.

A revision alone cannot identify this view. Pin the selected seat, observation time, run fingerprint and exact projected-content digest. Preserve canonical ordering and global choice indexes; do not sort, rank, group, deduplicate or silently truncate the action menu. Every choice must remain reachable by following continuations while the named view remains current.

## Current paths and deciding evidence

`server/worker.ts` serves public `/api/observe` and `observe_world` through the same projector. `WorldRepository.read()` performs one primary-key SELECT of revision, initial JSON and current JSON, then validates the state. Compact reads call `observeCompactTrade`, add host metadata, index every legal action and omit the duplicate `choices` alias. MCP serializes the result twice: structured content and a text copy. Existing origin and mutation-enrollment checks are separate from this public read.

`cli/store.ts` uses the same projector, adding local metadata. Explicit CLI time is optional: an absent timestamp lists structural intentions, whereas hosted observation uses current server UTC and can suppress choices for exhausted admission or overdue strategy. CLI reads preserve campaign bytes but retain their existing transient lock-file behavior. A future cursor must preserve this distinction, rather than quietly substituting host time for structural CLI observation.

The scratch experiment reproduces the actual 25-city fixture in `tests/operating-resource-exchange.test.ts`: seed 1701, epoch `2026-10-16T00:00:00.000Z`, eleven real compatible releases through operating-exchange, then twenty explicitly synthetic city additions. The canonical validator accepts it. It contains 216 tiles, 200 exact trade proposals across two recipes, and **237 total choices**, at revision 11. It is not a naturally played or live world.

Actual local Worker response UTF-8 bytes, with real in-memory SQLite behind the established D1 interface:

| Response | Default | Existing compact |
| --- | ---: | ---: |
| HTTP body | 507,897 | 136,848 |
| Complete MCP body | 1,036,310 | 285,732 |

Each actual read executes one SELECT and zero writes/batches. The experiment verifies unchanged source state, zero transition/receipt rows, and exact equality between the actual MCP body size and the counted structured-plus-text wrapper.

The proposed 20-choice serialization prototype, using those actual compact entries, produces:

| Cost | HTTP bytes | Complete MCP bytes |
| --- | ---: | ---: |
| First page, including all context | 26,016 | 54,608 |
| All twelve pages, context sent once | 162,982 | 340,564 |
| All twelve pages, context repeated every time | 346,880 | 729,040 |

The first page saves about 81% against existing compact transport, while exhaustive traversal costs about 19% more. Compact context without choices is 16,707 bytes; its trade facts are 8,483 bytes. Existing choices consume 120,125 bytes. Adding a full SHA-256 action identity to each entry costs 18,486 bytes across all 237 entries. The largest prototype cursor is 314 UTF-8 bytes. Page bodies range from 9,894 to 26,016 bytes. These exact numbers describe the proposed shape measured in scratch, not a new endpoint or universal byte ceiling.

For the same post-wait state at revision 12, observation at elapsed seconds 0, 10 and 60 returns respectively **0, 237 and 0 choices**, without any intervening mutation. The first difference is tactical allowance; the second is overdue strategy. Recomputing continuation with the new request time would silently change the menu at the same revision.

## Exact proposed wire contract

First request uses the existing observe operation with `observationFormat: "compact-trade-pages-v1"` and optional `seat`. No caller page-size control is needed in version 1; the server selects 20. HTTP uses the same named query selector. CLI adds the same format value, with its existing optional explicit timestamp. Continuation supplies that format and `choiceCursor`; an optional seat must match the cursor, and a new timestamp or competing pagination selector is refused.

Every response contains:

- `observationFormat: "compact-trade-pages-v1"`.
- `page: {runFingerprint, revision, seat, observedAt, viewDigest, offset, limit, total, nextCursor}`. `limit` is 20; `offset` is a zero-based global position. `observedAt` is the first hosted server timestamp, or the original explicit CLI timestamp; null means CLI structural mode. `nextCursor` is null exactly at the end.
- `legalActions`: at most twenty complete indexed canonical options, each with its original `choice`, `action`, `label`, `reason`, optional exact `tradeQuote`, and `actionId`.
- `context` on offset zero only: the ordinary compact result and transport metadata with `legalActions` removed. It retains all town/recipe facts, current resources, offered/stored agreement terms, plans and admission information. Its existing compact-format marker identifies the context representation. Later pages reference that first context through the same view digest.

Consumers retain page-zero context until the view is abandoned. Losing it requires restarting at page zero. The first response with zero choices is a valid terminal page with context and null cursor. Nonterminal pages are never empty. Continuations advance by the actual emitted count; the final partial page contains the remaining entries. Returned cursors, rather than assumed page sizes, are the navigation interface.

`actionId` is SHA-256 of a versioned canonical JSON object containing the complete action. Canonicalization recursively sorts object keys, preserves array order and uses ordinary JSON scalar encoding. Exact city IDs, recipe IDs, target IDs and acceptance booleans participate. Labels, prices and path quotes do not: the identifier names an intention, while the view digest names the exact observed terms and legality. It is neither a reservation nor a new executable capability. Full action objects remain present, and submission still uses the existing exact action or the **global**, revision-strict numeric choice. No action-ID resolver or changed mutation path is required.

## Cursor, freshness and failures

Use a bounded canonical base64url JSON cursor with exact fields `{v, run, seat, revision, time, limit, next, digest}`. Version 1 has fixed limit 20; hashes are 64 lowercase hex characters, seat is 0–5, revisions/offsets are safe nonnegative integers, and time is explicit UTC or null only for CLI structural mode. Reject extra keys, malformed UTF-8/base64/JSON, noncanonical encoding, unsupported versions, oversized tokens over 2,048 UTF-8 bytes, impossible offsets and conflicting selectors. Syntax and selector errors return 400 `invalid_choice_cursor`/`invalid_observation_format` before SQL or CLI locking. Bounds dependent on total entries are checked after loading the view.

The read-scope fingerprint hashes the configured host world key plus persisted initial state; CLI uses its persisted initial state with the fixed discriminator `cli-local`; it exposes no save path. This identifies current read scope without a schema change. It is not a new durable generation ID: two deliberately identical replacement saves can be indistinguishable. Their read contents are identical, and paging confers no write authority. The separately designed archive/restart operation must supply a true run/generation identity before it is enabled; paging cannot repair cross-run mutation admission by itself.

The view digest hashes format/order version, run fingerprint, selected seat, revision, frozen observation time and the entire indexed compact result, including facts, quotes, plans and transport metadata as of that read. On continuation, load the current state once, check run/revision, reconstruct at the frozen time and verify the digest. This also detects changed catalogue-derived prose or terms after a deployment with unchanged world revision. Do not reuse the world revision ETag as a choice-view validator.

A changed run, revision or projected digest returns 409 `stale_choice_cursor`, with current revision and a bounded reason (`run_changed`, `revision_changed` or `projection_changed`). Return no choices or automatic replacement cursor. Clients discard the old assembly and explicitly start a fresh observation. An unavailable/corrupt world retains its existing 503 behavior. CLI produces a protocol failure; HTTP status and the existing MCP error envelope carry the same stable semantic code. Do not imply a transport denial from this read failure.

Pinned time means eligibility **at the named observation**, not now. Host continuation rejects a future time, but does not silently advance an old view through a tactical or strategic boundary. Page metadata and first-page context keep the old timestamp explicit. Actual submission still revalidates at authoritative current time, may require supported strategy catch-up and a fresh observation, and never executes a follow-up automatically. An unrelated accepted command invalidates revision-bound numeric paging even when an exact action would remain legal and could use the existing bounded same-intent CAS path.

The cursor is opaque to clients but is not signed or secret. It is a read navigation coordinate, not proof that the server previously issued it. A caller who constructs another valid position cannot obtain anything beyond the same already-public observation; all scope, digest and offset checks still run. Do not add authentication credentials or a cursor database to protect public navigation.

## Costs and limits

The first implementation should slice the existing complete compact projection, with one state SELECT per requested page and no new index, cache or persisted cursor. It reduces transferred/retained response data when clients stop early. It does **not** reduce full legality generation, compact fact construction, JSON state parsing or the initial state read. Twelve measured current compact reads performed twelve SELECTs and twelve complete projections; exhaustive paging using this design repeats that work, plus hashing. Concurrent revision churn can repeatedly invalidate an unfinished traversal, so this stateless design does not guarantee completion across a moving world. Use the existing one-call compact view when the whole menu is needed. The first page is the existing canonical prefix, not a claim that the best action or a desired trade appears there.

A separate deterministic replay of all 200 proposal quotes through the real planner produced five cached source trees and 750 visited tiles, with every quote equal to the observation. That is an actual planner work count for this finite fixture, not instrumentation of the Worker. Rebuilding its request-local cache twelve times would repeat the traversal; this design adds no cross-request cache. No wall-clock speed, peak heap, token-count or managed Sites quota claim follows from serialized bytes or these counters.

Count-bounded pages are not universally byte-bounded: complete context, arbitrary future facts and a long legitimate quote can grow. A future hard response-byte policy would need a separately specified complete-entry/singleton rule and context strategy. Do not truncate paths or terms to meet an unapproved limit. DOM-only pagination would leave all transfer and generation costs unchanged; this proposal genuinely reduces the first transmitted response, with the explicit full-traversal tradeoff above.

MCP's published pagination mechanism covers list operations such as tools/list, not arbitrary tools/call result arrays. Therefore `choiceCursor` is an application argument of `observe_world`, not a claim that the connector automatically fetches more results. Use the protocol's opaque-cursor and explicit-end principles, and preserve the current structured/text result compatibility. Sources: [MCP pagination, 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/server/utilities/pagination) and [MCP tool results](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), checked 2026-10-16.

## Bounded implementation successor and evidence

Recommend one contract-first successor implementing the shared pure page/identity projection plus host/CLI selector forwarding. Keep existing compact and default bytes stable. Prospectively test: all 237 entries reconstructed exactly once in canonical order; page-zero facts resolve every later action and preserve stored consent; global choice identity; zero-choice and final partial pages; malformed selectors before access; same-revision clock changes with frozen time; changed revision, run and mutable catalogue projection; same action ID under reordered JSON keys and distinct IDs for differing exact towns; unchanged state/receipts/clock; detached outputs; existing public/MCP authority; and first/full-traversal UTF-8 accounting. Do not claim generation efficiency until a separate measured iterator/cache design preserves exact parity.

The declared `tests/compact-observation.test.ts` check passes all ten existing tests; its complete log was read. It is only the existing compact regression baseline. It cannot prove this unimplemented paging protocol. The finite scratch script and complete results are `.blabla/scratch/design-revision-bound-choice-pages/measure.mjs` and `measure.json`; they assert concatenated prototype actions equal the actual menu, all identities are unique, source state is unchanged, and actual response/query counts match. No prospective production RED was manufactured for a report-only assignment.

Deciding SHA-256 pins from that run:

- `core/observation.ts`: `51f3ebac94f5e328429260f455928cc5993f5d491fc9747f4826bb9d4c0133e3`
- `core/content.ts`: `3bb022957c2a91e235e499cd6d054b73d27215a23b97179a7b548783e180dec2`
- `server/worker.ts`: `be498e1455b49246045521a01ecb2ec5764e317ef95ab9937b4e3f17631c2e91`
- `server/repository.ts`: `a96c2d0acd1532cc56188544896fc8969c97189a596199135502ae318241a69c`
- `cli/store.ts`: `24ce54349908725ac64bcd9be49689168070b05ef0cd1b116b38b8b60e37d3b0`
- Actual state canonical hash: `0d93d4c1f853cb3b3c764633dce44591e68052aed8f7605e40658c5c9fc4f7e9`.

The scratch result also records engine, planner and fixture-test source hashes. Prior compact transport review remains applicable to unchanged default behavior and authority; none of these local measurements establishes deployed support or live gameplay.
