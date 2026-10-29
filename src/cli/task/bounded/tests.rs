use super::*;
use blabla::project::{self, runstate};
use serde_json::{Value, json};
use std::path::Path;
use tempfile::TempDir;

fn write(root: &Path, path: &str, text: &str) {
    let path = root.join(path);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn load_project(root: &Path) -> Project {
    project::load(project::read_manifest(&root.join("project.bla")).unwrap()).unwrap()
}

fn rewrite(root: &Path, path: &str, change: impl FnOnce(&mut Value)) {
    let mut value: Value =
        serde_json::from_slice(&std::fs::read(root.join(path)).unwrap()).unwrap();
    change(&mut value);
    write(root, path, &value.to_string());
}

fn open_work(project: &Project, name: &str, path: &str, review_of: Option<&str>) {
    assert_eq!(
        super::super::open_with(
            project,
            Opening {
                name: name.into(),
                role: "worker".into(),
                statement: "Exercise bounded recording".into(),
                scope: vec![path.into()],
                deliverables: vec![path.into()],
                inputs: if review_of.is_none() {
                    vec![path.into()]
                } else {
                    vec![]
                },
                check: Some(vec![
                    python().into(),
                    "-c".into(),
                    "assert 1 + 1 == 2".into()
                ]),
                review_of: review_of.map(str::to_owned),
                ..Default::default()
            },
            vec![],
            false,
            false,
            &[]
        ),
        0
    );
    assert_eq!(super::super::accept(project, name, "worker", false), 0);
    write(&project.manifest.root, path, "reviewed change\n");
    assert_eq!(super::super::evidence_run(project, name, false), 0);
    assert_eq!(super::super::challenge(project, Some(name), false), 0);
    assert_eq!(
        super::super::ready_with(project, name, super::super::HandBack::default(), false),
        0
    );
}

fn unverified_fixture(review_depth: usize, prefix: &str) -> (TempDir, Project, String) {
    let temp = tempfile::Builder::new().prefix(prefix).tempdir().unwrap();
    let root = temp.path();
    write(
        root,
        "project.bla",
        &format!(
            "project BoundedRace\nuse behavior \"behavior.bla\"\nuse structure \"structure.bla\"\nprocess \"process.bla\"\nverify behavior {{ command [\"{}\", \"app.py\"] seed 0 cases 1 steps 4 timeout_ms 2000 shrink_budget 8 }}\n",
            python()
        ),
    );
    write(
        root,
        "behavior.bla",
        "state count: int\naction increment()\nwhen increment { expect \"adds-one\": after.count == before.count + 1 }\n",
    );
    write(
        root,
        "structure.bla",
        "module entry \"entry.rs\"\nrequire \"entry-exists\": symbol entry::run\n",
    );
    write(root, "entry.rs", "pub fn run() {}\n");
    write(
        root,
        "process.bla",
        "role \"orchestrator\" { purpose \"Integrate\" model \"owner\" }\nrole \"worker\" { purpose \"Work\" model \"worker\" }\n",
    );
    write(
        root,
        "app.py",
        "import json,sys\nn=0\nfor line in sys.stdin:\n r=json.loads(line)\n if r['op']=='reset':\n  n=0\n  value={'ok':True}\n elif r['op']=='call':\n  n+=1\n  value={'ok':True}\n else:\n  value={'count':n}\n print(json.dumps({'id':r['id'],'result':value}),flush=True)\n",
    );
    write(root, "owned.txt", "before\n");
    write(root, "reports/other.md", "before\n");
    for depth in 0..review_depth {
        write(root, &format!("review{depth}.md"), "before\n");
    }
    let project = load_project(root);
    let mut other = task::record(
        root,
        &project.ignore,
        Opening {
            name: "other".into(),
            role: "worker".into(),
            statement: "Concurrent report".into(),
            scope: vec!["reports".into(), "entry.rs".into()],
            ..Default::default()
        },
        now_unix(),
    );
    task::record_acceptance(
        &mut other,
        &project::snapshot(root, &project.ignore),
        &project.ignore,
        "worker",
        now_unix(),
    );
    task::write(root, &other).unwrap();
    open_work(&project, "work", "owned.txt", None);
    let mut name = "work".to_owned();
    for depth in 0..review_depth {
        let review = format!("review{depth}");
        open_work(&project, &review, &format!("{review}.md"), Some(&name));
        name = review;
    }
    (temp, project, name)
}

fn fixture(review_depth: usize) -> (TempDir, Project, String) {
    let (temp, project, name) = unverified_fixture(review_depth, "bounded-");
    assert_eq!(
        super::super::super::project::finish(&project, false, false),
        0
    );
    write(
        &project.manifest.root,
        "reports/other.md",
        "concurrent report\n",
    );
    (temp, project, name)
}

fn race(review_depth: usize, mutation: impl FnOnce(&Path)) {
    let (_temp, project, name) = fixture(review_depth);
    let root = &project.manifest.root;
    let path = format!(".blabla/tasks/{name}.json");
    let mut reached = false;
    let mut retained = None;
    let exit = close_with_checkpoint(
        &project,
        &name,
        "owner",
        "Current bounded result only",
        || {
            reached = true;
            mutation(root);
            retained = Some((
                std::fs::read(root.join(&path)).unwrap(),
                std::fs::read(root.join(".blabla/status.json")).ok(),
                std::fs::read(root.join(".blabla/verifying.json")).ok(),
            ));
        },
    );
    assert!(
        reached,
        "the mutation must follow genuine initial eligibility"
    );
    assert_eq!(exit, 2);
    let (task_bytes, status_bytes, marker_bytes) = retained.unwrap();
    assert_eq!(std::fs::read(root.join(path)).unwrap(), task_bytes);
    assert_eq!(
        std::fs::read(root.join(".blabla/status.json")).ok(),
        status_bytes
    );
    assert_eq!(
        std::fs::read(root.join(".blabla/verifying.json")).ok(),
        marker_bytes
    );
}

fn start_marker(root: &Path, live: bool) {
    let project = load_project(root);
    runstate::write_marker(
        root,
        &runstate::Marker {
            run_id: "new-verification-after-eligibility".into(),
            pid: if live { std::process::id() } else { u32::MAX },
            started_unix: now_unix(),
            verifier_version: env!("CARGO_PKG_VERSION").into(),
            project_identity: project.identity.clone(),
            profile_identity: runstate::profile_identity(project.manifest.profile.as_ref()),
            profile: project.manifest.profile.clone(),
        },
    )
    .unwrap();
    let marker = runstate::read_marker(root).unwrap().unwrap();
    assert_eq!(
        runstate::classify(&marker, &project.identity, &marker.profile_identity, None),
        if live {
            runstate::Classification::Verifying
        } else {
            runstate::Classification::Interrupted
        }
    );
}

#[test]
fn bounded_close_refusal_child() {
    let Some(root) = std::env::var_os("BLABLA_BOUNDED_CLOSE_TEST_ROOT") else {
        return;
    };
    let project = load_project(Path::new(&root));
    let json = std::env::var("BLABLA_BOUNDED_CLOSE_TEST_JSON").unwrap() == "true";
    std::process::exit(close(
        &project,
        "work",
        "owner",
        "Current bounded result only",
        json,
    ));
}

fn refused_with(root: &Path, json: bool, expected: &str) {
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "cli::task::bounded::tests::bounded_close_refusal_child",
            "--nocapture",
        ])
        .env("BLABLA_BOUNDED_CLOSE_TEST_ROOT", root)
        .env("BLABLA_BOUNDED_CLOSE_TEST_JSON", json.to_string())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2), "{output:?}");
    if json {
        assert!(output.stderr.is_empty(), "{output:?}");
        let stdout = String::from_utf8(output.stdout).unwrap();
        let value: Value =
            serde_json::from_str(stdout.lines().find(|line| line.starts_with('{')).unwrap())
                .unwrap();
        assert_eq!(value["status"], "error");
        assert_eq!(value["category"], "task");
        assert_eq!(value["message"], expected);
    } else {
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(stderr.contains(expected), "{stderr}");
    }
}

