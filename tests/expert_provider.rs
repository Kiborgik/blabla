use blabla::expert::provider::*;
use blabla::expert::{ExpertLimits, ExpertMode};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

fn request(kind: &str) -> EvaluationRequest {
    let output = match kind {
        "choice" => json!({"kind":"choice","alternatives":["aligned","drift","unclear"]}),
        "noul" => json!({"kind":"noul","proposition":"The claim is supported."}),
        _ => json!({"kind":"score","levels":["justified","unclear","repeating"]}),
    };
    serde_json::from_value(json!({
        "request_id":format!("request-{kind}"),"question_fingerprint":format!("question-{kind}"),
        "template_fingerprint":"template", "judgment":{
            "name":kind,"pack":"test","purpose":"provider test","question":"Literal question?",
            "criteria":"Literal criteria.","requires":["claim"],"optional":[],"output":output,
            "templates":["ask_owner"]},
        "packet":{"event":{"event_id":"event","run_id":"run","task":"task::test",
            "checkpoint_id":"checkpoint","sequence":1,"previous_sequence":null,"unix_ms":1,
            "kind":"claim","host":{"host":"test","version":"1","adapter":"test",
            "checkpoints":["claim"],"pauses_worker":false,"same_task_delivery":false,
            "delivery_receipts":false,"pre_tool_control":false,"gaps":[]}},
            "binding_id":format!("binding::{kind}"),"revision":{"acceptance_epoch":1,"task_digest":"task",
            "paths":{},"identities":{}}, "context":{"claim":{"kind":"present","observations":[{
            "id":"claim-1","slot":"claim","kind":"worker_statement","capture":"test",
            "observed_revision":"revision","text":"Literal synthetic claim","fact":null}]}},
            "references":{},"history":[],"accounting":{"selected_bytes":23,"omitted_bytes":0,
            "estimated_tokens":6,"provider_tokens":null},"hash":"packet"}
    })).unwrap()
}

fn identity(probabilities: bool) -> ProviderIdentity {
    ProviderIdentity {
        provider: "fixture".into(),
        model: "fixture-model".into(),
        checkpoint: "fixture-checkpoint".into(),
        supported_outputs: vec![OutputKind::Choice, OutputKind::Noul, OutputKind::Score],
        probabilities,
        certification: Some("local-fixture-only".into()),
    }
}

fn response(req: &EvaluationRequest, answer: TypedAnswer) -> EvaluationResponse {
    EvaluationResponse {
        request_id: req.request_id.clone(),
        packet_hash: req.packet.hash.clone(),
        question_fingerprint: req.question_fingerprint.clone(),
        template_fingerprint: req.template_fingerprint.clone(),
        provider: identity(true),
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
        outcome: Ok(answer),
    }
}

fn choice() -> TypedAnswer {
    TypedAnswer::Choice {
        pick: "aligned".into(),
        probabilities: Some(BTreeMap::from([
            ("aligned".into(), 0.3333),
            ("drift".into(), 0.3333),
            ("unclear".into(), 0.3333),
        ])),
        confidence: Some(0.0),
    }
}

fn command(mode: &str, extras: &[String], limits: ExpertLimits) -> CommandProvider {
    let mut argv = vec![
        if cfg!(windows) { "python" } else { "python3" }.into(),
        format!(
            "{}/tests/fixtures/expert/provider.py",
            env!("CARGO_MANIFEST_DIR")
        ),
        mode.into(),
    ];
    argv.extend_from_slice(extras);
    CommandProvider::new(argv, identity(true), limits).unwrap()
}

fn evaluate(provider: &mut CommandProvider, req: &EvaluationRequest) -> EvaluationResponse {
    provider.evaluate(
        req,
        Instant::now() + Duration::from_secs(2),
        &AtomicBool::new(false),
    )
}

#[test]
fn choice_keys_must_match_exactly() {
    let req = request("choice");
    assert!(validate_response(&req, response(&req, choice())).is_ok());
    for key in ["missing", "extra"] {
        let mut answer = choice();
        if let TypedAnswer::Choice {
            probabilities: Some(values),
            ..
        } = &mut answer
        {
            if key == "missing" {
                values.remove("unclear");
            } else {
                values.insert("forged".into(), 0.0);
            }
        }
        assert_eq!(
            validate_response(&req, response(&req, answer)).unwrap_err(),
            ProviderFailure::Malformed
        );
    }
}

