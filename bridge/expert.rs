use blabla::expert::packet::{self, ContextValue};
use blabla::expert::policy::{
    self, AdvisoryOutcome, CalibrationRecord, ConcernKind, PolicyRule, PolicySettings, Predicate,
    ReferenceSelection,
};
use blabla::expert::provider::{
    EvaluationRequest, EvaluationResponse, EvaluationTiming, OutputKind, ProviderIdentity,
    ProviderUsage, TypedAnswer,
};
use blabla::expert::trace::{self, Provenance, TraceRecord};
use blabla::expert::{
    CheckpointKind, ContextSlot, ExpertLimits, ExpertMode, HostCapabilities, Observation,
    ObservedEvent, SourceKind, TemplateKind,
};
use blabla::memory::{knowledge, process, syntax};
use blabla::project::{self, Project, task};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use tempfile::TempDir;

const KNOWLEDGE: &str = r#"knowledge "review" { purpose "A deterministic self-hosting fixture." }
judgment "claim-support" { pack "review" purpose "Check the selected claim." question "Is the claim supported?" criteria "Evidence must establish the claim." requires ["claim", "evidence"] optional ["task"] output "noul" proposition "The claim is supported." templates ["cite-evidence"] }"#;
const PROCESS: &str = r#"role "worker" { purpose "Carry the self-hosting fixture." }
binding "support" { judgment "judgment::review::claim-support" roles ["worker"] checkpoints ["claim"] }"#;

struct Fixture {
    root: TempDir,
    project: Project,
    record: TraceRecord,
}

impl Fixture {
    fn new() -> Self {
        let root = TempDir::new().expect("the expert fixture directory is available");
        for (path, text) in [
            (
                "project.bla",
                "project ExpertFixture\nknowledge \"knowledge.bla\"\nprocess \"process.bla\"\n",
            ),
            ("knowledge.bla", KNOWLEDGE),
            ("process.bla", PROCESS),
            ("input.txt", "initial"),
        ] {
            std::fs::write(root.path().join(path), text).expect("the fixture source is written");
        }
        let project = project::load(
            project::read_manifest(&root.path().join("project.bla"))
                .expect("the fixture manifest parses"),
        )
        .expect("the fixture loads");
        let mut task = task::Task {
            name: "expert-fixture".into(),
            role: "worker".into(),
            statement: "Check the selected fixture input.".into(),
            state: "accepted".into(),
            scope: vec!["input.txt".into()],
            check_inputs: vec!["input.txt".into()],
            check_argv: Some(vec!["fixture-check".into(), "input.txt".into()]),
            acceptance_epoch: 1,
            ..Default::default()
        };
        let tree = project::snapshot(root.path(), &project.ignore);
        task.evidence.push(task::Evidence {
            identity: task::declared_check(&task),
            acceptance_epoch: Some(task.acceptance_epoch),
            check: "fixture-check input.txt".into(),
            exit: 0,
            tree: "fixture".into(),
            tool: "run".into(),
            unix: 1,
            inputs: task::evidence_inputs(&task, &tree),
            command: task.check_argv.clone(),
            log: None,
        });
        task::write(root.path(), &task).expect("the actual task record is written");
        let judgment = knowledge::build(
            &syntax::parse("knowledge.bla", KNOWLEDGE).expect("the judgment parses"),
        )
        .expect("the judgment builds")
        .judgments
        .remove(0);
        let binding =
            process::build(&syntax::parse("process.bla", PROCESS).expect("the binding parses"))
                .expect("the binding builds")
                .bindings
                .remove(0);
        let limits = ExpertLimits::default();
        let mut event = ObservedEvent {
            event_id: "fixture-event".into(),
            run_id: "fixture-run".into(),
            task: "task::expert-fixture".into(),
            checkpoint_id: "fixture-checkpoint".into(),
            sequence: 1,
            previous_sequence: None,
            unix_ms: 1,
            kind: CheckpointKind::Claim,
            host: HostCapabilities {
                host: "self-hosting-fixture".into(),
                version: "1".into(),
                adapter: "deterministic-fixture".into(),
                checkpoints: vec![CheckpointKind::Claim],
                pauses_worker: false,
                same_task_delivery: false,
                delivery_receipts: false,
                pre_tool_control: false,
                gaps: vec![],
            },
            observations: vec![],
        };
        let revision =
            project::expert::build_packet(&project, &task, &event, &binding, &limits, &[])
                .expect("the actual selected revision builds")
                .revision
                .fingerprint();
        event.observations.push(Observation {
            id: "fixture-claim".into(),
            slot: ContextSlot::Claim,
            kind: SourceKind::WorkerStatement,
            capture: "host:excerpt".into(),
            observed_revision: revision,
            text: "The fixture claim is supported.".into(),
            fact: None,
        });
        let packet = project::expert::build_packet(&project, &task, &event, &binding, &limits, &[])
            .expect("the actual selected packet builds");
        let request = EvaluationRequest {
            request_id: "fixture-request".into(),
            question_fingerprint: policy::question_fingerprint(&judgment),
            template_fingerprint: policy::template_fingerprint(&judgment),
            judgment,
            packet,
        };
        let provider = ProviderIdentity {
            provider: "authored-fixture".into(),
            model: "authored-fixture".into(),
            checkpoint: "authored-fixture".into(),
            supported_outputs: vec![OutputKind::Noul],
            probabilities: false,
            certification: None,
        };
        let mut settings = PolicySettings {
            binding_id: request.packet.binding_id.clone(),
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
                record_id: "self-hosting-fixture".into(),
                provider: provider.clone(),
                question_fingerprint: request.question_fingerprint.clone(),
                template_fingerprint: request.template_fingerprint.clone(),
                policy_fingerprint: String::new(),
                development_fingerprint: "self-hosting-fixture".into(),
                thresholds: BTreeMap::new(),
            },
        };
        settings.calibration.policy_fingerprint = policy::policy_fingerprint(&settings);
        let response = EvaluationResponse {
            request_id: request.request_id.clone(),
            packet_hash: request.packet.hash.clone(),
            question_fingerprint: request.question_fingerprint.clone(),
            template_fingerprint: request.template_fingerprint.clone(),
            provider,
            timing: EvaluationTiming {
                queue_ms: 0,
                inference_ms: 0,
                total_ms: 0,
            },
            usage: ProviderUsage {
                input_tokens: None,
                output_tokens: None,
                reported_latency_ms: None,
            },
            provider_request_id: None,
            self_report: None,
            diagnostic: None,
            outcome: Ok(TypedAnswer::Noul {
                value: Some(false),
                probability: None,
                confidence: None,
            }),
        };
        let record = TraceRecord::new(
            request,
            response,
            settings,
            ExpertMode::Shadow,
            Provenance::LocalCheckpoint,
            None,
            limits,
        )
        .expect("the authored response is a valid shadow trace");
        Self {
            root,
            project,
            record,
        }
    }
}

