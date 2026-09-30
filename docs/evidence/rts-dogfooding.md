# RTS dogfooding report

## Scope and result

This 2026-09-30 report records BlaBla's first bounded development loop on
Microcosmos RTS. The [public game](https://microcosmos-fibre-wars.kibgames.chatgpt.site/)
still runs V6, commit `b0a96857b93f8564ec0363bde17f53e52a9df0e1`. The direct-placement
candidate described below is unpublished. Work used the stable BlaBla foundation
tree corresponding to `480fb4c`; no 0.10 expert-host nudge was used.

BlaBla supplied explicit scope, requirement references, check receipts, findings
and review freshness. Independent assignment-assisted review found two candidate
defects, both corrected and independently rechecked. A separate application-backed
placement contract exercised real engine invariants. Actual-browser acceptance,
the environmental event and final integration remain open.

RTS source anchors below are relative to that project's root:
`docs/player-acceptance-plan.md`, `docs/acceptance-workflow.md`,
`docs/direct-placement-evidence.md` and `docs/placement-contract.md`.
The earlier workflow and review entries are historical snapshots: their original
memory-only setup preceded the later engine adapter.

## What changed and who found the misses

The user identified three V6 misses before this setup: text-only building actions
(R-05), an extra Grow confirmation (R-07), and no meaningful environmental event
(R-06). BlaBla did not discover them. The bounded implementation addressed the
first two: cards, ghosts and completed structures share `buildingArt`; costs and
purpose stay visible; a valid field tap/drag release or icon-drag release commits
once through the existing engine. A card alone only arms a preview. Event work
was deliberately kept separate.

The implementation and correction record is:

- **Ordinary self-review:** right-click could still commit construction. A failing
  handler regression reproduced it, then the cancellation fix made it pass. This
  correction preceded independent review and is not a BlaBla semantic detection.
- **First independent review, finding 2:** after three legal Spines, arming Siphon
  and dragging the unavailable Spine card retained the old Siphon preview. The
  limit warning appeared, but food fell **730 to 650** and structures rose **5 to
  6**. `startBuild` now clears old ownership and returns explicit arming success;
  pointer capture depends on that success. The unchanged reviewer reproduction
  then observed **730 to 730** and **5 to 5**, with no active preview or gesture.
- **First independent review, finding 3:** a completed Lab's enabled Adapt action
  announced “Membrane lab limit reached” in its tooltip/accessibility name, while
  the visible +25% omitted vitality. Research metadata now has independent
  growing, ready, shortage, adapting and adapted states. Re-review confirmed
  **Adapt / 160 food / +25% vitality**, a truthful accessible description, and one
  160-food purchase starting 20-second research.

Findings 2 and 3 came from **reviewers through BlaBla assignments**, using source,
native pixels and focused handler/engine reproductions. They were defects in the
new candidate, not findings against shipped V6. One corrective implementation pass
addressed both; a second reviewer pass independently verified them and found no
new correction blocker. The original actual-browser finding 1 remains open.

The complete declared check, `sh -c 'npm test && npm run check'`, recorded exit 0
before review (85 tests) and after correction (87 tests). Recorded wall times were
14.0453s and 16.2596s: **check durations only**, not development time. The new
adjacent regressions independently passed with this RTS-root reproduction route:

```sh
node --test --test-name-pattern='rejected limit card|Lab research cards' tests/ui-contract.test.mjs
```

The corrected candidate patch SHA-256 is
`686c026a7bf3c070bf0392d199419fe0d6749da0674f7021a11161c3e2689ff4`;
its `dist/game.js` SHA-256 is
`333ede2cdee92d54c09fc7994f5452345279036f4d11ac0590f73cddc313df3e`.
These identify reviewed bytes, not a published revision.

## What the engine contract established

The later `adapters/placement.mjs` imports the actual `World`; measured builds call
`World.apply`, and preview/site selection calls `World.placement`. It does not copy
the placement rules or fabricate buildings. Its five actions are `build`,
`preview`, `fund`, `resetColony` and `atCapacity`. AI is disabled, time does not
advance, and the explicit funding fixture grants 999 food.

The bounded explicit campaign returned exit 0: **53/53 derived obligations,
25/25 rules, all five actions exercised, 256 main actions**. From the RTS root,
with BlaBla built from the foundation above, the portable reproduction is:

```sh
blabla --project . run --seed 731 --cases 4 --steps 64 \
  --timeout-ms 1000 --startup-ms 5000 --shrink-budget 32 \
  -- node adapters/placement.mjs
```

`contracts/placement.bla` checks literal accepted-build costs of **100/80/120/90**
food for hatchery/siphon/lab/spine, one fresh matching building, preserved existing
IDs/types/positions, unchanged rival food/buildings, and no food or building-record
change on rejection. It checks unknown-type and out-of-basin `(0,0)` rejection,
nonmutating preview, nonnegative food, unique IDs, total limit **8** and type
limits **3/5/1/3**. Successful cost branches had actual witnesses. The capacity
fixture pays for seven real builds after reset and reaches eight owned structures
with **329 food**.

The fixture reaches total, hatchery, lab and spine cap states. It never reaches
five siphons; `siphons <= 5` is not evidence of rejection at that boundary.
Candidate sites are finitely sampled, and `placement` and `apply` share legality
logic, so their agreement cannot independently prove all geometry. No claim covers
all coordinates, team-1 commands, construction completion, income, combat or a
full match. This engine-command boundary does not observe pointer dispatch or
visual acceptance.

The author ran the same bounded campaign twice: an initial pass, then a pass after
making the pre-call candidate observation include its fixed fallback. That was an
adapter correction, not a newly found gameplay bug. Independent contract review
and canonical `finish` remain pending at this report's cutoff; the explicit run
is not project completion.

## Workflow benefit and friction

The initial memory-only setup exposed an unresolved `contract::placement` and no
active executable coverage. Invalid comment syntax was also caught during setup.
These were deterministic tooling results. Scope and outstanding acceptance were
recorded before implementation, instead of reconstructing a success story from
passing tests.

Freshness enforcement had observable cost and value: changing the review target
invalidated its earlier binding, and evidence execution was refused until the
reviewer reaccepted. Corrected source needed fresh check evidence. Changed check
declarations and concurrent-change attribution also required explicit orchestration
confirmation. Those records explain ownership; they do not detect game semantics.

The proposed contract check initially used `--falsify`. BlaBla correctly refused it
with exit 2 because that command falsifies structure contracts and this project
declared behavior only. The check was explicitly corrected to plain compilation;
the separate bounded adapter run supplied execution evidence. No token structure
contract was added to obtain a pass.

Codebase Memory and Serena assisted navigation; byte comparisons established when
their snapshots matched the changed source. Their timings do not establish causal
speedup. No comparable baseline development duration, historical fix-round count
or controlled rework comparison was collected.

## Remaining acceptance and conclusion

The candidate still needs exact-revision browser tap/drag, invalid-to-recovery and
continued-play journeys, rich-state compact layout measurements, and physical
touch/first-minute comprehension evidence. Native Canvas/static-CSS diagnostics
are not browser screenshots. Matching art and direct commit are implemented;
their player-facing clarity and remaining mobile QoL are not yet accepted.

R-06/A-05 still requires a separately approved event design with warning, actual
spatial consequence, counterplay and recovery. Water response and the stationary
mite do not satisfy it. Existing engine, navigation, organism assets and economy
were retained by the UI patch.

This exercise established a traceable implementation/review/correction loop and
bounded real-engine verification. It did not establish that BlaBla automatically
understands player intent, reduces total development time, or makes a passing
engine campaign sufficient to ship the game.
