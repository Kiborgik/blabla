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

pub(crate) use blabla::runtime::command::DEADLINE_EXPIRED;
pub(crate) const INPUTS_CHANGED: &str = "inputs changed";
pub(crate) const ARTIFACT_CHANGED: &str = "artifact changed";
pub(crate) const BUILD_FAILED: &str = "build failed";
pub(crate) const CONFIGURATION_CHANGED: &str = "configuration changed";
#[cfg(test)]
pub(crate) const ARTIFACT_PARENT_RELATIVE: &str = "artifact parent must be absolute";
pub(crate) const OWNED_COPY_STAGE: &str = "owned artifact copy and source SHA-256";

#[cfg(test)]
fn instrumentation(name: &std::ffi::OsStr, value: &std::ffi::OsStr) -> bool {
    let name = name.to_string_lossy();
    if name == "RUSTC_WRAPPER" {
        return value.to_string_lossy().contains("cargo-llvm-cov");
    }
    [
        "RUSTFLAGS",
        "CARGO_ENCODED_RUSTFLAGS",
        "RUSTDOCFLAGS",
        "CARGO_ENCODED_RUSTDOCFLAGS",
        "CARGO_TARGET_DIR",
        "CARGO_BUILD_TARGET_DIR",
    ]
    .contains(&name.as_ref())
        || name.starts_with("CARGO_LLVM_COV")
        || name.starts_with("__CARGO_LLVM_COV")
}

#[cfg(not(test))]
fn instrumentation(_: &std::ffi::OsStr, _: &std::ffi::OsStr) -> bool {
    false
}

fn build_environment() -> impl Iterator<Item = (std::ffi::OsString, std::ffi::OsString)> {
    std::env::vars_os().filter(|(name, value)| !instrumentation(name, value))
}

pub(crate) fn cargo() -> Command {
    let mut command = Command::new("cargo");
    for (name, _) in std::env::vars_os().filter(|(name, value)| instrumentation(name, value)) {
        command.env_remove(name);
    }
    command
}

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
#[cfg(test)]
static PROVENANCE_BUILDS: AtomicU64 = AtomicU64::new(0);

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
type Stamps = BTreeMap<PathBuf, Option<(u64, SystemTime)>>;

const CACHE_DIRECTORY: &str = "source-cli";
const CACHE_DIGEST: &str = "sha256";

const SHARED_IMAGE_STAGE: &str = "shared";

struct VerifiedImage {
    inputs: Inventory,
    stamps: Option<Stamps>,
    executable: PathBuf,
    identity: ArtifactIdentity,
    environment: BTreeMap<std::ffi::OsString, std::ffi::OsString>,
    quarantine: RefCell<Option<ImageIntegrityFailure>>,
    _owner: Option<TempDir>,
}

enum Transport {
    Cargo { inputs: Option<Inventory> },
    Artifact(Rc<VerifiedImage>),
}

struct ImageSource {
    source: PathBuf,
    cached: bool,
    #[cfg(test)]
    artifact_parent: Option<PathBuf>,
    image: RefCell<Option<Rc<VerifiedImage>>>,
}

#[derive(Clone)]
pub(crate) struct ImageScope(Rc<ImageSource>);

impl ImageScope {
    pub(crate) fn cached(source: PathBuf) -> Self {
        Self::with_storage(source, true)
    }

    pub(crate) fn verify_content(&self, deadline: Instant) -> Result<(), String> {
        let Some(image) = self.0.image.borrow().clone() else {
            return Ok(());
        };
        if inventory(&self.0.source, deadline)? != image.inputs {
            return Err(format!("source CLI {INPUTS_CHANGED} during campaign"));
        }
        verify_artifact(&image.executable, &image.identity, deadline)
    }

    fn with_storage(source: PathBuf, cached: bool) -> Self {
        Self(Rc::new(ImageSource {
            source,
            cached,
            #[cfg(test)]
            artifact_parent: None,
            image: RefCell::new(None),
        }))
    }

    pub(crate) fn campaign(&self) -> Campaign {
        Campaign(Rc::new(Source {
            scope: self.clone(),
            transport: RefCell::new(None),
            failure: RefCell::new(None),
            executable: None,
        }))
    }
}

