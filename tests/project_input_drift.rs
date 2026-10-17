use serde_json::{Value, json};
use std::path::Path;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;

fn write(root: &Path, path: &str, text: &str) {
    let file = root.join(path);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(file, text).unwrap();
}

fn cli(root: &Path, arguments: &[&str], exit: i32) -> Value {
    let mut args = vec!["--json"];
    args.extend_from_slice(arguments);
    let output = support::run_in(Some(root), &support::args(&args));
    assert_eq!(
        output.status.code(),
        Some(exit),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn fixture(extra: Option<&Path>) -> TempDir {
    let temp = TempDir::new().unwrap();
    let command = match extra {
        Some(path) => json!(["python", "app.py", path]),
        None => json!(["python", "app.py"]),
    };
    write(
        temp.path(),
        "project.bla",
        &format!(
            "project Inputs\nuse behavior \"behavior.bla\"\nignore \"generated/\"\nverify behavior {{ command {command} seed 0 cases 1 steps 3 timeout_ms 2000 shrink_budget 8 }}\n"
        ),
    );
    write(
        temp.path(),
        "behavior.bla",
        "state count: int\naction increment()\nwhen increment { expect \"adds-one\": after.count == before.count + 1 }\n",
    );
    write(temp.path(), "child/project.bla", "project Child\n");
    write(temp.path(), "child/source.txt", "before\n");
    write(
        temp.path(),
        "app.py",
        "import json, sys\ncount = 0\nfor line in sys.stdin:\n r = json.loads(line)\n if r['op'] == 'reset':\n  count = 0\n  value = {'ok': True}\n elif r['op'] == 'call':\n  count += 1\n  value = {'ok': True}\n else:\n  value = {'count': count}\n print(json.dumps({'id': r['id'], 'result': value}), flush=True)\n",
    );
    cli(temp.path(), &["finish"], 0);
    temp
}

fn record(root: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(root.join(".blabla/status.json")).unwrap()).unwrap()
}

fn changes(value: &Value) -> &Vec<Value> {
    value["recorded"]["input_drift"]["changes"]
        .as_array()
        .expect("per-input changes must be available")
}

#[test]
fn baseline_and_child_deltas_are_sorted_exact_and_read_only() {
    let temp = fixture(None);
    let root = temp.path();
    let saved = std::fs::read(root.join(".blabla/status.json")).unwrap();
    let before = cli(root, &["status"], 0);
    assert_eq!(
        before["recorded"]["input_drift"]["availability"],
        "available"
    );
    assert!(changes(&before).is_empty());
    let baseline = record(root);
    assert!(
        baseline["implementation_inputs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["source"] == "tree-file" && row["path"] == "child/source.txt")
    );
    write(root, "child/source.txt", "after\n");
    write(root, "child/added.txt", "new\n");
    std::fs::remove_file(root.join("child/project.bla")).unwrap();
    let after = cli(root, &["status"], 5);
    assert_eq!(after["recorded"]["stale"], json!(["implementation"]));
    let deltas = changes(&after);
    assert_eq!(
        deltas
            .iter()
            .map(|row| (
                row["path"].as_str().unwrap(),
                row["change"].as_str().unwrap()
            ))
            .collect::<Vec<_>>(),
        vec![
            ("child/added.txt", "added"),
            ("child/project.bla", "removed"),
            ("child/source.txt", "changed")
        ]
    );
    assert!(deltas[0]["recorded"].is_null());
    assert!(deltas[1]["current"].is_null());
    assert_ne!(
        deltas[2]["recorded"]["fingerprint"],
        deltas[2]["current"]["fingerprint"]
    );
    assert_eq!(after, cli(root, &["status"], 5));
    assert_eq!(
        saved,
        std::fs::read(root.join(".blabla/status.json")).unwrap()
    );
}

#[test]
fn external_command_extra_changes_and_disappearance_are_visible() {
    let outside = TempDir::new().unwrap();
    write(outside.path(), "input.txt", "before");
    let extra = outside.path().join("input.txt");
    let temp = fixture(Some(&extra));
    write(outside.path(), "input.txt", "after");
    let after = cli(temp.path(), &["status"], 5);
    assert_eq!(changes(&after).len(), 1);
    assert_eq!(changes(&after)[0]["source"], "command-file");
    assert_eq!(changes(&after)[0]["path"], extra.to_string_lossy().as_ref());
    std::fs::remove_file(extra).unwrap();
    let removed = cli(temp.path(), &["status"], 5);
    assert_eq!(changes(&removed)[0]["change"], "removed");
}

#[test]
fn ignored_files_and_internal_state_do_not_create_deltas() {
    let temp = fixture(None);
    write(temp.path(), "generated/new.txt", "ignored");
    write(temp.path(), ".blabla/irrelevant.json", "{}");
    write(temp.path(), "target/generated.txt", "ignored");
    assert!(changes(&cli(temp.path(), &["status"], 0)).is_empty());
}

#[test]
fn legacy_record_has_no_invented_baseline_or_freshness_credit() {
    let temp = fixture(None);
    let mut saved = record(temp.path());
    saved
        .as_object_mut()
        .unwrap()
        .remove("implementation_inputs");
    write(temp.path(), ".blabla/status.json", &saved.to_string());
    let same = cli(temp.path(), &["status"], 0);
    assert_eq!(
        same["recorded"]["input_drift"]["availability"],
        "legacy-unavailable"
    );
    assert!(same["recorded"]["input_drift"]["total_changes"].is_null());
    write(temp.path(), "child/source.txt", "after");
    let stale = cli(temp.path(), &["status"], 5);
    assert_eq!(stale["recorded"]["stale"], json!(["implementation"]));
    assert_eq!(
        stale["recorded"]["input_drift"]["availability"],
        "legacy-unavailable"
    );
    assert!(changes(&stale).is_empty());
}

#[test]
fn presentation_caps_deltas_without_truncating_the_persisted_baseline() {
    let temp = fixture(None);
    for index in 0..73 {
        write(temp.path(), &format!("child/{index:03}.txt"), "one");
    }
    cli(temp.path(), &["finish"], 0);
    assert!(
        record(temp.path())["implementation_inputs"]
            .as_array()
            .unwrap()
            .len()
            > 73
    );
    for index in 0..73 {
        write(temp.path(), &format!("child/{index:03}.txt"), "two");
    }
    let view = cli(temp.path(), &["status"], 5);
    let drift = &view["recorded"]["input_drift"];
    assert_eq!(drift["total_changes"], 73);
    assert_eq!(drift["limit"], 50);
    assert_eq!(drift["omitted_changes"], 23);
    assert_eq!(changes(&view).len(), 50);
    assert_eq!(changes(&view).last().unwrap()["path"], "child/049.txt");
    let human = support::run_in(Some(temp.path()), &support::args(&["status"]));
    let text = String::from_utf8(human.stdout).unwrap();
    assert!(text.contains("23 additional changes omitted"), "{text}");
    assert!(!text.contains("child/050.txt"), "{text}");
}

#[test]
fn contract_change_remains_separate_from_implementation_inputs() {
    let temp = fixture(None);
    let source = std::fs::read_to_string(temp.path().join("behavior.bla")).unwrap();
    write(temp.path(), "behavior.bla", &(source + "\n"));
    let view = cli(temp.path(), &["status"], 5);
    assert_eq!(view["recorded"]["stale"], json!(["contracts"]));
    assert!(changes(&view).is_empty());
}

#[test]
fn aggregate_retains_the_original_path_length_content_and_extra_byte_stream() {
    let temp = TempDir::new().unwrap();
    write(temp.path(), "a.txt", "a");
    write(temp.path(), "nested/b.txt", "bb");
    write(temp.path(), "excluded.txt", "excluded");
    let external = TempDir::new().unwrap();
    write(external.path(), "extra.txt", "extra");
    let extra = external.path().join("extra.txt");
    let mut original = blabla::project::Fnv::new();
    for (name, content) in [
        ("a.txt", "a"),
        ("nested/b.txt", "bb"),
        (extra.to_str().unwrap(), "extra"),
    ] {
        original.write_str(name);
        original.write(&(content.len() as u64).to_le_bytes());
        original.write(content.as_bytes());
    }
    let actual = blabla::project::fingerprint(
        temp.path(),
        &[extra],
        &[temp.path().join("excluded.txt")],
        &blabla::project::ignore::Ignore::default(),
    );
    assert_eq!(actual, original.finish());
}

#[test]
fn human_status_names_deltas_and_legacy_limit_without_writing_records() {
    let temp = fixture(None);
    write(temp.path(), "child/source.txt", "after");
    let output = support::run_in(Some(temp.path()), &support::args(&["status"]));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("Verification input changes"), "{text}");
    assert!(text.contains("child/source.txt"), "{text}");
    let mut saved = record(temp.path());
    saved
        .as_object_mut()
        .unwrap()
        .remove("implementation_inputs");
    write(temp.path(), ".blabla/status.json", &saved.to_string());
    let output = support::run_in(Some(temp.path()), &support::args(&["status"]));
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("baseline unavailable")
    );
}

