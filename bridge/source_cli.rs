use blabla::runtime::command;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::rc::Rc;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, SyncSender};
use std::time::{Instant, SystemTime};
use tempfile::TempDir;

const OUTPUT_LIMIT: usize = 2 * 1024 * 1024;
const INPUT_LIMIT: usize = 16 * 1024 * 1024;

const DIAGNOSTIC_RECORD_LIMIT: usize = 256;
const DIAGNOSTIC_LINE_LIMIT: usize = 4096;
static NEXT_REQUEST: AtomicU64 = AtomicU64::new(1);
const DIAGNOSTIC_QUEUE_CAPACITY: usize = 64;
static DIAGNOSTIC_STARTING: AtomicBool = AtomicBool::new(false);
static DIAGNOSTIC_SENDER: OnceLock<SyncSender<String>> = OnceLock::new();
static DIAGNOSTIC_DROPPED: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static DIAGNOSTIC_ATTEMPTED: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static DIAGNOSTIC_WRITTEN: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static DIAGNOSTIC_WRITERS_STARTED: AtomicU64 = AtomicU64::new(0);

fn publish_diagnostic(line: String) {
    #[cfg(test)]
    DIAGNOSTIC_ATTEMPTED.fetch_add(1, Ordering::Relaxed);
    if !DIAGNOSTIC_STARTING.swap(true, Ordering::Relaxed) {
        let (sender, receiver) = mpsc::sync_channel::<String>(DIAGNOSTIC_QUEUE_CAPACITY);
        if std::thread::Builder::new()
            .name("blabla-diagnostics".into())
            .spawn(move || {
                #[cfg(test)]
                DIAGNOSTIC_WRITERS_STARTED.fetch_add(1, Ordering::Relaxed);
                while let Ok(line) = receiver.recv() {
                    if writeln!(std::io::stderr().lock(), "{line}").is_err() {
                        DIAGNOSTIC_DROPPED.fetch_add(1, Ordering::Relaxed);
                        break;
                    }
                    #[cfg(test)]
                    DIAGNOSTIC_WRITTEN.fetch_add(1, Ordering::Relaxed);
                }
            })
            .is_ok()
        {
            let _ = DIAGNOSTIC_SENDER.set(sender);
        }
    }
    if DIAGNOSTIC_SENDER
        .get()
        .is_none_or(|sender| sender.try_send(line).is_err())
    {
        DIAGNOSTIC_DROPPED.fetch_add(1, Ordering::Relaxed);
    }
}

#[cfg(test)]
#[allow(dead_code)]
#[derive(Debug)]
pub(crate) struct DiagnosticPublication {
    pub attempted: u64,
    pub dropped: u64,
    pub written: u64,
    pub writers_started: u64,
    pub queue_capacity: usize,
}

#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn diagnostic_publication() -> DiagnosticPublication {
    DiagnosticPublication {
        attempted: DIAGNOSTIC_ATTEMPTED.load(Ordering::Relaxed),
        dropped: DIAGNOSTIC_DROPPED.load(Ordering::Relaxed),
        written: DIAGNOSTIC_WRITTEN.load(Ordering::Relaxed),
        writers_started: DIAGNOSTIC_WRITERS_STARTED.load(Ordering::Relaxed),
        queue_capacity: DIAGNOSTIC_QUEUE_CAPACITY,
    }
}

struct RequestDiagnostics {
    id: u64,
    started: Instant,
    deadline: Instant,
    caller: &'static std::panic::Location<'static>,
    invocation: Cell<u64>,
    fixture: Cell<usize>,
    roots: RefCell<Vec<PathBuf>>,
    records: Cell<usize>,
}

impl RequestDiagnostics {
    #[track_caller]
    fn new(deadline: Instant) -> Option<Self> {
        let caller = std::panic::Location::caller();
        (std::env::var_os("BLABLA_SOURCE_CLI_DIAGNOSTICS").as_deref()
            == Some(std::ffi::OsStr::new("1")))
        .then(|| Self {
            id: NEXT_REQUEST.fetch_add(1, Ordering::Relaxed),
            started: Instant::now(),
            deadline,
            caller,
            invocation: Cell::new(0),
            fixture: Cell::new(0),
            roots: RefCell::new(Vec::new()),
            records: Cell::new(0),
        })
    }

