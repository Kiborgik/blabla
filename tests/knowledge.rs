#[path = "support/cli.rs"]
mod support;

use serde_json::Value;
use std::path::Path;
use support::{args, run_in};
use tempfile::TempDir;

const MANIFEST: &str = "project Fixture\n\nmission \"mission.bla\"\nsystem \"system.bla\"\nprocess \"process.bla\"\n\nknowledge \"knowledge/engineering.bla\"\nknowledge \"knowledge/testing.bla\"\n\nuse structure \"contracts/arch.bla\"\n";
const BARE: &str = "project Fixture\n\nuse structure \"contracts/arch.bla\"\n";
const CONTRACT: &str =
    "module thing \"src/thing.rs\"\n\nrequire \"fields\": symbol thing::FIELDS\n";
const SOURCE: &str = "pub const FIELDS: [&str; 1] = [\"a\"];\n";

const MISSION: &str = r#"
mission "fixture" {
    statement "keep the fixture honest"
    non_goals ["grow without evidence"]
}

priority "truth-first" {
    statement "an honest signal outranks a convenient one"
}
"#;

const ENGINEERING: &str = r#"
knowledge "engineering" {
    purpose "scope and duplication judgment"
}

ruling "smallest-correct-change" {
    pack "engineering"
    statement "change what the task requires and nothing else"
}

ruling "reuse-before-reinvention" {
    pack "engineering"
    statement "find the existing capability before adding a second one"
}
"#;

const TESTING: &str = r#"
knowledge "testing" {
    purpose "what a check establishes and what it does not"
}

ruling "smallest-correct-change" {
    pack "testing"
    statement "point the check at what changed"
}
"#;

const SYSTEM: &str = r#"
system "alpha" {
    purpose "hold the alpha half"
    paths ["src/thing.rs"]
    knowledge ["engineering"]
}

responsibility "carry-facts" {
    owner "alpha"
    statement "produce the facts"
}
"#;

const PROCESS: &str = r#"
role "worker" {
    purpose "carry out one bounded task"
    consult ["testing"]
}

policy "focused-checks" {
    statement "run the checks that cover the change"
    applies_to ["worker"]
    consult ["testing"]
}
"#;

struct Files<'a> {
    manifest: &'a str,
    mission: Option<&'a str>,
    engineering: Option<&'a str>,
    testing: Option<&'a str>,
    system: &'a str,
    process: &'a str,
}

impl Default for Files<'_> {
    fn default() -> Self {
        Files {
            manifest: MANIFEST,
            mission: Some(MISSION),
            engineering: Some(ENGINEERING),
            testing: Some(TESTING),
            system: SYSTEM,
            process: PROCESS,
        }
    }
}

fn write(root: &Path, relative: &str, text: &str) {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn built(files: Files<'_>) -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "project.bla", files.manifest);
    write(root, "contracts/arch.bla", CONTRACT);
    write(root, "src/thing.rs", SOURCE);
    write(root, "system.bla", files.system);
    write(root, "process.bla", files.process);
    if let Some(mission) = files.mission {
        write(root, "mission.bla", mission);
    }
    if let Some(engineering) = files.engineering {
        write(root, "knowledge/engineering.bla", engineering);
    }
    if let Some(testing) = files.testing {
        write(root, "knowledge/testing.bla", testing);
    }
    temp
}

fn project() -> TempDir {
    built(Files::default())
}

fn json_of(temp: &TempDir, arguments: &[&str]) -> (Value, i32) {
    let output = run_in(Some(temp.path()), &args(arguments));
    let text = String::from_utf8(output.stdout).unwrap();
    (
        serde_json::from_str(&text).unwrap(),
        output.status.code().unwrap(),
    )
}

fn diagnostic(temp: &TempDir, arguments: &[&str]) -> Value {
    let output = run_in(Some(temp.path()), &args(arguments));
    assert_eq!(output.status.code().unwrap(), 2);
    serde_json::from_str(&String::from_utf8(output.stdout).unwrap()).unwrap()
}

#[test]
fn a_project_that_registers_neither_reports_neither() {
    let temp = built(Files {
        manifest: BARE,
        mission: None,
        engineering: None,
        testing: None,
        ..Files::default()
    });
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert!(view.get("mission_memory").is_none());
    assert!(view.get("knowledge_memory").is_none());
    assert_eq!(view["overall"]["status"], "green");
    assert_eq!(code, 0);
}

#[test]
fn an_unregistered_pack_directory_is_reported_and_not_loaded() {
    let temp = built(Files {
        manifest: BARE,
        mission: None,
        ..Files::default()
    });
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["knowledge_memory"]["state"], "unregistered");
    assert!(view["knowledge_memory"].get("packs").is_none());
    assert_eq!(view["overall"]["status"], "green");
    assert_eq!(code, 0);
}

