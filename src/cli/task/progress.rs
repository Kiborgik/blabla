use blabla::project::status::now_unix;
use blabla::project::task::{self, Task};
use blabla::runtime::evidence_capture::{ChildObservation, Failure, OUTPUT_LIMIT, Phase, Snapshot};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const MAX_SIDECAR: u64 = 16 * 1024;
const DISPLAY_LIMIT: usize = 20;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum Recording {
    Pending,
    Recorded,
    Refused,
    Failed,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Progress {
    schema: u32,
    run_id: String,
    started_unix: u64,
    observed_unix: u64,
    limit_bytes: usize,
    acceptance_epoch: u64,
    pins_fingerprint: String,
    capture: Snapshot,
    recording: Recording,
    receipt_fingerprint: Option<String>,
}

pub(super) struct Run {
    directories: RunDirectories,
    log_name: String,
    pub stdout: File,
    pub stderr: File,
    progress: Progress,
}

pub(super) fn fingerprint(value: &impl Serialize) -> String {
    Sha256::digest(serde_json::to_vec(value).expect("progress pins serialize"))
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn directory(path: &Path, create: bool) -> io::Result<()> {
    if create {
        #[cfg(unix)]
        let mut builder = fs::DirBuilder::new();
        #[cfg(not(unix))]
        let builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        match builder.create(path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    if !fs::symlink_metadata(path)?.file_type().is_dir() {
        return Err(io::Error::other("progress directory unavailable"));
    }
    Ok(())
}

fn scratch(root: &Path, name: &str, create: bool) -> io::Result<PathBuf> {
    let mut current = root.to_path_buf();
    for component in [".blabla", "scratch", name] {
        if component.is_empty()
            || component.contains(['/', '\\'])
            || matches!(component, "." | "..")
        {
            return Err(io::Error::other("invalid progress path"));
        }
        current.push(component);
        directory(&current, create)?;
    }
    Ok(current)
}

#[cfg(not(unix))]
fn create_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

struct RunDirectories {
    root: PathBuf,
    names: [String; 4],
    paths: Vec<PathBuf>,
    handles: Vec<File>,
}

fn open_directory(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x02000000 | 0x00200000).share_mode(3);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_dir() || fs::symlink_metadata(path)?.file_type().is_symlink() {
        return Err(io::Error::other("capture directory unavailable"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if file.metadata()?.file_attributes() & 0x400 != 0 {
            return Err(io::Error::other("capture reparse point refused"));
        }
    }
    Ok(file)
}

#[cfg(unix)]
fn child_directory(parent: &File, name: &str, create: bool, unique: bool) -> io::Result<File> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    let name = CString::new(name).map_err(io::Error::other)?;
    if create && unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) } != 0 {
        let error = io::Error::last_os_error();
        if unique || error.kind() != io::ErrorKind::AlreadyExists {
            return Err(error);
        }
    }
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

fn same_directory(left: &File, right: &File) -> io::Result<bool> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let left = left.metadata()?;
        let right = right.metadata()?;
        Ok((left.dev(), left.ino()) == (right.dev(), right.ino()))
    }
    #[cfg(not(unix))]
    {
        Ok(left.metadata()?.is_dir() && right.metadata()?.is_dir())
    }
}

impl RunDirectories {
    fn create(root: &Path, name: &str, run_name: String) -> io::Result<Self> {
        let names = [
            ".blabla".to_owned(),
            "scratch".to_owned(),
            name.to_owned(),
            run_name,
        ];
        let mut handles = vec![open_directory(root)?];
        let mut paths = vec![root.to_owned()];
        for (index, name) in names.iter().enumerate() {
            if name.is_empty() || name.contains(['/', '\\']) || matches!(name.as_str(), "." | "..")
            {
                return Err(io::Error::other("invalid capture path"));
            }
            let path = paths.last().unwrap().join(name);
            #[cfg(unix)]
            let handle = child_directory(handles.last().unwrap(), name, true, index == 3)?;
            #[cfg(not(unix))]
            let handle = {
                if index == 3 {
                    fs::create_dir(&path)?;
                } else {
                    directory(&path, true)?;
                }
                open_directory(&path)?
            };
            handles.push(handle);
            paths.push(path);
        }
        let directories = Self {
            root: root.to_owned(),
            names,
            paths,
            handles,
        };
        directories.validate()?;
        Ok(directories)
    }

    fn validate(&self) -> io::Result<()> {
        let current = open_directory(&self.root)?;
        if !same_directory(&current, &self.handles[0])? {
            return Err(io::Error::other("capture ancestry changed"));
        }
        #[cfg(unix)]
        let mut current = current;
        for (index, name) in self.names.iter().enumerate() {
            #[cfg(unix)]
            let next = child_directory(&current, name, false, false)?;
            #[cfg(not(unix))]
            let next = {
                let _ = name;
                open_directory(&self.paths[index + 1])?
            };
            if !same_directory(&next, &self.handles[index + 1])? {
                return Err(io::Error::other("capture ancestry changed"));
            }
            #[cfg(unix)]
            {
                current = next;
            }
        }
        Ok(())
    }

    fn create_spool(&self, name: &str) -> io::Result<File> {
        self.validate()?;
        #[cfg(unix)]
        {
            create_at(&self.handles[4], name)
        }
        #[cfg(not(unix))]
        {
            create_file(&self.paths[4].join(name))
        }
    }

    fn temporary(&self, scratch: bool) -> io::Result<CaptureTemporary> {
        self.validate()?;
        let index = if scratch { 3 } else { 4 };
        CaptureTemporary::create(&self.handles[index], &self.paths[index])
    }

    fn publish(&self, temporary: CaptureTemporary, name: &str, replace: bool) -> io::Result<()> {
        self.validate()?;
        temporary.publish(name, replace)
    }

    fn remove_spool(&self, name: &str) -> io::Result<()> {
        self.validate()?;
        #[cfg(unix)]
        {
            use std::ffi::CString;
            use std::os::fd::AsRawFd;
            let name = CString::new(name).map_err(io::Error::other)?;
            if unsafe { libc::unlinkat(self.handles[4].as_raw_fd(), name.as_ptr(), 0) } != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }
        #[cfg(not(unix))]
        {
            fs::remove_file(self.paths[4].join(name))
        }
    }
}

#[cfg(unix)]
fn create_at(parent: &File, name: &str) -> io::Result<File> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    let name = CString::new(name).map_err(io::Error::other)?;
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

struct CaptureTemporary {
    #[cfg(unix)]
    file: File,
    #[cfg(unix)]
    parent: File,
    #[cfg(unix)]
    name: std::ffi::CString,
    #[cfg(not(unix))]
    file: tempfile::NamedTempFile,
    #[cfg(not(unix))]
    parent_path: PathBuf,
}

impl CaptureTemporary {
    fn create(parent: &File, path: &Path) -> io::Result<Self> {
        #[cfg(unix)]
        {
            let _ = path;
            let mut bytes = [0u8; 16];
            getrandom::fill(&mut bytes).map_err(io::Error::other)?;
            let name = format!(
                ".capture-{}",
                bytes
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
            );
            let parent = parent.try_clone()?;
            let file = create_at(&parent, &name)?;
            Ok(Self {
                file,
                parent,
                name: std::ffi::CString::new(name).map_err(io::Error::other)?,
            })
        }
        #[cfg(not(unix))]
        {
            let _ = parent;
            Ok(Self {
                file: tempfile::NamedTempFile::new_in(path)?,
                parent_path: path.to_owned(),
            })
        }
    }

    fn file(&mut self) -> &mut File {
        #[cfg(unix)]
        {
            &mut self.file
        }
        #[cfg(not(unix))]
        {
            self.file.as_file_mut()
        }
    }

    fn publish(self, name: &str, replace: bool) -> io::Result<()> {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let name = std::ffi::CString::new(name).map_err(io::Error::other)?;
            let fd = self.parent.as_raw_fd();
            let result = if replace {
                unsafe { libc::renameat(fd, self.name.as_ptr(), fd, name.as_ptr()) }
            } else {
                unsafe { libc::linkat(fd, self.name.as_ptr(), fd, name.as_ptr(), 0) }
            };
            if result != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }
        #[cfg(not(unix))]
        {
            let path = self.parent_path.join(name);
            if replace {
                let temporary = self.file.into_temp_path();
                fs::rename(&temporary, &path)
            } else {
                self.file
                    .persist_noclobber(path)
                    .map(|_| ())
                    .map_err(|error| error.error)
            }
        }
    }
}

