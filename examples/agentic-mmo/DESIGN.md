# Agentic Civilizations: a world that grows with development

## The intended experience

Five AI civilizations and a sixth AI World Director inhabit a shared world. Humans watch. The visual reference is Civilization 5, 6 and 7: a legible, evolving map with cities, borders, roads, trade traffic and eventually armies and off-world connections. Art, names and assets are original. There are no human faction commands or event-triggering controls.

The service develops in public. Start with a working settlement stage, put it in front of observers, let agents inhabit it, and keep adding consequential capabilities. Early humanity through industry, planetary civilization and Mars is the horizon. It is not a complete scripted campaign that must ship before the first public link.

The service persists while individual runs can end. A victory or universal collapse can justify an explicit restart before the next major update. Archive the previous run and its history. Do not silently discard an inhabited world when a browser reloads or a feature deploys.

Fun and balance are learned in real play. They are not prerequisites for launching an otherwise correct increment. Correctness, durable state, honest presentation and access boundaries remain release obligations. After a functional stage works, the Creative Director chooses the next meaningful expansion instead of indefinitely polishing the same stage.

## Action cadence, history and delivered capability

- Civilizations act independently and may submit tactical commands at the same time. A bounded per-actor allowance prevents spam without making one actor wait for another. Shared server economy beats resolve standing production and commitments without an all-agent quorum. The delivered successor implements this behavior, while the inhabited foundations release remains sequential pending explicit activation permission: seats 0–4 and a Director turn resolve one full cycle. That historical evidence remains valid. Accepted commands advance revision; neither command count nor a viewer advances the calendar.
- Calendar time is explicit world history. The authoritative server clock advances 10 years every 6 real minutes; every 10 ticks marks a 100-year milestone. Clock catch-up is bounded to 240 ticks per operation. Routine 10-minute director passes and hourly reviews add zero years by default. A deliberate feature or event turning point may additionally advance history through a separately identified, explained operation. Missing or unfinished features must not freeze this clock. Supported, idempotent clock commands record each interval once, so retries cannot add years twice. The server owns timing; a viewer’s clock or playback position does not.
- Capability stage is what the implementation actually supports. A new release enables named features. Historical milestones combine those features with observed world facts, such as a working farm, a new discovery or active routes. A milestone records why the world changed. An advanced date must never pretend that unimplemented systems exist.

The era dates in the content catalogue are roadmap/presentation metadata, not a formula that maps round number to age. The regular clock and deliberate historical advances are distinct causes. A deliberate advance records its feature or event evidence, reason, old and new year, and stable identity exactly once. It never rewinds time, rebases the regular clock epoch or consumes regular clock ticks. Capability milestones normally record the current year; an explicit associated historical advance is a separate operation, never an implicit side effect of a label. A capability release should fit the current world where possible. An incompatible change requires an explicit migration or an archived restart, rather than silent reinterpretation of old state.

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

Compatible releases can enter the inhabited world without resetting it. Independent tactical actions, timed shared production, consensual trade, bounded action plans, operating recipes, conserved founding, exact per-city focus/construction, recoverable city damage, culture-funded learning/fuel production, joint repair charters and exact trade-town choice are implemented and source-reviewed. The inhabited world still uses foundations 2 because explicit successor activation is awaiting owner permission. Actual online trade, recipes, founding and repair need their own compatible application and play evidence. Land, surplus, shortage, repair and access then create decisions between neighbors. Do not add another decorative counter when one new connection can change the behavior of several existing systems.

## Tactical choices and strategic commitments

Every system needs both layers. A fast tactical choice changes an immediate situation; a slower strategic commitment creates obligations, accumulates work or changes the available future. These are simulation responsibilities, separate from six-minute calendar ticks and human animation speed.

- Production: change a city focus or spend supplies now; specialize its buildings and dependencies over several rounds.
- Research: choose or redirect a project now; commit productive capacity until a discovery opens a new action.
- Trade: propose, accept, refuse or stop an agreement immediately; receive due deliveries and live with a continuing supply dependency across strategic beats.
- Culture: choose a festival, patronage or response when those actions exist; institutions and recurring conditions gradually change affiliation and migration.
- Politics: make or withdraw a specific commitment now; shared projects and sustained fulfilled promises create durable collective power.
- Conflict: maneuver, supply or contest access tactically; mobilization, campaigns, occupation and reconstruction carry slower material and political consequences.

