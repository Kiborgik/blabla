# Haiku handoff benchmark: A, B and the Condition C chain under BlaBla v0.4.2 (2026-09-14)

Frozen `claude-haiku-4-5-20251001` subjects. A and B are the frozen baselines of `manifest.json` (frozen 2026-09-14T09:42:59Z, results in `REPORT.md`, `results.md`). C ran fresh from the Stage-0 template under `manifest-C.json` (frozen 2026-09-14T19:14:43Z): the only inputs that differ from the A/B freeze are the BlaBla binary (0.4.2, self-describing runtime semantics) and the controller hash; contracts, references, packages, C prompts, C-AGENTS.md, requirements, scorers, canonical profile, template, model settings and Python are verified identical (`unchanged_from_baseline`). C1 to C4 ran strictly sequentially, each stage measured and scored before the next was prepared, with no other subject running. Raw runs: `runs/C-v042/stage-N`; tables: `results-v042.md`, `results-v042.json`.

## Headline

All three conditions preserved behavior through four handoffs with zero regressions. C is the only condition that also passed the architecture check at every stage (B failed it from Stage 3). C did so with the smallest supplied context, about 29% of A's and 38% of B's total input tokens, about a third of the cost, half the turns, one thirty-sixth of the changed lines, and no self-authored tests. The new runtime semantics were used exactly where the design predicted: in C1, `blabla explain runtime::restart` was what turned a persisted resonance field into a transient one. The C chain also exposed a completion-gate weakness: C2 and C3 never observed their `finish` result, because the subject gave the command a 30-second tool timeout and the harness moved the 60-second campaign into the background; C3 declared completion anyway.

## Cumulative

| Condition | Final Behavior | Final Architecture | Total Input Tokens | Cache Reads | Output Tokens | Cost | Time | Turns | Tools | Edit Rounds | Change Radius | Regressions Introduced | Regressions Remaining |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| A | PASS 106/106 | PASS | 8,546,626 | 8,351,271 | 105,872 | $1.776 | 974 s | 181 | 177 | 6 | 18 files, +2302/-8 (2,170 test lines) | 0 | 0 |
| B | PASS 106/106 | FAIL | 6,570,315 | 6,400,702 | 91,582 | $1.446 | 888 s | 160 | 156 | 4 | 22 files, +2267/-11 (1,963 test lines) | 0 | 0 |
| C (v0.4.2) | PASS 106/106 | PASS | 2,505,314 | 2,401,527 | 33,456 | $0.619 | 565 s | 91 | 86 | 7 | 9 files, +58/-6 (0 test lines) | 0 | 0 |

Total initial context over four sessions: A 71,747 B, B 22,468 B, C 4,715 B. Total input tokens are the CLI's aggregate usage (uncached input plus cache writes plus cache reads); the A/B wall-clock columns include contention from the concurrent chains of the original campaign, the C column does not.

## Per stage

| Stage | Cond. | Behavior | Arch. | Initial Context | Input Tokens | Cache Reads | Output | Thinking | Cost | Time | Turns | Tools | Edit Rounds | Files | Lines +/- | Old Checks Failing |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | A | PASS 87/87 | PASS | 15,480 B | 2,729,895 | 2,673,584 | 39,163 | 4,142 | $0.580 | 343 s | 56 | 55 | 3 | 5 | +398/-3 | 0 |
| 1 | B | PASS 87/87 | PASS | 4,897 B | 1,582,586 | 1,548,146 | 21,727 | 5,814 | $0.334 | 210 s | 46 | 45 | 1 | 5 | +370/-2 | 0 |
| 1 | C | PASS 87/87 | PASS | 1,102 B | 1,286,863 | 1,232,251 | 19,812 | 12,317 | $0.333 | 299 s | 37 | 36 | 4 | 3 | +22/-1 | 0 |
| 2 | A | PASS 96/96 | PASS | 17,084 B | 1,318,807 | 1,271,420 | 23,837 | 3,385 | $0.346 | 218 s | 34 | 33 | 1 | 6 | +1025/-0 | 0 |
| 2 | B | PASS 96/96 | PASS | 5,248 B | 1,227,945 | 1,183,393 | 22,157 | 4,932 | $0.320 | 212 s | 32 | 31 | 1 | 5 | +884/-0 | 0 |
| 2 | C | PASS 96/96 | PASS | 1,021 B | 332,219 | 318,502 | 3,925 | 1,395 | $0.080 | 78 s | 17 | 16 | 1 | 2 | +16/-0 | 0 |
| 3 | A | PASS 96/96 | PASS | 18,605 B | 730,924 | 708,370 | 7,226 | 1,768 | $0.158 | 65 s | 22 | 21 | 1 | 2 | +12/-5 | 0 |
| 3 | B | PASS 96/96 | FAIL | 6,063 B | 1,097,461 | 1,067,878 | 12,015 | 1,917 | $0.228 | 124 s | 31 | 30 | 1 | 6 | +267/-9 | 0 |
| 3 | C | PASS 96/96 | PASS | 1,528 B | 571,972 | 556,203 | 5,497 | 2,088 | $0.116 | 84 s | 20 | 18 | 1 | 2 | +11/-5 | 0 |
| 4 | A | PASS 106/106 | PASS | 20,578 B | 3,767,000 | 3,697,897 | 35,646 | 5,912 | $0.692 | 348 s | 69 | 68 | 1 | 5 | +867/-0 | 0 |
| 4 | B | PASS 106/106 | FAIL | 6,260 B | 2,662,323 | 2,601,285 | 35,683 | 5,821 | $0.563 | 341 s | 51 | 50 | 1 | 6 | +746/-0 | 0 |
| 4 | C | PASS 106/106 | PASS | 1,064 B | 314,260 | 294,571 | 4,222 | 1,721 | $0.091 | 104 s | 17 | 16 | 1 | 2 | +9/-0 | 0 |

