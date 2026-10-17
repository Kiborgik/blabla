# Town production overview

Author: gpt-6-astra. Prospective task: `expose-town-production-overview`.

## Current boundary

The projection, native-button renderer and three-file UI integration are implemented on authentic restored source at `38ff916050bcbdfb6f1b3075b6307e1dae622792`. Before editing, the three integration files byte-matched that source. After scoped handoff, twelve focused tests and web typechecking passed with terminal exit zero. Publication and after-update pixel checks remain pending; this report does not claim public deployment or visual acceptance.

The projection includes only completed canonical buildings with operating inputs. It uses `operationVisual` for current state, past result, paid inputs, resident allocation and blockage reasons. The compact result contains actual positive recorded output, never catalogue production. A current pause leaves a prior operated receipt intact. Missing results, historical pauses and blocked results remain distinct. Active construction does not become completed production.

## Accepted visible increment

The default selected-town Overview now prepends compact Town production rows using the original building icons. Each row shows its current On/Paused state separately from the last recorded result and round, plus exact recorded inputs and allocated residents when available. Installed ordering is reversed without mutation; the first three rows appear directly and remaining rows share a native More town production disclosure. Creative explicitly accepted this bounded adjustment after the actual towns showed many older paid buildings. No invented installation dates or newness labels are added. Existing construction previews remain separate and no world-changing controls are added.

The minimal integration is a final optional callback on `renderSettlementInspection`: the production row selects the existing work picker, calls the existing Work-section navigation and focuses that picker. Other callers remain compatible. The native disclosure uses the existing retained-disclosure mechanism, and row focus uses the existing inspection-focus mechanism. CSS uses established theme variables, wrapping content and native keyboard focus outlines.

## Verification

Test-first projection checks cover the completed-building filter, current pause versus recorded output, no-result and unknown state, blocked support/supplies, historical pause versus current enabled choice, zero actual output, and detached receipt data. The initial implementation skeleton failed the six applicable behavior assertions; the detached-data test was then strengthened to require an actual row before checking it.

The final declared check passed: `node --test tests/town-production.test.ts && npm run typecheck:web`, with twelve tests and terminal exit zero. Native-button callback tests open the exact requested building ID, including rows inside the More disclosure. The direct settlement integration test confirms exact Work selection before revealing it, picker focus, matching historical output and repeated activation. The compact-input addition first failed its two new render assertions, then passed after implementation. These are DOM-shape and callback tests, not a physical keyboard or browser navigation claim. Synthetic test values are explicitly fixture data and do not establish live output.

A separate read-only public `/api/world` response at revision 2101 parsed successfully with the restored source. Its Dawnwell Foundry row projects 18 Materials from the actual season 1649 receipt; Willowmere and Tidehaven Observatory rows each project 15.75 Science. Canonical receipts retain two Energy plus one Iron for the Foundry, two Credits for each Observatory, and three allocated residents. This source check is distinct from test fixtures and later public pixel verification.

The supported cloud browser inspected the real public live.28 baseline. Its Aster Town Overview has no production strip. The desktop before image is retained in task scratch as `before-desktop.png`; it shows the actual 2D fallback, not WebGL verification. A separate cloud browser cannot reach the loopback development server. Native Chromium is blocked by local socket restrictions, and escalation failed environment setup without accessing the protected path. No local after screenshot or 390px pixel result is claimed. Public post-deployment pixel and interaction checks remain pending.

## Outcome limits

Legible civilization decisions and spectator comfort remain Partial until the integrated interaction and pixels are verified. This small Overview change does not satisfy the larger inhabited-world transformation goal. Release metadata, full integration verification, publication and deployment remain with the orchestrator.
