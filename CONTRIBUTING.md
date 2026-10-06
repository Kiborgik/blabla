# Contributing

BlaBla is pre-1.0. Contract syntax, CLI, JSON and exit-code changes belong in a minor release with **Breaking** notes; patches preserve those interfaces. False GREENs, nondeterminism, unsafe provider execution and benchmark flaws are especially valuable reports.

## Development setup

Use recent stable Rust (edition 2024) with `rustfmt`/`clippy`, and Python 3.10+ (`python` or `python3`). The Python provider/helper tests use the standard library. Full example verification also needs Node.js, Go, a JDK and C/C++ compilers. Diagram regeneration needs Node/npx and a supported browser.

```sh
git clone https://github.com/Kiborgik/blabla.git
cd blabla
cargo build --release
cargo run --release --quiet --bin blabla -- status
```

Read [AGENTS.md](AGENTS.md), then query the relevant role/system/flow. **Use Cargo to run current source in this repository**, never an installed or old built binary. Plain `blabla` in user examples is for projects consuming an installed release.

## Verification

Run focused checks that cover your change; full integration belongs to the orchestrator. [Test ownership](docs/test-ownership.md) assigns each layer's responsibility.

```sh
cargo fmt --all -- --check
cargo clippy --release --all-targets -- -D warnings
cargo test --release --test TEST_NAME
python -m unittest discover -s experiments -p 'test_CHANGED_BOUNDARY.py'
python experiments/render_diagrams.py --check
```

Replace the test placeholders with the relevant target. After changing a diagram, run `python experiments/render_diagrams.py` and inspect the SVG; commit source, generated asset and manifest together. [Diagram procedure](docs/diagrams/README.md)

| Gate | Purpose |
| --- | --- |
| `python experiments/gate.py --tag local` | current product integration: formatting/lint/tests, adapters, current-source bridge, composed finish/status, language examples, public-tree audit and diagram hashes |
| `python experiments/run_historical_tests.py` | experiment-test complement derived from the product schedule; complete discovery without rerunning its Python stages |
| `python experiments/research_gate.py` | opt-in stress tests, historical scorer and frozen research reproductions |
| `experiments/gate_v04.py`, `gate_v05.py` | frozen historical release reproductions; do not retarget or add current tests |

The current [CI workflow](.github/workflows/ci.yml) runs the historical complement, product gate and Hello contract check on Linux and Windows. Product/current research scripts invoke the working-tree CLI through Cargo. Their source declares the schedule and build profile; focused release commands above do not change it. Before a pull request, integrate and pass the current product checks for the final source. Report unrun/blocked stages; a previous commit's GREEN is not a pass for later edits.

## Where tests belong

- Behavior grammar/typing/evaluation: `src/syntax`, `src/semantics`, `src/ir`, `src/verify`; end-to-end cases under `tests/`
- Structure verdict logic: `src/structure/tests.rs`; actual provider cases under `tests/structure*.rs`. Include GREEN, RED and ERROR, and prove providers never execute project code
- Project/layers/CLI: `tests/project.rs`, `layers.rs`, `cli.rs`, `cli_output.rs`; assert exits and JSON structure rather than English wording
- Task/expert semantics: Rust tests; Python owns adapter/harness boundaries; direct bridge tests own translation to the product. Do not count authored expert fixtures as live quality evidence

## Change rules

- Preserve the [semantic invariants and trust boundaries](BLA_BLA.md); unevaluable or unexercised is never GREEN
- Tests assert identities, fields and behavior, not translated prose. Human/JSON surfaces use the same values
- Keep the Python AST extractor free of project imports, `exec`, `eval` and regular expressions
- Frozen Glyph Vault behavior stays logically identical unless a release note explicitly changes that claim
- A language proposal needs the motivating contract, an alternative considered, IR/provider consequences and an executable acceptance case: RED before repair, GREEN after, with a distinction the existing language cannot express
- One logical batch per commit, imperative title, specific body, no generated attribution lines

## Reporting a false GREEN

Include the smallest contract, application/adapter and exact reproduction commands; profile and seed; BlaBla version, OS and toolchain; expected violated rule and actual JSON result. YELLOW, ERROR, STALE and RED are refusals to certify, not false GREENs, though an incorrect refusal can still be a bug.

[Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)
