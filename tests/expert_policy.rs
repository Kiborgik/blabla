use blabla::expert::packet::{self, ContextValue};
use blabla::expert::policy::*;
use blabla::expert::provider::*;
use blabla::expert::trace::*;
use blabla::expert::*;
use blabla::memory::knowledge::{Judgment, JudgmentOutput};
use blabla::project::task::revision::RelevantRevision;
use std::collections::BTreeMap;
use tempfile::TempDir;

fn fixture() -> (EvaluationRequest, EvaluationResponse, PolicySettings) {
    let judgment = Judgment {
        name: "claim-support".into(),
        pack: "review".into(),
        purpose: "Check support.".into(),
        question: "Is the claim supported?".into(),
        criteria: "Evidence must establish the claim.".into(),
        requires: vec![ContextSlot::Claim, ContextSlot::Evidence],
        optional: vec![ContextSlot::Task],
        output: JudgmentOutput::Noul {
            proposition: "The claim is supported.".into(),
        },
        templates: vec![TemplateKind::CiteEvidence],
    };
    let revision = RelevantRevision {
        acceptance_epoch: 1,
        task_digest: "1234567890abcdef".into(),
        paths: BTreeMap::new(),
        identities: BTreeMap::from([(
            "judgment::review::claim-support".into(),
            "abcdef1234567890".into(),
        )]),
    };
    let observed_revision = revision.fingerprint();
    let obs = |id: &str, slot, capture: &str, kind, text: &str| Observation {
        id: id.into(),
        slot,
        capture: capture.into(),
        kind,
        text: text.into(),
        observed_revision: observed_revision.clone(),
        fact: None,
    };
    let mut packet = packet::ExpertPacket {
        event: EventStamp {
            event_id: "event-1".into(),
            run_id: "run-1".into(),
            task: "task::work".into(),
            checkpoint_id: "checkpoint-1".into(),
            sequence: 1,
            previous_sequence: None,
            unix_ms: 1,
            kind: CheckpointKind::Claim,
            host: HostCapabilities {
                host: "fixture".into(),
                version: "1".into(),
                adapter: "fixture".into(),
                checkpoints: vec![CheckpointKind::Claim],
                pauses_worker: true,
                same_task_delivery: true,
                delivery_receipts: true,
                pre_tool_control: false,
                gaps: vec![],
            },
        },
        binding_id: "binding::support".into(),
        revision,
        context: BTreeMap::from([
            (
                ContextSlot::Claim,
                ContextValue::Present {
                    observations: vec![],
                },
            ),
            (
                ContextSlot::Evidence,
                ContextValue::Present {
                    observations: vec![],
                },
            ),
            (ContextSlot::Task, ContextValue::Missing),
        ]),
        references: BTreeMap::from([("evidence::check-1".into(), "Command exited 1.".into())]),
        history: vec![],
        accounting: PacketAccounting {
            selected_bytes: 0,
            omitted_bytes: 0,
            estimated_tokens: 0,
            provider_tokens: None,
        },
        hash: String::new(),
    };
    packet.context.insert(
        ContextSlot::Claim,
        ContextValue::Present {
            observations: vec![obs(
                "claim-1",
                ContextSlot::Claim,
                "host:excerpt",
                SourceKind::WorkerStatement,
                "The check passes.",
            )],
        },
    );
    packet.context.insert(
        ContextSlot::Evidence,
        ContextValue::Present {
            observations: vec![Observation {
                fact: Some(ObservedFact::CommandExit {
                    argv: vec!["check".into()],
                    exit: 1,
                }),
                ..obs(
                    "evidence::check-1",
                    ContextSlot::Evidence,
                    "local:task-evidence",
                    SourceKind::DeterministicOutput,
                    "Command exited 1.",
                )
            }],
        },
    );
    packet.accounting.selected_bytes = packet::selected_bytes(&packet);
    packet.accounting.estimated_tokens = packet.accounting.selected_bytes.div_ceil(4);
    packet.hash = packet::canonical_hash(&packet);
    let request = EvaluationRequest {
        request_id: "request-1".into(),
        packet,
        question_fingerprint: question_fingerprint(&judgment),
        template_fingerprint: template_fingerprint(&judgment),
        judgment,
    };
    let provider = ProviderIdentity {
        provider: "fixture".into(),
        model: "fixture-model".into(),
        checkpoint: "fixture-checkpoint".into(),
        supported_outputs: vec![OutputKind::Noul],
        probabilities: true,
        certification: Some("isolated-test-only".into()),
    };
    let mut settings = PolicySettings {
        binding_id: "binding::support".into(),
        concern: ConcernKind::UnsupportedClaim,
        rules: vec![PolicyRule {
            id: "unsupported".into(),
            predicate: Predicate::NoulValue { value: false },
            outcome: AdvisoryOutcome::Nudge,
            template: Some(TemplateKind::CiteEvidence),
            reference: ReferenceSelection::Slot {
                slot: ContextSlot::Evidence,
            },
        }],
        calibration: CalibrationRecord {
            record_id: "test-only".into(),
            provider: provider.clone(),
            question_fingerprint: request.question_fingerprint.clone(),
            template_fingerprint: request.template_fingerprint.clone(),
            policy_fingerprint: String::new(),
            development_fingerprint: "1234567890abcdef".into(),
            thresholds: BTreeMap::new(),
        },
    };
    settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
    let response = EvaluationResponse {
        request_id: request.request_id.clone(),
        packet_hash: request.packet.hash.clone(),
        question_fingerprint: request.question_fingerprint.clone(),
        template_fingerprint: request.template_fingerprint.clone(),
        provider,
        timing: EvaluationTiming {
            queue_ms: 0,
            inference_ms: 1,
            total_ms: 1,
        },
        usage: ProviderUsage {
            input_tokens: Some(11),
            output_tokens: Some(3),
            reported_latency_ms: None,
        },
        provider_request_id: None,
        self_report: None,
        diagnostic: None,
        outcome: Ok(TypedAnswer::Noul {
            value: Some(false),
            probability: Some(0.1),
            confidence: None,
        }),
    };
    (request, response, settings)
}

#[test]
fn deterministic_answer_maps_to_silence_abstain_nudge_or_escalation() {
    let (request, mut response, mut settings) = fixture();
    for outcome in [
        AdvisoryOutcome::Silence,
        AdvisoryOutcome::Abstain,
        AdvisoryOutcome::Nudge,
        AdvisoryOutcome::Escalation,
    ] {
        settings.rules[0].outcome = outcome;
        settings.rules[0].template = if matches!(
            outcome,
            AdvisoryOutcome::Nudge | AdvisoryOutcome::Escalation
        ) {
            Some(TemplateKind::CiteEvidence)
        } else {
            None
        };
        settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
        assert_eq!(decide(&request, &response, &settings, &[]).outcome, outcome);
    }
    response.outcome = Err(ProviderFailure::Timeout);
    assert_eq!(
        decide(&request, &response, &settings, &[]).reason,
        "provider_timeout"
    );
}

#[test]
fn unknown_reference_abstains_before_render() {
    let (request, response, mut settings) = fixture();
    settings.rules[0].reference = ReferenceSelection::Identity {
        id: "evidence::unknown".into(),
    };
    settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
    let result = decide(&request, &response, &settings, &[]);
    assert_eq!(result.outcome, AdvisoryOutcome::Abstain);
    assert!(result.message.is_none());
    let mut forged = result;
    forged.outcome = AdvisoryOutcome::Nudge;
    forged.template = Some(TemplateKind::CiteEvidence);
    forged.references = vec!["evidence::unknown".into()];
    assert!(render(&forged, &request.packet).is_err());
}

