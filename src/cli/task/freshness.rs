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
    check_baseline: Option<Result<task::EvidenceMemberBaseline, &'static str>>,
}

enum ChildBaseline {
    Check,
    Opening(bool),
}

fn unavailable_children(reason: &str) -> Value {
    json!({"availability": "baseline-unavailable", "reason": reason, "baseline": null, "total": null, "shown": 0, "omitted": 0, "limit": LIMIT, "entries": []})
}

impl<'a> Projection<'a> {
    fn input_reconciliation(
        &self,
        owner: &Task,
        evidence: Option<&task::Evidence>,
        current_inputs: &BTreeMap<String, Option<String>>,
        shared_delta: &Value,
    ) -> Value {
        let empty = BTreeMap::new();
        let recorded_inputs = evidence.map(|e| &e.inputs).unwrap_or(&empty);
        let selected_roots = counted(
            recorded_inputs.keys().chain(current_inputs.keys()).collect::<BTreeSet<_>>()
                .into_iter().map(|path| json!({
                    "path": path, "recorded": recorded_inputs.get(path), "current": current_inputs.get(path),
                    "recorded_selected": recorded_inputs.contains_key(path), "current_selected": current_inputs.contains_key(path)
                })).collect(), LIMIT,
        );
        let scope_coverage = counted(
            owner.scope.iter().collect::<BTreeSet<_>>().into_iter().map(|path| {
                let roots: Vec<Value> = current_inputs.keys().filter(|root| task::covers(root, path)).map(|root| json!(root)).collect();
                json!({"path": path, "state": if roots.is_empty() { "not-observed-by-this-check" } else { "covered-by-selected-input" }, "selected_roots": counted(roots, LIMIT)})
            }).collect(), LIMIT,
        );
        let unavailable =
            json!({"total": null, "shown": 0, "omitted": null, "limit": LIMIT, "entries": []});
        let mut view = json!({
            "authority": "diagnostic-only", "ownership": "current-declared-scope",
            "availability": "baseline-unavailable", "reason": "missing-evidence",
            "evidence_index": evidence.and_then(|e| owner.evidence.iter().position(|entry| std::ptr::eq(entry, e))),
            "recorded_epoch": evidence.and_then(|e| e.acceptance_epoch), "recorded_unix": evidence.map(|e| e.unix),
            "capture": null, "shared_delta": shared_delta,
            "selected_roots": selected_roots, "scope_coverage": scope_coverage,
            "unchanged_scope_members": unavailable, "changed_scope_members": unavailable, "changed_dependency_members": unavailable,
            "unobserved_inputs": unavailable,
            "inspection_routes": [format!("blabla task show {} --json", owner.name), format!("blabla task freshness {}", owner.name)],
            "limits": ["Ownership means current declared scope, not historical attribution. Dependencies mean selected inputs outside that scope, not a semantic dependency graph.", "Only observed tracking members are compared. Unobserved roots and partially covered scope do not establish an unchanged whole scope; ignored, symlink and unreadable paths may be absent, and large-file fingerprints may be metadata-only.", "Manual-record capture is not an observed execution. Fingerprint equality is not semantic proof or an atomic snapshot.", "Inspect adjacent receipts and readiness_summary for exact claim and review targets. Input changes do not establish the cause of every stale manual claim; no claim is renewed and no evidence reuse is authorized."]
        });
        let Some(baseline) = self.check_baseline.as_ref() else {
            return view;
        };
        let baseline = match baseline {
            Ok(baseline) => baseline,
            Err(reason) => {
                view["reason"] = json!(reason);
                return view;
            }
        };
        view["capture"] = json!(baseline.capture);
        if !recorded_inputs.keys().eq(current_inputs.keys()) {
            view["reason"] = json!("input-selection-changed");
            return view;
        }
        let current_members: BTreeMap<String, String> = self
            .tree
            .iter()
            .filter(|(path, _)| current_inputs.keys().any(|root| task::covers(root, path)))
            .map(|(path, digest)| (path.clone(), digest.clone()))
            .collect();
        if current_inputs
            .iter()
            .any(|(root, digest)| task::observed_digest(&current_members, root) != *digest)
        {
            view["reason"] = json!("projection-digest-mismatch");
            return view;
        }
        let mut unchanged_scope = Vec::new();
        let mut changed_scope = Vec::new();
        let mut changed_dependencies = Vec::new();
        for path in baseline
            .members
            .keys()
            .chain(current_members.keys())
            .collect::<BTreeSet<_>>()
        {
            let recorded = baseline.members.get(path);
            let current = current_members.get(path);
            let in_scope = owner.scope.iter().any(|root| task::covers(root, path));
            if recorded == current && !in_scope {
                continue;
            }
            let change = match (recorded, current) {
                (None, Some(_)) => "added",
                (Some(_), None) => "removed",
                _ if recorded == current => "unchanged",
                _ => "changed",
            };
            let roots = current_inputs
                .keys()
                .filter(|root| task::covers(root, path))
                .map(|root| json!(root))
                .collect();
            let row = json!({"path": path, "change": change, "recorded": recorded, "current": current, "selected_roots": counted(roots, LIMIT)});
            if change == "unchanged" {
                unchanged_scope.push(row);
            } else if in_scope {
                changed_scope.push(row);
            } else {
                changed_dependencies.push(row);
            }
        }
        let unobserved = current_inputs.iter().filter_map(|(path, current)| {
            let recorded = &recorded_inputs[path];
            let observation = match (recorded.is_some(), current.is_some()) {
                (true, true) => return None,
                (false, true) => "recorded-unobserved",
                (true, false) => "current-unobserved",
                (false, false) => "both-unobserved",
            };
            Some(json!({"path": path, "recorded": recorded, "current": current, "observation": observation}))
        }).collect();
        view["availability"] = json!("available");
        view["reason"] = Value::Null;
        view["unchanged_scope_members"] = counted(unchanged_scope, LIMIT);
        view["changed_scope_members"] = counted(changed_scope, LIMIT);
        view["changed_dependency_members"] = counted(changed_dependencies, LIMIT);
        view["unobserved_inputs"] = counted(unobserved, LIMIT);
        view
    }

