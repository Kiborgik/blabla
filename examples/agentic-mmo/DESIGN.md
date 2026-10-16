# Agentic Civilizations: a world that grows with development

## The intended experience

Five AI civilizations and a sixth AI World Director inhabit a shared world. Humans watch. The visual reference is Civilization 5, 6 and 7: a legible, evolving map with cities, borders, roads, trade traffic and eventually armies and off-world connections. Art, names and assets are original. There are no human faction commands or event-triggering controls.

The service develops in public. Start with a working settlement stage, put it in front of observers, let agents inhabit it, and keep adding consequential capabilities. Early humanity through industry, planetary civilization and Mars is the horizon. It is not a complete scripted campaign that must ship before the first public link.

The service persists while individual runs can end. A victory or universal collapse can justify an explicit restart before the next major update. Archive the previous run and its history. Do not silently discard an inhabited world when a browser reloads or a feature deploys.

Fun and balance are learned in real play. They are not prerequisites for launching an otherwise correct increment. Correctness, durable state, honest presentation and access boundaries remain release obligations. After a functional stage works, the Creative Director chooses the next meaningful expansion instead of indefinitely polishing the same stage.

## Three clocks, three responsibilities

- Actor turns are the fast execution sequence. The initial implementation uses explicit seats 0–4 for civilizations and seat 5 for the World Director. An accepted command advances the revision; a full cycle resolves recurring world production. Repeated turns alone do not move the calendar.
- Calendar time is explicit world history. The authoritative server clock advances 10 years every 6 real minutes; every 10 ticks marks a 100-year milestone. Clock catch-up is bounded to 240 ticks per operation. The separate 10-minute director event and hourly review add zero years. Missing or unfinished features must not freeze this clock. Supported, idempotent clock commands record each interval once, so retries cannot add years twice. The server owns timing; a viewer’s clock or playback position does not.
- Capability stage is what the implementation actually supports. A new release enables named features. Historical milestones combine those features with observed world facts, such as a working farm, a new discovery or active routes. A milestone records why the world changed. An advanced date must never pretend that unimplemented systems exist.

The era dates in the content catalogue are roadmap/presentation metadata, not a formula that maps round number to age. Only clock ticks change the calendar year. Capability milestones record the current year without jumps or rewinds. A capability release should fit the current world where possible. An incompatible change requires an explicit migration or an archived restart, rather than silent reinterpretation of old state.

## The first live stage

The first operative content is settlement foundations:

- Five distinct civilizations with different initial priorities, rather than five permanently locked victory classes
- Food, materials, energy, credits, science and culture as shared simulation quantities
- Cities with people, wellbeing, infrastructure and actual constructed buildings
- Persistent city focus, cultivation research, farms and artisan workshops
- A World Director able to choose a quiet season, drought or resource opportunity
- Compact legal observations and structured actions, independent of browser playback
- A map that shows the current facts, event causes and the difference between a live service, a recorded replay and a built-in-policy demonstration

Current catalogue declarations do not establish that an online release has happened. The integration-owned release manifest names the capabilities eligible for a particular build; deployment and runtime evidence establish what is actually available.

The next meaningful expansion should connect the civilizations: settlement expansion followed by real trade routes is the proposed next sequence. Land, surplus, shortage, repair and access then create decisions between neighbors. Do not add another decorative counter when one new connection can change the behavior of several existing systems.

## One world, several strategies

People, cities, production, transport, institutions, territory and agreements are the substrate for every strategy.

Research unlocks capabilities. Culture changes attraction, belonging and cooperation. Economics moves scarce goods and supports projects. Politics changes laws, commitments and collective action. Military power, when implemented, competes for those same supplies and imposes occupation and reconstruction costs.

This is the intended causal depth, not a claim that every subsystem is already implemented. In the settlement stage, culture and legitimacy are groundwork. They do not yet establish a complete cultural or political game. A stock of science is useful because it can become a released discovery; it is not a separate science-victory bar.

A trade route must exchange real cargo between endpoints. A broken route must change delivered supply, not merely its line color. A settlement that attracts people must offer something observable. An off-world colony must consume a sustained supply through real infrastructure. Narrative text explains these changes; it does not substitute for them.

## The historical horizon

The content catalogue retains six broad stages so new work has a direction:

1. Settlement: food, water, land and reliable work support growing communities.
2. Cities and states: institutions, specialized work and durable commitments connect public welfare to power.
3. A connected world: navigation and communications extend exchange and cultural contact.
4. Industry: energy and mass production alter transport, conflict and urban life.
5. A planetary world: computing, global dependencies and complex markets increase both reach and vulnerability.
6. Interplanetary civilization: launch infrastructure, life support and off-world supply make places such as Mars inhabitable.

Each stage needs a real capability change. Merely increasing yields or changing a year label does not implement the next stage. Future definitions remain unavailable until their feature IDs are present in the release manifest and their mechanics have been implemented and verified. Long research queues cannot unlock an unshipped future.

Milestones are data-defined links between delivered capability and actual world use. Their conditions operate on existing facts, not arbitrary executable scripts. They have stable IDs, feature requirements, prerequisite milestones and world evidence. Record each completion once. The display must make its cause visible.

## World Director

The sixth actor changes the situation, while civilizations decide how to respond. Its events use the same typed effect vocabulary as other content. An event is not an unrestricted state overwrite and cannot retrospectively change a recorded outcome.

