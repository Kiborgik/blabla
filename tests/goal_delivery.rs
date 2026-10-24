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

fn reviewed(root: &Path, name: &str, status: &str) {
    claim(root, name, "deliver", status);
    claim(root, name, "viewer", status);
    handback(root, name);
    let reviewer = format!("review-{name}");
    review(root, &reviewer, name);
    verdict(root, &reviewer, "deliver", "accept");
    verdict(root, &reviewer, "viewer", "accept");
    handback(root, &reviewer);
    success(root, &close_args(&reviewer, false));
}

fn close_args(name: &str, bounded: bool) -> Vec<&str> {
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

fn drift(root: &Path) {
    open(root, "concurrent", "other.md", false);
    write(
        root,
        "other.md",
        "Actual unrelated implementation fingerprint input\n",
    );
}

#[test]
fn legacy_goal_and_task_records_preserve_ordinary_closure() {
    let temp = fixture(false);
    let root = temp.path();
    open(root, "work", "src", true);
    success(root, &["finish"]);
    check(root, "work");
    handback(root, "work");
    assert!(task(root, "work").get("delivery_obligations").is_none());
    success(root, &close_args("work", false));
    assert_eq!(task(root, "work")["state"], "closed");
}

#[test]
fn required_primary_and_mapped_cross_cutting_goals_are_visible_at_acceptance() {
    let temp = fixture(true);
    let root = temp.path();
    let accepted = open(root, "work", "src", true);
    let obligations = &accepted["task"]["delivery_obligations"];
    assert!(obligations["goal::deliver"].is_object(), "{accepted}");
    assert!(obligations["goal::viewer"].is_object(), "{accepted}");
    for row in accepted["delivery"]["obligations"].as_array().unwrap() {
        assert!(!row["statement"].as_str().unwrap().is_empty());
        assert_eq!(row["expectations"][0]["identity"], "contract::entry");
        assert_eq!(row["expectations"][0]["verdict"], "held");
    }
    assert!(
        obligations["goal::viewer"]["basis"]
            .to_string()
            .contains("system::app")
    );
}

#[test]
fn real_delivery_command_is_required_rather_than_an_author_note() {
    let temp = fixture(false);
    let root = temp.path();
    open(root, "work", "src", true);
    check(root, "work");
    let before = files(root);
    let (exit, value) = cli(
        root,
        &[
            "task",
            "delivery",
            "work",
            "deliver",
            "--status",
            "delivered",
            "--observation",
            "Not selected for required delivery",
            "--observation-ref",
            RUNTIME,
            "--model",
            "worker",
        ],
    );
    assert_eq!(exit, 2);
    assert_eq!(
        value["category"], "task",
        "missing command is not a policy refusal: {value}"
    );
    assert_eq!(files(root), before);
}

#[test]
fn real_checks_without_delivery_claims_cannot_reach_ready() {
    let temp = fixture(true);
    let root = temp.path();
    open(root, "work", "src", true);
    success(root, &["finish"]);
    check(root, "work");
    let (_, challenge) = cli(root, &["challenge", "work"]);
    assert_eq!(challenge["assignment_clear"], false);
    refusal(root, &["task", "ready", "work"]);
    assert_eq!(task(root, "work")["state"], "accepted");
}

#[test]
fn delivered_claim_with_only_verification_references_refuses_without_writes() {
    let temp = fixture(true);
    let root = temp.path();
    open(root, "work", "src", true);
    check(root, "work");
    refusal(
        root,
        &[
            "task",
            "delivery",
            "work",
            "deliver",
            "--status",
            "delivered",
            "--observation",
            "The source test passed",
            "--observation-ref",
            VERIFY,
            "--model",
            "worker",
        ],
    );
}

#[test]
fn both_close_modes_require_independent_current_acceptance() {
    for bounded in [false, true] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "src", true);
        success(root, &["finish"]);
        check(root, "work");
        claim(root, "work", "deliver", "delivered");
        claim(root, "work", "viewer", "delivered");
        handback(root, "work");
        if bounded {
            drift(root);
        }
        refusal(root, &close_args("work", bounded));
        assert_eq!(task(root, "work")["state"], "ready");
    }
}

#[test]
fn reviewed_delivered_source_can_close_without_mutating_contract_status() {
    for bounded in [false, true] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "src", true);
        success(root, &["finish"]);
        check(root, "work");
        reviewed(root, "work", "delivered");
        if bounded {
            drift(root);
        }
        let status = std::fs::read(root.join(".blabla/status.json")).unwrap();
        success(root, &close_args("work", bounded));
        assert_eq!(task(root, "work")["state"], "closed");
        assert_eq!(
            std::fs::read(root.join(".blabla/status.json")).unwrap(),
            status
        );
        assert!(
            std::fs::read_to_string(root.join("goals.bla"))
                .unwrap()
                .contains("state \"active\"")
        );
    }
}

