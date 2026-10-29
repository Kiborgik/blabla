use super::*;
use blabla::project::task::claims;

pub(super) fn run(project: &Project, action: TaskAction, json: bool) -> i32 {
    match action {
        TaskAction::Accept {
            name,
            model,
            reuse_evidence: true,
            reason,
        } => evidence_reuse::accept(
            project,
            &name,
            &model,
            reason.as_deref().unwrap_or(""),
            json,
        ),
        TaskAction::Accept { name, model, .. } => accept(project, &name, &model, json),
        TaskAction::Block { name, reason } => block(project, &name, &reason, json),
        TaskAction::Ready {
            name,
            outcome,
            lens,
            note,
            claim,
        } => ready_with(
            project,
            &name,
            HandBack {
                outcome,
                lenses: lens,
                notes: note,
                claims: claim,
            },
            json,
        ),
        _ => unreachable!("only hand-back lifecycle commands are dispatched here"),
    }
}

pub(super) fn accept(project: &Project, name: &str, model: &str, json: bool) -> i32 {
    let task = exit_on_err!(mutate(project, name, json));
    let mut task = exit_on_err!(prepare_acceptance(project, task, model, json));
    exit_on_err!(stamp(&mut task, json));
    write_record(project, &mut task, json, false, &[], true)
}

pub(super) fn prepare_acceptance(
    project: &Project,
    mut task: Task,
    model: &str,
    json: bool,
) -> Result<Task, i32> {
    let name = task.name.clone();
    if machine::fire(&mut task, Command::Accept, &Facts::record_only()).is_err() {
        let reason = match task::unanswered_decision(&task) {
            Some(decision) => format!(
                "task {name:?} is BLOCKED on decision {}: {} (options {}; picked {} at {}%). Only the orchestrator's answer settles it, so it cannot be resumed yet. {}",
                decision.id,
                decision.question,
                decision.options.join(", "),
                decision.pick,
                decision.confidence,
                answer_route(&task, decision)
            ),
            None => format!(
                "task {name:?} state {state:?} → \"accepted\" is not allowed",
                state = task.state.word()
            ),
        };
        return Err(refuse(reason, json));
    }
    let current_tree = view_tree(project);
    if let Some(target) = task.review_of.as_ref().map(|target| target.task.clone()) {
        let reviewed =
            review_target(project, &name, &target).map_err(|message| refuse(message, json))?;
        let revision = task::review_revision(
            &task,
            &reviewed,
            &current_tree,
            review_dependencies(project, &task, &reviewed),
        );
        task.review_of = Some(task::ReviewTarget {
            task: target,
            revision,
        });
    }
    task::record_acceptance(&mut task, &current_tree, &project.ignore, model, now_unix());
    Ok(task)
}

pub(super) fn block(project: &Project, name: &str, reason: &str, json: bool) -> i32 {
    let mut task = exit_on_err!(mutate(project, name, json));
    if machine::fire(&mut task, Command::Block, &Facts::record_only()).is_err() {
        return refuse(
            format!(
                "task {name:?} state {state:?} → \"blocked\" is not allowed",
                state = task.state.word()
            ),
            json,
        );
    }
    task.findings.push(Finding {
        id: task.next_finding_id(),
        statement: reason.to_owned(),
        addressed: None,
        resolution: None,
        residual: false,
    });
    store(project, &mut task, json)
}

#[derive(Default)]
pub(super) struct HandBack {
    pub(super) outcome: Option<String>,
    pub(super) lenses: Vec<String>,
    pub(super) notes: Vec<String>,
    pub(super) claims: Vec<String>,
}

pub(super) fn system_memory_systems(project: &Project) -> Vec<blabla::memory::system::System> {
    let Some(entry) = &project.manifest.system else {
        return Vec::new();
    };
    read_entry(entry, system::build, system::validate)
        .present()
        .map(|memory| memory.systems.clone())
        .unwrap_or_default()
}

