mod bounded;
pub(crate) mod delivery;
mod ready_receipts;

use super::{emit_error, error, recovery, write_json};
use blabla::memory::goal::Outcome;
use blabla::memory::{self, goal, knowledge, mission, process, system};
use blabla::project::Project;
use blabla::project::status::{StatusView, now_unix, status_view};
use blabla::project::task::{self, Finding, Opening, Task};
use blabla::skeptic::{self, ChallengeReport, Evidence};
use blabla::structure::default_providers;
use blabla::structure::falsify;
use blabla::voice::{Voice, contradiction};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Write};

#[derive(Serialize)]
struct TaskView<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    delivery: Option<serde_json::Value>,
    task: &'a Task,
    review_accepted: Option<bool>,
    review_current: Option<bool>,
    intent_disposition_current: Option<bool>,
    goal_reflection_state: Option<&'static str>,
    affected_intent: Vec<IntentView>,
    approval_current: Option<bool>,
    decisions: Vec<DecisionStateView<'a>>,
    assessment_current: Vec<bool>,
    open: bool,
    orchestrator_declared: bool,
    unresolved: usize,
    unresolved_findings: Vec<usize>,
    possibly_incomplete: bool,
    changed_since_open: Vec<String>,
    changed_elsewhere: usize,
    reviewed_target_readable: Option<bool>,
    reviewed_changed_since_open: Vec<String>,
    reviewed_changed_elsewhere: usize,
    swallowed_check_argv: Vec<String>,
    on_disk: BTreeMap<String, String>,
    routes: Vec<&'static str>,
    authority: &'static str,
}

#[derive(Serialize)]
struct IntentView {
    identity: String,
    state: &'static str,
    disposition: Option<String>,
    reason: Option<String>,
    freshness: Option<IntentFreshness>,
}

#[derive(Serialize)]
struct IntentFreshness {
    acceptance_epoch: Option<EpochChange>,
    assignment_digest_changed: bool,
    changed_paths: Vec<PathFingerprintChange>,
    changed_identities: Vec<IdentityFingerprintChange>,
    own_identity_fingerprint_changed: bool,
    claim_problems: Vec<&'static str>,
}

#[derive(Serialize)]
struct EpochChange {
    recorded: u64,
    current: u64,
}

#[derive(Serialize)]
struct FingerprintChange {
    change: &'static str,
    recorded: Option<String>,
    current: Option<String>,
}

#[derive(Serialize)]
struct PathFingerprintChange {
    path: String,
    #[serde(flatten)]
    difference: FingerprintChange,
}

#[derive(Serialize)]
struct IdentityFingerprintChange {
    identity: String,
    #[serde(flatten)]
    difference: FingerprintChange,
}

fn fingerprint_change(
    recorded: Option<Option<&str>>,
    current: Option<Option<&str>>,
) -> Option<FingerprintChange> {
    if recorded == current {
        return None;
    }
    Some(FingerprintChange {
        change: match (recorded, current) {
            (None, Some(_)) => "added",
            (Some(_), None) => "removed",
            _ => "changed",
        },
        recorded: recorded.flatten().map(str::to_owned),
        current: current.flatten().map(str::to_owned),
    })
}

fn intent_freshness(
    task: &Task,
    identity: &str,
    receipt: &task::IntentDisposition,
    current: &task::RelevantRevision,
) -> IntentFreshness {
    let recorded = &receipt.revision;
    let changed_paths = recorded
        .paths
        .keys()
        .chain(current.paths.keys())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter_map(|path| {
            fingerprint_change(
                recorded.paths.get(path).map(|value| value.as_deref()),
                current.paths.get(path).map(|value| value.as_deref()),
            )
            .map(|difference| PathFingerprintChange {
                path: path.clone(),
                difference,
            })
        })
        .collect();
    let changed_identities = recorded
        .identities
        .keys()
        .chain(current.identities.keys())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter_map(|identity| {
            fingerprint_change(
                recorded
                    .identities
                    .get(identity)
                    .map(|value| Some(value.as_str())),
                current
                    .identities
                    .get(identity)
                    .map(|value| Some(value.as_str())),
            )
            .map(|difference| IdentityFingerprintChange {
                identity: identity.clone(),
                difference,
            })
        })
        .collect();
    let mut claim_problems = Vec::new();
    match &task.accepted {
        None => claim_problems.push("acceptance-missing"),
        Some(accepted) if accepted.model != receipt.model => {
            claim_problems.push("accepted-model-mismatch")
        }
        Some(_) => {}
    }
    if !task::INTENT_DISPOSITIONS.contains(&receipt.status.as_str()) {
        claim_problems.push("invalid-status");
    }
    if receipt.reason.trim().is_empty() {
        claim_problems.push("blank-reason");
    }
    claim_problems.sort_unstable();
    IntentFreshness {
        acceptance_epoch: (recorded.acceptance_epoch != current.acceptance_epoch).then_some(
            EpochChange {
                recorded: recorded.acceptance_epoch,
                current: current.acceptance_epoch,
            },
        ),
        assignment_digest_changed: recorded.task_digest != current.task_digest,
        changed_paths,
        changed_identities,
        own_identity_fingerprint_changed: recorded.identities.get(identity)
            != current.identities.get(identity),
        claim_problems,
    }
}

fn write_intent_freshness(output: &mut impl Write, freshness: &IntentFreshness) -> io::Result<()> {
    writeln!(output, "    Shared input changes:")?;
    if let Some(epoch) = &freshness.acceptance_epoch {
        writeln!(
            output,
            "      acceptance epoch: {} -> {}",
            epoch.recorded, epoch.current
        )?;
    }
    if freshness.assignment_digest_changed {
        writeln!(
            output,
            "      assignment digest changed (includes the acceptance epoch)"
        )?;
    }
    for entry in &freshness.changed_paths {
        writeln!(
            output,
            "      path: {} ({})",
            entry.path, entry.difference.change
        )?;
    }
    for entry in &freshness.changed_identities {
        writeln!(
            output,
            "      identity: {} ({})",
            entry.identity, entry.difference.change
        )?;
    }
    if freshness.acceptance_epoch.is_none()
        && !freshness.assignment_digest_changed
        && freshness.changed_paths.is_empty()
        && freshness.changed_identities.is_empty()
    {
        writeln!(output, "      none")?;
    }
    writeln!(
        output,
        "    Own identity fingerprint: {}",
        if freshness.own_identity_fingerprint_changed {
            "changed"
        } else {
            "unchanged"
        }
    )?;
    if !freshness.claim_problems.is_empty() {
        writeln!(
            output,
            "    Claim problems: {}",
            freshness.claim_problems.join(", ")
        )?;
    }
    Ok(())
}

fn intent_revision(
    project: &Project,
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> task::RelevantRevision {
    let mut identities = review_identities(project, task);
    for identity in task
        .intent_identities
        .iter()
        .chain(task.intent_dispositions.iter().map(|entry| &entry.identity))
    {
        identities
            .entry(identity.clone())
            .or_insert_with(|| "absent".to_owned());
    }
    task::intent_revision(task, tree, identities)
}

fn goal_reflection_revision(
    project: &Project,
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> task::RelevantRevision {
    let identities = intent_revision(project, task, tree).identities;
    task::goal_reflection_revision(task, tree, identities)
}

fn goal_reflection_state(
    project: &Project,
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> Option<&'static str> {
    task.goal_reflection_required.then(|| {
        if task.goal_reflection.is_none() {
            "missing"
        } else if task::goal_reflection_current(
            task,
            &goal_reflection_revision(project, task, tree),
        ) {
            "current"
        } else {
            "stale"
        }
    })
}

fn affected_intent(
    project: &Project,
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> Vec<IntentView> {
    if !task.intent_disposition_required {
        return Vec::new();
    }
    let revision = intent_revision(project, task, tree);
    revision
        .identities
        .keys()
        .map(|identity| {
            let latest = task
                .intent_dispositions
                .iter()
                .rev()
                .find(|entry| &entry.identity == identity);
            IntentView {
                identity: identity.clone(),
                state: if latest.is_none() {
                    "missing"
                } else if task::disposition_current(task, identity, &revision) {
                    "current"
                } else {
                    "stale"
                },
                disposition: latest.map(|entry| entry.status.clone()),
                reason: latest.map(|entry| entry.reason.clone()),
                freshness: latest.map(|entry| intent_freshness(task, identity, entry, &revision)),
            }
        })
        .collect()
}

#[derive(Serialize)]
struct DecisionStateView<'a> {
    id: usize,
    status: &'static str,
    current_pick: &'a str,
}

fn view<'a>(project: &Project, task: &'a Task) -> TaskView<'a> {
    let review_current = review_freshness(project, task);
    let fingerprints = knowledge_fingerprints(project);
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    let on_disk = task
        .scope
        .iter()
        .chain(
            task.deliverables
                .iter()
                .map(|deliverable| &deliverable.path),
        )
        .chain(task.check_inputs.iter())
        .chain(task.falsify.iter())
        .map(|path| (path.clone(), task::on_disk_spelling(path, &tree)))
        .collect();
    let (changed_since_open, changed_elsewhere) =
        covered_changes(task, task::changed(task, &tree, &project.ignore));
    let reviewed = task
        .review_of
        .as_ref()
        .map(|target| task::read(&project.manifest.root, &target.task));
    let reviewed_target_readable = reviewed.as_ref().map(|read| matches!(read, Ok(Some(_))));
    let (reviewed_changed_since_open, reviewed_changed_elsewhere) = match reviewed {
        Some(Ok(Some(reviewed))) => {
            let changed = task::changed(&reviewed, &tree, &project.ignore);
            covered_changes(&reviewed, changed)
        }
        _ => (Vec::new(), 0),
    };
    let affected_intent = affected_intent(project, task, &tree);
    TaskView {
        delivery: delivery::task_view(project, task, &tree),
        goal_reflection_state: goal_reflection_state(project, task, &tree),
        intent_disposition_current: task
            .intent_disposition_required
            .then(|| affected_intent.iter().all(|entry| entry.state == "current")),
        affected_intent,
        review_accepted: task.review_of.as_ref().map(|_| task.accepted.is_some()),
        review_current,
        approval_current: review_current.map(|current| {
            current
                && task.state == "closed"
                && task.result.is_some()
                && task::tracked_readiness(task, &project.manifest.root, &project.ignore, &tree)
                    .supported
                && task::challenge_current(task, &tree)
        }),
        decisions: task
            .decisions
            .iter()
            .map(|decision| DecisionStateView {
                id: decision.id,
                status: decision.current_status(),
                current_pick: decision.current_pick(),
            })
            .collect(),
        assessment_current: task
            .assessments
            .iter()
            .map(|assessment| {
                fingerprints
                    .get(&assessment.ruling)
                    .is_some_and(|fingerprint| {
                        task::assessment_current(task, assessment, fingerprint)
                    })
            })
            .collect(),
        open: task.open(),
        orchestrator_declared: orchestrator_declared(project),
        unresolved: task.unresolved().count(),
        unresolved_findings: task.unresolved().map(|finding| finding.id).collect(),
        possibly_incomplete: recovery::foreign(recovery::running(), task.build.as_deref()),
        changed_since_open,
        changed_elsewhere,
        reviewed_target_readable,
        reviewed_changed_since_open,
        reviewed_changed_elsewhere,
        swallowed_check_argv: Vec::new(),
        on_disk,
        routes: offered_routes(task),
        authority: task::AUTHORITY,
        task,
    }
}

fn covered_changes(task: &Task, changed: Vec<&str>) -> (Vec<String>, usize) {
    let (covered, elsewhere): (Vec<&str>, Vec<&str>) = changed
        .into_iter()
        .partition(|path| task::covered(task, path));
    (
        covered.into_iter().map(str::to_owned).collect(),
        elsewhere.len(),
    )
}

fn write_changed(
    output: &mut impl Write,
    heading: &str,
    paths: &[String],
    elsewhere: usize,
) -> io::Result<()> {
    if paths.is_empty() {
        writeln!(output, "\n{heading}\n  none")?;
    } else {
        writeln!(output, "\n{heading}")?;
        for path in paths {
            writeln!(output, "  {path}")?;
        }
    }
    if elsewhere > 0 {
        writeln!(output, "  {elsewhere} more outside this task's paths")?;
    }
    Ok(())
}

pub(super) fn locked(project: &Project, json: bool, f: impl FnOnce() -> i32) -> i32 {
    match task::store::lock(&project.manifest.root) {
        Ok(_lock) => {
            let unreadable = task::unreadable(&project.manifest.root);
            if !unreadable.is_empty() {
                return emit_error(error("task", unreadable.join("; "), None), json, 2);
            }
            f()
        }
        Err(message) => emit_error(error("task", message, None), json, 2),
    }
}

fn load(project: &Project, name: &str, json: bool) -> Result<Task, i32> {
    match task::read(&project.manifest.root, name) {
        Ok(Some(task)) => Ok(task),
        Ok(None) => Err(emit_error(
            error(
                "task",
                format!(
                    "no bounded task {name:?} is recorded; blabla task show lists every recorded task and blabla task open records one"
                ),
                None,
            ),
            json,
            2,
        )),
        Err(message) => Err(emit_error(error("task", message, None), json, 2)),
    }
}

fn mutate(project: &Project, name: &str, json: bool) -> Result<Task, i32> {
    let task = load(project, name, json)?;
    if task.open() {
        return Ok(task);
    }
    Err(emit_error(
        error(
            "task",
            include_str!("text/task-recovery.md").replace("{{name}}", name),
            None,
        ),
        json,
        2,
    ))
}

fn fingerprint(value: &impl Serialize) -> String {
    let mut hash = blabla::project::Fnv::new();
    hash.write_str("task-memory-v1");
    hash.write_str(&serde_json::to_string(value).expect("memory serializes"));
    hash.finish()
}

fn knowledge_fingerprints(project: &Project) -> BTreeMap<String, String> {
    let entries: Vec<_> = project
        .manifest
        .knowledge
        .iter()
        .map(|entry| (entry.path.as_path(), entry.display.as_str()))
        .collect();
    let memory = memory::read_all(&entries, knowledge::build, knowledge::validate);
    let Some(memory) = memory.present() else {
        return BTreeMap::new();
    };
    memory
        .packs
        .iter()
        .map(|pack| {
            (
                pack.name.clone(),
                task::knowledge_fingerprint(memory, &pack.name)
                    .expect("resolved pack fingerprints"),
            )
        })
        .collect()
}