#[test]
fn reviewed_partial_and_blocked_sources_close_with_durable_reminders() {
    for status in ["partial", "blocked"] {
        for bounded in [false, true] {
            let temp = fixture(true);
            let root = temp.path();
            open(root, "work", "src", true);
            success(root, &["finish"]);
            check(root, "work");
            reviewed(root, "work", status);
            if bounded {
                drift(root);
            }
            success(root, &close_args("work", bounded));
            let before = files(root);
            for _ in 0..2 {
                let (_, view) = cli(root, &["status"]);
                let residuals = view["delivery"]["residuals"]
                    .as_array()
                    .expect("delivery reminder view");
                assert!(residuals.iter().any(|r| r["origin_task"] == "work"
                    && r["goal"] == "goal::deliver"
                    && r["status"] == status
                    && r["owner"] == "release-owner"));
                assert!(
                    !view["delivery"]["next"].as_array().unwrap().is_empty(),
                    "{view}"
                );
            }
            assert_eq!(files(root), before);
            success(root, &["finish"]);
            let (_, view) = cli(root, &["status"]);
            assert!(!view["delivery"]["residuals"].as_array().unwrap().is_empty());
        }
    }
}

fn digest(root: &Path, name: &str, goal: &str) -> String {
    let view = success(root, &["task", "show", name]);
    view["delivery"]["obligations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["goal"] == goal)
        .unwrap()["claim_digest"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn resolve_args<'a>(
    reviewer: &'a str,
    goal: &'a str,
    origin: &'a str,
    resolution: &'a str,
) -> Vec<&'a str> {
    vec![
        "task",
        "delivery-review",
        reviewer,
        goal,
        "--verdict",
        "accept",
        "--resolution",
        resolution,
        "--resolve-origin",
        origin,
        "--reason",
        "Independently inspected this exact historical obligation and current outcome",
        "--observation-ref",
        RUNTIME,
        "--model",
        "reviewer",
    ]
}

fn residuals(root: &Path) -> Vec<Value> {
    let (_, view) = cli(root, &["status"]);
    view["delivery"]["residuals"].as_array().unwrap().clone()
}

#[test]
fn explicit_additional_goals_and_scope_mapping_do_not_follow_broad_check_inputs() {
    let temp = fixture(true);
    let root = temp.path();
    let report = open(root, "report", "report.md", false);
    assert!(
        report["task"]
            .get("delivery_obligations")
            .is_none_or(|v| v.as_object().unwrap().is_empty()),
        "{report}"
    );
    success(
        root,
        &[
            "task",
            "open",
            "explicit",
            "--role",
            "worker",
            "--statement",
            "Explicit user outcome",
            "--scope",
            "explicit.md",
            "--delivery-goal",
            "viewer",
            "--input",
            "src",
            "check.py",
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    let accepted = success(root, &["task", "accept", "explicit", "--model", "worker"]);
    let obligations = accepted["task"]["delivery_obligations"]
        .as_object()
        .unwrap();
    assert_eq!(obligations.len(), 1);
    assert!(obligations.contains_key("goal::viewer"));
}

#[test]
fn invalid_system_applicability_is_not_treated_as_a_role_free_or_goal_free_project() {
    for replacement in ["system::absent", "goal::deliver", "system::ap"] {
        let temp = fixture(true);
        let root = temp.path();
        write(
            root,
            "goals.bla",
            &goals(true).replace("system::app", replacement),
        );
        let before = files(root);
        let (exit, value) = cli(
            root,
            &[
                "task",
                "open",
                "work",
                "--role",
                "worker",
                "--statement",
                "Must resolve required applicability",
                "--scope",
                "src",
                "--check-argv",
                "python3",
                "check.py",
            ],
        );
        assert_eq!(exit, 2, "{value}");
        assert_eq!(value["category"], "task", "{value}");
        assert_eq!(files(root), before);
    }
}

#[test]
fn scope_widening_adds_new_mapped_obligations_without_forgetting_primary_goal() {
    let temp = fixture(true);
    let root = temp.path();
    open(root, "work", "report.md", true);
    let before = task(root, "work")["delivery_obligations"].clone();
    assert!(before["goal::deliver"].is_object());
    assert!(before["goal::viewer"].is_null());
    success(
        root,
        &["task", "scope", "work", "--add", "src", "--model", "owner"],
    );
    success(root, &["task", "accept", "work", "--model", "worker"]);
    let after = task(root, "work")["delivery_obligations"].clone();
    assert!(after["goal::deliver"].is_object());
    assert!(after["goal::viewer"].is_object());
}

#[test]
fn invalid_claim_payloads_and_wrong_actor_refuse_without_mutation() {
    for (status, reference, model) in [
        ("delivered", VERIFY, "worker"),
        ("partial", RUNTIME, "worker"),
        ("blocked", RUNTIME, "worker"),
        ("not-applicable", RUNTIME, "worker"),
        ("delivered", RUNTIME, "reviewer"),
        (
            "delivered",
            r#"{"kind":"runtime","locator":"","context":"missing locator"}"#,
            "worker",
        ),
        (
            "delivered",
            r#"{"kind":"runtime","locator":"fixture://x","context":""}"#,
            "worker",
        ),
    ] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "src", true);
        check(root, "work");
        refusal(
            root,
            &[
                "task",
                "delivery",
                "work",
                "deliver",
                "--status",
                status,
                "--observation",
                "Concrete stated result",
                "--observation-ref",
                reference,
                "--model",
                model,
            ],
        );
    }
}

#[test]
fn claim_keeps_evidence_epoch_scope_and_project_status_and_does_not_claim_other_goals() {
    let temp = fixture(true);
    let root = temp.path();
    open(root, "work", "src", true);
    success(root, &["finish"]);
    check(root, "work");
    let before = task(root, "work");
    let status = std::fs::read(root.join(".blabla/status.json")).unwrap();
    claim(root, "work", "deliver", "delivered");
    let after = task(root, "work");
    for key in [
        "evidence",
        "acceptance_epoch",
        "accepted",
        "scope",
        "review_of",
        "check_inputs",
        "check_argv",
        "state",
    ] {
        assert_eq!(after[key], before[key], "{key}");
    }
    assert!(after["delivery_obligations"]["goal::viewer"]["claim"].is_null());
    assert_eq!(
        std::fs::read(root.join(".blabla/status.json")).unwrap(),
        status
    );
}

#[test]
fn claims_require_current_source_evidence_and_model_authority() {
    for kind in ["missing-check", "source", "revoked-model"] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "src", true);
        if kind != "missing-check" {
            check(root, "work");
        }
        if kind == "source" {
            write(root, "src/app.rs", "pub fn run() { let _ = 2; }\n");
        }
        if kind == "revoked-model" {
            let process = std::fs::read_to_string(root.join("process.bla")).unwrap();
            write(
                root,
                "process.bla",
                &process.replace("model \"worker\"", "model \"replacement\""),
            );
        }
        refusal(
            root,
            &[
                "task",
                "delivery",
                "work",
                "deliver",
                "--status",
                "delivered",
                "--observation",
                "A claimed result does not replace eligibility",
                "--observation-ref",
                RUNTIME,
                "--model",
                "worker",
            ],
        );
    }
}

