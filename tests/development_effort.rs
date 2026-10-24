use serde_json::{Value, json};
use std::path::Path;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;

fn cli(root: &Path, args: &[&str]) -> (i32, Value) {
    let mut a = vec!["--json"];
    a.extend(args);
    let o = support::run_in(Some(root), &support::args(&a));
    (
        o.status.code().unwrap(),
        serde_json::from_slice(&o.stdout)
            .unwrap_or_else(|_| json!({"stderr":String::from_utf8_lossy(&o.stderr)})),
    )
}

fn ok(root: &Path, args: &[&str]) -> Value {
    let (code, value) = cli(root, args);
    assert_eq!(code, 0, "{args:?}: {value}");
    value
}

fn fixture() -> TempDir {
    let t = TempDir::new().unwrap();
    for (p, s) in [
        (
            "project.bla",
            "project Effort\nprocess \"process.bla\"\nuse structure \"entry.bla\"\n",
        ),
        (
            "process.bla",
            "role \"orchestrator\" { purpose \"Own\" model \"owner\" }\nrole \"worker\" { purpose \"Work\" model \"worker-model\" }\n",
        ),
        (
            "entry.bla",
            "module app \"app.rs\"\nrequire \"entry\": symbol app::run\n",
        ),
        ("app.rs", "pub fn run() {}\n"),
    ] {
        std::fs::write(t.path().join(p), s).unwrap();
    }
    for (name, scope) in [("one", "one.md"), ("two", "two.md")] {
        ok(
            t.path(),
            &[
                "task",
                "open",
                name,
                "--role",
                "worker",
                "--statement",
                "Measure real phase boundaries",
                "--scope",
                scope,
            ],
        );
        ok(
            t.path(),
            &["task", "accept", name, "--model", "worker-model"],
        );
    }
    t
}

fn record(root: &Path, name: &str) -> Value {
    serde_json::from_slice(&bytes(root, name)).unwrap()
}

fn bytes(root: &Path, name: &str) -> Vec<u8> {
    std::fs::read(root.join(format!(".blabla/tasks/{name}.json"))).unwrap()
}

fn phase(root: &Path, task: &str, value: &str, worker: &str) -> Value {
    ok(
        root,
        &[
            "task",
            "phase",
            task,
            value,
            "--worker",
            worker,
            "--model",
            "worker-model",
        ],
    )
}

fn interval(
    worker: &str,
    phase: &str,
    start: u64,
    end: Option<u64>,
    completion: Option<&str>,
) -> Value {
    json!({"worker":worker,"model":"worker-model","phase":phase,"started_unix":start,"ended_unix":end,"completion":completion,"reason": if phase=="blocked" || completion==Some("unknown") {Some("Synthetic timing fixture")} else {None}})
}

fn timing_fixture(root: &Path, name: &str, values: Vec<Value>) {
    let mut t = record(root, name);
    t["work_intervals"] = json!(values);
    std::fs::write(
        root.join(format!(".blabla/tasks/{name}.json")),
        serde_json::to_vec_pretty(&t).unwrap(),
    )
    .unwrap();
}

#[test]
fn real_phase_switch_stop_and_duplicate_are_explicit() {
    let t = fixture();
    let root = t.path();
    let before = record(root, "one");
    phase(root, "one", "development", "actor-a");
    let first = record(root, "one");
    let row = &first["work_intervals"][0];
    assert_eq!(row["phase"], "development");
    assert!(row["started_unix"].as_u64().unwrap() > 0);
    assert!(row["ended_unix"].is_null());
    let original = bytes(root, "one");
    phase(root, "one", "development", "actor-a");
    assert_eq!(bytes(root, "one"), original);
    phase(root, "one", "verification", "actor-a");
    phase(root, "one", "stop", "actor-a");
    let mut after = record(root, "one");
    let rows = after["work_intervals"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["ended_unix"], rows[1]["started_unix"]);
    assert_eq!(rows[1]["completion"], "attested");
    after.as_object_mut().unwrap().remove("work_intervals");
    assert_eq!(after, before);
}

#[test]
fn legacy_budget_is_unknown_and_read_only() {
    let t = fixture();
    let before = bytes(t.path(), "one");
    let b = ok(t.path(), &["task", "budget"]);
    assert_eq!(b["active_seconds"], 0);
    assert!(b["observed_fraction"].is_null());
    assert_eq!(b["coverage"], "unknown");
    assert_eq!(b["legacy_tasks"], 2);
    assert_eq!(bytes(t.path(), "one"), before);
}

