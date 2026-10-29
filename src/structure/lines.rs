use super::{ModuleDecl, normalize};
use crate::project::ignore::Ignore;
use std::path::{Component, Path};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileLines {
    pub path: String,
    pub lines: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LineFacts {
    Absent,
    OutsideRoot,
    Unreadable(String),
    Counted(Vec<FileLines>),
}

#[derive(Default)]
pub struct Tree {
    files: Option<Vec<String>>,
}

impl Tree {
    fn files(&mut self, root: &Path, ignore: &Ignore) -> &[String] {
        self.files
            .get_or_insert_with(|| crate::project::file_names(root, ignore))
            .as_slice()
    }
}

pub fn count(bytes: &[u8]) -> usize {
    let terminated = bytes.iter().filter(|byte| **byte == b'\n').count();
    match bytes.last() {
        Some(last) if *last != b'\n' => terminated + 1,
        _ => terminated,
    }
}

pub fn observe(root: &Path, module: &ModuleDecl, ignore: &Ignore, tree: &mut Tree) -> LineFacts {
    if module.path.is_file() {
        return count_files(vec![(module.display.clone(), module.path.clone())]);
    }
    if !module.path.is_dir() {
        return LineFacts::Absent;
    }
    let located = normalize(&module.path);
    let Ok(relative) = located.strip_prefix(normalize(root)) else {
        return LineFacts::OutsideRoot;
    };
    let prefix = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    let inside = identity(&format!("{prefix}/"));
    let files = tree
        .files(root, ignore)
        .iter()
        .filter(|name| prefix.is_empty() || identity(name).starts_with(&inside))
        .map(|name| (name.clone(), root.join(name)))
        .collect();
    count_files(files)
}

fn identity(path: &str) -> String {
    if cfg!(windows) {
        path.to_lowercase()
    } else {
        path.to_owned()
    }
}

fn count_files(files: Vec<(String, std::path::PathBuf)>) -> LineFacts {
    let mut counted = Vec::with_capacity(files.len());
    for (name, path) in files {
        match std::fs::read(&path) {
            Ok(bytes) => counted.push(FileLines {
                path: name,
                lines: count(&bytes),
            }),
            Err(failure) => {
                return LineFacts::Unreadable(format!("{name} could not be read: {failure}"));
            }
        }
    }
    counted.sort_by(|left, right| left.path.cmp(&right.path));
    LineFacts::Counted(counted)
}
