# Bounded probe integration cost

Author: `gpt-6-astra` (high), report-only `assess-bounded-probe-cost`.

## Finding and recommendation

The eager fixture is an integration blocker even while `bounded-results.bla` stays
draft: constructing/resetting the shared legacy adapter runs a real CLI project.
The historical root campaign performed **152 resets**, not merely its eight case
starts. Per-request success does not make that repeated cost proportionate.

Make only the bounded fixture lazy under a separately authorized amendment:
legacy startup/reset must create no CLI project and invoke no Cargo; explicit
bounded setup or close actions prepare real evidence; reset discards it. Expose an
honest uninitialized observation. Keep the legacy 8×512 profile unchanged. Do not
promote until the repair and its cost evidence are independently accepted together
with the separate exact-core race evidence.

An uninitialized close that returns an adapter error is honest, but is **not yet a
safe activation path** for the mixed campaign. The current generator can choose any
declared action immediately after reset. A Boolean `expect` guard does not suppress
that call; adapter errors abort verification. The language has no action
preconditions. Do not disguise that error as a real CLI refusal or silently create
a different before-state inside close without an explicit contract for that setup.

The owner resolved this boundary at handoff: a first explicit close may initialize
the genuine default current-GREEN fixture and then execute that close. Ordinary
close can actually succeed; bounded close actually refuses current GREEN.
`bounded_fixture_initialized` remains false until that construction, and the draft
now requires initialization for positive results. This is a defined composite
probe action, not a claim that the prior uninitialized observation was a READY
world. Its source repair and prospective tests are the next authorized task.

## Actual bounded measurement

Source-only measurement: `/tmp/measure-bounded-probe-cost.py`, raw output
`/tmp/bounded-probe-cost-run.log`, structured `/tmp/bounded-probe-cost.json`, child
stderr `/tmp/bounded-probe-cost-stderr.log`. All outputs were read. The script
launched the current Cargo example and exchanged 15 requests: four resets, two
legacy actions, three observations, three actual setups and three actual closes
(bounded acceptance, carry refusal and ordinary acceptance). Each response had the
unchanged 5,000 ms allowance. No canonical root campaign ran, and the root status
file's SHA-256 was unchanged.

| Operation | Count | Observed range | Mean |
| --- | ---: | ---: | ---: |
| Reset, including initial source startup | 4 | 684–850 ms | 749 ms |
| Explicit bounded/ordinary setup | 3 | 759–869 ms | 813 ms |
| Real close plus inspections | 3 | 505–629 ms | 581 ms |
| Legacy action | 2 | 0.082–0.085 ms | 0.084 ms |
| Observation | 3 | 1.85–1.98 ms | 1.92 ms |

The whole sequence took **7.19 seconds**. This warm local measurement is finite,
not a worst-case guarantee or an old-version speedup comparison. The prior
seven-test concurrent run also remains relevant: actual runtime startup/reset
3,142 ms, setup 1,248–1,781 ms and close 752–1,072 ms. Cold source rebuilds and
contention can be slower. No timeout increase is authorized or recommended.

## Full-profile implications

The preserved `.blabla/status.json` run `b62deea7dbbc167bfa1cb01efbf71ae8`
(recorded Unix `1792151140`) used seed 0, 8 cases × 512 steps, 5,000 ms responses
and shrink budget 256. Its report records 4,096 total actions, 152 resets, 299 replay
actions, full coverage at action 2,055 and 14,593 ms total elapsed time. Those are
historical measurements from before this bridge, not a current GREEN claim.

`src/verify/campaign.rs` resets when selecting guided corpus prefixes as well as
at case starts. Failure confirmation/shrinking can create more work. Keeping just
the historical 152 resets and applying today's measured reset mean gives about
**114 seconds of eager reset work**, before any new bounded action. Using the
previous concurrent 1–2 second setup range gives roughly 152–304 seconds. These
are extrapolations, not a replay of the historical campaign.

