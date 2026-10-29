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

`linked_work` lists only tasks explicitly assigned with that goal, including each task's actual scope, state, declared check and existing tracked-evidence readiness. `latest_exit`, when present, belongs to the latest entry that still answers the declared check: executed evidence from an earlier acceptance counts while its check and inputs are unchanged, and claimed evidence counts only in its own epoch. A stale passing exit is retained beside `current: false`. `task_problems` exposes unreadable records rather than silently treating them as absent. An unrelated maintenance task needs no invented goal and is not listed as linked work.

The task link is goal-level. It does not say that a task's scope implements every expected rule, that a broad contract fully captures the goal statement, or that a passing check establishes semantic coverage. No percentage or inferred implementation mapping is produced. Explaining a goal changes neither its declared state nor task records, evidence or OVERALL; only `finish` decides completion.

Read-only examples from BlaBla's checkout (the goal and task already exist):

```sh
cargo run --locked --quiet --bin blabla -- explain goal::hand-backs-survive-concurrent-work --json
cargo run --locked --quiet --bin blabla -- task show explain-goal-coverage --json
```

Use coverage to inspect the declared links and the task view to inspect current evidence. These answer different questions; none replaces owner acceptance.

## The loop

![An orchestrator assigns a bounded task; a worker accepts, implements, records evidence and hands back; a reviewer looks for defects; the orchestrator closes and runs finish.](assets/agent-workflow.svg)

| Step | Who does what |
| --- | --- |
| Plan | orchestrator reads `status`, memory and `flow::<name>`; names the change and how to accept it |
| Assign | orchestrator opens a task: role, write scope, deliverables, check, optional `--goal` |
| Accept | worker reads `task show` and accepts **before editing** |
| Implement | worker edits only inside its scope; asks or blocks when unsure |
| Verify | worker runs the exact check, reads the whole result, records evidence and one lens per consulted pack |
| Hand back | worker runs `task ready NAME --lens PACK "…"`: lenses, notes, goal outcome and intent claims in one write, challenge included |
| Review | a separate reviewer reads task, diff and evidence and records findings; the worker accepts again to repair |
| Close | orchestrator resolves findings, confirms records it made during the carry, closes the task |
| Done | orchestrator runs `finish`; a closed task never replaces the project gate |

States: `OPEN → ACCEPTED → READY → CLOSED`. `BLOCKED` pauses; `WITHDRAWN` ends without credit. A READY task is accepted again before any change. BlaBla checks these steps; it does not launch agents.

```sh
blabla task open fix-cache --role worker --statement "Repair stale cache reads" \
  --scope src/cache.rs tests/cache.rs --deliverable src/cache.rs \
  --check cargo test --release --test cache
blabla task accept fix-cache --model MODEL    # MODEL must be allowed by the role
blabla task evidence fix-cache --run          # runs the declared check, records its exit
blabla task ready fix-cache --lens testing "What the check proves and what it misses"
```

Use the packs your role consults, not the ones in this example. A task opened with `--goal` hands back with `--outcome delivered|partial|blocked|not-applicable`; `partial` and `blocked` leave a residual finding that does not block close and stays visible after it. A task opened with `--intent` hands back with one `--claim INTENT=updated|unchanged` per system its scope touches and for its goal. A refused `task ready` records none of it; a successful one records its own challenge receipt. `task show` prints the next routes for a task; `blabla task --help` lists every verb.

Attest your actual model ID with `task accept --model`; effort is separate, and spelling is preserved exactly. Acceptance records the assignment, not model permission: text and JSON warn immediately when the ID is outside the role's models (exact names, or families such as `sonnet-*` that admit every ID starting with the text before the `*`) and declared aliases without an approved nonsuperseded exception, or when registered policy is unavailable. Resolve this before work using `task propose-model NAME MODEL --reason ...` and the owner's `task approve-model NAME MODEL --approval ...` ruling, or repair unavailable policy; never claim a different model to fit the list. Approval preserves the acceptance epoch and existing evidence and still requires normal carry confirmation; reacceptance starts a new epoch. This local diagnostic does not replace the process's immediate post-acceptance challenge or authorize other guarded operations.

