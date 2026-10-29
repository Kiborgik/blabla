use crate::support;

use serde_json::Value;
use support::{args, json_of, run_in, write};
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
    model ["haiku-4.5", "gpt-5.6-luna"]
    consult ["testing"]
}

policy "focused-checks" {
    statement "run the checks that cover the change"
    applies_to ["worker"]
    consult ["testing"]
}
"#;

const PROCESS_WITH_MULTIPLE_ALIASES_FOR_ONE_MODEL: &str = r#"
role "worker" {
    purpose "carry out one bounded task"
    model ["haiku-4.5", "gpt-5.6-luna"]
    consult ["testing"]
}

alias "haiku45-host-id" { model "haiku-4.5" }
alias "haiku45-primary" { model "haiku-4.5" }

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

fn diagnostic(temp: &TempDir, arguments: &[&str]) -> Value {
    let output = run_in(Some(temp.path()), &args(arguments));
    assert_eq!(output.status.code().unwrap(), 2);
    serde_json::from_str(&String::from_utf8(output.stdout).unwrap()).unwrap()
}
fn bare() -> TempDir {
    built(Files {
        manifest: BARE,
        mission: None,
        engineering: None,
        testing: None,
        ..Files::default()
    })
}

fn state_of(files: Files<'_>, memory: &str) -> String {
    let temp = built(files);
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["overall"]["status"], "green", "{view}");
    assert_eq!(code, 0);
    view[memory]["state"].as_str().unwrap().to_owned()
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
    let bare = bare();
    let (without, without_code) = json_of(&bare, &["status", "--json"]);
    assert!(without.get("mission_memory").is_none());
    assert!(without.get("knowledge_memory").is_none());
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
fn a_pack_view_lists_ruling_identities_and_two_packs_may_share_a_ruling_name() {
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

    for pack in ["engineering", "testing"] {
        let id = format!("ruling::{pack}::smallest-correct-change");
        let (ruling, code) = json_of(&temp, &["explain", &id, "--json"]);
        assert_eq!(ruling["id"], id);
        assert_eq!(ruling["pack"], format!("knowledge::{pack}"));
        assert_eq!(code, 0);
    }
}

#[test]
fn a_bare_ruling_name_in_two_packs_is_refused() {
    let temp = project();
    let view = diagnostic(&temp, &["explain", "smallest-correct-change", "--json"]);
    assert_eq!(view["diagnostic"]["code"], "E_AMBIGUOUS_IDENTITY");
}