fn stage_handback(
    project: &Project,
    task: &Task,
    request: &HandBack,
) -> Result<(Task, usize), String> {
    let mut staged = task.clone();
    if task.state != TaskState::Accepted {
        return Ok((staged, 0));
    }
    if let Some(word) = &request.outcome {
        let outcome = claims::Outcome::from_word(word).ok_or_else(|| {
            format!(
                "outcome {word:?} is not one BlaBla records: {}",
                claims::Outcome::words()
            )
        })?;
        if outcome.leaves_residual() {
            let residual = claims::residual_finding(&staged, outcome);
            staged.findings.push(residual);
        }
        staged.outcome = Some(outcome);
    }
    let given = request
        .claims
        .iter()
        .map(|text| claims::IntentClaim::parse(text))
        .collect::<Result<Vec<_>, _>>()?;
    let affected = claims::affected_intents(task, &system_memory_systems(project));
    if task.asks_intent {
        if let Some(mismatch) = claims::claim_mismatch(&affected, &given) {
            return Err(mismatch);
        }
    } else if !given.is_empty() {
        return Err(
            "this task was not opened with --intent, so it asks no intent claims; drop --claim"
                .to_owned(),
        );
    }
    staged.intent_claims = given;
    let knowledge = knowledge_fingerprints(project);
    for pair in request.lenses.chunks(2) {
        let [pack, text] = pair else {
            return Err("--lens takes a pack and an assessment".to_owned());
        };
        lenses::assess(project, &mut staged, pack, text, None, &knowledge)?;
    }
    for text in &request.notes {
        findings::record_note(&mut staged, text);
    }
    Ok((staged, affected.len()))
}

pub(super) fn ready_with(project: &Project, name: &str, request: HandBack, json: bool) -> i32 {
    let task = exit_on_err!(mutate(project, name, json));
    exit_on_err!(require_tracking(project, &task, json));
    let (mut staged, intents) = refuse_on_err!(stage_handback(project, &task, &request), json);
    let tree = view_tree(project);
    let report = assignment_report_at(project, &staged, &tree);
    let standing = skeptic::standing(&report.assignment_blockers, &[]).len();
    let refused = |held: &Task, cause: Option<machine::Refusal>| {
        let message = match cause {
            Some(machine::Refusal::Guard(guard)) => format!(
                "task {name:?} cannot be handed back from {state:?}: the {code} guard refused it, {words}; {guidance}",
                state = held.state.word(),
                code = guard.code(),
                words = guard_words(guard),
                guidance = handback_guidance(held, guard.code())
            ),
            _ => {
                let recovery = handback_recovery(
                    held,
                    &tree,
                    &report,
                    ready_assignment_clear(project, held, &tree, &report.assignment_blockers),
                );
                format!(
                    "task {name:?} cannot be handed back from {state:?}: {guidance}",
                    state = held.state.word(),
                    guidance = recovery.guidance
                )
            }
        };
        refuse(message, json)
    };
    let handback = task::HandbackRequest {
        standing,
        intents: Some(intents),
        challenged_at: Some(now_unix()),
    };
    match task::hand_back(&mut staged, &tree, handback) {
        Ok(()) => store(project, &mut staged, json),
        Err(cause) => refused(&task, Some(cause)),
    }
}

pub(super) fn guard_words(guard: machine::Guard) -> &'static str {
    match guard {
        machine::Guard::DecisionAnswered => "a decision below the floor has no answer",
        machine::Guard::AssignmentAccepted => "the assignment is not accepted",
        machine::Guard::QuestionsPicked => "an orchestrator question has no pick",
        machine::Guard::CheckDeclared => "no check is declared",
        machine::Guard::EvidenceSupported => {
            "no current successful evidence for the declared check"
        }
        machine::Guard::ChallengeCurrent => "there is no current challenge receipt",
        machine::Guard::ChallengeClear => "an assignment blocker still stands",
        machine::Guard::OutcomeClaimed => "the outcome claim does not match the task's goal",
        machine::Guard::IntentClaimed => "the intent claims do not match the affected intents",
    }
}

#[derive(Serialize)]
pub(super) struct HandbackRecovery {
    pub(super) action: &'static str,
    pub(super) blocker: Option<&'static str>,
    pub(super) guidance: String,
    pub(super) authority: &'static str,
}

pub(super) fn ready_assignment_clear(
    project: &Project,
    task: &Task,
    tree: &BTreeMap<String, String>,
    blockers: &[&str],
) -> bool {
    task.state == TaskState::Ready
        && blockers.is_empty()
        && task::tracked_readiness(task, &project.manifest.root, &project.ignore, tree).supported
        && task::challenge_current(task, tree)
}

