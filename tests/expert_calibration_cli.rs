#[path = "support/cli.rs"]
mod cli;
use blabla::expert::calibration::{MAX_FIT_BYTES, canonical_sha256, sha256};
use blabla::expert::policy::*;
use blabla::expert::provider::*;
use blabla::expert::*;
use blabla::project::{self, task};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::Path;
use tempfile::TempDir;

const KNOWLEDGE: &str = r#"
knowledge "review" { purpose "Review a bounded change." }
ruling "support" { pack "review" statement "Follow the assigned goal." }
judgment "goal-drift" {
 pack "review" purpose "Check alignment." requires ["rules"]
 question "Does the work drift?" criteria "Use the selected rules."
 output "choice" alternatives ["drift", "aligned"] templates ["read-identity"]
}
"#;
const PROCESS: &str = r#"
role "worker" { purpose "Work." }
binding "drift" {
 judgment "judgment::review::goal-drift" roles ["worker"] checkpoints ["turn-end"]
 rules ["ruling::review::support"]
}
"#;

fn write_json(root: &Path, path: &str, value: &Value) -> Value {
    let bytes = serde_json::to_vec_pretty(value).unwrap();
    std::fs::write(root.join(path), &bytes).unwrap();
    json!({"id": path.replace('.', "-"), "path": path, "sha256": sha256(&bytes)})
}

