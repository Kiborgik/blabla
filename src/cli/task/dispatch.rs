use super::*;

pub(in crate::cli) fn execute(
    project: &Project,
    action: TaskAction,
    json: bool,
    verbose: bool,
) -> i32 {
    if let TaskAction::Open { role, .. } = &action
        && let Err(exit) = validate_open_role(project, role, json)
    {
        return exit;
    }
    let swallowed = swallowed_options(&action);
    if !swallowed.is_empty() {
        eprintln!(
            "argv elements {} equal long options of this subcommand and are kept in the check argv; put BlaBla options before --check if they were meant for BlaBla",
            swallowed.join(", ")
        );
    }
    match action {
        action @ (TaskAction::Show { .. } | TaskAction::Freshness { .. }) => {
            showing::run(project, action, json, verbose)
        }
        TaskAction::Budget { name } => budget::run(project, &name, json),
        action @ TaskAction::Falsify { .. } => falsification::run(project, action, json),
        action @ TaskAction::Evidence { .. } => recording::run(project, action, json),
        action @ TaskAction::Open { .. } => locked(project, json, || {
            opening::run(project, action, json, &swallowed)
        }),
        action @ (TaskAction::Finding { .. }
        | TaskAction::Note { .. }
        | TaskAction::Addressed { .. }
        | TaskAction::Resolve { .. }) => {
            locked(project, json, || findings::run(project, action, json))
        }
        action @ (TaskAction::Ask { .. }
        | TaskAction::Decide { .. }
        | TaskAction::Answer { .. }
        | TaskAction::Confirm { .. }) => {
            locked(project, json, || decisions::run(project, action, json))
        }
        action @ (TaskAction::Scope { .. }
        | TaskAction::Statement { .. }
        | TaskAction::Withdraw { .. }
        | TaskAction::ReconcileWithdrawal { .. }
        | TaskAction::Check { .. }
        | TaskAction::Deliverable { .. }) => locked(project, json, || {
            scope::run(project, action, json, &swallowed)
        }),
        action @ TaskAction::Close { .. } => {
            locked(project, json, || closing::run(project, action, json))
        }
        action @ (TaskAction::Accept { .. }
        | TaskAction::Block { .. }
        | TaskAction::Ready { .. }) => {
            locked(project, json, || lifecycle::run(project, action, json))
        }
        action @ (TaskAction::Lens { .. }
        | TaskAction::ProposeModel { .. }
        | TaskAction::ApproveModel { .. }
        | TaskAction::Attribute { .. }) => {
            locked(project, json, || lenses::run(project, action, json))
        }
    }
}

pub(in crate::cli) fn challenge_locked(project: &Project, name: Option<&str>, json: bool) -> i32 {
    locked(project, json, || challenge(project, name, json))
}
