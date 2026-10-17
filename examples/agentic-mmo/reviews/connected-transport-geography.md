# Connected transport: bounded design recommendation

Prepared 2026-10-16 13:31 UTC from current source, primary references and a read-only map probe. This is a prospective design handoff. It changes no engine rule, catalogue value, release or inhabited world.

## Recommended next outcome

Finish exact consenting town choices first. The following increment should give newly agreed exchanges a deterministic land path and make its length affect the exchange interval. A nearby specialized town then offers a meaningfully faster supply relationship, while a distant partner may still have the resources an agent wants. Use the existing consent, cargo, upkeep, damage, repair and strategic-beat mechanisms.

Start with shortest passable paths and one consequence: delivery cadence. Avoid adding terrain tolls, fuel consumption, border permissions, physical traders and ocean travel together. Those may become useful successors, but are not required to make this first geographic choice real.

## What the current world can support

The generator creates an 18 by 12 axial-hex map. Ocean occurs only at the outer boundary; mountains can occur inside. Five initial capitals have fixed coordinates, with their starting terrain changed to grassland. At the 13:27 research read, trade picked each partner's first town. The parallel exact-endpoint implementation appeared in source during this task: the 13:35 read confirms named-town proposals behind its new feature, with first-town behavior retained for older releases. This design does not claim that in-progress implementation is independently accepted or live. Both modes still store no traversed path and attempt their agreed exchange on globally aligned cadence boundaries. Accepted route endpoints are stable canonical city IDs.

A read-only breadth-first probe used current `createWorld` output and six axial neighbors, treating ocean and mountains as impassable. This is a prospective path model, not an existing engine capability. Across seeds 1, 7, 17, 42, 101, 1701, 2026 and 9999, all ten initial capital pairs were land-connected. Their shortest path lengths ranged from 4 to 15 edges. In inhabited seed 1701, Ember to Pelagos takes 10 land edges despite a straight-line hex distance of 9; the other initial capital pairs match direct distance. Seed 1701 has one connected walkable land component. Seeds 17 and 9999 each have one isolated single-tile component without an initial city; the other sampled maps have no isolated walkable component.

These eight seeds establish useful examples and a clear live-map limitation. They do not establish a universal map property, legal founding access to every tile, coastal connectivity or a balanced transport rate. The inhabited map must not be regenerated to manufacture a desired demonstration.

## Small path and timing contract

- New geographic proposals name exact owned source and recipient towns. Their path starts and ends on those towns' current tile IDs. Ownership and endpoint existence are checked again on consent; a missing endpoint never redirects to the first remaining town.
- Use a shared data-defined terrain passability table. For the first land mode, grassland, forest, desert and tundra are passable; ocean and mountains are not. Each edge has equal weight. Deterministic neighbor order and a stable tie-break choose one shortest path. Do not invent terrain movement costs merely to add complexity.
- Civilian transit is open across current ownership borders for this first increment. Crossing a colored border neither grants territory nor implies an unimplemented military passage treaty. A later border-access rule would be a separate political capability with explicit compatibility.
- The proposal quotes its ordered tile path, length, transport-rule version and complete cadence before consent. Store that quote with the accepted agreement. Revalidate the quoted path at acceptance; do not silently choose a different route or price. A changed invalid quote must be refused and proposed again.
- Compile travel cadence into the existing immutable terms rather than maintaining a second competing shipment clock. For new geographic agreements, the first due beat is acceptance round plus the quoted cadence. Subsequent attempts use that same interval. A blocked attempt still schedules the next ordinary attempt; existing atomic combined cargo/upkeep checks remain authoritative.
- The current globally aligned `nextBeat` rule is unsuitable as a minimum geographic delay: a long route accepted just before its boundary can otherwise deliver almost immediately. Preserve that old scheduling behavior for older agreements instead of changing their historical meaning.
- No cargo is debited or placed in transit before the due exchange. This is periodic logistics, not a simulated moving trader. Use “Exchange every 5 seasons; first due in 5” rather than promising a shipment has already departed or will certainly arrive.
- If a later supported terrain mutation invalidates a stored path, block that exact route with the affected tile and reason. Do not silently reroute, pay a new cost, erase the agreement or fabricate a delivery. Current disasters change route/city damage rather than terrain, so no new terrain-event subsystem is needed now.

### Provisional cadence experiment

One small candidate is `max(baseCadence, ceil(pathEdges / edgesPerBeat))`, where the current base cadence is four strategic beats. Testing two edges per beat against the observed capital paths gives intervals from four to eight beats; four-edge nearby connections remain at four, ten-edge connections take five, and fifteen-edge connections take eight. This exposes a useful difference without a new upkeep resource.

The factor of two is an original tuning hypothesis, not an approved value or measured balance result. Before freezing it in data, use legal near/far agreements to compare actual delivered cargo and costs over the same strategic window. Show outcomes to the Director and learn from live choices after authorized activation. Due rounds remain the dependable explanation when host catch-up is delayed; do not present an exact wall-clock arrival promise.

