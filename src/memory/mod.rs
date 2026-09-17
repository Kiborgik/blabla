use crate::diagnostic::Diagnostic;
use std::path::Path;

pub mod knowledge;
pub mod mission;
pub mod process;
pub mod routing;
pub mod syntax;
pub mod system;

use syntax::{Block, Field, is_identity_safe};

#[derive(Clone, Debug)]
pub enum Memory<T> {
    Unregistered,
    Ignored(String),
    Missing(String),
    Unreadable(String),
    Invalid(Vec<String>),
    Present(T),
}

impl<T> Memory<T> {
    pub fn state(&self) -> &'static str {
        match self {
            Memory::Unregistered => "unregistered",
            Memory::Ignored(_) => "unregistered",
            Memory::Missing(_) => "missing",
            Memory::Unreadable(_) => "unreadable",
            Memory::Invalid(_) => "invalid",
            Memory::Present(_) => "present",
        }
    }

    pub fn problems(&self) -> Vec<String> {
        match self {
            Memory::Ignored(message) | Memory::Missing(message) | Memory::Unreadable(message) => {
                vec![message.clone()]
            }
            Memory::Invalid(problems) => problems.clone(),
            _ => Vec::new(),
        }
    }

    pub fn present(&self) -> Option<&T> {
        match self {
            Memory::Present(value) => Some(value),
            _ => None,
        }
    }

    pub fn with_problems(self, problems: Vec<String>) -> Self {
        if problems.is_empty() {
            return self;
        }
        match self {
            Memory::Present(_) => Memory::Invalid(problems),
            Memory::Invalid(mut found) => {
                found.extend(problems);
                Memory::Invalid(found)
            }
            other => other,
        }
    }
}

pub fn unregistered<T>(root: &Path, conventional: &str, keyword: &str) -> Memory<T> {
    if root.join(conventional).is_file() {
        Memory::Ignored(format!(
            "{conventional} is present but no `{keyword} \"{conventional}\"` statement registers it, so nothing was read"
        ))
    } else {
        Memory::Unregistered
    }
}

pub fn unregistered_directory<T>(root: &Path, conventional: &str, keyword: &str) -> Memory<T> {
    let directory = root.join(conventional);
    let found = std::fs::read_dir(&directory)
        .map(|entries| {
            let mut names: Vec<String> = entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.extension().is_some_and(|extension| extension == "bla"))
                .map(|path| {
                    format!(
                        "{conventional}/{}",
                        path.file_name().unwrap().to_string_lossy()
                    )
                })
                .collect();
            names.sort();
            names
        })
        .unwrap_or_default();
    if found.is_empty() {
        return Memory::Unregistered;
    }
    Memory::Ignored(format!(
        "{} is present but no `{keyword} \"path\"` statement registers it, so nothing was read",
        found.join(", ")
    ))
}

enum Source {
    Missing(String),
    Unreadable(String),
    Blocks(Vec<Block>),
}

fn source_of(path: &Path, display: &str) -> Source {
    if !path.is_file() {
        return Source::Missing(format!(
            "{display} is registered by project.bla but no file exists there"
        ));
    }
    if path
        .extension()
        .is_some_and(|extension| extension == "json")
    {
        return Source::Unreadable(format!(
            "{display} is JSON; project memory is authored in BlaBla's own .bla syntax"
        ));
    }
    let source = match std::fs::read_to_string(path) {
        Ok(source) => source,
        Err(failure) => {
            return Source::Unreadable(format!("{display} could not be read: {failure}"));
        }
    };
    match syntax::parse(display, &source) {
        Ok(blocks) => Source::Blocks(blocks),
        Err(diagnostic) => Source::Unreadable(said(&diagnostic)),
    }
}

fn built<T>(
    blocks: &[Block],
    build: fn(&[Block]) -> Result<T, Diagnostic>,
    validate: fn(&T) -> Vec<String>,
) -> Memory<T> {
    let value = match build(blocks) {
        Ok(value) => value,
        Err(diagnostic) => return Memory::Unreadable(said(&diagnostic)),
    };
    let problems = validate(&value);
    if problems.is_empty() {
        Memory::Present(value)
    } else {
        Memory::Invalid(problems)
    }
}