pub struct Expert {
    fixture: Fixture,
    outcome: AdvisoryOutcome,
    has_message: bool,
    revision_current: bool,
}

impl Expert {
    pub fn new() -> Self {
        let fixture = Fixture::new();
        let revision_current = trace::current_revision_matches(&fixture.project, &fixture.record);
        Self {
            fixture,
            outcome: AdvisoryOutcome::Silence,
            has_message: false,
            revision_current,
        }
    }

    pub fn call(&mut self, name: &str) -> bool {
        match name {
            "expert_evaluate_current_claim" | "expert_evaluate_missing_evidence" => {
                let mut request = self.fixture.record.request.clone();
                let mut response = self.fixture.record.response.clone();
                if name == "expert_evaluate_missing_evidence" {
                    request
                        .packet
                        .context
                        .insert(ContextSlot::Evidence, ContextValue::Missing);
                    request.packet.references.clear();
                    request.packet.accounting.selected_bytes =
                        packet::selected_bytes(&request.packet);
                    request.packet.accounting.estimated_tokens =
                        request.packet.accounting.selected_bytes.div_ceil(4);
                    request.packet.hash = packet::canonical_hash(&request.packet);
                    response.packet_hash = request.packet.hash.clone();
                }
                let result =
                    policy::decide(&request, &response, &self.fixture.record.settings, &[]);
                self.outcome = result.outcome;
                self.has_message = result.message.is_some();
                self.revision_current =
                    trace::current_revision_matches(&self.fixture.project, &self.fixture.record);
            }
            "expert_recheck_changed_revision" => {
                std::fs::write(self.fixture.root.path().join("input.txt"), "changed")
                    .expect("the real selected input changes");
                self.revision_current =
                    trace::current_revision_matches(&self.fixture.project, &self.fixture.record);
                std::fs::write(self.fixture.root.path().join("input.txt"), "initial")
                    .expect("the fixture input is restored");
            }
            _ => return false,
        }
        true
    }

    pub fn observe(&self) -> Value {
        json!({ "expert_outcome": self.outcome, "expert_has_message": self.has_message, "expert_revision_current": self.revision_current })
    }
}

#[cfg(test)]
#[test]
fn current_claim_uses_the_product_policy_and_current_revision() {
    let mut expert = Expert::new();
    assert!(expert.call("expert_evaluate_current_claim"));
    let state = expert.observe();
    assert_eq!(state["expert_outcome"], "nudge");
    assert_eq!(state["expert_revision_current"], true);
}

#[cfg(test)]
#[test]
fn missing_required_evidence_uses_the_product_abstention() {
    let mut expert = Expert::new();
    assert!(expert.call("expert_evaluate_missing_evidence"));
    let state = expert.observe();
    assert_eq!(state["expert_outcome"], "abstain");
    assert_eq!(state["expert_has_message"], false);
}

#[cfg(test)]
#[test]
fn changed_input_uses_the_final_product_revision_guard() {
    let mut expert = Expert::new();
    assert!(expert.call("expert_recheck_changed_revision"));
    let state = expert.observe();
    assert_eq!(state["expert_revision_current"], false);
}

#[cfg(test)]
#[test]
fn unrelated_actions_remain_available_to_other_bridge_modules() {
    assert!(!Expert::new().call("open_a_task"));
}
