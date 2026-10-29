use blabla::runtime::command;
use std::io::Write;
use std::process::Command;
use std::time::{Duration, Instant};

use crate::python_script;
use crate::source_cli;
use python_script::python;

fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    line.split_whitespace()
        .find_map(|token| token.strip_prefix(key)?.strip_prefix('='))
}

#[test]
fn real_command_returns_both_streams_and_original_exit() {
    let output = command::run(
        &mut python(
            "import sys; print('actual'); print('diagnostic',file=sys.stderr); sys.exit(7)",
        ),
        Instant::now() + Duration::from_secs(2),
        1024,
    )
    .unwrap();
    assert_eq!(output.status.code(), Some(7));
    assert_eq!(String::from_utf8(output.stdout).unwrap().trim(), "actual");
    assert_eq!(
        String::from_utf8(output.stderr).unwrap().trim(),
        "diagnostic"
    );
}

#[test]
fn final_combined_output_cannot_escape_the_cap() {
    let started = Instant::now();
    command::run(
        &mut python("import sys; sys.stdout.write('a'*700); sys.stderr.write('b'*700)"),
        started + Duration::from_secs(2),
        1024,
    )
    .unwrap_err();
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[test]
fn expired_deadline_never_launches_a_child() {
    let dir = tempfile::TempDir::new().unwrap();
    let marker = dir.path().join("marker");
    let script = format!(
        "from pathlib import Path; Path({:?}).write_text('ran')",
        marker.to_string_lossy()
    );
    command::run(&mut python(&script), Instant::now(), 1024).unwrap_err();
    assert!(!marker.exists());
}

#[test]
fn timeout_contains_descendants_before_returning() {
    let dir = tempfile::TempDir::new().unwrap();
    let marker = dir.path().join("late-child");
    let descendant = format!(
        "import time; from pathlib import Path; time.sleep(0.6); Path({:?}).write_text('escaped')",
        marker.to_string_lossy()
    );
    let script = format!(
        "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c', {descendant:?}]); time.sleep(5)"
    );
    let started = Instant::now();
    command::run(
        &mut python(&script),
        started + Duration::from_millis(200),
        1024,
    )
    .unwrap_err();
    assert!(started.elapsed() < Duration::from_secs(2));
    std::thread::sleep(Duration::from_millis(700));
    assert!(!marker.exists());
}

#[test]
fn successful_parent_exit_still_cleans_its_descendants() {
    let dir = tempfile::TempDir::new().unwrap();
    let marker = dir.path().join("late-child");
    let descendant = format!(
        "import time; from pathlib import Path; time.sleep(0.6); Path({:?}).write_text('escaped')",
        marker.to_string_lossy()
    );
    let script = format!(
        "import subprocess,sys; subprocess.Popen([sys.executable,'-c', {descendant:?}]); print('done')"
    );
    let output = command::run(
        &mut python(&script),
        Instant::now() + Duration::from_secs(2),
        1024,
    )
    .unwrap();
    assert!(output.status.success());
    std::thread::sleep(Duration::from_millis(700));
    assert!(!marker.exists());
}

use std::path::Path;

#[test]
fn ordinary_current_source_request_reuses_one_owned_artifact() {
    let campaign = source_cli::Campaign::new();
    let request = campaign.request(Instant::now() + blabla::runtime::MAX_TIMEOUT);
    let root = tempfile::TempDir::new().unwrap();
    let (exit, help) = request.invoke(root.path(), &["--help"], false).unwrap();
    assert_eq!(exit, 0);
    assert!(!help.as_str().unwrap().is_empty());
    let artifact = request
        .artifact_path()
        .expect("ordinary repository must support request-scoped reuse");
    assert!(!artifact.starts_with(Path::new(env!("CARGO_MANIFEST_DIR")).join("target")));
    let (exit, _) = request.invoke(root.path(), &["--version"], false).unwrap();
    assert_eq!(exit, 0);
    assert_eq!(request.artifact_path(), Some(artifact.clone()));
    request.finish().unwrap();
    drop(request);
    assert!(artifact.exists());
    let clone = campaign.clone();
    drop(campaign);
    let request = clone.request(Instant::now() + Duration::from_millis(4500));
    let (exit, _) = request.invoke(root.path(), &["--version"], false).unwrap();
    assert_eq!(exit, 0);
    assert_eq!(request.artifact_path(), Some(artifact.clone()));
    request.finish().unwrap();
    drop(request);
    let request = clone.request(Instant::now() + Duration::from_millis(4500));
    assert_eq!(
        request
            .invoke(root.path(), &["--version"], false)
            .unwrap()
            .0,
        0
    );
    let original = std::fs::read(&artifact).unwrap();
    let modified = std::fs::metadata(&artifact).unwrap().modified().unwrap();
    let mut changed = original.clone();
    changed[0] ^= 1;
    std::fs::write(&artifact, changed).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&artifact)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert!(
        request
            .invoke(root.path(), &["--version"], false)
            .unwrap_err()
            .contains(source_cli::ARTIFACT_CHANGED)
    );
    drop(request);
    std::fs::write(&artifact, original).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&artifact)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    let request = clone.request(Instant::now() + Duration::from_millis(4500));
    assert!(
        request
            .invoke(root.path(), &["--version"], false)
            .unwrap_err()
            .contains(source_cli::ARTIFACT_CHANGED)
    );
    drop(request);
    drop(clone);
    assert!(!artifact.exists());
}

use serde_json::json;

fn source() -> tempfile::TempDir {
    let dir = tempfile::TempDir::new().unwrap();
    std::fs::create_dir(dir.path().join("src")).unwrap();
    std::fs::write(
        dir.path().join("Cargo.toml"),
        "[package]\nname='blabla'\nversion='0.1.0'\n",
    )
    .unwrap();
    std::fs::write(dir.path().join("src/main.rs"), "fn main() {}\n").unwrap();
    std::fs::write(dir.path().join("binary"), "original artifact").unwrap();
    dir
}

fn artifact(root: &Path) -> serde_json::Value {
    json!({"reason":"compiler-artifact", "package_id":"path+file:///fixture#blabla@0.1.0", "manifest_path":root.join("Cargo.toml"), "target":{"name":"blabla","kind":["bin"],"src_path":root.join("src/main.rs")}, "executable":root.join("binary")})
}

fn records(values: &[serde_json::Value]) -> Vec<u8> {
    values
        .iter()
        .map(|v| format!("{v}\n"))
        .collect::<String>()
        .into_bytes()
}

