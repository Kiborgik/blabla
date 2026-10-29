macro_rules! exit_on_err {
    ($result:expr) => {
        match $result {
            Ok(value) => value,
            Err(exit) => return exit,
        }
    };
}

macro_rules! refuse_on_err {
    ($result:expr, $json:expr) => {
        match $result {
            Ok(value) => value,
            Err(message) => return refuse(message, $json),
        }
    };
}

mod bounded;
mod budget;
mod challenging;
mod closing;
mod decisions;
mod dispatch;
pub(super) mod evidence_reuse;
mod falsification;
mod findings;
pub(super) mod freshness;
mod lenses;
mod lifecycle;
mod model_acceptance;
mod opening;
mod progress;
mod receipts;
mod recording;
mod rendering;
mod review;
mod roles;
mod routes;
mod scope;
mod showing;
mod storage;
mod view;

pub(super) use challenging::standing;
pub(super) use dispatch::{challenge_locked, execute};
pub(super) use routes::routes_text;

use challenging::*;
use decisions::*;
use falsification::*;
use lifecycle::*;
use opening::*;
use receipts::*;
use recording::*;
use rendering::*;
use review::*;
use roles::*;
use routes::*;
use showing::*;
use storage::*;
use view::*;

use super::{TaskAction, command_line, emit_error, error, recovery, swallowed_options, write_view};
use blabla::memory::goal::Outcome;
use blabla::memory::{self, goal, knowledge, mission, process, system};
use blabla::project::Project;
use blabla::project::status::{StatusView, now_unix, status_view};
use blabla::project::task::machine::{self, Command, Facts, Route, TaskState};
use blabla::project::task::{self, Finding, Opening, Task};
use blabla::skeptic::{self, ChallengeReport, Evidence};
use blabla::structure::default_providers;
use blabla::structure::falsify;
use blabla::voice::{Voice, contradiction};
use serde::Serialize;
use std::borrow::Borrow;
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Write};
use std::rc::Rc;

#[cfg(test)]
fn python() -> &'static str {
    if cfg!(windows) { "python" } else { "python3" }
}

pub(super) fn locked(project: &Project, json: bool, f: impl FnOnce() -> i32) -> i32 {
    match task::store::lock(&project.manifest.root) {
        Ok(_lock) => {
            let unreadable = task::unreadable(&project.manifest.root);
            if !unreadable.is_empty() {
                return emit_error(error("task", unreadable.join("; "), None), json, 2);
            }
            f()
        }
        Err(message) => emit_error(error("task", message, None), json, 2),
    }
}

fn load(project: &Project, name: &str, json: bool) -> Result<Task, i32> {
    match task::read(&project.manifest.root, name) {
        Ok(Some(task)) => Ok(task),
        Ok(None) => Err(emit_error(
            error(
                "task",
                format!(
                    "no bounded task {name:?} is recorded; blabla task show lists every recorded task and blabla task open records one"
                ),
                None,
            ),
            json,
            2,
        )),
        Err(message) => Err(emit_error(error("task", message, None), json, 2)),
    }
}

fn mutate(project: &Project, name: &str, json: bool) -> Result<Task, i32> {
    let task = load(project, name, json)?;
    if task.open() {
        return Ok(task);
    }
    Err(emit_error(
        error(
            "task",
            include_str!("../text/task-recovery.md").replace("{{name}}", name),
            None,
        ),
        json,
        2,
    ))
}

fn receipt_failed<T>(
    code: i32,
    json: bool,
    latest: Option<&T>,
    write: impl FnOnce(&T) -> io::Result<()>,
) -> bool {
    code == 0 && !json && latest.is_some_and(|receipt| write(receipt).is_err())
}

fn refuse(message: impl Into<String>, json: bool) -> i32 {
    emit_error(error("task", message, None), json, 2)
}

fn render<T: Serialize>(json: bool, view: &T, text: impl FnOnce(&T) -> io::Result<()>) -> i32 {
    if write_view(json, view, text).is_ok() {
        0
    } else {
        4
    }
}

fn read_entry<T>(
    entry: &blabla::project::MemoryEntry,
    build: fn(&[blabla::memory::syntax::Block]) -> Result<T, blabla::diagnostic::Diagnostic>,
    validate: fn(&T) -> Vec<String>,
) -> memory::Memory<T> {
    memory::read(&entry.path, &entry.display, build, validate)
}

fn fingerprint(value: &impl Serialize) -> String {
    let mut hash = blabla::project::Fnv::new();
    hash.write_str("task-memory-v1");
    hash.write_str(&serde_json::to_string(value).expect("memory serializes"));
    hash.finish()
}

