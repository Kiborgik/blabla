use super::ignore::Ignore;
use super::snapshot;
use super::status::RECORD_DIRECTORY;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub mod delivery;
pub mod effort;
pub mod revision;
pub mod store;

pub use revision::{RelevantRevision, relevant_revision};

pub const TASK_DIRECTORY: &str = "tasks";

pub const AUTHORITY: &str = include_str!("../cli/text/authority-task.md");

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Deliverable {
    pub path: String,
    pub opened_digest: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(from = "ResolutionRecord")]
pub struct FindingResolution {
    pub evidence: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ResolutionRecord {
    Evidence(String),
    Fields {
        evidence: String,
        #[serde(default)]
        model: Option<String>,
    },
}

impl From<ResolutionRecord> for FindingResolution {
    fn from(record: ResolutionRecord) -> FindingResolution {
        match record {
            ResolutionRecord::Evidence(evidence) => FindingResolution {
                evidence,
                model: None,
            },
            ResolutionRecord::Fields { evidence, model } => FindingResolution { evidence, model },
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Addressed {
    pub model: String,
    pub statement: String,
    pub unix: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Finding {
    pub id: usize,
    pub statement: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub addressed: Option<Addressed>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution: Option<FindingResolution>,
}

pub const DECISION_KINDS: [&str; 2] = ["yes-no", "choice"];

pub const YES_NO: [&str; 2] = ["yes", "no"];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Answer {
    pub pick: String,
    pub model: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Decision {
    pub id: usize,
    pub question: String,
    pub kind: String,
    pub options: Vec<String>,
    pub pick: String,
    pub confidence: u8,
    pub model: String,
    pub floor: u8,
    pub below_floor: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<Answer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<String>,
}

impl Decision {
    pub fn unanswered_below_floor(&self) -> bool {
        self.below_floor && self.answer.is_none()
    }

    pub fn current_pick(&self) -> &str {
        self.answer
            .as_ref()
            .map_or(&self.pick, |answer| &answer.pick)
    }

    pub fn current_status(&self) -> &'static str {
        if self.overruled() {
            "overruled"
        } else if self.answer.is_some() {
            "answered"
        } else if self.below_floor {
            "blocked"
        } else {
            "stands"
        }
    }

    pub fn overruled(&self) -> bool {
        self.answer
            .as_ref()
            .is_some_and(|answer| answer.pick != self.pick)
    }
}

pub struct Question {
    pub question: String,
    pub options: Vec<String>,
    pub pick: String,
    pub confidence: i64,
    pub model: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AskedQuestion {
    pub id: String,
    pub question: String,
    pub kind: String,
    pub options: Vec<String>,
    pub floor: u8,
    pub model: String,
}

pub struct Ask {
    pub question: String,
    pub options: Vec<String>,
    pub floor: Option<i64>,
    pub model: String,
}

pub struct Pick {
    pub on: String,
    pub pick: String,
    pub confidence: i64,
    pub model: String,
}

pub fn unanswered_decision(task: &Task) -> Option<&Decision> {
    task.decisions
        .iter()
        .find(|decision| decision.unanswered_below_floor())
}

pub fn picked_by<'a>(task: &'a Task, id: &str) -> Option<&'a Decision> {
    task.decisions
        .iter()
        .find(|decision| decision.on.as_deref() == Some(id))
}

pub fn floor_owner(task: &Task, decision: &Decision) -> String {
    let asked = decision
        .on
        .as_deref()
        .and_then(|id| task.questions.iter().find(|asked| asked.id == id));
    match asked {
        Some(asked) if asked.floor == decision.floor => format!("question {}", asked.id),
        _ => format!("role::{}", task.role),
    }
}

fn percentage(value: i64) -> Option<u8> {
    u8::try_from(value).ok().filter(|value| *value <= 100)
}

fn typed(options: Vec<String>) -> Result<(&'static str, Vec<String>), String> {
    let (kind, options) = if options.is_empty() {
        (DECISION_KINDS[0], YES_NO.map(str::to_owned).to_vec())
    } else {
        (DECISION_KINDS[1], options)
    };
    let mut distinct = options.clone();
    distinct.sort();
    distinct.dedup();
    if distinct.len() != options.len()
        || options.len() < 2
        || options.iter().any(|option| option.trim().is_empty())
    {
        return Err(format!(
            "the options {:?} must be at least two different, non-empty choices",
            options.join(",")
        ));
    }
    Ok((kind, options))
}

pub fn ask<'a>(
    task: &'a mut Task,
    asked: Ask,
    role_floor: u8,
    orchestrator: &[String],
) -> Result<&'a AskedQuestion, String> {
    if !task.open() {
        return Err(format!(
            "task {:?} is CLOSED; a question is asked of a task that is not closed",
            task.name
        ));
    }
    if !orchestrator.is_empty() && !orchestrator.contains(&asked.model) {
        return Err(format!(
            "model {:?} is not in role::orchestrator's permitted list: {}; only the orchestrator asks, and the carrying role picks with task decide --on",
            asked.model,
            orchestrator.join(", ")
        ));
    }
    if asked.question.trim().is_empty() {
        return Err("the question is empty; state the call you doubt".to_owned());
    }
    let (kind, options) = typed(asked.options)?;
    let floor = match asked.floor {
        None => role_floor,
        Some(stated) => {
            let Some(floor) = percentage(stated) else {
                return Err(format!(
                    "floor {stated} is outside 0..100; state it as a whole-number percentage"
                ));
            };
            if floor < role_floor {
                return Err(format!(
                    "floor {floor}% is below role::{}'s floor of {role_floor}%; a question can raise the floor its pick is measured against, never lower it",
                    task.role
                ));
            }
            floor
        }
    };
    task.questions.push(AskedQuestion {
        id: format!("q{}", task.questions.len() + 1),
        question: asked.question,
        kind: kind.to_owned(),
        options,
        floor,
        model: asked.model,
    });
    Ok(task.questions.last().expect("a question was just asked"))
}

pub fn pick(task: &mut Task, given: Pick, role_floor: u8) -> Result<&Decision, String> {
    let name = &task.name;
    let Some(asked) = task.questions.iter().find(|asked| asked.id == given.on) else {
        return Err(format!(
            "task {name:?} records no question {:?}; blabla task show {name} lists the questions the orchestrator asked",
            given.on
        ));
    };
    if let Some(decision) = picked_by(task, &asked.id) {
        return Err(format!(
            "question {} is already picked by decision {}: {} at {}%; a question is picked once, and the orchestrator reviews the pick with blabla task answer {name} {}",
            asked.id, decision.id, decision.pick, decision.confidence, decision.id
        ));
    }
    let question = Question {
        question: asked.question.clone(),
        options: if asked.kind == DECISION_KINDS[0] {
            Vec::new()
        } else {
            asked.options.clone()
        },
        pick: given.pick,
        confidence: given.confidence,
        model: given.model,
    };
    let floor = asked.floor.max(role_floor);
    let on = asked.id.clone();
    record_decision(task, question, floor, Some(on))
}

pub fn decide(task: &mut Task, asked: Question, floor: u8) -> Result<&Decision, String> {
    record_decision(task, asked, floor, None)
}

fn record_decision(
    task: &mut Task,
    asked: Question,
    floor: u8,
    on: Option<String>,
) -> Result<&Decision, String> {
    if let Some(blocking) = unanswered_decision(task) {
        return Err(format!(
            "task {:?} is BLOCKED on decision {}: {}; a blocked task takes no decision until the orchestrator answers it",
            task.name, blocking.id, blocking.question
        ));
    }
    if task.state != "accepted" || task.accepted.is_none() {
        return Err(format!(
            "task {:?} is {}; a decision is recorded once the task is accepted",
            task.name,
            task.state.to_ascii_uppercase()
        ));
    }
    if asked.question.trim().is_empty() {
        return Err("the question is empty; state the call you are unsure of".to_owned());
    }
    let (kind, options) = typed(asked.options)?;
    if !options.contains(&asked.pick) {
        return Err(format!(
            "pick {:?} is not one of the options: {}",
            asked.pick,
            options.join(", ")
        ));
    }
    let Some(confidence) = percentage(asked.confidence) else {
        return Err(format!(
            "confidence {} is outside 0..100; state it as a whole-number percentage",
            asked.confidence
        ));
    };
    let id = task
        .decisions
        .iter()
        .map(|decision| decision.id)
        .max()
        .unwrap_or(0)
        + 1;
    task.decisions.push(Decision {
        id,
        question: asked.question,
        kind: kind.to_owned(),
        options,
        pick: asked.pick,
        confidence,
        model: asked.model,
        floor,
        below_floor: confidence < floor,
        answer: None,
        on,
    });
    if confidence < floor {
        apply(task, "blocked");
    }
    Ok(task.decisions.last().expect("a decision was just recorded"))
}

pub fn answer(task: &mut Task, id: usize, given: Answer) -> Result<&Decision, String> {
    let name = task.name.clone();
    let Some(decision) = task.decisions.iter_mut().find(|decision| decision.id == id) else {
        return Err(format!("task {name:?} records no decision {id}"));
    };
    if !decision.options.contains(&given.pick) {
        return Err(format!(
            "pick {:?} is not one of decision {id}'s options: {}",
            given.pick,
            decision.options.join(", ")
        ));
    }
    if given.reason.trim().is_empty() {
        return Err(format!(
            "an answer to decision {id} needs a reason; the worker reads it before carrying on"
        ));
    }
    decision.answer = Some(given);
    Ok(decision)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Confirmation {
    pub model: String,
    pub unix: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrchestratorRecord {
    pub verb: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub unix: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub carried_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmed: Option<Confirmation>,
}

impl OrchestratorRecord {
    pub fn during_carry(&self) -> bool {
        self.carried_by.is_some()
    }

    pub fn unconfirmed(&self) -> bool {
        self.during_carry() && self.confirmed.is_none()
    }
}

pub fn carrier(task: &Task) -> Option<&str> {
    if task.state != "accepted" {
        return None;
    }
    task.accepted
        .as_ref()
        .map(|acceptance| acceptance.model.as_str())
}

pub fn attest(task: &mut Task, verb: &str, model: Option<&str>, unix: u64) {
    let carried_by = carrier(task)
        .filter(|_| task.role != ORCHESTRATOR_ROLE)
        .map(str::to_owned);
    task.orchestrator_records.push(OrchestratorRecord {
        verb: verb.to_owned(),
        model: model.map(str::to_owned),
        unix,
        carried_by,
        confirmed: None,
    });
}

pub fn confirm(task: &mut Task, model: &str, unix: u64) -> Result<usize, String> {
    if let Some(carrier) = carrier(task) {
        return Err(format!(
            "task {:?} is carried by {carrier}, and the carrying role cannot confirm records from its own carry; the orchestrator confirms them after {carrier} hands the task back with task ready or task block",
            task.name
        ));
    }
    let mut confirmed = 0;
    for record in task
        .orchestrator_records
        .iter_mut()
        .filter(|record| record.unconfirmed())
    {
        record.confirmed = Some(Confirmation {
            model: model.to_owned(),
            unix,
        });
        confirmed += 1;
    }
    Ok(confirmed)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Calibration {
    pub model: String,
    pub answered: usize,
    pub held: usize,
    pub overruled: usize,
    pub mean_confidence: u8,
    pub asked: usize,
}

pub fn calibration(tasks: &[Task], model_named_by: impl Fn(&str) -> String) -> Vec<Calibration> {
    let mut models: BTreeMap<String, (usize, usize, u64, usize)> = BTreeMap::new();
    for decision in tasks.iter().flat_map(|task| &task.decisions) {
        if decision.answer.is_none() {
            continue;
        }
        let entry = models.entry(model_named_by(&decision.model)).or_default();
        entry.0 += 1;
        if !decision.overruled() {
            entry.1 += 1;
        }
        entry.2 += u64::from(decision.confidence);
        if decision.on.is_some() {
            entry.3 += 1;
        }
    }
    models
        .into_iter()
        .map(|(model, (answered, held, stated, asked))| Calibration {
            model,
            answered,
            held,
            overruled: answered - held,
            mean_confidence: u8::try_from((stated + answered as u64 / 2) / answered as u64)
                .unwrap_or(100),
            asked,
        })
        .collect()
}

pub const STATES: [&str; 6] = [
    "open",
    "accepted",
    "blocked",
    "ready",
    "closed",
    "withdrawn",
];

pub const SCRATCH_DIRECTORY: &str = "scratch";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Acceptance {
    pub model: String,
    pub unix: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_at_acceptance: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Assessment {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acceptance_epoch: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub knowledge_fingerprint: Option<String>,
    pub ruling: String,
    pub statement: String,
    pub unix: u64,
}

pub fn knowledge_fingerprint(
    memory: &crate::memory::knowledge::KnowledgeMemory,
    name: &str,
) -> Option<String> {
    let pack = memory.packs.iter().find(|pack| pack.name == name)?;
    let rulings: BTreeMap<_, _> = memory
        .rulings
        .iter()
        .filter(|ruling| ruling.pack == name)
        .map(|ruling| (ruling.id(), ruling))
        .collect();
    let mut hash = super::Fnv::new();
    hash.write_str("task-memory-v1");
    hash.write_str(&serde_json::to_string(&(pack, rulings)).expect("knowledge serializes"));
    Some(hash.finish())
}

pub fn assessment_current(
    task: &Task,
    assessment: &Assessment,
    knowledge_fingerprint: &str,
) -> bool {
    task.accepted
        .as_ref()
        .is_some_and(|accepted| assessment.model.as_deref() == Some(&accepted.model))
        && assessment.acceptance_epoch == Some(task.acceptance_epoch)
        && assessment.knowledge_fingerprint.as_deref() == Some(knowledge_fingerprint)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewTarget {
    pub task: String,
    pub revision: RelevantRevision,
}

fn work_under_review(reviewed: &Task) -> Task {
    let mut work = reviewed.clone();
    work.findings = work
        .findings
        .into_iter()
        .filter(|finding| finding.addressed.is_some())
        .map(|finding| Finding {
            resolution: None,
            ..finding
        })
        .collect();
    work
}

pub fn review_revision(
    review: &Task,
    reviewed: &Task,
    tree: &BTreeMap<String, String>,
    identities: BTreeMap<String, String>,
) -> RelevantRevision {
    let mut revision = relevant_revision(&work_under_review(reviewed), tree, identities);
    if reviewed.intent_disposition_required || !reviewed.intent_dispositions.is_empty() {
        let mut fingerprint = super::Fnv::new();
        fingerprint.write_str(&revision.task_digest);
        fingerprint.write_str(
            &serde_json::to_string(&(
                reviewed.intent_disposition_required,
                &reviewed.intent_identities,
                &reviewed.intent_dispositions,
            ))
            .expect("intent dispositions serialize"),
        );
        revision.task_digest = fingerprint.finish();
    }
    if reviewed.goal_reflection_required || reviewed.goal_reflection.is_some() {
        let mut fingerprint = super::Fnv::new();
        fingerprint.write_str(&revision.task_digest);
        fingerprint.write_str(
            &serde_json::to_string(&(reviewed.goal_reflection_required, &reviewed.goal_reflection))
                .expect("goal reflection serializes"),
        );
        revision.task_digest = fingerprint.finish();
    }
    if !reviewed.delivery_obligations.is_empty() || !reviewed.delivery_reviews.is_empty() {
        let mut fingerprint = super::Fnv::new();
        fingerprint.write_str(&revision.task_digest);
        fingerprint.write_str(
            &serde_json::to_string(&(&reviewed.delivery_obligations, &reviewed.delivery_reviews))
                .expect("delivery records serialize"),
        );
        revision.task_digest = fingerprint.finish();
    }
    for input in &review.check_inputs {
        revision
            .paths
            .insert(input.clone(), observed_digest(tree, input));
    }
    revision
}

pub fn review_current(
    review: &Task,
    reviewed: &Task,
    tree: &BTreeMap<String, String>,
    identities: BTreeMap<String, String>,
) -> bool {
    review.accepted.is_some()
        && reviewed.state != "withdrawn"
        && review.name != reviewed.name
        && review
            .review_of
            .iter()
            .chain(&review.delivery_review_targets)
            .any(|target| {
                target.task == reviewed.name
                    && target.revision
                        == review_revision(review, reviewed, tree, identities.clone())
            })
}

pub const INTENT_DISPOSITIONS: [&str; 2] = ["updated", "confirmed-unchanged"];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentDisposition {
    pub identity: String,
    pub status: String,
    pub reason: String,
    pub model: String,
    pub unix: u64,
    pub revision: RelevantRevision,
}

pub fn intent_revision(
    task: &Task,
    tree: &BTreeMap<String, String>,
    identities: BTreeMap<String, String>,
) -> RelevantRevision {
    let mut revision = relevant_revision(task, tree, identities);
    for path in &task.scope {
        revision
            .paths
            .insert(path.clone(), observed_digest(tree, path));
    }
    revision
}

pub fn disposition_current(task: &Task, identity: &str, revision: &RelevantRevision) -> bool {
    task.intent_dispositions
        .iter()
        .rev()
        .find(|entry| entry.identity == identity)
        .is_some_and(|entry| {
            entry.revision == *revision
                && task
                    .accepted
                    .as_ref()
                    .is_some_and(|accepted| accepted.model == entry.model)
                && INTENT_DISPOSITIONS.contains(&entry.status.as_str())
                && !entry.reason.trim().is_empty()
        })
}

pub fn record_disposition(task: &mut Task, disposition: IntentDisposition) -> Result<(), String> {
    write_disposition(task, disposition, "accepted")
}

pub fn refresh_ready_disposition(
    task: &mut Task,
    disposition: IntentDisposition,
) -> Result<(), String> {
    write_disposition(task, disposition, "ready")
}

fn write_disposition(
    task: &mut Task,
    disposition: IntentDisposition,
    state: &str,
) -> Result<(), String> {
    if !task.intent_disposition_required {
        return Err("this task did not opt into required affected-intent disposition".to_owned());
    }
    if task.state != state
        || !task
            .accepted
            .as_ref()
            .is_some_and(|accepted| accepted.model == disposition.model)
    {
        return Err(format!(
            "an intent disposition must be recorded by the task's accepted model while it is {}",
            state.to_uppercase()
        ));
    }
    if !disposition
        .revision
        .identities
        .contains_key(&disposition.identity)
    {
        return Err(format!(
            "{} is not an affected intent identity of this task",
            disposition.identity
        ));
    }
    if !INTENT_DISPOSITIONS.contains(&disposition.status.as_str()) {
        return Err("intent status must be updated or confirmed-unchanged".to_owned());
    }
    if disposition.reason.trim().is_empty() {
        return Err("an intent disposition needs a concrete reason naming relevant implementation or evidence".to_owned());
    }
    task.intent_identities
        .extend(disposition.revision.identities.keys().cloned());
    task.intent_dispositions.push(disposition);
    task.challenged = None;
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum GoalReflectionOutcome {
    Successor {
        recommendation: String,
        owner: String,
        dependencies: Vec<String>,
        observable_outcome: String,
    },
    Blocked {
        blocker: String,
        owner: String,
        unblock_when: String,
    },
    CompletionRecommended,
    NoUsefulSuccessor,
}

impl GoalReflectionOutcome {
    pub fn word(&self) -> &'static str {
        match self {
            Self::Successor { .. } => "successor",
            Self::Blocked { .. } => "blocked",
            Self::CompletionRecommended => "completion-recommended",
            Self::NoUsefulSuccessor => "no-useful-successor",
        }
    }

    fn complete(&self) -> bool {
        let nonblank = |value: &str| !value.trim().is_empty();
        match self {
            Self::Successor {
                recommendation,
                owner,
                dependencies,
                observable_outcome,
            } => {
                nonblank(recommendation)
                    && nonblank(owner)
                    && nonblank(observable_outcome)
                    && dependencies.iter().all(|value| nonblank(value))
            }
            Self::Blocked {
                blocker,
                owner,
                unblock_when,
            } => nonblank(blocker) && nonblank(owner) && nonblank(unblock_when),
            Self::CompletionRecommended | Self::NoUsefulSuccessor => true,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GoalReflection {
    pub decision: String,
    pub observation: String,
    pub evidence_refs: Vec<String>,
    pub reason: String,
    pub outcome: GoalReflectionOutcome,
    pub model: String,
    pub unix: u64,
    pub revision: RelevantRevision,
}

impl GoalReflection {
    fn complete(&self) -> bool {
        [&self.decision, &self.observation, &self.reason]
            .iter()
            .all(|value| !value.trim().is_empty())
            && !self.evidence_refs.is_empty()
            && self
                .evidence_refs
                .iter()
                .all(|value| !value.trim().is_empty())
            && self.outcome.complete()
    }
}

pub fn goal_reflection_revision(
    task: &Task,
    tree: &BTreeMap<String, String>,
    identities: BTreeMap<String, String>,
) -> RelevantRevision {
    let mut revision = intent_revision(task, tree, identities);
    let mut fingerprint = super::Fnv::new();
    fingerprint.write_str(&revision.task_digest);
    fingerprint.write_str(
        &serde_json::to_string(&(
            task.goal_reflection_required,
            latest_evidence(task),
            task.intent_disposition_required,
            &task.intent_dispositions,
        ))
        .expect("reflection inputs serialize"),
    );
    revision.task_digest = fingerprint.finish();
    revision
}

pub fn goal_reflection_current(task: &Task, revision: &RelevantRevision) -> bool {
    task.goal
        .as_ref()
        .is_some_and(|goal| !goal.trim().is_empty())
        && task.goal_reflection.as_ref().is_some_and(|reflection| {
            reflection.revision == *revision
                && reflection.complete()
                && task
                    .accepted
                    .as_ref()
                    .is_some_and(|accepted| accepted.model == reflection.model)
        })
}

pub fn record_goal_reflection(task: &mut Task, reflection: GoalReflection) -> Result<(), String> {
    write_goal_reflection(task, reflection, "accepted")
}

pub fn refresh_ready_goal_reflection(
    task: &mut Task,
    reflection: GoalReflection,
) -> Result<(), String> {
    write_goal_reflection(task, reflection, "ready")
}

fn write_goal_reflection(
    task: &mut Task,
    reflection: GoalReflection,
    state: &str,
) -> Result<(), String> {
    if !task.goal_reflection_required || task.goal.is_none() {
        return Err("goal reflection requires an opted-in task with a named goal".to_owned());
    }
    if task.state != state
        || !task
            .accepted
            .as_ref()
            .is_some_and(|accepted| accepted.model == reflection.model)
    {
        return Err(format!(
            "a goal reflection must be recorded by the task's accepted model while it is {}",
            state.to_uppercase()
        ));
    }
    if !reflection.complete() {
        return Err("a goal reflection needs a concrete decision, observation, evidence reference, causal reason and every field of its outcome".to_owned());
    }
    if state == "ready" {
        task.intent_identities
            .extend(reflection.revision.identities.keys().cloned());
    }
    task.goal_reflection = Some(reflection);
    task.challenged = None;
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Exception {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acceptance_epoch: Option<u64>,
    #[serde(default)]
    pub superseded: bool,
    pub model: String,
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CheckIdentity {
    Text { command: String },
    Argv { argv: Vec<String> },
}

pub fn declared_check(task: &Task) -> Option<CheckIdentity> {
    match (&task.check_argv, &task.check) {
        (Some(argv), _) => Some(CheckIdentity::Argv { argv: argv.clone() }),
        (None, Some(command)) => Some(CheckIdentity::Text {
            command: command.clone(),
        }),
        (None, None) => None,
    }
}

pub fn evidence_matches(task: &Task, evidence: &Evidence) -> bool {
    if evidence.acceptance_epoch != Some(task.acceptance_epoch) {
        return false;
    }
    match (declared_check(task), evidence.identity.as_ref()) {
        (
            Some(CheckIdentity::Argv { argv: declared }),
            Some(CheckIdentity::Argv { argv: observed }),
        ) => declared == *observed && evidence.command.as_ref() == Some(observed),
        (
            Some(CheckIdentity::Text { command: declared }),
            Some(CheckIdentity::Text { command: observed }),
        ) => declared == *observed && evidence.check == *observed && evidence.command.is_none(),
        _ => false,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceReuse {
    pub original_index: usize,
    pub original_digest: String,
    pub original_epoch: u64,
    pub original_log_digest: String,
    pub model: String,
    pub reason: String,
    pub unix: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Evidence {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reuse: Option<EvidenceReuse>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<CheckIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acceptance_epoch: Option<u64>,
    pub check: String,
    pub exit: i32,
    pub tree: String,
    pub tool: String,
    pub unix: u64,
    #[serde(default)]
    pub inputs: BTreeMap<String, Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_member_manifest"
    )]
    pub member_manifest: Option<serde_json::Value>,
}

fn deserialize_member_manifest<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<serde_json::Value>, D::Error> {
    serde_json::Value::deserialize(deserializer).map(Some)
}

const EVIDENCE_MEMBER_BASIS: &str = "tracked-input-snapshot-v1";
const EVIDENCE_MEMBER_LIMIT: usize = 8192;
const EVIDENCE_MEMBER_PATH_BYTES: usize = 4096;
const EVIDENCE_MEMBER_PAYLOAD_BYTES: usize = 1_048_576;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EvidenceMemberEnvelope {
    basis: String,
    capture: String,
    availability: String,
    member_count: usize,
    #[serde(default)]
    members: Option<BTreeMap<String, String>>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug)]
pub struct EvidenceMemberBaseline {
    pub members: BTreeMap<String, String>,
    pub capture: &'static str,
}

fn member_payload_fits(value: &serde_json::Value) -> bool {
    struct Budget(usize);
    impl std::io::Write for Budget {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_sub(bytes.len())
                .ok_or_else(|| std::io::Error::other("member payload limit"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(Budget(EVIDENCE_MEMBER_PAYLOAD_BYTES), value).is_ok()
}

fn valid_member(path: &str, digest: &str) -> bool {
    !path.is_empty()
        && !path.contains('\0')
        && !Path::new(path).is_absolute()
        && Path::new(path)
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_)))
        && path.split('/').all(|part| !matches!(part, "" | "." | ".."))
        && digest.len() == 16
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn capture_evidence_members(
    inputs: &BTreeMap<String, Option<String>>,
    tree: &BTreeMap<String, String>,
    capture: &str,
) -> serde_json::Value {
    let selected = || {
        tree.iter()
            .filter(|(path, _)| inputs.keys().any(|root| covers(root, path)))
    };
    let member_count = selected().count();
    let unavailable = |reason: &str| {
        serde_json::json!({
            "basis": EVIDENCE_MEMBER_BASIS, "capture": capture,
            "availability": "unavailable", "reason": reason, "member_count": member_count
        })
    };
    if member_count > EVIDENCE_MEMBER_LIMIT {
        return unavailable("member-limit");
    }
    if selected().any(|(path, _)| path.len() > EVIDENCE_MEMBER_PATH_BYTES) {
        return unavailable("path-limit");
    }
    if selected().any(|(path, digest)| !valid_member(path, digest)) {
        return unavailable("invalid-member");
    }
    let members: BTreeMap<_, _> = selected().collect();
    let complete = serde_json::json!({
        "basis": EVIDENCE_MEMBER_BASIS, "capture": capture,
        "availability": "complete", "member_count": member_count, "members": members
    });
    if member_payload_fits(&complete) {
        complete
    } else {
        unavailable("byte-limit")
    }
}

pub fn evidence_member_baseline(
    evidence: &Evidence,
) -> Result<EvidenceMemberBaseline, &'static str> {
    let raw = evidence.member_manifest.as_ref().ok_or("legacy-absent")?;
    if !member_payload_fits(raw) {
        return Err("byte-limit");
    }
    let envelope: EvidenceMemberEnvelope =
        serde_json::from_value(raw.clone()).map_err(|_| "malformed-manifest")?;
    if envelope.basis != EVIDENCE_MEMBER_BASIS {
        return Err("unsupported-basis");
    }
    let capture = match envelope.capture.as_str() {
        "execution-start" => "execution-start",
        "manual-record" => "manual-record",
        _ => return Err("unsupported-capture"),
    };
    if envelope.availability == "unavailable" && envelope.members.is_none() {
        return Err(match envelope.reason.as_deref() {
            Some("member-limit") => "member-limit",
            Some("path-limit") => "path-limit",
            Some("byte-limit") => "byte-limit",
            Some("invalid-member") => "invalid-member",
            _ => "malformed-manifest",
        });
    }
    if envelope.availability != "complete" || envelope.reason.is_some() {
        return Err("malformed-manifest");
    }
    let members = envelope.members.ok_or("malformed-manifest")?;
    if members.len() > EVIDENCE_MEMBER_LIMIT {
        return Err("member-limit");
    }
    if members.len() != envelope.member_count {
        return Err("member-count-mismatch");
    }
    for (path, digest) in &members {
        if path.len() > EVIDENCE_MEMBER_PATH_BYTES {
            return Err("path-limit");
        }
        if !valid_member(path, digest) {
            return Err("invalid-member");
        }
        if !evidence.inputs.keys().any(|root| covers(root, path)) {
            return Err("member-outside-inputs");
        }
    }
    if evidence
        .inputs
        .iter()
        .any(|(root, digest)| observed_digest(&members, root) != *digest)
    {
        return Err("input-digest-mismatch");
    }
    Ok(EvidenceMemberBaseline { members, capture })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Falsification {
    pub acceptance_epoch: u64,
    pub check: String,
    pub current_exit: i32,
    pub current_log: String,
    pub opened_exit: Option<i32>,
    pub opened_log: Option<String>,
    pub unix: u64,
    pub inputs: BTreeMap<String, Option<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChallengeReceipt {
    pub fingerprint: String,
    pub unix: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Note {
    pub statement: String,
    pub unix: u64,
}

pub const ATTRIBUTIONS: [&str; 3] = ["task", "concurrent", "unknown"];

pub const ORCHESTRATOR_ROLE: &str = "orchestrator";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Attribution {
    pub path: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Resolution {
    pub delivery_claims_pending: Vec<String>,
    pub knowledge_fingerprints: BTreeMap<String, String>,
    pub review_current: Option<bool>,
    pub intent_disposition_pending: Option<Vec<String>>,
    pub goal_reflection_current: Option<bool>,
    pub models: Vec<String>,
    pub lenses: Vec<String>,
    pub requirements: Vec<String>,
    pub verification: String,
}

pub fn resolve(
    task: &Task,
    models: &[String],
    lenses: &[String],
    verification: &str,
    contracts: &[(String, Vec<String>)],
) -> Resolution {
    let requirements = contracts
        .iter()
        .filter(|(_, modules)| {
            modules
                .iter()
                .any(|module| task.scope.iter().any(|allowed| covers(allowed, module)))
        })
        .map(|(identity, _)| identity.clone())
        .collect();
    Resolution {
        delivery_claims_pending: Vec::new(),
        knowledge_fingerprints: BTreeMap::new(),
        review_current: None,
        intent_disposition_pending: None,
        goal_reflection_current: None,
        models: models.to_vec(),
        lenses: lenses.to_vec(),
        requirements,
        verification: verification.to_owned(),
    }
}

fn honoured(entry: &Attribution, tree: &BTreeMap<String, String>, path: &str) -> bool {
    entry.path != path || entry.digest.as_deref() == tree.get(path).map(String::as_str)
}

pub fn attribute(task: &Task, tree: &BTreeMap<String, String>, path: &str) -> String {
    if let Some(declared) = task
        .attributions
        .iter()
        .rev()
        .find(|entry| covers(&entry.path, path) && honoured(entry, tree, path))
    {
        return declared.kind.clone();
    }
    if task.in_scope(path) {
        return ATTRIBUTIONS[0].to_owned();
    }
    ATTRIBUTIONS[2].to_owned()
}

pub fn stale(evidence: &Evidence, tree: &BTreeMap<String, String>) -> bool {
    evidence
        .inputs
        .iter()
        .any(|(path, digest)| observed_digest(tree, path) != *digest)
}

pub fn declared_inputs(task: &Task) -> &[String] {
    if task.check_inputs.is_empty() {
        task.scope.as_slice()
    } else {
        task.check_inputs.as_slice()
    }
}

pub fn evidence_inputs(
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> BTreeMap<String, Option<String>> {
    declared_inputs(task)
        .iter()
        .chain(
            task.deliverables
                .iter()
                .map(|deliverable| &deliverable.path),
        )
        .map(|path| (path.clone(), observed_digest(tree, path)))
        .collect()
}

pub fn observed_digest(tree: &BTreeMap<String, String>, path: &str) -> Option<String> {
    if let Some(digest) = tree.get(path) {
        return Some(digest.clone());
    }
    let mut fingerprint = super::Fnv::new();
    let mut found = false;
    for (name, digest) in tree {
        if covers(path, name) {
            found = true;
            fingerprint.write_str(name);
            fingerprint.write_str(digest);
        }
    }
    found.then(|| fingerprint.finish())
}

#[derive(Clone, Debug, Serialize)]
pub struct Readiness {
    pub recorded: bool,
    pub current: bool,
    pub answers_declared_check: bool,
    pub supported: bool,
}

pub fn latest_evidence(task: &Task) -> Option<&Evidence> {
    task.evidence
        .iter()
        .rev()
        .find(|entry| evidence_matches(task, entry))
}

pub fn readiness(task: &Task, tree: &BTreeMap<String, String>) -> Readiness {
    let recorded = !task.evidence.is_empty();
    let latest = latest_evidence(task);
    let answers_declared_check = latest.is_some_and(|entry| entry.exit == 0);
    let current = latest.is_some_and(|entry| evidence_inputs(task, tree) == entry.inputs);
    Readiness {
        recorded,
        current,
        answers_declared_check,
        supported: recorded && current && answers_declared_check,
    }
}

pub fn transition(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("open", "accepted")
            | ("accepted", "accepted")
            | ("accepted", "blocked")
            | ("accepted", "ready")
            | ("blocked", "accepted")
            | ("ready", "accepted")
            | ("ready", "closed")
    )
}

pub fn apply(task: &mut Task, to: &str) -> bool {
    if to == "ready"
        || !transition(&task.state, to)
        || (to == "accepted" && unanswered_decision(task).is_some())
    {
        return false;
    }
    task.state = to.to_owned();
    if matches!(to, "accepted" | "blocked") {
        task.challenged = None;
    }
    true
}

fn challenge_fingerprint(task: &Task, tree: &BTreeMap<String, String>) -> String {
    let mut record = task.clone();
    record.work_intervals.clear();
    record.challenged = None;
    record.state.clear();
    record.closed_unix = None;
    record.closed_paths.clear();
    record.result = None;
    record.result_basis = None;
    record.build = None;
    record
        .findings
        .retain(|finding| finding.resolution.is_none() || finding.addressed.is_some());
    for finding in &mut record.findings {
        finding.resolution = None;
    }
    for decision in &mut record.decisions {
        decision.answer = None;
    }
    record.notes.clear();
    record.orchestrator_records.clear();
    record
        .attributions
        .retain(|attr| attr.kind != ATTRIBUTIONS[1]);
    let mut fingerprint = super::Fnv::new();
    fingerprint.write_str(&serde_json::to_string(&record).expect("task serializes"));
    for (path, digest) in tree {
        if receipt_covers(task, tree, path) {
            fingerprint.write_str(path);
            fingerprint.write_str(digest);
        }
    }
    fingerprint.finish()
}

pub fn receipt_covers(task: &Task, tree: &BTreeMap<String, String>, path: &str) -> bool {
    if attribute(task, tree, path) == ATTRIBUTIONS[1] {
        return false;
    }
    task.in_scope(path)
        || task.check_inputs.iter().any(|input| covers(input, path))
        || task
            .deliverables
            .iter()
            .any(|deliverable| covers(&deliverable.path, path))
        || task
            .attributions
            .iter()
            .any(|entry| covers(&entry.path, path))
}

pub fn handback(task: &Task, tree: &BTreeMap<String, String>) -> Result<(), &'static str> {
    if task.open() && unanswered_decision(task).is_some() {
        return Err("await-answer");
    }
    match task.state.as_str() {
        "open" | "blocked" => return Err("accept"),
        "ready" => return Err("review"),
        "closed" | "withdrawn" => return Err("closed"),
        "accepted" => {}
        _ => return Err("invalid-state"),
    }
    if task.accepted.is_none() {
        return Err("accept");
    }
    if task.unpicked().next().is_some() {
        return Err("pick-question");
    }
    if !task.declares_check() {
        return Err("declare-check");
    }
    if !readiness(task, tree).supported {
        return Err("record-evidence");
    }
    if !challenge_current(task, tree) {
        return Err("challenge");
    }
    Ok(())
}

pub fn challenge_current(task: &Task, tree: &BTreeMap<String, String>) -> bool {
    task.challenged
        .as_ref()
        .is_some_and(|receipt| receipt.fingerprint == challenge_fingerprint(task, tree))
}

pub fn record_challenge(
    task: &mut Task,
    tree: &BTreeMap<String, String>,
    blockers: usize,
    unix: u64,
) -> bool {
    if !matches!(task.state.as_str(), "accepted" | "ready") {
        return false;
    }
    task.challenged = None;
    if task.accepted.is_none()
        || !task.declares_check()
        || !readiness(task, tree).supported
        || blockers != 0
    {
        return false;
    }
    task.challenged = Some(ChallengeReceipt {
        fingerprint: challenge_fingerprint(task, tree),
        unix,
    });
    true
}

pub fn mark_ready(
    task: &mut Task,
    tree: &BTreeMap<String, String>,
    blockers: usize,
) -> Result<(), &'static str> {
    handback(task, tree)?;
    if blockers != 0 {
        return Err("resolve-challenge");
    }
    task.state = "ready".to_owned();
    Ok(())
}

pub fn record_acceptance(
    task: &mut Task,
    tree: &BTreeMap<String, String>,
    ignore: &Ignore,
    model: &str,
    unix: u64,
) {
    let replacement = task
        .accepted
        .as_ref()
        .is_some_and(|accepted| accepted.model != model);
    for exception in &mut task.exceptions {
        if exception.approval.is_none() && !exception.superseded {
            if replacement && exception.acceptance_epoch.is_some() && exception.model != model {
                exception.superseded = true;
            } else {
                exception.acceptance_epoch = Some(task.acceptance_epoch + 1);
            }
        }
    }
    task.acceptance_epoch = task
        .acceptance_epoch
        .checked_add(1)
        .expect("acceptance epoch exhausted");
    let changed_paths = changed(task, tree, ignore);
    let changed_at_acceptance = if changed_paths.is_empty() {
        None
    } else {
        Some(changed_paths.iter().map(|s| s.to_string()).collect())
    };
    task.accepted = Some(Acceptance {
        model: model.to_owned(),
        unix,
        changed_at_acceptance,
    });
}

pub fn accept_result(
    task: &mut Task,
    tree: &BTreeMap<String, String>,
    ignore: &Ignore,
    standing: usize,
    model: &str,
    now_unix: u64,
) -> bool {
    if standing != 0
        || !readiness(task, tree).supported
        || !challenge_current(task, tree)
        || !apply(task, "closed")
    {
        return false;
    }
    task.result = Some(Acceptance {
        model: model.to_owned(),
        unix: now_unix,
        changed_at_acceptance: None,
    });
    task.closed_unix = Some(now_unix);
    let paths_changed: Vec<String> = changed(task, tree, ignore)
        .into_iter()
        .map(|s| s.to_owned())
        .collect();
    for path in paths_changed {
        if let Some(digest) = observed_digest(tree, &path) {
            task.closed_paths.insert(path, digest);
        }
    }
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RemovedDeliverable {
    pub path: String,
    pub reason: String,
    pub unix: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Withdrawal {
    pub reason: String,
    pub model: String,
    pub unix: u64,
    pub unresolved_paths: BTreeMap<String, Option<String>>,
    #[serde(default)]
    pub reconciliations: Vec<WithdrawalReconciliation>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WithdrawalReconciliation {
    pub path: String,
    pub successor: String,
    pub revision: revision::RelevantRevision,
    pub model: String,
    pub unix: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub successor_closed_unix: Option<u64>,
}

pub fn withdraw(
    task: &mut Task,
    tree: &BTreeMap<String, String>,
    ignore: &Ignore,
    reason: &str,
    model: &str,
    unix: u64,
) -> Result<(), String> {
    if !task.open() || reason.trim().is_empty() {
        return Err("withdrawal requires a nonterminal task and a nonempty reason".to_owned());
    }
    let unresolved_paths = changed(task, tree, ignore)
        .into_iter()
        .filter(|path| task.in_scope(path) || attribute(task, tree, path) == ATTRIBUTIONS[0])
        .map(|path| (path.to_owned(), observed_digest(tree, path)))
        .collect();
    task.withdrawal = Some(Withdrawal {
        reason: reason.to_owned(),
        model: model.to_owned(),
        unix,
        unresolved_paths,
        reconciliations: Vec::new(),
    });
    task.state = "withdrawn".to_owned();
    task.result = None;
    task.result_basis = None;
    task.closed_unix = None;
    task.closed_paths.clear();
    task.challenged = None;
    Ok(())
}

pub fn successor_revision(
    task: &Task,
    tree: &BTreeMap<String, String>,
    path: &str,
) -> revision::RelevantRevision {
    let mut revision = revision::relevant_revision(task, tree, BTreeMap::new());
    let mut fingerprint = super::Fnv::new();
    fingerprint.write_str("withdrawal-successor-v1");
    fingerprint.write_str(
        &serde_json::to_string(&(
            revision.task_digest,
            &task.accepted,
            &task.result,
            &task.evidence,
            &task.challenged,
        ))
        .expect("successor serializes"),
    );
    revision.task_digest = fingerprint.finish();
    revision
        .paths
        .insert(path.to_owned(), observed_digest(tree, path));
    revision
}

pub fn successor_covers(task: &Task, path: &str) -> bool {
    declared_inputs(task)
        .iter()
        .any(|input| covers(input, path))
        || task
            .deliverables
            .iter()
            .any(|deliverable| covers(&deliverable.path, path))
}

pub fn covered(task: &Task, path: &str) -> bool {
    task.in_scope(path)
        || successor_covers(task, path)
        || task
            .attributions
            .iter()
            .any(|attribution| covers(&attribution.path, path))
}

pub fn successful_successor(task: &Task, tree: &BTreeMap<String, String>, path: &str) -> bool {
    task.state == "closed"
        && task.result.is_some()
        && readiness(task, tree).supported
        && challenge_current(task, tree)
        && successor_covers(task, path)
}

pub fn withdrawal_residue(
    task: &Task,
    tasks: &[Task],
    tree: &BTreeMap<String, String>,
) -> Vec<String> {
    withdrawal_residue_by(task, tasks, tree, |_| true)
}

pub fn tracked_withdrawal_residue(
    task: &Task,
    tasks: &[Task],
    tree: &BTreeMap<String, String>,
    root: &Path,
    ignore: &Ignore,
) -> Vec<String> {
    withdrawal_residue_by(task, tasks, tree, |successor| {
        tracking_error(successor, root, ignore).is_none()
    })
}

fn withdrawal_residue_by(
    task: &Task,
    tasks: &[Task],
    tree: &BTreeMap<String, String>,
    observable: impl Fn(&Task) -> bool,
) -> Vec<String> {
    let Some(withdrawal) = &task.withdrawal else {
        return Vec::new();
    };
    withdrawal
        .unresolved_paths
        .keys()
        .filter(|path| {
            if observed_digest(tree, path) == observed_digest(&task.opened_tree, path) {
                return false;
            }
            !withdrawal.reconciliations.iter().any(|record| {
                record.path == **path
                    && tasks.iter().any(|successor| {
                        successor.name == record.successor
                            && observable(successor)
                            && reconciliation_stands(record, successor, tree, path)
                    })
            })
        })
        .cloned()
        .collect()
}

fn reconciliation_stands(
    record: &WithdrawalReconciliation,
    successor: &Task,
    tree: &BTreeMap<String, String>,
    path: &str,
) -> bool {
    match record.successor_closed_unix {
        Some(closed_unix) => {
            successor.state == "closed" && successor.closed_unix == Some(closed_unix)
        }
        None => {
            successful_successor(successor, tree, path)
                && successor_revision(successor, tree, path) == record.revision
                && record.revision.paths.get(path) == Some(&observed_digest(tree, path))
        }
    }
}

pub fn normalize_scope(root: &Path, path: &str) -> Result<String, String> {
    let path = path.replace('\\', "/");
    if path.starts_with('/') || path.as_bytes().get(1) == Some(&b':') {
        return Err(format!("write scope {path:?} must be project-relative"));
    }
    let mut components = Vec::new();
    let mut current = root.to_path_buf();
    for component in path.split('/') {
        if component.is_empty() || component == "." {
            continue;
        }
        if component == ".." || component.contains('\0') {
            return Err(format!(
                "write scope {path:?} contains an invalid component"
            ));
        }
        if components.is_empty() && component.as_bytes().get(1) == Some(&b':') {
            return Err(format!("write scope {path:?} must be project-relative"));
        }
        current.push(component);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!("write scope {path:?} traverses a symlink"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("cannot inspect write scope {path:?}: {error}")),
        }
        components.push(component);
    }
    if components.is_empty() {
        return Err("write scope must name a project path".to_owned());
    }
    let normalized = components.join("/");
    Ok(super::path_identity(&normalized))
}

fn case_identity_error(
    root: &Path,
    ignore: &Ignore,
    path: &str,
    case_insensitive: bool,
) -> Option<String> {
    if !case_insensitive {
        return None;
    }
    fn entries(directory: &Path) -> Result<BTreeMap<String, Vec<std::fs::DirEntry>>, String> {
        let mut groups: BTreeMap<String, Vec<std::fs::DirEntry>> = BTreeMap::new();
        let children = std::fs::read_dir(directory).map_err(|_| {
            format!(
                "cannot inspect filesystem aliases in {}",
                directory.display()
            )
        })?;
        for child in children {
            let child = child.map_err(|_| {
                format!(
                    "cannot inspect filesystem aliases in {}",
                    directory.display()
                )
            })?;
            let key = super::path_identity_with_case(&child.file_name().to_string_lossy(), true);
            groups.entry(key).or_default().push(child);
        }
        Ok(groups)
    }
    fn unique(
        directory: &Path,
        key: &str,
        aliases: &[std::fs::DirEntry],
    ) -> Result<PathBuf, String> {
        if aliases.len() != 1 {
            return Err(format!(
                "ambiguous Windows path identity {key:?} in {}; case-fold aliases include regular files, directories and symlinks",
                directory.display()
            ));
        }
        let canonical = directory.join(key);
        if std::fs::symlink_metadata(&canonical).is_err() {
            return Err(format!(
                "Windows path identity {key:?} does not resolve in {}; case-sensitive filesystem mappings are unsupported for this task path",
                directory.display()
            ));
        }
        Ok(canonical)
    }
    let inspect = || -> Result<(), String> {
        let mut current = root.to_path_buf();
        if path != "." {
            for component in path.split('/') {
                if !current.is_dir() {
                    return Ok(());
                }
                let groups = entries(&current)?;
                let Some(aliases) = groups.get(component) else {
                    return Ok(());
                };
                current = unique(&current, component, aliases)?;
            }
        }
        if !current.is_dir() {
            return Ok(());
        }
        let mut pending = vec![current];
        while let Some(directory) = pending.pop() {
            for (key, aliases) in entries(&directory)? {
                let relative = super::relative_with_case(root, &directory.join(&key), true);
                let mut tracked = false;
                for alias in &aliases {
                    let kind = alias.file_type().map_err(|_| {
                        format!("cannot inspect filesystem alias {}", alias.path().display())
                    })?;
                    if kind.is_file() && !ignore.skips_file(&relative)
                        || kind.is_dir()
                            && !super::skipped_directory(&key)
                            && !ignore.skips_directory(&relative)
                    {
                        tracked = true;
                    }
                }
                if !tracked {
                    continue;
                }
                let child = unique(&directory, &key, &aliases)?;
                if aliases[0]
                    .file_type()
                    .map_err(|_| format!("cannot inspect filesystem alias {}", child.display()))?
                    .is_dir()
                {
                    pending.push(child);
                }
            }
        }
        Ok(())
    };
    inspect().err()
}

pub fn normalize_tracked_path(
    root: &Path,
    ignore: &Ignore,
    kind: &str,
    path: &str,
) -> Result<String, String> {
    let normalized =
        normalize_scope(root, path).map_err(|error| error.replace("write scope", kind))?;
    let mut current = root.to_path_buf();
    for component in normalized.split('/') {
        current.push(component);
        if super::skipped_directory(component) && !current.is_file() {
            return Err(format!(
                "{kind} {path:?} is left out of change tracking by built-in skipped directory {component:?}; declare a tracked project path"
            ));
        }
    }
    let path_on_disk = root.join(&normalized);
    if let Some(rule) = ignore.rule_for(&normalized, !path_on_disk.is_file()) {
        return Err(format!(
            "{kind} {path:?} is left out of change tracking by {rule}, so BlaBla could never observe it; drop that ignore rule or declare a path it does not cover"
        ));
    }
    if let Some(problem) = case_identity_error(root, ignore, &normalized, cfg!(windows)) {
        return Err(format!(
            "{kind} {path:?} is not safely observable: {problem}"
        ));
    }
    Ok(normalized)
}

pub fn tracking_error(task: &Task, root: &Path, ignore: &Ignore) -> Option<String> {
    let declared = if task.check_inputs.is_empty() {
        &task.scope
    } else {
        &task.check_inputs
    };
    declared
        .iter()
        .map(|path| ("input", path))
        .chain(
            task.deliverables
                .iter()
                .map(|deliverable| ("deliverable", &deliverable.path)),
        )
        .find_map(
            |(kind, path)| match normalize_tracked_path(root, ignore, kind, path) {
                Err(message) => Some(message),
                Ok(normalized) if normalized != *path => Some(format!(
                    "{kind} {path:?} is not normalized for change tracking; declare {normalized:?}"
                )),
                Ok(_) => None,
            },
        )
}

pub fn tracking_recovery(task: &Task, problem: &str) -> String {
    format!(
        "{problem}. Correct inputs with blabla task check {name} --input <tracked-path> and the exact check; remove invalid deliverables with blabla task deliverable {name} --remove <path> --reason <reason> --model <id>, then add tracked replacements. Resume READY work with task accept, rerun evidence and challenge. CLOSED records remain history; open a new assignment for current credit",
        name = task.name
    )
}

pub fn tracked_readiness(
    task: &Task,
    root: &Path,
    ignore: &Ignore,
    tree: &BTreeMap<String, String>,
) -> Readiness {
    let mut readiness = readiness(task, tree);
    if tracking_error(task, root, ignore).is_some() {
        readiness.current = false;
        readiness.supported = false;
    }
    readiness
}

pub fn scopes_intersect(a: &str, b: &str) -> bool {
    covers(a, b) || covers(b, a)
}

pub fn validate_scope(
    root: &Path,
    name: &str,
    scopes: &[String],
    tasks: &[Task],
) -> Result<Vec<String>, String> {
    let scopes = scopes
        .iter()
        .map(|path| normalize_scope(root, path))
        .collect::<Result<Vec<_>, _>>()?;
    for other in tasks
        .iter()
        .filter(|other| other.name != name && other.open())
    {
        for owned in &other.scope {
            let owned = normalize_scope(root, owned)?;
            if let Some(path) = scopes.iter().find(|path| scopes_intersect(path, &owned)) {
                return Err(format!(
                    "write scope {path:?} overlaps task::{} at {owned:?}; withdraw the old assignment before transferring ownership",
                    other.name
                ));
            }
        }
    }
    Ok(scopes)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ResultBasis {
    Bounded {
        reason: String,
        project_state: String,
        prior_run_id: String,
        implementation_fingerprint: String,
        revision: RelevantRevision,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Task {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub work_intervals: Vec<effort::Interval>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub delivery_obligations: BTreeMap<String, delivery::Obligation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub delivery_reviews: Vec<delivery::Review>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub goal_reflection_required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal_reflection: Option<GoalReflection>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub intent_disposition_required: bool,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub intent_identities: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub intent_dispositions: Vec<IntentDisposition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_of: Option<ReviewTarget>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub delivery_review_targets: Vec<ReviewTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub withdrawal: Option<Withdrawal>,
    pub name: String,
    pub role: String,
    pub statement: String,
    pub scope: Vec<String>,
    pub deliverables: Vec<Deliverable>,
    #[serde(default)]
    pub findings: Vec<Finding>,
    pub opened_unix: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed_unix: Option<u64>,
    #[serde(default)]
    pub opened_tree: BTreeMap<String, String>,
    #[serde(default = "open_state")]
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check_argv: Option<Vec<String>>,
    #[serde(default)]
    pub check_inputs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted: Option<Acceptance>,
    #[serde(default)]
    pub acceptance_epoch: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Acceptance>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_basis: Option<ResultBasis>,
    #[serde(default)]
    pub assessments: Vec<Assessment>,
    #[serde(default)]
    pub exceptions: Vec<Exception>,
    #[serde(default)]
    pub evidence: Vec<Evidence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub challenged: Option<ChallengeReceipt>,
    #[serde(default)]
    pub attributions: Vec<Attribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build: Option<String>,
    #[serde(default)]
    pub notes: Vec<Note>,
    #[serde(default)]
    pub removed_deliverables: Vec<RemovedDeliverable>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub closed_paths: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub questions: Vec<AskedQuestion>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub decisions: Vec<Decision>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub orchestrator_records: Vec<OrchestratorRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lenses: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub falsify: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub falsifications: Vec<Falsification>,
}

fn is_false(value: &bool) -> bool {
    !value
}

fn open_state() -> String {
    STATES[0].to_owned()
}

impl Default for Task {
    fn default() -> Task {
        Task {
            work_intervals: Vec::new(),
            delivery_obligations: BTreeMap::new(),
            delivery_reviews: Vec::new(),
            goal_reflection_required: false,
            goal_reflection: None,
            intent_disposition_required: false,
            intent_identities: BTreeSet::new(),
            intent_dispositions: Vec::new(),
            review_of: None,
            delivery_review_targets: Vec::new(),
            withdrawal: None,
            name: String::new(),
            role: String::new(),
            statement: String::new(),
            scope: Vec::new(),
            deliverables: Vec::new(),
            findings: Vec::new(),
            opened_unix: 0,
            closed_unix: None,
            opened_tree: BTreeMap::new(),
            state: open_state(),
            check: None,
            check_argv: None,
            check_inputs: Vec::new(),
            accepted: None,
            acceptance_epoch: 0,
            result: None,
            result_basis: None,
            assessments: Vec::new(),
            exceptions: Vec::new(),
            evidence: Vec::new(),
            challenged: None,
            attributions: Vec::new(),
            build: None,
            notes: Vec::new(),
            removed_deliverables: Vec::new(),
            closed_paths: BTreeMap::new(),
            questions: Vec::new(),
            decisions: Vec::new(),
            orchestrator_records: Vec::new(),
            goal: None,
            lenses: Vec::new(),
            falsify: Vec::new(),
            falsifications: Vec::new(),
        }
    }
}

impl Task {
    pub fn open(&self) -> bool {
        !matches!(self.state.as_str(), "closed" | "withdrawn")
    }

    pub fn declares_check(&self) -> bool {
        self.check.is_some() || self.check_argv.is_some()
    }

    pub fn unresolved(&self) -> impl Iterator<Item = &Finding> {
        self.findings
            .iter()
            .filter(|finding| finding.resolution.is_none())
    }

    pub fn blocking(&self) -> impl Iterator<Item = &Finding> {
        self.unresolved()
            .filter(|finding| finding.addressed.is_none())
    }

    pub fn next_finding_id(&self) -> usize {
        self.findings
            .iter()
            .map(|finding| finding.id)
            .max()
            .unwrap_or(0)
            + 1
    }

    pub fn in_scope(&self, path: &str) -> bool {
        self.scope.iter().any(|allowed| covers(allowed, path))
    }

    pub fn recorded_during_carry(&self) -> impl Iterator<Item = &OrchestratorRecord> {
        self.orchestrator_records
            .iter()
            .filter(|record| record.during_carry())
    }

    pub fn unconfirmed_during_carry(&self) -> impl Iterator<Item = &OrchestratorRecord> {
        self.orchestrator_records
            .iter()
            .filter(|record| record.unconfirmed())
    }

    pub fn unpicked(&self) -> impl Iterator<Item = &AskedQuestion> {
        self.questions
            .iter()
            .filter(|asked| picked_by(self, &asked.id).is_none())
    }
}

pub fn replaceable(existing: Option<&Task>) -> bool {
    existing.is_none()
}

pub fn covers(allowed: &str, path: &str) -> bool {
    let allowed_case;
    let path_case;
    let (allowed, path) = if cfg!(windows) {
        allowed_case = super::path_identity(allowed);
        path_case = super::path_identity(path);
        (allowed_case.as_str(), path_case.as_str())
    } else {
        (allowed, path)
    };
    let allowed = allowed.trim_end_matches('/');
    path == allowed
        || path
            .strip_prefix(allowed)
            .is_some_and(|rest| rest.starts_with('/'))
}

pub fn directory(root: &Path) -> PathBuf {
    root.join(RECORD_DIRECTORY).join(TASK_DIRECTORY)
}

pub fn path_of(root: &Path, name: &str) -> PathBuf {
    directory(root).join(format!("{name}.json"))
}

#[derive(Default)]
pub struct Opening {
    pub review_of: Option<String>,
    pub name: String,
    pub role: String,
    pub statement: String,
    pub scope: Vec<String>,
    pub deliverables: Vec<String>,
    pub check: Option<String>,
    pub check_argv: Option<Vec<String>>,
    pub inputs: Vec<String>,
    pub goal: Option<String>,
    pub lenses: Vec<String>,
}

pub fn record(root: &Path, ignore: &Ignore, opening: Opening, now_unix: u64) -> Task {
    let tree = snapshot(root, ignore);
    let digests = opening
        .deliverables
        .iter()
        .map(|path| observed_digest(&tree, path))
        .collect();
    record_from(opening, now_unix, tree, digests)
}

pub fn record_from(
    opening: Opening,
    now_unix: u64,
    tree: BTreeMap<String, String>,
    digests: Vec<Option<String>>,
) -> Task {
    Task {
        review_of: opening.review_of.map(|task| ReviewTarget {
            task,
            revision: RelevantRevision {
                acceptance_epoch: 0,
                task_digest: String::new(),
                paths: BTreeMap::new(),
                identities: BTreeMap::new(),
            },
        }),
        name: opening.name,
        role: opening.role,
        statement: opening.statement,
        scope: opening.scope,
        deliverables: opening
            .deliverables
            .into_iter()
            .zip(digests)
            .map(|(path, opened_digest)| Deliverable {
                opened_digest,
                path,
            })
            .collect(),
        opened_unix: now_unix,
        opened_tree: tree,
        check: opening.check,
        check_argv: opening.check_argv,
        check_inputs: opening.inputs,
        goal: opening.goal,
        lenses: opening.lenses,
        ..Task::default()
    }
}

pub fn write(root: &Path, task: &Task) -> std::io::Result<PathBuf> {
    store::replace(root, task)
}

pub fn read(root: &Path, name: &str) -> Result<Option<Task>, String> {
    let path = path_of(root, name);
    if !path.is_file() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|failure| format!("cannot read {}: {failure}", path.display()))?;
    let unparsable =
        |failure: serde_json::Error| format!("cannot parse {}: {failure}", path.display());
    let record: serde_json::Value = serde_json::from_str(&text).map_err(unparsable)?;
    let stateless = record.get("state").is_none();
    let mut task: Task = serde_json::from_value(record).map_err(unparsable)?;
    if stateless && task.closed_unix.is_some() {
        task.state = "closed".to_owned();
    }
    Ok(Some(task))
}

fn recorded_names(root: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(directory(root)) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .filter_map(|path| {
            path.file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
        })
        .collect();
    names.sort();
    names
}

pub fn read_all(root: &Path) -> Vec<Task> {
    recorded_names(root)
        .iter()
        .filter_map(|name| read(root, name).ok().flatten())
        .collect()
}

pub fn unreadable(root: &Path) -> Vec<String> {
    recorded_names(root)
        .iter()
        .filter_map(|name| {
            read(root, name)
                .err()
                .map(|failure| format!("task::{name}   {failure}"))
        })
        .collect()
}

#[derive(Clone, Debug, Serialize)]
pub struct TaskSummary {
    pub id: String,
    pub role: String,
    pub state: String,
    pub unresolved: usize,
    pub deliverables: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct TaskStatus {
    pub directory: String,
    pub tasks: Vec<TaskSummary>,
    pub open: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unreadable: Vec<String>,
    pub authority: &'static str,
}

pub fn can_address_finding(task: &Task, model: &str, permitted: &[String]) -> bool {
    if permitted.is_empty() || permitted.iter().any(|entry| entry == model) {
        return true;
    }
    task.accepted
        .as_ref()
        .is_some_and(|accepted| accepted.model == model)
        && task.exceptions.iter().any(|exception| {
            !exception.superseded && exception.model == model && exception.approval.is_some()
        })
}

pub fn apply_evidence(task: &mut Task, evidence: Evidence) {
    task.evidence.push(evidence);
}

pub fn status(root: &Path) -> Option<TaskStatus> {
    let tasks = read_all(root);
    let unreadable = unreadable(root);
    if tasks.is_empty() && unreadable.is_empty() {
        return None;
    }
    Some(TaskStatus {
        directory: format!("{RECORD_DIRECTORY}/{TASK_DIRECTORY}"),
        open: tasks.iter().filter(|task| task.open()).count(),
        unreadable,
        tasks: tasks
            .iter()
            .map(|task| TaskSummary {
                id: format!("task::{}", task.name),
                role: format!("role::{}", task.role),
                state: task.state.to_ascii_uppercase(),
                unresolved: task.unresolved().count(),
                deliverables: task.deliverables.len(),
            })
            .collect(),
        authority: AUTHORITY,
    })
}

pub fn changed<'a>(
    task: &'a Task,
    current: &'a BTreeMap<String, String>,
    ignore: &Ignore,
) -> Vec<&'a str> {
    let mut moved: Vec<&str> = current
        .iter()
        .filter(|(path, digest)| {
            !ignore.skips_file(path) && task.opened_tree.get(*path) != Some(*digest)
        })
        .map(|(path, _)| path.as_str())
        .collect();
    moved.extend(
        task.opened_tree
            .keys()
            .filter(|path| !current.contains_key(*path) && !ignore.skips_file(path))
            .map(String::as_str),
    );
    moved.sort_unstable();
    moved.dedup();
    moved
}

pub fn on_disk_spelling(stored: &str, tree: &BTreeMap<String, String>) -> String {
    tree.keys()
        .find_map(|key| {
            std::iter::once(key.as_str())
                .chain(key.match_indices('/').map(|(index, _)| &key[..index]))
                .find(|candidate| super::path_identity(candidate) == stored)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| stored.to_owned())
}

pub const FALSIFY_TREE_PREFIX: &str = "falsify-tree-";

pub fn scratch_directory(root: &Path, name: &str) -> PathBuf {
    root.join(RECORD_DIRECTORY)
        .join(SCRATCH_DIRECTORY)
        .join(name)
}

pub fn scratch_label(name: &str) -> String {
    format!("{RECORD_DIRECTORY}/{SCRATCH_DIRECTORY}/{name}")
}

pub fn falsify_copy_directory(root: &Path, name: &str) -> PathBuf {
    scratch_directory(root, name).join(format!("{FALSIFY_TREE_PREFIX}{}", std::process::id()))
}

pub fn falsification_leftovers(root: &Path, name: &str) -> Vec<PathBuf> {
    let opened = store::opened_directory(root, name);
    let mut leftovers: Vec<PathBuf> = opened.is_dir().then_some(opened).into_iter().collect();
    if let Ok(entries) = std::fs::read_dir(scratch_directory(root, name)) {
        leftovers.extend(entries.flatten().map(|entry| entry.path()).filter(|path| {
            path.file_name()
                .is_some_and(|file| file.to_string_lossy().starts_with(FALSIFY_TREE_PREFIX))
        }));
    }
    leftovers
}

pub fn owe_path(task: &mut Task, path: String) {
    task.removed_deliverables
        .retain(|removed| removed.path != path);
    if task
        .deliverables
        .iter()
        .any(|deliverable| deliverable.path == path)
    {
        return;
    }
    let opened_digest = observed_digest(&task.opened_tree, &path);
    task.deliverables.push(Deliverable {
        opened_digest,
        path,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member_evidence(tree: &BTreeMap<String, String>, roots: &[&str]) -> Evidence {
        let inputs: BTreeMap<_, _> = roots
            .iter()
            .map(|root| (root.to_string(), observed_digest(tree, root)))
            .collect();
        serde_json::from_value(serde_json::json!({
            "check": "check", "exit": 0, "tree": "tree", "tool": "run", "unix": 1,
            "inputs": inputs, "member_manifest": capture_evidence_members(&inputs, tree, "execution-start")
        })).unwrap()
    }

    #[test]
    fn evidence_member_manifest_complete_selection_deduplicates_and_reconstructs_roots() {
        let tree = BTreeMap::from([
            ("core/a.rs".into(), "0000000000000001".into()),
            ("core/b.rs".into(), "0000000000000002".into()),
            ("core2/c.rs".into(), "0000000000000003".into()),
            ("report.md".into(), "0000000000000004".into()),
        ]);
        let mut work = Task {
            scope: vec!["core".into()],
            check_inputs: vec!["core".into(), "core/a.rs".into(), "missing".into()],
            ..Default::default()
        };
        work.deliverables.push(Deliverable {
            path: "report.md".into(),
            opened_digest: None,
        });
        let inputs = evidence_inputs(&work, &tree);
        let raw = capture_evidence_members(&inputs, &tree, "execution-start");
        assert_eq!(raw["member_count"], 3);
        let evidence = member_evidence(&tree, &["core", "core/a.rs", "report.md", "missing"]);
        assert_eq!(evidence.member_manifest.as_ref().unwrap(), &raw);
        let baseline = evidence_member_baseline(&evidence).unwrap();
        assert_eq!(
            baseline
                .members
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            ["core/a.rs", "core/b.rs", "report.md"]
        );
        for (root, digest) in &inputs {
            assert_eq!(observed_digest(&baseline.members, root), *digest);
        }
        assert_eq!(inputs["missing"], None);
    }

    #[test]
    fn evidence_member_manifest_empty_null_and_removed_root_are_not_missing_selection() {
        let mut evidence = member_evidence(&BTreeMap::new(), &["missing"]);
        assert!(
            evidence_member_baseline(&evidence)
                .unwrap()
                .members
                .is_empty()
        );
        assert_eq!(
            evidence.member_manifest.as_ref().unwrap()["member_count"],
            0
        );
        evidence
            .inputs
            .insert("missing".into(), Some("0000000000000001".into()));
        assert_eq!(
            evidence_member_baseline(&evidence).unwrap_err(),
            "input-digest-mismatch"
        );
        let tree = BTreeMap::from([("core/a.rs".into(), "0000000000000001".into())]);
        let mut evidence = member_evidence(&tree, &["core"]);
        evidence.inputs.clear();
        assert_eq!(
            evidence_member_baseline(&evidence).unwrap_err(),
            "member-outside-inputs"
        );
    }

    #[test]
    fn evidence_member_manifest_legacy_and_malformed_wire_roundtrip_without_gates() {
        let old = r#"{"check":"check","exit":0,"tree":"old","tool":"check","unix":1,"inputs":{}}"#;
        let evidence: Evidence = serde_json::from_str(old).unwrap();
        assert_eq!(serde_json::to_string(&evidence).unwrap(), old);
        assert_eq!(
            evidence_member_baseline(&evidence).unwrap_err(),
            "legacy-absent"
        );
        for raw in [
            serde_json::Value::Null,
            serde_json::json!([1]),
            serde_json::json!({"basis":"future","unknown":true}),
        ] {
            let mut wire = serde_json::to_value(&evidence).unwrap();
            wire["member_manifest"] = raw;
            let decoded: Evidence = serde_json::from_value(wire.clone()).unwrap();
            assert_eq!(serde_json::to_value(&decoded).unwrap(), wire);
            assert_eq!(
                evidence_member_baseline(&decoded).unwrap_err(),
                "malformed-manifest"
            );
            let work = Task::default();
            assert_eq!(
                evidence_matches(&work, &decoded),
                evidence_matches(&work, &evidence)
            );
        }
        let mut current = evidence.clone();
        current.acceptance_epoch = Some(1);
        current.identity = Some(CheckIdentity::Text {
            command: "check".into(),
        });
        let mut work = Task {
            acceptance_epoch: 1,
            check: Some("check".into()),
            evidence: vec![current],
            ..Default::default()
        };
        assert!(readiness(&work, &BTreeMap::new()).supported);
        work.evidence[0].member_manifest = Some(serde_json::json!({"bad":"diagnostics"}));
        assert!(readiness(&work, &BTreeMap::new()).supported);
    }

    #[test]
    fn evidence_member_manifest_count_and_utf8_path_limits_are_all_or_unavailable() {
        let mut tree: BTreeMap<_, _> = (0..8192)
            .map(|n| (format!("core/{n:04}"), "0000000000000001".to_owned()))
            .collect();
        let evidence = member_evidence(&tree, &["core"]);
        assert_eq!(
            evidence_member_baseline(&evidence).unwrap().members.len(),
            8192
        );
        tree.insert("core/overflow".into(), "0000000000000001".into());
        let evidence = member_evidence(&tree, &["core"]);
        let raw = evidence.member_manifest.as_ref().unwrap();
        assert_eq!(raw["member_count"], 8193);
        assert_eq!(raw["reason"], "member-limit");
        assert!(raw.get("members").is_none());
        assert_eq!(
            evidence_member_baseline(&evidence).unwrap_err(),
            "member-limit"
        );
        for extra in [0, 1] {
            let path = format!("core/{}{}", "é".repeat(2045), "x".repeat(1 + extra));
            assert_eq!(path.len(), 4096 + extra);
            let tree = BTreeMap::from([(path, "0000000000000001".into())]);
            let evidence = member_evidence(&tree, &["core"]);
            if extra == 0 {
                assert!(evidence_member_baseline(&evidence).is_ok());
            } else {
                assert_eq!(
                    evidence_member_baseline(&evidence).unwrap_err(),
                    "path-limit"
                );
                assert!(
                    evidence
                        .member_manifest
                        .as_ref()
                        .unwrap()
                        .get("members")
                        .is_none()
                );
            }
        }
    }

    #[test]
    fn evidence_member_manifest_compact_byte_limit_counts_escaping_exactly() {
        let mut tree: BTreeMap<_, _> = (0..260)
            .map(|n| {
                (
                    format!("core/{n:03}/{}", "x".repeat(4000)),
                    "0000000000000001".to_owned(),
                )
            })
            .collect();
        tree.insert("core/last".into(), "0000000000000001".into());
        let evidence = member_evidence(&tree, &["core"]);
        let size = serde_json::to_vec(evidence.member_manifest.as_ref().unwrap())
            .unwrap()
            .len();
        let remaining = 1_048_576 - size;
        let base = format!(
            "core/last{}{}",
            "\"".repeat(remaining / 2),
            "x".repeat(remaining % 2)
        );
        assert!(base.len() <= 4096);
        tree.remove("core/last");
        tree.insert(base.clone(), "0000000000000001".into());
        let evidence = member_evidence(&tree, &["core"]);
        assert_eq!(
            serde_json::to_vec(evidence.member_manifest.as_ref().unwrap())
                .unwrap()
                .len(),
            1_048_576
        );
        assert!(evidence_member_baseline(&evidence).is_ok());
        tree.remove(&base);
        tree.insert(format!("{base}x"), "0000000000000001".into());
        let evidence = member_evidence(&tree, &["core"]);
        assert_eq!(
            evidence_member_baseline(&evidence).unwrap_err(),
            "byte-limit"
        );
        assert_eq!(
            evidence.member_manifest.as_ref().unwrap()["member_count"],
            261
        );
        assert!(
            evidence
                .member_manifest
                .as_ref()
                .unwrap()
                .get("members")
                .is_none()
        );
    }

    #[test]
    fn evidence_member_manifest_rejects_invalid_shape_count_path_digest_and_selection() {
        let tree = BTreeMap::from([("core/a.rs".into(), "0000000000000001".into())]);
        let original = member_evidence(&tree, &["core"]);
        for (field, value, reason) in [
            ("basis", serde_json::json!("future-v2"), "unsupported-basis"),
            (
                "capture",
                serde_json::json!("completion-time"),
                "unsupported-capture",
            ),
            (
                "member_count",
                serde_json::json!(2),
                "member-count-mismatch",
            ),
            (
                "members",
                serde_json::json!({"../escape":"0000000000000001"}),
                "invalid-member",
            ),
            (
                "members",
                serde_json::json!({"core/a.rs":"secret content"}),
                "invalid-member",
            ),
            (
                "members",
                serde_json::json!({"elsewhere/a.rs":"0000000000000001"}),
                "member-outside-inputs",
            ),
            (
                "members",
                serde_json::json!({"core/a.rs":"0000000000000002"}),
                "input-digest-mismatch",
            ),
        ] {
            let mut evidence = original.clone();
            evidence.member_manifest.as_mut().unwrap()[field] = value;
            assert_eq!(evidence_member_baseline(&evidence).unwrap_err(), reason);
        }
    }

    #[test]
    #[cfg(unix)]
    fn case_identity_guard_rejects_colliding_regular_and_symlink_aliases() {
        let temp = tempfile::TempDir::new().unwrap();
        let root = temp.path();
        std::fs::create_dir(root.join("src")).unwrap();
        std::fs::write(root.join("src/Foo.rs"), "first").unwrap();
        std::fs::write(root.join("src/foo.rs"), "second").unwrap();
        let ignore = Ignore::default();
        for path in ["src", "src/foo.rs", "."] {
            assert!(
                case_identity_error(root, &ignore, path, true).is_some(),
                "{path}"
            );
        }
        assert!(case_identity_error(root, &ignore, "src", false).is_none());
        std::fs::remove_file(root.join("src/Foo.rs")).unwrap();
        std::os::unix::fs::symlink(root.join("outside.rs"), root.join("src/Foo.rs")).unwrap();
        for path in ["src", "src/foo.rs"] {
            assert!(
                case_identity_error(root, &ignore, path, true).is_some(),
                "symlink alias: {path}"
            );
        }
        assert!(case_identity_error(root, &ignore, "src/absent.rs", true).is_none());
    }

    #[test]
    #[cfg(unix)]
    fn case_identity_guard_refuses_unresolvable_case_mapping_but_keeps_safe_absence() {
        let temp = tempfile::TempDir::new().unwrap();
        let root = temp.path();
        std::fs::create_dir(root.join("src")).unwrap();
        std::fs::write(root.join("src/Foo.rs"), "upper-only").unwrap();
        let ignore = Ignore::default();
        assert!(case_identity_error(root, &ignore, "src/foo.rs", true).is_some());
        assert!(case_identity_error(root, &ignore, "src", true).is_some());
        assert!(case_identity_error(root, &ignore, "src/Foo.rs", false).is_none());
        assert!(case_identity_error(root, &ignore, "future/nested.rs", true).is_none());
        std::fs::create_dir(root.join("node_modules")).unwrap();
        std::fs::write(root.join("node_modules/A"), "a").unwrap();
        std::fs::write(root.join("node_modules/a"), "b").unwrap();
        std::fs::remove_file(root.join("src/Foo.rs")).unwrap();
        std::fs::write(root.join("src/foo.rs"), "safe").unwrap();
        assert!(case_identity_error(root, &ignore, ".", true).is_none());
    }

    #[test]
    #[cfg(unix)]
    fn case_identity_guard_skips_fully_excluded_alias_groups() {
        let temp = tempfile::TempDir::new().unwrap();
        let root = temp.path();
        std::fs::create_dir(root.join("src")).unwrap();
        std::fs::write(root.join("src/Foo.LOG"), "ignored first").unwrap();
        std::fs::write(root.join("src/foo.log"), "ignored second").unwrap();
        let ignore = Ignore::new(
            root,
            &[super::super::ignore::IgnoreDeclaration::Pattern {
                written: "*.log".to_owned(),
                span: crate::diagnostic::Span {
                    start: 0,
                    end: 1,
                    line: 1,
                    column: 1,
                },
            }],
            Default::default(),
        )
        .unwrap();
        assert!(case_identity_error(root, &ignore, "src", true).is_none());
        std::fs::write(root.join("src/foo.rs"), "tracked").unwrap();
        std::os::unix::fs::symlink(root.join("external"), root.join("src/Foo.rs")).unwrap();
        assert!(case_identity_error(root, &ignore, "src", true).is_some());
    }

    #[test]
    fn task_without_closed_paths_serializes_without_field() {
        let task = Task {
            name: "test-task".to_owned(),
            role: "worker".to_owned(),
            statement: "test statement".to_owned(),
            scope: vec!["src/".to_owned()],
            opened_unix: 1234567890,
            ..Default::default()
        };

        let serialized = serde_json::to_string(&task).expect("task serializes");
        assert!(!serialized.contains("closed_paths"));

        let deserialized: Task = serde_json::from_str(&serialized).expect("task deserializes");
        assert_eq!(deserialized.name, task.name);
        assert!(deserialized.closed_paths.is_empty());
    }

    #[test]
    fn a_record_written_before_attestation_reads_with_nothing_to_confirm() {
        let mut task: Task = serde_json::from_value(serde_json::json!({
            "name": "legacy",
            "role": "worker",
            "statement": "written before orchestrator records existed",
            "scope": ["src"],
            "deliverables": [],
            "opened_unix": 1,
            "state": "ready",
            "accepted": { "model": "small", "unix": 2 }
        }))
        .expect("a record without orchestrator_records parses");
        assert!(task.orchestrator_records.is_empty());
        assert_eq!(confirm(&mut task, "opus", 3), Ok(0));
        assert!(
            !serde_json::to_string(&task)
                .expect("task serializes")
                .contains("orchestrator_records")
        );
        let bare: OrchestratorRecord =
            serde_json::from_value(serde_json::json!({ "verb": "scope", "unix": 4 }))
                .expect("a record without carried_by or confirmed parses");
        assert!(!bare.during_carry());
        assert!(!bare.unconfirmed());
    }

    #[test]
    fn an_orchestrator_role_task_keeps_its_carried_record_out_of_the_carry() {
        let carried = |role: &str| -> Task {
            serde_json::from_value(serde_json::json!({
                "name": "self-carried",
                "role": role,
                "statement": "an orchestrator carries its own task",
                "scope": ["src"],
                "deliverables": [],
                "opened_unix": 1,
                "state": "accepted",
                "accepted": { "model": "opus-5", "unix": 2 }
            }))
            .expect("a carried task parses")
        };
        let mut own = carried(ORCHESTRATOR_ROLE);
        assert!(carrier(&own).is_some());
        attest(&mut own, "resolve", Some("opus-5"), 3);
        assert_eq!(own.orchestrator_records.len(), 1);
        assert_eq!(own.recorded_during_carry().count(), 0);
        assert_eq!(own.unconfirmed_during_carry().count(), 0);
        let mut worker = carried("worker");
        attest(&mut worker, "resolve", Some("opus-5"), 3);
        assert_eq!(worker.recorded_during_carry().count(), 1);
        assert_eq!(worker.unconfirmed_during_carry().count(), 1);
    }

    #[test]
    fn a_default_task_is_open_and_holds_nothing() {
        assert_eq!(
            serde_json::to_value(Task::default()).expect("task serializes"),
            serde_json::json!({
                "name": "",
                "role": "",
                "statement": "",
                "scope": [],
                "deliverables": [],
                "findings": [],
                "opened_unix": 0,
                "opened_tree": {},
                "state": "open",
                "acceptance_epoch": 0,
                "check_inputs": [],
                "assessments": [],
                "exceptions": [],
                "evidence": [],
                "attributions": [],
                "notes": [],
                "removed_deliverables": []
            })
        );
    }

    #[test]
    fn every_opening_field_reaches_the_recorded_task() {
        let task = record_from(
            Opening {
                name: "work".to_owned(),
                role: "worker".to_owned(),
                statement: "repair".to_owned(),
                scope: vec!["src".to_owned()],
                deliverables: vec!["src/a.rs".to_owned()],
                check: Some("check".to_owned()),
                check_argv: Some(vec!["cargo".to_owned(), "test".to_owned()]),
                inputs: vec!["shared".to_owned()],
                goal: Some("ship".to_owned()),
                review_of: None,
                lenses: vec!["review-lens".to_owned()],
            },
            7,
            BTreeMap::from([("src/a.rs".to_owned(), "old".to_owned())]),
            vec![Some("old".to_owned())],
        );
        assert_eq!(
            serde_json::to_value(&task).expect("task serializes"),
            serde_json::json!({
                "name": "work",
                "role": "worker",
                "statement": "repair",
                "scope": ["src"],
                "deliverables": [{ "path": "src/a.rs", "opened_digest": "old" }],
                "findings": [],
                "opened_unix": 7,
                "opened_tree": { "src/a.rs": "old" },
                "state": "open",
                "acceptance_epoch": 0,
                "check": "check",
                "check_argv": ["cargo", "test"],
                "check_inputs": ["shared"],
                "assessments": [],
                "exceptions": [],
                "evidence": [],
                "attributions": [],
                "notes": [],
                "removed_deliverables": [],
                "goal": "ship",
                "lenses": ["review-lens"]
            })
        );
        let opening = Opening::default();
        assert!(opening.name.is_empty() && opening.check.is_none() && opening.goal.is_none());
    }
}