fn review_target(project: &Project, name: &str, target: &str) -> Result<Task, String> {
    let root = &project.manifest.root;
    let reviewed = task::read(root, target)?
        .ok_or_else(|| format!("no review target task {target:?} exists"))?;
    if reviewed.state == "withdrawn" {
        return Err(format!("review target {target:?} is withdrawn"));
    }
    let mut visited = vec![name.to_owned()];
    let mut next = Some(reviewed.clone());
    while let Some(current) = next {
        if visited.contains(&current.name) {
            return Err(format!("review target {target:?} creates a review cycle"));
        }
        visited.push(current.name.clone());
        next = match current.review_of {
            Some(target) => task::read(root, &target.task)?,
            None => None,
        };
    }
    Ok(reviewed)
}

fn review_dependencies(
    project: &Project,
    review: &Task,
    reviewed: &Task,
) -> BTreeMap<String, String> {
    let mut identities = review_identities(project, reviewed);
    identities.extend(review_identities(project, review));
    identities
}

fn review_freshness(project: &Project, review: &Task) -> Option<bool> {
    review.review_of.as_ref()?;
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    let mut current = review.clone();
    let mut visited = BTreeSet::new();
    while let Some(target) = &current.review_of {
        if !visited.insert(current.name.clone()) {
            return Some(false);
        }
        let Ok(Some(reviewed)) = task::read(&project.manifest.root, &target.task) else {
            return Some(false);
        };
        if task::tracking_error(&current, &project.manifest.root, &project.ignore).is_some()
            || task::tracking_error(&reviewed, &project.manifest.root, &project.ignore).is_some()
            || !task::review_current(
                &current,
                &reviewed,
                &tree,
                review_dependencies(project, &current, &reviewed),
            )
        {
            return Some(false);
        }
        current = reviewed;
    }
    Some(true)
}

fn review_identities(project: &Project, task: &Task) -> BTreeMap<String, String> {
    let mut identities = BTreeMap::new();
    let mut packs = Vec::new();
    if let Some(entry) = &project.manifest.process {
        let memory = memory::read(
            &entry.path,
            &entry.display,
            process::build,
            process::validate,
        );
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
            let models = process::permitted_models(memory, &task.role);
            identities.insert(format!("models::{}", task.role), fingerprint(&models));
        } else {
            identities.insert(
                "memory::process".to_owned(),
                fingerprint(&(memory.state(), memory.problems())),
            );
        }
    }
    if let Some(entry) = &project.manifest.system {
        let memory = memory::read(&entry.path, &entry.display, system::build, system::validate);
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
        let memory = memory::read(&entry.path, &entry.display, goal::build, goal::validate);
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
        let memory = memory::read(
            &entry.path,
            &entry.display,
            mission::build,
            mission::validate,
        );
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
    identities.extend(delivery::identities(project, task));
    identities
}

fn declared_role(project: &Project, role_name: &str) -> Option<blabla::memory::process::Role> {
    project
        .manifest
        .process
        .as_ref()
        .map(|entry| {
            blabla::memory::read(
                &entry.path,
                &entry.display,
                blabla::memory::process::build,
                blabla::memory::process::validate,
            )
        })
        .and_then(|memory| {
            memory.present().and_then(|process| {
                process
                    .roles
                    .iter()
                    .find(|role| role.name == role_name)
                    .cloned()
            })
        })
}

pub(super) fn validate_open_role(
    project: &Project,
    role_name: &str,
    json: bool,
) -> Result<(), i32> {
    let Some(entry) = &project.manifest.process else {
        return Ok(());
    };
    let memory = memory::read(
        &entry.path,
        &entry.display,
        process::build,
        process::validate,
    );
    let Some(process) = memory.present() else {
        return Err(emit_error(
            error(
                "task",
                format!(
                    "cannot resolve task role {role_name:?}: registered process {} is {}: {}; repair the registered process before opening a task",
                    entry.display,
                    memory.state(),
                    memory.problems().join("; ")
                ),
                None,
            ),
            json,
            2,
        ));
    };
    if !process.roles.is_empty() && !process.roles.iter().any(|role| role.name == role_name) {
        let mut names = process
            .roles
            .iter()
            .map(|role| role.name.as_str())
            .collect::<Vec<_>>();
        names.sort_unstable();
        return Err(emit_error(
            error(
                "task",
                format!(
                    "task role {role_name:?} is not declared in {}; declared roles: {}; choose a declared role or ask the owner to declare the intended role",
                    entry.display,
                    names.join(", ")
                ),
                None,
            ),
            json,
            2,
        ));
    }
    Ok(())
}

fn unconsulted_lens(project: &Project, role_name: &str, lenses: &[String]) -> Option<String> {
    let consulted = declared_role(project, role_name)
        .map(|role| role.consult)
        .unwrap_or_default();
    lenses
        .iter()
        .find(|lens| !consulted.contains(*lens))
        .map(|lens| {
            format!(
                "{lens:?} is not a pack role::{role_name} consults; it consults: {}",
                join_or(&consulted, "none")
            )
        })
}

fn declared_permitted_models(project: &Project, role_name: &str) -> Vec<String> {
    project
        .manifest
        .process
        .as_ref()
        .map(|entry| {
            blabla::memory::read(
                &entry.path,
                &entry.display,
                blabla::memory::process::build,
                blabla::memory::process::validate,
            )
        })
        .and_then(|memory| {
            memory
                .present()
                .map(|process| blabla::memory::process::permitted_models(process, role_name))
        })
        .unwrap_or_default()
}

fn validate_orchestrator_model(project: &Project, model: &str, json: bool) -> Result<(), i32> {
    let role = declared_role(project, task::ORCHESTRATOR_ROLE);
    match role {
        Some(_) => {
            let permitted = declared_permitted_models(project, task::ORCHESTRATOR_ROLE);
            if permitted.is_empty() || permitted.contains(&model.to_owned()) {
                Ok(())
            } else {
                Err(emit_error(
                    error(
                        "task",
                        format!(
                            "model {model:?} is not in role::orchestrator's permitted list: {}",
                            permitted.join(", ")
                        ),
                        None,
                    ),
                    json,
                    2,
                ))
            }
        }
        None => Err(emit_error(
            error("task", undeclared_role(task::ORCHESTRATOR_ROLE), None),
            json,
            2,
        )),
    }
}

fn orchestrator_declared(project: &Project) -> bool {
    declared_role(project, task::ORCHESTRATOR_ROLE).is_some()
}

fn validate_optional_orchestrator_model(
    project: &Project,
    model: &str,
    json: bool,
) -> Result<(), i32> {
    if orchestrator_declared(project) {
        validate_orchestrator_model(project, model, json)
    } else {
        Ok(())
    }
}

fn undeclared_role(role: &str) -> String {
    include_str!("text/role-undeclared.md").replace("{{role}}", role)
}

fn create(project: &Project, task: &mut Task, json: bool, swallowed: &[String]) -> i32 {
    if let Some(identity) = recovery::running() {
        task.build = Some(identity.stamp());
    }
    write_record(project, task, json, true, swallowed)
}

fn stamp(task: &mut Task, json: bool) -> Result<(), i32> {
    let identity = recovery::running();
    if let Some(identity) = identity
        && let Some(message) = recovery::refuse_write(identity, task.build.as_deref())
    {
        return Err(emit_error(error("recovery", message, None), json, 2));
    }
    if let Some(identity) = identity {
        task.build = Some(identity.stamp());
    }
    Ok(())
}

fn store(project: &Project, task: &mut Task, json: bool) -> i32 {
    store_with(project, task, json, &[])
}

fn store_with(project: &Project, task: &mut Task, json: bool, swallowed: &[String]) -> i32 {
    if let Err(exit) = stamp(task, json) {
        return exit;
    }
    write_record(project, task, json, false, swallowed)
}

fn report_leftovers(root: &std::path::Path, name: &str, failure: &io::Error) {
    let leftovers: Vec<String> = task::falsification_leftovers(root, name)
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    if leftovers.is_empty() {
        return;
    }
    eprintln!(
        "task {name:?} is recorded, but its falsify cleanup failed ({failure}); still present: {}",
        leftovers.join(", ")
    );
}

fn store_and_discard(project: &Project, task: &mut Task, json: bool) -> i32 {
    let code = store(project, task, json);
    if code == 0
        && let Err(failure) = task::store::discard_falsification(&project.manifest.root, &task.name)
    {
        report_leftovers(&project.manifest.root, &task.name, &failure);
    }
    code
}

fn write_record(
    project: &Project,
    task: &mut Task,
    json: bool,
    whole_view: bool,
    swallowed: &[String],
) -> i32 {
    let task = &*task;
    if let Err(failure) = task::write(&project.manifest.root, task) {
        return emit_error(
            error("task", format!("cannot record the task: {failure}"), None),
            json,
            2,
        );
    }
    let mut shown = view(project, task);
    shown.swallowed_check_argv = swallowed.to_vec();
    let result = if json {
        write_json(&shown)
    } else if whole_view {
        write_task(
            task,
            &project.manifest.root,
            role_floor(project, &task.role),
            &shown,
        )
    } else {
        write_task_line(task)
    };
    if result.is_ok() { 0 } else { 4 }
}

fn write_task_line(task: &Task) -> io::Result<()> {
    let mut output = io::stdout().lock();
    writeln!(
        output,
        "task::{}   {}   recorded; blabla task show {} prints the record",
        task.name,
        state_label(task),
        task.name
    )?;
    write_result_basis(&mut output, task)
}

