use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;

fn write(root: &Path, path: &str, text: &str) {
    let path = root.join(path);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn cli(temp: &TempDir, arguments: &[&str]) -> (i32, Value) {
    let mut args = vec!["--json"];
    args.extend_from_slice(arguments);
    let output = support::run_in(Some(temp.path()), &support::args(&args));
    let value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        panic!(
            "stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    });
    (output.status.code().unwrap(), value)
}

fn success(temp: &TempDir, args: &[&str]) -> Value {
    let (code, value) = cli(temp, args);
    assert_eq!(code, 0, "{args:?}: {value}");
    value
}

fn fixture() -> TempDir {
    let temp = TempDir::new().unwrap();
    write(
        temp.path(),
        "project.bla",
        "project Coverage\ngoal \"goals.bla\"\nprocess \"process.bla\"\nuse structure \"contracts/app.bla\" as architecture\nuse behavior \"contracts/counter.bla\" as counter\ndraft structure \"contracts/planned.bla\" as future\n",
    );
    write(
        temp.path(),
        "goals.bla",
        "goal \"deliver\" { statement \"Deliver the registered requirements\" expect [\"contract::architecture\", \"architecture::entry\", \"architecture::ent\", \"architecture::missing\", \"counter::nonnegative\", \"contract::future\", \"future::planned\", \"contract::absent\"] state \"active\" }\n",
    );
    write(
        temp.path(),
        "process.bla",
        "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\n",
    );
    write(
        temp.path(),
        "contracts/app.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(
        temp.path(),
        "contracts/counter.bla",
        "state x: int\naction step()\nwhen step { expect \"nonnegative\": after.x >= 0 }\n",
    );
    write(
        temp.path(),
        "contracts/planned.bla",
        "module app \"src/app.rs\"\nrequire \"planned\": symbol app::later\n",
    );
    write(temp.path(), "src/app.rs", "pub fn run() {}\n");
    write(temp.path(), "maintenance.txt", "unrelated\n");
    write(temp.path(), "check.py", "raise SystemExit(0)\n");
    temp
}

fn explain(temp: &TempDir) -> Value {
    success(temp, &["explain", "goal::deliver"])
}

fn expectation<'a>(report: &'a Value, identity: &str) -> &'a Value {
    report["coverage"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["identity"] == identity)
        .unwrap_or_else(|| panic!("{identity}: {report}"))
}

fn open_task(temp: &TempDir, name: &str, linked: bool) {
    let scope = if linked {
        "src/app.rs"
    } else {
        "maintenance.txt"
    };
    let mut args = vec![
        "task",
        "open",
        name,
        "--role",
        "worker",
        "--statement",
        "Bounded work",
        "--scope",
        scope,
    ];
    if linked {
        args.extend(["--goal", "deliver"]);
    }
    args.extend([
        "--input",
        scope,
        "check.py",
        "--check-argv",
        "python3",
        "check.py",
    ]);
    success(temp, &args);
    success(temp, &["task", "accept", name, "--model", "worker"]);
}

fn files(root: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut result = BTreeMap::new();
    for item in std::fs::read_dir(root).unwrap() {
        let item = item.unwrap();
        let name = item.file_name().to_string_lossy().into_owned();
        if item.file_type().unwrap().is_dir() {
            for (child, bytes) in files(&item.path()) {
                result.insert(format!("{name}/{child}"), bytes);
            }
        } else {
            result.insert(name, std::fs::read(item.path()).unwrap());
        }
    }
    result
}

#[test]
fn existing_goal_explanation_adds_exact_registration_and_verdict_projection() {
    let temp = fixture();
    let report = explain(&temp);
    assert_eq!(report["id"], "goal::deliver");
    assert_eq!(report["state"], "active");
    assert_eq!(report["outcome"]["expected"], 8);
    let row = expectation(&report, "architecture::entry");
    assert_eq!(row["registration"], "active");
    assert_eq!(row["resolution"], "resolved");
    assert_eq!(row["verdict"], "held");
    assert_eq!(row["path"], "contracts/app.bla");
    assert_eq!(row["contract"], "contract::architecture");
    assert_eq!(row["registered_at"]["line"], 4);
    assert_eq!(
        expectation(&report, "counter::nonnegative")["verdict"],
        "unverified"
    );
    assert_eq!(
        expectation(&report, "contract::architecture")["resolution"],
        "resolved"
    );
}

#[test]
fn partial_names_missing_rules_drafts_and_unregistered_groups_remain_distinct() {
    let report = explain(&fixture());
    for identity in ["architecture::ent", "architecture::missing"] {
        let row = expectation(&report, identity);
        assert_eq!(row["registration"], "active");
        assert_eq!(row["resolution"], "missing_rule");
        assert_eq!(row["verdict"], "unresolved");
    }
    assert_eq!(
        expectation(&report, "contract::future")["registration"],
        "draft"
    );
    assert_eq!(
        expectation(&report, "contract::future")["resolution"],
        "draft_contract"
    );
    assert_eq!(
        expectation(&report, "future::planned")["resolution"],
        "draft_rule_unchecked"
    );
    assert_eq!(
        expectation(&report, "future::planned")["verdict"],
        "unresolved"
    );
    assert_eq!(
        expectation(&report, "contract::absent")["registration"],
        "unregistered"
    );
    assert_eq!(
        expectation(&report, "contract::absent")["resolution"],
        "missing_contract"
    );
}

