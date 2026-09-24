use crate::memory::Memory;
use crate::memory::goal::{Outcome, Verdict};
use crate::project::status::CompletionState;
use crate::project::task::{self, Resolution, Task};
use crate::structure::falsify::FalsifyReport;
use serde::Serialize;
use std::collections::BTreeMap;

pub const AUTHORITY: &str = include_str!("cli/text/skeptic-authority.md");

pub const LIMITS: [&str; 3] = [
    include_str!("cli/text/skeptic-limit-evidence.md"),
    include_str!("cli/text/skeptic-limit-silence.md"),
    include_str!("cli/text/skeptic-limit-source.md"),
];

pub const CLASSES: [&str; 16] = [
    "unresolved-finding",
    "deliverable-unchanged",
    "scope-breach",
    "vacuous-rule",
    "verification-not-current",
    "work-without-acceptance",
    "model-outside-role-policy",
    "exception-unresolved",
    "lens-unassessed",
    "readiness-without-evidence",
    "evidence-superseded",
    "attribution-unknown",
    "declared-check-failed",
    "decision-unanswered",
    "orchestrator-record-during-carry",
    "question-unpicked",
];

pub const OUTSIDE_THE_ASSIGNMENT: [&str; 3] = [
    "verification-not-current",
    "vacuous-rule",
    "orchestrator-record-during-carry",
];

