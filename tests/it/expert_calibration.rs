use blabla::expert::calibration::{
    FitSavedRequest, MAX_FIT_BYTES, canonical_sha256, decode_fit_saved, encode_fit_result,
    fit_saved, sha256, validate_fit_context,
};
use blabla::expert::packet::{self, ContextValue, ExpertPacket};
use blabla::expert::policy::*;
use blabla::expert::provider::*;
use blabla::expert::trace::TraceError;
use blabla::expert::*;
use blabla::memory::knowledge::{Judgment, JudgmentOutput};
use blabla::project::task::revision::RelevantRevision;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn fixture(family: &str) -> Value {
    let (slot, target, template, concern, output, predicate, answer) = match family {
        "goal-drift" => (
            ContextSlot::Goal,
            "goal::work",
            TemplateKind::ReadIdentity,
            ConcernKind::GoalDrift,
            JudgmentOutput::Choice {
                alternatives: vec!["drift".into(), "aligned".into()],
            },
            Predicate::ChoiceLabel {
                label: "drift".into(),
            },
            TypedAnswer::Choice {
                pick: "drift".into(),
                probabilities: None,
                confidence: None,
            },
        ),
        "failed-approach" => (
            ContextSlot::Attempts,
            "evidence::attempt",
            TemplateKind::ReconsiderApproach,
            ConcernKind::RepeatedApproach,
            JudgmentOutput::Score {
                levels: vec!["new".into(), "repeating".into(), "stuck".into()],
            },
            Predicate::ScoreTail {
                from_level: "repeating".into(),
            },
            TypedAnswer::Score {
                level: None,
                distribution: Some(vec![0.1, 0.2, 0.7]),
                expectation: None,
                confidence: None,
            },
        ),
        "expertise" => (
            ContextSlot::Candidates,
            "knowledge::candidate",
            TemplateKind::ReadIdentity,
            ConcernKind::Expertise,
            JudgmentOutput::Noul {
                proposition: "Expertise is useful.".into(),
            },
            Predicate::NoulProbability { value: true },
            TypedAnswer::Noul {
                value: None,
                probability: Some(0.9),
                confidence: None,
            },
        ),
        _ => (
            ContextSlot::Evidence,
            "evidence::check",
            TemplateKind::CiteEvidence,
            ConcernKind::UnsupportedClaim,
            JudgmentOutput::Noul {
                proposition: "The claim is supported.".into(),
            },
            Predicate::NoulProbability { value: false },
            TypedAnswer::Noul {
                value: None,
                probability: Some(0.1),
                confidence: None,
            },
        ),
    };
    let judgment = Judgment {
        name: if family == "expertise" {
            "expertise-useful"
        } else {
            family
        }
        .into(),
        pack: "review".into(),
        purpose: "Check bounded evidence.".into(),
        question: "Does the judgment apply?".into(),
        criteria: "Use the selected evidence.".into(),
        requires: vec![slot],
        optional: vec![],
        output,
        templates: vec![template],
    };
    let revision = RelevantRevision {
        acceptance_epoch: 1,
        task_digest: "1234567890abcdef".into(),
        paths: BTreeMap::new(),
        identities: BTreeMap::from([(judgment.id(), "abcdef1234567890".into())]),
    };
    let evidence = matches!(slot, ContextSlot::Evidence | ContextSlot::Attempts);
    let observation = Observation {
        id: target.into(),
        slot,
        kind: SourceKind::DeterministicOutput,
        capture: if evidence {
            "local:task-evidence"
        } else {
            "local:registered-memory"
        }
        .into(),
        observed_revision: revision.fingerprint(),
        text: "candidate-1: Selected bounded evidence.".into(),
        fact: evidence.then(|| ObservedFact::CommandExit {
            argv: vec!["check".into()],
            exit: 1,
        }),
    };
    let mut packet = ExpertPacket {
        event: EventStamp {
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
        },
        binding_id: format!("binding::{family}"),
        revision,
        context: BTreeMap::from([(
            slot,
            ContextValue::Present {
                observations: vec![observation],
            },
        )]),
        references: BTreeMap::from([(target.into(), "Bounded reference.".into())]),
        history: vec![],
        accounting: PacketAccounting {
            selected_bytes: 0,
            omitted_bytes: 0,
            estimated_tokens: 0,
            provider_tokens: None,
        },
        hash: String::new(),
    };
    refresh_packet(&mut packet);
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
        supported_outputs: vec![OutputKind::Choice, OutputKind::Noul, OutputKind::Score],
        probabilities: true,
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
            input_tokens: Some(11),
            output_tokens: Some(3),
            reported_latency_ms: None,
        },
        provider_request_id: None,
        self_report: None,
        diagnostic: None,
        outcome: Ok(answer),
    };
    let mut settings = PolicySettings {
        binding_id: request.packet.binding_id.clone(),
        concern,
        rules: vec![PolicyRule {
            id: "trigger".into(),
            predicate,
            outcome: AdvisoryOutcome::Nudge,
            template: Some(template),
            reference: ReferenceSelection::Slot { slot },
        }],
        calibration: CalibrationRecord {
            record_id: "calibration-1".into(),
            provider: provider.clone(),
            question_fingerprint: request.question_fingerprint.clone(),
            template_fingerprint: request.template_fingerprint.clone(),
            policy_fingerprint: String::new(),
            development_fingerprint: "a".repeat(64),
            thresholds: if family == "goal-drift" {
                BTreeMap::new()
            } else {
                BTreeMap::from([("trigger".into(), 0.7)])
            },
        },
    };
    settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
    let mut input = json!({
        "kind": "fit_saved_development", "schema_version": 1, "protocol_evidence": evidence_ref("protocol"),
        "plan": {
            "kind": "typed_development_fit_plan", "schema_version": 1,
            "protocol_sha256": "b".repeat(64), "development_manifest_sha256": "a".repeat(64),
            "holdout_manifest_sha256": "c".repeat(64), "request_manifest_sha256": "d".repeat(64),
            "provider": provider, "limits": ExpertLimits::default(),
            "groups": [{ "group_id": "group-1", "family": family,
                "primary_binding": settings.binding_id, "selection_binding": null,
                "candidates": [{"candidate_id": "candidate-z", "primary": settings, "selection": null}],
                "objective": {"false_nudge_max": 0.0, "min_evaluable_coverage": 1.0,
                    "min_justified_opportunities": 1, "min_proposed_nudges": 1,
                    "rank": ["fewest_missed_correct_nudges", "fewest_false_nudges", "candidate_id"]} }],
        },
        "plan_evidence": evidence_ref("plan"),
        "request_manifest": {"kind": "real_calibration_requests", "schema_version": 1,
            "development_manifest_sha256": "a".repeat(64), "requests_jsonl": evidence_ref("requests"),
            "cases": [{"case_id": "case-1", "group_id": "group-1", "primary_request_id": "request-1",
                "selection_request_id": null, "gold": {"justified_nudge": true, "acceptable_reference_sets": [[target]]}}]},
        "manifest_evidence": evidence_ref("manifest"),
        "executions": [{"request": request, "response": response, "command_evidence": evidence_ref("command")}],
    });
    if family == "expertise" {
        let mut selection_request: EvaluationRequest =
            serde_json::from_value(input["executions"][0]["request"].clone()).unwrap();
        selection_request.request_id = "selection-1".into();
        selection_request.packet.binding_id = "binding::expertise-selection".into();
        selection_request.judgment.name = "expertise-selection".into();
        selection_request.judgment.output = JudgmentOutput::Choice {
            alternatives: vec!["candidate-1".into(), "none".into()],
        };
        selection_request.question_fingerprint = question_fingerprint(&selection_request.judgment);
        refresh_packet(&mut selection_request.packet);
        let mut selection_response: EvaluationResponse =
            serde_json::from_value(input["executions"][0]["response"].clone()).unwrap();
        selection_response.request_id = selection_request.request_id.clone();
        selection_response.packet_hash = selection_request.packet.hash.clone();
        selection_response.question_fingerprint = selection_request.question_fingerprint.clone();
        selection_response.outcome = Ok(TypedAnswer::Choice {
            pick: "candidate-1".into(),
            probabilities: None,
            confidence: None,
        });
        let mut selection_settings: PolicySettings =
            serde_json::from_value(input["plan"]["groups"][0]["candidates"][0]["primary"].clone())
                .unwrap();
        selection_settings.binding_id = selection_request.packet.binding_id.clone();
        selection_settings.rules[0].predicate = Predicate::ChoiceLabel {
            label: "candidate-1".into(),
        };
        selection_settings.rules[0].reference = ReferenceSelection::SelectedCandidate;
        selection_settings.calibration.question_fingerprint =
            selection_request.question_fingerprint.clone();
        selection_settings.calibration.thresholds.clear();
        selection_settings.calibration.policy_fingerprint = policy_fingerprint(&selection_settings);
        input["plan"]["groups"][0]["selection_binding"] = json!(selection_settings.binding_id);
        input["plan"]["groups"][0]["candidates"][0]["selection"] = json!(selection_settings);
        input["request_manifest"]["cases"][0]["selection_request_id"] = json!("selection-1");
        input["executions"].as_array_mut().unwrap().push(json!({"request": selection_request, "response": selection_response, "command_evidence": evidence_ref("command-selection")}));
    }
    freeze(&mut input);
    input
}