The locally implemented trade design delivers every four completed economy rounds. The concurrent successor makes those rounds shared timed economy beats rather than completed actor cycles. Standing deliveries first become due on a strictly later due beat after acceptance. Future projects can use this shared cadence where appropriate. This is provisional pacing to learn from live play, not a claim of balance. Local implementation does not activate trade in the online world: that needs a delivered release and an explicit compatible application. Current settlement production remains per completed sequential round until the explicit concurrent transition is delivered. Initial successor pacing is one accepted civilization action per ten-second window and one production beat per sixty seconds, with trade every fourth beat. These are data-defined tuning values, separate from the six-minute historical clock. An idle civilization does not stop time or production; its standing focus and accepted obligations continue.

Each civilization keeps a short action plan: the current intention and at most one follow-up. The plan describes what its model intends to do; it does not execute itself or reserve a target. An action moves from queued to currently legal, submitted and completed, or to a blocked, invalidated or failed result with a concrete reason. The model inspects that result and the changed world before acting again. The next item must be revalidated; an obsolete plan cannot silently continue. Persistent strategic agreements and research are distinct from this two-item tactical lookahead. The development team's twelve-hour feature queue is also a different layer.

## One world, several strategies

People, cities, production, transport, institutions, territory and agreements are the substrate for every strategy.

Research unlocks capabilities. Culture changes attraction, belonging and cooperation. Economics moves scarce goods and supports projects. Politics changes laws, commitments and collective action. Military power, when implemented, competes for those same supplies and imposes occupation and reconstruction costs.

This is the intended causal depth, not a claim that every subsystem is already implemented. In the settlement stage, culture and legitimacy are groundwork. They do not yet establish a complete cultural or political game. A stock of science is useful because it can become a released discovery; it is not a separate science-victory bar.

A trade route must exchange real cargo between endpoints. A broken route must change delivered supply, not merely its line color. A settlement that attracts people must offer something observable. An off-world colony must consume a sustained supply through real infrastructure. Narrative text explains these changes; it does not substitute for them.

## The next connected choices

Trade now has a concrete local contract: one pending offer and one enabled agreement per civilization pair; exact food/material terms are recorded when offered; the recipient chooses whether to accept; either partner can stop future deliveries. The proposer pays construction only on acceptance. A due delivery checks each partner's combined cargo and transport cost before spending anything. A shortage stops that whole exchange and records who could not supply it. Existing accepted terms do not change when a recipe is edited in a later release.

Consent and delivery are different facts. An accepted route can be waiting for its first delivery or temporarily unable to deliver. Its last shipment result does not erase the agreement. The map should show an offer, an agreed connection, a completed delivery and a blocked connection differently. Moving goods must correspond to an actual delivery record.

The source-implemented geography increment is useful founding, still awaiting online activation. Three people move from an explicit owned source city to a legal new site, leaving at least three behind. Supplies and people transfer atomically; creating a city must not create people from nothing. Existing settlement costs remain canonical data. A small released terrain-output table makes grassland useful for food and forest useful for materials. The engine reads the same table that observations explain. Preserve the inhabited map, city identities and stocks when applying the release; do not regenerate the world to manufacture variety.

Founding is the immediate tactical choice. The resulting location, divided population, buildings and ongoing output are its strategic commitment. The implemented separate increment lets an actor choose focus and construction for a named owned city, so a food-producing home and a material-producing frontier can serve different purposes. Initial civilization-wide stockpiles remain explicit; city-to-city warehousing, transport labor and a full market are later capabilities, not implied by a road animation.

The implemented recovery successor spends five materials and two energy to remove up to 25 damage from one exactly named owned city. A smaller remaining injury still pays the stated cost and restores only the actual damage. Repair changes subsequent productivity; it does not create population, rebuild missing structures or retroactively restore old infrastructure. The newly released earthquake effect set damages cities and routes without permanent infrastructure loss. Earlier releases keep their historical effect selection. Release application remains separate from this source capability.

These priorities respond to actual opening play: by round 2, four civilizations had selected research focus, two had completed Cultivation, and no buildings or routes yet existed. This short sample does not prove that research is overpowered. It reveals the next useful choices to create and observe: use a discovery, protect food, found on a different site, or exchange a surplus. Do not force different strategies through permanent civilization classes.

## Keep research and buildings ahead of play

The playable content pool must stay ahead of each civilization's immediate plan. Maintain useful choices now, connected unlocks prepared for the next delivered stage, and farther ideas in the rolling development queue. The two-item limit applies to an actor's immediate intentions, not to the technology tree or building catalogue.

Completing a discovery should open a meaningful action and leave an understandable next direction. The current settlement release has only Cultivation; once it is complete, further research has no released target. That is an observed development gap to address promptly, not proof that future catalogue entries are already playable. Do not hide the gap by relabeling stored science as progress toward an unavailable technology.

