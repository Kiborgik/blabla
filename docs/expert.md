# Expert layer (experimental)

**Experimental, with no shown benefit.** The expert layer asks fixed questions about selected project context: is the work drifting from its goal, is a claim backed by evidence, is a failed approach being repeated, would some expertise help. A deterministic policy turns a validated answer into silence, abstention or fixed-template advice. It never changes task acceptance, verdicts, exit codes or OVERALL.

Repository bindings run in shadow only, and no judgment is promoted. A real calibration found no feasible policy. Better correctness or less steering is not shown. [Release evidence](design/0.10-release-evidence.md) · [host probe](design/0.10-host-capabilities.md)

| Mode | What happens |
| --- | --- |
| off | no provider calls; `status`, `explain`, `check` and verification never call one |
| shadow | the default for a valid binding; a captured checkpoint is evaluated, nothing reaches the worker |
| advisory | needs a matched live promotion, a qualified provider and verified host pause, same-task and receipt support |
| native experiment | a separate, permitted protocol at idle between-turn boundaries: [native adapter](../adapters/native/README.md) |

A binding installs no hook; an integration must observe a real boundary and send its event.

## Fixed expert judgments and bindings

A knowledge pack holds a judgment; process memory binds it to roles and checkpoints. The pack (`knowledge "expert-review" { … }`) and the role must be declared too:

```text
judgment "claim-support" {
    pack "expert-review"
    purpose "Check one claim."
    requires ["claim", "evidence"]
    question "Does the supplied evidence support the stated claim?"
    criteria "Missing or unrelated evidence does not establish the claim."
    output "noul"
    proposition "The evidence supports the claim."
    templates ["cite-evidence"]
}
```

```text
binding "claim-check" {
    judgment "judgment::expert-review::claim-support"
    roles ["worker"]
    checkpoints ["tool-result", "claim", "turn-end"]
}
```

| Field | Values |
| --- | --- |
| `output` | `choice` with `alternatives`, `noul` with `proposition`, or `score` with ascending `levels` |
| `requires`, `optional` slots | `task`, `goal`, `mission`, `proposal`, `claim`, `evidence`, `attempts`, `candidates`, `rules`, `system` |
| `checkpoints` | `plan`, `tool-call`, `tool-result`, `claim`, `turn-end`, `review` |
| `templates` | `read-identity`, `cite-evidence`, `reconsider-approach`, `ask-owner` |

Optional binding lists (`goal`, `mission`, `system`, `rules`, up to four `candidates`) must name existing identities. A template the binding cannot fill is rejected. `explain judgment::PACK::NAME` and `explain binding::NAME` show the definitions.

## Trust

- The packet holds selected task revisions, registered identities, bounded observations and recent history, never a full transcript. Missing or stale context abstains
- Trusted configuration, never packet text, supplies the provider, endpoints and calibration. Worker reports are not facts
- One fixed predicate per policy rule; answers within `1e-3` of a calibrated threshold abstain. Changed questions or templates need recalibration
- Checkpoint stdout carries no advice. Shadow diagnostics can hold would-be advice and stay with the observer

## Commands

| Command after `blabla expert` | Purpose |
| --- | --- |
| `evaluate --config C --provider-command PROG ARG…` | bounded JSONL requests on stdin; typed results, never delivery authority |
| `checkpoint --event E --config C` | capture, select packets, evaluate, keep proposal IDs; no advice on stdout |
| `delivery REQUEST_ID --checkpoint CHECKPOINT_ID` | advisory recheck and reserve-before-return |
| `receipt REQUEST_ID --state S --evidence ID` | `S` is `proposed`, `delivered`, `acknowledged`, `declined`, `stale`, `observed_resolved` or `unknown`; `proposed` is the retry route after a verified non-delivery |
| `replay TRACE` / `reevaluate TRACE --config C --provider-command …` | recompute a saved decision offline / compare with a new request ID |
| `preflight-development-calibration --input F` / `fit-saved --input F` | validate frozen inputs / fit policy from saved real responses |
| `traces` / `traces delete RUN_ID` | list metadata / delete payload, keeping suppression state |
| `cleanup --task TASK` | remove a terminal task's expert state; refuses open tasks |
| `native …` / `pilot issue\|show\|revoke …` | cooperative host operations / scoped experimental permits |

Global options go before `--provider-command`; pass a hyphenated provider argument as `--provider-command=--FLAG`. Exit 0 is a typed result, which may be an abstention or a provider failure, so read the returned tag; 2 is bad input or configuration; 4 is an I/O failure. Runtime settings are strict JSON: `RuntimeConfig` in [`src/expert/trace.rs`](../src/expert/trace.rs). No provider is configured by default.

| Limit | Default |
| --- | --- |
| Packet / excerpt | 16,384 / 2,048 bytes (also the maxima) |
| History / questions per checkpoint | 8 / 4 (also the maxima) |
| Request timeout | 10,000 ms (max 60,000) |
| Concurrency / retries / deliveries | 1 / 0 / 1 (max 1 each) |
| Trace retention / payload / open concerns | 7 days / 16 MiB / 64 per task |

## Delivery and qualification

- `delivery` rechecks everything under lock and reserves before it shows advice. This is not exactly-once: an uncertain delivery keeps the concern blocked until reconciled
- An acknowledgment is not a fix. `observed_resolved` needs current passing task evidence after a real corrective change
- `replay` recomputes a saved decision without a model or network; it must match byte for byte
- Promotion needs `matched_live_expanded` evidence against frozen limits: 95% false-nudge upper bound ≤0.05 (≤0.10 for expertise), enough held-out deliveries, ≥0.90 coverage and bounded p95 latency. Replay, fixtures and pilots never qualify
- The self-hosting bridge tests the deterministic policy with fixtures. Its GREEN says nothing about delivery, provider quality or benefit
