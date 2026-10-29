use serde_json::Value;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

use crate::support;
use support::{args, run, run_in};

fn fixture(name: &str) -> TempDir {
    let temp = TempDir::new().unwrap();
    copy_tree(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/projects")
            .join(name),
        temp.path(),
    );
    temp
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

fn lifecycle_app() -> String {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/lifecycle/app.py")
        .to_string_lossy()
        .into_owned()
}

fn json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes)
        .unwrap_or_else(|failure| panic!("{failure}: {}", String::from_utf8_lossy(bytes)))
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8(bytes.to_vec()).unwrap()
}

fn run_project(dir: &Path, mode: &str, extra: &[&str]) -> (i32, Value) {
    let app = lifecycle_app();
    let mut arguments = vec!["--json", "run"];
    arguments.extend_from_slice(extra);
    arguments.extend_from_slice(&["--", "python", app.as_str(), mode]);
    let output = run_in(Some(dir), &args(&arguments));
    (output.status.code().unwrap(), json(&output.stdout))
}

fn status_json(dir: &Path) -> (i32, Value) {
    let output = run_in(Some(dir), &args(&["--json", "status"]));
    (output.status.code().unwrap(), json(&output.stdout))
}

fn write(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, content).unwrap();
}

#[test]
fn status_discovers_the_nearest_manifest_and_honors_the_explicit_override() {
    let temp = fixture("nested");
    let root = temp.path();
    let (exit, nested) = status_json(&root.join("apps/server/src/domain"));
    assert_eq!(exit, 5);
    assert_eq!(nested["project"], "Server");
    assert_eq!(nested["state"], "unverified");
    let (_, from_root) = status_json(root);
    assert_eq!(from_root["project"], "Root");
    let (_, from_apps) = status_json(&root.join("apps"));
    assert_eq!(from_apps["project"], "Root");

    let server_manifest = root.join("apps/server/project.bla");
    let output = run_in(
        Some(root),
        &args(&[
            "--json",
            "--project",
            server_manifest.to_str().unwrap(),
            "status",
        ]),
    );
    assert_eq!(json(&output.stdout)["project"], "Server");
    let output = run_in(
        Some(&root.join("apps/server/src")),
        &args(&["--json", "--project", root.to_str().unwrap(), "status"]),
    );
    assert_eq!(json(&output.stdout)["project"], "Root");

    let empty = TempDir::new().unwrap();
    let output = run_in(Some(empty.path()), &args(&["--json", "status"]));
    assert_eq!(output.status.code(), Some(2));
    let error = json(&output.stdout);
    assert_eq!(error["diagnostic"]["code"], "E_NO_PROJECT");
    let human = run_in(Some(empty.path()), &args(&["status"]));
    assert_eq!(human.status.code(), Some(2));
}

