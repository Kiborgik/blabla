# Independent local growth loop review

## Verdict and reviewed sources

Accept the bounded source loop and the four explicitly bound source packets, with all twelve current delivery claims remaining Partial. No new source blocker was found. This review covers Core `implement-local-growth-capacity` epoch 3, Server `persist-local-growth-capacity` epoch 3, standalone `bind-local-growth-outcomes` epoch 2 and legal predecessor `prepare-local-growth-prefix` with unchanged source and refreshed epoch-2 claims. The design report supplies settled intent; it is not independently accepted as my own source target.

The implementation delivers a real local staffing consequence in an unedited legal journey. It does not establish an applied growth release, an actual agent's Granary choice, or a public viewer outcome. The currently live University allocation choices are different evidence: for example, Vesper's actual Irrigation pause freed residents for University at 772:34. That does not prove housing growth, which remains unapplied at this review boundary.

## Deciding legal outcome

The predecessor retains 198 actual transitions through revision 198 / round 149. Its population-20 Dawnwell has five funded paid recipes allocating 15 of the 17 available residents. University has only two remaining against three required, with empty payment/output and no resource shortage. The old release retains its cap of 20 and does not offer Masonry or Granary. An equal-beat legal Irrigation-pause branch demonstrates the existing resident-allocation cause independently of the proposed housing change.

The complete new journey has 217 legal transitions, with actual release adoption, Mining prerequisite, Masonry research, paid Granary work and subsequent strategic beats. No stock, population, technology, era, terrain or scheduler field is injected into that positive path.

- Order `construction-210` pays 14 Materials and 6 Credits once and snapshots 8 required work.
- Completion `215:13`, round 161, installs Granary. Population remains 20, University remains blocked and food equals the equal-beat unbuilt control. Capacity becomes 24 without granting people or retroactive food.
- Growth `216:6`, round 162, pays exactly 11 Food for 20→21. University still uses opening population 20 and remains blocked in this beat. Granary's first ordinary food production is later than its completion.
- Revision 217 / round 163 opens with 21 people. University allocates three residents, pays 2 Credits and produces 9.75 Science, without silently pausing another recipe.
- Four growth steps reach 24 and pay 44 growth Food in addition to upkeep. Growth then stops locally; the other capital remains 20. The equal-beat unbuilt branch retains the blocked University.

This is the required completion t → paid growth t+1 → opening staffing t+2 distinction. The fixture has no installed Mine competing for the last resident, so it does not establish an additional Mine displacement outcome.

## Mechanics and compatibility inspected

`cityGrowthFacts` is the shared source for current local capacity and the next growth cost. Completed released housing buildings contribute once; an active Granary contributes nothing. The new cost is 6 + floor(current opening population / 4). This is the approved persistent-world adaptation, not an assertion that the numbers are Firaxis values.

Compatible adoption requires caught-up economy and adds retained housing with base max(20, population) to every existing town. It does not change existing population, stocks, commitments, routes, terrain or clock. Both existing land and coastal founding use the shared settlement constructor: a genuinely founded town receives base 8 while the existing three-person source transfer and costs remain intact. Legacy states retain absent housing, cap 20, cost 6 and their historical event shape.

The economy still allocates paid recipes from opening facts before producing/supplying towns. Growth is evaluated after upkeep and the existing wellbeing update, requiring local room and the shared food reserve. Construction resolves afterward. This ordering prevents completed housing or newly grown residents from retroactively funding the same opening allocation. The free Granary food joins the existing aggregate productivity calculation; no new autonomous output or population grant was added.

Observation returns detached own-town facts, or all towns for the Director. The selected capability projection returns the exact owned town or explicit null for a missing/foreign selection. It neither enumerates a second legal menu nor copies eligibility into the viewer. Actual live interpretation and its user-facing rendering remain subsequent acceptance obligations.

## Persistence and historical validation

I inspected the shared validator, strict public event parser and the actual file-backed SQLite tests. Housing metadata is required exactly after the gate and forbidden before it. Version-1 origins and bases are bounded: founded is exactly 8; legacy-adoption is an integer at least 20. Establishment cannot be in the future. Unknown/missing/malformed housing is refused.

A structured growth receipt retains exact city/civilization, round/event identity, population before/after, capacity and food payment. Validation binds event type, actor/target, town/tile and saved revision; it requires a one-person gain and the immutable version-1 food arithmetic. It does not reinterpret historical payment from later stocks, population or current housing capacity. Legacy unstructured growth events and bounded-feed trimming remain valid.