fn write_result_basis(output: &mut impl Write, task: &Task) -> io::Result<()> {
    if let Some(task::ResultBasis::Bounded {
        reason,
        prior_run_id,
        implementation_fingerprint,
        ..
    }) = &task.result_basis
    {
        writeln!(
            output,
            "Bounded result accepted; project verification pending at acceptance.\n  Reason: {reason}\n  Prior canonical GREEN run: {prior_run_id}\n  Prior implementation fingerprint: {implementation_fingerprint}\n  This historical receipt does not replace current blabla status."
        )?;
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn open(
    project: &Project,
    opening: Opening,
    falsify: Vec<String>,
    require_intent_disposition: bool,
    require_goal_reflection: bool,
    json: bool,
    swallowed: &[String],
) -> i32 {
    open_with_delivery(
        project,
        opening,
        Vec::new(),
        falsify,
        require_intent_disposition,
        require_goal_reflection,
        json,
        swallowed,
    )
}

pub(super) fn open_with_delivery(
    project: &Project,
    mut opening: Opening,
    delivery_goals: Vec<String>,
    falsify: Vec<String>,
    require_intent_disposition: bool,
    require_goal_reflection: bool,
    json: bool,
    swallowed: &[String],
) -> i32 {
    if let Err(exit) = validate_open_role(project, &opening.role, json) {
        return exit;
    }
    let name = &opening.name;
    if require_goal_reflection && opening.goal.is_none() {
        return emit_error(
            error(
                "task",
                "required goal reflection needs a named --goal",
                None,
            ),
            json,
            2,
        );
    }
    if !blabla::memory::syntax::is_identity_safe(name) {
        return emit_error(
            error(
                "task",
                format!(
                    "{name:?} cannot name a task; a name starts with a letter or digit and continues with letters, digits, '_' or '-'"
                ),
                None,
            ),
            json,
            2,
        );
    }
    if let Some(target) = &opening.review_of
        && let Err(message) = review_target(project, &opening.name, target)
    {
        return emit_error(error("task", message, None), json, 2);
    }
    if let Some(goal) = &opening.goal
        && let Some(message) = super::project::undeclared_goal(project, goal)
    {
        return emit_error(error("task", message, None), json, 2);
    }
    if let Some(message) = unconsulted_lens(project, &opening.role, &opening.lenses) {
        return emit_error(error("task", message, None), json, 2);
    }
    let root = &project.manifest.root;
    let existing = task::read(root, name).ok().flatten();
    if !task::replaceable(existing.as_ref())
        && let Some(existing) = existing
    {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} is already recorded in state {state:?}; opening it again would replace what it holds, and a closed record is history rather than a free name. Read it with blabla task show {name}, or choose a name nothing has used",
                    state = existing.state
                ),
                None,
            ),
            json,
            2,
        );
    }
    opening.inputs = match tracked_declarations(project, "input", opening.inputs) {
        Ok(paths) => paths,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    opening.deliverables = match tracked_declarations(project, "deliverable", opening.deliverables)
    {
        Ok(paths) => paths,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    let mut recorded = task::record(
        root,
        &project.ignore,
        Opening {
            scope: match task::validate_scope(
                root,
                &opening.name,
                &opening.scope,
                &task::read_all(root),
            ) {
                Ok(scope) => scope,
                Err(message) => return emit_error(error("task", message, None), json, 2),
            },
            inputs: opening.inputs,
            deliverables: match owed_paths(project, opening.deliverables) {
                Ok(paths) => paths,
                Err(message) => return emit_error(error("task", message, None), json, 2),
            },
            ..opening
        },
        now_unix(),
    );
    if let Err(message) = delivery::pin(project, &mut recorded, &delivery_goals) {
        return emit_error(error("task", message, None), json, 2);
    }
    let falsify = match falsify_paths(project, &recorded, falsify) {
        Ok(paths) => paths,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    recorded.falsify = falsify;
    recorded.goal_reflection_required = require_goal_reflection;
    recorded.intent_disposition_required = require_intent_disposition;
    if require_intent_disposition {
        recorded.intent_identities = review_identities(project, &recorded).into_keys().collect();
    }
    if let Err(exit) = require_tracking(project, &recorded, json) {
        return exit;
    }
    if let Err(failure) =
        task::store::record_opened(&project.manifest.root, &recorded.name, &recorded.falsify)
    {
        return emit_error(
            error(
                "task",
                format!("cannot save the opened contents: {failure}"),
                None,
            ),
            json,
            2,
        );
    }
    let code = create(project, &mut recorded, json, swallowed);
    if code == 0 && !orchestrator_declared(project) {
        eprintln!(
            "task {:?} is opened, but process memory declares no role::orchestrator: task resolve, answer, confirm, withdraw, reconcile-withdrawal, unowe and attribute are refused until it does",
            recorded.name
        );
    }
    if code != 0 {
        let _ = task::store::discard_falsification(&project.manifest.root, &recorded.name);
    }
    code
}

fn tracked_declarations(
    project: &Project,
    kind: &str,
    declared: Vec<String>,
) -> Result<Vec<String>, String> {
    declared
        .into_iter()
        .map(|path| {
            task::normalize_tracked_path(&project.manifest.root, &project.ignore, kind, &path)
        })
        .collect()
}

fn require_tracking(project: &Project, task: &Task, json: bool) -> Result<(), i32> {
    match task::tracking_error(task, &project.manifest.root, &project.ignore) {
        Some(problem) => Err(emit_error(
            error("task", task::tracking_recovery(task, &problem), None),
            json,
            2,
        )),
        None => Ok(()),
    }
}

fn normalize(path: String) -> String {
    path.replace('\\', "/")
}

fn owed_paths(project: &Project, declared: Vec<String>) -> Result<Vec<String>, String> {
    let root = &project.manifest.root;
    let mut tree: Option<Vec<String>> = None;
    let mut owed = Vec::new();
    for path in declared.into_iter().map(normalize) {
        if !root.join(&path).is_dir() {
            owed.push(path);
            continue;
        }
        let files = tree.get_or_insert_with(|| {
            blabla::project::snapshot(root, &project.ignore)
                .into_keys()
                .collect::<Vec<String>>()
        });
        let under: Vec<String> = files
            .iter()
            .filter(|name| task::covers(&path, name))
            .map(|name| task::normalize_tracked_path(root, &project.ignore, "deliverable", name))
            .collect::<Result<_, _>>()?;
        if under.is_empty() {
            owed.push(path);
        } else {
            owed.extend(under);
        }
    }
    Ok(owed)
}

pub(super) fn finding(project: &Project, name: &str, statement: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let id = task.next_finding_id();
    task.findings.push(Finding {
        id,
        statement: statement.to_owned(),
        addressed: None,
        resolution: None,
    });
    let code = store(project, &mut task, json);
    if code == 0 && !json {
        println!("finding {id} recorded on task::{name}");
    }
    code
}

pub(super) fn note(project: &Project, name: &str, statement: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    task.notes.push(task::Note {
        statement: statement.to_owned(),
        unix: now_unix(),
    });
    store(project, &mut task, json)
}

pub(super) fn addressed(
    project: &Project,
    name: &str,
    id: usize,
    statement: &str,
    model: &str,
    json: bool,
) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let permitted = declared_permitted_models(project, &task.role);
    if !task::can_address_finding(&task, model, &permitted) {
        return emit_error(
            error(
                "task",
                format!(
                    "model {model:?} is not in role::{}'s permitted list: {}",
                    task.role,
                    permitted.join(", ")
                ),
                None,
            ),
            json,
            2,
        );
    }
    if declared_role(project, &task.role).is_none() {
        return emit_error(error("task", undeclared_role(&task.role), None), json, 2);
    }
    let Some(finding) = task.findings.iter_mut().find(|finding| finding.id == id) else {
        return emit_error(
            error(
                "task",
                format!("task {name:?} records no finding {id}"),
                None,
            ),
            json,
            2,
        );
    };
    finding.addressed = Some(task::Addressed {
        model: model.to_owned(),
        statement: statement.to_owned(),
        unix: now_unix(),
    });
    task.challenged = None;
    store(project, &mut task, json)
}

pub(super) fn resolve(
    project: &Project,
    name: &str,
    id: usize,
    evidence: &str,
    model: &str,
    json: bool,
) -> i32 {
    if let Err(exit) = validate_orchestrator_model(project, model, json) {
        return exit;
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let Some(finding) = task.findings.iter_mut().find(|finding| finding.id == id) else {
        return emit_error(
            error(
                "task",
                format!("task {name:?} records no finding {id}"),
                None,
            ),
            json,
            2,
        );
    };
    finding.resolution = Some(task::FindingResolution {
        evidence: evidence.to_owned(),
        model: Some(model.to_owned()),
    });
    task::attest(&mut task, "resolve", Some(model), now_unix());
    store(project, &mut task, json)
}

pub(super) struct Asked {
    pub question: Option<String>,
    pub on: Option<String>,
    pub pick: String,
    pub confidence: i64,
    pub model: String,
    pub options: Vec<String>,
}

#[derive(Serialize)]
struct DecisionView<'a> {
    task: &'a str,
    decision: &'a task::Decision,
    stands: bool,
    next: String,
}

pub(super) fn decide(project: &Project, name: &str, asked: Asked, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if let Some(blocking) = task::unanswered_decision(&task) {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} is BLOCKED on decision {}: {} (picked {} at {}%). A blocked task takes no decision; stop, nothing is recorded. {}",
                    blocking.id,
                    blocking.question,
                    blocking.pick,
                    blocking.confidence,
                    answer_route(&task, blocking)
                ),
                None,
            ),
            json,
            2,
        );
    }
    if task.state != "accepted" {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} is {}; a decision is recorded once the task is ACCEPTED. {}",
                    state_label(&task),
                    handback_guidance(&task, "accept")
                ),
                None,
            ),
            json,
            2,
        );
    }
    let permitted = declared_permitted_models(project, &task.role);
    if !task::can_address_finding(&task, &asked.model, &permitted) {
        return emit_error(
            error(
                "task",
                format!(
                    "model {:?} is not in role::{}'s permitted list: {}",
                    asked.model,
                    task.role,
                    permitted.join(", ")
                ),
                None,
            ),
            json,
            2,
        );
    }
    let Some(role) = declared_role(project, &task.role) else {
        return emit_error(error("task", undeclared_role(&task.role), None), json, 2);
    };
    let options = split_options(&asked.options);
    let recorded = match (asked.on, asked.question) {
        (Some(on), None) if options.is_empty() => task::pick(
            &mut task,
            task::Pick {
                on,
                pick: asked.pick,
                confidence: asked.confidence,
                model: asked.model,
            },
            role.floor(),
        ),
        (Some(on), _) => Err(format!(
            "task decide --on {on} takes the question text and options from question {on}, so passing them as well is refused"
        )),
        (None, Some(question)) => task::decide(
            &mut task,
            task::Question {
                question,
                options,
                pick: asked.pick,
                confidence: asked.confidence,
                model: asked.model,
            },
            role.floor(),
        ),
        (None, None) => Err(format!(
            "state the call you are unsure of as a question, or pick one the orchestrator asked with --on <question-id>; blabla task show {name} lists them"
        )),
    };
    let decision = match recorded {
        Ok(decision) => decision.clone(),
        Err(refusal) => {
            return emit_error(
                error("task", format!("{refusal}; nothing is recorded"), None),
                json,
                2,
            );
        }
    };
    if let Err(exit) = stamp(&mut task, json) {
        return exit;
    }
    if let Err(failure) = task::write(&project.manifest.root, &task) {
        return emit_error(
            error(
                "task",
                format!("cannot record the decision: {failure}"),
                None,
            ),
            json,
            2,
        );
    }
    let next = decision_route(&task, &decision);
    let result = if json {
        write_json(&DecisionView {
            task: &task.name,
            decision: &decision,
            stands: !decision.below_floor,
            next,
        })
    } else {
        let mut output = io::stdout().lock();
        writeln!(
            output,
            "task::{}   {}   decision {} {}",
            task.name,
            state_label(&task),
            decision.id,
            if decision.below_floor {
                "BLOCKS THE TASK"
            } else {
                "STANDS"
            }
        )
        .and_then(|()| writeln!(output, "  {next}"))
    };
    if result.is_ok() { 0 } else { 4 }
}

fn split_options(given: &[String]) -> Vec<String> {
    given
        .iter()
        .flat_map(|entry| entry.split(','))
        .map(|option| option.trim().to_owned())
        .collect()
}

fn decision_route(task: &Task, decision: &task::Decision) -> String {
    let pick = &decision.pick;
    let confidence = decision.confidence;
    let owner = task::floor_owner(task, decision);
    let floor = decision.floor;
    if decision.below_floor {
        return format!(
            "Stop now. Do not act on {pick}: {confidence}% is below {owner}'s floor of {floor}%, so the call is the orchestrator's and the task is BLOCKED on it. {}.",
            answer_route(task, decision)
        );
    }
    format!(
        "{pick} at {confidence}% is at or above {owner}'s floor of {floor}%, so the call stands. Act on {pick}. The orchestrator may still review it with blabla task answer {} {}.",
        task.name, decision.id
    )
}

fn pick_command(task: &Task, asked: &task::AskedQuestion) -> String {
    format!(
        "blabla task decide {} --on {} --pick <{}> --confidence <0-100> --model <id>",
        task.name,
        asked.id,
        asked.options.join("|")
    )
}

#[derive(Serialize)]
struct QuestionView<'a> {
    task: &'a str,
    question: &'a task::AskedQuestion,
    next: String,
}

pub(super) fn ask(project: &Project, name: &str, asked: task::Ask, json: bool) -> i32 {
    if declared_role(project, task::ORCHESTRATOR_ROLE).is_none() {
        return emit_error(
            error("task", undeclared_role(task::ORCHESTRATOR_ROLE), None),
            json,
            2,
        );
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let Some(role) = declared_role(project, &task.role) else {
        return emit_error(error("task", undeclared_role(&task.role), None), json, 2);
    };
    let permitted = declared_permitted_models(project, task::ORCHESTRATOR_ROLE);
    let model = asked.model.clone();
    let asked = task::Ask {
        options: split_options(&asked.options),
        ..asked
    };
    let question = match task::ask(&mut task, asked, role.floor(), &permitted) {
        Ok(question) => question.clone(),
        Err(refusal) => {
            return emit_error(
                error("task", format!("{refusal}; nothing is recorded"), None),
                json,
                2,
            );
        }
    };
    task::attest(&mut task, "ask", Some(&model), now_unix());
    if let Err(exit) = stamp(&mut task, json) {
        return exit;
    }
    if let Err(failure) = task::write(&project.manifest.root, &task) {
        return emit_error(
            error(
                "task",
                format!("cannot record the question: {failure}"),
                None,
            ),
            json,
            2,
        );
    }
    let next = format!(
        "The carrying role picks it with {}; a pick below {}% blocks the task until the orchestrator answers, and task ready is refused until it has a pick.",
        pick_command(&task, &question),
        question.floor
    );
    let result = if json {
        write_json(&QuestionView {
            task: &task.name,
            question: &question,
            next,
        })
    } else {
        let mut output = io::stdout().lock();
        writeln!(
            output,
            "task::{}   {}   question {} asked, floor {}%",
            task.name,
            state_label(&task),
            question.id,
            question.floor
        )
        .and_then(|()| writeln!(output, "  {next}"))
    };
    if result.is_ok() { 0 } else { 4 }
}

fn answer_route(task: &Task, decision: &task::Decision) -> String {
    format!(
        "The orchestrator answers with blabla task answer {name} {id} --pick <{options}> --reason \"...\" --model <id>; after that, resume with blabla task accept {name} --model <id>",
        name = task.name,
        id = decision.id,
        options = decision.options.join("|"),
    )
}

pub(super) fn answer(
    project: &Project,
    name: &str,
    id: usize,
    given: task::Answer,
    json: bool,
) -> i32 {
    if let Err(exit) = validate_orchestrator_model(project, &given.model, json) {
        return exit;
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let model = given.model.clone();
    if let Err(refusal) = task::answer(&mut task, id, given) {
        return emit_error(
            error("task", format!("{refusal}; nothing is recorded"), None),
            json,
            2,
        );
    }
    task::attest(&mut task, "answer", Some(&model), now_unix());
    store(project, &mut task, json)
}

pub(super) fn confirm(project: &Project, name: &str, model: &str, json: bool) -> i32 {
    if let Err(exit) = validate_orchestrator_model(project, model, json) {
        return exit;
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let confirmed = match task::confirm(&mut task, model, now_unix()) {
        Ok(confirmed) => confirmed,
        Err(refusal) => {
            return emit_error(
                error("task", format!("{refusal}; nothing is recorded"), None),
                json,
                2,
            );
        }
    };
    if confirmed == 0 {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} holds no unconfirmed record made under an orchestrator model while a worker carried it, so there is nothing to confirm; nothing is recorded"
                ),
                None,
            ),
            json,
            2,
        );
    }
    store(project, &mut task, json)
}

fn widen_scope(project: &Project, task: &mut Task, add: &[String]) -> Result<(), String> {
    let add = task::validate_scope(
        &project.manifest.root,
        &task.name,
        add,
        &task::read_all(&project.manifest.root),
    )?;
    for path in add {
        if !task.scope.contains(&path) {
            task.scope.push(path);
        }
    }
    delivery::pin(project, task, &[])
}

