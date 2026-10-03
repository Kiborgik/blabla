use blabla::application::{AppConfig, Application};
use blabla::report::{Call, RunOptions, RunStatus};
use blabla::runtime::AppSession;
use blabla::semantics::compile;
use blabla::verify::run;
use serde_json::json;
use std::path::Path;
use std::time::Duration;

fn config() -> AppConfig {
    AppConfig {
        executable: "python".into(),
        args: vec![
            Path::new("examples/leases/app.py")
                .canonicalize()
                .unwrap()
                .into_os_string(),
        ],
        timeout: Duration::from_secs(1),
        startup: Duration::from_secs(1),
    }
}

#[test]
fn preserves_all_three_recorded_semantic_regressions_and_persists_them() {
    let contract = compile("leases.bla", include_str!("../examples/leases.bla")).unwrap();
    let mut app = AppSession::spawn(&config()).unwrap();
    for (calls, expected) in [
        (
            vec![
                ("claim", vec![json!("é"), json!("n"), json!(6)]),
                ("tick", vec![json!(6)]),
            ],
            json!([]),
        ),
        (
            vec![
                ("claim", vec![json!("cak"), json!(" "), json!(1)]),
                ("release", vec![json!("cak"), json!("")]),
            ],
            json!([{"resource":"cak","holder":" ","ticks":1}]),
        ),
        (
            vec![
                ("claim", vec![json!("é"), json!("d"), json!(1)]),
                ("renew", vec![json!("é"), json!("d"), json!(1)]),
            ],
            json!([{"resource":"é","holder":"d","ticks":1}]),
        ),
    ] {
        app.reset().unwrap();
        for (action, args) in calls {
            app.call(&Call {
                action: action.into(),
                args,
            })
            .unwrap();
        }
        assert_eq!(app.observe(&contract.state).unwrap()["leases"], expected);
        app.restart().unwrap();
        assert_eq!(app.observe(&contract.state).unwrap()["leases"], expected);
    }
    app.finish().unwrap();
}

#[test]
fn lease_campaign_checks_generated_action_combinations() {
    let contract = compile("leases.bla", include_str!("../examples/leases.bla")).unwrap();
    let options = RunOptions {
        seed: 1234,
        cases: 1,
        steps: 64,
        shrink_budget: 64,
    };
    let report = run(&contract, &options, || AppSession::spawn(&config())).unwrap();
    assert_eq!(
        report.status,
        RunStatus::Green,
        "{:?}",
        report
            .coverage_summary
            .coverage
            .iter()
            .filter(|p| p.witnesses == 0)
            .map(|p| (&p.id, &p.required_witness))
            .collect::<Vec<_>>()
    );
    for name in ["claim", "renew", "release", "tick", "restart"] {
        assert!(report.sequences[0].iter().any(|call| call.action == name));
    }
}

#[path = "support/cli.rs"]
mod support;

fn ownership_project() -> tempfile::TempDir {
    let temp = tempfile::TempDir::new().unwrap();
    std::fs::write(temp.path().join("project.bla"), "project Ownership\n").unwrap();
    temp
}

fn ownership_cli(temp: &tempfile::TempDir, values: &[&str]) -> i32 {
    support::run_in(Some(temp.path()), &support::args(values))
        .status
        .code()
        .unwrap()
}

fn ownership_open(temp: &tempfile::TempDir, name: &str, scope: &str) -> i32 {
    ownership_cli(
        temp,
        &[
            "task",
            "open",
            name,
            "--role",
            "worker",
            "--statement",
            "bounded work",
            "--scope",
            scope,
        ],
    )
}

#[test]
fn overlap_refused_on_open_and_widen() {
    let temp = ownership_project();
    assert_eq!(ownership_open(&temp, "first", "src"), 0);
    assert_eq!(ownership_open(&temp, "second", "src/a.rs"), 2);
    assert!(
        blabla::project::task::read(temp.path(), "second")
            .unwrap()
            .is_none()
    );
    assert_eq!(ownership_open(&temp, "second", "tests"), 0);
    assert_eq!(
        ownership_cli(
            &temp,
            &["task", "scope", "second", "--add", "docs", "src/a.rs"]
        ),
        2
    );
    assert_eq!(
        blabla::project::task::read(temp.path(), "second")
            .unwrap()
            .unwrap()
            .scope,
        vec!["tests"]
    );
    let mut first = blabla::project::task::read(temp.path(), "first")
        .unwrap()
        .unwrap();
    first.state = "ready".to_owned();
    blabla::project::task::write(temp.path(), &first).unwrap();
    assert_eq!(ownership_open(&temp, "third", "src/b.rs"), 2);
    assert_eq!(ownership_open(&temp, "prefix", "src-other"), 0);
}

