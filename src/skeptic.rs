use crate::project::status::CompletionState;
use crate::project::task::{self, Resolution, Task};
use crate::structure::falsify::FalsifyReport;
use serde::Serialize;
use std::collections::BTreeMap;

pub const AUTHORITY: &str = "A challenge is a question, never a verdict. It does not decide whether the work is correct, it grants no completion and withholds none, and blabla status and blabla finish remain the only authority over that.";

pub const LIMITS: [&str; 3] = [
    "Every challenge rests on evidence BlaBla already holds: the bounded task record, the working tree measured against it, and a rule verdict the falsifier produced. Nothing here is inferred from what an agent said it did.",
    "Silence is not approval. No challenge means no contradiction was reachable from that evidence, which is a statement about the evidence rather than about the work.",
    "BlaBla reads no meaning from source code. It cannot tell whether a branch is reachable, whether a name is the one you meant or whether a test asserts the thing it claims; a challenge about those never appears because it could not be grounded.",
];

pub const CLASSES: [&str; 13] = [
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
];

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
}

pub struct Evidence<'a> {
    pub task: Option<&'a Task>,
    pub tree: &'a BTreeMap<String, String>,
    pub completion: CompletionState,
    pub completion_reason: &'a str,
    pub falsify: &'a dyn Fn() -> FalsifyReport,
    pub role: Option<&'a Resolution>,
}

const NO_TASK: &str = "no bounded task is open; blabla task open records one";
const NOT_REACHED: &str = "a stronger challenge already stands, so this was not evaluated";

