# Windows CI recovery and bounded repair plan

17 October 2026. Prospective author: gpt-6-astra/xhigh, assignment `recover-windows-failure-diagnosis`. This report contains read-only diagnosis and a proposed implementation sequence. No lost receipt, source file or test outcome has been recreated.

**Goal:** Repair the actual published Windows failures while preserving current-source verification, real lifecycle assertions and the existing request bounds.

**Architecture:** A prospective shared request-scoped transport can remove repeated Cargo dispatch across four affected bridge helpers while reusing the existing platform process containment. The separate Windows temporary-file creation failure needs its own evidence-led diagnosis; transport reuse does not repair a failure before process spawn.

**Tech stack:** Rust 1.98.1, Cargo, existing tempfile/SHA-256/parser dependencies, nextest, Windows Job Objects and Unix process groups.

**Design authority:** Current `AGENTS.md` and project contracts remain authoritative. The earlier independently inspected request-transport design is historical conversation evidence, not a surviving report or current acceptance receipt; its mandatory conditions are restated below for prospective disposition.

## Exact evidence and restoration boundary

Published head `8fecec5e9533a0f1c25e263a88c4f95194a642dc`, [run 39058939042](https://github.com/Kiborgik/blabla/actions/runs/39058939042): Windows job `117472820251` failed Product gate; Ubuntu job `117472820405` succeeded. Windows reports 1328 Rust cases: 1308 passed, 20 failed, 2 skipped. Its Rust stage exited 100 after 774.0 seconds and Product gate exited 1. Formatting, clippy and every non-Rust stage passed, including self-hosting finish. Those separate successes do not override the failed product gate.

The [Windows artifact 12110923674](https://github.com/Kiborgik/blabla/actions/runs/39058939042/artifacts/12110923674) was downloaded and its SHA-256 verified as `cf11cd9a5d91e7b97d5704f3ccdb34c06db72ec804da73484e5657ccac1ac277`. The archive, complete extracted logs, ANSI-cleaned Rust log and all twenty complete failure blocks are retained outside the repository under `/workspace/shared/windows-ci-39058939042`. The classification below comes from reading every failure block, not only failed titles.

Two executor interruptions prevent a passing candidate claim. The original final matrix log ended during the third ready-receipt case without a terminal receipt. A restored prospective run passed batched delivery 6/6 and entered bounded results before the second executor replacement. It also had no terminal receipt. The second replacement lost the uncommitted transport candidate, the local task ledger and both local log sets. Prior targeted nineteen-guard and receipt observations remain historical only. No READY, acceptance, successful matrix or publication of that candidate is asserted.

The orchestrator restored only the published Git checkout. This worker separately restored the pinned Rust 1.98.1 toolchain, rustfmt and clippy from the official Rust distribution, verified the installer checksum and tool versions. Current-source CLI execution is now available. A new assignment was opened and accepted before this report was written.

## Twenty failures: three distinct boundaries

### Eighteen affected delivery/receipt paths

Four batched-delivery failures, six bounded-result failures, two singular-delivery failures, four ready-receipt failures and two batch-composition failures report `source CLI exceeded request time/output budget`. Concrete failed operations include genuine task open, accept, evidence, ready, finding, challenge, delivery-review, finish and status calls. Their observed timing and the prior dispatch investigation support aggregate deadline pressure; the existing combined error does not independently label time versus output. None of these blocks shows a semantic lifecycle mismatch.

The current published `bridge/goal_delivery.rs`, `bridge/bounded_results.rs` and `bridge/ready_receipts.rs` still launch current-source Cargo separately for every real operation. The earlier uncommitted optimization is absent.

### One additional task-role transport path

`coverage::reordered_composed_contract_preserves_targeted_witness` fails at `tests/coverage.rs:705:79`. The actual adapter error occurs during `task lens role-probe-0 testing "Read actual focused policy observations"`. `bridge/task_roles.rs` has the same separate per-command Cargo transport and 4500 ms aggregate allowance. The exact coverage test is already registered in the existing single-thread `source-cli-probes` group. A registration-only change cannot repair this observed path. The lost three-helper candidate would not by itself establish a repair for this fourth helper.

### One pre-spawn Windows filesystem failure

`expert_memory::status_and_role_navigation_expose_canonical_binding_ids` fails at `tests/support/cli.rs:16:39`: `NamedTempFile::new().unwrap()` receives Windows error 5, `PermissionDenied`, for `%LOCALAPPDATA%\Temp\.tmp2H6GuA`. This is the first stdout capture-file allocation, before command construction/spawn. No binding-ID assertion or CLI operation was reached by that invocation.

Inspection of the locked tempfile 3.27.0 implementation shows named creation uses read/write `create_new(true)` with `FILE_ATTRIBUTE_TEMPORARY`; its retry helper retries `AlreadyExists` and `AddrInUse`, not `PermissionDenied`. The archive contains no failed-path metadata or OS trace establishing why Windows denied creation. A collision, deletion race, scanner or directory-policy cause would be speculation. Changing retries, disabling security controls, replacing the temp directory or altering expert assertions is not an evidence-supported repair at this point.

## Non-negotiable transport conditions

1. Keep the original 4500 ms aggregate request budget, including inventory, both locked Cargo verifications, artifact acquisition, every actual child, parsing and final validation. Keep acquisition lazy; reset, unknown/invalid actions and unused observations must not compile. Cold builds may honestly fail the same budget.
2. Obtain exact binary provenance from successful bounded `cargo build --locked --bin blabla --message-format=json --manifest-path ...`. Match canonical manifest, binary kind/name, `src/main.rs`, non-null executable and successful final record. Reject malformed/missing/conflicting records and failed builds. Never guess a target path or use an installed/overridden executable.
3. Make a request-owned executable copy; retain filename and mtime for the existing large-file writer stamp. Require SHA-256, length and mtime stability across copy and a second successful bounded Cargo verification selecting the same artifact. Check both source inputs and artifact identity before any copied CLI runs. Do not retain a cache across requests.
4. Compare deterministic path/byte inventories around acquisition, before later invocations and before success. Include all source bytes, embedded Markdown/Python, manifest/lock, toolchain files, root build-script presence, ancestor manifests and effective Cargo configurations. Decline reuse for linked/unreadable/external/computed inputs and nested conditional module paths that cannot be closed.
5. Preserve Cargo runtime context or choose the original `cargo run --locked --quiet --manifest-path ... --bin blabla -- ...` path before any lifecycle call. Unsupported configuration/includes, runners/environment, custom build/target/profile/compiler settings, parent workspaces, root build scripts, non-registry dependencies, dynamic/native runtime links and build-script environment decline direct reuse. Respect Windows environment-key case semantics. Retain known inventory guards on fallback, disclose opaque boundaries, never replay an operation, and keep the remaining deadline.
6. Reuse the existing private ProcessTree implementation through a narrowly exposed bounded command helper. Own child and capture files immediately after spawn. Cover attach/read/metadata/wait errors, timeout, output overflow, success-with-descendants and unwind. Windows keeps suspended-start Job Object attachment; Unix keeps process groups. Foreground error cleanup stays bounded and an exceptional reaper retains ownership rather than leaking it.
7. Keep 2 MiB combined stdout/stderr per child, including Cargo, with bounded final reads before parsing. Preserve original exits, text mode and non-JSON failure classification. Final source/deadline checks must refuse success after drift/expiry. Preserve real fixture transitions, byte comparisons, isolation and the existing five-second AppSession assertions. Transport failure does not imply prior fixture effects were rolled back.

No source comments/docstrings, dependency additions, contract changes, deadline increases, test exclusions, weakened assertions, global serialization or publication are proposed.

## Minimal prospective work sequence

### 1. Reconstruct the bounded transport as new implementation

Proposed write scope: new `bridge/source_cli.rs`, new `src/runtime/command.rs`, registrations in `src/runtime/mod.rs` and `bridge/structure_adapter.rs`, and new `tests/source_cli_transport.rs`. Existing ProcessTree is reused, not duplicated. The orchestrator must explicitly approve the internal Cargo-selected artifact disposition again before implementation; agent-facing AGENTS commands remain source Cargo.

- [ ] Record a fresh failing transport assertion before implementing the shared command/request types. Recreate tests as new work; historical red/green receipts cannot satisfy this step.
- [ ] Implement `command::run(&mut Command, Instant, usize) -> Result<Output, String>` and request `new`, `invoke` and `finish` operations under all seven conditions above.
- [ ] Exercise exact exits/streams, no-spawn expiry, output overflow, descendant cleanup on success/error, exact/malformed/failed Cargo provenance, artifact replacement with equal size/mtime, owned-copy cleanup and writer-stamp identity, embedded/source drift before another child and final success, unsupported configuration/runtime fallback, and Windows key semantics. Include actual Cargo-built fixtures rather than only parsed synthetic records.

### 2. Integrate all four observed bridge families

Proposed additional scope: `bridge/goal_delivery.rs`, `bridge/bounded_results.rs`, `bridge/ready_receipts.rs`, `bridge/task_roles.rs`; registration-only additions to the five directly importing integration tests (`batched_delivery_bindings`, `goal_delivery_bindings`, `bounded_result_bridge`, `ready_receipt_bindings`, `task_role_bridge`); and only the new suite's registration in `.config/nextest.toml`.

- [ ] Replace only per-operation Cargo dispatch with one request object, including task-role configuration/open paths and their final guard. Preserve the actual task operations, refusal classifications and all current assertions.
- [ ] Run transport guards and all four families, including real adapter and composition paths. Explicitly run `coverage::reordered_composed_contract_preserves_targeted_witness`; the former six-suite matrix alone misses that newly observed failure.
- [ ] Build the adapter, run the original six named suites plus `task_role_bridge`, run the exact reordered coverage witness, then strict all-target clippy and formatting. The orchestrator should declare those exact commands and inputs in the new actual assignment. Any concrete failure is read and retained before correction; only a fresh complete passing result can support hand-back.

### 3. Diagnose the temporary-file denial independently

This is a separate bounded investigation, initially scoped to reading the exact Windows artifact and `tests/support/cli.rs`, the failing expert test, locked tempfile implementation and CI environment. A repair is not selected until there is discriminating evidence.

- [ ] Reproduce the exact expert test on Windows under ordinary and existing parallel execution when an authorized Windows run is available. Retain the first failure and complete environment/path context. Linux success cannot settle this failure.
- [ ] If the denial recurs, add narrowly scoped failure-only diagnostics for stdout/stderr capture phase, selected temporary directory and relevant metadata/native error without exposing secrets. Keep the original error and fail closed. Obtain explicit scope before changing the helper/workflow.
- [ ] Select one cause-specific correction only after reproduction or decisive metadata, first add its controlled failing regression, then retain the exact expert assertions and test error propagation. Do not treat a later green retry as proof of cause or repair.

### 4. Independent review and delivery

- [ ] One independent implementation review checks the accepted design, actual diff and source-specific evidence. Reviewers may run bounded missing negatives; they should reuse the completed matrix rather than repeat it wholesale.
- [ ] Orchestrator owns source publication, canonical project verification and fresh Ubuntu/Windows CI on the exact repair head. Inspect terminal logs, including the separate tempfile path. No delivery-complete claim precedes terminal success for the requested scope.

## What this assignment verifies

The declared `test -s reviews/windows-ci-recovery.md` checks only that this report exists and is nonempty. Artifact checksum, all twenty failure blocks and deciding source were inspected separately. This report does not execute a repair, establish Linux or Windows repair correctness, restore historical task state or decide canonical project completion.

## Exact newer published-head readback

At 19:42 UTC, the Windows artifact for CI run 39061816111 on published head 714037f7a55ea9726b0868e7a10a1e35b00a5cdd was downloaded and all fourteen complete failure blocks read. Artifact 12111578384, Windows job 117481155086, ZIP SHA-256 `42c5ee965d38b52517df75819dd93d42e2209981d776c88e29261a4c5f2d4c4c`; the checksum agrees with the connector digest. The original archive, extracted logs, cleaned full Rust log and failure blocks remain in `/workspace/shared/windows-ci-39061816111`.

1328 tests ran: 1314 passed, fourteen failed, two skipped. Every failed block contains the old source CLI combined time/output budget error; all other product-gate stages exited zero. Existing four transport families remain represented. A fifth family is newly exposed: coverage::composed_bridge::development_effort::tests::budget_read_preserves_real_close_refusal_and_restored_success fails at bridge/development_effort.rs:985, BudgetFixture::prepare(2, deadline), during task evidence one --run. Its old per-command Cargo transport is independent of the four-family candidate and now has a separate prospective task, repair-effort-cli-transport. The minimal follow-on is the same request-scoped shared transport in that one helper, module registration in its directly importing test, the exact failed witness and unchanged effort suites.

The earlier pre-spawn tempfile PermissionDenied does not recur on this published head. That observation neither identifies its OS cause nor proves a fix; the separate investigation remains conditional on recurrence or discriminating evidence. This newer CI run does not contain the uncommitted reconstructed transport. The candidate's first full local matrix separately passed all sixty tests in its seven suites but failed the reordered coverage witness with a request deadline error; failed evidence 101 is retained, and diagnosis is active. No implementation success is inferred from either published artifact.
