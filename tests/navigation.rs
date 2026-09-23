#[path = "support/cli.rs"]
mod support;

use serde_json::Value;
use std::path::Path;
use support::{args, run_in};
use tempfile::TempDir;

const MANIFEST: &str = "project Fixture\n\nsystem \"system.bla\"\nprocess \"process.bla\"\n\nuse structure \"contracts/arch.bla\"\n";
const CONTRACT: &str = "module thing \"src/thing.rs\"\n\nrequire \"fields\": symbol thing::FIELDS\nrequire \"entry\": symbol thing::run\n";
const SOURCE: &str = "pub const FIELDS: [&str; 1] = [\"a\"];\npub fn run() {}\n";

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

const PROCESS: &str = r#"
role "orchestrator" {
    purpose "divide the work and decide completion"
    owns ["integration"]
    verification "product"
}

role "worker" {
    purpose "carry out one bounded task"
    verification "focused"
    model "qwen3.5:4b"
}

role "reviewer" {
    purpose "read a finished change and report on it"
    model ["qwen3.5:4b", "haiku", "blabla"]
}

policy "write-scope" {
    statement "a worker writes only the paths it was given"
    applies_to ["worker"]
}
"#;

fn write(root: &Path, relative: &str, text: &str) {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn project() -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "project.bla", MANIFEST);
    write(root, "contracts/arch.bla", CONTRACT);
    write(root, "src/thing.rs", SOURCE);
    write(root, "system.bla", MEMORY);
    write(root, "process.bla", PROCESS);
    temp
}

fn json_of(temp: &TempDir, arguments: &[&str]) -> (Value, i32) {
    let output = run_in(Some(temp.path()), &args(arguments));
    (
        serde_json::from_str(&String::from_utf8(output.stdout).unwrap()).unwrap(),
        output.status.code().unwrap(),
    )
}

fn resolves(temp: &TempDir, id: &str) -> i32 {
    run_in(Some(temp.path()), &args(&["explain", id, "--json"]))
        .status
        .code()
        .unwrap()
}

