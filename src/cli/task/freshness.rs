use super::*;
use serde_json::{Value, json};

const LIMIT: usize = 50;

fn counted(mut entries: Vec<Value>, limit: usize) -> Value {
    let total = entries.len();
    entries.truncate(limit);
    json!({"total": total, "shown": entries.len(), "omitted": total - entries.len(), "limit": limit, "entries": entries})
}

fn differences(
    recorded: &BTreeMap<String, Option<String>>,
    current: &BTreeMap<String, Option<String>>,
    key: &str,
) -> Vec<Value> {
    recorded
        .keys()
        .chain(current.keys())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter_map(|name| {
            fingerprint_change(
                recorded.get(name).map(|v| v.as_deref()),
                current.get(name).map(|v| v.as_deref()),
            )
            .map(|change| {
                let mut row = serde_json::to_value(change).expect("fingerprint change serializes");
                row[key] = json!(name);
                row
            })
        })
        .collect()
}

fn identities(revision: &task::RelevantRevision) -> BTreeMap<String, Option<String>> {
    revision
        .identities
        .iter()
        .map(|(key, value)| (key.clone(), Some(value.clone())))
        .collect()
}

struct Projection<'a> {
    tree: &'a BTreeMap<String, String>,
    deltas: Vec<Value>,
    groups: BTreeMap<String, String>,
    child_shown: usize,
    child_total: usize,
}

impl<'a> Projection<'a> {
    fn children(
        &mut self,
        owner: &Task,
        path: &str,
        recorded: Option<&str>,
        current: Option<&str>,
        raw: bool,
        displayed: bool,
    ) -> Value {
        let unavailable = json!({"availability": "baseline-unavailable", "baseline": null, "total": null, "shown": 0, "omitted": 0, "limit": LIMIT, "entries": []});
        if owner.opened_tree.contains_key(path) || self.tree.contains_key(path) {
            return json!({"availability": "not-a-directory-baseline", "baseline": null, "total": null, "shown": 0, "omitted": 0, "limit": LIMIT, "entries": []});
        }
        if !raw
            || recorded.is_none()
            || task::observed_digest(&owner.opened_tree, path).as_deref() != recorded
            || task::observed_digest(self.tree, path).as_deref() != current
        {
            return unavailable;
        }
        let selected = |tree: &BTreeMap<String, String>| {
            tree.iter()
                .filter(|(name, _)| task::covers(path, name))
                .map(|(name, digest)| (name.clone(), Some(digest.clone())))
                .collect()
        };
        let entries = differences(&selected(&owner.opened_tree), &selected(self.tree), "path");
        self.child_total += entries.len();
        let mut children = counted(
            entries,
            if displayed {
                LIMIT.saturating_sub(self.child_shown)
            } else {
                0
            },
        );
        self.child_shown += children["shown"].as_u64().unwrap() as usize;
        children["availability"] = json!("available");
        children["baseline"] = json!("opened-tree-digest-match");
        children
    }

