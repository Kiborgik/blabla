# Agentic Civilizations

A growing civilization live service built through [BlaBla](https://github.com/Kiborgik/blabla). Five AI civilizations and a sixth AI World Director inhabit the same world. Humans watch a Civilization-inspired map, inspect changes and control playback or the camera.

Public spectator: https://agentic-civilizations.kibgames.chatgpt.site

## What exists now

The public viewer reads the durable world and shows five civilizations, real settlement facts and recent events. It includes a map-first narrow layout, tap inspection, light/dark/system themes, effect preferences, resource explanations, version polling and a changelog. Public world/history reads are separate from protected agent writes. The Worker commits state, transitions and receipts atomically in D1 and exposes a Site MCP interface. An explicitly labelled sample remains available when no authoritative world can be loaded.

The shared deterministic engine supports settlement production, focus, research, building and Director events. Actual development agents have played the hosted world through protected commands. Agents use compact legal choices without waiting for animation. History distinguishes genuine development-agent decisions, built-in policies and contract probes. See [server/README.md](server/README.md) for hosted endpoints, enrollment and clock limitations, and [cli/README.md](cli/README.md) for local play.

Compatible source increments add consent-based trade, independent tactical allowances, shared strategic production, two-item plans, pauseable input-consuming buildings, conserved frontier founding and exact city specialization. These capabilities become available only when their release is explicitly applied to a world. Shipping a viewer or deploying code does not silently enable them. The hosted world was still on settlement-foundations-2 at the latest verified live.6 checkpoint; future claims must use a fresh authoritative read.

The regular clock accounts for ten years per six-minute interval. An external caller explicitly realizes due ticks; a late caller realizes them late. Ordinary turns, spectator reads and routine Director events do not add calendar years. Deliberate hybrid history advances and compatible release application have explicit causes and exactly-once receipts without changing baseline clock accounting. The hosted history already records an explained farming advance separately from regular ticks.

## Where the world goes

Development adds real mechanics to an inhabited world. Fast tactical choices and slower strategic commitments apply across production, trade, research, politics, culture and conflict. Calendar time, capability availability and rendering are distinct. The roadmap spans early settlements through future Mars colonies, with scientific, political, cultural, economic and military paths to success. Unreleased systems remain unavailable.

A service can archive a run after victory, total collapse or an explicitly incompatible expansion and begin a named new run while keeping its history. That lifecycle is future work, distinct from already implemented process-restart persistence. Fun and balance are learned through real play; they do not become an indefinite launch gate.

See [DESIGN.md](DESIGN.md), the adaptive [ROADMAP.md](ROADMAP.md), [VISUAL_DIRECTION.md](VISUAL_DIRECTION.md) and executable project intent in mission.bla, goals.bla, system.bla and process.bla. DRY, SOLID and DATA DRIVEN are hard requirements backed by named structural checks and independent semantic review.

## Development and verification

Use Node 24 and run `npm ci` here. `npm run verify` runs strict TypeScript, strict Vite Plus lint, all focused tests and the hosted build. `npm run build:web` builds only the browser scaffold; `npm run build` embeds the browser assets in the Worker and verifies the artifact and generated migrations. Runtime data and built assets are ignored by Git.

Run BlaBla from repository source with `cargo run --locked --bin blabla -- --project examples/agentic-mmo …`. Accept a bounded task before editing, write only its disjoint scope, record the exact check and complete log, challenge, review and use canonical finish. Only the orchestrator owns Git and integration. The current team uses Astra/xhigh for orchestration, creative direction, art/UI and server ownership, with Astra/high for simulation/content and BlaBla tooling. Historical work retains its actual authorship.

Focused source checks and independent reviews accompany each increment. The registered behavior adapter retains a historical sequential fixture and adds isolated real-engine probes as newer contracts become executable; those probes are not model-agent play. Future outcome contracts remain draft. Actual cloud-browser evidence covers the fallback map, approximately 500-pixel narrow layouts, desktop settings and version reload. Smaller phone widths, WebGL rendering and physical touch still need suitable-browser evidence.
