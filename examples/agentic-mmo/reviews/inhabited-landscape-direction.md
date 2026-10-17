# Inhabited atlas: a visible landscape milestone

2026-10-16. Art Director: actual gpt-6-astra/xhigh. This assignment serves `goal::visible-growing-world`. The shared landscape is implemented and observed in matched captured-world SVG views. Independent visual acceptance and any deployed or runtime WebGL evidence remain separate.

## Chosen outcome

At the ordinary overview, the spectator should see a coherent inhabited landscape rather than a colored hex board with small symbols. Deep blue water and a continuous coastal rim establish the land. Forest canopies and rock masses establish terrain. Warm roof clusters, cultivated rows and distinct working-building footprints establish actual settlements. Territorial color remains an outline and small identity accents. These changes must be apparent without opening another inspection panel. The narrow overview has no open panel; the existing desktop layout keeps its inspector visible in both comparison images.

The existing actual live.11 SVG overview (`/workspace/scratch/87f8257873e4/live11-public-auto-updated-1188.jpg`) was re-inspected. Terrain has only flat hex colors, visible grid strokes and ownership overlays; the settlement parts read as small heavily outlined marks. Source confirms that the SVG adapter lacks the Three adapter's trees, mountains and coastal masses. The current kit already contains the truthful building families, so replacing it with downloaded assets would miss the principal composition problem.

## Verified reference and application

