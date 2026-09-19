use crate::diagnostic::AppError;
use crate::ir::Field;
use crate::report::Call;
use serde_json::Value;
use std::ffi::OsString;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub executable: PathBuf,
    pub args: Vec<OsString>,
    pub timeout: Duration,
    pub startup: Duration,
}

impl AppConfig {
    pub fn launched(executable: PathBuf, args: Vec<OsString>, timeout: Duration) -> AppConfig {
        AppConfig {
            executable,
            args,
            timeout,
            startup: timeout,
        }
    }

    pub fn booting_within(mut self, startup: Duration) -> AppConfig {
        self.startup = startup;
        self
    }
}

pub trait Application {
    fn reset(&mut self) -> Result<(), AppError>;
    fn call(&mut self, call: &Call) -> Result<(), AppError>;
    fn observe(&mut self, schema: &[Field]) -> Result<Value, AppError>;
    fn restart(&mut self) -> Result<(), AppError> {
        Err(AppError::new(
            "APP_LIFECYCLE",
            "this adapter does not provide trusted process restart",
        ))
    }
    fn finish(&mut self) -> Result<(), AppError> {
        Ok(())
    }
}
