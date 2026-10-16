# Worked Mine: exact persistence and operation seam

Creative Director, actual gpt-6-astra/xhigh, 2026-10-16. This is the narrow design handoff for `specify-worked-mine-persistence`. The accepted422-card catalogue and Writing implementation remain unchanged. The types below are proposed shared source for integration to author, not implemented runtime or live availability.

## Settled consequence and source basis

Mining costs20 science after Kiln firing. A Mine costs6 materials and3 credits, requires4 work, and supplies base2 materials only when one local resident works it. Existing construction, paid recipes and trade already consume materials. The first slice therefore has a real resource consequence without pretending that ordinary materials are iron.

Use current unchanged land: non-ocean/non-mountain elevation70–88 is the version1 hill classification. A site must already belong to the exact town's civilization, lie within3 hexes of that town, and be neither a town center nor any completed/reserved district/improvement. No tile ownership, founding radius or map regeneration is introduced. The existing legal58-transition prefix retains Campus39 and leaves Aster56/58 available. All nine candidate hill sites across the five civilizations have resource:null.

The prior primary reference and design remain the Civ VI citizen/worked-tile rule: owned land within3 hexes, one working town per tile and citizens allocated rather than consumed. The current engine adaptation is explicit: paid recipes retain priority, followed by worked Mines; the existing timed town lane substitutes for a separate Builder unit. No new research pass or catalogue retuning is needed.

## Exact proposed TypeScript

Preserve the current building record's serialized fields, including its absent discriminator. Rename its source interface if necessary, then introduce a discriminated improvement alternative. Do not migrate old saved building orders merely to add `kind`.

```ts
export interface BuildingConstructionOrder {
  tileId?: number;
  id: string;
  cityId: string;
  buildingId: string;
  ruleVersion: 1;
  startedRound: number;
  paid: Partial<Resources>;
  workRequired: number;
  workDone: number;
}

export interface ImprovementConstructionOrder {
  kind: 'improvement';
  id: string;
  cityId: string;
  improvementId: string;
  tileId: number;
  ruleVersion: 1;
  startedRound: number;
  paid: Partial<Resources>;
  workRequired: number;
  workDone: number;
}

export type ConstructionOrder =
  | BuildingConstructionOrder
  | ImprovementConstructionOrder;

export interface BuildingConstructionCompletion {
  tileId?: number;
  orderId: string;
  cityId: string;
  buildingId: string;
  startedRound: number;
  completedRound: number;
  paid: Partial<Resources>;
  workRequired: number;
  eventId: string;
}

export interface ImprovementConstructionCompletion {
  kind: 'improvement';
  orderId: string;
  cityId: string;
  improvementId: string;
  tileId: number;
  startedRound: number;
  completedRound: number;
  paid: Partial<Resources>;
  workRequired: number;
  eventId: string;
}

export type ConstructionCompletion =
  | BuildingConstructionCompletion
  | ImprovementConstructionCompletion;

export interface ImprovementOperationResult {
  round: number;
  status: 'operated' | 'blocked' | 'paused';
  paid: Partial<Resources>;
  produced: Partial<Resources>;
  residents: ResidentAllocationResult;
  blockedReason: 'resident-shortage' | 'site-ineligible' | null;
}

export interface CityImprovement {
  improvementId: string;
  tileId: number;
  completion: ImprovementConstructionCompletion;
  operation: {
    enabled: boolean;
    lastResult: ImprovementOperationResult | null;
  };
}
```

Add only `City.improvements?: Record<string, CityImprovement>`. Keys are the canonical decimal safe tile IDs, with no leading zeros; the key must equal the record's tileId. The parent City supplies current ownership. `(city.id, tileId, completion.orderId)` is the exact immutable instance identity. `improvementId` is the catalogue ID (`mine`), not the instance. This permits several Mines in one town without placing duplicate `mine` entries in `City.buildings` or borrowing a district association.

Retain the existing `CityConstruction` shape, with its active/completed fields using the unions above. The installed record retains its own completion even after the town's `lastCompleted` moves on. At initial completion, both copies must agree exactly. Multiple retained copies of that same completion are aliases of one installation, not duplicate construction. There is no separate improvement queue.

Add exact actions:

```ts
{ type: 'improve'; cityId: string; tileId: number; improvementId: string }
{ type: 'set-improvement-operation'; cityId: string; tileId: number;
  improvementId: string; enabled: boolean }
```

Both are explicit typed intents in the ordinary plan/parser/atomic-host path. Reject incomplete, surplus, malformed, foreign, missing, already-built/reserved and mismatched-kind targets. Never accept an old building action as a hidden improvement alias. A pause must match the currently installed exact-town/tile/catalogue record; no other town or site fallback. Old releases refuse these new actions and accept absent improvement fields.

The small data definition should include id/name/description, requiredFeatures, required technologies, minimum era, construction cost, requiredWork, site range/classification, residentsRequired and base production. For Mine these are the settled values above. Shared rule data names the version1 hill band and the paid-recipes-before-improvements priority; no new mandatory `Resources.iron` key is introduced.

## One lane, one reservation, one completion

