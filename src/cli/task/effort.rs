use super::*;
use blabla::project::task::effort;
use std::path::{Path, PathBuf};

fn authority(project: &Project) -> Result<Vec<Vec<u8>>, String> {
    let mut paths = vec![project.manifest.path.clone()];
    if let Some(entry) = &project.manifest.process {
        paths.push(entry.path.clone());
    }
    paths
        .into_iter()
        .map(|path| {
            std::fs::read(&path)
                .map_err(|e| format!("cannot read effort authority {}: {e}", path.display()))
        })
        .collect()
}

fn records(project: &Project) -> Result<Vec<Task>, String> {
    let directory = task::directory(&project.manifest.root);
    let entries = match std::fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(format!(
                "cannot read task directory {}: {e}",
                directory.display()
            ));
        }
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("cannot enumerate task records: {e}"))?;
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "json") {
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
                return Err(format!(
                    "task record is not a regular file: {}",
                    path.display()
                ));
            }
            names.push(
                path.file_stem()
                    .and_then(|p| p.to_str())
                    .ok_or("task name is not UTF-8")?
                    .to_owned(),
            );
        }
    }
    names.sort();
    names
        .iter()
        .map(|name| {
            let record = task::read(&project.manifest.root, name)?
                .ok_or_else(|| format!("task {name} disappeared"))?;
            if record.name != *name {
                return Err(format!(
                    "task record {name} declares inconsistent name {:?}",
                    record.name
                ));
            }
            Ok(record)
        })
        .collect()
}

fn permitted(
    project: &Project,
    record: &Task,
    model: &str,
    phase: &str,
    json: bool,
) -> Result<(), i32> {
    validate_open_role(project, &record.role, json)?;
    let accepted = record.accepted.as_ref().is_some_and(|a| a.model == model);
    let allowed = declared_permitted_models(project, &record.role);
    if accepted && !allowed.is_empty() && !allowed.iter().any(|m| m == model) {
        return Err(emit_error(
            error(
                "task",
                format!(
                    "accepted model {model:?} is no longer permitted for role {}; its pending interval remains unconfirmed",
                    record.role
                ),
                None,
            ),
            json,
            2,
        ));
    }
    if accepted
        && (allowed.is_empty() || allowed.iter().any(|m| m == model))
        && (record.state == "accepted" || ["stop", "interrupt"].contains(&phase))
    {
        return Ok(());
    }
    if phase == "integration" || ["stop", "interrupt"].contains(&phase) {
        if ["accepted", "ready", "closed"].contains(&record.state.as_str()) {
            return validate_orchestrator_model(project, model, json);
        }
    }
    Err(emit_error(
        error(
            "task",
            "phase requires the current accepted permitted model; READY/CLOSED integration requires the declared orchestrator",
            None,
        ),
        json,
        2,
    ))
}

pub(crate) fn phase(
    project: &Project,
    name: &str,
    phase: &str,
    worker: &str,
    model: &str,
    reason: Option<&str>,
    json: bool,
) -> i32 {
    phase_with_checkpoint(project, name, phase, worker, model, reason, json, || {})
}

