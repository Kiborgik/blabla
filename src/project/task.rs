use super::status::RECORD_DIRECTORY;
use super::{digest_of, snapshot};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const TASK_DIRECTORY: &str = "tasks";

pub const AUTHORITY: &str = "A bounded task is a record of what an orchestrator decided, held against the working tree. It is machine state rather than project memory: nothing in it is checked for truth, it reaches no layer, and it never decides completion.";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Deliverable {
    pub path: String,
    pub opened_digest: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Finding {
    pub id: usize,
    pub statement: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
}

pub const STATES: [&str; 5] = ["open", "accepted", "blocked", "ready", "closed"];

pub const SCRATCH_DIRECTORY: &str = "scratch";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Acceptance {
    pub model: String,
    pub unix: u64,
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
    pub inputs: BTreeMap<String, String>,
}

pub const ATTRIBUTIONS: [&str; 3] = ["task", "concurrent", "unknown"];

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Attribution {
    pub path: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
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
        .any(|(path, digest)| tree.get(path) != Some(digest))
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
    let current = latest.is_some_and(|entry| !stale(entry, tree));
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
            | ("accepted", "blocked")
            | ("accepted", "ready")
            | ("blocked", "accepted")
            | ("ready", "accepted")
            | ("ready", "closed")
    )
}

pub fn apply(task: &mut Task, to: &str) -> bool {
    if !transition(&task.state, to) {
        return false;
    }
    task.state = to.to_owned();
    true
}

pub fn accept_result(task: &mut Task, standing: usize, model: &str, now_unix: u64) -> bool {
    if standing != 0 || !apply(task, "closed") {
        return false;
    }
    task.result = Some(Acceptance {
        model: model.to_owned(),
        unix: now_unix,
    });
    task.closed_unix = Some(now_unix);
    true
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
    pub accepted: Option<Acceptance>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Acceptance>,
    #[serde(default)]
    pub assessments: Vec<Assessment>,
    #[serde(default)]
    pub exceptions: Vec<Exception>,
    #[serde(default)]
    pub evidence: Vec<Evidence>,
    #[serde(default)]
    pub attributions: Vec<Attribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build: Option<String>,
}

fn open_state() -> String {
    STATES[0].to_owned()
}

impl Task {
    pub fn open(&self) -> bool {
        self.closed_unix.is_none()
    }

    pub fn unresolved(&self) -> impl Iterator<Item = &Finding> {
        self.findings
            .iter()
            .filter(|finding| finding.resolution.is_none())
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
}

pub fn record(root: &Path, opening: Opening, now_unix: u64) -> Task {
    let digests = opening
        .deliverables
        .iter()
        .map(|path| digest_of(root, path))
        .collect();
    record_from(opening, now_unix, snapshot(root), digests)
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
        accepted: None,
        result: None,
        assessments: Vec::new(),
        exceptions: Vec::new(),
        evidence: Vec::new(),
        attributions: Vec::new(),
        build: None,
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
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|failure| format!("cannot parse {}: {failure}", path.display()))
}

pub fn read_all(root: &Path) -> Vec<Task> {
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
        .iter()
        .filter_map(|name| read(root, name).ok().flatten())
        .collect()
}

#[derive(Clone, Debug, Serialize)]
pub struct TaskSummary {
    pub id: String,
    pub role: String,
    pub state: &'static str,
    pub unresolved: usize,
    pub deliverables: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct TaskStatus {
    pub directory: String,
    pub tasks: Vec<TaskSummary>,
    pub open: usize,
    pub authority: &'static str,
}

pub fn status(root: &Path) -> Option<TaskStatus> {
    let tasks = read_all(root);
    if tasks.is_empty() {
        return None;
    }
    Some(TaskStatus {
        directory: format!("{RECORD_DIRECTORY}/{TASK_DIRECTORY}"),
        open: tasks.iter().filter(|task| task.open()).count(),
        tasks: tasks
            .iter()
            .map(|task| TaskSummary {
                id: format!("task::{}", task.name),
                role: format!("role::{}", task.role),
                state: if task.open() { "OPEN" } else { "CLOSED" },
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
