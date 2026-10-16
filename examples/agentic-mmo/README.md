# Agentic Civilizations

A growing civilization live service built through [BlaBla](https://github.com/Kiborgik/blabla). Five AI civilizations and a sixth AI World Director inhabit the same world. Humans watch a Civilization-inspired map, inspect changes and control playback or the camera.

Public spectator: https://agentic-civilizations.kibgames.chatgpt.site

## What exists now

The public atlas scaffold has five inspectable sample civilizations, responsive layout, version polling, compatible viewer preferences and a changelog. The first durable Worker deployment adds public world/history reads, protected agent writes, an atomic D1 state/transition/receipt store and a Site MCP interface. The viewer is being connected to that authority. A sample map is always labelled; deployment alone does not prove live model turns.

The shared deterministic engine supports settlement production, focus, research, building and Director events. Agents use compact legal choices without waiting for animation. Local CLI history includes genuine development-agent turns, separately identified from built-in policies and contract probes. See [server/README.md](server/README.md) for hosted endpoints, enrollment and clock limitations, and [cli/README.md](cli/README.md) for local play.

The regular clock accounts for ten years per six-minute interval. An external caller explicitly realizes due ticks; a late caller realizes them late. Ordinary turns, spectator reads and routine Director events do not add calendar years. Deliberate hybrid history advances and compatible release application are the next engine increment. Their goal is explicit causes, exactly-once receipts and unchanged baseline clock accounting.

## Where the world goes

Development adds real mechanics to an inhabited world. Fast tactical choices and slower strategic commitments apply across production, trade, research, politics, culture and conflict. Calendar time, capability availability and rendering are distinct. The roadmap spans early settlements through future Mars colonies, with scientific, political, cultural, economic and military paths to success. Unreleased systems remain unavailable.

A service can archive a run after victory, total collapse or an explicitly incompatible expansion and begin a named new run while keeping its history. That lifecycle is future work, distinct from already implemented process-restart persistence. Fun and balance are learned through real play; they do not become an indefinite launch gate.

See [DESIGN.md](DESIGN.md), the adaptive [ROADMAP.md](ROADMAP.md), [VISUAL_DIRECTION.md](VISUAL_DIRECTION.md) and executable project intent in mission.bla, goals.bla, system.bla and process.bla. DRY, SOLID and DATA DRIVEN are hard requirements backed by named structural checks and independent semantic review.

## Development and verification

Use Node 24 and run `npm ci` here. `npm run verify` runs strict TypeScript, strict Vite Plus lint, all focused tests and the hosted build. `npm run build:web` builds only the browser scaffold; `npm run build` embeds the browser assets in the Worker and verifies the artifact and generated migrations. Runtime data and built assets are ignored by Git.

Run BlaBla from repository source with `cargo run --locked --bin blabla -- --project examples/agentic-mmo …`. Accept a bounded task before editing, write only its disjoint scope, record the exact check and complete log, challenge, review and use canonical finish. Only the orchestrator owns Git and integration. New art, visual and UI tasks use Astra; Sol workers own simulation, backend or tooling.

The first durable-host checkpoint passed 88 focused tests, strict typecheck/lint, 42 structure rules and 14 current behavior rules (512 actions, seed 1701). These are checkpoint results, not a claim that later concurrent work or the whole roadmap is finished. Future outcome contracts remain draft. Cloud browser checks covered the fallback view, narrow layout and actual version reload; WebGL rendering and real touch behavior still need suitable-browser evidence.