Every C final workspace was also verified by the controller's canonical `blabla finish` with the frozen contracts: GREEN 302/302, 333/333, 333/333, 355/355. No C subject edited a contract (`contract-audit.json`, tampered false at every stage).

## Condition C stage by stage

| Stage | Handoff overhead (turns / tools / files / s before first edit) | BlaBla calls (status / explain / finish) | Progression | Subject's last observed gate | Disclosure |
| --- | --- | --- | --- | --- | --- |
| C1 resonance | 5 / 9 / 7 / 26.7 | 2 / 2 / 4 | STALE → RED 165/302 → RED 165/302 → explain rule → explain runtime::restart → RED 167/302 → GREEN 302/302 | GREEN (finish and status) | architecture.md, resonance.bla, persistence.bla, the five modules; explained `resonance::restart-resets-resonance` and `runtime::restart` |
| C2 echo | 5 / 10 / 6 / 23.5 | 1 / 0 / 1 | STALE → finish backgrounded, never observed | none; session ended waiting for a wakeup | architecture.md, echo.bla, four modules |
| C3 refactor | 9 / 9 / 6 / 22.7 | 3 / 0 / 2 | STALE → finish backgrounded → status STALE → finish backgrounded again | none; declared completion at STALE | architecture.md, the five modules, no contract (status only) |
| C4 recovery | 6 / 13 / 11 / 36.6 | 1 / 0 / 1 | STALE → GREEN 355/355 | GREEN | architecture.md, core/quarantine/recovery/resonance/sealing.bla, the five modules |

- **C1 (the runtime-semantics case):** the first `blabla status` at turn 1 (5.8 s) already listed `runtime::restart`. The subject read `resonance.bla` and `persistence.bla`, persisted resonance in the durable record, and got RED on `resonance::restart-resets-resonance` (minimal counterexample 3 actions). Its first repair added an application-level `restart` action to the protocol table and the domain, the exact conflation the semantics exist to prevent; the second `finish` was RED again with the same counterexample. It then ran `blabla explain resonance::restart-resets-resonance` (which printed `Depends on: runtime::restart` and `More: blabla explain runtime::restart`) and `blabla explain runtime::restart`, and its next message was "resonance should be transient, not persistent", followed by removing resonance from `DurableVault` and the store. One more RED on the rotate cap ordering (3-action counterexample), then GREEN 302/302 at turn 28 (213 s). Runtime-semantics discovery: dependency shown by explain yes, `explain runtime::restart` called yes, first visibility turn 1 tool 1 via `status`. Distinction: reached after the primitive explain, and evidenced by the final store; but the dead `"restart": ()` protocol entry and `Domain.restart` stayed in the tree and were inherited unchanged through C4 (no scorer looks at them).
- **C2, C3 and C4** never touched a restart-dependent rule (none of their new rules is a `when restart` rule), never called `explain`, and only saw `runtime::restart` in the `status` listing. Their restart-dependent obligations are all verified under the frozen profile (`runtime_semantics.restart_rule_obligations`), and no application line mentioning restart was added, so `distinguished_trusted_restart` is true for each of them by construction rather than by a decision.
- **C3 structural task:** BlaBla was STALE (implementation) and would have been GREEN; the subject performed the refactor exactly to the stated shape (`DURABLE_FIELDS` without `id`, keyed object, atomic write kept) and the architecture scorer passed. `behavioral_green_but_refactor_missing` false.

## Completion accuracy

