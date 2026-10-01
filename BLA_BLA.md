# BlaBla: project authority

BlaBla makes selected project intent **executable and queryable**. Behavior contracts constrain observations of a running application; Structure contracts constrain static code facts. Mission, System, Process, Knowledge and Goals preserve the reasoning around them. Humans and agents query only the relevant identities.

This file defines current product invariants, not release history or evidence. [Changelog](CHANGELOG.md) · [research](docs/research.md) · [release evidence](docs/design/0.10-release-evidence.md)

## Entry and authority

- `project.bla` is the machine entry point; `blabla status` is the user/agent entry point
- In **this repository**, follow [AGENTS.md](AGENTS.md) and run the working tree through `cargo run --release --quiet --bin blabla -- …`. An installed or previously built binary is not authority for changing source
- Owner intent is authoritative about what the project is for. Evidence that challenges it must be surfaced as a proposed change, not silently treated as new intent
- Repository state and deterministic results outrank agent self-reports. A result establishes only what it actually checked; inspect its inputs, complete output and limits
- Every explainable object has one canonical identity. Copy identities printed by `status` and `explain`; do not reconstruct them from prose

## Semantic invariants

1. **WHAT, not HOW.** State is abstract observation, not prescribed storage. Implementation stays ordinary code
2. **Completion has two layers.** Only active Behavior and Structure decide `OVERALL`. At least one must be active. `finish` runs the canonical campaign and evaluates structure live; all other memory, tasks and expert advice stay outside that decision
3. **No success through missing evidence.** GREEN means exercised and satisfied under the finite campaign or observed structural facts. YELLOW means unexercised behavior. RED means a confirmed violation. Unevaluable facts are ERROR; absent and unreadable are different
4. **No stale GREEN.** Behavior evidence is bound to source, contracts, profile and verifier identity. Structure is evaluated live. Interrupted verification cannot retain current completion credit
5. **Do not weaken intent to pass.** Editing contracts or the verification profile is a separate authorized authoring act, not implementation repair
6. **Deterministic decisions.** Fixed source, contracts, build, settings and seed produce the same facts, identities and logical ordering. Timings and opaque protocol IDs are not decision inputs
7. **One implementation per semantic boundary.** Single-file and composed contracts share the compiler/evaluator. Human and JSON reports render the same values. Runtime primitive semantics have one source

The exact states, exits, discovery and fingerprint limits live in [Project](docs/project.md#layers-and-completion). `check` is an authoring check, never completion; [structure falsification](docs/structure.md#falsification) tests whether the evaluator depends on the named fact, not whether that fact expresses the right intent.

## Trust boundaries

| Boundary | What is trusted / limited |
| --- | --- |
| Application adapter | Observations must expose the real application. Fabricated observations defeat verification; BlaBla is not a sandbox |
| Behavior search | Finite and heuristic. Undeclared behavior and unvisited input/state combinations are not certified |
| Structure inspection | Providers parse without executing project code. Unknown facts are ERROR; each provider has explicit [analysis limits](docs/structure.md#providers) |
| Authored memory | Internally validated; never checked for truth against the repository. Mission sets intent; Knowledge gives expertise, never additional write permission |
| Task record / `--model` | Attestations, not authenticated identity or filesystem enforcement. Lifecycle, evidence, declared ownership and review prerequisites are checked; arbitrary writes are not intercepted |
| Expert result | Bounded selected context plus fixed policy, never correctness authority. Missing/stale context, unavailable hosts and unqualified providers do not acquire capability from assertions or fixtures |
| Process containment | Windows Job Objects and Unix process groups; Linux/Windows lifecycle tests exist. macOS remains unverified |
| Fingerprint | Does not cover implicitly loaded implementation outside the manifest tree unless otherwise included by tracked command inputs |

## Development state and optional experts

Authored `.bla` memory describes intended purpose, architecture and process. `.blabla/tasks/` records actual assignments, evidence and findings. `challenge` compares that record with available deterministic evidence; it does not semantically review code. Project completion and task acceptance remain separate. [Full workflow and current-credit rules](docs/agent-workflow.md)

Expert judgments and bindings are authored memory; packets, settings, traces and reservations are machine state. The implemented expert core, calibration tools and cooperative native adapter are optional. They neither schedule arbitrary work nor guarantee always-on interception. Ordinary advisory promotion and explicitly permitted native experiments have distinct admission paths. Repository bindings remain shadow-only, with no promoted judgment or demonstrated runtime expert benefit. [Expert reference](docs/expert.md)

## Non-goals

Do not turn BlaBla into a general-purpose language, BDD framework, Spec Kit clone, theorem prover, agent orchestrator or TLA+/Dafny/P replacement. No arbitrary loops, user functions, classes/inheritance, algorithms, generated implementation, distributed/temporal verification, parallel actors, IDE/LSP or prose-to-contract generation.

Keep one current contract language and API, without parallel compatibility implementations. Preserve documented upgrade/revalidation paths and readable historical task records. Knowledge is reused by file path, with no registry, package manager or fetcher. `context` was declined because it duplicated `status` and split onboarding.

Structure does not enforce style, line counts, call order or type-inferred behavior. Process flows describe who should act; BlaBla does not launch agents. The utility of each memory kind, reduced handoff cost and benefits at different model sizes remain empirical questions.

## Canonical references

- [Language](docs/language.md): Behavior semantics and JSON Lines protocol
- [Structure](docs/structure.md): static grammar, provider semantics and falsification
- [Project](docs/project.md): manifest, memory schemas, identities and completion
- [Agent workflow](docs/agent-workflow.md): bounded tasks, review, recovery and attestation
- [Expert](docs/expert.md): typed judgments, configuration, host boundaries and qualification
- [Architecture](docs/architecture.md): implementation components and stable interfaces
- [Contributing](CONTRIBUTING.md): verification ownership and change procedure

Queryable counterparts are registered explicitly in `project.bla`: `mission.bla`, `system.bla`, `process.bla`, `goals.bla` and `knowledge/*.bla`. Unregistered files supply no project memory.
