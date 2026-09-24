use blabla::project::runstate::{Marker, marker_path, profile_identity};
use blabla::project::{load, read_manifest};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;
use support::{args, run_in};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn layered() -> TempDir {
    let temp = TempDir::new().unwrap();
    copy_tree(&fixtures().join("projects/layered"), temp.path());
    std::fs::copy(
        fixtures().join("lifecycle/app.py"),
        temp.path().join("app.py"),
    )
    .unwrap();
    temp
}

fn json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes)
        .unwrap_or_else(|failure| panic!("{failure}: {}", String::from_utf8_lossy(bytes)))
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8(bytes.to_vec()).unwrap()
}

fn status_json(dir: &Path) -> (i32, Value) {
    let output = run_in(Some(dir), &args(&["--json", "status"]));
    (output.status.code().unwrap(), json(&output.stdout))
}

fn finish_json(dir: &Path) -> (i32, Value) {
    let output = run_in(Some(dir), &args(&["--json", "finish"]));
    (output.status.code().unwrap(), json(&output.stdout))
}

fn rule<'a>(status: &'a Value, id: &str) -> &'a Value {
    status["structure"]["rules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|rule| rule["id"] == id)
        .unwrap_or_else(|| panic!("no rule {id} in {status}"))
}

fn write(path: &Path, content: &str) {
    std::fs::write(path, content).unwrap();
}

fn manifest_with_structure(structure: &str) -> String {
    format!(
        "project Layered\n\nuse structure \"contracts/structure/{structure}\"\nuse behavior \"contracts/behavior/core.bla\"\n\nverify behavior {{\n    command [\"python\", \"app.py\", \"persistent\"]\n    seed 3\n    cases 2\n    steps 12\n    timeout_ms 1000\n    shrink_budget 256\n}}\n"
    )
}

#[test]
fn status_reports_behavior_structure_and_overall_independently() {
    let temp = layered();
    let root = temp.path();
    let (exit, status) = status_json(root);
    assert_eq!(exit, 5, "{status}");
    assert_eq!(status["state"], "unverified");
    assert_eq!(status["structure"]["status"], "green");
    assert_eq!(status["structure"]["verified"], 4);
    assert_eq!(status["structure"]["violated"], 0);
    assert_eq!(status["structure"]["invocations"], 1);
    assert_eq!(status["overall"]["status"], "blocked");
    assert_eq!(status["completion"]["state"], "unverified");
    assert_eq!(status["groups"][0]["layer"], "structure");
    assert_eq!(status["groups"][0]["structure"], "green");
    assert_eq!(status["groups"][0]["counts"]["total"], 4);
    assert_eq!(status["groups"][1]["layer"], "behavior");
    assert_eq!(status["drafts"][0]["layer"], "structure");
    assert_eq!(status["drafts"][0]["check"], "ok");
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("BEHAVIOR   UNVERIFIED"), "{human}");
    assert!(human.contains("STRUCTURE  4/4 rules  GREEN"), "{human}");
    assert!(human.contains("OVERALL    BLOCKED"), "{human}");
    assert!(
        human.contains("structure  contract::architecture"),
        "{human}"
    );
    assert!(human.contains("behavior   contract::core"), "{human}");

    let (exit, finished) = finish_json(root);
    assert_eq!(exit, 0, "{finished}");
    assert_eq!(finished["completion"]["state"], "green");
    assert_eq!(finished["project"]["overall"]["status"], "green");
    assert_eq!(finished["project"]["structure"]["status"], "green");
    let (exit, status) = status_json(root);
    assert_eq!(exit, 0, "{status}");
    assert_eq!(status["state"], "green");
    assert_eq!(status["overall"]["status"], "green");
    assert_eq!(status["completion"]["allowed"], true);
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("BEHAVIOR   3/3 rules  GREEN"), "{human}");
    assert!(human.contains("OVERALL    GREEN"), "{human}");
    assert!(human.contains("Completion:  GREEN"), "{human}");
    let record: Value = json(&std::fs::read(root.join(".blabla/status.json")).unwrap());
    assert!(record["run_id"].is_string());
    assert_eq!(record["structure"]["status"], "green");
    assert!(!marker_path(root).exists());

    let first = text(&run_in(Some(root), &args(&["--json", "status"])).stdout);
    let second = text(&run_in(Some(root), &args(&["--json", "status"])).stdout);
    assert_eq!(
        json(first.as_bytes())["structure"],
        json(second.as_bytes())["structure"]
    );
}

