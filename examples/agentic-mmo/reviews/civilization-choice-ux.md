# Civilization choices and the connected capability tree

Research and design by the actual Art Director, gpt-6-astra/xhigh, 2026-10-16. Report-only assignment. This is a proposed spectator increment; no new UI, live behavior, capability activation or visual acceptance is claimed.

## Smallest useful outcome

Keep the map and five-civilization dock. Selecting a civilization reveals one compact **Chose → Changed → Opens next** story in its existing inspector, followed by **Research & buildings**. That button opens the complete connected catalogue in one read-only sheet. Replace the current repeated ambition/research prose with these useful facts; do not add another permanent floating panel over the map.

The first important explanation is the Civic institutions case. Learning a technology and reaching an era are separate facts. A completed discovery can coexist with a civic building that still needs an era, construction supplies or an applied world capability. The viewer must show the actual missing requirements rather than imply that research completion immediately permits every linked building. Creative identified Verdant's discovery as a useful real story; this report does not freshly verify Verdant's current blockers or invent their amounts.

## Grounding and chosen approach

Source inspection covers the current catalogue/types/releases, research/build choice predicates, command effects, research completion, public chronicle/history shapes and GET routes, current inspector/dialog integration, and core's completed [canonical data-seam report](capability-tree-data-seam.md). Core and Creative confirmed the four statuses, independent activity overlays, exact-town building semantics and the separation of capability eligibility from temporary admission. The source catalogue currently has 9 technologies and 8 buildings, with 9 research prerequisite edges and 8 research-to-building edges. These counts describe source data, not live unlocks.

