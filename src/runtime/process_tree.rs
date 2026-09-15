use crate::diagnostic::AppError;
use std::process::{Child, Command};

#[cfg(windows)]
use std::ffi::c_void;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
#[cfg(windows)]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
    QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    CREATE_SUSPENDED, OpenThread, ResumeThread, THREAD_SUSPEND_RESUME,
};

#[cfg(windows)]
struct OwnedHandle(HANDLE);

#[cfg(windows)]
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

#[cfg(windows)]
pub(crate) struct ProcessTree {
    job: Option<OwnedHandle>,
}

#[cfg(unix)]
pub(crate) struct ProcessTree {
    process_group: Option<i32>,
}

#[cfg(not(any(windows, unix)))]
pub(crate) struct ProcessTree;

#[cfg(windows)]
pub(crate) fn configure(command: &mut Command) {
    command.creation_flags(CREATE_SUSPENDED);
}

#[cfg(unix)]
pub(crate) fn configure(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(any(windows, unix)))]
pub(crate) fn configure(_command: &mut Command) {}

#[cfg(windows)]
impl ProcessTree {
    pub(crate) fn attach(child: &mut Child) -> Result<Self, AppError> {
        let raw_job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw_job.is_null() {
            return Err(native_error("could not create application Job Object"));
        }
        let job = OwnedHandle(raw_job);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast::<c_void>(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(native_error("could not configure application Job Object"));
        }
        let process = child.as_raw_handle() as HANDLE;
        if unsafe { AssignProcessToJobObject(job.0, process) } == 0 {
            return Err(native_error("could not assign application to Job Object"));
        }
        let thread_id = initial_thread_id(child.id())?;
        let raw_thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, thread_id) };
        if raw_thread.is_null() {
            return Err(native_error("could not open suspended application thread"));
        }
        let thread = OwnedHandle(raw_thread);
        if unsafe { ResumeThread(thread.0) } == u32::MAX {
            return Err(native_error(
                "could not resume suspended application thread",
            ));
        }
        Ok(Self { job: Some(job) })
    }

    pub(crate) fn terminate(&mut self) {
        if let Some(job) = &self.job {
            unsafe {
                TerminateJobObject(job.0, 1);
            }
        }
    }

    pub(crate) fn is_empty(&self) -> Result<bool, AppError> {
        let Some(job) = &self.job else {
            return Ok(true);
        };
        let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        let success = unsafe {
            QueryInformationJobObject(
                job.0,
                JobObjectBasicAccountingInformation,
                (&raw mut accounting).cast::<c_void>(),
                std::mem::size_of_val(&accounting) as u32,
                std::ptr::null_mut(),
            )
        };
        if success == 0 {
            return Err(AppError::new(
                "APP_LIFECYCLE",
                "could not verify application Job Object termination",
            ));
        }
        Ok(accounting.ActiveProcesses == 0)
    }
}

#[cfg(windows)]
fn initial_thread_id(process_id: u32) -> Result<u32, AppError> {
    let raw_snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if raw_snapshot == INVALID_HANDLE_VALUE {
        return Err(native_error(
            "could not enumerate suspended application threads",
        ));
    }
    let snapshot = OwnedHandle(raw_snapshot);
    let mut entry = THREADENTRY32 {
        dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    if unsafe { Thread32First(snapshot.0, &mut entry) } != 0 {
        loop {
            if entry.th32OwnerProcessID == process_id {
                return Ok(entry.th32ThreadID);
            }
            if unsafe { Thread32Next(snapshot.0, &mut entry) } == 0 {
                break;
            }
        }
    }
    Err(AppError::new(
        "APP_SPAWN",
        "could not find suspended application thread",
    ))
}

#[cfg(windows)]
fn native_error(context: &str) -> AppError {
    AppError::new(
        "APP_SPAWN",
        format!("{context}: {}", std::io::Error::last_os_error()),
    )
}

#[cfg(unix)]
impl ProcessTree {
    pub(crate) fn attach(child: &mut Child) -> Result<Self, AppError> {
        let process_group = i32::try_from(child.id())
            .map_err(|_| AppError::new("APP_SPAWN", "application process id is out of range"))?;
        Ok(Self {
            process_group: Some(process_group),
        })
    }

    pub(crate) fn terminate(&mut self) {
        if let Some(process_group) = self.process_group {
            unsafe {
                libc::kill(-process_group, libc::SIGKILL);
            }
        }
    }

    pub(crate) fn is_empty(&self) -> Result<bool, AppError> {
        let Some(group) = self.process_group else {
            return Ok(true);
        };
        if unsafe { libc::kill(-group, 0) } == 0 {
            return Ok(false);
        }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(true)
        } else {
            Err(AppError::new(
                "APP_LIFECYCLE",
                format!("could not verify process group termination: {error}"),
            ))
        }
    }
}

#[cfg(not(any(windows, unix)))]
impl ProcessTree {
    pub(crate) fn attach(_child: &mut Child) -> Result<Self, AppError> {
        Ok(Self)
    }

    pub(crate) fn terminate(&mut self) {}

    pub(crate) fn is_empty(&self) -> Result<bool, AppError> {
        Err(AppError::new(
            "APP_LIFECYCLE",
            "trusted process containment is unsupported on this platform",
        ))
    }
}
