# Current architecture

Agentic Civilizations is a deterministic zero-player game. The core owns legality and all state changes; procedural policies choose among legal actions. The browser is an observer, not an alternate rules engine.

## Fresh configuration, not migration

**NO MIGRATIONS BEFORE RELEASE.** `createWorld(seed, epoch, registeredRulesId)` allocates a new world under registered starting rules. It cannot accept or upgrade an existing saved state. `createGeneratedWorld` calls that constructor, then lays out fresh seeded geography and founding names. Unknown configurations fail explicitly. Foundation history describes genesis, not a fabricated sequence of upgrades.

The old state-in/state-out release migrator and browser transition helper are removed. CLI and hosted release-write entry points refuse without writes. Historical decoding is inert read support, not an executable upgrade path. Current-version saves, policy memory and exact command replay remain deterministic. External stored data is not deleted. Database schema setup is separate from game-world migration.

## Modules

| Area | Responsibility |
| --- | --- |
| `core/types.ts`, feature type modules | Serializable world, commands and authoritative receipts |
| `core/content.ts`, feature content modules | Registered recipes, rules and requirements |
| `core/engine.ts`, `core/simulation/` | Fresh construction, legal actions and deterministic transitions |
| `core/validation.ts`, feature validators | Validate persisted state and exact recorded facts before use |
| `core/behaviors.ts`, behavior modules | Seeded policy choices and persistent controller memory |
| `protocol/` | Complete observation projections and bounded choice paging |
| `cli/` | Atomic local store, JSONL transport and contract probes |
| `server/` | Authenticated requests, D1 transactions, idempotency and public history |
| `visuals/` | Renderer-independent factual geometry and labels |
| `web/` | Browser simulation coordination, projection, inspection and rendering |

Presentation and policy modules do not grant resources or install capabilities. Use existing authorities for prices, staffing, site eligibility and output rather than duplicating formulas in viewers or controllers.

## Time and commands

A world records its seed, configuration, revision and optional explicit clock epoch. Independent actors have bounded tactical allowances; strategic economy beats and calendar intervals are separate. Public reads never realize either clock. A host or the local simulation driver explicitly submits due work and exact chosen actions.

Commands carry observed revisions and exact target identities. Current admission rechecks ownership, release requirements, costs, consent and timing. Numeric menu choices are revision-strict. Supported exact-action retries may revalidate the same intention, never substitute a target or recipe. Two-item plans record reviewed intentions; follow-ups do not reserve resources or execute automatically.

Accepted operations produce state and structured receipts together. Refused actions leave their protected state unchanged. Existing paid commitments and immutable accepted terms remain authoritative even when later policy preferences change.

## Economy and learning

Earth resources are civilization stocks. Cities contribute real production and consume household Food; an inspector must not invent per-town inventories. Food uses the current Food-budget rule rather than infrastructure amplification. Household receipts separate required meals from actual spending and paid growth.

Paid buildings and fisheries allocate available residents and opening inputs. A recipe either pays its full required inputs and operates or records a paused/blocked result with no invented output. Local Power is a city flow, not the civilization Energy stock. Finite strategic deposits and stored strategic resources have separate accounting. Construction, operation and one-time acquisition payments are distinct.

Trade requires consent to exact recurring terms and separately records each actual shipment. Joint repairs and relief protect accepted commitments and settle after ordinary activity. Relief transfers a persisted Food quantity or records a no-delivery result; incoming promises are not stock.

A Knowledge compact binds an exact route, teacher and learner institutions, and one of four terrestrial discoveries. Proposal and acceptance are not lessons. Two fresh qualifying deliveries require current operated institutions. Due settlement atomically charges the fixed contributions, transfers the agreed Credits and applies capped remaining research work through the canonical research authority. Completion can legitimately finish a discovery; no fake cargo, free technology or synthetic operation receipt is created. Withdrawal, expiry and failed funding preserve truthful outcomes.

Regional events select only eligible local facts. Their deterministic selector is carried into the command and revalidated without silently retargeting. Costs and immediate before/after receipts are separate from any economy beat that follows.

## Storage and observation

The CLI uses a process lock, synced temporary file and atomic rename. Hosted writes use one conditional D1 batch for state, transitions and receipts. Identical retries return the original commitment; changed payloads conflict. Corrupt current state fails closed rather than being repaired silently.

The browser's generated run is separate from hosted state. Coordinated current-version checkpoints are persisted before a Worker advances. Policy identity, memory and world configuration must agree. Storage failure is explicit; the fallback is labeled ephemeral. A new incompatible version can use a distinct fresh-world identity, never an implicit save migration.

Events retain the ordinary bounded recent window; durable feature receipts hold the facts needed after older events fall out. Full host/CLI history is not reconstructed from the viewer's recent cards. Provenance distinguishes procedural policies, clock mechanics, development agents and contract probes.

## Viewer

Both renderers consume shared factual projections. Installed local development determines settlement forms; unfinished construction and paused equipment remain distinguishable. Camera detail changes presentation, not inventory. Map cues refer to new committed observations, not replayed history or guessed activity. Selection, filters, camera movement and disclosures are read-only.

The Chronicle puts recognized results first, keeps original Events details and falls back safely for unknown records. Earth and Mars views have source-qualified identity. A terminal world cannot advance; pending flight copy describes a recorded unfinished mission rather than promising future arrival.

## Feature workflow

Extend authoritative mechanics, typed receipts, validation, policy and observer legibility together. Use focused current-state fixtures for conservation, refusal, duplicate/restart and malformed input boundaries. Label synthetic prerequisites explicitly; they do not prove a naturally earned historical journey. Use bounded organic observation to assess actual autonomous choices rather than manufacturing desired outcomes.

Batch typing, build, focused checks and independent review at substantial boundaries. Canonical verification covers only adapted contracts. Keep unsupported hosted, platform, balance and visual outcomes explicit rather than treating a passing source gate as complete product delivery.
