# Explicit review execution reuse

Actual gpt-6-astra/high implementation, 16 October 2026. The accepted diagnosis is `reviews/receipt-only-review-repin.md`; its dated growth-review evidence remains unchanged.

## Delivered source boundary

`task accept REVIEW --reuse-evidence --reason TEXT --model MODEL` shares the ordinary in-memory acceptance/repinning operation. The opt-in private module requires an ACCEPTED/READY explicit review, the same still-permitted accepted model, nonempty reason, no unresolved decision/falsification obligation, and the latest evidence entry being an actual successful current-epoch argv run. Manual, missing legacy provenance, failed latest evidence and chained reuse refuse. Ordinary acceptance, readiness and both closure predicates are unchanged.

The complete recorded input map must exactly equal the current observable map, including reports and membership. Every recursive target's scope, declared inputs, deliverables and recorded claim/review artifact paths must be covered by an unchanged selected input. Directory selection can cover descendants; selecting a few children does not infer complete coverage of a parent scope. Targets must exist, remain non-withdrawn/acyclic, and retain permitted accepted-model authority. A source task's renewed claim is rereviewed manually; no opaque digest is treated as semantic equivalence.

The original evidence is immutable. A new entry has `tool: reuse`, the new epoch and optional typed provenance, while retaining the original execution timestamp/check/argv/exit/input map/tree/log. Provenance records original zero-based index, original record/epoch/log digests, attesting model, reason and reuse time. Text and JSON distinguish the two events. The original task-local log is streamed twice with an 8 KiB buffer and cannot escape its scratch directory through a symlink. No second ledger or historical reconstruction was added. Digests inherit the existing non-cryptographic local-record trust boundary.

Before the write, actual Project/process, task, original evidence/log, tracked inputs and recursive source records/revisions are reloaded. Both eligibility and inspected context must match, including otherwise valid concurrent updates. The ordinary store/build stamp is retained. No global filesystem atomicity is claimed. New epoch/context invalidates old semantic receipts through the existing mechanisms; no verdict/claim/disposition is auto-confirmed. Partial residuals survive either source closure mode.

## Prospective and development evidence

- `/tmp/review-reuse-red.log`: first prospective run, one ordinary-accept control passed; six missing-option failures and two fixture setup errors. The latter mistakenly tried manual exit evidence against an argv check and changed a tracked check before recording a new failure.
- `/tmp/review-reuse-red-corrected.log`: corrected prospective run, one control passed and eight genuine missing-option failures. Later loop iterations were still prospective at that point.
- Development subsequently exercised the actual positive operation, original-run provenance and byte-preserving refusals. One assertion initially expected a nonexistent task-show readiness property; it was corrected to call the actual shared readiness function on the serialized record/current tree. A bounded-close test initially used the wrong flag; it now uses the existing `--bounded` surface.
- The private race matrix uses the production inspect/record path with a test-only checkpoint. Its initial malformed-cycle control was replaced with a structurally valid cyclic review edge. An actual disposition race first lacked its explicit opt-in; the fixture now declares that obligation before execution.

The final declared receipt is recorded only after this report and the final focused cases are stable. CLI cases include real successful ACCEPTED/READY reuse, unchanged default acceptance, full-map/check/membership/source/artifact/report/model/log/falsification refusals, text/JSON provenance and same-goal source-isolated manual verdicts. A real isolated canonical GREEN is preserved byte-for-byte by reuse. Ordinary and bounded closure in both source orders retain both Partial residuals. No root campaign was run.

## Limits and integration

The later actual growth-review record is still ineligible: its report digest and command changed. Only the earlier conditional checkpoint, before those changes and before ordinary epoch advancement, could have qualified. The historical manual existence continuation remains an explicitly authorized narrower receipt supported by independent inspection; this feature does not backfill it.

Optional `Evidence.reuse` required mechanical `None` initializers in existing task-evidence constructors. `bridge/goals.rs` and `tests/goals.rs` use skeptic evidence and needed no change. Existing expert routes that require a newly captured `tool: run` remain strict; reuse is not relabeled as a fresh expert execution. Contract binding/promotion and publication remain owner decisions.
