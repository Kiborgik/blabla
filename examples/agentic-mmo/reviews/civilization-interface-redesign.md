# Civilization interface restructuring

## Result and boundary

The owner’s number/list complaint produced a structural presentation change: a compact six-resource rail with exact tap/keyboard inspection; Town, Work and Routes views for the selected town; one selected work record; a connected research/building graph with one selected detail; and six-card actor/category-filtered event pages. The map remains the default surface. This is original interface code, not copied artwork.

The deciding visual comparison uses the same legally generated local manufacturing world, revision 260 / round 204, with Dawnwell selected. Both bundles use the same terrain and world facts. The old accepted bundle remains under the local manufacturing-built path; the candidate uses layout-after. Local URL rewriting only directs public reads to the fixture JSON. Responsive selected-town framing still operates, so the map’s framing can respond to the changed panel geometry; these are matched world/window comparisons, not a new terrain-art comparison.

Public observation remains Blocked by the previously recorded unavailable security/permission service. It was not retried. No local frame is a live achievement, no physical touch or runtime WebGL is established, and no source check substitutes for the pictures.

## Reference application

Reused the previously inspected official Civilization V city-screen/manual hierarchy (page 21), Civilization VI manual tree/panel hierarchy (page 28), and the original palette/composition research retained in VISUAL_DIRECTION.md, VISUAL_KIT.md and the inhabited-landscape direction. Gameplay remains the project’s canonical rules; these references guide arrangement, hierarchy and progressive disclosure.

