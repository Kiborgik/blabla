# Exact repair platform gate verification

17 October 2026. Prospective author: gpt-6-astra/xhigh, actual accepted assignment `verify-repair-platform-gate`.

## Terminal result and identity

[CI 39068201202](https://github.com/Kiborgik/blabla/actions/runs/39068201202), attempt 1, PR 5, completed **failure** on head `97ef93d00697efec1eda1a31d0bd790bb4a85346`, branch `feat/agentic-mmo-city-state`. Official run readback updated at 21:10:47 UTC confirms the same head as both job responses and both artifact metadata records. The run began at 20:47:26 UTC. Neither platform passed its full Product gate.

- [Windows job 117500354479](https://github.com/Kiborgik/blabla/actions/runs/39068201202/job/117500354479): 20:48:31–21:08:15 UTC, failure. Product gate 20:49:21–21:08:02, 18 minutes 41 seconds. Rust tests and public-tree audit failed; all other gate commands passed.
- [Ubuntu job 117500354678](https://github.com/Kiborgik/blabla/actions/runs/39068201202/job/117500354678): 20:48:31–21:10:46 UTC, failure. Product gate 20:48:50–21:10:39, 21 minutes 49 seconds. Rust tests passed; public-tree audit alone failed.
- Both jobs skipped the subsequent Hello contract check after the failed gate. Both uploaded their failure evidence successfully. No rerun, cancellation, source change or deadline increase occurred during this observation assignment.

## Windows: four concrete test failures

The Rust command exited 100 after 888.660 seconds including compilation; nextest itself reported 667.880 seconds, 1347 tests run, 1343 passed, four failed and two skipped.

1. `batched_delivery_bindings::batch_and_legacy_fixtures_remain_isolated_in_both_directions`, 5.888 seconds: request deadline error during actual `task evidence work --run`. The final request acquired its verified artifact in 607 ms; the failing CLI invocation took 3566 ms after preceding open, finish and accept calls of 346, 82 and 38 ms, plus source checks. The test did not reach a successful isolation result for this invocation.
2. `bounded_result_bridge::each_real_refusal_exposes_its_actual_disqualifying_fact`, 18.756 seconds: request deadline error during actual `status`. That request acquired its artifact in 676 ms, then the CLI invocation took 7640 ms.
3. `runtime::finish_and_drop_terminate_inheriting_descendants_and_release_threads`, 0.667 seconds: `tests/runtime.rs:254` asserted that the timed-out session's directory no longer existed. The earlier explicit finish and drop branches succeeded. In the failing third branch, both the expected `APP_TIMEOUT` and descendant-stopped assertions succeeded before the directory assertion failed. The log does not identify a remaining file or handle. This is a cleanup residual, not evidence that the descendant survived.
4. `coverage::reordered_composed_contract_preserves_targeted_witness`, 143.062 seconds: request deadline error during actual unknown-role `task open role-probe-1`. The final request acquired its artifact in 434 ms; the failing CLI invocation took 11933 ms. The immediately preceding comparable unknown-role call took 122 ms. This campaign failed before satisfying its complete assertion set; the shorter runtime is not a speed result for a successful full campaign.

All nineteen `source_cli_transport` guards passed on Windows. The complete development-effort binding/composition cases, its prior budget-close coverage witness, direct task-role suite and finite ready-receipt suite also passed. The former pre-spawn `expert_memory` tempfile failure did not recur in this run; its original OS cause remains unproven.

The three deadline failures are now localized to the CLI-invocation interval, after successful request-scoped acquisition. That interval currently includes process creation, suspended Job attachment/resume, child execution, output/exit completion and termination cleanup. It does not isolate those sub-stages. The 7640 ms and 11933 ms intervals exceed the 4500 ms request guard, so a blocking operation outside the timed completion receive or delayed cleanup remains material to investigate. The logs do not establish antivirus, scheduler, spawn, Job enumeration or application execution as the unique cause. No such hypothesis is presented as a diagnosis.

## Ubuntu and aggregate budget

Ubuntu's Rust command exited zero after 1165.651 seconds including compilation. Nextest reported 998.267 seconds, 1385 tests run, all 1385 passed and two skipped. The complete reordered campaign passed there. Both platforms' actual Rust commands completed inside the unchanged 1800-second per-command gate limit. Windows's result includes a prematurely failed campaign, so it does not prove successful full Windows campaign fit.

Both self-hosting `finish` commands passed: Windows 131.346 seconds, Ubuntu 81.651 seconds. Their success does not override failed Rust or audit commands in the Product gate.

## Common audit failure

Both audits found exactly one `windows-drive-path` occurrence at `reviews/windows-ci-recovery.md:37`, the historical absolute temporary path quoted while diagnosing an earlier Windows tempfile refusal. Each scanned 1367 tracked files. The report should describe that location portably while retaining the original exact byte evidence in ignored diagnostic artifacts. The audit rule itself should remain unchanged. This observation task did not edit that separately owned report.

## Command timings

Seconds below are the gate's retained monotonic measurements, including each command's complete execution, rather than inferred from GitHub step duration.

| Command | Windows exit / seconds | Ubuntu exit / seconds |
| --- | ---: | ---: |
| fmt | 0 / 2.082 | 0 / 1.592 |
| clippy | 0 / 30.816 | 0 / 25.463 |
| rust-tests | 100 / 888.660 | 0 / 1165.651 |
| gate-schedule | 0 / 1.350 | 0 / 0.313 |
| systemone-provider | 0 / 3.262 | 0 / 0.862 |
| native-expert | 0 / 0.848 | 0 / 0.577 |
| todo-python | 0 / 0.058 | 0 / 0.057 |
| bridge | 0 / 0.110 | 0 / 0.076 |
| bridge-tests | 0 / 5.354 | 0 / 3.865 |
| self-hosting-finish | 0 / 131.346 | 0 / 81.651 |
| self-hosting-status | 0 / 0.666 | 0 / 0.545 |
| example-python | 0 / 1.913 | 0 / 1.365 |
| example-typescript | 0 / 6.889 | 0 / 4.091 |
| example-go | 0 / 18.792 | 0 / 11.730 |
| example-c | 0 / 4.502 | 0 / 0.357 |
| example-cpp | 0 / 13.889 | 0 / 1.182 |
| example-java | 0 / 7.809 | 0 / 6.516 |
| audit | 1 / 1.529 | 1 / 2.132 |
| docs-links | 0 / 0.128 | 0 / 0.122 |
| versions | 0 / 0.038 | 0 / 0.039 |
| diagrams | 0 / 0.047 | 0 / 0.046 |

## Retained evidence and bounded next action

The complete decoded job logs, official run/jobs/artifact JSON, ZIPs and every extracted gate log are retained under this assignment's ignored scratch directory. Artifact SHA-256 was calculated from the downloaded ZIP bytes and matched GitHub's digest:

- [Windows artifact 12114561806](https://github.com/Kiborgik/blabla/actions/runs/39068201202/artifacts/12114561806), 66222 bytes: `d57e6855f1af76bea50fc2daf620c88e546beb034cb68b0ef99d97b24291b880`.
- [Ubuntu artifact 12114338797](https://github.com/Kiborgik/blabla/actions/runs/39068201202/artifacts/12114338797), 56641 bytes: `f47e83a20b34d7122541a6722b3f2d9e9bdd435ac3a4c281ac3199f8e8f2079e`.

A follow-on scoped repair should first remove the portable-report audit finding, then use these existing failing witnesses to distinguish Windows process creation/Job attachment, child completion and timeout-directory cleanup. At 21:12:38 UTC, after this run had completed, the owner explicitly requested an eight-second central request limit. That prospective change requires a coherent separately assigned implementation and does not alter this run's actual 4500 ms guard or explain the 11933 ms interval. Preserve the 2 MiB output budget, provenance builds, source and executable identity checks, descendant containment and the 1800-second gate limit. No new broad suite, security exception or unverified persistent executable reuse is justified by these artifacts. The orchestrator owns the next repair assignment and publication.

This assignment's declared `test -s` command proves only report presence. It cannot establish platform success. READY handback means that exact-head terminal monitoring and concrete evidence capture are complete, with both failures explicitly reported; it does not mean the repair or CI is GREEN.
