# Operating and strategic contract bindings

Proposal by `gpt-6-astra` (high), based on current `operations.ts`, `economy.ts`,
`trade.ts`, `engine.ts`, `content.ts`, release definitions and the accepted feature
probe. No contract or implementation changes are made here. The existing eight
feature tests are regression evidence only, not evidence that this proposal runs.

## Production: distinguish allocation from a full economy invocation

`allocateOperations` snapshots opening civilization budgets, orders cities and
buildings, and records `paused`, `blocked` or `operated` plus actual paid inputs.
It does not produce outputs. `resolveEconomy` calls that allocator, produces
recipe contributions into `lastResult.produced`, then performs other production,
upkeep, growth, trade and research. Therefore paused whole-world stocks can grow
or shrink. Never subtract unrelated flows from a total and call it an observation.

Use one explicitly **synthetic component fixture**: `createWorld(17, epoch)` plus
real releases through foundations-2 → independent-1 → production-1, then a named
fixture preparation that places one irrigation building and its operation record
in city-0 and sets its owner's materials to the authored recipe's one-operation
input amount. No other paid buildings. This controlled component state is not a
claim of legal construction, research progression, durable public play or a
model-agent action. Do not emit development-agent provenance for setup. Obtain
recipe quantities from `BUILDINGS`; never reproduce allocator logic.

Exact proposed observation fields:

- `production_enabled: bool`: irrigation's actual operation.enabled.
- `production_inputs_available: bool`: every authored input is affordable from
  that owner's current resources. With one paid building there is no earlier
  same-owner allocation to subtract.
- `production_stock_units: int`: actual owner materials, in hundredths.
- `production_paid_units: int`: summed lastResult.paid, in hundredths; zero when
  no result exists. This is a receipt, not a guessed stock delta.
- `production_produced_units: int`: summed lastResult.produced, in hundredths.

Actions, with no parallel fake simulator:

- `operate()`: call actual `allocateOperations` on this component state once.
  Whole-stock preservation is meaningful at this exact boundary. Repetition can
  reach shortage because no ordinary income occurs here. This is an allocator
  invocation, not a complete strategic beat or an admitted world command.
- `production_beat()`: call actual `resolveEconomy(state, events)` once. Read the
  resulting recipe receipt; do not assert whole-stock preservation. This is a
  component invocation, not the public clock/strategy admission boundary.
- `pause()`: submit the actual owner `set-building-operation` action through
  `applyCommand` with the current revision and explicit fixture timestamp. Use
  its returned state; refusal must remain visible rather than forcing a toggle.
  Reset starts enabled, so pause and both enabled/disabled branches are reachable.

Proposed owner-authored rule bodies (prefix all fields as above):

```text
when operate {
  expect "operating-inputs-are-atomic": before.production_enabled and before.production_inputs_available or after.production_paid_units == 0
  expect "paused-building-preserves-inputs": before.production_enabled or after.production_stock_units == before.production_stock_units
  expect "allocator-debit-matches-receipt": before.production_stock_units - after.production_stock_units == after.production_paid_units
}
when pause {
  expect "pause-does-not-spend-resources": after.production_stock_units == before.production_stock_units
}
when production_beat {
  expect "inactive-recipe-has-no-input-or-output": before.production_enabled and before.production_inputs_available or after.production_paid_units == 0 and after.production_produced_units == 0
}
```

The debit equality is deliberately scoped to the single-material irrigation
recipe; expanding the fixture to other inputs requires per-resource observation,
not retaining that equality over an unrelated stock. A successful-output test
must also demonstrate a positive actual recipe contribution from the enabled,
supplied fixture; allocator-only output checks would be vacuous. Keep the old
unbound draft as history and explicitly review this clarified component boundary
before promotion; do not silently reinterpret its stock field.

## Strategy: actual consent followed by a later shipment

Use a separate real engine world. Release foundations-2 → independent-1 at a
fixed UTC epoch; trade-routes is included. Submit one real seat-0
`propose-trade` for `harvest-for-materials` with seat 1 at that timestamp. Initial
resources suffice; there are no stock edits. Capture the actual offer ID. Actor
1 has not used its independent allowance. Reset ends with this pending offer.

Fields derive from that named offer and its eventual route:

- `strategy_can_consent: bool`: exact accepting action appears in current legal
  actions for recipient 1 at the fixture timestamp.
- `strategy_last_valid: bool`: most recent consent's actual TransitionResult.ok.
- `strategy_agreement_enabled: bool`: actual route.agreement.enabled, false
  before a route exists; do not use route.active, which means shipment status.
- `strategy_delivery_count: int`: actual agreement.deliveryCount, initially 0.
- `strategy_round: int`: actual state.round.
- `strategy_next_delivery_round: int`: agreement.nextDeliveryRound, or 0 absent.

`consent()` submits recipient 1's exact accepting response, current revision and
fixture timestamp through applyCommand. Repeated/refused responses preserve
actual state and false acceptance. `strategic_beat()` advances the fixture time
by one authored strategy interval and uses actual catchUpStrategy. Read its
state and fail the harness on an unexpected error or unfinished catchup; never
invent a delivery to satisfy the expectation.

Proposed `contracts/strategy.bla` rule for the currently missing identity:

```text
when consent {
  expect "immediate-order-affects-persistent-commitment": not before.strategy_can_consent or after.strategy_last_valid and after.strategy_agreement_enabled and after.strategy_delivery_count == before.strategy_delivery_count and after.strategy_next_delivery_round > after.strategy_round
}
when strategic_beat {
  expect "cargo-waits-for-due-beat": after.strategy_delivery_count == before.strategy_delivery_count or after.strategy_round >= before.strategy_next_delivery_round
}
```

Acceptance creates enabled standing terms, charges construction once and leaves
cargo deliveryCount zero. Recipe cadence is four rounds: test rounds 1–3 retain
zero and the real round-4 transition produces one actual delivery, with volume,
lastDeliveryRound and trade-delivered event checked. A later ordinary peer wait
must preserve the agreement without producing cargo. Compare exact engine states
and replay the release/proposal/consent/catchup sequence to prove deterministic
continuity. This establishes a longer-lived WorldState commitment, not database
or process-restart durability; existing host/CLI tests address storage separately.

## Small next scope and deciding evidence

Owner: clarify production.bla, author/register strategy.bla as draft, then assign
one adapter task for a separate operations/strategy probe module, adapter wiring
and focused tests. Preserve current sequential and frontier/concurrency fixtures.
No new persistence library, provider, public activation or policy model is needed.

Prospective cases: allocation paid equals real debit; repeated depletion blocks
without debit; actual pause preserves stock; paused and starved full-economy
receipts pay/produce zero despite unrelated stock movement; supplied full economy
produces a positive recipe contribution; consent creates agreement with no cargo;
repeated consent spends nothing; pre-due beats ship nothing; due round really
ships; replay/reset are deterministic; adapter feature actions do not touch the
durable campaign. Tests must inspect receipts and real resulting worlds, then
owner canonical verification must witness the promoted rules. The regression
check attached to this research task proves none of those proposed new cases.
