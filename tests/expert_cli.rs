#[path = "support/cli.rs"]
mod cli;
use serde_json::Value;
use tempfile::TempDir;

#[test]
fn disabled_expert_makes_no_provider_calls() {
    let root = TempDir::new().unwrap();
    std::fs::write(root.path().join("project.bla"), "project Disabled\n").unwrap();
    std::fs::write(root.path().join("config.json"), r#"{"mode":"off","provider":null,"host":null,"policies":[],"limits":{"packet_bytes":16384,"excerpt_bytes":2048,"history_entries":8,"judgments_per_checkpoint":4,"request_timeout_ms":10000,"concurrency":1,"retries":0,"deliveries_per_checkpoint":1},"trace_limits":{"retention_days":7,"payload_bytes":16777216,"unresolved_per_task":64},"promotions":[]}"#).unwrap();
    std::fs::write(root.path().join("event.json"), "{}").unwrap();
    let output = cli::run_in(
        Some(root.path()),
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
    assert_eq!(output.status.code(), Some(0));
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["mode"], "off");
    assert_eq!(value["provider_calls"], 0);
}

#[test]
fn outage_does_not_change_finish() {
    use blabla::expert::provider::{OutputKind, ProviderIdentity};
    use blabla::expert::trace::{ConfiguredProvider, RuntimeConfig};
    let root = TempDir::new().unwrap();
    std::fs::write(root.path().join("project.bla"), "project Ordinary\n").unwrap();
    let baseline_finish = cli::run_in(Some(root.path()), &cli::args(&["finish", "--json"]));
    let baseline_check = cli::run_in(Some(root.path()), &cli::args(&["check", "--json"]));
    let marker = root.path().join("provider-called");
    let config = RuntimeConfig {
        provider: Some(ConfiguredProvider {
            identity: ProviderIdentity {
                provider: "fixture".into(),
                model: "fixture-model".into(),
                checkpoint: "fixture-checkpoint".into(),
                supported_outputs: vec![OutputKind::Noul],
                probabilities: false,
                certification: None,
            },
            argv: vec![
                if cfg!(windows) {
                    "python".into()
                } else {
                    "python3".into()
                },
                "-c".into(),
                format!(
                    "from pathlib import Path; Path({:?}).write_text('called')",
                    marker.to_str().unwrap()
                ),
            ],
        }),
        ..RuntimeConfig::default()
    };
    std::fs::create_dir_all(root.path().join(".blabla/expert")).unwrap();
    for corrupt in ["runtime.json", "index.json", "ledger.json"] {
        for name in ["index.json", "ledger.json"] {
            let _ = std::fs::remove_file(root.path().join(".blabla/expert").join(name));
        }
        std::fs::write(
            root.path().join(".blabla/expert/runtime.json"),
            serde_json::to_vec(&config).unwrap(),
        )
        .unwrap();
        std::fs::write(root.path().join(".blabla/expert").join(corrupt), "{corrupt").unwrap();
        let finish = cli::run_in(Some(root.path()), &cli::args(&["finish", "--json"]));
        let check = cli::run_in(Some(root.path()), &cli::args(&["check", "--json"]));
        assert_eq!(finish.status.code(), baseline_finish.status.code());
        assert_eq!(check.status.code(), baseline_check.status.code());
        let status = cli::run_in(Some(root.path()), &cli::args(&["status", "--json"]));
        let status: Value = serde_json::from_slice(&status.stdout).unwrap();
        assert!(status["expert_runtime"]["error"].as_str().is_some());
        assert!(!marker.exists());
    }
}

#[test]
fn external_json_and_files_are_strictly_bounded() {
    let root = TempDir::new().unwrap();
    std::fs::write(root.path().join("project.bla"), "project Bounds\n").unwrap();
    for text in [
        "{\"mode\":\"off\",\"mode\":\"shadow\"}".to_string(),
        "{\"unknown\":1}".into(),
        "x".repeat(300000),
    ] {
        std::fs::write(root.path().join("bad.json"), text).unwrap();
        let output = cli::run_in(
            Some(root.path()),
            &cli::args(&["expert", "replay", "bad.json", "--json"]),
        );
        assert_eq!(output.status.code(), Some(2));
    }
}

struct CheckpointFixture {
    root: TempDir,
    config: blabla::expert::trace::RuntimeConfig,
    event: blabla::expert::ObservedEvent,
}

impl CheckpointFixture {
    fn new() -> Self {
        use blabla::expert::{self, packet, policy::*, provider::*, trace::*};
        use blabla::memory::{self, knowledge, process};
        use blabla::project::{self, task};
        use std::collections::BTreeMap;
        let root = TempDir::new().unwrap();
        let knowledge = r#"knowledge "review" { purpose "Review." }
judgment "claim-support" { pack "review" purpose "Check support." requires ["claim", "evidence"] question "Is the claim supported?" criteria "Evidence must establish support." output "noul" proposition "The claim is supported." templates ["cite-evidence"] }"#;
        let process = r#"role "worker" { purpose "Work." }
binding "support" { judgment "judgment::review::claim-support" roles ["worker"] checkpoints ["claim"] }"#;
        for (path, contents) in [
            (
                "project.bla",
                "project CLI\nknowledge \"knowledge.bla\"\nprocess \"process.bla\"\n",
            ),
            ("knowledge.bla", knowledge),
            ("process.bla", process),
            ("input.txt", "input"),
        ] {
            std::fs::write(root.path().join(path), contents).unwrap();
        }
        let project =
            project::load(project::read_manifest(&root.path().join("project.bla")).unwrap())
                .unwrap();
        let mut task = task::Task {
            name: "work".into(),
            role: "worker".into(),
            statement: "Check input.".into(),
            state: "accepted".into(),
            scope: vec!["input.txt".into()],
            check_inputs: vec!["input.txt".into()],
            check_argv: Some(vec!["check".into()]),
            acceptance_epoch: 1,
            ..task::Task::default()
        };
        let tree = project::snapshot(root.path(), &project.ignore);
        task.evidence.push(task::Evidence {
            identity: Some(task::CheckIdentity::Argv {
                argv: vec!["check".into()],
            }),
            acceptance_epoch: Some(1),
            check: "check".into(),
            exit: 0,
            tree: "unused".into(),
            tool: "run".into(),
            unix: 1,
            inputs: task::evidence_inputs(&task, &tree),
            command: Some(vec!["check".into()]),
            log: None,
        });
        task::write(root.path(), &task).unwrap();
        let judgment =
            knowledge::build(&memory::syntax::parse("knowledge.bla", knowledge).unwrap())
                .unwrap()
                .judgments
                .remove(0);
        let binding = process::build(&memory::syntax::parse("process.bla", process).unwrap())
            .unwrap()
            .bindings
            .remove(0);
        let mut event = expert::ObservedEvent {
            event_id: "event-1".into(),
            run_id: "run-1".into(),
            task: "task::work".into(),
            checkpoint_id: "checkpoint-1".into(),
            sequence: 1,
            previous_sequence: None,
            unix_ms: 1,
            kind: expert::CheckpointKind::Claim,
            host: expert::HostCapabilities {
                host: "isolated-fixture".into(),
                version: "1".into(),
                adapter: "isolated-fixture".into(),
                checkpoints: vec![expert::CheckpointKind::Claim],
                pauses_worker: false,
                same_task_delivery: false,
                delivery_receipts: false,
                pre_tool_control: false,
                gaps: vec![],
            },
            observations: vec![],
        };
        let revision = project::expert::build_packet(
            &project,
            &task,
            &event,
            &binding,
            &expert::ExpertLimits::default(),
            &[],
        )
        .unwrap()
        .revision
        .fingerprint();
        event.observations.push(expert::Observation {
            id: "claim-1".into(),
            slot: expert::ContextSlot::Claim,
            kind: expert::SourceKind::WorkerStatement,
            capture: "host:excerpt".into(),
            observed_revision: revision,
            text: "The check passes.".into(),
            fact: None,
        });
        let provider = ProviderIdentity {
            provider: "fixture".into(),
            model: "fixture-model".into(),
            checkpoint: "fixture-checkpoint".into(),
            supported_outputs: vec![OutputKind::Choice, OutputKind::Noul, OutputKind::Score],
            probabilities: true,
            certification: Some("local-fixture-only".into()),
        };
        let mut settings = PolicySettings {
            binding_id: "binding::support".into(),
            concern: ConcernKind::UnsupportedClaim,
            rules: vec![PolicyRule {
                id: "unsupported".into(),
                predicate: Predicate::NoulProbability { value: false },
                outcome: AdvisoryOutcome::Nudge,
                template: Some(expert::TemplateKind::CiteEvidence),
                reference: ReferenceSelection::Slot {
                    slot: expert::ContextSlot::Evidence,
                },
            }],
            calibration: CalibrationRecord {
                record_id: "isolated-fixture-calibration".into(),
                provider: provider.clone(),
                question_fingerprint: question_fingerprint(&judgment),
                template_fingerprint: template_fingerprint(&judgment),
                policy_fingerprint: String::new(),
                development_fingerprint: "1234567890abcdef".into(),
                thresholds: BTreeMap::from([("unsupported".into(), 0.2)]),
            },
        };
        settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
        let _ = packet::digest(&settings);
        let config = RuntimeConfig {
            provider: Some(ConfiguredProvider {
                identity: provider,
                argv: vec![
                    if cfg!(windows) {
                        "python".into()
                    } else {
                        "python3".into()
                    },
                    format!(
                        "{}/tests/fixtures/expert/provider.py",
                        env!("CARGO_MANIFEST_DIR")
                    ),
                    "normal".into(),
                ],
            }),
            policies: vec![settings],
            ..RuntimeConfig::default()
        };
        Self {
            root,
            config,
            event,
        }
    }
    fn run(&self) -> std::process::Output {
        std::fs::write(
            self.root.path().join("config.json"),
            serde_json::to_vec(&self.config).unwrap(),
        )
        .unwrap();
        std::fs::write(
            self.root.path().join("event.json"),
            serde_json::to_vec(&self.event).unwrap(),
        )
        .unwrap();
        cli::run_in(
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
        )
    }
}

#[test]
fn shadow_checkpoint_stdout_does_not_leak_advice() {
    let fixture = CheckpointFixture::new();
    let output = fixture.run();
    assert_eq!(
        output.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let text = String::from_utf8(output.stdout).unwrap();
    for forbidden in [
        "nudge",
        "mapped_answer",
        "cite_evidence",
        "unsupported_claim",
        "reconsider",
        "evidence::work",
    ] {
        assert!(!text.contains(forbidden), "{text}");
    }
    let value: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["provider_calls"], 1);
}

#[test]
fn advisory_checkpoint_exposes_only_opaque_proposals_before_reservation() {
    let mut fixture = CheckpointFixture::new();
    fixture.config.mode = blabla::expert::ExpertMode::Advisory;
    let output = fixture.run();
    assert_eq!(output.status.code(), Some(0));
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(value.get("results").is_none());
    assert_eq!(value["mode"], "shadow");
}

#[test]
fn truthful_host_gaps_are_recorded_as_abstention_without_provider_calls() {
    let mut fixture = CheckpointFixture::new();
    fixture.event.host.gaps = vec!["tool events are unavailable".into()];
    let marker = fixture.root.path().join("provider-marker");
    let provider = fixture.config.provider.as_mut().unwrap();
    provider.argv[2] = "retry".into();
    provider.argv.push(marker.to_str().unwrap().into());
    let output = fixture.run();
    assert_eq!(
        output.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["capture_status"], "abstained");
    assert_eq!(value["provider_calls"], 0);
    assert!(!marker.exists());
    let traces = cli::run_in(
        Some(fixture.root.path()),
        &cli::args(&["expert", "traces", "--json"]),
    );
    assert!(String::from_utf8_lossy(&traces.stdout).contains("tool events are unavailable"));
}

#[test]
fn malformed_or_secret_host_gaps_are_rejected() {
    for gap in ["x".repeat(300), "api_key=sentinel-gap-secret".into()] {
        let mut fixture = CheckpointFixture::new();
        fixture.event.host.gaps = vec![gap];
        let output = fixture.run();
        assert_eq!(output.status.code(), Some(2));
    }
}

#[test]
fn status_exposes_runtime_limits_without_changing_completion() {
    let fixture = CheckpointFixture::new();
    assert_eq!(fixture.run().status.code(), Some(0));
    let output = cli::run_in(Some(fixture.root.path()), &cli::args(&["status", "--json"]));
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["expert_runtime"]["mode"], "shadow");
    assert_eq!(value["expert_runtime"]["trace_limits"]["retention_days"], 7);
    assert_eq!(
        value["expert_runtime"]["trace_limits"]["payload_bytes"],
        16777216
    );
    assert_eq!(
        value["expert_runtime"]["trace_limits"]["unresolved_per_task"],
        64
    );
    assert!(
        value["expert_runtime"]["retained_payloads"]
            .as_u64()
            .unwrap()
            > 0
    );
}

