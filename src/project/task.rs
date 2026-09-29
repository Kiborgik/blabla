use super::ignore::Ignore;
use super::snapshot;
use super::status::RECORD_DIRECTORY;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

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
    let carried_by = carrier(task).map(str::to_owned);
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

pub const STATES: [&str; 5] = ["open", "accepted", "blocked", "ready", "closed"];

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
    pub ruling: String,
    pub statement: String,
    pub unix: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Exception {
    pub model: String,
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Evidence {
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

pub fn evidence_inputs(
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> BTreeMap<String, Option<String>> {
    let declared = if task.check_inputs.is_empty() {
        &task.scope
    } else {
        &task.check_inputs
    };
    declared
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
    match &task.check {
        Some(declared) => task
            .evidence
            .iter()
            .rev()
            .find(|entry| &entry.check == declared),
        None => task.evidence.last(),
    }
}

pub fn readiness(task: &Task, tree: &BTreeMap<String, String>) -> Readiness {
    let recorded = !task.evidence.is_empty();
    let latest = latest_evidence(task);
    let answers_declared_check = latest.is_some_and(|entry| entry.exit == 0);
    let current = latest.is_some_and(|entry| {
        !stale(entry, tree)
            && evidence_inputs(task, tree)
                .keys()
                .all(|path| entry.inputs.contains_key(path))
    });
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
    record.challenged = None;
    record.state.clear();
    record.closed_unix = None;
    record.result = None;
    record.build = None;
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
        "closed" => return Err("closed"),
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
    if task.state != "accepted" {
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

pub fn record_acceptance(task: &mut Task, tree: &BTreeMap<String, String>, model: &str, unix: u64) {
    let changed_paths = changed(task, tree);
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
    let paths_changed: Vec<String> = changed(task, tree)
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
pub struct Task {
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Acceptance>,
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
}

fn open_state() -> String {
    STATES[0].to_owned()
}

impl Default for Task {
    fn default() -> Task {
        Task {
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
            result: None,
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
        }
    }
}

impl Task {
    pub fn open(&self) -> bool {
        self.state != "closed"
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
    pub name: String,
    pub role: String,
    pub statement: String,
    pub scope: Vec<String>,
    pub deliverables: Vec<String>,
    pub check: Option<String>,
    pub check_argv: Option<Vec<String>>,
    pub inputs: Vec<String>,
    pub goal: Option<String>,
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
        ..Task::default()
    }
}

pub fn write(root: &Path, task: &Task) -> std::io::Result<PathBuf> {
    let path = path_of(root, &task.name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_vec_pretty(task).map_err(std::io::Error::other)?;
    std::fs::write(&path, text)?;
    Ok(path)
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
        && task
            .exceptions
            .iter()
            .any(|exception| exception.model == model && exception.approval.is_some())
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

pub fn changed<'a>(task: &'a Task, current: &'a BTreeMap<String, String>) -> Vec<&'a str> {
    let mut moved: Vec<&str> = current
        .iter()
        .filter(|(path, digest)| task.opened_tree.get(*path) != Some(*digest))
        .map(|(path, _)| path.as_str())
        .collect();
    moved.extend(
        task.opened_tree
            .keys()
            .filter(|path| !current.contains_key(*path))
            .map(String::as_str),
    );
    moved.sort_unstable();
    moved.dedup();
    moved
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
                "check": "check",
                "check_argv": ["cargo", "test"],
                "check_inputs": ["shared"],
                "assessments": [],
                "exceptions": [],
                "evidence": [],
                "attributions": [],
                "notes": [],
                "removed_deliverables": [],
                "goal": "ship"
            })
        );
        let opening = Opening::default();
        assert!(opening.name.is_empty() && opening.check.is_none() && opening.goal.is_none());
    }
}
