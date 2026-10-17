use blabla::memory::{self, goal, process, system};
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
    invoke_format(root, arguments, deadline, true)
}

fn invoke_format(
    root: &Path,
    arguments: &[&str],
    deadline: Instant,
    json_output: bool,
) -> Result<(i32, Value), String> {
    let stdout = NamedTempFile::new().map_err(|e| e.to_string())?;
    let stderr = NamedTempFile::new().map_err(|e| e.to_string())?;
    let mut command = Command::new("cargo");
    command
        .args(["run", "--locked", "--quiet", "--manifest-path"])
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"))
        .args(["--bin", "blabla", "--", "--project"])
        .arg(root)
        .args(if json_output { vec!["--json"] } else { vec![] })
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
        return Err("delivery probe request budget exhausted before invocation".into());
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
    let value = if json_output {
        serde_json::from_slice(&out).map_err(|e| {
            format!(
                "source CLI returned non-JSON: {e}; {}",
                String::from_utf8_lossy(&err)
            )
        })?
    } else {
        Value::String(String::from_utf8(out).map_err(|e| e.to_string())?)
    };
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

const REFERENCE: &str = r#"{"kind":"artifact","locator":"observed.txt","context":"Explicit isolated component evidence; no real player or viewport delivery is asserted"}"#;
const TERMINAL: &str = r#"{"kind":"artifact","locator":"artifacts/terminal.txt","context":"Actual terminal file inspected in this explicit synthetic component fixture; no real application outcome is claimed"}"#;
const VERIFY: &str =
    r#"{"kind":"verification","locator":"check.py","context":"Source correctness only"}"#;

fn write(root: &Path, name: &str, value: &str) -> Result<(), String> {
    let path = root.join(name);
    fs::create_dir_all(path.parent().ok_or("no parent")?).map_err(|e| e.to_string())?;
    fs::write(path, value).map_err(|e| e.to_string())
}

fn decision(exit: i32, value: &Value) -> Result<bool, String> {
    match exit {
        0 if value["task"].is_object() => Ok(true),
        2 if value["category"] == "task" => Ok(false),
        _ => Err(format!(
            "CLI invocation failed rather than decided: {exit}: {value}"
        )),
    }
}

fn source_args(name: &str, scope: &str) -> Vec<String> {
    [
        "task",
        "open",
        name,
        "--role",
        "worker",
        "--statement",
        "Inspect the actual isolated fixture outcome",
        "--scope",
        scope,
        "--goal",
        "outcome",
        "--input",
        "src",
        "check.py",
        "observed.txt",
        "--check-argv",
        "python3",
        "check.py",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

fn owned(root: &Path, args: &[String], deadline: Instant) -> Result<Value, String> {
    expected(
        root,
        &args.iter().map(String::as_str).collect::<Vec<_>>(),
        0,
        deadline,
    )
}

fn checked(root: &Path, name: &str, deadline: Instant) -> Result<(), String> {
    expected(root, &["task", "evidence", name, "--run"], 0, deadline)?;
    let value = expected(root, &["task", "show", name], 0, deadline)?;
    if value["task"]["evidence"]
        .as_array()
        .and_then(|r| r.last())
        .is_none_or(|e| e["exit"] != 0)
    {
        return Err("fixture check child failed".into());
    }
    Ok(())
}

fn handback(root: &Path, name: &str, deadline: Instant) -> Result<(), String> {
    let value = expected(root, &["challenge", name], 0, deadline)?;
    if value["assignment_clear"] != true {
        return Err(format!("fixture challenge not clear: {value}"));
    }
    expected(root, &["task", "ready", name], 0, deadline)?;
    Ok(())
}

fn close_args(name: &str, bounded: bool, model: &str) -> Vec<String> {
    let mut args: Vec<_> = ["task", "close", name, "--model", model]
        .into_iter()
        .map(str::to_owned)
        .collect();
    if bounded {
        args.extend(["--bounded","--reason","The checked isolated source is accepted while unrelated fixture drift awaits integration"].map(str::to_owned));
    }
    args
}

fn claim_args(status: &str, verification_only: bool) -> Vec<String> {
    let mut args:Vec<_>=["task","delivery","work","outcome","--status",status,"--observation","The explicit synthetic fixture artifact was inspected; real application outcomes are outside this probe","--observation-ref",if verification_only {VERIFY}else{REFERENCE},"--model","worker"].into_iter().map(str::to_owned).collect();
    if status == "partial" {
        args.extend(
            [
                "--delivered",
                "The real fixture check and initial artifact exist",
                "--remaining",
                "The separate terminal fixture observation is still pending",
                "--owner",
                "fixture-owner",
                "--next",
                "Independently inspect the terminal artifact before exact-origin resolution",
            ]
            .map(str::to_owned),
        );
    }
    if status == "blocked" {
        args.extend(
            [
                "--blocker",
                "Terminal observation is unavailable",
                "--owner",
                "fixture-owner",
                "--unblock-when",
                "Inspect the explicit terminal fixture artifact",
            ]
            .map(str::to_owned),
        );
    }
    args
}

fn review_args(name: &str, model: &str, origin: Option<&str>) -> Vec<String> {
    let mut args: Vec<_> = [
        "task",
        "delivery-review",
        name,
        "outcome",
        "--verdict",
        "accept",
        "--reason",
        "Inspected the explicit fixture artifact and the claim limits independently",
        "--observation-ref",
        if origin.is_some() {
            TERMINAL
        } else {
            REFERENCE
        },
        "--model",
        model,
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    if let Some(origin) = origin {
        args.extend(["--resolve-origin", origin, "--resolution", "delivered"].map(str::to_owned));
    }
    args
}

fn open_review(root: &Path, name: &str, target: &str, deadline: Instant) -> Result<(), String> {
    let path = format!("reviews/{name}.md");
    expected(
        root,
        &[
            "task",
            "open",
            name,
            "--role",
            "reviewer",
            "--statement",
            "Inspect the exact fixture outcome independently",
            "--scope",
            &path,
            "--review-of",
            target,
            "--input",
            "src",
            "check.py",
            "observed.txt",
            "--check-argv",
            "python3",
            "check.py",
        ],
        0,
        deadline,
    )?;
    expected(
        root,
        &["task", "accept", name, "--model", "reviewer"],
        0,
        deadline,
    )?;
    checked(root, name, deadline)
}

fn project_status(root: &Path, deadline: Instant) -> Result<Value, String> {
    let (exit, value) = invoke(root, &["status"], deadline)?;
    if ![0, 1, 5].contains(&exit) || !value["completion"].is_object() {
        return Err(format!("status unavailable: {exit}: {value}"));
    }
    Ok(value)
}

struct Fixture {
    root: TempDir,
    claim_status: String,
    verification_only: bool,
    review_model: String,
    close_model: String,
    origin: Option<String>,
    prior_green: Value,
    canonical_record: Vec<u8>,
}

impl Fixture {
    fn prepare(kind: i64, deadline: Instant) -> Result<Self, String> {
        let kind = kind.rem_euclid(15);
        let root = TempDir::new().map_err(|e| e.to_string())?;
        let p = root.path();
        for (name, value) in [
            (
                "project.bla",
                "project DeliveryProbe\nuse structure \"entry.bla\"\nuse behavior \"counter.bla\"\nprocess \"process.bla\"\nsystem \"system.bla\"\ngoal \"goals.bla\"\nverify behavior { command [\"python3\", \"counter.py\"] seed 0 cases 1 steps 2 timeout_ms 2000 shrink_budget 4 }\n",
            ),
            (
                "entry.bla",
                "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
            ),
            (
                "counter.bla",
                "state count: int\naction increment()\nwhen increment { expect \"one\": after.count == before.count + 1 }\n",
            ),
            (
                "counter.py",
                "import json,sys\nn=0\nfor line in sys.stdin:\n r=json.loads(line)\n if r['op']=='reset':\n  n=0\n  v={'ok':True}\n elif r['op']=='call':\n  n+=1\n  v={'ok':True}\n else:\n  v={'count':n}\n print(json.dumps({'id':r['id'],'result':v}),flush=True)\n",
            ),
            ("src/app.rs", "pub fn run() {}\n"),
            (
                "check.py",
                "from pathlib import Path\nassert 'pub fn run' in Path('src/app.rs').read_text()\nassert Path('observed.txt').is_file()\n",
            ),
            (
                "observed.txt",
                "Explicit synthetic component artifact. Initial observation exists; terminal real-world delivery is outside this fixture.\n",
            ),
            (
                "process.bla",
                "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" }\nrole \"reviewer\" { purpose \"Inspect independently\" model \"reviewer\" }\n",
            ),
            (
                "system.bla",
                "system \"app\" { purpose \"Fixture component\" paths [\"src\"] }\n",
            ),
            (
                "goals.bla",
                "goal \"outcome\" { statement \"Independently inspect the explicit component artifact\" expect [\"contract::entry\"] state \"active\" delivery \"required\" applies-to [\"system::app\"] }\n",
            ),
        ] {
            write(p, name, value)?;
        }
        owned(p, &source_args("work", "src"), deadline)?;
        let prior_green = expected(p, &["finish"], 0, deadline)?;
        if prior_green["completion"]["allowed"] != true {
            return Err("real fixture finish was not GREEN".into());
        }
        let canonical_record =
            fs::read(p.join(".blabla/status.json")).map_err(|e| e.to_string())?;
        if kind != 0 && kind != 2 {
            expected(
                p,
                &["task", "accept", "work", "--model", "worker"],
                0,
                deadline,
            )?;
            checked(p, "work", deadline)?;
        }
        let claim_status = if kind == 3 {
            "delivered"
        } else if kind == 14 {
            "blocked"
        } else {
            "partial"
        }
        .to_owned();
        if [4, 5, 6, 7, 8, 9, 10, 12, 13, 14].contains(&kind) {
            owned(p, &claim_args(&claim_status, false), deadline)?;
            if kind == 4 {
                expected(p, &["challenge", "work"], 0, deadline)?;
            } else {
                handback(p, "work", deadline)?;
            }
        }
        if [5, 6, 7, 8, 9, 10, 12, 13, 14].contains(&kind) {
            open_review(p, "review", "work", deadline)?;
        }
        if [6, 7, 8, 9, 10, 13, 14].contains(&kind) {
            owned(p, &review_args("review", "reviewer", None), deadline)?;
            handback(p, "review", deadline)?;
            owned(p, &close_args("review", false, "owner"), deadline)?;
        }
        if [8, 9, 10].contains(&kind) {
            owned(p, &close_args("work", false, "owner"), deadline)?;
            owned(p, &source_args("other", "artifacts"), deadline)?;
            expected(
                p,
                &["task", "accept", "other", "--model", "worker"],
                0,
                deadline,
            )?;
            write(
                p,
                "artifacts/terminal.txt",
                "The terminal isolated component artifact now exists and has been read. This is synthetic lifecycle evidence, not application delivery.\n",
            )?;
            if fs::read(p.join("artifacts/terminal.txt"))
                .map_err(|e| e.to_string())?
                .is_empty()
            {
                return Err("terminal artifact was not observed".into());
            }
            expected(p, &["finish"], 0, deadline)?;
            open_review(p, "resolution", "work", deadline)?;
        }
        let mut origin = None;
        if [8, 9, 10].contains(&kind) {
            let view = expected(p, &["task", "show", "work"], 0, deadline)?;
            let digest = view["delivery"]["obligations"][0]["claim_digest"]
                .as_str()
                .ok_or("claim digest absent")?;
            origin=Some(json!({"task":"work","goal":"goal::outcome","claim_digest":if kind==9 {"incorrect-digest"}else{digest}}).to_string());
        }
        if kind == 2 {
            let goals = fs::read_to_string(p.join("goals.bla")).map_err(|e| e.to_string())?;
            write(
                p,
                "goals.bla",
                &goals.replace("system::app", "system::absent"),
            )?;
        }
        if kind == 7 {
            expected(
                p,
                &[
                    "task",
                    "open",
                    "drift",
                    "--role",
                    "worker",
                    "--statement",
                    "Unrelated fixture change",
                    "--scope",
                    "other.md",
                    "--check-argv",
                    "python3",
                    "-c",
                    "pass",
                ],
                0,
                deadline,
            )?;
            expected(
                p,
                &["task", "accept", "drift", "--model", "worker"],
                0,
                deadline,
            )?;
            write(p, "other.md", "Real unrelated implementation drift\n")?;
        }
        if kind == 11 {
            write(p, "src/app.rs", "pub fn run() { let _ = 1; }\n")?;
        }
        if kind == 12 {
            expected(
                p,
                &["task", "accept", "work", "--model", "worker"],
                0,
                deadline,
            )?;
        }
        Ok(Self {
            root,
            claim_status,
            verification_only: kind == 3,
            review_model: if kind == 10 { "worker" } else { "reviewer" }.into(),
            close_model: if kind == 13 { "worker" } else { "owner" }.into(),
            origin,
            prior_green,
            canonical_record,
        })
    }

    fn view(&self, deadline: Instant) -> Result<Value, String> {
        let root = self.root.path();
        let project = project::read_manifest(&root.join("project.bla"))
            .and_then(project::load)
            .map_err(|e| format!("{e:?}"))?;
        let paths = project::snapshot(root, &project.ignore);
        let view = expected(root, &["task", "show", "work"], 0, deadline)?;
        let record: task::Task =
            serde_json::from_value(view["task"].clone()).map_err(|e| e.to_string())?;
        let status = project_status(root, deadline)?;
        let process = memory::read(
            &root.join("process.bla"),
            "process.bla",
            process::build,
            process::validate,
        );
        let process = process.present().ok_or("fixture process unreadable")?;
        let goals = memory::read(
            &root.join("goals.bla"),
            "goals.bla",
            goal::build,
            goal::validate,
        );
        let systems = memory::read(
            &root.join("system.bla"),
            "system.bla",
            system::build,
            system::validate,
        );
        let valid_goal = goals
            .present()
            .and_then(|m| m.goals.iter().find(|g| g.name == "outcome"))
            .is_some_and(|g| {
                g.delivery.is_some()
                    && g.state != "dropped"
                    && systems.present().is_some_and(|s| {
                        g.applies_to.iter().all(|id| {
                            s.systems
                                .iter()
                                .any(|v| *id == format!("system::{}", v.name))
                        })
                    })
            });
        let worker = process::permitted_models(process, "worker").contains(&"worker".into());
        let owner = process::permitted_models(process, "orchestrator").contains(&self.close_model);
        let checked = task::tracked_readiness(&record, root, &project.ignore, &paths).supported;
        let accepted = record.state == "accepted"
            && record
                .accepted
                .as_ref()
                .is_some_and(|a| a.model == "worker")
            && worker;
        let claim_current = view["delivery"]["claims_current"] == true;
        let reviewed = view["delivery"]["reviews_pending"]
            .as_array()
            .is_some_and(|a| a.is_empty());
        let clear = record.unresolved().next().is_none()
            && record.unpicked().next().is_none()
            && record.unconfirmed_during_carry().next().is_none()
            && record.exceptions.is_empty();
        let challenge = task::challenge_current(&record, &paths);
        let current_green = status["completion"]["allowed"] == true;
        let prior_green = self.prior_green["completion"]["allowed"] == true
            && fs::read(root.join(".blabla/status.json")).map_err(|e| e.to_string())?
                == self.canonical_record;
        let stale_only = status["recorded"]["stale"] == json!(["implementation"]);
        let live_structure = status["structure"]["status"] == "green";
        let common = record.state == "ready"
            && checked
            && clear
            && challenge
            && claim_current
            && reviewed
            && owner;
        let partial = record
            .delivery_obligations
            .values()
            .filter_map(|o| o.claim.as_ref())
            .any(|c| {
                matches!(
                    c.status,
                    task::delivery::Status::Partial | task::delivery::Status::Blocked
                )
            });
        let residuals = status["delivery"]["residuals"]
            .as_array()
            .ok_or("delivery residual view missing")?;
        let residual = residuals
            .iter()
            .any(|r| r["origin_task"] == "work" && r["goal"] == "goal::outcome");
        let qualify_review = |name: &str| -> Result<bool, String> {
            let Some(r) = task::read(root, name)? else {
                return Ok(false);
            };
            let rv = expected(root, &["task", "show", name], 0, deadline)?;
            Ok(r.state == "accepted"
                && r.role == "reviewer"
                && r.accepted
                    .as_ref()
                    .is_some_and(|a| a.model == self.review_model)
                && process::permitted_models(process, "reviewer").contains(&self.review_model)
                && r.review_of.as_ref().is_some_and(|t| t.task == "work")
                && rv["review_current"] == true
                && task::tracked_readiness(&r, root, &project.ignore, &paths).supported)
        };
        let digest = view["delivery"]["obligations"]
            .as_array()
            .and_then(|a| a.first())
            .map(|r| r["claim_digest"].clone())
            .unwrap_or(Value::Null);
        let origin = self
            .origin
            .as_ref()
            .map(|s| serde_json::from_str::<Value>(s))
            .transpose()
            .map_err(|e| e.to_string())?;
        let resolved = task::read(root, "resolution")?.is_some_and(|r| {
            r.state == "closed"
                && r.result.is_some()
                && task::challenge_current(&r, &paths)
                && task::tracked_readiness(&r, root, &project.ignore, &paths).supported
                && r.delivery_reviews.iter().any(|v| {
                    v.resolve_origin.as_ref().is_some_and(|o| {
                        o.task == "work"
                            && o.goal == "goal::outcome"
                            && json!(o.claim_digest) == digest
                    }) && v.verdict == task::delivery::Verdict::Accept
                        && v.resolution == Some(task::delivery::Status::Delivered)
                })
        });
        let goal_view = expected(root, &["explain", "goal::outcome"], 0, deadline)?;
        let (text_exit, text) = invoke_format(root, &["status"], deadline, false)?;
        if ![0, 1, 5].contains(&text_exit) {
            return Err("text status inspection failed".into());
        }
        let text = text.as_str().ok_or("text output absent")?;
        let total = status["delivery"]["total"].as_u64().ok_or("total absent")?;
        let omitted = status["delivery"]["omitted"]
            .as_u64()
            .ok_or("omitted absent")?;
        let views_agree = status["delivery"]["residuals"] == goal_view["delivery"]["residuals"]
            && total == residuals.len() as u64 + omitted
            && text.contains(&format!("Delivery: {total} residuals, {omitted} omitted"))
            && residuals.iter().all(|r| {
                text.contains(&format!(
                    "goal::outcome from {}:",
                    r["origin_task"].as_str().unwrap_or("")
                ))
            });
        let exact = origin.as_ref().is_some_and(|o| {
            o["task"] == "work" && o["goal"] == "goal::outcome" && o["claim_digest"] == digest
        });
        Ok(json!({
            "delivery_fixture_initialized":true,
            "delivery_accept_eligible":valid_goal && !matches!(record.state.as_str(),"closed"|"withdrawn"),
            "delivery_claim_eligible":accepted && checked && valid_goal && record.delivery_obligations.contains_key("goal::outcome") && !(self.claim_status=="delivered" && self.verification_only),
            "delivery_review_eligible":qualify_review("review")? && claim_current && valid_goal,
            "delivery_ready_eligible":accepted && checked && clear && claim_current && challenge,
            "delivery_ordinary_close_eligible":common && current_green,
            "delivery_bounded_close_eligible":common && prior_green && stale_only && live_structure && !root.join(".blabla/verifying.json").exists(),
            "delivery_resolution_eligible":qualify_review("resolution")? && exact && partial && record.state=="closed" && valid_goal && current_green && fs::read(root.join("artifacts/terminal.txt")).is_ok_and(|b|!b.is_empty()),
            "delivery_applicable_goals_retained":record.delivery_obligations.contains_key("goal::outcome"),
            "delivery_current_claims_complete":claim_current,
            "delivery_current_reviews_accepted":reviewed,
            "delivery_source_closed":record.state=="closed",
            "delivery_partial_or_blocked":partial,
            "delivery_residual_expected":record.state=="closed" && partial && !resolved,
            "delivery_views_agree":views_agree,
            "delivery_residual_visible":residual,
            "delivery_task_state":record.state,
            "delivery_claim_status":self.claim_status,
            "delivery_claim_reference":if self.verification_only {VERIFY}else{REFERENCE},
            "delivery_review_model":self.review_model,
            "delivery_close_model":self.close_model,
            "delivery_task":view,
            "delivery_project":status
        }))
    }
}

struct BatchFixture {
    base: Fixture,
    selected: String,
    model: String,
}

impl BatchFixture {
    fn prepare(kind: i64, deadline: Instant) -> Result<Self, String> {
        let kind = kind.rem_euclid(8);
        let base = Fixture::prepare(5, deadline)?;
        let root = base.root.path();
        let mut secondary_args = source_args("secondary", "secondary");
        let check = secondary_args
            .iter()
            .position(|s| s == "--check-argv")
            .ok_or("check argv absent")?;
        secondary_args.insert(check, "secondary/source.rs".into());
        owned(root, &secondary_args, deadline)?;
        expected(
            root,
            &["task", "accept", "secondary", "--model", "worker"],
            0,
            deadline,
        )?;
        write(
            root,
            "secondary/observed.txt",
            "A second isolated component artifact inspected independently.\n",
        )?;
        write(root, "secondary/source.rs", "pub fn secondary() {}\n")?;
        checked(root, "secondary", deadline)?;
        let mut claim = claim_args("partial", false);
        claim[2] = "secondary".into();
        let reference = claim
            .iter()
            .position(|s| s == "--observation-ref")
            .ok_or("claim reference absent")?
            + 1;
        claim[reference] = json!({"kind":"artifact","locator":"secondary/observed.txt","context":"Actual second component fixture artifact; no real-world delivery asserted"}).to_string();
        owned(root, &claim, deadline)?;
        handback(root, "secondary", deadline)?;
        expected(
            root,
            &[
                "task",
                "open",
                "batch",
                "--role",
                "reviewer",
                "--statement",
                "Inspect both explicitly assigned fixture outcomes",
                "--scope",
                "reviews/batch.md",
                "--review-of",
                "work",
                "--delivery-review-of",
                "secondary",
                "--input",
                "src",
                "check.py",
                "observed.txt",
                "--check-argv",
                "python3",
                "check.py",
            ],
            0,
            deadline,
        )?;
        expected(
            root,
            &["task", "accept", "batch", "--model", "reviewer"],
            0,
            deadline,
        )?;
        checked(root, "batch", deadline)?;
        let selected = if kind == 1 {
            "work"
        } else if kind == 2 {
            "stranger"
        } else {
            "secondary"
        };
        let other = if selected == "work" {
            "secondary"
        } else {
            "work"
        };
        let mut review = review_args("batch", "reviewer", None);
        review.extend(["--source", other].map(str::to_owned));
        owned(root, &review, deadline)?;
        if kind == 2 {
            owned(root, &source_args("stranger", "stranger"), deadline)?;
        }
        if kind == 3 {
            write(
                root,
                "secondary/source.rs",
                "pub fn secondary() { let _ = 1; }\n",
            )?;
        }
        if kind == 4 {
            write(
                root,
                "secondary/observed.txt",
                "Actual observed artifact changed after claim and review pin\n",
            )?;
        }
        if kind == 6 {
            let mut second = review_args("batch", "reviewer", None);
            second.extend(["--source", selected].map(str::to_owned));
            owned(root, &second, deadline)?;
            handback(root, "batch", deadline)?;
        }
        if kind == 7 {
            expected(
                root,
                &["task", "accept", "secondary", "--model", "worker"],
                0,
                deadline,
            )?;
            checked(root, "secondary", deadline)?;
            owned(root, &claim, deadline)?;
            handback(root, "secondary", deadline)?;
        }
        Ok(Self {
            base,
            selected: selected.into(),
            model: if kind == 5 { "worker" } else { "reviewer" }.into(),
        })
    }

    fn view(&self, deadline: Instant) -> Result<Value, String> {
        let root = self.base.root.path();
        let project = project::read_manifest(&root.join("project.bla"))
            .and_then(project::load)
            .map_err(|e| format!("{e:?}"))?;
        let paths = project::snapshot(root, &project.ignore);
        let view = expected(root, &["task", "show", "batch"], 0, deadline)?;
        let review: task::Task =
            serde_json::from_value(view["task"].clone()).map_err(|e| e.to_string())?;
        let selected = expected(root, &["task", "show", &self.selected], 0, deadline)?;
        let assigned = review
            .review_of
            .iter()
            .chain(&review.delivery_review_targets)
            .any(|target| target.task == self.selected);
        let current = assigned
            && view["review_current"] == true
            && selected["delivery"]["claims_current"] == true;
        let process = memory::read(
            &root.join("process.bla"),
            "process.bla",
            process::build,
            process::validate,
        );
        let process = process.present().ok_or("batch process unreadable")?;
        let eligible = current
            && review.state == "accepted"
            && review.role == "reviewer"
            && review
                .accepted
                .as_ref()
                .is_some_and(|a| a.model == self.model)
            && process::permitted_models(process, "reviewer").contains(&self.model)
            && task::tracked_readiness(&review, root, &project.ignore, &paths).supported;
        let digest = selected["delivery"]["obligations"]
            .as_array()
            .and_then(|rows| rows.iter().find(|r| r["goal"] == "goal::outcome"))
            .map(|r| r["claim_digest"].clone())
            .unwrap_or(Value::Null);
        let recorded = review.delivery_reviews.iter().any(|r| {
            r.source_task.as_deref() == Some(&self.selected)
                && r.goal == "goal::outcome"
                && json!(r.claim_digest) == digest
                && r.verdict == task::delivery::Verdict::Accept
        });
        Ok(json!({
            "delivery_batch_initialized":true,
            "delivery_selected_source_assigned":assigned,
            "delivery_selected_source_current":current,
            "delivery_selected_review_eligible":eligible,
            "delivery_selected_verdict_recorded":recorded,
            "delivery_batch_selected_source":self.selected,
            "delivery_batch_review":view,
            "delivery_batch_selected_task":selected
        }))
    }
}

pub struct GoalDelivery {
    batch: Option<BatchFixture>,
    fixture: Option<Fixture>,
    observation: Value,
}

impl GoalDelivery {
    pub fn new() -> Self {
        let mut observation = json!({"delivery_exit":null,"delivery_result":null});
        for key in [
            "batch_initialized",
            "selected_source_assigned",
            "selected_source_current",
            "selected_review_eligible",
            "selected_verdict_recorded",
            "fixture_initialized",
            "accept_eligible",
            "claim_eligible",
            "review_eligible",
            "ready_eligible",
            "ordinary_close_eligible",
            "bounded_close_eligible",
            "resolution_eligible",
            "operation_succeeded",
            "applicable_goals_retained",
            "current_claims_complete",
            "current_reviews_accepted",
            "source_closed",
            "partial_or_blocked",
            "residual_expected",
            "residual_visible",
            "exact_origin_resolved",
        ] {
            observation[format!("delivery_{key}")] = json!(false);
        }
        for key in [
            "other_source_verdicts_preserved",
            "source_records_unchanged",
            "records_unchanged",
            "other_origins_preserved",
            "history_preserved",
            "contract_authority_preserved",
            "views_agree",
        ] {
            observation[format!("delivery_{key}")] = json!(true);
        }
        Self {
            batch: None,
            fixture: None,
            observation,
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
            "delivery_batch_fixture",
            "review_explicit_delivery_source",
            "delivery_fixture",
            "accept_delivery_assignment",
            "record_delivery_claim",
            "record_delivery_review",
            "ready_delivery_task",
            "close_delivery_task",
            "inspect_delivery_reminders",
            "resolve_delivery_origin",
        ]
        .contains(&name)
        {
            return None;
        }
        Some(
            if matches!(
                name,
                "delivery_batch_fixture" | "review_explicit_delivery_source"
            ) {
                self.execute_batch(name, args)
            } else {
                self.execute(name, args)
            },
        )
    }
    fn execute(&mut self, name: &str, args: &Value) -> Result<(), String> {
        let start = Instant::now();
        let deadline = start + BUDGET;
        let args = args.as_array().ok_or("action arguments must be an array")?;
        if name == "delivery_fixture" {
            if args.len() != 1 {
                return Err("fixture needs one bounded integer selector".into());
            }
            let kind = args[0]
                .as_i64()
                .ok_or("fixture kind must be signed integer")?;
            let fixture = Fixture::prepare(kind, deadline)?;
            self.merge(fixture.view(deadline)?);
            self.fixture = Some(fixture);
            self.clear_terminal();
        } else {
            if name == "close_delivery_task" {
                if args.len() != 1 || args[0].as_bool().is_none() {
                    return Err("close bounded must be boolean".into());
                }
            } else if !args.is_empty() {
                return Err("action takes no arguments".into());
            }
            if self.fixture.is_none() && name == "inspect_delivery_reminders" {
                self.clear_terminal();
                return Ok(());
            }
            let initialized_now = self.fixture.is_none();
            if initialized_now {
                let fixture = Fixture::prepare(1, deadline)?;
                self.merge(fixture.view(deadline)?);
                self.fixture = Some(fixture);
            }
            let f = self.fixture.as_ref().ok_or("delivery fixture missing")?;
            let root = f.root.path();
            let before = tree(root)?;
            let prior = self.observation.clone();
            let authority: BTreeMap<_, _> = before
                .iter()
                .filter(|(p, _)| {
                    p.ends_with(".bla")
                        || *p == ".blabla/status.json"
                        || *p == ".blabla/verifying.json"
                })
                .map(|(p, v)| (p.clone(), v.clone()))
                .collect();
            let closed: BTreeMap<_, _> = task::read_all(root)
                .into_iter()
                .filter(|t| t.state == "closed")
                .map(|t| {
                    let p = format!(".blabla/tasks/{}.json", t.name);
                    (p.clone(), before.get(&p).cloned())
                })
                .collect();
            let mut exit = None;
            let mut result = Value::Null;
            if name == "inspect_delivery_reminders" {
                let status = project_status(root, deadline)?;
                let goal = expected(root, &["explain", "goal::outcome"], 0, deadline)?;
                if status["delivery"]["residuals"] != goal["delivery"]["residuals"] {
                    return Err("status and goal residual projections disagree".into());
                }
            } else {
                let command=match name {
                    "accept_delivery_assignment"=>["task","accept","work","--model","worker"].map(str::to_owned).to_vec(),
                    "record_delivery_claim"=>claim_args(&f.claim_status,f.verification_only),
                    "record_delivery_review"=>review_args("review",&f.review_model,None),
                    "ready_delivery_task"=>["task","ready","work"].map(str::to_owned).to_vec(),
                    "close_delivery_task"=>close_args("work",args[0]==true,&f.close_model),
                    "resolve_delivery_origin"=>review_args("resolution",&f.review_model,Some(f.origin.as_deref().unwrap_or("{\"task\":\"work\",\"goal\":\"goal::outcome\",\"claim_digest\":\"absent\"}"))),
                    _=>return Err("unrecognized action".into())
                };
                let (code, value) = invoke(
                    root,
                    &command.iter().map(String::as_str).collect::<Vec<_>>(),
                    deadline,
                )?;
                let success = decision(code, &value)?;
                exit = Some(code);
                result = value;
                if success && matches!(name, "record_delivery_review" | "resolve_delivery_origin") {
                    let review = if name == "record_delivery_review" {
                        "review"
                    } else {
                        "resolution"
                    };
                    handback(root, review, deadline)?;
                    let bounded = project_status(root, deadline)?["recorded"]["stale"]
                        == json!(["implementation"]);
                    owned(root, &close_args(review, bounded, "owner"), deadline)?;
                }
            }
            let after_view = f.view(deadline)?;
            let after = tree(root)?;
            let unchanged = before == after;
            if exit == Some(2) && !unchanged {
                return Err(format!("refused {name} changed fixture files"));
            }
            self.merge(after_view);
            self.clear_terminal();
            self.observation["delivery_operation_succeeded"] = json!(exit == Some(0));
            self.observation["delivery_exit"] = json!(exit);
            self.observation["delivery_result"] = result;
            self.observation["delivery_records_unchanged"] = json!(unchanged && !initialized_now);
            self.observation["delivery_contract_authority_preserved"] =
                json!(authority.iter().all(|(p, v)| after.get(p) == Some(v)));
            self.observation["delivery_history_preserved"] =
                json!(closed.iter().all(|(p, v)| after.get(p) == v.as_ref()));
            let before_rows = prior["delivery_project"]["delivery"]["residuals"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let after_rows = self.observation["delivery_project"]["delivery"]["residuals"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            self.observation["delivery_other_origins_preserved"] = json!(
                before_rows
                    .iter()
                    .filter(|r| r["origin_task"] != "work")
                    .all(|r| after_rows.contains(r))
            );
            self.observation["delivery_exact_origin_resolved"] = json!(
                name == "resolve_delivery_origin"
                    && exit == Some(0)
                    && before_rows.iter().any(|r| r["origin_task"] == "work")
                    && !after_rows.iter().any(|r| r["origin_task"] == "work")
            );
        }
        self.observation["delivery_request_millis"] = json!(start.elapsed().as_millis());
        if Instant::now() > deadline {
            return Err("delivery request exceeded budget".into());
        }
        Ok(())
    }
    fn merge(&mut self, view: Value) {
        self.observation
            .as_object_mut()
            .expect("observation object")
            .extend(view.as_object().expect("fixture view object").clone());
    }
    fn execute_batch(&mut self, name: &str, args: &Value) -> Result<(), String> {
        let start = Instant::now();
        let deadline = start + BUDGET;
        let args = args.as_array().ok_or("batch arguments must be an array")?;
        if name == "delivery_batch_fixture" {
            if args.len() != 1 {
                return Err("batch fixture needs one bounded integer selector".into());
            }
            let kind = args[0]
                .as_i64()
                .ok_or("batch kind must be signed integer")?;
            let fixture = BatchFixture::prepare(kind, deadline)?;
            let view = fixture.view(deadline)?;
            self.batch = Some(fixture);
            self.clear_terminal();
            self.merge(view);
        } else {
            if !args.is_empty() {
                return Err("explicit source review takes no arguments".into());
            }
            let initialized_now = self.batch.is_none();
            if initialized_now {
                self.batch = Some(BatchFixture::prepare(0, deadline)?);
            }
            let fixture = self.batch.as_ref().ok_or("batch fixture absent")?;
            let root = fixture.base.root.path();
            let before = tree(root)?;
            let prior = task::read(root, "batch")?.ok_or("batch record absent")?;
            let other: Vec<_> = prior
                .delivery_reviews
                .iter()
                .filter(|r| r.source_task.as_deref() != Some(&fixture.selected))
                .cloned()
                .collect();
            let mut command = review_args("batch", &fixture.model, None);
            command.extend(["--source".to_owned(), fixture.selected.clone()]);
            let (exit, result) = invoke(
                root,
                &command.iter().map(String::as_str).collect::<Vec<_>>(),
                deadline,
            )?;
            let success = decision(exit, &result)?;
            let view = fixture.view(deadline)?;
            let after = tree(root)?;
            let record = task::read(root, "batch")?.ok_or("batch record disappeared")?;
            let remaining: Vec<_> = record
                .delivery_reviews
                .iter()
                .filter(|r| r.source_task.as_deref() != Some(&fixture.selected))
                .cloned()
                .collect();
            let preserved = serde_json::to_value(&other).map_err(|e| e.to_string())?
                == serde_json::to_value(&remaining).map_err(|e| e.to_string())?;
            let sources = ["work", "secondary", "stranger"].iter().all(|name| {
                let path = format!(".blabla/tasks/{name}.json");
                before.get(&path) == after.get(&path)
            });
            if !success && before != after {
                return Err("refused explicit review changed fixture bytes".into());
            }
            self.clear_terminal();
            self.merge(view);
            self.observation["delivery_operation_succeeded"] = json!(success);
            self.observation["delivery_exit"] = json!(exit);
            self.observation["delivery_result"] = result;
            self.observation["delivery_records_unchanged"] =
                json!(before == after && !initialized_now);
            self.observation["delivery_other_source_verdicts_preserved"] = json!(preserved);
            self.observation["delivery_source_records_unchanged"] = json!(sources);
        }
        self.observation["delivery_request_millis"] = json!(start.elapsed().as_millis());
        if Instant::now() > deadline {
            return Err("batch request exceeded budget".into());
        }
        Ok(())
    }
    fn clear_terminal(&mut self) {
        self.observation["delivery_other_source_verdicts_preserved"] = json!(true);
        self.observation["delivery_source_records_unchanged"] = json!(true);
        for key in ["operation_succeeded", "exact_origin_resolved"] {
            self.observation[format!("delivery_{key}")] = json!(false);
        }
        for key in [
            "records_unchanged",
            "other_origins_preserved",
            "history_preserved",
            "contract_authority_preserved",
        ] {
            self.observation[format!("delivery_{key}")] = json!(true);
        }
        self.observation["delivery_exit"] = Value::Null;
        self.observation["delivery_result"] = Value::Null;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_typed_lifecycle_decisions_are_observed_as_refusals() {
        assert!(decision(0, &json!({"task":{}})).unwrap());
        assert!(!decision(2, &json!({"category":"task"})).unwrap());
        for (exit, value) in [
            (101, json!({"category":"task"})),
            (2, json!({"category":"memory"})),
            (0, json!({"ok":true})),
            (1, json!({"category":"task"})),
        ] {
            assert!(decision(exit, &value).is_err());
        }
    }
}
