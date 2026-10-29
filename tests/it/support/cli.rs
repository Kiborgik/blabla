pub mod task_project;

use std::ffi::OsStr;
use std::fs;
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tempfile::NamedTempFile;

const HANG_TIMEOUT: Duration = Duration::from_secs(120);

pub fn run(args: &[&OsStr]) -> Output {
    run_in(None, args)
}

pub fn run_in(directory: Option<&std::path::Path>, args: &[&OsStr]) -> Output {
    let stdout = NamedTempFile::new().unwrap();
    let stderr = NamedTempFile::new().unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_blabla"));
    if let Some(directory) = directory {
        command.current_dir(directory);
    }
    let mut child = command
        .args(args)
        .stdin(Stdio::null())
        .stdout(stdout.as_file().try_clone().unwrap())
        .stderr(stderr.as_file().try_clone().unwrap())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + HANG_TIMEOUT;
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("CLI exceeded {HANG_TIMEOUT:?}: {args:?}");
        }
        thread::sleep(Duration::from_millis(5));
    };
    Output {
        status,
        stdout: fs::read(stdout.path()).unwrap(),
        stderr: fs::read(stderr.path()).unwrap(),
    }
}

pub fn args<'a>(values: &[&'a str]) -> Vec<&'a OsStr> {
    values.iter().copied().map(OsStr::new).collect()
}

pub fn write(root: &std::path::Path, relative: &str, text: &str) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

pub fn json_of(temp: &tempfile::TempDir, arguments: &[&str]) -> (serde_json::Value, i32) {
    let output = run_in(Some(temp.path()), &args(arguments));
    let text = String::from_utf8(output.stdout).unwrap();
    (
        serde_json::from_str(&text).unwrap_or_else(|_| panic!("not JSON: {text}")),
        output.status.code().unwrap(),
    )
}

pub fn cli_json(root: &std::path::Path, arguments: &[&str]) -> (i32, serde_json::Value) {
    let mut values = vec!["--json"];
    values.extend_from_slice(arguments);
    let output = run_in(Some(root), &args(&values));
    let value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        panic!(
            "stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    });
    (output.status.code().unwrap(), value)
}

pub fn tree_snapshot(root: &std::path::Path) -> std::collections::BTreeMap<String, Vec<u8>> {
    let mut result = std::collections::BTreeMap::new();
    for item in fs::read_dir(root).unwrap() {
        let item = item.unwrap();
        let name = item.file_name().to_string_lossy().into_owned();
        if item.file_type().unwrap().is_dir() {
            for (child, bytes) in tree_snapshot(&item.path()) {
                result.insert(format!("{name}/{child}"), bytes);
            }
        } else {
            result.insert(name, fs::read(item.path()).unwrap());
        }
    }
    result
}
