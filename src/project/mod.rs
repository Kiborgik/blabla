use crate::diagnostic::{Diagnostic, Location, Span};
use crate::ir::Contract;
use crate::report::{DEFAULT_CASES, DEFAULT_STEPS, DEFAULT_TIMEOUT_MS, MAX_SHRINK_ATTEMPTS};
use crate::runtime::{MAX_TIMEOUT, primitives};
use crate::semantics::{Unit, compile_units};
use crate::structure::{self, StructureContract, StructureReport, StructureRule};
use crate::syntax::{self, Lexer, Token, TokenKind};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

pub mod runstate;
pub mod status;

pub const MANIFEST_NAME: &str = "project.bla";
pub const PROFILE_FIELDS: &str = "command, seed, cases, steps, timeout_ms, shrink_budget";

const SKIPPED_DIRECTORIES: &[&str] = &[
    ".blabla",
    ".git",
    "target",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    ".hypothesis",
    ".serena",
    ".idea",
    ".vscode",
    ".pytest_cache",
];

const CONTENT_HASH_LIMIT: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct Manifest {
    pub name: String,
    pub path: PathBuf,
    pub root: PathBuf,
    pub source: String,
    pub entries: Vec<Entry>,
    pub profile: Option<Profile>,
    pub profile_span: Option<Span>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Profile {
    pub command: Vec<String>,
    pub seed: u64,
    pub cases: usize,
    pub steps: usize,
    pub timeout_ms: u64,
    pub shrink_budget: usize,
}

#[derive(Clone, Debug)]
pub struct ResolvedCommand {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub written: Vec<String>,
}

enum Statement {
    Entry(Entry),
    Profile(Profile, Span),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Layer {
    Behavior,
    Structure,
}

impl Layer {
    pub fn word(self) -> &'static str {
        match self {
            Layer::Behavior => "behavior",
            Layer::Structure => "structure",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Entry {
    pub group: String,
    pub display: String,
    pub path: PathBuf,
    pub draft: bool,
    pub layer: Layer,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub struct Rule {
    pub id: String,
    pub group: String,
    pub label: String,
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub source: String,
    pub action: Option<String>,
    pub runtime: Option<&'static str>,
}

#[derive(Clone, Debug)]
pub struct Group {
    pub name: String,
    pub display: String,
    pub rules: usize,
    pub layer: Layer,
}

#[derive(Clone, Debug)]
pub struct Draft {
    pub name: String,
    pub display: String,
    pub layer: Layer,
    pub check: Result<(), Diagnostic>,
}

#[derive(Debug)]
pub struct Project {
    pub manifest: Manifest,
    pub contract: Option<Contract>,
    pub rules: Vec<Rule>,
    pub groups: Vec<Group>,
    pub structure: Vec<StructureContract>,
    pub drafts: Vec<Draft>,
    pub identity: String,
}

#[derive(Clone)]
pub enum Lookup<'a> {
    Rule(&'a Rule),
    Structure(&'a StructureRule),
    Action(String),
}

impl Lookup<'_> {
    fn id(&self) -> &str {
        match self {
            Lookup::Rule(rule) => &rule.id,
            Lookup::Structure(rule) => &rule.id,
            Lookup::Action(name) => name,
        }
    }

    fn label(&self) -> &str {
        match self {
            Lookup::Rule(rule) => &rule.label,
            Lookup::Structure(rule) => &rule.label,
            Lookup::Action(name) => name,
        }
    }
}

pub fn discover(start: &Path) -> Option<PathBuf> {
    let mut directory = Some(start);
    while let Some(dir) = directory {
        let candidate = dir.join(MANIFEST_NAME);
        if candidate.is_file() {
            return Some(candidate);
        }
        directory = dir.parent();
    }
    None
}

pub fn locate(explicit: Option<&Path>, cwd: &Path) -> Result<PathBuf, Diagnostic> {
    match explicit {
        Some(given) => {
            let absolute = if given.is_absolute() {
                given.to_path_buf()
            } else {
                cwd.join(given)
            };
            if absolute.is_dir() {
                let candidate = absolute.join(MANIFEST_NAME);
                if candidate.is_file() {
                    return Ok(candidate);
                }
                return Err(no_project(
                    &absolute,
                    format!("no {MANIFEST_NAME} in {}", absolute.display()),
                ));
            }
            if absolute.is_file() {
                return Ok(absolute);
            }
            Err(no_project(
                &absolute,
                format!("project manifest {} does not exist", absolute.display()),
            ))
        }
        None => discover(cwd).ok_or_else(|| {
            no_project(
                cwd,
                format!(
                    "no {MANIFEST_NAME} found in {} or its parent directories; run `blabla init` here or pass a contract file",
                    cwd.display()
                ),
            )
        }),
    }
}

fn no_project(path: &Path, message: String) -> Diagnostic {
    Diagnostic {
        location: Location {
            file: path.display().to_string(),
            line: 1,
            column: 1,
        },
        code: "E_NO_PROJECT".into(),
        message,
    }
}

pub fn read_manifest(path: &Path) -> Result<Manifest, Diagnostic> {
    let display = path.display().to_string();
    let source = std::fs::read_to_string(path).map_err(|failure| Diagnostic {
        location: Location {
            file: display.clone(),
            line: 1,
            column: 1,
        },
        code: "E_SOURCE_IO".into(),
        message: failure.to_string(),
    })?;
    parse_manifest(path, &source)
}

pub fn parse_manifest(path: &Path, source: &str) -> Result<Manifest, Diagnostic> {
    let display = path.display().to_string();
    let root = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let tokens = Lexer::new(&display, source).lex()?;
    let mut parser = ManifestParser {
        file: &display,
        tokens: &tokens,
        position: 0,
    };
    let name = parser.header()?;
    let mut entries = Vec::new();
    let mut paths = HashSet::new();
    let mut groups = HashSet::new();
    let mut profile = None;
    let mut profile_span = None;
    while !parser.at_end() {
        match parser.statement(&root)? {
            Statement::Profile(parsed, span) => {
                if profile.is_some() {
                    return Err(parser.error(
                        span,
                        "E_DUPLICATE_PROFILE",
                        "the manifest declares more than one `verify behavior` profile; a project has exactly one canonical verification",
                    ));
                }
                profile = Some(parsed);
                profile_span = Some(span);
            }
            Statement::Entry(entry) => {
                if !paths.insert(normalize(&entry.path)) {
                    return Err(parser.error(
                        entry.span,
                        "E_DUPLICATE_USE",
                        format!("contract '{}' is referenced more than once", entry.display),
                    ));
                }
                if !groups.insert(entry.group.clone()) {
                    return Err(parser.error(
                        entry.span,
                        "E_DUPLICATE_GROUP",
                        format!(
                            "group '{}' is used by more than one contract; add `as <name>` to one of them",
                            entry.group
                        ),
                    ));
                }
                entries.push(entry);
            }
        }
    }
    Ok(Manifest {
        name,
        path: path.to_path_buf(),
        root,
        source: source.to_owned(),
        entries,
        profile,
        profile_span,
    })
}

struct ManifestParser<'a> {
    file: &'a str,
    tokens: &'a [Token],
    position: usize,
}

impl ManifestParser<'_> {
    fn header(&mut self) -> Result<String, Diagnostic> {
        let token = self.current();
        match &token.kind {
            TokenKind::Identifier(word) if word == "project" => {
                self.position += 1;
            }
            _ => {
                return Err(self.error(
                    token.span,
                    "E_PROJECT_HEADER",
                    "a project manifest must start with `project <Name>`",
                ));
            }
        }
        let token = self.current().clone();
        match &token.kind {
            TokenKind::Identifier(name) => {
                self.position += 1;
                Ok(name.clone())
            }
            _ => Err(self.error(
                token.span,
                "E_PROJECT_HEADER",
                "expected the project name after `project`",
            )),
        }
    }

    fn statement(&mut self, root: &Path) -> Result<Statement, Diagnostic> {
        let start = self.current().clone();
        let draft = match &start.kind {
            TokenKind::Identifier(word) if word == "use" => false,
            TokenKind::Identifier(word) if word == "draft" => true,
            TokenKind::Identifier(word) if word == "verify" => {
                self.position += 1;
                let layer_span = self.current().span;
                if self.layer()? != Layer::Behavior {
                    return Err(self.error(
                        layer_span,
                        "E_PROFILE_LAYER",
                        "only `verify behavior { ... }` exists; structure contracts are evaluated statically and need no profile",
                    ));
                }
                return self
                    .profile(start.span)
                    .map(|(profile, span)| Statement::Profile(profile, span));
            }
            _ => {
                return Err(self.error(
                    start.span,
                    "E_MANIFEST_STATEMENT",
                    "expected `use behavior \"path\"`, `draft behavior \"path\"` or `verify behavior { ... }`",
                ));
            }
        };
        self.position += 1;
        let layer = self.layer()?;
        let path_token = self.current().clone();
        let TokenKind::String(written) = &path_token.kind else {
            return Err(self.error(
                path_token.span,
                "E_MANIFEST_STATEMENT",
                "expected a quoted contract path",
            ));
        };
        self.position += 1;
        let mut alias = None;
        if let TokenKind::Identifier(word) = &self.current().kind
            && word == "as"
        {
            self.position += 1;
            let alias_token = self.current().clone();
            let TokenKind::Identifier(name) = &alias_token.kind else {
                return Err(self.error(
                    alias_token.span,
                    "E_MANIFEST_STATEMENT",
                    "expected a group name after `as`",
                ));
            };
            alias = Some(name.clone());
            self.position += 1;
        }
        let span = Span {
            start: start.span.start,
            end: path_token.span.end,
            line: start.span.line,
            column: start.span.column,
        };
        let group = match alias {
            Some(alias) => alias,
            None => {
                let stem = Path::new(written)
                    .file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
                    .unwrap_or_default();
                if stem.is_empty() {
                    return Err(self.error(
                        span,
                        "E_MANIFEST_STATEMENT",
                        format!("cannot derive a group name from '{written}'; add `as <name>`"),
                    ));
                }
                stem
            }
        };
        Ok(Statement::Entry(Entry {
            group,
            display: written.clone(),
            path: root.join(written),
            draft,
            layer,
            span,
        }))
    }

    fn layer(&mut self) -> Result<Layer, Diagnostic> {
        let layer = self.current().clone();
        let TokenKind::Identifier(layer_name) = &layer.kind else {
            return Err(self.error(
                layer.span,
                "E_MANIFEST_STATEMENT",
                "expected a layer name such as `behavior` or `structure`",
            ));
        };
        let parsed = match layer_name.as_str() {
            "behavior" => Layer::Behavior,
            "structure" => Layer::Structure,
            other => {
                return Err(self.error(
                    layer.span,
                    "E_UNSUPPORTED_LAYER",
                    format!(
                        "layer '{other}' is not supported; v0.5 composes `behavior` and `structure` contracts (mission and process are documented future work)"
                    ),
                ));
            }
        };
        self.position += 1;
        Ok(parsed)
    }

    fn profile(&mut self, start: Span) -> Result<(Profile, Span), Diagnostic> {
        let open = self.current().clone();
        if open.kind != TokenKind::LeftBrace {
            return Err(self.error(
                open.span,
                "E_MANIFEST_STATEMENT",
                "expected `{` after `verify behavior`",
            ));
        }
        self.position += 1;
        let mut command: Option<Vec<String>> = None;
        let mut seed = None;
        let mut cases = None;
        let mut steps = None;
        let mut timeout_ms = None;
        let mut shrink_budget = None;
        let close = loop {
            let token = self.current().clone();
            match &token.kind {
                TokenKind::RightBrace => {
                    self.position += 1;
                    break token;
                }
                TokenKind::Eof => {
                    return Err(self.error(
                        token.span,
                        "E_MANIFEST_STATEMENT",
                        "expected `}` to close `verify behavior`",
                    ));
                }
                TokenKind::Identifier(field) => {
                    self.position += 1;
                    let repeated = match field.as_str() {
                        "command" => {
                            let values = self.command_list(token.span)?;
                            command.replace(values).is_some()
                        }
                        "seed" => seed.replace(self.integer(field, 0, u64::MAX)?).is_some(),
                        "cases" => cases.replace(self.integer(field, 1, u64::MAX)?).is_some(),
                        "steps" => steps.replace(self.integer(field, 1, u64::MAX)?).is_some(),
                        "timeout_ms" => timeout_ms
                            .replace(self.integer(field, 1, MAX_TIMEOUT.as_millis() as u64)?)
                            .is_some(),
                        "shrink_budget" => shrink_budget
                            .replace(self.integer(field, 0, MAX_SHRINK_ATTEMPTS as u64)?)
                            .is_some(),
                        other => {
                            return Err(self.error(
                                token.span,
                                "E_PROFILE_FIELD",
                                format!(
                                    "unknown verification profile field '{other}'; fields are {PROFILE_FIELDS}"
                                ),
                            ));
                        }
                    };
                    if repeated {
                        return Err(self.error(
                            token.span,
                            "E_PROFILE_FIELD",
                            format!("verification profile field '{field}' is set more than once"),
                        ));
                    }
                }
                _ => {
                    return Err(self.error(
                        token.span,
                        "E_PROFILE_FIELD",
                        format!("expected a verification profile field ({PROFILE_FIELDS}) or `}}`"),
                    ));
                }
            }
        };
        let span = Span {
            start: start.start,
            end: close.span.end,
            line: start.line,
            column: start.column,
        };
        let Some(command) = command else {
            return Err(self.error(
                span,
                "E_PROFILE_COMMAND",
                "`verify behavior` needs `command [\"program\", \"argument\", ...]`: the application launch used by blabla finish",
            ));
        };
        Ok((
            Profile {
                command,
                seed: seed.unwrap_or(0),
                cases: cases.map(|value| value as usize).unwrap_or(DEFAULT_CASES),
                steps: steps.map(|value| value as usize).unwrap_or(DEFAULT_STEPS),
                timeout_ms: timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS),
                shrink_budget: shrink_budget
                    .map(|value| value as usize)
                    .unwrap_or(MAX_SHRINK_ATTEMPTS),
            },
            span,
        ))
    }

    fn command_list(&mut self, field: Span) -> Result<Vec<String>, Diagnostic> {
        let open = self.current().clone();
        if open.kind != TokenKind::LeftBracket {
            return Err(self.error(
                open.span,
                "E_PROFILE_COMMAND",
                "expected `[\"program\", \"argument\", ...]` after `command`",
            ));
        }
        self.position += 1;
        let mut values = Vec::new();
        loop {
            let token = self.current().clone();
            match &token.kind {
                TokenKind::RightBracket => {
                    self.position += 1;
                    break;
                }
                TokenKind::String(value) => {
                    if value.is_empty() {
                        return Err(self.error(
                            token.span,
                            "E_PROFILE_COMMAND",
                            "command elements must not be empty strings",
                        ));
                    }
                    values.push(value.clone());
                    self.position += 1;
                    if self.current().kind == TokenKind::Comma {
                        self.position += 1;
                    } else if self.current().kind != TokenKind::RightBracket {
                        return Err(self.error(
                            self.current().span,
                            "E_PROFILE_COMMAND",
                            "expected `,` or `]` after a command element",
                        ));
                    }
                }
                _ => {
                    return Err(self.error(
                        token.span,
                        "E_PROFILE_COMMAND",
                        "command elements must be quoted strings",
                    ));
                }
            }
        }
        if values.is_empty() {
            return Err(self.error(
                field,
                "E_PROFILE_COMMAND",
                "`command` needs at least the program to launch",
            ));
        }
        Ok(values)
    }

    fn integer(&mut self, field: &str, min: u64, max: u64) -> Result<u64, Diagnostic> {
        let token = self.current().clone();
        let value = match &token.kind {
            TokenKind::Integer(text) => text.parse::<u64>().ok(),
            _ => None,
        };
        match value {
            Some(value) if value >= min && value <= max => {
                self.position += 1;
                Ok(value)
            }
            _ => Err(self.error(
                token.span,
                "E_PROFILE_FIELD",
                if max == u64::MAX {
                    format!("`{field}` must be an integer of at least {min}")
                } else {
                    format!("`{field}` must be an integer from {min} through {max}")
                },
            )),
        }
    }

    fn at_end(&self) -> bool {
        matches!(self.current().kind, TokenKind::Eof)
    }

    fn current(&self) -> &Token {
        &self.tokens[self.position.min(self.tokens.len() - 1)]
    }

    fn error(&self, span: Span, code: &str, message: impl Into<String>) -> Diagnostic {
        Diagnostic::new(self.file, span, code, message)
    }
}

fn normalize(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !result.pop() {
                    result.push("..");
                }
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}

struct Loaded<'a> {
    entry: &'a Entry,
    source: String,
    syntax: syntax::Contract,
}

fn load_entry<'a>(manifest_file: &str, entry: &'a Entry) -> Result<Loaded<'a>, Diagnostic> {
    let source = read_entry(manifest_file, entry)?;
    let syntax = syntax::parse(&entry.display, &source)?;
    Ok(Loaded {
        entry,
        source,
        syntax,
    })
}

