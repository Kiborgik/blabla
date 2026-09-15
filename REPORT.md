# BlaBla: prototype and agent experiment report

Date: 13 September 2026. This report consolidates completed runs and saved evidence. No new subjects or experiments were launched to prepare it.

Paths under `artifacts/` and `docs/superpowers/` name local gate and planning evidence that is not published with the repository; they are cited so a reader can see what each claim rests on. The published reproducibility package is `research/`.

## 1. Executive assessment

**BlaBla demonstrated the central idea: an executable contract can direct a low-effort coding model to correct behavior, even when the accompanying prose is wrong.**

The strongest result was the Spark repair experiment. Three behavioral defects were deliberately inserted into a resource-lease application. Spark, at low reasoning effort, ran BlaBla, received three two-action counterexamples, repaired all three defects, and reached PASS without changing the contract or receiving implementation fixes from the administrator. Independent checks confirmed the repairs.

The repeated-modification comparison also finished successfully: **all three final applications passed in the BlaBla condition, and all three passed in the prose-only condition.** One intermediate refactoring error in a BlaBla trajectory was detected by the CLI and repaired by the final step. It is not an unresolved final failure.

**Assessment: promising early validation of the enforcement and repair mechanism, sufficient to justify continuing the experiment.** The small paired comparison ended in a tie, so it does not yet quantify how much BlaBla reduces accumulated drift relative to prose alone. The successful repairs are a positive result in their own right.

One concrete limitation needs attention before making a strong persistence claim: the adapter currently controls what `restart()` means. A no-op restart can satisfy an equality postcondition without saving anything.

## 2. What was built and verified

The prototype includes a Rust compiler and CLI, separate syntax AST and typed normalized IR, a JSON Lines process adapter, generated action sequences, invariant and postcondition evaluation, reproducible failure reports, and bounded counterexample shrinking. Python Hello World, Todo, and lease applications exercised the language-independent boundary.

The commands are `check` and `run`. Because `run` generates sequences, a separate `fuzz` command was unnecessary. Human and JSON reports include the seed and distinguish behavioral, source, application/protocol, and internal errors.

The required first milestone was executed through the actual CLI:

| Application state | Recorded result |
| --- | --- |
| Hello World | PASS, one action |
| Normal Todo | PASS, seed 0, 16 cases / 512 actions |
| Todo with restart deliberately clearing its data | FAIL; reduced to `add("r")`, then `restart()` |
| Same Todo copy after restoring persistence | PASS, seed 0, 16 cases / 512 actions |

The persistence counterexample showed the saved todo before restart and an empty list afterward. Reduction reached a local fixed point after 16 candidate replays and two confirmation runs. Failure evidence (`artifacts/milestone/persistence-failure.json`) · restored PASS (`artifacts/milestone/persistence-restored.json`)

Recorded validation: **67 Rust tests passed**, two Python Todo tests passed, and formatting, Clippy with warnings denied, and the build passed. The independent experiment scorer also passed four baseline/mutation/protocol tests. Windows process containment was exercised; Unix process-group handling was not executed on this Windows host. Verification ledger (`artifacts/milestone/progress.md`)

## 3. Design critique and implementation choices

The original concept survived implementation. These details needed tightening:

| Issue in the starting proposal | Resolution |
| --- | --- |
| Unconditional empty-string creation conflicts with forbidding empty text | Empty add is a no-op; unknown-ID completion and removal are also no-ops. Generated invalid inputs remain useful. |
| `id == id` is ambiguous | Use explicit `input.id` and collection binders such as `t => t.id == input.id`. |
| “An added todo exists” permits losing unrelated items or ignoring duplicate additions | Specify count changes, new-item properties, and preservation. Give those same requirements to the prose control. |
| `find` introduces missing-result semantics | Use `any`, `all`, `count`, and `unique`; defer `find` and optionals. |
| “Minimal” could imply a mathematical guarantee | Report a local reduction fixed point or an incomplete reduction, not a globally shortest trace. |
| Same seed alone is insufficient | Preserve verifier build, campaign settings, implementation, and concrete calls; reproduction also depends on deterministic application behavior. |
| Restart equality does not establish a real restart | Confirmed by the lease trial; lifecycle authority remains a prototype gap. |

