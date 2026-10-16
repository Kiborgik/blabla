# Read-only spectator checks

Research by `gpt-6-astra` (high), 2026-10-16. No UI, contract, server or goal
changes. The declared spectator policy suite is regression evidence only.

## Current gap

Exact `explain spectator::no-world-command-controls` returns `E_UNKNOWN_RULE`.
`goal::watchable-spectator` still requires that identity and says camera, playback
and inspection are the only human controls. Keep this unresolved until an honest
binding exists; neither a renamed import rule nor an always-true adapter field
would establish that meaning.

`contracts/spectator-preview.bla` checks explicit symbols and direct dependencies,
including no `node:fs` or `node:child_process` import from `web/main.ts`.
`contracts/architecture.bla` checks live projection reuses canonical validation.
These are useful boundaries, but inline HTTP mutation needs none of those imports.
`tests/contract-spectator.test.ts` executes real reload/cue policy helpers through
isolated probes, not the browser's network calls or rendered control handlers.
The newly named positive deployment fixture improves policy witness reachability;
it does not execute an actual page reload or request.

Current `web/main.ts` has two fetch sites: `/api/world` in `readWorld()` and
`new URL('version.json', document.baseURI)` in `checkDeployment()`. Both currently
use default GET, no body, no-store cache and an 8-second abort timeout. Polling,
visibility restoration and switching back to live mode invoke these reads.
Reviewed handlers affect camera, layers, preferences, dialogs and inspection.
Art's concurrent route work retains these requests: route selection, pagination,
Close and Show town change presentation/camera through callbacks. Source review
found no world-mutation request here; that observation is not an executable
guarantee for every handler or future source revision.

## Smallest useful next implementation

After Art releases `web/main.ts`, extract only the two existing fetch expressions
into `web/read-only-transport.ts`. Export fixed-purpose `readWorldResponse()` and
`readDeploymentResponse(baseURI)` helpers, with an injectable fetch implementation
for tests. Call them from the existing read functions. Preserve parsing, error
handling, mode changes, polling, timeout and reload policy at their current seams.
Use explicit GET and no body. Do not introduce a generic URL/options request API
or a second simulation/probe model.

Add `tests/readonly-transport.test.ts` with a recording fetch that actually receives
each helper's request. Assert exact destination, method, absent body, no-store,
abort signal and response/rejection propagation. Test deployment URL resolution
at root and nested base paths and repeated calls. A fake returns a response but
does not manufacture the expected request; assertions inspect what production
code supplied. No new browser dependency is needed for this bounded seam.

Prospective RED: imports fail before extraction. More importantly, temporary
counterexamples changing GET to POST, `/api/world` to `/api/action`, or adding a
command body must each fail the request assertions. Restore source and read the
deciding GREEN log. These tests prove the requests emitted by these helpers,
not the absence of bypass calls elsewhere.

Owner may add narrowly named structural rules requiring `viewer -> transport`
and forbidding direct imports from named engine/host/store modules at this seam.
Use the existing provider's actual reported dependency granularity; do not call
a direct-edge forbid a transitive security boundary. A regex scan for `fetch` or
`POST` can assist review but cannot prove absence of aliases, dynamic requests,
forms, beacons, sockets, worker paths or world-changing callbacks. No new
behavioral adapter rule is needed merely to register these focused unit checks.
Keep `spectator::no-world-command-controls` unresolved after this increment.

Proposed implementation scope: the new helper and test, plus the two call sites
in `web/main.ts`; owner authors any prospective structure contract separately.
Exact new test plus scoped strict lint and existing web typecheck/regression are
appropriate. Preserve Art's route changes and coordinate ownership before edits.

## Evidence needed for the broader control claim

A separate bounded real-browser check should execute the actual mounted UI with
local committed-world fixtures and a request interceptor. Capture method, URL and
body before dispatch; block unexpected mutation requests so counterexamples never
reach a live world. Assert world reads and version reads match the allowed routes;
classify static assets/navigation separately. A refused POST is still a failing
UI attempt, even when server authentication prevents state change.

Exercise an explicit control matrix: initial/live/sample/offline/uninitialized
states; zoom, pan, reset and layers; city/route selection, route paging, Show town
and Close; settings and resource/help/event dialogs; Escape/back/hash navigation;
poll and visibility callbacks. Inventory the mounted controls and fail on an
unclassified addition. Use deterministic local responses and bounded timer steps.
Include desktop and narrow layouts because their inspection paths differ.

Adversarial witness: temporarily add `fetch('/api/action', {method: 'POST', ...})`
to an exercised route button. The trace must fail even though the two read-helper
tests still pass. An unexercised control, a new transport channel or purely local
mutation remains outside that trace's proof. Pair it with semantic source review
of the exercised handlers and unchanged canonical fixture data; do not claim a
finite matrix proves every possible UI path. Owner decides whether this bounded
coverage justifies a precise future contract and the broader goal outcome.

`server/worker.ts`, hosting tests and `scripts/verify-hosted.ts` already cover the
separate authorization boundary. Reuse that evidence; do not duplicate server
auth or infer spectator-only UI from a 401 response. This research performed no
browser run, hosted mutation, activation or broad audit. Route work can continue;
later source drift should be identified rather than silently extending this review.