When registered process memory declares roles, `task open --role NAME` must name
one exactly. Unknown names are refused before creating task-store files, with the
available roles listed; they cannot silently discard model or lens obligations.
Registered process memory that is missing, unreadable or invalid also refuses
creation. Bootstrap remains available when no process is registered, or a valid
registered process declares zero roles. Existing tasks are not renamed or migrated.
The role check runs before locking and again inside creation; it does not promise
atomic isolation from concurrent edits to process memory.

## Evidence that stays current

- Opening a task snapshots the tree. Each deliverable must change from that snapshot; a directory deliverable changes when a tracked file under it is added, removed or edited. A path that becomes ignored later no longer counts as a change
- Live write scopes never overlap; reads may. A scope is project-relative: absolute, `..` and symlink paths are refused. Inputs and deliverables also refuse skipped and ignored paths
- Evidence binds the exact check and its arguments, the acceptance epoch and the digests of its inputs: the write scope, or the `--input` list you declare, plus every deliverable. A new acceptance starts a new epoch, even for the same model. Evidence BlaBla executed with `--run` stays current across a new acceptance while the check and its inputs are unchanged, except in a review, whose evidence counts only in its current acceptance; an exit given with `--exit` is shown as claimed and counts only in its own epoch
- `task evidence --run` runs the declared check from the project root with no shell and no timeout, so pick a bounded check. Capture has a 64 MiB combined stdout/stderr limit; an overflow stops the owned process tree, retains bounded partial bytes and records no new evidence.
- READY needs current passing evidence, current lens assessments, a goal outcome or intent claims where the task asks for them, and a clear assignment challenge. Relevant edits or new findings void the challenge receipt; resolving a finding and unrelated work do not
- Lenses: every pack the role consults, or only the packs named with `task open --lens PACK`. A pack the role does not consult is refused
- `task show` prints the latest evidence (tool, epoch, exit, log) and every lens assessment; `task evidence --run` prints the same receipt. It also lists the falsify paths and the latest falsification, the paths changed since the task opened and, for a review, the paths its target changed
- `task open --falsify PATH` names production files the check must catch. `task falsify NAME` copies the tree into the task's scratch and runs the check there twice: on the current files, then with those paths as they were at open. Hand-back needs a pass, then a failure, with the inputs unchanged since. Any non-zero exit counts as a failure, a compile error included, so read the opened log: a build error there proves nothing about a test. Tests reach the change through a surface that existed before it, live outside the falsify paths (a test inside one reverts with it), and the check keeps running after a failure (`cargo test --no-fail-fast`). The working tree is never touched. Falsify judges the whole check: a new test that passes on old code hides behind one that fails, so declare a narrow check for the test that matters. A check that names the project by absolute path reads the real tree in both runs and never counts. The copy holds only the tree snapshot, so a check that reads an ignored directory or a file outside the project root by a relative path fails on the current files and falsify reports that instead of judging; environment variables reach the check unchanged
- CLOSE checks it all again. Task acceptance and project verification answer different questions

| Need | Command (add `--model M` where `--help` asks) |
| --- | --- |
| note, finding, stop | `task note`, `task finding`, `task block` |
| report or resolve a fix | `task addressed NAME ID "…"` (worker); `task resolve NAME ID --evidence "…"` (orchestrator) |
| fix the check or its inputs | `task check NAME --input PATH… --check PROG ARG…` |
| explicitly return check inputs to scope defaults | `task check NAME --reset-inputs` |
| widen scope and fix the check at once | `task check NAME --add-scope PATH… --check PROG ARG…` |
| change deliverables or scope | `task deliverable NAME --add\|--remove PATH`; `task scope NAME --add\|--remove PATH`, where `--remove` is refused for a path, or a file under a directory, changed since the task opened |
| time per phase | `task budget NAME`: phase durations from the record and executed runs; writes nothing |
| change the statement | `task statement NAME "…"`; the hand-back must be challenged again |
| withdraw | `task withdraw NAME --reason "…"`; changed paths stay challenged until restored or `task reconcile-withdrawal NAME PATH…` names a CLOSED successor with current evidence whose inputs or deliverables cover them; the reconciliation then stands while that successor stays closed, and later changes belong to later tasks |

