# Contributing

BlaBla is pre-1.0: a change to contract syntax, CLI options, JSON fields or exit codes ships only in a minor release and is listed under **Breaking** in `CHANGELOG.md`, and a patch release never makes one. Issues that report a false GREEN, a nondeterministic campaign, a provider that executes project code, or a benchmark flaw are the most valuable contributions.

## Development setup

- **Rust stable** with `rustfmt` and `clippy` (`rustup component add rustfmt clippy`). The crate is edition 2024, so a recent stable toolchain is required.
- **Python 3.10 or newer** on `PATH` as `python` or `python3`. The structure provider runs it in isolated mode, and the example applications are Python. No packages are needed: the provider uses only the standard library and the tests use `unittest`.
- **Node.js** only if you change a Mermaid diagram; `experiments/render_diagrams.py` calls the Mermaid CLI through `npx`.

```text
git clone https://github.com/Kiborgik/blabla.git blabla
cd blabla
cargo build
cargo test
```

## The checks

```text
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo build
cargo test
python -m unittest discover -s examples/todo -p "test_*.py"
python -m unittest discover -s experiments -p "test_*.py"
python experiments/audit_public_tree.py
python experiments/render_diagrams.py --check
```

`cargo run --quiet --bin blabla -- <command>` is how you run BlaBla against this repository — `status`, `explain`, `check` and `finish` included. Do not use an installed `blabla` binary while changing BlaBla: Cargo rebuilds from the working tree, a prebuilt binary silently lags behind the semantics you are editing, and a GREEN it reports is evidence about the wrong code. Plain `blabla` stays correct for ordinary projects that consume a release.

These are exactly the jobs CI runs on Windows and Linux. Run the ones that cover what you changed while you work; run all of them before opening a pull request. `cargo fmt --all` (without `--check`) applies the formatting.

Three gates exist and they are not interchangeable:

| Script | Tier | Holds |
| --- | --- | --- |
| `experiments/gate.py` | current product gate | the checks above plus BlaBla's own `status` and `finish`; what every change must pass |
| `experiments/research_gate.py` | current research gate | the ignored stress tests, the historical scorer suite, the 4096-step frozen Glyph reproduction and the layered `finish` reproductions; opt-in and slow |
| `experiments/gate_v04.py`, `experiments/gate_v05.py` | historical reproduction | frozen replays of the v0.4 and v0.5 release gates, kept so those releases stay reproducible |

Run `python experiments/gate.py --tag local` before opening a pull request. Both current gates invoke BlaBla through `cargo run`, so they verify the working tree rather than a stale binary.

**The historical gates are not development infrastructure.** Do not add current tests to `gate_v04.py` or `gate_v05.py`, and do not retarget them: their value is that they still reproduce what those releases claimed. `contracts/gate.bla` deliberately contracts `gate_v05.py` for the same reason — it freezes that reproduction, and it is not a contract over the current gate.

## Adding tests

**Behavior language.** Grammar, typing and evaluation live in `src/syntax`, `src/semantics`, `src/ir` and `src/verify`, each with unit tests beside it. End-to-end language behavior belongs in `tests/`: `tests/compiler.rs` for accepted and rejected sources, `tests/values.rs` and `tests/compiler_values.rs` for types and expressions, `tests/verifier.rs` and `tests/coverage.rs` for campaign verdicts and obligations, `tests/acceptance.rs` for whole runs against the example applications. A new primitive needs all three: a parse test, an evaluation test, and a campaign that turns RED when the primitive is violated.

**Structure provider.** `src/structure/tests.rs` covers the rule evaluator with an in-process fake provider — use it for verdict logic, ERROR propagation and rule identity. `tests/structure.rs` covers the real Python provider end to end: write module sources into a `TempDir`, parse a contract against that root, call `verify`, and assert each rule's `RuleStatus` and its observed file and line. A new fact kind needs a GREEN case, a RED case, and an ERROR case for input the provider cannot establish. A new language provider additionally needs a test proving it never executes the module it reads.

**Layers and CLI.** `tests/layers.rs` covers `status` and `finish` across both layers, `tests/project.rs` project discovery and composition, `tests/cli.rs` and `tests/cli_output.rs` the command surface. Assert exit codes and `--json` fields, never the English text.

## Rules of the codebase

- Tests assert ids, JSON fields and structure, never translatable prose; a test title says what the behavior is.
- Every CLI surface has a `--json` form and the human form is derived from the same view.
- GREEN is never assumed: a fact a verifier cannot establish is ERROR or YELLOW and blocks completion.
- The Python structure provider never executes repository code; keep `src/structure/python_facts.py` free of `exec`, `eval`, imports of project modules and regular expressions (a test enforces this).
- Behavior of the frozen Glyph Vault campaign must stay logically identical across releases unless a release note says otherwise; the gate compares it against the recorded baseline.

## Reporting a false GREEN

A **false GREEN** is BlaBla reporting GREEN while declared behavior or structure was actually violated. It is the failure this project cares about most, because it is the one that makes the completion gate worse than useless. Use the false-GREEN issue template and include:

- the **contract**, or the smallest part of it that still shows the problem;
- the **verification profile** (the `verify behavior` block or the `run` flags) and the **seed**;
- a **minimal project** if you can reduce it to one — the contract, the application or adapter, and the exact commands;
- the **BlaBla version** (`blabla --version`) and the **platform** (OS, Rust toolchain, Python version);
- **expected versus actual**: which rule should have been RED, and what BlaBla reported instead. The `--json` report is the best form.

YELLOW, ERROR, STALE and RED are not false GREENs — those are BlaBla refusing to certify something, which is the intended behavior. Report those as ordinary bugs if they look wrong.

## Proposing language changes

Open an issue with the contract you could not write, the rule you wanted and why it is behavior or structure rather than style. Grammar additions need a critique of at least one alternative, an IR change and provider support.

**A language change must come with an executable acceptance case demonstrating why the new primitive is needed**: a project that is RED under the proposed rule and GREEN once it is repaired, which nothing in the current language can distinguish. Without that case there is no evidence the primitive adds expressive power, and the grammar stays as it is.

## Commits

One batch per logical change, imperative title, body listing what the batch contains. No generated attribution lines.
