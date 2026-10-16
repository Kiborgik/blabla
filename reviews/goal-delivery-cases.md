# Prospective goal-delivery lifecycle cases

Author: actual `gpt-6-astra` / high, 2026-10-16. ROOT task
`specify-goal-delivery-cases`. The first sections preserve the prospective
tests/report phase; the authorized implementation update below records current work. The current design reference is `reviews/goal-delivery-obligations.md`,
with the owner's later resolution narrowing below taking precedence.

## First observed boundary

The first eight-case source-CLI run compiled and executed: the legacy task/goal
closure control passed; seven prospective cases failed. The current goal parser
does not accept the required-delivery declaration fields, so named-goal task setup
refuses unreadable goal memory. The separate legacy-declaration command case reaches
the missing `task delivery` surface. `/tmp/goal-delivery-first-red.log` retains that
real result. It does not prove later review, closure or residual assertions ran.

An expanded draft had a Rust temporary-borrow fixture error, retained in
`/tmp/goal-delivery-expanded-red.log`; it was corrected before the later executable
RED. The 28-case suite compiles and runs with one legacy control passing and 27
prospective failures in `/tmp/goal-delivery-complete-red.log`. Some no-primary-goal
setups reach missing applicability enforcement or the missing extra-goal flag;
most stop at the unsupported goal fields. Looped later cases remain prospective.
The final task check records the same exact `cargo test --locked --test goal_delivery`
against the frozen test/report inputs. RED is intentional and cannot support READY.

## Proposed concrete surface

Required goals add `delivery "required"` and optional `applies-to ["system::app"]`.
Existing primary `--goal`, repeatable `--delivery-goal`, and exact declared system
write-scope intersections select obligations. Broad check inputs do not select them.
Persisted task obligations are keyed by exact `goal::name`, retaining selection basis
and the original definition. Goal-less report review uses ordinary `review_of` and
its own write scope, with no new exemption type. A production-changing review still
acquires mapped goals.

Proposed author command: `task delivery NAME GOAL --status STATUS --observation TEXT
--observation-ref JSON --model MODEL`. A repeatable typed reference has `kind`,
`locator` and `context`; kinds distinguish verification, artifact, runtime and
viewport. Delivered requires a non-verification observation. Partial additionally
names `--delivered`, `--remaining`, `--owner`, `--next`; Blocked names `--blocker`,
`--owner`, `--unblock-when`; initial Not-applicable requires a bounded `--reason`.
These are reviewable claims, not authenticated proofs or filename heuristics.

Proposed independent command: `task delivery-review REVIEW GOAL --verdict accept|reject
--reason TEXT --observation-ref JSON --model MODEL`. Review binds the current claim
digest, goal and recursive target revision. A later exact resolution additionally
supplies `--resolve-origin {"task":...,"goal":...,"claim_digest":...}` and explicit
`--resolution delivered`. Accepting Partial alone cannot discharge its residual.

The owner explicitly narrowed the first resolution path to Delivered only. A later
Not-applicable review cannot erase a previously applicable residual. Initial reviewed
Not-applicable clears only that task's applicability. Removed/disabled definitions
retain unresolved origins. An owner-authored dropped goal is shown with a retained
retirement notice and is never relabeled Delivered. This supersedes the broader
reviewer-retirement alternative in the earlier research report.

Proposed public views: task `delivery.obligations` rows expose exact goal and current
claim digest, with `delivery.claims_current`; persisted source claims remain in
`task.delivery_obligations`. Status `delivery` contains residual rows, total/omitted
counts, unavailable-record notices and next routes. The prospective status cap is
50 rows; the 52-obligation case requires two omitted and complete per-goal drilldowns.
Text must show the same limit and actionable Next route. These field names and CLI
spellings are explicit prospective API choices for owner review before implementation.

## Falsifiable matrix

- Legacy serialized task/default closure still works without delivery metadata.
- Primary plus mapped cross-cutting goal selection; explicit extra selection;
  broad read inputs do not attach goals; unknown/wrong-kind/prefix system IDs refuse
  without writes; widening adds obligations without losing the original goal.