#[test]
fn present_mission_and_knowledge_are_reported_and_completion_is_unchanged() {
    let bare = built(Files {
        manifest: BARE,
        mission: None,
        engineering: None,
        testing: None,
        ..Files::default()
    });
    let (without, without_code) = json_of(&bare, &["status", "--json"]);
    let temp = project();
    let (view, code) = json_of(&temp, &["status", "--json"]);

    assert_eq!(view["mission_memory"]["state"], "present");
    assert_eq!(view["mission_memory"]["mission"], "mission::fixture");
    assert_eq!(view["mission_memory"]["priorities"], 1);
    assert_eq!(view["mission_memory"]["non_goals"], 1);

    assert_eq!(view["knowledge_memory"]["state"], "present");
    assert_eq!(
        view["knowledge_memory"]["packs"],
        serde_json::json!(["knowledge::engineering", "knowledge::testing"])
    );
    assert_eq!(view["knowledge_memory"]["rulings"], 3);

    assert_eq!(view["overall"], without["overall"]);
    assert_eq!(view["completion"], without["completion"]);
    assert_eq!(code, without_code);
}

#[test]
fn explain_resolves_a_mission_and_a_priority() {
    let temp = project();
    let (mission, code) = json_of(&temp, &["explain", "mission::fixture", "--json"]);
    assert_eq!(mission["kind"], "mission");
    assert_eq!(mission["id"], "mission::fixture");
    assert_eq!(mission["non_goals"].as_array().unwrap().len(), 1);
    assert_eq!(mission["priorities"].as_array().unwrap().len(), 1);
    assert_eq!(code, 0);

    let (priority, code) = json_of(&temp, &["explain", "priority::truth-first", "--json"]);
    assert_eq!(priority["kind"], "priority");
    assert_eq!(priority["id"], "priority::truth-first");
    assert!(priority.get("priorities").is_none());
    assert_eq!(code, 0);
}

#[test]
fn a_pack_view_lists_ruling_identities_and_not_ruling_statements() {
    let temp = project();
    let (pack, code) = json_of(&temp, &["explain", "knowledge::engineering", "--json"]);
    assert_eq!(pack["kind"], "knowledge");
    assert_eq!(pack["id"], "knowledge::engineering");
    assert_eq!(
        pack["rulings"],
        serde_json::json!([
            "ruling::engineering::smallest-correct-change",
            "ruling::engineering::reuse-before-reinvention"
        ])
    );
    assert_eq!(code, 0);

    let (ruling, code) = json_of(
        &temp,
        &[
            "explain",
            "ruling::engineering::reuse-before-reinvention",
            "--json",
        ],
    );
    assert_eq!(ruling["kind"], "ruling");
    assert_eq!(ruling["pack"], "knowledge::engineering");
    assert!(!ruling["statement"].as_str().unwrap().is_empty());
    assert_eq!(code, 0);
}

#[test]
fn two_packs_may_declare_the_same_ruling_name() {
    let temp = project();
    let (view, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["knowledge_memory"]["state"], "present");

    for pack in ["engineering", "testing"] {
        let id = format!("ruling::{pack}::smallest-correct-change");
        let (ruling, code) = json_of(&temp, &["explain", &id, "--json"]);
        assert_eq!(ruling["id"], id);
        assert_eq!(ruling["pack"], format!("knowledge::{pack}"));
        assert_eq!(code, 0);
    }
}