#[test]
fn probabilities_are_finite_complete_and_normalized() {
    let req = request("choice");
    for bad in [f64::NAN, f64::INFINITY, -0.1, 1.1, 0.7] {
        let mut answer = choice();
        if let TypedAnswer::Choice {
            probabilities: Some(values),
            ..
        } = &mut answer
        {
            values.insert("aligned".into(), bad);
        }
        assert_eq!(
            validate_response(&req, response(&req, answer)).unwrap_err(),
            ProviderFailure::Malformed
        );
    }
    for value in [f64::NAN, f64::INFINITY, -0.01, 1.01] {
        let mut answer = choice();
        if let TypedAnswer::Choice { confidence, .. } = &mut answer {
            *confidence = Some(value);
        }
        assert!(validate_response(&req, response(&req, answer)).is_err());
    }
    let req = request("noul");
    let answer = TypedAnswer::Noul {
        value: None,
        probability: Some(0.5000),
        confidence: None,
    };
    let result = validate_response(&req, response(&req, answer)).unwrap();
    assert!(matches!(
        result.outcome,
        Ok(TypedAnswer::Noul {
            value: None,
            probability: Some(0.5),
            ..
        })
    ));
    assert!(
        validate_response(
            &req,
            response(
                &req,
                TypedAnswer::Noul {
                    value: None,
                    probability: None,
                    confidence: None
                }
            )
        )
        .is_err()
    );
}

#[test]
fn score_expectation_matches_distribution() {
    let req = request("score");
    let answer = TypedAnswer::Score {
        level: None,
        distribution: Some(vec![0.2684, 0.2327, 0.4989]),
        expectation: Some(1.2305),
        confidence: Some(0.0),
    };
    assert!(validate_response(&req, response(&req, answer.clone())).is_ok());
    for expectation in [0.0, 3.0, f64::NAN] {
        let mut invalid = answer.clone();
        if let TypedAnswer::Score {
            expectation: expected,
            ..
        } = &mut invalid
        {
            *expected = Some(expectation);
        }
        assert!(validate_response(&req, response(&req, invalid)).is_err());
    }
    for distribution in [vec![0.5, 0.5], vec![0.1, 0.1, 0.1]] {
        let invalid = TypedAnswer::Score {
            level: None,
            distribution: Some(distribution),
            expectation: None,
            confidence: None,
        };
        assert!(validate_response(&req, response(&req, invalid)).is_err());
    }
}

#[test]
fn luna_self_report_is_not_probability() {
    let req = request("noul");
    let mut result = response(
        &req,
        TypedAnswer::Noul {
            value: Some(true),
            probability: None,
            confidence: None,
        },
    );
    result.provider = identity(false);
    result.self_report = Some("I am 95 percent confident".into());
    assert!(validate_response(&req, result.clone()).is_ok());
    if let Ok(TypedAnswer::Noul { probability, .. }) = &mut result.outcome {
        *probability = Some(0.95);
    }
    assert_eq!(
        validate_response(&req, result).unwrap_err(),
        ProviderFailure::Malformed
    );
}

#[test]
fn unknown_answer_and_request_identity_are_failures() {
    let req = request("choice");
    for field in [
        "request_id",
        "packet_hash",
        "question_fingerprint",
        "template_fingerprint",
    ] {
        let mut value = serde_json::to_value(response(&req, choice())).unwrap();
        value[field] = json!("forged");
        assert_eq!(
            validate_response(&req, serde_json::from_value(value).unwrap()).unwrap_err(),
            ProviderFailure::IdentityMismatch
        );
    }
    let mut value = serde_json::to_value(response(&req, choice())).unwrap();
    value["outcome"]["Ok"]["forged"] = json!("instruction");
    assert!(serde_json::from_value::<EvaluationResponse>(value).is_err());
    let wrong = TypedAnswer::Noul {
        value: Some(true),
        probability: None,
        confidence: None,
    };
    assert_eq!(
        validate_response(&req, response(&req, wrong)).unwrap_err(),
        ProviderFailure::Malformed
    );
    for mode in [
        "malformed",
        "extra",
        "duplicate",
        "overflow",
        "wrong-identity",
    ] {
        let result = evaluate(&mut command(mode, &[], ExpertLimits::default()), &req);
        assert!(
            matches!(
                result.outcome,
                Err(ProviderFailure::Malformed | ProviderFailure::IdentityMismatch)
            ),
            "{mode}: {result:?}"
        );
    }
}

#[test]
fn timeout_kills_descendants() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("late-child");
    let pid = dir.path().join("child.pid");
    let mut provider = command(
        "descendant",
        &[marker.display().to_string(), pid.display().to_string()],
        ExpertLimits::default(),
    );
    let result = provider.evaluate(
        &request("choice"),
        Instant::now() + Duration::from_millis(150),
        &AtomicBool::new(false),
    );
    assert_eq!(result.outcome.unwrap_err(), ProviderFailure::Timeout);
    std::thread::sleep(Duration::from_millis(600));
    assert!(!marker.exists(), "descendant survived timeout");
    assert!(pid.exists(), "fixture never spawned descendant");
    #[cfg(unix)]
    {
        let pid: i32 = std::fs::read_to_string(pid).unwrap().parse().unwrap();
        assert_ne!(
            unsafe { libc::kill(pid, 0) },
            0,
            "descendant PID survived cleanup"
        );
    }
}