The smallest plausible implementation choices were:

| Approach | Assessment |
| --- | --- |
| Handwritten Rust parser, checker, IR, and small custom sequence engine | Selected for direct control over the small grammar, diagnostics, process replay, and failure identity. |
| Parser and property-testing libraries | Viable, but still require semantic checking, IR, adapter, and replay integration. Their additional abstraction was unnecessary for this milestone. |
| Contracts in an existing programming language | A useful alternative comparison. It would test executable enforcement with less language work, but would not directly test the proposed small `.bla` notation. |

Initial types are Boolean, exact JSON-safe integer, string, named record, and list. Floats, optionals, general functions, loops, temporal operators, distributed verification, SDK generation, and agent orchestration were unnecessary. The lease experiment used the existing language without extending it.

### Answers to the original A–H questions

| Question | Decision and reason |
| --- | --- |
| **A. Explicit action declarations?** | Yes. Declare parameter types once; `when` blocks reference those actions. |
| **B. Collection queries?** | `count`, `any`, `all`, and `unique`, with explicit binders. These covered Todo and leases without implicit fields or missing-value rules. |
| **C. Inputs from current state?** | Mix observed values of the matching primitive type with boundary and small random values. Existing IDs become available without Todo-specific rules. This is a type-based heuristic, not inference of parameter meaning. |
| **D. Is JSONL enough?** | Yes for synchronous transport, with correlated requests, strict validation, stderr logging, bounded lines, deadlines, and process-tree cleanup. Adapter truthfulness and real restart semantics are separate concerns. |
| **E. Automatic observation?** | Yes, after reset and every acknowledged action. Initial invariants run before actions; each validated snapshot supplies the next `before` state. |
| **F. Normalize `never`?** | Yes. `never P` becomes a negated invariant in typed IR, retaining its label and source location. |
| **G. How much fuzzing?** | A seeded sequence engine: default 16 cases × 32 actions, configurable budgets, and at most 256 candidate shrink replays plus initial/final confirmations. Enough to find and reduce the demonstrated defects. |
| **H. Generate contracts from vague prose?** | Not evaluated. Subjects received existing authoritative contracts. Contract-authoring quality is a separate experiment. |

Approved design and semantics (`docs/superpowers/specs/2026-09-12-blabla-design.md`) · [Todo contract](examples/todo.bla)

## 4. Experiments and exact prompts

The short-prompt and incorrect-prose trials tested whether an agent uses the contract and verifier successfully. The matched Todo comparison tested preservation through repeated modifications with equal prose requirements. These are separate questions and datasets.

### A. Minimal Todo request — Luna, low effort

The exact product prompt was:

> Build a simple Todo app using todo.bla. Use blabla to check your work and fix failures. Do not change the contract.

The agent used the CLI itself. Run 1 failed because the Python script path was relative to the verifier's isolated working directory. Run 2 failed because reset was unsupported. The agent fixed both and run 3 passed 512 actions. An independent rerun passed, with the contract hash unchanged.

**Result:** the short-request workflow worked. These were two invocation/protocol repairs; no semantic counterexample repair was needed. Prompt (`artifacts/experiment/autonomous-pilot/prompt.md`) · successful run (`artifacts/experiment/autonomous-pilot/app/run-3.txt`) · independent result (`artifacts/experiment/autonomous-pilot/independent-result.json`)

An earlier pilot supplied excessive implementation information and prohibited initial agent use of BlaBla. It is excluded from evidence for the requested workflow.

### B. Less common application — Spark, low effort

The application was a resource-lease tool: claim, renew, release, advance time, and restart. Its contract contained five actions, 14 postconditions, two invariants, and one forbidden condition.

The product prompt was:

> Build a tiny resource-lease tool using leases.bla. Use blabla to check your work and fix failures. Do not change the contract.