fn read_entry(manifest_file: &str, entry: &Entry) -> Result<String, Diagnostic> {
    let source = std::fs::read_to_string(&entry.path).map_err(|failure| {
        Diagnostic::new(
            manifest_file,
            entry.span,
            "E_MISSING_CONTRACT",
            format!(
                "cannot read contract '{}' ({}): {failure}",
                entry.display,
                entry.path.display()
            ),
        )
    })?;
    if starts_with_project_header(&source) {
        return Err(Diagnostic::new(
            manifest_file,
            entry.span,
            "E_MANIFEST_AS_CONTRACT",
            format!(
                "'{}' is a project manifest; manifests cannot be included as contracts",
                entry.display
            ),
        ));
    }
    Ok(source)
}

fn starts_with_project_header(source: &str) -> bool {
    let trimmed = source.trim_start();
    trimmed
        .strip_prefix("project")
        .is_some_and(|rest| rest.starts_with(char::is_whitespace))
}

pub fn load(manifest: Manifest) -> Result<Project, Diagnostic> {
    let manifest_file = manifest.path.display().to_string();
    let mut active = Vec::new();
    let mut structure = Vec::new();
    let mut pending_drafts = Vec::new();
    for entry in &manifest.entries {
        match entry.layer {
            Layer::Behavior => {
                let loaded = load_entry(&manifest_file, entry)?;
                if entry.draft {
                    pending_drafts.push(PendingDraft::Behavior(loaded));
                } else {
                    active.push(loaded);
                }
            }
            Layer::Structure => {
                let source = read_entry(&manifest_file, entry)?;
                let parsed = structure::syntax::parse(
                    &entry.display,
                    &source,
                    &manifest.root,
                    Some(&entry.group),
                );
                if entry.draft {
                    pending_drafts.push(PendingDraft::Structure(entry, parsed.map(|_| ())));
                } else {
                    structure.push(parsed?);
                }
            }
        }
    }
    let units: Vec<Unit<'_>> = active.iter().map(unit).collect();
    let contract = if units.is_empty() {
        None
    } else {
        Some(compile_units(&units)?)
    };
    let drafts = pending_drafts
        .into_iter()
        .map(|pending| match pending {
            PendingDraft::Behavior(draft) => {
                let mut all = units.clone();
                all.push(unit(&draft));
                Draft {
                    name: draft.entry.group.clone(),
                    display: draft.entry.display.clone(),
                    layer: Layer::Behavior,
                    check: compile_units(&all).map(|_| ()),
                }
            }
            PendingDraft::Structure(entry, check) => Draft {
                name: entry.group.clone(),
                display: entry.display.clone(),
                layer: Layer::Structure,
                check,
            },
        })
        .collect();
    let rules = contract
        .as_ref()
        .map(|contract| rules(contract, &manifest))
        .unwrap_or_default();
    let groups = manifest
        .entries
        .iter()
        .filter(|entry| !entry.draft)
        .map(|entry| Group {
            name: entry.group.clone(),
            display: entry.display.clone(),
            rules: match entry.layer {
                Layer::Behavior => rules
                    .iter()
                    .filter(|rule| rule.group == entry.group)
                    .count(),
                Layer::Structure => structure
                    .iter()
                    .filter(|contract| contract.group.as_deref() == Some(entry.group.as_str()))
                    .map(|contract| contract.rules.len())
                    .sum(),
            },
            layer: entry.layer,
        })
        .collect();
    let mut hasher = Fnv::new();
    hasher.write_str(&manifest.name);
    for loaded in &active {
        hasher.write_str(&loaded.entry.group);
        hasher.write_str(&loaded.entry.display);
        hasher.write_str(&loaded.source);
    }
    Ok(Project {
        manifest,
        contract,
        rules,
        groups,
        structure,
        drafts,
        identity: hasher.finish(),
    })
}

