# Agent workflow

Start with `blabla status`, open what it points to with `blabla explain`, change the code, then run `blabla finish`. Never weaken a contract to get GREEN. In BlaBla's own checkout use `cargo run --locked --quiet --bin blabla --`.

- **RED**: fix the broken rule; `explain` shows the shortest failing steps
- **ERROR**: make the fact readable; unknown is not absent
- **YELLOW**: reach the witness `explain` names; "nothing broke" is not enough
- **STALE, UNVERIFIED, INTERRUPTED**: run `finish` again. VERIFYING means a run is still going; wait for the real exit
- **`runtime::restart`** in a result is BlaBla's own restart; read it with `explain`, do not build it into the app

Copy identities from the output; never build them. [States and exit codes](project.md#layers-and-completion)

## Find registered and forgotten intent files

Run `blabla inventory` when the project's `.bla` files grow. Add `--json` for structured rows or `--project PATH` to select a manifest. Inventory uses the same manifest parser, path resolution, aliases and ignore protection as the project loader. It lists the manifest, active/draft contracts and registered memory with their declared path, resolved path, kind, readability and registration location. Contract rows expose the declared canonical group; memory contents and rule-level identities are not parsed by this command.

Discovery separately lists unregistered `.bla` files as candidates with unknown kind. An unregistered example or fixture may be intentional. Inventory never parses those files, activates a contract, validates contents, maps requirements to implementation, changes goals or writes `.blabla/` state. A readable file can still contain invalid BlaBla. Use `check`, `status` and `explain` for their existing purposes; only `finish` decides completion.

The scan follows the project's declared ignore rules and built-in generated/internal directory exclusions. Explicit registrations retain the loader's protection from ignore rules. Discovery stops at directories containing another `project.bla` and at symlinks; it does not scan external directories. An explicitly registered external shared file or file inside a nested project remains listed. A symlink in a registered file's path is reported without opening its target.

Output is sorted. Discovery defaults to a budget of 20,000 directory entries, including skipped entries, and a depth limit of 64. `--max-entries N` selects a budget from 1 to 100,000; one additional entry may be examined to detect overflow. A budget, depth or directory-read failure produces an explicit incomplete report and exit 1. Missing, unreadable, non-file or symlink registrations also exit 1 while retaining their rows; unregistered candidates alone do not. Manifest and ignore-list errors retain the existing diagnostics. A complete inventory means discovery finished within these boundaries, never semantic consistency or verified coverage.

## Inspect a goal's explicit coverage links

`blabla explain goal::NAME` adds registration and exact-resolution details for each declared expectation. `--json` preserves the existing goal fields and adds `coverage`, `linked_work`, `task_problems` and `coverage_authority`.

Each coverage row carries the original identity and real existing verdict, its canonical contract group, active/draft/unregistered registration, declared path/layer and manifest location when registered. An active group with a missing exact rule differs from an unregistered group. Partial names receive no credit. A draft contract is visible, but a rule named under that draft is `draft_rule_unchecked`: this view does not establish its membership or promote it. A resolved rule may still be not held or unverified. Normal project-loading errors remain errors; use `inventory` to inspect a registered missing file without loading the project.

`linked_work` lists only tasks explicitly assigned with that goal, including each task's actual scope, state, declared check and existing tracked-evidence readiness. `latest_exit`, when present, belongs to the latest matching check in the current acceptance epoch. A stale passing exit is retained beside `current: false`; an earlier epoch never supplies current credit. `task_problems` exposes unreadable records rather than silently treating them as absent. An unrelated maintenance task needs no invented goal and is not listed as linked work.

The task link is goal-level. It does not say that a task's scope implements every expected rule, that a broad contract fully captures the goal statement, or that a passing check establishes semantic coverage. No percentage or inferred implementation mapping is produced. Explaining a goal changes neither its declared state nor task records, evidence or OVERALL; only `finish` decides completion.

Read-only examples from BlaBla's checkout (the goal and task already exist):

```sh
cargo run --locked --quiet --bin blabla -- explain goal::hand-backs-survive-concurrent-work --json
cargo run --locked --quiet --bin blabla -- task show explain-goal-coverage --json
```

Use coverage to inspect the declared links, the task view to inspect current evidence, and the optional reflection below to record the next goal decision. These answer different questions; none replaces owner acceptance.

## The loop

![An orchestrator assigns a bounded task; a worker accepts, implements, records evidence and hands back; a reviewer looks for defects; the orchestrator closes and runs finish.](assets/agent-workflow.svg)

| Step | Who does what |
| --- | --- |
| Plan | orchestrator reads `status`, memory and `flow::<name>`; names the change and how to accept it |
| Assign | orchestrator opens a task: role, write scope, deliverables, check, optional `--goal` |
| Accept | worker reads `task show` and accepts **before editing** |
| Implement | worker edits only inside its scope; asks or blocks when unsure |
| Verify | worker runs the exact check, reads the whole result, records evidence and one lens per consulted pack |
| Hand back | worker runs `challenge NAME`, then `task ready NAME` |
| Review | a separate reviewer reads task, diff and evidence and records findings; the worker accepts again to repair |
| Close | orchestrator resolves findings, confirms records it made during the carry, closes the task |
| Done | orchestrator runs `finish`; a closed task never replaces the project gate |

States: `OPEN → ACCEPTED → READY → CLOSED`. `BLOCKED` pauses; `WITHDRAWN` ends without credit. A READY task is accepted again before any change. BlaBla checks these steps; it does not launch agents.

```sh
blabla task open fix-cache --role worker --statement "Repair stale cache reads" \
  --scope src/cache.rs tests/cache.rs --deliverable src/cache.rs \
  --check-argv cargo test --release --test cache
blabla task accept fix-cache --model MODEL    # MODEL must be allowed by the role
blabla task evidence fix-cache --run          # runs the argv check, records its exit
blabla task lens fix-cache testing "What the check proves and what it misses"
blabla challenge fix-cache
blabla task ready fix-cache
```

Use the packs your role consults, not the ones in this example. `task show` prints the next routes for a task; `blabla task --help` lists every verb.

Attest your actual model ID with `task accept --model`; effort is separate, and spelling is preserved exactly. Acceptance records the assignment, not model permission: text and JSON warn immediately when the ID is outside the role's exact models and declared aliases without an approved nonsuperseded exception, or when registered policy is unavailable. Resolve this before work using `task propose-model NAME MODEL --reason ...` and the owner's `task approve-model NAME MODEL --approval ...` ruling, or repair unavailable policy; never claim a different model to fit the list. Approval preserves the acceptance epoch and existing evidence and still requires normal carry confirmation; reacceptance starts a new epoch. This local diagnostic does not replace the process's immediate post-acceptance challenge or authorize other guarded operations.

When registered process memory declares roles, `task open --role NAME` must name
one exactly. Unknown names are refused before creating task-store files, with the
available roles listed; they cannot silently discard model or lens obligations.
Registered process memory that is missing, unreadable or invalid also refuses
creation. Bootstrap remains available when no process is registered, or a valid
registered process declares zero roles. Existing tasks are not renamed or migrated.
The role check runs before locking and again inside creation; it does not promise
atomic isolation from concurrent edits to process memory.

## Evidence that stays current

- Opening a task snapshots the tree. Each deliverable must change from that snapshot. A path that becomes ignored later no longer counts as a change
- Live write scopes never overlap; reads may. A scope is project-relative: absolute, `..` and symlink paths are refused. Inputs and deliverables also refuse skipped and ignored paths
- Evidence covers the scope and deliverables, or the `--input` list you declare. It binds the exact check, its arguments, the acceptance epoch and the input digests. A new acceptance starts a new epoch, even for the same model
- `task evidence --run` runs an argv check from the project root with no shell and no timeout, so pick a bounded check. Capture has a 64 MiB combined stdout/stderr limit; an overflow stops the owned process tree, retains bounded partial bytes and records no new evidence. For a text check, run it yourself and record `--exit CODE --tool TOOL`
- READY needs current passing evidence, current lens assessments and a fresh challenge receipt. Relevant edits or new findings void the receipt; resolving a finding and unrelated work do not
- Lenses: every pack the role consults, or only the packs named with `task open --lens PACK`. A pack the role does not consult is refused
- `task show` prints the latest evidence (tool, epoch, exit, log) and every lens assessment; `task evidence --run` prints the same receipt. It also lists the falsify paths and the latest falsification, the paths changed since the task opened and, for a review, the paths its target changed
- `task open --falsify PATH` names production files the check must catch. `task falsify NAME` copies the tree into the task's scratch and runs the check there twice: on the current files, then with those paths as they were at open. Hand-back needs a pass, then a failure, with the inputs unchanged since. Any non-zero exit counts as a failure, a compile error included, so read the opened log: a build error there proves nothing about a test. Tests reach the change through a surface that existed before it, live outside the falsify paths (a test inside one reverts with it), and the check keeps running after a failure (`cargo test --no-fail-fast`). The working tree is never touched. Falsify judges the whole check: a new test that passes on old code hides behind one that fails, so declare a narrow check for the test that matters. A check that names the project by absolute path reads the real tree in both runs and never counts. The copy holds only the tree snapshot, so a check that reads an ignored directory or a file outside the project root by a relative path fails on the current files and falsify reports that instead of judging; environment variables reach the check unchanged
- CLOSE checks it all again. Task acceptance and project verification answer different questions

| Need | Command (add `--model M` where `--help` asks) |
| --- | --- |
| note, finding, stop | `task note`, `task finding`, `task block` |
| report or resolve a fix | `task addressed NAME ID "…"` (worker); `task resolve NAME ID --evidence "…"` (orchestrator) |
| fix the check or its inputs | `task check NAME --input PATH… --argv PROG ARG…` |
| explicitly return check inputs to scope defaults | `task check NAME --reset-inputs` |
| widen scope and fix the check at once | `task check NAME --add-scope PATH… --argv PROG ARG…` |
| change deliverables or scope | `task deliverable NAME --add\|--remove PATH`; `task scope NAME --add PATH` |
| change the statement | `task statement NAME "…"`; the hand-back must be challenged again |
| withdraw | `task withdraw NAME --reason "…"`; changed paths stay challenged until restored or `task reconcile-withdrawal` names a CLOSED successor with current evidence whose inputs or deliverables cover them; the reconciliation then stands while that successor stays closed, and later changes belong to later tasks |

Scope, check, attribution and withdrawal changes are the orchestrator's. Resolving, answering, confirming, attributing, removing a deliverable, withdrawing and reconciling need `role::orchestrator` declared in process memory, so a worker cannot settle its own obligations; without it, `task open` says so up front, and an optional `--model` on `task check`, `task scope` or `task statement` is recorded unchecked. BlaBla options go before `--argv` and `--check-argv`: everything after them is the check, and an argument there that matches a BlaBla option is kept and reported. After hand-back, the orchestrator checks records it made during the carry and runs `task confirm` once before `task close`. A task assigned to role `orchestrator` needs no confirmation: its own records never count as made during a carry.

### Source-isolated verification

Use separate build-output directories for different source variants or worktrees.
Sharing registry/download caches is fine; sharing an executable output path lets
another source build replace the CLI a running integration test invokes. Verify
the actual tested executable identity, not just the Cargo command's working tree.

### Evidence-run observations

While an argv check runs, `task show NAME` (including `--json`) includes bounded,
content-free `evidence_progress`. It reports last-observed phase, observation age,
stdout/stderr bytes written, EOFs, typed child outcome and evidence recording.
A persisted `running` observation is **not** proof that a process is running now;
its outcome remains unknown. A parent that exited while a descendant retains its
pipes is `draining`, not complete. There is no percent complete, ETA, deadline,
automatic retry, recovery credit or new cancellation command.

Each attempt gets a private `evidence-run-ID` directory in the existing task
scratch with `stdout.partial`, `stderr.partial` and atomically replaced
`progress.json`. On Unix, new run directories are mode 0700 and files mode 0600.
Progress contains only allowlisted metadata and opaque pin fingerprints: no argv,
environment, raw output or unrestricted errors. Output is not streamed to the
console. JSON command stdout remains one document. `task show` reads at most 20
sidecars, each at most 16 KiB, and reports omitted/unavailable observations.
Malformed or symlinked observations provide no credit. Capture publication checks
that the original scratch/run ancestry still matches before finalization and
receipt recording. Unix creation, publication and cleanup use held directory
handles without following symlinks; a redirected path grants no evidence and is
not used for cleanup. Already-open partial spools may retain bytes after a rename.

A complete log preserves exact bytes as stdout followed by stderr, including NUL
and non-UTF-8 bytes. Both pipes drain concurrently. Counts mean successfully
written bytes, not a power-loss durability guarantee. Successful finalization
syncs and publishes the ordinary evidence log without replacing an existing
file, then removes partial spools. Spools plus the concatenated temporary log
use at most 128 MiB per attempt (twice the capture cap), excluding small metadata;
concurrent attempts each have their own cap. Failed attempts retain useful
partial files and can require manual scratch cleanup.

Only complete capture with an observed numeric child exit can append the original
receipt, with the original check identity, input/member pins and acceptance epoch.
A nonzero child exit remains that exact integer; the CLI's successful storage exit
is not the child's result. Signal termination can retain a complete log but grants
no integer-exit evidence. Capture/read/write/sync/publication failures grant no new
evidence. Prior evidence remains subject to the existing freshness rules.

Cleanup after an observed capture failure is bounded and best effort for the owned
process tree; a detached descendant or incomplete cleanup is not reported as
terminated. No graceful interrupt handler or durable supervisor is installed.
SIGKILL, wrapper death or an unhandled interruption can leave only partial bytes
and last observations, with the child outcome unknown. Progress never fabricates
an exit or rebuilds a receipt. The task record is authoritative even if a crash
leaves the sidecar's recording status stale; `receipt_observed` checks for the
exact expected receipt in that record, not just a sidecar claim.

`task check` is an amendment, not an inspection command. A bare or model-only call, including an empty `--argv`, refuses without changing the task or its receipts; use `task show NAME` to inspect the saved check. Changing the command or adding scope without `--input` preserves the previous explicit input list. If no explicit list exists, the write-scope default remains in effect. `--input PATH…` replaces the whole list; `--reset-inputs` deliberately restores the write-scope default and conflicts with `--input`. Deliverables remain included either way. The resulting inputs must remain observable; a normal tracked path that does not exist yet is still admissible and its later creation stales evidence. Explicitly repeating an identical declaration remains an attested amendment. Amending a check never executes it or discards historical evidence; only a receipt for the exact current command, input map and acceptance epoch supports hand-back.

Running several tasks at once: author the rules for work not started yet in a `draft` contract and promote it to `use` when its task opens. An active RED rule keeps `finish` from passing. Ordinary `task close` still requires current passing project verification.

### Own nested-project work at both roots

Attribution reads the selected project's `.blabla/tasks/`, not nested projects'
ledgers. A changed path covered by another active task's scope or deliverable in
that same ledger is attributable; a nested worker's task alone does not explain
the change to a parent-root task. This is recorded ownership, not proof of who
wrote the file or whether the feature is correct.

Before nested writers start, the orchestrator opens and personally accepts a
real integration task at the parent root. Its statement names the integration
responsibility, its scope lists the exact authorized delegated paths relative to
that root, and its check covers the promised integration result. Do not claim an
entire nested directory merely to suppress attribution challenges. Keep parent
tasks' live write scopes disjoint; retain each nested worker's narrower assignment,
acceptance, evidence, independent review and owner integration in its own ledger.
The parent record grants no additional permission and replaces none of that work.

Illustrative syntax only: replace every angle-bracket placeholder with the actual
project, task, authorized paths, permitted model and meaningful check before use.
In BlaBla's checkout, replace `blabla` with the current-source Cargo invocation above.

```text
blabla --project <parent-root> task open <integration-task> --role orchestrator --statement "<actual integration responsibility>" --scope <nested-path-one> <nested-path-two> --check-argv <program> <arguments...>
blabla --project <parent-root> task accept <integration-task> --model <owner-model>
```

Open and accept the nested assignments with `--project <nested-root>` before their
edits; their paths are relative to that nested root. Neither root discovers or
accepts the other's tasks automatically.

For existing `attribution-unknown` changes, the orchestrator first establishes
their origin, then may record the supported recovery on the affected parent task:

```text
blabla --project <parent-root> task attribute <affected-task> <exact-changed-path> --kind concurrent --model <owner-model>
```

This is an owner attestation, not actor authentication. Preserve uncertain changes
and ask the owner to reconcile; never relabel this task's own out-of-scope work or
revert another worker's work to clear a challenge. Unrelated attribution
reconciliation alone is not a reason to rerun unchanged behavioral suites. Inspect
`task freshness`, use only the existing guarded recovery routes when eligible,
and challenge again. Changed scope, inputs or review targets still require current
evidence and receipts; all independent-review, confirmation, closure and project
verification obligations remain. Batch execution and review at substantial feature
boundaries, not each bookkeeping correction.

### Accept a bounded result while integration is pending

An orchestrator can explicitly accept a current READY result after a previously overall GREEN canonical finish has become stale **only because implementation inputs changed**:

```sh
cargo run --locked --quiet --bin blabla -- task close REVIEW_NAME --bounded \
  --reason "The reviewed source and focused evidence are current; concurrent work awaits integration" \
  --model ORCHESTRATOR_MODEL
cargo run --locked --quiet --bin blabla -- task show REVIEW_NAME --json
cargo run --locked --quiet --bin blabla -- status --json
```

Use a model permitted by the declared orchestrator role; the model is an attestation, not authentication. A nonempty reason is required. Prior behavior and stored structure must both establish canonical GREEN, current structure must remain GREEN, and contracts, profile and verifier must match. Missing, corrupt, noncanonical, prior RED/YELLOW, running or interrupted verification cannot qualify. A legacy record without stored structural proof cannot establish prior overall GREEN.

All other close obligations remain: current exact evidence and challenge, findings, carry confirmation, decisions, lenses, falsification, dispositions, reflection, scope attribution and recursive review freshness. The operation reloads and revalidates both the task/review inputs and verification eligibility before recording. It refuses observed changes during that decision; it does not promise filesystem-wide atomic isolation.

Success releases that task's scope and adds `task.result_basis` with `kind: "bounded"`, the reason, acceptance-time `project_state: "stale"`, prior run ID, prior implementation fingerprint and relevant task revision. Text output identifies the limited acceptance. The historical basis stays unchanged when later work or verification advances. Default/legacy results omit this field.

The command never updates the project verification record, marks a goal done, or claims undeclared dependencies are independent. `status` remains stale and project completion stays blocked until a real `finish` passes. A later target change can expire a closed review's current approval while preserving its historical result. The 50-row input-drift display cap has no authority over eligibility.


## Account for affected intent when required

An orchestrator can opt one new task into an additional closure obligation:

```sh
blabla task open fix-cache --role worker --statement "Repair stale cache reads" \
  --scope src/cache.rs --require-intent-disposition --check-argv cargo test --test cache
blabla task accept fix-cache --model MODEL
blabla task show fix-cache
blabla task disposition fix-cache system::cache --status updated \
  --reason "The cache system now names the invalidation seam implemented in src/cache.rs" --model MODEL
blabla task disposition fix-cache memory::mission --status confirmed-unchanged \
  --reason "The mission's truthful-read priority still applies; the cache test exercises stale-entry rejection" --model MODEL
```

Copy affected identities from `task show`; the example identity is not invented by the command. Each affected mission, linked goal, scoped system/responsibility/seam, role/policy/model declaration and consulted knowledge identity needs its own `updated` or `confirmed-unchanged` disposition. The reason must concretely explain the implementation or evidence supporting it. BlaBla rejects a blank reason, but does not certify the semantic quality of the explanation. Only the model that accepted the task can record one while the task is ACCEPTED, or explicitly refresh an eligible READY task as described below.

`task show` reports MISSING, CURRENT or STALE per identity. The existing scope-aware review resolver chooses identities. Dispositions bind the existing relevant revision plus every scoped source path, even when explicit check inputs are narrower. A new acceptance epoch, relevant source/intent change or amended assignment requires fresh dispositions; an unrelated system edit does not, unless its file is itself an explicit scope/input. Identities affected when the task opened or previously recorded remain obligations if removed or unregistered, and can be explicitly accounted for against their absence. Recording another identity does not stale earlier dispositions, but a review of the task notices changed disposition statements.

Missing or stale dispositions ground `intent-disposition-missing` and prevent hand-back and closure. Recording one voids the old challenge: rerun evidence when needed and challenge again. These are accountable review claims, never scope permission, automatic intent edits, goal completion or a replacement for passing evidence, review and the project gate. No disposition changes GREEN. Tasks opened without the option and older task records keep their existing behavior and challenge receipts.

### Refresh manual receipts after READY

If an owner resolves a finding or records attribution after hand-back, inspect the changed inputs in `task show` and reassess the affected claims. When the declared check and recursive review targets are still current, the same currently permitted accepted model can explicitly refresh an opted-in READY task:

```sh
blabla task disposition NAME IDENTITY --refresh-ready --status confirmed-unchanged \
  --reason "Concrete evidence supporting this identity after the owner record" --model MODEL
blabla task reflect NAME --refresh-ready --outcome no-useful-successor \
  --decision "Retain the reviewed result" --observation "Specific observed result" \
  --evidence-ref PATH --reason "Why that observation justifies stopping here" --model MODEL
blabla challenge NAME
```

Each invocation supplies one manual claim. No other identity or reflection is confirmed automatically. Refresh preserves the acceptance epoch, evidence, scope and review target; it clears the old challenge and retains the ordinary current-writer build stamp. Validated newly observed identities are remembered monotonically, without confirming them. Record dispositions before reflection because reflection includes their current values. Refresh never runs a check or accepts the task. An explicit `challenge NAME` can then record a fresh READY challenge only when its current evidence and assignment blocker evaluation permit it, preserving state and epoch.

Inspecting an already-current READY challenge is read-only. A stale existing challenge, including one invalidated by a statement amendment, is not replaced by inspection. The READY recording continuation requires an absent challenge on an opted-in receipt task; legacy tasks keep their ordinary reacceptance route.

Changed check inputs, failed/missing evidence, a stale recursive review target, invalid registered process, a different model or revoked model permission require ordinary recovery. `--refresh-ready` refuses other lifecycle states and cannot opt a legacy task into receipts. Ordinary writes still require ACCEPTED. Fresh project/process, task, tracked inputs and recursive targets are reread before persistence; observed context changes refuse the write. This is an observed-change guard, not filesystem-wide atomic isolation.

Findings, owner confirmation, decisions, knowledge lenses, scope, review and project verification retain their existing closure authority. Refresh does not clear any of those blockers or change project status. A target's closure metadata alone does not stale its review; changed source, epoch or claims still can.

### Explain why a disposition is stale

`task show NAME` prints shared input changes beneath each stale identity. `task show NAME --json` adds `affected_intent[].freshness`: `null` for a missing receipt, otherwise epoch differences, `assignment_digest_changed`, `changed_paths`, `changed_identities`, `own_identity_fingerprint_changed` and `claim_problems`. Each sorted path/identity delta carries `change` (`added`, `removed` or `changed`) and recorded/current fingerprints. Added/removed means key membership; a retained path with a null digest means no digest was observed. The identity sentinel `absent` remains explicit.

Receipts share the task's relevant inputs. One broad directory input can therefore stale every identity even when each identity's own fingerprint is unchanged. The assignment digest includes the epoch but cannot identify changed assignment fields; a directory digest cannot identify changed child files. This view explains the stored difference, not a semantic change to every identity. Matching revisions can still have `acceptance-missing`, `accepted-model-mismatch`, `invalid-status` or `blank-reason` claim problems.

Read the changed inputs and reassess each claim before recording a fresh disposition. The view writes nothing, confirms nothing automatically and leaves the existing freshness gate unchanged.

## Reflect on the next goal decision when required

Opt a meaningful feature iteration in at task creation with `--goal NAME --require-goal-reflection`. The goal must already be declared. Record one short causal bridge: what decision or consequence the feature enabled, what was observed, an inspectable evidence reference, and why a bounded next step or justified stop follows now. This is proportional to the feature, not every compile.

For an already ACCEPTED opted-in task, substitute its name and accepted model below. Record current evidence and any required dispositions first:

```sh
blabla task reflect NAME --outcome successor \
  --decision "Completed Cultivation makes the next research choice necessary" \
  --observation "Revision 48: Pelagos has 12.31 unused science and no released research successor" \
  --evidence-ref "ROADMAP.md" \
  --reason "A connected production branch gives stored science a useful next decision" \
  --recommendation "Prepare Water management and Kiln firing with the shared operating-input rule" \
  --owner "simulation/content implementer with orchestrator-owned release" \
  --dependency "Predecessor scope released after closure" \
  --observable-outcome "A genuine agent chooses a released branch; its building pays exact inputs or reports why it cannot operate" \
  --model MODEL
blabla task show NAME --json
blabla challenge NAME
blabla task ready NAME
```

The example records the historical MMO observation, not today's live state or permission to implement the recommendation. Use actual evidence for your task. Every outcome requires `--decision`, `--observation`, one or more `--evidence-ref`, `--reason` and `--model`:

- `successor`: also `--recommendation`, `--owner`, `--observable-outcome`; repeat `--dependency` for known prerequisites. Name the smallest authorized next slice within the goal. A same-scope successor can remain a recommendation until its predecessor closes.
- `blocked`: also `--blocker`, `--owner`, `--unblock-when`. Describes a prerequisite for the next goal step; it does not block the task lifecycle or waive current obligations.
- `completion-recommended`: recommend owner review of outcome evidence; never marks the goal done.
- `no-useful-successor`: explain why further work is not useful now. No invented task or idea quota is required.

Blank required fields and fields belonging to another outcome are rejected. References, owners, dependencies and reasoning remain reviewable claims, not authenticated sources or semantic scores. No outcome opens tasks, grants scope or changes goal state.

`task show` exposes `goal_reflection_state` as missing/current/stale (null without opt-in). Reflection binds the existing relevant revision, all scoped paths, latest matching evidence and disposition values. Refresh it after those change; writing it does not stale itself or dispositions, but does invalidate the challenge and review receipt. Required missing/stale reflection blocks READY and CLOSE through `goal-reflection-missing`. Legacy tasks remain unchanged.

## Ask, don't guess

```sh
blabla task decide fix-cache "Is the cache the cause?" --pick yes --confidence 55 --model M
blabla task ask fix-cache "Is this failure in scope?" --floor 90 --model OWNER_M
blabla task decide fix-cache --on q1 --pick yes --confidence 95 --model M
```

Picks are `yes`/`no` unless `--options a,b,c` is given; confidence is 0–100. Below the role's `block_below` floor the task is BLOCKED at once: stop, and do not act on the pick. The orchestrator answers with `task answer`; the worker then accepts again. An asked question can raise the floor, never lower it, and blocks READY until it is picked.

## Review

```sh
blabla task open review-cache --role reviewer --statement "Review cache repair" \
  --review-of fix-cache --check-argv cargo test --release --test cache
```

A review binds the target's current state. Findings recorded on the target and their resolutions do not change that state; edits and a worker's `task addressed` do. If the target changes, the review is accepted, checked and challenged again. An old CLOSED review gives no current approval; open a new one. Each `task lens NAME PACK "…"` binds the model, the epoch and the pack.

`--model` and task records are claims, not authentication. Records the orchestrator makes while a worker carries a task stay unconfirmed: READY is allowed, CLOSE is refused until `task confirm`.

## Challenge

`blabla challenge NAME` reports the one strongest contradiction it can ground; a class that blocks the hand-back comes before a project-level one. With a task that is not CLOSED or WITHDRAWN it exits 0 when the hand-back is clear and 1 when it is blocked; otherwise exit 1 means a project challenge stands. It reads no code meaning; silence means no contradiction was found, not approval. Classes:

- **Task record**: `unresolved-finding`, `deliverable-unchanged`, `scope-breach`, `work-without-acceptance`, `attribution-unknown`
- **Roles and decisions**: `model-outside-role-policy`, `exception-unresolved`, `decision-unanswered`, `question-unpicked`, `orchestrator-record-during-carry`
- **Evidence**: `declared-check-failed`, `readiness-without-evidence`, `evidence-superseded`, `review-target-stale`, `lens-unassessed`, `unobservable-task-input`, `check-not-falsified`, `intent-disposition-missing`, `goal-reflection-missing`
- **Project**: `vacuous-rule`, `verification-not-current`, `withdrawal-residue`, `goal-outcome-unmet`

## Upgrading task records to 0.11

A review recorded before 0.11 on a target that had findings goes stale once, because unaddressed findings and resolutions no longer count as part of the target. Accept it again, rerun its check and challenge it.

## Upgrading task records to 0.10

Back up `.blabla/tasks/` first, and never switch versions while one task is in flight. Old records stay readable but give no current credit. To earn it, accept again, rerun the exact check, assess lenses again and challenge before READY. Fix an `unobservable-task-input` with `task check NAME --input TRACKED_PATH --argv …` or `task deliverable NAME --remove`. Old reviews need an explicit `--review-of`. [Breaking notes](../CHANGELOG.md#0100-2026-10-06)

Authoring: `blabla guide bootstrap`, `guide change`, `guide memory`. Optional advice: [Expert](expert.md).

### Required user-outcome delivery

A goal can opt in with `delivery "required"` and `applies-to ["system::viewer"]`.
Only exact registered system identities are accepted. A task receives required
primary goals, repeatable `task open --delivery-goal NAME` selections, and goals
mapped to its **write scope**. Broad check inputs do not select extra outcomes.
Acceptance shows the pinned statement, selection basis and current expectation
verdicts. Scope widening adds obligations; removing a declaration never deletes a
pinned obligation. Dropped required goals do not attach to new work and cannot be
selected explicitly until the owner restores them. Active and done goals still
attach. Goals without delivery metadata retain the existing lifecycle.

After the actual declared check, the accepted worker supplies its own account:

```sh
blabla task delivery source viewer --status partial \
  --observation "The renderer passed its focused checks; viewport inspection is pending" \
  --observation-ref '{"kind":"verification","locator":"tests/viewer.test.ts","context":"Source correctness only"}' \
  --delivered "Checked rendering implementation" --remaining "Inspect the actual viewport" \
  --owner viewer-reviewer --next "Inspect the recorded event after authorized deployment" \
  --model worker-model
```

Statuses are `delivered`, `partial`, `blocked` and `not-applicable`. Partial needs
what arrived, what remains, an owner and next decision/trigger. Blocked needs
`--blocker`, `--owner` and `--unblock-when`. Initial Not-applicable needs `--reason`.
Delivered requires a reference typed `artifact`, `runtime` or `viewport`; references
are repeatable JSON objects with `kind`, `locator` and `context`. Verification-only
references cannot claim Delivered. Local paths are tracked by content; external
references remain inspection claims, not authenticated observations or URL hashes.

Current claims are needed for READY. Independent delivery review comes afterward,
so author hand-back does not wait for an already-closed review. A separately assigned
`--review-of source` task records what its reviewer actually inspected:

```sh
blabla task delivery-review outcome-review viewer --verdict accept \
  --reason "Inspected the stated source boundary and the remaining viewport work" \
  --observation-ref '{"kind":"artifact","locator":"tests/fixtures/viewer.ts","context":"Inspected source fixture; actual device limits remain explicit in the task"}' \
  --model reviewer-model
```

The review follows its ordinary check, challenge, READY and owner close. Both source
close modes then require current independently accepted verdicts for every pinned
claim. All existing check, finding, model, target and integration blockers remain.
A goal-less report-only review acquires no delivery obligation through `review_of`
alone; production write scopes still acquire mapped outcomes.

Reviewed Partial or Blocked source can close. Its exact origin remains visible in
`status`, Next, `task show` and `explain goal::NAME`, including after another GREEN
run. Status shows at most 50 residual rows and reports total/omitted counts; goal
explanation gives the complete filtered list. Unreadable records remain unavailable
notices. Owner retirement is retained as retirement, never described as delivery.
Residual JSON includes `origin_role`, the recorded task role (null if unavailable).
When a delivery owner is absent, text shows “delivery owner not recorded” plus the
origin role and lifecycle state. This does not assign that role the remaining
outcome, infer a successor, or promote a historical reflection owner. An explicit
claim owner remains separate; unresolved origins and closure checks are unchanged.

A later review of the closed source can resolve only the named historical residual:

```sh
blabla task delivery-review live-review viewer --verdict accept \
  --resolve-origin '{"task":"source","goal":"goal::viewer","claim_digest":"EXACT_DIGEST_FROM_TASK_SHOW"}' \
  --resolution delivered --reason "Inspected the actual delivered outcome" \
  --observation-ref '{"kind":"viewport","locator":"https://example.test/observation","context":"Exact inspected viewport, version and remaining limits"}' \
  --model reviewer-model
```

The resolution takes effect after that review's owner-accepted close, preserves the
closed source record and affects no other origin. Accepting Partial or a later initial
Not-applicable claim cannot clear an earlier applicable residual. An already-open
successor is not required. Delivery records never mark a goal done or manufacture
canonical GREEN; independent inspection still judges whether the observation supports
its claim. Final writes reread current authority, tracked inputs and recursive targets;
this detects the tested decision-boundary races, not arbitrary filesystem atomicity.

Delivery-bearing close decisions, including a review task carrying delivery verdicts,
require the currently declared orchestrator model. The supplied model is an
attestation, not authentication. Legacy ordinary closes without delivery records
keep their existing behavior. Both delivery close paths reload current authority,
claims and recursive reviews before recording; ordinary delivery close also reruns
its existing project/check/challenge eligibility. These checks detect the tested
intervening mutations, not arbitrary filesystem races after the final read.

### Captured active effort

`task phase NAME development|verification|review|integration|blocked --worker WORKER --model MODEL`
records an explicit phase boundary on the existing task. Use one stable worker identity across
tasks and projects; a model name is not a worker identity. A switch attests that the preceding
interval was active. Use `stop` before inactivity or switching tasks, and `interrupt --reason TEXT`
when the preceding interval's attention is uncertain. `blocked` requires the external waiting
reason. No historical timestamps can be supplied. Same-phase repetitions are no-ops.

```sh
blabla task phase feature development --worker my-worker --model my-model
blabla task phase feature verification --worker my-worker --model my-model
blabla task phase feature stop --worker my-worker --model my-model
blabla task budget --json
blabla task budget --include-project examples/agentic-mmo --since 1792177000 --until 1792180000 --json
```

The denominator is captured development + verification + independent review + integration/publication
worker-seconds. The latter three together target at most 20% of that total. A reviewer running a
check remains in review; an unattended child process adds no automatic worker effort. Distinct
workers may work simultaneously. Same-worker overlaps make totals untrusted rather than counting
them twice. Stop before moving between project stores; aggregation diagnoses cross-project overlap
but does not introduce a cross-project writer lock.

Pending and interrupted intervals are excluded; external blocked time is separate. Legacy tasks and
unrecorded gaps remain unknown. The current view always reports partial or unknown coverage, never
whole-project compliance. `observed_target=within` describes only captured valid intervals;
`totals_valid=false` and a null fraction flag malformed/overlapping/inaccessible input. A zero active
denominator also has a null fraction. Detail is capped at 50 intervals; totals cover every row.

Normal starts require the current accepted permitted model. The declared orchestrator may account
integration on READY/CLOSED packets; this does not reopen the source task. A model may stop or
interrupt its own pending interval after hand-back. The original interval's model remains binding. If that model is revoked, its pending interval stays
excluded and visible; another model cannot impersonate it. This first slice has no reassignment override.
Accounting preserves source evidence, epoch, target pins, semantic revisions and challenge receipts;
writer provenance follows the existing safety path. Reads never create or update task records.

Record necessary exceptions with an explicit `policy::development-time-budget` task note naming the
correctness/release reason, accountable owner and next reduction action. Time accounting never waives
a failing check, independent review, delivery obligation, closure guard or publication permission.

### Prepare a one-pass hand-back

Prepare one coherent packet; a new defect or changed claim still requires recovery.
This order uses existing guards, not a new readiness or acceptance authority.

1. **Settle the assignment first.** The owner declares actual deliverables and
   check inputs and settles known assignment changes and findings. Read
   `task show NAME` for the accepted model, consulted lenses, affected identities
   and pinned delivery goals before preparing final receipts.
   Before opening a [combined review](#one-review-of-several-delivery-sources),
   inspect the owner and relevant author tasks' delivery obligations with
   `task show NAME`, then name the owner with `--review-of` and every additional
   author with `--delivery-review-of`; shared goals or check inputs do not assign
   sources.
2. **Freeze source and current evidence.** Inspect
   [receipt-relative freshness](#inspect-receipt-relative-freshness). Run the
   declared check only when evidence is missing, failed or superseded; read its
   complete child log. Do not replace current evidence for a metadata handoff.
3. **Finish explicit claims.** Record required
   [intent dispositions](#account-for-affected-intent-when-required), then
   [delivery claims](#required-user-outcome-delivery) with JSON `--observation-ref`
   objects, not bare paths. Record required
   [reflection](#reflect-on-the-next-goal-decision-when-required) after evidence
   and dispositions; `successor` also needs `--recommendation`, `--owner` and
   `--observable-outcome`. Assess every consulted lens, and no unconsulted lens,
   then [challenge and hand back](#the-loop). Claims remain inspected judgments,
   never automatic confirmations.
4. **Pin the final review packet.** The independently assigned reviewer inspects
   the final explicit source/goal/claim-digest set before its final acceptance
   pin. Use [guarded review reuse](#reusing-an-unchanged-review-execution) only
   when eligible; unchanged source alone does not establish eligibility. The
   review still needs its own current evidence, required claims/lenses, challenge
   and READY hand-back.
5. **Let the owner accept.** Inspect [delivery readiness](#inspect-delivery-readiness-without-changing-it)
   for exact outstanding receipts and during-carry records. After hand-back the
   owner confirms actual carry records where required, accepts the reviewer,
   then accepts each source. READY or a current Accept receipt is not owner
   acceptance, and bounded closure is not project completion.

If the packet changes, [recover the specific invalidation](#recover-a-ready-hand-back)
without reflexive reacceptance or suite repetition. Eligible manual-only READY
updates use [explicit refresh](#refresh-manual-receipts-after-ready); changed
source/check inputs and changed reviewed claims retain their execution/inspection
requirements. A stale CLOSED review needs a new assignment. Stop after accepted
handback; do not manufacture another receipt cycle merely to repeat the summary.

### Recover a READY hand-back

READY is a recorded lifecycle state, not a claim that its evidence is still current.
Run `blabla challenge NAME` before handing an existing packet to the orchestrator.
Its assignment summary and JSON `assignment_recovery` share one diagnostic:

- `await-review`: current assignment evidence and challenge support the existing
  hand-back; project-wide verification remains separate.
- `resume-and-verify`: check evidence is missing, failed or superseded. Inspect
  `task freshness`, resume, and record the declared check after the coherent
  feature or rework batch is ready. Diagnosis itself never runs that check.
- `inspect-manual-receipts`: inspect stale claims and the existing guarded
  `--refresh-ready` route; unchanged execution does not confirm a manual claim.
- `inspect-review-target`: inspect the renewed target and, only if the original
  execution inputs and recursive coverage remain unchanged, the existing guarded
  `--reuse-evidence` route. The diagnostic does not establish eligibility.
- `resume-task`: no assignment blocker was selected, but the old challenge no
  longer supports the hand-back. Resume and recover through the ordinary workflow.
- `resolve-assignment-blocker`: follow the selected challenge's reconciliation;
  owner decisions and findings remain owner responsibilities.

`assignment_recovery` carries `action`, the selected assignment `blocker` (or
null), `guidance`, and `authority: "diagnostic-only"`. Human challenge output and
refused `task ready` diagnostics use the same guidance. The projection changes
neither lifecycle state nor freshness predicates, runs no check, and grants no
permission to reuse evidence. Existing challenge-recording behavior is unchanged:
a current READY inspection is read-only, while an explicit challenge can record
an eligible opted-in manual-receipt continuation. Batch execution and review at
substantial feature boundaries; adding or editing a test is not itself a reason
to rerun the suite.

### Inspect delivery readiness without changing it

`task show NAME` and `task freshness NAME` share a `readiness_summary` in human
and JSON output. It is diagnostic-only: no new readiness gate, lifecycle state,
persisted receipt or overall ready flag. Delivery rows cover the selected task's
pinned obligations and its direct `--review-of` / `--delivery-review-of` sources,
not inferred author subtasks or outcomes selected by broad check inputs. The
project name and root identify the local store; another project's matching task,
goal or claim digest contributes no review credit.

Each delivery row joins the exact source task, goal and claim digest to explicitly
assigned local reviewers. It distinguishes missing/current/stale/unavailable
claims, absent assignments, missing or different-digest receipts, stale review
inputs, current Reject, and a current Accept still awaiting owner acceptance.
`no_current_accepted_review` reports the existing closure predicate, not permission
to close; reviewer lifecycle and challenge fields explain why a receipt counts.
Unavailable task or goal authority is not evidence of absence or completion.
Partial and Blocked claims retain their remaining work and owner even when their
review is accepted. Residual-resolution receipts do not become initial approval.
A stale CLOSED reviewer needs a new assignment, not reopening or silent refresh.

`review_targets` covers every explicit primary and additional recursive edge,
including the incoming reviewers needed to explain those delivery rows. Shared
ancestors are not cycles; missing, unreadable, withdrawn, duplicate and cyclic
edges remain explicit. Revision fingerprints and `task freshness` routes lead to
the existing deltas. Freshness's `review_current` uses the same full graph as
`task show`; `--identity` still filters intent receipts, not this local summary.

`confirmations` lists only actual unconfirmed during-carry records among inspected
tasks. `orchestrator_record_index` is the zero-based position in that response's
native `orchestrator_records`, not a stable ID or a `confirm` argument. Verb, time,
model and carrier are recorded; historical amendment payload is not available.
After hand-back the owner inspects and confirms all outstanding records with
`task confirm NAME --model <id>`, or undoes them through supported owner actions.
The carrier cannot self-confirm. These records block CLOSE, never READY.

All facts are computed before deterministic per-section 50-row presentation caps;
sections and nested reviewer/receipt lists report total, shown and omitted counts.
Use the listed task and goal routes to inspect omitted details. An empty section
means no obligation observed in this explicit scope, not universal delivery or
project completion. Reading either view does not refresh, repin, execute evidence,
write task/status/goal records or change ordinary/bounded closure refusals.

### Inspect receipt-relative freshness

Use `blabla task freshness NAME` or `blabla task freshness NAME --json` before
reassessing a stale hand-back. `--identity system::NAME` narrows the displayed
intent receipts; it changes no eligibility or authority. In this repository,
invoke the current source with `cargo run --locked --quiet --bin blabla --`.

The read-only view groups equal receipt comparisons once and distinguishes the
latest matching check, each latest affected-intent receipt, reflection, and
recursive review-target links. If no current check matches, it labels the latest
historical evidence as nonmatching. Missing receipts and missing/unreadable/cyclic
targets remain explicit. A changed shared source path can stale an unchanged
identity; that is not an instruction to confirm the identity unchanged.

JSON `receipts[].shared_delta` references a response-local `deltas[].id`.
Each group exposes its context, epoch change, opaque assignment digest comparison,
selected path changes, and exact identity fingerprint changes. Assignment field
history is `baseline-unavailable`. Reflection and review comparisons include
composite receipt context; the view never guesses which historical field changed.
A legacy check without an epoch reports `epoch_availability=baseline-unavailable`.

New check receipts capture an optional `member_manifest` from the **same observed
tree** as their selected input digests. It contains a sorted, deduplicated union
of every tracked leaf covered by those inputs (including deliverables), not just
owned or changed files. Argv receipts label it `execution-start`: it is captured
before spawning and is not resampled when the command finishes. Manual text
receipts label it `manual-record`, a record-time observation, **not an observed
execution**. Existing task locks, captured epochs and check identities still
apply; this is not an atomic filesystem snapshot or proof of actual file access.

For check children, a complete supported manifest must reproduce **every**
recorded input digest, including null observations, before it supplies the
`evidence-input-manifest` baseline. The current projection must match too. Changed
input-root selection is not interpreted as a file addition or removal. Legacy
receipts without this field retain the safe `opened-tree-digest-match` fallback
only when the saved opening tree matches that exact receipt's selected digest.
Other receipt types still use their own digest-matched opening-tree boundary;
they never borrow a check manifest. Unsupported, malformed, inconsistent or
unavailable metadata reports `baseline-unavailable` with a reason, not a fabricated
empty diff or a task-load failure. Reading never fills in old receipts.

Capture is all-or-unavailable: at most **8,192** unique members, **4,096 UTF-8
bytes per path**, and **1,048,576 compact JSON bytes** per manifest, counting JSON
escaping. Exceeding a cap stores a small unavailable envelope with the exact known
member count and `member-limit`, `path-limit` or `byte-limit`, never a partial map.
These are per-receipt capture bounds, not the size of a pretty-printed task or its
history. An empty complete map and an unavailable map are distinct. Diagnostic
availability never changes check exit, freshness, reuse eligibility or closure.

Complete means the captured **tracking set**, not every filesystem file: ignored,
symlink and unreadable members may be unobserved, and large files may use metadata
hashing rather than content hashing. A removed member means no longer observed in
tracking, not proven filesystem absence. Fingerprint equality is not semantic or
cryptographic proof. Metadata stores relative paths and existing digests, not file
contents; filenames and fingerprints still belong in the private local task
record, not publication artifacts.

Receipts, groups, selected paths and identities each have a 50-row presentation
cap with complete total/shown/omitted counts. All displayed groups share a global
50-child-row budget. Child totals cover available comparisons, including roots
hidden by the path cap; unavailable baselines have null totals. The same child
can occur in different receipt contexts. No task/status/evidence bytes, target
pins, check predicates, claim authority or closure rules change. Follow the
existing explicit disposition/reflect/evidence routes after inspecting the cause.

Unfiltered freshness also adds `input_reconciliation`, joining the selected check's
zero-based evidence index, epoch, time, capture and shared delta to its validated
member baseline. Equal selected-root keys and independently reproduced current
root digests are required. It lists exact unchanged and changed **current-declared-scope**
members, and changed selected-input dependencies outside that scope, with their
fingerprints and containing input roots. Ownership is current, not historical;
these dependencies are not an inferred semantic graph.

Each collection has complete counts and a deterministic 50-row cap (82 members
means 50 shown, 32 omitted). Scope roots not fully covered by inputs report
`not-observed-by-this-check`; null input observations remain explicit, never
unchanged members. Missing, legacy, invalid or unavailable baselines and changed
input selection yield null comparison totals with reasons. Manual capture remains
`manual-record`, not observed execution. Inspect `task show NAME --json` for the
full saved manifest and adjacent receipts/`readiness_summary` for exact claim and
review targets. This comparison neither proves a whole scope unchanged nor
explains every stale manual claim; it renews no claim and grants no reuse credit.

### One review of several delivery sources

Declare each source explicitly when opening the review:

```sh
blabla task open combined-review --role reviewer --statement "Inspect Core and Server delivery" --review-of core-task --delivery-review-of server-task --input core server tests/combined.test.ts --check-argv node --test tests/combined.test.ts
blabla task accept combined-review --model REVIEWER_MODEL
blabla task evidence combined-review --run
blabla task delivery-review combined-review GOAL --source server-task --verdict accept --reason "Inspected this source's exact outcome and remaining limits" --observation-ref '{"kind":"artifact","locator":"tests/combined.test.ts","context":"Inspected focused check; actual outcome and remaining limits are recorded in the task"}' --model REVIEWER_MODEL
```

Repeat `--delivery-review-of` for additional distinct tasks. Omitted `--source` selects only the primary `--review-of`; same-goal verdicts for different sources remain separate. Acceptance pins every declared source and recursive review dependency. Changed claims, source inputs or inspection artifacts require current inspection and explicit receipts. A shared review must still reach its own independently accepted close before each source can close separately. Neither source closure nor accepting a Partial claim completes its residual. Existing records without additional targets or verdict source fields retain primary-only behavior. Additional targets cannot be inferred or added to an existing assignment in this slice.

### Reusing an unchanged review execution

`blabla task accept REVIEW --model MODEL --reuse-evidence --reason "Exact execution inputs remain unchanged; renewed source claims were inspected"` explicitly repins an ACCEPTED or READY review and reuses its latest original successful argv run. Ordinary acceptance still requires a new-epoch execution.

Reuse requires the same still-permitted accepted model, exact check identity and complete observable input map, a readable original task-local log, and unchanged execution coverage of every recursive source scope, declared input, deliverable and recorded artifact. A report edit counts as an input edit. Missing paths, manual evidence, an older success behind a newer failure, falsification obligations and chained reuse refuse before recording. Current source targets remain explicit; no target is inferred.

The original evidence stays intact. The appended `tool: "reuse"` entry retains its execution time, argv, input hashes, exit, tree, log and optional member manifest unchanged, with a separate optional `reuse` object naming the zero-based original evidence index, original epoch/digests, attesting model, reason and reuse time. A manifest explains changed inputs; it cannot make a changed broad root reusable merely because an owned leaf is unchanged. Text output distinguishes execution from reuse. Old records without these objects remain compatible; absent member metadata stays absent. Old writers may discard unknown fields, so lossless downgrade writes are not promised.

Acceptance advances the epoch and clears the challenge. Dispositions, lenses, reflections and delivery verdicts are not renewed; inspect and record them explicitly before hand-back. Both closure modes retain their existing checks, independent outcome review and Partial/Blocked residuals. Final recording reloads task, process authority, execution inputs/log and recursive review context and refuses if the inspected context changed. This is an explicit execution reuse path, not a guarantee of filesystem-wide atomicity or permission to omit report dependencies.
