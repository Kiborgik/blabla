use serde_json::{Value, json};
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

fn cli(root: &Path, args: &[&str]) -> (i32, Value) {
    let mut arguments = vec!["--json"];
    arguments.extend_from_slice(args);
    let output = support::run_in(Some(root), &support::args(&arguments));
    let value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        json!({"stdout":String::from_utf8_lossy(&output.stdout),"stderr":String::from_utf8_lossy(&output.stderr)})
    });
    (output.status.code().unwrap(), value)
}

fn success(root: &Path, args: &[&str]) -> Value {
    let (exit, value) = cli(root, args);
    assert_eq!(exit, 0, "{args:?}: {value}");
    value
}

fn files(root: &Path) -> BTreeMap<String, Option<Vec<u8>>> {
    fn walk(root: &Path, here: &Path, out: &mut BTreeMap<String, Option<Vec<u8>>>) {
        for entry in std::fs::read_dir(here).unwrap() {
            let path = entry.unwrap().path();
            let name = path
                .strip_prefix(root)
                .unwrap()
                .to_str()
                .unwrap()
                .to_owned();
            if path.is_dir() {
                out.insert(name, None);
                walk(root, &path, out);
            } else {
                out.insert(name, Some(std::fs::read(path).unwrap()));
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

fn refusal(root: &Path, args: &[&str]) -> Value {
    let before = files(root);
    let (exit, value) = cli(root, args);
    assert_eq!(exit, 2, "{args:?}: {value}");
    assert_eq!(
        value["category"], "task",
        "not a lifecycle refusal: {value}"
    );
    assert_eq!(files(root), before, "refusal changed files: {args:?}");
    value
}

const RUNTIME: &str = r#"{"kind":"runtime","locator":"fixture://observed-cycle/1","context":"Explicit synthetic observation claim; independent review must judge its truth"}"#;
#[allow(dead_code)]
const VERIFY: &str = r#"{"kind":"verification","locator":"check.py","context":"The executed source check is correctness evidence only"}"#;
const VIEWPORT: &str = r#"{"kind":"viewport","locator":"fixture://viewport/1","context":"Synthetic reviewer observation reference, not an actual browser screenshot"}"#;

fn goals(required: bool) -> String {
    let mode = if required {
        "delivery \"required\""
    } else {
        ""
    };
    format!(
        "goal \"deliver\" {{ statement \"Complete the real player cycle\" expect [\"contract::entry\"] state \"active\" {mode} }}\ngoal \"viewer\" {{ statement \"Read the semantic event in a viewport\" expect [\"contract::entry\"] state \"active\" {mode} {} }}\n",
        if required {
            "applies-to [\"system::app\"]"
        } else {
            ""
        }
    )
}

fn fixture(required: bool) -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "project.bla",
        "project Delivery\nuse structure \"entry.bla\"\nuse behavior \"counter.bla\"\nprocess \"process.bla\"\nsystem \"system.bla\"\ngoal \"goals.bla\"\nverify behavior { command [\"python3\", \"counter.py\"] seed 0 cases 1 steps 2 timeout_ms 2000 shrink_budget 4 }\n",
    );
    write(
        root,
        "entry.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(
        root,
        "counter.bla",
        "state count: int\naction increment()\nwhen increment { expect \"one\": after.count == before.count + 1 }\n",
    );
    write(
        root,
        "counter.py",
        "import json,sys\ncount=0\nfor line in sys.stdin:\n r=json.loads(line)\n if r['op']=='reset':\n  count=0\n  value={'ok':True}\n elif r['op']=='call':\n  count+=1\n  value={'ok':True}\n else:\n  value={'count':count}\n print(json.dumps({'id':r['id'],'result':value}),flush=True)\n",
    );
    write(root, "src/app.rs", "pub fn run() {}\n");
    write(
        root,
        "check.py",
        "from pathlib import Path\nassert 'pub fn run' in Path('src/app.rs').read_text()\np=Path('.blabla/check-count')\np.write_text(str(int(p.read_text())+1) if p.exists() else '1')\n",
    );
    write(
        root,
        "process.bla",
        "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\nrole \"reviewer\" { purpose \"Review independently\" model \"reviewer\" }\n",
    );
    write(
        root,
        "system.bla",
        "system \"app\" { purpose \"Player operations and viewer effects\" paths [\"src/\"] }\n",
    );
    write(root, "goals.bla", &goals(required));
    temp
}

fn open(root: &Path, name: &str, scope: &str, primary: bool) -> Value {
    let mut args = vec![
        "task",
        "open",
        name,
        "--role",
        "worker",
        "--statement",
        "Bounded source result",
        "--scope",
        scope,
    ];
    if primary {
        args.extend(["--goal", "deliver"]);
    }
    args.extend([
        "--input",
        "src",
        "check.py",
        "--check-argv",
        "python3",
        "check.py",
    ]);
    success(root, &args);
    success(root, &["task", "accept", name, "--model", "worker"])
}

fn check(root: &Path, name: &str) {
    success(root, &["task", "evidence", name, "--run"]);
}

fn handback(root: &Path, name: &str) {
    let (_, challenged) = cli(root, &["challenge", name]);
    assert_eq!(challenged["assignment_clear"], true, "{challenged}");
    success(root, &["task", "ready", name]);
}

fn claim(root: &Path, name: &str, goal: &str, status: &str) -> Value {
    let mut args = vec![
        "task",
        "delivery",
        name,
        goal,
        "--status",
        status,
        "--observation",
        "The specifically described fixture result was inspected",
        "--observation-ref",
        RUNTIME,
        "--model",
        "worker",
    ];
    match status {
        "partial" => args.extend([
            "--delivered",
            "Source behavior is checked",
            "--remaining",
            "Authorized live cycle remains",
            "--owner",
            "release-owner",
            "--next",
            "Deploy then observe the exact next decision",
        ]),
        "blocked" => args.extend([
            "--blocker",
            "Deployment permission is absent",
            "--owner",
            "release-owner",
            "--unblock-when",
            "Owner authorizes the bounded rollout",
        ]),
        "not-applicable" => args.extend([
            "--reason",
            "This declared report-only scope does not change the selected user outcome",
        ]),
        _ => {}
    }
    success(root, &args)
}

fn task(root: &Path, name: &str) -> Value {
    success(root, &["task", "show", name])["task"].clone()
}

fn review(root: &Path, name: &str, target: &str) {
    let path = format!("reviews/{name}.md");
    success(
        root,
        &[
            "task",
            "open",
            name,
            "--role",
            "reviewer",
            "--statement",
            "Independently inspect the exact delivery claim",
            "--scope",
            &path,
            "--review-of",
            target,
            "--input",
            "src",
            "check.py",
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    success(root, &["task", "accept", name, "--model", "reviewer"]);
    check(root, name);
}

fn verdict(root: &Path, reviewer: &str, goal: &str, value: &str) -> Value {
    success(
        root,
        &[
            "task",
            "delivery-review",
            reviewer,
            goal,
            "--verdict",
            value,
            "--reason",
            "Independently inspected the claimed outcome and its stated limits",
            "--observation-ref",
            VIEWPORT,
            "--model",
            "reviewer",
        ],
    )
}

fn close_args<'a>(name: &'a str, bounded: bool) -> Vec<&'a str> {
    let mut args = vec!["task", "close", name, "--model", "owner"];
    if bounded {
        args.extend([
            "--bounded",
            "--reason",
            "Current source acceptance while unrelated implementation drift awaits integration",
        ]);
    }
    args
}

fn sources() -> TempDir {
    let temp = fixture(true);
    let root = temp.path();
    write(root, "inspection.txt", "Synthetic inspected artifact v1\n");
    for name in ["core", "server"] {
        write(root, &format!("src/{name}.rs"), "pub fn component() {}\n");
    }
    for name in ["core", "server"] {
        success(
            root,
            &[
                "task",
                "open",
                name,
                "--role",
                "worker",
                "--statement",
                "Independent component outcome",
                "--scope",
                &format!("{name}.md"),
                "--goal",
                "deliver",
                "--input",
                &format!("src/{name}.rs"),
                "check.py",
                "--check-argv",
                "python3",
                "check.py",
            ],
        );
        success(root, &["task", "accept", name, "--model", "worker"]);
    }
    success(root, &["finish"]);
    for name in ["core", "server"] {
        check(root, name);
        claim(root, name, "deliver", "partial");
        handback(root, name);
    }
    temp
}

fn batch_args<'a>(extra: &'a str) -> Vec<&'a str> {
    vec![
        "task",
        "open",
        "batch",
        "--role",
        "reviewer",
        "--statement",
        "One substantive inspection of both components",
        "--scope",
        "reviews/batch.md",
        "--review-of",
        "core",
        "--delivery-review-of",
        extra,
        "--input",
        "check.py",
        "--check-argv",
        "python3",
        "check.py",
    ]
}

