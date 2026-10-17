# Read agreed routes and real deliveries

Art Director research and bounded proposal, 16 October 2026. This document specifies a future assigned viewer increment. It changes no source, rules, world capabilities or live records. The current foundations world supplies no live consent-trade example. Civic kit files remain frozen for independent review.

## Decision and inspected evidence

Start with a faithful route projection and one reusable inspection card. Then add a short completed-delivery cue. Do not begin with a caravan asset system: current projection discards the facts needed to distinguish an agreement from a successful shipment.

Inspected current `core/types.ts`, `core/simulation/trade.ts`, `core/simulation/public-projects.ts`, the economy resolution order, `web/atlas.ts`, `web/live-world.ts`, both renderers, and `web/world-cues.ts`. Public-project code is concurrently developing; its source presence does not establish acceptance or live availability. The earlier researched `VISUAL_DIRECTION.md` remains the palette and map-hierarchy basis; its superseded calendar sentence does not govern gameplay.

Primary documentation checked for this proposal:

- [Three LineMaterial](https://threejs.org/docs/pages/LineMaterial.html): the existing Three package includes an explicit addon for screen-space line widths and solid/dashed styles. Viewport resolution must remain current. Application: use a small shared material set for readable routes if ordinary one-pixel lines are inadequate; no new package is required. This does not prove runtime WebGL quality.
- [MDN SVG stroke-dasharray](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/stroke-dasharray): dash/gap patterns work on lines and paths. Application: share semantic route styles with Three while keeping the SVG fallback equally informative. No moving dash offset should imply ongoing transport.
- [W3C use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html): state needs a second visual distinction. Application: pattern, endpoint symbol and short status words accompany color.
- [W3C enhanced target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html): a large equivalent control can make a thin map target accessible. Application: keep 44px route rows and endpoint buttons; do not turn every crossing line into a conflicting 44px-wide hit region. This is our chosen target, not a whole-product conformance claim.

No asset, font or software was downloaded. Existing original cargo, repair and resource icons, shared solids, parchment/gold surfaces, deep-blue contrast backing and civilization endpoint accents are sufficient.

## Facts available now, and facts currently lost

`Route` contains a stable route ID, exact `from`/`to` city IDs, participants, current damage, volume and optional agreement. The agreement retains immutable terms, consent enabled/stopped, acceptance round, next scheduled attempt, last attempt, last successful delivery, delivery count, and the last blocking actor/reason. `TradeOffer` separately retains exact endpoints, proposed terms, status and expiry.

Acceptance pays the proposer's construction cost once and creates an enabled route with `active=false`, zero volume and no completed shipment. Later shared strategic beats attempt both cargo-plus-upkeep obligations atomically. A blocked attempt transfers nothing. Success records both cargo directions, upkeep and commerce through the accepted terms, sets the last-delivery round and increments the count. Stopping disables future work, clears current volume and preserves past delivery facts. Therefore:

- `active` describes the latest attempted delivery result, not consent or cargo currently in transit.
- `volume` is not a vehicle count, travel progress or continuous flow rate.
- A past shortage reason is a past-attempt fact. Current stocks may have changed.
- Present damage and the previous shipment result are separate facts. A repair does not itself run another shipment.
- Records without an agreement are legacy routes; never label them mutually agreed without evidence.

Today `AtlasWorld.routes` is only endpoint-index pairs. `projectWorld` emits them only when `route.active` is true. Thus newly accepted, blocked and stopped routes vanish, and IDs, terms and outcome timing are lost. SVG draws identical dashed links; Three draws identical dashed curves. Three's looping sample token is restricted to `illustrative` worlds and must remain separate from real delivery presentation.

The current `trade-delivered` event contains a route ID in `detail`, destination tile, aggregate exchanged cargo and next due round. It has no self-contained per-resource delivery receipt. Current `VisualEvent` also has no route anchor. Its generic city fallback chooses a civilization's first city, which is unsuitable for exact multi-town route endpoints.

## Smallest projection and inspection seam

Replace live route pairs with one renderer-neutral route view keyed by route ID. Preserve canonical endpoint city IDs, participant IDs, nullable resolved endpoint positions, damage and a cloned optional agreement. Keep pending offers in a separately typed view. Renderers consume one pure status/style resolver rather than each interpreting consent. The illustrative sample can be explicitly adapted to synthetic route views; its links never become live receipts.

Missing endpoints remain inspectable as “Endpoint unavailable.” Suppress the unlocatable map line instead of connecting to a different town. Canonical route ID is the selection key; endpoint buttons use the existing canonical city selection/framing path. A missing saved route falls back to the prior city or overview without selecting an unrelated route.

The first card has four short groups:

1. Exact towns and civilizations, with 44px “Show Dawnwell” / “Show Tidehaven” buttons.
2. Current consent and damage, then the last actual attempt/result as a separate line.
3. Agreed cargo in each direction, separately labelled transport costs and commerce terms. These are terms, not amounts delivered now.
4. Last delivery round/count and next scheduled round. Use round/economy-beat vocabulary from canonical state; do not invent wall-clock arrival times.

A selected city can expose a small route list with the same card. This gives keyboard and touch access when thin paths cross. Opening a route reuses the single inspection surface, Close/Escape, focus restoration and upper-map framing. No accept, stop, pay or repair controls are offered to humans. Do not recenter to a capital when the route names another town.

## Persistent map language

The link is schematic between recorded endpoints: no canonical tile-by-tile road or terrain path exists. Its curve must not imply ownership of intervening tiles, a bridge, a sea vessel or a navigable mountain pass.

| Canonical situation | Map and short label | What stays still |
| --- | --- | --- |
| Pending offer | Dotted neutral link only when selected; hollow endpoint marks. “Offer · waiting for reply.” | No transport, payment or accepted-route glow |
| Enabled, no completed attempt | Thin solid warm line with linked endpoint marks. “Agreed · first due round N.” | The first shipment has not happened |
| Enabled, last delivery succeeded | Same agreed line. Inspection: “Delivered round N · next due M.” | No ambient cargo loop between beats |
| Last attempt blocked | Broken/double-gap style with a small warning mark. “Last attempt blocked.” Show recorded reason and round | Do not claim supplies are still missing today |
| Current damage reaches the recorded transport threshold | Visible crack mark and exact damage; preserve the separate last-attempt line | Do not simulate a new failed attempt |
| Consent stopped | Muted broken line and square end caps when selected. “Trade stopped.” | Historical deliveries remain in inspection/history |
| Legacy agreement absent | Neutral selected link. “Legacy route · agreement not recorded.” | No invented consent or receipt |

Civilization colors identify the two endpoints; they do not replace route-state symbols. Keep core lines readable against terrain in both themes with a dark contrast backing when necessary. Pending/stopped histories should not cover the default map: expose them through selection and the bounded route list. A last blocked attempt can remain recorded after a repair; say “Damage now 0% · last attempt blocked” rather than erasing history or promising success.

## Completed cargo, not an invented journey

Only an unseen committed `trade-delivered` event earns a short route cue. Resolve its exact route ID and endpoints before drawing motion. Display “Delivered · round N” while an original crate/diamond accent sweeps once along the schematic link, then disappears. It is a brief spatial replay of completed exchange, never an in-flight progress bar. Show each direction only when the corresponding recorded cargo is positive. Upkeep and commerce use separate numbers, not cargo animation.

For the first increment, aggregate cargo is sufficient when that is all the event proves. If the event resolves to the same retained immutable agreement, exact accepted cargo terms can support the two directions for that confirmed successful delivery. If the route or binding is unavailable, show the aggregate historical receipt with no guessed endpoints or resource split.

The smallest durable engine extension for self-contained old delivery inspection is an optional structured delivery receipt on `GameEvent`: route/agreement IDs, exact endpoint city IDs and participant IDs, cloned actual cargo in both directions, paid upkeep and credited commerce. Event ID and round already exist. The engine owns those amounts. This extension is useful for archived/missing-route history but is not required to ship honest agreed/blocked/stopped state or aggregate-delivery cues. Do not parse prose titles for quantities or retrospectively infer them from today's stocks.

The viewer additionally needs an optional explicit route anchor on the projected event, supplied by the same route resolver. A generic civilization-first-city fallback is not acceptable for a route cue. Reuse the current bounded unseen-event tracker. Initial load, reopened cards, older history pages, repeated polling and run changes remain still. A missed update does not require replaying every shipment since the tab was hidden. Calm and device reduced motion retain the exact static delivery facts without travel motion.

## Later repair charter overlay

An existing trade agreement and a public repair pledge are separate layers. In current developing source, active public projects bind route ID plus agreement offer ID, have pending or committed status, immutable contributions, and expiry/due rounds. Acceptance collects or reserves no stock. The two partners can spend those resources before the due beat, so display “Promised · not set aside.”

Pending pledge: a hollow repair marker in selected-route inspection, “Repair proposed.” Committed pledge: the same marker with paired participant accents, “Repair agreed · due round N.” The underlying route remains in its actual trade/damage state. Do not animate builders or mark damage repaired on commitment.

Terminal events already propose a structured `publicProjectResult` with both exact paid vectors, outcome/reason and damage before/after. Consume that receipt rather than adding a parallel prose parser. Only a completed outcome with a positive actual damage reduction earns a brief repair pulse; show the clamped reduction, separate payer rows, and current route condition. Declined, cancelled, expired, failed and no-work-needed outcomes retain their actual zero-payment or reason facts and do not produce repair motion. Results are removed from the active-project list, so historical outcomes come from events, not an invented active project. Missing route geometry means a factual history card without map anchoring.

Economy source currently resolves trade before public projects. A charter repair can therefore follow a failed delivery on the same beat. Never immediately animate cargo after the repair; wait for a later genuine delivery event. Recheck this developing interface and independent acceptance before implementation.

## Budgets and acceptance

Keep existing far/middle/close thresholds, hysteresis, house/building caps and shared geometry reuse. Proposed starting route caps are 12 visible links, with selected links first; 12/18/24 sampled segments per link across detail bands. These are finite design budgets to measure, not claimed performance results. Show only the selected route's persistent status label; it shares the existing screen-space label budget instead of adding an unlimited label set. Keep at most one local transient cue on narrow screens and three on larger screens across all event types, not an additional route-only pool. Far views need no crate mesh; middle/close can reuse one shared original token geometry. Dispose replaced geometry and do no idle transport work in hidden tabs.

Implementation should test: accepted-before-first-delivery; stopped and blocked routes retained; current damage separate from last result; exact non-capital endpoints; missing/legacy routes; two opposite cargo directions; aggregate-only old receipts; no work on acceptance/repair/zero output; no replay from polling or history paging; stable selected-first caps and unchanged canonical inputs. The declared existing web tests for this document are baseline regression evidence only, not proof of these unimplemented cases.

Pixel acceptance later needs actual narrow and short-desktop composition, selected route and endpoint above the sheet, reachable 44px alternatives, visible focus and Escape, line/state distinction in both themes, and a real newly recorded shipment when one exists. Clearly labelled offline fixtures may cover absent states; never inject them into the public world. Cloud SVG cannot prove WebGL quality or hardware touch. The exact path style, cross-route density and historical missing-binding behavior remain modest implementation uncertainties, not a reason to redesign the whole renderer.