fn run_with_input(
    root: &std::path::Path,
    arguments: &[&str],
    input: &[u8],
) -> std::process::Output {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let stdout = tempfile::NamedTempFile::new().unwrap();
    let stderr = tempfile::NamedTempFile::new().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_blabla"))
        .current_dir(root)
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(stdout.as_file().try_clone().unwrap())
        .stderr(stderr.as_file().try_clone().unwrap())
        .spawn()
        .unwrap();
    let _ = child.stdin.take().unwrap().write_all(input);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if std::time::Instant::now() >= deadline {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("expert CLI input check exceeded deadline");
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    };
    std::process::Output {
        status,
        stdout: std::fs::read(stdout.path()).unwrap(),
        stderr: std::fs::read(stderr.path()).unwrap(),
    }
}

#[test]
fn imported_evaluation_cannot_upgrade_provenance_or_delivery_mode() {
    use blabla::expert::trace::{TraceLimits, TraceStore};
    let mut fixture = CheckpointFixture::new();
    fixture.config.mode = blabla::expert::ExpertMode::Advisory;
    let capture = fixture.run();
    assert_eq!(capture.status.code(), Some(0));
    let capture: Value = serde_json::from_slice(&capture.stdout).unwrap();
    let id = capture["proposal_ids"][0].as_str().unwrap();
    let store = TraceStore::new(fixture.root.path(), TraceLimits::default()).unwrap();
    let record = store.read(id).unwrap();
    let mut input = serde_json::to_vec(&record.request).unwrap();
    input.push(b'\n');
    let provider = fixture.config.provider.as_ref().unwrap();
    let output = run_with_input(
        fixture.root.path(),
        &[
            "expert",
            "evaluate",
            "--config",
            "config.json",
            "--provider-command",
            &provider.argv[0],
            &provider.argv[1],
            &provider.argv[2],
            "--json",
        ],
        &input,
    );
    assert_eq!(
        output.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["provenance"], "imported");
    assert_eq!(value["mode"], "shadow");
    assert_eq!(store.traces().unwrap().len(), 1);
    let delivery = cli::run_in(
        Some(fixture.root.path()),
        &cli::args(&[
            "expert",
            "delivery",
            id,
            "--checkpoint",
            "checkpoint-1",
            "--json",
        ]),
    );
    let delivery: Value = serde_json::from_slice(&delivery.stdout).unwrap();
    assert!(delivery["result"]["message"].is_null());
}