#[test]
fn a_bare_ruling_name_in_two_packs_is_refused_with_both_canonical_commands() {
    let temp = project();
    let view = diagnostic(&temp, &["explain", "smallest-correct-change", "--json"]);
    assert_eq!(view["diagnostic"]["code"], "E_AMBIGUOUS_IDENTITY");
    let message = view["message"].as_str().unwrap();
    assert!(
        message.contains("blabla explain ruling::engineering::smallest-correct-change"),
        "{message}"
    );
    assert!(
        message.contains("blabla explain ruling::testing::smallest-correct-change"),
        "{message}"
    );
}

#[test]
fn one_pack_may_not_declare_the_same_ruling_twice() {
    let broken = ENGINEERING.replace("reuse-before-reinvention", "smallest-correct-change");
    let temp = built(Files {
        engineering: Some(&broken),
        ..Files::default()
    });
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["knowledge_memory"]["state"], "invalid");
    assert_eq!(view["overall"]["status"], "green");
    assert_eq!(code, 0);
}

#[test]
fn a_ruling_whose_pack_is_not_declared_is_invalid() {
    let broken = ENGINEERING.replace("pack \"engineering\"", "pack \"absent\"");
    let temp = built(Files {
        engineering: Some(&broken),
        ..Files::default()
    });
    let (view, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["knowledge_memory"]["state"], "invalid");
}

#[test]
fn a_pack_with_no_ruling_is_invalid() {
    let temp = built(Files {
        testing: Some("knowledge \"testing\" {\n    purpose \"empty\"\n}\n"),
        ..Files::default()
    });
    let (view, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["knowledge_memory"]["state"], "invalid");
}

#[test]
fn a_mission_file_without_a_mission_declaration_is_invalid() {
    let temp = built(Files {
        mission: Some("priority \"alone\" {\n    statement \"no mission above me\"\n}\n"),
        ..Files::default()
    });
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["mission_memory"]["state"], "invalid");
    assert_eq!(view["overall"]["status"], "green");
    assert_eq!(code, 0);
}

#[test]
fn a_second_mission_declaration_is_rejected() {
    let twice = format!("{MISSION}\nmission \"other\" {{\n    statement \"a rival\"\n}}\n");
    let temp = built(Files {
        mission: Some(&twice),
        ..Files::default()
    });
    let (view, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["mission_memory"]["state"], "unreadable");
}

#[test]
fn a_manifest_may_register_only_one_mission_and_each_pack_once() {
    let twice = MANIFEST.replace(
        "mission \"mission.bla\"\n",
        "mission \"mission.bla\"\nmission \"other.bla\"\n",
    );
    let temp = built(Files {
        manifest: &twice,
        ..Files::default()
    });
    let view = diagnostic(&temp, &["status", "--json"]);
    assert_eq!(view["diagnostic"]["code"], "E_DUPLICATE_MISSION");

    let repeated = MANIFEST.replace(
        "knowledge \"knowledge/testing.bla\"\n",
        "knowledge \"knowledge/engineering.bla\"\n",
    );
    let temp = built(Files {
        manifest: &repeated,
        ..Files::default()
    });
    let view = diagnostic(&temp, &["status", "--json"]);
    assert_eq!(view["diagnostic"]["code"], "E_DUPLICATE_KNOWLEDGE");
}

#[test]
fn neither_mission_nor_knowledge_is_a_layer() {
    for statement in [
        "mission \"mission.bla\"",
        "knowledge \"knowledge/testing.bla\"",
    ] {
        let broken = MANIFEST.replace(statement, &format!("use {statement}"));
        let temp = built(Files {
            manifest: &broken,
            ..Files::default()
        });
        let view = diagnostic(&temp, &["status", "--json"]);
        assert_eq!(view["diagnostic"]["code"], "E_UNSUPPORTED_LAYER");
    }
}

