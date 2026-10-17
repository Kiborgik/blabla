use super::ignore::Ignore;
use super::{Manifest, always_tracked, normalize, relative, skipped_directory};
use crate::diagnostic::{Diagnostic, Location, Span};
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_MAX_ENTRIES: usize = 20_000;
const MAX_DEPTH: usize = 64;

#[derive(Debug, Serialize)]
pub struct Inventory {
    pub project: String,
    pub manifest: String,
    pub complete: bool,
    pub scanned_entries: usize,
    pub max_entries: usize,
    pub entries: Vec<Entry>,
    pub boundaries: Vec<Boundary>,
    pub diagnostics: Vec<Problem>,
}

#[derive(Debug, Serialize)]
pub struct Entry {
    pub path: String,
    pub resolved_path: String,
    pub registration: String,
    pub kind: String,
    pub identities: Vec<String>,
    pub readability: String,
    pub external: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registered_at: Option<Location>,
}

#[derive(Debug, Serialize)]
pub struct Boundary {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct Problem {
    pub path: String,
    pub code: String,
    pub message: String,
}

impl Inventory {
    pub fn successful(&self) -> bool {
        self.complete && self.diagnostics.is_empty()
    }

    fn problem(&mut self, path: String, code: &str, message: String) {
        self.diagnostics.push(Problem {
            path,
            code: code.to_owned(),
            message,
        });
    }

    fn boundary(&mut self, path: String, reason: &str) {
        self.boundaries.push(Boundary {
            path,
            reason: reason.to_owned(),
        });
    }
}

fn readability(path: &Path) -> &'static str {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => return "symlink",
            Ok(_) => {}
            Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => return "missing",
            Err(_) => return "unreadable",
        }
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() => "not_file",
        Ok(_) => match fs::File::open(path) {
            Ok(_) => "readable",
            Err(_) => "unreadable",
        },
        Err(_) => "unreadable",
    }
}

struct Registration<'a> {
    path: &'a Path,
    display: &'a str,
    kind: &'a str,
    state: &'a str,
    identities: Vec<String>,
    span: Span,
}

fn registrations(manifest: &Manifest) -> Vec<Registration<'_>> {
    let mut registrations = vec![Registration {
        path: &manifest.path,
        display: manifest
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(super::MANIFEST_NAME),
        kind: "project",
        state: "manifest",
        identities: Vec::new(),
        span: Span {
            line: 1,
            column: 1,
            ..Span::default()
        },
    }];
    registrations.extend(manifest.entries.iter().map(|entry| Registration {
        path: &entry.path,
        display: &entry.display,
        kind: entry.layer.word(),
        state: if entry.draft { "draft" } else { "active" },
        identities: vec![format!("contract::{}", entry.group)],
        span: entry.span,
    }));
    for (kind, entries) in [
        ("mission", manifest.mission.iter().collect::<Vec<_>>()),
        ("system", manifest.system.iter().collect()),
        ("process", manifest.process.iter().collect()),
        ("knowledge", manifest.knowledge.iter().collect()),
        ("goal", manifest.goal.iter().collect()),
    ] {
        registrations.extend(entries.into_iter().map(|entry| Registration {
            path: &entry.path,
            display: &entry.display,
            kind,
            state: "memory",
            identities: Vec::new(),
            span: entry.span,
        }));
    }
    registrations
}

