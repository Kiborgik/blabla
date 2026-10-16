# Independent connected-catalogue review

Reviewer: gpt-6-astra/high, task `review-connected-history-catalogue`. Creative authored the catalogue and its rationale. I authored several underlying simulation features, including the narrow productive-research correction, but did not author these full-history records. This is an independent design acceptance review, not an engine, balance, deployment or whole-game-playthrough audit.

The actual `review` phase was started prospectively with worker key `advance_civilization_core`. Earlier work is not backfilled into that phase. Only this report is edited by the reviewer.

## Scope and evidence

I inspected the canonical JSON records by system family, their human-readable rationale, the declared delivery boundary and capability plan, the original structural diagnostic, the current content/release seams, and the actual research-bank diagnosis. The initial design contains 420 entries across 22 kinds, including 65 technologies, 36 civics, 69 buildings and exactly five victory families. Independent reference inspection found no unknown IDs among 496 prerequisite references, 496 unlock references or 646 reverse-use references; all 420 records belong to a proposed capability group. This does not turn descriptive text into executable semantics.

I read the retained official Civilization VI manual extracts for science/research, culture/civics, governments/policy slots and victory at pages 107–111, 122–123 and 147–148, plus Gathering Storm pages 3–4, 6–7 and 12. They support the declared baseline: separate scientific and cultural progression, per-city productive choices, government slots, capital/culture/Mars paths, and explicitly selected Congress, power, climate and strategic-stock extensions. The design clearly identifies its independent actors, separate clock, conserved population, federation/economic victories and sustained Mars colony as adaptations. Original provisional quantities are not passed off as Firaxis tuning. The two NASA references motivate life support and water; this review does not certify engineering realism or audit all pages of either manual.

The tiny declared Python check verifies unique record IDs only. Its successful exit cannot settle the semantic findings below, prove supply feasibility over a complete run, or mark any applied-world goal Delivered. No engine suite is run for this review.

## Four concrete findings from the single pass

1. **Evacuation manifest:** `project.mars-evacuation` initially funds only six food and six oxygen, with no water, while offering up to six residents an eight-beat journey. `rule.space` requires 0.5 of each food/water/oxygen per person per beat. The crew project correctly funds 24 of each for the same maximum journey. Rescue must use an exact adequately funded manifest, retain boarded counts and preserve unused supplies.
2. **First civic bootstrap:** `action.choose-civic` initially requires completed `civic.code-of-laws`, although that is the first paid civic selected through the same action. A general prose compatibility bridge does not specify a free first completion for a fresh run. Selection needs access through the released civic lane/rule, with the civic's own prerequisites checked afterward.
3. **Military declaration:** `rule.combat` and `action.attack` require war already declared, while the original 24 action records contain no declaration transition. A concrete target/mode/ceasefire/grievance operation is needed before the proposed military journey is actionable.
4. **Disbursed loan cancellation:** `agreement.loan` initially inherits the generic cancellation rule stopping future obligations. Applied after the 20-credit principal transfer, that would erase the retained 22-credit repayment without default. Pre-settlement withdrawal and post-settlement debt must be distinguished; later repayment or explicit creditor-approved restructuring/forgiveness may settle it.

These are recorded as findings 1–4, shared as one correction batch with the author and orchestrator. They are correctness and reachability issues, not requests to widen runtime scope. Final resolution is recorded below after reading the author's bounded corrections.

## Coherent dependency and supply paths

The six existing era indices remain stable, and research era is descriptive rather than an extra selection gate. Minimum-era restrictions apply explicitly to construction. The milestone design avoids its most important circular gates: coastal founding and the era-zero Boat yard can establish connected-world evidence; era-two foundries can establish industrial output before factories; era-three powered broadcasting can establish the planetary milestone before era-four buildings; era-four Spaceport/Launchpad, electronics, satellite and Moon projects precede the space milestone. Researching a later-named discovery does not itself raise the civilization's era.

The Earth-to-Mars supply chain has a concrete pre-Mars path. Chemistry-era coastal water treatment uses already available electricity and credits. Rocketry-era propellant production uses that Earth water and power and also yields oxygen. Electronics and habitat-parts have Earth manufacturing chains. The later survey does not require a resource obtainable only after a successful Mars colony. Uncrewed module setup reserves are separately paid from the crew's transit rations; the departure gate requires landed arrival reserves after setup consumption. Exact arrivals, conserved residents and actual later life support remain mandatory future witnesses.