#[test]
fn behavior_green_with_structure_red_blocks_completion_and_explains_the_rule() {
    let temp = layered();
    let root = temp.path();
    write(
        &root.join("contracts/structure/architecture.bla"),
        "module app \"app.py\"\n\nrequire \"storage-declared\": symbol app::storage\nforbid  \"no-subprocess\":   dependency app -> \"subprocess\"\nforbid  \"no-marker\":       symbol app::marker\nrequire \"missing-helper\":  symbol app::helper\nforbid  \"no-modes\":        symbol app::MODES\n",
    );
    let (exit, finished) = finish_json(root);
    assert_eq!(exit, 1, "{finished}");
    assert_eq!(finished["status"], "green");
    assert_eq!(finished["completion"]["state"], "structure_red");
    assert_eq!(finished["completion"]["allowed"], false);
    assert_eq!(finished["project"]["state"], "green");
    assert_eq!(finished["project"]["structure"]["status"], "red");
    assert_eq!(finished["project"]["structure"]["violated"], 3);
    assert_eq!(finished["project"]["overall"]["status"], "blocked");
    let (exit, status) = status_json(root);
    assert_eq!(exit, 1, "{status}");
    assert_eq!(status["state"], "green");
    assert_eq!(status["structure"]["status"], "red");
    assert_eq!(status["overall"]["status"], "blocked");
    assert_eq!(status["completion"]["state"], "structure_red");
    let violated = rule(&status, "architecture::no-subprocess");
    assert_eq!(violated["status"], "red");
    assert_eq!(violated["polarity"], "forbid");
    assert_eq!(violated["file"], "contracts/structure/architecture.bla");
    assert_eq!(violated["line"], 4);
    assert_eq!(violated["provider"], "python");
    assert!(
        violated["observed"]
            .as_str()
            .unwrap()
            .starts_with("app.py:"),
        "{violated}"
    );
    assert_eq!(rule(&status, "architecture::no-marker")["status"], "red");
    assert_eq!(
        rule(&status, "architecture::missing-helper")["status"],
        "red"
    );
    assert_eq!(rule(&status, "architecture::no-modes")["status"], "green");
    assert_eq!(
        rule(&status, "architecture::storage-declared")["status"],
        "green"
    );
    assert_eq!(status["next"][0]["id"], "architecture::no-subprocess");
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("BEHAVIOR   3/3 rules  GREEN"), "{human}");
    assert!(human.contains("STRUCTURE  2/5 rules  RED"), "{human}");
    assert!(human.contains("OVERALL    BLOCKED"), "{human}");
    assert!(human.contains("Structure violations:"), "{human}");
    assert!(
        human.contains("blabla explain architecture::no-subprocess"),
        "{human}"
    );
    let finish_human = text(&run_in(Some(root), &args(&["finish"])).stdout);
    assert!(
        finish_human.contains("COMPLETION GATE: VERIFYING"),
        "{finish_human}"
    );
    assert!(
        finish_human.contains("COMPLETION GATE: BLOCKED"),
        "{finish_human}"
    );
    assert!(
        finish_human.contains("STRUCTURE  2/5 rules  RED"),
        "{finish_human}"
    );

    let output = run_in(
        Some(root),
        &args(&["--json", "explain", "architecture::no-subprocess"]),
    );
    assert_eq!(output.status.code(), Some(0));
    let explained = json(&output.stdout);
    assert_eq!(explained["layer"], "structure");
    assert_eq!(explained["status"], "red");
    assert_eq!(explained["fact"], "dependency app -> \"subprocess\"");
    assert_eq!(
        explained["source"],
        "forbid \"no-subprocess\": dependency app -> \"subprocess\""
    );
    let human = text(&run_in(Some(root), &args(&["explain", "no-marker"])).stdout);
    assert!(
        human.contains("architecture::no-marker\nStatus: RED"),
        "{human}"
    );
    assert!(human.contains("Layer:\n  STRUCTURE"), "{human}");
    assert!(
        human.contains("Contract:\n  contracts/structure/architecture.bla:5"),
        "{human}"
    );
    assert!(human.contains("app must not define marker"), "{human}");
    assert!(human.contains("Observed:\n  app.py:"), "{human}");
    let output = run_in(Some(root), &args(&["explain", "persistence"]));
    assert_eq!(output.status.code(), Some(0));
    assert!(text(&output.stdout).contains("core::persistence"));
}

