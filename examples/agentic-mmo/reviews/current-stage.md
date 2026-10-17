# Current settlement-stage review

Independent reviewer: `gpt-6-astra`, task `review-current-stage`.

## Result

No demonstrated current settlement-stage blocker remains after independently inspecting the repairs and running the final focused check: **65 tests pass and scoped strict lint passes, exit 0**. The three reproduced interface defects and the content lint failure are repaired. Their task findings remain for the orchestrator to resolve; this report does not close them.

This review covers the complete current `core/` and `cli/` source, the engine/interface/content tests, check scripts and configuration, plus the shared TypeScript JSONL adapter and the draft campaign contract. It does not establish deployment, live model play, browser correctness or production service operation.

## Initial blocking findings and verified repairs

1. **Malformed durable worlds can be accepted and overwritten.** `cli/store.ts:96-110` validates only part of the persisted world. In a fresh temporary store, replacing `state.year` with the string `broken` still permits `snapshot()`. A catchup at epoch plus six minutes returns `ok: true`, advances revision and persists `year: "broken10"`. This contradicts the corruption-preservation promise in `cli/README.md:35`. Validate the persisted fields that runtime code relies upon, reject malformed data with a recoverable protocol error, and preserve the original bytes. Recorded as `implement-agent-interface` finding 1.

2. **Actor IDs can occupy the Director's idempotency namespace.** `cli/store.ts:203-211` accepts arbitrary actor command IDs, while `cli/store.ts:266-272` searches the same IDs for generated Director keys. A valid first actor action using `director:clock:1` is accepted; the actual first due clock tick then fails with an ID-content conflict and leaves `clockTicks` at zero. Separate operation namespaces or reserve system IDs, with a regression covering this collision. Recorded as `implement-agent-interface` finding 2.

3. **The draft calendar contract cannot observe its declared field.** `contracts/campaign.bla:3,29` declares `year` and asserts ordinary turns preserve it. `cli/adapter.ts:13-27` omits `year` from the observed state. A direct adapter observation confirms the property is absent. Project actual engine calendar state and verify it across ordinary turns. This is a draft bridge mismatch, not a claim that the draft contract already passed. Recorded as `implement-agent-interface` finding 3.

4. **The assigned combined check fails lint.** `core/content.ts` has forbidden non-null assertions, an unsafe resource assertion and a helper-scoping violation; `tests/content.test.ts` has floating test promises and non-null assertions. These are current executable check failures, not style preferences added by this review. Recorded as `shape-campaign-content` finding 1.

The line references above describe the initial reviewed source. Verified final repairs:

- `core/validation.ts:171-279` now checks canonical world fields and references. `cli/store.ts:149-160` applies it to current state, initial state and every recorded frame before use. The corrupt-year regression and ten malformed-field cases reject without rewriting bytes (`tests/cli.test.ts:581-604,653-734`). Initial/frame corruption and explicit legacy compatibility also have passing regressions. The legacy option does not manufacture a clock; system operations require an explicit migration (`cli/store.ts:451-454`).
- Actor receipt lookup requires operation `action` (`cli/store.ts:375-377`), and system receipt lookup requires its own operation (`cli/store.ts:504-506`). The original collision now permits both independent operations and makes both exact retries duplicates (`tests/cli.test.ts:606-633`).
- The contract adapter projects actual `state.year` (`cli/adapter.ts:20`); its regression checks initial projection, all six ordinary probe turns and restart preservation (`tests/cli.test.ts:635-651`).
- Content now guards required values, uses a safe resource membership check and a top-level numeric helper; tests await their test promises and use checked access. The final focused lint command reports exit 0.

## What the source and checks support

