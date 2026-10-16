# Avoid discarded trade prose

Author: gpt-6-astra, high reasoning. Task: avoid-discarded-trade-prose,
registered worker. Prior measurement and deployment snapshots retain their own
attribution and evidence. No live command or release was submitted here.

## Outcome and narrow implementation

Compact trade reasons now originate in the same canonical trade enumeration as
full reasons. An optional presentation argument passes from `observeCompactTrade`
through `observe` and `availableActions` to `availableTradeActions`. Its default is
full. Only reason construction branches; admission, eligibility, ordering,
actions, labels, quote generation, consent and immutable terms use the existing
paths. The projection still detaches the observation and builds canonical town
and recipe facts. It no longer constructs, clones and replaces full trade prose.

The request-local planner retains its existing per-source tree reuse. No second
legality implementation, cross-request cache, persistent schema, transport
selector or game tuning was introduced. Existing plan readiness may independently
enumerate actions through its unchanged full path; this bounded patch does not
claim to remove that work. Measured profile fixtures below have no attached plans.

Production remained untouched until the parent's prerequisite compact-host task
was confirmed CLOSED. The four edited production files are engine, observation,
choices and trade. Only the test and this report are additional deliverables.

## Prospective correctness evidence

This is a measured refactor of already correct outputs. There is no fabricated
behavioral RED. Before production edits, `tests/compact-generation.test.ts`
captured exact SHA-256 hashes of serialized full and compact observations for
13 fixtures, six seats and three observation times: 468 outputs. Those hashes
were not regenerated after implementation. The 13-test declared combination
passed before and after the change.

The matrix includes initial and historical first-city trade, exact endpoints,
land quotes, both released recipes, synthetic 25-city growth, old pending offers
carried into the land release, new pending and accepted consent, a real two-item
plan and a separately labeled missing-plan-town fixture. The same-revision
0/10/60-second observations exercise admission changes and retain all exact
ordered actions, labels and quotes. Additional assertions compare every action
against canonical `legalActions`, preserve plan/offer/route values and prove
source/output/neighboring-quote detachment. Existing compact tests retain
catalogue-tuning snapshot checks and terrain/deposit production reconciliation.

The initial scratch hash-capture helper had a relative-import path error; it was
corrected before capturing baselines. This bootstrap error is not a falsification
of product behavior. Scoped test lint found a non-null assertion, replaced by an
explicit assertion before implementation. Final scoped strict lint passes.

Evidence lives under `.blabla/scratch/avoid-discarded-trade-prose/`:

- `baseline/`: preserved pre-edit core, not a Git worktree.
- `baseline-views.json` and `capture-baseline.ts`: actual pre-edit output capture.
- `characterization.log`: 13 passing tests before source changes.
- `first-optimized.log`: the same 13 tests after source changes.
- `first-optimized-lint.log`: strict lint over the four source files and new test.
- `before/` and `after/`: complete stdout, source pins, inspector CPU/allocation
  samples and summaries from the same finite measurement workload.
- `paired.mjs`, `paired.log`, `paired-results.json`: same-process interleaved old
  versus new measurements with byte-exact output assertions.

The final task evidence receipt records the declared test command after this
report. Logs were read in full and child exits checked. No broad suite, canonical
finish or host CPU benchmark is represented by these results.

## Finite before/after measurement

Environment: Node 24.19.0, V8 13.6.233.17-node.51, Linux x64, AMD EPYC 9V74.
Fixtures reuse the prior measured constructions and their unchanged state hashes.
The operating five-city case uses only legal release transitions. Endpoint
fixtures and 25-city additions are explicitly synthetic canonical observations,
not a legal founding journey or actual model play.

The primary timing comparison imports preserved old and new source into one
process, verifies complete serialized output equality, warms each variant 100
times, then runs nine rotating-order batches of 100 calls per variant. Timing
excludes assertions and serialization. Values are batch medians in milliseconds
per view. The default full path is shown as a control, not assumed cost-free.

