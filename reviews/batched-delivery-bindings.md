# Explicit batch delivery-review bindings

Actual author: gpt-6-astra/high, 16 October 2026. Task `bind-batched-delivery-review`. This extends the accepted `bridge/goal_delivery.rs` probe, using actual current-source Cargo CLI subprocesses and the existing isolated fixture, timeout, output and typed-refusal helpers.

## Bound actions and observations

`delivery_batch_fixture(kind)` prepares two real source tasks with current Partial claims for the same required goal, then opens and accepts one review with primary `work` and explicitly additional `secondary`. A first independently selected source verdict is actually recorded. The subsequent `review_explicit_delivery_source()` invokes the real delivery-review command with an explicit source. It records the actual exit/result and reloads the task and claim views. No close, verdict or successful check is fabricated.

Eight finite preparations are selected with signed `rem_euclid(8)`: eligible secondary, eligible primary, existing unassigned source, secondary checked-source drift, artifact-only drift, wrong reviewing model, already READY reviewer, and secondary reacceptance/claim drift. The selected eligibility comes from actual declared target identities, source claim currentness, review currentness, accepted state/model, current registered reviewer model policy and actual tracked check readiness. Kind labels do not decide eligibility or command success. Positive controls independently require both sources' real assignments/current claims, successful recording and two separate same-goal verdicts. Repetition must preserve that two-row source distinction.

The artifact-only case changes the secondary claim's referenced file outside its explicit check-input path: the pinned target revision remains current while the claim's artifact currentness fails. The source-drift case changes its actual declared source input. No detached invocation of the deciding command is used as an eligibility oracle.

Before/after filesystem bytes establish refusal preservation. Both source task files must remain unchanged, and every nonselected review verdict must remain exactly preserved. Actual task-category exit2 is a refusal; compiler, invocation, malformed output, signal, timeout and other diagnostic categories remain adapter errors. Existing strict argument validation rejects malformed selectors before fixture work; hostile signed values choose a finite case without input-proportional allocation.

## Isolation and finite resource limits

The batch fixture is separate from the existing delivery fixture. Constructor, reset and untouched observe perform no fixture/filesystem/process initialization; observation still clones JSON in memory. Explicit setup initializes a real project. A first review action may construct the real positive default fixture, with initialization false in the preceding observation and no invented preexisting eligibility. Later actions operate on that same observed fixture. Reset discards both fixtures.

Both fixture directions and two separate probe instances are checked for unchanged observations. Existing action handlers retain their commands and policies; their view projection now merges its own fields so it cannot erase the separate batch state. Shared per-action terminal flags are cleared normally. No shared dispatcher, canonical profile or draft promotion is changed.

The existing4500ms whole-request deadline and2MiB combined subprocess output cap remain enforced, below the5000ms application allowance. Tests print actual setup/action durations and152 untouched reset timings as local non-gating evidence. They do not estimate a full4096-action campaign or claim old-version speedup.

## Prospective evidence and limits

The genuine first check was one passing existing refusal-classifier control and three failures for the absent batch action/initialized observation (`/tmp/batch-binding-red.log`). Later assertions were still prospective then. The first implementation run exposed a fixture input omission: the secondary scope was not part of its explicit check-input declaration, so the intended source change correctly remained current. The retained failed run is `/tmp/batch-binding-input-omission.log`; the fixture was corrected to explicitly pin its source file, while keeping artifact-only drift separate. A temporary missing Rust delimiter was corrected before any successful implementation claim.

The focused suite exercises the eight real preparation/decision pairs, repeated source-specific replacement, exact refusal bytes, both isolation directions, lazy resets/first use, hostile arguments and the existing typed-decision classifier. Each observed pair is evaluated against the actual draft action; adversarial flips to success, selected-verdict existence, preservation or refusal bytes must make its rule RED. The final declared receipt is the current-input deciding result. Existing standalone lifecycle evidence remains the authority for unchanged ordinary/bounded closure and final-reread races; this sequential bridge does not claim to execute those races anew.

References inside these projects describe actual isolated component artifacts and explicitly exclude live player or viewport delivery. The useful successor is owner review/composition of this accepted explicit-source binding and a bounded draft measurement if needed. Individual source acceptance, residual resolution and project completion retain their existing independent authority.