#[test]
fn every_new_identity_prefix_is_a_reserved_contract_group() {
    for reserved in ["mission", "priority", "knowledge", "ruling"] {
        let manifest = MANIFEST.replace(
            "use structure \"contracts/arch.bla\"",
            &format!("use structure \"contracts/arch.bla\" as {reserved}"),
        );
        let temp = built(Files {
            manifest: &manifest,
            ..Files::default()
        });
        let view = diagnostic(&temp, &["status", "--json"]);
        assert_eq!(view["diagnostic"]["code"], "E_RESERVED_GROUP");
    }
}

#[test]
fn routing_reaches_the_system_and_process_views() {
    let temp = project();
    let (system, code) = json_of(&temp, &["explain", "system::alpha", "--json"]);
    assert_eq!(
        system["knowledge"],
        serde_json::json!(["knowledge::engineering"])
    );
    assert_eq!(code, 0);

    let (role, _) = json_of(&temp, &["explain", "role::worker", "--json"]);
    assert_eq!(role["consult"], serde_json::json!(["knowledge::testing"]));

    let (policy, _) = json_of(&temp, &["explain", "policy::focused-checks", "--json"]);
    assert_eq!(policy["consult"], serde_json::json!(["knowledge::testing"]));
}

#[test]
fn a_system_that_names_an_undeclared_pack_is_invalid_and_completion_is_unaffected() {
    let broken = SYSTEM.replace("knowledge [\"engineering\"]", "knowledge [\"ue5-cpp\"]");
    let temp = built(Files {
        system: &broken,
        ..Files::default()
    });
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["system_memory"]["state"], "invalid");
    let problems = view["system_memory"]["problems"].as_array().unwrap();
    assert_eq!(problems.len(), 1);
    assert!(problems[0].as_str().unwrap().contains("ue5-cpp"));
    assert_eq!(view["knowledge_memory"]["state"], "present");
    assert_eq!(view["overall"]["status"], "green");
    assert_eq!(code, 0);
}

#[test]
fn routing_with_no_registered_knowledge_memory_is_invalid() {
    let manifest = BARE.replace(
        "use structure",
        "system \"system.bla\"\nprocess \"process.bla\"\n\nuse structure",
    );
    let temp = built(Files {
        manifest: &manifest,
        mission: None,
        engineering: None,
        testing: None,
        ..Files::default()
    });
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["system_memory"]["state"], "invalid");
    assert_eq!(view["process_memory"]["state"], "invalid");
    assert_eq!(
        view["process_memory"]["problems"].as_array().unwrap().len(),
        2
    );
    assert_eq!(view["overall"]["status"], "green");
    assert_eq!(code, 0);
}

#[test]
fn a_role_or_policy_that_consults_an_undeclared_pack_is_invalid() {
    let broken = PROCESS.replace("consult [\"testing\"]", "consult [\"absent\"]");
    let temp = built(Files {
        process: &broken,
        ..Files::default()
    });
    let (view, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["process_memory"]["state"], "invalid");
    assert_eq!(
        view["process_memory"]["problems"].as_array().unwrap().len(),
        2
    );
}

#[test]
fn a_pack_file_is_checked_on_its_own_while_it_is_authored() {
    let temp = project();
    let valid = run_in(
        Some(temp.path()),
        &args(&["check", "knowledge/engineering.bla", "--json"]),
    );
    assert_eq!(valid.status.code().unwrap(), 0);
    let view: Value = serde_json::from_str(&String::from_utf8(valid.stdout).unwrap()).unwrap();
    assert_eq!(view["status"], "valid");
    assert_eq!(view["memory"], "knowledge");
    assert_eq!(view["completion"], "none");

    let checked = run_in(
        Some(temp.path()),
        &args(&["check", "mission.bla", "--json"]),
    );
    assert_eq!(checked.status.code().unwrap(), 0);
    let view: Value = serde_json::from_str(&String::from_utf8(checked.stdout).unwrap()).unwrap();
    assert_eq!(view["status"], "valid");
    assert_eq!(view["memory"], "mission");
}
