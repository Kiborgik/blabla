# Context and executable-memory research notes

BlaBla's working thesis is that some project intent can move out of fragile model context and into small executable contracts that agents query only when needed.

v0.5 implements two layers:

```text
STRUCTURE
    ↓
BEHAVIOR
    ↓
IMPLEMENTATION
```

Possible future layers are `process` and `mission`; they are not implemented.

## Evidence so far

### Small-model diagnostic

In an earlier Qwen3 4B diagnostic, explicit CLI/help onboarding changed the agent workflow substantially: the agent read the contract, ran BlaBla, finished at 47/50 behavior with zero regressions, used 22 tool calls and two edit rounds, and produced a +19/-3 patch. That run is diagnostic rather than a strict benchmark because a UI-only profile flag changed the frozen hash.

The same experiment exposed an important verifier weakness: a 4096-action run made 518 `seal` calls but never reached an eligible sealing state. The old verifier could therefore PASS without meaningfully exercising the feature. That led to the current GREEN/YELLOW distinction and coverage-guided verification.

### Haiku fresh-context handoff benchmark

The stronger result is the four-stage Haiku handoff benchmark documented in [research.md](research.md). The BlaBla condition preserved final behavior and architecture with zero regressions while using fewer turns, tools, input tokens and cost than the full-prose and human-summary conditions in that single experiment.

The current research question is therefore broader than prompt size:

> How much project reconstruction work can executable project memory remove across fresh-agent handoffs?

## Model-size hypotheses

These remain hypotheses:

| Agent | Possible value of BlaBla |
| --- | --- |
| Small model | capability scaffolding, precise feedback, reliable completion |
| Medium model | reliability and reduced search/verification work |
| Large model | project-memory compression, handoff continuity, less rereading |
| Orchestrator | future process/mission stability |

## Progressive disclosure

The intended context path is:

1. `blabla status`
2. one failed/unverified rule
3. `blabla explain <rule>`
4. runtime dependency if relevant
5. full contract source only when still needed

The point is not to replace a large prompt with a large `.bla` dump. Contracts stay in the repository and are pulled into context only when the agent needs them.

## Future experiments

Useful next experiments include:

- replicate the handoff benchmark with more models and more chains
- compare against a conventional-test baseline
- measure token/cache/turn economics across longer projects
- test additional application languages/providers
- study whether executable process/mission constraints help orchestrators preserve high-level goals

Do not treat these as established benefits until measured.
