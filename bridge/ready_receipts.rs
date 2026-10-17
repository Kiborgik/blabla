use super::source_cli::Request;
use blabla::memory::{self, goal, process};
use blabla::project::{self, task};
use blabla::runtime::MAX_TIMEOUT as REQUEST_BUDGET;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::Instant;
use tempfile::TempDir;

fn invoke(root: &Path, arguments: &[&str], deadline: &Request) -> Result<(i32, Value), String> {
    deadline.invoke(root, arguments, true)
}

fn expected(root: &Path, args: &[&str], exit: i32, deadline: &Request) -> Result<Value, String> {
    let (actual, value) = invoke(root, args, deadline)?;
    if actual != exit {
        return Err(format!(
            "fixture command {args:?}: expected {exit}, got {actual}: {value}"
        ));
    }
    Ok(value)
}

fn tree(root: &Path) -> Result<BTreeMap<String, Option<Vec<u8>>>, String> {
    fn walk(
        root: &Path,
        here: &Path,
        result: &mut BTreeMap<String, Option<Vec<u8>>>,
    ) -> Result<(), String> {
        for entry in fs::read_dir(here).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let name = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            if path.is_dir() {
                result.insert(name, None);
                walk(root, &path, result)?;
            } else {
                result.insert(name, Some(fs::read(path).map_err(|e| e.to_string())?));
            }
        }
        Ok(())
    }
    let mut result = BTreeMap::new();
    walk(root, root, &mut result)?;
    Ok(result)
}

const PROCESS: &str = "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\nrole \"reviewer\" { purpose \"Review\" model \"reviewer\" }\n";
const POLICY: &str = "policy \"observed-obligation\" { applies_to [\"worker\", \"reviewer\"] statement \"Account for this observed identity\" }\n";
const REASON: &str = "The actual source check still supports this bounded intent";
const DECISION: &str = "Retain the checked entry";
const OBSERVATION: &str = "The real Python check read the callable entry";

fn write(root: &Path, path: &str, value: &str) -> Result<(), String> {
    let path = root.join(path);
    fs::create_dir_all(path.parent().ok_or("missing parent")?).map_err(|e| e.to_string())?;
    fs::write(path, value).map_err(|e| e.to_string())
}

fn claim_args<'a>(name: &'a str, model: &'a str, reflection: bool, refresh: bool) -> Vec<&'a str> {
    let mut args = if reflection {
        vec![
            "task",
            "reflect",
            name,
            "--outcome",
            "no-useful-successor",
            "--decision",
            DECISION,
            "--observation",
            OBSERVATION,
            "--evidence-ref",
            "src/app.rs",
            "--reason",
            REASON,
            "--model",
            model,
        ]
    } else {
        vec![
            "task",
            "disposition",
            name,
            "goal::deliver",
            "--status",
            "confirmed-unchanged",
            "--reason",
            REASON,
            "--model",
            model,
        ]
    };
    if refresh {
        args.push("--refresh-ready");
    }
    args
}

fn decided(exit: i32, value: &Value) -> Result<bool, String> {
    match exit {
        0 if value["task"].is_object() => Ok(true),
        2 if value["category"] == "task" => Ok(false),
        _ => Err(format!(
            "receipt CLI failed rather than decided: exit {exit}: {value}"
        )),
    }
}

struct Snapshot {
    record: task::Task,
    value: Value,
    identities: Vec<String>,
    eligible: bool,
    view: Value,
    files: BTreeMap<String, Option<Vec<u8>>>,
}

struct Fixture {
    root: TempDir,
    name: String,
    model: String,
    writer: Value,
}