#[test]
fn exact_twenty_percent_and_blocked_pending_unknown_exclusion() {
    let t = fixture();
    let r = t.path();
    timing_fixture(
        r,
        "one",
        vec![
            interval("a", "development", 0, Some(80), Some("attested")),
            interval("a", "verification", 80, Some(90), Some("attested")),
            interval("a", "review", 90, Some(95), Some("attested")),
            interval("a", "integration", 95, Some(100), Some("attested")),
            interval("a", "blocked", 100, Some(1000), Some("attested")),
            interval("a", "development", 1000, Some(2000), Some("unknown")),
            interval("a", "verification", 2000, None, None),
        ],
    );
    let b = ok(r, &["task", "budget"]);
    assert_eq!(b["active_seconds"], 100);
    assert_eq!(b["overhead_seconds"], 20);
    assert_eq!(b["blocked_seconds"], 900);
    assert_eq!(b["observed_fraction"], 0.2);
    assert_eq!(b["observed_target"], "within");
    assert_eq!(b["pending_intervals"], 1);
    assert_eq!(b["unknown_intervals"], 1);
    assert_eq!(b["coverage"], "partial");
    let b = ok(r, &["task", "budget", "--since", "1", "--until", "100"]);
    assert_eq!(b["active_seconds"], 99);
    assert_eq!(b["observed_target"], "above");
}

#[test]
fn distinct_workers_sum_but_same_worker_overlap_is_untrusted() {
    let t = fixture();
    let r = t.path();
    timing_fixture(
        r,
        "one",
        vec![interval("a", "development", 0, Some(80), Some("attested"))],
    );
    timing_fixture(
        r,
        "two",
        vec![interval("b", "review", 0, Some(20), Some("attested"))],
    );
    let b = ok(r, &["task", "budget"]);
    assert_eq!(b["active_seconds"], 100);
    assert!(b["diagnostics"].as_array().unwrap().is_empty());
    timing_fixture(
        r,
        "two",
        vec![interval("a", "review", 0, Some(20), Some("attested"))],
    );
    let b = ok(r, &["task", "budget"]);
    assert!(b["observed_fraction"].is_null());
    assert_eq!(b["observed_target"], "invalid");
    assert!(!b["diagnostics"].as_array().unwrap().is_empty());
}

#[test]
fn wrong_model_unknown_phase_and_blank_actor_refuse_without_task_writes() {
    let t = fixture();
    let r = t.path();
    for args in [
        vec![
            "task",
            "phase",
            "one",
            "development",
            "--worker",
            "a",
            "--model",
            "wrong",
        ],
        vec![
            "task",
            "phase",
            "one",
            "invented",
            "--worker",
            "a",
            "--model",
            "worker-model",
        ],
        vec![
            "task",
            "phase",
            "one",
            "development",
            "--worker",
            " ",
            "--model",
            "worker-model",
        ],
        vec![
            "task",
            "phase",
            "one",
            "blocked",
            "--worker",
            "a",
            "--model",
            "worker-model",
        ],
    ] {
        let before = bytes(r, "one");
        assert_ne!(cli(r, &args).0, 0);
        assert_eq!(bytes(r, "one"), before);
    }
}

#[test]
fn worker_must_stop_before_switching_tasks_and_can_interrupt_uncertain_time() {
    let t = fixture();
    let r = t.path();
    phase(r, "one", "development", "same-worker");
    let before = (bytes(r, "one"), bytes(r, "two"));
    assert_ne!(
        cli(
            r,
            &[
                "task",
                "phase",
                "two",
                "review",
                "--worker",
                "same-worker",
                "--model",
                "worker-model"
            ]
        )
        .0,
        0
    );
    assert_eq!((bytes(r, "one"), bytes(r, "two")), before);
    ok(
        r,
        &[
            "task",
            "phase",
            "one",
            "interrupt",
            "--worker",
            "same-worker",
            "--model",
            "worker-model",
            "--reason",
            "Attention was interrupted",
        ],
    );
    phase(r, "two", "review", "same-worker");
    phase(r, "two", "stop", "same-worker");
    let b = ok(r, &["task", "budget"]);
    assert_eq!(b["unknown_intervals"], 1);
    assert_eq!(b["pending_intervals"], 0);
}

