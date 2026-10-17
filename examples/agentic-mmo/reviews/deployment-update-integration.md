# Bounded viewer updates and route-cue browser integration

## Scope and research

This packet wires the reviewed deployment policy into the spectator through a small injected browser controller. It changes no public manifest, engine state, world command boundary, or accepted pure policy. The existing route-cue projector and renderer are exercised as accepted dependencies.

Before implementation I reused the accepted policy research and inspected the current application. Primary references: [MDN sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage), [MDN Storage.setItem](https://developer.mozilla.org/en-US/docs/Web/API/Storage/setItem), [MDN Location.reload](https://developer.mozilla.org/en-US/docs/Web/API/Location/reload), [WHATWG Web Storage](https://html.spec.whatwg.org/multipage/webstorage.html), and the current [MDN History.replaceState](https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState). Storage access/writes can fail; replaceState can fail for security or cloning reasons; a same-origin replaceState changes the URL without loading it. Chromium has no supported reload(true) cache-bypass promise. The marker changes the reload URL, but cannot guarantee every intermediary cache's behavior.

The missed public live.9 to live.10 transition remains undiagnosed. The earlier storage read was inside the browser tool's restricted evaluation scope and did not establish the application's real storage availability. This implementation addresses demonstrated source failure paths, not an inferred cause of that public observation.

## Implemented behavior

- One manifest read in flight. A navigation decision is consumed in memory before browser navigation, including a throwing navigation call. Repeated polling cannot repeat that document's automatic navigation.
- The accepted helper retains its two-attempt, source/target-bound budget and 30-second cooldown. Stale HTML gets one cooled retry. Exhaustion is a readable status with a keyboard-operable Update view button. A navigation that never unloads also becomes manual after the cooldown.
- The update notice participates in the existing panel exclusion rectangles for route-result card placement.
- Session storage read/write failures cannot prevent a marker-bearing update. Compatible preferences are sanitized and carried separately from the URL.
- A temporary, versioned history envelope retains the complete prior unknown history value, including primitive and array values. Startup restores it. This preserves the prior value rather than replacing it with null. Closing a viewer dialog now also preserves the current history value.
- Working history carries settings through reload even if both storage getters throw. If history cannot be saved, working preference storage permits same-origin location replacement. If both paths fail, automatic navigation waits for an explicit Update view action and warns that settings may reset.
- Successful target startup removes only its retry marker and restores prior history without another reload. Other URL parameters and the open-dialog hash remain intact.
- Pagehide disposes the controller; a persisted pageshow mounts a fresh controller. An already pending response cannot navigate after disposal.
- The updater only reads the public manifest. No simulation or world-authority data is serialized in its marker or preference carry.

## Prospective checks

The new controller tests were written before implementation. A minimal scaffold produced nine assertion failures and two passing negative controls; the retained initial-red.log contains the complete run. Eleven controller tests then passed, including actual throwing storage/history/navigation ports, single-flight overlap, stale-first response, automatic exhaustion, explicit manual recovery, unknown-history restoration and current-camera capture. Scoped strict lint and web typecheck passed.

## Browser method and limits

The dot cloud Chromium browser runs actual locally built old/new application bundles. The server and fixtures live in scratch, outside production. A persistent yellow label identifies SYNTHETIC LOCAL QA. Fixture bootstrap code deliberately makes both storage getters throw and displays a harmless synthetic unknown-history object. A local Publish button changes only this temporary server's manifest. The first marker-bearing HTML response deliberately remains old; a later response serves the new bundle. No public-world fixture injection or live command occurs.

Route fixtures are separate successive validated snapshots of the same synthetic world identity. They contain an exact frontier town, agreed/blocked/stopped links, recorded delivery and clamped public-repair facts. Each snapshot passes the canonical world validator. They test presentation of receipts, not engine generation of those receipts.

This pass observed actual 1188 × 761 and 504 × 761 CSS pixels, using native window resizing. Prior passes reached 501 pixels; this pass does not substitute that older size for its actual 504-pixel evidence. Device emulation and WebGL are unavailable in this environment; evidence is SVG, mouse/keyboard and native-window pixels. It cannot certify physical touch, 360/390/430 layouts, GPU rendering or production CDN behavior.

Only the observations below are counted as browser evidence. Browser exhaustion, all-persistence-failed navigation, BFCache return and physical reduced-motion settings remain covered by controller/source tests rather than claimed runtime interactions.

## Observed local update result

At 1188 × 761 CSS pixels, the controlled transition used the local old bundle, served old HTML once after the first automatic reload, then loaded the distinct new bundle on the second automatic attempt. No manual reload or Update view click occurred within this controlled sequence. The first observed marker retained count 1 and the readable cooldown notice; the new bundle removed the marker, preserved `scenario=controlled`, and hid the notice. The fixture's old/new HTML counters changed from 3/0 to 4/0 to 4/1. Earlier setup loads are excluded from this controlled sequence.

Dark, Calm, exact Far Hearth selection and SVG viewBox `-23.6969696969697 -13.333333333333334 47.3939393939394 26.666666666666668` survived both attempts despite the deliberately throwing localStorage and sessionStorage getters. The displayed synthetic unknown-history value `{fixtureUnknown:{preserve:'yes',list:[1,2,3]}}` also survived. Retained screenshots in `/workspace/scratch/87f8257873e4/`: `update-local-old-selected.jpg`, `update-local-stale-first.jpg`, `update-local-new-preserved.jpg`.

## Observed route results so far

- Revision 90 → 91 in Calm showed one `7 cargo delivered / Round 12` card and paired stationary cargo icons at exact Far Hearth and Tidehaven positions. No first-load cue appeared. The icon shape is an original semantic delivery symbol; it never travels along the schematic link.
- Recent events exposed both directions separately: Aster sent 4 Food, Pelagos sent 3 Materials, each paid 1 Energy and received 2 Credits. The exact route and agreement IDs were present. Escape returned to the map without a replay.
- Revision 91 → 92 in Rich showed `Repaired 12 points / Round 12` and two stationary tool marks. DOM inspection confirmed the marks' city IDs `frontier-qa` and `city-3`, both visible. The 180 × 44 card occupied clear map space beside the central label, outside the inspector. Rich's entrance is opacity-only on its inner card; the outer card and endpoint marks have no animation.
- Repair history showed the recorded 12% → 0% reduction, damage when observed 0%, Pelagos paid 5 Materials plus 2 Credits, and Aster paid 7 Materials. It explicitly says the repair result does not create a shipment.

Retained images: `route-cue-calm-delivery-1188.jpg`, `route-cue-delivery-facts.jpg`, `route-cue-rich-repair-1188.jpg`, `route-cue-repair-facts.jpg` in the same scratch directory.


## Narrow and quiet-history results

At 504 × 761, opening Far Hearth kept that exact town visible above the sheet. On revision 95, the DOM contained one result card but marked it hidden because no unobstructed 180 × 44 placement fit; the Far Hearth mark was visible and the off-screen Tidehaven mark hidden. This is deliberate omission under the shared screen-space budget, not an assertion that the narrow result card was visible. `route-cue-narrow-active-504.jpg` shows the actual case.

After Close, the story summary and Recent events control were reachable. Enter opened history and Escape closed it. The history control measured 75 × 44 CSS pixels. On a further validated observation at revision 96, with the sheet closed, one 180 × 44 delivery card and both exact-town marks were visible. The card occupied x314.375–494.375, y362.875–406.875, within the 504-pixel viewport and outside the story strip, labels and camera controls. Its inner-card computed animation was `none` in Calm. Images: `route-cue-narrow-closed-504.jpg` and `route-cue-calm-visible-504.jpg`.

While history was open, the temporary server response file advanced from revision 92 to 93. The world observation advanced, but the open list remained frozen on the recorded repair and there were zero cue cards/marks. Escape and the next live baseline stayed quiet. Later new observations remained eligible. Cleanup also left zero cards and marks after their real 2.6-second lifetime. No animation duration was extended for screenshots.

The yellow test harness is intentionally visible and covers part of the footer/dock label area. It is not shipped UI and is not used to claim a new general footer/civilization-dock acceptance. Existing accepted mobile/camera/settings evidence stands. The narrowed view uses SVG and mouse/keyboard, not a phone emulator or hardware touch.

## Evidence and remaining boundary

The source packet now targets the orchestrator's stable live.11 manifest; the browser bundles are separately labelled scratch builds `synthetic-local-old` and `synthetic-local-new`. The only post-capture presentation change adds the update notice to the existing panel collision-exclusion class; the accepted cue implementation is unchanged. The full local fixture assets, server and input JSON remain under `/workspace/scratch/87f8257873e4/viewer-update-fixture/`; source preparation and build logs remain under `/tmp/civitas-update-qa/`. No new package was installed.

The declared combined test command covers the 14 pure policy cases, 11 integration cases, 31 existing web cases and 10 cue rendering cases. The final exact log, scoped lint and web typecheck are retained in `.blabla/scratch/integrate-bounded-viewer-updates/` and handed back with this report. A successful local transition cannot establish the cause of the prior public missed update or certify the public CDN. The useful next check is the actual preserved public-tab transition after independent review and publication, with a fresh timestamp and precise observed build.
