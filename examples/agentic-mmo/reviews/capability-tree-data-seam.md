# Full capability tree: canonical data seam

Actual gpt-6-astra/high, report-only current-source research. No UI, production, catalogue or gameplay edits. Creative confirmed the four primary labels and separate activity/admission overlays; Art is designing the spectator presentation against this seam.

## Useful result

Use one detached catalogue graph plus civilization research rows and selected-city building rows. Extract the existing research/build eligibility decisions into small canonical helpers consumed by both `availableActions` and the new projection. The UI must not copy those predicates or infer a missing prerequisite from absence in a temporary legal-action menu. The full tree includes all canonical entries, including prepared future data; it does not imply that every entry is playable.

The inspected catalogue has 9 technologies, 8 buildings, 32 features, 14 registered releases and 8 historical milestones. There are 9 explicit technology prerequisite edges and 8 technology-to-building prerequisite edges. The read-only enumeration is retained in `.blabla/scratch/map-capability-tree-data/catalogue-map.json`. These are source counts, not live-world unlock counts or performance measurements.

## Complete current technology/building graph

Stable IDs are the graph keys; display names come from content.

- Cultivation (`agriculture`, no prerequisite) leads to Water management, Kiln firing and Civic institutions; it also permits Terraced fields (`farm`) and Artisan quarter (`workshop`).
- Water management (`water-management`) leads to Irrigation works (`irrigation`).
- Kiln firing (`kiln-firing`) leads to Kiln (`kiln`).
- Civic institutions (`civic-institutions`) leads to House of learning (`academy`), Civic gathering place (`monument`) and Navigation. Fuel management requires both Civic institutions and Kiln firing.
- Fuel management (`fuel-management`) leads to Fuel yard (`fuel-yard`).
- Navigation → Industrialization → Planetary computing (`computing`) → Interplanetary logistics (`spaceflight`) → Orbital gateway (`launchpad`).

Use only `requires` arrays for prerequisite edges. Era columns are grouping metadata, not substitute prerequisite edges. Technology `era` is not checked by research choice eligibility. Science cost is the completion investment, not a required balance to select research. Current research is excluded from a redundant selection action; switching to a different legal target resets existing research progress in `commands.ts`.

Building `minEra` is a real requirement. Current paid recipes are irrigation, kiln, academy and fuel-yard. Base outputs and operating inputs must come directly from `BuildingDefinition`, alongside separate construction cost and one-time effects. Empty inputs mean no recurring resource recipe. Base output is before productivity and is not net stock gain. A constructed but paused or blocked building remains Done, with its actual enabled flag and last operation receipt shown separately.

## Four labels and independent facts

The confirmed primary semantics are:

1. Done: technology appears in this civilization's completed technologies, or this building appears in the selected city's buildings. Historical completion wins over presentation of a missing current feature; do not erase completed facts.
2. Planned: at least one required capability is absent from this world's `unlockedFeatures`. Explain “Waiting for an update.” Include the missing feature IDs. Separately distinguish support included in a registered release but not applied to this world from catalogue-only prepared content; a registered release alone is not proof of a deployed artifact or authorization to activate it.
3. Locked: required capabilities are applied, but a genuine prerequisite, building minEra, exact city requirement or shared construction resource requirement is unmet. Return the exact typed blockers and their current values.
4. Available: capability requirements are met. For current research, show the Researching overlay and actual progress rather than offer a duplicate research command. Legal action references are a separate field and can be empty during admission delay or an already selected research program.

Current research/progress and a recorded Next intention are overlays, not extra invented goals. Tactical budget, overdue strategy, stale observation time and game outcome are common admission notes. They must not relabel every structurally eligible node Locked. “Available” means capability eligibility here, not a guarantee that an action can be submitted at this instant.

Research rows belong to a civilization. Building rows belong to an exact owned city. A civilization-level count such as “built in 2 of 3 towns” can be derived for navigation, but cannot replace the selected city's status. No owned city selected should produce an explicit selection requirement rather than silently choosing another town. Site facts should reuse `siteProduction`/the existing detached town facts, not copied deposit or terrain tuning.

## Smallest proposed projection

A new pure module can export its types without changing persistent state. Proposed shape, subject to owner implementation scope:

- `CapabilityCatalogue`: technology/building descriptors keyed by stable typed IDs; prerequisite edges; required feature IDs; existing release IDs and compatibility edges; milestone descriptors and their actual conditions. Resource vectors are factored once and follow canonical `RESOURCE_IDS` ordering.
- `CapabilityView`: `revision`, explicit `observedAt`, `releaseId`, `civilizationId`, selected `cityId` or null, common admission/outcome facts, research rows and selected-city building rows.
- Row: `nodeId`, `status`, `blockers`, `choiceRefs`, and optional current research or actual operation facts. Blockers are discriminated data such as missing feature, missing technology, insufficient era, missing/unowned city, missing site, or construction resource shortage with resource/required/available. Do not derive these by parsing prose.
- `choiceRef`: index into the exact canonical action list supplied for the same seat/revision/timestamp, plus the exact action when the transport does not already provide it. Preserve original ordering and action shape. A reference is not executable after its observation context changes.
- `recordedIntent`: existing attached plan's observed/committed revision and at most two exact items/status/reason; expose only actually recorded records. No automatic plan generation or queued execution.