## Compatibility and bounded work

Keep existing accepted abstract agreements and their snapshotted terms, endpoints, due dates and history unchanged. Do not invent historical paths for them. An older pending offer may still be accepted on its original quote until its existing expiry. Under the new feature, newly created offers should use the new geographic quoting rule so an agent cannot bypass it by requesting an old abstract recipe. Preserve the older action behavior when replaying an older release.

Use an explicit versioned transport discriminator in the shared schema, with an absent transport record identifying historical abstract agreements. The orchestrator owns the exact interface. Path geometry and cadence must have one canonical source consumed by both legality and explanation. A path cannot contain duplicate tiles, unknown tiles or nonadjacent hops, and its endpoints must match the agreed towns.

For the current 216-tile map, a breadth-first traversal is bounded by map size. Compute one distance/predecessor tree per candidate source town per observation or quote, then reuse it for recipients and recipes. Do not run a fresh search for every recipe/pair or expand the whole map into each compact action description. Larger maps will require measured limits; no performance claim follows from the small probe.

The exact-town implementation should retain visibility of every eligible candidate, or expose a deliberate supported paging/query boundary. Silently truncating the Cartesian town choices would create invisible strategy. An action needs only canonical town IDs and the recipe; the server derives the quoted path from the current versioned rules and validates it again when consent arrives.

## Agent and spectator meaning

Compact choices should show both town names, terrain context, actual path length, exchange interval, each party's cargo and upkeep, one-time construction payment and why a blocked candidate is unreachable. Straight-line distance can remain a secondary fact explicitly labeled as such. Keep the two-item actor plan limit unchanged; it does not limit the research pool or the number of available towns.

The map should draw a geographic route through its canonical tile sequence. Historical abstract links retain a visibly schematic treatment. Accepted but not yet delivered, damaged/blocked and stopped links need distinct words and symbols as well as colors. A selected route can reveal the path and next due season without obscuring the selected town on a phone.

A delivery motion is earned by a new actual delivery receipt. A drawn path is not proof that cargo is already moving. Public repair changes current route damage; any later delivery still requires its separate due result. Art owns the presentation and should reuse the shared route state rather than calculate game timing or create a second pathfinder.

## Navigation must earn its name

Do not release Navigation merely because land paths now exist or a ship can be drawn. The live seed's land graph already connects every walkable site, so sea passage alone does not demonstrate a previously unreachable pair there. A future sea mode needs actual coastal endpoints/infrastructure, a continuous eligible water path and a legal before/after witness: the same intended connection is unavailable to the prior transport capability, then becomes agreed and delivers after the discovery and necessary infrastructure.

A later naturally restarted run with genuinely separated land masses, or a separately authorized compatible world expansion, could provide that geography. Neither is authorized by this report. Range or support constraints are another possible route to meaningful reach, but adding an arbitrary cap solely to make the technology pass a test would be poor design. Continue the useful land-logistics increment while this connected horizon remains prepared.

The prospective `connected-world` milestone currently requires Navigation research and three active routes. Before activating that future feature, replace this insufficient proof with evidence that the newly enabled transport actually operated. Research plus three old land exchanges would not establish the promised new reach. Preserve previous milestone history and keep calendar movement separately justified.

## Prospective acceptance and reference basis

The next implementation should demonstrate an entirely legal exact-town agreement with a valid nontrivial path, consent to the displayed interval, no early delivery and a later exact exchange. Compare near and far paths over equal strategic time; separately label synthetic disconnected/blocked-path and hostile-record probes. Replaying older releases and accepting an unexpired older quote must retain their original outcome. Serialization must preserve the exact path, terms and schedule. This design task's content check is only a catalogue regression baseline and proves none of these future mechanics.

The [official Civilization VI manual](https://downloads.2kgames.com/civilization/vi/manuals/eu/CIV_VI_25TH_ONLINE_MANUAL_ENG.pdf), printed page 114, describes trader-created roads and terrain exclusions. The [official Civilization V manual linked by its publisher](https://store.steampowered.com/manual/8930), printed pages 104–105, connects trade to roads or harbors and describes interruption of a harbor connection. Their previously downloaded primary text was inspected for this pass; a fresh web fetch of the large Civ VI PDF exceeded the retrieval limit. Firaxis's [February 2025 update notes](https://support.civilization.com/hc/en-us/articles/38337649895187-Civilization-VII-Patch-Notes-February-5-2025) make connected-town food destinations explicit in the interface and discuss consistent road connections. These are dated design references, not current-balance claims. The inference for this project is that transport must occupy real geography, communicate its endpoints and have an observable economic consequence. The proposed original cadence, consent and compatibility rules are not copied Civilization mechanics.
