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

## How a memory-utility comparison is set up

Two rules govern every comparison that asks whether a memory kind helps. Both were learned from
runs in this repository, and neither changes any result already recorded above.

**Explicit CLI onboarding is held constant, never treated as the thing under test.** An agent that
is merely near BlaBla may ignore it; that was established early and does not need re-establishing.
So a memory comparison is

```text
A = explicit working BlaBla CLI + baseline memory
B = explicit working BlaBla CLI + the memory under test
```

and onboarding is identical in both arms. Whether an agent discovers the CLI unprompted is a
separate question, studied on its own, and mixing it into a memory comparison makes the result
unattributable.

**One meaningful variable changes at a time.** Model, tools, code-intel availability, task, CLI,
onboarding, repository baseline and environment are fixed; only the memory under investigation
differs. An arm that also changes the model family, the prompt or the tooling produces a number
that no longer belongs to the memory.

## An earlier small-model diagnostic

A Qwen3 4B run on the sealing reference finished at 47/50 behavior with zero regressions once the
onboarding named the CLI explicitly. It is a diagnostic rather than a benchmark, because a
UI-only profile flag changed the frozen hash.

Its lasting result was a verifier weakness, not a score: a 4096-action campaign made 518 `seal`
calls and never once reached a state where sealing was eligible. The verifier of the day could
therefore report PASS without ever exercising the feature under test. That observation is the
origin of the GREEN/YELLOW distinction and of coverage-guided verification — YELLOW exists because
"no violation found" and "the behavior was exercised" turned out to be different claims.

## What the benchmark changed in BlaBla

Two failures in the benchmark became product features.

First, runtime behavior can be correct while the requested codebase shape is wrong. One chain passed every behavior check but kept the record id inside the durable-field set after a persistence refactor. Another left an obsolete application-level restart method behind after repairing the runtime behavior. This is why v0.5 adds `structure.bla`: `BEHAVIOR GREEN` can now coexist with `STRUCTURE RED`, and `OVERALL` remains blocked.

Second, long verification runs need an observable completion gate. In the benchmark, an agent could background a long `finish` command and continue without seeing the result. v0.5 prints `VERIFYING` immediately, emits progress, records the active run, and reports `INTERRUPTED` rather than leaving a stale GREEN if the run dies.

## Reproducing

The curated package is under [`research/haiku-handoff/`](../research/haiku-handoff/). It includes the methodology frozen before the subjects ran, manifests, prompts, contracts, scorers, references and result tables.

Raw model transcripts are not included in the repository.

Useful replications:

- another model
- another project/domain
- several chains per condition
- a fourth baseline using conventional tests plus prose
- another application language once a structure provider exists

## Model-size hypotheses

**Hypotheses, none of them measured.** They are recorded so that a later experiment can aim at a
stated claim rather than a vague expectation.

| Agent | Hypothesised value of BlaBla |
| --- | --- |
| Small model | capability scaffolding, precise feedback, reliable completion |
| Medium model | reliability, less search and self-authored verification work |
| Large model | project-memory compression, handoff continuity, less rereading |
| Orchestrator | continuity of goals, role boundaries and handoffs across fresh contexts |

The handoff benchmark above tested one model at one size. Nothing in this repository separates these
four cases.

## Broader hypothesis

BlaBla's long-term hypothesis is not simply "tests for agents." It is that selected project intent can live outside transient chat context as executable, queryable memory.

The current implementation covers behavior and structure. Higher-level process/orchestrator and mission layers remain research directions rather than shipped features.