- One engine legality path drives observations and accepted actions. Invalid seat, stale revision, terminal state and action shape are checked before the state is cloned and changed (`core/engine.ts:131-206`; `core/simulation/choices.ts`). The six-seat cycle resolves production once per full round and does not move calendar years.
- Calendar ticks use an explicit persisted epoch, exactly six minutes per interval, ten years per tick and a century event every ten ticks. Catchup uses canonical due timestamps, is capped at 240 ticks and reports remaining work. Event and review injections add zero years and preserve the actor turn (`core/simulation/clock.ts`). Feature availability is separate from calendar advancement.
- Released settlement actions have causal effects: focus changes production, researched cultivation enables farm/workshop construction, production and upkeep affect population and wellbeing, and supported Director events apply typed effects. Future systems are feature-gated instead of advertised as operative outcomes (`core/release.ts`, `core/simulation/choices.ts`, `economy.ts`, `commands.ts`, `effects.ts`).
- Content owns definitions, effects, prerequisites and milestones. The engine, policy selector, host persistence and viewer remain separate. Eligibility and history evaluate actual state; no calendar formula silently unlocks future mechanics. The typed effect interpreter is appropriately bounded rather than an arbitrary scripting framework.
- Observations are detached, omit map/replay bulk, expose relevant city/rival facts, include twelve recent events and supply legal action labels. The interface also emits indexed choices derived from the same legal options. Keeping both options representations duplicates payload but is not a present correctness blocker.
- The durable writer uses a process lock, synced same-directory temporary file, atomic rename and directory sync. Tests cover process restarts, competing writers, stale revisions, exact-payload retries, mixed timeline replay and dead writer recovery. The corruption and key-namespace findings above limit what those successful tests establish.
- JSONL uses the repository's actual shared adapter, preserving request IDs and continuing after malformed JSON/non-object lines. Game protocol errors are returned as structured failures. Shared transport is an external repository input outside the nested project fingerprint; later changes there need explicit verification attribution.

## Semantic design assessment

The architecture contract's 22 symbol/dependency requirements describe useful boundaries; they do not prove DRY or SOLID semantics. Reading the deciding implementations supports these narrower conclusions:

- `availableActions` supplies both observable choices and `applyCommand` acceptance, so policies and the CLI select among engine decisions rather than maintaining separate settlement eligibility formulas (`core/engine.ts:131-206`).
- Both ordinary Director actions and scheduled Director events call `applyDirectorEvent`; construction and Director effects share `applyEffects`. Adding a composition of existing effect primitives is content work, not another event-specific mutation branch (`core/simulation/commands.ts:8-40`, `effects.ts:5-63`, `clock.ts:111-118`).
- The pure canonical world validator is reused at durable boundaries. Storage owns locking and receipts, while the core owns legal transitions. The actual ID-collision repair restores that boundary rather than adding a second clock rule.
- The CLI still repeats its finite Director event-name allowlist and some receipt/refusal plumbing; observations repeat legal options as indexed choices. These are concrete maintenance duplication, not evidence of currently divergent settlement decisions. No abstraction rewrite is required for this increment.
- History conditions and release gates remain explicit typed data. There is no speculative plugin system or generic outcome score replacing the intended future mechanics. This assessment does not establish strategic depth or balance.

## Independent evidence

Executed `node scripts/verify.ts all` from the nested project with the approved toolchain on 2026-10-16. Actual overall exit: **1**.

- Typecheck: exit 0.
- Lint: exit 1, content/test issues above.
- Tests: exit 0, 53 passed, none failed or skipped.
- Production build: exit 0; the bundle-size warning is not treated as a new release gate.

The command's attempted `tee` log was not created because its scratch directory did not exist. Results were read from the complete command output; no saved log is claimed. The real exit was recorded through current-source BlaBla.

Three focused inline Node probes used isolated temporary stores and removed them afterward. They reproduced the corrupt-year overwrite, the actor/Director ID collision and the absent adapter calendar field exactly as described above. They did not modify application source or inhabited worlds.

After the owners repaired the defects, the orchestrator deliberately changed this review's declared check to `node scripts/check-task.ts stage` because ongoing server work had entered the package-wide check. I inspected that runner: it executes all engine, content and CLI tests, then strict Vite+ lint over those sources and tests. I independently executed it on the frozen repair source: **65 passed, 0 failed, 0 skipped; test exit 0, lint exit 0, overall exit 0**. A complete first final-run log is `/tmp/review-current-stage-final.log`; the current-source BlaBla evidence receipt records the exact final declared check separately. Full package typecheck/build and server review remain integration responsibilities, not claims made by this focused receipt. The earlier aggregate exit 1 remains historical evidence rather than being rewritten as green.

## Scope and follow-through

The owners' actual fixes and regression assertions were re-read independently before the final check. The orchestrator can resolve the four recorded findings using this evidence and perform final package/contract integration. No full campaign, new architecture, balance work or speculative scale requirement is added as a settlement release gate.