pub const GOAL_CLASSES: [&str; 1] = ["goal-outcome-unmet"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Class {
    UnresolvedFinding,
    DeliverableUnchanged,
    ScopeBreach,
    VacuousRule,
    VerificationNotCurrent,
    WorkWithoutAcceptance,
    ModelOutsideRolePolicy,
    ExceptionUnresolved,
    LensUnassessed,
    ReadinessWithoutEvidence,
    EvidenceSuperseded,
    AttributionUnknown,
    DeclaredCheckFailed,
    DecisionUnanswered,
    OrchestratorRecordDuringCarry,
    QuestionUnpicked,
    GoalOutcomeUnmet,
}

impl Class {
    pub fn word(self) -> &'static str {
        match self {
            Class::UnresolvedFinding => CLASSES[0],
            Class::DeliverableUnchanged => CLASSES[1],
            Class::ScopeBreach => CLASSES[2],
            Class::VacuousRule => CLASSES[3],
            Class::VerificationNotCurrent => CLASSES[4],
            Class::WorkWithoutAcceptance => CLASSES[5],
            Class::ModelOutsideRolePolicy => CLASSES[6],
            Class::ExceptionUnresolved => CLASSES[7],
            Class::LensUnassessed => CLASSES[8],
            Class::ReadinessWithoutEvidence => CLASSES[9],
            Class::EvidenceSuperseded => CLASSES[10],
            Class::AttributionUnknown => CLASSES[11],
            Class::DeclaredCheckFailed => CLASSES[12],
            Class::DecisionUnanswered => CLASSES[13],
            Class::OrchestratorRecordDuringCarry => CLASSES[14],
            Class::QuestionUnpicked => CLASSES[15],
            Class::GoalOutcomeUnmet => GOAL_CLASSES[0],
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Challenge {
    pub class: Class,
    pub statement: String,
    pub evidence: Vec<String>,
    pub reconcile: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ChallengeReport {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub challenge: Option<Challenge>,
    pub grounded: Vec<&'static str>,
    pub ungrounded: Vec<(&'static str, &'static str)>,
    pub authority: &'static str,
    pub limits: [&'static str; 3],
}

impl ChallengeReport {
    pub fn exit_code(&self) -> i32 {
        if self.challenge.is_some() { 1 } else { 0 }
    }

    pub fn assignment_blockers(&self) -> Vec<&'static str> {
        self.grounded
            .iter()
            .copied()
            .filter(|class| !OUTSIDE_THE_ASSIGNMENT.contains(class))
            .collect()
    }
}

pub struct Evidence<'a> {
    pub task: Option<&'a Task>,
    pub tree: &'a BTreeMap<String, String>,
    pub completion: CompletionState,
    pub completion_reason: &'a str,
    pub falsify: &'a dyn Fn() -> FalsifyReport,
    pub role: Option<&'a Resolution>,
    pub other_tasks: &'a [Task],
}

const NO_TASK: &str = "no bounded task is open; blabla task open records one";
const NOT_REACHED: &str = "a stronger challenge already stands, so this was not evaluated";
pub const GOALS_NOT_JUDGED: &str = "finish does not judge goals, because a goal never decides completion; blabla challenge with no bounded task selected judges each goal marked done";

pub fn unjudged_goals<T>(memory: &Memory<T>) -> Option<&'static str> {
    match memory {
        Memory::Missing(_) => Some(
            "goals were not judged, because the registered goal memory is missing; blabla status names its problems",
        ),
        Memory::Unreadable(_) => Some(
            "goals were not judged, because the registered goal memory is unreadable; blabla status names its problems",
        ),
        Memory::Invalid(_) => Some(
            "goals were not judged, because the registered goal memory is invalid; blabla status names its problems",
        ),
        Memory::Unregistered | Memory::Ignored(_) | Memory::Present(_) => None,
    }
}

fn path_in_other_task_scope(
    path: &str,
    current_task: &Task,
    other_tasks: &[Task],
    tree: &BTreeMap<String, String>,
) -> bool {
    other_tasks.iter().any(|other| {
        if other.name == current_task.name {
            return false;
        }
        if other.open()
            && (other.in_scope(path)
                || other
                    .deliverables
                    .iter()
                    .any(|deliverable| task::covers(&deliverable.path, path)))
        {
            return true;
        }
        if !other.open()
            && other
                .closed_unix
                .is_some_and(|closed| closed > current_task.opened_unix)
            && (other.in_scope(path)
                || other
                    .deliverables
                    .iter()
                    .any(|deliverable| task::covers(&deliverable.path, path)))
            && let Some(closed_digest) = other.closed_paths.get(path)
            && let Some(current_digest) = task::observed_digest(tree, path)
            && &current_digest == closed_digest
        {
            return true;
        }
        false
    })
}

pub fn challenge(evidence: &Evidence<'_>) -> ChallengeReport {
    challenge_against(evidence, Err(GOALS_NOT_JUDGED))
}

pub fn challenge_with_goals(evidence: &Evidence<'_>, goals: &[Outcome]) -> ChallengeReport {
    challenge_against(evidence, Ok(goals))
}

pub fn challenge_against(
    evidence: &Evidence<'_>,
    goals: Result<&[Outcome], &'static str>,
) -> ChallengeReport {
    let mut outcomes: Vec<(&'static str, Result<Challenge, &'static str>)> = Vec::new();
    type Grounding = fn(&Task, &Evidence<'_>) -> Result<Challenge, &'static str>;
    let against_the_task: [(&'static str, Grounding); 11] = [
        (CLASSES[12], |task, evidence| {
            declared_check_failed(task, evidence.tree)
        }),
        (CLASSES[13], |task, _| decision_unanswered(task)),
        (CLASSES[15], |task, _| question_unpicked(task)),
        (CLASSES[0], |task, _| unresolved_finding(task)),
        (CLASSES[1], |task, evidence| {
            deliverable_unchanged(task, evidence.tree)
        }),
        (CLASSES[2], |task, evidence| {
            scope_breach(task, evidence.tree)
        }),
        (CLASSES[5], |task, evidence| {
            work_without_acceptance(task, evidence.tree)
        }),
        (CLASSES[7], |task, _| exception_unresolved(task)),
        (CLASSES[9], |task, _| readiness_without_evidence(task)),
        (CLASSES[10], |task, evidence| {
            evidence_superseded(task, evidence.tree)
        }),
        (CLASSES[11], |task, evidence| {
            attribution_unknown(task, evidence.tree, evidence.other_tasks)
        }),
    ];
    for (class, grounding) in against_the_task {
        outcomes.push((
            class,
            match evidence.task {
                Some(task) => grounding(task, evidence),
                None => Err(NO_TASK),
            },
        ));
    }
    type RoleGrounding = fn(&Task, Option<&Resolution>) -> Result<Challenge, &'static str>;
    let against_the_role: [(&'static str, RoleGrounding); 2] = [
        (CLASSES[6], model_outside_role_policy),
        (CLASSES[8], lens_unassessed),
    ];
    for (class, grounding) in against_the_role {
        outcomes.push((
            class,
            match evidence.task {
                Some(task) => grounding(task, evidence.role),
                None => Err(NO_TASK),
            },
        ));
    }
    outcomes.push((
        CLASSES[14],
        match evidence.task {
            Some(task) => orchestrator_record_during_carry(task),
            None => Err(NO_TASK),
        },
    ));
    outcomes.push((GOAL_CLASSES[0], goal_outcome_unmet(goals, evidence.task)));
    let standing = outcomes.iter().any(|(_, outcome)| outcome.is_ok());
    outcomes.push((
        CLASSES[3],
        if standing {
            Err(NOT_REACHED)
        } else {
            vacuous_rule(&(evidence.falsify)())
        },
    ));
    outcomes.push((
        CLASSES[4],
        verification_not_current(
            evidence.completion,
            evidence.completion_reason,
            evidence.task,
        ),
    ));

    let mut grounded = Vec::new();
    let mut ungrounded = Vec::new();
    let mut found: Option<Challenge> = None;
    for (class, outcome) in outcomes {
        match outcome {
            Ok(challenge) => {
                grounded.push(class);
                if found.is_none() {
                    found = Some(challenge);
                }
            }
            Err(reason) => ungrounded.push((class, reason)),
        }
    }

    ChallengeReport {
        task: evidence.task.map(|task| task.name.clone()),
        challenge: found,
        grounded,
        ungrounded,
        authority: AUTHORITY,
        limits: LIMITS,
    }
}

fn unresolved_finding(task: &Task) -> Result<Challenge, &'static str> {
    if !task.open() {
        return Err("the task is closed; a finding on it is history rather than open evidence");
    }
    if task.findings.is_empty() {
        return Err("the task records no finding");
    }
    let Some(finding) = task.blocking().next() else {
        return Err("every finding recorded on the task carries a resolution or an addressed mark");
    };
    let outstanding = task.blocking().count();
    let mut evidence = vec![format!(
        "task {:?} finding {}: {}",
        task.name, finding.id, finding.statement
    )];
    if outstanding > 1 {
        evidence.push(format!(
            "{outstanding} findings on this task carry neither a resolution nor an addressed mark"
        ));
    }
    evidence.push(
        "recorded while the task was open; nothing since has stated what was done about it"
            .to_owned(),
    );
    Ok(Challenge {
        class: Class::UnresolvedFinding,
        statement: format!(
            "I don't believe this task is ready. Finding {} was recorded during it and still carries no resolution.",
            finding.id
        ),
        evidence,
        reconcile: format!(
            "The carrying role records what it did with blabla task addressed {} {} \"...\" --model <id>. The orchestrator settles it with blabla task resolve {} {} --evidence \"...\" --model <id>. If it no longer holds, say why in that evidence rather than dropping it.",
            task.name, finding.id, task.name, finding.id
        ),
    })
}

fn decision_unanswered(task: &Task) -> Result<Challenge, &'static str> {
    if !task.open() {
        return Err("the task is closed; a decision on it is history rather than open evidence");
    }
    let mut waiting = task
        .decisions
        .iter()
        .filter(|decision| decision.unanswered_below_floor());
    let Some(decision) = waiting.next() else {
        return Err("no decision below its floor is waiting for the orchestrator's answer");
    };
    let mut evidence = vec![
        format!(
            "task {:?} decision {}: {}",
            task.name, decision.id, decision.question
        ),
        format!("options: {}", decision.options.join(", ")),
        format!(
            "{} picked {} at {}% confidence, below {}'s floor of {}%",
            decision.model,
            decision.pick,
            decision.confidence,
            task::floor_owner(task, decision),
            decision.floor
        ),
        "answer: none recorded".to_owned(),
    ];
    let others = waiting.count();
    if others > 0 {
        evidence.push(format!(
            "{} more decision(s) below the floor on this task are waiting for an answer",
            others
        ));
    }
    Ok(Challenge {
        class: Class::DecisionUnanswered,
        statement: format!(
            "I don't believe this task can be handed back. Decision {} was recorded below its floor, so it blocks the task, and nobody has answered it.",
            decision.id
        ),
        evidence,
        reconcile: format!(
            "The orchestrator answers it with blabla task answer {} {} --pick <{}> --reason \"...\" --model <id>. Until then the task stays BLOCKED and the carrying role does not act on {}; it resumes with blabla task accept once the answer is recorded.",
            task.name,
            decision.id,
            decision.options.join("|"),
            decision.pick
        ),
    })
}

fn question_unpicked(task: &Task) -> Result<Challenge, &'static str> {
    if !task.open() {
        return Err("the task is closed; a question on it is history rather than open evidence");
    }
    let mut unpicked = task.unpicked();
    let Some(asked) = unpicked.next() else {
        return Err("every question the orchestrator asked has a pick");
    };
    let mut evidence = vec![
        format!(
            "task {:?} question {}: {}",
            task.name, asked.id, asked.question
        ),
        format!("options: {}", asked.options.join(", ")),
        format!(
            "asked by {} with a floor of {}%; pick: none recorded",
            asked.model, asked.floor
        ),
    ];
    let others = unpicked.count();
    if others > 0 {
        evidence.push(format!(
            "{others} more question(s) from the orchestrator on this task have no pick"
        ));
    }
    Ok(Challenge {
        class: Class::QuestionUnpicked,
        statement: format!(
            "I don't believe this task can be handed back. The orchestrator asked question {} and nobody has picked an answer to it.",
            asked.id
        ),
        evidence,
        reconcile: format!(
            "blabla task decide {} --on {} --pick <{}> --confidence <0-100> --model <id>. The pick is measured against the question's floor of {}%: at or above it the pick stands, below it the task is BLOCKED until the orchestrator answers. task ready is refused until every question has a pick.",
            task.name,
            asked.id,
            asked.options.join("|"),
            asked.floor
        ),
    })
}

fn orchestrator_record_during_carry(task: &Task) -> Result<Challenge, &'static str> {
    if !task.open() {
        return Err("the task is closed; a record on it is history rather than open evidence");
    }
    let mut unconfirmed = task.unconfirmed_during_carry();
    let Some(record) = unconfirmed.next() else {
        return Err(
            "no record made under an orchestrator model while a worker carried the task is waiting for confirmation",
        );
    };
    let carrier = record.carried_by.as_deref().unwrap_or("a worker");
    let claimed = match &record.model {
        Some(model) => format!("under {model}"),
        None => "with no --model".to_owned(),
    };
    let mut evidence = vec![
        format!(
            "task {:?}: {} recorded {} while {} carried the task",
            task.name, record.verb, claimed, carrier
        ),
        "confirmed: no".to_owned(),
        "--model is what the caller said it was; BlaBla cannot tell who ran the command".to_owned(),
    ];
    let others = unconfirmed.count();
    if others > 0 {
        evidence.push(format!(
            "{others} more record(s) made while the task was carried are unconfirmed"
        ));
    }
    Ok(Challenge {
        class: Class::OrchestratorRecordDuringCarry,
        statement: format!(
            "I don't believe the orchestrator made this record. {} was recorded {} while {} carried the task, and --model is an attestation, not proof.",
            record.verb, claimed, carrier
        ),
        evidence,
        reconcile: format!(
            "After hand-back the orchestrator reviews each record blabla task show {name} lists under \"Recorded under an orchestrator model\" and confirms it with blabla task confirm {name} --model <id>, or undoes it. The carrying role cannot clear this: task confirm is refused while the task is carried, the record does not refuse task ready, and task close is refused until the records are confirmed.",
            name = task.name
        ),
    })
}

fn deliverable_unchanged(
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> Result<Challenge, &'static str> {
    if task.deliverables.is_empty() {
        return Err("the task declares no deliverable");
    }
    let mut untouched = Vec::new();
    let mut absent = Vec::new();
    for deliverable in &task.deliverables {
        let current = task::observed_digest(tree, &deliverable.path);
        match (&deliverable.opened_digest, current.as_ref()) {
            (_, None) => absent.push(deliverable.path.as_str()),
            (Some(opened), Some(now)) if opened == now => untouched.push(deliverable.path.as_str()),
            _ => {}
        }
    }
    let (subject, mut evidence) = if let Some(path) = absent.first() {
        (
            format!("{path} was named as a deliverable and no file exists there"),
            vec![format!("deliverable {path}: absent from the working tree")],
        )
    } else {
        let Some(path) = untouched.first() else {
            return Err("every declared deliverable changed since the task opened");
        };
        let digest = task
            .deliverables
            .iter()
            .find(|deliverable| deliverable.path == *path)
            .and_then(|deliverable| deliverable.opened_digest.as_deref())
            .unwrap_or("unknown");
        (
            format!(
                "{path} was named as a deliverable and is byte-for-byte what it was when this task opened"
            ),
            vec![format!(
                "deliverable {path}: digest {digest} at open, {digest} now"
            )],
        )
    };
    let outstanding = untouched.len() + absent.len();
    if outstanding > 1 {
        evidence.push(format!(
            "{outstanding} of {} declared deliverables are in this state: {}",
            task.deliverables.len(),
            absent
                .iter()
                .chain(untouched.iter())
                .copied()
                .collect::<Vec<&str>>()
                .join(", ")
        ));
    }
    Ok(Challenge {
        class: Class::DeliverableUnchanged,
        statement: format!("I don't believe this task is complete. {subject}."),
        evidence,
        reconcile: include_str!("cli/text/skeptic-deliverable-unchanged.md").to_owned(),
    })
}

fn scope_breach(task: &Task, tree: &BTreeMap<String, String>) -> Result<Challenge, &'static str> {
    if task.scope.is_empty() {
        return Err("the task declares no write scope");
    }
    let moved = task::changed(task, tree);
    let outside: Vec<&str> = moved
        .into_iter()
        .filter(|path| {
            !task.in_scope(path) && task::attribute(task, tree, path) == task::ATTRIBUTIONS[0]
        })
        .collect();
    let Some(first) = outside.first() else {
        return Err("every file changed since the task opened is inside its write scope");
    };
    let mut evidence = vec![
        format!("write scope: {}", task.scope.join(", ")),
        format!("changed since this task opened, outside it: {first}"),
    ];
    if outside.len() > 1 {
        evidence.push(format!(
            "{} files changed outside the scope: {}",
            outside.len(),
            outside.join(", ")
        ));
    }
    Ok(Challenge {
        class: Class::ScopeBreach,
        statement: format!(
            "I don't believe this task stayed inside its write scope. {first} changed since it opened and no declared scope covers it."
        ),
        evidence,
        reconcile: include_str!("cli/text/skeptic-scope-breach.md").to_owned(),
    })
}

