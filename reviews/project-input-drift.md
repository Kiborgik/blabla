# Project verification input differences

Implementation and documentation: actual gpt-6-astra/high, tasks `explain-project-input-drift` and `document-project-input-drift`. This is the bounded diagnostic recommended by the [nine-case nested-project investigation](nested-verification-drift.md), whose aggregate-only record description is historical. No new dependency framework or independence policy was introduced.

## Delivered behavior

The existing walker now produces an optional `Record.implementation_inputs` baseline during the same pass that computes the original aggregate. Input bytes, file ordering, exclusions, command extras and unreadable markers retain their existing aggregate meaning. `evaluate` still compares that aggregate to decide implementation staleness. The additional baseline only supports `recorded.input_drift` in status JSON and the corresponding human listing.

Rows use source/path identities so an explicit absolute command input cannot be confused with its project-relative tree observation. Added/removed/changed rows retain both observation values where present. Output is sorted and limited to 50 rows with the full difference count and omitted count; the stored baseline retains every observation. This is bounded presentation, not sampling evidence. [Current CLI examples and schema](../docs/project.md#explain-changed-verification-inputs) describe null and legacy values.

The diagnostic describes exactly what hashing observed. Small files use contents; files larger than 4 MiB use the existing length/mtime rule, falling back to length when usable time is unavailable. Unreadable files, metadata and directories retain distinct observation markers. A missing observation is not proof that a path was deleted. Neither the new view nor the existing aggregate can establish the meaning of a source change.

## Why the boundary stays broad

The completed isolated probe reproduced a parent task with current focused evidence and CLEAR assignment, yet stale project verification and refused closure after a disjoint child edit. Restoring the changed child bytes allowed closure without rerunning that task's check. More importantly, a parent application really imported a child helper: blanket child ignore left cached behavior GREEN even though a fresh run became RED. An explicit command-line child file remained tracked despite ignore, and parent-declared child structure was checked live.

Those nine cases establish why another manifest is not sufficient evidence of independence. The remedy delivered here identifies future observed inputs instead of discarding them. The prior 11:07 incident still has no recoverable exact historical path: records without the optional baseline report `legacy-unavailable`. A new run can establish only its own baseline. A short coordinated finish-and-close write pause remains a sound integration practice.

## Verification and limits

```sh
cargo test --locked --test project_input_drift
```

The implementation had a real prospective RED: its initial suite compiled against the old CLI, reached eight missing-field/text failures, and passed the original aggregate-byte compatibility assertion. The completed eleven-case suite covers:

- child file additions, removals and changes; sorted deterministic read-only status;
- external command-file changes/removal and explicit command inputs under ignore;
- ignored/internal files and separately tracked contract changes;
- legacy records without fabricated baseline or freshness credit;
- capped human/JSON output with complete counts and an untruncated saved baseline;
- unreadable file/directory observations when runtime permissions permit the denial;
- the original aggregate byte stream for normal files and the existing >4 MiB metadata path.

The final implementation log passed 11/11; the documentation task records its own declared run against the documented source. Permission tests are conditional where the runtime can bypass denial; the suite does not force or simulate a real denied filesystem read when the environment allows it. Metadata failures and concurrent filesystem races retain the old walker behavior; this focused suite is not an exhaustive race or platform matrix.

No broad root gate, performance benchmark, dependency completeness proof or source-authenticity claim follows from this suite. `status` does not write verification state, repair input changes, confirm claims or complete a task. Aggregate freshness, closure and `finish` authority remain unchanged. This documentation task edits only `docs/project.md` and this report; production source remains frozen for integration.
