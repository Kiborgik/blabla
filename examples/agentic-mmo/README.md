# Agentic Civilizations

A zero-player civilization simulation (ZPG) built through [BlaBla](https://github.com/Kiborgik/blabla). Five seeded, weighted finite-state civilizations and a procedural World Director inhabit the world without runtime language-model calls. Humans watch a Civilization-inspired map and use observational camera, inspection and layer controls.

Public spectator: https://agentic-civilizations.kibgames.chatgpt.site

## What exists now

The viewer defaults to a separate accelerated local observatory: a browser Worker advances five civilizations and a procedural Director through authoritative engine commands, and a compatible checkpoint is saved in this browser. The shared native world and durable history remain a separate observational source. The map-first interface includes narrow layouts, settlement inspection, light/dark/system themes, effect preferences, resource explanations, version polling and a changelog. Public shared-world reads never run the simulation or mutate storage. Protected host commands commit state, transitions and receipts atomically in D1; explicit activation and a supported external wake source are required for shared-host autonomy. An explicitly labelled sample remains available when the shared source cannot be loaded.

The shared deterministic engine supports settlement production, focus, research, building and Director events. Actual development agents have played the hosted world through protected commands. Agents use compact legal choices without waiting for animation. History distinguishes genuine development-agent decisions, built-in policies and contract probes. See [server/README.md](server/README.md) for hosted endpoints, enrollment and clock limitations, and [cli/README.md](cli/README.md) for local play.

Compatible source increments add consent-based trade, independent tactical allowances, shared strategic production, two-item plans, pauseable input-consuming buildings, conserved frontier founding and exact city specialization. These capabilities become available only when their release is explicitly applied to a world. Shipping a viewer or deploying code does not silently enable them. The fresh authoritative read on 2026-10-22 found the shared world on settlement-local-power-1 at revision 2790; this is a historical checkpoint, not evidence of continuous operation. Always re-read before a live claim.

The regular clock accounts for ten years per six-minute interval. An external caller explicitly realizes due ticks; a late caller realizes them late. Ordinary turns, spectator reads and routine Director events do not add calendar years. Deliberate hybrid history advances and compatible release application have explicit causes and exactly-once receipts without changing baseline clock accounting. The hosted history already records an explained farming advance separately from regular ticks.

## Procedural direction

The engine remains authoritative. Versioned behavior profiles choose legal actions with seeded randomness, required-lane fairness and persistent strategic state. Development agents continue the complete BlaBla workflow; they no longer act as the runtime civilizations. Existing model-agent history keeps its true attribution.

The local observatory is a distinct accelerated procedural run saved in this browser. It runs while the page is open and is never represented as the shared native world or an unattended server. The native world and its archive remain separate. Hosted autonomy requires explicit protected activation and a verified supported wake source; source code alone does not establish scheduling.

Civilization-like look and feel is a hard acceptance requirement: a legible, inhabited, map-first world rather than a developer dashboard. Humans only observe.

## Where the world goes

Development adds real mechanics to an inhabited world. Fast tactical choices and slower strategic commitments apply across production, trade, research, politics, culture and conflict. Calendar time, capability availability and rendering are distinct. The required journey runs from early settlements through earned industrial and planetary capabilities to paid, supplied, viable Mars colonies. Scientific, political, cultural, economic and military paths are the intended wider design. Full late-age progression and colony mechanics are still ongoing work; unreleased systems remain unavailable.

A service can archive a run after victory, total collapse or an explicitly incompatible expansion and begin a named new run while keeping its history. That lifecycle is future work, distinct from already implemented process-restart persistence. Fun and balance are learned through real play; they do not become an indefinite launch gate.

See [DESIGN.md](DESIGN.md), the adaptive [ROADMAP.md](ROADMAP.md), [VISUAL_DIRECTION.md](VISUAL_DIRECTION.md) and executable project intent in mission.bla, goals.bla, system.bla and process.bla. DRY, SOLID and DATA DRIVEN are hard requirements backed by named structural checks and independent semantic review.

## Development and verification

Use Node 24 and run `npm ci` here. `npm run verify` runs strict TypeScript, strict Vite Plus lint, all focused tests and the hosted build. `npm run build:web` builds only the browser scaffold; `npm run build` embeds the browser assets in the Worker and verifies the artifact and generated migrations. Runtime data and built assets are ignored by Git.

Run BlaBla from repository source with `cargo run --locked --bin blabla -- --project examples/agentic-mmo …`. Accept a bounded task before editing, write only its disjoint scope, record the exact check and complete log, challenge, review and use canonical finish. Only the orchestrator owns Git and integration. All six current development streams use actual Astra/xhigh with primary specialties and explicit scoped cross-role handoffs. Historical work retains its actual authorship.

Focused source checks and independent reviews accompany completed meaningful features, not every small edit. An hourly commit-readiness inspection does not force gates or commits. The registered behavior adapter retains a historical sequential fixture and adds isolated real-engine probes as newer contracts become executable; those probes are not model-agent play. Future outcome contracts remain draft. Actual cloud-browser evidence covers the fallback map, approximately 500-pixel narrow layouts, desktop settings and version reload. Smaller phone widths, WebGL rendering and physical touch still need suitable-browser evidence.
