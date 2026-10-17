# Complete choice-page implementation

Actual gpt-6-astra/xhigh, 2026-10-16. This packet implements the accepted research design in `reviews/revision-bound-choice-pages.md`, against the registered draft `contracts/choice-pages.bla` and bounded-complete-choice-pages goal.

## Current bounded status

Shared protocol and hosted HTTP/MCP forwarding are implemented. The focused combined suite passes32 tests with scoped strict lint: twelve pure protocol tests, ten hosted paging tests and ten existing compact-host regressions. CLI runtime remains unchanged; CLI paging is explicitly deferred to its separate async transport successor. No live request, release activation, publication or managed-runtime support claim is included.

## Implementation boundary

`protocol/choice-pages.ts` owns canonical SHA-256 identities, strict bounded cursor parsing, the twenty-entry page projection, first-page-only context and explicit stale-view errors. It imports the canonical compact projector and UTC parser, uses standard Web Crypto/TextEncoder/base64 APIs, and imports neither a server repository nor a new dependency.

The parser is synchronous and requires no world source. It rejects unsupported controls, malformed/noncanonical base64url JSON, wrong exact fields, extra keys, invalid hashes/time/seat/offset, over-2,048-byte cursors, a conflicting seat, a new continuation timestamp and hosted future/structural cursors. The Worker runs it before the repository SELECT, preserving existing missing-binding behavior. Unsupported controls are refused for the new format; existing unpaged branches retain their established semantics except that a supplied paging cursor cannot be silently ignored. The asynchronous projector then checks scope/initial fingerprint and revision, regenerates at the pinned time, checks the complete projected digest, and refuses out-of-range offsets. The returned `ChoicePageError` carries status, semantic code and bounded details. The Worker maps it into its existing HTTP/MCP failure mechanism, including409 stale-view errors without replacement results, while preserving repository503 corruption failures.

Every result retains global choice indexes and exact action/label/reason/quote data. Action IDs hash the complete typed intention with recursively sorted object keys. Only the current twenty emitted actions need their separate identities calculated; the complete view is still generated and digested. First-page context preserves all canonical facts, plan readiness, resources, pending offers and accepted agreement terms. Results are detached. There is no selection policy, reservation, clock realization, state write, credential, cursor store or alternate submission API.

Run fingerprints identify current read scope and persisted initial state. They do not create a durable generation ID or fix future archive/restart write admission. Pinned eligibility is explicitly historical to the first observation; actual commands still require current admission and exact-intent revalidation. Page count is bounded, not arbitrary-world bytes or generation CPU.

## Prospective evidence and limits

The first declared pure run, `evidence-1-2-1792164848637562853.log`, used an explicit unpaged baseline adapter so the new test module could execute before the implementation. All ten tests failed. Deciding assertion failures were the old format instead of a paged result, noncanonical action identities and missing context; other cases stopped at absent page-envelope properties. This is not a claim that all later validation branches were independently falsified by that first run.

A subsequent prospective unsupported-control case genuinely failed with `Missing expected exception` in `control-red.log`; strict request-key validation repaired it. `pure-green.log` now passes all twelve tests: complete 237-choice traversal, time pinned across tactical and due-strategy boundaries, terminal empty view, CLI structural-time distinction, run/revision/projection staleness, exact stable identities, detached outputs, hostile cursor shapes/encoding/offsets, and immutable pending/accepted consent with a bounded plan under changed current recipe tuning.

Hosted `hosted-final-red.log` records six genuine prospective assertion failures against the then-unchanged Worker: the new selector refuses with400 rather than producing pages; discovery lacks the new enum; the specific cursor error is absent. The existing compact result and origin guard control passes. Those assertions now pass. The expanded final hosted cases verify lossless twelve-page traversal through both HTTP and MCP after server time advances, exact global indexes, one state read per page, zero writes, malformed refusal before SQL, stale revision without replacement choices, future/conflicting cursor refusal, MCP catalogue-staleness error shape, isolation of equal-revision worlds, explicit corrupt-state refusal and actual response-byte accounting.