#[cfg(unix)]
impl Drop for CaptureTemporary {
    fn drop(&mut self) {
        use std::os::fd::AsRawFd;
        unsafe {
            libc::unlinkat(self.parent.as_raw_fd(), self.name.as_ptr(), 0);
        }
    }
}

impl Run {
    pub fn create(root: &Path, task: &Task, pins_fingerprint: String) -> io::Result<Self> {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(io::Error::other)?;
        let run_id = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let directories =
            RunDirectories::create(root, &task.name, format!("evidence-run-{run_id}"))?;
        let stdout = directories.create_spool("stdout.partial")?;
        let stderr = directories.create_spool("stderr.partial")?;
        let now = now_unix();
        let run = Self {
            directories,
            log_name: format!(
                "evidence-{}-{}-{run_id}.log",
                task.evidence.len() + 1,
                std::process::id()
            ),
            stdout,
            stderr,
            progress: Progress {
                schema: 1,
                run_id,
                started_unix: now,
                observed_unix: now,
                limit_bytes: OUTPUT_LIMIT,
                acceptance_epoch: task.acceptance_epoch,
                pins_fingerprint,
                capture: Snapshot::default(),
                recording: Recording::Pending,
                receipt_fingerprint: None,
            },
        };
        run.publish()?;
        Ok(run)
    }

