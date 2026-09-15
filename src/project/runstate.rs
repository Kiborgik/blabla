use super::status::RECORD_DIRECTORY;
use super::{Fnv, Profile};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const MARKER_FILE: &str = "verifying.json";
pub const START_TOLERANCE_SECONDS: u64 = 2;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Marker {
    pub run_id: String,
    pub pid: u32,
    pub started_unix: u64,
    pub verifier_version: String,
    pub project_identity: String,
    pub profile_identity: String,
    #[serde(default)]
    pub profile: Option<Profile>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Classification {
    Verifying,
    Interrupted,
    Completed,
}

pub fn marker_path(root: &Path) -> PathBuf {
    root.join(RECORD_DIRECTORY).join(MARKER_FILE)
}

pub fn write_marker(root: &Path, marker: &Marker) -> std::io::Result<PathBuf> {
    let path = marker_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_vec_pretty(marker).map_err(std::io::Error::other)?;
    std::fs::write(&path, text)?;
    Ok(path)
}

pub fn read_marker(root: &Path) -> Result<Option<Marker>, String> {
    let path = marker_path(root);
    if !path.is_file() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|failure| format!("cannot read {}: {failure}", path.display()))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|failure| format!("cannot parse {}: {failure}", path.display()))
}

pub fn remove_marker(root: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(marker_path(root)) {
        Ok(()) => Ok(()),
        Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(failure) => Err(failure),
    }
}

pub fn new_run_id() -> String {
    let mut bytes = [0u8; 16];
    if getrandom::fill(&mut bytes).is_err() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0);
        bytes.copy_from_slice(&nanos.to_le_bytes());
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn profile_identity(profile: Option<&Profile>) -> String {
    let mut hasher = Fnv::new();
    match profile {
        Some(profile) => {
            for element in &profile.command {
                hasher.write_str(element);
            }
            hasher.write(&profile.seed.to_le_bytes());
            hasher.write(&profile.cases.to_le_bytes());
            hasher.write(&profile.steps.to_le_bytes());
            hasher.write(&profile.timeout_ms.to_le_bytes());
            hasher.write(&profile.shrink_budget.to_le_bytes());
        }
        None => hasher.write_str("no-profile"),
    }
    hasher.finish()
}

pub fn classify(
    marker: &Marker,
    project_identity: &str,
    profile_identity: &str,
    record_run_id: Option<&str>,
) -> Classification {
    if record_run_id == Some(marker.run_id.as_str()) {
        return Classification::Completed;
    }
    if marker.project_identity != project_identity || marker.profile_identity != profile_identity {
        return Classification::Interrupted;
    }
    match process_started_unix(marker.pid) {
        Some(started) if started <= marker.started_unix + START_TOLERANCE_SECONDS => {
            Classification::Verifying
        }
        _ => Classification::Interrupted,
    }
}

#[cfg(windows)]
pub fn process_started_unix(pid: u32) -> Option<u64> {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return None;
    }
    let mut exit_code = 0u32;
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    let alive = unsafe { GetExitCodeProcess(handle, &mut exit_code) } != 0
        && exit_code == STILL_ACTIVE as u32;
    let timed =
        unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) } != 0;
    unsafe {
        CloseHandle(handle);
    }
    if !alive || !timed {
        return None;
    }
    let intervals = (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
    let seconds = intervals / 10_000_000;
    seconds.checked_sub(11_644_473_600)
}

#[cfg(unix)]
pub fn process_started_unix(pid: u32) -> Option<u64> {
    let raw = i32::try_from(pid).ok()?;
    let alive = unsafe { libc::kill(raw, 0) } == 0
        || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
    if !alive {
        return None;
    }
    let metadata = std::fs::metadata(format!("/proc/{pid}")).ok()?;
    let modified = metadata.modified().ok()?;
    modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|elapsed| elapsed.as_secs())
}

#[cfg(not(any(windows, unix)))]
pub fn process_started_unix(_pid: u32) -> Option<u64> {
    None
}