#[test]
fn cargo_selection_requires_exact_binary_and_successful_completion() {
    let dir = source();
    let exact = artifact(dir.path());
    let done = json!({"reason":"build-finished","success":true});
    assert_eq!(
        source_cli::select_artifact(&records(&[exact.clone(), done.clone()]), dir.path()).unwrap(),
        Some(dir.path().join("binary").canonicalize().unwrap())
    );
    for bytes in [
        b"not JSON\n".to_vec(),
        records(std::slice::from_ref(&exact)),
        records(std::slice::from_ref(&done)),
        records(&[
            exact.clone(),
            json!({"reason":"build-finished","success":false}),
        ]),
        records(&[done.clone(), exact.clone()]),
    ] {
        assert!(source_cli::select_artifact(&bytes, dir.path()).is_err());
    }
    for field in ["executable", "manifest_path"] {
        let mut bad = exact.clone();
        bad[field] = serde_json::Value::Null;
        assert!(source_cli::select_artifact(&records(&[bad, done.clone()]), dir.path()).is_err());
    }
    let mut wrong = exact.clone();
    wrong["target"]["src_path"] = json!(dir.path().join("binary"));
    assert!(source_cli::select_artifact(&records(&[wrong, done.clone()]), dir.path()).is_err());
    std::fs::write(dir.path().join("other"), "different").unwrap();
    let mut conflict = exact.clone();
    conflict["executable"] = json!(dir.path().join("other"));
    assert!(source_cli::select_artifact(&records(&[exact, conflict, done]), dir.path()).is_err());
}

#[test]
fn local_dependency_or_dynamic_runtime_declines_artifact_reuse() {
    let dir = source();
    let dependency = source();
    let mut local = artifact(dependency.path());
    local["target"]["kind"] = json!(["lib"]);
    assert_eq!(
        source_cli::select_artifact(
            &records(&[
                local.clone(),
                artifact(dir.path()),
                json!({"reason":"build-finished","success":true})
            ]),
            dir.path()
        )
        .unwrap(),
        None
    );
    local["package_id"] = json!("registry+https://registry.example/#dependency@1.0");
    local["target"]["kind"] = json!(["dylib"]);
    assert_eq!(
        source_cli::select_artifact(
            &records(&[
                local,
                artifact(dir.path()),
                json!({"reason":"build-finished","success":true})
            ]),
            dir.path()
        )
        .unwrap(),
        None
    );
}

#[test]
fn inventory_tracks_embedded_bytes_additions_deletions_and_configuration() {
    let dir = source();
    let deadline = Instant::now() + Duration::from_secs(2);
    let baseline = source_cli::inventory(dir.path(), deadline).unwrap();
    let embedded = dir.path().join("src/help.md");
    std::fs::write(&embedded, "first").unwrap();
    let added = source_cli::inventory(dir.path(), deadline).unwrap();
    assert_ne!(baseline, added);
    std::fs::write(&embedded, "other").unwrap();
    assert_ne!(added, source_cli::inventory(dir.path(), deadline).unwrap());
    std::fs::remove_file(&embedded).unwrap();
    assert_eq!(
        baseline,
        source_cli::inventory(dir.path(), deadline).unwrap()
    );
    std::fs::create_dir(dir.path().join(".cargo")).unwrap();
    std::fs::write(
        dir.path().join(".cargo/config.toml"),
        "[build]\ntarget='unknown'\n",
    )
    .unwrap();
    assert!(!source_cli::configuration_allows_reuse(dir.path()));
    assert_ne!(
        baseline,
        source_cli::inventory(dir.path(), deadline).unwrap()
    );
}

#[test]
fn external_and_computed_embedded_inputs_decline_reuse() {
    let dir = source();
    let deadline = Instant::now() + Duration::from_secs(2);
    std::fs::write(dir.path().join("src/help.md"), "help").unwrap();
    for (rust, supported) in [
        ("const X: &str = include_str!(\"help.md\");", true),
        ("const X: &str = include_str!(\"../Cargo.toml\");", false),
        (
            "const X: &str = include_str!(concat!(env!(\"OUT_DIR\"),\"/generated\"));",
            false,
        ),
        ("#[path = \"../external.rs\"] mod external;", false),
        (
            "#[cfg_attr(unix, path = \"../external.rs\")] mod external;",
            false,
        ),
        (
            "#[cfg_attr(unix, cfg_attr(target_os = \"linux\", path = \"../external.rs\"))] mod external;",
            false,
        ),
    ] {
        std::fs::write(dir.path().join("src/main.rs"), rust).unwrap();
        let inventory = source_cli::inventory(dir.path(), deadline).unwrap();
        assert_eq!(
            source_cli::closed_inputs(&inventory, dir.path()),
            supported,
            "{rust}"
        );
    }
}

#[test]
fn owned_artifact_survives_original_replacement_and_honors_deadline() {
    let dir = source();
    let (owner, copy, _) = source_cli::owned_artifact(
        &dir.path().join("binary"),
        Instant::now() + Duration::from_secs(2),
    )
    .unwrap();
    std::fs::write(dir.path().join("binary"), "replacement").unwrap();
    assert_eq!(std::fs::read(&copy).unwrap(), b"original artifact");
    assert!(source_cli::owned_artifact(&dir.path().join("binary"), Instant::now()).is_err());
    drop(owner);
    assert!(!copy.exists());
}

#[test]
fn request_expiration_covers_acquisition_and_final_success() {
    let request = source_cli::Request::new(Instant::now());
    assert!(
        request
            .invoke(Path::new("."), &["--help"], false)
            .unwrap_err()
            .contains(source_cli::DEADLINE_EXPIRED)
    );
    assert!(
        request
            .finish()
            .unwrap_err()
            .contains(source_cli::DEADLINE_EXPIRED)
    );
}

fn locked_source() -> tempfile::TempDir {
    let dir = source();
    std::fs::write(
        dir.path().join("Cargo.lock"),
        "version = 4\n\n[[package]]\nname = \"blabla\"\nversion = \"0.1.0\"\n",
    )
    .unwrap();
    dir
}

