use super::*;
use blabla::project;
use std::io::Read;
use std::path::{Component, Path};

struct Inspection {
    project: Project,
    task: Task,
    task_digest: String,
    authority: String,
    context: String,
    revision: task::RelevantRevision,
    evidence: task::Evidence,
    original_index: usize,
    log_digest: String,
}

fn refuse(message: impl Into<String>, json: bool) -> i32 {
    emit_error(error("task", message.into(), None), json, 2)
}

fn authority(project: &Project, task: &Task, model: &str, json: bool) -> Result<String, i32> {
    validate_open_role(project, &task.role, json)?;
    if let Some(entry) = &project.manifest.process {
        let memory = memory::read(
            &entry.path,
            &entry.display,
            process::build,
            process::validate,
        );
        let process = memory
            .present()
            .ok_or_else(|| refuse("registered process cannot establish reuse authority", json))?;
        let permitted = process::permitted_models(process, &task.role);
        if !permitted.is_empty() && !permitted.iter().any(|allowed| allowed == model) {
            return Err(refuse(
                "accepted model is no longer permitted for this role",
                json,
            ));
        }
        Ok(fingerprint(&(entry.path.to_string_lossy(), process)))
    } else {
        Ok(fingerprint(&Option::<String>::None))
    }
}

fn inspect(
    manifest: &Path,
    name: &str,
    model: &str,
    reason: &str,
    json: bool,
) -> Result<Inspection, i32> {
    let project = project::read_manifest(manifest)
        .and_then(project::load)
        .map_err(|failure| {
            refuse(
                format!("cannot reload evidence reuse context: {failure:?}"),
                json,
            )
        })?;
    let task = mutate(&project, name, json)?;
    if !matches!(task.state.as_str(), "accepted" | "ready")
        || task.review_of.is_none()
        || !task
            .accepted
            .as_ref()
            .is_some_and(|accepted| accepted.model == model)
        || reason.trim().is_empty()
    {
        return Err(refuse(
            "execution reuse requires an ACCEPTED or READY explicit review, its same accepted model and a nonempty reason",
            json,
        ));
    }
    let authority = authority(&project, &task, model, json)?;
    require_tracking(&project, &task, json)?;
    if task::unanswered_decision(&task).is_some() || !task.falsify.is_empty() {
        return Err(refuse(
            "unanswered decisions and falsification obligations cannot reuse execution evidence",
            json,
        ));
    }
    let (original_index, evidence) = task
        .evidence
        .iter()
        .enumerate()
        .next_back()
        .ok_or_else(|| refuse("no original execution evidence exists", json))?;
    if !task::evidence_matches(&task, evidence)
        || evidence.exit != 0
        || evidence.tool != "run"
        || evidence.reuse.is_some()
        || evidence.command.as_ref().is_none_or(|argv| argv.is_empty())
    {
        return Err(refuse(
            "latest evidence must be a successful original argv run in the current acceptance epoch; manual, legacy, changed checks and chained reuse are ineligible",
            json,
        ));
    }
    let tree = project::snapshot(&project.manifest.root, &project.ignore);
    if evidence.inputs.is_empty()
        || evidence.inputs.values().any(Option::is_none)
        || task::evidence_inputs(&task, &tree) != evidence.inputs
    {
        return Err(refuse(
            "the complete original execution input map must remain observable and exactly unchanged",
            json,
        ));
    }
    let log = evidence
        .log
        .as_ref()
        .ok_or_else(|| refuse("original run log is unavailable", json))?;
    let log_path = Path::new(log);
    if log_path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
        || !log_path.starts_with(task::scratch_label(name))
    {
        return Err(refuse(
            "original run log must remain inside this task's scratch directory",
            json,
        ));
    }
    let scratch = task::scratch_directory(&project.manifest.root, name)
        .canonicalize()
        .map_err(|_| refuse("original run scratch is unavailable", json))?;
    let log_path = project
        .manifest
        .root
        .join(log_path)
        .canonicalize()
        .map_err(|_| refuse("original run log is unreadable", json))?;
    if !log_path.starts_with(scratch) || !log_path.is_file() {
        return Err(refuse(
            "original run log escaped its task scratch or is not a file",
            json,
        ));
    }
    let mut file = std::fs::File::open(log_path)
        .map_err(|_| refuse("original run log is unreadable", json))?;
    let mut log_hash = project::Fnv::new();
    let mut buffer = [0u8; 8192];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| refuse("original run log is unreadable", json))?;
        if count == 0 {
            break;
        }
        log_hash.write(&buffer[..count]);
    }
    let edges = review_graph(&project, &task).map_err(|message| refuse(message, json))?;
    for (_, source) in &edges {
        require_tracking(&project, source, json)?;
        let source_model = source
            .accepted
            .as_ref()
            .ok_or_else(|| refuse("review target has no accepted model", json))?;
        authority_for_target(&project, source, &source_model.model, json)?;
        let paths = source
            .scope
            .iter()
            .cloned()
            .chain(task::evidence_inputs(source, &tree).into_keys())
            .chain(
                source
                    .delivery_obligations
                    .values()
                    .filter_map(|o| o.claim.as_ref())
                    .flat_map(|c| c.artifacts.keys().cloned()),
            )
            .chain(
                source
                    .delivery_reviews
                    .iter()
                    .flat_map(|r| r.artifacts.keys().cloned()),
            );
        for path in paths {
            if !evidence
                .inputs
                .keys()
                .any(|input| task::covers(input, &path))
                || task::observed_digest(&tree, &path).is_none()
            {
                return Err(refuse(
                    format!(
                        "recursive target {:?} path {path:?} is not covered by unchanged observable execution inputs",
                        source.name
                    ),
                    json,
                ));
            }
        }
    }
    let revision = intent_revision(&project, &task, &tree);
    let context = fingerprint(&(
        edges,
        review_context(&project, &task, &tree).map_err(|m| refuse(m, json))?,
        &std::fs::read(&project.manifest.path)
            .map_err(|_| refuse("manifest became unreadable", json))?,
    ));
    Ok(Inspection {
        task_digest: fingerprint(&task),
        authority,
        context,
        revision,
        evidence: evidence.clone(),
        original_index,
        log_digest: log_hash.finish(),
        project,
        task,
    })
}

