use super::*;
use blabla::memory::goal::{DeliveryRequirement, Goal};
use blabla::project::task::delivery::{
    Claim, Obligation, Origin, Reference, ReferenceKind, Review, Status, Verdict,
};
use serde_json::{Value, json};
use std::path::Path;

pub(crate) fn declarations(project: &Project) -> Result<BTreeMap<String, Goal>, String> {
    let Some(entry) = &project.manifest.goal else {
        return Ok(BTreeMap::new());
    };
    let memory = memory::read(&entry.path, &entry.display, goal::build, goal::validate);
    let goals = memory.present().ok_or_else(|| {
        format!(
            "cannot resolve delivery applicability: {} {}",
            memory.state(),
            memory.problems().join("; ")
        )
    })?;
    let needs_systems = goals.goals.iter().any(|g| !g.applies_to.is_empty());
    let systems = if needs_systems {
        let entry = project
            .manifest
            .system
            .as_ref()
            .ok_or("delivery applies-to needs registered system memory")?;
        let memory = memory::read(&entry.path, &entry.display, system::build, system::validate);
        memory.present().cloned().ok_or_else(|| {
            format!(
                "cannot resolve delivery systems: {}",
                memory.problems().join("; ")
            )
        })?
    } else {
        system::SystemMemory::default()
    };
    for goal in &goals.goals {
        for id in &goal.applies_to {
            if !systems
                .systems
                .iter()
                .any(|s| id == &format!("system::{}", s.name))
            {
                return Err(format!(
                    "{} applies-to {id:?}, which is not an exact registered system identity",
                    goal.id()
                ));
            }
        }
    }
    Ok(goals.goals.iter().map(|g| (g.id(), g.clone())).collect())
}

fn id(name: &str) -> String {
    if name.starts_with("goal::") {
        name.to_owned()
    } else {
        format!("goal::{name}")
    }
}

pub(crate) fn select(
    project: &Project,
    primary: Option<&str>,
    extra: &[String],
    scope: &[String],
) -> Result<BTreeMap<String, Obligation>, String> {
    if let Some(name) = primary
        && let Some(message) = super::super::project::undeclared_goal(project, name)
    {
        return Err(message);
    }
    let goals = declarations(project)?;
    let mut selected = BTreeMap::new();
    for (name, basis) in primary
        .into_iter()
        .map(|n| (n, "primary"))
        .chain(extra.iter().map(|n| (n.as_str(), "explicit")))
    {
        let key = id(name);
        let goal = goals
            .get(&key)
            .ok_or_else(|| format!("delivery goal {key:?} is not registered"))?;
        if goal.delivery == Some(DeliveryRequirement::Required) {
            if goal.state == "dropped" {
                return Err(format!(
                    "required delivery goal {key} is dropped; owner must restore its declaration before a new explicit assignment"
                ));
            }
            insert(&mut selected, goal, basis.to_owned());
        }
    }
    if let Some(entry) = &project.manifest.system {
        let memory = memory::read(&entry.path, &entry.display, system::build, system::validate);
        if let Some(systems) = memory.present() {
            for goal in goals.values().filter(|g| {
                g.delivery == Some(DeliveryRequirement::Required) && g.state != "dropped"
            }) {
                for system in systems
                    .systems
                    .iter()
                    .filter(|s| goal.applies_to.contains(&format!("system::{}", s.name)))
                {
                    if system.paths.iter().any(|p| {
                        scope
                            .iter()
                            .any(|s| task::covers(p, s) || task::covers(s, p))
                    }) {
                        insert(&mut selected, goal, format!("system::{}", system.name));
                    }
                }
            }
        }
    }
    Ok(selected)
}

fn insert(selected: &mut BTreeMap<String, Obligation>, goal: &Goal, basis: String) {
    let obligation = selected.entry(goal.id()).or_insert_with(|| Obligation {
        basis: Vec::new(),
        goal: goal.clone(),
        goal_fingerprint: fingerprint(goal),
        claim: None,
    });
    if !obligation.basis.contains(&basis) {
        obligation.basis.push(basis);
    }
}

pub(crate) fn pin(project: &Project, task: &mut Task, extra: &[String]) -> Result<(), String> {
    let primary = task
        .goal
        .as_deref()
        .filter(|name| !task.delivery_obligations.contains_key(&id(name)));
    let selected = select(project, primary, extra, &task.scope)?;
    for (id, selected) in selected {
        let existing = task
            .delivery_obligations
            .entry(id)
            .or_insert_with(|| selected.clone());
        for basis in selected.basis {
            if !existing.basis.contains(&basis) {
                existing.basis.push(basis);
            }
        }
    }
    Ok(())
}

pub(crate) fn identities(project: &Project, task: &Task) -> BTreeMap<String, String> {
    if task.delivery_obligations.is_empty() {
        return BTreeMap::new();
    }
    let goals = declarations(project);
    task.delivery_obligations
        .keys()
        .map(|id| {
            (
                id.clone(),
                match &goals {
                    Ok(goals) => fingerprint(&goals.get(id)),
                    Err(message) => fingerprint(message),
                },
            )
        })
        .collect()
}

