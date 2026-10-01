# BlaBla 0.10.0

BlaBla keeps project intent queryable and verifies declared Behavior and Structure contracts. Version 0.10 adds revision-bound task handoffs, explicit write ownership and an optional experimental expert layer.

## Breaking changes and upgrade

- Task evidence binds the exact check, declared inputs and acceptance epoch. Existing evidence remains readable history but cannot approve current work. Reaccept, rerun the declared check, reassess consulted knowledge and challenge before hand-back; same-model reacceptance also starts a new epoch.
- Lens and review credit is revision-bound. Explicit reviews use `task open --review-of`; a historically CLOSED review may no longer provide current approval. Unlinked legacy reviews gain no inferred approval.
- Live write scopes cannot overlap. Unsafe, symlink, ignored and built-in-skipped task declarations are rejected; legacy invalid declarations lose current credit. Terminal `WITHDRAWN` releases ownership without certifying completion, and changed paths still require restoration or explicit successful-successor reconciliation.
- Windows ownership and evidence matching is case-insensitive while preserving observed path spelling. Unix matching stays case-sensitive.
- Task/challenge reports expose exact checks, freshness, current decision picks and separate assignment/project blockers. JSON clients must handle `WITHDRAWN` and the new report fields.
- Typed `judgment::<pack>::<name>` and `binding::<name>` definitions extend Knowledge and Process. `judgment` and `binding` are reserved contract groups; rename collisions with `as`. Status/check JSON adds expert-definition and shared-state fields.
- Expert packet/provider/policy/trace APIs use strict bounded schemas. CLI, trace and native surfaces remain experimental. Generator changes can change seeded trajectories between verifier versions.

The [upgrade procedure](https://github.com/Kiborgik/blabla/blob/release/0.10-expert-loop/docs/agent-workflow.md#upgrading-task-records-to-010) explains current evidence and review credit.

## Added and improved

- Fixed Choice/Noul/ordered Score judgments, selected bounded context packets, explicit missing/truncated context, validated provider transports, deterministic policy and saved-response replay.
- Real-response calibration, preflight and policy-fitting tools; cooperative native completed-idle-turn experiments with scoped revocable permits and matched-run tooling.
- Stronger exact-check, in-flight assignment/input, stale-review, withdrawal and model-proposal safeguards.
- Broader String generation boundaries and companion-field-preserving witnesses, Python adapter strict UTF-8, C persistence for space-only items, and a separate Windows C compiler preparation timeout.
- Current-source self-hosting and portable verification, with deterministic expert seams kept separate from live expert-quality evidence.

## Expert qualification limits

The expert layer remains experimental and repository bindings remain shadow-only. Zero judgments are promoted. Real Kev calibration selected **no feasible policy**; offline fixtures, replay and dogfooding do not demonstrate useful live steering or reduced development effort. Codex CLI delivery remains blocked, while Luna repository inference and Jev remain unverified. Qualification is required before enabling advisory delivery; the deterministic product can be used with the optional expert layer disabled.

See the [full changelog](https://github.com/Kiborgik/blabla/blob/release/0.10-expert-loop/CHANGELOG.md#0100-unreleased) and [release evidence](https://github.com/Kiborgik/blabla/blob/release/0.10-expert-loop/docs/design/0.10-release-evidence.md) for the checks performed and their limits. These notes do not themselves create a tag or publish an artifact.