    pub fn ensure_current(&self) -> io::Result<()> {
        self.directories.validate()
    }

    pub fn id(&self) -> &str {
        &self.progress.run_id
    }

    pub fn log(&self, name: &str) -> String {
        format!("{}/{}", task::scratch_label(name), self.log_name)
    }

    fn publish(&self) -> io::Result<()> {
        let bytes = serde_json::to_vec(&self.progress).map_err(io::Error::other)?;
        if bytes.len() as u64 > MAX_SIDECAR {
            return Err(io::Error::other("progress size exceeded"));
        }
        let mut temporary = self.directories.temporary(false)?;
        temporary.file().write_all(&bytes)?;
        temporary.file().sync_all()?;
        self.directories.publish(temporary, "progress.json", true)?;
        Ok(())
    }

    pub fn observe(&mut self, snapshot: &Snapshot) -> io::Result<()> {
        self.progress.capture = *snapshot;
        self.progress.observed_unix = now_unix();
        self.publish()
    }

    pub fn recording(&mut self, recording: Recording, receipt: Option<String>) {
        self.progress.recording = recording;
        self.progress.receipt_fingerprint = receipt.or(self.progress.receipt_fingerprint.take());
        self.progress.observed_unix = now_unix();
        let _ = self.publish();
    }

    pub fn finalize(&mut self, snapshot: &mut Snapshot) -> io::Result<()> {
        let result = (|| {
            let mut temporary = self.directories.temporary(true)?;
            for (stream, expected) in [
                (&mut self.stdout, snapshot.stdout_bytes),
                (&mut self.stderr, snapshot.stderr_bytes),
            ] {
                stream.seek(SeekFrom::Start(0))?;
                if stream.metadata()?.len() != expected
                    || io::copy(&mut stream.take(expected + 1), temporary.file())? != expected
                {
                    return Err(io::Error::other("capture length changed"));
                }
            }
            temporary.file().sync_all()?;
            self.directories.publish(temporary, &self.log_name, false)?;
            let _ = self.directories.remove_spool("stdout.partial");
            let _ = self.directories.remove_spool("stderr.partial");
            Ok(())
        })();
        if result.is_err() {
            snapshot.fail(Failure::Finalize);
            self.progress.recording = Recording::Failed;
        }
        let observed = self.observe(snapshot);
        result.and(observed)
    }
}

fn valid_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[cfg(unix)]
fn open_progress(root: &Path, name: &str, run_id: &str) -> io::Result<File> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::fs::OpenOptionsExt;
    let mut directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY)
        .open(root)?;
    for component in [
        ".blabla",
        "scratch",
        name,
        &format!("evidence-run-{run_id}"),
    ] {
        let component = CString::new(component).map_err(io::Error::other)?;
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                component.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        directory = unsafe { File::from_raw_fd(fd) };
    }
    let name = c"progress.json";
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

#[cfg(not(unix))]
fn open_progress(root: &Path, name: &str, run_id: &str) -> io::Result<File> {
    let directory_path = scratch(root, name, false)?.join(format!("evidence-run-{run_id}"));
    directory(&directory_path, false)?;
    let path = directory_path.join("progress.json");
    if !fs::symlink_metadata(&path)?.file_type().is_file() {
        return Err(io::Error::other("progress unavailable"));
    }
    File::open(path)
}