pub(super) fn handback_recovery(
    task: &Task,
    tree: &BTreeMap<String, String>,
    report: &ChallengeReport,
    clear: bool,
) -> HandbackRecovery {
    let name = &task.name;
    let blocker = report
        .challenge
        .as_ref()
        .filter(|challenge| report.assignment_blockers.contains(&challenge.class.word()));
    let (action, guidance) = if clear {
        let (action, next) = if task.state == TaskState::Accepted {
            (
                "hand-back",
                format!("hand back now with blabla task ready {name}; "),
            )
        } else {
            (
                "await-review",
                "review and result acceptance belong to the orchestrator; ".to_owned(),
            )
        };
        (
            action,
            format!(
                "current assignment evidence and challenge support hand-back; {next}project-wide verification remains the orchestrator's"
            ),
        )
    } else if task.state == TaskState::Ready {
        let inspect = format!(
            "READY records an earlier hand-back, not current clearance. Inspect blabla task freshness {name}."
        );
        match blocker {
            Some(challenge) => {
                let (action, route) = match challenge.class {
                    skeptic::Class::EvidenceSuperseded
                    | skeptic::Class::ReadinessWithoutEvidence
                    | skeptic::Class::DeclaredCheckFailed => (
                        "resume-and-verify",
                        format!(
                            "Resume with blabla task accept {name} --model <id> before recording a new declared-check result."
                        ),
                    ),
                    skeptic::Class::ReviewTargetStale => (
                        "inspect-review-target",
                        format!(
                            "If the original successful argv execution and its complete recursive input coverage are unchanged, inspect the guarded alternative blabla task accept {name} --model <id> --reuse-evidence --reason <reason>. Eligibility is checked by that command; reuse never renews manual review claims."
                        ),
                    ),
                    _ => ("resolve-assignment-blocker", String::new()),
                };
                (action, format!("{inspect} {route} {}", challenge.reconcile))
            }
            None => (
                "resume-task",
                format!(
                    "{inspect} The recorded challenge no longer supports hand-back. Resume with blabla task accept {name} --model <id>, reconcile the assignment and record current evidence and assessments before challenging again."
                ),
            ),
        }
    } else {
        let next = task::handback(task, tree)
            .err()
            .unwrap_or("resolve-challenge");
        (next, handback_guidance(task, next))
    };
    HandbackRecovery {
        action,
        blocker: blocker.map(|challenge| challenge.class.word()),
        guidance,
        authority: "diagnostic-only",
    }
}

pub(super) fn handback_guidance(task: &Task, next: &str) -> String {
    let name = &task.name;
    match next {
        "accept" if task.state == TaskState::Blocked => {
            let unresolved: Vec<usize> = task.unresolved().map(|finding| finding.id).collect();
            let resume = format!("then blabla task accept {name} --model <id> resumes the task");
            if unresolved.is_empty() {
                format!(
                    "BLOCKED; the orchestrator settles the block (scope, check or an answer), {resume}"
                )
            } else {
                format!(
                    "BLOCKED on unresolved findings {unresolved:?}; the orchestrator settles them first (scope, check or an answer), {resume}"
                )
            }
        }
        "accept" => format!("accept or resume it with blabla task accept {name} --model <id>"),
        "await-answer" => match task::unanswered_decision(task) {
            Some(decision) => format!(
                "decision {} ({}) is below {}'s floor and has no answer, so the task stays BLOCKED. {}",
                decision.id,
                decision.question,
                task::floor_owner(task, decision),
                answer_route(task, decision)
            ),
            None => "no decision is waiting for an answer".to_owned(),
        },
        "pick-question" => match task.unpicked().next() {
            Some(asked) => format!(
                "the orchestrator asked question {} ({}) and it has no pick; pick it with {}",
                asked.id,
                asked.question,
                pick_command(task, asked)
            ),
            None => "every question the orchestrator asked has a pick".to_owned(),
        },
        "declare-check" => format!(
            "ask the orchestrator to declare its check with blabla task check {name} --check <prog> <arg>..."
        ),
        "record-evidence" => format!(
            "run its declared check with blabla task evidence {name} --run, which records the exit code BlaBla observes"
        ),
        "challenge" | "resolve-challenge" => format!(
            "run blabla challenge {name}, reconcile assignment blockers, then retry the hand-back"
        ),
        "claim-outcome" => match &task.goal {
            Some(goal) => format!(
                "it serves goal::{goal}, so hand-back claims its outcome with blabla task ready {name} --outcome <{}>",
                claims::Outcome::words()
            ),
            None => "it serves no goal, so hand-back claims no outcome; drop --outcome".to_owned(),
        },
        "claim-intent" => format!(
            "it was opened with --intent, so hand-back claims every affected intent with blabla task ready {name} --claim <INTENT>=<{}>",
            claims::Claim::words()
        ),
        "review" => "it is already READY; review and result acceptance belong to the orchestrator"
            .to_owned(),
        "closed" => "it is CLOSED; open a new assignment for new work".to_owned(),
        _ => "the task record has an invalid state".to_owned(),
    }
}
