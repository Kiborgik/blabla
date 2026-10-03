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