The source-implemented production branches are Water management leading to irrigation works, and Kiln firing leading to a kiln. One consumes materials to support more food; the other consumes energy to produce materials. Their purpose is to change what a city can supply and what it must obtain from others. Both depend on one shared, data-defined building operating rule. A civilization can pause or resume a named owned building immediately; the next strategic beat pays its inputs and produces its output, or records why it could not operate. The shared rule and registered production release are implemented and source-reviewed; the inhabited foundations release still keeps these unlocks unavailable until explicit compatible activation.

Operating inputs come from stocks available at the start of the economy beat. Allocate them in stable city-ID and building-ID order, checking every input before spending any for that recipe. A paused or blocked recipe consumes nothing and produces nothing. New output cannot fund another recipe during that same beat. The existing productivity calculation affects outputs, while the declared inputs remain exact. Existing farms and workshops keep their current no-input production through this same rule. The initial pair consumes materials or energy, not food; introducing food-consuming industry requires a separate explicit decision about household supply priority.

Construction, enabled operation and an actual productive result are distinct facts. A built kiln remains on the map while paused or short of energy. Fire and output markers follow a recorded operating result. Agents see the required inputs, current operating choice and latest reason; humans can inspect the same facts without changing them. This bounded choice does not introduce a general production scheduler or per-city stockpiles.

Keep a small connected pool, not an enormous ornamental tree. Reuse existing civic institutions and the house of learning when their next-stage mechanics become useful; navigation must open actual reach. Review the pool after each discovery, released feature and observed dead end. A short gap can be reported honestly while the next capability is built, but it should become a concrete successor rather than indefinite polishing of the completed stage.

The source-implemented civic slice connects culture to useful research through the existing paid-operation boundary. House of learning inputs are two culture and one credit per beat for three base science; Civic gathering places supply culture. Fuel management is the next useful discovery, leading to a Fuel yard that converts two opening-stock materials into three base energy. Energy then supports kilns, transport upkeep and repair. These are implemented source data, not current live capabilities or established balance. Construction vectors, exact inputs and base outputs must be visible before building, from one canonical formatter rather than manually repeated numbers.

The civic slice reuses the single research target, owned-city building actions, opening-stock allocator, pause controls and historical receipts. It does not add a separate civic queue, specialist simulation or another currency. Statecraft now belongs to the registered settlement-civics-1 successor, whose legal engine path has been independently reviewed. The prior absence of statecraft from older registered releases permitted the original prepared-definition change; this new released definition must now be preserved. Never rewrite a previously released definition or historical event just to align new copy. The roadmap specifies the reachable era transition and a real next discovery; catalogue acyclicity alone is insufficient proof of the playable chain.

## A first voluntary public commitment

The source-implemented political choice is a joint road-repair charter between the two partners of an existing accepted trade route. Both civilizations need Civic institutions and an owned Civic gathering place. Each promises two materials and one energy; two strategic economy beats after acceptance, their combined contribution removes up to 25 damage from that exact route. These are provisional tuning values in the registered source capability, whose legal journey, focused counterexamples and independent review are accepted. They are not currently available in the inhabited world.

This creates a choice between paying for immediate unilateral repair, sharing a cheaper material bill with a willing partner and waiting, or keeping supplies for other work. The agreement has a tangible transport purpose. It does not grant an abstract political score or constitute a federation victory. Its identity includes the existing route agreement, so replacement consent cannot inherit an older pledge.

A proposal records immutable terms and costs nothing. The recipient accepts or declines. Acceptance checks the current route, institutions and both partners' ability to pay, but does not reserve or collect their stocks. Either partner can withdraw before the due resolution. At that resolution, all required contributions must still be available before either is collected. A shortage or invalidated route ends this attempt with a concrete reason and no partial payment; another attempt requires fresh consent. Pending invalidation is realized on a strategic beat, while committed projects revalidate at their recorded due beat unless cancelled first. Ordinary actions do not silently resolve a project. The roadmap specifies bounded expiry, target checks and resolution order.

Resolve this first project after ordinary production, upkeep and trade for the beat. It uses the stocks remaining then, so new output may fund the project, but completed repairs cannot retroactively cause a shipment earlier in that beat. This is a one-shot public commitment, distinct from the existing opening-stock recipe allocator. Repair changes route condition only; an actual subsequent due delivery establishes renewed cargo flow. Observers see what was promised, whether each party paid, the actual damage change and the later delivery separately.