pub fn read<T>(
    path: &Path,
    display: &str,
    build: fn(&[Block]) -> Result<T, Diagnostic>,
    validate: fn(&T) -> Vec<String>,
) -> Memory<T> {
    match source_of(path, display) {
        Source::Missing(message) => Memory::Missing(message),
        Source::Unreadable(message) => Memory::Unreadable(message),
        Source::Blocks(blocks) => built(&blocks, build, validate),
    }
}

pub fn read_all<T>(
    entries: &[(&Path, &str)],
    build: fn(&[Block]) -> Result<T, Diagnostic>,
    validate: fn(&T) -> Vec<String>,
) -> Memory<T> {
    let mut blocks = Vec::new();
    for (path, display) in entries {
        match source_of(path, display) {
            Source::Missing(message) => return Memory::Missing(message),
            Source::Unreadable(message) => return Memory::Unreadable(message),
            Source::Blocks(mut found) => blocks.append(&mut found),
        }
    }
    built(&blocks, build, validate)
}

fn said(diagnostic: &Diagnostic) -> String {
    format!(
        "{}:{}:{} [{}] {}",
        diagnostic.location.file,
        diagnostic.location.line,
        diagnostic.location.column,
        diagnostic.code,
        diagnostic.message
    )
}

pub(crate) fn expect_keywords(blocks: &[Block], allowed: &[&str]) -> Result<(), Diagnostic> {
    for block in blocks {
        if !allowed.contains(&block.keyword.as_str()) {
            return Err(Diagnostic {
                location: block.location.clone(),
                code: "E_MEMORY_DECLARATION".into(),
                message: format!(
                    "`{}` is not a declaration of this memory; it declares {}",
                    block.keyword,
                    listed(allowed)
                ),
            });
        }
    }
    Ok(())
}

pub(crate) fn expect_fields(
    block: &Block,
    required: &[&str],
    optional: &[&str],
) -> Result<(), Diagnostic> {
    for field in &block.fields {
        if !required.contains(&field.name.as_str()) && !optional.contains(&field.name.as_str()) {
            return Err(Diagnostic {
                location: field.location.clone(),
                code: "E_MEMORY_FIELD".into(),
                message: format!(
                    "`{}` is not a field of `{}`; it takes {}",
                    field.name,
                    block.keyword,
                    listed(&[required, optional].concat())
                ),
            });
        }
    }
    for name in required {
        if block.field(name).is_none() {
            return Err(Diagnostic {
                location: block.location.clone(),
                code: "E_MEMORY_FIELD".into(),
                message: format!("`{} {:?}` needs `{name}`", block.keyword, block.name),
            });
        }
    }
    Ok(())
}

pub(crate) fn text(block: &Block, name: &str) -> Result<String, Diagnostic> {
    let field = block.field(name).ok_or_else(|| Diagnostic {
        location: block.location.clone(),
        code: "E_MEMORY_FIELD".into(),
        message: format!("`{} {:?}` needs `{name}`", block.keyword, block.name),
    })?;
    if field.list {
        return Err(Diagnostic {
            location: field.location.clone(),
            code: "E_MEMORY_FIELD".into(),
            message: format!("`{name}` takes one quoted value, not a list"),
        });
    }
    Ok(field.text().to_owned())
}

pub(crate) fn list(block: &Block, name: &str) -> Vec<String> {
    block
        .field(name)
        .map(|field| field.values.clone())
        .unwrap_or_default()
}

pub(crate) fn safe_references(field: Option<&Field>) -> Result<(), Diagnostic> {
    let Some(field) = field else {
        return Ok(());
    };
    for value in &field.values {
        if !is_identity_safe(value) {
            return Err(Diagnostic {
                location: field.location.clone(),
                code: "E_MEMORY_NAME".into(),
                message: format!(
                    "{value:?} cannot be part of a canonical identity; a name starts with a letter or digit and continues with letters, digits, '_' or '-'"
                ),
            });
        }
    }
    Ok(())
}

fn listed(names: &[&str]) -> String {
    names
        .iter()
        .map(|name| format!("`{name}`"))
        .collect::<Vec<String>>()
        .join(", ")
}
