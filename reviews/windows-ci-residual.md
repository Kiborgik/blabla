# Windows CI residual repair

2026-10-17, current-source worker gpt-6-astra.

## Actual remote boundary

PR head `07ed2b997860c34ad57b8cb39f013270fca25940`, [run 38995251014](https://github.com/Kiborgik/blabla/actions/runs/38995251014): Ubuntu job 117286262061 succeeded with 1362 nextest cases; Windows job 117286261953 failed with 1319/1324 cases passing. Both retained two skipped cases. The previous documentation, contract-field and portable-path failures are absent from this run. Windows still fails clippy and five actual delivery-probe requests.

The Windows artifact is retained at `/tmp/ci-repaired-windows.zip`, extracted under `/tmp/ci-repaired-windows/gate`; complete job log is `/tmp/ci-repaired-windows-117286261953.log`. `ci-clippy.log` identifies `tests/development_effort_bindings.rs:344`, where the return becomes unnecessary when the following Unix-only harness is absent. `ci-rust-tests.log` records four batch setup failures and one singular resolution setup failure, all exhausting the unchanged 4500 ms request deadline. Actual batch setup samples reached 4449 and 4407 ms before later preparations failed. The failures were task show, evidence or delivery-review subprocesses, not semantic task refusals.

## Bounded correction

- Keep the Unix child-process early return; compile it only on Unix. The Windows branch naturally ends after the same assertions.
- Parse the authoritative Task returned by the real `task evidence --run` command, checking its latest child's exit code. Remove the redundant subsequent task-show subprocess. Successful evidence storage still cannot disguise a failed child or malformed Task.
- Prepare the batch's real primary source without creating an unused singular reviewer. Both actual READY sources, the explicitly assigned batch reviewer, evidence, independent verdicts and all lifecycle transitions remain real CLI operations. Ordinary batch preparation removes seven redundant Cargo invocations; the reaccepted-source preparation removes eight.
- An already non-ACCEPTED reviewer cannot qualify under the existing predicate. Return false after reading that actual record instead of launching a task-show subprocess whose result cannot qualify it. Accepted review currentness still uses the existing current CLI view.
- Normalize byte-tree keys by path components. File bytes remain untouched. The added native nested-key regression asserts the exact slash key, retains non-UTF8/CRLF bytes, changes one byte and proves the same-key comparison detects it.

The last item fixes a newly discovered assertion gap: on Windows, slash-literal lookups against backslash keys could compare two absent entries. Earlier Windows assertions therefore did not establish those individual source/closed-record preservation facts. This gap is recorded explicitly rather than credited retrospectively. The new test is cross-platform and the remote Windows execution remains required.

## Prospective and measured evidence

`/tmp/windows-residual-redundant-review-red.log` is a genuine pre-correction failure: actual CLI-created task names were `[batch, review, secondary, work]`, while the focused test requires only the two sources and their assigned reviewer. After removing the unused setup, `/tmp/windows-residual-redundant-review-green.log` passes the same assertion. Observed local test elapsed time changed from 1.67 s to 1.25 s; this is one bounded local sample, not a Windows performance guarantee. Task names are read from actual records through the probe observation.

The three existing focused binaries retain their positive, refused, repeated, isolated, reset and adversarial assertions. `/tmp/windows-residual-focused-development.log` records all 21 development cases passing (batch 6 in 20.47 s, effort 9 in 15.52 s, singular delivery 6 in 44.18 s). Batch fixture requests ranged from 1160 to 1716 ms, with observed actions 164–195 ms. Final declared evidence runs all-target strict clippy, those three binaries and the exact composed batch coverage witness. The authoritative receipt belongs to `repair-windows-ci-residual`.

The 4500 ms request allowance, 2 MiB output cap, current-source Cargo invocation, nextest resource group and full case assertions are unchanged. No task record is authored to manufacture lifecycle success. No timeout is converted to a task refusal. Constructor/reset behavior is unchanged.

## Remaining outcome

Local Linux checks cannot establish Windows scheduling or clippy success. Publication must be followed through a new remote run at the exact corrected commit until Ubuntu and Windows are terminal. The owner CI complaint remains open until that evidence exists. The earlier Ubuntu success is retained independently; no automatic rerun or broader exclusion is part of this repair.
