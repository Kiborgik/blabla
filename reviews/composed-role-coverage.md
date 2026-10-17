# Composed role-coverage integration repair

Author: actual `gpt-6-astra` / high, 2026-10-16. Task:
`repair-composed-role-coverage`.

The accepted-root full suite exposed `E_ACTION: unknown composed action` in
`reordered_composed_contract_preserves_targeted_witness`. The active project now
includes `task-role-resolution`, but this test's in-process adapter manually
composed only the older probe groups. Including the production adapter module did
not automatically add its new state, dispatch or observations to that wrapper.

The original full-run RED remains in
`/workspace/shared/tooling-accepted-tests-corrected.log`. A current-source targeted
run reproduced the same failure before correction in
`/tmp/composed-role-coverage-red.log` (exit 101, 0.25 seconds).

The correction adds the existing lazy `TaskRoles` probe to the test wrapper,
passes the actual positional argument array, propagates real probe errors and
merges its observations. Wrapper reset reconstructs that lazy member through its
existing constructor. An explicit source-group assertion ensures the active role
contract remains in this composed regression. No production implementation changes.

The campaign still reads every active behavior contract and retains seed 0,
8 cases, 512 steps, shrink budget 256, all-obligations verification and the two
original targeted multi-action witness assertions. No active contract, action,
coverage requirement or runtime failure is omitted or converted into a fake
decision. The real CLI role setup now contributes its actual cost to this test.

The behavioral command is `cargo test --locked --test coverage`. Its task
receipt and complete retained log state the executed outcome. The direct integration
run is retained separately in `/tmp/composed-role-coverage-green.log`; the filename
does not establish success. This is author integration evidence, not an independent
review or a canonical project finish.

The direct complete check returned exit 0: 36 tests passed, including the unchanged
composed campaign and both original targeted witnesses, in 276.51 seconds. The full
log was read. The default test output does not expose the successful test's captured
action/reset metrics, so no exact counts beyond the declared campaign are claimed.
This is measured local integration cost, not a speedup or wall-clock gate. It was
executed directly before task evidence recording; its successful process exit must
not be represented as a runner-owned task receipt without the appropriate workflow.

The subsequent runner-owned full check also passed all 36 cases in 267.51 seconds:
`.blabla/scratch/repair-composed-role-coverage/evidence-1-5-1792170188575237885.log`.
Its explicit input list omitted the modified `tests/coverage.rs`, a receipt limitation
reported to the owner rather than concealed. The owner then pinned that path and
amended the final check to `cargo test --locked --test coverage --no-run`. That final
receipt proves current compilation only; both preserved complete runs remain the
behavioral evidence. There was no third unchanged expensive campaign or reduction
of its assertions/profile.