#[test]
fn bounded_close_missing_record_preserves_ready_live_marker_and_hostile_root() {
    for (prefix, live) in [
        ("bounded-", false),
        ("bounded-", true),
        ("bounded-$HOME-`unused`-$(unused)-", false),
        ("bounded-$HOME-`unused`-$(unused)-", true),
    ] {
        let (_temp, project, name) = unverified_fixture(0, prefix);
        let root = &project.manifest.root;
        write(
            root,
            "app.py",
            &format!(
                "from pathlib import Path\nPath({}).touch()\nraise SystemExit(99)\n",
                serde_json::to_string(root.join(".blabla/verifier-called").to_str().unwrap())
                    .unwrap()
            ),
        );
        if live {
            start_marker(root, true);
        }
        let task_path = root.join(".blabla/tasks/work.json");
        let task_before = std::fs::read(&task_path).unwrap();
        let marker_before = std::fs::read(runstate::marker_path(root)).ok();
        let failure = std::fs::read(status::record_path(root)).unwrap_err();
        assert_eq!(failure.kind(), io::ErrorKind::NotFound);
        let expected = unread_record(&failure, root);
        assert_eq!(expected.matches(root.to_str().unwrap()).count(), 1);
        for json in [false, true] {
            refused_with(root, json, &expected);
            assert_eq!(std::fs::read(&task_path).unwrap(), task_before);
            assert!(!status::record_path(root).exists());
            assert_eq!(
                std::fs::read(runstate::marker_path(root)).ok(),
                marker_before
            );
            assert!(!root.join(".blabla/verifier-called").exists());
            let work = task::read(root, &name).unwrap().unwrap();
            assert_eq!(work.state, TaskState::Ready);
            assert!(work.result_basis.is_none());
        }
        assert_eq!(
            super::super::closing::close(&project, &name, "owner", false),
            2
        );
        assert_eq!(std::fs::read(&task_path).unwrap(), task_before);
    }
}

