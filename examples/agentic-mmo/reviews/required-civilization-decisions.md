# Recurring civilization decisions

Creative Director: actual gpt-6-astra/xhigh, 2026-10-16. This is a bounded prospective design, grounded in the current engine and inhabited world. It does not claim that mandatory decisions or timed construction have shipped.

Canonical outcome: `goal::recurring-civilization-decisions`, registered in `goals.bla`, with the prospective `contracts/required-decisions.bla` and `policy::affected-delivery-outcomes`. The assigned design task serves the existing prepared research/building pool. The new live outcome remains explicitly unmet. The separate `goal::visible-growing-world` remains partial; neither this report nor an isolated panel can satisfy that visual milestone.

## Decision and primary references

Give every civilization one current research commitment and every exact owned town one current construction commitment. Completion must expose the next real decision. The actor can finish its decision cycle only when actionable required choices are resolved; the shared economy and other actors continue independently.

The publisher's [Civilization VI manual, research section on page 108](https://downloads.2kgames.com/civilization/vi/manuals/eu/CIV_VI_25TH_ONLINE_MANUAL_ENG.pdf) describes choosing research again after a discovery and displaying the current project, progress and connected unlocks. Its [construction section on page 97](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/289070/manuals/CIV_VI_25TH_ONLINE_MANUAL_ENG.pdf?t=1740607040) describes one construction at a time and choosing another after completion. The publisher's [Gathering Storm production-queue FAQ](https://support.civilization.com/hc/en-us/articles/37663317924883-Civilization-VI-Gathering-Storm-FAQ) confirms per-city build queues and a view across cities. Relevant publisher search excerpts and the full support page were retrieved; the web tool could not open the oversized manual PDFs in full. No claim depends on a third-party paraphrase or an uninspected screenshot.

The adaptation here keeps one active commitment in each lane. The existing maximum-two-item civilization plan remains a short, nonexecuting model intention. It does not become a second production queue or an automatic technology-tree planner. A new choice is an actual agent decision, not a built-in policy silently acting as that agent.

## Observed gap and current source

- `core/simulation/economy.ts` invests science, completes research, then clears `researchTarget` and `researchProgress`. It supplies no recurring decision obligation.
- `core/simulation/commands.ts` currently pays for a build, installs it, enables its operation and applies its effects in the same action. This is an immediate purchase, not a persistent construction job.
- `core/simulation/choices.ts` offers Hold independently of empty commitments. Focus and other actions can leave research empty indefinitely.
- `core/simulation/capabilities.ts` already owns structural research/building eligibility. Reuse it to derive decision requirements without depending on temporary admission, enumerating trades or duplicating rules in the viewer.
- `core/planning.ts` already records at most two intentions without automatic execution. Preserve that boundary.

The live example is concrete. Pelagos chose Civic institutions through the atomic wrapper at revision 207 after two real due beats. Root subsequently verified strategic transitions through 211 and baseline revision 212, round 57, year -8750: Civic institutions was complete and Pelagos's research target was empty again. That same world had the first consented route delivery at round 55. A later direct observation at revision 215 confirmed the empty target, two available research choices, and still-legal Hold. Pelagos then explicitly chose Water management at revision 216, command `pelagos-irrigation-discovery-20261016T164457Z`, preparing a future irrigation option. This closes one real next-choice loop by agent initiative; it does not prove an engine requirement exists.

The route's first completion was verified from persisted agreement fields, not independently inspected per-party payment history. A later actual event `214:5` records the second exchange at round 59. These are live observations, separate from prospective construction witnesses.

## Minimal state and admission semantics

Derive a small decision view for research and each exact town:

- **Required:** no active commitment, and at least one currently selectable released choice exists. Include stable capability IDs and exact town identity so the actor can obtain the corresponding typed actions.
- **Active:** a named commitment has retained progress. Show its actual progress and the next strategic resolution boundary. This is valid even when its eventual completion is many beats away.
- **Blocked:** no selectable next choice, with concrete canonical reasons; or an existing construction order currently has zero work capacity. Preserve the named active order in the latter case rather than pretending a new choice is required.
- **Completed:** a retained last-completion receipt and immutable event. Completion is historical. In the same resulting observation the current lane can already be Required or Blocked. Do not let a permanent Completed badge conceal the next decision.

Research selection requires released prerequisites, not a science balance sufficient to finish. Zero stored science never excuses a missing research choice. Construction start does require its complete upfront cost. Missing prerequisites, era, applied capability or affordable cost are genuine blockers. An exhausted released pool is explicitly unavailable; it does not authorize unimplemented future content. Do not force a useless building or rename Hold as a production project to hide exhaustion. A useful repeatable project pool can follow as a separately assigned feature.

Required states are independent of ten-second actor admission and overdue host upkeep. An overdue strategic beat must not turn the entire capability tree into Locked or erase the decision. State derivation reads canonical eligibility once and factors shared catalogue facts rather than repeating prose per option.

Under the new capability, Hold/finish refuses while any actionable Required lane remains, naming the unresolved research or exact towns. A reason supplied by the actor cannot waive a valid choice. A Hold accepted with no available choice retains the engine-derived no-choice facts in its outcome. Active commitments and objectively unavailable choices permit Hold. Other tactical actions, including emergency repair, consent, operation controls and trade, remain legal under their normal rules; they cannot clear the obligation. The agent workflow prioritizes unresolved decisions before optional work and cannot report a finished decision cycle while they remain open.

There is no all-civilization quorum and no global finish-turn lock. If an actor is absent, its Required state stays visible while other actors, existing production, trade, the shared strategic schedule and the calendar proceed. No automatic target is selected for the absent actor. A two-item intention can name the immediate decision and one follow-up; it does not have to contain every current city commitment.

## First research increment

Keep existing research target/progress and add one bounded last-completion receipt with technology ID, round and event reference. Selecting a target starts the existing research process. At completion, preserve that receipt and immediately derive the next decision from released options.

For this smallest increment, reject replacing an active research target under the new capability, including resubmitting the same target. Preserve progress and stocks exactly on refusal. This is an explicit temporary limitation, not a claim that Civ prevents switching. A later bounded switching feature can retain per-technology investment and resume it. Do not retain the current lossy reset behavior while claiming commitments are preserved. Older releases keep their original semantics for exact replay.

## Timed construction, with paid-once work

New town state needs only an optional active order and an optional last-completed receipt. A useful initial shape is:

- Active order: stable order ID, exact city/building identity, rule version, started round, snapshotted paid resource vector, required work and accumulated work.
- Last completion: order ID, building ID, started/completed rounds, paid vector and completion event reference.
- Decision projection: current state, active identity/progress where present, concrete blockers and canonical available capability references. These are derived facts, not a separately maintained queue.

At start, revalidate ownership, released building, prerequisites, era, absence of that building, empty active slot and complete affordability. Debit the original construction cost once and record the order atomically. The building is not installed and contributes no effects, operation record or yield yet. A second start, same-order resubmission with a new command ID, or attempt to replace the active order refuses without resetting work or spending again. Ordinary command-id replay returns the original receipt.

Provisional shared data: required work 4 for farms/workshops and 6 for the other currently released building families; base work 1 per strategic beat and industry-focus work 2. Multiply by the existing city productivity formula, extracted as a shared function rather than copied. These values are a transparent live-play starting point, not a historical or balance claim. Snapshot the required work, rule version and actual paid vector when starting so later duration/cost tuning cannot rewrite that commitment.

Measure that beat's work using the opening town state, before same-beat growth, wellbeing gain, completed construction or repair. Resolve the recorded work at the end of the strategic economy, after current production, trade and research. Clamp completion to required work. Full damage can give zero work and a concrete Blocked reason; repairing the town can restore work at a later beat. Industry focus is a tactical way to accelerate the existing commitment, with the existing output tradeoff of leaving another focus.

Completion installs the building and applies its construction effects exactly once, creates its operation record if appropriate, and moves the order into the bounded completion receipt. The new building first produces or receives operating allocation on a subsequent strategic beat. It cannot fund an earlier recipe or manufacture a same-beat output at completion. Starting an order performs no strategic work by itself.

The first slice has no automatic second order, cancellation refund, instant-purchase bypass or active-order replacement. Expose that limit clearly. These can be separately designed if actual play needs them; silently discarding paid work would be worse than a truthful bounded commitment. Missing or foreign exact-town targets refuse; no fallback to the capital or another eligible town is allowed.

## Persistence, release and transport boundaries

Register a distinct additive capability and prospective contracts before implementation. Old releases retain immediate construction and research behavior. Applying the new capability preserves all existing buildings, people, stocks, histories, research and clocks. It creates no retroactive work and does not charge for already built objects. Missing new optional fields in old snapshots remain valid. Existing active research becomes an Active decision, while empty lanes are derived from current options.

Persist orders and completion receipts through the same authoritative transaction/history path. Restart must neither charge again nor repeat completion. Structured refusal identifies the obligation or existing commitment. Strict expected revision and exact typed action identity remain unchanged.

The deployed atomic strategy-action wrapper continues to roll back all effects if the chosen action refuses. A Hold that becomes invalid because catchup completes research/construction must not silently pick another target or commit partial upkeep. Report the projected required decision; the caller can explicitly realize upkeep, reobserve and choose, or submit a fresh exact supported intention. Preserve the existing all-or-nothing boundary and do not accidentally make a caller's invalid Hold the only way to advance the economy.

## What the agent and spectator must understand

For the selected civilization, show current research, real progress and the last completion. For the selected town, show its actual construction order, work progress and last completion. Required has a simple Choose research/Choose construction label with a distinct icon and text; Blocked gives the actual missing prerequisite, resource or work condition. These cues use the same canonical states as the agent interface. No viewer command changes the world.

The current connected tree supplies Done/Available/Locked/Planned, with active commitments overlaid separately. Completion does not mean that every downstream building is usable: era, exact town, release and cost still matter. A recorded reason is shown only when retained with the relevant model action. Current options without historical comparison remain labeled Options now, rather than Newly unlocked.

Art owns actual desktop/narrow rendering and checks icon/color/text comprehension, focus/tap-equivalent access and event visibility. Reuse existing camera/settings evidence. This report makes no new pixel claim and cannot accept those outcomes on Art's behalf.

## Bounded prospective evidence and actual delivery acceptance

Before source acceptance, establish focused cases for the actual new boundaries:

1. A legal unedited research journey completes, creates the exact last-completion receipt and Required next research, refuses Hold, then accepts a real eligible new target. A zero-science actor can still choose research. A legitimately exhausted or gated pool yields concrete Blocked facts.
2. A legal exact-town construction pays once, stays absent during partial work, completes once over strategic beats and first contributes output on the following beat. Two towns cannot redirect each other's order. Industry changes the actual completion timing; full damage and repair change future work without refund or duplicate effects.
3. Repeat/new-ID starts, active research replacement, stale revision, malformed orders, duplicate commands, rollback and authoritative reopen preserve paid resources, progress and receipt identity. Old-release actions and historical snapshots retain their original behavior.
4. One absent actor with unresolved Required decisions does not stop another actor or strategic economy/calendar. Tactical emergency/consent actions do not erase requirements. The short plan remains bounded and nonexecuting.
5. Atomic Hold refusal after projected catchup rolls back everything; explicit upkeep still advances the world and reveals the required choice. Catchup cannot auto-build or auto-select research.
6. Compact/full views and the spectator projection agree on exact identity, status, progress and reasons without enumerating unrelated routes or copying eligibility logic.

After authorized deployment and activation, I must follow one actual agent cycle: choose research and exact-town construction, observe real progress, observe completion and the required next decision, then make a genuine next choice. Also observe absent-actor progress. Art must inspect the same resulting states and semantic event treatment in actual supported desktop/narrow views. Preserve original command, event and screenshot references and distinguish direct observations from another role's attributed observations.

The source task can be honestly complete while this live outcome remains pending. The relevant goal cannot be marked satisfied by unit tests, prose or an empty checkbox. Reuse affected-intent dispositions and review authority to keep applicable delivery obligations open as Partial or Blocked, with a concrete owner and successor/unblock condition. This is the next dogfooding case for the owner's requested BlaBla outcome-enforcement feature, not a new informal parallel checklist.

The declared 21-test catalogue command is only an unchanged-content regression baseline for this report. It proves none of the proposed state machine, timed construction, real-play continuity, spectator comprehension, fun or balance. The next useful scope is the shared types/draft and a legal prospective decision-cycle witness, followed by the bounded core/persistence implementation and real outcome review.
