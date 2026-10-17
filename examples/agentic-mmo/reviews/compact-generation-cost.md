# Compact observation generation cost

2026-10-16. Actual gpt-6-astra/high simulation worker; report-only `measure-compact-generation-cost`. Runtime source remained frozen. This is a local generation experiment, not an independent review of my earlier compact implementation or a live-world benchmark.

## Decision

A small follow-on optimization is justified: avoid creating full trade explanation prose when the caller explicitly requests the compact view, while retaining the same canonical action enumeration, order, quotes and admission logic. Do not introduce a second legality engine, cross-request cache or generic formatting framework. This is useful bounded work, not a blocker for the accepted Site snapshot.

In the current synthetic 25-town, two-recipe fixture, compact output retains all **237 choices / 200 proposals** and reduces pure-view JSON from **255,917 to 133,243 bytes**. However, it first constructs and clones **162,466 UTF-8 bytes of full proposal reasons** that it subsequently replaces. Warm median generation measured **2.201 ms compact versus 1.965 ms full**. A separate CPU profile attributed **18.3%** of compact samples to the full trade-prose formatting call tree; sampled allocations under that tree were about **615 KB per view**, or **24.7%** of the compact allocation estimate. These measurements identify avoidable work, not a promised speedup of that amount.

## Reproducible workload

Run from the example root:

`node --expose-gc .blabla/scratch/measure-compact-generation-cost/measure.mjs`

The complete script, raw stdout, results and individual CPU/allocation profiles are in that task scratch directory. `results.json` records SHA-256 source pins and world hashes. The command exited 0. Environment: Node v24.19.0, V8 13.6.233.17-node.51, Linux x64, AMD EPYC 9V74 80-Core Processor. No network, renderer, SQL or hosted request participates in these timing measurements.

Two existing fixture families are reproduced without editing their tests or production files:

1. Seed 17 endpoint fixtures from `tests/compact-observation.test.ts`, five and 25 cities. These explicitly synthetic fixtures set populations to three and workshops on each city; the 25-city case adds twenty canonical city records and assigns their tiles.
2. Seed 1701 operating-exchange fixtures from `tests/operating-resource-exchange.test.ts`, five and 25 cities. The five-city case is an unedited world reached only through actual compatible releases. The 25-city case adds the same twenty explicitly synthetic towns as the existing test. It is not a legal founding journey.

Every world passes canonical validation. Time is fixed at the explicit epoch, seat zero, with available admission and no pending offer or active plan. Each pair of outputs must retain exactly equal ordered actions and structured trade quotes. Every timed batch's final result is checked again. Canonical state hashes remain unchanged. No choices are filtered, truncated or ranked.

Per fixture: 40 warm calls for each view, followed by seven batches of 100 calls each, alternating full/compact order. Timing excludes JSON serialization, assertions, inspector profiling and explicit GC. It includes all actual generation and ordinary GC occurring during those calls. Results are consumed through choice counts. These are batch means summarized by their median, not per-request percentiles or a service SLO.

## Generation and exact output sizes

| Fixture | Proposals / choices | Full median ms | Compact median ms | Compact batch-mean range ms | Full JSON bytes | Compact JSON bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Endpoint 5, synthetic | 4 / 10 | 0.124 | 0.161 | 0.140–0.191 | 10,660 | 11,094 |
| Endpoint 25, synthetic | 100 / 122 | 0.622 | 0.773 | 0.677–0.884 | 96,247 | 52,378 |
| Operating 5, legal releases | 8 / 35 | 0.315 | 0.354 | 0.338–0.365 | 25,147 | 23,024 |
| Operating 25, synthetic | 200 / 237 | 1.965 | 2.201 | 1.896–2.620 | 255,917 | 133,243 |

Compact generation overhead in this run is approximately 12–29%, despite the larger-world byte savings. Small-world facts can increase output size. Absolute local times are modest; they do not demonstrate a managed-host bottleneck, quota violation or user-perceived latency.

## Allocation and CPU evidence

Allocation sampling uses Node's actual inspector HeapProfiler, a 16,384-byte sampling interval and inclusion of objects collected by minor and major GC, over 300 calls per view. Summed sampled `selfSize` is an estimator, not an exact allocation ledger or peak live heap. Formatting attribution includes descendants of `describeTradeEndpoints` and `describeLandTransport` (including their settlement-site descendants, excluding unrelated build/focus descriptions). Profiler output is retained for inspection. The first stdout summary grouped all settlement-site formatting; `results.json` was reanalyzed from the retained raw profiles to restrict attribution to trade formatting. The reproducible script now uses that narrower classification; no timing or profile sample was changed.

A separate retained-output experiment forces GC before and after holding 30 complete observations. The difference divided by 30 is reported as an empirical retained-heap estimate. It can include runtime overhead and JIT/GC noise; it is neither exact object size nor transient peak. Do not substitute UTF-8 serialized bytes for heap bytes.

