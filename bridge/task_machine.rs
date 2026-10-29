use super::component::Component;
use super::source_cli::{Campaign, Request};
use blabla::project::{self, ignore::Ignore, task};
use blabla::runtime::MAX_TIMEOUT as REQUEST_BUDGET;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::Instant;
use tempfile::TempDir;

const TASK: &str = "machine";
const OWNER: &str = "--model=owner";
const FAMILY: &str = "--model=family-1";
const INPUT: &str = "work/Owned.txt";
const SPARE: &str = "work/Spare.txt";
const OUTSIDE: &str = "outside.txt";
const APP: &str = "app.rs";
const GREEN_APP: &str = "pub fn run() {}\n";
const RED_APP: &str = "pub fn halt() {}\n";
const OPENED: [(&str, &str); 3] = [
    (INPUT, "opened\n"),
    (SPARE, "spare\n"),
    (OUTSIDE, "outside\n"),
];
const LENS: &str = "Every observation comes from the real record";

#[cfg(windows)]
const CHECK: [&str; 4] = ["cmd", "/d", "/c", "exit 0"];
#[cfg(not(windows))]
const CHECK: [&str; 1] = ["true"];
const MANIFEST: &str = "project TaskMachine\nuse structure \"entry.bla\"\nprocess \"process.bla\"\ngoal \"goals.bla\"\nsystem \"system.bla\"\nknowledge \"knowledge.bla\"\n";
const ENTRY: &str = "module app \"app.rs\"\nrequire \"entry\": symbol app::run\n";
const PROCESS: &str = "role \"orchestrator\" { purpose \"Own integration\" model \"owner\" }\nrole \"worker\" { purpose \"Carry bounded work\" model [\"family-*\", \"pinned:9b\"] consult [\"testing\"] }\n";
const GOALS: &str = "goal \"lifecycle\" { statement \"Every task lives in one lifecycle\" expect [\"entry::entry\"] state \"active\" }\n";
const SYSTEM: &str = "system \"work\" { purpose \"Hold what the task writes\" paths [\"work\"] }\n";
const KNOWLEDGE: &str = "knowledge \"testing\" { purpose \"Check evidence\" }\nruling \"observe\" { pack \"testing\" statement \"Read the result\" }\n";
const ACTIONS: [&str; 15] = [
    "machine_fixture",
    "accept",
    "block",
    "run_evidence",
    "claim_evidence",
    "change_input",
    "touch_outside_scope",
    "ready",
    "close",
    "withdraw",
    "inspect_budget",
    "inspect_views",
    "release_scope",
    "prepare_handback",
    "hand_back",
];

fn view(root: &Path, argv: &[&str], exits: &[i32], deadline: &Request) -> Result<Value, String> {
    let (exit, value) = deadline.invoke(root, argv, true)?;
    if exits.contains(&exit) {
        Ok(value)
    } else {
        Err(format!("task-machine view {argv:?}: exit {exit}: {value}"))
    }
}

fn unprepared() -> Value {
    json!({
        "machine_ready": false,
        "task_state": "none",
        "refused": false,
        "record_unchanged": true,
        "serves_goal": false,
        "asks_intent": false,
        "scope_empty": true,
        "evidence_kind": "",
        "any_evidence_current": false,
        "run_evidence_current": false,
        "evidence_passing": false,
        "open_findings": 0,
        "residual_findings": 0,
        "lens_assessments": 0,
        "intent_claims": 0,
        "affected_intents": 0,
        "model_challenged": false,
        "tree_matches_opening": true,
        "project_green": false,
        "show_matches_challenge": false,
        "scope_spelling_kept": false,
        "unnamed_challenge_is_project_wide": false,
        "scope_paths": 0,
    })
}

struct Shape {
    goal: bool,
    intent: bool,
    empty_scope: bool,
    green: bool,
}

impl Shape {
    fn parse(args: &Value) -> Result<Self, String> {
        let flags: Option<Vec<bool>> = args
            .as_array()
            .and_then(|args| args.iter().map(Value::as_bool).collect());
        match flags.as_deref() {
            Some(&[goal, intent, empty_scope, green]) => Ok(Self {
                goal,
                intent,
                empty_scope,
                green,
            }),
            _ => Err(format!("machine_fixture takes four booleans, not {args}")),
        }
    }
}

fn command(verb: &str, rest: &[&str]) -> Vec<String> {
    ["task", verb, TASK]
        .iter()
        .chain(rest)
        .map(|word| (*word).to_owned())
        .collect()
}

fn classes(found: &[Value]) -> Vec<&Value> {
    found.iter().map(|one| &one["class"]).collect()
}

