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
    if to == "ready" || !transition(&task.state, to) {
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
}

fn open_state() -> String {
    STATES[0].to_owned()
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

pub struct Opening {
    pub name: String,
    pub role: String,
    pub statement: String,
    pub scope: Vec<String>,
    pub deliverables: Vec<String>,
    pub check: Option<String>,
    pub check_argv: Option<Vec<String>>,
    pub inputs: Vec<String>,
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
        findings: Vec::new(),
        opened_unix: now_unix,
        closed_unix: None,
        opened_tree: tree,
        state: open_state(),
        check: opening.check,
        check_argv: opening.check_argv,
        check_inputs: opening.inputs,
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