| Fixture | Full / compact sampled allocation bytes per call | Compact formatting sampled bytes per call | Full / compact retained heap estimate per held output |
| --- | ---: | ---: | ---: |
| Endpoint 5 | 110,534 / 155,630 | 14,167 | 15,279 / 16,025 |
| Endpoint 25 | 711,487 / 801,898 | 316,868 | 119,131 / 72,983 |
| Operating 5 | 378,510 / 436,296 | 28,036 | 40,950 / 33,143 |
| Operating 25 | 2,371,919 / 2,489,841 | 614,865 | 480,241 / 210,621 |

Separate 700-call compact CPU profiles requested a 100-microsecond sampling interval. The endpoint-25 profile recorded 3,633 samples over about 688 ms; **23.2%** of sampled time was in the full formatting subtree. Operating-25 recorded 10,771 samples over about 1,918 ms; **18.3%** was in that subtree. The inclusive `availableTradeActions` subtree accounted for 34.4% and 47.2%, respectively, and includes formatting, path planning and enumeration. These overlapping categories must not be summed. Profiling perturbs execution and may under-attribute optimized/native work; its percentages are corroborating evidence, not counterfactual saved time.

## Actual source work

`observeCompactTrade` calls canonical `observe`. `observe` constructs `legalActions` and `structuredClone`s the complete observation. `availableTradeActions` formats both endpoint sites for each exact-town proposal, and geographic proposals additionally render the entire path as prose. Only afterward does compact projection replace each applicable reason and build unique town/recipe facts.

For these no-offer fixtures, source-derived trade-formatting call counts and measured replaced strings are:

| Fixture | Full endpoint descriptions | Settlement-site descriptions inside them | Full reason bytes discarded | Unique compact town facts |
| --- | ---: | ---: | ---: | ---: |
| Endpoint 5 | 4 | 8 | 2,283 | 5 |
| Endpoint 25 | 100 | 200 | 58,997 | 25 |
| Operating 5 | 8 | 16 | 6,406 | 5 |
| Operating 25 | 200 | 400 | 162,466 | 25 |

The geographic cases also render one full path string per proposal. These counts follow directly from the executed option counts and the inspected two-site formatting loop; they are not instrumented Worker counters. UTF-8 reason bytes measure thrown-away textual content, not actual V8 allocation. Other non-trade choices retain their own site descriptions and are outside this proposed removal.

The existing planner already caches one BFS tree per source within an enumeration and is reused across recipes. The server's separate report measured five source trees / 750 visited tiles when replaying all 200 quotes for its representative fixture; that is not instrumentation of this profile or the hosted request. Avoiding prose must not create a second planner or alter its cache lifetime.

## Paging coordination and bounded successor

`reviews/revision-bound-choice-pages.md` separately measured actual HTTP/MCP wrappers and proposes slicing the existing complete compact projection. Each page would still read/validate state and generate the entire menu and facts. Paging reduces first-response bytes when the client stops early; it does not remove the generation work measured here. Its response sizes include indexed choices and host metadata, whereas this report measures the pure core view. The two figures must not be conflated.

Recommended next scope: introduce one explicitly internal presentation choice that flows through the existing observation/choice enumeration boundary, skipping only full trade reasons that compact projection replaces. Keep default full descriptions byte-identical, keep all exact actions/indices/quotes unchanged, and retain detached copies and snapshot-authoritative old offers/agreements. This may touch engine, choices, trade and observation together under one approved scope; it needs no persistent schema, GameAction change or general formatter abstraction.

Prospective acceptance should compare default and compact outputs across old and new releases, all seats, pending consent, two-item plans and admission times; prove action/quote parity and state immutability; and rerun this same finite workload. Do not claim a speedup until that actual candidate is measured. Do not introduce cross-request memoization: identical revision can expose different admission at different observation times, and catalogue changes can alter projection without a world revision.

The declared ten compact-observation tests are the unchanged-behavior baseline for this report, not proof of an unimplemented optimization. No larger test suite, production edit, release activation or uncertain Verdant action retry was performed in this task.

## Source pins

- `core/observation.ts`: `51f3ebac94f5e328429260f455928cc5993f5d491fc9747f4826bb9d4c0133e3`
- `core/engine.ts`: `5ced0b75cd5b14fcada8f2e183c4245a38fee4f00b93e62ae88bb6b91b89de2c`
- `core/simulation/trade.ts`: `7765ea010695197404b4c9bf0690d48e5ae086d20f215b3d9d2ecbec35e0b22e`
- `core/content.ts`: `3bb022957c2a91e235e499cd6d054b73d27215a23b97179a7b548783e180dec2`

All eight inspected input-file pins and four complete fixture hashes are in `results.json`. Earlier core, CLI, binding and model-role chronology remain untouched; this assignment contributes measurements only.
