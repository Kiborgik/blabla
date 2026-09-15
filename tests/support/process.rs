use std::time::{Duration, Instant};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

#[cfg(windows)]
pub fn process_is_running(process_id: i64) -> bool {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id as u32) };
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
pub fn process_is_running(process_id: i64) -> bool {
    unsafe { libc::kill(process_id as i32, 0) == 0 }
}

#[cfg(not(any(windows, unix)))]
pub fn process_is_running(_process_id: i64) -> bool {
    false
}

pub fn assert_process_stopped(process_id: i64) {
    let deadline = Instant::now() + Duration::from_millis(250);
    while process_is_running(process_id) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(1));
    }
    assert!(!process_is_running(process_id));
}