fn fixture() -> (TempDir, Value) {
    let root = TempDir::new().unwrap();
    for (name, text) in [
        (
            "project.bla",
            "project Fit\nknowledge \"knowledge.bla\"\nprocess \"process.bla\"\n",
        ),
        ("knowledge.bla", KNOWLEDGE),
        ("process.bla", PROCESS),
        ("input.txt", "first"),
    ] {
        std::fs::write(root.path().join(name), text).unwrap();
    }
    let project =
        project::load(project::read_manifest(&root.path().join("project.bla")).unwrap()).unwrap();
    let (mut judgments, mut bindings) = blabla::expert::trace::definitions(&project).unwrap();
    let judgment = judgments.remove(0);
    let binding = bindings.remove(0);
    let task = task::Task {
        name: "work".into(),
        role: "worker".into(),
        statement: "Check alignment.".into(),
        state: "accepted".into(),
        scope: vec!["input.txt".into()],
        acceptance_epoch: 1,
        ..task::Task::default()
    };
    task::write(root.path(), &task).unwrap();
    let event = ObservedEvent {
        event_id: "event-1".into(),
        run_id: "run-1".into(),
        task: "task::work".into(),
        checkpoint_id: "checkpoint-1".into(),
        sequence: 1,
        previous_sequence: None,
        unix_ms: 1,
        kind: CheckpointKind::TurnEnd,
        host: HostCapabilities {
            host: "fixture".into(),
            version: "1".into(),
            adapter: "fixture".into(),
            checkpoints: vec![CheckpointKind::TurnEnd],
            pauses_worker: false,
            same_task_delivery: false,
            delivery_receipts: false,
            pre_tool_control: false,
            gaps: vec![],
        },
        observations: vec![],
    };
    let request = EvaluationRequest {
        request_id: "request-1".into(),
        packet: project::expert::build_packet(
            &project,
            &task,
            &event,
            &binding,
            &ExpertLimits::default(),
            &[],
        )
        .unwrap(),
        question_fingerprint: question_fingerprint(&judgment),
        template_fingerprint: template_fingerprint(&judgment),
        judgment,
    };
    let provider = ProviderIdentity {
        provider: "fixture".into(),
        model: "fixture-model".into(),
        checkpoint: "fixture-checkpoint".into(),
        supported_outputs: vec![OutputKind::Choice],
        probabilities: false,
        certification: None,
    };
    let response = EvaluationResponse {
        request_id: request.request_id.clone(),
        packet_hash: request.packet.hash.clone(),
        question_fingerprint: request.question_fingerprint.clone(),
        template_fingerprint: request.template_fingerprint.clone(),
        provider: provider.clone(),
        timing: EvaluationTiming {
            queue_ms: 0,
            inference_ms: 1,
            total_ms: 1,
        },
        usage: ProviderUsage {
            input_tokens: None,
            output_tokens: None,
            reported_latency_ms: None,
        },
        provider_request_id: None,
        self_report: None,
        diagnostic: None,
        outcome: Ok(TypedAnswer::Choice {
            pick: "drift".into(),
            probabilities: None,
            confidence: None,
        }),
    };
    let mut settings = PolicySettings {
        binding_id: binding.id(),
        concern: ConcernKind::GoalDrift,
        rules: vec![PolicyRule {
            id: "trigger".into(),
            predicate: Predicate::ChoiceLabel {
                label: "drift".into(),
            },
            outcome: AdvisoryOutcome::Nudge,
            template: Some(TemplateKind::ReadIdentity),
            reference: ReferenceSelection::Slot {
                slot: ContextSlot::Rules,
            },
        }],
        calibration: CalibrationRecord {
            record_id: "calibration-1".into(),
            provider: provider.clone(),
            question_fingerprint: request.question_fingerprint.clone(),
            template_fingerprint: request.template_fingerprint.clone(),
            policy_fingerprint: String::new(),
            development_fingerprint: "a".repeat(64),
            thresholds: BTreeMap::new(),
        },
    };
    settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
    let requests = format!("{}\n", serde_json::to_string(&request).unwrap());
    std::fs::write(root.path().join("requests.jsonl"), &requests).unwrap();
    let command = write_json(
        root.path(),
        "command.json",
        &json!({"stdout": {"response": response}, "exit": 0}),
    );
    let protocol = protocol();
    let protocol_evidence = write_json(root.path(), "protocol.json", &protocol);
    let manifest = json!({"kind": "real_calibration_requests", "schema_version": 1,
        "development_manifest_sha256": "a".repeat(64),
        "requests_jsonl": {"id": "requests", "path": "requests.jsonl", "sha256": sha256(requests.as_bytes())},
        "cases": [{"case_id": "case-1", "group_id": "group-1", "primary_request_id": "request-1",
            "selection_request_id": null, "gold": {"justified_nudge": true, "acceptable_reference_sets": [["ruling::review::support"]]}}]});
    let manifest_evidence = write_json(root.path(), "manifest.json", &manifest);
    let plan = json!({"kind": "typed_development_fit_plan", "schema_version": 1,
        "protocol_sha256": canonical_sha256(&protocol).unwrap(), "development_manifest_sha256": "a".repeat(64),
        "holdout_manifest_sha256": "c".repeat(64), "request_manifest_sha256": canonical_sha256(&manifest).unwrap(),
        "provider": provider, "limits": ExpertLimits::default(),
        "groups": [{"group_id": "group-1", "family": "goal-drift", "primary_binding": binding.id(), "selection_binding": null,
            "candidates": [{"candidate_id": "candidate-1", "primary": settings, "selection": null}],
            "objective": {"false_nudge_max": 0.0, "min_evaluable_coverage": 1.0, "min_justified_opportunities": 1,
                "min_proposed_nudges": 1, "rank": ["fewest_missed_correct_nudges", "fewest_false_nudges", "candidate_id"]}}]});
    let plan_evidence = write_json(root.path(), "plan.json", &plan);
    let input = json!({"kind": "fit_saved_development", "schema_version": 1,
        "protocol_evidence": protocol_evidence, "plan": plan, "plan_evidence": plan_evidence,
        "request_manifest": manifest, "manifest_evidence": manifest_evidence,
        "executions": [{"request": request, "response": response, "command_evidence": command}]});
    write_json(root.path(), "fit.json", &input);
    (root, input)
}

fn refreeze(root: &Path, input: &mut Value) {
    input["manifest_evidence"] = write_json(root, "manifest.json", &input["request_manifest"]);
    input["plan"]["request_manifest_sha256"] =
        json!(canonical_sha256(&input["request_manifest"]).unwrap());
    input["plan_evidence"] = write_json(root, "plan.json", &input["plan"]);
    write_json(root, "fit.json", input);
}