pub(super) fn widen(
    project: &Project,
    name: &str,
    add: Vec<String>,
    model: Option<&str>,
    json: bool,
) -> i32 {
    if let Some(model) = model
        && let Err(exit) = validate_optional_orchestrator_model(project, model, json)
    {
        return exit;
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if let Err(message) = widen_scope(project, &mut task, &add) {
        return emit_error(error("task", message, None), json, 2);
    }
    task::attest(&mut task, "scope", model, now_unix());
    store(project, &mut task, json)
}

pub(super) fn restate(
    project: &Project,
    name: &str,
    text: &str,
    model: Option<&str>,
    json: bool,
) -> i32 {
    if let Some(model) = model
        && let Err(exit) = validate_optional_orchestrator_model(project, model, json)
    {
        return exit;
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    text.clone_into(&mut task.statement);
    task::attest(&mut task, "statement", model, now_unix());
    store(project, &mut task, json)
}

pub(super) fn withdraw(
    project: &Project,
    name: &str,
    reason: &str,
    model: &str,
    json: bool,
) -> i32 {
    if let Err(exit) = validate_orchestrator_model(project, model, json) {
        return exit;
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    if let Err(message) =
        task::withdraw(&mut task, &tree, &project.ignore, reason, model, now_unix())
    {
        return emit_error(error("task", message, None), json, 2);
    }
    task::attest(&mut task, "withdraw", Some(model), now_unix());
    store_and_discard(project, &mut task, json)
}

pub(super) fn reconcile_withdrawal(
    project: &Project,
    name: &str,
    path: &str,
    successor: &str,
    model: &str,
    json: bool,
) -> i32 {
    if let Err(exit) = validate_orchestrator_model(project, model, json) {
        return exit;
    }
    let root = &project.manifest.root;
    let path = match task::normalize_scope(root, path) {
        Ok(path) => path,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    let mut task = match load(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let captured = task.withdrawal.as_ref().and_then(|record| {
        record
            .unresolved_paths
            .keys()
            .find(|captured| task::covers(&path, captured) && task::covers(captured, &path))
            .cloned()
    });
    let path = match (task.state.as_str(), captured) {
        ("withdrawn", Some(path)) => path,
        _ => {
            return emit_error(
                error(
                    "task",
                    "reconciliation requires a captured path on a WITHDRAWN task".to_owned(),
                    None,
                ),
                json,
                2,
            );
        }
    };
    let successor = match load(project, successor, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let tree = blabla::project::snapshot(root, &project.ignore);
    if task::tracking_error(&successor, root, &project.ignore).is_some()
        || !task::successful_successor(&successor, &tree, &path)
    {
        return emit_error(error("task", "reconciliation requires the successor CLOSED, with current successful evidence and the path covered by its inputs (its check inputs, or its write scope when it declares none) or its deliverables".to_owned(), None), json, 2);
    }
    task.withdrawal
        .as_mut()
        .expect("withdrawal checked")
        .reconciliations
        .push(task::WithdrawalReconciliation {
            revision: task::successor_revision(&successor, &tree, &path),
            path,
            successor: successor.name.clone(),
            model: model.to_owned(),
            unix: now_unix(),
            successor_closed_unix: successor.closed_unix,
        });
    task::attest(&mut task, "reconcile-withdrawal", Some(model), now_unix());
    store(project, &mut task, json)
}

pub(super) fn owe(project: &Project, name: &str, add: Vec<String>, json: bool) -> i32 {
    let add = match tracked_declarations(project, "deliverable", add) {
        Ok(paths) => paths,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let paths = match owed_paths(project, add) {
        Ok(paths) => paths,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    for path in paths {
        task::owe_path(&mut task, path);
    }
    task::attest(&mut task, "deliverable --add", None, now_unix());
    store(project, &mut task, json)
}

pub(super) fn unowe(
    project: &Project,
    name: &str,
    path: &str,
    reason: Option<&str>,
    model: Option<&str>,
    json: bool,
) -> i32 {
    let (Some(reason), Some(model)) = (reason.filter(|text| !text.trim().is_empty()), model) else {
        return emit_error(
            error(
                "task",
                "task deliverable --remove needs --reason \"...\" and --model <id>: withdrawing a deliverable is the orchestrator's decision and the record keeps why".to_owned(),
                None,
            ),
            json,
            2,
        );
    };
    if let Err(exit) = validate_orchestrator_model(project, model, json) {
        return exit;
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let path = normalize(path.to_owned());
    let withdrawn: Vec<String> = task
        .deliverables
        .iter()
        .filter(|deliverable| task::covers(&path, &deliverable.path))
        .map(|deliverable| deliverable.path.clone())
        .collect();
    if withdrawn.is_empty() {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} owes no deliverable at {path}, so there is nothing to withdraw; blabla task show {name} lists what it owes"
                ),
                None,
            ),
            json,
            2,
        );
    }
    task.deliverables
        .retain(|deliverable| !withdrawn.contains(&deliverable.path));
    let unix = now_unix();
    task.removed_deliverables
        .extend(withdrawn.into_iter().map(|path| task::RemovedDeliverable {
            path,
            reason: reason.to_owned(),
            unix,
        }));
    task::attest(&mut task, "deliverable --remove", Some(model), unix);
    store(project, &mut task, json)
}

pub(super) struct CheckAmendment {
    pub command: Option<String>,
    pub argv: Vec<String>,
    pub inputs: Vec<String>,
    pub add_scope: Vec<String>,
    pub model: Option<String>,
}

pub(super) fn declare_check(
    project: &Project,
    name: &str,
    amendment: CheckAmendment,
    json: bool,
    swallowed: &[String],
) -> i32 {
    let CheckAmendment {
        command,
        argv,
        inputs,
        add_scope,
        model,
    } = amendment;
    if let Some(model) = model.as_deref()
        && let Err(exit) = validate_optional_orchestrator_model(project, model, json)
    {
        return exit;
    }
    let inputs = match tracked_declarations(project, "input", inputs) {
        Ok(paths) => paths,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if !add_scope.is_empty()
        && let Err(message) = widen_scope(project, &mut task, &add_scope)
    {
        return emit_error(error("task", message, None), json, 2);
    }
    if let Some(cmd) = command {
        task.check = Some(cmd);
        task.check_argv = None;
    }
    if !argv.is_empty() {
        task.check_argv = Some(argv);
        task.check = None;
    }
    if inputs.is_empty()
        && let Err(message) = tracked_declarations(project, "input", task.scope.clone())
    {
        return emit_error(error("task", message, None), json, 2);
    }
    task.check_inputs = inputs;
    task.challenged = None;
    let verb = if add_scope.is_empty() {
        "check"
    } else {
        "check --add-scope"
    };
    task::attest(&mut task, verb, model.as_deref(), now_unix());
    store_with(project, &mut task, json, swallowed)
}

pub(super) fn close_bounded(
    project: &Project,
    name: &str,
    model: &str,
    reason: &str,
    json: bool,
) -> i32 {
    bounded::close(project, name, model, reason, json)
}

struct CloseDecision {
    task: Task,
    model: String,
    delivery_context: Option<String>,
}

fn record_close(project: &Project, mut decision: CloseDecision, json: bool) -> i32 {
    let current = match delivery::recheck_close(
        project,
        &decision.task.name,
        &decision.delivery_context,
        &decision.model,
        json,
    ) {
        Ok(current) => current,
        Err(exit) => return exit,
    };
    if let Some(current) = current {
        let mut refreshed =
            match inspect_close(&current, &decision.task.name, &decision.model, json) {
                Ok(refreshed) => refreshed,
                Err(exit) => return exit,
            };
        if refreshed.delivery_context != decision.delivery_context {
            return emit_error(
                error(
                    "task",
                    "delivery close context changed before result recording",
                    None,
                ),
                json,
                2,
            );
        }
        return store_and_discard(&current, &mut refreshed.task, json);
    }
    store_and_discard(project, &mut decision.task, json)
}

pub(super) fn close(project: &Project, name: &str, model: &str, json: bool) -> i32 {
    match inspect_close(project, name, model, json) {
        Ok(decision) => record_close(project, decision, json),
        Err(exit) => exit,
    }
}

#[cfg(test)]
fn close_with_checkpoint(
    project: &Project,
    name: &str,
    model: &str,
    checkpoint: impl FnOnce(),
) -> i32 {
    let decision = match inspect_close(project, name, model, true) {
        Ok(decision) => decision,
        Err(exit) => return exit,
    };
    checkpoint();
    record_close(project, decision, true)
}

fn inspect_close(
    project: &Project,
    name: &str,
    model: &str,
    json: bool,
) -> Result<CloseDecision, i32> {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return Err(exit),
    };
    if let Err(exit) = require_tracking(project, &task, json) {
        return Err(exit);
    }
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    if task.state == "ready" && !task::challenge_current(&task, &tree) {
        return Err(emit_error(
            error(
                "task",
                format!(
                    "task {name:?} changed since its challenge; resume with blabla task accept {name} --model <id>, verify and challenge again before hand-back"
                ),
                None,
            ),
            json,
            2,
        ));
    }
    if !task.delivery_obligations.is_empty() || !task.delivery_reviews.is_empty() {
        if model.trim().is_empty() {
            return Err(emit_error(
                error(
                    "task",
                    "delivery result acceptance requires an owner model",
                    None,
                ),
                json,
                2,
            ));
        }
        validate_orchestrator_model(project, model, json)?;
    }
    let delivery_context = match delivery::close_context(project, &task, json) {
        Ok(context) => context,
        Err(exit) => return Err(exit),
    };
    let evaluation = super::project::evaluate_with_run_state(project);
    let structure = project.verify_structure();
    let status = status_view(project, &evaluation, &structure);
    let report = report_for(
        project,
        &status,
        Some(&task),
        Err(skeptic::GOALS_NOT_JUDGED),
    );
    let standing = report
        .grounded
        .iter()
        .filter(|class| **class != "withdrawal-residue")
        .count();
    if !task::accept_result(
        &mut task,
        &tree,
        &project.ignore,
        standing,
        model,
        now_unix(),
    ) {
        return Err(emit_error(
            error(
                "task",
                format!(
                    "the result of {name:?} is not accepted: {reason}. blabla challenge {name} states what stands",
                    reason = if standing == 0 {
                        format!(
                            "state {state:?} is not a hand-back awaiting a decision",
                            state = task.state
                        )
                    } else {
                        format!(
                            "{standing} grounded challenge(s) stand against it{unconfirmed}",
                            unconfirmed = unconfirmed_guidance(&task)
                        )
                    }
                ),
                None,
            ),
            json,
            2,
        ));
    }
    Ok(CloseDecision {
        task,
        model: model.to_owned(),
        delivery_context,
    })
}

fn unconfirmed_guidance(task: &Task) -> String {
    match task.unconfirmed_during_carry().count() {
        0 => String::new(),
        count => format!(
            "; {count} record(s) made under an orchestrator model while a worker carried the task are unconfirmed, so review them in blabla task show {name} and confirm them with blabla task confirm {name} --model <id>, or undo them",
            name = task.name
        ),
    }
}

pub(super) fn show(project: &Project, name: Option<&str>, json: bool) -> i32 {
    let Some(name) = name else {
        let tasks = task::read_all(&project.manifest.root);
        let views: Vec<TaskView<'_>> = tasks.iter().map(|task| view(project, task)).collect();
        let result = if json {
            write_json(&views)
        } else {
            write_tasks(&tasks)
        };
        return if result.is_ok() { 0 } else { 4 };
    };
    let task = match load(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let result = if json {
        write_json(&view(project, &task))
    } else {
        write_task(
            &task,
            &project.manifest.root,
            role_floor(project, &task.role),
            &view(project, &task),
        )
        .and_then(|()| write_resolution(&resolved(project, &task)))
    };
    if result.is_ok() { 0 } else { 4 }
}

fn role_floor(project: &Project, role: &str) -> Option<u8> {
    declared_role(project, role).map(|role| role.floor())
}

fn write_resolution(resolution: &task::Resolution) -> io::Result<()> {
    let out = io::stdout();
    let mut out = out.lock();
    writeln!(out, "Resolved for this assignment:")?;
    writeln!(
        out,
        "  models permitted   {}",
        join_or(&resolution.models, "none declared by the role")
    )?;
    writeln!(
        out,
        "  lenses consulted   {}",
        join_or(&resolution.lenses, "none")
    )?;
    writeln!(out, "  verification tier  {}", resolution.verification)?;
    writeln!(
        out,
        "  contracts in scope {}",
        join_or(&resolution.requirements, "none touch this scope")
    )?;
    writeln!(
        out,
        "  blabla explain role::<name>   the authority behind these; this view is a summary"
    )?;
    Ok(())
}

fn join_or(values: &[String], empty: &str) -> String {
    if values.is_empty() {
        empty.to_owned()
    } else {
        values.join("  ")
    }
}

pub(super) fn accept(project: &Project, name: &str, model: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if !task::apply(&mut task, "accepted") {
        let reason = match task::unanswered_decision(&task) {
            Some(decision) => format!(
                "task {name:?} is BLOCKED on decision {}: {} (options {}; picked {} at {}%). Only the orchestrator's answer settles it, so it cannot be resumed yet. {}",
                decision.id,
                decision.question,
                decision.options.join(", "),
                decision.pick,
                decision.confidence,
                answer_route(&task, decision)
            ),
            None => format!(
                "task {name:?} state {state:?} → \"accepted\" is not allowed",
                state = task.state
            ),
        };
        return emit_error(error("task", reason, None), json, 2);
    }
    let current_tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    if let Some(target) = task.review_of.as_ref().map(|target| target.task.clone()) {
        let reviewed = match review_target(project, name, &target) {
            Ok(reviewed) => reviewed,
            Err(message) => return emit_error(error("task", message, None), json, 2),
        };
        let revision = task::review_revision(
            &task,
            &reviewed,
            &current_tree,
            review_dependencies(project, &task, &reviewed),
        );
        task.review_of = Some(task::ReviewTarget {
            task: target,
            revision,
        });
    }
    if let Err(message) = delivery::pin(project, &mut task, &[]) {
        return emit_error(error("task", message, None), json, 2);
    }
    task::record_acceptance(&mut task, &current_tree, &project.ignore, model, now_unix());
    store(project, &mut task, json)
}

pub(super) fn block(project: &Project, name: &str, reason: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if !task::apply(&mut task, "blocked") {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} state {state:?} → \"blocked\" is not allowed",
                    state = task.state
                ),
                None,
            ),
            json,
            2,
        );
    }
    task.findings.push(Finding {
        id: task.next_finding_id(),
        statement: reason.to_owned(),
        addressed: None,
        resolution: None,
    });
    store(project, &mut task, json)
}

pub(super) fn ready(project: &Project, name: &str, json: bool) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if let Err(exit) = require_tracking(project, &task, json) {
        return exit;
    }
    let evaluation = super::project::evaluate_with_run_state(project);
    let structure = project.verify_structure();
    let status = status_view(project, &evaluation, &structure);
    let report = report_for(
        project,
        &status,
        Some(&task),
        Err(skeptic::GOALS_NOT_JUDGED),
    );
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    if let Err(next) = task::mark_ready(&mut task, &tree, report.assignment_blockers().len()) {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} cannot be handed back from {state:?}: {guidance}",
                    state = task.state,
                    guidance = handback_guidance(&task, next)
                ),
                None,
            ),
            json,
            2,
        );
    }
    store(project, &mut task, json)
}

fn handback_guidance(task: &Task, next: &str) -> String {
    let name = &task.name;
    match next {
        "accept" if task.state == "blocked" => {
            let unresolved: Vec<usize> = task.unresolved().map(|finding| finding.id).collect();
            let resume = format!("then blabla task accept {name} --model <id> resumes the task");
            if unresolved.is_empty() {
                format!(
                    "BLOCKED; the orchestrator settles the block (scope, check or an answer), {resume}"
                )
            } else {
                format!(
                    "BLOCKED on unresolved findings {unresolved:?}; the orchestrator settles them first (scope, check or an answer), {resume}"
                )
            }
        }
        "accept" => format!("accept or resume it with blabla task accept {name} --model <id>"),
        "await-answer" => match task::unanswered_decision(task) {
            Some(decision) => format!(
                "decision {} ({}) is below {}'s floor and has no answer, so the task stays BLOCKED. {}",
                decision.id,
                decision.question,
                task::floor_owner(task, decision),
                answer_route(task, decision)
            ),
            None => "no decision is waiting for an answer".to_owned(),
        },
        "pick-question" => match task.unpicked().next() {
            Some(asked) => format!(
                "the orchestrator asked question {} ({}) and it has no pick; pick it with {}",
                asked.id,
                asked.question,
                pick_command(task, asked)
            ),
            None => "every question the orchestrator asked has a pick".to_owned(),
        },
        "declare-check" => format!(
            "ask the orchestrator to declare its check with blabla task check {name} \"<command>\""
        ),
        "record-evidence" if task.check_argv.is_some() => format!(
            "run its declared check with blabla task evidence {name} --run, which records the exit code BlaBla observes"
        ),
        "record-evidence" => format!(
            "run its declared check, then record the actual result with blabla task evidence {name} --exit <code> --tool <label>"
        ),
        "challenge" | "resolve-challenge" => format!(
            "run blabla challenge {name}, reconcile assignment blockers, then retry the hand-back"
        ),
        "review" => "it is already READY; review and result acceptance belong to the orchestrator"
            .to_owned(),
        "closed" => "it is CLOSED; open a new assignment for new work".to_owned(),
        _ => "the task record has an invalid state".to_owned(),
    }
}