fn vacuous_rule(report: &FalsifyReport) -> Result<Challenge, &'static str> {
    let Some(rule) = report
        .findings()
        .find(|rule| rule.verdict == crate::structure::falsify::Verdict::Vacuous)
    else {
        return Err("no active structure rule stands on ground the providers cannot report");
    };
    let reason = rule
        .finding
        .as_deref()
        .unwrap_or("the inverted fact could not be built from what the providers reported");
    Ok(Challenge {
        class: Class::VacuousRule,
        statement: format!(
            "I don't believe {} can fail. Inverting the fact it names leaves its verdict where it was.",
            rule.id
        ),
        evidence: vec![
            format!("{}:{}  {}", rule.file, rule.line, rule.requirement),
            format!("falsification verdict: VACUOUS — {reason}"),
            format!("current status: {}", rule.status.word()),
        ],
        reconcile: format!(
            "A rule standing on absent ground is GREEN for a reason that has nothing to do with the project. Name a fact the providers actually report, or delete the rule: blabla explain {}.",
            rule.id
        ),
    })
}

fn verification_not_current(
    state: CompletionState,
    reason: &str,
    task: Option<&Task>,
) -> Result<Challenge, &'static str> {
    let subject = match state {
        CompletionState::Green => {
            return Err("the recorded verification is current and OVERALL is GREEN");
        }
        CompletionState::Stale => "the recorded run no longer describes this tree",
        CompletionState::Unverified => "no run has been recorded",
        CompletionState::Interrupted => "the last run did not reach a result",
        CompletionState::Verifying => {
            return Err("a blabla finish is running; its result is not in yet");
        }
        CompletionState::NotCanonical => "the recorded run was not the canonical profile",
        CompletionState::NoProfile => "no canonical profile is declared",
        CompletionState::NoActiveContracts => "no contract is active",
        CompletionState::Yellow => "required behavior was never exercised",
        CompletionState::Red => "a rule is violated",
        CompletionState::StructureRed => "a structure rule is violated",
        CompletionState::StructureError => "structure could not be evaluated",
    };
    let in_the_workers_hands =
        task.is_some_and(|task| matches!(task.state.as_str(), "open" | "accepted" | "blocked"));
    Ok(Challenge {
        class: Class::VerificationNotCurrent,
        statement: format!("I don't believe any completion claim about this tree yet: {subject}."),
        evidence: vec![
            format!("completion state: {}", state.word()),
            reason.to_owned(),
        ],
        reconcile: if in_the_workers_hands {
            include_str!("cli/text/skeptic-verification-not-current-assignment.md")
        } else {
            include_str!("cli/text/skeptic-verification-not-current.md")
        }
        .to_owned(),
    })
}

