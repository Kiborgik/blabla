use blabla::runtime::command;
use std::process::Command;
use std::time::{Duration, Instant};

fn python(script: &str) -> Command {
    let mut command = Command::new(if cfg!(windows) { "python" } else { "python3" });
    command.args(["-c", script]);
    command
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
    let error = command::run(
        &mut python("import sys; sys.stdout.write('a'*700); sys.stderr.write('b'*700)"),
        Instant::now() + Duration::from_secs(2),
        1024,
    )
    .unwrap_err();
    assert!(error.contains("output"), "{error}");
}

#[test]
fn expired_deadline_never_launches_a_child() {
    let dir = tempfile::TempDir::new().unwrap();
    let marker = dir.path().join("marker");
    let script = format!(
        "from pathlib import Path; Path({:?}).write_text('ran')",
        marker.to_string_lossy()
    );
    let error = command::run(&mut python(&script), Instant::now(), 1024).unwrap_err();
    assert!(error.contains("deadline"), "{error}");
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
    let error = command::run(
        &mut python(&script),
        started + Duration::from_millis(200),
        1024,
    )
    .unwrap_err();
    assert!(error.contains("deadline"), "{error}");
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

#[path = "../bridge/source_cli.rs"]
mod source_cli;
use std::path::Path;

#[test]
fn ordinary_current_source_request_reuses_one_owned_artifact() {
    let campaign = source_cli::Campaign::new();
    let request = campaign.request(Instant::now() + Duration::from_millis(4500));
    let root = tempfile::TempDir::new().unwrap();
    let (exit, help) = request.invoke(root.path(), &["--help"], false).unwrap();
    assert_eq!(exit, 0);
    assert!(help.as_str().unwrap().contains("Usage:"));
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
            .contains("artifact changed")
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
            .contains("artifact changed")
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
            .contains("deadline")
    );
    assert!(request.finish().unwrap_err().contains("deadline"));
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
    let request = campaign.request(Instant::now() + Duration::from_millis(4500));
    assert_eq!(request.invoke(dir.path(), &[], false).unwrap().1, "first\n");
    let artifact = request.artifact_path().unwrap();
    std::fs::write(dir.path().join("ran"), "must remain").unwrap();
    std::fs::write(dir.path().join("src/help.md"), "other").unwrap();
    assert!(
        request
            .invoke(dir.path(), &[], false)
            .unwrap_err()
            .contains("inputs changed")
    );
    assert!(request.finish().unwrap_err().contains("inputs changed"));
    assert_eq!(
        std::fs::read_to_string(dir.path().join("ran")).unwrap(),
        "must remain"
    );
    drop(request);
    std::fs::write(dir.path().join("src/help.md"), "first").unwrap();
    let request = campaign.request(Instant::now() + Duration::from_millis(4500));
    assert!(
        request
            .invoke(dir.path(), &[], false)
            .unwrap_err()
            .contains("inputs changed")
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
    let error = command::run(
        &mut python(&script),
        Instant::now() + Duration::from_secs(2),
        1024,
    )
    .unwrap_err();
    assert!(error.contains("output"), "{error}");
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
            .contains("artifact changed")
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
    let request = campaign.request(Instant::now() + Duration::from_millis(4500));
    assert_eq!(
        request.invoke(dir.path(), &[], false).unwrap().1,
        "configured\n"
    );
    assert!(request.artifact_path().is_none());
    request.finish().unwrap();
    drop(request);
    let request = campaign.request(Instant::now() + Duration::from_millis(4500));
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
            .contains("inputs changed")
    );
    assert!(request.finish().unwrap_err().contains("inputs changed"));
    assert_eq!(
        std::fs::read_to_string(dir.path().join("ran")).unwrap(),
        "must remain"
    );
}

fn diagnostic_subprocess(case: &str, enabled: bool) -> std::process::Output {
    let mut child = Command::new(std::env::current_exe().unwrap());
    child
        .args(["--exact", case, "--nocapture"])
        .env("SOURCE_CLI_DIAGNOSTIC_TEST_CHILD", "1");
    if enabled {
        child.env("BLABLA_SOURCE_CLI_DIAGNOSTICS", "1");
    } else {
        child.env_remove("BLABLA_SOURCE_CLI_DIAGNOSTICS");
    }
    let output = command::run(
        &mut child,
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
        assert!(lines.iter().any(|line| line.contains("process=Diagnostics")
            && line.contains("ExitWaiter")
            && line.contains("StdoutReader")
            && line.contains("StderrReader")));
        assert!(
            lines
                .iter()
                .any(|line| line.contains("first-provenance-process"))
        );
        assert!(
            lines
                .iter()
                .any(|line| line.contains("second-provenance-process"))
        );
        assert!(
            lines
                .iter()
                .any(|line| line.contains("invocation=1 fixture=1"))
        );
        assert!(
            lines
                .iter()
                .any(|line| line.contains("invocation=2 fixture=2"))
        );
        assert!(lines.iter().any(
            |line| line.contains("invocation=3 fixture=1") && line.contains("succeeded=false")
        ));
        assert!(
            lines
                .iter()
                .all(|line| line.contains("caller=source_cli_transport.rs:")
                    && line.contains("elapsed_us=")
                    && line.contains("remaining_us="))
        );
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
            .contains("inputs changed")
    );
    assert!(request.finish().unwrap_err().contains("inputs changed"));
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
            .all(|line| line.len() < 4096 && line.contains("remaining_us=0"))
    );
    assert!(!stderr.contains("private-argument"));
    assert!(!stderr.contains("private-root"));
    assert!(!stderr.contains("process=Diagnostics"));
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
                .contains("deadline")
        );
    }
    assert!(request.finish().unwrap_err().contains("deadline"));
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
    assert!(
        lines
            .iter()
            .all(|line| line.contains("telemetry=best-effort missing=not-evidence"))
    );
    assert!(
        lines
            .iter()
            .any(|line| !line.contains("dropped_at_least=0 "))
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
                            .contains("deadline")
                    );
                    assert!(request.finish().unwrap_err().contains("deadline"));
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
            .contains("deadline")
    );
    await_diagnostic_delivery();
    assert_eq!(source_cli::diagnostic_publication().writers_started, 1);
}
