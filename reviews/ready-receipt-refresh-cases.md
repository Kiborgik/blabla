# Prospective READY receipt-refresh cases

Author: `gpt-6-astra` (high), 2026-10-16; `specify-ready-receipt-refresh`.
The first phase below was tests-only. Production scope was explicitly widened after
independent design review. `contracts/ready-receipts.bla` remains owner-authored draft.

## Genuine first RED

`tests/ready_receipt_refresh.rs` constructs a temporary project through the real
CLI, executes its declared Python source check, records all opted-in claims and
required lens, challenges and reaches READY. Its first explicit disposition
`--refresh-ready` call then fails at the actual missing option: exit 2 rather than
required success. The complete log is retained as
`.blabla/scratch/specify-ready-receipt-refresh/evidence-1-2-1792166420891859708.log`.
It is a missing-surface RED, not evidence that any eligibility policy executed.

The frozen pre-implementation suite contained 25 tests. Two existing-behavior controls pass before
implementation: ordinary READY receipt writes still refuse, normal reacceptance
increments epoch/requires another actual check, and target closure alone preserves
review currency. Those new-surface cases were RED before implementation.
Refusal assertions require a structured task-policy error, so a missing-option
parser error cannot make an adversarial case look implemented.

An intermediate 18-case run exposed two fixture mistakes: structure-only finish
creates no behavioral status record. The fixture now runs a two-step actual
canonical counter campaign through Python JSONL, creating its own genuine GREEN
record. No successful check/result/status is authored by the test. The original
log (`evidence-2-2-1792166580467100696.log`) remains preserved. The corrected run and
later expanded runs reach the missing-option boundary; their full logs are read.

## Exact boundaries encoded

- Positive disposition and reflection calls preserve the complete task JSON except
  the explicitly supplied receipt and cleared challenge, and preserve every other
  file/directory byte. The real check increments a counter under `.blabla`, so an
  unexpected rerun is observable. State, acceptance/model/epoch, evidence history,
  scope, findings, target and project status cannot be silently changed.
- A resolved finding reproduces stale dispositions/reflection while evidence stays
  valid. Refresh all manual claims, then require a new challenge before ordinary
  owner close. A single disposition does not confirm other identities or reflection.
- READY-only, same-model, still-permitted-model and valid process requirements;
  accepted/blocked/closed/withdrawn/open and non-opted legacy task refusals.
- Changed source, added directory child, absent/nonfile check input, changed argv
  or input selection, and explicit concurrent input still refuse with exact
  before/after tree equality. Wrong model, revoked model and malformed/missing
  registered process cannot become eligible.
- Actual review target source/epoch/claim drift, nested target rework and
  missing/corrupt/withdrawn targets refuse without repinning. A separate baseline
  closure-only control proves closure is already harmless; its positive refresh
  counterpart must preserve the captured target.
- Blank/invalid/unknown manual claims and incomplete successor reflection refuse.
  No receipt refresh opts a task into new obligations or invents semantic agreement.
- Unresolved findings, owner records awaiting carry confirmation, changed consulted
  knowledge, unpicked owner questions and global verification drift survive manual
  receipt refresh and continue blocking closure.
- One explicitly corrupted-state case starts from real CLI records, executes a
  genuinely failing check (exit 17), then changes only its persisted state to READY;
  the other deletes the evidence array. These are deliberate invalid-record
  fixtures, not legitimate lifecycle transitions or fabricated success. A READY
  string must never replace missing or failed evidence eligibility.

Looped subcases are prospective: a current missing-option failure stops that test
before later subcases. Their assertions are present but their post-implementation
behavior was not proven by that RED. In particular that RED did not reach the positive refreshes
and their later close-blocker assertions. No test uses sleeps to manufacture
receipt time differences; target claim drift appends a real new disposition.

## Prospective acceptance boundary

The owner must authorize the production slice and its exact policy. Preserve
ordinary accept/close, the current revision/evidence rules and actual model/lens
checks. Implementations must execute the same final eligibility and revision
recheck before persistence. A private deterministic no-op/mutation callback in
module tests can cover task/source/role/recursive-target drift between initial
inspection and write; this tests-only slice exposes no public bypass, environment
hook or timing-flaky race and does not claim that race obligation is already proven.

The declared check is exactly `cargo test --locked --test ready_receipt_refresh`.
A RED prospective packet is not a READY implementation and cannot honestly satisfy
normal successful-evidence hand-back. Preserve its actual failing receipt and ask
the owner for the next authorized implementation step; do not relabel it GREEN,
change the check to compilation-only or weaken the assertions to make it close.


## Authorized implementation, 2026-10-16

The explicit flag now routes both claims through a private inspection/recording
path. Each pass reloads the actual manifest and Project, registered process,
task, tracked evidence inputs and recursive review targets. Before writing, the
second pass requires eligibility again and compares the full task record,
claim-relevant revision, observed process authority and recursive review revisions.
A changed but still-eligible note, claim or intent context also refuses instead of
overwriting concurrent state. No public race hook, schema or revision-hash change
was added. This detects observed changes; it does not promise atomic isolation
against arbitrary filesystem writers.

Ordinary ACCEPTED recorders and the explicit READY recorders share payload
validation. Only the supplied claim is recorded; no semantic claim is inferred.
The owner approved two existing bookkeeping effects: the current writer's build
stamp and monotonically adding identities from the validated observed revision.
No identity is removed or automatically confirmed. The new identity test proves
that an observed unclaimed obligation remains missing even after its declaration
is removed. The cross-build test changes only historical writer metadata on a
real successful fixture; it does not manufacture evidence or a verification result.