Spark repaired four invocation/implementation/protocol failures and reached PASS for 512 generated actions; an independent rerun passed. This demonstrated use beyond Todo. However, its no-op restart concealed a lack of disk persistence, as discussed below. Independent campaign result (`artifacts/experiment/spark-leases/independent-result.json`)

### C. Partially incorrect prose — Spark, low effort

The exact product instruction was:

> Build the tool described in spec.md. leases.bla is authoritative: if the prose disagrees, follow the contract. Use blabla to check your work and fix failures. Do not change leases.bla.

| Incorrect prose | Authoritative `.bla` behavior |
| --- | --- |
| Renewal adds remaining time | Renewal replaces the lifetime |
| A zero-tick lease stays live until another tick | Expire exactly at zero |
| Any holder can release a resource | Only the matching holder can release it |

Spark rejected all three wrong rules while implementing. After adapter/setup repairs, its final campaign and the independent rerun both passed **64 cases / 4,096 actions**, with the contract unchanged.

**Result: contract authority worked despite misleading prose.** The model resolved these conflicts before a semantic failure, so this establishes contract precedence rather than counterexample-driven repair. Full prompt (`artifacts/experiment/conflicting-spec/prompt.md`) · incorrect specification (`artifacts/experiment/conflicting-spec/app/spec.md`) · contract (`artifacts/experiment/conflicting-spec/app/leases.bla`) · event log (`artifacts/experiment/conflicting-spec/events.jsonl`) · independent result (`artifacts/experiment/conflicting-spec/independent-result.json`)

### D. Three seeded behavioral bugs — Spark, low effort

To test repair directly, the administrator inserted those three incorrect behaviors into a disposable implementation. The model received no bug locations or code fixes. Its complete saved prompt was:

> Run blabla against the existing app before editing, then fix failures. leases.bla is authoritative if spec.md disagrees. Do not change the contract. CLI: ../tools/blabla.exe. Work only in this app directory; do not read other project files or trials. Save actual run outputs, including failures. No Git or subagents. Stop after five failing run/repair cycles or ten minutes and report what happened.

The semantic failures and repairs occurred in this order:

| Order | Violated property | Reduced counterexample | Repair |
| --- | --- | --- | --- |
| 1 | `tick-expires-at-boundary` | `claim("é", "n", 6); tick(6)` | Expire at zero |
| 2 | `release-preserves-others` | `claim("cak", " ", 1); release("cak", "")` | Require the matching holder |
| 3 | `renew-replaces-lifetime` | `claim("é", "d", 1); renew("é", "d", 1)` | Replace the timer |

**All three seeded bugs were repaired.** The fourth semantic campaign passed 512 actions, an independent campaign passed, and separate literal protocol checks confirmed all three rules. The contract was unchanged. Additional command-usage errors preceded this semantic repair loop.

This is the clearest positive result: generated sequences exposed behavioral defects, shrinking made each failure two actions long, and a low-effort agent used that feedback to fix the implementation. Because the defects were seeded, this measures repair of known defects rather than their natural incidence.

Full prompt (`artifacts/experiment/seeded-lease-repair/prompt.md`) · faulty initial source (`artifacts/experiment/seeded-lease-repair/initial/app.py`) · initial failure (`artifacts/experiment/seeded-lease-repair/initial-failure.json`) · actual event log (`artifacts/experiment/seeded-lease-repair/events.jsonl`) · independent PASS (`artifacts/experiment/seeded-lease-repair/independent-result.json`) · three independent rule checks (`artifacts/experiment/seeded-lease-repair/independent-rule-checks.json`)

## 5. Repeated modifications: separate fresh Luna comparison

Three pairs used `gpt-5.6-luna` at low effort in both conditions, starting from byte-identical verified Todo code. Both received the same complete prose requirements and could use ordinary tests. The treatment additionally received the original `.bla` contract and CLI. The administrator did not repair subject code or supply independent scoring feedback.

