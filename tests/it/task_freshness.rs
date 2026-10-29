use serde_json::{Value, json};
use tempfile::TempDir;

use crate::interpreter;
use crate::support::{self, write};

fn cli(temp: &TempDir, arguments: &[&str]) -> (i32, Value) {
    support::cli_json(temp.path(), arguments)
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
            "--input",
            "core",
            "check.py",
            "--check",
            interpreter::python(),
            "check.py",
        ],
    );
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    temp
}

fn show(temp: &TempDir) -> Value {
    success(temp, &["task", "show", "work"])
}

fn amend_record(temp: &TempDir, change: impl FnOnce(&mut Value)) {
    let path = temp.path().join(".blabla/tasks/work.json");
    let mut value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    change(&mut value);
    std::fs::write(path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
}

fn freshness(temp: &TempDir) -> Value {
    success(temp, &["task", "freshness", "work"])
}

fn receipt<'a>(view: &'a Value, kind: &str) -> &'a Value {
    view["receipts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["kind"] == kind)
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
fn missing_receipts_are_read_only_in_text_and_json() {
    let temp = fixture();
    let missing = freshness(&temp);
    assert_eq!(receipt(&missing, "check")["state"], "missing");
    assert_eq!(
        missing["input_reconciliation"]["reason"],
        "missing-evidence"
    );
    assert_eq!(
        missing["input_reconciliation"]["unchanged_scope_members"]["total"],
        Value::Null
    );
    let before = support::tree_snapshot(temp.path());
    let view = freshness(&temp);
    assert_eq!(view["authority"], "diagnostic-only");
    let text = support::run_in(
        Some(temp.path()),
        &support::args(&["task", "freshness", "work"]),
    );
    assert!(text.status.success());
    assert_eq!(support::tree_snapshot(temp.path()), before);
}

#[test]
fn evidence_member_manifest_after_edit_uses_receipt_children() {
    let temp = fixture();
    write(temp.path(), "core/extra.rs", "receipt boundary");
    write(temp.path(), "core/removed.rs", "present at receipt");
    success(&temp, &["task", "evidence", "work", "--run"]);
    let evidence = show(&temp)["task"]["evidence"][0].clone();
    assert_eq!(evidence["member_manifest"]["capture"], "execution-start");
    assert_eq!(evidence["member_manifest"]["availability"], "complete");
    write(temp.path(), "core/extra.rs", "current boundary");
    std::fs::remove_file(temp.path().join("core/removed.rs")).unwrap();
    write(temp.path(), "core/new.rs", "added after receipt");
    let before = support::tree_snapshot(temp.path());
    let view = freshness(&temp);
    let check = receipt(&view, "check");
    assert_eq!(check["state"], "stale");
    let children = &delta(&view, check)["paths"]["entries"][0]["children"];
    assert_eq!(children["baseline"], "evidence-input-manifest");
    assert_eq!(children["total"], 3);
    let rows = children["entries"].as_array().unwrap();
    assert_eq!(
        rows.iter()
            .map(|r| (r["path"].as_str().unwrap(), r["change"].as_str().unwrap()))
            .collect::<Vec<_>>(),
        [
            ("core/extra.rs", "changed"),
            ("core/new.rs", "added"),
            ("core/removed.rs", "removed")
        ]
    );
    assert_eq!(
        rows[0]["recorded"],
        evidence["member_manifest"]["members"]["core/extra.rs"]
    );
    let text = support::run_in(
        Some(temp.path()),
        &support::args(&["task", "freshness", "work"]),
    );
    assert!(text.status.success());
    assert_eq!(support::tree_snapshot(temp.path()), before);
}

#[test]
fn evidence_member_manifest_stays_at_execution_start_when_child_changes_inputs_and_epoch() {
    for amend in [false, true] {
        let temp = fixture();
        let script = if amend {
            "from pathlib import Path\nimport json\np=Path('.blabla/tasks/work.json')\nt=json.loads(p.read_text())\nt['acceptance_epoch']+=1\nt['check']=['changed','check']\np.write_text(json.dumps(t))\nPath('core/extra.rs').write_text('after child')\n"
        } else {
            "from pathlib import Path\nPath('core/extra.rs').write_text('after child')\n"
        };
        write(temp.path(), "check.py", script);
        let project = blabla::project::load(
            blabla::project::read_manifest(&temp.path().join("project.bla")).unwrap(),
        )
        .unwrap();
        let tree = blabla::project::snapshot(temp.path(), &project.ignore);
        success(&temp, &["task", "evidence", "work", "--run"]);
        let record = show(&temp)["task"].clone();
        let evidence = &record["evidence"][0];
        assert_eq!(
            evidence["member_manifest"]["members"]["core/extra.rs"],
            tree["core/extra.rs"]
        );
        assert_eq!(
            evidence["inputs"]["core"],
            blabla::project::task::observed_digest(&tree, "core").unwrap()
        );
        assert_eq!(evidence["acceptance_epoch"], 1);
        assert_eq!(
            evidence["identity"]["argv"],
            json!([interpreter::python(), "check.py"])
        );
        assert_eq!(record["acceptance_epoch"], if amend { 2 } else { 1 });
        assert_eq!(receipt(&freshness(&temp), "check")["state"], "stale");
    }
}

#[test]
fn evidence_member_manifest_invalid_and_legacy_are_distinct_read_only_diagnostics() {
    let temp = fixture();
    success(&temp, &["task", "evidence", "work", "--run"]);
    let original = show(&temp)["task"]["evidence"][0]["member_manifest"].clone();
    write(temp.path(), "core/extra.rs", "current boundary");
    let mut unsupported = original.clone();
    unsupported["basis"] = json!("future-v2");
    let mut inconsistent = original.clone();
    inconsistent["members"]["core/app.rs"] = json!("0000000000000000");
    for (manifest, reason) in [
        (Value::Null, "malformed-manifest"),
        (json!([1]), "malformed-manifest"),
        (unsupported, "unsupported-basis"),
        (inconsistent, "input-digest-mismatch"),
        (
            json!({"basis":"tracked-input-snapshot-v1", "capture":"execution-start", "availability":"unavailable", "reason":"member-limit", "member_count":8193}),
            "member-limit",
        ),
    ] {
        amend_record(&temp, |record| {
            record["evidence"][0]["member_manifest"] = manifest.clone()
        });
        let before = support::tree_snapshot(temp.path());
        assert_eq!(
            show(&temp)["task"]["evidence"][0]["member_manifest"],
            manifest
        );
        let view = freshness(&temp);
        let check = receipt(&view, "check");
        assert_eq!(check["member_manifest"]["reason"], reason);
        assert_eq!(view["input_reconciliation"]["reason"], reason);
        assert_eq!(
            view["input_reconciliation"]["changed_scope_members"]["total"],
            Value::Null
        );
        assert_eq!(
            view["input_reconciliation"]["changed_dependency_members"]["omitted"],
            Value::Null
        );
        let children = &delta(&view, check)["paths"]["entries"][0]["children"];
        assert_eq!(children["availability"], "baseline-unavailable");
        assert_eq!(children["reason"], reason);
        assert_eq!(children["total"], Value::Null);
        assert_eq!(support::tree_snapshot(temp.path()), before);
    }
    amend_record(&temp, |record| {
        record["evidence"][0]
            .as_object_mut()
            .unwrap()
            .remove("member_manifest");
    });
    let view = freshness(&temp);
    let check = receipt(&view, "check");
    assert_eq!(check["member_manifest"]["reason"], "absent");
    assert_eq!(view["input_reconciliation"]["reason"], "absent");
    assert_eq!(
        view["input_reconciliation"]["unchanged_scope_members"]["total"],
        Value::Null
    );
    let children = &delta(&view, check)["paths"]["entries"][0]["children"];
    assert_eq!(children["availability"], "baseline-unavailable");
    assert_eq!(children["reason"], "absent");
    assert!(
        show(&temp)["task"]["evidence"][0]
            .get("member_manifest")
            .is_none()
    );
}

#[test]
fn evidence_member_manifest_manual_record_is_not_an_execution() {
    let temp = fixture();
    success(
        &temp,
        &[
            "task",
            "check",
            "work",
            "--model",
            "owner",
            "--input",
            "core",
            "--check",
            "manual inspection",
        ],
    );
    success(
        &temp,
        &[
            "task", "evidence", "work", "--exit", "0", "--tool", "manual",
        ],
    );
    let evidence = show(&temp)["task"]["evidence"][0].clone();
    assert_eq!(evidence["member_manifest"]["capture"], "manual-record");
    assert!(evidence.get("command").is_none());
    assert!(evidence.get("log").is_none());
    assert_eq!(
        freshness(&temp)["input_reconciliation"]["capture"],
        "manual-record"
    );
    let text = support::run_in(
        Some(temp.path()),
        &support::args(&["task", "freshness", "work"]),
    );
    assert!(text.status.success());
}

#[test]
fn evidence_member_manifest_counts_all_children_beyond_root_and_global_caps() {
    let temp = fixture_files(60);
    let paths: Vec<String> = (0..60).map(|n| format!("core/dir-{n:02}")).collect();
    let mut args = vec!["task", "check", "work", "--input"];
    args.extend(paths.iter().map(String::as_str));
    args.extend(["--check", interpreter::python(), "check.py"]);
    success(&temp, &args);
    for path in &paths {
        write(temp.path(), &format!("{path}/entry.rs"), "receipt boundary");
    }
    success(&temp, &["task", "evidence", "work", "--run"]);
    for path in &paths {
        write(temp.path(), &format!("{path}/entry.rs"), "current boundary");
    }
    let view = freshness(&temp);
    let group = delta(&view, receipt(&view, "check"));
    assert_eq!(group["paths"]["total"], 60);
    assert_eq!(group["paths"]["omitted"], 10);
    assert_eq!(view["children"]["total_available"], 60);
    assert_eq!(view["children"]["shown"], 50);
    assert_eq!(view["children"]["omitted_available"], 10);
}

#[cfg(unix)]
#[test]
fn evidence_member_manifest_tracks_only_observed_nonignored_nonsymlink_members() {
    let temp = fixture();
    std::os::unix::fs::symlink(
        temp.path().join("core/app.rs"),
        temp.path().join("core/link.rs"),
    )
    .unwrap();
    write(temp.path(), "core/.git/ignored", "not tracked");
    write(temp.path(), "elsewhere/file.rs", "not selected");
    success(&temp, &["task", "evidence", "work", "--run"]);
    let manifest = show(&temp)["task"]["evidence"][0]["member_manifest"].clone();
    assert_eq!(manifest["availability"], "complete");
    assert_eq!(
        manifest["members"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["check.py", "core/app.rs", "core/extra.rs"]
    );
    assert_eq!(
        freshness(&temp)["limits"],
        json!(blabla::project::task::revision::FRESHNESS_LIMITS)
    );
}

#[test]
fn evidence_member_manifest_changed_root_selection_is_not_file_removal() {
    let temp = fixture();
    success(&temp, &["task", "evidence", "work", "--run"]);
    success(
        &temp,
        &[
            "task",
            "check",
            "work",
            "--model",
            "owner",
            "--input",
            "check.py",
            "--check",
            interpreter::python(),
            "check.py",
        ],
    );
    let view = freshness(&temp);
    let check = receipt(&view, "check");
    assert_eq!(check["state"], "stale");
    let children = &delta(&view, check)["paths"]["entries"][0]["children"];
    assert_eq!(children["availability"], "baseline-unavailable");
    assert_eq!(children["reason"], "input-selection-changed");
    assert_eq!(
        view["input_reconciliation"]["reason"],
        "input-selection-changed"
    );
    assert_eq!(
        view["input_reconciliation"]["changed_dependency_members"]["total"],
        Value::Null
    );
    assert_eq!(children["total"], Value::Null);
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
            "--check",
            interpreter::python(),
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
    for name in ["outer", "review"] {
        let shown = success(&temp, &["task", "show", name]);
        assert_eq!(shown["review_current"], true, "{name}");
        assert_eq!(shown["approval_current"], false, "{name}");
    }
    write(temp.path(), "core/extra.rs", "new input");
    for name in ["outer", "review"] {
        let shown = success(&temp, &["task", "show", name]);
        assert_eq!(shown["review_current"], false, "{name}");
    }
    let before = support::tree_snapshot(temp.path());
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
    assert_eq!(support::tree_snapshot(temp.path()), before);
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
        receipt(&view, "review-target")["reason"],
        "target-withdrawn"
    );
}

#[test]
fn review_currentness_follows_every_memory_identity_the_target_depends_on() {
    let temp = fixture();
    let system = "system \"app\" { purpose \"Own the entry\" paths [\"core/\"] }\nsystem \"elsewhere\" { purpose \"Unrelated work\" paths [\"elsewhere/\"] }\nresponsibility \"carry\" { owner \"app\" statement \"Carry the entry\" }\nseam \"handoff\" { between [\"app\", \"elsewhere\"] value \"Parcel\" statement \"One value crosses\" moves_with [\"core/\"] }\n";
    write(temp.path(), "system.bla", system);
    open_review(&temp, "review", "work");
    let current =
        |temp: &TempDir| success(temp, &["task", "freshness", "review"])["review_current"].clone();
    assert_eq!(current(&temp), true);

    let process = std::fs::read_to_string(temp.path().join("process.bla")).unwrap();
    let goals = std::fs::read_to_string(temp.path().join("goals.bla")).unwrap();
    let project = std::fs::read_to_string(temp.path().join("project.bla")).unwrap();
    let edits: [(&str, String, String); 7] = [
        (
            "system.bla",
            system.replace("Carry the entry", "Carry the entry differently"),
            system.to_owned(),
        ),
        (
            "system.bla",
            system.replace("One value crosses", "Another value crosses"),
            system.to_owned(),
        ),
        (
            "system.bla",
            "not a system file".to_owned(),
            system.to_owned(),
        ),
        (
            "process.bla",
            process.replace("Stay within scope", "Stay well within scope"),
            process.clone(),
        ),
        (
            "process.bla",
            "not a process file".to_owned(),
            process.clone(),
        ),
        (
            "goals.bla",
            goals.replace("Deliver the entry", "Deliver the whole entry"),
            goals.clone(),
        ),
        (
            "goals.bla",
            "goal \"other\" { statement \"Another\" expect [\"contract::entry\"] state \"active\" }\n".to_owned(),
            goals.clone(),
        ),
    ];
    for (file, changed, original) in edits {
        write(temp.path(), file, &changed);
        assert_eq!(current(&temp), false, "{file}: {changed}");
        write(temp.path(), file, &original);
        assert_eq!(current(&temp), true, "{file} restored");
    }

    write(
        temp.path(),
        "mission.bla",
        "mission \"fixture\" { statement \"Keep it honest\" }\n",
    );
    write(
        temp.path(),
        "project.bla",
        &format!("{project}mission \"mission.bla\"\n"),
    );
    assert_eq!(current(&temp), false, "a newly registered mission");
}

#[test]
fn diagnostics_preserve_challenge_and_all_existing_refusals() {
    let temp = fixture();
    let first = cli(&temp, &["challenge", "work"]);
    let before = support::tree_snapshot(temp.path());
    freshness(&temp);
    assert_eq!(support::tree_snapshot(temp.path()), before);
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
    ] {
        let result = cli(&temp, &args);
        assert_ne!(result.0, 0);
        assert_eq!(result.1["category"], "task");
        let before = support::tree_snapshot(temp.path());
        freshness(&temp);
        assert_eq!(support::tree_snapshot(temp.path()), before);
        assert_eq!(cli(&temp, &args), result);
    }
}

