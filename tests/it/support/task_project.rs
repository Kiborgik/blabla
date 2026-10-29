use super::{args, run_in, write};
use serde_json::Value;
use std::process::Output;
use tempfile::TempDir;

pub fn project(process: &str) -> TempDir {
    project_with(Some(process))
}

pub fn project_with(process: Option<&str>) -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let declaration = if process.is_some() {
        "process \"process.bla\"\n\n"
    } else {
        ""
    };
    write(
        root,
        "project.bla",
        &format!("project Test\n\n{declaration}use structure \"contracts/arch.bla\"\n"),
    );
    write(
        root,
        "contracts/arch.bla",
        "module thing \"src/thing.rs\"\n\nrequire \"entry\": symbol thing::run\n",
    );
    if let Some(process) = process {
        write(root, "process.bla", process);
    }
    write(root, "src/thing.rs", "pub fn run() {}\n");
    temp
}

pub fn run(temp: &TempDir, list: &[&str]) -> Output {
    run_in(Some(temp.path()), &args(list))
}

pub fn code(temp: &TempDir, list: &[&str]) -> i32 {
    run(temp, list).status.code().unwrap()
}

pub fn ok(temp: &TempDir, list: &[&str]) {
    let output = run(temp, list);
    assert_eq!(
        output.status.code(),
        Some(0),
        "{list:?}: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

pub fn text(temp: &TempDir, list: &[&str]) -> String {
    let output = run(temp, list);
    format!(
        "{}{}",
        String::from_utf8(output.stdout).unwrap(),
        String::from_utf8(output.stderr).unwrap()
    )
}

pub fn shows(temp: &TempDir, list: &[&str], identity: &str) {
    let output = run(temp, list);
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert_eq!(output.status.code(), Some(0), "{list:?}: {stdout}");
    assert!(stdout.contains(identity), "{list:?}: {stdout}");
}

pub fn json(temp: &TempDir, list: &[&str]) -> Value {
    let mut list = list.to_vec();
    let before_check = list
        .iter()
        .position(|arg| *arg == "--check")
        .unwrap_or(list.len());
    list.insert(before_check, "--json");
    serde_json::from_slice(&run(temp, &list).stdout).unwrap()
}

pub fn opened(temp: &TempDir) {
    ok(
        temp,
        &[
            "task",
            "open",
            "work",
            "--role",
            "worker",
            "--statement",
            "repair the entry point",
            "--scope",
            "src",
            "--deliverable",
            "src/thing.rs",
            "--check",
            "true",
        ],
    );
}

pub fn accepted(temp: &TempDir) {
    opened(temp);
    assert_eq!(
        code(temp, &["task", "accept", "work", "--model", "small"]),
        0
    );
}

pub fn state(temp: &TempDir) -> String {
    json(temp, &["task", "show", "work"])["task"]["state"]
        .as_str()
        .unwrap()
        .to_owned()
}

pub fn grounded(temp: &TempDir) -> Vec<String> {
    json(temp, &["challenge", "work"])["grounded"]
        .as_array()
        .unwrap()
        .iter()
        .map(|class| class.as_str().unwrap().to_owned())
        .collect()
}

pub fn change_the_deliverable(temp: &TempDir) {
    write(temp.path(), "src/thing.rs", "pub fn run() -> u8 { 1 }\n");
}

pub fn set_record_field(temp: &TempDir, name: &str, field: &str, value: Value) {
    let path = blabla::project::task::path_of(temp.path(), name);
    let mut record: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    record[field] = value;
    std::fs::write(&path, serde_json::to_vec_pretty(&record).unwrap()).unwrap();
}

pub fn record_evidence(temp: &TempDir) {
    assert_eq!(
        code(
            temp,
            &["task", "evidence", "work", "--exit", "0", "--tool", "check"]
        ),
        0
    );
}
