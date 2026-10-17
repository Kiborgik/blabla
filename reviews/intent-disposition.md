# Independent review: opt-in affected-intent disposition

## Result

No blocking defect found in the reviewed implementation. The change adds a bounded, opt-in task obligation using the existing task, identity-resolution and revision machinery. It does not grant scope, edit intent, mark goals done or replace the project gate.

Reviewed task: `add-intent-disposition`. Reviewer: `gpt-6-astra`. Review task: `review-intent-disposition`. Reviewed on 2026-10-16 UTC. This report covers the six assigned implementation/test/documentation files, not concurrent game changes or a full product-gate run.

## Independent verification

- Before production implementation, `cargo test --locked --test intent_disposition` exited **101**: four failures and one legacy pass. The substantive existing-lifecycle test reached `challenge` and showed that a task requiring dispositions could still report `assignment_clear=true` with none. Other failures exposed the absent CLI/view surface; they were not compilation failures.
- Against the implementation, the same exact command exited **0**: **10 passed, 0 failed, 0 ignored**. The complete output was read. Tests invoke Cargo's current test-built CLI in temporary projects.
- Read every changed hunk in `src/cli/mod.rs`, `src/cli/task.rs`, `src/project/task.rs`, `src/skeptic.rs`, `docs/agent-workflow.md`, and the full new `tests/intent_disposition.rs`. Also followed the reused `review_identities`, `RelevantRevision`, scope hashing, challenge receipt, READY and CLOSE paths.

## Requirement and failure-path accounting

| Obligation | Evidence and assessment |
| --- | --- |
| Opt-in only; old records remain usable | CLI opening flag is forwarded explicitly (`src/cli/mod.rs:239-247,1114-1144`; `src/cli/task.rs:776-780`). New persisted fields default and omit empty/false values (`src/project/task.rs:1570-1577`). Tests at `tests/intent_disposition.rs:382-397,571-608` cover old JSON and the prior challenge-fingerprint shape through successful closure. |
| Reuse the relevant intent boundary | `src/cli/task.rs:49-64` calls the existing `review_identities`, rather than creating a second mission/system/process resolver. The opening set is retained; disappeared identities receive an explicit absent fingerprint. Tests at `:188-255` enumerate mission, linked goal, scoped system, responsibility, seam, role, policy, model and knowledge identities, excluding the unrelated system. |
| No disappearance bypass | `src/cli/task.rs:55-62,777-780` and `src/project/task.rs:685-687` preserve identities known at opening or previous recording. The manifest-unregistration test at `tests/intent_disposition.rs:442-497` shows the removed mission remains an obligation that must be explicitly accounted for. |
| Relevant code and intent invalidate claims | `src/project/task.rs:627-638` reuses `RelevantRevision` and adds every scoped path's observed digest. Narrow check inputs therefore cannot hide another scoped source edit. Tests at `tests/intent_disposition.rs:259-318` exercise scoped source, system, mission, goal and policy changes, while an unrelated system edit preserves freshness. |
| Accountability and atomic rejection | CLI computes the current revision; it does not accept a caller-supplied digest (`src/cli/task.rs:1983-2012`). `record_disposition` requires opted-in ACCEPTED state, the accepted model, a discovered identity, one of the two statuses and a nonblank reason before mutation (`src/project/task.rs:657-689`). Invalid identity/status/reason/model tests assert the task file remains byte-identical (`tests/intent_disposition.rs:321-354`). Model identity remains an attestation, consistent with existing BlaBla semantics. |
| Current claims gate both hand-back and close | `resolved` supplies current pending identities (`src/cli/task.rs:3584-3592`); `intent-disposition-missing` is an assignment blocker, not an outside-assignment class (`src/skeptic.rs:19-48,295-303,1071-1099`). Both existing READY and CLOSE paths evaluate that report. Tests at `tests/intent_disposition.rs:163-185,400-439` verify missing claims and relevant intent changes after READY cannot close, and reacceptance invalidates old claims. |
| Receipts do not invalidate themselves; independent reviews see changed claims | Own freshness uses the existing assignment revision, excluding the growing receipts. `review_revision` separately incorporates the target's disposition requirement, retained identity set and receipt contents (`src/project/task.rs:571-590`). The test at `tests/intent_disposition.rs:500-550` proves adding a corrected reason leaves the task's receipts current but invalidates its linked review. |
| Existing evidence and contract authority survive | Recording a receipt clears the old challenge (`src/project/task.rs:688`), not evidence or verification results. Tests at `tests/intent_disposition.rs:355-378` retain missing/failing-check blockers. The test at `:553-568` reaches a failed structure contract with all dispositions current: `finish` and closure still fail. The goal file and task scope remain unchanged in the closure/invalid-input tests. |
| Usable recovery and honest limits | `task show` reports each identity as MISSING/CURRENT/STALE with status/reason and a recording route (`src/cli/task.rs:3100-3133`). `docs/agent-workflow.md:70-89` describes opt-in, freshness, removed identities, retained authority and the limits of reason validation. |

## Non-blocking boundaries to retain

1. A nonblank reason is an accountable claim, not semantic proof. Both statuses can be asserted without BlaBla determining whether the intent really changed or remains appropriate. The documentation says this explicitly; a reviewer must still assess the reason against the implementation. Do not present this as automatic prevention of all project-memory drift.
2. Discovery deliberately inherits the existing scope-aware review resolver. It covers its listed identities, not every arbitrary `.bla` record. In particular, process flow/step text is not separately discovered by `review_identities`; tasks for which that text matters should include `process.bla` among their evidence inputs. This is a boundary of the approved small change, not a request for a second review system or scheduler.
3. The focused suite proves these lifecycle cases. Integration still needs the orchestrator's normal broader Rust/product verification. No full-suite or canonical-gate result is claimed here.

## Applied lenses

- **Reviewing:** checked the deciding code and sibling states, including post-READY mutation, stale reviews, disappeared identities and rejected writes. No blocking finding remains from this pass.
- **Engineering:** the implementation stays inside the requested opt-in lifecycle change. No scheduler, separate ledger, automatic intent editing or unrelated source refactor was introduced.
- **Testing:** independently observed meaningful pre-implementation RED and final focused GREEN; read all negative assertions and did not treat a passing count as evidence of unexercised behavior.
- **Design:** DRY is served by reusing the existing identity resolver and revision type. Pure receipt validation/freshness stays in the task model; project-memory discovery and presentation remain at the CLI boundary; the skeptic consumes resolved obligations. No speculative framework is required.