#[test]
fn expertise_selection_without_usefulness_is_silent() {
    let (mut request, mut response, mut settings) = fixture();
    request.judgment.name = "expertise-selection".into();
    request.judgment.output = JudgmentOutput::Choice {
        alternatives: vec!["candidate-1".into(), "none".into()],
    };
    request.question_fingerprint = question_fingerprint(&request.judgment);
    response.question_fingerprint = request.question_fingerprint.clone();
    response.provider.supported_outputs = vec![OutputKind::Choice];
    response.outcome = Ok(TypedAnswer::Choice {
        pick: "candidate-1".into(),
        probabilities: None,
        confidence: None,
    });
    settings.calibration.provider = response.provider.clone();
    settings.calibration.question_fingerprint = request.question_fingerprint.clone();
    settings.rules[0].predicate = Predicate::ChoiceLabel {
        label: "candidate-1".into(),
    };
    settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
    assert_eq!(
        decide(&request, &response, &settings, &[]).outcome,
        AdvisoryOutcome::Silence
    );
}

#[test]
fn same_unresolved_concern_is_suppressed() {
    let (request, response, settings) = fixture();
    let history = [InterventionSummary {
        request_id: "earlier".into(),
        concern: "unsupported_claim".into(),
        target: "evidence::check-1".into(),
        state: DeliveryState::Delivered,
        evidence_revision: material_fingerprint(&request.packet),
    }];
    assert_eq!(
        decide(&request, &response, &settings, &history).reason,
        "unresolved_concern"
    );
}

#[test]
fn material_evidence_change_allows_reconsideration() {
    let (mut request, response, settings) = fixture();
    let history = [InterventionSummary {
        request_id: "earlier".into(),
        concern: "unsupported_claim".into(),
        target: "evidence::check-1".into(),
        state: DeliveryState::Acknowledged,
        evidence_revision: material_fingerprint(&request.packet),
    }];
    request.packet.event.unix_ms += 100000;
    request.packet.event.sequence = 2;
    request.packet.event.previous_sequence = Some(1);
    request.packet.event.checkpoint_id = "checkpoint-2".into();
    request.packet.hash = packet::canonical_hash(&request.packet);
    let mut response = response;
    response.packet_hash = request.packet.hash.clone();
    assert_eq!(
        decide(&request, &response, &settings, &history).reason,
        "unresolved_concern"
    );
    request
        .packet
        .references
        .insert("evidence::check-1".into(), "A new check exited 2.".into());
    if let Some(ContextValue::Present { observations }) =
        request.packet.context.get_mut(&ContextSlot::Evidence)
    {
        observations[0].text = "A new check exited 2.".into();
    }
    request.packet.accounting.selected_bytes = packet::selected_bytes(&request.packet);
    request.packet.accounting.estimated_tokens =
        request.packet.accounting.selected_bytes.div_ceil(4);
    request.packet.hash = packet::canonical_hash(&request.packet);
    response.packet_hash = request.packet.hash.clone();
    assert_eq!(
        decide(&request, &response, &settings, &history).outcome,
        AdvisoryOutcome::Nudge
    );
}

#[test]
fn acknowledged_is_not_resolved() {
    let (request, response, settings) = fixture();
    for state in [
        DeliveryState::Acknowledged,
        DeliveryState::Declined,
        DeliveryState::Unknown,
    ] {
        let history = [InterventionSummary {
            request_id: "earlier".into(),
            concern: "unsupported_claim".into(),
            target: "evidence::check-1".into(),
            state,
            evidence_revision: material_fingerprint(&request.packet),
        }];
        assert_eq!(
            decide(&request, &response, &settings, &history).outcome,
            AdvisoryOutcome::Silence
        );
    }
}

#[test]
fn saved_response_replay_is_byte_stable() {
    let (request, response, settings) = fixture();
    let record = TraceRecord::new(
        request,
        response,
        settings,
        ExpertMode::Shadow,
        Provenance::Imported,
        None,
        ExpertLimits::default(),
    )
    .unwrap();
    let serialized = serde_json::to_vec(&record).unwrap();
    if let Ok(path) = std::env::var("BLABLA_EXPORT_EXPERT_TRACE") {
        std::fs::write(path, &serialized).unwrap();
    }
    let restored: TraceRecord = decode_json(&serialized, MAX_TRACE_BYTES).unwrap();
    assert_eq!(
        serde_json::to_vec(&replay(&record).unwrap()).unwrap(),
        serde_json::to_vec(&replay(&restored).unwrap()).unwrap()
    );
}

#[test]
fn calibration_change_and_rounding_straddle_abstain() {
    let (request, mut response, mut settings) = fixture();
    settings.calibration.question_fingerprint = "different".into();
    assert_eq!(
        decide(&request, &response, &settings, &[]).reason,
        "calibration_mismatch"
    );
    settings.calibration.question_fingerprint = request.question_fingerprint.clone();
    settings.rules[0].predicate = Predicate::NoulProbability { value: false };
    settings
        .calibration
        .thresholds
        .insert("unsupported".into(), 0.9);
    settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
    response.outcome = Ok(TypedAnswer::Noul {
        value: None,
        probability: Some(0.1),
        confidence: None,
    });
    assert_eq!(
        decide(&request, &response, &settings, &[]).reason,
        "rounding_uncertainty"
    );
}

#[test]
fn ledger_survives_payload_deletion_and_retention() {
    let root = TempDir::new().unwrap();
    let (request, response, settings) = fixture();
    let record = TraceRecord::new(
        request,
        response,
        settings,
        ExpertMode::Shadow,
        Provenance::Imported,
        None,
        ExpertLimits::default(),
    )
    .unwrap();
    let store = TraceStore::new(root.path(), TraceLimits::default()).unwrap();
    store.record(&record).unwrap();
    assert_eq!(store.traces().unwrap().len(), 1);
    store.delete_run("run-1").unwrap();
    assert!(store.traces().unwrap()[0].payload_omitted);
}

struct LocalFixture {
    root: TempDir,
    project: blabla::project::Project,
    task: blabla::project::task::Task,
    event: ObservedEvent,
    record: TraceRecord,
    config: RuntimeConfig,
}

