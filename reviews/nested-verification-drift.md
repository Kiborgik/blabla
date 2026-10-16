# Nested-project changes and root verification

Diagnosis by actual gpt-6-astra/high under `diagnose-nested-verification-drift`. No verifier, manifest, ignore policy or closure gate was changed. The executable probe writes only temporary isolated projects and invokes the current checkout through Cargo.

## Result

The coupling is real and currently deliberate: a root verification record binds the nonignored implementation tree, including nested projects. A nested `project.bla` is not a declaration of verification independence. A parent task can have current focused evidence and a CLEAR assignment while a changed child file makes the project verification stale and prevents CLOSE.

Automatic exclusion at nested manifests is unsafe. The probe also demonstrates a parent application importing a child file: changing it genuinely breaks the parent's behavior contract. In a separate fixture, blanket child ignore leaves the old behavior result GREEN although a fresh run fails. Therefore neither a child manifest nor the absence of an explicit module declaration proves independence.

## Exact dependency path

- [`src/cli/project.rs`](../src/cli/project.rs), `verify_and_record`/`fingerprinted_files`: after canonical verification, the record stores `Project::fingerprint` and absolute existing executable/argument files. The root's actual extra file is `target/debug/examples/structure-adapter`.
- [`src/project/mod.rs`](../src/project/mod.rs), `Project::fingerprint`, `fingerprint`, `walk`: recursively hash all nonignored root files, excluding the root manifest and registered contract files (their identity is checked separately). The walk does not stop at another `project.bla`. It skips symlinks and built-in generated/internal directories and obeys the root's declared ignore lists. Command files are hashed additionally, even when otherwise ignored.
- [`src/project/status.rs`](../src/project/status.rs), `evaluate`: compare the current aggregate to `Record.implementation_fingerprint`; inequality yields `implementation` staleness. The record stores no per-file baseline, so the exact historical changed path cannot be reconstructed from this aggregate.
- [`src/cli/task.rs`](../src/cli/task.rs), `close`: first checks the task challenge, then evaluates project status and live structure, and counts grounded challenges. `verification-not-current` prevents acceptance even when the task-specific evidence is current. READY deliberately permits that project-level challenge.

The implementation-tree boundary is documented in [project freshness](../docs/project.md#layers-and-completion). [`inventory`](../src/project/inventory.rs) has a separate nested-project discovery boundary; it does not control verification. Project discovery chooses the nearest manifest for a command, not the ownership of every transitive runtime dependency.

## What root currently includes

The documentation task's opening snapshot contained 102 nonignored files under `examples/agentic-mmo/`, including its manifest, contracts, planning documents, `core/content.ts`, `core/simulation/economy.ts`, `core/simulation/operations.ts`, `server/worker.ts` and `server/repository.ts`. All are ordinary implementation inputs to root hashing unless separately registered as root contracts. Root `.gitignore` excludes MMO node_modules, dist and browser-test artifacts; the child ignore list is not implicitly loaded.

The inspected root manifest, Cargo configuration, contracts, bridge and source contain no direct `agentic-mmo` reference. Root structural modules name root source/experiment files, and its behavior command is the Rust adapter. That is useful negative evidence, not a complete transitive read graph. The broader [`experiments/gate.py`](../experiments/gate.py) intentionally runs several other nested examples and audits the public tree; a universal nested-project exclusion would also erase such legitimate coupling.

Root structure declarations identify files for live provider inspection. They are not an exhaustive behavior dependency list: a Python import, dynamically opened data or a subprocess can read additional files. The probe uses `runpy` to demonstrate this without putting the child helper on the command line. Conversely, explicitly naming that helper as a command argument keeps it fingerprinted even under a blanket child ignore. Registered contracts, memory and ignore lists have separate loader protection; those mechanisms do not infer every runtime dependency.

## Reproduction

Run from this checkout with its Rust/Python toolchain:

```sh
python experiments/nested_verification_probe.py
```

Nine assertion groups exercise current behavior:

1. A parent task changes one parent file, runs its exact check, obtains a current project finish, challenges and reaches READY.
2. An attributed, disjoint child edit makes parent behavior STALE; the assignment remains CLEAR, but CLOSE fails with the project challenge. A child `.gitignore` alone does not hide the file.
3. Restoring just the changed child bytes permits CLOSE without rerunning the parent task check.
4. Renaming the child project in its manifest also stales parent verification.
5. A directory explicitly ignored by the parent does not stale verification when its generated output changes.
6. Changing the implicitly imported child helper stales the parent and makes a fresh behavior run RED.
7. Removing a symbol from a child module explicitly named by the parent contract fails live structural inspection.
8. Blanket child ignore hides the implicit helper change from cached behavior freshness, but a fresh run still fails.
9. Explicitly placing that child helper on the command line restores its fingerprint coverage despite the ignore.

These are observed fixture outcomes, not a proposed new gate. The probe initially exposed harness assumptions (attribution requires an existing change; STALE exits 5). Those were corrected using an accepted concurrent child task and the actual status schema. It does not claim a production RED→GREEN fix.

## Smallest sound response

For the current checkout, use a short coordinated write pause for the integration finish-and-close sequence. This respects the whole-tree contract and preserves relevant source. No universal nested exclusion or task-only CLOSE bypass is justified by this diagnosis.

If the interruption becomes a sustained bottleneck, first propose a narrowly scoped read-only diagnostic that records/reports project fingerprint input differences using the same walker. It must include extra command files, added/removed/unreadable paths and actual ignore/protection behavior; legacy aggregate-only records must say that exact deltas are unavailable. This would identify the responsible future path without weakening freshness.

A later independence feature would require explicit owner-approved project boundaries and a complete enough dependency declaration to retain root-imported child code, contracts, provider inputs, command inputs and relevant product checks. The implicit-import counterexample must remain covered. Such a language/policy change is separate work, not a safe consequence of seeing another manifest.

## Evidence limits

The historical 11:07 root finish was GREEN before the next closure sequence, and the subsequent task challenge retained current affected-intent receipts while reporting implementation drift; [the workflow review](goal-workflow.md#bounded-successor-research-project-snapshot-and-closure) preserves that incident. No per-file verification baseline was stored, so this investigation cannot prove which historical edit first caused that refusal.

The task's declared check is the isolated probe above; its stored log records the final observed exit. No root finish, broad suite, external service action or source change is part of this research. The production question answered is the dependency mechanism and a counterexample to unsafe exclusion, not the truth of arbitrary application dependency declarations.