pub fn collect(manifest: &Manifest, max_entries: usize) -> Result<Inventory, Diagnostic> {
    let ignore = Ignore::new(&manifest.root, &manifest.ignores, always_tracked(manifest)).map_err(
        |failure| {
            Diagnostic::new(
                &manifest.path.display().to_string(),
                failure.span,
                failure.code,
                failure.message,
            )
        },
    )?;
    let root = normalize(&manifest.root);
    let mut inventory = Inventory {
        project: manifest.name.clone(),
        manifest: manifest.path.display().to_string(),
        complete: true,
        scanned_entries: 0,
        max_entries,
        entries: Vec::new(),
        boundaries: Vec::new(),
        diagnostics: Vec::new(),
    };
    let mut registered = BTreeSet::new();
    for registration in registrations(manifest) {
        let path = normalize(registration.path);
        registered.insert(path.clone());
        let readable = readability(&path);
        if readable != "readable" {
            inventory.problem(registration.display.to_owned(), "registered_file", format!("registered {} file is {readable}; inventory does not compile or validate its contents", registration.kind));
        }
        inventory.entries.push(Entry {
            path: registration.display.to_owned(),
            resolved_path: path.display().to_string(),
            registration: registration.state.to_owned(),
            kind: registration.kind.to_owned(),
            identities: registration.identities,
            readability: readable.to_owned(),
            external: !path.starts_with(&root),
            registered_at: Some(Location {
                file: manifest.path.display().to_string(),
                line: registration.span.line,
                column: registration.span.column,
            }),
        });
    }
    scan(&root, &root, 0, &ignore, &registered, &mut inventory);
    inventory.entries.sort_by(|left, right| {
        (&left.path, &left.registration, &left.kind).cmp(&(
            &right.path,
            &right.registration,
            &right.kind,
        ))
    });
    inventory
        .boundaries
        .sort_by(|left, right| (&left.path, &left.reason).cmp(&(&right.path, &right.reason)));
    inventory
        .diagnostics
        .sort_by(|left, right| (&left.path, &left.code).cmp(&(&right.path, &right.code)));
    Ok(inventory)
}

fn scan(
    root: &Path,
    directory: &Path,
    depth: usize,
    ignore: &Ignore,
    registered: &BTreeSet<PathBuf>,
    inventory: &mut Inventory,
) {
    if !inventory.complete {
        return;
    }
    let name = relative(root, directory);
    if depth > MAX_DEPTH {
        inventory.complete = false;
        inventory.problem(
            name,
            "scan_limit",
            format!("directory depth exceeds {MAX_DEPTH}; discovery is incomplete"),
        );
        return;
    }
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(failure) => {
            inventory.complete = false;
            inventory.problem(name, "unreadable_directory", failure.to_string());
            return;
        }
    };
    let remaining = inventory
        .max_entries
        .saturating_sub(inventory.scanned_entries);
    let children = entries
        .take(remaining.saturating_add(1))
        .collect::<Result<Vec<_>, _>>();
    let mut children = match children {
        Ok(children) if children.len() <= remaining => children,
        Ok(_) => {
            inventory.scanned_entries += remaining.saturating_add(1);
            inventory.complete = false;
            inventory.problem(name, "scan_limit", format!("directory exceeds the remaining entry budget ({} total); discovery is incomplete", inventory.max_entries));
            return;
        }
        Err(failure) => {
            inventory.complete = false;
            inventory.problem(name, "unreadable_directory", failure.to_string());
            return;
        }
    };
    inventory.scanned_entries += children.len();
    children.sort_by_key(|child| child.file_name());
    for child in children {
        let path = child.path();
        let name = relative(root, &path);
        let kind = match child.file_type() {
            Ok(kind) => kind,
            Err(failure) => {
                inventory.complete = false;
                inventory.problem(name, "unreadable_entry", failure.to_string());
                continue;
            }
        };
        if kind.is_symlink() {
            inventory.boundary(name, "symlink");
        } else if kind.is_dir() {
            if skipped_directory(&child.file_name().to_string_lossy()) {
                inventory.boundary(name, "generated_or_internal");
            } else if ignore.skips_directory(&name) {
                inventory.boundary(name, "ignored");
            } else if fs::symlink_metadata(path.join(super::MANIFEST_NAME)).is_ok() {
                inventory.boundary(name, "nested_project");
            } else {
                scan(root, &path, depth + 1, ignore, registered, inventory);
            }
        } else if kind.is_file()
            && path.extension().is_some_and(|extension| extension == "bla")
            && !registered.contains(&normalize(&path))
            && !ignore.skips_file(&name)
        {
            inventory.entries.push(Entry {
                path: name,
                resolved_path: path.display().to_string(),
                registration: "unregistered".to_owned(),
                kind: "unknown".to_owned(),
                identities: Vec::new(),
                readability: readability(&path).to_owned(),
                external: false,
                registered_at: None,
            });
        }
    }
}
