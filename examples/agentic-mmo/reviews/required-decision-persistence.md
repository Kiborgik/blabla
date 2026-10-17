# Recurring decision persistence

Actual author: gpt-6-astra/xhigh, 2026-10-16. Task `persist-recurring-decisions`. Production changes cover canonical `core/validation.ts` and a narrow `server/repository.ts` refusal-routing correction; core behavior is independently authored under `implement-required-civilization-decisions`. Existing repository transactions, auth, schema, raw snapshot writers and replay formats are reused unchanged.

## Boundary

Old snapshots retain absent construction and research-completion fields. Explicit adoption also leaves existing cities unchanged. Present records require `recurring-decisions`; they have exact keys, known identities, safe counters, bounded canonical event/order references and finite nonnegative known-resource vectors.

- A city has at most one active order and one last completion. Active order identity is `construction-${acceptedRevision}`, with revision in 1..world revision. It names its containing town and an unbuilt known building, fixed rule version 1, a past/current start round, positive required work and progress strictly below that work.
- A completion names the same town and an installed building, retains its paid/work snapshot and has a later completed round and event revision. Retained order identities are globally unique. A subsequent active order cannot precede the prior completion round and must have a later accepted revision; two prospective corruption cases exercise those cross-slot bounds.
- Each civilization may retain one completion for an actually discovered technology. Its round and canonical `revision:index` event reference must not point into the future.
- Reference validation does not require membership in the bounded recent-event feed. It is shape/identity/chronology validation, not proof of the entire historical transition. Current catalogue cost or work values do not reinterpret stored commitments.
- Required/Active/Blocked decision projections are derived by core. No extra stored flags, persistent request lock, automatic next order or unbounded completion array is introduced.

## Deciding evidence

Prospective validation reached all assertions: 32 malformed records were accepted before the validator change, with one valid legacy/adoption/history control. `validation-red.log` preserves that run. The first two real hosted journeys also failed at missing research completion and incorrectly accepted Hold, separately from the synthetic corruption fixtures. No import, compile or missing-directory failure is counted as behavioral RED.

The legal hosted fixture uses actual seed 1701 initialization, compatible releases, selected agriculture research, exact-town farm start and due strategic beats. It performs no stock, map, work or damage edits. Construction `construction-17` starts at round 3 and completes at round 7; research completion is recorded at round 2, event `15:10`. Partial work, absence of premature installation, exact upfront payment, concurrent identical retry, completion and original receipt survive real SQLite close/reopen. Every stored frame and event is independently replayed through the existing pure transition interpreter using bounded three-entry history pages.

Additional hosted cases cover:

- Two ordinary actors' exact-town commands sharing an original revision, bounded CAS revalidation, distinct order identities and payment once.
- Strict composite CAS loss against a deliberately injected valid competing state, with no candidate order/history/receipt retained. The injection is an isolated race probe, not a second claimed complete history.
- Insertion failures in either history or receipt storage rolling back due upkeep, construction payment, order and receipt together; reopening and an explicit same-request retry then commit once.
- Foreign/missing towns, mismatched plan head, active research replacement and an explicitly synthetic insufficient-stock fixture refusing with identical durable records.
- Hold after projected completion refusing atomically, followed by explicit upkeep and a selected next technology. No fallback choice or partial upkeep is committed on refusal.
- Explicit corrupt-current and corrupt-history failure without read-side repair or writes.
- A last-completion receipt surviving real recent-event eviction and a subsequent order, then being replaced by one newer bounded completion.
- The preceding release's immediate build and absent new fields remaining replayable after reopen.

The ordinary CAS fixture initially assumed both civilizations had finished agriculture by six beats; Verdant had not. The test now waits on actual discovered state with a finite 24-beat ceiling before concurrent construction. That fixture correction is not a production fix.

Independent Creative review exposed an actual host-boundary gap: the legal-menu prefilter returned generic `illegal_action` before canonical required-Hold or active-commitment refusal could run. Six real HTTP assertions failed prospectively in `host-refusal-red.log`. The narrow repair passes only an exact, shape-valid action recognized by the existing `decisionActionBlock` into the normal core command path. It does not recreate the predicate or grant an otherwise unsupported action. The canonical command still orders plan validation, timing/admission and decision refusal.

The new assertions cover named research/construction reasons and `blocked` outcomes for ordinary and atomic replacement, candidate-state Hold after research completion, unchanged durable records across reopen, malformed action refusal, mismatched-plan precedence and overdue ordinary timing precedence. Both candidate upkeep and the declined action remain absent. The six focused cases then passed in `host-refusal-green.log`; the final declared suite contains 68 tests, with separate strict lint for the added repository path.

Final exact declared evidence and scoped lint are recorded on the task after core's stable handoff. Prior intermediate logs remain in `.blabla/scratch/persist-recurring-decisions/`. Local SQLite proves the checked transaction/restart behavior; it does not establish managed-host quotas, peak memory, unattended scheduling or deployed delivery.

## Delivery disposition

Source persistence can be accepted on these bounded checks. The applicable recurring-civilization-decisions outcome remains Partial until authorized deployment/activation and a genuine agent research/construction/progress/completion/next-choice cycle are observed. Core and Creative own behavioral/live acceptance; Art owns supported viewport comprehension and semantic event presentation. No test count or report marks those user-visible outcomes delivered.

Aster's separate attempted live kiln call was rejected by authorization review and used a malformed `building` field instead of canonical `project`. It produced no accepted receipt, was paused and is not evidence for this feature. No live mutation, release activation, credential change or retry around that denial was performed by this task.
