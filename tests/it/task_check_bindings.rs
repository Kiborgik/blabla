use blabla::project::{self, task};
use serde_json::{Value, json};
use tempfile::TempDir;

use crate::support::{self, write};

const INPUTS: &[&str] = &["a.txt", "b.txt", "c.txt", "d.txt"];

fn cli(temp: &TempDir, arguments: &[&str]) -> (i32, Value) {
    support::cli_json(temp.path(), arguments)
}

fn success(temp: &TempDir, args: &[&str]) -> Value {
    let (exit, value) = cli(temp, args);
    assert_eq!(exit, 0, "{args:?}: {value}");
    value
}

fn record(temp: &TempDir) -> task::Task {
    task::read(temp.path(), "work").unwrap().unwrap()
}

fn current(temp: &TempDir) -> bool {
    let project =
        project::load(project::read_manifest(&temp.path().join("project.bla")).unwrap()).unwrap();
    task::tracked_readiness(
        &record(temp),
        temp.path(),
        &project.ignore,
        &project::snapshot(temp.path(), &project.ignore),
    )
    .supported
}

fn executions(temp: &TempDir) -> String {
    std::fs::read_to_string(temp.path().join(".blabla/scratch/check-count")).unwrap()
}

fn refused_unchanged(temp: &TempDir, args: &[&str]) -> Value {
    let before = support::tree_snapshot(temp.path());
    let (exit, value) = cli(temp, args);
    assert_eq!(exit, 2, "{args:?}: {value}");
    assert_eq!(
        support::tree_snapshot(temp.path()),
        before,
        "refusal wrote files: {args:?}"
    );
    value
}

fn history_unchanged(temp: &TempDir, before: &task::Task) {
    let after = record(temp);
    assert_eq!(after.acceptance_epoch, before.acceptance_epoch);
    assert_eq!(after.accepted.as_ref().unwrap().model, "worker");
    assert_eq!(
        serde_json::to_value(&after.evidence).unwrap(),
        serde_json::to_value(&before.evidence).unwrap()
    );
    assert_eq!(executions(temp), "1");
}

