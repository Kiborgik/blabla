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

fn human_show(temp: &TempDir) -> String {
    let output = support::run_in(Some(temp.path()), &support::args(&["task", "show", "work"]));
    assert!(output.status.success(), "{output:?}");
    String::from_utf8(output.stdout).unwrap()
}

fn stable_task_view(mut view: Value) -> Value {
    for entry in view["evidence_progress"]["entries"].as_array_mut().unwrap() {
        assert!(entry["observation_age_seconds"].as_u64().is_some());
        entry["observation_age_seconds"] = json!(0);
    }
    view
}

fn stable_json_output(bytes: &[u8]) -> String {
    let view: Value = serde_json::from_slice(bytes).unwrap();
    let original = format!("\"evidence_progress\":{}", view["evidence_progress"]);
    let stable = stable_task_view(view);
    let replacement = format!("\"evidence_progress\":{}", stable["evidence_progress"]);
    let text = std::str::from_utf8(bytes).unwrap();
    assert_eq!(text.matches(&original).count(), 1);
    text.replacen(&original, &replacement, 1)
}

fn stable_human_output(human: &str) -> String {
    const HEADER: &str =
        "\nEvidence-run progress (last observations only; never readiness authority):\n";
    let Some((before, rest)) = human.split_once(HEADER) else {
        return human.to_owned();
    };
    let (progress, after) = rest.split_once("\n\n").unwrap();
    let progress: String = progress
        .split_inclusive('\n')
        .map(|line| {
            let Some((run_id, rest)) = line
                .strip_prefix("  ")
                .and_then(|line| line.split_once(": last observed "))
            else {
                return line.to_owned();
            };
            assert_eq!(run_id.len(), 32);
            assert!(run_id.bytes().all(|byte| byte.is_ascii_hexdigit()));
            let (phase, rest) = rest.split_once(' ').unwrap();
            assert!(matches!(
                phase,
                "preparing" | "running" | "draining" | "complete" | "incomplete"
            ));
            let (age, rest) = rest.split_once("s ago; stdout ").unwrap();
            assert!(!age.is_empty() && age.bytes().all(|byte| byte.is_ascii_digit()));
            assert!(age.parse::<u64>().is_ok());
            format!("  {run_id}: last observed {phase} 0s ago; stdout {rest}")
        })
        .collect();
    format!("{before}{HEADER}{progress}\n\n{after}")
}

fn human_row<'a>(human: &'a str, identity: &str) -> &'a str {
    let start = human.find(&format!("  {identity}  ")).unwrap();
    let rest = &human[start..];
    let end = rest
        .match_indices("\n  ")
        .find(|(index, _)| !rest[index + 3..].starts_with(' '))
        .map(|(index, _)| index)
        .unwrap();
    &rest[..end]
}

fn assert_human_identities(human: &str, view: &Value) {
    let mut previous = None;
    for entry in view["affected_intent"].as_array().unwrap() {
        let identity = entry["identity"].as_str().unwrap();
        let state = entry["state"].as_str().unwrap().to_uppercase();
        let line = format!("  {identity}  {state}\n");
        assert_eq!(human.matches(&line).count(), 1, "{line}");
        let position = human.find(&line).unwrap();
        assert!(previous.is_none_or(|previous| previous < position));
        previous = Some(position);
        if let Some(reason) = entry["reason"].as_str() {
            let disposition = entry["disposition"].as_str().unwrap();
            assert!(human_row(human, identity).contains(&format!("{disposition}: {reason}")));
        }
    }
}

fn add_policies(temp: &TempDir, count: usize) {
    let mut process = std::fs::read_to_string(temp.path().join("process.bla")).unwrap();
    for index in 0..count {
        process.push_str(&format!(
            "policy \"extra-{index:03}\" {{ applies_to [\"worker\"] statement \"Original boundary {index}\" }}\n"
        ));
    }
    write(temp.path(), "process.bla", &process);
}

