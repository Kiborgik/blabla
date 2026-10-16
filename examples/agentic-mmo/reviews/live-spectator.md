# Independent review: connected spectator

## Current result

The connected viewer and earlier automatic deployment update are verified in the public browser. Live.2 at an actual 500 × 757 CSS viewport repairs hidden events, unreadable labels and cramped resources. **Mobile presentation is still not accepted:** opening details obscures every city behind the sheet, leaving empty ocean above it. The repair is tracked as finding 2; production changes need independent review after this reviewer takes the author role. Source checks and absence of overflow do not establish usability.

Task: `review-live-spectator`, reviewing `connect-live-spectator`. Actual reviewer model: `gpt-6-astra`. Date: 2026-10-16 UTC. Production source was not edited by this reviewer.

## Source and focused verification

Independently ran the exact declared command, `npm run verify:scaffold`, from the nested project with the configured toolchain. Overall exit **0**; all child output was read:

- Web strict TypeScript: exit 0.
- Scoped strict lint: exit 0.
- Web tests: **11 passed, 0 failed, 0 skipped**, exit 0.
- Production web build: exit 0. The approximately 609 kB minified bundle produces a size warning, not a failed build or evidence of a functional defect.

Read all changed web, manifest/history and web-test code, plus the shared world validator and the relevant server/read envelope. The focused check is not the full backend/product gate.

### Data and authority

- `web/live-world.ts:16-26` requires an authoritative successful envelope and validates both current and initial states through the existing shared `isWorldState`. Malformed input remains offline. `acceptsSnapshot` prevents same-run revision rollback; the identity uses the persisted initial seed and clock epoch.
- `projectWorld` uses actual civilization/city/tile IDs, ownership, terrain, population and buildings. Active route endpoints resolve by city ID, including multiple cities per civilization; it introduces no preview routes. The tests assert input state remains unchanged.
- Civilization colors are restricted to literal hex values; text inserted into HTML is escaped. DOM-created labels use `textContent`.
- `web/main.ts` makes only the public world GET and deployment-manifest GET. Human controls affect camera, selection, layers, dialogs and local preferences. There are no action, initialization, clock or Director write controls.
- Connected, last-known/offline, uninitialized and deliberately selected sample states are visibly distinct. A connected view makes no claim of continuous model activity. Sample mode uses its own illustrative map and decorative routes; it cannot mutate the shared state.

### Update and rendering lifecycle

- World reads are serialized, timed out and polled every five seconds. Last-known verified data is retained on failure. Deployment polling remains separate, with newer timestamps and session attempt tracking to prevent repeated reload loops while preserving compatible viewer preferences.
- Map replacement snapshots the camera, disposes the old renderer and recreates from the current projection. Three.js cleanup cancels animation, disconnects resize observation, disposes controls/geometries/materials/renderer and removes old canvas/labels. The SVG fallback disconnects its observer and removes its DOM on replacement.
- The fallback is an actual original 2D representation of the same map, cities and routes, with keyboard-selectable city markers, pan and zoom controls. It does not relabel an empty text-only view as a rendered map.
- Two small issues found during the source pass were repaired before final verification: unchanged civilization rows are no longer recreated on each poll, and an `#events` deep link/reload gets history after the first verified snapshot instead of remaining empty.
- Recent events are a bounded 24-entry captured window while the dialog is open, avoiding scroll movement on polling. Reopening refreshes it. Older changelog groups are collapsed. This is not an archive browser or large-list virtualization implementation.

## Public browser evidence before deployment

Browser: this task's cloud Chromium, not the user's device. The existing public URL opened without authentication. At 08:24 UTC the UI still showed `v0.1.0-preview.2`, explicit sample wording and the previous no-WebGL text fallback. Cobalt Assembly/Kova remained selected at a 1180 × 757 CSS viewport. This tab is retained to observe the next automatic update without manually refreshing it.

A separate read-only public `/api/world` navigation at 08:25 UTC returned authoritative revision **5**, round **0**, year **-10000**, next phase **5** (World Director), release `settlement-foundations-1`. The five cities were Dawnwell, Willowmere, Cinderhold, Tidehaven and Lumen, each population 6; the latest event was Vesper beginning agriculture research. These are real backend facts available for comparison, not proof that the still-old frontend displays them.

## Public live.1 browser evidence

On 2026-10-16 at 08:33 UTC the retained cloud Chromium tab had automatically changed from `preview.2` to `v0.1.0-live.1`, without a manual reload. It showed CONNECTED WORLD, seed 1701, revision 10, round 1 and 9,970 BCE, with the actual Aster, Verdant, Ember, Pelagos and Vesper civilizations. The same selected civilization ID remained selected as Ember; that ID represented Cobalt in the old sample, so preserving the sample name was not expected. The source check above covers the preference/reload guard; the observed change proves an actual deployment update, not a synthetic version comparison.

The real SVG fallback displayed terrain and selectable cities. Ember inspection showed Cinderhold population 7, 66% wellbeing, industry focus, Cultivation progress 1.26 and actual resource balances. The Recent events dialog exposed 21 committed records, including the three clock advances, production/growth and agent choices. It explained their causes and effects. At 08:40 UTC ordinary polling also displayed revision 11 and release `settlement-foundations-2` without a page reload. These observations do not establish continuous unattended agent activity.

### Actual narrow failures and bounded repair

The ordinary browser window was narrowed to **500 CSS px**; the content/client width was 485 px with no horizontal overflow. This was responsive desktop testing, not a touch-device emulation. The full-page screenshot is a genuine narrow capture, not a crop of a desktop image.

The following line references describe the inspected **live.1 source before the repair**; the successor removes that old mobile cascade.

