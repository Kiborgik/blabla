use crate::memory::Memory;
use crate::memory::goal::{Outcome, Verdict};
use crate::project::status::CompletionState;
use crate::project::task::machine::TaskState;
use crate::project::task::{self, Resolution, Task};
use crate::structure::falsify::FalsifyReport;
use serde::Serialize;
use std::collections::BTreeMap;

use crate::project::ignore::Ignore;

pub const AUTHORITY: &str = include_str!("cli/text/skeptic-authority.md");

pub const LIMITS: [&str; 3] = [
    include_str!("cli/text/skeptic-limit-evidence.md"),
    include_str!("cli/text/skeptic-limit-silence.md"),
    include_str!("cli/text/skeptic-limit-source.md"),
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
    DecisionUnanswered,
    OrchestratorRecordDuringCarry,
    QuestionUnpicked,
    GoalOutcomeUnmet,
    WithdrawalResidue,
    ReviewTargetStale,
    UnobservableTaskInput,
    CheckNotFalsified,
}

impl Class {
    pub const fn word(self) -> &'static str {
        match self {
            Class::UnresolvedFinding => "unresolved-finding",
            Class::DeliverableUnchanged => "deliverable-unchanged",
            Class::ScopeBreach => "scope-breach",
            Class::VacuousRule => "vacuous-rule",
            Class::VerificationNotCurrent => "verification-not-current",
            Class::WorkWithoutAcceptance => "work-without-acceptance",
            Class::ModelOutsideRolePolicy => "model-outside-role-policy",
            Class::ExceptionUnresolved => "exception-unresolved",
            Class::LensUnassessed => "lens-unassessed",
            Class::ReadinessWithoutEvidence => "readiness-without-evidence",
            Class::EvidenceSuperseded => "evidence-superseded",
            Class::AttributionUnknown => "attribution-unknown",
            Class::DeclaredCheckFailed => "declared-check-failed",
            Class::DecisionUnanswered => "decision-unanswered",
            Class::OrchestratorRecordDuringCarry => "orchestrator-record-during-carry",
            Class::QuestionUnpicked => "question-unpicked",
            Class::GoalOutcomeUnmet => "goal-outcome-unmet",
            Class::WithdrawalResidue => "withdrawal-residue",
            Class::ReviewTargetStale => "review-target-stale",
            Class::UnobservableTaskInput => "unobservable-task-input",
            Class::CheckNotFalsified => "check-not-falsified",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ground {
    Project,
    Task,
    Role,
    Goal,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reach {
    Assignment,
    Project,
}

type Found = Result<Challenge, &'static str>;

struct Scene<'a> {
    evidence: &'a Evidence<'a>,
    goals: Result<&'a [Outcome], &'static str>,
    tracking: Option<(&'a std::path::Path, &'a Ignore)>,
    ignore: &'a Ignore,
}

#[derive(Clone, Copy)]
enum Detect {
    Scene(fn(&Scene<'_>) -> Found),
    Task(fn(&Task, &Scene<'_>) -> Found),
}

#[derive(Clone, Copy)]
pub struct Detector {
    pub class: Class,
    pub ground: Ground,
    pub reach: Reach,
    pub waits_for_clear_work: bool,
    detect: Detect,
}

impl Detector {
    const fn new(class: Class, ground: Ground, reach: Reach, detect: Detect) -> Detector {
        Detector {
            class,
            ground,
            reach,
            waits_for_clear_work: false,
            detect,
        }
    }

    const fn after_clear_work(self) -> Detector {
        Detector {
            waits_for_clear_work: true,
            ..self
        }
    }

    pub fn outside_the_assignment(&self) -> bool {
        self.reach == Reach::Project
    }

    fn found(&self, scene: &Scene<'_>) -> Found {
        match self.detect {
            Detect::Scene(detect) => detect(scene),
            Detect::Task(detect) => match scene.evidence.task {
                Some(task) => detect(task, scene),
                None if self.outside_the_assignment() => scene
                    .evidence
                    .other_tasks
                    .iter()
                    .map(|task| detect(task, scene))
                    .reduce(|first, next| first.or(next))
                    .unwrap_or(Err(NO_TASK)),
                None => Err(NO_TASK),
            },
        }
    }
}

pub const DETECTORS: &[Detector] = &[
    Detector::new(
        Class::UnobservableTaskInput,
        Ground::Task,
        Reach::Assignment,
        Detect::Task(unobservable_task_input),
    ),
    Detector::new(
        Class::WithdrawalResidue,
        Ground::Project,
        Reach::Project,
        Detect::Scene(|scene| withdrawal_residue(scene.evidence, scene.tracking)),
    ),
    Detector::new(
        Class::DeclaredCheckFailed,
        Ground::Task,
        Reach::Assignment,
        Detect::Task(|task, scene| declared_check_failed(task, scene.evidence.tree)),
    ),
    Detector::new(
        Class::DecisionUnanswered,
        Ground::Task,
        Reach::Assignment,
        Detect::Task(|task, _| decision_unanswered(task)),
    ),
    Detector::new(
        Class::QuestionUnpicked,
        Ground::Task,
        Reach::Assignment,
        Detect::Task(|task, _| question_unpicked(task)),
    ),
    Detector::new(
        Class::UnresolvedFinding,
        Ground::Task,
        Reach::Assignment,
        Detect::Task(|task, _| unresolved_finding(task)),
    ),
    Detector::new(
        Class::DeliverableUnchanged,
        Ground::Task,
        Reach::Assignment,
        Detect::Task(|task, scene| deliverable_unchanged(task, scene.evidence.tree)),
    ),
    Detector::new(
        Class::ScopeBreach,
        Ground::Task,
        Reach::Assignment,
        Detect::Task(|task, scene| scope_breach(task, scene.evidence.tree, scene.ignore)),
    ),
    Detector::new(
        Class::WorkWithoutAcceptance,
        Ground::Task,
        Reach::Assignment,
        Detect::Task(|task, scene| {
            work_without_acceptance(task, scene.evidence.tree, scene.ignore)
        }),
    ),
    Detector::new(
        Class::ExceptionUnresolved,
        Ground::Task,
        Reach::Assignment,
        Detect::Task(|task, _| exception_unresolved(task)),
    ),
    Detector::new(
        Class::ReadinessWithoutEvidence,
        Ground::Task,
        Reach::Assignment,
        Detect::Task(|task, _| readiness_without_evidence(task)),
    ),
    Detector::new(
        Class::EvidenceSuperseded,
        Ground::Task,
        Reach::Assignment,
        Detect::Task(|task, scene| evidence_superseded(task, scene.evidence.tree)),
    ),
    Detector::new(
        Class::AttributionUnknown,
        Ground::Task,
        Reach::Assignment,
        Detect::Task(|task, scene| {
            attribution_unknown(
                task,
                scene.evidence.tree,
                scene.evidence.other_tasks,
                scene.ignore,
            )
        }),
    ),
    Detector::new(
        Class::CheckNotFalsified,
        Ground::Task,
        Reach::Assignment,
        Detect::Task(|task, scene| check_not_falsified(task, scene.evidence.tree)),
    ),
    Detector::new(
        Class::ModelOutsideRolePolicy,
        Ground::Role,
        Reach::Assignment,
        Detect::Task(|task, scene| model_outside_role_policy(task, scene.evidence.role)),
    ),
    Detector::new(
        Class::LensUnassessed,
        Ground::Role,
        Reach::Assignment,
        Detect::Task(|task, scene| lens_unassessed(task, scene.evidence.role)),
    ),
    Detector::new(
        Class::ReviewTargetStale,
        Ground::Role,
        Reach::Assignment,
        Detect::Task(|task, scene| review_target_stale(task, scene.evidence.role)),
    ),
    Detector::new(
        Class::OrchestratorRecordDuringCarry,
        Ground::Task,
        Reach::Project,
        Detect::Task(|task, _| orchestrator_record_during_carry(task)),
    ),
    Detector::new(
        Class::GoalOutcomeUnmet,
        Ground::Goal,
        Reach::Project,
        Detect::Scene(|scene| goal_outcome_unmet(scene.goals, scene.evidence.task)),
    ),
    Detector::new(
        Class::VacuousRule,
        Ground::Project,
        Reach::Project,
        Detect::Scene(|scene| vacuous_rule(&(scene.evidence.falsify)())),
    )
    .after_clear_work(),
    Detector::new(
        Class::VerificationNotCurrent,
        Ground::Project,
        Reach::Project,
        Detect::Scene(|scene| {
            verification_not_current(
                scene.evidence.completion,
                scene.evidence.completion_reason,
                scene.evidence.task,
            )
        }),
    ),
];

#[derive(Clone, Debug, Serialize)]
pub struct Challenge {
    pub class: Class,
    pub statement: String,
    pub evidence: Vec<String>,
    pub reconcile: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unattributed: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ChallengeReport {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub challenge: Option<Challenge>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub challenges: Option<Vec<Challenge>>,
    pub grounded: Vec<&'static str>,
    pub assignment_blockers: Vec<&'static str>,
    pub project_challenges: Vec<&'static str>,
    pub ungrounded: Vec<(&'static str, &'static str)>,
    pub authority: &'static str,
    pub limits: [&'static str; 3],
}

pub fn standing(classes: &[&'static str], excused: &[Class]) -> Vec<&'static str> {
    classes
        .iter()
        .copied()
        .filter(|class| !excused.iter().any(|excuse| excuse.word() == *class))
        .collect()
}

impl ChallengeReport {
    pub fn exit_code(&self) -> i32 {
        if self.challenge.is_some() { 1 } else { 0 }
    }

    pub fn assignment_blockers(&self) -> Vec<&'static str> {
        self.assignment_blockers.clone()
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

const NO_TASK: &str = "no bounded task is selected; blabla challenge <task> holds one assignment and blabla task open records one";
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
    challenge_against_tracking(evidence, goals, None)
}

pub fn challenge_tracked_against(
    evidence: &Evidence<'_>,
    goals: Result<&[Outcome], &'static str>,
    root: &std::path::Path,
    ignore: &Ignore,
) -> ChallengeReport {
    challenge_against_tracking(evidence, goals, Some((root, ignore)))
}

fn challenge_against_tracking(
    evidence: &Evidence<'_>,
    goals: Result<&[Outcome], &'static str>,
    tracking: Option<(&std::path::Path, &Ignore)>,
) -> ChallengeReport {
    let default_rules = Ignore::default();
    let scene = Scene {
        evidence,
        goals,
        tracking,
        ignore: tracking.map_or(&default_rules, |(_, rules)| rules),
    };
    let mut work_challenged = false;
    let mut grounded = Vec::new();
    let mut ungrounded = Vec::new();
    let mut assignment_blockers = Vec::new();
    let mut project_challenges = Vec::new();
    let mut challenges: Vec<(Reach, Challenge)> = Vec::new();
    for detector in DETECTORS {
        let class = detector.class.word();
        let found = if detector.waits_for_clear_work && work_challenged {
            Err(NOT_REACHED)
        } else {
            detector.found(&scene)
        };
        match found {
            Ok(challenge) => {
                work_challenged |= detector.ground != Ground::Project;
                grounded.push(class);
                match detector.reach {
                    Reach::Assignment => assignment_blockers.push(class),
                    Reach::Project => project_challenges.push(class),
                }
                challenges.push((detector.reach, challenge));
            }
            Err(reason) => ungrounded.push((class, reason)),
        }
    }
    let headline = challenges
        .iter()
        .position(|(reach, _)| *reach == Reach::Assignment)
        .or_else(|| (!challenges.is_empty()).then_some(0));
    let project_wide = evidence.task.is_none().then(|| {
        challenges
            .iter()
            .map(|(_, challenge)| challenge.clone())
            .collect()
    });
    let found = headline.map(|index| challenges.swap_remove(index).1);

    ChallengeReport {
        task: evidence.task.map(|task| task.name.clone()),
        challenge: found,
        challenges: project_wide,
        assignment_blockers,
        project_challenges,
        grounded,
        ungrounded,
        authority: AUTHORITY,
        limits: LIMITS,
    }
}

fn unobservable_task_input(task: &Task, scene: &Scene<'_>) -> Found {
    let Some((root, ignore)) = scene.tracking else {
        return Err("path observability was not evaluated against project tracking");
    };
    let Some(problem) = task::tracking_error(task, root, ignore) else {
        return Err("every declared evidence path is observable in change tracking");
    };
    Ok(Challenge {
        unattributed: Vec::new(),
        class: Class::UnobservableTaskInput,
        statement: format!("I don't believe this result has observable inputs. {problem}"),
        evidence: vec![format!("task: {}", task.name), problem.clone()],
        reconcile: task::tracking_recovery(task, &problem),
    })
}

fn withdrawal_residue(
    evidence: &Evidence<'_>,
    tracking: Option<(&std::path::Path, &Ignore)>,
) -> Result<Challenge, &'static str> {
    for task in evidence.other_tasks {
        let paths = match tracking {
            Some((root, ignore)) => task::tracked_withdrawal_residue(
                task,
                evidence.other_tasks,
                evidence.tree,
                root,
                ignore,
            ),
            None => task::withdrawal_residue(task, evidence.other_tasks, evidence.tree),
        };
        if !paths.is_empty() {
            return Ok(Challenge {
                unattributed: Vec::new(),
                class: Class::WithdrawalResidue,
                statement: format!(
                    "Withdrawn task {} still has unresolved changed paths",
                    task.name
                ),
                evidence: paths
                    .iter()
                    .map(|path| format!("task::{} captured changed path {path}", task.name))
                    .collect(),
                reconcile: format!(
                    "Restore each path to its pre-task content, or record task reconcile-withdrawal {} PATH --successor TASK --model MODEL against a CLOSED successor with current evidence",
                    task.name
                ),
            });
        }
    }
    Err("no unresolved withdrawal residue remains")
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
        unattributed: Vec::new(),
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
        unattributed: Vec::new(),
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
        unattributed: Vec::new(),
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
        unattributed: Vec::new(),
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
        unattributed: Vec::new(),
        class: Class::DeliverableUnchanged,
        statement: format!("I don't believe this task is complete. {subject}."),
        evidence,
        reconcile: include_str!("cli/text/skeptic-deliverable-unchanged.md").to_owned(),
    })
}

fn scope_breach(
    task: &Task,
    tree: &BTreeMap<String, String>,
    ignore: &Ignore,
) -> Result<Challenge, &'static str> {
    if task.scope.is_empty() {
        return Err("the task declares no write scope");
    }
    let moved = task::changed(task, tree, ignore);
    let outside: Vec<&str> = moved
        .into_iter()
        .filter(|path| {
            !task.in_scope(path) && task::attribute(task, tree, path) == task::AttributionKind::Task
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
        unattributed: Vec::new(),
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
        unattributed: Vec::new(),
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
    let in_the_workers_hands = task.is_some_and(|task| {
        matches!(
            task.state,
            TaskState::Open | TaskState::Accepted | TaskState::Blocked
        )
    });
    Ok(Challenge {
        unattributed: Vec::new(),
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
    ignore: &Ignore,
) -> Result<Challenge, &'static str> {
    if task.accepted.is_some() {
        return Err(
            "an acceptance is recorded for this assignment; whether it preceded the work is not something BlaBla observes",
        );
    }
    let moved = task::changed(task, tree, ignore);
    let Some(first) = moved.first() else {
        return Err("nothing has changed since the task opened");
    };
    Ok(Challenge {
        unattributed: Vec::new(),
        class: Class::WorkWithoutAcceptance,
        statement: format!(
            "I don't believe this work was taken up through BlaBla. {first} changed, and no role ever accepted this assignment."
        ),
        evidence: vec![
            format!("state: {}", task.state.word()),
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
        .find(|exception| !exception.superseded && exception.approval.is_none())
    else {
        return Err("no model exception is waiting on the owner");
    };
    Ok(Challenge {
        unattributed: Vec::new(),
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
    if !matches!(task.state, TaskState::Accepted | TaskState::Ready) {
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
        unattributed: Vec::new(),
        class: Class::DeclaredCheckFailed,
        statement: format!(
            "I don't believe this hand-back is supported. {} is the check this task declared, and the most recent result for it exited {}.",
            latest.check, latest.exit
        ),
        evidence: vec![
            format!("state: {}", task.state.word()),
            format!("check: {}", latest.check),
            format!("exit: {}", latest.exit),
            format!("tool: {}", latest.tool),
        ],
        reconcile: include_str!("cli/text/skeptic-declared-check-failed.md").to_owned(),
    })
}

fn check_not_falsified(
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> Result<Challenge, &'static str> {
    if task.falsify.is_empty() {
        return Err("the task names no paths to falsify");
    }
    let inputs = task::evidence_inputs(task, tree);
    let standing = task
        .falsifications
        .iter()
        .rev()
        .find(|run| run.acceptance_epoch == task.acceptance_epoch);
    let reason = match standing {
        None => "no falsification is recorded at the current acceptance epoch",
        Some(run) if run.inputs != inputs => {
            "the check inputs changed after the latest falsification"
        }
        Some(run) if run.current_exit != 0 => {
            "the check fails on the current contents in its copy, so it cannot prove anything"
        }
        Some(run) if run.opened_exit.is_none_or(|exit| exit == 0) => {
            "the check passed on the opened contents, so it does not depend on the change"
        }
        Some(_) => {
            return Err(
                "the latest falsification at this epoch passed on the current contents, failed on the opened contents and its inputs still match",
            );
        }
    };
    Ok(Challenge {
        unattributed: Vec::new(),
        class: Class::CheckNotFalsified,
        statement: format!("I don't believe this hand-back proves its change. {reason}."),
        evidence: vec![
            format!("task: {}", task.name),
            format!("falsify: {}", task.falsify.join(", ")),
            format!("acceptance epoch: {}", task.acceptance_epoch),
        ],
        reconcile: include_str!("cli/text/skeptic-check-not-falsified.md").to_owned(),
    })
}

fn readiness_without_evidence(task: &Task) -> Result<Challenge, &'static str> {
    if !matches!(task.state, TaskState::Accepted | TaskState::Ready) {
        return Err("the task is not accepted or handed back for review");
    }
    if task::latest_evidence(task).is_some() {
        return Err("a result for the declared check is recorded against this hand-back");
    }
    let declared = task.check.as_ref().map_or_else(
        || "the task's declared check".to_owned(),
        |argv| crate::project::command_line(argv),
    );
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
                "I don't believe this hand-back is supported. No recorded result binds {declared} to the current acceptance epoch {}.",
                task.acceptance_epoch
            ),
            format!("evidence recorded, for: {}", seen.join(", ")),
        )
    };
    Ok(Challenge {
        unattributed: Vec::new(),
        class: Class::ReadinessWithoutEvidence,
        statement,
        evidence: vec![
            format!("state: {}", task.state.word()),
            format!("declared check: {declared}"),
            format!("acceptance epoch: {}", task.acceptance_epoch),
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
        unattributed: Vec::new(),
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
        reconcile: format!(
            "Inspect blabla task freshness {} for receipt-relative changes. {}",
            task.name,
            include_str!("cli/text/skeptic-evidence-superseded.md")
        ),
    })
}

fn attribution_unknown(
    task: &Task,
    tree: &BTreeMap<String, String>,
    other_tasks: &[Task],
    ignore: &Ignore,
) -> Result<Challenge, &'static str> {
    let undeclared: Vec<String> = task::attributions(task, tree, other_tasks, ignore)
        .into_iter()
        .filter(|entry| !entry.attributed)
        .map(|entry| entry.path)
        .collect();
    let Some(first) = undeclared.first() else {
        return Err("every change since the task opened is attributable");
    };
    let mut evidence = vec![
        format!("changed since the task opened: {first}"),
        format!("write scope: {}", task.scope.join(", ")),
        "no declaration covers it".to_owned(),
    ];
    let mut by_top: BTreeMap<&str, usize> = BTreeMap::new();
    for path in undeclared.iter().skip(1) {
        let top = path.split('/').next().unwrap_or(path);
        *by_top.entry(top).or_default() += 1;
    }
    evidence.extend(
        by_top
            .iter()
            .map(|(top, count)| format!("{count} more undeclared under {top}")),
    );
    Ok(Challenge {
        class: Class::AttributionUnknown,
        statement: format!(
            "I cannot attribute {first}. It changed since this task opened, it is outside the task's scope, and nothing declares who changed it."
        ),
        evidence,
        reconcile: include_str!("cli/text/skeptic-attribution-unknown.md").to_owned(),
        unattributed: undeclared,
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
    if crate::memory::process::admits(&role.models, &accepted.model) {
        return Err("the accepted model is one the role permits");
    }
    if task.exceptions.iter().any(|exception| {
        !exception.superseded && exception.model == accepted.model && exception.approval.is_some()
    }) {
        return Err("an owner ruling approved this model for this assignment");
    }
    Ok(Challenge {
        unattributed: Vec::new(),
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
    if !matches!(task.state, TaskState::Accepted | TaskState::Ready) {
        return Err("the task is not accepted or handed back for review");
    }
    let Some(role) = role else {
        return Err("no role memory is registered, so no lens is expected");
    };
    let required = if task.lenses.is_empty() {
        &role.lenses
    } else {
        &task.lenses
    };
    let Some(missing) = required.iter().find(|lens| {
        !role
            .knowledge_fingerprints
            .get(*lens)
            .is_some_and(|fingerprint| {
                task.assessments.iter().any(|entry| {
                    &entry.ruling == *lens && task::assessment_current(task, entry, fingerprint)
                })
            })
    }) else {
        return Err("every lens the task requires carries an assessment");
    };
    Ok(Challenge {
        unattributed: Vec::new(),
        class: Class::LensUnassessed,
        statement: format!(
            "I don't believe this hand-back was held against everything the role consults. {missing} has no assessment on it."
        ),
        evidence: vec![
            format!("state: {}", task.state.word()),
            if task.lenses.is_empty() {
                format!("role::{} consults: {}", task.role, role.lenses.join(", "))
            } else {
                format!("task requires lenses: {}", task.lenses.join(", "))
            },
            format!("assessments recorded: {}", task.assessments.len()),
        ],
        reconcile: include_str!("cli/text/skeptic-lens-unassessed.md").to_owned(),
    })
}

fn review_target_stale(task: &Task, role: Option<&Resolution>) -> Result<Challenge, &'static str> {
    let Some(target) = &task.review_of else {
        return Err("the task is not an explicit review");
    };
    if role.is_some_and(|role| role.review_current == Some(true)) {
        return Err("the review inspects the current target revision");
    }
    Ok(Challenge {
        unattributed: Vec::new(),
        class: Class::ReviewTargetStale,
        statement: format!(
            "Review {} no longer establishes approval of task {} at its current revision",
            task.name, target.task
        ),
        evidence: vec![format!(
            "reviewed revision: {}",
            target.revision.fingerprint()
        )],
        reconcile: format!(
            "Inspect task freshness {0}, then reaccept {0} to inspect the target again, record current evidence and assessments, challenge and hand back. A CLOSED review stays historical; open a new review task",
            task.name
        ),
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
        unattributed: Vec::new(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_class_has_one_detector_in_evaluation_order() {
        let expected = [
            (Class::UnobservableTaskInput, Ground::Task),
            (Class::WithdrawalResidue, Ground::Project),
            (Class::DeclaredCheckFailed, Ground::Task),
            (Class::DecisionUnanswered, Ground::Task),
            (Class::QuestionUnpicked, Ground::Task),
            (Class::UnresolvedFinding, Ground::Task),
            (Class::DeliverableUnchanged, Ground::Task),
            (Class::ScopeBreach, Ground::Task),
            (Class::WorkWithoutAcceptance, Ground::Task),
            (Class::ExceptionUnresolved, Ground::Task),
            (Class::ReadinessWithoutEvidence, Ground::Task),
            (Class::EvidenceSuperseded, Ground::Task),
            (Class::AttributionUnknown, Ground::Task),
            (Class::CheckNotFalsified, Ground::Task),
            (Class::ModelOutsideRolePolicy, Ground::Role),
            (Class::LensUnassessed, Ground::Role),
            (Class::ReviewTargetStale, Ground::Role),
            (Class::OrchestratorRecordDuringCarry, Ground::Task),
            (Class::GoalOutcomeUnmet, Ground::Goal),
            (Class::VacuousRule, Ground::Project),
            (Class::VerificationNotCurrent, Ground::Project),
        ];
        let table: Vec<(Class, Ground)> = DETECTORS
            .iter()
            .map(|detector| (detector.class, detector.ground))
            .collect();
        assert_eq!(table, expected.to_vec());
        let outside: Vec<Class> = DETECTORS
            .iter()
            .filter(|detector| detector.outside_the_assignment())
            .map(|detector| detector.class)
            .collect();
        assert_eq!(
            outside,
            vec![
                Class::WithdrawalResidue,
                Class::OrchestratorRecordDuringCarry,
                Class::GoalOutcomeUnmet,
                Class::VacuousRule,
                Class::VerificationNotCurrent,
            ]
        );
        for detector in DETECTORS {
            assert_eq!(
                serde_json::to_value(detector.class).expect("a class serializes"),
                detector.class.word()
            );
        }
    }
}