The first implemented run, `/tmp/ready-first-green.log`, had 23/25 pass. Both
failures had no assignment blocker but could not obtain a fresh challenge:
existing challenge recording only supported ACCEPTED, while refresh correctly
cleared the old receipt. The owner explicitly authorized READY re-challenge through
the same evidence and blocker evaluation. The next run,
`/tmp/ready-with-challenge.log`, passed 27/27, including a cross-build metadata case
and positive/stale-source/stale-target/unresolved-finding re-challenge controls.
The current integration suite adds the remembered-identity case for 28 tests.
The original missing-option RED receipts remain unchanged.

Private deterministic module tests cover both claim types: no-op success;
epoch/state/model changes; valid concurrent note and claim writes; missing,
malformed, revoked and valid-but-changed process authority; process re-registration;
valid goal identity changes; source deletion/change/new directory children; check
selection changes; missing or deliberately corrupt latest evidence; direct and
recursive target changes and missing/corrupt/withdrawn target records. Positive
controls retain closure-only target metadata and unrelated global status changes.
The private closure/evidence mutations are explicitly record-corruption or metadata
fixtures; the integration suite separately executes real closure and a real failing
check. Every private initial eligibility comes from actual source-check execution.
The callback is test-only and calls the same final recording path as production.

`/tmp/ready-races-first.log` reports 16/16 private tests passing. This is author
execution evidence, not independent acceptance. The deciding combined check is now:

```sh
cargo test --locked --bin blabla --test ready_receipt_refresh --test intent_disposition --test goal_reflection
```

The final task evidence binds that combined command to the current source. Default
close, findings, owner carry confirmation, lenses, decisions and project verification
remain authoritative. No receipt refresh or re-challenge creates completion.


## Independent retention finding, 2026-10-16 16:29 UTC

Independent review found that disposition refresh retained newly observed identities,
but reflection refresh did not. The owner confirmed that the approved monotonic
bookkeeping applies to either receipt kind. The symmetric real-CLI test failed
before the repair at the absent `policy::new-obligation` retained identity:
`/tmp/ready-reflection-retention-red.log`, one test, exit 101. Existing successful
104-test evidence remains preserved; it did not cover this asymmetric case.

The narrow correction extends observed identities only for the READY reflection
path after the shared payload validation. Ordinary ACCEPTED reflection behavior is
unchanged. The new regression verifies that the unclaimed identity stays missing
after its declaration is removed, and that only a later explicit disposition can
account for it. Evidence, epoch, scope, target and every existing disposition remain
unchanged. The current combined suite has 29 receipt-refresh CLI cases; no revision
hash, closure rule or automatic claim was introduced by this correction.

## Integration regression, 2026-10-16 16:49 UTC

The frozen-root full run retained in `/workspace/shared/tooling-accepted-tests.log`
failed two existing bounded bridge cases with `refused close changed the task record`.
Inspection showed ordinary CLOSE itself made no refusal write. The bridge reads the
task before invoking challenge for its diagnostics; the newly writable READY
challenge replaced an already-current receipt timestamp, so the following snapshot
attributed that administrative mutation to CLOSE.

The correction retains the original read-only READY challenge behavior when the
existing receipt is current, current tracked evidence is supported and the freshly
evaluated assignment blockers are clear. A missing/stale receipt still takes the
approved explicit recording path. No closure policy, bridge assertion or timestamp
comparison was relaxed.

A deterministic new CLI case changes only the genuine receipt's timestamp metadata
to an old value, then checks complete tree-byte equality across repeated challenge
and refused ordinary close. Its unrelated report is owned by a real concurrent task.
The first fixture omitted that attribution and failed for that setup error
(`/tmp/ready-rechallenge-idempotence-red.log`); the corrected prospective case failed
at the actual challenge write (`/tmp/ready-rechallenge-idempotence-corrected-red.log`).
It passes after repair (`/tmp/ready-rechallenge-idempotence-green.log`). All nine
unchanged bounded bridge tests pass in `/tmp/ready-bounded-integration-green.log`,
including both original failures. The existing stale source, target and finding
controls continue exercising actual blocker evaluation. The declared combined check
now contains 30 receipt-refresh CLI cases.

## Statement-amendment integration boundary, 2026-10-16 17:23 UTC

The next frozen-root full suite reached the unchanged
`task_workflow::an_amended_statement_voids_a_ready_tasks_challenge_receipt` and
failed: diagnostic challenge returned assignment clear after an owner statement
amendment. The original result remains in
`/workspace/shared/tooling-accepted-tests-final.log`; the current-source single-test
RED is `/tmp/ready-statement-regression-red.log`.

Statement amendment retains an existing challenge whose fingerprint becomes stale.
The overly broad READY continuation replaced that stale receipt when other checks
were clear. Explicit receipt refresh instead clears the challenge. The correction
therefore preserves read-only inspection of a current READY challenge and permits
READY recording only when the challenge is absent on an opted-in receipt task.
An existing stale receipt is left intact and unaccepted; legacy tasks do not acquire
the new continuation. The original statement test and all its assertions are unchanged.

Two additional prospective controls demonstrate exact boundaries before repair:
an opted-in task's stale statement challenge was cleared by diagnostic inspection
(`/tmp/ready-opted-statement-red.log`), and a legacy task whose identical check was
amended could incorrectly recreate its absent challenge
(`/tmp/ready-legacy-challenge-red.log`). Both require complete byte preservation
when inspection cannot renew. The new cases live in the existing scoped receipt
suite; no `tests/task_workflow.rs` edits, schema or revision-hash changes were needed.
This distinguishes bare diagnostic re-challenge from explicit manual receipt work;
it does not claim an additional immutable acceptance-time assignment snapshot.