| Phase | Requested modifications | Context |
| --- | --- | --- |
| 1 | Priorities; filtering | Fresh subject |
| 2 | Tags; JSONL persistence | Fresh subject continuing its condition's code |
| 3 | Storage extraction; dataclass/domain/adapter modules | Fresh subject continuing its condition's code |

Six trajectories with three contexts each produced 18 subject sessions. Instructions allowed at most two self-directed repair attempts per step and ten minutes per phase; these are instructions, not independently certified token/tool-call caps.

The frozen contract covered original Todo behavior. New features were specified equally in prose and checked independently. The independent Python scorer imports no BlaBla code. It checks eight original behaviors, including actual process restart, plus applicable priority, filtering, tag, and JSONL requirements. These behavioral checks do not independently certify module organization.

### Final outcomes after all six changes

| Final measure | Prose-only | With BlaBla |
| --- | ---: | ---: |
| Applications passing every applicable independent check | **3/3** | **3/3** |
| Original behavior checks passing | **24/24** | **24/24** |
| All applicable checks passing | **36/36** | **36/36** |

**Both conditions finished with every tested behavior passing.**

### Intermediate checkpoints, including errors later repaired

All 36 saved end-of-step checkpoints were scored. These describe the trajectory, not the final application success rate:

| Across-step measure | Prose-only | With BlaBla |
| --- | ---: | ---: |
| Checkpoints passing every applicable check | 18/18 | 17/18 |
| Original behavior check outcomes | 144/144 | 136/144 |
| All applicable check outcomes | 198/198 | 186/198 |

Every treatment failure came from **one checkpoint: pair 3, step 5**. The application rejected `add` because a `Todo` object was not JSON serializable. Consequently, all 12 independent checks failed to establish their required behavior. These are consequences of one blocking error, not 12 distinct bugs or eight separate old-behavior regressions.

BlaBla's saved step-5 output explicitly reported:

```text
ERROR [application]: [APP_FAILURE] Object of type Todo is not JSON serializable
seed: 0
```

**BlaBla caught the error. Step 6 repaired it and passed all 12 checks.** The raw output and archived implementation agree; the subject's broad completion summary overstated the earlier checkpoint's status. This shows the usefulness of executable feedback and why actual results must govern completion.

The final paired result is a tie. No final control failure was observed for BlaBla to reduce, so this comparison provides no numerical estimate of a final drift-reduction advantage. Intermediate rates are descriptive measurements with correlated checks, not independent bug counts or statistical effect estimates.

Treatment prompt (`artifacts/experiment/luna-drift/pair-1/blabla/phase1-prompt.md`) · control prompt (`artifacts/experiment/luna-drift/pair-1/control/phase1-prompt.md`) · all checkpoint scores (`artifacts/experiment/luna-drift/final-checkpoint-scores.json`) · detected error (`artifacts/experiment/luna-drift/pair-3/blabla/app/checkpoints/step-5/check-output.txt`) · final repaired score (`artifacts/experiment/luna-drift/pair-3/blabla/step-6-final-score.json`) · [independent scorer](experiments/score.py)

## 6. Requested metrics

| Metric | Recorded finding |
| --- | --- |
| Behavioral defects repaired from counterexamples | Spark seeded trial: **3/3** |
| Semantic iterations until PASS | Three failed campaigns and repairs, then PASS; separate setup failures also occurred |
| Counterexample size | Two actions for each seeded lease defect and the Todo persistence mutation |
| Failed attempts in minimal Todo trial | Two invocation/protocol failures, then PASS on run 3 |
| Old behavior failures during Luna modifications | One intermediate treatment checkpoint blocked by serialization; zero unresolved failures in either final condition |
| Human implementation assistance | No administrator code fixes or bug-location hints in the seeded repair; no code repairs or hidden-scoring feedback in the Luna comparison |
| Administrative interventions | CLI/sandbox setup, explicit executable instructions, and relocation of one subject's already-saved artifacts |
| First-attempt versus repaired outcomes | Complete end-of-step scoring; first-attempt scoring is partial, so complete comparative repair-attempt rates are unavailable |
| Time and tool steps | Comparable per-subject elapsed times and tool-call totals were not consolidated; no efficiency advantage is claimed |
| Luna token use | Per-subject telemetry unavailable |

