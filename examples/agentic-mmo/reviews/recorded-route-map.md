# Recorded land paths: implementation and bounded visual evidence

Art Director, actual gpt-6-astra/xhigh. 16 October 2026. This packet changes the spectator projection and presentation only. Public manifests and the live foundations world are unchanged.

## Research and chosen approach

Reused the accepted, primary-source research in `reviews/quoted-route-map-direction.md`, verified immediately before this implementation. [Three Line](https://threejs.org/docs/pages/Line.html) and [LineMaterial](https://threejs.org/docs/pages/LineMaterial.html) support connected positions and screen-sized line widths. [SVG polyline](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/polyline) represents the ordered open chain; [non-scaling-stroke](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/vector-effect) preserves visible and hit stroke widths through zoom. The existing [W3C color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) and [44px target](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) research supports redundant status symbols/text and native route-list/Show town alternatives. This is bounded design evidence, not a complete accessibility audit.

Inspected canonical transport types, topology/passability helpers, immutable agreement terms, shared route identity and current adapters. The viewer calls no path planner and parses no reason prose. Full canonical tiles resolve retained coordinates before ocean filtering. A retained corridor says where an exchange was agreed; it does not establish constructed roads, border permission or cargo in transit.

## Implemented shared boundary

`visuals/route-paths.ts` returns detached schematic, land or unavailable geometry. The canonical shape/topology validators reject unsupported or incomplete quotes without substituting an endpoint chord. A valid corridor that now contains an impassable tile retains all positions and adds a separate current-passability reason. Its historical successful delivery, blocked attempt, immutable cadence and next due date are untouched.

Both adapters consume the same ordered `routeMapPositions`. SVG uses unfilled polylines for backing, color and hit area; Three uses a shared LineGeometry for backing/foreground. An arc-length midpoint supplies the existing bounded label placement. The selected path draws/hits first at overlapping lines while city targets retain priority. No smoothing, per-edge meshes, route animation or inferred traffic was added. Existing material/geometry cleanup and cue lifecycle remain intact.

Allocation remains selected-first, stable by route ID, at most 12 candidate links, at most 512 edges per line and 4,096 drawn edges total. A line is included whole or omitted whole. Its complete retained tile order remains inspectable in 32-ID pages. No LOD removes a path corner; the existing 5/8/12 shared label caps and city-detail budgets remain in charge. The optional close-view tile dots from the design were deliberately unnecessary for this smallest implementation; no new decoration budget is consumed.

The route card distinguishes current terrain, current damage, the last actual attempt/delivery, the stored interval and the retained next due round. Older agreements retain explicit schematic copy and their stored schedule. Stopped trade keeps its corridor inspectable on selection, its last delivery and interval, with no future-delivery claim. Unsupported/missing data keeps endpoint inspection reachable and explains unavailable geometry. Sends, Transport cost and Commerce received remain separate.

A native Recorded tiles disclosure preserves open state and page only for the same route plus agreement ID. Existing focus restoration recognizes its summary/pager keys and uses preventScroll. Show town still selects the canonical frontier city ID and focuses the civilization heading; no capital substitution or new camera policy was introduced.

## Prospective and regression evidence

Scratch logs are under `.blabla/scratch/render-recorded-land-paths/`.

- `prospective-red.log`: seven real assertion failures before the shared implementation, covering exact ordered geometry, full canonical ocean coordinates, old schematic compatibility, invalid quote safety, whole-path caps, no over-budget chord and complete paged inspection. The earlier verbose `initial-red.log` was superseded by this fully read, shorter run; no claim relies on truncated output.
- `adapter-red.log`: seven passing controls and one failing actual Three geometry assertion before adapter wiring, showing one segment where six were required.
- `inspection-red.log`: fifteen passing controls and one failing new card assertion before inspection wiring; the old card incorrectly described a retained land path as schematic.
- `projection-green.log`, `adapters-green.log`, `first-combined.log` and `extended-tests.log`: intermediate focused passes. Additional regressions compare every SVG/Three vertex, arc midpoint, exact frontier endpoint, malformed own transport values, immutable data, retained disclosure identity and full 514-ID paging.
- A final DOM regression checks native 70-ID disclosure pagination, stable control identity, boundary disablement and unchanged route data. This is an execution-level DOM stub test, not claimed browser keyboard evidence for a 70-tile route.
- `lint-first.log` identified a helper-hoisting preference and an unused test binding; both were repaired. `lint-green.log` passed. `type-first.log` passed web typechecking. The final declared task check is authoritative for the completed source: the three named test files, web typecheck, scoped strict lint and `npm run build:web` (the web bundle build). Its complete log is retained by the task evidence receipt.

Tests instantiate real Three line geometry, but this does not demonstrate runtime GPU rendering. Existing web/camera/settings and no-replay cue tests were retained, not weakened.

## Local browser fixture and observations

The dot cloud Chrome tab served a temporary scratch-only build at `http://127.0.0.1:4174/?scenario=controlled`. Its title, yellow fixed label and local version `0.0.0-local-path` explicitly identify SYNTHETIC LOCAL PATH QA. The fixture contains canonical-validator-accepted seeded snapshots, not live actor actions or engine-generated delivery proof. Its quote was obtained using the canonical planner in fixture construction only; production projection never invokes that planner.

The fixture corridor is Far Hearth (`frontier-qa`) to Tidehaven (`city-3`), ordered tiles 39 through 49, then 67, 85, 103, 121, 139, 157: 17 vertices, 16 edges. It has a recorded round-17 delivery, an eight-round stored interval and next due round 25. Successive fixture revisions first replace retained tile 45 with ocean, then stop the agreement. The stopped snapshot returns to the baseline terrain; this tests independent presentation branches, not a simulated terrain-repair narrative.

Actual native-window CSS sizes were 1188×761 and 504×761. Evidence is SVG mouse/keyboard rendering. No device emulation, physical touch, 360/390/430 viewport, WebGL or frame-rate claim is made.

Observed:

1. The land route contains 17 points in each SVG backing/color/hit polyline; the old schematic link contains two. The same 17 points remain at actual far, mid and close detail. Desktop minimum zoom remained mid; far was observed at the narrow minimum zoom after closing inspection. The file named `route-path-far-1188.jpg` is therefore a mid-detail exploratory capture and is not far evidence.
2. Keyboard Enter on the SVG route opens its card. The selected exact Far Hearth remains above the narrow inspection sheet. The full corridor is not forcibly fitted into that small remaining map area; offscreen portions remain accessible by camera controls and complete tile inspection.
3. Enter on Show Far Hearth selects Far Hearth, retains its settlement facts and focuses the Aster H2, as the existing interaction contract specifies.
4. Enter expands Recorded tiles. On the successive ocean-tile snapshot, the expanded summary retained keyboard focus and all 17 IDs. Current terrain says tile 45 is impassable, while the last actual delivery remains round 17 and next due remains 25. A click on that warning scrolled it into view with readable surrounding facts.
5. The stopped route is available through its native list row and still draws the retained cornered corridor when selected. The card preserves the last round-17 delivery and eight-round interval, and says no future deliveries while stopped. The old blocked schematic route still says no terrain path is recorded and retains its four-round interval and past blocked attempt.
6. Escape leaves route inspection through the existing close behavior. Zoom controls remain reachable. Dark and Light both show readable status, endpoints and the selected-town mark. Settings returned focus to its opener. Existing Calm was retained; no moving path feature exists. An attempted DOM animation-list read was unsupported by the browser's read-only scope and supplies no animation-count evidence.

Retained images in `/workspace/scratch/87f8257873e4/`:

- `route-path-overview-504.jpg`: initial land corridor overview.
- `route-path-selected-504.jpg`: selected exact frontier town above the sheet.
- `route-path-tiles-504.jpg`: focused expanded 17-ID disclosure.
- `route-path-blocked-504.jpg`: current impassability versus prior delivery and next due.
- `route-path-selected-1188.jpg`: desktop selected corridor, visible bend, readable card and town labels.
- `route-path-blocked-1188.jpg`: desktop warning, unchanged retained geometry.
- `route-path-frontier-1188.jpg`: Show town result.
- `route-path-stopped-1188.jpg`: stopped retained route on desktop.
- `route-path-stopped-far-504.jpg`: actual far-detail retained route and selected-town priority.
- `route-path-schematic-504.jpg`: old schematic compatibility.
- `route-path-light-504.jpg`: Light theme, far detail and readable stopped-route inspection.

I viewed the principal selected, warning, expanded disclosure, stopped/far, schematic and Light captures. These are author observations awaiting independent review. The local fixture was never injected into the public world.

## Remaining evidence boundary

The source and observed SVG cases support a bounded route-map increment. Dense 4,096-edge allocation is tested semantically, not benchmarked on a phone. Runtime Three terrain-height appearance and physical touch remain unverified. The existing label solver may omit a crowded label; the route list/card remains the accessible alternative. Complete routes can extend offscreen when exact-town framing is active. No new live route exists merely because this viewer can display one.

The useful next step is independent source/pixel review and the orchestrator's canonical contract binding. A broader road, shipping or asset system is neither needed nor proposed by this packet.
