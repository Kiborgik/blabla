# Bind bounded-result decisions to the real CLI

Author: `gpt-6-astra` (high), report-only task `design-bounded-result-bindings`.

## Recommendation

Add one isolated `bridge/bounded_results.rs` fixture, dispatched and observed by
`bridge/structure_adapter.rs`. Invoke the current source CLI for the actual close
decision. Do not extend `bridge/assignment.rs`'s authored GREEN environment into a
second bounded-acceptance implementation. Keep the new contract draft until its
positive and refusal witnesses run and the contract issues below are resolved.

The source implementation remains frozen. This report authorizes no implementation,
registration, promotion, dependency exclusion or publication.

## Inspected seams and concrete contract issues

- `src/cli/task/bounded.rs`: private `inspect` and `record_result` implement the
  actual two-pass decision. Production `close` and the test-only checkpoint wrapper
  call the same final `record_result`. The callback is unavailable in normal builds.
- `src/cli/task.rs`: ordinary close retains its original grounded-challenge policy;
  task show exposes the persisted basis and current recursive review status.
- `bridge/assignment.rs::report` supplies `CompletionState::Green`. Its in-memory
  task operations exercise useful assignment rules but cannot establish real
  project-staleness eligibility or status-record preservation.
- `bridge/expert.rs` already isolates a real temporary project and calls real
  library functions. Follow that isolation pattern, not its authored evidence
  construction: this fixture needs actual focused checks and canonical finish.
- The adapter currently dispatches action names without forwarding arguments.
  `bounded_result_fixture(kind: int)` therefore needs explicit argument extraction
  and validation. Unrelated bridge dispatch and observations stay unchanged.

One contract correction is now owner-applied; positive witnesses still need authoring:

1. The initial `bounded-acceptance-does-not-complete-the-project` assertion
   unconditionally required completion to be false. The owner has now guarded it:
   `not after.bounded_accepted or not after.bounded_project_completion_allowed`.
   This preserves genuine GREEN after a refused bounded request. Add explicit
   before/after completion preservation separately if desired.
2. The existing implications pass if every close is refused. Add an actual
   `result_task_ready` observation and positive acceptance expectations. For bounded
   acceptance, the antecedent uses READY plus the existing observed owner, reason,
   qualified-history, drift, live-structure, other-blocker and current-input facts.
   For ordinary acceptance, use READY, current project verification and no other
   blockers. These are normative contract expectations, not a new implementation
   of the decision. A named zero-argument positive fixture for each mode makes
   these cases reachable without depending on opaque integer sampling.

Do not change seed, action counts or verification limits to compensate for a
missing positive setup.

## Smallest real execution boundary

The policy is private CLI code, not a library API. Prefer a subprocess invocation
from the bridge rather than exporting policy internals or including the whole CLI
module in the example:

```
cargo run --locked --quiet --manifest-path <source Cargo.toml> --bin blabla -- \
  --project <isolated fixture> --json task close work --bounded \
  --reason <fixture reason> --model <fixture model>
```

Ordinary close omits `--bounded` and `--reason`. Use argv, never a shell string.
The source Cargo manifest is derived from `CARGO_MANIFEST_DIR`; the fixture path
is explicit. Do not discover an installed executable or silently trust a binary
under `target/`. The inner fixture's canonical adapter is a tiny independent
JSON-line counter, never the root bridge, so its finish cannot recursively launch
this probe.

Preparation uses genuine CLI open/accept/evidence/challenge/ready and finish in a
TempDir, following the already working bounded CLI fixtures. Models such as
`fixture-owner` and `fixture-worker` are explicitly synthetic process-policy
attestations. They do not claim that those models actually reasoned about a task.

Each fixture action prepares one world. Each close action operates on exactly the
world last observed; it must not silently rebuild a more convenient fixture.
Reset replaces only this fixture. Repeated close observes the real terminal refusal.
Other bridge actions leave its files and observations untouched, and its actions
leave the existing assignment, lifecycle, expert and other fixtures untouched.

Treat exit 2 with structured category `task` as a decision refusal. Missing CLI
surface, invocation errors, failed setup, malformed output, unexpected exit codes
and process launch failures are adapter failures, not successful refusal witnesses.
Bound process lifetime and output collection so a stuck Cargo/check process cannot
hang the bridge. Measure the actual cold/prepared request cost before promotion:
root currently allows 5,000 ms per response. Nested Cargo startup is a practical
risk, not a measured performance claim. Do not increase that limit automatically.
If this route cannot fit, return to the owner for a small shared-core refactor;
do not copy the acceptance predicate as a faster fallback.

## Observation mapping

All fields come from the actual request, recorded bytes or existing status/task
machinery, never from `kind == expected_success` and never from acceptance itself.

