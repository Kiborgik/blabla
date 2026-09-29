use blabla::project::task::{self, Acceptance, Evidence, Opening};
use std::collections::BTreeMap;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;

use support::{args, run_in};

fn accepted() -> (task::Task, BTreeMap<String, String>) {
    let tree = BTreeMap::from([("src/a.rs".to_owned(), "new".to_owned())]);
    let mut task = task::record_from(
        Opening {
            name: "work".to_owned(),
            role: "worker".to_owned(),
            statement: "repair".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/a.rs".to_owned()],
            check: Some("check".to_owned()),
            ..Default::default()
        },
        0,
        BTreeMap::from([("src/a.rs".to_owned(), "old".to_owned())]),
        vec![Some("old".to_owned())],
    );
    assert!(task::apply(&mut task, "accepted"));
    task.accepted = Some(Acceptance {
        model: "small".to_owned(),
        unix: 1,
        changed_at_acceptance: None,
    });
    (task, tree)
}

fn evidence(task: &mut task::Task, tree: &BTreeMap<String, String>) {
    task.evidence.push(Evidence {
        check: "check".to_owned(),
        exit: 0,
        tree: "tree".to_owned(),
        tool: "test".to_owned(),
        unix: 2,
        inputs: task::evidence_inputs(task, tree),
        command: None,
        log: None,
    });
}

#[test]
fn handback_requires_current_evidence_then_an_explicit_challenge() {
    let (mut task, tree) = accepted();
    assert_eq!(task::handback(&task, &tree), Err("record-evidence"));
    evidence(&mut task, &tree);
    assert_eq!(task::handback(&task, &tree), Err("challenge"));
    assert!(task::record_challenge(&mut task, &tree, 0, 3));
    assert!(task::mark_ready(&mut task, &tree, 0).is_ok());
    assert_eq!(task.state, "ready");
}

#[test]
fn changed_inputs_and_new_evidence_invalidate_the_challenge() {
    let (mut task, mut tree) = accepted();
    evidence(&mut task, &tree);
    assert!(task::record_challenge(&mut task, &tree, 0, 3));
    tree.insert("src/a.rs".to_owned(), "changed".to_owned());
    assert_eq!(task::handback(&task, &tree), Err("record-evidence"));
    evidence(&mut task, &tree);
    assert_eq!(task::handback(&task, &tree), Err("challenge"));
    assert!(!task::record_challenge(&mut task, &tree, 1, 4));
    assert_eq!(task::handback(&task, &tree), Err("challenge"));
}

#[test]
fn concurrent_attributed_work_does_not_stale_a_workers_challenge() {
    let (mut task, mut tree) = accepted();
    task.attributions.push(task::Attribution {
        path: "other".to_owned(),
        kind: "concurrent".to_owned(),
        digest: None,
        model: None,
    });
    evidence(&mut task, &tree);
    assert!(task::record_challenge(&mut task, &tree, 0, 3));
    tree.insert("other/a.rs".to_owned(), "concurrent".to_owned());
    assert!(task::mark_ready(&mut task, &tree, 0).is_ok());
}

#[test]
fn reopening_a_handback_requires_another_challenge() {
    let (mut task, tree) = accepted();
    evidence(&mut task, &tree);
    assert!(task::record_challenge(&mut task, &tree, 0, 3));
    assert!(task::mark_ready(&mut task, &tree, 0).is_ok());
    assert!(task::apply(&mut task, "accepted"));
    assert_eq!(task::handback(&task, &tree), Err("challenge"));
}

#[test]
fn a_new_directory_deliverable_has_a_digest_and_child_changes_stale_its_evidence() {
    let (mut task, mut tree) = accepted();
    task.deliverables = vec![task::Deliverable {
        path: "generated".to_owned(),
        opened_digest: None,
    }];
    assert!(task::observed_digest(&tree, "generated").is_none());
    tree.insert("generated/a.py".to_owned(), "first".to_owned());
    assert!(task::observed_digest(&tree, "generated").is_some());
    task.evidence.push(Evidence {
        check: "check".to_owned(),
        exit: 0,
        tree: "tree".to_owned(),
        tool: "test".to_owned(),
        unix: 2,
        inputs: task::evidence_inputs(&task, &tree),
        command: None,
        log: None,
    });
    assert!(task::readiness(&task, &tree).supported);
    tree.insert("generated/b.py".to_owned(), "second".to_owned());
    assert!(!task::readiness(&task, &tree).supported);
}

#[test]
fn result_acceptance_rechecks_the_challenged_task_and_evidence() {
    let (mut task, tree) = accepted();
    evidence(&mut task, &tree);
    assert!(task::record_challenge(&mut task, &tree, 0, 3));
    assert!(task::mark_ready(&mut task, &tree, 0).is_ok());
    task.findings.push(task::Finding {
        id: 1,
        statement: "new concern".to_owned(),
        addressed: None,
        resolution: None,
    });
    assert!(!task::accept_result(&mut task, &tree, 0, "owner", 4));
    assert_eq!(task.state, "ready");
}

#[test]
fn explicit_inputs_bind_missing_dependencies_and_always_include_deliverables() {
    let (mut task, mut tree) = accepted();
    task.check_inputs = vec!["shared/config".to_owned()];
    evidence(&mut task, &tree);
    assert_eq!(task.evidence[0].inputs.get("shared/config"), Some(&None));
    tree.insert("src/notes.md".to_owned(), "unrelated".to_owned());
    assert!(task::readiness(&task, &tree).supported);
    tree.insert("shared/config".to_owned(), "created".to_owned());
    assert!(!task::readiness(&task, &tree).supported);
    evidence(&mut task, &tree);
    tree.remove("shared/config");
    assert!(!task::readiness(&task, &tree).supported);
    evidence(&mut task, &tree);
    tree.insert("src/a.rs".to_owned(), "changed".to_owned());
    assert!(!task::readiness(&task, &tree).supported);
}

#[test]
fn widened_check_inputs_require_fresh_evidence() {
    let (mut task, tree) = accepted();
    evidence(&mut task, &tree);
    task.check_inputs = vec!["shared/config".to_owned()];
    assert!(!task::readiness(&task, &tree).supported);
    evidence(&mut task, &tree);
    assert!(task::readiness(&task, &tree).supported);
}

