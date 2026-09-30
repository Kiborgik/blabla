#[path = "support/cli.rs"]
mod cli;

use blabla::expert::packet::{ExpertPacket, PacketError, validate_packet};
use blabla::expert::{
    CheckpointKind, ContextSlot, ExpertLimits, HostCapabilities, Observation, ObservedEvent,
    SourceKind,
};
use blabla::expert::{policy::*, provider::*, trace::*};
use blabla::memory::{self, knowledge, process};
use blabla::project::{self, Project, expert::build_packet, task};
use serde_json::Value;
use std::collections::BTreeMap;
use tempfile::TempDir;

const MANIFEST: &str = "project GoalPacket\nknowledge \"knowledge.bla\"\nprocess \"process.bla\"\ngoal \"goals.bla\"\n";
const GOALS: &str = r#"goal "target" { statement "Implement the declared target." expect ["contract::fixture"] state "active" }"#;
const KNOWLEDGE: &str = r#"knowledge "review" { purpose "Goal alignment." }
judgment "goal-drift" { pack "review" purpose "Check alignment." requires ["task", "goal", "proposal"] question "Does the proposal serve the goal?" criteria "Compare proposal and declared goal." output "choice" alternatives ["aligned", "drift", "unclear"] templates ["read-identity"] }"#;
const PROCESS: &str = r#"role "worker" { purpose "Work." model ["gpt-6.1-sol"] }
binding "goal-alignment" { judgment "judgment::review::goal-drift" roles ["worker"] checkpoints ["plan"] }"#;

struct Fixture {
    root: TempDir,
    project: Project,
    binding: process::JudgmentBinding,
    judgment: knowledge::Judgment,
    event: ObservedEvent,
}

impl Fixture {
    fn new() -> Self {
        let root = TempDir::new().unwrap();
        for (path, text) in [
            ("project.bla", MANIFEST),
            ("goals.bla", GOALS),
            ("knowledge.bla", KNOWLEDGE),
            ("process.bla", PROCESS),
            ("input.txt", "input"),
        ] {
            std::fs::write(root.path().join(path), text).unwrap();
        }
        let project =
            project::load(project::read_manifest(&root.path().join("project.bla")).unwrap())
                .unwrap();
        let binding = process::build(&memory::syntax::parse("process.bla", PROCESS).unwrap())
            .unwrap()
            .bindings
            .remove(0);
        let judgment =
            knowledge::build(&memory::syntax::parse("knowledge.bla", KNOWLEDGE).unwrap())
                .unwrap()
                .judgments
                .remove(0);
        let event = ObservedEvent {
            event_id: "event-1".into(),
            run_id: "run-1".into(),
            task: "task::work".into(),
            checkpoint_id: "checkpoint-1".into(),
            sequence: 1,
            previous_sequence: None,
            unix_ms: 1,
            kind: CheckpointKind::Plan,
            host: HostCapabilities {
                host: "fixture".into(),
                version: "1".into(),
                adapter: "fixture".into(),
                checkpoints: vec![CheckpointKind::Plan],
                pauses_worker: false,
                same_task_delivery: false,
                delivery_receipts: false,
                pre_tool_control: false,
                gaps: vec![],
            },
            observations: vec![],
        };
        Self {
            root,
            project,
            binding,
            judgment,
            event,
        }
    }

    fn open(&self, goal: Option<&str>) -> std::process::Output {
        let mut args = vec![
            "task",
            "open",
            "work",
            "--role",
            "worker",
            "--statement",
            "Implement the target.",
            "--scope",
            "input.txt",
            "--check",
            "check",
            "--json",
        ];
        if let Some(goal) = goal {
            args.extend(["--goal", goal]);
        }
        cli::run_in(Some(self.root.path()), &cli::args(&args))
    }