#[test]
fn structure_green_with_behavior_yellow_blocks_and_all_green_allows() {
    let temp = layered();
    let root = temp.path();
    write(
        &root.join("project.bla"),
        &manifest_with_structure("architecture.bla").replace("steps 12", "steps 1"),
    );
    let (exit, finished) = finish_json(root);
    assert_eq!(exit, 5, "{finished}");
    assert_eq!(finished["status"], "yellow");
    assert_eq!(finished["completion"]["state"], "yellow");
    assert_eq!(finished["project"]["structure"]["status"], "green");
    assert_eq!(finished["project"]["overall"]["status"], "blocked");
    let (exit, status) = status_json(root);
    assert_eq!(exit, 5);
    assert_eq!(status["state"], "yellow");
    assert_eq!(status["structure"]["status"], "green");
    assert_eq!(status["overall"]["status"], "blocked");
}

#[test]
fn a_missing_provider_is_an_error_that_blocks_and_never_greens() {
    let temp = layered();
    let root = temp.path();
    let output = Command::new(env!("CARGO_BIN_EXE_blabla"))
        .current_dir(root)
        .args(["--json", "status"])
        .env("PATH", "")
        .env_remove("Path")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    let status = json(&output.stdout);
    assert_eq!(output.status.code(), Some(3), "{status}");
    assert_eq!(status["structure"]["status"], "error");
    assert_eq!(status["structure"]["errors"], 4);
    assert_eq!(status["completion"]["state"], "structure_error");
    assert_eq!(status["overall"]["status"], "blocked");
    assert!(
        rule(&status, "architecture::no-socket")["message"]
            .as_str()
            .unwrap()
            .contains("python"),
        "{status}"
    );
}

#[test]
fn unsupported_structural_facts_and_layer_mixing_fail_clearly() {
    let temp = layered();
    let root = temp.path();
    write(
        &root.join("contracts/structure/architecture.bla"),
        "module app \"app.py\"\nrequire \"x\": count app::storage\n",
    );
    let output = run_in(Some(root), &args(&["--json", "status"]));
    assert_eq!(output.status.code(), Some(2));
    let error = json(&output.stdout);
    assert_eq!(error["diagnostic"]["code"], "E_STRUCTURE_FACT");
    assert_eq!(error["diagnostic"]["location"]["line"], 2);
    write(
        &root.join("contracts/structure/architecture.bla"),
        "module app \"app.py\"\nstate count: int\n",
    );
    let output = run_in(Some(root), &args(&["--json", "check"]));
    assert_eq!(json(&output.stdout)["diagnostic"]["code"], "E_LAYER_MIX");
    write(
        &root.join("project.bla"),
        &(manifest_with_structure("architecture.bla") + "\nverify structure {\n}\n"),
    );
    let output = run_in(Some(root), &args(&["--json", "status"]));
    assert_eq!(
        json(&output.stdout)["diagnostic"]["code"],
        "E_PROFILE_LAYER"
    );
    write(
        &root.join("project.bla"),
        &manifest_with_structure("architecture.bla").replace("use structure", "use mission"),
    );
    let output = run_in(Some(root), &args(&["--json", "status"]));
    assert_eq!(
        json(&output.stdout)["diagnostic"]["code"],
        "E_UNSUPPORTED_LAYER"
    );
}