- A real passing source check and canonical counter run do not replace current
  claims. Both goal claims are needed; writing one preserves evidence/epoch/scope,
  target and global status and cannot claim the other automatically.
- Verification-only Delivered, incomplete Partial/Blocked/Not-applicable, wrong
  actor, missing check, source drift and revoked model fail without tree mutations.
  Changed goal definitions and tracked local observation bytes stale claims.
- Separate assigned review, current target/claim/goal/source and model authority;
  same-task author, unrelated task and wrong review model cannot grant acceptance.
  A rejected verdict blocks both ordinary and bounded source close.
- Positive Delivered closes in both modes while preserving canonical status bytes
  and active goal declarations. Actual canonical GREEN plus an actual unrelated
  report change prepares bounded close; no synthetic GREEN or fabricated evidence.
- Reviewed Partial/Blocked closes source in both modes and leaves durable owner/
  trigger reminders after separate process reads and a later real GREEN run.
- A later explicit Delivered resolution names the exact origin+goal+claim digest,
  leaves the closed source bytes intact and preserves other goals and other source
  origins. Missing explicit terminal and wrong task/goal/digest refuse unchanged.
- Goal removal/disabling, unreadable source/review records, bounded displays and
  manual done declarations cannot silently erase an unresolved outcome. Owner
  retirement remains visibly distinct. Delivery truth never manufactures contract
  RED/GREEN or overrides real failing source evidence and findings.

Every fixture check and lifecycle transition uses the actual source CLI. Runtime
and viewport references deliberately use `fixture://` and explicitly synthetic
context: these test machine accounting, not a deployed player cycle or a real
browser inspection. A reviewer can still reject fabricated or insufficient meaning.
The 26-source overflow fixture is finite and creates real claims/reviews/closures;
its later execution cost is not established by the current early RED.

## Original prospective implementation boundary

No new behavior is implemented or accepted. The owner must review the proposed
surface and authorize production scope. The eventual shared resolver must serve
READY, both CLOSE paths, status/Next and goal views together so Partial cannot become
a closed-source dead end. All existing evidence, model, findings, target and owner
authority remain required. Exact final reread/valid-but-changed concurrency tests
can use a private production-path checkpoint after scope authorization; this suite
does not expose a public bypass or claim atomic filesystem isolation.

## Independent prospective review corrections, 2026-10-16 17:29 UTC

The reviewer identified a fixture mismatch in the failing-check control:
`task evidence --run` returns successful receipt storage while recording the child
check's nonzero exit. The case now requires successful recording and retains its
assertion that the stored child exit is nonzero before testing both close refusals.
This corrects the prospective fixture; it does not change evidence-run semantics.

A separate case now creates an earlier reviewed Partial source origin, then closes
a later initially Not-applicable report for the same still-active goal in each
close mode. The earlier residual, claim digest and closed source bytes must remain.
This isolates the latest applicability refinement from missing or disabled goal
definitions. The original 28-case RED remains preserved; these downstream assertions
remain prospective until the missing declaration and command surfaces exist.


## Authorized implementation, 2026-10-16 17:56 UTC

The owner authorized the existing memory/task/CLI/close/view seams after independent
review of the corrected 29-case matrix. Goal metadata and default-skipped task maps
retain legacy records. The shared delivery resolver selects declared write systems,
pins definitions monotonically, validates explicit typed claims and independent
review records, and derives residual views from retained task history. No separate
canonical status or completion store was added. Owner-dropped required goals do not
attach automatically to new work; explicit primary/extra retired assignments refuse,
while old origins retain a retirement notice. Active and done required goals attach.

READY requires current claims but does not await independent acceptance. Separate
review tasks can therefore inspect a READY source and close normally; source CLOSE
then requires their current accepted verdicts. Both close modes preserve canonical
status bytes. Only an exact independently accepted Delivered resolution discharges
a closed Partial/Blocked origin; later initial Not-applicable claims leave it intact.
References remain attestations requiring substantive independent inspection. The
fixture runtime/viewport locators do not demonstrate real player or browser outcomes.

