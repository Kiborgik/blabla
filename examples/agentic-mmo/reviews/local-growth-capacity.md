# Local housing, real growth and staffed production

Actual gpt-6-astra/xhigh Creative Director, 16 October 2026. Bounded design for `design-local-growth-capacity`; no runtime change or live housing outcome is claimed. The accepted 422-card catalogue remains unchanged.

## Exact connected increment

- Masonry retains Mining as its prerequisite. The catalogue base cost is 28 science; apply the accepted persistent-world 3× pacing only to this unreleased card, giving **84 science**. Its era 0 is research metadata, not a prohibition on later civilizations choosing it.
- Granary retains Masonry, exact owned town and era 0 construction gate; **14 materials, 6 credits, 8 work**, paid once through the existing city construction lane. Completion supplies **base 2 food** through ordinary city productivity from the next beat and **4 housing**. No new resident allocation or operating input is required for this free building. It is not pauseable.
- Food-spoilage protection, Walls and Quarry remain explicitly Planned until their actual mechanics ship. Granary's current increment must not claim the complete designed card merely because housing and food are supported.

The previously inspected official Civilization VI manual describes Housing as population support that affects growth and can come from buildings, districts and other sources (Housing section, retained local text `/tmp/civ6-pace-manual.txt`). Source: https://downloads.2kgames.com/civilization/vi/manuals/eu/CIV_VI_25TH_ONLINE_MANUAL_ENG.pdf . Our hard capacity, quantities and beat rules are the accepted compressed-world adaptation, not asserted Firaxis values. This reuses the established reference rather than selecting a conflicting series baseline.

## Released housing and compatibility

Use one feature-selected growth rule. Current old-release behavior remains exactly the universal capacity 20, growth food cost 6 and existing upkeep, wellbeing and reserve rules.

On compatible adoption, give each existing town a retained base housing snapshot of **max(20, its current population)**. Preserve every population, stock, active order, research target, clock and historical event. This protects the capacity already available to young existing outposts as well as mature capitals; it does not grant residents or reimburse old growth.

A genuinely new town founded under the released rule starts with **base housing 8**. Both land and coastal founding use the same initialization. Existing conserved three-person transfer, source minimum, food/material/credit cost and exact path rules remain intact. Do not reinterpret an older founding receipt as an eight-capacity town or create population during adoption.

Derive current capacity from retained base plus the completed town's housing sources. This slice has only Granary +4, once. An active Granary contributes nothing. Housing belongs to its exact town and cannot be pooled across a civilization. A current population above capacity is not clamped or deleted; it simply cannot grow until capacity permits. Future housing loss must likewise not silently erase people.

The accepted population-scaled growth food cost is included in this same released rule: **6 + floor(opening population / 4)**. Existing 0.5 food upkeep per opening resident, wellbeing threshold 60, post-upkeep reserve threshold 10 and gain of one resident remain. Each successful growth pays its exact computed food cost; shortage, inadequate wellbeing or full housing produces no growth payment. The new formula never reprices previous growth or charges adoption.

## Timing and meaningful consequence

The actual economy already allocates paid recipes and Mines from opening local population, produces, supplies/grows towns, then completes construction. Reuse that order.

For a twenty-person town whose Granary completes at the end of beat t:

1. Beat t uses the old housing and opening residents. Construction completion changes capacity to 24 but does not add food output or people retroactively.
2. At t+1, the completed Granary contributes ordinary food production. If current supply, wellbeing and reserve conditions all pass, growth pays 11 food and changes population 20→21. Recipe allocation for that beat still used opening population 20.
3. At t+2, opening resident capacity is 21−3=18. The extra resident may now support a previously blocked recipe under the unchanged deterministic allocation order. Production requires the actual inputs as well as residents.

Four successful later growth steps 20→24 consume 44 growth food in total, separately from ordinary upkeep. At capacity 24, local working capacity is 21 rather than 17. Population alone still does not multiply base city output: the useful consequence is additional real staffed operations, district-cap consequences where already supported, and greater upkeep.

A deciding legal example is five enabled paid recipes using 15 residents, followed by University requiring 3. At population 20 it has only 2 remaining and is blocked; after actual growth to 21, the next opening allocation can fund it. Preserve the existing paid-recipes-first order. If the town also has a Mine, the newly operating University can temporarily displace that lower-priority Mine until further growth supplies another resident. Record that tradeoff instead of presenting housing as free unlimited production. Do not pause an earlier recipe invisibly to manufacture the witness.