Fresh primary reading on 2026-10-16: the publisher’s [Civilization VII September 30 UI notes](https://support.civilization.com/hc/en-us/articles/44950826478483-Civilization-VII-Patch-Notes-September-30-2025) describe compact base/highest-adjacency information with optional full breakdowns, clearer building slots and net-change cues. Applied the compact overview/detail distinction; no VII rule was imported. [Rob Sugama’s first-hand Civilization VII UI work](https://www.robsugama.com/project/civilization-vii-zrlau) supplies authored icon, city-production, trade and resource hierarchy context. Its page was readable. The linked city-details AVIF on cdn.prod.website-files.com was denied by the site-safety policy, with no permission prompt attempted; that exact image was not inspected or retrieved by another route. No claim of a new successful screenshot comparison to that blocked image.

Existing verified WAI native-dialog/disclosure guidance and WCAG reflow/focus guidance remain applicable to Close/Escape, focus return, native selects, readable labels and bounded scrolling. The connected graph is an explicitly two-dimensional scroll region with an equivalent named finder and prerequisite buttons. These are applied design criteria, not a full conformance claim.

## Changed elements

- Resources: compact K/M overview, grouped precise values on an ordinary button, exact visible guide text and accessible name. Stocks have no gain sign. Changes and per-season rates retain distinct signs and units. Small nonzero values do not round to a false zero; invalid input is Unavailable. Values are presentation only, never written into the world.
- Town: population/condition, local support, research and strategic stock remain in Town. Work selects one exact building or worked site, preserving current pause, historic allocation, paid inputs and actual output. Routes shows only routes for that exact town. Other towns use a native named selector. Polling preserves the selected work and section, current focus and receipt disclosure.
- Tree: all 37 current canonical nodes and 46 prerequisite edges are represented. Compact nodes carry status/activity; the selected detail alone shows requirements, prices, potential output, exact site and recorded facts. Finder and prerequisite buttons reach distant branches without a hover dependency. Captured facts stay frozen until explicit Refresh. Current projects, completed history and milestones are native disclosures.
- Events: six cards per page; desktop two columns, narrow one. Native civilization and category filters apply to the retained selected window. Routine production is a filter rather than an initially expanded list. Technical IDs, causes and exact facts remain under Details. Paging announces and focuses its page status; Close/Escape returns to Events. A newer observation can expose an explicit Refresh notice without replacing the reading snapshot.
- About now describes existing released trade/construction/production truthfully. Settings describes best-effort storage rather than promising persistence when it fails. Narrow sample/return controls are available when relevant.

The event source still selects up to 24 records from the latest 96 retained events. Page controls do not fetch older chronicle history. Server’s unshipped cursor seam is a separately owned continuation. Historical exact-choice/reason/consequence joins also remain separate.

## Canonical wonder compatibility

The tree consumes the new wonder node/blockers and retained contender work/paid/site/order facts. Explicit completion owns the winner; losing work/refund receipts and actual boost receipts remain separate from a current eligible quote. A 100% contender does not establish a winner. This task does not wire the prototype landmark into either renderer and does not add a town-specific wonder card. No map-visible wonder claim is made.

## Actual local observations

Cloud Chrome SVG fallback, Dark theme, native window resize plus ordinary browser zoom:

- 1188 × 761 CSS pixels at 100%.
- 360 × 507 CSS pixels at 150%.
- 400 × 609 CSS pixels at 125%.

Before and after files are in /workspace/scratch/87f8257873e4/:

- layout-before-town-1188.jpg / layout-after-town-1188.jpg
- layout-before-tree-1188.jpg / layout-after-tree-1188.jpg
- layout-before-events-1188.jpg / layout-after-events-1188.jpg
- layout-before-town-360.jpg / layout-after-town-360.jpg
- layout-before-tree-360.jpg / layout-after-tree-360.jpg
- layout-before-events-360.jpg / layout-after-events-360.jpg
- layout-before-town-400.jpg / layout-after-town-400.jpg
- layout-before-tree-400.jpg / layout-after-tree-400.jpg
- layout-before-events-400.jpg / layout-after-events-400.jpg
- layout-after-work-360.jpg retains the first candidate’s clipped Work view. The correction is layout-work-first-glance-fixed-360.jpg and layout-work-first-glance-fixed-400.jpg. layout-after-exact-food-360.jpg shows exact-value inspection.

Observed: named Guild workshop selected through Work yields one card; the tree finder focuses the exact Guild workshop node and updates the selected detail; Fuel management exposes both Civic institutions and Kiln firing prerequisites. Escape from the tree restores the actual Research & buildings opener. Food 2.7K opens the exact 2,706.75 stock, and Escape restores that resource control. Event page 2 shows the seventh key event, actor/routine filtering exposes Aster’s actual Made/Used records, and Close returns to Events. Final page navigation focuses its readable count rather than a newly disabled button.

The small-screen town prioritization was adjusted during this verification after the first candidate placed the town picker before population; the final capture puts population first. This was a bounded two-line layout correction, not a claim that verification was pure observation throughout.

The independent reviewer identified that the first 360px Work view showed only its heading. Development resumed for a bounded correction: Work removes overview chrome, promotes current status plus the actual last Made/Used record, and keeps full site/allocation/history facts under Site & full record. Its focused sheet can be taller, while Town keeps the previous map-first height. Deliberate section changes reset scroll; polling retains it. The final 360 × 507 capture has scrollTop 0, the result block fully visible between y319 and y347, and Close, all section controls and the civilization dock visible. Guild workshop reads Built · On now, season 204, Made 10.8 Materials and Used 2 Energy without scrolling. Close restores the map and its civilization focus. The 400px correction likewise shows the complete compact result. This trades some map area while Work is open for first-glance comprehension; closing restores it.

The subsequent independent source review found that ordinary active buildings were missing from Work because the former active card required a district or district parent. The corrected generic building branch now consumes every canonical active building order, shows exact work and one-time paid facts, and adds site wording only for an actual district relationship. A legal Farm choice after the existing coastalDeparturePrefix produces revision 27, Aster 2, order construction-27, paid 8 Materials and 4 Credits, work 0 / 4. The new regression failed specifically on its absent Work entry before the repair, then passed with canonical validation and no state mutation. The actual local layout-ordinary-farm-active-360.jpg shows that exact town/order at 360 × 507, scrollTop 0, with Under construction and Not built yet visible. This is a separate legal offline case, not the manufacturing comparison or a public achievement.

## Evidence and remaining outcome

Prospective tests initially failed because the new formatter and graph/page APIs did not exist; this is an API RED, not a semantic old-implementation counterexample. Focused regression covers all canonical nodes/edges, no mutation, six-card paging and actor filtering, exact numeric semantics, single selected work and retained receipts, and explicit wonder completion. Existing focus/camera/resource/history tests remain part of the affected command. The minimal resident DOM harness was extended for real node movement/query/removal without weakening its receipt assertions.

Final declared check and its actual log are recorded in the task receipt after these observations. Existing build size warnings and the npm proxy-config warning are not silently removed.

Delivery remains Partial: the local restructuring is directly observed, while public-origin verification is Blocked. Full cursor history, the historical choice/consequence join, physical touch, assistive-technology runtime and WebGL remain unproved. Art owns the affected interface continuation; Server owns the cursor publication seam; the orchestrator owns publication and restoration of the supported public observation gate. The broader inhabited-landscape outcome is unchanged by these panel changes.
