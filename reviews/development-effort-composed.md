# Development-effort adapter composition

2026-10-16. Actual author gpt-6-astra/high. The frozen effort adapter is now wired into the JSON-line Cargo example and the separately owned in-process coverage application. No accounting implementation, contract, canonical profile or draft status changed.

## Changes and controls

`bridge/structure_adapter.rs` adds the module, lazy instance/reset, Result-preserving call route and observation merge. `tests/coverage.rs::composed_bridge::App` owns the same actual probe and forwards calls/observations; its existing reset reconstruction discards the probe. The full reordered composed-contract test and its 8×512 assertions are unchanged.

Two new transport tests use actual `AppSession` at the existing 5,000 ms allowance. They require a genuinely qualified positive phase fixture, successful stored interval creation, an exact threshold fixture, real wrong-model refusal, unchanged records, two-way legacy/effort and phase/budget isolation, full reset equality, repeated unused resets, and malformed/unknown actions as runtime errors. The separate focused in-process test exercises actual phase creation, real 100-second/20-second threshold arithmetic, complete merged-state preservation and reset. The standalone adapter's finite matrix, no-nested-Cargo initialization control and exact-core private race evidence are retained, not re-executed here.

Prospective evidence under `.blabla/scratch/compose-development-effort/`:

- `missing-dispatch-red.log`: both transport tests actually fail because the observation lacks `phase_fixture_initialized`.
- `inprocess-missing-dispatch-red.log`: the in-process application actually refuses `positive_phase_fixture` as unknown.
- `fixture-field-compile-error.log`: an initial test referenced `.fields` instead of the actual Contract `.state`; this is a test-author error, not product RED.
- `first-composed.log` and `runtime-corrected.log`: the positive transport path passed, while the error test incorrectly expected a failed AppSession to remain observable/restartable. The corrected test asserts actual `APP_FAILURE`, closed-session `APP_IO`, and uses a new session for the independent unknown-action case. No runtime semantics were changed.
- `composed-green.log`: both corrected transport tests and the one focused in-process test pass. The final declared task receipt reruns only these three cases against the frozen deliverables; all 36 existing coverage-suite tests remain filtered out, together with the effort module's two inherited private tests.

## One finite draft campaign

`campaign-command.json` records the exact current-source Cargo launch. The single run selected `contracts/development-effort.bla`, seed 0, 2 cases × 64 steps, 5,000 ms request allowance and shrink budget 32. It used the composed current-source Cargo example and returned exit 0 / GREEN. No seed hunting or profile adjustment occurred.

`campaign.json` reports all 27 obligations verified, zero unexercised and zero violated. All twelve draft expectations were exercised. Actual metrics: 128 total actions, six resets, four replay actions, zero reduction actions, corpus size/peak 31. Full coverage arrived at action 71 / 10,662 ms; verifier elapsed 21,278 ms and externally measured elapsed 21.347 seconds. The replay count is the report's metric, not four extra actions added to its total. The 128 recorded actions comprise 13 phase setups, 13 named positive setups, 19 budget setups, 27 named threshold setups, 21 phase calls and 35 budget reads. Positive phase effects have 15 witnesses; real ineligible refusals four; zero-denominator undefined ratio two. All complete coverage rows were inspected. There is no counterexample or runtime error.

`campaign.stderr` retains all 128 local probe timings: 51–447 ms per action, including actual fixture construction. The focused transport run also measured 16 composed unused reset/observe pairs at approximately 1.2 seconds. This includes the existing legacy lifecycle/session reset behavior and must not be compared as a speedup/regression against the standalone effort object's sub-millisecond reset measurements. Timing is local evidence, not a cold-build/concurrency guarantee or a whole canonical-profile estimate.

`campaign-metadata.json` records the identical root status SHA-256 before and after: `27c3ab0c97dfe778fd00c70e33f4a7e4a42724b66c967b8da40ac9fd29a55b45`. The standalone file run did not overwrite root verification. Draft promotion and the unchanged canonical seed 0 / 8×512 / 5,000 ms / shrink 256 verification remain owner decisions. This supplementary GREEN does not establish project completion or the owner's real development-time ratio; synthetic interval arithmetic remains explicitly synthetic.