pub fn challenge(evidence: &Evidence<'_>) -> ChallengeReport {
    let mut outcomes: Vec<(&'static str, Result<Challenge, &'static str>)> = Vec::new();
    type Grounding = fn(&Task, &BTreeMap<String, String>) -> Result<Challenge, &'static str>;
    let against_the_task: [(&'static str, Grounding); 9] = [
        (CLASSES[12], declared_check_failed),
        (CLASSES[0], |task, _| unresolved_finding(task)),
        (CLASSES[1], deliverable_unchanged),
        (CLASSES[2], scope_breach),
        (CLASSES[5], work_without_acceptance),
        (CLASSES[7], |task, _| exception_unresolved(task)),
        (CLASSES[9], |task, _| readiness_without_evidence(task)),
        (CLASSES[10], evidence_superseded),
        (CLASSES[11], attribution_unknown),
    ];
    for (class, grounding) in against_the_task {
        outcomes.push((
            class,
            match evidence.task {
                Some(task) => grounding(task, evidence.tree),
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
        verification_not_current(evidence.completion, evidence.completion_reason),
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
    let Some(finding) = task.unresolved().next() else {
        return Err("every finding recorded on the task carries a resolution");
    };
    let outstanding = task.unresolved().count();
    let mut evidence = vec![format!(
        "task {:?} finding {}: {}",
        task.name, finding.id, finding.statement
    )];
    if outstanding > 1 {
        evidence.push(format!(
            "{outstanding} findings on this task carry no resolution"
        ));
    }
    evidence.push(
        "recorded while the task was open; nothing since has stated what settles it".to_owned(),
    );
    Ok(Challenge {
        class: Class::UnresolvedFinding,
        statement: format!(
            "I don't believe this task is ready. Finding {} was recorded during it and still carries no resolution.",
            finding.id
        ),
        evidence,
        reconcile: format!(
            "Settle it against the repository and record what settled it: blabla task resolve {} {} --evidence \"...\". If it no longer holds, say why in that evidence rather than dropping it.",
            task.name, finding.id
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
        let current = tree.get(&deliverable.path);
        match (&deliverable.opened_digest, current) {
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
        reconcile: "Produce the deliverable, or state the evidence that it was already correct and needed no change; an untouched deliverable is the work a green check hides.".to_owned(),
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
        reconcile: "Either the edit belongs to another task and should be reverted here, or the scope was wrong and the orchestrator widens it deliberately. BlaBla observes the breach; it does not prevent it.".to_owned(),
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
    Ok(Challenge {
        class: Class::VerificationNotCurrent,
        statement: format!(
            "I don't believe any completion claim about this tree yet: {subject}."
        ),
        evidence: vec![
            format!("completion state: {}", state.word()),
            reason.to_owned(),
        ],
        reconcile: "Run blabla finish and read its result before stating that the work is done; a claim of completion over a state BlaBla has not verified is the claim this project exists to block.".to_owned(),
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
        reconcile: "Either the role accepts the assignment it is working on, with blabla task accept <name> --model <id>, or the change belongs to another task. An acceptance records that a role took the work through this CLI; it never proves the role read what it retrieved.".to_owned(),
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
        reconcile: "Proposing a model outside role policy is allowed and is not dispatching on it. The owner either approves the exception or refuses it; until then the proposal stands unresolved.".to_owned(),
    })
}

fn declared_check_failed(
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> Result<Challenge, &'static str> {
    if task.state != "ready" {
        return Err("the task has not been handed back for review");
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
        reconcile: "Repair what the check reports and record the new result, or state why a failing result is the intended outcome. A result that ran is not a result that passed, and neither absence nor staleness describes this one.".to_owned(),
    })
}

fn readiness_without_evidence(task: &Task) -> Result<Challenge, &'static str> {
    if task.state != "ready" {
        return Err("the task has not been handed back for review");
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
            "I don't believe this hand-back is supported. It is ready for review and no check result is recorded against it.".to_owned(),
            "evidence: none recorded".to_owned(),
        )
    } else {
        (
            format!(
                "I don't believe this hand-back is supported. It is ready for review, and every result recorded against it answers a different check than {declared}."
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
        reconcile: "Record the outcome of the task's declared check. A result for another check is not evidence about this one, missing evidence is not the same as a check that failed, and neither is the same as a claim in a message.".to_owned(),
    })
}

fn evidence_superseded(
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> Result<Challenge, &'static str> {
    let Some(evidence) = task::latest_evidence(task).filter(|entry| task::stale(entry, tree))
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
        reconcile: "Re-run the check and record the new outcome. Superseded evidence is not absent evidence and is not a false claim; it is a result whose inputs moved.".to_owned(),
    })
}

fn attribution_unknown(
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> Result<Challenge, &'static str> {
    let moved = task::changed(task, tree);
    let Some(first) = moved
        .iter()
        .find(|path| task::attribute(task, tree, path) == task::ATTRIBUTIONS[2])
    else {
        return Err("every change since the task opened is attributable");
    };
    Ok(Challenge {
        class: Class::AttributionUnknown,
        statement: format!(
            "I cannot attribute {first}. It changed since this task opened, it is outside the task's scope, and nothing declares who changed it."
        ),
        evidence: vec![
            format!("changed since the task opened: {first}"),
            format!("write scope: {}", task.scope.join(", ")),
            "no declaration covers it".to_owned(),
        ],
        reconcile: "Declare it as a concurrent change if it was yours, or widen the scope if it belongs to this task. Unknown attribution is a question to reconcile; it is not evidence that the worker wrote it.".to_owned(),
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
        reconcile: "Either accept the assignment on a permitted model, or propose the exception with blabla task propose-model and let the owner rule on it. Proposing is allowed; running on it unruled is what this contradicts.".to_owned(),
    })
}

fn lens_unassessed(task: &Task, role: Option<&Resolution>) -> Result<Challenge, &'static str> {
    if task.state != "ready" {
        return Err("the task has not been handed back for review");
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
        reconcile: "Record what the assessment was with blabla task lens, including that the lens does not apply, which is a complete answer. Recording an assessment says the question was asked; it never establishes that the design is correct.".to_owned(),
    })
}