#[test]
fn acceptance_records_changed_paths_when_tree_differs_from_open_state() {
    let mut task = task::record_from(
        Opening {
            name: "work".to_owned(),
            role: "worker".to_owned(),
            statement: "repair".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/a.rs".to_owned()],
            check: Some("check".to_owned()),
            ..Default::default()
        },
        0,
        BTreeMap::from([
            ("src/a.rs".to_owned(), "old".to_owned()),
            ("src/b.rs".to_owned(), "original".to_owned()),
        ]),
        vec![Some("old".to_owned())],
    );
    let current_tree = BTreeMap::from([
        ("src/a.rs".to_owned(), "changed".to_owned()),
        ("src/b.rs".to_owned(), "original".to_owned()),
        ("src/c.rs".to_owned(), "new".to_owned()),
    ]);
    assert!(task::apply(&mut task, "accepted"));
    task::record_acceptance(&mut task, &current_tree, "small", 1);
    assert!(task.accepted.is_some());
    let acceptance = task.accepted.as_ref().unwrap();
    assert_eq!(acceptance.model, "small");
    assert!(acceptance.changed_at_acceptance.is_some());
    let changed_paths = acceptance.changed_at_acceptance.as_ref().unwrap();
    assert_eq!(changed_paths.len(), 2);
    assert!(changed_paths.contains(&"src/a.rs".to_string()));
    assert!(changed_paths.contains(&"src/c.rs".to_string()));
}

#[test]
fn acceptance_records_none_when_tree_unchanged_from_open_state() {
    let mut task = task::record_from(
        Opening {
            name: "work".to_owned(),
            role: "worker".to_owned(),
            statement: "review".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/a.rs".to_owned()],
            check: Some("check".to_owned()),
            ..Default::default()
        },
        0,
        BTreeMap::from([("src/a.rs".to_owned(), "old".to_owned())]),
        vec![Some("old".to_owned())],
    );
    let current_tree = BTreeMap::from([("src/a.rs".to_owned(), "old".to_owned())]);
    assert!(task::apply(&mut task, "accepted"));
    task::record_acceptance(&mut task, &current_tree, "small", 1);
    assert!(task.accepted.is_some());
    let acceptance = task.accepted.as_ref().unwrap();
    assert_eq!(acceptance.model, "small");
    assert!(acceptance.changed_at_acceptance.is_none());
}

#[test]
fn acceptance_field_serializes_correctly_in_json() {
    let mut task = task::record_from(
        Opening {
            name: "work".to_owned(),
            role: "worker".to_owned(),
            statement: "repair".to_owned(),
            scope: vec!["src".to_owned()],
            deliverables: vec!["src/a.rs".to_owned()],
            check: Some("check".to_owned()),
            ..Default::default()
        },
        0,
        BTreeMap::from([("src/a.rs".to_owned(), "old".to_owned())]),
        vec![Some("old".to_owned())],
    );
    assert!(task::apply(&mut task, "accepted"));
    let current_tree = BTreeMap::from([
        ("src/a.rs".to_owned(), "changed".to_owned()),
        ("src/b.rs".to_owned(), "new".to_owned()),
    ]);
    task::record_acceptance(&mut task, &current_tree, "small", 1);
    let json = serde_json::to_string(&task).expect("task serializes");
    assert!(json.contains("\"changed_at_acceptance\""));
    assert!(json.contains("\"src/a.rs\""));
    assert!(json.contains("\"src/b.rs\""));
    let deserialized: task::Task = serde_json::from_str(&json).expect("task deserializes");
    assert!(deserialized.accepted.is_some());
    let acceptance = deserialized.accepted.as_ref().unwrap();
    assert!(acceptance.changed_at_acceptance.is_some());
    let paths = acceptance.changed_at_acceptance.as_ref().unwrap();
    assert_eq!(paths.len(), 2);
}

fn cli_run(temp: &TempDir, args_list: &[&str]) -> i32 {
    let output = run_in(Some(temp.path()), &args(args_list));
    output.status.code().unwrap()
}

fn cli_json(temp: &TempDir, args_list: &[&str]) -> (serde_json::Value, i32) {
    let output = run_in(Some(temp.path()), &args(args_list));
    (
        serde_json::from_str(&String::from_utf8(output.stdout).unwrap()).unwrap(),
        output.status.code().unwrap(),
    )
}

fn setup_project(temp: &TempDir) {
    let root = temp.path();
    let manifest =
        "project Test\n\nprocess \"process.bla\"\n\nuse structure \"contracts/arch.bla\"\n";
    let contract = "module thing \"src/thing.rs\"\n\nrequire \"entry\": symbol thing::run\n";
    let process = r#"
role "orchestrator" {
    purpose "divide the work"
    model ["claude-opus-4-1", "claude-sonnet-4"]
}

role "worker" {
    purpose "carry out one bounded task"
    model "qwen3.5:4b"
}

flow "development" {
    purpose "one bounded change"
}

step "assign" {
    flow "development"
    role ["orchestrator"]
    statement "record the bounded task before the work starts"
    command "blabla task open"
}
"#;
    let source = "pub fn run() {}\n";

    std::fs::create_dir_all(root.join("contracts")).unwrap();
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("project.bla"), manifest).unwrap();
    std::fs::write(root.join("contracts/arch.bla"), contract).unwrap();
    std::fs::write(root.join("process.bla"), process).unwrap();
    std::fs::write(root.join("src/thing.rs"), source).unwrap();
}

#[test]
fn cli_accept_records_changed_files_in_json_view() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);

    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "open",
                "test-task",
                "--role",
                "worker",
                "--statement",
                "test work",
                "--scope",
                "src",
                "--deliverable",
                "src/thing.rs"
            ]
        ),
        0
    );

    std::fs::write(
        temp.path().join("src/thing.rs"),
        "pub fn run() -> u8 { 42 }\n",
    )
    .unwrap();

    assert_eq!(
        cli_run(
            &temp,
            &["task", "accept", "test-task", "--model", "qwen3.5:4b"]
        ),
        0
    );

    let (view, code) = cli_json(&temp, &["task", "show", "test-task", "--json"]);
    assert_eq!(code, 0);
    assert!(view["task"]["accepted"].is_object());
    assert_eq!(view["task"]["accepted"]["model"], "qwen3.5:4b");

    let changed = &view["task"]["accepted"]["changed_at_acceptance"];
    assert!(changed.is_array());
    let changed_array = changed.as_array().unwrap();
    assert_eq!(changed_array.len(), 1);
    assert_eq!(changed_array[0], "src/thing.rs");
}

#[test]
fn argv_check_round_trips_through_open_and_show_json() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);

    let cargo_path = env!("CARGO");
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "open",
                "argv-test",
                "--role",
                "worker",
                "--statement",
                "test argv",
                "--scope",
                "src",
                "--deliverable",
                "src/thing.rs",
                "--check-argv",
                cargo_path,
                "build"
            ]
        ),
        0
    );

    let (view, code) = cli_json(&temp, &["task", "show", "argv-test", "--json"]);
    assert_eq!(code, 0);
    assert!(view["task"]["check_argv"].is_array());
    let argv = view["task"]["check_argv"].as_array().unwrap();
    assert_eq!(argv.len(), 2);
    assert_eq!(argv[0], cargo_path);
    assert_eq!(argv[1], "build");
}