impl LocalFixture {
    fn new() -> Self {
        use blabla::memory::{self, knowledge, process};
        use blabla::project::{self, task};
        let root = TempDir::new().unwrap();
        let memory = r#"knowledge "review" { purpose "Bounded review." }
judgment "claim-support" { pack "review" purpose "Check support." question "Is the claim supported?" criteria "Evidence must establish the claim." requires ["claim", "evidence"] optional ["task"] output "noul" proposition "The claim is supported." templates ["cite-evidence"] }"#;
        let process = r#"role "worker" { purpose "Work." }
binding "support" { judgment "judgment::review::claim-support" roles ["worker"] checkpoints ["claim"] }"#;
        for (path, text) in [
            (
                "project.bla",
                "project Delivery\nknowledge \"knowledge.bla\"\nprocess \"process.bla\"\n",
            ),
            ("knowledge.bla", memory),
            ("process.bla", process),
            ("input.txt", "first"),
        ] {
            std::fs::write(root.path().join(path), text).unwrap();
        }
        let project =
            project::load(project::read_manifest(&root.path().join("project.bla")).unwrap())
                .unwrap();
        let mut task = task::Task {
            name: "work".into(),
            role: "worker".into(),
            statement: "Check the input.".into(),
            state: "accepted".into(),
            scope: vec!["input.txt".into()],
            check_inputs: vec!["input.txt".into()],
            check_argv: Some(vec!["check".into(), "input.txt".into()]),
            acceptance_epoch: 1,
            ..task::Task::default()
        };
        let tree = project::snapshot(root.path(), &project.ignore);
        task.evidence.push(task::Evidence {
            identity: Some(task::CheckIdentity::Argv {
                argv: task.check_argv.clone().unwrap(),
            }),
            acceptance_epoch: Some(1),
            check: "check input.txt".into(),
            exit: 0,
            tree: "unused".into(),
            tool: "run".into(),
            unix: 1,
            inputs: task::evidence_inputs(&task, &tree),
            command: task.check_argv.clone(),
            log: None,
        });
        task::write(root.path(), &task).unwrap();
        let judgment = knowledge::build(&memory::syntax::parse("knowledge.bla", memory).unwrap())
            .unwrap()
            .judgments
            .remove(0);
        let binding = process::build(&memory::syntax::parse("process.bla", process).unwrap())
            .unwrap()
            .bindings
            .remove(0);
        let mut event = fixture().0.packet.event;
        event.task = "task::work".into();
        let mut event = ObservedEvent {
            event_id: event.event_id,
            run_id: event.run_id,
            task: event.task,
            checkpoint_id: event.checkpoint_id,
            sequence: event.sequence,
            previous_sequence: event.previous_sequence,
            unix_ms: event.unix_ms,
            kind: event.kind,
            host: event.host,
            observations: vec![],
        };
        let revision = project::expert::build_packet(
            &project,
            &task,
            &event,
            &binding,
            &ExpertLimits::default(),
            &[],
        )
        .unwrap()
        .revision
        .fingerprint();
        event.observations.push(Observation {
            id: "claim-1".into(),
            slot: ContextSlot::Claim,
            kind: SourceKind::WorkerStatement,
            capture: "host:excerpt".into(),
            observed_revision: revision,
            text: "The claim is supported.".into(),
            fact: None,
        });
        let packet = project::expert::build_packet(
            &project,
            &task,
            &event,
            &binding,
            &ExpertLimits::default(),
            &[],
        )
        .unwrap();
        let mut request = fixture().0;
        request.packet = packet;
        request.judgment = judgment;
        request.question_fingerprint = question_fingerprint(&request.judgment);
        request.template_fingerprint = template_fingerprint(&request.judgment);
        let (_, mut response, mut settings) = fixture();
        response.packet_hash = request.packet.hash.clone();
        response.question_fingerprint = request.question_fingerprint.clone();
        response.template_fingerprint = request.template_fingerprint.clone();
        settings.calibration.question_fingerprint = request.question_fingerprint.clone();
        settings.calibration.template_fingerprint = request.template_fingerprint.clone();
        let mut record = TraceRecord::new(
            request,
            response,
            settings.clone(),
            ExpertMode::Advisory,
            Provenance::LocalCheckpoint,
            None,
            ExpertLimits::default(),
        )
        .unwrap();
        let promotion = PromotionRecord {
            record_id: "isolated-test-promotion".into(),
            evidence_kind: PromotionEvidenceKind::MatchedLiveExpanded,
            protocol_fingerprint: "isolated-test-protocol".into(),
            holdout_fingerprint: "isolated-test-holdout".into(),
            matched_snapshot_fingerprint: record.request.packet.revision.fingerprint(),
            calibration_fingerprint: packet::digest(&settings.calibration),
            provider: record.response.provider.clone(),
            host: event.host.clone(),
            binding_id: record.request.packet.binding_id.clone(),
            question_fingerprint: record.request.question_fingerprint.clone(),
            template_fingerprint: record.request.template_fingerprint.clone(),
            policy_fingerprint: policy_fingerprint(&settings),
            implementation_fingerprint: packet::digest(&record.implementation_fingerprints),
            budget: FrozenBudget {
                false_nudge_max: 0.05,
                p95_delivery_ms: 1500,
                min_held_out_delivered: 60,
                min_justified_opportunities: 20,
                min_evaluable_coverage: 0.9,
                confidence_level: 0.95,
            },
            held_out: HeldOutSummary {
                delivered_nudges: 60,
                false_nudges: 0,
                justified_opportunities: 20,
                missed_opportunities: 0,
                evaluable_checkpoints: 100,
                planned_checkpoints: 100,
                quality_upper_bound: Some(quality_upper_bound(0, 60)),
                p95_delivery_ms: Some(1.0),
                complete: true,
            },
            matched_live_passed: true,
            observed_steering_passed: true,
            evidence_ids: vec!["evidence::work::1".into()],
        };
        let config = RuntimeConfig {
            mode: ExpertMode::Advisory,
            provider: Some(ConfiguredProvider {
                identity: record.response.provider.clone(),
                argv: vec!["isolated-test-provider".into()],
            }),
            host: Some(event.host.clone()),
            policies: vec![settings],
            promotions: vec![promotion],
            ..RuntimeConfig::default()
        };
        record.runtime_fingerprint = Some(packet::digest(&config));
        Self {
            root,
            project,
            task,
            event,
            record,
            config,
        }
    }
    fn store(&self) -> TraceStore {
        TraceStore::new(self.root.path(), self.config.trace_limits.clone()).unwrap()
    }
    fn persist(&self) {
        let store = self.store();
        store.set_runtime(&self.config).unwrap();
        store.advance_checkpoint(&self.event).unwrap();
        store.record(&self.record).unwrap();
    }
    fn reserve(&self) -> DeliveryProposal {
        self.store()
            .reserve(
                &self.record.request.request_id,
                &self.event.checkpoint_id,
                &self.project,
            )
            .unwrap()
    }
}

#[test]
fn duplicate_checkpoint_has_one_delivery() {
    let fixture = LocalFixture::new();
    fixture.persist();
    let first = fixture.reserve();
    assert_eq!(first.result.outcome, AdvisoryOutcome::Nudge);
    assert!(first.idempotency_key.is_some());
    let duplicate = fixture.reserve();
    assert_eq!(duplicate.result.reason, "duplicate_delivery");
    assert!(duplicate.result.message.is_none());
}

#[test]
fn concurrent_delivery_reserves_once() {
    let fixture = LocalFixture::new();
    fixture.persist();
    let outcomes = std::thread::scope(|scope| {
        let first = scope.spawn(|| fixture.reserve());
        let second = scope.spawn(|| fixture.reserve());
        [first.join().unwrap(), second.join().unwrap()]
    });
    assert_eq!(
        outcomes
            .iter()
            .filter(|proposal| proposal.idempotency_key.is_some())
            .count(),
        1
    );
}

#[test]
fn late_result_is_stale() {
    let fixture = LocalFixture::new();
    fixture.persist();
    std::fs::write(fixture.root.path().join("input.txt"), "replacement").unwrap();
    let result = fixture.reserve();
    assert_eq!(result.state, DeliveryState::Stale);
    assert_eq!(result.result.reason, "stale_revision");
    assert!(result.result.message.is_none());
}

#[test]
fn host_checkpoint_advance_is_stale() {
    let mut fixture = LocalFixture::new();
    fixture.persist();
    fixture.event.sequence = 2;
    fixture.event.previous_sequence = Some(1);
    fixture.event.checkpoint_id = "checkpoint-2".into();
    fixture.store().advance_checkpoint(&fixture.event).unwrap();
    assert_eq!(
        fixture
            .store()
            .reserve(
                &fixture.record.request.request_id,
                "checkpoint-1",
                &fixture.project
            )
            .unwrap()
            .result
            .reason,
        "stale_checkpoint"
    );
}

