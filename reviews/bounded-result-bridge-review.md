# Bounded-result bridge review

Reviewer: gpt-6-astra, xhigh. The reviewer authored the prospective contract, not
the bridge or its tests. This report covers the source adapter and observations;
the separately reviewed decision implementation and private race tests retain
their own evidence.

## Current verdict

No blocking source finding remains after the lazy-initialization repair. The
original finding was concrete: constructing a real CLI fixture on each legacy
reset would multiply its measured cost across the historical campaign's 152
resets. That projection was not a measured new full-profile duration. The repair
removes that unconditional work without changing the verification profile or
request budget.

Startup, reset and observation now expose an explicitly uninitialized probe and
run no nested Cargo. Named setup creates a real fixture. A first explicit close
may also prepare the genuine default current-GREEN fixture and then perform the
requested close: ordinary close succeeds, while bounded close genuinely refuses
current GREEN. This is an explicitly defined composite probe operation. Its
record-preservation comparison starts after fixture preparation, not before the
previous uninitialized observation. No prior READY/GREEN fact is invented.

The initial 519 bridge lines, adapter integration, 389 test lines and complete
subsequent lazy-initialization delta were read. Disposable
projects execute the current source CLI, real task lifecycle, focused evidence,
independent counter behavior and structure checks. The latest actual finish and
its exact stored bytes determine prior GREEN. A later RED finish remains RED even
after source repair. Wrong owner, blank reason, changed task input, carry record
and profile drift are actual disqualifying cases rather than canned outcomes.

Only exit zero with CLOSED state counts as acceptance. Only a structured task
refusal at exit two counts as refusal; launch, timeout, protocol and unexpected
errors remain adapter errors. Before/after project record and marker bytes,
relevant revision and eligibility facts are checked. Persisted basis fields are
compared against actual prior data. Refusal must leave the task unchanged.
Observation-level adversarial mutations test the draft predicates; they are not
production mutations. Sequential comparisons cannot prove the final internal
recheck under interleaving. The independent sixteen exact-core checkpoint cases
remain that evidence.

## Current focused evidence

The independent declared command `cargo test --locked --test bounded_result_bridge`
passed seven tests in 14.66 seconds. Full output was read at
`.blabla/scratch/review-bounded-result-bindings/evidence-1-2-1792162003771264518.log`.
Actual setup requests measured 1,132–1,991 ms and close requests 760–1,005 ms in
that output. These are finite local warm measurements, not a deployment latency
guarantee or a complete profile run. The passing check does not resolve the
unnecessary legacy reset cost; that historical limitation is retained here.

The author retains the absent-binding and positional-argument RED evidence.
Those failures establish missing bindings/protocol mismatch, not legitimate
policy refusals. The lazy-state and nested-Cargo sentinel tests also have genuine
RED receipts. The sentinel intercepts only the child's attempted nested Cargo;
the outer adapter still builds and runs from the real source. On the repaired
legacy path the marker stays absent and all expected protocol replies appear.

Final independent exact evidence is
`.blabla/scratch/review-bounded-result-bindings/evidence-2-2-1792162887167386564.log`:
nine tests pass in 12.74 seconds, with the full output read. It covers truthful
uninitialized state, real first-close behavior, legacy isolation, both qualified
positive modes, actual refusals, reset and draft-predicate adversarial outputs.
The author's like-for-like 15-request sequence reports 7.19 to 4.08 seconds and
2.9–3.5 ms later resets; the independent sentinel corroborates removal of nested
work, not a universal speed guarantee. A bounded standalone draft campaign is
still useful before deciding full-profile promotion cost. No publication or
project-wide GREEN is claimed by this review.