#[test]
fn deterministic_clock_reversal_and_overlap_preserve_records() {
    use blabla::project::task::{self, effort};
    let mut tasks = vec![task::Task {
        name: "one".into(),
        ..task::Task::default()
    }];
    effort::switch(&mut tasks, "one", "a", "m", "development", None, 100).unwrap();
    let before = serde_json::to_vec(&tasks).unwrap();
    assert!(effort::switch(&mut tasks, "one", "a", "m", "stop", None, 99).is_err());
    assert_eq!(serde_json::to_vec(&tasks).unwrap(), before);
    effort::switch(&mut tasks, "one", "a", "m", "stop", None, 100).unwrap();
    let b = effort::budget(
        &[("fixture".into(), tasks.remove(0))],
        vec!["fixture".into()],
        None,
        None,
        vec![],
    );
    assert_eq!(b.active_seconds, 0);
    assert!(b.observed_fraction.is_none());
}

#[test]
fn explicit_project_aggregation_detects_cross_project_worker_overlap() {
    let a = fixture();
    let b = fixture();
    timing_fixture(
        a.path(),
        "one",
        vec![interval("a", "development", 0, Some(80), Some("attested"))],
    );
    timing_fixture(
        b.path(),
        "one",
        vec![interval("b", "review", 0, Some(20), Some("attested"))],
    );
    let before = bytes(b.path(), "one");
    let path = b.path().to_str().unwrap();
    let v = ok(
        a.path(),
        &[
            "task",
            "budget",
            "--include-project",
            path,
            "--include-project",
            path,
        ],
    );
    assert_eq!(v["projects"].as_array().unwrap().len(), 2);
    assert_eq!(v["active_seconds"], 100);
    assert_eq!(bytes(b.path(), "one"), before);
    timing_fixture(
        b.path(),
        "one",
        vec![interval("a", "review", 0, Some(20), Some("attested"))],
    );
    let v = ok(a.path(), &["task", "budget", "--include-project", path]);
    assert_eq!(v["observed_target"], "invalid");
    assert!(v["observed_fraction"].is_null());
}

#[test]
fn malformed_and_missing_cohort_records_are_visible_without_writes() {
    let t = fixture();
    let r = t.path();
    std::fs::write(r.join(".blabla/tasks/broken.json"), "{broken").unwrap();
    let before = bytes(r, "one");
    let b = ok(r, &["task", "budget"]);
    assert!(!b["diagnostics"].as_array().unwrap().is_empty());
    assert!(b["observed_fraction"].is_null());
    assert_eq!(bytes(r, "one"), before);
    assert_ne!(
        cli(
            r,
            &[
                "task",
                "phase",
                "one",
                "development",
                "--worker",
                "a",
                "--model",
                "worker-model"
            ]
        )
        .0,
        0
    );
    assert_eq!(bytes(r, "one"), before);
    let b = ok(
        r,
        &["task", "budget", "--include-project", "missing-project"],
    );
    assert!(b["diagnostics"].as_array().unwrap().len() >= 2);
}

#[test]
fn display_cap_preserves_complete_totals_and_checked_arithmetic() {
    let t = fixture();
    let r = t.path();
    timing_fixture(
        r,
        "one",
        (0..60)
            .map(|i| interval("a", "development", i, i.checked_add(1), Some("attested")))
            .collect(),
    );
    let b = ok(r, &["task", "budget"]);
    assert_eq!(b["active_seconds"], 60);
    assert_eq!(b["interval_count"], 60);
    assert_eq!(b["intervals"].as_array().unwrap().len(), 50);
    assert_eq!(b["omitted_intervals"], 10);
    timing_fixture(
        r,
        "one",
        vec![
            interval("a", "development", 0, Some(u64::MAX), Some("attested")),
            interval("b", "development", 0, Some(1), Some("attested")),
        ],
    );
    let b = ok(r, &["task", "budget"]);
    assert_eq!(b["observed_target"], "invalid");
    assert!(b["observed_fraction"].is_null());
}