#[test]
fn goal_less_report_review_has_no_recursive_delivery_obligation_but_production_review_does() {
    let temp = fixture(true);
    let root = temp.path();
    open(root, "work", "source-report.md", true);
    check(root, "work");
    claim(root, "work", "deliver", "partial");
    handback(root, "work");
    review(root, "review", "work");
    assert!(
        task(root, "review")
            .get("delivery_obligations")
            .is_none_or(|v| v.as_object().unwrap().is_empty())
    );
    success(
        root,
        &[
            "task", "scope", "review", "--add", "src", "--model", "owner",
        ],
    );
    success(root, &["task", "accept", "review", "--model", "reviewer"]);
    assert!(task(root, "review")["delivery_obligations"]["goal::viewer"].is_object());
}

#[test]
fn author_same_task_non_review_task_and_wrong_review_model_cannot_accept_delivery() {
    let temp = fixture(true);
    let root = temp.path();
    open(root, "work", "src", true);
    check(root, "work");
    claim(root, "work", "deliver", "delivered");
    claim(root, "work", "viewer", "delivered");
    handback(root, "work");
    open(root, "unrelated", "other.md", false);
    check(root, "unrelated");
    review(root, "review", "work");
    for (name, model) in [
        ("work", "worker"),
        ("unrelated", "worker"),
        ("review", "worker"),
    ] {
        refusal(
            root,
            &[
                "task",
                "delivery-review",
                name,
                "deliver",
                "--verdict",
                "accept",
                "--reason",
                "Cannot grant unassigned independent authority",
                "--observation-ref",
                VIEWPORT,
                "--model",
                model,
            ],
        );
    }
}

