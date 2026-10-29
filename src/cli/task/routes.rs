use super::*;

fn check_lines(name: &str, check: Option<&str>) -> Vec<String> {
    match check {
        Some(line) => vec![
            format!("\nDeclared check:\n  {line}"),
            format!(
                "  blabla task evidence {name} --run   BlaBla runs exactly that program and records the exit code it observed"
            ),
        ],
        None => vec![include_str!("../text/route-check-none-declared.md").to_owned()],
    }
}

fn render_route(
    route: Route,
    name: &str,
    check: Option<&str>,
    state: Option<TaskState>,
) -> Vec<String> {
    match route {
        Route::Accept => vec![format!(
            "\n  blabla task accept {name} --model <id>   {}",
            match state {
                Some(TaskState::Blocked | TaskState::Ready) => {
                    "take the assignment again before changing anything; a BLOCKED or READY task resumes by being accepted"
                }
                Some(TaskState::Accepted) => {
                    "already accepted; accepting again starts a new acceptance epoch, so the challenge and every lens assessment are owed again"
                }
                _ => {
                    "take the assignment before changing anything; unaccepted work is challenged as work done outside BlaBla"
                }
            }
        )],
        Route::Check
            if matches!(
                state,
                Some(TaskState::Ready | TaskState::Closed | TaskState::Withdrawn)
            ) =>
        {
            let declared = check_lines(name, check);
            vec![declared[0].clone()]
        }
        Route::Check => check_lines(name, check),
        Route::Blocker => vec![format!(
            "  blabla task block {name} \"...\"   record the blocker and stop"
        )],
        Route::Note => vec![format!(
            "  blabla task note {name} \"...\"   keep a note on the record; a note is not a finding and blocks nothing"
        )],
        Route::Finding => vec![format!(
            "  blabla task finding {name} \"...\"   record unsettled work; it blocks hand-back until it is addressed or resolved"
        )],
        Route::Addressed => vec![format!(
            "  blabla task addressed {name} <id> \"...\" --model <id>   say what you did about a finding; the orchestrator still resolves it"
        )],
        Route::Decide => vec![format!(
            "  blabla task decide {name} \"<question>\" --pick <option> --confidence <0-100> --model <id>   a call you are not sure of (a cause, a name, a behavior the statement leaves open) is asked, not guessed; --options a,b,c for a choice; --on <question-id> in place of the question picks one the orchestrator asked. BLOCKS THE TASK means stop now and do not act on your pick until the orchestrator answers"
        )],
        Route::Lens => vec![format!(
            "  blabla task lens {name} <pack> \"...\"   one assessment against one lens the role consults"
        )],
        Route::Challenge => vec![if state == Some(TaskState::Ready) {
            format!(
                "  READY: hand-back recorded; blabla challenge {name} checks current clearance and recovery before orchestrator review; closing task {name} is orchestrator-owned"
            )
        } else {
            format!(
                "  blabla challenge {name}   ask BlaBla for one contradiction grounded in the record and tree; no challenge is recorded until the command runs"
            )
        }],
        Route::Falsify => vec![format!(
            "  blabla task falsify {name}   runs the declared check in a copy of the tree on the current files, then on the falsify paths as they were at open; hand-back waits until it passed, then failed"
        )],
        Route::HandBack => vec![format!(
            "  blabla task ready {name}   hand back for review; closing it is the orchestrator's, never yours"
        )],
    }
}

pub(in crate::cli) fn route_text(
    route: Route,
    name: &str,
    check: Option<&str>,
    state: Option<TaskState>,
) -> Vec<String> {
    match state {
        Some(state) if !route.offered_in(state) => Vec::new(),
        _ => render_route(route, name, check, state),
    }
}

pub(in crate::cli) fn routes_text(name: &str, check: &str) -> String {
    Route::ALL
        .into_iter()
        .filter(|route| route.offered_in(TaskState::Open) || route.offered_in(TaskState::Accepted))
        .flat_map(|route| route_text(route, name, Some(check), None))
        .map(|line| format!("{line}\n"))
        .collect()
}

pub(super) fn route_lines(route: Route, task: &Task) -> Vec<String> {
    if route == Route::Falsify && task.falsify.is_empty() {
        return Vec::new();
    }
    let check = task.check.as_deref().map(command_line);
    route_text(route, &task.name, check.as_deref(), Some(task.state))
}

pub(super) fn offered_routes(task: &Task) -> Vec<&'static str> {
    Route::ALL
        .into_iter()
        .filter(|route| !route_lines(*route, task).is_empty())
        .map(Route::word)
        .collect()
}

pub(super) fn write_routes(output: &mut impl Write, task: &Task) -> io::Result<()> {
    writeln!(
        output,
        "\nScratch:\n  .blabla/{}/{}   working space; not a deliverable and outside the tree snapshot",
        task::SCRATCH_DIRECTORY,
        task.name
    )?;
    for route in Route::ALL {
        for line in route_lines(route, task) {
            writeln!(output, "{line}")?;
        }
        if route == Route::Accept {
            for line in pick_lines(task) {
                writeln!(output, "{line}")?;
            }
        }
    }
    Ok(())
}

fn pick_lines(task: &Task) -> Vec<String> {
    if !matches!(
        task.state,
        TaskState::Open | TaskState::Accepted | TaskState::Ready
    ) {
        return Vec::new();
    }
    task.unpicked()
        .map(|asked| {
            format!(
                "\n  {}   the orchestrator asked {} ({}); pick it before anything else, since task ready is refused until every question has a pick",
                pick_command(task, asked),
                asked.id,
                asked.question
            )
        })
        .collect()
}
