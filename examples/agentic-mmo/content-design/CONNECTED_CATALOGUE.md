# Connected Civilization catalogue: first hearths to Mars

Design version 1 · 16 October 2026 · Task `design-connected-history-to-mars`

## Decision and boundary

Use **Civilization VI as the coherent mechanical baseline**, with the specifically identified Gathering Storm extensions for consumable strategic resources, electricity, climate and Congress. Do not mix Civilization V social-policy rules or Civilization VII age resets, town conversion and commanders into the same system. The catalogue below specifies the whole requested historical horizon now. Its quantities are original, provisional game tuning, not a transcription of Firaxis balance data.

The machine-readable companion is [catalogue.json](catalogue.json). It has 422 stable records across every system, explicit prerequisite references, costs, work, effects, gates and cross-system uses. It is a design input for implementation. **It is not loaded by the game and does not activate any capability.** Its `legacyRuntimeSnapshot` preserves the actual small source catalogue separately. Each card names an explicit designed capability gate, listed in `capabilityPlan`; those IDs are proposals to register through the normal release workflow, not existing engine flags. A live counterpart flag means that an earlier implementation with that name exists; it does not mean this full proposed card has been applied.

The bounded current-world reference is revision 405, round 190, era 1, year −8530, clock tick 106, release `settlement-decisions-1`, observed before this design work. Later Director ticks are ordinary live history. The world has real recurring research/construction, paid operating buildings, consented trade, repair and civic institutions. Research has exhausted the released pool. Functional coastal founding has a source-level legal witness and awaits its delivery path; resident support is source-reviewed and not asserted live here. A future catalogue cannot be used to call that exhausted live pool complete.

## Inspected primary references

- [Official Civilization VI manual](https://downloads.2kgames.com/civilization/vi/manuals/eu/CIV_VI_25TH_ONLINE_MANUAL_ENG.pdf), downloaded and inspected: geography/combat pp.72–83, cities/production pp.93,95,97–98,103–104, research/civics pp.107–113, government pp.122–123, diplomacy pp.140–143 and victories pp.147–148. The retained principles are connected discoveries, visible productive progress, per-city production choices, geographical specialization and alternative paths to victory.
- [Official Gathering Storm manual](https://cdn.2kgames.com/manuals/civilization-vi/gathering_storm/2KGMKT_CIV6_Gathering_Storm_PC_Online_Manual_V7_US.pdf), inspected pp.3–4,6–7 and 12: the explicitly selected extensions are stockpiled strategic inputs, local electricity, emissions, environmental exposure and political cooperation.
- [NASA: Humans to Mars](https://www.nasa.gov/humans-in-space/humans-to-mars/) and [Follow the water](https://www.nasa.gov/centers-and-facilities/jpl/where-should-future-astronauts-land-on-mars-follow-the-water/): accessible water, oxygen production and life-support recycling motivate the Mars resource dependencies. Every amount and travel interval below is a game abstraction, not an engineering prediction.

## Explicit adaptations


### Independent Actors
Baseline: Turn-based choices.
Design: Independent ten-second actor admission and shared sixty-second strategy replace a global end-turn barrier.
Why: One developing or absent model must not stall the inhabited world.

### Separate Calendar
Baseline: Turn progression and historical eras.
Design: Six-minute calendar ticks and explicit historical jumps remain separate from strategic production and capability milestones.
Why: The owner authorized a real-time, visibly explained world clock.

### Research Throughput
Baseline: Productive research turns and visible project estimates.
Design: The narrow proposed correction caps investment by actual current-beat output, available stock and remaining cost. Existing balances and completions are preserved.
Why: Live banked science currently makes many newly selected projects finish on the next beat; the diagnosis reproduces this difference.

### Project Switching
Baseline: VI permits switching while retaining project progress.
Design: The current release refuses active replacement. A later explicit switch retains per-node work, rather than resetting or silently accepting replacement.
Why: Do not rewrite current order semantics or enable reset spam while introducing the larger catalogue.

### Conserved Population
Baseline: Settler-based expansion.
Design: Exact source-town population transfers and voluntary migration conserve residents. The small coast feature resolves founding directly before a later travel layer.
Why: Avoid free people and show a real local workforce consequence.

### Physical And Logical Routes
Baseline: Map trade and movement.
Design: Current route records are logical exchanges with retained paths and cadence. Later physical cargo has separate departure, transit, blockade and arrival records.
Why: A rendered line or recurring receipt must not invent a moving caravan.

### Five Victories
Baseline: VI offers scientific, cultural, military and religious victories; Gathering Storm adds diplomatic victory.
Design: Keep the owner’s five families: Mars, cultural, military, federation and economic. Faith remains meaningful without a separate sixth victory; federation replaces a points-only diplomatic win.
Why: Match the requested political/economic world while preserving recognizably Civilization-like competition.

### Mars Sustainability
Baseline: VI base science path culminates in Mars modules.
Design: Require actual conserved colonists, arrivals and sustained locally supported life before victory.
Why: Mars is an inhabited destination in a persistent service, not only a completion animation.

### Director And Service
Baseline: Environmental hazards and scenario events.
Design: A consulted World Director chooses implemented opportunities, disruption or quiet with explicit evidence and bounded counterplay. New releases enter compatibly.
Why: The world grows with development and actual agent decisions.

### Restartable Runs
Baseline: A completed match ends.
Design: Archive the completed world and permit an explicit new run after victory or collapse. No automatic 2050 ending.
Why: Preserve a live service and its history without requiring an immortal single world.

## Historical structure and reachability
The six existing numeric era slots remain stable. Historical subperiods add detail without rewriting old saves. Research era is descriptive; its actual prerequisites and applied capabilities decide selection. Buildings have explicit minimum-era gates. A milestone must be attainable with previous-age output, so it cannot require the very building it unlocks. Calendar dates never automatically unlock technology.

- **0 · First hearths**: Neolithic, Ancient.
- **1 · Cities and states**: Classical, Medieval.
- **2 · A connected world**: Renaissance, Early modern.
- **3 · The industrial world**: Industrial, Modern.
- **4 · The planetary world**: Atomic, Information.
- **5 · Beyond Earth**: Orbital, Lunar, Mars.

## Complete catalogue
Costs are paid once unless an effect explicitly says per beat. Work is a timed city commitment; zero means an immediate choice, passive definition or a research investment instead. A research cost is project progress, not an up-front treasury purchase. All future actions require their implemented capability release and canonical eligibility. Proposed quantities are intentionally concrete so a worker can implement and test them, but live play may tune a new version.

## System Rule catalogue (20)

### Independent tactics and shared strategy · `rule.time`
- Designed capability gate: `versioned-system-rules-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Each actor may submit one tactical action per 10-second window. Shared 60-second strategic beats continue without an actor quorum. Six-minute calendar ticks add ten years. Catch-up records each due beat. Animations never delay actors, and no scheduler invents model choices.
- Exact parameters: {"tacticalWindowMs": 10000, "actionsPerActorWindow": 1, "strategyMs": 60000, "calendarMs": 360000, "yearsPerCalendarTick": 10, "majorCalendarEvery": 10}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Delivery boundary: designed; proposed version is not applied.

### Research and civic progress · `rule.research-flow`
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- For the next version, investment is the minimum of actual science produced in that beat, available science stock and the selected project remainder. This preserves old stored science and completions while preventing an idle bank from exceeding productive throughput. A genuinely productive city may finish a cheap discovery in one beat. A later explicit switching capability retains progress separately per technology. Culture research uses the same throughput model once its separate lane is released. Overflow and idle-stock treatment require a named migration; no arbitrary minimum duration or silent deletion of old science.
- Exact parameters: {"scienceProjectCount": 1, "civicProjectCount": 1, "automaticSuccessorCount": 0, "overflowCap": "Not introduced by the narrow throughput correction; separately versioned decision required.", "investment": "min(actual current-beat science output, available science stock, remaining project cost)", "switching": "Later released explicit switch preserves per-node progress; current recurring release refuses replacement."}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Connected successors: `action.choose-research`, `action.choose-civic`.
- Designed capability gates: `versioned-system-rules-era-0`.
- Delivery boundary: designed; proposed version is not applied.

### City production commitments · `rule.construction`
- Designed capability gate: `versioned-system-rules-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- A city has one active production commitment. Pay its exact cost once, snapshot the required work and rule version, then apply work from opening city facts at the end of each economy beat. Installation happens once, and new output begins on a later beat. Explicit future pause/resume retains work. Required next choices remain visible; an exhausted released pool is an unmet development outcome even when the engine truthfully says Blocked.
- Exact parameters: {"activePerCity": 1, "planLimitPerCivilization": 2, "openingWorkBase": 1, "industryBonus": 1, "completionPhase": "after current production,trade,research"}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Connected successors: `action.hold`, `action.start-production`.
- Delivery boundary: designed; proposed version is not applied.

### Residents, housing and local work · `rule.population`
- Designed capability gate: `versioned-system-rules-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- New housing rules grandfather the capacity of inhabited twenty-person towns and give new towns base housing eight. Growth needs food surplus, housing and adequate wellbeing. Paid recipes use opening local residents. Founding transfers three people and leaves at least three; recruitment and migration conserve people. Culture does not create residents. Housing, amenities and supplied work make city locations distinct.
- Exact parameters: {"foodPerResident": 0.5, "communityReserve": 3, "residentsPerPaidRecipe": 3, "growthFoodCost": "6 + floor(population/4)", "growthThresholdWellbeing": 60, "baseHousing": 8}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Connected successors: `action.assign-worker`, `action.set-focus`.
- Delivery boundary: designed; proposed version is not applied.

### Opening allocation and operating receipts · `rule.economy`
- Designed capability gate: `versioned-system-rules-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Reserve each complete recipe input vector and resident team from opening stocks before any ordinary output. Record operated, paused or blocked with required, available, paid and made quantities. Household and transport costs remain separate. Future electricity has a generation phase followed by local allocation, so a powered recipe cannot manufacture fuel that powers itself during that beat.
- Exact parameters: {"allocationOrder": "exact cityId/buildingId; explicitprioritysuccessorrequired tochange", "atomicInputs": true, "sameBeatOutputCanFundOtherRecipe": false}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Connected successors: `action.pause-operation`, `action.repair-city`.
- Delivery boundary: designed; proposed version is not applied.

### Terrain, deposits and ownership · `rule.geography`
- Designed capability gate: `versioned-system-rules-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Terrain and revealed deposits are deterministic. A compatible resource-layer migration records its seed and affected tiles without rerolling the map. One resident works at most one owned tile within three hexes, and no tile is worked twice. New district ownership and housing rules preserve old towns explicitly. Finite deposits reduce on actual extraction, and terrain requirements come from canonical facts.
- Exact parameters: {"mapSeedImmutable": true, "workedTilesPerResident": 1, "workRadius": 3, "minimumCityDistance": 3}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Delivery boundary: designed; proposed version is not applied.

### Movement and simultaneous conflict · `rule.movement`
- Designed capability gate: `versioned-system-rules-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Fast unit orders name exact destinations and reserve intent. Shared resolution uses current terrain costs and deterministic rotating priority for collisions. Refusal leaves the unit where it was. Land, coast, ocean, air, orbit and Mars domains have explicit access. Roads, rails and canals change real paths. Existing logical trade agreements remain schematic until a separately released cargo-travel version exists.
- Exact parameters: {"oneCombatUnitPerDomainPerTile": true, "intentResolution": "strategy boundary; seeded rotating actor priority then unitId", "unspentMovementResetsEachBeat": true}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Connected successors: `action.move-unit`.
- Delivery boundary: designed; proposed version is not applied.

### Combat, occupation and recovery · `rule.combat`
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Preview and resolve combat from the same opening positions and strength modifiers. Melee exchanges damage; ranged attacks need line of sight and cannot capture a city. One attack per unit per strategy beat. War must already be declared. Surprise war creates thirty grievances, formal war fifteen and liberation zero. Occupation needs two food and two credits each beat. Restored damage never resurrects destroyed units or erase casualties.
- Exact parameters: {"hp": 100, "damage": "clamp(5,60,round(30*exp((attackStrength-defenseStrength)/25)))", "forestDefense": 3, "hillDefense": 3, "fortDefense": 10, "fortifyPerBeat": 3, "fortifyCap": 6, "flankPerAlly": 2, "flankCap": 6, "cityWallsHp": 100}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Connected successors: `action.attack`, `action.denounce`, `action.declare-war`.
- Designed capability gates: `versioned-system-rules-era-0`.
- Delivery boundary: designed; proposed version is not applied.

### Culture, tourism, belief and belonging · `rule.culture`
- Designed capability gate: `versioned-system-rules-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Civic progress, tourism, follower pressure and population are separate ledgers. Museums, parks, performances and permitted visits produce target-specific tourism. Religious teaching changes follower counts, not a civilization actor’s identity. A voluntary migration offer moves one resident only after both owners consent, the source retains three people, the destination has housing and a viable supplied journey arrives.
- Exact parameters: {"domesticTouristPerCulture": 100, "foreignTouristPerTargetTourism": 100, "openBordersTourismMultiplier": 1.25, "tradeAccessTourismMultiplier": 1.25, "migrationOfferResidents": 1}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Connected successors: `action.migrate`.
- Delivery boundary: designed; proposed version is not applied.

### Institutions and legitimacy · `rule.politics`
- Designed capability gate: `versioned-system-rules-era-1` (not applied).
- Era 1; prerequisites: none.
- Start/investment cost: none; work: 0.
- Institutions and policy slots create real modifiers and commitments. Congress meets every twenty beats from an eligible released proposal pool. Each member has one free vote; extra votes consume favor with triangular cost. Ballots close at the recorded deadline; ties preserve current rules. Resolutions expire after twenty beats. Federation membership and exit remain independent actor decisions.
- Exact parameters: {"legitimacyRange": [0, 100], "fulfilledCharterGain": 2, "brokenPromiseLoss": 6, "unfundedHouseholdLoss": 2, "grievancePeaceDecayPerBeat": 1}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Delivery boundary: designed; proposed version is not applied.

### Markets, credit and defaults · `rule.markets`
- Designed capability gate: `versioned-system-rules-era-1` (not applied).
- Era 1; prerequisites: none.
- Start/investment cost: none; work: 0.
- Trades settle real cargo and upkeep only after consent. Loans transfer principal once and retain an exact future repayment. Default records unpaid debt and lost trust; it does not seize undeclared resources or manufacture payment. Company dividends come from actual receipts. Speculation has bounded optional exposure. Economic victory excludes self-trades, wash trades and arbitrary self-priced volume.
- Exact parameters: {"loanPrincipal": 20, "loanRepayment": 22, "loanDueBeats": 8, "borrowerExposureLimit": "min(40,2*last8beatnetcreditincome)", "assetExposureFractionCap": 0.1}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Connected successors: `action.accept-trade`, `action.propose-trade`, `action.stop-trade`.
- Delivery boundary: designed; proposed version is not applied.

### Power and an active planet · `rule.climate`
- Designed capability gate: `versioned-system-rules-era-3` (not applied).
- Era 3; prerequisites: none.
- Start/investment cost: none; work: 0.
- Actual fuel consumption adds emissions. Threshold crossings produce explained exposure on real vulnerable terrain. Renewable generation, barriers, forests, capture and relief provide counterplay. Do not invent rivers, coasts or an individual emitter’s causal contribution. A world climate change must retain the emissions evidence and affected tile list.
- Exact parameters: {"phaseThresholdCumulativeEmissions": [100, 250, 450, 700], "coastalFloodRiskBands": 3, "resilienceDamageMultiplier": 0.5}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Delivery boundary: designed; proposed version is not applied.

### Launches, travel and life support · `rule.space`
- Designed capability gate: `versioned-system-rules-era-5` (not applied).
- Era 5; prerequisites: none.
- Start/investment cost: none; work: 0.
- Debit an exact manifest once at departure, retain travel state and credit arrival once. A launch reserves real capacity and propellant. Before launch a cancellation can release unspent cargo; after launch use an explicit redirect or rescue. Mars is a separate seeded body with surveyed sites. Shelter and life support take priority over industry. Reserves run down before health loss; there are no free colonists or instantaneous terraforming.
- Exact parameters: {"earthOrbitTransitBeats": 2, "earthMarsTransitBeats": 8, "marsLaunchWindowEveryBeats": 12, "residentFood": 0.5, "residentWater": 0.5, "residentOxygen": 0.5, "residentPower": 0.5, "minimumSafetyReserveBeats": 4}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Delivery boundary: designed; proposed version is not applied.

### Director evidence and visible consequences · `rule.events`
- Designed capability gate: `versioned-system-rules-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- The Director consults the current committed state and records intent, exact targets, rule version and actual deltas. Quiet intervals and opportunities give actors room to respond. Every damaging event needs an implemented response path and bounded severity. Routine events add no years. A discretionary historical advance is a separate idempotent operation with a real cause.
- Exact parameters: {"routineEventYears": 0, "reviewYears": 0, "minimumResponseBeats": 2}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Delivery boundary: designed; proposed version is not applied.

### Readable committed civilization story · `rule.spectator`
- Designed capability gate: `versioned-system-rules-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Show who chose a named action, what actually changed and what it makes possible. The map reflects real construction, population, damage and activity. Research shows its project, progress, cost and current throughput estimate. Done, Researching, Available, Locked and Planned are distinct. Technical IDs and raw causes are secondary. Only retained reasons are shown, with read-only mobile and keyboard access.
- Exact parameters: {"immediatePlanLimit": 2, "firstGlanceFields": ["who", "named action", "actual change", "current consequence"], "historyRecentWindow": 24}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Delivery boundary: designed; proposed version is not applied.

### Full design versus playable capability · `rule.delivery`
- Designed capability gate: `versioned-system-rules-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- A designed entry is not an available mechanic. A useful release includes a discovery, its productive or political consequence, canonical choices, persistence and an observed model decision. The full catalogue satisfies design coverage only. It cannot close the live prepared-pool goal. Old releases, agreements and history keep their original rules; changes use explicit new versions and migrations.
- Exact parameters: {"states": ["designed", "source-defined", "source-verified", "deployed", "applied", "observed-useful-outcome"]}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Delivery boundary: designed; proposed version is not applied.

### Great people and unique works · `rule.great-people`
- Designed capability gate: `versioned-system-rules-era-1` (not applied).
- Era 1; prerequisites: none.
- Start/investment cost: none; work: 0.
- Operating districts earn domain points toward a deterministic public roster. A unique person is claimed once. A scientist gives a twenty-percent boost to the current project; an engineer adds eight work; an artist creates one uniquely identified work with tourism four and culture two in a compatible free slot. A merchant’s twenty credits require an explicit grant budget. Replays cannot claim the same person twice.
- Exact parameters: {"pointThresholdByEra": [30, 50, 80, 120, 180, 260], "claimLimitPerPerson": 1}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Delivery boundary: designed; proposed version is not applied.

### Victory, collapse and restart · `rule.end-run`
- Designed capability gate: `versioned-system-rules-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- After all civilizations lose their cities and residents, confirm collapse over four beats. Evaluate the five victory predicates on one committed state. Qualifiers in the same beat can share an outcome. Archive the completed run before an explicitly authorized new run. Restarting the host reloads the existing world. There is no automatic calendar-year victory because calendar and strategy are separate.
- Exact parameters: {"collapseWindowBeats": 4, "noAutomaticCalendarEnd": true}.
- Cross-system use: Canonical simulation, agent explanations, persistence and spectator projection.
- Delivery boundary: designed; proposed version is not applied.

### Exploration and intelligence · `rule.intelligence`
- Designed capability gate: `versioned-system-rules-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- The public spectator may see committed world facts; agent knowledge is separately versioned. Unexplored tiles and private plans stay unknown once a fog-of-war capability is applied. A scout reveals within two hexes, a city within three; remembered terrain persists while rival mobile units become stale after leaving sight. Diplomacy and espionage reveal only their specified fields. Preserve current omniscient observations as the legacy interface until that explicit migration.
- Gates: capability-release-applied, canonical-target-eligibility.
- Exact parameters: {"scoutSight": 2, "citySight": 3, "staleMobileUnitFacts": "last seen revision retained", "spyActionPerWindow": 1}.
- Cross-system use: Meaningful exploration, defense and honest agent information.
- Delivery boundary: designed; proposed version is not applied.

### Neutral communities and envoys · `rule.neutral-polities`
- Designed capability gate: `versioned-system-rules-era-1` (not applied).
- Era 1; prerequisites: `civic.foreign-trade`.
- Start/investment cost: none; work: 0.
- Optional seeded neutral communities are distinct from the five model civilizations. Three actual completed quests or allocated envoys establish influence; unique highest influence of at least three grants the published local specialty. Rival influence can contest it. Their deterministic contract behavior is labeled scripted and never presented as model play. No community appears retroactively on an occupied tile.
- Gates: capability-release-applied, canonical-target-eligibility.
- Exact parameters: {"minimumSuzerainInfluence": 3, "ties": "No exclusive controller", "questExpiryBeats": 12, "questKinds": ["deliver exact food cargo", "complete a real road connection", "protect an existing route", "host a cultural work"], "envoyCostCulture": 20}.
- Cross-system use: Diplomatic geography and alternative peaceful partners.
- Delivery boundary: designed; proposed version is not applied.

## Resource catalogue (21)

### Food · `resource.food`
- Designed capability gate: `resource-ledgers-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "stock"}
- Exact parameters: {"householdPerResident": 0.5}.
- Cross-system use: Household supply and growth.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Materials · `resource.materials`
- Designed capability gate: `resource-ledgers-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "stock"}
- Cross-system use: Construction, repairs and industrial recipes.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Energy · `resource.energy`
- Designed capability gate: `resource-ledgers-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "stock"}
- Cross-system use: Workshop fuel, transport and paid operations; future electricity is separate.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Credits · `resource.credits`
- Designed capability gate: `resource-ledgers-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "stock"}
- Cross-system use: Treasury, construction, upkeep and agreements.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Science · `resource.science`
- Designed capability gate: `resource-ledgers-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "stock-with-throughput-capped-project-investment"}
- Cross-system use: Current technology progress from actual productive throughput; preserve historical stock and explicitly version idle/overflow handling..
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Culture · `resource.culture`
- Designed capability gate: `resource-ledgers-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "stock-with-throughput-capped-civic-investment-and-explicit-paid-uses"}
- Cross-system use: Civic progress and cultural output; current paid cultural recipes preserve their versioned supply.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Faith · `resource.faith`
- Designed capability gate: `resource-ledgers-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "stock"}
- Cross-system use: Beliefs, religious units and heritage projects.
- Delivery boundary: designed; proposed version is not applied.

### Diplomatic favor · `resource.favor`
- Designed capability gate: `resource-ledgers-era-1` (not applied).
- Era 1; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "stock"}
- Exact parameters: {"cap": 100}.
- Cross-system use: Congress votes earned from fulfilled cooperation.
- Delivery boundary: designed; proposed version is not applied.

### Horses · `resource.horses`
- Designed capability gate: `resource-ledgers-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "strategic-stock"}
- Exact parameters: {"capPerCity": 40}.
- Cross-system use: Mounted units.
- Delivery boundary: designed; proposed version is not applied.

### Iron · `resource.iron`
- Designed capability gate: `resource-ledgers-era-1` (not applied).
- Era 1; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "strategic-stock"}
- Exact parameters: {"capPerCity": 40}.
- Cross-system use: Melee equipment, rails and engineering.
- Delivery boundary: designed; proposed version is not applied.

### Niter · `resource.niter`
- Designed capability gate: `resource-ledgers-era-2` (not applied).
- Era 2; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "strategic-stock"}
- Exact parameters: {"capPerCity": 40}.
- Cross-system use: Gunpowder units.
- Delivery boundary: designed; proposed version is not applied.

### Coal · `resource.coal`
- Designed capability gate: `resource-ledgers-era-3` (not applied).
- Era 3; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "strategic-stock"}
- Exact parameters: {"capPerCity": 60}.
- Cross-system use: Steam transport and coal electricity.
- Delivery boundary: designed; proposed version is not applied.

### Oil · `resource.oil`
- Designed capability gate: `resource-ledgers-era-3` (not applied).
- Era 3; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "strategic-stock"}
- Exact parameters: {"capPerCity": 60}.
- Cross-system use: Mechanized supply and oil electricity.
- Delivery boundary: designed; proposed version is not applied.

### Aluminum · `resource.aluminum`
- Designed capability gate: `resource-ledgers-era-4` (not applied).
- Era 4; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "strategic-stock"}
- Exact parameters: {"capPerCity": 60}.
- Cross-system use: Aircraft, electronics and spacecraft.
- Delivery boundary: designed; proposed version is not applied.

### Uranium · `resource.uranium`
- Designed capability gate: `resource-ledgers-era-4` (not applied).
- Era 4; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "strategic-stock"}
- Exact parameters: {"capPerCity": 40}.
- Cross-system use: Nuclear electricity and deterrence.
- Delivery boundary: designed; proposed version is not applied.

### Electricity · `resource.power`
- Designed capability gate: `resource-ledgers-era-3` (not applied).
- Era 3; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "local-flow"}
- Exact parameters: {"unspentExpiresAtBeatEnd": true}.
- Cross-system use: Same-city powered buildings; no automatic global teleport.
- Delivery boundary: designed; proposed version is not applied.

### Water · `resource.water`
- Designed capability gate: `resource-ledgers-era-5` (not applied).
- Era 5; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "local-stock"}
- Cross-system use: Off-world residents, hydroponics and propellant.
- Delivery boundary: designed; proposed version is not applied.

### Oxygen · `resource.oxygen`
- Designed capability gate: `resource-ledgers-era-5` (not applied).
- Era 5; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "local-stock"}
- Cross-system use: Off-world residents and launch oxidizer.
- Delivery boundary: designed; proposed version is not applied.

### Propellant · `resource.propellant`
- Designed capability gate: `resource-ledgers-era-5` (not applied).
- Era 5; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "local-stock"}
- Cross-system use: Orbital and interplanetary cargo.
- Delivery boundary: designed; proposed version is not applied.

### Electronics · `resource.electronics`
- Designed capability gate: `resource-ledgers-era-4` (not applied).
- Era 4; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "stock"}
- Cross-system use: Networks, guidance, robotics and spacecraft.
- Delivery boundary: designed; proposed version is not applied.

### Habitat parts · `resource.habitat-parts`
- Designed capability gate: `resource-ledgers-era-5` (not applied).
- Era 5; prerequisites: none.
- Start/investment cost: none; work: 0.
- resource-definition: {"storage": "stock"}
- Cross-system use: Pressure housing and off-world repairs.
- Delivery boundary: designed; proposed version is not applied.

## Deposit catalogue (14)

### Grain · `deposit.grain`
- Designed capability gate: `finite-deposits-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Yield: 2 food.
- amenity: {"amount": 0}
- Gates: revealed-and-owned, worked-by-one-city.
- Exact parameters: {"terrain": "grassland", "duplicateAmenity": false}.
- Cross-system use: Local growth; distinct improved luxury copies support four neediest owned towns; surplus copies can be exchanged.
- Delivery boundary: designed; proposed version is not applied.

### Fish · `deposit.fish`
- Designed capability gate: `finite-deposits-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Yield: 2 food.
- amenity: {"amount": 0}
- Gates: revealed-and-owned, worked-by-one-city.
- Exact parameters: {"terrain": "coast", "duplicateAmenity": false}.
- Cross-system use: Local growth; distinct improved luxury copies support four neediest owned towns; surplus copies can be exchanged.
- Delivery boundary: designed; proposed version is not applied.