#[cfg(unix)]
#[test]
fn unreadable_file_and_directory_observations_follow_actual_access() {
    use std::os::unix::fs::PermissionsExt;
    let temp = fixture(None);
    write(temp.path(), "locked/file.txt", "locked");
    let file = temp.path().join("locked/file.txt");
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o0)).unwrap();
    let file_denied = std::fs::read(&file).is_err();
    cli(temp.path(), &["finish"], 0);
    if file_denied {
        let saved = record(temp.path());
        let row = saved["implementation_inputs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["path"] == "locked/file.txt")
            .unwrap();
        assert_eq!(row["value"]["observation"], "unreadable-file");
    }
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
    let directory = temp.path().join("locked");
    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o0)).unwrap();
    let directory_denied = std::fs::read_dir(&directory).is_err();
    cli(temp.path(), &["finish"], 0);
    if directory_denied {
        let saved = record(temp.path());
        assert!(
            saved["implementation_inputs"]
                .as_array()
                .unwrap()
                .iter()
                .any(|row| row["source"] == "unreadable-directory" && row["path"] == "locked")
        );
    }
    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
    if !file_denied || !directory_denied {
        eprintln!(
            "Runtime can bypass some permission restrictions; corresponding denial assertions are conditional"
        );
    }
    let view = cli(
        temp.path(),
        &["status"],
        if directory_denied { 5 } else { 0 },
    );
    assert_eq!(view["recorded"]["input_drift"]["availability"], "available");
}