fn row<'a>(view: &'a Value, identity: &str) -> &'a Value {
    view["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["identity"] == identity)
        .unwrap()
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

#[test]
fn missing_receipts_have_no_invented_revision_and_current_receipts_have_empty_deltas() {
    let temp = fixture();
    let view = show(&temp);
    let missing = row(&view, "system::app");
    assert_eq!(missing["state"], "missing");
    assert_eq!(missing.get("freshness"), Some(&Value::Null));
    let human = human_show(&temp);
    assert_human_identities(&human, &view);
    assert!(!human.contains("Shared input diagnostic groups:"));
    complete(&temp);
    let view = show(&temp);
    let human = human_show(&temp);
    assert_human_identities(&human, &view);
    assert!(!human.contains("Shared input diagnostic groups:"));
    for row in view["affected_intent"].as_array().unwrap() {
        assert_eq!(row["state"], "current");
        assert_eq!(
            row["freshness"],
            json!({"acceptance_epoch": null, "assignment_digest_changed": false, "changed_paths": [], "changed_identities": [], "own_identity_fingerprint_changed": false, "claim_problems": []})
        );
    }
}

#[test]
fn broad_input_change_explains_shared_staleness_without_inventing_a_child_file() {
    let temp = fixture();
    complete(&temp);
    write(
        temp.path(),
        "core/extra.rs",
        "pub fn extra() { let _ = 1; }\n",
    );
    let view = show(&temp);
    for row in view["affected_intent"].as_array().unwrap() {
        assert_eq!(row["state"], "stale");
        let freshness = &row["freshness"];
        assert_eq!(freshness["acceptance_epoch"], Value::Null);
        assert_eq!(freshness["assignment_digest_changed"], false);
        assert_eq!(freshness["own_identity_fingerprint_changed"], false);
        assert_eq!(freshness["changed_identities"], json!([]));
        let paths = freshness["changed_paths"].as_array().unwrap();
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0]["path"], "core");
        assert_eq!(paths[0]["change"], "changed");
        assert_ne!(paths[0]["recorded"], paths[0]["current"]);
    }
}

#[test]
fn one_identity_change_is_named_for_all_receipts_without_implying_their_own_identity_changed() {
    let temp = fixture();
    complete(&temp);
    let text = std::fs::read_to_string(temp.path().join("system.bla")).unwrap();
    write(
        temp.path(),
        "system.bla",
        &text.replace("Own the entry", "Own the revised entry"),
    );
    let view = show(&temp);
    for row in view["affected_intent"].as_array().unwrap() {
        assert_eq!(row["state"], "stale");
        assert_eq!(row["freshness"]["changed_paths"], json!([]));
        assert_eq!(
            row["freshness"]["own_identity_fingerprint_changed"],
            row["identity"] == "system::app"
        );
        let changes = row["freshness"]["changed_identities"].as_array().unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0]["identity"], "system::app");
        assert_eq!(changes[0]["change"], "changed");
    }
    let human = human_show(&temp);
    assert_human_identities(&human, &view);
    assert_eq!(
        human
            .matches("      identity: system::app (changed)")
            .count(),
        1
    );
    assert_eq!(
        human
            .matches("    Own identity fingerprint: changed\n")
            .count(),
        1
    );
    assert!(human_row(&human, "system::app").contains("Own identity fingerprint: changed"));
    assert!(human_row(&human, "role::worker").contains("Own identity fingerprint: unchanged"));
}

#[test]
fn new_epoch_reports_its_exact_delta_and_an_opaque_assignment_digest_change() {
    let temp = fixture();
    complete(&temp);
    success(&temp, &["task", "accept", "work", "--model", "worker"]);
    let view = show(&temp);
    let freshness = &row(&view, "system::app")["freshness"];
    assert_eq!(
        freshness["acceptance_epoch"],
        json!({"recorded": 1, "current": 2})
    );
    assert_eq!(freshness["assignment_digest_changed"], true);
    assert_eq!(freshness["changed_paths"], json!([]));
    assert_eq!(freshness["changed_identities"], json!([]));
}

#[test]
fn assignment_amendment_does_not_invent_a_field_level_history() {
    let temp = fixture();
    complete(&temp);
    success(
        &temp,
        &[
            "task",
            "statement",
            "work",
            "An amended scoped result",
            "--model",
            "owner",
        ],
    );
    let view = show(&temp);
    let freshness = &row(&view, "system::app")["freshness"];
    assert_eq!(freshness["acceptance_epoch"], Value::Null);
    assert_eq!(freshness["assignment_digest_changed"], true);
    assert!(freshness.get("changed_assignment_fields").is_none());
    assert_eq!(freshness["changed_paths"], json!([]));
}

