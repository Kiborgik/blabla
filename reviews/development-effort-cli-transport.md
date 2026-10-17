# Development-effort source CLI transport

17 October 2026. Prospective implementation author: gpt-6-astra/xhigh, actual accepted task `repair-effort-cli-transport`. This follows the four-family task's successful declared command and READY handback; it does not claim that root canonical verification or Windows CI is complete.

## Evidence and exact change

Windows run 39061816111 on published head 714037f7a55ea9726b0868e7a10a1e35b00a5cdd exposed the fifth helper at `bridge/development_effort.rs:985`, `BudgetFixture::prepare`, during real `task evidence one --run`. The verified artifact and complete failed block are described in `reviews/windows-ci-recovery.md`. That failure is the concrete motivating observation; no new test or artificial local failure was introduced.

The helper now shares one lazy `source_cli::Request` across the actual lifecycle operations of each recognized request. Its original 4500 ms aggregate allowance still includes source/artifact acquisition, both successful locked Cargo builds, every child and final validation. The old helper's temporary captures, repeated Cargo dispatch, platform-local stop function and five-millisecond polling loop are removed in favor of the reviewed shared completion-driven containment. The inherited 2 MiB output cap, exact provenance, copy/hash/mtime identity, conservative Cargo configuration fallback, real status/JSON interpretation and final source/deadline refusal remain.

Fixture setup, phase transitions, budget views, task evidence/ready/close operations, refusal classifications, byte comparisons and isolation assertions are unchanged. The internal exact witness only receives the shared deadline object; its assertions are intact. The directly importing integration test adds the two-line shared-module registration. No contract, dependency, timeout, test filter, source comment or docstring was added or weakened.

The patch was prepared in ignored scratch while the four-family matrix ran. Live files remained unchanged until this separate task was accepted. No shared transport or four-family source was edited by this follow-on.

## Verification

The task's existing declared command ran from 20:40:53 to 20:42:28 UTC and exited 0. Current adapter build passed; `development_effort` passed 17 cases in 0.78 seconds, `development_effort_bindings` passed 9 in 72.44 seconds, and `development_effort_composition` passed 2 in 6.06 seconds. The exact formerly failing coverage budget-close witness passed in 0.91 seconds. Strict all-target clippy and formatting passed in that same command. Its complete 67-line log was read and retained with terminal exit/start/finish markers under `.blabla/scratch/repair-effort-cli-transport/declared-check.*`. Both frozen source hashes still matched after completion. Real composed fixture/transition operations measured 587–819 ms locally under the unchanged allowance. This command does not repeat the long reordered composed witness or the earlier seven-suite transport matrix.

The completed four-family run retains all nineteen current transport guards and the 4096-action reordered witness, with successful all-target lint/format evidence. This follow-on does not reinterpret those results as Windows evidence. The full nextest stage's unchanged 1800-second aggregate allowance, exact-head Windows outcome and the independent historical pre-spawn tempfile denial remain release checks for the orchestrator.

The additional serialized effort binding/composition/exact-witness measurements total 79.41 seconds. Added to the earlier measured source-CLI subset, this is 1,396.20 seconds, leaving 403.80 seconds against the unchanged 1,800-second Rust-stage timeout before unmeasured remaining probes, compilation and platform overhead. This is a bounded local accounting observation, not a full-gate timing guarantee.