### Stone · `deposit.stone`
- Designed capability gate: `finite-deposits-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Yield: 2 materials.
- amenity: {"amount": 0}
- Gates: revealed-and-owned, worked-by-one-city.
- Exact parameters: {"terrain": "hills", "duplicateAmenity": false}.
- Cross-system use: Local growth; distinct improved luxury copies support four neediest owned towns; surplus copies can be exchanged.
- Delivery boundary: designed; proposed version is not applied.

### Spices · `deposit.spices`
- Designed capability gate: `finite-deposits-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Yield: 2 credits.
- amenity: {"amount": 1}
- Gates: revealed-and-owned, worked-by-one-city.
- Exact parameters: {"terrain": "forest", "duplicateAmenity": false}.
- Cross-system use: Local growth; distinct improved luxury copies support four neediest owned towns; surplus copies can be exchanged.
- Delivery boundary: designed; proposed version is not applied.

### Silk · `deposit.silk`
- Designed capability gate: `finite-deposits-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Yield: 1 culture.
- amenity: {"amount": 1}
- Gates: revealed-and-owned, worked-by-one-city.
- Exact parameters: {"terrain": "forest", "duplicateAmenity": false}.
- Cross-system use: Local growth; distinct improved luxury copies support four neediest owned towns; surplus copies can be exchanged.
- Delivery boundary: designed; proposed version is not applied.

### Salt · `deposit.salt`
- Designed capability gate: `finite-deposits-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Yield: 1 food.
- amenity: {"amount": 1}
- Gates: revealed-and-owned, worked-by-one-city.
- Exact parameters: {"terrain": "desert", "duplicateAmenity": false}.
- Cross-system use: Local growth; distinct improved luxury copies support four neediest owned towns; surplus copies can be exchanged.
- Delivery boundary: designed; proposed version is not applied.