enum PendingDraft<'a> {
    Behavior(Loaded<'a>),
    Structure(&'a Entry, Result<(), Diagnostic>),
}

fn unit<'a>(loaded: &'a Loaded<'_>) -> Unit<'a> {
    Unit {
        file: &loaded.entry.display,
        source: &loaded.source,
        group: Some(&loaded.entry.group),
        declarations: &loaded.syntax.declarations,
    }
}

fn rules(contract: &Contract, manifest: &Manifest) -> Vec<Rule> {
    let mut result = Vec::new();
    let mut push =
        |predicate: &crate::ir::Predicate, action: Option<&str>, runtime: Option<&'static str>| {
            let group = manifest
                .entries
                .iter()
                .find(|entry| entry.display == predicate.location.file)
                .map(|entry| entry.group.clone())
                .unwrap_or_default();
            let label = predicate
                .label
                .strip_prefix(&format!("{group}::"))
                .unwrap_or(&predicate.label)
                .to_owned();
            result.push(Rule {
                id: predicate.label.clone(),
                group,
                label,
                file: predicate.location.file.clone(),
                line: predicate.location.line,
                column: predicate.location.column,
                source: predicate.source.clone(),
                action: action.map(str::to_owned),
                runtime,
            });
        };
    for action in &contract.actions {
        let runtime = primitives::for_action(action.kind).map(|primitive| primitive.id);
        for predicate in &action.postconditions {
            push(predicate, Some(&action.name), runtime);
        }
    }
    for predicate in &contract.invariants {
        push(predicate, None, None);
    }
    let order = |rule: &Rule| {
        (
            manifest
                .entries
                .iter()
                .position(|entry| entry.group == rule.group)
                .unwrap_or(usize::MAX),
            rule.line,
            rule.column,
        )
    };
    result.sort_by_key(order);
    result
}