#[test]
fn review_rejects_stale_claim_goal_source_and_review_target_without_repinning() {
    for change in ["claim", "goal", "source", "epoch"] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "src", true);
        check(root, "work");
        claim(root, "work", "deliver", "partial");
        review(root, "review", "work");
        match change {
            "claim" => {
                claim(root, "work", "deliver", "delivered");
            }
            "goal" => write(
                root,
                "goals.bla",
                &goals(true).replace(
                    "Complete the real player cycle",
                    "Observe two actual consecutive player cycles",
                ),
            ),
            "source" => write(root, "src/app.rs", "pub fn run() { let _ = 3; }\n"),
            "epoch" => {
                success(root, &["task", "accept", "work", "--model", "worker"]);
            }
            _ => unreachable!(),
        }
        refusal(
            root,
            &[
                "task",
                "delivery-review",
                "review",
                "deliver",
                "--verdict",
                "accept",
                "--reason",
                "Stale inspection cannot repin itself",
                "--observation-ref",
                VIEWPORT,
                "--model",
                "reviewer",
            ],
        );
    }
}

#[test]
fn rejected_independent_verdict_keeps_both_close_modes_refused() {
    for bounded in [false, true] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "src", true);
        success(root, &["finish"]);
        check(root, "work");
        claim(root, "work", "deliver", "delivered");
        claim(root, "work", "viewer", "delivered");
        handback(root, "work");
        review(root, "review", "work");
        verdict(root, "review", "deliver", "reject");
        verdict(root, "review", "viewer", "accept");
        handback(root, "review");
        success(root, &close_args("review", false));
        if bounded {
            drift(root);
        }
        refusal(root, &close_args("work", bounded));
    }
}

#[test]
fn not_applicable_clears_only_this_report_obligation_and_never_marks_goal_delivered() {
    let temp = fixture(true);
    let root = temp.path();
    open(root, "report", "report.md", true);
    success(root, &["finish"]);
    check(root, "report");
    claim(root, "report", "deliver", "not-applicable");
    handback(root, "report");
    review(root, "review", "report");
    verdict(root, "review", "deliver", "accept");
    handback(root, "review");
    success(root, &close_args("review", false));
    success(root, &close_args("report", false));
    let goal = success(root, &["explain", "goal::deliver"]);
    assert_ne!(goal["delivery"]["state"], "delivered");
    assert!(
        std::fs::read_to_string(root.join("goals.bla"))
            .unwrap()
            .contains("state \"active\"")
    );
}

#[test]
fn later_initial_not_applicable_review_preserves_an_earlier_active_partial_origin() {
    for bounded in [false, true] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "src", true);
        success(root, &["finish"]);
        check(root, "work");
        reviewed(root, "work", "partial");
        success(root, &close_args("work", false));
        let historical = std::fs::read(root.join(".blabla/tasks/work.json")).unwrap();
        let original_digest = digest(root, "work", "goal::deliver");
        assert_eq!(residuals(root).len(), 2);
        open(root, "report", "report.md", true);
        check(root, "report");
        claim(root, "report", "deliver", "not-applicable");
        handback(root, "report");
        review(root, "review-report", "report");
        verdict(root, "review-report", "deliver", "accept");
        handback(root, "review-report");
        success(root, &close_args("review-report", false));
        if bounded {
            drift(root);
        }
        success(root, &close_args("report", bounded));
        let remaining = residuals(root);
        assert_eq!(remaining.len(), 2);
        assert!(remaining.iter().any(|row| row["origin_task"] == "work"
            && row["goal"] == "goal::deliver"
            && row["status"] == "partial"));
        assert_eq!(digest(root, "work", "goal::deliver"), original_digest);
        assert_eq!(
            std::fs::read(root.join(".blabla/tasks/work.json")).unwrap(),
            historical
        );
        let goal = success(root, &["explain", "goal::deliver"]);
        assert_eq!(goal["state"], "active");
        assert_ne!(goal["delivery"]["state"], "delivered");
    }
}

#[test]
fn later_explicit_delivered_resolution_preserves_closed_history_and_other_origins() {
    for bounded in [false, true] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "src", true);
        success(root, &["finish"]);
        check(root, "work");
        reviewed(root, "work", "partial");
        if bounded {
            drift(root);
        }
        success(root, &close_args("work", bounded));
        let historical = std::fs::read(root.join(".blabla/tasks/work.json")).unwrap();
        let origin = json!({"task":"work","goal":"goal::deliver","claim_digest":digest(root,"work","goal::deliver")}).to_string();
        success(root, &["finish"]);
        open(root, "other-source", "src", true);
        check(root, "other-source");
        reviewed(root, "other-source", "partial");
        success(root, &close_args("other-source", false));
        let initial = residuals(root);
        assert_eq!(initial.len(), 4);
        review(root, "resolution", "work");
        success(
            root,
            &resolve_args("resolution", "deliver", &origin, "delivered"),
        );
        handback(root, "resolution");
        success(root, &["finish"]);
        success(root, &close_args("resolution", false));
        let remaining = residuals(root);
        assert_eq!(remaining.len(), 3);
        assert!(
            remaining
                .iter()
                .any(|r| r["origin_task"] == "work" && r["goal"] == "goal::viewer")
        );
        assert_eq!(
            remaining
                .iter()
                .filter(|r| r["origin_task"] == "other-source")
                .count(),
            2
        );
        assert_eq!(
            std::fs::read(root.join(".blabla/tasks/work.json")).unwrap(),
            historical
        );
    }
}

