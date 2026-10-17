# Water and worked-land runtime seam

Actual worker gpt-6-astra/high, 16 October 2026. This report is the bounded shared-interface handoff requested for `specify-water-land-runtime`, based on the accepted 422-card catalogue and current runtime. It does not edit runtime or claim an applied successor. Creative confirmed the infrastructure subsets and one-resident Pasture on 16 October at 23:34 UTC.

## Exact connected scope

- Animal husbandry: 60 science, requires Agriculture. It reveals the retained horse sites and enables Pasture. Archery, scouts, mounted units, finite horse extraction and horse stock remain Planned.
- Wheel: 84 science, requires Animal husbandry and Kiln firing. Water mill: 16 materials, 6 credits, 8 work; requires Wheel and this exact town's completed Irrigation; free base 1 food and 2 materials.
- Engineering: 144 science, requires Wheel and Masonry. Aqueduct: 22 materials, 8 credits, 12 work, era-1 construction gate; +6 completed housing, no resource yield; requires an actual adjacent mountain catchment.
- Pasture: 6 materials, 3 credits, 3 work, base 2 food, one remaining local resident, exact owned revealed horse site within three hexes of its assigned town. It shares the existing paid-buildings-first, then numeric-tile improvement allocation with Mines. Paused, unstaffed or currently ineligible sites produce nothing. Parent-town aggregate productivity and quantization apply once.

Research era remains metadata. All consumers use existing one-lane paid-at-start construction and end-of-beat completion. No automatic choices, new resource ledger or population grant is required.

## Explicit accepted adaptations

The current map has no river or freshwater field. Do not label ocean as freshwater, infer a river from grassland, or generate a decorative line. Water mill uses the accepted completed-Irrigation alternative. Aqueduct uses the accepted actual mountain alternative, at hex distance one from its own town center. Other water-source branches remain Planned.

The catalogue specifies grassland horses and a separate future finite 200-unit extraction card; it has no implemented cattle/sheep resource definitions. This first release retains real horse-site identity and reveal, consumed by a useful staffed Pasture food recipe. It does not implement or advertise the reserve, horse inventory, military consumption, cattle or sheep. A renewable worked-food site is distinct from the existing finite iron layer; extending `StrategicResource` with an unused horse counter would be the wrong seam.

## Minimal owner-authored schema proposal

Names below are exact recommendations for the orchestrator's declarations, not edits made by this report.

```ts
interface PastoralSite { tileId: number; resource: 'horses' }
interface PastoralSiteLayer {
  ruleVersion: 1;
  placementId: 'pastoral-sites-1';
  seed: number;
  tileIds: number[];
  sites: Record<string, PastoralSite>;
}
// WorldState.pastoralSites?: PastoralSiteLayer
// Observation.revealedPastoralSites?: PastoralSite[]
// ImprovementDefinition.siteRequirement: 'hill' | 'revealed-horse-site'
// BuildingDefinition.siteRequirement?: 'coastal' | 'mountain-catchment'
// BuildingConstructionOrder.catchmentTileId?: number
// BuildingConstructionCompletion.catchmentTileId?: number
// City.buildingCatchments?: Record<string, number>
```

Use one additive feature, provisionally `water-land`, and successor `settlement-water-land-1` after `settlement-growth-1`; owner chooses final IDs. New Pasture retains existing improvement order/completion/operation shapes, including actual resident and produced-food receipts. No new Pasture event field is necessary.

Water mill's own-Irrigation prerequisite fits existing `requiresBuildings: ['irrigation']`; it needs no new order field, water balance or river snapshot. A completed but paused Irrigation building still satisfies that construction prerequisite: the accepted card asks for completed infrastructure, not that beat's paid recipe operation.

Aqueduct is an ordinary per-town building, with no specialty-district population slot. Its catchment is a source, not a district occupation. Keep `tileId` reserved for existing district/build sites. At paid start, canonical eligibility finds actual adjacent mountain tile IDs sorted numerically and records the lowest as `catchmentTileId`. No extra caller action field or parallel planner is needed because the first version has no differentiated catchment effects. The active order, completion and durable `buildingCatchments.aqueduct` retain the same ID after later orders replace `lastCompleted`. The catchment can be unowned and shared by nearby towns; no mountain ownership or exclusive occupation is implied.

The source predicate is checked at start. Paid work and completed historical source identity remain retained if future terrain rules later alter eligibility; this release adds no water depletion, pipe route or teardown model. Validation checks historical exact identity/topology without claiming today's terrain proves the past. Current derived housing continues to use completed buildings, with no new stored total.

## Deterministic retained placement proposal

Author `PASTORAL_RULES` with version 1, feature ID, reveal technology `animal-husbandry`, resource `horses`, placement ID `pastoral-sites-1`, maximum 10, owned-site range 3, minimum separation 2 and seed salt `0x50415354`. Reuse the existing stateless site-ranking mathematics with the salted seed; never advance world RNG or reroll terrain.

Ranking for a tile is uint32 `(seed XOR salt XOR imul(tileId + 1, 0x9e3779b1))`, then the existing xor-shift/imul sequence: xor unsigned-right-shift 16 and multiply `0x7feb352d`; xor unsigned-right-shift 15 and multiply `0x846ca68b`; final xor unsigned-right-shift 16. Sort by unsigned rank then numeric tile ID. A small shared rank helper may serve iron with salt zero and pastoral sites with the new salt; preserve an exact old-iron placement control if that extraction is made.