#[test]
fn restart_after_uncertain_delivery_does_not_redeliver() {
    let fixture = LocalFixture::new();
    fixture.persist();
    assert_eq!(fixture.reserve().state, DeliveryState::Unknown);
    let reopened = TraceStore::new(fixture.root.path(), TraceLimits::default()).unwrap();
    assert_eq!(
        reopened
            .reserve(
                &fixture.record.request.request_id,
                &fixture.event.checkpoint_id,
                &fixture.project
            )
            .unwrap()
            .result
            .reason,
        "duplicate_delivery"
    );
    reopened.delete_run(&fixture.event.run_id).unwrap();
    assert_eq!(
        reopened.history(&fixture.event.task, 1).unwrap()[0].state,
        DeliveryState::Unknown
    );
}

#[test]
fn missing_or_synthetic_promotion_stays_shadow() {
    let mut fixture = LocalFixture::new();
    fixture.config.promotions.clear();
    fixture.record.runtime_fingerprint = Some(packet::digest(&fixture.config));
    fixture.persist();
    assert_eq!(fixture.reserve().result.reason, "promotion_required");
    let mut fixture = LocalFixture::new();
    fixture.config.promotions[0].evidence_kind = PromotionEvidenceKind::Synthetic;
    fixture.record.runtime_fingerprint = Some(packet::digest(&fixture.config));
    fixture.persist();
    assert_eq!(fixture.reserve().result.reason, "promotion_required");
}

#[test]
fn imported_packet_cannot_deliver_even_with_valid_local_captures() {
    let mut fixture = LocalFixture::new();
    fixture.record.provenance = Provenance::Imported;
    fixture.persist();
    assert_eq!(fixture.reserve().result.reason, "untrusted_provenance");
}

#[test]
fn repeated_evidence_with_only_new_history_ids_does_not_reopen() {
    let (mut request, _, _) = fixture();
    let prior = material_fingerprint(&request.packet);
    if let Some(ContextValue::Present { observations }) =
        request.packet.context.get_mut(&ContextSlot::Claim)
    {
        observations[0].id = "replacement-claim-id".into();
    }
    assert_eq!(material_fingerprint(&request.packet), prior);
}

#[test]
fn shared_batch_usage_is_counted_once_per_local_batch() {
    let (request, response, settings) = fixture();
    let first = TraceRecord::new(
        request,
        response,
        settings,
        ExpertMode::Shadow,
        Provenance::Imported,
        Some("local-batch-a".into()),
        ExpertLimits::default(),
    )
    .unwrap();
    let mut second = first.clone();
    second.request.request_id = "request-2".into();
    second.response.request_id = "request-2".into();
    assert_eq!(
        aggregate_usage(&[first.clone(), second.clone()]).input_tokens,
        Some(11)
    );
    second.local_batch_id = Some("local-batch-b".into());
    assert_eq!(aggregate_usage(&[first, second]).input_tokens, Some(22));
}

#[test]
fn arbitrary_host_observation_cannot_acknowledge_another_request() {
    let mut fixture = LocalFixture::new();
    fixture.persist();
    fixture.reserve();
    fixture.event.sequence = 2;
    fixture.event.previous_sequence = Some(1);
    fixture.event.checkpoint_id = "checkpoint-2".into();
    fixture.event.observations = vec![Observation {
        id: "host-receipt".into(),
        slot: ContextSlot::Evidence,
        kind: SourceKind::HostObservation,
        capture: "host:receipt".into(),
        observed_revision: fixture.record.request.packet.revision.fingerprint(),
        text: "An unrelated acknowledgment.".into(),
        fact: None,
    }];
    fixture.store().advance_checkpoint(&fixture.event).unwrap();
    assert!(
        fixture
            .store()
            .receipt(
                "request-1",
                DeliveryState::Acknowledged,
                "host-receipt",
                &fixture.project
            )
            .is_err()
    );
}

#[test]
fn explicit_terminal_cleanup_does_not_apply_to_open_task() {
    let mut fixture = LocalFixture::new();
    fixture.persist();
    fixture.reserve();
    assert!(fixture.store().cleanup_terminal("work").is_err());
    fixture.task.state = "closed".into();
    blabla::project::task::write(fixture.root.path(), &fixture.task).unwrap();
    assert_eq!(fixture.store().cleanup_terminal("work").unwrap(), 1);
    assert!(fixture.store().history("task::work", 1).unwrap().is_empty());
}

#[test]
fn trace_and_config_metadata_cannot_persist_credentials() {
    let root = TempDir::new().unwrap();
    let store = TraceStore::new(root.path(), TraceLimits::default()).unwrap();
    let (request, mut response, settings) = fixture();
    response.provider.certification = Some("api_key=secretcredential123456789".into());
    let mut settings = settings;
    settings.calibration.provider = response.provider.clone();
    let record = TraceRecord::new(
        request,
        response,
        settings,
        ExpertMode::Shadow,
        Provenance::Imported,
        None,
        ExpertLimits::default(),
    );
    assert!(record.is_err() || store.record(&record.unwrap()).is_err());
    let mut config = RuntimeConfig {
        provider: Some(ConfiguredProvider {
            identity: fixture().1.provider,
            argv: vec!["provider".into()],
        }),
        ..RuntimeConfig::default()
    };
    config.provider.as_mut().unwrap().identity.certification =
        Some("api_key=secretcredential123456789".into());
    assert!(store.set_runtime(&config).is_err());
}

#[cfg(unix)]
#[test]
fn expert_store_rejects_symlinked_storage() {
    let root = TempDir::new().unwrap();
    let destination = TempDir::new().unwrap();
    std::fs::create_dir(root.path().join(".blabla")).unwrap();
    std::os::unix::fs::symlink(destination.path(), root.path().join(".blabla/expert")).unwrap();
    let store = TraceStore::new(root.path(), TraceLimits::default());
    assert!(
        store.is_err()
            || store
                .unwrap()
                .set_runtime(&RuntimeConfig::default())
                .is_err()
    );
    assert!(!destination.path().join("runtime.json").exists());
}