struct Handing {
    outcome: String,
    lens: bool,
    intent: bool,
}

enum Action {
    Accept(String),
    Block,
    RunEvidence,
    ClaimEvidence(i64),
    ChangeInput,
    Edit(&'static str),
    Ready(Handing),
    Close(bool, bool),
    Withdraw,
    Budget,
    Views,
    Release(bool),
    Prepare,
    HandBack(Handing),
}

impl Action {
    fn parse(name: &str, args: &Value) -> Result<Self, String> {
        let malformed = || format!("{name} cannot take {args}");
        let listed = args.as_array().ok_or_else(malformed)?;
        Ok(match (name, listed.as_slice()) {
            ("accept", [Value::String(model)]) => Action::Accept(model.clone()),
            ("block", []) => Action::Block,
            ("run_evidence", []) => Action::RunEvidence,
            ("claim_evidence", [exit]) => {
                Action::ClaimEvidence(exit.as_i64().ok_or_else(malformed)?)
            }
            ("change_input", []) => Action::ChangeInput,
            ("touch_outside_scope", []) => Action::Edit(OUTSIDE),
            (
                "ready",
                [
                    Value::String(outcome),
                    Value::Bool(lens),
                    Value::Bool(intent),
                ],
            ) => Action::Ready(Handing {
                outcome: outcome.clone(),
                lens: *lens,
                intent: *intent,
            }),
            ("hand_back", [Value::String(outcome)]) => Action::HandBack(Handing {
                outcome: outcome.clone(),
                lens: true,
                intent: true,
            }),
            ("close", [Value::Bool(changed), Value::Bool(breaking)]) => {
                Action::Close(*changed, *breaking)
            }
            ("withdraw", []) => Action::Withdraw,
            ("inspect_budget", []) => Action::Budget,
            ("inspect_views", []) => Action::Views,
            ("release_scope", [Value::Bool(changed)]) => Action::Release(*changed),
            ("prepare_handback", []) => Action::Prepare,
            _ => return Err(malformed()),
        })
    }
}

type Files = (BTreeMap<String, String>, BTreeMap<String, String>);

struct Fixture {
    root: TempDir,
    edits: u64,
    observed: Option<(Files, Value)>,
}

impl Fixture {
    fn prepare(shape: &Shape, deadline: &Request) -> Result<Self, String> {
        let root = TempDir::new().map_err(|e| e.to_string())?;
        fs::create_dir(root.path().join("work")).map_err(|e| e.to_string())?;
        let app = if shape.green { GREEN_APP } else { RED_APP };
        let memory = [
            ("project.bla", MANIFEST),
            ("entry.bla", ENTRY),
            (APP, app),
            ("process.bla", PROCESS),
            ("goals.bla", GOALS),
            ("system.bla", SYSTEM),
            ("knowledge.bla", KNOWLEDGE),
        ];
        for (path, text) in memory.into_iter().chain(OPENED) {
            fs::write(root.path().join(path), text).map_err(|e| e.to_string())?;
        }
        let mut argv = vec![
            "task",
            "open",
            TASK,
            "--role",
            "worker",
            "--statement",
            "Drive the task machine through the real command surface",
        ];
        if shape.empty_scope {
            argv.extend(["--input", INPUT]);
        } else {
            argv.extend(["--scope", INPUT, SPARE]);
        }
        if shape.goal {
            argv.extend(["--goal", "lifecycle"]);
        }
        if shape.intent {
            argv.push("--intent");
        }
        argv.push("--check");
        argv.extend(CHECK);
        let (exit, value) = deadline.invoke(root.path(), &argv, true)?;
        if exit != 0 {
            return Err(format!("task-machine fixture: exit {exit}: {value}"));
        }
        Ok(Self {
            root,
            edits: 0,
            observed: None,
        })
    }

    fn files(&self) -> Files {
        let root = self.root.path();
        let ignore = Ignore::default();
        (
            project::snapshot(root, &ignore),
            project::snapshot(&root.join(".blabla"), &ignore),
        )
    }

    fn current(&mut self, deadline: &Request) -> Result<Value, String> {
        let files = self.files();
        if let Some((seen, observation)) = &self.observed
            && *seen == files
        {
            return Ok(observation.clone());
        }
        let observation = self.observe(deadline)?;
        self.observed = (self.files() == files).then(|| (files, observation.clone()));
        Ok(observation)
    }

    fn record(&self) -> Result<Option<Vec<u8>>, String> {
        let path = task::path_of(self.root.path(), TASK);
        let read = path.is_file().then(|| fs::read(&path));
        read.transpose().map_err(|e| e.to_string())
    }

