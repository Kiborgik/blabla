use blabla::project::task;
use serde_json::{Value, json};
use std::fs;
use std::path::Path;
use std::process::Output;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;

fn write(root: &Path, path: &str, text: &str) {
    let path = root.join(path);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn cli(root: &Path, arguments: &[&str]) -> Output {
    support::run_in(Some(root), &support::args(arguments))
}

fn success(root: &Path, arguments: &[&str]) -> Output {
    let output = cli(root, arguments);
    assert_eq!(output.status.code(), Some(0), "{arguments:?}: {output:?}");
    output
}

fn json_success(root: &Path, arguments: &[&str]) -> Value {
    let mut all = vec!["--json"];
    all.extend_from_slice(arguments);
    let output = success(root, &all);
    serde_json::from_slice(&output.stdout).unwrap()
}

fn record(root: &Path, name: &str) -> Value {
    serde_json::from_slice(&fs::read(root.join(format!(".blabla/tasks/{name}.json"))).unwrap())
        .unwrap()
}

fn fixture() -> TempDir {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "project.bla",
        "project Receipts\nuse structure \"entry.bla\"\nprocess \"process.bla\"\nknowledge \"knowledge.bla\"\ngoal \"goals.bla\"\n",
    );
    write(
        root,
        "entry.bla",
        "module app \"src/app.rs\"\nrequire \"entry\": symbol app::run\n",
    );
    write(root, "src/app.rs", "pub fn run() {}\n");
    write(
        root,
        "payload.dat",
        "Tracked input unrelated to a task note\n",
    );
    write(
        root,
        "process.bla",
        "role \"orchestrator\" { purpose \"Assign\" model \"owner\" }\nrole \"worker\" { purpose \"Implement\" model \"worker\" consult [\"testing\"] }\nrole \"reviewer\" { purpose \"Review\" model \"reviewer\" consult [\"testing\"] }\n",
    );
    write(
        root,
        "knowledge.bla",
        "knowledge \"testing\" { purpose \"Inspect actual evidence\" }\nruling \"actual\" { pack \"testing\" statement \"Read the observed result\" }\n",
    );
    write(
        root,
        "goals.bla",
        "goal \"entry\" { statement \"Retain the callable entry\" expect [\"contract::entry\"] state \"active\" delivery \"required\" }\n",
    );
    temp
}

fn open(root: &Path, name: &str, scope: &str) -> Output {
    success(
        root,
        &[
            "task",
            "open",
            name,
            "--role",
            "worker",
            "--statement",
            "Retain the entry",
            "--scope",
            scope,
            "--goal",
            "entry",
            "--check",
            "inspect entry",
        ],
    )
}

fn review_fixture() -> TempDir {
    let temp = fixture();
    let root = temp.path();
    for (name, scope) in [
        ("first", "src"),
        ("second", "second.rs"),
        ("third", "third.rs"),
    ] {
        open(root, name, scope);
        success(root, &["task", "accept", name, "--model", "worker"]);
    }
    success(
        root,
        &[
            "task",
            "open",
            "review",
            "--role",
            "reviewer",
            "--statement",
            "Inspect the three assigned source tasks",
            "--scope",
            "review.md",
            "--review-of",
            "first",
            "--delivery-review-of",
            "second",
            "--delivery-review-of",
            "third",
            "--require-intent-disposition",
            "--check",
            "inspect entry",
        ],
    );
    success(root, &["task", "accept", "review", "--model", "reviewer"]);
    temp
}

fn compact_line(name: &str, state: &str) -> String {
    format!("task::{name}   {state}   recorded; blabla task show {name} prints the record\n")
}

#[test]
fn compact_note_persists_only_the_new_note_and_prints_the_exact_receipt() {
    let temp = fixture();
    let root = temp.path();
    open(root, "work", "src");
    let before = record(root, "work");
    let output = success(root, &["task", "note", "work", "Observed the entry"]);
    assert_eq!(output.stdout, compact_line("work", "OPEN").as_bytes());
    assert!(output.stderr.is_empty(), "{output:?}");
    let after = record(root, "work");
    assert_eq!(after["notes"].as_array().unwrap().len(), 1);
    assert_eq!(after["notes"][0]["statement"], "Observed the entry");
    assert!(after["notes"][0]["unix"].as_u64().is_some());
    let mut expected = before;
    expected["notes"] = after["notes"].clone();
    assert_eq!(after, expected);
}

