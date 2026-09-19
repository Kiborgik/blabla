# Changelog

## 0.7.0-alpha (2026-09-18)

### Added

- Structure providers for TypeScript/JavaScript, Go, Java, C, and C++, alongside existing Python and Rust support.
- A shared tree-sitter parsing harness, live provider capability reporting, and scoped uncertainty for unresolved dependencies.
- Reusable JSON Lines adapters for Python, TypeScript, Go, Java, and C, with the C adapter also supporting C++. Six language examples now use the same behavior contract.
- Verification-profile options `prepare` and `startup_ms`, separating preparation and startup from application-response timeouts.
- An executable task lifecycle covering assignment acceptance, declared checks — set at opening or corrected on a live record — evidence, blockers, hand-back, result acceptance, model exceptions, lens assessments, and attribution.
- Self-hosted behavior contracts for the structure evaluator, task lifecycle, and diagnostic voice.
- Recovery-mode task tooling that does not present its results as verification of the current candidate.
- Optional `voice neutral | blunt` diagnostics, without changing verification outcomes or structured output.

### Changed

- Task evidence tracks relevant input digests. Missing, failed, and superseded results are handled separately.
- `task show`, `guide loop`, and generated skills use one authoritative workflow-route list.
- `init --agents` writes skills to both `.agents/skills/` and `.claude/skills/`.
- The product gate runs all example projects and validates its execution order. Release publication now depends on product-gate success.
- Raised the minimum supported Rust version to 1.90, pinned every dependency to an exact version, and pinned the toolchain in `rust-toolchain.toml` so local and CI run the same lints.

### Fixed

- Incorrect dependency conclusions for unresolved Rust routes and Go modules nested below the project root.
- False-GREEN cases involving unreadable values, unreported modules, and unresolved imports, including imports beneath `await`.
- Task-record overwrites, acceptance backed by failed or unrelated checks, stale attribution, and directory-deliverable tracking.
- Malformed-input and argument-handling inconsistencies across adapters.
- Java example persistence of newline-containing text and narrowing of valid integers.
- Outdated task-entry guidance and the mismatch between lens-assessment arguments and the identities actually checked.
- Research fixtures and mutation checks affected by moving examples onto reusable adapters.

### Limitations

- Behavior verification remains bounded; GREEN is not a correctness proof.
- Adapter observations are trusted, and process guidance is not host-level enforcement.
- Unix-specific process containment has no recorded Unix validation.
- Alpha interfaces may change between releases.

## 0.6.0-alpha (2026-09-16)

### Project memory

- Added Mission, System, Process and Knowledge memory, all reachable through canonical `status` / `explain` identities.
- Added progressive routing from System and Process into reusable Knowledge packs.
- Added reviewer, worker and orchestrator Process roles and explicit `flow` / `step` development workflows.
- Project memory remains advisory/non-gating and is validated separately from repository truth.

### Development loop

- Added bounded task records under `.blabla/tasks/` for write scope, deliverables and persistent findings.
- Added `blabla challenge`, a deterministic evidence-backed skeptic over unresolved findings, unchanged deliverables, scope breaches, vacuous structure rules and stale/incomplete verification.
- Added `blabla guide loop`.
- Challenges do not decide correctness and do not alter completion authority.

### Structure

- Added a Rust structure provider using `syn`.
- Added `value ... maps K to V` for key/payload associations.
- Added `blabla check --falsify` for detecting structure rules whose verdict does not depend on an observable fact.
- Improved standalone structure-contract checking and diagnostics.

### Self-hosting and tooling

- BlaBla now carries its own Mission, System, Process and Knowledge memory and self-hosted Structure contracts.
- Split current product verification from slower research/historical reproduction gates.
- Added/updated public architecture and workflow documentation.

### Dogfooding

BlaBla 0.6 was developed using BlaBla's own project memory and development flow. During that work the new challenge path exposed defects in its own implementation before release. This is dogfooding under human direction, not autonomous self-modification.

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
