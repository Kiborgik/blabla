use crate::support;

use support::{args, json_of, run_in, write};
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
fn present_system_memory_is_reported_and_completion_is_unchanged() {
    let without = built(UNREGISTERED, None);
    let (bare, bare_code) = json_of(&without, &["status", "--json"]);
    assert!(bare.get("system_memory").is_none());
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
    assert_eq!(system["owns"].as_array().unwrap().len(), 1);
    assert_eq!(system["seams"].as_array().unwrap().len(), 1);
    assert_eq!(code, 0);

    let (other, _) = json_of(&temp, &["explain", "system::beta", "--json"]);
    assert!(other.get("owns").is_none());
    assert_eq!(other["seams"].as_array().unwrap().len(), 1);

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
fn invalid_system_memory_is_reported_and_completion_is_unaffected() {
    let cases = [
        (
            MEMORY.replace("owner \"alpha\"", "owner \"gamma\""),
            Some(1),
        ),
        (
            MEMORY.replace(
                "between [\"alpha\", \"beta\"]",
                "between [\"alpha\", \"delta\"]",
            ),
            None,
        ),
        (
            MEMORY.replace("seam \"handoff\"", "seam \"carry-facts\""),
            None,
        ),
    ];
    for (memory, problems) in cases {
        let temp = project(Some(&memory));
        let (view, code) = json_of(&temp, &["status", "--json"]);
        assert_eq!(view["system_memory"]["state"], "invalid", "{memory}");
        let found = view["system_memory"]["problems"].as_array().unwrap().len();
        match problems {
            Some(count) => assert_eq!(found, count, "{memory}"),
            None => assert!(found > 0, "{memory}"),
        }
        assert_eq!(view["overall"]["status"], "green");
        assert_eq!(code, 0);
    }
}

#[test]
fn a_file_that_does_not_match_the_schema_is_unreadable_and_completion_is_unaffected() {
    let unknown_seam_field =
        MEMORY.replace("value \"Parcel\"", "value \"Parcel\"\n    owner \"alpha\"");
    for memory in [
        "system \"alpha\" {\n    purpose \"x\"\n    unknown \"y\"\n}\n",
        "system alpha {",
        unknown_seam_field.as_str(),
    ] {
        let temp = project(Some(memory));
        let (view, code) = json_of(&temp, &["status", "--json"]);
        assert_eq!(view["system_memory"]["state"], "unreadable", "{memory}");
        assert_eq!(view["overall"]["status"], "green");
        assert_eq!(code, 0);
    }
}

#[test]
fn project_check_discloses_contract_scope_and_explicit_memory_route() {
    let temp = project(Some(MEMORY));
    let invalid = [
        MEMORY.replace(
            "between [\"alpha\", \"beta\"]",
            "from \"alpha\"\n    to \"beta\"",
        ),
        MEMORY.replace("    statement \"everything crosses as one value\"\n", ""),
    ];
    for memory in invalid {
        write(temp.path(), "system.bla", &memory);
        let (view, code) = json_of(&temp, &["check", "--json"]);
        assert_eq!(code, 0);
        assert_eq!(view["status"], "ok");
        assert_eq!(view["contracts"][0]["check"], "ok");
        assert!(view["scope"].is_string(), "{view}");

        let human = run_in(Some(temp.path()), &args(&["check"]));
        assert_eq!(human.status.code(), Some(0));

        let command = view["memory_check"].as_str().unwrap();
        let mut route = command.split_whitespace();
        assert_eq!(route.next(), Some("blabla"));
        let mut arguments: Vec<&str> = route
            .map(|argument| match argument {
                "FILE.bla" => "system.bla",
                other => other,
            })
            .collect();
        arguments.push("--json");
        let (checked, code) = json_of(&temp, &arguments);
        assert_eq!(code, 2);
        assert_eq!(checked["diagnostic"]["code"], "E_MEMORY_FIELD");
    }

    write(temp.path(), "system.bla", MEMORY);
    let (checked, code) = json_of(&temp, &["check", "system.bla", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(checked["status"], "valid");
    assert_eq!(checked["memory"], "system");
    assert_eq!(checked["completion"], "none");
    assert!(!temp.path().join(".blabla").exists());
}

#[test]
fn a_name_in_two_namespaces_is_refused_and_both_identities_resolve() {
    let memory = MEMORY.replace("system \"alpha\"", "system \"fields\"");
    let memory = memory.replace("owner \"alpha\"", "owner \"fields\"");
    let memory = memory.replace("[\"alpha\", \"beta\"]", "[\"fields\", \"beta\"]");
    let temp = project(Some(&memory));
    let (view, exit) = json_of(&temp, &["explain", "fields", "--json"]);
    assert_eq!(exit, 2);
    assert_eq!(view["diagnostic"]["code"], "E_AMBIGUOUS_IDENTITY");

    let (system, code) = json_of(&temp, &["explain", "system::fields", "--json"]);
    assert_eq!(system["id"], "system::fields");
    assert_eq!(code, 0);
    let (rule, code) = json_of(&temp, &["explain", "arch::fields", "--json"]);
    assert_eq!(rule["id"], "arch::fields");
    assert_eq!(code, 0);
}

#[test]
fn a_manifest_may_register_only_one_system_memory() {
    let twice = MANIFEST.replace(
        "system \"system.bla\"\n",
        "system \"system.bla\"\nsystem \"other.json\"\n",
    );
    let temp = built(&twice, Some(MEMORY));
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(code, 2);
    assert_eq!(view["diagnostic"]["code"], "E_DUPLICATE_SYSTEM");
}

#[test]
fn system_memory_is_not_a_layer() {
    let temp = built(
        &MANIFEST.replace("system \"system.bla\"", "use system \"system.bla\""),
        Some(MEMORY),
    );
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(code, 2);
    assert_eq!(view["diagnostic"]["code"], "E_UNSUPPORTED_LAYER");
}

#[test]
fn a_name_in_no_layer_still_reports_an_unknown_rule() {
    let temp = project(Some(MEMORY));
    let (_, code) = json_of(&temp, &["explain", "absent-name", "--json"]);
    assert_eq!(code, 2);
}

#[test]
fn human_views_run_for_every_system_identity() {
    let temp = project(Some(MEMORY));
    for (arguments, id) in [
        (vec!["status"], "system::alpha"),
        (vec!["explain", "system::alpha"], "system::alpha"),
        (vec!["explain", "system::beta"], "system::beta"),
        (
            vec!["explain", "responsibility::carry-facts"],
            "responsibility::carry-facts",
        ),
        (vec!["explain", "seam::handoff"], "seam::handoff"),
    ] {
        let output = run_in(Some(temp.path()), &args(&arguments));
        assert_eq!(output.status.code(), Some(0), "{arguments:?}");
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.contains(id), "{arguments:?}: {text}");
    }
}

#[test]
fn guidance_commands_exit_cleanly_beside_system_memory() {
    let temp = project(Some(MEMORY));
    for arguments in [&["check", "--help"][..], &["guide", "memory"][..]] {
        let output = run_in(Some(temp.path()), &args(arguments));
        assert_eq!(output.status.code(), Some(0), "{arguments:?}");
        assert!(!output.stdout.is_empty(), "{arguments:?}");
    }
}