impl Project {
    pub fn runtime_primitives(&self) -> Vec<&'static str> {
        let mut ids: Vec<&'static str> =
            self.rules.iter().filter_map(|rule| rule.runtime).collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    }

    pub fn rules_using(&self, primitive: &str) -> Vec<&str> {
        self.rules
            .iter()
            .filter(|rule| rule.runtime == Some(primitive))
            .map(|rule| rule.id.as_str())
            .collect()
    }

    pub fn lookup(&self, query: &str) -> Result<Lookup<'_>, Diagnostic> {
        if let Some(name) = query.strip_prefix("action/") {
            return match self
                .contract
                .as_ref()
                .and_then(|contract| contract.actions.iter().find(|action| action.name == name))
            {
                Some(action) => Ok(Lookup::Action(action.name.clone())),
                None => Err(self.unknown_rule(query)),
            };
        }
        let mut candidate = query;
        if let Some(index) = query.find("/root") {
            candidate = &query[..index];
        }
        let candidates: Vec<Lookup<'_>> = self
            .rules
            .iter()
            .map(Lookup::Rule)
            .chain(self.structure_rules().map(Lookup::Structure))
            .collect();
        if let Some(found) = candidates.iter().find(|found| found.id() == candidate) {
            return Ok(found.clone());
        }
        let by_label: Vec<&Lookup<'_>> = candidates
            .iter()
            .filter(|found| found.label() == candidate)
            .collect();
        match by_label.as_slice() {
            [found] => return Ok((*found).clone()),
            [] => {}
            many => return Err(self.ambiguous(query, many)),
        }
        let by_substring: Vec<&Lookup<'_>> = candidates
            .iter()
            .filter(|found| found.id().contains(candidate))
            .collect();
        match by_substring.as_slice() {
            [found] => Ok((*found).clone()),
            [] => Err(self.unknown_rule(query)),
            many => Err(self.ambiguous(query, many)),
        }
    }

    pub fn structure_rules(&self) -> impl Iterator<Item = &StructureRule> {
        self.structure
            .iter()
            .flat_map(|contract| contract.rules.iter())
    }

    pub fn verify_structure(&self) -> StructureReport {
        structure::verify(
            &self.structure,
            &self.manifest.root,
            &structure::default_providers(),
        )
    }

    pub fn has_behavior(&self) -> bool {
        self.groups
            .iter()
            .any(|group| group.layer == Layer::Behavior)
    }

    pub fn has_structure(&self) -> bool {
        !self.structure.is_empty()
    }

    fn unknown_rule(&self, query: &str) -> Diagnostic {
        self.diagnostic(
            "E_UNKNOWN_RULE",
            format!(
                "no rule matches '{query}' in project {}; run `blabla status` for the current rule ids",
                self.manifest.name
            ),
        )
    }

    fn ambiguous(&self, query: &str, candidates: &[&Lookup<'_>]) -> Diagnostic {
        let ids: Vec<&str> = candidates.iter().map(|found| found.id()).collect();
        self.diagnostic(
            "E_AMBIGUOUS_RULE",
            format!(
                "'{query}' matches more than one rule; use one of: {}",
                ids.join(", ")
            ),
        )
    }

    fn diagnostic(&self, code: &str, message: String) -> Diagnostic {
        Diagnostic {
            location: Location {
                file: self.manifest.path.display().to_string(),
                line: 1,
                column: 1,
            },
            code: code.into(),
            message,
        }
    }
}