#[test]
fn argv_evidence_run_with_exit_zero_records_command_and_log() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);

    let blabla_path = env!("CARGO");
    cli_run(
        &temp,
        &[
            "task",
            "open",
            "argv-exit-zero",
            "--role",
            "worker",
            "--statement",
            "test argv exit 0",
            "--scope",
            "src",
            "--deliverable",
            "src/thing.rs",
            "--check-argv",
            blabla_path,
            "--help",
        ],
    );

    assert_eq!(
        cli_run(
            &temp,
            &["task", "accept", "argv-exit-zero", "--model", "qwen3.5:4b"]
        ),
        0
    );

    assert_eq!(
        cli_run(&temp, &["task", "evidence", "argv-exit-zero", "--run"]),
        0
    );

    let (view, code) = cli_json(&temp, &["task", "show", "argv-exit-zero", "--json"]);
    assert_eq!(code, 0);
    let evidence = &view["task"]["evidence"];
    assert!(evidence.is_array());
    let entries = evidence.as_array().unwrap();
    assert!(!entries.is_empty());
    let last_entry = &entries[entries.len() - 1];
    assert_eq!(last_entry["exit"], 0);
    assert_eq!(last_entry["tool"], "run");
    assert!(last_entry["command"].is_array());
    assert!(last_entry["log"].is_string());

    let log_path = temp.path().join(last_entry["log"].as_str().unwrap());
    assert!(log_path.exists());
}

#[test]
fn attribute_records_every_path_named_in_one_call() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "open",
                "many-paths",
                "--role",
                "worker",
                "--statement",
                "attribute several paths at once",
                "--scope",
                "src",
                "--check",
                "cargo build",
            ],
        ),
        0
    );
    std::fs::write(temp.path().join("notes-a.md"), "a\n").unwrap();
    std::fs::write(temp.path().join("notes-b.md"), "b\n").unwrap();
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "attribute",
                "many-paths",
                "notes-a.md",
                "notes-b.md",
                "--kind",
                "concurrent",
                "--model",
                "claude-opus-4-1",
            ],
        ),
        0
    );
    let (view, code) = cli_json(&temp, &["task", "show", "many-paths", "--json"]);
    assert_eq!(code, 0);
    let attributions = view["task"]["attributions"].as_array().unwrap();
    let mut paths: Vec<&str> = attributions
        .iter()
        .map(|entry| entry["path"].as_str().unwrap())
        .collect();
    paths.sort_unstable();
    assert_eq!(paths, ["notes-a.md", "notes-b.md"]);
    assert!(
        attributions
            .iter()
            .all(|entry| entry["kind"] == "concurrent" && entry["model"] == "claude-opus-4-1")
    );
}

#[test]
fn attribute_is_refused_to_a_model_the_orchestrator_role_does_not_permit() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "open",
                "own-breach",
                "--role",
                "worker",
                "--statement",
                "a worker cannot declare its own change concurrent",
                "--scope",
                "src",
                "--check",
                "cargo build",
            ],
        ),
        0
    );
    std::fs::write(temp.path().join("notes.md"), "outside\n").unwrap();
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "attribute",
                "own-breach",
                "notes.md",
                "--kind",
                "concurrent",
                "--model",
                "qwen3.5:4b",
            ],
        ),
        2
    );
    let (view, code) = cli_json(&temp, &["task", "show", "own-breach", "--json"]);
    assert_eq!(code, 0);
    assert!(view["task"]["attributions"].as_array().unwrap().is_empty());
}

#[test]
fn attribute_refuses_a_path_that_has_not_changed_since_the_task_opened() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    std::fs::write(temp.path().join("notes.md"), "before\n").unwrap();
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "open",
                "unchanged",
                "--role",
                "worker",
                "--statement",
                "attribute only what moved",
                "--scope",
                "src",
                "--check",
                "cargo build",
            ],
        ),
        0
    );
    for path in ["notes.md", ".bashrc"] {
        assert_eq!(
            cli_run(
                &temp,
                &[
                    "task",
                    "attribute",
                    "unchanged",
                    path,
                    "--kind",
                    "concurrent",
                    "--model",
                    "claude-opus-4-1",
                ],
            ),
            2
        );
    }
    let (view, code) = cli_json(&temp, &["task", "show", "unchanged", "--json"]);
    assert_eq!(code, 0);
    assert!(view["task"]["attributions"].as_array().unwrap().is_empty());
}

#[test]
fn ignored_paths_leave_change_tracking_and_cannot_be_declared() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    let root = temp.path();
    let manifest = std::fs::read_to_string(root.join("project.bla")).unwrap();
    std::fs::write(
        root.join("project.bla"),
        format!("{manifest}\nignore from \".gitignore\"\nignore \".eval-artifacts\"\n"),
    )
    .unwrap();
    std::fs::write(root.join(".gitignore"), "build/\n*.log\n!keep.log\n").unwrap();
    let open = |name: &str, extra: &[&str]| {
        let mut arguments = vec![
            "task",
            "open",
            name,
            "--role",
            "worker",
            "--statement",
            "touch only what is named",
            "--scope",
            "src",
            "--check",
            "cargo build",
        ];
        arguments.extend_from_slice(extra);
        cli_run(&temp, &arguments)
    };
    assert_eq!(open("work", &[]), 0);
    std::fs::create_dir_all(root.join("build")).unwrap();
    for path in ["build/out.bin", "run.log", ".eval-artifacts"] {
        std::fs::write(root.join(path), "made by a tool\n").unwrap();
    }
    let (quiet, _) = cli_json(&temp, &["challenge", "work", "--json"]);
    for path in ["build/out.bin", "run.log", ".eval-artifacts"] {
        assert!(
            !quiet.to_string().contains(path),
            "{path} must stay out of change tracking: {quiet}"
        );
    }
    std::fs::write(root.join("keep.log"), "re-included\n").unwrap();
    let (seen, _) = cli_json(&temp, &["challenge", "work", "--json"]);
    assert!(seen.to_string().contains("keep.log"), "{seen}");
    for extra in [["--deliverable", "build/out.bin"], ["--input", "run.log"]] {
        assert_eq!(open("declared", &extra), 2, "{extra:?} is ignored");
    }
    std::fs::remove_file(root.join("keep.log")).unwrap();
    std::fs::write(root.join(".gitignore"), "build/\n*.log\n!keep.log\nsrc/\n").unwrap();
    let (widened, _) = cli_json(&temp, &["challenge", "work", "--json"]);
    assert!(
        widened.to_string().contains(".gitignore"),
        "an edited ignore list stays tracked: {widened}"
    );
}

