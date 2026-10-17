use super::source_cli::Request;
use blabla::memory::{self, process};
use blabla::project::{self, task};
use blabla::runtime::MAX_TIMEOUT as REQUEST_BUDGET;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::Instant;
use tempfile::TempDir;

const CONFIGURED: &str = "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"allowed\" consult [\"testing\"] }\n";
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
                .to_string_lossy()
                .into_owned();
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

struct Fixture {
    root: TempDir,
    requested: String,
    sequence: u64,
}

impl Fixture {
    fn prepare(kind: i64) -> Result<Self, String> {
        let kind = kind.rem_euclid(9);
        let root = TempDir::new().map_err(|e| e.to_string())?;
        let registered = kind != 2;
        let manifest = format!(
            "project RoleProbe\nuse structure \"entry.bla\"\nknowledge \"knowledge.bla\"\n{}",
            if registered {
                "process \"process.bla\"\n"
            } else {
                ""
            }
        );
        for (name, contents) in [
            ("project.bla", manifest.as_str()),
            (
                "entry.bla",
                "module app \"app.rs\"\nrequire \"entry\": symbol app::run\n",
            ),
            ("app.rs", "pub fn run() {}\n"),
            (
                "knowledge.bla",
                "knowledge \"testing\" { purpose \"Check evidence\" }\nruling \"observe\" { pack \"testing\" statement \"Read the result\" }\n",
            ),
        ] {
            fs::write(root.path().join(name), contents).map_err(|e| e.to_string())?;
        }
        let path = root.path().join("process.bla");
        match kind {
            0 | 1 => fs::write(path, CONFIGURED).map_err(|e| e.to_string())?,
            2 => fs::write(path, CONFIGURED).map_err(|e| e.to_string())?,
            3 => fs::write(path, "").map_err(|e| e.to_string())?,
            4 => {},
            5 => fs::write(path, "role \"worker\" {").map_err(|e| e.to_string())?,
            6 => fs::write(path, "role \"worker\" { purpose \"First\" }\nrole \"worker\" { purpose \"Duplicate\" }\n").map_err(|e| e.to_string())?,
            7 => fs::write(path, [0xff, 0xfe]).map_err(|e| e.to_string())?,
            8 => fs::create_dir(path).map_err(|e| e.to_string())?,
            _ => unreachable!(),
        }
        Ok(Self {
            root,
            requested: if kind == 0 {
                "unknown-worker"
            } else if kind == 2 || kind == 3 {
                "bootstrap-role"
            } else {
                "worker"
            }
            .into(),
            sequence: 0,
        })
    }

    fn configuration(&self) -> Result<Value, String> {
        let manifest = project::read_manifest(&self.root.path().join("project.bla"))
            .map_err(|e| format!("{e:?}"))?;
        let memory = match manifest.process {
            Some(entry) => memory::read(
                &entry.path,
                &entry.display,
                process::build,
                process::validate,
            ),
            None => memory::Memory::Unregistered,
        };
        let process = memory.present();
        let configured = process.is_some_and(|process| !process.roles.is_empty());
        let unregistered = matches!(memory, memory::Memory::Unregistered);
        Ok(json!({
            "role_fixture_initialized": true,
            "role_project_configured": configured,
            "role_configuration_valid": unregistered || process.is_some(),
            "requested_role_registered": process.is_some_and(|process| process.roles.iter().any(|role| role.name == self.requested)),
            "role_free_bootstrap": unregistered || process.is_some_and(|process| process.roles.is_empty()),
            "role_configuration_state": memory.state(),
            "requested_role": self.requested,
            "task_open_succeeded": false,
            "task_record_unchanged": true,
            "declared_policy_retained": false,
            "task_open_exit": null,
        }))
    }

    fn policy(&self, name: &str, deadline: &Request) -> Result<bool, String> {
        expected(
            self.root.path(),
            &["task", "accept", name, "--model", "outside"],
            0,
            deadline,
        )?;
        let before = expected(self.root.path(), &["challenge", name], 1, deadline)?;
        expected(
            self.root.path(),
            &["task", "accept", name, "--model", "allowed"],
            0,
            deadline,
        )?;
        expected(
            self.root.path(),
            &[
                "task",
                "lens",
                name,
                "testing",
                "Read actual focused policy observations",
            ],
            0,
            deadline,
        )?;
        let after = expected(self.root.path(), &["challenge", name], 1, deadline)?;
        let before = before["grounded"]
            .as_array()
            .ok_or("missing before challenge facts")?;
        let after = after["grounded"]
            .as_array()
            .ok_or("missing after challenge facts")?;
        Ok(["model-outside-role-policy", "lens-unassessed"]
            .iter()
            .all(|class| before.contains(&json!(class)) && !after.contains(&json!(class))))
    }