The projector should take the already generated canonical options for each requested seat to avoid a second full trade enumeration. Exact actions remain the authority. The semantic helper should report research/build eligibility and blockers before temporal admission; `availableActions` applies admission and omits completed/current-research duplicates as today. This is a small extraction within the existing rules, not a second legality pipeline. A construction helper must preserve specialized exact-city semantics and the old unspecialized first-eligible-city action behavior. Do not synthesize a cityId into historical untargeted actions.

For a full spectator sheet, catalogue facts are shared; selected civilization data needs 9 research rows and 8 rows for one selected city. Even displaying all 25 cities would have 200 building rows, not town-pair duplication. Do not eagerly generate every city's whole trade menu or multiply descriptions by all pair combinations. These are combinatorial counts, not measured CPU or byte claims.

## Release and milestone truth

Read current `state.releaseId`/`unlockedFeatures`, never `CURRENT_RELEASE`, for the inhabited world's status. `CURRENT_RELEASE` remains foundations-1 in source. The registered successor graph includes independent/plans/production branches before frontiers, specialization, recovery, civics, charters, endpoints, land transport and operating exchange. Compatibility edges are update dependencies, not research prerequisites or actor action permissions.

The catalogue-only feature IDs currently absent from every registered release are navigation, industrialization, planetary-networks, interplanetary-logistics, federations, cultural-networks, resilient-markets, supplied-conflict, anomalous-contact and speculative-markets. A world behind the latest registered release has additional Planned nodes. Resident capacity is still a separate prospective packet and must not be presented as implemented merely because its design/tests exist.

Land-path trade is already distinct from the still-planned Navigation technology. Do not mark Navigation Done or Available because land-transport is present.

Milestones are world-wide observed achievements. Done comes from `calendarMilestones`. `milestoneEligible` is the actual condition authority, with pending event context only during resolution. At a committed snapshot, use empty pending events and committed event counts; never fabricate pending events to produce progress. If detailed condition progress is needed, expose it from the existing `conditionMet` evaluator rather than implementing a second switch in the UI.

The actual near-term era bridge is first-harvest → roads-between-peoples → rise-of-states. First harvest needs a farm and one civilization with Cultivation; roads needs two active routes; rise-of-states needs two civilizations with Civic institutions and three active routes, plus its prior milestone and statecraft feature. `beyond-the-hearth` is a separate first-harvest branch requiring eight cities and total population forty; it is not a prerequisite to rise-of-states. Route activity is the retained gameplay fact, not simply a pending proposal or accepted promise. World year alone unlocks neither milestones nor research. Later milestone descriptions and conditions remain visible as Planned where features are absent.

## Recorded “Chose → changed → opens next” references

The public protocol already supplies accepted chronicle entries with transition, public provenance, events and start/end revision; history entries additionally carry the corresponding state. Filter `transition.kind === 'action'`, then use exact `command.action`, actor seat, commandId, actual recorded model and timestamp. Keep clock/strategy/release transitions distinct from model decisions, including upkeep preceding an action. A command's attached plan reason is available only when actually recorded; event cause text is an engine explanation, not an agent's private motive.

Suggested reference is `{commandId, startRevision, endRevision, seat, action, eventIds}` plus retained provenance kind/model and timestamp. No persistence addition is necessary. Research-start means a chosen program, not a discovered technology. Completion is supported by later state technology membership and completion events. Building completion has the accepted exact action and event tile, and subsequent history confirms the city's building set. For historical untargeted builds, use the recorded before/after history to locate the actual city; do not guess from today's city array.

“Opens next” should be a comparison of canonical capability rows before and after the selected actual transition, with prerequisite links. Say which nodes became structurally available, not that the civilization intends to choose them. A later research completion can be connected to the recorded start without assigning every intervening economy change to that one choice. If required history is missing or paginated, display that limit; recent events alone cannot prove a complete causal chain. Current operation results describe actual paid/produced values at their recorded round, not a guaranteed outcome of the preceding build choice.

Public chronicle fields were inspected read-only in `server/public-protocol.ts`, and actual research/build state effects in `commands.ts`/`economy.ts`; they are supporting source mapping, not additional compiled-check coverage. No API modification is proposed here.

## Bounded next implementation and verification

Owner scope should cover one canonical eligibility extraction and pure capability projection, with Art consuming only the resulting data. Prospective parity tests should show unchanged exact legal actions for old/new releases and all seats; distinguish current research, unavailable science balance, true building era/cost/city blockers, admission delays, Done-but-paused operation, planned Navigation and actual recorded choice provenance. Verify detached output, exhaustive catalogue nodes/edges and matching old snapshot behavior before UI integration.

This report's declared content test is a catalogue-integrity baseline only. It does not prove the proposed projection, render a tree, test a new schema or authorize activation. Resident RED and the urgent server checkpoint remain independently frozen.