#[test]
fn check_lists_structure_contracts_and_a_single_structure_file_compiles() {
    let temp = layered();
    let root = temp.path();
    let output = run_in(Some(root), &args(&["--json", "check"]));
    assert_eq!(output.status.code(), Some(0));
    let check = json(&output.stdout);
    assert_eq!(check["contracts"][0]["layer"], "structure");
    assert_eq!(check["contracts"][0]["rules"], 4);
    assert_eq!(check["contracts"][2]["draft"], true);
    assert_eq!(check["contracts"][2]["layer"], "structure");
    let human = text(&run_in(Some(root), &args(&["check"])).stdout);
    assert!(human.contains("active  structure  architecture"), "{human}");
    let output = run_in(
        Some(root),
        &args(&["check", "contracts/structure/architecture.bla"]),
    );
    assert_eq!(output.status.code(), Some(0), "{}", text(&output.stderr));
    assert!(
        text(&output.stdout).contains("4 rules"),
        "{}",
        text(&output.stdout)
    );
}

#[test]
fn a_structure_only_project_finishes_without_a_campaign() {
    let temp = layered();
    let root = temp.path();
    write(
        &root.join("project.bla"),
        "project StructureOnly\n\nuse structure \"contracts/structure/architecture.bla\"\n",
    );
    let (exit, finished) = finish_json(root);
    assert_eq!(exit, 0, "{finished}");
    assert_eq!(finished["completion"]["state"], "green");
    assert_eq!(finished["project"]["overall"]["status"], "green");
    assert_eq!(finished["project"]["state"], "no_active_contracts");
    let (exit, status) = status_json(root);
    assert_eq!(exit, 0, "{status}");
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("BEHAVIOR   none declared"), "{human}");
    assert!(human.contains("OVERALL    GREEN"), "{human}");
}

fn sleeping_python() -> std::process::Child {
    Command::new("python")
        .args(["-c", "import time; time.sleep(60)"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
}

#[test]
fn an_interrupted_or_running_finish_never_leaves_a_current_green() {
    let temp = layered();
    let root = temp.path();
    let (exit, _) = finish_json(root);
    assert_eq!(exit, 0);
    let project = load(read_manifest(&root.join("project.bla")).unwrap()).unwrap();
    let identity = project.identity.clone();
    let profile = profile_identity(project.manifest.profile.as_ref());
    let mut sleeper = sleeping_python();
    let now = blabla::project::status::now_unix();
    let marker = Marker {
        run_id: "feedfacefeedfacefeedfacefeedface".into(),
        pid: sleeper.id(),
        started_unix: now,
        verifier_version: env!("CARGO_PKG_VERSION").into(),
        project_identity: identity.clone(),
        profile_identity: profile.clone(),
        profile: project.manifest.profile.clone(),
    };
    std::fs::write(marker_path(root), serde_json::to_vec(&marker).unwrap()).unwrap();
    let (exit, status) = status_json(root);
    assert_eq!(exit, 5, "{status}");
    assert_eq!(status["state"], "verifying");
    assert_eq!(status["completion"]["state"], "verifying");
    assert_eq!(status["run_state"]["classification"], "verifying");
    assert_eq!(status["overall"]["status"], "blocked");
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("BEHAVIOR   VERIFYING"), "{human}");
    let output = run_in(Some(root), &args(&["--json", "finish"]));
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(
        json(&output.stdout)["diagnostic"]["code"],
        "E_FINISH_RUNNING"
    );
    let explained = json(&run_in(Some(root), &args(&["--json", "explain", "persistence"])).stdout);
    assert_eq!(explained["state"], "verifying");

    let mut other = marker.clone();
    other.project_identity = "0000000000000000".into();
    std::fs::write(marker_path(root), serde_json::to_vec(&other).unwrap()).unwrap();
    let (exit, status) = status_json(root);
    assert_eq!(exit, 5, "{status}");
    assert_eq!(status["state"], "interrupted");

    sleeper.kill().unwrap();
    sleeper.wait().unwrap();
    std::fs::write(marker_path(root), serde_json::to_vec(&marker).unwrap()).unwrap();
    let (exit, status) = status_json(root);
    assert_eq!(exit, 5, "{status}");
    assert_eq!(status["state"], "interrupted");
    assert_eq!(status["completion"]["state"], "interrupted");
    assert_eq!(status["overall"]["status"], "blocked");
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("BEHAVIOR   INTERRUPTED"), "{human}");
    assert!(human.contains("last recorded: GREEN"), "{human}");
    assert!(human.contains("Next:\n  blabla finish"), "{human}");

    let (exit, finished) = finish_json(root);
    assert_eq!(exit, 0, "{finished}");
    assert!(!marker_path(root).exists());
    let record: Value = json(&std::fs::read(root.join(".blabla/status.json")).unwrap());
    let mut completed = marker.clone();
    completed.run_id = record["run_id"].as_str().unwrap().to_owned();
    completed.pid = 1;
    std::fs::write(marker_path(root), serde_json::to_vec(&completed).unwrap()).unwrap();
    let (exit, status) = status_json(root);
    assert_eq!(exit, 0, "{status}");
    assert_eq!(status["state"], "green");
    assert!(status["run_state"].is_null());
}