    fn begin(&self, root: &Path) {
        self.invocation.set(self.invocation.get().saturating_add(1));
        let mut roots = self.roots.borrow_mut();
        let fixture = if let Some(index) = roots.iter().position(|known| known == root) {
            index + 1
        } else if roots.len() < 32 && root.as_os_str().len() <= 4096 {
            roots.push(root.to_owned());
            roots.len()
        } else {
            0
        };
        self.fixture.set(fixture);
        self.emit(format_args!("stage=invocation-entry"));
    }

    fn emit(&self, body: std::fmt::Arguments<'_>) {
        let records = self.records.get();
        if records >= DIAGNOSTIC_RECORD_LIMIT {
            return;
        }
        self.records.set(records + 1);
        let file = self.caller.file().rsplit(['/', '\\']).next().unwrap_or("");
        let file: String = file.chars().take(64).collect();
        let now = Instant::now();
        let mut line = format!(
            "source-cli-diagnostic request={} invocation={} fixture={} caller={}:{}:{} elapsed_us={} remaining_us={} telemetry=best-effort missing=not-evidence dropped_at_least={} ",
            self.id,
            self.invocation.get(),
            self.fixture.get(),
            file,
            self.caller.line(),
            self.caller.column(),
            now.duration_since(self.started).as_micros(),
            self.deadline.saturating_duration_since(now).as_micros(),
            DIAGNOSTIC_DROPPED.load(Ordering::Relaxed),
        );
        if records + 1 == DIAGNOSTIC_RECORD_LIMIT {
            line.push_str("stage=trace-limit");
        } else {
            use std::fmt::Write;
            let _ = write!(line, "{body}");
        }
        if line.len() >= DIAGNOSTIC_LINE_LIMIT {
            let mut end = DIAGNOSTIC_LINE_LIMIT - 16;
            while !line.is_char_boundary(end) {
                end -= 1;
            }
            line.truncate(end);
            line.push_str(" truncated=true");
        }
        publish_diagnostic(line);
    }
}

type Inventory = BTreeMap<PathBuf, Option<Vec<u8>>>;

struct VerifiedImage {
    inputs: Inventory,
    executable: PathBuf,
    identity: ArtifactIdentity,
    environment: BTreeMap<std::ffi::OsString, std::ffi::OsString>,
    quarantine: RefCell<Option<ImageIntegrityFailure>>,
    _owner: TempDir,
}

enum Transport {
    Cargo { inputs: Option<Inventory> },
    Artifact(Rc<VerifiedImage>),
}

struct ImageSource {
    source: PathBuf,
    image: RefCell<Option<Rc<VerifiedImage>>>,
}

#[derive(Clone)]
pub(crate) struct ImageScope(Rc<ImageSource>);

impl ImageScope {
    pub(crate) fn new() -> Self {
        Self::from_source(PathBuf::from(env!("CARGO_MANIFEST_DIR")))
    }

    pub(crate) fn from_source(source: PathBuf) -> Self {
        Self(Rc::new(ImageSource {
            source,
            image: RefCell::new(None),
        }))
    }

    pub(crate) fn campaign(&self) -> Campaign {
        Campaign(Rc::new(Source {
            scope: self.clone(),
            transport: RefCell::new(None),
            failure: RefCell::new(None),
        }))
    }
}

struct Source {
    scope: ImageScope,
    transport: RefCell<Option<Transport>>,
    failure: RefCell<Option<String>>,
}

#[derive(Clone)]
pub(crate) struct Campaign(Rc<Source>);

impl Campaign {
    pub(crate) fn new() -> Self {
        ImageScope::new().campaign()
    }

    pub(crate) fn from_source(source: PathBuf) -> Self {
        ImageScope::from_source(source).campaign()
    }

