# Compact exact-town trade observations

## Recommendation and authority

Actual author: gpt-6-astra/high, core simulation worker. This is a source-grounded design study, not an independent review of my preceding endpoint implementation. Production files remain frozen. The intended outcome is a smaller, self-contained agent observation that retains every legal exact-town action, canonical trade obligations and the existing two-item plan lifecycle.

Recommend an explicitly requested `compact-trade-v1` observation view. Factor repeated town geography and recipe terms into observation-local tables, while keeping each complete `GameAction` unchanged. Keep the current observation as the default compatibility view. Do not implement paging, truncate choices, replace actions with indexes, or add navigation in this slice. The parent must approve the schema and open implementation scope first.

## Actual source seams

- `core/simulation/trade.ts` currently repeats both towns' full `describeSettlementSite` text for each proposer-town/recipient-town pair. Exact IDs already reside in the action; accepted offers and routes retain `from` and `to`.
- `core/simulation/sites.ts` derives terrain/deposit production through `siteProduction`; `ECONOMY_RULES.baseProduction` and `RESOURCE_IDS` define the base vector and canonical order. A site's base output is before focus, productivity, buildings and upkeep, not net resource gain.
- `core/content.ts` supplies complete `TradeTerms`: construction, both cargo vectors, both upkeep vectors, both commerce yield vectors, cadence and damage threshold. Proposed recipe facts must use these canonical objects. Pending offers and accepted agreements instead use their own immutable terms snapshots.
- `core/engine.ts` creates detached observations, including legal actions, pending offers, active routes, admission and derived plan status. Ordinary seats currently receive only their own full city records; repeated trade descriptions reveal the eligible rival town geography.
- `cli/protocol.ts` forwards observation requests to `GameStore.observation`. There is currently no format selector. A new selector must be carried through each supported observation boundary and tested, not assumed to exist.
- `core/planning.ts` validates full exact action shapes and at most two items. References in explanation tables must never become command arguments, queued actions or reservations.

## Proposed compatible schema

Add an optional request selector `observationFormat: 'compact-trade-v1'` at supported observation boundaries. Missing selector returns the existing shape and wording. Reject unknown selector values explicitly. This is a presentation protocol version, not a world release or a change to gameplay eligibility. The response echoes that selector and includes an optional `tradeFacts` object only in this view.

`tradeFacts.cities` is a deterministically ordered array of unique records:

- `cityId`, `civId`, `name`, `tileId`, `terrain`, `deposit`
- `terrainOutputs: Partial<Resources>`
- `depositOutputs: Partial<Resources>`
- `baseOutputsBeforeFocusAndProductivity: Resources`

Derive these through the shared site-production semantics and canonical resource order, including the release gate for terrain output. Do not copy tuning values into a transport formatter. Include the existing cities referenced by visible trade proposals, pending offers, visible agreements or a trade action in the agent's plan, once each. A disappeared endpoint remains absent with the existing invalidated/blocked explanation; never substitute another town. Do not dump every map tile or unrelated city details.

`tradeFacts.recipes` contains each currently relevant, released proposal recipe once: `id`, `name`, `description`, and a detached complete `terms: TradeTerms`. Its role is explicitly the current proposal catalogue. Pending `tradeOffers[].terms` and `routes[].agreement.terms` remain authoritative snapshots and stay in their current fields. Never reconstruct an old quote from the current recipe, even if its ID is the same. A recipe ID/version tuple alone is insufficient to justify replacing an existing snapshot with current tuning.

`tradeFacts.semantics` states once that stockpiles are civilization-wide; a proposal pays nothing and requires recipient consent; the proposer pays construction once on acceptance; base yields precede productivity and expenses; and straight-line hex distance is neither a traversed path nor travel time. It must not imply cargo departure or a delivery guarantee.

Keep `legalActions` as the complete ordered array of existing `ActionOption` objects. Preserve every `action` byte-for-byte after ordinary JSON serialization, retain its label, and shorten only trade explanation prose. A proposal reason carries its actual geometric distance and points to the town/recipe facts via the IDs already present in its action. Acceptance reasons point to the named pending offer and its stored terms, not the current recipe. Other action reasons remain unchanged.

