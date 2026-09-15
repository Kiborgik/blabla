# Haiku handoff benchmark: results (2026-09-14)

Frozen `claude-haiku-4-5-20251001` subjects, four stages, manifest frozen at 2026-09-14T09:42:59Z (`manifest.json`), condition chains run concurrently with scoring overlapped (owner ruling; wall-clock columns include contention). Raw runs: `runs/<condition>/stage-<N>` (prompt, transcript, timeline, metrics, tool calls, diff, scoring); tables: `results.md`, `results.json`.

**Condition C is not reported.** Its packaging omitted a protocol fact that Conditions A and B received in prose (that `restart` is a trusted process restart and that the Stage 1 field is never persisted), so the C chain is invalid as a comparison and awaits a corrected rerun under a new freeze. This report covers Conditions A and B.

## Headline

Condition A (full prose) and Condition B (maintained summary) preserved behavior through all four handoffs with zero regressions. B failed the architecture check from Stage 3 on: its `DURABLE_FIELDS` includes `id`, the record key, so the refactor deviated from the stated shape while every behavioral instrument B had (its own tests, and the controller's canonical campaign) stayed green; B4 inherited it. No subject edited a contract.

## Cumulative

| Condition | Final Behavior | Final Architecture | Total Initial Context | Total Input Tokens | Total Output Tokens | Total Cost | Total Time | Total Turns | Total Tools | Total Edit Rounds | Total Files Changed | Total Lines +/- | Regressions Introduced | Regressions Remaining |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | PASS 106/106 | PASS | 71,747 B | 8,546,626 | 105,872 | $1.776 | 974 s | 181 | 177 | 6 | 18 | +2302 / -8 | 0 | 0 |
| B | PASS 106/106 | FAIL | 22,468 B | 6,570,315 | 91,582 | $1.446 | 888 s | 160 | 156 | 4 | 22 | +2267 / -11 | 0 | 0 |

"Regressions" count pre-existing checks (core, sealing, quarantine, and earlier stages' features) that failed after passing. Lines include self-authored tests: A 2,170 and B 1,963 test lines.

## Per stage

| Stage | Condition | Behavior | Architecture | Initial Context | Total Input Tokens | Output Tokens | Cost | Time | Turns | Tools | Edit Rounds | Files Changed | Lines +/- | Old Checks Failing |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | A | PASS 87/87 | PASS | 15,480 B / 25,377 tok | 2,729,895 | 39,163 | $0.580 | 343 s | 56 | 55 | 3 | 5 | +398 / -3 | 0 |
| 1 | B | PASS 87/87 | PASS | 4,897 B / 22,850 tok | 1,582,586 | 21,727 | $0.334 | 210 s | 46 | 45 | 1 | 5 | +370 / -2 | 0 |
| 2 | A | PASS 96/96 | PASS | 17,084 B / 25,776 tok | 1,318,807 | 23,837 | $0.346 | 218 s | 34 | 33 | 1 | 6 | +1025 / -0 | 0 |
| 2 | B | PASS 96/96 | PASS | 5,248 B / 22,947 tok | 1,227,945 | 22,157 | $0.320 | 212 s | 32 | 31 | 1 | 5 | +884 / -0 | 0 |
| 3 | A | PASS 96/96 | PASS | 18,605 B / 26,174 tok | 730,924 | 7,226 | $0.158 | 65 s | 22 | 21 | 1 | 2 | +12 / -5 | 0 |
| 3 | B | PASS 96/96 | FAIL | 6,063 B / 23,161 tok | 1,097,461 | 12,015 | $0.228 | 124 s | 31 | 30 | 1 | 6 | +267 / -9 | 0 |
| 4 | A | PASS 106/106 | PASS | 20,578 B / 26,671 tok | 3,767,000 | 35,646 | $0.692 | 348 s | 69 | 68 | 1 | 5 | +867 / -0 | 0 |
| 4 | B | PASS 106/106 | FAIL | 6,260 B / 23,221 tok | 2,662,323 | 35,683 | $0.563 | 341 s | 51 | 50 | 1 | 6 | +746 / -0 | 0 |

Total input tokens are the CLI's aggregate usage (uncached input plus cache writes plus cache reads over every API call). Every final workspace was also verified by the controller's canonical `blabla finish` with the frozen contracts: A and B GREEN at every stage (302, 333, 333, 355 obligations).

- **Behavioral GREEN mistaken for task completion (Stage 3 question):** B3 completed the refactor with `id` inside `DURABLE_FIELDS`; its own tests passed, behavior stayed intact, architecture FAIL, B4 inherited it. A3 matched the stated shape.

## Workflows

- **A (full prose):** every stage opened with `Glob`/`ls`, read the five modules (5 files before the first edit, 16 to 21 s), edited domain and protocol, then wrote and ran its own test files (2 to 3 per feature stage, 375, 937 and 858 lines) with 11 to 22 `python` verifications; Stage 3 was 22 turns and 65 s with no tests. No documentation was reread within a session; the prompt carried it.
- **B (summary):** same shape as A with a shorter prompt: 5 to 7 files before the first edit, own tests every stage (351 to 871 lines), plus a `REFACTOR_SUMMARY.md` and a `RECOVERY_IMPLEMENTATION.md` left in the tree. B3 kept `id` in `DURABLE_FIELDS` (records carry the key twice); B4 built recovery correctly on top of it.
## Context

| | A | B |
| --- | ---: | ---: |
| initial context, four sessions | 71,747 B | 22,468 B |
| first-turn context (tokens, incl. ~21.7k baseline) | 25,377 to 26,671 | 22,850 to 23,221 |
| total input tokens | 8,546,626 | 6,570,315 |
| docs reread within a session | 0 | 0 |
| summary maintenance | | 4,314 → 5,715 B; +29/-24, +12/-10, +24/-13 lines |
| self-authored test lines | 2,170 | 1,963 |
| application lines +/- | +58 / -8 | +53 / -16 |

Both conditions spent their context up front in the prompt and then in their own tests; neither reread documentation within a session. Total input tokens track turn count, as in the single-feature benchmark.

## Findings

1. **Architecture is outside the behavior layer:** B3's `id` in `DURABLE_FIELDS` passed every behavioral instrument B had; the architecture scorer alone caught it, and B4 inherited it. Evidence for the structure-layer question, as the owner framed it.
2. **Harness:** the shared allow-list denied every piped command (`| tail`, `| grep`) in every condition. Recorded, equal across conditions.

## Validity

The A and B cells ran under the frozen manifest; hashes verified at every prepare; no run directory reused; no steering, no repair. Deviation from the original plan, ruled by the owner before launch: condition chains ran concurrently with scoring overlapped, so wall-clock columns include contention. One run per cell; no statistical claim. The B3 architecture verdict rests on the frozen scorer's reading that `id` is the record key, not a durable field; the task text says "keyed by vault id" and "exactly the durable vault fields". Condition C is excluded for the packaging gap stated at the top; its raw runs remain under `runs/C` for audit only.