#[test]
fn finish_flushes_its_header_before_the_campaign_and_reports_progress() {
    let temp = layered();
    let root = temp.path();
    write(
        &root.join("project.bla"),
        &manifest_with_structure("architecture.bla")
            .replace("\"persistent\"", "\"slow\"")
            .replace("steps 12", "steps 20"),
    );
    let started = Instant::now();
    let mut child = Command::new(env!("CARGO_BIN_EXE_blabla"))
        .current_dir(root)
        .arg("finish")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    let mut header = String::new();
    while !header.contains("Behavior:\n  starting canonical verification") {
        let mut line = String::new();
        let read = reader.read_line(&mut line).unwrap();
        assert!(read > 0, "stdout closed before the header: {header}");
        header.push_str(&line);
    }
    let header_seen = started.elapsed();
    assert!(header.contains("COMPLETION GATE: VERIFYING"), "{header}");
    assert!(
        header.contains("Structure:\n  4/4 rules  GREEN"),
        "{header}"
    );
    let mut rest = String::new();
    for line in reader.lines() {
        rest.push_str(&line.unwrap());
        rest.push('\n');
    }
    let status = child.wait().unwrap();
    let total = started.elapsed();
    assert!(
        header_seen < total / 2,
        "header after {header_seen:?} of {total:?}"
    );
    assert!(
        rest.contains("obligations") && rest.contains("/40 actions"),
        "{rest}"
    );
    assert!(rest.contains("COMPLETION GATE: GREEN"), "{rest}");
    assert_eq!(status.code(), Some(0));
    let output = run_in(Some(root), &args(&["--json", "finish"]));
    assert_eq!(output.status.code(), Some(0));
    let stderr = text(&output.stderr);
    assert!(stderr.contains("COMPLETION GATE: VERIFYING"), "{stderr}");
    assert!(stderr.contains("/40 actions"), "{stderr}");
    assert!(json(&output.stdout)["completion"]["state"] == "green");
}

#[test]
fn check_structure_contract_inside_project_evaluates_green_with_exit_zero() {
    let temp = layered();
    let root = temp.path();
    let output = run_in(
        Some(root),
        &args(&["--json", "check", "contracts/structure/architecture.bla"]),
    );
    assert_eq!(output.status.code().unwrap(), 0);
    let check = json(&output.stdout);
    assert_eq!(check["layer"], "structure");
    assert_eq!(check["evaluated"]["state"], "GREEN");
    assert_eq!(check["evaluated"]["verified"], 4);
    assert_eq!(check["evaluated"]["total"], 4);
    assert!(check["project"].is_string());
}

