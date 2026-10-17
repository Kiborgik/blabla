# Batched delivery review through both adapters

Actual author: gpt-6-astra/high, 16 October 2026. Task `compose-batched-delivery-bindings`.

## Existing seam and bounded change

Both dispatcher paths already forward recognized actions through the same `GoalDelivery.call`: the current-source JSON-lines executable in `bridge/structure_adapter.rs` and `tests/coverage.rs::composed_bridge::App`. The accepted new batch handlers are therefore reachable without another production registration. This packet adds focused integration assertions only. It does not invent a missing-dispatch RED or alter a working dispatcher for test bookkeeping.

`tests/coverage.rs::batched_delivery_composed_probe` exercises the actual in-process composite. `tests/goal_delivery_composition.rs::batched_delivery_composed_paths_preserve_explicit_sources_and_errors` first invokes exactly that one nested test, requires its named pass, then launches the real Cargo example through `AppSession`. The declared filter `batched` excludes the older whole-lifecycle composition case; the nested filter is exact. No canonical campaign is run.

## Observable boundaries

Both paths establish a current assigned-source positive review from real CLI fixtures and require actual success, a selected verdict, two separate same-goal source verdicts, unchanged source task bytes and unchanged nonselected verdicts. The in-process path selects the secondary source; JSON-lines selects the primary. The in-process refusal names an existing unassigned source. JSON-lines uses artifact-only drift: target revision remains current while the selected claim becomes stale. Both require actual task refusal and byte preservation, distinct from adapter failure.

An already initialized ordinary delivery fixture remains intact across batch setup and review. Actual ordinary claim recording also leaves the batch review observation intact. Effort threshold inspection and a legacy structural scenario preserve every delivery observation; batch transitions preserve all non-delivery observations. Both paths reset to their exact untouched observation. Untouched setup/reset/observe still performs no nested CLI fixture initialization; JSON observation cloning remains ordinary memory work.

Malformed batch arguments propagate through the established boundaries: `E_ACTION` with unchanged observable state in-process, and `APP_FAILURE` followed by the existing terminal-session `APP_IO` through JSON-lines. A fresh JSON-lines session resets cleanly. Neither error is relabeled as a task refusal or an unknown action.

The JSON-lines session retains its5000ms allowance. The reused adapter keeps its4500ms request deadline,2MiB subprocess output cap and real current-source Cargo invocation. There is no installed-binary shortcut, increased budget, dropped legacy assertion or contract promotion.

## Evidence and remaining authority

The accepted standalone binding already supplies genuine missing-binding RED, eight finite actual eligibility/refusal preparations, source/artifact drift and adversarial contract mutations. Its independent review found no blocker. This packet reuses those conclusions and checks the two concrete composition seams. The first focused development run reached and passed the in-process dispatch, then failed because the JSON-lines test assumed undeclared nested diagnostic fields survived AppSession schema projection (`/tmp/batch-compose-development.log`). The corrected test explicitly requests typed diagnostic records after their real fixtures initialize, preserving the source-verdict assertions; production projection is unchanged. The failure is a test-harness schema mistake, not a missing-dispatch counterexample. The corrected focused development run passes its one outer test plus the exact nested in-process test in10.37s (`/tmp/batch-compose-development2.log`). The final receipt is recorded only after this report and tests are stable, with the nested child output retained in that log.

Historical closure and final-reread race evidence remains with the accepted implementation. This sequential composition check makes no new concurrency claim, no live player/viewport delivery claim and no4096-action coverage claim. Owner acceptance of this packet releases the integration handoff; any draft promotion or canonical verification remains an explicit owner decision.