    #[track_caller]
    pub(crate) fn request(&self, deadline: Instant) -> Request {
        Request {
            campaign: self.clone(),
            deadline,
            verified: Cell::new(false),
            diagnostics: RequestDiagnostics::new(deadline),
        }
    }
}

pub(crate) struct Request {
    campaign: Campaign,
    deadline: Instant,
    verified: Cell<bool>,
    diagnostics: Option<RequestDiagnostics>,
}

fn check_time(deadline: Instant) -> Result<(), String> {
    if Instant::now() >= deadline {
        Err("source CLI exceeded request deadline".into())
    } else {
        Ok(())
    }
}

fn during<T>(stage: &str, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    action().map_err(|error| format!("{error}; source CLI stage: {stage}"))
}

fn configurations(source: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for parent in source.ancestors() {
        paths.extend([
            parent.join(".cargo/config"),
            parent.join(".cargo/config.toml"),
        ]);
    }
    let home = std::env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                .map(|p| PathBuf::from(p).join(".cargo"))
        });
    if let Some(home) = home {
        let home = if home.is_absolute() {
            home
        } else {
            source.join(home)
        };
        paths.extend([home.join("config"), home.join("config.toml")]);
    }
    paths
}

pub(crate) fn environment_key_blocks_reuse(key: &str, windows: bool) -> bool {
    let key = if windows {
        key.to_ascii_uppercase()
    } else {
        key.to_owned()
    };
    matches!(
        key.as_str(),
        "RUSTFLAGS"
            | "CARGO_ENCODED_RUSTFLAGS"
            | "RUSTC"
            | "RUSTC_WRAPPER"
            | "RUSTC_WORKSPACE_WRAPPER"
    ) || (key.starts_with("CARGO_TARGET_") && key != "CARGO_TARGET_DIR")
        || (key.starts_with("CARGO_BUILD_") && key != "CARGO_BUILD_JOBS")
        || key.starts_with("CARGO_PROFILE_")
        || key.starts_with("CARGO_UNSTABLE_")
}

pub(crate) fn configuration_allows_reuse(source: &Path) -> bool {
    !std::env::vars_os().any(|(key, value)| {
        !value.is_empty() && environment_key_blocks_reuse(&key.to_string_lossy(), cfg!(windows))
    }) && !configurations(source)
        .iter()
        .any(|p| p.try_exists().unwrap_or(true))
        && !source
            .ancestors()
            .skip(1)
            .any(|p| p.join("Cargo.toml").try_exists().unwrap_or(true))
        && !source.join("build.rs").try_exists().unwrap_or(true)
}

pub(crate) fn inventory(source: &Path, deadline: Instant) -> Result<Inventory, String> {
    fn visit(
        path: &Path,
        result: &mut Inventory,
        left: &mut usize,
        deadline: Instant,
    ) -> Result<(), String> {
        check_time(deadline)?;
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                result.insert(path.to_owned(), None);
                return Ok(());
            }
            Err(e) => return Err(e.to_string()),
        };
        if metadata.file_type().is_symlink() {
            return Err("source CLI cannot inventory linked inputs".into());
        }
        if metadata.is_dir() {
            result.insert(path.to_owned(), None);
            for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
                visit(
                    &entry.map_err(|e| e.to_string())?.path(),
                    result,
                    left,
                    deadline,
                )?;
            }
        } else if metadata.is_file() {
            let mut bytes = Vec::new();
            fs::File::open(path)
                .map_err(|e| e.to_string())?
                .take(*left as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > *left {
                return Err("source CLI input inventory exceeded bound".into());
            }
            *left -= bytes.len();
            result.insert(path.to_owned(), Some(bytes));
        } else {
            return Err("source CLI cannot inventory special inputs".into());
        }
        check_time(deadline)
    }
    let mut result = Inventory::new();
    let mut left = INPUT_LIMIT;
    for path in [
        "src",
        "Cargo.toml",
        "Cargo.lock",
        "rust-toolchain",
        "rust-toolchain.toml",
        "build.rs",
    ] {
        visit(&source.join(path), &mut result, &mut left, deadline)?;
    }
    for parent in source.ancestors().skip(1) {
        visit(&parent.join("Cargo.toml"), &mut result, &mut left, deadline)?;
    }
    for path in configurations(source) {
        visit(&path, &mut result, &mut left, deadline)?;
    }
    Ok(result)
}