Keep only a small bounded set of pending or committed projects in the current world; preserve completed, failed or withdrawn outcomes in real history. Reuse the established consent and exact-payment concepts without adding a generic treasury, tax system or automatic agent planning service. The two-item actor plan still describes immediate intentions, while an accepted project is a persistent strategic commitment.

## Make the connected world geographical

Exact consenting towns and the subsequent deterministic land-path interval are now implemented and independently source-reviewed. The land core and hosting packets are closed; their retained path is a periodic exchange quote, not a physical caravan journey. Older releases keep their recorded first-city or exact-town abstract behavior. A nearby specialist can offer a faster interval than a distant partner. These source capabilities remain unavailable in the inhabited foundations release until separately authorized application.

The bounded design in `reviews/connected-transport-geography.md` uses equal-cost adjacent land edges, excluding ocean and mountains, with stable shortest-path selection and open civilian transit across current borders. New proposals quote a versioned ordered path and complete cadence before consent. The first exchange is due at acceptance beat plus that cadence, then repeats on the same interval. Existing atomic cargo/upkeep checks remain authoritative; nothing departs or is debited early. Existing accepted agreements and unexpired older offers retain their original abstract terms and scheduling, with no invented historical road.

One breadth-first tree per source town serves candidate partners and recipes. Structured quotes expose the exact path and interval without repeated path prose. Current provisional data uses two land edges per beat with the recipe cadence as a floor. In the legal local twenty-beat comparison, a four-edge route at cadence four makes five exchanges and a ten-edge route at cadence five makes four. This establishes a real timing consequence, not balance or live activity. Retained quote topology and agreement identity survive persistence; current impassability blocks an attempt without silently rerouting or rewriting old terms.

The actual eight-seed probe found every initial capital pair land-connected, including all walkable inhabited-seed 1701 land. Ocean is confined to map edges. Navigation must eventually enable a genuinely unavailable connection and demonstrate real delivery; a technology label, three old land routes or a decorative ship cannot establish new reach. This does not authorize regeneration, a restart or a world expansion. Continue the useful land-logistics increment while preparing a later connected-world capability with honest geography.

## Connect imports to productive choices

The next small economic choice is one additional immutable recipe, Energy for materials, through the same exact-town offer, consent, stop and due-delivery rules. Its exporter sends four energy and the importer sends three materials; each also pays one energy transport upkeep and earns two credits. The proposer pays the existing six-material/eight-credit construction cost once on acceptance. The land quote determines the actual interval. These are provisional catalogue values, not a promise of continuous kiln supply or balanced prices.

Both complete cargo-plus-upkeep vectors must exist before either side receives anything. Imported energy arrives after the opening-stock operating allocation, so it can support a later kiln beat but cannot retroactively supply an earlier blocked operation. The one-agreement-per-pair limit makes retaining food supply, finding another fuel partner, pausing work or investing in a local fuel yard actual alternatives. Changing a partner's recipe requires stopping and obtaining fresh consent; old offers and agreements remain unchanged.

The dedicated legal and separately labeled scarcity witnesses are author-READY, with independent combined review still pending. The legal due exchange confirms gross vectors without forged stocks. In the synthetic scarcity branch after a legal kiln-and-consent prefix, import leaves energy 4.76 versus 1.76 in the legally stopped control; the next beat pays two energy and produces 3.06 materials only on the importing branch. This is useful causal evidence at the operation boundary, not naturally reached scarcity or live model play. Keep the approved design in `reviews/operating-resource-exchange.md` as the detailed handoff; no additional resource recipes are required before this one can be observed.

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

Before every scheduled event, the coordinator brings the current authoritative snapshot to the Creative Director. The Director selects a supported event, target, purpose and result to inspect; application is verified afterward. Routine event consultation does not automatically add calendar years. A meaningful extra historical advance must have explicit evidence and a distinct idempotent record.

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

Agents use a compact structured interface containing revision, actor admission, relevant state and legal choices. A sequential historical release exposes its active seat; the independent release exposes each actor's own opportunity instead. A command carries its expected revision so stale orders can be rejected. The renderer cannot be required for a turn to complete. A paused viewer does not pause the authoritative world.

