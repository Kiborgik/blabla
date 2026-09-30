use super::{ATTRIBUTIONS, Task, attribute, declared_check, evidence_inputs};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelevantRevision {
    pub acceptance_epoch: u64,
    pub task_digest: String,
    pub paths: BTreeMap<String, Option<String>>,
    pub identities: BTreeMap<String, String>,
}

impl RelevantRevision {
    pub fn fingerprint(&self) -> String {
        digest(&serde_json::to_string(self).expect("revision serializes"))
    }
}

fn digest(text: &str) -> String {
    let mut fingerprint = crate::project::Fnv::new();
    fingerprint.write_str(text);
    fingerprint.finish()
}

pub fn relevant_revision(
    task: &Task,
    tree: &BTreeMap<String, String>,
    identities: BTreeMap<String, String>,
) -> RelevantRevision {
    let findings: Vec<_> = task
        .findings
        .iter()
        .map(|finding| {
            serde_json::json!({
                "id": finding.id,
                "statement": finding.statement,
                "addressed": finding.addressed.as_ref().map(|addressed| (&addressed.model, &addressed.statement)),
                "resolution": finding.resolution,
            })
        })
        .collect();
    let assignment = serde_json::json!({
        "statement": task.statement,
        "role": task.role,
        "goal": task.goal,
        "scope": task.scope,
        "check": declared_check(task),
        "check_inputs": task.check_inputs,
        "deliverables": task.deliverables.iter().map(|deliverable| &deliverable.path).collect::<Vec<_>>(),
        "acceptance_epoch": task.acceptance_epoch,
        "questions": task.questions,
        "decisions": task.decisions,
        "findings": findings,
    });
    let relevant_tree = tree
        .iter()
        .filter(|(path, _)| attribute(task, tree, path) != ATTRIBUTIONS[1])
        .map(|(path, digest)| (path.clone(), digest.clone()))
        .collect();
    RelevantRevision {
        acceptance_epoch: task.acceptance_epoch,
        task_digest: digest(&assignment.to_string()),
        paths: evidence_inputs(task, &relevant_tree),
        identities,
    }
}
