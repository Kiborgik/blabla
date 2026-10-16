---
name: blabla-native-cooperative
description: Use when coordinating or carrying an explicitly enrolled BlaBla native experiment through the exposed collaboration tools at completed between-turn boundaries.
---

# BlaBla native cooperative host

Read [the adapter README](README.md) first; the Rust types it names are the
schema. Use this skill only for an explicitly authorized experiment. Python
cannot call `collaboration` tools, so you make those calls. Do not install
plugins, change client settings, read private session files or add credentials.

## Coordinator: prepare

1. Be the only enrolled coordinator. Create BlaBla tasks the normal way. A worker
   accepts before work and stays ACCEPTED while paused; READY is a hand-back, not a pause
2. Record the exposed `spawn_agent`, `list_agents`, `followup_task` and
   `wait_agent` contracts as the NativeToolSurface. If anything differs later,
   stop. `followup_task` can queue into a running worker; it is not compare-and-send
3. Get `new_probe_challenge(proof_id, coordinator)`. Spawn a harmless probe child
   yourself that returns ProbeReadyMarker, then answers exactly ProbeMessage with
   only the matching ProbeResponse. It never touches the product or a provider
4. Record the real spawn return as Child: copy the observed `task_name`;
   `agent_id` stays null unless a separate ID was really returned. Wait for its
   completion notification, then call `list_agents` with that name prefix and
   capture its real completed status. Never invent an idle status
5. Send the child exactly the compact ProbeMessage with `followup_task`. Record
   the transport outcome, the completion notification and a fresh completed
   status. A wait summary is not a completion
6. Save each observation with `write_observation` and build InitialIdleEvidence
   and NonceRoundTripEvidence in collection order. Never reuse an old proof
7. Enroll each accepted worker with its own spawn evidence, InitialReadyMarker
   completion and later completed status. Start the frozen run and get any
   required permit; a proof is not a permit

Save only the schema's metadata and markers, never transcripts, private reasoning
or full prompts. Each record gets a unique local ID and a rising sequence; these
are your attestations, not platform turn IDs.

## Coordinator: one pending operation

Take the runner's pending HostRequest, or fetch it with `host-next --run RUN`
(after a restart it may already be claimed). Never get around a refusal with a
new local ID.

1. Check the tool surface still matches and the request belongs to this run and
   child. Do not edit its key, brief, nonce or deadline
2. Build ClaimRequest from the SHA-256 of the complete HostRequest in canonical
   compact JSON (see the README) and the enrolled coordinator. Run
   `host-claim --request claim.json` and continue only on `claimed`. On already-claimed, timeout or missing output, reconcile;
   do not call the tool again
3. Get `host_call(request)` and make exactly that call:
   - `inspect_child`: `list_agents` with the child's task_name prefix; select only its entry
   - `continue_work`: `followup_task` with exactly the compact WorkContinuation JSON
   - `wake_worker`: `followup_task` with exactly the compact Wake JSON, nothing appended
   - `await_boundary`: the matching completion notification, or `wait_agent` until
     it arrives; a timeout or wake summary is still pending
4. Capture the NativeToolObservation from the real return. Take origin from the
   notification and the enrolled spawn mapping, never from the child's own claim;
   a name-only origin needs an exact task_name match. Keep null IDs null; unknown
   return shapes are unavailable
5. `write_observation`, then `normalize_event(request, observation, evidence)`,
   then `host-result --request result.json`. If normalization rejects it, stop
   and keep the evidence for the core
6. Advance the run. On `checkpoint_due`, use `handle_checkpoint`. The core picks
   and reserves proposals; never make one up or force advice

An idle check does not make the later send atomic. Missed events are gaps. Seen
out-of-band continuation invalidates the generation; unseen continuation earns no
completeness credit.

## Worker: completed work boundary

On WorkContinuation, use its exact key and brief and do only the accepted task.
After your final edit and check, call `capture-boundary` with that `work_key`,
your `child_attestation`, WorkerStatement values (`statement_id`, `slot` and
`text` only) and `final_boundary`. Return the emitted WorkerBoundary marker
unchanged and do no more task work. Never invent a checkpoint ID, sequence,
digest or hash. Keep the task ACCEPTED.

## Worker: wake

On Wake, run `consume` first, before any edit or check, with your enrolled task,
epoch, generation and `child_attestation`. Set `first_action_attestation` true
only if it is true. If you cannot identify the wake, stop.

- **consumed**: return AdviceResponse with the exact request, checkpoint, wake,
  consume nonce, result hash, your attestation and acknowledged or declined. Make
  no fixes in this turn
- **no_advice with completion**: return NoAdviceResponse with that completion and
  your attestation; invent nothing else
- **no_advice with null completion, I/O failure, or missing or invalid output
  (exit 4)**: keep the uncertainty, never retry consume, return control

The coordinator records your response with `record-response`. Correction counts
only through separate current task evidence. Transport, exposure, acknowledgment
and correction are four different events; none proves benefit.
