# Bounded history page review

Independent source review by the orchestrator, actual `gpt-6-astra/xhigh`, 2026-10-16. Reviewed `bound-decoded-history-pages`; no production edits.

## Result

No blocking defect found in the assigned read-only history change. The metadata query chooses a contiguous revision prefix before payload hydration, using existing `(world_id, end_revision)` indexing. The second query requests exactly that selected range/count and checks every returned revision. Sequential decoding retains the shared codec and canonical state validator, including row/state revision agreement.

Input selection charges actual SQLite UTF-8 bytes for raw frames and ancillary JSON, and a conservative decoded-size allowance for encoded frames. Output accounting separately measures complete serialized entries, separators and page framing. A rejected output entry is not consumed: the cursor remains the last emitted revision, so the next request can recover it. Both targets are 1 MiB; a first valid oversized complete entry remains an explicit singleton compatibility exception. The encoded-envelope hard limit is checked before its selected payload is hydrated.

No writer, schema, retention policy, authorization, release gate or simulation behavior changes. Public response redaction remains outside the repository; budgeting the larger internal entry is conservative. Reading does not realize time or create receipts.

## Evidence inspected

Read the budget helper, repository query/decode path and all added hosted boundary tests. Read the complete author log `.blabla/scratch/bound-decoded-history-pages/evidence-1-5-1792157265988510842.log`: 78 tests passed. The review's declared repeat is the same bounded history-budget/hosting suite; its exact receipt is recorded by BlaBla.

The fixtures exercise actual SQLite query plans without a temporary sorting tree, UTF-8 rather than JavaScript character counts, raw/encoded mixtures, page wrapper overhead, ancillary metadata, malformed metadata, missing/mismatched hydrated rows, output expansion, cursor continuity and zero database changes. Synthetic size padding is explicitly a test workload. One four-frame CJK workload hydrates two rows with 826,560 source UTF-8 bytes and 826,771 serialized output bytes. Mixed history fixtures replay genuine engine transitions; they do not establish public hosted deployment behavior.

## Limits and follow-on

This is a byte/row target, not a hard heap, CPU, codec-native-buffer or provider-quota guarantee. The first oversized legacy singleton can exceed both targets. At most one additional decoded candidate can be rejected by the output budget; already selected input rows are still retained within the separate input target or singleton exception.

The two queries are not represented as one database snapshot. Existing transition history is append-only; range/count/revision validation catches missing or mismatched hydration. A concurrent append can make the earlier metadata page's `hasMore` immediately old, which is ordinary read-time pagination behavior, not lost history. No new claim about managed Sites replication is made.

The next useful step is exact accepted-snapshot deployment and bounded read-only runtime verification. Any encoded writer or retention change needs its own compatibility decision and migration evidence; this reader does not authorize either. Current source acceptance does not resolve the unrelated uncertain Verdant command, permit retrying it, or activate any game release.
