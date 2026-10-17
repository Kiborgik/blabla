# Committed route result cues

2026-10-16. Art Director: actual gpt-6-astra, xhigh. This increment supplies a pure shared projection and original visual direction. It does not wire a renderer, publish a version, activate a world capability, or demonstrate a live shipment.

## Outcome and evidence boundary

A spectator should recognize a completed exchange or joint repair at its exact towns without reading a transcript. Cargo, transport costs, commerce and repair payments remain distinct facts. A route's current condition can differ from its recorded result. The map must never imply an unrecorded journey, payment, repaired building or immediate shipment after repair.

The three assigned files are `visuals/route-cues.ts`, `tests/route-cues.test.ts` and this report. Existing route inspection, both renderers, main polling, manifests and the accepted live.10 archive remain unchanged. Future pixels must verify the proposed composition. Current evidence is source and focused tests only.

## Research and chosen approach

Read current `core/types.ts`, `core/simulation/trade.ts`, `core/simulation/public-projects.ts`, `core/simulation/events.ts`, `core/engine.ts`, `core/validation.ts`, the existing route projection/card, and accepted `reviews/route-visual-direction.md`. Reuse its verified Three LineMaterial, MDN SVG dash, W3C non-color and 44px target findings. Existing original cargo and repair symbols, shared solids, civilization accents and parchment/gold contrast suffice; no new asset pipeline or download is needed.

Two current primary references were inspected for presentation comfort:

- [MDN reduced-motion media query](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) explains the device preference for reducing nonessential movement. Application: preserve static facts and remove scale/pan motion when reduced motion is effective.
- [W3C animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) supports disabling nonessential interaction-triggered movement. Application: route selection opens inspection without replaying a past exchange; Calm remains sufficient for understanding. This is design guidance, not a conformance claim.

The existing generic event tracker has no revision watermark or exact route binding. This helper is deliberately unwired while that owner is frozen. Its successor must replace the generic delivery branch in the one shared event presentation flow, rather than run two delivery trackers or add a second animation pool.

## Canonical facts and conservative binding

Delivery events currently provide the exact route ID in `detail`, participants, an exact accepted-offer cause, and one aggregate cargo effect. They do not contain a self-contained resource receipt. The canonical engine supplies both immutable cargo vectors, consumes both upkeep vectors and credits both commerce vectors atomically on success.

The helper exposes per-resource facts only when the retained non-illustrative route agrees with the event's route, participants, offer ID and round; its accepted/last-delivered/closed rounds allow that event; and the recorded aggregate equals the immutable cargo total. It clones the two cargo, paid-upkeep and credited-commerce vectors without rounding or adding construction cost. `factSource` explicitly distinguishes this bound-agreement reconstruction from an event-aggregate result. Today's stocks, `active`, `volume`, current damage and current enabled status never manufacture or erase the delivery.

If that binding is missing or ambiguous, retain the recorded aggregate, route/event ID and round, with no resource split, guessed town or map accent. Unknown or duplicate aggregate grammar yields an unavailable amount. A matching route with a missing town retains exact city IDs and financial facts but has no map anchor. An incorrectly resolved capital cannot stand in for a frontier town.

A public repair event already has `publicProjectResult`. Clone its project/route/agreement IDs, actual proposer and recipient, their paid vectors, outcome/reason and damage before/after. The charter proposer may be the trade recipient; payer identity is preserved independently of route direction. The actual reduction is before minus after, never the catalogue maximum. Current damage is a separate field, available only for the same retained binding. Missing/replaced bindings keep the structured receipt without borrowing current endpoints.

Only a completed positive reduction with both exact towns gets a repair accent. Declined, cancelled, expired, failed and no-work-needed results retain their reason and payment facts without repair or cargo movement. Proposals, acceptance and blocked shipments are not completed-result cues. Trade resolves before public repair on the same beat; this projection never synthesizes a subsequent delivery.

## Freshness and finite work

