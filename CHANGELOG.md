# Changelog

## 0.8.0 (2026-09-22)

The first release without the alpha label. From 0.8.0 on, a change to contract syntax, CLI options, JSON fields or exit codes ships only in a minor release (0.9, 0.10, …) and is listed under **Breaking**; a patch release (0.8.x) never makes one.

### Breaking

- `task attribute` is the orchestrator's: it requires `--model` naming a model `role::orchestrator` permits, records that model on the attribution, and is no longer among a worker's routes, so a worker cannot declare its own out-of-scope change concurrent. It refuses a path that has not changed since the task opened.
- `task resolve` is the orchestrator's: it requires `--model` naming a model `role::orchestrator` permits and records that model on the resolution.
- `task resolve`, `task attribute` and `task deliverable --remove` need process memory that declares `role "orchestrator"`, and `task addressed` needs the task's role declared; without it they exit 2 and the error names the files to add.
- A finding's `resolution` in the task record and in `task show --json` is an object carrying `evidence` and, when recorded, `model`, where it was a string; records holding the old string still load.
- A task mutation prints one line, the record's identity and state; only `task open` and `task show` print the whole record, and `--json` still writes the whole record.
- READY requires current successful evidence and an explicit assignment challenge receipt tied to the task's own paths; `task close` checks both again, and a task that changed after hand-back is accepted again before any further work.
- `task evidence` is refused unless the task is ACCEPTED, and a result binds the write scope, or the declared inputs, as well as the deliverables. Evidence `inputs` in the task record map each such path to a digest or `null`, where they held deliverable digests only.
- A task left ACCEPTED or READY by 0.7 has no challenge receipt and evidence over its deliverables only, so it is accepted, evidenced and challenged again before `task ready` or `task close`.
- `task accept` on an ACCEPTED task re-records the acceptance and clears the challenge receipt, where it was refused with exit 2.
- `blabla challenge <name>` on a task that is not closed exits on its assignment check: 0 when the assignment is clear, 1 when it needs attention, so a project-wide challenge such as verification not current no longer fails it. On an ACCEPTED task it records the challenge receipt, and `--json` adds `assignment_clear`.
- `declared-check-failed`, `readiness-without-evidence` and `lens-unassessed` ground on an ACCEPTED task as well as a READY one, so a role that consults knowledge packs records a `task lens` for each before `task ready`.
- `status --json` reports a task's `state` as `OPEN`, `ACCEPTED`, `BLOCKED`, `READY` or `CLOSED`, where it was `OPEN` or `CLOSED`.
- `status --json` and `explain --json` no longer carry the process `enforcement` field, and `status` prints `PROCESS` without `ADVISORY`.

### Added

- `project.bla` can leave paths out of change tracking: `ignore from ".gitignore"` reads a gitignore file and `ignore "pattern"` adds one pattern. Ignored paths leave the implementation fingerprint and the task snapshot; the manifest, contracts, registered memory and ignore lists stay tracked whatever the patterns say, and `task open`, `task check` and `task deliverable --add` refuse an ignored deliverable or input. The manifest errors are `E_MANIFEST_IGNORE`, `E_DUPLICATE_IGNORE`, `E_IGNORE_LIST_MISSING` and `E_IGNORE_LIST_OUTSIDE`; a missing or outside list file stops the project from loading.
- `task note` keeps text on a record without adding unsettled work.
- `task addressed <name> <id> "..." --model <id>` lets the carrying role say what it did about a finding; an addressed finding blocks neither hand-back nor `task close`, and resolving it stays the orchestrator's job.
- `task open --check-argv` and `task check --argv` declare a check as a program and its arguments; a task declares that or a command, never both. `task evidence --run` runs it from the project root without a shell, timeout or process containment, keeps its output in `.blabla/scratch/<name>/evidence-<n>.log`, and records the exit code with `tool` `run`, `command` and `log`. `--check-argv` and `--argv` take every argument after them, so they go last.
- `task open --input` and `task check --input` declare the check's inputs; they default to the write scope and always include the deliverables.
- `task deliverable --remove <path> --reason "..." --model <id>` withdraws what the task owes as the orchestrator's decision, a directory withdrawing every file owed under it; the record keeps why, a path the task does not owe is refused, and `--remove` does not combine with `--add`.
- `task attribute` takes several paths, and the attribution-unknown challenge lists every undeclared path.
- `task accept` records the paths already changed since the record opened.

### Changed

- `task show` prints the routes for the task's current state, a worker's view never names `finish`, and the lens route is offered while the task is ACCEPTED.
- The challenge attributes a changed path inside another open task's scope to that task.
- `status` names the task records it cannot read, says GREEN does not close unfinished tasks, and with several open tasks asks for `blabla challenge <name>`.
- `explain`, `check`, `guide` and the onboarding block say Process roles, policies and flows bind the role that carries the work instead of calling them advisory; the README states what BlaBla does and does not enforce.
- The onboarding block's close says deciding project completion belongs to the orchestrator, never to a worker on a task.
- The worker agent brief keeps discoveries in `task note` and reserves `task finding` for work the worker could not settle; the worker and reviewer briefs say the task record is written only by `task` commands; the reviewer brief names its own review task and the task under review and carries accept, evidence and hand-back.
- A clear challenge on an accepted task names the hand-back, `blabla task ready <name>`, and while a task is in the worker's hands a stale project verification is left to the orchestrator rather than sending the worker to `blabla finish`; the attribution-unknown challenge tells a worker that changed a path itself to restore it or record why with `task block` and stop.
- The generated skill's description fires on behavior and persistence wording.

### Fixed

- Fixed task state labels in task views, directory deliverables, shared check-input freshness, and the distinction between assignment hand-back and project verification.
- Fixed generated skill YAML metadata, added assignment discovery wording, and routed task listings to `task show`.
- A task's `state` decides whether it is open, so a stray `closed_unix` no longer closes an open task; a record written by 0.6, which carries no `state`, still reads as closed.
- Standalone `blabla check <contract.bla>` prints the contract's status, `ERROR` or `RED`, on its first line where it always printed `OK`; exit codes and `--json` are unchanged.

### Evaluation and tests

- The agent integration smoke suite in `evals/` runs eleven cases through Claude Code and Codex CLI on small local models, with and without BlaBla on the same project, from one fixture builder, one case contract and one grader. It is a diagnostic, not a benchmark.
- Agent evaluation: orchestrator-work cases leave the small-model suite; report-only tasks declare a check that can succeed; paired cases carry the same rules `README.md` in both arms; on Claude the builder creates the sandbox's protected paths before the task opens and the scaffold gives `$HOME` readable startup files.
- Agent evaluation reports: the with/without comparison counts only the checks both arms face, where it had counted checks only the arm with BlaBla faces, such as leaving the contracts untouched; every check carries a plain description; the report shows each case as checks against runs with the reason for every miss; the overview lists what each run got wrong; the scorecard folds unmeasured items and absent cases; each run prints a readable result line.
- Added an onboarding drift test and local evaluation evidence tests, including skill-control isolation and bounded artifact export.

### Limitations

- Behavior verification remains bounded; GREEN is not a correctness proof.
- Adapter observations are trusted, and process guidance is not host-level enforcement.
- Process containment is tested on Windows and Linux; macOS is untested.

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