struct Source {
    scope: ImageScope,
    transport: RefCell<Option<Transport>>,
    failure: RefCell<Option<String>>,
    executable: Option<PathBuf>,
}

#[derive(Clone)]
pub(crate) struct Campaign(Rc<Source>);

impl Campaign {
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
    !build_environment().any(|(key, value)| {
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

fn walk<T>(
    source: &Path,
    deadline: Instant,
    read: &mut dyn FnMut(&Path, &fs::Metadata) -> Result<T, String>,
) -> Result<BTreeMap<PathBuf, Option<T>>, String> {
    fn visit<T>(
        path: &Path,
        metadata: std::io::Result<fs::Metadata>,
        result: &mut BTreeMap<PathBuf, Option<T>>,
        read: &mut dyn FnMut(&Path, &fs::Metadata) -> Result<T, String>,
        deadline: Instant,
    ) -> Result<(), String> {
        command::time_left(deadline)?;
        let metadata = match metadata {
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
                let entry = entry.map_err(|e| e.to_string())?;
                visit(&entry.path(), entry.metadata(), result, read, deadline)?;
            }
        } else if metadata.is_file() {
            result.insert(path.to_owned(), Some(read(path, &metadata)?));
        } else {
            return Err("source CLI cannot inventory special inputs".into());
        }
        command::time_left(deadline)
    }
    let mut result = BTreeMap::new();
    let roots = [
        "src",
        "Cargo.toml",
        "Cargo.lock",
        "rust-toolchain",
        "rust-toolchain.toml",
        "build.rs",
    ]
    .map(|path| source.join(path))
    .into_iter()
    .chain(
        source
            .ancestors()
            .skip(1)
            .map(|parent| parent.join("Cargo.toml")),
    )
    .chain(configurations(source));
    for path in roots {
        let metadata = fs::symlink_metadata(&path);
        visit(&path, metadata, &mut result, read, deadline)?;
    }
    Ok(result)
}

pub(crate) fn inventory(source: &Path, deadline: Instant) -> Result<Inventory, String> {
    let mut left = INPUT_LIMIT;
    walk(source, deadline, &mut |path, _| {
        let mut bytes = Vec::new();
        fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(left as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > left {
            return Err("source CLI input inventory exceeded bound".into());
        }
        left -= bytes.len();
        Ok(bytes)
    })
}

fn stamps(source: &Path, deadline: Instant) -> Result<Stamps, String> {
    walk(source, deadline, &mut |_, metadata| {
        Ok((
            metadata.len(),
            metadata.modified().map_err(|e| e.to_string())?,
        ))
    })
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
            "source Cargo {BUILD_FAILED}{}: {}",
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
            Self::Deadline => DEADLINE_EXPIRED.into(),
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
    command::time_left(deadline).map_err(|_| ArtifactCheckError::Deadline)
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
                format!("Cargo {ARTIFACT_CHANGED} during identity read"),
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
            format!("Cargo {ARTIFACT_CHANGED} during identity read"),
        )));
    }
    artifact_time(deadline)?;
    Ok(ArtifactIdentity {
        length,
        modified,
        digest: hasher.finalize().into(),
    })
}

fn verify_artifact_identity(
    path: &Path,
    expected: &ArtifactIdentity,
    deadline: Instant,
) -> Result<(), ArtifactCheckError> {
    if &read_artifact_identity(path, deadline)? != expected {
        return Err(ArtifactCheckError::Integrity(ImageIntegrityFailure(
            format!("source Cargo {ARTIFACT_CHANGED} during verification"),
        )));
    }
    Ok(())
}