Power is explicitly a new local flow, separate from the existing stored Energy resource. The design requires a generation/allocation interpreter rather than pretending the current opening-stock allocator already handles it. Terrain/deposit migrations preserve the original map; river effects require actual new river data. Resource access agreements and physical cargo need their own versioned interpreters, while existing abstract route receipts stay historical. Those boundaries make the proposed data useful without claiming it can already run.

## Five distinct victory paths

- **Mars:** actual arrivals, at least six conserved residents, twelve supplied beats, local food/water/oxygen contribution and retained evacuation capacity. Module construction flags alone cannot win.
- **Federation:** at least three independent consenting members, funded public goods, legitimacy/wellbeing thresholds and exit rights over twelve beats. A proposal or forced membership is insufficient.
- **Culture:** identified works, parks, performances and permitted target-specific visits against every rival's domestic tourist defense over four beats. Culture stock and population are separate.
- **Economy:** actual due deliveries, three external partners, fulfillment and fixed-price external-value share over twelve beats; defaults, self-trades and wash trades cannot create victory. The loan correction is necessary to preserve this obligation accounting.
- **Military:** sustained control of the five original capitals with supplied garrisons and occupation legitimacy, with liberation/recapture possible. The declaration correction supplies its missing legal entry point.

These are distinct designed predicates with prerequisites and counterplay. Final typed implementation must make valuation tables, local-power allocation, colony staffing and transport capacity explicit and demonstrate legal journeys. Their provisional balance and complete-run attainability are not established by this finite review. In particular, a reference DAG is not a simulation of all simultaneous supplies or diplomatic choices.

## Delivery and next use

The design is a prepared implementation input. Its original dated live snapshot remains historical; the current source and inhabited world are separate. Every designed card still says its proposed version is unapplied. The next bounded content branch should use the named Mining/Writing/Currency records together with their actual mine/library/market consequences and required shared interpreters, rather than importing labels alone. The present legal coastal and productive-research source witnesses retain their separate publication, activation and real-agent outcome obligations.

## Targeted corrections and final verdict

The corrected design contains 422 records, retaining the original 420 and adding explicit denouncement and declaration cards. I read all four corrected records, their corresponding handbook text, the revised structural diagnostic and the complete author parse receipt `evidence-6-16-1792179356207015003.log`. The original finding chronology remains above.

1. Rescue now reserves 24 each of food, water and oxygen: six residents × eight beats × 0.5 per resource. The one-to-six actual cohort consumes its exact rations, and unused prepaid supplies arrive once as cargo. Twelve propellant is explicitly provisional Mars-departure tuning, separate from the Earth crew package; the rescue compact cannot create a second free credit.
2. Civic selection requires `rule.research-flow` and the applied civic lane, then checks the chosen civic's own eligibility. Code of laws can be the first target without fabricating its prior completion.
3. Denouncement records an exact met rival and round. Formal declaration requires five retained strategic beats of notice; surprise/formal/liberation have explicit 30/15/0 grievances and exact grounds. Declaration and grievances commit once, attacking stays separate, and the ten-beat peace protection survives cancellation.
4. Withdrawal is limited to before principal settlement. Disbursed principal retains the exact 22-credit obligation and due round through unilateral cancellation; actual repayment or explicit creditor-approved restructuring/forgiveness changes it, with historical amounts preserved.

These changes address findings 1–4 without broadening runtime scope. No remaining bounded design blocker was found. The current unique-ID check is the review's only executed acceptance check; its exact receipt is recorded in the task. The additional supply and bootstrap conclusions above are source review, not results from that check.

The target's current claim observation and both source files correctly state 422 records. Its JSON artifact-reference context still says 420, a stale descriptive caption inherited from the initial version; this review explicitly corrects that caption to 422 and does not treat it as a different artifact or additional record set.

I accept the target's Delivered claim for the full designed catalogue and its Partial claim for the useful applied research/building pool. This accepts an implementation input with provisional tuning, not deployment, activation, balance or a complete legal run. The dated exhausted-world observation remains historical, and the applied pool obligation still requires actual available choices and useful consequences. No additional broad design exercise or whole-catalogue engine implementation is requested.
