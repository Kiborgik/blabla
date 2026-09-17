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
}

pub fn record(root: &Path, opening: Opening, now_unix: u64) -> Task {
    Task {
        name: opening.name,
        role: opening.role,
        statement: opening.statement,
        scope: opening.scope,
        deliverables: opening
            .deliverables
            .into_iter()
            .map(|path| Deliverable {
                opened_digest: digest_of(root, &path),
                path,
            })
            .collect(),
        findings: Vec::new(),
        opened_unix: now_unix,
        closed_unix: None,
        opened_tree: snapshot(root),
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