fn phase_with_checkpoint(
    project: &Project,
    name: &str,
    phase: &str,
    worker: &str,
    model: &str,
    reason: Option<&str>,
    json: bool,
    checkpoint: impl FnOnce(),
) -> i32 {
    let refuse = |message| emit_error(error("task", message, None), json, 2);
    let fresh = match blabla::project::read_manifest(&project.manifest.path)
        .and_then(blabla::project::load)
    {
        Ok(p) => p,
        Err(e) => return refuse(format!("cannot reload effort authority: {e:?}")),
    };
    let baseline = match authority(&fresh) {
        Ok(a) => a,
        Err(e) => return refuse(e),
    };
    let mut tasks = match records(&fresh) {
        Ok(t) => t,
        Err(e) => return refuse(e),
    };
    let before = serde_json::to_vec(&tasks).expect("tasks serialize");
    let Some(target) = tasks.iter().find(|t| t.name == name) else {
        return refuse(format!("task {name} not found"));
    };
    if let Err(exit) = permitted(&fresh, target, model, phase, json) {
        return exit;
    }
    let changed = match effort::switch(&mut tasks, name, worker, model, phase, reason, now_unix()) {
        Ok(c) => c,
        Err(e) => return refuse(e),
    };
    checkpoint();
    let current = match blabla::project::read_manifest(&project.manifest.path)
        .and_then(blabla::project::load)
    {
        Ok(p) => p,
        Err(e) => return refuse(format!("cannot reread effort authority: {e:?}")),
    };
    let current_tasks = match records(&current) {
        Ok(t) => t,
        Err(e) => return refuse(e),
    };
    if authority(&current).ok().as_ref() != Some(&baseline)
        || serde_json::to_vec(&current_tasks).expect("tasks serialize") != before
    {
        return refuse(
            "task or process authority changed during phase accounting; nothing was recorded"
                .into(),
        );
    }
    let Some(target) = current_tasks.iter().find(|t| t.name == name) else {
        return refuse("task disappeared".into());
    };
    if let Err(exit) = permitted(&current, target, model, phase, json) {
        return exit;
    }
    let result = tasks
        .iter_mut()
        .find(|t| t.name == name)
        .expect("target checked");
    if changed {
        if let Err(exit) = stamp(result, json) {
            return exit;
        }
        if let Err(e) = task::store::replace(&current.manifest.root, result) {
            return refuse(format!("cannot record effort: {e}"));
        }
    }
    if json {
        if write_json(&serde_json::json!({"task":name,"worker":worker,"phase":phase,"changed":changed,"interval":result.work_intervals.iter().rev().find(|i|i.worker==worker)})).is_ok() {
            0
        } else {
            4
        }
    } else {
        println!(
            "{}: effort {} for {}{}",
            name,
            phase,
            worker,
            if changed { "" } else { " (unchanged)" }
        );
        0
    }
}

fn manifest_at(path: &Path) -> PathBuf {
    if path.is_dir() {
        path.join("project.bla")
    } else {
        path.to_owned()
    }
}

