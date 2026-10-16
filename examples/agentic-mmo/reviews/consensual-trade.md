# Independent consensual-trade review

2026-10-16, 08:59 UTC. Reviewer: `gpt-6.1-sol`. Task: `review-consensual-trade`, reviewing `build-consensual-trade` after the shared core and final target-record freezes. The author's reviewer-model attribution was corrected before final binding.

## Result

**No blocking engine defect found.** This is a bounded nonvisual code review, not approval of deployment, goal completion, balance or the unplayed live trade session. No production source was edited.

The original task and [approved lifecycle](../ROADMAP.md#agreement-lifecycle), changed core/test hunks, complete trade module and deciding helpers were inspected. Earlier release/history changes visible in the Git diff were distinguished from this trade increment. Shared catalog/validation changes were read as integration-owned inputs; their previously reported pending work was not duplicated as a finding.

## Requirement account

| Requirement | Deciding implementation and observed result |
| --- | --- |
| Immediate proposal without recipient spending | `availableTradeActions` enforces the unordered pair limit and released recipe. Proposal creation clones terms and creates no route or debit: [trade.ts](../core/simulation/trade.ts#L46-L158). The focused test compares pending-offer production against a no-offer baseline. |
| Recipient consent and atomic acceptance | Only the named recipient receives response actions; acceptance additionally checks pending/unexpired status, endpoint ownership, active-pair cap and current proposer construction affordability. [applyCommand](../core/engine.ts#L175-L215) rejects revision/seat/action mismatches before cloning or executing. Failed, third-party, stale and duplicate responses preserve the original state. Construction is debited once on the accepted clone. |
| Immutable exact terms | The recipe is copied into the offer and copied again into its route agreement: [trade.ts](../core/simulation/trade.ts#L129-L139), [acceptance](../core/simulation/trade.ts#L202-L228). The test changes later catalog terms and verifies the accepted snapshot is unchanged. Validation compares persisted offer and agreement terms, without requiring an archived version to equal the current catalog. |
| Later strategic deliveries | `nextBeat` is strictly later than acceptance. Economy invokes trade after a completed actor round; no calendar or rendering input participates. Due/last-attempt guards prevent duplicate attempts, and non-due rounds preserve shipment facts: [trade.ts](../core/simulation/trade.ts#L280-L360). Accepting at round 4 first delivers at round 8. |
| Combined obligations and all-or-nothing cargo | Both endpoints' cargo plus upkeep are summed by resource and checked before any debit. A shortage leaves resources untouched and records its endpoint/reason while retaining consent. Only a supplied exchange debits both obligations, transfers both cargoes and credits explicit yields: [trade.ts](../core/simulation/trade.ts#L246-L360). Both endpoint shortages and a real blocked economy round are exercised. |
| Decline, expiry, withdrawal and stopping | Only the named actor receives each operation. Crossed pending offers are unavailable; expiry is eight actor rounds. Either agreed participant can stop, outsiders cannot, and completed delivery counters remain. Closed agreements have no future shipments or advertised repair/stop actions. No new trade treaty duplicates consent authority. |
| Release and legacy compatibility | Consent actions remain absent from the current unreleased world. The unilateral command is never advertised. Optional old state fields remain readable; legacy routes without agreements cannot debit a partner or deliver cargo. Relevant observations are detached and expose pending offers and agreed obligations. |

## Independent evidence

- Exact declared `node scripts/check-task.ts core`: exit **0**, **38/38** engine tests, then strict scoped Vite Plus lint exit **0**. The complete child report was read; the outer evidence-command success is not substituted for those exits.
- A reviewer-authored scratch probe executed **48** legal core commands and reproduced all **48** frames exactly. JSON serialization/reload occurred after proposal and after the first delivery. Every produced world passed `isWorldState`. One shipment occurred at round 4; the recipient then stopped it; the counter remained one at round 8 and the pair could propose again. Five clock catch-up ticks changed no delivery count or actor round.
- The scratch probe is scripted core evidence. It does **not** establish a real agent-pair negotiation, a disk/host restart, a deployment, or public runtime behavior. Those integration acceptance steps remain separate. No product gate was run by this reviewer.

## Applied review lenses

- **Reviewing:** source and guard/helper behavior, rather than the author's report, grounded the account above. Recipient/proposer/outsider, accepted/declined/expired/withdrawn, and enabled/blocked/closed sibling cases were reconciled. No naming or tidiness preference is reported as blocking.
- **Testing:** assertions reach actual structured transitions, immutable snapshots, resource deltas and state identity. The supplied and blocked cases and scratch replay are falsifiable checks; they do not certify arbitrary state corruption, balance or all future recipes. Production source was not modified to obtain a passing observation.
- **DRY/SOLID:** canonical resource IDs, affordability/debit helpers, event emission and release-feature checks are reused. Trade lifecycle/settlement belongs in one headless trade module; choices and commands delegate while the engine retains the common authority boundary. Immutable consent snapshots intentionally duplicate historical values, rather than competing with the current recipe authority. No speculative market or negotiation framework was introduced. These assessments provide review reasoning, not proof or completion authority.

## Release acceptance still to observe

The roadmap requires a genuine development-agent pair to propose and accept through the supported service interface. This review did not perform that session, and current released worlds do not yet advertise trade. Final catalog/protocol checks, canonical verification, authorized capability activation and that real play receipt belong to integration. The no-blocker result applies to the reviewed engine scope and recorded revision only.