Private checkpoints call the same actual writer and close paths. Writer tests cover
no-op success; source/artifact drift; revoked and valid-but-changed process authority;
goal/system changes; task state, epoch, evidence, concurrent valid notes and claims;
exact reviewed origin and recursive ancestor changes. Claims, review verdicts and
later resolutions are exercised. Close tests cover both modes with no-op success,
changed valid review context, revoked reviewer/owner authority, changed verdict and
removed canonical record. The ordinary delivery path reruns its complete existing
eligibility after reloading Project. The checkpoints establish deterministic final
reread behavior, not global filesystem atomicity.

The owner explicitly required current orchestrator model attestation for delivery
close, including tasks carrying verdicts. Wrong/empty/missing models and absent
current orchestrator role refuse without writes; legacy ordinary close remains
compatible. Models do not authenticate people or prove semantic independence.

### Preserved deciding observations

All current logs below are under `.blabla/scratch/specify-goal-delivery-cases/`.
The original recorded 28/29-case REDs remain in `evidence-1-14-1792171150828745940.log`
and `evidence-2-14-1792171783713811720.log`. An executor recovery removed the earlier
`/tmp` exploratory logs named above, so those paths are historical, not retrievable
artifacts. The task evidence logs survived.

- The narrow `applies-to` parser regression genuinely failed before the syntax
  change; `parser-green.log` records the strict-field positive/negative result.
- `first-implemented.log`: 29 pass, 2 fail from prospective fixtures using positional
  scope additions. Correcting them to existing `task scope NAME --add src` produced
  31/31 in `implemented-second.log`; no scope-command policy changed.
- `compatibility-first.log`: one legacy undeclared-primary-goal diagnostic failed.
  The preflight now reuses the existing diagnostic including declared goal names.
- `owner-close-red.log`: ordinary close really accepted the wrong owner model before
  its guard. `owner-close-green.log` includes the succeeding owner/refusal controls.
- `close-run-race-red.log`: ordinary close accepted after the canonical record was
  removed at the checkpoint. The complete final eligibility reread fixes this;
  `close-reread-green.log` records all four close checkpoint cases passing.
- `compatibility-second.log`: 362 tests passed across the combined declared suites,
  including 33 lifecycle cases, 14 delivery checkpoint cases and all 141 unchanged
  workflow assertions. Later owner-role/missing-flag controls are included in the
  final task evidence run rather than retroactively claimed by this log.
- `voice-integration.log`: five challenge-rendering tests pass. The exploratory
  `skeptic::tests` filter matched zero library tests and supplies no behavior proof;
  the combined real CLI goal/challenge cases exercise the actual integration.

The final task evidence records the combined declared command against the final
source/report inputs. Contract bindings remain draft and unpromoted. Source testing
and this author report do not substitute for independent implementation acceptance
or for delivered runtime/viewport outcomes in a real project.


## Independent implementation finding 1, 2026-10-16 18:06 UTC

Creative found the sibling `task check --add-scope` route widened scope without
pinning new mapped delivery obligations. An isolated actual CLI reproduction reached
CLEAR and READY without reacceptance or claims after a report-only task gained `src`.
`check-add-scope-reproduction.json` retains the real record and calls. The focused
`check-add-scope-red.log` then failed on the actual absent mapped obligation.

Pinning now happens in the existing shared `widen_scope` boundary used by both
amendment routes; the separate ordinary-scope call was removed. The regression
requires immediate mapping with unchanged acceptance/epoch, refusal of READY until
an explicit current claim, and then positive READY without reacceptance. An invalid
system mapping also tests the combined check amendment's exact no-write refusal.
The prior363-test receipt remains historical evidence; the refreshed declared check
covers this narrow correction. No contract, close or canonical verification policy
was changed for this finding.
