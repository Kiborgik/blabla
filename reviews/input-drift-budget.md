# Per-input diagnostic resource sample

Author measurement: `gpt-6-astra`, high reasoning. Reproduce with the configured
Rust toolchain from the repository root:

```sh
python experiments/measure_input_drift.py
```

The standard-library-only probe creates three temporary projects, each with a
minimal real behavior application and 10, 100 or 1,000 ordinary 64-byte files.
It invokes the current source CLI through Cargo for fixture `finish`, unchanged
JSON `status`, then JSON `status` after changing every ordinary file in place.
No root verification or production source is modified. Fixtures are removed on
exit. Each command has a 120-second operational timeout, not a performance gate.

## Observed sizes

Local development sample, 2026-10-16 (bytes, UTF-8):

| Ordinary files | Baseline inputs | Baseline compact JSON | Full saved record | Unchanged status JSON | Changed status JSON | Total / shown / omitted deltas |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 10 | 12 | 1,390 | 5,791 | 1,901 | 3,995 | 10 / 10 / 0 |
| 100 | 102 | 11,650 | 21,541 | 1,901 | 12,197 | 100 / 50 / 50 |
| 1,000 | 1,002 | 114,250 | 179,041 | 1,901 | 12,199 | 1,000 / 50 / 950 |

The two additional baseline rows are `app.py` as a tree input and that same
application as an explicit command-file input. The probe asserts exact tree
membership, the command input, complete baseline counts, sorted displayed
paths, changed fingerprints, all delta counts, and implementation staleness.
Both status calls leave the entire saved record byte-identical. Thus the
50-entry display cap does not truncate the persisted fingerprint baseline.

The baseline JSON column measures compact serialization of the stored input
array; the record column measures the actual complete saved file, including
other verification evidence and formatting. It is not an old-version overhead
comparison. For this fixed-width fixture the array grows by 114 bytes per added
ordinary file, and the saved record by 175 bytes. Path lengths, observation kinds
and other project evidence change these figures.

An initial harness asserted identical changed-status sizes for 100 and 1,000
changes. That failed because the total and omitted count fields gained digits
(12,197 versus 12,199 bytes). The incorrect size-equality assertion was removed;
exact presentation and baseline-count assertions remain. This was a measurement
harness correction, not a product regression or prospective implementation RED.

## Timing and limits

Single development-sample wall-clock milliseconds, including Cargo checking and
process startup: fixture finish 107.268 / 113.242 / 165.634; unchanged status
105.411 / 164.080 / 104.018; changed status 112.212 / 117.341 / 112.296, in ascending
fixture-size order. These noisy local samples have no timing assertion, speedup
claim or comparison with an older implementation. The task's deciding log holds
fresh samples for the final script and report snapshot.

Presentation is bounded by row count; persisted metadata and current comparison
still cover all fingerprint inputs. This experiment measures serialized sizes
and whole-command time, not peak memory, isolated hashing cost, large-file or
unreadable-input cost, filesystem contention, or a production scale limit. The
1,000-file sample is evidence for this finite workload, not a general capacity
promise. Existing correctness tests separately cover original aggregate bytes,
large-file metadata, unreadable markers, exclusions and legacy records.

No remedy is justified by these sizes alone. Preserve complete baseline inputs
and existing verification authority; any future performance change should start
from a representative observed bottleneck and retain these soundness checks.