fn work_without_acceptance(
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> Result<Challenge, &'static str> {
    if task.accepted.is_some() {
        return Err(
            "an acceptance is recorded for this assignment; whether it preceded the work is not something BlaBla observes",
        );
    }
    let moved = task::changed(task, tree);
    let Some(first) = moved.first() else {
        return Err("nothing has changed since the task opened");
    };
    Ok(Challenge {
        class: Class::WorkWithoutAcceptance,
        statement: format!(
            "I don't believe this work was taken up through BlaBla. {first} changed, and no role ever accepted this assignment."
        ),
        evidence: vec![
            format!("state: {}", task.state),
            format!("changed since the task opened: {first}"),
            "no acceptance is recorded on this task".to_owned(),
        ],
        reconcile: include_str!("cli/text/skeptic-work-without-acceptance.md").to_owned(),
    })
}

fn exception_unresolved(task: &Task) -> Result<Challenge, &'static str> {
    let Some(exception) = task
        .exceptions
        .iter()
        .find(|exception| exception.approval.is_none())
    else {
        return Err("no model exception is waiting on the owner");
    };
    Ok(Challenge {
        class: Class::ExceptionUnresolved,
        statement: format!(
            "I don't believe this assignment is settled. A model exception for {} was proposed and no owner ruling answers it.",
            exception.model
        ),
        evidence: vec![
            format!("proposed model: {}", exception.model),
            format!("reason given: {}", exception.reason),
            "approval: none recorded".to_owned(),
        ],
        reconcile: include_str!("cli/text/skeptic-exception-unresolved.md").to_owned(),
    })
}