#[test]
fn a_task_mutation_prints_one_line_and_leaves_the_record_to_show() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "open",
                "terse",
                "--role",
                "worker",
                "--statement",
                "print one line on mutation",
                "--scope",
                "src",
                "--check",
                "cargo build",
            ],
        ),
        0
    );
    let output = run_in(
        Some(temp.path()),
        &args(&["task", "note", "terse", "a note on the record"]),
    );
    assert_eq!(output.status.code().unwrap(), 0);
    let stdout = String::from_utf8(output.stdout).unwrap();
    let lines: Vec<&str> = stdout.lines().collect();
    assert_eq!(lines.len(), 1, "{stdout}");
    assert!(lines[0].starts_with("task::terse   "), "{stdout}");
    assert!(lines[0].contains("blabla task show terse"), "{stdout}");
    let shown = run_in(Some(temp.path()), &args(&["task", "show", "terse"]));
    assert!(
        String::from_utf8(shown.stdout)
            .unwrap()
            .contains("a note on the record")
    );
}

#[test]
fn an_argv_only_check_counts_as_declared_for_challenge_and_hand_back() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    let blabla_path = env!("CARGO");
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "open",
                "argv-only",
                "--role",
                "worker",
                "--statement",
                "hand back on an argv check",
                "--scope",
                "src",
                "--deliverable",
                "src/thing.rs",
                "--check-argv",
                blabla_path,
                "--help",
            ],
        ),
        0
    );
    assert_eq!(
        cli_run(
            &temp,
            &["task", "accept", "argv-only", "--model", "qwen3.5:4b"]
        ),
        0
    );
    std::fs::write(
        temp.path().join("src/thing.rs"),
        "pub fn thing() -> u8 { 2 }\n",
    )
    .unwrap();
    assert_eq!(
        cli_run(&temp, &["task", "evidence", "argv-only", "--run"]),
        0
    );
    assert_eq!(cli_run(&temp, &["challenge", "argv-only"]), 0);
    assert_eq!(cli_run(&temp, &["task", "ready", "argv-only"]), 0);
    let (view, code) = cli_json(&temp, &["task", "show", "argv-only", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(view["task"]["state"], "ready");
}

#[test]
fn argv_evidence_run_with_non_zero_exit_records_exit_code() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);

    let blabla_path = env!("CARGO");
    cli_run(
        &temp,
        &[
            "task",
            "open",
            "argv-exit-nonzero",
            "--role",
            "worker",
            "--statement",
            "test argv exit nonzero",
            "--scope",
            "src",
            "--deliverable",
            "src/thing.rs",
            "--check-argv",
            blabla_path,
            "nonexistent-subcommand",
        ],
    );

    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "accept",
                "argv-exit-nonzero",
                "--model",
                "qwen3.5:4b"
            ]
        ),
        0
    );

    let exit_code = cli_run(&temp, &["task", "evidence", "argv-exit-nonzero", "--run"]);
    assert_eq!(exit_code, 0);

    let (view, code) = cli_json(&temp, &["task", "show", "argv-exit-nonzero", "--json"]);
    assert_eq!(code, 0);
    let evidence = &view["task"]["evidence"];
    assert!(evidence.is_array());
    let entries = evidence.as_array().unwrap();
    assert!(!entries.is_empty());
    let last_entry = &entries[entries.len() - 1];
    assert!(last_entry["exit"].as_i64().unwrap() != 0);
    assert_eq!(last_entry["tool"], "run");
    assert!(last_entry["command"].is_array());
    assert!(last_entry["log"].is_string());
}

#[test]
fn argv_evidence_run_on_string_check_refuses_and_records_nothing() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);

    cli_run(
        &temp,
        &[
            "task",
            "open",
            "string-check",
            "--role",
            "worker",
            "--statement",
            "test string check",
            "--scope",
            "src",
            "--deliverable",
            "src/thing.rs",
            "--check",
            "cargo test",
        ],
    );

    assert_eq!(
        cli_run(
            &temp,
            &["task", "accept", "string-check", "--model", "qwen3.5:4b"]
        ),
        0
    );

    let exit_code = cli_run(&temp, &["task", "evidence", "string-check", "--run"]);
    assert_eq!(exit_code, 2);

    let (view, code) = cli_json(&temp, &["task", "show", "string-check", "--json"]);
    assert_eq!(code, 0);
    let evidence = &view["task"]["evidence"];
    assert!(evidence.is_array());
    let entries = evidence.as_array().unwrap();
    assert_eq!(entries.len(), 0);
}

#[test]
fn task_deliverable_remove_requires_model() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);

    cli_run(
        &temp,
        &[
            "task",
            "open",
            "remove-test",
            "--role",
            "worker",
            "--statement",
            "test remove",
            "--scope",
            "src",
            "--deliverable",
            "src/thing.rs",
        ],
    );

    let exit_code = cli_run(
        &temp,
        &[
            "task",
            "deliverable",
            "remove-test",
            "--remove",
            "src/thing.rs",
            "--reason",
            "test removal",
        ],
    );
    assert_eq!(exit_code, 2);
}

#[test]
fn task_resolve_requires_model() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);

    cli_run(
        &temp,
        &[
            "task",
            "open",
            "resolve-test",
            "--role",
            "worker",
            "--statement",
            "test resolve",
            "--scope",
            "src",
            "--deliverable",
            "src/thing.rs",
        ],
    );

    cli_run(&temp, &["task", "finding", "resolve-test", "test issue"]);

    let exit_code = cli_run(
        &temp,
        &[
            "task",
            "resolve",
            "resolve-test",
            "1",
            "--evidence",
            "test evidence",
        ],
    );
    assert_eq!(exit_code, 2);
    let refused = cli_run(
        &temp,
        &[
            "task",
            "resolve",
            "resolve-test",
            "1",
            "--evidence",
            "test evidence",
            "--model",
            "qwen3.5:4b",
        ],
    );
    assert_eq!(refused, 2);
    let (view, _) = cli_json(&temp, &["task", "show", "resolve-test", "--json"]);
    assert!(
        view["task"]["findings"][0]["resolution"].is_null(),
        "{view}"
    );
    let settled = cli_run(
        &temp,
        &[
            "task",
            "resolve",
            "resolve-test",
            "1",
            "--evidence",
            "test evidence",
            "--model",
            "claude-opus-4-1",
        ],
    );
    assert_eq!(settled, 0);
    let (view, _) = cli_json(&temp, &["task", "show", "resolve-test", "--json"]);
    assert_eq!(
        view["task"]["findings"][0]["resolution"]["model"], "claude-opus-4-1",
        "{view}"
    );
}