fn verify_artifact_stamp(
    path: &Path,
    expected: &ArtifactIdentity,
) -> Result<(), ArtifactCheckError> {
    let metadata = fs::metadata(path)?;
    if metadata.len() != expected.length || metadata.modified()? != expected.modified {
        return Err(ArtifactCheckError::Integrity(ImageIntegrityFailure(
            format!("source Cargo {ARTIFACT_CHANGED} during verification"),
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
        let checked = match self.stamps {
            Some(_) => verify_artifact_stamp(&self.executable, &self.identity),
            None => verify_artifact_identity(&self.executable, &self.identity, deadline),
        };
        match checked {
            Ok(()) => Ok(()),
            Err(ArtifactCheckError::Integrity(failure)) => {
                *self.quarantine.borrow_mut() = Some(failure.clone());
                Err(failure.0)
            }
            Err(error) => Err(error.message()),
        }
    }
}

fn owned_artifact_in(
    path: &Path,
    deadline: Instant,
    parent: Option<&Path>,
) -> Result<(TempDir, PathBuf, ArtifactIdentity), String> {
    command::time_left(deadline)?;
    let directory = match parent {
        #[cfg(test)]
        Some(parent) if !parent.is_absolute() => {
            return Err(format!("source CLI {ARTIFACT_PARENT_RELATIVE}"));
        }
        Some(parent) => TempDir::new_in(parent),
        None => TempDir::new(),
    }
    .map_err(|e| e.to_string())?;
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
        command::time_left(deadline)?;
        let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > before.len() {
            return Err(format!("Cargo {ARTIFACT_CHANGED} while copying"));
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
        return Err(format!("Cargo {ARTIFACT_CHANGED} while copying"));
    }
    output
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .map_err(|e| e.to_string())?;
    output
        .set_permissions(before.permissions())
        .map_err(|e| e.to_string())?;
    drop(output);
    command::time_left(deadline)?;
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

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn cache_root(source: &Path) -> PathBuf {
    build_environment()
        .find(|(key, _)| key == "CARGO_TARGET_DIR")
        .map_or_else(|| source.join("target"), |(_, value)| source.join(value))
        .join(CACHE_DIRECTORY)
}

fn digest<'a>(entries: impl Iterator<Item = (&'a [u8], Option<&'a [u8]>)>) -> String {
    let mut hasher = Sha256::new();
    for (name, value) in entries {
        hasher.update((name.len() as u64).to_le_bytes());
        hasher.update(name);
        match value {
            Some(value) => {
                hasher.update([1]);
                hasher.update((value.len() as u64).to_le_bytes());
                hasher.update(value);
            }
            None => hasher.update([0]),
        }
    }
    hex(&hasher.finalize()[..16])
}

pub(crate) fn cache_key(
    inputs: &Inventory,
    environment: &BTreeMap<std::ffi::OsString, std::ffi::OsString>,
) -> String {
    let inputs = digest(
        inputs
            .iter()
            .map(|(path, bytes)| (path.as_os_str().as_encoded_bytes(), bytes.as_deref())),
    );
    let environment = digest(
        environment
            .iter()
            .map(|(key, value)| (key.as_encoded_bytes(), Some(value.as_encoded_bytes()))),
    );
    format!("{inputs}-{environment}")
}

fn image_in(entry: &Path) -> PathBuf {
    entry.join(format!("blabla{}", std::env::consts::EXE_SUFFIX))
}

fn cached_image(
    entry: &Path,
    deadline: Instant,
) -> Result<Option<(PathBuf, ArtifactIdentity)>, String> {
    let recorded = match fs::read_to_string(entry.join(CACHE_DIGEST)) {
        Ok(recorded) => recorded,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let executable = image_in(entry);
    let identity =
        read_artifact_identity(&executable, deadline).map_err(ArtifactCheckError::message)?;
    if hex(&identity.digest) != recorded {
        return Err(format!("source CLI cached {ARTIFACT_CHANGED}"));
    }
    Ok(Some((executable, identity)))
}

fn publish(staging: TempDir, entry: &Path, identity: &ArtifactIdentity) -> Result<(), String> {
    fs::write(staging.path().join(CACHE_DIGEST), hex(&identity.digest))
        .map_err(|e| e.to_string())?;
    let root = entry.parent().ok_or("source CLI cache entry has no root")?;
    let name = entry.file_name().unwrap_or_default().to_string_lossy();
    let sources = format!("{}-", name.split('-').next().unwrap_or_default());
    share_identical_image(staging.path(), root, &sources, identity);
    if let Err(error) = fs::rename(staging.path(), entry) {
        return if entry.is_dir() {
            Ok(())
        } else {
            Err(error.to_string())
        };
    }
    for other in fs::read_dir(root).map_err(|e| e.to_string())?.flatten() {
        let other_name = other.file_name();
        let other_name = other_name.to_string_lossy();
        if !other_name.starts_with('.') && !other_name.starts_with(&sources) {
            let _ = fs::remove_dir_all(other.path());
        }
    }
    Ok(())
}

fn share_identical_image(staging: &Path, root: &Path, sources: &str, identity: &ArtifactIdentity) {
    let digest = hex(&identity.digest);
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for other in entries.flatten() {
        if !other.file_name().to_string_lossy().starts_with(sources) {
            continue;
        }
        let shared = image_in(&other.path());
        let identical = fs::read_to_string(other.path().join(CACHE_DIGEST))
            .is_ok_and(|recorded| recorded == digest)
            && fs::metadata(&shared).is_ok_and(|metadata| {
                metadata.len() == identity.length
                    && metadata
                        .modified()
                        .is_ok_and(|modified| modified == identity.modified)
            });
        if identical {
            let linked = staging.join(SHARED_IMAGE_STAGE);
            if fs::hard_link(&shared, &linked).is_ok()
                && fs::rename(&linked, image_in(staging)).is_err()
            {
                let _ = fs::remove_file(&linked);
            }
            return;
        }
    }
}

fn artifact(
    inputs: Inventory,
    stamps: Option<Stamps>,
    (executable, identity): (PathBuf, ArtifactIdentity),
    environment: BTreeMap<std::ffi::OsString, std::ffi::OsString>,
    owner: Option<TempDir>,
) -> Transport {
    Transport::Artifact(Rc::new(VerifiedImage {
        inputs,
        stamps,
        executable,
        identity,
        environment,
        quarantine: RefCell::new(None),
        _owner: owner,
    }))
}

impl Request {
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
        command::time_left(self.deadline)?;
        let scope = &self.campaign.0.scope.0;
        if let Some(image) = scope.image.borrow().as_ref() {
            return Ok(Transport::Artifact(image.clone()));
        }
        let environment: BTreeMap<std::ffi::OsString, std::ffi::OsString> =
            build_environment().collect();
        let cached = scope.cached;
        let observed = self.observe("initial inventory", || {
            let stamped = cached
                .then(|| stamps(&scope.source, self.deadline))
                .transpose()?;
            Ok((stamped, inventory(&scope.source, self.deadline)?))
        });
        let (stamped, inputs) = match observed {
            Ok(observed) => observed,
            Err(_) => {
                command::time_left(self.deadline)?;
                return Ok(Transport::Cargo { inputs: None });
            }
        };
        if !configuration_allows_reuse(&scope.source) || !closed_inputs(&inputs, &scope.source) {
            return Ok(Transport::Cargo {
                inputs: Some(inputs),
            });
        }
        let entry =
            cached.then(|| cache_root(&scope.source).join(cache_key(&inputs, &environment)));
        if let Some(entry) = &entry
            && let Some((executable, identity)) = self.during("cached artifact SHA-256", || {
                cached_image(entry, self.deadline)
            })?
        {
            return Ok(artifact(
                inputs,
                stamped,
                (executable, identity),
                environment,
                None,
            ));
        }
        let mut build = cargo();
        build
            .args([
                "build",
                "--locked",
                "--bin",
                "blabla",
                "--message-format=json",
                "--manifest-path",
            ])
            .arg(scope.source.join("Cargo.toml"))
            .current_dir(&scope.source);
        #[cfg(test)]
        PROVENANCE_BUILDS.fetch_add(1, Ordering::Relaxed);
        let output = self.during("first Cargo provenance build", || {
            self.process("first-provenance-process", &mut build)
        })?;
        let executable = successful_artifact(&output, &scope.source)?;
        if self.observe("post-build inventory", || {
            inventory(&scope.source, self.deadline)
        })? != inputs
        {
            return Err(format!("source CLI {INPUTS_CHANGED} during Cargo build"));
        }
        let Some(original) = executable else {
            return Ok(Transport::Cargo {
                inputs: Some(inputs),
            });
        };
        let (owner, executable, identity) = self.during(OWNED_COPY_STAGE, || {
            let mut parent = None;
            if cached {
                let root = cache_root(&scope.source);
                fs::create_dir_all(&root).map_err(|e| e.to_string())?;
                parent = Some(root);
            }
            #[cfg(test)]
            if !cached {
                parent = scope.artifact_parent.clone();
            }
            owned_artifact_in(&original, self.deadline, parent.as_deref())
        })?;
        self.during("owned artifact SHA-256", || {
            verify_artifact(&executable, &identity, self.deadline)
        })?;
        let verified = self.during("second Cargo provenance build", || {
            self.process("second-provenance-process", &mut build)
        })?;
        if successful_artifact(&verified, &scope.source)?.as_ref() != Some(&original) {
            return Err(format!(
                "source Cargo {ARTIFACT_CHANGED} during verification"
            ));
        }
        self.during("reverified artifact SHA-256", || {
            verify_artifact(&original, &identity, self.deadline)
        })?;
        if self.observe("post-acquisition inventory", || {
            inventory(&scope.source, self.deadline)
        })? != inputs
        {
            return Err(format!(
                "source CLI {INPUTS_CHANGED} during artifact acquisition"
            ));
        }
        let Some(entry) = entry else {
            return Ok(artifact(
                inputs,
                stamped,
                (executable, identity),
                environment,
                Some(owner),
            ));
        };
        let published = self.during("cache publication", || {
            publish(owner, &entry, &identity)?;
            cached_image(&entry, self.deadline)?
                .ok_or_else(|| format!("source CLI cache entry {} is incomplete", entry.display()))
        })?;
        Ok(artifact(inputs, stamped, published, environment, None))
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
        command::time_left(self.deadline)?;
        if let Some(error) = self.campaign.0.failure.borrow().as_ref() {
            return Err(error.clone());
        }
        self.retain_failure((|| {
            let source = &self.campaign.0.scope.0.source;
            let transport = self.campaign.0.transport.borrow();
            let changed = match transport.as_ref() {
                Some(Transport::Artifact(image)) => {
                    if !configuration_allows_reuse(source)
                        || image.environment != build_environment().collect()
                    {
                        return Err(format!(
                            "source CLI build environment or {CONFIGURATION_CHANGED} during campaign"
                        ));
                    }
                    match &image.stamps {
                        Some(stamped) => &stamps(source, self.deadline)? != stamped,
                        None => inventory(source, self.deadline)? != image.inputs,
                    }
                }
                Some(Transport::Cargo {
                    inputs: Some(inputs),
                }) => &inventory(source, self.deadline)? != inputs,
                _ => false,
            };
            if changed {
                return Err(format!("source CLI {INPUTS_CHANGED} during request"));
            }
            command::time_left(self.deadline)
        })())
    }

    fn check_artifact(&self) -> Result<(), String> {
        command::time_left(self.deadline)?;
        self.retain_failure((|| {
            if let Some(Transport::Artifact(image)) = self.campaign.0.transport.borrow().as_ref() {
                image.verify(self.deadline)?;
            }
            command::time_left(self.deadline)
        })())
    }

    pub(crate) fn finish(&self) -> Result<(), String> {
        self.observe("request finish", || self.finish_inner())
    }

    fn finish_inner(&self) -> Result<(), String> {
        command::time_left(self.deadline)?;
        if !self.verified.get() {
            return Ok(());
        }
        self.check_inputs()?;
        self.check_artifact()?;
        command::time_left(self.deadline)
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
        if self.campaign.0.transport.borrow().is_none() {
            self.observe("entry input validation", || self.check_inputs())?;
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
        let mut child = match (transport.as_ref().unwrap(), &self.campaign.0.executable) {
            (Transport::Artifact(image), _) => Command::new(&image.executable),
            (Transport::Cargo { .. }, Some(executable)) => Command::new(executable),
            (Transport::Cargo { .. }, None) => {
                let mut child = cargo();
                child
                    .args(["run", "--locked", "--quiet", "--manifest-path"])
                    .arg(self.campaign.0.scope.0.source.join("Cargo.toml"))
                    .args(["--bin", "blabla", "--"]);
                child
            }
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
        Ok((
            output
                .status
                .code()
                .ok_or("source CLI terminated by signal")?,
            value,
        ))
    }
}