#[test]
fn resolution_must_name_exact_origin_goal_and_claim_and_explicit_terminal() {
    let temp = fixture(true);
    let root = temp.path();
    open(root, "work", "src", true);
    success(root, &["finish"]);
    check(root, "work");
    reviewed(root, "work", "partial");
    success(root, &close_args("work", false));
    review(root, "resolution", "work");
    let correct = json!({"task":"work","goal":"goal::deliver","claim_digest":digest(root,"work","goal::deliver")});
    for (key, wrong) in [
        ("task", "other"),
        ("goal", "goal::viewer"),
        ("claim_digest", "wrong"),
    ] {
        let mut origin = correct.clone();
        origin[key] = json!(wrong);
        refusal(
            root,
            &resolve_args("resolution", "deliver", &origin.to_string(), "delivered"),
        );
    }
    let origin = correct.to_string();
    refusal(
        root,
        &[
            "task",
            "delivery-review",
            "resolution",
            "deliver",
            "--verdict",
            "accept",
            "--resolve-origin",
            &origin,
            "--reason",
            "Accepting Partial does not discharge it",
            "--observation-ref",
            RUNTIME,
            "--model",
            "reviewer",
        ],
    );
    assert_eq!(residuals(root).len(), 2);
}

#[test]
fn goal_removal_or_disabling_retains_residual_and_reviewer_cannot_retire_it() {
    for disabled in [false, true] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "src", true);
        success(root, &["finish"]);
        check(root, "work");
        reviewed(root, "work", "partial");
        success(root, &close_args("work", false));
        let origin = json!({"task":"work","goal":"goal::deliver","claim_digest":digest(root,"work","goal::deliver")}).to_string();
        let historical = std::fs::read(root.join(".blabla/tasks/work.json")).unwrap();
        let changed_goals = if disabled {
            goals(false)
        } else {
            String::new()
        };
        write(root, "goals.bla", &changed_goals);
        assert!(residuals(root).iter().any(|r| r["goal"] == "goal::deliver"));
        review(root, "retirement", "work");
        refusal(
            root,
            &resolve_args("retirement", "deliver", &origin, "not-applicable"),
        );
        assert!(residuals(root).iter().any(|r| r["goal"] == "goal::deliver"));
        assert_eq!(
            std::fs::read(root.join(".blabla/tasks/work.json")).unwrap(),
            historical
        );
    }
}

#[test]
fn changed_goal_or_claim_artifact_stales_delivery_without_rewriting_history() {
    for change in ["goal", "artifact"] {
        let temp = fixture(true);
        let root = temp.path();
        write(
            root,
            "observed.txt",
            "Explicit synthetic observed fixture artifact\n",
        );
        open(root, "work", "src", true);
        check(root, "work");
        let reference = json!({"kind":"artifact","locator":"observed.txt","context":"Synthetic local artifact whose bytes are trackable"}).to_string();
        success(
            root,
            &[
                "task",
                "delivery",
                "work",
                "deliver",
                "--status",
                "delivered",
                "--observation",
                "Inspected the named local artifact",
                "--observation-ref",
                &reference,
                "--model",
                "worker",
            ],
        );
        claim(root, "work", "viewer", "delivered");
        if change == "goal" {
            write(
                root,
                "goals.bla",
                &goals(true).replace(
                    "Complete the real player cycle",
                    "Observe the complete new player requirement",
                ),
            );
        } else {
            write(root, "observed.txt", "Changed evidence bytes\n");
        }
        let before = files(root);
        let view = success(root, &["task", "show", "work"]);
        assert_eq!(view["delivery"]["claims_current"], false, "{view}");
        assert_eq!(files(root), before);
        refusal(root, &["task", "ready", "work"]);
    }
}

#[test]
fn source_check_failure_and_open_finding_are_not_overridden_by_delivery_review() {
    for kind in ["check", "finding"] {
        for bounded in [false, true] {
            let temp = fixture(true);
            let root = temp.path();
            open(root, "work", "src", true);
            success(root, &["finish"]);
            check(root, "work");
            reviewed(root, "work", "delivered");
            if kind == "finding" {
                success(
                    root,
                    &["task", "finding", "work", "A real unresolved source defect"],
                );
            } else {
                success(root, &["task", "accept", "work", "--model", "worker"]);
                write(root, "src/app.rs", "pub fn removed() {}\n");
                success(root, &["task", "evidence", "work", "--run"]);
                assert_ne!(
                    task(root, "work")["evidence"]
                        .as_array()
                        .unwrap()
                        .last()
                        .unwrap()["exit"],
                    0
                );
            }
            if bounded {
                drift(root);
            }
            refusal(root, &close_args("work", bounded));
        }
    }
}