fn open_and_accept(temp: &TempDir, deliverable: &str) {
    assert_eq!(
        cli_run(
            temp,
            &[
                "task",
                "open",
                "test-task",
                "--role",
                "worker",
                "--statement",
                "test work",
                "--scope",
                "src",
                "--deliverable",
                deliverable,
                "--check",
                "cargo test",
                "--json",
            ],
        ),
        0
    );
    assert_eq!(
        cli_run(
            temp,
            &[
                "task",
                "accept",
                "test-task",
                "--model",
                "qwen3.5:4b",
                "--json"
            ],
        ),
        0
    );
}

#[test]
fn edited_file_added_as_deliverable_does_not_trigger_unchanged_challenge() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "open",
                "edit-test",
                "--role",
                "worker",
                "--statement",
                "edit a file then add it",
                "--scope",
                "src",
                "--check",
                "cargo test",
                "--json",
            ],
        ),
        0
    );
    std::fs::write(
        temp.path().join("src/thing.rs"),
        "pub fn run() -> u8 { 42 }\n",
    )
    .unwrap();
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "deliverable",
                "edit-test",
                "--add",
                "src/thing.rs",
                "--json"
            ],
        ),
        0
    );
    assert_eq!(
        cli_run(
            &temp,
            &["task", "accept", "edit-test", "--model", "qwen3.5:4b"]
        ),
        0
    );
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "evidence",
                "edit-test",
                "--exit",
                "0",
                "--tool",
                "t",
                "--json"
            ],
        ),
        0
    );
    let (view, _) = cli_json(&temp, &["challenge", "edit-test", "--json"]);
    let grounded = view["grounded"]
        .as_array()
        .expect("grounded should be an array");
    assert!(
        !grounded
            .iter()
            .any(|v| v.as_str() == Some("deliverable-unchanged")),
        "edited file added as deliverable should not trigger deliverable-unchanged challenge: {view:?}"
    );
}

fn grounded(temp: &TempDir) -> Vec<String> {
    let (view, _) = cli_json(temp, &["challenge", "test-task", "--json"]);
    view["grounded"]
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn a_note_is_not_a_finding_and_a_withdrawn_deliverable_stops_being_owed() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    open_and_accept(&temp, "src/thing.rs");
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "evidence",
                "test-task",
                "--exit",
                "0",
                "--tool",
                "t",
                "--json"
            ],
        ),
        0
    );
    assert!(grounded(&temp).contains(&"deliverable-unchanged".to_owned()));
    let noted = run_in(
        Some(temp.path()),
        &args(&["task", "note", "test-task", "a status note", "--json"]),
    );
    assert_eq!(noted.status.code(), Some(0), "{noted:?}");
    let (view, _) = cli_json(&temp, &["task", "show", "test-task", "--json"]);
    assert_eq!(view["task"]["notes"].as_array().unwrap().len(), 1, "{view}");
    assert_eq!(view["unresolved"], 0, "{view}");
    assert!(!grounded(&temp).contains(&"unresolved-finding".to_owned()));
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "deliverable",
                "test-task",
                "--remove",
                "src/thing.rs",
                "--reason",
                "the fix never needed it",
                "--model",
                "claude-opus-4-1",
                "--json",
            ],
        ),
        0
    );
    let (view, _) = cli_json(&temp, &["task", "show", "test-task", "--json"]);
    assert_eq!(
        view["task"]["removed_deliverables"][0]["path"],
        "src/thing.rs"
    );
    assert!(view["task"]["deliverables"].as_array().unwrap().is_empty());
    assert!(!grounded(&temp).contains(&"deliverable-unchanged".to_owned()));
}

#[test]
fn attributing_a_path_again_refreshes_its_digest() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    open_and_accept(&temp, "src/thing.rs");
    std::fs::write(temp.path().join("notes.md"), "one\n").unwrap();
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "attribute",
                "test-task",
                "notes.md",
                "--kind",
                "concurrent",
                "--model",
                "claude-opus-4-1",
                "--json"
            ],
        ),
        0
    );
    let (first, _) = cli_json(&temp, &["task", "show", "test-task", "--json"]);
    std::fs::write(temp.path().join("notes.md"), "two\n").unwrap();
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "attribute",
                "test-task",
                "notes.md",
                "--kind",
                "concurrent",
                "--model",
                "claude-opus-4-1",
                "--json"
            ],
        ),
        0
    );
    let (second, _) = cli_json(&temp, &["task", "show", "test-task", "--json"]);
    assert_eq!(second["task"]["attributions"].as_array().unwrap().len(), 1);
    assert_ne!(
        first["task"]["attributions"][0]["digest"],
        second["task"]["attributions"][0]["digest"]
    );
    assert!(!grounded(&temp).contains(&"attribution-unknown".to_owned()));
}

#[test]
fn the_assignment_view_routes_by_state_and_never_names_the_product_gate() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    open_and_accept(&temp, "src/thing.rs");
    let accepted =
        String::from_utf8(run_in(Some(temp.path()), &args(&["task", "show", "test-task"])).stdout)
            .unwrap();
    assert!(
        !accepted.contains("blabla task accept test-task"),
        "{accepted}"
    );
    assert!(
        accepted.contains("blabla task note test-task"),
        "{accepted}"
    );
    assert!(
        accepted.contains("blabla task lens test-task"),
        "{accepted}"
    );
    std::fs::write(
        temp.path().join("src/thing.rs"),
        "pub fn run() { let _ = 1; }\n",
    )
    .unwrap();
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "evidence",
                "test-task",
                "--exit",
                "0",
                "--tool",
                "t",
                "--json"
            ],
        ),
        0
    );
    let (challenged, _) = cli_json(&temp, &["challenge", "test-task", "--json"]);
    assert_eq!(challenged["assignment_clear"], true, "{challenged}");
    let (handed_back, code) = cli_json(&temp, &["task", "ready", "test-task", "--json"]);
    assert_eq!(code, 0, "{handed_back}");
    assert_eq!(handed_back["task"]["state"], "ready", "{handed_back}");
    let ready =
        String::from_utf8(run_in(Some(temp.path()), &args(&["task", "show", "test-task"])).stdout)
            .unwrap();
    assert!(!ready.contains("blabla task lens test-task"), "{ready}");
    assert!(ready.contains("blabla task accept test-task"), "{ready}");
    for view in [&accepted, &ready] {
        assert!(!view.contains("blabla finish"), "{view}");
    }
}