fn declared_check_failed(
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> Result<Challenge, &'static str> {
    if !matches!(task.state.as_str(), "accepted" | "ready") {
        return Err("the task is not accepted or handed back for review");
    }
    let Some(latest) = task::latest_evidence(task) else {
        return Err(
            "no result for the declared check is recorded at all, which is a different fact",
        );
    };
    if task::readiness(task, tree).answers_declared_check {
        return Err("the most recent result for the declared check reports success");
    }
    Ok(Challenge {
        class: Class::DeclaredCheckFailed,
        statement: format!(
            "I don't believe this hand-back is supported. {} is the check this task declared, and the most recent result for it exited {}.",
            latest.check, latest.exit
        ),
        evidence: vec![
            format!("state: {}", task.state),
            format!("check: {}", latest.check),
            format!("exit: {}", latest.exit),
            format!("tool: {}", latest.tool),
        ],
        reconcile: include_str!("cli/text/skeptic-declared-check-failed.md").to_owned(),
    })
}

fn readiness_without_evidence(task: &Task) -> Result<Challenge, &'static str> {
    if !matches!(task.state.as_str(), "accepted" | "ready") {
        return Err("the task is not accepted or handed back for review");
    }
    if task::latest_evidence(task).is_some() {
        return Err("a result for the declared check is recorded against this hand-back");
    }
    let declared = task.check.as_deref().unwrap_or("the task's declared check");
    let seen: Vec<String> = task
        .evidence
        .iter()
        .map(|entry| entry.check.clone())
        .collect();
    let (statement, observed) = if seen.is_empty() {
        (
            "I don't believe this hand-back is supported. No check result is recorded against this assignment.".to_owned(),
            "evidence: none recorded".to_owned(),
        )
    } else {
        (
            format!(
                "I don't believe this hand-back is supported. Every result recorded against this assignment answers a different check than {declared}."
            ),
            format!("evidence recorded, for: {}", seen.join(", ")),
        )
    };
    Ok(Challenge {
        class: Class::ReadinessWithoutEvidence,
        statement,
        evidence: vec![
            format!("state: {}", task.state),
            format!("declared check: {declared}"),
            observed,
        ],
        reconcile: include_str!("cli/text/skeptic-readiness-without-evidence.md").to_owned(),
    })
}

