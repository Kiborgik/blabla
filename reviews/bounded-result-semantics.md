# Bounded result acceptance: independent semantics review

Reviewed 2026-10-16 13:56 UTC by gpt-6-astra, before production implementation.

## Verdict

Proceed with the explicit bounded-result implementation under the clarified eligibility and final recheck requirements below. No remaining design blocker was found after the author and orchestrator accepted the two corrections raised during this review. This accepts a proposed boundary and prospective tests; it does not establish implemented behavior, project completion, or permission to publish tooling.

Ordinary CLOSE retains its current meaning. The new opt-in accepts one current task result while project verification remains pending. It must not infer that concurrent files are semantically independent.

## Sources and evidence

Read the complete concurrent-task-closure research, the prospective CLI test file, and the relevant current decisions in `src/cli/task.rs`, `src/project/task.rs`, `src/project/status.rs`, `src/skeptic.rs`, and verification-record creation in `src/cli/project.rs`. Read the new draft `contracts/bounded-results.bla`; its final-task-and-eligibility rule expresses the corrected boundary, but a draft is not implementation evidence.

Read the entire prospective test log `.blabla/scratch/specify-bounded-result-closure/evidence-7-6-1792158890276737443.log`: the executable builds, all 34 tests run, two ordinary-CLOSE controls pass, and 32 prospective cases fail at the absent `--bounded` surface. These are genuine missing-surface RED results, not 32 separately observed failures of implemented bounded semantics. The preceding 31-test packet had the same two controls and 29 missing-surface failures.

The review's declared `cargo test --locked --lib project::tests::` passes 20 existing tests. It is a project parsing/status regression baseline only. It does not execute the proposed bounded command or prove the review judgment. The exact receipt remains on this task; the complete initial log was read at `.blabla/scratch/review-bounded-result-semantics/evidence-1-2-1792158768285568988.log`.

At inspection, root behavior verification was stale while current structure was GREEN. The existing hand-back goal's owner-declared completion and prior assignment rules do not establish this new closure behavior. Owner outcome review and actual future verification remain separate.

## Required boundary, checked against the proposal

1. **Explicit owner choice.** Require the new flag, a nonempty reason, and the declared orchestrator model policy. Model text is an attestation, not authentication. Do not claim that existing ordinary CLOSE already validates that same owner policy: its inspected implementation does not call that validator.
2. **Qualified history.** Require a readable, typed prior overall canonical GREEN record, including recorded GREEN structure, and current live GREEN structure. Permit only implementation-fingerprint drift with unchanged contract identity, verifier and canonical profile. Missing/corrupt history, prior RED/YELLOW, missing or malformed historical structure, no profile, noncanonical verification, running/interrupted verification, current structural failures/errors and mixed staleness remain ineligible.
3. **One narrow exception.** Preserve the current close/readiness/challenge path, excluding only an eligible `verification-not-current` contradiction. Do not substitute `assignment_blockers()`: its wider exclusions also remove vacuity and unconfirmed owner records. Findings, scope and change attribution, tracked inputs, latest successful exact evidence, falsification, role policy, questions, required lenses, dispositions, reflection and recursive review freshness must remain binding. Keep the existing withdrawal-residue treatment without inventing automatic reconciliation.
4. **Historical receipt and present status.** Add an optional bounded basis containing the reason, observed verification state/reason and prior run/fingerprint. Missing basis keeps ordinary/legacy semantics. Later integration success must not rewrite this historical basis; current project and review approval status remain current observations. Preserve existing closed-path accounting and scope release.
5. **No wider completion.** Do not write or refresh project status, clear stale verification, change rule verdicts, mark goals complete, or authorize publication. A later canonical finish may legitimately fail on an undeclared runtime dependency. Both the explicit-dependency refusal and implicit-dependency/later-RED witnesses belong in acceptance.
6. **No inference from a display.** A 50-entry diagnostic cap, missing legacy per-file inventory, Markdown extension, nested manifest or claimed unrelatedness is not evidence of semantic independence. Use actual relevant task revisions and qualified aggregate verification history. The positive truncated-display and legacy-inventory cases are useful controls against accidental overrestriction.

## Corrections raised and disposition

### Prior GREEN meant overall GREEN

The initial research wording and current status evaluator could be read as accepting a prior behavior-GREEN record even if that run's structure was RED. `Record.structure` already exists, and the current evaluator does not itself establish historical structural success.

The orchestrator and author clarified that historical overall GREEN is required. The final prospective additions reach a real finish with behavior GREEN and structure RED, repair current structure, and still require refusal; separate cases reject absent and malformed stored structure. Their setup assertions reached the expected states before failing at the missing command surface. This resolves the design ambiguity. The implementation still needs typed historical validation; merely reading `status: green` from a partial object is insufficient.

### The final check must cover project eligibility as well as task revision

The initial 31 CLI cases test changes made before invocation; none deterministically changes state between initial eligibility and result writing. Checking task paths alone would miss a newly started verification or replaced prior record.

The accepted correction is a private test-only one-shot callback around the exact production decision core, after initial eligibility and before final reload/revalidation/write. No CLI flag, environment hook, timing sleep or simulated acceptance path is needed. A no-op callback must first demonstrate genuine eligibility. Mutations must cover own task input/record/epoch, review target input/epoch, prior record replacement (including another GREEN run), profile/contracts/verifier, live/interrupted run state and current structural failure. Refusal must preserve the post-mutation task/status bytes rather than overwrite concurrent changes. Revalidate owner/readiness/challenge and the same qualified project basis immediately before writing.

The draft now explicitly requires both current task revision and current verification eligibility. The exact callback tests are an implementation obligation, not evidence already supplied. This is observable race resistance, not a filesystem-wide transactional guarantee.

## Focused implementation acceptance still needed

- Turn the prospective command suite GREEN through the real production path and execute the private race cases above.
- Demonstrate honest plain-text as well as JSON rendering of bounded acceptance, pending current project verification and legacy/default records. The supplied integration helper primarily checks JSON.
- Reuse the existing closure predicates rather than duplicating a second blocker list. During source review, confirm sibling obligations not individually duplicated in this prospective file, including nested review/policy changes, falsification, missing lenses, decision floors and structural errors. A small shared-predicate equivalence test is preferable to an unrelated broad audit.
- Retain fresh ordinary-CLOSE and stale ordinary-CLOSE controls and immutable historical basis after later finish.

No game runtime, release activation, deployment, production implementation or project verdict was changed by this review. Its useful successor is the already authorized bounded implementation, followed by independent review of its actual decision and race tests.