#[test]
fn numeric_and_nested_json_fields_are_bounded() {
    let mut config = RuntimeConfig {
        policies: vec![fixture().2],
        ..RuntimeConfig::default()
    };
    config.policies[0].calibration.provider.model = "m".repeat(3000);
    assert!(config.validate().is_err());
    assert!(
        decode_json::<RuntimeConfig>(br#"{"mode":"off","mode":"shadow"}"#, MAX_CONFIG_BYTES)
            .is_err()
    );
}

#[test]
fn uncertain_receipt_requires_explicit_matching_reconciliation() {
    let mut fixture = LocalFixture::new();
    fixture.persist();
    let first = fixture.reserve();
    fixture.event.sequence = 2;
    fixture.event.previous_sequence = Some(1);
    fixture.event.checkpoint_id = "checkpoint-2".into();
    fixture.event.observations = vec![Observation {
        id: "host-reconcile".into(),
        slot: ContextSlot::Evidence,
        kind: SourceKind::HostObservation,
        capture: "host:receipt".into(),
        observed_revision: fixture.record.request.packet.revision.fingerprint(),
        text: serde_json::to_string(&HostReceiptObservation {
            request_id: "request-1".into(),
            idempotency_key: first.idempotency_key.clone().unwrap(),
            state: HostReceiptState::NotDelivered,
        })
        .unwrap(),
        fact: None,
    }];
    fixture.store().advance_checkpoint(&fixture.event).unwrap();
    assert!(
        fixture
            .store()
            .receipt(
                "request-1",
                DeliveryState::Proposed,
                "host-reconcile",
                &fixture.project
            )
            .is_ok()
    );
    assert!(fixture.store().history("task::work", 1).unwrap().is_empty());
    let ledger: serde_json::Value = serde_json::from_slice(
        &std::fs::read(fixture.root.path().join(".blabla/expert/ledger.json")).unwrap(),
    )
    .unwrap();
    let reconciled = &ledger["entries"][first.idempotency_key.unwrap()];
    assert_eq!(reconciled["state"], "proposed");
    assert_eq!(reconciled["receipts"].as_array().unwrap().len(), 1);
}

#[test]
fn identical_successful_check_rerun_is_not_corrective_resolution() {
    let mut fixture = LocalFixture::new();
    fixture.persist();
    fixture.reserve();
    let mut repeat = fixture.task.evidence[0].clone();
    repeat.unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    fixture.task.evidence.push(repeat);
    blabla::project::task::write(fixture.root.path(), &fixture.task).unwrap();
    assert!(
        fixture
            .store()
            .receipt(
                "request-1",
                DeliveryState::ObservedResolved,
                "evidence::work::2",
                &fixture.project
            )
            .is_err()
    );
}

#[test]
fn changed_relevant_input_with_current_success_is_corrective_resolution() {
    let mut fixture = LocalFixture::new();
    fixture.persist();
    fixture.reserve();
    std::fs::write(fixture.root.path().join("input.txt"), "corrected").unwrap();
    let mut corrected = fixture.task.evidence[0].clone();
    corrected.unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let tree = blabla::project::snapshot(fixture.root.path(), &fixture.project.ignore);
    corrected.inputs = blabla::project::task::evidence_inputs(&fixture.task, &tree);
    fixture.task.evidence.push(corrected);
    blabla::project::task::write(fixture.root.path(), &fixture.task).unwrap();
    assert!(
        fixture
            .store()
            .receipt(
                "request-1",
                DeliveryState::ObservedResolved,
                "evidence::work::2",
                &fixture.project
            )
            .is_ok()
    );
}

fn changed_claim_record(fixture: &mut LocalFixture) -> TraceRecord {
    fixture.event.sequence += 1;
    fixture.event.previous_sequence = Some(fixture.event.sequence - 1);
    fixture.event.checkpoint_id = format!("checkpoint-{}", fixture.event.sequence);
    fixture.event.event_id = format!("event-{}", fixture.event.sequence);
    fixture.event.observations[0].text = "A materially different claim.".into();
    let (_, bindings) = definitions(&fixture.project).unwrap();
    let packet = blabla::project::expert::build_packet(
        &fixture.project,
        &fixture.task,
        &fixture.event,
        &bindings[0],
        &ExpertLimits::default(),
        &[],
    )
    .unwrap();
    let mut record = fixture.record.clone();
    record.request.request_id = "request-2".into();
    record.request.packet = packet;
    record.response.request_id = record.request.request_id.clone();
    record.response.packet_hash = record.request.packet.hash.clone();
    record.result = decide(&record.request, &record.response, &record.settings, &[]);
    record
}

#[test]
fn material_reconsideration_preserves_prior_reservation() {
    let mut fixture = LocalFixture::new();
    fixture.persist();
    let first = fixture.reserve();
    delivered_receipt(&mut fixture, &first);
    let second = changed_claim_record(&mut fixture);
    fixture.store().advance_checkpoint(&fixture.event).unwrap();
    fixture.store().record(&second).unwrap();
    let second = fixture
        .store()
        .reserve("request-2", &fixture.event.checkpoint_id, &fixture.project)
        .unwrap();
    assert_eq!(second.result.outcome, AdvisoryOutcome::Nudge);
    assert_ne!(first.idempotency_key, second.idempotency_key);
    assert_eq!(fixture.store().history("task::work", 1).unwrap().len(), 2);
}

#[test]
fn configured_ledger_cap_is_used_by_default_store() {
    let mut fixture = LocalFixture::new();
    fixture.config.trace_limits.unresolved_per_task = 1;
    fixture.record.runtime_fingerprint = Some(packet::digest(&fixture.config));
    fixture.persist();
    let first = fixture.reserve();
    delivered_receipt(&mut fixture, &first);
    let second = changed_claim_record(&mut fixture);
    fixture.store().advance_checkpoint(&fixture.event).unwrap();
    fixture.store().record(&second).unwrap();
    let default_store = TraceStore::new(fixture.root.path(), TraceLimits::default()).unwrap();
    assert_eq!(
        default_store
            .reserve("request-2", &fixture.event.checkpoint_id, &fixture.project)
            .unwrap()
            .result
            .reason,
        "ledger_exhausted"
    );
}

fn delivered_receipt(fixture: &mut LocalFixture, delivery: &DeliveryProposal) {
    fixture.event.sequence += 1;
    fixture.event.previous_sequence = Some(fixture.event.sequence - 1);
    fixture.event.checkpoint_id = format!("checkpoint-{}", fixture.event.sequence);
    fixture.event.event_id = format!("event-{}", fixture.event.sequence);
    fixture.event.observations.push(Observation {
        id: "host-delivered".into(),
        slot: ContextSlot::Evidence,
        kind: SourceKind::HostObservation,
        capture: "host:receipt".into(),
        observed_revision: fixture.record.request.packet.revision.fingerprint(),
        text: serde_json::to_string(&HostReceiptObservation {
            request_id: delivery.request_id.clone(),
            idempotency_key: delivery.idempotency_key.clone().unwrap(),
            state: HostReceiptState::Delivered,
        })
        .unwrap(),
        fact: None,
    });
    fixture.store().advance_checkpoint(&fixture.event).unwrap();
    fixture
        .store()
        .receipt(
            &delivery.request_id,
            DeliveryState::Delivered,
            "host-delivered",
            &fixture.project,
        )
        .unwrap();
}

#[test]
fn uncertain_delivery_blocks_material_reconsideration_until_reconciled() {
    let mut fixture = LocalFixture::new();
    fixture.persist();
    fixture.reserve();
    let second = changed_claim_record(&mut fixture);
    fixture.store().advance_checkpoint(&fixture.event).unwrap();
    fixture.store().record(&second).unwrap();
    let second = fixture
        .store()
        .reserve("request-2", &fixture.event.checkpoint_id, &fixture.project)
        .unwrap();
    assert_eq!(second.result.reason, "uncertain_delivery");
    assert!(second.result.message.is_none());
    assert_eq!(fixture.store().history("task::work", 1).unwrap().len(), 1);
}

#[test]
fn delivery_receipt_history_is_not_material_evidence() {
    let mut fixture = LocalFixture::new();
    fixture.persist();
    let first = fixture.reserve();
    delivered_receipt(&mut fixture, &first);
    let (_, bindings) = definitions(&fixture.project).unwrap();
    let current = blabla::project::expert::build_packet(
        &fixture.project,
        &fixture.task,
        &fixture.event,
        &bindings[0],
        &ExpertLimits::default(),
        &[],
    )
    .unwrap();
    assert_eq!(
        material_fingerprint(&current),
        material_fingerprint(&fixture.record.request.packet)
    );
}

#[test]
fn packet_history_uses_reservation_chronology_after_store_filtering() {
    let mut fixture = LocalFixture::new();
    fixture.persist();
    let delivery = fixture.reserve();
    delivered_receipt(&mut fixture, &delivery);
    let ledger_path = fixture.root.path().join(".blabla/expert/ledger.json");
    let mut ledger: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&ledger_path).unwrap()).unwrap();
    let prototype = ledger["entries"][delivery.idempotency_key.unwrap()].clone();
    let entries = ledger["entries"].as_object_mut().unwrap();
    entries.clear();
    let mut keys = (0..15)
        .map(|index| packet::digest(&("history-key", index)))
        .collect::<Vec<_>>();
    keys.sort_unstable();
    for (index, key) in keys.into_iter().enumerate() {
        let mut entry = prototype.clone();
        entry["request_id"] = format!("history-request-{index}").into();
        entry["idempotency_key"] = key.clone().into();
        entry["reserved_unix_ms"] = if index == 8 { 93 } else { 100 - index as u64 }.into();
        match index {
            12 => entry["task"] = "task::other".into(),
            13 => entry["acceptance_epoch"] = 2.into(),
            14 => {
                entry["state"] = "proposed".into();
                entry["no_delivery_verified"] = true.into();
                entry["receipts"][0]["state"] = "proposed".into();
            }
            _ => {}
        }
        if index >= 12 {
            entry["reserved_unix_ms"] = 1000.into();
        }
        entries.insert(key, entry);
    }
    let persisted = serde_json::to_vec(&ledger).unwrap();
    std::fs::write(&ledger_path, &persisted).unwrap();
    let store = fixture.store();
    let history = store
        .history(&fixture.event.task, fixture.task.acceptance_epoch)
        .unwrap();
    let (_, bindings) = definitions(&fixture.project).unwrap();
    let packet = blabla::project::expert::build_packet(
        &fixture.project,
        &fixture.task,
        &fixture.event,
        &bindings[0],
        &ExpertLimits::default(),
        &history,
    )
    .unwrap();
    let expected_ids = |indices: &[usize]| {
        indices
            .iter()
            .map(|index| format!("history-request-{index}"))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        packet
            .history
            .iter()
            .map(|entry| entry.request_id.clone())
            .collect::<Vec<_>>(),
        expected_ids(&[8, 6, 5, 4, 3, 2, 1, 0])
    );
    assert_eq!(
        history
            .iter()
            .map(|entry| entry.request_id.clone())
            .collect::<Vec<_>>(),
        expected_ids(&[11, 10, 9, 7, 8, 6, 5, 4, 3, 2, 1, 0])
    );
    assert!(
        history
            .iter()
            .all(|entry| entry.state == DeliveryState::Delivered)
    );
    let baseline = blabla::project::expert::build_packet(
        &fixture.project,
        &fixture.task,
        &fixture.event,
        &bindings[0],
        &ExpertLimits::default(),
        &[],
    )
    .unwrap();
    let omitted_bytes = history[..4]
        .iter()
        .flat_map(|entry| {
            [
                &entry.request_id,
                &entry.concern,
                &entry.target,
                &entry.evidence_revision,
            ]
        })
        .map(String::len)
        .sum::<usize>();
    assert_eq!(
        packet.accounting.omitted_bytes,
        baseline.accounting.omitted_bytes + omitted_bytes
    );
    store.delete_run(&fixture.event.run_id).unwrap();
    assert_eq!(store.history(&fixture.event.task, 1).unwrap(), history);
    assert_eq!(std::fs::read(&ledger_path).unwrap(), persisted);
}

