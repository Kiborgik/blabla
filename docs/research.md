# Research

BlaBla started from a simple question: **how much project context can be moved out of an agent's working context and into executable project memory without making the agent worse at the job?**

The results here are early observations, not statistical claims.

## Haiku handoff benchmark (2026-09-14)

A synthetic Python project, Glyph Vault, was extended over four fresh-context sessions of `claude-haiku-4-5-20251001`.

Each condition received the same underlying intent in a different form:

| Condition | Each fresh session received |
| --- | --- |
| A | task + growing full prose: requirements, architecture and recorded decisions |
| B | task + maintained compact human summary |
| C | task + generated `AGENTS.md`; the repository carried `project.bla`, contracts and `blabla finish` |

Every stage was scored independently with black-box behavior checks and a separate architecture check. The final stage had 106 behavior checks.

| Condition | Final behavior | Final architecture | Aggregate input tokens | Cost | Time | Turns | Tools | Change radius |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| A — full prose | PASS 106/106 | PASS | 8,546,626 | $1.776 | 974 s | 181 | 177 | 18 files, +2302/-8, including 2,170 self-authored test lines |
| B — human summary | PASS 106/106 | FAIL from stage 3 | 6,570,315 | $1.446 | 888 s | 160 | 156 | 22 files, +2267/-11, including 1,963 test lines |
| C — BlaBla 0.4.2 | PASS 106/106 | PASS | 2,505,314 | $0.619 | 565 s | 91 | 86 | 9 files, +58/-6, 0 test lines |

In this run, the BlaBla condition preserved behavior and architecture with zero regressions while using about 29% of A's aggregate input tokens, 35% of its cost, 58% of its wall time and roughly half its turns/tools.

The interesting part is where the saving came from: not the first prompt. The initial context sizes were relatively close once the coding-agent system prompt was included. The difference came from fewer turns and fewer verification loops. A and B wrote and debugged their own tests; C used the existing executable contracts and completion gate.

### Threats to validity

- one model
- one synthetic project
- one chain per condition
- project, contracts, prose and summaries were written by the same author
- A/B were run earlier than the final C rerun, although the benchmark inputs were frozen
- wall-clock time is descriptive rather than a contention-adjusted measurement

So the table is an observation to reproduce, not evidence that BlaBla will save 71% of context in general.

## Other observations

- **Small-model diagnostic.** Qwen3 4B reached 47/50 behavior with zero regressions once onboarding named the CLI. A diagnostic, not a benchmark: a profile flag changed the frozen hash. Its lasting lesson: a 4096-action campaign made 518 `seal` calls and never reached a state where sealing was allowed, yet passed. That is why YELLOW exists: "nothing broke" and "the behavior was exercised" are different claims
- **Benchmark failures that became features.** One chain passed every behavior check but kept the record id among durable fields; another left a dead restart method. So v0.5 added structure contracts. An agent could also background a long `finish` and move on, so v0.5 added VERIFYING, progress and INTERRUPTED
- **Real-project use (0.10).** On two game projects, reviewers working through BlaBla tasks found defects that passing tests had missed; findings, failing reproductions and stale evidence stayed in the record until fixed. One review found a BlaBla freshness bug, which was fixed. No speed-up or less rework was measured, and the expert layer was not used

**Method rule for memory comparisons**: give both arms the same explicit CLI onboarding, and change one variable at a time; only the memory under test may differ.

**Reproducing.** The curated package is under [`research/haiku-handoff/`](../research/haiku-handoff/): frozen method, prompts, contracts, scorers and results, without raw transcripts. Useful replications: another model, another project, several chains per condition, a tests-plus-prose baseline.

## Model-size hypotheses

**Not measured.** Recorded so a later experiment can aim at a stated claim.

| Agent | Hypothesised value of BlaBla |
| --- | --- |
| Small model | capability scaffolding, precise feedback, reliable completion |
| Medium model | reliability, less search and self-authored verification work |
| Large model | project-memory compression, handoff continuity, less rereading |
| Orchestrator | continuity of goals, role boundaries and handoffs across fresh contexts |

The benchmark tested one model at one size; nothing here separates these cases. Whether memory kinds help across fresh contexts and model sizes is still open. The 0.10 expert layer's real calibration found no feasible policy, so its benefit is unshown. [Expert](expert.md)