    fn group(
        &mut self,
        owner: &Task,
        context: &str,
        recorded: &task::RelevantRevision,
        current: &task::RelevantRevision,
        assignment_available: bool,
        extra_raw: &[String],
    ) -> String {
        let key = serde_json::to_string(&(context, &owner.name, recorded, current, extra_raw))
            .expect("revision pair serializes");
        if let Some(id) = self.groups.get(&key) {
            let group = self
                .deltas
                .iter_mut()
                .find(|group| group["id"] == *id)
                .unwrap();
            group["receipt_count"] = json!(group["receipt_count"].as_u64().unwrap() + 1);
            return id.clone();
        }
        let id = format!("delta-{}", self.deltas.len() + 1);
        let mut paths = differences(&recorded.paths, &current.paths, "path");
        for (index, row) in paths.iter_mut().enumerate() {
            let path = row["path"].as_str().unwrap();
            let raw = context == "check"
                || owner
                    .check_inputs
                    .iter()
                    .chain(extra_raw)
                    .any(|input| input == path)
                || owner.deliverables.iter().any(|entry| entry.path == path)
                || (context == "intent" || context == "reflection-composite")
                    && owner.scope.iter().any(|input| input == path)
                || !owner
                    .attributions
                    .iter()
                    .any(|entry| entry.kind == task::ATTRIBUTIONS[1]);
            row["children"] = self.children(
                owner,
                path,
                row["recorded"].as_str(),
                row["current"].as_str(),
                raw,
                index < LIMIT && self.deltas.len() < LIMIT,
            );
        }
        self.deltas.push(json!({
            "id": id, "context": context, "task": owner.name, "receipt_count": 1,
            "acceptance_epoch": (recorded.acceptance_epoch != current.acceptance_epoch).then(|| json!({"recorded": recorded.acceptance_epoch, "current": current.acceptance_epoch})),
            "assignment": {"changed": assignment_available.then_some(recorded.task_digest != current.task_digest), "recorded": assignment_available.then_some(&recorded.task_digest), "current": assignment_available.then_some(&current.task_digest), "field_availability": "baseline-unavailable", "fields": []},
            "paths": counted(paths, LIMIT), "identities": counted(differences(&identities(recorded), &identities(current), "identity"), LIMIT)
        }));
        self.groups.insert(key, id.clone());
        id
    }
}

