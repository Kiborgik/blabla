use blabla::project::task;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Output;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;

const PROCESS: &str = "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"gpt-6-astra\" }\nalias \"astra-host\" { model \"gpt-6-astra\" }\n";

fn run(temp: &TempDir, arguments: &[&str]) -> Output {
    support::run_in(Some(temp.path()), &support::args(arguments))
}

fn success(temp: &TempDir, arguments: &[&str]) -> Value {
    let mut args = vec!["--json"];
    args.extend_from_slice(arguments);
    let output = run(temp, &args);
    assert_eq!(output.status.code(), Some(0), "{arguments:?}: {output:?}");
    serde_json::from_slice(&output.stdout).unwrap()
}

fn files(root: &Path) -> BTreeMap<String, Option<Vec<u8>>> {
    fn visit(root: &Path, path: &Path, result: &mut BTreeMap<String, Option<Vec<u8>>>) {
        for entry in std::fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            let name = path.strip_prefix(root).unwrap().display().to_string();
            if path.is_dir() {
                result.insert(name, None);
                visit(root, &path, result);
            } else {
                result.insert(name, Some(std::fs::read(path).unwrap()));
            }
        }
    }
    let mut result = BTreeMap::new();
    visit(root, root, &mut result);
    result
}

fn fixture(process: Option<&str>) -> TempDir {
    let temp = TempDir::new().unwrap();
    let registration = if process.is_some() {
        "process \"process.bla\"\n"
    } else {
        ""
    };
    std::fs::write(
        temp.path().join("project.bla"),
        format!("project Acceptance\n{registration}use structure \"entry.bla\"\n"),
    )
    .unwrap();
    std::fs::write(
        temp.path().join("entry.bla"),
        "module app \"app.rs\"\nrequire \"entry\": symbol app::run\n",
    )
    .unwrap();
    std::fs::write(temp.path().join("app.rs"), "pub fn run() {}\n").unwrap();
    if let Some(process) = process {
        std::fs::write(temp.path().join("process.bla"), process).unwrap();
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
            "Exercise acceptance guidance",
            "--scope",
            "app.rs",
            "--require-intent-disposition",
            "--check-argv",
            "python3",
            "-c",
            "pass",
        ],
    );
    temp
}

#[test]
fn compound_model_warns_without_changing_acceptance() {
    eprintln!("TESTED_CLI={}", env!("CARGO_BIN_EXE_blabla"));
    let temp = fixture(Some(PROCESS));
    let before = files(temp.path());
    let output = run(
        &temp,
        &["task", "accept", "work", "--model", "gpt-6-astra/xhigh"],
    );
    assert_eq!(output.status.code(), Some(0), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(
        text.contains("acceptance is recorded but model permission remains unsettled"),
        "{text}"
    );
    assert!(text.contains("gpt-6-astra/xhigh"), "{text}");
    assert!(
        text.contains("gpt-6-astra") && text.contains("astra-host"),
        "{text}"
    );
    assert!(
        text.contains("task propose-model") && text.contains("task approve-model"),
        "{text}"
    );
    let record = task::read(temp.path(), "work").unwrap().unwrap();
    assert_eq!(record.accepted.unwrap().model, "gpt-6-astra/xhigh");
    assert_eq!(record.acceptance_epoch, 1);
    assert_eq!(record.state, "accepted");
    assert!(
        record.evidence.is_empty() && record.exceptions.is_empty() && record.challenged.is_none()
    );
    let mut after = files(temp.path());
    after.insert(
        ".blabla/tasks/work.json".to_owned(),
        before[".blabla/tasks/work.json"].clone(),
    );
    assert_eq!(after, before);
}

fn accept(temp: &TempDir, model: &str, json: bool) -> Output {
    let mut args = vec!["task", "accept", "work", "--model", model];
    if json {
        args.push("--json");
    }
    let output = run(temp, &args);
    assert_eq!(output.status.code(), Some(0), "{output:?}");
    assert!(output.stderr.is_empty(), "{output:?}");
    output
}

fn quiet(output: &Output, json: bool) {
    if json {
        let value: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert!(value.get("model_acceptance").is_none(), "{value}");
    } else {
        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            "task::work   ACCEPTED   recorded; blabla task show work prints the record\n"
        );
    }
}

