mod delivery;
mod host;
mod wire;
pub use wire::*;
pub mod capture;
pub mod run;

pub fn validate_execution(
    record: &crate::expert::trace::TraceRecord,
) -> Result<(), crate::expert::pilot::Error> {
    use crate::expert::pilot::{Refusal, require};
    match &record.execution {
        ExecutionIdentity::Ordinary => require(record.permit.is_none(), Refusal::PermitMismatch),
        ExecutionIdentity::Experimental {
            run_id,
            experiment_id,
            arm,
            protocol_sha256,
            native_plan_sha256,
            authority,
            capability_sha256,
        } => {
            require(
                run_id == &record.request.packet.event.run_id
                    && crate::expert::pilot::identifier(run_id)
                    && crate::expert::pilot::identifier(experiment_id)
                    && [protocol_sha256, native_plan_sha256, capability_sha256]
                        .iter()
                        .all(|h| crate::expert::pilot::hex(h, 64))
                    && record.provenance == crate::expert::trace::Provenance::LocalCheckpoint,
                Refusal::IdentityMismatch,
            )?;
            if *arm == crate::expert::ExpertMode::Advisory {
                let permit = record.permit.as_ref().ok_or(Refusal::PermitMissing)?;
                permit.verify_hash()?;
                require(
                    authority.as_ref() == Some(&permit.authority())
                        && permit.spec.run_id == *run_id
                        && permit.spec.experiment_id == *experiment_id
                        && !permit.spec.promotion_eligible
                        && permit.spec.protocol.sha256 == *protocol_sha256
                        && permit.spec.native_plan.sha256 == *native_plan_sha256
                        && permit.spec.capability.host == record.request.packet.event.host
                        && permit.spec.tasks.iter().any(|task| {
                            task.task == record.request.packet.event.task
                                && task.acceptance_epoch
                                    == record.request.packet.revision.acceptance_epoch
                        })
                        && permit.spec.implementation_fingerprints
                            == record.implementation_fingerprints
                        && permit.spec.provider == record.response.provider
                        && permit.spec.bindings.iter().any(|b| {
                            b.binding_id == record.settings.binding_id
                                && b.policy_fingerprint
                                    == crate::expert::policy::policy_fingerprint(&record.settings)
                        })
                        && *capability_sha256
                            == crate::expert::calibration::canonical_sha256(
                                &permit.spec.capability,
                            )?,
                    Refusal::PermitMismatch,
                )
            } else {
                require(
                    authority.is_none()
                        && record.permit.is_none()
                        && record.mode != crate::expert::ExpertMode::Advisory,
                    Refusal::PermitMismatch,
                )
            }
        }
    }
}
pub fn replay_report(
    record: &crate::expert::trace::TraceRecord,
) -> Result<serde_json::Value, crate::expert::trace::ReplayError> {
    let result = crate::expert::trace::replay(record)?;
    if matches!(record.execution, ExecutionIdentity::Ordinary) {
        serde_json::to_value(result).map_err(|_| crate::expert::trace::ReplayError::InvalidRecord)
    } else {
        Ok(
            serde_json::json!({"kind":"experimental_replay", "execution":record.execution, "permit":record.permit,
            "trace_sha256":crate::expert::calibration::canonical_sha256(record).map_err(|_| crate::expert::trace::ReplayError::InvalidRecord)?,
            "provider":record.response.provider,"policy_fingerprint":crate::expert::policy::policy_fingerprint(&record.settings),
            "implementation_fingerprints":record.implementation_fingerprints,"result":result,"provider_calls":0,"delivery_attempts":0,"promotion_records":[]}),
        )
    }
}

use crate::expert::calibration::{self, EvidenceRef};
use crate::expert::pilot::{self, Error, Refusal, evidence, require};
use std::path::Path;

