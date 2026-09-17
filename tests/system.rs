#[path = "support/cli.rs"]
mod support;

use serde_json::Value;
use std::path::Path;
use support::{args, run_in};
use tempfile::TempDir;

const MANIFEST: &str =
    "project Fixture\n\nsystem \"system.bla\"\n\nuse structure \"contracts/arch.bla\"\n";
const UNREGISTERED: &str = "project Fixture\n\nuse structure \"contracts/arch.bla\"\n";
const CONTRACT: &str =
    "module thing \"src/thing.rs\"\n\nrequire \"fields\": symbol thing::FIELDS\n";
const SOURCE: &str = "pub const FIELDS: [&str; 1] = [\"a\"];\n";

const MEMORY: &str = r#"
system "alpha" {
    purpose "hold the alpha half"
    paths ["src/thing.rs"]
}

system "beta" {
    purpose "hold the beta half"
}

responsibility "carry-facts" {
    owner "alpha"
    statement "produce the facts"
}

seam "handoff" {
    between ["alpha", "beta"]
    value "Parcel"
    statement "everything crosses as one value"
    moves_with ["src/thing.rs"]
}
"#;

fn write(root: &Path, relative: &str, text: &str) {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn project(memory: Option<&str>) -> TempDir {
    built(MANIFEST, memory)
}

fn built(manifest: &str, memory: Option<&str>) -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "project.bla", manifest);
    write(root, "contracts/arch.bla", CONTRACT);
    write(root, "src/thing.rs", SOURCE);
    if let Some(memory) = memory {
        write(root, "system.bla", memory);
    }
    temp
}

fn json_of(temp: &TempDir, arguments: &[&str]) -> (Value, i32) {
    let output = run_in(Some(temp.path()), &args(arguments));
    let text = String::from_utf8(output.stdout).unwrap();
    (
        serde_json::from_str(&text).unwrap(),
        output.status.code().unwrap(),
    )
}

#[test]
fn a_project_that_registers_nothing_reports_no_system_memory() {
    let temp = built(UNREGISTERED, None);
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert!(view.get("system_memory").is_none());
    assert_eq!(view["overall"]["status"], "green");
    assert_eq!(code, 0);
}

#[test]
fn an_unregistered_file_is_not_loaded_and_is_reported_as_unregistered() {
    let temp = built(UNREGISTERED, Some(MEMORY));
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["system_memory"]["state"], "unregistered");
    assert!(view["system_memory"].get("systems").is_none());
    assert_eq!(view["overall"]["status"], "green");
    assert_eq!(code, 0);
    let denied = run_in(Some(temp.path()), &args(&["explain", "system::alpha"]));
    assert_eq!(denied.status.code().unwrap(), 2);
}

#[test]
fn a_registered_file_that_is_absent_is_missing_and_completion_is_unaffected() {
    let temp = project(None);
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["system_memory"]["state"], "missing");
    assert_eq!(view["overall"]["status"], "green");
    assert_eq!(code, 0);
}

#[test]
fn a_manifest_may_register_only_one_system_memory() {
    let twice = MANIFEST.replace(
        "system \"system.bla\"
",
        "system \"system.bla\"
system \"other.json\"
",
    );
    let temp = built(&twice, Some(MEMORY));
    let output = run_in(Some(temp.path()), &args(&["status", "--json"]));
    assert_eq!(output.status.code().unwrap(), 2);
    let view: Value = serde_json::from_str(&String::from_utf8(output.stdout).unwrap()).unwrap();
    assert_eq!(view["diagnostic"]["code"], "E_DUPLICATE_SYSTEM");
}

#[test]
fn system_memory_is_not_a_layer() {
    let temp = built(
        &MANIFEST.replace("system \"system.bla\"", "use system \"system.bla\""),
        Some(MEMORY),
    );
    let output = run_in(Some(temp.path()), &args(&["status", "--json"]));
    assert_eq!(output.status.code().unwrap(), 2);
    let view: Value = serde_json::from_str(&String::from_utf8(output.stdout).unwrap()).unwrap();
    assert_eq!(view["diagnostic"]["code"], "E_UNSUPPORTED_LAYER");
}

#[test]
fn present_system_memory_is_reported_and_completion_is_unchanged() {
    let without = built(UNREGISTERED, None);
    let (bare, bare_code) = json_of(&without, &["status", "--json"]);
    let temp = project(Some(MEMORY));
    let (view, code) = json_of(&temp, &["status", "--json"]);
    let memory = &view["system_memory"];
    assert_eq!(memory["state"], "present");
    assert_eq!(memory["file"], "system.bla");
    assert_eq!(
        memory["systems"],
        serde_json::json!(["system::alpha", "system::beta"])
    );
    assert_eq!(memory["responsibilities"], 1);
    assert_eq!(memory["seams"], 1);
    assert_eq!(view["overall"], bare["overall"]);
    assert_eq!(view["completion"], bare["completion"]);
    assert_eq!(view["structure"]["status"], bare["structure"]["status"]);
    assert_eq!(code, bare_code);
}

