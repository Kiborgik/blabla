use serde_json::Value;
use std::path::{Path, PathBuf};

#[path = "support/cli.rs"]
mod support;
use support::{args, run_in};

fn repository() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes)
        .unwrap_or_else(|failure| panic!("{failure}: {}", String::from_utf8_lossy(bytes)))
}

fn status(dir: &Path) -> (i32, Value, String) {
    let output = run_in(Some(dir), &args(&["--json", "status"]));
    let human = run_in(Some(dir), &args(&["status"]));
    (
        output.status.code().unwrap(),
        json(&output.stdout),
        String::from_utf8(human.stdout).unwrap(),
    )
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
    let (exit, status, human) = status(temp.path());
    assert_eq!(exit, 5, "{status}");
    assert_eq!(status["state"], "unverified");
    assert_eq!(status["structure"]["status"], "green", "{status}");
    assert_eq!(status["structure"]["verified"], 47);
    assert_eq!(status["structure"]["violated"], 0);
    assert_eq!(status["structure"]["errors"], 0);
    assert_eq!(status["structure"]["invocations"], 1);
    assert_eq!(status["overall"]["status"], "blocked");
    assert!(human.contains("STRUCTURE  47/47 rules  GREEN"), "{human}");
    assert!(human.contains("BEHAVIOR   UNVERIFIED"), "{human}");
}

#[test]
fn keeping_the_id_inside_the_durable_fields_is_structure_red_with_correct_behavior_code() {
    let (exit, status, human) =
        status(&repository().join("tests/fixtures/structure/glyph-durable-id"));
    assert_eq!(exit, 1, "{status}");
    assert_eq!(status["structure"]["status"], "red");
    assert_eq!(red_rules(&status), ["architecture::id-is-the-key"]);
    assert_eq!(status["completion"]["state"], "structure_red");
    assert_eq!(status["overall"]["status"], "blocked");
    assert!(human.contains("STRUCTURE  46/47 rules  RED"), "{human}");
    assert!(human.contains("architecture::id-is-the-key"), "{human}");
    assert!(
        human.contains("glyph_vault/model.py:4 DURABLE_FIELDS contains \"id\""),
        "{human}"
    );
}

#[test]
fn a_dead_application_restart_implementation_is_structure_red() {
    let (exit, status, human) =
        status(&repository().join("tests/fixtures/structure/glyph-dead-restart"));
    assert_eq!(exit, 1, "{status}");
    assert_eq!(status["structure"]["status"], "red");
    assert_eq!(
        red_rules(&status),
        [
            "architecture::no-domain-restart",
            "architecture::no-protocol-restart"
        ]
    );
    assert!(human.contains("STRUCTURE  45/47 rules  RED"), "{human}");
    assert!(human.contains("defines VaultDomain.restart"), "{human}");
    assert!(human.contains("ARGUMENTS contains \"restart\""), "{human}");
    let output = run_in(
        Some(&repository().join("tests/fixtures/structure/glyph-dead-restart")),
        &args(&["explain", "architecture::no-domain-restart"]),
    );
    let explained = String::from_utf8(output.stdout).unwrap();
    assert!(explained.contains("Status: RED"), "{explained}");
    assert!(
        explained.contains("domain must not define VaultDomain.restart"),
        "{explained}"
    );
    assert!(explained.contains("glyph_vault/domain.py:"), "{explained}");
}