fn evidence_ref(id: &str) -> Value {
    json!({"id": id, "path": format!("evidence/{id}.json"), "sha256": "e".repeat(64)})
}

fn refresh_packet(packet: &mut ExpertPacket) {
    packet.accounting.selected_bytes = packet::selected_bytes(packet);
    packet.accounting.estimated_tokens = packet.accounting.selected_bytes.div_ceil(4);
    packet.hash = packet::canonical_hash(packet);
}

fn freeze(input: &mut Value) {
    freeze_with_protocol(input, &protocol());
}

fn freeze_with_protocol(input: &mut Value, protocol: &Value) {
    input["protocol_evidence"]["sha256"] = json!(sha256(&serde_json::to_vec(&protocol).unwrap()));
    input["plan"]["protocol_sha256"] = json!(canonical_sha256(&protocol).unwrap());
    let manifest_hash = canonical_sha256(&input["request_manifest"]).unwrap();
    input["plan"]["request_manifest_sha256"] = json!(manifest_hash);
    input["manifest_evidence"]["sha256"] = json!(manifest_hash);
    input["plan_evidence"]["sha256"] = json!(sha256(&serde_json::to_vec(&input["plan"]).unwrap()));
}

fn fit(input: &Value) -> Value {
    serde_json::from_slice(&fit_saved_json(&serde_json::to_vec(input).unwrap()).unwrap()).unwrap()
}