#[test]
fn project_run_records_status_that_status_and_explain_report() {
    let temp = fixture("simple");
    let root = temp.path();
    let (exit, before) = status_json(root);
    assert_eq!(exit, 5);
    assert_eq!(before["state"], "unverified");
    assert_eq!(before["rules"]["total"], 3);
    assert!(before["recorded"].is_null());

    let (exit, report) = run_project(root, "persistent", &["--cases", "2", "--steps", "12"]);
    assert_eq!(exit, 0, "{report}");
    assert_eq!(report["status"], "green");
    assert_eq!(report["project"]["state"], "green");
    assert_eq!(report["project"]["project"], "Simple");
    assert!(root.join(".blabla/status.json").is_file());

    let (exit, green) = status_json(root);
    assert_eq!(exit, 0, "{green}");
    assert_eq!(green["state"], "green");
    assert_eq!(green["rules"]["green"], 3);
    assert_eq!(green["groups"][0]["state"], "green");
    assert_eq!(green["groups"][0]["counts"]["total"], 3);
    assert_eq!(green["actions"]["exercised"], 2);
    assert_eq!(green["recorded"]["status"], "green");
    assert_eq!(green["recorded"]["stale"].as_array().unwrap().len(), 0);
    assert!(green["next"].as_array().unwrap().is_empty());

    let output = run_in(
        Some(&root.join("contracts")),
        &args(&["--json", "explain", "persistence"]),
    );
    assert_eq!(output.status.code(), Some(0));
    let explained = json(&output.stdout);
    assert_eq!(explained["id"], "core::persistence");
    assert_eq!(explained["state"], "green");
    assert_eq!(explained["file"], "contracts/behavior/core.bla");
    assert_eq!(explained["line"], 11);
    assert_eq!(explained["action"], "restart");
    assert!(!explained["obligations"].as_array().unwrap().is_empty());
    let human = run_in(Some(root), &args(&["explain", "core::persistence"]));
    assert_eq!(human.status.code(), Some(0));

    let (exit, red) = run_project(
        root,
        "memory",
        &["--cases", "1", "--steps", "8", "--shrink-budget", "16"],
    );
    assert_eq!(exit, 1, "{red}");
    assert_eq!(red["project"]["state"], "red");
    let (exit, status) = status_json(root);
    assert_eq!(exit, 1);
    assert_eq!(status["state"], "red");
    assert_eq!(status["rules"]["red"], 1);
    assert_eq!(status["next"][0]["id"], "core::persistence");
    assert_eq!(status["next"][0]["state"], "red");
    let output = run_in(
        Some(root),
        &args(&["--json", "explain", "core::persistence"]),
    );
    let explained = json(&output.stdout);
    assert_eq!(explained["state"], "red");
    assert!(
        !explained["failure"]["minimal_sequence"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    let (exit, yellow) = run_project(root, "persistent", &["--cases", "1", "--steps", "1"]);
    assert_eq!(exit, 5, "{yellow}");
    let (exit, status) = status_json(root);
    assert_eq!(exit, 5);
    assert_eq!(status["state"], "yellow");
    assert!(status["rules"]["yellow"].as_u64().unwrap() >= 1);
    let next = status["next"].as_array().unwrap();
    assert!(!next.is_empty() && next.len() <= 3);
    let first = next[0]["id"].as_str().unwrap();
    let output = run_in(Some(root), &args(&["--json", "explain", first]));
    let explained = json(&output.stdout);
    assert_eq!(explained["state"], "yellow");
    assert!(
        explained["obligations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|obligation| {
                obligation["status"] == "unexercised"
                    && !obligation["required_witness"].as_str().unwrap().is_empty()
            })
    );
    assert_eq!(
        run_in(Some(root), &args(&["status"])).status.code(),
        Some(5)
    );
}

#[test]
fn recorded_green_goes_stale_when_implementation_contracts_or_command_files_change() {
    let temp = fixture("simple");
    let root = temp.path();
    let outside = TempDir::new().unwrap();
    let app_copy = outside.path().join("app.py");
    std::fs::copy(lifecycle_app(), &app_copy).unwrap();
    let app = app_copy.to_string_lossy().into_owned();
    let output = run_in(
        Some(root),
        &args(&[
            "--json",
            "run",
            "--cases",
            "2",
            "--steps",
            "12",
            "--",
            "python",
            app.as_str(),
            "persistent",
        ]),
    );
    assert_eq!(output.status.code(), Some(0), "{}", text(&output.stdout));
    assert_eq!(status_json(root).0, 0);

    write(&root.join("src/main.py"), "print('v1')");
    let (exit, stale) = status_json(root);
    assert_eq!(exit, 5);
    assert_eq!(stale["state"], "stale");
    assert_eq!(
        stale["recorded"]["stale"],
        serde_json::json!(["implementation"])
    );
    assert_eq!(stale["rules"]["green"], 0);
    std::fs::remove_file(root.join("src/main.py")).unwrap();
    assert_eq!(status_json(root).0, 0);

    let mut app_source = std::fs::read_to_string(&app_copy).unwrap();
    app_source.push('\n');
    std::fs::write(&app_copy, app_source).unwrap();
    let (exit, stale) = status_json(root);
    assert_eq!(exit, 5);
    assert_eq!(
        stale["recorded"]["stale"],
        serde_json::json!(["implementation"])
    );
    std::fs::copy(lifecycle_app(), &app_copy).unwrap();
    assert_eq!(status_json(root).0, 0);

    let contract = root.join("contracts/behavior/core.bla");
    let mut source = std::fs::read_to_string(&contract).unwrap();
    source.push_str("\nalways \"bounded\" { count <= 1000000 }\n");
    std::fs::write(&contract, source).unwrap();
    let (exit, stale) = status_json(root);
    assert_eq!(exit, 5);
    assert_eq!(stale["state"], "stale");
    assert_eq!(stale["recorded"]["stale"], serde_json::json!(["contracts"]));
    assert_eq!(stale["rules"]["total"], 4);
    let output = run_in(Some(root), &args(&["--json", "explain", "bounded"]));
    assert_eq!(json(&output.stdout)["state"], "stale");
}

#[test]
fn multi_contract_project_shares_state_across_files_and_aggregates_groups() {
    let temp = fixture("multi");
    let root = temp.path();
    let output = run_in(Some(root), &args(&["--json", "check"]));
    assert_eq!(output.status.code(), Some(0));
    let check = json(&output.stdout);
    assert_eq!(check["status"], "ok");
    assert_eq!(check["contracts"].as_array().unwrap().len(), 3);
    assert_eq!(check["actions"], 2);
    assert_eq!(check["postconditions"], 3);
    assert_eq!(check["invariants"], 1);

    let (exit, report) = run_project(
        root,
        "persistent",
        &["--timeout-ms", "10000", "--cases", "2", "--steps", "12"],
    );
    assert_eq!(exit, 0, "{report}");
    let (exit, status) = status_json(&root.join("contracts/behavior"));
    assert_eq!(exit, 0);
    assert_eq!(status["state"], "green");
    assert_eq!(status["rules"]["total"], 4);
    let groups = status["groups"].as_array().unwrap();
    let counts: Vec<(&str, u64)> = groups
        .iter()
        .map(|group| {
            (
                group["name"].as_str().unwrap(),
                group["counts"]["total"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(counts, [("core", 1), ("persistence", 1), ("feature", 2)]);
    let sum: u64 = groups
        .iter()
        .map(|group| group["counts"]["green"].as_u64().unwrap())
        .sum();
    assert_eq!(sum, status["rules"]["green"].as_u64().unwrap());

    let (exit, red) = run_project(
        root,
        "memory",
        &[
            "--timeout-ms",
            "10000",
            "--cases",
            "1",
            "--steps",
            "8",
            "--shrink-budget",
            "16",
        ],
    );
    assert_eq!(exit, 1, "{red}");
    let (exit, status) = status_json(root);
    assert_eq!(exit, 1);
    assert_eq!(status["state"], "red");
    let red_groups: Vec<&str> = status["groups"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|group| group["state"] == "red")
        .map(|group| group["name"].as_str().unwrap())
        .collect();
    assert_eq!(red_groups, ["persistence"]);
    assert_eq!(status["next"][0]["id"], "persistence::persistence");
    assert!(status["next"].as_array().unwrap().len() <= 3);
}

#[test]
fn shared_state_reports_all_contract_sources() {
    for (accidental, reordered) in [(false, false), (true, false), (false, true), (true, true)] {
        let temp = fixture("multi");
        let root = temp.path();
        let mut contracts = vec!["contract::core", "contract::feature"];
        if accidental {
            let manifest = root.join("project.bla");
            let mut source = std::fs::read_to_string(&manifest).unwrap();
            source.push_str("\nuse behavior \"contracts/behavior/unrelated.bla\"\n");
            write(&manifest, &source);
            write(
                &root.join("contracts/behavior/unrelated.bla"),
                "state count: int\nalways \"collision-remains-shared\" { count >= 0 }\n",
            );
            contracts.push("contract::unrelated");
        }
        if reordered {
            let manifest = root.join("project.bla");
            let source = std::fs::read_to_string(&manifest).unwrap();
            let mut entries: Vec<_> = source
                .lines()
                .filter(|line| line.starts_with("use "))
                .collect();
            entries.reverse();
            write(
                &manifest,
                &format!("project Multi\n{}\n", entries.join("\n")),
            );
        }
        let expected = serde_json::json!([{
            "name": "count",
            "type": "int",
            "contracts": contracts,
        }]);
        let check = run_in(Some(root), &args(&["--json", "check"]));
        assert_eq!(check.status.code(), Some(0));
        assert_eq!(json(&check.stdout)["shared_state"], expected);
        let (exit, report) = run_project(root, "persistent", &["--cases", "2", "--steps", "12"]);
        assert_eq!(exit, 0, "{report}");
        let (exit, status) = status_json(root);
        assert_eq!(exit, 0, "{status}");
        assert_eq!(status["shared_state"], expected);
        assert_eq!(status["actions"]["total"], 2);
        assert_eq!(status["rules"]["total"], if accidental { 5 } else { 4 });
        for command in ["check", "status"] {
            let output = run_in(Some(root), &args(&[command]));
            assert_eq!(output.status.code(), Some(0));
        }
    }
    let collision = fixture("collision");
    let output = run_in(Some(collision.path()), &args(&["--json", "check"]));
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(
        json(&output.stdout)["diagnostic"]["code"],
        "E_INCOMPATIBLE_STATE"
    );

    let draft = fixture("draft");
    let output = run_in(Some(draft.path()), &args(&["--json", "check"]));
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(json(&output.stdout)["shared_state"], serde_json::json!([]));
}

#[test]
fn shared_state_reports_resolved_types() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        &root.join("project.bla"),
        "project Types\nuse behavior \"one.bla\"\nuse behavior \"two.bla\"\n",
    );
    for (file, entry) in [("one.bla", "Item"), ("two.bla", "Renamed")] {
        write(
            &root.join(file),
            &format!(
                "type {entry} {{ id: string, valid: bool }}\nstate flag: bool\nstate ratio: float\nstate label: string\nstate item: optional<{entry}>\nstate values: [int]\naction inspect()\nalways \"nonempty\" {{ count(values) >= 0 }}\n"
            ),
        );
    }
    let output = run_in(Some(root), &args(&["--json", "check"]));
    assert_eq!(output.status.code(), Some(0));
    let check = json(&output.stdout);
    let types: Vec<_> = check["shared_state"]
        .as_array()
        .unwrap()
        .iter()
        .map(|state| {
            assert_eq!(
                state["contracts"],
                serde_json::json!(["contract::one", "contract::two"])
            );
            (
                state["name"].as_str().unwrap(),
                state["type"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        types,
        [
            ("flag", "bool"),
            ("ratio", "float"),
            ("label", "string"),
            ("item", "optional<{ id: string, valid: bool }>"),
            ("values", "[int]")
        ]
    );
}

#[test]
fn collision_fixture_fails_naming_every_conflicting_file() {
    let temp = fixture("collision");
    let root = temp.path();
    for command in [&["--json", "check"][..], &["--json", "status"][..]] {
        let output = run_in(Some(root), &args(command));
        assert_eq!(output.status.code(), Some(2));
        let error = json(&output.stdout);
        assert_eq!(error["diagnostic"]["code"], "E_INCOMPATIBLE_STATE");
        let message = error["diagnostic"]["message"].as_str().unwrap();
        assert!(message.contains("contracts/behavior/core.bla"), "{message}");
        assert!(
            message.contains("contracts/behavior/other.bla"),
            "{message}"
        );
        assert_eq!(
            error["diagnostic"]["location"]["file"],
            "contracts/behavior/other.bla"
        );
    }
    let human = run_in(Some(root), &args(&["check"]));
    assert_eq!(human.status.code(), Some(2));
    assert!(text(&human.stderr).contains("E_INCOMPATIBLE_STATE"));
}

#[test]
fn drafts_are_listed_checked_and_excluded_from_verification() {
    let temp = fixture("draft");
    let root = temp.path();
    let output = run_in(Some(root), &args(&["--json", "check"]));
    assert_eq!(output.status.code(), Some(0));
    let check = json(&output.stdout);
    let contracts = check["contracts"].as_array().unwrap();
    assert_eq!(contracts[0]["name"], "core");
    assert_eq!(contracts[0]["draft"], false);
    assert_eq!(contracts[1]["name"], "next");
    assert_eq!(contracts[1]["draft"], true);
    assert_eq!(contracts[1]["check"], "ok");
    let (exit, status) = status_json(root);
    assert_eq!(exit, 5);
    assert_eq!(status["rules"]["total"], 1);
    assert_eq!(status["drafts"][0]["name"], "next");
    assert_eq!(status["drafts"][0]["check"], "ok");

    let (exit, report) = run_project(root, "persistent", &["--cases", "1", "--steps", "6"]);
    assert_eq!(exit, 0, "{report}");
    assert_eq!(report["project"]["rules"]["total"], 1);
    let output = run_in(Some(root), &args(&["--json", "explain", "persistence"]));
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(json(&output.stdout)["diagnostic"]["code"], "E_UNKNOWN_RULE");

    write(&root.join("next.bla"), "state count: string");
    let output = run_in(Some(root), &args(&["--json", "check"]));
    assert_eq!(output.status.code(), Some(2));
    let check = json(&output.stdout);
    assert_eq!(check["status"], "error");
    assert!(
        check["contracts"][1]["check"]
            .as_str()
            .unwrap()
            .contains("E_INCOMPATIBLE_STATE")
    );
    let (exit, status) = status_json(root);
    assert_eq!(exit, 0);
    assert_eq!(status["state"], "green");
    assert!(
        status["drafts"][0]["check"]
            .as_str()
            .unwrap()
            .contains("E_INCOMPATIBLE_STATE")
    );
}

fn init(dir: &Path, extra: &[&str]) -> (i32, Value) {
    let mut arguments = vec!["--json", "init"];
    arguments.extend_from_slice(extra);
    let output = run_in(Some(dir), &args(&arguments));
    (output.status.code().unwrap(), json(&output.stdout))
}

fn tree(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(root).unwrap() {
        let entry = entry.unwrap();
        if entry.file_type().unwrap().is_dir() {
            files.extend(tree(&entry.path()));
        } else {
            files.push((entry.path(), std::fs::read(entry.path()).unwrap()));
        }
    }
    files.sort();
    files
}

#[test]
fn init_creates_a_draft_project_idempotently_and_preserves_agents_md() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let original = "# My project\n\nKeep this paragraph.\n";
    write(&root.join("AGENTS.md"), original);
    let (exit, outcome) = init(root, &["--agents", "--name", "Demo"]);
    assert_eq!(exit, 0, "{outcome}");
    let actions: Vec<(&str, &str)> = outcome["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| {
            (
                step["path"].as_str().unwrap(),
                step["action"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        actions,
        [
            ("project.bla", "create"),
            ("contracts/behavior/core.bla", "create"),
            ("AGENTS.md", "appended"),
            (".agents/skills/blabla/SKILL.md", "create"),
            (".claude/skills/blabla/SKILL.md", "create"),
        ]
    );
    let manifest = std::fs::read_to_string(root.join("project.bla")).unwrap();
    assert!(manifest.starts_with("project Demo\n"), "{manifest}");
    assert!(
        manifest.contains("draft behavior \"contracts/behavior/core.bla\""),
        "{manifest}"
    );
    assert!(!manifest.contains("use behavior"), "{manifest}");
    let agents = std::fs::read_to_string(root.join("AGENTS.md")).unwrap();
    assert!(agents.starts_with(original), "{agents}");
    assert_eq!(agents.matches("<!-- blabla:start -->").count(), 1);
    assert_eq!(agents.matches("<!-- blabla:end -->").count(), 1);
    assert!(agents.contains("blabla status"), "{agents}");
    for identity in [
        "contract::<group>",
        "<group>::<label>",
        "system::<name>",
        "responsibility::<name>",
        "seam::<name>",
        "role::<name>",
        "policy::<name>",
        "runtime::<name>",
    ] {
        assert!(agents.contains(identity), "missing {identity}: {agents}");
    }
    assert!(agents.contains("blabla explain <identity>"), "{agents}");
    assert!(agents.contains("blabla finish"), "{agents}");
    assert!(!agents.contains("blabla run --"), "{agents}");
    assert!(agents.lines().count() <= 30, "{agents}");
    let skill = std::fs::read_to_string(root.join(".agents/skills/blabla/SKILL.md")).unwrap();
    assert!(skill.starts_with("---\nname: blabla\n"), "{skill}");
    assert!(skill.contains("blabla guide bootstrap"), "{skill}");
    assert!(skill.contains("blabla guide change"), "{skill}");
    assert!(skill.contains("blabla finish"), "{skill}");
    assert!(skill.lines().count() <= 80, "{skill}");
    assert_eq!(outcome["profile"], false);
    let manifest = std::fs::read_to_string(root.join("project.bla")).unwrap();
    assert!(!manifest.contains("verify behavior"), "{manifest}");

    let output = run_in(Some(root), &args(&["--json", "check"]));
    assert_eq!(output.status.code(), Some(0), "{}", text(&output.stdout));
    let check = json(&output.stdout);
    assert_eq!(check["contracts"][0]["draft"], true);
    assert_eq!(check["contracts"][0]["check"], "ok");
    let (exit, status) = status_json(root);
    assert_eq!(exit, 5);
    assert_eq!(status["state"], "no_active_contracts");
    assert_eq!(status["drafts"][0]["name"], "core");
    assert_eq!(status["rules"]["total"], 0);
    let (exit, refused) = run_project(root, "persistent", &["--cases", "1", "--steps", "1"]);
    assert_eq!(exit, 2);
    assert_eq!(refused["diagnostic"]["code"], "E_NO_CONTRACTS");

    let before = tree(root);
    let (exit, again) = init(root, &["--agents", "--name", "Demo"]);
    assert_eq!(exit, 0);
    let actions: Vec<&str> = again["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| step["action"].as_str().unwrap())
        .collect();
    assert_eq!(
        actions,
        ["exists", "exists", "unchanged", "exists", "exists"]
    );
    assert_eq!(tree(root), before);

    std::fs::write(
        root.join("contracts/behavior/core.bla"),
        "state x: int\naction a()\nwhen a { expect \"k\": after.x >= 0 }\n",
    )
    .unwrap();
    let before = tree(root);
    let (exit, _) = init(root, &[]);
    assert_eq!(exit, 0);
    assert_eq!(tree(root), before);

    let dry = TempDir::new().unwrap();
    let (exit, plan) = init(dry.path(), &["--agents", "--dry-run"]);
    assert_eq!(exit, 0);
    assert!(
        plan["steps"]
            .as_array()
            .unwrap()
            .iter()
            .all(|step| step["action"] == "would create")
    );
    assert!(
        plan["agents_block"]
            .as_str()
            .unwrap()
            .contains("<!-- blabla:start -->")
    );
    assert!(std::fs::read_dir(dry.path()).unwrap().next().is_none());
    let human = run_in(Some(dry.path()), &args(&["init", "--agents", "--dry-run"]));
    assert_eq!(human.status.code(), Some(0));
    assert!(std::fs::read_dir(dry.path()).unwrap().next().is_none());

    let broken = TempDir::new().unwrap();
    write(
        &broken.path().join("AGENTS.md"),
        "# Notes\n<!-- blabla:start -->\nhalf a block\n",
    );
    let (exit, error) = init(broken.path(), &["--agents"]);
    assert_eq!(exit, 2);
    assert_eq!(error["category"], "init");
    assert_eq!(
        std::fs::read_to_string(broken.path().join("AGENTS.md")).unwrap(),
        "# Notes\n<!-- blabla:start -->\nhalf a block\n"
    );

    let (exit, error) = init(TempDir::new().unwrap().path(), &["--name", "9lives"]);
    assert_eq!(exit, 2);
    assert_eq!(error["category"], "init");
}

#[test]
fn init_updates_an_outdated_managed_block_in_place() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        &root.join("AGENTS.md"),
        "# Notes\n\n<!-- blabla:start -->\nold instructions\n<!-- blabla:end -->\n\n## After\n\nKept.\n",
    );
    let (exit, outcome) = init(root, &["--agents"]);
    assert_eq!(exit, 0, "{outcome}");
    let agents = std::fs::read_to_string(root.join("AGENTS.md")).unwrap();
    assert!(
        agents.starts_with("# Notes\n\n<!-- blabla:start -->\n"),
        "{agents}"
    );
    assert!(
        agents.ends_with("<!-- blabla:end -->\n\n## After\n\nKept.\n"),
        "{agents}"
    );
    assert!(!agents.contains("old instructions"));
    let step = outcome["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| step["path"] == "AGENTS.md")
        .unwrap();
    assert_eq!(step["action"], "updated");
}

#[test]
fn guides_and_help_carry_compact_onboarding() {
    for topic in ["agent", "bootstrap", "change", "memory", "loop"] {
        let guide = run(&args(&["--json", "guide", topic]));
        assert!(guide.status.success(), "{topic}");
        assert_eq!(json(&guide.stdout)["topic"], topic);
    }
    let agent = run(&args(&["guide", "agent"]));
    assert!(agent.status.success());
    assert!(text(&agent.stdout).lines().count() <= 28);
    assert!(run(&args(&["guide"])).status.success());
    assert!(run(&args(&["--help"])).status.success());
}

fn profile_manifest(command: &[&str], settings: &str) -> String {
    let elements: Vec<String> = command.iter().map(|part| format!("\"{part}\"")).collect();
    format!(
        "project Simple\n\nuse behavior \"contracts/behavior/core.bla\"\n\nverify behavior {{\n    command [{}]\n{settings}}}\n",
        elements.join(", ")
    )
}

fn finish_json(dir: &Path) -> (i32, Value) {
    let output = run_in(Some(dir), &args(&["--json", "finish"]));
    (output.status.code().unwrap(), json(&output.stdout))
}

fn profiled_fixture(command: &[&str], settings: &str) -> TempDir {
    let temp = fixture("simple");
    std::fs::copy(lifecycle_app(), temp.path().join("app.py")).unwrap();
    write(
        &temp.path().join("project.bla"),
        &profile_manifest(command, settings),
    );
    temp
}

#[test]
fn finish_runs_the_canonical_profile_from_the_project_root_and_gates_completion() {
    let temp = profiled_fixture(
        &["python", "app.py", "persistent"],
        "    seed 3\n    cases 2\n    steps 12\n",
    );
    let root = temp.path();
    let (exit, status) = status_json(root);
    assert_eq!(exit, 5);
    assert_eq!(status["completion"]["state"], "unverified");
    assert_eq!(status["completion"]["allowed"], false);
    assert_eq!(status["completion"]["command"], "blabla finish");
    assert_eq!(status["profile"]["steps"], 12);
    let explained = json(&run_in(Some(root), &args(&["--json", "explain", "persistence"])).stdout);
    assert_eq!(explained["verification"], "blabla finish");

    let nested = root.join("contracts").join("behavior");
    let (exit, finished) = finish_json(&nested);
    assert_eq!(exit, 0, "{finished}");
    assert_eq!(finished["status"], "green");
    assert_eq!(finished["seed"], 3);
    assert_eq!(finished["cases"], 2);
    assert_eq!(finished["steps"], 12);
    assert_eq!(finished["completion"]["state"], "green");
    assert_eq!(finished["completion"]["allowed"], true);
    assert_eq!(finished["project"]["completion"]["state"], "green");
    let (exit, status) = status_json(&nested);
    assert_eq!(exit, 0, "{status}");
    assert_eq!(status["state"], "green");
    assert_eq!(status["completion"]["state"], "green");
    assert_eq!(status["completion"]["allowed"], true);
    assert_eq!(status["recorded"]["canonical"], true);
    assert_eq!(
        status["recorded"]["application"],
        serde_json::json!(["python", "app.py", "persistent"])
    );
    assert_eq!(
        run_in(Some(root), &args(&["finish"])).status.code(),
        Some(0)
    );
    assert_eq!(
        run_in(Some(root), &args(&["status"])).status.code(),
        Some(0)
    );

    let output = run_in(
        Some(root),
        &args(&[
            "--json",
            "run",
            "--timeout-ms",
            "10000",
            "--cases",
            "2",
            "--steps",
            "16",
            "--",
            "python",
            "app.py",
            "persistent",
        ]),
    );
    assert_eq!(output.status.code(), Some(0), "{}", text(&output.stdout));
    let manual = json(&output.stdout);
    assert_eq!(manual["status"], "green");
    assert!(manual.get("completion").is_none());
    assert_eq!(manual["project"]["completion"]["state"], "not_canonical");
    let (exit, status) = status_json(root);
    assert_eq!(exit, 5);
    assert_eq!(status["state"], "green");
    assert_eq!(status["completion"]["state"], "not_canonical");
    assert_eq!(status["recorded"]["canonical"], false);
    assert_eq!(status["completion"]["command"], "blabla finish");

    let subdirectory = root.join("contracts");
    let output = run_in(
        Some(&subdirectory),
        &args(&[
            "--json",
            "run",
            "--timeout-ms",
            "10000",
            "--cases",
            "2",
            "--steps",
            "12",
            "--",
            "python",
            "../app.py",
            "persistent",
        ]),
    );
    assert_eq!(output.status.code(), Some(0), "{}", text(&output.stdout));
    assert_eq!(finish_json(root).0, 0);
    assert_eq!(status_json(root).0, 0);

    let manifest = root.join("project.bla");
    write(
        &manifest,
        &profile_manifest(
            &["python", "app.py", "persistent"],
            "    seed 3\n    cases 2\n    steps 13\n",
        ),
    );
    let (exit, status) = status_json(root);
    assert_eq!(exit, 5);
    assert_eq!(status["state"], "stale");
    assert_eq!(status["recorded"]["stale"], serde_json::json!(["profile"]));
    assert_eq!(status["completion"]["state"], "stale");
    assert_eq!(
        run_in(Some(root), &args(&["status"])).status.code(),
        Some(5)
    );
    assert_eq!(finish_json(root).0, 0);
    assert_eq!(status_json(root).0, 0);
}

#[test]
fn green_status_keeps_unfinished_tasks_separate_and_requires_an_explicit_choice() {
    let temp = profiled_fixture(
        &["python", "app.py", "persistent"],
        "    seed 3\n    cases 1\n    steps 12\n",
    );
    let root = temp.path();
    let (exit, finished) = finish_json(root);
    assert_eq!(exit, 0, "{finished}");

    for name in ["one", "two"] {
        let scope = format!("src/{name}");
        let deliverable = format!("{scope}/thing.py");
        let output = run_in(
            Some(root),
            &args(&[
                "task",
                "open",
                name,
                "--role",
                "worker",
                "--statement",
                "a bounded change",
                "--scope",
                &scope,
                "--deliverable",
                &deliverable,
                "--json",
                "--check",
                "cargo test --lib",
            ]),
        );
        assert_eq!(
            output.status.code(),
            Some(0),
            "{} {}",
            text(&output.stdout),
            text(&output.stderr)
        );
    }

    let (exit, status) = status_json(root);
    assert_eq!(exit, 0, "{status}");
    assert_eq!(status["completion"]["state"], "green");
    assert_eq!(status["bounded_tasks"]["open"], 2);
    let listed: Vec<&str> = status["bounded_tasks"]["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|task| task["id"].as_str().unwrap())
        .collect();
    assert_eq!(listed, ["task::one", "task::two"]);
}

#[test]
fn finish_blocks_completion_for_yellow_red_and_errors() {
    let temp = profiled_fixture(
        &["python", "app.py", "persistent"],
        "    cases 1\n    steps 1\n",
    );
    let root = temp.path();
    let (exit, yellow) = finish_json(root);
    assert_eq!(exit, 5, "{yellow}");
    assert_eq!(yellow["status"], "yellow");
    assert_eq!(yellow["completion"]["state"], "yellow");
    assert_eq!(yellow["completion"]["allowed"], false);
    assert_eq!(
        run_in(Some(root), &args(&["finish"])).status.code(),
        Some(5)
    );
    let (exit, status) = status_json(root);
    assert_eq!(exit, 5);
    assert_eq!(status["completion"]["state"], "yellow");
    assert_eq!(
        run_in(Some(root), &args(&["status"])).status.code(),
        Some(5)
    );

    write(
        &root.join("project.bla"),
        &profile_manifest(
            &["python", "app.py", "memory"],
            "    cases 1\n    steps 8\n    shrink_budget 16\n",
        ),
    );
    let (exit, red) = finish_json(root);
    assert_eq!(exit, 1, "{red}");
    assert_eq!(red["status"], "red");
    assert_eq!(red["completion"]["state"], "red");
    assert_eq!(
        run_in(Some(root), &args(&["finish"])).status.code(),
        Some(1)
    );
    assert_eq!(status_json(root).0, 1);
    assert_eq!(status_json(root).1["completion"]["state"], "red");

    write(
        &root.join("project.bla"),
        &profile_manifest(&["python", "missing/app.py", "persistent"], ""),
    );
    let (exit, error) = finish_json(root);
    assert_eq!(exit, 2, "{error}");
    assert_eq!(error["status"], "error");
    assert_eq!(error["completion"], "error");
    assert_eq!(error["diagnostic"]["code"], "E_APPLICATION_PATH");
    assert!(
        error["diagnostic"]["message"]
            .as_str()
            .unwrap()
            .contains("missing/app.py")
    );
    let human = run_in(Some(root), &args(&["finish"]));
    assert_eq!(human.status.code(), Some(2));
    let output = run_in(
        Some(root),
        &args(&[
            "--json",
            "run",
            "--",
            "python",
            "missing/app.py",
            "persistent",
        ]),
    );
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(
        json(&output.stdout)["diagnostic"]["code"],
        "E_APPLICATION_PATH"
    );

    write(
        &root.join("project.bla"),
        &profile_manifest(&["blabla-no-such-program-xyz", "app.py"], ""),
    );
    let (exit, error) = finish_json(root);
    assert_eq!(exit, 3, "{error}");
    assert_eq!(error["completion"], "error");
    assert_eq!(error["code"], "APP_SPAWN");

    let plain = fixture("simple");
    let (exit, error) = finish_json(plain.path());
    assert_eq!(exit, 2, "{error}");
    assert_eq!(error["completion"], "error");
    assert_eq!(error["diagnostic"]["code"], "E_NO_VERIFY_PROFILE");
    let human = run_in(Some(plain.path()), &args(&["finish"]));
    assert_eq!(human.status.code(), Some(2));
    let (exit, status) = status_json(plain.path());
    assert_eq!(exit, 5);
    assert_eq!(status["completion"]["command"], Value::Null);
}

#[test]
fn init_writes_the_verification_profile_when_given_a_command() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let (exit, outcome) = init(
        root,
        &["--name", "Demo", "--command", "python", "./main.py"],
    );
    assert_eq!(exit, 0, "{outcome}");
    assert_eq!(outcome["profile"], true);
    let manifest = std::fs::read_to_string(root.join("project.bla")).unwrap();
    assert!(manifest.contains("verify behavior {"), "{manifest}");
    assert!(
        manifest.contains("command [\"python\", \"./main.py\"]"),
        "{manifest}"
    );
    assert!(manifest.contains("steps 32"), "{manifest}");
    let output = run_in(Some(root), &args(&["--json", "check"]));
    assert_eq!(output.status.code(), Some(0), "{}", text(&output.stdout));
    assert_eq!(status_json(root).1["profile"]["steps"], 32);
    let before = tree(root);
    let (exit, again) = init(root, &["--command", "python", "./other.py"]);
    assert_eq!(exit, 0);
    assert_eq!(again["profile"], true);
    assert_eq!(tree(root), before);
    let bare = run_in(Some(TempDir::new().unwrap().path()), &args(&["init"]));
    assert_eq!(bare.status.code(), Some(0));
}

#[test]
fn a_fresh_agent_reaches_status_and_explain_from_the_generated_agents_block_alone() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    assert_eq!(init(root, &["--agents"]).0, 0);
    let manifest_path = root.join("project.bla");
    let promoted = std::fs::read_to_string(&manifest_path)
        .unwrap()
        .replace("draft behavior", "use behavior");
    std::fs::write(&manifest_path, promoted).unwrap();
    let agents = std::fs::read_to_string(root.join("AGENTS.md")).unwrap();
    let commands: Vec<Vec<String>> = agents
        .lines()
        .filter_map(|line| line.trim().strip_prefix("blabla "))
        .map(|rest| rest.split_whitespace().map(str::to_owned).collect())
        .collect();
    assert!(commands.iter().any(|command| command == &["status"]));
    assert!(commands.iter().any(|command| command[0] == "explain"));
    assert!(commands.iter().any(|command| command == &["finish"]));
    assert!(
        commands
            .iter()
            .any(|command| command == &["guide", "agent"])
    );

    let nested = root.join("src/deeper");
    std::fs::create_dir_all(&nested).unwrap();
    let status = run_in(Some(&nested), &args(&["--json", "status"]));
    assert_eq!(status.status.code(), Some(5));
    let status = json(&status.stdout);
    assert_eq!(status["state"], "unverified");
    assert_eq!(status["rules"]["total"], 3);
    let first_rule = status["groups"][0]["name"].as_str().unwrap().to_owned();
    assert_eq!(first_rule, "core");
    assert_eq!(
        status["runtime_primitives"],
        serde_json::json!(["runtime::restart"])
    );
    let primitive_command = [
        "explain".to_owned(),
        status["runtime_primitives"][0].as_str().unwrap().to_owned(),
    ];

    let explain: Vec<&OsStr> = args(&["--json", "explain", "core::persistence"]);
    let explained = run_in(Some(&nested), &explain);
    assert_eq!(explained.status.code(), Some(0));
    let explained = json(&explained.stdout);
    assert_eq!(explained["file"], "contracts/behavior/core.bla");
    assert_eq!(explained["state"], "unverified");
    assert_eq!(
        explained["depends_on"],
        serde_json::json!(["runtime::restart"])
    );

    let primitive_args: Vec<&OsStr> = primitive_command
        .iter()
        .map(|s| OsStr::new(s.as_str()))
        .collect();
    let primitive = run_in(Some(&nested), &primitive_args);
    assert_eq!(primitive.status.code(), Some(0));
    assert!(text(&primitive.stdout).starts_with("runtime::restart\n"));
    let machine = json(
        &run_in(
            Some(&nested),
            &args(&["--json", "explain", "runtime::restart"]),
        )
        .stdout,
    );
    assert_eq!(machine["used_by"], serde_json::json!(["core::persistence"]));
    let guide = run_in(Some(&nested), &args(&["guide", "agent"]));
    assert!(guide.status.success());
}

#[test]
fn runtime_primitive_semantics_render_from_one_source_on_every_surface() {
    let temp = fixture("simple");
    let root = temp.path();
    let (exit, _) = run_project(root, "persistent", &["--cases", "2", "--steps", "12"]);
    assert_eq!(exit, 0);

    let machine = run_in(
        Some(root),
        &args(&["--json", "explain", "runtime::restart"]),
    );
    assert_eq!(machine.status.code(), Some(0));
    let machine = json(&machine.stdout);
    let human = run_in(Some(root), &args(&["explain", "runtime::restart"]));
    assert_eq!(human.status.code(), Some(0));
    let human = text(&human.stdout);
    assert_eq!(machine["id"], "runtime::restart");
    assert!(human.starts_with("runtime::restart\n"), "{human}");
    assert!(
        human.contains(machine["owner"].as_str().unwrap()),
        "{human}"
    );
    assert!(
        human.contains(machine["distinction"].as_str().unwrap()),
        "{human}"
    );
    let facts = machine["semantics"].as_array().unwrap();
    assert!(facts.len() >= 4);
    let mut keys: Vec<&str> = Vec::new();
    for fact in facts {
        let statement = fact["statement"].as_str().unwrap();
        assert!(human.contains(statement), "missing {statement}: {human}");
        assert!(fact["holds"].is_boolean());
        keys.push(fact["key"].as_str().unwrap());
    }
    for key in [
        "process_recreated",
        "process_memory_preserved",
        "persistent_environment_preserved",
        "reset_requested",
    ] {
        assert!(keys.contains(&key), "{keys:?}");
    }
    assert_eq!(machine["used_by"], serde_json::json!(["core::persistence"]));
    assert!(human.contains("core::persistence"), "{human}");

    let (exit, status) = status_json(root);
    assert_eq!(exit, 0);
    assert_eq!(
        status["runtime_primitives"],
        serde_json::json!(["runtime::restart"])
    );

    let rule = json(&run_in(Some(root), &args(&["--json", "explain", "persistence"])).stdout);
    assert_eq!(rule["depends_on"], serde_json::json!(["runtime::restart"]));
    let action = json(&run_in(Some(root), &args(&["--json", "explain", "action/restart"])).stdout);
    assert_eq!(
        action["depends_on"],
        serde_json::json!(["runtime::restart"])
    );
    let unrelated = json(
        &run_in(
            Some(root),
            &args(&["--json", "explain", "increment-adds-one"]),
        )
        .stdout,
    );
    assert_eq!(unrelated["depends_on"], serde_json::json!([]));

    let unknown = run_in(Some(root), &args(&["explain", "runtime::reset"]));
    assert_eq!(unknown.status.code(), Some(2));
    assert!(text(&unknown.stderr).contains("runtime::restart"));

    let elsewhere = TempDir::new().unwrap();
    let standalone = run_in(
        Some(elsewhere.path()),
        &args(&["explain", "runtime::restart"]),
    );
    assert_eq!(standalone.status.code(), Some(0));
    let standalone = text(&standalone.stdout);
    assert!(!standalone.contains("core::persistence"), "{standalone}");
    assert!(human.starts_with(standalone.trim_end()), "{human}");

    let help = text(&run(&args(&["run", "--help"])).stdout);
    assert!(help.contains("blabla explain runtime::restart"), "{help}");
}

const PAIR_APP: &str = "import json\nimport sys\nleak = sys.argv[1:] == [\"leak\"]\nstate = {\"alpha\": 0, \"beta\": 0}\nfor line in sys.stdin:\n    request = json.loads(line)\n    if request[\"op\"] == \"reset\":\n        state = {\"alpha\": 0, \"beta\": 0}\n    elif request[\"op\"] == \"call\":\n        target = request[\"name\"][len(\"raise_\"):]\n        state[target] += 1\n        if leak and target == \"alpha\":\n            state[\"beta\"] += 1\n    result = dict(state) if request[\"op\"] == \"observe\" else {\"ok\": True}\n    print(json.dumps({\"id\": request[\"id\"], \"result\": result}), flush=True)\n";

fn pair_project(mode: &str) -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(&root.join("app.py"), PAIR_APP);
    for name in ["alpha", "beta"] {
        write(
            &root.join(format!("{name}.bla")),
            &format!(
                "state {name}: int\naction raise_{name}()\nwhen raise_{name} {{ expect \"{name}-grows\": after.{name} == before.{name} + 1 }}\n"
            ),
        );
    }
    write(
        &root.join("project.bla"),
        &format!(
            "project Pair\nuse behavior \"alpha.bla\"\nuse behavior \"beta.bla\"\n\nverify behavior {{\n    command [\"python\", \"app.py\", \"{mode}\"]\n    seed 0\n    cases 1\n    steps 8\n    timeout_ms 10000\n}}\n"
        ),
    );
    temp
}

#[test]
fn finish_runs_one_campaign_per_independent_group_and_records_a_canonical_result() {
    let temp = pair_project("plain");
    let root = temp.path();
    let (exit, finished) = finish_json(root);
    assert_eq!(exit, 0, "{finished}");
    let campaigns = finished["campaigns"].as_array().unwrap();
    let members: Vec<&Value> = campaigns
        .iter()
        .map(|campaign| &campaign["contracts"])
        .collect();
    assert_eq!(
        members,
        [&serde_json::json!(["alpha"]), &serde_json::json!(["beta"])]
    );
    let ceilings: Vec<&Value> = campaigns
        .iter()
        .map(|campaign| &campaign["ceiling"])
        .collect();
    assert_eq!(ceilings, [&serde_json::json!(8), &serde_json::json!(8)]);
    let executed: Vec<u64> = campaigns
        .iter()
        .map(|campaign| campaign["steps_executed"].as_u64().unwrap())
        .collect();
    assert!(executed.iter().max() <= Some(&8));
    assert_eq!(finished["steps_executed"], executed.iter().sum::<u64>());
    assert_eq!(finished["seed"], 0);
    let (exit, status) = status_json(root);
    assert_eq!(exit, 0, "{status}");
    assert_eq!(status["recorded"]["canonical"], true);
}

#[test]
fn verbose_human_run_and_finish_show_one_line_per_campaign() {
    let temp = pair_project("plain");
    let root = temp.path();
    let app = root.join("app.py").to_string_lossy().into_owned();
    let run_command = ["run", "--", "python", app.as_str(), "plain"];
    for command in [&["finish"][..], &run_command[..]] {
        let structured =
            json(&run_in(Some(root), &args(&[&["--json"][..], command].concat())).stdout);
        let identities: Vec<String> = structured["campaigns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|campaign| {
                campaign["contracts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|name| format!("contract::{}", name.as_str().unwrap()))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .collect();
        assert_eq!(identities.len(), 2, "{structured}");
        let [plain, verbose] = [&[][..], &["--verbose"][..]].map(|flags| {
            let output = run_in(Some(root), &args(&[flags, command].concat()));
            assert_eq!(output.status.code(), Some(0));
            text(&output.stdout)
        });
        let carrying = |human: &str, identity: &str| {
            human.lines().filter(|line| line.contains(identity)).count()
        };
        for identity in &identities {
            assert_eq!(
                carrying(&verbose, identity),
                carrying(&plain, identity) + 1,
                "{verbose}"
            );
        }
    }
}

#[test]
fn an_application_coupling_between_separate_campaigns_blocks_finish() {
    let temp = pair_project("leak");
    let (exit, error) = finish_json(temp.path());
    assert_eq!(exit, 2, "{error}");
    assert_eq!(error["diagnostic"]["code"], "BLA-RUN-COUPLING");
    assert_eq!(error["completion"], "error");
}

const PROBE_APP: &str = "import json\nimport os\nimport sys\nimport tempfile\nroot = os.path.dirname(os.path.abspath(__file__))\nrecords = os.path.join(root, \".blabla\")\ncount = 0\nfor line in sys.stdin:\n    request = json.loads(line)\n    if request[\"op\"] == \"reset\":\n        count = 0\n        cwd = os.getcwd()\n        temp = tempfile.gettempdir()\n        with open(os.path.join(cwd, \"scratch.txt\"), \"w\") as scratch:\n            scratch.write(\"scratch\")\n        if temp.startswith(cwd):\n            with open(os.path.join(temp, \"scratch.txt\"), \"w\") as scratch:\n                scratch.write(\"scratch\")\n        with open(os.path.join(records, \"probe.jsonl\"), \"a\") as probe:\n            probe.write(json.dumps({\"cwd\": cwd, \"gettempdir\": temp, \"temp\": [os.environ.get(name, \"\") for name in (\"TMP\", \"TEMP\", \"TMPDIR\")]}) + \"\\n\")\n        if os.path.exists(os.path.join(records, \"rewrite\")):\n            with open(os.path.join(root, \"notes.txt\"), \"w\") as notes:\n                notes.write(\"rewritten\")\n    elif request[\"op\"] == \"call\":\n        count += 1\n    result = {\"count\": count} if request[\"op\"] == \"observe\" else {\"ok\": True}\n    print(json.dumps({\"id\": request[\"id\"], \"result\": result}), flush=True)\n";

fn probe_project() -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(&root.join("app.py"), PROBE_APP);
    write(&root.join("notes.txt"), "original");
    write(
        &root.join("bump.bla"),
        "state count: int\naction bump()\nwhen bump { expect \"bump-counts\": after.count == before.count + 1 }\n",
    );
    write(
        &root.join("project.bla"),
        "project Probe\nuse behavior \"bump.bla\"\n\nverify behavior {\n    command [\"python\", \"app.py\"]\n    seed 0\n    cases 1\n    steps 4\n    timeout_ms 10000\n}\n",
    );
    std::fs::create_dir_all(root.join(".blabla")).unwrap();
    temp
}

#[test]
fn finish_runs_each_application_inside_the_project_run_directory_without_touching_the_tree() {
    let project = probe_project();
    let root = project.path();
    let opened = run_in(
        Some(root),
        &args(&[
            "task",
            "open",
            "probe",
            "--role",
            "worker",
            "--statement",
            "observe the tree",
            "--scope",
            "app.py",
            "--deliverable",
            "app.py",
            "--check",
            "true",
        ]),
    );
    assert_eq!(opened.status.code(), Some(0), "{}", text(&opened.stderr));
    let (exit, finished) = finish_json(root);
    assert_eq!(exit, 0, "{finished}");

    let runs = root.join(".blabla").join("run");
    let probes: Vec<Value> = std::fs::read_to_string(root.join(".blabla").join("probe.jsonl"))
        .unwrap()
        .lines()
        .map(|line| json(line.as_bytes()))
        .collect();
    assert!(!probes.is_empty());
    for probe in &probes {
        let cwd = PathBuf::from(probe["cwd"].as_str().unwrap());
        let temporary = PathBuf::from(probe["gettempdir"].as_str().unwrap());
        assert!(cwd.starts_with(&runs), "{probe}");
        assert!(temporary.starts_with(&cwd) && temporary != cwd, "{probe}");
        let expected = probe["gettempdir"].clone();
        assert_eq!(
            probe["temp"],
            serde_json::json!([expected.clone(), expected.clone(), expected])
        );
    }
    assert_eq!(std::fs::read_dir(&runs).unwrap().count(), 0);

    let (exit, status) = status_json(root);
    assert_eq!(exit, 0, "{status}");
    assert_eq!(status["recorded"]["stale"], serde_json::json!([]));
    let shown = json(&run_in(Some(root), &args(&["--json", "task", "show", "probe"])).stdout);
    assert_eq!(
        shown["changed_since_open"],
        serde_json::json!([]),
        "{shown}"
    );
    assert_eq!(shown["changed_elsewhere"], 0, "{shown}");
}

#[test]
fn an_implementation_change_during_finish_records_nothing_and_names_the_changed_path() {
    let project = probe_project();
    let root = project.path();
    let (exit, finished) = finish_json(root);
    assert_eq!(exit, 0, "{finished}");
    let recorded = std::fs::read(root.join(".blabla").join("status.json")).unwrap();

    write(&root.join(".blabla").join("rewrite"), "");
    let (exit, error) = finish_json(root);
    assert_eq!(exit, 2, "{error}");
    assert_eq!(error["diagnostic"]["code"], "BLA-RUN-INPUTS-CHANGED");
    assert_eq!(error["diagnostic"]["location"]["file"], "notes.txt");
    assert_eq!(error["completion"], "error");
    assert_eq!(
        std::fs::read(root.join(".blabla").join("status.json")).unwrap(),
        recorded
    );
}