#[test]
fn absent_task_diagnostic_does_not_create_storage() {
    let temp = TempDir::new().unwrap();
    write(temp.path(), "project.bla", "project Empty\n");
    let before = support::tree_snapshot(temp.path());
    assert_ne!(cli(&temp, &["task", "freshness", "absent"]).0, 0);
    assert_eq!(support::tree_snapshot(temp.path()), before);
}

#[test]
fn ordinary_and_bounded_successes_keep_their_real_verification_and_result_basis() {
    for bounded in [false, true] {
        let temp = TempDir::new().unwrap();
        write(
            temp.path(),
            "project.bla",
            &format!(
                "project Closing\nuse behavior \"behavior.bla\"\nuse structure \"entry.bla\"\nprocess \"process.bla\"\nverify behavior {{ command [\"{}\", \"app.py\"] seed 0 cases 1 steps 4 timeout_ms 10000 shrink_budget 8 }}\n",
                interpreter::python()
            ),
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
                "--check",
                interpreter::python(),
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
                "--check",
                interpreter::python(),
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
        let before = support::tree_snapshot(temp.path());
        let view = freshness(&temp);
        assert_eq!(receipt(&view, "check")["state"], "current");
        assert_eq!(support::tree_snapshot(temp.path()), before);
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

#[test]
fn input_reconciliation_distinguishes_owned_members_from_changed_dependencies_read_only() {
    let temp = fixture();
    success(&temp, &["task", "evidence", "work", "--run"]);
    open_review(&temp, "review", "work");
    let evidence = show(&temp)["task"]["evidence"][0].clone();
    write(temp.path(), "core/extra.rs", "changed validator dependency");
    let before = support::tree_snapshot(temp.path());
    let view = freshness(&temp);
    let reconciliation = &view["input_reconciliation"];
    assert_eq!(reconciliation["availability"], "available");
    assert_eq!(reconciliation["ownership"], "current-declared-scope");
    assert_eq!(reconciliation["evidence_index"], 0);
    assert_eq!(
        reconciliation["recorded_epoch"],
        evidence["acceptance_epoch"]
    );
    assert_eq!(reconciliation["recorded_unix"], evidence["unix"]);
    assert_eq!(reconciliation["capture"], "execution-start");
    assert_eq!(
        reconciliation["shared_delta"],
        receipt(&view, "check")["shared_delta"]
    );
    let unchanged = &reconciliation["unchanged_scope_members"];
    assert_eq!(unchanged["total"], 1);
    assert_eq!(unchanged["entries"][0]["path"], "core/app.rs");
    assert_eq!(
        unchanged["entries"][0]["recorded"],
        evidence["member_manifest"]["members"]["core/app.rs"]
    );
    assert_eq!(
        unchanged["entries"][0]["current"],
        unchanged["entries"][0]["recorded"]
    );
    assert_eq!(reconciliation["changed_scope_members"]["total"], 0);
    let dependencies = &reconciliation["changed_dependency_members"];
    assert_eq!(dependencies["total"], 1);
    assert_eq!(dependencies["entries"][0]["path"], "core/extra.rs");
    assert_eq!(dependencies["entries"][0]["change"], "changed");
    assert_eq!(
        dependencies["entries"][0]["selected_roots"]["entries"],
        json!(["core"])
    );
    assert_eq!(
        dependencies["entries"][0]["recorded"],
        evidence["member_manifest"]["members"]["core/extra.rs"]
    );
    assert_ne!(
        dependencies["entries"][0]["current"],
        dependencies["entries"][0]["recorded"]
    );
    assert_eq!(receipt(&view, "check")["state"], "stale");
    assert_eq!(
        success(&temp, &["task", "freshness", "review"])["review_current"],
        false
    );
    let text = support::run_in(
        Some(temp.path()),
        &support::args(&["task", "freshness", "work"]),
    );
    assert!(text.status.success());
    assert_eq!(support::tree_snapshot(temp.path()), before);
    write(temp.path(), "core/app.rs", "owned member changed");
    let changed = freshness(&temp);
    assert_eq!(
        changed["input_reconciliation"]["unchanged_scope_members"]["total"],
        0
    );
    assert_eq!(
        changed["input_reconciliation"]["changed_scope_members"]["entries"][0]["path"],
        "core/app.rs"
    );
}

#[test]
fn input_reconciliation_deduplicates_overlaps_and_reports_tracking_additions_and_removals() {
    let temp = fixture();
    amend_record(&temp, |record| {
        record["scope"] = json!(["core", "core/app.rs"]);
        record["check_inputs"] = json!(["core", "core/app.rs", "check.py"]);
    });
    success(&temp, &["task", "evidence", "work", "--run"]);
    std::fs::remove_file(temp.path().join("core/app.rs")).unwrap();
    write(temp.path(), "core/new.rs", "newly tracked");
    let view = freshness(&temp);
    let r = &view["input_reconciliation"];
    assert_eq!(r["unchanged_scope_members"]["total"], 1);
    assert_eq!(r["changed_scope_members"]["total"], 2);
    assert_eq!(
        r["changed_scope_members"]["entries"][0]["path"],
        "core/app.rs"
    );
    assert_eq!(
        r["changed_scope_members"]["entries"][0]["change"],
        "removed"
    );
    assert_eq!(
        r["changed_scope_members"]["entries"][0]["current"],
        Value::Null
    );
    assert_eq!(
        r["changed_scope_members"]["entries"][0]["selected_roots"]["entries"],
        json!(["core", "core/app.rs"])
    );
    assert_eq!(
        r["changed_scope_members"]["entries"][1]["path"],
        "core/new.rs"
    );
    assert_eq!(r["changed_scope_members"]["entries"][1]["change"], "added");
    assert_eq!(
        r["changed_scope_members"]["entries"][1]["recorded"],
        Value::Null
    );
    assert_eq!(r["unobserved_inputs"]["entries"][0]["path"], "core/app.rs");
    assert_eq!(
        r["unobserved_inputs"]["entries"][0]["observation"],
        "current-unobserved"
    );
    assert_eq!(freshness(&temp), view);
}

#[test]
fn input_reconciliation_reports_partial_empty_and_unobserved_scope_without_blanket_equality() {
    let temp = fixture();
    amend_record(&temp, |record| {
        record["scope"] = json!(["core", "optional.txt", "missing.txt"]);
        record["check_inputs"] = json!(["core/app.rs", "missing.txt"]);
    });
    success(&temp, &["task", "evidence", "work", "--run"]);
    let view = freshness(&temp);
    let r = &view["input_reconciliation"];
    assert_eq!(r["availability"], "available");
    assert_eq!(r["unchanged_scope_members"]["total"], 1);
    assert_eq!(
        r["scope_coverage"]["entries"][0]["state"],
        "not-observed-by-this-check"
    );
    assert_eq!(
        r["scope_coverage"]["entries"][2]["state"],
        "not-observed-by-this-check"
    );
    assert_eq!(
        r["unobserved_inputs"]["entries"],
        json!([{"path":"missing.txt", "recorded":null, "current":null, "observation":"both-unobserved"}])
    );
    amend_record(&temp, |record| record["scope"] = json!([]));
    let empty = freshness(&temp);
    assert_eq!(empty["input_reconciliation"]["scope_coverage"]["total"], 0);
    assert_eq!(
        empty["input_reconciliation"]["unchanged_scope_members"]["total"],
        0
    );
    assert_eq!(
        empty["input_reconciliation"]["changed_scope_members"]["total"],
        0
    );
}

#[test]
fn input_reconciliation_caps_all_partitions_at_fifty_with_full_deterministic_counts() {
    let temp = fixture_files(40);
    amend_record(&temp, |record| record["scope"] = json!(["core"]));
    success(&temp, &["task", "evidence", "work", "--run"]);
    let view = freshness(&temp);
    let unchanged = &view["input_reconciliation"]["unchanged_scope_members"];
    assert_eq!(unchanged["total"], 82);
    assert_eq!(unchanged["shown"], 50);
    assert_eq!(unchanged["omitted"], 32);
    let paths: Vec<_> = unchanged["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["path"].as_str().unwrap())
        .collect();
    assert!(paths.windows(2).all(|p| p[0] < p[1]));
    assert_eq!(freshness(&temp), view);
    for entry in show(&temp)["task"]["evidence"][0]["member_manifest"]["members"]
        .as_object()
        .unwrap()
        .keys()
        .filter(|p| p.starts_with("core/"))
    {
        write(temp.path(), entry, "changed tracked member");
    }
    let changed = freshness(&temp);
    assert_eq!(
        changed["input_reconciliation"]["changed_scope_members"]["total"],
        82
    );
    assert_eq!(
        changed["input_reconciliation"]["changed_scope_members"]["shown"],
        50
    );
    assert_eq!(
        changed["input_reconciliation"]["changed_scope_members"]["omitted"],
        32
    );
    amend_record(&temp, |record| record["scope"] = json!(["optional.txt"]));
    let dependencies = freshness(&temp);
    assert_eq!(
        dependencies["input_reconciliation"]["changed_dependency_members"]["total"],
        82
    );
    assert_eq!(
        dependencies["input_reconciliation"]["changed_dependency_members"]["shown"],
        50
    );
    assert_eq!(
        dependencies["input_reconciliation"]["changed_dependency_members"]["omitted"],
        32
    );
}

#[test]
fn text_freshness_names_unchanged_members_only_when_verbose() {
    let temp = fixture();
    success(&temp, &["task", "evidence", "work", "--run"]);
    let plain = support::run_in(
        Some(temp.path()),
        &support::args(&["task", "freshness", "work"]),
    );
    let verbose = support::run_in(
        Some(temp.path()),
        &support::args(&["task", "freshness", "work", "--verbose"]),
    );
    assert!(plain.status.success());
    assert!(verbose.status.success());
    let plain = String::from_utf8(plain.stdout).unwrap();
    let verbose = String::from_utf8(verbose.stdout).unwrap();
    assert!(!plain.contains("core/app.rs"));
    assert!(verbose.contains("core/app.rs"));
}