#[test]
fn added_and_removed_tracked_keys_are_distinct_from_missing_observed_files() {
    let temp = fixture();
    complete(&temp);
    amend_record(&temp, |record| {
        record["check_inputs"] = json!(["core/app.rs", "optional.txt"])
    });
    let view = show(&temp);
    let paths = row(&view, "system::app")["freshness"]["changed_paths"]
        .as_array()
        .unwrap();
    let names: Vec<_> = paths
        .iter()
        .map(|path| path["path"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["check.py", "core", "optional.txt"]);
    assert_eq!(paths[0]["change"], "removed");
    assert!(paths[0]["recorded"].is_string());
    assert_eq!(paths[0]["current"], Value::Null);
    assert_eq!(paths[2]["change"], "added");
    assert_eq!(paths[2]["recorded"], Value::Null);
    assert!(paths[2]["current"].is_string());
    complete(&temp);
    std::fs::remove_file(temp.path().join("optional.txt")).unwrap();
    let view = show(&temp);
    let paths = row(&view, "system::app")["freshness"]["changed_paths"]
        .as_array()
        .unwrap();
    assert_eq!(paths.len(), 1);
    assert_eq!(paths[0]["path"], "optional.txt");
    assert_eq!(paths[0]["change"], "changed");
    assert!(paths[0]["recorded"].is_string());
    assert_eq!(paths[0]["current"], Value::Null);
}

#[test]
fn removed_intent_keeps_its_explicit_absence_fingerprint() {
    let temp = fixture();
    complete(&temp);
    write(
        temp.path(),
        "goals.bla",
        "goal \"other\" { statement \"Another goal\" expect [\"contract::entry\"] state \"active\" }\n",
    );
    let view = show(&temp);
    let goal = row(&view, "goal::deliver");
    assert_eq!(goal["state"], "stale");
    assert_eq!(goal["freshness"]["own_identity_fingerprint_changed"], true);
    let changes = goal["freshness"]["changed_identities"].as_array().unwrap();
    let old = changes
        .iter()
        .find(|change| change["identity"] == "goal::deliver")
        .unwrap();
    assert_eq!(old["change"], "changed");
    assert_eq!(old["current"], "absent");
    let human = human_show(&temp);
    assert!(human_row(&human, "goal::deliver").contains("Own identity fingerprint: changed"));
    assert!(human.contains(&format!(
        "identity: goal::deliver (changed); recorded: {}; current: \"absent\"",
        old["recorded"]
    )));
}

#[test]
fn receipts_from_different_revisions_get_their_own_deltas() {
    let temp = fixture();
    complete(&temp);
    write(temp.path(), "core/extra.rs", "pub fn changed() {}\n");
    disposition(&temp, "system::app");
    let view = show(&temp);
    assert_eq!(row(&view, "system::app")["state"], "current");
    assert_eq!(
        row(&view, "system::app")["freshness"]["changed_paths"],
        json!([])
    );
    assert_eq!(row(&view, "role::worker")["state"], "stale");
    assert_eq!(
        row(&view, "role::worker")["freshness"]["changed_paths"][0]["path"],
        "core"
    );
}

#[test]
fn invalid_claims_are_explained_even_when_revisions_are_equal() {
    for problem in [
        "acceptance-missing",
        "accepted-model-mismatch",
        "invalid-status",
        "blank-reason",
    ] {
        let temp = fixture();
        complete(&temp);
        amend_record(&temp, |record| {
            if problem == "acceptance-missing" {
                record["accepted"] = Value::Null;
                return;
            }
            let receipt = record["intent_dispositions"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|receipt| receipt["identity"] == "system::app")
                .unwrap();
            match problem {
                "accepted-model-mismatch" => receipt["model"] = json!("someone-else"),
                "invalid-status" => receipt["status"] = json!("invented"),
                "blank-reason" => receipt["reason"] = json!(" \n"),
                _ => unreachable!(),
            }
        });
        let view = show(&temp);
        let actual = row(&view, "system::app");
        assert_eq!(actual["state"], "stale");
        let freshness = &actual["freshness"];
        assert_eq!(freshness["claim_problems"], json!([problem]));
        assert_eq!(freshness["acceptance_epoch"], Value::Null);
        assert_eq!(freshness["assignment_digest_changed"], false);
        assert_eq!(freshness["changed_paths"], json!([]));
        assert_eq!(freshness["changed_identities"], json!([]));
    }
}

#[test]
fn stable_comparisons_ignore_only_unsigned_progress_observation_ages() {
    let mut first = json!({
        "affected_intent": [{"identity": "system::app", "state": "stale"}],
        "task": {"acceptance_epoch": 1, "evidence": [{"exit": 0}], "observation_age_seconds": 5},
        "readiness_summary": {"authority": "diagnostic-only"},
        "evidence_progress": {
            "diagnostic_only": true, "directory_available": true,
            "total": 1, "shown": 1, "omitted": 0, "unavailable": 0, "limit": 20,
            "entries": [{
                "observation_age_seconds": 5, "outcome": "exited", "receipt_observed": true,
                "last_observed": {
                    "schema": 1, "run_id": "0123456789abcdef0123456789abcdef",
                    "started_unix": 100, "observed_unix": 101,
                    "limit_bytes": 67108864, "acceptance_epoch": 1,
                    "pins_fingerprint": "pins", "recording": "recorded",
                    "receipt_fingerprint": "receipt",
                    "capture": {
                        "phase": "complete", "child": {"kind": "exited", "code": 0},
                        "stdout_bytes": 3, "stderr_bytes": 4,
                        "stdout_eof": true, "stderr_eof": true, "complete": true,
                        "failure": null, "cancellation_requested": false,
                        "cleanup": "not-requested"
                    }
                }
            }]
        }
    });
    let mut later = first.clone();
    later["evidence_progress"]["entries"][0]["observation_age_seconds"] = json!(6);
    assert_ne!(later, first);
    let first_bytes = serde_json::to_vec(&first).unwrap();
    assert_eq!(
        stable_json_output(&serde_json::to_vec(&later).unwrap()),
        stable_json_output(&first_bytes)
    );
    let progress = &first["evidence_progress"];
    let ordered = format!("{{\"evidence_progress\":{progress},\"task\":\"work\"}}\n");
    for changed in [
        ordered.replacen('{', "{ ", 1),
        format!("{{\"task\":\"work\",\"evidence_progress\":{progress}}}\n"),
        ordered.replace("\"work\"", "\"\\u0077ork\""),
    ] {
        assert_ne!(
            stable_json_output(changed.as_bytes()),
            stable_json_output(ordered.as_bytes())
        );
    }
    let changed = ordered.replace("\"diagnostic_only\":true", "\"diagnostic_only\": true");
    assert!(std::panic::catch_unwind(|| stable_json_output(changed.as_bytes())).is_err());
    let stable = stable_task_view(first.clone());
    assert_eq!(stable_task_view(later), stable);
    first["evidence_progress"]["entries"][0]["observation_age_seconds"] = json!(0);
    assert_eq!(stable, first);

    for parent in [
        "/affected_intent/0",
        "/task",
        "/task/evidence/0",
        "/readiness_summary",
        "/evidence_progress",
        "/evidence_progress/entries/0",
        "/evidence_progress/entries/0/last_observed",
        "/evidence_progress/entries/0/last_observed/capture",
        "/evidence_progress/entries/0/last_observed/capture/child",
    ] {
        for (key, value) in stable.pointer(parent).unwrap().as_object().unwrap() {
            let path = format!("{parent}/{key}");
            if matches!(
                path.as_str(),
                "/evidence_progress/entries"
                    | "/evidence_progress/entries/0/observation_age_seconds"
            ) {
                continue;
            }
            let mut changed = stable.clone();
            *changed.pointer_mut(&path).unwrap() = if value.is_null() {
                json!(false)
            } else {
                Value::Null
            };
            assert_ne!(stable_task_view(changed), stable, "{path}");
        }
    }
    for invalid in [Value::Null, json!(-1), json!(1.5), json!("5")] {
        let mut changed = stable.clone();
        changed["evidence_progress"]["entries"][0]["observation_age_seconds"] = invalid;
        assert!(std::panic::catch_unwind(|| stable_task_view(changed)).is_err());
    }

    let human = "task::work   ACCEPTED\n\nEvidence-run progress (last observations only; never readiness authority):\n  1 total, 1 shown, 0 omitted, 0 unavailable\n  0123456789abcdef0123456789abcdef: last observed complete 5s ago; stdout 3 bytes, stderr 4 bytes; outcome exited; recording recorded; receipt observed true\n\nStatement:\n  An unrelated event was 5s ago\n";
    let stable = stable_human_output(human);
    assert_eq!(stable, human.replace("complete 5s ago", "complete 0s ago"));
    assert_eq!(
        stable_human_output(&human.replace("complete 5s ago", "complete 6s ago")),
        stable
    );
    for (before, after) in [
        ("ACCEPTED", "READY"),
        ("1 total", "2 total"),
        ("1 shown", "0 shown"),
        ("0 omitted", "1 omitted"),
        ("0 unavailable", "1 unavailable"),
        (
            "0123456789abcdef0123456789abcdef",
            "1123456789abcdef0123456789abcdef",
        ),
        ("complete 5s ago", "running 5s ago"),
        ("stdout 3", "stdout 4"),
        ("stderr 4", "stderr 5"),
        ("outcome exited", "outcome unknown"),
        ("recording recorded", "recording failed"),
        ("receipt observed true", "receipt observed false"),
        ("event was 5s ago", "event was 6s ago"),
    ] {
        assert_ne!(stable_human_output(&human.replace(before, after)), stable);
    }
    for invalid in ["-1", "1.5", "+5", "18446744073709551616"] {
        let changed = human.replace("complete 5s ago", &format!("complete {invalid}s ago"));
        assert!(std::panic::catch_unwind(|| stable_human_output(&changed)).is_err());
    }
}

#[test]
fn explanation_is_deterministic_read_only_and_does_not_change_challenge_or_readiness() {
    let temp = fixture();
    complete(&temp);
    success(&temp, &["task", "evidence", "work", "--run"]);
    write(temp.path(), "core/extra.rs", "pub fn changed() {}\n");
    let challenge_before = cli(&temp, &["challenge", "work"]);
    let ready_before = cli(&temp, &["task", "ready", "work"]);
    let before = files(temp.path());
    let first = stable_task_view(show(&temp));
    assert_eq!(stable_task_view(show(&temp)), first);
    let json_before = support::run_in(
        Some(temp.path()),
        &support::args(&["--json", "task", "show", "work"]),
    );
    assert!(json_before.status.success());
    let human = human_show(&temp);
    assert_eq!(
        stable_human_output(&human_show(&temp)),
        stable_human_output(&human)
    );
    assert_eq!(stable_task_view(show(&temp)), first);
    let json_after = support::run_in(
        Some(temp.path()),
        &support::args(&["--json", "task", "show", "work"]),
    );
    assert!(json_after.status.success());
    assert_eq!(
        stable_json_output(&json_after.stdout),
        stable_json_output(&json_before.stdout)
    );
    assert_human_identities(&human, &first);
    assert!(human.contains("Shared input changes"));
    assert!(human.contains("core (changed)"));
    assert!(human.contains("Own identity fingerprint: unchanged"));
    assert!(human.contains("directory fingerprints do not identify changed child files"));
    assert!(human.contains("Assignment digests do not identify changed fields"));
    assert!(
        human.contains("Shared input changes do not establish a semantic change to each identity")
    );
    assert!(human.contains("Reasons are accountable review claims; they never mark goals done or replace evidence, scope or contract authority"));
    assert_eq!(files(temp.path()), before);
    let challenge_after = cli(&temp, &["challenge", "work"]);
    let ready_after = cli(&temp, &["task", "ready", "work"]);
    assert_eq!(challenge_after.0, challenge_before.0);
    assert_eq!(
        challenge_after.1["assignment_blockers"],
        challenge_before.1["assignment_blockers"]
    );
    assert_eq!(ready_after, ready_before);
}

#[test]
fn unrelated_intent_change_leaves_current_receipts_without_deltas() {
    let temp = fixture();
    complete(&temp);
    let text = std::fs::read_to_string(temp.path().join("system.bla")).unwrap();
    write(
        temp.path(),
        "system.bla",
        &text.replace("Unrelated work", "Unrelated amended work"),
    );
    let view = show(&temp);
    assert_eq!(view["intent_disposition_current"], true);
    assert_eq!(
        row(&view, "system::app")["freshness"]["changed_identities"],
        json!([])
    );
}

#[test]
fn shared_diagnostics_keep_more_than_64_identities_and_all_paths_and_identity_changes() {
    let temp = fixture();
    add_policies(&temp, 70);
    let paths: Vec<String> = (0..21)
        .map(|index| format!("inputs/{index:03}.txt"))
        .collect();
    for path in &paths {
        write(temp.path(), path, "original\n");
    }
    let mut args = vec![
        "task", "check", "work", "--model", "owner", "--input", "core", "check.py",
    ];
    args.extend(paths.iter().map(String::as_str));
    success(&temp, &args);
    complete(&temp);
    for path in &paths {
        write(temp.path(), path, "revised\n");
    }
    let process = std::fs::read_to_string(temp.path().join("process.bla")).unwrap();
    write(
        temp.path(),
        "process.bla",
        &process.replace("Original boundary", "Revised boundary"),
    );
    let view = show(&temp);
    let entries = view["affected_intent"].as_array().unwrap();
    assert!(entries.len() > 64);
    assert_eq!(
        entries[0]["freshness"]["changed_paths"]
            .as_array()
            .unwrap()
            .len(),
        21
    );
    assert_eq!(
        entries[0]["freshness"]["changed_identities"]
            .as_array()
            .unwrap()
            .len(),
        70
    );
    let human = human_show(&temp);
    assert_human_identities(&human, &view);
    assert_eq!(
        human.matches("    Shared input changes: group 1\n").count(),
        entries.len()
    );
    assert_eq!(
        human.matches("  Shared input diagnostic groups:\n").count(),
        1
    );
    assert!(human.contains(&format!("    group 1 ({} references):\n", entries.len())));
    assert!(!human.contains("    group 2 ("));
    for path in paths {
        assert_eq!(
            human
                .matches(&format!("      path: {path} (changed)"))
                .count(),
            1
        );
    }
    for index in 0..70 {
        assert_eq!(
            human
                .matches(&format!(
                    "      identity: policy::extra-{index:03} (changed)"
                ))
                .count(),
            1
        );
    }
    assert_eq!(
        human
            .matches("    Own identity fingerprint: changed\n")
            .count(),
        70
    );
    assert_eq!(
        human
            .matches("    Own identity fingerprint: unchanged\n")
            .count(),
        entries.len() - 70
    );
}

#[test]
fn equal_path_labels_with_different_recorded_fingerprints_stay_in_separate_groups() {
    let temp = fixture();
    complete(&temp);
    write(temp.path(), "core/extra.rs", "pub fn middle() {}\n");
    disposition(&temp, "system::app");
    write(temp.path(), "core/extra.rs", "pub fn latest() {}\n");
    let view = show(&temp);
    let older = &row(&view, "role::worker")["freshness"]["changed_paths"][0];
    let newer = &row(&view, "system::app")["freshness"]["changed_paths"][0];
    assert_eq!(older["path"], newer["path"]);
    assert_eq!(older["change"], newer["change"]);
    assert_eq!(older["current"], newer["current"]);
    assert_ne!(older["recorded"], newer["recorded"]);
    let human = human_show(&temp);
    assert_human_identities(&human, &view);
    assert!(human_row(&human, "role::worker").contains("Shared input changes: group 1"));
    assert!(human_row(&human, "system::app").contains("Shared input changes: group 2"));
    assert_eq!(human.matches("      path: core (changed)").count(), 2);
    for delta in [older, newer] {
        assert!(human.contains(&format!(
            "recorded: {}; current: {}",
            delta["recorded"], delta["current"]
        )));
    }
}

#[test]
fn grouping_preserves_interleaved_current_missing_and_stale_rows() {
    let temp = fixture();
    complete(&temp);
    write(temp.path(), "core/extra.rs", "pub fn revised() {}\n");
    disposition(&temp, "system::app");
    amend_record(&temp, |record| {
        record["intent_dispositions"]
            .as_array_mut()
            .unwrap()
            .retain(|entry| entry["identity"] != "role::worker");
    });
    let view = show(&temp);
    let human = human_show(&temp);
    assert_human_identities(&human, &view);
    assert!(human_row(&human, "system::app").starts_with("  system::app  CURRENT\n"));
    assert_eq!(human_row(&human, "role::worker"), "  role::worker  MISSING");
    assert!(!human_row(&human, "system::app").contains("Shared input changes"));
    let stale = view["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["state"] == "stale")
        .count();
    assert!(human.contains(&format!("    group 1 ({stale} references):\n")));
    assert_eq!(
        human.matches("    Shared input changes: group 1\n").count(),
        stale
    );
}

#[test]
fn claim_only_staleness_shares_empty_deltas_without_sharing_claim_problems() {
    let temp = fixture();
    complete(&temp);
    amend_record(&temp, |record| {
        for entry in record["intent_dispositions"].as_array_mut().unwrap() {
            match entry["identity"].as_str().unwrap() {
                "system::app" => entry["model"] = json!("another-worker"),
                "role::worker" => entry["status"] = json!("unrecognized"),
                "policy::bounded" => entry["reason"] = json!(" "),
                _ => {}
            }
        }
    });
    let view = show(&temp);
    let human = human_show(&temp);
    assert_human_identities(&human, &view);
    assert!(human.contains("    group 1 (3 references):\n      none\n"));
    assert!(!human.contains("    group 2 ("));
    for (identity, problem) in [
        ("system::app", "accepted-model-mismatch"),
        ("role::worker", "invalid-status"),
        ("policy::bounded", "blank-reason"),
    ] {
        let entry = human_row(&human, identity);
        assert!(entry.contains("Shared input changes: group 1"));
        assert!(entry.contains(&format!("Claim problems: {problem}")));
        assert_eq!(entry.matches("Claim problems:").count(), 1);
        assert!(entry.contains("Own identity fingerprint: unchanged"));
    }
}

#[test]
fn exact_shared_delta_keys_distinguish_epochs_assignment_and_added_removed_or_missing_fingerprints()
{
    let temp = fixture();
    add_policies(&temp, 14);
    complete(&temp);
    amend_record(&temp, |record| {
        for (index, entry) in record["intent_dispositions"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .take(14)
            .enumerate()
        {
            entry["model"] = json!("another-worker");
            let revision = &mut entry["revision"];
            match index {
                0 => {}
                1 => revision["acceptance_epoch"] = json!(0),
                2 => revision["acceptance_epoch"] = json!(2),
                3 => revision["task_digest"] = json!("first-opaque-assignment"),
                4 => revision["task_digest"] = json!("second-opaque-assignment"),
                5 => {
                    revision["paths"].as_object_mut().unwrap().remove("core");
                }
                6 => revision["paths"]["core"] = Value::Null,
                7 => revision["paths"]["removed"] = Value::Null,
                8 => revision["paths"]["removed"] = json!("absent"),
                9 => {
                    revision["identities"]
                        .as_object_mut()
                        .unwrap()
                        .remove("system::app");
                }
                10 => revision["identities"]["system::app"] = json!("absent"),
                11 => revision["identities"]["system::app"] = json!("different-baseline"),
                12 => revision["identities"]["removed::identity"] = json!("absent"),
                13 => revision["identities"]["removed::identity"] = json!("different-baseline"),
                _ => unreachable!(),
            }
        }
    });
    let view = show(&temp);
    let human = human_show(&temp);
    assert_human_identities(&human, &view);
    let expected = [1, 2, 3, 4, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    for (entry, group) in view["affected_intent"]
        .as_array()
        .unwrap()
        .iter()
        .zip(expected)
    {
        let identity = entry["identity"].as_str().unwrap();
        assert!(
            human_row(&human, identity).contains(&format!("Shared input changes: group {group}\n")),
            "{identity}: expected group {group}\n{human}"
        );
    }
    for group in 1..=13 {
        let references = if group == 4 { 2 } else { 1 };
        assert_eq!(
            human
                .matches(&format!("    group {group} ({references} references):\n"))
                .count(),
            1
        );
    }
    assert!(!human.contains("    group 14 ("));
    assert!(human.contains("acceptance epoch: 0 -> 1"));
    assert!(human.contains("acceptance epoch: 2 -> 1"));
    assert_eq!(
        human
            .matches("assignment digest changed (includes the acceptance epoch)")
            .count(),
        1
    );
    assert!(human.contains("path: core (added); recorded: null; current:"));
    assert!(human.contains("path: core (changed); recorded: null; current:"));
    assert!(human.contains("path: removed (removed); recorded: null; current: null"));
    assert!(human.contains("path: removed (removed); recorded: \"absent\"; current: null"));
    assert!(human.contains("identity: system::app (added); recorded: null; current:"));
    assert!(human.contains("identity: system::app (changed); recorded: \"absent\"; current:"));
    assert!(
        human
            .contains("identity: removed::identity (removed); recorded: \"absent\"; current: null")
    );
}
