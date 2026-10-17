# Civic durable-state boundary

17 October 2026. Actual assignment `validate-civic-durable-state`, carried by gpt-6-astra as server-owner. Scope is the canonical validator, two focused test files and this report. Core owns shared civic types, reducers, action parsing and migration. No deployment or live gameplay release is performed here.

## Implemented

`core/validation.ts` now requires paired exact civic/government records only when civic-bootstrap is present and rejects them on older releases. It validates known released civic prerequisites, unique completed IDs, bounded active progress and its positive snapshotted cost, latest completion identity, entitlement linkage, canonical government slot ordering, policy/slot uniqueness and eligibility, current commitment arithmetic, exact two-beat pending timing and payment. Retained completion events must agree with their durable references; pruned events are not required to remain in the bounded window.

The original proposed government shape could not distinguish an entitlement restored after spending once its arrangement event was pruned. Actual task finding 1 records that correctness gap. Core added `lastSpentReformCompletionEventId`, initializes it empty on migration, records an entitlement spend and preserves it across paid changes and completed transitions. This validator requires the latest entitlement to be either unspent and present, or exactly covered by that durable consumed marker. A later actual completion can grant a distinct new entitlement without erasing the older marker. This proves structural consistency of stored records; it does not authenticate arbitrary malicious coordinated rewrites of every field.

Legacy resources/science and release-specific state remain unchanged except the explicit empty civic/government migration. No table, endpoint, history encoding, revision/CAS rule, receipt format or access-control rule changes are required. Existing repository reads and raw/encoded history validation use the canonical validator. HTTP and MCP share the existing repository/parser boundary.

## Actual verification

The initial five negative validation tests reached their assertions and all failed against the previous validator, which accepted the corrupted civic states. After implementation, the exact declared command passed ten tests, zero failed:

`node --test tests/civic-bootstrap-validation.test.ts tests/civic-bootstrap-hosting.test.ts`

The final complete run was read, including its exit 0 and all case results. The checks cover:

- Actual compatible release chain, unchanged old-release reopen and empty migration with preserved resources/science.
- Real civic selection, positive partial productive work, completion, entitlement, first adoption and exact eight-Credit reslot.
- SQLite close/reopen at partial, unspent, consumed, arranged and pending states; every committed transition is replayed from the actual initial world with exact state/event comparisons.
- Original accepted command IDs returning duplicate receipts without extra database writes; dedicated accepted action receipt readback.
- Strict stale revision and malformed/unknown/mismatched/duplicate-slot requests preserving all state, history and receipt rows through HTTP and MCP.
- Exact HTTP/MCP compact observation parity.
- Natural pruning past the 96-event window while the consumed marker survives. Reinstating the spent entitlement then fails canonical snapshot decoding and both authoritative read transports without changing stored rows.
- Snapshotted civic cost remains valid when current content cost changes; current malformed progress, fields, rounds, references and assignments refuse.
- A synthetic second government establishes persistence through both transition beats, completion and four-beat locks. A synthetic later civic establishes a new unspent entitlement distinct from an earlier durable spend. These fixtures do not release advanced content.

## Outcome and next owners

The durable-replay source boundary is verified by these focused fixtures. Overall project completion and live consumer outcomes remain Partial. Orchestrator owns coherent integration, independent review, canonical checks, deployment and any explicitly coordinated compatible release. Core owns civic simulation/contract completion. Art owns actual civic progress and modifier presentation. Creative and the five civilization owners must establish useful live choose-progress-complete-adopt/next-choice outcomes after an authorized application. No fixture is described as live agent play, and this source work grants no event or calendar approval.

The existing held Aster Mathematics intent and pending Director/calendar permissions remain unchanged. Fresh read-only Aster observation at 19:54:24.792 UTC, revision 2147/round 1688, reports Mathematics as the sole required research target and no available exact-town construction choice. The mathematics intent remains specifically held; empty tactical choices also reflect newly overdue ordinary strategy and are not used as impossibility evidence. Foundry paid one Iron and two Energy for eighteen Materials; Mine58 extracted one Iron (reserve131 to130), all three improvements were staffed, and route376 delivered at round1688 without damage. No actor mutation is claimed by this persistence task.