    fn open(&mut self, deadline: &Request) -> Result<Value, String> {
        let mut observation = self.configuration()?;
        let before = tree(self.root.path())?;
        let number = self.sequence;
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or("role fixture task sequence exhausted")?;
        let name = format!("role-probe-{number}");
        let scope = format!("work-{number}.txt");
        let (exit, result) = invoke(
            self.root.path(),
            &[
                "task",
                "open",
                &name,
                "--role",
                &self.requested,
                "--statement",
                "Exercise actual role admission",
                "--scope",
                &scope,
            ],
            deadline,
        )?;
        let accepted = match exit {
            0 if result["task"]["state"] == "open" && result["task"]["role"] == self.requested => {
                true
            }
            2 if result["category"] == "task" => false,
            _ => {
                return Err(format!(
                    "role opening failed rather than decided: exit {exit}: {result}"
                ));
            }
        };
        let record = task::read(self.root.path(), &name).map_err(|e| e.to_string())?;
        if accepted
            != record
                .as_ref()
                .is_some_and(|record| record.state == "open" && record.role == self.requested)
        {
            return Err("role opening response and actual task record disagree".into());
        }
        observation["task_open_succeeded"] = json!(accepted);
        observation["task_open_exit"] = json!(exit);
        if accepted && observation["requested_role_registered"] == true {
            observation["declared_policy_retained"] = json!(self.policy(&name, deadline)?);
        }
        observation["task_record_unchanged"] = json!(before == tree(self.root.path())?);
        let after = self.configuration()?;
        for key in [
            "role_fixture_initialized",
            "role_project_configured",
            "role_configuration_valid",
            "requested_role_registered",
            "role_free_bootstrap",
            "role_configuration_state",
            "requested_role",
        ] {
            if observation[key] != after[key] {
                return Err("role fixture configuration changed during opening".into());
            }
        }
        Ok(observation)
    }
}

pub struct TaskRoles {
    fixture: Option<Fixture>,
    observation: Value,
}

impl TaskRoles {
    pub fn new() -> Self {
        Self {
            fixture: None,
            observation: json!({
                "role_fixture_initialized": false,
                "role_project_configured": false,
                "role_configuration_valid": false,
                "requested_role_registered": false,
                "role_free_bootstrap": false,
                "role_configuration_state": "uninitialized",
                "requested_role": null,
                "task_open_succeeded": false,
                "task_record_unchanged": true,
                "declared_policy_retained": false,
                "task_open_exit": null,
            }),
        }
    }

    pub fn observe(&self) -> Value {
        self.observation.clone()
    }

    pub fn call(&mut self, name: &str, args: &Value) -> Option<Result<(), String>> {
        if !matches!(
            name,
            "configured_role_fixture"
                | "open_requested_role"
                | "open_registered_role"
                | "open_bootstrap_role"
        ) {
            return None;
        }
        Some(self.perform(name, args))
    }

    fn perform(&mut self, name: &str, args: &Value) -> Result<(), String> {
        let started = Instant::now();
        let request = Request::new(started + REQUEST_BUDGET);
        let deadline = &request;
        let args = args
            .as_array()
            .ok_or("role probe arguments must be a positional array")?;
        if name == "configured_role_fixture" {
            let kind = args
                .first()
                .and_then(Value::as_i64)
                .filter(|_| args.len() == 1)
                .ok_or("role fixture requires exactly one signed integer")?;
            let fixture = Fixture::prepare(kind)?;
            self.observation = fixture.configuration()?;
            self.fixture = Some(fixture);
        } else {
            if !args.is_empty() {
                return Err("role open action takes no arguments".into());
            }
            let replacement = match name {
                "open_registered_role" => Some(1),
                "open_bootstrap_role" => Some(2),
                _ if self.fixture.is_none() => Some(0),
                _ => None,
            };
            if let Some(kind) = replacement {
                self.fixture = Some(Fixture::prepare(kind)?);
            }
            self.observation = self
                .fixture
                .as_ref()
                .ok_or("role fixture unavailable")?
                .configuration()?;
            self.observation = self
                .fixture
                .as_mut()
                .ok_or("role fixture unavailable")?
                .open(deadline)?;
        }
        deadline.finish()?;
        eprintln!("role probe {name}: {} ms", started.elapsed().as_millis());
        Ok(())
    }
}