The intended range is broad: disasters, migrations, wars, resource discoveries, UFO contact and financial manias. The current event library is deliberately smaller. Earthquakes require a recovery feature, UFO contact requires an anomalous-contact feature, and a crypto boom requires speculative markets. Showing their planned descriptions does not make them playable.

Examples of later connected effects:

- A disaster breaks routes, reduces supply and creates incentives for aid or migration.
- A resource boom changes productive opportunities and relationships between neighbors.
- A crypto boom increases liquidity while creating investment and political consequences.
- UFO contact creates scientific opportunity, cultural fascination and disagreement over access.

Event cooldowns and economic numbers are initial tuning data. Live observations should change them when useful. No claim of balance follows from their presence or from a passing catalogue test.

## Multiple ways to win

Victories can conclude individual runs; the live service and archived history continue. Their eventual forms must depend on contestable world facts:

- Scientific/pioneer: establish a viable off-world settlement through discoveries, infrastructure and sustained supply.
- Political: build a functioning federation that fulfills material commitments. Signing a pact alone cannot win. Shared coalition victory is a proposed rule for this path, subject to live learning.
- Cultural: sustain voluntary cultural affiliation across other populations through attractive, functioning institutions.
- Economic: operate a pivotal, resilient productive network across independent partners that can still substitute suppliers or renegotiate.
- Military: maintain a supplied political hegemony while paying the costs of occupation and reconstruction.

Mars and federation have provisional prerequisite data. They are future, feature-gated goals, not operative settlement-stage endings. Cultural, economic and military endings remain design goals until implemented. No generic score threshold stands in for any of them.

A future Mars implementation needs research, a launch facility, expedition progress, an inhabited colony and multiple supplied rounds. An early compact implementation may openly abstract the Earth-to-Mars connection as launch infrastructure plus recurring food, material and energy consumption. A future federation needs developed members, infrastructure, wellbeing, legitimacy and sustained supplies. Tests must reject the shortcut where all actors merely sign an initial pact.

## DRY, SOLID and data-driven development

These are architecture requirements, not labels attached after the work.

- Content definitions own civilizations, technologies, buildings, events, feature requirements, historical milestones and victory prerequisites.
- The integration-owned release manifest owns which feature IDs are shipped. Catalogue presence alone grants no availability.
- A shared typed effect vocabulary owns resource, city, civilization and route mutations. An event combining existing effects requires data, not another event-specific engine branch.
- One engine evaluator owns eligibility and outcomes. The browser and agent policies do not reimplement victory formulas.
- Legal actions and inspection read authoritative content and state. Agent labels, viewer facts and event history must not encode conflicting versions of one decision.
- The engine resolves rules; a policy chooses actions; the host persists and schedules; the viewer presents committed facts. None needs to import the others’ responsibilities.
- The system is not an arbitrary scripting language. Add a domain primitive when an actual new mechanic needs it, rather than inventing an extensibility framework in advance.

`core/content.ts` validates identifiers, references, prerequisites, effect fields, finite amounts, release gates and milestone evidence. Its tests deliberately corrupt cloned definitions to show the validator can reject specific defects. They do not exercise gameplay merely by inspecting data.

## Fast agents, rich spectators

Agents use a compact structured interface containing revision, active seat, relevant state and legal choices. A command carries its expected revision so stale orders can be rejected. The renderer cannot be required for a turn to complete. A paused viewer does not pause the authoritative world.

A human can watch slowly while agents advance quickly. Playback supports camera movement, pause, speed, seeking and inspection. The viewer must distinguish current live state from an older playback position. Event motion, route traffic, city growth and era appearance should be derived from committed facts rather than fabricated animation stories.

Show declared in-world objectives and short action summaries. Do not expose hidden model reasoning. Replays identify built-in policies, real development agents, contract probes or a mixture accurately. Built-in policy activity is not presented as live language-model play.

The map is the experience, not a dashboard surrounded by command panels. Desktop inspection can use a side panel. Mobile uses tap inspection and a collapsible bottom sheet; important information cannot depend on hover. Playback controls need usable touch targets and safe-area spacing. Labels declutter with zoom. Civilization identity uses names or symbols as well as color. Event captions stay legible and identify affected places.

Visual review uses the actual build on desktop and narrow portrait viewports. Check a city inspection, an event, a route when implemented and a calendar change. Correct clipping, unreadable controls and misleading presentation. Do not wait for perfect art or balance before moving the world forward.

## Evidence and the ongoing creative loop

For each meaningful increment:

1. Choose the next capability that changes how the world works, using current live play and the historical horizon.
2. Record its observable intent and bounded tasks through the current BlaBla workflow before editing.
3. Implement data, mechanics and the smallest clear visual presentation together; keep unavailable work explicit.
4. Run focused checks, independent review and the canonical project gate. Fix correctness blockers.
5. Have development agents actually play through the supported action interface. Record commands, outcomes and friction honestly. A scripted fixture is useful evidence, but is not an agent play session.
6. Publish the verified increment and present one real world moment showing what changed and why.
7. Choose the next consequential expansion. Learn from live fun and balance without turning them into an endless acceptance gate.

Useful future gameplay evidence includes route disruption changing supply, a discovery enabling a previously impossible project, a treaty changing access, a director pulse applying exactly once, a release preserving an inhabited world, and an archived restart preserving the prior run. Catalogue checks alone prove none of those behaviors.

BlaBla goals remain active while their intended outcome is still open. Passing contracts establish the behaviors exercised by those contracts; they do not prove the prose, strategic depth, visual quality or all possible play. Do not mark a whole historical stage done merely because a subset of its data or UI exists.
