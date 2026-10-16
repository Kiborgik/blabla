# Versioned land transport hand-back

Actual author: Astra/high, 2026-10-16. Scope is deterministic simulation, compact observation and focused tests. Shared schema/catalogue/release are parent-owned; canonical persistence validation and hosted tests are independently server-owned.

## Implemented boundary

The explicit settlement-land-transport-1 successor gives new exact-town proposals a version-1 land quote. A single breadth-first tree per source is reused across candidate recipients and recipes. Fixed axial neighbor order makes equal-length ties deterministic independently of tile-array order. Grassland, forest, desert and tundra are passable using shared content data; mountains and ocean are blocked. Ownership does not impose a civilian transit restriction.

Each offer snapshots its ordered tile IDs, edge count and cadence max(recipe base, ceil(edges / 2)). Acceptance validates that exact path and pays ordinary construction once. It never substitutes another available path. First due is acceptance round plus the quoted cadence; later due attempts use the same interval. Current path failure blocks a due attempt without cargo, upkeep or commerce changes and preserves the agreement. There is no cargo-in-transit state.

Absent transport remains historical abstract trade. Old pending quotes retain their original terms and globally aligned first due time even after release adoption. Accepted old routes are unchanged. Topology validation is separate from present passability so later impassable terrain does not erase readable history. Canonical validation compares snapshotted offer/agreement data without reinterpreting it against current tuning.

## Actual evidence and limits

The initial prospective log evidence-1-2-1792160941635954064.log contains three failures: two absent-successor failures and one labeled synthetic feature probe reaching the real proposal path and finding no stored transport quote. The later path/compatibility fixtures extend coverage; they are not all claimed as pre-implementation failures.

The legal twenty-beat journey starts from createWorld seed 1701, applies each registered predecessor and the new successor, then uses actual proposals, consent and strategic transitions. It does not set resources, technologies, milestones, era or geography. Verdant to Vesper has four edges and cadence four, completing five exchanges. Ember to Pelagos has ten edges and cadence five, completing four. This is a finite causal comparison, not a balance or fun judgment. Every transition is immutable and replayed; JSON-restored strategic states validate.

A separate legal round-two acceptance proves first due round seven and the following delivery at round twelve. Historical pending acceptance at round two retains first due round four. Labeled synthetic tests isolate a newly impassable quoted tile with an available alternative, disconnected endpoints, due-time zero-payment blocking, hostile paths, detached planner outputs and bounded tree reuse. They are not live play or legal terrain mutation evidence.

Twelve focused tests and 135 related engine, endpoint, compact, planning and charter regressions passed in the actual combined run, recorded in .blabla/scratch/specify-land-transport-cadence/regression-147.log. Scoped strict lint passed after test-only typing/style fixes; final exact focused evidence is recorded on the task.

## Observation and measured work

Full land proposal and acceptance choices expose the ordered path, edge length and exchange interval before consent. Their optional structured tradeQuote is generated from the same cached planner or detached offered snapshot. Compact mode retains that quote and replaces repeated site prose with short timing and existing town/recipe references, without a second path search. Two prospective assertions failed before this correction; evidence-3-2-1792161583797833407.log preserves that RED. Consumer mutation cannot change the world or sibling choices. Old-release compact observations retain their existing shape and content. Exact actions and indexes do not change.

The synthetic 25-city fixture exposes all 100 reachable proposal pairs and 137 total choices. The initial prose-only land projection measured 130,504 UTF-8 JSON bytes. After the structured-quote correction, the identical compact fixture measures 78,468 bytes, a reduction of 52,036 bytes (39.9%). Full choice payload grows from 115,631 to 127,920 bytes because it now also includes structured quotes. These figures describe the same finite land fixture, not the smaller predecessor endpoint fixture. No candidates are truncated. The helper test reuses exactly five trees for all ordered capital pairs, with visited tiles bounded by five times the 216-tile map. No universal latency or larger-map claim follows.

## Remaining integration

No inhabited release was activated, no Navigation capability was released and no uncertain game command was retried. Parent owns independent source acceptance, frozen publication and any authorized release application. A useful separate successor is a data-defined energy exchange connecting fuel and kiln production to these geographic consent choices. No additional trade recipe or timing system is added by this packet.
