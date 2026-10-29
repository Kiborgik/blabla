use super::*;

#[derive(Serialize)]
struct Phase {
    phase: &'static str,
    seconds: Option<u64>,
}

#[derive(Serialize)]
struct Budget {
    task: String,
    state: &'static str,
    phases: Vec<Phase>,
}

fn span(from: Option<u64>, to: Option<u64>) -> Option<u64> {
    to?.checked_sub(from?)
}

fn run_seconds(summary: &serde_json::Value) -> Option<u64> {
    let unread = ["omitted", "unavailable"]
        .iter()
        .any(|count| summary[*count].as_u64() != Some(0));
    if unread {
        return None;
    }
    let entries = summary["entries"].as_array()?;
    if entries.is_empty() {
        return None;
    }
    entries.iter().try_fold(0u64, |total, entry| {
        let observed = &entry["last_observed"];
        let spent = span(
            observed["started_unix"].as_u64(),
            observed["observed_unix"].as_u64(),
        )?;
        Some(total + spent)
    })
}

fn budget_of(task: &Task, summary: &serde_json::Value) -> Budget {
    let handed_back = matches!(task.state, TaskState::Ready | TaskState::Closed)
        .then(|| task.challenged.as_ref().map(|receipt| receipt.unix))
        .flatten();
    let accepted = task.accepted.as_ref().map(|accepted| accepted.unix);
    let first_acceptance = accepted.filter(|_| task.acceptance_epoch <= 1);
    Budget {
        task: task.name.clone(),
        state: task.state.word(),
        phases: vec![
            Phase {
                phase: "open-to-accepted",
                seconds: span(Some(task.opened_unix), first_acceptance),
            },
            Phase {
                phase: "accepted-to-ready",
                seconds: span(accepted, handed_back),
            },
            Phase {
                phase: "ready-to-closed",
                seconds: span(handed_back, task.closed_unix),
            },
            Phase {
                phase: "check-runs",
                seconds: run_seconds(summary),
            },
        ],
    }
}

fn write_budget(budget: &Budget) -> io::Result<()> {
    let mut out = io::stdout().lock();
    writeln!(out, "task::{}   {}", budget.task, budget.state)?;
    for phase in &budget.phases {
        match phase.seconds {
            Some(seconds) => writeln!(out, "  {:<18} {seconds}s", phase.phase)?,
            None => writeln!(out, "  {:<18} unknown", phase.phase)?,
        }
    }
    Ok(())
}

pub(super) fn run(project: &Project, name: &str, json: bool) -> i32 {
    let task = exit_on_err!(load(project, name, json));
    let summary = progress::summary(&project.manifest.root, &task);
    render(json, &budget_of(&task, &summary), write_budget)
}

#[cfg(test)]
mod tests {
    use super::run_seconds;
    use serde_json::{Value, json};

    fn summary(omitted: u64, unavailable: u64) -> Value {
        json!({
            "entries": [{"last_observed": {"started_unix": 10, "observed_unix": 25}}],
            "omitted": omitted,
            "unavailable": unavailable
        })
    }

    #[test]
    fn check_runs_are_totalled_only_when_every_run_was_read() {
        assert_eq!(run_seconds(&summary(0, 0)), Some(15));
        assert_eq!(run_seconds(&summary(1, 0)), None);
        assert_eq!(run_seconds(&summary(0, 1)), None);
    }
}
