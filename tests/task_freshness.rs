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

fn cli(temp: &TempDir, args: &[&str]) -> (i32, Value) {
    let mut arguments = vec!["--json"];
    arguments.extend(args);
    let output = support::run_in(Some(temp.path()), &support::args(&arguments));
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
    let (exit, value) = cli(temp, args);
    assert_eq!(exit, 0, "{args:?}: {value}");
    value
}

fn fixture() -> TempDir {
    fixture_files(0)
}

fn fixture_files(count: usize) -> TempDir {
    let temp = TempDir::new().unwrap();
    write(
        temp.path(),
        "project.bla",
        "project Changes\nuse structure \"entry.bla\"\nprocess \"process.bla\"\ngoal \"goals.bla\"\nsystem \"system.bla\"\n",
    );
    write(
        temp.path(),
        "entry.bla",
        "module app \"core/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(
        temp.path(),
        "process.bla",
        "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\npolicy \"bounded\" { applies_to [\"worker\"] statement \"Stay within scope\" }\n",
    );
    write(
        temp.path(),
        "goals.bla",
        "goal \"deliver\" { statement \"Deliver the entry\" expect [\"contract::entry\"] state \"active\" }\n",
    );
    write(
        temp.path(),
        "system.bla",
        "system \"app\" { purpose \"Own the entry\" paths [\"core/\"] }\nsystem \"elsewhere\" { purpose \"Unrelated work\" paths [\"elsewhere/\"] }\n",
    );
    write(temp.path(), "core/app.rs", "pub fn run() {}\n");
    write(temp.path(), "core/extra.rs", "pub fn extra() {}\n");
    write(temp.path(), "optional.txt", "optional input\n");
    write(temp.path(), "check.py", "raise SystemExit(0)\n");
    for n in 0..count {
        write(temp.path(), &format!("core/file-{n:02}.rs"), "opened");
        write(temp.path(), &format!("core/dir-{n:02}/entry.rs"), "opened");
    }
    success(
        &temp,
        &[
            "task",
            "open",
            "work",
            "--role",
            "worker",
            "--statement",
            "Improve the entry",
            "--scope",
            "core/app.rs",
            "--goal",
            "deliver",
            "--require-intent-disposition",
            "--require-goal-reflection",
            "--input",
            "core",
            "check.py",
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    temp
}

fn show(temp: &TempDir) -> Value {
    success(temp, &["task", "show", "work"])
}

fn disposition(temp: &TempDir, identity: &str) {
    success(
        temp,
        &[
            "task",
            "disposition",
            "work",
            identity,
            "--status",
            "confirmed-unchanged",
            "--reason",
            "The callable entry preserves this recorded boundary",
            "--model",
            "worker",
        ],
    );
}

fn complete(temp: &TempDir) {
    let identities: Vec<String> = show(temp)["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["identity"].as_str().unwrap().to_owned())
        .collect();
    for identity in identities {
        disposition(temp, &identity);
    }
}

fn amend_record(temp: &TempDir, change: impl FnOnce(&mut Value)) {
    let path = temp.path().join(".blabla/tasks/work.json");
    let mut value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    change(&mut value);
    std::fs::write(path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
}

fn files(root: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut result = BTreeMap::new();
    for entry in std::fs::read_dir(root).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type().unwrap().is_dir() {
            for (child, bytes) in files(&entry.path()) {
                result.insert(format!("{name}/{child}"), bytes);
            }
        } else {
            result.insert(name, std::fs::read(entry.path()).unwrap());
        }
    }
    result
}

fn freshness(temp: &TempDir) -> Value {
    success(temp, &["task", "freshness", "work"])
}

fn receipt<'a>(view: &'a Value, kind: &str, identity: Option<&str>) -> &'a Value {
    view["receipts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["kind"] == kind && identity.is_none_or(|id| entry["identity"] == id))
        .unwrap()
}

fn delta<'a>(view: &'a Value, receipt: &Value) -> &'a Value {
    view["deltas"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == receipt["shared_delta"])
        .unwrap()
}

