use std::ffi::OsStr;
use std::fs;
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tempfile::NamedTempFile;

#[allow(dead_code)]
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
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("CLI exceeded five seconds: {args:?}");
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
