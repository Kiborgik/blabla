# Changelog

## 0.5.0-alpha (2026-09-14) — first public alpha

- `structure.bla`: declarative codebase contracts (`module`, `require`/`forbid` over `module`, `symbol`, `dependency`, `value ... contains`), `group::label` identities, `use structure` / `draft structure` in `project.bla`.
- Python structure provider: one isolated interpreter run per verification with an embedded `ast` extractor; never executes project code; missing interpreter, unparsable modules and non-literal constants are ERROR.
- Layered completion: `blabla status` and `blabla finish` report BEHAVIOR, STRUCTURE and OVERALL; completion requires every active layer GREEN; structure is evaluated live and never cached.
- `blabla finish` hardening: flushed `COMPLETION GATE: VERIFYING` header, periodic progress lines, run-state marker with run id, pid, start time and identities; `status` shows VERIFYING or INTERRUPTED and an interrupted run never leaves a current GREEN.
- `blabla explain` for structure rules with the observed file and line; single-file `check` of structure contracts.
- Examples: `examples/todo` as a two-layer project, `examples/glyph-vault` as the research project with a 47-rule structure contract, plus two behavior-correct architecture-broken fixtures.
- Repository essentials: MIT license, code of conduct, contributing, security and citation files, issue and pull request templates, GitHub Actions CI for Windows and Linux with a tagged release workflow, curated `research/` package, language/project/structure/agent docs, Mermaid diagrams rendered to `docs/assets/` behind a drift gate.

**Alpha limitations.** Behavior verification is bounded and heuristic: GREEN means the declared obligations were exercised and satisfied under the configured campaign, not a proof. The structure provider is Python-only and its fact vocabulary is small; dynamic imports and non-literal constants are invisible to it. Observations and adapters are trusted. There is no distributed or temporal verification and no process or mission layer. Language syntax, CLI flags, JSON fields and exit codes may still change between alpha releases.

## 0.4.2 (2026-09-14)

Self-describing runtime semantics: `blabla explain runtime::restart`, `Depends on:` in rule explain, `Runtime primitives used:` in status.

## 0.4.1 (2026-09-14)

Canonical `verify behavior { ... }` profile, `blabla finish` as the completion gate, canonicity and profile staleness in status, project-root command resolution.

## 0.4.0 (2026-09-14)

`project.bla`, project-aware compilation across contracts, `group::label` rule identities, status record with staleness, `blabla status`, `explain`, `guide`, `init`, drafts, managed `AGENTS.md` block.

## 0.3.0 (2026-09-13)

Semantic coverage obligations, coverage-guided generation, GREEN/YELLOW/RED with YELLOW exit 5, bounded corpus replay, typed literal mining.

## 0.2.0 (2026-09-13)

Trusted process restart and reset isolation, floats and optionals, failure-preserving shrinking, distinct error codes, JSON reports.