#[test]
fn large_files_keep_the_original_length_and_modification_time_hash() {
    let temp = TempDir::new().unwrap();
    let file = temp.path().join("large.bin");
    std::fs::write(&file, vec![7_u8; 4 * 1024 * 1024 + 1]).unwrap();
    let metadata = std::fs::metadata(&file).unwrap();
    let mut original = blabla::project::Fnv::new();
    original.write_str("large.bin");
    original.write(&metadata.len().to_le_bytes());
    original.write(
        &metadata
            .modified()
            .unwrap()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_le_bytes(),
    );
    let observed = blabla::project::fingerprint_observation(
        temp.path(),
        &[],
        &[],
        &blabla::project::ignore::Ignore::default(),
    );
    assert_eq!(observed.fingerprint, original.finish());
    assert_eq!(observed.inputs[0].value.observation, "modified-time");
}

#[test]
fn explicit_command_input_under_ignore_remains_visible() {
    let temp = fixture(None);
    write(temp.path(), "generated/input.txt", "before");
    let manifest = std::fs::read_to_string(temp.path().join("project.bla")).unwrap();
    write(
        temp.path(),
        "project.bla",
        &manifest.replace("\"app.py\"]", "\"app.py\",\"generated/input.txt\"]"),
    );
    cli(temp.path(), &["finish"], 0);
    write(temp.path(), "generated/input.txt", "after");
    let view = cli(temp.path(), &["status"], 5);
    assert_eq!(changes(&view).len(), 1);
    assert_eq!(changes(&view)[0]["source"], "command-file");
    assert_eq!(
        changes(&view)[0]["path"],
        temp.path()
            .join("generated")
            .join("input.txt")
            .to_string_lossy()
            .as_ref()
    );
}