#[test]
fn real_cargo_request_refuses_embedded_drift_before_another_child_or_success() {
    let dir = locked_source();
    std::fs::write(dir.path().join("src/help.md"), "first").unwrap();
    std::fs::write(dir.path().join("src/main.rs"), r#"fn main() { println!("{}", include_str!("help.md")); std::fs::write("ran", "once").unwrap(); }"#).unwrap();
    let campaign = source_cli::Campaign::from_source(dir.path().to_owned());
    let request = campaign.request(Instant::now() + blabla::runtime::MAX_TIMEOUT);
    assert_eq!(request.invoke(dir.path(), &[], false).unwrap().1, "first\n");
    let artifact = request.artifact_path().unwrap();
    std::fs::write(dir.path().join("ran"), "must remain").unwrap();
    std::fs::write(dir.path().join("src/help.md"), "other").unwrap();
    assert!(
        request
            .invoke(dir.path(), &[], false)
            .unwrap_err()
            .contains(source_cli::INPUTS_CHANGED)
    );
    assert!(
        request
            .finish()
            .unwrap_err()
            .contains(source_cli::INPUTS_CHANGED)
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("ran")).unwrap(),
        "must remain"
    );
    drop(request);
    std::fs::write(dir.path().join("src/help.md"), "first").unwrap();
    let request = campaign.request(Instant::now() + blabla::runtime::MAX_TIMEOUT);
    assert!(
        request
            .invoke(dir.path(), &[], false)
            .unwrap_err()
            .contains(source_cli::INPUTS_CHANGED)
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("ran")).unwrap(),
        "must remain"
    );
    drop(request);
    drop(campaign);
    assert!(!artifact.exists());
}

#[test]
fn native_dynamic_links_and_build_environment_decline_reuse() {
    let dir = source();
    for (libraries, environment) in [
        (json!(["dylib=custom"]), json!([])),
        (json!([]), json!([["CUSTOM_RUNTIME", "value"]])),
    ] {
        let script =
            json!({"reason":"build-script-executed", "linked_libs":libraries, "env":environment});
        assert_eq!(
            source_cli::select_artifact(
                &records(&[
                    script,
                    artifact(dir.path()),
                    json!({"reason":"build-finished","success":true})
                ]),
                dir.path()
            )
            .unwrap(),
            None
        );
    }
}

#[test]
fn output_failure_also_contains_descendants() {
    let dir = tempfile::TempDir::new().unwrap();
    let marker = dir.path().join("late-child");
    let descendant = format!(
        "import time; from pathlib import Path; time.sleep(0.6); Path({:?}).write_text('escaped')",
        marker.to_string_lossy()
    );
    let script = format!(
        "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c', {descendant:?}]); print('x'*4096,flush=True); time.sleep(5)"
    );
    command::run(
        &mut python(&script),
        Instant::now() + Duration::from_secs(2),
        1024,
    )
    .unwrap_err();
    std::thread::sleep(Duration::from_millis(700));
    assert!(!marker.exists());
}

#[test]
fn owned_large_artifact_preserves_the_actual_writer_stamp() {
    let dir = source();
    let binary = dir.path().join("binary");
    std::fs::write(&binary, vec![3; 4 * 1024 * 1024 + 1]).unwrap();
    let before = blabla::project::digest_of(dir.path(), "binary").unwrap();
    let (owner, copy, _) =
        source_cli::owned_artifact(&binary, Instant::now() + Duration::from_secs(2)).unwrap();
    let after =
        blabla::project::digest_of(owner.path(), copy.file_name().unwrap().to_str().unwrap())
            .unwrap();
    assert_eq!(before, after);
}

#[test]
fn changed_artifact_before_reverification_is_refused_even_with_same_size_and_mtime() {
    let dir = source();
    let binary = dir.path().join("binary");
    let deadline = Instant::now() + Duration::from_secs(2);
    let original = source_cli::artifact_identity(&binary, deadline).unwrap();
    let modified = std::fs::metadata(&binary).unwrap().modified().unwrap();
    let bytes = std::fs::read(&binary).unwrap();
    std::fs::write(&binary, vec![b'x'; bytes.len()]).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&binary)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert!(
        source_cli::verify_artifact(&binary, &original, deadline)
            .unwrap_err()
            .contains(source_cli::ARTIFACT_CHANGED)
    );
}

#[test]
fn cargo_environment_fallback_uses_platform_case_semantics() {
    for key in [
        "Rustflags",
        "Cargo_Target_X86_64_PC_WINDOWS_MSVC_Runner",
        "Cargo_Build_Target",
    ] {
        assert!(source_cli::environment_key_blocks_reuse(key, true));
        assert!(!source_cli::environment_key_blocks_reuse(key, false));
    }
    for key in [
        "RUSTFLAGS",
        "CARGO_TARGET_HOST_RUNNER",
        "CARGO_BUILD_TARGET",
    ] {
        assert!(source_cli::environment_key_blocks_reuse(key, false));
    }
    assert!(!source_cli::environment_key_blocks_reuse(
        "Cargo_Target_Dir",
        true
    ));
}

#[test]
fn original_cargo_fallback_honors_configuration_and_guards_observable_drift() {
    let dir = locked_source();
    std::fs::create_dir(dir.path().join(".cargo")).unwrap();
    let config = dir.path().join(".cargo/config.toml");
    std::fs::write(&config, "[env]\nSOURCE_CLI_CONTEXT='configured'\n").unwrap();
    std::fs::write(dir.path().join("src/main.rs"), r#"fn main() { println!("{}", std::env::var("SOURCE_CLI_CONTEXT").unwrap()); std::fs::write("ran", "once").unwrap(); }"#).unwrap();
    let campaign = source_cli::Campaign::from_source(dir.path().to_owned());
    let request = campaign.request(Instant::now() + blabla::runtime::MAX_TIMEOUT);
    assert_eq!(
        request.invoke(dir.path(), &[], false).unwrap().1,
        "configured\n"
    );
    assert!(request.artifact_path().is_none());
    request.finish().unwrap();
    drop(request);
    let request = campaign.request(Instant::now() + blabla::runtime::MAX_TIMEOUT);
    assert_eq!(
        request.invoke(dir.path(), &[], false).unwrap().1,
        "configured\n"
    );
    assert!(request.artifact_path().is_none());
    std::fs::write(dir.path().join("ran"), "must remain").unwrap();
    std::fs::write(&config, "[env]\nSOURCE_CLI_CONTEXT='changed'\n").unwrap();
    assert!(
        request
            .invoke(dir.path(), &[], false)
            .unwrap_err()
            .contains(source_cli::INPUTS_CHANGED)
    );
    assert!(
        request
            .finish()
            .unwrap_err()
            .contains(source_cli::INPUTS_CHANGED)
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("ran")).unwrap(),
        "must remain"
    );
}

fn diagnostic_subprocess(case: &str, enabled: bool) -> std::process::Output {
    let mut child = child_case(case);
    if enabled {
        child.env("BLABLA_SOURCE_CLI_DIAGNOSTICS", "1");
    } else {
        child.env_remove("BLABLA_SOURCE_CLI_DIAGNOSTICS");
    }
    finished(&mut child)
}

fn child_case(case: &str) -> Command {
    let mut child = Command::new(std::env::current_exe().unwrap());
    child
        .args([
            "--exact",
            &format!("{}::{case}", module_path!().trim_start_matches("it::")),
            "--nocapture",
        ])
        .env("SOURCE_CLI_DIAGNOSTIC_TEST_CHILD", "1");
    child
}

