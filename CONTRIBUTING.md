# Contributing

BlaBla is pre-1.0. Syntax, CLI, JSON and exit-code changes go in a minor release with **Breaking** notes; patches keep them. The most useful reports: false GREEN, nondeterminism, unsafe provider execution, benchmark flaws.

## Setup

Stable Rust (edition 2024) with `rustfmt` and `clippy`, [cargo-nextest](https://nexte.st) (`cargo install cargo-nextest --locked`), and Python 3.10+. The gate runs every Rust test in parallel through nextest, which does not run doc tests; the crate has none. Full example runs also need Node.js, Go, a JDK and C/C++ compilers. Diagrams need Node/npx and a browser.

```sh
git clone https://github.com/Kiborgik/blabla.git
cd blabla
cargo run --quiet --bin blabla -- status
```

Read [AGENTS.md](AGENTS.md) first. In this repository, always run current source through Cargo.

## Checks

Run the focused checks for what you changed. The full gate belongs to the orchestrator. Every integration test lives in one test target, `it` (`tests/it/`); select a module with a filter.

```sh
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo nextest run -E "binary(it) & test(/^MODULE::/)"
python -m unittest discover -s experiments -p 'test_CHANGED_BOUNDARY.py'
python experiments/render_diagrams.py --check
```

`python experiments/gate.py --tag local` is the product gate: format, lint, every Rust test, the gate's own and the adapters' Python tests, the current-source bridge, the composed `finish`, the examples, the public-tree audit, markdown links, version agreement and diagram hashes.

[CI](.github/workflows/ci.yml) runs the product gate and the Hello check on Linux and Windows. A GREEN from an earlier commit does not cover later edits; report any stage you did not run.

## Who tests what

- **Rust tests**: language semantics, authority, policy and task states. Behavior in `src/syntax`, `src/semantics`, `src/ir`, `src/verify`, end-to-end in `tests/it/`. Structure verdicts in `src/structure/tests.rs`, providers in `tests/it/structure*.rs`: cover GREEN, RED and ERROR, and prove no project code runs
- **Python tests**: the expert adapters; language adapters are proven by the example `finish` runs
- **Bridge tests**: the bridge's translation to Rust
- **Product gate**: runs the composed self-hosted campaign once. To diagnose one contract alone, build `cargo build --quiet --example structure-adapter`, then `cargo run --quiet --bin blabla -- run contracts/questions.bla --cases 8 --steps 512 --timeout-ms 5000 -- target/debug/examples/structure-adapter`

## Rules

- Keep the [rules in BLA_BLA.md](BLA_BLA.md): unexercised or unreadable is never GREEN
- Tests assert identities, fields, exits and JSON, not English wording
- The Python AST extractor has no project imports, `exec`, `eval` or regular expressions
- Frozen Glyph Vault behavior stays the same unless a release note says otherwise
- A language change needs the motivating contract, an alternative considered, the IR and provider effect, and a case that is RED before and GREEN after
- After changing a diagram, run `python experiments/render_diagrams.py`, look at the SVG, and commit source, SVG and manifest together ([diagrams](docs/diagrams/README.md))
- One logical change per commit, imperative title, no generated attribution lines

## Reporting a false GREEN

Send the smallest contract and app, exact commands, profile and seed, BlaBla version, OS, toolchain, the rule you expected to fail and the JSON result. YELLOW, ERROR, STALE and RED refuse to certify; they are not false GREENs, though a wrong refusal is still a bug.

[Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)