#[test]
fn cancelled_or_superseded_request_cannot_complete() {
    let cancelled = AtomicBool::new(true);
    let mut provider = command("good", &[], ExpertLimits::default());
    assert_eq!(
        provider
            .evaluate(
                &request("choice"),
                Instant::now() + Duration::from_secs(1),
                &cancelled
            )
            .outcome
            .unwrap_err(),
        ProviderFailure::Cancelled
    );
    std::thread::scope(|scope| {
        cancelled.store(false, Ordering::Release);
        scope.spawn(|| {
            std::thread::sleep(Duration::from_millis(80));
            cancelled.store(true, Ordering::Release);
        });
        let started = Instant::now();
        let result = command("slow", &[], ExpertLimits::default()).evaluate(
            &request("choice"),
            Instant::now() + Duration::from_secs(1),
            &cancelled,
        );
        assert_eq!(result.outcome.unwrap_err(), ProviderFailure::Cancelled);
        assert!(started.elapsed() < Duration::from_millis(500));
    });
}

#[test]
fn retry_retains_request_identity() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("requests.jsonl");
    let limits = ExpertLimits {
        retries: 1,
        ..ExpertLimits::default()
    };
    let result = evaluate(
        &mut command("retry", &[log.display().to_string()], limits),
        &request("choice"),
    );
    assert!(result.outcome.is_ok(), "{result:?}");
    let values: Vec<Value> = std::fs::read_to_string(&log)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(values.len(), 2);
    assert_eq!(values[0], values[1]);
    let limits = ExpertLimits {
        retries: 1,
        ..ExpertLimits::default()
    };
    let result = command("retry-slow", &[log.display().to_string()], limits).evaluate(
        &request("choice"),
        Instant::now() + Duration::from_millis(150),
        &AtomicBool::new(false),
    );
    assert_eq!(result.outcome.unwrap_err(), ProviderFailure::Timeout);
}