#[test]
fn failed_check_to_current_success_is_corrective_without_file_edit() {
    let mut fixture = LocalFixture::new();
    let mut failed = fixture.task.evidence[0].clone();
    failed.exit = 1;
    fixture.task.evidence.push(failed);
    blabla::project::task::write(fixture.root.path(), &fixture.task).unwrap();
    let (_, bindings) = definitions(&fixture.project).unwrap();
    fixture.record.request.packet = blabla::project::expert::build_packet(
        &fixture.project,
        &fixture.task,
        &fixture.event,
        &bindings[0],
        &ExpertLimits::default(),
        &[],
    )
    .unwrap();
    fixture.record.response.packet_hash = fixture.record.request.packet.hash.clone();
    fixture.record.result =
        deterministic_result(&fixture.record.request, Provenance::LocalCheckpoint).unwrap_or_else(
            || {
                decide(
                    &fixture.record.request,
                    &fixture.record.response,
                    &fixture.record.settings,
                    &[],
                )
            },
        );
    fixture.persist();
    fixture.reserve();
    let mut success = fixture.task.evidence[0].clone();
    success.unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    fixture.task.evidence.push(success);
    blabla::project::task::write(fixture.root.path(), &fixture.task).unwrap();
    assert!(
        fixture
            .store()
            .receipt(
                "request-1",
                DeliveryState::ObservedResolved,
                "evidence::work::3",
                &fixture.project
            )
            .is_ok()
    );
}

#[test]
fn deterministic_blockers_precede_model_inferences() {
    let (request, response, settings) = fixture();
    let local = TraceRecord::new(
        request.clone(),
        response.clone(),
        settings.clone(),
        ExpertMode::Shadow,
        Provenance::LocalCheckpoint,
        None,
        ExpertLimits::default(),
    )
    .unwrap();
    assert_eq!(local.result.reason, "deterministic_blocker");
    assert_eq!(local.result.outcome, AdvisoryOutcome::Escalation);
    let imported = TraceRecord::new(
        request,
        response,
        settings,
        ExpertMode::Shadow,
        Provenance::Imported,
        None,
        ExpertLimits::default(),
    )
    .unwrap();
    assert_eq!(imported.result.reason, "mapped_answer");
}

#[test]
fn receipt_growth_obeys_runtime_payload_cap_and_updates_index() {
    let mut fixture = LocalFixture::new();
    let size = serde_json::to_vec(&fixture.record).unwrap().len();
    fixture.config.trace_limits.payload_bytes = size + 1;
    fixture.record.runtime_fingerprint = Some(packet::digest(&fixture.config));
    fixture.persist();
    assert!(!fixture.store().traces().unwrap()[0].payload_omitted);
    let first = fixture.reserve();
    delivered_receipt(&mut fixture, &first);
    assert!(fixture.store().traces().unwrap()[0].payload_omitted);
}

#[test]
fn replacement_acceptance_metadata_is_not_corrective_resolution() {
    let mut fixture = LocalFixture::new();
    fixture.persist();
    fixture.reserve();
    fixture.task.acceptance_epoch = 2;
    let mut repeated = fixture.task.evidence[0].clone();
    repeated.acceptance_epoch = Some(2);
    repeated.unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    fixture.task.evidence.push(repeated);
    blabla::project::task::write(fixture.root.path(), &fixture.task).unwrap();
    assert!(
        fixture
            .store()
            .receipt(
                "request-1",
                DeliveryState::ObservedResolved,
                "evidence::work::2",
                &fixture.project
            )
            .is_err()
    );
}

#[test]
fn probability_only_answer_without_calibrated_predicate_abstains() {
    let (request, mut response, settings) = fixture();
    response.outcome = Ok(TypedAnswer::Noul {
        value: None,
        probability: Some(0.8),
        confidence: None,
    });
    assert_eq!(
        decide(&request, &response, &settings, &[]).reason,
        "missing_answer_statistic"
    );
}

#[test]
fn ordered_score_tail_uses_only_its_calibrated_threshold() {
    use blabla::memory::knowledge::JudgmentOutput;
    let (mut request, mut response, mut settings) = fixture();
    request.judgment.output = JudgmentOutput::Score {
        levels: vec!["justified".into(), "unclear".into(), "repeating".into()],
    };
    request.question_fingerprint = question_fingerprint(&request.judgment);
    response.question_fingerprint = request.question_fingerprint.clone();
    response.provider.supported_outputs = vec![OutputKind::Score];
    response.outcome = Ok(TypedAnswer::Score {
        level: None,
        distribution: Some(vec![0.2, 0.3, 0.5]),
        expectation: Some(1.3),
        confidence: None,
    });
    settings.rules[0].predicate = Predicate::ScoreTail {
        from_level: "repeating".into(),
    };
    settings.calibration.provider = response.provider.clone();
    settings.calibration.question_fingerprint = request.question_fingerprint.clone();
    settings
        .calibration
        .thresholds
        .insert("unsupported".into(), 0.4);
    settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
    assert_eq!(
        decide(&request, &response, &settings, &[]).outcome,
        AdvisoryOutcome::Nudge
    );
    settings
        .calibration
        .thresholds
        .insert("unsupported".into(), 0.5);
    assert_eq!(
        decide(&request, &response, &settings, &[]).reason,
        "rounding_uncertainty"
    );
}