pub(in crate::cli) fn show(
    project: &Project,
    name: &str,
    identity: Option<&str>,
    json_output: bool,
) -> i32 {
    let work = match load(project, name, json_output) {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    let revision = intent_revision(project, &work, &tree);
    if identity.is_some_and(|identity| !revision.identities.contains_key(identity)) {
        return emit_error(
            error(
                "task",
                "the requested identity is not affected by this task",
                None,
            ),
            json_output,
            2,
        );
    }
    let mut projection = Projection {
        tree: &tree,
        deltas: Vec::new(),
        groups: BTreeMap::new(),
        child_shown: 0,
        child_total: 0,
    };
    let mut receipts = Vec::new();
    if identity.is_none() {
        let readiness =
            task::tracked_readiness(&work, &project.manifest.root, &project.ignore, &tree);
        let latest = task::latest_evidence(&work).or_else(|| work.evidence.last());
        let mut row = json!({"kind": "check", "state": "missing", "recorded_unix": null, "shared_delta": null, "readiness": readiness, "tracking_error": task::tracking_error(&work, &project.manifest.root, &project.ignore)});
        if let Some(evidence) = latest {
            let recorded = task::RelevantRevision {
                acceptance_epoch: evidence.acceptance_epoch.unwrap_or(work.acceptance_epoch),
                task_digest: String::new(),
                paths: evidence.inputs.clone(),
                identities: BTreeMap::new(),
            };
            let current = task::RelevantRevision {
                acceptance_epoch: work.acceptance_epoch,
                task_digest: String::new(),
                paths: task::evidence_inputs(&work, &tree),
                identities: BTreeMap::new(),
            };
            row["state"] = json!(
                if !readiness.current || !task::evidence_matches(&work, evidence) {
                    "stale"
                } else if evidence.exit != 0 {
                    "failed"
                } else {
                    "current"
                }
            );
            row["recorded_unix"] = json!(evidence.unix);
            row["recorded_epoch"] = json!(evidence.acceptance_epoch);
            row["epoch_availability"] = json!(if evidence.acceptance_epoch.is_some() {
                "available"
            } else {
                "baseline-unavailable"
            });
            row["matches_declared_check"] = json!(task::evidence_matches(&work, evidence));
            row["exit"] = json!(evidence.exit);
            row["shared_delta"] =
                json!(projection.group(&work, "check", &recorded, &current, false, &[]));
        }
        receipts.push(row);
    }
    if work.intent_disposition_required {
        for id in revision
            .identities
            .keys()
            .filter(|id| identity.is_none_or(|filter| filter == id.as_str()))
        {
            let latest = work
                .intent_dispositions
                .iter()
                .rev()
                .find(|entry| entry.identity == *id);
            let mut row = json!({"kind": "disposition", "identity": id, "state": "missing", "recorded_unix": null, "shared_delta": null, "own_identity_changed": null, "claim_problems": []});
            if let Some(entry) = latest {
                let detail = intent_freshness(&work, id, entry, &revision);
                row["state"] = json!(if task::disposition_current(&work, id, &revision) {
                    "current"
                } else {
                    "stale"
                });
                row["recorded_unix"] = json!(entry.unix);
                row["own_identity_changed"] = json!(detail.own_identity_fingerprint_changed);
                row["claim_problems"] = json!(detail.claim_problems);
                row["shared_delta"] =
                    json!(projection.group(&work, "intent", &entry.revision, &revision, true, &[]));
            }
            receipts.push(row);
        }
    }
    let mut review_current = None;
    if identity.is_none() {
        if work.goal_reflection_required {
            let mut row = json!({"kind": "reflection", "state": goal_reflection_state(project, &work, &tree), "recorded_unix": null, "shared_delta": null});
            if let Some(entry) = &work.goal_reflection {
                row["recorded_unix"] = json!(entry.unix);
                row["shared_delta"] = json!(projection.group(
                    &work,
                    "reflection-composite",
                    &entry.revision,
                    &goal_reflection_revision(project, &work, &tree),
                    true,
                    &[]
                ));
                row["limits"] = json!([
                    "Composite assignment includes evidence and disposition history; historical components are unavailable."
                ]);
            }
            receipts.push(row);
        }
        let mut review = work.clone();
        let mut visited = BTreeSet::new();
        while let Some(target) = &review.review_of {
            review_current.get_or_insert(true);
            let mut row = json!({"kind": "review-target", "reviewer": review.name, "target": target.task, "state": "unavailable", "recorded_unix": null, "shared_delta": null});
            if !visited.insert(review.name.clone()) {
                row["reason"] = json!("review-cycle");
                receipts.push(row);
                review_current = Some(false);
                break;
            }
            let reviewed = match task::read(&project.manifest.root, &target.task) {
                Ok(Some(target)) => target,
                result => {
                    row["reason"] = json!(match result {
                        Ok(None) => "target-missing".to_owned(),
                        Err(message) => format!("target-unreadable: {message}"),
                        _ => unreachable!(),
                    });
                    receipts.push(row);
                    review_current = Some(false);
                    break;
                }
            };
            let dependencies = review_dependencies(project, &review, &reviewed);
            let current = task::review_revision(&review, &reviewed, &tree, dependencies.clone());
            let tracking = task::tracking_error(&review, &project.manifest.root, &project.ignore)
                .or_else(|| {
                    task::tracking_error(&reviewed, &project.manifest.root, &project.ignore)
                });
            let fresh =
                tracking.is_none() && task::review_current(&review, &reviewed, &tree, dependencies);
            row["state"] = json!(if fresh { "current" } else { "stale" });
            row["reason"] = json!(if reviewed.state == "withdrawn" {
                Some("target-withdrawn".to_owned())
            } else {
                tracking
            });
            row["shared_delta"] = json!(projection.group(
                &reviewed,
                "review-composite",
                &target.revision,
                &current,
                true,
                &review.check_inputs
            ));
            receipts.push(row);
            review_current = Some(review_current.unwrap() && fresh);
            review = reviewed;
        }
    }
    let receipt_rows = counted(receipts, LIMIT);
    let delta_rows = counted(projection.deltas, LIMIT);
    let output = json!({
        "task": name, "authority": "diagnostic-only", "identity_filter": identity,
        "receipts": receipt_rows["entries"], "receipt_counts": {"total": receipt_rows["total"], "shown": receipt_rows["shown"], "omitted": receipt_rows["omitted"], "limit": LIMIT},
        "deltas": delta_rows["entries"], "delta_counts": {"total": delta_rows["total"], "shown": delta_rows["shown"], "omitted": delta_rows["omitted"], "limit": LIMIT},
        "review_current": review_current,
        "children": {"total_available": projection.child_total, "shown": projection.child_shown, "omitted_available": projection.child_total - projection.child_shown, "limit": LIMIT},
        "limits": ["Fingerprint equality does not prove semantic equivalence.", "Assignment field history is unavailable. Reflection and review digests include composite receipt context.", "Child differences are tracking-set differences; unreadable and ignored members may be absent, and large-file hashes may be metadata-only.", "Only digest-matched opening trees can supply child baselines; counts include changed roots beyond the presentation cap. No receipt is refreshed or target repinned."]
    });
    let result = if json_output {
        write_json(&output)
    } else {
        render(&output)
    };
    if result.is_ok() { 0 } else { 4 }
}

fn render(view: &Value) -> io::Result<()> {
    let out = io::stdout();
    let mut out = out.lock();
    writeln!(
        out,
        "task::{} freshness (diagnostic-only)",
        view["task"].as_str().unwrap()
    )?;
    for receipt in view["receipts"].as_array().unwrap() {
        writeln!(
            out,
            "  {} {}: {} [{}]",
            receipt["kind"].as_str().unwrap(),
            receipt["identity"]
                .as_str()
                .or_else(|| receipt["target"].as_str())
                .unwrap_or(""),
            receipt["state"].as_str().unwrap(),
            receipt["shared_delta"].as_str().unwrap_or("no baseline")
        )?;
        if let Some(reason) = receipt["reason"].as_str() {
            writeln!(out, "    {reason}")?;
        }
        if let Some(problems) = receipt["claim_problems"].as_array() {
            for problem in problems {
                writeln!(out, "    claim: {}", problem.as_str().unwrap())?;
            }
        }
    }
    for group in view["deltas"].as_array().unwrap() {
        writeln!(
            out,
            "{} {}: {} receipt(s)",
            group["id"].as_str().unwrap(),
            group["context"].as_str().unwrap(),
            group["receipt_count"]
        )?;
        if !group["acceptance_epoch"].is_null() {
            writeln!(
                out,
                "  acceptance epoch: {} -> {}",
                group["acceptance_epoch"]["recorded"], group["acceptance_epoch"]["current"]
            )?;
        }
        writeln!(
            out,
            "  assignment changed: {}; field-baseline-unavailable",
            group["assignment"]["changed"]
        )?;
        for (collection, key) in [("paths", "path"), ("identities", "identity")] {
            for row in group[collection]["entries"].as_array().unwrap() {
                writeln!(
                    out,
                    "  {}: {} ({})",
                    key,
                    row[key].as_str().unwrap(),
                    row["change"].as_str().unwrap()
                )?;
                if let Some(availability) = row["children"]["availability"].as_str() {
                    writeln!(out, "    children: {availability}")?;
                    for child in row["children"]["entries"].as_array().unwrap() {
                        writeln!(
                            out,
                            "      {} ({})",
                            child["path"].as_str().unwrap(),
                            child["change"].as_str().unwrap()
                        )?;
                    }
                    if row["children"]["omitted"].as_u64().unwrap_or(0) > 0 {
                        writeln!(
                            out,
                            "    {} child changes omitted",
                            row["children"]["omitted"]
                        )?;
                    }
                }
            }
            writeln!(
                out,
                "  {collection}: {} total, {} shown, {} omitted",
                group[collection]["total"],
                group[collection]["shown"],
                group[collection]["omitted"]
            )?;
        }
    }
    writeln!(
        out,
        "Receipts: {} total, {} omitted; groups: {} total, {} omitted",
        view["receipt_counts"]["total"],
        view["receipt_counts"]["omitted"],
        view["delta_counts"]["total"],
        view["delta_counts"]["omitted"]
    )?;
    writeln!(
        out,
        "Available child comparisons: {} total, {} shown, {} omitted (global limit 50)",
        view["children"]["total_available"],
        view["children"]["shown"],
        view["children"]["omitted_available"]
    )?;
    for limit in view["limits"].as_array().unwrap() {
        writeln!(out, "{}", limit.as_str().unwrap())?;
    }
    writeln!(
        out,
        "Reassess explicitly with task disposition or task reflect. This view changes no freshness, readiness or closure decision."
    )
}