#[test]
fn explain_resolves_a_system_a_responsibility_and_a_seam() {
    let temp = project(Some(MEMORY));

    let (system, code) = json_of(&temp, &["explain", "system::alpha", "--json"]);
    assert_eq!(system["kind"], "system");
    assert_eq!(system["id"], "system::alpha");
    assert_eq!(system["paths"], serde_json::json!(["src/thing.rs"]));
    assert_eq!(code, 0);

    let (responsibility, code) =
        json_of(&temp, &["explain", "responsibility::carry-facts", "--json"]);
    assert_eq!(responsibility["kind"], "responsibility");
    assert_eq!(responsibility["id"], "responsibility::carry-facts");
    assert_eq!(responsibility["owner"], "system::alpha");
    assert_eq!(code, 0);

    let (seam, code) = json_of(&temp, &["explain", "seam::handoff", "--json"]);
    assert_eq!(seam["kind"], "seam");
    assert_eq!(seam["id"], "seam::handoff");
    assert_eq!(seam["value"], "Parcel");
    assert_eq!(
        seam["between"],
        serde_json::json!(["system::alpha", "system::beta"])
    );
    assert_eq!(seam["moves_with"], serde_json::json!(["src/thing.rs"]));
    assert_eq!(code, 0);
}

#[test]
fn a_system_lists_the_responsibilities_it_owns_and_the_seams_it_touches() {
    let temp = project(Some(MEMORY));
    let (view, _) = json_of(&temp, &["explain", "system::alpha", "--json"]);
    assert_eq!(view["owns"].as_array().unwrap().len(), 1);
    assert_eq!(view["seams"].as_array().unwrap().len(), 1);
    let (other, _) = json_of(&temp, &["explain", "system::beta", "--json"]);
    assert!(other.get("owns").is_none());
    assert_eq!(other["seams"].as_array().unwrap().len(), 1);
}

#[test]
fn an_owner_that_names_no_system_is_invalid_and_completion_is_unaffected() {
    let broken = MEMORY.replace("owner \"alpha\"", "owner \"gamma\"");
    let temp = project(Some(&broken));
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["system_memory"]["state"], "invalid");
    assert_eq!(
        view["system_memory"]["problems"].as_array().unwrap().len(),
        1
    );
    assert_eq!(view["overall"]["status"], "green");
    assert_eq!(code, 0);
}

#[test]
fn a_seam_side_that_names_no_system_is_invalid() {
    let broken = MEMORY.replace(
        "between [\"alpha\", \"beta\"]",
        "between [\"alpha\", \"delta\"]",
    );
    let temp = project(Some(&broken));
    let (view, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["system_memory"]["state"], "invalid");
}

#[test]
fn a_name_declared_twice_is_invalid() {
    let broken = MEMORY.replace("seam \"handoff\"", "seam \"carry-facts\"");
    let temp = project(Some(&broken));
    let (view, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["system_memory"]["state"], "invalid");
}

#[test]
fn a_file_that_does_not_match_the_schema_is_unreadable_and_completion_is_unaffected() {
    let temp = project(Some(
        "system \"alpha\" {
    purpose \"x\"
    unknown \"y\"
}
",
    ));
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["system_memory"]["state"], "unreadable");
    assert_eq!(view["overall"]["status"], "green");
    assert_eq!(code, 0);

    let malformed = project(Some("system alpha {"));
    let (view, code) = json_of(&malformed, &["status", "--json"]);
    assert_eq!(view["system_memory"]["state"], "unreadable");
    assert_eq!(code, 0);
}

#[test]
fn an_unknown_field_is_rejected_rather_than_ignored() {
    let broken = MEMORY.replace("value \"Parcel\"", "value \"Parcel\"\n    owner \"alpha\"");
    let temp = project(Some(&broken));
    let (view, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["system_memory"]["state"], "unreadable");
}

#[test]
fn a_name_in_two_namespaces_is_refused_and_both_canonical_commands_are_offered() {
    let memory = MEMORY.replace("system \"alpha\"", "system \"fields\"");
    let memory = memory.replace("owner \"alpha\"", "owner \"fields\"");
    let memory = memory.replace("[\"alpha\", \"beta\"]", "[\"fields\", \"beta\"]");
    let temp = project(Some(&memory));
    let output = run_in(Some(temp.path()), &args(&["explain", "fields", "--json"]));
    assert_eq!(output.status.code().unwrap(), 2);
    let view: Value = serde_json::from_str(&String::from_utf8(output.stdout).unwrap()).unwrap();
    assert_eq!(view["diagnostic"]["code"], "E_AMBIGUOUS_IDENTITY");
    let message = view["message"].as_str().unwrap();
    assert!(
        message.contains("blabla explain system::fields"),
        "{message}"
    );
    assert!(message.contains("blabla explain arch::fields"), "{message}");

    let (system, code) = json_of(&temp, &["explain", "system::fields", "--json"]);
    assert_eq!(system["id"], "system::fields");
    assert_eq!(code, 0);
    let (rule, code) = json_of(&temp, &["explain", "arch::fields", "--json"]);
    assert_eq!(rule["id"], "arch::fields");
    assert_eq!(code, 0);
}

#[test]
fn a_name_in_no_layer_still_reports_an_unknown_rule() {
    let temp = project(Some(MEMORY));
    let output = run_in(
        Some(temp.path()),
        &args(&["explain", "absent-name", "--json"]),
    );
    assert_eq!(output.status.code().unwrap(), 2);
}
