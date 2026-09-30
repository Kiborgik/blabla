# How BlaBla changed the RTS development loop

Independent reviews organized through BlaBla found **three bug families across
four affected paths** in [Microcosmos RTS](https://microcosmos-fibre-wars.kibgames.chatgpt.site/).
They changed the implementation and its permanent checks. The useful result was
making unresolved problems harder to overlook between implementation and acceptance.

## What the reviews found

1. **A refused building could buy the previous choice.** Dragging an unavailable
   Spine retained an armed Siphon preview and spent 80 food. Explicit arming success
   and cleared stale ownership fixed it. The unchanged reproduction moved from
   **730 → 650** food to **730 → 730**, with no extra building.
2. **Adapt described the wrong action.** A purchasable Lab action announced a
   building-limit error, while its visible percentage omitted vitality. Separating
   research from construction-limit metadata restored truthful action, cost,
   consequence and state descriptions. Re-review checked the original failure
   and neighboring Lab states.
3. **Inherited catalog names corrupted the engine.** `constructor`, `__proto__`
   and `toString` passed object lookups in **both build and produce**, making food
   `NaN` and creating malformed structures or queues. Primitive-string and
   own-property guards now reject them without changing world state. The unchanged
   reviewer probe failed before correction and passed afterward.

An earlier right-click cancellation fix came from ordinary self-review, separately.
Reviewers found these defects through counterexamples, not BlaBla's automatic
semantic analysis.

## How the workflow changed the outcome

Explicit player-acceptance criteria turned recognizable actions, intentional
placement and accidental-spend safety into review obligations. Scoped assignments
kept the missing environmental event visible as unfinished work. Existing passing
tests could not answer those acceptance questions by themselves.

Independent review found the first two defects; one correction pass and re-review
settled them. Engine review exposed a stronger lesson: the first bounded campaign
was GREEN, yet inherited-name inputs still broke the real application. Failed
RED evidence stayed in the record, approval was withheld, and the engine fix
received its own assignment instead of filtering bad inputs out of the adapter.

The real-engine contract then retained **three named invalid-key witnesses**,
exercised below capacity without relying on out-of-basin rejection. Unchanged
reproductions verified the fixes. Refreshed review bindings and current-input
receipts prevented earlier success from standing in for approval of changed work.
BlaBla organized this correction loop; it did not discover the defects automatically.

The used path reached scoped assignment → implementation → independent review →
correction → real-browser checks and real-engine canonical `finish` GREEN, using
stable foundation `480fb4c`; runtime expert advice/nudging was not used.
Browser inspection also exposed truncated help text, prompting a shorter hint.
Physical touch, uncoached comprehension and the environmental event remain open.

## What changed for BlaBla and the next feature

The concrete improvements so far are **workflow changes**, not a demonstrated
BlaBla product-code repair: acceptance criteria before implementation, explicit
check inputs, retained failing examples, stronger contract witnesses and fresh
review after corrections. The initial memory-only setup lacked executable coverage;
`--falsify` also correctly refused a behavior-only project, requiring separate
compilation and execution routes. Check changes and ownership confirmation added
bookkeeping, but clarified which result covered which work.

Save-flow and living-art work are prospective follow-ons through this fuller
workflow. They inherit that starting discipline; their development outcomes are
not yet evidence of improvement. No speed or rework reduction was measured.

Bootstrap also exposed a guidance gap: plain `check` compiles contracts, while
invalid registered architectural memory intentionally does not block completion.
The separate `check <memoryfile>` already rejects invalid memory. A follow-on
improvement candidate is to make that validation step harder to miss during setup;
no product change has been implemented. Preplanned native-host work is not an
RTS-driven improvement. Next-feature outcomes remain the next proof of benefit.

Evidence anchors in the RTS repository: `docs/acceptance-workflow.md`,
`docs/direct-placement-evidence.md`, `docs/placement-contract.md`, and the UI,
building and engine regression files. Browser evidence covers V7 `f8f0a84`.
V8 source `b5b2ce98c1042aeff209564743e5846f0aa928c1` was published at 23:18:27 UTC
on 2026-09-30; its final shortened hint has not yet been browser-rechecked.
