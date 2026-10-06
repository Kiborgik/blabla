# Cooperative native host adapter

This binding joins BlaBla's core CLI to the model-side `collaboration` tools at
completed, idle between-turn boundaries. Load [the host skill](SKILL.md) in the
coordinator and cooperating workers. Python validates bounded tool projections
and calls the CLI; the skill performs the actual native tool calls.

This is an experimental cooperative protocol. It has no atomic idle-to-send
operation, platform-authenticated worker identity, in-turn interception, or
observation of arbitrary out-of-band continuations. General pause, same-task
delivery, delivery-receipt and pre-tool capabilities remain false. A successful
nonce exchange does not change those limits or authorize an experiment.

The closed wire types and authority rules live in
[the native host schema](../../docs/design/0.10-native-host-schema.md).
Do not turn a fixture, old feasibility record or unit-test return into live
capability or delivery evidence.

## Entry points

Run from the project root. In BlaBla's own checkout, the helper defaults to
`cargo run --release --quiet --bin blabla --`; source the repository's intended
toolchain environment first. An explicitly selected
`cargo run --quiet --bin blabla --` development profile also uses current source.
Installed/built binary overrides and other Cargo invocations remain rejected there.

```sh
python adapters/native/expert.py enroll --request enroll.json
python adapters/native/expert.py capture-boundary --request capture.json
python adapters/native/expert.py observe --request observe.json
python adapters/native/expert.py prepare-wake --request prepare.json
python adapters/native/expert.py consume --request consume.json
python adapters/native/expert.py record-response --request response.json
python adapters/native/expert.py invalidate --request invalidate.json
python adapters/native/expert.py start-run --request start.json
python adapters/native/expert.py advance --request advance.json
python adapters/native/expert.py host-next --run RUN
python adapters/native/expert.py host-claim --request claim.json
python adapters/native/expert.py host-result --request result.json
```

These commands forward the corresponding closed request to `expert native`,
adding `--json`, and return its tagged result. Exit zero may mean refusal or no
advice. Invalid input exits 2; uncertain I/O or durability failures exit 4.
Request files are data, never executable authority. The core owns enrollment,
budgets, deadlines, revisions, captures, permits, reservations and receipts.

After a zero-exit core process, empty, malformed, truncated or schema-invalid
stdout is exit-4 uncertainty: a mutation may already have committed. Every
operation requires its complete closed result shape, including nested payloads;
a recognized tag alone is insufficient. Malformed caller input detected before
dispatch remains exit 2. Neither failure causes an automatic retry.

In an ordinary installed project, configure an explicit executable argv if
needed. This is a JSON string array, never a shell command. Global options precede
the operation:

```sh
python /path/to/adapter/expert.py --project /path/to/project \
  --blabla-argv '["blabla"]' host-next --run RUN
```

`--timeout` bounds a single CLI process and its output collection. It does not
extend any core deadline. The helper never retries a failed mutating call. On
POSIX it terminates its own process group and reaps the process on timeout or
output overflow; no unrelated process is targeted.

## Python integration

The helper uses only the Python standard library. Import `expert.py` by path when
it is not on the import path. Its public integration functions are:

- `CoreCLI(project=None, blabla_argv=None, timeout=120)`: explicit-argv core transport
- `host_call(request)`: pure projection of one HostRequest into an actual tool
  name and its bounded arguments; it does not call that tool
- `normalize_event(request, observation, evidence)`: verify the saved observation
  bytes and produce a HostResult; worker attestation cannot supply actual origin
- `write_observation(observation, path)`: create-only project-relative evidence;
  no symlinks, replacement or silent truncation
- `new_probe_challenge(proof_id, coordinator)`: OS-random, advice-free preflight
  challenge; it creates no core run, permit or boundary nonce
- `handle_checkpoint(core, observe_request)`: call observe, then evaluate only
  its returned event through `expert checkpoint --experimental-run`. The core
  loads its frozen configuration. Returns a local `{boundary, evaluation}` pair;
  evaluation is null if observation did not succeed
- `record_receipt(core, response_request)`: forward `record-response`; it does
  not convert transport acceptance or acknowledgment into correction

`observe` on the command line only observes. The Python `handle_checkpoint`
function additionally evaluates. Native wire responses remain the core's exact
tagged results; the local orchestration pair is not a new wire schema.

All objects are strict UTF-8 JSON, at most 65,536 bytes. Duplicate keys, nonfinite
numbers, unknown projection fields/tags, malformed markers and Boolean numeric
identities are rejected. Evidence hashes are SHA-256 over exact saved bytes;
transport request hashes use the schema's canonical compact JSON. The helper
does not calculate BlaBla revision fingerprints, select policy or invent
deterministic observations.

## Evidence and recovery

The skill first obtains a fresh actual tool-surface projection and nonce proof,
then enrolls an accepted worker with actual spawn, completion and later completed
status evidence. A separate probe child may establish the nonce round trip.
Save only the closed projections, never a transcript, private reasoning,
credentials or the worker's full prompt. The historical
`.blabla/scratch/native-boundary-proof/proof.json` cannot satisfy enrollment.

At each operation the skill rechecks the exposed tool surface, obtains and claims
the core's exact pending request, calls the actual tool once and submits its
saved normalized observation. An idle result remains a candidate until core
admission checks the earlier completion and enrolled identity. An actual result
with only a canonical task name keeps `agent_id: null`; a worker-supplied name
does not fill in a missing native origin.

The wake consists solely of its compact Wake JSON. The worker must consume as
its first task-affecting action. Only consume may expose a reserved result.
There are four distinct observations: transport accepted, exposure attempted,
worker acknowledged/declined, and independently observed resolution.

- Lost host output: retain unknown state and reconcile the existing operation
- Timeout-only `wait_agent` return: no child completion; do not fabricate a marker
- Lost consume stdout or `completion: null`: possible exposure stays unknown;
  never retry consume to recover the template
- Request-bound no-advice completion: return it unchanged in NoAdviceResponse;
  it establishes non-exposure only after core-correlated receipt reconciliation
- Wrong origin, task replacement, missed boundary or unexpected continuation:
  stop and invalidate through the core using the actual evidence
- Changed tool surface, absent proof, unavailable core route or revoked permit:
  stop; do not fall back to ordinary advisory delivery

Repeated result submission may reconcile an identical saved result. A process
restart, a new report filename or an expired payload never replenishes a budget
or gives permission to repeat a claimed tool call.

## Focused verification

```sh
python3 -m unittest discover -s experiments -p test_native_expert.py
```

These are helper and transport-contract tests. Fake core returns and synthetic
native observations establish no live-host capability, provider inference,
advice exposure or benefit. A fresh actual proof, authorized run and independent
integration review are separate requirements.