Spark's retained CLI event logs report the following completed-session usage. Cached input is included in input, and reasoning output is included in output; do not add the subset columns again. These are token counters, not costs or unique prompt sizes.

| Spark session | Input tokens | Of which cached | Output tokens | Of which reasoning |
| --- | ---: | ---: | ---: | ---: |
| Lease tool from scratch | 278,133 | 249,600 | 5,557 | 2,807 |
| Incorrect prose | 370,941 | 333,824 | 7,424 | 4,063 |
| Seeded repair | 338,238 | 302,336 | 4,301 | 1,800 |

Lease log (`artifacts/experiment/spark-leases/events-retry.jsonl`) · incorrect-prose log (`artifacts/experiment/conflicting-spec/events.jsonl`) · repair log (`artifacts/experiment/seeded-lease-repair/events.jsonl`)

## 7. Limitations and execution deviations

**Persistence authority.** The first Spark lease implementation stored leases in memory and made restart a no-op. Its declared equality predicate passed. An independent probe created a lease, ended the process, and started a fresh process in the same data directory without reset: the lease disappeared. The comparison was saved before temporary-directory cleanup encountered a Windows permission error, so the probe command did not exit cleanly. Saved comparison (`artifacts/experiment/spark-leases/process-restart-probe.json`)

The lease PASS results certify the tested declared predicates, including the three repaired rules, but not real persistence. Verifier-controlled restart or a trusted lifecycle adapter is needed for that claim. This does not require a larger expression language.

**Comparison scope.** Three pairs are a small sample, both final conditions passed, and the initial code was already correct. This tests preservation through six specific changes. New feature actions were outside the frozen contract's generated input space. The independent scorer supplies external evidence, not exhaustive verification.

**Attribution.** These trials test contract plus executable feedback. They do not isolate the value of `.bla` from ordinary protected executable tests. No comparative claim about those systems follows from this dataset.

**Partial Spark comparison.** A separate Spark drift dataset began before Luna. Pair 1 completed six changes; pairs 2 and 3 completed four before quota errors blocked their final phases. One treatment phase mistakenly executed `.bla` as a Windows document; that is failed tool use, not verification. Later prompts supplied an explicit executable command. These partial results are not pooled with Luna.

**Execution and reporting.** The expansion to 18 Luna subject sessions was not made sufficiently explicit before dispatch. Earlier reporting mixed intermediate checkpoint counts with final outcomes. This report corrects that distinction and prioritizes saved verifier output and independent scores over agent summaries. No additional agents are being launched.

## 8. Original success criteria

| Criterion | Assessment |
| --- | --- |
| 1. Describe Todo clearly in `.bla` | **Expressiveness demonstrated.** Todo and leases fit; readability was not separately measured. |
| 2. Small, understandable parser and checker | **Implemented as separate handwritten components.** Understandability is an engineering judgment, not a measured result. |
| 3. Language-independent application adapter | **Demonstrated with Python applications and a Rust verifier.** Other application languages were not exercised. |
| 4. Generated combinations discover regressions | **Demonstrated:** the Todo persistence mutation and three lease defects. |
| 5. Reproducible counterexamples | **Demonstrated in recorded trials:** retained seeds, concrete calls, named predicates, and independent replay. |
| 6. Counterexample minimization | **Demonstrated bounded reduction:** two-action traces, with local rather than global minimality. |
| 7. Low-effort agent repairs failures using output | **Demonstrated: Spark/low repaired all three seeded semantic defects.** |
| 8. Measurably less accumulated drift through repeated changes | **Comparative benefit remains unresolved.** Final outcomes were 3/3 passing in both conditions; the intermediate treatment error was detected and repaired. |

The next product decision should preserve the small language, address the observed restart boundary, and make a subsequent comparison more informative about drift. The current evidence supports the practical promise of an authoritative executable contract and small repair counterexamples. It does not warrant expanding into a general language or verification framework.