| Field | Inspectable source |
| --- | --- |
| `bounded_accepted`, `ordinary_close_accepted` | Last matching real CLI invocation's exit/result and observed persisted terminal state. Reset per action; invocation errors are not refusals. |
| `bounded_owner_attested` | Requested model against the fixture's parsed declared orchestrator model policy. Preserve the distinction between attestation and authentication. |
| `bounded_reason_present` | Actual requested reason after whitespace trimming. |
| `bounded_prior_canonical_green` | Captured latest genuine canonical finish completion, paired with the exact status bytes/run ID it wrote. A later real RED finish replaces that history. |
| `bounded_implementation_only_drift` | Existing current status `recorded.stale` equals only `implementation`, with canonical status retained. |
| `bounded_live_structure_green` | Current actual status structure result. |
| `bounded_other_blockers_clear` | Actual challenge output has no grounded class other than the qualified verification class and the existing withdrawal-residue exception. No `assignment_blockers()` shortcut. |
| `result_task_ready` | Actual task record state is READY. This is separate from revision freshness after closure. |
| `bounded_task_revision_current` | Existing tracked readiness/challenge functions on the actual task/tree, plus actual task-show recursive `review_current` when reviewing. Closed historical state alone is not current credit. |
| `bounded_verification_eligibility_current` | The captured verification identity/record/run marker and relevant status observations remain the same around the close call; distinguish absent from unreadable bytes. See temporal limit below. |
| `bounded_basis_recorded` | Persisted `ResultBasis::Bounded` matches this request's reason, stale acceptance state, prior run/fingerprint and relevant revision. Compare the real fields, not mere presence. |
| `bounded_project_record_unchanged` | Exact optional status bytes immediately before versus after this close invocation. Never compare with a different prepared fixture. |
| `bounded_project_completion_allowed`, `project_verification_current` | Actual current status completion and canonical freshness; retain current GREEN after a refused bounded attempt. |

Capture the verification observations before the invocation and compare afterward;
`observe` does not run close, finish or silently refresh evidence. Persist no new
receipt format. Keep any capture metadata private to the disposable probe.

The sequential bridge can witness current inputs and unchanged records around an
actual decision. It cannot independently prove the internal final reread occurred.
The existing 16 private checkpoint tests provide the deterministic interleaving
counterexamples. A bridge result must not describe those races as newly exercised.
If `recording-rechecks-task-and-verification-eligibility` is intended to require a
runtime interleaving witness specifically, keep that identity draft/separate until
a faithful shared test binding exists; do not fill its fields with constants or
expose the test callback as a normal executable hook.

## Finite fixture set and prospective checks

Start with these prepared cases, reusing existing CLI setup operations:

- Current READY task, actual overall GREEN finish, then known concurrent report
  drift: bounded succeeds; ordinary refuses; status remains stale byte-for-byte.
- Current READY task and fresh overall GREEN: ordinary succeeds; bounded refuses
  without changing the GREEN completion result.
- Same stale setup with a changed declared task input: real evidence/challenge
  freshness refuses bounded close.
- Same setup with an unconfirmed owner amendment during a worker carry: READY can
  exist, but both close modes retain the carry-confirmation obligation.
- Latest actual finish behavior RED, then repaired helper and concurrent drift:
  an older earlier GREEN must not qualify.
- Latest actual finish structure RED with behavior GREEN, then repaired structure
  and drift: overall prior GREEN is still absent.
- Valid stale setup with wrong requested owner model or blank reason: two explicit
  refusal cases, with all saved task/status bytes retained.
- Changed profile after GREEN: mixed staleness refuses bounded close.

Additional malformed-record cases are already covered by the focused CLI suite;
they need not inflate the first bridge binding. Repeat actions and reset are tested
for deterministic observations, with two-way isolation from existing bridge probes.

Prospective counterexamples before promotion:

1. No dispatch binding: fail as unknown action, never count as refusal coverage.
2. Refuse-all replacement: both named positive witnesses must fail.
3. Admit the prior-RED or unconfirmed-carry fixture: the history/blocker rule fails.
4. Successful close without basis, or a basis with the wrong prior run/reason:
   the persisted-basis rule fails.
5. Rewrite status bytes during either acceptance or refusal: preservation fails.
6. Refresh status to GREEN during bounded acceptance: noncompletion/preservation
   fails; genuine current GREEN in the ordinary fixture remains permitted.
7. Remove the final reread: the existing private checkpoint suite must fail. The
   sequential bridge alone is not sufficient evidence for this mutation.

## Evidence and hand-back limits

The declared `cargo test --locked --test expert_task_goal` is an existing baseline
for task/goal packet behavior. It proves none of the proposed new bridge behavior.
The frozen implementation's 212-test receipt is separate author evidence, including
35 bounded CLI and 16 private checkpoint cases; this report does not rerun or
relabel them as binding coverage. Next scope needs the new bridge module, adapter
argument/dispatch merge and focused bridge tests. Any contract amendments, shared
core extraction or gate schedule change remain explicit owner decisions.