pub struct Fnv(u64);

impl Fnv {
    pub fn new() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }

    pub fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }

    pub fn write_str(&mut self, text: &str) {
        self.write(text.as_bytes());
        self.write(&[0]);
    }

    pub fn finish(&self) -> String {
        format!("{:016x}", self.0)
    }
}

impl Default for Fnv {
    fn default() -> Self {
        Self::new()
    }
}

pub fn fingerprint(root: &Path, extra_files: &[PathBuf], excluded: &[PathBuf]) -> String {
    let mut hasher = Fnv::new();
    let excluded: Vec<PathBuf> = excluded.iter().map(|path| normalize(path)).collect();
    walk(root, root, &excluded, &mut hasher);
    for file in extra_files {
        if file.is_file() {
            hash_file(&file.display().to_string(), file, &mut hasher);
        }
    }
    hasher.finish()
}

pub fn resolve_command(
    written: &[String],
    base: &Path,
    file: &str,
    span: Span,
) -> Result<ResolvedCommand, Diagnostic> {
    let mut resolved = Vec::with_capacity(written.len());
    for element in written {
        if !is_path_like(element, base) {
            resolved.push(OsString::from(element));
            continue;
        }
        let candidate = Path::new(element);
        let absolute = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            normalize(&base.join(candidate))
        };
        if !absolute.exists() {
            return Err(Diagnostic::new(
                file,
                span,
                "E_APPLICATION_PATH",
                format!(
                    "command element '{element}' resolves to {}, which does not exist; relative paths resolve against {}",
                    absolute.display(),
                    base.display()
                ),
            ));
        }
        resolved.push(absolute.into_os_string());
    }
    let Some((program, args)) = resolved.split_first() else {
        return Err(Diagnostic::new(
            file,
            span,
            "E_PROFILE_COMMAND",
            "the application command is empty",
        ));
    };
    Ok(ResolvedCommand {
        program: PathBuf::from(program),
        args: args.to_vec(),
        written: written.to_vec(),
    })
}

