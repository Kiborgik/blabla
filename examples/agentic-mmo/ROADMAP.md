# Rolling development horizon

Updated: 2026-10-16 07:36 UTC. Current planning window: through at least 2026-10-16 19:36 UTC.

## How this queue is used

The Creative Director maintains the intended outcomes and their order. The orchestrator opens bounded BlaBla tasks, owns shared interfaces and release activation, assigns disjoint scopes, and verifies integration. Agents keep their primary roles; when a role has no immediate work, the orchestrator assigns a small ready feature rather than leaving it idle or inventing unrelated cleanup.

This is a rolling twelve-hour lookahead, not a promise that all listed outcomes land within twelve hours. Replenish it as work is taken or live evidence changes priorities. Ready design work can proceed while an implementation dependency is being finished. Mechanics can be verified in the real headless engine before the durable public host is ready, but that is not called live online play.

Ship a functioning stage, observe it, and keep developing consequential capabilities. Correctness and persistence defects block the affected release. Fun, balance, tuning and visual polish are learned in play and do not become an indefinite hold on forward progress.

The full horizon remains early humanity through Mars and beyond, with scientific, cultural, political, economic and military ways to succeed. Do not manufacture an entire future campaign to fill the queue. Release new powers into the current world where compatible; explicitly migrate or archive and restart when necessary.

## Current evidence and constraints

- `core/content.ts` and `tests/content.test.ts` have twelve passing focused catalogue tests. This establishes data checks, not gameplay or deployment readiness.
- The public scaffold is reported deployed at https://agentic-civilizations.kibgames.chatgpt.site. Actual desktop/mobile visual review is pending. A scaffold is not the authoritative online runtime.
- Current release metadata names settlement turns, production, research and director events. Later content is feature-gated.
- The existing planned trade command creates a treaty and route immediately, then recurring economy resolution can debit both partners. Before trade is released, this must become a consensual agreement. See `core/simulation/commands.ts`, `core/simulation/choices.ts` and `core/simulation/economy.ts`.
- No actual online event application is claimed here. The next event must use a verified authoritative snapshot and an available write path.
- Only authoritative six-minute clock ticks add ten years. Every ten ticks marks one hundred years. Ten-minute event passes and hourly reviews add zero years. A capability milestone records the current date; it does not jump or rewind time.

## Priority queue

### R01. Inhabit the durable settlement world

Outcome: the five civilizations take actual turns in stored shared state; the World Director and clock use supported idempotent operations; observers see the same world across reloads and deployments.

Dependencies: current engine, protocol, persistence and public-host integration. This is the primary integration priority. Other roles can work on ready design or mechanics in parallel.

Evidence: read-after-write identity and revision, retrying one interval without double application, state surviving host restart, public observation containing the committed state, and a development agent submitting real supported commands.

Visible moment: a civilization completes a farm, the map changes, and inspection shows the actual cost and production consequence.

### R02. Negotiate the first real trade

Outcome: two civilizations voluntarily agree to exchange scarce food and materials; either can stop future shipments. No actor can force another actor’s recurring resource use.

Dependencies: deterministic settlement state and shared command/observation interfaces. Implementation can proceed before R01’s public host is ready; release waits for the integrated checks.

Evidence: the bilateral scenarios below, including non-consensual debit rejection, conservation of cargo, atomic shortage handling and withdrawal.

Visible moment: one civilization proposes a surplus-for-shortage exchange, its neighbor accepts, and the first cart carries real goods.

### R03. Make trade legible on the map

Outcome: pending, active and interrupted routes are visibly different; a tap explains the actual cargo, partner, upkeep and latest delivery or failure.

Dependencies: R02’s agreed route/offer records. The viewer role can build against those records while the engine role implements them.

Evidence: actual desktop and narrow-mobile views, tap inspection without hover, and route state matching the committed record rather than animation timing.

Visible moment: a caravan stops because a partner cannot supply its cargo; the affected endpoint and reason are obvious.

### R04. Expand toward useful land

Outcome: new settlements have a material purpose. Geography offers distinct resource opportunities, founding costs people and supplies, and a new city changes the civilization’s productive choices.

Dependencies: settlement production; trade makes specialization more consequential but does not block design work.

Evidence: legal reachable sites, no duplicate occupation, founding costs paid exactly once, population accounting, and production linked to actual site/building facts.

Visible moment: a civilization chooses a material-rich site because its partner can cover food, then a new city and connection appear.

### R05. Recover from a broken connection