#[test]
fn compact_and_json_lenses_preserve_the_same_review_mutation() {
    let temp = review_fixture();
    let root = temp.path();
    let path = root.join(".blabla/tasks/review.json");
    let original = fs::read(&path).unwrap();
    let before: Value = serde_json::from_slice(&original).unwrap();
    let arguments = [
        "task",
        "lens",
        "review",
        "testing",
        "Inspected the three source records",
        "--model",
        "reviewer",
    ];
    let compact = success(root, &arguments);
    assert_eq!(
        compact.stdout,
        compact_line("review", "ACCEPTED").as_bytes()
    );
    assert!(compact.stderr.is_empty(), "{compact:?}");
    let compact_task = record(root, "review");
    let assessment = &compact_task["assessments"][0];
    assert_eq!(compact_task["assessments"].as_array().unwrap().len(), 1);
    assert_eq!(assessment["model"], "reviewer");
    assert_eq!(assessment["ruling"], "testing");
    assert_eq!(assessment["statement"], arguments[4]);
    assert_eq!(assessment["acceptance_epoch"], before["acceptance_epoch"]);
    assert!(assessment["knowledge_fingerprint"].as_str().is_some());
    assert!(assessment["unix"].as_u64().is_some());
    let mut expected = before;
    expected["assessments"] = compact_task["assessments"].clone();
    assert_eq!(compact_task, expected);

    fs::write(&path, original).unwrap();
    let shown = json_success(root, &arguments);
    assert_eq!(shown["task"], record(root, "review"));
    let mut json_task = shown["task"].clone();
    assert!(json_task["assessments"][0]["unix"].as_u64().is_some());
    json_task["assessments"][0]["unix"] = assessment["unix"].clone();
    assert_eq!(json_task, compact_task);
    assert_eq!(shown["review_accepted"], true);
    assert_eq!(shown["review_current"], true);
    assert_eq!(shown["assessment_current"], json!([true]));
    assert_eq!(shown["readiness_summary"]["review_targets"]["total"], 3);
    assert_eq!(shown["readiness_summary"]["delivery"]["total"], 3);
    assert!(!shown["affected_intent"].as_array().unwrap().is_empty());
    assert_eq!(shown["swallowed_check_argv"], json!([]));
    let inspected = json_success(root, &["task", "show", "review"]);
    for field in [
        "task",
        "review_current",
        "assessment_current",
        "readiness_summary",
        "affected_intent",
        "routes",
    ] {
        assert_eq!(shown[field], inspected[field], "{field}");
    }
}

#[test]
fn opening_still_prints_the_full_view_and_json_keeps_swallowed_argv() {
    let temp = fixture();
    let root = temp.path();
    let opened = open(root, "work", "src");
    let text = String::from_utf8(opened.stdout).unwrap();
    assert!(text.starts_with("task::work   OPEN\n"), "{text}");
    for heading in [
        "Statement:",
        "Write scope:",
        "Declared check:",
        "Readiness summary",
    ] {
        assert!(text.contains(heading), "{heading}: {text}");
    }
    let inspected = success(root, &["task", "show", "work"]);
    assert!(inspected.stdout.starts_with(text.as_bytes()));
    let shown = json_success(
        root,
        &[
            "task", "check", "work", "--argv", "program", "--model", "worker",
        ],
    );
    assert_eq!(shown["task"], record(root, "work"));
    assert_eq!(shown["swallowed_check_argv"], json!(["--model"]));
    assert_eq!(
        shown["task"]["check_argv"],
        json!(["program", "--model", "worker"])
    );
    assert!(shown["readiness_summary"].is_object());
    assert!(shown["delivery"].is_object());
}

