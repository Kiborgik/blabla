# Bounded deployment update policy

2026-10-16. Art Director: actual gpt-6-astra, xhigh. Scope: the DOM-free policy/helper, focused tests and this report. Main, current updater wiring, manifests and the public site are unchanged.

## Finding and boundary

The preserved public tab still displayed live.9 after the live.10 deployment; one manual reload then displayed live.10. The manifest advertised the new build. This is a real missed automatic-update observation, but its cause remains unknown. The read-only browser evaluation did not expose sessionStorage, so that evaluation's TypeError is not evidence that the application itself lacked storage. The returned browser log window contained WebGL-disabled errors, not an observed updater network failure.

Source inspection establishes two independent failure paths. Main writes sessionStorage before calling reload inside one broad try/catch; a throwing write prevents navigation and hides the error. The existing shouldReload rejects a build ID forever once that session list contains it, even if the first reload returned the old bundle. The legacy-policy assertion in the new suite demonstrates the latter decision directly. The new helper tests use genuinely throwing read/write callbacks; they do not claim either failure occurred in the public tab.

## Primary research before implementation

- [WHATWG Web Storage](https://html.spec.whatwg.org/multipage/webstorage.html) is the primary API specification. Storage access and persistence are subject to browser policy and finite capacity; availability is not an invariant.
- [MDN sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage) documents per-tab persistence through reload and SecurityError under policy restrictions. Application: session storage is useful but cannot be the only retry guard.
- [MDN Storage.setItem](https://developer.mozilla.org/en-US/docs/Web/API/Storage/setItem) documents QuotaExceededError. Application: failed attempt bookkeeping must return an observable failure result without swallowing an otherwise valid update plan.
- [MDN Location.reload](https://developer.mozilla.org/en-US/docs/Web/API/Location/reload) identifies forceGet as Firefox-only. Application: do not assume Chromium implements reload(true) as a cache bypass. A changed same-origin URL can distinguish bounded attempts; it is not a guarantee about every intermediary cache.

The current main updater and viewer-state release/preference parsers were also read. Parent approved a two-attempt source/target policy, cooldown and visible exhaustion before behavior implementation.

## Helper contract

planDeploymentUpdate is pure. It accepts the bundled release, unknown remote manifest, current absolute URL, current time, current preferences and optional parsed stored attempt. It returns current, invalid, stale-manifest, cooldown, exhausted or reload, with the exact navigation/cleanup URL when appropriate. It neither fetches nor navigates.

A validated different build must have a strictly later publication time than the bundled build. Build IDs are bounded to 256 characters. Only HTTP(S) current URLs are accepted. The generated URL preserves origin, path, unrelated query values and fragment; only the reserved civitas_update parameter changes. That parameter contains schema, source/target build IDs, count, attempt time and target publication time. It contains no settings, world state or private information.

The first automatic attempt consumes count one. A stale old bundle can make one second attempt after 30 seconds; afterward the helper returns exhausted with no navigation URL. Valid URL and storage records are combined conservatively. A legacy matching attempted-ID list counts as one previous attempt rather than permanent suppression. A strictly newer target gets a fresh allowance. A lower or equal-time different target cannot oscillate the policy back to a consumed deployment. A temporarily old manifest does not erase the guard for an unseen target. Successful arrival at the target supplies a URL with only the retry marker removed.

Malformed, oversized, duplicate-parameter or wrong-source markers cannot provide an arbitrary destination or borrow another source's attempt budget. A backward wall clock retains the used count; its obsolete future attempt time loses the cooldown, allowing at most the remaining retry instead of resetting the budget. These limits assume the caller retains the generated marker across navigation. They are not a promise against a server redirect that strips the marker while storage is also unavailable, user deletion, or arbitrary external mutation.

prepareDeploymentUpdate is a small injected-I/O adapter around the pure policy. It catches actual read/getter and write failures separately and reports stored/empty/malformed/failed read status and saved/skipped/failed write status. Pass closures that access the browser storage inside the callback, so a throwing storage getter is caught there. It writes only the attempt JSON supplied to its port. It has no direct browser API, key choice, network or reload side effect. Failure to write that record does not erase the URL-based plan.

## Compatible preferences and integration handoff

The policy reuses parsePreferences, preserving compatible camera, selected city, layer, theme and effects values while dropping unknown/world fields. A cloned, build-bound carry value is returned separately for a future history.state or supported storage handoff. restoreDeploymentPreferences accepts that compatible carry only for its source or target build; otherwise it uses the existing stored preference parser. No carry value is put into the URL.

This proves serialization/validation behavior, not persistence after a browser reload. The later integration should save current preferences through existing storage where available and may preserve the carry under a namespaced history entry without replacing unrelated history state. If all persistence access fails, do not promise settings will survive. A UI can disclose the limitation or offer a manual update; this helper does not manufacture durable storage.

The caller must also consume the decision once in memory before navigation, prevent concurrent update checks, retain the marker in the real navigated URL, and show a readable exhausted/manual-retry state rather than a permanent “Updating…” notice. Only a newly loaded bundle confirms success. Marker cleanup on current is a history URL replacement, not another reload. Network failures, browser-navigation failures, actual stale HTML and the eventual footer/build transition require integration/browser evidence. Main wiring needs a separately assigned task.

## Verification and next outcome

Twelve prospective tests all failed against the empty behavior scaffold. A later backward-clock regression failed on the initial implementation and caught an attempt-budget reset; the policy was corrected. Fourteen final tests cover throwing storage, malformed JSON, first/newer targets, stale-bundle retry/cooldown/exhaustion, legacy migration, malformed and conflicting markers, target oscillation, old manifests, clock rollback, input immutability and compatible preference carry. Scoped strict lint and web typecheck pass. Initial/follow-up RED, final focused output, lint and type logs are retained in task scratch.

No browser reload, public setting, manifest, live capability or current renderer was changed by this task. The next useful outcome is bounded main integration followed by an actual old/new local bundle transition and the next genuine deployed update, with the footer/build identity and preserved compatible preferences checked. Existing camera and cue evidence should not be repeated wholesale.
