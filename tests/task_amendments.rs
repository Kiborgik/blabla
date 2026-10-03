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
        "project Amendment\nuse structure \"architecture.bla\"\nprocess \"process.bla\"\nignore \"ignored/\"\n",
    );
    write(
        temp.path(),
        "architecture.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(temp.path(), "src/app.rs", "pub fn run() {}\n");
    write(
        temp.path(),
        "tests/check.py",
        "from pathlib import Path\nimport sys\nassert 'pub fn run()' in Path('src/app.rs').read_text()\nif len(sys.argv) > 1:\n    assert Path('src/extra.rs').read_text() == 'pub fn extra() {}\\n'\n",
    );
    write(
        temp.path(),
        "process.bla",
        "role \"orchestrator\" { purpose \"assign\" model \"owner\" }\nrole \"worker\" { purpose \"carry\" model \"worker\" }\nrole \"reviewer\" { purpose \"review\" model \"reviewer\" }\n",
    );
    success(
        &temp,
        &[
            "task",
            "open",
            "work",
            "--role",
            "worker",
            "--statement",
            "extend a bounded slice",
            "--scope",
            "src/app.rs",
            "--input",
            "src/app.rs",
            "tests/check.py",
            "--check-argv",
            "python",
            "tests/check.py",
        ],
    );
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    temp
}

fn invoke(temp: &TempDir, arguments: &[&str]) -> std::process::Output {
    let mut all = vec!["--json"];
    all.extend_from_slice(arguments);
    support::run_in(Some(temp.path()), &support::args(&all))
}

fn success(temp: &TempDir, arguments: &[&str]) -> Value {
    let output = invoke(temp, arguments);
    assert!(
        output.status.success(),
        "{arguments:?}: stdout {} stderr {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn record(temp: &TempDir) -> task::Task {
    task::read(temp.path(), "work").unwrap().unwrap()
}

fn tree(temp: &TempDir) -> std::collections::BTreeMap<String, String> {
    let project =
        project::load(project::read_manifest(&temp.path().join("project.bla")).unwrap()).unwrap();
    project::snapshot(temp.path(), &project.ignore)
}

#[test]
fn combined_amendment_captures_real_evidence_and_requires_one_handback_confirmation() {
    let temp = fixture();
    success(&temp, &["task", "evidence", "work", "--run"]);
    success(&temp, &["challenge", "work"]);
    let before = record(&temp);
    assert!(task::readiness(&before, &tree(&temp)).supported);
    success(
        &temp,
        &[
            "task",
            "check",
            "work",
            "--add-scope",
            "./src/extra.rs",
            "--model",
            "owner",
            "--input",
            "src/app.rs",
            "src/extra.rs",
            "tests/check.py",
            "--argv",
            "python",
            "tests/check.py",
            "amended",
        ],
    );
    let amended = record(&temp);
    assert_eq!(amended.scope, ["src/app.rs", "src/extra.rs"]);
    assert_eq!(
        amended.check_inputs,
        ["src/app.rs", "src/extra.rs", "tests/check.py"]
    );
    assert_eq!(amended.acceptance_epoch, before.acceptance_epoch);
    assert_eq!(amended.accepted.unwrap().model, "worker");
    assert_eq!(amended.evidence.len(), 1);
    assert!(amended.challenged.is_none());
    assert!(!task::readiness(&record(&temp), &tree(&temp)).supported);
    assert_eq!(amended.orchestrator_records.len(), 1);
    let attribution = &amended.orchestrator_records[0];
    assert_eq!(attribution.verb, "check --add-scope");
    assert_eq!(attribution.model.as_deref(), Some("owner"));
    assert_eq!(attribution.carried_by.as_deref(), Some("worker"));
    assert!(attribution.confirmed.is_none());
    assert_eq!(
        invoke(&temp, &["task", "confirm", "work", "--model", "owner"])
            .status
            .code(),
        Some(2)
    );
    assert_eq!(
        invoke(&temp, &["task", "ready", "work"]).status.code(),
        Some(2)
    );
    write(temp.path(), "src/extra.rs", "pub fn extra() {}\n");
    success(&temp, &["task", "evidence", "work", "--run"]);
    let checked = record(&temp);
    let evidence = checked.evidence.last().unwrap();
    assert_eq!(evidence.command.as_ref(), checked.check_argv.as_ref());
    assert_eq!(evidence.acceptance_epoch, Some(before.acceptance_epoch));
    assert!(evidence.log.is_some());
    assert!(task::readiness(&checked, &tree(&temp)).supported);
    success(&temp, &["challenge", "work"]);
    success(&temp, &["task", "ready", "work"]);
    assert_eq!(
        invoke(&temp, &["task", "close", "work", "--model", "owner"])
            .status
            .code(),
        Some(2)
    );
    success(&temp, &["task", "confirm", "work", "--model", "owner"]);
    success(&temp, &["task", "close", "work", "--model", "owner"]);
    assert_eq!(record(&temp).state, "closed");
    assert!(record(&temp).result.is_some());
}

#[test]
fn invalid_combined_amendments_leave_the_entire_task_record_unchanged() {
    let temp = fixture();
    success(
        &temp,
        &[
            "task",
            "open",
            "other",
            "--role",
            "worker",
            "--statement",
            "separate owner",
            "--scope",
            "owned",
        ],
    );
    let path = temp.path().join(".blabla/tasks/work.json");
    let before = std::fs::read(&path).unwrap();
    for arguments in [
        vec!["--add-scope", "safe", "owned/file.rs", "--model", "owner"],
        vec!["--add-scope", "safe", "../external", "--model", "owner"],
        vec!["--add-scope", "safe", "--model", "worker"],
        vec![
            "--add-scope",
            "safe",
            "--model",
            "owner",
            "--input",
            "ignored/check.py",
        ],
        vec!["--add-scope", "ignored", "--model", "owner"],
    ] {
        let mut command = vec!["task", "check", "work", "replacement"];
        command.extend(arguments);
        let output = invoke(&temp, &command);
        assert_eq!(output.status.code(), Some(2), "{command:?}");
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["category"], "task", "{command:?}: {report}");
        assert_eq!(std::fs::read(&path).unwrap(), before, "{command:?}");
    }
}