pub(crate) fn closed_inputs(inputs: &Inventory, source: &Path) -> bool {
    let Ok(source) = source.canonicalize() else {
        return false;
    };
    fn tokens(
        stream: proc_macro2::TokenStream,
        file: &Path,
        source: &Path,
        attribute: bool,
    ) -> bool {
        use proc_macro2::TokenTree;
        let items: Vec<_> = stream.into_iter().collect();
        for (index, token) in items.iter().enumerate() {
            if let TokenTree::Ident(name) = token {
                let name = name.to_string();
                if matches!(name.as_str(), "include" | "include_str" | "include_bytes")
                    && matches!(items.get(index + 1), Some(TokenTree::Punct(p)) if p.as_char() == '!')
                {
                    let Some(TokenTree::Group(group)) = items.get(index + 2) else {
                        return false;
                    };
                    let Ok(literal) = syn::parse2::<syn::LitStr>(group.stream()) else {
                        return false;
                    };
                    let Ok(path) = file.parent().unwrap().join(literal.value()).canonicalize()
                    else {
                        return false;
                    };
                    if !path.starts_with(source.join("src")) {
                        return false;
                    }
                }
                if attribute
                    && name == "path"
                    && matches!(items.get(index + 1), Some(TokenTree::Punct(p)) if p.as_char() == '=')
                {
                    return false;
                }
            }
            if let TokenTree::Group(group) = token
                && !tokens(
                    group.stream(),
                    file,
                    source,
                    attribute
                        || (group.delimiter() == proc_macro2::Delimiter::Bracket
                            && index > 0
                            && matches!(&items[index - 1], TokenTree::Punct(p) if p.as_char() == '#')),
                )
            {
                return false;
            }
        }
        true
    }
    inputs.iter().all(|(path, bytes)| {
        if path.extension().is_none_or(|ext| ext != "rs") {
            return true;
        }
        let Some(bytes) = bytes else {
            return true;
        };
        std::str::from_utf8(bytes)
            .ok()
            .and_then(|text| text.parse::<proc_macro2::TokenStream>().ok())
            .is_some_and(|stream| tokens(stream, path, &source, false))
    })
}

pub(crate) fn select_artifact(bytes: &[u8], source: &Path) -> Result<Option<PathBuf>, String> {
    let manifest = source
        .join("Cargo.toml")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    let main = source
        .join("src/main.rs")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let mut executable = None;
    let mut finished = false;
    let mut unsupported = false;
    for line in bytes.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
        let value: Value = serde_json::from_slice(line)
            .map_err(|e| format!("source Cargo returned non-JSON: {e}"))?;
        if finished {
            return Err("source Cargo returned records after build completion".into());
        }
        match value["reason"].as_str() {
            Some("build-finished") => {
                if value["success"] != true {
                    return Err("source Cargo build did not succeed".into());
                }
                finished = true;
            }
            Some("compiler-artifact") => {
                let artifact_manifest = value["manifest_path"]
                    .as_str()
                    .ok_or("Cargo artifact missing manifest")?;
                let own = Path::new(artifact_manifest)
                    .canonicalize()
                    .map_err(|e| e.to_string())?
                    == manifest;
                let kinds = value["target"]["kind"]
                    .as_array()
                    .ok_or("Cargo artifact missing target kind")?;
                if kinds.iter().any(|v| v == "dylib" || v == "cdylib") {
                    unsupported = true;
                }
                if !own
                    && !value["package_id"]
                        .as_str()
                        .is_some_and(|id| id.starts_with("registry+"))
                {
                    unsupported = true;
                }
                if own {
                    if kinds.iter().any(|v| v == "custom-build") {
                        unsupported = true;
                    }
                    let path = value["target"]["src_path"]
                        .as_str()
                        .ok_or("Cargo artifact missing source")?;
                    let path = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
                    if !path.starts_with(source.join("src")) {
                        unsupported = true;
                    }
                    if value["target"]["name"] == "blabla" && kinds.iter().any(|kind| kind == "bin")
                    {
                        if kinds.len() != 1 || path != main {
                            return Err("Cargo binary source does not match".into());
                        }
                        let path = value["executable"]
                            .as_str()
                            .ok_or("Cargo binary missing executable")?;
                        let path = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
                        if executable.as_ref().is_some_and(|old| old != &path) {
                            return Err("Cargo returned conflicting binaries".into());
                        }
                        executable = Some(path);
                    }
                }
            }
            Some("build-script-executed") => {
                let libraries = value["linked_libs"]
                    .as_array()
                    .ok_or("Cargo build script omitted linked libraries")?;
                let environment = value["env"]
                    .as_array()
                    .ok_or("Cargo build script omitted environment")?;
                if libraries
                    .iter()
                    .any(|lib| !lib.as_str().is_some_and(|lib| lib.starts_with("static=")))
                    || !environment.is_empty()
                {
                    unsupported = true;
                }
            }
            Some("compiler-message") => {}
            _ => return Err("source Cargo returned an unknown record".into()),
        }
    }
    if !finished {
        return Err("source Cargo omitted successful build completion".into());
    }
    let executable = executable.ok_or("source Cargo omitted exact binary artifact")?;
    Ok((!unsupported).then_some(executable))
}

