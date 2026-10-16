# Review hand-back freshness: observed cause and bounded proposal

Research by `gpt-6-astra` (high), 2026-10-16. Report-only task
`assess-review-handoff-freshness`; no implementation or policy change.

## Finding

The compact-host incident combines three different mechanisms. A finding
resolution legitimately changes the accountable task revision. Requiring ACCEPTED
for renewed dispositions/reflection then forces a new acceptance epoch and an
otherwise unnecessary repeat of unchanged tests. Broad declared directories also
create real source dependencies. Closing the target itself does **not** invalidate
its review revision; the observed stale target had already been reaccepted twice.

The smallest candidate is an explicit, same-model receipt-only refresh while
READY, retaining the existing acceptance epoch and genuinely current check.
Keep every claim manual, clear the challenge receipt, and require a new challenge
before owner acceptance. Do not automatically repin a review or normalize away
findings, source dependencies, intent changes or semantic claims.

## Exact retained compact-host evidence

Inspected the actual example task records, the unchanged independent report
`examples/agentic-mmo/reviews/compact-observation-transports.md`, and current CLI
`task show` output at about 15:49 UTC. These are observations of evolving records,
not an assertion that later source remained frozen.

The target `specify-compact-host-transport` records successful checks at:

| Epoch | UTC | Evidence log basename |
| --- | --- | --- |
| 3 | 15:35:59 | evidence-3-16-1792164957674386524.log |
| 4 | 15:39:45 | evidence-4-2-1792165183635008469.log |
| 5 | 15:42:17 | evidence-5-2-1792165335631254929.log |

The filenames and comparison come from the retained task ledger and its recorded
command/input maps, not a new test run.
All three evidence entries have exit zero, the exact same three-suite Node
command, and identical seven input digests: `core`, `server`, the three test files,
`reviews/compact-trade-observations.md` and its report deliverable. This establishes
unchanged measured inputs across those reruns; it does not prove their declarations
include every possible dependency. The original 97-test result is reused here.

Finding 1 concerned attribution of concurrent geographic adapter work. Its
addressed statement explicitly says no author source was changed or restored and
that resuming BLOCKED incremented the epoch. Owner resolution was recorded at
15:40:29. A read-only reconstruction of `relevant_revision`'s assignment JSON and
its existing FNV-plus-NUL digest reproduces the retained values:

- Epoch 3 before the finding: `b0a2f0c55231af72`.
- Epoch 4 with the addressed finding, resolution absent: `2b75a8e5d987cecb`,
  exactly the epoch-4 disposition digest recorded at 15:40:12.
- The same epoch-4 assignment with the actual owner resolution:
  `370e5145599818d4`. No source change is needed for this invalidation.
- Current epoch 5 with that resolution: `d1ec8cbf4a5335c3`, exactly the renewed
  disposition digest recorded at 15:42:37.

The reviewer `review-compact-observation-transports` captured target epoch 3 at
its own epoch-2 acceptance. The target eventually closed at 15:43:25 at epoch 5,
with new dispositions/reflection. Thus “target close made the review stale” is not
the causal explanation. Its current affected-intent projection also reports
changed `core`, `server` and `tests/compact-host-observation.test.ts`, with no
assignment or identity delta. The latter is an explicitly named test dependency,
not merely unrelated broad-directory churn. Do not refresh this review blindly.

## Source trace and existing narrow guarantees

- `src/project/task/revision.rs::relevant_revision` hashes findings including their
  resolution, questions/decisions, assignment fields, acceptance epoch, selected
  path digests and identity fingerprints. Every disposition uses the same full
  relevant revision. One assignment delta therefore stales all of them, even
  when each identity's own fingerprint is unchanged. That is the stored model,
  not evidence that all semantic intent actually changed.
- `src/project/task.rs::intent_revision` additionally pins every scope path.
  `goal_reflection_revision` includes the latest matching evidence and the full
  disposition history. A renewed disposition invalidates reflection deliberately.
  Neither function includes its own resulting receipt in its own hash.
- `record_disposition` and `record_goal_reflection` currently require ACCEPTED and
  the accepted model. `src/cli/task.rs::accept` captures a review's current target;
  `record_acceptance` always increments epoch, even for the same model. Evidence
  matching and lens currency require that epoch. Reacceptance thus forces new
  tests/lenses before READY despite identical check inputs.
- `challenge_fingerprint` already normalizes resolved-finding metadata,
  concurrent attributions, notes, state and closure metadata. This preserves a
  narrower challenge receipt. It is **not** the disposition or reflection digest.
  Do not copy its normalization wholesale into semantic claim freshness.
- Attribution is ownership, not dependency removal. `relevant_revision` retains
  explicit check inputs/deliverables despite concurrent attribution;
  `evidence_inputs` hashes full declared directories. Attribution alone outside
  those paths does not inherently stale every disposition. Here the recorded
  finding and later epoch changes explain the administrative loop.
- `work_under_review` excludes unaddressed findings and strips resolution from
  addressed ones, but `review_revision` also hashes target disposition history and
  reflection and adds the review's explicit input paths. Target claim refreshes
  therefore remain review-relevant. `review_freshness` follows recursive targets;
  missing/withdrawn/cyclic or genuinely changed targets cannot gain current credit.
- `RelevantRevision` excludes task state, result, closed time and result basis.
  A closure-only transition with all relevant values equal needs no new exemption.
  `approval_current` separately requires a closed accepted review, current target,
  current evidence and challenge. Project completion remains independent.

