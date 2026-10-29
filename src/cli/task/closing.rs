use super::*;

pub(super) fn run(project: &Project, action: TaskAction, json: bool) -> i32 {
    match action {
        TaskAction::Close {
            name,
            model,
            bounded: true,
            reason,
        } => close_bounded(
            project,
            &name,
            &model,
            reason.as_deref().unwrap_or(""),
            json,
        ),
        TaskAction::Close { name, model, .. } => close(project, &name, &model, json),
        _ => unreachable!("only the close command is dispatched here"),
    }
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

pub(super) fn close(project: &Project, name: &str, model: &str, json: bool) -> i32 {
    match inspect_close(project, name, model, json) {
        Ok(mut task) => store_and_discard(project, &mut task, json),
        Err(exit) => exit,
    }
}

fn inspect_close(project: &Project, name: &str, model: &str, json: bool) -> Result<Task, i32> {
    let mut task = mutate(project, name, json)?;
    require_tracking(project, &task, json)?;
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    if task.state == TaskState::Ready && !task::challenge_current(&task, &tree) {
        return Err(refuse(
            format!(
                "task {name:?} changed since its challenge; resume with blabla task accept {name} --model <id>, verify and challenge again before hand-back"
            ),
            json,
        ));
    }
    let report = assignment_report_at(project, &task, &tree);
    let mut excused = vec![skeptic::Class::WithdrawalResidue];
    if task::closes_against_opening(&task, &tree, &project.ignore) {
        excused.push(skeptic::Class::VerificationNotCurrent);
    }
    let standing = skeptic::standing(&report.grounded, &excused).len();
    if !task::accept_result(
        &mut task,
        &tree,
        &project.ignore,
        standing,
        model,
        now_unix(),
    ) {
        return Err(refuse(
            format!(
                "the result of {name:?} is not accepted: {reason}. blabla challenge {name} states what stands",
                reason = if standing == 0 {
                    format!(
                        "state {state:?} is not a hand-back awaiting a decision",
                        state = task.state.word()
                    )
                } else {
                    format!(
                        "{standing} grounded challenge(s) stand against it{unconfirmed}",
                        unconfirmed = unconfirmed_guidance(&task)
                    )
                }
            ),
            json,
        ));
    }
    Ok(task)
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