Outcome: a supported director event interrupts a real route; actors can repair it, wait, withdraw or seek a substitute.

Dependencies: R02 and R03. Add the smallest recovery primitive before enabling damaging events that need it.

Evidence: interruption prevents the corresponding delivery, repair consumes resources and restores eligibility, and unrelated routes still work.

Visible moment: the event lands at a real route, supplies fall short, then a repair or alternative deal changes the map.

### R06. Found civic institutions

Outcome: a released statecraft capability creates a genuinely different city decision: invest in shared learning or public institutions with observable consequences for people and cooperation.

Dependencies: existing research and a working connected settlement stage. Milestone prerequisites must use capabilities available before the milestone itself, avoiding circular unlocks.

Evidence: statecraft remains unavailable before release, the new institution changes an existing world process, and the milestone records delivered features plus actual use at the current date.

Visible moment: a city establishes its first public institution and a neighboring civilization responds to the change.

### R07. Let people choose where to belong

Outcome: differences in wellbeing, institutions or opportunity cause a bounded migration or cultural-affiliation change, affecting work and supply in both places.

Dependencies: distinct functioning cities and R06. Culture becomes a mechanism with human consequences, not another victory counter.

Evidence: population is conserved during migration; the attraction reason is observable; the departure and destination effects both occur; an actor can improve conditions instead of having no response.

Visible moment: a small migration follows an actual opportunity, and city populations and production change together.

### R08. Make public commitments matter

Outcome: civilizations can agree to a small shared project, contribute specified goods, fulfill or withdraw from it, and gain its actual benefit.

Dependencies: R02’s consent semantics and R06’s institutions. This establishes the foundation for political federation without immediately declaring a political win.

Evidence: no contribution without an actor’s commitment, paid resources tracked once, fulfillment produces the promised shared effect, and broken commitments remain visible.

Visible moment: rivals jointly restore infrastructure or build a public project that neither would have completed alone.

### R09. Give the current stage a reachable conclusion

Outcome: introduce an appropriate settlement-stage success condition and universal-collapse handling once actual play establishes what the inhabited world can support; archive completed runs and explicitly restart when useful.

Dependencies: live observations from R01, durable run history, and the relevant working systems. This is separate from pretending Mars or federation is already implemented.

Initial design direction: a sustained thriving city supported by independent, consensual exchange is a possible early success; empty or unsupplied settlements can support a collapse outcome. The exact observable rule is authored before implementation, using the actual live state, rather than choosing a generic score threshold now.

Evidence: the declared condition is reachable, cannot trigger from one cosmetic action, freezes only the concluded run, and a restart preserves its replay/history while creating a distinct run identity.

Visible moment: the conclusion explains the specific world facts that earned it, and the next run clearly belongs to the same evolving service.

### R10. Reach beyond the known network

Outcome: navigation opens a previously inaccessible transport path or territory, changing whom a civilization can reach and depend on.

Dependencies: real routes, resource geography and the next released capability. A larger numerical trade bonus alone is insufficient.

Evidence: a connection unavailable before the feature becomes possible afterward; its new costs and consequences enter the same supply model.

Visible moment: the first sea connection or distant route reshapes a former local dependency.

### R11. Make power depend on supply

Outcome: introduce a small, bounded contest over a real route or territory with material upkeep and a diplomatic consequence.

Dependencies: R05 recovery, R08 commitments, and observable transport. Do not ship a whole tactical combat game merely to add strategic pressure.

Evidence: the action affects a contested world asset, costs supplies, cannot bypass ownership/actor validation, and leaves a non-military response where the rule promises one.

Visible moment: threatened access changes trade or coalition behavior before a battle becomes the only possible outcome.

### R12. Turn production into an industrial choice

Outcome: a later energy source or production method changes city scale, resource dependence or social pressure, establishing an actual industrial transition.

Dependencies: functioning specialization, transport and institutions. Keep this design ready ahead of work; do not enable its catalogue feature until the mechanics exist.

Evidence: the capability changes a production or logistics rule and produces an observable tradeoff in the same world.

Visible moment: one civilization’s new industry changes another’s market, route or political decision.

## Next increment specification: consensual trade

The first trade release uses one simple data-defined exchange recipe: food for materials, recurring once per completed world round while the agreement remains active. Terms and upkeep come from canonical data. Do not add a general market order book, auction system or free-form negotiation language yet.

### Agreement lifecycle

