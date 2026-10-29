use crate::support;

use support::{args, json_of, run_in, write};
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
fn explain_answers_a_bare_or_unknown_name_with_a_diagnostic_code() {
    let temp = project();
    for (name, code) in [("arch", "E_COARSE_IDENTITY"), ("absent", "E_UNKNOWN_RULE")] {
        let (view, exit) = json_of(&temp, &["explain", name, "--json"]);
        assert_eq!(exit, 2, "{name}");
        assert_eq!(view["diagnostic"]["code"], code, "{name}");
    }
}
