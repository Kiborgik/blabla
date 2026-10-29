use super::*;

pub(super) fn run(project: &Project, action: TaskAction, json: bool) -> i32 {
    match action {
        TaskAction::Ask {
            name,
            question,
            options,
            floor,
            model,
        } => ask(
            project,
            &name,
            task::Ask {
                question,
                options,
                floor,
                model,
            },
            json,
        ),
        TaskAction::Decide {
            name,
            question,
            on,
            pick,
            confidence,
            model,
            options,
        } => decide(
            project,
            &name,
            Asked {
                question,
                on,
                pick,
                confidence,
                model,
                options,
            },
            json,
        ),
        TaskAction::Answer {
            name,
            id,
            pick,
            reason,
            model,
        } => answer(
            project,
            &name,
            id,
            task::Answer {
                pick,
                model,
                reason,
            },
            json,
        ),
        TaskAction::Confirm { name, model } => confirm(project, &name, &model, json),
        _ => unreachable!("only decision commands are dispatched here"),
    }
}

pub(super) struct Asked {
    pub(super) question: Option<String>,
    pub(super) on: Option<String>,
    pub(super) pick: String,
    pub(super) confidence: i64,
    pub(super) model: String,
    pub(super) options: Vec<String>,
}

#[derive(Serialize)]
struct DecisionView<'a> {
    task: &'a str,
    decision: &'a task::Decision,
    stands: bool,
    next: String,
}

pub(super) fn decide(project: &Project, name: &str, asked: Asked, json: bool) -> i32 {
    let mut task = exit_on_err!(mutate(project, name, json));
    if let Some(blocking) = task::unanswered_decision(&task) {
        return refuse(
            format!(
                "task {name:?} is BLOCKED on decision {}: {} (picked {} at {}%). A blocked task takes no decision; stop, nothing is recorded. {}",
                blocking.id,
                blocking.question,
                blocking.pick,
                blocking.confidence,
                answer_route(&task, blocking)
            ),
            json,
        );
    }
    if task.state != TaskState::Accepted {
        return refuse(
            format!(
                "task {name:?} is {}; a decision is recorded once the task is ACCEPTED. {}",
                state_label(&task),
                handback_guidance(&task, "accept")
            ),
            json,
        );
    }
    exit_on_err!(require_addressing_model(project, &task, &asked.model, json));
    let role = exit_on_err!(require_declared_role(project, &task.role, json));
    let options = split_options(&asked.options);
    let recorded = match (asked.on, asked.question) {
        (Some(on), None) if options.is_empty() => task::pick(
            &mut task,
            task::Pick {
                on,
                pick: asked.pick,
                confidence: asked.confidence,
                model: asked.model,
            },
            role.floor(),
        ),
        (Some(on), _) => Err(format!(
            "task decide --on {on} takes the question text and options from question {on}, so passing them as well is refused"
        )),
        (None, Some(question)) => task::decide(
            &mut task,
            task::Question {
                question,
                options,
                pick: asked.pick,
                confidence: asked.confidence,
                model: asked.model,
            },
            role.floor(),
        ),
        (None, None) => Err(format!(
            "state the call you are unsure of as a question, or pick one the orchestrator asked with --on <question-id>; blabla task show {name} lists them"
        )),
    };
    let decision = refuse_on_err!(
        recorded
            .cloned()
            .map_err(|refusal| format!("{refusal}; nothing is recorded")),
        json
    );
    exit_on_err!(persist(project, &mut task, json, "decision"));
    let next = decision_route(&task, &decision);
    let shown = DecisionView {
        task: &task.name,
        decision: &decision,
        stands: !decision.below_floor,
        next,
    };
    render(json, &shown, |shown| {
        let mut output = io::stdout().lock();
        writeln!(
            output,
            "task::{}   {}   decision {} {}",
            task.name,
            state_label(&task),
            decision.id,
            if decision.below_floor {
                "BLOCKS THE TASK"
            } else {
                "STANDS"
            }
        )
        .and_then(|()| writeln!(output, "  {}", shown.next))
    })
}

fn split_options(given: &[String]) -> Vec<String> {
    given
        .iter()
        .flat_map(|entry| entry.split(','))
        .map(|option| option.trim().to_owned())
        .collect()
}

