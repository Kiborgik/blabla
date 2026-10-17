use super::*;
use blabla::project::{self, runstate, status};
use blabla::report::RunStatus;
use blabla::structure::LayerStatus;
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
struct RecordedStructure {
    status: String,
    verified: usize,
    violated: usize,
    errors: usize,
    rules: Vec<RecordedStructureRule>,
    #[serde(rename = "invocations")]
    _invocations: usize,
}

#[derive(Deserialize)]
struct RecordedStructureRule {
    id: String,
    status: String,
}

fn prior_structure_green(project: &Project, record: &status::Record) -> bool {
    let Some(value) = &record.structure else {
        return false;
    };
    let Ok(stored) = serde_json::from_value::<RecordedStructure>(value.clone()) else {
        return false;
    };
    let expected: BTreeSet<_> = project
        .structure_rules()
        .map(|rule| rule.id.as_str())
        .collect();
    let observed: BTreeSet<_> = stored.rules.iter().map(|rule| rule.id.as_str()).collect();
    stored.status == "green"
        && stored.violated == 0
        && stored.errors == 0
        && stored.verified == stored.rules.len()
        && stored.rules.len() == observed.len()
        && expected == observed
        && stored.rules.iter().all(|rule| rule.status == "green")
}

struct Decision {
    project: Project,
    task: Task,
    tree: BTreeMap<String, String>,
    revision: task::RelevantRevision,
    task_record: String,
    delivery_context: Option<String>,
    reviews: BTreeMap<String, task::RelevantRevision>,
    verification: Vec<u8>,
    marker: Option<Vec<u8>>,
    structure: String,
    record: status::Record,
}

fn refuse(message: impl Into<String>, json: bool) -> i32 {
    emit_error(error("task", message.into(), None), json, 2)
}

fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("cannot inspect {}: {error}", path.display())),
    }
}

fn inspect(
    manifest: &Path,
    name: &str,
    model: &str,
    reason: &str,
    json: bool,
) -> Result<Decision, i32> {
    if reason.trim().is_empty() || model.trim().is_empty() {
        return Err(refuse(
            "bounded result acceptance requires a nonempty owner reason and model",
            json,
        ));
    }
    let project = project::read_manifest(manifest)
        .and_then(project::load)
        .map_err(|failure| {
            refuse(
                format!("cannot reload bounded acceptance inputs: {failure:?}"),
                json,
            )
        })?;
    validate_orchestrator_model(&project, model, json)?;
    let task = mutate(&project, name, json)?;
    require_tracking(&project, &task, json)?;
    if task.result_basis.is_some() {
        return Err(refuse("a bounded result basis is already recorded", json));
    }
    let root = &project.manifest.root;
    let unreadable = task::unreadable(root);
    if !unreadable.is_empty() {
        return Err(refuse(unreadable.join("; "), json));
    }
    let tree = project::snapshot(root, &project.ignore);
    if task.state != "ready"
        || !task::challenge_current(&task, &tree)
        || !task::tracked_readiness(&task, root, &project.ignore, &tree).supported
    {
        return Err(refuse(
            "bounded acceptance requires a READY task with current evidence and challenge",
            json,
        ));
    }
    if review_freshness(&project, &task) == Some(false) {
        return Err(refuse(
            "the recursive review target is no longer current",
            json,
        ));
    }
    let delivery_context = delivery::close_context(&project, &task, json)?;
    let verification = std::fs::read(status::record_path(root)).map_err(|failure| {
        refuse(
            format!("cannot read prior canonical verification: {failure}"),
            json,
        )
    })?;
    let record: status::Record = serde_json::from_slice(&verification).map_err(|failure| {
        refuse(
            format!("cannot decode prior canonical verification: {failure}"),
            json,
        )
    })?;
    let marker =
        read_optional(&runstate::marker_path(root)).map_err(|message| refuse(message, json))?;
    let marker_value = marker
        .as_deref()
        .map(serde_json::from_slice::<runstate::Marker>)
        .transpose()
        .map_err(|failure| {
            refuse(
                format!("cannot decode verification run state: {failure}"),
                json,
            )
        })?;
    let mut evaluation = status::evaluate(&project, Ok(Some(record.clone())));
    status::apply_run_state(&mut evaluation, &project, Ok(marker_value));
    let structure = project.verify_structure();
    let view = status_view(&project, &evaluation, &structure);
    let eligible = evaluation.recorded.as_ref().is_some_and(|recorded| {
        recorded.status == RunStatus::Green
            && recorded.canonical
            && recorded.stale == ["implementation"]
    }) && evaluation.run_state.is_none()
        && evaluation.record_error.is_none()
        && record
            .run_id
            .as_ref()
            .is_some_and(|id| !id.trim().is_empty())
        && prior_structure_green(&project, &record)
        && structure.status == LayerStatus::Green
        && view.completion.state == status::CompletionState::Stale;
    if !eligible {
        return Err(refuse(
            "bounded acceptance requires prior overall canonical GREEN, only implementation drift, current GREEN structure and no pending verification",
            json,
        ));
    }
    let report = report_for(&project, &view, Some(&task), Err(skeptic::GOALS_NOT_JUDGED));
    let blockers: Vec<_> = report
        .grounded
        .iter()
        .filter(|class| !matches!(**class, "verification-not-current" | "withdrawal-residue"))
        .collect();
    if !blockers.is_empty() {
        return Err(refuse(
            format!("bounded result is not accepted: grounded challenges remain: {blockers:?}"),
            json,
        ));
    }
    let revision = task::relevant_revision(&task, &tree, review_identities(&project, &task));
    let task_record = fingerprint(&task);
    let reviews =
        review_context(&project, &task, &tree).map_err(|message| refuse(message, json))?;
    Ok(Decision {
        project,
        task,
        tree,
        revision,
        task_record,
        delivery_context,
        reviews,
        verification,
        marker,
        structure: fingerprint(&structure),
        record,
    })
}

