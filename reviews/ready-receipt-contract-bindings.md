# READY receipt contract bindings

Author: actual `gpt-6-astra` / high, 2026-10-16. Task: `bind-ready-receipt-contract`.
The owner controls the draft and promotion; this packet implements its observations
and actions without changing the reviewed production receipt policy.

## Actual boundary and evidence

`bridge/ready_receipts.rs` creates isolated temporary projects and invokes the
current source through `cargo run --locked --quiet --manifest-path ... --bin blabla`.
Every READY fixture opens and accepts a real task, executes a Python check that
reads the source and increments a check counter, records explicit claims, challenges
and hands back through actual CLI commands. Review fixtures also create an actual
review-of relation. No successful evidence, GREEN status or READY state is authored.
The project is structure-only; preservation of an absent status record is distinct
from the persisted canonical-status coverage in the production integration tests.

The first prospective adapter test failed with `unknown action:
ready_receipt_fixture`, preserved in `/tmp/ready-bind-red.log`. The source adapter
then passed its positive test. The expanded matrix passed seven tests and failed
one runtime launcher fixture because it omitted `--manifest-path` while AppSession
runs in an isolated directory (`/tmp/ready-bind-expanded.log`). The temporary
String/OsString correction failure is retained in `/tmp/ready-bind-runtime.log`.
With the absolute manifest supplied, `/tmp/ready-bind-runtime-fixed.log` passes the
actual existing-budget sequence. `/tmp/ready-bind-lazy.log` passes the hostile-Cargo
startup/error-boundary check. These fixture corrections do not change product policy.

The deciding task check is `cargo test --locked --test ready_receipt_bindings`.
It contains nine tests, including the real adapter protocol, finite cases, both
identity-retention paths, isolation, lazy reset, strict arguments, dependency errors
and existing-runtime budget. The task's current recorded evidence is the authority
for the final whole-suite result; earlier logs remain preserved.

## Observations and actions

- Constructor, reset and untouched observe create no CLI project and launch no
  nested Cargo. `ready_receipt_fixture_initialized=false` distinguishes absence of
  a fixture from an observed ineligible task. First explicit receipt/closure use
  prepares a genuine default fixture; later actions operate on that same fixture.
- `ready_receipt_fixture(kind)` selects `kind.rem_euclid(12)`, with no input-sized
  allocation or loop. It establishes a real task and clears prior action flags.
- `ready_receipt_eligible` uses actual persisted state/accepted model, the registered
  process parser and permitted models, `task::tracked_readiness`, registered goal
  resolution and CLI recursive review-current observations. It is never set from
  the fixture number or the eventual command result. The fixed supplied claims are
  valid payloads against those fixture observations.
- Both refresh actions execute their exact CLI command. Success requires exit 0,
  a task response and agreement with the persisted record. Only exit 2/category
  `task` is a decision refusal. Invocation/schema errors, invalid JSON, signals,
  timeout and output overflow remain adapter errors.
- Preservation fields compare real before/after records and the complete fixture
  tree. The permitted change set is the one supplied claim, cleared challenge,
  ordinary current-writer stamp and monotonically retained observed identities.
  The writer stamp is captured from the same source CLI's actual fixture record;
  it is provenance, not authentication. No implicit disposition is added.
- Every fixture has an actual unresolved finding. `check_refreshed_closure` submits
  the real owner close command and compares its refusal and unchanged bytes. This
  provides a concrete surviving closure blocker, not proof about every possible
  future blocker. The source integration suite covers the other closure boundaries.
- Final-reread race resistance remains supported by the reviewed private exact-core
  tests. Sequential bridge comparisons do not claim to execute those races.

## Finite cases

| Kind | Actual prepared condition |
| --- | --- |
| 0 | READY with current check and real unresolved finding |
| 1 | Real reacceptance, so ACCEPTED and new-epoch evidence missing |
| 2 | Changed source input |
| 3 | Different requested model |
| 4 | Registered role now permits a different model |
| 5 | Review target actually reaccepted |
| 6 | Registered process file missing |
| 7 | Newly declared, still-unclaimed policy identity |
| 8 | Policy observed by an actual reflection refresh, then removed |
| 9 | Source check input removed |
| 10 | Current genuine review task |
| 11 | Historical writer metadata changed on a real READY record |

Kind 11 is explicitly a metadata fixture; it invents no successful check or result.
Kinds 7 and 8 demonstrate that an observed obligation remains missing until an
explicit disposition accounts for it. Both receipt kinds preserve that obligation.
Tests exercise repeated calls, signed integer extremes, malformed arguments and
2-way isolation from legacy structure, role and bounded-result probes.

## Measured local cost and limits

The intermediate finite run measured 34 explicit setups at 701–1713 ms, receipt
calls at 154–826 ms (including first-use setup), and closure calls at 159–866 ms.
The corrected seven-action AppSession sequence used the unchanged 5000 ms request
allowance: startup/reset 69 ms; first-use disposition 878 ms; reflection 175 ms;
closure check 170 ms; review setups 1370 and 1400 ms; later calls 165 and 176 ms.
All nested source invocations share one 4500 ms action deadline, a 2 MiB output
bound and process-group termination on overflow/timeout. Cold source compilation
can still exhaust that budget and is reported as an adapter error, never a refusal.

152 unused constructions/observations took below one millisecond at the printed
resolution. The hostile-Cargo test independently checks absence of nested startup
invocation and distinguishes active dependency failure. Timing is local evidence,
not a strict wall-clock performance claim or a full canonical-profile estimate.
Explicit real-CLI setup remains materially costlier than pure probes; lazy reset
avoids that cost for legacy campaigns that never use this draft. No profile, seed,
action count, timeout, gate or draft status was changed.
