# Route inspection: actual synthetic browser check

2026-10-16, 13:45–13:56 UTC. Author: Art Director, actual gpt-6-astra / xhigh. These are author interactions and observations; the correction still needs independent acceptance.

## Result

The actual cloud browser rendered the accepted route implementation in a labelled local fixture. Agreed-before-first-delivery, previously blocked, stopped, exact frontier selection, scrolling, keyboard activation, Close/Escape and unchanged-poll focus behaved as described below. One real selected-route label collision was found and corrected within the reaccepted implementation task. The corrected desktop label is clickable and does not intersect any town target. At the supported narrow size, it is omitted when no clean location fits, while the exact selected frontier remains above the sheet.

This establishes only the observed SVG cases. It does not establish a live trade event, physical touch, WebGL execution, phone hardware performance, or a 360/390/430 CSS-pixel viewport.

## Environment and reproducible fixture

- Dot cloud Chromium, public tab 6 preserved separately. Production was neither reloaded for this check nor given fixture data.
- Local fixture: `http://127.0.0.1:4173/`, tab 9. A persistent banner reads **SYNTHETIC LOCAL QA · no live actions**. It serves the actual built viewer assets, with a canonical-validator-accepted synthetic envelope at `/api/world`.
- Shared fixture generator: `/tmp/civitas-route-browser/create-fixture.ts`. Native cloud server and files: `/workspace/scratch/87f8257873e4/route-browser-fixture/`. Python's existing standard HTTP server binds only loopback; no installs or network settings changed.
- The CUA Node server was in a different loopback context and initially gave Chrome a refused connection. Native desktop UI confirmed the transferred files and started the local server. Rebinding the old error tab was rejected because its generated error-page protocol was unsupported. That tab was left alone. The parent confirmed the already authorized fresh HTTP target, which opened normally. No restriction was bypassed.
- Actual CSS viewports: **1188 × 761** and **501 × 761**, obtained by resizing the cloud window. Most desktop screenshots are returned as **1173 × 751 JPEG** images; narrow captures are **501 × 761 JPEG**. The `.png` scratch filenames retain the tool output bytes, which are JPEG. The separate desktop missing-endpoint capture is 1188 × 761.
- Actual renderer: **2D SVG fallback**. Three's line construction and placement remain source/test evidence, not runtime WebGL evidence.
- Initial production bundle: `index-X3sUAzzM.js`. Corrected bundle observed in the DOM: `index-DFsGLzDq.js`. No manifest/version change belongs to this task; the local footer therefore retains live.9, with the synthetic banner and release identity distinguishing the fixture.

Three synthetic routes use exact canonical town IDs and cloned accepted terms: Food 4 in one direction, Materials 3 in the other, Energy 1 transport cost each, Credits 2 commerce each, cadence four rounds and damage threshold 50%. They are:

