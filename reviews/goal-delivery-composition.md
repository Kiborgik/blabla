# Goal-delivery adapter composition

Actual author: gpt-6-astra/high, 16 October 2026. ROOT task `compose-goal-delivery-contract`.

The already accepted `GoalDelivery` adapter is now wired into the JSON-lines structure adapter and `tests/coverage.rs::composed_bridge`. Both instantiate its lazy constructor, delegate recognized actions without converting errors into refusals, merge its distinct delivery-prefixed observations and discard fixtures on reset. No lifecycle, authority, eligibility or goal policy was copied or changed. The shared CLI remains buildable.

The production wiring is five insertions in `bridge/structure_adapter.rs`; the in-process wrapper adds a field, constructor, error-preserving dispatch and observation merge. Its existing whole-App reset invokes the same lazy constructor. Existing legacy and effort handlers remain in their prior order. The accepted adapter retains its 4500ms request deadline, 2MiB combined child-output limit and process-group termination. The transport remains under the existing 5000ms request allowance. Reset/untouched observation remain fixture/process-free; JSON cloning still allocates ordinary memory.

## Prospective and deciding checks

Before wiring, the new focused test failed at the actual in-process observation: `delivery_fixture_initialized` was absent (Null), where false was required. The retained runtime RED is `/tmp/goal-composition-red.log`; it compiled successfully and executed the assertion. The transport portion was not reached in that RED, which is not claimed as two independent failures.

`cargo test --locked --test goal_delivery_composition` runs one outer integration case which invokes exactly one named `coverage` case and then exercises the current-source Cargo JSON-lines adapter. It does not run the existing 8×512 coverage campaign. Both paths exercise:

- Lazy initial/reset observations, including eight unused reset/observe pairs.
- A genuinely qualified Partial claim through the real source CLI.
- An ineligible verification-only Delivered claim with actual refusal and unchanged records.
- Two-way isolation from legacy structural observations and the existing effort budget fixture.
- Malformed fixture argument errors; the in-process error leaves the full observation unchanged, while transport preserves its normal failed-session behavior.
- Full merged observation comparison in the in-process wrapper, and all selected delivery/effort fields plus the legacy structural fact through transport.

Transport additionally exercises qualified ordinary and bounded source closures, persistent visible Partial residuals and read-only reminder inspection, then reset and a separate fresh session. These are real synthetic component tasks, not semantic acceptance of any actual player's or viewer's delivery.

The development GREEN completed in15.54s including nested case and source builds. Measured transport calls were0–1341ms, with the largest setup1341ms; ordinary/bounded closes387/374ms and reminder reads441/458ms. These local warm observations do not establish cold-build or full-profile cost. The final declared receipt is the deciding current-input result; the retained development log is `/tmp/goal-composition-green.log`.

Existing standalone binding and independent review evidence remain authoritative for the broader15-fixture lifecycle matrix, exact residual resolution, final-reread limitations and deadline/output handling. They were read and reused, not rerun. No runtime, draft contract, canonical profile, global status or publication change is made. Owner still decides finite campaign measurement and draft promotion separately.

For exact review comparison, pre-edit wiring files are retained at `/tmp/goal-composition-before-adapter.rs` and `/tmp/goal-composition-before-coverage.rs`. Only the assigned two wiring files, focused test and this report changed.
