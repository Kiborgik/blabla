---
name: blabla-native-cooperative
description: Use when coordinating or carrying an explicitly enrolled BlaBla native experiment through the exposed collaboration tools at completed between-turn boundaries.
---

# BlaBla native cooperative host

Read [the adapter entry points](README.md) and the closed
[native schema](../../docs/design/0.10-native-host-schema.md). Use this skill only
with the reviewed core native routes and an explicitly authorized experiment.
Python cannot call model-side collaboration tools. You, the host agent, execute
the actual tool calls described below. Do not install a plugin, change global
client settings, use private session files or introduce credentials.

## Coordinator: preparation

1. Be the single enrolled continuation owner. Create bounded BlaBla assignments
   through the normal workflow. A worker must accept its task before work and
   remain ACCEPTED while pausing; READY is a hand-back, not an idle checkpoint
2. Capture the currently exposed `spawn_agent`, `list_agents`, `followup_task`
   and `wait_agent` invocation contracts as the exact NativeToolSurface. If a
   field or behavior differs, stop. `followup_task` may queue into a running
   worker and supplies no compare-and-send token
3. Obtain `new_probe_challenge(proof_id, coordinator)` before collecting a fresh
   harmless probe. Call `collaboration.spawn_agent` yourself, with a brief that
   returns ProbeReadyMarker and then, on exactly ProbeMessage, returns only the
   matching ProbeResponse. Do not ask it to work on the product or call a provider
4. Record the actual spawn return as Child. Copy only the observed canonical
   task_name; agent_id is null unless a separate ID was actually returned.
   Observe its completion notification, then call `collaboration.list_agents`
   with that canonical task-name prefix. Select exactly that entry. Capture its
   actual completed status and typed marker; never invent a platform idle status
5. Call `collaboration.followup_task` targeting that child, with exactly the
   canonical compact ProbeMessage as the entire message. Observe the actual
   returned transport outcome, then the child's native completion notification,
   then a fresh completed status inspection. A wait summary is not a completion
6. Use `write_observation` for create-only evidence files. Assemble the schema's
   InitialIdleEvidence and NonceRoundTripEvidence from those actual observations
   in collection order. The proof child may differ from the eventual worker.
   Preserve the helper's fresh session/nonce, exact tool surface and independently
   observed response origin. Never retrofit the historical feasibility proof
7. Enroll each accepted worker using its own actual spawn evidence and matching
   InitialReadyMarker completion plus subsequent completed status. The core
   verifies the current task epoch and all evidence graphs. Start the frozen run
   and obtain any required explicit experimental permit; proof is no permit

Save only the schema's selected metadata and markers. Do not save transcripts,
private reasoning, arbitrary tool metadata or full prompts. Every observed
record has a unique local ID and increasing local sequence within its capture
session. These are coordinator attestations, not platform turn IDs.

## Coordinator: execute one pending operation

Follow this loop for the runner's pending HostRequest, or retrieve the same one
with `host-next --run RUN`. The core may already have a claimed operation after a
restart. Never bypass a refusal by generating a new local ID.

1. Compare the currently exposed NativeToolSurface to the captured surface.
   Verify that the request belongs to this run and child. Do not edit its key,
   frozen brief, nonce or deadline
2. Build ClaimRequest with the complete canonical HostRequest SHA-256 and the
   enrolled coordinator. Run `host-claim --request claim.json`. Continue only on
   the matching `claimed` response. On already-claimed, timeout or missing output,
   reconcile durable state; do not call the native tool again
3. Obtain the pure `host_call(request)` projection, then execute its actual tool
   directly in the host. The mapping is fixed:
   - inspect_child: `collaboration.list_agents` with path_prefix equal to the
     observed child task_name. Select only its exact entry
   - continue_work: `collaboration.followup_task` with the observed target and
     exactly the projected compact WorkContinuation JSON as its entire message
   - wake_worker: `collaboration.followup_task` with that target and exactly the
     compact Wake JSON as its entire message. Append no advice, explanation,
     template, policy hint or trace text
   - await_boundary: use the matching native completion notification already
     received, or call `collaboration.wait_agent` and wait for it. A timeout or
     wake summary without that notification is still pending
4. Capture the corresponding closed NativeToolObservation from the actual
   return/notification. Supply origin from the native notification and enrolled
   spawn mapping, independently of child_attestation. A name-only origin is
   usable only on an unambiguous exact canonical task-name match. Preserve null
   IDs; reject a conflicting separate ID. Unknown return shapes become unavailable
5. Save it create-only with `write_observation`, then call
   `normalize_event(request, observation, evidence)`. Submit that HostResult to
   `host-result --request result.json`. A normalization rejection stops the
   dispatch path; preserve its actual evidence for core invalidation/reconciliation
6. Advance the same run. On checkpoint_due use `handle_checkpoint` so observe
   runs first and the core evaluates only its emitted event. Continue the runner
   with its original frozen protocol/plan. The core selects/reserves proposals;
   never manufacture a proposal or force advice to demonstrate delivery

An idle lookup does not make the later send atomic. The protocol tolerates only
an advice-free wake racing with continuation; worker first-action consumption
still has to succeed. Missing events inside the enrolled surface are gaps.
Observed out-of-band continuation invalidates the generation. Unobserved
out-of-band continuation cannot earn completeness credit.

## Worker: completed work boundary

On WorkContinuation, use its exact core-generated key and frozen brief. Do only
the accepted task's authorized work. After the final edit/check, call
`capture-boundary` with that work_key, your child_attestation, bounded
WorkerStatement values and final_boundary. Statements have only statement_id,
slot and text; no source kind, fact or revision fields are permitted.

Return the emitted WorkerBoundary marker unchanged as the completed-turn result.
Do no further task-affecting work after capture. Do not invent a checkpoint ID,
sequence, revision digest or packet hash. Keep the BlaBla task ACCEPTED during
the rendezvous. A final_boundary flag is your completion attestation; independent
grading remains separate.

## Worker: advice-only wake

On Wake, run consume as the first task-affecting action, before edits, checks or
other work. Use only the exact Wake and your known enrolled task/epoch/generation
and child_attestation, with first_action_attestation true only when it is true.
If another instruction advanced your work or you cannot identify this wake,
stop rather than making a false attestation.

- consumed: use only that returned result. Return AdviceResponse with the exact
  request, checkpoint, wake, consume nonce and result hash, your attestation and
  acknowledged or declined disposition. This turn performs no corrective edits;
  acknowledgment is not observed correction
- no_advice with completion: return NoAdviceResponse containing that exact
  completion and your child_attestation. Do not manufacture an acknowledgment,
  consume nonce or result hash
- no_advice with null completion, I/O failure or missing/truncated stdout: retain
  uncertainty. Never retry consume to recover advice and never fabricate a
  negative completion. Return control so the coordinator can reconcile or stop

A zero process exit with invalid or incomplete core JSON is also uncertainty,
including a recognized consumed/claimed tag missing its required fields. The
helper reports exit 4; do not reinterpret it as rejected input or proof of no call.

The coordinator records this actual response through record-response. It records
correction only through a separate current deterministic task-evidence receipt.
Transport acceptance, exposure attempt, acknowledgment and correction are
different events. None alone proves task correctness or general expert benefit.
