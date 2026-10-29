use serde_json::Value;
use std::path::{Path, PathBuf};

use crate::support;
use support::{args, run_in};

fn repository() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes)
        .unwrap_or_else(|failure| panic!("{failure}: {}", String::from_utf8_lossy(bytes)))
}

struct Status {
    exit: i32,
    json: Value,
    human: String,
    human_exit: i32,
}

fn status(dir: &Path) -> Status {
    let output = run_in(Some(dir), &args(&["--json", "status"]));
    let human = run_in(Some(dir), &args(&["status"]));
    Status {
        exit: output.status.code().unwrap(),
        json: json(&output.stdout),
        human: String::from_utf8(human.stdout).unwrap(),
        human_exit: human.status.code().unwrap(),
    }
}

fn fixture_root(name: &str) -> (tempfile::TempDir, PathBuf) {
    let root = tempfile::TempDir::new().unwrap();
    copy_without_records(
        &repository().join("examples/glyph-vault"),
        &root.path().join("examples/glyph-vault"),
    );
    let fixture = root.path().join("tests/fixtures/structure").join(name);
    copy_without_records(
        &repository().join("tests/fixtures/structure").join(name),
        &fixture,
    );
    (root, fixture)
}

fn observed_of(status: &Value, id: &str) -> String {
    status["structure"]["rules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|rule| rule["id"] == id)
        .unwrap()["observed"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn red_rules(status: &Value) -> Vec<String> {
    status["structure"]["rules"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|rule| rule["status"] == "red")
        .map(|rule| rule["id"].as_str().unwrap().to_owned())
        .collect()
}

fn copy_without_records(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if name == ".blabla" || name == "__pycache__" {
            continue;
        }
        let target = to.join(&name);
        if entry.file_type().unwrap().is_dir() {
            copy_without_records(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

#[test]
fn the_mature_glyph_vault_example_satisfies_its_structure_contract() {
    let temp = tempfile::TempDir::new().unwrap();
    copy_without_records(&repository().join("examples/glyph-vault"), temp.path());
    let result = status(temp.path());
    let status = &result.json;
    assert_eq!(result.exit, 5, "{status}");
    assert_eq!(result.human_exit, 5);
    assert_eq!(status["state"], "unverified");
    assert_eq!(status["structure"]["status"], "green", "{status}");
    assert_eq!(status["structure"]["verified"], 47);
    assert_eq!(status["structure"]["violated"], 0);
    assert_eq!(status["structure"]["errors"], 0);
    assert_eq!(status["structure"]["invocations"], 1);
    assert_eq!(status["overall"]["status"], "blocked");
    assert!(red_rules(status).is_empty());
    assert!(!result.human.is_empty());
}

#[test]
fn keeping_the_id_inside_the_durable_fields_is_structure_red_with_correct_behavior_code() {
    let (_root, fixture) = fixture_root("glyph-durable-id");
    let result = status(&fixture);
    let status = &result.json;
    assert_eq!(result.exit, 1, "{status}");
    assert_eq!(result.human_exit, 1);
    assert_eq!(status["structure"]["status"], "red");
    assert_eq!(status["structure"]["verified"], 46);
    assert_eq!(red_rules(status), ["architecture::id-is-the-key"]);
    assert_eq!(status["completion"]["state"], "structure_red");
    assert_eq!(status["overall"]["status"], "blocked");
    assert!(result.human.contains("architecture::id-is-the-key"));
    assert!(
        result
            .human
            .contains(&observed_of(status, "architecture::id-is-the-key"))
    );
}

#[test]
fn a_dead_application_restart_implementation_is_structure_red() {
    let (_root, fixture) = fixture_root("glyph-dead-restart");
    let result = status(&fixture);
    let status = &result.json;
    assert_eq!(result.exit, 1, "{status}");
    assert_eq!(result.human_exit, 1);
    assert_eq!(status["structure"]["status"], "red");
    assert_eq!(status["structure"]["verified"], 45);
    let red = red_rules(status);
    assert_eq!(
        red,
        [
            "architecture::no-domain-restart",
            "architecture::no-protocol-restart"
        ]
    );
    for id in &red {
        assert!(result.human.contains(id.as_str()), "{id}");
        assert!(result.human.contains(&observed_of(status, id)), "{id}");
    }
    let explained = run_in(
        Some(&fixture),
        &args(&["explain", "architecture::no-domain-restart"]),
    );
    assert_eq!(explained.status.code(), Some(0));
    let text = String::from_utf8(explained.stdout).unwrap();
    assert!(
        text.contains(&observed_of(status, "architecture::no-domain-restart")),
        "{text}"
    );
}