| Fixture | Full old / new ms | Compact old / new ms | Compact median reduction | Compact bytes, unchanged | Sampled compact allocation bytes old / new |
| --- | ---: | ---: | ---: | ---: | ---: |
| endpoints 5 | 0.123 / 0.120 | 0.147 / 0.144 | 1.8% | 11,094 | 157,082 / 134,795 |
| endpoints 25 | 0.591 / 0.625 | 0.691 / 0.409 | 40.8% | 52,378 | 800,497 / 358,394 |
| operating 5 | 0.302 / 0.311 | 0.330 / 0.320 | 2.8% | 23,024 | 429,364 / 376,695 |
| operating 25 | 1.904 / 1.924 | 2.152 / 1.325 | 38.4% | 133,243 | 2,474,225 / 1,196,109 |

The two 25-city cases show a useful local reduction, approximately 41% and 38%.
Five-city changes are only about 2–3%, within observed timing noise. Full control
medians vary from about -2% to +6%; the operating-five new compact batch includes
a 1.38 ms outlier, retained in the raw evidence. These are finite local results,
not universal latency thresholds, production Worker measurements or quota claims.

Separate before/after inspector runs preserve the prior methodology: warm 40,
seven alternating timing batches of 100, allocation sampling over 300 calls at
16,384-byte intervals including collected objects, 30 held outputs with explicit
GC, and 700-call CPU profiles at a requested 100-microsecond interval. Separate
raw timing runs were noisier than the paired comparison and are not substituted
for its numbers. Sampled allocation estimates are neither exact bytes allocated
nor peak heap. They include runtime/profiler noise.

In endpoint-25 and operating-25 compact profiles, the old full-trade-formatting
subtree accounts for 23.1% and 17.5% of sampled CPU; neither subtree appears in the
new profiles. Its sampled allocated bytes fall from approximately 312 KB and
612 KB per view to zero samples. Total sampled compact allocation falls from
800 KB to 358 KB and from 2.47 MB to 1.20 MB. The unchanged output byte sizes and
source inspection corroborate avoided temporary work; zero samples alone would
not prove zero allocation.

For the 25-city two-recipe fixture, 200 proposals previously generated 400
settlement-site descriptions plus 200 verbose path strings, totaling 162,466
UTF-8 bytes of full reasons subsequently discarded. The new menu creates only
its retained compact reasons and 25 unique town facts. Endpoint-25 similarly
avoids 200 repeated site descriptions and 58,997 discarded reason bytes. These
are source-derived work counts tied to actual option counts, not instrumented
Worker counters. Other focus/build descriptions remain intact.

The reused measurement script originally named its full-versus-compact reason
difference `discardedFullReasonUtf8Bytes`. That label is accurate for the old
path but not the optimized path. The reproducible script and JSON summaries now
call it `fullReasonUtf8BytesWherePresentationDiffers`; original stdout remains
unchanged. No sample, timing or output was altered. It measures a difference
between retained presentations, not evidence of continued discarded work.

Reproduction from the example directory:

```
node --test tests/compact-generation.test.ts tests/compact-observation.test.ts
node_modules/.bin/vp lint --deny-warnings core/observation.ts core/engine.ts core/simulation/choices.ts core/simulation/trade.ts tests/compact-generation.test.ts
node --expose-gc .blabla/scratch/avoid-discarded-trade-prose/measure.mjs after
node .blabla/scratch/avoid-discarded-trade-prose/paired.mjs
```

The preserved before run predates edits; rerunning `measure.mjs before` on current
source would not reproduce historical source and must not overwrite that evidence.
Use the preserved core through the paired comparison for an honest old/new rerun.

## Decision and limits

Recommend accepting the bounded optimization after independent source review.
It preserves exact observations while removing a measured repeated formatting
cost on the larger finite fixtures. No further core cache or legality refactor is
justified here. The separately researched revision-and-time-bound paging slice
can reuse this cheaper complete projection, but paging still pays full canonical
enumeration and state handling; no paging behavior is implemented in this task.

The existing compact observation draft remains the cohesive authority for exact
options, snapshot terms, detachment and default compatibility. No new contract
or promotion is needed for unchanged outputs. Goal acceptance and deployment
remain the parent's decisions; the uncertain Verdant action is still held.