#[test]
fn stdout_and_stderr_are_bounded() {
    for mode in ["stdout-flood", "stderr-flood", "unterminated", "two-lines"] {
        let started = Instant::now();
        let result = evaluate(
            &mut command(mode, &[], ExpertLimits::default()),
            &request("choice"),
        );
        assert_eq!(
            result.outcome.unwrap_err(),
            ProviderFailure::Malformed,
            "{mode}"
        );
        assert!(
            result.diagnostic.unwrap_or_default().len() <= ExpertLimits::default().excerpt_bytes
        );
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}

#[test]
fn unverified_provider_cannot_enable_advisory() {
    let mut provider = identity(false);
    provider.certification = None;
    assert_eq!(
        provider.require_mode(ExpertMode::Advisory),
        Err(ProviderFailure::Unverified)
    );
    assert!(provider.require_mode(ExpertMode::Shadow).is_ok());
    provider.certification = Some("".into());
    assert!(provider.require_mode(ExpertMode::Advisory).is_err());
    provider.certification = Some("fixture-evidence".into());
    assert!(provider.require_mode(ExpertMode::Advisory).is_ok());
}

#[test]
fn compatible_questions_batch_without_answer_dependencies() {
    let batch = EvaluationBatchRequest {
        batch_id: "batch".into(),
        requests: vec![request("choice"), request("noul"), request("score")],
    };
    assert!(validate_batch(&batch).is_ok());
    let result = command("good", &[], ExpertLimits::default()).evaluate_batch(
        &batch,
        Instant::now() + Duration::from_secs(2),
        &AtomicBool::new(false),
    );
    assert_eq!(result.batch_id, batch.batch_id);
    assert_eq!(result.responses.len(), 3);
    assert!(
        result.responses.iter().all(|r| r.outcome.is_ok()),
        "{result:?}"
    );
    let mut fake = FakeProvider::new(
        identity(true),
        vec![
            Ok(choice()),
            Ok(TypedAnswer::Noul {
                value: None,
                probability: Some(0.7),
                confidence: None,
            }),
            Ok(TypedAnswer::Score {
                level: None,
                distribution: Some(vec![0.2, 0.3, 0.5]),
                expectation: Some(1.3),
                confidence: None,
            }),
        ],
    );
    let result = fake.evaluate_batch(
        &batch,
        Instant::now() + Duration::from_secs(1),
        &AtomicBool::new(false),
    );
    assert!(result.responses.iter().all(|r| r.outcome.is_ok()));
}

#[test]
fn incompatible_context_is_not_batched() {
    let mut batch = EvaluationBatchRequest {
        batch_id: "batch".into(),
        requests: vec![request("choice"), request("noul")],
    };
    batch.requests[1]
        .packet
        .references
        .insert("forged".into(), "unselected context".into());
    assert_eq!(validate_batch(&batch), Err(ProviderFailure::Malformed));
    let result = command("good", &[], ExpertLimits::default()).evaluate_batch(
        &batch,
        Instant::now() + Duration::from_secs(1),
        &AtomicBool::new(false),
    );
    assert!(
        result
            .responses
            .iter()
            .all(|r| r.outcome == Err(ProviderFailure::Malformed))
    );
}

#[test]
fn batch_partial_failure_preserves_other_answers() {
    let batch = EvaluationBatchRequest {
        batch_id: "batch".into(),
        requests: vec![request("choice"), request("noul")],
    };
    let result = command("partial", &[], ExpertLimits::default()).evaluate_batch(
        &batch,
        Instant::now() + Duration::from_secs(2),
        &AtomicBool::new(false),
    );
    assert!(result.responses[0].outcome.is_ok());
    assert_eq!(
        result.responses[1].outcome,
        Err(ProviderFailure::Unsupported)
    );
}

struct DefaultProvider {
    calls: usize,
    delay: Duration,
}
impl ExpertProvider for DefaultProvider {
    fn evaluate(
        &mut self,
        req: &EvaluationRequest,
        _deadline: Instant,
        _cancelled: &AtomicBool,
    ) -> EvaluationResponse {
        self.calls += 1;
        std::thread::sleep(self.delay);
        response(
            req,
            if matches!(
                req.judgment.output,
                blabla::memory::knowledge::JudgmentOutput::Choice { .. }
            ) {
                choice()
            } else {
                TypedAnswer::Noul {
                    value: Some(true),
                    probability: None,
                    confidence: None,
                }
            },
        )
    }
}

#[test]
fn default_batch_rejects_incompatible_context_before_evaluation() {
    let mut batch = EvaluationBatchRequest {
        batch_id: "batch".into(),
        requests: vec![request("choice"), request("noul")],
    };
    batch.requests[1]
        .packet
        .references
        .insert("unselected".into(), "different".into());
    let mut provider = DefaultProvider {
        calls: 0,
        delay: Duration::ZERO,
    };
    let result = provider.evaluate_batch(
        &batch,
        Instant::now() + Duration::from_secs(1),
        &AtomicBool::new(false),
    );
    assert_eq!(provider.calls, 0);
    assert!(
        result
            .responses
            .iter()
            .all(|r| r.outcome == Err(ProviderFailure::Malformed))
    );
}

#[test]
fn default_batch_rejects_late_provider_answers_under_original_deadline() {
    let batch = EvaluationBatchRequest {
        batch_id: "batch".into(),
        requests: vec![request("choice"), request("noul")],
    };
    let mut provider = DefaultProvider {
        calls: 0,
        delay: Duration::from_millis(50),
    };
    let result = provider.evaluate_batch(
        &batch,
        Instant::now() + Duration::from_millis(20),
        &AtomicBool::new(false),
    );
    assert!(
        result
            .responses
            .iter()
            .all(|r| r.outcome == Err(ProviderFailure::Timeout))
    );
    assert_eq!(provider.calls, 1);
}

#[test]
fn malformed_answer_is_never_retried() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("requests.jsonl");
    let limits = ExpertLimits {
        retries: 1,
        ..ExpertLimits::default()
    };
    let result = evaluate(
        &mut command("malformed-retry", &[log.display().to_string()], limits),
        &request("choice"),
    );
    assert_eq!(result.outcome.unwrap_err(), ProviderFailure::Malformed);
    assert_eq!(std::fs::read_to_string(log).unwrap().lines().count(), 1);
}

#[test]
fn command_elapsed_timing_is_local_and_provider_statistic_is_separate() {
    let result = evaluate(
        &mut command("good", &[], ExpertLimits::default()),
        &request("choice"),
    );
    assert!(result.outcome.is_ok());
    assert!(
        result.timing.total_ms > 1,
        "fixture timing was trusted as local elapsed time"
    );
    assert!(result.usage.reported_latency_ms.is_none());
}

#[test]
fn advisory_requires_well_formed_identity_and_failure_diagnostics_are_bounded() {
    let mut invalid = identity(true);
    invalid.model.clear();
    assert_eq!(
        invalid.require_mode(ExpertMode::Advisory),
        Err(ProviderFailure::Unverified)
    );
    let failure = failure_response(
        &request("choice"),
        &identity(true),
        ProviderFailure::Transport,
        Some("password=fixture-secret-credential ".repeat(200)),
    );
    assert!(failure.diagnostic.as_ref().unwrap().len() <= 2048);
    assert!(
        !failure
            .diagnostic
            .unwrap()
            .contains("fixture-secret-credential")
    );
}