pub(super) fn lens(
    project: &Project,
    name: &str,
    lens: &str,
    statement: &str,
    model: Option<&str>,
    json: bool,
) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if let Some(model) = model
        && task
            .accepted
            .as_ref()
            .map(|accepted| accepted.model.as_str())
            != Some(model)
    {
        return emit_error(
            error(
                "task",
                format!(
                    "model {model:?} did not accept this task; the lens is recorded by the accepted model"
                ),
                None,
            ),
            json,
            2,
        );
    }
    let fingerprint = knowledge_fingerprints(project).get(lens).cloned();
    let consulted = declared_role(project, &task.role)
        .is_some_and(|role| role.consult.iter().any(|pack| pack == lens));
    if task.state != "accepted" || task.accepted.is_none() || !consulted || fingerprint.is_none() {
        return emit_error(
            error(
                "task",
                "a lens must name a resolved pack consulted by the accepted task's role",
                None,
            ),
            json,
            2,
        );
    }
    task.assessments.push(task::Assessment {
        model: task
            .accepted
            .as_ref()
            .map(|accepted| accepted.model.clone()),
        acceptance_epoch: Some(task.acceptance_epoch),
        knowledge_fingerprint: fingerprint,
        ruling: lens.to_owned(),
        statement: statement.to_owned(),
        unix: now_unix(),
    });
    store(project, &mut task, json)
}

pub(super) fn disposition(
    project: &Project,
    name: &str,
    identity: &str,
    status: &str,
    reason: &str,
    model: &str,
    refresh_ready: bool,
    json: bool,
) -> i32 {
    if refresh_ready {
        return ready_receipts::refresh(
            project,
            name,
            ready_receipts::Claim::Disposition {
                identity: identity.to_owned(),
                status: status.to_owned(),
                reason: reason.to_owned(),
                model: model.to_owned(),
            },
            json,
        );
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if let Err(exit) = require_tracking(project, &task, json) {
        return exit;
    }
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    let revision = intent_revision(project, &task, &tree);
    let record = task::IntentDisposition {
        identity: identity.to_owned(),
        status: status.to_owned(),
        reason: reason.to_owned(),
        model: model.to_owned(),
        unix: now_unix(),
        revision,
    };
    if let Err(message) = task::record_disposition(&mut task, record) {
        return emit_error(error("task", message, None), json, 2);
    }
    store(project, &mut task, json)
}

pub(super) fn reflect(
    project: &Project,
    name: &str,
    decision: String,
    observation: String,
    evidence_refs: Vec<String>,
    reason: String,
    outcome: task::GoalReflectionOutcome,
    model: String,
    refresh_ready: bool,
    json: bool,
) -> i32 {
    if refresh_ready {
        return ready_receipts::refresh(
            project,
            name,
            ready_receipts::Claim::Reflection {
                decision,
                observation,
                evidence_refs,
                reason,
                outcome,
                model,
            },
            json,
        );
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if let Err(exit) = require_tracking(project, &task, json) {
        return exit;
    }
    if let Some(goal) = &task.goal
        && let Some(message) = super::project::undeclared_goal(project, goal)
    {
        return emit_error(error("task", message, None), json, 2);
    }
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    let reflection = task::GoalReflection {
        decision,
        observation,
        evidence_refs,
        reason,
        outcome,
        model,
        unix: now_unix(),
        revision: goal_reflection_revision(project, &task, &tree),
    };
    if let Err(message) = task::record_goal_reflection(&mut task, reflection) {
        return emit_error(error("task", message, None), json, 2);
    }
    store(project, &mut task, json)
}

pub(super) fn propose_model(
    project: &Project,
    name: &str,
    model: &str,
    reason: &str,
    json: bool,
) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    task.exceptions.push(task::Exception {
        acceptance_epoch: task.accepted.as_ref().map(|_| task.acceptance_epoch),
        superseded: false,
        model: model.to_owned(),
        reason: reason.to_owned(),
        approval: None,
    });
    store(project, &mut task, json)
}

pub(super) fn approve_model(
    project: &Project,
    name: &str,
    model: &str,
    approval: &str,
    json: bool,
) -> i32 {
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let Some(exception) = task.exceptions.iter_mut().find(|exception| {
        !exception.superseded && exception.model == model && exception.approval.is_none()
    }) else {
        return emit_error(
            error(
                "E_NO_PROPOSAL",
                format!("no unresolved model exception for {model} is recorded on {name}"),
                None,
            ),
            json,
            3,
        );
    };
    exception.approval = Some(approval.to_owned());
    task::attest(&mut task, "approve-model", None, now_unix());
    store(project, &mut task, json)
}

pub(super) fn attribute(
    project: &Project,
    name: &str,
    paths: &[String],
    kind: &str,
    model: &str,
    json: bool,
) -> i32 {
    if !task::ATTRIBUTIONS.contains(&kind) {
        return emit_error(
            error(
                "task",
                format!(
                    "{kind:?} does not name an origin; BlaBla records {}",
                    task::ATTRIBUTIONS.join(", ")
                ),
                None,
            ),
            json,
            2,
        );
    }
    if let Err(exit) = validate_orchestrator_model(project, model, json) {
        return exit;
    }
    let mut task = match mutate(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    let changed: Vec<String> = task::changed(&task, &tree, &project.ignore)
        .into_iter()
        .map(str::to_owned)
        .collect();
    for path in paths {
        let path = normalize(path.to_owned());
        let inside = format!("{}/", path.trim_end_matches('/'));
        if !changed
            .iter()
            .any(|moved| *moved == path || moved.starts_with(&inside))
        {
            return emit_error(
                error(
                    "task",
                    format!(
                        "{path} has not changed since the task opened, so there is nothing to attribute; blabla challenge {name} names the paths that have"
                    ),
                    None,
                ),
                json,
                2,
            );
        }
        let digest = blabla::project::digest_of(&project.manifest.root, &path);
        task.attributions.retain(|entry| entry.path != path);
        task.attributions.push(task::Attribution {
            path,
            kind: kind.to_owned(),
            digest,
            model: Some(model.to_owned()),
        });
    }
    task::attest(&mut task, "attribute", Some(model), now_unix());
    store(project, &mut task, json)
}

fn require_current_review(project: &Project, task: &Task, json: bool) -> Result<(), i32> {
    if review_freshness(project, task) == Some(false) {
        return Err(emit_error(
            error(
                "task",
                "the reviewed target changed; reaccept this review before recording evidence",
                None,
            ),
            json,
            2,
        ));
    }
    Ok(())
}

fn accepted_for_evidence(project: &Project, name: &str, json: bool) -> Result<Task, i32> {
    let task = mutate(project, name, json)?;
    if task.state != "accepted" || task.accepted.is_none() {
        return Err(emit_error(
            error(
                "task",
                format!(
                    "task {name:?} must be accepted before recording evidence; {}",
                    handback_guidance(&task, "accept")
                ),
                None,
            ),
            json,
            2,
        ));
    }
    Ok(task)
}

fn tree_fingerprint(tree: &std::collections::BTreeMap<String, String>) -> String {
    let mut hasher = blabla::project::Fnv::new();
    for (path, digest) in tree {
        hasher.write_str(path);
        hasher.write_str(digest);
    }
    hasher.finish()
}

#[allow(clippy::too_many_arguments)]
fn record_evidence(
    project: &Project,
    task: &mut Task,
    check: String,
    exit: i32,
    tool: &str,
    command: Option<Vec<String>>,
    log: Option<String>,
    json: bool,
) -> i32 {
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    let inputs = task::evidence_inputs(task, &tree);
    task.evidence.push(task::Evidence {
        identity: task::declared_check(task),
        acceptance_epoch: Some(task.acceptance_epoch),
        check,
        exit,
        tree: tree_fingerprint(&tree),
        tool: tool.to_owned(),
        unix: now_unix(),
        inputs,
        command,
        log,
    });
    store(project, task, json)
}

pub(super) fn evidence(project: &Project, name: &str, exit: i32, tool: &str, json: bool) -> i32 {
    let mut task = match accepted_for_evidence(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if let Err(exit) = require_tracking(project, &task, json) {
        return exit;
    }
    if let Err(exit) = require_current_review(project, &task, json) {
        return exit;
    }
    let Some(check) = task.check.clone() else {
        let message = if task.check_argv.is_some() {
            format!(
                "task {name:?} declares its check as a program and its arguments; {}",
                handback_guidance(&task, "record-evidence")
            )
        } else {
            format!(
                "task {name:?} declares no check, so a result cannot be bound to one. The orchestrator declares one with blabla task check {name} \"<command>\"; ask which check covers this work rather than choosing one"
            )
        };
        return emit_error(error("task", message, None), json, 2);
    };
    record_evidence(project, &mut task, check, exit, tool, None, None, json)
}

pub(super) fn evidence_run(project: &Project, name: &str, json: bool) -> i32 {
    let initial_lock = match task::store::lock(&project.manifest.root) {
        Ok(lock) => lock,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    let task = match accepted_for_evidence(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if let Err(exit) = require_tracking(project, &task, json) {
        return exit;
    }
    if let Err(exit) = require_current_review(project, &task, json) {
        return exit;
    }
    let Some(argv) = task.check_argv.clone().filter(|argv| !argv.is_empty()) else {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} declares no argv check, so --run cannot execute it; the orchestrator declares one with blabla task check {name} --argv <prog> <arg>..."
                ),
                None,
            ),
            json,
            2,
        );
    };
    let root = &project.manifest.root;
    let tree = blabla::project::snapshot(root, &project.ignore);
    let input_digests = task::evidence_inputs(&task, &tree);
    let identity = task::declared_check(&task);
    let acceptance_epoch = task.acceptance_epoch;
    let scratch = task::scratch_directory(root, name);
    if let Err(failure) = std::fs::create_dir_all(&scratch) {
        return emit_error(
            error(
                "task",
                format!("cannot create {}: {failure}", scratch.display()),
                None,
            ),
            json,
            2,
        );
    }
    let log_name = format!(
        "evidence-{}-{}-{}.log",
        task.evidence.len() + 1,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    drop(initial_lock);
    let output = match std::process::Command::new(&argv[0])
        .args(&argv[1..])
        .current_dir(root)
        .output()
    {
        Ok(output) => output,
        Err(failure) => {
            return emit_error(
                error("task", format!("cannot spawn {}: {failure}", argv[0]), None),
                json,
                2,
            );
        }
    };
    let Some(exit) = output.status.code() else {
        return emit_error(
            error(
                "task",
                format!(
                    "{} ended without an exit code; nothing is recorded",
                    argv[0]
                ),
                None,
            ),
            json,
            2,
        );
    };
    if let Err(failure) = std::fs::write(
        scratch.join(&log_name),
        [output.stdout, output.stderr].concat(),
    ) {
        return emit_error(
            error("task", format!("cannot write {log_name}: {failure}"), None),
            json,
            2,
        );
    }
    let log = format!("{}/{log_name}", task::scratch_label(name));
    let _completion_lock = match task::store::lock(root) {
        Ok(lock) => lock,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    let mut reloaded = match accepted_for_evidence(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if reloaded.opened_unix != task.opened_unix || reloaded.opened_tree != task.opened_tree {
        return emit_error(
            error(
                "task",
                format!("task {name:?} was replaced while its check ran; nothing is recorded"),
                None,
            ),
            json,
            2,
        );
    }
    let evidence = task::Evidence {
        identity,
        acceptance_epoch: Some(acceptance_epoch),
        check: argv.join(" "),
        exit,
        tree: tree_fingerprint(&tree),
        tool: "run".to_owned(),
        unix: now_unix(),
        inputs: input_digests,
        command: Some(argv),
        log: Some(log),
    };
    task::apply_evidence(&mut reloaded, evidence);
    let code = store(project, &mut reloaded, json);
    if code == 0
        && !json
        && let Some(latest) = reloaded.evidence.last()
        && write_evidence_receipt(&mut io::stdout().lock(), latest).is_err()
    {
        return 4;
    }
    code
}

fn falsify_paths(
    project: &Project,
    task: &Task,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let root = &project.manifest.root;
    paths
        .iter()
        .map(|path| {
            let normalized = task::normalize_scope(root, path)?;
            if !task.in_scope(&normalized) {
                return Err(format!(
                    "falsify path {path:?} is outside the write scope of task {:?}; only files the task may write can be falsified",
                    task.name
                ));
            }
            if root.join(&normalized).is_dir() {
                return Err(format!("falsify path {path:?} is a directory; name a file"));
            }
            Ok(normalized)
        })
        .collect()
}

pub(super) fn falsify(project: &Project, name: &str, json: bool) -> i32 {
    let root = &project.manifest.root;
    let lock = match task::store::lock(root) {
        Ok(lock) => lock,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    let task = match accepted_for_evidence(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if task.falsify.is_empty() {
        return emit_error(
            error(
                "task",
                format!("task {name:?} names no paths to falsify; open it with --falsify PATH"),
                None,
            ),
            json,
            2,
        );
    }
    if let Err(exit) = require_tracking(project, &task, json) {
        return exit;
    }
    if let Err(exit) = require_current_review(project, &task, json) {
        return exit;
    }
    let Some(argv) = task.check_argv.clone().filter(|argv| !argv.is_empty()) else {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} declares no argv check, so falsify cannot execute it; the orchestrator declares one with blabla task check {name} --argv <prog> <arg>..."
                ),
                None,
            ),
            json,
            2,
        );
    };
    let scratch = task::scratch_directory(root, name);
    let copy = task::falsify_copy_directory(root, name);
    if let Err(failure) = std::fs::create_dir_all(&scratch) {
        return emit_error(
            error(
                "task",
                format!("cannot create {}: {failure}", scratch.display()),
                None,
            ),
            json,
            2,
        );
    }
    drop(lock);
    let tree = match stage_copy(project, &copy) {
        Ok(tree) => tree,
        Err(message) => {
            let _ = std::fs::remove_dir_all(&copy);
            return emit_error(error("task", message, None), json, 2);
        }
    };
    let inputs = task::evidence_inputs(&task, &tree);
    let runs = run_in_copy(project, &task, name, &argv, &copy, &scratch, json);
    let _ = std::fs::remove_dir_all(&copy);
    let (current, opened) = match runs {
        Ok(runs) => runs,
        Err(exit) => return exit,
    };
    let _completion = match task::store::lock(root) {
        Ok(lock) => lock,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    let mut reloaded = match accepted_for_evidence(project, name, json) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    if reloaded.opened_unix != task.opened_unix || reloaded.opened_tree != task.opened_tree {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} was replaced while its falsify run ran; nothing is recorded"
                ),
                None,
            ),
            json,
            2,
        );
    }
    reloaded.falsifications.push(task::Falsification {
        acceptance_epoch: task.acceptance_epoch,
        check: argv.join(" "),
        current_exit: current.exit,
        current_log: current.log,
        opened_exit: opened.as_ref().map(|run| run.exit),
        opened_log: opened.map(|run| run.log),
        unix: now_unix(),
        inputs,
    });
    let code = store(project, &mut reloaded, json);
    if code == 0
        && !json
        && let Some(latest) = reloaded.falsifications.last()
        && write_falsification_receipt(&mut io::stdout().lock(), latest).is_err()
    {
        return 4;
    }
    code
}