fn successful_artifact(
    output: &std::process::Output,
    source: &Path,
) -> Result<Option<PathBuf>, String> {
    if !output.status.success() {
        let non_json = output.stdout.is_empty()
            || output
                .stdout
                .split(|b| *b == b'\n')
                .filter(|line| !line.is_empty())
                .any(|line| serde_json::from_slice::<Value>(line).is_err());
        return Err(format!(
            "source Cargo build failed{}: {}",
            if non_json {
                " with non-JSON output"
            } else {
                ""
            },
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    select_artifact(&output.stdout, source)
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ArtifactIdentity {
    length: u64,
    modified: SystemTime,
    digest: [u8; 32],
}

#[derive(Clone)]
struct ImageIntegrityFailure(String);

enum ArtifactCheckError {
    Deadline,
    Integrity(ImageIntegrityFailure),
}

impl ArtifactCheckError {
    fn message(self) -> String {
        match self {
            Self::Deadline => "source CLI exceeded request deadline".into(),
            Self::Integrity(failure) => failure.0,
        }
    }
}

impl From<std::io::Error> for ArtifactCheckError {
    fn from(error: std::io::Error) -> Self {
        Self::Integrity(ImageIntegrityFailure(error.to_string()))
    }
}

fn artifact_time(deadline: Instant) -> Result<(), ArtifactCheckError> {
    check_time(deadline).map_err(|_| ArtifactCheckError::Deadline)
}

fn read_artifact_identity(
    path: &Path,
    deadline: Instant,
) -> Result<ArtifactIdentity, ArtifactCheckError> {
    artifact_time(deadline)?;
    let mut file = fs::File::open(path)?;
    let before = file.metadata()?;
    let modified = before.modified()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    let mut length = 0;
    loop {
        artifact_time(deadline)?;
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        length += count as u64;
        if length > before.len() {
            return Err(ArtifactCheckError::Integrity(ImageIntegrityFailure(
                "Cargo artifact changed during identity read".into(),
            )));
        }
        hasher.update(&buffer[..count]);
    }
    let after = file.metadata()?;
    let selected = fs::metadata(path)?;
    if length != before.len()
        || after.len() != length
        || selected.len() != length
        || after.modified()? != modified
        || selected.modified()? != modified
    {
        return Err(ArtifactCheckError::Integrity(ImageIntegrityFailure(
            "Cargo artifact changed during identity read".into(),
        )));
    }
    artifact_time(deadline)?;
    Ok(ArtifactIdentity {
        length,
        modified,
        digest: hasher.finalize().into(),
    })
}

#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn artifact_identity(
    path: &Path,
    deadline: Instant,
) -> Result<ArtifactIdentity, String> {
    read_artifact_identity(path, deadline).map_err(ArtifactCheckError::message)
}

fn verify_artifact_identity(
    path: &Path,
    expected: &ArtifactIdentity,
    deadline: Instant,
) -> Result<(), ArtifactCheckError> {
    if &read_artifact_identity(path, deadline)? != expected {
        return Err(ArtifactCheckError::Integrity(ImageIntegrityFailure(
            "source Cargo artifact changed during verification".into(),
        )));
    }
    Ok(())
}

pub(crate) fn verify_artifact(
    path: &Path,
    expected: &ArtifactIdentity,
    deadline: Instant,
) -> Result<(), String> {
    verify_artifact_identity(path, expected, deadline).map_err(ArtifactCheckError::message)
}

impl VerifiedImage {
    fn verify(&self, deadline: Instant) -> Result<(), String> {
        if let Some(failure) = self.quarantine.borrow().as_ref() {
            return Err(failure.0.clone());
        }
        match verify_artifact_identity(&self.executable, &self.identity, deadline) {
            Ok(()) => Ok(()),
            Err(ArtifactCheckError::Integrity(failure)) => {
                *self.quarantine.borrow_mut() = Some(failure.clone());
                Err(failure.0)
            }
            Err(error) => Err(error.message()),
        }
    }
}

pub(crate) fn owned_artifact(
    path: &Path,
    deadline: Instant,
) -> Result<(TempDir, PathBuf, ArtifactIdentity), String> {
    check_time(deadline)?;
    let directory = TempDir::new().map_err(|e| e.to_string())?;
    let copy = directory
        .path()
        .join(path.file_name().ok_or("Cargo artifact has no filename")?);
    let mut input = fs::File::open(path).map_err(|e| e.to_string())?;
    let before = input.metadata().map_err(|e| e.to_string())?;
    let modified = before.modified().map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut output = fs::File::create(&copy).map_err(|e| e.to_string())?;
    let mut buffer = [0; 64 * 1024];
    let mut total = 0;
    loop {
        check_time(deadline)?;
        let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > before.len() {
            return Err("Cargo artifact changed while copying".into());
        }
        hasher.update(&buffer[..count]);
        output
            .write_all(&buffer[..count])
            .map_err(|e| e.to_string())?;
    }
    let after = input.metadata().map_err(|e| e.to_string())?;
    let selected = fs::metadata(path).map_err(|e| e.to_string())?;
    if total != before.len()
        || after.len() != before.len()
        || selected.len() != before.len()
        || after.modified().map_err(|e| e.to_string())? != modified
        || selected.modified().map_err(|e| e.to_string())? != modified
    {
        return Err("Cargo artifact changed while copying".into());
    }
    output
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .map_err(|e| e.to_string())?;
    output
        .set_permissions(before.permissions())
        .map_err(|e| e.to_string())?;
    drop(output);
    check_time(deadline)?;
    Ok((
        directory,
        copy,
        ArtifactIdentity {
            length: total,
            modified,
            digest: hasher.finalize().into(),
        },
    ))
}

impl Request {
    #[allow(dead_code)]
    #[track_caller]
    pub(crate) fn new(deadline: Instant) -> Self {
        Campaign::new().request(deadline)
    }

    #[allow(dead_code)]
    #[track_caller]
    pub(crate) fn from_source(source: PathBuf, deadline: Instant) -> Self {
        Campaign::from_source(source).request(deadline)
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub(crate) fn artifact_path(&self) -> Option<PathBuf> {
        match self.campaign.0.transport.borrow().as_ref() {
            Some(Transport::Artifact(image)) => Some(image.executable.clone()),
            _ => None,
        }
    }

    fn observe<T>(
        &self,
        stage: &'static str,
        action: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let Some(diagnostics) = &self.diagnostics else {
            return action();
        };
        let started = Instant::now();
        let result = action();
        diagnostics.emit(format_args!(
            "stage={stage:?} duration_us={} succeeded={}",
            started.elapsed().as_micros(),
            result.is_ok()
        ));
        result
    }

    fn during<T>(
        &self,
        stage: &'static str,
        action: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        self.observe(stage, || during(stage, action))
    }

    fn process(
        &self,
        stage: &'static str,
        child: &mut Command,
    ) -> Result<std::process::Output, String> {
        let Some(diagnostics) = &self.diagnostics else {
            return command::run(child, self.deadline, OUTPUT_LIMIT);
        };
        let (result, process) = command::run_with_diagnostics(child, self.deadline, OUTPUT_LIMIT);
        diagnostics.emit(format_args!(
            "stage={stage:?} succeeded={} process={process:?}",
            result.is_ok()
        ));
        result
    }

    fn acquire(&self) -> Result<Transport, String> {
        check_time(self.deadline)?;
        if let Some(image) = self.campaign.0.scope.0.image.borrow().as_ref() {
            return Ok(Transport::Artifact(image.clone()));
        }
        let environment = std::env::vars_os().collect();
        let inputs = match self.observe("initial inventory", || {
            inventory(&self.campaign.0.scope.0.source, self.deadline)
        }) {
            Ok(inputs) => inputs,
            Err(_) => {
                check_time(self.deadline)?;
                return Ok(Transport::Cargo { inputs: None });
            }
        };
        if !configuration_allows_reuse(&self.campaign.0.scope.0.source)
            || !closed_inputs(&inputs, &self.campaign.0.scope.0.source)
        {
            return Ok(Transport::Cargo {
                inputs: Some(inputs),
            });
        }
        let mut build = Command::new("cargo");
        build
            .args([
                "build",
                "--locked",
                "--bin",
                "blabla",
                "--message-format=json",
                "--manifest-path",
            ])
            .arg(self.campaign.0.scope.0.source.join("Cargo.toml"))
            .current_dir(&self.campaign.0.scope.0.source);
        let output = self.during("first Cargo provenance build", || {
            self.process("first-provenance-process", &mut build)
        })?;
        let executable = successful_artifact(&output, &self.campaign.0.scope.0.source)?;
        if self.observe("post-build inventory", || {
            inventory(&self.campaign.0.scope.0.source, self.deadline)
        })? != inputs
        {
            return Err("source CLI inputs changed during Cargo build".into());
        }
        let Some(original) = executable else {
            return Ok(Transport::Cargo {
                inputs: Some(inputs),
            });
        };
        let (owner, executable, identity) = self
            .during("owned artifact copy and source SHA-256", || {
                owned_artifact(&original, self.deadline)
            })?;
        self.during("owned artifact SHA-256", || {
            verify_artifact(&executable, &identity, self.deadline)
        })?;
        let verified = self.during("second Cargo provenance build", || {
            self.process("second-provenance-process", &mut build)
        })?;
        if successful_artifact(&verified, &self.campaign.0.scope.0.source)?.as_ref()
            != Some(&original)
        {
            return Err("source Cargo artifact changed during verification".into());
        }
        self.during("reverified artifact SHA-256", || {
            verify_artifact(&original, &identity, self.deadline)
        })?;
        if self.observe("post-acquisition inventory", || {
            inventory(&self.campaign.0.scope.0.source, self.deadline)
        })? != inputs
        {
            return Err("source CLI inputs changed during artifact acquisition".into());
        }
        Ok(Transport::Artifact(Rc::new(VerifiedImage {
            inputs,
            executable,
            identity,
            environment,
            quarantine: RefCell::new(None),
            _owner: owner,
        })))
    }

    fn retain_failure<T>(&self, result: Result<T, String>) -> Result<T, String> {
        if let Err(error) = &result {
            self.campaign
                .0
                .failure
                .borrow_mut()
                .get_or_insert_with(|| error.clone());
        }
        result
    }

    fn check_inputs(&self) -> Result<(), String> {
        check_time(self.deadline)?;
        if let Some(error) = self.campaign.0.failure.borrow().as_ref() {
            return Err(error.clone());
        }
        self.retain_failure((|| {
            let transport = self.campaign.0.transport.borrow();
            let inputs = match transport.as_ref() {
                Some(Transport::Artifact(image)) => {
                    if !configuration_allows_reuse(&self.campaign.0.scope.0.source)
                        || image.environment != std::env::vars_os().collect()
                    {
                        return Err(
                            "source CLI build environment or configuration changed during campaign"
                                .into(),
                        );
                    }
                    Some(&image.inputs)
                }
                Some(Transport::Cargo { inputs }) => inputs.as_ref(),
                None => None,
            };
            if let Some(inputs) = inputs
                && &inventory(&self.campaign.0.scope.0.source, self.deadline)? != inputs
            {
                return Err("source CLI inputs changed during request".into());
            }
            check_time(self.deadline)
        })())
    }

    fn check_artifact(&self) -> Result<(), String> {
        check_time(self.deadline)?;
        self.retain_failure((|| {
            if let Some(Transport::Artifact(image)) = self.campaign.0.transport.borrow().as_ref() {
                image.verify(self.deadline)?;
            }
            check_time(self.deadline)
        })())
    }

    pub(crate) fn finish(&self) -> Result<(), String> {
        self.observe("request finish", || self.finish_inner())
    }

    fn finish_inner(&self) -> Result<(), String> {
        check_time(self.deadline)?;
        if !self.verified.get() {
            return Ok(());
        }
        self.check_inputs()?;
        self.check_artifact()?;
        check_time(self.deadline)
    }

    pub(crate) fn invoke(
        &self,
        root: &Path,
        arguments: &[&str],
        json: bool,
    ) -> Result<(i32, Value), String> {
        if let Some(diagnostics) = &self.diagnostics {
            diagnostics.begin(root);
        }
        self.observe("invocation complete", || {
            self.invoke_inner(root, arguments, json)
        })
    }

    fn invoke_inner(
        &self,
        root: &Path,
        arguments: &[&str],
        json: bool,
    ) -> Result<(i32, Value), String> {
        self.observe("entry input validation", || self.check_inputs())?;
        if self.campaign.0.transport.borrow().is_none() {
            let acquired =
                self.retain_failure(self.during("transport acquisition", || self.acquire()))?;
            *self.campaign.0.transport.borrow_mut() = Some(acquired);
        }
        self.during("pre-launch artifact validation", || self.check_artifact())?;
        self.verified.set(true);
        self.during("before CLI invocation", || self.check_inputs())?;
        let transport = self.campaign.0.transport.borrow();
        if let Some(Transport::Artifact(image)) = transport.as_ref() {
            self.campaign
                .0
                .scope
                .0
                .image
                .borrow_mut()
                .get_or_insert_with(|| image.clone());
        }
        let mut child = match transport.as_ref().unwrap() {
            Transport::Cargo { .. } => {
                let mut child = Command::new("cargo");
                child
                    .args(["run", "--locked", "--quiet", "--manifest-path"])
                    .arg(self.campaign.0.scope.0.source.join("Cargo.toml"))
                    .args(["--bin", "blabla", "--"]);
                child
            }
            Transport::Artifact(image) => Command::new(&image.executable),
        };
        child
            .current_dir(&self.campaign.0.scope.0.source)
            .arg("--project")
            .arg(root);
        if json {
            child.arg("--json");
        }
        child.args(arguments);
        let output = self.observe("CLI child", || {
            during(&format!("CLI child {arguments:?}"), || {
                self.process("CLI-process", &mut child)
            })
        })?;
        let value = if json {
            serde_json::from_slice(&output.stdout).map_err(|e| {
                format!(
                    "source CLI returned non-JSON: {e}; {}",
                    String::from_utf8_lossy(&output.stderr)
                )
            })?
        } else {
            Value::String(String::from_utf8(output.stdout).map_err(|e| e.to_string())?)
        };
        self.during("after CLI invocation", || self.check_inputs())?;
        Ok((
            output
                .status
                .code()
                .ok_or("source CLI terminated by signal")?,
            value,
        ))
    }
}
