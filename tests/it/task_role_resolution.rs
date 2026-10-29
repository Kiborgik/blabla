use blabla::project::task;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use tempfile::TempDir;

use crate::support;

fn cli(temp: &TempDir, arguments: &[&str]) -> (i32, Value) {
    support::cli_json(temp.path(), arguments)
}

fn success(temp: &TempDir, arguments: &[&str]) -> Value {
    let (exit, value) = cli(temp, arguments);
    assert_eq!(exit, 0, "{arguments:?}: {value}");
    value
}

fn fixture(process: Option<&str>) -> TempDir {
    let temp = TempDir::new().unwrap();
    let registration = if process.is_some() {
        "process \"process.bla\"\n"
    } else {
        ""
    };
    std::fs::write(temp.path().join("project.bla"), format!("project Roles\n{registration}use structure \"entry.bla\"\nknowledge \"knowledge.bla\"\n")).unwrap();
    std::fs::write(
        temp.path().join("entry.bla"),
        "module app \"app.rs\"\nrequire \"entry\": symbol app::run\n",
    )
    .unwrap();
    std::fs::write(temp.path().join("app.rs"), "pub fn run() {}\n").unwrap();
    std::fs::write(temp.path().join("knowledge.bla"), "knowledge \"testing\" { purpose \"Check behavior\" }\nruling \"observe\" { pack \"testing\" statement \"Read evidence\" }\n").unwrap();
    if let Some(process) = process {
        std::fs::write(temp.path().join("process.bla"), process).unwrap();
    }
    temp
}

fn configured() -> TempDir {
    fixture(Some(
        "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"allowed\" consult [\"testing\"] }\nrole \"reviewer\" { purpose \"Review\" model \"review-model\" consult [\"testing\"] }\n",
    ))
}

fn tree(root: &Path) -> BTreeMap<String, Option<Vec<u8>>> {
    fn walk(root: &Path, here: &Path, result: &mut BTreeMap<String, Option<Vec<u8>>>) {
        for entry in std::fs::read_dir(here).unwrap() {
            let path = entry.unwrap().path();
            let key = path.strip_prefix(root).unwrap().display().to_string();
            if path.is_dir() {
                result.insert(key, None);
                walk(root, &path, result);
            } else {
                result.insert(key, Some(std::fs::read(path).unwrap()));
            }
        }
    }
    let mut result = BTreeMap::new();
    walk(root, root, &mut result);
    result
}

fn open(temp: &TempDir, name: &str, role: &str, extra: &[&str]) -> (i32, Value) {
    let mut args = vec![
        "task",
        "open",
        name,
        "--role",
        role,
        "--statement",
        "Exercise role resolution",
        "--scope",
        "app.rs",
    ];
    args.extend(extra);
    cli(temp, &args)
}

fn refused_without_writes(temp: &TempDir, role: &str) -> Value {
    let before = tree(temp.path());
    let (exit, value) = open(temp, "unknown", role, &["--falsify", "app.rs"]);
    assert_eq!(exit, 2, "{value}");
    assert_eq!(value["category"], "task", "{value}");
    assert_eq!(tree(temp.path()), before);
    assert!(task::read(temp.path(), "unknown").unwrap().is_none());
    value
}

#[test]
fn unknown_configured_role_refuses_before_creating_store_or_falsification_copy() {
    let temp = configured();
    let value = refused_without_writes(&temp, "core-engine");
    let message = value["message"].as_str().unwrap();
    assert!(
        message.contains("core-engine") && message.contains("worker"),
        "{value}"
    );
}

#[test]
fn unknown_reviewer_role_does_not_modify_existing_task_records() {
    let temp = configured();
    success(
        &temp,
        &[
            "task",
            "open",
            "existing",
            "--role",
            "worker",
            "--statement",
            "Existing separate work",
            "--scope",
            "other.rs",
        ],
    );
    refused_without_writes(&temp, "independent-reviewer");
}

#[test]
fn role_matching_is_exact_without_implicit_aliases_or_normalization() {
    for role in ["Worker", "worker ", "role::worker", ""] {
        refused_without_writes(&configured(), role);
    }
}

#[test]
fn a_single_declared_role_already_requires_registered_names() {
    let temp = fixture(Some("role \"orchestrator\" { purpose \"Assign\" }\n"));
    refused_without_writes(&temp, "worker");
}