    fn accept(&self, goal: Option<&str>) {
        let output = self.open(goal);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        let output = cli::run_in(
            Some(self.root.path()),
            &cli::args(&["task", "accept", "work", "--model", "gpt-6.1-sol", "--json"]),
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
    }

    fn packet(&self) -> Result<ExpertPacket, PacketError> {
        let task = task::read(self.root.path(), "work").unwrap().unwrap();
        build_packet(
            &self.project,
            &task,
            &self.event,
            &self.binding,
            &ExpertLimits::default(),
            &[],
        )
    }

    fn propose(&mut self) {
        self.event.observations = vec![Observation {
            id: "proposal-1".into(),
            slot: ContextSlot::Proposal,
            kind: SourceKind::WorkerStatement,
            capture: "host:excerpt".into(),
            observed_revision: self.packet().unwrap().revision.fingerprint(),
            text: "Implement the declared target.".into(),
            fact: None,
        }];
    }

    fn checkpoint(&self) -> (Value, TraceStore) {
        let mut settings = PolicySettings {
            binding_id: self.binding.id(),
            concern: ConcernKind::GoalDrift,
            rules: vec![PolicyRule {
                id: "drift".into(),
                predicate: Predicate::ChoiceLabel {
                    label: "drift".into(),
                },
                outcome: AdvisoryOutcome::Nudge,
                template: Some(blabla::expert::TemplateKind::ReadIdentity),
                reference: ReferenceSelection::Slot {
                    slot: ContextSlot::Goal,
                },
            }],
            calibration: CalibrationRecord {
                record_id: "fixture-only".into(),
                provider: ProviderIdentity {
                    provider: "unverified".into(),
                    model: "unknown".into(),
                    checkpoint: "unknown".into(),
                    supported_outputs: vec![OutputKind::Choice],
                    probabilities: false,
                    certification: None,
                },
                question_fingerprint: question_fingerprint(&self.judgment),
                template_fingerprint: template_fingerprint(&self.judgment),
                policy_fingerprint: String::new(),
                development_fingerprint: "fixture".into(),
                thresholds: BTreeMap::new(),
            },
        };
        settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
        let config = RuntimeConfig {
            policies: vec![settings],
            ..RuntimeConfig::default()
        };
        for (path, value) in [
            ("event.json", serde_json::to_vec(&self.event).unwrap()),
            ("config.json", serde_json::to_vec(&config).unwrap()),
        ] {
            std::fs::write(self.root.path().join(path), value).unwrap();
        }
        let output = cli::run_in(
            Some(self.root.path()),
            &cli::args(&[
                "expert",
                "checkpoint",
                "--event",
                "event.json",
                "--config",
                "config.json",
                "--json",
            ]),
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        (
            serde_json::from_slice(&output.stdout).unwrap(),
            TraceStore::new(self.root.path(), config.trace_limits).unwrap(),
        )
    }
}

#[test]
fn cli_task_goal_is_selected_and_fresh_in_goal_alignment_checkpoint() {
    let mut fixture = Fixture::new();
    fixture.accept(Some("target"));
    assert_eq!(
        task::read(fixture.root.path(), "work")
            .unwrap()
            .unwrap()
            .goal
            .as_deref(),
        Some("target")
    );
    fixture.propose();
    let packet = fixture.packet().unwrap();
    validate_packet(&packet, &fixture.judgment, &ExpertLimits::default()).unwrap();
    let observations = packet.context[&ContextSlot::Goal].observations();
    assert_eq!(observations.len(), 1);
    assert_eq!(observations[0].id, "goal::target");
    assert_eq!(observations[0].kind, SourceKind::DeterministicOutput);
    assert_eq!(observations[0].capture, "local:registered-memory");
    assert_eq!(
        observations[0].observed_revision,
        packet.revision.fingerprint()
    );
    assert!(packet.references.contains_key("goal::target"));
    assert!(packet.revision.identities.contains_key("goal::target"));
    assert!(!packet.references.contains_key("target"));
    let (output, store) = fixture.checkpoint();
    assert_eq!(output["captured"], 1);
    assert_eq!(output["omitted_evaluations"], 0);
    let entries = store.traces().unwrap();
    assert_eq!(entries.len(), 1);
    let record = store.read(&entries[0].request_id).unwrap();
    assert_eq!(record.request.packet.hash, packet.hash);
    assert!(current_revision_matches(&fixture.project, &record));
    std::fs::write(
        fixture.root.path().join("goals.bla"),
        GOALS.replace(
            "Implement the declared target.",
            "Implement the updated target.",
        ),
    )
    .unwrap();
    assert!(!current_revision_matches(&fixture.project, &record));
    fixture.propose();
    let updated = fixture.packet().unwrap();
    validate_packet(&updated, &fixture.judgment, &ExpertLimits::default()).unwrap();
    assert_ne!(
        packet.revision.identities["goal::target"],
        updated.revision.identities["goal::target"]
    );
    assert_ne!(
        packet.revision.fingerprint(),
        updated.revision.fingerprint()
    );
    let current_goal: Value = serde_json::from_str(&updated.references["goal::target"]).unwrap();
    assert_eq!(current_goal["name"], "target");
    assert_eq!(current_goal["statement"], "Implement the updated target.");
}

#[test]
fn cli_task_goal_rejects_missing_unregistered_or_no_longer_declared_memory() {
    for change in ["missing", "unregistered", "undeclared"] {
        let fixture = Fixture::new();
        fixture.accept(Some("target"));
        match change {
            "missing" => std::fs::remove_file(fixture.root.path().join("goals.bla")).unwrap(),
            "unregistered" => std::fs::write(
                fixture.root.path().join("project.bla"),
                MANIFEST.replace("goal \"goals.bla\"\n", ""),
            )
            .unwrap(),
            _ => std::fs::write(
                fixture.root.path().join("goals.bla"),
                GOALS.replace("\"target\"", "\"other\""),
            )
            .unwrap(),
        }
        assert_eq!(
            fixture.packet().unwrap_err().code(),
            "unresolved_reference",
            "{change}"
        );
        let (output, store) = fixture.checkpoint();
        assert_eq!(output["captured"], 0);
        assert_eq!(output["provider_calls"], 0);
        let captures = store.captures().unwrap();
        assert_eq!(captures.len(), 1);
        assert_eq!(captures[0].reason, "unresolved_reference");
    }
}

#[test]
fn cli_task_without_goal_cannot_supply_required_goal_context() {
    let mut fixture = Fixture::new();
    fixture.accept(None);
    fixture.propose();
    let packet = fixture.packet().unwrap();
    assert!(packet.context[&ContextSlot::Goal].observations().is_empty());
    assert_eq!(
        validate_packet(&packet, &fixture.judgment, &ExpertLimits::default())
            .unwrap_err()
            .code(),
        "missing_required_context"
    );
    let (output, store) = fixture.checkpoint();
    assert_eq!(output["captured"], 0);
    assert_eq!(output["provider_calls"], 0);
    assert_eq!(
        store.captures().unwrap()[0].reason,
        "missing_required_context"
    );
}
