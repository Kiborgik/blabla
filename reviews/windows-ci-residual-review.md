# Windows CI residual: independent review

2026-10-17, actual gpt-6-astra/xhigh. Target `repair-windows-ci-residual`, frozen READY epoch 1. I authored none of these Rust or fixture changes. **No blocking source defect found in this bounded correction.** The corrected published Windows gate remains an outstanding delivery outcome.

## Actual failure boundary

I inspected the retained Windows clippy and five failed-test sections from [run 38995251014](https://github.com/Kiborgik/blabla/actions/runs/38995251014), head `07ed2b997860c34ad57b8cb39f013270fca25940`, job 117286261953. Clippy identifies the Windows-only unnecessary return. Four batch paths and the singular resolution setup exhaust the existing 4,500 ms source-CLI request allowance; observed batch setups reach 4,449 and 4,407 ms. Their transport errors remain errors, not invented lifecycle refusals. Ubuntu's separately retained success does not settle Windows.

## Source verdict

I read every hunk of `/tmp/windows-residual-final.diff`, compared the three changed source/test files with their preserved pre-edit copies, and inspected the surrounding preparation, qualification, execution and response paths. `tests/goal_delivery_bindings.rs` is unchanged.

- The cfg correction preserves the Unix child harness's early return. With the following Unix-only block absent on Windows, the same assertions simply reach the function end. There is no warning suppression or removed assertion.
- `checked` still invokes the real current-source `task evidence --run`, requires its transport exit to succeed, deserializes the returned `Task`, and requires a latest evidence child exit of zero. `src/cli/task.rs` applies the observed evidence to the reloaded record and stores/returns that record. Removing the subsequent task-show call therefore retains the relevant authority; malformed returned data, absent evidence and a failed child still fail setup.
- Ordinary batch preparation removes exactly seven CLI invocations: four for an unused singular reviewer and three redundant post-evidence shows. The reaccepted-source branch removes one additional show. Both real sources still pass acceptance, actual checks, claims and READY; the explicitly assigned batch reviewer still receives its real check and independent verdict. The ordinary singular fixture continues to create its reviewer. No task record is fabricated to replace these lifecycle transitions.
- The review-qualification shortcut returns false only after reading an actual non-ACCEPTED record, which already fails the original conjunction. ACCEPTED records still use the current CLI view and readiness/model/target predicates. Refusal, ordinary/bounded closure and exact-origin resolution branches remain covered by the unchanged matrix.
- Component-wise slash keys repair the Windows comparison gap while preserving file bytes. The new test requires the actual nested key to contain bytes `[0,255,13,10]`, changes one byte, and detects the difference through that same key. This is a file-content byte control, not a claim about arbitrary non-UTF8 filenames. Earlier slash-literal lookups could compare two absent entries on Windows; that historical preservation evidence must not be credited retroactively.

The 4,500 ms deadline, 2 MiB output limit, current-source Cargo execution, nextest resource grouping, constructor/reset behavior and existing assertions remain intact. This patch adds no global serialization or larger budget.

## Deciding evidence and limits

The genuine pre-correction batch test reached `[batch, review, secondary, work]` instead of the required three actual task names. The same reached assertion passes after the unused reviewer is removed. The additional observation lists actual task records and also requires the selected review to qualify; it is not a synthetic success flag.

I read the complete final author log `.blabla/scratch/repair-windows-ci-residual/evidence-1-7-1792206108306237440.log`: all-target strict clippy, 21 focused cases and one exact composed witness pass. Its SHA-256 is `63543e2e6aac5eaaab2c4a82f2798ed2bbcde9bbaf0dc532482898fcc2a4161e`. Measured local batch setups are 1,133–1,542 ms and actions 159–197 ms. These bounded Linux observations do not guarantee Windows timing or execution.

This review runs only the declared report/author-log existence receipt, reusing the source-specific tests rather than repeating them. The owner retains publication and terminal verification at the corrected commit. Any remaining remote Windows failure stays open; the previous CI review remains historical evidence for its separate repair.
