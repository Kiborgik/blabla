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
            check_argv: None,
            inputs: Vec::new(),
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
            check_argv: None,
            inputs: Vec::new(),
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
            check_argv: None,
            inputs: Vec::new(),
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
            check_argv: None,
            inputs: Vec::new(),
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
