# Goal links, current claims and the next useful decision

Documentation: actual gpt-6-astra/high, task `document-goal-workflow`. Goal coverage was implemented by gpt-6.1-sol; gpt-6-astra reviewed its acceptance and implemented reflection and changed-input explanation. These are three additions to the existing task/goal lifecycle, not another planning framework.

## Use the delivered surfaces together

1. `explain goal::NAME --json`: inspect exact expected identities, registration and real verdicts, then explicitly goal-linked tasks and their tracked evidence. A broad contract link is not a complete implementation map. Draft or missing rules receive no inferred credit; unreadable task records remain visible.
2. `task show NAME --json`: inspect affected-intent receipts and their `freshness` differences before reassessing claims. Shared revision changes can stale all receipts while their own identity fingerprints remain unchanged. Record genuine reasons; the explanation never confirms them.
3. For a feature opened with a named goal and `--require-goal-reflection`, use `task reflect` after evidence and dispositions are current. Record an observed result and the reason it supports a bounded successor, concrete blocker, completion recommendation or justified stop. Then challenge and hand back. The owner still decides outcome acceptance and successor scope.

[Current workflow and CLI examples](../docs/agent-workflow.md) cover flags and ordering. [Reflection design](goal-reflection.md) records persistence, compatibility and the legacy bridge repair. A reflection reference is an inspectable claim, not a verified citation; the command validates structure, not reasoning quality.

## Prior research and the smaller implementation

The pinned [Spec Kit research](spec-kit-inspiration.md) recommended explicit references, live authority and visibility over existing resolvers. Its proposed broad coverage analysis was research, not a delivered semantic auditor. The implemented view uses existing `goal.expect`, exact identities, real verdicts and explicit task goals. It does not infer requirement/task matches, score semantic coverage or mutate goals. The separate [registration inventory](contract-inventory.md) finds forgotten `.bla` candidates without activating them.

Repeated dogfooding receipt refreshes were a real cost, but the stored records supported explanation before weakening freshness. In `examples/agentic-mmo/.blabla/tasks/allow-independent-agent-actions.json`, two 25-receipt batches in one epoch shared assignment and identity fingerprints; the aggregate `core` input changed. Other recorded batches changed acceptance epoch and opaque assignment digest without changed path/identity fingerprints. An epoch change alone cannot identify every changed assignment field. The full shared revision comparison is deliberate; this evidence does not establish that each identity can safely have narrower dependencies.

The additive `affected_intent[].freshness` projection distinguishes changed path/identity keys from missing observed digests, reports epoch/opaque assignment changes and malformed claims, and preserves the existing `disposition_current` predicate. Directory fingerprints cannot recover child-file changes. No source diff, auto-confirmation or semantic independence claim is invented.

## Concrete dogfooding: Cultivation reached a dead end

The Creative Director's recorded official observation at revision 48 found Pelagos with Cultivation complete, 12.31 unused science, fields and an artisan quarter, but no further released research target. The [roadmap observation and R03b](../examples/agentic-mmo/ROADMAP.md) and [connected-choice design](../examples/agentic-mmo/DESIGN.md#the-next-connected-choices) preserve the evidence and recommendation.

The causal bridge is specific: completing the first discovery exposed unused research capacity, so prepare Water management → irrigation works and Kiln firing → kiln. Both depend on one shared operating-input rule, explicit owned-building pause/resume, opening-stock funding and release activation. The proposed owner is the simulation/content implementer with orchestrator-owned types, contracts and release. The observable result is a genuine agent choosing a released branch, followed by exact paid inputs/output or an explicit blocked reason. Prepared catalogue entries alone do not establish that result.

The planning task recorded this as a note because it had not opted into reflection; its attempted `task reflect` was refused. No reflection receipt was fabricated. A future opted-in feature can use the CLI example, but a recommendation is not permission to open overlapping work or evidence of live deployment. Review once per meaningful feature/discovery/dead end; stop when no useful authorized next step follows.

## Bounded successor research: project snapshot and closure

On 2026-10-16 at 11:07 UTC, the orchestrator's root `finish` reported OVERALL GREEN: 321 structure rules, 177 behavior rules, 343 campaign obligations and 4,096 actions. In its immediately chained closure sequence, `explain-goal-coverage` closed; `explain-intent-input-changes` then refused closure. The orchestrator's 11:08 challenge reported assignment CLEAR with current focused evidence and dispositions, but a project `verification-not-current` challenge because implementation had changed since the recorded run. This worker read `/tmp/root-finish-1107.log` and `/tmp/input-explain-now.json`; the latter had no non-current affected-intent row. These temporary records are session evidence, not durable release artifacts.

Concurrent example core/server work continued during the interval. That establishes global snapshot/closure coupling, not which path caused it or a fingerprint implementation defect. A useful separately assigned investigation would capture the recorded/current project input maps and exact closure challenge, identify the responsible path at the granularity actually stored, and reproduce the boundary with disjoint task scopes. Prospective cases: unchanged project allows both closures; a true project input change invalidates project verification while bounded receipts stay current; task-local input changes still invalidate the task; declared ignored/non-input changes follow the existing policy. Investigate whether better diagnostics or an integration scheduling boundary suffices before proposing any dependency change. This documentation does not alter closure or freshness gates.

## Verification limits

The declared documentation-task check is:

```sh
cargo test --locked --test goal_coverage --test goal_reflection --test intent_disposition_explain
```

These suites exercise 9 coverage, 14 reflection and 11 explanation cases. They cover exact/draft/missing links, real verdicts and unreadable records; four reflection outcomes, opt-in compatibility and invalidation; per-receipt deltas, absent keys versus missing digests, malformed claims and read-only determinism. They do not validate prose truth, source authenticity, live MMO deployment or semantic goal completion. The task records the actual check result. Current CLI help and implementation were read to check examples; only the two documentation paths changed. The orchestrator owns integration and the canonical gate.
