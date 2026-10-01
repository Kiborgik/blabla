# How BlaBla changed the development loop

BlaBla made acceptance gaps, unresolved review findings and stale evidence explicit
across handoffs. Independent reviewers found the RTS defects; BlaBla preserved the
work needed to settle them. The strongest demonstrated benefit is a traceable
correction loop, not automatic game judgment or a measured development speedup.

## What the fuller workflow added

- **Acceptance before implementation.** Recognizable actions, intentional placement,
  accidental-spend safety, a consequential battlefield event and readable compact
  controls became named obligations. Passing engine tests could not silently stand
  in for the missing event or player-facing evidence.
- **Independent falsification before acceptance.** Reviewers received bounded work
  and looked for counterexamples. An initially GREEN engine campaign still missed
  inherited catalog keys. The failed reproduction was retained, acceptance was
  withheld, and the engine received a separate repair assignment. The adapter did
  not sanitize the input to hide the defect.
- **Repairs tied to the original failure.** Unchanged reproductions were rerun after
  corrections. The direct-placement review prompted one correction pass; the later
  mite feature and command dock each returned for their own correction round.
  Named inherited-key witnesses became permanent real-engine contract coverage.
- **Evidence tied to the source it tested.** Fresh review bindings and check inputs
  made earlier successful evidence insufficient for changed work. Browser checks
  covered actual layout and interaction failures that source checks missed. Final
  event/HUD repairs received targeted browser rechecks; the older complete-match
  recording retains its original revision and is not a final-source match claim.

The RTS path used assignment, acceptance, implementation, focused evidence,
independent review, recorded findings, correction, re-review and orchestrator
verification. BlaBla can challenge the record; it cannot decide that a game is fun
or that a reviewer has found every defect. Runtime expert nudges were not used.

## Defects this process brought back for correction

1. **A refused building bought the previous choice.** Selecting an unavailable
   Spine retained an armed Siphon and spent 80 food. Explicit arming success and
   cleared stale ownership changed the original reproduction from accidental spend
   to no spend or extra building.
2. **Research described the wrong action.** Adapt announced a building-limit error
   and omitted what its percentage meant. Separate research metadata restored its
   action, cost, vitality effect and state descriptions.
3. **Inherited keys corrupted build and production.** `constructor`, `__proto__`
   and `toString` passed catalog lookups, producing `NaN` food and malformed entities
   or queues. Primitive-string and own-property guards reject them without changing
   the world. Build and production were both checked.
4. **A detour looked successful while the squad stalled.** Visible bodies reached
   the resource, but the authoritative center remained outside capture range.
   Planning used clearance 20 while movement clipped at 22. Shared clearance made
   the unchanged capture order actually traverse and capture during the encounter.
5. **The mite alert concealed the attack warning.** Actual compact-browser pixels
   exposed overlapping notices. A shared flow stack made both readable.
6. **The next HUD change hid that warning again.** Placement guidance stayed inside
   the field but covered the event notice. Collision-aware placement preserved the
   warning, rejection reason, ghost and Cancel together.

These are reviewer discoveries through BlaBla assignments, not automatic semantic
findings by BlaBla. The earlier right-click cancellation repair was ordinary
self-review and is separate.

## What changed in BlaBla itself

The original workflow-only snapshot has been superseded by an **implemented,
independently reviewed product-code follow-on** in the release tree:
[RTS-driven String boundaries](rts-string-boundaries.md).

Generic String generation now includes the three inherited mapping keys without
requiring contract literals to supply them. That expands the available inputs,
but the retained bounded comparison **still reported GREEN on the buggy RTS**:
its generated keys occurred outside range, at capacity or in read-only previews.
Generating a dangerous value is insufficient without the triggering state/action.

During subsequent release integration, the changed sequence automatically exposed
a C-example persistence defect: adding a space-only item and restarting lost it.
The space was already an old boundary; none of the new mapping keys caused that
minimized failure. The C loader was repaired. Integration also exposed a missing
lease witness, leading to a generic guidance repair that preserves valid companion
fields when deliberately generating a missing identity. The lease result was a
coverage gap, not a discovered lease-application defect. The linked report retains
the separate RED/GREEN evidence and exact causal limits for both follow-ons.

These are code changes present in the release tree, not a claim of a published
release or general coverage improvement. Acceptance criteria, retained failures
and fresh review are workflow changes. Clearer memory-validation guidance and more
consistent task flags remain tool-improvement candidates, not completed fixes.

## What carried into the next feature

The new D&D adventure work adopted the fuller workflow **before its first kernel
edit**: prospective ownership, a thin bridge to the real reducer, explicit
prototype-name witnesses, independent review and separate player acceptance.

That first review found a new seam defect. With the documented test-only patched
catalog, the reducer rejected unsupported target/path definitions, but
`legalChoices` offered a hidden actor and `previewAction` exposed hidden-cell
coordinates. Shared fixture validation now runs before projection too. The
original RED witness was retained and the independent unchanged reproduction
passed against repair epoch 2; the finding was resolved in the task record.

This is concrete next-feature correction evidence. It is a finite test kernel,
not a playable adventure, an SRD-complete implementation or a public-route exploit.
The normal frozen fixture did not leak. Browser delivery, persistence transactions,
real DM/Kev play and product acceptance remain separate obligations. No speed or
rework reduction has been measured.

## Runtime-expert boundary

The separate real Kev calibration completed but selected **no feasible policy**:
all development choices were `unclear`, with no proposed or delivered nudges. A
later four-case compact-rendering diagnostic was faster and recognized one aligned
case, but still missed both justified drift cases and proposed no nudges. It was
not a qualification or promotion. Neither result supplies evidence of runtime
expert benefit to the RTS or adventure work.

## Evidence anchors and limits

RTS reference: V10 `263927d1e4b6eaea6665e3b375dac184d0ce2002`;
[public game](https://microcosmos-fibre-wars.kibgames.chatgpt.site/).
The records below, rather than the live URL alone, bind the findings to source.

- RTS repository: `docs/direct-placement-evidence.md`, `docs/placement-contract.md`,
  `docs/mite-crossing-review.md` and `docs/command-dock-review.md`, including their
  original/repaired browser artifacts and task receipts
- Adventure repository: `docs/adventure-workflow.md`, task
  `review-adventure-kernel`, and its scratch `REVIEW.md`, `first-run.log` and
  `after-repair.log`; the review records exact source hashes and the epoch-2 rerun
- BlaBla follow-ons: [String-boundary evidence](rts-string-boundaries.md), tasks
  `generate-mapping-key-boundaries` and `review-generate-mapping-key-boundaries`
- Local expert audits: `blabla-fresh-calibration/real-calibration-outcome-review.md`
  and `blabla-compact-renderer-diagnostic/run/readout.json`

Physical touch, uncoached comprehension and enjoyment are not established by these
records. A GREEN check establishes only the exercised obligations, and a closed
handoff is not whole-product acceptance.