#[test]
fn a_receipt_survives_edits_outside_the_tasks_paths_and_dies_on_edits_inside() {
    let (mut task, mut tree) = accepted();
    evidence(&mut task, &tree);
    assert!(task::record_challenge(&mut task, &tree, 0, 3));
    tree.insert("docs/notes.md".to_owned(), "unrelated".to_owned());
    tree.insert("other/worker.rs".to_owned(), "sibling".to_owned());
    assert_eq!(task::handback(&task, &tree), Ok(()));
    tree.insert("src/b.rs".to_owned(), "inside the scope".to_owned());
    assert!(!task::challenge_current(&task, &tree));
    assert_eq!(task::handback(&task, &tree), Err("record-evidence"));
}

#[test]
fn an_addressed_finding_stops_blocking_hand_back_while_resolution_stays_the_orchestrators() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    open_and_accept(&temp, "src/thing.rs");
    assert_eq!(
        cli_run(
            &temp,
            &["task", "finding", "test-task", "reviewer defect", "--json"],
        ),
        0
    );
    assert!(grounded(&temp).contains(&"unresolved-finding".to_owned()));
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "addressed",
                "test-task",
                "1",
                "fixed at src/thing.rs",
                "--model",
                "claude-opus-4-1",
                "--json",
            ],
        ),
        2
    );
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "addressed",
                "test-task",
                "1",
                "fixed at src/thing.rs",
                "--model",
                "qwen3.5:4b",
                "--json",
            ],
        ),
        0
    );
    assert!(!grounded(&temp).contains(&"unresolved-finding".to_owned()));
    let (view, _) = cli_json(&temp, &["task", "show", "test-task", "--json"]);
    assert_eq!(
        view["task"]["findings"][0]["addressed"]["model"],
        "qwen3.5:4b"
    );
    assert!(view["task"]["findings"][0]["resolution"].is_null());
    assert_eq!(view["unresolved"], 1);
}

#[test]
fn a_record_closed_before_tasks_carried_a_state_stays_closed() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    open_and_accept(&temp, "src/thing.rs");
    let path = temp.path().join(".blabla/tasks/test-task.json");
    let mut record: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let fields = record.as_object_mut().unwrap();
    fields.remove("state");
    fields.insert("closed_unix".to_owned(), serde_json::json!(1234567890u64));
    std::fs::write(&path, serde_json::to_string_pretty(&record).unwrap()).unwrap();

    let (view, code) = cli_json(&temp, &["task", "show", "test-task", "--json"]);
    assert_eq!(code, 0, "{view}");
    assert_eq!(view["task"]["state"], "closed", "{view}");
    assert_eq!(
        cli_run(&temp, &["task", "note", "test-task", "late", "--json"]),
        2
    );
}

#[test]
fn a_corrected_check_refuses_an_input_left_out_of_change_tracking() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    let root = temp.path();
    let manifest = std::fs::read_to_string(root.join("project.bla")).unwrap();
    std::fs::write(
        root.join("project.bla"),
        format!("{manifest}\nignore \"build/\"\n"),
    )
    .unwrap();
    std::fs::create_dir_all(root.join("build")).unwrap();
    open_and_accept(&temp, "src/thing.rs");
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "check",
                "test-task",
                "cargo test",
                "--json",
                "--input",
                "build"
            ],
        ),
        2
    );
    let (view, _) = cli_json(&temp, &["task", "show", "test-task", "--json"]);
    assert!(
        view["task"]["check_inputs"].as_array().unwrap().is_empty(),
        "{view}"
    );
}

#[test]
fn a_clear_assignment_challenge_leaves_project_verification_to_the_orchestrator() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    open_and_accept(&temp, "src/thing.rs");
    std::fs::write(temp.path().join("src/thing.rs"), "pub fn other() {}\n").unwrap();
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "evidence",
                "test-task",
                "--exit",
                "0",
                "--tool",
                "t",
                "--json"
            ],
        ),
        0
    );
    let (view, code) = cli_json(&temp, &["challenge", "test-task", "--json"]);
    assert_eq!(code, 0, "{view}");
    assert_eq!(view["assignment_clear"], true, "{view}");
    assert_eq!(
        view["challenge"]["class"], "verification-not-current",
        "{view}"
    );
    assert!(
        !view["challenge"]["reconcile"]
            .as_str()
            .unwrap()
            .contains("blabla finish"),
        "{view}"
    );
}

#[test]
fn a_check_is_declared_as_a_command_or_as_argv_never_both() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    let open = |name: &str, check: &[&str]| {
        let mut arguments = vec![
            "task",
            "open",
            name,
            "--role",
            "worker",
            "--statement",
            "one check",
            "--scope",
            "src",
            "--json",
        ];
        arguments.extend_from_slice(check);
        cli_run(&temp, &arguments)
    };
    assert_eq!(
        open(
            "both",
            &["--check", "cargo test", "--check-argv", "cargo", "test"]
        ),
        2
    );
    assert_eq!(open("argv", &["--check-argv", "cargo", "test"]), 0);
    assert_eq!(
        cli_run(&temp, &["task", "check", "argv", "cargo build", "--json"]),
        0
    );
    let (view, _) = cli_json(&temp, &["task", "show", "argv", "--json"]);
    assert_eq!(view["task"]["check"], "cargo build", "{view}");
    assert!(view["task"]["check_argv"].is_null(), "{view}");
    assert_eq!(
        cli_run(
            &temp,
            &["task", "check", "argv", "--json", "--argv", "cargo", "test"]
        ),
        0
    );
    let (view, _) = cli_json(&temp, &["task", "show", "argv", "--json"]);
    assert!(view["task"]["check"].is_null(), "{view}");
    assert_eq!(
        view["task"]["check_argv"],
        serde_json::json!(["cargo", "test"]),
        "{view}"
    );
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "check",
                "argv",
                "cargo build",
                "--argv",
                "cargo",
                "test"
            ]
        ),
        2
    );
}

#[test]
fn a_deliverable_withdrawal_names_what_the_task_owes_and_stands_alone() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    std::fs::write(temp.path().join("src/extra.rs"), "pub fn extra() {}\n").unwrap();
    open_and_accept(&temp, "src");
    let withdraw = |target: &[&str]| {
        let mut arguments = vec![
            "task",
            "deliverable",
            "test-task",
            "--reason",
            "not needed",
            "--model",
            "claude-opus-4-1",
            "--json",
        ];
        arguments.extend_from_slice(target);
        cli_run(&temp, &arguments)
    };
    assert_eq!(
        withdraw(&["--remove", "src/thing.rs", "--add", "src/extra.rs"]),
        2
    );
    assert_eq!(withdraw(&["--remove", "src/missing.rs"]), 2);
    let (view, _) = cli_json(&temp, &["task", "show", "test-task", "--json"]);
    assert!(
        view["task"]["removed_deliverables"]
            .as_array()
            .unwrap()
            .is_empty(),
        "{view}"
    );
    assert_eq!(
        view["task"]["deliverables"].as_array().unwrap().len(),
        2,
        "{view}"
    );
    assert_eq!(withdraw(&["--remove", "src"]), 0);
    let (view, _) = cli_json(&temp, &["task", "show", "test-task", "--json"]);
    assert!(
        view["task"]["deliverables"].as_array().unwrap().is_empty(),
        "{view}"
    );
    assert_eq!(
        view["task"]["removed_deliverables"]
            .as_array()
            .unwrap()
            .len(),
        2,
        "{view}"
    );
}

