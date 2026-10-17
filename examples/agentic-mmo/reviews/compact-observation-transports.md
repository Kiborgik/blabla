# Compact observation transports: independent review

Reviewed 2026-10-16 14:21 UTC by gpt-6-astra after the hosted target reached READY, acceptance epoch 2.

## Verdict

No bounded correctness blocker found in the explicit CLI, JSONL, HTTP and MCP observation transport changes. They use the already reviewed core projector, preserve every ordered complete action and keep the default response compatible. This accepts source and local transport evidence; it does not establish published native-tool availability, live use, gameplay activation or provider performance.

## Exact actions and compatibility

The CLI accepts `--observation-format compact-trade-v1` only for `observe`; JSONL forwards the corresponding `observationFormat`. The host advertises the same optional enum on `observe_world` and accepts it on `/api/observe`. Both transport implementations call `observeCompactTrade` rather than rebuilding town, recipe, plan or consent semantics.

The explicit format retains each complete action and label, in its canonical order, and adds the zero-based `choice` index directly to each `legalActions` entry. It omits the redundant `choices` alias. Missing selectors preserve ordinary unindexed `legalActions` plus the existing indexed alias and omit the new format/fact fields. CLI release/clock/last-valid metadata and host release/clock/server-time metadata remain present. The hosts retain their intentional metadata differences; parity concerns the same core facts and indexed actions, not falsely identical whole CLI and HTTP envelopes.

Numeric submission still uses the existing revision-strict choice mapping; exact-action submission and concurrent revalidation are unchanged. Reading does not choose, reserve or execute a plan item. The separate-process CLI witness verifies that an observed indexed wait commits only after a subsequent explicit action command and matches the observed typed action. The hosted pending-offer test keeps exact stored terms and the two-item plan without submitting its successor. Prior core evidence for immutable accepted terms and catalogue tuning remains applicable to the unchanged projector.

## Validation, storage and authority

Unknown, empty, null, wrong-type and whitespace-suffixed selectors refuse rather than falling back. The CLI checks the selector before loading or locking a campaign, so invalid formats neither read corrupt state nor create a save directory. Its flag parser also rejects missing values, duplicate flags and use on another command. JSONL rejects a supplied format on mutation operations before they execute, then continues serving later requests.

The HTTP path rejects duplicate query selectors; MCP validates the value before the repository read. These are pre-SQL checks, not a claim that a missing database binding is ignored. Valid host reads perform the existing single world-state SELECT and no writes, batch, clock catch-up or receipt insertion. The SQLite-backed fixture rejects attempted writes and compares authoritative tables and change counters, including a deliberately overdue observation.

Valid CLI reads retain the existing `snapshot` lock: they can create/remove a transient lock file and ensure the containing directory exists. Their established read-only claim is unchanged campaign bytes, world state and receipts, not zero filesystem activity. Invalid format refusal occurs before that lock. Repeated separate-process reads and detached-result mutations preserve durable bytes.

Public observations remain public for anonymous and unenrolled callers. The existing MCP origin check and mutation identity/enrollment guards stay in place. A format selector creates no persistent access, identity, release or gameplay authority. Read-only discovery annotations remain hints rather than authorization enforcement.

## Actual finite transport measurements

The final CLI fixture reports 31,496 default bytes and 19,587 compact bytes. It has five cities and its own real local release history; it is not the same fixture as the hosted table below, so those totals must not be combined into a cross-host speed comparison.

Actual local Worker response bodies on the fixed synthetic hosted fixtures:

- Five towns: HTTP 16,101 → 11,782 bytes; MCP 33,406 → 24,834 bytes.
- Twenty-five towns, 100 exact proposals and 122 choices: HTTP 189,312 → 54,848 bytes; MCP 386,244 → 115,082 bytes.

The larger fixture shrinks about 71.0% over HTTP and 70.2% including MCP framing. MCP still contains its structured result and serialized text copy, both counted. The smaller transport also shrinks because removing the duplicate choices list outweighs the core fact-table overhead. Default bytes and fixture hashes remain unchanged in the author's comparison.

These are UTF-8 serialization measurements of real local response bodies, using clearly synthetic validator-accepted worlds. They are not live histories, token counts, compression ratios, CPU/latency results, arbitrary-world bounds or managed-host quota evidence. The core still constructs the full ordinary observation first; no reduction in Cartesian legality work is established.

## Evidence read

Read the complete CLI final log `.blabla/scratch/expose-compact-cli-observations/evidence-2-2-1792159810709638287.log`: 78 tests pass, including seven new CLI tests and retained protocol/persistence regressions. Read its scoped lint output.

Read the complete hosted final log `.blabla/scratch/specify-compact-host-transport/evidence-2-2-1792160353017662794.log`: 97 tests pass, including ten compact-host cases and existing hosting/action-receipt checks. Read `/tmp/compact-host-lint.log`. The source inspection covers selector forwarding, ordinary/compact branches, default wrappers, numeric action lookup, CLI locking/loading, hosted SELECT and authorization decisions. The ten host tests use real local SQLite behind the D1 interface, not a managed production database.

The independent declared check runs only `tests/compact-cli.test.ts` and `tests/compact-host-observation.test.ts`; its exact receipt remains on this review task. No broad suite, prior camera review, live mutation or production deployment was repeated.

## Next useful outcome

Publish through the separately authorized integration path, then verify actual deployed discovery and one explicit compact read before recommending agents use it. Keep complete action objects and observed revisions when they submit. The ready gameplay successor is a real versioned land-path timing quote, whose canonical facts can later use this shared view without inventing historical roads or transport costs.