fn revision(
    project: &Project,
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> task::RelevantRevision {
    task::relevant_revision(task, tree, review_identities(project, task))
}

fn permitted(project: &Project, task: &Task, model: &str) -> bool {
    if model.trim().is_empty() || !task.accepted.as_ref().is_some_and(|a| a.model == model) {
        return false;
    }
    let Some(entry) = &project.manifest.process else {
        return true;
    };
    let memory = memory::read(
        &entry.path,
        &entry.display,
        process::build,
        process::validate,
    );
    let Some(memory) = memory.present() else {
        return false;
    };
    if !memory.roles.is_empty() && !memory.roles.iter().any(|r| r.name == task.role) {
        return false;
    }
    let models = process::permitted_models(memory, &task.role);
    models.is_empty()
        || models.iter().any(|m| m == model)
        || task
            .exceptions
            .iter()
            .any(|e| !e.superseded && e.model == model && e.approval.is_some())
}

fn artifacts(
    project: &Project,
    refs: &[Reference],
) -> Result<BTreeMap<String, Option<String>>, String> {
    let mut found = BTreeMap::new();
    for reference in refs {
        if reference.locator.contains("://") {
            continue;
        }
        let path = task::normalize_tracked_path(
            &project.manifest.root,
            &project.ignore,
            "delivery observation",
            &reference.locator,
        )?;
        let full = project.manifest.root.join(&path);
        if !full.is_file() {
            return Err(format!(
                "local delivery observation {path:?} is unavailable"
            ));
        }
        let digest = blabla::project::digest_of(&project.manifest.root, &path)
            .ok_or_else(|| format!("cannot read delivery observation {path:?}"))?;
        found.insert(path, Some(digest));
    }
    Ok(found)
}

fn validate_refs(refs: &[Reference], delivered: bool) -> Result<(), String> {
    if refs.is_empty()
        || refs
            .iter()
            .any(|r| r.locator.trim().is_empty() || r.context.trim().is_empty())
    {
        return Err(
            "delivery requires explicit nonempty observation references and context".into(),
        );
    }
    if delivered && !refs.iter().any(|r| r.kind != ReferenceKind::Verification) {
        return Err("Delivered needs an artifact, runtime or viewport observation; verification alone establishes source correctness".into());
    }
    Ok(())
}

fn refs_current(
    project: &Project,
    refs: &[Reference],
    expected: &BTreeMap<String, Option<String>>,
) -> bool {
    artifacts(project, refs).as_ref() == Ok(expected)
}

fn claim_current(
    project: &Project,
    task: &Task,
    claim: &Claim,
    tree: &BTreeMap<String, String>,
) -> bool {
    permitted(project, task, &claim.model)
        && claim.revision == revision(project, task, tree)
        && refs_current(project, &claim.refs, &claim.artifacts)
        && task::tracked_readiness(task, &project.manifest.root, &project.ignore, tree).supported
}

pub(crate) fn task_view(
    project: &Project,
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> Option<Value> {
    if task.delivery_obligations.is_empty() && task.delivery_reviews.is_empty() {
        return None;
    }
    let evaluation = super::super::project::evaluate_with_run_state(project);
    let structure = project.verify_structure();
    let status = status_view(project, &evaluation, &structure);
    let outcomes = super::super::project::goal_outcomes(project, &evaluation, &status).ok();
    let obligations: Vec<_> = task.delivery_obligations.iter().map(|(id, obligation)| json!({
        "goal":id,"statement":obligation.goal.statement,"expect":obligation.goal.expect,"basis":obligation.basis,
        "expectations":outcomes.as_ref().and_then(|outcomes| outcomes.iter().find(|outcome| outcome.goal == *id)).map(|outcome| &outcome.expectations),
        "goal_fingerprint":obligation.goal_fingerprint,"claim":obligation.claim,
        "claim_digest":obligation.claim.as_ref().map(fingerprint),
        "current":obligation.claim.as_ref().is_some_and(|c| claim_current(project, task, c, tree))
    })).collect();
    let current = obligations.iter().all(|o| o["current"] == true);
    Some(
        json!({"obligations":obligations,"claims_current":current,"reviews":task.delivery_reviews,"reviews_pending":reviews_pending(project, task, tree)}),
    )
}

pub(crate) fn claims_pending(
    project: &Project,
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> Vec<String> {
    task.delivery_obligations
        .iter()
        .filter(|(_, o)| {
            !o.claim
                .as_ref()
                .is_some_and(|c| claim_current(project, task, c, tree))
        })
        .map(|(id, _)| id.clone())
        .collect()
}

#[derive(Clone)]
pub(crate) struct ClaimInput {
    pub goal: String,
    pub refresh_ready: bool,
    pub status: String,
    pub observation: String,
    pub refs: Vec<String>,
    pub delivered: Option<String>,
    pub remaining: Option<String>,
    pub owner: Option<String>,
    pub next: Option<String>,
    pub blocker: Option<String>,
    pub unblock_when: Option<String>,
    pub reason: Option<String>,
    pub model: String,
}

#[derive(Clone)]
pub(crate) struct ReviewInput {
    pub source: Option<String>,
    pub goal: String,
    pub verdict: String,
    pub refs: Vec<String>,
    pub reason: String,
    pub model: String,
    pub resolve_origin: Option<String>,
    pub resolution: Option<String>,
}

#[derive(Clone)]
pub(crate) enum Request {
    Claim(ClaimInput),
    Review(ReviewInput),
}
impl Request {
    fn model(&self) -> &str {
        match self {
            Self::Claim(c) => &c.model,
            Self::Review(r) => &r.model,
        }
    }
}

fn decode<T: serde::de::DeserializeOwned>(text: &str) -> Result<T, String> {
    serde_json::from_str(text).map_err(|e| format!("invalid delivery value: {e}"))
}
fn word<T: serde::de::DeserializeOwned>(text: &str) -> Result<T, String> {
    decode(&json!(text).to_string())
}
fn references(values: &[String]) -> Result<Vec<Reference>, String> {
    values.iter().map(|s| decode(s)).collect()
}
fn nonempty(value: &Option<String>) -> bool {
    value.as_ref().is_some_and(|v| !v.trim().is_empty())
}

fn author_claim(
    project: &Project,
    task: &Task,
    input: &ClaimInput,
    tree: &BTreeMap<String, String>,
) -> Result<(String, Claim), String> {
    let key = id(&input.goal);
    if !task.delivery_obligations.contains_key(&key) {
        return Err(format!(
            "{key} is not a pinned delivery obligation of {}",
            task.name
        ));
    }
    let status: Status = word(&input.status)?;
    let refs = references(&input.refs)?;
    validate_refs(&refs, status == Status::Delivered)?;
    if input.observation.trim().is_empty() {
        return Err("delivery observation must be nonempty".into());
    }
    let complete = match status {
        Status::Delivered => true,
        Status::Partial => [
            &input.delivered,
            &input.remaining,
            &input.owner,
            &input.next,
        ]
        .into_iter()
        .all(nonempty),
        Status::Blocked => [&input.blocker, &input.owner, &input.unblock_when]
            .into_iter()
            .all(nonempty),
        Status::NotApplicable => nonempty(&input.reason),
    };
    if !complete {
        return Err("delivery status is missing its concrete remaining work, owner, trigger or applicability reason".into());
    }
    let goals = declarations(project)?;
    if status != Status::NotApplicable
        && !goals.get(&key).is_some_and(|g| {
            g.delivery == Some(DeliveryRequirement::Required) && g.state != "dropped"
        })
    {
        return Err("the current owner declaration no longer supports this applicable delivery claim; preserve the pinned obligation and account explicitly for applicability".into());
    }
    Ok((
        key,
        Claim {
            status,
            observation: input.observation.clone(),
            refs: refs.clone(),
            delivered: input.delivered.clone(),
            remaining: input.remaining.clone(),
            owner: input.owner.clone(),
            next: input.next.clone(),
            blocker: input.blocker.clone(),
            unblock_when: input.unblock_when.clone(),
            reason: input.reason.clone(),
            model: input.model.clone(),
            unix: now_unix(),
            revision: revision(project, task, tree),
            artifacts: artifacts(project, &refs)?,
        },
    ))
}

fn independent_review(
    project: &Project,
    task: &Task,
    input: &ReviewInput,
    tree: &BTreeMap<String, String>,
) -> Result<Review, String> {
    let primary = task
        .review_of
        .as_ref()
        .ok_or("delivery review requires an independently assigned review_of task")?;
    let selected = input.source.as_deref().unwrap_or(&primary.task);
    if !assigned_source(task, selected) {
        return Err("delivery source is not explicitly assigned to this review".into());
    }
    let source = task::read(&project.manifest.root, selected)?
        .ok_or("delivery review target is unavailable")?;
    if source.name == task.name {
        return Err("a source task cannot review its own outcome".into());
    }
    let key = id(&input.goal);
    let obligation = source
        .delivery_obligations
        .get(&key)
        .ok_or("reviewed source has no such delivery obligation")?;
    let claim = obligation
        .claim
        .as_ref()
        .ok_or("reviewed source has no delivery claim")?;
    let verdict: Verdict = word(&input.verdict)?;
    let origin: Option<Origin> = input.resolve_origin.as_deref().map(decode).transpose()?;
    let resolution: Option<Status> = input.resolution.as_deref().map(word).transpose()?;
    if origin.is_some() != resolution.is_some() {
        return Err(
            "residual resolution needs exact --resolve-origin and explicit --resolution delivered"
                .into(),
        );
    }
    if let Some(origin) = &origin {
        if origin.task != source.name
            || origin.goal != key
            || origin.claim_digest != fingerprint(claim)
            || resolution != Some(Status::Delivered)
            || verdict != Verdict::Accept
            || source.state != "closed"
            || !matches!(claim.status, Status::Partial | Status::Blocked)
        {
            return Err("resolution must independently deliver the exact closed Partial/Blocked origin; NotApplicable cannot erase it".into());
        }
        let goals = declarations(project)?;
        if !goals.get(&key).is_some_and(|g| {
            g.delivery == Some(DeliveryRequirement::Required) && g.state != "dropped"
        }) {
            return Err(
                "a removed, disabled or retired outcome cannot be silently relabeled Delivered"
                    .into(),
            );
        }
    } else if !claim_current(project, &source, claim, tree) {
        return Err(
            "the reviewed delivery claim is stale; inspect the current source claim before review"
                .into(),
        );
    }
    let refs = references(&input.refs)?;
    validate_refs(
        &refs,
        resolution == Some(Status::Delivered) || claim.status == Status::Delivered,
    )?;
    if input.reason.trim().is_empty() {
        return Err("independent delivery review requires an inspection reason".into());
    }
    Ok(Review {
        source_task: (!task.delivery_review_targets.is_empty() || input.source.is_some())
            .then(|| source.name.clone()),
        goal: key,
        claim_digest: fingerprint(claim),
        goal_fingerprint: fingerprint(&declarations(project)?.get(&obligation.goal.id())),
        target_revision: task::review_revision(
            task,
            &source,
            tree,
            review_dependencies(project, task, &source),
        ),
        revision: revision(project, task, tree),
        verdict,
        refs: refs.clone(),
        reason: input.reason.clone(),
        model: input.model.clone(),
        unix: now_unix(),
        artifacts: artifacts(project, &refs)?,
        resolve_origin: origin,
        resolution,
    })
}

struct Inspection {
    project: Project,
    task: Task,
    tree: BTreeMap<String, String>,
    context: String,
}
fn refuse(message: impl Into<String>, json: bool) -> i32 {
    emit_error(error("task", message.into(), None), json, 2)
}
fn inspect(manifest: &Path, name: &str, request: &Request, json: bool) -> Result<Inspection, i32> {
    let project = blabla::project::read_manifest(manifest)
        .and_then(blabla::project::load)
        .map_err(|e| refuse(format!("cannot reload delivery authority: {e:?}"), json))?;
    let task = load(&project, name, json)?;
    let refresh_ready = matches!(request, Request::Claim(input) if input.refresh_ready);
    let state = if refresh_ready { "ready" } else { "accepted" };
    if task.state != state || !permitted(&project, &task, request.model()) {
        return Err(refuse(
            if refresh_ready {
                "--refresh-ready requires the READY task's same currently permitted accepted model"
            } else {
                "delivery recording requires the ACCEPTED task's currently permitted model"
            },
            json,
        ));
    }
    require_tracking(&project, &task, json)?;
    require_current_review(&project, &task, json)?;
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    if !task::tracked_readiness(&task, &project.manifest.root, &project.ignore, &tree).supported {
        return Err(refuse(
            "delivery recording requires current successful declared check evidence",
            json,
        ));
    }
    let observation = match request {
        Request::Claim(input) => author_claim(&project, &task, input, &tree).map(|(_, mut c)| {
            c.unix = 0;
            json!(c)
        }),
        Request::Review(input) => independent_review(&project, &task, input, &tree).map(|mut r| {
            r.unix = 0;
            json!(r)
        }),
    }
    .map_err(|m| refuse(m, json))?;
    let targets: BTreeMap<_, _> = review_graph(&project, &task)
        .map_err(|message| refuse(message, json))?
        .into_iter()
        .map(|(_, source)| (source.name.clone(), fingerprint(&source)))
        .collect();
    let authority: BTreeMap<_, _> = [
        &project.manifest.process,
        &project.manifest.goal,
        &project.manifest.system,
    ]
    .into_iter()
    .flatten()
    .map(|e| (e.display.clone(), std::fs::read(&e.path).ok()))
    .collect();
    let context = fingerprint(&(
        &task,
        revision(&project, &task, &tree),
        targets,
        authority,
        observation,
        &project.identity,
    ));
    Ok(Inspection {
        project,
        task,
        tree,
        context,
    })
}
fn record(initial: Inspection, request: &Request, json: bool) -> i32 {
    let mut current = match inspect(
        &initial.project.manifest.path,
        &initial.task.name,
        request,
        json,
    ) {
        Ok(c) => c,
        Err(e) => return e,
    };
    if initial.context != current.context {
        return refuse(
            "delivery assignment, authority, observation or recursive target changed while the explicit claim was being recorded; inspect and submit again",
            json,
        );
    }
    match request {
        Request::Claim(input) => {
            match author_claim(&current.project, &current.task, input, &current.tree) {
                Ok((id, claim)) => {
                    current
                        .task
                        .delivery_obligations
                        .get_mut(&id)
                        .expect("validated obligation")
                        .claim = Some(claim)
                }
                Err(e) => return refuse(e, json),
            }
        }
        Request::Review(input) => {
            match independent_review(&current.project, &current.task, input, &current.tree) {
                Ok(review) => {
                    let primary = current.task.review_of.as_ref().map(|t| t.task.clone());
                    current.task.delivery_reviews.retain(|r| {
                        !(r.source_task.as_deref().or(primary.as_deref())
                            == review.source_task.as_deref().or(primary.as_deref())
                            && r.goal == review.goal
                            && r.resolve_origin == review.resolve_origin)
                    });
                    current.task.delivery_reviews.push(review);
                }
                Err(e) => return refuse(e, json),
            }
        }
    }
    current.task.challenged = None;
    store(&current.project, &mut current.task, json)
}

pub(crate) fn write(project: &Project, name: &str, request: Request, json: bool) -> i32 {
    match inspect(&project.manifest.path, name, &request, json) {
        Ok(initial) => record(initial, &request, json),
        Err(e) => e,
    }
}

fn assigned_source(reviewer: &Task, source: &str) -> bool {
    reviewer
        .review_of
        .iter()
        .chain(&reviewer.delivery_review_targets)
        .any(|target| target.task == source)
}

fn review_source<'a>(reviewer: &'a Task, review: &'a Review) -> Option<&'a str> {
    review
        .source_task
        .as_deref()
        .or_else(|| reviewer.review_of.as_ref().map(|t| t.task.as_str()))
}

fn review_record_current(
    project: &Project,
    reviewer: &Task,
    review: &Review,
    source: &Task,
    tree: &BTreeMap<String, String>,
) -> bool {
    if review_source(reviewer, review) != Some(source.name.as_str())
        || !assigned_source(reviewer, &source.name)
        || !permitted(project, reviewer, &review.model)
        || review_freshness(project, reviewer) != Some(true)
        || !task::tracked_readiness(reviewer, &project.manifest.root, &project.ignore, tree)
            .supported
        || review.revision != revision(project, reviewer, tree)
        || !refs_current(project, &review.refs, &review.artifacts)
        || review.target_revision
            != task::review_revision(
                reviewer,
                source,
                tree,
                review_dependencies(project, reviewer, source),
            )
    {
        return false;
    }
    let Some(obligation) = source.delivery_obligations.get(&review.goal) else {
        return false;
    };
    let Some(claim) = &obligation.claim else {
        return false;
    };
    if review.claim_digest != fingerprint(claim) {
        return false;
    }
    let Ok(goals) = declarations(project) else {
        return false;
    };
    if review.goal_fingerprint != fingerprint(&goals.get(&review.goal)) {
        return false;
    }
    if review.resolve_origin.is_some() {
        source.state == "closed"
            && matches!(claim.status, Status::Partial | Status::Blocked)
            && review.resolution == Some(Status::Delivered)
            && review.verdict == Verdict::Accept
            && review.resolve_origin.as_ref().is_some_and(|o| {
                o.task == source.name
                    && o.goal == review.goal
                    && o.claim_digest == review.claim_digest
            })
            && goals.get(&review.goal).is_some_and(|g| {
                g.delivery == Some(DeliveryRequirement::Required) && g.state != "dropped"
            })
    } else {
        claim_current(project, source, claim, tree)
    }
}

fn accepted_review(
    project: &Project,
    source: &Task,
    goal: &str,
    tree: &BTreeMap<String, String>,
    tasks: &[Task],
) -> bool {
    let mut accepted = false;
    for reviewer in tasks
        .iter()
        .filter(|r| r.state == "closed" && r.result.is_some() && assigned_source(r, &source.name))
    {
        if !task::challenge_current(reviewer, tree) {
            continue;
        }
        for review in reviewer
            .delivery_reviews
            .iter()
            .filter(|r| r.goal == goal && r.resolve_origin.is_none())
        {
            if review_record_current(project, reviewer, review, source, tree) {
                if review.verdict == Verdict::Reject {
                    return false;
                }
                accepted = true;
            }
        }
    }
    accepted
}

pub(crate) fn reviews_pending(
    project: &Project,
    source: &Task,
    tree: &BTreeMap<String, String>,
) -> Vec<String> {
    let tasks = task::read_all(&project.manifest.root);
    let mut pending: Vec<_> = source
        .delivery_obligations
        .keys()
        .filter(|id| !accepted_review(project, source, id, tree, &tasks))
        .cloned()
        .collect();
    if !source.delivery_reviews.is_empty() {
        for review in &source.delivery_reviews {
            let target = review_source(source, review)
                .and_then(|name| task::read(&project.manifest.root, name).ok().flatten());
            if !target
                .as_ref()
                .is_some_and(|target| review_record_current(project, source, review, target, tree))
            {
                pending.push(format!(
                    "stale review of {} from {}",
                    review.goal,
                    review_source(source, review).unwrap_or("unassigned source")
                ));
            }
        }
    }
    pending
}

pub(crate) fn close_check(project: &Project, source: &Task, json: bool) -> Result<(), i32> {
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    let mut pending = claims_pending(project, source, &tree);
    pending.extend(reviews_pending(project, source, &tree));
    if pending.is_empty() {
        Ok(())
    } else {
        Err(refuse(
            format!(
                "source closure requires current delivery claims and independently accepted current reviews: {}",
                pending.join(", ")
            ),
            json,
        ))
    }
}

fn resolved_origin(
    project: &Project,
    source: &Task,
    goal: &str,
    tree: &BTreeMap<String, String>,
    tasks: &[Task],
) -> bool {
    tasks
        .iter()
        .filter(|r| r.state == "closed" && r.result.is_some() && assigned_source(r, &source.name))
        .any(|reviewer| {
            task::challenge_current(reviewer, tree)
                && reviewer.delivery_reviews.iter().any(|r| {
                    r.goal == goal
                        && r.resolve_origin.is_some()
                        && review_record_current(project, reviewer, r, source, tree)
                })
        })
}

pub(crate) fn project_view(project: &Project, filter: Option<&str>) -> Option<Value> {
    let tasks = task::read_all(&project.manifest.root);
    let goals = declarations(project);
    let required = goals
        .as_ref()
        .is_ok_and(|goals| goals.values().any(|g| g.delivery.is_some()));
    let recorded = tasks
        .iter()
        .any(|t| !t.delivery_obligations.is_empty() || !t.delivery_reviews.is_empty());
    if !required && !recorded && task::unreadable(&project.manifest.root).is_empty() {
        return None;
    }
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    let mut unavailable: Vec<Value> = task::unreadable(&project.manifest.root)
        .into_iter()
        .map(|message| {
            let name = message
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_start_matches("task::");
            json!({"task":name,"reason":message})
        })
        .collect();
    if let Err(message) = &goals {
        unavailable.push(json!({"memory":"goals","reason":message}));
    }
    let mut residuals = Vec::new();
    let mut delivered = 0;
    for source in &tasks {
        for (id, obligation) in &source.delivery_obligations {
            if filter.is_some_and(|f| f != id) {
                continue;
            }
            let retired = goals
                .as_ref()
                .ok()
                .and_then(|g| g.get(id))
                .is_some_and(|g| g.state == "dropped");
            let claim = obligation.claim.as_ref();
            let current = claim.is_some_and(|c| claim_current(project, source, c, &tree));
            let approved = current && accepted_review(project, source, id, &tree, &tasks);
            let resolved = resolved_origin(project, source, id, &tree, &tasks);
            if resolved {
                delivered += 1;
                continue;
            }
            if approved && !retired && source.state == "closed" {
                if claim.is_some_and(|c| c.status == Status::Delivered) {
                    delivered += 1;
                    continue;
                }
                if claim.is_some_and(|c| c.status == Status::NotApplicable) {
                    continue;
                }
            }
            residuals.push(json!({"origin_task":source.name,"origin_role":if source.role.trim().is_empty() { None } else { Some(source.role.as_str()) },"goal":id,"claim_digest":claim.map(fingerprint),"status":claim.map(|c| json!(c.status)).unwrap_or(json!("unclaimed")),"source_state":source.state,"owner":claim.and_then(|c| c.owner.as_ref()),"remaining":claim.and_then(|c| c.remaining.as_ref()),"blocker":claim.and_then(|c| c.blocker.as_ref()),"next":claim.and_then(|c| c.next.as_ref().or(c.unblock_when.as_ref())),"current":current,"review_accepted":approved,"retired":retired,"route":format!("blabla task show {}",source.name)}));
        }
    }
    residuals.sort_by_key(|v| {
        (
            v["goal"].as_str().unwrap_or("").to_owned(),
            v["origin_task"].as_str().unwrap_or("").to_owned(),
        )
    });
    let total = residuals.len();
    let next: Vec<_> = residuals
        .iter()
        .filter_map(|v| v["goal"].as_str())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|g| format!("blabla explain {g}"))
        .collect();
    let limit = if filter.is_some() { total } else { 50 };
    residuals.truncate(limit);
    let state = if !unavailable.is_empty() {
        "unavailable"
    } else if total > 0 {
        "unresolved"
    } else if delivered > 0 {
        "delivered"
    } else {
        "unaccounted"
    };
    Some(
        json!({"state":state,"residuals":residuals,"total":total,"omitted":total.saturating_sub(limit),"unavailable":unavailable,"next":next,"authority":"Delivery references are independently reviewed claims; they do not establish canonical contract verification or silently change owner goal state."}),
    )
}

pub(crate) fn write_projection(output: &mut impl Write, view: Option<&Value>) -> io::Result<()> {
    let Some(view) = view else {
        return Ok(());
    };
    writeln!(
        output,
        "\nDelivery: {} residuals, {} omitted; {}",
        view["total"],
        view["omitted"],
        view["state"].as_str().unwrap_or("unavailable")
    )?;
    if let Some(rows) = view["residuals"].as_array() {
        for row in rows {
            let ownership = match row["owner"].as_str() {
                Some(owner) => format!("owner {owner}"),
                None => format!(
                    "delivery owner not recorded; origin {} ({})",
                    row["origin_role"]
                        .as_str()
                        .map(|role| format!("role::{role}"))
                        .unwrap_or_else(|| "unknown".to_owned()),
                    row["source_state"].as_str().unwrap_or("unknown")
                ),
            };
            writeln!(
                output,
                "  {} from {}: {} {} next {}{}",
                row["goal"].as_str().unwrap_or("?"),
                row["origin_task"].as_str().unwrap_or("?"),
                row["status"].as_str().unwrap_or("?"),
                ownership,
                row["next"]
                    .as_str()
                    .unwrap_or("inspect current claim/review"),
                if row["retired"] == true {
                    " (owner-retired; not delivered)"
                } else {
                    ""
                }
            )?;
        }
    }
    if let Some(rows) = view["unavailable"].as_array() {
        for row in rows {
            writeln!(output, "  unavailable: {row}")?;
        }
    }
    writeln!(output, "Next delivery:")?;
    if let Some(routes) = view["next"].as_array() {
        for route in routes {
            writeln!(output, "  {}", route.as_str().unwrap_or("inspect delivery"))?;
        }
    }
    Ok(())
}

pub(crate) fn unmet_done(project: &Project) -> Vec<String> {
    let Ok(goals) = declarations(project) else {
        return Vec::new();
    };
    goals
        .values()
        .filter(|g| g.delivery.is_some() && g.state == "done")
        .filter(|g| project_view(project, Some(&g.id())).is_none_or(|v| v["state"] != "delivered"))
        .map(Goal::id)
        .collect()
}

pub(crate) fn close_context(
    project: &Project,
    task: &Task,
    json: bool,
) -> Result<Option<String>, i32> {
    if task.delivery_obligations.is_empty() && task.delivery_reviews.is_empty() {
        return Ok(None);
    }
    close_check(project, task, json)?;
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    let reviewers: Vec<_> = task::read_all(&project.manifest.root)
        .into_iter()
        .filter(|r| assigned_source(r, &task.name))
        .collect();
    let mut records = BTreeMap::new();
    for reviewer in reviewers.iter().chain(std::iter::once(task)) {
        records.insert(reviewer.name.clone(), fingerprint(reviewer));
        if reviewer.name != task.name
            && !(reviewer.state == "closed"
                && reviewer.result.is_some()
                && task::challenge_current(reviewer, &tree)
                && reviewer
                    .delivery_reviews
                    .iter()
                    .any(|review| review_record_current(project, reviewer, review, task, &tree)))
        {
            continue;
        }
        for (_, source) in
            review_graph(project, reviewer).map_err(|message| refuse(message, json))?
        {
            records.insert(source.name.clone(), fingerprint(&source));
        }
    }
    let authority: BTreeMap<_, _> = [
        &project.manifest.process,
        &project.manifest.goal,
        &project.manifest.system,
    ]
    .into_iter()
    .flatten()
    .map(|e| (e.display.clone(), std::fs::read(&e.path).ok()))
    .collect();
    Ok(Some(fingerprint(&(
        task,
        revision(project, task, &tree),
        records,
        authority,
        &project.identity,
    ))))
}

pub(crate) fn recheck_close(
    project: &Project,
    name: &str,
    expected: &Option<String>,
    model: &str,
    json: bool,
) -> Result<Option<Project>, i32> {
    if expected.is_none() {
        return Ok(None);
    }
    let current = blabla::project::read_manifest(&project.manifest.path)
        .and_then(blabla::project::load)
        .map_err(|e| {
            refuse(
                format!("cannot reload delivery close authority: {e:?}"),
                json,
            )
        })?;
    validate_orchestrator_model(&current, model, json)?;
    let task = load(&current, name, json)?;
    if close_context(&current, &task, json)? != *expected {
        return Err(refuse(
            "delivery task, authority or accepted review changed before source closure",
            json,
        ));
    }
    Ok(Some(current))
}

#[cfg(test)]
fn write_with_checkpoint(
    project: &Project,
    name: &str,
    request: Request,
    checkpoint: impl FnOnce(),
) -> i32 {
    let initial = match inspect(&project.manifest.path, name, &request, true) {
        Ok(i) => i,
        Err(e) => return e,
    };
    checkpoint();
    record(initial, &request, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn put(root: &Path, path: &str, value: &str) {
        let path = root.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, value).unwrap();
    }

    fn load_project(root: &Path) -> Project {
        blabla::project::load(blabla::project::read_manifest(&root.join("project.bla")).unwrap())
            .unwrap()
    }

    fn claim() -> Request {
        Request::Claim(ClaimInput { goal: "deliver".into(), refresh_ready: false, status: "partial".into(), observation: "Explicit synthetic observed source outcome".into(), refs: vec![json!({"kind":"artifact","locator":"observation.txt","context":"Synthetic artifact inspected for this fixture"}).to_string()], delivered: Some("Source behavior".into()), remaining: Some("Authorized runtime delivery".into()), owner: Some("release-owner".into()), next: Some("Authorize then observe".into()), blocker: None, unblock_when: None, reason: None, model: "worker".into() })
    }

    fn review_request(origin: Option<Origin>) -> Request {
        Request::Review(ReviewInput { source: None, goal: "deliver".into(), verdict: "accept".into(), refs: vec![json!({"kind":"runtime","locator":"fixture://independent-observation","context":"Explicit synthetic independent observation"}).to_string()], reason: "Inspected the actual stated boundary".into(), model: "reviewer".into(), resolution: origin.as_ref().map(|_| "delivered".into()), resolve_origin: origin.map(|o| serde_json::to_string(&o).unwrap()) })
    }

    fn prepare(project: &Project, name: &str, scope: &str, primary: bool, target: Option<&str>) {
        let model = if target.is_some() && !primary {
            "reviewer"
        } else {
            "worker"
        };
        assert_eq!(
            super::super::open_with_targets(
                project,
                Opening {
                    name: name.into(),
                    role: model.into(),
                    statement: "Exercise actual delivery recording".into(),
                    scope: vec![scope.into()],
                    inputs: vec!["src".into(), "check.py".into()],
                    check_argv: Some(vec!["python3".into(), "check.py".into()]),
                    goal: primary.then(|| "deliver".into()),
                    review_of: target.map(str::to_owned),
                    ..Default::default()
                },
                super::super::OpenOptions::default(),
                true,
                &[]
            ),
            0
        );
        assert_eq!(super::super::accept(project, name, model, true), 0);
        assert_eq!(super::super::evidence_run(project, name, true), 0);
    }

    fn handback(project: &Project, name: &str) {
        assert_eq!(super::super::challenge(project, Some(name), true), 0);
        assert_eq!(super::super::ready(project, name, true), 0);
    }

    fn fixture(mode: usize) -> (TempDir, Project, String, Request) {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        put(
            root,
            "project.bla",
            "project DeliveryRace\nuse structure \"entry.bla\"\nuse behavior \"counter.bla\"\nprocess \"process.bla\"\ngoal \"goals.bla\"\nsystem \"system.bla\"\nverify behavior { command [\"python3\", \"counter.py\"] seed 0 cases 1 steps 2 timeout_ms 2000 shrink_budget 4 }\n",
        );
        put(
            root,
            "entry.bla",
            "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
        );
        put(
            root,
            "counter.bla",
            "state count: int\naction increment()\nwhen increment { expect \"one\": after.count == before.count + 1 }\n",
        );
        put(
            root,
            "counter.py",
            "import json,sys\nn=0\nfor line in sys.stdin:\n r=json.loads(line)\n if r['op']=='reset':\n  n=0\n  v={'ok':True}\n elif r['op']=='call':\n  n+=1\n  v={'ok':True}\n else:\n  v={'count':n}\n print(json.dumps({'id':r['id'],'result':v}),flush=True)\n",
        );
        put(root, "src/app.rs", "pub fn run() {}\n");
        put(
            root,
            "check.py",
            "from pathlib import Path\nassert 'pub fn run' in Path('src/app.rs').read_text()\n",
        );
        put(
            root,
            "goals.bla",
            "goal \"deliver\" { statement \"Observe the user outcome\" expect [\"contract::entry\"] state \"active\" delivery \"required\" }\n",
        );
        put(
            root,
            "system.bla",
            "system \"app\" { purpose \"Operate\" paths [\"src\"] }\n",
        );
        put(
            root,
            "process.bla",
            "role \"orchestrator\" { purpose \"Accept\" model \"owner\" }\nrole \"worker\" { purpose \"Work\" model \"worker\" }\nrole \"reviewer\" { purpose \"Review\" model \"reviewer\" }\n",
        );
        put(root, "observation.txt", "Bounded synthetic observation\n");
        let project = load_project(root);
        assert_eq!(
            super::super::super::project::finish(&project, true, false),
            0
        );
        if mode == 3 {
            prepare(&project, "ancestor", "reviews/ancestor.md", false, None);
            handback(&project, "ancestor");
        }
        prepare(
            &project,
            "work",
            "src",
            true,
            (mode == 3).then_some("ancestor"),
        );
        if mode == 0 {
            return (temp, project, "work".into(), claim());
        }
        assert_eq!(write(&project, "work", claim(), true), 0);
        handback(&project, "work");
        if mode == 5 {
            let Request::Claim(mut input) = claim() else {
                unreachable!()
            };
            input.refresh_ready = true;
            return (temp, project, "work".into(), Request::Claim(input));
        }
        prepare(&project, "review", "reviews/review.md", false, Some("work"));
        if mode == 1 || mode == 3 {
            return (temp, project, "review".into(), review_request(None));
        }
        assert_eq!(write(&project, "review", review_request(None), true), 0);
        handback(&project, "review");
        assert_eq!(super::super::close(&project, "review", "owner", true), 0);
        if mode == 4 {
            return (temp, project, "work".into(), claim());
        }
        assert_eq!(super::super::close(&project, "work", "owner", true), 0);
        let source = task::read(root, "work").unwrap().unwrap();
        let origin = Origin {
            task: "work".into(),
            goal: "goal::deliver".into(),
            claim_digest: fingerprint(
                source.delivery_obligations["goal::deliver"]
                    .claim
                    .as_ref()
                    .unwrap(),
            ),
        };
        prepare(
            &project,
            "resolution",
            "reviews/resolution.md",
            false,
            Some("work"),
        );
        (
            temp,
            project,
            "resolution".into(),
            review_request(Some(origin)),
        )
    }

    fn bytes(root: &Path) -> BTreeMap<String, Vec<u8>> {
        fn visit(root: &Path, path: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
            for entry in std::fs::read_dir(path).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    visit(root, &path, out);
                } else {
                    out.insert(
                        path.strip_prefix(root)
                            .unwrap()
                            .to_string_lossy()
                            .into_owned(),
                        std::fs::read(path).unwrap(),
                    );
                }
            }
        }
        let mut out = BTreeMap::new();
        visit(root, root, &mut out);
        out
    }

    fn rewrite(root: &Path, name: &str, change: impl FnOnce(&mut Value)) {
        let path = format!(".blabla/tasks/{name}.json");
        let mut value: Value =
            serde_json::from_slice(&std::fs::read(root.join(&path)).unwrap()).unwrap();
        change(&mut value);
        put(root, &path, &value.to_string());
    }

    fn race(modes: &[usize], mutation: impl Fn(&Project, &str, &Request)) {
        for mode in modes {
            let (_temp, project, name, request) = fixture(*mode);
            let mut after = None;
            let result = write_with_checkpoint(&project, &name, request.clone(), || {
                mutation(&project, &name, &request);
                after = Some(bytes(&project.manifest.root));
            });
            assert!(
                after.is_some(),
                "eligible actual operation must reach the private checkpoint"
            );
            assert_eq!(result, 2);
            assert_eq!(bytes(&project.manifest.root), after.unwrap());
        }
    }

    #[test]
    fn delivery_checkpoint_noop_records_all_three_explicit_operations() {
        for mode in (0..4).chain(std::iter::once(5)) {
            let (_temp, project, name, request) = fixture(mode);
            let mut reached = false;
            let before = task::read(&project.manifest.root, &name).unwrap().unwrap();
            assert_eq!(
                write_with_checkpoint(&project, &name, request, || reached = true),
                0
            );
            assert!(reached);
            let after = task::read(&project.manifest.root, &name).unwrap().unwrap();
            assert_eq!(before.acceptance_epoch, after.acceptance_epoch);
            assert_eq!(fingerprint(&before.evidence), fingerprint(&after.evidence));
            assert_eq!(before.scope, after.scope);
            assert_eq!(before.review_of, after.review_of);
            assert_eq!(after.state, if mode == 5 { "ready" } else { "accepted" });
        }
    }

    #[test]
    fn delivery_checkpoint_preserves_valid_concurrent_note() {
        race(&[0, 1, 2, 5], |project, name, _| {
            assert_eq!(
                super::super::note(project, name, "New valid concurrent context", true),
                0
            );
        });
    }

    #[test]
    fn delivery_checkpoint_preserves_valid_concurrent_explicit_receipt() {
        race(&[0, 1, 2, 5], |project, name, request| {
            assert_eq!(write(project, name, request.clone(), true), 0);
        });
    }

    #[test]
    fn delivery_checkpoint_rechecks_epoch_state_and_evidence() {
        for field in ["acceptance_epoch", "state", "evidence"] {
            race(&[0, 1, 2, 5], |project, name, _| {
                rewrite(&project.manifest.root, name, |v| match field {
                    "acceptance_epoch" => v[field] = json!(99),
                    "state" => v[field] = json!("blocked"),
                    _ => v[field] = json!([]),
                })
            });
        }
    }

    #[test]
    fn delivery_checkpoint_reloads_revoked_and_valid_changed_model_authority() {
        for replacement in ["other", "worker"] {
            race(&[0, 1, 2, 5], |project, _, _| {
                let root = &project.manifest.root;
                let original = std::fs::read_to_string(root.join("process.bla")).unwrap();
                put(
                    root,
                    "process.bla",
                    &original.replace(
                        "purpose \"Work\" model \"worker\"",
                        &format!("purpose \"Changed valid policy\" model \"{replacement}\""),
                    ),
                );
            });
        }
    }

    #[test]
    fn delivery_checkpoint_reloads_goal_and_system_declarations() {
        for path in ["goals.bla", "system.bla"] {
            race(&[0, 1, 2, 5], |project, _, _| {
                let root = &project.manifest.root;
                let original = std::fs::read_to_string(root.join(path)).unwrap();
                put(
                    root,
                    path,
                    &original
                        .replace("Observe the user outcome", "Observe a changed user outcome")
                        .replace("Operate", "Operate under a changed owner mapping"),
                );
            });
        }
    }

    #[test]
    fn delivery_checkpoint_rechecks_real_source_and_local_observation() {
        for path in ["src/app.rs", "observation.txt"] {
            race(&[0, 1, 5], |project, _, _| {
                put(&project.manifest.root, path, "Changed input bytes\n")
            });
        }
    }

    #[test]
    fn delivery_checkpoint_reloads_reviewed_origin_record_even_when_revision_is_valid() {
        race(&[1, 2], |project, _, _| {
            rewrite(&project.manifest.root, "work", |v| {
                v["notes"] = json!([{"statement":"Changed historical context","unix":1}])
            })
        });
    }

    #[test]
    fn delivery_checkpoint_reloads_exact_origin_claim() {
        race(&[1, 2], |project, _, _| {
            rewrite(&project.manifest.root, "work", |v| {
                v["delivery_obligations"]["goal::deliver"]["claim"]["observation"] =
                    json!("A different explicit outcome")
            })
        });
    }
    #[test]
    fn delivery_checkpoint_reloads_recursive_ancestor_context() {
        race(&[3], |project, _, _| {
            rewrite(&project.manifest.root, "ancestor", |v| {
                v["notes"] = json!([{"statement":"Changed valid ancestor context","unix":1}])
            })
        });
    }

    fn close_race(bounded: bool, mutation: impl FnOnce(&Project), expect: i32) {
        let (_temp, project, name, _) = fixture(4);
        if bounded {
            prepare(&project, "other", "other.md", false, None);
            put(
                &project.manifest.root,
                "other.md",
                "Actual unrelated report change\n",
            );
        }
        let mut reached = false;
        let mut after = None;
        let checkpoint = || {
            reached = true;
            mutation(&project);
            after = Some(bytes(&project.manifest.root));
        };
        let result = if bounded {
            super::super::bounded::close_with_checkpoint(
                &project,
                &name,
                "owner",
                "Current reviewed source result",
                checkpoint,
            )
        } else {
            super::super::close_with_checkpoint(&project, &name, "owner", checkpoint)
        };
        assert!(reached);
        assert_eq!(result, expect);
        if expect != 0 {
            assert_eq!(bytes(&project.manifest.root), after.unwrap());
        }
    }

    #[test]
    fn delivery_close_checkpoint_noop_uses_both_real_close_paths() {
        for bounded in [false, true] {
            close_race(bounded, |_| {}, 0);
        }
    }

    #[test]
    fn delivery_close_checkpoint_preserves_valid_changed_review_context() {
        for bounded in [false, true] {
            close_race(
                bounded,
                |project| {
                    rewrite(&project.manifest.root, "review", |v| {
                        v["notes"] = json!([{"statement":"New valid reviewer context","unix":1}])
                    })
                },
                2,
            );
        }
    }

    #[test]
    fn delivery_close_checkpoint_rechecks_independent_verdict_and_authority() {
        for bounded in [false, true] {
            close_race(
                bounded,
                |project| {
                    rewrite(&project.manifest.root, "review", |v| {
                        v["delivery_reviews"][0]["verdict"] = json!("reject")
                    })
                },
                2,
            );
            close_race(
                bounded,
                |project| {
                    let root = &project.manifest.root;
                    let process = std::fs::read_to_string(root.join("process.bla")).unwrap();
                    put(
                        root,
                        "process.bla",
                        &process.replace("model \"reviewer\"", "model \"revoked\""),
                    );
                },
                2,
            );
        }
    }
    #[test]
    fn delivery_close_checkpoint_rechecks_owner_authority_and_run_record() {
        for bounded in [false, true] {
            close_race(
                bounded,
                |project| {
                    let root = &project.manifest.root;
                    let process = std::fs::read_to_string(root.join("process.bla")).unwrap();
                    put(
                        root,
                        "process.bla",
                        &process.replace("model \"owner\"", "model \"replacement-owner\""),
                    );
                },
                2,
            );
            close_race(
                bounded,
                |project| {
                    std::fs::remove_file(project.manifest.root.join(".blabla/status.json"))
                        .unwrap();
                },
                2,
            );
        }
    }
    fn batched_fixture() -> (TempDir, Project, Request) {
        let (temp, project, _, _) = fixture(1);
        prepare(&project, "secondary", "secondary.md", true, None);
        assert_eq!(write(&project, "secondary", claim(), true), 0);
        handback(&project, "secondary");
        assert_eq!(
            super::super::open_with_targets(
                &project,
                Opening {
                    name: "batch".into(),
                    role: "reviewer".into(),
                    statement: "Inspect two explicit sources".into(),
                    scope: vec!["reviews/batch.md".into()],
                    inputs: vec!["src".into(), "check.py".into()],
                    check_argv: Some(vec!["python3".into(), "check.py".into()]),
                    review_of: Some("work".into()),
                    ..Default::default()
                },
                super::super::OpenOptions {
                    delivery_targets: vec!["secondary".into()],
                    ..Default::default()
                },
                true,
                &[]
            ),
            0
        );
        assert_eq!(super::super::accept(&project, "batch", "reviewer", true), 0);
        assert_eq!(super::super::evidence_run(&project, "batch", true), 0);
        let Request::Review(mut request) = review_request(None) else {
            unreachable!()
        };
        request.source = Some("secondary".into());
        (temp, project, Request::Review(request))
    }

    #[test]
    fn batched_delivery_checkpoint_noop_records_the_explicit_secondary() {
        let (_temp, project, request) = batched_fixture();
        let mut reached = false;
        assert_eq!(
            write_with_checkpoint(&project, "batch", request, || reached = true),
            0
        );
        assert!(reached);
        let task = task::read(&project.manifest.root, "batch")
            .unwrap()
            .unwrap();
        assert_eq!(
            task.delivery_reviews[0].source_task.as_deref(),
            Some("secondary")
        );
    }

    #[test]
    fn batched_delivery_checkpoint_preserves_changed_secondary_context() {
        for mutation in ["note", "claim", "artifact", "authority", "input"] {
            let (_temp, project, request) = batched_fixture();
            let mut after = None;
            let result = write_with_checkpoint(&project, "batch", request, || {
                let root = &project.manifest.root;
                match mutation {
                    "note" => assert_eq!(
                        super::super::note(&project, "secondary", "Valid concurrent context", true),
                        0
                    ),
                    "claim" => rewrite(root, "secondary", |v| {
                        v["delivery_obligations"]["goal::deliver"]["claim"]["observation"] =
                            json!("Changed explicit observation")
                    }),
                    "artifact" => put(root, "observation.txt", "Changed inspected artifact"),
                    "input" => put(root, "src/app.rs", "pub fn run() { let x = 1; }"),
                    _ => {
                        let original = std::fs::read_to_string(root.join("process.bla")).unwrap();
                        put(
                            root,
                            "process.bla",
                            &original.replace(
                                "purpose \"Review\"",
                                "purpose \"Changed review authority\"",
                            ),
                        );
                    }
                }
                after = Some(bytes(root));
            });
            assert!(
                after.is_some(),
                "must reach exact production checkpoint: {mutation}"
            );
            assert_eq!(result, 2, "{mutation}");
            assert_eq!(bytes(&project.manifest.root), after.unwrap());
        }
    }

    #[test]
    fn batched_source_close_checkpoint_rechecks_other_source_in_both_modes() {
        for bounded in [false, true] {
            for mutate in [false, true] {
                let (_temp, project, secondary_request) = batched_fixture();
                assert_eq!(write(&project, "batch", review_request(None), true), 0);
                assert_eq!(write(&project, "batch", secondary_request, true), 0);
                handback(&project, "batch");
                assert_eq!(super::super::close(&project, "batch", "owner", true), 0);
                if bounded {
                    prepare(&project, "concurrent", "other.md", false, None);
                    put(
                        &project.manifest.root,
                        "other.md",
                        "Actual unrelated implementation change",
                    );
                }
                let mut after = None;
                let checkpoint = || {
                    if mutate {
                        assert_eq!(
                            super::super::note(
                                &project,
                                "secondary",
                                "Valid later source context",
                                true
                            ),
                            0
                        );
                    }
                    after = Some(bytes(&project.manifest.root));
                };
                let exit = if bounded {
                    super::super::bounded::close_with_checkpoint(
                        &project,
                        "work",
                        "owner",
                        "Current independently reviewed work",
                        checkpoint,
                    )
                } else {
                    super::super::close_with_checkpoint(&project, "work", "owner", checkpoint)
                };
                assert!(after.is_some());
                assert_eq!(exit, if mutate { 2 } else { 0 });
                if mutate {
                    assert_eq!(bytes(&project.manifest.root), after.unwrap());
                }
            }
        }
    }
}
