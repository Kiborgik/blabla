use super::*;

pub(super) fn write_task(
    task: &Task,
    root: &std::path::Path,
    floor: Option<u8>,
    view: &TaskView<'_>,
) -> io::Result<()> {
    let mut output = io::stdout().lock();
    let shown = |path: &String| {
        view.on_disk
            .get(path)
            .map_or_else(|| path.clone(), Clone::clone)
    };
    let listed = |paths: &[String]| paths.iter().map(&shown).collect::<Vec<String>>();
    writeln!(output, "task::{}   {}", task.name, state_label(task))?;
    write_result_basis(&mut output, task)?;
    if let Some(summary) = &view.evidence_progress {
        progress::write_summary(&mut output, summary)?;
    }
    writeln!(output, "\nStatement:\n  {}", task.statement)?;
    writeln!(output, "\nCarried by:\n  role::{}", task.role)?;
    if let Some(goal) = &task.goal {
        writeln!(output, "\nServes goal::{goal}")?;
    }
    writeln!(
        output,
        "\nWrite scope:\n  {}",
        join_or(&listed(&task.scope), "none declared")
    )?;
    let deliverables: Vec<String> = task
        .deliverables
        .iter()
        .map(|deliverable| shown(&deliverable.path))
        .collect();
    writeln!(
        output,
        "\nDeliverables:\n  {}",
        join_or(&deliverables, "none declared")
    )?;
    let inputs = if task.check_inputs.is_empty() {
        format!("write scope: {}", listed(&task.scope).join("  "))
    } else {
        listed(&task.check_inputs).join("  ")
    };
    writeln!(output, "\nCheck inputs (plus deliverables):\n  {inputs}")?;
    writeln!(
        output,
        "\nFalsify paths:\n  {}",
        join_or(&listed(&task.falsify), "none declared")
    )?;
    if let Some(latest) = task.falsifications.last() {
        write_falsification_receipt(&mut output, latest)?;
    }
    write_changed(
        &mut output,
        "Changed since open:",
        &view.changed_since_open,
        view.changed_elsewhere,
    )?;
    if !view.attributions.is_empty() {
        writeln!(output, "\nOwner of each changed path:")?;
        for attribution in &view.attributions {
            writeln!(output, "  {}   {}", attribution.path, attribution.owner)?;
        }
    }
    if task.review_of.is_some() {
        if view.reviewed_target_readable == Some(false) {
            writeln!(output, "\nReviewed target: unreadable or missing")?;
        } else {
            write_changed(
                &mut output,
                "Reviewed target changed since open:",
                &view.reviewed_changed_since_open,
                view.reviewed_changed_elsewhere,
            )?;
        }
    }
    if task.findings.is_empty() {
        writeln!(output, "\nFindings:\n  none recorded")?;
    } else {
        writeln!(output, "\nFindings:")?;
        for finding in &task.findings {
            writeln!(output, "  {} {}", finding.id, finding.statement)?;
            if let Some(addressed) = &finding.addressed {
                writeln!(
                    output,
                    "    addressed by {}: {}",
                    addressed.model, addressed.statement
                )?;
            }
            match &finding.resolution {
                Some(resolution) => {
                    writeln!(output, "    resolved: {}", resolution.evidence)?;
                    if let Some(model) = &resolution.model {
                        writeln!(output, "    by {model}")?;
                    }
                }
                None if finding.addressed.is_some() => {
                    writeln!(output, "    awaiting the orchestrator's resolution")?
                }
                None => writeln!(output, "    UNRESOLVED")?,
            }
        }
    }
    if view.review_accepted == Some(false) {
        let target = task.review_of.as_ref().expect("review target");
        writeln!(
            output,
            "\nReview of task::{}: NOT ACCEPTED YET; current approval: NO",
            target.task
        )?;
    } else if let Some(current) = view.review_current {
        let target = task.review_of.as_ref().expect("review target");
        writeln!(
            output,
            "\nReview of task::{}: {}; current approval: {}",
            target.task,
            if current { "CURRENT" } else { "STALE" },
            if view.approval_current == Some(true) {
                "YES"
            } else {
                "NO"
            }
        )?;
        if !current {
            writeln!(
                output,
                "  Reaccept an open review to inspect the changed target; a CLOSED review remains historical and new work needs a new review task"
            )?;
        }
    }
    write_questions(&mut output, task)?;
    write_decisions(&mut output, task, floor)?;
    write_orchestrator_records(&mut output, task)?;
    if !task.notes.is_empty() {
        writeln!(output, "\nNotes:")?;
        for note in &task.notes {
            writeln!(output, "  {}", note.statement)?;
        }
    }
    if !task.removed_deliverables.is_empty() {
        writeln!(output, "\nRemoved deliverables:")?;
        for removed in &task.removed_deliverables {
            writeln!(output, "  {} — {}", removed.path, removed.reason)?;
        }
    }
    if let Some(withdrawal) = &task.withdrawal {
        writeln!(
            output,
            "\nWITHDRAWN by {}: {}",
            withdrawal.model, withdrawal.reason
        )?;
        for (path, digest) in &withdrawal.unresolved_paths {
            writeln!(
                output,
                "  captured residue {path}: {}",
                digest.as_deref().unwrap_or("absent")
            )?;
        }
        let grouped = group_by_successor(
            withdrawal
                .reconciliations
                .iter()
                .map(|record| (record.successor.as_str(), record.path.as_str())),
        );
        for (successor, paths) in grouped {
            writeln!(
                output,
                "  reconciled against {successor}: {}",
                paths.join(", ")
            )?;
        }
        writeln!(
            output,
            "  Withdrawal releases ownership and grants no completion credit; restore captured paths or reconcile them against a current CLOSED successor"
        )?;
    }
    write_evidence(&mut output, root, task)?;
    write_routes(&mut output, task)
}