1. `qa-first`: Far Hearth (`frontier-qa`, Aster's second town) ↔ Tidehaven (`city-3`), agreed round 9, first due 12, no attempt/delivery, inactive volume zero.
2. `qa-blocked`: Willowmere ↔ Cinderhold, agreed round 2, last attempt blocked in round 8 by route damage, **current damage zero**, no recorded delivery.
3. `qa-stopped`: Tidehaven ↔ Lumen, stopped round 9, two actual fixture deliveries retained, last delivered round 8.

The defensive missing-endpoint case is a separate labelled component fixture at `/missing.html`, tab 10. Canonical full-world validation does not admit dangling route endpoints, so this fixture deliberately supplies nullable projected endpoints directly to the production card and SVG adapter. It does not claim to exercise the full application's polling, selection or Escape flow.

## Observed interactions and facts

### Desktop

- The default map showed the agreed and blocked links as static schematic lines. The stopped route was available in the native route list and appeared on the map only while selected.
- Clicking the native first-route row opened **Far Hearth ↔ Tidehaven**, with exact civilization/town IDs, “Agreed · first delivery pending,” no recorded attempt or delivery, and first due round 12.
- A real desktop click on a clear line segment at screen coordinates 520,499 opened the same route. Enter on the SVG blocked-route target opened its card. Space also activated a route in the narrow view.
- The blocked card separately showed “Damage now: 0%” and the round-8 blocked attempt, plus the explicit warning that supplies or damage may have changed since that attempt. No current blockage or new delivery was inferred from the past receipt.
- The stopped card retained “Last delivered round 8 · 2 completed deliveries” and “No future deliveries while stopped.” The card's Agreed terms remained explicitly labelled as amounts per successful delivery, not new gains.
- PageDown within the inspector exposed current state, recorded facts and exact cargo/cost/commerce groups. Native route rows remained reachable below the long card.
- Escape from the stopped card removed its map link and restored focus to the stopped native list row. No route card remained.
- Enter on **Show Far Hearth** selected `frontier-qa`, not Dawnwell. The town picker, selected map target and settlement heading all reported Far Hearth. Focus moved to the existing civilization inspection H2, **Aster**; it did not move to the town H3. This is the current observed focus destination, not a claim that the town heading received focus.

### Supported narrow window

- At 501 × 761, all five civilization dock controls remained visible. The selected Far Hearth map target ended at y=202.53125; the route/city sheet began at y=228.0625, leaving **25.53125 CSS px** clear space.
- Endpoint buttons were **436 × 44 CSS px**. The scrollable sheet was x=8, width 485, top 228.0625, height 410.9375; the route title, status, exact endpoint IDs and both Show town buttons were readable.
- Clicking Show Far Hearth kept the frontier selection. Escape from both route and city inspection returned to the map and focused Aster's dock control. Clicking the route's visible Close button also closed the sheet and returned focus to that dock control.
- On the corrected bundle, focus stayed on `town:frontier-qa` / **Show Far Hearth** from 13:54:51.932 to 13:55:51.140 UTC, with inspector scrollTop zero. The local server visibly logged repeated successful `/api/world` GETs throughout the session. The synthetic world remained unchanged. Earlier desktop observation also retained the same endpoint focus for 17 seconds.
- The corrected optional route label was hidden at this narrow camera state because the bounded placement had no clear candidate. The static route, accessible SVG target, native list and route card remained available. The selected town retained priority.

### Missing endpoints

At both desktop and narrow sizes, the isolated production card displayed both missing IDs with **Endpoint unavailable**, zero Show town buttons and zero guessed route geometry. It retained agreement facts without substituting a capital. This fixture contains no full-main interaction claim.

## Finding 1 and bounded correction

Before correction, the first route's selected 180 × 44 label sat at the midpoint directly beneath Lumen's marker. A locator's center click consequently selected Lumen. Clear-segment and native-list access worked, but the label collision was real.

The reaccepted source task adds one pure placement function shared by both adapters. It tries nine deterministic, bounded screen-space positions around the same midpoint, avoids existing town target/name rectangles, and returns no label when none fits. It still passes a placed label through the existing shared budget; the selected town stays first. Link geometry, city hit priority, card behavior and camera logic are unchanged.

Actual corrected desktop label bounds: x=665.7073–845.7073, y=358.53125–402.53125. Lumen's target ended at x=581.7073, an **84 CSS-pixel horizontal gap**. DOM rectangle comparison found no town intersection. Clicking the moved label retained the correct route card. This finding is addressed by author evidence and awaits independent resolution.

## Retained artifacts

All images are in `/tmp/civitas-qa/routes/`:

- `routes-desktop-first.png`: original midpoint overlap and pending-delivery card.
- `routes-desktop-label-after.png`: corrected selected label and exact route card.
- `routes-desktop-blocked-facts.png`: current zero damage versus past blocked attempt.
- `routes-desktop-stopped.png`: retained completed deliveries and no future delivery.
- `routes-desktop-frontier.png`: Show town selects the frontier; civilization H2 receives focus.
- `routes-narrow-after.png`: corrected 501 × 761 route sheet and clear selected frontier.
- `routes-narrow-frontier.png`, `routes-narrow-closed.png`: exact frontier selection and closed map/dock.
- `routes-desktop-missing.png`, `routes-narrow-missing.png`: isolated defensive endpoint cards.

## Evidence boundary and next step

The implementation's final scaffold log is `.blabla/scratch/inspect-consensual-trade-routes/evidence-3-2-1792158740181798154.log`: all four child exits zero, 31 web tests, strict web lint, typecheck and build. Extra `route-tests-label-final.log` has 15 passing route tests; `route-lint-label-final.log` is scoped strict lint success. The new placement regression first failed against the old midpoint placement (`label-red.log`). The existing bundle-size warning remains: about 700.36 kB minified / 184.45 kB gzip; no performance benchmark is inferred.

The browser task's exact route test command is regression evidence, separate from the interactions and pixels above. Existing accepted live camera/settings evidence is retained only for unchanged behavior. Independent review should resolve Finding 1 from the small source correction and after-pixels, then let the accepted publication proceed. Real completed-delivery or charter-result cues remain a separate, receipt-driven successor.
