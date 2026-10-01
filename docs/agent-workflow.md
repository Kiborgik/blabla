# Agent workflow

Start with `blabla status`, follow the printed identities with `blabla explain`, change the implementation, then run `blabla finish`. Do not load every contract or weaken intent to obtain GREEN. In BlaBla's own checkout use `cargo run --release --quiet --bin blabla --` instead of an installed binary.

## Find the relevant context

```text
blabla status
blabla explain system::<name>
blabla explain role::<name>
blabla explain flow::<name>
blabla explain knowledge::<pack>
blabla explain ruling::<pack>::<name>
```

Copy identities from the preceding output. A pack lists ruling/judgment IDs; a flow lists step IDs. Expand only what matters. A role or system can route you to expertise, but that expertise never enlarges your assignment. [Identity and memory reference](project.md#canonical-identities)

For a failing rule, `explain <group>::<label>` supplies the observed fact, counterexample or required witness. If it names `runtime::restart`, explain that identity; do not implement BlaBla's process restart inside the application.

- RED: repair the reproduced violation
- ERROR: make the fact evaluable; do not treat unknown as absence
- YELLOW: reach the named behavioral witness; no violation found is insufficient
- STALE / UNVERIFIED / INTERRUPTED: rerun `finish`; VERIFYING means a run is still active
- OVERALL GREEN: the current canonical project gate passed, within its declared limits

Long runs print progress; `--json` keeps stdout machine-readable and puts progress on stderr. Wait for the actual exit. [Completion states and exits](project.md#layers-and-completion)

## The development loop

![Recover intent, assign a bounded task, accept and implement, record focused evidence and challenge, independently review and correct, then integrate, close and finish. Optional expert advice enters only at supported checkpoints and never decides the gate.](assets/agent-workflow.svg)

Process memory describes the project's roles and order. Task commands enforce recorded prerequisites; BlaBla does not schedule work or launch agents.

| Step | Who / action |
| --- | --- |
| Recover and plan | Orchestrator reads status, relevant memory and `flow::<name>`; defines the change and acceptance criteria |
| Assign | Orchestrator opens a task with role, write scope, deliverables and focused check; optionally `--goal` |
| Accept | Worker reads `task show`, role policies and relevant knowledge, then accepts **before editing** |
| Implement | Worker stays inside scope, answers assigned questions, records uncertainty or blocks when needed |
| Verify | Worker runs the exact declared check, reads its whole result and records evidence; assesses every consulted lens |
| Challenge and hand back | Worker runs `challenge NAME`, then `task ready NAME` |
| Review and correct | Independent reviewer reads task, diff and evidence; records findings. Worker accepts again before repairs, then renews evidence, lenses and challenge |
| Integrate and accept | Orchestrator verifies resolutions, reconciles ownership and confirms any owner records made during carry; closes the task when prerequisites hold |
| Complete | Orchestrator runs project-wide checks and `finish`; a task handoff does not replace the project gate |

The normal task states are `OPEN → ACCEPTED → READY → CLOSED`. `BLOCKED` suspends carried work; `WITHDRAWN` terminates it without completion credit. A READY task must be accepted again before changes or new evidence.

### Minimal command path

```sh
# Orchestrator: choose actual files and a check that covers them.
blabla task open fix-cache --role worker --statement "Repair stale cache reads" \
  --scope src/cache.rs --scope tests/cache.rs --deliverable src/cache.rs \
  --input src/cache.rs --input tests/cache.rs --check-argv cargo test --release --test cache

# Worker: MODEL must be permitted by the declared role.
blabla task show fix-cache
blabla task accept fix-cache --model MODEL
# Implement only inside scope.
blabla task evidence fix-cache --run
blabla task lens fix-cache engineering "Explain the relevant engineering assessment"
blabla task lens fix-cache testing "State what the focused check establishes and misses"
blabla challenge fix-cache
blabla task ready fix-cache
```

This is a workflow template for a project with those files, role and consulted packs, not a runnable cache fixture. `task show` and `guide loop` derive their routes from the same source. Use the lenses your role actually consults, not names copied from this example.

## Bounded tasks and current evidence

A task under `.blabla/tasks/` is a machine record, not authored memory or proof of work. Opening it snapshots the tree. Deliverables must change from that snapshot; directory deliverables expand to files, and `deliverable --add DIR` refreshes that set. Ignored output and `.blabla/` are not deliverables.

- Live write scopes, including READY assignments, must be disjoint normalized project-relative paths. Root, escape, symlink and unsafe drive-relative paths are refused atomically. Read inputs may overlap
- Evidence covers scope plus deliverables by default. `--input PATH` on `open`/`check` substitutes explicit dependencies; deliverables always remain included. Directory inputs include descendants; creation/deletion also invalidates evidence. Dependency declarations are the orchestrator's claim, not automatic discovery
- Evidence binds exact `Text` or `Argv` check identity, argument boundaries, acceptance epoch and input digests. A new acceptance, even on the same model, starts a new epoch. Mid-run declaration/input changes preserve the observed result without granting credit to the replacement
- `task evidence --run` executes a declared argv check from the project root without a shell. It has no task-runner timeout or process containment; choose a bounded check. For a text check, run it yourself and record the real `--exit CODE --tool TOOL`
- READY needs ACCEPTED ownership, current successful exact-check evidence, current required lens assessments and an explicit assignment challenge receipt. Relevant edits/findings/policy changes invalidate the receipt; unrelated concurrent work does not
- CLOSE rechecks evidence, receipt and the current project report. Task acceptance and project verification answer different questions; neither replaces the other

### Common changes and recovery

| Need | Command / rule |
| --- | --- |
| Preserve a nonblocking observation | `task note NAME "…"` |
| Record unsettled work / stop | `task finding NAME "…"` / `task block NAME "…"` |
| Describe a repair | `task addressed NAME ID "…" --model MODEL`; an addressed finding no longer blocks hand-back, but resolution stays the orchestrator's |
| Resolve a finding | `task resolve NAME ID --evidence "…" --model MODEL` |
| Correct check/dependencies | `task check NAME --input PATH --argv PROGRAM ARG…`; omitting inputs restores scope defaults |
| Change owed files | `task deliverable NAME --add PATH`, or `--remove PATH --reason "…" --model MODEL` |
| Widen scope / attribute changes | `task scope NAME --add PATH`; `task attribute NAME PATH… --kind task\|concurrent\|unknown --model MODEL` |
| Propose another model | `task propose-model NAME MODEL --reason "…"`; owner rules with `task approve-model` |
| Withdraw | `task withdraw NAME --reason "…" --model MODEL` |
| Settle withdrawal residue | Restore original bytes, or `task reconcile-withdrawal NAME PATH --successor TASK --model MODEL` against current successful evidence from a CLOSED successor |

Declaration changes, attribution, withdrawal and reconciliation are orchestrator decisions. A withdrawn task releases scope, but its changed paths remain project challenges until settled; reconciliation can become stale. Restoration cannot prove authorship. Restore identifiable own out-of-scope edits when safe, preserve uncertain evidence and block for owner reconciliation. Merely blocking does not settle a changed path.

## Asking instead of guessing

```sh
blabla task decide fix-cache "Is the cache the cause?" --pick yes --confidence 55 --model MODEL
blabla task decide fix-cache "Which lock?" --options read,write,none --pick write --confidence 80 --model MODEL
```

Without `--options`, picks are `yes`/`no`; otherwise pick one declared option. Confidence is a whole number 0–100. Only an accepted carrier may decide. At or above the role's `block_below`, the pick STANDS; below it, the task becomes BLOCKED immediately. Stop rather than act on that pick.

The orchestrator answers with `task answer NAME ID --pick OPTION --reason "…" --model MODEL`. The worker reads the answer and accepts again. Unanswered below-floor decisions prohibit acceptance and hand-back. An answer settles or overrules the pick; historical confidence does not keep an answered decision blocking. Answering alone does not resume a blocked task or invalidate a READY receipt.

### Questions from the orchestrator

```sh
blabla task ask fix-cache "Is this failure in scope?" --floor 90 --model OWNER_MODEL
blabla task decide fix-cache --on q1 --pick yes --confidence 95 --model MODEL
```

An asked question can raise, never lower, the role's floor. Pick it once, without repeating its text/options. Unpicked questions block READY, including questions asked after hand-back; reaccept first. `task show` prints the exact route and current answered/overruled pick. `explain role::<name>` summarizes answered decisions per model; that is calibration of recorded claims against owner rulings, not authenticated model accuracy.

## Current worker assessments and explicit reviews

Each `task lens NAME PACK "…"` assessment binds the accepted model, epoch and relevant consulted knowledge. Reacceptance or changes to that knowledge require a new assessment; unrelated packs do not. Old unbound assessments stay readable history. Use a consulted pack name, not a ruling ID.

Unresolved model proposals follow the assignment that made them. Replacement supersedes earlier proposals except one for the replacement itself; same-model reacceptance keeps its unresolved proposal standing. Approval still requires an owner ruling.

```sh
blabla task open review-cache --role reviewer --statement "Review cache repair" \
  --review-of fix-cache --input tests/cache.rs --check-argv cargo test --release --test cache
blabla task accept review-cache --model REVIEWER_MODEL
```

A review target must exist, be distinct and not withdrawn; cycles are refused. Acceptance binds the target's epoch, declarations, decisions, findings, inputs, deliverables and relevant memory, plus the reviewer's own policy/knowledge and explicit inputs. Concurrent attribution does not remove declared dependencies. Unrelated notes/paths/packs do not stale the review. A stale inner review invalidates dependent review chains.

If the target changes, reaccept an open review, inspect the new work, rerun its check and renew lenses/challenge. A running check retains its real observation but cannot approve a changed target. A CLOSED review remains historical CLOSED with no current approval; open a replacement review. `--review-of` does not impose review on unrelated tasks or infer links for old records.

## What --model attests

Model IDs and task records are caller attestations, not actor authentication. Roles can list models and owner-declared aliases, but a caller can still claim another identity or edit state files outside BlaBla.

Owner-only mutations made while a worker carries an ACCEPTED task are retained as unconfirmed records. They ground `orchestrator-record-during-carry`: READY remains possible, CLOSE is refused. After hand-back the orchestrator checks them and runs `task confirm NAME --model MODEL`, even if it undid the change. Confirmation is refused during carry and preserves the record. Later owner mutations during carry require another confirmation. OPEN/BLOCKED/READY mutations do not receive that carry challenge.

## Challenging the account of the work

`blabla challenge NAME` reports one strongest grounded discrepancy; on ACCEPTED it also records or clears the assignment receipt. Project-only inspection is nonmutating. A selected nonterminal task exits on assignment status (0 clear, 1 blocked), separately reporting `assignment_blockers` and `project_challenges`; without a selected task, exit 1 means a standing challenge.

| Evidence | Challenge classes |
| --- | --- |
| Task findings and snapshot | `unresolved-finding`, `deliverable-unchanged`, `scope-breach`, `work-without-acceptance`, `attribution-unknown` |
| Role, decisions and owner records | `model-outside-role-policy`, `exception-unresolved`, `decision-unanswered`, `question-unpicked`, `orchestrator-record-during-carry` |
| Check, review and knowledge revisions | `declared-check-failed`, `readiness-without-evidence`, `evidence-superseded`, `review-target-stale`, `lens-unassessed` |
| Project facts | `vacuous-rule`, `verification-not-current`, `withdrawal-residue`; `goal-outcome-unmet` for a done goal when no task is selected |

Unavailable evidence is named rather than treated as clean. The skeptic reads no semantic meaning from code; independent review still matters. Silence means no reachable contradiction, not approval. `finish` may display a challenge beside its verdict without changing its completion decision or exit code.

## Authoring and optional expert advice

- `blabla guide bootstrap` starts a project; `init --agents` writes managed onboarding and skills under `.agents/skills/blabla/` and `.claude/skills/blabla/`
- `blabla guide change` separates intended contract changes from implementation fixes
- `blabla guide memory` and `check FILE.bla` author/validate memory; VALID does not prove it describes the repository
- `check FILE.bla` and `check --falsify FILE.bla` author [structure contracts](structure.md#falsification); neither is completion
- [Expert judgments and bindings](expert.md) add optional checkpoint advice. Reading `status`, `explain` or `check` never calls a provider. Advice grants no write permission, deterministic evidence or task-completion credit

## Upgrading task records to 0.10

Legacy evidence/lens records remain readable history without current credit. Reaccept, rerun the exact check, reassess consulted packs and obtain a fresh challenge before READY. Old reviews need an explicit review relationship; historical CLOSED alone is not fresh approval. JSON clients must handle `WITHDRAWN`, exact check/epoch/input bindings, assessment/review freshness, current decision picks and separate assignment/project challenges. [Breaking notes](../CHANGELOG.md#0100-unreleased)