- Reused the actually inspected official Civ V manual page 21 and Civ VI manual page 28 findings recorded in `VISUAL_DIRECTION.md`: natural terrain remains primary, inhabited improvements occupy the land, and borders and city names form a separate readable layer. These are prior verified references, not a claim of another full manual review.
- Inspected the [publisher's Civ VII Steam gallery](https://store.steampowered.com/app/1295660/Sid_Meiers_Civilization_VII/) in the cloud browser on this date, after the public page lookup. The coastal battle image and [dense settlement beside cliffs](https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1295660/ss_ad61e86883bed33711a00965170fc4b4ae785774.1920x1080.jpg?t=1789481137) show grouped tree canopies, warm clustered built masses and strongly separated coast/relief. The application is grouping and hierarchy. No screenshot, texture, model, river, landmark, unit or architecture is copied into the project. This was a bounded still-image study, not gameplay or a full stream.
- Re-read the current primary [Three InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html). Repeated original geometry/material combinations can share instanced draws; matrix updates require their update flag, and bounds/disposal remain explicit. This supports extending the established batching vocabulary rather than allocating a distinct mesh/material for every tree. It does not prove a frame-rate budget on real hardware.
- Reused the verified SVG and W3C color/target references in the accepted route and visual-kit reports. Terrain decoration remains non-interactive; city and route selection retain their existing native alternatives, readable labels and 44px targets. Color does not replace exact civilization identity or condition text.

## Shared composition and truthful facts

1. **Land and water:** derive shore segments from the actual tile adjacency. Give only actual outer/coastal edges a restrained shallow-water rim and warm land lip. Quieten internal hex strokes. Do not add rivers, lakes, beaches with gameplay meaning, terrain ownership or passability.
2. **Terrain:** deterministic original canopy and angular rock masses come from each actual forest/mountain tile and normalized elevation. Desert and tundra receive restrained material/tone variation. Decorative terrain forms share one bounded layout between SVG and Three and never become resources, buildings or units. Keep town sites clear enough to read.
3. **Inhabited ground:** a compact ground footprint unifies the actual town's roof cluster and persistent built families. Actual population controls coarse cluster count and bounded footprint/density, including useful distinctions after the far-LOD roof cap is reached. A roof is a population symbol, not an individually simulated household. Do not pretend that cosmetic footprint is newly claimed land.
4. **Buildings:** retain every actual built family's guaranteed core before optional details and current damage within the existing 18/32/42 settlement-part caps. Farms read as cultivated ground and rows, workshops as a contrasting roof/workyard, irrigation as a basin/channel, and civic/fuel structures as their existing distinct masses. No absent building appears; pause and shortage do not remove constructed structures.
5. **Palette and depth:** warm cream walls and terracotta roofs make settlements separate from green terrain. Civilization color is a limited roof/identity accent and boundary, not a wash over all materials. SVG must paint visible faces and parts coherently instead of allowing back faces or arbitrary insertion order to dominate silhouettes. Three retains actual shared solid geometry and material batching.
6. **Boundaries and routes:** draw ownership transitions rather than every owned tile as a separate bright polygon. Preserve exact canonical city identity, selected-town framing and the accepted recorded corridor. This milestone does not invent paved roads, transit progress or ongoing cargo. Existing receipt-earned event accents remain unchanged.

## Bounded LOD and implementation seam

Far, mid and close remain screen-size levels with hysteresis. Every level depicts the same composition: coast/terrain/inhabited footprint remain; only secondary canopy/roof/field detail increases. Terrain decoration receives explicit per-tile and world caps separate from settlement 18/32/42 caps. Selected settlement and real building cores must not disappear to pay for decorative terrain. Existing 5/8/12 shared label caps remain.

Requested exact implementation paths:

- `visuals/landscape.ts` for pure adjacency, terrain-part layout, surface palette and bounded landscape allocation.
- `visuals/world-visuals.ts`, `visuals/building-visuals.ts`, `visuals/visual-language.ts` for population grouping and the original shared palette/shape vocabulary, preserving existing building-core guarantees.
- `web/flat-renderer.ts`, `web/renderer.ts`, `web/settlement-parts.ts`, `web/settlement-three.ts`, and new `web/landscape-three.ts` for the two actual adapters, ordered visible SVG faces and shared Three instances.
- `web/atlas.ts` only if the shared terrain palette/interface needs a small import or type extension; no canonical simulation changes.
- New `tests/landscape.test.ts`, existing `tests/visuals.test.ts` only if a new prospective invariant requires it, and this report. Existing web/route tests should run unchanged as regression evidence.

`web/main.ts`, common styles, HTML, event log, tree component and manifests stay with the separate integration owner. No new asset pipeline or dependency is needed. The old `visuals/settlement-kit.ts` named in the initial task inputs does not exist; actual kit dependencies are the world/building/visual-language modules above.

## Deciding evidence plan

Before source changes, retain the accepted bundle and one captured authoritative public state for an offline reproducible comparison. Clearly label the local display “Captured committed world” with revision and time, rather than “Live.” Keep exact camera center, zoom, selected city, theme, layers and viewport identical between before and after. Capture desktop 1188×761 and supported narrow approximately 504×761 overview with panels closed, then the same town close-up. A separate labelled synthetic fixture can test population tiers, all seven families plus damage and all LODs without inventing online state.

Prospective assertions must fail for today's missing behavior: coast only at true missing-land adjacency; internal ownership edges suppressed; terrain masses deterministic and tied to canonical terrain; no decoration on an absent/unknown building; population changes alter the bounded silhouette at a fixed LOD; all building cores and damage survive; geometry/instance/label caps; immutable input; matching semantic layout in both adapters. Preserve current selection, route and camera regression tests. Type, strict lint and web build are source evidence only.

Actual pixel acceptance asks: can a viewer distinguish forest, elevated rock, coast, farms and the inhabited town at ordinary zoom; identify the five civilization places; distinguish sparse and dense populations without a panel; and still read/select a town or recorded link? The after image must show a substantial default-map change, not merely a closer camera, a new panel or changed world state. Creative independently reviews the connection to actual growth and buildings. Parent independently accepts the paired pixels and owns publication. New live deployment pixels remain pending until a release exists.

## Uncertainty and stopping condition

The cloud browser currently exercises SVG because WebGL initialization is unavailable. Shared geometry/instance tests can support the Three adapter's source but cannot certify its runtime appearance, GPU performance or physical touch. Actual 360/390/430px or hardware results will not be claimed from the available approximately 504px viewport. If heavy terrain detail masks town silhouettes, reduce ornament before weakening factual labels or core building visibility. This task is complete only at its assigned implementation and actual matched-pixel boundary; broader future growth, effects and hardware evidence stay explicit instead of being inferred from green tests.


## Implemented result and actual comparison

The pure landscape projection now derives actual coast and ownership transitions, deterministic grouped forest canopies and elevation-scaled rock silhouettes. It reserves inhabited ground before bounded secondary terrain detail. The shared terrain cap is 384/768/1152 parts for far/mid/close; settlement caps remain 18/32/42 and shared label caps remain 5/8/12. The captured real world uses 142/222/336 landscape parts, 122 coast edges and 90 owner edges. Towns use 10/19/23 parts, or 13/22/26 for the actually damaged Tidehaven. No building, population, ownership, production or route fact was changed.

Warm walls and roof groups now scale from actual population even after the far roof-count cap. Cultivated rows read as a continuous field mass at far detail. Both renderers consume the original box/gable/cylinder/cone/canopy vocabulary. The SVG painter removes hidden back faces and orders visible faces by shared depth with a stable part-ID tie break. Three uses geometry/material batches, instance update flags and explicit bounds/disposal. The local source test exercises these objects without claiming a functioning GPU.

The baseline bundle was retained before source edits. One public GET captured real revision 228 on 2026-10-16 at approximately 16:55 UTC. The local loopback fixture serves that exact response unchanged to both retained bundles. Its visible banner says “Captured real world · rev 228 · BEFORE/AFTER.” The app's underlying status still says Live because it is the unchanged app, so the fixture banner and this report are essential: these are captured-state comparisons, not an online development deployment. All five real towns have 20 residents in this capture, and all have built fields and workshops. Tidehaven's real 35% damage and the actual Tidehaven–Lumen agreed corridor remain present.

Actual cloud-browser screenshots, saved in `/workspace/scratch/87f8257873e4/`:

- `landscape-before-504.jpg` / `landscape-after-504.jpg`: actual 504×761 narrow overview, no inspection sheet. Both use SVG viewBox `-19.764705882352942 -26 39.529411764705884 52`. Forest/rock/coast masses and warm roofs are visible at the same ordinary camera. All five town labels and dock entries remain visible.
- `landscape-before-1188.jpg` / `landscape-after-1188.jpg`: actual 1188×761 desktop overview at scrollY 0. Both use viewBox `-28.436363636363637 -16 56.872727272727275 32`. The existing civilization dock, story and inspector occupy the same layout. The map difference is not a new panel or a zoom change.
- `landscape-before-town-1188.jpg` / `landscape-after-town-1188.jpg`: same real Lumen selected, two Zoom in actions, same viewBox `-19.747474747474747 -11.11111111111111 39.494949494949495 22.22222222222222`, close detail. The field/workshop and roof cluster sit inside terrain masses with the retained corridor unchanged.

The after bundle also includes Creative's separate tree/log integration. Its Research & buildings button appears in the existing inspector; this is disclosed rather than attributed to the landscape. The six map screenshots use equal world, camera, viewport, selection and layers. No online fake state was injected. No delivery or production animation was earned by loading the fixture.

A bounded inherited camera limitation was reproduced in both bundles: opening the narrow Aster sheet and then zooming in twice can move Dawnwell under the top status area. The before evidence is `landscape-before-town-zoom-504.jpg`; the after evidence is `landscape-after-town-504.jpg`. This is not caused by the landscape, and its source is unchanged here. The parent was informed for a separate camera follow-on. It is not represented as a successful selected-town close-up.

## Prospective source evidence and transfer limits

The initial scratch test run had an incorrect import path and is retained as `setup-import-error.log`; it is not counted as a behavioral RED. After correcting the import, `red-composition.log` contains five meaningful assertion failures for missing coast/terrain/population/face behavior. `red-adapter.log` contains the missing Three landscape adapter behavior failure. The first wired source run passed 65 tests. Initial contextual flatMap typing and unsafe test narrowing were repaired before strict type/lint success; those initial failure logs are retained rather than hidden. An additional geometric occlusion regression now samples the actual ordered SVG faces for all seven built families, current damage and population at 4/20/40 across every LOD. It verifies surviving exposed geometry, not subjective recognition at a distance.

The first oversized cloud execution returned exactly “JavaScript execution exceeds the 64000-byte strict auto-review limit.” The rejected call and complete return were preserved. After the orchestrator classified this as an input-size limit, the same non-secret archive was read through the verified shared workspace and its complete SHA-256 checked before extraction: `874297e4c578c2d0320ed002790ffba183774a02f228b0f1b17935b2dcd2d325`, 331894 bytes. No external upload service was introduced.

A CUA Node HTTP listener was not reachable by Chromium; its network context differs. The existing native terminal fixture established the correct supported context. A local Python3 server was started through documented native keyboard input on authorized loopback port 4175, with only GET handlers and fixed captured data. The actual page then rendered successfully. No network/security settings or browser restrictions were changed. The public tab and earlier fixtures remain untouched.

The actual labelled synthetic kit gallery was also inspected at 1188px: `landscape-kit-1188.jpg` and `landscape-kit-close-1188.jpg`. It places all seven built families and 35% damage beside 4/20/40-resident roof symbols at far/mid/close, in enlarged and small views. Sparse versus dense clusters read clearly; the 20-versus-40 distinction is intentionally subtle at the far roof cap and grows at close detail. Every family retains exposed geometry. This does not imply the captured live world has those seven buildings or those populations.

Final source cleanup moved the unchanged hex-position formula to the shared pure landscape module and re-exported it through the existing atlas API. Terrain, towns and routes therefore use one coordinate authority; no adapter-specific coordinate copy remains. The stable depth tie-break and this algebraically identical extraction do not alter the comparison's layout, but the final build/check below covers their exact source.

The first formal deciding run passed all 66 tests and typecheck, then stopped on strict lint because the new pure test helper was nested without capturing state. It was moved to module scope. The retained task evidence records this exit 1 honestly; the final successful receipt must follow that repair.