fn candidate(result: &Value) -> &Value {
    &result["groups"][0]["candidates"][0]
}

fn set_probability(input: &mut Value, probability: Option<f64>) {
    input["executions"][0]["response"]["outcome"]["Ok"] =
        json!({"kind": "noul", "value": true, "probability": probability, "confidence": null});
}

#[test]
fn saved_fit_uses_false_noul_and_exact_threshold_abstention() {
    let mut input = fixture("claim-support");
    let result = fit(&input);
    assert_eq!(
        candidate(&result)["results"][0]["result"]["outcome"],
        "nudge"
    );
    assert_eq!(
        result["groups"][0]["selected_primary"],
        input["plan"]["groups"][0]["candidates"][0]["primary"]
    );
    assert_eq!(result["provider_calls"], 0);
    assert_eq!(result["delivery_attempts"], 0);
    assert_eq!(result["promotion_records"], json!([]));
    for p in [0.3, 0.3005] {
        set_probability(&mut input, Some(p));
        let result = fit(&input);
        assert_eq!(
            candidate(&result)["results"][0]["result"]["reason"],
            "rounding_uncertainty"
        );
        assert_eq!(candidate(&result)["evaluable"], 0);
        assert_eq!(candidate(&result)["missed_correct"], 1);
        assert_eq!(result["groups"][0]["status"], "no_feasible_candidate");
        assert!(result["groups"][0]["selected_primary"].is_null());
    }
    set_probability(&mut input, None);
    assert_eq!(
        candidate(&fit(&input))["results"][0]["result"]["reason"],
        "missing_answer_statistic"
    );
}

#[test]
fn saved_fit_uses_ordered_score_tail_not_expectation() {
    let mut input = fixture("failed-approach");
    input["executions"][0]["response"]["outcome"]["Ok"] = json!({"kind": "score", "level": null, "distribution": [0.6, 0.0, 0.4], "expectation": 0.8, "confidence": null});
    let result = fit(&input);
    assert_eq!(
        candidate(&result)["results"][0]["result"]["outcome"],
        "silence"
    );
    assert_eq!(candidate(&result)["proposed"], 0);
    assert_eq!(candidate(&result)["missed_correct"], 1);
}

#[test]
fn wrong_target_counts_false_and_missed_and_ranking_is_stable() {
    let mut input = fixture("claim-support");
    let mut second = input["plan"]["groups"][0]["candidates"][0].clone();
    second["candidate_id"] = json!("candidate-a");
    second["primary"]["calibration"]["record_id"] = json!("calibration-2");
    input["plan"]["groups"][0]["candidates"]
        .as_array_mut()
        .unwrap()
        .push(second.clone());
    freeze(&mut input);
    assert_eq!(
        fit(&input)["groups"][0]["selected_candidate_id"],
        "candidate-a"
    );
    input["request_manifest"]["cases"][0]["gold"]["acceptable_reference_sets"] =
        json!([["evidence::different"]]);
    freeze(&mut input);
    let result = fit(&input);
    assert_eq!(candidate(&result)["false_proposed"], 1);
    assert_eq!(candidate(&result)["missed_correct"], 1);
    assert_eq!(result["groups"][0]["status"], "no_feasible_candidate");
}

