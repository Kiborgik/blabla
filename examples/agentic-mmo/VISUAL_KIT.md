# See what changed

Art direction and implementation boundary, 16 October 2026. Original shapes and icons only. The immediate outcome is a map that shows the world changing before someone opens a paragraph of history.

## Current delivery and limits

`visuals/world-visuals.ts` projects committed city facts into reusable shape parts. `visuals/event-visuals.ts` makes bounded presentation cues from committed events. `visuals/visual-language.ts` owns original icons, materials and screen-size detail budgets. These modules do not mutate the world or require a renderer acknowledgement.

The shared vocabulary task is closed. The renderer successor now wires committed houses, farm rows and workshops into SVG and Three source. Three groups instances by shared solid and material; only the active detail level exists. Original geometry, icon-number cues and selected-first label density have focused tests. Publication and actual new-map pixel acceptance are still pending. No GLB, WebGL performance or physical-phone result is claimed. A passing numerical test is not a screenshot.

## Research and decisions before implementation

- Actual deployed live.2 at 500 × 757 CSS px showed terrain and city letters, while inspection already reported built fields. The SVG fallback has no building or population silhouettes. Existing Three cities have seven decorative houses regardless of population, and tiny generic boxes for buildings. This gap directly explains the owner's text-heavy experience.
- [Three InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) supports repeated geometry/materials with per-instance transforms. Updates require the corresponding instance buffer update flag; changed bounds and disposal need explicit ownership. Use one shared geometry/material pool, not a mesh/material fork for every event.
- [Three GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [GLTFExporter](https://threejs.org/docs/pages/GLTFExporter.html) and the [Khronos glTF 2 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) support a reusable asset pipeline. GLB is a packaging option for the original shape kit, not a prerequisite for making current buildings visible. Initial assets need no external textures, decoder downloads or new dependencies.
- [Three LOD](https://threejs.org/docs/pages/LOD.html) documents hysteresis to avoid boundary flicker. Installed Three 0.186 also accounts for camera zoom. Our shared decision uses projected tile diameter in CSS pixels so mobile and desktop receive comparable density.
- [Three color management](https://threejs.org/manual/pages/color-management.html) distinguishes linear rendering colors from sRGB display colors. Keep palette conversion explicit when exporting/importing assets; do not fix color-space mistakes by turning up the lights. [Cleanup](https://threejs.org/manual/pages/cleanup.html) confirms that geometry, material and texture lifetimes must be owned explicitly.
- Gameplay source and the Creative Director confirm drought is a one-time food/wellbeing change. There is no persistent drought duration, dead-field state or drought damage field. Farms persist from actual buildings; a harvest cue requires an actual production event.

## A small original visual language

Parchment and restrained gold frame natural green/brown terrain and deep blue water. Civilization identity belongs on roofs, banners, borders and selection rings. Status also has an icon and word; color alone never carries meaning.

- A home is a compact plaster wall with a pitched identity-colored roof. Population thresholds add bounded household masses. These are aggregate silhouettes, not claims that individual residents are simulated.
- A farm is a brown field footprint with visible green parallel rows. It appears only when `City.buildings` contains `farm`. Its gold grain icon remains readable when detailed rows are too small.
- A workshop has a timber body, pitched warm roof and a distinct chimney. Close detail adds a small work yard. It appears only for an actual `workshop`.
- Current low wellbeing uses the heart mark and actual percentage; damage uses a warning mark and actual percentage. A past drought never leaves invented permanent crop failure.
- Resource and population marks use original 24-unit SVG paths, short familiar words and actual numbers. The same identities accompany inspection and local event cues.

## Show causes and consequences on the map

The current renderer source locates a committed event at its recorded tile, or its target civilization when no tile is recorded. A short local cue shows up to three icon/number deltas. The compact story retains the latest meaningful gameplay event while later clock entries remain in history. Full causes remain in history; an empty event list creates no invented change.

| Committed fact | Visual consequence | Truth boundary |
| --- | --- | --- |
| A building is completed | Its persistent silhouette appears; a short construction reveal | Seasonal capacity is labeled as a base rate, not received resources |
| Population grows | Household tier changes; person icon + actual increase | No independently moving resident is represented as a simulated agent |
| Drought occurs | Brief dry-wind/dust cue; food and wellbeing losses | Use recorded before/after numbers, including clamping; no lasting drought penalty |
| Production resolves | Local resource icons and actual produced amounts | No harvest before production; amounts can differ from base building rates |
| Research completes | Small discovery marker at the affected settlement | Do not claim unreleased capabilities are playable |
| Trade delivers | Shipment cue tied to the committed delivery | Pending, accepted-but-not-yet-delivered, blocked and stopped agreements never animate cargo |

Known effect formats are interpreted conservatively. Unknown text remains available in inspection and yields no guessed number. Before/after changes, signed changes, production, base seasonal rates and absolute totals remain distinct. No private model reasoning is presented.

New-event tracking suppresses all existing history on first load or a different run. Polling never replays a seen event. At most 96 recent records are considered and three meaningful new cues are returned, prioritizing importance; the presenter shows one focal cue below 700 CSS px and up to three on wider maps, with other facts available in history. This presentation budget does not slow agents or change their actions.

## Zoom reveals more detail

The owner explicitly requested zoom-dependent detail. Both current renderer implementations apply the shared decision to the projected tile diameter. SVG rebuilds its settlement parts only on a band change; Three replaces its active instance batches and retains shared solid geometry. No hidden high-detail alternative is preallocated.

| Distance band | Initial projected tile diameter | What remains readable |
| --- | --- | --- |
| Far | Below 24 CSS px | Natural terrain, distinct borders, compact settlement mass, selected city and major event, building presence marks |
| Middle | 24–48 CSS px | Individual house masses, farm rows, workshop silhouette, routes and genuine current activity |
| Close | Above 48 CSS px | More rows and yard parts, building/condition detail, bounded local VFX |

Transitions use asymmetric 22/26 and 44/52 px thresholds to avoid flicker. Preserve the selected city's name and target at every level. Prioritize selected/active-event labels, then capitals and meaningful changes. Avoid overlapping labels rather than shrinking them below readable size. Five civilization selection controls remain reachable even when labels are culled.

Initial per-city caps are 18/32/42 parts and 3/6/8 house masses. Particle budgets are 0/12/24 per focal cue. These are deliberate implementation caps, **not measured performance claims**. Sharing geometry/materials and instancing repeated parts should keep the cost tied to the small kit. Screen-space icons remain small fixed-size overlays; they must not inflate every city into a giant overlapping model.

Use a short local fade for changing detail where supported; reduced motion uses a direct stable change. Do not cross-fade the full world, shake the camera, flash rapidly, or change authoritative timing. If geometry blending is too expensive, hysteresis with an unobtrusive switch is preferable to doubling the whole scene.

## Asset reuse and packaging

1. Implemented in source: the same part descriptors feed SVG faces and Three instances through original unit box, gable and cylinder solids, a small shared palette, and the existing atlas projection/camera lifecycle.
2. Implemented in source: city parts are grouped into Three instances by solid and material. A band change disposes obsolete instance buffers but retains shared solid geometry; renderer teardown owns final geometry/material disposal. Terrain rendering is unchanged apart from normalized authoritative elevation and deeper water color. Runtime frame/memory measurement remains open.
3. Export a compact texture-free GLB of approved parts using the installed official exporter, with matching provenance and dimensions. Load it once and reuse meshes/materials. SVG companions continue to expose the same facts. GLB validation and a supported 3D screenshot are separate acceptance steps.
4. Add civic, industrial and space families only as their mechanics arrive. A fuller asset catalogue must not delay working farms, workshops or real deliveries.

## Proposed visual acceptance for the wiring task

- A real farm and workshop are visibly distinct at ordinary zoom in both available renderers; the empty-building state shows neither.
- A recorded population increase changes a settlement silhouette or an exact visible population mark at the appropriate detail level.
- A drought displays the actual loss locally, and its short presentation ends without leaving a fictional persistent condition.
- A construction base-rate label cannot be mistaken for an immediate harvest; no delivery animation appears for an offer, acceptance alone or blocked route.
- Zooming visibly reveals detail with stable selected labels and bounded scene/label counts. Reduced motion keeps all factual cues.
- Actual narrow and desktop pixels show the map, a selected city above its sheet, readable facts, reachable controls and no conflicting event overlays. Test 360/390/430 widths where available and disclose when only a 500 px cloud window is available.
- Inspect a real built state, an empty state and a new event. Run focused tests and record what they prove. Measure WebGL frame/memory behavior only on a browser that can actually run it.

The orchestrator owns `.bla` registration and acceptance. This document proposes observable outcomes; it does not add contract authority or mark a goal complete.


## Renderer checkpoint, 16 October 2026

`web/settlement-parts.ts` supplies the same unit solids for SVG face projection and Three triangle geometry. `web/settlement-three.ts` owns active instance batches and their lifetime. `web/world-cues.ts` owns bounded, expiring DOM cues and original icon-number rendering. `web/map-labels.ts` prioritizes the selected city, caps names and rejects overlapping labels. These helpers have direct consumers rather than a parallel unused asset framework.

The live adapter copies only actual city facts and normalizes integer elevation by 100. Drought never changes persistent farm colors. First load and run changes baseline existing events; only unseen committed records can animate. The latest meaningful story may remain statically visible without replaying its animation. Reduced motion keeps static facts and removes the entrance/dry-wind motion. Hidden-tab Three frames skip rendering. The existing illustrative sample remains explicit.

The independent-mode status uses `independentTurns.strategyTicks` as the actual economy beat and does not say one civilization must wait for the next. Legacy state retains its legacy round/next label. No timer or viewer action executes an agent command.

Current executable evidence: 20 web tests, strict TypeScript, scoped strict lint and web build passed before final manifest stamping. Tests cover committed city facts/elevation, outward shared solid triangles, active instance counts and reuse, selected-first label culling, meaningful-event choice and independent beat labels. The existing 13 semantic visual tests remain a separate focused check. The generated JavaScript bundle is about 640 kB (168 kB gzip), with the existing large-chunk warning still visible. This is not a measured frame-rate or memory claim.

Open acceptance: actual default/zoomed/inspection pixels with farm and workshop present, an empty settlement, one genuinely new event, and independent review. Cloud SVG evidence cannot establish WebGL rendering quality or physical touch performance. GLB packaging and richer content families remain later work.


## Viewer comfort increment, 16 October 2026

Before implementation, current [MDN color-scheme preferences](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-color-scheme) and [reduced-motion preferences](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) were inspected. Explicit Light/Dark choices must stay explicit; System follows device changes. Reduced motion overrides presentation intensity without hiding facts. [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) sets the 3:1 key control/graphic indicator target; [enhanced target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) informs the chosen44px controls. Small text targets4.5:1. These are scoped targets, not a whole-product accessibility certification.

The compatible v1 parser now accepts theme and effects, preserving existing camera/layer/selection fields and mapping old paused saves to Calm. A single appearance policy resolves device theme and reduced motion. Shared light/dark tokens style panels, controls, dialogs, resources and signed deltas. Natural terrain and civilization identity keep their original colors. Calm shows still facts, Rich adds brief event entrance/dry-wind motion, and Cinematic adds a bounded local event ring. No mode changes world speed, actor choices or the event record. The obsolete separate sample-motion control is replaced by the same effects setting.

Resource cells are keyboard/tap buttons opening a short guide. Their values remain actual civilization stocks; the guide distinguishes signed changes, gross production before costs, and base production capacity. Parsed Produced records now have a distinct production kind: chips say Food made and omit a net-gain plus sign, while the story says Produced · Before costs. No production result is recalculated in the viewer. Explanations were checked against current content/economy source, without duplicating balance values.

Actual live.5 cloud SVG pixels at500×761 showed fields/workshops and all five labels, close zoom19-part groups versus mid15 and far10, and selected Aster above its sheet by19.86px. Close restored the prior viewBox exactly. At a1188×761 desktop viewport, vertical camera buttons overlapped the inspection panel; this increment changes only that desktop control row to horizontal. Before screenshots are under `/tmp/civitas-qa/live5-*`. A genuine Aster growth-focus action advanced revision62→63 without a localized cue because that event is outside the cue vocabulary. No fabricated live animation was used. Actual new theme/control pixels and a supported new-event cue remain pending; SVG evidence does not prove WebGL or physical touch performance.


## Working settlements increment, 16 October 2026

Research before implementation reused the already verified [Three InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html), [LOD](https://threejs.org/docs/pages/LOD.html) and [resource cleanup](https://threejs.org/manual/pages/cleanup.html) documentation above. Current `core/types.ts`, `core/content.ts` and `core/simulation/operations.ts` were inspected as the authority for built structures, current enabled choices and completed operation receipts. No external models or packages were downloaded. The chosen approach extends the shared original solid kit and pure visual projection, rather than adding a separate asset or simulation pipeline.

A data-defined appearance catalogue now supplies farm, workshop, irrigation and kiln parts to both SVG and Three. Irrigation is a low stone cistern and channel, with a gate at close range. The kiln is a clay-colored cylinder with a dark opening, flue and close-range stack. Built structures remain present through pause and shortages. A complete high-population four-building settlement uses14/26/36 parts across far/middle/close, below the existing18/32/42 caps. The same active instance grouping and geometry cleanup remain in use.

The adapter deeply copies optional operation receipts. Inspection separates four facts: a building exists, its current On/Paused choice, its last recorded round/status, and the exact resources paid/made. A newly enabled building without a result says Ready for next season. Pausing after a successful result retains that result. Shortages explicitly name opening stock remaining at the recorded round, not today's stock. A funded zero-output operation still shows its actual payment and no output. No recipe balance is duplicated in the viewer.

A new building-operation event earns a brief local supplies-rise effect only when its recorded Produced amount is positive. Paid values use a distinct payment kind and a paid label; produced values keep made and never gain a misleading plus sign. Paused, blocked and zero-output operation cards are still, including in Cinematic mode. Initial history and repeated polling never replay work. This presentation reads events and never advances a season.

Map selection, selected-label priority and camera framing now use canonical city IDs. The civilization dock remains deduplicated; a settlement picker appears only for civilizations with several towns. Compatible saves retain the existing numeric civilization selection and add an optional city key. Missing towns fall back to an existing city of that civilization, then the first available city. The explicit sample uses synthetic sample keys. Existing temporary inspection framing and manual camera takeover are retained.

A synthetic visual fixture is saved as `/tmp/civitas-qa/working-settlements-kit.svg` and `.png`. Exact generated SVG face coordinates were rasterized with Pillow for silhouette inspection because the installed ImageMagick SVG delegate was unavailable. This is original kit evidence, not a browser screenshot, live state or WebGL validation. The source tests cover all detail budgets, persistent structures across operation states, separate current/past facts, exact cloned receipt values, positive-output-only work, canonical frontier-town selection and invalid-save fallback. Actual live.7 town interaction/receipt pixels remain a post-publication check; an unbuilt mechanic is not represented as live production.

The prior live.6 deployed pass observed automatic update, all theme/effect choices, stored preferences after a deliberate reload, resource keyboard/tap help and focus return. At501×761, selected Dawnwell cleared the sheet by25.53px; at1188×761, horizontal camera controls cleared the inspector by26px. The preserved cloud browser remains SVG-only, and unavailable360/390/430/physical-touch or real OS reduced-motion tests are not claimed. The central short-desktop story can still obscure lower town labels and remains a separate density/layout opportunity. Goal-wide history pagination and GLB packaging remain open; this task does not mark the whole spectator goal complete.

## Recoverable city damage increment, 16 October 2026

Research before implementation inspected current `City.damage`, `core/simulation/economy.ts`, the `repair-city` branch in `core/simulation/commands.ts`, the released earthquake definition, and the recovery tests. Damage is an aggregate0–100 productivity factor, not per-building destruction. Repair pays the canonical cost once and reduces the exact target city's damage with a zero clamp. It does not change buildings, infrastructure or population, and it produces no immediate supplies. The engine now emits the existing separate `Paid n resource` effects, so the viewer reuses one payment grammar. Current engine tests were read as semantics, not claimed as Art-executed evidence.

The approach reuses verified primary [Three InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html), [LOD](https://threejs.org/docs/pages/LOD.html), [cleanup](https://threejs.org/manual/pages/cleanup.html) and [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) findings from the existing kit research. No external asset or package was downloaded. One pure damage helper owns exact condition text and a three-part original crack badge. Its dark backing reuses the deep-blue palette material; it is a condition sign, not a simulated water structure. Every actually damaged settlement receives the sign in all detail bands. A complete four-building high-population settlement now uses17/29/39 parts when damaged, still below18/32/42. Healthy cities have no damage parts.

Both renderers show exact damage in the city label and accessible name. SVG keeps one screen-sized line and includes its full width in collision handling; Three replaces the existing secondary line with an icon and percentage rather than adding a taller label. Population and civilization remain available in inspection. The original building and house parts remain identical when damage changes. Inspection adds a short explanation of future production effects without presenting a human repair command.

A newly recorded `city-repaired` event earns an original tool icon and brief local repair cue. The existing before/after parser supplies the true damage delta:35→10 is−25 points, while10→0 is−10. Actual material and energy payments remain separately labelled Paid; no cost or simulation calculation is duplicated. The persistent mark follows current damage independently of historical event text. Initial load, repeat polling and run changes do not replay old repairs. Calm/reduced motion suppress the moving repair sign. Production cues still require a later real production receipt.

Focused cases cover zero, fractional and maximum damage, multiple affected cities, unchanged buildings/house count, all detail budgets, finite geometry, exact target anchoring, clamped repair quantities, explicit payments and no fictional output/replay. Shared text/indicator contrast targets and existing44px targets/12px map names remain checked. Runtime WebGL, physical touch and a real live repair remain unverified until supported evidence exists. This source increment does not activate recovery mechanics in the current world.

The deployed live.7 pass separately observed automatic update in preserved cloud tab6, actual Tidehaven and Willowmere canonical selection, real fields/workshop cards and keyboard focus. At501×761, Tidehaven cleared its sheet by25.53px; at1188×761, controls cleared inspection by26px. The current foundations world has no paid-recipe receipts or frontier towns, so those features retain source/fixture evidence only. The pre-existing short-desktop story overlap with lower labels remains an identified successor, separate from this damage change.

An offline synthetic damage fixture at `/tmp/civitas-qa/damage-kit-fixture.png` was generated from the exact shared face coordinates and palette with Pillow. It compares healthy,35%,10% and100% conditions at each detail band. It confirms the intended shared-part composition and stable built shapes, but is not a browser, real-world or WebGL screenshot.


## Civic specialization kit, 16 October 2026

Research before implementation reuses the verified official Civilization manuals, first-hand Firaxis art discussion, and primary [Three InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html), [LOD](https://threejs.org/docs/pages/LOD.html) and [cleanup](https://threejs.org/manual/pages/cleanup.html) sources in the earlier direction and kit. The bounded approach is recognizable core masses before optional decoration, shared existing solids/materials, and screen-size detail without changing the global budget. No new asset, package or rendering framework was downloaded.

Current canonical `core/content.ts` was re-read after the plan: House of learning now pays culture and credits for science, Fuel yard pays materials for energy, and Civic gathering place remains a no-input culture producer. These source facts supersede the earlier plan's description of pending definitions. The visual catalogue contains no recipe balance or simulation calculation. Familiar building names match canonical content, while exact Paid/Made figures still come from recorded receipts. City-level culture remains city-level; the gathering place gains no invented per-building operation or crowd.

Three original silhouettes extend the existing data-defined catalogue: a broad pale learning roof, a low stone gathering platform, and a compact dark fuel stack. Nearer views can add an entrance/tablet sign, civic post/benches, or open yard roof/bundle. Learning and gathering occupy the lower flanking slots beside the separate damage sign; fuel fits between the kiln and workshop. Their horizontal part bounds stay within 1.65 world units of the settlement center, including rotations. This is a schematic settlement glyph rather than territorial expansion. No idle smoke or light implies an operating receipt.

Allocation now reserves all house parts and actual condition parts, then every built family's declared core, before spending spare capacity on optional parts in stable rounds. Two farm parts preserve a planted field, two irrigation parts preserve water inside stone, and each other family has one identifying mass. The seven-family core uses nine parts. A fully built high-population damaged city consequently fits exactly 18/32/42 parts at far/middle/close, including all three damage pieces. Existing four-family combinations retain all parts because they fit. Adding damage to a crowded seven-family city may reduce optional ornament, never a core building or population count. Reordered, repeated or unknown building IDs do not displace known families. An impossible future core allocation fails explicitly rather than silently clipping structures; adding another family therefore requires a new budget decision and prospective tests.

The pure building-operation icon selection now uses the same catalogue identity. Learning and fuel receipts have their own original icons; an unknown family gets a neutral building icon. Exact Paid/Produced parsing, positive-output-only work, bounded cue windows, initial baselining and replay suppression are unchanged. Current enabled/paused/blocked choices do not alter any persistent built parts or imply production.

Focused regression cases cover all 128 subsets at each detail level, maximum population and damage, stable input-independent ordering, guaranteed core inclusion, round-robin spare allocation, unique finite geometry, compact bounds, unchanged inputs, canonical names, distinct silhouettes, and civic exact-receipt/no-output/replay behavior. The synthetic `/tmp/civitas-qa/civic-kit-fixture.png` uses exact shared SVG face coordinates rasterized with the already available Pillow library. Enlarged cells and map-size geometry samples show the seven-family composition and separate condition sign. It is explicitly not a browser screenshot, live civic state, full label/marker-composition test, physical-touch test or WebGL proof. Small-scale identification still relies on inspection names, and actual neighboring-city label composition remains a post-integration visual check. The current foundations world has no civic buildings or civic paid receipts; this source increment does not activate them.