The repository commits the actual 217-frame journey, checks every state against the canonical engine, reopens the file and replays bounded three-entry pages. Concurrent identical milestone requests and later retries return the original accepted revision. Real SQLite abort triggers at transition and receipt insertion preserve every state/history/receipt row for both adoption and growth; a reopened identical retry succeeds after the synthetic fault is removed. Exact foreign/missing/active/installed Granary refusals roll back candidate due work. Corrupt saved housing or payment fails after reopen without repair writes.

The competing-CAS fixture is explicitly synthetic: it places a separately legal competing state immediately before the batch. It demonstrates that the losing batch adds no history or receipt; it is not a fully recorded live concurrent transaction. Replay is bounded to 100 pages of three entries, sufficient for the measured journeys, not an unbounded-world performance claim.

Real public paging and exact detail preserve growth216:6 and the 20→21 consequence with no invented reason, private operator data or database writes. The additional selected public-parser case is a labeled synthetic row-shape test, including strict unknown outer/nested fields and malformed arithmetic; it complements the real journey rather than replacing it.

## Standalone contract binding

The six-action `LocalGrowthProbe` reuses the pure journey and makes its provenance visible. Constructor, reset and untouched observation are lazy; independent instances and detached snapshots do not leak observations. Actual actions clear old terminal state. Adoption, completion, later allocation and founding are explicitly composite legal witnesses. `grow_with_food` advances the currently observed state by one actual scheduled beat rather than precomputing its outcome. Its before-eligibility predicate is a conservative sufficient condition, including zero damage and enough shared food for all owned towns, not a complete description of every possible growing town.

The exact payment comparison uses a declared synthetic capacity-only control, preserving opening stocks and other mechanics. That counterfactual is not presented as another canonical legal history. Opening allocation comparisons invoke the real allocator. Repeated positive growth reaches capacity, scarcity controls do not masquerade as command refusal, and the explicit missing-town action proves a real unchanged-state refusal. The four tests cover all six action names, positive predicates, reset/isolation, detachment and repeated/scarcity sequences.

The draft rules and standalone probe are still separate from shared adapter composition and a generated behavioral campaign. In particular, the positive test witnesses supply the useful outcomes; no green source log is called live delivery or full contract activation.

## Evidence and claim dispositions

I read the complete final deciding author logs, including their actual diagnostics and counts:

- Core: `.blabla/scratch/implement-local-growth-capacity/evidence-1-27-1792193179222896034.log`, 12/12 plus scoped strict lint.
- Server: `.blabla/scratch/persist-local-growth-capacity/evidence-1-2-1792193219325023329.log`, 14/14 hosted plus one selected public-parser case and strict lint.
- Binding: `.blabla/scratch/bind-local-growth-outcomes/evidence-1-27-1792193153652842025.log`, 4/4 standalone cases.
- Prefix: `.blabla/scratch/prepare-local-growth-prefix/evidence-1-17-1792191219632152545.log`, 5/5 predecessor cases. Its before-half report is historical; later Core/Server evidence supplies the after-half.

The original declared Core twelve-case file ran independently and passed 12/12; its full log is `.blabla/scratch/review-local-growth-loop/evidence-1-2-1792193593384528496.log`. The predecessor’s broad-input claim then required a receipt-only epoch-2 refresh. Its source and reports remained unchanged; existing current Core/Server/binding checks already execute that predecessor. The orchestrator amended the final combined-review continuation to an existence-only report/log check, explicitly reusing this twelve-case result. That final bookkeeping check is not additional behavioral evidence. No broad product suite or duplicate hosted campaign is requested. Historical development failures remain accurately separated: the prefix and binding missing-helper failures differ from Core's reached absent-release failures; invalid test seat, premature coastal choice and lint errors were repaired without relaxing gameplay guards.

All current target claims are accepted as Partial with their existing owners and residuals. Core and Server each cover prepared pool, inhabited empire, legible decisions and recurring decisions. Binding covers prepared pool and recurring decisions; prefix covers prepared pool and inhabited empire. The useful source outcome is local food-funded growth enabling a formerly unavailable staffed recipe. The unfinished outcome is reviewed publication/application followed by actual model choice, timed completion, paid population change, later operation and supported viewer evidence.

Masonry adds only 84 science of finite headroom. It cannot close the ongoing prepared-pool goal. The already accepted dependency-complete Animal husbandry → Wheel → Engineering/Aqueduct successor remains the concrete next branch, with real resource/site consequences required; Walls, Quarry and spoilage remain Planned. Orchestrator/root own rollout, actual actors own useful choices, Core/Server own canonical durability, and Art owns truthful capacity/payment/opening-allocation presentation. Existing clock and public-origin holds remain in force.
