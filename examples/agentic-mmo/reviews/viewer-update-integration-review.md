# Viewer update integration: independent review

Reviewed 2026-10-16 15:32 UTC by gpt-6-astra against the frozen live.11 manifest. Scope is the accepted pure update policy, new controller/main wiring, focused tests and attributed local browser evidence. Previously accepted camera, settings and route-source evidence is preserved.

## Verdict

No blocking source or bounded local-pixel finding. Automatic update decisions are bounded, preferences have two local carry paths, and failures provide a readable manual action. The controlled local old/stale/new sequence supports the intended integration. It does not diagnose the earlier missed public update or certify production caching. Staging and publication remain integration-owned; the next useful observation is the preserved public tab's actual transition.

## Policy and browser wiring

Main reads the same public version manifest with no-store and a finite abort timeout. The controller admits one fetch at a time and marks its navigation decision consumed before attempting browser navigation. A throwing or non-unloading navigation cannot become a polling reload loop. One cooled stale-HTML retry is allowed for the same source/target pair; exhausted automatic attempts expose Update view. A newer target has a separate budget, while older or ambiguous manifests cannot oscillate the budget. Invalid manifests leave the world view open with a retry action.

The URL marker contains only bounded build/attempt metadata, retaining origin, path, unrelated query parameters and hash. Preferences and simulation state are not put in that URL. Session-storage failure is caught independently of the update decision; the URL marker can retain the budget when storage fails. Successful target startup removes only that marker without another navigation. This is a cache-distinct URL, not a guarantee that every intermediary serves fresh content.

The controller captures current sanitized preferences at the actual update action, including the saved original camera from the existing inspection session. It tries preference storage and separately wraps the entire previous history value in a tagged carry envelope. Startup reads the compatible source/target-bound carry before restoring that original history value. Primitive, array, undefined and object history values are covered; the code does not replace unknown history with null. Closing an ordinary dialog preserves its current history value.

If history fails but preference storage succeeds, same-origin location replacement still carries the retry marker. If neither can preserve settings, automatic navigation pauses and the explicit button warns that settings may reset. Manual action reads the latest camera rather than the earlier polling snapshot. A failed navigation remains manual. Preferences are observational only; no world command, agent authority or release application is added.

Pagehide disposes the controller, and a pending response checks disposal before navigation or notice. Persisted pageshow mounts a fresh controller. Current intervals refer to the current controller rather than accumulating another updater per restore. BFCache behavior is source/controller evidence here, not a newly claimed browser interaction.

The notice uses plain text, a status region and a keyboard-operable button with 44-pixel minimum height. Its panel class participates in existing cue-card collision exclusions. Actual all-storage-failed, exhaustion and BFCache browser cases were not captured; those limits are stated rather than inferred from desktop screenshots.

## Controlled browser evidence

Art reports an actual dot-cloud Chromium sequence using separately built local old/new bundles, throwing localStorage and sessionStorage getters, a temporary local manifest and one deliberately stale HTML response. Its reported HTML counters progress from 3/0 to 4/0 to 4/1, with no manual reload during that controlled sequence. Dark/Calm, selected Far Hearth, exact SVG viewBox and an arbitrary harmless history object survive; the final bundle removes the marker and retains the unrelated scenario query.

I independently viewed update-local-old-selected.jpg, update-local-stale-first.jpg and update-local-new-preserved.jpg in the shared scratch directory. They show the same selected frontier town and map framing, a readable cooldown notice on the stale page and the new local build after that notice clears. The yellow synthetic fixture label remains visible. The automatic sequence, storage exceptions, exact viewBox and history measurements are Art's interaction evidence, not assertions derived from stills or interactions repeated by this reviewer. No public state was injected or changed.

## Route-result pixel continuation

I also independently viewed the six already supplied route-cue fixture images: desktop delivery and its facts, desktop repair and its facts, and both 504-pixel narrow states. The desktop card is readable and clear of nearby town labels. Exact Far Hearth/Tidehaven marks are stationary. Delivery history separates each direction's cargo, Energy upkeep and Credits; repair history shows 12% to 0%, the actual distinct fixture payments and no new shipment claim.

At 504 by 761 CSS pixels with inspection open, the selected-town mark remains above the sheet and the receipt card is deliberately hidden because no clear placement fits. With the sheet closed, one readable 180 by 44 card and both town marks are visible. Art's measured Calm animation-none, Enter/Escape, real effect cleanup, frozen open history and quiet return are attributed runtime checks. The stills alone establish appearance, not temporal behavior.

These are validated successive synthetic snapshots and SVG rendering. Their non-current repair payment values exercise faithful receipt display, not new gameplay tuning. They do not demonstrate actual live trade, runtime WebGL, physical touch or 360/390/430-pixel layouts. The visible test harness covers part of the footer/dock and is not shipped UI; no new acceptance of that covered area is inferred. No prior camera/settings audit was repeated.

## Evidence and release boundary

Read main startup, preference capture, history close, update mount and lifecycle integration; the policy and controller; all 14 policy and 11 controller tests; update CSS; live.11 manifest and first changelog entry. Read the full final author log `.blabla/scratch/integrate-bounded-viewer-updates/evidence-2-5-1792164615742111608.log`: 66 tests pass, comprising these 25, 31 existing web tests and 10 cue-rendering tests. Read scoped lint and web typecheck logs, with only the existing npm environment warning. Read the prospective controller run: nine actual assertion failures and two negative controls, rather than an import failure.

This review's declared check runs only the 25 policy/controller cases. Its exact result is recorded separately. Local port tests exercise real throwing storage/history/navigation callbacks but cannot replace production browser or CDN evidence. The reviewed live.11 changelog accurately separates viewer improvements and prepared rules from the current world's enabled capabilities. Its source timestamp is not a claim that publication has completed.

After independent source acceptance, preserve the existing public tab through the authorized deployment and observe its actual build, timestamp and preferences. Do not attribute a successful local transition to the cause of the earlier public failure. Capability activation, source publication permissions and live Director decisions remain separate operations.