pub(crate) fn budget(
    project: &Project,
    additional: &[PathBuf],
    since: Option<u64>,
    until: Option<u64>,
    json: bool,
) -> i32 {
    let mut projects = Vec::new();
    let mut rows = Vec::new();
    let mut diagnostics = Vec::new();
    let mut seen = BTreeSet::new();
    for path in std::iter::once(project.manifest.path.clone())
        .chain(additional.iter().map(|p| manifest_at(p)))
    {
        let path = match path.canonicalize() {
            Ok(p) => p,
            Err(e) => {
                diagnostics.push(format!("cannot access project {}: {e}", path.display()));
                continue;
            }
        };
        if !seen.insert(path.clone()) {
            continue;
        }
        let loaded = match blabla::project::read_manifest(&path).and_then(blabla::project::load) {
            Ok(p) => p,
            Err(e) => {
                diagnostics.push(format!("cannot load project {}: {e:?}", path.display()));
                continue;
            }
        };
        let label = loaded.manifest.root.display().to_string();
        projects.push(label.clone());
        match records(&loaded) {
            Ok(tasks) => rows.extend(tasks.into_iter().map(|t| (label.clone(), t))),
            Err(e) => diagnostics.push(format!("{label}: {e}")),
        }
    }
    projects.sort();
    rows.sort_by(|a, b| (&a.0, &a.1.name).cmp(&(&b.0, &b.1.name)));
    let view = effort::budget(&rows, projects, since, until, diagnostics);
    if json {
        return if write_json(&view).is_ok() { 0 } else { 4 };
    }
    println!(
        "Development effort: {} (coverage: {})",
        view.observed_target, view.coverage
    );
    println!(
        "Active: {} worker-seconds; verification + review + integration/publication: {}; target <=20%",
        view.active_seconds, view.overhead_seconds
    );
    println!(
        "Observed fraction: {}",
        view.observed_fraction
            .map(|v| format!("{:.2}%", v * 100.0))
            .unwrap_or_else(|| "unknown".into())
    );
    println!(
        "External blocked: {}; pending intervals: {}; unknown intervals: {}; legacy tasks: {}",
        view.blocked_seconds, view.pending_intervals, view.unknown_intervals, view.legacy_tasks
    );
    for diagnostic in &view.diagnostics {
        println!("Diagnostic: {diagnostic}");
    }
    if view.observed_target == "above" {
        println!(
            "Reuse current receipts and stage coherent work; record a concrete policy::development-time-budget exception when correctness requires more work. No gate is waived."
        );
    }
    println!("{}", view.authority);
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, Project) {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("project.bla"),
            "project Effort\nprocess \"process.bla\"\nuse structure \"entry.bla\"\n",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("process.bla"),
            "role \"worker\" { purpose \"Work\" model \"worker\" }\n",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("entry.bla"),
            "module app \"app.rs\"\nrequire \"entry\": symbol app::run\n",
        )
        .unwrap();
        std::fs::write(dir.path().join("app.rs"), "pub fn run() {}\n").unwrap();
        let project = blabla::project::load(
            blabla::project::read_manifest(&dir.path().join("project.bla")).unwrap(),
        )
        .unwrap();
        task::write(
            dir.path(),
            &Task {
                name: "one".into(),
                role: "worker".into(),
                state: "accepted".into(),
                accepted: Some(task::Acceptance {
                    model: "worker".into(),
                    unix: 1,
                    changed_at_acceptance: None,
                }),
                ..Task::default()
            },
        )
        .unwrap();
        (dir, project)
    }

    #[test]
    fn effort_final_reread_noop_records_the_real_interval() {
        let (dir, project) = fixture();
        let _lock = task::store::lock(dir.path()).unwrap();
        assert_eq!(
            phase_with_checkpoint(
                &project,
                "one",
                "development",
                "actor",
                "worker",
                None,
                true,
                || {}
            ),
            0
        );
        assert_eq!(
            task::read(dir.path(), "one")
                .unwrap()
                .unwrap()
                .work_intervals
                .len(),
            1
        );
    }

    #[test]
    fn effort_final_reread_rejects_valid_changed_task_context() {
        let (dir, project) = fixture();
        let _lock = task::store::lock(dir.path()).unwrap();
        assert_eq!(
            phase_with_checkpoint(
                &project,
                "one",
                "development",
                "actor",
                "worker",
                None,
                true,
                || {
                    let mut changed = task::read(dir.path(), "one").unwrap().unwrap();
                    changed.statement = "Concurrent valid assignment".into();
                    task::write(dir.path(), &changed).unwrap();
                }
            ),
            2
        );
        let after = task::read(dir.path(), "one").unwrap().unwrap();
        assert!(after.work_intervals.is_empty());
        assert_eq!(after.statement, "Concurrent valid assignment");
    }

    #[test]
    fn effort_final_reread_rejects_changed_still_permitted_process() {
        let (dir, project) = fixture();
        let _lock = task::store::lock(dir.path()).unwrap();
        let before = std::fs::read(task::path_of(dir.path(), "one")).unwrap();
        assert_eq!(
            phase_with_checkpoint(
                &project,
                "one",
                "development",
                "actor",
                "worker",
                None,
                true,
                || {
                    std::fs::write(dir.path().join("process.bla"),"role \"worker\" { purpose \"Changed authority context\" model \"worker\" }\n").unwrap();
                }
            ),
            2
        );
        assert_eq!(
            std::fs::read(task::path_of(dir.path(), "one")).unwrap(),
            before
        );
    }

    #[test]
    fn effort_final_reread_rejects_revoked_model_and_replaced_task() {
        for revoke in [true, false] {
            let (dir, project) = fixture();
            let _lock = task::store::lock(dir.path()).unwrap();
            assert_eq!(
                phase_with_checkpoint(
                    &project,
                    "one",
                    "development",
                    "actor",
                    "worker",
                    None,
                    true,
                    || {
                        if revoke {
                            std::fs::write(
                                dir.path().join("process.bla"),
                                "role \"worker\" { purpose \"Work\" model \"other\" }\n",
                            )
                            .unwrap();
                        } else {
                            let mut t = task::read(dir.path(), "one").unwrap().unwrap();
                            t.acceptance_epoch += 1;
                            task::write(dir.path(), &t).unwrap();
                        }
                    }
                ),
                2
            );
            assert!(
                task::read(dir.path(), "one")
                    .unwrap()
                    .unwrap()
                    .work_intervals
                    .is_empty()
            );
        }
    }
}
