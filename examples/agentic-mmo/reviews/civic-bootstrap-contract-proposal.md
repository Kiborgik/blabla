# Proposed civic bootstrap contract

17 October 2026. Prospective task `propose-civic-bootstrap-contract`, accepted by gpt-6-astra before editing this sole deliverable. This is a bounded proposed contract decision, not registered intent or a runtime schema. Creative Director approved the concrete eligibility, transition categories, rounding and locks for this handoff; the orchestrator retains contract authority. The original accepted catalogue and recovery research retain their existing authorship.

## One bounded released capability

The first packet enables only the separate cultural commitment, Code of laws, target-specific government eligibility, Chiefdom and Urban planning. Existing Civic institutions science research and its old completions are preserved, not reclassified as cultural civics. No automatic government/policy grant. Craftsmanship, Foreign trade and advanced government/policy consumers remain unavailable until separately delivered.

## Domain records and ownership

Core owns canonical state, eligibility, productive investment, modifiers and events. Server integrates validation/migration/receipts; both transport surfaces use the same canonical results. Art consumes projected facts and owns presentation. Proposed names below are conceptual, not tool-ready action identifiers.

Civilization civic lane:
- Optional versioned record: ruleVersion1; completedCivicIds(unique known IDs); active=null or {civicId, startedRound, progress, requiredCulture}; lastCompleted=null or {civicId, completedRound, eventId}; reformEntitlement=null or {completionEventId, civicId, completedRound}.
- Applied migration installs empty lane and no completions/entitlement once. Culture stock, all science fields, old building operations and old event receipts remain byte-equivalent except the explicit migration event.
- A selected project's requiredCulture is snapshotted. Content updates cannot silently change its paid progress or remainder.

Government arrangement:
- Optional versioned record: active=null or {governmentId, assignments:[{slotType,slotIndex,policyId}], effectiveRound, governmentLockUntilRound, policyLockUntilRound}; pending=null or {targetGovernmentId, targetAssignments, acceptedRound, completionRound, paidCredits, spentCompletionEventId|null}.
- Canonical slot identity is type+index. Assignment IDs are unique. Empty slots legal. No duplicate policy IDs in different slots.
- No pending transition may be replaced by a new request. Identical arrangement requests refuse without payment or entitlement consumption.
- Rule definitions declare prerequisite civic IDs, slot capacities, base modifiers and transition data; no Chiefdom-specific branch inside the generic eligibility path.

## Exact actions

Choose civic: target civic ID only. Requires released lane, exact current eligible ID, empty lane, not completed. Strict revision/actor/idempotency rules are inherited. No payment at selection; progress uses only later strategic production. Refusal changes no lane, stock, budget or receipt.

Adopt arrangement: target government ID plus the complete intended policy assignment. Requires capability, target-specific completed prerequisites, released policy IDs, matching available slots, no duplicates, no pending transition and expired applicable commitment locks. Completeness means every retained policy is explicitly included; no hidden auto-fill.

Pricing and entitlement: first consult an actual unspent latest-completion entitlement. If present, consume it once and charge zero. Otherwise change of government costs10 credits and same-government policy reslot8. A complete atomic preflight validates the assignment and funds before consuming either. Accepted duplicate commands return the original receipt, not a second transition or spend.

An entitlement waives payment only. First adoption from no government has no transition; changing an existing government has two strategic transition beats regardless of entitlement. Existing arrangement remains active during transition. A same-government reslot is immediate, has no government transition, and resets its policy commitment. An unused entitlement survives other actions/restart and is replaced, not stacked, when a later actual civic completion occurs.

## Strategic ordering and arithmetic

At opening capture active arrangement, transition state, city focus/productivity and existing paid-operation allocations. Any command accepted between beats affects only the following opening; no retroactive current-beat modifier.

Civic investment after actual culture output and existing paid commitments is min(actual culture produced this beat, available culture stock, requiredCulture-progress). Deduct exactly invested culture, preserve the rest. Ignore idle stock for throughput. Science investment remains independent. Completion once appends the civic ID, records its event, clears the active civic lane and replaces the reform entitlement. Never choose a successor.

Construction base work becomes (existing focus base + enabled generic base-work modifiers), then existing productivity and two-decimal rounding. Urban planning contributes1. The opening snapshot drives later completion; newly completed buildings do not produce in that same beat. Chiefdom contributes1 to each owned city's base food before existing productivity. These are government-wide modifiers applied per city, not a new target-city policy action.

Government transition accepted at strategic round r covers opening/production beats r+1 and r+2. After resolving r+2, install the target arrangement with effectiveRound=r+2; its modifiers first apply at r+3 opening. Both government and policy locks reset on government change and end at effectiveRound+4. A government change must honor both current locks, so it cannot evade a recent policy reslot. Eligibility is currentRound >= lockUntilRound. Immediate first adoption/reslot uses the accepted round as effectiveRound, affects the next opening and locks until round+4. A new civic completion does not bypass these locks.

