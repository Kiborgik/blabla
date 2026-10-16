# Explicit development effort accounting

Actual author: `gpt-6-astra` / high, 2026-10-16. Implements the prospective `development-effort` draft without promoting it or changing project verification. The implementation is limited to existing task records, explicit phase writes and derived read-only totals.

## Implemented boundary

`task phase NAME PHASE --worker WORKER --model MODEL` accepts development, verification, review, integration, blocked, stop and interrupt. The current-source CLI supplies the timestamp. A phase switch attests the preceding interval; blocked/interrupt require reasons. Same-phase/same-reason repetition is a byte-preserving no-op. Stop before switching tasks or becoming inactive. Interrupted time remains retained as unknown. No historical timestamps, implicit acceptance, task reopening or per-tool event stream is exposed.

One actual worker key may have only one pending interval in a project. A switch to another task refuses before task writes, so the existing single-task atomic replacement suffices; the worker explicitly stops first. Models are not worker identities. Current accepted/permitted models can start on ACCEPTED work; the current declared orchestrator may record integration on READY/CLOSED packets. A permitted original model may stop/interrupt its own interval after hand-back. This is model/worker attestation, not authentication. The owner explicitly retained the conservative
revocation boundary: a revoked model cannot finalize its pending interval and a different model
cannot impersonate it. Pending time remains visible/excluded and coverage incomplete. An owner-only
interruption route would require a separate explicit successor, not an inferred permission.

The phase command runs under the existing task-store lock. It reloads the actual project/process and all task records, validates authority and interval structure, prepares a detached edit, then rereads project/process and task context and rechecks authority before the existing writer-stamp and atomic replacement path. Private deterministic tests exercise this exact function with no-op and valid/ineligible context mutations. There is no public race hook, clock override or claim of globally atomic filesystem snapshots.

`task budget [--include-project PATH] [--since UNIX] [--until UNIX] [--json]` reads explicitly selected stores without creating a lock/store or updating records. It deduplicates canonical project paths and diagnoses missing/unreadable/malformed stores and same-worker overlap across projects. Cross-project writes have no distributed lock: stop before switching stores. Different workers' simultaneous intervals are legitimately summed.

The denominator is D+V+R+I; overhead is V+R+I. Exact integer comparison uses `5 * overhead <= active` in u128, so 80 development + 20 overhead is exactly 20%, while 79+20 exceeds the target. The displayed fraction is informational floating point. A reviewer running a check remains in review, counted once. External blocked time is separate; pending/unknown intervals never enter active totals. Zero denominator yields null. Invalid/corrupt/overlapping inputs set `totals_valid=false`, `observed_target=invalid`, and null fraction; any displayed subtotal then remains untrusted.

Coverage is always `partial` when intervals exist and `unknown` otherwise. This initial slice does not parse owner prose into a machine claim of complete historical coverage. Unknown gaps, excluded workers/projects and legacy records cannot establish whole-project compliance. A necessary budget exception uses the existing task note, naming the policy, concrete correctness/release reason, owner and next reduction action. No check, independent review, delivery residual, closure condition or publication permission is waived.

## Freshness and compatibility

The optional `Task.work_intervals` defaults empty and is omitted when empty. Legacy tasks load unchanged. No fields were added to RelevantRevision, Evidence, review target or claim records. Existing normalized revision functions ignore interval accounting, and challenge normalization explicitly clears it. The tests compare actual current check evidence, challenge currency, intent/reflection/review revisions and ordinary CLOSE behavior through real CLI operations.

Writer provenance retains the existing build/recovery guard; interval updates do not replace source claims, epoch, scope, review pin, result or state. Full-record final-reread guards elsewhere remain conservative, so a genuinely concurrent accounting write can still invalidate an in-progress inspection rather than silently changing its context. Old writers may omit unfamiliar optional metadata; build/schema protections are unchanged. This is not an audit guarantee against manual file edits or actor impersonation.