pub fn tool_surface() -> NativeToolSurface {
    let signature = |required: &[&str], optional: &[&str]| ToolSignature {
        required: required.iter().map(|s| (*s).into()).collect(),
        optional: optional.iter().map(|s| (*s).into()).collect(),
        argument_type: "string".into(),
    };
    NativeToolSurface {
        spawn_agent: signature(
            &["message", "task_name"],
            &["fork_turns", "model", "reasoning_effort"],
        ),
        list_agents: signature(&[], &["path_prefix"]),
        followup_task: signature(&["message", "target"], &[]),
        wait_agent: WaitSignature {
            required: vec![],
            optional: vec!["timeout_ms".into()],
            argument_type: "integer".into(),
            timeout_ms_min: 10_000,
            timeout_ms_max: 3_600_000,
        },
        followup_semantics: "may_queue_to_running_child_without_compare_and_send".into(),
    }
}
fn observation_valid(
    observation: &NativeToolObservation,
    coordinator: &Child,
    operation: Option<&str>,
) -> Result<(), Error> {
    observation.coordinator.validate()?;
    require(
        observation.kind == "native_tool_observation"
            && observation.schema_version == 1
            && pilot::identifier(&observation.record_id)
            && observation.coordinator == *coordinator
            && observation.operation_id.as_deref() == operation
            && observation.attestation == "coordinator_observed_native_surface"
            && pilot::hex(&observation.capture_session, 32)
            && observation.local_sequence > 0,
        Refusal::IdentityMismatch,
    )?;
    match &observation.projection {
        NativeProjection::ToolSurface { source, surface } => require(
            source == "exposed_tool_contract" && *surface == tool_surface(),
            Refusal::UnsupportedCapability,
        ),
        NativeProjection::Spawn {
            tool,
            requested_task_name,
            returned,
        } => {
            returned.validate()?;
            require(
                tool == "collaboration.spawn_agent" && pilot::opaque(requested_task_name),
                Refusal::IdentityMismatch,
            )
        }
        NativeProjection::Status {
            tool,
            path_prefix,
            selected,
        } => {
            require(
                tool == "collaboration.list_agents"
                    && path_prefix.as_ref().is_none_or(|p| pilot::opaque(p)),
                Refusal::IdentityMismatch,
            )?;
            if let Some(status) = selected {
                status_child(status)?.validate()?;
            }
            Ok(())
        }
        NativeProjection::Followup {
            tool,
            target_task_name,
            ..
        } => require(
            tool == "collaboration.followup_task" && pilot::opaque(target_task_name),
            Refusal::IdentityMismatch,
        ),
        NativeProjection::Completion { source, origin, .. } => {
            origin.validate()?;
            require(
                source == "native_completion_notification",
                Refusal::OriginMismatch,
            )
        }
        NativeProjection::NotInvoked { tool, .. } => require(
            [
                "collaboration.list_agents",
                "collaboration.followup_task",
                "collaboration.wait_agent",
            ]
            .contains(&tool.as_str()),
            Refusal::IdentityMismatch,
        ),
        NativeProjection::Unavailable { source, .. } => require(
            [
                "collaboration.spawn_agent",
                "collaboration.list_agents",
                "collaboration.followup_task",
                "collaboration.wait_agent",
                "native_completion_notification",
                "exposed_tool_contract",
            ]
            .contains(&source.as_str()),
            Refusal::IdentityMismatch,
        ),
    }
}
fn status_child(status: &SelectedStatus) -> Result<Child, Error> {
    let (name, id) = match status {
        SelectedStatus::Completed {
            agent_name,
            agent_id,
            ..
        }
        | SelectedStatus::Running {
            agent_name,
            agent_id,
        }
        | SelectedStatus::Unknown {
            agent_name,
            agent_id,
        } => (agent_name, agent_id),
    };
    Ok(Child {
        agent_id: id.clone(),
        task_name: name.clone(),
    })
}
fn completed_marker<'a>(
    observation: &'a NativeToolObservation,
    child: &Child,
) -> Result<&'a NativeMarker, Error> {
    match &observation.projection {
        NativeProjection::Completion { origin, marker, .. } if correlates(origin, child) => {
            Ok(marker)
        }
        NativeProjection::Status {
            selected: Some(status @ SelectedStatus::Completed { marker, .. }),
            ..
        } if correlates(&status_child(status)?, child) => Ok(marker),
        _ => Err(Refusal::OriginMismatch.into()),
    }
}
fn load_observation(
    root: &Path,
    reference: &EvidenceRef,
    coordinator: &Child,
) -> Result<NativeToolObservation, Error> {
    let observed: NativeToolObservation = evidence::read(root, reference)?;
    require(
        observed.record_id == reference.id,
        Refusal::IdentityMismatch,
    )?;
    observation_valid(&observed, coordinator, None)?;
    Ok(observed)
}
fn idle(
    root: &Path,
    reference: &EvidenceRef,
    spawn_ref: &EvidenceRef,
    coordinator: &Child,
    expected: &NativeMarker,
) -> Result<(NativeToolObservation, InitialIdleEvidence, Child), Error> {
    let spawn = load_observation(root, spawn_ref, coordinator)?;
    let NativeProjection::Spawn {
        returned: child, ..
    } = &spawn.projection
    else {
        return Err(Refusal::IdentityMismatch.into());
    };
    let idle: InitialIdleEvidence = evidence::read(root, reference)?;
    require(
        idle.kind == "native_initial_idle"
            && idle.schema_version == 1
            && idle.record_id == reference.id
            && idle.spawn_evidence == *spawn_ref,
        Refusal::IdentityMismatch,
    )?;
    observation_valid(&idle.completion, coordinator, None)?;
    observation_valid(&idle.status, coordinator, None)?;
    require(
        matches!(
            idle.completion.projection,
            NativeProjection::Completion { .. }
        ) && matches!(idle.status.projection, NativeProjection::Status { .. })
            && spawn.capture_session == idle.completion.capture_session
            && spawn.capture_session == idle.status.capture_session
            && spawn.local_sequence < idle.completion.local_sequence
            && idle.completion.local_sequence < idle.status.local_sequence
            && completed_marker(&idle.completion, child)? == expected
            && completed_marker(&idle.status, child)? == expected,
        Refusal::OriginMismatch,
    )?;
    let child = child.clone();
    Ok((spawn, idle, child))
}
pub(crate) fn validate_enrollment_evidence(
    root: &Path,
    enrollment: &Enrollment,
) -> Result<(), Error> {
    enrollment.child.validate()?;
    enrollment.coordinator.validate()?;
    enrollment.capability.validate()?;
    let surface = load_observation(
        root,
        &enrollment.capability.tool_surface,
        &enrollment.coordinator,
    )?;
    require(
        matches!(surface.projection, NativeProjection::ToolSurface { .. }),
        Refusal::UnsupportedCapability,
    )?;
    let (_, _, child) = idle(
        root,
        &enrollment.initial_idle_evidence,
        &enrollment.spawn_evidence,
        &enrollment.coordinator,
        &NativeMarker::Ready {
            schema_version: 1,
            run_id: enrollment.run_id.clone(),
            task: enrollment.task.clone(),
            acceptance_epoch: enrollment.acceptance_epoch,
        },
    )?;
    require(child == enrollment.child, Refusal::IdentityMismatch)?;
    let proof: NonceRoundTripEvidence =
        evidence::read(root, &enrollment.capability.nonce_round_trip)?;
    let challenge = &proof.challenge;
    require(
        proof.kind == "native_nonce_round_trip"
            && proof.schema_version == 1
            && proof.record_id == enrollment.capability.nonce_round_trip.id
            && proof.tool_surface == enrollment.capability.tool_surface
            && challenge.kind == "native_probe_challenge"
            && challenge.schema_version == 1
            && challenge.coordinator == enrollment.coordinator
            && pilot::identifier(&challenge.proof_id)
            && pilot::hex(&challenge.nonce, 32)
            && pilot::hex(&challenge.capture_session, 32)
            && challenge.nonce != challenge.capture_session,
        Refusal::UnsupportedCapability,
    )?;
    let (spawn, before, child) = idle(
        root,
        &proof.idle_before,
        &proof.spawn_evidence,
        &enrollment.coordinator,
        &NativeMarker::ProbeReady {
            schema_version: 1,
            proof_id: challenge.proof_id.clone(),
        },
    )?;
    let response = NativeMarker::ProbeResponse {
        schema_version: 1,
        proof_id: challenge.proof_id.clone(),
        nonce: challenge.nonce.clone(),
    };
    let sent = SentProtocol::Probe {
        message: ProbeMessage {
            kind: "blabla_native_probe".into(),
            schema_version: 1,
            proof_id: challenge.proof_id.clone(),
            nonce: challenge.nonce.clone(),
        },
    };
    for observation in [
        &spawn,
        &before.completion,
        &before.status,
        &proof.followup,
        &proof.response,
        &proof.status_after,
    ] {
        observation_valid(observation, &enrollment.coordinator, None)?;
        require(
            observation.capture_session == challenge.capture_session,
            Refusal::UnsupportedCapability,
        )?;
    }
    require(
        before.status.local_sequence < proof.followup.local_sequence
            && proof.followup.local_sequence < proof.response.local_sequence
            && proof.response.local_sequence < proof.status_after.local_sequence
            && matches!(&proof.followup.projection, NativeProjection::Followup { target_task_name, sent: actual, outcome: FollowupOutcome::ReturnedWithoutError, .. } if target_task_name == &child.task_name && actual == &sent)
            && matches!(
                proof.response.projection,
                NativeProjection::Completion { .. }
            )
            && matches!(
                proof.status_after.projection,
                NativeProjection::Status { .. }
            )
            && completed_marker(&proof.response, &child)? == &response
            && completed_marker(&proof.status_after, &child)? == &response,
        Refusal::UnsupportedCapability,
    )?;
    let refs = [
        &enrollment.capability.tool_surface,
        &enrollment.capability.nonce_round_trip,
        &enrollment.spawn_evidence,
        &enrollment.initial_idle_evidence,
        &proof.spawn_evidence,
        &proof.idle_before,
    ];
    let mut paths = std::collections::BTreeMap::new();
    for reference in refs {
        if let Some(prior) = paths.insert(&reference.path, reference) {
            require(prior == reference, Refusal::IdentityMismatch)?;
        }
    }
    Ok(())
}