Creative accepted the exact transition category/rounding boundary on 17 October 2026: multiply ordinary per-city food/materials/energy/credits/science/culture outputs, including paid recipes and ordinary improvements, after existing modifiers but before the final existing two-decimal round. Exclude input costs, fixed cargo and yields from trade agreements, finite strategic extraction, direct-event rewards and construction work. Apply once per canonical output calculation; sum the exact credited receipts for science/civic throughput, never multiply net stock or reduce the credited throughput a second time. This is Creative design approval subject to orchestrator contract authority, not runtime authorization.

## Observable facts

Agent observation: civic status(required/active/blocked), active target and exact progress/remainder, available released targets or typed blockers; completed prerequisite IDs; current/pending government, slots/policies, commitment round, reform entitlement origin and exact valid reform price/transition; city base-work modifier contribution separately from final work.

Retained events: civic-started, civic-completed, arrangement-accepted, transition-completed (where relevant), each with actor, target IDs, round and cause. Ordinary intermediate progress can be read from canonical state without emitting one event per city per beat. Preserve bounded history/observation budgets.

## Proposed contract facts and counterexamples

State projections: civic_eligible, civic_active, civic_throughput_exact, culture_conserved, science_unchanged, civic_completed_once, civic_successor_unselected, reform_eligible, assignment_slots_valid, exact_payment, entitlement_consumed_once, government_transition_exact, commitment_enforced, base_modifier_exact, refusal_unchanged, old_release_preserved, restart_preserved.

Legal witnesses:
1. Released fresh empty lane can select Code of laws without prior Code of laws or Political philosophy.
2. Actual culture advances project; large idle bank without production invests zero; paid academy culture and civic progress cannot double-spend.
3. Code of laws completion produces the single entitlement and exposes Chiefdom/Urban planning eligibility.
4. Explicit Chiefdom+Urban-planning assignment with empty military slot succeeds, costs no credits from the entitlement and changes next-opening local food/base work.
5. Exact city work advances and a timed building completes once; science lane is unchanged.
6. Restart preserves active project, spent entitlement, commitment and pending-transition progress. Old release without civic feature follows old production/replay.

Counterexamples: unregistered target, capability absent, completed civic, active replacement, mismatched slot or duplicate policy, missing target prerequisites, insufficient credits, active commitment/pending transition, no-op assignment, stale revision, duplicate start/completion/adoption, next-beat rather than same-beat production, removal/readdition of the same entitlement. Every refusal is zero-effect and consumes no actor allowance if the canonical admission contract promises that.

## Integration gate and residual

Do not implement against recovered head8024e5c: live owned-territory/culture/Foundry/Observatory source is missing. Once the authentic base is restored, orchestrator registers the source-equivalent capability/state/action/contract shapes and registers the agreed transition category, rounding and lock decisions. Then core tests the legal civic consumer, server tests durable/migration/read parity, Art implements actual civic progress and construction consequence, and independent review checks the same boundaries. This scratch note has no source acceptance or runtime verification claim.


## Concrete contract placement and fact bindings

Recommend one new draft `contracts/civic-bootstrap.bla` for the cohesive released bootstrap outcome, registered only by the orchestrator. Do not modify the existing scientific `research-investment` contract to pretend that cultural projects are already science projects. Reuse its productive-budget calculation boundary while retaining separate lane facts. Link the new draft to prepared-research-and-building-pool and the affected simulation/observation/persistence systems. Existing required-decisions, resident allocation, concurrency and receipt contracts stay authoritative; the new contract composes them rather than copying their world-wide assertions.

Proposed action boundaries and falsifiable expected relations:

- `choose_civic`: if the before-state says released target, empty lane and satisfied prerequisites, after-state must have that exact target; otherwise the operation refuses with the whole game-state/admission allowance unchanged. Selection must preserve culture stock and science state.
- `resolve_civic_beat`: exact debit/progress equals min(actual credited post-transition Culture output, available Culture after prior obligations, remaining target cost). Positive eligible budget must progress. Zero production with a positive bank must invest zero. Completion and its receipt occur once, no successor is selected, and a newly available target is projected as required.
- `assign_government`: eligible target/prerequisites/slots, expired applicable locks and funded price must accept the exact complete arrangement once. Invalid/no-op/pending/locked assignments preserve credits, entitlement and arrangement. Successful assignment consumes only the chosen entitlement or exact 10/8 price, never both.
- `resolve_government_transition`: exactly the next two strategic beats retain the old arrangement under the multiplier; install the target after the second; reset both locks to effectiveRound+4. First adoption and same-government reslot have no transition; neither bypasses a prior applicable policy lock.
- `project_government_output`: credited ordinary local outputs are multiplied once before final rounding, while exempt operations and input costs are unchanged. Civic/science investment uses the already credited result, without a second multiplier or net-stock proxy.
- `project_construction`: Urban planning contributes1 base work before city productivity/rounding at opening; new arrangement cannot retroactively change an already resolved beat or an order's stored required work.
- `migrate_and_restart_civics`: the versioned migration creates empty cultural/government state without granting completions, removing resources or rewriting old scientific records; all accepted commands, partial civic work, entitlement origin, locks and pending transitions survive restart and replay.