fn fixture(scope: &[&str], inputs: &[&str], deliverable: bool) -> TempDir {
    let temp = TempDir::new().unwrap();
    write(
        temp.path(),
        "project.bla",
        "project Bindings\nuse structure \"entry.bla\"\nprocess \"process.bla\"\nignore \"ignored/\"\n",
    );
    write(
        temp.path(),
        "entry.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(temp.path(), "src/app.rs", "pub fn run() {}\n");
    write(
        temp.path(),
        "process.bla",
        "role \"orchestrator\" { purpose \"assign\" model \"owner\" }\nrole \"worker\" { purpose \"carry\" model \"worker\" }\n",
    );
    for path in INPUTS {
        write(temp.path(), path, path);
    }
    write(temp.path(), "result.txt", "deliverable\n");
    write(
        temp.path(),
        "check.py",
        "from pathlib import Path\nimport sys\np = Path('.blabla/scratch/check-count')\np.parent.mkdir(parents=True, exist_ok=True)\np.write_text(str(int(p.read_text()) + 1 if p.exists() else 1))\nfor name in sys.argv[1:]:\n    Path(name).read_text()\n",
    );
    let mut args = vec![
        "task",
        "open",
        "work",
        "--role",
        "worker",
        "--statement",
        "Synthetic source-bound check fixture",
    ];
    if !scope.is_empty() {
        args.push("--scope");
        args.extend_from_slice(scope);
    }
    if !inputs.is_empty() {
        args.push("--input");
        args.extend_from_slice(inputs);
    }
    if deliverable {
        args.extend_from_slice(&["--deliverable", "result.txt"]);
    }
    args.extend_from_slice(&["--check", "python", "check.py"]);
    args.extend_from_slice(INPUTS);
    success(&temp, &args);
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    success(&temp, &["task", "evidence", "work", "--run"]);
    assert_eq!(record(&temp).evidence.last().unwrap().exit, 0);
    assert!(current(&temp));
    temp
}

#[test]
fn bare_and_model_only_calls_preserve_four_bound_inputs_and_every_receipt() {
    let temp = fixture(&[], INPUTS, false);
    success(&temp, &["challenge", "work"]);
    assert!(record(&temp).scope.is_empty());
    assert_eq!(record(&temp).evidence.last().unwrap().inputs.len(), 4);
    for args in [
        vec!["task", "check", "work"],
        vec!["task", "check", "work", "--model", "owner"],
    ] {
        refused_unchanged(&temp, &args);
        assert!(current(&temp));
    }
    assert_eq!(record(&temp).check_inputs, INPUTS);
    assert_eq!(executions(&temp), "1");
    write(temp.path(), "d.txt", "changed after refused inspection");
    assert!(!current(&temp));
}

#[test]
fn command_amendments_preserve_explicit_inputs_and_do_not_relabel_prior_execution() {
    for amendment in [
        vec!["--check", "replacement"],
        vec!["--check", "python", "check.py", "a.txt"],
    ] {
        let temp = fixture(&[], INPUTS, false);
        let before = record(&temp);
        let mut args = vec!["task", "check", "work", "--model", "owner"];
        args.extend(amendment);
        success(&temp, &args);
        assert_eq!(record(&temp).check_inputs, INPUTS);
        history_unchanged(&temp, &before);
        assert!(!current(&temp));
    }
}

#[test]
fn scope_only_amendment_keeps_explicit_execution_binding_and_invalidates_challenge() {
    let temp = fixture(&[], INPUTS, false);
    success(&temp, &["challenge", "work"]);
    let before = record(&temp);
    assert!(before.challenged.is_some());
    success(
        &temp,
        &[
            "task",
            "check",
            "work",
            "--add-scope",
            "future.txt",
            "--model",
            "owner",
        ],
    );
    let after = record(&temp);
    assert_eq!(after.scope, ["future.txt"]);
    assert_eq!(after.check_inputs, INPUTS);
    assert_eq!(after.check, before.check);
    assert!(after.challenged.is_none());
    assert_eq!(
        after.orchestrator_records.last().unwrap().verb,
        "check --add-scope"
    );
    history_unchanged(&temp, &before);
    assert!(current(&temp));
}

#[test]
fn supplied_inputs_replace_the_whole_binding_and_exact_map_equality_still_matters() {
    let temp = fixture(&[], INPUTS, false);
    let before = record(&temp);
    success(
        &temp,
        &["task", "check", "work", "--input", "./a.txt", "b.txt"],
    );
    assert_eq!(record(&temp).check_inputs, ["a.txt", "b.txt"]);
    assert_eq!(record(&temp).check, before.check);
    history_unchanged(&temp, &before);
    assert!(!current(&temp));
    success(&temp, &["task", "evidence", "work", "--run"]);
    let after = record(&temp);
    assert_eq!(after.evidence.len(), 2);
    assert_eq!(after.evidence[0].inputs.len(), 4);
    assert_eq!(after.evidence[1].inputs.len(), 2);
    assert_eq!(executions(&temp), "2");
    assert!(current(&temp));
    write(temp.path(), "b.txt", "changed bound input");
    assert!(!current(&temp));
}

#[test]
fn explicit_reset_restores_scope_defaults_without_dropping_deliverables() {
    let temp = fixture(&["a.txt"], INPUTS, true);
    let before = record(&temp);
    assert_eq!(before.evidence[0].inputs.len(), 5);
    success(
        &temp,
        &[
            "task",
            "check",
            "work",
            "--reset-inputs",
            "--model",
            "owner",
        ],
    );
    assert!(record(&temp).check_inputs.is_empty());
    history_unchanged(&temp, &before);
    assert!(!current(&temp));
    success(&temp, &["task", "evidence", "work", "--run"]);
    let after = record(&temp);
    assert_eq!(
        after.evidence[1]
            .inputs
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["a.txt", "result.txt"]
    );
    assert!(current(&temp));
    write(temp.path(), "result.txt", "changed deliverable");
    assert!(!current(&temp));
}

#[test]
fn an_explicit_read_only_reset_is_distinct_from_the_refused_bare_amendment() {
    let temp = fixture(&[], INPUTS, false);
    let before = record(&temp);
    success(
        &temp,
        &[
            "task",
            "check",
            "work",
            "--reset-inputs",
            "--model",
            "owner",
        ],
    );
    let after = record(&temp);
    assert!(after.check_inputs.is_empty());
    assert!(task::declared_inputs(&after).is_empty());
    assert_eq!(after.check, before.check);
    assert_eq!(after.orchestrator_records.len(), 1);
    assert_eq!(
        after.orchestrator_records[0].model.as_deref(),
        Some("owner")
    );
    history_unchanged(&temp, &before);
    assert!(!current(&temp));
}

#[test]
fn omitted_inputs_keep_existing_scope_default_semantics() {
    let temp = fixture(&["a.txt"], &[], false);
    let before = record(&temp);
    success(&temp, &["task", "check", "work", "--add-scope", "b.txt"]);
    let after = record(&temp);
    assert!(after.check_inputs.is_empty());
    assert_eq!(after.scope, ["a.txt", "b.txt"]);
    assert_eq!(after.check, before.check);
    history_unchanged(&temp, &before);
    assert!(!current(&temp));
}

#[test]
fn input_reset_conflicts_are_refused_atomically_in_either_flag_order() {
    let temp = fixture(&[], INPUTS, false);
    for args in [
        vec![
            "task",
            "check",
            "work",
            "--reset-inputs",
            "--input",
            "a.txt",
        ],
        vec![
            "task",
            "check",
            "work",
            "--input",
            "a.txt",
            "--reset-inputs",
        ],
    ] {
        let report = refused_unchanged(&temp, &args);
        assert_eq!(report["category"], "invocation");
    }
}

#[test]
fn preserved_inputs_are_revalidated_and_invalid_combined_amendments_are_atomic() {
    let temp = fixture(&["a.txt"], INPUTS, false);
    let manifest = std::fs::read_to_string(temp.path().join("project.bla")).unwrap();
    write(
        temp.path(),
        "project.bla",
        &format!("{manifest}ignore \"b.txt\"\n"),
    );
    let before = record(&temp);
    let report = refused_unchanged(
        &temp,
        &[
            "task",
            "check",
            "work",
            "--add-scope",
            "future.txt",
            "--check",
            "replacement",
        ],
    );
    assert!(report["message"].as_str().unwrap().contains("b.txt"));
    refused_unchanged(
        &temp,
        &["task", "check", "work", "--input", "ignored/input.txt"],
    );
    success(&temp, &["task", "check", "work", "--reset-inputs"]);
    assert!(record(&temp).check_inputs.is_empty());
    assert_eq!(record(&temp).scope, ["a.txt"]);
    history_unchanged(&temp, &before);
}

#[test]
fn default_inputs_and_deliverables_are_validated_as_part_of_the_resulting_binding() {
    for (scope, deliverable, ignored) in [
        (vec!["a.txt"], false, "a.txt"),
        (vec!["a.txt"], true, "result.txt"),
    ] {
        let temp = fixture(&scope, INPUTS, deliverable);
        let manifest = std::fs::read_to_string(temp.path().join("project.bla")).unwrap();
        write(
            temp.path(),
            "project.bla",
            &format!("{manifest}ignore \"{ignored}\"\n"),
        );
        let report = refused_unchanged(&temp, &["task", "check", "work", "--reset-inputs"]);
        assert!(report["message"].as_str().unwrap().contains(ignored));
    }
}

#[test]
fn tracked_future_inputs_remain_admissible_and_their_creation_stales_the_receipt() {
    let temp = fixture(&[], INPUTS, false);
    success(
        &temp,
        &["task", "check", "work", "--input", "future/value.txt"],
    );
    assert_eq!(record(&temp).check_inputs, ["future/value.txt"]);
    assert!(!current(&temp));
    assert_eq!(executions(&temp), "1");
    success(&temp, &["task", "evidence", "work", "--run"]);
    assert_eq!(record(&temp).evidence[1].inputs["future/value.txt"], None);
    assert!(current(&temp));
    write(temp.path(), "future/value.txt", "now exists");
    assert!(!current(&temp));
}

#[test]
fn explicitly_repeated_identical_amendments_remain_attested_without_execution() {
    let temp = fixture(&["a.txt"], INPUTS, false);
    success(&temp, &["challenge", "work"]);
    let before = record(&temp);
    for _ in 0..2 {
        success(
            &temp,
            &[
                "task",
                "check",
                "work",
                "--model",
                "owner",
                "--add-scope",
                "a.txt",
                "--input",
                "a.txt",
                "b.txt",
                "c.txt",
                "d.txt",
                "--check",
                "python",
                "check.py",
                "a.txt",
                "b.txt",
                "c.txt",
                "d.txt",
            ],
        );
    }
    let after = record(&temp);
    assert_eq!(after.scope, before.scope);
    assert_eq!(after.check_inputs, before.check_inputs);
    assert_eq!(after.check, before.check);
    assert_eq!(after.orchestrator_records.len(), 2);
    assert!(
        after
            .orchestrator_records
            .iter()
            .all(|r| r.model.as_deref() == Some("owner") && r.unconfirmed())
    );
    assert!(after.challenged.is_none());
    history_unchanged(&temp, &before);
    assert!(current(&temp));
}

#[test]
fn reset_after_argv_is_preserved_as_a_command_argument_and_reported_not_applied() {
    let temp = fixture(&[], INPUTS, false);
    let before = record(&temp);
    let report = success(
        &temp,
        &[
            "task",
            "check",
            "work",
            "--check",
            "python",
            "check.py",
            "--reset-inputs",
        ],
    );
    assert_eq!(record(&temp).check_inputs, INPUTS);
    assert_eq!(
        record(&temp).check,
        Some(vec![
            "python".into(),
            "check.py".into(),
            "--reset-inputs".into()
        ])
    );
    assert_eq!(report["swallowed_check_argv"], json!(["--reset-inputs"]));
    history_unchanged(&temp, &before);
    assert!(!current(&temp));
}
