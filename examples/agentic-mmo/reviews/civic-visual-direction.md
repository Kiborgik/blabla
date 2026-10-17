# Civic places: a small original visual kit plan

Art Director research and proposal, 16 October 2026. This is a bounded plan for future assigned implementation, not a source change, gameplay decision or claim that civic capabilities are live. The current live foundations world has no civic buildings or paid civic receipts.

## Basis and scope

The settled `DESIGN.md` civic slice and `ROADMAP.md` R06 own the intended culture → learning → fuel connection. Current `core/content.ts` still contains the older prepared House of learning definition, which produces science and culture without operating inputs; it does not yet contain Fuel management or the Fuel yard. Their proposed replacement/addition must be accepted in canonical content before presentation uses it. Read the actual catalogue again at implementation time.

Research reused these already verified references, with no new viewing or downloaded assets claimed:

- The [official Civilization V manual, page 21](https://store.steampowered.com/manual/8930) and [Civilization VI manual, page 28](https://cdn.steamstatic.com/steam/apps/289070/manuals/CIV_VI_25TH_ONLINE_MANUAL_ENG.pdf?t=1636653176), previously inspected as rendered pages in `VISUAL_DIRECTION.md`: natural geography, identifiable settlements and restrained surrounding information. Application: the new place must change a readable silhouette rather than add another tiny paragraph.
- The [first-hand Firaxis art interview](https://www.qualbert.com/civilization-vii-team-interview/), previously inspected in that direction: building masses must work at distant and near camera views. Application: distinct public platform, learning roof and fuel stack before ornamental detail. No copied architecture, textures or assets.
- Verified [Three InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html), [LOD](https://threejs.org/docs/pages/LOD.html) and [cleanup](https://threejs.org/manual/pages/cleanup.html) research in `VISUAL_KIT.md`: extend existing shared solids/material batches and active screen-size detail. These documents do not prove mobile frame rate or memory use.

Current code inspected: `visuals/building-visuals.ts`, `world-visuals.ts`, `visual-language.ts`, `core/simulation/operations.ts` and `web/settlement-inspection.ts`. Existing box/gable/cylinder geometry and original semantic icons are sufficient. A separate GLB pipeline is unnecessary for this increment; these reusable parts can later be packaged without changing their state semantics.

## Three recognizable places

| Canonical family | Far silhouette and material | Middle detail | Close optional detail |
| --- | --- | --- | --- |
| Civic gathering place (`monument`) | Low, broad stone cylinder/platform; its horizontal profile differs from the tall kiln | A simple timber public canopy or short identity-colored upright | Two low benches and a small gold accent, only if spare budget exists |
| House of learning (`academy`) | Broad pale gable roof, visibly wider and quieter than the compact workshop | Plaster base with a dark entrance | A small paired tablet/book-like sign and one courtyard slab; no named scholars or simulated classes |
| Fuel yard (`fuel-yard`, proposed) | Low dark-timber stack formed from broad boxes; no round kiln body | Lean-to roof over the stack, keeping an open front | A second offset stack or short feed tray, with no permanent fire |

Use existing stone, plaster, timber, roof and metal colors. Civilization identity remains an accent, never the status color. Culture, science and energy keep their existing resource icons and words; building icons may be original platform, wide-roof/tablet and stacked-fuel outlines. An icon alone must not be the only way to distinguish two buildings.

Keep a compact non-overlapping schematic settlement footprint. Reserve deterministic slots for these families before adding details, and preserve a separate condition-badge slot. Inspect a fully built seven-family city beside neighboring city markers; do not let new art spill into another city's label or imply a real expansion of territorial tiles. The layout is a settlement glyph, not a literal cadastral map.

## One accounting vocabulary

Use canonical construction cost, operating inputs and base outputs through the shared formatter prepared by the core task. Do not repeat balance numbers in visual modules or turn base capacity into a promised yield. The proposed values below explain the intended plan only:

- Gathering place: its current prepared definition supplies base culture 4 and has no recurring paid recipe. Keep its built card; a city-level production receipt can show actual culture made. Do not invent an individual gathering operation or credit every cultural change to this building.
- Learning: proposed opening inputs culture 2 + credits 1, base science 3, no returned culture. Its actual receipt may make less or zero after productivity and rounding.
- Fuel yard: proposed opening input materials 2, base energy 3. Its energy is available only after the actual completed beat. It cannot retroactively fund a kiln's already checked opening inputs.

Opening-stock allocation and stable city/building order remain engine responsibilities. Show construction payment once, current On/Paused choice, and the last round's exact Paid/Made/shortage receipt as separate facts. Newly built and enabled says **Ready for next season**. A paused building retains its structure and previous receipt. A blocked record says which resource was short at that recorded opening stock, not what today's stock is. Paid with zero output still shows Paid and no work effect.

Do not invent culture migration, political allegiance, specialist counts, fuel shipments or automatic historical dates. Those require their own committed mechanics and records.

## Events and restrained motion

Construction adds the persistent shape only when the building appears in committed city state. A positive building-operation receipt may produce one brief science or energy icon-number cue at the exact city; use the existing work-cue lifecycle and settings rather than a separate loop. Learning can use a small upward light accent; fuel can use a short warm pulse. These are presentation of that receipt, not continuous production. No positive receipt means no working smoke, glow, crowd, harvest or output animation.

Keep city-level culture production city-level unless a future canonical receipt attributes it to the gathering place. Initial history, reopened inspection and repeated polling never replay operations. Calm and device reduced motion retain all figures with no moving accents. Shared bounds remain one local cue on narrow views and three on wider views; agents never wait.

## Preserve the part and label budgets

Current damaged four-building settlements use 17/29/39 parts at far/middle/close, under caps 18/32/42. Simply appending three civic families to the current array before its final slice can silently hide later buildings or the damage sign. This is the important implementation dependency.

Extend the data-defined catalogue with essential and optional parts, then allocate in a stable order: reserve current condition parts, retain the population silhouette, guarantee one recognizable core for every built family, and only then add foundations or decorative detail. Do not raise global caps as a shortcut. With all seven families, a feasible reservation is:

- Far: six house parts + seven core silhouettes + three condition parts = 16, leaving two optional parts.
- Middle: twelve house parts + two parts per family + three condition parts = 29, leaving three optional parts.
- Close: sixteen house parts + up to three parts per family + three condition parts = 40, leaving two optional parts.

When there is room, retain the richer existing farm/workshop/cistern/kiln parts. Under saturation, degrade ornament before deleting a built family or condition. A guaranteed core can be a roof or platform without every physical wall; inspection continues to state the full building fact. Implement this as a small shared allocation rule used by SVG and Three, not separate renderer branches. Keep current screen-size thresholds/hysteresis, selected-label priority, 12px minimum names and 44px targets.

## Small implementation and evidence plan

After canonical civic data/receipts are accepted and a visual implementation task opens:

1. Add three catalogue appearances and shared essential/detail allocation. Preserve earlier IDs and condition semantics.
2. Reuse exact current/last-receipt inspection. Add canonical pre-build explanation only through the assigned formatter seam, without human build controls.
3. Reuse positive-output event cues with family/resource icons; no new scheduler or recurring animation.
4. Test all seven families plus maximum population and damage at every detail, stable allocation after building-order changes, every built family present, unchanged shapes through pause/block, exact Paid/Made, zero-output stillness and no historical replay.
5. Inspect clearly labelled offline fixtures and actual deployed cities when their records exist. Capture narrow/short and desktop layouts, both themes and Calm. Check that the new families are distinguishable at real map scale, not just an enlarged asset sheet.

Uncertainty remains in small-scale silhouette legibility and fully occupied slot layout until those pixels exist. Cloud SVG cannot establish WebGL quality, physical touch or frame/memory performance. The known short-desktop story overlap remains the next separately assigned UI repair; this plan does not expand that patch into a renderer rewrite. The declared visual test run is a baseline regression check only and cannot validate this unimplemented art direction.