fn authority_for_target(
    project: &Project,
    task: &Task,
    model: &str,
    json: bool,
) -> Result<(), i32> {
    authority(project, task, model, json).map(|_| ())
}

fn record(initial: Inspection, model: &str, reason: &str, json: bool) -> i32 {
    let mut accepted = match prepare_acceptance(&initial.project, initial.task.clone(), model, json)
    {
        Ok(task) => task,
        Err(exit) => return exit,
    };
    let current = match inspect(
        &initial.project.manifest.path,
        &initial.task.name,
        model,
        reason,
        json,
    ) {
        Ok(current) => current,
        Err(exit) => return exit,
    };
    if initial.task_digest != current.task_digest
        || initial.authority != current.authority
        || initial.context != current.context
        || initial.revision != current.revision
        || initial.log_digest != current.log_digest
    {
        return refuse(
            "task, original run, authority or recursive review context changed during execution reuse; nothing was recorded",
            json,
        );
    }
    let mut evidence = current.evidence;
    evidence.reuse = Some(task::EvidenceReuse {
        original_index: current.original_index,
        original_digest: fingerprint(&evidence),
        original_epoch: evidence.acceptance_epoch.expect("inspected epoch"),
        original_log_digest: current.log_digest,
        model: model.to_owned(),
        reason: reason.to_owned(),
        unix: now_unix(),
    });
    evidence.acceptance_epoch = Some(accepted.acceptance_epoch);
    evidence.tool = "reuse".into();
    task::apply_evidence(&mut accepted, evidence);
    store(&current.project, &mut accepted, json)
}