#[test]
fn bounded_close_preserves_distinct_record_errors() {
    let (_temp, project, _) = unverified_fixture(0, "bounded-");
    let root = &project.manifest.root;
    let task_path = root.join(".blabla/tasks/work.json");
    let task_before = std::fs::read(&task_path).unwrap();
    let record_path = status::record_path(root);
    write(root, ".blabla/status.json", "not JSON");
    let decode_failure = serde_json::from_slice::<status::Record>(b"not JSON").unwrap_err();
    for json in [false, true] {
        refused_with(root, json, &undecodable_record(&decode_failure));
        assert_eq!(std::fs::read(&record_path).unwrap(), b"not JSON");
        assert_eq!(std::fs::read(&task_path).unwrap(), task_before);
    }
    std::fs::remove_file(&record_path).unwrap();
    std::fs::create_dir(&record_path).unwrap();
    let read_failure = std::fs::read(&record_path).unwrap_err();
    assert_ne!(read_failure.kind(), io::ErrorKind::NotFound);
    for json in [false, true] {
        refused_with(root, json, &unread_record(&read_failure, root));
        assert!(record_path.is_dir());
        assert_eq!(std::fs::read(&task_path).unwrap(), task_before);
        assert!(!runstate::marker_path(root).exists());
    }
}

#[test]
fn bounded_checkpoint_noop_accepts_and_preserves_verification() {
    let (_temp, project, name) = fixture(0);
    let root = &project.manifest.root;
    let status = std::fs::read(root.join(".blabla/status.json")).unwrap();
    let mut reached = false;
    assert_eq!(
        close_with_checkpoint(
            &project,
            &name,
            "owner",
            "Current bounded result only",
            || reached = true
        ),
        0
    );
    assert!(reached);
    assert_eq!(
        task::read(root, &name).unwrap().unwrap().state,
        TaskState::Closed
    );
    assert_eq!(
        std::fs::read(root.join(".blabla/status.json")).unwrap(),
        status
    );
}

#[test]
fn bounded_checkpoint_rechecks_owned_input() {
    race(0, |root| write(root, "owned.txt", "later input\n"));
}

#[test]
fn bounded_checkpoint_rechecks_own_epoch() {
    race(0, |root| {
        rewrite(root, ".blabla/tasks/work.json", |v| {
            v["acceptance_epoch"] = json!(2)
        })
    });
}

#[test]
fn bounded_checkpoint_preserves_a_new_task_record() {
    race(0, |root| {
        rewrite(root, ".blabla/tasks/work.json", |v| {
            v["statement"] = json!("New owner instruction")
        })
    });
}

#[test]
fn bounded_checkpoint_rechecks_review_target_input() {
    race(1, |root| write(root, "owned.txt", "later target input\n"));
}

#[test]
fn bounded_checkpoint_rechecks_recursive_target_epoch() {
    race(2, |root| {
        rewrite(root, ".blabla/tasks/work.json", |v| {
            v["acceptance_epoch"] = json!(2)
        })
    });
}

#[test]
fn bounded_checkpoint_refuses_a_replaced_green_run() {
    race(0, |root| {
        rewrite(root, ".blabla/status.json", |v| {
            v["run_id"] = json!("another-green-run")
        })
    });
}

#[test]
fn bounded_checkpoint_refuses_a_new_red_record() {
    race(0, |root| {
        rewrite(root, ".blabla/status.json", |v| {
            v["report"]["status"] = json!("red")
        })
    });
}

#[test]
fn bounded_checkpoint_refuses_a_removed_record() {
    race(0, |root| {
        std::fs::remove_file(root.join(".blabla/status.json")).unwrap()
    });
}

#[test]
fn bounded_checkpoint_reloads_the_profile() {
    race(0, |root| {
        let text = std::fs::read_to_string(root.join("project.bla")).unwrap();
        write(root, "project.bla", &text.replace("seed 0", "seed 1"));
    });
}

#[test]
fn bounded_checkpoint_reloads_contract_identity() {
    race(0, |root| {
        let text = std::fs::read_to_string(root.join("behavior.bla")).unwrap();
        write(
            root,
            "behavior.bla",
            &text.replace("adds-one", "different-contract"),
        );
    });
}

#[test]
fn bounded_checkpoint_rechecks_the_verifier() {
    race(0, |root| {
        rewrite(root, ".blabla/status.json", |v| {
            v["verifier_version"] = json!("another-verifier")
        })
    });
}

#[test]
fn bounded_checkpoint_refuses_a_new_live_verification() {
    race(0, |root| start_marker(root, true));
}

#[test]
fn bounded_checkpoint_refuses_a_new_interrupted_verification() {
    race(0, |root| start_marker(root, false));
}

#[test]
fn bounded_checkpoint_rechecks_live_structure() {
    race(0, |root| write(root, "entry.rs", "pub fn renamed() {}\n"));
}

#[test]
fn bounded_checkpoint_rechecks_owner_policy() {
    race(0, |root| {
        let text = std::fs::read_to_string(root.join("process.bla")).unwrap();
        write(
            root,
            "process.bla",
            &text.replace("model \"owner\"", "model \"other-owner\""),
        );
    });
}