fn record_result(initial: Decision, model: &str, reason: &str, json: bool) -> i32 {
    let mut current = match inspect(
        &initial.project.manifest.path,
        &initial.task.name,
        model,
        reason,
        json,
    ) {
        Ok(current) => current,
        Err(exit) => return exit,
    };
    if current.delivery_context != initial.delivery_context
        || current.task_record != initial.task_record
        || current.revision != initial.revision
        || current.reviews != initial.reviews
        || current.verification != initial.verification
        || current.marker != initial.marker
        || current.structure != initial.structure
    {
        return refuse(
            "task, review or verification eligibility changed during the bounded acceptance decision; inspect and retry",
            json,
        );
    }
    if !task::accept_result(
        &mut current.task,
        &current.tree,
        &current.project.ignore,
        0,
        model,
        now_unix(),
    ) {
        return refuse(
            "the current bounded result is no longer ready for acceptance",
            json,
        );
    }
    current.task.result_basis = Some(task::ResultBasis::Bounded {
        reason: reason.to_owned(),
        project_state: "stale".into(),
        prior_run_id: current
            .record
            .run_id
            .expect("eligible record has a run identity"),
        implementation_fingerprint: current.record.implementation_fingerprint,
        revision: current.revision,
    });
    store_and_discard(&current.project, &mut current.task, json)
}

pub(super) fn close(project: &Project, name: &str, model: &str, reason: &str, json: bool) -> i32 {
    let initial = match inspect(&project.manifest.path, name, model, reason, json) {
        Ok(initial) => initial,
        Err(exit) => return exit,
    };
    record_result(initial, model, reason, json)
}

