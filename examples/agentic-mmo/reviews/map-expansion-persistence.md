# Playable map expansion persistence

Author: dedicated Server owner, gpt-6-astra/xhigh, 17 October 2026. This test/report packet verifies actual compatible releases through the existing repository. Core owns expansion mechanics; the separate forest persistence packet owns the directional canonical extent guard. No SQL schema or transport change was needed.

## Reached legal histories

The before-half persists the complete 262-transition water-land journey in file-backed SQLite, closes/reopens the database and replays every transition. Its 18×12 map has 216 dense original tile IDs and coordinates, with 52 retained town, district, improvement, catchment, iron/pastoral and route references. These are real engine-generated records, not injected resources or sites.

The first after-half applies settlement-forest-production-1 and then settlement-world-expansion-1, reaching revision 264. The actual expansion preserves width 18 and appends rows 12–23, IDs 216–431, for 18×24 and 432 tiles. All original 216 tile objects, RNG and other non-release assets remain deeply equal. Historical SQL rows remain unchanged; a bounded history page contains both heights 12 and 24. Reopening and repeating the exact release returns its original accepted receipt without another migration. Full replay reproduces all 264 frames.

The useful-frontier journey first makes a legal old-boundary town at tile 199, yielding a 263-transition predecessor. It then applies both real releases and admits the exact action `{type:'settle',sourceCityId:'city-2',tileId:218}`. The new town is `city-2-266`, founded at revision 266 with population 3 and retained housing base 8. Founding conserves total population and preserves all original tiles. The next actual economy opening reaches revision 267, round 201, with the new town at population 4 and a civilization-2 production event. The hosted case verifies the exact state and events through reopen and all 267 replay frames. Core's separate production comparison supplies more detailed output attribution; this host witness does not infer a numeric marginal yield from a civilization-wide event.

Both after-halves use the real compatible release path. The synthetic append candidate is never persisted as a substitute for adoption. Newly appended land has no owner until a legal action claims it; extending the map grants no free territory.

## Transaction and refusal boundaries

Six named hosted cases cover the old-world positive, adoption, two insertion faults, CAS and reachable founding. Triggers separately abort insertion into world_transitions and world_receipts during migration. Each failure leaves current state, old history and receipts equal to their before-half; an exact retry after reopen commits once, and a later duplicate returns the original revision. These are real local SQLite transactions through the unchanged WorldRepository.

The CAS control deliberately injects a canonical competing seat-2 focus state just before the transaction. The stale migration cannot overwrite it, expand its geography or append losing history/receipt rows. This is a synthetic contention hook: it tests losing-transaction behavior, not a second complete competing command history or managed-host concurrency.

Core separately verifies caught-up admission, unsupported predecessor extents and repeated release refusal. Canonical validation under the forest packet requires 18×24 only when world-expansion is present. Absent-feature legacy snapshots retain their existing dimension-generic acceptance; no retroactive 18×12-only save policy or new extent metadata is introduced. Immutable placement IDs, source/route paths and prior history are preserved rather than regenerated.

## Evidence and finite cost

The retained prospective run had one old-world positive and three failures at the genuinely absent forest predecessor. A later selected reachable-founding case failed at that same boundary. Those earlier failures did not reach the downstream expansion or rollback assertions. With the actual runtime present, reached-host-development.log records all six hosted cases passing, including the 262/264/267-frame replay diagnostics. The final declared task receipt is authoritative for the frozen report, six-case source and strict type-aware/type-check lint; its complete log is retained in task scratch.

A separate explicitly synthetic append-size probe used the actual 263-frame frontier predecessor: UTF-8 whole-state JSON was 76,698 bytes before and 95,743 after (+19,045); tile-array JSON was 18,655→37,700 bytes. Original tile bytes and RNG were unchanged. The actual operated 267-frame released world serializes to 96,221 UTF-8 bytes. These are distinct fixtures and counts, not an interchangeable migration measurement. No claim is made about peak heap, CPU, provider quotas or managed Sites limits. Replay is finite, using three-entry history pages and a 100-page guard for these at-most-267-frame fixtures. Existing raw snapshot writers and bounded history readers remain unchanged.

## Delivery boundary

The inhabited-empire-map outcome is Partial: compatible append-only storage, real reachable founding, subsequent population growth and exact historical replay are verified locally. Independent acceptance, publication/application, genuine model decisions in the enlarged world and supported map comprehension remain accountable rollout work. This packet performs no live migration and does not equate generated fixtures with autonomous civilization play.
