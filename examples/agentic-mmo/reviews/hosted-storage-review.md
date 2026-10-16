# Hosted storage measurement review

Independent review by `gpt-6-astra` (high), 2026-10-16. Accepted as bounded
resource evidence; no blocking finding. This review changes no storage behavior.

## Source and workload

Inspected `benchmarks/hosted-storage.ts`, its five tests, the budget report,
`server/repository.ts`, `server/validation.ts`, the migration and matching Drizzle
schema. Reviewed the saved full report measured at `2026-10-16T12:17:39.839Z`
(source SHA-256 `10016adfe7dab1a1ccdc35ba046ccd7d39c1fdcd00c546bb802705c9eb553853`).
Independently recomputed the manifest hash and checked its listed file digests.
They matched at inspection. Later catalogue edits are not retroactively measured
by this report; the required review test is separate current regression evidence.

The fixture uses the actual hosted repository, validators and engine against the
actual migration in an isolated in-memory SQLite database. It is one seed-1701,
five-city synthetic world: seven explicit releases through recovery, then six
scripted legal actor commands per strategic beat. At 1,000 transitions this is
7 releases, 852 actions and 141 strategy beats. The driver researches Agriculture,
builds farms, selects growth, then waits. It does not exercise expansion, trades,
Director shocks, clock ticks or large attached plans. It is neither real model
play nor a representative upper bound on every future world. The existing
repository labels model-bearing requests as development-agent provenance; the
explicit synthetic actor/model labels and report qualification prevent claiming
this as actual agent play.

## Byte accounting

Independently recalculated from the retained report:

- History snapshots: 54,790,222 / 56,115,837 JSON bytes = **97.6377%**, correctly
  rounded to 97.6%.
- Receipt request plus response JSON: 195,644 + 143,650 = 339,294 bytes, or 0.6046%.
- Initial/current JSON, transition command/provenance/event JSON and receipt JSON
  reconcile exactly to the total. All text is separately 56,162,713 bytes.
- Snapshot map and recent-event figures are nested components, not extra totals.
- The hypothetical 27 retained snapshots occupy 1,283,080 bytes; subtracting only
  omitted snapshot JSON yields 2,608,695 total JSON bytes, a 95.3512% reduction.
  This is arithmetic, not measured compaction or compression.

The SQL sums `length(CAST(column AS BLOB))` for every TEXT column discovered by
`PRAGMA table_info`, then checks each sum against UTF-8 `Buffer.byteLength`.
All such columns in the schema are non-null. Codepoint lengths are explicitly
separate. Read the retained wrong-unit counterexample: substituting text length
failed on `world_state.state_json` at 26,961 versus 26,975 bytes. Thus the unit
check detects an actual error, rather than only reconciling identical formulas.
Local page size times page count includes allocation/index overhead; column
payload counts do not. Neither establishes managed-host quotas, billing,
replication, backups or WAL cost.

## Integrity and limits

Repository writes retain initial/current state, a full state per transition,
commands, provenance, events and exact request/response receipts. The adapter
executes batches inside BEGIN/COMMIT with rollback on failure and enables foreign
keys. Schema keys index world/revision history and unique receipt identities.
The benchmark does not alter schema, delete rows, introduce encoding or simulate
managed-host latency/concurrency.

At each sample the fixture adds one real no-op receipt, then retries the first
release, latest transition and no-op with the original inputs. It checks duplicate
responses, original accepted revisions, current revision, unchanged row/text
counts and unchanged SQLite `total_changes()`. The 1,000-transition sample retains
1,004 receipts including initialization and three no-ops. This is concrete
same-process retry evidence, not restart or concurrent-writer evidence.

Replay reads real history pages capped at 200, applies each stored transition to
the saved initial state, compares every resulting state and event list, then
compares the final state. This verifies deterministic replay with the recorded
implementation. It does not prove future-version reconstruction: the source hash
identifies inputs but supplies no immutable historical interpreter. Existing
unrelated persistence evidence was not rerun or relabeled as this benchmark.

## Decision and next boundary

The report's conclusion that repeated snapshots dominate this finite workload is
supported. Its generous per-fixture ceilings and lack of timing gate are honest.
Preserve all existing data and receipts. A separately authorized comparison of
versioned lossless encoding and checkpoint reconstruction is a reasonable next
research step, with runtime support, overhead, bounded decoding, exact equality,
malformed input, legacy reads and rollback proved before any rollout. No format,
compression saving, retention policy, hosted capacity or deletion is approved
by this review.

The declared five-test check is the review's deciding regression evidence; its
complete log is retained on `task::review-hosted-storage-measurement`. Prior
measurement and falsification receipts remain historical evidence on
`task::measure-hosted-history-storage`.