fn is_path_like(element: &str, base: &Path) -> bool {
    if element.starts_with('-') {
        return false;
    }
    element.contains('/') || element.contains('\\') || base.join(element).is_file()
}

impl Project {
    pub fn launch(&self) -> Result<Option<ResolvedCommand>, Diagnostic> {
        let Some(profile) = &self.manifest.profile else {
            return Ok(None);
        };
        let span = self.manifest.profile_span.unwrap_or(Span {
            start: 0,
            end: 0,
            line: 1,
            column: 1,
        });
        resolve_command(
            &profile.command,
            &self.manifest.root,
            &self.manifest.path.display().to_string(),
            span,
        )
        .map(Some)
    }

    pub fn contract_files(&self) -> Vec<PathBuf> {
        let mut files = vec![self.manifest.path.clone()];
        files.extend(self.manifest.entries.iter().map(|entry| entry.path.clone()));
        files
    }

    pub fn fingerprint(&self, extra_files: &[PathBuf]) -> String {
        fingerprint(&self.manifest.root, extra_files, &self.contract_files())
    }
}

fn walk(root: &Path, directory: &Path, excluded: &[PathBuf], hasher: &mut Fnv) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        hasher.write_str("unreadable-directory");
        hasher.write_str(&relative(root, directory));
        return;
    };
    let mut children: Vec<_> = entries.flatten().collect();
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        let Ok(kind) = child.file_type() else {
            continue;
        };
        let path = child.path();
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            let name = child.file_name();
            if SKIPPED_DIRECTORIES
                .iter()
                .any(|skipped| name.to_string_lossy() == *skipped)
            {
                continue;
            }
            walk(root, &path, excluded, hasher);
        } else if kind.is_file() {
            if excluded.contains(&normalize(&path)) {
                continue;
            }
            hash_file(&relative(root, &path), &path, hasher);
        }
    }
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn hash_file(name: &str, path: &Path, hasher: &mut Fnv) {
    hasher.write_str(name);
    let Ok(metadata) = std::fs::metadata(path) else {
        hasher.write_str("unreadable-metadata");
        return;
    };
    hasher.write(&metadata.len().to_le_bytes());
    if metadata.len() <= CONTENT_HASH_LIMIT {
        match std::fs::read(path) {
            Ok(content) => hasher.write(&content),
            Err(failure) => hasher.write_str(&format!("unreadable-file:{}", failure.kind())),
        }
    } else if let Ok(modified) = metadata.modified()
        && let Ok(since_epoch) = modified.duration_since(std::time::UNIX_EPOCH)
    {
        hasher.write(&since_epoch.as_nanos().to_le_bytes());
    }
}

#[cfg(test)]
mod tests;
