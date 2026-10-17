# Town production public QA

## Scope and status

Report-only Art Director review of the public Town production Overview increment and its existing Work-record navigation. Reviewed source packet: `10bfce31f07555726a8485398ad063fab1513a92`. The orchestrator reported successful Sites v33 publication at 2026-10-17 19:52:45 UTC from source `748aae401d751a13088d0d35c0c4656ff2d6e50e`. The supported cloud browser independently displayed public version `0.1.0-live.29`, its new production rows, and the matching changelog. Bounded desktop checks pass with the residuals below. This report does not grant deployment or claim mobile acceptance.

## Browser and baseline

- Supported cloud Chrome browser through the documented CUA `cdp` entrypoint, public site `https://agentic-civilizations.kibgames.chatgpt.site/`.
- The public before-image was captured with Dawnwell / Aster selected, version `0.1.0-live.28`, revision 2110, using the existing 2D fallback. It is retained at `.blabla/scratch/expose-town-production-overview/before-desktop.png`.
- A fresh pre-publication observation at 2026-10-17 19:41 UTC showed version `0.1.0-live.28`, revision 2122. Town Overview still had no Town production strip.
- Browser capabilities are empty. Tab capabilities are bot detection, browser authentication, and WebMCP; none provides viewport resizing. The supported browser cannot establish a 390px viewport in this session. No alternate browser-control route is used.
- The browser cannot reach the execution workspace's loopback development server. Earlier local Chromium startup was blocked by environment restrictions. Therefore this is an explicitly public, post-deployment visual review rather than local visual acceptance.

## Post-publication checks

- Actual public observations were made from 19:53 to 19:56 UTC in a 1180 by 757 screenshot viewport. Reload initially showed the connection state, then the connected world. No synthetic fixtures were injected.
- At revision 2147, Dawnwell / Aster's default Town panel visibly showed the Foundry before the land and support disclosures. The first-screen row read `Made 18 Materials`, `Used 2 Energy · 1 Iron · Assigned 3 residents`, `Last recorded season · 1688`, and the separate current setting `On now`. The map remained visible beside the panel. Screenshot: `.blabla/scratch/review-town-production-public-qa/after-desktop.png` (108,258 bytes).
- Clicking that Foundry row switched to Work, selected `foundry`, displayed the corresponding 18 Materials / 2 Energy / 1 Iron record, and focused the native picker labelled `Inspect work or building`. This was confirmed through both the accessibility tree and read-only DOM inspection of the selected and focused values.
- `More town production (5)` disclosed exactly five further Aster rows below the three direct rows. They included truthful paused Irrigation works and Kiln records with no paid inputs and zero assigned residents. Read-only measurements found no horizontal overflow in the eight Aster production buttons at this desktop width.
- Pressing Enter on the disclosed Library button opened Work with the native picker selected and focused on `library`, displaying 6.75 Science from 1 Credits. Returning to Town retained the expanded production disclosure. This verifies an actual keyboard interaction, rather than treating native markup alone as a keyboard test.
- Willowmere / Verdant showed Foundry, Observatory, and Printing house as its three direct rows. Its Observatory showed 15.75 Science from 2 Credits with 3 assigned residents, with an explicit recorded season. Its Foundry had genuinely completed and operated by this observation; its presence was not inferred from an unfinished project. Clicking Observatory selected and focused `observatory` in Work. The live world advanced between observations, from season 1688 in the Overview screenshot to season 1689 in the Work record; quantities and selected building agreed. Screenshot: `.blabla/scratch/review-town-production-public-qa/verdant-desktop.png` (118,278 bytes).
- At revision 2151, Tidehaven / Pelagos also displayed its Observatory first, with 15.75 Science from 2 Credits, 3 assigned residents, and recorded season 1690. This independently samples both existing Observatory towns.
- The footer visibly showed `v0.1.0-live.29`. Opening it displayed `Town production at a glance`, with the newest release expanded and the previous five visible releases collapsed. Its wording described actual receipts, separate current state, and exact Work navigation. The adjacent `Built with BlaBla` link resolved in the DOM to `https://github.com/Kiborgik/blabla`.
- Only spectator controls were used: selection, scrolling, disclosure, Work navigation, and changelog. No world-changing action was attempted.

## Verification meaning

The declared Node check establishes that this report exists and is nonempty. It is not a browser test. The visual and interaction conclusions above are based on the documented cloud-browser observations and retained screenshots. The earlier implementation task separately recorded 12 focused passing tests and web typechecking; the orchestrator independently recorded source/provenance and hosted-artifact checks.

## Remaining limits

390px portrait pixels, physical touch devices, and the WebGL renderer are not verified. Native-button semantics and source tests support accessibility but do not substitute for these browser and device checks. No auto-reload transition was claimed: this review used an explicit reload after publication.

One bounded visual issue was observed while scrolling Verdant's panel: the existing sticky Close button can overlap a production row's upper-right current-state text when that row reaches the top of the panel. The receipt quantities remained visible, a small scroll restored the whole row, and exact Work navigation remained functional. This is a spectator-comfort residual for an Art Director successor with explicitly opened source scope, not a reason to alter frozen source during this report-only task.

The broader legibility and spectator-comfort goals remain Partial. The Art Director owns a later supported narrow-viewport/device check and the close-button overlap correction; the orchestrator owns opening that bounded work and arranging a supported viewport when available. Larger landscape, mobile, history, and accessibility outcomes are not completed by this increment.
