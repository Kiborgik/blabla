use blabla::memory::{self, process};
use blabla::project::{self, task};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tempfile::{NamedTempFile, TempDir};

const BUDGET: Duration = Duration::from_millis(4500);
const OUTPUT_LIMIT: u64 = 2 * 1024 * 1024;
fn stop(child: &mut std::process::Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn invoke(root: &Path, arguments: &[&str], deadline: Instant) -> Result<(i32, Value), String> {
    let stdout = NamedTempFile::new().map_err(|e| e.to_string())?;
    let stderr = NamedTempFile::new().map_err(|e| e.to_string())?;
    let mut command = Command::new("cargo");
    command
        .args(["run", "--locked", "--quiet", "--manifest-path"])
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"))
        .args(["--bin", "blabla", "--", "--project"])
        .arg(root)
        .arg("--json")
        .args(arguments)
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .stdin(Stdio::null())
        .stdout(stdout.reopen().map_err(|e| e.to_string())?)
        .stderr(stderr.reopen().map_err(|e| e.to_string())?);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    if Instant::now() >= deadline {
        return Err("effort probe request budget exhausted before invocation".into());
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let status = loop {
        let size = stdout
            .as_file()
            .metadata()
            .map_err(|e| e.to_string())?
            .len()
            + stderr
                .as_file()
                .metadata()
                .map_err(|e| e.to_string())?
                .len();
        if size > OUTPUT_LIMIT || Instant::now() >= deadline {
            stop(&mut child);
            return Err(format!(
                "source CLI exceeded request time/output budget: {arguments:?}"
            ));
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let out = fs::read(stdout.path()).map_err(|e| e.to_string())?;
    let err = fs::read(stderr.path()).map_err(|e| e.to_string())?;
    if out.len() as u64 + err.len() as u64 > OUTPUT_LIMIT {
        return Err("source CLI exceeded request output budget".into());
    }
    let value = serde_json::from_slice(&out).map_err(|e| {
        format!(
            "source CLI returned non-JSON: {e}; {}",
            String::from_utf8_lossy(&err)
        )
    })?;
    Ok((
        status.code().ok_or("source CLI terminated by signal")?,
        value,
    ))
}

fn expected(root: &Path, args: &[&str], exit: i32, deadline: Instant) -> Result<Value, String> {
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

const PROCESS: &str = "role \"orchestrator\" { purpose \"Own\" model \"owner\" }\nrole \"worker\" { purpose \"Work\" model \"worker-model\" }\n";

fn setup(deadline: Instant) -> Result<TempDir, String> {
    let root = TempDir::new().map_err(|e| e.to_string())?;
    for (path, contents) in [
        (
            "project.bla",
            "project EffortProbe\nprocess \"process.bla\"\nuse structure \"entry.bla\"\n",
        ),
        ("process.bla", PROCESS),
        (
            "entry.bla",
            "module app \"app.rs\"\nrequire \"entry\": symbol app::run\n",
        ),
        ("app.rs", "pub fn run() {}\n"),
    ] {
        fs::write(root.path().join(path), contents).map_err(|e| e.to_string())?;
    }
    expected(
        root.path(),
        &[
            "task",
            "open",
            "one",
            "--role",
            "worker",
            "--statement",
            "Exercise actual effort boundaries",
            "--scope",
            "artifact.txt",
            "--check-argv",
            "sh",
            "-c",
            "test -f artifact.txt",
        ],
        0,
        deadline,
    )?;
    expected(
        root.path(),
        &["task", "accept", "one", "--model", "worker-model"],
        0,
        deadline,
    )?;
    fs::write(root.path().join("artifact.txt"), "actual artifact").map_err(|e| e.to_string())?;
    let evidence = expected(
        root.path(),
        &["task", "evidence", "one", "--run"],
        0,
        deadline,
    )?;
    if evidence["task"]["evidence"]
        .as_array()
        .and_then(|e| e.last())
        .is_none_or(|e| e["exit"] != 0)
    {
        return Err("fixture check did not actually pass".into());
    }
    expected(root.path(), &["challenge", "one"], 0, deadline)?;
    Ok(root)
}

fn record(root: &Path, name: &str) -> Result<task::Task, String> {
    task::read(root, name)?.ok_or_else(|| format!("missing fixture task {name}"))
}
fn loaded(root: &Path) -> Result<project::Project, String> {
    project::read_manifest(&root.join("project.bla"))
        .and_then(project::load)
        .map_err(|e| format!("{e:?}"))
}
fn semantic(record: &task::Task) -> Value {
    let mut value = serde_json::to_value(record).expect("task serializes");
    value
        .as_object_mut()
        .expect("task object")
        .remove("work_intervals");
    value.as_object_mut().expect("task object").remove("build");
    value
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_secs()
}

struct PhaseFixture {
    root: TempDir,
    requested: String,
    model: String,
    worker: String,
    reason: Option<String>,
}
impl PhaseFixture {
    fn prepare(kind: i64, deadline: Instant) -> Result<Self, String> {
        let kind = kind.rem_euclid(12);
        let root = setup(deadline)?;
        let mut f = Self {
            root,
            requested: "development".into(),
            model: "worker-model".into(),
            worker: "actor".into(),
            reason: None,
        };
        match kind {
            1 => f.model = "outside".into(),
            2 => f.requested = "blocked".into(),
            3 => f.requested = "stop".into(),
            4 => {
                expected(
                    f.root.path(),
                    &[
                        "task",
                        "open",
                        "two",
                        "--role",
                        "worker",
                        "--statement",
                        "Other actual task",
                        "--scope",
                        "other.txt",
                    ],
                    0,
                    deadline,
                )?;
                expected(
                    f.root.path(),
                    &["task", "accept", "two", "--model", "worker-model"],
                    0,
                    deadline,
                )?;
                expected(
                    f.root.path(),
                    &[
                        "task",
                        "phase",
                        "two",
                        "development",
                        "--worker",
                        "actor",
                        "--model",
                        "worker-model",
                    ],
                    0,
                    deadline,
                )?;
            }
            5 => fs::write(
                f.root.path().join("process.bla"),
                PROCESS.replace("worker-model", "replacement-model"),
            )
            .map_err(|e| e.to_string())?,
            6..=9 => {
                expected(
                    f.root.path(),
                    &[
                        "task",
                        "phase",
                        "one",
                        "development",
                        "--worker",
                        "actor",
                        "--model",
                        "worker-model",
                    ],
                    0,
                    deadline,
                )?;
                if kind == 7 {
                    f.requested = "verification".into();
                }
                if kind == 8 {
                    f.requested = "stop".into();
                }
                if kind == 9 {
                    f.requested = "interrupt".into();
                    f.reason = Some("Explicit fixture interruption".into());
                }
            }
            10 => {
                f.requested = "blocked".into();
                f.reason = Some("External fixture dependency".into());
            }
            11 => f.worker.clear(),
            _ => {}
        }
        Ok(f)
    }
    fn facts(&self) -> Result<Value, String> {
        let project = loaded(self.root.path())?;
        let task = record(self.root.path(), "one")?;
        let entry = project
            .manifest
            .process
            .as_ref()
            .ok_or("fixture process unregistered")?;
        let memory = memory::read(
            &entry.path,
            &entry.display,
            process::build,
            process::validate,
        );
        let models = memory
            .present()
            .ok_or("fixture process unavailable")?
            .roles
            .iter()
            .find(|r| r.name == task.role)
            .ok_or("fixture role missing")?
            .model
            .clone();
        let permitted = models.iter().any(|m| m == &self.model);
        let mut pending = Vec::new();
        for name in ["one", "two"] {
            if let Some(t) = task::read(self.root.path(), name)? {
                for i in t.work_intervals {
                    i.validate()?;
                    if i.worker == self.worker && i.ended_unix.is_none() {
                        pending.push((name.to_owned(), i));
                    }
                }
            }
        }
        let same_pending =
            pending.len() == 1 && pending[0].0 == "one" && pending[0].1.model == self.model;
        let needs_pending = ["stop", "interrupt"].contains(&self.requested.as_str());
        let reason_ok = !["blocked", "interrupt"].contains(&self.requested.as_str())
            || self.reason.as_deref().is_some_and(|r| !r.trim().is_empty());
        let eligible = task.state == "accepted"
            && task
                .accepted
                .as_ref()
                .is_some_and(|a| a.model == self.model)
            && permitted
            && !self.worker.trim().is_empty()
            && reason_ok
            && (pending.is_empty() && !needs_pending || same_pending);
        Ok(
            json!({"phase_fixture_initialized":true,"eligible":eligible,"phase_interval_count":task.work_intervals.len(),"phase_request":self.requested,"phase_worker":self.worker,"phase_model":self.model,"phase_task_state":task.state,"phase_model_permitted":permitted,"phase_pending_count":pending.len()}),
        )
    }
    fn switch(&self, deadline: Instant) -> Result<Value, String> {
        let before_tree = tree(self.root.path())?;
        let before = record(self.root.path(), "one")?;
        let project = loaded(self.root.path())?;
        let snapshot = project::snapshot(self.root.path(), &project.ignore);
        let mut args = vec![
            "task",
            "phase",
            "one",
            &self.requested,
            "--worker",
            &self.worker,
            "--model",
            &self.model,
        ];
        if let Some(reason) = &self.reason {
            args.extend(["--reason", reason]);
        }
        let started = now();
        let (exit, response) = invoke(self.root.path(), &args, deadline)?;
        let ended = now();
        let succeeded = match exit {
            0 if response["task"] == "one"
                && response["worker"] == self.worker
                && response["phase"] == self.requested
                && response["changed"].is_boolean() =>
            {
                true
            }
            2 if response["category"] == "task" => false,
            _ => {
                return Err(format!(
                    "phase invocation failed rather than decided: {exit}: {response}"
                ));
            }
        };
        let after = record(self.root.path(), "one")?;
        let after_tree = tree(self.root.path())?;
        let review = task::Task::default();
        let freshness = task::intent_revision(&before, &snapshot, Default::default())
            == task::intent_revision(&after, &snapshot, Default::default())
            && task::goal_reflection_revision(&before, &snapshot, Default::default())
                == task::goal_reflection_revision(&after, &snapshot, Default::default())
            && task::review_revision(&review, &before, &snapshot, Default::default())
                == task::review_revision(&review, &after, &snapshot, Default::default())
            && task::challenge_current(&before, &snapshot)
                == task::challenge_current(&after, &snapshot)
            && task::readiness(&before, &snapshot).supported
                == task::readiness(&after, &snapshot).supported;
        let mut other_before = before_tree.clone();
        let mut other_after = after_tree.clone();
        other_before.remove(".blabla/tasks/one.json");
        other_after.remove(".blabla/tasks/one.json");
        let mut spans: BTreeMap<&str, Vec<(u64, u64)>> = BTreeMap::new();
        for i in &after.work_intervals {
            i.validate()?;
            spans
                .entry(&i.worker)
                .or_default()
                .push((i.started_unix, i.ended_unix.unwrap_or(u64::MAX)));
        }
        let nonoverlap = spans.values_mut().all(|rows| {
            rows.sort();
            rows.windows(2)
                .all(|w| w[0].1 <= w[1].0 || w[1].0 == w[1].1)
        });
        let changed = response["changed"] == true;
        let interval_effect = if succeeded {
            observed_interval_effect(
                &before.work_intervals,
                &after.work_intervals,
                &self.worker,
                &self.model,
                &self.requested,
                self.reason.as_deref(),
                started,
                ended,
                changed,
            )
        } else {
            before.work_intervals == after.work_intervals
        };
        let mut result = self.facts()?;
        result["succeeded"] = json!(succeeded);
        result["phase_exit"] = json!(exit);
        result["records_unchanged"] = json!(before_tree == after_tree);
        result["intervals_nonoverlapping"] = json!(nonoverlap && interval_effect);
        result["freshness_preserved"] = json!(freshness);
        result["authority_preserved"] =
            json!(semantic(&before) == semantic(&after) && other_before == other_after);
        Ok(result)
    }
}

fn observed_interval_effect(
    before: &[task::effort::Interval],
    after: &[task::effort::Interval],
    worker: &str,
    model: &str,
    phase: &str,
    reason: Option<&str>,
    start: u64,
    end: u64,
    changed: bool,
) -> bool {
    let pending: Vec<_> = before
        .iter()
        .enumerate()
        .filter(|(_, i)| i.worker == worker && i.ended_unix.is_none())
        .collect();
    if pending.len() > 1 {
        return false;
    }
    if !changed {
        return before == after
            && pending.first().is_some_and(|(_, i)| {
                i.model == model && i.phase == phase && i.reason.as_deref() == reason
            });
    }
    let stopping = ["stop", "interrupt"].contains(&phase);
    if after.len() != before.len() + usize::from(!stopping) {
        return false;
    }
    let endpoint = if stopping {
        let Some((index, _)) = pending.first() else {
            return false;
        };
        let Some(endpoint) = after[*index].ended_unix else {
            return false;
        };
        endpoint
    } else {
        let Some(last) = after.last() else {
            return false;
        };
        if last.worker != worker
            || last.model != model
            || last.phase != phase
            || last.reason.as_deref() != reason
            || last.ended_unix.is_some()
            || last.completion.is_some()
        {
            return false;
        }
        last.started_unix
    };
    if endpoint < start || endpoint > end {
        return false;
    }
    for (index, old) in before.iter().enumerate() {
        let mut expected = old.clone();
        if pending.first().is_some_and(|(i, _)| *i == index) {
            expected.ended_unix = Some(endpoint);
            expected.completion = Some(
                if phase == "interrupt" {
                    "unknown"
                } else {
                    "attested"
                }
                .into(),
            );
            if phase == "interrupt" {
                expected.reason = reason.map(Into::into);
            }
        }
        if after[index] != expected {
            return false;
        }
    }
    true
}

fn interval(
    worker: &str,
    phase: &str,
    start: u64,
    end: Option<u64>,
    completion: Option<&str>,
) -> task::effort::Interval {
    task::effort::Interval {
        worker: worker.into(),
        model: "worker-model".into(),
        phase: phase.into(),
        started_unix: start,
        ended_unix: end,
        completion: completion.map(Into::into),
        reason: (phase == "blocked" || completion == Some("unknown"))
            .then(|| "Synthetic arithmetic fixture, not observed effort".into()),
    }
}
fn timing(root: &Path, rows: Vec<task::effort::Interval>) -> Result<(), String> {
    let mut task = record(root, "one")?;
    task.work_intervals = rows;
    fs::write(
        root.join(".blabla/tasks/one.json"),
        serde_json::to_vec_pretty(&task).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
fn threshold(development: u64) -> Vec<task::effort::Interval> {
    vec![
        interval("a", "development", 0, Some(development), Some("attested")),
        interval(
            "a",
            "verification",
            development,
            Some(development + 10),
            Some("attested"),
        ),
        interval(
            "a",
            "review",
            development + 10,
            Some(development + 15),
            Some("attested"),
        ),
        interval(
            "a",
            "integration",
            development + 15,
            Some(development + 20),
            Some("attested"),
        ),
    ]
}
struct Arithmetic {
    phases: [u64; 5],
    pending: usize,
    unknown: usize,
    count: usize,
    legacy: usize,
    valid: bool,
}
struct BudgetFixture {
    root: TempDir,
    other: Option<TempDir>,
    expected: Arithmetic,
    window: bool,
}
impl BudgetFixture {
    fn prepare(kind: i64, deadline: Instant) -> Result<Self, String> {
        let kind = kind.rem_euclid(11);
        let root = setup(deadline)?;
        let mut f = Self {
            root,
            other: None,
            expected: Arithmetic {
                phases: [0; 5],
                pending: 0,
                unknown: 0,
                count: 0,
                legacy: 1,
                valid: true,
            },
            window: false,
        };
        let rows = match kind {
            1 => {
                f.expected = Arithmetic {
                    phases: [80, 10, 5, 5, 900],
                    pending: 1,
                    unknown: 1,
                    count: 7,
                    legacy: 0,
                    valid: true,
                };
                let mut rows = threshold(80);
                rows.extend([
                    interval("a", "blocked", 100, Some(1000), Some("attested")),
                    interval("b", "review", 200, None, None),
                    interval("c", "development", 200, Some(210), Some("unknown")),
                ]);
                rows
            }
            2 => {
                f.expected.phases = [79, 10, 5, 5, 0];
                threshold(79)
            }
            3 => {
                f.expected.phases[4] = 200;
                vec![interval("a", "blocked", 0, Some(200), Some("attested"))]
            }
            4 => {
                f.expected.pending = 1;
                vec![interval("a", "verification", 0, None, None)]
            }
            5 => {
                f.expected.phases = [80, 0, 20, 0, 0];
                vec![
                    interval("a", "development", 0, Some(80), Some("attested")),
                    interval("b", "review", 0, Some(20), Some("attested")),
                ]
            }
            6 => {
                f.expected.valid = false;
                vec![
                    interval("a", "development", 0, Some(80), Some("attested")),
                    interval("a", "review", 0, Some(20), Some("attested")),
                ]
            }
            7 => {
                f.expected.phases[0] = 51;
                (0..51)
                    .map(|i| interval("a", "development", i, Some(i + 1), Some("attested")))
                    .collect()
            }
            8 => {
                f.expected.valid = false;
                let other = setup(deadline)?;
                timing(
                    other.path(),
                    vec![interval("a", "review", 0, Some(20), Some("attested"))],
                )?;
                f.other = Some(other);
                vec![interval("a", "development", 0, Some(80), Some("attested"))]
            }
            9 => {
                f.expected.phases = [70, 10, 0, 0, 0];
                f.window = true;
                threshold(80)
            }
            10 => {
                let mut t = record(f.root.path(), "one")?;
                t.name = "mismatched".into();
                fs::write(
                    f.root.path().join(".blabla/tasks/one.json"),
                    serde_json::to_vec(&t).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
                f.expected.valid = false;
                f.expected.legacy = 0;
                return Ok(f);
            }
            _ => Vec::new(),
        };
        if kind != 1 {
            f.expected.count = rows.len() + usize::from(f.other.is_some());
            f.expected.legacy = usize::from(rows.is_empty());
        }
        timing(f.root.path(), rows)?;
        Ok(f)
    }
    fn facts(&self) -> Result<Value, String> {
        let rows = record(self.root.path(), "one")?.work_intervals;
        let mut exact = threshold(80);
        exact.extend([
            interval("a", "blocked", 100, Some(1000), Some("attested")),
            interval("b", "review", 200, None, None),
            interval("c", "development", 200, Some(210), Some("unknown")),
        ]);
        Ok(
            json!({"budget_fixture_initialized":true,"budget_fixture_qualified":rows==exact && self.other.is_none() && !self.window,"budget_fixture_provenance":"synthetic interval arithmetic; task lifecycle/checks are real","budget_input_intervals":rows.len()}),
        )
    }
    fn inspect(&self, deadline: Instant) -> Result<Value, String> {
        let before = tree(self.root.path())?;
        let before_other = self.other.as_ref().map(|r| tree(r.path())).transpose()?;
        let additional = self
            .other
            .as_ref()
            .map(|r| r.path().to_string_lossy().into_owned());
        let mut args = vec!["task", "budget"];
        if let Some(path) = &additional {
            args.extend(["--include-project", path, "--include-project", path]);
        }
        if self.window {
            args.extend(["--since", "10", "--until", "90"]);
        }
        let budget = expected(self.root.path(), &args, 0, deadline)?;
        let unchanged = before == tree(self.root.path())?
            && before_other == self.other.as_ref().map(|r| tree(r.path())).transpose()?;
        let e = &self.expected;
        let active = e.phases[..4].iter().sum::<u64>();
        let overhead = e.phases[1..4].iter().sum::<u64>();
        let invalid = budget["totals_valid"] == false
            && budget["observed_fraction"].is_null()
            && budget["observed_target"] == "invalid"
            && budget["diagnostics"]
                .as_array()
                .is_some_and(|d| !d.is_empty());
        let exact = if e.valid {
            budget["totals_valid"] == true
                && budget["active_seconds"] == active
                && budget["overhead_seconds"] == overhead
                && task::effort::PHASES
                    .iter()
                    .zip(e.phases)
                    .all(|(p, n)| budget["phase_seconds"][*p] == n)
        } else {
            invalid
        };
        let target = if !e.valid {
            "invalid"
        } else if active == 0 {
            "no-active-time"
        } else if u128::from(overhead) * 5 <= u128::from(active) {
            "within"
        } else {
            "above"
        };
        let ratio = if e.valid && active > 0 {
            budget["observed_fraction"]
                .as_f64()
                .is_some_and(|f| (f - overhead as f64 / active as f64).abs() < 1e-12)
        } else {
            budget["observed_fraction"].is_null()
        };
        let mut out = self.facts()?;
        out["exact_active_totals"] = json!(exact);
        out["blocked_excluded"] = json!(if e.valid {
            exact && budget["blocked_seconds"] == e.phases[4]
        } else {
            invalid
        });
        out["pending_unknown_excluded"] = json!(
            budget["pending_intervals"] == e.pending
                && budget["unknown_intervals"] == e.unknown
                && (exact || invalid)
        );
        out["denominator_positive"] = json!(
            budget["active_seconds"]
                .as_u64()
                .ok_or("missing active total")?
                > 0
        );
        out["ratio_defined"] = json!(!budget["observed_fraction"].is_null());
        out["target_arithmetic_exact"] =
            json!(budget["target_fraction"] == 0.2 && budget["observed_target"] == target && ratio);
        out["incomplete_coverage_visible"] = json!(
            budget["coverage"] == if e.count == 0 { "unknown" } else { "partial" }
                && budget["legacy_tasks"] == e.legacy
                && budget["interval_count"] == e.count
                && budget["intervals"]
                    .as_array()
                    .is_some_and(|r| r.len() == e.count.min(50))
                && budget["omitted_intervals"] == e.count.saturating_sub(50)
        );
        out["view_read_only"] = json!(unchanged);
        out["authority_preserved"] = json!(unchanged);
        let mut visible = budget;
        fn normalize(value: &mut Value, replacements: &[(&str, &str)]) {
            match value {
                Value::String(text) => {
                    for (path, label) in replacements {
                        *text = text.replace(path, label);
                    }
                }
                Value::Array(values) => {
                    for value in values {
                        normalize(value, replacements);
                    }
                }
                Value::Object(values) => {
                    for value in values.values_mut() {
                        normalize(value, replacements);
                    }
                }
                _ => {}
            }
        }
        let main = self.root.path().to_string_lossy();
        let peer = self.other.as_ref().map(|r| r.path().to_string_lossy());
        let mut replacements = vec![(main.as_ref(), "fixture-main")];
        if let Some(peer) = &peer {
            replacements.push((peer.as_ref(), "fixture-peer"));
        }
        normalize(&mut visible, &replacements);
        for key in ["projects", "intervals", "diagnostics"] {
            visible[key]
                .as_array_mut()
                .ok_or("missing budget detail array")?
                .sort_by_key(Value::to_string);
        }
        out["budget"] = visible;
        Ok(out)
    }
}

pub struct DevelopmentEffort {
    phase: Option<PhaseFixture>,
    budget: Option<BudgetFixture>,
    observation: Value,
}
impl DevelopmentEffort {
    pub fn new() -> Self {
        Self {
            phase: None,
            budget: None,
            observation: json!({"phase_fixture_initialized":false,"budget_fixture_initialized":false,"budget_fixture_qualified":false,"eligible":false,"succeeded":false,"records_unchanged":true,"intervals_nonoverlapping":false,"exact_active_totals":false,"blocked_excluded":false,"pending_unknown_excluded":false,"denominator_positive":false,"ratio_defined":false,"target_arithmetic_exact":false,"incomplete_coverage_visible":false,"freshness_preserved":false,"authority_preserved":true,"view_read_only":false,"phase_exit":null,"phase_interval_count":0,"budget":null}),
        }
    }
    pub fn reset(&mut self) {
        *self = Self::new();
    }
    pub fn observe(&self) -> Value {
        self.observation.clone()
    }
    pub fn call(&mut self, name: &str, args: &Value) -> Option<Result<(), String>> {
        if ![
            "phase_fixture",
            "positive_phase_fixture",
            "budget_fixture",
            "threshold_budget_fixture",
            "switch_phase",
            "inspect_budget",
        ]
        .contains(&name)
        {
            return None;
        }
        Some(self.perform(name, args))
    }
    fn merge(&mut self, value: Value) {
        self.observation
            .as_object_mut()
            .expect("observation")
            .extend(value.as_object().expect("facts").clone());
    }
    fn perform(&mut self, name: &str, args: &Value) -> Result<(), String> {
        let started = Instant::now();
        let deadline = started + BUDGET;
        let args = args
            .as_array()
            .ok_or("effort arguments must be positional")?;
        let kind = if ["phase_fixture", "budget_fixture"].contains(&name) {
            args.first()
                .and_then(Value::as_i64)
                .filter(|_| args.len() == 1)
                .ok_or("fixture requires one signed integer")?
        } else {
            if !args.is_empty() {
                return Err("action takes no arguments".into());
            }
            0
        };
        match name {
            "phase_fixture" | "positive_phase_fixture" => {
                let f = PhaseFixture::prepare(kind, deadline)?;
                self.merge(f.facts()?);
                self.phase = Some(f);
                self.merge(json!({"succeeded":false,"records_unchanged":true,"intervals_nonoverlapping":false,"freshness_preserved":false,"authority_preserved":true,"phase_exit":null}));
            }
            "budget_fixture" | "threshold_budget_fixture" => {
                let f = BudgetFixture::prepare(
                    if name == "threshold_budget_fixture" {
                        1
                    } else {
                        kind
                    },
                    deadline,
                )?;
                self.merge(f.facts()?);
                self.budget = Some(f);
                self.merge(json!({"exact_active_totals":false,"blocked_excluded":false,"pending_unknown_excluded":false,"denominator_positive":false,"ratio_defined":false,"target_arithmetic_exact":false,"incomplete_coverage_visible":false,"view_read_only":false,"budget":null}));
            }
            "switch_phase" => {
                if self.phase.is_none() {
                    self.phase = Some(PhaseFixture::prepare(0, deadline)?);
                }
                self.merge(json!({"succeeded":false,"phase_exit":null,"records_unchanged":false,"intervals_nonoverlapping":false,"freshness_preserved":false,"authority_preserved":false}));
                self.merge(
                    self.phase
                        .as_ref()
                        .expect("phase initialized")
                        .switch(deadline)?,
                );
            }
            "inspect_budget" => {
                if self.budget.is_none() {
                    self.budget = Some(BudgetFixture::prepare(0, deadline)?);
                }
                self.merge(json!({"exact_active_totals":false,"blocked_excluded":false,"pending_unknown_excluded":false,"target_arithmetic_exact":false,"incomplete_coverage_visible":false,"view_read_only":false,"authority_preserved":false}));
                self.merge(
                    self.budget
                        .as_ref()
                        .expect("budget initialized")
                        .inspect(deadline)?,
                );
            }
            _ => unreachable!(),
        }
        if Instant::now() > deadline {
            return Err("effort request exceeded deadline".into());
        }
        eprintln!("effort {name}: {} ms", started.elapsed().as_millis());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn budget_read_preserves_real_close_refusal_and_restored_success() {
        let deadline = Instant::now() + BUDGET;
        let fixture = BudgetFixture::prepare(2, deadline).unwrap();
        expected(fixture.root.path(), &["task", "ready", "one"], 0, deadline).unwrap();
        fs::write(
            fixture.root.path().join("artifact.txt"),
            "actual input drift",
        )
        .unwrap();
        let before = tree(fixture.root.path()).unwrap();
        let (exit, _) = invoke(
            fixture.root.path(),
            &["task", "close", "one", "--model", "owner"],
            deadline,
        )
        .unwrap();
        assert_ne!(exit, 0);
        assert_eq!(before, tree(fixture.root.path()).unwrap());
        let view = fixture.inspect(deadline).unwrap();
        assert_eq!(view["budget"]["observed_target"], "above");
        assert_eq!(view["view_read_only"], true);
        let (exit, _) = invoke(
            fixture.root.path(),
            &["task", "close", "one", "--model", "owner"],
            deadline,
        )
        .unwrap();
        assert_ne!(exit, 0);
        assert_eq!(before, tree(fixture.root.path()).unwrap());
        fs::write(fixture.root.path().join("artifact.txt"), "actual artifact").unwrap();
        expected(
            fixture.root.path(),
            &["task", "close", "one", "--model", "owner"],
            0,
            deadline,
        )
        .unwrap();
        assert_eq!(record(fixture.root.path(), "one").unwrap().state, "closed");
    }
}

#[cfg(test)]
mod effect_controls {
    use super::*;
    #[test]
    fn no_op_cannot_fake_creation_and_prior_intervals_cannot_be_rewritten() {
        assert!(!observed_interval_effect(
            &[],
            &[],
            "a",
            "worker-model",
            "development",
            None,
            10,
            10,
            false
        ));
        let old = interval("a", "development", 0, Some(5), Some("attested"));
        let new = interval("a", "review", 10, None, None);
        assert!(observed_interval_effect(
            &[old.clone()],
            &[old.clone(), new.clone()],
            "a",
            "worker-model",
            "review",
            None,
            10,
            10,
            true
        ));
        let mut corrupt = old.clone();
        corrupt.ended_unix = Some(3);
        assert!(!observed_interval_effect(
            &[old],
            &[corrupt, new.clone()],
            "a",
            "worker-model",
            "review",
            None,
            10,
            10,
            true
        ));
        assert!(observed_interval_effect(
            &[new.clone()],
            &[new],
            "a",
            "worker-model",
            "review",
            None,
            10,
            10,
            false
        ));
    }
}
