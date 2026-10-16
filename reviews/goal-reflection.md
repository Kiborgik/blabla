# Bounded post-feature goal reflection

Implementation: actual gpt-6-astra/high, task `add-goal-reflection`. The existing goal-coverage projection was implemented by gpt-6.1-sol and was inspected here without changing its attribution.

## Purpose and boundary

One short reflection records what meaningful feature work made possible, what was actually observed, and why a bounded next decision or a justified stop follows now. It is an opt-in hand-back obligation for a named goal, not a per-compile ritual. It never scores creativity, requires a minimum number of ideas, infers semantic completion, opens a successor task, widens a scope, or changes goal state. Owner outcome acceptance remains separate.

The causal bridge matters more than another next-task title: name the new decision or consequence, an observed gap or opportunity, an inspectable evidence reference, and the reason the recommended action or stop follows. References and prose remain accountable claims whose meaning a reviewer must inspect.

## CLI

Open meaningful feature work with `task open NAME --goal GOAL --require-goal-reflection`, alongside its ordinary role, scope, deliverables and declared check. Existing tasks without the flag retain their behavior.

Record after the evidence and affected-intent dispositions are current:

```
blabla task reflect NAME \
  --outcome no-useful-successor \
  --decision "The new projection makes missing exact goal links visible" \
  --observation "The focused check distinguishes draft, missing and stale cases" \
  --evidence-ref "tests/goal_coverage.rs" \
  --reason "No further authorized gap follows from this bounded change; the owner can review the demonstrated result" \
  --model MODEL
```

Every outcome needs `--decision`, `--observation`, one or more `--evidence-ref`, `--reason`, and the accepted `--model`.

- `successor` additionally requires `--recommendation`, `--owner`, and `--observable-outcome`; repeat `--dependency` for known prerequisites. The recommendation should describe the smallest useful next slice within the named goal, including its scope. Its proposed owner and prerequisites do not themselves grant permission or prove that dependencies are met.
- `blocked` additionally requires `--blocker`, `--owner`, and `--unblock-when`. This describes the next goal step's missing prerequisite; it does not change the task lifecycle to BLOCKED or waive the current task's evidence and findings.
- `completion-recommended` records a recommendation for the owner to inspect outcome evidence. It never marks the goal done.
- `no-useful-successor` records a justified stop. Its common reason explains why more work would not be useful now.

Fields for a different outcome are rejected. Blank required prose, blank evidence references and blank successor dependencies are rejected. This is structural validation, not a semantic quality or source-authenticity claim.

A successor is a recommendation rather than a required already-open task. This avoids a lifecycle deadlock when the next useful change needs the same scope, which remains owned by the predecessor until closure.

## Persistence and freshness

The existing Task record gains default-skipped `goal_reflection_required` and optional `goal_reflection` fields. The reflection has one typed terminal outcome, the short content, accepted model, recording time and existing `RelevantRevision`.

Freshness reuses `intent_revision`: all declared scope paths, relevant assignment/check inputs, acceptance epoch and scope-aware intent identities are covered. Its digest also includes the latest matching evidence and affected-intent disposition statements. Changing the reflection does not invalidate itself or an intent disposition. Changing the evidence or dispositions afterward invalidates the reflection. Recording or replacing a reflection invalidates the challenge receipt; its value is also included in review freshness.

`task show` renders the same missing/current/stale value in human and JSON views. The `goal-reflection-missing` skeptic class participates in the existing assignment blocker route for opted-in open tasks. Hand-back and closure still require their existing evidence, challenge and authority checks. Closed records retain historical claims; no retrospective reflection requirement is imposed on legacy work.

## Verification

Prospective RED was observed before production edits: after repairing a fixture that omitted required goal expectations, the old implementation reached seven failing assertions or unsupported-command/flag checks. The primary regression reached a concrete `missing`-state assertion, demonstrating that an arbitrary note did not satisfy the proposed obligation.

Focused verification is `cargo test --locked --test goal_reflection`. Final results and remaining limits are recorded in the task hand-back. Project integration and the canonical gate remain orchestrator-owned.

The final focused run passed 14/14 tests, including actual READY/CLOSED transitions, the four terminals, old-task behavior, content/actor/state validation, all declared freshness dimensions, unrelated-system stability, a real failing child check, removed goals, stale closure, human/JSON parity and review/challenge invalidation. No full-suite, product-gate, runtime performance, source-reference authenticity or semantic-quality claim is made by this focused result.

## Integration repair

The orchestrator's real example build exposed E0063 at `bridge/assignment.rs:97`: its explicit legacy `Resolution` literal did not name the new optional field. The worker reproduced that failure, then added `goal_reflection_current: None` after the orchestrator widened the task scope. This preserves the fixture's existing opt-out semantics. Both the unchanged 14-test reflection suite and `cargo build --locked --example structure-adapter` passed. The amended declared check binds those two commands and includes the bridge source as an input; the earlier focused-only evidence remains historical.