### Horses deposit · `deposit.horses`
- Designed capability gate: `finite-deposits-era-0` (not applied).
- Era 0; prerequisites: `tech.animal-husbandry`.
- Start/investment cost: none; work: 0.
- finite-extraction: {"resource": "horses", "amountPerBeat": 2, "initialGameUnits": 200}
- Gates: revealed, exact-owned-improvement, remaining-reserve-positive.
- Exact parameters: {"terrain": "grassland", "placement": "Deterministic map layer with an explicit compatible migration; never reroll current terrain."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Iron deposit · `deposit.iron`
- Designed capability gate: `finite-deposits-era-1` (not applied).
- Era 1; prerequisites: `tech.bronze-working`.
- Start/investment cost: none; work: 0.
- finite-extraction: {"resource": "iron", "amountPerBeat": 2, "initialGameUnits": 240}
- Gates: revealed, exact-owned-improvement, remaining-reserve-positive.
- Exact parameters: {"terrain": "mountain-edge-or-hill", "placement": "Deterministic map layer with an explicit compatible migration; never reroll current terrain."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Niter deposit · `deposit.niter`
- Designed capability gate: `finite-deposits-era-1` (not applied).
- Era 1; prerequisites: `tech.military-engineering`.
- Start/investment cost: none; work: 0.
- finite-extraction: {"resource": "niter", "amountPerBeat": 2, "initialGameUnits": 200}
- Gates: revealed, exact-owned-improvement, remaining-reserve-positive.
- Exact parameters: {"terrain": "desert-or-grassland", "placement": "Deterministic map layer with an explicit compatible migration; never reroll current terrain."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Coal deposit · `deposit.coal`
- Designed capability gate: `finite-deposits-era-3` (not applied).
- Era 3; prerequisites: `tech.industrialization`.
- Start/investment cost: none; work: 0.
- finite-extraction: {"resource": "coal", "amountPerBeat": 2, "initialGameUnits": 300}
- Gates: revealed, exact-owned-improvement, remaining-reserve-positive.
- Exact parameters: {"terrain": "forest-or-hill", "placement": "Deterministic map layer with an explicit compatible migration; never reroll current terrain."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Oil deposit · `deposit.oil`
- Designed capability gate: `finite-deposits-era-3` (not applied).
- Era 3; prerequisites: `tech.combustion`.
- Start/investment cost: none; work: 0.
- finite-extraction: {"resource": "oil", "amountPerBeat": 2, "initialGameUnits": 300}
- Gates: revealed, exact-owned-improvement, remaining-reserve-positive.
- Exact parameters: {"terrain": "desert-or-coastal-shelf", "placement": "Deterministic map layer with an explicit compatible migration; never reroll current terrain."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Aluminum deposit · `deposit.aluminum`
- Designed capability gate: `finite-deposits-era-3` (not applied).
- Era 3; prerequisites: `tech.radio`.
- Start/investment cost: none; work: 0.
- finite-extraction: {"resource": "aluminum", "amountPerBeat": 2, "initialGameUnits": 240}
- Gates: revealed, exact-owned-improvement, remaining-reserve-positive.
- Exact parameters: {"terrain": "hill-or-tundra", "placement": "Deterministic map layer with an explicit compatible migration; never reroll current terrain."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Uranium deposit · `deposit.uranium`
- Designed capability gate: `finite-deposits-era-4` (not applied).
- Era 4; prerequisites: `tech.nuclear-fission`.
- Start/investment cost: none; work: 0.
- finite-extraction: {"resource": "uranium", "amountPerBeat": 2, "initialGameUnits": 160}
- Gates: revealed, exact-owned-improvement, remaining-reserve-positive.
- Exact parameters: {"terrain": "desert-or-tundra", "placement": "Deterministic map layer with an explicit compatible migration; never reroll current terrain."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Ice deposit · `deposit.ice`
- Designed capability gate: `finite-deposits-era-5` (not applied).
- Era 5; prerequisites: `tech.planetary-survey`.
- Start/investment cost: none; work: 0.
- finite-extraction: {"resource": "water", "amountPerBeat": 2, "initialGameUnits": 400}
- Gates: revealed, exact-owned-improvement, remaining-reserve-positive.
- Exact parameters: {"terrain": "surveyed-ice", "placement": "Deterministic map layer with an explicit compatible migration; never reroll current terrain."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

## Technology catalogue (65)

### Cultivation · `tech.agriculture`
- Designed capability gate: `research-catalogue-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: 10 science; work: 0.
- Unlocks: action.found-land, building.farm, building.workshop, milestone.first-fields, tech.animal-husbandry, tech.civic-institutions, tech.kiln-firing, tech.water-management, tech.writing, trade.harvest-for-materials, unit.settler, unit.warrior
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `action.found-land`, `building.farm`, `building.workshop`, `milestone.first-fields`, `tech.animal-husbandry`, `tech.civic-institutions`, `tech.kiln-firing`, `tech.water-management`, `tech.writing`, `trade.harvest-for-materials`, `unit.settler`, `unit.warrior`.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Water management · `tech.water-management`
- Designed capability gate: `research-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.agriculture`.
- Start/investment cost: 16 science; work: 0.
- Unlocks: building.boat-yard, building.irrigation, improvement.plantation, tech.sailing
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.boat-yard`, `building.irrigation`, `improvement.plantation`, `tech.sailing`.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Kiln firing · `tech.kiln-firing`
- Designed capability gate: `research-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.agriculture`.
- Start/investment cost: 16 science; work: 0.
- Unlocks: building.kiln, tech.fuel-management, tech.mining, tech.wheel
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.kiln`, `tech.fuel-management`, `tech.mining`, `tech.wheel`.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Civic institutions · `tech.civic-institutions`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.agriculture`.
- Start/investment cost: 24 science; work: 0.
- Unlocks: agreement.joint-road-repair, building.academy, building.monument, milestone.states, tech.fuel-management, tech.navigation
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `agreement.joint-road-repair`, `building.academy`, `building.monument`, `milestone.states`, `tech.fuel-management`, `tech.navigation`.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Fuel management · `tech.fuel-management`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.civic-institutions`, `tech.kiln-firing`.
- Start/investment cost: 28 science; work: 0.
- Unlocks: building.fuel-yard, trade.energy-for-materials
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.fuel-yard`, `trade.energy-for-materials`.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Animal husbandry · `tech.animal-husbandry`
- Designed capability gate: `research-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.agriculture`.
- Start/investment cost: 20 science; work: 0.
- Unlocks: deposit.horses, improvement.pasture, tech.archery, tech.stirrups, tech.wheel, unit.horseman, unit.scout
- reveal-resource: {"id": "deposit.horses"}
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `deposit.horses`, `improvement.pasture`, `tech.archery`, `tech.stirrups`, `tech.wheel`, `unit.horseman`, `unit.scout`.
- Delivery boundary: designed; proposed version is not applied.

### Mining · `tech.mining`
- Designed capability gate: `research-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.kiln-firing`.
- Start/investment cost: 20 science; work: 0.
- Unlocks: improvement.mine, tech.bronze-working, tech.masonry, unit.builder
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `improvement.mine`, `tech.bronze-working`, `tech.masonry`, `unit.builder`.
- Delivery boundary: designed; proposed version is not applied.

### Writing · `tech.writing`
- Designed capability gate: `research-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.agriculture`.
- Start/investment cost: 24 science; work: 0.
- Unlocks: building.library, building.shrine, district.campus, district.holy-site, tech.celestial-navigation, tech.currency, tech.education, tech.mathematics, unit.missionary, wonder.great-library
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.library`, `building.shrine`, `district.campus`, `district.holy-site`, `tech.celestial-navigation`, `tech.currency`, `tech.education`, `tech.mathematics`, `unit.missionary`, `wonder.great-library`.
- Delivery boundary: designed; proposed version is not applied.

### Archery · `tech.archery`
- Designed capability gate: `research-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.animal-husbandry`.
- Start/investment cost: 24 science; work: 0.
- Unlocks: tech.machinery, unit.archer
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `tech.machinery`, `unit.archer`.
- Delivery boundary: designed; proposed version is not applied.

### Masonry · `tech.masonry`
- Designed capability gate: `research-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.mining`.
- Start/investment cost: 28 science; work: 0.
- Unlocks: building.granary, building.walls, improvement.quarry, tech.engineering
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.granary`, `building.walls`, `improvement.quarry`, `tech.engineering`.
- Delivery boundary: designed; proposed version is not applied.

### Sailing · `tech.sailing`
- Designed capability gate: `research-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.water-management`.
- Start/investment cost: 24 science; work: 0.
- Unlocks: building.lighthouse, improvement.fishing-boats, tech.celestial-navigation, tech.shipbuilding, unit.galley
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.lighthouse`, `improvement.fishing-boats`, `tech.celestial-navigation`, `tech.shipbuilding`, `unit.galley`.
- Delivery boundary: designed; proposed version is not applied.

### Bronze working · `tech.bronze-working`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.mining`.
- Start/investment cost: 36 science; work: 0.
- Unlocks: building.barracks, deposit.iron, district.encampment, tech.iron-working, unit.spearman
- reveal-resource: {"id": "deposit.iron"}
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.barracks`, `deposit.iron`, `district.encampment`, `tech.iron-working`, `unit.spearman`.
- Delivery boundary: designed; proposed version is not applied.

### The wheel · `tech.wheel`
- Designed capability gate: `research-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.animal-husbandry`, `tech.kiln-firing`.
- Start/investment cost: 28 science; work: 0.
- Unlocks: building.water-mill, tech.engineering
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.water-mill`, `tech.engineering`.
- Delivery boundary: designed; proposed version is not applied.

### Currency · `tech.currency`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.writing`.
- Start/investment cost: 42 science; work: 0.
- Unlocks: building.market, district.commercial-hub, tech.apprenticeship, tech.banking, tech.mathematics, trade.iron-for-food, trade.luxury-for-credit, unit.trader
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.market`, `district.commercial-hub`, `tech.apprenticeship`, `tech.banking`, `tech.mathematics`, `trade.iron-for-food`, `trade.luxury-for-credit`, `unit.trader`.
- Delivery boundary: designed; proposed version is not applied.

### Iron working · `tech.iron-working`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.bronze-working`.
- Start/investment cost: 48 science; work: 0.
- Unlocks: tech.apprenticeship, tech.military-engineering, tech.stirrups, unit.swordsman
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `tech.apprenticeship`, `tech.military-engineering`, `tech.stirrups`, `unit.swordsman`.
- Delivery boundary: designed; proposed version is not applied.

### Engineering · `tech.engineering`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.wheel`, `tech.masonry`.
- Start/investment cost: 48 science; work: 0.
- Unlocks: building.aqueduct, tech.construction, tech.machinery, unit.catapult
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.aqueduct`, `tech.construction`, `tech.machinery`, `unit.catapult`.
- Delivery boundary: designed; proposed version is not applied.

### Celestial navigation · `tech.celestial-navigation`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.sailing`, `tech.writing`.
- Start/investment cost: 44 science; work: 0.
- Unlocks: district.harbor, tech.astronomy, tech.shipbuilding, wonder.great-lighthouse
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `district.harbor`, `tech.astronomy`, `tech.shipbuilding`, `wonder.great-lighthouse`.
- Delivery boundary: designed; proposed version is not applied.

### Navigation · `tech.navigation`
- Designed capability gate: `research-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.civic-institutions`.
- Start/investment cost: 42 science; work: 0.
- Unlocks: action.found-coast, milestone.connected, tech.cartography
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `action.found-coast`, `milestone.connected`, `tech.cartography`.
- Delivery boundary: source-catalogue-only; proposed version is not applied.

### Mathematics · `tech.mathematics`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.writing`, `tech.currency`.
- Start/investment cost: 44 science; work: 0.
- Unlocks: tech.astronomy, tech.education
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `tech.astronomy`, `tech.education`.
- Delivery boundary: designed; proposed version is not applied.

### Construction · `tech.construction`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.engineering`.
- Start/investment cost: 50 science; work: 0.
- Unlocks: building.arena, district.entertainment, district.theater, tech.military-engineering, tech.sanitation, wonder.colosseum
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.arena`, `district.entertainment`, `district.theater`, `tech.military-engineering`, `tech.sanitation`, `wonder.colosseum`.
- Delivery boundary: designed; proposed version is not applied.

### Education · `tech.education`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.mathematics`, `tech.writing`.
- Start/investment cost: 72 science; work: 0.
- Unlocks: building.university, tech.banking, tech.printing, tech.sanitation
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.university`, `tech.banking`, `tech.printing`, `tech.sanitation`.
- Delivery boundary: designed; proposed version is not applied.

### Apprenticeship · `tech.apprenticeship`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.currency`, `tech.iron-working`.
- Start/investment cost: 68 science; work: 0.
- Unlocks: building.guild-workshop, district.industrial-zone, tech.gunpowder, tech.industrialization
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.guild-workshop`, `district.industrial-zone`, `tech.gunpowder`, `tech.industrialization`.
- Delivery boundary: designed; proposed version is not applied.

### Machinery · `tech.machinery`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.engineering`, `tech.archery`.
- Start/investment cost: 78 science; work: 0.
- Unlocks: improvement.lumber-mill, tech.metal-casting, tech.printing, unit.crossbow
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `improvement.lumber-mill`, `tech.metal-casting`, `tech.printing`, `unit.crossbow`.
- Delivery boundary: designed; proposed version is not applied.

### Stirrups · `tech.stirrups`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.animal-husbandry`, `tech.iron-working`.
- Start/investment cost: 70 science; work: 0.
- Unlocks: unit.knight
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `unit.knight`.
- Delivery boundary: designed; proposed version is not applied.

### Military engineering · `tech.military-engineering`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.construction`, `tech.iron-working`.
- Start/investment cost: 80 science; work: 0.
- Unlocks: deposit.niter, improvement.fort, tech.gunpowder, unit.engineer
- reveal-resource: {"id": "deposit.niter"}
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `deposit.niter`, `improvement.fort`, `tech.gunpowder`, `unit.engineer`.
- Delivery boundary: designed; proposed version is not applied.

### Shipbuilding · `tech.shipbuilding`
- Designed capability gate: `research-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.sailing`, `tech.celestial-navigation`.
- Start/investment cost: 66 science; work: 0.
- Unlocks: building.shipyard, tech.cartography, tech.steam-power, unit.quadrireme
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.shipyard`, `tech.cartography`, `tech.steam-power`, `unit.quadrireme`.
- Delivery boundary: designed; proposed version is not applied.

### Cartography · `tech.cartography`
- Designed capability gate: `research-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.navigation`, `tech.shipbuilding`.
- Start/investment cost: 120 science; work: 0.
- Unlocks: unit.caravel
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `unit.caravel`.
- Delivery boundary: designed; proposed version is not applied.

### Printing · `tech.printing`
- Designed capability gate: `research-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.education`, `tech.machinery`.
- Start/investment cost: 110 science; work: 0.
- Unlocks: building.printing-house, tech.scientific-method, unit.artist, wonder.forbidden-palace
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.printing-house`, `tech.scientific-method`, `unit.artist`, `wonder.forbidden-palace`.
- Delivery boundary: designed; proposed version is not applied.

### Banking · `tech.banking`
- Designed capability gate: `research-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.currency`, `tech.education`.
- Start/investment cost: 120 science; work: 0.
- Unlocks: building.bank, tech.economics
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.bank`, `tech.economics`.
- Delivery boundary: designed; proposed version is not applied.

### Gunpowder · `tech.gunpowder`
- Designed capability gate: `research-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.military-engineering`, `tech.apprenticeship`.
- Start/investment cost: 130 science; work: 0.
- Unlocks: tech.metal-casting, tech.rifling, unit.musketman
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `tech.metal-casting`, `tech.rifling`, `unit.musketman`.
- Delivery boundary: designed; proposed version is not applied.

### Astronomy · `tech.astronomy`
- Designed capability gate: `research-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.mathematics`, `tech.celestial-navigation`.
- Start/investment cost: 120 science; work: 0.
- Unlocks: building.observatory, tech.scientific-method
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.observatory`, `tech.scientific-method`.
- Delivery boundary: designed; proposed version is not applied.

### Metal casting · `tech.metal-casting`
- Designed capability gate: `research-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.gunpowder`, `tech.machinery`.
- Start/investment cost: 150 science; work: 0.
- Unlocks: building.foundry, tech.industrialization, tech.rifling, unit.bombard, unit.frigate
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.foundry`, `tech.industrialization`, `tech.rifling`, `unit.bombard`, `unit.frigate`.
- Delivery boundary: designed; proposed version is not applied.

### Sanitation · `tech.sanitation`
- Designed capability gate: `research-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.construction`, `tech.education`.
- Start/investment cost: 140 science; work: 0.
- Unlocks: building.sewer, tech.chemistry
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.sewer`, `tech.chemistry`.
- Delivery boundary: designed; proposed version is not applied.

### Scientific method · `tech.scientific-method`
- Designed capability gate: `research-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.printing`, `tech.astronomy`.
- Start/investment cost: 150 science; work: 0.
- Unlocks: improvement.national-park, tech.chemistry, tech.electricity, tech.flight, tech.industrialization, unit.archaeologist
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `improvement.national-park`, `tech.chemistry`, `tech.electricity`, `tech.flight`, `tech.industrialization`, `unit.archaeologist`.
- Delivery boundary: designed; proposed version is not applied.

### Industrialization · `tech.industrialization`
- Designed capability gate: `research-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.apprenticeship`, `tech.metal-casting`, `tech.scientific-method`.
- Start/investment cost: 220 science; work: 0.
- Unlocks: building.coal-plant, building.factory, deposit.coal, milestone.industrial, tech.economics, tech.electricity, tech.steam-power, tech.steel, wonder.industrial-exhibition
- reveal-resource: {"id": "deposit.coal"}
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.coal-plant`, `building.factory`, `deposit.coal`, `milestone.industrial`, `tech.economics`, `tech.electricity`, `tech.steam-power`, `tech.steel`, `wonder.industrial-exhibition`.
- Delivery boundary: source-catalogue-only; proposed version is not applied.

### Steam power · `tech.steam-power`
- Designed capability gate: `research-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.industrialization`, `tech.shipbuilding`.
- Start/investment cost: 240 science; work: 0.
- Unlocks: improvement.rail, project.canal, project.river-dam, tech.combustion, unit.ironclad
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `improvement.rail`, `project.canal`, `project.river-dam`, `tech.combustion`, `unit.ironclad`.
- Delivery boundary: designed; proposed version is not applied.

### Economics · `tech.economics`
- Designed capability gate: `research-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.banking`, `tech.industrialization`.
- Start/investment cost: 240 science; work: 0.
- Unlocks: building.stock-exchange, trade.aluminum-for-energy, trade.coal-for-machinery, trade.oil-for-electronics
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.stock-exchange`, `trade.aluminum-for-energy`, `trade.coal-for-machinery`, `trade.oil-for-electronics`.
- Delivery boundary: designed; proposed version is not applied.

### Rifling · `tech.rifling`
- Designed capability gate: `research-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.gunpowder`, `tech.metal-casting`.
- Start/investment cost: 230 science; work: 0.
- Unlocks: tech.advanced-ballistics, tech.combustion, tech.steel, unit.rifle-company
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `tech.advanced-ballistics`, `tech.combustion`, `tech.steel`, `unit.rifle-company`.
- Delivery boundary: designed; proposed version is not applied.

### Chemistry · `tech.chemistry`
- Designed capability gate: `research-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.scientific-method`, `tech.sanitation`.
- Start/investment cost: 260 science; work: 0.
- Unlocks: building.fertilizer-works, building.research-lab, building.water-treatment, project.carbon-capture, tech.biotechnology, tech.composites, tech.nuclear-fission, tech.renewable-energy, tech.rocketry
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.fertilizer-works`, `building.research-lab`, `building.water-treatment`, `project.carbon-capture`, `tech.biotechnology`, `tech.composites`, `tech.nuclear-fission`, `tech.renewable-energy`, `tech.rocketry`.
- Delivery boundary: designed; proposed version is not applied.

### Electricity · `tech.electricity`
- Designed capability gate: `research-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.industrialization`, `tech.scientific-method`.
- Start/investment cost: 280 science; work: 0.
- Unlocks: building.grid-substation, building.hydro-plant, tech.computing, tech.nuclear-fission, tech.radio, tech.renewable-energy, unit.submarine
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.grid-substation`, `building.hydro-plant`, `tech.computing`, `tech.nuclear-fission`, `tech.radio`, `tech.renewable-energy`, `unit.submarine`.
- Delivery boundary: designed; proposed version is not applied.

### Combustion · `tech.combustion`
- Designed capability gate: `research-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.steam-power`, `tech.rifling`.
- Start/investment cost: 280 science; work: 0.
- Unlocks: building.oil-plant, building.refinery, deposit.oil, improvement.oil-well, tech.flight, unit.destroyer, unit.tank
- reveal-resource: {"id": "deposit.oil"}
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.oil-plant`, `building.refinery`, `deposit.oil`, `improvement.oil-well`, `tech.flight`, `unit.destroyer`, `unit.tank`.
- Delivery boundary: designed; proposed version is not applied.

### Steel · `tech.steel`
- Designed capability gate: `research-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.industrialization`, `tech.rifling`.
- Start/investment cost: 280 science; work: 0.
- Unlocks: tech.composites, unit.field-artillery
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `tech.composites`, `unit.field-artillery`.
- Delivery boundary: designed; proposed version is not applied.

### Flight · `tech.flight`
- Designed capability gate: `research-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.combustion`, `tech.scientific-method`.
- Start/investment cost: 300 science; work: 0.
- Unlocks: building.airport, tech.advanced-flight, tech.rocketry, unit.fighter
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.airport`, `tech.advanced-flight`, `tech.rocketry`, `unit.fighter`.
- Delivery boundary: designed; proposed version is not applied.

### Radio · `tech.radio`
- Designed capability gate: `research-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.electricity`.
- Start/investment cost: 300 science; work: 0.
- Unlocks: building.broadcast-center, deposit.aluminum, tech.advanced-flight, tech.computing, tech.telecommunications
- reveal-resource: {"id": "deposit.aluminum"}
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.broadcast-center`, `deposit.aluminum`, `tech.advanced-flight`, `tech.computing`, `tech.telecommunications`.
- Delivery boundary: designed; proposed version is not applied.

### Planetary computing · `tech.computing`
- Designed capability gate: `research-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.electricity`, `tech.radio`.
- Start/investment cost: 420 science; work: 0.
- Unlocks: building.data-center, building.electronics-works, improvement.flood-barrier, milestone.planetary, tech.biotechnology, tech.robotics, tech.satellites, tech.telecommunications, unit.peacekeeper, wonder.world-heritage-center
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.data-center`, `building.electronics-works`, `improvement.flood-barrier`, `milestone.planetary`, `tech.biotechnology`, `tech.robotics`, `tech.satellites`, `tech.telecommunications`, `unit.peacekeeper`, `wonder.world-heritage-center`.
- Delivery boundary: source-catalogue-only; proposed version is not applied.

### Advanced flight · `tech.advanced-flight`
- Designed capability gate: `research-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.flight`, `tech.radio`.
- Start/investment cost: 440 science; work: 0.
- Unlocks: unit.bomber
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `unit.bomber`.
- Delivery boundary: designed; proposed version is not applied.

### Rocketry · `tech.rocketry`
- Designed capability gate: `research-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.chemistry`, `tech.flight`.
- Start/investment cost: 460 science; work: 0.
- Unlocks: building.launchpad, building.propellant-plant, district.spaceport, project.launch-satellite, tech.advanced-ballistics, tech.satellites
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.launchpad`, `building.propellant-plant`, `district.spaceport`, `project.launch-satellite`, `tech.advanced-ballistics`, `tech.satellites`.
- Delivery boundary: designed; proposed version is not applied.

### Nuclear fission · `tech.nuclear-fission`
- Designed capability gate: `research-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.chemistry`, `tech.electricity`.
- Start/investment cost: 480 science; work: 0.
- Unlocks: building.nuclear-plant, deposit.uranium, tech.nuclear-fusion, tech.radiation-shielding
- reveal-resource: {"id": "deposit.uranium"}
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.nuclear-plant`, `deposit.uranium`, `tech.nuclear-fusion`, `tech.radiation-shielding`.
- Delivery boundary: designed; proposed version is not applied.

### Renewable energy · `tech.renewable-energy`
- Designed capability gate: `research-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.electricity`, `tech.chemistry`.
- Start/investment cost: 450 science; work: 0.
- Unlocks: building.solar-array, building.wind-farm
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.solar-array`, `building.wind-farm`.
- Delivery boundary: designed; proposed version is not applied.

### Telecommunications · `tech.telecommunications`
- Designed capability gate: `research-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.computing`, `tech.radio`.
- Start/investment cost: 500 science; work: 0.
- Unlocks: building.network-exchange, improvement.ocean-cable, tech.autonomous-logistics
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.network-exchange`, `improvement.ocean-cable`, `tech.autonomous-logistics`.
- Delivery boundary: designed; proposed version is not applied.

### Satellites · `tech.satellites`
- Designed capability gate: `research-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.rocketry`, `tech.computing`.
- Start/investment cost: 520 science; work: 0.
- Unlocks: project.moon-landing, tech.planetary-survey, tech.spaceflight
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `project.moon-landing`, `tech.planetary-survey`, `tech.spaceflight`.
- Delivery boundary: designed; proposed version is not applied.

### Composites · `tech.composites`
- Designed capability gate: `research-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.chemistry`, `tech.steel`.
- Start/investment cost: 520 science; work: 0.
- Unlocks: tech.nanotechnology, tech.robotics, unit.mechanized-infantry
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `tech.nanotechnology`, `tech.robotics`, `unit.mechanized-infantry`.
- Delivery boundary: designed; proposed version is not applied.

### Advanced ballistics · `tech.advanced-ballistics`
- Designed capability gate: `research-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.rocketry`, `tech.rifling`.
- Start/investment cost: 500 science; work: 0.
- Unlocks: unit.mobile-air-defense
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `unit.mobile-air-defense`.
- Delivery boundary: designed; proposed version is not applied.

### Biotechnology · `tech.biotechnology`
- Designed capability gate: `research-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.chemistry`, `tech.computing`.
- Start/investment cost: 520 science; work: 0.
- Unlocks: building.gene-bank, building.hospital, tech.closed-loop-life-support, tech.nanotechnology
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.gene-bank`, `building.hospital`, `tech.closed-loop-life-support`, `tech.nanotechnology`.
- Delivery boundary: designed; proposed version is not applied.

### Robotics · `tech.robotics`
- Designed capability gate: `research-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.computing`, `tech.composites`.
- Start/investment cost: 600 science; work: 0.
- Unlocks: building.robotics-plant, tech.autonomous-logistics, tech.nuclear-fusion, tech.spaceflight
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.robotics-plant`, `tech.autonomous-logistics`, `tech.nuclear-fusion`, `tech.spaceflight`.
- Delivery boundary: designed; proposed version is not applied.

### Interplanetary logistics · `tech.spaceflight`
- Designed capability gate: `research-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.satellites`, `tech.robotics`.
- Start/investment cost: 720 science; work: 0.
- Unlocks: building.orbital-freight-terminal, project.orbital-depot, tech.autonomous-logistics, tech.closed-loop-life-support, tech.planetary-survey, trade.oxygen-for-food, trade.water-for-habitat, unit.orbital-tug, wonder.orbital-observatory
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.orbital-freight-terminal`, `project.orbital-depot`, `tech.autonomous-logistics`, `tech.closed-loop-life-support`, `tech.planetary-survey`, `trade.oxygen-for-food`, `trade.water-for-habitat`, `unit.orbital-tug`, `wonder.orbital-observatory`.
- Delivery boundary: source-catalogue-only; proposed version is not applied.

### Closed-loop life support · `tech.closed-loop-life-support`
- Designed capability gate: `research-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.biotechnology`, `tech.spaceflight`.
- Start/investment cost: 720 science; work: 0.
- Unlocks: building.hydroponics, building.oxygen-plant, building.water-recycler, project.mars-hydroponics-module, tech.in-situ-resource-use
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.hydroponics`, `building.oxygen-plant`, `building.water-recycler`, `project.mars-hydroponics-module`, `tech.in-situ-resource-use`.
- Delivery boundary: designed; proposed version is not applied.

### Nuclear fusion · `tech.nuclear-fusion`
- Designed capability gate: `research-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.nuclear-fission`, `tech.robotics`.
- Start/investment cost: 800 science; work: 0.
- Unlocks: building.fusion-plant, project.mars-reactor-module, tech.future-science
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.fusion-plant`, `project.mars-reactor-module`, `tech.future-science`.
- Delivery boundary: designed; proposed version is not applied.

### Nanotechnology · `tech.nanotechnology`
- Designed capability gate: `research-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.composites`, `tech.biotechnology`.
- Start/investment cost: 800 science; work: 0.
- Unlocks: building.habitat-factory, project.mars-habitat-module, tech.radiation-shielding
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.habitat-factory`, `project.mars-habitat-module`, `tech.radiation-shielding`.
- Delivery boundary: designed; proposed version is not applied.

### Planetary survey · `tech.planetary-survey`
- Designed capability gate: `research-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.satellites`, `tech.spaceflight`.
- Start/investment cost: 760 science; work: 0.
- Unlocks: deposit.ice, project.mars-survey, tech.in-situ-resource-use, unit.mars-rover
- reveal-resource: {"id": "deposit.ice"}
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `deposit.ice`, `project.mars-survey`, `tech.in-situ-resource-use`, `unit.mars-rover`.
- Delivery boundary: designed; proposed version is not applied.

### Local planetary resources · `tech.in-situ-resource-use`
- Designed capability gate: `research-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.planetary-survey`, `tech.closed-loop-life-support`.
- Start/investment cost: 840 science; work: 0.
- Unlocks: building.ice-mine, building.regolith-works, project.mars-local-industry, tech.terraforming-research
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.ice-mine`, `building.regolith-works`, `project.mars-local-industry`, `tech.terraforming-research`.
- Delivery boundary: designed; proposed version is not applied.

### Radiation shielding · `tech.radiation-shielding`
- Designed capability gate: `research-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.nanotechnology`, `tech.nuclear-fission`.
- Start/investment cost: 820 science; work: 0.
- Unlocks: building.shielded-habitat, project.mars-habitat-module, tech.terraforming-research
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.shielded-habitat`, `project.mars-habitat-module`, `tech.terraforming-research`.
- Delivery boundary: designed; proposed version is not applied.

### Autonomous logistics · `tech.autonomous-logistics`
- Designed capability gate: `research-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.spaceflight`, `tech.telecommunications`, `tech.robotics`.
- Start/investment cost: 880 science; work: 0.
- Unlocks: building.mars-depot
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.mars-depot`.
- Delivery boundary: designed; proposed version is not applied.

### Planetary ecology · `tech.terraforming-research`
- Designed capability gate: `research-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.in-situ-resource-use`, `tech.radiation-shielding`.
- Start/investment cost: 960 science; work: 0.
- Unlocks: building.ecology-lab, tech.future-science
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": false}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Connected successors: `building.ecology-lab`, `tech.future-science`.
- Delivery boundary: designed; proposed version is not applied.

### Future science · `tech.future-science`
- Designed capability gate: `research-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.terraforming-research`, `tech.nuclear-fusion`.
- Start/investment cost: 1200 science; work: 0.
- Terminal repeatable project; see parameters.
- repeatable-bonus: {"sciencePercent": 5, "maximumStacks": 5, "then": "Continue projects for score and discoveries without unbounded multiplicative yield."}
- Gates: capability-release-applied.
- Exact parameters: {"eraIsResearchMetadata": true, "completion": "rule.research-flow", "repeatable": true}.
- Cross-system use: Technology successors and named productive, military, cultural or space commitments.
- Delivery boundary: designed; proposed version is not applied.

## Civic catalogue (36)

### Code of laws · `civic.code-of-laws`
- Era 0; prerequisites: none.
- Start/investment cost: 16 culture; work: 0.
- Unlocks: agreement.peace, civic.craftsmanship, civic.foreign-trade, civic.mysticism, government.chiefdom, policy.urban-planning
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `agreement.peace`, `civic.craftsmanship`, `civic.foreign-trade`, `civic.mysticism`, `government.chiefdom`, `policy.urban-planning`.
- Designed capability gates: `civic-programs-era-0`.
- Delivery boundary: designed; proposed version is not applied.

### Craftsmanship · `civic.craftsmanship`
- Designed capability gate: `civic-programs-era-0` (not applied).
- Era 0; prerequisites: `civic.code-of-laws`.
- Start/investment cost: 22 culture; work: 0.
- Unlocks: civic.drama-poetry, civic.military-tradition, civic.state-workforce, policy.survey
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.drama-poetry`, `civic.military-tradition`, `civic.state-workforce`, `policy.survey`.
- Delivery boundary: designed; proposed version is not applied.

### Foreign trade · `civic.foreign-trade`
- Designed capability gate: `civic-programs-era-0` (not applied).
- Era 0; prerequisites: `civic.code-of-laws`.
- Start/investment cost: 24 culture; work: 0.
- Unlocks: civic.early-empire, civic.exploration, civic.political-philosophy, rule.neutral-polities
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.early-empire`, `civic.exploration`, `civic.political-philosophy`, `rule.neutral-polities`.
- Delivery boundary: designed; proposed version is not applied.

### Early empire · `civic.early-empire`
- Designed capability gate: `civic-programs-era-0` (not applied).
- Era 0; prerequisites: `civic.foreign-trade`.
- Start/investment cost: 30 culture; work: 0.
- Unlocks: agreement.open-borders, civic.state-workforce, policy.colonization
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `agreement.open-borders`, `civic.state-workforce`, `policy.colonization`.
- Delivery boundary: designed; proposed version is not applied.

### Mysticism · `civic.mysticism`
- Designed capability gate: `civic-programs-era-0` (not applied).
- Era 0; prerequisites: `civic.code-of-laws`.
- Start/investment cost: 24 culture; work: 0.
- Unlocks: belief.charity, belief.pilgrimage, belief.river-community, belief.sacred-art, belief.scholarship, belief.stewardship, civic.drama-poetry, civic.theology
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `belief.charity`, `belief.pilgrimage`, `belief.river-community`, `belief.sacred-art`, `belief.scholarship`, `belief.stewardship`, `civic.drama-poetry`, `civic.theology`.
- Delivery boundary: designed; proposed version is not applied.

### State workforce · `civic.state-workforce`
- Designed capability gate: `civic-programs-era-1` (not applied).
- Era 1; prerequisites: `civic.craftsmanship`, `civic.early-empire`.
- Start/investment cost: 40 culture; work: 0.
- Unlocks: civic.civil-service, civic.feudalism, civic.political-philosophy, policy.conscription
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.civil-service`, `civic.feudalism`, `civic.political-philosophy`, `policy.conscription`.
- Delivery boundary: designed; proposed version is not applied.

### Political philosophy · `civic.political-philosophy`
- Designed capability gate: `civic-programs-era-1` (not applied).
- Era 1; prerequisites: `civic.state-workforce`, `civic.foreign-trade`.
- Start/investment cost: 48 culture; work: 0.
- Unlocks: action.adopt-government, civic.civil-service, civic.theology, government.autocracy, government.classical-republic, government.oligarchy
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `action.adopt-government`, `civic.civil-service`, `civic.theology`, `government.autocracy`, `government.classical-republic`, `government.oligarchy`.
- Delivery boundary: designed; proposed version is not applied.

### Drama and poetry · `civic.drama-poetry`
- Designed capability gate: `civic-programs-era-1` (not applied).
- Era 1; prerequisites: `civic.mysticism`, `civic.craftsmanship`.
- Start/investment cost: 48 culture; work: 0.
- Unlocks: building.amphitheater, civic.humanism
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `building.amphitheater`, `civic.humanism`.
- Delivery boundary: designed; proposed version is not applied.

### Military tradition · `civic.military-tradition`
- Designed capability gate: `civic-programs-era-1` (not applied).
- Era 1; prerequisites: `civic.craftsmanship`.
- Start/investment cost: 40 culture; work: 0.
- Unlocks: civic.feudalism, civic.nationalism, policy.discipline, policy.maneuver
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.feudalism`, `civic.nationalism`, `policy.discipline`, `policy.maneuver`.
- Delivery boundary: designed; proposed version is not applied.

### Theology · `civic.theology`
- Designed capability gate: `civic-programs-era-1` (not applied).
- Era 1; prerequisites: `civic.mysticism`, `civic.political-philosophy`.
- Start/investment cost: 60 culture; work: 0.
- Unlocks: building.temple, civic.reformed-church
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `building.temple`, `civic.reformed-church`.
- Delivery boundary: designed; proposed version is not applied.

### Civil service · `civic.civil-service`
- Designed capability gate: `civic-programs-era-1` (not applied).
- Era 1; prerequisites: `civic.political-philosophy`, `civic.state-workforce`.
- Start/investment cost: 68 culture; work: 0.
- Unlocks: agreement.relief-charter, agreement.research-pact, civic.diplomatic-service, civic.guilds, civic.reformed-church
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `agreement.relief-charter`, `agreement.research-pact`, `civic.diplomatic-service`, `civic.guilds`, `civic.reformed-church`.
- Delivery boundary: designed; proposed version is not applied.

### Feudalism · `civic.feudalism`
- Designed capability gate: `civic-programs-era-1` (not applied).
- Era 1; prerequisites: `civic.state-workforce`, `civic.military-tradition`.
- Start/investment cost: 72 culture; work: 0.
- Unlocks: civic.guilds, government.monarchy, policy.serfdom
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.guilds`, `government.monarchy`, `policy.serfdom`.
- Delivery boundary: designed; proposed version is not applied.

### Guilds · `civic.guilds`
- Designed capability gate: `civic-programs-era-1` (not applied).
- Era 1; prerequisites: `civic.feudalism`, `civic.civil-service`.
- Start/investment cost: 78 culture; work: 0.
- Unlocks: civic.exploration, civic.humanism, civic.mercantilism
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.exploration`, `civic.humanism`, `civic.mercantilism`.
- Delivery boundary: designed; proposed version is not applied.

### Humanism · `civic.humanism`
- Designed capability gate: `civic-programs-era-2` (not applied).
- Era 2; prerequisites: `civic.drama-poetry`, `civic.guilds`.
- Start/investment cost: 110 culture; work: 0.
- Unlocks: agreement.cultural-exchange, building.art-museum, civic.enlightenment, civic.natural-history
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `agreement.cultural-exchange`, `building.art-museum`, `civic.enlightenment`, `civic.natural-history`.
- Delivery boundary: designed; proposed version is not applied.

### Exploration · `civic.exploration`
- Designed capability gate: `civic-programs-era-2` (not applied).
- Era 2; prerequisites: `civic.guilds`, `civic.foreign-trade`.
- Start/investment cost: 110 culture; work: 0.
- Unlocks: civic.mercantilism, government.merchant-republic
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.mercantilism`, `government.merchant-republic`.
- Delivery boundary: designed; proposed version is not applied.

### Diplomatic service · `civic.diplomatic-service`
- Designed capability gate: `civic-programs-era-2` (not applied).
- Era 2; prerequisites: `civic.civil-service`.
- Start/investment cost: 120 culture; work: 0.
- Unlocks: action.vote, agreement.mutual-defense, building.embassy, civic.enlightenment, civic.internationalism, policy.diplomatic-league, unit.spy
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `action.vote`, `agreement.mutual-defense`, `building.embassy`, `civic.enlightenment`, `civic.internationalism`, `policy.diplomatic-league`, `unit.spy`.
- Delivery boundary: designed; proposed version is not applied.

### Reformed belief · `civic.reformed-church`
- Designed capability gate: `civic-programs-era-2` (not applied).
- Era 2; prerequisites: `civic.theology`, `civic.civil-service`.
- Start/investment cost: 110 culture; work: 0.
- Unlocks: government.theocracy
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `government.theocracy`.
- Delivery boundary: designed; proposed version is not applied.

### The Enlightenment · `civic.enlightenment`
- Designed capability gate: `civic-programs-era-2` (not applied).
- Era 2; prerequisites: `civic.humanism`, `civic.diplomatic-service`.
- Start/investment cost: 140 culture; work: 0.
- Unlocks: civic.civil-engineering, civic.mass-media, civic.nationalism, civic.natural-history, policy.rationalism
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.civil-engineering`, `civic.mass-media`, `civic.nationalism`, `civic.natural-history`, `policy.rationalism`.
- Delivery boundary: designed; proposed version is not applied.

### Mercantilism · `civic.mercantilism`
- Designed capability gate: `civic-programs-era-2` (not applied).
- Era 2; prerequisites: `civic.exploration`, `civic.guilds`.
- Start/investment cost: 140 culture; work: 0.
- Unlocks: agreement.loan, civic.civil-engineering, civic.globalization, policy.merchant-confederation
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `agreement.loan`, `civic.civil-engineering`, `civic.globalization`, `policy.merchant-confederation`.
- Delivery boundary: designed; proposed version is not applied.

### Nationalism · `civic.nationalism`
- Designed capability gate: `civic-programs-era-3` (not applied).
- Era 3; prerequisites: `civic.enlightenment`, `civic.military-tradition`.
- Start/investment cost: 220 culture; work: 0.
- Unlocks: action.form-corps, civic.ideology, civic.mobilization
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `action.form-corps`, `civic.ideology`, `civic.mobilization`.
- Delivery boundary: designed; proposed version is not applied.

### Civil engineering · `civic.civil-engineering`
- Designed capability gate: `civic-programs-era-3` (not applied).
- Era 3; prerequisites: `civic.enlightenment`, `civic.mercantilism`.
- Start/investment cost: 230 culture; work: 0.
- Unlocks: agreement.grid-share, building.public-works-office, civic.suffrage, civic.urbanization
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `agreement.grid-share`, `building.public-works-office`, `civic.suffrage`, `civic.urbanization`.
- Delivery boundary: designed; proposed version is not applied.

### Urbanization · `civic.urbanization`
- Designed capability gate: `civic-programs-era-3` (not applied).
- Era 3; prerequisites: `civic.civil-engineering`.
- Start/investment cost: 250 culture; work: 0.
- Unlocks: building.neighborhood, building.zoo, civic.conservation, civic.mass-media, civic.mobilization
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `building.neighborhood`, `building.zoo`, `civic.conservation`, `civic.mass-media`, `civic.mobilization`.
- Delivery boundary: designed; proposed version is not applied.

### Natural history · `civic.natural-history`
- Designed capability gate: `civic-programs-era-3` (not applied).
- Era 3; prerequisites: `civic.humanism`, `civic.enlightenment`.
- Start/investment cost: 250 culture; work: 0.
- Unlocks: building.archaeology-museum, civic.conservation
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `building.archaeology-museum`, `civic.conservation`.
- Delivery boundary: designed; proposed version is not applied.

### Mass media · `civic.mass-media`
- Designed capability gate: `civic-programs-era-3` (not applied).
- Era 3; prerequisites: `civic.enlightenment`, `civic.urbanization`.
- Start/investment cost: 280 culture; work: 0.
- Unlocks: civic.cultural-heritage, civic.ideology, civic.suffrage
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.cultural-heritage`, `civic.ideology`, `civic.suffrage`.
- Delivery boundary: designed; proposed version is not applied.

### Conservation · `civic.conservation`
- Designed capability gate: `civic-programs-era-3` (not applied).
- Era 3; prerequisites: `civic.natural-history`, `civic.urbanization`.
- Start/investment cost: 280 culture; work: 0.
- Unlocks: civic.cultural-heritage, civic.environmentalism, project.national-park
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.cultural-heritage`, `civic.environmentalism`, `project.national-park`.
- Delivery boundary: designed; proposed version is not applied.

### Suffrage · `civic.suffrage`
- Designed capability gate: `civic-programs-era-4` (not applied).
- Era 4; prerequisites: `civic.mass-media`, `civic.civil-engineering`.
- Start/investment cost: 400 culture; work: 0.
- Unlocks: civic.digital-democracy, civic.internationalism, government.democracy, policy.new-deal
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.digital-democracy`, `civic.internationalism`, `government.democracy`, `policy.new-deal`.
- Delivery boundary: designed; proposed version is not applied.

### Ideology · `civic.ideology`
- Designed capability gate: `civic-programs-era-4` (not applied).
- Era 4; prerequisites: `civic.nationalism`, `civic.mass-media`.
- Start/investment cost: 380 culture; work: 0.
- Unlocks: government.communism, government.fascism
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `government.communism`, `government.fascism`.
- Delivery boundary: designed; proposed version is not applied.

### Mobilization · `civic.mobilization`
- Designed capability gate: `civic-programs-era-4` (not applied).
- Era 4; prerequisites: `civic.nationalism`, `civic.urbanization`.
- Start/investment cost: 400 culture; work: 0.
- Unlocks: policy.logistics, victory.domination
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `policy.logistics`, `victory.domination`.
- Delivery boundary: designed; proposed version is not applied.

### International cooperation · `civic.internationalism`
- Designed capability gate: `civic-programs-era-4` (not applied).
- Era 4; prerequisites: `civic.diplomatic-service`, `civic.suffrage`.
- Start/investment cost: 440 culture; work: 0.
- Unlocks: agreement.federation, building.world-forum, civic.environmentalism, civic.globalization, civic.space-governance, policy.collective-security, project.world-games
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `agreement.federation`, `building.world-forum`, `civic.environmentalism`, `civic.globalization`, `civic.space-governance`, `policy.collective-security`, `project.world-games`.
- Delivery boundary: designed; proposed version is not applied.

### Cultural heritage · `civic.cultural-heritage`
- Designed capability gate: `civic-programs-era-4` (not applied).
- Era 4; prerequisites: `civic.conservation`, `civic.mass-media`.
- Start/investment cost: 440 culture; work: 0.
- Unlocks: civic.future-culture, policy.heritage, victory.culture
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.future-culture`, `policy.heritage`, `victory.culture`.
- Delivery boundary: designed; proposed version is not applied.

### Globalization · `civic.globalization`
- Designed capability gate: `civic-programs-era-4` (not applied).
- Era 4; prerequisites: `civic.mercantilism`, `civic.internationalism`.
- Start/investment cost: 480 culture; work: 0.
- Unlocks: civic.digital-democracy, policy.open-science, victory.economy
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.digital-democracy`, `policy.open-science`, `victory.economy`.
- Delivery boundary: designed; proposed version is not applied.

### Environmentalism · `civic.environmentalism`
- Designed capability gate: `civic-programs-era-4` (not applied).
- Era 4; prerequisites: `civic.conservation`, `civic.internationalism`.
- Start/investment cost: 480 culture; work: 0.
- Unlocks: agreement.emissions-accord, civic.planetary-charter, policy.carbon-price, project.carbon-capture
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `agreement.emissions-accord`, `civic.planetary-charter`, `policy.carbon-price`, `project.carbon-capture`.
- Delivery boundary: designed; proposed version is not applied.

### Digital democracy · `civic.digital-democracy`
- Designed capability gate: `civic-programs-era-4` (not applied).
- Era 4; prerequisites: `civic.suffrage`, `civic.globalization`.
- Start/investment cost: 520 culture; work: 0.
- Unlocks: civic.space-governance, government.digital-republic
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `civic.space-governance`, `government.digital-republic`.
- Delivery boundary: designed; proposed version is not applied.

### Space governance · `civic.space-governance`
- Designed capability gate: `civic-programs-era-5` (not applied).
- Era 5; prerequisites: `civic.internationalism`, `civic.digital-democracy`.
- Start/investment cost: 680 culture; work: 0.
- Unlocks: agreement.orbital-rescue, civic.planetary-charter, policy.orbital-cooperation
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `agreement.orbital-rescue`, `civic.planetary-charter`, `policy.orbital-cooperation`.
- Delivery boundary: designed; proposed version is not applied.

### Planetary charter · `civic.planetary-charter`
- Designed capability gate: `civic-programs-era-5` (not applied).
- Era 5; prerequisites: `civic.space-governance`, `civic.environmentalism`.
- Start/investment cost: 760 culture; work: 0.
- Unlocks: agreement.mars-settlement-charter, civic.future-culture, government.planetary-federation, policy.planetary-care
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": false}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Connected successors: `agreement.mars-settlement-charter`, `civic.future-culture`, `government.planetary-federation`, `policy.planetary-care`.
- Delivery boundary: designed; proposed version is not applied.

### Future culture · `civic.future-culture`
- Designed capability gate: `civic-programs-era-5` (not applied).
- Era 5; prerequisites: `civic.planetary-charter`, `civic.cultural-heritage`.
- Start/investment cost: 1100 culture; work: 0.
- Terminal repeatable project; see parameters.
- repeatable-bonus: {"tourismPercent": 5, "maximumStacks": 5, "then": "Continue heritage projects without unbounded multiplicative yield."}
- Gates: civic-projects-release-applied.
- Exact parameters: {"progressRule": "rule.research-flow", "repeatable": true}.
- Cross-system use: Policies, institutions, cultural reach and political agreements.
- Delivery boundary: designed; proposed version is not applied.

## District catalogue (9)

### Campus · `district.campus`
- Designed capability gate: `district-planning-era-0` (not applied).
- Era 0; prerequisites: `tech.writing`.
- Start/investment cost: 16 materials, 8 credits; work: 8.
- Yield: 1 science.
- mountain-adjacent +1 science each, cap3
- Gates: districts-release-applied, owned-exact-tile, one-district-per-tile.
- Exact parameters: {"cityDistrictCap": "1 + floor(population / 4)", "adjacencySnapshot": "recompute from current actual neighbors at opening beat", "minimumEra": 0}.
- Cross-system use: Physical city footprint, named building families and contested land.
- Connected successors: `building.data-center`, `building.ecology-lab`, `building.gene-bank`, `building.library`, `building.observatory`, `building.research-lab`, `building.university`.
- Delivery boundary: designed; proposed version is not applied.

### Sacred precinct · `district.holy-site`
- Designed capability gate: `district-planning-era-0` (not applied).
- Era 0; prerequisites: `tech.writing`.
- Start/investment cost: 16 materials, 8 credits; work: 8.
- Yield: 1 faith.
- mountain or woods +1 faith each, cap3
- Gates: districts-release-applied, owned-exact-tile, one-district-per-tile.
- Exact parameters: {"cityDistrictCap": "1 + floor(population / 4)", "adjacencySnapshot": "recompute from current actual neighbors at opening beat", "minimumEra": 0}.
- Cross-system use: Physical city footprint, named building families and contested land.
- Connected successors: `building.shrine`, `building.temple`.
- Delivery boundary: designed; proposed version is not applied.

### Encampment · `district.encampment`
- Designed capability gate: `district-planning-era-1` (not applied).
- Era 1; prerequisites: `tech.bronze-working`.
- Start/investment cost: 20 materials, 10 credits; work: 10.
- Yield: none.
- not adjacent to city center; military production slot
- Gates: districts-release-applied, owned-exact-tile, one-district-per-tile.
- Exact parameters: {"cityDistrictCap": "1 + floor(population / 4)", "adjacencySnapshot": "recompute from current actual neighbors at opening beat", "minimumEra": 1}.
- Cross-system use: Physical city footprint, named building families and contested land.
- Connected successors: `building.barracks`.
- Delivery boundary: designed; proposed version is not applied.

### Commercial hub · `district.commercial-hub`
- Designed capability gate: `district-planning-era-1` (not applied).
- Era 1; prerequisites: `tech.currency`.
- Start/investment cost: 20 materials, 10 credits; work: 10.
- Yield: 2 credits.
- adjacent harbor +2 credits; river +2 only when actual river data exists
- Gates: districts-release-applied, owned-exact-tile, one-district-per-tile.
- Exact parameters: {"cityDistrictCap": "1 + floor(population / 4)", "adjacencySnapshot": "recompute from current actual neighbors at opening beat", "minimumEra": 1}.
- Cross-system use: Physical city footprint, named building families and contested land.
- Connected successors: `building.bank`, `building.market`, `building.stock-exchange`.
- Delivery boundary: designed; proposed version is not applied.

### Harbor · `district.harbor`
- Designed capability gate: `district-planning-era-1` (not applied).
- Era 1; prerequisites: `tech.celestial-navigation`.
- Start/investment cost: 20 materials, 10 credits; work: 10.
- Yield: 1 credits, 1 food.
- coastal water adjacent to owned land
- Gates: districts-release-applied, owned-exact-tile, one-district-per-tile.
- Exact parameters: {"cityDistrictCap": "1 + floor(population / 4)", "adjacencySnapshot": "recompute from current actual neighbors at opening beat", "minimumEra": 1}.
- Cross-system use: Physical city footprint, named building families and contested land.
- Connected successors: `building.lighthouse`, `building.shipyard`.
- Delivery boundary: designed; proposed version is not applied.

### Theater square · `district.theater`
- Designed capability gate: `district-planning-era-1` (not applied).
- Era 1; prerequisites: `tech.construction`.
- Start/investment cost: 20 materials, 10 credits; work: 10.
- Yield: 2 culture.
- adjacent wonder +2 culture, cap4
- Gates: districts-release-applied, owned-exact-tile, one-district-per-tile.
- Exact parameters: {"cityDistrictCap": "1 + floor(population / 4)", "adjacencySnapshot": "recompute from current actual neighbors at opening beat", "minimumEra": 1}.
- Cross-system use: Physical city footprint, named building families and contested land.
- Connected successors: `building.amphitheater`, `building.archaeology-museum`, `building.art-museum`, `building.broadcast-center`, `building.printing-house`.
- Delivery boundary: designed; proposed version is not applied.

### Industrial zone · `district.industrial-zone`
- Designed capability gate: `district-planning-era-1` (not applied).
- Era 1; prerequisites: `tech.apprenticeship`.
- Start/investment cost: 24 materials, 12 credits; work: 12.
- Yield: 2 materials.
- adjacent mine/quarry +1 materials each, cap3
- Gates: districts-release-applied, owned-exact-tile, one-district-per-tile.
- Exact parameters: {"cityDistrictCap": "1 + floor(population / 4)", "adjacencySnapshot": "recompute from current actual neighbors at opening beat", "minimumEra": 1}.
- Cross-system use: Physical city footprint, named building families and contested land.
- Connected successors: `building.coal-plant`, `building.electronics-works`, `building.factory`, `building.fertilizer-works`, `building.foundry`, `building.fusion-plant`, `building.guild-workshop`, `building.habitat-factory`, `building.nuclear-plant`, `building.oil-plant`, `building.refinery`, `building.robotics-plant`.
- Delivery boundary: designed; proposed version is not applied.

### Entertainment quarter · `district.entertainment`
- Designed capability gate: `district-planning-era-1` (not applied).
- Era 1; prerequisites: `tech.construction`.
- Start/investment cost: 20 materials, 10 credits; work: 10.
- Yield: none.
- local amenity +2
- Gates: districts-release-applied, owned-exact-tile, one-district-per-tile.
- Exact parameters: {"cityDistrictCap": "1 + floor(population / 4)", "adjacencySnapshot": "recompute from current actual neighbors at opening beat", "minimumEra": 1}.
- Cross-system use: Physical city footprint, named building families and contested land.
- Connected successors: `building.arena`, `building.zoo`.
- Delivery boundary: designed; proposed version is not applied.

### Spaceport · `district.spaceport`
- Designed capability gate: `district-planning-era-4` (not applied).
- Era 4; prerequisites: `tech.rocketry`.
- Start/investment cost: 70 materials, 35 credits; work: 24.
- Yield: none.
- flat land, no flood-risk site; independent city project lane remains one
- Gates: districts-release-applied, owned-exact-tile, one-district-per-tile.
- Exact parameters: {"cityDistrictCap": "1 + floor(population / 4)", "adjacencySnapshot": "recompute from current actual neighbors at opening beat", "minimumEra": 4}.
- Cross-system use: Physical city footprint, named building families and contested land.
- Connected successors: `building.launchpad`, `building.orbital-freight-terminal`.
- Delivery boundary: designed; proposed version is not applied.

## Building catalogue (69)

### Terraced fields · `building.farm`
- Designed capability gate: `building-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.agriculture`.
- Start/investment cost: 8 materials, 4 credits; work: 4.
- Uses none → makes 4 food per funded beat; local resident support 0.
- Infrastructure +1; wellbeing +4 once
- Gates: applied-capability, exact-owned-city, minimum-era-0.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": false}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Connected successors: `milestone.first-fields`.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Artisan quarter · `building.workshop`
- Designed capability gate: `building-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.agriculture`.
- Start/investment cost: 12 materials, 8 credits; work: 4.
- Uses none → makes 3 materials, 1 energy per funded beat; local resident support 0.
- Infrastructure +1 once
- Gates: applied-capability, exact-owned-city, minimum-era-0.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": false}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Irrigation works · `building.irrigation`
- Designed capability gate: `building-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.water-management`.
- Start/investment cost: 12 materials, 8 credits; work: 6.
- Uses 1 materials → makes 5 food per funded beat; local resident support 3.
- Pauseable supplied irrigation
- Gates: applied-capability, exact-owned-city, minimum-era-0.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Kiln · `building.kiln`
- Designed capability gate: `building-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.kiln-firing`.
- Start/investment cost: 10 materials, 8 credits; work: 6.
- Uses 2 energy → makes 4 materials per funded beat; local resident support 3.
- Pauseable heat-intensive craft
- Gates: applied-capability, exact-owned-city, minimum-era-0.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### House of learning · `building.academy`
- Designed capability gate: `building-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.civic-institutions`.
- Start/investment cost: 16 materials, 10 credits; work: 6.
- Uses 2 culture, 1 credits → makes 3 science per funded beat; local resident support 3.
- Infrastructure +1 once; legacy paid culture preserved
- Gates: applied-capability, exact-owned-city, minimum-era-1.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Civic gathering place · `building.monument`
- Designed capability gate: `building-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.civic-institutions`.
- Start/investment cost: 12 materials, 8 credits; work: 6.
- Uses none → makes 4 culture per funded beat; local resident support 0.
- Infrastructure +1; legitimacy +4 once; joint-project institution
- Gates: applied-capability, exact-owned-city, minimum-era-1.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": false}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Connected successors: `agreement.joint-road-repair`.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Fuel yard · `building.fuel-yard`
- Designed capability gate: `building-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.fuel-management`.
- Start/investment cost: 14 materials, 8 credits; work: 6.
- Uses 2 materials → makes 3 energy per funded beat; local resident support 3.
- Energy for roads, kilns and repairs
- Gates: applied-capability, exact-owned-city, minimum-era-1.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Boat yard · `building.boat-yard`
- Designed capability gate: `building-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.water-management`.
- Start/investment cost: 14 materials, 10 credits; work: 6.
- Uses none → makes none per funded beat; local resident support 0.
- Coastal departure capability; Navigation permits conserved overseas founding
- Gates: applied-capability, exact-owned-city, minimum-era-0.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": false}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Connected successors: `action.found-coast`, `milestone.connected`.
- Delivery boundary: prospective-source; proposed version is not applied.

### Granary · `building.granary`
- Designed capability gate: `building-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.masonry`.
- Start/investment cost: 14 materials, 6 credits; work: 8.
- Uses none → makes 2 food per funded beat; local resident support 0.
- Housing +4; food stock protected from spoilage
- Gates: applied-capability, exact-owned-city, minimum-era-0.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": false}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Water mill · `building.water-mill`
- Designed capability gate: `building-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.wheel`.
- Start/investment cost: 16 materials, 6 credits; work: 8.
- Uses none → makes 1 food, 2 materials per funded beat; local resident support 0.
- Needs actual river or completed irrigation
- Gates: applied-capability, exact-owned-city, minimum-era-0.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": false}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Ancient walls · `building.walls`
- Designed capability gate: `building-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.masonry`.
- Start/investment cost: 18 materials, 4 credits; work: 10.
- Uses none → makes none per funded beat; local resident support 0.
- City wall health +100; ranged defense strength25 range2
- Gates: applied-capability, exact-owned-city, minimum-era-0.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": false}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Library · `building.library`
- Designed capability gate: `building-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.writing`, `district.campus`.
- Start/investment cost: 16 materials, 8 credits; work: 8.
- Uses 1 credits → makes 3 science per funded beat; local resident support 3.
- One scientist specialist place; knowledge great-person point +1
- Gates: applied-capability, exact-owned-city, minimum-era-0.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Shrine · `building.shrine`
- Designed capability gate: `building-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.writing`, `district.holy-site`.
- Start/investment cost: 16 materials, 8 credits; work: 8.
- Uses none → makes 3 faith per funded beat; local resident support 0.
- Belief great-person point +1
- Gates: applied-capability, exact-owned-city, minimum-era-0.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": false}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Barracks · `building.barracks`
- Designed capability gate: `building-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.bronze-working`, `district.encampment`.
- Start/investment cost: 18 materials, 8 credits; work: 10.
- Uses 1 credits → makes none per funded beat; local resident support 0.
- New foot units gain10 experience; unit work +20%
- Gates: applied-capability, exact-owned-city, minimum-era-1.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Market · `building.market`
- Designed capability gate: `building-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.currency`, `district.commercial-hub`.
- Start/investment cost: 18 materials, 10 credits; work: 10.
- Uses 1 credits → makes 4 credits per funded beat; local resident support 3.
- Trade capacity +1; commerce great-person point +1
- Gates: applied-capability, exact-owned-city, minimum-era-1.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Lighthouse · `building.lighthouse`
- Designed capability gate: `building-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.sailing`, `district.harbor`.
- Start/investment cost: 16 materials, 8 credits; work: 8.
- Uses none → makes 2 food per funded beat; local resident support 0.
- Sea trade capacity +1; harbor housing +2
- Gates: applied-capability, exact-owned-city, minimum-era-0.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": false}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Aqueduct · `building.aqueduct`
- Designed capability gate: `building-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.engineering`.
- Start/investment cost: 22 materials, 8 credits; work: 12.
- Uses none → makes none per funded beat; local resident support 0.
- Housing +6; needs actual fresh-water source or mountain catchment
- Gates: applied-capability, exact-owned-city, minimum-era-1.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": false}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Arena · `building.arena`
- Designed capability gate: `building-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.construction`, `district.entertainment`.
- Start/investment cost: 20 materials, 10 credits; work: 10.
- Uses 1 credits → makes none per funded beat; local resident support 0.
- Amenities +2
- Gates: applied-capability, exact-owned-city, minimum-era-1.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### University · `building.university`
- Designed capability gate: `building-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.education`, `district.campus`.
- Start/investment cost: 28 materials, 14 credits; work: 14.
- Uses 2 credits → makes 5 science per funded beat; local resident support 3.
- Two scientist places; knowledge point +2
- Gates: applied-capability, exact-owned-city, minimum-era-1.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Guild workshop · `building.guild-workshop`
- Designed capability gate: `building-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.apprenticeship`, `district.industrial-zone`.
- Start/investment cost: 26 materials, 12 credits; work: 12.
- Uses 2 energy → makes 6 materials per funded beat; local resident support 3.
- Engineering great-person point +1
- Gates: applied-capability, exact-owned-city, minimum-era-1.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Shipyard · `building.shipyard`
- Designed capability gate: `building-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.shipbuilding`, `district.harbor`.
- Start/investment cost: 26 materials, 14 credits; work: 12.
- Uses 1 materials, 1 energy → makes 4 materials per funded beat; local resident support 3.
- Naval project work +25%
- Gates: applied-capability, exact-owned-city, minimum-era-1.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Printing house · `building.printing-house`
- Designed capability gate: `building-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.printing`, `district.theater`.
- Start/investment cost: 30 materials, 16 credits; work: 14.
- Uses 1 materials → makes 6 culture per funded beat; local resident support 3.
- Tourism from written works +25%
- Gates: applied-capability, exact-owned-city, minimum-era-2.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Bank · `building.bank`
- Designed capability gate: `building-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.banking`, `district.commercial-hub`.
- Start/investment cost: 30 materials, 18 credits; work: 14.
- Uses 1 credits → makes 7 credits per funded beat; local resident support 3.
- Loan contracts up to20 credits per borrower; no automatic consent
- Gates: applied-capability, exact-owned-city, minimum-era-2.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Observatory · `building.observatory`
- Designed capability gate: `building-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.astronomy`, `district.campus`.
- Start/investment cost: 30 materials, 16 credits; work: 14.
- Uses 2 credits → makes 7 science per funded beat; local resident support 3.
- Needs adjacent mountain or hill; science point +1
- Gates: applied-capability, exact-owned-city, minimum-era-2.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Foundry · `building.foundry`
- Designed capability gate: `building-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.metal-casting`, `district.industrial-zone`.
- Start/investment cost: 32 materials, 16 credits; work: 14.
- Uses 1 iron, 2 energy → makes 8 materials per funded beat; local resident support 3.
- Steel/weapon production supplier
- Gates: applied-capability, exact-owned-city, minimum-era-2.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Connected successors: `milestone.industrial`.
- Delivery boundary: designed; proposed version is not applied.

### Sewer · `building.sewer`
- Designed capability gate: `building-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.sanitation`.
- Start/investment cost: 28 materials, 12 credits; work: 12.
- Uses 1 credits → makes none per funded beat; local resident support 3.
- Housing +4; disease exposure multiplier0.5
- Gates: applied-capability, exact-owned-city, minimum-era-2.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Factory · `building.factory`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.industrialization`, `district.industrial-zone`.
- Start/investment cost: 40 materials, 24 credits; work: 18.
- Uses 3 power → makes 12 materials per funded beat; local resident support 3.
- Industrial project work +25%; no powered output without allocation
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Coal power plant · `building.coal-plant`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.industrialization`, `district.industrial-zone`.
- Start/investment cost: 38 materials, 22 credits; work: 18.
- Uses 2 coal → makes 8 power per funded beat; local resident support 3.
- Emissions +4 per operated beat
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Research laboratory · `building.research-lab`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.chemistry`, `district.campus`.
- Start/investment cost: 42 materials, 24 credits; work: 18.
- Uses 3 power, 2 credits → makes 12 science per funded beat; local resident support 3.
- Knowledge point +2
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Fertilizer works · `building.fertilizer-works`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.chemistry`, `district.industrial-zone`.
- Start/investment cost: 38 materials, 20 credits; work: 16.
- Uses 2 energy, 1 materials → makes 10 food per funded beat; local resident support 3.
- Food supports cities and export dependence
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Hydroelectric plant · `building.hydro-plant`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.electricity`.
- Start/investment cost: 46 materials, 22 credits; work: 20.
- Uses none → makes 8 power per funded beat; local resident support 3.
- Requires completed actual-river dam; zero fuel emissions
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": false}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Grid substation · `building.grid-substation`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.electricity`.
- Start/investment cost: 32 materials, 18 credits; work: 14.
- Uses 1 credits → makes none per funded beat; local resident support 0.
- Consensual neighboring grid transfer cap6 power, one-edge loss1
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Refinery · `building.refinery`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.combustion`, `district.industrial-zone`.
- Start/investment cost: 40 materials, 22 credits; work: 18.
- Uses 2 oil → makes 8 energy per funded beat; local resident support 3.
- Emissions +2 per operated beat
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Oil power plant · `building.oil-plant`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.combustion`, `district.industrial-zone`.
- Start/investment cost: 42 materials, 24 credits; work: 18.
- Uses 2 oil → makes 10 power per funded beat; local resident support 3.
- Emissions +3 per operated beat; replaces other plant only by explicit conversion
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Airport · `building.airport`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.flight`.
- Start/investment cost: 42 materials, 26 credits; work: 18.
- Uses 2 energy, 2 credits → makes none per funded beat; local resident support 3.
- Air basing capacity3; air freight cap8 cargo per4beats
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Broadcast center · `building.broadcast-center`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.radio`, `district.theater`.
- Start/investment cost: 40 materials, 24 credits; work: 18.
- Uses 2 power → makes 10 culture per funded beat; local resident support 3.
- Current housed works tourism +4 each
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Connected successors: `milestone.planetary`.
- Delivery boundary: designed; proposed version is not applied.

### Stock exchange · `building.stock-exchange`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.economics`, `district.commercial-hub`.
- Start/investment cost: 42 materials, 26 credits; work: 18.
- Uses 2 power → makes 12 credits per funded beat; local resident support 3.
- Audited public company listings; no wealth created from own round-trip trades
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Connected successors: `victory.economy`.
- Delivery boundary: designed; proposed version is not applied.

### Data center · `building.data-center`
- Designed capability gate: `building-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.computing`, `district.campus`.
- Start/investment cost: 54 materials, 30 credits; work: 22.
- Uses 4 power, 2 credits → makes 18 science per funded beat; local resident support 3.
- Computing capacity6 for robotics and network projects
- Gates: applied-capability, exact-owned-city, minimum-era-4.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Electronics works · `building.electronics-works`
- Designed capability gate: `building-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.computing`, `district.industrial-zone`.
- Start/investment cost: 52 materials, 28 credits; work: 20.
- Uses 1 aluminum, 2 materials, 3 power → makes 3 electronics per funded beat; local resident support 3.
- Electronics for transport, orbital and automation commitments
- Gates: applied-capability, exact-owned-city, minimum-era-4.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Nuclear plant · `building.nuclear-plant`
- Designed capability gate: `building-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.nuclear-fission`, `district.industrial-zone`.
- Start/investment cost: 60 materials, 32 credits; work: 24.
- Uses 1 uranium → makes 16 power per funded beat; local resident support 3.
- Maintenance due every20 operated beats; overdue raises incident exposure
- Gates: applied-capability, exact-owned-city, minimum-era-4.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Connected successors: `project.reactor-maintenance`.
- Delivery boundary: designed; proposed version is not applied.

### Solar array · `building.solar-array`
- Designed capability gate: `building-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.renewable-energy`.
- Start/investment cost: 38 materials, 22 credits; work: 16.
- Uses none → makes 5 power per funded beat; local resident support 0.
- Flat clear land; dust/cloud event modifier, zero emissions
- Gates: applied-capability, exact-owned-city, minimum-era-4.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": false}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Wind farm · `building.wind-farm`
- Designed capability gate: `building-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.renewable-energy`.
- Start/investment cost: 38 materials, 22 credits; work: 16.
- Uses none → makes 5 power per funded beat; local resident support 0.
- Hill or coast; storm may damage, zero emissions
- Gates: applied-capability, exact-owned-city, minimum-era-4.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": false}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Network exchange · `building.network-exchange`
- Designed capability gate: `building-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.telecommunications`.
- Start/investment cost: 48 materials, 30 credits; work: 20.
- Uses 3 power → makes 6 credits, 4 culture per funded beat; local resident support 3.
- Cross-border knowledge agreement capacity2
- Gates: applied-capability, exact-owned-city, minimum-era-4.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Hospital · `building.hospital`
- Designed capability gate: `building-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.biotechnology`.
- Start/investment cost: 48 materials, 28 credits; work: 20.
- Uses 2 power, 2 credits → makes none per funded beat; local resident support 3.
- Health +15; epidemic mortality multiplier0.25; housing +2
- Gates: applied-capability, exact-owned-city, minimum-era-4.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Gene bank · `building.gene-bank`
- Designed capability gate: `building-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.biotechnology`, `district.campus`.
- Start/investment cost: 48 materials, 28 credits; work: 20.
- Uses 2 power → makes 8 science per funded beat; local resident support 3.
- Crop-loss recovery +50%; unlock hydroponic seed cargo
- Gates: applied-capability, exact-owned-city, minimum-era-4.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Robotics plant · `building.robotics-plant`
- Designed capability gate: `building-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.robotics`, `district.industrial-zone`.
- Start/investment cost: 60 materials, 34 credits; work: 24.
- Uses 5 power, 1 electronics → makes 18 materials per funded beat; local resident support 3.
- Work +4; consumes one specialist team instead of removing all resident needs
- Gates: applied-capability, exact-owned-city, minimum-era-4.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Orbital gateway · `building.launchpad`
- Designed capability gate: `building-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.rocketry`, `district.spaceport`.
- Start/investment cost: 70 materials, 40 credits; work: 28.
- Uses 4 power → makes none per funded beat; local resident support 3.
- Launch projects and cargo capacity; no launch before project completion
- Gates: applied-capability, exact-owned-city, minimum-era-4.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true, "legacyCompatibility": "The currently prepared spaceflight-gated prototype remains historical. The full space chain uses the explicit Rocketry/Spaceport version; do not silently mutate old definitions."}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Connected successors: `project.launch-satellite`.
- Delivery boundary: designed; proposed version is not applied.

### Orbital freight terminal · `building.orbital-freight-terminal`
- Designed capability gate: `building-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.spaceflight`, `district.spaceport`.
- Start/investment cost: 80 materials, 46 credits; work: 30.
- Uses 4 power, 1 electronics → makes none per funded beat; local resident support 3.
- Space cargo cap20 per launch; exact manifests and arrival receipts
- Gates: applied-capability, exact-owned-city, minimum-era-5.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Connected successors: `action.launch-cargo`, `project.mars-resupply`.
- Delivery boundary: designed; proposed version is not applied.

### Water recycler · `building.water-recycler`
- Designed capability gate: `building-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.closed-loop-life-support`.
- Start/investment cost: 40 materials, 24 credits; work: 18.
- Uses 2 power → makes 4 water per funded beat; local resident support 3.
- Recovers at most prior-beat consumed water4, never creates water from no feed
- Gates: applied-capability, exact-owned-city, minimum-era-5.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Atmospheric oxygen plant · `building.oxygen-plant`
- Designed capability gate: `building-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.closed-loop-life-support`.
- Start/investment cost: 42 materials, 26 credits; work: 18.
- Uses 3 power → makes 5 oxygen per funded beat; local resident support 3.
- Mars CO2 atmosphere site only; elsewhere consumes water2 instead
- Gates: applied-capability, exact-owned-city, minimum-era-5.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Hydroponic greenhouse · `building.hydroponics`
- Designed capability gate: `building-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.closed-loop-life-support`.
- Start/investment cost: 44 materials, 26 credits; work: 20.
- Uses 2 water, 3 power → makes 8 food, 1 oxygen per funded beat; local resident support 3.
- Works off-world with seed cargo and pressure housing
- Gates: applied-capability, exact-owned-city, minimum-era-5.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Fusion plant · `building.fusion-plant`
- Designed capability gate: `building-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.nuclear-fusion`, `district.industrial-zone`.
- Start/investment cost: 80 materials, 50 credits; work: 32.
- Uses 1 water → makes 24 power per funded beat; local resident support 3.
- Requires maintenance materials2 every4 beats; no carbon emissions
- Gates: applied-capability, exact-owned-city, minimum-era-5.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Habitat factory · `building.habitat-factory`
- Designed capability gate: `building-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.nanotechnology`, `district.industrial-zone`.
- Start/investment cost: 70 materials, 40 credits; work: 28.
- Uses 4 materials, 1 electronics, 4 power → makes 3 habitat parts per funded beat; local resident support 3.
- Supplies transportable pressure structures
- Gates: applied-capability, exact-owned-city, minimum-era-5.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Ice extraction plant · `building.ice-mine`
- Designed capability gate: `building-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.in-situ-resource-use`.
- Start/investment cost: 42 materials, 24 credits; work: 18.
- Uses 3 power → makes 8 water per funded beat; local resident support 3.
- Finite surveyed ice deposit; extraction reduces remaining reserve
- Gates: applied-capability, exact-owned-city, minimum-era-5.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Regolith works · `building.regolith-works`
- Designed capability gate: `building-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.in-situ-resource-use`.
- Start/investment cost: 46 materials, 26 credits; work: 20.
- Uses 4 power → makes 5 materials per funded beat; local resident support 3.
- Finite surveyed mineral deposit
- Gates: applied-capability, exact-owned-city, minimum-era-5.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Propellant plant · `building.propellant-plant`
- Designed capability gate: `building-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.rocketry`.
- Start/investment cost: 50 materials, 30 credits; work: 22.
- Uses 2 water, 5 power → makes 4 propellant, 2 oxygen per funded beat; local resident support 3.
- Exact local cargo supplies later launches
- Operates on Earth or Mars using actual local water and electricity; it does not require a prior Mars mission.
- Gates: applied-capability, exact-owned-city, minimum-era-4.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Shielded habitat · `building.shielded-habitat`
- Designed capability gate: `building-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.radiation-shielding`.
- Start/investment cost: 50 materials, 30 credits, 6 habitat parts; work: 22.
- Uses 2 power → makes none per funded beat; local resident support 3.
- Consumes habitat-parts6 at start; housing12 and radiation exposure multiplier0.2
- Gates: applied-capability, exact-owned-city, minimum-era-5.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Mars logistics depot · `building.mars-depot`
- Designed capability gate: `building-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.autonomous-logistics`.
- Start/investment cost: 54 materials, 30 credits; work: 22.
- Uses 3 power, 1 electronics → makes none per funded beat; local resident support 3.
- Landing/cargo capacity30; resident evacuation reserve slots6
- Gates: applied-capability, exact-owned-city, minimum-era-5.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Planetary ecology laboratory · `building.ecology-lab`
- Designed capability gate: `building-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.terraforming-research`, `district.campus`.
- Start/investment cost: 66 materials, 38 credits; work: 26.
- Uses 4 power, 1 water → makes 16 science per funded beat; local resident support 3.
- Planetary protection study, no instant terraforming
- Gates: applied-capability, exact-owned-city, minimum-era-5.
- Exact parameters: {"payment": "once-at-start", "work": "opening-city-work; complete-after-current-beat-output", "firstOutput": "next-beat-after-installation", "pauseable": true}.
- Cross-system use: Named technology/civic successors; local production, supply and visible town form.
- Delivery boundary: designed; proposed version is not applied.

### Amphitheater · `building.amphitheater`
- Designed capability gate: `building-catalogue-era-1` (not applied).
- Era 1; prerequisites: `civic.drama-poetry`, `district.theater`.
- Start/investment cost: 22 materials, 10 credits; work: 12.
- Uses 1 credits → makes 4 culture per funded beat; local resident support 3.
- Writing slots2
- Gates: applied-capability, exact-owned-city, minimum-era-1.
- Cross-system use: Culture, political cooperation and contested peaceful victory.
- Delivery boundary: designed; proposed version is not applied.

### Temple · `building.temple`
- Designed capability gate: `building-catalogue-era-1` (not applied).
- Era 1; prerequisites: `civic.theology`, `district.holy-site`.
- Start/investment cost: 26 materials, 12 credits; work: 12.
- Uses 1 credits → makes 5 faith per funded beat; local resident support 3.
- Relic slots2; religious teaching capacity
- Gates: applied-capability, exact-owned-city, minimum-era-1.
- Cross-system use: Culture, political cooperation and contested peaceful victory.
- Delivery boundary: designed; proposed version is not applied.

### Art museum · `building.art-museum`
- Designed capability gate: `building-catalogue-era-2` (not applied).
- Era 2; prerequisites: `civic.humanism`, `district.theater`.
- Start/investment cost: 34 materials, 18 credits; work: 16.
- Uses 1 credits → makes 5 culture per funded beat; local resident support 3.
- Art slots3; theme bonus +6 tourism for three different creators
- Gates: applied-capability, exact-owned-city, minimum-era-2.
- Cross-system use: Culture, political cooperation and contested peaceful victory.
- Delivery boundary: designed; proposed version is not applied.

### Embassy · `building.embassy`
- Designed capability gate: `building-catalogue-era-2` (not applied).
- Era 2; prerequisites: `civic.diplomatic-service`.
- Start/investment cost: 30 materials, 18 credits; work: 14.
- Uses 1 credits → makes 1 favor per funded beat; local resident support 3.
- Requires consenting host, one per foreign civilization; shared diplomatic visibility
- Gates: applied-capability, exact-owned-city, minimum-era-2.
- Cross-system use: Culture, political cooperation and contested peaceful victory.
- Delivery boundary: designed; proposed version is not applied.

### Public works office · `building.public-works-office`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `civic.civil-engineering`.
- Start/investment cost: 38 materials, 20 credits; work: 16.
- Uses 1 credits → makes none per funded beat; local resident support 3.
- Repair work +50%; commissioned repair project remains paid
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Cross-system use: Culture, political cooperation and contested peaceful victory.
- Delivery boundary: designed; proposed version is not applied.

### Neighborhood · `building.neighborhood`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `civic.urbanization`.
- Start/investment cost: 36 materials, 20 credits; work: 16.
- Uses 1 credits → makes none per funded beat; local resident support 3.
- Housing +8, population uses actual food and amenities
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Cross-system use: Culture, political cooperation and contested peaceful victory.
- Delivery boundary: designed; proposed version is not applied.

### Zoological garden · `building.zoo`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `civic.urbanization`, `district.entertainment`.
- Start/investment cost: 36 materials, 20 credits; work: 16.
- Uses 1 credits → makes 2 culture per funded beat; local resident support 3.
- Amenities +3 within6landedges, max one source per city
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Cross-system use: Culture, political cooperation and contested peaceful victory.
- Delivery boundary: designed; proposed version is not applied.

### Archaeological museum · `building.archaeology-museum`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `civic.natural-history`, `district.theater`.
- Start/investment cost: 38 materials, 22 credits; work: 18.
- Uses 1 credits → makes 5 culture per funded beat; local resident support 3.
- Artifact slots3; ruins excavated once with provenance
- Gates: applied-capability, exact-owned-city, minimum-era-3.
- Cross-system use: Culture, political cooperation and contested peaceful victory.
- Delivery boundary: designed; proposed version is not applied.

### World forum · `building.world-forum`
- Designed capability gate: `building-catalogue-era-4` (not applied).
- Era 4; prerequisites: `civic.internationalism`.
- Start/investment cost: 56 materials, 32 credits; work: 24.
- Uses 1 credits → makes 2 favor per funded beat; local resident support 3.
- Congress hosting and federation founding venue
- Gates: applied-capability, exact-owned-city, minimum-era-4.
- Cross-system use: Culture, political cooperation and contested peaceful victory.
- Connected successors: `victory.federation`.
- Delivery boundary: designed; proposed version is not applied.

### Water treatment plant · `building.water-treatment`
- Designed capability gate: `building-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.chemistry`.
- Start/investment cost: 36 materials, 18 credits; work: 16.
- Uses 2 power, 1 credits → makes 6 water per funded beat; local resident support 3.
- Coast or a real fresh-water source; no invented river is needed on the present map.
- Gates: exact-owned-city, coast-or-real-fresh-water.
- Exact parameters: {"minimumEra": 3}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

## Improvement catalogue (12)

### Pasture · `improvement.pasture`
- Designed capability gate: `terrain-improvements-era-0` (not applied).
- Era 0; prerequisites: `tech.animal-husbandry`.
- Start/investment cost: 6 materials, 3 credits; work: 3.
- Yield: 2 food.
- horse/cattle/sheep deposit
- Gates: owned-exact-tile, one-major-improvement-per-tile.
- Cross-system use: Geographic production, route speed and cultural landscape.
- Delivery boundary: designed; proposed version is not applied.

### Mine · `improvement.mine`
- Designed capability gate: `terrain-improvements-era-0` (not applied).
- Era 0; prerequisites: `tech.mining`.
- Start/investment cost: 6 materials, 3 credits; work: 4.
- Yield: 2 materials.
- hill or revealed strategic deposit; extract2 matching strategic stock
- Gates: owned-exact-tile, one-major-improvement-per-tile.
- Cross-system use: Geographic production, route speed and cultural landscape.
- Delivery boundary: designed; proposed version is not applied.

### Quarry · `improvement.quarry`
- Designed capability gate: `terrain-improvements-era-0` (not applied).
- Era 0; prerequisites: `tech.masonry`.
- Start/investment cost: 8 materials, 4 credits; work: 4.
- Yield: 3 materials.
- stone deposit
- Gates: owned-exact-tile, one-major-improvement-per-tile.
- Cross-system use: Geographic production, route speed and cultural landscape.
- Delivery boundary: designed; proposed version is not applied.

### Fishing boats · `improvement.fishing-boats`
- Designed capability gate: `terrain-improvements-era-0` (not applied).
- Era 0; prerequisites: `tech.sailing`.
- Start/investment cost: 8 materials, 4 credits; work: 4.
- Yield: 3 food.
- owned fish/coast tile
- Gates: owned-exact-tile, one-major-improvement-per-tile.
- Cross-system use: Geographic production, route speed and cultural landscape.
- Delivery boundary: designed; proposed version is not applied.

### Lumber mill · `improvement.lumber-mill`
- Designed capability gate: `terrain-improvements-era-1` (not applied).
- Era 1; prerequisites: `tech.machinery`.
- Start/investment cost: 10 materials, 5 credits; work: 6.
- Yield: 4 materials.
- standing forest; clearing removes this yield
- Gates: owned-exact-tile, one-major-improvement-per-tile.
- Cross-system use: Geographic production, route speed and cultural landscape.
- Delivery boundary: designed; proposed version is not applied.

### Plantation · `improvement.plantation`
- Designed capability gate: `terrain-improvements-era-0` (not applied).
- Era 0; prerequisites: `tech.water-management`.
- Start/investment cost: 8 materials, 4 credits; work: 4.
- Yield: 3 credits.
- spice/silk luxury; enables amenity access
- Gates: owned-exact-tile, one-major-improvement-per-tile.
- Cross-system use: Geographic production, route speed and cultural landscape.
- Delivery boundary: designed; proposed version is not applied.

### Fort · `improvement.fort`
- Designed capability gate: `terrain-improvements-era-1` (not applied).
- Era 1; prerequisites: `tech.military-engineering`.
- Start/investment cost: 12 materials, 6 credits; work: 6.
- Yield: none.
- land passable tile; defense+10
- Gates: owned-exact-tile, one-major-improvement-per-tile.
- Cross-system use: Geographic production, route speed and cultural landscape.
- Delivery boundary: designed; proposed version is not applied.

### Oil well · `improvement.oil-well`
- Designed capability gate: `terrain-improvements-era-3` (not applied).
- Era 3; prerequisites: `tech.combustion`.
- Start/investment cost: 18 materials, 9 credits; work: 8.
- Yield: 3 oil.
- revealed oil reserve; finite extraction
- Gates: owned-exact-tile, one-major-improvement-per-tile.
- Cross-system use: Geographic production, route speed and cultural landscape.
- Delivery boundary: designed; proposed version is not applied.

### Rail segment · `improvement.rail`
- Designed capability gate: `terrain-improvements-era-3` (not applied).
- Era 3; prerequisites: `tech.steam-power`.
- Start/investment cost: 4 materials, 2 credits, 1 iron, 1 coal; work: 2.
- Yield: none.
- existing land edge; iron1 coal1 start; movement cost0.25
- Gates: owned-exact-tile, one-major-improvement-per-tile.
- Cross-system use: Geographic production, route speed and cultural landscape.
- Delivery boundary: designed; proposed version is not applied.

### National park · `improvement.national-park`
- Designed capability gate: `terrain-improvements-era-2` (not applied).
- Era 2; prerequisites: `tech.scientific-method`.
- Start/investment cost: 16 materials, 8 credits; work: 8.
- Yield: none.
- four contiguous protected natural tiles; tourism8, no extraction
- Gates: owned-exact-tile, one-major-improvement-per-tile.
- Cross-system use: Geographic production, route speed and cultural landscape.
- Delivery boundary: designed; proposed version is not applied.

### Flood barrier · `improvement.flood-barrier`
- Designed capability gate: `terrain-improvements-era-4` (not applied).
- Era 4; prerequisites: `tech.computing`.
- Start/investment cost: 24 materials, 12 credits; work: 12.
- Yield: none.
- low coast; prevents inundation until damage>=50
- Gates: owned-exact-tile, one-major-improvement-per-tile.
- Cross-system use: Geographic production, route speed and cultural landscape.
- Delivery boundary: designed; proposed version is not applied.

### Ocean cable · `improvement.ocean-cable`
- Designed capability gate: `terrain-improvements-era-4` (not applied).
- Era 4; prerequisites: `tech.telecommunications`.
- Start/investment cost: 30 materials, 15 credits; work: 14.
- Yield: none.
- recorded coastal-to-coastal ocean path; network capacity+2
- Gates: owned-exact-tile, one-major-improvement-per-tile.
- Cross-system use: Geographic production, route speed and cultural landscape.
- Delivery boundary: designed; proposed version is not applied.

## Government catalogue (12)

### Chiefdom · `government.chiefdom`
- Designed capability gate: `policy-governments-era-0` (not applied).
- Era 0; prerequisites: `civic.code-of-laws`.
- Start/investment cost: 10 credits; work: 0.
- policy-slots: {"military": 1, "economic": 1, "diplomatic": 0, "wildcard": 0}
- Local food +1
- Exact parameters: {"minimumCommitmentBeats": 4, "transitionYieldMultiplier": 0.75}.
- Cross-system use: Strategic specialization; replace freely only at an actual civic completion, otherwise pay cost and two-beat transition.
- Delivery boundary: designed; proposed version is not applied.

### Classical republic · `government.classical-republic`
- Designed capability gate: `policy-governments-era-1` (not applied).
- Era 1; prerequisites: `civic.political-philosophy`.
- Start/investment cost: 10 credits; work: 0.
- policy-slots: {"military": 0, "economic": 2, "diplomatic": 1, "wildcard": 1}
- Amenities +1 per district city
- Exact parameters: {"minimumCommitmentBeats": 4, "transitionYieldMultiplier": 0.75}.
- Cross-system use: Strategic specialization; replace freely only at an actual civic completion, otherwise pay cost and two-beat transition.
- Delivery boundary: designed; proposed version is not applied.

### Oligarchy · `government.oligarchy`
- Designed capability gate: `policy-governments-era-1` (not applied).
- Era 1; prerequisites: `civic.political-philosophy`.
- Start/investment cost: 10 credits; work: 0.
- policy-slots: {"military": 2, "economic": 1, "diplomatic": 1, "wildcard": 0}
- Foot unit strength +4
- Exact parameters: {"minimumCommitmentBeats": 4, "transitionYieldMultiplier": 0.75}.
- Cross-system use: Strategic specialization; replace freely only at an actual civic completion, otherwise pay cost and two-beat transition.
- Delivery boundary: designed; proposed version is not applied.

### Autocracy · `government.autocracy`
- Designed capability gate: `policy-governments-era-1` (not applied).
- Era 1; prerequisites: `civic.political-philosophy`.
- Start/investment cost: 10 credits; work: 0.
- policy-slots: {"military": 2, "economic": 1, "diplomatic": 0, "wildcard": 1}
- Capital project work +15%
- Exact parameters: {"minimumCommitmentBeats": 4, "transitionYieldMultiplier": 0.75}.
- Cross-system use: Strategic specialization; replace freely only at an actual civic completion, otherwise pay cost and two-beat transition.
- Delivery boundary: designed; proposed version is not applied.

### Monarchy · `government.monarchy`
- Designed capability gate: `policy-governments-era-1` (not applied).
- Era 1; prerequisites: `civic.feudalism`.
- Start/investment cost: 10 credits; work: 0.
- policy-slots: {"military": 3, "economic": 1, "diplomatic": 1, "wildcard": 1}
- Walls housing +2; favor +1 per fulfilled joint project
- Exact parameters: {"minimumCommitmentBeats": 4, "transitionYieldMultiplier": 0.75}.
- Cross-system use: Strategic specialization; replace freely only at an actual civic completion, otherwise pay cost and two-beat transition.
- Delivery boundary: designed; proposed version is not applied.

### Merchant republic · `government.merchant-republic`
- Designed capability gate: `policy-governments-era-2` (not applied).
- Era 2; prerequisites: `civic.exploration`.
- Start/investment cost: 10 credits; work: 0.
- policy-slots: {"military": 1, "economic": 2, "diplomatic": 1, "wildcard": 2}
- Trade capacity +2, construction credits -10%
- Exact parameters: {"minimumCommitmentBeats": 4, "transitionYieldMultiplier": 0.75}.
- Cross-system use: Strategic specialization; replace freely only at an actual civic completion, otherwise pay cost and two-beat transition.
- Delivery boundary: designed; proposed version is not applied.

### Theocracy · `government.theocracy`
- Designed capability gate: `policy-governments-era-2` (not applied).
- Era 2; prerequisites: `civic.reformed-church`.
- Start/investment cost: 10 credits; work: 0.
- policy-slots: {"military": 2, "economic": 2, "diplomatic": 1, "wildcard": 1}
- Faith purchases -15%
- Exact parameters: {"minimumCommitmentBeats": 4, "transitionYieldMultiplier": 0.75}.
- Cross-system use: Strategic specialization; replace freely only at an actual civic completion, otherwise pay cost and two-beat transition.
- Delivery boundary: designed; proposed version is not applied.

### Democracy · `government.democracy`
- Designed capability gate: `policy-governments-era-4` (not applied).
- Era 4; prerequisites: `civic.suffrage`.
- Start/investment cost: 10 credits; work: 0.
- policy-slots: {"military": 1, "economic": 3, "diplomatic": 2, "wildcard": 2}
- Consenting allied routes +2 food/+2 materials per arrival
- Exact parameters: {"minimumCommitmentBeats": 4, "transitionYieldMultiplier": 0.75}.
- Cross-system use: Strategic specialization; replace freely only at an actual civic completion, otherwise pay cost and two-beat transition.
- Delivery boundary: designed; proposed version is not applied.

### Communism · `government.communism`
- Designed capability gate: `policy-governments-era-4` (not applied).
- Era 4; prerequisites: `civic.ideology`.
- Start/investment cost: 10 credits; work: 0.
- policy-slots: {"military": 3, "economic": 3, "diplomatic": 1, "wildcard": 1}
- City work +2, food supply remains required
- Exact parameters: {"minimumCommitmentBeats": 4, "transitionYieldMultiplier": 0.75}.
- Cross-system use: Strategic specialization; replace freely only at an actual civic completion, otherwise pay cost and two-beat transition.
- Delivery boundary: designed; proposed version is not applied.

### Fascism · `government.fascism`
- Designed capability gate: `policy-governments-era-4` (not applied).
- Era 4; prerequisites: `civic.ideology`.
- Start/investment cost: 10 credits; work: 0.
- policy-slots: {"military": 4, "economic": 1, "diplomatic": 1, "wildcard": 2}
- Military work +25%, war legitimacy decay doubled
- Exact parameters: {"minimumCommitmentBeats": 4, "transitionYieldMultiplier": 0.75}.
- Cross-system use: Strategic specialization; replace freely only at an actual civic completion, otherwise pay cost and two-beat transition.
- Delivery boundary: designed; proposed version is not applied.

### Digital republic · `government.digital-republic`
- Designed capability gate: `policy-governments-era-4` (not applied).
- Era 4; prerequisites: `civic.digital-democracy`.
- Start/investment cost: 10 credits; work: 0.
- policy-slots: {"military": 2, "economic": 3, "diplomatic": 3, "wildcard": 2}
- Science/culture +10% while network powered
- Exact parameters: {"minimumCommitmentBeats": 4, "transitionYieldMultiplier": 0.75}.
- Cross-system use: Strategic specialization; replace freely only at an actual civic completion, otherwise pay cost and two-beat transition.
- Delivery boundary: designed; proposed version is not applied.

### Planetary federation · `government.planetary-federation`
- Designed capability gate: `policy-governments-era-5` (not applied).
- Era 5; prerequisites: `civic.planetary-charter`.
- Start/investment cost: 10 credits; work: 0.
- policy-slots: {"military": 2, "economic": 3, "diplomatic": 3, "wildcard": 2}
- Joint public-good work +25%; member ratification required
- Exact parameters: {"minimumCommitmentBeats": 4, "transitionYieldMultiplier": 0.75}.
- Cross-system use: Strategic specialization; replace freely only at an actual civic completion, otherwise pay cost and two-beat transition.
- Delivery boundary: designed; proposed version is not applied.

## Policy catalogue (18)

### Survey teams · `policy.survey`
- Designed capability gate: `policy-governments-era-0` (not applied).
- Era 0; prerequisites: `civic.craftsmanship`.
- Start/investment cost: none; work: 0.
- Scout experience +50%
- Exact parameters: {"slot": "military", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Disciplined defense · `policy.discipline`
- Designed capability gate: `policy-governments-era-1` (not applied).
- Era 1; prerequisites: `civic.military-tradition`.
- Start/investment cost: none; work: 0.
- Defense +5 against raiders
- Exact parameters: {"slot": "military", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Conscription · `policy.conscription`
- Designed capability gate: `policy-governments-era-1` (not applied).
- Era 1; prerequisites: `civic.state-workforce`.
- Start/investment cost: none; work: 0.
- Unit credit upkeep -1, minimum0
- Exact parameters: {"slot": "military", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Maneuver · `policy.maneuver`
- Designed capability gate: `policy-governments-era-1` (not applied).
- Era 1; prerequisites: `civic.military-tradition`.
- Start/investment cost: none; work: 0.
- Mounted-unit work +25%
- Exact parameters: {"slot": "military", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Supply logistics · `policy.logistics`
- Designed capability gate: `policy-governments-era-4` (not applied).
- Era 4; prerequisites: `civic.mobilization`.
- Start/investment cost: none; work: 0.
- Supplied army reach +3 land edges
- Exact parameters: {"slot": "military", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Urban planning · `policy.urban-planning`
- Designed capability gate: `policy-governments-era-0` (not applied).
- Era 0; prerequisites: `civic.code-of-laws`.
- Start/investment cost: none; work: 0.
- City construction work +1
- Exact parameters: {"slot": "economic", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Colonization · `policy.colonization`
- Designed capability gate: `policy-governments-era-0` (not applied).
- Era 0; prerequisites: `civic.early-empire`.
- Start/investment cost: none; work: 0.
- Founding work +25%; population never created
- Exact parameters: {"slot": "economic", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Rural labor · `policy.serfdom`
- Designed capability gate: `policy-governments-era-1` (not applied).
- Era 1; prerequisites: `civic.feudalism`.
- Start/investment cost: none; work: 0.
- Farm food +1; urban specialist capacity -1 per city
- Exact parameters: {"slot": "economic", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Rationalism · `policy.rationalism`
- Designed capability gate: `policy-governments-era-2` (not applied).
- Era 2; prerequisites: `civic.enlightenment`.
- Start/investment cost: none; work: 0.
- University science +50% when town population>=12
- Exact parameters: {"slot": "economic", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Public welfare · `policy.new-deal`
- Designed capability gate: `policy-governments-era-4` (not applied).
- Era 4; prerequisites: `civic.suffrage`.
- Start/investment cost: none; work: 0.
- Housing +4/amenities +2 per city, treasury upkeep3 per city
- Exact parameters: {"slot": "economic", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Carbon price · `policy.carbon-price`
- Designed capability gate: `policy-governments-era-4` (not applied).
- Era 4; prerequisites: `civic.environmentalism`.
- Start/investment cost: none; work: 0.
- Every emission pays2 credits; renewable project work +25%
- Exact parameters: {"slot": "economic", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Merchant confederation · `policy.merchant-confederation`
- Designed capability gate: `policy-governments-era-2` (not applied).
- Era 2; prerequisites: `civic.mercantilism`.
- Start/investment cost: none; work: 0.
- Fulfilled foreign trade arrival credits +2
- Exact parameters: {"slot": "diplomatic", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Diplomatic league · `policy.diplomatic-league`
- Designed capability gate: `policy-governments-era-2` (not applied).
- Era 2; prerequisites: `civic.diplomatic-service`.
- Start/investment cost: none; work: 0.
- First fulfilled joint project with each rival favor +4
- Exact parameters: {"slot": "diplomatic", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Collective security · `policy.collective-security`
- Designed capability gate: `policy-governments-era-4` (not applied).
- Era 4; prerequisites: `civic.internationalism`.
- Start/investment cost: none; work: 0.
- Ratified defense contribution work +20%; no automatic war declaration
- Exact parameters: {"slot": "diplomatic", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Open science · `policy.open-science`
- Designed capability gate: `policy-governments-era-4` (not applied).
- Era 4; prerequisites: `civic.globalization`.
- Start/investment cost: none; work: 0.
- Consenting research pact current project science +10% each
- Exact parameters: {"slot": "wildcard", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Living heritage · `policy.heritage`
- Designed capability gate: `policy-governments-era-4` (not applied).
- Era 4; prerequisites: `civic.cultural-heritage`.
- Start/investment cost: none; work: 0.
- Museum tourism +50%; artifact sales forbidden during policy
- Exact parameters: {"slot": "wildcard", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Orbital cooperation · `policy.orbital-cooperation`
- Designed capability gate: `policy-governments-era-5` (not applied).
- Era 5; prerequisites: `civic.space-governance`.
- Start/investment cost: none; work: 0.
- Consenting shared launch cost -15%; ownership recorded
- Exact parameters: {"slot": "diplomatic", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

### Planetary care · `policy.planetary-care`
- Designed capability gate: `policy-governments-era-5` (not applied).
- Era 5; prerequisites: `civic.planetary-charter`.
- Start/investment cost: none; work: 0.
- Off-world life-support resource use -10%; protected science zones cannot be mined
- Exact parameters: {"slot": "wildcard", "reslotCostCredits": 8, "minimumCommitmentBeats": 4}.
- Cross-system use: Fits one matching policy slot; no stacking duplicate IDs.
- Delivery boundary: designed; proposed version is not applied.

## Unit catalogue (28)

### Scout · `unit.scout`
- Designed capability gate: `supplied-unit-conflict-era-0` (not applied).
- Era 0; prerequisites: `tech.animal-husbandry`.
- Start/investment cost: 10 materials, 5 credits; work: 6.
- HP 100, strength 10, ranged 0, range 0, movement 3, domain land.
- Per-beat upkeep: 1 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Warrior · `unit.warrior`
- Designed capability gate: `supplied-unit-conflict-era-0` (not applied).
- Era 0; prerequisites: `tech.agriculture`.
- Start/investment cost: 12 materials, 6 credits; work: 8.
- HP 100, strength 20, ranged 0, range 0, movement 2, domain land.
- Per-beat upkeep: 1 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Archer · `unit.archer`
- Designed capability gate: `supplied-unit-conflict-era-0` (not applied).
- Era 0; prerequisites: `tech.archery`.
- Start/investment cost: 14 materials, 7 credits; work: 8.
- HP 100, strength 15, ranged 25, range 2, movement 2, domain land.
- Per-beat upkeep: 1 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Spearman · `unit.spearman`
- Designed capability gate: `supplied-unit-conflict-era-1` (not applied).
- Era 1; prerequisites: `tech.bronze-working`.
- Start/investment cost: 16 materials, 8 credits; work: 10.
- HP 100, strength 25, ranged 0, range 0, movement 2, domain land.
- Per-beat upkeep: 1 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Swordsman · `unit.swordsman`
- Designed capability gate: `supplied-unit-conflict-era-1` (not applied).
- Era 1; prerequisites: `tech.iron-working`.
- Start/investment cost: 20 materials, 10 credits, 4 iron; work: 12.
- HP 100, strength 35, ranged 0, range 0, movement 2, domain land.
- Per-beat upkeep: 1 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Horseman · `unit.horseman`
- Designed capability gate: `supplied-unit-conflict-era-1` (not applied).
- Era 1; prerequisites: `tech.animal-husbandry`.
- Start/investment cost: 20 materials, 10 credits, 4 horses; work: 10.
- HP 100, strength 30, ranged 0, range 0, movement 4, domain land.
- Per-beat upkeep: 1 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Catapult · `unit.catapult`
- Designed capability gate: `supplied-unit-conflict-era-1` (not applied).
- Era 1; prerequisites: `tech.engineering`.
- Start/investment cost: 22 materials, 11 credits; work: 12.
- HP 100, strength 20, ranged 35, range 2, movement 2, domain siege.
- Per-beat upkeep: 1 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Galley · `unit.galley`
- Designed capability gate: `supplied-unit-conflict-era-0` (not applied).
- Era 0; prerequisites: `tech.sailing`.
- Start/investment cost: 16 materials, 8 credits; work: 10.
- HP 100, strength 25, ranged 0, range 0, movement 3, domain coast.
- Per-beat upkeep: 1 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 0, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Quadrireme · `unit.quadrireme`
- Designed capability gate: `supplied-unit-conflict-era-1` (not applied).
- Era 1; prerequisites: `tech.shipbuilding`.
- Start/investment cost: 22 materials, 11 credits; work: 12.
- HP 100, strength 20, ranged 30, range 1, movement 3, domain coast.
- Per-beat upkeep: 1 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 0, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Crossbow company · `unit.crossbow`
- Designed capability gate: `supplied-unit-conflict-era-1` (not applied).
- Era 1; prerequisites: `tech.machinery`.
- Start/investment cost: 28 materials, 14 credits; work: 14.
- HP 100, strength 30, ranged 40, range 2, movement 2, domain land.
- Per-beat upkeep: 1 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Knight · `unit.knight`
- Designed capability gate: `supplied-unit-conflict-era-1` (not applied).
- Era 1; prerequisites: `tech.stirrups`.
- Start/investment cost: 30 materials, 15 credits, 4 horses, 3 iron; work: 14.
- HP 100, strength 45, ranged 0, range 0, movement 4, domain land.
- Per-beat upkeep: 1 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Musket company · `unit.musketman`
- Designed capability gate: `supplied-unit-conflict-era-2` (not applied).
- Era 2; prerequisites: `tech.gunpowder`.
- Start/investment cost: 34 materials, 17 credits, 4 niter; work: 16.
- HP 100, strength 55, ranged 0, range 0, movement 2, domain land.
- Per-beat upkeep: 2 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Bombard · `unit.bombard`
- Designed capability gate: `supplied-unit-conflict-era-2` (not applied).
- Era 2; prerequisites: `tech.metal-casting`.
- Start/investment cost: 36 materials, 18 credits, 4 niter; work: 18.
- HP 100, strength 35, ranged 60, range 2, movement 2, domain siege.
- Per-beat upkeep: 2 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Caravel · `unit.caravel`
- Designed capability gate: `supplied-unit-conflict-era-2` (not applied).
- Era 2; prerequisites: `tech.cartography`.
- Start/investment cost: 30 materials, 15 credits; work: 16.
- HP 100, strength 45, ranged 0, range 0, movement 4, domain ocean.
- Per-beat upkeep: 2 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 0, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Frigate · `unit.frigate`
- Designed capability gate: `supplied-unit-conflict-era-2` (not applied).
- Era 2; prerequisites: `tech.metal-casting`.
- Start/investment cost: 38 materials, 19 credits, 4 niter; work: 18.
- HP 100, strength 40, ranged 60, range 2, movement 4, domain ocean.
- Per-beat upkeep: 2 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 0, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Rifle company · `unit.rifle-company`
- Designed capability gate: `supplied-unit-conflict-era-3` (not applied).
- Era 3; prerequisites: `tech.rifling`.
- Start/investment cost: 42 materials, 21 credits, 3 niter; work: 20.
- HP 100, strength 65, ranged 0, range 0, movement 2, domain land.
- Per-beat upkeep: 3 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Field artillery · `unit.field-artillery`
- Designed capability gate: `supplied-unit-conflict-era-3` (not applied).
- Era 3; prerequisites: `tech.steel`.
- Start/investment cost: 46 materials, 23 credits; work: 22.
- HP 100, strength 45, ranged 75, range 2, movement 2, domain siege.
- Per-beat upkeep: 3 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Ironclad · `unit.ironclad`
- Designed capability gate: `supplied-unit-conflict-era-3` (not applied).
- Era 3; prerequisites: `tech.steam-power`.
- Start/investment cost: 46 materials, 23 credits, 4 coal; work: 22.
- HP 100, strength 70, ranged 0, range 0, movement 4, domain ocean.
- Per-beat upkeep: 3 credits, 0.5 food, 1 coal.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 0, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Tank · `unit.tank`
- Designed capability gate: `supplied-unit-conflict-era-3` (not applied).
- Era 3; prerequisites: `tech.combustion`.
- Start/investment cost: 54 materials, 27 credits, 4 oil; work: 24.
- HP 100, strength 80, ranged 0, range 0, movement 4, domain land.
- Per-beat upkeep: 3 credits, 0.5 food, 1 oil.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Fighter · `unit.fighter`
- Designed capability gate: `supplied-unit-conflict-era-3` (not applied).
- Era 3; prerequisites: `tech.flight`.
- Start/investment cost: 48 materials, 24 credits, 3 oil; work: 22.
- HP 100, strength 70, ranged 75, range 4, movement 6, domain air.
- Per-beat upkeep: 3 credits, 0.5 food, 1 oil.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 0, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Bomber · `unit.bomber`
- Designed capability gate: `supplied-unit-conflict-era-4` (not applied).
- Era 4; prerequisites: `tech.advanced-flight`.
- Start/investment cost: 60 materials, 30 credits, 4 aluminum; work: 26.
- HP 100, strength 50, ranged 90, range 6, movement 6, domain air.
- Per-beat upkeep: 4 credits, 0.5 food, 1 aluminum.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 0, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Destroyer · `unit.destroyer`
- Designed capability gate: `supplied-unit-conflict-era-4` (not applied).
- Era 4; prerequisites: `tech.combustion`.
- Start/investment cost: 56 materials, 28 credits, 4 oil; work: 24.
- HP 100, strength 85, ranged 0, range 0, movement 5, domain ocean.
- Per-beat upkeep: 4 credits, 0.5 food, 1 oil.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 0, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Submarine · `unit.submarine`
- Designed capability gate: `supplied-unit-conflict-era-4` (not applied).
- Era 4; prerequisites: `tech.electricity`.
- Start/investment cost: 54 materials, 27 credits, 3 oil; work: 24.
- HP 100, strength 75, ranged 85, range 2, movement 4, domain ocean.
- Per-beat upkeep: 4 credits, 0.5 food, 1 oil.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 0, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Mechanized infantry · `unit.mechanized-infantry`
- Designed capability gate: `supplied-unit-conflict-era-4` (not applied).
- Era 4; prerequisites: `tech.composites`.
- Start/investment cost: 62 materials, 31 credits, 3 oil; work: 26.
- HP 100, strength 90, ranged 0, range 0, movement 3, domain land.
- Per-beat upkeep: 4 credits, 0.5 food, 1 oil.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Mobile air defense · `unit.mobile-air-defense`
- Designed capability gate: `supplied-unit-conflict-era-4` (not applied).
- Era 4; prerequisites: `tech.advanced-ballistics`.
- Start/investment cost: 54 materials, 27 credits, 3 aluminum; work: 24.
- HP 100, strength 65, ranged 90, range 2, movement 3, domain support.
- Per-beat upkeep: 4 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 0, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Peacekeeper · `unit.peacekeeper`
- Designed capability gate: `supplied-unit-conflict-era-4` (not applied).
- Era 4; prerequisites: `tech.computing`.
- Start/investment cost: 54 materials, 27 credits; work: 24.
- HP 100, strength 80, ranged 0, range 0, movement 3, domain land.
- Per-beat upkeep: 4 credits, 0.5 food.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 1, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Orbital tug · `unit.orbital-tug`
- Designed capability gate: `supplied-unit-conflict-era-5` (not applied).
- Era 5; prerequisites: `tech.spaceflight`.
- Start/investment cost: 70 materials, 35 credits, 4 electronics, 8 propellant; work: 30.
- HP 100, strength 0, ranged 0, range 0, movement 0, domain orbit.
- Per-beat upkeep: 1 power.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 0, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

### Mars rover · `unit.mars-rover`
- Designed capability gate: `supplied-unit-conflict-era-5` (not applied).
- Era 5; prerequisites: `tech.planetary-survey`.
- Start/investment cost: 58 materials, 29 credits, 3 electronics; work: 24.
- HP 100, strength 20, ranged 0, range 0, movement 3, domain mars.
- Per-beat upkeep: 1 power.
- Gates: unit-layer-release, exact-owned-city.
- Exact parameters: {"residentRecruitment": 0, "supplyReach": 6, "unsuppliedStrengthMultiplier": 0.7, "attackAllowancePerStrategyBeat": 1}.
- Cross-system use: Scouting, territorial defense, supply corridors or explicitly declared conflict.
- Delivery boundary: designed; proposed version is not applied.

## Civilian Unit catalogue (8)

### Builder crew · `unit.builder`
- Designed capability gate: `civilian-missions-era-0` (not applied).
- Era 0; prerequisites: `tech.mining`.
- Start/investment cost: 10 materials, 4 credits; work: 6.
- Three improvement jobs; retirement returns its one resident to home
- Gates: unit-layer-release.
- Exact parameters: {"capture": "retained prisoner/return record; no silent population loss"}.
- Cross-system use: Shared terrain, culture, migration and transport.
- Delivery boundary: designed; proposed version is not applied.

### Settler convoy · `unit.settler`
- Designed capability gate: `civilian-missions-era-0` (not applied).
- Era 0; prerequisites: `tech.agriculture`.
- Start/investment cost: 10 food, 12 materials, 8 credits; work: 6.
- Transfer three source residents; return or found; never create people
- Gates: unit-layer-release.
- Exact parameters: {"capture": "retained prisoner/return record; no silent population loss"}.
- Cross-system use: Shared terrain, culture, migration and transport.
- Delivery boundary: designed; proposed version is not applied.

### Trader convoy · `unit.trader`
- Designed capability gate: `civilian-missions-era-1` (not applied).
- Era 1; prerequisites: `tech.currency`.
- Start/investment cost: 12 materials, 8 credits; work: 8.
- One consented physical cargo job; destroyed cargo is a loss, no teleport
- Gates: unit-layer-release.
- Exact parameters: {"capture": "retained prisoner/return record; no silent population loss"}.
- Cross-system use: Shared terrain, culture, migration and transport.
- Delivery boundary: designed; proposed version is not applied.

### Archaeologist · `unit.archaeologist`
- Designed capability gate: `civilian-missions-era-2` (not applied).
- Era 2; prerequisites: `tech.scientific-method`.
- Start/investment cost: 20 materials, 12 credits; work: 12.
- Three unique ruin excavations; permission for foreign sites
- Gates: unit-layer-release.
- Exact parameters: {"capture": "retained prisoner/return record; no silent population loss"}.
- Cross-system use: Shared terrain, culture, migration and transport.
- Delivery boundary: designed; proposed version is not applied.

### Missionary · `unit.missionary`
- Designed capability gate: `civilian-missions-era-0` (not applied).
- Era 0; prerequisites: `tech.writing`.
- Start/investment cost: 30 faith; work: 8.
- Three declared belief-spread visits; no army damage
- Gates: unit-layer-release.
- Exact parameters: {"capture": "retained prisoner/return record; no silent population loss"}.
- Cross-system use: Shared terrain, culture, migration and transport.
- Delivery boundary: designed; proposed version is not applied.

### Engineer crew · `unit.engineer`
- Designed capability gate: `civilian-missions-era-1` (not applied).
- Era 1; prerequisites: `tech.military-engineering`.
- Start/investment cost: 20 materials, 10 credits; work: 10.
- Three fort/rail/repair jobs
- Gates: unit-layer-release.
- Exact parameters: {"capture": "retained prisoner/return record; no silent population loss"}.
- Cross-system use: Shared terrain, culture, migration and transport.
- Delivery boundary: designed; proposed version is not applied.

### Touring artist · `unit.artist`
- Designed capability gate: `civilian-missions-era-2` (not applied).
- Era 2; prerequisites: `tech.printing`.
- Start/investment cost: 20 culture, 12 credits; work: 10.
- Three consenting hosted performances; culture/tourism actual receipts
- Gates: unit-layer-release.
- Exact parameters: {"capture": "retained prisoner/return record; no silent population loss"}.
- Cross-system use: Shared terrain, culture, migration and transport.
- Delivery boundary: designed; proposed version is not applied.

### Spy · `unit.spy`
- Designed capability gate: `civilian-missions-era-2` (not applied).
- Era 2; prerequisites: `civic.diplomatic-service`.
- Start/investment cost: 30 credits, 12 materials; work: 16.
- Travel to an exact foreign town with a three-beat establishment period, then choose one bounded mission. Counterspies reduce success. A spy is not an omniscient reader of private model thoughts.
- Gates: capability-release-applied, canonical-target-eligibility.
- Exact parameters: {"missionSlot": 1, "upkeep": {"credits": 2}, "capture": "Retain an exchangeable prisoner record; no silent retry."}.
- Cross-system use: Diplomatic information, industrial disruption and counterintelligence.
- Connected successors: `mission.counterspy`, `mission.disrupt-production`, `mission.gather-sources`, `mission.intercept-trade`, `mission.secure-elections`, `mission.steal-knowledge`.
- Delivery boundary: designed; proposed version is not applied.

## Agreement catalogue (13)

### Open borders · `agreement.open-borders`
- Designed capability gate: `consensual-institutions-era-0` (not applied).
- Era 0; prerequisites: `civic.early-empire`.
- Start/investment cost: none; work: 0.
- Both parties grant named land access for twelve beats. Withdrawal gives four beats of notice; foreign units must exit or enter a retained internment state.
- Gates: all-named-parties-accept, exact-versioned-terms.
- Exact parameters: {"pendingExpiryBeats": 8, "ordinaryCancellation": "future obligations stop; already settled receipts persist", "noAutomaticModelChoice": true}.
- Cross-system use: Consent, delivery, trust, politics and crisis recovery.
- Delivery boundary: designed; proposed version is not applied.

### Research pact · `agreement.research-pact`
- Designed capability gate: `consensual-institutions-era-1` (not applied).
- Era 1; prerequisites: `civic.civil-service`.
- Start/investment cost: 10 credits; work: 0.
- Each partner pays two credits per beat and receives ten percent more of its own current project science. Retain an exact exchanged-knowledge receipt; do not grant an unearned technology.
- Gates: all-named-parties-accept, exact-versioned-terms.
- Exact parameters: {"pendingExpiryBeats": 8, "ordinaryCancellation": "future obligations stop; already settled receipts persist", "noAutomaticModelChoice": true}.
- Cross-system use: Consent, delivery, trust, politics and crisis recovery.
- Delivery boundary: designed; proposed version is not applied.

### Mutual defense · `agreement.mutual-defense`
- Designed capability gate: `consensual-institutions-era-2` (not applied).
- Era 2; prerequisites: `civic.diplomatic-service`.
- Start/investment cost: 4 favor; work: 0.
- A defensive call requires each ally to choose whether to join within two beats. An unfulfilled accepted promise loses six favor. War is never silently declared for an ally.
- Gates: all-named-parties-accept, exact-versioned-terms.
- Exact parameters: {"pendingExpiryBeats": 8, "ordinaryCancellation": "future obligations stop; already settled receipts persist", "noAutomaticModelChoice": true}.
- Cross-system use: Consent, delivery, trust, politics and crisis recovery.
- Delivery boundary: designed; proposed version is not applied.

### Cultural exchange · `agreement.cultural-exchange`
- Designed capability gate: `consensual-institutions-era-2` (not applied).
- Era 2; prerequisites: `civic.humanism`.
- Start/investment cost: 8 credits; work: 0.
- A named hosted work or performance yields two tourism and two culture to each party per beat for eight beats. Either party may end future hosting.
- Gates: all-named-parties-accept, exact-versioned-terms.
- Exact parameters: {"pendingExpiryBeats": 8, "ordinaryCancellation": "future obligations stop; already settled receipts persist", "noAutomaticModelChoice": true}.
- Cross-system use: Consent, delivery, trust, politics and crisis recovery.
- Delivery boundary: designed; proposed version is not applied.

### Disaster relief · `agreement.relief-charter`
- Designed capability gate: `consensual-institutions-era-1` (not applied).
- Era 1; prerequisites: `civic.civil-service`.
- Start/investment cost: none; work: 0.
- At the agreed due beat, each consenting payer contributes four food and two materials to the exact affected target. Actual fulfillment earns two favor; a promise earns none.
- Gates: all-named-parties-accept, exact-versioned-terms.
- Exact parameters: {"pendingExpiryBeats": 8, "ordinaryCancellation": "future obligations stop; already settled receipts persist", "noAutomaticModelChoice": true}.
- Cross-system use: Consent, delivery, trust, politics and crisis recovery.
- Delivery boundary: designed; proposed version is not applied.

### Joint road repair · `agreement.joint-road-repair`
- Designed capability gate: `consensual-institutions-era-1` (not applied).
- Era 1; prerequisites: `tech.civic-institutions`, `building.monument`.
- Start/investment cost: none; work: 0.
- Each party pays two materials and one energy at two beats after acceptance. Reduce actual damage on the original agreed route by up to twenty-five. Either party may cancel before settlement.
- Gates: all-named-parties-accept, exact-versioned-terms.
- Exact parameters: {"pendingExpiryBeats": 8, "ordinaryCancellation": "future obligations stop; already settled receipts persist", "noAutomaticModelChoice": true}.
- Cross-system use: Consent, delivery, trust, politics and crisis recovery.
- Connected successors: `action.cancel-charter`, `action.propose-charter`, `action.respond-charter`.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Term loan · `agreement.loan`
- Era 2; prerequisites: `civic.mercantilism`.
- Start/investment cost: none; work: 0.
- After both consent, transfer twenty credits from creditor to borrower once. Twenty-two credits are due eight beats later. Default records unpaid debt and reduced trust; there is no automatic seizure.
- Gates: all-named-parties-accept, exact-versioned-terms.
- Exact parameters: {"pendingExpiryBeats": 8, "ordinaryCancellation": "Either party may withdraw before principal settlement. After the twenty-credit principal is disbursed, unilateral cancellation does not remove the twenty-two-credit debt or its due round. Only actual repayment or an explicit creditor-and-borrower accepted restructuring or forgiveness changes the outstanding obligation.", "noAutomaticModelChoice": true, "principal": 20, "repayment": 22, "dueAfterSettlementBeats": 8, "default": "Retain exact unpaid amount, original settlement and due round, plus reduced trust; there is no automatic seizure.", "forgiveness": "Requires explicit current creditor consent; preserve the original debt and the exact forgiven amount in history."}.
- Cross-system use: Consent, delivery, trust, politics and crisis recovery.
- Designed capability gates: `consensual-institutions-era-2`.
- Delivery boundary: designed; proposed version is not applied.

### Peace agreement · `agreement.peace`
- Era 0; prerequisites: `civic.code-of-laws`.
- Start/investment cost: none; work: 0.
- Both parties accept a ten-beat ceasefire and exact prisoner or territory transfers. Settle the transfers atomically. Breach creates twenty grievances.
- Gates: all-named-parties-accept, exact-versioned-terms.
- Exact parameters: {"pendingExpiryBeats": 8, "ordinaryCancellation": "Pending peace can be withdrawn before settlement. After settlement, neither cancellation nor a war declaration can erase the ten-beat ceasefire or settled transfers. Retain any actual breach and its twenty grievances.", "noAutomaticModelChoice": true}.
- Cross-system use: Consent, delivery, trust, politics and crisis recovery.
- Designed capability gates: `consensual-institutions-era-0`.
- Delivery boundary: designed; proposed version is not applied.

### Grid interconnection · `agreement.grid-share`
- Designed capability gate: `consensual-institutions-era-3` (not applied).
- Era 3; prerequisites: `civic.civil-engineering`.
- Start/investment cost: 8 materials; work: 0.
- Both parties consent to exact neighboring substations. Transfer at most six electricity per beat, with one unit lost in transmission. Fund local protected needs before exporting.
- Gates: all-named-parties-accept, exact-versioned-terms.
- Exact parameters: {"pendingExpiryBeats": 8, "ordinaryCancellation": "future obligations stop; already settled receipts persist", "noAutomaticModelChoice": true}.
- Cross-system use: Consent, delivery, trust, politics and crisis recovery.
- Delivery boundary: designed; proposed version is not applied.

### Emissions accord · `agreement.emissions-accord`
- Designed capability gate: `consensual-institutions-era-4` (not applied).
- Era 4; prerequisites: `civic.environmentalism`.
- Start/investment cost: 4 favor; work: 0.
- Members accept an eight-unit emissions cap each beat for twelve beats. Actual excess costs two credits per unit, transferred into the named relief escrow.
- Gates: all-named-parties-accept, exact-versioned-terms.
- Exact parameters: {"pendingExpiryBeats": 8, "ordinaryCancellation": "future obligations stop; already settled receipts persist", "noAutomaticModelChoice": true}.
- Cross-system use: Consent, delivery, trust, politics and crisis recovery.
- Delivery boundary: designed; proposed version is not applied.

### Federation charter · `agreement.federation`
- Designed capability gate: `consensual-institutions-era-4` (not applied).
- Era 4; prerequisites: `civic.internationalism`.
- Start/investment cost: 10 favor; work: 0.
- At least three independent signatories ratify exact voting, budget and exit terms. Each keeps control of its own actor, cities and optional commitments.
- Gates: all-named-parties-accept, exact-versioned-terms.
- Exact parameters: {"pendingExpiryBeats": 8, "ordinaryCancellation": "future obligations stop; already settled receipts persist", "noAutomaticModelChoice": true}.
- Cross-system use: Consent, delivery, trust, politics and crisis recovery.
- Connected successors: `victory.federation`.
- Delivery boundary: designed; proposed version is not applied.

### Orbital rescue compact · `agreement.orbital-rescue`
- Designed capability gate: `consensual-institutions-era-5` (not applied).
- Era 5; prerequisites: `civic.space-governance`.
- Start/investment cost: 4 propellant; work: 0.
- Members reserve six evacuation seats and four real propellant. A draw requires a recorded accepted rescue event and an actual transport destination.
- Gates: all-named-parties-accept, exact-versioned-terms.
- Exact parameters: {"pendingExpiryBeats": 8, "ordinaryCancellation": "future obligations stop; already settled receipts persist", "noAutomaticModelChoice": true}.
- Cross-system use: Consent, delivery, trust, politics and crisis recovery.
- Connected successors: `project.mars-evacuation`.
- Delivery boundary: designed; proposed version is not applied.

### Mars settlement charter · `agreement.mars-settlement-charter`
- Designed capability gate: `consensual-institutions-era-5` (not applied).
- Era 5; prerequisites: `civic.planetary-charter`.
- Start/investment cost: 20 credits; work: 0.
- Record land and water allocation, a protected science zone and life-support priority. Every resident cohort retains its source and journey; no claim creates people.
- Gates: all-named-parties-accept, exact-versioned-terms.
- Exact parameters: {"pendingExpiryBeats": 8, "ordinaryCancellation": "future obligations stop; already settled receipts persist", "noAutomaticModelChoice": true}.
- Cross-system use: Consent, delivery, trust, politics and crisis recovery.
- Delivery boundary: designed; proposed version is not applied.

## Trade Recipe catalogue (9)

### Harvest for materials · `trade.harvest-for-materials`
- Designed capability gate: `exchange-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.agriculture`.
- Start/investment cost: 6 materials, 8 credits; work: 0.
- Proposer sends 4 food; partner sends 3 materials; each pays 1 energy and earns 2 credits only at an actual delivery.
- Gates: explicit-acceptance, actual-path-viable, both-parties-full-obligations-funded.
- Exact parameters: {"baseCadenceBeats": 4, "landCadence": "max(4,ceil(edges/2))", "payment": "construction once by proposer on acceptance; cargo only at due", "luxuryTerms": null}.
- Cross-system use: Different supply chains and peaceful dependence.
- Connected successors: `action.repair-route`.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Energy for materials · `trade.energy-for-materials`
- Designed capability gate: `exchange-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.fuel-management`.
- Start/investment cost: 6 materials, 8 credits; work: 0.
- Proposer sends 4 energy; partner sends 3 materials; each pays 1 energy and earns 2 credits only at an actual delivery.
- Gates: explicit-acceptance, actual-path-viable, both-parties-full-obligations-funded.
- Exact parameters: {"baseCadenceBeats": 4, "landCadence": "max(4,ceil(edges/2))", "payment": "construction once by proposer on acceptance; cargo only at due", "luxuryTerms": null}.
- Cross-system use: Different supply chains and peaceful dependence.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### Iron for food · `trade.iron-for-food`
- Designed capability gate: `exchange-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.currency`.
- Start/investment cost: 6 materials, 8 credits; work: 0.
- Proposer sends 2 iron; partner sends 5 food; each pays 1 energy and earns 2 credits only at an actual delivery.
- Gates: explicit-acceptance, actual-path-viable, both-parties-full-obligations-funded.
- Exact parameters: {"baseCadenceBeats": 4, "landCadence": "max(4,ceil(edges/2))", "payment": "construction once by proposer on acceptance; cargo only at due", "luxuryTerms": null}.
- Cross-system use: Different supply chains and peaceful dependence.
- Delivery boundary: designed; proposed version is not applied.

### Luxury access for credits · `trade.luxury-for-credit`
- Designed capability gate: `exchange-catalogue-era-1` (not applied).
- Era 1; prerequisites: `tech.currency`.
- Start/investment cost: 6 materials, 8 credits; work: 0.
- Lease access to one exact improved luxury for four credits per delivery interval. Both parties pay one energy of transport upkeep and receive two credits of commerce. Access lasts four beats; duplicate luxuries do not duplicate amenities. This requires a versioned resource-access agreement, not a zero-cargo shipment.
- Gates: explicit-acceptance, actual-path-viable, both-parties-full-obligations-funded.
- Exact parameters: {"baseCadenceBeats": 4, "landCadence": "max(4,ceil(edges/2))", "payment": "construction once by proposer on acceptance; cargo only at due", "luxuryTerms": "For luxury-for-credit, source exact improved luxury ID grants access for one interval; no zero-cargo phantom resource"}.
- Cross-system use: Different supply chains and peaceful dependence.
- Delivery boundary: designed; proposed version is not applied.

### Coal for materials · `trade.coal-for-machinery`
- Designed capability gate: `exchange-catalogue-era-3` (not applied).
- Era 3; prerequisites: `tech.economics`.
- Start/investment cost: 6 materials, 8 credits; work: 0.
- Proposer sends 3 coal; partner sends 6 materials; each pays 1 energy and earns 2 credits only at an actual delivery.
- Gates: explicit-acceptance, actual-path-viable, both-parties-full-obligations-funded.
- Exact parameters: {"baseCadenceBeats": 4, "landCadence": "max(4,ceil(edges/2))", "payment": "construction once by proposer on acceptance; cargo only at due", "luxuryTerms": null}.
- Cross-system use: Different supply chains and peaceful dependence.
- Delivery boundary: designed; proposed version is not applied.

### Oil for electronics · `trade.oil-for-electronics`
- Designed capability gate: `exchange-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.economics`.
- Start/investment cost: 6 materials, 8 credits; work: 0.
- Proposer sends 3 oil; partner sends 2 electronics; each pays 1 energy and earns 2 credits only at an actual delivery.
- Gates: explicit-acceptance, actual-path-viable, both-parties-full-obligations-funded.
- Exact parameters: {"baseCadenceBeats": 4, "landCadence": "max(4,ceil(edges/2))", "payment": "construction once by proposer on acceptance; cargo only at due", "luxuryTerms": null}.
- Cross-system use: Different supply chains and peaceful dependence.
- Delivery boundary: designed; proposed version is not applied.

### Aluminum for energy · `trade.aluminum-for-energy`
- Designed capability gate: `exchange-catalogue-era-4` (not applied).
- Era 4; prerequisites: `tech.economics`.
- Start/investment cost: 6 materials, 8 credits; work: 0.
- Proposer sends 2 aluminum; partner sends 6 energy; each pays 1 energy and earns 2 credits only at an actual delivery.
- Gates: explicit-acceptance, actual-path-viable, both-parties-full-obligations-funded.
- Exact parameters: {"baseCadenceBeats": 4, "landCadence": "max(4,ceil(edges/2))", "payment": "construction once by proposer on acceptance; cargo only at due", "luxuryTerms": null}.
- Cross-system use: Different supply chains and peaceful dependence.
- Delivery boundary: designed; proposed version is not applied.

### Water for habitat parts · `trade.water-for-habitat`
- Designed capability gate: `exchange-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.spaceflight`.
- Start/investment cost: 6 materials, 8 credits; work: 0.
- Proposer sends 8 water; partner sends 2 habitat parts; each pays 1 energy and earns 2 credits only at an actual delivery.
- Gates: explicit-acceptance, actual-path-viable, both-parties-full-obligations-funded.
- Exact parameters: {"baseCadenceBeats": 4, "landCadence": "max(4,ceil(edges/2))", "payment": "construction once by proposer on acceptance; cargo only at due", "luxuryTerms": null}.
- Cross-system use: Different supply chains and peaceful dependence.
- Delivery boundary: designed; proposed version is not applied.

### Oxygen for food · `trade.oxygen-for-food`
- Designed capability gate: `exchange-catalogue-era-5` (not applied).
- Era 5; prerequisites: `tech.spaceflight`.
- Start/investment cost: 6 materials, 8 credits; work: 0.
- Proposer sends 6 oxygen; partner sends 6 food; each pays 1 energy and earns 2 credits only at an actual delivery.
- Gates: explicit-acceptance, actual-path-viable, both-parties-full-obligations-funded.
- Exact parameters: {"baseCadenceBeats": 4, "landCadence": "max(4,ceil(edges/2))", "payment": "construction once by proposer on acceptance; cargo only at due", "luxuryTerms": null}.
- Cross-system use: Different supply chains and peaceful dependence.
- Delivery boundary: designed; proposed version is not applied.

## Project catalogue (17)

### River dam · `project.river-dam`
- Designed capability gate: `world-projects-era-3` (not applied).
- Era 3; prerequisites: `tech.steam-power`.
- Start/investment cost: 50 materials, 24 credits; work: 24.
- Protect exact river floodplain from flood damage and unlock hydro plant; no invented river geometry
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": false}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Delivery boundary: designed; proposed version is not applied.

### Canal · `project.canal`
- Designed capability gate: `world-projects-era-3` (not applied).
- Era 3; prerequisites: `tech.steam-power`.
- Start/investment cost: 46 materials, 22 credits; work: 22.
- Open one exact flat-land connection between real water bodies; record topology change
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": false}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Delivery boundary: designed; proposed version is not applied.

### Protected landscape · `project.national-park`
- Designed capability gate: `world-projects-era-3` (not applied).
- Era 3; prerequisites: `civic.conservation`.
- Start/investment cost: 20 credits; work: 12.
- Four contiguous natural tiles; tourism8/beat and extraction forbidden
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": false}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Delivery boundary: designed; proposed version is not applied.

### World games · `project.world-games`
- Designed capability gate: `world-projects-era-4` (not applied).
- Era 4; prerequisites: `civic.internationalism`.
- Start/investment cost: 24 credits, 20 materials; work: 20.
- Each actual participating rival adds2 favor and8 tourism; duplicate hosting cooldown20
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": false}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Delivery boundary: designed; proposed version is not applied.

### Carbon capture · `project.carbon-capture`
- Designed capability gate: `world-projects-era-4` (not applied).
- Era 4; prerequisites: `tech.chemistry`, `civic.environmentalism`.
- Start/investment cost: 6 power, 4 credits; work: 12.
- Remove24 cumulative emission units at completion; never below0
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": true}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Delivery boundary: designed; proposed version is not applied.

### Reactor maintenance · `project.reactor-maintenance`
- Designed capability gate: `world-projects-era-4` (not applied).
- Era 4; prerequisites: `building.nuclear-plant`.
- Start/investment cost: 12 materials, 6 credits; work: 6.
- Reset exact plant operating-age to0; plant paused while maintained
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": true}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Delivery boundary: designed; proposed version is not applied.

### Launch satellite · `project.launch-satellite`
- Designed capability gate: `world-projects-era-4` (not applied).
- Era 4; prerequisites: `tech.rocketry`, `building.launchpad`.
- Start/investment cost: 40 materials, 6 electronics, 20 energy; work: 24.
- Commit satellite; reveal planetary terrain, not secret rival plans
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": false}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Connected successors: `milestone.space`, `project.mars-survey`, `project.moon-landing`.
- Delivery boundary: designed; proposed version is not applied.

### Moon landing · `project.moon-landing`
- Designed capability gate: `world-projects-era-4` (not applied).
- Era 4; prerequisites: `tech.satellites`, `project.launch-satellite`.
- Start/investment cost: 50 materials, 8 electronics, 24 energy; work: 28.
- Recorded lunar landing; culture40 once; begin lunar survey
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": false}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Connected successors: `milestone.space`, `project.orbital-depot`.
- Delivery boundary: designed; proposed version is not applied.

### Orbital depot · `project.orbital-depot`
- Designed capability gate: `world-projects-era-5` (not applied).
- Era 5; prerequisites: `tech.spaceflight`, `project.moon-landing`.
- Start/investment cost: 60 materials, 10 electronics, 16 propellant; work: 30.
- Orbital destination with cargo capacity40, maintenance energy2/beat
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": false}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Delivery boundary: designed; proposed version is not applied.

### Mars resource survey · `project.mars-survey`
- Designed capability gate: `world-projects-era-5` (not applied).
- Era 5; prerequisites: `tech.planetary-survey`, `project.launch-satellite`.
- Start/investment cost: 8 electronics, 12 propellant; work: 20.
- Reveal seed-determined Mars ice/mineral/radiation sites, no new random deposits on retry
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": false}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Connected successors: `project.mars-habitat-module`, `project.mars-hydroponics-module`, `project.mars-reactor-module`.
- Delivery boundary: designed; proposed version is not applied.

### Mars power module · `project.mars-reactor-module`
- Designed capability gate: `world-projects-era-5` (not applied).
- Era 5; prerequisites: `tech.nuclear-fusion`, `project.mars-survey`.
- Start/investment cost: 70 materials, 10 electronics, 20 propellant, 24 water; work: 32.
- After Earth construction and an eight-beat cargo journey, install a Mars power module producing sixteen electricity per beat. It consumes one water and one material per beat; a funded initial water manifest bootstraps it.
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": false, "transitBeats": 8, "destination": "exact surveyed Mars site", "completionOfConstructionIsNotArrival": true, "initialCargo": "Power module carries twenty-four water; habitat module carries twenty-four oxygen and twenty-four food. These are separately paid uncrewed setup reserves, not the crew transit ration."}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Connected successors: `project.mars-crew`.
- Delivery boundary: designed; proposed version is not applied.

### Mars habitat module · `project.mars-habitat-module`
- Designed capability gate: `world-projects-era-5` (not applied).
- Era 5; prerequisites: `tech.nanotechnology`, `tech.radiation-shielding`, `project.mars-survey`.
- Start/investment cost: 12 habitat parts, 8 electronics, 20 propellant, 24 oxygen, 24 food; work: 32.
- After construction and an eight-beat cargo journey, install pressure housing for six people. It creates no residents. Crew and real life-support reserves must arrive separately.
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": false, "transitBeats": 8, "destination": "exact surveyed Mars site", "completionOfConstructionIsNotArrival": true, "initialCargo": "Power module carries twenty-four water; habitat module carries twenty-four oxygen and twenty-four food. These are separately paid uncrewed setup reserves, not the crew transit ration."}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Connected successors: `project.mars-crew`.
- Delivery boundary: designed; proposed version is not applied.

### Mars food module · `project.mars-hydroponics-module`
- Designed capability gate: `world-projects-era-5` (not applied).
- Era 5; prerequisites: `tech.closed-loop-life-support`, `project.mars-survey`.
- Start/investment cost: 50 materials, 6 habitat parts, 20 propellant; work: 30.
- After construction and an eight-beat cargo journey, install a greenhouse and seed supply. It consumes two local water and three electricity to produce eight food. Initial water is imported.
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": false, "transitBeats": 8, "destination": "exact surveyed Mars site", "completionOfConstructionIsNotArrival": true, "initialCargo": "Power module carries twenty-four water; habitat module carries twenty-four oxygen and twenty-four food. These are separately paid uncrewed setup reserves, not the crew transit ration."}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Connected successors: `project.mars-crew`.
- Delivery boundary: designed; proposed version is not applied.

### Mars founding crew · `project.mars-crew`
- Designed capability gate: `world-projects-era-5` (not applied).
- Era 5; prerequisites: `project.mars-reactor-module`, `project.mars-habitat-module`, `project.mars-hydroponics-module`.
- Start/investment cost: 24 food, 24 water, 24 oxygen, 24 propellant; work: 24.
- After preparation and an eight-beat journey, transfer six actual Earth residents to the declared Mars habitat, leaving at least three at their source. Arrival requires intact shelter and funded life support.
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": false, "sourceResidents": 6, "minimumSourceRemainder": 3, "transitBeats": 8, "requiresArrivedModules": true, "transitConsumption": {"food": 24, "water": 24, "oxygen": 24}, "arrivalSafetyGate": "At least four beats of resident life-support reserves already landed, after any setup operations. Hold departure if this is not funded."}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Connected successors: `milestone.mars`, `project.mars-local-industry`, `project.mars-resupply`, `victory.mars`.
- Delivery boundary: designed; proposed version is not applied.

### Mars resupply · `project.mars-resupply`
- Designed capability gate: `world-projects-era-5` (not applied).
- Era 5; prerequisites: `project.mars-crew`, `building.orbital-freight-terminal`.
- Start/investment cost: 12 propellant, 10 credits; work: 8.
- Prepare an exact manifest of at most twenty cargo units, debit it at departure and credit it once after an eight-beat journey. No receipt is issued merely for planning the launch.
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": true, "massAccounting": "Every food, water, oxygen, material, electronics or habitat-part unit counts one cargo unit; propellant consumed by transport is separate."}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Delivery boundary: designed; proposed version is not applied.

### Mars evacuation · `project.mars-evacuation`
- Era 5; prerequisites: `agreement.orbital-rescue`.
- Start/investment cost: 12 propellant, 24 food, 24 water, 24 oxygen; work: 6.
- Prepare one to six existing residents for an eight-beat journey to a named safe destination. Reserve twenty-four food, twenty-four water and twenty-four oxygen for the full six-seat package, plus twelve propellant; movement conserves people. Consume only the boarded cohort’s exact per-beat ration and retain unused prepaid supplies as arrival cargo.
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": true, "maximumResidents": 6, "minimumResidents": 1, "transitBeats": 8, "transitReserve": {"food": 24, "water": 24, "oxygen": 24}, "consumptionPerResidentPerBeat": {"food": 0.5, "water": 0.5, "oxygen": 0.5}, "unconsumedReserve": "Remains on the named vessel and is credited once at its actual arrival; it is never charged or granted twice.", "departureSupplyGate": "All manifest resources, seats and a consenting safe destination must exist before departure.", "propellantScope": "Twelve is the provisional Mars departure requirement; four reserved by an orbital rescue compact may fund part of it only through an exact transfer, never an additional free credit."}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Designed capability gates: `world-projects-era-5`.
- Delivery boundary: designed; proposed version is not applied.

### Mars local industry · `project.mars-local-industry`
- Designed capability gate: `world-projects-era-5` (not applied).
- Era 5; prerequisites: `tech.in-situ-resource-use`, `project.mars-crew`.
- Start/investment cost: 8 habitat parts, 6 electronics; work: 24.
- Commission local extraction and repair facilities from delivered supplies. Actual later operation is needed for independence; the completion flag alone does not satisfy the Mars victory.
- Gates: exact-owner-or-consenting-parties, capability-release-applied.
- Exact parameters: {"paid": "once-at-start", "completion": "after-opening-work; no same-beat output", "repeatable": false}.
- Cross-system use: Terrain, diplomacy, climate or a real off-world supply chain.
- Connected successors: `victory.mars`.
- Delivery boundary: designed; proposed version is not applied.

## Wonder catalogue (7)

### Great library · `wonder.great-library`
- Designed capability gate: `unique-wonders-era-1` (not applied).
- Era 1; prerequisites: `tech.writing`.
- Start/investment cost: 50 materials, 25 credits; work: 24.
- Science +4; one recorded20% boost to two uncompleted ancient/classical techs
- Gates: one-completed-per-world, exact-unique-reservation.
- Exact parameters: {"losingReservation": "unfinished work returns50% materials; no duplicate wonder or erased paid record"}.
- Cross-system use: Visible civilization identity and contestable cultural/scientific investment.
- Delivery boundary: designed; proposed version is not applied.

### Great lighthouse · `wonder.great-lighthouse`
- Designed capability gate: `unique-wonders-era-1` (not applied).
- Era 1; prerequisites: `tech.celestial-navigation`.
- Start/investment cost: 48 materials, 24 credits; work: 24.
- Owned naval movement +1; harbor tourism3
- Gates: one-completed-per-world, exact-unique-reservation.
- Exact parameters: {"losingReservation": "unfinished work returns50% materials; no duplicate wonder or erased paid record"}.
- Cross-system use: Visible civilization identity and contestable cultural/scientific investment.
- Delivery boundary: designed; proposed version is not applied.

### Colosseum · `wonder.colosseum`
- Designed capability gate: `unique-wonders-era-1` (not applied).
- Era 1; prerequisites: `tech.construction`.
- Start/investment cost: 54 materials, 27 credits; work: 26.
- Amenities +3 andculture3 within6landedges
- Gates: one-completed-per-world, exact-unique-reservation.
- Exact parameters: {"losingReservation": "unfinished work returns50% materials; no duplicate wonder or erased paid record"}.
- Cross-system use: Visible civilization identity and contestable cultural/scientific investment.
- Delivery boundary: designed; proposed version is not applied.

### Forbidden palace · `wonder.forbidden-palace`
- Designed capability gate: `unique-wonders-era-2` (not applied).
- Era 2; prerequisites: `tech.printing`.
- Start/investment cost: 70 materials, 35 credits; work: 30.
- Wildcard policy slot +1; culture4
- Gates: one-completed-per-world, exact-unique-reservation.
- Exact parameters: {"losingReservation": "unfinished work returns50% materials; no duplicate wonder or erased paid record"}.
- Cross-system use: Visible civilization identity and contestable cultural/scientific investment.
- Delivery boundary: designed; proposed version is not applied.

### Industrial exhibition · `wonder.industrial-exhibition`
- Designed capability gate: `unique-wonders-era-3` (not applied).
- Era 3; prerequisites: `tech.industrialization`.
- Start/investment cost: 90 materials, 45 credits; work: 36.
- Actual host factory +4materials; visiting partners culture4 once
- Gates: one-completed-per-world, exact-unique-reservation.
- Exact parameters: {"losingReservation": "unfinished work returns50% materials; no duplicate wonder or erased paid record"}.
- Cross-system use: Visible civilization identity and contestable cultural/scientific investment.
- Delivery boundary: designed; proposed version is not applied.

### World heritage center · `wonder.world-heritage-center`
- Designed capability gate: `unique-wonders-era-4` (not applied).
- Era 4; prerequisites: `tech.computing`.
- Start/investment cost: 110 materials, 55 credits; work: 40.
- Tourism +25% from protected sites; congress hosting option
- Gates: one-completed-per-world, exact-unique-reservation.
- Exact parameters: {"losingReservation": "unfinished work returns50% materials; no duplicate wonder or erased paid record"}.
- Cross-system use: Visible civilization identity and contestable cultural/scientific investment.
- Delivery boundary: designed; proposed version is not applied.

### Orbital observatory · `wonder.orbital-observatory`
- Designed capability gate: `unique-wonders-era-5` (not applied).
- Era 5; prerequisites: `tech.spaceflight`.
- Start/investment cost: 140 materials, 70 credits; work: 48.
- Science +24 with power6; shared sky-survey project unlock
- Gates: one-completed-per-world, exact-unique-reservation.
- Exact parameters: {"losingReservation": "unfinished work returns50% materials; no duplicate wonder or erased paid record"}.
- Cross-system use: Visible civilization identity and contestable cultural/scientific investment.
- Delivery boundary: designed; proposed version is not applied.

## Belief catalogue (6)

### Stewardship · `belief.stewardship`
- Designed capability gate: `belief-and-heritage-era-0` (not applied).
- Era 0; prerequisites: `civic.mysticism`.
- Start/investment cost: 25 faith; work: 0.
- Forest preservation givesfaith1/culture1 per workedforest; clearing losesbonus
- Gates: one-pantheon-per-civ, religion-slot-limit.
- Exact parameters: {"religionLimit": 3, "spread": "faith-funded visits add10pressure; no forced actor conversion", "majority": "strictly more than half city follower counts", "counterplay": "religious freedom policy and funded local teaching"}.
- Cross-system use: Faith, voluntary cultural influence and institutional identity.
- Delivery boundary: designed; proposed version is not applied.

### River community · `belief.river-community`
- Designed capability gate: `belief-and-heritage-era-0` (not applied).
- Era 0; prerequisites: `civic.mysticism`.
- Start/investment cost: 25 faith; work: 0.
- Supplied irrigation town gainsfaith2; no bonus from absent river
- Gates: one-pantheon-per-civ, religion-slot-limit.
- Exact parameters: {"religionLimit": 3, "spread": "faith-funded visits add10pressure; no forced actor conversion", "majority": "strictly more than half city follower counts", "counterplay": "religious freedom policy and funded local teaching"}.
- Cross-system use: Faith, voluntary cultural influence and institutional identity.
- Delivery boundary: designed; proposed version is not applied.

### Scholarship · `belief.scholarship`
- Designed capability gate: `belief-and-heritage-era-0` (not applied).
- Era 0; prerequisites: `civic.mysticism`.
- Start/investment cost: 25 faith; work: 0.
- Active temple provides science2 while funded
- Gates: one-pantheon-per-civ, religion-slot-limit.
- Exact parameters: {"religionLimit": 3, "spread": "faith-funded visits add10pressure; no forced actor conversion", "majority": "strictly more than half city follower counts", "counterplay": "religious freedom policy and funded local teaching"}.
- Cross-system use: Faith, voluntary cultural influence and institutional identity.
- Delivery boundary: designed; proposed version is not applied.

### Pilgrimage · `belief.pilgrimage`
- Designed capability gate: `belief-and-heritage-era-0` (not applied).
- Era 0; prerequisites: `civic.mysticism`.
- Start/investment cost: 25 faith; work: 0.
- Consenting visit giveshostcredits2 andvisitorculture2, onceperrouteinterval
- Gates: one-pantheon-per-civ, religion-slot-limit.
- Exact parameters: {"religionLimit": 3, "spread": "faith-funded visits add10pressure; no forced actor conversion", "majority": "strictly more than half city follower counts", "counterplay": "religious freedom policy and funded local teaching"}.
- Cross-system use: Faith, voluntary cultural influence and institutional identity.
- Delivery boundary: designed; proposed version is not applied.

### Charity · `belief.charity`
- Designed capability gate: `belief-and-heritage-era-0` (not applied).
- Era 0; prerequisites: `civic.mysticism`.
- Start/investment cost: 25 faith; work: 0.
- Actual relief donationfood4 yieldsfavor1 andfaith2 once
- Gates: one-pantheon-per-civ, religion-slot-limit.
- Exact parameters: {"religionLimit": 3, "spread": "faith-funded visits add10pressure; no forced actor conversion", "majority": "strictly more than half city follower counts", "counterplay": "religious freedom policy and funded local teaching"}.
- Cross-system use: Faith, voluntary cultural influence and institutional identity.
- Delivery boundary: designed; proposed version is not applied.

### Sacred art · `belief.sacred-art`
- Designed capability gate: `belief-and-heritage-era-0` (not applied).
- Era 0; prerequisites: `civic.mysticism`.
- Start/investment cost: 25 faith; work: 0.
- Housed religious works tourism3; Enlightenment tourismmodifier0.5 unless cultural-heritage policy
- Gates: one-pantheon-per-civ, religion-slot-limit.
- Exact parameters: {"religionLimit": 3, "spread": "faith-funded visits add10pressure; no forced actor conversion", "majority": "strictly more than half city follower counts", "counterplay": "religious freedom policy and funded local teaching"}.
- Cross-system use: Faith, voluntary cultural influence and institutional identity.
- Delivery boundary: designed; proposed version is not applied.

## Director Event catalogue (14)

### The rains fail · `event.drought`
- Designed capability gate: `director-event-catalogue-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Remove twelve food from the target reserve, clamped at zero, and ten wellbeing. Record the actual loss. This is the current released one-shot effect, not an invented persistent weather duration.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 2, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Irrigation,food trade,relief.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### The earth moves · `event.earthquake`
- Designed capability gate: `director-event-catalogue-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Add thirty-five damage to the exact city and twenty-five to affected connected routes. Under the recovery release, preserve buildings, infrastructure and population. Record actual clamped changes.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 3, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Paid repair,joint road charter.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### A rich seam · `event.resource-boom`
- Designed capability gate: `director-event-catalogue-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Add eighteen materials and eight energy, plus three legitimacy, once to the named civilization. Follow with a real investment choice rather than repeated grants.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 2, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Choose construction or export.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

### The river rises · `event.flood`
- Designed capability gate: `director-event-catalogue-era-1` (not applied).
- Era 1; prerequisites: none.
- Start/investment cost: none; work: 0.
- On a real floodplain, add twenty-five damage to unprotected improvements. An intact dam prevents damage. After recovery, the affected fertile tile may gain one food; retain that actual terrain change.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 4, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Dam placement and relief.
- Delivery boundary: designed; proposed version is not applied.

### A spreading illness · `event.plague`
- Designed capability gate: `director-event-catalogue-era-1` (not applied).
- Era 1; prerequisites: none.
- Start/investment cost: none; work: 0.
- Reduce the affected town’s health by twenty over four beats. There is no instant shock death. Food shortages increase exposure; sanitation and hospitals reduce it.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 6, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Sanitation,hospital,route quarantine byconsent.
- Delivery boundary: designed; proposed version is not applied.

### A useful discovery · `event.discovery`
- Designed capability gate: `director-event-catalogue-era-1` (not applied).
- Era 1; prerequisites: none.
- Start/investment cost: none; work: 0.
- Boost one eligible current research project by twenty percent of its snapshotted cost, capped at its remainder. With no eligible project, retain a clue rather than fabricate progress.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 4, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Actual targetedscience.
- Delivery boundary: designed; proposed version is not applied.

### Workers demand a voice · `event.labor-dispute`
- Designed capability gate: `director-event-catalogue-era-3` (not applied).
- Era 3; prerequisites: none.
- Start/investment cost: none; work: 0.
- In an industrial town with low amenities, multiply construction work by 0.75 for four beats. Funded welfare can end the dispute early; retain the exact cause and response.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 6, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Policy,reform,negotiatedwages.
- Delivery boundary: designed; proposed version is not applied.

### Credit panic · `event.market-panic`
- Designed capability gate: `director-event-catalogue-era-3` (not applied).
- Era 3; prerequisites: none.
- Start/investment cost: none; work: 0.
- Pause new loan offers for four beats. Existing obligations remain. Change credits only through an actual recorded asset exposure or settlement, not an arbitrary global treasury subtraction.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 8, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Reserves,transparentrelief.
- Delivery boundary: designed; proposed version is not applied.

### A speculative fever · `event.crypto-boom`
- Designed capability gate: `director-event-catalogue-era-4` (not applied).
- Era 4; prerequisites: none.
- Start/investment cost: none; work: 0.
- Offer an optional speculative asset costing ten credits. Four beats after acceptance, a seeded result pays zero or eighteen, with its committed randomness auditable. No participation is inferred.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 8, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Optout,regulatedallocation; no financial advice.
- Delivery boundary: designed; proposed version is not applied.

### Visitors in the sky · `event.ufo-contact`
- Designed capability gate: `director-event-catalogue-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Record an unidentified observation. A voluntary study costing eight science and four credits yields a twenty-percent current-project boost or a documented null result. Do not assert extraterrestrial contact before evidence.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 10, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Science,belief,diplomacy.
- Delivery boundary: designed; proposed version is not applied.

### Solar storm · `event.solar-storm`
- Designed capability gate: `director-event-catalogue-era-4` (not applied).
- Era 4; prerequisites: none.
- Start/investment cost: none; work: 0.
- For two beats, exposed grids and cables produce half output. Hardened infrastructure is protected. Retain exact affected assets and expiry.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 8, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Storage,distributedgeneration,repair.
- Delivery boundary: designed; proposed version is not applied.

### Mars dust storm · `event.dust-storm`
- Designed capability gate: `director-event-catalogue-era-5` (not applied).
- Era 5; prerequisites: none.
- Start/investment cost: none; work: 0.
- For four beats, solar output at the targeted Mars region falls to one quarter. Habitats remain present. Reserves, backup generation and real resupply provide responses.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 8, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Storedpower,nuclearbackup,realresupply.
- Delivery boundary: designed; proposed version is not applied.

### Life-support leak · `event.life-support-leak`
- Designed capability gate: `director-event-catalogue-era-5` (not applied).
- Era 5; prerequisites: none.
- Start/investment cost: none; work: 0.
- The exact habitat loses two oxygen each beat for three beats or until a paid repair completes. Existing reserves protect residents before any health effect.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 8, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Maintenance,resupply,rescue.
- Delivery boundary: designed; proposed version is not applied.

### A quiet season · `event.calm`
- Designed capability gate: `director-event-catalogue-era-0` (not applied).
- Era 0; prerequisites: none.
- Start/investment cost: none; work: 0.
- Add no new shock. Current work, production, movement and commitments continue under their ordinary rules.
- Gates: implemented-effects-only, current-snapshot-consultation, stable-event-command-id.
- Exact parameters: {"cooldownStrategyBeats": 0, "candidateProbability": "Director deliberation; no automatic mandatory disaster", "calendarYears": 0, "targets": "exact affected IDs; mitigation checked before effects", "hazardRequires": "actual matching terrain/infrastructure/exposure, never the mitigation building itself"}.
- Cross-system use: Letactorsrespond.
- Delivery boundary: a legacy/live counterpart exists; use the separate captured runtime definition for actual play. This designed version is not applied.

## Milestone catalogue (7)

### The first fields · `milestone.first-fields`
- Designed capability gate: `evidence-led-ages-era-0` (not applied).
- Era 0; prerequisites: `tech.agriculture`, `building.farm`.
- Start/investment cost: none; work: 0.
- Require an actual first farm production receipt. Construction alone is called the first fields, not a harvest.
- unlock-age: {"era": 0}
- Exact parameters: {"calendarEffect": 0, "discretionaryAdvance": "separate explained operation, never implicit date assignment"}.
- Cross-system use: Explain capability-era changes using real world causes.
- Delivery boundary: designed; proposed version is not applied.

### Cities and states · `milestone.states`
- Designed capability gate: `evidence-led-ages-era-1` (not applied).
- Era 1; prerequisites: `tech.civic-institutions`.
- Start/investment cost: none; work: 0.
- Require two civilizations to complete Civic institutions and three consented routes to deliver. Preserve the already observed rise-of-states milestone.
- unlock-age: {"era": 1}
- Exact parameters: {"calendarEffect": 0, "discretionaryAdvance": "separate explained operation, never implicit date assignment"}.
- Cross-system use: Explain capability-era changes using real world causes.
- Delivery boundary: designed; proposed version is not applied.

### A connected world · `milestone.connected`
- Designed capability gate: `evidence-led-ages-era-2` (not applied).
- Era 2; prerequisites: `tech.navigation`, `building.boat-yard`.
- Start/investment cost: none; work: 0.
- Require an actual conserved coastal founding outside ordinary frontier reach, plus three working trade routes.
- unlock-age: {"era": 2}
- Exact parameters: {"calendarEffect": 0, "discretionaryAdvance": "separate explained operation, never implicit date assignment"}.
- Cross-system use: Explain capability-era changes using real world causes.
- Delivery boundary: designed; proposed version is not applied.

### The industrial transformation · `milestone.industrial`
- Designed capability gate: `evidence-led-ages-era-3` (not applied).
- Era 3; prerequisites: `tech.industrialization`, `building.foundry`.
- Start/investment cost: none; work: 0.
- Require two supplied foundries to produce and one steam route to deliver. These can be reached from the previous age; do not require a factory that this milestone itself unlocks.
- unlock-age: {"era": 3}
- Exact parameters: {"calendarEffect": 0, "discretionaryAdvance": "separate explained operation, never implicit date assignment"}.
- Cross-system use: Explain capability-era changes using real world causes.
- Delivery boundary: designed; proposed version is not applied.

### A planetary society · `milestone.planetary`
- Designed capability gate: `evidence-led-ages-era-4` (not applied).
- Era 4; prerequisites: `tech.computing`, `building.broadcast-center`.
- Start/investment cost: none; work: 0.
- Require actual powered broadcasting in two civilizations and five working international routes. A computing label alone is insufficient.
- unlock-age: {"era": 4}
- Exact parameters: {"calendarEffect": 0, "discretionaryAdvance": "separate explained operation, never implicit date assignment"}.
- Cross-system use: Explain capability-era changes using real world causes.
- Delivery boundary: designed; proposed version is not applied.

### Beyond Earth · `milestone.space`
- Designed capability gate: `evidence-led-ages-era-5` (not applied).
- Era 5; prerequisites: `project.launch-satellite`, `project.moon-landing`.
- Start/investment cost: none; work: 0.
- Require an actual satellite and lunar arrival supported by working Earth electricity and electronics supply.
- unlock-age: {"era": 5}
- Exact parameters: {"calendarEffect": 0, "discretionaryAdvance": "separate explained operation, never implicit date assignment"}.
- Cross-system use: Explain capability-era changes using real world causes.
- Delivery boundary: designed; proposed version is not applied.

### People on Mars · `milestone.mars`
- Designed capability gate: `evidence-led-ages-era-5` (not applied).
- Era 5; prerequisites: `project.mars-crew`.
- Start/investment cost: none; work: 0.
- Require conserved crew arrival and the first fully funded life-support beat. The sustained victory window remains a separate condition.
- unlock-age: {"era": 5}
- Exact parameters: {"calendarEffect": 0, "discretionaryAdvance": "separate explained operation, never implicit date assignment"}.
- Cross-system use: Explain capability-era changes using real world causes.
- Delivery boundary: designed; proposed version is not applied.

## Espionage Mission catalogue (6)

### Gather sources · `mission.gather-sources`
- Designed capability gate: `bounded-intelligence-era-2` (not applied).
- Era 2; prerequisites: `unit.spy`.
- Start/investment cost: 4 credits; work: 3.
- Gain access to the target town’s current public production and route schedule for six beats; no private model reasoning.
- Gates: capability-release-applied, canonical-target-eligibility.
- Exact parameters: {"workUnit": "strategic beats after establishment", "baseSuccessProbability": 0.9, "randomness": "Seeded outcome committed at mission start, revealed at resolution; command retries do not reroll.", "exposureGrievance": 10, "failedHostileMission": "Spy captured on the lower half of the failure interval; otherwise revealed and returned."}.
- Cross-system use: Counterplay through diplomacy, spending and local protection.
- Delivery boundary: designed; proposed version is not applied.

### Acquire research notes · `mission.steal-knowledge`
- Designed capability gate: `bounded-intelligence-era-2` (not applied).
- Era 2; prerequisites: `unit.spy`.
- Start/investment cost: 8 credits; work: 4.
- Gain twenty percent progress toward one technology already completed by the target and currently eligible to you; never grant missing prerequisites.
- Gates: capability-release-applied, canonical-target-eligibility.
- Exact parameters: {"workUnit": "strategic beats after establishment", "baseSuccessProbability": 0.55, "randomness": "Seeded outcome committed at mission start, revealed at resolution; command retries do not reroll.", "exposureGrievance": 10, "failedHostileMission": "Spy captured on the lower half of the failure interval; otherwise revealed and returned."}.
- Cross-system use: Counterplay through diplomacy, spending and local protection.
- Delivery boundary: designed; proposed version is not applied.

### Disrupt production · `mission.disrupt-production`
- Designed capability gate: `bounded-intelligence-era-2` (not applied).
- Era 2; prerequisites: `unit.spy`.
- Start/investment cost: 10 credits; work: 4.
- Apply twenty-five damage to one named industrial building for later paid repair; no population damage or invented theft.
- Gates: capability-release-applied, canonical-target-eligibility.
- Exact parameters: {"workUnit": "strategic beats after establishment", "baseSuccessProbability": 0.5, "randomness": "Seeded outcome committed at mission start, revealed at resolution; command retries do not reroll.", "exposureGrievance": 10, "failedHostileMission": "Spy captured on the lower half of the failure interval; otherwise revealed and returned."}.
- Cross-system use: Counterplay through diplomacy, spending and local protection.
- Delivery boundary: designed; proposed version is not applied.

### Intercept cargo · `mission.intercept-trade`
- Designed capability gate: `bounded-intelligence-era-2` (not applied).
- Era 2; prerequisites: `unit.spy`.
- Start/investment cost: 10 credits; work: 4.
- On one future eligible physical shipment, transfer up to four cargo units from an actual intercepted manifest; logical legacy routes are ineligible.
- Gates: capability-release-applied, canonical-target-eligibility.
- Exact parameters: {"workUnit": "strategic beats after establishment", "baseSuccessProbability": 0.45, "randomness": "Seeded outcome committed at mission start, revealed at resolution; command retries do not reroll.", "exposureGrievance": 10, "failedHostileMission": "Spy captured on the lower half of the failure interval; otherwise revealed and returned."}.
- Cross-system use: Counterplay through diplomacy, spending and local protection.
- Delivery boundary: designed; proposed version is not applied.

### Counterintelligence · `mission.counterspy`
- Designed capability gate: `bounded-intelligence-era-2` (not applied).
- Era 2; prerequisites: `unit.spy`.
- Start/investment cost: 6 credits; work: 4.
- Protect one owned city for eight beats, reducing hostile mission success chance by0.3.
- Gates: capability-release-applied, canonical-target-eligibility.
- Exact parameters: {"workUnit": "strategic beats after establishment", "baseSuccessProbability": 1.0, "randomness": "Seeded outcome committed at mission start, revealed at resolution; command retries do not reroll.", "exposureGrievance": 10, "failedHostileMission": "Spy captured on the lower half of the failure interval; otherwise revealed and returned."}.
- Cross-system use: Counterplay through diplomacy, spending and local protection.
- Delivery boundary: designed; proposed version is not applied.

### Protect civic integrity · `mission.secure-elections`
- Designed capability gate: `bounded-intelligence-era-2` (not applied).
- Era 2; prerequisites: `unit.spy`.
- Start/investment cost: 8 credits; work: 4.
- Remove one actual propaganda disruption and protect the city’s legitimacy for four beats; it cannot fabricate consent.
- Gates: capability-release-applied, canonical-target-eligibility.
- Exact parameters: {"workUnit": "strategic beats after establishment", "baseSuccessProbability": 1.0, "randomness": "Seeded outcome committed at mission start, revealed at resolution; command retries do not reroll.", "exposureGrievance": 10, "failedHostileMission": "Spy captured on the lower half of the failure interval; otherwise revealed and returned."}.
- Cross-system use: Counterplay through diplomacy, spending and local protection.
- Delivery boundary: designed; proposed version is not applied.

## Action catalogue (26)

### Choose research · `action.choose-research`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `rule.research-flow`.
- Start/investment cost: none; work: 0.
- Select an eligible technology; no investment on selection. An existing commitment requires a separately released explicit switch.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Choose civic · `action.choose-civic`
- Era 0; prerequisites: `rule.research-flow`.
- Start/investment cost: none; work: 0.
- Select one eligible cultural project, including Code of laws when the released civic lane is empty. Track progress separately from scientific research; no starting civic completion is fabricated.
- Gates: civic-projects-release-applied, eligible-current-civic.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Designed capability gates: `structured-action-catalogue-era-0`, `civic-programs-era-0`.
- Delivery boundary: designed; proposed version is not applied.

### Start production · `action.start-production`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `rule.construction`.
- Start/investment cost: none; work: 0.
- Name exact city and catalogue item; pay its immutable listed start cost once and retain a timed order.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Set city focus · `action.set-focus`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `rule.population`.
- Start/investment cost: none; work: 0.
- Name one owned town and growth, industry, science, culture or diplomacy focus. Only future opening work changes.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Pause or resume operation · `action.pause-operation`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `rule.economy`.
- Start/investment cost: none; work: 0.
- Name an installed owned building; toggle future operation without rewriting its last paid/output receipt.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Found a frontier town · `action.found-land`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `tech.agriculture`.
- Start/investment cost: 10 food, 12 materials, 8 credits; work: 0.
- Name exact owned source and legal land target; atomically move three residents, leaving at least three.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Found a coastal town · `action.found-coast`
- Designed capability gate: `structured-action-catalogue-era-2` (not applied).
- Era 2; prerequisites: `tech.navigation`, `building.boat-yard`.
- Start/investment cost: 10 food, 12 materials, 8 credits; work: 0.
- Name exact coastal source, target and quoted ocean path; move three residents to a genuinely unavailable ordinary-frontier destination. This released small step is distinct from later travel simulation.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Repair city · `action.repair-city`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `rule.economy`.
- Start/investment cost: 5 materials, 2 energy; work: 0.
- Reduce exact owned city damage by min(25,current damage); retain paid resources and actual before/after values.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Repair route · `action.repair-route`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `trade.harvest-for-materials`.
- Start/investment cost: 5 materials, 2 energy; work: 0.
- Repair an owned agreement route by at most twenty-five damage; does not imply delivery.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Propose exchange · `action.propose-trade`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `rule.markets`.
- Start/investment cost: none; work: 0.
- Name exact endpoint towns, immutable recipe and path quote; no recipient payment or shipment.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Accept exchange · `action.accept-trade`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `rule.markets`.
- Start/investment cost: none; work: 0.
- Recipient accepts exact current terms; proposer pays quoted construction once; first due round derives from acceptance.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Stop exchange · `action.stop-trade`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `rule.markets`.
- Start/investment cost: none; work: 0.
- Either party ends future shipments; preserve historical deliveries and binding public projects until their own resolution.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Propose public charter · `action.propose-charter`
- Designed capability gate: `structured-action-catalogue-era-1` (not applied).
- Era 1; prerequisites: `agreement.joint-road-repair`.
- Start/investment cost: none; work: 0.
- Name exact eligible original agreement, target and versioned contributions; no reserve or spend before due fulfillment.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Accept or decline charter · `action.respond-charter`
- Designed capability gate: `structured-action-catalogue-era-1` (not applied).
- Era 1; prerequisites: `agreement.joint-road-repair`.
- Start/investment cost: none; work: 0.
- Named partner decides independently; acceptance revalidates institutions and affordability but spends nothing.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Cancel public charter · `action.cancel-charter`
- Designed capability gate: `structured-action-catalogue-era-1` (not applied).
- Era 1; prerequisites: `agreement.joint-road-repair`.
- Start/investment cost: none; work: 0.
- Either named member may cancel before due settlement, retaining why and without imaginary refund.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Assign resident work · `action.assign-worker`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `rule.population`.
- Start/investment cost: none; work: 0.
- Assign one available local resident to an eligible tile or specialist slot; preview opportunity cost and do not duplicate population.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Offer voluntary relocation · `action.migrate`
- Designed capability gate: `structured-action-catalogue-era-1` (not applied).
- Era 1; prerequisites: `rule.culture`.
- Start/investment cost: 2 food; work: 0.
- Both city owners consent to one resident moving over a viable path; reserve destination housing and retain departure/arrival identity.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Move unit · `action.move-unit`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `rule.movement`.
- Start/investment cost: none; work: 0.
- Submit one exact route intent within remaining movement budget; resolve contested destinations deterministically.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Denounce a civilization · `action.denounce`
- Era 0; prerequisites: `rule.combat`.
- Start/investment cost: none; work: 0.
- Name one met rival and record a public denouncement with its round. This does not declare war, grant attack permission or spend another actor’s resources.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice.", "exactTarget": "met living rival civilization, never self", "denouncementNoticeBeats": 5, "repeatedNotice": "Idempotent command retries preserve the original timestamp; a fresh repeated notice cannot reduce the formal-war waiting period."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Connected successors: `action.declare-war`.
- Designed capability gates: `structured-action-catalogue-era-0`.
- Delivery boundary: designed; proposed version is not applied.

### Declare war · `action.declare-war`
- Era 0; prerequisites: `rule.combat`.
- Start/investment cost: none; work: 0.
- Name one met rival and choose surprise, formal or liberation grounds. Atomically record the bilateral war relation and thirty, fifteen or zero grievances respectively. An existing war is not declared twice. A formal declaration requires a retained denouncement at least five strategic beats old; liberation requires a recorded currently occupied city and names its original owner. An active ten-beat peace agreement blocks the declaration.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice.", "exactTarget": "met living rival civilization, never self", "grounds": ["surprise", "formal", "liberation"], "grievances": {"surprise": 30, "formal": 15, "liberation": 0}, "formalRequires": "Exact actor-to-target denouncement retained for at least five strategic beats.", "liberationRequires": "Exact occupied city, current occupier equal to the target, original owner different from the declarer and recorded restoration objective.", "peaceGuard": "Refuse while the exact bilateral peace agreement is in its ten-beat protected period; ordinary cancellation cannot erase this protection.", "atomicResult": "Relation and grievances commit once together; attacking remains a separate exact unit action."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Connected successors: `action.attack`.
- Designed capability gates: `structured-action-catalogue-era-0`.
- Delivery boundary: designed; proposed version is not applied.

### Attack declared enemy · `action.attack`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `rule.combat`.
- Start/investment cost: none; work: 0.
- Exact unit and target, legal war and range, one attack per strategic beat; show canonical damage preview.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Adopt government · `action.adopt-government`
- Designed capability gate: `structured-action-catalogue-era-1` (not applied).
- Era 1; prerequisites: `civic.political-philosophy`.
- Start/investment cost: 10 credits; work: 0.
- Choose unlocked government and a legal policy assignment; free only on actual civic completion.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Cast Congress ballot · `action.vote`
- Designed capability gate: `structured-action-catalogue-era-2` (not applied).
- Era 2; prerequisites: `civic.diplomatic-service`.
- Start/investment cost: none; work: 0.
- Select an eligible resolution and exact paid extra votes before deadline; no effect until the public tally.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Launch exact manifest · `action.launch-cargo`
- Designed capability gate: `structured-action-catalogue-era-5` (not applied).
- Era 5; prerequisites: `building.orbital-freight-terminal`.
- Start/investment cost: 12 propellant; work: 0.
- Reserve launch capacity, debit named cargo once and create an arrival-due record for the actual destination.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Finish current choices · `action.hold`
- Designed capability gate: `structured-action-catalogue-era-0` (not applied).
- Era 0; prerequisites: `rule.construction`.
- Start/investment cost: none; work: 0.
- Allowed only when no required research/civic/city production decision has a valid choice. Explicit blocked reasons and active work remain visible; other actors and strategy continue.
- Gates: capability-release-applied.
- Exact parameters: {"admission": "One exact action in the actor window; strict revision and idempotent command ID.", "plans": "At most two explicit intentions; never automatically execute another model choice."}.
- Cross-system use: Named cross-system successor and committed spectator consequence.
- Delivery boundary: designed; proposed version is not applied.

### Form corps or army · `action.form-corps`
- Designed capability gate: `structured-action-catalogue-era-3` (not applied).
- Era 3; prerequisites: `civic.nationalism`.
- Start/investment cost: 12 credits; work: 0.
- Combine two same-class, co-located and supplied units into one corps with strength plus ten. Preserve all recruited resident provenance and combine health proportionally. Mobilization permits a third unit for an army with strength plus seventeen; units and equipment are not duplicated.
- Gates: capability-release-applied, canonical-target-eligibility.
- Exact parameters: {"corpsUnits": 2, "armyUnits": 3, "corpsStrengthBonus": 10, "armyStrengthBonus": 17, "armyRequires": "civic.mobilization"}.
- Cross-system use: Military concentration, supply cost and tactical map space.
- Delivery boundary: designed; proposed version is not applied.

## Victory catalogue (5)

### A living world on Mars · `victory.mars`
- Designed capability gate: `contested-victories-era-5` (not applied).
- Era 5; prerequisites: `project.mars-crew`, `project.mars-local-industry`.
- Start/investment cost: none; work: 0.
- Maintain at least six conserved residents on Mars for twelve consecutive beats, with all shelter, food, water, oxygen and electricity needs funded. At least half of food, water and oxygen consumed in that window must be produced locally. Retain six real evacuation seats.
- Gates: implemented-and-applied-victory-rule, actual-world-evidence.
- Exact parameters: {"provisionalThresholds": true, "resolution": "all predicates checked on same committed beat; simultaneous qualifying civilizations share run outcome", "restart": "explicit newrun withnewID/seed,archiveoldworld; processrestartreloadssameworld", "minimumResidents": 6, "sustainedBeats": 12, "requiredLocallyProducedFraction": 0.5, "locallyProducedResources": ["food", "water", "oxygen"], "evacuationSeats": 6}.
- Cross-system use: Interdictsupply,competeinindustry,cooperatebycharter; nonewresidentsfromscore.
- Delivery boundary: designed; proposed version is not applied.

### A lasting federation · `victory.federation`
- Designed capability gate: `contested-victories-era-4` (not applied).
- Era 4; prerequisites: `agreement.federation`, `building.world-forum`.
- Start/investment cost: none; work: 0.
- At least three independent civilizations ratify a charter and fund its named public goods for twelve consecutive beats. Every member has legitimacy and wellbeing at least sixty. Exit rights are honored, and all qualifying signatories share the victory.
- Gates: implemented-and-applied-victory-rule, actual-world-evidence.
- Exact parameters: {"provisionalThresholds": true, "resolution": "all predicates checked on same committed beat; simultaneous qualifying civilizations share run outcome", "restart": "explicit newrun withnewID/seed,archiveoldworld; processrestartreloadssameworld", "minimumIndependentMembers": 3, "sustainedBeats": 12, "minimumLegitimacy": 60, "minimumWellbeing": 60, "forcedMembershipAllowed": false}.
- Cross-system use: Withdraw,fundbetterpublicgoods,oppose Congressresolutions; no coercive instantfederate.
- Delivery boundary: designed; proposed version is not applied.

### A world drawn to its culture · `victory.culture`
- Designed capability gate: `contested-victories-era-4` (not applied).
- Era 4; prerequisites: `civic.cultural-heritage`.
- Start/investment cost: none; work: 0.
- Foreign visiting tourists exceed the domestic tourist defense of every other living civilization for four consecutive beats. Counts come from identified works, parks, performances and access receipts. Culture stock alone is insufficient.
- Gates: implemented-and-applied-victory-rule, actual-world-evidence.
- Exact parameters: {"provisionalThresholds": true, "resolution": "all predicates checked on same committed beat; simultaneous qualifying civilizations share run outcome", "restart": "explicit newrun withnewID/seed,archiveoldworld; processrestartreloadssameworld", "sustainedBeats": 4, "comparison": "foreign visitors > every other living civilization domestic tourists"}.
- Cross-system use: Preserveownculture,closeoptionalaccess,hostownworks; migrationisnotautoannexation.
- Delivery boundary: designed; proposed version is not applied.

### A trusted world economy · `victory.economy`
- Designed capability gate: `contested-victories-era-4` (not applied).
- Era 4; prerequisites: `civic.globalization`, `building.stock-exchange`.
- Start/investment cost: none; work: 0.
- For twelve consecutive beats, fulfill at least ninety percent of due trade obligations, supply needed goods to three independent partners, account for at least forty percent of fixed-price external trade value and hold positive reserves with no overdue default. Self-trade and wash trade do not count.
- Gates: implemented-and-applied-victory-rule, actual-world-evidence.
- Exact parameters: {"provisionalThresholds": true, "resolution": "all predicates checked on same committed beat; simultaneous qualifying civilizations share run outcome", "restart": "explicit newrun withnewID/seed,archiveoldworld; processrestartreloadssameworld", "sustainedBeats": 12, "minimumExternalPartners": 3, "minimumDueFulfillment": 0.9, "minimumWorldExternalValueShare": 0.4, "overdueDefaultAllowed": false}.
- Cross-system use: Diversify,buildsubstitutes,stopconsentingtrade; no winfrom hoardedcredits.
- Delivery boundary: designed; proposed version is not applied.

### A supplied world power · `victory.domination`
- Designed capability gate: `contested-victories-era-3` (not applied).
- Era 3; prerequisites: `civic.mobilization`.
- Start/investment cost: none; work: 0.
- Hold all five original capitals, including your own, for four consecutive beats. Every occupied capital has a supplied garrison and occupation legitimacy at least forty. Original capitals cannot be razed; liberation and recapture remain possible.
- Gates: implemented-and-applied-victory-rule, actual-world-evidence.
- Exact parameters: {"provisionalThresholds": true, "resolution": "all predicates checked on same committed beat; simultaneous qualifying civilizations share run outcome", "restart": "explicit newrun withnewID/seed,archiveoldworld; processrestartreloadssameworld", "sustainedBeats": 4, "originalCapitals": 5, "minimumOccupationLegitimacy": 40, "requiresSuppliedGarrison": true}.
- Cross-system use: Recapture,cut supply,liberate,negotiate; citiesretainhistory andsurvivors.
- Delivery boundary: designed; proposed version is not applied.

## Cross-system journeys that implementation must actually demonstrate
These are design acceptance paths, not claims that a complete future simulation passed. A later implementation must show a legal before/after, exact payment, durable result and a real agent choice.

### Early Surplus
`tech.agriculture` → `building.farm` → `tech.water-management` → `building.irrigation` → `trade.harvest-for-materials`
A real paid irrigation beat supports an accepted food export and later partner construction.

### Useful New Shore
`tech.water-management` → `building.boat-yard` → `tech.navigation` → `action.found-coast`
The ordinary source-target founding action refuses before capability; the new exact ocean path succeeds with conserved residents after timed construction.

### Scholar And Citizen
`tech.writing` → `district.campus` → `building.library` → `tech.education` → `building.university` → `civic.enlightenment` → `policy.rationalism`
Opening science output changes project throughput while culture independently unlocks a government policy; no stock-only instant research.

### Industry Has A Cost
`tech.industrialization` → `deposit.coal` → `building.coal-plant` → `building.factory` → `rule.climate` → `tech.renewable-energy` → `building.solar-array`
Real coal extraction fuels local power and materials; emissions create a visible cost, then renewable investment changes the next allocation.

### Culture Is Attraction
`civic.drama-poetry` → `building.amphitheater` → `civic.humanism` → `building.art-museum` → `agreement.cultural-exchange` → `victory.culture`
A unique housed work and actual permitted visits create target-specific tourism, with domestic culture providing defense.

### Cooperation Is Political
`building.monument` → `agreement.joint-road-repair` → `civic.diplomatic-service` → `civic.internationalism` → `building.world-forum` → `agreement.federation` → `victory.federation`
Independent consent, exact later contributions and durable public goods earn political legitimacy; none is inferred from a proposal.

### Earth Fuels First Mars
`tech.chemistry` → `building.water-treatment` → `tech.rocketry` → `building.propellant-plant` → `project.launch-satellite` → `project.moon-landing` → `tech.spaceflight` → `project.mars-survey` → `project.mars-reactor-module` → `project.mars-habitat-module` → `project.mars-hydroponics-module` → `project.mars-crew` → `tech.in-situ-resource-use` → `building.ice-mine` → `victory.mars`
Earth-produced water and propellant bootstrap the first survey and cargo missions; no Mars-only resource is required before Mars is reachable. Uncrewed module manifests carry setup reserves separately from the six-person transit rations; departure requires four beats of landed life-support reserves.

### Supplied Conflict
`tech.mining` → `tech.bronze-working` → `deposit.iron` → `tech.iron-working` → `unit.swordsman` → `rule.combat` → `action.denounce` → `action.declare-war` → `action.attack` → `agreement.peace`
Equipment and upkeep are real; a declared conflict can lose supply, recover through peace and retain surviving residents and city history.

## Important seams and corrections caught in this design
- **Resource bootstrap:** Earth water treatment and a Rocketry-era propellant plant precede the first Mars survey. Uncrewed modules carry separately funded setup reserves; the crew transit rations cannot also be counted as arrival reserves. Mars ice extraction is an efficiency and independence advantage, not a circular prerequisite for reaching Mars.
- **Future electricity:** use a dedicated local power flow. Existing energy remains a stored fuel-like resource. An explicit migration must define power grids and allocation; never silently reinterpret old Energy payments.
- **Civic bridge:** existing Civic institutions remains a historical scientific discovery. The new culture-funded civic tree starts independently, with an explicit compatibility bridge from that discovery to the starting institutional state. No old research is removed or charged again.
- **Progress versus bank:** the diagnosed engine currently invests all stored science up to the project remainder. The narrow proposed correction uses productive throughput, without rewriting old completions or forcing a fake minimum duration. Full per-node switching is a separate versioned feature.
- **Legacy versus physical transport:** old route deliveries and retained path quotes stay valid. Moving convoys require real departure, transit and arrival state; visual motion alone cannot create it.
- **Faith and victory:** beliefs, religious works and voluntary spread have cultural and political consequences. The owner’s five requested victory families remain five; this is an explicit departure from a separate religious victory.
- **Prototype victory paths:** the current small source Mars/federation thresholds are gated prototype definitions. They do not establish the larger sustainable-colony or ratified-federation outcomes specified here.
- **Map limits:** the current map has no river layer. River dams and river-only effects require real migrated terrain data; the coastal Water treatment path works without inventing a river.
- **No hidden age cycle:** coast founding can happen before the connected-era milestone; foundries and rail can establish industrial evidence before factory installation; powered broadcasts establish planetary evidence before planetary buildings.
- **Required choices are actor-local:** an absent actor keeps Required visible while peers and shared strategy advance. The two-item actor plan cap does not shrink the research, civic or construction catalogue.

## First implementation handoffs, in order
1. Complete the bounded productive-research correction and show a visible start → nonzero progress → completion → next actual model choice, retaining the earlier bank and old receipts.
2. Deliver the source-verified coastal chain: compatible release → actual Navigation choice → completed coastal Boat yard → conserved founding at a destination unavailable to the ordinary frontier. The accepted legal source witness is seed1701, source23 to target26 through 23→6→7→8→26; do not claim that this has happened live.
3. Add the first branching pool together: Mining → exact mine/strategic reveal; Writing → Library/science throughput; Currency → Market/second useful exchange. A released label without its real use is not a delivery.
4. Add the independent cultural lane and government policy slots using the existing commitment lifecycle. Keep scientific and cultural costs, current projects and outcome receipts distinct.
5. Extend the same generic content interpretation through the remaining catalogue, with focused legal witnesses for a new rule family rather than one bespoke engine branch per content row.

## Delivery accounting
The full-horizon **design** outcome can be reviewed against these two files and their connected entries. The live prepared-pool outcome remains Partial: most catalogue entries require implementation, persistence, compatible release and actual play. The JSON parse check proves only that a nonempty catalogue can be read. Additional local reference/resource/DAG checks establish structural consistency, not balance, a legal full-game path or spectator comprehension. Every later feature retains an independent current delivery verdict and concrete residual owner.

## Independent design review corrections

The bounded independent `review-connected-history-catalogue` findings 1–4 identified four concrete inconsistencies, repaired in this version: full evacuation rations now include water; the first civic can be selected before it completes; explicit denouncement/declaration actions reach combat while preserving peace protection; and a disbursed loan survives cancellation. These corrections improve the design, not its implementation or live status. The rescue package reserves 24 each of food, water and oxygen for six residents over eight beats at 0.5 each per resident per beat. A smaller cohort retains its unused paid rations as real arrival cargo.