struct FalsifyRun {
    exit: i32,
    log: String,
}

fn stage_copy(
    project: &Project,
    copy: &std::path::Path,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    if copy.exists() {
        std::fs::remove_dir_all(copy)
            .map_err(|failure| format!("cannot clear {}: {failure}", copy.display()))?;
    }
    let root = &project.manifest.root;
    let files: Vec<String> = blabla::project::snapshot(root, &project.ignore)
        .into_keys()
        .collect();
    task::store::copy_into(root, copy, &files)
        .map_err(|failure| format!("cannot copy the tree for falsify: {failure}"))?;
    Ok(blabla::project::snapshot(copy, &project.ignore))
}

fn run_in_copy(
    project: &Project,
    task: &Task,
    name: &str,
    argv: &[String],
    copy: &std::path::Path,
    scratch: &std::path::Path,
    json: bool,
) -> Result<(FalsifyRun, Option<FalsifyRun>), i32> {
    let label = task::scratch_label(name);
    let number = task.falsifications.len() + 1;
    let stamp = now_unix();
    let current = run_check(
        argv,
        copy,
        scratch,
        &label,
        &format!("falsify-{number}-current-{stamp}.log"),
        json,
    )?;
    if current.exit != 0 {
        return Ok((current, None));
    }
    let opened_directory = task::store::opened_directory(&project.manifest.root, name);
    if let Err(failure) = task::store::apply_opened(copy, &opened_directory, &task.falsify) {
        return Err(emit_error(
            error(
                "task",
                format!("cannot place the opened contents in the copy: {failure}"),
                None,
            ),
            json,
            2,
        ));
    }
    let opened = run_check(
        argv,
        copy,
        scratch,
        &label,
        &format!("falsify-{number}-opened-{stamp}.log"),
        json,
    )?;
    Ok((current, Some(opened)))
}

fn run_check(
    argv: &[String],
    dir: &std::path::Path,
    scratch: &std::path::Path,
    label: &str,
    log_name: &str,
    json: bool,
) -> Result<FalsifyRun, i32> {
    let output = match std::process::Command::new(&argv[0])
        .args(&argv[1..])
        .current_dir(dir)
        .output()
    {
        Ok(output) => output,
        Err(failure) => {
            return Err(emit_error(
                error("task", format!("cannot spawn {}: {failure}", argv[0]), None),
                json,
                2,
            ));
        }
    };
    let Some(exit) = output.status.code() else {
        return Err(emit_error(
            error(
                "task",
                format!(
                    "{} ended without an exit code; nothing is recorded",
                    argv[0]
                ),
                None,
            ),
            json,
            2,
        ));
    };
    if let Err(failure) = std::fs::write(
        scratch.join(log_name),
        [output.stdout, output.stderr].concat(),
    ) {
        return Err(emit_error(
            error("task", format!("cannot write {log_name}: {failure}"), None),
            json,
            2,
        ));
    }
    Ok(FalsifyRun {
        exit,
        log: format!("{label}/{log_name}"),
    })
}

fn write_falsification_receipt(
    output: &mut impl Write,
    falsification: &task::Falsification,
) -> io::Result<()> {
    let opened = falsification
        .opened_exit
        .map_or_else(|| "not run".to_owned(), |exit| exit.to_string());
    writeln!(
        output,
        "\nFalsification:\n  acceptance epoch {}   current exit {}   opened exit {opened}",
        epoch_label(Some(falsification.acceptance_epoch)),
        falsification.current_exit
    )?;
    writeln!(output, "  current log {}", falsification.current_log)?;
    if let Some(log) = &falsification.opened_log {
        writeln!(output, "  opened log {log}")?;
    }
    Ok(())
}

pub(super) fn challenge(project: &Project, name: Option<&str>, json: bool) -> i32 {
    let root = &project.manifest.root;
    let mut selected = match name {
        Some(name) => match load(project, name, json) {
            Ok(task) => Some(task),
            Err(exit) => return exit,
        },
        None => {
            let mut open: Vec<Task> = task::read_all(root)
                .into_iter()
                .filter(Task::open)
                .collect();
            let tasks = task::read_all(root);
            let tree = blabla::project::snapshot(root, &project.ignore);
            let residue = tasks.iter().any(|task| {
                !task::tracked_withdrawal_residue(task, &tasks, &tree, root, &project.ignore)
                    .is_empty()
            });
            if open.len() > 1 && !residue {
                let names: Vec<String> = open
                    .iter()
                    .map(|task| format!("blabla challenge {}", task.name))
                    .collect();
                return emit_error(
                    error(
                        "task",
                        format!(
                            "{} bounded tasks are open, so there is no single one to challenge; run one of: {}",
                            open.len(),
                            names.join(" | ")
                        ),
                        None,
                    ),
                    json,
                    2,
                );
            }
            if open.len() > 1 { None } else { open.pop() }
        }
    };
    let evaluation = super::project::evaluate_with_run_state(project);
    let structure = project.verify_structure();
    let status = status_view(project, &evaluation, &structure);
    let goals = match selected {
        None => super::project::goal_outcomes(project, &evaluation, &status),
        Some(_) => Err(skeptic::GOALS_NOT_JUDGED),
    };
    let report = report_for(
        project,
        &status,
        selected.as_ref(),
        goals.as_deref().map_err(|reason| *reason),
    );
    let tree = blabla::project::snapshot(root, &project.ignore);
    let blockers = report.assignment_blockers();
    let mut assignment_clear = None;
    if let Some(task) = selected.as_mut() {
        if task.state == "ready"
            && blockers.is_empty()
            && task::tracked_readiness(task, root, &project.ignore, &tree).supported
            && task::challenge_current(task, &tree)
        {
            assignment_clear = Some(true);
        } else if task.state == "accepted"
            || (task.state == "ready"
                && task.challenged.is_none()
                && (task.intent_disposition_required || task.goal_reflection_required))
        {
            let recorded = task::record_challenge(task, &tree, blockers.len(), now_unix());
            if let Some(identity) = recovery::running() {
                if let Some(message) = recovery::refuse_write(identity, task.build.as_deref()) {
                    return emit_error(error("recovery", message, None), json, 2);
                }
                task.build = Some(identity.stamp());
            }
            if let Err(failure) = task::write(root, task) {
                return emit_error(
                    error("task", format!("cannot record challenge: {failure}"), None),
                    json,
                    2,
                );
            }
            assignment_clear = Some(recorded);
        } else if task.open() {
            assignment_clear = Some(
                task.state == "ready"
                    && blockers.is_empty()
                    && task::tracked_readiness(
                        task,
                        &project.manifest.root,
                        &project.ignore,
                        &tree,
                    )
                    .supported
                    && task::challenge_current(task, &tree),
            );
        }
    }
    let result = if json {
        let mut view = serde_json::to_value(&report).expect("challenge serializes");
        view["assignment_clear"] = serde_json::json!(assignment_clear);
        write_json(&view)
    } else {
        let scoped = if let Some(clear) = assignment_clear {
            let task = selected.as_ref().expect("selected task");
            let detail = if clear {
                let next = if task.state == "accepted" {
                    format!("hand back now with blabla task ready {}; ", task.name)
                } else {
                    String::new()
                };
                format!(
                    "current assignment evidence and challenge support hand-back; {next}project-wide verification remains the orchestrator's"
                )
            } else {
                handback_guidance(
                    task,
                    task::handback(task, &tree)
                        .err()
                        .unwrap_or("resolve-challenge"),
                )
            };
            writeln!(
                io::stdout().lock(),
                "\nAssignment check: {} — {detail}",
                if clear { "CLEAR" } else { "BLOCKED" }
            )
        } else {
            Ok(())
        };
        scoped.and_then(|()| write_challenge(&report, project.manifest.voice))
    };
    if result.is_err() {
        return 4;
    }
    assignment_clear.map_or_else(|| report.exit_code(), |clear| if clear { 0 } else { 1 })
}

pub(super) fn report_for(
    project: &Project,
    status: &StatusView,
    selected: Option<&Task>,
    goals: Result<&[Outcome], &'static str>,
) -> ChallengeReport {
    let root = &project.manifest.root;
    let tree = blabla::project::snapshot(root, &project.ignore);
    let resolution = selected.map(|task| resolved(project, task));
    let other_tasks = task::read_all(root);
    let evidence = Evidence {
        task: selected,
        tree: &tree,
        completion: status.completion.state,
        completion_reason: &status.completion.reason,
        falsify: &|| falsify::falsify(&project.structure, root, &default_providers()),
        role: resolution.as_ref(),
        other_tasks: &other_tasks,
    };
    let mut report = skeptic::challenge_tracked_against(&evidence, goals, root, &project.ignore);
    if selected.is_none() && goals.is_ok() {
        let unmet = delivery::unmet_done(project);
        skeptic::add_delivery_goal_challenge(&mut report, &unmet);
    }
    report
}

pub(super) fn standing(project: &Project, status: &StatusView) -> ChallengeReport {
    let mut open: Vec<Task> = task::read_all(&project.manifest.root)
        .into_iter()
        .filter(Task::open)
        .collect();
    let selected = if open.len() == 1 { open.pop() } else { None };
    report_for(
        project,
        status,
        selected.as_ref(),
        Err(skeptic::GOALS_NOT_JUDGED),
    )
}

pub(super) fn write_challenge(report: &ChallengeReport, voice: Voice) -> io::Result<()> {
    let mut output = io::stdout().lock();
    write_challenge_into(&mut output, report, voice)
}

pub(super) fn write_challenge_into(
    output: &mut impl Write,
    report: &ChallengeReport,
    voice: Voice,
) -> io::Result<()> {
    match &report.task {
        Some(name) => writeln!(output, "CHALLENGE  bounded task {name}")?,
        None => writeln!(output, "CHALLENGE  no bounded task is open")?,
    }
    match &report.challenge {
        Some(challenge) => {
            writeln!(
                output,
                "\n{}\n",
                contradiction(voice, challenge.class.word(), &challenge.statement)
            )?;
            writeln!(output, "Evidence:")?;
            for line in &challenge.evidence {
                writeln!(output, "  {line}")?;
            }
            writeln!(output, "\nReconcile:\n  {}", challenge.reconcile)?;
            writeln!(output, "\nClass: {}", challenge.class.word())?;
            let waiting: Vec<&str> = report
                .assignment_blockers
                .iter()
                .chain(report.project_challenges.iter())
                .copied()
                .filter(|class| *class != challenge.class.word())
                .collect();
            if !waiting.is_empty() {
                writeln!(
                    output,
                    "Also standing, one challenge at a time: {}",
                    waiting.join(", ")
                )?;
            }
        }
        None => {
            writeln!(
                output,
                "\nNothing here can be challenged from the evidence BlaBla holds."
            )?;
        }
    }
    if !report.ungrounded.is_empty() {
        writeln!(output, "\nNot grounded:")?;
        for (class, reason) in &report.ungrounded {
            writeln!(output, "  {class}: {reason}")?;
        }
    }
    writeln!(output, "\n{}", report.authority)?;
    for limit in skeptic::LIMITS {
        writeln!(output, "{limit}")?;
    }
    Ok(())
}

fn read_last_lines(path: &std::path::Path, count: usize) -> io::Result<Vec<String>> {
    let contents = std::fs::read_to_string(path)?;
    Ok(contents
        .lines()
        .filter(|line| !line.trim().is_empty())
        .rev()
        .take(count)
        .map(|s| s.to_owned())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect())
}

fn write_failing_evidence(
    output: &mut impl Write,
    root: &std::path::Path,
    evidence: &task::Evidence,
) -> io::Result<()> {
    if evidence.tool != "run" || evidence.exit == 0 {
        return Ok(());
    }

    if let Some(log_path_str) = &evidence.log {
        let log_path = root.join(log_path_str);
        match read_last_lines(&log_path, 20) {
            Ok(lines) if !lines.is_empty() => {
                writeln!(output, "  Last {} non-empty lines:", lines.len())?;
                for line in lines {
                    writeln!(output, "    {}", line)?;
                }
            }
            Ok(_) => {
                writeln!(output, "  (log file is empty or contains only whitespace)")?;
            }
            Err(_) => {
                writeln!(output, "  (could not read log file)")?;
            }
        }
    }
    Ok(())
}

fn write_evidence_receipt(output: &mut impl Write, evidence: &task::Evidence) -> io::Result<()> {
    writeln!(
        output,
        "\nLatest evidence:\n  tool {}   acceptance epoch {}   exit {}",
        evidence.tool,
        epoch_label(evidence.acceptance_epoch),
        evidence.exit
    )?;
    if let Some(log) = &evidence.log {
        writeln!(output, "  log {log}")?;
    }
    Ok(())
}

fn epoch_label(epoch: Option<u64>) -> String {
    epoch.map_or_else(|| "none".to_owned(), |epoch| epoch.to_string())
}

fn write_evidence(output: &mut impl Write, root: &std::path::Path, task: &Task) -> io::Result<()> {
    if let Some(latest) = task.evidence.last() {
        write_evidence_receipt(output, latest)?;
        write_failing_evidence(output, root, latest)?;
    }
    if !task.assessments.is_empty() {
        writeln!(output, "\nLens assessments:")?;
        for assessment in &task.assessments {
            writeln!(
                output,
                "  {} by {} at acceptance epoch {}: {}",
                assessment.ruling,
                assessment.model.as_deref().unwrap_or("none"),
                epoch_label(assessment.acceptance_epoch),
                assessment.statement
            )?;
        }
    }
    Ok(())
}