fn batch(root: &Path) {
    success(root, &batch_args("server"));
    success(root, &["task", "accept", "batch", "--model", "reviewer"]);
    check(root, "batch");
}

fn selected<'a>(source: &'a str, verdict: &'a str) -> Vec<&'a str> {
    vec![
        "task",
        "delivery-review",
        "batch",
        "deliver",
        "--source",
        source,
        "--verdict",
        verdict,
        "--reason",
        "Inspected this exact component claim and retained live outcome limits",
        "--observation-ref",
        VIEWPORT,
        "--model",
        "reviewer",
    ]
}

fn approve_both(root: &Path) {
    success(root, &selected("core", "accept"));
    success(root, &selected("server", "accept"));
    handback(root, "batch");
}

#[test]
fn legacy_primary_review_without_additional_target_preserves_success() {
    let temp = sources();
    let root = temp.path();
    review(root, "legacy", "core");
    verdict(root, "legacy", "deliver", "accept");
    handback(root, "legacy");
    success(root, &close_args("legacy", false));
    success(root, &close_args("core", false));
    refusal(root, &close_args("server", false));
}

#[test]
fn explicit_additional_target_is_pinned_and_same_goal_verdicts_do_not_replace_each_other() {
    let temp = sources();
    let root = temp.path();
    batch(root);
    let pinned = task(root, "batch");
    assert_eq!(pinned["review_of"]["task"], "core");
    assert_eq!(pinned["delivery_review_targets"][0]["task"], "server");
    assert!(pinned["delivery_review_targets"][0]["revision"]["paths"]["src/server.rs"].is_string());
    success(root, &selected("core", "accept"));
    success(root, &selected("server", "reject"));
    let records = task(root, "batch")["delivery_reviews"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(records.len(), 2);
    assert!(
        records
            .iter()
            .any(|r| r["source_task"] == "core" && r["verdict"] == "accept")
    );
    assert!(
        records
            .iter()
            .any(|r| r["source_task"] == "server" && r["verdict"] == "reject")
    );
    success(root, &selected("server", "accept"));
    assert_eq!(
        task(root, "batch")["delivery_reviews"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn one_review_receipt_supports_separate_ordinary_and_bounded_source_closure() {
    for (bounded, order) in [
        (false, ["core", "server"]),
        (false, ["server", "core"]),
        (true, ["core", "server"]),
        (true, ["server", "core"]),
    ] {
        let temp = sources();
        let root = temp.path();
        batch(root);
        approve_both(root);
        if bounded {
            open(root, "concurrent", "unrelated.md", false);
            write(
                root,
                "unrelated.md",
                "Genuine unrelated implementation drift\n",
            );
        }
        success(root, &close_args("batch", bounded));
        assert_eq!(task(root, "core")["state"], "ready");
        assert_eq!(task(root, "server")["state"], "ready");
        for source in order {
            success(root, &close_args(source, bounded));
        }
        let (_, status) = cli(root, &["status"]);
        let rows = status["delivery"]["residuals"].as_array().unwrap();
        for name in ["core", "server"] {
            assert!(
                rows.iter()
                    .any(|r| r["origin_task"] == name && r["status"] == "partial")
            );
        }
    }
}

#[test]
fn omitted_selector_remains_primary_and_does_not_approve_secondary() {
    let temp = sources();
    let root = temp.path();
    batch(root);
    verdict(root, "batch", "deliver", "accept");
    handback(root, "batch");
    success(root, &close_args("batch", false));
    success(root, &close_args("core", false));
    refusal(root, &close_args("server", false));
}

#[test]
fn unknown_self_and_unassigned_selected_sources_refuse_without_writes() {
    let temp = sources();
    let root = temp.path();
    open(root, "unassigned", "unassigned.md", false);
    batch(root);
    for source in ["missing", "batch", "unassigned"] {
        refusal(root, &selected(source, "accept"));
    }
}

#[test]
fn missing_self_withdrawn_and_duplicate_assignment_targets_refuse_without_writes() {
    for target in ["missing", "batch", "core", "withdrawn"] {
        let temp = sources();
        let root = temp.path();
        open(root, "withdrawn", "withdrawn.md", false);
        success(
            root,
            &[
                "task",
                "withdraw",
                "withdrawn",
                "--reason",
                "Unused explicit fixture",
                "--model",
                "owner",
            ],
        );
        refusal(root, &batch_args(target));
    }
}

#[test]
fn changed_secondary_source_cannot_record_or_close_a_stale_batch() {
    let temp = sources();
    let root = temp.path();
    batch(root);
    success(root, &selected("core", "accept"));
    write(
        root,
        "src/server.rs",
        "pub fn component() { let changed = 1; }\n",
    );
    refusal(root, &selected("server", "accept"));
    for bounded in [false, true] {
        refusal(root, &close_args("batch", bounded));
    }
}

#[test]
fn secondary_claim_replacement_needs_explicit_reacceptance_and_new_verdict() {
    let temp = sources();
    let root = temp.path();
    batch(root);
    success(root, &selected("server", "accept"));
    let original = task(root, "batch")["delivery_reviews"].clone();
    success(root, &["task", "accept", "server", "--model", "worker"]);
    check(root, "server");
    claim(root, "server", "deliver", "blocked");
    handback(root, "server");
    refusal(root, &selected("server", "accept"));
    assert_eq!(task(root, "batch")["delivery_reviews"], original);
    success(root, &["task", "accept", "batch", "--model", "reviewer"]);
    check(root, "batch");
    success(root, &selected("server", "accept"));
    assert_ne!(task(root, "batch")["delivery_reviews"], original);
}

#[test]
fn secondary_reject_never_blocks_primary_by_goal_name_or_accepts_secondary() {
    let temp = sources();
    let root = temp.path();
    batch(root);
    success(root, &selected("core", "accept"));
    success(root, &selected("server", "reject"));
    handback(root, "batch");
    success(root, &close_args("batch", false));
    success(root, &close_args("core", false));
    refusal(root, &close_args("server", false));
}

#[test]
fn secondary_review_artifact_drift_blocks_both_close_modes_without_writes() {
    let temp = sources();
    let root = temp.path();
    write(root, "inspection.txt", "Synthetic inspected artifact v1\n");
    success(root, &["finish"]);
    batch(root);
    let reference = json!({"kind":"artifact","locator":"inspection.txt","context":"Synthetic reviewer artifact with tracked bytes"}).to_string();
    let mut args = selected("server", "accept");
    let index = args.iter().position(|a| *a == VIEWPORT).unwrap();
    args[index] = &reference;
    success(root, &args);
    handback(root, "batch");
    write(root, "inspection.txt", "Changed artifact v2\n");
    for bounded in [false, true] {
        refusal(root, &close_args("batch", bounded));
    }
}

#[test]
fn wrong_reviewer_model_and_unaccepted_review_cannot_write_secondary_verdict() {
    let temp = sources();
    let root = temp.path();
    success(root, &batch_args("server"));
    refusal(root, &selected("server", "accept"));
    success(root, &["task", "accept", "batch", "--model", "reviewer"]);
    check(root, "batch");
    let mut args = selected("server", "accept");
    *args.last_mut().unwrap() = "worker";
    refusal(root, &args);
}

#[test]
fn secondary_resolution_is_exact_origin_and_preserves_both_closed_source_records() {
    let temp = sources();
    let root = temp.path();
    batch(root);
    approve_both(root);
    success(root, &close_args("batch", false));
    for name in ["core", "server"] {
        success(root, &close_args(name, false));
    }
    let core_bytes = std::fs::read(root.join(".blabla/tasks/core.json")).unwrap();
    let server_bytes = std::fs::read(root.join(".blabla/tasks/server.json")).unwrap();
    let (_, status) = cli(root, &["status"]);
    let row = status["delivery"]["residuals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["origin_task"] == "server")
        .unwrap();
    let origin = json!({"task":"server","goal":"goal::deliver","claim_digest":row["claim_digest"]})
        .to_string();
    let mut args = batch_args("server");
    args[2] = "resolution";
    let scope = args.iter().position(|a| *a == "reviews/batch.md").unwrap();
    args[scope] = "reviews/resolution.md";
    success(root, &args);
    success(
        root,
        &["task", "accept", "resolution", "--model", "reviewer"],
    );
    check(root, "resolution");
    let mut args = selected("server", "accept");
    args[2] = "resolution";
    args.extend(["--resolve-origin", &origin, "--resolution", "delivered"]);
    success(root, &args);
    handback(root, "resolution");
    success(root, &close_args("resolution", false));
    let (_, status) = cli(root, &["status"]);
    let rows = status["delivery"]["residuals"].as_array().unwrap();
    assert!(rows.iter().any(|r| r["origin_task"] == "core"));
    assert!(!rows.iter().any(|r| r["origin_task"] == "server"));
    assert_eq!(
        std::fs::read(root.join(".blabla/tasks/core.json")).unwrap(),
        core_bytes
    );
    assert_eq!(
        std::fs::read(root.join(".blabla/tasks/server.json")).unwrap(),
        server_bytes
    );
}

#[test]
fn secondary_claim_artifact_drift_is_not_hidden_by_unchanged_source_paths() {
    let temp = sources();
    let root = temp.path();
    success(root, &["task", "accept", "server", "--model", "worker"]);
    check(root, "server");
    let reference = json!({"kind":"artifact","locator":"inspection.txt","context":"Explicit synthetic source observation artifact"}).to_string();
    success(
        root,
        &[
            "task",
            "delivery",
            "server",
            "deliver",
            "--status",
            "delivered",
            "--observation",
            "Inspected exact synthetic source artifact",
            "--observation-ref",
            &reference,
            "--model",
            "worker",
        ],
    );
    handback(root, "server");
    batch(root);
    write(root, "inspection.txt", "Changed source artifact\n");
    refusal(root, &selected("server", "accept"));
}

#[test]
fn recursive_secondary_dependency_is_checked_without_requiring_a_primary_chain_match() {
    let temp = sources();
    let root = temp.path();
    review(root, "intermediate", "server");
    handback(root, "intermediate");
    success(root, &batch_args("intermediate"));
    success(root, &["task", "accept", "batch", "--model", "reviewer"]);
    check(root, "batch");
    success(root, &selected("core", "accept"));
    write(
        root,
        "src/server.rs",
        "pub fn component() { let changed = 2; }\n",
    );
    refusal(root, &selected("core", "accept"));
}

#[test]
fn multiple_additional_targets_are_distinct_and_shared_ancestor_is_not_a_cycle() {
    let temp = sources();
    let root = temp.path();
    review(root, "intermediate", "server");
    handback(root, "intermediate");
    let mut args = batch_args("server");
    let position = args.iter().position(|a| *a == "--input").unwrap();
    args.splice(position..position, ["--delivery-review-of", "intermediate"]);
    success(root, &args);
    success(root, &["task", "accept", "batch", "--model", "reviewer"]);
    check(root, "batch");
    success(root, &selected("server", "accept"));
    success(root, &selected("core", "accept"));
    handback(root, "batch");
}

#[test]
fn legacy_absent_source_field_uses_only_primary_without_rewriting_history() {
    let temp = sources();
    let root = temp.path();
    review(root, "legacy", "core");
    verdict(root, "legacy", "deliver", "accept");
    handback(root, "legacy");
    success(root, &close_args("legacy", false));
    let path = root.join(".blabla/tasks/legacy.json");
    let old: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert!(old.get("delivery_review_targets").is_none());
    assert!(
        old["delivery_reviews"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row.get("source_task").is_none())
    );
    let historical = std::fs::read(&path).unwrap();
    success(root, &close_args("core", false));
    refusal(root, &close_args("server", false));
    assert_eq!(std::fs::read(path).unwrap(), historical);
}

#[test]
fn additional_targets_require_primary_and_repeated_secondary_names_refuse() {
    let temp = sources();
    let root = temp.path();
    let mut missing_primary = batch_args("server");
    let primary = missing_primary
        .iter()
        .position(|a| *a == "--review-of")
        .unwrap();
    missing_primary.drain(primary..primary + 2);
    refusal(root, &missing_primary);
    let mut duplicate = batch_args("server");
    let position = duplicate.iter().position(|a| *a == "--input").unwrap();
    duplicate.splice(position..position, ["--delivery-review-of", "server"]);
    refusal(root, &duplicate);
}

#[test]
fn unaccepted_extra_review_does_not_block_an_independently_accepted_source() {
    let temp = sources();
    let root = temp.path();
    batch(root);
    approve_both(root);
    success(root, &close_args("batch", false));
    open(root, "unused", "unused.md", false);
    let mut args = batch_args("unused");
    args[2] = "unfinished-review";
    let scope = args.iter().position(|a| *a == "reviews/batch.md").unwrap();
    args[scope] = "reviews/unfinished.md";
    success(root, &args);
    success(
        root,
        &[
            "task",
            "withdraw",
            "unused",
            "--reason",
            "Unused independent fixture",
            "--model",
            "owner",
        ],
    );
    success(root, &close_args("core", false));
    success(root, &close_args("server", false));
}
