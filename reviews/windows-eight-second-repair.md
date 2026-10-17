# Eight-second request and Windows lifecycle follow-on

17 October 2026. Prospective implementation by gpt-6-astra/xhigh under accepted task `repair-windows-eight-second-lifecycle`, against published repair head `97ef93d00697efec1eda1a31d0bd790bb4a85346`. The prior candidate and independent reviews remain attributed to their own accepted records.

## Evidence and requested change

Exact-head CI 39068201202 failed both Product gates. Ubuntu passed all 1385 Rust tests and failed only the historical absolute-path audit. Windows passed 1343 of 1347 Rust tests; its three transport errors explicitly reported the 4500 ms request deadline, and its fourth failure was the remaining directory after the timed-out-session branch of the existing descendant-cleanup test. The exact terminal report and digest-verified original artifacts are preserved separately.

At 21:12:38 UTC the owner explicitly requested eight seconds for the central request limit. This supersedes the former 4500 ms helper / 5000 ms runtime bounds. It does not change the 1800-second Rust command limit, 60-second maximum startup allowance, 250 ms foreground cleanup bound, per-child 2 MiB transport output allowance, protocol limits or unrelated timeout fixtures. The prior 11933 ms CLI invocation is not explained or proved fixed by allowing eight seconds.

## Implementation

- `runtime::MAX_TIMEOUT` is now eight seconds and is the shared source for all five helper request budgets and the CLI upper-bound parser. The root verification profile, public range documentation and affected existing runtime-composition fixtures match eight seconds. Existing runtime, CLI and manifest boundary tests admit 8000 ms and refuse the next representable/discrete value above the cap. No new test function or suite was added.
- Existing command completion/output events remain the normal wait mechanism. Error diagnostics now retain separate monotonic durations for process spawn, Job attachment/resume, completion events, descendant termination, tree release and cleanup. Successful calls do not emit these diagnostics or format strings. Deadline checks also follow spawn and attachment immediately, with another check after cleanup. A synchronous OS spawn or attach can still return late; the diagnostics identify that rather than relabeling it as child execution.
- Timeout cleanup now requires the parent to be reaped, the process tree empty and both protocol threads finished before it releases process/Job handles and finally the working directory. The previous code could drop the directory before thread/Job release and after its tree-empty wait had expired. Exceptional background cleanup retains the tree, child, protocol threads and directory until release; it no longer treats an unsuccessful tree query as empty. The response receiver is released before handing off blocked reader cleanup. Windows handles now use standard owned RAII handles, providing safe cross-thread ownership without new FFI APIs or dependency changes.
- Working-directory deletion failures are reported to stderr instead of silently discarded. The historical Windows path in `reviews/windows-ci-recovery.md` uses a portable environment-relative representation; the original exact failed path remains in the unmodified ignored artifact evidence. Audit rules are unchanged.

The source proves a cleanup ownership/order weakness; it does not uniquely establish the cause of the remote directory failure. No antivirus, scheduler, ToolHelp or kernel cause is asserted. Pinned Rust 1.98.1, both locked provenance builds, source inventory, independent SHA-256 comparisons, request-owned executable, runner/config/environment fallback, typed error/refusal classification and final source/deadline validation remain intact. No persistent executable cache, skipped assertion or broad serialization was introduced.

## Verification

The actual declaration remained `cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings`. It ran from 21:27:22 UTC and completed with exit zero; strict clippy took 1.53 seconds. The proposed broader declaration was not applied before the focused run, so its results are separately identified as supplemental evidence rather than substituted for the declared check.

The approved focused command sequence ran once from 21:24:54 to 21:26:14 UTC, terminal exit zero. It built the current structure adapter, then ran these existing tests:

| Existing witness | Result / measured seconds |
| --- | --- |
| Batch and legacy fixture isolation | 1 passed / 5.53 |
| Each real refusal exposes its disqualifying fact | 1 passed / 13.04 |
| Finish/drop/timeout descendant cleanup and directory release | 1 passed / 0.63 |
| Runtime timeout boundary including eight-second admission | 1 passed / 0.04 |
| Complete source CLI transport guard suite | 19 passed / 3.71 |
| CLI invalid budgets plus eight-second admission | 1 passed / 0.03 |
| Manifest profile defaults/bounds plus eight-second admission | 1 passed / 0.00 |
| Real finite receipt sequence with eight-second config | 1 passed / 5.79 |
| Real role sequence with eight-second config | 1 passed / 2.59 |

The public audit then scanned 1367 tracked files with zero findings. All 23 declared input-file SHA-256 values matched the frozen pre-run snapshot afterward. `git diff --check` also passed. The supplemental script, complete logs, terminal exit/start/finish markers and input hashes are retained in this task's ignored scratch directory. Focused log SHA-256: `c974eac88638f51fe8b1dc1ea178843a437a998d96f64e1d8cc2c59be6b3ab39`. Declared log SHA-256: `1bf27833880de076ab665e933893e4a549f7691147b18cdf69f4c57a0bf7f34a`.

These are Linux observations. No Windows execution, successful full Product gate or fix for the unexplained long Windows invocation is inferred. The existing long reordered campaign is reserved for the next exact-head CI run rather than repeated locally. OS thread-exhaustion injection and a Windows-only local compiler run were not performed. The new error-only substage timings will discriminate any remaining remote delay. The orchestrator owns independent acceptance, publication and exact-head CI follow-through.