#[test]
fn settling_a_finding_needs_process_memory_that_declares_the_orchestrator() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    let root = temp.path();
    let process = std::fs::read_to_string(root.join("process.bla")).unwrap();
    std::fs::write(
        root.join("project.bla"),
        "project Test\n\nuse structure \"contracts/arch.bla\"\n",
    )
    .unwrap();
    open_and_accept(&temp, "src/thing.rs");
    assert_eq!(
        cli_run(
            &temp,
            &["task", "block", "test-task", "cannot go on", "--json"]
        ),
        0
    );
    let resolve = || {
        cli_run(
            &temp,
            &[
                "task",
                "resolve",
                "test-task",
                "1",
                "--evidence",
                "settled",
                "--model",
                "claude-opus-4-1",
                "--json",
            ],
        )
    };
    assert_eq!(resolve(), 2);
    std::fs::write(
        root.join("project.bla"),
        "project Test\n\nprocess \"process.bla\"\n\nuse structure \"contracts/arch.bla\"\n",
    )
    .unwrap();
    std::fs::write(root.join("process.bla"), process).unwrap();
    assert_eq!(resolve(), 0);
}

#[test]
fn failing_evidence_displays_log_path_and_last_lines() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);

    let blabla_path = env!("CARGO");
    cli_run(
        &temp,
        &[
            "task",
            "open",
            "failing-run",
            "--role",
            "worker",
            "--statement",
            "test failing --run evidence display",
            "--scope",
            "src",
            "--deliverable",
            "src/thing.rs",
            "--check-argv",
            blabla_path,
            "nonexistent-subcommand",
        ],
    );

    assert_eq!(
        cli_run(
            &temp,
            &["task", "accept", "failing-run", "--model", "qwen3.5:4b"]
        ),
        0
    );

    assert_eq!(
        cli_run(&temp, &["task", "evidence", "failing-run", "--run"]),
        0
    );

    let output = run_in(Some(temp.path()), &args(&["task", "show", "failing-run"]));
    let stdout = String::from_utf8(output.stdout).unwrap();

    assert!(
        stdout.contains("Exit code:"),
        "Output should contain exit code heading: {}",
        stdout
    );

    assert!(
        stdout.contains("Log: .blabla/scratch/failing-run/evidence-1.log"),
        "Output should contain log path: {}",
        stdout
    );

    assert!(
        stdout.contains("non-empty lines")
            || stdout.contains("could not read")
            || stdout.contains("empty"),
        "Output should mention log lines: {}",
        stdout
    );
}

#[test]
fn passing_evidence_does_not_display_log_lines() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);

    let blabla_path = env!("CARGO");
    cli_run(
        &temp,
        &[
            "task",
            "open",
            "passing-run",
            "--role",
            "worker",
            "--statement",
            "test passing --run evidence display",
            "--scope",
            "src",
            "--deliverable",
            "src/thing.rs",
            "--check-argv",
            blabla_path,
            "--help",
        ],
    );

    assert_eq!(
        cli_run(
            &temp,
            &["task", "accept", "passing-run", "--model", "qwen3.5:4b"]
        ),
        0
    );

    assert_eq!(
        cli_run(&temp, &["task", "evidence", "passing-run", "--run"]),
        0
    );

    let output = run_in(Some(temp.path()), &args(&["task", "show", "passing-run"]));
    let stdout = String::from_utf8(output.stdout).unwrap();

    assert!(
        !stdout.contains("Exit code:"),
        "Output should NOT contain exit code section for passing evidence: {}",
        stdout
    );
}

#[test]
fn failing_evidence_log_readable_from_subdirectory() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);

    let blabla_path = env!("CARGO");
    cli_run(
        &temp,
        &[
            "task",
            "open",
            "subdir-test",
            "--role",
            "worker",
            "--statement",
            "test failing evidence from subdirectory",
            "--scope",
            "src",
            "--deliverable",
            "src/thing.rs",
            "--check-argv",
            blabla_path,
            "nonexistent-subcommand",
        ],
    );

    assert_eq!(
        cli_run(
            &temp,
            &["task", "accept", "subdir-test", "--model", "qwen3.5:4b"]
        ),
        0
    );

    assert_eq!(
        cli_run(&temp, &["task", "evidence", "subdir-test", "--run"]),
        0
    );

    let subdir = temp.path().join("subdir");
    std::fs::create_dir(&subdir).unwrap();

    let output = run_in(Some(&subdir), &args(&["task", "show", "subdir-test"]));
    let stdout = String::from_utf8(output.stdout).unwrap();

    assert!(
        stdout.contains("Exit code:"),
        "Output should contain exit code heading when run from subdirectory: {}",
        stdout
    );

    assert!(
        stdout.contains("Log: .blabla/scratch/subdir-test/evidence-1.log"),
        "Output should contain log path when run from subdirectory: {}",
        stdout
    );

    assert!(
        stdout.contains("non-empty lines")
            || stdout.contains("could not read")
            || stdout.contains("empty"),
        "Output should mention log lines when run from subdirectory: {}",
        stdout
    );
}

fn open_with_argv_check(temp: &TempDir, name: &str, argv: &[&str]) {
    let mut arguments = vec![
        "task",
        "open",
        name,
        "--role",
        "worker",
        "--statement",
        "a check that touches its own record",
        "--scope",
        "src",
        "--deliverable",
        "src/thing.rs",
        "--check-argv",
    ];
    arguments.extend_from_slice(argv);
    assert_eq!(cli_run(temp, &arguments), 0);
    assert_eq!(
        cli_run(temp, &["task", "accept", name, "--model", "qwen3.5:4b"]),
        0
    );
}