#[test]
fn paired_expertise_counts_one_opportunity_and_preserves_core_outcomes() {
    let mut input = fixture("expertise");
    let result = fit(&input);
    assert_eq!(candidate(&result)["planned"], 1);
    assert_eq!(candidate(&result)["proposed"], 1);
    assert_eq!(
        candidate(&result)["results"][0]["result"]["references"],
        json!(["knowledge::candidate"])
    );
    input["executions"][1]["response"]["outcome"]["Ok"]["pick"] = json!("none");
    assert_eq!(
        candidate(&fit(&input))["results"][0]["result"]["reason"],
        "expertise_none"
    );
    input["executions"][1]["response"]["outcome"] = json!({"Err": "timeout"});
    let result = fit(&input);
    assert_eq!(
        candidate(&result)["results"][0]["result"]["reason"],
        "expertise_selection_failed"
    );
    assert_eq!(candidate(&result)["provider_failures"], 1);
    set_probability(&mut input, Some(0.1));
    assert_eq!(
        candidate(&fit(&input))["results"][0]["result"]["outcome"],
        "silence"
    );
}

#[test]
fn imported_facts_do_not_become_local_blockers_and_history_is_honored() {
    let mut input = fixture("claim-support");
    set_probability(&mut input, Some(0.9));
    assert_eq!(
        candidate(&fit(&input))["results"][0]["result"]["outcome"],
        "silence"
    );
    set_probability(&mut input, Some(0.1));
    let mut request: EvaluationRequest =
        serde_json::from_value(input["executions"][0]["request"].clone()).unwrap();
    request.packet.history.push(InterventionSummary {
        request_id: "old-request".into(),
        concern: "unsupported_claim".into(),
        target: "evidence::check".into(),
        state: DeliveryState::Unknown,
        evidence_revision: material_fingerprint(&request.packet),
    });
    refresh_packet(&mut request.packet);
    input["executions"][0]["request"] = json!(request);
    input["executions"][0]["response"]["packet_hash"] = json!(request.packet.hash);
    assert_eq!(
        candidate(&fit(&input))["results"][0]["result"]["reason"],
        "unresolved_concern"
    );
}

#[test]
fn rejects_missing_extra_duplicate_and_mismatched_executions() {
    let input = fixture("claim-support");
    let mut mutations = vec![];
    let mut missing = input.clone();
    missing["executions"] = json!([]);
    mutations.push(missing);
    let mut duplicate = input.clone();
    duplicate["executions"]
        .as_array_mut()
        .unwrap()
        .push(input["executions"][0].clone());
    mutations.push(duplicate);
    let mut mismatch = input.clone();
    mismatch["executions"][0]["response"]["question_fingerprint"] = json!("wrong");
    mutations.push(mismatch);
    let mut provider = input.clone();
    provider["executions"][0]["response"]["provider"]["model"] = json!("other-model");
    mutations.push(provider);
    let mut hash = input.clone();
    hash["plan_evidence"]["sha256"] = json!("0".repeat(64));
    mutations.push(hash);
    for mutation in mutations {
        assert!(fit_saved_json(&serde_json::to_vec(&mutation).unwrap()).is_err());
    }
}

#[test]
fn rejects_non_threshold_candidate_changes_and_wrong_family_predicates() {
    for family in [
        "claim-support",
        "expertise",
        "failed-approach",
        "goal-drift",
    ] {
        let mut input = fixture(family);
        let mut second = input["plan"]["groups"][0]["candidates"][0].clone();
        second["candidate_id"] = json!("candidate-other");
        second["primary"]["rules"][0]["reference"] = json!({"kind": "identity", "id": "different"});
        input["plan"]["groups"][0]["candidates"]
            .as_array_mut()
            .unwrap()
            .push(second);
        freeze(&mut input);
        assert!(fit_saved_json(&serde_json::to_vec(&input).unwrap()).is_err());
    }
    let mut input = fixture("claim-support");
    input["plan"]["groups"][0]["candidates"][0]["primary"]["rules"][0]["predicate"]["value"] =
        json!(true);
    freeze(&mut input);
    assert!(fit_saved_json(&serde_json::to_vec(&input).unwrap()).is_err());
}

