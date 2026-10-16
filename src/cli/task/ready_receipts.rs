use super::*;
use blabla::project;
use std::path::Path;

#[derive(Clone)]
pub(super) enum Claim {
    Disposition {
        identity: String,
        status: String,
        reason: String,
        model: String,
    },
    Reflection {
        decision: String,
        observation: String,
        evidence_refs: Vec<String>,
        reason: String,
        outcome: task::GoalReflectionOutcome,
        model: String,
    },
}

impl Claim {
    fn model(&self) -> &str {
        match self {
            Self::Disposition { model, .. } | Self::Reflection { model, .. } => model,
        }
    }

    fn apply(
        &self,
        project: &Project,
        task: &mut Task,
        tree: &BTreeMap<String, String>,
    ) -> Result<(), String> {
        match self {
            Self::Disposition {
                identity,
                status,
                reason,
                model,
            } => {
                let revision = intent_revision(project, task, tree);
                task::refresh_ready_disposition(
                    task,
                    task::IntentDisposition {
                        identity: identity.clone(),
                        status: status.clone(),
                        reason: reason.clone(),
                        model: model.clone(),
                        unix: now_unix(),
                        revision,
                    },
                )
            }
            Self::Reflection {
                decision,
                observation,
                evidence_refs,
                reason,
                outcome,
                model,
            } => {
                if let Some(goal) = &task.goal
                    && let Some(message) = super::super::project::undeclared_goal(project, goal)
                {
                    return Err(message);
                }
                let revision = goal_reflection_revision(project, task, tree);
                task::refresh_ready_goal_reflection(
                    task,
                    task::GoalReflection {
                        decision: decision.clone(),
                        observation: observation.clone(),
                        evidence_refs: evidence_refs.clone(),
                        reason: reason.clone(),
                        outcome: outcome.clone(),
                        model: model.clone(),
                        unix: now_unix(),
                        revision,
                    },
                )
            }
        }
    }
}

struct Inspection {
    project: Project,
    task: Task,
    tree: BTreeMap<String, String>,
    task_record: String,
    authority: String,
    revision: task::RelevantRevision,
    reviews: BTreeMap<String, task::RelevantRevision>,
}

fn refuse(message: impl Into<String>, json: bool) -> i32 {
    emit_error(error("task", message.into(), None), json, 2)
}

fn inspect(manifest: &Path, name: &str, claim: &Claim, json: bool) -> Result<Inspection, i32> {
    let project = project::read_manifest(manifest)
        .and_then(project::load)
        .map_err(|failure| {
            refuse(
                format!("cannot reload READY receipt inputs: {failure:?}"),
                json,
            )
        })?;
    let task = load(&project, name, json)?;
    if task.state != "ready"
        || !task
            .accepted
            .as_ref()
            .is_some_and(|accepted| accepted.model == claim.model())
    {
        return Err(refuse(
            "--refresh-ready requires a READY task and its same accepted model",
            json,
        ));
    }
    validate_open_role(&project, &task.role, json)?;
    let authority = if let Some(entry) = &project.manifest.process {
        let memory = memory::read(
            &entry.path,
            &entry.display,
            process::build,
            process::validate,
        );
        let process = memory.present().ok_or_else(|| {
            refuse(
                "registered process cannot establish current model authority",
                json,
            )
        })?;
        let permitted = process::permitted_models(process, &task.role);
        if !permitted.is_empty() && !permitted.iter().any(|model| model == claim.model()) {
            return Err(refuse(
                "the accepted model is no longer permitted by the current role",
                json,
            ));
        }
        fingerprint(&(entry.path.to_string_lossy(), process))
    } else {
        fingerprint(&Option::<String>::None)
    };
    require_tracking(&project, &task, json)?;
    let tree = project::snapshot(&project.manifest.root, &project.ignore);
    if !task::tracked_readiness(&task, &project.manifest.root, &project.ignore, &tree).supported {
        return Err(refuse(
            "READY receipt refresh requires current successful evidence for the declared check and acceptance epoch; reaccept and rerun changed work",
            json,
        ));
    }
    if review_freshness(&project, &task) == Some(false) {
        return Err(refuse(
            "READY receipt refresh cannot repin a stale recursive review target; reaccept the review",
            json,
        ));
    }
    claim
        .apply(&project, &mut task.clone(), &tree)
        .map_err(|message| refuse(message, json))?;
    let mut reviews = BTreeMap::new();
    let mut current = task.clone();
    while let Some(target) = &current.review_of {
        if reviews.contains_key(&target.task) {
            return Err(refuse("recursive review cycle", json));
        }
        let reviewed = load(&project, &target.task, json)?;
        reviews.insert(
            target.task.clone(),
            task::review_revision(
                &current,
                &reviewed,
                &tree,
                review_dependencies(&project, &current, &reviewed),
            ),
        );
        current = reviewed;
    }
    Ok(Inspection {
        task_record: fingerprint(&task),
        revision: intent_revision(&project, &task, &tree),
        authority,
        reviews,
        project,
        task,
        tree,
    })
}