There are currently 82 distinct active actions; promotion adds five bounded
ones, including three setup actions and two close actions. A deliberately simple
uniform-selection illustration over 4,096 actions would yield about 141 setups and
94 closes, or **169 seconds** at the new measured means. Combined with the reset
projection, that is about 283 seconds of bounded-fixture work alone. The actual
campaign is guided and replays prefixes, so this is neither a prediction nor an
upper bound. Reducing reset cost removes the unconditional legacy penalty; it does
not remove the cost of deliberately exercising the new actions.

## Existing support and smallest activation decision

- `src/project/mod.rs::Profile` supports one command, optional once-per-run
  `prepare`, seed/cases/steps, request/startup allowances and shrink budget. Parsing
  explicitly rejects a second canonical profile. There is no per-contract profile
  or cost-weighted action budget to configure here.
- `prepare` can build source once before launch, but cannot replace genuine
  per-fixture evidence/finish or authorize a copied GREEN status. `startup_ms` only
  addresses the first exchange; it does not reduce later reset or action work.
- Existing `blabla run FILE --cases ... --steps ... -- <application>` supports a
  bounded standalone contract campaign and emits its report without writing the
  root project verification record. It is useful supplementary evidence with an
  explicit finite budget; it is not the unchanged root canonical completion gate.
  It still needs a valid initialization/action contract.
- The seven focused bridge tests already provide explicit positive and refusal
  sequences. Keep the new contract draft while repairing lazy initialization and
  verifying the owner-defined first-close initialization. Then a bounded standalone campaign can measure
  actual guided/reset counts before the owner decides whether the full unchanged
  mixed profile cost is acceptable. Do not quietly substitute that smaller run for
  the existing legacy canonical gate.

No new profile framework, fake model, gate reduction or runtime change is proposed
in this report. A separate nested project could own its own profile, but that is a
larger ownership/integration decision and cannot prove parent independence; it is
unnecessary for the immediate lazy-reset repair.

## Declared evidence

`cargo run --locked --quiet --bin blabla -- check` is the declared task check. Its
receipt validates current syntax only. It proves neither the cost projection nor
contract coverage; the measured sequence and inspected source above support those
bounded claims. The historical record and existing seven-test evidence are reused,
not rerun as a long global gate.

## Resolution measured 2026-10-16, 14:58 UTC

The separately authorized lazy repair is now implemented and author-verified in
`bind-bounded-result-contracts`; its nine-test receipt is
`.blabla/scratch/bind-bounded-result-contracts/evidence-3-17-1792162748874751806.log`.
The earlier diagnosis and measurements above remain historical. Startup, reset
and observation now leave the bounded fixture uninitialized; the prospective
Cargo-sentinel regression proves legacy-only use never launches nested Cargo.
Explicit setup or the owner-defined first-close composite still prepares a real
CLI project and executes the real decision. Reset drops that fixture.

The same fifteen-request sequence, recorded in
`/tmp/bounded-probe-lazy-cost.json` and `/tmp/bounded-probe-lazy-cost-stderr.log`,
took **4.081 seconds**: initial source startup/reset 93.713 ms; subsequent resets
2.878, 3.059 and 3.511 ms; explicit setups 821.577–843.271 ms; actual closes
468.479–523.062 ms. Root status bytes remained unchanged. This resolves the
measured unconditional eager-reset penalty, while deliberate probe use retains
its real cost. The concurrent focused run observed first-close preparation plus
decision at 3,856/4,005 ms, within the unchanged 4,500 ms internal and 5,000 ms
request bounds; cold compilation or contention can still exceed them and must
remain an execution error.

These finite local observations are neither a full-profile runtime bound nor a
canonical completion result. The single-profile limitation remains. Independent
bridge acceptance and a small standalone draft campaign are the next owner
decisions before promotion; legacy gates, closure policy and timeouts are intact.
The refreshed declared check below remains syntax-only evidence.