#[test]
fn residual_views_are_read_only_bounded_and_have_complete_goal_drilldowns() {
    let temp = fixture(true);
    let root = temp.path();
    success(root, &["finish"]);
    for index in 0..26 {
        let name = format!("work-{index}");
        open(root, &name, "src", true);
        check(root, &name);
        reviewed(root, &name, "partial");
        success(root, &close_args(&name, false));
    }
    let before = files(root);
    let (_, view) = cli(root, &["status"]);
    assert_eq!(view["delivery"]["total"], 52);
    assert_eq!(view["delivery"]["omitted"], 2);
    assert_eq!(view["delivery"]["residuals"].as_array().unwrap().len(), 50);
    let human = support::run_in(Some(root), &support::args(&["status"]));
    let text = String::from_utf8(human.stdout).unwrap();
    assert!(text.contains("Next:"));
    assert!(text.contains("delivery"));
    assert!(text.contains("2 omitted"));
    for goal in ["goal::deliver", "goal::viewer"] {
        let explained = success(root, &["explain", goal]);
        assert_eq!(
            explained["delivery"]["residuals"].as_array().unwrap().len(),
            26
        );
    }
    assert_eq!(files(root), before);
}

#[test]
fn unreadable_origin_or_review_keeps_delivery_unavailable_instead_of_disappearing() {
    for damaged in ["work", "review-work"] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "src", true);
        success(root, &["finish"]);
        check(root, "work");
        reviewed(root, "work", "partial");
        success(root, &close_args("work", false));
        write(root, &format!(".blabla/tasks/{damaged}.json"), "{invalid\n");
        let before = files(root);
        let (_, view) = cli(root, &["status"]);
        assert!(
            view["delivery"]["unavailable"]
                .as_array()
                .unwrap()
                .iter()
                .any(|r| r["task"] == damaged),
            "{view}"
        );
        assert_eq!(files(root), before);
        assert_ne!(
            success(root, &["explain", "goal::deliver"])["delivery"]["state"],
            "delivered"
        );
    }
}

