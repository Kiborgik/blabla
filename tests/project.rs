use serde_json::Value;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;
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
    assert!(
        text(&human.stderr).contains("blabla init"),
        "{}",
        text(&human.stderr)
    );
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
    let human = text(&human.stdout);
    assert!(human.contains("contracts/behavior/core.bla:11"), "{human}");
    assert!(human.contains("GREEN"), "{human}");

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
    let human = text(&run_in(Some(root), &args(&["explain", "core::persistence"])).stdout);
    assert!(human.contains("Minimal counterexample"), "{human}");
    assert!(human.contains("restart()"), "{human}");

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
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("YELLOW"), "{human}");
    assert!(
        human.contains(&format!("blabla explain {first}")),
        "{human}"
    );
    assert!(
        !human.contains("increment-adds-one\n")
            || next
                .iter()
                .any(|rule| rule["id"] == "core::increment-adds-one")
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
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("STALE"), "{human}");
    assert!(!human.contains("GREEN\n\n"), "{human}");
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

    let (exit, report) = run_project(root, "persistent", &["--cases", "2", "--steps", "12"]);
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
        &["--cases", "1", "--steps", "8", "--shrink-budget", "16"],
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
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    let rule_lines = human
        .lines()
        .filter(|line| {
            line.contains("::") && !line.contains("contract::") && !line.contains("system::")
        })
        .count();
    assert!(rule_lines <= 3, "{human}");
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
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("not authoritative"), "{human}");

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
    assert!(agents.contains("ADVISORY"), "{agents}");
    assert!(agents.contains("blabla finish"), "{agents}");
    assert!(agents.contains("OVERALL GREEN"), "{agents}");
    assert!(agents.contains("YELLOW means NOT COMPLETE"), "{agents}");
    assert!(agents.contains("Do not weaken contracts"), "{agents}");
    assert!(!agents.contains("blabla run --"), "{agents}");
    assert!(agents.contains("command-line tool"), "{agents}");
    assert!(agents.lines().count() <= 30, "{agents}");
    let skill = std::fs::read_to_string(root.join(".agents/skills/blabla/SKILL.md")).unwrap();
    assert!(skill.starts_with("---\nname: blabla\n"), "{skill}");
    assert!(skill.contains("blabla guide bootstrap"), "{skill}");
    assert!(skill.contains("blabla guide change"), "{skill}");
    assert!(skill.contains("blabla finish"), "{skill}");
    assert!(skill.lines().count() <= 60, "{skill}");
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
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("drafts only"), "{human}");
    assert!(!human.contains("rules  GREEN"), "{human}");
    assert!(!human.contains("satisfied"), "{human}");
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
    assert_eq!(actions, ["exists", "exists", "unchanged", "exists"]);
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
    let human = text(&run_in(Some(dry.path()), &args(&["init", "--agents", "--dry-run"])).stdout);
    assert!(human.contains("would create"), "{human}");
    assert!(human.contains("## BlaBla"), "{human}");
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
        agents.starts_with("# Notes\n\n<!-- blabla:start -->\n## BlaBla"),
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
    let agent = run(&args(&["guide", "agent"]));
    assert!(agent.status.success());
    let agent = text(&agent.stdout);
    for required in [
        "executable memory",
        "command-line tool",
        "blabla status",
        "blabla explain",
        "blabla finish",
        "RED",
        "YELLOW",
        "GREEN",
        "NOT COMPLETE",
        "OVERALL GREEN",
        "counterexample",
        "Do not modify .bla contracts",
        "runtime primitive",
        "blabla explain runtime::<name>",
    ] {
        assert!(agent.contains(required), "missing {required}: {agent}");
    }
    assert!(agent.lines().count() <= 28, "{agent}");

    let bootstrap = text(&run(&args(&["guide", "bootstrap"])).stdout);
    for required in [
        "requirements",
        "evidence, not truth",
        "CONFLICT",
        "UNKNOWN",
        "implementation details",
        "skeptic",
        "regression",
        "draft behavior",
        "use behavior",
        "human",
    ] {
        assert!(
            bootstrap.contains(required),
            "missing {required}: {bootstrap}"
        );
    }

    let change = text(&run(&args(&["guide", "change"])).stdout);
    for required in [
        "contracts stay unchanged",
        "contract-author phase",
        "implementation phase",
        "weakening",
        "blabla finish",
    ] {
        assert!(change.contains(required), "missing {required}: {change}");
    }
    assert!(bootstrap.contains("verify behavior"), "{bootstrap}");

    let topics = text(&run(&args(&["guide"])).stdout);
    for topic in ["agent", "bootstrap", "change", "memory"] {
        assert!(
            topics.contains(&format!("blabla guide {topic}")),
            "{topics}"
        );
    }

    let memory = text(&run(&args(&["guide", "memory"])).stdout);
    for declaration in [
        "mission",
        "priority",
        "system",
        "responsibility",
        "seam",
        "role",
        "policy",
        "knowledge",
        "ruling",
    ] {
        assert!(
            memory.contains(declaration),
            "missing {declaration}: {memory}"
        );
    }
    for command in ["blabla check", "blabla status", "blabla explain"] {
        assert!(memory.contains(command), "missing {command}: {memory}");
    }
    assert!(memory.contains("OVERALL"), "{memory}");

    let json_guide = run(&args(&["--json", "guide", "agent"]));
    assert_eq!(json(&json_guide.stdout)["topic"], "agent");

    let help = text(&run(&args(&["--help"])).stdout);
    for required in [
        "status",
        "explain",
        "finish",
        "guide",
        "init",
        "blabla status",
        "blabla finish",
        "project.bla",
    ] {
        assert!(help.contains(required), "missing {required}: {help}");
    }
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
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("Completion:  BLOCKED"), "{human}");
    assert!(human.contains("blabla finish"), "{human}");
    assert!(!human.contains("blabla run --"), "{human}");
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
    let human = text(&run_in(Some(root), &args(&["finish"])).stdout);
    assert!(human.contains("COMPLETION GATE: GREEN"), "{human}");
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("Completion:  GREEN"), "{human}");

    let output = run_in(
        Some(root),
        &args(&[
            "--json",
            "run",
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
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("Completion:  BLOCKED"), "{human}");
    assert!(human.contains("blabla finish"), "{human}");

    let subdirectory = root.join("contracts");
    let output = run_in(
        Some(&subdirectory),
        &args(&[
            "--json",
            "run",
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
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("STALE (profile changed"), "{human}");
    assert_eq!(finish_json(root).0, 0);
    assert_eq!(status_json(root).0, 0);
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
    let human = text(&run_in(Some(root), &args(&["finish"])).stdout);
    assert!(human.contains("COMPLETION GATE: BLOCKED"), "{human}");
    assert!(human.contains("NOT COMPLETE"), "{human}");
    assert!(human.contains("remain unverified"), "{human}");
    let (exit, status) = status_json(root);
    assert_eq!(exit, 5);
    assert_eq!(status["completion"]["state"], "yellow");
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("Completion:  BLOCKED"), "{human}");
    assert!(human.contains("NOT COMPLETE"), "{human}");

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
    let human = text(&run_in(Some(root), &args(&["finish"])).stdout);
    assert!(human.contains("COMPLETION GATE: BLOCKED"), "{human}");
    assert!(human.contains("violated"), "{human}");
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
    assert!(
        text(&human.stderr).contains("COMPLETION GATE: BLOCKED"),
        "{}",
        text(&human.stderr)
    );
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
    assert!(
        text(&human.stderr).contains("verify behavior"),
        "{}",
        text(&human.stderr)
    );
    let (exit, status) = status_json(plain.path());
    assert_eq!(exit, 5);
    assert_eq!(status["completion"]["command"], Value::Null);
    let human = text(&run_in(Some(plain.path()), &args(&["status"])).stdout);
    assert!(human.contains("blabla run -- <application>"), "{human}");
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
    let human = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(human.contains("blabla finish"), "{human}");
    let before = tree(root);
    let (exit, again) = init(root, &["--command", "python", "./other.py"]);
    assert_eq!(exit, 0);
    assert_eq!(again["profile"], true);
    assert_eq!(tree(root), before);
    let human = text(&run_in(Some(TempDir::new().unwrap().path()), &args(&["init"])).stdout);
    assert!(human.contains("verify behavior"), "{human}");
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
    let human = text(&run_in(Some(&nested), &args(&["status"])).stdout);
    assert!(human.contains("blabla run -- <application>"), "{human}");
    assert_eq!(
        status["runtime_primitives"],
        serde_json::json!(["runtime::restart"])
    );
    let primitive_command: Vec<String> = human
        .lines()
        .find(|line| line.contains("runtime::restart"))
        .and_then(|line| line.split('(').nth(1))
        .and_then(|rest| rest.strip_suffix(')'))
        .and_then(|command| command.strip_prefix("blabla "))
        .map(|rest| rest.split_whitespace().map(str::to_owned).collect())
        .unwrap_or_else(|| panic!("status names no runtime primitive command: {human}"));
    assert_eq!(primitive_command, ["explain", "runtime::restart"]);

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
    let rule_text = text(&run_in(Some(&nested), &args(&["explain", "core::persistence"])).stdout);
    assert!(
        rule_text.contains("Depends on:\n  runtime::restart"),
        "{rule_text}"
    );
    assert!(
        rule_text.contains("More:\n  blabla explain runtime::restart"),
        "{rule_text}"
    );

    let primitive_args: Vec<&OsStr> = primitive_command
        .iter()
        .map(|s| OsStr::new(s.as_str()))
        .collect();
    let primitive = run_in(Some(&nested), &primitive_args);
    assert_eq!(primitive.status.code(), Some(0));
    let primitive = text(&primitive.stdout);
    assert!(primitive.starts_with("runtime::restart\n"), "{primitive}");
    for required in [
        "Owned by:",
        "Semantics:",
        "process",
        "Used by:\n  core::persistence",
    ] {
        assert!(
            primitive.contains(required),
            "missing {required}: {primitive}"
        );
    }
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
        assert!(
            human.contains(&format!("\n  {statement}\n")),
            "missing {statement}: {human}"
        );
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
    assert!(human.contains("Used by:\n  core::persistence"), "{human}");
    for project_specific in ["count", "increment", "core::", "vault", "resonance"] {
        let generic = human.split("Used by:").next().unwrap();
        assert!(
            !generic.contains(project_specific),
            "{project_specific}: {generic}"
        );
    }

    let (exit, status) = status_json(root);
    assert_eq!(exit, 0);
    assert_eq!(
        status["runtime_primitives"],
        serde_json::json!(["runtime::restart"])
    );
    let status_text = text(&run_in(Some(root), &args(&["status"])).stdout);
    assert!(
        status_text.contains("Runtime primitives used:\n  runtime::restart"),
        "{status_text}"
    );
    assert!(!status_text.contains("Semantics:"), "{status_text}");

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
    let unrelated_text =
        text(&run_in(Some(root), &args(&["explain", "increment-adds-one"])).stdout);
    assert!(!unrelated_text.contains("Depends on"), "{unrelated_text}");

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
    assert!(!standalone.contains("Used by:"), "{standalone}");
    assert_eq!(
        standalone.trim_end(),
        human.split("\nUsed by:").next().unwrap().trim_end()
    );

    let help = text(&run(&args(&["run", "--help"])).stdout);
    assert!(help.contains("blabla explain runtime::restart"), "{help}");
    assert!(!help.contains("kills and recreates"), "{help}");
}