The CLI routing was temporarily uncompilable during the new module wiring. The private-symbol/JSON-return errors were corrected and a successful five-case current-source checkpoint was announced before deeper work. There is no installed/recovery-binary fallback. The final source routes both phase and budget coherently; budget bypasses mutation locking.

## Prospective evidence and corrections

The retained first harness run failed before reaching the proposed surface because it supplied unsupported `task open --model`. That is fixture error, not product RED. After correcting only that setup, the actual prospective run produced four missing `phase`/`budget` command failures and one existing refusal control. Log: `.blabla/scratch/implement-development-effort-budget/corrected-missing-surface-red.log`.

The expanded suite initially expected ordinary CLOSE to refuse in a current GREEN structure-only fixture; actual CLOSE correctly succeeded. The correction now creates genuine source drift before asserting byte-preserving refusal, restores the exact original input, then proves ordinary successful closure and owner accounting on that genuinely closed record. The separate synthetic closed-state metadata test stays explicitly labeled as synthetic. No existing closure expectation was weakened.

Focused coverage includes real phase/no-op/stop, exact arithmetic, separate waiting/pending/unknown time, worker overlap and interruption, deterministic backwards time, explicit cross-project aggregation/dedup, malformed stores and revoked/malformed process authority, 50-row display cap, integer overflow, post-close authority and actual evidence/challenge/review freshness. Private final-reread cases cover a positive no-op, changed valid assignment, still-permitted changed process and revoked model/replaced task epoch. Tests of duration arithmetic use explicitly synthetic stored intervals; they never claim those intervals are historical effort or successful evidence.

A final corruption-control inspection found that the new all-record reader initially trusted embedded task names. The real prospective `mismatched_record_filename_cannot_redirect_phase_writes` test failed with accepted exit0 for a conflicting name/filename pair. The reader now rejects that inconsistency before any phase write and marks budget coverage invalid. The actual RED remains in `record-identity-red.log`; the final focused suite includes this additional boundary.

## Finite resource sample

The sample test uses isolated synthetic 10/100/1,000-interval tasks and the real current test CLI. It verifies complete input retention, exact totals, capped views and byte-identical task records after reading. One local sample:

| Intervals | Compact interval JSON bytes | Complete task bytes | Budget JSON bytes | Whole read microseconds |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 1,422 | 2,773 | 2,589 | 5,296 |
| 100 | 14,383 | 21,674 | 10,513 | 6,012 |
| 1,000 | 145,784 | 212,475 | 10,517 | 5,501 |

Log: `.blabla/scratch/implement-development-effort-budget/finite-size-sample.log`. Times include test-CLI process startup and are non-gating local observations, not active worker effort, peak memory, source-Cargo startup cost or a speedup claim. Reads currently parse the selected task records and sort intervals; writes reread records for one stable context. There is no resource claim for arbitrarily large historical stores. Detail is capped at 50 rows but stored intervals and totals are not truncated. The phase response is compact and does not repeat the whole task/opening tree.

A separate read-only current-source Cargo sample over the actual root store read 47 task records / 7,629,730 bytes in 0.222457 seconds. Every task record stayed byte-identical. It correctly reported zero captured intervals and unknown coverage. Receipt: `.blabla/scratch/implement-development-effort-budget/root-read-sample.json`. This single local observation is not a phase-write or large-store latency guarantee.

## Remaining acceptance

Two recorded attempts of the owner-amended combined argv used `bash -lc`, which reset the configured PATH and exited 127 with `cargo: command not found` before either test process. Both failures remain preserved; they are environment/invocation evidence, not behavioral RED or successful checks. The owner was asked to preserve the two test commands and fix only shell environment handling.

The owner-amended declared check is the focused integration suite followed by `cargo test --locked --bin blabla effort::tests`; final actual receipt is retained on the task. Broader unrelated suites, the canonical project gate, draft promotion and publication remain owner decisions. The feature measures prospective attested intervals only: existing development-time coverage and whether the owner's combined workload is within 20% remain unknown until explicitly captured.
