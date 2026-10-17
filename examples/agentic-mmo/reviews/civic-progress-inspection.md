# Civic progress and explicit government inspection

## Bounded source result

Art Director implementation for `expose-civic-progress`, accepted with `gpt-6-astra`. The spectator now has a separate Culture-funded civic section alongside the existing Science section, an inspectable current government arrangement, and canonical current opening contributions separated from recorded construction work. This is checked source, not live civic adoption or public pixel acceptance.

The six originally assigned paths are `web/civic-progress.ts`, `tests/civic-progress.test.ts`, `web/main.ts`, `web/styles.css`, `web/capability-tree.ts`, and this report. The orchestrator explicitly added `tests/capability-tree.test.ts` to reconcile its research/construction graph assertion with the new separately owned civic edges. No core, release metadata, credential, live-world, or deployment changes were made by this task.

## What a spectator can inspect

- Culture has its own heading and exact snapshotted progress / required Culture. Available choices use canonical civic names and costs. Actual completion retains its recorded round and event. The text explains productive Culture and keeps Science independent.
- Government remains unadopted until the committed record contains an explicit arrangement. The current name, assigned policy and explicitly empty slots use canonical target slots and assignments. Effective round, commitment rounds, pending target and retained transition rounds, payment, and unspent reform provenance remain separate facts.
- Prerequisite eligibility and price quotes are labelled as such, never treated as current permission to act. No automatic adoption or policy assignment is inferred from civic completion. Only the canonical unused reform record is displayed; a spent historical event is not reconstructed into a new entitlement.
- Current modifiers show exact base contributions, such as `+1 base Food` and `+1 base construction work`, plus the supplied current ordinary-output factor. The selected town's construction capacity is taken directly from `CapabilityProjection.governance.cityConstructionWork`. Actual order work and retained completion are shown separately. No viewer code computes productivity, credited output, lock timing, or transition duration.
- Both civic and government details use native disclosures with existing retained-disclosure keys. New text is assigned with `textContent`; there are no world-changing buttons, forms, or inputs. The existing Culture icon and theme variables are reused.
- A world without the civic feature has no civic section. Missing records, missing town context, blocked choices and empty arrangements stay explicit rather than becoming zero progress, an adopted government or an invented effect.

## Canonical seams and integration

`web/civic-progress.ts` consumes `CapabilityCatalogue`, `CapabilityProjection.governance`, `decisions.civic`, the selected town's retained construction state, and bounded matching public arrangement events. `web/main.ts` reuses its canonical capability projection for territory and civic presentation, includes the civic facts in inspection refresh identity, and inserts this read-only section after Science and before the existing capability opener. Existing section navigation and disclosure/focus retention remain in control.

The only runtime change in `web/capability-tree.ts` formats the newly introduced `civic-prerequisite` blocker safely. Its existing graph still represents technology, building, improvement and wonder nodes. The amended test compares every exact edge whose endpoints belong to that graph and separately asserts that the catalogue retains `civic:code-of-laws → government:chiefdom` and `civic:code-of-laws → policy:urban-planning`. No canonical dependency was removed to make the test pass.

## Verification

At 2026-10-17 20:06 UTC, the exact declared command completed with exit 0:

`node --test tests/civic-progress.test.ts tests/capability-tree.test.ts && npm run typecheck:web`

Result: 37 tests passed, zero failed, followed by successful web typechecking. Twelve are the new civic tests. The initial stub run had one passing legacy test and ten failing civic assertions before the implementation was added. A later exact later-opening construction test also passes. The first combined run exposed the old graph assertion's 82-versus-84 mismatch; the orchestrator-approved semantic test correction then passed. `git diff --check` was clean.

The civic tests consume Core's legal `civicBootstrapJourney` through compatible application, explicit Code of laws selection, actual productive completion, explicit Chiefdom / Urban planning adoption, and a later real Granary construction consumer. They check that the rendered recorded work is the actual later order progress rather than the `+1` base contribution. Current government choices and source frames are not presented as live user-world actions.

Additional unit cases supply fractional progress and missing read fields. The retained pending-transition case is explicitly named synthetic and does not claim that an advanced government or that transition is a legal released choice. Renderer tests use a small DOM record and verify native disclosure structure and absence of world controls; they are not pixel, physical-device, or real-browser keyboard evidence.

## Acceptance and remaining work

Creative approved the three bounded surfaces and confirmed the implementation direction. Source tests and types are complete for this packet. Public civic pixels and the real actor sequence remain pending an independently accepted publication and explicitly authorized compatible activation: choose Code of laws, complete it, explicitly adopt the arrangement, then observe a later opening consequence. The current public `live.29` Town production review is separate evidence and does not establish civic delivery.

The supported cloud browser cannot resize its viewport and cannot reach the execution workspace's loopback server. No 390px, physical-touch, WebGL, or local pixel acceptance is claimed. The known Town-panel sticky Close overlap remains a separate spectator-comfort residual; this task does not expand into that polish work or a new timer design.

All three affected delivery outcomes remain Partial. Art owns the later civic desktop inspection and supported narrow/device verification; the orchestrator owns publication, activation authority and the next bounded task. The substantive inhabited-landscape goal still requires a separate matched-view visual transformation and is not completed by this civic panel.

## Shared-tree attribution

This worker changed only its seven assigned paths. Concurrent Core civic behavior, Server validation/persistence, contract/goal/roadmap edits, public QA/review records, and root CLI transport repair belong to their existing tasks. The orchestrator-added scope record requires its normal hand-back confirmation. The task's broad `core` and `web` check inputs require a final currentness check after other owners freeze; no unrelated work should be attributed to this UI task.