impl Fixture {
    fn ready(root: &Path, name: &str, review: bool, deadline: &Request) -> Result<(), String> {
        let model = if review { "reviewer" } else { "worker" };
        let scope = if review { "report.md" } else { "src" };
        let mut args = vec![
            "task",
            "open",
            name,
            "--role",
            model,
            "--statement",
            "Exercise actual READY receipts",
            "--scope",
            scope,
            "--goal",
            "deliver",
            "--require-intent-disposition",
            "--require-goal-reflection",
        ];
        if review {
            args.extend(["--review-of", "work"]);
        }
        args.extend([
            "--input",
            "src",
            "check.py",
            "--check-argv",
            "python3",
            "check.py",
        ]);
        expected(root, &args, 0, deadline)?;
        expected(
            root,
            &["task", "accept", name, "--model", model],
            0,
            deadline,
        )?;
        expected(root, &["task", "evidence", name, "--run"], 0, deadline)?;
        let view = expected(root, &["task", "show", name], 0, deadline)?;
        for row in view["affected_intent"]
            .as_array()
            .ok_or("missing affected identities")?
        {
            let identity = row["identity"].as_str().ok_or("invalid identity")?;
            expected(
                root,
                &[
                    "task",
                    "disposition",
                    name,
                    identity,
                    "--status",
                    "confirmed-unchanged",
                    "--reason",
                    REASON,
                    "--model",
                    model,
                ],
                0,
                deadline,
            )?;
        }
        expected(root, &claim_args(name, model, true, false), 0, deadline)?;
        let challenge = expected(root, &["challenge", name], 0, deadline)?;
        if challenge["assignment_clear"] != true {
            return Err("fixture did not establish a clear actual challenge".into());
        }
        expected(root, &["task", "ready", name], 0, deadline)?;
        Ok(())
    }

