#[cfg(target_os = "linux")]
#[path = "support/cli.rs"]
mod cli;
use blabla::expert::native::{Child, WorkerStatement, decode};

#[test]
fn native_inputs_cannot_upgrade_statements_or_fabricate_child_ids() {
    let statement = br#"{"statement_id":"s1","slot":"evidence","text":"check passed"}"#;
    assert!(decode::<WorkerStatement>(statement).is_ok());
    for extra in ["kind", "fact", "capture", "observed_revision"] {
        let mut value: serde_json::Value = serde_json::from_slice(statement).unwrap();
        value[extra] = serde_json::Value::Null;
        assert!(decode::<WorkerStatement>(&serde_json::to_vec(&value).unwrap()).is_err());
    }
    let child = decode::<Child>(br#"{"agent_id":null,"task_name":"/root/work"}"#).unwrap();
    assert!(child.validate().is_ok());
    assert!(decode::<Child>(br#"{"task_name":"/root/work"}"#).is_err());
    assert!(
        Child {
            agent_id: Some("/root/work".into()),
            task_name: "/root/work".into()
        }
        .validate()
        .is_err()
    );
}

#[test]
fn duplicate_fields_wrong_versions_and_oversized_wakes_are_rejected() {
    use blabla::expert::native::{MAX_NATIVE_BYTES, Wake};
    for bytes in [
        br#"{"agent_id":null,"task_name":"/root/a","task_name":"/root/b"}"#.to_vec(),
        br#"{"agent_id":null,"task_name":"/root/a"} trailing"#.to_vec(),
        vec![b' '; MAX_NATIVE_BYTES + 1],
    ] {
        assert!(decode::<Child>(&bytes).is_err());
    }
    assert!(decode::<Wake>(br#"{"kind":"blabla_native_wake","schema_version":2,"run_id":"r","checkpoint_id":"c","wake_nonce":"00112233445566778899aabbccddeeff"}"#).is_err());
    assert!(decode::<Wake>(br#"{"kind":"blabla_native_wake","schema_version":1,"run_id":"r","checkpoint_id":"c","wake_nonce":"00112233445566778899aabbccddeeff","advice":"Read this"}"#).is_err());
}

#[test]
fn missing_or_corrupt_accounting_never_becomes_a_new_run() {
    use blabla::expert::{
        native::run,
        pilot::{Error, Refusal},
        trace::{TraceLimits, TraceStore},
    };
    let root = tempfile::TempDir::new().unwrap();
    let directory = root.path().join(".blabla/expert");
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("experimental.initialized"), "").unwrap();
    let store = TraceStore::new(root.path(), TraceLimits::default()).unwrap();
    assert!(matches!(
        run::host_next(&store, "run"),
        Err(Error::Refused(Refusal::StorageMissing))
    ));
    std::fs::write(directory.join("ledger.json"), "{corrupt").unwrap();
    assert!(matches!(
        run::host_next(&store, "run"),
        Err(Error::Refused(Refusal::StorageCorrupt))
    ));
    assert_eq!(
        std::fs::read_to_string(directory.join("ledger.json")).unwrap(),
        "{corrupt"
    );
}

#[cfg(target_os = "linux")]
mod linux_runtime {
    use super::*;
    use blabla::expert::{
        CheckpointKind, ExpertMode, HostCapabilities,
        calibration::{self, EvidenceRef},
        native::*,
        pilot::{Budgets, Phase, evidence},
        trace::{RuntimeConfig, TraceLimits, TraceStore},
    };
    use blabla::project::{self, task};
    use serde::{Serialize, de::DeserializeOwned};
    use serde_json::json;
    use std::collections::BTreeMap;

    struct NativeFixture {
        root: tempfile::TempDir,
        project: project::Project,
        enrollment: Enrollment,
        plan_ref: EvidenceRef,
        protocol_ref: EvidenceRef,
        plan: NativePlan,
    }
    fn save(root: &std::path::Path, id: &str, value: &impl Serialize) -> EvidenceRef {
        let path = format!(".blabla/fixtures/{id}.json");
        std::fs::create_dir_all(root.join(".blabla/fixtures")).unwrap();
        let bytes = serde_json::to_vec(value).unwrap();
        std::fs::write(root.join(&path), &bytes).unwrap();
        EvidenceRef {
            id: id.into(),
            path,
            sha256: calibration::sha256(&bytes),
        }
    }
    fn actor(name: &str) -> Child {
        Child {
            agent_id: None,
            task_name: name.into(),
        }
    }
    fn observed(sequence: u64, projection: NativeProjection) -> NativeToolObservation {
        NativeToolObservation {
            kind: "native_tool_observation".into(),
            schema_version: 1,
            record_id: format!("record-{sequence}"),
            coordinator: actor("/root"),
            capture_session: "a".repeat(32),
            local_sequence: sequence,
            operation_id: None,
            attestation: "coordinator_observed_native_surface".into(),
            projection,
        }
    }
    fn completion(sequence: u64, child: &Child, marker: &NativeMarker) -> NativeToolObservation {
        observed(
            sequence,
            NativeProjection::Completion {
                source: "native_completion_notification".into(),
                origin: child.clone(),
                marker: marker.clone(),
            },
        )
    }
    fn status(sequence: u64, child: &Child, marker: &NativeMarker) -> NativeToolObservation {
        observed(
            sequence,
            NativeProjection::Status {
                tool: "collaboration.list_agents".into(),
                path_prefix: Some(child.task_name.clone()),
                selected: Some(SelectedStatus::Completed {
                    agent_name: child.task_name.clone(),
                    agent_id: child.agent_id.clone(),
                    marker: Box::new(marker.clone()),
                }),
            },
        )
    }
    fn convert<T: DeserializeOwned>(value: &impl Serialize) -> T {
        serde_json::from_value(serde_json::to_value(value).unwrap()).unwrap()
    }
    impl NativeFixture {
        fn new(run_id: &str) -> Self {
            let root = tempfile::TempDir::new().unwrap();
            std::fs::create_dir(root.path().join("workspace")).unwrap();
            for (path, text) in [
                (
                    "project.bla",
                    "project NativeFixture\nknowledge \"knowledge.bla\"\nprocess \"process.bla\"\n",
                ),
                (
                    "knowledge.bla",
                    "knowledge \"review\" { purpose \"Bounded review.\" }\njudgment \"claim-support\" { pack \"review\" purpose \"Check support.\" question \"Is the claim supported?\" criteria \"Read claim.\" requires [\"claim\"] optional [\"task\"] output \"noul\" proposition \"Claim holds.\" templates [\"ask-owner\"] }\njudgment \"proposal-check\" { pack \"review\" purpose \"Check proposal.\" question \"Is proposal sound?\" criteria \"Read proposal.\" requires [\"proposal\"] optional [\"task\"] output \"noul\" proposition \"Proposal holds.\" templates [\"ask-owner\"] }",
                ),
                (
                    "process.bla",
                    "role \"worker\" { purpose \"Work.\" }\nbinding \"one\" { judgment \"judgment::review::claim-support\" roles [\"worker\"] checkpoints [\"turn-end\"] }\nbinding \"two\" { judgment \"judgment::review::proposal-check\" roles [\"worker\"] checkpoints [\"turn-end\"] }",
                ),
                ("input.txt", "before"),
            ] {
                std::fs::write(root.path().join(path), text).unwrap();
            }
            let project =
                project::load(project::read_manifest(&root.path().join("project.bla")).unwrap())
                    .unwrap();
            let task = task::Task {
                name: "work".into(),
                role: "worker".into(),
                statement: "Make the bounded edit.".into(),
                state: "accepted".into(),
                scope: vec!["input.txt".into()],
                check_inputs: vec!["input.txt".into()],
                acceptance_epoch: 1,
                ..Default::default()
            };
            task::write(root.path(), &task).unwrap();
            let coordinator = actor("/root");
            let child = actor("/root/work");
            let probe = actor("/root/probe");
            let surface = observed(
                1,
                NativeProjection::ToolSurface {
                    source: "exposed_tool_contract".into(),
                    surface: tool_surface(),
                },
            );
            let surface_ref = save(root.path(), &surface.record_id, &surface);
            let spawn = observed(
                2,
                NativeProjection::Spawn {
                    tool: "collaboration.spawn_agent".into(),
                    requested_task_name: "probe".into(),
                    returned: probe.clone(),
                },
            );
            let spawn_ref = save(root.path(), &spawn.record_id, &spawn);
            let ready = NativeMarker::ProbeReady {
                schema_version: 1,
                proof_id: "proof".into(),
            };
            let idle = InitialIdleEvidence {
                kind: "native_initial_idle".into(),
                schema_version: 1,
                record_id: "idle-probe".into(),
                spawn_evidence: spawn_ref.clone(),
                completion: completion(3, &probe, &ready),
                status: status(4, &probe, &ready),
            };
            let idle_ref = save(root.path(), &idle.record_id, &idle);
            let response = NativeMarker::ProbeResponse {
                schema_version: 1,
                proof_id: "proof".into(),
                nonce: "b".repeat(32),
            };
            let proof = NonceRoundTripEvidence {
                kind: "native_nonce_round_trip".into(),
                schema_version: 1,
                record_id: "proof-evidence".into(),
                tool_surface: surface_ref.clone(),
                spawn_evidence: spawn_ref,
                idle_before: idle_ref,
                challenge: ProbeChallenge {
                    kind: "native_probe_challenge".into(),
                    schema_version: 1,
                    proof_id: "proof".into(),
                    coordinator: coordinator.clone(),
                    capture_session: "a".repeat(32),
                    nonce: "b".repeat(32),
                },
                followup: observed(
                    5,
                    NativeProjection::Followup {
                        tool: "collaboration.followup_task".into(),
                        target_task_name: probe.task_name.clone(),
                        sent: SentProtocol::Probe {
                            message: ProbeMessage {
                                kind: "blabla_native_probe".into(),
                                schema_version: 1,
                                proof_id: "proof".into(),
                                nonce: "b".repeat(32),
                            },
                        },
                        outcome: FollowupOutcome::ReturnedWithoutError,
                    },
                ),
                response: completion(6, &probe, &response),
                status_after: status(7, &probe, &response),
            };
            let proof_ref = save(root.path(), &proof.record_id, &proof);
            let spawn = observed(
                8,
                NativeProjection::Spawn {
                    tool: "collaboration.spawn_agent".into(),
                    requested_task_name: "work".into(),
                    returned: child.clone(),
                },
            );
            let spawn_ref = save(root.path(), &spawn.record_id, &spawn);
            let ready = NativeMarker::Ready {
                schema_version: 1,
                run_id: run_id.into(),
                task: "task::work".into(),
                acceptance_epoch: 1,
            };
            let idle = InitialIdleEvidence {
                kind: "native_initial_idle".into(),
                schema_version: 1,
                record_id: "idle-work".into(),
                spawn_evidence: spawn_ref.clone(),
                completion: completion(9, &child, &ready),
                status: status(10, &child, &ready),
            };
            let idle_ref = save(root.path(), &idle.record_id, &idle);
            let host = HostCapabilities {
                host: "openai-native-collaboration".into(),
                version: format!("unversioned-{}", &surface_ref.sha256[..16]),
                adapter: "blabla-native-cooperative".into(),
                checkpoints: vec![CheckpointKind::TurnEnd],
                pauses_worker: false,
                same_task_delivery: false,
                delivery_receipts: false,
                pre_tool_control: false,
                gaps: vec![],
            };
            let capability = NativeCapability {
                kind: "cooperative_between_turn".into(),
                host: host.clone(),
                tool_surface: surface_ref,
                nonce_round_trip: proof_ref,
                boundary: "completed_idle_turn".into(),
                continuation_owner: "single_enrolled_coordinator".into(),
                delivery: "worker_first_action_consume".into(),
                origin: "coordinator_correlated_native_result".into(),
                limitations: [
                    "no_atomic_host_send",
                    "in_turn_unobserved",
                    "child_identity_attested",
                    "unobserved_out_of_band_continuation",
                ]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            };
            let enrollment = Enrollment {
                run_id: run_id.into(),
                task: "task::work".into(),
                acceptance_epoch: 1,
                child: child.clone(),
                coordinator: coordinator.clone(),
                generation: 1,
                assignment_revision: evidence::assignment(&project, &task),
                spawn_evidence: spawn_ref,
                initial_idle_evidence: idle_ref,
                capability: capability.clone(),
            };
            let provider = blabla::expert::provider::ProviderIdentity {
                provider: "test-provider".into(),
                model: "test-model".into(),
                checkpoint: "test-checkpoint".into(),
                supported_outputs: vec![blabla::expert::provider::OutputKind::Noul],
                probabilities: false,
                certification: None,
            };
            let mut protocol: serde_json::Value =
                serde_json::from_str(include_str!("../evals/expert-loop/protocol.json")).unwrap();
            protocol["host"]["capabilities"] = serde_json::to_value(&host).unwrap();
            protocol["host"]["stop_reason"] = serde_json::Value::Null;
            protocol["pilot"]["snapshot_files"] =
                json!({"input.txt":calibration::sha256(b"before")});
            protocol["pilot"]["task_id"] = json!("matched-work");
            protocol["pilot"]["max_wall_ms"] = json!(600000);
            protocol["pilot"]["call_limit_per_arm"] = json!(2);
            let protocol_ref = save(root.path(), "protocol", &protocol);
            let grading = save(root.path(), "grading", &protocol["pilot"]["grading"]);
            let calibration_ref = save(
                root.path(),
                "calibration-unused-off",
                &json!({"fixture":true}),
            );
            let brief = "Finish the bounded edit and capture.".to_owned();
            let mut arms = Vec::new();
            for (id, mode) in [
                (run_id, ExpertMode::Off),
                ("shadow-run", ExpertMode::Shadow),
                ("advisory-run", ExpertMode::Advisory),
            ] {
                let config = RuntimeConfig {
                    mode,
                    host: Some(host.clone()),
                    provider: Some(blabla::expert::trace::ConfiguredProvider {
                        identity: provider.clone(),
                        argv: vec!["uninvoked-test-provider".into()],
                    }),
                    ..Default::default()
                };
                let config_ref = save(root.path(), &format!("config-{}", arms.len()), &config);
                arms.push(ArmPlan {
                    run_id: id.into(),
                    matched_task_id: "matched-work".into(),
                    repeat: 1,
                    arm: mode,
                    task: "task::work".into(),
                    acceptance_epoch: 1,
                    child: child.clone(),
                    coordinator: coordinator.clone(),
                    workspace: "workspace".into(),
                    initial_assignment_revision: enrollment.assignment_revision.clone(),
                    frozen_brief: brief.clone(),
                    brief_sha256: calibration::sha256(brief.as_bytes()),
                    runtime_config: config_ref,
                    budgets: Budgets {
                        provider_attempts: if mode == ExpertMode::Off { 0 } else { 2 },
                        evaluated_questions: if mode == ExpertMode::Off { 0 } else { 4 },
                        delivery_attempts: if mode == ExpertMode::Advisory { 1 } else { 0 },
                        max_wall_ms: 600000,
                    },
                    grading_spec: grading.clone(),
                });
            }
            let plan = NativePlan {
                kind: "native_matched_run_plan".into(),
                schema_version: 1,
                experiment_id: "fixture-experiment".into(),
                protocol_sha256: calibration::canonical_sha256(&protocol).unwrap(),
                phase: Phase::Pilot,
                capability,
                provider,
                calibration: calibration_ref,
                controls_sha256: calibration::canonical_sha256(&protocol["pilot"]["controls"])
                    .unwrap(),
                snapshot_files: BTreeMap::from([(
                    "input.txt".into(),
                    calibration::sha256(b"before"),
                )]),
                order: arms.iter().map(|a| a.run_id.clone()).collect(),
                arms,
                host_operation_timeout_ms: 60000,
                response_timeout_ms: 60000,
            };
            let plan_ref = save(root.path(), "plan", &plan);
            Self {
                root,
                project,
                enrollment,
                plan_ref,
                protocol_ref,
                plan,
            }
        }
        fn store(&self) -> TraceStore {
            TraceStore::new(self.root.path(), TraceLimits::default()).unwrap()
        }
        fn advance(&self) -> AdvanceResult {
            run::advance(
                &self.store(),
                &self.project,
                &self.enrollment.run_id,
                &calibration::canonical_sha256(&self.plan).unwrap(),
                &self.enrollment.coordinator,
            )
            .unwrap()
        }
        fn pending(&self) -> HostRequest {
            match self.advance() {
                AdvanceResult::Pending { request } => request,
                other => panic!("{other:?}"),
            }
        }
        fn finish_operation(
            &self,
            request: &HostRequest,
            sequence: u64,
            projection: NativeProjection,
            payload: HostOutcome,
        ) {
            run::claim(
                &self.store(),
                &self.project,
                &ClaimRequest {
                    schema_version: 1,
                    run_id: self.enrollment.run_id.clone(),
                    operation_id: request.operation_id.clone(),
                    request_sha256: calibration::canonical_sha256(request).unwrap(),
                    coordinator: self.enrollment.coordinator.clone(),
                },
            )
            .unwrap();
            self.record_operation(request, sequence, projection, payload);
        }
        fn record_operation(
            &self,
            request: &HostRequest,
            sequence: u64,
            projection: NativeProjection,
            payload: HostOutcome,
        ) {
            let mut observation = observed(sequence, projection);
            observation.operation_id = Some(request.operation_id.clone());
            let reference = save(self.root.path(), &observation.record_id, &observation);
            let result = HostResult {
                schema_version: 1,
                operation_id: request.operation_id.clone(),
                request_sha256: calibration::canonical_sha256(request).unwrap(),
                key: request.key.clone(),
                evidence: reference,
                payload,
            };
            assert!(matches!(
                run::host_result(&self.store(), &self.project, &result).unwrap(),
                HostRecordResult::Recorded { .. }
            ));
        }
        fn begin_work(&self) -> HostRequest {
            run::enroll(&self.store(), &self.project, self.enrollment.clone()).unwrap();
            let first = run::start(
                &self.store(),
                &self.project,
                &self.enrollment.run_id,
                &self.plan_ref,
                &self.protocol_ref,
            )
            .unwrap();
            self.resume_work(first)
        }
        fn resume_work(&self, first: AdvanceResult) -> HostRequest {
            let AdvanceResult::Pending { request } = first else {
                panic!("{first:?}");
            };
            let ready = NativeMarker::Ready {
                schema_version: 1,
                run_id: self.enrollment.run_id.clone(),
                task: self.enrollment.task.clone(),
                acceptance_epoch: 1,
            };
            self.finish_operation(
                &request,
                11,
                status(11, &self.enrollment.child, &ready).projection,
                HostOutcome::ChildStatus {
                    child: self.enrollment.child.clone(),
                    status: ChildStatus::Idle,
                },
            );
            let work = self.pending();
            let HostAction::ContinueWork {
                brief,
                brief_sha256,
            } = &work.payload
            else {
                panic!();
            };
            let continuation = WorkContinuation {
                kind: "blabla_native_work".into(),
                schema_version: 1,
                key: work.key.clone(),
                brief: brief.clone(),
                brief_sha256: brief_sha256.clone(),
            };
            self.finish_operation(
                &work,
                12,
                NativeProjection::Followup {
                    tool: "collaboration.followup_task".into(),
                    target_task_name: self.enrollment.child.task_name.clone(),
                    sent: SentProtocol::Work {
                        message_sha256: calibration::canonical_sha256(&continuation).unwrap(),
                    },
                    outcome: FollowupOutcome::ReturnedWithoutError,
                },
                HostOutcome::ContinuationAccepted {
                    child: self.enrollment.child.clone(),
                },
            );
            work
        }
    }

    #[test]
    fn post_work_capture_uses_distinct_binding_revisions_and_observed_completion() {
        let fixture = NativeFixture::new("run-off");
        let work = fixture.begin_work();
        std::fs::write(fixture.root.path().join("input.txt"), "after").unwrap();
        let statements = vec![WorkerStatement {
            statement_id: "claim".into(),
            slot: StatementSlot::Claim,
            text: "Completed scoped edit.".into(),
        }];
        let captured = run::capture_boundary(
            &fixture.store(),
            &fixture.project,
            &work.key,
            &fixture.enrollment.child,
            &statements,
            true,
        )
        .unwrap();
        let NativeResult::BoundaryCaptured { marker } = captured else {
            panic!();
        };
        let repeated = run::capture_boundary(
            &fixture.store(),
            &fixture.project,
            &work.key,
            &fixture.enrollment.child,
            &statements,
            true,
        )
        .unwrap();
        assert_eq!(
            repeated,
            NativeResult::BoundaryCaptured {
                marker: marker.clone()
            }
        );
        let awaiting = fixture.pending();
        fixture.finish_operation(
            &awaiting,
            13,
            completion(13, &fixture.enrollment.child, &convert(&marker)).projection,
            HostOutcome::BoundaryReturned {
                origin: fixture.enrollment.child.clone(),
                marker: marker.clone(),
            },
        );
        let inspect = fixture.pending();
        fixture.finish_operation(
            &inspect,
            14,
            status(14, &fixture.enrollment.child, &convert(&marker)).projection,
            HostOutcome::ChildStatus {
                child: fixture.enrollment.child.clone(),
                status: ChildStatus::Idle,
            },
        );
        let AdvanceResult::CheckpointDue { observation } = fixture.advance() else {
            panic!();
        };
        let NativeResult::BoundaryObserved { checkpoint, event } =
            run::observe(&fixture.store(), &fixture.project, &observation).unwrap()
        else {
            panic!();
        };
        assert_eq!(checkpoint.selected.len(), 2);
        assert_ne!(
            checkpoint.selected[0].revision,
            checkpoint.selected[1].revision
        );
        assert!(event.observations.is_empty());
        let (_, capture, _) =
            run::checkpoint_input(&fixture.store(), &fixture.project, "run-off", &event, None)
                .unwrap();
        for projection in &capture.projections {
            assert_eq!(
                projection.observations[0].observed_revision,
                projection.revision.fingerprint()
            );
            assert_eq!(
                projection.observations[0].kind,
                blabla::expert::SourceKind::WorkerStatement
            );
            assert!(projection.observations[0].fact.is_none());
        }
        run::store_records(&fixture.store(), &fixture.project, "run-off", &mut []).unwrap();
        assert!(matches!(
            fixture.advance(),
            AdvanceResult::ArmFinished { .. }
        ));
        let ledger: serde_json::Value = serde_json::from_slice(
            &std::fs::read(fixture.root.path().join(".blabla/expert/ledger.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            ledger["experimental_runs"]["run-off"]["spent"],
            json!({"provider_attempts":0,"evaluated_questions":0,"delivery_attempts":0})
        );
    }

    impl NativeFixture {
        fn select_arm(&mut self, run_id: &str) {
            self.enrollment.run_id = run_id.into();
            let mut idle: InitialIdleEvidence =
                evidence::read(self.root.path(), &self.enrollment.initial_idle_evidence).unwrap();
            for observation in [&mut idle.completion, &mut idle.status] {
                let marker = match &mut observation.projection {
                    NativeProjection::Completion { marker, .. } => marker,
                    NativeProjection::Status {
                        selected: Some(SelectedStatus::Completed { marker, .. }),
                        ..
                    } => marker.as_mut(),
                    _ => panic!(),
                };
                if let NativeMarker::Ready { run_id: id, .. } = marker {
                    *id = run_id.into();
                }
            }
            self.enrollment.initial_idle_evidence = save(self.root.path(), &idle.record_id, &idle);
        }
        fn capture_turn(&self, work: &HostRequest, final_boundary: bool) -> ObserveRequest {
            let statements = vec![WorkerStatement {
                statement_id: "claim".into(),
                slot: StatementSlot::Claim,
                text: "Completed scoped edit.".into(),
            }];
            let NativeResult::BoundaryCaptured { marker } = run::capture_boundary(
                &self.store(),
                &self.project,
                &work.key,
                &self.enrollment.child,
                &statements,
                final_boundary,
            )
            .unwrap() else {
                panic!();
            };
            let awaiting = self.pending();
            self.finish_operation(
                &awaiting,
                13,
                completion(13, &self.enrollment.child, &convert(&marker)).projection,
                HostOutcome::BoundaryReturned {
                    origin: self.enrollment.child.clone(),
                    marker: marker.clone(),
                },
            );
            let inspect = self.pending();
            self.finish_operation(
                &inspect,
                14,
                status(14, &self.enrollment.child, &convert(&marker)).projection,
                HostOutcome::ChildStatus {
                    child: self.enrollment.child.clone(),
                    status: ChildStatus::Idle,
                },
            );
            let AdvanceResult::CheckpointDue { observation } = self.advance() else {
                panic!();
            };
            observation
        }
    }

    #[test]
    fn stale_capture_is_never_restamped_by_observe() {
        let fixture = NativeFixture::new("run-off");
        let work = fixture.begin_work();
        let observation = fixture.capture_turn(&work, false);
        std::fs::write(
            fixture.root.path().join("input.txt"),
            "changed after capture",
        )
        .unwrap();
        assert!(matches!(
            run::observe(&fixture.store(), &fixture.project, &observation),
            Err(blabla::expert::pilot::Error::Refused(
                blabla::expert::pilot::Refusal::StaleRevision
            ))
        ));
    }

    #[test]
    fn claimed_host_operation_cannot_be_reissued_after_restart() {
        let fixture = NativeFixture::new("run-off");
        fixture.begin_work();
        let request = fixture.pending();
        let claim = ClaimRequest {
            schema_version: 1,
            run_id: "run-off".into(),
            operation_id: request.operation_id.clone(),
            request_sha256: calibration::canonical_sha256(&request).unwrap(),
            coordinator: fixture.enrollment.coordinator.clone(),
        };
        run::claim(&fixture.store(), &fixture.project, &claim).unwrap();
        assert!(matches!(
            run::host_next(&fixture.store(), "run-off").unwrap(),
            HostNextResult::None { .. }
        ));
        assert!(matches!(
            run::claim(&fixture.store(), &fixture.project, &claim),
            Err(blabla::expert::pilot::Error::Refused(
                blabla::expert::pilot::Refusal::AlreadyClaimed
            ))
        ));
        assert_eq!(fixture.pending(), request);
    }

    #[test]
    fn run_ids_are_encoded_as_isolated_filesystem_components() {
        for id in [".", ".."] {
            let fixture = NativeFixture::new(id);
            fixture.begin_work();
            let ledger: serde_json::Value = serde_json::from_slice(
                &std::fs::read(fixture.root.path().join(".blabla/expert/ledger.json")).unwrap(),
            )
            .unwrap();
            let path = ledger["experimental_runs"][id]["frozen"]["config_ref"]["path"]
                .as_str()
                .unwrap();
            assert!(path.starts_with(&format!(
                ".blabla/expert/experimental/{}/config/",
                calibration::sha256(id.as_bytes())
            )));
            assert!(!path.split('/').any(|part| matches!(part, "." | "..")));
        }
    }

    impl NativeFixture {
        fn shadow_checkpoint(&mut self) -> blabla::expert::provider::EvaluationRequest {
            self.advisory();
            self.select_arm("shadow-run");
            let work = self.begin_work();
            let observation = self.capture_turn(&work, true);
            let NativeResult::BoundaryObserved { event, .. } =
                run::observe(&self.store(), &self.project, &observation).unwrap()
            else {
                panic!();
            };
            let (config, capture, _) =
                run::checkpoint_input(&self.store(), &self.project, "shadow-run", &event, None)
                    .unwrap();
            let (judgments, bindings) = blabla::expert::trace::definitions(&self.project).unwrap();
            let task = task::read(self.root.path(), "work").unwrap().unwrap();
            let projection = &capture.projections[0];
            let mut projected = event;
            projected.observations = projection.observations.clone();
            let packet = project::expert::build_packet(
                &self.project,
                &task,
                &projected,
                &bindings[0],
                &config.limits,
                &projection.history,
            )
            .unwrap();
            blabla::expert::provider::EvaluationRequest {
                request_id: "actual-attempt".into(),
                packet,
                judgment: judgments[0].clone(),
                question_fingerprint: blabla::expert::policy::question_fingerprint(&judgments[0]),
                template_fingerprint: blabla::expert::policy::template_fingerprint(&judgments[0]),
            }
        }
    }

    #[test]
    fn shadow_attempt_is_charged_before_dispatch_and_never_replayed() {
        let mut fixture = NativeFixture::new("run-off");
        let mut request = fixture.shadow_checkpoint();
        run::reserve_provider(
            &fixture.store(),
            &fixture.project,
            "shadow-run",
            &[request.clone()],
        )
        .unwrap();
        request.request_id = "restart-new-id".into();
        assert!(matches!(
            run::reserve_provider(&fixture.store(), &fixture.project, "shadow-run", &[request]),
            Err(blabla::expert::pilot::Error::Refused(
                blabla::expert::pilot::Refusal::AlreadyClaimed
            ))
        ));
        let ledger: serde_json::Value = serde_json::from_slice(
            &std::fs::read(fixture.root.path().join(".blabla/expert/ledger.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            ledger["experimental_runs"]["shadow-run"]["spent"]["provider_attempts"],
            1
        );
        assert_eq!(
            ledger["experimental_runs"]["shadow-run"]["spent"]["evaluated_questions"],
            1
        );
    }

    impl NativeFixture {
        fn advisory(
            &mut self,
        ) -> (
            blabla::expert::pilot::PermitSpec,
            blabla::expert::pilot::Approval,
            blabla::expert::policy::PolicySettings,
        ) {
            use blabla::expert::{
                ExpertLimits, TemplateKind, calibration::*, policy::*, provider::*,
            };
            let mut process =
                std::fs::read_to_string(self.root.path().join("process.bla")).unwrap();
            process.push_str("\nrole \"orchestrator\" { purpose \"Issue test permits.\" model [\"gpt-6-astra\"] }\n");
            std::fs::write(self.root.path().join("process.bla"), process).unwrap();
            let issuer = task::Task {
                name: "issuer".into(),
                role: "orchestrator".into(),
                state: "accepted".into(),
                acceptance_epoch: 1,
                accepted: Some(task::Acceptance {
                    model: "gpt-6-astra".into(),
                    unix: 1,
                    changed_at_acceptance: None,
                }),
                ..Default::default()
            };
            task::write(self.root.path(), &issuer).unwrap();
            self.select_arm("advisory-run");
            self.plan.provider.probabilities = true;
            self.plan.provider.certification = Some("test-smoke".into());
            let mut protocol: serde_json::Value =
                evidence::read_large(self.root.path(), &self.protocol_ref).unwrap();
            protocol["budgets"]["claim-support"]["min_justified_opportunities"] = json!(1);
            self.protocol_ref = save(self.root.path(), "protocol", &protocol);
            self.plan.protocol_sha256 = canonical_sha256(&protocol).unwrap();
            let (judgments, bindings) = blabla::expert::trace::definitions(&self.project).unwrap();
            let judgment = &judgments[0];
            let binding = &bindings[0];
            let task = task::read(self.root.path(), "work").unwrap().unwrap();
            let mut event = blabla::expert::ObservedEvent {
                event_id: "development".into(),
                run_id: "development".into(),
                task: "task::work".into(),
                checkpoint_id: "development".into(),
                sequence: 1,
                previous_sequence: None,
                unix_ms: 1,
                kind: CheckpointKind::TurnEnd,
                host: self.enrollment.capability.host.clone(),
                observations: vec![],
            };
            let first = project::expert::build_packet(
                &self.project,
                &task,
                &event,
                binding,
                &ExpertLimits::default(),
                &[],
            )
            .unwrap();
            event.observations = vec![blabla::expert::Observation {
                id: "development-claim".into(),
                slot: blabla::expert::ContextSlot::Claim,
                kind: blabla::expert::SourceKind::WorkerStatement,
                capture: "host:test-worker".into(),
                observed_revision: first.revision.fingerprint(),
                text: "A bounded unsupported claim.".into(),
                fact: None,
            }];
            let packet = project::expert::build_packet(
                &self.project,
                &task,
                &event,
                binding,
                &ExpertLimits::default(),
                &[],
            )
            .unwrap();
            let request = EvaluationRequest {
                request_id: "development-request".into(),
                packet,
                judgment: judgment.clone(),
                question_fingerprint: question_fingerprint(judgment),
                template_fingerprint: template_fingerprint(judgment),
            };
            let mut response = failure_response(
                &request,
                &self.plan.provider,
                ProviderFailure::Unsupported,
                None,
            );
            response.outcome = Ok(TypedAnswer::Noul {
                value: Some(false),
                probability: Some(0.1),
                confidence: None,
            });
            let mut settings = PolicySettings {
                binding_id: binding.id(),
                concern: ConcernKind::UnsupportedClaim,
                rules: vec![PolicyRule {
                    id: "trigger".into(),
                    predicate: Predicate::NoulProbability { value: false },
                    outcome: AdvisoryOutcome::Nudge,
                    template: Some(TemplateKind::AskOwner),
                    reference: ReferenceSelection::Task,
                }],
                calibration: CalibrationRecord {
                    record_id: "test-calibration".into(),
                    provider: self.plan.provider.clone(),
                    question_fingerprint: request.question_fingerprint.clone(),
                    template_fingerprint: request.template_fingerprint.clone(),
                    policy_fingerprint: String::new(),
                    development_fingerprint: protocol["datasets"]["development"]["manifest_sha256"]
                        .as_str()
                        .unwrap()
                        .into(),
                    thresholds: BTreeMap::from([("trigger".into(), 0.5)]),
                },
            };
            settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
            let raw = format!("{}\n", serde_json::to_string(&request).unwrap());
            let path = ".blabla/fixtures/requests.jsonl";
            std::fs::write(self.root.path().join(path), &raw).unwrap();
            let manifest: CalibrationRequestManifest = convert(
                &json!({"kind":"real_calibration_requests","schema_version":1,"development_manifest_sha256":settings.calibration.development_fingerprint,
            "requests_jsonl":{"id":"development-requests","path":path,"sha256":sha256(raw.as_bytes())},"cases":[{"case_id":"case-1","group_id":"claim-group","primary_request_id":request.request_id,"selection_request_id":null,"gold":{"justified_nudge":true,"acceptable_reference_sets":[["task::work"]]}}]}),
            );
            let manifest_ref = save(self.root.path(), "development-manifest", &manifest);
            let fit_plan: FitPlan = convert(
                &json!({"kind":"typed_development_fit_plan","schema_version":1,"protocol_sha256":self.plan.protocol_sha256,
            "development_manifest_sha256":settings.calibration.development_fingerprint,"holdout_manifest_sha256":protocol["datasets"]["holdout"]["manifest_sha256"],"request_manifest_sha256":canonical_sha256(&manifest).unwrap(),"provider":self.plan.provider,"limits":ExpertLimits::default(),
            "groups":[{"group_id":"claim-group","family":"claim-support","primary_binding":settings.binding_id,"selection_binding":null,"candidates":[{"candidate_id":"candidate-1","primary":settings,"selection":null}],"objective":{"false_nudge_max":0.05,"min_evaluable_coverage":0.9,"min_justified_opportunities":1,"min_proposed_nudges":1,"rank":["fewest_missed_correct_nudges","fewest_false_nudges","candidate_id"]}}]}),
            );
            let fit_plan_ref = save(self.root.path(), "fit-plan", &fit_plan);
            let command_ref = save(
                self.root.path(),
                "command-test-evidence",
                &json!({"test_fixture":true,"stdout":response,"exit":0}),
            );
            let input = FitSavedRequest {
                kind: "fit_saved_development".into(),
                schema_version: 1,
                protocol_evidence: self.protocol_ref.clone(),
                plan: fit_plan,
                plan_evidence: fit_plan_ref.clone(),
                request_manifest: manifest,
                manifest_evidence: manifest_ref.clone(),
                executions: vec![CalibrationExecution {
                    request,
                    response,
                    command_evidence: command_ref,
                }],
            };
            let context = validate_fit_context(
                &input,
                &std::fs::read(self.root.path().join(&self.protocol_ref.path)).unwrap(),
                &std::fs::read(self.root.path().join(&fit_plan_ref.path)).unwrap(),
                &std::fs::read(self.root.path().join(&manifest_ref.path)).unwrap(),
            )
            .unwrap();
            let fitted = fit_saved(&input, &context).unwrap();
            assert_eq!(fitted.groups[0].status, FitStatus::Eligible);
            let fitted_ref = save(self.root.path(), "fitted", &fitted);
            for arm in &mut self.plan.arms {
                let config = RuntimeConfig {
                    mode: arm.arm,
                    host: Some(self.enrollment.capability.host.clone()),
                    provider: Some(blabla::expert::trace::ConfiguredProvider {
                        identity: self.plan.provider.clone(),
                        argv: vec!["uninvoked-test-provider".into()],
                    }),
                    policies: vec![settings.clone()],
                    ..Default::default()
                };
                arm.runtime_config =
                    save(self.root.path(), &format!("config-{:?}", arm.arm), &config);
            }
            let arm = self
                .plan
                .arms
                .iter()
                .find(|a| a.arm == ExpertMode::Advisory)
                .unwrap()
                .clone();
            let real = blabla::expert::pilot::evidence::RealCalibration {
                kind: "real_provider_development_calibration".into(),
                schema_version: 1,
                protocol_sha256: self.plan.protocol_sha256.clone(),
                development_manifest_sha256: settings.calibration.development_fingerprint.clone(),
                holdout_manifest_sha256: input.plan.holdout_manifest_sha256.clone(),
                request_manifest: manifest_ref,
                fit_plan: fit_plan_ref,
                fitted_result: Some(fitted_ref),
                provider: self.plan.provider.clone(),
                provider_argv_sha256: canonical_sha256(&vec!["uninvoked-test-provider"]).unwrap(),
                runtime_config_sha256: self.plan.arms[1].runtime_config.sha256.clone(),
                executions: input.executions,
                selected: vec![settings.clone()],
                policy_sha256: canonical_sha256(&vec![settings.clone()]).unwrap(),
                status: "eligible".into(),
                promotion_records: vec![],
            };
            self.plan.calibration = save(self.root.path(), "real-calibration-test", &real);
            self.plan_ref = save(self.root.path(), "plan", &self.plan);
            let now = blabla::expert::pilot::Clock::now().unwrap();
            let spec: blabla::expert::pilot::PermitSpec = convert(
                &json!({"kind":"experimental_permit","schema_version":1,"permit_id":"permit-1","run_id":"advisory-run","experiment_id":self.plan.experiment_id,"arm":"advisory","phase":"pilot","promotion_eligible":false,"protocol":self.protocol_ref,"native_plan":self.plan_ref,"frozen_snapshot_sha256":canonical_sha256(&self.plan.snapshot_files).unwrap(),"tasks":[{"task":"task::work","acceptance_epoch":1,"child":self.enrollment.child,"initial_assignment_revision":self.enrollment.assignment_revision}],"coordinator":self.enrollment.coordinator,"capability":self.enrollment.capability,"provider":self.plan.provider,"provider_argv_sha256":real.provider_argv_sha256,"runtime_config_sha256":arm.runtime_config.sha256,"bindings":[{"binding_id":settings.binding_id,"question_fingerprint":settings.calibration.question_fingerprint,"template_fingerprint":settings.calibration.template_fingerprint,"policy_fingerprint":policy_fingerprint(&settings),"calibration_fingerprint":blabla::expert::packet::digest(&settings.calibration)}],"implementation_fingerprints":blabla::expert::trace::implementation_fingerprints(),"development_manifest_sha256":real.development_manifest_sha256,"holdout_manifest_sha256":real.holdout_manifest_sha256,"real_calibration":self.plan.calibration,"limits":ExpertLimits::default(),"budgets":arm.budgets,"not_before_unix_ms":now.unix_ms,"expires_unix_ms":now.unix_ms+600000,"stop_on":["owner_stop","revocation","expiry","clock_uncertain","scope_change","snapshot_change","capability_change","budget_exhausted","unknown_delivery","coordinator_lost","storage_error"]}),
            );
            let approval = blabla::expert::pilot::Approval {
                owner_instruction: save(
                    self.root.path(),
                    "owner-test-instruction",
                    &json!({"test_fixture":"approve this bounded test run"}),
                ),
                issuer_task: "task::issuer".into(),
                issuer_model: "gpt-6-astra".into(),
            };
            (spec, approval, settings)
        }
    }

    impl NativeFixture {
        fn advisory_checkpoint(
            &mut self,
        ) -> (
            blabla::expert::pilot::IssuedPermit,
            blabla::expert::pilot::Approval,
            Checkpoint,
            blabla::expert::provider::EvaluationRequest,
            blabla::expert::policy::PolicySettings,
            RuntimeConfig,
        ) {
            self.advisory_checkpoint_with_requests(&["judgment-request"])
        }
        fn advisory_checkpoint_with_requests(
            &mut self,
            request_ids: &[&str],
        ) -> (
            blabla::expert::pilot::IssuedPermit,
            blabla::expert::pilot::Approval,
            Checkpoint,
            blabla::expert::provider::EvaluationRequest,
            blabla::expert::policy::PolicySettings,
            RuntimeConfig,
        ) {
            use blabla::expert::{pilot, policy, provider::*, trace};
            let (spec, approval, settings) = self.advisory();
            run::enroll(&self.store(), &self.project, self.enrollment.clone()).unwrap();
            assert!(matches!(
                run::start(
                    &self.store(),
                    &self.project,
                    "advisory-run",
                    &self.plan_ref,
                    &self.protocol_ref
                )
                .unwrap(),
                AdvanceResult::AwaitingPermit { .. }
            ));
            let pilot::PermitResult::Issued { permit } =
                pilot::issue(&self.store(), &self.project, spec.clone(), approval.clone()).unwrap()
            else {
                panic!();
            };
            let duplicate =
                pilot::issue(&self.store(), &self.project, spec, approval.clone()).unwrap();
            assert_eq!(
                duplicate,
                pilot::PermitResult::Issued {
                    permit: permit.clone()
                }
            );
            let work = self.resume_work(self.advance());
            let observation = self.capture_turn(&work, true);
            let NativeResult::BoundaryObserved { checkpoint, event } =
                run::observe(&self.store(), &self.project, &observation).unwrap()
            else {
                panic!();
            };
            let (config, capture, _) =
                run::checkpoint_input(&self.store(), &self.project, "advisory-run", &event, None)
                    .unwrap();
            let (judgments, bindings) = trace::definitions(&self.project).unwrap();
            let task = task::read(self.root.path(), "work").unwrap().unwrap();
            let projection = &capture.projections[0];
            let mut projected = event;
            projected.observations = projection.observations.clone();
            let request = EvaluationRequest {
                request_id: request_ids[0].into(),
                packet: project::expert::build_packet(
                    &self.project,
                    &task,
                    &projected,
                    &bindings[0],
                    &config.limits,
                    &projection.history,
                )
                .unwrap(),
                judgment: judgments[0].clone(),
                question_fingerprint: policy::question_fingerprint(&judgments[0]),
                template_fingerprint: policy::template_fingerprint(&judgments[0]),
            };
            run::reserve_provider(
                &self.store(),
                &self.project,
                "advisory-run",
                &request_ids
                    .iter()
                    .map(|id| {
                        let mut next = request.clone();
                        next.request_id = (*id).into();
                        next
                    })
                    .collect::<Vec<_>>(),
            )
            .unwrap();
            (*permit, approval, checkpoint, request, settings, config)
        }
        fn unstored_record(
            &self,
            request: blabla::expert::provider::EvaluationRequest,
            settings: blabla::expert::policy::PolicySettings,
            config: &RuntimeConfig,
        ) -> blabla::expert::trace::TraceRecord {
            use blabla::expert::{
                provider::*,
                trace::{Provenance, TraceRecord},
            };
            let mut response = failure_response(
                &request,
                &self.plan.provider,
                ProviderFailure::Unsupported,
                None,
            );
            response.outcome = Ok(TypedAnswer::Noul {
                value: Some(false),
                probability: Some(0.1),
                confidence: None,
            });
            let mut record = TraceRecord::new(
                request,
                response,
                settings,
                ExpertMode::Shadow,
                Provenance::LocalCheckpoint,
                None,
                config.limits.clone(),
            )
            .unwrap();
            record.runtime_fingerprint = Some(blabla::expert::packet::digest(&config));
            record
        }
        fn evaluated(
            &self,
            request: blabla::expert::provider::EvaluationRequest,
            settings: blabla::expert::policy::PolicySettings,
            config: &RuntimeConfig,
        ) -> blabla::expert::trace::TraceRecord {
            let mut record = self.unstored_record(request, settings, config);
            run::store_records(
                &self.store(),
                &self.project,
                "advisory-run",
                std::slice::from_mut(&mut record),
            )
            .unwrap();
            record
        }
        fn stored_run(&self) -> run::Run {
            let ledger: serde_json::Value = serde_json::from_slice(
                &std::fs::read(self.root.path().join(".blabla/expert/ledger.json")).unwrap(),
            )
            .unwrap();
            serde_json::from_value(ledger["experimental_runs"][&self.enrollment.run_id].clone())
                .unwrap()
        }
        fn prepared(
            &mut self,
        ) -> (
            blabla::expert::pilot::IssuedPermit,
            blabla::expert::pilot::Approval,
            Checkpoint,
            HostRequest,
            blabla::expert::trace::TraceRecord,
        ) {
            use blabla::expert::policy;
            let (permit, approval, checkpoint, request, settings, config) =
                self.advisory_checkpoint();
            let record = self.evaluated(request, settings, &config);
            assert_eq!(record.result.outcome, policy::AdvisoryOutcome::Nudge);
            let NativeResult::RequestReserved { host_operation, .. } = run::prepare(
                &self.store(),
                &self.project,
                &checkpoint,
                "judgment-request",
                &permit.authority(),
            )
            .unwrap() else {
                panic!();
            };
            (permit, approval, checkpoint, host_operation, record)
        }
    }
    #[test]
    fn permit_issue_reservation_consume_and_lost_stdout_remain_at_most_once() {
        use blabla::expert::{pilot, trace};
        let mut fixture = NativeFixture::new("run-off");
        let (_permit, _approval, checkpoint, host_operation, record) = fixture.prepared();
        let HostAction::WakeWorker { wake } = &host_operation.payload else {
            panic!();
        };
        assert!(
            serde_json::to_value(&host_operation)
                .unwrap()
                .to_string()
                .find("message")
                .is_none()
        );
        run::claim(
            &fixture.store(),
            &fixture.project,
            &ClaimRequest {
                schema_version: 1,
                run_id: "advisory-run".into(),
                operation_id: host_operation.operation_id.clone(),
                request_sha256: calibration::canonical_sha256(&host_operation).unwrap(),
                coordinator: fixture.enrollment.coordinator.clone(),
            },
        )
        .unwrap();
        let consumed = run::consume(
            &fixture.store(),
            &fixture.project,
            run::ConsumeRequest {
                wake,
                task: "task::work",
                acceptance_epoch: 1,
                generation: 1,
                child_attestation: &fixture.enrollment.child,
                first_action_attestation: true,
            },
        )
        .unwrap();
        assert!(matches!(consumed, NativeResult::Consumed { .. }));
        assert!(matches!(
            run::consume(
                &fixture.store(),
                &fixture.project,
                run::ConsumeRequest {
                    wake,
                    task: "task::work",
                    acceptance_epoch: 1,
                    generation: 1,
                    child_attestation: &fixture.enrollment.child,
                    first_action_attestation: true,
                },
            )
            .unwrap(),
            NativeResult::NoAdvice {
                code: pilot::Refusal::AlreadyConsumed,
                completion: None
            }
        ));
        let view = pilot::show(&fixture.store(), "advisory-run").unwrap();
        assert_eq!(view.spent.delivery_attempts, 1);
        assert_eq!(view.spent.provider_attempts, 1);
        assert!(
            fixture
                .store()
                .reserve(
                    "judgment-request",
                    &checkpoint.key.checkpoint_id,
                    &fixture.project
                )
                .is_err()
        );
        assert!(trace::replay(&record).is_ok());
        let mut stripped = record.clone();
        stripped.permit = None;
        assert!(trace::replay(&stripped).is_err());
        for protocol in [true, false] {
            let mut changed = record.clone();
            if let ExecutionIdentity::Experimental {
                protocol_sha256,
                native_plan_sha256,
                ..
            } = &mut changed.execution
            {
                if protocol {
                    *protocol_sha256 = "0".repeat(64);
                } else {
                    *native_plan_sha256 = "0".repeat(64);
                }
            }
            assert!(trace::replay(&changed).is_err());
        }
    }

    impl NativeFixture {
        fn accept_wake(&self, operation: &HostRequest) -> Wake {
            let HostAction::WakeWorker { wake } = &operation.payload else {
                panic!();
            };
            self.finish_operation(
                operation,
                15,
                NativeProjection::Followup {
                    tool: "collaboration.followup_task".into(),
                    target_task_name: self.enrollment.child.task_name.clone(),
                    sent: SentProtocol::Wake {
                        message: wake.clone(),
                    },
                    outcome: FollowupOutcome::ReturnedWithoutError,
                },
                HostOutcome::WakeAccepted {
                    child: self.enrollment.child.clone(),
                },
            );
            wake.clone()
        }
    }

    #[test]
    fn stale_consume_requires_actual_negative_completion_without_delivery_credit() {
        use blabla::expert::pilot;
        let mut fixture = NativeFixture::new("run-off");
        let (_, _, checkpoint, operation, _) = fixture.prepared();
        let wake = fixture.accept_wake(&operation);
        std::fs::write(
            fixture.root.path().join("input.txt"),
            "changed after reservation",
        )
        .unwrap();
        let NativeResult::NoAdvice {
            code: pilot::Refusal::StaleRevision,
            completion: Some(completion),
        } = run::consume(
            &fixture.store(),
            &fixture.project,
            run::ConsumeRequest {
                wake: &wake,
                task: "task::work",
                acceptance_epoch: 1,
                generation: 1,
                child_attestation: &fixture.enrollment.child,
                first_action_attestation: true,
            },
        )
        .unwrap()
        else {
            panic!();
        };
        let awaited = fixture.pending();
        let response = WorkerResponse::NoAdvice {
            schema_version: 1,
            completion: completion.clone(),
            child_attestation: fixture.enrollment.child.clone(),
        };
        fixture.finish_operation(
            &awaited,
            16,
            completion_projection(&fixture.enrollment.child, &response),
            HostOutcome::WorkerResponse {
                origin: fixture.enrollment.child.clone(),
                response,
            },
        );
        let NativeResult::ResponseObserved { receipt, .. } = run::record_response(
            &fixture.store(),
            &fixture.project,
            &checkpoint,
            "judgment-request",
            &ResponseEvidence::WorkerResponse {
                response_operation_id: awaited.operation_id,
            },
        )
        .unwrap() else {
            panic!();
        };
        assert!(matches!(
            receipt.category,
            ReceiptCategory::NotExposed {
                reason: NotExposedReason::ConsumeRefused,
                refusal_sha256: Some(_)
            }
        ));
        let ledger: serde_json::Value = serde_json::from_slice(
            &std::fs::read(fixture.root.path().join(".blabla/expert/ledger.json")).unwrap(),
        )
        .unwrap();
        let entry = ledger["entries"]
            .as_object()
            .unwrap()
            .values()
            .next()
            .unwrap();
        assert_eq!(entry["state"], "proposed");
        assert_eq!(entry["no_delivery_verified"], true);
        assert_eq!(
            pilot::show(&fixture.store(), "advisory-run")
                .unwrap()
                .spent
                .delivery_attempts,
            1
        );
    }
    fn completion_projection(child: &Child, response: &WorkerResponse) -> NativeProjection {
        NativeProjection::Completion {
            source: "native_completion_notification".into(),
            origin: child.clone(),
            marker: convert(response),
        }
    }

    #[test]
    fn revocation_during_inference_preserves_attempt_and_rejects_delivery() {
        use blabla::expert::pilot;
        let mut fixture = NativeFixture::new("run-off");
        let (permit, approval, checkpoint, request, settings, config) =
            fixture.advisory_checkpoint();
        pilot::revoke(
            &fixture.store(),
            &fixture.project,
            permit.authority(),
            "stop test".into(),
            approval,
        )
        .unwrap();
        let record = fixture.evaluated(request, settings, &config);
        assert_eq!(record.mode, ExpertMode::Shadow);
        assert!(matches!(
            run::prepare(
                &fixture.store(),
                &fixture.project,
                &checkpoint,
                "judgment-request",
                &permit.authority()
            ),
            Err(pilot::Error::Refused(pilot::Refusal::PermitRevoked))
        ));
        let view = pilot::show(&fixture.store(), "advisory-run").unwrap();
        assert_eq!(view.spent.provider_attempts, 1);
        assert_eq!(view.spent.delivery_attempts, 0);
    }

    #[test]
    fn revocation_before_await_stays_unknown_but_existing_claimed_await_can_reconcile() {
        use blabla::expert::pilot;
        for claimed_await in [false, true] {
            let mut fixture = NativeFixture::new("run-off");
            let (permit, approval, _, operation, _) = fixture.prepared();
            let wake = fixture.accept_wake(&operation);
            let NativeResult::Consumed {
                consume_nonce,
                result_sha256,
                request_id,
                ..
            } = run::consume(
                &fixture.store(),
                &fixture.project,
                run::ConsumeRequest {
                    wake: &wake,
                    task: "task::work",
                    acceptance_epoch: 1,
                    generation: 1,
                    child_attestation: &fixture.enrollment.child,
                    first_action_attestation: true,
                },
            )
            .unwrap()
            else {
                panic!();
            };
            let awaited = claimed_await.then(|| fixture.pending());
            if let Some(awaited) = &awaited {
                run::claim(
                    &fixture.store(),
                    &fixture.project,
                    &ClaimRequest {
                        schema_version: 1,
                        run_id: "advisory-run".into(),
                        operation_id: awaited.operation_id.clone(),
                        request_sha256: calibration::canonical_sha256(awaited).unwrap(),
                        coordinator: fixture.enrollment.coordinator.clone(),
                    },
                )
                .unwrap();
            }
            pilot::revoke(
                &fixture.store(),
                &fixture.project,
                permit.authority(),
                "stop test".into(),
                approval,
            )
            .unwrap();
            if let Some(awaited) = awaited {
                let response = WorkerResponse::Advice {
                    schema_version: 1,
                    run_id: "advisory-run".into(),
                    checkpoint_id: wake.checkpoint_id.clone(),
                    request_id,
                    wake_nonce: wake.wake_nonce.clone(),
                    consume_nonce,
                    result_sha256,
                    child_attestation: fixture.enrollment.child.clone(),
                    disposition: Disposition::Acknowledged,
                };
                fixture.record_operation(
                    &awaited,
                    16,
                    completion_projection(&fixture.enrollment.child, &response),
                    HostOutcome::WorkerResponse {
                        origin: fixture.enrollment.child.clone(),
                        response,
                    },
                );
            }
            assert!(matches!(
                fixture.advance(),
                AdvanceResult::ArmStopped {
                    code: pilot::Refusal::PermitRevoked,
                    ..
                }
            ));
            let ledger: serde_json::Value = serde_json::from_slice(
                &std::fs::read(fixture.root.path().join(".blabla/expert/ledger.json")).unwrap(),
            )
            .unwrap();
            let entry = ledger["entries"]
                .as_object()
                .unwrap()
                .values()
                .next()
                .unwrap();
            assert_eq!(
                entry["state"],
                if claimed_await {
                    "acknowledged"
                } else {
                    "unknown"
                }
            );
            assert_eq!(
                pilot::show(&fixture.store(), "advisory-run")
                    .unwrap()
                    .spent
                    .delivery_attempts,
                1
            );
        }
    }

    #[test]
    fn advisory_checkpoint_without_permit_never_reserves_provider() {
        use blabla::expert::pilot;
        let mut fixture = NativeFixture::new("run-off");
        fixture.advisory();
        run::enroll(
            &fixture.store(),
            &fixture.project,
            fixture.enrollment.clone(),
        )
        .unwrap();
        assert!(matches!(
            run::start(
                &fixture.store(),
                &fixture.project,
                "advisory-run",
                &fixture.plan_ref,
                &fixture.protocol_ref
            )
            .unwrap(),
            AdvanceResult::AwaitingPermit { .. }
        ));
        assert!(matches!(
            run::reserve_provider(&fixture.store(), &fixture.project, "advisory-run", &[]),
            Err(pilot::Error::Refused(pilot::Refusal::PermitMissing))
        ));
        let ledger: serde_json::Value = serde_json::from_slice(
            &std::fs::read(fixture.root.path().join(".blabla/expert/ledger.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            ledger["experimental_runs"]["advisory-run"]["spent"]["provider_attempts"],
            0
        );
        assert!(
            ledger["experimental_runs"]["advisory-run"]["attempts"]
                .as_object()
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn sequence_and_actual_origin_mismatches_cannot_advance_a_claimed_boundary() {
        use blabla::expert::pilot::{Error, Refusal};
        let fixture = NativeFixture::new("run-off");
        let work = fixture.begin_work();
        let NativeResult::BoundaryCaptured { marker } = run::capture_boundary(
            &fixture.store(),
            &fixture.project,
            &work.key,
            &fixture.enrollment.child,
            &[],
            true,
        )
        .unwrap() else {
            panic!();
        };
        let awaited = fixture.pending();
        run::claim(
            &fixture.store(),
            &fixture.project,
            &ClaimRequest {
                schema_version: 1,
                run_id: "run-off".into(),
                operation_id: awaited.operation_id.clone(),
                request_sha256: calibration::canonical_sha256(&awaited).unwrap(),
                coordinator: fixture.enrollment.coordinator.clone(),
            },
        )
        .unwrap();
        for (sequence, wrong_origin) in [(13, false), (14, true)] {
            let mut selected = marker.clone();
            if !wrong_origin {
                selected.sequence += 2;
            }
            let origin = if wrong_origin {
                actor("/root/other")
            } else {
                fixture.enrollment.child.clone()
            };
            let mut observed = completion(sequence, &origin, &convert(&selected));
            observed.operation_id = Some(awaited.operation_id.clone());
            let reference = save(fixture.root.path(), &observed.record_id, &observed);
            let result = HostResult {
                schema_version: 1,
                operation_id: awaited.operation_id.clone(),
                request_sha256: calibration::canonical_sha256(&awaited).unwrap(),
                key: awaited.key.clone(),
                evidence: reference,
                payload: HostOutcome::BoundaryReturned {
                    origin: fixture.enrollment.child.clone(),
                    marker: selected,
                },
            };
            let error = run::host_result(&fixture.store(), &fixture.project, &result).unwrap_err();
            assert!(
                matches!(error,Error::Refused(code) if code == if wrong_origin {Refusal::OriginMismatch} else {Refusal::SequenceGap})
            );
        }
        let ledger: serde_json::Value = serde_json::from_slice(
            &std::fs::read(fixture.root.path().join(".blabla/expert/ledger.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            ledger["experimental_runs"]["run-off"]["enrollments"]["task::work"]["key"]["sequence"],
            0
        );
        assert_eq!(
            ledger["experimental_runs"]["run-off"]["stopped"],
            "origin_mismatch"
        );
    }

    #[test]
    fn removed_durable_nullable_fields_are_storage_corruption_not_permission_to_retry() {
        use blabla::expert::pilot::{Error, Refusal};
        let fixture = NativeFixture::new("run-off");
        fixture.begin_work();
        let path = fixture.root.path().join(".blabla/expert/ledger.json");
        let mut ledger: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        ledger["experimental_runs"]["run-off"]
            .as_object_mut()
            .unwrap()
            .remove("frozen");
        std::fs::write(&path, serde_json::to_vec(&ledger).unwrap()).unwrap();
        assert!(matches!(
            run::host_next(&fixture.store(), "run-off"),
            Err(Error::Refused(Refusal::StorageCorrupt))
        ));
    }

    #[test]
    fn rejected_trace_batch_publishes_nothing_and_can_be_corrected() {
        for invalid in ["unreserved", "replay", "duplicate"] {
            let mut fixture = NativeFixture::new("run-off");
            let (_, _, _, request, settings, config) =
                fixture.advisory_checkpoint_with_requests(&["judgment-request", "second-request"]);
            let good = fixture.unstored_record(request.clone(), settings.clone(), &config);
            let mut second_request = request;
            second_request.request_id = "second-request".into();
            let second = fixture.unstored_record(second_request, settings, &config);
            let mut bad = second.clone();
            match invalid {
                "unreserved" => bad.request.request_id = "not-reserved".into(),
                "replay" => bad.response.request_id = "wrong-response".into(),
                _ => bad = good.clone(),
            }
            assert!(
                run::store_records(
                    &fixture.store(),
                    &fixture.project,
                    "advisory-run",
                    &mut [good.clone(), bad]
                )
                .is_err()
            );
            let run = fixture.stored_run();
            assert!(run.traces.is_empty(), "{invalid}");
            assert!(run.attempts.values().all(|attempt| !attempt.completed));
            assert_eq!(run.spent.provider_attempts, 1);
            assert_eq!(run.spent.evaluated_questions, 2);
            assert!(!run.enrollments["task::work"].evaluated);
            let directory = fixture.root.path().join(format!(
                ".blabla/expert/experimental/{}/traces",
                calibration::sha256(b"advisory-run")
            ));
            assert!(!directory.exists(), "{invalid}");
            run::store_records(
                &fixture.store(),
                &fixture.project,
                "advisory-run",
                &mut [good, second],
            )
            .unwrap();
            let run = fixture.stored_run();
            assert_eq!(run.traces.len(), 2);
            assert!(run.attempts.values().all(|attempt| attempt.completed));
            assert!(run.enrollments["task::work"].evaluated);
        }
    }

    #[test]
    fn partial_trace_payload_failure_stops_without_publishing_a_partial_batch() {
        use blabla::expert::{
            packet,
            pilot::{Error, Refusal},
        };
        let mut fixture = NativeFixture::new("run-off");
        let (_, _, _, request, settings, config) =
            fixture.advisory_checkpoint_with_requests(&["judgment-request", "second-request"]);
        let first = fixture.unstored_record(request.clone(), settings.clone(), &config);
        let mut second_request = request;
        second_request.request_id = "second-request".into();
        let second = fixture.unstored_record(second_request, settings, &config);
        let directory = fixture.root.path().join(format!(
            ".blabla/expert/experimental/{}/traces",
            calibration::sha256(b"advisory-run")
        ));
        let blocked = directory.join(format!("{}.json", packet::digest(&"second-request")));
        std::fs::create_dir_all(&blocked).unwrap();
        assert!(
            run::store_records(
                &fixture.store(),
                &fixture.project,
                "advisory-run",
                &mut [first, second.clone()]
            )
            .is_err()
        );
        assert!(
            directory
                .join(format!("{}.json", packet::digest(&"judgment-request")))
                .is_file()
        );
        let run = fixture.stored_run();
        assert_eq!(run.stopped, Some(Refusal::StorageCorrupt));
        assert!(run.traces.is_empty());
        assert!(run.attempts.values().all(|attempt| !attempt.completed));
        assert!(!run.enrollments["task::work"].evaluated);
        assert_eq!(run.spent.provider_attempts, 1);
        assert_eq!(run.spent.evaluated_questions, 2);
        std::fs::remove_dir(&blocked).unwrap();
        assert!(matches!(
            fixture.advance(),
            AdvanceResult::ArmStopped {
                code: Refusal::StorageCorrupt,
                ..
            }
        ));
        assert!(matches!(
            run::reserve_provider(
                &fixture.store(),
                &fixture.project,
                "advisory-run",
                &[second.request]
            ),
            Err(Error::Refused(Refusal::StorageCorrupt))
        ));
    }

    #[test]
    fn trace_payload_write_error_is_terminal_after_storage_recovery() {
        use blabla::expert::pilot::{Error, Refusal};
        let mut fixture = NativeFixture::new("run-off");
        let (_, _, _, request, settings, config) = fixture.advisory_checkpoint();
        let mut record = fixture.unstored_record(request, settings, &config);
        let directory = fixture.root.path().join(format!(
            ".blabla/expert/experimental/{}/traces",
            calibration::sha256(b"advisory-run")
        ));
        std::fs::write(&directory, b"unavailable directory").unwrap();
        assert!(matches!(
            run::store_records(
                &fixture.store(),
                &fixture.project,
                "advisory-run",
                std::slice::from_mut(&mut record)
            ),
            Err(Error::Io)
        ));
        let run = fixture.stored_run();
        assert_eq!(run.stopped, Some(Refusal::StorageCorrupt));
        assert!(run.traces.is_empty());
        assert!(run.attempts.values().all(|attempt| !attempt.completed));
        assert!(!run.enrollments["task::work"].evaluated);
        assert_eq!(run.spent.provider_attempts, 1);
        std::fs::remove_file(&directory).unwrap();
        assert!(matches!(
            fixture.advance(),
            AdvanceResult::ArmStopped {
                code: Refusal::StorageCorrupt,
                ..
            }
        ));
    }

    #[test]
    fn late_result_fatal_admission_is_terminal_after_input_restoration() {
        use blabla::expert::pilot::{Error, PermitState, Refusal};
        for failure in [
            "runtime",
            "missing",
            "epoch",
            "task",
            "scope",
            "non_file",
            "corrupt_task",
        ] {
            let mut fixture = NativeFixture::new("run-off");
            let (_, _, _, request, settings, config) = fixture.advisory_checkpoint();
            let path = if matches!(failure, "epoch" | "task" | "scope" | "corrupt_task") {
                fixture.root.path().join(".blabla/tasks/work.json")
            } else {
                fixture.root.path().join(&fixture.protocol_ref.path)
            };
            let original = std::fs::read(&path).unwrap();
            let expected = match failure {
                "missing" => {
                    std::fs::remove_file(&path).unwrap();
                    Refusal::StorageMissing
                }
                "epoch" | "task" | "scope" => {
                    let mut task = task::read(fixture.root.path(), "work").unwrap().unwrap();
                    if failure == "epoch" {
                        task.acceptance_epoch += 1;
                    } else if failure == "scope" {
                        task.scope.push("outside.txt".into());
                    } else {
                        task.state = "ready".into();
                    }
                    task::write(fixture.root.path(), &task).unwrap();
                    if failure == "epoch" {
                        Refusal::EpochMismatch
                    } else if failure == "scope" {
                        Refusal::RuntimeChanged
                    } else {
                        Refusal::TaskNotAccepted
                    }
                }
                "corrupt_task" => {
                    std::fs::write(&path, b"{").unwrap();
                    Refusal::StorageCorrupt
                }
                "non_file" => {
                    std::fs::remove_file(&path).unwrap();
                    std::fs::create_dir(&path).unwrap();
                    Refusal::StorageCorrupt
                }
                _ => {
                    std::fs::write(&path, b"{}\n").unwrap();
                    Refusal::RuntimeChanged
                }
            };
            let mut record = fixture.unstored_record(request, settings, &config);
            assert!(
                run::store_records(
                    &fixture.store(),
                    &fixture.project,
                    "advisory-run",
                    std::slice::from_mut(&mut record)
                )
                .is_err(),
                "{failure}"
            );
            let run = fixture.stored_run();
            assert_eq!(run.stopped, Some(expected), "{failure}");
            assert!(
                matches!(run.permit_state, Some(PermitState::Stopped { code }) if code == expected)
            );
            assert_eq!(run.spent.provider_attempts, 1);
            assert_eq!(run.spent.evaluated_questions, 1);
            assert!(run.attempts.values().all(|attempt| attempt.completed));
            assert_eq!(run.traces.len(), 1);
            assert_eq!(record.mode, ExpertMode::Shadow);
            assert_eq!(record.result.reason, "stale_checkpoint");
            assert!(blabla::expert::trace::replay(&record).is_ok());
            if failure == "non_file" {
                std::fs::remove_dir(&path).unwrap();
            }
            std::fs::write(path, original).unwrap();
            assert!(
                matches!(fixture.advance(), AdvanceResult::ArmStopped { code, .. } if code == expected)
            );
            assert!(
                matches!(run::reserve_provider(&fixture.store(), &fixture.project, "advisory-run", &[record.request]), Err(Error::Refused(code)) if code == expected)
            );
        }
    }

    #[test]
    fn shadow_refuses_fixture_calibration_before_checkpoint_or_dispatch() {
        let mut fixture = NativeFixture::new("run-off");
        fixture.select_arm("shadow-run");
        run::enroll(
            &fixture.store(),
            &fixture.project,
            fixture.enrollment.clone(),
        )
        .unwrap();
        let start = run::start(
            &fixture.store(),
            &fixture.project,
            "shadow-run",
            &fixture.plan_ref,
            &fixture.protocol_ref,
        );
        assert!(start.is_err());
        let run = fixture.stored_run();
        assert_eq!(run.spent.provider_attempts, 0);
        assert_eq!(run.spent.evaluated_questions, 0);
        assert!(run.attempts.is_empty());
        assert!(run.operations.is_empty());
        assert!(
            run::reserve_provider(&fixture.store(), &fixture.project, "shadow-run", &[]).is_err()
        );
    }

    #[test]
    fn shadow_rechecks_calibration_at_checkpoint_and_reservation() {
        use blabla::expert::pilot::{Error, Refusal};
        let mut fixture = NativeFixture::new("run-off");
        let request = fixture.shadow_checkpoint();
        std::fs::write(
            fixture.root.path().join(&fixture.plan.calibration.path),
            b"{}\n",
        )
        .unwrap();
        let capture: BoundaryCapture = evidence::read(
            fixture.root.path(),
            fixture.stored_run().enrollments["task::work"]
                .capture
                .as_ref()
                .unwrap(),
        )
        .unwrap();
        assert!(matches!(
            run::checkpoint_input(
                &fixture.store(),
                &fixture.project,
                "shadow-run",
                &capture.event,
                None
            ),
            Err(Error::Refused(Refusal::RuntimeChanged))
        ));
        assert!(matches!(
            run::reserve_provider(&fixture.store(), &fixture.project, "shadow-run", &[request]),
            Err(Error::Refused(Refusal::RuntimeChanged))
        ));
        let run = fixture.stored_run();
        assert_eq!(run.spent.provider_attempts, 0);
        assert_eq!(run.spent.evaluated_questions, 0);
        assert!(run.attempts.is_empty());
    }

    #[test]
    fn shadow_refuses_policy_outside_saved_calibration() {
        let mut fixture = NativeFixture::new("run-off");
        fixture.advisory();
        fixture.select_arm("shadow-run");
        for arm in &mut fixture.plan.arms {
            let mut config: RuntimeConfig =
                evidence::read(fixture.root.path(), &arm.runtime_config).unwrap();
            config.policies[0]
                .calibration
                .thresholds
                .insert("trigger".into(), 0.8);
            arm.runtime_config = save(fixture.root.path(), &arm.runtime_config.id, &config);
        }
        fixture.plan_ref = save(fixture.root.path(), "plan", &fixture.plan);
        run::enroll(
            &fixture.store(),
            &fixture.project,
            fixture.enrollment.clone(),
        )
        .unwrap();
        assert!(
            run::start(
                &fixture.store(),
                &fixture.project,
                "shadow-run",
                &fixture.plan_ref,
                &fixture.protocol_ref
            )
            .is_err()
        );
        let run = fixture.stored_run();
        assert_eq!(run.spent.provider_attempts, 0);
        assert!(run.attempts.is_empty());
        assert!(run.operations.is_empty());
    }

    #[test]
    fn shadow_dispatch_requires_a_calibrated_policy_for_the_requested_binding() {
        use blabla::expert::{
            pilot::{Error, Refusal},
            policy,
            provider::EvaluationRequest,
            trace,
        };
        let mut fixture = NativeFixture::new("run-off");
        fixture.shadow_checkpoint();
        let current = fixture.stored_run();
        let capture: BoundaryCapture = evidence::read(
            fixture.root.path(),
            current.enrollments["task::work"].capture.as_ref().unwrap(),
        )
        .unwrap();
        let config = &current.frozen.as_ref().unwrap().config;
        let (judgments, bindings) = trace::definitions(&fixture.project).unwrap();
        let binding = &bindings[1];
        assert!(config.policies.iter().all(|p| p.binding_id != binding.id()));
        let judgment = judgments
            .iter()
            .find(|j| j.id() == binding.judgment)
            .unwrap();
        let projection = capture
            .projections
            .iter()
            .find(|p| p.binding_id == binding.id())
            .unwrap();
        let mut event = capture.event.clone();
        event.observations = projection.observations.clone();
        let task = task::read(fixture.root.path(), "work").unwrap().unwrap();
        let request = EvaluationRequest {
            request_id: "uncalibrated-binding".into(),
            packet: project::expert::build_packet(
                &fixture.project,
                &task,
                &event,
                binding,
                &config.limits,
                &projection.history,
            )
            .unwrap(),
            judgment: judgment.clone(),
            question_fingerprint: policy::question_fingerprint(judgment),
            template_fingerprint: policy::template_fingerprint(judgment),
        };
        assert!(matches!(
            run::reserve_provider(&fixture.store(), &fixture.project, "shadow-run", &[request]),
            Err(Error::Refused(Refusal::PermitMismatch))
        ));
        let run = fixture.stored_run();
        assert_eq!(run.spent.provider_attempts, 0);
        assert_eq!(run.spent.evaluated_questions, 0);
        assert!(run.attempts.is_empty());
    }
    impl NativeFixture {
        fn cli_request(
            &self,
            group: &str,
            action: &str,
            request: &impl Serialize,
        ) -> std::process::Output {
            let reference = save(self.root.path(), "cli-request", request);
            cli::run_in(
                Some(self.root.path()),
                &cli::args(&[
                    "expert",
                    group,
                    action,
                    "--request",
                    &reference.path,
                    "--json",
                ]),
            )
        }
    }

    #[test]
    fn native_and_pilot_cli_keep_durable_uncertainty_nonzero() {
        use blabla::expert::pilot;
        let mut fixture = NativeFixture::new("run-off");
        let (permit, approval, checkpoint, operation, _) = fixture.prepared();
        let HostAction::WakeWorker { wake } = operation.payload.clone() else {
            panic!()
        };
        let requests = [
            (
                "native",
                "consume",
                json!({"kind":"consume","schema_version":1,"wake":wake,"task":checkpoint.key.task,"acceptance_epoch":1,"generation":1,"child_attestation":fixture.enrollment.child,"first_action_attestation":true}),
            ),
            (
                "native",
                "host-claim",
                serde_json::to_value(ClaimRequest {
                    schema_version: 1,
                    run_id: "advisory-run".into(),
                    operation_id: operation.operation_id.clone(),
                    request_sha256: calibration::canonical_sha256(&operation).unwrap(),
                    coordinator: fixture.enrollment.coordinator.clone(),
                })
                .unwrap(),
            ),
            (
                "native",
                "host-result",
                serde_json::to_value(HostResult {
                    schema_version: 1,
                    operation_id: operation.operation_id.clone(),
                    request_sha256: calibration::canonical_sha256(&operation).unwrap(),
                    key: checkpoint.key.clone(),
                    evidence: fixture.plan_ref.clone(),
                    payload: HostOutcome::Unknown {
                        reason: UnknownReason::ToolError,
                    },
                })
                .unwrap(),
            ),
            (
                "native",
                "start-run",
                json!({"kind":"start_run","schema_version":1,"run_id":"advisory-run","native_plan":fixture.plan_ref,"protocol":fixture.protocol_ref}),
            ),
            (
                "native",
                "advance",
                json!({"kind":"advance","schema_version":1,"run_id":"advisory-run","native_plan_sha256":calibration::canonical_sha256(&fixture.plan).unwrap(),"coordinator":fixture.enrollment.coordinator}),
            ),
            (
                "pilot",
                "issue",
                serde_json::to_value(pilot::PermitRequest::Issue {
                    schema_version: 1,
                    spec: Box::new(permit.spec.clone()),
                    approval: approval.clone(),
                })
                .unwrap(),
            ),
            (
                "pilot",
                "revoke",
                serde_json::to_value(pilot::PermitRequest::Revoke {
                    schema_version: 1,
                    authority: permit.authority(),
                    reason: "test stop".into(),
                    approval,
                })
                .unwrap(),
            ),
            ("pilot", "show", serde_json::Value::Null),
        ];
        let path = fixture.root.path().join(".blabla/expert/ledger.json");
        let original = std::fs::read(&path).unwrap();
        for fault in ["storage_missing", "storage_corrupt", "clock_uncertain"] {
            for (group, action, request) in &requests {
                std::fs::write(&path, &original).unwrap();
                match fault {
                    "storage_missing" => std::fs::remove_file(&path).unwrap(),
                    "storage_corrupt" => std::fs::write(&path, b"{").unwrap(),
                    _ => {
                        let mut ledger: serde_json::Value =
                            serde_json::from_slice(&original).unwrap();
                        ledger["experimental_runs"]["advisory-run"]["last_clock"]["boot_id"] =
                            json!("another-boot");
                        std::fs::write(&path, serde_json::to_vec(&ledger).unwrap()).unwrap();
                    }
                }
                let output = if *action == "show" {
                    cli::run_in(
                        Some(fixture.root.path()),
                        &cli::args(&["expert", "pilot", "show", "--run", "advisory-run", "--json"]),
                    )
                } else {
                    fixture.cli_request(group, action, request)
                };
                assert_eq!(
                    output.status.code(),
                    Some(4),
                    "{group} {action} {fault}: {} {}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
                let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
                if !matches!(*action, "start-run" | "advance") {
                    assert_eq!(value["code"], fault);
                    assert_eq!(
                        value["kind"],
                        if *action == "consume" {
                            "no_advice"
                        } else {
                            "refused"
                        }
                    );
                }
            }
        }
    }

    #[test]
    fn native_cli_distinguishes_invalid_input_from_semantic_refusal() {
        let fixture = NativeFixture::new("run-off");
        let work = fixture.begin_work();
        let request = json!({"kind":"capture_boundary","schema_version":1,"work_key":work.key,"child_attestation":fixture.enrollment.child,"statements":[{"statement_id":"bad id","slot":"claim","text":"A statement."}],"final_boundary":false});
        let output = fixture.cli_request("native", "capture-boundary", &request);
        assert_eq!(output.status.code(), Some(2));
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["kind"], "no_advice");
        assert_eq!(value["code"], "invalid_input");
        let output = fixture.cli_request("native", "consume", &json!({"kind":"consume","schema_version":1,"wake":{"kind":"blabla_native_wake","schema_version":1,"run_id":"run-off","checkpoint_id":"unknown","wake_nonce":"a".repeat(32)},"task":"task::work","acceptance_epoch":1,"generation":1,"child_attestation":fixture.enrollment.child,"first_action_attestation":true}));
        assert_eq!(output.status.code(), Some(0));
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["kind"], "no_advice");
        assert_eq!(value["code"], "identity_mismatch");
        let output = fixture.cli_request(
            "native",
            "host-claim",
            &ClaimRequest {
                schema_version: 1,
                run_id: "run-off".into(),
                operation_id: "unknown".into(),
                request_sha256: "a".repeat(64),
                coordinator: fixture.enrollment.coordinator.clone(),
            },
        );
        assert_eq!(output.status.code(), Some(0));
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["kind"], "refused");
        assert_eq!(value["code"], "identity_mismatch");
        let output = cli::run_in(
            Some(fixture.root.path()),
            &cli::args(&["expert", "pilot", "show", "--run", "run-off", "--json"]),
        );
        assert_eq!(output.status.code(), Some(0));
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["kind"], "refused");
        assert_eq!(value["code"], "permit_missing");
    }

    #[test]
    fn native_cli_keeps_a_committed_uncertain_stop_nonzero() {
        let fixture = NativeFixture::new("run-off");
        fixture.begin_work();
        let operation = fixture.pending();
        run::claim(
            &fixture.store(),
            &fixture.project,
            &ClaimRequest {
                schema_version: 1,
                run_id: "run-off".into(),
                operation_id: operation.operation_id.clone(),
                request_sha256: calibration::canonical_sha256(&operation).unwrap(),
                coordinator: fixture.enrollment.coordinator.clone(),
            },
        )
        .unwrap();
        let path = fixture.root.path().join(".blabla/expert/ledger.json");
        let mut ledger: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let operations = ledger["experimental_runs"]["run-off"]["operations"]
            .as_array_mut()
            .unwrap();
        operations
            .iter_mut()
            .find(|o| o["request"]["operation_id"] == operation.operation_id)
            .unwrap()["request"]["deadline_boottime_ms"] = json!(0);
        std::fs::write(&path, serde_json::to_vec(&ledger).unwrap()).unwrap();
        for _ in 0..2 {
            let output = fixture.cli_request("native", "advance", &json!({"kind":"advance","schema_version":1,"run_id":"run-off","native_plan_sha256":calibration::canonical_sha256(&fixture.plan).unwrap(),"coordinator":fixture.enrollment.coordinator}));
            assert_eq!(output.status.code(), Some(4));
            let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
            assert_eq!(value["kind"], "arm_stopped");
            assert_eq!(value["code"], "uncertain_delivery");
            assert_eq!(
                fixture.stored_run().stopped,
                Some(blabla::expert::pilot::Refusal::UncertainDelivery)
            );
        }
    }
    #[test]
    fn native_large_payloads_preserve_closed_wire_shape_and_canonical_hashes() {
        use blabla::expert::pilot;
        fn check<T: Serialize + DeserializeOwned>(value: &T, expected: serde_json::Value) {
            let bytes = serde_json::to_vec(value).unwrap();
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
                expected
            );
            assert_eq!(
                calibration::canonical_sha256(value).unwrap(),
                calibration::canonical_sha256(&expected).unwrap()
            );
            let decoded: T = decode(&bytes).unwrap();
            assert_eq!(serde_json::to_vec(&decoded).unwrap(), bytes);
            let mut extra = expected;
            extra["unexpected"] = json!(true);
            assert!(decode::<T>(&serde_json::to_vec(&extra).unwrap()).is_err());
        }
        let mut fixture = NativeFixture::new("run-off");
        let (permit, approval, _, operation, _) = fixture.prepared();
        check(
            &NativeRequest::Enroll {
                schema_version: 1,
                enrollment: Box::new(fixture.enrollment.clone()),
            },
            json!({"kind":"enroll","schema_version":1,"enrollment":fixture.enrollment}),
        );
        let host = HostNextResult::Pending {
            request: Box::new(operation.clone()),
        };
        let host_json = json!({"kind":"pending","request":operation});
        check(&host, host_json.clone());
        let mut missing = host_json;
        missing["request"]["key"]
            .as_object_mut()
            .unwrap()
            .remove("previous_sequence");
        assert!(decode::<HostNextResult>(&serde_json::to_vec(&missing).unwrap()).is_err());
        let marker = NativeMarker::Ready {
            schema_version: 1,
            run_id: "advisory-run".into(),
            task: "task::work".into(),
            acceptance_epoch: 1,
        };
        let selected = SelectedStatus::Completed {
            agent_name: fixture.enrollment.child.task_name.clone(),
            agent_id: None,
            marker: Box::new(marker.clone()),
        };
        let selected_json = json!({"kind":"completed","agent_name":fixture.enrollment.child.task_name,"agent_id":null,"marker":marker});
        check(&selected, selected_json.clone());
        let mut missing = selected_json;
        missing.as_object_mut().unwrap().remove("agent_id");
        assert!(decode::<SelectedStatus>(&serde_json::to_vec(&missing).unwrap()).is_err());
        check(
            &pilot::PermitRequest::Issue {
                schema_version: 1,
                spec: Box::new(permit.spec.clone()),
                approval: approval.clone(),
            },
            json!({"kind":"issue","schema_version":1,"spec":permit.spec,"approval":approval}),
        );
        check(
            &pilot::PermitResult::Issued {
                permit: Box::new(permit.clone()),
            },
            json!({"kind":"issued","permit":permit}),
        );
    }
}