#[test]
fn mutating_source_file_turns_structure_contract_red_with_exit_one() {
    let temp = layered();
    let root = temp.path();
    write(
        &root.join("app.py"),
        &text(&std::fs::read(root.join("app.py")).unwrap()).replace("import json", ""),
    );
    let output = run_in(
        Some(root),
        &args(&["--json", "check", "contracts/structure/architecture.bla"]),
    );
    assert_eq!(output.status.code().unwrap(), 1);
    let check = json(&output.stdout);
    assert_eq!(check["evaluated"]["state"], "RED");
    assert_eq!(check["evaluated"]["verified"], 3);
    assert_eq!(check["evaluated"]["total"], 4);
    let issues = check["evaluated"]["issues"].as_array().unwrap();
    let violated_ids: Vec<String> = issues
        .iter()
        .filter(|issue| issue["status"] == "RED")
        .map(|issue| issue["id"].as_str().unwrap().to_string())
        .collect();
    assert!(
        violated_ids.contains(&"architecture::uses-json".to_string()),
        "violated_ids: {violated_ids:?}"
    );
}

#[test]
fn sibling_structure_contract_stays_green_when_peer_module_is_mutated() {
    let temp = layered();
    let root = temp.path();
    write(
        &root.join("app.py"),
        &text(&std::fs::read(root.join("app.py")).unwrap()).replace("import json", ""),
    );
    write(
        &root.join("contracts/structure/minimal.bla"),
        "module app \"app.py\"\n\nrequire \"has-storage\": symbol app::storage\n",
    );
    let output = run_in(
        Some(root),
        &args(&["--json", "check", "contracts/structure/minimal.bla"]),
    );
    assert_eq!(output.status.code().unwrap(), 0, "{}", text(&output.stderr));
    let check = json(&output.stdout);
    assert_eq!(check["evaluated"]["state"], "GREEN");
    assert_eq!(check["evaluated"]["verified"], 1);
    assert_eq!(check["evaluated"]["total"], 1);
}

#[test]
fn structure_contract_without_project_above_compiles_but_is_not_evaluated() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    std::fs::create_dir_all(root.join("contracts/structure")).unwrap();
    std::fs::copy(
        fixtures().join("projects/layered/contracts/structure/architecture.bla"),
        root.join("contracts/structure/architecture.bla"),
    )
    .unwrap();
    let output = run_in(
        Some(root),
        &args(&["--json", "check", "contracts/structure/architecture.bla"]),
    );
    assert_eq!(output.status.code().unwrap(), 0);
    let check = json(&output.stdout);
    assert!(check.get("evaluated").is_none(), "{}", check);
    assert!(check.get("project").is_none(), "{}", check);
    assert_eq!(check["status"], "ok");
    assert_eq!(check["layer"], "structure");
}

#[test]
fn empty_structure_contract_is_rejected_with_e_no_rules() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    std::fs::create_dir_all(root.join("contracts/structure")).unwrap();
    write(
        &root.join("contracts/structure/empty.bla"),
        "module app \"app.py\"\n",
    );
    let output = run_in(
        Some(root),
        &args(&["--json", "check", "contracts/structure/empty.bla"]),
    );
    assert_eq!(output.status.code().unwrap(), 2, "{}", text(&output.stderr));
    let check = json(&output.stdout);
    assert_eq!(check["status"], "error");
    assert_eq!(check["diagnostic"]["code"], "E_NO_RULES");
    assert!(
        check["diagnostic"]["message"]
            .as_str()
            .unwrap()
            .contains("declares no rules")
    );
}

#[test]
fn empty_structure_contract_in_project_fails_at_load_time() {
    let temp = layered();
    let root = temp.path();
    write(
        &root.join("project.bla"),
        &manifest_with_structure("empty_no_rules.bla"),
    );
    write(
        &root.join("contracts/structure/empty_no_rules.bla"),
        "module app \"app.py\"\n",
    );
    let output = run_in(Some(root), &args(&["--json", "status"]));
    assert_eq!(output.status.code().unwrap(), 2);
    let status = json(&output.stdout);
    assert_eq!(status["status"], "error");
    assert_eq!(status["diagnostic"]["code"], "E_NO_RULES");
}