#[test]
fn strict_fit_json_rejects_unknown_duplicate_missing_nullable_and_oversize() {
    let input = fixture("claim-support");
    let bytes = serde_json::to_vec(&input).unwrap();
    let mut duplicate = bytes.clone();
    duplicate.splice(1..1, b"\"schema_version\":1,".iter().copied());
    assert!(fit_saved_json(&duplicate).is_err());
    let mut unknown = input.clone();
    unknown["executions"][0]["claimed_result"] = json!({"outcome": "nudge"});
    assert!(fit_saved_json(&serde_json::to_vec(&unknown).unwrap()).is_err());
    let mut missing = input.clone();
    missing["plan"]["groups"][0]
        .as_object_mut()
        .unwrap()
        .remove("selection_binding");
    assert!(fit_saved_json(&serde_json::to_vec(&missing).unwrap()).is_err());
    let mut invalid_integer = input;
    invalid_integer["schema_version"] = json!(true);
    assert!(fit_saved_json(&serde_json::to_vec(&invalid_integer).unwrap()).is_err());
    assert!(fit_saved_json(&vec![b' '; MAX_FIT_BYTES + 1]).is_err());
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

fn fit_saved_json(bytes: &[u8]) -> Result<Vec<u8>, TraceError> {
    fit_with_protocol(bytes, &protocol())
}

fn fit_with_protocol(bytes: &[u8], protocol: &Value) -> Result<Vec<u8>, TraceError> {
    let input = decode_fit_saved(bytes)?;
    let context = validate_fit_context(
        &input,
        &serde_json::to_vec(protocol).unwrap(),
        &serde_json::to_vec(&serde_json::to_value(&input.plan).unwrap()).unwrap(),
        &serde_json::to_vec(&serde_json::to_value(&input.request_manifest).unwrap()).unwrap(),
    )?;
    encode_fit_result(&fit_saved(&input, &context)?)
}

#[test]
fn frozen_protocol_context_rejects_threshold_budget_and_post_validation_mutations() {
    let input: FitSavedRequest = serde_json::from_value(fixture("claim-support")).unwrap();
    let plan = serde_json::to_vec(&serde_json::to_value(&input.plan).unwrap()).unwrap();
    let manifest =
        serde_json::to_vec(&serde_json::to_value(&input.request_manifest).unwrap()).unwrap();
    let bytes = serde_json::to_vec(&protocol()).unwrap();
    let context = validate_fit_context(&input, &bytes, &plan, &manifest).unwrap();
    let mut changed = input.clone();
    changed.plan.groups[0].objective.false_nudge_max = 1.0;
    assert!(fit_saved(&changed, &context).is_err());
    for (pointer, value) in [
        (
            "/plan/groups/0/objective/min_justified_opportunities",
            json!(2),
        ),
        (
            "/plan/groups/0/objective/min_evaluable_coverage",
            json!(0.0),
        ),
        (
            "/plan/groups/0/candidates/0/primary/calibration/thresholds/trigger",
            json!(0.7001),
        ),
    ] {
        let mut input = fixture("claim-support");
        *input.pointer_mut(pointer).unwrap() = value;
        freeze(&mut input);
        assert!(fit_saved_json(&serde_json::to_vec(&input).unwrap()).is_err());
    }
    let mut mismatched = plan.clone();
    mismatched.push(b' ');
    assert!(validate_fit_context(&input, &bytes, &mismatched, &manifest).is_err());
    let mut changed_protocol = protocol();
    changed_protocol["calibration"]["holdout_access"] = json!(true);
    let mut changed = input;
    let changed_bytes = serde_json::to_vec(&changed_protocol).unwrap();
    changed.protocol_evidence.sha256 = sha256(&changed_bytes);
    changed.plan.protocol_sha256 = canonical_sha256(&changed_protocol).unwrap();
    let changed_plan = serde_json::to_vec(&serde_json::to_value(&changed.plan).unwrap()).unwrap();
    changed.plan_evidence.sha256 = sha256(&changed_plan);
    assert!(validate_fit_context(&changed, &changed_bytes, &changed_plan, &manifest).is_err());
}

#[test]
fn canonical_hash_matches_python_sorted_utf8_number_and_string_rules() {
    for (raw, expected) in [
        ("100000000000000.125", "100000000000000.12"),
        ("100000000000000.375", "100000000000000.38"),
        ("100000000000000.625", "100000000000000.62"),
        ("100000000000000.875", "100000000000000.88"),
        ("-100000000000000.125", "-100000000000000.12"),
        ("-100000000000000.375", "-100000000000000.38"),
        ("-100000000000000.625", "-100000000000000.62"),
        ("-100000000000000.875", "-100000000000000.88"),
    ] {
        let value: Value = serde_json::from_str(raw).unwrap();
        assert_eq!(value.to_string(), expected);
        assert_eq!(
            canonical_sha256(&value).unwrap(),
            sha256(expected.as_bytes()),
            "{raw}"
        );
    }

    let value = json!({"é": "\u{8}\u{c}\n\r\t\0\\/\"\u{2028}", "numbers": [0.0, -0.0, 1e-7, 1e-6, 1e-5, 0.0001, 1e15, 1e16, 1e20, 1.2345678901234567, 5e-324, 1.7976931348623157e308, 1.0000000000000001e23]});
    assert_eq!(
        canonical_sha256(&value).unwrap(),
        "5639d80918fdecc569988af6aebc8a2411254aaa950886e2fbdbeeacebba541d"
    );
    let mut input: FitSavedRequest = serde_json::from_value(fixture("claim-support")).unwrap();
    let mut raw_plan = serde_json::to_value(&input.plan).unwrap();
    raw_plan["groups"][0]["objective"]["false_nudge_max"] = json!(0);
    let plan_bytes = serde_json::to_vec_pretty(&raw_plan).unwrap();
    input.plan_evidence.sha256 = sha256(&plan_bytes);
    let manifest =
        serde_json::to_vec(&serde_json::to_value(&input.request_manifest).unwrap()).unwrap();
    let protocol = serde_json::to_vec(&protocol()).unwrap();
    let context = validate_fit_context(&input, &protocol, &plan_bytes, &manifest).unwrap();
    let result = fit_saved(&input, &context).unwrap();
    assert_eq!(result.fit_plan_sha256, canonical_sha256(&raw_plan).unwrap());
    assert_ne!(result.fit_plan_sha256, input.plan_evidence.sha256);
}

#[test]
fn expertise_selection_must_be_choice_even_when_provider_failed() {
    let mut input = fixture("expertise");
    let mut request: EvaluationRequest =
        serde_json::from_value(input["executions"][1]["request"].clone()).unwrap();
    request.judgment.output = JudgmentOutput::Noul {
        proposition: "Wrong selection kind.".into(),
    };
    request.question_fingerprint = question_fingerprint(&request.judgment);
    input["executions"][1]["request"] = json!(request);
    input["executions"][1]["response"]["question_fingerprint"] =
        json!(request.question_fingerprint);
    input["executions"][1]["response"]["outcome"] = json!({"Err": "timeout"});
    let mut settings: PolicySettings =
        serde_json::from_value(input["plan"]["groups"][0]["candidates"][0]["selection"].clone())
            .unwrap();
    settings.rules[0].predicate = Predicate::NoulValue { value: true };
    settings.calibration.question_fingerprint = request.question_fingerprint;
    settings.calibration.policy_fingerprint = policy_fingerprint(&settings);
    input["plan"]["groups"][0]["candidates"][0]["selection"] = json!(settings);
    freeze(&mut input);
    assert!(fit_saved_json(&serde_json::to_vec(&input).unwrap()).is_err());
}

fn append_case(input: &mut Value, id: &str, probability: f64, justified: bool) {
    let mut execution = input["executions"][0].clone();
    execution["request"]["request_id"] = json!(id);
    execution["response"]["request_id"] = json!(id);
    execution["response"]["outcome"]["Ok"]["probability"] = json!(probability);
    input["executions"].as_array_mut().unwrap().push(execution);
    let mut case = input["request_manifest"]["cases"][0].clone();
    case["case_id"] = json!(id);
    case["primary_request_id"] = json!(id);
    case["gold"]["justified_nudge"] = json!(justified);
    if !justified {
        case["gold"]["acceptable_reference_sets"] = json!([]);
    }
    input["request_manifest"]["cases"]
        .as_array_mut()
        .unwrap()
        .push(case);
}

#[test]
fn candidate_ranking_prefers_fewer_misses_then_fewer_false_nudges() {
    let mut input = fixture("claim-support");
    set_probability(&mut input, Some(0.02));
    input["plan"]["groups"][0]["candidates"][0]["candidate_id"] = json!("candidate-a");
    let mut high = input["plan"]["groups"][0]["candidates"][0].clone();
    high["candidate_id"] = json!("candidate-z");
    high["primary"]["calibration"]["thresholds"]["trigger"] = json!(0.9);
    input["plan"]["groups"][0]["candidates"]
        .as_array_mut()
        .unwrap()
        .push(high);
    append_case(&mut input, "justified-middle", 0.2, true);
    append_case(&mut input, "unjustified-middle", 0.15, false);
    input["plan"]["groups"][0]["objective"]["false_nudge_max"] = json!(0.5);
    let mut protocol = protocol();
    protocol["budgets"]["claim-support"]["false_nudge_max"] = json!(0.5);
    freeze_with_protocol(&mut input, &protocol);
    let result: Value = serde_json::from_slice(
        &fit_with_protocol(&serde_json::to_vec(&input).unwrap(), &protocol).unwrap(),
    )
    .unwrap();
    assert_eq!(result["groups"][0]["selected_candidate_id"], "candidate-a");
    assert_eq!(result["groups"][0]["candidates"][0]["missed_correct"], 0);
    assert_eq!(result["groups"][0]["candidates"][0]["false_proposed"], 1);
    assert_eq!(result["groups"][0]["candidates"][1]["missed_correct"], 1);
    input["executions"].as_array_mut().unwrap().remove(1);
    input["request_manifest"]["cases"]
        .as_array_mut()
        .unwrap()
        .remove(1);
    freeze_with_protocol(&mut input, &protocol);
    let result: Value = serde_json::from_slice(
        &fit_with_protocol(&serde_json::to_vec(&input).unwrap(), &protocol).unwrap(),
    )
    .unwrap();
    assert_eq!(result["groups"][0]["selected_candidate_id"], "candidate-z");
}

#[test]
fn goal_choice_ignores_confidence_and_provider_failures_count_responses() {
    let mut input = fixture("goal-drift");
    input["executions"][0]["response"]["outcome"]["Ok"]["probabilities"] =
        json!({"drift": 0.01, "aligned": 0.99});
    input["executions"][0]["response"]["outcome"]["Ok"]["confidence"] = json!(0.01);
    assert_eq!(
        candidate(&fit(&input))["results"][0]["result"]["outcome"],
        "nudge"
    );
    let mut input = fixture("expertise");
    input["executions"][0]["response"]["outcome"] = json!({"Err": "timeout"});
    input["executions"][1]["response"]["outcome"] = json!({"Err": "transport"});
    let result = fit(&input);
    assert_eq!(candidate(&result)["provider_failures"], 2);
    assert_eq!(candidate(&result)["planned"], 1);
    assert_eq!(candidate(&result)["missed_correct"], 1);
    assert_eq!(candidate(&result)["evaluable"], 0);
}

#[test]
fn paired_expertise_unknown_target_abstains_and_different_context_rejects() {
    let mut input = fixture("expertise");
    for index in 0..2 {
        let mut request: EvaluationRequest =
            serde_json::from_value(input["executions"][index]["request"].clone()).unwrap();
        if let ContextValue::Present { observations } = request
            .packet
            .context
            .get_mut(&ContextSlot::Candidates)
            .unwrap()
        {
            observations[0].text = "candidate-2: Different candidate label.".into();
        }
        refresh_packet(&mut request.packet);
        input["executions"][index]["request"] = json!(request);
        input["executions"][index]["response"]["packet_hash"] = json!(request.packet.hash);
    }
    assert_eq!(
        candidate(&fit(&input))["results"][0]["result"]["reason"],
        "unknown_reference"
    );
    let other = fixture("expertise");
    input["executions"][1] = other["executions"][1].clone();
    assert!(fit_saved_json(&serde_json::to_vec(&input).unwrap()).is_err());
}

#[test]
fn output_overflow_is_refused_instead_of_truncating_decisions() {
    let mut result: blabla::expert::calibration::FitSavedResult =
        serde_json::from_value(fit(&fixture("claim-support"))).unwrap();
    let case = &mut result.groups[0].candidates[0].results[0];
    case.result.message = Some("x".repeat(2048));
    let case = case.clone();
    result.groups[0].candidates[0].results.resize(256, case);
    let candidate = result.groups[0].candidates[0].clone();
    result.groups[0].candidates.resize(16, candidate);
    assert_eq!(encode_fit_result(&result), Err(TraceError::LimitExceeded));
}

fn preflight_fixture(
    input: &Value,
) -> (
    blabla::expert::calibration::PreflightDevelopmentRequest,
    Vec<Vec<u8>>,
) {
    let mut input = input.clone();
    let requests = input["executions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|execution| {
            format!(
                "{}\n",
                serde_json::to_string(&execution["request"]).unwrap()
            )
        })
        .collect::<String>()
        .into_bytes();
    input["request_manifest"]["requests_jsonl"]["sha256"] = json!(sha256(&requests));
    freeze(&mut input);
    let mut config = serde_json::to_value(blabla::expert::trace::RuntimeConfig::default()).unwrap();
    config["provider"] =
        json!({"identity": input["plan"]["provider"], "argv": ["never-execute-provider"]});
    let config_bytes = serde_json::to_vec_pretty(&config).unwrap();
    let mut raw = vec![
        serde_json::to_vec(&protocol()).unwrap(),
        serde_json::to_vec(&input["plan"]).unwrap(),
        serde_json::to_vec(&input["request_manifest"]).unwrap(),
        config_bytes,
        requests,
    ];
    let mut wire = json!({"kind": "preflight_development_calibration", "schema_version": 1,
        "protocol_evidence": input["protocol_evidence"], "plan_evidence": input["plan_evidence"],
        "manifest_evidence": input["manifest_evidence"], "runtime_config_evidence": evidence_ref("runtime")});
    for (i, field) in [
        "protocol_evidence",
        "plan_evidence",
        "manifest_evidence",
        "runtime_config_evidence",
    ]
    .into_iter()
    .enumerate()
    {
        wire[field]["sha256"] = json!(sha256(&raw[i]));
    }
    (
        serde_json::from_value(wire).unwrap(),
        std::mem::take(&mut raw),
    )
}