#[test]
fn missing_and_grouped_current_receipts_are_read_only_in_text_and_json() {
    let temp = fixture();
    let missing = freshness(&temp);
    assert_eq!(
        receipt(&missing, "disposition", Some("system::app"))["state"],
        "missing"
    );
    assert_eq!(receipt(&missing, "check", None)["state"], "missing");
    complete(&temp);
    let before = files(temp.path());
    let view = freshness(&temp);
    assert_eq!(view["authority"], "diagnostic-only");
    let group = delta(&view, receipt(&view, "disposition", Some("system::app")));
    assert_eq!(group["paths"]["total"], 0);
    assert_eq!(group["identities"]["total"], 0);
    assert!(group["receipt_count"].as_u64().unwrap() > 1);
    let text = support::run_in(
        Some(temp.path()),
        &support::args(&["task", "freshness", "work"]),
    );
    assert!(text.status.success());
    assert!(String::from_utf8_lossy(&text.stdout).contains("diagnostic-only"));
    assert_eq!(files(temp.path()), before);
}

#[test]
fn receipt_matched_opening_expands_only_real_changed_children() {
    let temp = fixture();
    complete(&temp);
    write(temp.path(), "core/extra.rs", "changed");
    write(temp.path(), "core/new.rs", "added");
    std::fs::remove_file(temp.path().join("core/app.rs")).unwrap();
    let view = freshness(&temp);
    let claim = receipt(&view, "disposition", Some("system::app"));
    assert_eq!(claim["state"], "stale");
    assert_eq!(claim["own_identity_changed"], false);
    let group = delta(&view, claim);
    let directory = group["paths"]["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["path"] == "core")
        .unwrap();
    assert_eq!(directory["children"]["availability"], "available");
    assert_eq!(
        directory["children"]["baseline"],
        "opened-tree-digest-match"
    );
    let rows = directory["children"]["entries"].as_array().unwrap();
    assert_eq!(
        rows.iter()
            .map(|r| (r["path"].as_str().unwrap(), r["change"].as_str().unwrap()))
            .collect::<Vec<_>>(),
        vec![
            ("core/app.rs", "removed"),
            ("core/extra.rs", "changed"),
            ("core/new.rs", "added")
        ]
    );
}

#[test]
fn receipt_after_source_edit_does_not_relabel_opening_children() {
    let temp = fixture();
    write(temp.path(), "core/extra.rs", "receipt boundary");
    complete(&temp);
    write(temp.path(), "core/extra.rs", "current boundary");
    let view = freshness(&temp);
    let group = delta(&view, receipt(&view, "disposition", Some("system::app")));
    let children = &group["paths"]["entries"][0]["children"];
    assert_eq!(children["availability"], "baseline-unavailable");
    assert_eq!(children["total"], Value::Null);
    assert_eq!(children["entries"], json!([]));
}

#[test]
fn exact_identity_filter_keeps_shared_staleness_and_invalid_claims() {
    let temp = fixture();
    complete(&temp);
    amend_record(&temp, |record| {
        let claim = record["intent_dispositions"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|r| r["identity"] == "system::app")
            .unwrap();
        claim["model"] = json!("wrong");
        claim["status"] = json!("invented");
        claim["reason"] = json!(" ");
    });
    let view = success(
        &temp,
        &["task", "freshness", "work", "--identity", "system::app"],
    );
    assert_eq!(view["receipts"].as_array().unwrap().len(), 1);
    let claim = receipt(&view, "disposition", Some("system::app"));
    assert_eq!(claim["state"], "stale");
    assert_eq!(
        claim["claim_problems"],
        json!(["accepted-model-mismatch", "blank-reason", "invalid-status"])
    );
    assert_eq!(delta(&view, claim)["paths"]["total"], 0);
    assert_ne!(
        cli(
            &temp,
            &["task", "freshness", "work", "--identity", "unknown"]
        )
        .0,
        0
    );
}

#[test]
fn epoch_and_opaque_assignment_changes_never_invent_field_history() {
    let temp = fixture();
    complete(&temp);
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    let view = freshness(&temp);
    let group = delta(&view, receipt(&view, "disposition", Some("system::app")));
    assert_eq!(group["acceptance_epoch"]["recorded"], 1);
    assert_eq!(group["acceptance_epoch"]["current"], 2);
    assert_eq!(group["assignment"]["changed"], true);
    assert_eq!(
        group["assignment"]["field_availability"],
        "baseline-unavailable"
    );
    assert_eq!(group["assignment"]["fields"], json!([]));
}

#[test]
fn check_and_reflection_have_their_own_receipt_boundaries() {
    let temp = fixture();
    success(&temp, &["task", "evidence", "work", "--run"]);
    complete(&temp);
    success(
        &temp,
        &[
            "task",
            "reflect",
            "work",
            "--outcome",
            "no-useful-successor",
            "--decision",
            "Bounded fixture complete",
            "--observation",
            "Actual check passed",
            "--evidence-ref",
            "check.py",
            "--reason",
            "No further fixture work",
            "--model",
            "worker",
        ],
    );
    let initial = freshness(&temp);
    assert_eq!(receipt(&initial, "check", None)["state"], "current");
    assert_eq!(receipt(&initial, "reflection", None)["state"], "current");
    disposition(&temp, "system::app");
    let view = freshness(&temp);
    let group = delta(&view, receipt(&view, "reflection", None));
    assert_eq!(group["context"], "reflection-composite");
    assert_eq!(group["assignment"]["changed"], true);
    assert_eq!(group["paths"]["total"], 0);
    assert_eq!(receipt(&view, "check", None)["state"], "current");
    write(temp.path(), "core/extra.rs", "changed input");
    let changed = freshness(&temp);
    assert_eq!(receipt(&changed, "check", None)["state"], "stale");
    assert_eq!(
        delta(&changed, receipt(&changed, "check", None))["assignment"]["changed"],
        Value::Null
    );
}

#[test]
fn missing_digest_membership_is_not_confused_with_absent_key() {
    let temp = fixture();
    complete(&temp);
    amend_record(&temp, |record| {
        for claim in record["intent_dispositions"].as_array_mut().unwrap() {
            claim["revision"]["paths"]["missing.txt"] = Value::Null;
        }
    });
    let view = freshness(&temp);
    let group = delta(&view, receipt(&view, "disposition", Some("system::app")));
    assert_eq!(group["paths"]["entries"][0]["change"], "removed");
    assert_eq!(group["paths"]["entries"][0]["recorded"], Value::Null);
}

fn open_review(temp: &TempDir, name: &str, target: &str) {
    success(
        temp,
        &[
            "task",
            "open",
            name,
            "--role",
            "worker",
            "--statement",
            "Review exact target",
            "--review-of",
            target,
            "--scope",
            &format!("reports/{name}.md"),
            "--input",
            "core",
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    success(temp, &["task", "accept", name, "--model", "worker"]);
}

#[test]
fn recursive_review_links_report_staleness_missing_unreadable_and_cycle_without_repinning() {
    let temp = fixture();
    open_review(&temp, "review", "work");
    open_review(&temp, "outer", "review");
    let current = success(&temp, &["task", "freshness", "outer"]);
    assert_eq!(current["review_current"], true);
    write(temp.path(), "core/extra.rs", "new input");
    let before = files(temp.path());
    let stale = success(&temp, &["task", "freshness", "outer"]);
    assert_eq!(stale["review_current"], false);
    assert_eq!(
        stale["receipts"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|r| r["kind"] == "review-target")
            .count(),
        2
    );
    assert_eq!(files(temp.path()), before);
    let path = temp.path().join(".blabla/tasks/work.json");
    let bytes = std::fs::read(&path).unwrap();
    std::fs::remove_file(&path).unwrap();
    let missing = success(&temp, &["task", "freshness", "outer"]);
    assert!(
        missing["receipts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["reason"] == "target-missing")
    );
    std::fs::write(&path, "invalid").unwrap();
    let unreadable = success(&temp, &["task", "freshness", "outer"]);
    assert!(unreadable["receipts"].as_array().unwrap().iter().any(|r| {
        r["reason"]
            .as_str()
            .is_some_and(|s| s.starts_with("target-unreadable:"))
    }));
    std::fs::write(&path, bytes).unwrap();
    let review: Value = serde_json::from_slice(
        &std::fs::read(temp.path().join(".blabla/tasks/review.json")).unwrap(),
    )
    .unwrap();
    amend_record(&temp, |record| {
        record["review_of"] = review["review_of"].clone();
        record["review_of"]["task"] = json!("outer");
    });
    let cycle = success(&temp, &["task", "freshness", "outer"]);
    assert!(
        cycle["receipts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["reason"] == "review-cycle")
    );
}

#[test]
fn closure_bookkeeping_alone_preserves_review_currentness_but_withdrawal_does_not() {
    let temp = fixture();
    open_review(&temp, "review", "work");
    amend_record(&temp, |record| record["state"] = json!("closed"));
    let view = success(&temp, &["task", "freshness", "review"]);
    assert_eq!(view["review_current"], true);
    amend_record(&temp, |record| record["state"] = json!("withdrawn"));
    let view = success(&temp, &["task", "freshness", "review"]);
    assert_eq!(view["review_current"], false);
    assert_eq!(
        receipt(&view, "review-target", None)["reason"],
        "target-withdrawn"
    );
}

#[test]
fn many_source_children_have_exact_counts_and_one_global_display_budget() {
    let temp = fixture_files(60);
    complete(&temp);
    for n in 0..60 {
        write(temp.path(), &format!("core/file-{n:02}.rs"), "changed");
    }
    let view = freshness(&temp);
    let group = delta(&view, receipt(&view, "disposition", Some("system::app")));
    let children = &group["paths"]["entries"][0]["children"];
    assert_eq!(children["total"], 60);
    assert_eq!(children["shown"], 50);
    assert_eq!(children["omitted"], 10);
    assert_eq!(view["children"]["shown"], 50);
    assert_eq!(freshness(&temp), view);
}

#[test]
fn capped_paths_and_identity_differences_keep_complete_counts_and_order() {
    let temp = fixture();
    complete(&temp);
    amend_record(&temp, |record| {
        for claim in record["intent_dispositions"].as_array_mut().unwrap() {
            for n in 0..60 {
                claim["revision"]["paths"][format!("absent-{n:02}")] = json!("old");
                claim["revision"]["identities"][format!("old::{n:02}")] = json!("old");
            }
            claim["revision"]["identities"]["system::app"] = json!("old-definition");
            claim["revision"]["identities"]
                .as_object_mut()
                .unwrap()
                .remove("goal::deliver");
        }
    });
    let view = freshness(&temp);
    let group = delta(&view, receipt(&view, "disposition", Some("system::app")));
    assert_eq!(group["paths"]["total"], 60);
    assert_eq!(group["paths"]["shown"], 50);
    assert_eq!(group["paths"]["omitted"], 10);
    assert_eq!(group["paths"]["entries"][0]["path"], "absent-00");
    assert_eq!(group["identities"]["total"], 62);
    assert_eq!(group["identities"]["omitted"], 12);
    assert_eq!(
        group["identities"]["entries"][0]["identity"],
        "goal::deliver"
    );
    assert_eq!(group["identities"]["entries"][0]["change"], "added");
}

#[test]
fn diagnostics_preserve_challenge_and_all_existing_refusals() {
    let temp = fixture();
    complete(&temp);
    let first = cli(&temp, &["challenge", "work"]);
    let before = files(temp.path());
    freshness(&temp);
    assert_eq!(files(temp.path()), before);
    let second = cli(&temp, &["challenge", "work"]);
    assert_eq!(second, first);
    for args in [
        vec!["task", "ready", "work"],
        vec!["task", "close", "work", "--model", "owner"],
        vec![
            "task",
            "close",
            "work",
            "--bounded",
            "--reason",
            "Current source only",
            "--model",
            "owner",
        ],
        vec![
            "task",
            "disposition",
            "work",
            "system::app",
            "--refresh-ready",
            "--status",
            "confirmed-unchanged",
            "--reason",
            "Explicit attempted receipt",
            "--model",
            "worker",
        ],
    ] {
        let result = cli(&temp, &args);
        assert_ne!(result.0, 0);
        assert_eq!(result.1["category"], "task");
        let before = files(temp.path());
        freshness(&temp);
        assert_eq!(files(temp.path()), before);
        assert_eq!(cli(&temp, &args), result);
    }
}

#[test]
fn absent_task_diagnostic_does_not_create_storage() {
    let temp = TempDir::new().unwrap();
    write(temp.path(), "project.bla", "project Empty\n");
    let before = files(temp.path());
    assert_ne!(cli(&temp, &["task", "freshness", "absent"]).0, 0);
    assert_eq!(files(temp.path()), before);
}

#[test]
fn child_counts_include_roots_beyond_the_path_presentation_cap() {
    let temp = fixture_files(60);
    let paths: Vec<String> = (0..60).map(|n| format!("core/dir-{n:02}")).collect();
    let mut args = vec!["task", "check", "work", "--input"];
    args.extend(paths.iter().map(String::as_str));
    args.extend(["--argv", "python3", "check.py"]);
    success(&temp, &args);
    complete(&temp);
    for path in paths {
        write(temp.path(), &format!("{path}/entry.rs"), "changed");
    }
    let view = freshness(&temp);
    let group = delta(&view, receipt(&view, "disposition", Some("system::app")));
    assert_eq!(group["paths"]["total"], 60);
    assert_eq!(group["paths"]["omitted"], 10);
    assert_eq!(view["children"]["total_available"], 60);
    assert_eq!(view["children"]["shown"], 50);
    assert_eq!(view["children"]["omitted_available"], 10);
}

#[cfg(unix)]
#[test]
fn symlink_and_ignored_files_never_become_invented_child_changes() {
    let temp = fixture();
    complete(&temp);
    std::os::unix::fs::symlink(
        temp.path().join("core/app.rs"),
        temp.path().join("core/link.rs"),
    )
    .unwrap();
    write(temp.path(), "core/.git/ignored", "ignored");
    write(temp.path(), "elsewhere/independent.rs", "unselected");
    let view = freshness(&temp);
    assert_eq!(
        receipt(&view, "disposition", Some("system::app"))["state"],
        "current"
    );
    assert!(
        view["limits"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value.as_str().unwrap().contains("metadata-only"))
    );
}

#[test]
fn ordinary_and_bounded_successes_keep_their_real_verification_and_result_basis() {
    for bounded in [false, true] {
        let temp = TempDir::new().unwrap();
        write(
            temp.path(),
            "project.bla",
            "project Closing\nuse behavior \"behavior.bla\"\nuse structure \"entry.bla\"\nprocess \"process.bla\"\nverify behavior { command [\"python3\", \"app.py\"] seed 0 cases 1 steps 4 timeout_ms 2000 shrink_budget 8 }\n",
        );
        write(
            temp.path(),
            "behavior.bla",
            "state count: int\naction increment()\nwhen increment { expect \"adds-one\": after.count == before.count + 1 }\n",
        );
        write(
            temp.path(),
            "entry.bla",
            "module app \"entry.rs\"\nrequire \"entry\": symbol app::run\n",
        );
        write(temp.path(), "entry.rs", "pub fn run() {}\n");
        write(
            temp.path(),
            "process.bla",
            "role \"orchestrator\" { purpose \"Own\" model \"owner\" }\nrole \"worker\" { purpose \"Work\" model \"worker\" }\n",
        );
        write(
            temp.path(),
            "app.py",
            "import json,sys\ncount=0\nfor line in sys.stdin:\n r=json.loads(line)\n if r['op']=='reset':\n  count=0\n  value={'ok':True}\n elif r['op']=='call':\n  count+=1\n  value={'ok':True}\n else: value={'count':count}\n print(json.dumps({'id':r['id'],'result':value}),flush=True)\n",
        );
        write(temp.path(), "owned.txt", "before");
        write(temp.path(), "other.txt", "before");
        success(
            &temp,
            &[
                "task",
                "open",
                "work",
                "--role",
                "worker",
                "--statement",
                "Update source",
                "--scope",
                "owned.txt",
                "--input",
                "owned.txt",
                "--check-argv",
                "python3",
                "-c",
                "pass",
            ],
        );
        success(
            &temp,
            &[
                "task",
                "open",
                "other",
                "--role",
                "worker",
                "--statement",
                "Other source",
                "--scope",
                "other.txt",
                "--check-argv",
                "python3",
                "-c",
                "pass",
            ],
        );
        success(&temp, &["task", "accept", "work", "--model", "worker"]);
        success(&temp, &["task", "accept", "other", "--model", "worker"]);
        write(temp.path(), "owned.txt", "after");
        success(&temp, &["finish"]);
        success(&temp, &["task", "evidence", "work", "--run"]);
        assert_eq!(
            success(&temp, &["challenge", "work"])["assignment_clear"],
            true
        );
        success(&temp, &["task", "ready", "work"]);
        if bounded {
            write(temp.path(), "other.txt", "after");
        }
        let before = files(temp.path());
        let view = freshness(&temp);
        assert_eq!(receipt(&view, "check", None)["state"], "current");
        assert_eq!(files(temp.path()), before);
        let status = std::fs::read(temp.path().join(".blabla/status.json")).unwrap();
        let mut args = vec!["task", "close", "work", "--model", "owner"];
        if bounded {
            args.extend([
                "--bounded",
                "--reason",
                "Current source accepted while unrelated integration is pending",
            ]);
        }
        success(&temp, &args);
        assert_eq!(show(&temp)["task"]["state"], "closed");
        assert_eq!(
            std::fs::read(temp.path().join(".blabla/status.json")).unwrap(),
            status
        );
        assert_eq!(show(&temp)["task"].get("result_basis").is_some(), bounded);
    }
}

fn amend_named(temp: &TempDir, name: &str, change: impl FnOnce(&mut Value)) {
    let path = temp.path().join(format!(".blabla/tasks/{name}.json"));
    let mut record: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    change(&mut record);
    std::fs::write(path, serde_json::to_vec_pretty(&record).unwrap()).unwrap();
}

#[test]
fn additional_only_drift_has_the_same_full_graph_currentness_and_exact_delta() {
    let temp = fixture();
    success(
        &temp,
        &[
            "task",
            "open",
            "side",
            "--role",
            "worker",
            "--statement",
            "Independent secondary",
            "--scope",
            "side.md",
            "--input",
            "optional.txt",
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    success(&temp, &["task", "accept", "side", "--model", "worker"]);
    success(
        &temp,
        &[
            "task",
            "open",
            "review",
            "--role",
            "worker",
            "--statement",
            "Explicit batch",
            "--scope",
            "review.md",
            "--review-of",
            "work",
            "--delivery-review-of",
            "side",
            "--input",
            "check.py",
            "--check-argv",
            "python3",
            "check.py",
        ],
    );
    success(&temp, &["task", "accept", "review", "--model", "worker"]);
    let pinned = files(temp.path());
    assert_eq!(
        success(&temp, &["task", "freshness", "review"])["review_current"],
        true
    );
    assert_eq!(files(temp.path()), pinned);
    write(temp.path(), "optional.txt", "secondary-only change");
    let before = files(temp.path());
    let shown = success(&temp, &["task", "show", "review"]);
    let fresh = success(&temp, &["task", "freshness", "review"]);
    assert_eq!(fresh["review_current"], shown["review_current"]);
    assert_eq!(fresh["review_current"], false);
    assert_eq!(fresh["readiness_summary"], shown["readiness_summary"]);
    let edges = fresh["readiness_summary"]["review_targets"]["entries"]
        .as_array()
        .unwrap();
    assert!(
        edges
            .iter()
            .any(|e| e["target_task"] == "work" && e["state"] == "current")
    );
    assert!(edges.iter().any(|e| e["target_task"] == "side"
        && e["state"] == "stale"
        && e["relation"] == "additional"));
    let receipt = fresh["receipts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["target"] == "side")
        .unwrap();
    assert!(
        delta(&fresh, receipt)["paths"]["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["path"] == "optional.txt")
    );
    assert_eq!(files(temp.path()), before);
}

#[test]
fn recursive_additional_edges_shared_ancestors_and_invalid_edges_are_explicit() {
    let temp = fixture();
    open_review(&temp, "left", "work");
    open_review(&temp, "right", "work");
    open_review(&temp, "outer", "left");
    let right = success(&temp, &["task", "show", "right"])["task"].clone();
    amend_named(&temp, "outer", |record| {
        let mut pin = record["review_of"].clone();
        pin["task"] = json!("right");
        record["delivery_review_targets"] = json!([pin]);
    });
    let fresh = success(&temp, &["task", "freshness", "outer"]);
    let edges = fresh["readiness_summary"]["review_targets"]["entries"]
        .as_array()
        .unwrap();
    assert_eq!(edges.len(), 4);
    assert!(!edges.iter().any(|r| r["reason"] == "review-cycle"));
    assert!(
        edges
            .iter()
            .any(|r| r["reviewer_task"] == "right" && r["target_task"] == "work")
    );
    for (name, reason) in [
        ("missing", "target-missing"),
        ("outer", "review-cycle"),
        ("left", "duplicate-review-target"),
    ] {
        amend_named(&temp, "outer", |record| {
            record["delivery_review_targets"][0]["task"] = json!(name)
        });
        let before = files(temp.path());
        let fresh = success(&temp, &["task", "freshness", "outer"]);
        assert_eq!(fresh["review_current"], false);
        assert!(
            fresh["readiness_summary"]["review_targets"]["entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|r| r["reason"] == reason),
            "{fresh}"
        );
        assert_eq!(files(temp.path()), before);
    }
    assert_eq!(success(&temp, &["task", "show", "right"])["task"], right);
}

#[test]
fn graph_counts_and_currentness_include_edges_beyond_the_display_cap() {
    let temp = fixture();
    open_review(&temp, "outer", "work");
    let source = show(&temp)["task"].clone();
    let pin = success(&temp, &["task", "show", "outer"])["task"]["review_of"].clone();
    let mut pins = Vec::new();
    for i in 0..55 {
        let name = format!("source-{i:02}");
        let mut record = source.clone();
        record["name"] = json!(name);
        write(
            temp.path(),
            &format!(".blabla/tasks/{name}.json"),
            &record.to_string(),
        );
        let mut target = pin.clone();
        target["task"] = json!(name);
        pins.push(target);
    }
    amend_named(&temp, "outer", |record| {
        record["delivery_review_targets"] = json!(pins)
    });
    let first = success(&temp, &["task", "freshness", "outer"]);
    assert_eq!(first["review_current"], true);
    assert_eq!(first["readiness_summary"]["review_targets"]["total"], 56);
    assert_eq!(first["readiness_summary"]["review_targets"]["shown"], 50);
    assert_eq!(first["readiness_summary"]["review_targets"]["omitted"], 6);
    assert_eq!(success(&temp, &["task", "freshness", "outer"]), first);
    write(temp.path(), ".blabla/tasks/source-54.json", "invalid");
    let before = files(temp.path());
    let fresh = success(&temp, &["task", "freshness", "outer"]);
    assert_eq!(fresh["review_current"], false);
    assert_eq!(
        fresh["review_current"],
        success(&temp, &["task", "show", "outer"])["review_current"]
    );
    assert_eq!(fresh["readiness_summary"]["review_targets"]["total"], 56);
    assert!(
        fresh["readiness_summary"]["unavailable"]["total"]
            .as_u64()
            .unwrap()
            > 0
    );
    assert_eq!(files(temp.path()), before);
}

#[test]
fn readiness_cycle_edges_are_unique_across_roots_and_keep_invalid_graph_facts() {
    let temp = fixture();
    open_review(&temp, "review", "work");
    let pin = success(&temp, &["task", "show", "review"])["task"]["review_of"].clone();
    amend_record(&temp, |record| {
        record["review_of"] = pin;
        record["review_of"]["task"] = json!("review");
    });
    for duplicate in [false, true] {
        if duplicate {
            amend_record(&temp, |record| {
                record["delivery_review_targets"] = json!([record["review_of"].clone()]);
            });
        }
        let before = files(temp.path());
        for name in ["work", "review"] {
            let shown = success(&temp, &["task", "show", name]);
            let fresh = success(&temp, &["task", "freshness", name]);
            assert_eq!(shown["review_current"], false);
            assert_eq!(fresh["review_current"], false);
            assert_eq!(fresh["readiness_summary"], shown["readiness_summary"]);
            let section = &fresh["readiness_summary"]["review_targets"];
            assert_eq!(section["total"], 2, "{section}");
            let edges = section["entries"].as_array().unwrap();
            let pairs: Vec<_> = edges
                .iter()
                .map(|row| {
                    (
                        row["reviewer_task"].as_str().unwrap(),
                        row["target_task"].as_str().unwrap(),
                    )
                })
                .collect();
            assert_eq!(pairs, [("review", "work"), ("work", "review")]);
            for edge in edges {
                assert_eq!(edge["state"], "unavailable");
                assert_eq!(edge["reason"], "review-cycle");
                assert!(
                    edge["reasons"]
                        .as_array()
                        .unwrap()
                        .contains(&json!("review-cycle"))
                );
                assert!(edge["current_revision_fingerprint"].is_string());
            }
            if duplicate {
                assert!(
                    edges[1]["reasons"]
                        .as_array()
                        .unwrap()
                        .contains(&json!("duplicate-review-target"))
                );
                assert_eq!(edges[1]["relations"], json!(["additional", "primary"]));
            }
            assert_eq!(success(&temp, &["task", "freshness", name]), fresh);
        }
        assert_eq!(files(temp.path()), before);
    }
}
