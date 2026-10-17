# READY receipt-refresh design review

Actual reviewer: gpt-6-astra/high. Report-only independent review of the tooling author's prospective tests and the owner-authored draft. I did not author this test packet or the proposed implementation.

## Design verdict

No blocker to a narrowly authorized implementation. Explicit manual refresh while READY can preserve the existing acceptance epoch and genuinely current evidence without granting source-edit authority or accepting work. It must remain distinct from ordinary reacceptance, which still increments epoch, and from review target repinning. The final reread and race obligations below are implementation acceptance requirements, not behavior already established by this design review.

## Actual evidence read

Read the complete final log `.blabla/scratch/specify-ready-receipt-refresh/evidence-5-2-1792166803547956104.log` and the 25-test source. The result is genuinely RED: two controls pass, 23 tests fail because `--refresh-ready` is absent. Both positive and refusal cases reach that missing surface. Refusal cases explicitly require category `task`; category `invocation` cannot be mistaken for a correct policy refusal.

The two passing controls are ordinary READY writes/reacceptance behavior and target-closure-only review currency. The former also proves reacceptance increments the epoch and executes the real source check again. The latter demonstrates that closure itself is already harmless when relevant values remain equal. Neither proves a refresh implementation.

Fixtures create tasks, actual check receipts, lenses, claims and READY hand-backs through the real CLI. Their canonical Python counter campaign creates actual GREEN project evidence. The check counter makes an unintended rerun observable. The deliberately corrupted READY fixtures are honestly labeled: one removes evidence; the other first executes a genuinely failing check, then changes the state string. They do not fabricate successful evidence.

The reported earlier structure-only fixture mistake and its repair remain disclosed in the author's packet. Looped subcases and assertions after the first missing-option failure remain prospective. In particular, successful-refresh preservation and subsequent close blockers have not executed successfully today. I did not rerun the full RED suite. This review's declared `cargo test --locked --test ready_receipt_refresh --no-run` is compilation of the design-review test target only, not feature success or replacement of the author's RED receipt.

## Policy and source fit

The current `relevant_revision` includes assignment, epoch, findings and resolutions, questions/decisions, inputs and identity fingerprints. `intent_revision` additionally pins scope. `goal_reflection_revision` includes evidence and disposition history. Keep these meanings: resolving a finding is not automatic semantic agreement, and a new disposition intentionally makes the prior reflection stale.

The current receipt writers require ACCEPTED and the accepted model, validate explicit claims, and clear the challenge. The proposed branch should share validation and revision computation rather than fake ACCEPTED state, call acceptance, copy a successful Evidence entry or normalize away differences. The supported successful mutation is only the supplied disposition/reflection and challenge invalidation, under the retained epoch/model. Positive tests compare the complete task record and all other fixture bytes, not a convenient subset alone.

Refresh eligibility must require the correct opted-in operation, READY state, same still-permitted accepted model, valid current registered process, genuinely current successful tracked evidence and current recursive review targets. Changed check argv/input selection, absent or wrong-type inputs, explicit concurrent dependencies and latest failure remain refusals. This is current authority, not merely a matching historical model string. Reuse applicable existing approved-model policy; do not broaden it through a refresh-specific fallback.

The current recursive `review_freshness` already reads each target and checks tracking/revision currency. Reuse it rather than comparing only the immediate target name, state or epoch. Missing, malformed, withdrawn, cyclic or genuinely changed targets cannot be repaired by changing `review_of`. New target claims remain review-relevant. The closure-only control is an existing boundary, not a reason to exempt all owner events.

Manual refresh eligibility and close eligibility are deliberately different. An unresolved finding, missing/current lens, unanswered decision/question, unconfirmed owner carry record, attribution/scope issue, pending model exception or stale global verification must retain its existing closure effect. The suite explicitly exercises several of these after successful refresh; the rest remain ordinary existing close machinery and must not be bypassed by the new branch. No blanket claim that the 25 tests exhaust every close blocker is warranted.

## Final reread and deterministic race obligations

Before persistence, reload the task and current process/model authority, recompute current tracked input and relevant identity/revision state, and recheck recursive targets. Reusing a cached Project/process snapshot twice is insufficient if the registered process or manifest changed between inspection and write. A final check that merely finds the new state eligible is also insufficient: it must establish that the context used for the explicit claim has not drifted, rather than silently recomputing a claim against newly changed intent.

Use a private deterministic test seam before final validation/write, with no public bypass or environment backdoor. Cover no-op success plus source/check input mutation, task record mutation, model/process change and nested target drift. Include a valid-but-changed task or identity context that remains generally eligible, so stale explicit claims cannot overwrite concurrent records or acquire a revision the caller never inspected. Refusal preserves the externally introduced change and adds no refresh mutation. These are bounded observed-race tests, not a guarantee of global filesystem atomicity against arbitrary external writers after the final check.

No race test is claimed in the current integration suite. The author explicitly leaves that obligation for implementation module tests. Cyclic targets, independent target reflection drift and some close blockers are source-grounded retained obligations rather than separately reached assertions in today's RED packet.

## Design lenses and successor

DRY/SRP favor one canonical eligibility path shared by the two receipt surfaces, existing evidence/revision/target policy, and the existing explicit claim validators. A second receipt store, automatic agreement classifier or generic freshness redesign would exceed the demonstrated need. Production code and public API compatibility still require subsequent independent review after implementation and passing behavioral checks.

Recommended next step: authorize the bounded implementation and private race tests; preserve the author's full RED log and both legacy controls, then require actual 25-case behavioral success plus the final-write race evidence. This compilation-only design receipt never marks the feature complete, promotes the draft, changes a goal or permits publication.