    fn write(&self, path: &str, text: &str) -> Result<(), String> {
        fs::write(self.root.path().join(path), text).map_err(|e| e.to_string())
    }

    fn edit(&mut self, path: &str) -> Result<(), String> {
        self.edits += 1;
        self.write(path, &format!("edit {}\n", self.edits))
    }

    fn edited(&mut self, path: &str) -> Result<Value, String> {
        let before = self.record()?;
        self.edit(path)?;
        let unchanged = before == self.record()?;
        Ok(json!({ "refused": false, "record_unchanged": unchanged }))
    }

    fn change_input(&mut self, deadline: &Request) -> Result<Value, String> {
        let shown = self.shown(deadline)?;
        let record = &shown["task"];
        let declared = if record["check_inputs"][0].is_string() {
            &record["check_inputs"]
        } else {
            &record["scope"]
        };
        let Some(input) = declared[0].as_str() else {
            return Ok(json!({ "refused": true, "record_unchanged": true }));
        };
        let disk = shown["on_disk"][input].as_str();
        let spelled = disk.unwrap_or(input).to_owned();
        self.edited(&spelled)
    }

    fn shown(&self, deadline: &Request) -> Result<Value, String> {
        view(self.root.path(), &["task", "show", TASK], &[0], deadline)
    }

    fn apply(
        &mut self,
        action: &Action,
        observed: &Value,
        deadline: &Request,
    ) -> Result<Value, String> {
        let (words, refusal) = match action {
            Action::Edit(path) => return self.edited(path),
            Action::ChangeInput => return self.change_input(deadline),
            Action::Views => return self.views(deadline),
            Action::Prepare => return self.prepared(None, observed, deadline),
            Action::HandBack(handing) => return self.prepared(Some(handing), observed, deadline),
            Action::Accept(model) => (command("accept", &[&format!("--model={model}")]), "task"),
            Action::Block => (command("block", &["Blocked by the bridge"]), "task"),
            Action::RunEvidence => (command("evidence", &["--run"]), "task"),
            Action::ClaimEvidence(exit) => (
                command("evidence", &[&format!("--exit={exit}"), "--tool=claimed"]),
                if i32::try_from(*exit).is_ok() {
                    "task"
                } else {
                    "invocation"
                },
            ),
            Action::Ready(handing) => (self.handback(handing, observed, deadline)?, "task"),
            Action::Close(changed, breaking) => return self.closed(*changed, *breaking, deadline),
            Action::Withdraw => (
                command("withdraw", &["--reason=Withdrawn by the bridge", OWNER]),
                "task",
            ),
            Action::Budget => (command("budget", &[]), "task"),
            Action::Release(changed) => (self.release(*changed, deadline)?, "task"),
        };
        self.decide(&words, refusal, deadline)
    }

    fn decide(&self, line: &[String], refusal: &str, deadline: &Request) -> Result<Value, String> {
        let before = self.record()?;
        let argv: Vec<&str> = line.iter().map(String::as_str).collect();
        let (exit, value) = deadline.invoke(self.root.path(), &argv, true)?;
        let refused = match exit {
            0 => false,
            2 if value["category"] == refusal => true,
            _ => {
                return Err(format!(
                    "task-machine command {argv:?} undecided: exit {exit}: {value}"
                ));
            }
        };
        let unchanged = before == self.record()?;
        Ok(json!({ "refused": refused, "record_unchanged": unchanged }))
    }

    fn closed(
        &mut self,
        changed: bool,
        breaking: bool,
        deadline: &Request,
    ) -> Result<Value, String> {
        if changed {
            self.edit(OUTSIDE)?;
        }
        if breaking {
            self.write(APP, RED_APP)?;
        }
        let ready = match self.record()? {
            Some(bytes) => {
                serde_json::from_slice::<Value>(&bytes).map_err(|e| e.to_string())?["state"]
                    == "ready"
            }
            None => false,
        };
        let green = if ready {
            view(self.root.path(), &["status"], &[0, 1, 3, 5], deadline)?["completion"]["allowed"]
                .as_bool()
                .ok_or("status reports no completion")?
        } else {
            false
        };
        let mut applied = self.decide(&command("close", &[OWNER]), "task", deadline)?;
        applied["project_green"] = json!(green);
        Ok(applied)
    }