| Stage | Subject invoked finish | Subject observed GREEN | Declared complete | Classification |
| --- | --- | --- | --- | --- |
| C1 | yes (4) | yes | yes | correct |
| C2 | yes (1, backgrounded by a 30 s tool timeout) | no | no: the final text is "I scheduled a check... Let me wait for the background task to finish" (the mechanical classifier flags the word "complete" in "complete soon"; read as no claim) | incomplete session, no false claim |
| C3 | yes (2, both backgrounded) | no (status STALE in between) | yes | incorrect completion claim: declared done while the gate was never observed and the record was STALE |
| C4 | yes (1) | yes | yes | correct |

Mechanism, verified in the transcripts: the subject passed `timeout: 30000` to its own shell tool for `blabla finish`; the harness moved the 60-second campaign to the background, the subject called `ScheduleWakeup` and ended its turn, and in `-p` mode the session ended there, killing the background campaign before it wrote a record (C2's and C3's final trees still carry the C1 record, recorded 19:19:32). The harness default and maximum tool timeout were 600 s in every condition; the subject's explicit per-call timeout overrides it. A and B never hit this because their pytest runs finish in seconds.

## Context and progressive disclosure

| | A | B | C |
| --- | ---: | ---: | ---: |
| initial context, four sessions | 71,747 B | 22,468 B | 4,715 B |
| first-turn context tokens (incl. ~21.7k baseline) | 25,377 to 26,671 | 22,850 to 23,221 | 21,743 to 21,877 |
| total input tokens | 8,546,626 | 6,570,315 | 2,505,314 |
| cache reads | 8,351,271 | 6,400,702 | 2,401,527 |
| output tokens (thinking) | 105,872 (15,207) | 91,582 (18,484) | 33,456 (17,521) |
| docs reread within a session | 0 | 0 | 0 |
| self-authored test lines | 2,170 | 1,963 | 0 |
| application lines +/- | +58 / -8 | +53 / -16 | +58 / -6 |
| verification attempts | 58 | 51 | 17 |

Project memory loaded by C, per stage: C1 two full contracts (the new one and `persistence.bla`, the latter unnecessary once `explain runtime::restart` was read) plus two explains; C2 one full contract (`echo.bla`), no explain; C3 status only, no contract; C4 five full contracts (core, quarantine, recovery, resonance, sealing) and no explain. `architecture.md` was read at every stage (the repository header names it). No stage read README, the skill file or project history. The pattern is: `status` is always the first call (turn 1, 4 to 6 s); the new contract file is read directly rather than through `explain`; `explain` is used only when a RED needs interpretation; the primitive explain was reached through the rule explain's `More:` line, not from the `status` listing.

Total input tokens track turns, as in every previous run: C's saving comes from fewer turns (no self-authored tests, one verification command instead of 8 to 22 pytest runs), not from smaller first-turn context.

## Findings

1. **Behavior survival:** A, B and C all 106/106 with zero regressions introduced or remaining at any stage.
2. **Architecture survival:** A and C PASS at every stage; B FAIL from Stage 3 (`id` in `DURABLE_FIELDS`), inherited by B4.
3. **Runtime semantics did the job they were built for, once:** C1's repair sequence goes from an application-level restart action (RED) to reading `runtime::restart` to a transient field (GREEN). The dependency was visible at turn 1 via `status` and the subject reached the primitive explain through the rule explain. The dead application `restart` entry it had added first was never cleaned up and survived three handoffs; nothing in the behavior layer can see it.
4. **Completion gate weakness:** a 60-second `finish` is long enough for the subject to background it under its own 30-second tool timeout and lose the result. Two of four C stages ended without an observed gate; one of them declared completion at STALE. The independent scorer says both were correct, so the gate's cost was a false "not verified", not a false GREEN.
5. **Rereading and recovery work:** none in any condition; C's per-stage handoff overhead (5 to 9 turns, 9 to 13 tools, 23 to 37 s before the first edit) is in the same band as A/B (2 to 9 turns, 6 to 9 tools, 15 to 33 s), so the tiny prompt did not add discovery cost.
6. **Harness:** C3 lost two tool calls to permission denials (a PowerShell conditional and a `cd && sleep` chain); the shared allow-list is unchanged from A/B.

## Validity

C ran under `manifest-C.json` with hashes verified at every prepare; the C template rebuilt under 0.4.2 is byte-identical to the frozen one (only the `.blabla` record differs, which the hash skips); the four stage references, previous references and mutations reproduce every frozen validation fact under 0.4.2 (`prep/validation-v042/validation.json`). No run directory reused, no steering, no repair, no contract edits. One run per cell; no statistical claim. A and B ran ten hours earlier under a concurrent campaign; C ran alone, so C's wall-clock is not contention-adjusted. The B3 architecture verdict and everything else about A and B are unchanged from `REPORT.md`.