fn write_task(
    task: &Task,
    root: &std::path::Path,
    floor: Option<u8>,
    view: &TaskView<'_>,
) -> io::Result<()> {
    let mut output = io::stdout().lock();
    let shown = |path: &String| {
        view.on_disk
            .get(path)
            .map_or_else(|| path.clone(), Clone::clone)
    };
    writeln!(output, "task::{}   {}", task.name, state_label(task))?;
    write_result_basis(&mut output, task)?;
    if let Some(delivery) = &view.delivery {
        writeln!(output, "\nApplicable delivery outcomes:")?;
        for obligation in delivery["obligations"].as_array().into_iter().flatten() {
            writeln!(
                output,
                "  {}: {} ({}) current {}",
                obligation["goal"],
                obligation["statement"],
                obligation["basis"],
                obligation["current"]
            )?;
        }
    }
    writeln!(output, "\nStatement:\n  {}", task.statement)?;
    writeln!(output, "\nCarried by:\n  role::{}", task.role)?;
    if let Some(goal) = &task.goal {
        writeln!(output, "\nServes goal::{goal}")?;
    }
    writeln!(
        output,
        "\nWrite scope:\n  {}",
        if task.scope.is_empty() {
            "none declared".to_owned()
        } else {
            task.scope
                .iter()
                .map(&shown)
                .collect::<Vec<String>>()
                .join("  ")
        }
    )?;
    writeln!(
        output,
        "\nDeliverables:\n  {}",
        if task.deliverables.is_empty() {
            "none declared".to_owned()
        } else {
            task.deliverables
                .iter()
                .map(|deliverable| shown(&deliverable.path))
                .collect::<Vec<String>>()
                .join("  ")
        }
    )?;
    writeln!(
        output,
        "\nCheck inputs (plus deliverables):\n  {}",
        if task.check_inputs.is_empty() {
            format!(
                "write scope: {}",
                task.scope
                    .iter()
                    .map(&shown)
                    .collect::<Vec<String>>()
                    .join("  ")
            )
        } else {
            task.check_inputs
                .iter()
                .map(&shown)
                .collect::<Vec<String>>()
                .join("  ")
        }
    )?;
    writeln!(
        output,
        "\nFalsify paths:\n  {}",
        if task.falsify.is_empty() {
            "none declared".to_owned()
        } else {
            task.falsify
                .iter()
                .map(&shown)
                .collect::<Vec<String>>()
                .join("  ")
        }
    )?;
    if let Some(latest) = task.falsifications.last() {
        write_falsification_receipt(&mut output, latest)?;
    }
    write_changed(
        &mut output,
        "Changed since open:",
        &view.changed_since_open,
        view.changed_elsewhere,
    )?;
    if task.review_of.is_some() {
        if view.reviewed_target_readable == Some(false) {
            writeln!(output, "\nReviewed target: unreadable or missing")?;
        } else {
            write_changed(
                &mut output,
                "Reviewed target changed since open:",
                &view.reviewed_changed_since_open,
                view.reviewed_changed_elsewhere,
            )?;
        }
    }
    if task.findings.is_empty() {
        writeln!(output, "\nFindings:\n  none recorded")?;
    } else {
        writeln!(output, "\nFindings:")?;
        for finding in &task.findings {
            writeln!(output, "  {} {}", finding.id, finding.statement)?;
            if let Some(addressed) = &finding.addressed {
                writeln!(
                    output,
                    "    addressed by {}: {}",
                    addressed.model, addressed.statement
                )?;
            }
            match &finding.resolution {
                Some(resolution) => {
                    writeln!(output, "    resolved: {}", resolution.evidence)?;
                    if let Some(model) = &resolution.model {
                        writeln!(output, "    by {model}")?;
                    }
                }
                None if finding.addressed.is_some() => {
                    writeln!(output, "    awaiting the orchestrator's resolution")?
                }
                None => writeln!(output, "    UNRESOLVED")?,
            }
        }
    }
    if view.review_accepted == Some(false) {
        let target = task.review_of.as_ref().expect("review target");
        writeln!(
            output,
            "\nReview of task::{}: NOT ACCEPTED YET; current approval: NO",
            target.task
        )?;
    } else if let Some(current) = view.review_current {
        let target = task.review_of.as_ref().expect("review target");
        writeln!(
            output,
            "\nReview of task::{}: {}; current approval: {}",
            target.task,
            if current { "CURRENT" } else { "STALE" },
            if view.approval_current == Some(true) {
                "YES"
            } else {
                "NO"
            }
        )?;
        if !current {
            writeln!(
                output,
                "  Reaccept an open review to inspect the changed target; a CLOSED review remains historical and new work needs a new review task"
            )?;
        }
    }
    if task.state == "ready" && (task.intent_disposition_required || task.goal_reflection_required)
    {
        writeln!(
            output,
            "  Explicit --refresh-ready may renew one manual disposition/reflection with the same still-permitted model when check and recursive targets remain current; then run blabla challenge {}. Changed work requires reacceptance and evidence",
            task.name
        )?;
    }
    if task.intent_disposition_required {
        writeln!(
            output,
            "\nAffected intent disposition: REQUIRED ({})",
            if view.intent_disposition_current == Some(true) {
                "CURRENT"
            } else {
                "INCOMPLETE"
            }
        )?;
        for entry in &view.affected_intent {
            writeln!(
                output,
                "  {}  {}",
                entry.identity,
                entry.state.to_uppercase()
            )?;
            if let Some(reason) = &entry.reason {
                writeln!(
                    output,
                    "    {}: {reason}",
                    entry.disposition.as_deref().unwrap_or("unrecorded")
                )?;
            }
            if entry.state == "stale"
                && let Some(freshness) = &entry.freshness
            {
                write_intent_freshness(&mut output, freshness)?;
            }
        }
        writeln!(
            output,
            "  Assignment digests do not identify changed fields; directory fingerprints do not identify changed child files. Shared input changes do not establish a semantic change to each identity."
        )?;
        writeln!(
            output,
            "  blabla task disposition {} IDENTITY --status updated|confirmed-unchanged --reason TEXT --model MODEL",
            task.name
        )?;
        writeln!(
            output,
            "  Reasons are accountable review claims; they never mark goals done or replace evidence, scope or contract authority."
        )?;
    }
    if let Some(state) = view.goal_reflection_state {
        writeln!(
            output,
            "\nGoal reflection: REQUIRED ({})",
            state.to_uppercase()
        )?;
        if let Some(reflection) = &task.goal_reflection {
            writeln!(
                output,
                "  {} by {}: {}",
                reflection.outcome.word(),
                reflection.model,
                reflection.decision
            )?;
            writeln!(output, "  Observed: {}", reflection.observation)?;
            writeln!(
                output,
                "  Evidence references: {}",
                reflection.evidence_refs.join("; ")
            )?;
            writeln!(output, "  Why this follows now: {}", reflection.reason)?;
            match &reflection.outcome {
                task::GoalReflectionOutcome::Successor {
                    recommendation,
                    owner,
                    dependencies,
                    observable_outcome,
                } => {
                    writeln!(
                        output,
                        "  Recommended successor: {recommendation}\n  Proposed owner: {owner}\n  Dependencies: {}\n  Observable outcome: {observable_outcome}",
                        if dependencies.is_empty() {
                            "none stated".to_owned()
                        } else {
                            dependencies.join("; ")
                        }
                    )?;
                }
                task::GoalReflectionOutcome::Blocked {
                    blocker,
                    owner,
                    unblock_when,
                } => {
                    writeln!(
                        output,
                        "  Blocker: {blocker}\n  Proposed owner: {owner}\n  Unblock when: {unblock_when}"
                    )?;
                }
                task::GoalReflectionOutcome::CompletionRecommended
                | task::GoalReflectionOutcome::NoUsefulSuccessor => {}
            }
        }
        writeln!(
            output,
            "  blabla task reflect {} --outcome successor|blocked|completion-recommended|no-useful-successor --decision TEXT --observation TEXT --evidence-ref TEXT --reason TEXT --model MODEL",
            task.name
        )?;
        writeln!(
            output,
            "  Recommendations and evidence references are accountable claims, not authenticated authority or semantic proof. Reflection never creates work, changes a goal or decides project completion."
        )?;
    }
    write_questions(&mut output, task)?;
    write_decisions(&mut output, task, floor)?;
    write_orchestrator_records(&mut output, task)?;
    if !task.notes.is_empty() {
        writeln!(output, "\nNotes:")?;
        for note in &task.notes {
            writeln!(output, "  {}", note.statement)?;
        }
    }
    if !task.removed_deliverables.is_empty() {
        writeln!(output, "\nRemoved deliverables:")?;
        for removed in &task.removed_deliverables {
            writeln!(output, "  {} — {}", removed.path, removed.reason)?;
        }
    }
    if let Some(withdrawal) = &task.withdrawal {
        writeln!(
            output,
            "\nWITHDRAWN by {}: {}",
            withdrawal.model, withdrawal.reason
        )?;
        for (path, digest) in &withdrawal.unresolved_paths {
            writeln!(
                output,
                "  captured residue {path}: {}",
                digest.as_deref().unwrap_or("absent")
            )?;
        }
        for record in &withdrawal.reconciliations {
            writeln!(
                output,
                "  reconciliation {} -> {} by {} at revision {}",
                record.path,
                record.successor,
                record.model,
                record.revision.fingerprint()
            )?;
        }
        writeln!(
            output,
            "  Withdrawal releases ownership and grants no completion credit; restore captured paths or reconcile them against a current CLOSED successor"
        )?;
    }
    write_evidence(&mut output, root, task)?;
    write_routes(&mut output, task)?;
    writeln!(output, "\n{}", task::AUTHORITY)
}

fn write_questions(output: &mut impl Write, task: &Task) -> io::Result<()> {
    if task.questions.is_empty() {
        return writeln!(output, "\nQuestions from the orchestrator:\n  none asked");
    }
    writeln!(
        output,
        "\nQuestions from the orchestrator (task ready is refused while one has no pick):"
    )?;
    let (unpicked, picked): (Vec<&task::AskedQuestion>, Vec<&task::AskedQuestion>) = task
        .questions
        .iter()
        .partition(|asked| task::picked_by(task, &asked.id).is_none());
    for asked in unpicked.into_iter().chain(picked) {
        writeln!(output, "  {} {}", asked.id, asked.question)?;
        writeln!(
            output,
            "    {}: {}   floor {}%   asked by {}",
            asked.kind,
            asked.options.join(", "),
            asked.floor,
            asked.model
        )?;
        match task::picked_by(task, &asked.id) {
            Some(decision) => writeln!(
                output,
                "    picked {} at {}% in decision {}",
                decision.pick, decision.confidence, decision.id
            )?,
            None => writeln!(output, "    NO PICK: {}", pick_command(task, asked))?,
        }
    }
    Ok(())
}

fn write_decisions(output: &mut impl Write, task: &Task, floor: Option<u8>) -> io::Result<()> {
    let floor = match floor {
        Some(0) => format!(
            "role::{} sets a 0% decision floor, so no decision blocks the task",
            task.role
        ),
        Some(floor) => format!(
            "role::{} blocks the task on a decision below {floor}% confidence",
            task.role
        ),
        None => format!("role::{} is not declared, so no floor is read", task.role),
    };
    if task.decisions.is_empty() {
        return writeln!(output, "\nDecisions ({floor}):\n  none recorded");
    }
    writeln!(output, "\nDecisions ({floor}):")?;
    for decision in &task.decisions {
        match &decision.on {
            Some(asked) => writeln!(
                output,
                "  {} {}   on question {asked}",
                decision.id, decision.question
            )?,
            None => writeln!(output, "  {} {}", decision.id, decision.question)?,
        }
        writeln!(
            output,
            "    {}: {}   picked {} at {}% by {}   {}",
            decision.kind,
            decision.options.join(", "),
            decision.pick,
            decision.confidence,
            decision.model,
            match decision.current_status() {
                "blocked" => format!("BLOCKS THE TASK, below {}%", decision.floor),
                "answered" => "ANSWERED".to_owned(),
                "overruled" => "OVERRULED".to_owned(),
                _ => "STANDS".to_owned(),
            }
        )?;
        match &decision.answer {
            Some(answer) => writeln!(
                output,
                "    answered {} by {}{}: {}",
                answer.pick,
                answer.model,
                if answer.pick == decision.pick {
                    ", holding the pick".to_owned()
                } else {
                    format!(", overruling {}", decision.pick)
                },
                answer.reason
            )?,
            None if decision.below_floor => writeln!(
                output,
                "    no answer yet: stop, do not act on {}. {}",
                decision.pick,
                answer_route(task, decision)
            )?,
            None => {}
        }
    }
    Ok(())
}

fn write_orchestrator_records(output: &mut impl Write, task: &Task) -> io::Result<()> {
    let mut carriers: Vec<&str> = Vec::new();
    for carrier in task
        .recorded_during_carry()
        .filter_map(|record| record.carried_by.as_deref())
    {
        if !carriers.contains(&carrier) {
            carriers.push(carrier);
        }
    }
    for carrier in carriers {
        writeln!(
            output,
            "\nRecorded under an orchestrator model while {carrier} carried the task:"
        )?;
        for record in task
            .recorded_during_carry()
            .filter(|record| record.carried_by.as_deref() == Some(carrier))
        {
            writeln!(
                output,
                "  {}   {}   {}",
                record.verb,
                record.model.as_deref().map_or_else(
                    || "no --model given".to_owned(),
                    |model| format!("--model {model}")
                ),
                match &record.confirmed {
                    Some(confirmation) => format!("confirmed by {}", confirmation.model),
                    None => "UNCONFIRMED".to_owned(),
                }
            )?;
        }
    }
    if task.unconfirmed_during_carry().next().is_some() {
        writeln!(
            output,
            "  --model is an attestation, not proof. After hand-back the orchestrator reviews each record and confirms it with blabla task confirm {} --model <id>, or undoes it; task close is refused until every record here is confirmed",
            task.name
        )?;
    }
    Ok(())
}

pub(super) const ROUTES: [&str; 11] = [
    "accept",
    "check",
    "blocker",
    "note",
    "finding",
    "addressed",
    "decide",
    "lens",
    "challenge",
    "falsify",
    "hand-back",
];

fn route_states(route: &str) -> &'static [&'static str] {
    match route {
        "accept" => &["open", "blocked", "ready"],
        "check" => &[
            "open",
            "accepted",
            "blocked",
            "ready",
            "closed",
            "withdrawn",
        ],
        "blocker" | "note" | "addressed" | "decide" | "hand-back" => {
            &["open", "accepted", "blocked"]
        }
        "finding" | "challenge" => &["open", "accepted", "blocked", "ready"],
        "lens" | "falsify" => &["accepted"],
        _ => &[],
    }
}

