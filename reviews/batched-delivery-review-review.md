# Explicit batched delivery review: independent verdict

Reviewer: Astra/high, 2026-10-16. I did not author this tooling implementation. I authored unrelated simulation code and earlier bounded tooling reviews. This review is report-only and concerns the assigned explicit multi-source delivery change.

## Verdict

No bounded source blocker found. The patch permits one explicitly assigned review to carry distinct source verdicts without converting that review into automatic source closure or goal completion. Owner composition remains a subsequent action.

I inspected the complete retained pre-edit diffs for `src/cli/task.rs`, `src/cli/mod.rs` and `src/cli/task/delivery.rs` under `/tmp/batched-review-before`, and the current project record/revision, bounded acceptance and READY refresh integrations. The other files have current-source inspection rather than a claimed retained pre-edit baseline. I read the prospective contract, author report, workflow documentation and all eighteen CLI cases, including their real command helpers and full-tree refusal comparisons.

## Deciding source boundaries

- Additional sources are declared at opening, require a primary review, and reject missing, withdrawn, duplicate, self or cyclic targets before storing. The path-local active set rejects cycles while the completed set permits a shared ancestor. Acceptance pins every direct source; currentness traverses every recursive edge.
- `--source` must name an explicitly assigned source. Omission selects the primary only. Replacement compares resolved source identity, goal and exact residual origin, so an accept/reject for a same-goal secondary cannot replace or satisfy the primary verdict.
- Empty additional targets are omitted in serialized legacy records and in the assignment digest. An ordinary singular writer without explicit selection still omits `source_task`; absent historical fields resolve only to the primary. The compatibility case observes an actual writer result and retains its bytes, rather than mutating closed JSON after its challenge.
- Delivery recording reloads the real manifest/process/task and all target records twice. It compares complete inspected target records, authority, observation artifacts and current eligibility before storage. Private tests reach that production checkpoint and retain concurrent note, claim, artifact, input and authority changes on refusal.
- Ordinary closure reloads delivery authority and reruns `inspect_close`; bounded closure repeats its complete inspection and compares task, review, delivery, canonical verification and structure contexts. Both require accepted current independent reviews. Separate source closures work in either order while Partial residuals remain.
- Close context fingerprints every referring review record, but traverses its source graph only when it is the task being closed or a closed, current review contributing authority. An unrelated OPEN review with a withdrawn additional target therefore cannot veto an otherwise accepted source. A contributing batch still carries its other source into both final rereads.
- READY manual refresh reuses the shared recursive edge collector with relevant revisions, preserving its existing closure-only metadata allowance. It does not silently repin stale targets. Model and owner authority checks remain in place.
- Exact later Delivered resolution still binds the closed Partial/Blocked origin task, goal and claim digest. The secondary-origin case preserves both closed source files and leaves the primary residual visible. No test result substitutes for a human-visible delivery observation.

## Evidence and limits

The genuine initial boundary remains one legacy pass and eleven missing-option failures. Later downstream assertions were prospective at that point. The author also retained the failed legacy-fixture attempt and the reproduced unrelated-OPEN-review refusal; their fixes are represented by actual compatibility and close-path cases.

The final author receipt is `.blabla/scratch/specify-batched-delivery-review/evidence-4-2-1792190782201199394.log`: 73 binary cases and 18 CLI cases pass. I scanned the complete 3,803,061-byte, 12,893-line result/diagnostic stream and parsed all 905 JSON records without malformed JSON. The verbose repeated fixture displays exceed a single tool response, so I do not describe a truncated display as a full raw-log read. All test results, summaries and unique failure diagnostics were inspected; expected refusal diagnostics belong to positive adversarial tests, including the deliberate internal-panic control.

The independent deciding command is only `cargo test --locked --test batched_delivery_review`, recorded after this report. Its full small log and actual child exit are authoritative for the reviewer run. No binary suite, product gate, simulation suite or live outcome is rerun or claimed here.

The finite fixtures exercise actual CLI persistence, explicit assignments and byte-preserving refusals. Runtime/viewport references inside those fixtures are honestly synthetic. Model names are process attestations, not authentication. These results establish the bounded source behavior; they do not establish universal race freedom or completion of the user's live delivery goals.

## Lenses and next decision

Reviewing: source diffs and sibling positive/negative paths support the verdict, rather than the report alone. Engineering: one shared graph/currentness path extends existing records and final rereads. Testing: real parser/lifecycle controls, no-op checkpoint controls and exact byte comparisons distinguish refusal from setup failure. Design: explicit assignment and resolved source identity keep responsibilities small and avoid a parallel delivery ledger.

Recommend owner acceptance of this bounded implementation, then use the explicit batch surface for a genuinely inspected multi-source outcome. Retain each source's individual claims and residuals until its own current independent evidence supports resolution.
