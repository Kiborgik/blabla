# Watching a world grow

Creative direction, researched and reviewed on 2026-10-16. This is a working direction for successive features, not a claim that the preview already implements them. Ship the inhabited world and new capabilities continuously; use real watching and play to decide what earns further attention.

## The experience

Open the site and immediately understand **where the civilizations are, what just happened, and why it matters**. Stay because the land visibly changes: fields appear, caravans connect cities, a discovery creates a new opportunity, and the agents respond. The eventual history-to-Mars horizon should be legible through the world that is actually built.

Humans observe five civilizations and the sixth World Director. Camera, playback, inspection, filters and presentation settings are viewer controls. They never issue civilization orders, choose events or pause the authoritative world. Agents consume compact structured observations and never wait for an animation.

## Reference findings and their limits

These are source observations followed by our design applications. Original art, icons, composition and assets are required. No Civilization assets are copied into this project.

1. **Civilization V: readable geography and stable framing.** The official manual's page 21 puts the map in the middle, with city banners and a territorial outline over natural terrain; persistent information sits around its edges. The same page documents recentering and active-unit camera focus. I inspected the rendered page, rather than relying only on extracted text. Application: preserve a recognizable overview, then move attention to the place where a meaningful action occurred. Our observer layout can reclaim the command-panel space. [Official manual, linked from the publisher's Steam page](https://store.steampowered.com/manual/8930).
2. **Civilization VI: make systems occupy the land.** The official manual's page 28 visibly separates the city, forests, mountains, river, ownership border and unit marks. I inspected that rendered page. The official game description also emphasizes cities expanding across terrain and research opening new possibilities. Application: actual farms, workshops, routes and later infrastructure should alter silhouettes and activity on the map, rather than exist only as resource counters. [Official manual, page 28](https://cdn.steamstatic.com/steam/apps/289070/manuals/CIV_VI_25TH_ONLINE_MANUAL_ENG.pdf?t=1636653176), [official Civ VI description](https://civilization.2k.com/en-GB/civ-vi/).
3. **Civilization VII: information should explain impact.** Firaxis's September 2025 update describes net-yield changes, before/after breakdowns, clearer building icons and revised tooltips. Application: an observer should see the committed change and its cause, with a compact explanation and optional details. This is a reference to a specific update, not a claim about the latest release. [Official update notes, UI section](https://support.civilization.com/hc/en-us/articles/44950826478483-Civilization-VII-Patch-Notes-September-30-2025).
4. **Civilization VII: detail must survive different camera distances.** In a first-hand interview, Firaxis art staff describe adjusting building detail for distant and close cameras and drawing on tabletop miniatures. Application: give our buildings distinct masses first, then add inviting details at close range. A tiny realistic texture is less valuable than a farm that reads immediately. [Firaxis team interview, environment and unit-art discussion](https://www.qualbert.com/civilization-vii-team-interview/).
5. **Long-form reference material.** Firaxis publishes developer gameplay streams focused on Antiquity and Exploration, including systems and age transitions. These are useful future shot-study sources. The announcement pages were read; a full stream was not watched in this research pass, so no shot timings or viewing-retention claims are attributed to them. Our suggested camera rhythm below is a design hypothesis for live observation. [Official Antiquity stream page](https://civilization.2k.com/pt-BR/civ-vii/news/civ-streams-antiquity-age/), [official Exploration stream page](https://civilization.2k.com/es-MX/civ-vii/news/civ-streams-exploration-age/).
6. **Readability is part of spectacle.** W3C guidance supports communicating beyond color alone, predictable dismissible supplementary content, and control over non-essential motion. Application: pair hue with symbols and words, make explanations available on tap and keyboard focus, and respect reduced-motion preferences. This direction is not a claim of audited WCAG conformance. [Use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html), [hover/focus content](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html), [animation preferences](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).

## What the current public preview actually shows

Reviewed the deployed desktop fallback and changelog screenshots supplied by the frontend QA pass, plus current `web/main.ts`. The cloud browser could not initialize WebGL. These observations cover the fallback interface; they do not establish how the 3D renderer looks or performs. Mobile pixel review and a successful 3D view remain separate evidence to collect.

- Keep the warm atlas palette, restrained teal framing and distinct civilization identity marks. They give the world a coherent starting character.
- Once live state is available, replace the large introductory headline with a compact year/run/status strip. The map needs the space. Keep the introduction in About.
- Replace missing-glyph squares with a consistent original SVG icon set. Arrows, layer icons and event marks must render predictably across devices.
- The desktop screenshot has the lower-left layer buttons intruding into the civilization list. Give panels independent layout space and test the actual narrow-height layout.
- Raise the size and contrast of small descriptive text. All-caps labels should be short secondary labels, not the main explanation.
- The fallback currently offers the civilization list after the 3D map fails. A simple 2D map of the same authoritative geography is the next fallback outcome; lists remain a useful companion.
- The current footer names BlaBla but its markup is text, not a link. Make **Built with BlaBla** a real visible link to [the project](https://github.com/Kiborgik/blabla). About can briefly explain that BlaBla organizes the agents' development work.
- The preview has its own illustrative civilization catalogue. Live integration must replace those identities and fixed routes with a projection of authoritative data. Do not maintain two competing sets of civilizations.
- Existing source copy already describes a growing roadmap; audit the deployed changelog and About together at the next release. Describe future victory paths as evolving possibilities, not the complete game or only two guaranteed endings.

These are successor-task directions. They are not reasons to delay the authoritative live service while perfecting the preview.

## Map hierarchy

### Far: understand the world

Terrain, coastlines, five civilization colors with emblems, capitals, borders and major connections. Prefer clear land/sea separation and quiet terrain detail. Do not make every tile flash or show every resource number simultaneously. Show an unobtrusive activity marker where a major event is unfolding.

### Middle: understand a place

City name, population, a few recognizable structures, active roads or caravans, and a clear condition badge such as **Food low**. A farm has rows and a low profile; a workshop has a compact work yard; a later civic building has a distinct public silhouette. Border color should not wash out the terrain.

### Close: enjoy the life

Small inhabitants, smoke, water motion, flags, construction activity and environmental detail. Decorative people are atmosphere unless the simulation actually models them; never present their movement as individual simulated decisions. Increase detail with zoom rather than covering the wide view with tiny marks.

Civilization identity has a stable color, emblem and name. Resource identity has a separate stable icon and word. A civilization's orange must not mean that all its actions are warnings. Status uses a badge shape, icon and text as well as color.

## A shared visual sentence for real events

Every significant committed event can be presented in three beats:

1. **Locate:** identify the actor and place, with a brief local marker or optional camera focus.
2. **Change:** animate the actual result: a structure appears, cargo completes its trip, a route stops, a damaged area changes condition.
3. **Explain:** show a short causal caption and concrete delta. Keep it inspectable in history after the animation ends.

Example, only when supported by the actual record: **Verdant built a farm. Food production rises by 3 each round.** A resource discovery can say **Ember found new supplies: +18 materials, +8 energy.** Do not attribute a strategic motive unless the agent actually supplied a public rationale. A selected action can be explained factually without inventing hidden thought.

The renderer consumes event IDs, affected entities, committed deltas and state from one adapter. It does not recalculate economic outcomes. Decorative timing, particle count and camera movement are presentation data. Keep one semantic formatter per event family; reuse icons, delta badges, tooltip behavior and layout primitives.

If events arrive faster than a person can read them, group routine production, prioritize first discoveries and meaningful changes, and expose the complete durable history. Do not slow the engine to match the camera. Make **Live**, **Watching earlier**, and **Connection interrupted** explicit. A **Go live** control catches up the viewer without changing the world.

Automatic camera following is optional. A manual pan or inspection suspends it until the viewer explicitly resumes. Avoid grabbing the camera away from someone reading a city. Show skipped events in the timeline rather than replaying every minor animation as a compulsory backlog.

## Direction for each system

| System | Visible world change | Simple explanation and inspection | Next useful implementation boundary |
| --- | --- | --- | --- |
| Settlement and production | Farm rows, workshop yard, construction reveal, modest inhabited activity | What was built; cost paid once; production per round; current shortage | Render actual current-stage buildings and changed city condition before adding purely decorative building variety |
| Research | Distinct discovery marker, followed by the first real use of the unlocked capability | What was learned; what it now allows; which required feature is still unreleased | Current cultivation research and its farm/workshop consequence; future research art follows delivered mechanics |
| Trade and markets | Pending dashed link; accepted route; real delivery traffic; a visible stopped or blocked state | Who agreed; cargo each way; upkeep; which endpoint cannot supply; last actual delivery | Proposal/accept/stop correctness first, then one readable caravan scene. A proposal must never look like an active shipment |
| Expansion and geography | A party's route and a new settlement appearing, with an intelligible territorial change | Where it was founded; cost; what location makes possible | Expand only after a real supported founding command; do not decorate every empty region with fictional settlements |
| Culture and migration | Public gathering places, cultural links, later migration movement tied to actual population changes | What attracted people or influence; where the effect came from; consequences for both places | Ship a meaningful cross-city effect before using culture as a progress bar with celebration particles |
| Politics and alliances | Shared emblems, a treaty connection, visible common construction or contributions | The obligation, who accepted, who contributed, whether it is still functioning | Consent and actual ongoing cooperation before ceremonial summit cinematics |
| Conflict and military | Units with readable silhouettes; supply route; approach, clash and aftermath | Who initiated; where; supply cost; territorial or economic result | Supplied contest over an existing route or place, not a disconnected combat arena |
| World Director and environment | Local clouds, cracked fields, revealed supplies or damaged structures matching effects | What happened, affected place, immediate change, what the agents can respond to | Current quiet season, discovery and drought first. Earthquakes, UFOs and speculative booms remain future content until effects exist |
| Calendar and capability stages | Compact date tick; occasional century overview; a separate capability landmark | Ten years passed by the server clock; a new capability arrived because its actual requirements were met | Only authoritative six-minute clock ticks change years. Features and event/review calls do not double-add time |
| Industry and planetary networks | Larger production facilities, connected infrastructure and transport changing how the land works | Input needs, output, bottleneck and new dependency | Add an actual supply or production choice with each new visual era; dates alone never spawn modern infrastructure |
| Space and Mars | Earth launch site, outbound journey, supply link, later inhabited off-world location | What was launched, who supports it, supplies remaining and the actual milestone | Enduring horizon; build the relevant research, industrial and logistics dependencies before presenting a functioning colony |
| Victory, collapse and restart | A concise run-ending map recap; preserved landmarks in history; a clearly identified new world | Who met which world conditions or why all collapsed; what carries into the archive | A restartable service with archived runs. Do not erase the old run or imply unfinished victory systems already work |

These boundaries are directions for small successive features, not a request to implement every row at once. Culture, politics, research and economic success should ultimately be competing, interacting paths, not isolated meters decorated with separate fireworks.

## More juice, under the viewer's control

Offer a plainly named **Effects** setting with three presets:

- **Calm:** essential state transitions, static route/status marks, short fades, no automatic camera moves or shake.
- **Rich:** the default where reduced motion is not requested. Local construction reveals, visible cargo, environmental animation, event emphasis and optional follow-camera.
- **Cinematic:** longer major-event reveals, richer particles and more atmospheric camera framing. Still skippable and independent of agent speed.

Keep separate toggles for **Follow events**, **Camera shake**, **Sound**, and **Reduce motion**. Camera shake starts off. Sound starts off until intentionally enabled. Respect the operating system's reduced-motion preference unless the user deliberately changes the relevant preference; make the effective behavior clear. Reducing effects never removes factual event text, changes numbers, hides warnings or affects simulation outcomes.

Offer **Light / Dark / System** theme selection. Light uses the warm atlas base; dark uses a low-glare deep-blue/charcoal surface with legible map labels. Civilization colors and icon meaning stay recognizable across both. Do not simply invert every map texture. Themes, motion, camera and filters are versioned local viewer preferences, never authoritative world data.

Default to a rich world with quiet interface chrome. Reserve the largest spectacle for genuinely rare changes. Five simultaneous celebrations are less readable than one well-framed event with the other four available in the timeline.

## Words, icons and touch

- Write short everyday English: **Food running low**, **Waiting for Aster**, **Trade stopped**, **New farm**, **10 years passed**. Put technical terms and detailed accounting in inspection.
- Use emphasis for actor, action and important delta. Avoid a whole sentence in bold, color or capitals.
- Every important icon has a visible nearby label or a discoverable accessible name. Use consistent original SVGs rather than relying on platform-specific glyphs.
- A tooltip answers **What is this? What changed? Why?** Touch opens a persistent small explanation or sheet; it has a clear close action. Desktop hover can be an extra shortcut, never the only route to information.
- Permit keyboard navigation, visible focus and Escape to dismiss supplementary panels. Do not announce the entire resource ledger every round through an aggressive live region.
- On a phone, keep the map visible by default, use a compact top status strip and one bottom inspection sheet. Civilization selection is a compact row or menu. Do not stack every desktop panel over the map.
- Use at least 44 CSS pixels as our comfortable target for primary touch controls, with space between them. This is a design target, not a claim that every accessibility criterion uses that number.
- Keep a selected city or event visible when its sheet opens. Respect safe areas and both portrait and landscape. Test real narrow-height as well as narrow-width layouts.

## History that remains readable as the service grows

Newest changelog entry starts expanded; older releases start collapsed with a useful date/title summary. Each release explains what changed and gives a visible route to inspect or observe the feature when it is present. A release is not a world event and should not pretend to be one.

World history starts with a bounded recent window. Load older entries by cursor and group them by era or day as the history grows. When someone scrolls into the past, preserve their reading position and show **N new events** instead of moving their content. Choosing that indicator returns to the new material; it never resets the service.

Share paging, scroll-anchor and disclosure primitives across long lists. Keep world events, public agent action explanations and release notes semantically distinct. Do not publish private reasoning or raw internal development transcripts as a spectator feature.

Add variable-height virtualization when real list volume and measurements justify it. Preserve an accessible **Load older** route and test focus/scroll restoration. Do not build a complex virtualization framework for the current tiny changelog or block live authority on it.

## Ready successor outcomes

The orchestrator can split these into disjoint tasks with actual contracts and checks:

1. **Observe the real settlement world:** authoritative identities, cities, buildings and event captions replace sample geography/data; the connection mode and last known revision are honest. Depends on the live read API.
2. **Control presentation comfortably:** effects presets, light/dark/system theme, motion controls and a real BlaBla link; preferences survive a compatible reload. Can proceed alongside service work.
3. **Read a caravan story:** the first accepted trade and actual delivery are visible, while pending/blocked/stopped states stay distinct. Depends on consent-based trade.
4. **Read long histories:** newest release expanded, older releases collapsed, bounded event pages and preserved scroll while new events arrive. Depends on durable event history; measure before adding virtualization.
5. **Keep the map on modest devices:** an original 2D projection remains inspectable when WebGL is unavailable; it consumes the same data and semantic event descriptions.

Each outcome needs a real desktop and mobile viewing pass. Inspect at least one ordinary event, one meaningful change and one empty/error state. Check theme contrast and reduced-motion behavior using actual pixels. Record what is still unverified. The existing web unit tests do not prove these visual outcomes or that the game is exciting; live observation provides the next creative evidence.
