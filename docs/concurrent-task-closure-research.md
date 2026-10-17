# Concurrent task closure: diagnosis and prospective boundary

Research by `gpt-6-astra` (high), 2026-10-16, under
`research-concurrent-task-closure`. Report only; no gate, fingerprint, contract,
task lifecycle implementation or publication change.

## Finding

The observed friction is a deliberate coupling between two different checks,
not a broken task fingerprint. A READY assignment can retain current evidence,
review target and challenge while an unrelated report changes the project-wide
implementation fingerprint. CLOSE then refuses that otherwise current result.
Waiting for another global finish leaves its scope occupied; if a real declared
input changes meanwhile, the still-open review correctly becomes stale too.

Keep the whole-tree project gate. Consider a separately explicit, owner-approved
**bounded-result closure** that releases a reviewed scope while recording that
integration verification is still pending. It must never claim that a changed
file is semantically unrelated merely because it is outside the task paths.
Default CLOSE should retain its present behavior until the owner deliberately
authors and accepts this new meaning.

## Existing evidence and exact control flow

The retained `/tmp/root-finish-1107.log` records GREEN: 321 structure rules,
177 behavior rules, 343 obligations and 4,096 actions. The subsequent recorded
incident had current focused evidence/dispositions but a project implementation
drift challenge. Its historical aggregate alone cannot identify the first changed
path. [The earlier nine-case diagnosis](../reviews/nested-verification-drift.md)
and `experiments/nested_verification_probe.py` reproduce the mechanism in isolated
fixtures: a disjoint child edit preserves assignment CLEAR, makes status STALE
and refuses CLOSE; restoring just those bytes permits CLOSE without another task
check. That existing probe also demonstrates an implicit child import whose
change genuinely fails the parent's behavior. This task reuses that evidence;
it did not rerun the probe or a canonical finish.

Current source makes the split explicit:

1. `src/project/task.rs::evidence_inputs` uses declared check inputs (scope when
   absent), always adding deliverables. `readiness` requires the latest matching
   command/acceptance-epoch evidence to pass and match those current digests.
   Directory digests include their children; a broad declared `core` input is a
   real dependency, even when the reviewer believes one child edit irrelevant.
2. `challenge_fingerprint` hashes the normalized task record and paths selected
   by `receipt_covers`. Notes, state/closure metadata and concurrent attributions
   are deliberately normalized. Relevant source, evidence or a new finding still
   invalidates the receipt. Attribution and dependency are different: explicit
   inputs remain relevant in `RelevantRevision` even if attributed concurrent.
3. `src/project/task/revision.rs::relevant_revision` binds assignment fields,
   epoch, declared path digests and supplied identity fingerprints.
   `review_revision` also binds target dispositions/reflection and the review's
   own explicit inputs. `src/cli/task.rs::review_freshness` follows nested review
   targets, while `approval_current` requires a closed accepted result, current
   review/evidence and current challenge. Closing a review does not freeze its
   approval forever; later genuine input, role/policy or target rework must still
   remove current credit. Mere target CLOSED/result metadata is not itself part
   of `RelevantRevision`; do not blame closure alone without comparing records.
4. `src/project/mod.rs::fingerprint_observation` walks the nonignored project tree
   and command extras; `Project::contract_files` excludes separately identified
   contracts/manifest from that tree hash. A nested manifest does not stop it.
   `src/project/status.rs::evaluate` compares verifier, project identity, aggregate
   implementation and profile. The new per-input baseline diagnoses differences;
   it does not establish semantic dependency independence. Legacy baselines have
   no historical path explanation, and displayed deltas are capped at 50.
5. `src/skeptic.rs` always reports `verification-not-current` for a stale
   completion state. Its `OUTSIDE_THE_ASSIGNMENT` also contains `vacuous-rule`,
   `orchestrator-record-during-carry` and `withdrawal-residue`.
   `challenge` and `ready` use `report.assignment_blockers()`.
6. `src/cli/task.rs::close` instead counts every grounded challenge except
   `withdrawal-residue`, then calls `task::accept_result`. Thus current task
   evidence plus a current challenge cannot override project staleness. Replacing
   this count with `assignment_blockers()` would accidentally drop vacuity and
   unconfirmed owner-record checks too. That shortcut is unsafe.

`process.bla` assigns focused checks to workers and global integration/finish to
the orchestrator. `docs/agent-workflow.md` already distinguishes READY, result
acceptance and project completion, and says a closed task never replaces the
project gate. The implementation's additional CLOSE precondition is nevertheless
real and must be changed prospectively, not bypassed by a report.

## What the done concurrency goal actually proves

`goal::hand-backs-survive-concurrent-work` is owner-declared done, with three exact
expectations in `contracts/assignment.bla`: concurrent reconciliation preserves
a challenge receipt, a note preserves that receipt, and a closed concurrent task
still accounts for its change. They do not assert CLI result acceptance after
global implementation drift. `bridge/assignment.rs::report` supplies
`CompletionState::Green`; its `accept_the_result` action cannot expose this
non-GREEN CLI integration case. `tests/task_workflow.rs` has useful focused
receipt, review-rework and explicit-dependency regressions, but those are not a
proof of the broader goal prose either.

At inspection, exact goal coverage resolved all three references but reported
them unverified against current root state. Do not infer acceptance from the word
done, or silently change it. The owner should decide whether the goal needs a new
prospective expectation and renewed outcome review. This report changes neither.

## Smallest conservative proposal

