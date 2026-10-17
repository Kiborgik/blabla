# Explicit batched delivery review

Author: actual Astra/high. Scope: prospective CLI cases and design, 2026-10-16.

## Observed seam and smallest change

A single manufacturing inspection covers two independently assigned source tasks, but `independent_review` in `src/cli/task/delivery.rs` selects only `task.review_of`. Verdict replacement currently keys by goal and residual origin. `accepted_review`, `reviews_pending`, `resolved_origin` and close-context collection likewise discover only that primary link. A same-goal second source therefore needs another review assignment despite already inspected shared evidence.

Keep the primary `review_of`. Add default-empty, omitted-when-empty `Task.delivery_review_targets: Vec<ReviewTarget>` using the existing task/revision pair. Declare these only at `task open ... --review-of CORE --delivery-review-of SERVER` (repeatable additional argument). Require a primary review, existing distinct nonwithdrawn sources and no duplicate/self/cyclic target. Acceptance pins each through existing `review_revision`, source identities and recursive review dependencies. No amendment route or implicit target discovery in this slice.

`task delivery-review REVIEW GOAL --source SERVER ...` selects only an explicitly assigned source. Omission preserves the primary default. Each new verdict stores `source_task`; an old absent field means only the primary source. Replacement is keyed by resolved source, goal and exact residual origin. Same-goal verdicts must coexist and retain separate claim digests, source revisions and references. Historical records are not rewritten.

Both close modes still require current independently accepted review records. One closed review may support two separate owner closes; it never closes either source automatically. Closing the two legitimate sources in either order must preserve the other verdict because ordinary source closure does not change the reviewed work. Partial/Blocked residuals remain. Exact Delivered residual resolution selects and resolves only its named origin.

## Currentness and authority

Traverse the explicitly declared review graph, with path-local cycle detection so shared ancestors are legal. Currentness includes each source's tracked inputs, current claim, relevant identity/assignment revision and each observation artifact. A changed secondary input or claim cannot be silently repinned by verdict recording. Reacceptance and new evidence/explicit verdicts remain required. No model authentication claim is added; the current process model attestation remains mandatory.

The final recording and closure rereads must reload the actual project/process, reviewer, all selected source records and recursive dependencies. Compare inspected context as well as current eligibility. Extend existing private exact-core seams with no-op controls and secondary source/claim/artifact/authority mutations, including a valid-but-changed record. READY receipt refresh and bounded-result context collection must also include these explicit targets; otherwise those existing final-reread guarantees would omit a new dependency. This is an implementation obligation, not executed race evidence yet.

## Prospective cases and evidence limits

`tests/batched_delivery_review.rs` uses isolated real CLI projects, actual canonical counter verification and actual stored check results. Typed runtime/viewport references are explicitly synthetic fixture observations. No source JSON is patched and no successful evidence is fabricated.

Twelve cases cover legacy primary success; explicit pins and same-goal replacement isolation; ordinary/bounded independent closes in both source orders; omitted-selector primary behavior; unknown/self/unassigned selection; missing/self/withdrawn/duplicate declaration refusal; secondary source drift; changed claim and explicit repinning; source-specific rejection; reviewer artifact drift; actor/state authority; and exact secondary residual resolution preserving both closed source files. Refusal helpers require category task and complete fixture-tree byte preservation, so invocation errors cannot count as lifecycle refusal.

The first development launch failed during fixture setup because the second source file was created after the first task opened. That is preserved in `/tmp/batched-delivery-fixture-setup-failure.log` and is not feature RED. Preparing both files before either assignment corrected the fixture. The next run (`/tmp/batched-delivery-prospective-red.log`) passed the legacy control and failed eleven cases on the genuinely missing `--delivery-review-of` surface. Later assertions and loop branches remain prospective, not independently executed safety proof. Subsequent fixture refinements explicitly own unrelated bounded-close drift and establish a real unassigned target; no production implementation exists yet.

## Exact implementation paths

- `src/cli/mod.rs`: declaration and selection arguments.
- `src/cli/task.rs`: validate/open/pin and shared recursive review graph/currentness.
- `src/cli/task/delivery.rs`: source-aware verdict/currentness/discovery, final record/close contexts and private mutation tests.
- `src/project/task.rs`: default-compatible additional target record field; avoid widening the public `Opening` struct if the CLI can assign validated targets before its existing first store.
- `src/project/task/delivery.rs`: optional verdict source identity.
- `src/project/task/revision.rs`: include nonempty additional assignment targets without changing old empty-record digest bytes.
- `src/cli/task/bounded.rs` and `src/cli/task/ready_receipts.rs`: reuse the same recursive dependency collector for existing final-reread comparisons.
- `docs/agent-workflow.md`: explicit declaration/selection and independent source closure example.

The originally declared `src/task` input is absent. Actual record code is `src/project/task.rs` and `src/project/task/`; the root CLI entry is `src/cli/mod.rs`, with orchestration in `src/cli/task.rs`. Parent owns input and production-scope amendments. No global campaign, contract promotion, historical backfill or new review ledger is proposed.

## Implemented bounded slice

The declared prospective receipt is retained at `.blabla/scratch/specify-batched-delivery-review/evidence-1-2-1792190014498969464.log`: one legacy pass and eleven missing-option failures, child101. The owner subsequently authorized the exact production paths above. The initial implementation passed all twelve CLI cases. Three later cases add source-artifact drift, recursive secondary currentness and shared-ancestor traversal; two compatibility cases exercise the actual absent-field singular writer shape and repeated/missing-primary declaration refusal.

The existing private recording/closure seams now exercise a real second source: a no-op record succeeds; changed secondary note, claim, artifact, source input or process authority refuses without losing concurrent bytes. Both ordinary and bounded source-close paths have positive no-op controls and refuse a valid changed other-source context. Existing READY refresh deliberately continues to allow closure-only target metadata. A development attempt to include whole records in its context failed that existing control (72/73); it was corrected to preserve RelevantRevision semantics while collecting every new graph edge. Full-record context comparison remains at the delivery recording/close boundary where it already belongs. No existing test expectation was weakened.

The corrected development check passed 73 binary cases plus 15 CLI cases. Final declared evidence will additionally include the two late compatibility cases. These are finite fixture results; the live manufacturing review has not been retrospectively changed or approved by these tests.

The first final receipt retained all73 binary passes and16/17 CLI passes. The late compatibility test had removed a new verdict field after challenge/closure, correctly staling that challenge. The correction preserves the actual old singular writer shape when no additional targets or explicit selector are supplied; its test now asserts those fields are absent without any JSON mutation. Batch and explicit-selector verdicts keep their source identity, and replacement compares resolved source identities on both sides. The failed final log remains evidence-2-2-1792190636008970238.log; no historical challenge is repaired or weakened.

Final source inspection found and reproduced one additional integration defect: an unrelated unaccepted review with a withdrawn extra target blocked a source already covered by a closed current batch. `/tmp/batched-unaccepted-review-red.log` records that exact lifecycle refusal. Close context still fingerprints every referring review record, but recursively captures source context only for the current task and independently accepted current reviews contributing authority. Unaccepted assignments do not acquire veto authority. The added eighteenth CLI case preserves both legitimate source closes; all previous currentness/race controls remain.
