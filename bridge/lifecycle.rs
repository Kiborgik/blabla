use blabla::application::{AppConfig, Application};
use blabla::ir::Field;
use blabla::ir::Type;
use serde_json::{Value, json};
use std::ffi::OsString;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use std::time::Instant;

#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

fn process_is_running(process_id: i64) -> bool {
    #[cfg(windows)]
    {
        let handle =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id as u32) };
        if handle.is_null() {
            return false;
        }
        let mut exit_code = 0;
        let read = unsafe { GetExitCodeProcess(handle, &mut exit_code) } != 0;
        unsafe {
            CloseHandle(handle);
        }
        read && exit_code == STILL_ACTIVE as u32
    }
    #[cfg(unix)]
    {
        unsafe { libc::kill(process_id as i32, 0) == 0 }
    }
    #[cfg(not(any(windows, unix)))]
    {
        false
    }
}

fn still_running_after_grace(pid: i64) -> bool {
    let deadline = Instant::now() + Duration::from_millis(250);
    let mut still_running = process_is_running(pid);
    while still_running && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(1));
        still_running = process_is_running(pid);
    }
    still_running
}

pub struct Lifecycle {
    session: Option<blabla::runtime::AppSession>,
    running: bool,
    previous_descendant_alive: bool,
    last_termination: String,
    previous_descendant_pid: Option<i64>,
}

impl Lifecycle {
    pub fn new() -> Lifecycle {
        Lifecycle {
            session: None,
            running: false,
            previous_descendant_alive: false,
            last_termination: "none".to_owned(),
            previous_descendant_pid: None,
        }
    }

    pub fn call(&mut self, action: &str) -> bool {
        match action {
            "start_an_application_with_a_descendant" => {
                self.start_an_application_with_a_descendant();
                true
            }
            "restart_the_application" => {
                self.restart_the_application();
                true
            }
            "finish_the_application" => {
                self.finish_the_application();
                true
            }
            _ => false,
        }
    }

    fn start_an_application_with_a_descendant(&mut self) {
        if self.running {
            return;
        }

        let fixture =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/lifecycle/app.py");

        let config = AppConfig {
            executable: PathBuf::from("python"),
            args: vec![
                OsString::from(fixture.as_os_str()),
                OsString::from("descendant"),
            ],
            timeout: Duration::from_secs(1),
            startup: Duration::from_secs(1),
        };

        match blabla::runtime::AppSession::spawn(&config) {
            Ok(mut session) => {
                if session.reset().is_err() {
                    self.running = false;
                    self.last_termination = "none".to_owned();
                    return;
                }

                let schema = vec![Field {
                    name: "descendant_pid".to_owned(),
                    ty: Type::Int,
                }];

                if let Ok(observed) = session.observe(&schema)
                    && let Some(pid) = observed.get("descendant_pid").and_then(Value::as_i64)
                {
                    self.previous_descendant_pid = Some(pid);
                    self.session = Some(session);
                    self.running = true;
                    self.last_termination = "none".to_owned();
                }
            }
            Err(_) => {
                self.running = false;
                self.last_termination = "none".to_owned();
            }
        }
    }

    fn restart_the_application(&mut self) {
        if !self.running {
            return;
        }

        if let Some(session) = &mut self.session {
            match session.restart() {
                Ok(()) => {
                    self.last_termination = "released".to_owned();

                    self.previous_descendant_alive = if let Some(pid) = self.previous_descendant_pid
                    {
                        still_running_after_grace(pid)
                    } else {
                        false
                    };

                    let schema = vec![Field {
                        name: "descendant_pid".to_owned(),
                        ty: Type::Int,
                    }];

                    if let Ok(observed) = session.observe(&schema)
                        && let Some(pid) = observed.get("descendant_pid").and_then(Value::as_i64)
                    {
                        self.previous_descendant_pid = Some(pid);
                        self.running = true;
                    } else {
                        self.previous_descendant_pid = None;
                        self.running = false;
                    }
                }
                Err(error) => {
                    self.previous_descendant_alive = if let Some(pid) = self.previous_descendant_pid
                    {
                        still_running_after_grace(pid)
                    } else {
                        false
                    };

                    self.last_termination = error.code.clone();
                    self.session = None;
                    self.running = false;
                }
            }
        }
    }

    fn finish_the_application(&mut self) {
        if !self.running {
            return;
        }

        if let Some(session) = &mut self.session {
            match session.finish() {
                Ok(()) => {
                    self.previous_descendant_alive = if let Some(pid) = self.previous_descendant_pid
                    {
                        still_running_after_grace(pid)
                    } else {
                        false
                    };

                    self.last_termination = "released".to_owned();
                    self.session = None;
                    self.running = false;
                }
                Err(error) => {
                    self.previous_descendant_alive = if let Some(pid) = self.previous_descendant_pid
                    {
                        still_running_after_grace(pid)
                    } else {
                        false
                    };

                    self.last_termination = error.code.clone();
                    self.session = None;
                    self.running = false;
                }
            }
        }
    }

    pub fn reset(&mut self) {
        if let Some(session) = &mut self.session {
            let _ = session.finish();
        }
        self.session = None;
        self.running = false;
        self.previous_descendant_alive = false;
        self.last_termination = "none".to_owned();
        self.previous_descendant_pid = None;
    }

    pub fn observe(&self) -> Value {
        json!({
            "running": self.running,
            "previous_descendant_alive": self.previous_descendant_alive,
            "last_termination": self.last_termination,
        })
    }
}
