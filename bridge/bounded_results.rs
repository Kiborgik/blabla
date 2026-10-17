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

const REASON: &str = "Accept this bounded result while integration remains stale";

fn write(root: &Path, path: &str, text: &str) -> Result<(), String> {
    let path = root.join(path);
    fs::create_dir_all(path.parent().ok_or("missing parent")?).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

fn bytes(root: &Path, path: &str) -> Result<Option<Vec<u8>>, String> {
    match fs::read(root.join(path)) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

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

fn hash(value: &impl serde::Serialize) -> String {
    let mut hash = project::Fnv::new();
    hash.write_str("task-memory-v1");
    hash.write_str(&serde_json::to_string(value).expect("fixture observation serializes"));
    hash.finish()
}

struct Snapshot {
    status: Value,
    task: task::Task,
    ready: bool,
    current: bool,
    clear: bool,
    owner: bool,
    revision: task::RelevantRevision,
    record: Option<Vec<u8>>,
    marker: Option<Vec<u8>>,
    tree: BTreeMap<String, String>,
    stable: bool,
}

struct Fixture {
    root: TempDir,
    model: String,
    reason: String,
    prior_finish: Value,
    prior_record: Vec<u8>,
}

impl Fixture {
    fn prepare(kind: i64, deadline: &Request) -> Result<Self, String> {
        let kind = kind.rem_euclid(9);
        let root = TempDir::new().map_err(|e| e.to_string())?;
        let path = root.path();
        for (file, content) in [
            (
                "project.bla",
                "project Bounded\nuse behavior \"behavior.bla\"\nuse structure \"structure.bla\"\nprocess \"process.bla\"\nverify behavior { command [\"python3\", \"app.py\"] seed 0 cases 1 steps 4 timeout_ms 2000 shrink_budget 8 }\n",
            ),
            (
                "behavior.bla",
                "state count: int\naction increment()\nwhen increment { expect \"adds-one\": after.count == before.count + 1 }\n",
            ),
            (
                "structure.bla",
                "module entry \"entry.rs\"\nrequire \"entry-exists\": symbol entry::run\n",
            ),
            ("entry.rs", "pub fn run() {}\n"),
            (
                "process.bla",
                "role \"orchestrator\" { purpose \"Own integration\" model \"owner\" }\nrole \"worker\" { purpose \"Do bounded work\" model \"worker\" }\n",
            ),
            ("owned.txt", "before\n"),
            ("reports/other.md", "before report\n"),
            ("helper.py", "STEP = 1\n"),
            (
                "check.py",
                "from pathlib import Path\nassert Path('owned.txt').read_text() == 'after\\n'\n",
            ),
            (
                "app.py",
                "import json, runpy, sys\nfrom pathlib import Path\nstep = runpy.run_path(str(Path(__file__).parent / 'helper.py'))['STEP']\ncount = 0\nfor line in sys.stdin:\n r = json.loads(line)\n if r['op'] == 'reset':\n  count = 0\n  value = {'ok': True}\n elif r['op'] == 'call':\n  count += step\n  value = {'ok': True}\n else:\n  value = {'count': count}\n print(json.dumps({'id': r['id'], 'result': value}), flush=True)\n",
            ),
        ] {
            write(path, file, content)?;
        }
        expected(
            path,
            &[
                "task",
                "open",
                "work",
                "--role",
                "worker",
                "--statement",
                "Update owned text",
                "--scope",
                "owned.txt",
                "--deliverable",
                "owned.txt",
                "--input",
                "owned.txt",
                "check.py",
                "--check-argv",
                "python3",
                "check.py",
            ],
            0,
            deadline,
        )?;
        expected(
            path,
            &[
                "task",
                "open",
                "other",
                "--role",
                "worker",
                "--statement",
                "Concurrent reports and helper",
                "--scope",
                "reports",
                "helper.py",
                "entry.rs",
                "--check-argv",
                "python3",
                "-c",
                "pass",
            ],
            0,
            deadline,
        )?;
        for name in ["other", "work"] {
            expected(
                path,
                &["task", "accept", name, "--model", "worker"],
                0,
                deadline,
            )?;
        }
        write(path, "owned.txt", "after\n")?;
        let mut prior_finish = expected(path, &["finish"], 0, deadline)?;
        if kind == 3 {
            expected(
                path,
                &[
                    "task",
                    "statement",
                    "work",
                    "Sharpened statement",
                    "--model",
                    "owner",
                ],
                0,
                deadline,
            )?;
        }
        expected(path, &["task", "evidence", "work", "--run"], 0, deadline)?;
        let challenge = expected(path, &["challenge", "work"], 0, deadline)?;
        if challenge["assignment_clear"] != true {
            return Err(format!("fixture challenge not clear: {challenge}"));
        }
        expected(path, &["task", "ready", "work"], 0, deadline)?;
        if kind == 4 {
            write(path, "helper.py", "STEP = 2\n")?;
            prior_finish = expected(path, &["finish"], 1, deadline)?;
            write(path, "helper.py", "STEP = 1\n")?;
        }
        if kind == 5 {
            write(path, "entry.rs", "pub fn renamed() {}\n")?;
            prior_finish = expected(path, &["finish"], 1, deadline)?;
            write(path, "entry.rs", "pub fn run() {}\n")?;
        }
        let prior_record =
            bytes(path, ".blabla/status.json")?.ok_or("finish did not write status")?;
        if kind != 1 {
            write(path, "reports/other.md", "after report\n")?;
        }
        if kind == 2 {
            write(path, "owned.txt", "changed after evidence\n")?;
        }
        if kind == 8 {
            let manifest =
                fs::read_to_string(path.join("project.bla")).map_err(|e| e.to_string())?;
            write(path, "project.bla", &manifest.replace("steps 4", "steps 5"))?;
        }
        Ok(Self {
            root,
            model: if kind == 6 { "worker" } else { "owner" }.into(),
            reason: if kind == 7 { "  " } else { REASON }.into(),
            prior_finish,
            prior_record,
        })
    }

    fn snapshot(&self, deadline: &Request) -> Result<Snapshot, String> {
        let root = self.root.path();
        let initial_record = bytes(root, ".blabla/status.json")?;
        let initial_marker = bytes(root, ".blabla/verifying.json")?;
        let (exit, status) = invoke(root, &["status"], deadline)?;
        if ![0, 1, 5].contains(&exit) || status.get("completion").is_none() {
            return Err(format!("status inspection failed: {status}"));
        }
        let view = expected(root, &["task", "show", "work"], 0, deadline)?;
        let task: task::Task =
            serde_json::from_value(view["task"].clone()).map_err(|e| e.to_string())?;
        let (exit, challenge) = invoke(root, &["challenge", "work"], deadline)?;
        if ![0, 1].contains(&exit) {
            return Err(format!("challenge inspection failed: {challenge}"));
        }
        let grounded = challenge["grounded"]
            .as_array()
            .ok_or("challenge lacks grounded classes")?;
        let clear = grounded.iter().all(|v| {
            matches!(
                v.as_str(),
                Some("verification-not-current" | "withdrawal-residue")
            )
        });
        let project = project::read_manifest(&root.join("project.bla"))
            .and_then(project::load)
            .map_err(|e| format!("{e:?}"))?;
        let tree = project::snapshot(root, &project.ignore);
        let current = task::challenge_current(&task, &tree)
            && task::tracked_readiness(&task, root, &project.ignore, &tree).supported
            && view["review_current"] != false;
        let process_text =
            fs::read_to_string(root.join("process.bla")).map_err(|e| e.to_string())?;
        let memory = process::build(
            &memory::syntax::parse("process.bla", &process_text).map_err(|e| format!("{e:?}"))?,
        )
        .map_err(|e| format!("{e:?}"))?;
        let role = memory
            .roles
            .iter()
            .find(|r| r.name == task.role)
            .ok_or("fixture worker role missing")?;
        let identities = BTreeMap::from([
            (format!("role::{}", task.role), hash(role)),
            (
                format!("models::{}", task.role),
                hash(&process::permitted_models(&memory, &task.role)),
            ),
        ]);
        let revision = task::relevant_revision(&task, &tree, identities);
        let record = bytes(root, ".blabla/status.json")?;
        let marker = bytes(root, ".blabla/verifying.json")?;
        let stable = record == initial_record && marker == initial_marker;
        Ok(Snapshot {
            stable,
            ready: task.state == "ready",
            current,
            clear,
            owner: process::permitted_models(&memory, "orchestrator").contains(&self.model),
            revision,
            task,
            status,
            record,
            marker,
            tree,
        })
    }

    fn observe(&self, snapshot: &Snapshot) -> Value {
        let prior_green = self.prior_finish["completion"]["allowed"] == true
            && snapshot.record.as_ref() == Some(&self.prior_record);
        json!({
            "bounded_accepted": false, "ordinary_close_accepted": false,
            "bounded_fixture_initialized": true,
            "result_task_ready": snapshot.ready,
            "bounded_owner_attested": snapshot.owner,
            "bounded_reason_present": !self.reason.trim().is_empty(),
            "bounded_prior_canonical_green": prior_green,
            "bounded_implementation_only_drift": snapshot.status["recorded"]["stale"] == json!(["implementation"]),
            "bounded_live_structure_green": snapshot.status["structure"]["status"] == "green",
            "bounded_other_blockers_clear": snapshot.clear,
            "bounded_task_revision_current": snapshot.current,
            "bounded_verification_eligibility_current": snapshot.stable,
            "bounded_basis_recorded": false,
            "bounded_project_record_unchanged": true,
            "bounded_project_completion_allowed": snapshot.status["completion"]["allowed"],
            "project_verification_current": snapshot.status["completion"]["allowed"] == true,
        })
    }
}

pub struct BoundedResults {
    fixture: Option<Fixture>,
    observation: Value,
}

impl BoundedResults {
    pub fn new() -> Self {
        let keys = [
            "bounded_accepted",
            "ordinary_close_accepted",
            "result_task_ready",
            "bounded_owner_attested",
            "bounded_reason_present",
            "bounded_prior_canonical_green",
            "bounded_implementation_only_drift",
            "bounded_live_structure_green",
            "bounded_other_blockers_clear",
            "bounded_task_revision_current",
            "bounded_verification_eligibility_current",
            "bounded_basis_recorded",
            "bounded_project_completion_allowed",
            "project_verification_current",
            "bounded_fixture_initialized",
        ];
        let mut observation = json!({"bounded_project_record_unchanged": true});
        for key in keys {
            observation[key] = json!(false);
        }
        Self {
            fixture: None,
            observation,
        }
    }

    pub fn observe(&self) -> Value {
        self.observation.clone()
    }

    pub fn call(&mut self, name: &str, args: &Value) -> Option<Result<(), String>> {
        if !matches!(
            name,
            "bounded_result_fixture"
                | "bounded_success_fixture"
                | "ordinary_success_fixture"
                | "accept_bounded_result"
                | "accept_ordinary_result"
        ) {
            return None;
        }
        Some(self.perform(name, args))
    }

    fn perform(&mut self, name: &str, args: &Value) -> Result<(), String> {
        let started = Instant::now();
        let request = Request::new(started + REQUEST_BUDGET);
        let deadline = &request;
        if matches!(
            name,
            "bounded_result_fixture" | "bounded_success_fixture" | "ordinary_success_fixture"
        ) {
            let kind = match name {
                "bounded_success_fixture" => 0,
                "ordinary_success_fixture" => 1,
                _ => args
                    .as_array()
                    .filter(|args| args.len() == 1)
                    .and_then(|args| args.first())
                    .and_then(Value::as_i64)
                    .ok_or("bounded fixture requires integer kind")?,
            };
            let fixture = Fixture::prepare(kind, deadline)?;
            let snapshot = fixture.snapshot(deadline)?;
            self.observation = fixture.observe(&snapshot);
            self.fixture = Some(fixture);
        } else {
            if self.fixture.is_none() {
                self.fixture = Some(Fixture::prepare(1, deadline)?);
            }
            let fixture = self.fixture.as_ref().ok_or("bounded fixture unavailable")?;
            let before = fixture.snapshot(deadline)?;
            let mut observation = fixture.observe(&before);
            let mut args = vec!["task", "close", "work", "--model", &fixture.model];
            let bounded = name == "accept_bounded_result";
            if bounded {
                args.extend(["--bounded", "--reason", &fixture.reason]);
            }
            let (exit, result) = invoke(fixture.root.path(), &args, deadline)?;
            let accepted = match exit {
                0 if result["task"]["state"] == "closed" => true,
                2 if result["category"] == "task" => false,
                _ => {
                    return Err(format!(
                        "close invocation failed rather than decided: exit {exit}: {result}"
                    ));
                }
            };
            let after = fixture.snapshot(deadline)?;
            observation["bounded_accepted"] = json!(bounded && accepted);
            observation["ordinary_close_accepted"] = json!(!bounded && accepted);
            observation["result_task_ready"] = json!(after.ready);
            observation["bounded_project_record_unchanged"] = json!(before.record == after.record);
            observation["bounded_project_completion_allowed"] =
                after.status["completion"]["allowed"].clone();
            observation["project_verification_current"] =
                json!(after.status["completion"]["allowed"] == true);
            observation["bounded_verification_eligibility_current"] = json!(
                before.record == after.record
                    && before.marker == after.marker
                    && [
                        "recorded",
                        "structure",
                        "completion",
                        "run_state",
                        "overall"
                    ]
                    .iter()
                    .all(|key| before.status[key] == after.status[key])
                    && before.tree == after.tree
            );
            observation["bounded_task_revision_current"] =
                json!(before.current && before.revision == after.revision);
            if bounded && accepted {
                let record: Value =
                    serde_json::from_slice(before.record.as_deref().ok_or("missing prior record")?)
                        .map_err(|e| e.to_string())?;
                observation["bounded_basis_recorded"] = json!(
                    after
                        .task
                        .result_basis
                        .as_ref()
                        .is_some_and(|basis| match basis {
                            task::ResultBasis::Bounded {
                                reason,
                                project_state,
                                prior_run_id,
                                implementation_fingerprint,
                                revision,
                            } =>
                                reason == &fixture.reason
                                    && project_state == "stale"
                                    && json!(prior_run_id) == record["run_id"]
                                    && json!(implementation_fingerprint)
                                        == record["implementation_fingerprint"]
                                    && revision == &before.revision,
                        })
                );
            }
            if !accepted
                && serde_json::to_value(&before.task).map_err(|e| e.to_string())?
                    != serde_json::to_value(&after.task).map_err(|e| e.to_string())?
            {
                return Err("refused close changed the task record".into());
            }
            self.observation = observation;
        }
        deadline.finish()?;
        eprintln!("bounded probe {name}: {} ms", started.elapsed().as_millis());
        Ok(())
    }
}
