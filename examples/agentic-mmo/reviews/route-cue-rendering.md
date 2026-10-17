# Committed route cue rendering

2026-10-16. Art Director: actual gpt-6-astra, xhigh.

## Result

One shared observation stream now supplies ordinary map changes and committed route results to both SVG and Three adapters. The frozen route projector is reused without changes. New results can show one stationary receipt card and two original endpoint symbols, tied to the exact recorded towns. A delivery never becomes a token travelling along a schematic link. A repair never creates a shipment.

The global allowance remains one result below 700 CSS pixels and at most three on larger maps, including ordinary effects already on screen. Route cards use the existing collision-aware 180×44 placement helper and yield to panel, control and city-label rectangles. Symbols use civilization accents plus distinct cargo/repair shapes. The effect has no input handlers and cannot take focus. Timers, marks and cards are removed on expiry, explicit clearing or renderer disposal. A narrow resize also reduces the active pool.

Rich and Cinematic add only a brief opacity entrance to a route card. Its endpoint symbols stay stationary. Calm and device reduced motion retain the same information without animation. Existing settings, camera behavior and route controls are reused; no extra assets, world commands, manifests or deployment changes belong to this task.

## Research and meaning

Before implementation, read the current projector, event tracker, polling/history lifecycle, renderer adapters and appearance policy. Reuse the verified primary research in [route-result-direction.md](route-result-direction.md) and [route-visual-direction.md](route-visual-direction.md): Three shared geometry/materials and LineMaterial, MDN SVG semantics, W3C non-color communication and target-size guidance. The existing original cargo and repair icons avoid a new asset vocabulary.

The [MDN reduced-motion reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) and [W3C animation guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) were inspected for the preceding projection task and remain directly applicable. Here they inform the static Calm result, absence of camera movement, and no replay on interaction. These design choices and source tests do not establish complete accessibility conformance.

The compact story identifies a recorded delivery or joint repair, its exact towns when safely bound, round and actual quantity. Recent events expands the observed result into separate cargo sent, transport paid and commerce received rows. Paid repair contributions and the clamped recorded damage reduction retain their actual participant identity. Cached current damage is labelled “Damage when observed,” so subsequent polling cannot misrepresent that cached value as today's condition. Current route condition remains in the existing route card.

When binding is missing, history keeps the recorded cargo aggregate and says the exact endpoint position is unavailable. It does not invent per-resource facts. The bounded cache holds the latest three observed route results; older history continues to display canonical event cause/effects. Loading an existing history never manufactures a new receipt accent. No added fetch or command boundary is introduced.

## Freshness and lifecycle

The stream keeps the frozen projector's run identity/revision cursor outside renderer instances. Its ordinary-event tracker excludes trade events, replacing the old generic capital/tile delivery fallback. Both classes share the same finite map allowance. Same or older revisions cannot rewind the ordinary tracker. Changed runs reset both classes quietly.

Initial reads, hidden-page reads and open Recent events views are quiet. Opening history, leaving the page or entering Sample clears active effects and marks the stream for a quiet live baseline. The first resumed live observation cannot play a backlog. Selecting a route or town does not recreate this cursor or replay a result. A later genuinely new observation remains eligible. Public repair results remain the compact story through subsequent clock events, while a later meaningful gameplay event can replace them.

## Verification

Tests were written against an empty behavior scaffold first: seven of eight failed on observable behavior. A subsequent unbound-history assertion exposed that the prose promised an aggregate without including its number; that test failed and the presentation was corrected. Final focused evidence runs the twenty frozen projector tests plus ten new rendering/stream tests: 30 pass. The separate existing web regression suite has 31 passing tests. Web TypeScript checking and scoped strict lint pass; only the existing npm environment warning was printed.

The new tests cover initial/repeated/older/run-change observations, history and hidden baselines, shared narrow/desktop limits, exact frontier endpoint marks, no generic delivery fallback, separate cargo/upkeep/commerce, recorded versus observed damage, unbound aggregate preservation, meaningful-event selection, stationary coordinates, duplicate suppression, expiry, clearing and disposal. A small recording DOM harness observes actual shared-layer DOM operations with controlled timers. It does not emulate layout or establish browser pixels, keyboard behavior, screen-reader output or runtime WebGL.

Retained logs live in the task scratch directory: `rendering-red.log`, `history-red.log`, `typecheck.log`, `lint.log`, `web-regression.log`, and the machine-recorded declared-check log. The report deliberately reuses accepted camera, settings and route-inspection evidence instead of re-running their entire audits.

## Pixel boundary and next bounded check

The preserved public cloud tab was inspected at 1188×761 CSS pixels. Before manual reload it still showed live.9; after one reload it showed live.10 with five cities, the selected Tidehaven inspection, readable story/resources and no routes. The manifest showed build `2026-10-16-readable-routes-10`. Images are `live10-public-1188x761.png` (before reload, despite the filename) and `live10-public-after-reload-1188x761.png` in the shared scratch workspace. This proves the current no-route baseline only. It does not prove automatic updating or new cue rendering.

New route-result browser pixels remain pending. The useful successor is an explicitly local synthetic before/after observation fixture, at supported short-desktop and narrow widths, checking paired symbols, card collisions, readable full facts, Calm and reduced-motion behavior, clearing on history, and no replay on return. A genuine live cue requires a future actual committed receipt. The public foundations world is unchanged; neither live trade nor live joint repair is claimed. Cloud WebGL remains disabled and hardware touch/360px phone rendering are unverified.