An explicit `task close NAME --bounded --reason TEXT --model MODEL` is a proposed
surface, not an existing command. Reuse READY/CLOSED and the existing result,
closed-path attribution, challenge and relevant-revision machinery; no second
task framework or dependency inference engine is needed.

- Keep ordinary CLOSE unchanged. Require explicit owner selection and a nonempty
  reason. Validate the declared orchestrator role/model for this new operation;
  `--model` remains an attestation, not authentication. The current `close`
  implementation does not itself call `validate_orchestrator_model`, so do not
  describe existing CLI enforcement as stronger than the inspected source.
- First increment admits only a readable previously GREEN canonical record with
  **implementation-only** drift, unchanged contract identity/profile/verifier,
  and live GREEN structure. Refuse absent/unreadable records, prior RED/YELLOW,
  noncanonical/no-profile, interrupted or running verification, structural
  failures/errors and mixed staleness. Inspect typed underlying record status:
  a stale aggregate must not hide an older RED/YELLOW result.
- Preserve every existing close blocker except that one specifically eligible
  `verification-not-current`. In particular retain vacuity, all findings,
  confirmation, model policy, scope/attribution, tracked-input validity, exact
  current evidence, falsification, lenses, dispositions, reflection, unanswered
  questions and current recursive review target. Withdrawal residue keeps its
  existing treatment; nothing here reconciles it automatically.
- Compare the accepted relevant task/review revision immediately before recording
  the result; refuse observable input/record changes during the decision. Do not
  claim filesystem-wide transactional isolation. A future fixture must exercise
  this race, rather than assuming serial invocation proves it safe.
- Add one optional result-basis record, rather than reusing a generic success
  Boolean: bounded acceptance reason, observed project verification state/reason
  and identifying prior run/fingerprint. Missing field means legacy/default
  semantics. Text and JSON must say “bounded result accepted; project verification
  pending” and expose that basis beside current review approval. Reuse existing
  current project status for the live integration state; the historical receipt
  should not be rewritten when a later finish passes.
- Never write or refresh `.blabla/status.json`, suppress stale status, mark a goal
  done, change a rule verdict, or bless an implicit dependency. The global gate
  remains blocked until its actual canonical check passes. Bounded acceptance is
  only the owner's acceptance of the precisely checked task revision. If an
  undeclared runtime import breaks integration, a fresh finish must still fail.

This deliberately changes result-acceptance policy, not project verification.
The narrow admission condition avoids a general “force close” and solves the
observed post-GREEN report-write case. It will not eliminate all pauses: real
declared-input changes still require fresh work, and contract/profile changes
remain outside this first proposal. If the owner does not want that explicit
distinction, the current short finish-and-close write pause is the sound option.
File extensions, a child manifest, a worker's assertion, or a truncated drift list
are not safe alternative exemptions. No automatic “unrelated” classifier is
recommended.

## Prospective tests before implementation

Owner authors the new acceptance semantics first. Add CLI integration tests in
an isolated temporary project, alongside task/review regressions. The first RED
must show the real current refusal or missing option, not just a mocked Boolean.

1. Finish GREEN, make task/reviewer READY, then an attributed disjoint report
   edit: task evidence/challenge/target remain current; ordinary CLOSE still
   refuses. Explicit bounded CLOSE succeeds, records its basis and frees only
   that scope; status remains STALE/nonzero and its verification record bytes
   are unchanged. A later real finish determines completion normally.
2. Repeat with a genuinely failing implicit imported helper outside declared task
   inputs: bounded acceptance must not assert independence or change status;
   a fresh finish is RED. Add that helper as an explicit input and prove bounded
   CLOSE now refuses stale task/review evidence. Include concurrent attribution
   of the explicit input so attribution cannot erase the dependency.
3. Independently vary scope/deliverable/check/epoch, required memory, target
   dispositions/reflection, nested review target, missing/unreadable input, latest
   failed check, required falsification and a decision below its floor. Each
   retains its existing refusal, without partial closure or discarded history.
4. Unconfirmed owner records, unresolved findings, scope breach, unknown
   attribution and vacuous structural rules must still block. A worker-only or
   undeclared model cannot obtain the new owner acceptance. Test reason omission.
5. Refuse changed contracts/profile/verifier, live structural RED/ERROR, unreadable
   or absent canonical record, previous RED/YELLOW hidden beneath STALE,
   interrupted/running/noncanonical verification. A task cannot manufacture
   eligible history by adding a note, disposition or “concurrent” attribution.
6. Inject an input/target change between initial eligibility and final record
   write; refuse. After successful closure, later real source or policy changes
   leave the historical result CLOSED but make current approval false. Unrelated
   task notes should not renew or destroy evidence.
7. Read legacy result records unchanged. Text/JSON distinguish the acceptance
   basis without implying integration or goal completion. Exercise more than
   50 input deltas and unavailable historical baselines: display truncation must
   never become an acceptance authority or hide a required failure.

Implementation would require an owner-assigned slice covering the command schema,
task result schema/view, narrow closure decision and CLI tests, plus prospective
contract/bridge and workflow documentation owned by the orchestrator. Do not start
by editing the global fingerprint or reusing only assignment blockers.

## This task's verification

`cargo test --locked --lib project::tests::` passes the existing 20 baseline tests
for manifest loading, fingerprints, canonical status and completion. Those tests
preserve useful invariants; they neither implement nor prove the proposed bounded
closure semantics. The exact stored task log is the deciding regression receipt.
No new closure behavior, authorization system, dependency mapping, canonical run
or publication is claimed by this research.