This is semantic fact preservation, not byte-identical reconstruction of old English prose. A consumer that needs the old explanation can request the compatibility view. No new action keys, plan-item keys, persistent world fields or replay commands are needed. Prefer one shared pure core projection used by CLI and hosted observations rather than separate transport implementations. It must not mutate state, advance time, recompute admission differently or silently change legal membership.

## Measured throwaway projection

The study reused the endpoint test's labeled synthetic canonical fixtures, fixed seed 17 and fixed timestamp. It changed no production files. The temporary projection retained every action and label, shortened proposal reasons and added town facts, current canonical recipe terms and shared semantics. It asserted exact action-array equality and that every proposal's two town references resolve.

| Fixture | Proposals | Total choices | Current observation bytes | Proposed projection bytes | Fact-table bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5 cities | 4 | 10 | 10,660 | 10,954 | 2,207 |
| 25 cities | 100 | 122 | 96,247 | 52,814 | 7,589 |

The 25-city projection saves 43,433 UTF-8 JSON bytes, approximately 45.1%. The five-city projection adds 294 bytes, approximately 2.8%, because there is little repeated geography and complete recipe obligations are additional information. These are exact local projection measurements, not deployed protocol measurements, token counts, wall-clock latency evidence or universal limits. The prototype covers the no-pending-offer fixture; acceptance/history/plan variants still require implementation tests.

The probe and its output are in `.blabla/scratch/design-compact-trade-observations/projection.ts` and `projection.log`. The source is a disposable measurement artifact, not a proposed production implementation. Its fixture already has terrain production enabled; implementation must separately prove earlier-release behavior and feature gates.

## Alternatives and tradeoffs

1. Shorter inline prose avoids a schema addition, but still repeats town facts for every pair and encourages dropping useful quantities or making ambiguous abbreviations. It is a reasonable compatibility view, not the strongest long-term representation.
2. A shared facts table with unchanged complete actions is the recommended first slice. It reduces repetition, makes exact vectors available before consent, and permits clients to render familiar labels without interpreting prose. The extra join is bounded and explicit. Small worlds can cost slightly more bytes; prefer an explicit stable format over a hidden size-triggered response shape.
3. Factor the full Cartesian action list into eligible source/recipient sets or introduce paged queries. Either could reduce the remaining quadratic action payload, but changes how agents discover and prove legal choices, requires a real query/revision protocol, and risks hiding combinations. Defer it until measurements justify a separate contract. Do not claim the facts table removes quadratic work or bounds arbitrary worlds.

Future geographic transport can add actual quoted path/cadence facts to its own versioned terms after approval. This design must not reserve misleading path fields or treat current hex distance as that future quote.

## Prospective deciding checks

- Keep the exact legal action array and order equal between full and compact views for both ordinary seats and Director; cover 5/25 cities, multiple eligible recipes, resource constraints and pair caps. Every reference resolves exactly once with no hidden truncation.
- Compare every displayed site vector with the shared site-production calculation, with terrain production both present and absent. Compare every catalogue vector with actual current terms in canonical resource order.
- Change catalogue tuning in an isolated fixture and prove old pending/accepted snapshots still expose their original obligations. Cover acceptance after town-array reorder and missing endpoints without redirection.
- Retain two-item plans and exact head equality; verify a disappeared endpoint invalidates the follow-up while the completed head and original observation revision remain unchanged. Observation formatting never autoexecutes a plan.
- JSON restart, repeated reads and both views leave canonical state unchanged. Unknown selectors refuse clearly; absent selectors preserve the previous response. Verify CLI and hosted/MCP parity through the same projector.
- Record actual UTF-8 bytes for both views and deterministic fixture work counts. Establish a finite fixture envelope only after implementing the schema; do not hand-edit existing benchmark expectations or add a universal millisecond gate. The unchanged default view should not silently invalidate current baseline payloads.

## Bounded next decision

Approve or amend the opt-in schema first. Then open one core projection/schema task with one corresponding transport-parity task, using prospective tests above. This report's exact nine-test endpoint baseline verifies the source being studied; it does not prove the unimplemented compact protocol. Endpoint gameplay remains subject to its independent review and authorized release process.