`projectRouteCues(previous, observation, slots)` returns a new cursor and cues without modifying its inputs. The caller supplies the authoritative run identity, committed revision, validated events and projected route views. Use the established snapshot identity, not a changing release/version label.

The engine increments revision before emitting `revision:index` event IDs. Eligibility is strictly previous revision < event revision <= observed revision. The actual-engine delivery test protects this boundary; two different IDs in one revision remain independently eligible. Repeated IDs are deduplicated. Initial load and changed run identity baseline silently. Same/older snapshots cannot rewind the watermark or replay events.

History mode never presents cues or replaces the live revision. It marks the cursor for a quiet latest-live baseline on return. Baseline mode consumes current events while hidden, paused or otherwise not presenting them. Opening or closing an inspection card must retain this cursor; it is observation state, not component-local animation state.

Scan only the final 96 events. Sort eligible results by importance, then committed revision/index descending. Return at most three, or the caller's smaller nonnegative finite slot allowance. Consume the whole observed revision even when the allowance is zero or results overflow, so omitted cues do not play later. This limit is a share of the existing global cue budget: one total on narrow screens, up to three total on larger screens across all event types. It is not three extra route effects.

## Original visual direction for the next wiring task

Use a stationary paired receipt accent at the two exact endpoint towns. A small crate/diamond signifies cargo; a repair-tool mark signifies completed joint repair. Civilization colors identify participants, while shape and short words carry result meaning. Neither symbol moves along the schematic link. Keep the existing static route line and current damage/status underneath it.

- Delivery: “Delivered · round N”, then a compact cargo icon and recorded aggregate. Inspection expands each direction under “Cargo sent”, with “Transport paid” and “Commerce received” separately. No green gross amount is labelled net stock gain.
- Repair: “Repaired 12 points”, paired with “Damage 12% → 0%” from the receipt. Inspection shows each participant's “Paid” row, recorded round and “Damage now” separately when available.
- Failed or withdrawn repair: a still warning/status mark and short reason in the story/card. Never draw builders, filling cracks or cargo for these outcomes.
- Unbound history: factual receipt text remains reachable, with “Endpoint unavailable” where needed; no camera jump or substitute capital.

Rich may give a single local opacity emphasis and settle within the existing approximately 2.6-second cue lifetime. Cinematic can use the same bounded endpoint accents with slightly richer contrast, not more routes or repeated effects. Calm and effective reduced motion use a still symbol/number badge for the same result. No screen shake, auto-pan, sweeping token, looping dash or scale pulse is needed. All modes keep permanent history/inspection access after the temporary cue ends.

At far detail, use only one existing semantic icon/number badge. Middle/close may show the paired endpoint symbols, sharing existing icon geometry/materials. On narrow screens show one compact story line, omit extra labels when the shared screen-space budget is full, and preserve selected-town priority and the verified upper-map sheet gap. Existing 44px route-list and Show town controls remain the accessible alternative; an effect must not take pointer or keyboard focus.

## Verification and remaining work

Tests were written before the projection behavior. Sixteen assertions failed against the empty behavior scaffold. A later actual `resolveTrade` fixture caught the revision-boundary error, and a separate history-return assertion caught replay on resume; both were corrected before hand-back. The final focused suite covers exact frontier identity, safe/unsafe binding, all terminal charter outcomes, cloned payments, no-work cases, stopped-but-historical deliveries, missing endpoints, same-revision ordering, duplicate IDs, finite caps, quiet initial/history/hidden observations and input immutability. Synthetic and defensive fixtures do not establish live capability or renderer behavior.

The next bounded task should wire this value through the existing single event flow, replace generic delivery fallback anchoring, retain the global budget and inspect actual narrow/desktop SVG pixels. Runtime WebGL, hardware touch and genuinely new live route receipts remain unverified. If durable old delivery inspection must survive pruned routes, the smallest engine-owned extension is an optional structured receipt containing route/agreement IDs, exact town/participant IDs and actual cargo/upkeep/commerce vectors. That schema change is outside this visual task and is not required for honest aggregate-only fallback today.