pub(super) fn group_by_successor<'a>(
    reconciliations: impl Iterator<Item = (&'a str, &'a str)>,
) -> BTreeMap<&'a str, Vec<&'a str>> {
    let mut grouped: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (successor, path) in reconciliations {
        grouped.entry(successor).or_default().push(path);
    }
    grouped
}

fn write_questions(output: &mut impl Write, task: &Task) -> io::Result<()> {
    if task.questions.is_empty() {
        return writeln!(output, "\nQuestions from the orchestrator:\n  none asked");
    }
    writeln!(
        output,
        "\nQuestions from the orchestrator (task ready is refused while one has no pick):"
    )?;
    let (unpicked, picked): (Vec<&task::AskedQuestion>, Vec<&task::AskedQuestion>) = task
        .questions
        .iter()
        .partition(|asked| task::picked_by(task, &asked.id).is_none());
    for asked in unpicked.into_iter().chain(picked) {
        writeln!(output, "  {} {}", asked.id, asked.question)?;
        writeln!(
            output,
            "    {}: {}   floor {}%   asked by {}",
            asked.kind,
            asked.options.join(", "),
            asked.floor,
            asked.model
        )?;
        match task::picked_by(task, &asked.id) {
            Some(decision) => writeln!(
                output,
                "    picked {} at {}% in decision {}",
                decision.pick, decision.confidence, decision.id
            )?,
            None => writeln!(output, "    NO PICK: {}", pick_command(task, asked))?,
        }
    }
    Ok(())
}

fn write_decisions(output: &mut impl Write, task: &Task, floor: Option<u8>) -> io::Result<()> {
    let floor = match floor {
        Some(0) => format!(
            "role::{} sets a 0% decision floor, so no decision blocks the task",
            task.role
        ),
        Some(floor) => format!(
            "role::{} blocks the task on a decision below {floor}% confidence",
            task.role
        ),
        None => format!("role::{} is not declared, so no floor is read", task.role),
    };
    if task.decisions.is_empty() {
        return writeln!(output, "\nDecisions ({floor}):\n  none recorded");
    }
    writeln!(output, "\nDecisions ({floor}):")?;
    for decision in &task.decisions {
        match &decision.on {
            Some(asked) => writeln!(
                output,
                "  {} {}   on question {asked}",
                decision.id, decision.question
            )?,
            None => writeln!(output, "  {} {}", decision.id, decision.question)?,
        }
        writeln!(
            output,
            "    {}: {}   picked {} at {}% by {}   {}",
            decision.kind,
            decision.options.join(", "),
            decision.pick,
            decision.confidence,
            decision.model,
            match decision.current_status() {
                "blocked" => format!("BLOCKS THE TASK, below {}%", decision.floor),
                "answered" => "ANSWERED".to_owned(),
                "overruled" => "OVERRULED".to_owned(),
                _ => "STANDS".to_owned(),
            }
        )?;
        match &decision.answer {
            Some(answer) => writeln!(
                output,
                "    answered {} by {}{}: {}",
                answer.pick,
                answer.model,
                if answer.pick == decision.pick {
                    ", holding the pick".to_owned()
                } else {
                    format!(", overruling {}", decision.pick)
                },
                answer.reason
            )?,
            None if decision.below_floor => writeln!(
                output,
                "    no answer yet: stop, do not act on {}. {}",
                decision.pick,
                answer_route(task, decision)
            )?,
            None => {}
        }
    }
    Ok(())
}

fn write_orchestrator_records(output: &mut impl Write, task: &Task) -> io::Result<()> {
    let mut carriers: Vec<&str> = Vec::new();
    for carrier in task
        .recorded_during_carry()
        .filter_map(|record| record.carried_by.as_deref())
    {
        if !carriers.contains(&carrier) {
            carriers.push(carrier);
        }
    }
    for carrier in carriers {
        writeln!(
            output,
            "\nRecorded under an orchestrator model while {carrier} carried the task:"
        )?;
        for record in task
            .recorded_during_carry()
            .filter(|record| record.carried_by.as_deref() == Some(carrier))
        {
            writeln!(
                output,
                "  {}   {}   {}",
                record.verb,
                record.model.as_deref().map_or_else(
                    || "no --model given".to_owned(),
                    |model| format!("--model {model}")
                ),
                match &record.confirmed {
                    Some(confirmation) => format!("confirmed by {}", confirmation.model),
                    None => "UNCONFIRMED".to_owned(),
                }
            )?;
        }
    }
    if task.unconfirmed_during_carry().next().is_some() {
        writeln!(
            output,
            "  --model is an attestation, not proof. After hand-back the orchestrator reviews each record and confirms it with blabla task confirm {} --model <id>, or undoes it; task close is refused until every record here is confirmed",
            task.name
        )?;
    }
    Ok(())
}

pub(super) fn write_tasks(tasks: &[Task]) -> io::Result<()> {
    let mut output = io::stdout().lock();
    if tasks.is_empty() {
        writeln!(output, "No bounded task is recorded.")?;
        return writeln!(
            output,
            "  blabla task open <name> --role <role> --statement \"...\" --scope <path> --deliverable <path>"
        );
    }
    writeln!(output, "Bounded tasks:")?;
    for task in tasks {
        writeln!(
            output,
            "  task::{}   {}   role::{}   {} unresolved",
            task.name,
            state_label(task),
            task.role,
            task.unresolved().count()
        )?;
    }
    writeln!(output, "\n  blabla task show <name>   one task in full")?;
    writeln!(output, "\n{}", task::AUTHORITY)
}

pub(super) fn state_label(task: &Task) -> String {
    task.state.label()
}