fn check_lines(name: &str, check: Option<&str>, check_argv: Option<&[String]>) -> Vec<String> {
    match (check_argv, check) {
        (Some(argv), _) => vec![
            format!("\nDeclared check:\n  {}", argv.join(" ")),
            format!(
                "  blabla task evidence {name} --run   BlaBla runs exactly that program and records the exit code it observed"
            ),
        ],
        (None, Some(check)) => vec![
            format!("\nDeclared check:\n  {check}"),
            include_str!("text/route-check-instruction.md").to_owned(),
            format!(
                "  blabla task evidence {name} --exit <code> --tool <tool>   record what the whole run reported; when {check} exits 0 that is --exit 0 --tool check"
            ),
        ],
        (None, None) => vec![include_str!("text/route-check-none-declared.md").to_owned()],
    }
}

fn render_route(
    route: &str,
    name: &str,
    check: Option<&str>,
    check_argv: Option<&[String]>,
    state: Option<&str>,
) -> Vec<String> {
    match route {
        "accept" => vec![format!(
            "\n  blabla task accept {name} --model <id>   {}",
            if matches!(state, Some("blocked" | "ready")) {
                "take the assignment again before changing anything; a BLOCKED or READY task resumes by being accepted"
            } else {
                "take the assignment before changing anything; unaccepted work is challenged as work done outside BlaBla"
            }
        )],
        "check" if matches!(state, Some("ready" | "closed" | "withdrawn")) => {
            let declared = check_lines(name, check, check_argv);
            vec![declared[0].clone()]
        }
        "check" => check_lines(name, check, check_argv),
        "blocker" => vec![format!(
            "  blabla task block {name} \"...\"   record the blocker and stop"
        )],
        "note" => vec![format!(
            "  blabla task note {name} \"...\"   keep a note on the record; a note is not a finding and blocks nothing"
        )],
        "finding" => vec![format!(
            "  blabla task finding {name} \"...\"   record unsettled work; it blocks hand-back until it is addressed or resolved"
        )],
        "addressed" => vec![format!(
            "  blabla task addressed {name} <id> \"...\" --model <id>   say what you did about a finding; the orchestrator still resolves it"
        )],
        "decide" => vec![format!(
            "  blabla task decide {name} \"<question>\" --pick <option> --confidence <0-100> --model <id>   a call you are not sure of (a cause, a name, a behavior the statement leaves open) is asked, not guessed; --options a,b,c for a choice; --on <question-id> in place of the question picks one the orchestrator asked. BLOCKS THE TASK means stop now and do not act on your pick until the orchestrator answers"
        )],
        "lens" => vec![format!(
            "  blabla task lens {name} <pack> \"...\"   one assessment against one lens the role consults"
        )],
        "challenge" => vec![if state == Some("ready") {
            format!(
                "  READY: hand-back recorded; await orchestrator review; closing task {name} is orchestrator-owned"
            )
        } else {
            format!(
                "  blabla challenge {name}   ask BlaBla for one contradiction grounded in the record and tree; no challenge is recorded until the command runs"
            )
        }],
        "falsify" => vec![format!(
            "  blabla task falsify {name}   runs the declared check in a copy of the tree on the current files, then on the falsify paths as they were at open; hand-back waits until it passed, then failed"
        )],
        "hand-back" => vec![format!(
            "  blabla task ready {name}   hand back for review; closing it is the orchestrator's, never yours"
        )],
        _ => Vec::new(),
    }
}

pub(super) fn route_text(
    route: &str,
    name: &str,
    check: Option<&str>,
    check_argv: Option<&[String]>,
    state: Option<&str>,
) -> Vec<String> {
    match state {
        Some(state) if !route_states(route).contains(&state) => Vec::new(),
        _ => render_route(route, name, check, check_argv, state),
    }
}

pub(super) fn routes_text(name: &str, check: Option<&str>) -> String {
    ROUTES
        .iter()
        .filter(|route| {
            route_states(route)
                .iter()
                .any(|state| matches!(*state, "open" | "accepted"))
        })
        .flat_map(|route| route_text(route, name, check, None, None))
        .map(|line| format!("{line}\n"))
        .collect()
}

fn route_lines(route: &str, task: &Task) -> Vec<String> {
    if route == "falsify" && task.falsify.is_empty() {
        return Vec::new();
    }
    route_text(
        route,
        &task.name,
        task.check.as_deref(),
        task.check_argv.as_deref(),
        Some(&task.state),
    )
}

fn offered_routes(task: &Task) -> Vec<&'static str> {
    ROUTES
        .into_iter()
        .filter(|route| !route_lines(route, task).is_empty())
        .collect()
}

fn write_routes(output: &mut impl Write, task: &Task) -> io::Result<()> {
    writeln!(
        output,
        "\nScratch:\n  .blabla/{}/{}   working space; not a deliverable and outside the tree snapshot",
        task::SCRATCH_DIRECTORY,
        task.name
    )?;
    for route in ROUTES {
        for line in route_lines(route, task) {
            writeln!(output, "{line}")?;
        }
        if route == ROUTES[0] {
            for line in pick_lines(task) {
                writeln!(output, "{line}")?;
            }
        }
    }
    Ok(())
}

fn pick_lines(task: &Task) -> Vec<String> {
    if !matches!(task.state.as_str(), "open" | "accepted" | "ready") {
        return Vec::new();
    }
    task.unpicked()
        .map(|asked| {
            format!(
                "\n  {}   the orchestrator asked {} ({}); pick it before anything else, since task ready is refused until every question has a pick",
                pick_command(task, asked),
                asked.id,
                asked.question
            )
        })
        .collect()
}

fn write_tasks(tasks: &[Task]) -> io::Result<()> {
    let mut output = io::stdout().lock();
    if tasks.is_empty() {
        writeln!(output, "No bounded task is recorded.")?;
        return writeln!(
            output,
            "  blabla task open <name> --role <role> --statement \"...\" --scope <path> --deliverable <path>"
        );
    }
    writeln!(output, "Bounded tasks:")?;
    for task in tasks {
        writeln!(
            output,
            "  task::{}   {}   role::{}   {} unresolved",
            task.name,
            state_label(task),
            task.role,
            task.unresolved().count()
        )?;
    }
    writeln!(output, "\n  blabla task show <name>   one task in full")?;
    writeln!(output, "\n{}", task::AUTHORITY)
}

fn state_label(task: &Task) -> String {
    task.state.to_ascii_uppercase()
}

pub(super) fn resolved(project: &Project, task: &Task) -> task::Resolution {
    let role = declared_role(project, &task.role);
    let contracts: Vec<(String, Vec<String>)> = project
        .structure
        .iter()
        .map(|contract| {
            (
                format!(
                    "contract::{}",
                    contract.group.clone().unwrap_or_else(|| "?".to_owned())
                ),
                contract
                    .modules
                    .iter()
                    .map(|module| module.display.clone())
                    .collect(),
            )
        })
        .collect();
    let mut resolution = match role {
        Some(role) => {
            let permitted = declared_permitted_models(project, &task.role);
            task::resolve(
                task,
                &permitted,
                &role.consult,
                role.verification.as_deref().unwrap_or("unstated"),
                &contracts,
            )
        }
        None => task::resolve(task, &[], &[], "unstated", &contracts),
    };
    if !task.lenses.is_empty() {
        resolution.lenses.clone_from(&task.lenses);
    }
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    resolution.delivery_claims_pending = delivery::claims_pending(project, task, &tree);
    resolution.knowledge_fingerprints = knowledge_fingerprints(project);
    resolution.review_current = review_freshness(project, task);
    if task.goal_reflection_required {
        let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
        resolution.goal_reflection_current =
            Some(goal_reflection_state(project, task, &tree) == Some("current"));
    }
    if task.intent_disposition_required {
        let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
        resolution.intent_disposition_pending = Some(
            affected_intent(project, task, &tree)
                .into_iter()
                .filter(|entry| entry.state != "current")
                .map(|entry| entry.identity)
                .collect(),
        );
    }
    resolution
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn probe_task(check: Option<&str>) -> Task {
        task::record(
            std::path::Path::new("."),
            &blabla::project::ignore::Ignore::default(),
            Opening {
                name: "probe".to_owned(),
                role: "worker".to_owned(),
                statement: "probe".to_owned(),
                check: check.map(str::to_owned),
                ..Default::default()
            },
            0,
        )
    }

    #[test]
    fn every_declared_route_puts_a_line_in_the_assignment_view() {
        let mut task = probe_task(Some("cargo test --lib structure"));
        task.falsify = vec![String::from("src/cli/task.rs")];
        for route in ROUTES {
            let states = route_states(route);
            assert!(!states.is_empty(), "route {route} belongs to no state");
            for state in states {
                task.state = (*state).to_owned();
                assert!(
                    !route_lines(route, &task).is_empty(),
                    "route {route} writes nothing in state {state}"
                );
            }
            assert!(
                !route_text(route, "probe", Some("cargo test"), None, None).is_empty(),
                "route {route} writes nothing in the state-free loop text"
            );
        }
        task.state = "closed".to_owned();
        assert!(
            ROUTES
                .iter()
                .filter(|route| **route != "check")
                .all(|route| route_lines(route, &task).is_empty())
        );
        assert!(route_lines("no-such-route", &task).is_empty());
        assert!(route_states("no-such-route").is_empty());
    }

    #[test]
    fn a_worker_view_never_names_the_product_gate() {
        let mut task = probe_task(Some("cargo test --lib structure"));
        for state in task::STATES {
            task.state = state.to_owned();
            let text: String = ROUTES
                .iter()
                .flat_map(|route| route_lines(route, &task))
                .collect();
            assert!(!text.contains("blabla finish"), "{state}: {text}");
        }
    }

    #[test]
    fn the_lens_route_is_offered_while_the_task_is_accepted_and_not_after_hand_back() {
        let mut task = probe_task(Some("cargo test --lib structure"));
        task.state = "accepted".to_owned();
        assert!(!route_lines("lens", &task).is_empty());
        task.state = "ready".to_owned();
        assert!(route_lines("lens", &task).is_empty());
    }

    #[test]
    fn the_evidence_guidance_names_the_route_an_argv_check_takes() {
        let mut task = probe_task(None);
        task.check_argv = Some(vec!["cargo".to_owned(), "test".to_owned()]);
        let guidance = handback_guidance(&task, "record-evidence");
        assert!(
            guidance.contains("blabla task evidence probe --run"),
            "{guidance}"
        );
        assert!(!guidance.contains("--exit"), "{guidance}");
    }

    #[test]
    fn an_undeclared_check_says_so_instead_of_naming_one() {
        let declared = route_lines("check", &probe_task(Some("cargo test")));
        let absent = route_lines("check", &probe_task(None));
        assert!(declared.iter().any(|line| line.contains("cargo test")));
        assert!(!absent.iter().any(|line| line.contains("cargo test")));
        assert_eq!(absent.len(), 1);
    }

    fn write(root: &std::path::Path, relative: &str, text: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, text).unwrap();
    }

    fn setup_project() -> (TempDir, blabla::project::Project) {
        let temp = TempDir::new().unwrap();
        let root = temp.path();

        write(
            root,
            "project.bla",
            "project Test\nuse behavior \"core.bla\"\n\nverify behavior {\n    command [\"true\"]\n    seed 1\n    cases 1\n    steps 1\n    timeout_ms 100\n    shrink_budget 1\n}\n",
        );
        write(
            root,
            "core.bla",
            "state x: int\n\naction inc()\n\nwhen inc {\n    expect \"change\": after.x > before.x\n}\n",
        );

        let project = blabla::project::load(
            blabla::project::read_manifest(&root.join("project.bla")).unwrap(),
        )
        .unwrap();
        (temp, project)
    }

    #[test]
    fn accept_legal_transition_recorded() {
        let (_temp, project) = setup_project();
        let opening = task::Opening {
            name: "test-accept".to_owned(),
            role: "worker".to_owned(),
            statement: "Test accept transition".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/main.rs".to_owned()],
            ..Default::default()
        };
        let root = &project.manifest.root;
        let task = task::record(root, &project.ignore, opening, 0);
        task::write(root, &task).unwrap();

        let exit = accept(&project, "test-accept", "model-id", false);
        assert_eq!(exit, 0, "accept should succeed");

        let loaded = task::read(root, "test-accept").unwrap().unwrap();
        assert_eq!(loaded.state, "accepted", "state should be accepted");
        assert!(loaded.accepted.is_some(), "accepted should be recorded");
        assert_eq!(
            loaded.accepted.unwrap().model,
            "model-id",
            "model should match input"
        );
    }

    #[test]
    fn block_illegal_transition_refused() {
        let (_temp, project) = setup_project();
        let opening = task::Opening {
            name: "test-block".to_owned(),
            role: "worker".to_owned(),
            statement: "Test block transition".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/main.rs".to_owned()],
            ..Default::default()
        };
        let root = &project.manifest.root;
        let task = task::record(root, &project.ignore, opening, 0);
        task::write(root, &task).unwrap();

        let exit = block(&project, "test-block", "some reason", false);
        assert_ne!(exit, 0, "block from open should fail");

        let loaded = task::read(root, "test-block").unwrap().unwrap();
        assert_eq!(loaded.state, "open", "state should remain open");
        assert!(loaded.findings.is_empty(), "findings should be empty");
    }

    #[test]
    fn ready_not_setting_result() {
        let (_temp, project) = setup_project();
        let opening = task::Opening {
            name: "test-ready".to_owned(),
            role: "worker".to_owned(),
            statement: "Test ready not setting result".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/main.rs".to_owned()],
            check: Some("check".to_owned()),
            ..Default::default()
        };
        let root = &project.manifest.root;
        let mut task = task::record(root, &project.ignore, opening, 0);
        task.state = "accepted".to_owned();
        task.accepted = Some(task::Acceptance {
            model: "test-model".to_owned(),
            unix: 0,
            changed_at_acceptance: None,
        });
        task::write(root, &task).unwrap();

        write(root, "src/main.rs", "pub fn main() {}\n");
        assert_eq!(evidence(&project, "test-ready", 0, "test", false), 0);
        assert_eq!(challenge(&project, Some("test-ready"), false), 0);
        let exit = ready(&project, "test-ready", false);
        assert_eq!(exit, 0);

        let loaded = task::read(root, "test-ready").unwrap().unwrap();
        assert_eq!(loaded.state, "ready");
        assert!(loaded.result.is_none());
    }
}