#[test]
fn evaluate_stdin_rejects_duplicate_keys_oversize_and_unterminated_lines() {
    let fixture = CheckpointFixture::new();
    for input in [
        b"{\"request_id\":\"one\",\"request_id\":\"two\"}\n".to_vec(),
        vec![b'x'; 70000],
        b"{}".to_vec(),
    ] {
        let output = run_with_input(
            fixture.root.path(),
            &["expert", "evaluate", "--json"],
            &input,
        );
        assert_eq!(output.status.code(), Some(2));
    }
}

#[test]
fn replay_twice_with_provider_disabled_is_byte_stable() {
    use blabla::expert::trace::{TraceLimits, TraceStore};
    let fixture = CheckpointFixture::new();
    assert_eq!(fixture.run().status.code(), Some(0));
    let store = TraceStore::new(fixture.root.path(), TraceLimits::default()).unwrap();
    let id = store.traces().unwrap()[0].request_id.clone();
    let record = store.read(&id).unwrap();
    std::fs::write(
        fixture.root.path().join("saved.json"),
        serde_json::to_vec(&record).unwrap(),
    )
    .unwrap();
    std::fs::remove_file(fixture.root.path().join("config.json")).unwrap();
    let first = cli::run_in(
        Some(fixture.root.path()),
        &cli::args(&["expert", "replay", "saved.json", "--json"]),
    );
    let second = cli::run_in(
        Some(fixture.root.path()),
        &cli::args(&["expert", "replay", "saved.json", "--json"]),
    );
    assert_eq!(first.status.code(), Some(0));
    assert_eq!(first.stdout, second.stdout);
    assert_eq!(
        serde_json::from_slice::<Value>(&first.stdout).unwrap(),
        serde_json::to_value(&record.result).unwrap()
    );
}

#[test]
fn deterministic_local_blocker_checkpoint_makes_no_provider_calls() {
    let fixture = CheckpointFixture::new();
    let mut task = blabla::project::task::read(fixture.root.path(), "work")
        .unwrap()
        .unwrap();
    task.evidence[0].exit = 1;
    blabla::project::task::write(fixture.root.path(), &task).unwrap();
    let output = fixture.run();
    assert_eq!(output.status.code(), Some(0));
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["provider_calls"], 0);
    assert_eq!(value["captured"], 1);
    assert!(value.get("results").is_none());
}

#[test]
fn truthful_sequence_gap_is_nonactionable_capture() {
    let mut fixture = CheckpointFixture::new();
    fixture.event.sequence = 3;
    fixture.event.previous_sequence = Some(1);
    fixture.event.host.gaps = vec!["checkpoint 2 was not observed".into()];
    let output = fixture.run();
    assert_eq!(output.status.code(), Some(0));
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["capture_status"], "abstained");
    assert_eq!(value["provider_calls"], 0);
}
