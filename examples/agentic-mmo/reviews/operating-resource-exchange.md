# Operating-resource exchange: next connected choice

Prepared 2026-10-16 14:38 UTC by the Creative Director, gpt-6-astra. This is a prospective content decision. It does not activate a capability or demonstrate live trade.

## Smallest useful outcome

Add one standing exchange: **Energy for materials**. An agent can import kiln fuel rather than build every supporting industry itself. Its partner can turn a fuel surplus into materials for construction, irrigation or further fuel production. The accepted land-path interval makes a nearby supplier and a distant specialist meaningfully different choices.

This is one additional recipe in the existing offer/accept/stop system. The current limit of one active agreement per civilization pair means food supply and operating fuel compete for that relationship. Choosing another partner, preserving a food agreement, pausing a kiln or investing in a local fuel yard remain useful alternatives. There is no automatic renegotiation, extra market screen, price simulation or new action state machine in this increment.

## Source and reference basis

The current catalogue has one trade recipe, harvest-for-materials. A kiln consumes two energy each strategic beat; a fuel yard consumes two materials and has nominal energy output three. Actual output follows existing city productivity and the operation receipt. Trade already snapshots arbitrary resource vectors, checks both parties' combined cargo/upkeep atomically and uses the same generic legal-action loop. The compact recipe table also handles multiple recipes. The core worker independently confirmed that no sole-recipe production assumption was found; existing tests select the old recipe explicitly, so the new recipe needs its own witnesses.

Read `tests/land-transport.test.ts`: its near/far journey applies the real release chain, gets consent and advances twenty actual strategic beats with serialization checks. Read the complete eleven-test green log `.blabla/scratch/specify-land-transport-cadence/evidence-2-2-1792161540635792882.log`: Verdant–Vesper's four-edge path at cadence four delivers five exchanges and Ember–Pelagos's ten-edge path at cadence five delivers four. That is an equal-time local engine result, not live play or balance proof. The same log measures a 130,504-byte compact 25-city fixture, including 115,631 choice bytes; the core owner is addressing that growth through a shared structured quote. This second recipe should reuse that seam rather than duplicating path prose. No additional run was made for this design pass.

Firaxis's dated [Civilization VII Dev Diary #6: Diplomacy, Influence, & Trade](https://steamcommunity.com/games/1295660/announcements/detail/508443269496045928), published January 8, 2025, describes resources obtained through trade and resources supporting different settlement roles. Its full text was read through the publisher's [Steam announcement feed](https://store.steampowered.com/news/posts/?enddate=1736367930&feed=steam_community_announcements); direct 2K pages did not load in this research pass. The design inference here is to give relationships a productive purpose, while keeping the choice understandable. The proposed conserved stock exchange, consent rules and numbers are original to this game, not claims about current Civilization balance.

## Proposed immutable recipe

- ID: `energy-for-materials`, version 1; plain name: Energy for materials.
- New feature: `operating-resource-exchange`, in a registered additive successor after land transport. Required recipe features: trade-routes and operating-resource-exchange. The actual release registry remains integration-owned.
- Proposer sends four energy; recipient sends three materials.
- Each side consumes one additional energy as transport upkeep and earns two credits on a successful exchange.
- Construction is paid once by the proposer on consent: six materials and eight credits, as for the existing recipe.
- Base cadence is four strategic beats; new land quoting derives the actual interval from the same versioned path rule. Damage disables delivery at 50, as for the existing recipe.
- Pending expiry, pair limits, withdrawal, recipient acceptance, stopping and all later blocking behavior reuse current rules.

These values are a small comparable starting point for play. They are not a claim of an optimal price, sufficient fuel for continuous operation or a balanced strategy. No new technology gate is required: energy already has uses and passive sources. Fuel management remains valuable because it supplies sustained production, not because the trade parser arbitrarily forbids exchanging an existing stock before research.

The proposer must supply **five energy**, including its own upkeep, at an actual delivery attempt. The recipient must supply **three materials plus one energy** before receiving anything. After a successful exchange, ignoring other events in that beat, the proposer has energy −5, materials +3 and credits +2; the recipient has materials −3, energy +3 and credits +2. These net changes are explanations only. The authoritative record must retain gross cargo, separate upkeep and separate commerce.

An energy-empty importer cannot pay transport with the promised incoming cargo. This preserves the current both-funded rule. The agent can pause an operation and restore its own buffer before the due exchange; the proposal is not emergency credit. A future relief mechanism would require its own consent and funding design.

## Timing and compatibility

Operations allocate from opening stocks before production, household upkeep, trade and public projects. Energy delivered later in that same beat cannot retroactively fund a blocked kiln. It can contribute to opening stocks on the next strategic beat. The existing operation receipt is the proof of work; a delivered energy icon alone is not proof that a kiln operated.

A new proposal uses the selected recipe and exact towns. Acceptance freezes its complete resource vectors, path and interval. Existing accepted or pending food agreements keep their original terms and schedule. A civilization wanting a different agreement with the same partner must explicitly stop the old one and seek fresh consent; there is a real construction cost and waiting interval. Do not silently replace, amend, reprice or reset a partner's commitment.

Historical releases do not expose the new recipe. Its additive release preserves existing assets, stocks, world clock and records; no historical advancement is implied by making the choice available. Publication and online activation remain separate authorized operations.

## Bounded implementation evidence

1. Demonstrate a legal local release-and-consent journey selecting the new exact recipe, with no forged resources, discoveries or milestones. The displayed gross obligations and interval must equal the accepted snapshot. There is no payment by the recipient at proposal, no delivery before consent or before the agreed due beat, and the later exchange changes exactly the agreed vectors.
2. Add a separately labeled synthetic opening-stock seam: a supplied exporter and an importer with enough transport energy but too little for its kiln. On the due beat the kiln remains blocked by its opening stock, the agreed trade succeeds later, and the next beat can fund the kiln. A second case with no importer transport energy refuses both sides without partial transfer. Do not describe those edited-stock cases as a legal civilization journey.
3. Preserve old food agreements and older releases, pause/stop/expiry behavior, damage blocking, exact endpoints and read/replay determinism. Tuning today's catalogue must not rewrite a retained offer or agreement.
4. Confirm ordinary and compact observations retain both recipes and all exact legal actions. The existing shared path planner must continue reusing a source-town search across recipes. No hidden truncation is acceptable when the candidate count doubles.

The design task's catalogue test is a regression baseline only. It cannot prove the future recipe, the economic usefulness of specialization or live spectator clarity. Fix correctness blockers; learn price and cadence from real authorized play.

## Visible and agent-facing meaning

Use the existing energy and materials symbols with names and amounts. Before consent, show both parties' cargo and upkeep, the exact towns and first due beat. After a real result, show four energy sent and three materials returned, with transport payment distinct. Existing route-result presentation should read the immutable vectors; no recipe-specific animation branch or new visual asset is needed.

The compelling moment is a real imported fuel delivery followed on a later beat by a previously blocked kiln working. If the operation stays paused, has another shortage or produces zero because of current conditions, preserve that truth. Do not promise a continuous fuel stream or animate work from a proposal. These tactical pause/consent decisions sit inside the slower supply relationship; the agent's immediate plan remains capped at two items.

## Ready handoff

The orchestrator owns the catalogue feature/release and any new prospective contract. Core adds dedicated legal and scarcity witnesses through the generic engine. Server preserves stored recipe terms and validates the new data through existing rules. Art consumes the shared resource vectors and actual later operating receipt only when assigned. The next design question should come from the resulting supply choices, rather than adding several resource recipes or a new research tree before this one can be played.
