# Hosted history storage budget

Measured 2026-10-16T12:17:39.839Z. Actual gpt-6-astra/xhigh server-owner measurement; **synthetic fixture, not live-agent play or live database usage**.

## Decision

Prioritize repeated history snapshots. At 1,000 transitions they occupy **54,790,222 of 56,115,837 JSON bytes (97.6%)**. Receipt request/response JSON is only 339,294 bytes (0.6%); retaining exact retry evidence is inexpensive compared with snapshots. Do not start by pruning receipts or historical commands.

## Reproduce and scope

Run `node benchmarks/hosted-storage.ts` from `examples/agentic-mmo`; it prints the full report, column breakdown and source manifest without writing an artifact. Run `node --test tests/hosted-storage.test.ts` and `npx --no-install vp lint benchmarks/hosted-storage.ts tests/hosted-storage.test.ts` for focused verification.

Source SHA-256: `10016adfe7dab1a1ccdc35ba046ccd7d39c1fdcd00c546bb802705c9eb553853`. The hash covers core/server TypeScript, SQL migrations, this benchmark, its tests and package/lock manifests. Node v24.19.0, SQLite 3.53.3, Linux x64, 4,096-byte local pages. No installed package or external script was fetched.

One seed-1701 world follows seven real compatible releases through recovery, then six deterministic actor commands per economy beat. The scripted driver researches Agriculture, builds a farm, selects growth, then holds when those goals are satisfied. Every choice comes from actual legal actions. At 1,000 transitions: 7 releases, 852 actions, 141 strategy beats; five cities, no expansion, trades, Director shocks or clock ticks. One explicit no-op strategy receipt is added at each sample. Repository provenance uses its existing transport category; `synthetic-storage-driver` identifies this artificial workload and is not a model identity claim.

The real `WorldRepository`, canonical validator and engine write the actual migration schema in an isolated in-memory SQLite adapter. Each stored text column is measured by SQL BLOB byte length and independently checked against UTF-8 Buffer length. SQL text length would count codepoints instead; a deliberate wrong-unit mutation failed at 26,961 versus 26,975 bytes, then restoration passed. [SQLite byte-length semantics](https://sqlite.org/lang_corefunc.html#length). The adapter preserves transactional batch behavior; it does not simulate cloud latency. [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

## Measured retained bytes

| Transitions | Current state | History snapshots | Commands + provenance + events | Receipt JSON | All JSON | Local SQLite allocation |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 26,975 | 251,422 | 7,749 | 3,697 | 312,133 | 397,312 |
| 100 | 55,441 | 4,760,485 | 111,016 | 34,378 | 4,983,610 | 5,218,304 |
| 1,000 | 55,694 | 54,790,222 | 908,337 | 339,294 | 56,115,837 | 57,491,456 |

All JSON also includes the original 22,290-byte initial state. Total stored text at 1,000 is 56,162,713 bytes, including keys/timestamps outside JSON. Local allocation includes SQLite pages and indexes; it is **not** managed Sites billing, replication, backup, WAL usage or an actual quota. [SQLite page count and size](https://sqlite.org/pragma.html#pragma_page_count). Actual managed-host limits remain unverified.

Within the 1,000 snapshots, the same 18,661-byte map is copied 1,000 times (18,661,000 bytes), while repeated recent-event windows consume 31,922,766 bytes despite standalone event JSON using only 607,683 bytes. These are overlapping snapshot subcomponents, not additional totals. Current state retains at most 96 events and reaches 55,694 bytes here. This identifies snapshot duplication rather than unbounded current-event retention as the dominant measured cost.

## Executable fixture budgets and integrity

- Current state below 128 KiB; cumulative snapshots below transitions × 128 KiB; total JSON below (transitions + 2) × 160 KiB. These are generous regression ceilings for this exact five-city workload, not global capacity claims.
- At most 1,000 transitions and ten increasing sample points. No elapsed-time pass threshold.
- Every persisted frame and event list exactly reproduces from the stored initial state and commands. Each sample checks three exact retries, including the old release and no-op receipt: zero added rows, bytes or SQL changes. The 1,000-transition sample retains 1,004 receipts: initialization, all transitions and three no-ops.
- Identical short runs reproduce byte counts and final hashes. New cities, routes, long-lived clock/Director ledgers and large attached plans need separate representative workloads before widening these ceilings.

## Smallest safe successor

First compare **versioned lossless snapshot encoding** against checkpoint replay in a bounded research task. Prefer encoding as the first candidate: retain every logical full snapshot and decode its exact original JSON without running game logic. A self-contained encoded frame with codec version, uncompressed byte length and integrity hash avoids cross-frame dependencies. Verify supported managed-runtime APIs, bounded decompression, malformed/truncated input rejection and byte-exact round trips before choosing a format. Include any binary-to-text and metadata overhead in the measured result. Workers documents `CompressionStream`/`DecompressionStream` support for gzip and deflate; that is a candidate API, not verification of this particular managed Sites deployment or a measured saving. [Official runtime support](https://developers.cloudflare.com/workers/runtime-apis/web-standards/#compression-streams). This task measured no compression ratio or codec CPU/memory cost.

Checkpoint replay stores fewer complete frames but needs an immutable historical interpreter and catalogue for each segment, plus bounded reconstruction and history pagination. The current source fingerprint identifies a run; it does **not** provide that interpreter. Neither the mutable `0.1.0` string nor a release name closes this gap. Therefore, do not implement snapshot omission from the present projection alone.

For comparison only, retaining each release boundary and every 50th transition would keep 27 snapshots and reduce this fixture's total JSON to **2,608,695 bytes**, omitting 53,507,142 snapshot bytes (95.4% of total JSON). This arithmetic excludes new metadata/index costs and is **not an implemented compaction or future hosting estimate**. Lossless encoding keeps all logical frames and avoids replay dependence, while its actual savings and decode costs remain unmeasured; checkpoint reconstruction has the displayed arithmetic potential but the larger interpreter/versioning prerequisite.

Any eventual format change should be prospective and explicit: keep initial/current state, every existing snapshot, immutable commands/events/provenance and all exact request/response receipts. Prove old/new frame equality, bounded reads, exact retries across restart, atomic failures and rollback before rollout. Keep legacy full-frame reads supported. No deletion or receipt pruning is proposed; later archival/retention needs separate approval, read-back evidence and actual managed-host capacity information.