1. Start uses canonical eligibility, the exact site, current affordability and existing actor admission. It pays once, snapshots cost/work/ruleVersion, and reserves that tile through the active improvement order. A building, Campus or improvement already active in that town prevents another start.
2. Global occupancy is a shared predicate over town centers, installed district sites, tile-bearing active district orders, installed improvements and active improvement orders. Both founding paths and district starts use it under the new release gate. An improvement does not consume district capacity; district counting must explicitly distinguish the union branch.
3. Opening construction work is computed once from the existing town facts. The improvement receives the same end-of-economy work update and clamping. Completion stores the exact installation and immutable completion, sets enabled=true/lastResult=null, emits an exact-site completion event, and clears the single active lane. It does not add infrastructure or a building effect absent from the Mine card.
4. The new Mine first receives residents and produces on a later beat. No completion-beat output, stock refund or second payment occurs. Cancellation, replacement, reparenting, removal and new ownership acquisition are outside this first slice; do not invent their histories implicitly.

## One resident budget and honest output

- Derive the existing opening capacity `max(0, population - communityReserve)` once per city. Keep the current city/building ordering and all funded paid-building allocations unchanged.
- Within that same allocation boundary, assign the remaining residents to installed improvements in **numeric tile-ID order**. Each enabled, currently site-eligible Mine requires exactly1 resident. A failed paid recipe consumes neither resources nor residents, so the unallocated resident remains available. No population changes; capacity resets each beat.
- Paused Mines allocate0 and produce0. An unstaffed Mine records blocked/resident-shortage, required1, the actual remaining capacity, allocated0 and empty paid/produced vectors. An invalid current site records site-ineligible and contributes nothing. No new input-shortage list is needed because the ordinary Mine has no recurring material input.
- Preserve the existing free-building and paid-building production/receipt calculation first. Append each staffed Mine's base materials2 through that same town aggregate/productivity/rounding accumulator, in numeric site order. Its recorded produced vector is the actual incremental quantized contribution. Credit the output exactly once; there is no autonomous unscaled resource bonus or second stock-credit pass. This also keeps prior paid-building receipt attribution unchanged when Mines are added.
- The allocation occurs before any same-beat production, trade or growth. Mine materials cannot fund an already-evaluated paid recipe in the same beat. A later beat may use them normally. A newly grown resident cannot staff an additional Mine until the next allocation.
- `lastResult` is bounded to one historical operating result. Toggling enabled does not rewrite that result or imply a new harvest. Emit exact site/city/name/round and real allocation/output facts with the existing event conventions. An operated Mine can record zero output at zero productivity; activity artwork requires actual positive output.

## Canonical decision and presentation facts

The existing construction obligation is Active for the improvement order and Required when an affordable eligible building **or improvement** start exists. Its capability token for an improvement is namespaced `improvement:mine`; ordinary building IDs keep their current values. Exact tile alternatives belong in the canonical action options and projection, not a second viewer eligibility function. The active union already carries the exact tile/work. Completion reveals the next choices from current state, with no automatic queue execution.

Expose three separate facts: eligible site's base potential, active/retained construction with exact payment/work, and installed operation's current enabled flag plus historical result. Inspecting a paused Mine must not erase an earlier operated receipt. A completed Mine is a visible map occupation even if it is currently unstaffed. Stock, base materials2, actual produced materials and resident allocation are separate quantities.

## Validation, persistence and acceptance boundary

The reader must validate the new feature gate, exact union keys, safe tile IDs, existing own town, unique order/installation identities, global site occupancy, exact completion/site association, round bounds and bounded operation result. Disallow a record carrying both buildingId and improvementId. Preserve old no-kind orders/completions byte-for-byte. Validate historical cost/work/result as retained facts rather than comparing them to mutable current tuning. Reject installation or active-record aliases which create two working towns for one tile. Treat the installed completion and matching town lastCompleted as the permitted same-instance alias described above.

Required future witnesses are the legal58-frame before-half extended by release → produced-science Mining → paid exact Mine56 → work/completion → later staffed materials; legal pause/resume; equal-beat enabled/paused output comparison; existing Library/paid recipe priority; labeled resident scarcity; exact site competition with Campus; one town lane; no same-beat recipe funding; duplicate/CAS/refusal rollback; JSON replay/file reopen; retained facts after feed trimming; truthful source/public UI limits. The prospective implementation and hosted checks must supply these. The six current prefix tests establish none of the new Mine successes.

Finite iron stays a separate prepared successor: versioned deterministic placement on preserved geography, per-civilization reveal, bounded remaining reserve, strategic stock, extraction and a real consumer or consented trade. Existing `HexTile.resource` food markers and ordinary materials are not finite deposits. A decorative ore marker or unused iron counter would leave that outcome unmet.

## Delivery status

**Inhabited empire map: Partial.** This handoff settles the implementable exact-site/work/resident seam and reuses genuine legal candidate facts. Mining code, strict durable migration, applied release, actual model site choice and resource consequence, readable public map evidence, finite deposits, unique wonders and broader extent remain open. Integration owns the shared declarations and implementation assignment; Core, Server and Art own their bounded witnesses. The next useful action is the ordinary worked-Mine implementation against the retained prefix, followed by its applied outcome, without claiming the whole empire goal complete.