Scope, check, attribution and withdrawal changes are the orchestrator's. Resolving, answering, confirming, attributing, removing a deliverable, withdrawing and reconciling need `role::orchestrator` declared in process memory, so a worker cannot settle its own obligations; without it, `task open` says so up front, and an optional `--model` on `task check`, `task scope` or `task statement` is recorded unchecked. BlaBla options go before `--check`: everything after it is the check, and an argument there that matches a BlaBla option is kept and reported. After hand-back, the orchestrator checks records it made during the carry and runs `task confirm` once before `task close`. A task assigned to role `orchestrator` needs no confirmation: its own records never count as made during a carry.

### Source-isolated verification

Use separate build-output directories for different source variants or worktrees.
Sharing registry/download caches is fine; sharing an executable output path lets
another source build replace the CLI a running integration test invokes. Verify
the actual tested executable identity, not just the Cargo command's working tree.

### Opt-in check failure status

`blabla task evidence NAME --run --fail-on-check` records the same evidence and
prints the same receipt as `--run`, then returns **1** if the recorded numeric
child exit was nonzero, or **0** if it was zero. Use this explicit option when a
shell pipeline should stop on a failed check. Without it, the default successful
recording status remains **0** even when the recorded check failed. The option
requires `--run`; it cannot accompany manual `--exit`/`--tool` evidence.

The exact child exit stays in the task record, including numeric 2, 4, 124 or 125;
it is never replaced by wrapper status 1. Refusal, capture or storage failures
retain status **2**, and output failures retain status **4**, taking precedence
over the check result. An output failure can occur after evidence was recorded:
inspect the task record and retained log before deciding what happened, rather
than blindly rerunning the check. JSON stdout remains one document, not a second
failure response appended to the successful receipt.

This option adds no timeout or retry and changes neither readiness nor `finish`.
A declared timeout wrapper's numeric exit is recorded as reported. Direct signal
termination has no numeric exit, so it retains its typed observation and complete
log when available, records no integer-exit evidence, and refuses with status 2.

### Evidence-run observations

While a declared check runs, `task show NAME` (including `--json`) includes bounded,
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

`task check` is an amendment, not an inspection command. A bare or model-only call refuses without changing the task or its receipts; use `task show NAME` to inspect the saved check. Changing the command or adding scope without `--input` preserves the previous explicit input list. If no explicit list exists, the write-scope default remains in effect. `--input PATH…` replaces the whole list; `--reset-inputs` deliberately restores the write-scope default and conflicts with `--input`. Deliverables remain included either way. The resulting inputs must remain observable; a normal tracked path that does not exist yet is still admissible and its later creation stales evidence. Explicitly repeating an identical declaration remains an attested amendment. Amending a check never executes it or discards historical evidence; only a receipt for the exact current command, input map and acceptance epoch supports hand-back.

Running several tasks at once: give each task not started yet its own `draft` contract and promote it to `use` when that task opens. A draft serves one task, so promoting it never turns another task's work RED; an active RED rule keeps `finish` from passing, and ordinary `task close` still requires current passing project verification.

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
blabla --project <parent-root> task open <integration-task> --role orchestrator --statement "<actual integration responsibility>" --scope <nested-path-one> <nested-path-two> --check <program> <arguments...>
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

Use a model permitted by the declared orchestrator role; the model is an attestation, not authentication. A nonempty reason is required. Prior behavior and stored structure must both establish canonical GREEN, current structure must remain GREEN, and contracts, profile and verifier must match. Missing, corrupt, noncanonical, prior RED/YELLOW, running or interrupted verification cannot qualify. A record without stored structural proof cannot establish prior overall GREEN.

All other close obligations remain: current exact evidence and challenge, findings, carry confirmation, decisions, lenses, falsification, scope attribution and recursive review freshness. The operation reloads and revalidates both the task/review inputs and verification eligibility before recording. It refuses observed changes during that decision; it does not promise filesystem-wide atomic isolation.