fn decision_route(task: &Task, decision: &task::Decision) -> String {
    let pick = &decision.pick;
    let confidence = decision.confidence;
    let owner = task::floor_owner(task, decision);
    let floor = decision.floor;
    if decision.below_floor {
        return format!(
            "Stop now. Do not act on {pick}: {confidence}% is below {owner}'s floor of {floor}%, so the call is the orchestrator's and the task is BLOCKED on it. {}.",
            answer_route(task, decision)
        );
    }
    format!(
        "{pick} at {confidence}% is at or above {owner}'s floor of {floor}%, so the call stands. Act on {pick}. The orchestrator may still review it with blabla task answer {} {}.",
        task.name, decision.id
    )
}

pub(super) fn pick_command(task: &Task, asked: &task::AskedQuestion) -> String {
    format!(
        "blabla task decide {} --on {} --pick <{}> --confidence <0-100> --model <id>",
        task.name,
        asked.id,
        asked.options.join("|")
    )
}

#[derive(Serialize)]
struct QuestionView<'a> {
    task: &'a str,
    question: &'a task::AskedQuestion,
    next: String,
}

pub(super) fn ask(project: &Project, name: &str, asked: task::Ask, json: bool) -> i32 {
    exit_on_err!(require_declared_role(
        project,
        task::ORCHESTRATOR_ROLE,
        json
    ));
    let mut task = exit_on_err!(mutate(project, name, json));
    let role = exit_on_err!(require_declared_role(project, &task.role, json));
    let permitted = declared_permitted_models(project, task::ORCHESTRATOR_ROLE);
    let model = asked.model.clone();
    let asked = task::Ask {
        options: split_options(&asked.options),
        ..asked
    };
    let question = refuse_on_err!(
        task::ask(&mut task, asked, role.floor(), &permitted)
            .cloned()
            .map_err(|refusal| format!("{refusal}; nothing is recorded")),
        json
    );
    task::attest(&mut task, "ask", Some(&model), now_unix());
    exit_on_err!(persist(project, &mut task, json, "question"));
    let next = format!(
        "The carrying role picks it with {}; a pick below {}% blocks the task until the orchestrator answers, and task ready is refused until it has a pick.",
        pick_command(&task, &question),
        question.floor
    );
    let shown = QuestionView {
        task: &task.name,
        question: &question,
        next,
    };
    render(json, &shown, |shown| {
        let mut output = io::stdout().lock();
        writeln!(
            output,
            "task::{}   {}   question {} asked, floor {}%",
            task.name,
            state_label(&task),
            question.id,
            question.floor
        )
        .and_then(|()| writeln!(output, "  {}", shown.next))
    })
}

pub(super) fn answer_route(task: &Task, decision: &task::Decision) -> String {
    format!(
        "The orchestrator answers with blabla task answer {name} {id} --pick <{options}> --reason \"...\" --model <id>; after that, resume with blabla task accept {name} --model <id>",
        name = task.name,
        id = decision.id,
        options = decision.options.join("|"),
    )
}

pub(super) fn answer(
    project: &Project,
    name: &str,
    id: usize,
    given: task::Answer,
    json: bool,
) -> i32 {
    exit_on_err!(validate_orchestrator_model(project, &given.model, json));
    let mut task = exit_on_err!(mutate(project, name, json));
    let model = given.model.clone();
    refuse_on_err!(
        task::answer(&mut task, id, given)
            .map_err(|refusal| format!("{refusal}; nothing is recorded")),
        json
    );
    task::attest(&mut task, "answer", Some(&model), now_unix());
    store(project, &mut task, json)
}

pub(super) fn confirm(project: &Project, name: &str, model: &str, json: bool) -> i32 {
    exit_on_err!(validate_orchestrator_model(project, model, json));
    let mut task = exit_on_err!(mutate(project, name, json));
    let confirmed = refuse_on_err!(
        task::confirm(&mut task, model, now_unix())
            .map_err(|refusal| format!("{refusal}; nothing is recorded")),
        json
    );
    if confirmed == 0 {
        return refuse(
            format!(
                "task {name:?} holds no unconfirmed record made under an orchestrator model while a worker carried it, so there is nothing to confirm; nothing is recorded"
            ),
            json,
        );
    }
    store(project, &mut task, json)
}
