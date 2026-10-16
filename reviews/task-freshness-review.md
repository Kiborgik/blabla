# Independent review: receipt-relative task freshness

Reviewer: actual gpt-6-astra/xhigh, 2026-10-16. Target: `implement-precise-task-freshness`, READY acceptance epoch1. This bounded review changes only this report.

## Verdict

Accept the read-only diagnostic within its stated limits. No blocking source finding. It makes existing receipt dependencies intelligible without declaring them irrelevant, refreshing a claim, repinning a target or changing READY/CLOSE authority.

Inspected `src/cli/task/freshness.rs`, its routing and shared comparison/currentness functions in `src/cli/mod.rs` and `src/cli/task.rs`, the skeptic/voice links, all16 focused CLI scenarios, the accepted design and the author's final report/log. Existing source acceptance and project verification remain separate from this report.

## Deciding boundaries

- **Read-only routing:** `Freshness` returns before `task::locked`; it loads a task, takes the existing tracked-tree snapshot and reads target records. The projector has no persistence path. Missing storage, normal text/JSON, stale recursive targets and successful-close fixtures compare actual tree bytes before and after diagnostic reads.
- **Receipt-relative comparison:** groups key the complete recorded/current revisions, context, owner and selection overrides. The existing `fingerprint_change` retains absent-key versus present-null membership. A matching own identity does not override a changed relevant revision, invalid model/status or blank reason. Missing, stale, failed and current check records remain distinguishable.
- **Unavailable evidence stays unavailable:** directory children are exposed only when the opening aggregate matches the recorded digest and current selection matches the observed digest. Direct files are not relabeled directory history; uncertain attribution/filtering refuses child expansion. Unknown child totals are null. Assignment fields are unavailable rather than guessed; reflection and review digests are explicitly composite. Legacy missing check epoch remains labeled unavailable.
- **Exact bounds:** paths, identities, receipt rows and groups have complete counts before their50-row display caps. Child rows share one global50-row budget; counting traverses selected roots even when the outer path/group cap hides them. Counts describe comparisons, not unique physical files. The retained60-root regression catches the earlier undercount.
- **Recursive target truth:** the actual dependency/currentness functions and tracking errors decide each link. Missing/unreadable/withdrawn targets and cycles remain explicit failures; traversal never pins a new target. Closure-only bookkeeping is tested separately and stays current under the existing authority.
- **No closure relaxation:** skeptic and voice changes point to the diagnostic while retaining their classes and decisions. Real ordinary and bounded positive fixtures still perform canonical verification and preserve their distinct result basis. Separate negative fixtures require actual task-policy refusals for READY, ordinary/bounded CLOSE and READY refresh before and after the diagnostic. A parser failure is not accepted as that evidence.

## Evidence and actual use

Read the complete author log `.blabla/scratch/implement-precise-task-freshness/evidence-1-189-1792184252388427153.log`:16 passed,0 failed. The retained genuine missing-command and child-count failures are described with their earlier erroneous harness attempts; none is substituted for final behavior.

Read the actual retained `dogfood.json` and `dogfood-metrics.json`:36 receipts,4 groups,18 available child comparisons,15,489 JSON bytes and0.136s local elapsed time; all sampled example task/status bytes unchanged. This is one bounded measurement, not a general speed or effort-saving guarantee.

During this reviewer's separate roadmap handback, the real diagnostic reported a current integrity check and29 current dispositions, while identifying only the reflection-composite assignment change after those disposition writes. It did not invent changed source paths or refresh anything. The subsequent explicit reflection was the normal workflow. This is a useful observed application of the new explanation, not proof that every future stale handback needs no source work.

The reviewer-declared check is exactly `cargo test --locked --test task_freshness`; its final result is recorded on this review task. No full campaign, production edit, contract promotion or public publication was performed.

## Acceptance limits and useful next outcome

The snapshot retains the existing tracking limitations: omitted unreadable/ignored members, symlink behavior and possible metadata-only hashes for large files. It is not a content diff or semantic independence judgment. One filesystem snapshot plus sequential target-record reads is a diagnostic observation, not an atomic transaction across concurrent writers. Persistent final-reread and closure guards remain the deciding authority.

Older receipt-time child and assignment details cannot generally be reconstructed. The view says so rather than persisting a guessed baseline. Optional future capture remains separately scoped. Use this accepted diagnostic on the next real stale handback to choose the affected explicit reassessment; no manufactured successor, global rereview or blanket `confirmed-unchanged` result follows automatically.