Success releases that task's scope and adds `task.result_basis` with `kind: "bounded"`, the reason, acceptance-time `project_state: "stale"`, prior run ID, prior implementation fingerprint and relevant task revision. Text output identifies the limited acceptance. The historical basis stays unchanged when later work or verification advances. Ordinary results omit this field.

The command never updates the project verification record, marks a goal done, or claims undeclared dependencies are independent. `status` remains stale and project completion stays blocked until a real `finish` passes. A later target change can expire a closed review's current approval while preserving its historical result. The 50-row input-drift display cap has no authority over eligibility.


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
  --review-of fix-cache --check cargo test --release --test cache
```

A review binds the target's current state. Findings recorded on the target and their resolutions do not change that state; edits and a worker's `task addressed` do. If the target changes, the review is accepted, checked and challenged again. An old CLOSED review gives no current approval; open a new one. Each `task lens NAME PACK "…"` binds the model, the epoch and the pack.

`--model` and task records are claims, not authentication. Records the orchestrator makes while a worker carries a task stay unconfirmed: READY is allowed, CLOSE is refused until `task confirm`.

## Challenge

`blabla challenge NAME` reports the one strongest contradiction it can ground; a class that blocks the hand-back comes before a project-level one. With a task that is not CLOSED or WITHDRAWN it exits 0 when the hand-back is clear and 1 when it is blocked; otherwise exit 1 means a project challenge stands. It reads no code meaning; silence means no contradiction was found, not approval. Classes:

- **Task record**: `unresolved-finding`, `deliverable-unchanged`, `scope-breach`, `work-without-acceptance`, `attribution-unknown`
- **Roles and decisions**: `model-outside-role-policy`, `exception-unresolved`, `decision-unanswered`, `question-unpicked`, `orchestrator-record-during-carry`
- **Evidence**: `declared-check-failed`, `readiness-without-evidence`, `evidence-superseded`, `review-target-stale`, `lens-unassessed`, `unobservable-task-input`, `check-not-falsified`
- **Project**: `vacuous-rule`, `verification-not-current`, `withdrawal-residue`, `goal-outcome-unmet`

## Upgrading to 0.12

0.12 reads only task records it wrote. Before switching, close or withdraw every task with the BlaBla that opened it, or move closed history out of `.blabla/tasks/`; a record it cannot read names its file and these routes. A verification record written by another version shows STALE: run `finish`. Checks are declared one way, `--check PROG ARG…`; `--check-argv` is gone. [Breaking notes](../CHANGELOG.md#0120-2026-10-29)

Authoring: `blabla guide bootstrap`, `guide change`, `guide memory`. Optional advice: [Expert](expert.md).

### Prepare a one-pass hand-back

Prepare one coherent packet; a new defect or changed claim still requires recovery.
This order uses existing guards, not a new readiness or acceptance authority.

1. **Settle the assignment first.** The owner declares actual deliverables and
   check inputs and settles known assignment changes and findings. Read
   `task show NAME` for the accepted model and consulted lenses before preparing
   final receipts.
2. **Freeze source and current evidence.** Inspect
   [receipt-relative freshness](#inspect-receipt-relative-freshness). Run the
   declared check only when evidence is missing, failed or superseded; read its
   complete child log. Do not replace current evidence for a metadata handoff.
3. **Finish explicit claims.** Assess every consulted lens, and no unconsulted lens,
   then [challenge and hand back](#the-loop). Claims remain inspected judgments,
   never automatic confirmations.
4. **Pin the final review packet.** The independently assigned reviewer inspects
   the final explicit source/goal/claim-digest set before its final acceptance
   pin. Use [guarded review reuse](#reusing-an-unchanged-review-execution) only
   when eligible; unchanged source alone does not establish eligibility. The
   review still needs its own current evidence, required claims/lenses, challenge
   and READY hand-back.
5. **Let the owner accept.** After hand-back the
   owner confirms actual carry records where required, accepts the reviewer,
   then accepts each source. READY or a current Accept receipt is not owner
   acceptance, and bounded closure is not project completion.

If the packet changes, [recover the specific invalidation](#recover-a-ready-hand-back)
without reflexive reacceptance or suite repetition. Changed
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
a current READY inspection is read-only. Batch execution and review at
substantial feature boundaries; adding or editing a test is not itself a reason
to rerun the suite.

### Inspect receipt-relative freshness

Use `blabla task freshness NAME` or `blabla task freshness NAME --json` before
reassessing a stale hand-back. In this repository,
invoke the current source with `cargo run --locked --quiet --bin blabla --`.

The read-only view groups equal receipt comparisons once and distinguishes the
latest matching check and
recursive review-target links. If no current check matches, it labels the latest
historical evidence as nonmatching. Missing receipts and missing/unreadable/cyclic
targets remain explicit.

JSON `receipts[].shared_delta` references a response-local `deltas[].id`.
Each group exposes its context, epoch change, opaque assignment digest comparison,
selected path changes, and exact identity fingerprint changes. Assignment field
history is `baseline-unavailable`. Review comparisons include
composite receipt context; the view never guesses which historical field changed.

New check receipts capture an optional `member_manifest` from the **same observed
tree** as their selected input digests. It contains a sorted, deduplicated union
of every tracked leaf covered by those inputs (including deliverables), not just
owned or changed files. `--run` receipts label it `execution-start`: it is captured
before spawning and is not resampled when the command finishes. Manual `--exit`
receipts label it `manual-record`, a record-time observation, **not an observed
execution**. Existing task locks, captured epochs and check identities still
apply; this is not an atomic filesystem snapshot or proof of actual file access.

For check children, a complete supported manifest must reproduce **every**
recorded input digest, including null observations, before it supplies the
`evidence-input-manifest` baseline. The current projection must match too. Changed
input-root selection is not interpreted as a file addition or removal.
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
existing explicit evidence routes after inspecting the cause.

Freshness also adds `input_reconciliation`, joining the selected check's
zero-based evidence index, epoch, time, capture and shared delta to its validated
member baseline. Equal selected-root keys and independently reproduced current
root digests are required. It lists exact unchanged and changed **current-declared-scope**
members, and changed selected-input dependencies outside that scope, with their
fingerprints and containing input roots. Ownership is current, not historical;
these dependencies are not an inferred semantic graph.

Each collection has complete counts and a deterministic 50-row cap (82 members
means 50 shown, 32 omitted). Scope roots not fully covered by inputs report
`not-observed-by-this-check`; null input observations remain explicit, never
unchanged members. Missing, invalid or unavailable baselines and changed
input selection yield null comparison totals with reasons. Manual capture remains
`manual-record`, not observed execution. Inspect `task show NAME --json` for the
full saved manifest and adjacent receipts for review targets. This comparison neither proves a whole scope unchanged nor
explains every stale manual claim; it renews no claim and grants no reuse credit.

### Reusing an unchanged review execution

`blabla task accept REVIEW --model MODEL --reuse-evidence --reason "Exact execution inputs remain unchanged; renewed source claims were inspected"` explicitly repins an ACCEPTED or READY review and reuses its latest original successful run. Without it, a review accepted again needs a new execution, because its evidence counts only in its current acceptance.

Reuse requires the same still-permitted accepted model, exact check identity and complete observable input map, a readable original task-local log, and unchanged execution coverage of every recursive source scope, declared input and deliverable. A report edit counts as an input edit. Missing paths, manual evidence, an older success behind a newer failure, falsification obligations and chained reuse refuse before recording. Current source targets remain explicit; no target is inferred.

The original evidence stays intact. The appended `tool: "reuse"` entry retains its execution time, argv, input hashes, exit, tree, log and optional member manifest unchanged, with a separate optional `reuse` object naming the zero-based original evidence index, original epoch/digests, attesting model, reason and reuse time. A manifest explains changed inputs; it cannot make a changed broad root reusable merely because an owned leaf is unchanged. Text output distinguishes execution from reuse; absent member metadata stays absent.

Acceptance advances the epoch and clears the challenge. Lenses are not renewed; inspect and record them explicitly before hand-back. Both closure modes retain their existing checks. Final recording reloads task, process authority, execution inputs/log and recursive review context and refuses if the inspected context changed. This is an explicit execution reuse path, not a guarantee of filesystem-wide atomicity or permission to omit report dependencies.
