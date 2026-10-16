# Real task-role contract bindings

Author: `gpt-6-astra` (high), `bind-task-role-contract`.

## Mapping and boundaries

`bridge/task_roles.rs` exposes the owner-authored `task-role-resolution` draft
through isolated temporary projects and the actual source CLI. Construction,
reset and untouched observation allocate no fixture and invoke no Cargo. Reset
discards an existing fixture. `role_fixture_initialized` is false until real
preparation; other configuration flags are false and the additional state string
is `uninitialized`, rather than claiming malformed or valid policy.

`configured_role_fixture(kind)` accepts exactly one signed integer and selects
one of nine fixed cases with `rem_euclid(9)`. No work or allocation scales with
the magnitude of the integer. Malformed arrays, nonintegers, extra arguments and
unsigned values outside the signed range are adapter errors.

| Kind | Actual process configuration / requested role |
| --- | --- |
| 0 | Registered valid roles; unknown worker name |
| 1 | Registered valid roles; declared worker |
| 2 | No process registration, despite a conventional file; bootstrap role |
| 3 | Registered valid empty process; bootstrap role |
| 4 | Registered missing process file |
| 5 | Registered syntactically malformed process |
| 6 | Registered duplicate-role semantic failure |
| 7 | Registered non-UTF-8 process |
| 8 | Registered path is a directory, not a file |

All configuration facts come from the actual project manifest plus existing
memory parser/validator, not the case number. Preparation creates files and parses
them; it does not manufacture CLI success or a task record.

`open_requested_role` uses the exact observed fixture. Fresh task names and
disjoint per-task scopes make repeated opens exercise role admission instead of
accidentally failing on duplicate names or overlapping scope. Its explicitly
owner-authorized first-use composite prepares the default unknown-role case and
then invokes the real open. Before that action the observation is uninitialized;
the draft guards configuration-specific premises with that fact. Once prepared,
this action never replaces the fixture.

`open_registered_role` and `open_bootstrap_role` are explicit positive composite
actions: each prepares a fresh appropriate fixture, then really opens a task.
Their vocabulary does not assert that the preceding fixture had those policies.
Each open invokes `cargo run --locked --quiet --manifest-path <source>/Cargo.toml
--bin blabla -- --project <fixture> --json task open ...`.

Acceptance requires actual exit zero, the returned OPEN task and a matching
persisted task. Refusal is only exit two with structured task-category output and
no newly accepted record. Launch, malformed JSON, unexpected exits and time/output
limits stay adapter errors. Complete recursive directory/file-byte snapshots
provide `task_record_unchanged`; lock files and falsification/task files are not
excluded. Configuration is parsed again after opening and must match the captured
facts. Terminal flags reset for each recognized successful action; a failed real
invocation retains initialized configuration with no claimed decision exit.

`declared_policy_retained` is observed behavior: after real registered creation,
an outside-model acceptance produces the existing model/lens challenges; actual
allowed-model reacceptance and lens assessment remove those two challenges. It
does not claim the new task is READY or otherwise verified. Synthetic `owner`,
`allowed` and `outside` labels are fixture policy attestations, not real agent
identities. Bootstrap has no declared policy to attest and leaves this flag false.

## Evidence and limits

- Genuine missing-binding RED: task scratch
  `evidence-1-14-1792164683525387711.log`, actual adapter `unknown action:
  configured_role_fixture`; fully read, never counted as a policy refusal.
- Eight focused tests exercise all nine configurations, repeat-safe decisions,
  first use and positive composites, extreme integer kinds, malformed arguments,
  reset, legacy/bounded two-way isolation and actual runtime JSONL calls.
- A controlled Cargo sentinel proves unused legacy paths launch no nested Cargo.
  Explicit probe use trips its genuine invocation failure, returns an adapter
  error and does not claim a decision; reset returns to uninitialized state.
- Real before/after pairs are evaluated against the actual draft. Corrupted
  observation copies detect false initialization, admitting invalid/unknown
  roles, writes on refusal, refuse-all positive results and lost policy evidence.
  These are observation-level adversarial tests, not production policy mutations.
- The measured eight-test run `/tmp/task-role-bridge-eight.log` passes in 3.87 s
  under concurrent local execution. Actual runtime source startup/reset was
  1,144 ms; first requested open 108 ms, registered composite 830 ms, bootstrap
  composite 131 ms, explicit setup below 1 ms and subsequent registered open
  753 ms. Across logged calls, initial source compilation contention produced a
  1,228 ms requested open. This is finite local evidence, not a latency guarantee.

Each real action uses the existing 4,500 ms shared subprocess deadline and 2 MiB
combined-output limit per invocation; actual runtime tests retain 5,000 ms per
request. Unix timeout/output failure kills the child process group. Cold source
builds or contention can exceed the bound and remain errors. No allowance or
canonical profile changed. The final exact `cargo test --locked --test
task_role_bridge` receipt is retained in the task ledger; no global gate ran.

The source role guard and its independent review remain separate evidence. This
binding does not strengthen its filesystem atomicity claim, rewrite historical
tasks, promote the draft, complete the goal or authorize publication.