The source-reviewed `compact-trade-v1` core view factors canonical town and current recipe facts while retaining every complete ordered action and all stored consent snapshots. The ordinary view stays compatible. Its fixed 25-city fixture falls from 96,247 to 52,378 UTF-8 JSON bytes; its five-city fixture grows from 10,660 to 11,094. This measures payload size only: current projection still creates the ordinary observation first. Explicit CLI, JSONL, HTTP and MCP selectors are now independently source-reviewed: invalid formats refuse early, default wrappers stay compatible and every indexed typed action survives. Local response-body measurements are recorded separately in `reviews/compact-observation-transports.md`; actual deployed native-tool discovery remains a separate check. Land quotes change the workload: their fixed 25-town, 100-proposal compact fixture is 78,468 bytes after the structured-quote correction, versus the earlier repeated-prose 130,504 bytes. These are different fixtures from the initial compact baseline, not a combined speed claim. The two-item actor plan remains unchanged and no automatic execution or world release follows from choosing an observation format.

The new route-result stream is independently source-reviewed. Ordinary and route effects share one narrow or at most three desktop slots. Exact-town stationary marks follow recorded delivery or actual repair; cargo, transport payments, commerce and damage reduction remain separate. Initial load, repeated polls and return from history do not replay a backlog. New synthetic cue pixels are still pending, and no live route receipt exists in foundations 2.

A human can watch slowly while agents advance quickly. Playback supports camera movement, pause, speed, seeking and inspection. The viewer must distinguish current live state from an older playback position. Event motion, route traffic, city growth and era appearance should be derived from committed facts rather than fabricated animation stories.

Show declared in-world objectives and short action summaries. Do not expose hidden model reasoning. Replays identify built-in policies, real development agents, contract probes or a mixture accurately. Built-in policy activity is not presented as live language-model play.

The map is the experience, not a dashboard surrounded by command panels. Desktop inspection can use a side panel. Mobile uses tap inspection and a collapsible bottom sheet; important information cannot depend on hover. Playback controls need usable touch targets and safe-area spacing. Labels declutter with zoom. Civilization identity uses names or symbols as well as color. Event captions stay legible and identify affected places.

Humans can choose visual intensity and light, dark or system theme. Reduced motion takes precedence over spectacle. Simple English, consistent icons plus color, clear emphasis, and touch-accessible explanations make the same facts readable at different levels of detail. Live.6 delivers the theme/effect settings and tap/keyboard resource guide. Its supported narrow and desktop pixels were reviewed; this does not establish every smaller device or WebGL behavior.

The dedicated Astra Art Director owns visual implementation and reusable original assets; the Creative Director supplies the gameplay meaning and event direction. New server and multiplayer work belongs to the Astra server-owner role.

Visual review uses the actual build on desktop and narrow portrait viewports. Check a city inspection, an event, a route when implemented and a calendar change. Correct clipping, unreadable controls and misleading presentation. Do not wait for perfect art or balance before moving the world forward.

## Evidence and the ongoing creative loop

For each meaningful increment:

1. Choose the next capability that changes how the world works, using current live play and the historical horizon.
2. Inspect the relevant current systems and applicable primary references or prior verified research. Record the chosen approach, observable intent and bounded tasks through the current BlaBla workflow before editing.
3. Implement data, mechanics and the smallest clear visual presentation together; keep unavailable work explicit.
4. Run focused checks, independent review and the canonical project gate. Fix correctness blockers.
5. Have development agents actually play through the supported action interface. Record commands, outcomes and friction honestly. A scripted fixture is useful evidence, but is not an agent play session.
6. Publish the verified increment and present one real world moment showing what changed and why.
7. Choose the next consequential expansion. Learn from live fun and balance without turning them into an endless acceptance gate.

Useful future gameplay evidence includes route disruption changing supply, a discovery enabling a previously impossible project, a treaty changing access, a director pulse applying exactly once, a release preserving an inhabited world, and an archived restart preserving the prior run. Catalogue checks alone prove none of those behaviors.

Each hourly creative review inspects the actual mission, goals, systems and process through current BlaBla routes, compares them with the latest owner intent and observed world, and proposes specific changes to the orchestrator. Update affected records rather than rewriting all project memory on a timer. Preserve the distinction between executable evidence, semantic review and future intent.

A feature iteration also ends with a short goal-directed reflection: what new decision or consequence it creates, what real gap or opportunity the evidence reveals, the smallest useful authorized successor, and why that comes next. A concrete blocker, genuine goal-completion recommendation or an honest no-useful-successor reason is allowed. Do not manufacture tasks or count ideas to appear creative. Existing goal/outcome review owns acceptance; a reflection receipt establishes an accountable claim, not semantic truth.

BlaBla goals remain active while their intended outcome is still open. Passing contracts establish the behaviors exercised by those contracts; they do not prove the prose, strategic depth, visual quality or all possible play. Do not mark a whole historical stage done merely because a subset of its data or UI exists.
