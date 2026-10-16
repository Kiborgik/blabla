# Capability tree sheet implementation

Actual Art Director: gpt-6-astra/xhigh. Scope is the new component, stylesheet, focused test and this report. Main integration, route files, manifests and public behavior remain outside this task.

## Approved design and research

Implements the first slice of [civilization-choice-ux.md](civilization-choice-ux.md): the entire canonical research/building graph, current Options now, selected-town facts and explicit refresh of a captured revision. Historical Chose → Changed joins remain a successor. This component consumes already projected data; it neither enumerates actions nor evaluates gameplay eligibility.

Reuses the verified Civ map/impact references and W3C dialog/disclosure guidance in the approved report. Read the current [MDN dialog documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog) on 2026-10-16: showModal gives native modal behavior, close and Escape provide dismissal, and an explicit close button supports pointer users. Initial programmatic focus goes to the heading. No new assets or dependencies.

## Bounded implementation plan

1. Write prospective assertions for all nodes/edges, multi-parent requirements, canonical status/blocker formatting, exact-town facts, truthful amounts and detached input. Run against an empty component stub to expose missing behavior at assertions.
2. Implement a pure presentation projection from canonical rows. Native disclosures expose all prerequisite/successor links. Options now means supplied current status, without historical causality.
3. Test and implement captured revisions, explicit refresh, unchanged-poll focus, run/context changes, town callback, Close/Escape and cleanup in one native modal controller.
4. Add scoped CSS with existing palette variables and 44-pixel targets. Keep named graph links readable at narrow widths; no production integration yet.
5. Run the declared focused tests, web typecheck and strict scoped lint; read the complete log, then hand back for independent review. Browser integration/pixels are a separately assigned successor.

## Review focus

Current research is Available with actual progress despite no duplicate action. Done belongs to the exact town. Missing rows stay visible as unavailable facts. New revisions cannot silently replace focused content. Planned structures and base production never become actual built or delivered results.

## Evidence

Implementation in progress. The initial write command used repository-prefixed paths from the example directory and failed before writing anything; that command is not test evidence. No new browser result is claimed.

## Delivered component and integration seam

- `CapabilityTreeInput` carries the run identity, civilization display name, owned town names, detached canonical catalogue and `CapabilityProjection`. `capabilityTreeNodes(input)` only formats those supplied facts; it does not call the engine, inspect legal menus or reproduce any eligibility predicate.
- All 17 current catalogue entries and 17 prerequisite edges survive. Topological groups are stable under catalogue reordering. Every parent is a native named navigation button, including both Fuel management requirements; the destination disclosure opens and receives focus. Additional future descriptors remain visible, with facts unavailable if their projection row is absent.
- Done / Available / Locked / Planned come directly from core rows. Researching uses actual progress. A building's current On/Paused choice is separate from Done. Planned has an explicit world-update notice and registered-release versus catalogue-only support label.
- Options now lists the current Available rows, including an explicit Researching marker for a project already underway. It does not claim a new unlock, a plan or command admission. Common action-timing information stays separate.
- Building facts distinguish construction cost, recurring inputs and base output before productivity. The component deliberately directs actual Paid/Made inspection to the existing town details. It does not invent production, shipment or completion effects.
- Canonical era blockers show required and current named eras. A world-achievement disclosure consumes core's achieved/eligible facts and catalogue descriptions; it does not calculate milestone progress. Pending achievement descriptions are prefixed “When reached”.
- Unknown or missing selected towns remain explicit. The only callback that changes context passes the exact town ID, after a native select change. The module performs no fetch, storage, history write, simulation mutation or action submission.

`createCapabilityTreeSheet(dialog, onTown, onClose?)` returns `open(input, opener?)`, `observe(input)`, `refresh()`, `close()` and `destroy()`. The future main integration should supply only accepted committed observations and import `capability-tree.css`, create one native dialog, and forward the exact selected town. It should use the cheap default core projection, which reports unavailable action references rather than generating a full trade menu. The caller retains camera/world authority and can coordinate its existing dialog route through `onClose`.

The sheet captures input on open. Equal-revision observations do not rebuild it. A newer same-context observation exposes Refresh while preserving content, open nodes, scroll and focus. Refresh swaps in cloned new facts; a focused summary is restored without scrolling, while activation of the disappearing Refresh control lands on the visible heading. Explicit town/civilization or run changes replace incompatible facts and focus the heading. Older revisions in the same run are rejected. The outer snapshot reader remains responsible for deciding which world identity is current.

Close and native cancel/Escape call the same dismissal path. Close restores an existing opener without scrolling. Disposal removes dialog listeners and retained nodes/data. The component relies on native modal focus containment, not a second custom keyboard trap.

## Visual scope and limits

The stylesheet reuses the existing parchment/gold and deep-blue palette variables. Node cards show status shape plus word, an original shared semantic icon, readable blocker text and always-reachable prerequisite links. Native disclosures hold longer facts and successor links. Wide topological groups collapse to one column below 700 CSS pixels. Buttons, summaries and the town selector have 44-pixel minimum heights, visible focus and normal wrapping. The tree is a deliberate reading surface; no new default-map overlay or geometry is added.

The graph's authoritative connections are its named prerequisite/successor buttons. This bounded first component does not add a measured SVG connector-routing system. It also does not implement historical Chose → Changed joins, recorded reason presentation, live publication or capability activation. Those limits preserve the assigned first slice rather than pretending current status proves past causality.

## Verification evidence and remaining acceptance

Prospective RED logs in `.blabla/scratch/render-capability-tree-sheet/` were read in full:

