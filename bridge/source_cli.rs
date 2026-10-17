use blabla::runtime::command;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Instant, SystemTime};
use tempfile::TempDir;

const OUTPUT_LIMIT: usize = 2 * 1024 * 1024;
const INPUT_LIMIT: usize = 16 * 1024 * 1024;

type Inventory = BTreeMap<PathBuf, Option<Vec<u8>>>;

enum Transport {
    Cargo {
        inputs: Option<Inventory>,
    },
    Artifact {
        inputs: Inventory,
        executable: PathBuf,
        _owner: TempDir,
    },
}

pub(crate) struct Request {
    source: PathBuf,
    deadline: Instant,
    transport: RefCell<Option<Transport>>,
}

fn check_time(deadline: Instant) -> Result<(), String> {
    if Instant::now() >= deadline {
        Err("source CLI exceeded request deadline".into())
    } else {
        Ok(())
    }
}

fn during<T>(stage: &str, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    #[cfg(test)]
    let started = Instant::now();
    let result = action();
    #[cfg(test)]
    eprintln!("source CLI {stage}: {} ms", started.elapsed().as_millis());
    result.map_err(|error| format!("{error}; source CLI stage: {stage}"))
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

pub(crate) fn artifact_identity(
    path: &Path,
    deadline: Instant,
) -> Result<ArtifactIdentity, String> {
    check_time(deadline)?;
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let before = file.metadata().map_err(|e| e.to_string())?;
    let modified = before.modified().map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    let mut length = 0;
    loop {
        check_time(deadline)?;
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        length += count as u64;
        if length > before.len() {
            return Err("Cargo artifact changed during identity read".into());
        }
        hasher.update(&buffer[..count]);
    }
    let after = file.metadata().map_err(|e| e.to_string())?;
    let selected = fs::metadata(path).map_err(|e| e.to_string())?;
    if length != before.len()
        || after.len() != length
        || selected.len() != length
        || after.modified().map_err(|e| e.to_string())? != modified
        || selected.modified().map_err(|e| e.to_string())? != modified
    {
        return Err("Cargo artifact changed during identity read".into());
    }
    check_time(deadline)?;
    Ok(ArtifactIdentity {
        length,
        modified,
        digest: hasher.finalize().into(),
    })
}

pub(crate) fn verify_artifact(
    path: &Path,
    expected: &ArtifactIdentity,
    deadline: Instant,
) -> Result<(), String> {
    if &artifact_identity(path, deadline)? != expected {
        return Err("source Cargo artifact changed during verification".into());
    }
    Ok(())
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
    pub(crate) fn new(deadline: Instant) -> Self {
        Self::from_source(PathBuf::from(env!("CARGO_MANIFEST_DIR")), deadline)
    }

    pub(crate) fn from_source(source: PathBuf, deadline: Instant) -> Self {
        Self {
            source,
            deadline,
            transport: RefCell::new(None),
        }
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub(crate) fn artifact_path(&self) -> Option<PathBuf> {
        match self.transport.borrow().as_ref() {
            Some(Transport::Artifact { executable, .. }) => Some(executable.clone()),
            _ => None,
        }
    }

    fn acquire(&self) -> Result<Transport, String> {
        check_time(self.deadline)?;
        let inputs = match inventory(&self.source, self.deadline) {
            Ok(inputs) => inputs,
            Err(_) => {
                check_time(self.deadline)?;
                return Ok(Transport::Cargo { inputs: None });
            }
        };
        if !configuration_allows_reuse(&self.source) || !closed_inputs(&inputs, &self.source) {
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
            .arg(self.source.join("Cargo.toml"))
            .current_dir(&self.source);
        let output = during("first Cargo provenance build", || {
            command::run(&mut build, self.deadline, OUTPUT_LIMIT)
        })?;
        let executable = successful_artifact(&output, &self.source)?;
        if inventory(&self.source, self.deadline)? != inputs {
            return Err("source CLI inputs changed during Cargo build".into());
        }
        let Some(original) = executable else {
            return Ok(Transport::Cargo {
                inputs: Some(inputs),
            });
        };
        let (owner, executable, identity) =
            during("owned artifact copy and source SHA-256", || {
                owned_artifact(&original, self.deadline)
            })?;
        during("owned artifact SHA-256", || {
            verify_artifact(&executable, &identity, self.deadline)
        })?;
        let verified = during("second Cargo provenance build", || {
            command::run(&mut build, self.deadline, OUTPUT_LIMIT)
        })?;
        if successful_artifact(&verified, &self.source)?.as_ref() != Some(&original) {
            return Err("source Cargo artifact changed during verification".into());
        }
        during("reverified artifact SHA-256", || {
            verify_artifact(&original, &identity, self.deadline)
        })?;
        if inventory(&self.source, self.deadline)? != inputs {
            return Err("source CLI inputs changed during artifact acquisition".into());
        }
        Ok(Transport::Artifact {
            inputs,
            executable,
            _owner: owner,
        })
    }

    pub(crate) fn finish(&self) -> Result<(), String> {
        check_time(self.deadline)?;
        let transport = self.transport.borrow();
        let inputs = match transport.as_ref() {
            Some(Transport::Artifact { inputs, .. }) => Some(inputs),
            Some(Transport::Cargo { inputs }) => inputs.as_ref(),
            None => None,
        };
        if let Some(inputs) = inputs
            && &inventory(&self.source, self.deadline)? != inputs
        {
            return Err("source CLI inputs changed during request".into());
        }
        check_time(self.deadline)
    }

    pub(crate) fn invoke(
        &self,
        root: &Path,
        arguments: &[&str],
        json: bool,
    ) -> Result<(i32, Value), String> {
        if self.transport.borrow().is_none() {
            *self.transport.borrow_mut() =
                Some(during("transport acquisition", || self.acquire())?);
        }
        during("before CLI invocation", || self.finish())?;
        let transport = self.transport.borrow();
        let mut child = match transport.as_ref().unwrap() {
            Transport::Cargo { .. } => {
                let mut child = Command::new("cargo");
                child
                    .args(["run", "--locked", "--quiet", "--manifest-path"])
                    .arg(self.source.join("Cargo.toml"))
                    .args(["--bin", "blabla", "--"]);
                child
            }
            Transport::Artifact { executable, .. } => Command::new(executable),
        };
        child.current_dir(&self.source).arg("--project").arg(root);
        if json {
            child.arg("--json");
        }
        child.args(arguments);
        let output = during(&format!("CLI child {arguments:?}"), || {
            command::run(&mut child, self.deadline, OUTPUT_LIMIT)
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
        during("after CLI invocation", || self.finish())?;
        Ok((
            output
                .status
                .code()
                .ok_or("source CLI terminated by signal")?,
            value,
        ))
    }
}
