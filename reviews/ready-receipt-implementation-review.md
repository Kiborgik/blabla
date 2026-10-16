# Independent review: explicit READY receipt refresh

Reviewer: actual gpt-6-astra/xhigh, 2026-10-16. Target: `specify-ready-receipt-refresh`. This review covers the explicit receipt route, current authority and race guard, remembered identities, writer provenance and READY re-challenge. It does not accept a project, publish tooling or repin any review target.

## Evidence and scope

Read the prior independent design report, owner-authored draft, full production `ready_receipts.rs` path and sixteen private checkpoint tests, shared claim writers, relevant revision computation, CLI option/routing and READY challenge changes, documentation, and the twenty-eight CLI integration scenarios. The author log `.blabla/scratch/specify-ready-receipt-refresh/evidence-6-16-1792167632361336554.log` contains 104 passing tests: 52 binary tests including the sixteen new checkpoint witnesses, fourteen reflection tests, ten disposition tests and twenty-eight refresh tests. All distinct log lines were inspected after exact-line deduplication of repeated fixture output; complete original output remains in that log. Printed task-policy errors and the intentional panic-output control are exercised negative paths, not ignored test failures.

The earlier missing-option RED and design-only acceptance remain historical evidence. Existing fixtures perform real CLI acceptance, evidence and hand-back. Their check counter makes an unintended rerun observable. Deliberate corrupt-state, writer-metadata and checkpoint mutations remain labeled fixtures rather than forged successful evidence.

## Finding 1: reflection identity retention, corrected

The initial implementation extends `task.intent_identities` in `write_disposition`, but not in `write_goal_reflection`. A READY reflection therefore captures a new identity in its revision without retaining that obligation in the task's monotonic set. If its declaration subsequently disappears before a disposition, the current identity resolver does not retain it from the reflection alone. This conflicts with the approved symmetric retention boundary and the public documentation.

The orchestrator confirmed that either opted-in receipt refresh must remember validated newly observed identities without confirming them. Requested correction: retain the reflection's observed identities and add the corresponding removed-declaration regression. Preserve all other evidence, epoch, scope, target and explicit-claim-only behavior. The bounded correction adds the validated reflection identities only on the READY path, after payload validation, without supplying any disposition or changing ordinary ACCEPTED behavior. The new actual-CLI regression first failed at the missing retained identity in `/tmp/ready-reflection-retention-red.log`, then passed. It verifies retained missing status after declaration removal and preserves epoch, evidence, scope, target and existing dispositions. Finding 1 is source-resolved; orchestrator resolution remains separate.

The final author receipt `.blabla/scratch/specify-ready-receipt-refresh/evidence-7-15-1792168240359050862.log` reports 105 passes: the same 52 binary, fourteen reflection and ten disposition checks, plus twenty-nine refresh cases. The owner strengthened both draft preservation rules with an explicit observed-identities-retained predicate. This review inspected that narrow source/test/draft delta and preserves the prior broader assessment. No independent binding or promotion claim follows.

## Other inspected boundaries

- Explicit refresh requires READY, its same accepted model, current role/process permission, opted-in claim type, current successful tracked evidence and current recursive review targets. Missing, malformed, revoked or changed authority cannot be replaced with a historical matching model string.
- Each inspection reloads the manifest and Project, actual registered process, task and tracked inputs. Before writing, the same production recording path inspects again and compares the complete task fingerprint, authority fingerprint, relevant intent revision and recursive target revisions. A changed but still-eligible note, manual claim, goal or process refuses rather than overwriting a concurrent update.
- Payload validation is shared with ordinary ACCEPTED writes. One supplied claim is renewed; the other claims remain as recorded. Ordinary reacceptance still increments epoch, and a refresh neither invokes a check nor fabricates/copies fresh evidence. Review targets are never repinned.
- The existing writer build stamp is updated honestly. Monotonic identity bookkeeping must add observations without automatically supplying dispositions or removing obligations. Unknown or incomplete manual payloads still refuse atomically.
- READY re-challenge uses the ordinary current blocker evaluation and tracked-readiness rules. It records a challenge only when supported and retains state, epoch, evidence and target. This restores the intended path after a manual refresh clears its old challenge, without granting source-edit authority.
- Unresolved findings, owner carry confirmation, unpicked questions, stale knowledge lenses, scope/attribution issues, model exceptions and global verification retain ordinary closure authority. Successful receipt renewal is not permission to close through them. Target closure metadata alone remains distinct from changed source, epoch or claims.

## Race evidence limits

The sixteen private tests call the same final recording function used in production through a test-only checkpoint. Both claim types reach genuine initial eligibility. They cover no-op success and observed source/check/task/model/process/goal/direct-target/recursive-target changes, preserving externally introduced bytes on refusal. A closure-only target control and unrelated global-status control preserve the intentionally separate boundaries. Some checkpoint task/evidence mutations are explicitly corrupt or metadata fixtures; the CLI suite separately performs real closure and a real failing check.

This is an observed-change guard, not filesystem-wide atomic isolation against an arbitrary writer after the final reread. It is not a new source-independent acceptance route. The existing canonical verification and owner acceptance rules remain authoritative.

## Follow-through

With finding 1 source-resolved, the final verdict has no remaining blocking source finding in this bounded packet. Run the assigned focused CLI test target once against the final source and read its complete result, preserving the already inspected broader author/race evidence. The useful next step is a real eligible READY claim refresh during dogfooding, proving the check counter/evidence and acceptance epoch remain unchanged while current claims and challenge are renewed. Changed source or a stale review target must still take ordinary reacceptance and evidence.