fn expertise_pair_fixture() -> (TraceRecord, ExpertisePair) {
    let (mut request, mut response, mut settings) = fixture();
    request.judgment.name = "expertise-useful".into();
    request.judgment.requires.push(ContextSlot::Candidates);
    request.judgment.templates = vec![TemplateKind::ReadIdentity];
    request.packet.context.insert(
        ContextSlot::Candidates,
        ContextValue::Present {
            observations: vec![Observation {
                id: "knowledge::candidate".into(),
                slot: ContextSlot::Candidates,
                kind: SourceKind::DeterministicOutput,
                capture: "local:registered-memory".into(),
                observed_revision: request.packet.revision.fingerprint(),
                text: "candidate-1: Relevant bounded expertise.".into(),
                fact: None,
            }],
        },
    );
    request.packet.references.insert(
        "knowledge::candidate".into(),
        "Relevant bounded expertise.".into(),
    );
    request.packet.accounting.selected_bytes = packet::selected_bytes(&request.packet);
    request.packet.accounting.estimated_tokens =
        request.packet.accounting.selected_bytes.div_ceil(4);
    request.packet.hash = packet::canonical_hash(&request.packet);
    request.question_fingerprint = question_fingerprint(&request.judgment);
    request.template_fingerprint = template_fingerprint(&request.judgment);
    response.provider.supported_outputs = vec![OutputKind::Noul, OutputKind::Choice];
    response.packet_hash = request.packet.hash.clone();
    response.question_fingerprint = request.question_fingerprint.clone();
    response.template_fingerprint = request.template_fingerprint.clone();
    response.outcome = Ok(TypedAnswer::Noul {
        value: Some(true),
        probability: Some(0.9),
        confidence: None,
    });
    settings.concern = ConcernKind::Expertise;
    settings.rules[0].predicate = Predicate::NoulValue { value: true };
    settings.rules[0].template = Some(TemplateKind::ReadIdentity);
    settings.rules[0].reference = ReferenceSelection::Slot {
        slot: ContextSlot::Candidates,
    };
    settings.calibration.provider = response.provider.clone();
    settings.calibration.question_fingerprint = request.question_fingerprint.clone();
    settings.calibration.template_fingerprint = request.template_fingerprint.clone();
    settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
    let record = TraceRecord::new(
        request.clone(),
        response.clone(),
        settings.clone(),
        ExpertMode::Shadow,
        Provenance::Imported,
        Some("isolated-expertise-batch".into()),
        ExpertLimits::default(),
    )
    .unwrap();
    request.request_id = "request-selection".into();
    request.packet.binding_id = "binding::selection".into();
    request.packet.hash = packet::canonical_hash(&request.packet);
    request.judgment.name = "expertise-selection".into();
    request.judgment.output = JudgmentOutput::Choice {
        alternatives: vec!["candidate-1".into(), "none".into()],
    };
    request.question_fingerprint = question_fingerprint(&request.judgment);
    response.request_id = request.request_id.clone();
    response.packet_hash = request.packet.hash.clone();
    response.question_fingerprint = request.question_fingerprint.clone();
    response.outcome = Ok(TypedAnswer::Choice {
        pick: "candidate-1".into(),
        probabilities: None,
        confidence: None,
    });
    settings.binding_id = request.packet.binding_id.clone();
    settings.rules[0].predicate = Predicate::ChoiceLabel {
        label: "candidate-1".into(),
    };
    settings.rules[0].reference = ReferenceSelection::SelectedCandidate;
    settings.calibration.question_fingerprint = request.question_fingerprint.clone();
    settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
    (
        record,
        ExpertisePair {
            request,
            response,
            settings,
        },
    )
}

#[test]
fn expertise_pair_requires_both_answers_and_replays_selected_identity() {
    let (mut record, pair) = expertise_pair_fixture();
    assert_eq!(record.result.reason, "expertise_pair_missing");
    record.expertise_pair = Some(Box::new(pair));
    apply_expertise_pair(&mut record).unwrap();
    assert_eq!(record.result.outcome, AdvisoryOutcome::Nudge);
    assert_eq!(record.result.references, vec!["knowledge::candidate"]);
    assert_eq!(replay(&record).unwrap(), record.result);
    record.expertise_pair.as_mut().unwrap().response.outcome = Err(ProviderFailure::Timeout);
    apply_expertise_pair(&mut record).unwrap();
    assert_eq!(record.result.outcome, AdvisoryOutcome::Abstain);
    assert!(record.result.message.is_none());
}

#[test]
fn unit_reference_selectors_reject_unknown_fields() {
    for kind in ["task", "selected_candidate"] {
        assert!(
            serde_json::from_value::<ReferenceSelection>(
                serde_json::json!({"kind":kind,"extra":"forged"})
            )
            .is_err()
        );
    }
}

#[test]
fn corrupt_index_byte_counts_return_a_typed_error_without_panicking() {
    let root = TempDir::new().unwrap();
    let (request, response, settings) = fixture();
    let record = TraceRecord::new(
        request,
        response,
        settings,
        ExpertMode::Shadow,
        Provenance::Imported,
        None,
        ExpertLimits::default(),
    )
    .unwrap();
    let store = TraceStore::new(root.path(), TraceLimits::default()).unwrap();
    store.record(&record).unwrap();
    let path = root.path().join(".blabla/expert/index.json");
    let mut value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    value["entries"][0]["bytes"] = serde_json::json!(usize::MAX);
    std::fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(store.traces().is_err());
}

#[test]
fn nonactionable_host_advance_invalidates_old_proposal() {
    let mut fixture = LocalFixture::new();
    fixture.persist();
    fixture.event.sequence = 3;
    fixture.event.previous_sequence = Some(1);
    fixture.event.checkpoint_id = "checkpoint-3".into();
    fixture.event.host.gaps = vec!["checkpoint 2 was not observed".into()];
    fixture
        .store()
        .capture(&fixture.event, None, "host_observation_gaps")
        .unwrap();
    let old = fixture
        .store()
        .reserve("request-1", "checkpoint-1", &fixture.project)
        .unwrap();
    assert_eq!(old.result.reason, "stale_checkpoint");
    assert!(old.result.message.is_none());
}

#[test]
fn older_gap_replay_cannot_move_checkpoint_watermark_backward() {
    let mut fixture = LocalFixture::new();
    fixture.persist();
    let original = fixture.event.clone();
    fixture.event.sequence = 3;
    fixture.event.previous_sequence = Some(1);
    fixture.event.checkpoint_id = "checkpoint-3".into();
    fixture.event.host.gaps = vec!["checkpoint 2 was not observed".into()];
    fixture
        .store()
        .capture(&fixture.event, None, "host_observation_gaps")
        .unwrap();
    fixture
        .store()
        .capture(&original, None, "stale_checkpoint")
        .unwrap();
    assert!(fixture.store().advance_checkpoint(&original).is_err());
    assert_eq!(
        fixture
            .store()
            .reserve("request-1", "checkpoint-1", &fixture.project)
            .unwrap()
            .result
            .reason,
        "stale_checkpoint"
    );
}

