# Cooperative native host adapter

Experimental, with no shown benefit. It connects BlaBla's expert core to the
model-side `collaboration` tools (`spawn_agent`, `list_agents`, `followup_task`,
`wait_agent`) at completed, idle between-turn boundaries. The coordinator and
workers load [the host skill](SKILL.md), which makes the real tool calls; Python
validates the bounded results and calls the BlaBla CLI.

It cannot send atomically after an idle check, authenticate a worker, intercept a
turn, or see work done outside the enrolled tools. General pause, same-task
delivery, receipt and pre-tool capabilities stay false. A fixture, an old proof or
a passing unit test is never live evidence.

## Commands

Run from the project root. In BlaBla's checkout the helper runs current source
through Cargo and refuses any other argv. Elsewhere it runs `blabla` from PATH;
`--blabla-argv '[...]'` before the operation overrides that with a JSON argv,
never a shell string.

```sh
python adapters/native/expert.py enroll --request enroll.json
python adapters/native/expert.py start-run --request start.json
python adapters/native/expert.py host-next --run RUN
python adapters/native/expert.py host-claim --request claim.json
python adapters/native/expert.py host-result --request result.json
python adapters/native/expert.py advance --request advance.json
```

Also `capture-boundary`, `observe`, `prepare-wake`, `consume`, `record-response`
and `invalidate`. Each forwards one closed request to `blabla expert native --json`
and returns its tagged result.

| Exit | Meaning |
| --- | --- |
| 0 | a typed result, which may still be a refusal or no advice |
| 2 | bad input, refused by the helper or by the core |
| 4 | uncertain I/O, including malformed core output; a change may already be committed |

Nothing retries automatically. `--timeout` bounds one CLI process, not a core deadline.

Python functions (standard library only): `CoreCLI`, `host_call` (turns a request
into a tool call without making it), `normalize_event`, `write_observation`
(create-only), `new_probe_challenge`, `handle_checkpoint` (observe, then evaluate
only that event) and `record_receipt`.

## Wire contract

The Rust types in [`src/expert/native/wire.rs`](../../src/expert/native/wire.rs)
are the schema: `NativeRequest`, `NativeResult`, `HostRequest`, `HostResult`,
`Wake`, `WorkContinuation`, `NativeReceipt`, `NativePlan` and the rest.

- Every object is strict UTF-8 JSON of at most 65,536 bytes. Unknown or
  duplicate fields, unknown tags and Booleans used as numbers are rejected
- Request hashes are SHA-256 over canonical compact JSON (sorted keys, no
  spaces, UTF-8), as the helper's `encode` writes it; a ClaimRequest carries
  this hash of the complete HostRequest, never of pretty-printed output.
  Evidence hashes cover the exact saved bytes
- The core owns enrollment, revisions, permits, budgets, deadlines, reservations
  and receipts. Python never computes fingerprints or picks policy
- Experimental permits are scoped, revocable and never promotion-eligible. They
  and ordinary advisory delivery cannot stand in for each other
- Receipts keep four events apart: transport accepted, exposure attempted,
  acknowledged or declined, and resolved. Only current task evidence after a real
  change counts as resolved
- Save only the closed projections: never a transcript, private reasoning,
  credentials or a full prompt

Matched off/shadow/advisory runs:
`python experiments/expert_eval.py live --protocol P --out R --native-plan PLAN --native-projects ROOTS.json`.
It returns `pending_host` until the skill completes each host step; missing
measurements stay null, never zero. Real-response calibration:
`python experiments/expert_eval.py calibrate-live`.

## Recovery

- **Lost host output**: keep the unknown state and reconcile the existing operation
- **Lost `consume` output**: possible exposure stays unknown; never retry consume to get the advice
- **Wrong origin, replaced task, missed boundary or unexpected continuation**: stop and invalidate through the core
- **Changed tool surface, missing proof, unavailable core route or revoked permit**: stop; never fall back to ordinary advisory delivery
- **Restart, new filename or expired payload**: never refills a budget or allows repeating a claimed tool call

Focused test: `python3 -m unittest discover -s experiments -p test_native_expert.py`.
It tests the helper and transport, not live capability.
