use super::*;

pub(super) struct ReviewEdge<T = Task> {
    pub(super) reviewer: T,
    pub(super) target: task::ReviewTarget,
    pub(super) relation: &'static str,
    pub(super) reviewed: Option<T>,
    pub(super) failure: Option<(&'static str, String)>,
}

pub(super) fn review_edges_with<T: Borrow<Task> + Clone>(
    review: T,
    read: impl Fn(&str) -> Result<Option<T>, String>,
) -> Vec<ReviewEdge<T>> {
    fn visit<T: Borrow<Task> + Clone>(
        read: &impl Fn(&str) -> Result<Option<T>, String>,
        current_record: &T,
        active: &mut BTreeSet<String>,
        done: &mut BTreeSet<String>,
        edges: &mut Vec<ReviewEdge<T>>,
    ) {
        let current = current_record.borrow();
        if done.contains(&current.name) {
            return;
        }
        active.insert(current.name.clone());
        if let Some(target) = &current.review_of {
            let mut edge = ReviewEdge {
                reviewer: current_record.clone(),
                target: target.clone(),
                relation: "primary",
                reviewed: None,
                failure: None,
            };
            match read(&target.task) {
                Ok(Some(reviewed_record)) => {
                    let reviewed = reviewed_record.borrow();
                    if reviewed.state == TaskState::Withdrawn {
                        edge.failure = Some((
                            "target-withdrawn",
                            format!("review target {:?} is withdrawn", target.task),
                        ));
                    } else if active.contains(&reviewed.name) {
                        edge.failure = Some(("review-cycle", "recursive review cycle".into()));
                    }
                    edge.reviewed = Some(reviewed_record);
                }
                Ok(None) => {
                    edge.failure = Some((
                        "target-missing",
                        format!("no review target task {:?} exists", target.task),
                    ))
                }
                Err(message) => edge.failure = Some(("target-unreadable", message)),
            }
            let next = edge
                .failure
                .is_none()
                .then(|| edge.reviewed.clone())
                .flatten();
            edges.push(edge);
            if let Some(reviewed) = next {
                visit(read, &reviewed, active, done, edges);
            }
        }
        active.remove(&current.name);
        done.insert(current.name.clone());
    }
    let mut edges = Vec::new();
    visit(
        &read,
        &review,
        &mut BTreeSet::new(),
        &mut BTreeSet::new(),
        &mut edges,
    );
    edges
}

pub(super) fn read_view_task(project: &Project, name: &str) -> Result<Option<Task>, String> {
    task::read(&project.manifest.root, name)
}

pub(super) fn review_edges(project: &Project, review: &Task) -> Vec<ReviewEdge> {
    review_edges_with(review.clone(), |name| read_view_task(project, name))
}

pub(super) fn review_graph(project: &Project, review: &Task) -> Result<Vec<(Task, Task)>, String> {
    review_edges(project, review)
        .into_iter()
        .map(|edge| {
            if let Some((_, message)) = edge.failure {
                return Err(message);
            }
            Ok((
                edge.reviewer,
                edge.reviewed.expect("validated review target"),
            ))
        })
        .collect()
}

pub(super) fn review_edge_view(
    project: &Project,
    edge: &ReviewEdge,
    tree: &BTreeMap<String, String>,
) -> serde_json::Value {
    review_edge_view_with(project, edge, tree, None)
}

pub(super) fn review_edge_view_with<T: Borrow<Task>>(
    project: &Project,
    edge: &ReviewEdge<T>,
    tree: &BTreeMap<String, String>,
    observation: Option<&ViewObservation<'_>>,
) -> serde_json::Value {
    let reviewer = edge.reviewer.borrow();
    let reviewed = edge.reviewed.as_ref().map(Borrow::borrow);
    let current = reviewed.map(|source| {
        observation.map_or_else(
            || {
                task::review_revision(
                    reviewer,
                    source,
                    tree,
                    review_dependencies(project, reviewer, source),
                )
            },
            |observed| observed.review_revision(reviewer, source),
        )
    });
    let tracking = observation
        .map_or_else(
            || task::tracking_error(reviewer, &project.manifest.root, &project.ignore),
            |observed| observed.tracking_error(reviewer),
        )
        .or_else(|| {
            reviewed.and_then(|source| {
                observation.map_or_else(
                    || task::tracking_error(source, &project.manifest.root, &project.ignore),
                    |observed| observed.tracking_error(source),
                )
            })
        });
    let fresh = edge.failure.is_none()
        && tracking.is_none()
        && reviewed.is_some_and(|source| {
            observation.map_or_else(
                || {
                    task::review_current(
                        reviewer,
                        source,
                        tree,
                        review_dependencies(project, reviewer, source),
                    )
                },
                |observed| observed.review_current(reviewer, source),
            )
        });
    let unavailable = edge.reviewed.is_none()
        || edge
            .failure
            .as_ref()
            .is_some_and(|(code, _)| *code == "review-cycle");
    serde_json::json!({
        "reviewer_task": reviewer.name, "target_task": edge.target.task,
        "relation": edge.relation, "state": if unavailable { "unavailable" } else if fresh { "current" } else { "stale" },
        "reason": edge.failure.as_ref().map(|(code, _)| *code).or_else(|| tracking.as_ref().map(|_| "tracking-unavailable")).or_else(|| (!fresh).then_some("stale-target-revision")),
        "detail": edge.failure.as_ref().map(|(_, message)| message).or(tracking.as_ref()),
        "recorded_revision_fingerprint": fingerprint(&edge.target.revision),
        "current_revision_fingerprint": current.as_ref().map(fingerprint),
        "route": format!("blabla task freshness {}", reviewer.name)
    })
}

pub(super) fn review_target(project: &Project, name: &str, target: &str) -> Result<Task, String> {
    let reviewed = task::read(&project.manifest.root, target)?
        .ok_or_else(|| format!("no review target task {target:?} exists"))?;
    if reviewed.state == TaskState::Withdrawn {
        return Err(format!("review target {target:?} is withdrawn"));
    }
    if reviewed.name == name
        || review_graph(project, &reviewed)?
            .iter()
            .any(|(_, source)| source.name == name)
    {
        return Err(format!("review target {target:?} creates a review cycle"));
    }
    Ok(reviewed)
}

pub(super) fn review_context(
    project: &Project,
    review: &Task,
    tree: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, task::RelevantRevision>, String> {
    Ok(review_graph(project, review)?
        .into_iter()
        .map(|(reviewer, source)| {
            (
                format!("{}::{}", reviewer.name, source.name),
                task::review_revision(
                    &reviewer,
                    &source,
                    tree,
                    review_dependencies(project, &reviewer, &source),
                ),
            )
        })
        .collect())
}

pub(super) fn review_dependencies(
    project: &Project,
    review: &Task,
    reviewed: &Task,
) -> BTreeMap<String, String> {
    let mut identities = review_identities(project, reviewed);
    identities.extend(review_identities(project, review));
    identities
}

pub(super) fn review_freshness(project: &Project, review: &Task) -> Option<bool> {
    review.review_of.as_ref()?;
    let tree = view_tree(project);
    review_freshness_with_tree(project, review, &tree)
}

pub(super) fn review_freshness_with_tree(
    project: &Project,
    review: &Task,
    tree: &BTreeMap<String, String>,
) -> Option<bool> {
    review.review_of.as_ref()?;
    let Ok(edges) = review_graph(project, review) else {
        return Some(false);
    };
    Some(edges.iter().all(|(current, reviewed)| {
        task::tracking_error(current, &project.manifest.root, &project.ignore).is_none()
            && task::tracking_error(reviewed, &project.manifest.root, &project.ignore).is_none()
            && task::review_current(
                current,
                reviewed,
                tree,
                review_dependencies(project, current, reviewed),
            )
    }))
}

pub(super) fn review_identities(project: &Project, task: &Task) -> BTreeMap<String, String> {
    let mut identities = BTreeMap::new();
    let mut packs = Vec::new();
    if let Some(entry) = &project.manifest.process {
        let memory = read_entry(entry, process::build, process::validate);
        if let Some(memory) = memory.present() {
            if let Some(role) = memory.roles.iter().find(|role| role.name == task.role) {
                identities.insert(format!("role::{}", role.name), fingerprint(role));
                packs.extend(role.consult.clone());
            }
            for policy in memory
                .policies
                .iter()
                .filter(|policy| policy.applies_to.contains(&task.role))
            {
                identities.insert(format!("policy::{}", policy.name), fingerprint(policy));
                packs.extend(policy.consult.clone());
            }
            let models = task::models::permitted(memory, &task.role);
            identities.insert(format!("models::{}", task.role), fingerprint(&models));
        } else {
            identities.insert(
                "memory::process".to_owned(),
                fingerprint(&(memory.state(), memory.problems())),
            );
        }
    }
    if let Some(entry) = &project.manifest.system {
        let memory = read_entry(entry, system::build, system::validate);
        if let Some(memory) = memory.present() {
            let paths = task.scope.iter().chain(&task.check_inputs).chain(
                task.deliverables
                    .iter()
                    .map(|deliverable| &deliverable.path),
            );
            let paths: Vec<_> = paths.collect();
            let systems: Vec<_> = memory
                .systems
                .iter()
                .filter(|system| {
                    system.paths.iter().any(|path| {
                        paths
                            .iter()
                            .any(|input| task::covers(path, input) || task::covers(input, path))
                    })
                })
                .collect();
            for system in &systems {
                identities.insert(format!("system::{}", system.name), fingerprint(system));
                packs.extend(system.knowledge.clone());
            }
            for responsibility in memory.responsibilities.iter().filter(|responsibility| {
                systems
                    .iter()
                    .any(|system| system.name == responsibility.owner)
            }) {
                identities.insert(
                    format!("responsibility::{}", responsibility.name),
                    fingerprint(responsibility),
                );
            }
            for seam in memory.seams.iter().filter(|seam| {
                seam.between
                    .iter()
                    .any(|name| systems.iter().any(|system| &system.name == name))
            }) {
                identities.insert(format!("seam::{}", seam.name), fingerprint(seam));
            }
        } else {
            identities.insert(
                "memory::system".to_owned(),
                fingerprint(&(memory.state(), memory.problems())),
            );
        }
    }
    if let Some(name) = &task.goal
        && let Some(entry) = &project.manifest.goal
    {
        let memory = read_entry(entry, goal::build, goal::validate);
        if let Some(goal) = memory.present().and_then(|memory| {
            memory
                .goals
                .iter()
                .find(|goal| goal.id() == *name || goal.name == *name)
        }) {
            identities.insert(goal.id(), fingerprint(goal));
        } else {
            identities.insert(
                name.clone(),
                fingerprint(&(memory.state(), memory.problems())),
            );
        }
    }
    if let Some(entry) = &project.manifest.mission {
        let memory = read_entry(entry, mission::build, mission::validate);
        identities.insert("memory::mission".to_owned(), fingerprint(&memory.present()));
    }
    let fingerprints = knowledge_fingerprints(project);
    for pack in packs {
        identities.insert(
            format!("knowledge::{pack}"),
            fingerprints
                .get(&pack)
                .cloned()
                .unwrap_or_else(|| "unresolved".to_owned()),
        );
    }
    identities
}