#[test]
fn compact_and_json_authority_refusals_leave_the_record_unchanged() {
    let temp = review_fixture();
    let root = temp.path();
    let path = root.join(".blabla/tasks/review.json");
    let original = fs::read(&path).unwrap();
    for (lens, model, reason) in [
        ("testing", "worker", "did not accept this task"),
        ("unknown", "reviewer", "a lens must name a resolved pack"),
    ] {
        let arguments = [
            "task",
            "lens",
            "review",
            lens,
            "Invalid authority claim",
            "--model",
            model,
        ];
        let compact = cli(root, &arguments);
        assert_eq!(compact.status.code(), Some(2), "{compact:?}");
        assert!(compact.stdout.is_empty(), "{compact:?}");
        assert!(
            String::from_utf8_lossy(&compact.stderr).contains(reason),
            "{compact:?}"
        );
        assert_eq!(fs::read(&path).unwrap(), original);
        let mut all = vec!["--json"];
        all.extend(arguments);
        let output = cli(root, &all);
        assert_eq!(output.status.code(), Some(2), "{output:?}");
        let failure: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(failure["category"], "task");
        assert!(failure.to_string().contains(reason), "{failure}");
        assert_eq!(fs::read(&path).unwrap(), original);
    }
}

#[test]
fn compact_receipts_retain_the_historical_bounded_result_warning() {
    let temp = fixture();
    let root = temp.path();
    open(root, "work", "src");
    let mut work = task::read(root, "work").unwrap().unwrap();
    work.result_basis = Some(task::ResultBasis::Bounded {
        reason: "Retain the historical bounded basis".into(),
        project_state: "stale".into(),
        prior_run_id: "prior-run".into(),
        implementation_fingerprint: "prior-implementation".into(),
        revision: task::RelevantRevision {
            acceptance_epoch: 0,
            task_digest: "prior-task".into(),
            paths: Default::default(),
            identities: Default::default(),
        },
    });
    task::write(root, &work).unwrap();
    let output = success(root, &["task", "note", "work", "Inspect historical basis"]);
    let expected = format!(
        "{}Bounded result accepted; project verification pending at acceptance.\n  Reason: Retain the historical bounded basis\n  Prior canonical GREEN run: prior-run\n  Prior implementation fingerprint: prior-implementation\n  This historical receipt does not replace current blabla status.\n",
        compact_line("work", "OPEN")
    );
    assert_eq!(output.stdout, expected.as_bytes());
    assert_eq!(
        record(root, "work")["result_basis"],
        serde_json::to_value(work.result_basis).unwrap()
    );
}

#[cfg(target_os = "linux")]
#[test]
fn compact_note_does_not_open_snapshot_only_files_but_json_still_does() {
    use std::ffi::CString;
    use std::io::{ErrorKind, Read};
    use std::os::fd::FromRawFd;
    use std::os::unix::ffi::OsStrExt;

    let temp = fixture();
    let root = temp.path();
    open(root, "work", "src");
    let descriptor = unsafe { libc::inotify_init1(libc::IN_NONBLOCK | libc::IN_CLOEXEC) };
    assert!(descriptor >= 0, "{}", std::io::Error::last_os_error());
    let mut events = unsafe { fs::File::from_raw_fd(descriptor) };
    let watched = CString::new(root.join("payload.dat").as_os_str().as_bytes()).unwrap();
    let watch = unsafe { libc::inotify_add_watch(descriptor, watched.as_ptr(), libc::IN_OPEN) };
    assert!(watch >= 0, "{}", std::io::Error::last_os_error());
    success(root, &["task", "note", "work", "Compact note"]);
    let mut buffer = [0u8; 4096];
    let compact = events.read(&mut buffer);
    assert!(
        matches!(&compact, Err(error) if error.kind() == ErrorKind::WouldBlock),
        "compact receipt opened a snapshot-only file: {compact:?}"
    );
    json_success(root, &["task", "note", "work", "JSON note"]);
    assert!(events.read(&mut buffer).unwrap() > 0);
}