fn evidence_superseded(
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> Result<Challenge, &'static str> {
    let Some(evidence) =
        task::latest_evidence(task).filter(|_| !task::readiness(task, tree).current)
    else {
        return Err(
            "the most recent result for the declared check still matches the inputs it saw",
        );
    };
    Ok(Challenge {
        class: Class::EvidenceSuperseded,
        statement: format!(
            "I don't believe this result still holds. {} ran against inputs that have since changed.",
            evidence.check
        ),
        evidence: vec![
            format!("check: {}", evidence.check),
            format!("exit: {}", evidence.exit),
            format!("inputs it saw: {}", evidence.inputs.len()),
        ],
        reconcile: include_str!("cli/text/skeptic-evidence-superseded.md").to_owned(),
    })
}

fn attribution_unknown(
    task: &Task,
    tree: &BTreeMap<String, String>,
    other_tasks: &[Task],
) -> Result<Challenge, &'static str> {
    let moved = task::changed(task, tree);
    let undeclared: Vec<&str> = moved
        .iter()
        .copied()
        .filter(|path| {
            task::attribute(task, tree, path) == task::ATTRIBUTIONS[2]
                && !path_in_other_task_scope(path, task, other_tasks, tree)
        })
        .collect();
    let Some(first) = undeclared.first().copied() else {
        return Err("every change since the task opened is attributable");
    };
    let mut evidence = vec![
        format!("changed since the task opened: {first}"),
        format!("write scope: {}", task.scope.join(", ")),
        "no declaration covers it".to_owned(),
    ];
    if undeclared.len() > 1 {
        evidence.push(format!(
            "{} changed paths carry no declaration: {}",
            undeclared.len(),
            undeclared.join(", ")
        ));
    }
    Ok(Challenge {
        class: Class::AttributionUnknown,
        statement: format!(
            "I cannot attribute {first}. It changed since this task opened, it is outside the task's scope, and nothing declares who changed it."
        ),
        evidence,
        reconcile: include_str!("cli/text/skeptic-attribution-unknown.md").to_owned(),
    })
}

