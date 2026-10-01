# RTS-driven String boundary improvement

The inherited-catalog-key defects found during RTS dogfooding led to a concrete
BlaBla generator change: generic String boundaries now include `constructor`,
`__proto__` and `toString`. The bounded comparison generated all three without
contract literals naming them. It did **not** rediscover the old engine defect:
both the original and changed generator reported GREEN, 53/53 obligations, on
the buggy V7 engine at the retained seed and budget.

This is a product-code follow-on to the workflow-only snapshot in
[RTS dogfooding](rts-dogfooding.md). The RTS comparison establishes a larger input
domain. Subsequent release integration also found an existing C-example
persistence defect automatically; its distinct causal limits are recorded below.

## Product change and regression

`src/verify/generator.rs::boundary_value` extends the existing String table from
five entries to eight. It retains the empty string, `a`, a space, the combined
quote/backslash/newline string, and `é`. The three added values exercise inherited
JavaScript object names, but are ordinary strings available to every adapter;
there is no RTS-specific or adapter-specific branch.

Previously, the generic boundary/random path could not produce these keys:
the boundary table omitted them and random strings have at most five lowercase
ASCII characters. Contract literals and observed strings could still introduce
them. This change removes that dependency for these three values.

The existing
`four_thousand_ninety_six_calls_cover_boundaries_random_values_and_json_types`
test in `src/verify/generator/tests.rs` now requires all eight boundaries from
4,096 calls at seed 7. Its contract has no state, literals or postconditions and
the observation is empty. The random-string assertion is restricted to lengths
2–5 so that the newly added lowercase `constructor` cannot satisfy it instead
of a random value. The saved pre-change regression failed with exit 101 and
`missing String boundary "constructor"`.

The initial boundary-only patch left SplitMix64, category selection, observation
reuse, guidance and campaign budgets unchanged. Individual old boundaries now
receive a smaller share of boundary draws. Sequences can change across builds;
the determinism promise
in `BLA_BLA.md` is for the same repository, contracts, build, settings and seed.
Existing same-seed and different-seed tests remain part of the scoped check.

## Retained comparison

The local evidence directory is
`/workspace/shared/blabla-string-boundary-evidence`. Its existing reports and
fixtures were inspected and retained rather than rerunning a seed search.
These are local audit artifacts, not shipped repository fixtures.

- `generator-before.rs` preserves the original generator
- `before-verifier-source-hashes.json` records identical pre-change verifier
  source hashes for `blabla-clean-final` and `blabla-release`; inspection at the
  initial boundary-only hand-back found only the assigned generator and
  generator-test files changed in the release verifier tree
- `v7/` contains the buggy RTS fixture, identified by the original comparison
  plan as V7 `f8f0a8407fd86e4f3359db505242df8c1f29820e`
- `current/` contains the separately preserved fixed-engine fixture; “current”
  is its directory name, not a claim about the latest deployment
- `fixture-hashes.json` identifies both fixtures and contracts; every listed
  SHA-256 was checked against the retained bytes
- Both fixtures use byte-identical `adapters/placement.mjs`, SHA-256
  `15a6f842d19f0f08f1564e1bac67836a76b2fc8b589075683c6d9e8c99e28090`

`reconstructed-general-placement.bla` is a reconstruction, not an untouched
historical contract. It differs from `current-named-placement.bla` only by removal
of the six lines declaring the three later named inherited-key rejection
witnesses. General unknown-key rejection and no-spend/no-building-change rules
remain. None of the three keys occurs in the reconstructed contract, and the
adapter does not seed them into observations. This placement contract exposes
build and preview, not produce.

All three saved campaigns report BlaBla 0.10.0, seed 731, four cases, 64 steps,
1,000 ms timeout, shrink budget 32, and 256 actions executed, including seven
prefix replay actions. Recorded `sequences` include replay/reset
segments and must not be mistaken for a count of the four requested cases.

| Saved report | Generator | Engine | Verdict | Added-key calls |
| --- | --- | --- | --- | --- |
| `baseline-v7.json` | original | buggy V7 | GREEN, 53/53 | 0 |
| `changed-v7.json` | expanded boundaries | buggy V7 | GREEN, 53/53 | 7 |
| `changed-current.json` | expanded boundaries | fixed fixture | GREEN, 53/53 | 7 |

All three saved exit files contain 0, stderr files are empty, and reports contain
zero violations and zero unexercised obligations. The two changed-generator
reports contain identical action sequences. Their wall-clock differences are
not performance evidence. The saved reports expose settings and sequences, but
do not retain complete historical invocation argv or a full build attestation;
the source/fixture hashes and reports are the available provenance.

## Why the buggy engine stayed GREEN

`key-action-contexts.json`, produced by `replay-key-calls.py` against the unchanged
V7 adapter, records every occurrence below. Indices are zero-based positions in
the report's sequence list, not global campaign action numbers.

| Sequence/action | Call | Owned buildings before | Masking condition |
| --- | --- | --- | --- |
| 4/2 | build(`constructor`, true) | 1 | Adapter sends `(0, 0)`, outside anchor range |
| 4/5 | build(`toString`, false) | 8 | Building-cap rejection |
| 5/16 | preview(`constructor`) | 8 | Read-only placement query |
| 5/42 | preview(`__proto__`) | 8 | Read-only placement query |
| 6/4 | build(`__proto__`, false) | 8 | Building-cap rejection |
| 6/44 | build(`constructor`, true) | 8 | Building-cap rejection |
| 7/12 | build(`toString`, true) | 8 | Building-cap rejection |

