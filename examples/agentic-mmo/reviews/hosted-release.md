# Hosted settlement release review

Independent reviewer: `gpt-6-astra`, task `review-hosted-release`.
Reviewed 2026-10-16 08:06–08:09 UTC against the frozen host source and current built artifact.

## Result

**No demonstrated deploy-blocking source integrity or security defect was found.** The focused declared check independently passed **16 tests, 0 failed/skipped, and scoped strict lint, overall exit 0**.

Initial publication is supported with **the writer allowlist absent/empty**, which denies all world mutations. This is not approval to enroll writers and does not establish authenticated online agents, actual D1 provisioning or an unattended clock. Before enrollment, verify the platform identity boundary on the real public deployment; the remaining conditions are listed below.

## Deciding source and evidence

Paths are relative to `examples/agentic-mmo/`.

- **Fail-closed writes:** `server/worker.ts:25-37` requires a Site-scoped authenticated identity and an explicit allowlist match. Missing configuration denies writes. Cross-origin requests with an Origin header are refused. HTTP write routes and MCP write tools use this same guard (`77-87,148-157`). Request-body identity and a service-bypass header are not accepted substitutes. Public observation does not mutate state (`69-74,132-145`).
- **Bounded parsing:** JSON bodies are limited to 64 KiB while streaming, with cancellation at the limit (`worker.ts:40-61`). Numeric/UTC/text validators reject malformed values; canonical request fingerprints sort keys and bound nesting (`server/validation.ts:24-45`). Invalid inputs reach no commit.
- **Authoritative engine:** the repository selects actual legal actions and invokes the same pure engine (`server/repository.ts:97-131`). It refuses stale revisions, wrong actors and future timestamps. Reads validate initial/current canonical worlds and check the database revision against state (`33-43`); transitions validate the resulting world before persistence (`132`).
- **Atomic persistence and retries:** initialization uses a batch and cannot replace an existing run (`repository.ts:58-78`). Mutation inserts a transition conditionally at the expected revision, updates the world by CAS, then inserts its receipt in the same D1 batch (`135-153`). SQL uses bound values. Distinct operation namespaces avoid the earlier actor/clock collision (`82-86`). Exact replayed requests return prior receipts; changed content with the same identity is rejected (`46-55`). The focused tests exercise competing commands, identical retries, changed payloads, receipt-failure rollback, process restart, malformed/corrupt state and namespace separation.
- **Clock and history:** explicit catchup uses current server time as an upper bound and the engine's 240-tick batch limit (`repository.ts:110-128`; `core/simulation/clock.ts:129-164`). It does not consume a civilization turn. Public reads cannot advance time. History pages are bounded to 200 and cursor over end revision (`repository.ts:156-168`). Public history removes operator identity while retaining public action/model provenance (`worker.ts:141-143`); deterministic service work is labeled separately (`repository.ts:134`).
- **Migration integrity:** `server/schema.ts:4-32`, generated `server/migrations/0000_world.sql` and Drizzle metadata agree on world, transition and receipt tables; nonnegative revision, increasing transition revision, unique receipt and foreign-key constraints are present. Migrations are schema-only with no seeded world or request-time DDL. The new migration test independently passes and checks the constraints and metadata (`tests/hosting.test.ts:299-326`).
- **Actual artifact boundary:** `dist/server/index.js` is 864,937 bytes; SHA-256 `10cf8b689cf8cb27db5ff0b28a452741de24cf7f9ad604a55746af0d687d230a`. Inspection found its actual fail-closed identity/allowlist/origin code, revision-conditioned SQL, bounded history and MCP protocol checks. It ends in a default Worker export and has no remaining runtime import statements. Packaged hosting manifest, migration SQL, snapshot and journal are byte-identical to their source counterparts.
- **Build and packaging:** `scripts/build-hosted.ts:15-55` embeds built client assets, uses immutable caching for hashed assets and no-store for index/version/history metadata; API/MCP routing precedes the asset responder. Its Worker-target bundle and manifest/migration copy are explicit (`58-74`). `.openai/hosting.json` declares logical D1 `DB`, no R2 and MCP capability, with no static-only mode. `scripts/verify-hosted.ts:15-42` checks the built default export, embedded assets, uncached version, denied anonymous action and migration journal. The orchestrator ran that artifact check in the full verification; this focused reviewer did not claim a separate rerun of it.

The official Sites identity, MCP, storage and Worker-ESM references were also read. They document the Site-scoped header, separate OAuth/service access, logical bindings, schema-only migrations, stateless `/mcp` and the expected Worker output shape. Source/bundle structure is consistent with those contracts.

## Required runtime boundary before writer enrollment

1. Publish with `AGENT_WRITER_USER_IDS` absent/empty; verify missing identity and forged identity requests cannot mutate the world.
2. On the anonymous public path, send a spoofed `oai-authenticated-user-id` to read-only MCP `whoami`. It must not be reflected as an authenticated caller. The official documentation names the header and says anonymous requests have no identity; it does **not** independently prove header stripping in this review. Do not enroll a writer if the deployed path trusts a caller-supplied identity.
3. Connect through the official Site plugin/OAuth flow, call `whoami`, and obtain the actual Site-scoped ID. A platform account ID or service-bypass token is insufficient. Enrollment is a separate authorized runtime configuration step.
4. After authorized enrollment, submit one real supported command and verify durable revision/history read-back, exact retry behavior and denied anonymous writes through the same deployed route. Keep the viewer's sample-scaffold label until it actually consumes authoritative state.
5. Verify the intended unattended connection can read and submit catchup. Exact six-minute execution, the new hybrid milestone operation, future strategic layers and continuous model play are not established by this release review.

These are concrete external trust/integration checks, not evidence of a source defect or a demand for a broader security redesign. With an empty allowlist, a spoofed header alone cannot pass the mutation guard; the publication can safely expose read-only discovery while the boundary is tested.

## Nonblocking limits

- SQL tests execute the actual migration/query statements through Node SQLite with a D1-shaped transaction adapter. They establish those tested statement semantics, not deployed D1/network behavior.
- Persisted receipt/history validation checks less detail than canonical world validation (`repository.ts:18-25`). No reachable ordinary request was found that creates an invalid receipt or arbitrary history payload; no broad corruption-hardening release gate is added.
- Duplicate finite event-ID allowlists remain a maintenance issue already identified in the requirements audit. Current event legality still converges on the engine, so no divergence was demonstrated here.
- Full package verification and canonical GREEN reported by the orchestrator are separate from this focused check. Browser appearance, current-goal fulfillment and future game completeness are not certified.

## Task evidence

Accepted and challenged through current-source BlaBla before editing. Independently ran the exact declared command `node scripts/check-task.ts hosting` with the approved toolchain, read all 16 test results and the child lint result, and observed overall exit 0. This runner performs host tests plus strict lint of `server/` and `tests/hosting.test.ts`.

Only `reviews/hosted-release.md` was written. No production source, migration, artifact, Git state, permissions, credentials, hosted data or deployment was modified. The orchestrator owns closure and publication.