All logs named above are under `.blabla/scratch/implement-choice-page-protocol/`. Scoped lint for the protocol, Worker and all three scoped test files is green in `/tmp/choice-pages-lint.log`; npm emits its pre-existing http-proxy environment deprecation warning. Parent added `protocol/**/*.ts` to the shared tsconfig so direct scoped lint uses the real ES2023 project settings. No product-wide finish or managed deployment is asserted.

## Actual transport accounting and compatibility

The frozen finite control uses a validator-accepted synthetic25-city world after eleven explicit compatible releases, with237 choices including200 exact trade proposals. Actual local Worker response bodies now reproduce the accepted prototype:

| Transport | Existing compact | First20-entry page | All twelve pages |
| --- | ---: | ---: | ---: |
| HTTP UTF-8 bytes | 136,848 | 26,016 | 162,982 |
| Complete MCP UTF-8 bytes | 285,732 | 54,608 | 340,564 |

MCP totals include both structured content and its serialized text copy; tests compare the two representations exactly. Each traversal records thirteen SELECTs: one existing compact control and twelve actual pages. It records zero writes, unchanged authoritative tables and unchanged SQLite total-changes count. First-page saving is about81%, while exhaustive traversal adds about19% bytes and repeats full generation. These are actual local protocol/query witnesses, not CPU, peak-memory, universal response-size or managed-provider limits.

The ten prior compact-host tests retain every original default/compact field and byte assertion. Only their discovery expectation expands from one optional format to the two approved values. Existing fixture response sizes remain16,101/11,782 HTTP and33,406/24,834 MCP for five towns, and189,312/54,848 HTTP and386,244/115,082 MCP for the earlier one-recipe25-town fixture. Do not confuse those fixtures with the two-recipe paging control.

The source introduces no repository, action admission, CAS, receipt or SQL schema changes. Public observation remains public; the MCP origin guard and existing mutation authorization remain in place. No new read grants or credential handling were added. The page selector neither migrates nor activates a world feature. The default and existing compact formats still use their existing observation code path.

## Deferred CLI seam and review handoff

CLI paging is separately scoped because Web Crypto is asynchronous while the existing root JSONL Adapter serializes synchronous handle results. A Promise must never be returned into that unchanged serializer. A narrow successor can await a local serve override and main output while preserving old synchronous handle results and the shared root adapter. Pure tests establish structural-null and explicit-time behavior for that future caller; they do not establish CLI transport availability.

The concurrent core presentation optimization is frozen and independently owned. The final exact declared check runs only the32 focused tests; its receipt is recorded on this task. The optimization retains canonical enumeration and output parity; this task still claims no reduced core generation work. Independent review should focus on complete reconstruction and context, time/digest freshness, hostile cursor bounds, no-effects failure paths, actual wrapper accounting and unchanged existing formats.

Deciding SHA-256 source pins:

- `protocol/choice-pages.ts`: `cc3b3b06a519df36875634d1e3f6059b62038f48aa7e1c29182ef44a2c82b1f6`
- `server/worker.ts`: `fb87498fcd8270ef8fe063a20c72ae4840dd77050a3a64aab6f9d72f2ba95a2c`
- `core/observation.ts`: `3b6e23d5f458ce77c8d0267509c9c0fca4d8bc2aa80eceec799cfeeb632b6867`
- `core/engine.ts`: `b6e7dd726b1dc6b2d8a31b9a4ce80c688bdc295b732cded85e17cab72a13e912`
- `core/simulation/choices.ts`: `addfc980f0759244ae66aa5fde13947a5fc3bb789673c85be47172abeeaf98fb`
- `core/simulation/trade.ts`: `c61a6a6f7aeb23db1d78b197812ec563d2efff2b71c0659947c048ccce415bb6`