    fn children(
        &mut self,
        owner: &Task,
        path: &str,
        recorded: Option<&str>,
        current: Option<&str>,
        selection: ChildBaseline,
        displayed: bool,
    ) -> Value {
        let (baseline_tree, baseline_label, raw) = match selection {
            ChildBaseline::Check => match self
                .check_baseline
                .as_ref()
                .expect("check baseline inspected")
            {
                Ok(baseline) => (&baseline.members, "evidence-input-manifest", true),
                Err("legacy-absent") => (&owner.opened_tree, "opened-tree-digest-match", true),
                Err(reason) => return unavailable_children(reason),
            },
            ChildBaseline::Opening(raw) => (&owner.opened_tree, "opened-tree-digest-match", raw),
        };
        if baseline_tree.contains_key(path) || self.tree.contains_key(path) {
            return json!({"availability": "not-a-directory-baseline", "baseline": null, "total": null, "shown": 0, "omitted": 0, "limit": LIMIT, "entries": []});
        }
        if !raw
            || (recorded.is_none() && baseline_label == "opened-tree-digest-match")
            || task::observed_digest(baseline_tree, path).as_deref() != recorded
            || task::observed_digest(self.tree, path).as_deref() != current
        {
            return unavailable_children("projection-digest-mismatch");
        }
        let selected = |tree: &BTreeMap<String, String>| {
            tree.iter()
                .filter(|(name, _)| task::covers(path, name))
                .map(|(name, digest)| (name.clone(), Some(digest.clone())))
                .collect()
        };
        let entries = differences(&selected(baseline_tree), &selected(self.tree), "path");
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
        children["baseline"] = json!(baseline_label);
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
            if context == "check"
                && (!recorded.paths.contains_key(path) || !current.paths.contains_key(path))
            {
                row["children"] = unavailable_children("input-selection-changed");
                continue;
            }
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
                if context == "check" {
                    ChildBaseline::Check
                } else {
                    ChildBaseline::Opening(raw)
                },
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
        check_baseline: None,
    };
    let mut receipts = Vec::new();
    let mut input_reconciliation = None;
    if identity.is_none() {
        let readiness =
            task::tracked_readiness(&work, &project.manifest.root, &project.ignore, &tree);
        let latest = task::latest_evidence(&work).or_else(|| work.evidence.last());
        let current_inputs = task::evidence_inputs(&work, &tree);
        let mut row = json!({"kind": "check", "state": "missing", "recorded_unix": null, "shared_delta": null, "readiness": readiness, "tracking_error": task::tracking_error(&work, &project.manifest.root, &project.ignore)});
        if let Some(evidence) = latest {
            let baseline = task::evidence_member_baseline(evidence);
            row["member_manifest"] = match &baseline {
                Ok(baseline) => {
                    json!({"availability": "complete", "capture": baseline.capture, "member_count": baseline.members.len(), "basis": "tracked-input-snapshot-v1"})
                }
                Err(reason) => json!({"availability": "baseline-unavailable", "reason": reason}),
            };
            projection.check_baseline = Some(baseline);
            let recorded = task::RelevantRevision {
                acceptance_epoch: evidence.acceptance_epoch.unwrap_or(work.acceptance_epoch),
                task_digest: String::new(),
                paths: evidence.inputs.clone(),
                identities: BTreeMap::new(),
            };
            let current = task::RelevantRevision {
                acceptance_epoch: work.acceptance_epoch,
                task_digest: String::new(),
                paths: current_inputs.clone(),
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
        input_reconciliation = Some(projection.input_reconciliation(
            &work,
            latest,
            &current_inputs,
            &row["shared_delta"],
        ));
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
        review_current = review_freshness(project, &work);
        for edge in review_edges(project, &work) {
            let detail = review_edge_view(project, &edge, &tree);
            let mut row = json!({"kind": "review-target", "reviewer": edge.reviewer.name, "target": edge.target.task, "relation": edge.relation, "state": detail["state"], "recorded_unix": null, "shared_delta": null, "reason": detail["reason"]});
            if let Some(("target-unreadable", message)) = &edge.failure {
                row["reason"] = json!(format!("target-unreadable: {message}"));
            }
            if let Some(reviewed) = &edge.reviewed {
                let current = task::review_revision(
                    &edge.reviewer,
                    reviewed,
                    &tree,
                    review_dependencies(project, &edge.reviewer, reviewed),
                );
                row["shared_delta"] = json!(projection.group(
                    reviewed,
                    "review-composite",
                    &edge.target.revision,
                    &current,
                    true,
                    &edge.reviewer.check_inputs
                ));
            }
            receipts.push(row);
        }
    }
    let receipt_rows = counted(receipts, LIMIT);
    let delta_rows = counted(projection.deltas, LIMIT);
    let mut output = json!({
        "task": name, "authority": "diagnostic-only", "identity_filter": identity,
        "receipts": receipt_rows["entries"], "receipt_counts": {"total": receipt_rows["total"], "shown": receipt_rows["shown"], "omitted": receipt_rows["omitted"], "limit": LIMIT},
        "deltas": delta_rows["entries"], "delta_counts": {"total": delta_rows["total"], "shown": delta_rows["shown"], "omitted": delta_rows["omitted"], "limit": LIMIT},
        "review_current": review_current,
        "readiness_summary": delivery::readiness_summary(project, &work, &tree),
        "children": {"total_available": projection.child_total, "shown": projection.child_shown, "omitted_available": projection.child_total - projection.child_shown, "limit": LIMIT},
        "limits": ["Fingerprint equality does not prove semantic equivalence.", "Assignment field history is unavailable. Reflection and review digests include composite receipt context.", "Child differences are tracking-set differences; unreadable and ignored members may be absent, and large-file hashes may be metadata-only.", "Check children use validated evidence-input-manifest baselines; legacy checks and other receipts require digest-matched opening trees. Counts include changed roots beyond the presentation cap. No receipt is refreshed or target repinned."]
    });
    if let Some(reconciliation) = input_reconciliation {
        output["input_reconciliation"] = reconciliation;
    }
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
    delivery::write_readiness_summary(&mut out, &view["readiness_summary"])?;
    if let Some(reconciliation) = view.get("input_reconciliation") {
        render_input_reconciliation(&mut out, reconciliation)?;
    }
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
        if let Some(manifest) = receipt.get("member_manifest") {
            if let Some(capture) = manifest["capture"].as_str() {
                writeln!(
                    out,
                    "    tracked input members: {} ({capture}{})",
                    manifest["member_count"],
                    if capture == "manual-record" {
                        "; not an observed execution"
                    } else {
                        ""
                    }
                )?;
            } else if let Some(reason) = manifest["reason"].as_str() {
                writeln!(
                    out,
                    "    tracked input members: baseline-unavailable ({reason})"
                )?;
            }
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
                    if let Some(baseline) = row["children"]["baseline"].as_str() {
                        writeln!(out, "    baseline: {baseline}")?;
                    }
                    if let Some(reason) = row["children"]["reason"].as_str() {
                        writeln!(out, "    reason: {reason}")?;
                    }
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

fn render_input_reconciliation(out: &mut impl Write, view: &Value) -> io::Result<()> {
    writeln!(
        out,
        "input_reconciliation: {} ({})",
        view["availability"].as_str().unwrap(),
        view["ownership"].as_str().unwrap()
    )?;
    writeln!(
        out,
        "  evidence index {} (zero-based), epoch {}, time {}; capture {}; {}",
        view["evidence_index"],
        view["recorded_epoch"],
        view["recorded_unix"],
        view["capture"].as_str().unwrap_or("unavailable"),
        view["shared_delta"].as_str().unwrap_or("no baseline")
    )?;
    if let Some(reason) = view["reason"].as_str() {
        writeln!(out, "  reason: {reason}")?;
    }
    for collection in [
        "selected_roots",
        "scope_coverage",
        "unchanged_scope_members",
        "changed_scope_members",
        "changed_dependency_members",
        "unobserved_inputs",
    ] {
        let section = &view[collection];
        writeln!(
            out,
            "  {collection}: {} total, {} shown, {} omitted",
            section["total"], section["shown"], section["omitted"]
        )?;
        for row in section["entries"].as_array().unwrap() {
            let state = row["state"]
                .as_str()
                .or_else(|| row["change"].as_str())
                .or_else(|| row["observation"].as_str())
                .unwrap_or("selected input");
            writeln!(out, "    {} ({state})", row["path"].as_str().unwrap())?;
            if row.get("recorded").is_some() {
                writeln!(
                    out,
                    "      recorded {} -> current {}",
                    row["recorded"], row["current"]
                )?;
            }
            if row.get("recorded_selected").is_some() {
                writeln!(
                    out,
                    "      selected: recorded {}, current {}",
                    row["recorded_selected"], row["current_selected"]
                )?;
            }
            if let Some(roots) = row.get("selected_roots") {
                let names: Vec<_> = roots["entries"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|root| root.as_str().unwrap())
                    .collect();
                writeln!(
                    out,
                    "      selected roots: {} ({} total, {} shown, {} omitted)",
                    names.join(", "),
                    roots["total"],
                    roots["shown"],
                    roots["omitted"]
                )?;
            }
        }
    }
    for limit in view["limits"].as_array().unwrap() {
        writeln!(out, "  {}", limit.as_str().unwrap())?;
    }
    for route in view["inspection_routes"].as_array().unwrap() {
        writeln!(out, "  Inspect: {}", route.as_str().unwrap())?;
    }
    Ok(())
}
