# Spectator preferences: bounded independent review

Reviewed 2026-10-16 at 11:27 UTC by gpt-6-astra. Target: `tune-spectator-preferences`, frozen after its fourth exact scaffold check. This review covers the preference increment; earlier camera acceptance remains valid.

## Result

No blocking source defect found. Light, dark and system themes, three effect levels, resource explanations and gross-production wording have coherent implementations. Source acceptance does not establish new deployed pixels, physical touch behavior or WebGL performance.

## Source findings

- `viewer-state.ts` preserves the existing version-1 camera, selection and layer fields. Missing appearance fields receive compatible defaults, including Calm for an older paused preference. Unknown theme/effect values are not applied as arbitrary styles.
- `viewer-settings.ts` applies one palette, resolves the system theme, listens for device preference changes and lets reduced motion override every selected effects level. Both renderers receive the same effective motion policy after creation. Settings save locally and do not submit world actions or alter simulation cadence.
- Native labeled selects, a reachable Settings button, modal close/Escape handling, and resource buttons provide keyboard and tap paths. Resource tiles have at least 44-pixel source targets. Resource help retains a focus-return target; ordinary inspection refresh preserves resource-button focus when the same civilization remains selected.
- Shared palette tests cover text, control boundaries, positive/negative chips and cue colors. The final two-color focus rule is applied after earlier component styles. These arithmetic/source checks are narrower than a full accessibility audit of rendered content.
- Calm keeps recorded information available while suppressing event animation; Cinematic adds only a bounded local event highlight. Existing cue deduplication, duration limits and initial-history suppression remain in place. No new production or agent activity is invented by an effects setting.
- Production is a distinct visual quantity: `13.28 Food made`, without a stock-gain plus sign, and the story is labeled `Produced · Before costs`. Stored reserves, actual gains/losses and base seasonal capacity remain distinguishable. Resource explanations use the shared vocabulary and short English text.
- The desktop camera buttons now share a horizontal row. The mobile camera-session mathematics and selected-city framing were not rewritten by this increment. Actual overlap removal still requires the new deployed desktop view.

## Evidence read

Read the full target log `.blabla/scratch/tune-spectator-preferences/evidence-4-2-1792149832363865244.log`: web TypeScript, scoped lint, 25 web tests and the production build each exited zero. The JavaScript size warning remains visible; it is not a measured frame-rate claim. Reviewed the appearance, resource, production-format and semantic visual assertions directly. This review also runs its own declared bounded web/visual test command through BlaBla; its result is recorded in the task ledger rather than inferred from the target's status.

## Preserved evidence and remaining observation

Earlier accepted live.3/live.5 narrow camera and settlement-part evidence is not rerun or reattributed to this reviewer. No new browser interaction is claimed here. After live.6 publication, inspect the actual desktop and supported narrow rendered view with light/dark themes, Settings open, a resource guide open, and keyboard focus. Check preference persistence after reload and device-motion handling where the browser supports it. WebGL, physical-device touch and 360/390/430-pixel rendered views remain unverified; pure geometry and no-overflow checks do not substitute for them.

The next visual story can consume irrigation/kiln operating receipts once separately assigned and delivered. That future work is not part of this settings acceptance.