fn model_outside_role_policy(
    task: &Task,
    role: Option<&Resolution>,
) -> Result<Challenge, &'static str> {
    let Some(accepted) = &task.accepted else {
        return Err("the assignment has not been accepted, so no model is on record");
    };
    let Some(role) = role else {
        return Err("no role memory is registered, so no model policy can be read");
    };
    if role.models.is_empty() {
        return Err("the role declares no model policy");
    }
    if role.models.iter().any(|model| model == &accepted.model) {
        return Err("the accepted model is one the role permits");
    }
    if task
        .exceptions
        .iter()
        .any(|exception| exception.model == accepted.model && exception.approval.is_some())
    {
        return Err("an owner ruling approved this model for this assignment");
    }
    Ok(Challenge {
        class: Class::ModelOutsideRolePolicy,
        statement: format!(
            "I don't believe this assignment is running under a permitted model. It was accepted on {}, which {} does not list.",
            accepted.model, task.role
        ),
        evidence: vec![
            format!("accepted model: {}", accepted.model),
            format!("role::{} permits: {}", task.role, role.models.join(", ")),
            "no approved exception covers it".to_owned(),
        ],
        reconcile: include_str!("cli/text/skeptic-model-outside-role-policy.md").to_owned(),
    })
}

fn lens_unassessed(task: &Task, role: Option<&Resolution>) -> Result<Challenge, &'static str> {
    if !matches!(task.state.as_str(), "accepted" | "ready") {
        return Err("the task is not accepted or handed back for review");
    }
    let Some(role) = role else {
        return Err("no role memory is registered, so no lens is expected");
    };
    let Some(missing) = role
        .lenses
        .iter()
        .find(|lens| !task.assessments.iter().any(|entry| &&entry.ruling == lens))
    else {
        return Err("every lens the role consults carries an assessment");
    };
    Ok(Challenge {
        class: Class::LensUnassessed,
        statement: format!(
            "I don't believe this hand-back was held against everything the role consults. {missing} has no assessment on it."
        ),
        evidence: vec![
            format!("state: {}", task.state),
            format!("role::{} consults: {}", task.role, role.lenses.join(", ")),
            format!("assessments recorded: {}", task.assessments.len()),
        ],
        reconcile: include_str!("cli/text/skeptic-lens-unassessed.md").to_owned(),
    })
}