fn preflight(
    input: &Value,
) -> Result<blabla::expert::calibration::PreflightDevelopmentCalibration, TraceError> {
    let (wire, bytes) = preflight_fixture(input);
    blabla::expert::calibration::preflight_development_calibration(
        blabla::expert::calibration::preflight_development_inputs(
            &wire, &bytes[0], &bytes[1], &bytes[2], &bytes[3],
        )?,
        &bytes[4],
    )
}

#[test]
fn response_free_preflight_reuses_all_family_candidates_and_preserves_order_and_hash_kinds() {
    for family in [
        "goal-drift",
        "expertise",
        "claim-support",
        "failed-approach",
    ] {
        let mut input = fixture(family);
        input["executions"].as_array_mut().unwrap().reverse();
        let preflight = preflight(&input).unwrap();
        assert_eq!(
            preflight.requests.len(),
            input["executions"].as_array().unwrap().len()
        );
        assert_eq!(
            preflight.result.request_ids,
            preflight
                .requests
                .iter()
                .map(|request| request.request_id.clone())
                .collect::<Vec<_>>()
        );
        assert_eq!(preflight.result.provider_calls, 0);
        assert_eq!(preflight.result.delivery_attempts, 0);
        assert_eq!(preflight.result.referenced_files.len(), 5);
        assert_eq!(
            preflight.result.provider_argv_sha256,
            canonical_sha256(&json!(["never-execute-provider"])).unwrap()
        );
        let (wire, mut bytes) = preflight_fixture(&input);
        let config: Value = serde_json::from_slice(&bytes[3]).unwrap();
        assert_eq!(
            preflight.result.runtime_config_sha256,
            canonical_sha256(&config).unwrap()
        );
        assert_ne!(
            preflight.result.runtime_config_sha256,
            wire.runtime_config_evidence.sha256
        );
        bytes[3].push(b'\n');
        assert!(
            blabla::expert::calibration::preflight_development_inputs(
                &wire, &bytes[0], &bytes[1], &bytes[2], &bytes[3]
            )
            .is_err()
        );
    }
}