#[test]
fn synthetic_closed_packet_allows_only_owner_accounting_without_reopening() {
    let t = fixture();
    let r = t.path();
    let mut value = record(r, "one");
    value["state"] = json!("closed");
    value["closed_unix"] = json!(100);
    value["result"] = json!({"model":"owner","unix":100});
    std::fs::write(
        r.join(".blabla/tasks/one.json"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    let before = bytes(r, "one");
    assert_ne!(
        cli(
            r,
            &[
                "task",
                "phase",
                "one",
                "integration",
                "--worker",
                "owner-actor",
                "--model",
                "worker-model"
            ]
        )
        .0,
        0
    );
    assert_eq!(bytes(r, "one"), before);
    ok(
        r,
        &[
            "task",
            "phase",
            "one",
            "integration",
            "--worker",
            "owner-actor",
            "--model",
            "owner",
        ],
    );
    ok(
        r,
        &[
            "task",
            "phase",
            "one",
            "stop",
            "--worker",
            "owner-actor",
            "--model",
            "owner",
        ],
    );
    let mut after = record(r, "one");
    after.as_object_mut().unwrap().remove("work_intervals");
    assert_eq!(after, value);
}

#[test]
fn revoked_and_malformed_process_authority_refuse() {
    for malformed in [false, true] {
        let t = fixture();
        let r = t.path();
        std::fs::write(
            r.join("process.bla"),
            if malformed {
                "not a process"
            } else {
                "role \"worker\" { purpose \"Revoked\" model \"other\" }\n"
            },
        )
        .unwrap();
        let before = bytes(r, "one");
        assert_ne!(
            cli(
                r,
                &[
                    "task",
                    "phase",
                    "one",
                    "development",
                    "--worker",
                    "a",
                    "--model",
                    "worker-model"
                ]
            )
            .0,
            0
        );
        assert_eq!(bytes(r, "one"), before);
    }
}

#[test]
fn accounting_preserves_actual_evidence_challenge_and_recursive_review_revision() {
    use blabla::project::{self, task};
    let t = fixture();
    let r = t.path();
    ok(
        r,
        &[
            "task",
            "open",
            "checked",
            "--role",
            "worker",
            "--statement",
            "Read the created artifact",
            "--scope",
            "artifact.txt",
            "--check-argv",
            "sh",
            "-c",
            "test -f artifact.txt",
        ],
    );
    ok(r, &["task", "accept", "checked", "--model", "worker-model"]);
    std::fs::write(r.join("artifact.txt"), "actual artifact").unwrap();
    ok(r, &["task", "evidence", "checked", "--run"]);
    ok(r, &["challenge", "checked"]);
    let before: task::Task = serde_json::from_value(record(r, "checked")).unwrap();
    let loaded = project::load(project::read_manifest(&r.join("project.bla")).unwrap()).unwrap();
    let tree = project::snapshot(r, &loaded.ignore);
    assert!(task::challenge_current(&before, &tree));
    assert!(task::readiness(&before, &tree).supported);
    let revision = task::intent_revision(&before, &tree, Default::default());
    let reflection = task::goal_reflection_revision(&before, &tree, Default::default());
    let review = task::Task {
        name: "review".into(),
        ..task::Task::default()
    };
    let target = task::review_revision(&review, &before, &tree, Default::default());
    phase(r, "checked", "development", "a");
    phase(r, "checked", "stop", "a");
    let after: task::Task = serde_json::from_value(record(r, "checked")).unwrap();
    assert!(task::challenge_current(&after, &tree));
    assert!(task::readiness(&after, &tree).supported);
    assert_eq!(
        task::intent_revision(&after, &tree, Default::default()),
        revision
    );
    assert_eq!(
        task::goal_reflection_revision(&after, &tree, Default::default()),
        reflection
    );
    assert_eq!(
        task::review_revision(&review, &after, &tree, Default::default()),
        target
    );
    assert_eq!(
        serde_json::to_value(&before.evidence).unwrap(),
        serde_json::to_value(&after.evidence).unwrap()
    );
    ok(r, &["task", "ready", "checked"]);
    std::fs::write(r.join("artifact.txt"), "actual changed artifact").unwrap();
    let prior = bytes(r, "checked");
    assert_ne!(
        cli(r, &["task", "close", "checked", "--model", "owner"]).0,
        0
    );
    assert_eq!(bytes(r, "checked"), prior);
    std::fs::write(r.join("artifact.txt"), "actual artifact").unwrap();
    ok(r, &["task", "close", "checked", "--model", "owner"]);
    let closed = record(r, "checked");
    ok(
        r,
        &[
            "task",
            "phase",
            "checked",
            "integration",
            "--worker",
            "owner-a",
            "--model",
            "owner",
        ],
    );
    ok(
        r,
        &[
            "task", "phase", "checked", "stop", "--worker", "owner-a", "--model", "owner",
        ],
    );
    let mut accounted = record(r, "checked");
    accounted["work_intervals"] = closed["work_intervals"].clone();
    assert_eq!(accounted, closed);
}

#[test]
fn finite_accounting_size_sample_keeps_all_intervals() {
    for count in [10u64, 100, 1000] {
        let t = fixture();
        let r = t.path();
        let intervals: Vec<_> = (0..count)
            .map(|i| {
                interval(
                    "sample-worker",
                    "development",
                    i,
                    Some(i + 1),
                    Some("attested"),
                )
            })
            .collect();
        let interval_bytes = serde_json::to_vec(&intervals).unwrap().len();
        timing_fixture(r, "one", intervals);
        let before = bytes(r, "one");
        let clock = std::time::Instant::now();
        let b = ok(r, &["task", "budget"]);
        let elapsed = clock.elapsed();
        assert_eq!(b["active_seconds"], count);
        assert_eq!(b["interval_count"], count);
        assert_eq!(b["omitted_intervals"], count.saturating_sub(50));
        assert_eq!(bytes(r, "one"), before);
        eprintln!(
            "effort_sample intervals={count} interval_json_bytes={interval_bytes} task_bytes={} view_json_bytes={} elapsed_us={}",
            before.len(),
            serde_json::to_vec(&b).unwrap().len(),
            elapsed.as_micros()
        );
    }
}

#[test]
fn revoked_pending_interval_stays_visible_and_cannot_be_impersonated() {
    let t = fixture();
    let r = t.path();
    phase(r, "one", "development", "a");
    std::fs::write(r.join("process.bla"),"role \"orchestrator\" { purpose \"Own\" model \"owner\" }\nrole \"worker\" { purpose \"Work\" model \"other\" }\n").unwrap();
    let before = bytes(r, "one");
    let (code, refusal) = cli(
        r,
        &[
            "task",
            "phase",
            "one",
            "stop",
            "--worker",
            "a",
            "--model",
            "worker-model",
        ],
    );
    assert_ne!(code, 0);
    assert!(
        refusal["message"]
            .as_str()
            .unwrap()
            .contains("no longer permitted")
    );
    assert_eq!(bytes(r, "one"), before);
    assert_ne!(
        cli(
            r,
            &[
                "task",
                "phase",
                "one",
                "interrupt",
                "--worker",
                "a",
                "--model",
                "owner",
                "--reason",
                "Owner cannot impersonate prior model"
            ]
        )
        .0,
        0
    );
    assert_eq!(bytes(r, "one"), before);
    let b = ok(r, &["task", "budget"]);
    assert_eq!(b["pending_intervals"], 1);
    assert_eq!(b["active_seconds"], 0);
    assert!(b["observed_fraction"].is_null());
    assert_eq!(b["coverage"], "partial");
}

#[test]
fn budget_on_a_project_without_task_store_creates_nothing() {
    let source = fixture();
    let empty = TempDir::new().unwrap();
    for path in ["project.bla", "process.bla", "entry.bla", "app.rs"] {
        std::fs::copy(source.path().join(path), empty.path().join(path)).unwrap();
    }
    let b = ok(empty.path(), &["task", "budget"]);
    assert_eq!(b["coverage"], "unknown");
    assert_eq!(b["interval_count"], 0);
    assert!(!empty.path().join(".blabla").exists());
}

#[test]
fn mismatched_record_filename_cannot_redirect_phase_writes() {
    let t = fixture();
    let r = t.path();
    let mut corrupt = record(r, "one");
    corrupt["name"] = json!("two");
    std::fs::write(
        r.join(".blabla/tasks/one.json"),
        serde_json::to_vec(&corrupt).unwrap(),
    )
    .unwrap();
    let before = (bytes(r, "one"), bytes(r, "two"));
    assert_ne!(
        cli(
            r,
            &[
                "task",
                "phase",
                "two",
                "development",
                "--worker",
                "a",
                "--model",
                "worker-model"
            ]
        )
        .0,
        0
    );
    assert_eq!((bytes(r, "one"), bytes(r, "two")), before);
    let b = ok(r, &["task", "budget"]);
    assert!(!b["diagnostics"].as_array().unwrap().is_empty());
    assert!(b["observed_fraction"].is_null());
}