#[test]
fn manually_done_goal_with_a_partial_origin_is_challenged_without_faking_contract_red() {
    let temp = fixture(true);
    let root = temp.path();
    open(root, "work", "src", true);
    success(root, &["finish"]);
    check(root, "work");
    reviewed(root, "work", "partial");
    success(root, &close_args("work", false));
    write(
        root,
        "goals.bla",
        &goals(true).replace("state \"active\"", "state \"done\""),
    );
    success(root, &["finish"]);
    let before = files(root);
    let (_, challenge) = cli(root, &["challenge"]);
    assert!(
        challenge["grounded"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "goal-delivery-unmet"),
        "{challenge}"
    );
    assert_eq!(files(root), before);
    let (_, status) = cli(root, &["status"]);
    assert_eq!(status["completion"]["allowed"], true, "{status}");
    assert!(
        !status["delivery"]["residuals"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn owner_declared_dropped_goal_retains_retirement_notice_and_never_becomes_delivered() {
    let temp = fixture(true);
    let root = temp.path();
    open(root, "work", "src", true);
    success(root, &["finish"]);
    check(root, "work");
    reviewed(root, "work", "partial");
    success(root, &close_args("work", false));
    let historical = std::fs::read(root.join(".blabla/tasks/work.json")).unwrap();
    write(
        root,
        "goals.bla",
        &goals(true).replace("state \"active\"", "state \"dropped\""),
    );
    let (_, status) = cli(root, &["status"]);
    let rows = status["delivery"]["residuals"].as_array().unwrap();
    assert!(
        rows.iter().any(|r| r["origin_task"] == "work"
            && r["goal"] == "goal::deliver"
            && r["retired"] == true),
        "{status}"
    );
    assert_ne!(
        success(root, &["explain", "goal::deliver"])["delivery"]["state"],
        "delivered"
    );
    assert_eq!(
        std::fs::read(root.join(".blabla/tasks/work.json")).unwrap(),
        historical
    );
}

#[test]
fn dropped_required_goals_do_not_attach_to_new_work_or_accept_explicit_selection() {
    let temp = fixture(true);
    let root = temp.path();
    write(
        root,
        "goals.bla",
        &goals(true).replace("state \"active\"", "state \"dropped\""),
    );
    let view = open(root, "automatic", "src", false);
    assert!(view["task"]["delivery_obligations"].is_null());
    for option in ["--goal", "--delivery-goal"] {
        refusal(
            root,
            &[
                "task",
                "open",
                "explicit",
                "--role",
                "worker",
                "--statement",
                "Retired requirement needs owner restoration",
                "--scope",
                "explicit.md",
                option,
                "deliver",
                "--check-argv",
                "python3",
                "check.py",
            ],
        );
    }
    for state in ["active", "done"] {
        let temp = fixture(true);
        let root = temp.path();
        write(
            root,
            "goals.bla",
            &goals(true).replace("state \"active\"", &format!("state \"{state}\"")),
        );
        let view = open(root, "work", "src", true);
        assert_eq!(
            view["task"]["delivery_obligations"]
                .as_object()
                .unwrap()
                .len(),
            2
        );
    }
}

#[test]
fn legacy_dropped_goal_keeps_its_previous_explicit_task_behavior() {
    let temp = fixture(false);
    let root = temp.path();
    write(
        root,
        "goals.bla",
        &goals(false).replace("state \"active\"", "state \"dropped\""),
    );
    let view = open(root, "work", "src", true);
    assert!(view["task"]["delivery_obligations"].is_null());
}

#[test]
fn delivery_closure_requires_current_owner_model_in_both_modes() {
    for bounded in [false, true] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "src", true);
        success(root, &["finish"]);
        check(root, "work");
        reviewed(root, "work", "delivered");
        if bounded {
            drift(root);
        }
        let before = files(root);
        let mut missing = close_args("work", bounded);
        missing.drain(3..5);
        assert_eq!(cli(root, &missing).0, 2);
        assert_eq!(files(root), before);
        for model in ["worker", ""] {
            let mut args = close_args("work", bounded);
            args[4] = model;
            refusal(root, &args);
        }
        success(root, &close_args("work", bounded));
    }
}

#[test]
fn delivery_review_closure_requires_owner_and_legacy_close_stays_compatible() {
    let temp = fixture(true);
    let root = temp.path();
    open(root, "work", "src", true);
    success(root, &["finish"]);
    check(root, "work");
    claim(root, "work", "deliver", "delivered");
    claim(root, "work", "viewer", "delivered");
    handback(root, "work");
    review(root, "review", "work");
    verdict(root, "review", "deliver", "accept");
    verdict(root, "review", "viewer", "accept");
    handback(root, "review");
    refusal(root, &["task", "close", "review", "--model", "worker"]);
    success(root, &close_args("review", false));

    let temp = fixture(false);
    let root = temp.path();
    open(root, "legacy", "src", true);
    success(root, &["finish"]);
    check(root, "legacy");
    handback(root, "legacy");
    success(
        root,
        &["task", "close", "legacy", "--model", "legacy-attestation"],
    );
}

#[test]
fn delivery_close_refuses_missing_current_orchestrator_role() {
    for bounded in [false, true] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "src", true);
        success(root, &["finish"]);
        check(root, "work");
        reviewed(root, "work", "delivered");
        if bounded {
            drift(root);
        }
        let process = std::fs::read_to_string(root.join("process.bla")).unwrap();
        write(
            root,
            "process.bla",
            &process
                .lines()
                .filter(|line| !line.contains("role \"orchestrator\""))
                .collect::<Vec<_>>()
                .join("\n"),
        );
        let refused = refusal(root, &close_args("work", bounded));
        assert!(
            refused["message"]
                .as_str()
                .unwrap()
                .contains("orchestrator"),
            "{refused}"
        );
    }
}

#[test]
fn both_scope_amendment_routes_pin_mapped_delivery_before_any_reacceptance() {
    for through_check in [false, true] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "report.md", false);
        let before = task(root, "work");
        assert!(before.get("delivery_obligations").is_none());
        let args = if through_check {
            vec![
                "task",
                "check",
                "work",
                "--add-scope",
                "src",
                "--input",
                "src",
                "check.py",
                "--model",
                "owner",
                "--argv",
                "python3",
                "check.py",
            ]
        } else {
            vec!["task", "scope", "work", "--add", "src", "--model", "owner"]
        };
        success(root, &args);
        let after = task(root, "work");
        assert_eq!(after["state"], "accepted");
        assert_eq!(after["acceptance_epoch"], before["acceptance_epoch"]);
        assert_eq!(after["accepted"], before["accepted"]);
        assert!(
            after["delivery_obligations"]["goal::viewer"].is_object(),
            "{after}"
        );
        assert_eq!(
            after["delivery_obligations"]["goal::viewer"]["basis"],
            json!(["system::app"])
        );
        check(root, "work");
        let (_, challenged) = cli(root, &["challenge", "work"]);
        assert_eq!(challenged["assignment_clear"], false, "{challenged}");
        assert!(
            challenged["grounded"]
                .as_array()
                .unwrap()
                .contains(&json!("goal-delivery-claim-missing"))
        );
        refusal(root, &["task", "ready", "work"]);
        claim(root, "work", "viewer", "partial");
        handback(root, "work");
        assert_eq!(
            task(root, "work")["acceptance_epoch"],
            before["acceptance_epoch"]
        );
    }
}