## Minimal shared seam

Proposed names for the schema owner; this report does not change TypeScript:

```ts
type CityHousing = {
  ruleVersion: 1;
  baseCapacity: number;
  establishedRound: number;
  origin: 'legacy-adoption' | 'founded';
};
// City.housing?: CityHousing
// BuildingDefinition.housing?: number  // Granary = 4 in this release
type CityGrowthFacts = {
  cityId: string;
  ruleVersion: 1;
  population: number;
  baseCapacity: number;
  sources: { buildingId: string; capacity: number }[];
  capacity: number;
  nextGrowthFoodCost: number;
};
```

One shared `cityGrowthFacts(state, city)` derives completed sources, capacity and the exact current-population growth cost. The supply rule and canonical observation/capability projection consume that helper. Do not store a second mutable total or copy eligibility into the viewer. Housing is distinct from `residentCapacity`: the former limits later growth; the latter remains opening population minus community reserve. Label the derived cost as the next growth requirement, not a guaranteed forecast that ignores other towns' shared food use.

Retain the capacity and cost basis in the actual population-growth event alongside exact before/after population and food payment. Existing historical events remain valid without those new facts. Completion retains the ordinary paid/work snapshot; a viewer must distinguish construction completion, changed capacity, later population growth and later operation. Current housing can be projected without inventing a historic housing value for an old event.

The released validator requires finite integer base capacity and round, recognized origin/rule version and complete housing metadata for towns belonging to the new rule. Old releases omit the optional field. Historical base snapshots are not recomputed from today's population or catalogue; future legitimate tuning needs a version rather than invalidating earlier records. Existing city IDs, topology and founding histories remain unchanged.

## Deciding witnesses

Reuse a legal paid-production predecessor and actual growth to population 20; do not inject population, housing, food, era or technologies for the main journey. Research Masonry, choose an exact Granary, preserve paid-once progress/completion, prove no same-beat population or output, then record food-funded later growth and the next opening staffed recipe with exact input/output. Compare an equal-beat unbuilt control. If a Mine loses allocation, retain that result as part of the witness.

Separately cover current housing full, insufficient post-upkeep food, low wellbeing, active-but-uncompleted Granary, duplicate command, wrong town, existing over-cap population and another town remaining unchanged. Demonstrate both new land and coastal towns initialize at 8 while adoption preserves existing capacity. Real SQLite rollback/reopen/replay must retain base snapshots, completion and growth payment; corrupt mixed-rule records refuse without repair. Synthetic scarcity controls are labeled separately. A live completion→capacity→paid growth→later operation sequence and supported spectator evidence remain required after implementation and application.

## Finite headroom and next connected card

Masonry84 adds only **four beats at fixed 26.25 science**, or **three at the recently observed Pelagos rate near28**. This is a useful local decision, not sustained research coverage. Preserve the existing 942-science learning/metal and 348-science manufacturing accounting without claiming those totals are still unspent in the live world. Old completed and active research costs stay unchanged.

The next concrete accepted outcome is **Engineering → Aqueduct**: Engineering catalogue48 science, proposed same 3× release tuning144; prerequisites **Wheel and Masonry**. Aqueduct costs22 materials/8 credits, work12, era1, housing+6 and requires a real fresh-water source or mountain catchment. The new housing helper can carry its eventual completed contribution; no fictitious river or automatic site qualification is allowed.

Engineering is not immediately reachable merely after Masonry. Its still-Planned prerequisite branch is Animal husbandry20→Wheel28, with Agriculture and existing Kiln firing gates as recorded in the catalogue. Those cards need their genuine pasture/deposit and Water mill consequences before release; their proposed3× values60/84 are future data, not applied costs or extra headroom already delivered. Keep that exact dependency chain as the next implementation preparation, rather than dropping prerequisites to offer an empty Engineering label. No broad catalogue redesign is requested here.

This report's existence check is bookkeeping only. Both prepared-pool and inhabited-empire goals remain Partial: orchestrator/Core/Server/Art own implementation, legal and durable witnesses, coherent application and actual visible local staffing consequences. Spoilage and the later branch remain explicit unfinished work.