#[test]
fn explicit_scope_and_check_models_are_validated_without_relabeling_the_carrier() {
    let temp = fixture();
    let path = temp.path().join(".blabla/tasks/work.json");
    let before = std::fs::read(&path).unwrap();
    assert_eq!(
        invoke(
            &temp,
            &[
                "task", "scope", "work", "--add", "tests", "--model", "worker"
            ]
        )
        .status
        .code(),
        Some(2)
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);
    success(
        &temp,
        &[
            "task", "scope", "work", "--add", "tests", "--model", "owner",
        ],
    );
    success(
        &temp,
        &["task", "check", "work", "replacement", "--model", "owner"],
    );
    let work = record(&temp);
    assert_eq!(work.accepted.unwrap().model, "worker");
    assert_eq!(work.orchestrator_records.len(), 2);
    for record in work.orchestrator_records {
        assert_eq!(record.model.as_deref(), Some("owner"));
        assert_eq!(record.carried_by.as_deref(), Some("worker"));
        assert!(record.confirmed.is_none());
    }
}

#[test]
fn combined_amendment_stales_bound_review_and_reacceptance_still_stales_evidence() {
    let temp = fixture();
    success(
        &temp,
        &[
            "task",
            "open",
            "review",
            "--role",
            "reviewer",
            "--statement",
            "inspect work",
            "--review-of",
            "work",
            "--check",
            "review",
        ],
    );
    success(&temp, &["task", "accept", "review", "--model", "reviewer"]);
    assert_eq!(
        success(&temp, &["task", "show", "review"])["review_current"],
        true
    );
    success(
        &temp,
        &[
            "task",
            "check",
            "work",
            "--add-scope",
            "src/extra.rs",
            "--model",
            "owner",
            "--argv",
            "python",
            "tests/check.py",
        ],
    );
    assert_eq!(
        success(&temp, &["task", "show", "review"])["review_current"],
        false
    );
    assert!(record(&temp).check_inputs.is_empty());
    success(&temp, &["task", "evidence", "work", "--run"]);
    assert!(task::readiness(&record(&temp), &tree(&temp)).supported);
    let epoch = record(&temp).acceptance_epoch;
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    assert!(record(&temp).acceptance_epoch > epoch);
    assert!(!task::readiness(&record(&temp), &tree(&temp)).supported);
}

#[test]
fn legacy_scope_and_check_commands_keep_their_unattributed_history() {
    let temp = fixture();
    success(&temp, &["task", "scope", "work", "--add", "tests"]);
    success(&temp, &["task", "check", "work", "replacement"]);
    let work = record(&temp);
    assert_eq!(work.scope, ["src/app.rs", "tests"]);
    assert_eq!(work.check.as_deref(), Some("replacement"));
    assert!(work.check_argv.is_none());
    assert!(work.check_inputs.is_empty());
    assert!(
        work.orchestrator_records
            .iter()
            .all(|record| record.model.is_none() && record.unconfirmed())
    );
}
