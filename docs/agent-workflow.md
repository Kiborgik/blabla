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
- `task evidence --run` runs an argv check from the project root with no shell and no timeout, so pick a bounded check. For a text check, run it yourself and record `--exit CODE --tool TOOL`
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
| widen scope and fix the check at once | `task check NAME --add-scope PATH… --argv PROG ARG…` |
| change deliverables or scope | `task deliverable NAME --add\|--remove PATH`; `task scope NAME --add PATH` |
| change the statement | `task statement NAME "…"`; the hand-back must be challenged again |
| withdraw | `task withdraw NAME --reason "…"`; changed paths stay challenged until restored or `task reconcile-withdrawal` names a CLOSED successor with current evidence whose inputs or deliverables cover them; the reconciliation then stands while that successor stays closed, and later changes belong to later tasks |

Scope, check, attribution and withdrawal changes are the orchestrator's. Resolving, answering, confirming, attributing, removing a deliverable, withdrawing and reconciling need `role::orchestrator` declared in process memory, so a worker cannot settle its own obligations; without it, `task open` says so up front, and an optional `--model` on `task check`, `task scope` or `task statement` is recorded unchecked. BlaBla options go before `--argv` and `--check-argv`: everything after them is the check, and an argument there that matches a BlaBla option is kept and reported. `--input` replaces the whole input list. After hand-back, the orchestrator checks records it made during the carry and runs `task confirm` once before `task close`. A task assigned to role `orchestrator` needs no confirmation: its own records never count as made during a carry.

Running several tasks at once: author the rules for work not started yet in a `draft` contract and promote it to `use` when its task opens. An active RED rule keeps `finish` from passing. Ordinary `task close` still requires current passing project verification.

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

Changed directory children are shown only when the saved opening tree reproduces
that exact receipt's selected digest, the current projection matches too, and the
selection is safely reconstructible. Otherwise child history is unavailable.
`opened-tree-digest-match` is a fingerprint boundary, not semantic proof. Leaf
changes describe tracked membership: ignored/symlink/unreadable members may be
absent, and large files may use metadata hashing rather than content hashing.

Receipts, groups, selected paths and identities each have a 50-row presentation
cap with complete total/shown/omitted counts. All displayed groups share a global
50-child-row budget. Child totals cover available comparisons, including roots
hidden by the path cap; unavailable baselines have null totals. The same child
can occur in different receipt contexts. No task/status/evidence bytes, target
pins, check predicates, claim authority or closure rules change. Follow the
existing explicit disposition/reflect/evidence routes after inspecting the cause.

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

The original evidence stays intact. The appended `tool: "reuse"` entry retains its execution time, argv, input hashes, exit, tree and log, with a separate optional `reuse` object naming the zero-based original evidence index, original epoch/digests, attesting model, reason and reuse time. Text output distinguishes execution from reuse. Old records without this object remain compatible.

Acceptance advances the epoch and clears the challenge. Dispositions, lenses, reflections and delivery verdicts are not renewed; inspect and record them explicitly before hand-back. Both closure modes retain their existing checks, independent outcome review and Partial/Blocked residuals. Final recording reloads task, process authority, execution inputs/log and recursive review context and refuses if the inspected context changed. This is an explicit execution reuse path, not a guarantee of filesystem-wide atomicity or permission to omit report dependencies.