#[test]
fn response_free_preflight_rejects_incompatible_candidates_and_keeps_saved_execution_requirement() {
    for pointer in [
        "/plan/groups/0/candidates/0/primary/calibration/question_fingerprint",
        "/plan/groups/0/candidates/0/primary/calibration/template_fingerprint",
        "/executions/0/request/question_fingerprint",
    ] {
        let mut input = fixture("claim-support");
        *input.pointer_mut(pointer).unwrap() = json!("wrong-fingerprint");
        assert!(preflight(&input).is_err(), "{pointer}");
    }
    let mut input = fixture("claim-support");
    input["plan"]["groups"][0]["candidates"][0]["primary"]["rules"][0]["predicate"] =
        json!({"kind": "noul_value", "value": true});
    assert!(preflight(&input).is_err());
    let mut input = fixture("goal-drift");
    input["executions"] = json!([]);
    assert!(fit_saved_json(&serde_json::to_vec(&input).unwrap()).is_err());
}

#[test]
fn response_free_preflight_rejects_gold_not_resolvable_in_primary_packet() {
    for family in [
        "goal-drift",
        "expertise",
        "claim-support",
        "failed-approach",
    ] {
        let mut input = fixture(family);
        assert!(preflight(&input).is_ok());
        input["request_manifest"]["cases"][0]["gold"]["acceptable_reference_sets"] =
            json!([["task::work"]]);
        assert!(preflight(&input).is_err(), "{family}");
    }
}