pub(crate) fn accept(project: &Project, name: &str, model: &str, reason: &str, json: bool) -> i32 {
    let initial = match inspect(&project.manifest.path, name, model, reason, json) {
        Ok(initial) => initial,
        Err(exit) => return exit,
    };
    record(initial, model, reason, json)
}

#[cfg(test)]
fn accept_with_checkpoint(
    project: &Project,
    name: &str,
    model: &str,
    reason: &str,
    checkpoint: impl FnOnce(),
) -> i32 {
    let initial = match inspect(&project.manifest.path, name, model, reason, true) {
        Ok(initial) => initial,
        Err(exit) => return exit,
    };
    checkpoint();
    record(initial, model, reason, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use tempfile::TempDir;

    fn write(root: &Path, path: &str, text: &str) {
        let path = root.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    fn rewrite(root: &Path, name: &str, change: impl FnOnce(&mut Value)) {
        let path = format!(".blabla/tasks/{name}.json");
        let mut value: Value =
            serde_json::from_slice(&std::fs::read(root.join(&path)).unwrap()).unwrap();
        change(&mut value);
        write(root, &path, &value.to_string());
    }
    fn fixture() -> (TempDir, Project) {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "project.bla",
            "project Reuse\nuse structure \"entry.bla\"\nprocess \"process.bla\"\n",
        );
        write(
            root,
            "entry.bla",
            "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
        );
        write(root, "src/app.rs", "pub fn run() {}\n");
        write(root, "review.md", "Observed bounded source\n");
        write(
            root,
            "process.bla",
            "role \"reviewer\" { purpose \"Inspect\" model \"reviewer\" }\n",
        );
        write(root, "check.py", "print('actual execution')\n");
        let project =
            project::load(project::read_manifest(&root.join("project.bla")).unwrap()).unwrap();
        for (name, scope, target) in [
            ("source", "src", None),
            ("review", "review.md", Some("source")),
        ] {
            assert_eq!(
                super::super::open(
                    &project,
                    Opening {
                        name: name.into(),
                        role: "reviewer".into(),
                        statement: "Inspect actual entry".into(),
                        scope: vec![scope.into()],
                        inputs: vec!["src".into(), "check.py".into(), "review.md".into()],
                        check_argv: Some(vec!["python3".into(), "check.py".into()]),
                        review_of: target.map(str::to_owned),
                        ..Default::default()
                    },
                    vec![],
                    name == "source",
                    false,
                    true,
                    &[]
                ),
                0
            );
            assert_eq!(super::super::accept(&project, name, "reviewer", true), 0);
            assert_eq!(super::super::evidence_run(&project, name, true), 0);
        }
        (temp, project)
    }
    fn tree_bytes(root: &Path) -> BTreeMap<String, Vec<u8>> {
        fn walk(root: &Path, path: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
            for entry in std::fs::read_dir(path).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    walk(root, &path, out);
                } else {
                    out.insert(
                        path.strip_prefix(root).unwrap().to_string_lossy().into(),
                        std::fs::read(path).unwrap(),
                    );
                }
            }
        }
        let mut out = BTreeMap::new();
        walk(root, root, &mut out);
        out
    }
    fn race(change: impl FnOnce(&Path)) {
        let (temp, project) = fixture();
        let root = temp.path();
        let mut after_change = None;
        assert_eq!(
            accept_with_checkpoint(
                &project,
                "review",
                "reviewer",
                "Inspect renewed target",
                || {
                    change(root);
                    after_change = Some(tree_bytes(root));
                }
            ),
            2
        );
        assert_eq!(
            tree_bytes(root),
            after_change.unwrap(),
            "refused operation wrote over concurrent state"
        );
    }
    #[test]
    fn no_op_checkpoint_uses_the_production_acceptance_path() {
        let (_temp, project) = fixture();
        assert_eq!(
            accept_with_checkpoint(&project, "review", "reviewer", "Exact inputs", || {}),
            0
        );
        let record = task::read(&project.manifest.root, "review")
            .unwrap()
            .unwrap();
        assert_eq!(record.acceptance_epoch, 2);
        assert_eq!(record.evidence.len(), 2);
        assert!(record.evidence[1].reuse.is_some());
    }
    #[test]
    fn changed_source_and_report_refuse_at_final_read() {
        for path in ["src/app.rs", "review.md", "check.py"] {
            race(|root| write(root, path, "changed"));
        }
    }
    #[test]
    fn valid_changed_task_and_recursive_target_records_refuse() {
        for name in ["review", "source"] {
            race(|root| {
                rewrite(root, name, |v| {
                    v["notes"] = json!([{"statement":"Concurrent valid note","unix":1}])
                })
            });
        }
    }
    #[test]
    fn changed_epoch_and_check_selection_refuse() {
        for epoch in [false, true] {
            race(|root| {
                rewrite(root, "review", |v| {
                    if epoch {
                        v["acceptance_epoch"] = json!(99);
                    } else {
                        v["check_inputs"] = json!(["src", "review.md"]);
                    }
                })
            });
        }
    }
    #[test]
    fn original_evidence_and_original_log_changes_refuse() {
        race(|root| rewrite(root, "review", |v| v["evidence"][0]["unix"] = json!(1)));
        race(|root| {
            let source = task::read(root, "review").unwrap().unwrap();
            write(
                root,
                source.evidence[0].log.as_ref().unwrap(),
                "changed original log",
            );
        });
    }
    #[test]
    fn still_permitted_policy_and_project_identity_changes_refuse() {
        race(|root| {
            write(
                root,
                "process.bla",
                "role \"reviewer\" { purpose \"Still permitted with changed authority\" model \"reviewer\" }\n",
            )
        });
        race(|root| {
            write(
                root,
                "project.bla",
                "project Changed\nuse structure \"entry.bla\"\nprocess \"process.bla\"\n",
            )
        });
    }
    #[test]
    fn target_replacement_membership_and_cycle_changes_refuse() {
        race(|root| rewrite(root, "source", |v| v["opened_unix"] = json!(1)));
        race(|root| {
            rewrite(root, "review", |v| {
                v["review_of"]["task"] = json!("missing")
            })
        });
        race(|root| {
            let review = task::read(root, "review").unwrap().unwrap();
            rewrite(
                root,
                "source",
                |v| {
                    v["review_of"] =
                        json!({"task":"review","revision":review.review_of.unwrap().revision})
                },
            )
        });
    }
    #[test]
    fn revoked_model_and_missing_target_refuse() {
        race(|root| {
            write(
                root,
                "process.bla",
                "role \"reviewer\" { purpose \"Inspect\" model \"replacement\" }\n",
            )
        });
        race(|root| std::fs::remove_file(root.join(".blabla/tasks/source.json")).unwrap());
    }
    #[test]
    fn actual_new_manual_target_disposition_refuses_at_final_read() {
        let (temp, project) = fixture();
        let root = temp.path();
        let mut after_change = None;
        assert_eq!(
            accept_with_checkpoint(&project, "review", "reviewer", "Inspect target", || {
                assert_eq!(
                    super::super::disposition(
                        &project,
                        "source",
                        "role::reviewer",
                        "confirmed-unchanged",
                        "Fresh manual inspection recorded concurrently",
                        "reviewer",
                        false,
                        true
                    ),
                    0
                );
                after_change = Some(tree_bytes(root));
            }),
            2
        );
        assert_eq!(tree_bytes(root), after_change.unwrap());
    }
    #[test]
    fn legacy_missing_provenance_and_unanswered_decision_refuse() {
        race(|root| {
            rewrite(root, "review", |v| {
                v["evidence"][0].as_object_mut().unwrap().remove("command");
            })
        });
        race(|root| {
            rewrite(root, "review", |v| {
                v["decisions"] = json!([{
                    "id":1,"question":"Owner decision remains open","kind":"choice","options":["a","b"],"pick":"a","confidence":0,"model":"reviewer","floor":80,"below_floor":true
                }]);
            })
        });
    }
}
