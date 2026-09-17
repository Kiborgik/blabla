use crate::project::status::CompletionState;
use crate::project::task::{self, Task};
use crate::structure::falsify::FalsifyReport;
use serde::Serialize;
use std::collections::BTreeMap;

pub const AUTHORITY: &str = "A challenge is a question, never a verdict. It does not decide whether the work is correct, it grants no completion and withholds none, and blabla status and blabla finish remain the only authority over that.";

pub const LIMITS: [&str; 3] = [
    "Every challenge rests on evidence BlaBla already holds: the bounded task record, the working tree measured against it, and a rule verdict the falsifier produced. Nothing here is inferred from what an agent said it did.",
    "Silence is not approval. No challenge means no contradiction was reachable from that evidence, which is a statement about the evidence rather than about the work.",
    "BlaBla reads no meaning from source code. It cannot tell whether a branch is reachable, whether a name is the one you meant or whether a test asserts the thing it claims; a challenge about those never appears because it could not be grounded.",
];

pub const CLASSES: [&str; 5] = [
    "unresolved-finding",
    "deliverable-unchanged",
    "scope-breach",
    "vacuous-rule",
    "verification-not-current",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Class {
    UnresolvedFinding,
    DeliverableUnchanged,
    ScopeBreach,
    VacuousRule,
    VerificationNotCurrent,
}

impl Class {
    pub fn word(self) -> &'static str {
        match self {
            Class::UnresolvedFinding => CLASSES[0],
            Class::DeliverableUnchanged => CLASSES[1],
            Class::ScopeBreach => CLASSES[2],
            Class::VacuousRule => CLASSES[3],
            Class::VerificationNotCurrent => CLASSES[4],
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
}

const NO_TASK: &str = "no bounded task is open; blabla task open records one";
const NOT_REACHED: &str = "a stronger challenge already stands, so this was not evaluated";

pub fn challenge(evidence: &Evidence<'_>) -> ChallengeReport {
    let mut outcomes: Vec<(&'static str, Result<Challenge, &'static str>)> = Vec::new();
    match evidence.task {
        None => {
            for class in [CLASSES[0], CLASSES[1], CLASSES[2]] {
                outcomes.push((class, Err(NO_TASK)));
            }
        }
        Some(task) => {
            outcomes.push((CLASSES[0], unresolved_finding(task)));
            outcomes.push((CLASSES[1], deliverable_unchanged(task, evidence.tree)));
            outcomes.push((CLASSES[2], scope_breach(task, evidence.tree)));
        }
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
        .filter(|path| !task.in_scope(path))
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