#[test]
fn registered_worker_keeps_model_challenge_and_consulted_lens_obligations() {
    let temp = configured();
    assert_eq!(open(&temp, "work", "worker", &[]).0, 0);
    success(&temp, &["task", "accept", "work", "--model", "outside"]);
    let (_, challenge) = cli(&temp, &["challenge", "work"]);
    let grounded = challenge["grounded"].as_array().unwrap();
    assert!(
        grounded.contains(&Value::from("model-outside-role-policy")),
        "{challenge}"
    );
    assert!(
        grounded.contains(&Value::from("lens-unassessed")),
        "{challenge}"
    );
    success(&temp, &["task", "accept", "work", "--model", "allowed"]);
    success(
        &temp,
        &[
            "task",
            "lens",
            "work",
            "testing",
            "Observed the focused checks",
        ],
    );
    let (_, challenge) = cli(&temp, &["challenge", "work"]);
    let grounded = challenge["grounded"].as_array().unwrap();
    assert!(
        !grounded.contains(&Value::from("model-outside-role-policy")),
        "{challenge}"
    );
    assert!(
        !grounded.contains(&Value::from("lens-unassessed")),
        "{challenge}"
    );
}

#[test]
fn registered_reviewer_and_named_lens_remain_usable() {
    let temp = configured();
    assert_eq!(
        open(&temp, "review", "reviewer", &["--lens", "testing"]).0,
        0
    );
    success(
        &temp,
        &["task", "accept", "review", "--model", "review-model"],
    );
    success(
        &temp,
        &["task", "lens", "review", "testing", "Read the evidence"],
    );
    let record = task::read(temp.path(), "review").unwrap().unwrap();
    assert_eq!(record.role, "reviewer");
    assert_eq!(record.lenses, ["testing"]);
    assert_eq!(record.assessments.len(), 1);
}

#[test]
fn an_unconsulted_named_lens_is_still_refused_without_task_records() {
    let temp = configured();
    let (exit, value) = open(&temp, "work", "worker", &["--lens", "other"]);
    assert_eq!(exit, 2, "{value}");
    assert!(task::read(temp.path(), "work").unwrap().is_none());
    assert!(!temp.path().join(".blabla/tasks/work.opened").exists());
}

#[test]
fn no_registered_process_preserves_bootstrap_even_with_unregistered_file() {
    let temp = fixture(None);
    std::fs::write(
        temp.path().join("process.bla"),
        "role \"worker\" { purpose \"Ignored until registered\" }\n",
    )
    .unwrap();
    assert_eq!(open(&temp, "work", "bootstrap-role", &[]).0, 0);
    assert_eq!(
        task::read(temp.path(), "work").unwrap().unwrap().role,
        "bootstrap-role"
    );
}

#[test]
fn valid_registered_process_without_roles_preserves_bootstrap() {
    let temp = fixture(Some(""));
    let process = blabla::memory::read(
        &temp.path().join("process.bla"),
        "process.bla",
        blabla::memory::process::build,
        blabla::memory::process::validate,
    );
    assert!(process.present().is_some());
    let (exit, value) = open(&temp, "work", "bootstrap-role", &[]);
    assert_eq!(exit, 0, "{value}");
}

#[test]
fn an_existing_bootstrap_task_is_not_silently_renamed_or_rewritten() {
    let temp = fixture(None);
    assert_eq!(open(&temp, "legacy", "old-role", &[]).0, 0);
    let manifest = std::fs::read_to_string(temp.path().join("project.bla")).unwrap();
    std::fs::write(
        temp.path().join("project.bla"),
        format!("{manifest}process \"process.bla\"\n"),
    )
    .unwrap();
    std::fs::write(
        temp.path().join("process.bla"),
        "role \"worker\" { purpose \"Implement\" }\n",
    )
    .unwrap();
    let before = tree(temp.path());
    let value = success(&temp, &["task", "show", "legacy"]);
    assert_eq!(value["task"]["role"], "old-role");
    assert_eq!(tree(temp.path()), before);
    refused_without_writes(&temp, "old-role");
}

#[test]
fn a_registered_process_that_cannot_supply_roles_is_not_role_free_bootstrap() {
    type Break = fn(&Path);
    let cases: [(&str, Break); 5] = [
        ("missing", |root| {
            std::fs::remove_file(root.join("process.bla")).unwrap();
        }),
        ("malformed", |root| {
            std::fs::write(root.join("process.bla"), "role \"worker\" {").unwrap();
        }),
        ("not a file", |root| {
            std::fs::remove_file(root.join("process.bla")).unwrap();
            std::fs::create_dir(root.join("process.bla")).unwrap();
        }),
        ("not utf-8", |root| {
            std::fs::write(root.join("process.bla"), [0xff, 0xfe]).unwrap();
        }),
        ("semantically invalid", |root| {
            std::fs::write(
                root.join("process.bla"),
                "role \"worker\" { purpose \"First\" }\nrole \"worker\" { purpose \"Duplicate\" }\n",
            )
            .unwrap();
        }),
    ];
    for (label, spoil) in cases {
        let temp = configured();
        spoil(temp.path());
        let value = refused_without_writes(&temp, "worker");
        if label == "missing" {
            assert!(value["message"].as_str().unwrap().contains("process.bla"));
        }
    }
}