#[test]
fn explicit_task_goal_links_expose_scope_and_current_evidence_without_per_rule_credit() {
    let temp = fixture();
    open_task(&temp, "implementation", true);
    open_task(&temp, "maintenance", false);
    success(&temp, &["task", "evidence", "implementation", "--run"]);
    let report = explain(&temp);
    let work = report["linked_work"].as_array().unwrap();
    assert_eq!(work.len(), 1);
    assert_eq!(work[0]["id"], "task::implementation");
    assert_eq!(work[0]["scope"], serde_json::json!(["src/app.rs"]));
    assert_eq!(work[0]["evidence"]["current"], true);
    assert_eq!(work[0]["evidence"]["supported"], true);
    assert_eq!(work[0]["latest_exit"], 0);
    assert!(
        expectation(&report, "architecture::entry")
            .get("implemented_by")
            .is_none()
    );
    assert!(report.get("percentage").is_none());
    assert!(report.get("overall").is_none());
    assert_eq!(report["serving_tasks"][0][0], "implementation");
}

#[test]
fn missing_failed_and_stale_task_evidence_are_reported_as_observed() {
    let temp = fixture();
    open_task(&temp, "implementation", true);
    let pending = explain(&temp);
    assert_eq!(pending["linked_work"][0]["evidence"]["supported"], false);
    assert!(pending["linked_work"][0].get("latest_exit").is_none());
    write(temp.path(), "check.py", "raise SystemExit(1)\n");
    success(&temp, &["task", "evidence", "implementation", "--run"]);
    let failed = explain(&temp);
    assert_eq!(failed["linked_work"][0]["evidence"]["supported"], false);
    assert_eq!(failed["linked_work"][0]["latest_exit"], 1);
    write(temp.path(), "check.py", "raise SystemExit(0)\n");
    success(&temp, &["task", "evidence", "implementation", "--run"]);
    write(
        temp.path(),
        "src/app.rs",
        "pub fn run() {}\npub fn changed() {}\n",
    );
    let stale = explain(&temp);
    assert_eq!(stale["linked_work"][0]["evidence"]["current"], false);
    assert_eq!(stale["linked_work"][0]["evidence"]["supported"], false);
    assert_eq!(stale["linked_work"][0]["latest_exit"], 0);
}

#[test]
fn unreadable_task_records_are_visible_and_explanation_is_read_only() {
    let temp = fixture();
    write(temp.path(), ".blabla/tasks/broken.json", "{ invalid json\n");
    let before = files(temp.path());
    let report = explain(&temp);
    assert_eq!(report["task_problems"].as_array().unwrap().len(), 1);
    assert!(
        report["task_problems"][0]
            .as_str()
            .unwrap()
            .contains("task::broken")
    );
    assert_eq!(files(temp.path()), before);
    assert_eq!(explain(&temp), report);
    let output = support::run_in(
        Some(temp.path()),
        &support::args(&["explain", "goal::deliver"]),
    );
    assert!(output.status.success());
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("architecture::entry")
    );
    assert_eq!(files(temp.path()), before);
}

#[test]
fn registered_missing_contract_retains_the_existing_loader_error() {
    let temp = fixture();
    std::fs::remove_file(temp.path().join("contracts/app.bla")).unwrap();
    let (code, report) = cli(&temp, &["explain", "goal::deliver"]);
    assert_ne!(code, 0);
    assert!(
        report.to_string().contains("E_MISSING_CONTRACT"),
        "{report}"
    );
}

#[test]
fn resolved_rule_can_be_not_held_and_draft_syntax_never_claims_coverage() {
    let temp = fixture();
    write(temp.path(), "src/app.rs", "pub fn other() {}\n");
    write(
        temp.path(),
        "contracts/planned.bla",
        "not a valid structure contract\n",
    );
    let report = explain(&temp);
    let active = expectation(&report, "architecture::entry");
    assert_eq!(active["resolution"], "resolved");
    assert_eq!(active["verdict"], "not-held");
    assert_eq!(
        expectation(&report, "future::planned")["resolution"],
        "draft_rule_unchecked"
    );
    assert_eq!(
        expectation(&report, "future::planned")["verdict"],
        "unresolved"
    );
    assert_eq!(report["state"], "active");
}

#[test]
fn new_acceptance_never_reuses_an_old_epoch_result_as_current_evidence() {
    let temp = fixture();
    open_task(&temp, "implementation", true);
    success(&temp, &["task", "evidence", "implementation", "--run"]);
    success(
        &temp,
        &["task", "accept", "implementation", "--model", "worker"],
    );
    let report = explain(&temp);
    assert_eq!(report["linked_work"][0]["evidence"]["recorded"], true);
    assert_eq!(report["linked_work"][0]["evidence"]["current"], false);
    assert_eq!(report["linked_work"][0]["evidence"]["supported"], false);
    assert!(report["linked_work"][0].get("latest_exit").is_none());
}

#[test]
fn exact_rule_labels_are_not_reinterpreted_as_counterexample_routes() {
    let temp = fixture();
    write(
        temp.path(),
        "contracts/app.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\nrequire \"entry/root\": symbol app::run\n",
    );
    write(
        temp.path(),
        "goals.bla",
        "goal \"deliver\" { statement \"Keep the exact label\" expect [\"architecture::entry/root\"] state \"active\" }\n",
    );
    let report = explain(&temp);
    let row = expectation(&report, "architecture::entry/root");
    assert_eq!(row["verdict"], "held");
    assert_eq!(row["resolution"], "resolved");
}