#[test]
fn invalid_knowledge_and_mission_memory_is_reported_without_touching_completion() {
    let twice = ENGINEERING.replace("reuse-before-reinvention", "smallest-correct-change");
    let undeclared = ENGINEERING.replace("pack \"engineering\"", "pack \"absent\"");
    let second_mission =
        format!("{MISSION}\nmission \"other\" {{\n    statement \"a rival\"\n}}\n");
    let cases: [(Files<'_>, &str, &str); 5] = [
        (
            Files {
                engineering: Some(&twice),
                ..Files::default()
            },
            "knowledge_memory",
            "invalid",
        ),
        (
            Files {
                engineering: Some(&undeclared),
                ..Files::default()
            },
            "knowledge_memory",
            "invalid",
        ),
        (
            Files {
                testing: Some("knowledge \"testing\" {\n    purpose \"empty\"\n}\n"),
                ..Files::default()
            },
            "knowledge_memory",
            "invalid",
        ),
        (
            Files {
                mission: Some("priority \"alone\" {\n    statement \"no mission above me\"\n}\n"),
                ..Files::default()
            },
            "mission_memory",
            "invalid",
        ),
        (
            Files {
                mission: Some(&second_mission),
                ..Files::default()
            },
            "mission_memory",
            "unreadable",
        ),
    ];
    for (files, memory, expected) in cases {
        assert_eq!(state_of(files, memory), expected, "{memory}");
    }
}

#[test]
fn manifest_registration_diagnostics_carry_their_codes() {
    let two_missions = MANIFEST.replace(
        "mission \"mission.bla\"\n",
        "mission \"mission.bla\"\nmission \"other.bla\"\n",
    );
    let repeated_pack = MANIFEST.replace(
        "knowledge \"knowledge/testing.bla\"\n",
        "knowledge \"knowledge/engineering.bla\"\n",
    );
    let two_systems = MANIFEST.replace(
        "system \"system.bla\"\n",
        "system \"system.bla\"\nsystem \"other.json\"\n",
    );
    let mut cases = vec![
        (two_missions, "E_DUPLICATE_MISSION"),
        (repeated_pack, "E_DUPLICATE_KNOWLEDGE"),
        (two_systems, "E_DUPLICATE_SYSTEM"),
    ];
    for statement in [
        "mission \"mission.bla\"",
        "knowledge \"knowledge/testing.bla\"",
        "system \"system.bla\"",
    ] {
        cases.push((
            MANIFEST.replace(statement, &format!("use {statement}")),
            "E_UNSUPPORTED_LAYER",
        ));
    }
    for reserved in ["mission", "priority", "knowledge", "ruling", "seam"] {
        cases.push((
            MANIFEST.replace(
                "use structure \"contracts/arch.bla\"",
                &format!("use structure \"contracts/arch.bla\" as {reserved}"),
            ),
            "E_RESERVED_GROUP",
        ));
    }
    for (manifest, code) in cases {
        let temp = built(Files {
            manifest: &manifest,
            ..Files::default()
        });
        let view = diagnostic(&temp, &["status", "--json"]);
        assert_eq!(view["diagnostic"]["code"], code, "{manifest}");
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
fn consulting_an_undeclared_or_unregistered_pack_is_invalid_and_completion_is_unaffected() {
    let broken_system = SYSTEM.replace("knowledge [\"engineering\"]", "knowledge [\"ue5-cpp\"]");
    let temp = built(Files {
        system: &broken_system,
        ..Files::default()
    });
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["system_memory"]["state"], "invalid");
    assert_eq!(
        view["system_memory"]["problems"].as_array().unwrap().len(),
        1
    );
    assert_eq!(view["knowledge_memory"]["state"], "present");
    assert_eq!(view["overall"]["status"], "green");
    assert_eq!(code, 0);

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

    let broken_process = PROCESS.replace("consult [\"testing\"]", "consult [\"absent\"]");
    let temp = built(Files {
        process: &broken_process,
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
    let (view, code) = json_of(&temp, &["check", "knowledge/engineering.bla", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(view["status"], "valid");
    assert_eq!(view["memory"], "knowledge");
    assert_eq!(view["completion"], "none");

    let (view, code) = json_of(&temp, &["check", "mission.bla", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(view["status"], "valid");
    assert_eq!(view["memory"], "mission");
}

#[test]
fn an_alias_naming_an_unlisted_model_is_invalid() {
    let broken = PROCESS.replace(
        "}\n\npolicy",
        "}\n\nalias \"bad-alias\" { model \"nonexistent-model\" }\n\npolicy",
    );
    let temp = built(Files {
        process: &broken,
        ..Files::default()
    });
    let (view, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["process_memory"]["state"], "invalid");
    assert_eq!(
        view["process_memory"]["problems"].as_array().unwrap().len(),
        1
    );
}

#[test]
fn permitted_models_includes_all_aliases_for_a_model() {
    let blocks =
        blabla::memory::syntax::parse("process.bla", PROCESS_WITH_MULTIPLE_ALIASES_FOR_ONE_MODEL)
            .expect("process parses");
    let process = blabla::memory::process::build(&blocks).expect("process builds");
    let permitted = blabla::memory::process::permitted_models(&process, "worker");
    assert_eq!(permitted.len(), 4);
    assert!(permitted.contains(&"haiku-4.5".to_owned()));
    assert!(permitted.contains(&"haiku45-host-id".to_owned()));
    assert!(permitted.contains(&"haiku45-primary".to_owned()));
    assert!(permitted.contains(&"gpt-5.6-luna".to_owned()));
}

#[test]
fn explain_role_shows_all_aliases_for_a_model() {
    let temp = built(Files {
        process: PROCESS_WITH_MULTIPLE_ALIASES_FOR_ONE_MODEL,
        ..Files::default()
    });
    let (status, _) = json_of(&temp, &["status", "--json"]);
    assert_eq!(status["process_memory"]["state"], "present");
    let (view, code) = json_of(&temp, &["explain", "role::worker", "--json"]);
    assert_eq!(code, 0);
    let model_strings = view["model"].as_array().unwrap();
    assert_eq!(model_strings.len(), 2);
    let haiku_entry = model_strings
        .iter()
        .find(|m| m.as_str().unwrap().contains("haiku-4.5"))
        .unwrap();
    let haiku_str = haiku_entry.as_str().unwrap();
    assert!(haiku_str.contains("haiku45-host-id"));
    assert!(haiku_str.contains("haiku45-primary"));
}

#[test]
fn human_views_run_for_mission_knowledge_and_process_identities() {
    let temp = project();
    for (arguments, id) in [
        (vec!["status"], "mission::fixture"),
        (vec!["explain", "mission::fixture"], "mission::fixture"),
        (
            vec!["explain", "priority::truth-first"],
            "priority::truth-first",
        ),
        (
            vec!["explain", "knowledge::engineering"],
            "knowledge::engineering",
        ),
        (
            vec!["explain", "ruling::engineering::reuse-before-reinvention"],
            "ruling::engineering::reuse-before-reinvention",
        ),
        (vec!["explain", "role::worker"], "role::worker"),
        (
            vec!["explain", "policy::focused-checks"],
            "policy::focused-checks",
        ),
        (vec!["explain", "system::alpha"], "system::alpha"),
    ] {
        let output = run_in(Some(temp.path()), &args(&arguments));
        assert_eq!(output.status.code(), Some(0), "{arguments:?}");
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.contains(id), "{arguments:?}: {text}");
    }
}