#[cfg(test)]
pub(super) fn close_with_checkpoint(
    project: &Project,
    name: &str,
    model: &str,
    reason: &str,
    checkpoint: impl FnOnce(),
) -> i32 {
    let initial = match inspect(&project.manifest.path, name, model, reason, false) {
        Ok(initial) => initial,
        Err(exit) => return exit,
    };
    checkpoint();
    record_result(initial, model, reason, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use blabla::project::{self, runstate};
    use serde_json::{Value, json};
    use std::path::Path;
    use tempfile::TempDir;

    fn write(root: &Path, path: &str, text: &str) {
        let path = root.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn load_project(root: &Path) -> Project {
        project::load(project::read_manifest(&root.join("project.bla")).unwrap()).unwrap()
    }

    fn rewrite(root: &Path, path: &str, change: impl FnOnce(&mut Value)) {
        let mut value: Value =
            serde_json::from_slice(&std::fs::read(root.join(path)).unwrap()).unwrap();
        change(&mut value);
        write(root, path, &value.to_string());
    }

    fn open_work(project: &Project, name: &str, path: &str, review_of: Option<&str>) {
        assert_eq!(
            super::super::open(
                project,
                Opening {
                    name: name.into(),
                    role: "worker".into(),
                    statement: "Exercise bounded recording".into(),
                    scope: vec![path.into()],
                    deliverables: vec![path.into()],
                    inputs: if review_of.is_none() {
                        vec![path.into()]
                    } else {
                        vec![]
                    },
                    check_argv: Some(vec![
                        "python3".into(),
                        "-c".into(),
                        "assert 1 + 1 == 2".into()
                    ]),
                    review_of: review_of.map(str::to_owned),
                    ..Default::default()
                },
                vec![],
                false,
                false,
                false,
                &[]
            ),
            0
        );
        assert_eq!(super::super::accept(project, name, "worker", false), 0);
        write(&project.manifest.root, path, "reviewed change\n");
        assert_eq!(super::super::evidence_run(project, name, false), 0);
        assert_eq!(super::super::challenge(project, Some(name), false), 0);
        assert_eq!(super::super::ready(project, name, false), 0);
    }

    fn fixture(review_depth: usize) -> (TempDir, Project, String) {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "project.bla",
            "project BoundedRace\nuse behavior \"behavior.bla\"\nuse structure \"structure.bla\"\nprocess \"process.bla\"\nverify behavior { command [\"python3\", \"app.py\"] seed 0 cases 1 steps 4 timeout_ms 2000 shrink_budget 8 }\n",
        );
        write(
            root,
            "behavior.bla",
            "state count: int\naction increment()\nwhen increment { expect \"adds-one\": after.count == before.count + 1 }\n",
        );
        write(
            root,
            "structure.bla",
            "module entry \"entry.rs\"\nrequire \"entry-exists\": symbol entry::run\n",
        );
        write(root, "entry.rs", "pub fn run() {}\n");
        write(
            root,
            "process.bla",
            "role \"orchestrator\" { purpose \"Integrate\" model \"owner\" }\nrole \"worker\" { purpose \"Work\" model \"worker\" }\n",
        );
        write(
            root,
            "app.py",
            "import json,sys\nn=0\nfor line in sys.stdin:\n r=json.loads(line)\n if r['op']=='reset':\n  n=0\n  value={'ok':True}\n elif r['op']=='call':\n  n+=1\n  value={'ok':True}\n else:\n  value={'count':n}\n print(json.dumps({'id':r['id'],'result':value}),flush=True)\n",
        );
        write(root, "owned.txt", "before\n");
        write(root, "reports/other.md", "before\n");
        for depth in 0..review_depth {
            write(root, &format!("review{depth}.md"), "before\n");
        }
        let project = load_project(root);
        let mut other = task::record(
            root,
            &project.ignore,
            Opening {
                name: "other".into(),
                role: "worker".into(),
                statement: "Concurrent report".into(),
                scope: vec!["reports".into(), "entry.rs".into()],
                ..Default::default()
            },
            now_unix(),
        );
        task::record_acceptance(
            &mut other,
            &project::snapshot(root, &project.ignore),
            &project.ignore,
            "worker",
            now_unix(),
        );
        task::write(root, &other).unwrap();
        open_work(&project, "work", "owned.txt", None);
        let mut name = "work".to_owned();
        for depth in 0..review_depth {
            let review = format!("review{depth}");
            open_work(&project, &review, &format!("{review}.md"), Some(&name));
            name = review;
        }
        assert_eq!(
            super::super::super::project::finish(&project, false, false),
            0
        );
        write(root, "reports/other.md", "concurrent report\n");
        (temp, project, name)
    }

    fn race(review_depth: usize, mutation: impl FnOnce(&Path)) {
        let (_temp, project, name) = fixture(review_depth);
        let root = &project.manifest.root;
        let path = format!(".blabla/tasks/{name}.json");
        let mut reached = false;
        let mut retained = None;
        let exit = close_with_checkpoint(
            &project,
            &name,
            "owner",
            "Current bounded result only",
            || {
                reached = true;
                mutation(root);
                retained = Some((
                    std::fs::read(root.join(&path)).unwrap(),
                    std::fs::read(root.join(".blabla/status.json")).ok(),
                    std::fs::read(root.join(".blabla/verifying.json")).ok(),
                ));
            },
        );
        assert!(
            reached,
            "the mutation must follow genuine initial eligibility"
        );
        assert_eq!(exit, 2);
        let (task_bytes, status_bytes, marker_bytes) = retained.unwrap();
        assert_eq!(std::fs::read(root.join(path)).unwrap(), task_bytes);
        assert_eq!(
            std::fs::read(root.join(".blabla/status.json")).ok(),
            status_bytes
        );
        assert_eq!(
            std::fs::read(root.join(".blabla/verifying.json")).ok(),
            marker_bytes
        );
    }

    fn start_marker(root: &Path, live: bool) {
        let project = load_project(root);
        runstate::write_marker(
            root,
            &runstate::Marker {
                run_id: "new-verification-after-eligibility".into(),
                pid: if live { std::process::id() } else { u32::MAX },
                started_unix: now_unix(),
                verifier_version: env!("CARGO_PKG_VERSION").into(),
                project_identity: project.identity.clone(),
                profile_identity: runstate::profile_identity(project.manifest.profile.as_ref()),
                profile: project.manifest.profile.clone(),
            },
        )
        .unwrap();
        let marker = runstate::read_marker(root).unwrap().unwrap();
        assert_eq!(
            runstate::classify(&marker, &project.identity, &marker.profile_identity, None),
            if live {
                runstate::Classification::Verifying
            } else {
                runstate::Classification::Interrupted
            }
        );
    }

    #[test]
    fn bounded_checkpoint_noop_accepts_and_preserves_verification() {
        let (_temp, project, name) = fixture(0);
        let root = &project.manifest.root;
        let status = std::fs::read(root.join(".blabla/status.json")).unwrap();
        let mut reached = false;
        assert_eq!(
            close_with_checkpoint(
                &project,
                &name,
                "owner",
                "Current bounded result only",
                || reached = true
            ),
            0
        );
        assert!(reached);
        assert_eq!(task::read(root, &name).unwrap().unwrap().state, "closed");
        assert_eq!(
            std::fs::read(root.join(".blabla/status.json")).unwrap(),
            status
        );
    }

    #[test]
    fn bounded_checkpoint_rechecks_owned_input() {
        race(0, |root| write(root, "owned.txt", "later input\n"));
    }

    #[test]
    fn bounded_checkpoint_rechecks_own_epoch() {
        race(0, |root| {
            rewrite(root, ".blabla/tasks/work.json", |v| {
                v["acceptance_epoch"] = json!(2)
            })
        });
    }

    #[test]
    fn bounded_checkpoint_preserves_a_new_task_record() {
        race(0, |root| {
            rewrite(root, ".blabla/tasks/work.json", |v| {
                v["statement"] = json!("New owner instruction")
            })
        });
    }

    #[test]
    fn bounded_checkpoint_rechecks_review_target_input() {
        race(1, |root| write(root, "owned.txt", "later target input\n"));
    }

    #[test]
    fn bounded_checkpoint_rechecks_recursive_target_epoch() {
        race(2, |root| {
            rewrite(root, ".blabla/tasks/work.json", |v| {
                v["acceptance_epoch"] = json!(2)
            })
        });
    }

    #[test]
    fn bounded_checkpoint_refuses_a_replaced_green_run() {
        race(0, |root| {
            rewrite(root, ".blabla/status.json", |v| {
                v["run_id"] = json!("another-green-run")
            })
        });
    }

    #[test]
    fn bounded_checkpoint_refuses_a_new_red_record() {
        race(0, |root| {
            rewrite(root, ".blabla/status.json", |v| {
                v["report"]["status"] = json!("red")
            })
        });
    }

    #[test]
    fn bounded_checkpoint_refuses_a_removed_record() {
        race(0, |root| {
            std::fs::remove_file(root.join(".blabla/status.json")).unwrap()
        });
    }

    #[test]
    fn bounded_checkpoint_reloads_the_profile() {
        race(0, |root| {
            let text = std::fs::read_to_string(root.join("project.bla")).unwrap();
            write(root, "project.bla", &text.replace("seed 0", "seed 1"));
        });
    }

    #[test]
    fn bounded_checkpoint_reloads_contract_identity() {
        race(0, |root| {
            let text = std::fs::read_to_string(root.join("behavior.bla")).unwrap();
            write(
                root,
                "behavior.bla",
                &text.replace("adds-one", "different-contract"),
            );
        });
    }

    #[test]
    fn bounded_checkpoint_rechecks_the_verifier() {
        race(0, |root| {
            rewrite(root, ".blabla/status.json", |v| {
                v["verifier_version"] = json!("another-verifier")
            })
        });
    }

    #[test]
    fn bounded_checkpoint_refuses_a_new_live_verification() {
        race(0, |root| start_marker(root, true));
    }

    #[test]
    fn bounded_checkpoint_refuses_a_new_interrupted_verification() {
        race(0, |root| start_marker(root, false));
    }

    #[test]
    fn bounded_checkpoint_rechecks_live_structure() {
        race(0, |root| write(root, "entry.rs", "pub fn renamed() {}\n"));
    }

    #[test]
    fn bounded_checkpoint_rechecks_owner_policy() {
        race(0, |root| {
            let text = std::fs::read_to_string(root.join("process.bla")).unwrap();
            write(
                root,
                "process.bla",
                &text.replace("model \"owner\"", "model \"other-owner\""),
            );
        });
    }
}