#[test]
fn verified_no_delivery_allows_fresh_retry_without_erasing_prior_receipts() {
    let mut fixture = LocalFixture::new();
    fixture.config.trace_limits.unresolved_per_task = 1;
    fixture.record.runtime_fingerprint = Some(packet::digest(&fixture.config));
    fixture.persist();
    let original = fixture.reserve();
    fixture.event.sequence = 2;
    fixture.event.previous_sequence = Some(1);
    fixture.event.checkpoint_id = "checkpoint-2".into();
    fixture.event.event_id = "event-2".into();
    fixture.event.observations.push(Observation {
        id: "host-not-delivered".into(),
        slot: ContextSlot::Evidence,
        kind: SourceKind::HostObservation,
        capture: "host:receipt".into(),
        observed_revision: fixture.record.request.packet.revision.fingerprint(),
        text: serde_json::to_string(&HostReceiptObservation {
            request_id: "request-1".into(),
            idempotency_key: original.idempotency_key.clone().unwrap(),
            state: HostReceiptState::NotDelivered,
        })
        .unwrap(),
        fact: None,
    });
    fixture.store().advance_checkpoint(&fixture.event).unwrap();
    fixture
        .store()
        .receipt(
            "request-1",
            DeliveryState::Proposed,
            "host-not-delivered",
            &fixture.project,
        )
        .unwrap();
    let history = fixture.store().history("task::work", 1).unwrap();
    assert!(history.is_empty());
    let (_, bindings) = definitions(&fixture.project).unwrap();
    let packet = blabla::project::expert::build_packet(
        &fixture.project,
        &fixture.task,
        &fixture.event,
        &bindings[0],
        &ExpertLimits::default(),
        &history,
    )
    .unwrap();
    let mut request = fixture.record.request.clone();
    request.request_id = "request-reconciled-retry".into();
    request.packet = packet;
    let mut response = fixture.record.response.clone();
    response.request_id = request.request_id.clone();
    response.packet_hash = request.packet.hash.clone();
    let mut retry = TraceRecord::new(
        request,
        response,
        fixture.record.settings.clone(),
        ExpertMode::Advisory,
        Provenance::LocalCheckpoint,
        None,
        ExpertLimits::default(),
    )
    .unwrap();
    retry.runtime_fingerprint = Some(packet::digest(&fixture.config));
    fixture.store().record(&retry).unwrap();
    let delivery = fixture
        .store()
        .reserve("request-reconciled-retry", "checkpoint-2", &fixture.project)
        .unwrap();
    assert_eq!(delivery.result.outcome, AdvisoryOutcome::Nudge);
    assert_ne!(delivery.idempotency_key, original.idempotency_key);
    let ledger: serde_json::Value = serde_json::from_slice(
        &std::fs::read(fixture.root.path().join(".blabla/expert/ledger.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(ledger["entries"].as_object().unwrap().len(), 2);
    let old = &ledger["entries"][original.idempotency_key.unwrap()];
    assert_eq!(old["request_id"], "request-1");
    assert_eq!(old["receipts"].as_array().unwrap().len(), 1);
    assert_eq!(fixture.store().history("task::work", 1).unwrap().len(), 1);
}

fn reconciled_retry_without_policy_history(
    cap: usize,
) -> (LocalFixture, DeliveryProposal, TraceRecord) {
    let mut fixture = LocalFixture::new();
    fixture.config.trace_limits.unresolved_per_task = cap;
    fixture.record.runtime_fingerprint = Some(packet::digest(&fixture.config));
    fixture.persist();
    let original = fixture.reserve();
    fixture.event.sequence = 2;
    fixture.event.previous_sequence = Some(1);
    fixture.event.checkpoint_id = "checkpoint-2".into();
    fixture.event.event_id = "event-2".into();
    fixture.event.observations.push(Observation {
        id: "host-not-delivered".into(),
        slot: ContextSlot::Evidence,
        kind: SourceKind::HostObservation,
        capture: "host:receipt".into(),
        observed_revision: fixture.record.request.packet.revision.fingerprint(),
        text: serde_json::to_string(&HostReceiptObservation {
            request_id: "request-1".into(),
            idempotency_key: original.idempotency_key.clone().unwrap(),
            state: HostReceiptState::NotDelivered,
        })
        .unwrap(),
        fact: None,
    });
    fixture.store().advance_checkpoint(&fixture.event).unwrap();
    fixture
        .store()
        .receipt(
            "request-1",
            DeliveryState::Proposed,
            "host-not-delivered",
            &fixture.project,
        )
        .unwrap();
    let (_, bindings) = definitions(&fixture.project).unwrap();
    let packet = blabla::project::expert::build_packet(
        &fixture.project,
        &fixture.task,
        &fixture.event,
        &bindings[0],
        &ExpertLimits::default(),
        &[],
    )
    .unwrap();
    let mut request = fixture.record.request.clone();
    request.request_id = "request-isolated-retry".into();
    request.packet = packet;
    let mut response = fixture.record.response.clone();
    response.request_id = request.request_id.clone();
    response.packet_hash = request.packet.hash.clone();
    let mut retry = TraceRecord::new(
        request,
        response,
        fixture.record.settings.clone(),
        ExpertMode::Advisory,
        Provenance::LocalCheckpoint,
        None,
        ExpertLimits::default(),
    )
    .unwrap();
    retry.runtime_fingerprint = Some(packet::digest(&fixture.config));
    (fixture, original, retry)
}

#[test]
fn verified_non_delivery_does_not_consume_the_only_active_slot() {
    let (fixture, _, retry) = reconciled_retry_without_policy_history(1);
    fixture.store().record(&retry).unwrap();
    let delivery = fixture
        .store()
        .reserve(&retry.request.request_id, "checkpoint-2", &fixture.project)
        .unwrap();
    assert_eq!(delivery.result.outcome, AdvisoryOutcome::Nudge);
    assert!(delivery.idempotency_key.is_some());
}

#[test]
fn verified_non_delivery_retry_keeps_a_distinct_attempt_key_and_receipt_history() {
    let (fixture, original, retry) = reconciled_retry_without_policy_history(64);
    fixture.store().record(&retry).unwrap();
    let delivery = fixture
        .store()
        .reserve(&retry.request.request_id, "checkpoint-2", &fixture.project)
        .unwrap();
    assert_eq!(delivery.result.outcome, AdvisoryOutcome::Nudge);
    assert_ne!(delivery.idempotency_key, original.idempotency_key);
    let ledger: serde_json::Value = serde_json::from_slice(
        &std::fs::read(fixture.root.path().join(".blabla/expert/ledger.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(ledger["entries"].as_object().unwrap().len(), 2);
    let old = &ledger["entries"][original.idempotency_key.unwrap()];
    assert_eq!(old["request_id"], "request-1");
    assert_eq!(old["receipts"].as_array().unwrap().len(), 1);
}

#[test]
fn a_retry_delivery_receipt_updates_only_its_distinct_attempt() {
    let (mut fixture, original, retry) = reconciled_retry_without_policy_history(1);
    fixture.store().record(&retry).unwrap();
    let delivery = fixture
        .store()
        .reserve(&retry.request.request_id, "checkpoint-2", &fixture.project)
        .unwrap();
    delivered_receipt(&mut fixture, &delivery);
    let ledger: serde_json::Value = serde_json::from_slice(
        &std::fs::read(fixture.root.path().join(".blabla/expert/ledger.json")).unwrap(),
    )
    .unwrap();
    let old = &ledger["entries"][original.idempotency_key.unwrap()];
    let current = &ledger["entries"][delivery.idempotency_key.unwrap()];
    assert_eq!(old["state"], "proposed");
    assert_eq!(old["receipts"].as_array().unwrap().len(), 1);
    assert_eq!(current["state"], "delivered");
    assert_eq!(current["receipts"].as_array().unwrap().len(), 1);
    assert_eq!(fixture.store().read("request-1").unwrap().receipts.len(), 1);
    assert_eq!(
        fixture
            .store()
            .read(&retry.request.request_id)
            .unwrap()
            .receipts
            .len(),
        1
    );
}