fn refused(temp: &TempDir, args: &[&str], message: &str) {
    let before = files(temp.path());
    let mut arguments = vec!["--json"];
    arguments.extend_from_slice(args);
    let output = run(temp, &arguments);
    assert_eq!(output.status.code(), Some(2), "{output:?}");
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(
        value["message"].as_str().unwrap().contains(message),
        "{value}"
    );
    assert!(value.get("model_acceptance").is_none(), "{value}");
    assert_eq!(files(temp.path()), before);
}

fn propose(temp: &TempDir, model: &str) {
    success(
        temp,
        &[
            "task",
            "propose-model",
            "work",
            model,
            "--reason",
            "Actual worker identity",
        ],
    );
}

fn approve(temp: &TempDir, model: &str) -> Value {
    success(
        temp,
        &[
            "task",
            "approve-model",
            "work",
            model,
            "--approval",
            "The fixture owner approved the actual worker",
        ],
    )
}

#[test]
fn json_guidance_keeps_exact_unlisted_identity_and_is_not_persisted() {
    for model in [
        "gpt-6-astra/xhigh",
        "unknown",
        " gpt-6-astra ",
        "GPT-6-ASTRA",
        "",
    ] {
        let temp = fixture(Some(PROCESS));
        let output = accept(&temp, model, true);
        let value: Value = serde_json::from_slice(&output.stdout).unwrap();
        let guidance = &value["model_acceptance"];
        assert_eq!(guidance["status"], "outside_role_policy");
        assert_eq!(guidance["accepted_model"], model);
        assert_eq!(guidance["role"], "worker");
        assert_eq!(
            guidance["permitted_models"],
            serde_json::json!(["gpt-6-astra", "astra-host"])
        );
        assert_eq!(guidance["authority"], "diagnostic-only");
        let message = guidance["message"].as_str().unwrap();
        assert!(
            message.contains("acceptance is recorded but model permission remains unsettled"),
            "{value}"
        );
        assert!(
            message.contains("task propose-model work <recorded-model>")
                && message.contains("task approve-model work <recorded-model>"),
            "{value}"
        );
        assert!(
            message.contains("Attest the actual model") && message.contains("Do not reaccept"),
            "{value}"
        );
        assert_eq!(value["task"]["accepted"]["model"], model);
        assert_eq!(value["task"]["acceptance_epoch"], 1);
        let stored: Value = serde_json::from_slice(
            &std::fs::read(temp.path().join(".blabla/tasks/work.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(stored, value["task"]);
        assert!(stored.get("model_acceptance").is_none());
        assert!(
            success(&temp, &["task", "show", "work"])
                .get("model_acceptance")
                .is_none()
        );
        assert!(
            success(&temp, &["task", "note", "work", "Keep the identity exact"])
                .get("model_acceptance")
                .is_none()
        );
        let noted = run(
            &temp,
            &["task", "note", "work", "Still no acceptance diagnostic"],
        );
        quiet(&noted, false);
    }
}

#[test]
fn permitted_models_and_declared_aliases_are_quiet_in_both_formats() {
    for json in [false, true] {
        for model in ["gpt-6-astra", "astra-host"] {
            let temp = fixture(Some(PROCESS));
            quiet(&accept(&temp, model, json), json);
            let record = task::read(temp.path(), "work").unwrap().unwrap();
            assert_eq!(record.accepted.unwrap().model, model);
            assert_eq!(record.acceptance_epoch, 1);
            assert!(record.exceptions.is_empty());
        }
    }
}

#[test]
fn only_matching_approved_nonsuperseded_exceptions_quiet_the_diagnostic() {
    for json in [false, true] {
        for kind in ["pending", "wrong", "superseded", "approved"] {
            let temp = fixture(Some(PROCESS));
            let model = if kind == "wrong" {
                "other"
            } else {
                "gpt-6-astra/xhigh"
            };
            propose(&temp, model);
            if kind != "pending" {
                approve(&temp, model);
            }
            if kind == "superseded" {
                let mut record = task::read(temp.path(), "work").unwrap().unwrap();
                record.exceptions[0].superseded = true;
                task::write(temp.path(), &record).unwrap();
            }
            let output = accept(&temp, "gpt-6-astra/xhigh", json);
            if kind == "approved" {
                quiet(&output, json);
                quiet(&accept(&temp, "gpt-6-astra/xhigh", json), json);
                assert_eq!(
                    task::read(temp.path(), "work")
                        .unwrap()
                        .unwrap()
                        .acceptance_epoch,
                    2
                );
            } else if json {
                let value: Value = serde_json::from_slice(&output.stdout).unwrap();
                assert_eq!(
                    value["model_acceptance"]["status"], "outside_role_policy",
                    "{kind}: {value}"
                );
            } else {
                assert!(
                    String::from_utf8_lossy(&output.stdout)
                        .contains("model permission remains unsettled"),
                    "{kind}: {output:?}"
                );
            }
        }
    }
}

#[test]
fn bootstrap_and_empty_model_policy_remain_quiet_and_usable() {
    for json in [false, true] {
        for process in [
            None,
            Some(""),
            Some("role \"worker\" { purpose \"Bootstrap\" }\n"),
        ] {
            let temp = fixture(process);
            if process.is_none() {
                std::fs::write(temp.path().join("process.bla"), PROCESS).unwrap();
            }
            quiet(&accept(&temp, "unlisted-actual-model", json), json);
            assert_eq!(
                task::read(temp.path(), "work")
                    .unwrap()
                    .unwrap()
                    .acceptance_epoch,
                1
            );
        }
    }
}

#[test]
fn unavailable_registered_policy_is_not_reported_as_an_empty_permitted_list() {
    for json in [false, true] {
        for replacement in [
            None,
            Some("role \"worker\" {"),
            Some("role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\n"),
        ] {
            let temp = fixture(Some(PROCESS));
            let path = temp.path().join("process.bla");
            if let Some(replacement) = replacement {
                std::fs::write(path, replacement).unwrap();
            } else {
                std::fs::remove_file(path).unwrap();
            }
            let output = accept(&temp, "gpt-6-astra", json);
            if json {
                let value: Value = serde_json::from_slice(&output.stdout).unwrap();
                let guidance = &value["model_acceptance"];
                assert_eq!(guidance["status"], "unavailable", "{value}");
                assert_eq!(guidance["accepted_model"], "gpt-6-astra");
                assert!(guidance["permitted_models"].is_null(), "{value}");
                assert_eq!(guidance["authority"], "diagnostic-only");
            } else {
                let text = String::from_utf8_lossy(&output.stdout);
                assert!(
                    text.contains("permitted IDs are unavailable")
                        && text.contains("no permission is granted"),
                    "{text}"
                );
            }
            let record = task::read(temp.path(), "work").unwrap().unwrap();
            assert_eq!(record.acceptance_epoch, 1);
            assert_eq!(record.state, "accepted");
        }
    }
}

#[test]
fn warning_does_not_relax_disposition_delivery_or_lifecycle_write_guards() {
    let temp = fixture(Some(PROCESS));
    accept(&temp, "gpt-6-astra/xhigh", true);
    propose(&temp, "gpt-6-astra/xhigh");
    refused(
        &temp,
        &[
            "task",
            "disposition",
            "work",
            "contract::entry",
            "--status",
            "confirmed-unchanged",
            "--reason",
            "Existing entry is unchanged",
            "--model",
            "gpt-6-astra",
        ],
        "accepted model",
    );
    for model in ["gpt-6-astra", "gpt-6-astra/xhigh"] {
        refused(
            &temp,
            &[
                "task",
                "delivery",
                "work",
                "deliver",
                "--status",
                "not-applicable",
                "--observation",
                "No delivery obligation was assigned",
                "--reason",
                "Only acceptance guidance changed",
                "--model",
                model,
            ],
            "currently permitted model",
        );
    }
    let output = run(&temp, &["--json", "challenge", "work"]);
    let challenged: Value = serde_json::from_slice(&output.stdout).unwrap();
    let grounded = challenged["grounded"].as_array().unwrap();
    assert!(
        grounded.contains(&Value::from("exception-unresolved")),
        "{challenged}"
    );
    assert!(
        grounded.contains(&Value::from("model-outside-role-policy")),
        "{challenged}"
    );
    refused(&temp, &["task", "ready", "work"], "cannot be handed back");

    let blocked = fixture(Some(&PROCESS.replace(
        "purpose \"Implement\"",
        "purpose \"Implement\" block_below \"70\"",
    )));
    accept(&blocked, "gpt-6-astra", true);
    let decision = run(
        &blocked,
        &[
            "--json",
            "task",
            "decide",
            "work",
            "Does the owner permit this change?",
            "--options",
            "yes,no",
            "--pick",
            "yes",
            "--confidence",
            "10",
            "--model",
            "gpt-6-astra",
        ],
    );
    let decision: Value = serde_json::from_slice(&decision.stdout).unwrap();
    assert_eq!(decision["stands"], false, "{decision}");
    assert_eq!(
        task::read(blocked.path(), "work").unwrap().unwrap().state,
        "blocked"
    );
    refused(
        &blocked,
        &["task", "accept", "work", "--model", "gpt-6-astra/xhigh"],
        "BLOCKED on decision",
    );
}

#[test]
fn owner_approval_preserves_evidence_and_epoch_without_confirming_its_carry_record() {
    let temp = fixture(Some(PROCESS));
    accept(&temp, "gpt-6-astra/xhigh", true);
    success(&temp, &["task", "evidence", "work", "--run"]);
    let before = success(&temp, &["task", "show", "work"])["task"].clone();
    let evidence_log = before["evidence"][0]["log"].as_str().unwrap();
    let log_bytes = std::fs::read(temp.path().join(evidence_log)).unwrap();
    propose(&temp, "gpt-6-astra/xhigh");
    let approved = approve(&temp, "gpt-6-astra/xhigh");
    assert!(approved.get("model_acceptance").is_none());
    let after = &approved["task"];
    assert_eq!(after["accepted"], before["accepted"]);
    assert_eq!(after["acceptance_epoch"], before["acceptance_epoch"]);
    assert_eq!(after["evidence"], before["evidence"]);
    assert_eq!(
        std::fs::read(temp.path().join(evidence_log)).unwrap(),
        log_bytes
    );
    let record = task::read(temp.path(), "work").unwrap().unwrap();
    assert_eq!(record.unconfirmed_during_carry().count(), 1);
    assert_eq!(record.orchestrator_records[0].verb, "approve-model");
    assert_eq!(record.exceptions.len(), 1);
    assert!(record.exceptions[0].approval.is_some() && !record.exceptions[0].superseded);
    refused(
        &temp,
        &["task", "confirm", "work", "--model", "owner"],
        "carried by",
    );
    let challenged = run(&temp, &["--json", "challenge", "work"]);
    let value: Value = serde_json::from_slice(&challenged.stdout).unwrap();
    let grounded = value["grounded"].as_array().unwrap();
    assert!(
        !grounded.contains(&Value::from("model-outside-role-policy")),
        "{value}"
    );
    assert!(
        !grounded.contains(&Value::from("exception-unresolved")),
        "{value}"
    );
    assert!(
        grounded.contains(&Value::from("orchestrator-record-during-carry")),
        "{value}"
    );
}
