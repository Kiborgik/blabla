use super::*;

pub(super) fn create(project: &Project, task: &mut Task, json: bool, swallowed: &[String]) -> i32 {
    if let Some(identity) = recovery::running() {
        task.build = Some(identity.stamp());
    }
    write_record(project, task, json, true, swallowed, false)
}

pub(super) fn stamp(task: &mut Task, json: bool) -> Result<(), i32> {
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

pub(super) fn persist(
    project: &Project,
    task: &mut Task,
    json: bool,
    what: &str,
) -> Result<(), i32> {
    stamp(task, json)?;
    task::write(&project.manifest.root, task)
        .map(drop)
        .map_err(|failure| refuse(format!("cannot record the {what}: {failure}"), json))
}

pub(super) fn store(project: &Project, task: &mut Task, json: bool) -> i32 {
    store_with(project, task, json, &[])
}

pub(super) fn store_with(
    project: &Project,
    task: &mut Task,
    json: bool,
    swallowed: &[String],
) -> i32 {
    if let Err(exit) = stamp(task, json) {
        return exit;
    }
    write_record(project, task, json, false, swallowed, false)
}

pub(super) fn report_leftovers(root: &std::path::Path, name: &str, failure: &io::Error) {
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

pub(super) fn store_and_discard(project: &Project, task: &mut Task, json: bool) -> i32 {
    let code = store(project, task, json);
    if code == 0
        && let Err(failure) = task::store::discard_falsification(&project.manifest.root, &task.name)
    {
        report_leftovers(&project.manifest.root, &task.name, &failure);
    }
    code
}

pub(super) fn write_record(
    project: &Project,
    task: &mut Task,
    json: bool,
    whole_view: bool,
    swallowed: &[String],
    accepting: bool,
) -> i32 {
    let task = &*task;
    if let Err(failure) = task::write(&project.manifest.root, task) {
        return emit_error(
            error("task", format!("cannot record the task: {failure}"), None),
            json,
            2,
        );
    }
    let guidance = accepting
        .then(|| model_acceptance::guidance(project, task))
        .flatten();
    if !json && !whole_view {
        let result = write_task_line(task).and_then(|()| {
            if let Some(guidance) = guidance {
                writeln!(io::stdout().lock(), "Model policy: {}", guidance.message)
            } else {
                Ok(())
            }
        });
        return if result.is_ok() { 0 } else { 4 };
    }
    let mut shown = view(project, task);
    shown.swallowed_check_argv = swallowed.to_vec();
    shown.model_acceptance = guidance;
    render(json, &shown, |shown| {
        write_task(
            task,
            &project.manifest.root,
            role_floor(project, &task.role),
            shown,
        )
    })
}

pub(super) fn write_task_line(task: &Task) -> io::Result<()> {
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

pub(super) fn write_result_basis(output: &mut impl Write, task: &Task) -> io::Result<()> {
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