- `red-nodes.log`: five assertion failures for absent node/link presentation, canonical state/progress, blocker text, separate economic facts and future-node visibility against the empty stub.
- `red-controller.log`: four assertion failures for the missing native controller. The existing node assertions passed at that stage.
- `red-refresh-focus.log`: the newly added focus regression failed because refresh attempted to focus its hidden replacement button; the correction targets the visible heading instead.

The completed 11-test run, web TypeScript check and strict lint of this component/test passed before this report was finalized. The subsequent declared evidence run is the deciding receipt against this report and current source. The npm environment warning about `http-proxy` is unrelated to the component; strict lint emitted no source warnings.

Tests execute the actual formatter/controller against canonical projection fixtures and a small recording DOM. They establish emitted semantic structure, event callbacks, focus requests, capture/refresh decisions, stale-revision handling and cleanup. They do not prove native browser focus containment, actual layout/contrast, physical touch, scrolling geometry, performance or runtime WebGL. No new screenshot or browser success is claimed. The next assigned main/browser slice must check actual short-desktop and supported narrow pixels, linked-node navigation, exact-town context, both themes, Close/Escape, interrupted/repeated opening and new-facts refresh. Existing camera/settings evidence should be reused rather than rerun wholesale.

## Recurring commitment compatibility handoff, 2026-10-16 17:22 UTC

Creative Director, actual gpt-6-astra/xhigh acting under the recorded art-director transfer, inspected the new canonical projection and repaired finding 1. A legal seed/release/research/build prefix reproduced the real `active-commitment` rendering exception; `recurring-red.log` retains three failures against the unchanged component. The corrected formatter names the existing commitment from the catalogue rather than throwing.

The read-only sheet now consumes canonical Required/Active/Blocked research and selected-town construction lanes, current progress, available capability links and supplied reasons. It does not evaluate affordability or availability again. Retained last research and exact-town construction completions are displayed separately from the current decision. In-progress building cards show snapshotted work, actual paid amounts and order identity; they remain unfinished and cannot imply output. Options now explicitly marks an existing construction order. Older releases with no decision projection retain their prior presentation.

Three focused additions cover the genuine active-order prefix, native rendered required/active lanes, and explicitly synthetic zero-work/exhausted-pool/completion presentation. The first post-correction run exposed two test-label mistakes (the actual catalogue names are Terraced fields and Artisan quarter); those assertions were corrected to the existing canonical names. No gameplay rule or status changed to satisfy them. The final 14-case component run passes; the declared full focused receipt follows this report. Actual integrated desktop/narrow pixels and the released recurring cycle remain pending. The earlier 11-test receipt is historical evidence for the original schema.

The actual captured-real revision 228 desktop pass at 1188×761 opened the integrated sheet and followed Civic institutions to its focused disclosure. It exposed one comprehension issue: the raw admission code appeared in the timing sentence. The bounded presentation correction now explains a waiting world season or short actor wait in simple English while preserving canonical statuses. A focused assertion covers that wording. Final source receipt and narrow/recurring fixture pixels follow; no new game eligibility was introduced.

## Integrated pixel outcome, 17:35 UTC

The assigned implementer operated the actual cloud Chromium browser, with native window resizing to 504×761 and 1188×761. The public tab was preserved. Art's loopback host served the exact built source with a visible provenance label. `/after/` used the unchanged captured real revision 228; it did not mutate or impersonate the current online world. The three separately labeled recurring paths used legal offline engine journeys (registered releases, actual research/build commands and strategic beats), with no edited stocks, technologies or milestones. Those are prospective presentation evidence, not deployed recurring gameplay.

Actual captured-world inspection showed the selected civilization/town, Done/Available/Locked/Planned cards and named prerequisite links. Clicking Civic institutions opened and focused its matching disclosure. The simple-English timing correction was verified on the narrow view. Native Close/Escape returned focus to Research & buildings. At desktop size the modal measured 1020×729 and visible buttons had a minimum 44-pixel height. Narrow content wrapped and scrolled inside the sheet; document width remained 504. These measurements supplement the inspected pixels, rather than substitute for them.

The legal recurring fixtures showed Aster research Required with Water management/Kiln firing/Civic institutions links, then Active Civic institutions at 10.5/24 alongside exact-town Terraced fields at 1.3/4 work. The construction disclosure displayed the retained 8 Materials/4 Credits payment and construction-17 identity, with no built/output claim. Vesper's genuinely blocked construction lane exposed its canonical discovery/era/release requirements. The later legal snapshot showed both next choices Required while separately retaining completed Civic institutions and Terraced fields at round 7 / events 22:10 and 22:11. Both light and dark desktop views were inspected; the narrow light views included all these lane states and paid/completed details.

Images are under `/workspace/scratch/87f8257873e4/`: `capability-tree-1188.jpg` (initial timing copy), `capability-tree-504.jpg` (corrected copy), `capability-tree-linked-504.jpg`, `recurring-required-504.jpg`, `recurring-active-504.jpg`, `recurring-construction-detail-504.jpg`, `recurring-blocked-504.jpg`, `recurring-completed-504.jpg`, `recurring-completion-receipts-504.jpg`, `recurring-active-1188.jpg` and `recurring-active-dark-1188.jpg`. All are actual rendered screenshots. The recurring files are explicitly offline fixtures. No physical-touch, runtime WebGL, public deployment or actual live completion-to-next-model-choice claim follows. A changing-revision browser refresh was not re-proved in this static pass; the focused controller evidence remains its source-level boundary.

The final declared component check covers 15 tests (including the timing-copy regression), web types and strict scoped lint. Independent source/pixel acceptance and the actual applied-release agent cycle remain with the orchestrator's existing delivery obligations.