Reuse the already inspected official Civ V map framing and Civ VI geography/city hierarchy recorded in [VISUAL_DIRECTION.md](../VISUAL_DIRECTION.md). Reuse the [specific official Civilization VII September 2025 UI update](https://support.civilization.com/hc/en-us/articles/44950826478483-Civilization-VII-Patch-Notes-September-30-2025) as the prior reference for legible icons and concrete before/after explanations. The application here is our own: stable map framing, connected opportunities and readable consequence chips. No commercial art is copied. A newly attempted Civ VI manual fetch failed because the document exceeded that web reader's size limit; no additional tree pages or new screenshots are claimed as inspected.

Current primary interaction research, read 2026-10-16: the [W3C modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) supports a contained keyboard sequence, Escape, an explicit close control, meaningful initial focus and focus return. For this long structured sheet, focus its heading and avoid announcing the entire graph as one description. The [W3C disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) supports Enter/Space and an exposed expanded state for optional detail. Use native controls wherever possible. These are implementation directions, not a conformance audit.

## One selected civilization, three readable facts

In the inspector, show the civilization name/emblem, the exact selected town, and a compact current line: **Town focus: Growth · Researching: Water management, 6 / 16** when those are the actual facts. Research belongs to the civilization; focus belongs to a town. Do not flatten different towns into one invented civilization-wide focus. Catalogue objectives may remain under About this civilization, explicitly separate from its recorded choices.

The decision story has three short rows, each with an original semantic icon, a visible label and plain text:

1. **Chose:** the exact accepted action and its place when known. Include its recorded time/round and a detail link. A research-start action reads **Started Water management**. An accepted wait remains **Waited**, rather than being rewritten into a more dramatic decision.
2. **Changed:** up to two important committed facts from that transition, with a disclosure for the full record. A research start changes the target and can reset progress; it is not a completed discovery. A construction can show the actual built structure and paid construction amounts when supported. Base seasonal output belongs in capability detail, not in this actual-result row.
3. **Opens next:** nodes that became structurally available across that exact transition, proven by canonical before/after rows and prerequisite links. If only the current projection is available, use **Options now**. If the direct child is still blocked, use **Leads toward** with the missing requirement. Do not manufacture a newly reachable option just to fill the third row.

A later research-completion result can be the highlighted meaningful story, with its original research choice linked only when retained identity/history proves that connection. A more recent unrelated wait or focus action must not supply its rationale. A separate **Latest choice** detail retains that action without suppressing the important discovery. Ordinary clock ticks do not replace the selected civilization's last meaningful result.

**Recorded reason** is an optional disclosure containing only the public reason actually attached to the accepted command/plan. Render it as escaped text and bind it to that command ID and revision. Generic legal-choice descriptions, engine event causes and catalogue objectives are useful explanations, but none is a model's reason. When absent, say **No reason recorded** inside details. Never expose or generate private reasoning.

Opening each of the five existing dock entries should reveal that civilization's own current research, selected-town facts, latest loaded choice and supported result. Stable emblems/colors preserve identity; measured differences come from actual state. This first increment needs neither five simultaneous story panels nor invented faction personalities, rankings or prediction cards.

## Full connected tree, with every branch reachable

Use one catalogue graph generated from stable typed node IDs and canonical `requires` edges. Show research nodes and their buildings together. The current source graph includes:

- Cultivation → Water management, Kiln firing and Civic institutions; Cultivation also connects to Terraced fields and Artisan quarter.
- Water management → Irrigation works; Kiln firing → Kiln.
- Civic institutions → House of learning, Civic gathering place and Navigation.
- Civic institutions **and** Kiln firing → Fuel management → Fuel yard.
- Navigation → Industrialization → Planetary computing → Interplanetary logistics → Orbital gateway.

All listed parents are required. In particular, Fuel management must retain both incoming links. Era metadata may label groups but must not create fake prerequisite edges or block research.

On a wide screen, use HTML node cards in topological groups with quiet original SVG connectors behind them. On a narrow screen, use the same nodes in a vertically scrollable reading order. Each node exposes linked **Requires** and **Leads to** names; those relationships remain complete when cross-column connector lines would be cluttered. Selecting one highlights its connected branch and opens its details within the same sheet. No node requires hover, drag-to-find or a tiny line hit target. Do not use an ARIA tree widget for this multi-parent graph unless its full interaction model is deliberately implemented; native headings, lists and buttons are sufficient.

Keep all 17 current catalogue nodes available in the sheet. Compact cards show name, kind, primary status and the most important blocker; longer amounts, every blocker and descriptions expand on demand. No graph library, new map meshes or broad virtualization system is justified at this scale. Node counts, links and ordering derive from catalogue data; unknown future entries receive an honest generic icon rather than disappearing.

## Four statuses, plus independent overlays

The UI consumes core's canonical status/blocker projection. It does not reproduce `availableActions` rules or infer reasons from a node missing from a legal-action menu.

| Primary label | Meaning and visible explanation |
| --- | --- |
| Done | Technology is completed by this civilization, or the building exists in the selected town. Preserve this historical fact even if another current feature is absent. |
| Available | Structural requirements are met. Current research has this base status plus **Researching** and actual progress; no duplicate action is implied. Explain once that availability does not mean an agent has chosen it. |
| Locked | Applied capabilities exist, but an actual prerequisite, building era, town/site requirement or construction amount is missing. Show the typed blocker in familiar words and all required/available values in detail. |
| Planned | A required capability is missing from the applied world. Show **Waiting for a world update**. Distinguish **Included in another release** from **Catalogue only** when canonical source support establishes that distinction; neither is a deployment or activation promise. |

Use a check, open circle, lock and outline/dotted badge respectively, always with the word. Preserve parchment/gold and deep-blue themes and sufficient text contrast; status must not depend on civilization hue alone. Researching adds a static progress indicator. A recorded **Next intention** is a separate exact plan item with its current recorded status, never a queued command or guarantee. A common observation/admission note such as an overdue economy beat stays outside node status.

Science cost reads **Research work: 24 science**, not a price that must already be held to select the project. Zero stored science and a technology's higher era metadata do not by themselves lock research. Buildings show **Build once**, **Uses each operating season** and **Base production before productivity** separately. Actual **Paid / Made** receipts remain in the town inspector. A paused or blocked constructed recipe remains Done. A building in another town is not Done in this one; an optional **Built in 2 of 3 towns** navigation fact cannot override selected-town status.

## Explain the era bridge without a second rules engine

For Civic institutions, the card can show **Done** while House of learning shows the actual era requirement. **Why is this locked?** opens the relevant canonical milestone explanation inside the sheet. The source bridge runs from cultivated fields through roads-between-peoples to rise-of-states; the rise-of-states condition involves earlier milestones, completed research across civilizations and actual active routes. Calendar year alone is insufficient. Do not substitute a proposed route, a retained corridor or a promise for the engine's active-route fact.

The exact condition/progress display must come from core's milestone evaluator/projection when supplied. Until structured progress is available, show the canonical milestone description and known required era, without a second UI switch that recalculates its conditions. World-wide milestone requirements and selected-town building requirements remain visibly distinct. The full tree can therefore explain a future branch without claiming that the branch is presently usable.

## Read-only history and bounded data

The current viewer already has committed snapshot facts and event history, but its latest-event summary does not prove the latest accepted civilization decision. Use public GET `/api/chronicle` for exact accepted actions and `/api/history` only where corresponding states are needed. Preserve world/run identity, command ID, seat, actual public provenance, start/end revision and event IDs. Strategy catch-up, clock and release entries remain their own transitions even when they precede an action in one request.

For initial story loading, choose a bounded recent revision window and a fixed page/request cap; retain the returned coverage bounds. Existing chronicle pages are ascending after a revision. Do not silently fetch the whole run to find all five latest actions. A civilization with no choice in the loaded range says **No choice in this loaded history**, with an explicit bounded **Load older** route. A later indexed latest-per-seat summary is a possible separately measured seam if this proves too sparse. Cache by run and revision; unchanged polls do not repeat history work. An incomplete page or unavailable before-state means the exact consequence chain is unavailable, not zero change.

Research completion identity should be structured by the core projection or an unambiguous recorded binding. Do not introduce a new frontend prose parser for event effects. For old untargeted build commands, the recorded event location and corresponding history locate the actual town; today's city order cannot repair missing old evidence. No live command endpoint, planner, turn advancement or world initialization belongs in this UI.

## Interaction and layout budget

The normal map keeps the existing label, route and geometry caps. The decision story belongs within the inspector's scroll area; long text cannot grow a new overlay across camera controls or the story strip. Primary actions, node summaries and links have at least 44 CSS-pixel targets. Compact labels retain readable type rather than shrinking the entire tree to fit.

The tree is a deliberate modal reading view, unlike the default map. Use the existing dialog approach, a visible title/civilization/town context and sticky Close action, contained keyboard focus, Escape, and return to the opener with `preventScroll`. Put node details in the same sheet, not stacked modals. Opening and closing preserves exact selected town and camera. After closure the already verified mobile inspector framing remains responsible for keeping the selected town visible.

Capture the tree at an explicit revision while open. Show **New facts available** and refresh on request rather than replacing focused cards during polling. Preserve the selected node and expanded disclosure when still valid. Town/civilization changes are explicit read-only context changes. Rich, Calm and reduced-motion views show the same facts; neither a historical discovery nor opening a tree earns celebration or replayed production. A small static emphasis is sufficient for the first implementation.

## Prospective acceptance and sequence

First implement and test core's shared eligibility/status projection. Then add the complete read-only tree and selected-civilization story using that data, with bounded public history loading. Suggested falsifying cases:

- Every canonical technology/building and every prerequisite edge survives projection; Fuel management has both required parents.
- Current research is Available plus actual progress even though duplicate selection is absent; science balance and technology era do not invent research blockers.
- Missing world feature yields Planned; low construction stock yields Locked; a completed item remains Done. Registered support is distinguished from catalogue-only content.
- Civic institutions is Done while an exact-town civic building retains its genuine era/resource/capability blockers. Milestone and current year are not conflated.
- Building state changes with selected town, including built elsewhere, missing town, paused and previously blocked operations.
- Accepted choice/reason joins by exact command identity. Research start, later completion, pre-action economy catch-up and unrelated later choices remain separate. Missing/pruned history stays explicit.
- Actual construction/operation payments and outputs are distinguished from catalogue potential; no current-state subtraction is attributed to an unrelated old command.
- Unchanged polling preserves focused node/summary and scroll. Refresh, context changes, Close and Escape keep logical focus; the viewer makes only public reads.
- Actual short-desktop and supported narrow pixels show reachable all-branch inspection, clear current context and no inspector/control collision. Reuse existing camera/settings evidence, then inspect the new sheet in both themes and Calm/reduced motion. Synthetic fixtures must be labeled. A 504-pixel cloud viewport does not establish 360-pixel behavior or hardware touch; SVG evidence does not establish runtime WebGL.

The declared 26-test visual-kit check is only a regression baseline for this report. It does not implement the graph, prove the proposed story causality, verify API budgets or satisfy browser acceptance. Those are the next scoped implementation outcomes; the goal is not complete on the strength of a design document.