#[test]
fn an_all_green_project_still_offers_a_coarse_identity_for_every_kind() {
    let temp = project();
    let (view, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(view["overall"]["status"], "green");
    assert_eq!(code, 0);

    let groups: Vec<String> = view["groups"]
        .as_array()
        .unwrap()
        .iter()
        .map(|group| format!("contract::{}", group["name"].as_str().unwrap()))
        .collect();
    assert!(!groups.is_empty());
    for id in &groups {
        assert_eq!(resolves(&temp, id), 0, "{id}");
    }

    let systems: Vec<String> = view["system_memory"]["systems"]
        .as_array()
        .unwrap()
        .iter()
        .map(|name| name.as_str().unwrap().to_owned())
        .collect();
    assert_eq!(systems, ["system::alpha", "system::beta"]);
    for id in &systems {
        assert_eq!(resolves(&temp, id), 0, "{id}");
    }

    let roles: Vec<String> = view["process_memory"]["roles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|name| name.as_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        roles,
        ["role::orchestrator", "role::worker", "role::reviewer"]
    );
    for id in &roles {
        assert_eq!(resolves(&temp, id), 0, "{id}");
    }
}

#[test]
fn a_role_identity_opens_the_policies_that_bind_it() {
    let temp = project();
    let (view, code) = json_of(&temp, &["explain", "role::worker", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(view["id"], "role::worker");
    assert_eq!(view["kind"], "role");
    assert!(view.get("enforcement").is_none(), "{view}");
    assert_eq!(view["verification"], "focused");
    assert_eq!(view["model"], serde_json::json!(["qwen3.5:4b"]));

    let bound = view["policies"][0].as_str().unwrap();
    let policy_id = bound.split_whitespace().next().unwrap();
    assert_eq!(policy_id, "policy::write-scope");
    assert_eq!(resolves(&temp, policy_id), 0);

    let (several, code) = json_of(&temp, &["explain", "role::reviewer", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(
        several["model"],
        serde_json::json!(["qwen3.5:4b", "haiku", "blabla"])
    );

    let (policy, _) = json_of(&temp, &["explain", policy_id, "--json"]);
    assert_eq!(policy["kind"], "policy");
    assert!(policy.get("enforcement").is_none(), "{policy}");
    for role in policy["applies_to"].as_array().unwrap() {
        assert_eq!(resolves(&temp, role.as_str().unwrap()), 0);
    }
}

#[test]
fn process_memory_never_reaches_completion() {
    let temp = project();
    let (with, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(code, 0);
    let broken = temp.path().join("process.bla");
    std::fs::write(
        &broken,
        "policy \"orphan\" {
    statement \"x\"
    applies_to [\"absent\"]
}
",
    )
    .unwrap();
    let (invalid, code) = json_of(&temp, &["status", "--json"]);
    assert_eq!(invalid["process_memory"]["state"], "invalid");
    assert_eq!(invalid["overall"], with["overall"]);
    assert_eq!(invalid["completion"], with["completion"]);
    assert_eq!(code, 0);
}

#[test]
fn a_contract_identity_opens_the_canonical_id_of_every_rule_it_owns() {
    let temp = project();
    let (view, code) = json_of(&temp, &["explain", "contract::arch", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(view["id"], "contract::arch");
    assert_eq!(view["kind"], "contract");
    assert_eq!(view["path"], "contracts/arch.bla");
    assert_eq!(view["counts"]["total"], 2);

    let ids: Vec<String> = view["rules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|rule| rule["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids, ["arch::fields", "arch::entry"]);
    for id in &ids {
        assert_eq!(resolves(&temp, id), 0, "{id}");
    }
}

#[test]
fn a_system_identity_opens_canonical_responsibility_and_seam_identities() {
    let temp = project();
    let (view, code) = json_of(&temp, &["explain", "system::alpha", "--json"]);
    assert_eq!(code, 0);

    let owned = view["owns"][0].as_str().unwrap();
    let seam = view["seams"][0].as_str().unwrap();
    let owned_id = owned.split_whitespace().next().unwrap();
    let seam_id = seam.split_whitespace().next().unwrap();
    assert_eq!(owned_id, "responsibility::carry-facts");
    assert_eq!(seam_id, "seam::handoff");
    assert_eq!(resolves(&temp, owned_id), 0);
    assert_eq!(resolves(&temp, seam_id), 0);

    let (responsibility, _) = json_of(&temp, &["explain", owned_id, "--json"]);
    assert_eq!(
        resolves(&temp, responsibility["owner"].as_str().unwrap()),
        0
    );
    let (opened, _) = json_of(&temp, &["explain", seam_id, "--json"]);
    for side in opened["between"].as_array().unwrap() {
        assert_eq!(resolves(&temp, side.as_str().unwrap()), 0);
    }
}

#[test]
fn a_standalone_check_reports_identities_that_explain_accepts() {
    let temp = project();
    let (view, code) = json_of(&temp, &["check", "contracts/arch.bla", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(view["evaluated"]["state"], "GREEN");

    let broken = temp.path().join("src/thing.rs");
    std::fs::write(&broken, "pub fn run() {}\n").unwrap();
    let (view, code) = json_of(&temp, &["check", "contracts/arch.bla", "--json"]);
    assert_eq!(code, 1);
    let ids: Vec<String> = view["evaluated"]["issues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|issue| issue["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids, ["arch::fields"]);
    std::fs::write(&broken, SOURCE).unwrap();
    for id in &ids {
        assert_eq!(resolves(&temp, id), 0, "{id}");
    }
}

#[test]
fn falsification_reports_identities_that_explain_accepts() {
    let temp = project();
    let (view, _) = json_of(
        &temp,
        &["check", "--falsify", "contracts/arch.bla", "--json"],
    );
    let ids: Vec<String> = view["rules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|rule| rule["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids, ["arch::fields", "arch::entry"]);
    for id in &ids {
        assert_eq!(resolves(&temp, id), 0, "{id}");
    }
}

#[test]
fn a_group_name_alone_is_answered_with_its_canonical_identity() {
    let temp = project();
    let output = run_in(Some(temp.path()), &args(&["explain", "arch", "--json"]));
    assert_eq!(output.status.code().unwrap(), 2);
    let view: Value = serde_json::from_str(&String::from_utf8(output.stdout).unwrap()).unwrap();
    assert_eq!(view["diagnostic"]["code"], "E_COARSE_IDENTITY");
    let message = view["message"].as_str().unwrap();
    assert!(
        message.contains("blabla explain contract::arch"),
        "{message}"
    );
}

#[test]
fn an_unknown_name_names_the_surfaces_that_carry_the_identities() {
    let temp = project();
    let output = run_in(Some(temp.path()), &args(&["explain", "absent", "--json"]));
    assert_eq!(output.status.code().unwrap(), 2);
    let view: Value = serde_json::from_str(&String::from_utf8(output.stdout).unwrap()).unwrap();
    assert_eq!(view["diagnostic"]["code"], "E_UNKNOWN_RULE");
    let message = view["message"].as_str().unwrap();
    assert!(message.contains("contract::"), "{message}");
    assert!(message.contains("system::"), "{message}");
}

#[test]
fn a_group_may_not_take_the_name_of_an_identity_kind() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "project.bla",
        "project Fixture\n\nuse structure \"contracts/arch.bla\" as seam\n",
    );
    write(root, "contracts/arch.bla", CONTRACT);
    write(root, "src/thing.rs", SOURCE);
    let output = run_in(Some(root), &args(&["status", "--json"]));
    assert_eq!(output.status.code().unwrap(), 2);
    let view: Value = serde_json::from_str(&String::from_utf8(output.stdout).unwrap()).unwrap();
    assert_eq!(view["diagnostic"]["code"], "E_RESERVED_GROUP");
}