#[test]
fn response_free_preflight_accepts_task_gold_only_with_local_task_context() {
    let mut input = fixture("goal-drift");
    let mut request: EvaluationRequest =
        serde_json::from_value(input["executions"][0]["request"].clone()).unwrap();
    request.judgment.optional.push(ContextSlot::Task);
    request.question_fingerprint = question_fingerprint(&request.judgment);
    request.template_fingerprint = template_fingerprint(&request.judgment);
    request.packet.context.insert(
        ContextSlot::Task,
        ContextValue::Present {
            observations: vec![Observation {
                id: "task::work".into(),
                slot: ContextSlot::Task,
                kind: SourceKind::DeterministicOutput,
                capture: "local:task-record".into(),
                observed_revision: request.packet.revision.fingerprint(),
                text: "Accepted bounded work.".into(),
                fact: Some(ObservedFact::TaskState {
                    task: "task::work".into(),
                    state: "accepted".into(),
                }),
            }],
        },
    );
    refresh_packet(&mut request.packet);
    input["executions"][0]["request"] = json!(request);
    let settings = &mut input["plan"]["groups"][0]["candidates"][0]["primary"];
    settings["calibration"]["question_fingerprint"] = json!(request.question_fingerprint);
    settings["calibration"]["template_fingerprint"] = json!(request.template_fingerprint);
    settings["calibration"]["policy_fingerprint"] = json!(policy_fingerprint(
        &serde_json::from_value(settings.clone()).unwrap()
    ));
    input["request_manifest"]["cases"][0]["gold"]["acceptable_reference_sets"] =
        json!([["task::work"]]);
    assert!(preflight(&input).is_ok());
    request
        .packet
        .context
        .insert(ContextSlot::Task, ContextValue::Missing);
    refresh_packet(&mut request.packet);
    input["executions"][0]["request"] = json!(request);
    assert!(preflight(&input).is_err());
}