fn goal_outcome_unmet(
    goals: Result<&[Outcome], &'static str>,
    task: Option<&Task>,
) -> Result<Challenge, &'static str> {
    if task.is_some() {
        return Err(
            "a bounded task is selected; a goal's outcome is challenged project-wide, when no task is",
        );
    }
    let unmet: Vec<&Outcome> = goals?.iter().filter(|goal| goal.unmet()).collect();
    let Some(first) = unmet.first() else {
        return Err("no goal marked done has an expectation that is not held");
    };
    let mut evidence = vec![
        format!("{}: state done", first.goal),
        format!("expectations held: {} of {}", first.held, first.expected),
    ];
    evidence.extend(
        first
            .expectations
            .iter()
            .filter(|expectation| expectation.verdict != Verdict::Held)
            .map(|expectation| format!("{}: {}", expectation.identity, expectation.verdict.word())),
    );
    if unmet.len() > 1 {
        evidence.push(format!(
            "{} goals marked done have an expectation that is not held: {}",
            unmet.len(),
            unmet
                .iter()
                .map(|goal| goal.goal.as_str())
                .collect::<Vec<&str>>()
                .join(", ")
        ));
    }
    Ok(Challenge {
        class: Class::GoalOutcomeUnmet,
        statement: format!(
            "I don't believe {} is done. It is marked done, and {} of its {} expectations hold in the current project view.",
            first.goal, first.held, first.expected
        ),
        evidence,
        reconcile: format!(
            "blabla explain {} gives the verdict on each expectation. Make every one GREEN in a current run, or set the goal back to state \"active\" until it is.",
            first.goal
        ),
    })
}
