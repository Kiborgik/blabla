# Bounded-result standalone campaign

Author: `gpt-6-astra` (high), `measure-bounded-contract-campaign`.
Measured 2026-10-16, 15:12:48–15:14:08 UTC.

## Observed result

The single authorized finite campaign exited **0**, reporting **37/37 obligations
GREEN**, no YELLOW or RED, **128/128 actions** and **2/2 cases**. The complete
stdout/stderr receipt is
`.blabla/scratch/measure-bounded-contract-campaign/evidence-1-41-1792163568460511501.log`.
It was read in full. No invocation, adapter, timeout or protocol error occurred.

Executed from the repository root, using current source:

```sh
cargo run --locked --quiet --bin blabla -- run contracts/bounded-results.bla \
  --seed 0 --cases 2 --steps 64 --timeout-ms 5000 --shrink-budget 32 -- \
  cargo run --manifest-path /workspace/shared/blabla-agentic-mmo/Cargo.toml \
  --locked --quiet --example structure-adapter
```

This is supplementary draft-contract evidence. The canonical 8×512 profile was
not run or changed; the contract remains draft. No seed search or repeated
campaign was used to improve coverage. The sequential bridge comparisons retain
their limits: the separate sixteen exact-core checkpoint tests support final
reread resistance, rather than this campaign proving a race occurred.

## Cost and persistence

The external before/after hash-file timestamp bracket is **79.859 seconds**,
including source invocation, measurement and evidence-recording overhead. It is
not the unavailable internal `RunReport.metrics.elapsed_ms` value. The adapter
logged 128 successful probe calls. Their printed action timings exclude outer
JSONL overhead and have integer-millisecond precision; they are finite local
observations, not worst-case guarantees. All remain below the unchanged 4,500 ms
internal action deadline and 5,000 ms request allowance.

| Probe action | Logged calls | Observed range | Mean |
| --- | ---: | ---: | ---: |
| `bounded_result_fixture` | 28 | 661–1,046 ms | 763.6 ms |
| `bounded_success_fixture` | 27 | 661–972 ms | 734.6 ms |
| `ordinary_success_fixture` | 15 | 667–782 ms | 718.7 ms |
| `accept_bounded_result` | 29 | 425–550 ms | 466.7 ms |
| `accept_ordinary_result` | 29 | 410–996 ms | 473.2 ms |

Logged action intervals total 79.255 seconds. The first ordinary close includes
its genuine lazy initialization, as defined by the owner-approved composite
action; later closes can operate on already prepared or terminal fixtures.

The text renderer prints action/case totals but omits reset and replay metrics.
Their exact counts are **unavailable from this receipt**; they are not inferred
from the case count or timing lines. No JSON rerun was made merely to fill those
fields. The earlier 152-reset observation belongs to the separate historical
root campaign and is not a count for this run.

Root `.blabla/status.json` SHA-256 before and after was identical:

```text
d5b17d051922abd464a01cf38aeaec3a6b824f39035ad9391292900a6501fb4e
```

External receipts are `/tmp/bounded-campaign-status-before.sha256` and
`/tmp/bounded-campaign-status-after.sha256`. The standalone file-run path emits a
behavior report with no project record; isolated fixtures still execute genuine
canonical checks and task decisions in their own temporary projects. No root
GREEN record or task evidence was fabricated by the adapter.

## Acceptance boundary

The finite result supplies real positive/refusal coverage within this declared
budget, and shows that deliberate fixture use remains materially expensive.
It does not predict full mixed-profile cost or grant project completion. Owner
review and promotion remain separate decisions; no timeout/profile reduction is
recommended. Source stayed frozen throughout.

The owner-authorized final task check is source contract syntax only. Its later
receipt validates current syntax after this report is written; the preserved
finite campaign above remains the behavioral and cost evidence. This separation
avoids rerunning an unchanged campaign solely because its report deliverable was
written after measurement.