#[test]
fn a_note_the_check_itself_records_survives_evidence_run() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    let blabla = env!("CARGO_BIN_EXE_blabla");
    open_with_argv_check(
        &temp,
        "note-during-check",
        &[
            blabla,
            "task",
            "note",
            "note-during-check",
            "recorded while the check ran",
        ],
    );

    assert_eq!(
        cli_run(&temp, &["task", "evidence", "note-during-check", "--run"]),
        0
    );

    let (view, code) = cli_json(&temp, &["task", "show", "note-during-check", "--json"]);
    assert_eq!(code, 0, "{view}");
    let notes: Vec<&str> = view["task"]["notes"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|note| note["statement"].as_str())
        .collect();
    assert_eq!(notes, vec!["recorded while the check ran"], "{view}");
    let evidence = view["task"]["evidence"].as_array().unwrap();
    assert_eq!(evidence.len(), 1, "{view}");
    assert_eq!(evidence[0]["exit"], 0, "{view}");
    assert_eq!(evidence[0]["tool"], "run", "{view}");
}

#[test]
fn evidence_run_records_nothing_when_its_check_moves_the_task_out_of_accepted() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    let blabla = env!("CARGO_BIN_EXE_blabla");
    open_with_argv_check(
        &temp,
        "block-during-check",
        &[
            blabla,
            "task",
            "block",
            "block-during-check",
            "blocked while the check ran",
        ],
    );

    assert_eq!(
        cli_run(&temp, &["task", "evidence", "block-during-check", "--run"]),
        2
    );

    let (view, _) = cli_json(&temp, &["task", "show", "block-during-check", "--json"]);
    assert_eq!(view["task"]["state"], "blocked", "{view}");
    assert!(
        view["task"]["evidence"]
            .as_array()
            .is_none_or(|entries| entries.is_empty()),
        "{view}"
    );
}

fn with_exception(model: &str, approved: bool) -> task::Exception {
    task::Exception {
        model: model.to_owned(),
        reason: "design heavy".to_owned(),
        approval: approved.then(|| "owner approved".to_owned()),
    }
}

#[test]
fn a_model_outside_the_list_addresses_only_when_accepted_and_approved() {
    let permitted = vec!["qwen3.5:4b".to_owned()];
    let (mut task, _) = accepted();
    assert!(task::can_address_finding(&task, "qwen3.5:4b", &permitted));
    assert!(!task::can_address_finding(&task, "small", &permitted));
    task.exceptions.push(with_exception("small", false));
    assert!(!task::can_address_finding(&task, "small", &permitted));
    task.exceptions.push(with_exception("other", true));
    assert!(!task::can_address_finding(&task, "other", &permitted));
    assert!(!task::can_address_finding(&task, "small", &permitted));
    task.exceptions.push(with_exception("small", true));
    assert!(task::can_address_finding(&task, "small", &permitted));
    task.accepted = None;
    assert!(!task::can_address_finding(&task, "small", &permitted));
}

#[test]
fn a_role_without_a_model_list_lets_any_model_address() {
    let (task, _) = accepted();
    assert!(task::can_address_finding(&task, "anything", &[]));
    assert!(task::can_address_finding(&task, "small", &[]));
}

fn address(temp: &TempDir, model: &str) -> i32 {
    cli_run(
        temp,
        &[
            "task",
            "addressed",
            "test-task",
            "1",
            "fixed at src/thing.rs",
            "--model",
            model,
            "--json",
        ],
    )
}

fn addressed_model(temp: &TempDir) -> serde_json::Value {
    let (view, _) = cli_json(temp, &["task", "show", "test-task", "--json"]);
    view["task"]["findings"][0]["addressed"]["model"].clone()
}

#[test]
fn an_approved_model_the_task_was_not_accepted_on_may_not_address() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    open_and_accept(&temp, "src/thing.rs");
    assert_eq!(
        cli_run(&temp, &["task", "finding", "test-task", "defect", "--json"]),
        0
    );
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "propose-model",
                "test-task",
                "claude-sonnet-4",
                "--reason",
                "design heavy",
            ],
        ),
        0
    );
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "approve-model",
                "test-task",
                "claude-sonnet-4",
                "--approval",
                "owner approved",
            ],
        ),
        0
    );
    assert_eq!(address(&temp, "claude-sonnet-4"), 2);
    assert!(addressed_model(&temp).is_null());
    assert!(grounded(&temp).contains(&"unresolved-finding".to_owned()));

    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "accept",
                "test-task",
                "--model",
                "claude-sonnet-4",
                "--json"
            ],
        ),
        0
    );
    assert_eq!(address(&temp, "claude-sonnet-4"), 0);
    assert_eq!(addressed_model(&temp), "claude-sonnet-4");
}

#[test]
fn an_accepted_model_without_an_approved_exception_may_not_address() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    open_and_accept(&temp, "src/thing.rs");
    assert_eq!(
        cli_run(
            &temp,
            &[
                "task",
                "accept",
                "test-task",
                "--model",
                "gpt-4-turbo",
                "--json"
            ],
        ),
        0
    );
    assert_eq!(
        cli_run(&temp, &["task", "finding", "test-task", "defect", "--json"]),
        0
    );
    assert_eq!(address(&temp, "gpt-4-turbo"), 2);
    assert!(addressed_model(&temp).is_null());
    assert!(grounded(&temp).contains(&"unresolved-finding".to_owned()));
}

#[test]
fn a_worker_role_without_a_model_list_lets_any_model_address_its_finding() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    let process = std::fs::read_to_string(temp.path().join("process.bla"))
        .unwrap()
        .replace("    model \"qwen3.5:4b\"\n", "");
    std::fs::write(temp.path().join("process.bla"), process).unwrap();
    open_and_accept(&temp, "src/thing.rs");
    assert_eq!(
        cli_run(&temp, &["task", "finding", "test-task", "defect", "--json"]),
        0
    );
    assert_eq!(address(&temp, "any-model"), 0);
    assert_eq!(addressed_model(&temp), "any-model");
}

#[test]
fn a_closed_task_refuses_an_address_and_a_run() {
    let temp = TempDir::new().unwrap();
    setup_project(&temp);
    open_and_accept(&temp, "src/thing.rs");
    assert_eq!(
        cli_run(&temp, &["task", "finding", "test-task", "defect", "--json"]),
        0
    );
    let path = temp.path().join(".blabla/tasks/test-task.json");
    let mut record: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let fields = record.as_object_mut().unwrap();
    fields.insert("state".to_owned(), serde_json::json!("closed"));
    fields.insert("closed_unix".to_owned(), serde_json::json!(1234567890u64));
    fields.insert(
        "check_argv".to_owned(),
        serde_json::json!([env!("CARGO_BIN_EXE_blabla"), "--help"]),
    );
    fields.remove("check");
    let before = serde_json::to_string_pretty(&record).unwrap();
    std::fs::write(&path, &before).unwrap();

    assert_eq!(address(&temp, "qwen3.5:4b"), 2);
    assert_eq!(
        cli_run(&temp, &["task", "evidence", "test-task", "--run", "--json"]),
        2
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
}