fn finished(child: &mut Command) -> std::process::Output {
    let output = command::run(
        child,
        Instant::now() + Duration::from_secs(12),
        2 * 1024 * 1024,
    )
    .unwrap();
    assert!(
        output.status.success(),
        "stdout={}\nstderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

#[test]
fn diagnostics_keep_json_exit_and_provenance_with_no_payload_or_argv() {
    for enabled in [false, true] {
        let output = diagnostic_subprocess("diagnostic_request_child", enabled);
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(
            !String::from_utf8(output.stdout)
                .unwrap()
                .contains("source-cli-diagnostic")
        );
        for secret in [
            "private-argument",
            "private-output",
            "private-stderr",
            "private-root",
        ] {
            assert!(!stderr.contains(secret), "{stderr}");
        }
        let lines: Vec<_> = stderr
            .lines()
            .filter(|line| line.starts_with("source-cli-diagnostic "))
            .collect();
        if !enabled {
            assert!(lines.is_empty(), "{stderr}");
            continue;
        }
        assert!(!lines.is_empty());
        assert!(lines.len() < 256);
        assert!(lines.iter().all(|line| line.len() < 4096));
        assert!(lines.iter().any(|line| {
            field(line, "process") == Some("Diagnostics")
                && ["ExitWaiter", "StdoutReader", "StderrReader"]
                    .iter()
                    .all(|name| line.contains(name))
        }));
        assert!(
            lines
                .iter()
                .any(|line| field(line, "stage") == Some("\"first-provenance-process\""))
        );
        assert!(
            lines
                .iter()
                .any(|line| field(line, "stage") == Some("\"second-provenance-process\""))
        );
        assert!(lines.iter().any(|line| {
            field(line, "invocation") == Some("1") && field(line, "fixture") == Some("1")
        }));
        assert!(lines.iter().any(|line| {
            field(line, "invocation") == Some("2") && field(line, "fixture") == Some("2")
        }));
        assert!(lines.iter().any(|line| {
            field(line, "invocation") == Some("3")
                && field(line, "fixture") == Some("1")
                && field(line, "succeeded") == Some("false")
        }));
        assert!(lines.iter().all(|line| {
            field(line, "caller")
                .is_some_and(|caller| caller.starts_with("source_cli_transport.rs:"))
                && field(line, "elapsed_us").is_some()
                && field(line, "remaining_us").is_some()
        }));
    }
}

#[test]
fn diagnostic_request_child() {
    if std::env::var_os("SOURCE_CLI_DIAGNOSTIC_TEST_CHILD").is_none() {
        return;
    }
    let dir = locked_source();
    std::fs::write(dir.path().join("src/main.rs"), r#"fn main() { println!("{{\"payload\":\"private-output\"}}"); eprintln!("private-stderr"); std::process::exit(7); }"#).unwrap();
    let root = dir.path().join("private-root");
    std::fs::create_dir(&root).unwrap();
    let campaign = source_cli::Campaign::from_source(dir.path().to_owned());
    let request = campaign.request(Instant::now() + blabla::runtime::MAX_TIMEOUT);
    for root in [&root, &dir.path().to_owned()] {
        let (exit, value) = request.invoke(root, &["private-argument"], true).unwrap();
        assert_eq!(exit, 7);
        assert_eq!(value, json!({"payload":"private-output"}));
    }
    request.finish().unwrap();
    let artifact = request.artifact_path().unwrap();
    std::fs::write(dir.path().join("src/main.rs"), "fn main() {}\n").unwrap();
    assert!(
        request
            .invoke(&root, &["private-argument"], true)
            .unwrap_err()
            .contains(source_cli::INPUTS_CHANGED)
    );
    assert!(
        request
            .finish()
            .unwrap_err()
            .contains(source_cli::INPUTS_CHANGED)
    );
    drop(request);
    drop(campaign);
    assert!(!artifact.exists());
    await_diagnostic_delivery();
}

#[test]
fn expired_request_traces_are_capped_and_do_not_launch() {
    let output = diagnostic_subprocess("diagnostic_expired_child", true);
    let stderr = String::from_utf8(output.stderr).unwrap();
    let lines: Vec<_> = stderr
        .lines()
        .filter(|line| line.starts_with("source-cli-diagnostic "))
        .collect();
    assert!(!lines.is_empty());
    assert!(lines.len() <= 256);
    assert!(
        lines
            .iter()
            .all(|line| line.len() < 4096 && field(line, "remaining_us") == Some("0"))
    );
    assert!(!stderr.contains("private-argument"));
    assert!(!stderr.contains("private-root"));
    assert!(
        !stderr
            .lines()
            .any(|line| field(line, "process") == Some("Diagnostics"))
    );
}

#[test]
fn diagnostic_expired_child() {
    if std::env::var_os("SOURCE_CLI_DIAGNOSTIC_TEST_CHILD").is_none() {
        return;
    }
    let request = source_cli::Request::new(Instant::now());
    for _ in 0..300 {
        assert!(
            request
                .invoke(Path::new("private-root"), &["private-argument"], true)
                .unwrap_err()
                .contains(source_cli::DEADLINE_EXPIRED)
        );
    }
    assert!(
        request
            .finish()
            .unwrap_err()
            .contains(source_cli::DEADLINE_EXPIRED)
    );
    assert!(request.artifact_path().is_none());
    assert_eq!(source_cli::diagnostic_publication().attempted, 256);
    await_diagnostic_delivery();
}

fn await_diagnostic_delivery() {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let publication = source_cli::diagnostic_publication();
        if publication.written + publication.dropped == publication.attempted {
            return;
        }
        assert!(Instant::now() < deadline, "{publication:?}");
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[test]
fn stalled_diagnostic_sink_does_not_block_requests_or_grow_writers() {
    let output = diagnostic_subprocess("diagnostic_stalled_sink_child", true);
    let stderr = String::from_utf8(output.stderr).unwrap();
    let lines: Vec<_> = stderr
        .lines()
        .filter(|line| line.starts_with("source-cli-diagnostic "))
        .collect();
    assert!(!lines.is_empty());
    assert!(lines.iter().all(|line| {
        field(line, "telemetry") == Some("best-effort")
            && field(line, "missing") == Some("not-evidence")
    }));
    assert!(
        lines
            .iter()
            .any(|line| field(line, "dropped_at_least") != Some("0"))
    );
}

#[test]
fn diagnostic_stalled_sink_child() {
    if std::env::var_os("SOURCE_CLI_DIAGNOSTIC_TEST_CHILD").is_none() {
        return;
    }
    let (locked, acquired) = std::sync::mpsc::channel();
    let (release, released) = std::sync::mpsc::channel();
    let holder = std::thread::spawn(move || {
        let stderr = std::io::stderr();
        let _guard = stderr.lock();
        locked.send(()).unwrap();
        released.recv().unwrap();
    });
    acquired.recv_timeout(Duration::from_secs(2)).unwrap();
    let started = Instant::now();
    let requests: Vec<_> = (0..8)
        .map(|_| {
            std::thread::spawn(|| {
                for _ in 0..16 {
                    let request = source_cli::Request::new(Instant::now());
                    assert!(
                        request
                            .invoke(Path::new("private-root"), &["private-argument"], true)
                            .unwrap_err()
                            .contains(source_cli::DEADLINE_EXPIRED)
                    );
                    assert!(
                        request
                            .finish()
                            .unwrap_err()
                            .contains(source_cli::DEADLINE_EXPIRED)
                    );
                }
            })
        })
        .collect();
    for request in requests {
        request.join().unwrap();
    }
    assert!(started.elapsed() < Duration::from_secs(2));

    let dir = locked_source();
    std::fs::write(
        dir.path().join("src/main.rs"),
        r#"fn main() { println!("{{\"value\":7}}"); std::process::exit(7); }"#,
    )
    .unwrap();
    let request = source_cli::Request::from_source(
        dir.path().to_owned(),
        Instant::now() + blabla::runtime::MAX_TIMEOUT,
    );
    assert_eq!(
        request.invoke(dir.path(), &[], true).unwrap(),
        (7, json!({"value":7}))
    );
    request.finish().unwrap();
    let publication = source_cli::diagnostic_publication();
    assert_eq!(publication.written, 0);
    assert_eq!(publication.writers_started, 1);
    assert!(publication.dropped > 0);
    assert!(publication.attempted - publication.dropped <= publication.queue_capacity as u64 + 1);

    release.send(()).unwrap();
    holder.join().unwrap();
    await_diagnostic_delivery();
    let expired = source_cli::Request::new(Instant::now());
    assert!(
        expired
            .invoke(dir.path(), &[], false)
            .unwrap_err()
            .contains(source_cli::DEADLINE_EXPIRED)
    );
    await_diagnostic_delivery();
    assert_eq!(source_cli::diagnostic_publication().writers_started, 1);
}

fn scoped_source() -> tempfile::TempDir {
    let source = locked_source();
    std::fs::write(source.path().join("src/help.md"), "original").unwrap();
    std::fs::write(
        source.path().join("src/main.rs"),
        r#"use std::sync::atomic::{AtomicUsize, Ordering};
static MEMORY: AtomicUsize = AtomicUsize::new(0);
fn main() {
    let args: Vec<_> = std::env::args().collect();
    if args.iter().any(|arg| arg == "refuse") { std::process::exit(2); }
    let root = std::path::Path::new(&args[2]);
    let count = root.join("count");
    let writes = std::fs::read_to_string(&count).unwrap_or_default().parse::<usize>().unwrap_or(0) + 1;
    std::fs::write(count, writes.to_string()).unwrap();
    println!("{{\"writes\":{},\"memory\":{},\"embedded\":{:?}}}", writes, MEMORY.fetch_add(1, Ordering::Relaxed), include_str!("help.md"));
}
"#,
    )
    .unwrap();
    source
}

fn scope_request(campaign: &source_cli::Campaign) -> source_cli::Request {
    campaign.request(Instant::now() + blabla::runtime::MAX_TIMEOUT)
}

fn scope_write(request: &source_cli::Request, root: &Path, writes: usize) -> std::path::PathBuf {
    let (exit, value) = request.invoke(root, &[], true).unwrap();
    assert_eq!(exit, 0);
    assert_eq!(
        value,
        json!({"writes": writes, "memory": 0, "embedded": "original"})
    );
    request.finish().unwrap();
    request.artifact_path().unwrap()
}

fn scope_refusal(request: &source_cli::Request, root: &Path) -> String {
    request.invoke(root, &[], true).unwrap_err()
}

fn scope_writes(root: &Path) -> String {
    std::fs::read_to_string(root.join("count")).unwrap()
}

fn deadline() -> Instant {
    Instant::now() + blabla::runtime::MAX_TIMEOUT
}

fn cached_write(source: &Path, root: &Path, writes: usize) -> std::path::PathBuf {
    let scope = source_cli::ImageScope::cached(source.to_owned());
    scope_write(&scope_request(&scope.campaign()), root, writes)
}

fn cache_directory(source: &Path) -> std::path::PathBuf {
    source.join("target").join("source-cli")
}

fn cache_entries(source: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(cache_directory(source))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn tamper_keeping_size_and_time(path: &Path) {
    let modified = std::fs::metadata(path).unwrap().modified().unwrap();
    let mut bytes = std::fs::read(path).unwrap();
    bytes[0] ^= 1;
    std::fs::write(path, bytes).unwrap();
    std::fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
}

#[test]
fn a_second_cached_scope_reuses_the_cli_without_another_build() {
    let source = scoped_source();
    let root = tempfile::TempDir::new().unwrap();
    let image = cached_write(source.path(), root.path(), 1);
    let built = source_cli::provenance_builds();
    assert!(image.exists());
    assert_eq!(cached_write(source.path(), root.path(), 2), image);
    assert_eq!(source_cli::provenance_builds(), built);
    assert_eq!(cache_entries(source.path()).len(), 1);
}

#[test]
fn a_cache_key_follows_the_build_environment_and_the_configuration() {
    let source = scoped_source();
    let inputs = source_cli::inventory(source.path(), deadline()).unwrap();
    let environment: std::collections::BTreeMap<_, _> = std::env::vars_os().collect();
    let key = source_cli::cache_key(&inputs, &environment);
    assert_eq!(source_cli::cache_key(&inputs, &environment), key);
    let mut changed = environment.clone();
    changed.insert("BLABLA_CACHE_PROBE".into(), "changed".into());
    assert_ne!(source_cli::cache_key(&inputs, &changed), key);
    std::fs::create_dir(source.path().join(".cargo")).unwrap();
    std::fs::write(source.path().join(".cargo/config.toml"), "[env]\n").unwrap();
    let configured = source_cli::inventory(source.path(), deadline()).unwrap();
    assert_ne!(source_cli::cache_key(&configured, &environment), key);
}

#[test]
fn concurrent_first_acquisitions_publish_one_entry_and_keep_other_work_in_flight() {
    let source = scoped_source();
    let cache = cache_directory(source.path());
    std::fs::create_dir_all(cache.join("stale")).unwrap();
    std::fs::create_dir_all(cache.join(".in-flight")).unwrap();
    let images: Vec<std::path::PathBuf> = std::thread::scope(|threads| {
        let acquisitions: Vec<_> = (0..2)
            .map(|_| {
                threads.spawn(|| {
                    let root = tempfile::TempDir::new().unwrap();
                    cached_write(source.path(), root.path(), 1)
                })
            })
            .collect();
        acquisitions
            .into_iter()
            .map(|acquisition| acquisition.join().unwrap())
            .collect()
    });
    assert_eq!(images[0], images[1]);
    let entries = cache_entries(source.path());
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0], ".in-flight");
    assert!(images[0].starts_with(cache.join(&entries[1])));
}

#[test]
fn identical_images_published_under_two_environments_share_one_file() {
    let source = scoped_source();
    let root = tempfile::TempDir::new().unwrap();
    let first = cached_write(source.path(), root.path(), 1);
    let mut child = child_case("shared_image_child");
    child.env("SOURCE_CLI_SHARED_IMAGE_SOURCE", source.path());
    finished(&mut child);
    let cache = cache_directory(source.path());
    let entries: Vec<std::path::PathBuf> = cache_entries(source.path())
        .into_iter()
        .filter(|name| !name.starts_with('.'))
        .map(|name| cache.join(name))
        .collect();
    assert_eq!(entries.len(), 2);
    let second = entries
        .iter()
        .find(|entry| !first.starts_with(entry))
        .unwrap()
        .join(first.file_name().unwrap());
    let before = std::fs::metadata(&second).unwrap().len();
    std::fs::OpenOptions::new()
        .append(true)
        .open(&first)
        .unwrap()
        .write_all(&[0])
        .unwrap();
    assert_eq!(std::fs::metadata(&second).unwrap().len(), before + 1);
}

#[test]
fn shared_image_child() {
    let Some(source) = std::env::var_os("SOURCE_CLI_SHARED_IMAGE_SOURCE") else {
        return;
    };
    let root = tempfile::TempDir::new().unwrap();
    cached_write(Path::new(&source), root.path(), 1);
}

#[test]
fn a_cached_scope_refuses_an_input_changed_between_calls() {
    let source = scoped_source();
    let root = tempfile::TempDir::new().unwrap();
    let scope = source_cli::ImageScope::cached(source.path().to_owned());
    let campaign = scope.campaign();
    let request = scope_request(&campaign);
    assert_eq!(
        request.invoke(root.path(), &[], true).unwrap().1["writes"],
        1
    );
    std::fs::write(source.path().join("src/help.md"), "changed").unwrap();
    assert!(scope_refusal(&request, root.path()).contains(source_cli::INPUTS_CHANGED));
    assert_eq!(scope_writes(root.path()), "1");
}

#[test]
fn a_cached_scope_checks_the_cli_content_when_the_case_ends() {
    let source = scoped_source();
    let root = tempfile::TempDir::new().unwrap();
    let scope = source_cli::ImageScope::cached(source.path().to_owned());
    let campaign = scope.campaign();
    let image = scope_write(&scope_request(&campaign), root.path(), 1);
    assert_eq!(scope.verify_content(deadline()), Ok(()));
    tamper_keeping_size_and_time(&image);
    assert!(
        scope
            .verify_content(deadline())
            .unwrap_err()
            .contains(source_cli::ARTIFACT_CHANGED)
    );
}

#[test]
fn a_cached_cli_changed_between_scopes_is_refused_on_reuse() {
    let source = scoped_source();
    let root = tempfile::TempDir::new().unwrap();
    let image = cached_write(source.path(), root.path(), 1);
    tamper_keeping_size_and_time(&image);
    let scope = source_cli::ImageScope::cached(source.path().to_owned());
    let request = scope_request(&scope.campaign());
    assert!(scope_refusal(&request, root.path()).contains(source_cli::ARTIFACT_CHANGED));
    assert_eq!(scope_writes(root.path()), "1");
}

#[test]
fn explicit_artifact_parent_keeps_scope_and_borrower_isolation() {
    let source = scoped_source();
    let before =
        source_cli::inventory(source.path(), Instant::now() + blabla::runtime::MAX_TIMEOUT)
            .unwrap();
    let parent = tempfile::TempDir::new().unwrap();
    let sentinel = parent.path().join("unrelated");
    std::fs::write(&sentinel, b"parent and sibling survive").unwrap();
    let scope = source_cli::ImageScope::with_artifact_parent(
        source.path().to_owned(),
        parent.path().to_owned(),
    );
    let independent = source_cli::ImageScope::with_artifact_parent(
        source.path().to_owned(),
        parent.path().to_owned(),
    );
    let first = scope.campaign();
    let sibling = scope.campaign();
    let second = independent.campaign();
    let a = tempfile::TempDir::new().unwrap();
    let b = tempfile::TempDir::new().unwrap();
    let unused = scope_request(&first);
    unused.finish().unwrap();
    assert!(unused.artifact_path().is_none());
    assert_eq!(std::fs::read_dir(parent.path()).unwrap().count(), 1);
    drop(unused);
    let last = scope_request(&first);
    let image = scope_write(&last, a.path(), 1);
    let other = scope_write(&scope_request(&second), b.path(), 1);
    assert!(image.starts_with(parent.path()));
    assert!(other.starts_with(parent.path()));
    assert_ne!(image.parent(), other.parent());
    assert!(!image.starts_with(a.path()) && !other.starts_with(b.path()));
    assert_eq!(scope_write(&scope_request(&sibling), b.path(), 2), image);
    assert_eq!(
        source_cli::artifact_identity(&image, Instant::now() + blabla::runtime::MAX_TIMEOUT)
            .unwrap(),
        source_cli::artifact_identity(&other, Instant::now() + blabla::runtime::MAX_TIMEOUT)
            .unwrap()
    );
    assert_eq!(
        std::fs::metadata(&image).unwrap().permissions(),
        std::fs::metadata(&other).unwrap().permissions()
    );
    drop(scope);
    drop(first);
    drop(sibling);
    assert!(image.exists() && other.exists());
    last.finish().unwrap();
    drop(last);
    assert!(!image.exists() && other.exists());
    assert!(!image.parent().unwrap().exists());
    drop(independent);
    assert!(other.exists());
    drop(second);
    assert!(!other.parent().unwrap().exists());
    assert!(parent.path().is_dir());
    assert_eq!(std::fs::read_dir(parent.path()).unwrap().count(), 1);
    assert_eq!(
        std::fs::read(&sentinel).unwrap(),
        b"parent and sibling survive"
    );
    assert_eq!(
        source_cli::inventory(source.path(), Instant::now() + blabla::runtime::MAX_TIMEOUT)
            .unwrap(),
        before
    );
    assert_eq!(
        std::fs::read_to_string(a.path().join("count")).unwrap(),
        "1"
    );
    assert_eq!(
        std::fs::read_to_string(b.path().join("count")).unwrap(),
        "2"
    );
}

#[test]
fn explicit_artifact_parent_failure_never_falls_back_or_changes_inputs() {
    let source = scoped_source();
    let before =
        source_cli::inventory(source.path(), Instant::now() + blabla::runtime::MAX_TIMEOUT)
            .unwrap();
    let enclosure = tempfile::TempDir::new().unwrap();
    let absent = enclosure.path().join("absent");
    let file = enclosure.path().join("not-a-directory");
    std::fs::write(&file, b"unchanged sibling").unwrap();
    let root = tempfile::TempDir::new().unwrap();
    for parent in [absent.clone(), file.clone(), Path::new(".").to_owned()] {
        let relative = !parent.is_absolute();
        let scope = source_cli::ImageScope::with_artifact_parent(source.path().to_owned(), parent);
        let expired = scope.campaign().request(Instant::now());
        assert!(scope_refusal(&expired, root.path()).contains(source_cli::DEADLINE_EXPIRED));
        assert!(expired.artifact_path().is_none());
        let failed = scope.campaign();
        let request = scope_request(&failed);
        let error = request.invoke(root.path(), &[], true).unwrap_err();
        assert!(error.contains(source_cli::OWNED_COPY_STAGE), "{error}");
        assert_eq!(
            error.contains(source_cli::ARTIFACT_PARENT_RELATIVE),
            relative
        );
        assert!(request.artifact_path().is_none());
        assert!(!root.path().join("count").exists());
        assert_eq!(request.invoke(root.path(), &[], true).unwrap_err(), error);
        assert!(!absent.exists());
        assert_eq!(std::fs::read(&file).unwrap(), b"unchanged sibling");
        assert_eq!(std::fs::read_dir(enclosure.path()).unwrap().count(), 1);
    }
    let healthy = source_cli::ImageScope::with_artifact_parent(
        source.path().to_owned(),
        enclosure.path().to_owned(),
    );
    let campaign = healthy.campaign();
    let image = scope_write(&scope_request(&campaign), root.path(), 1);
    assert!(image.starts_with(enclosure.path()));
    drop(healthy);
    drop(campaign);
    assert!(!image.exists());
    assert_eq!(std::fs::read_dir(enclosure.path()).unwrap().count(), 1);
    assert_eq!(std::fs::read(&file).unwrap(), b"unchanged sibling");
    assert_eq!(
        source_cli::inventory(source.path(), Instant::now() + blabla::runtime::MAX_TIMEOUT)
            .unwrap(),
        before
    );
}

#[test]
fn image_scope_is_lazy_and_shares_only_the_image_across_roots_and_processes() {
    let source = scoped_source();
    let scope = source_cli::ImageScope::from_source(source.path().to_owned());
    let first = scope.campaign();
    let second = scope.campaign();
    let a = tempfile::TempDir::new().unwrap();
    let b = tempfile::TempDir::new().unwrap();
    let unused = scope_request(&first);
    unused.finish().unwrap();
    assert!(unused.artifact_path().is_none());
    assert!(!a.path().join("count").exists());
    drop(unused);

    let image = scope_write(&scope_request(&first), a.path(), 1);
    assert_eq!(scope_write(&scope_request(&second), b.path(), 1), image);
    assert_eq!(scope_write(&scope_request(&second), a.path(), 2), image);
    let refusal = scope_request(&first);
    assert_eq!(refusal.invoke(a.path(), &["refuse"], false).unwrap().0, 2);
    refusal.finish().unwrap();
    assert_eq!(
        std::fs::read_to_string(a.path().join("count")).unwrap(),
        "2"
    );
    drop(refusal);

    let independent = source_cli::ImageScope::from_source(source.path().to_owned());
    let other = independent.campaign();
    let other_image = scope_write(&scope_request(&other), a.path(), 3);
    assert_ne!(image, other_image);
    drop(independent);
    assert!(other_image.exists());
    drop(other);
    assert!(!other_image.exists());

    let last = scope_request(&second);
    assert_eq!(scope_write(&last, b.path(), 2), image);
    drop(scope);
    drop(first);
    drop(second);
    assert!(image.exists());
    last.finish().unwrap();
    drop(last);
    assert!(!image.exists());
}

#[test]
fn image_scope_source_and_configuration_drift_are_sticky_only_for_the_observer() {
    let source = scoped_source();
    let scope = source_cli::ImageScope::from_source(source.path().to_owned());
    let root = tempfile::TempDir::new().unwrap();
    let unaffected = scope.campaign();
    let image = scope_write(&scope_request(&unaffected), root.path(), 1);
    let mut writes = 1;
    for configuration in [false, true] {
        let observer = scope.campaign();
        let request = scope_request(&observer);
        writes += 1;
        assert_eq!(scope_write(&request, root.path(), writes), image);
        let path = source.path().join(if configuration {
            ".cargo/config.toml"
        } else {
            "src/help.md"
        });
        if configuration {
            std::fs::create_dir(source.path().join(".cargo")).unwrap();
        }
        std::fs::write(
            &path,
            if configuration {
                "[env]\nSCOPE_DRIFT='changed'\n"
            } else {
                "changed"
            },
        )
        .unwrap();
        let failure = request.finish().unwrap_err();
        assert!(
            failure.contains(source_cli::INPUTS_CHANGED)
                || failure.contains(source_cli::CONFIGURATION_CHANGED),
            "{failure}"
        );
        assert!(!scope_refusal(&request, root.path()).is_empty());
        assert!(!scope_refusal(&scope_request(&scope.campaign()), root.path()).is_empty());
        assert_eq!(scope_writes(root.path()), writes.to_string());
        if configuration {
            std::fs::remove_dir_all(source.path().join(".cargo")).unwrap();
        } else {
            std::fs::write(&path, "original").unwrap();
        }
        assert!(!scope_refusal(&scope_request(&observer.clone()), root.path()).is_empty());
        writes += 1;
        assert_eq!(
            scope_write(&scope_request(&unaffected), root.path(), writes),
            image
        );
        writes += 1;
        assert_eq!(
            scope_write(&scope_request(&scope.campaign()), root.path(), writes),
            image
        );
    }
}

#[test]
fn image_scope_integrity_quarantine_survives_restoration_for_existing_and_new_borrowers() {
    for damage in ["same-stamp tamper", "missing", "unreadable"] {
        let source = scoped_source();
        let scope = source_cli::ImageScope::from_source(source.path().to_owned());
        let root = tempfile::TempDir::new().unwrap();
        let first = scope.campaign();
        let existing = scope.campaign();
        let detecting = scope_request(&first);
        let image = scope_write(&detecting, root.path(), 1);
        let already_verified = scope_request(&existing);
        assert_eq!(scope_write(&already_verified, root.path(), 2), image);
        let bytes = std::fs::read(&image).unwrap();
        let metadata = std::fs::metadata(&image).unwrap();
        let modified = metadata.modified().unwrap();
        if damage != "same-stamp tamper" {
            std::fs::remove_file(&image).unwrap();
            if damage == "unreadable" {
                std::fs::create_dir(&image).unwrap();
            }
        } else {
            let mut changed = bytes.clone();
            changed[0] ^= 1;
            std::fs::write(&image, changed).unwrap();
            std::fs::File::options()
                .write(true)
                .open(&image)
                .unwrap()
                .set_times(std::fs::FileTimes::new().set_modified(modified))
                .unwrap();
        }
        assert!(detecting.finish().is_err(), "{damage}");
        if damage == "unreadable" {
            std::fs::remove_dir(&image).unwrap();
        }
        std::fs::write(&image, bytes).unwrap();
        std::fs::set_permissions(&image, metadata.permissions()).unwrap();
        std::fs::File::options()
            .write(true)
            .open(&image)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        assert!(already_verified.finish().is_err());
        for borrower in [first.clone(), existing.clone(), scope.campaign()] {
            let request = scope_request(&borrower);
            assert!(!scope_refusal(&request, root.path()).is_empty());
            assert_eq!(scope_writes(root.path()), "2");
        }
    }
}

#[test]
fn image_scope_expired_borrower_does_not_quarantine_a_verified_image() {
    let source = scoped_source();
    let scope = source_cli::ImageScope::from_source(source.path().to_owned());
    let root = tempfile::TempDir::new().unwrap();
    let expired = scope.campaign();
    let before = expired.request(Instant::now());
    assert!(scope_refusal(&before, root.path()).contains(source_cli::DEADLINE_EXPIRED));
    assert!(before.artifact_path().is_none());
    assert!(!root.path().join("count").exists());
    let healthy = scope.campaign();
    let image = scope_write(&scope_request(&healthy), root.path(), 1);
    let request = expired.request(Instant::now());
    assert!(scope_refusal(&request, root.path()).contains(source_cli::DEADLINE_EXPIRED));
    assert!(
        request
            .finish()
            .unwrap_err()
            .contains(source_cli::DEADLINE_EXPIRED)
    );
    assert_eq!(
        scope_write(&scope_request(&scope.campaign()), root.path(), 2),
        image
    );
    assert_eq!(scope_write(&scope_request(&healthy), root.path(), 3), image);
}

#[test]
fn image_scope_cargo_fallback_remains_local_and_does_not_prevent_later_acquisition() {
    let source = scoped_source();
    std::fs::create_dir(source.path().join(".cargo")).unwrap();
    std::fs::write(
        source.path().join(".cargo/config.toml"),
        "[env]\nSCOPE_FALLBACK='configured'\n",
    )
    .unwrap();
    let scope = source_cli::ImageScope::from_source(source.path().to_owned());
    let fallback = scope.campaign();
    let root = tempfile::TempDir::new().unwrap();
    let request = scope_request(&fallback);
    assert_eq!(
        request.invoke(root.path(), &[], true).unwrap().1["writes"],
        1
    );
    assert!(request.artifact_path().is_none());
    request.finish().unwrap();
    std::fs::remove_dir_all(source.path().join(".cargo")).unwrap();
    assert!(
        request
            .finish()
            .unwrap_err()
            .contains(source_cli::INPUTS_CHANGED)
    );
    let image = scope_write(&scope_request(&scope.campaign()), root.path(), 2);
    assert!(!scope_refusal(&scope_request(&fallback), root.path()).is_empty());
    assert_eq!(
        scope_write(&scope_request(&scope.campaign()), root.path(), 3),
        image
    );
}

#[test]
fn image_scope_failed_acquisition_is_not_a_shared_failure_or_a_new_baseline() {
    let source = scoped_source();
    let main = source.path().join("src/main.rs");
    let original = std::fs::read(&main).unwrap();
    std::fs::write(
        &main,
        "compile_error!(\"deliberate acquisition failure\"); fn main() {}\n",
    )
    .unwrap();
    let scope = source_cli::ImageScope::from_source(source.path().to_owned());
    let failed = scope.campaign();
    let root = tempfile::TempDir::new().unwrap();
    let request = scope_request(&failed);
    assert!(scope_refusal(&request, root.path()).contains(source_cli::BUILD_FAILED));
    assert!(request.artifact_path().is_none());
    assert!(!root.path().join("count").exists());
    std::fs::write(&main, original).unwrap();
    scope_write(&scope_request(&scope.campaign()), root.path(), 1);
    assert!(!scope_refusal(&scope_request(&failed), root.path()).is_empty());
    assert_eq!(scope_writes(root.path()), "1");
}

#[test]
fn image_scope_borrowers_do_not_follow_replacement_of_the_original_cargo_output() {
    let source = scoped_source();
    let scope = source_cli::ImageScope::from_source(source.path().to_owned());
    let root = tempfile::TempDir::new().unwrap();
    let first = scope.campaign();
    let image = scope_write(&scope_request(&first), root.path(), 1);
    let output = command::run(
        source_cli::cargo()
            .args([
                "build",
                "--locked",
                "--bin",
                "blabla",
                "--message-format=json",
                "--manifest-path",
            ])
            .arg(source.path().join("Cargo.toml"))
            .current_dir(source.path()),
        Instant::now() + blabla::runtime::MAX_TIMEOUT,
        2 * 1024 * 1024,
    )
    .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let original = source_cli::select_artifact(&output.stdout, source.path())
        .unwrap()
        .unwrap();
    assert_ne!(image, original);
    let bytes = std::fs::read(&original).unwrap();
    let metadata = std::fs::metadata(&original).unwrap();
    std::fs::write(&original, "replacement, not the verified executable").unwrap();
    let second = scope.campaign();
    let request = scope_request(&second);
    let result = request.invoke(root.path(), &[], true);
    let finished = request.finish();
    std::fs::write(&original, &bytes).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&original)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(metadata.modified().unwrap()))
        .unwrap();
    assert_eq!(result.unwrap().1["writes"], 2);
    finished.unwrap();
    assert_eq!(request.artifact_path(), Some(image.clone()));
    assert_eq!(std::fs::read(&image).unwrap(), bytes);
    assert_eq!(scope_write(&scope_request(&first), root.path(), 3), image);
}