These booleans are adapter projections over actual reducer results and independently computed expectations, not manually asserted flags. Each positive witness must legally reach its prerequisite; each refusal fixture changes one deciding condition. Include paired prior/current release witnesses so disabled capability behavior is tested. Exact API request/response schema integration is assigned to the server/integration owner only after the authentic live base is restored.

## Creative decisions closed in this proposal

1. Government eligibility uses the selected government's own completed civic prerequisites and capabilities. Chiefdom requires actual Code of laws. The advanced governments' exact catalogue prerequisite arrays remain intact; there is no universal Political philosophy gate and no automatic gift of Chiefdom.
2. Government/policy assignment is one atomic explicit action. The single latest actual completion receipt supplies a nonstacking reform entitlement. It waives payment only, never lock or existing-government transition.
3. Ordinary paid recipes and ordinary improvements belong to the six-resource local-output multiplier; strategic extraction and fixed trade cargo/yields do not. Apply once before the existing final two-decimal rounding, then sum credited receipts.
4. For an existing-government change accepted at r: old arrangement governs r+1 and r+2 at0.75; target installs after r+2, governs r+3, and both locks expire at r+6. Eligibility is currentRound>=lockUntil. Both existing locks are checked before a government change, so reslot commitment cannot be evaded by switching government.
5. First adoption and same-government reslot take effect at acceptance for the next opening and have a four-resolved-beat commitment; reslot has no government transition. Base construction and base food modifiers are applied before existing city productivity and rounding.

These decisions resolve the semantic ambiguities called out in the accepted successor report. They do not activate a capability, select shared field names without integration review, or approve any source recovery workaround.

## Exact worked arithmetic for the review

A canonical ordinary local output calculation producing 1.02 before transition credits round(1.02*0.75,2)=0.77. If two calculations each credit 0.77, their throughput contribution is 1.54, not a second 0.75 reduction of 1.54 and not the 1.53 obtained by rounding the uncredited aggregate 2.04*0.75. Inputs retain their original quantities. A separate fixed trade credit yield 2 stays 2 and is not research throughput. A finite extraction receipt of 2 Iron stays 2. Construction work uses the separate base modifier and receives no transition multiplier.

For adoption at round100 with no previous government, next opening101 uses the new arrangement and a lock ending104 is first eligible when currentRound>=104. For changing an existing government at100, openings101/102 use the old arrangement with the transition multiplier; target installs after102; opening103 uses the target; both locks end106. Failed or duplicate requests cannot shift those recorded boundaries.

These are expected-value examples to falsify the future implementation, not executed gameplay or tests.

## Actual between-unit civilization play

The resumed role owns Verdant seat 1 by explicit parent transfer. Official observation at 18:16:04.505 UTC showed Celestial navigation completed at round 1587/event 2021:55, with Astronomy and Gunpowder available and no construction choice in Willowmere. I chose the useful Astronomy successor to unlock the existing Observatory path, without replacing an active project. Exact command `resume-core-verdant-astronomy-20261017T181604Z`, strict expectedRevision 2023, used a supported atomic strategy-action envelope. It realized one due strategy beat to 2024 and accepted the exact research action at 2025. Dedicated receipt readback confirmed acceptedRevision 2025; fresh view showed Astronomy 0/360, round 1590, release Observatory, clock 128/year -8310 unchanged. The separately denied Mine31 intent was not attempted. These are actual server results, independent of this proposal's document check. Astronomy's progress/completion and a subsequent exact eligible Observatory construction remain player-loop residuals.

## Outcome, next owner and stopping condition

The prepared-pool goal remains **Partial**: this document closes the narrow proposed civic contract boundary, while the current-live source gap prevents safe runtime integration and there is no new civic capability, deployment or player loop. The proposal may be independently reviewed and accepted without claiming registered contracts have changed.

Orchestrator owns authorized authentic post-live24 source recovery, contract approval/registration and the shared schema assignment. After that, core owns the civic reducer/content/modifier implementation and legal consumer tests; server owner owns versioned persistence, migration, exact receipts and transport parity; Art owns actual readable civic progress and changed-work evidence. Independent reviewer falsifies the typed boundaries and legal positive/refusal paths. Creative owns further design changes, but no additional broad catalogue exercise is required before this bounded packet.

Runtime entry requires recovered or explicitly reconciled authentic owned-territory/culture/Foundry/Observatory source, approved scoped contracts and an active implementation assignment. No generation of missing source from screenshots or reverse-engineered partial state is authorized here. No new exact action is submitted merely because a future civic identifier is written in this proposal.

Declared check: `test -s reviews/civic-bootstrap-contract-proposal.md`. It establishes only that this document exists and is nonempty. Planned runtime checks, numeric examples and accepted Creative decisions do not turn that command into engine, persistence, deployment or balance verification.