fn read(root: &Path, name: &str, run_id: &str) -> io::Result<Progress> {
    let file = open_progress(root, name, run_id)?;
    if !file.metadata()?.is_file() || file.metadata()?.len() > MAX_SIDECAR {
        return Err(io::Error::other("progress unavailable"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_SIDECAR + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_SIDECAR {
        return Err(io::Error::other("progress size exceeded"));
    }
    let progress: Progress = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
    if progress.schema != 1
        || progress.run_id != run_id
        || !valid_hex(&progress.run_id, 32)
        || !valid_hex(&progress.pins_fingerprint, 64)
        || progress
            .receipt_fingerprint
            .as_ref()
            .is_some_and(|value| !valid_hex(value, 64))
        || progress.observed_unix < progress.started_unix
        || progress.limit_bytes != OUTPUT_LIMIT
        || progress.capture.stdout_bytes > OUTPUT_LIMIT as u64
        || progress.capture.stderr_bytes > OUTPUT_LIMIT as u64
        || progress.capture.stdout_bytes + progress.capture.stderr_bytes > OUTPUT_LIMIT as u64
        || progress.capture.complete
            && (!progress.capture.stdout_eof
                || !progress.capture.stderr_eof
                || progress.capture.failure.is_some()
                || progress.capture.phase != Phase::Complete)
    {
        return Err(io::Error::other("invalid progress snapshot"));
    }
    Ok(progress)
}

pub(super) fn summary(root: &Path, task: &Task) -> Value {
    let mut total = 0usize;
    let mut unavailable = 0usize;
    let mut selected = Vec::new();
    let mut entries = Vec::new();
    let records = scratch(root, &task.name, false).and_then(fs::read_dir);
    let Ok(records) = records else {
        return json!({"diagnostic_only":true,"total":0,"shown":0,"omitted":0,"unavailable":0,"limit":DISPLAY_LIMIT,"entries":[],"directory_available":false});
    };
    for entry in records {
        let Ok(entry) = entry else {
            unavailable += 1;
            continue;
        };
        let name = entry.file_name();
        let Some(run_id) = name
            .to_str()
            .and_then(|name| name.strip_prefix("evidence-run-"))
            .filter(|id| valid_hex(id, 32))
        else {
            continue;
        };
        total += 1;
        let modified = fs::symlink_metadata(entry.path())
            .and_then(|metadata| metadata.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        selected.push((modified, run_id.to_owned()));
        selected.sort_unstable_by(|left, right| right.cmp(left));
        selected.truncate(DISPLAY_LIMIT);
    }
    let inspected = selected.len();
    for (_, run_id) in selected {
        let Ok(progress) = read(root, &task.name, &run_id) else {
            unavailable += 1;
            continue;
        };
        let receipt_observed = progress
            .receipt_fingerprint
            .as_ref()
            .is_some_and(|expected| {
                task.evidence
                    .iter()
                    .any(|evidence| fingerprint(evidence) == *expected)
            });
        let outcome = match progress.capture.child {
            ChildObservation::Exited { .. } => "exited",
            ChildObservation::Signaled { .. } => "signaled",
            _ => "unknown",
        };
        entries.push(json!({"last_observed":progress,"observation_age_seconds": now_unix().saturating_sub(progress.observed_unix),"outcome":outcome,"receipt_observed":receipt_observed}));
    }
    json!({"diagnostic_only":true,"total":total,"shown":entries.len(),"omitted":total.saturating_sub(inspected),"unavailable":unavailable,"limit":DISPLAY_LIMIT,"entries":entries,"directory_available":true})
}

pub(super) fn write_summary(out: &mut impl Write, summary: &Value) -> io::Result<()> {
    if summary["total"].as_u64().unwrap_or(0) == 0 {
        return Ok(());
    }
    writeln!(
        out,
        "\nEvidence-run progress (last observations only; never readiness authority):"
    )?;
    writeln!(
        out,
        "  {} total, {} shown, {} omitted, {} unavailable",
        summary["total"], summary["shown"], summary["omitted"], summary["unavailable"]
    )?;
    for entry in summary["entries"].as_array().into_iter().flatten() {
        let observed = &entry["last_observed"];
        let capture = &observed["capture"];
        writeln!(
            out,
            "  {}: last observed {} {}s ago; stdout {} bytes, stderr {} bytes; outcome {}; recording {}; receipt observed {}",
            observed["run_id"].as_str().unwrap_or("unavailable"),
            capture["phase"].as_str().unwrap_or("unknown"),
            entry["observation_age_seconds"],
            capture["stdout_bytes"],
            capture["stderr_bytes"],
            entry["outcome"].as_str().unwrap_or("unknown"),
            observed["recording"].as_str().unwrap_or("unknown"),
            entry["receipt_observed"]
        )?;
    }
    Ok(())
}