#[test]
fn invalid_scope_applicability_refuses_the_combined_check_amendment_without_writes() {
    let temp = fixture(true);
    let root = temp.path();
    open(root, "work", "report.md", false);
    write(
        root,
        "goals.bla",
        &goals(true).replace("system::app", "system::missing"),
    );
    refusal(
        root,
        &[
            "task",
            "check",
            "work",
            "--add-scope",
            "src",
            "--input",
            "src",
            "check.py",
            "--model",
            "owner",
            "--argv",
            "python3",
            "check.py",
        ],
    );
}

#[test]
fn readiness_reports_only_pinned_local_obligations_and_retains_partial_limits() {
    for status in ["partial", "blocked"] {
        let temp = fixture(true);
        let root = temp.path();
        open(root, "work", "src", true);
        success(root, &["finish"]);
        check(root, "work");
        reviewed(root, "work", status);
        success(root, &close_args("work", false));
        open(root, "broad-check-only", "report.md", false);
        let before = files(root);
        let summary = success(root, &["task", "show", "work"])["readiness_summary"].clone();
        assert_eq!(summary["delivery"]["total"], 2);
        assert!(summary.get("ready").is_none());
        for row in summary["delivery"]["entries"].as_array().unwrap() {
            assert_eq!(row["claim_status"], status);
            assert_eq!(row["no_current_accepted_review"], false);
            assert_eq!(row["claim"]["owner"], "release-owner");
        }
        assert_eq!(
            success(root, &["task", "freshness", "broad-check-only"])["readiness_summary"]["delivery"]
                ["total"],
            0
        );
        assert_eq!(files(root), before);
    }
}

#[test]
fn readiness_unreadable_authority_is_not_an_absent_reviewer_or_missing_claim() {
    let temp = fixture(true);
    let root = temp.path();
    open(root, "work", "src", true);
    let initial = success(root, &["task", "show", "work"])["readiness_summary"].clone();
    assert_eq!(initial["delivery"]["entries"][0]["claim_state"], "missing");
    assert_eq!(
        initial["delivery"]["entries"][0]["reason"],
        "no-explicit-local-reviewer-observed"
    );
    write(root, ".blabla/tasks/unreadable-review.json", "invalid");
    let before = files(root);
    let partial = success(root, &["task", "show", "work"])["readiness_summary"].clone();
    assert_eq!(
        partial["delivery"]["entries"][0]["reviewer_inventory"],
        "unavailable"
    );
    assert_eq!(
        partial["delivery"]["entries"][0]["reason"],
        "reviewer-inventory-unavailable"
    );
    assert_eq!(partial["unavailable"]["total"], 1);
    assert_eq!(files(root), before);
    write(root, "goals.bla", "invalid");
    let unavailable = success(root, &["task", "freshness", "work"])["readiness_summary"].clone();
    assert_eq!(
        unavailable["delivery"]["entries"][0]["claim_state"],
        "unavailable"
    );
    assert!(unavailable["unavailable"]["total"].as_u64().unwrap() >= 2);
}

#[test]
fn readiness_does_not_import_matching_review_credit_from_another_project() {
    let local = fixture(true);
    let foreign = fixture(true);
    for temp in [&local, &foreign] {
        let root = temp.path();
        open(root, "work", "src", true);
        success(root, &["finish"]);
        check(root, "work");
    }
    reviewed(foreign.path(), "work", "delivered");
    let source = std::fs::read(foreign.path().join(".blabla/tasks/work.json")).unwrap();
    write(
        local.path(),
        ".blabla/tasks/work.json",
        std::str::from_utf8(&source).unwrap(),
    );
    let foreign_view = success(foreign.path(), &["task", "show", "work"]);
    let before = files(local.path());
    let local_view = success(local.path(), &["task", "show", "work"]);
    assert_eq!(
        local_view["delivery"]["obligations"][0]["claim_digest"],
        foreign_view["delivery"]["obligations"][0]["claim_digest"]
    );
    assert_ne!(
        local_view["readiness_summary"]["project"],
        foreign_view["readiness_summary"]["project"]
    );
    assert_eq!(
        local_view["readiness_summary"]["delivery"]["entries"][0]["no_current_accepted_review"],
        true
    );
    assert_eq!(
        local_view["readiness_summary"]["delivery"]["entries"][0]["reviewers"]["total"],
        0
    );
    for bounded in [false, true] {
        refusal(local.path(), &close_args("work", bounded));
    }
    assert_eq!(files(local.path()), before);
}