The owner-declared done goal `hand-backs-survive-concurrent-work` references only
three assignment rules: note preservation, concurrent reconciliation preservation,
and attribution from a closed concurrent task. At inspection all three identities
resolved but were unverified in the current project view. They do not cover
opted-in disposition/reflection refreshes or prove the goal's whole prose.
Existing `task_workflow` regressions preserve challenge receipts through resolved
findings and keep explicit concurrent dependencies; their ordinary fixtures do
not establish this opted-in combination. Existing intent/reflection tests correctly
require fresh claims after a new epoch. Those tests should remain valid.

## Smallest prospective change

First increment: extend the existing disposition/reflection recording surfaces
with an explicit receipt-refresh mode for a READY task. Reuse the existing task,
accepted model, revision, evidence and challenge machinery; no copied successful
Evidence entry, global status change or second receipt store.

1. Require the same still-permitted accepted model and an explicit refresh request.
   OPEN, BLOCKED, CLOSED and WITHDRAWN remain outside this mode. Keep ordinary
   acceptance and its epoch increment unchanged. This mode grants no source-edit
   authority and cannot replace a blocked-task recovery or model handoff.
2. Require the existing declared check to remain genuinely supported and tracked,
   and, for an explicit review, its recursive target to remain current. A changed
   check, input map, missing/unreadable path, latest failure or stale target refuses
   the refresh without writing. The current field-specific diagnostic should
   explain why normal reacceptance/review is needed.
3. Write only the explicitly supplied disposition or reflection under the current
   full revision. Preserve accepted model/epoch, old evidence and history. Clear
   `challenged` just as those writers already do. READY is not a bypass: owner
   close must refuse until current claims and a fresh challenge satisfy every
   ordinary blocker. A partial refresh must not look complete.
4. Findings and changed assignment/intent remain in the digest. No identity is
   automatically confirmed, and no owner resolution is interpreted as an author's
   semantic agreement. The author must inspect the actual resolution and provide
   current reasons. Existing model/lens policy, unresolved findings, unanswered
   decisions, carry confirmation, scope, attribution and verification checks remain.
5. Do not repin `review_of` or erase target receipt history. An outer review whose
   target has new semantic claims still needs explicit current review. Avoiding
   those rereads would require a separate prospective semantic-projection design;
   this report does not recommend one without evidence distinguishing equal
   claims from meaningful changes. No generic “administrative event” classifier.

This narrower mode removes the post-READY resolution → forced new epoch → same
check rerun loop while leaving actual BLOCKED recovery and target rework intact.
It does not solve every observed rerun. Broad inputs can be narrowed only by an
owner-reviewed declaration of real imports/check dependencies, with a fresh
baseline and counterexamples. Neither a concurrent attribution nor a filename
extension establishes independence.

## Prospective CLI cases

Use isolated real CLI fixtures with required dispositions and reflection; retain
original evidence/log identity and hashes. First RED must reach the current
READY-state refusal, not a fake success record.

1. READY with current evidence; owner adds/resolves a finding without source
   edits. All affected receipts become stale. Explicit same-model refresh records
   current manual reasons/reflection without incrementing epoch or running/copying
   evidence. Old challenge is absent; close refuses until a fresh challenge and
   required owner confirmation. Ordinary close/project verification are unchanged.
2. Partial refresh, blank reason, wrong/unpermitted model, malformed status,
   unresolved finding or decision, missing lens and unconfirmed carry retain their
   existing refusal. No automatic “confirmed unchanged” claim appears.
3. Change source, explicitly concurrent input, directory child, deliverable, check
   argv or input selection; delete/make an input unreadable; append a failing check.
   Receipt refresh cannot hide stale/failed evidence. Ordinary reacceptance still
   increments epoch and requires current evidence and assessments.
4. Genuine review-target source, role/policy, epoch, disposition or reflection
   change, including a nested review, still refuses current approval. Receipt-only
   mode cannot update `review_of`. Missing/withdrawn/cyclic targets remain refused.
5. Actual target closure alone preserves review currency when epoch, source,
   identities and claims are equal. Then change one of those values and prove the
   same test fails. This is a regression of the existing intended boundary.
6. A concurrent attribution wholly outside inputs preserves current claims when
   nothing else changed; explicit dependencies remain pinned. Compare no-op
   metadata with a real finding-resolution digest delta, rather than assuming all
   owner actions are equivalent.
7. Interleave a source/target/role or task-record change before the refresh write
   through a private deterministic test seam. Refuse observable stale preflight
   state without partial mutation; do not promise global filesystem atomicity.
8. Legacy non-opted tasks and normal accept/reaccept/close behavior remain intact.
   Refresh never writes root verification status, accepts a result, completes a
   goal or authorizes a new source scope.

Likely implementation scope after owner policy approval: existing task receipt
writers, narrowly related CLI options/routes and challenge guidance, focused CLI
regressions and workflow docs. No project fingerprint redesign is justified.

## This report's check

The declared `cargo test --locked --test task_role_resolution` is the existing
15-test role-admission baseline, not proof of this proposal or a rerun of the
compact-host review. Its current task receipt is recorded separately. The owner
replaced nonexistent `src/task.rs` with real task/revision paths and added the
skeptic input before final verification. No global gate or new behavior is claimed.
