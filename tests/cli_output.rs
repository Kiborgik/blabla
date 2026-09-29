use serde_json::Value;
use std::ffi::OsStr;
use std::io::Write;
use std::path::Path;
use tempfile::NamedTempFile;

#[path = "support/cli.rs"]
mod support;

fn failure_output(flags: &[&str]) -> std::process::Output {
    let mut contract = NamedTempFile::new().unwrap();
    writeln!(contract, "state count: int\naction increment()\naction restart()\nwhen restart {{ expect \"persistence\": after.count == before.count }}").unwrap();
    let app = Path::new("tests/fixtures/lifecycle/app.py")
        .canonicalize()
        .unwrap();
    let mut args = support::args(&["run"]);
    args.push(contract.path().as_os_str());
    args.extend(support::args(&[
        "--seed",
        "0",
        "--cases",
        "1",
        "--steps",
        "8",
        "--shrink-budget",
        "64",
    ]));
    args.extend(flags.iter().map(OsStr::new));
    args.extend([
        OsStr::new("--"),
        OsStr::new("python"),
        app.as_os_str(),
        OsStr::new("memory"),
    ]);
    support::run(&args)
}

#[test]
fn json_failure_exposes_original_and_minimized_lengths_and_sequence() {
    let output = failure_output(&["--json", "--timeout-ms", "1000"]);
    assert_eq!(output.status.code(), Some(1));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["property"], "persistence");
    assert_eq!(report["seed"], 0);
    assert_eq!(report["minimal_sequence_length"], 2);
    assert_eq!(report["minimal_sequence"][0]["action"], "increment");
    assert_eq!(report["minimal_sequence"][1]["action"], "restart");
    assert_eq!(
        report["original_sequence_length"].as_u64().unwrap() as usize,
        report["original_sequence"].as_array().unwrap().len()
    );
    assert_eq!(report["timeout_ms"], 1000);
}

#[test]
fn human_failure_is_concise_and_verbose_includes_full_state() {
    let output = failure_output(&[]);
    assert_eq!(output.status.code(), Some(1));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.starts_with("BlaBla\n\nBEHAVIOR"));
    assert!(text.contains("persistence violated"));
    assert!(text.contains("minimal sequence length: 2"));
    assert!(!text.contains("before:"));
    let verbose = failure_output(&["--verbose"]);
    assert_eq!(verbose.status.code(), Some(1));
    let text = String::from_utf8(verbose.stdout).unwrap();
    assert!(text.contains("before:"));
    assert!(text.contains("original sequence:"));
}

fn protocol_output(mode: &str) -> std::process::Output {
    let mut contract = NamedTempFile::new().unwrap();
    writeln!(
        contract,
        "state calls: int\naction increment()\nalways \"nonnegative\" {{ calls >= 0 }}"
    )
    .unwrap();
    let app = Path::new("tests/fixtures/protocol/app.py")
        .canonicalize()
        .unwrap();
    support::run(&[
        OsStr::new("run"),
        contract.path().as_os_str(),
        OsStr::new("--json"),
        OsStr::new("--cases"),
        OsStr::new("1"),
        OsStr::new("--steps"),
        OsStr::new("2"),
        OsStr::new("--timeout-ms"),
        OsStr::new("250"),
        OsStr::new("--"),
        OsStr::new("python"),
        app.as_os_str(),
        OsStr::new(mode),
    ])
}

#[test]
fn runtime_failures_never_report_pass_and_have_distinct_machine_codes() {
    for (mode, code) in [
        ("malformed", "APP_PROTOCOL"),
        ("stdout_noise", "APP_PROTOCOL"),
        ("duplicate_ok", "APP_PROTOCOL"),
        ("duplicate_result", "APP_PROTOCOL"),
        ("wrong_id", "APP_PROTOCOL"),
        ("trailing", "APP_PROTOCOL"),
        ("timeout_read", "APP_TIMEOUT"),
        ("crash", "APP_CRASH"),
    ] {
        let output = protocol_output(mode);
        assert_eq!(output.status.code(), Some(3), "{mode}: {output:?}");
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["status"], "error");
        assert_eq!(report["code"], code, "{mode}");
        assert_eq!(report["seed"], 0);
        assert!(report.get("property").is_none());
    }
}

#[test]
fn stderr_logging_preserves_a_single_valid_json_report() {
    let output = protocol_output("stderr_logging");
    assert_eq!(output.status.code(), Some(0));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["status"], "green");
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("application log")
    );
}

#[test]
fn yellow_reports_missing_witnesses_and_exit_five() {
    let mut contract = NamedTempFile::new().unwrap();
    writeln!(contract,"state calls: int\naction increment()\nwhen increment {{ expect \"rare\": before.calls != 100 or after.calls == before.calls }}").unwrap();
    let app = Path::new("tests/fixtures/protocol/app.py")
        .canonicalize()
        .unwrap();
    let values = [
        OsStr::new("run"),
        contract.path().as_os_str(),
        OsStr::new("--cases"),
        OsStr::new("1"),
        OsStr::new("--steps"),
        OsStr::new("2"),
        OsStr::new("--json"),
        OsStr::new("--"),
        OsStr::new("python"),
        app.as_os_str(),
        OsStr::new("stderr_logging"),
    ];
    let output = support::run(&values);
    assert_eq!(output.status.code(), Some(5), "{output:?}");
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["status"], "yellow");
    assert!(report["unexercised"].as_u64().unwrap() > 0);
    assert_eq!(report["violated"], 0);
    assert!(report["verified"].as_u64().unwrap() > 0);
    assert!(
        report["coverage"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["status"] == "unexercised" && p["witnesses"] == 0)
    );
    let human: Vec<_> = values
        .into_iter()
        .filter(|v| *v != OsStr::new("--json"))
        .collect();
    let output = support::run(&human);
    assert_eq!(output.status.code(), Some(5));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("YELLOW") && text.contains("rare"), "{text}");
    assert!(!text.contains("PASS"), "{text}");
}