1. **Hidden history:** the latest-event panel becomes an empty oval and its Recent events control disappears. `web/styles.css:1081-1099` retains a 43 px circular panel and hides `.chronicle > div`; the live override at 1333 restores only its outer display. Restore the actual content, shape and usable height in the live mobile layout.
2. **Cramped inspection:** `web/styles.css:1031` retains `height: 111px`; the live overrides at 1322/1330 do not reset height. Resources, research and city facts require a tiny nested scroll viewport. Give inspection a deliberate mobile layout with accessible opening/closing and adequate readable space.
3. **Unreadable map labels:** `web/flat-renderer.ts:49-54,67-70` scales 0.55-unit names with the whole world. Actual DOM geometry measured city-name boxes only **6 CSS px high**, with selectable groups about 23.6 px tall and 16.7–27.8 px wide. Use screen-space readable labels and adequate targets, with a narrow-map composition that keeps inspection accessible.
4. **Desktop status overlap:** the 2D badge at `web/styles.css:1294` overlaps the connection/status line. Its placement must accommodate wrapped heading text.

The screenshots and actual CSS cascade are the proportional research for this repair. The chosen direction is a map-first mobile composition, clearly reachable civilization inspection and event history, and readable screen-size city targets. The owner independently reported the mobile interface as broken; this outweighs the earlier source-only approval. The author owns the repair; no production code was changed by the reviewer.

## Live.2 source candidate and visual handoff

At 08:45 UTC independently reviewed the Astra author's `live.2` candidate: the old 760/380 px mobile cascade is removed; the map fills the available viewport; a compact civilization dock opens a deliberately sized scrolling inspection sheet; Close/Escape handling returns to the map; the event strip and Recent events control are restored; the 2D badge is moved; and SVG city metrics have screen-size minimums. The new metric test checks 12 px label text and 44 px hit diameter across representative scales. Inspection preserves same-civilization scroll and avoids replacing unchanged content on each poll.

Independently reran `npm run verify:scaffold` from the nested project: **12 web tests passed, no failures or skips**, strict TypeScript and scoped lint exited **0**, and the production web build exited **0**. The bundle-size warning remains nonblocking. An initial accidental invocation from the repository root failed because that directory has no `package.json`; it was not a source/test failure and was corrected by running the declared command from its proper project root.

These checks support the source repair only. **No deployed live.2 mobile pixels or interactions have been verified by this reviewer. Finding 1 remains open.** The succeeding Art Director must verify the automatic update in the retained tab, actual narrow and desktop composition, city/dock selection, readable resources/research, sheet scrolling and Close/Escape, event history, and footer links. In particular, check whether the selected city remains recognizable above an open sheet; selection currently highlights without recentering. Do not resolve the usability finding from test results alone.

## Remaining verification and limits

- Recheck the actual mobile repair and its deployed update when ready. Current finding 1 remains unresolved until the repair is verified or explicitly dispositioned by the orchestrator.
- WebGL is disabled in this cloud browser and earlier device-emulation attempts were blocked by browser policy. Those controls will not be bypassed. A responsive desktop window does not establish touch-device or WebGL behavior.
- A read-only geometry observation initially lacked tool approval; the exact retry after supplied owner authorization succeeded. No denied device-emulation route was retried or bypassed.
- No full-history game, continuous online-agent loop, complete tactical/strategic systems, theme/effects settings or exact six-minute hosting trigger is certified by this bounded review.

## Independent live.2 deployed pixel review, 08:49–08:52 UTC

Actual cloud Chromium viewport: **500 × 757 CSS px**, verified through read-only DOM geometry and real screenshots. Ordinary window resizing did not produce a smaller width; 360/390/430 px and physical touch are **unverified**. Existing tab 4 was absent from the inventory, so a fresh tab 6 was opened. The visible footer says `v0.1.0-live.2`; this pass makes no claim about the live.1-to-live.2 automatic reload. WebGL remains unavailable.

Verified visually and interactively:

- Five labeled cities and all five civilization dock buttons are visible together in the default map-first view. City SVG targets measure 44 × 44 CSS px; camera/layer/history targets have a 44 px minimum dimension, and civilization targets are about 95.6 × 64 px. Labels are genuinely readable compared with the former 6 px text. About is 34 px wide and footer controls are 38 px tall; these secondary controls do not meet the 44 px comfort target.
- Clicking Cinderhold opens Ember resources, research and actual city facts in a large scrollable sheet. Dock selection changes it to Aster and displays the completed-research state honestly. Close and Escape both dismiss the mobile sheet and restore the selected dock focus.
- Recent events opens a readable full-height dialog with 24 committed entries, including Aster/Pelagos discovering Cultivation. Escape closes it and returns focus to Recent events. Version, Changelog and Built with BlaBla remain unobstructed in the mobile footer.
- Enlarging the ordinary browser window shows the desktop map, civilization column, readable resource panel and event card. The event card covers parts of the lower map, so this is not a claim that every city remains unobstructed at all desktop sizes.

**Finding 2:** The open mobile inspection sheet starts at y232 and ends at y641, while all land and cities occupy y270–510. The selected Cinderhold and every other city are concealed, leaving only empty water above. Selected-city focus must frame the city in the remaining upper map without shrinking its label. Closing should restore the prior overview unless the viewer deliberately panned/zoomed. The same projection/camera behavior should support both renderers. Screenshot: `live2-500-inspection.png` in the review execution artifacts.

Exact `npm run verify:scaffold` independently rerun before author edits: exit 0, 12 tests, strict TypeScript/lint/build all pass. No production source was changed during this independent pass. The author now takes the bounded connect-live-spectator task for finding 2; an independent reviewer must review that change.
