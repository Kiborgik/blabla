use blabla::project::{self, task};
use serde_json::Value;
use std::path::Path;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;

fn write(root: &Path, path: &str, text: &str) {
    let path = root.join(path);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn fixture() -> TempDir {
    let temp = TempDir::new().unwrap();
    write(
        temp.path(),
        "project.bla",
        "project Tracking\nuse structure \"architecture.bla\"\nprocess \"process.bla\"\nignore \"ignored/\"\n",
    );
    write(
        temp.path(),
        "architecture.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(temp.path(), "src/app.rs", "pub fn run() {}\n");
    write(
        temp.path(),
        "process.bla",
        "role \"orchestrator\" { purpose \"assign\" model \"owner\" }\nrole \"worker\" { purpose \"carry\" model \"worker\" }\n",
    );
    temp
}

fn cli(temp: &TempDir, arguments: &[&str]) -> (i32, Value) {
    let mut all = vec!["--json"];
    all.extend_from_slice(arguments);
    let output = support::run_in(Some(temp.path()), &support::args(&all));
    let report = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|_| panic!("stdout {:?}, stderr {:?}", output.stdout, output.stderr));
    (output.status.code().unwrap(), report)
}

fn open(temp: &TempDir, extra: &[&str]) -> (i32, Value) {
    let mut args = vec![
        "task",
        "open",
        "work",
        "--role",
        "worker",
        "--statement",
        "observe dependencies",
        "--scope",
        "src",
        "--check",
        "portable check",
    ];
    args.extend_from_slice(extra);
    cli(temp, &args)
}

fn success(temp: &TempDir, args: &[&str]) -> Value {
    let (exit, report) = cli(temp, args);
    assert_eq!(exit, 0, "{args:?}: {report}");
    report
}

fn legacy(temp: &TempDir, path: &str, deliverable: bool) -> task::Task {
    let project =
        project::load(project::read_manifest(&temp.path().join("project.bla")).unwrap()).unwrap();
    let tree = project::snapshot(temp.path(), &project.ignore);
    let mut work = task::record(
        temp.path(),
        &project.ignore,
        task::Opening {
            name: "work".into(),
            role: "worker".into(),
            statement: "legacy dependency".into(),
            scope: vec!["src".into()],
            inputs: if deliverable {
                vec!["src".into()]
            } else {
                vec![path.into()]
            },
            deliverables: if deliverable {
                vec![path.into()]
            } else {
                vec![]
            },
            check: Some("portable check".into()),
            ..Default::default()
        },
        1,
    );
    assert!(task::apply(&mut work, "accepted"));
    task::record_acceptance(&mut work, &tree, "worker", 2);
    work.evidence.push(task::Evidence {
        identity: task::declared_check(&work),
        acceptance_epoch: Some(work.acceptance_epoch),
        check: "portable check".into(),
        exit: 0,
        tree: "history".into(),
        tool: "legacy".into(),
        unix: 3,
        inputs: task::evidence_inputs(&work, &tree),
        command: None,
        log: None,
    });
    assert!(task::record_challenge(&mut work, &tree, 0, 4));
    task::write(temp.path(), &work).unwrap();
    work
}

#[test]
fn input_admission_rejects_skipped_and_unsafe_paths_atomically() {
    for path in [
        ".blabla/scratch/dependency",
        ".blabla/scratch/dependency/value.txt",
        "src/target/value.txt",
        "target",
        "src/../tracked.txt",
        "../external.txt",
        "/external.txt",
        "C:external.txt",
        ".",
        "ignored",
        "ignored/value.txt",
    ] {
        let temp = fixture();
        let (exit, report) = open(&temp, &["--input", path]);
        assert_eq!(exit, 2, "accepted {path:?}: {report}");
        assert!(task::read(temp.path(), "work").unwrap().is_none());
    }
}

#[test]
fn deliverable_admission_and_check_corrections_are_atomic() {
    for path in [
        ".blabla/scratch/value.txt",
        "src/../tracked.txt",
        "../external.txt",
        "ignored/value.txt",
    ] {
        let temp = fixture();
        assert_eq!(open(&temp, &["--deliverable", path]).0, 2, "{path}");
        assert_eq!(open(&temp, &[]).0, 0);
        let file = temp.path().join(".blabla/tasks/work.json");
        let before = std::fs::read(&file).unwrap();
        assert_eq!(
            cli(
                &temp,
                &["task", "check", "work", "replacement", "--input", path]
            )
            .0,
            2
        );
        assert_eq!(std::fs::read(&file).unwrap(), before);
        assert_eq!(
            cli(&temp, &["task", "deliverable", "work", "--add", path]).0,
            2
        );
        assert_eq!(std::fs::read(&file).unwrap(), before);
    }
}

#[test]
fn normalized_inputs_and_deliverables_track_creation_and_deletion() {
    let temp = fixture();
    assert_eq!(
        open(
            &temp,
            &[
                "--scope",
                "future",
                "--scope",
                "deps",
                "--input",
                "./deps//",
                "--deliverable",
                "./future//value.txt"
            ]
        )
        .0,
        0
    );
    let view = success(&temp, &["task", "show", "work"]);
    assert_eq!(view["task"]["check_inputs"], serde_json::json!(["deps"]));
    assert_eq!(view["task"]["deliverables"][0]["path"], "future/value.txt");
    write(temp.path(), "future/value.txt", "delivered\n");
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    success(
        &temp,
        &[
            "task", "evidence", "work", "--exit", "0", "--tool", "portable",
        ],
    );
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
    write(temp.path(), "deps/value.txt", "created\n");
    let (exit, report) = cli(&temp, &["challenge", "work"]);
    assert_eq!(exit, 1, "{report}");
    assert!(
        report["assignment_blockers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "evidence-superseded")
    );
}

#[test]
fn tracked_directory_changes_supersede_successful_evidence() {
    let temp = fixture();
    write(temp.path(), "deps/value.txt", "old\n");
    assert_eq!(open(&temp, &["--input", "deps"]).0, 0);
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    success(
        &temp,
        &[
            "task", "evidence", "work", "--exit", "0", "--tool", "portable",
        ],
    );
    success(&temp, &["challenge", "work"]);
    std::fs::remove_file(temp.path().join("deps/value.txt")).unwrap();
    assert_eq!(cli(&temp, &["challenge", "work"]).0, 1);
    assert_eq!(cli(&temp, &["task", "ready", "work"]).0, 2);
}

#[test]
fn legacy_invalid_declarations_cannot_gain_evidence_handback_or_close_credit() {
    for (path, deliverable) in [
        (".blabla/scratch/value.txt", false),
        ("src/../tracked.txt", false),
        ("../external.txt", false),
        (".blabla/scratch/value.txt", true),
        ("ignored/value.txt", false),
    ] {
        let temp = fixture();
        let mut work = legacy(&temp, path, deliverable);
        let original_evidence = serde_json::to_value(&work.evidence).unwrap();
        let (exit, report) = cli(&temp, &["challenge", "work"]);
        assert_eq!(exit, 1, "{path}: {report}");
        assert_eq!(report["assignment_clear"], false);
        assert!(
            report["assignment_blockers"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == "unobservable-task-input")
        );
        assert_eq!(
            cli(
                &temp,
                &["task", "evidence", "work", "--exit", "0", "--tool", "retry"]
            )
            .0,
            2
        );
        assert_eq!(cli(&temp, &["task", "ready", "work"]).0, 2);
        work.state = "ready".into();
        task::write(temp.path(), &work).unwrap();
        assert_eq!(
            cli(&temp, &["task", "close", "work", "--model", "owner"]).0,
            2
        );
        let preserved = task::read(temp.path(), "work").unwrap().unwrap();
        assert_eq!(
            serde_json::to_value(preserved.evidence).unwrap(),
            original_evidence
        );
    }
}

#[test]
fn legacy_check_correction_preserves_history_and_requires_new_evidence() {
    let temp = fixture();
    let work = legacy(&temp, ".blabla/scratch/value.txt", false);
    success(
        &temp,
        &["task", "check", "work", "portable check", "--input", "src"],
    );
    assert_eq!(cli(&temp, &["task", "ready", "work"]).0, 2);
    let corrected = task::read(temp.path(), "work").unwrap().unwrap();
    assert_eq!(corrected.evidence.len(), work.evidence.len());
    success(
        &temp,
        &[
            "task",
            "evidence",
            "work",
            "--exit",
            "0",
            "--tool",
            "corrected",
        ],
    );
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
}

#[test]
fn an_input_newly_ignored_after_handback_blocks_live_credit() {
    let temp = fixture();
    write(temp.path(), "deps/value.txt", "dependency\n");
    assert_eq!(open(&temp, &["--input", "deps"]).0, 0);
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    success(
        &temp,
        &[
            "task", "evidence", "work", "--exit", "0", "--tool", "portable",
        ],
    );
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
    let manifest = std::fs::read_to_string(temp.path().join("project.bla")).unwrap();
    write(
        temp.path(),
        "project.bla",
        &(manifest + "ignore \"deps/\"\n"),
    );
    let (exit, report) = cli(&temp, &["challenge", "work"]);
    assert_eq!(exit, 1, "{report}");
    assert!(
        report["assignment_blockers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "unobservable-task-input")
    );
    assert_eq!(
        cli(&temp, &["task", "close", "work", "--model", "owner"]).0,
        2
    );
}

#[test]
fn a_review_of_unchanged_legacy_invalid_inputs_is_never_current_approval() {
    let temp = fixture();
    legacy(&temp, ".blabla/scratch/value.txt", false);
    success(
        &temp,
        &[
            "task",
            "open",
            "review",
            "--role",
            "worker",
            "--statement",
            "legacy review",
            "--scope",
            "tests",
            "--input",
            "src",
            "--review-of",
            "work",
            "--check",
            "portable check",
        ],
    );
    success(&temp, &["task", "accept", "review", "--model", "worker"]);
    let mut review = task::read(temp.path(), "review").unwrap().unwrap();
    review.state = "closed".into();
    task::write(temp.path(), &review).unwrap();
    let view = success(&temp, &["task", "show", "review"]);
    assert_eq!(view["review_current"], false);
    assert_eq!(view["approval_current"], false);
}

#[cfg(unix)]
#[test]
fn symlink_inputs_are_refused_and_replacement_invalidates_existing_credit() {
    let temp = fixture();
    let outside = TempDir::new().unwrap();
    write(outside.path(), "value.txt", "external\n");
    std::os::unix::fs::symlink(outside.path(), temp.path().join("alias")).unwrap();
    assert_eq!(open(&temp, &["--input", "alias/value.txt"]).0, 2);
    write(temp.path(), "deps/value.txt", "old\n");
    assert_eq!(open(&temp, &["--input", "deps/value.txt"]).0, 0);
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    success(
        &temp,
        &[
            "task", "evidence", "work", "--exit", "0", "--tool", "portable",
        ],
    );
    std::fs::remove_file(temp.path().join("deps/value.txt")).unwrap();
    std::os::unix::fs::symlink(
        outside.path().join("value.txt"),
        temp.path().join("deps/value.txt"),
    )
    .unwrap();
    let (_, report) = cli(&temp, &["challenge", "work"]);
    assert!(
        report["assignment_blockers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "unobservable-task-input")
    );
}

#[test]
fn ordinary_absent_in_root_inputs_gain_credit_and_stale_when_created() {
    let temp = fixture();
    assert_eq!(
        open(&temp, &["--scope", "future", "--input", "future/value.txt"]).0,
        0
    );
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    let recorded = success(
        &temp,
        &[
            "task", "evidence", "work", "--exit", "0", "--tool", "portable",
        ],
    );
    assert!(recorded["task"]["evidence"][0]["inputs"]["future/value.txt"].is_null());
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
    write(temp.path(), "future/value.txt", "created\n");
    let (exit, report) = cli(&temp, &["challenge", "work"]);
    assert_eq!(exit, 1, "{report}");
    assert!(
        report["assignment_blockers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "evidence-superseded")
    );
}

#[test]
fn a_tracked_file_with_a_skipped_directory_name_is_observable() {
    let temp = fixture();
    write(temp.path(), "target", "ordinary file\n");
    assert_eq!(open(&temp, &["--input", "target"]).0, 0);
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    let recorded = success(
        &temp,
        &[
            "task", "evidence", "work", "--exit", "0", "--tool", "portable",
        ],
    );
    assert!(recorded["task"]["evidence"][0]["inputs"]["target"].is_string());
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
}

#[test]
fn a_legacy_invalid_argv_check_is_refused_before_execution() {
    let temp = fixture();
    let mut work = legacy(&temp, ".blabla/scratch/value.txt", false);
    work.check = None;
    work.check_argv = Some(vec![
        env!("CARGO_BIN_EXE_blabla").into(),
        "--version".into(),
    ]);
    task::write(temp.path(), &work).unwrap();
    let original = std::fs::read(temp.path().join(".blabla/tasks/work.json")).unwrap();
    let (exit, report) = cli(&temp, &["task", "evidence", "work", "--run"]);
    assert_eq!(exit, 2, "{report}");
    assert_eq!(
        std::fs::read(temp.path().join(".blabla/tasks/work.json")).unwrap(),
        original
    );
    assert!(!temp.path().join(".blabla/scratch/work").exists());
}

#[test]
fn expert_packets_keep_invalid_legacy_attempts_without_current_observed_credit() {
    use blabla::expert::packet::ContextValue;
    use blabla::expert::{
        CheckpointKind, ContextSlot, ExpertLimits, HostCapabilities, ObservedEvent,
    };
    use blabla::memory::{self, process};
    let temp = fixture();
    let knowledge = "knowledge \"review\" { purpose \"Review evidence\" }\nruling \"support\" { pack \"review\" statement \"Only observed inputs support claims\" }\njudgment \"support\" { pack \"review\" purpose \"Check evidence\" requires [\"evidence\"] optional [\"task\", \"attempts\"] question \"Is the check current?\" criteria \"Unobservable inputs give no credit\" output \"noul\" proposition \"The check is current\" templates [\"cite-evidence\"] }\n";
    write(temp.path(), "knowledge.bla", knowledge);
    let manifest = std::fs::read_to_string(temp.path().join("project.bla")).unwrap();
    write(
        temp.path(),
        "project.bla",
        &(manifest + "knowledge \"knowledge.bla\"\n"),
    );
    let process_source = std::fs::read_to_string(temp.path().join("process.bla")).unwrap()
        + "binding \"support\" { judgment \"judgment::review::support\" roles [\"worker\"] checkpoints [\"tool-result\"] rules [\"ruling::review::support\"] candidates [\"knowledge::review\", \"ruling::review::support\"] }\n";
    write(temp.path(), "process.bla", &process_source);
    let mut work = legacy(&temp, ".blabla/scratch/value.txt", false);
    work.check = None;
    work.check_argv = Some(vec!["verify".into()]);
    let identity = task::declared_check(&work);
    let entry = work.evidence.last_mut().unwrap();
    entry.identity = identity;
    entry.command = Some(vec!["verify".into()]);
    entry.check = "verify".into();
    entry.tool = "run".into();
    task::write(temp.path(), &work).unwrap();
    let project =
        project::load(project::read_manifest(&temp.path().join("project.bla")).unwrap()).unwrap();
    let binding = process::build(&memory::syntax::parse("process.bla", &process_source).unwrap())
        .unwrap()
        .bindings
        .remove(0);
    let event = ObservedEvent {
        event_id: "event-1".into(),
        run_id: "run-1".into(),
        task: "task::work".into(),
        checkpoint_id: "checkpoint-1".into(),
        sequence: 1,
        previous_sequence: None,
        unix_ms: 1,
        kind: CheckpointKind::ToolResult,
        host: HostCapabilities {
            host: "fixture".into(),
            version: "1".into(),
            adapter: "fixture".into(),
            checkpoints: vec![CheckpointKind::ToolResult],
            pauses_worker: false,
            same_task_delivery: false,
            delivery_receipts: false,
            pre_tool_control: false,
            gaps: vec![],
        },
        observations: vec![],
    };
    let packet = project::expert::build_packet(
        &project,
        &work,
        &event,
        &binding,
        &ExpertLimits::default(),
        &[],
    )
    .unwrap();
    assert!(!matches!(
        packet.context.get(&ContextSlot::Evidence),
        Some(ContextValue::Present { .. })
    ));
    let Some(ContextValue::Present { observations }) = packet.context.get(&ContextSlot::Attempts)
    else {
        panic!("legacy attempt history missing: {:?}", packet.context);
    };
    assert_eq!(observations.len(), 1);
    assert!(observations[0].fact.is_none());
    assert_eq!(
        serde_json::from_str::<Value>(&observations[0].text).unwrap()["current"],
        false
    );
    let Some(ContextValue::Present { observations }) = packet.context.get(&ContextSlot::Task)
    else {
        panic!("task observations missing");
    };
    let selected: Value = serde_json::from_str(&observations[0].text).unwrap();
    assert_eq!(selected["readiness"]["current"], false);
    assert_eq!(selected["successful_current_check"], false);
    assert_eq!(
        task::read(temp.path(), "work")
            .unwrap()
            .unwrap()
            .evidence
            .len(),
        1
    );
}

#[test]
fn implicit_evidence_inputs_cannot_restore_unobservable_scope_defaults() {
    let temp = fixture();
    let (exit, report) = cli(
        &temp,
        &[
            "task",
            "open",
            "work",
            "--role",
            "worker",
            "--statement",
            "scratch work",
            "--scope",
            ".blabla/scratch/work",
            "--check",
            "portable check",
        ],
    );
    assert_eq!(exit, 2, "{report}");
    assert!(task::read(temp.path(), "work").unwrap().is_none());
    let (exit, report) = cli(
        &temp,
        &[
            "task",
            "open",
            "work",
            "--role",
            "worker",
            "--statement",
            "scratch work with tracked dependencies",
            "--scope",
            ".blabla/scratch/work",
            "--input",
            "src",
            "--check",
            "portable check",
        ],
    );
    assert_eq!(exit, 0, "{report}");
    let before = std::fs::read(temp.path().join(".blabla/tasks/work.json")).unwrap();
    assert_eq!(
        cli(&temp, &["task", "check", "work", "portable check"]).0,
        2
    );
    assert_eq!(
        std::fs::read(temp.path().join(".blabla/tasks/work.json")).unwrap(),
        before
    );
}

#[test]
fn legacy_invalid_closed_successors_cannot_clear_withdrawal_residue() {
    let temp = fixture();
    let project =
        project::load(project::read_manifest(&temp.path().join("project.bla")).unwrap()).unwrap();
    let mut old = task::record(
        temp.path(),
        &project.ignore,
        task::Opening {
            name: "old".into(),
            role: "worker".into(),
            statement: "withdrawn work".into(),
            scope: vec!["src".into()],
            ..Default::default()
        },
        1,
    );
    write(temp.path(), "src/app.rs", "pub fn run() { let _ = 1; }\n");
    let tree = project::snapshot(temp.path(), &project.ignore);
    task::withdraw(&mut old, &tree, "superseded", "owner", 2).unwrap();
    let mut successor = legacy(&temp, ".blabla/scratch/value.txt", false);
    successor.check_inputs.push("src/app.rs".into());
    let inputs = task::evidence_inputs(&successor, &tree);
    successor.evidence.last_mut().unwrap().inputs = inputs;
    assert!(task::record_challenge(&mut successor, &tree, 0, 5));
    successor.state = "ready".into();
    assert!(task::accept_result(&mut successor, &tree, 0, "owner", 6));
    old.withdrawal
        .as_mut()
        .unwrap()
        .reconciliations
        .push(task::WithdrawalReconciliation {
            path: "src/app.rs".into(),
            successor: successor.name.clone(),
            model: "owner".into(),
            unix: 7,
            revision: task::successor_revision(&successor, &tree, "src/app.rs"),
        });
    assert!(task::withdrawal_residue(&old, &[successor.clone()], &tree).is_empty());
    assert_eq!(
        task::tracked_withdrawal_residue(&old, &[successor], &tree, temp.path(), &project.ignore),
        ["src/app.rs"]
    );
}

#[cfg(windows)]
#[test]
fn windows_mixed_case_tracked_inputs_expand_and_track_future_creation() {
    let temp = fixture();
    write(temp.path(), "src/Foo.rs", "pub fn foo() {}\n");
    assert_eq!(
        open(
            &temp,
            &[
                "--scope",
                "future",
                "--input",
                "SRC/FOO.RS",
                "--input",
                "Future/New.txt",
                "--deliverable",
                "SRC"
            ]
        )
        .0,
        0
    );
    let view = success(&temp, &["task", "show", "work"]);
    assert_eq!(
        view["task"]["check_inputs"],
        serde_json::json!(["src/foo.rs", "future/new.txt"])
    );
    assert!(
        view["task"]["deliverables"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["path"] == "src/foo.rs")
    );
    write(temp.path(), "src/Foo.rs", "pub fn foo() { let _ = 1; }\n");
    write(temp.path(), "src/app.rs", "pub fn run() { let _ = 1; }\n");
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    let evidence = success(
        &temp,
        &[
            "task", "evidence", "work", "--exit", "0", "--tool", "portable",
        ],
    );
    assert!(evidence["task"]["evidence"][0]["inputs"]["src/foo.rs"].is_string());
    assert!(evidence["task"]["evidence"][0]["inputs"]["future/new.txt"].is_null());
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
    write(temp.path(), "Future/New.txt", "created\n");
    assert_eq!(cli(&temp, &["challenge", "work"]).0, 1);
}

#[cfg(windows)]
#[test]
fn windows_mixed_case_ignores_and_added_directory_deliverables_share_identity() {
    let temp = fixture();
    write(temp.path(), "Deps/value.txt", "ignored\n");
    let manifest = std::fs::read_to_string(temp.path().join("project.bla")).unwrap();
    write(
        temp.path(),
        "project.bla",
        &(manifest + "ignore \"Deps/\"\n"),
    );
    for path in ["Deps", "deps", "DEPS/value.txt"] {
        assert_eq!(open(&temp, &["--input", path]).0, 2, "{path}");
    }
    write(temp.path(), "src/Foo.rs", "pub fn foo() {}\n");
    assert_eq!(open(&temp, &["--input", "src"]).0, 0);
    let view = success(&temp, &["task", "deliverable", "work", "--add", "SRC"]);
    assert!(
        view["task"]["deliverables"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["path"] == "src/foo.rs")
    );
    let work = task::read(temp.path(), "work").unwrap().unwrap();
    assert!(work.deliverables.iter().any(|d| d.path == "src/foo.rs"));
    let project =
        project::load(project::read_manifest(&temp.path().join("project.bla")).unwrap()).unwrap();
    assert!(task::tracking_error(&work, temp.path(), &project.ignore).is_none());
}