The adapter forwards unknown kinds to the engine; it does not filter away the
defect. The five build calls were rejected in these particular states, and the
two preview calls do not purchase anything. The retained replay shows unchanged
food and building state for all seven. Source inspection confirms the V7
placement capacity and anchor guards. No generated call combined an inherited
key with the below-capacity, in-range build state needed to expose the defect.
The placement campaign says nothing about the separate produce path.

## Fixed-engine check and next-development benefit

The retained `fixed-generated-keys.mjs` takes the three distinct keys directly
from `changed-v7.json`. For each key it creates a fresh fixed-engine World at
seed 731, starts it with AI disabled, grants 999 food, and tests build at
`(250, 385)` and produce through the owned completed hatchery. These six directed
checks are deliberately below capacity. `fixed-generated-keys.json` records
rejection and unchanged serialized world state for all six; its exit file is 0.
This is a directed fixed-engine acceptance check using generated values, not an
automatically generated discovery sequence or a new before/after defect proof.

For the next String-taking feature, these keys can enter generic generation
without first being written into its contract or observed state. That capability
is demonstrated by the isolated regression and by the seven real-adapter calls.
Whether a later feature's contract and generated state/action combinations expose
a defect remains unmeasured. Named witnesses and independent review are still
needed; no speed, rework, general coverage or later-feature outcome is claimed.

## Subsequent C-example contract finding

The combined release gate then found a real persistence violation in the C todo
example at its unchanged canonical profile: seed 0, four cases, 32 steps per
case, 1,000 ms timeout and shrink budget 256. The run reported RED after 52
actions and reduced its 20-action failing sequence to:

```text
add(" ")
restart()
```

`todo::persistence` expected the one space-only record and observed an empty
list. The original gate log and complete status report are preserved as
`c-example-before.log` and `c-canonical-before-status.json` in the task scratch
directory. This is an automatic contract finding, unlike the still-GREEN
historical RTS comparison.

The defect was in `examples/todo-c/main.c::store_load`: the trailing whitespace
directive in `fscanf(file, "%lld %d %zu\n", ...)` consumed payload-leading
whitespace as well as the header separator, before the length-based `fread`.
Direct process probes also showed leading text corruption and consumption of a
subsequent record's header. The repair removes that whitespace directive and
requires exactly one newline byte after the three header fields. Payload bytes,
the on-disk format and the canonical profile are unchanged.

`experiments/test_todo_c.py` compiles the actual C example and adapter. Its two
tests cover whitespace-only, leading/trailing whitespace, embedded newline,
Unicode, multiple records, completed state, repeated process restarts and
append-after-restart. Before the repair, they reported six failures; after the
repair, both passed. The retained test reports are `c-regression-red.log` and
`c-regression-green.log` with their actual exit files.

The triggering space was already in the original boundary table. Adding the
three mapping keys changed the generated sequence, which exposed this old
persistence bug during release integration. No new mapping key directly caused
the minimized failure, and this single finding does not establish a general
coverage gain, a speed improvement or a completed later-feature outcome.

## Guided preparation follow-on

The same release gate also exposed a coverage gap in the existing lease campaign:
seed 1234, one case and 64 steps returned YELLOW, 54/55 obligations. The missing
`missing-release-noop/root.invalid.2.0` witness requires a nonexistent resource
paired with an existing holder. This was not a lease-application violation.
The exact repeated run and its missing witness are preserved in
`leases-yellow.json`; the original integration failure is retained in
`integration-rust-before.log`.

`src/verify/generator/guidance.rs::candidate` previously remembered the source
record when choosing an existing identity, but lost it when deliberately
generating a missing identity. Its related string/optional parameters could
then independently become invalid too, preventing the intended single-fault
witness. The narrow correction remembers a source record on that branch and
preserves its compatible string/optional companion values. Normal wrong-owner
generation and the generic random path remain available. No lease-specific
name or value, coverage obligation, reset schedule, seed or campaign budget
was changed.

The new generic regression
`a_deliberately_missing_identity_preserves_its_companion_fields` first failed
because a missing item was paired with `constructor` instead of its observed
owner. After the correction, all 34 verifier unit tests passed and the unchanged
`lease_campaign_checks_generated_action_combinations` test passed, still
requiring GREEN for the entire contract. The retained reports are
`identity-regression-red.log` and `identity-lease-after.log`, with actual exit
files. These checks establish this relationship-preservation behavior and the
original lease case; they do not guarantee every finite campaign reaches every
witness. The earlier three RTS reports predate this guided-preparation change
and were not rerun or relabeled as results from the final combined code.

## Scoped hand-back verification

The declared current-source check is:

```sh
cargo test --release --lib verify:: &&
cargo test --release --test leases lease_campaign_checks_generated_action_combinations -- --exact &&
python -m unittest discover -s experiments -p test_todo_c.py &&
cargo run --release --quiet --bin blabla -- --project examples/todo-c finish &&
rustfmt --check --edition 2024 src/verify/generator.rs
```

Its complete output and actual exit are retained in
`.blabla/scratch/generate-mapping-key-boundaries/follow-on-check.log` and
`follow-on-check.exit`, with the result recorded through `blabla task evidence`.
The historical red regression remains `regression-red.log` and
`regression-red.exit` in the local evidence directory. No whole-repository gate, broad
benchmark, seed sweep, RTS source change or native-expert change belongs to this
hand-back; the C example's canonical run is the explicitly assigned integration
check. READY is a request for independent review, not project completion.