    fn prepared(
        &mut self,
        ready: Option<&Handing>,
        observed: &Value,
        deadline: &Request,
    ) -> Result<Value, String> {
        let state = observed["task_state"].as_str();
        if !matches!(state, Some("open" | "accepted" | "blocked" | "ready")) {
            return Ok(json!({ "refused": false, "record_unchanged": true }));
        }
        self.decide(&command("accept", &[FAMILY]), "task", deadline)?;
        let evidence = self.decide(&command("evidence", &["--run"]), "task", deadline)?;
        let Some(handing) = ready else {
            return Ok(evidence);
        };
        let fitted = Handing {
            outcome: if observed["serves_goal"] == true {
                task::claims::Outcome::from_word(&handing.outcome)
                    .unwrap_or(task::claims::Outcome::Delivered)
                    .word()
                    .to_owned()
            } else {
                String::new()
            },
            ..*handing
        };
        let line = self.handback(&fitted, observed, deadline)?;
        self.decide(&line, "task", deadline)
    }

    fn handback(
        &self,
        handing: &Handing,
        observed: &Value,
        deadline: &Request,
    ) -> Result<Vec<String>, String> {
        if !handing.lens {
            view(self.root.path(), &["challenge", TASK], &[0, 1], deadline)?;
        }
        let mut words = command("ready", &[]);
        if !handing.outcome.is_empty() {
            words.push(format!("--outcome={}", handing.outcome));
        }
        if handing.lens {
            words.extend(["--lens", "testing", LENS].map(str::to_owned));
        }
        if handing.intent && observed["asks_intent"] == true {
            let shown = self.shown(deadline)?;
            let affected = shown["affected_intents"]
                .as_array()
                .ok_or("task show lists no affected intents")?;
            for listed in affected {
                let claimed = listed.as_str().ok_or("task show lists a non-text intent")?;
                words.push(format!("--claim={claimed}=updated"));
            }
        }
        Ok(words)
    }

    fn release(&mut self, changed: bool, deadline: &Request) -> Result<Vec<String>, String> {
        let shown = self.shown(deadline)?;
        let first = &shown["task"]["scope"][0];
        let target = first.as_str().unwrap_or(INPUT).to_owned();
        let spelled = shown["on_disk"][target.as_str()]
            .as_str()
            .unwrap_or(&target)
            .to_owned();
        if changed {
            self.edit(&spelled)?;
        } else {
            let (_, opened) = OPENED
                .iter()
                .find(|(path, _)| path.eq_ignore_ascii_case(&spelled))
                .ok_or_else(|| format!("task-machine fixture never wrote {spelled}"))?;
            self.write(&spelled, opened)?;
        }
        Ok(command("scope", &["--remove", &target, OWNER]))
    }

    fn views(&self, deadline: &Request) -> Result<Value, String> {
        let root = self.root.path();
        let before = self.record()?;
        let shown = self.shown(deadline)?;
        let named = view(root, &["challenge", TASK], &[0, 1], deadline)?;
        let unnamed = view(root, &["challenge"], &[0, 1], deadline)?;
        let unknown: Vec<&Value> = shown["attributions"]
            .as_array()
            .ok_or("task show lists no attributions")?
            .iter()
            .filter(|entry| entry["owner"] == "unknown")
            .map(|entry| &entry["path"])
            .collect();
        let grounded = named["grounded"]
            .as_array()
            .ok_or("challenge lists no grounded classes")?;
        let headline = &named["challenge"];
        let listed = headline["class"] != "attribution-unknown"
            || headline["unattributed"]
                .as_array()
                .is_some_and(|paths| paths.iter().eq(unknown.iter().copied()));
        let declared = grounded.contains(&json!("attribution-unknown"));
        let alike = listed && unknown.is_empty() != declared;
        let on_disk = &shown["on_disk"];
        let spelled = shown["task"]["scope"]
            .as_array()
            .ok_or("task show lists no scope")?
            .iter()
            .map(|path| path.as_str().and_then(|path| on_disk[path].as_str()))
            .all(|disk| disk.is_some_and(|disk| [INPUT, SPARE].contains(&disk)));
        let reported = unnamed["challenges"]
            .as_array()
            .map(Vec::as_slice)
            .map(classes);
        let grounded_all: Option<Vec<&Value>> = unnamed["grounded"]
            .as_array()
            .map(|all| all.iter().collect());
        let project_wide = unnamed.get("task").is_none() && reported == grounded_all;
        let unchanged = before == self.record()?;
        Ok(json!({
            "refused": false,
            "record_unchanged": unchanged,
            "show_matches_challenge": alike,
            "scope_spelling_kept": spelled,
            "unnamed_challenge_is_project_wide": project_wide,
        }))
    }