    fn prepare(kind: i64, deadline: &Request) -> Result<Self, String> {
        let kind = kind.rem_euclid(12);
        let root = TempDir::new().map_err(|e| e.to_string())?;
        let path = root.path();
        for (file, content) in [
            (
                "project.bla",
                "project ReceiptProbe\nuse structure \"entry.bla\"\nprocess \"process.bla\"\ngoal \"goals.bla\"\n",
            ),
            (
                "entry.bla",
                "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
            ),
            ("src/app.rs", "pub fn run() {}\n"),
            (
                "check.py",
                "from pathlib import Path\np=Path('.blabla/check-count')\np.write_text(str(int(p.read_text())+1) if p.exists() else '1')\nassert 'pub fn run' in Path('src/app.rs').read_text()\n",
            ),
            ("process.bla", PROCESS),
            (
                "goals.bla",
                "goal \"deliver\" { statement \"Retain the callable entry\" expect [\"contract::entry\"] state \"active\" }\n",
            ),
            ("report.md", "Bounded review fixture\n"),
        ] {
            write(path, file, content)?;
        }
        Self::ready(path, "work", false, deadline)?;
        let review = matches!(kind, 5 | 10);
        if review {
            Self::ready(path, "review", true, deadline)?;
        }
        let name = if review { "review" } else { "work" }.to_owned();
        let mut model = if review { "reviewer" } else { "worker" }.to_owned();
        let writer =
            expected(path, &["task", "show", &name], 0, deadline)?["task"]["build"].clone();
        match kind {
            1 => {
                expected(
                    path,
                    &["task", "accept", &name, "--model", &model],
                    0,
                    deadline,
                )?;
            }
            2 => write(path, "src/app.rs", "pub fn run() { let _ = 1; }\n")?,
            3 => model = "other".into(),
            4 => write(
                path,
                "process.bla",
                &PROCESS.replace("model \"worker\"", "model \"other\""),
            )?,
            5 => {
                expected(
                    path,
                    &["task", "accept", "work", "--model", "worker"],
                    0,
                    deadline,
                )?;
            }
            6 => fs::remove_file(path.join("process.bla")).map_err(|e| e.to_string())?,
            7 | 8 => {
                write(path, "process.bla", &format!("{PROCESS}{POLICY}"))?;
                if kind == 8 {
                    expected(path, &claim_args(&name, &model, true, true), 0, deadline)?;
                    write(path, "process.bla", PROCESS)?;
                }
            }
            9 => fs::remove_file(path.join("src/app.rs")).map_err(|e| e.to_string())?,
            11 => {
                let record_path = format!(".blabla/tasks/{name}.json");
                let mut record: Value = serde_json::from_slice(
                    &fs::read(path.join(&record_path)).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
                record["build"] = json!("0.11.0 prior-writer-metadata-fixture");
                write(path, &record_path, &record.to_string())?;
            }
            _ => {}
        }
        expected(
            path,
            &[
                "task",
                "finding",
                &name,
                "Actual owner review remains unresolved",
            ],
            0,
            deadline,
        )?;
        if kind == 11 {
            let record_path = format!(".blabla/tasks/{name}.json");
            let mut record: Value = serde_json::from_slice(
                &fs::read(path.join(&record_path)).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            record["build"] = json!("0.11.0 prior-writer-metadata-fixture");
            write(path, &record_path, &record.to_string())?;
        }
        Ok(Self {
            root,
            name,
            model,
            writer,
        })
    }

    fn snapshot(&self, deadline: &Request) -> Result<Snapshot, String> {
        let root = self.root.path();
        let project = project::read_manifest(&root.join("project.bla"))
            .and_then(project::load)
            .map_err(|e| format!("{e:?}"))?;
        let record = task::read(root, &self.name)?.ok_or("fixture task absent")?;
        let view = expected(root, &["task", "show", &self.name], 0, deadline)?;
        let identities = view["affected_intent"]
            .as_array()
            .ok_or("missing affected identity observations")?
            .iter()
            .map(|row| {
                row["identity"]
                    .as_str()
                    .map(str::to_owned)
                    .ok_or("invalid affected identity".to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let authority = project.manifest.process.as_ref().is_some_and(|entry| {
            let memory = memory::read(
                &entry.path,
                &entry.display,
                process::build,
                process::validate,
            );
            memory.present().is_some_and(|process| {
                process.roles.iter().any(|role| role.name == record.role) && {
                    let permitted = process::permitted_models(process, &record.role);
                    permitted.is_empty() || permitted.contains(&self.model)
                }
            })
        });
        let declared_goal = project.manifest.goal.as_ref().is_some_and(|entry| {
            let memory = memory::read(&entry.path, &entry.display, goal::build, goal::validate);
            memory.present().is_some_and(|memory| {
                memory
                    .goals
                    .iter()
                    .any(|goal| Some(goal.name.as_str()) == record.goal.as_deref())
            })
        });
        let tree = project::snapshot(root, &project.ignore);
        let ready = task::tracked_readiness(&record, root, &project.ignore, &tree).supported;
        let eligible = record.state == "ready"
            && record
                .accepted
                .as_ref()
                .is_some_and(|accepted| accepted.model == self.model)
            && authority
            && ready
            && view["review_current"] != false
            && record.intent_disposition_required
            && record.goal_reflection_required
            && declared_goal
            && identities
                .iter()
                .any(|identity| identity == "goal::deliver");
        let value = serde_json::to_value(&record).map_err(|e| e.to_string())?;
        Ok(Snapshot {
            record,
            value,
            identities,
            eligible,
            view,
            files: tree_bytes(root)?,
        })
    }

    fn observe(&self, snapshot: &Snapshot) -> Value {
        let mut value = empty(true);
        value["ready_receipt_eligible"] = json!(snapshot.eligible);
        value["ready_receipt_task_state"] = json!(snapshot.record.state);
        value["ready_receipt_pending_identities"] = snapshot.view["affected_intent"].clone();
        value["ready_receipt_unresolved_findings"] = snapshot.view["unresolved"].clone();
        value
    }

    fn refresh(&self, reflection: bool, deadline: &Request) -> Result<Value, String> {
        let before = self.snapshot(deadline)?;
        let (exit, response) = invoke(
            self.root.path(),
            &claim_args(&self.name, &self.model, reflection, true),
            deadline,
        )?;
        let succeeded = decided(exit, &response)?;
        let after = self.snapshot(deadline)?;
        if succeeded && response["task"] != after.value {
            return Err("receipt response disagrees with persisted task".into());
        }
        let mut value = self.observe(&after);
        value["ready_receipt_succeeded"] = json!(succeeded);
        value["ready_receipt_exit"] = json!(exit);
        value["ready_receipt_record_unchanged"] = json!(before.files == after.files);
        value["ready_receipt_epoch_preserved"] =
            json!(before.record.acceptance_epoch == after.record.acceptance_epoch);
        value["ready_receipt_evidence_preserved"] =
            json!(before.value["evidence"] == after.value["evidence"]);
        value["ready_receipt_scope_preserved"] = json!(
            ["scope", "check_inputs", "check_argv", "deliverables"]
                .iter()
                .all(|key| before.value[key] == after.value[key])
        );
        value["ready_receipt_target_preserved"] =
            json!(before.value["review_of"] == after.value["review_of"]);
        value["ready_receipt_writer_provenance_current"] =
            json!(after.value["build"] == self.writer);
        let mut identities = before.record.intent_identities.clone();
        identities.extend(before.identities.iter().cloned());
        value["ready_receipt_observed_identities_retained"] = json!(
            identities
                .iter()
                .all(|identity| after.record.intent_identities.contains(identity))
        );
        value["ready_receipt_challenge_cleared"] = json!(after.record.challenged.is_none());
        let mut expected = before.value.clone();
        expected
            .as_object_mut()
            .ok_or("task is not an object")?
            .remove("challenged");
        expected["build"] = self.writer.clone();
        expected["intent_identities"] =
            serde_json::to_value(&identities).map_err(|e| e.to_string())?;
        let exact_claim = if reflection {
            expected["goal_reflection"] = after.value["goal_reflection"].clone();
            let entry = &after.value["goal_reflection"];
            entry["decision"] == DECISION
                && entry["observation"] == OBSERVATION
                && entry["evidence_refs"] == json!(["src/app.rs"])
                && entry["reason"] == REASON
                && entry["model"] == self.model
                && entry["outcome"] == json!({"kind":"no-useful-successor"})
        } else {
            let entries = after.value["intent_dispositions"]
                .as_array()
                .ok_or("missing disposition records")?;
            let prior = before.value["intent_dispositions"]
                .as_array()
                .ok_or("missing prior dispositions")?;
            let entry = entries.last().ok_or("missing latest disposition")?;
            expected["intent_dispositions"] = after.value["intent_dispositions"].clone();
            entries.len() == prior.len() + 1
                && entries[..prior.len()] == prior[..]
                && entry["identity"] == "goal::deliver"
                && entry["status"] == "confirmed-unchanged"
                && entry["reason"] == REASON
                && entry["model"] == self.model
        };
        let mut expected_files = before.files.clone();
        let record_path = format!(".blabla/tasks/{}.json", self.name);
        expected_files.insert(
            record_path.clone(),
            after
                .files
                .get(&record_path)
                .ok_or("record file missing")?
                .clone(),
        );
        value["ready_receipt_explicit_claim_only"] = json!(
            succeeded && exact_claim && expected == after.value && expected_files == after.files
        );
        value["ready_receipt_close_blockers_preserved"] = json!(
            before.record.state == after.record.state
                && before.value["findings"] == after.value["findings"]
                && before.value["result"] == after.value["result"]
        );
        Ok(value)
    }

    fn close(&self, deadline: &Request) -> Result<Value, String> {
        let before = self.snapshot(deadline)?;
        if before
            .record
            .findings
            .iter()
            .all(|finding| finding.resolution.is_some())
        {
            return Err("closure fixture lost its real unresolved finding".into());
        }
        let (exit, response) = invoke(
            self.root.path(),
            &["task", "close", &self.name, "--model", "owner"],
            deadline,
        )?;
        let accepted = decided(exit, &response)?;
        let after = self.snapshot(deadline)?;
        let mut value = self.observe(&after);
        value["ready_receipt_close_blockers_preserved"] = json!(
            !accepted
                && before.files == after.files
                && before.value["findings"] == after.value["findings"]
                && after.record.state != "closed"
        );
        value["ready_receipt_close_exit"] = json!(exit);
        value["ready_receipt_record_unchanged"] = json!(before.files == after.files);
        Ok(value)
    }
}

fn tree_bytes(root: &Path) -> Result<BTreeMap<String, Option<Vec<u8>>>, String> {
    tree(root)
}

fn empty(initialized: bool) -> Value {
    json!({
        "ready_receipt_fixture_initialized": initialized,
        "ready_receipt_eligible": false, "ready_receipt_succeeded": false,
        "ready_receipt_record_unchanged": true, "ready_receipt_epoch_preserved": false,
        "ready_receipt_evidence_preserved": false, "ready_receipt_scope_preserved": false,
        "ready_receipt_target_preserved": false, "ready_receipt_explicit_claim_only": false,
        "ready_receipt_writer_provenance_current": false, "ready_receipt_observed_identities_retained": false,
        "ready_receipt_challenge_cleared": false, "ready_receipt_close_blockers_preserved": false,
        "ready_receipt_exit": null, "ready_receipt_close_exit": null, "ready_receipt_task_state": null,
        "ready_receipt_pending_identities": [], "ready_receipt_unresolved_findings": null
    })
}

pub struct ReadyReceipts {
    fixture: Option<Fixture>,
    observation: Value,
}

impl ReadyReceipts {
    pub fn new() -> Self {
        Self {
            fixture: None,
            observation: empty(false),
        }
    }
    pub fn observe(&self) -> Value {
        self.observation.clone()
    }
    pub fn call(&mut self, name: &str, args: &Value) -> Option<Result<(), String>> {
        if !matches!(
            name,
            "ready_receipt_fixture"
                | "refresh_ready_disposition"
                | "refresh_ready_reflection"
                | "check_refreshed_closure"
        ) {
            return None;
        }
        Some(self.perform(name, args))
    }
    fn perform(&mut self, name: &str, args: &Value) -> Result<(), String> {
        let start = Instant::now();
        let request = Request::new(start + REQUEST_BUDGET);
        let deadline = &request;
        let args = args
            .as_array()
            .ok_or("receipt arguments must be a positional array")?;
        if name == "ready_receipt_fixture" {
            let kind = args
                .first()
                .and_then(Value::as_i64)
                .filter(|_| args.len() == 1)
                .ok_or("receipt fixture requires exactly one signed integer")?;
            let fixture = Fixture::prepare(kind, deadline)?;
            let snapshot = fixture.snapshot(deadline)?;
            self.observation = fixture.observe(&snapshot);
            self.fixture = Some(fixture);
        } else {
            if !args.is_empty() {
                return Err("receipt action takes no arguments".into());
            }
            if self.fixture.is_none() {
                self.fixture = Some(Fixture::prepare(0, deadline)?);
            }
            let fixture = self.fixture.as_ref().ok_or("receipt fixture unavailable")?;
            self.observation = if name == "check_refreshed_closure" {
                fixture.close(deadline)?
            } else {
                fixture.refresh(name == "refresh_ready_reflection", deadline)?
            };
        }
        deadline.finish()?;
        eprintln!(
            "ready receipt probe {name}: {} ms",
            start.elapsed().as_millis()
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nested_record_keys_preserve_bytes_with_portable_components() {
        let root = TempDir::new().unwrap();
        let record = root.path().join(".blabla").join("tasks").join("work.json");
        fs::create_dir_all(record.parent().unwrap()).unwrap();
        fs::write(&record, [0, 255, 13, 10]).unwrap();
        let files = tree(root.path()).unwrap();
        assert_eq!(files[".blabla/tasks/work.json"], Some(vec![0, 255, 13, 10]));
        assert_eq!(files.len(), 3);
    }
    #[test]
    fn invocation_errors_are_not_task_refusals() {
        assert!(decided(2, &json!({"category":"invocation"})).is_err());
        assert!(decided(4, &json!({"category":"task"})).is_err());
        assert!(decided(0, &json!({"ok":true})).is_err());
        assert!(!decided(2, &json!({"category":"task"})).unwrap());
    }
}
