use super::*;

pub(super) fn challenge(project: &Project, name: Option<&str>, json: bool) -> i32 {
    let root = &project.manifest.root;
    let mut selected = match name {
        Some(name) => Some(exit_on_err!(load(project, name, json))),
        None => None,
    };
    let evaluation = super::super::project::evaluate_with_run_state(project);
    let structure = project.verify_structure();
    let status = status_view(project, &evaluation, &structure);
    let goals = match selected {
        None => super::super::project::goal_outcomes(project, &evaluation, &status),
        Some(_) => Err(skeptic::GOALS_NOT_JUDGED),
    };
    let tree = blabla::project::snapshot(root, &project.ignore);
    let report = report_at(
        project,
        &status,
        selected.as_ref(),
        goals.as_deref().map_err(|reason| *reason),
        &tree,
    );
    let blockers = report.assignment_blockers();
    let mut assignment_clear = None;
    if let Some(task) = selected.as_mut() {
        if ready_assignment_clear(project, task, &tree, &blockers) {
            assignment_clear = Some(true);
        } else if task.state == TaskState::Accepted {
            let recorded = task::record_challenge(task, &tree, blockers.len(), now_unix());
            if let Err(exit) = persist(project, task, json, "challenge") {
                return exit;
            }
            assignment_clear = Some(recorded);
        } else if task.open() {
            assignment_clear = Some(ready_assignment_clear(project, task, &tree, &blockers));
        }
    }
    let assignment_recovery = selected
        .as_ref()
        .zip(assignment_clear)
        .map(|(task, clear)| handback_recovery(task, &tree, &report, clear));
    let mut shown = serde_json::to_value(&report).expect("challenge serializes");
    shown["assignment_clear"] = serde_json::json!(assignment_clear);
    shown["assignment_recovery"] = serde_json::json!(assignment_recovery);
    let rendered = render(json, &shown, |_| {
        let scoped = if let Some(clear) = assignment_clear {
            let detail = &assignment_recovery
                .as_ref()
                .expect("selected task recovery")
                .guidance;
            writeln!(
                io::stdout().lock(),
                "\nAssignment check: {} — {detail}",
                if clear { "CLEAR" } else { "BLOCKED" }
            )
        } else {
            Ok(())
        };
        scoped.and_then(|()| write_challenge(&report, project.manifest.voice))
    });
    if rendered != 0 {
        return 4;
    }
    assignment_clear.map_or_else(|| report.exit_code(), |clear| if clear { 0 } else { 1 })
}

pub(super) fn report_at(
    project: &Project,
    status: &StatusView,
    selected: Option<&Task>,
    goals: Result<&[Outcome], &'static str>,
    tree: &BTreeMap<String, String>,
) -> ChallengeReport {
    let root = &project.manifest.root;
    let resolution = selected.map(|task| resolved(project, task));
    let other_tasks = task::read_all(root);
    let evidence = Evidence {
        task: selected,
        tree,
        completion: status.completion.state,
        completion_reason: &status.completion.reason,
        falsify: &|| {
            falsify::falsify(
                &project.structure,
                root,
                &default_providers(),
                &project.ignore,
            )
        },
        role: resolution.as_ref(),
        other_tasks: &other_tasks,
    };
    skeptic::challenge_tracked_against(&evidence, goals, root, &project.ignore)
}

pub(super) fn assignment_report_at(
    project: &Project,
    task: &Task,
    tree: &BTreeMap<String, String>,
) -> ChallengeReport {
    let evaluation = super::super::project::evaluate_with_run_state(project);
    let structure = project.verify_structure();
    let status = status_view(project, &evaluation, &structure);
    report_at(
        project,
        &status,
        Some(task),
        Err(skeptic::GOALS_NOT_JUDGED),
        tree,
    )
}

pub(in crate::cli) fn standing(project: &Project, status: &StatusView) -> ChallengeReport {
    let mut open: Vec<Task> = task::read_all(&project.manifest.root)
        .into_iter()
        .filter(Task::open)
        .collect();
    let selected = if open.len() == 1 { open.pop() } else { None };
    let tree = blabla::project::snapshot(&project.manifest.root, &project.ignore);
    report_at(
        project,
        status,
        selected.as_ref(),
        Err(skeptic::GOALS_NOT_JUDGED),
        &tree,
    )
}

pub(in crate::cli) fn write_challenge(report: &ChallengeReport, voice: Voice) -> io::Result<()> {
    let mut output = io::stdout().lock();
    write_challenge_into(&mut output, report, voice)
}

pub(in crate::cli) fn write_challenge_into(
    output: &mut impl Write,
    report: &ChallengeReport,
    voice: Voice,
) -> io::Result<()> {
    match &report.task {
        Some(name) => writeln!(output, "CHALLENGE  bounded task {name}")?,
        None => writeln!(
            output,
            "CHALLENGE  the project; blabla challenge <task> holds one assignment"
        )?,
    }
    match &report.challenge {
        Some(challenge) => {
            writeln!(
                output,
                "\n{}\n",
                contradiction(voice, challenge.class.word(), &challenge.statement)
            )?;
            writeln!(output, "Evidence:")?;
            for line in &challenge.evidence {
                writeln!(output, "  {line}")?;
            }
            writeln!(output, "\nReconcile:\n  {}", challenge.reconcile)?;
            writeln!(output, "\nClass: {}", challenge.class.word())?;
            let waiting: Vec<&str> = report
                .assignment_blockers
                .iter()
                .chain(report.project_challenges.iter())
                .copied()
                .filter(|class| *class != challenge.class.word())
                .collect();
            if !waiting.is_empty() {
                writeln!(
                    output,
                    "Also standing, one challenge at a time: {}",
                    waiting.join(", ")
                )?;
            }
        }
        None => {
            writeln!(
                output,
                "\nNothing here can be challenged from the evidence BlaBla holds."
            )?;
        }
    }
    if !report.ungrounded.is_empty() {
        writeln!(output, "\nNot grounded:")?;
        for (class, reason) in &report.ungrounded {
            writeln!(output, "  {class}: {reason}")?;
        }
    }
    writeln!(output, "\n{}", report.authority)?;
    for limit in skeptic::LIMITS {
        writeln!(output, "{limit}")?;
    }
    Ok(())
}
