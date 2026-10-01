# Verification ownership

Routine checks follow the implementation boundary:

- Rust tests own language semantics, authority, policy and task-state transitions
- Python tests own their adapters and harnesses: transport, paths, serialization,
  orchestration, recovery and independent evaluation of recorded evidence
- Direct bridge tests own the bridge's translation to the Rust implementation
- `self-hosting-finish` owns the ordinary-order composed behavior campaign from
  `project.bla`, including the questions and expert contracts
- `reordered_composed_contract_preserves_targeted_witness` owns the different case:
  an unrelated contract group is renamed and moved, while all obligations and the
  multi-step targeted witnesses still have to be verified

The product gate builds the current-source bridge before canonical `finish`, then
reads back `status`. It does not repeat separate questions and expert campaigns.
The canonical seed, 32 cases, 512 steps, timeout, shrink budget and expert quality
floors are unchanged. The reordered regression keeps its full 16,384-action budget,
coverage, replay and witness-trace assertions.

This is an execution-ownership change, not a claim that isolated and composed
campaigns explore identical sequences. Routine integration exercises these
contracts in their real composition. When diagnosing an individual contract, its
isolated campaign remains available explicitly from the working tree:

```sh
cargo build --release --quiet --example structure-adapter
cargo run --release --quiet --bin blabla -- run contracts/questions.bla --cases 32 --steps 512 --timeout-ms 5000 -- target/release/examples/structure-adapter
cargo run --release --quiet --bin blabla -- run contracts/expert.bla --cases 32 --steps 512 --timeout-ms 5000 -- target/release/examples/structure-adapter
```

Windows CI50 measured the removed isolated stages at 56.27 seconds and 96.49
seconds, totaling 152.76 seconds. The corresponding Linux release gate measured
9.14 and 14.04 seconds. These are previously observed stage costs, not a new
end-to-end speedup measurement. The old coverage test binary took 343.59 seconds
on Windows and included both full composed variants; their separate durations
were not recorded.

Python boundary stages and direct bridge tests remain in the product gate.
`run_historical_tests.py` still derives its disjoint complement from `gate.STEPS`
and validates complete discovery. This change does not retire archived studies or
alter their explicit research/reproduction routes. No CI workflow changes are
needed.