    fn observe(&self, deadline: &Request) -> Result<Value, String> {
        let root = self.root.path();
        let shown = self.shown(deadline)?;
        let record = &shown["task"];
        let listed = |key: &str| record[key].as_array().map_or(0, Vec::len);
        let latest = record["evidence"]
            .as_array()
            .ok_or("task show lists no evidence")?
            .last();
        let kind = match latest.map(|entry| entry["executed"].as_bool()) {
            None => "",
            Some(Some(true)) => "executed",
            Some(Some(false)) => "claimed",
            Some(None) => return Err("task show marks no evidence kind".into()),
        };
        let any_evidence_current = if kind.is_empty() {
            false
        } else {
            let freshness = view(root, &["task", "freshness", TASK], &[0], deadline)?;
            let check = freshness["receipts"]
                .as_array()
                .and_then(|rows| rows.iter().find(|row| row["kind"] == "check"))
                .ok_or("task freshness lists no check receipt")?;
            matches!(check["state"].as_str(), Some("current" | "failed"))
        };
        let run_evidence_current = kind == "executed" && any_evidence_current;
        let grounded = shown["challenge_classes"]["grounded"]
            .as_array()
            .ok_or("task show lists no challenge classes")?;
        let changed = shown["changed_since_open"]
            .as_array()
            .ok_or("task show lists no changed paths")?;
        let elsewhere = shown["changed_elsewhere"]
            .as_u64()
            .ok_or("task show counts no changes elsewhere")?;
        let findings = record["findings"]
            .as_array()
            .ok_or("task show lists no findings")?;
        let residual = findings
            .iter()
            .filter(|finding| finding["residual"] == true)
            .count();
        let open = findings
            .iter()
            .filter(|finding| {
                finding["resolution"].is_null()
                    && finding["addressed"].is_null()
                    && finding["residual"] != true
            })
            .count();
        Ok(json!({
            "machine_ready": true,
            "task_state": record["state"].as_str().ok_or("task show names no state")?,
            "refused": false,
            "record_unchanged": true,
            "serves_goal": record["goal"].is_string(),
            "asks_intent": record["asks_intent"] == true,
            "scope_empty": listed("scope") == 0,
            "evidence_kind": kind,
            "any_evidence_current": any_evidence_current,
            "run_evidence_current": run_evidence_current,
            "evidence_passing": latest.is_some_and(|entry| entry["exit"] == 0),
            "open_findings": open,
            "residual_findings": residual,
            "lens_assessments": listed("assessments"),
            "intent_claims": listed("intent_claims"),
            "affected_intents": shown["affected_intents"]
                .as_array()
                .ok_or("task show lists no affected intents")?
                .len(),
            "model_challenged": grounded.contains(&json!("model-outside-role-policy")),
            "tree_matches_opening": changed.is_empty() && elsewhere == 0,
            "project_green": false,
            "show_matches_challenge": false,
            "scope_spelling_kept": false,
            "unnamed_challenge_is_project_wide": false,
            "scope_paths": listed("scope"),
        }))
    }
}

pub struct TaskMachine {
    campaign: Campaign,
    fixture: Option<Fixture>,
    observation: Value,
}

impl TaskMachine {
    pub(crate) fn with_campaign(campaign: Campaign) -> Self {
        Self {
            campaign,
            fixture: None,
            observation: unprepared(),
        }
    }

    fn perform(&mut self, name: &str, args: &Value) -> Result<(), String> {
        if name == "machine_fixture" {
            let shape = Shape::parse(args)?;
            let request = self.campaign.request(Instant::now() + REQUEST_BUDGET);
            let mut fixture = Fixture::prepare(&shape, &request)?;
            let mut observation = fixture.current(&request)?;
            observation["record_unchanged"] = json!(false);
            self.fixture = Some(fixture);
            self.observation = observation;
            return request.finish();
        }
        let action = Action::parse(name, args)?;
        let Some(fixture) = self.fixture.as_mut() else {
            self.observation = unprepared();
            return Ok(());
        };
        let request = self.campaign.request(Instant::now() + REQUEST_BUDGET);
        let applied = fixture.apply(&action, &self.observation, &request)?;
        let mut observation = fixture.current(&request)?;
        if let (Some(observed), Some(fields)) = (observation.as_object_mut(), applied.as_object()) {
            observed.extend(fields.clone());
        }
        self.observation = observation;
        request.finish()
    }
}

impl Component for TaskMachine {
    fn call(&mut self, name: &str, args: &Value) -> Option<Result<(), String>> {
        ACTIONS.contains(&name).then(|| self.perform(name, args))
    }

    fn observe(&self, _observed: &Value) -> Value {
        self.observation.clone()
    }
}
