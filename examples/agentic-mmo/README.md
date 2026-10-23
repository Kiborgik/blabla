# Agentic Civilizations

A zero-player civilization simulation built through [BlaBla](https://github.com/Kiborgik/blabla). Five seeded civilizations and a procedural World Director make legal engine decisions. Humans watch, inspect, move the camera and change display settings; there are no player faction orders or runtime language-model calls.

[Public spectator](https://agentic-civilizations.kibgames.chatgpt.site). Deployed content may lag the repository.

## NO MIGRATIONS BEFORE RELEASE

Prioritize procedural content and the whole historical journey over pre-release save compatibility. New rules may start an explicitly fresh world. No browser, CLI or hosted operation upgrades an existing world in place. Do not delete external stored data. Same-version deterministic restart, atomic writes, paid effects and honest source labels remain required. Reconsider migrations after release; this does not remove unrelated database schema infrastructure.

## Watch the world

The default observatory runs a separate accelerated generated world in a browser Worker. Its seed is chosen once and persisted before advancement when coordinated browser storage is available. It pauses while hidden. A clearly labeled this-tab fallback is not a durable or shared world. Only the current local world is offered. The native hosted archive is separate and read-only; former browser save keys are not parsed or rewritten.

Current gameplay includes:

- Seeded geography, viable starts, culture-shaped founding names and soft strategic temperaments.
- Paid settlement growth, farming, resident-limited production, household Food demand and shore fisheries.
- Research, civic commitments, governments, policies, local industry, power and finite resource deposits.
- Consented trade, funded route repairs, voluntary conserved Food relief and paid Knowledge compacts.
- Qualified regional events with exact local targets and recorded consequences.
- Earned interplanetary transport and supplied habitats as a late endpoint, not the purpose of every earlier era.

Knowledge compacts require explicit consent, two fresh qualifying trade deliveries and operated institutions. They buy bounded research work, not free discoveries. Inspection separates promises, actual payments, lessons, production and failures. Full event details remain available.

Flat and Three renderers share factual visual models. Towns, worked sites and routes represent installed or committed state. Mars terrain is illustrative context for recorded missions and colonies, not an additional simulated economy. Broader early/middle-history variety, balance and visual refinement remain ongoing work; catalogue ideas are not implemented mechanics.

## Run locally

From this directory, with Node 24:

```sh
npm ci
npm run dev
npm run typecheck
npm run typecheck:web
npm run build
```

`build` creates the client plus a Worker with embedded assets and verifies their provenance. `build:web` builds only the browser client. Runtime checkpoints, build output and local evidence are ignored by Git.

See [CLI usage](cli/README.md) for a persistent headless world and [server usage](server/README.md) for authenticated hosting. Hosted simulation requires explicit activation and an external wake source; a page visit or deployment is not a scheduler.

## Architecture and development

[DESIGN.md](DESIGN.md) describes the current state and execution boundaries. [VISUAL_DIRECTION.md](VISUAL_DIRECTION.md) contains the map-first art direction. `mission.bla`, `goals.bla`, `system.bla` and `process.bla` hold the registered intent; planned contracts remain draft until actually adapted.

Run BlaBla from repository source, not an installed binary:

```sh
cargo run --locked --quiet --bin blabla -- --project examples/agentic-mmo status
```

Accept a scoped task before edits. Batch focused tests and independent review after substantial features, then run the declared integration boundary; do not repeat unchanged suites for small edits or administrative freshness. Read actual child exits and complete logs. The canonical adapter covers its registered scenarios, not every possible procedural outcome. Synthetic prerequisites, autonomous campaigns, browser acceptance and deployed behavior are distinct evidence.

Keep only useful code, assets, contracts, tests and concise usage/architecture documentation in Git. Internal handbacks, research packets, raw logs and experiment reports belong in ignored task scratch. Full development history is in Git, not the runtime changelog.