fn knowledge_fingerprints(project: &Project) -> BTreeMap<String, String> {
    let entries: Vec<_> = project
        .manifest
        .knowledge
        .iter()
        .map(|entry| (entry.path.as_path(), entry.display.as_str()))
        .collect();
    let memory = memory::read_all(&entries, knowledge::build, knowledge::validate);
    let Some(memory) = memory.present() else {
        return BTreeMap::new();
    };
    memory
        .packs
        .iter()
        .map(|pack| {
            (
                pack.name.clone(),
                task::knowledge_fingerprint(memory, &pack.name)
                    .expect("resolved pack fingerprints"),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn probe_task(check: Option<&[&str]>) -> Task {
        task::record(
            std::path::Path::new("."),
            &blabla::project::ignore::Ignore::default(),
            Opening {
                name: "probe".to_owned(),
                role: "worker".to_owned(),
                statement: "probe".to_owned(),
                check: check.map(|argv| argv.iter().map(|arg| (*arg).to_owned()).collect()),
                ..Default::default()
            },
            0,
        )
    }

    #[test]
    fn every_declared_route_puts_a_line_in_the_assignment_view() {
        let mut task = probe_task(Some(&["cargo", "test", "--lib", "structure"]));
        task.falsify = vec![String::from("src/cli/task.rs")];
        for route in Route::ALL {
            for state in TaskState::ALL {
                task.state = state;
                assert_eq!(
                    !route_lines(route, &task).is_empty(),
                    route.offered_in(state),
                    "route {} in state {}",
                    route.word(),
                    state.word()
                );
            }
            assert!(
                !route_text(route, "probe", Some("cargo test"), None).is_empty(),
                "route {} writes nothing in the state-free loop text",
                route.word()
            );
        }
        task.state = TaskState::Closed;
        assert_eq!(offered_routes(&task), vec![Route::Check.word()]);
        assert_eq!(route_lines(Route::Check, &probe_task(None)).len(), 1);
    }

    #[test]
    fn the_declared_check_line_quotes_arguments_that_hold_whitespace() {
        let argv = ["python", "-c", "print(1); print(2)"];
        let task = probe_task(Some(&argv));
        let owned: Vec<String> = argv.iter().map(|word| (*word).to_owned()).collect();
        let lines = route_lines(Route::Check, &task).concat();
        assert!(lines.contains(&command_line(&owned)));
        assert_ne!(command_line(&owned), owned.join(" "));
    }

    #[test]
    fn reconciliations_group_their_paths_under_each_successor() {
        let grouped = group_by_successor(
            [
                ("beta", "src/b.rs"),
                ("alpha", "src/a.rs"),
                ("beta", "src/c.rs"),
                ("alpha", "src/d.rs"),
                ("gamma", "src/e.rs"),
            ]
            .into_iter(),
        );
        assert_eq!(
            grouped.into_iter().collect::<Vec<_>>(),
            vec![
                ("alpha", vec!["src/a.rs", "src/d.rs"]),
                ("beta", vec!["src/b.rs", "src/c.rs"]),
                ("gamma", vec!["src/e.rs"]),
            ]
        );
    }

    fn write(root: &std::path::Path, relative: &str, text: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, text).unwrap();
    }

    fn setup_project() -> (TempDir, blabla::project::Project) {
        let temp = TempDir::new().unwrap();
        let root = temp.path();

        write(
            root,
            "project.bla",
            "project Test\nuse behavior \"core.bla\"\n\nverify behavior {\n    command [\"true\"]\n    seed 1\n    cases 1\n    steps 1\n    timeout_ms 100\n    shrink_budget 1\n}\n",
        );
        write(
            root,
            "core.bla",
            "state x: int\n\naction inc()\n\nwhen inc {\n    expect \"change\": after.x > before.x\n}\n",
        );

        let project = blabla::project::load(
            blabla::project::read_manifest(&root.join("project.bla")).unwrap(),
        )
        .unwrap();
        (temp, project)
    }

    #[test]
    fn block_illegal_transition_refused() {
        let (_temp, project) = setup_project();
        let opening = task::Opening {
            name: "test-block".to_owned(),
            role: "worker".to_owned(),
            statement: "Test block transition".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/main.rs".to_owned()],
            ..Default::default()
        };
        let root = &project.manifest.root;
        let task = task::record(root, &project.ignore, opening, 0);
        task::write(root, &task).unwrap();

        let exit = block(&project, "test-block", "some reason", false);
        assert_ne!(exit, 0, "block from open should fail");

        let loaded = task::read(root, "test-block").unwrap().unwrap();
        assert_eq!(loaded.state, TaskState::Open, "state should remain open");
        assert!(loaded.findings.is_empty(), "findings should be empty");
    }

    #[test]
    fn ready_not_setting_result() {
        let (_temp, project) = setup_project();
        let opening = task::Opening {
            name: "test-ready".to_owned(),
            role: "worker".to_owned(),
            statement: "Test ready not setting result".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/main.rs".to_owned()],
            check: Some(vec!["check".to_owned()]),
            ..Default::default()
        };
        let root = &project.manifest.root;
        let mut task = task::record(root, &project.ignore, opening, 0);
        task.state = TaskState::Accepted;
        task.accepted = Some(task::Acceptance {
            model: "test-model".to_owned(),
            unix: 0,
            changed_at_acceptance: None,
        });
        task::write(root, &task).unwrap();

        write(root, "src/main.rs", "pub fn main() {}\n");
        assert_eq!(evidence(&project, "test-ready", 0, "test", false), 0);
        assert_eq!(challenge(&project, Some("test-ready"), false), 0);
        let exit = ready_with(&project, "test-ready", HandBack::default(), false);
        assert_eq!(exit, 0);

        let loaded = task::read(root, "test-ready").unwrap().unwrap();
        assert_eq!(loaded.state, TaskState::Ready);
        assert!(loaded.result.is_none());
    }
}
