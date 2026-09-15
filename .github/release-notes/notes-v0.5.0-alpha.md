# v0.5.0-alpha — first public alpha

BlaBla is a Rust CLI for keeping selected project intent executable and queryable by coding agents. Applications stay ordinary code; BlaBla holds behavioral and structural contracts and exposes them through `status`, `explain` and `finish`.

This is an experimental alpha. Syntax and CLI/JSON interfaces may still change.

## Highlights

- **Behavior contracts** — observable state, actions, postconditions, invariants and forbidden states.
- **Coverage-guided verification** — generates action sequences, tracks meaningful coverage, reports YELLOW for unexercised obligations and shrinks confirmed failures.
- **Project manifests** — `project.bla` composes contracts and defines one canonical verification profile.
- **Structure contracts** — static rules over modules, symbols, dependencies and literal collections. v0.5 ships a Python provider.
- **Progressive disclosure** — `blabla status` → `blabla explain <rule>` → contract source only when needed.
- **Completion gate** — `blabla finish` exits 0 only for `OVERALL GREEN`; long runs print progress and interrupted runs never leave a current GREEN.
- **Agent onboarding** — `blabla init --agents` writes a small managed `AGENTS.md` block and portable skill.

## Research observation

In one four-stage fresh-context Haiku handoff benchmark, the BlaBla condition finished with 106/106 behavior checks, architecture PASS and zero regressions while using about 29% of the full-prose baseline's aggregate input tokens, 35% of its cost, and roughly half its turns/tools.

This is one model, one synthetic project and one chain per condition. The full methodology, prompts, scorers and results are under `research/`.

## Install

Download the archive for your platform, verify it against `SHA256SUMS.txt`, and place `blabla` on `PATH`:

```text
blabla-v0.5.0-alpha-windows-x64.zip
blabla-v0.5.0-alpha-linux-x64.tar.gz
SHA256SUMS.txt
```

From source:

```text
cargo build --release
```

Python 3.10+ is required for the bundled examples and the Python structure provider.

Start with `examples/todo`:

```text
blabla status
blabla finish
```

## Known limitations

- behavior verification is bounded and heuristic, not a proof
- structure support is Python-only in v0.5
- adapters/observations are trusted
- structural facts intentionally cover a small static vocabulary
- no distributed/temporal verification
- no process or mission layer yet
- external platform support is only as strong as CI proves

## API stability

`v0.5.0-alpha` is not stable. Contract grammar, CLI flags, JSON fields and exit codes may change between alpha releases.