#[test]
fn normalized_directory_file_overlap_refused() {
    let temp = ownership_project();
    assert_eq!(ownership_open(&temp, "first", "./src//nested/./"), 0);
    assert_eq!(
        blabla::project::task::read(temp.path(), "first")
            .unwrap()
            .unwrap()
            .scope,
        vec!["src/nested"]
    );
    assert_eq!(ownership_open(&temp, "second", "src\\nested\\a.rs"), 2);
    for (name, path) in [
        ("parent", "../escape"),
        ("absolute", "/tmp/escape"),
        ("drive", "C:\\escape"),
        ("empty", "."),
    ] {
        assert_eq!(ownership_open(&temp, name, path), 2, "{path}");
        assert!(
            blabla::project::task::read(temp.path(), name)
                .unwrap()
                .is_none()
        );
    }
    #[cfg(windows)]
    assert_eq!(ownership_open(&temp, "case", "SRC/NESTED/a.rs"), 2);
}

#[cfg(unix)]
#[test]
fn symlink_write_ownership_is_refused() {
    let temp = ownership_project();
    let outside = tempfile::TempDir::new().unwrap();
    std::os::unix::fs::symlink(outside.path(), temp.path().join("linked")).unwrap();
    assert_eq!(ownership_open(&temp, "linked", "linked/a.rs"), 2);
    assert_eq!(ownership_open(&temp, "link", "linked"), 2);
}

#[test]
fn simultaneous_overlapping_open_has_one_winner() {
    let temp = ownership_project();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    let results = std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for (name, path) in [("directory", "src"), ("file", "src/a.rs")] {
            let barrier = barrier.clone();
            let temp = &temp;
            handles.push(scope.spawn(move || {
                barrier.wait();
                ownership_open(temp, name, path)
            }));
        }
        barrier.wait();
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(
        results.iter().filter(|exit| **exit == 0).count(),
        1,
        "{results:?}"
    );
    assert_eq!(
        results.iter().filter(|exit| **exit == 2).count(),
        1,
        "{results:?}"
    );
    assert_eq!(blabla::project::task::read_all(temp.path()).len(), 1);
    assert!(blabla::project::task::unreadable(temp.path()).is_empty());
}

#[test]
fn read_inputs_may_overlap() {
    let temp = ownership_project();
    for (name, scope) in [("first", "src/a.rs"), ("second", "src/b.rs")] {
        assert_eq!(
            ownership_cli(
                &temp,
                &[
                    "task",
                    "open",
                    name,
                    "--role",
                    "worker",
                    "--statement",
                    "bounded work",
                    "--scope",
                    scope,
                    "--input",
                    "shared/config"
                ]
            ),
            0
        );
    }
}

#[test]
fn simultaneous_task_appends_keep_every_record() {
    let temp = ownership_project();
    assert_eq!(ownership_open(&temp, "notes", "src"), 0);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(9));
    std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for index in 0..8 {
            let barrier = barrier.clone();
            let temp = &temp;
            handles.push(scope.spawn(move || {
                barrier.wait();
                ownership_cli(temp, &["task", "note", "notes", &format!("note-{index}")])
            }));
        }
        barrier.wait();
        for handle in handles {
            assert_eq!(handle.join().unwrap(), 0);
        }
    });
    let task = blabla::project::task::read(temp.path(), "notes")
        .unwrap()
        .unwrap();
    let notes = task
        .notes
        .iter()
        .map(|note| note.statement.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(notes.len(), 8);
}

#[test]
fn transaction_error_does_not_replace_task_records() {
    let temp = ownership_project();
    assert_eq!(ownership_open(&temp, "notes", "src"), 0);
    let before = std::fs::read(blabla::project::task::path_of(temp.path(), "notes")).unwrap();
    let result: Result<(), String> =
        blabla::project::task::store::transaction(temp.path(), |tasks| {
            tasks[0].statement = "uncommitted change".to_owned();
            Err("refused".to_owned())
        });
    assert!(result.is_err());
    assert_eq!(
        std::fs::read(blabla::project::task::path_of(temp.path(), "notes")).unwrap(),
        before
    );
    blabla::project::task::store::transaction(temp.path(), |tasks| {
        tasks[0].statement = "committed change".to_owned();
        Ok(())
    })
    .unwrap();
    assert_eq!(
        blabla::project::task::read(temp.path(), "notes")
            .unwrap()
            .unwrap()
            .statement,
        "committed change"
    );
}

#[test]
fn busy_task_store_times_out_without_stealing_lock() {
    let temp = ownership_project();
    let held = blabla::project::task::store::lock(temp.path()).unwrap();
    let started = std::time::Instant::now();
    assert_eq!(ownership_open(&temp, "blocked", "src"), 2);
    assert!(started.elapsed() >= Duration::from_secs(5));
    assert!(started.elapsed() < Duration::from_secs(10));
    assert!(blabla::project::task::read_all(temp.path()).is_empty());
    drop(held);
    assert_eq!(ownership_open(&temp, "next", "src"), 0);
}

#[test]
fn dotted_drive_scopes_are_rejected_before_recording() {
    let temp = ownership_project();
    for (index, path) in [
        "./C:/escape",
        ".//C:\\escape",
        "././c:relative",
        ".\\C:\\escape",
    ]
    .iter()
    .enumerate()
    {
        let name = format!("drive-{index}");
        assert_eq!(ownership_open(&temp, &name, path), 2, "{path}");
        assert!(
            blabla::project::task::read(temp.path(), &name)
                .unwrap()
                .is_none()
        );
    }
}