fn correlates(actual: &Child, enrolled: &Child) -> bool {
    actual.task_name == enrolled.task_name
        && actual
            .agent_id
            .as_ref()
            .is_none_or(|id| enrolled.agent_id.as_ref() == Some(id))
}
pub(crate) fn normalize_projection(
    request: &HostRequest,
    observation: &NativeToolObservation,
    coordinator: &Child,
    expected_status: Option<&NativeMarker>,
) -> Result<HostOutcome, Error> {
    observation_valid(observation, coordinator, Some(&request.operation_id))?;
    let child = &request.key.child;
    let tool = match request.payload {
        HostAction::InspectChild => "collaboration.list_agents",
        HostAction::AwaitBoundary { .. } => "collaboration.wait_agent",
        _ => "collaboration.followup_task",
    };
    match (&request.payload, &observation.projection) {
        (
            _,
            NativeProjection::NotInvoked {
                tool: actual,
                reason,
            },
        ) => {
            require(actual == tool, Refusal::IdentityMismatch)?;
            Ok(HostOutcome::NotInvoked { reason: *reason })
        }
        (_, NativeProjection::Unavailable { source, reason }) => {
            require(
                source == tool
                    || (matches!(request.payload, HostAction::AwaitBoundary { .. })
                        && source == "native_completion_notification"),
                Refusal::IdentityMismatch,
            )?;
            Ok(HostOutcome::Unknown {
                reason: match reason {
                    UnavailableReason::ToolError => UnknownReason::ToolError,
                    UnavailableReason::AmbiguousOrigin => UnknownReason::AmbiguousOrigin,
                    _ => UnknownReason::MissingResult,
                },
            })
        }
        (
            HostAction::InspectChild,
            NativeProjection::Status {
                path_prefix,
                selected,
                ..
            },
        ) => {
            require(
                path_prefix.as_deref() == Some(child.task_name.as_str()),
                Refusal::IdentityMismatch,
            )?;
            let status = match selected {
                None => ChildStatus::Missing,
                Some(selected) => {
                    require(
                        correlates(&status_child(selected)?, child),
                        Refusal::OriginMismatch,
                    )?;
                    match selected {
                        SelectedStatus::Completed { marker, .. } => {
                            require(
                                expected_status == Some(marker.as_ref()),
                                Refusal::StaleCheckpoint,
                            )?;
                            ChildStatus::Idle
                        }
                        SelectedStatus::Running { .. } => ChildStatus::Running,
                        _ => ChildStatus::Missing,
                    }
                }
            };
            Ok(HostOutcome::ChildStatus {
                child: child.clone(),
                status,
            })
        }
        (
            HostAction::ContinueWork {
                brief,
                brief_sha256,
            },
            NativeProjection::Followup {
                target_task_name,
                sent,
                outcome,
                ..
            },
        ) => {
            let message = WorkContinuation {
                kind: "blabla_native_work".into(),
                schema_version: 1,
                key: request.key.clone(),
                brief: brief.clone(),
                brief_sha256: brief_sha256.clone(),
            };
            require(
                target_task_name == &child.task_name
                    && *sent
                        == SentProtocol::Work {
                            message_sha256: calibration::canonical_sha256(&message)?,
                        },
                Refusal::IdentityMismatch,
            )?;
            Ok(followup_outcome(*outcome, child, false))
        }
        (
            HostAction::WakeWorker { wake },
            NativeProjection::Followup {
                target_task_name,
                sent,
                outcome,
                ..
            },
        ) => {
            require(
                target_task_name == &child.task_name
                    && *sent
                        == SentProtocol::Wake {
                            message: wake.clone(),
                        },
                Refusal::IdentityMismatch,
            )?;
            Ok(followup_outcome(*outcome, child, true))
        }
        (
            HostAction::AwaitBoundary { expected_nonce },
            NativeProjection::Completion { origin, marker, .. },
        ) => {
            require(correlates(origin, child), Refusal::OriginMismatch)?;
            let value = serde_json::to_value(marker).map_err(|_| Error::InvalidInput)?;
            match marker {
                NativeMarker::Boundary {
                    run_id,
                    task,
                    acceptance_epoch,
                    child_attestation,
                    generation,
                    boundary_nonce,
                    ..
                } => {
                    require(
                        run_id == &request.key.run_id
                            && task == &request.key.task
                            && *acceptance_epoch == request.key.acceptance_epoch
                            && child_attestation == child
                            && *generation == request.key.generation
                            && boundary_nonce == expected_nonce,
                        Refusal::IdentityMismatch,
                    )?;
                    Ok(HostOutcome::BoundaryReturned {
                        origin: child.clone(),
                        marker: serde_json::from_value(value).map_err(|_| Error::InvalidInput)?,
                    })
                }
                NativeMarker::Advice {
                    run_id,
                    checkpoint_id,
                    wake_nonce,
                    child_attestation,
                    ..
                } => {
                    require(
                        run_id == &request.key.run_id
                            && checkpoint_id == &request.key.checkpoint_id
                            && wake_nonce == expected_nonce
                            && child_attestation == child,
                        Refusal::IdentityMismatch,
                    )?;
                    Ok(HostOutcome::WorkerResponse {
                        origin: child.clone(),
                        response: serde_json::from_value(value).map_err(|_| Error::InvalidInput)?,
                    })
                }
                NativeMarker::NoAdvice {
                    completion,
                    child_attestation,
                    ..
                } => {
                    require(
                        completion.run_id == request.key.run_id
                            && completion.checkpoint_id == request.key.checkpoint_id
                            && &completion.wake_nonce == expected_nonce
                            && child_attestation == child,
                        Refusal::IdentityMismatch,
                    )?;
                    Ok(HostOutcome::WorkerResponse {
                        origin: child.clone(),
                        response: serde_json::from_value(value).map_err(|_| Error::InvalidInput)?,
                    })
                }
                _ => Err(Refusal::IdentityMismatch.into()),
            }
        }
        _ => Err(Refusal::IdentityMismatch.into()),
    }
}
fn followup_outcome(outcome: FollowupOutcome, child: &Child, wake: bool) -> HostOutcome {
    match outcome {
        FollowupOutcome::ReturnedWithoutError if wake => HostOutcome::WakeAccepted {
            child: child.clone(),
        },
        FollowupOutcome::ReturnedWithoutError => HostOutcome::ContinuationAccepted {
            child: child.clone(),
        },
        FollowupOutcome::ExplicitRejection => HostOutcome::Unknown {
            reason: UnknownReason::ToolError,
        },
        FollowupOutcome::Unknown => HostOutcome::Unknown {
            reason: UnknownReason::MissingResult,
        },
    }
}

fn enrollment_observations(
    root: &Path,
    enrollment: &Enrollment,
) -> Result<Vec<NativeToolObservation>, Error> {
    let proof: NonceRoundTripEvidence =
        evidence::read(root, &enrollment.capability.nonce_round_trip)?;
    let work_idle: InitialIdleEvidence = evidence::read(root, &enrollment.initial_idle_evidence)?;
    let probe_idle: InitialIdleEvidence = evidence::read(root, &proof.idle_before)?;
    Ok(vec![
        load_observation(
            root,
            &enrollment.capability.tool_surface,
            &enrollment.coordinator,
        )?,
        load_observation(root, &proof.spawn_evidence, &enrollment.coordinator)?,
        load_observation(root, &enrollment.spawn_evidence, &enrollment.coordinator)?,
        work_idle.completion,
        work_idle.status,
        probe_idle.completion,
        probe_idle.status,
        proof.followup,
        proof.response,
        proof.status_after,
    ])
}
