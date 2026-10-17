# Civic production path: independent implementation review

Reviewed 2026-10-16 12:45 UTC by gpt-6-astra, separately from the implementation author. The reviewer previously supplied the intended design; this review assesses the actual implementation and evidence, not an independent authorship claim about that design.

## Verdict and scope

No blocking finding in this bounded source review. Inspected the four tests in `tests/civic-reachability.test.ts`, the shared civic definitions and release registry, and the relevant existing legality, release, operation, economy and milestone seams. No gameplay, catalogue or release source was edited by this review. Integration acceptance and online activation remain separate decisions.

## What the legal witness establishes

The journey starts from an ordinary seeded world and applies registered compatible successors through recovery, then `settlement-civics-1`. It does not edit resources, discoveries, eras, milestones, buildings or routes to manufacture progress. Every action is checked against current canonical legal choices. It uses the actual independent strategic catch-up operation and its clock, not direct economy calls or a manually incremented round.

The journey researches Cultivation, builds farms, researches Civic institutions in two civilizations and negotiates three distinct bilateral routes. It checks that acceptance alone has not delivered cargo, then realizes later deliveries. Actual road and state milestones enable era-1 construction without advancing the calendar from -10000. The academy pays two culture and one credit, records positive science and no culture output. The journey then completes Kiln firing and Fuel management, constructs the fuel yard and kiln, and records fuel payment of two materials plus positive energy output.

The final author diagnostic reports 19 commands, 25 explicit beat calls and 26 total strategic ticks, with four deliveries on each of three routes. The extra strategic tick can occur through normal due realization before an action. This is a deterministic legal test witness, not autonomous model play or an online campaign.

Each accepted journey transition is compared against the same transition after JSON restoration, validates both restored input and output, and asserts input immutability. This supports exact deterministic transition replay. It does not prove hosted persistence, historical cross-version binary replay, duplicate command-ID handling or every possible seed; those have separate owners and evidence.

## Data and compatibility boundaries

`settlement-civics-1` is an additive registered successor of recovery, adding statecraft while retaining prior capabilities. The default world release is still foundations 1. The current catalogue test confirms statecraft appears only in this new release. Earlier legally reachable releases could not research or construct the changed prepared civic definitions, so this change does not retune an already released academy recipe.

The academy, gathering place, Fuel management and fuel yard match the intended connected data. The academy uses the existing opening-stock allocator; the fuel yard has no extra one-time stat effect. Research, owned-city construction, era prerequisites, production rounding and pause controls use their existing shared mechanics. New fuel entries remain feature-gated. No new currency, separate civic research queue or political victory shortcut is introduced.

The initial author RED log failed at the actual unknown/incompatible civic release assertion. It was not a fabricated assertion or compiler failure. After the catalogue and release were authored, the four tests passed. That prospective RED establishes the missing release boundary; it does not by itself falsify every subsequent civic behavior.

## Deliberately synthetic scarcity probes

The other two scenarios derive from the legal journey but explicitly edit a detached civilization balance to zero. They validate that fixture and label it synthetic. They are component counterexamples, excluded from the reachability claim.

The culture case legally adds a gathering place, sets starting culture to zero, and verifies that the academy pays and produces nothing despite positive culture appearing later in that beat. The energy case sets starting energy to zero, verifies that fuel production succeeds, and verifies that the kiln still pays and produces nothing because its opening allocation was short. Both preserve their inputs and reproduce the same transition from the same fixture.

These checks establish same-beat input exclusion for these concrete recipes. They do not claim that new production cannot fund later research or due trade, that all recipes are balanced, or that paid production must be positive at full damage. Generic pause, scarce inputs across multiple cities and zero-productivity behavior retain their existing separate engine evidence.

## Verification and remaining boundary

Read the full author logs: the initial absent-release RED and final `evidence-3-6-1792153951193038299.log` with four passing tests. The author's scoped lint log contains no diagnostic failure. The independent review runs its exact declared four-test command and records its own observed result; it does not repeat the wider engine, protocol, visual or integration suites.

The inhabited foundations world has not received civic capabilities. Permission for compatible activation remains pending. Current legal source reachability is useful release evidence, not live availability, observed agent strategy, spectator rendering proof or a balance claim. The next proposed public-project charter still requires its own schema, contract, implementation and review.