fn run(root: &Path) -> std::process::Output {
    cli::run_in(
        Some(root),
        &cli::args(&["expert", "fit-saved", "--input", "fit.json", "--json"]),
    )
}

fn assert_error(root: &Path, exit: i32) {
    let output = run(root);
    assert_eq!(
        output.status.code(),
        Some(exit),
        "stdout: {} stderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["category"], "expert");
    assert!(value.get("groups").is_none());
}

#[test]
fn saved_cli_fits_without_side_effects_and_keeps_infeasible_successful() {
    let (root, mut input) = fixture();
    let mut closed = task::read(root.path(), "work").unwrap().unwrap();
    closed.state = "closed".into();
    task::write(root.path(), &closed).unwrap();
    std::fs::write(
        root.path().join("input.txt"),
        "changed after saved response",
    )
    .unwrap();
    let before = project::snapshot(root.path(), &project::ignore::Ignore::default());
    let output = run(root.path());
    assert_eq!(
        output.status.code(),
        Some(0),
        "stdout: {} stderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["groups"][0]["status"], "eligible");
    assert_eq!(
        result["groups"][0]["selected_primary"],
        input["plan"]["groups"][0]["candidates"][0]["primary"]
    );
    assert_eq!(
        result["fit_plan_sha256"],
        canonical_sha256(&input["plan"]).unwrap()
    );
    assert_ne!(result["fit_plan_sha256"], input["plan_evidence"]["sha256"]);
    assert_eq!(result["provider_calls"], 0);
    assert_eq!(result["delivery_attempts"], 0);
    assert_eq!(result["promotion_records"], json!([]));
    assert_eq!(
        project::snapshot(root.path(), &project::ignore::Ignore::default()),
        before
    );
    assert!(!root.path().join(".blabla/expert").exists());
    input["executions"][0]["response"]["outcome"]["Ok"]["pick"] = json!("aligned");
    input["executions"][0]["command_evidence"] = write_json(
        root.path(),
        "command.json",
        &json!({"stdout": {"response": input["executions"][0]["response"]}, "exit": 0}),
    );
    write_json(root.path(), "fit.json", &input);
    let output = run(root.path());
    assert_eq!(output.status.code(), Some(0));
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["groups"][0]["status"], "no_feasible_candidate");
    assert!(result["groups"][0]["selected_primary"].is_null());
}

#[test]
fn saved_cli_rejects_unresolved_current_project_identities() {
    for (file, content) in [
        (
            "process.bla",
            PROCESS.replace("binding \"drift\"", "binding \"other\""),
        ),
        (
            "knowledge.bla",
            KNOWLEDGE.replace("Does the work drift?", "Is the work aligned?"),
        ),
        (
            "knowledge.bla",
            KNOWLEDGE.replace("ruling \"support\"", "ruling \"other\""),
        ),
        (".blabla/tasks/work.json", String::new()),
    ] {
        let (root, _) = fixture();
        if content.is_empty() {
            std::fs::remove_file(root.path().join(file)).unwrap();
        } else {
            std::fs::write(root.path().join(file), content).unwrap();
        }
        assert_error(root.path(), 2);
    }
    let (root, mut input) = fixture();
    input["request_manifest"]["cases"][0]["gold"]["acceptable_reference_sets"] =
        json!([["ruling::review::unknown"]]);
    refreeze(root.path(), &mut input);
    assert_error(root.path(), 2);
}

#[test]
fn saved_cli_rejects_invalid_json_and_input_overflow() {
    let (root, _) = fixture();
    for bytes in [
        b"{} trailing".to_vec(),
        b"{\"kind\":1,\"kind\":2}".to_vec(),
        vec![b' '; MAX_FIT_BYTES + 1],
    ] {
        std::fs::write(root.path().join("fit.json"), bytes).unwrap();
        assert_error(root.path(), 2);
    }
}

#[test]
fn saved_cli_requires_safe_existing_hash_matched_evidence() {
    for (pointer, value, exit) in [
        ("/protocol_evidence/path", json!("../protocol.json"), 2),
        ("/protocol_evidence/path", json!("missing.json"), 4),
        ("/protocol_evidence/sha256", json!("0".repeat(64)), 2),
        (
            "/executions/0/command_evidence/path",
            json!("missing.json"),
            4,
        ),
        (
            "/executions/0/command_evidence/sha256",
            json!("0".repeat(64)),
            2,
        ),
    ] {
        let (root, mut input) = fixture();
        *input.pointer_mut(pointer).unwrap() = value;
        write_json(root.path(), "fit.json", &input);
        assert_error(root.path(), exit);
    }
    let (root, _) = fixture();
    std::fs::write(root.path().join("requests.jsonl"), "{}\n").unwrap();
    assert_error(root.path(), 2);
    let (root, _) = fixture();
    std::fs::remove_file(root.path().join("requests.jsonl")).unwrap();
    assert_error(root.path(), 4);
    let (root, _) = fixture();
    std::fs::write(
        root.path().join("protocol.json"),
        vec![b' '; MAX_FIT_BYTES + 1],
    )
    .unwrap();
    assert_error(root.path(), 2);
    for duplicate in [false, true] {
        let (root, mut input) = fixture();
        let mut request = input["executions"][0]["request"].clone();
        let requests = if duplicate {
            let line = serde_json::to_string(&request).unwrap();
            format!("{line}\n{line}\n")
        } else {
            request["request_id"] = json!("unexpected-request");
            format!("{}\n", serde_json::to_string(&request).unwrap())
        };
        std::fs::write(root.path().join("requests.jsonl"), &requests).unwrap();
        input["request_manifest"]["requests_jsonl"]["sha256"] = json!(sha256(requests.as_bytes()));
        refreeze(root.path(), &mut input);
        assert_error(root.path(), 2);
    }
}

#[cfg(unix)]
#[test]
fn saved_cli_rejects_symlink_files_and_parent_directories() {
    for directory in [false, true] {
        let (root, mut input) = fixture();
        if directory {
            std::os::unix::fs::symlink(root.path(), root.path().join("linked")).unwrap();
            input["protocol_evidence"]["path"] = json!("linked/protocol.json");
        } else {
            std::os::unix::fs::symlink(
                root.path().join("protocol.json"),
                root.path().join("linked.json"),
            )
            .unwrap();
            input["protocol_evidence"]["path"] = json!("linked.json");
        }
        write_json(root.path(), "fit.json", &input);
        assert_error(root.path(), 2);
    }
}

fn protocol() -> Value {
    let budget = json!({"false_nudge_max": 0.0, "p95_delivery_ms": 1000, "min_delivered_nudges": 10,
        "min_justified_opportunities": 1, "min_evaluable_coverage": 1.0});
    json!({
        "schema_version": 1, "protocol_id": "test-protocol", "status": "frozen", "approved_by": "test author",
        "approved_utc": "2026-09-30T00:00:00Z", "evidence_kind": "predeclared_protocol",
        "datasets": {"development": {"manifest_sha256": "a".repeat(64)}, "holdout": {"manifest_sha256": "c".repeat(64)}},
        "budgets": {"goal-drift": budget, "expertise": budget, "claim-support": budget, "failed-approach": budget},
        "quality_interval": {"method": "exact-one-sided-clopper-pearson", "confidence": 0.95,
            "zero_denominator": "unknown", "ungraded_nudges": "cannot pass"},
        "latency_quantile": "nearest-rank",
        "calibration": {"allowed_split": "development", "candidate_thresholds": [0.5, 0.7, 0.8, 0.9, 0.95],
            "signal": "typed policy", "holdout_access": false},
        "budget_rationale": {"false_nudge": "bounded", "latency": "bounded", "timing_evidence_kind": "fixture", "timing_evidence_sha256": "d".repeat(64)},
        "host": {"status": "blocked", "capabilities": {"host": "fixture", "version": "1", "adapter": "fixture",
            "checkpoints": [], "pauses_worker": false, "same_task_delivery": false, "delivery_receipts": false,
            "pre_tool_control": false, "gaps": []}, "stop_reason": "fixture", "evidence_path": "evidence/host.json", "evidence_sha256": "e".repeat(64)},
        "pilot": {"phase": "pilot", "task_id": "task::work", "task": "Test only", "arms": ["off", "shadow", "advisory"],
            "order": ["off", "shadow", "advisory"], "runs_per_arm": 1, "max_wall_ms": 1000, "call_limit_per_arm": 2,
            "cost_limit_per_arm": 0, "snapshot_files": {},
            "controls": {"worker": "fixture", "tools": "fixture", "host": "fixture", "onboarding": "fixture", "rules": "fixture", "environment": "fixture"},
            "grading": {"correctness": "independent", "scope": "independent", "owner_interventions": "count", "steering_ms": "timed", "rework_ms": "timed", "acknowledgment": "receipt"},
            "stop_reasons": ["timeout"], "promotion_eligible": false},
        "expanded": {"status": "not_predeclared", "stop_reason": "fixture", "promotion_eligible": false},
        "promotion": {"required_evidence_kind": "matched_live_expanded", "requires_independent_correctness_and_scope": true,
            "requires_observed_steering_reduction": true, "replay_fixture_pilot_allowed": false}
    })
}

fn preflight_fixture(root: &Path, input: &Value) -> Value {
    let mut config = serde_json::to_value(blabla::expert::trace::RuntimeConfig::default()).unwrap();
    config["provider"] =
        json!({"identity": input["plan"]["provider"], "argv": ["never-execute-this-provider"]});
    config["policies"] = json!([input["plan"]["groups"][0]["candidates"][0]["primary"]]);
    let config_evidence = write_json(root, "runtime.json", &config);
    let preflight = json!({"kind": "preflight_development_calibration", "schema_version": 1,
        "protocol_evidence": input["protocol_evidence"], "plan_evidence": input["plan_evidence"],
        "manifest_evidence": input["manifest_evidence"], "runtime_config_evidence": config_evidence});
    write_json(root, "preflight.json", &preflight);
    preflight
}

fn run_preflight(root: &Path) -> std::process::Output {
    cli::run_in(
        Some(root),
        &cli::args(&[
            "expert",
            "preflight-development-calibration",
            "--input",
            "preflight.json",
            "--json",
        ]),
    )
}

#[test]
fn preflight_validates_without_responses_provider_or_holdout_access() {
    let (root, input) = fixture();
    let preflight = preflight_fixture(root.path(), &input);
    std::fs::remove_file(root.path().join("fit.json")).unwrap();
    std::fs::remove_file(root.path().join("command.json")).unwrap();
    let before = project::snapshot(root.path(), &project::ignore::Ignore::default());
    let output = run_preflight(root.path());
    assert_eq!(
        output.status.code(),
        Some(0),
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["kind"], "preflighted_development_calibration");
    assert_eq!(result["request_ids"], json!(["request-1"]));
    assert_eq!(result["provider_calls"], 0);
    assert_eq!(result["delivery_attempts"], 0);
    let files = result["referenced_files"].as_array().unwrap();
    let paths = files
        .iter()
        .map(|file| file["path"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        paths,
        vec![
            ".blabla/tasks/work.json",
            "input.txt",
            "knowledge.bla",
            "manifest.json",
            "plan.json",
            "process.bla",
            "project.bla",
            "protocol.json",
            "requests.jsonl",
            "runtime.json"
        ]
    );
    for file in files {
        assert_eq!(
            file["sha256"],
            sha256(&std::fs::read(root.path().join(file["path"].as_str().unwrap())).unwrap())
        );
    }
    assert_eq!(
        result["fit_plan_sha256"],
        canonical_sha256(&input["plan"]).unwrap()
    );
    assert_eq!(
        result["request_manifest_sha256"],
        canonical_sha256(&input["request_manifest"]).unwrap()
    );
    for key in [
        "protocol_evidence",
        "plan_evidence",
        "manifest_evidence",
        "runtime_config_evidence",
    ] {
        assert!(
            result["referenced_files"]
                .as_array()
                .unwrap()
                .contains(&preflight[key])
        );
    }
    assert!(
        result["referenced_files"]
            .as_array()
            .unwrap()
            .contains(&input["request_manifest"]["requests_jsonl"])
    );
    assert_eq!(
        project::snapshot(root.path(), &project::ignore::Ignore::default()),
        before
    );
    assert!(!root.path().join(".blabla/expert").exists());
}

#[test]
fn preflight_rejects_later_malformed_requests_and_candidate_or_config_mismatch() {
    for mutation in [
        "later",
        "candidate",
        "config",
        "provider",
        "limit",
        "holdout",
        "unknown",
        "artifact",
    ] {
        let (root, mut input) = fixture();
        if mutation == "later" {
            let requests = format!(
                "{}\n{{}}\n",
                serde_json::to_string(&input["executions"][0]["request"]).unwrap()
            );
            std::fs::write(root.path().join("requests.jsonl"), &requests).unwrap();
            input["request_manifest"]["requests_jsonl"]["sha256"] =
                json!(sha256(requests.as_bytes()));
        } else if mutation == "candidate" {
            input["plan"]["groups"][0]["candidates"][0]["primary"]["calibration"]["question_fingerprint"] =
                json!("mismatch");
        }
        refreeze(root.path(), &mut input);
        let mut preflight = preflight_fixture(root.path(), &input);
        if matches!(mutation, "config" | "provider" | "limit") {
            let mut config: Value =
                serde_json::from_slice(&std::fs::read(root.path().join("runtime.json")).unwrap())
                    .unwrap();
            match mutation {
                "config" => config["mode"] = json!("off"),
                "provider" => config["provider"]["identity"]["model"] = json!("other-model"),
                _ => config["limits"]["request_timeout_ms"] = json!(1),
            }
            preflight["runtime_config_evidence"] = write_json(root.path(), "runtime.json", &config);
        } else if mutation == "holdout" {
            let mut protocol = protocol();
            protocol["calibration"]["holdout_access"] = json!(true);
            preflight["protocol_evidence"] = write_json(root.path(), "protocol.json", &protocol);
        } else if mutation == "unknown" {
            preflight["responses"] = json!([]);
        } else if mutation == "artifact" {
            std::fs::write(root.path().join("plan.json"), "{}\n").unwrap();
        }
        write_json(root.path(), "preflight.json", &preflight);
        let output = run_preflight(root.path());
        assert_eq!(
            output.status.code(),
            Some(2),
            "{mutation}: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let result: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(result["category"], "expert", "{mutation}");
    }
}

#[test]
fn preflight_rejects_stale_epoch_task_project_and_revision() {
    for mutation in ["epoch", "closed", "goal", "project", "path"] {
        let (root, input) = fixture();
        preflight_fixture(root.path(), &input);
        if matches!(mutation, "epoch" | "closed" | "goal") {
            let mut changed = task::read(root.path(), "work").unwrap().unwrap();
            match mutation {
                "epoch" => changed.acceptance_epoch += 1,
                "closed" => changed.state = "closed".into(),
                _ => changed.goal = Some("missing".into()),
            }
            task::write(root.path(), &changed).unwrap();
        } else if mutation == "project" {
            std::fs::write(
                root.path().join("knowledge.bla"),
                KNOWLEDGE.replace("Follow the assigned goal.", "A different rule."),
            )
            .unwrap();
        } else {
            std::fs::write(root.path().join("input.txt"), "changed").unwrap();
        }
        let output = run_preflight(root.path());
        assert_eq!(
            output.status.code(),
            Some(2),
            "{mutation}: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[test]
fn preflight_checks_development_declarations_before_opening_requests() {
    for mutation in ["protocol", "manifest", "candidate"] {
        let (root, mut input) = fixture();
        input["request_manifest"]["requests_jsonl"]["path"] = json!("missing-must-not-open.jsonl");
        if mutation == "manifest" {
            input["request_manifest"]["kind"] = json!("holdout_requests");
        } else if mutation == "candidate" {
            input["plan"]["groups"][0]["candidates"][0]["primary"]["calibration"]["policy_fingerprint"] =
                json!("bad");
        }
        refreeze(root.path(), &mut input);
        let mut wire = preflight_fixture(root.path(), &input);
        if mutation == "protocol" {
            let mut changed = protocol();
            changed["calibration"]["holdout_access"] = json!(true);
            wire["protocol_evidence"] = write_json(root.path(), "protocol.json", &changed);
            write_json(root.path(), "preflight.json", &wire);
        }
        let output = run_preflight(root.path());
        assert_eq!(
            output.status.code(),
            Some(2),
            "{mutation}: {}",
            String::from_utf8_lossy(&output.stdout)
        );
        let value: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["category"], "expert");
    }
}

#[test]
fn preflight_checks_every_well_typed_request_and_allows_empty_config_policies() {
    let (root, mut input) = fixture();
    let mut second = input["executions"][0]["request"].clone();
    second["request_id"] = json!("request-2");
    let mut case = input["request_manifest"]["cases"][0].clone();
    case["case_id"] = json!("case-2");
    case["primary_request_id"] = json!("request-2");
    input["request_manifest"]["cases"]
        .as_array_mut()
        .unwrap()
        .push(case);
    for malformed in [false, true] {
        if malformed {
            second["question_fingerprint"] = json!("wrong");
        }
        let requests = format!(
            "{}\n{}\n",
            serde_json::to_string(&input["executions"][0]["request"]).unwrap(),
            serde_json::to_string(&second).unwrap()
        );
        std::fs::write(root.path().join("requests.jsonl"), &requests).unwrap();
        input["request_manifest"]["requests_jsonl"]["sha256"] = json!(sha256(requests.as_bytes()));
        refreeze(root.path(), &mut input);
        let mut wire = preflight_fixture(root.path(), &input);
        let mut config: Value =
            serde_json::from_slice(&std::fs::read(root.path().join("runtime.json")).unwrap())
                .unwrap();
        config["policies"] = json!([]);
        wire["runtime_config_evidence"] = write_json(root.path(), "runtime.json", &config);
        write_json(root.path(), "preflight.json", &wire);
        let output = run_preflight(root.path());
        assert_eq!(
            output.status.code(),
            Some(if malformed { 2 } else { 0 }),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        let result: Value = serde_json::from_slice(&output.stdout).unwrap();
        if malformed {
            assert_eq!(result["category"], "expert");
        } else {
            assert_eq!(result["request_ids"], json!(["request-1", "request-2"]));
        }
    }
}

#[cfg(unix)]
#[test]
fn preflight_rejects_symlink_authority_task_revision_and_evidence_files() {
    for file in [
        "knowledge.bla",
        ".blabla/tasks/work.json",
        "input.txt",
        "requests.jsonl",
        "runtime.json",
    ] {
        let (root, input) = fixture();
        preflight_fixture(root.path(), &input);
        let original = root.path().join(file);
        let moved = root.path().join("original-file");
        std::fs::rename(&original, &moved).unwrap();
        std::os::unix::fs::symlink(&moved, &original).unwrap();
        let output = run_preflight(root.path());
        assert_eq!(
            output.status.code(),
            Some(2),
            "{file}: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    }
}

#[test]
fn preflight_rejects_gold_outside_primary_packet_reference_universe() {
    for references in [
        json!([["task::work"]]),
        json!([["ruling::review::support", "task::work"]]),
        json!([["ruling::review::support"], ["task::work"]]),
        json!([["ruling::review::unused"]]),
    ] {
        let (root, mut input) = fixture();
        std::fs::write(
            root.path().join("knowledge.bla"),
            format!(
                "{KNOWLEDGE}\nruling \"unused\" {{ pack \"review\" statement \"Not selected.\" }}\n"
            ),
        )
        .unwrap();
        preflight_fixture(root.path(), &input);
        assert_eq!(run_preflight(root.path()).status.code(), Some(0));
        input["request_manifest"]["cases"][0]["gold"]["acceptable_reference_sets"] = references;
        refreeze(root.path(), &mut input);
        preflight_fixture(root.path(), &input);
        let output = run_preflight(root.path());
        assert_eq!(
            output.status.code(),
            Some(2),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        let value: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["category"], "expert");
    }
}
