use super::*;

pub(super) fn run(project: &Project, action: TaskAction, json: bool, swallowed: &[String]) -> i32 {
    let TaskAction::Open {
        name,
        role,
        statement,
        scope,
        deliverable,
        check,
        input,
        goal,
        review_of,
        lens,
        falsify,
        intent,
    } = action
    else {
        unreachable!("only the open command is dispatched here");
    };
    open_with(
        project,
        Opening {
            name,
            role,
            statement,
            scope,
            deliverables: deliverable,
            check: (!check.is_empty()).then_some(check),
            inputs: input,
            goal,
            review_of,
            lenses: lens,
        },
        falsify,
        intent,
        json,
        swallowed,
    )
}

pub(super) fn open_with(
    project: &Project,
    mut opening: Opening,
    falsify: Vec<String>,
    intent: bool,
    json: bool,
    swallowed: &[String],
) -> i32 {
    if let Err(exit) = validate_open_role(project, &opening.role, json) {
        return exit;
    }
    let name = &opening.name;
    if !blabla::memory::syntax::is_identity_safe(name) {
        return emit_error(
            error(
                "task",
                format!(
                    "{name:?} cannot name a task; a name starts with a letter or digit and continues with letters, digits, '_' or '-'"
                ),
                None,
            ),
            json,
            2,
        );
    }
    if let Some(target) = &opening.review_of
        && let Err(message) = review_target(project, &opening.name, target)
    {
        return emit_error(error("task", message, None), json, 2);
    }
    if let Some(goal) = &opening.goal
        && let Some(message) = super::super::project::undeclared_goal(project, goal)
    {
        return emit_error(error("task", message, None), json, 2);
    }
    if let Some(message) = unconsulted_lens(project, &opening.role, &opening.lenses) {
        return emit_error(error("task", message, None), json, 2);
    }
    let root = &project.manifest.root;
    let existing = task::read(root, name).ok().flatten();
    if !task::replaceable(existing.as_ref())
        && let Some(existing) = existing
    {
        return emit_error(
            error(
                "task",
                format!(
                    "task {name:?} is already recorded in state {state:?}; opening it again would replace what it holds, and a closed record is history rather than a free name. Read it with blabla task show {name}, or choose a name nothing has used",
                    state = existing.state.word()
                ),
                None,
            ),
            json,
            2,
        );
    }
    opening.inputs = match tracked_declarations(project, "input", opening.inputs) {
        Ok(paths) => paths,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    opening.deliverables = match tracked_declarations(project, "deliverable", opening.deliverables)
    {
        Ok(paths) => paths,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    let validated = Opening {
        scope: match task::validate_scope(
            root,
            &opening.name,
            &opening.scope,
            &task::read_all(root),
        ) {
            Ok(scope) => scope,
            Err(message) => return emit_error(error("task", message, None), json, 2),
        },
        inputs: opening.inputs,
        deliverables: match owed_paths(project, opening.deliverables) {
            Ok(paths) => paths,
            Err(message) => return emit_error(error("task", message, None), json, 2),
        },
        ..opening
    };
    let mut recorded = task::record(root, &project.ignore, validated, now_unix());
    let falsify = match falsify_paths(project, &recorded, falsify) {
        Ok(paths) => paths,
        Err(message) => return emit_error(error("task", message, None), json, 2),
    };
    recorded.falsify = falsify;
    recorded.asks_intent = intent;
    if let Err(exit) = require_tracking(project, &recorded, json) {
        return exit;
    }
    if let Err(failure) =
        task::store::record_opened(&project.manifest.root, &recorded.name, &recorded.falsify)
    {
        return emit_error(
            error(
                "task",
                format!("cannot save the opened contents: {failure}"),
                None,
            ),
            json,
            2,
        );
    }
    let code = create(project, &mut recorded, json, swallowed);
    if code == 0 && !orchestrator_declared(project) {
        eprintln!(
            "task {:?} is opened, but process memory declares no role::orchestrator: task resolve, answer, confirm, withdraw, reconcile-withdrawal, unowe and attribute are refused until it does",
            recorded.name
        );
    }
    if code != 0 {
        let _ = task::store::discard_falsification(&project.manifest.root, &recorded.name);
    }
    code
}

pub(super) fn tracked_declarations(
    project: &Project,
    kind: &str,
    declared: Vec<String>,
) -> Result<Vec<String>, String> {
    declared
        .into_iter()
        .map(|path| {
            task::normalize_tracked_path(&project.manifest.root, &project.ignore, kind, &path)
        })
        .collect()
}

pub(super) fn require_tracking(project: &Project, task: &Task, json: bool) -> Result<(), i32> {
    match task::tracking_error(task, &project.manifest.root, &project.ignore) {
        Some(problem) => Err(emit_error(
            error("task", task::tracking_recovery(task, &problem), None),
            json,
            2,
        )),
        None => Ok(()),
    }
}

pub(super) fn normalize(path: String) -> String {
    path.replace('\\', "/")
}

pub(super) fn owed_paths(project: &Project, declared: Vec<String>) -> Result<Vec<String>, String> {
    let root = &project.manifest.root;
    let mut tree: Option<Vec<String>> = None;
    let mut owed = Vec::new();
    for path in declared.into_iter().map(normalize) {
        if !root.join(&path).is_dir() {
            owed.push(path);
            continue;
        }
        let files = tree.get_or_insert_with(|| {
            blabla::project::snapshot(root, &project.ignore)
                .into_keys()
                .collect::<Vec<String>>()
        });
        let under: Vec<String> = files
            .iter()
            .filter(|name| task::covers(&path, name))
            .map(|name| task::normalize_tracked_path(root, &project.ignore, "deliverable", name))
            .collect::<Result<_, _>>()?;
        if under.is_empty() {
            owed.push(path);
        } else {
            owed.extend(under);
        }
    }
    Ok(owed)
}