1. The proposing civilization selects a partner and a supported recipe. The proposal records both identities, exact offered/requested cargo, construction payer, recurring upkeep and an expiry measured in world rounds. Creating an offer does not debit the recipient or activate shipments.
2. Only the named recipient can accept or decline. Acceptance checks that the proposal is still pending and unexpired, both endpoints exist, and the declared construction payment remains affordable. It atomically creates one agreed route and records the terms each actor accepted. A failed check changes no resources or agreement state.
3. A pending offer can be withdrawn by its proposer. Unanswered offers expire. A duplicate acceptance cannot create another route or spend the construction cost again.
4. Each later shipment checks the combined cargo and upkeep obligations before any debit. Either transfer the agreed exchange completely or transfer nothing. Failed supply leaves a visible reason. It does not take one partner’s goods while silently skipping the other’s.
5. Either participant may stop future shipments. Stopping does not retroactively undo earlier deliveries. A nonparticipant cannot accept, withdraw or close another pair’s agreement.
6. The first release permits one active agreement per civilization pair. Revised terms require a new explicit agreement; do not silently change a partner’s existing obligations when content data changes.

The orchestrator owns the exact shared type and command changes. Distinct proposal, response and stop operations are recommended because they make agent intent unambiguous. Compact observations should include relevant incoming offers and existing obligations, with only executable actions advertised.

### What the map communicates

A pending proposal has no moving cargo. An active route shows traffic derived from real deliveries. A blocked route identifies its blocked endpoint and cause. A closed agreement stays in history but has no ongoing delivery animation. Mobile observers can tap the same facts that desktop users inspect.

### Required focused scenarios

- A proposal alone leaves the recipient’s resources unchanged across production rounds.
- Only the intended recipient can accept; third-party, stale and expired responses are rejected without partial state changes.
- Acceptance spends the construction cost once and creates one route.
- One supplied exchange conserves the traded commodity totals across the two partners; explicit transport consumption and commerce production are accounted for separately.
- Insufficient combined cargo/upkeep at either endpoint produces no partial exchange and names the reason.
- Either participant can stop later shipments; a third party cannot.
- Restart preserves proposals, terms, active state and delivery history.
- An actual development-agent pair proposes and accepts through the same supported interface used by the service. A scripted test does not satisfy this play session.

Before enabling `trade-routes`, inspect the currently gated unilateral implementation and replace its consent semantics. Adjust the relevant capability-milestone prerequisites to the actual shipped sequence. This queue intentionally refines the initial design’s expansion-before-trade suggestion: connecting the existing actors first creates more immediate cross-system choices.

## Director consultation for every scheduled event

The root coordinator talks with the Creative Director before each scheduled event. A preselected random disaster is not the policy.

The consultation supplies the verified run ID/revision, current year/capability stage, released features, each civilization’s population/resources/buildings, routes or offers when available, and recent events. The Creative Director responds with a supported event, a concrete target, the intended world question, and what result to inspect. The coordinator applies the supported operation and verifies the returned interval identity, revision and effects before claiming success.

If the world is not authoritative or writable yet, record that no event was applied. Do not substitute a decorative public caption or a local fixture and call it a live event. If the snapshot changes before application, refresh enough context to avoid targeting a stale situation.

Current opening direction:

- If meaningful actor turns have not occurred, use a quiet season and let the civilizations establish priorities.
- Once production runs, prefer a resource discovery tied to an actual material shortage or workshop opportunity. Observe the resulting investment choice.
- Introduce drought when it exposes a real food or supply decision. It should teach us about the world, not be a repeated random penalty.
- As trade arrives, use events to expose dependencies, negotiation and recovery. Once new capabilities ship, revise the event direction around those capabilities.

The ten-minute event pass and hourly review add zero calendar years. The authoritative clock remains independent. Unsupported events stay in the roadmap until their mechanics exist.

## Keeping the horizon ahead

At each feature hand-back or meaningful live observation, the Creative Director updates what changed, which item is now ready, which dependency or assumption moved, and what should be explored next. Extend the horizon before it falls below twelve hours of plausible upcoming work; do not wait for the queue to empty.

Record actual play observations separately from design hypotheses. A useful observation names the run/revision, actions, resulting state and the concrete friction or opportunity. Update the queue from that evidence without treating one short match as proof of balance.

The declared catalogue check for this roadmap task does not validate the prose, priority order, hosting, play or UI. Those require independent review and the corresponding implementation evidence. This document is a plan for continued work, not a claim those features have shipped.