fn record(initial: Inspection, claim: &Claim, json: bool) -> i32 {
    let mut current = match inspect(
        &initial.project.manifest.path,
        &initial.task.name,
        claim,
        json,
    ) {
        Ok(current) => current,
        Err(exit) => return exit,
    };
    if initial.task_record != current.task_record
        || initial.authority != current.authority
        || initial.revision != current.revision
        || initial.reviews != current.reviews
    {
        return refuse(
            "task, authority, intent or recursive review inputs changed during READY receipt refresh; inspect and supply the claim again",
            json,
        );
    }
    if let Err(message) = claim.apply(&current.project, &mut current.task, &current.tree) {
        return refuse(message, json);
    }
    store(&current.project, &mut current.task, json)
}

pub(super) fn refresh(project: &Project, name: &str, claim: Claim, json: bool) -> i32 {
    let initial = match inspect(&project.manifest.path, name, &claim, json) {
        Ok(initial) => initial,
        Err(exit) => return exit,
    };
    record(initial, &claim, json)
}

#[cfg(test)]
fn refresh_with_checkpoint(
    project: &Project,
    name: &str,
    claim: Claim,
    checkpoint: impl FnOnce(),
) -> i32 {
    let initial = match inspect(&project.manifest.path, name, &claim, false) {
        Ok(initial) => initial,
        Err(exit) => return exit,
    };
    checkpoint();
    record(initial, &claim, false)
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
        let mut record: Value =
            serde_json::from_slice(&std::fs::read(root.join(&path)).unwrap()).unwrap();
        change(&mut record);
        write(root, &path, &record.to_string());
    }

    fn load_project(root: &Path) -> Project {
        project::load(project::read_manifest(&root.join("project.bla")).unwrap()).unwrap()
    }

    fn claim(reflection: bool) -> Claim {
        if reflection {
            Claim::Reflection {
                decision: "Retain the checked entry".into(),
                observation: "The real Python check read the entry".into(),
                evidence_refs: vec!["src/app.rs".into()],
                reason: "The bounded callable entry requires no successor".into(),
                outcome: task::GoalReflectionOutcome::NoUsefulSuccessor,
                model: "worker".into(),
            }
        } else {
            Claim::Disposition {
                identity: "goal::deliver".into(),
                status: "confirmed-unchanged".into(),
                reason: "The checked entry still satisfies this bounded intent".into(),
                model: "worker".into(),
            }
        }
    }

    fn prepare(project: &Project, name: &str, path: &str, target: Option<&str>) {
        assert_eq!(
            super::super::open(
                project,
                Opening {
                    name: name.into(),
                    role: "worker".into(),
                    statement: "Check the entry".into(),
                    scope: vec![path.into()],
                    inputs: vec!["src".into(), "check.py".into()],
                    check_argv: Some(vec!["python3".into(), "check.py".into()]),
                    goal: Some("deliver".into()),
                    review_of: target.map(str::to_owned),
                    ..Default::default()
                },
                vec![],
                true,
                true,
                false,
                &[]
            ),
            0
        );
        assert_eq!(super::super::accept(project, name, "worker", false), 0);
        assert_eq!(super::super::evidence_run(project, name, false), 0);
        let record = task::read(&project.manifest.root, name).unwrap().unwrap();
        let tree = project::snapshot(&project.manifest.root, &project.ignore);
        for identity in intent_revision(project, &record, &tree).identities.keys() {
            assert_eq!(
                super::super::disposition(
                    project,
                    name,
                    identity,
                    "confirmed-unchanged",
                    "Actual entry and evidence inspected",
                    "worker",
                    false,
                    false
                ),
                0
            );
        }
        let Claim::Reflection {
            decision,
            observation,
            evidence_refs,
            reason,
            outcome,
            model,
        } = claim(true)
        else {
            unreachable!()
        };
        assert_eq!(
            super::super::reflect(
                project,
                name,
                decision,
                observation,
                evidence_refs,
                reason,
                outcome,
                model,
                false,
                false
            ),
            0
        );
        assert_eq!(super::super::challenge(project, Some(name), false), 0);
        assert_eq!(super::super::ready(project, name, false), 0);
    }

    fn fixture(depth: usize) -> (TempDir, Project, String) {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "project.bla",
            "project RefreshRace\nuse structure \"entry.bla\"\nprocess \"process.bla\"\ngoal \"goals.bla\"\n",
        );
        write(
            root,
            "entry.bla",
            "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
        );
        write(root, "src/app.rs", "pub fn run() {}\n");
        write(
            root,
            "check.py",
            "from pathlib import Path\nassert 'pub fn run' in Path('src/app.rs').read_text()\n",
        );
        write(
            root,
            "process.bla",
            "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\n",
        );
        write(
            root,
            "goals.bla",
            "goal \"deliver\" { statement \"Retain entry\" expect [\"contract::entry\"] state \"active\" }\n",
        );
        for index in 0..depth {
            write(root, &format!("review{index}.md"), "Existing review\n");
        }
        let project = load_project(root);
        prepare(&project, "work", "src", None);
        let mut name = "work".to_owned();
        for index in 0..depth {
            let next = format!("review{index}");
            prepare(&project, &next, &format!("{next}.md"), Some(&name));
            name = next;
        }
        (temp, project, name)
    }

    fn bytes(root: &Path) -> BTreeMap<String, Vec<u8>> {
        fn visit(root: &Path, path: &Path, result: &mut BTreeMap<String, Vec<u8>>) {
            for entry in std::fs::read_dir(path).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    visit(root, &path, result);
                } else {
                    result.insert(
                        path.strip_prefix(root).unwrap().to_string_lossy().into(),
                        std::fs::read(path).unwrap(),
                    );
                }
            }
        }
        let mut result = BTreeMap::new();
        visit(root, root, &mut result);
        result
    }

    fn race(depth: usize, mutation: impl Fn(&Path, &str)) {
        for reflection in [false, true] {
            let (_temp, project, name) = fixture(depth);
            let root = &project.manifest.root;
            let mut after_mutation = None;
            let exit = refresh_with_checkpoint(&project, &name, claim(reflection), || {
                mutation(root, &name);
                after_mutation = Some(bytes(root));
            });
            assert!(
                after_mutation.is_some(),
                "initial actual eligibility must reach checkpoint"
            );
            assert_eq!(exit, 2);
            assert_eq!(bytes(root), after_mutation.unwrap());
        }
    }

    #[test]
    fn ready_refresh_checkpoint_noop_records_only_claim_and_challenge() {
        for reflection in [false, true] {
            let (_temp, project, name) = fixture(1);
            let root = &project.manifest.root;
            let mut before =
                serde_json::to_value(task::read(root, &name).unwrap().unwrap()).unwrap();
            let tree_before = bytes(root);
            let mut reached = false;
            assert_eq!(
                refresh_with_checkpoint(&project, &name, claim(reflection), || reached = true),
                0
            );
            assert!(reached);
            let after = serde_json::to_value(task::read(root, &name).unwrap().unwrap()).unwrap();
            before.as_object_mut().unwrap().remove("challenged");
            let key = if reflection {
                "goal_reflection"
            } else {
                "intent_dispositions"
            };
            before[key] = after[key].clone();
            assert_eq!(after, before);
            let mut expected = tree_before;
            let path = format!(".blabla/tasks/{name}.json");
            expected.insert(path.clone(), std::fs::read(root.join(path)).unwrap());
            assert_eq!(bytes(root), expected);
        }
    }

    #[test]
    fn ready_refresh_checkpoint_rechecks_epoch_state_and_model() {
        for field in ["acceptance_epoch", "state", "accepted"] {
            race(0, |root, name| {
                rewrite(root, name, |value| match field {
                    "acceptance_epoch" => value[field] = json!(99),
                    "state" => value[field] = json!("blocked"),
                    _ => value[field]["model"] = json!("other"),
                })
            });
        }
    }

    #[test]
    fn ready_refresh_checkpoint_preserves_concurrent_valid_note() {
        race(0, |root, name| {
            let project = load_project(root);
            assert_eq!(
                super::super::note(&project, name, "A concurrent valid note", false),
                0
            );
        });
    }

    #[test]
    fn ready_refresh_checkpoint_preserves_concurrent_valid_claim() {
        race(0, |root, name| {
            let project = load_project(root);
            assert_eq!(refresh(&project, name, claim(false), false), 0);
        });
    }

    #[test]
    fn ready_refresh_checkpoint_rechecks_current_process_authority() {
        for replacement in [
            "role \"worker\" { purpose \"Implement\" model \"other\" }\n",
            "role \"different\" { purpose \"Implement\" model \"worker\" }\n",
            "malformed process",
        ] {
            race(0, |root, _| write(root, "process.bla", replacement));
        }
        race(0, |root, _| {
            std::fs::remove_file(root.join("process.bla")).unwrap()
        });
    }

    #[test]
    fn ready_refresh_checkpoint_rechecks_valid_changed_authority() {
        race(0, |root, _| {
            let path = root.join("process.bla");
            let text = std::fs::read_to_string(&path)
                .unwrap()
                .replace("Implement", "Implement with revised intent");
            std::fs::write(path, text).unwrap();
        });
    }

    #[test]
    fn ready_refresh_checkpoint_reloads_process_registration() {
        race(0, |root, _| {
            let text = std::fs::read_to_string(root.join("process.bla")).unwrap();
            write(root, "replacement.bla", &text);
            let manifest = std::fs::read_to_string(root.join("project.bla"))
                .unwrap()
                .replace("process.bla", "replacement.bla");
            write(root, "project.bla", &manifest);
        });
    }

    #[test]
    fn ready_refresh_checkpoint_rechecks_valid_goal_identity() {
        race(0, |root, _| {
            write(
                root,
                "goals.bla",
                "goal \"deliver\" { statement \"Retain revised entry intent\" expect [\"contract::entry\"] state \"active\" }\n",
            )
        });
    }

    #[test]
    fn ready_refresh_checkpoint_rechecks_source_and_directory_children() {
        race(0, |root, _| {
            write(root, "src/app.rs", "pub fn run() { let _ = 1; }\n")
        });
        race(0, |root, _| write(root, "src/new.rs", "pub fn new() {}\n"));
        race(0, |root, _| {
            std::fs::remove_file(root.join("src/app.rs")).unwrap()
        });
    }

    #[test]
    fn ready_refresh_checkpoint_rechecks_check_selection() {
        race(0, |root, name| {
            rewrite(root, name, |value| {
                value["check_argv"] = json!(["python3", "-c", "raise SystemExit(1)"])
            })
        });
        race(0, |root, name| {
            rewrite(root, name, |value| {
                value["check_inputs"] = json!(["src/app.rs"])
            })
        });
    }

    #[test]
    fn ready_refresh_checkpoint_rechecks_latest_evidence() {
        race(0, |root, name| {
            rewrite(root, name, |value| value["evidence"] = json!([]))
        });
        race(0, |root, name| {
            rewrite(root, name, |value| {
                let mut failed = value["evidence"]
                    .as_array()
                    .unwrap()
                    .last()
                    .unwrap()
                    .clone();
                failed["exit"] = json!(17);
                value["evidence"].as_array_mut().unwrap().push(failed);
            })
        });
    }

    #[test]
    fn ready_refresh_checkpoint_rechecks_target_epoch_and_claims() {
        race(1, |root, _| {
            rewrite(root, "work", |value| value["acceptance_epoch"] = json!(99))
        });
        race(1, |root, _| {
            let project = load_project(root);
            assert_eq!(refresh(&project, "work", claim(false), false), 0);
        });
    }

    #[test]
    fn ready_refresh_checkpoint_rechecks_recursive_target() {
        race(2, |root, _| {
            rewrite(root, "work", |value| value["acceptance_epoch"] = json!(99))
        });
    }

    #[test]
    fn ready_refresh_checkpoint_rechecks_missing_corrupt_and_withdrawn_target() {
        race(1, |root, _| {
            std::fs::remove_file(root.join(".blabla/tasks/work.json")).unwrap()
        });
        race(1, |root, _| {
            write(root, ".blabla/tasks/work.json", "broken")
        });
        race(1, |root, _| {
            rewrite(root, "work", |value| value["state"] = json!("withdrawn"))
        });
    }

    #[test]
    fn ready_refresh_checkpoint_allows_closure_only_target_metadata() {
        for reflection in [false, true] {
            let (_temp, project, name) = fixture(1);
            let root = &project.manifest.root;
            let before = task::read(root, &name).unwrap().unwrap();
            assert_eq!(
                refresh_with_checkpoint(&project, &name, claim(reflection), || {
                    rewrite(root, "work", |value| {
                        value["state"] = json!("closed");
                        value["closed_unix"] = json!(now_unix());
                    });
                }),
                0
            );
            let after = task::read(root, &name).unwrap().unwrap();
            assert_eq!(
                fingerprint(&before.review_of),
                fingerprint(&after.review_of)
            );
            assert_eq!(review_freshness(&project, &after), Some(true));
        }
    }

    #[test]
    fn ready_refresh_checkpoint_does_not_write_or_gate_on_global_status() {
        for reflection in [false, true] {
            let (_temp, project, name) = fixture(0);
            let root = &project.manifest.root;
            assert_eq!(
                refresh_with_checkpoint(&project, &name, claim(reflection), || {
                    write(
                        root,
                        ".blabla/status.json",
                        "explicit corrupt status fixture",
                    );
                    write(
                        root,
                        "unrelated.md",
                        "Concurrent report outside task inputs\n",
                    );
                }),
                0
            );
            assert_eq!(
                std::fs::read_to_string(root.join(".blabla/status.json")).unwrap(),
                "explicit corrupt status fixture"
            );
            assert_eq!(task::read(root, &name).unwrap().unwrap().state, "ready");
        }
    }
}
