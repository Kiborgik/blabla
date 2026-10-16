use super::{Task, directory, path_of, read, recorded_names};
use std::fs::{File, OpenOptions, TryLockError};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

pub struct RecordLock(File);

impl Drop for RecordLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

pub fn lock(root: &Path) -> Result<RecordLock, String> {
    let directory = directory(root);
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("cannot create task store: {error}"))?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join(".store.lock"))
        .map_err(|error| format!("cannot open task lock: {error}"))?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(RecordLock(file)),
            Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10))
            }
            Err(TryLockError::WouldBlock) => {
                return Err("task store lock acquisition exceeded 5 seconds".to_owned());
            }
            Err(TryLockError::Error(error)) => {
                return Err(format!("cannot lock task store: {error}"));
            }
        }
    }
}

pub fn transaction<T>(
    root: &Path,
    f: impl FnOnce(&mut Vec<Task>) -> Result<T, String>,
) -> Result<T, String> {
    let _lock = lock(root)?;
    let mut tasks = recorded_names(root)
        .iter()
        .map(|name| {
            read(root, name)
                .and_then(|task| task.ok_or_else(|| format!("task {name:?} disappeared")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let before = tasks
        .iter()
        .map(|task| serde_json::to_vec(task).expect("task serializes"))
        .collect::<Vec<_>>();
    let result = f(&mut tasks)?;
    for task in &tasks {
        let encoded = serde_json::to_vec(task).expect("task serializes");
        if !before.contains(&encoded) {
            replace(root, task).map_err(|error| format!("cannot record task: {error}"))?;
        }
    }
    Ok(result)
}

pub fn replace(root: &Path, task: &Task) -> io::Result<PathBuf> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let path = path_of(root, &task.name);
    std::fs::create_dir_all(directory(root))?;
    let temporary = directory(root).join(format!(
        ".{}-{}-{}.tmp",
        task.name,
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&serde_json::to_vec_pretty(task).map_err(io::Error::other)?)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, &path)?;
        Ok(path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

pub fn opened_directory(root: &Path, name: &str) -> PathBuf {
    directory(root).join(format!("{name}.opened"))
}

fn write_under(base: &Path, relative: &str, bytes: &[u8]) -> io::Result<()> {
    let target = base.join(relative);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(target, bytes)
}

fn remove_file_if_present(path: &Path) -> io::Result<()> {
    if path.is_file() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

pub fn record_opened(root: &Path, name: &str, paths: &[String]) -> io::Result<()> {
    for path in paths {
        let current = root.join(path);
        if current.is_file() {
            write_under(
                &opened_directory(root, name),
                path,
                &std::fs::read(&current)?,
            )?;
        }
    }
    Ok(())
}

pub fn copy_into(root: &Path, copy: &Path, files: &[String]) -> io::Result<()> {
    std::fs::create_dir_all(copy)?;
    for file in files {
        let target = copy.join(file);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(root.join(file), target)?;
    }
    Ok(())
}

pub fn apply_opened(copy: &Path, opened: &Path, paths: &[String]) -> io::Result<()> {
    for path in paths {
        let source = opened.join(path);
        if source.is_file() {
            write_under(copy, path, &std::fs::read(&source)?)?;
        } else {
            remove_file_if_present(&copy.join(path))?;
        }
    }
    Ok(())
}

pub fn discard_falsification(root: &Path, name: &str) -> io::Result<()> {
    let opened = opened_directory(root, name);
    if opened.is_dir() {
        std::fs::remove_dir_all(opened)?;
    }
    discard_copies(root, name)
}

pub fn discard_copies(root: &Path, name: &str) -> io::Result<()> {
    let Ok(entries) = std::fs::read_dir(super::scratch_directory(root, name)) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(super::FALSIFY_TREE_PREFIX)
        {
            std::fs::remove_dir_all(entry.path())?;
        }
    }
    Ok(())
}
