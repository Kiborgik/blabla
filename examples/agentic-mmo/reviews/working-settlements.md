# Working settlement review

Reviewed by actual gpt-6-astra on 2026-10-16. This review covers the `visualize-working-settlements` source delta. Previous accepted settings, narrow-camera and desktop-camera evidence is reused; this is not another whole-viewer audit.

## Source findings

One bounded finding was identified and repaired: changed live state rebuilt the inspector without restoring keyboard focus on an operation receipt's summary. The revised code captures the focused summary's building ID, retains it only for the same non-null canonical city and focuses the recreated summary with `preventScroll`. Existing expanded details and scroll position survive. The focused regression covers kiln/irrigation retention, changed-city rejection, missing building identity and null selection. Independent source inspection confirms this correction; no remaining bounded source blocker was found. The orchestrator owns finding resolution and acceptance.

## Semantics inspected

- Canonical city IDs carry selection through preferences, the map renderers, label priority, camera framing and settlement inspection. The civilization dock remains one item per civilization. A removed or unavailable saved town falls back to an existing town rather than redirecting an action. These controls only observe the world.
- The selected city's population, focus, damage and buildings are distinct from civilization-wide stored resources. Both SVG and Three consume the same original building-part catalogue and bounded settlement parts. Farm, workshop, irrigation and kiln shapes exist only for committed buildings. Missing operation history is described as unknown rather than fabricated.
- Current On/Paused state is separate from the last recorded operation. Historical Paid, Made, round and shortage facts survive later toggles. A blocked record identifies the opening-stock shortage and no payment/output; a funded zero-output record can show actual payment without pretending it made supplies.
- Work motion requires a newly recorded positive production result. Construction, a paused building, a blocked attempt and zero output do not create a work cue. Initial history is not replayed as new live motion. Persistent structures remain visible while paused or blocked. Calm/still and reduced-motion settings suppress these new moving marks.
- Existing damage/wellbeing indicators do not invent persistent drought. This increment does not claim that prepared irrigation/kiln capabilities have been applied to the inhabited world, and it does not animate unrecorded trade deliveries.

## Evidence and limits

Read the complete author scaffold check3 and final check4 logs. Final `.blabla/scratch/visualize-working-settlements/evidence-4-2-1792151945951946207.log` reports strict TypeScript, scoped lint, 29 web tests and the production build all exited zero. The bundle-size warning is retained as a measurement limit, not treated as proof of frame rate. The reviewer runs only this review task's declared 17-test semantic visual check; its recorded result is authoritative for that bounded check.

Inspected the original settlement-kit image at `/tmp/civitas-qa/working-settlements-kit.png`. It is explicitly a synthetic geometry fixture: distinct structures and far/middle/close part counts are visible. It is not an image of the inhabited world, proof of browser rendering or proof that future buildings are live. The test assertions inspect finite unique bounded parts, all four building kinds across detail levels, operation-state distinctions and cue semantics.

Prior live.6 source and actual 501px/1188px pixel evidence remains applicable to unchanged settings and camera behavior. New live.7 city selection, receipt interactions and operating-building appearance still need actual deployed checks. Cloud-browser WebGL, physical touch and 360/390/430px rendered behavior remain unverified; passing source checks must not be presented as those outcomes.

## Goal consequence

The delta makes later multi-town and paid-production choices observable without duplicating simulation rules. The connected successor is a truthful damage/repair presentation: current damage supplies persistent condition, an accepted repair supplies its actual delta, and the display must not invent population recovery or restored historical infrastructure. Live capability activation remains separately permission-gated.
