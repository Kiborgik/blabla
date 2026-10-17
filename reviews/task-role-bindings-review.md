# Independent review: task-role contract bindings

Reviewer: gpt-6-astra, 2026-10-16 15:52 UTC. Task: `review-role-contract-bindings`. Target: `bind-task-role-contract`.

## Verdict

No blocking mismatch found in the bounded bridge. It supports the owner-authored draft's configured-role refusal, registered-role positive result, explicit bootstrap and retained policy observations using actual current-source CLI operations. This accepts the source binding and focused evidence for the next standalone evaluation. It does not promote the draft, declare project completion or authorize publication.

## Source and decision boundary

Read `bridge/task_roles.rs`, its integration in `bridge/structure_adapter.rs`, all of `tests/task_role_bridge.rs`, `contracts/task-role-resolution.bla`, the author's report, and the relevant role guard, open ordering and memory parser. `validate_open_role` precedes the task-opening mutation path. The earlier source guard and its review remain separate from this bridge review.

The fixture's configuration flags come from the actual registered manifest and memory parser/validator. The integer chooses bounded setup data; it does not decide whether opening succeeded. The nine configurations include declared/unknown roles, unregistered conventional files, valid empty registered process, missing file, syntax failure, duplicate roles, non-UTF-8 and a directory in place of the file. The latter accurately has the existing parser's `missing` classification, rather than a fabricated special category.

Each real open uses `cargo run --locked --quiet --manifest-path <current source>/Cargo.toml --bin blabla`. Accepted results require exit zero, the expected OPEN role in JSON and a matching persisted record. A refusal requires exit two and structured task-category output. Launch failures, unexpected exits, non-JSON output and bounded execution failures remain adapter errors. Unique task names and disjoint scopes prevent repeated fixture actions from accidentally testing duplicate-name or overlap rejection.

The no-write fact compares all directories and file bytes recursively under the isolated fixture, including task/lock-related files; it does not filter inconvenient paths. Configuration is parsed again after opening and compared with the captured fields. This establishes the specified stable-fixture refusal behavior, not an atomicity guarantee against an independent process changing configuration between production reads.

## Non-vacuous positives and policy meaning

`open_registered_role` explicitly prepares a registered positive fixture, then opens it. `open_bootstrap_role` similarly prepares the unregistered positive fixture. These are documented composite operations; they do not pretend the previous fixture already had those properties. `open_requested_role` preserves an existing fixture, with an explicit first-use default when uninitialized.

Registered policy retention is observed through real acceptance and challenge calls. An outside-model acceptance yields the expected model and missing-lens challenges. Reaccepting with the allowed fixture model and recording the required testing lens removes those two classes. Other incomplete-task blockers remain, so the probe does not claim READY. Fixture model strings are synthetic policy labels, not attestations of real agents.

The tests evaluate real before/after pairs against the actual draft and separately corrupt copies of those observations. They detect false initialization, accepting unknown/broken roles, writes on refusal, refusing registered/bootstrap positives and losing model/lens evidence. This is observation-level adversarial coverage; it is not a production mutation campaign. The standalone generator's coverage and final contract result remain to be obtained.

## Isolation and bounds

Construction and reset leave the role probe uninitialized. Untouched observation and legacy actions invoke no nested Cargo; a controlled sentinel verifies that boundary. Explicit probe use under the failing sentinel returns an adapter error, not a successful role refusal. Reset drops the temporary fixture, and two-way tests compare unrelated legacy/bounded observations before and after role actions.

Recognized calls validate positional arguments. Integer normalization handles both signed extremes without scaling work to magnitude. Malformed argument refusals preserve observation; unknown actions remain outside this module's dispatch. Real invocation failures retain initialized configuration but no claimed terminal decision.

Subprocesses share a 4,500 ms per-action deadline and a 2 MiB combined-output bound per invocation. Unix timeout/output failure kills the child process group. The real runtime test keeps its existing 5,000 ms request allowance. Cold compilation or contention can still fail explicitly. These local timings do not establish a universal latency or resource guarantee; no verification profile was relaxed.

## Exact evidence read

- Author final eight-test log: `.blabla/scratch/bind-task-role-contract/evidence-3-2-1792165294450575346.log`. Fully read: eight pass, 2.59 seconds, including actual runtime and isolation tests.
- Author genuine missing-binding RED: `.blabla/scratch/bind-task-role-contract/evidence-1-14-1792164683525387711.log`. Fully read: the actual adapter returned `unknown action: configured_role_fixture`; that error was not classified as a policy refusal.
- Independent declared check: `cargo test --locked --test task_role_bridge`. Full log `.blabla/scratch/review-role-contract-bindings/evidence-1-5-1792165915404072043.log`: eight pass, zero failures, 2.63 seconds. Recorded role calls were 170 ms requested, 665 ms registered, 123 ms bootstrap, below 1 ms setup and 607 ms subsequent requested. These are finite observations only.

No source implementation, contract, profile, publication setting or historical task was changed by this review. The useful next step is the owner's standalone evaluation of this unchanged binding under its actual contract and declared runtime limits.