Candidates are current grassland tiles with null existing `HexTile.resource`, excluding every city center, completed/reserved district, improvement or wonder, and existing iron deposit. Do not change terrain, elevation, owner, old food markers or iron records. In civilization-ID order choose at most one ranked already-owned candidate within three hexes of any owned town, subject to separation. Then fill in ranked order to at most ten, keeping separation. If a civilization has no eligible tile, skip it honestly; never alter geography or claim universal local access. Retain the resulting ordered tile list and exact keyed records once in a caught-up compatible migration. Later occupancy changes do not trigger reseeding.

Per-civilization reveal is derived from that observer's actual Animal husbandry technology, as with current iron reveal. Unresearched seats receive no revealed sites; canonical selected-civilization projection supplies the viewer's facts. Reveal itself grants no stock, output or ownership. The full backend layer is persistent state, not evidence that every civilization has discovered it.

## Actual current geography and useful witness

Read-only diagnostic `.blabla/scratch/specify-water-land-runtime/site-proposal.json` uses the real legal growth state at revision 217, round 163, seed 1701. It finds 50 candidate grassland sites. The proposed algorithm selects **47,149,175,81,38,164,33,79,84,44**, without modifying the state. This is a proposal computation, not an applied migration or promised live-world list; live occupants can exclude different sites.

- Verdant town `city-1`, center 48, owns unoccupied grassland 47, elevation 32, within one hex. Mountain 66 actually adjoins its center. This is a useful eventual same-town Pasture/Aqueduct branch.
- Aster capital `city-0`, center 57, has completed operating Irrigation and the proven Granary/University growth chain, but no free owned grassland candidate and no adjacent mountain. Its occupied Campus 39 cannot be relabeled a pasture.
- Aster's real coastal town `city-0-14`, center 23, has adjacent mountains 5,22,24 and a free lane. Lowest catchment is 5 under the proposed deterministic rule.
- Other owned candidate examples: Ember 149, Pelagos 175/158/156, Vesper 81/80. These are geography facts, not deposits until the real migration applies.

Tooling's parallel before-half reuses this actual 217-frame trajectory and exposes these separate exact-town roles without injecting future sites, technologies or water. The after-half must apply the real successor, reveal and work its actual chosen site, complete Wheel/Mill using real Irrigation, and complete Engineering/Aqueduct at a genuinely eligible town. If a single-town chain is useful, Verdant can legally obtain its missing Irrigation/prerequisites rather than pretending Aster already has grassland.

## Canonical source and validation seams

- Current `improvementSiteBlock` unconditionally calls `isHillSite`; branch on the declared site requirement and require actual revealed horse identity for Pasture. Keep ownership, exact town, range, occupancy and installed-history behavior shared.
- Existing improvements, allocator and aggregate production already support multiple exact sites and food output. Do not add a second allocation pass that lets Pastures jump ahead of lower-numbered Mines.
- Existing building eligibility and choices must share the new mountain predicate and blocker, e.g. `{kind:'mountain-catchment',cityId}`. Projection should expose actual available source IDs and the retained selected source, rather than make Art infer mountains or irrigation gates.
- Current catalogue purpose validation ignores positive housing, and `installBuilding` emits no housing effect. A housing-only Aqueduct would therefore be rejected or yield an invalid empty-effects completion event. Count validated positive housing as a real purpose and emit its actual completed housing/source fact; retain strict event validation, never add dummy production.
- Canonical layer validation: exact keys, supported immutable version/placement ID, matching world seed, at most ten unique safe existing tile IDs, canonical decimal dictionary keys and exact list/map equality. Do not rerun migration against later occupancy or mutable tuning.
- Catchment fields occur only on the Aqueduct building branch, never improvements/wonders/other buildings. Active/completion/durable copies must agree; installed mapping exists exactly with the installed Aqueduct. Retained source is an existing adjacent tile distinct from the town center. Old records omit all new fields unchanged. Paid/work snapshots remain historical, not compared to today's costs.
- Existing generic repository serialization needs no new endpoint or SQL schema. Server owns strict persistence, rollback, idempotency, public event and exact-detail joins when assigned.

## Deciding acceptance and honest limits

Use genuine old-release absence, unchanged geometry/RNG/iron, deterministic migration and reveal controls. Prove paid-once timed Pasture, positive worked food, no completion-beat output, pause/resume, shared numeric priority and no output while unstaffed/ineligible. Prove Water mill refuses missing/foreign/active Irrigation but accepts completed own infrastructure. Prove Aqueduct refuses a town without a mountain, retains the exact source across replacement of `lastCompleted`, and adds housing only after completion, with later paid growth and still-later opening staffing.

Synthetic scarcity/terrain corruption must be separately labeled. Host tests must exercise actual release/research/construction beats, replay, duplicate/CAS and receipt/transition insertion rollback. UI must distinguish revealed site, construction, installed infrastructure, current housing and actual paid output. The report's declared existence check proves only that this handoff is present; it is not runtime verification, contract binding, release application or delivery of the prepared pool.

Both required goals remain Partial. Orchestrator owns final schema/data/contract and exact runtime assignments; Core, Server and Art then own the connected implementation and evidence. The next useful step is that concrete source assignment, not another catalogue redesign. Future horse extraction/mounted use, cattle/sheep, real rivers/freshwater and the rest of the historical tree remain explicitly unfinished.
