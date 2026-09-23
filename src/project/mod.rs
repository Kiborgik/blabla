use crate::diagnostic::{Diagnostic, Location, Span};
use crate::ir::Contract;
use crate::report::{DEFAULT_CASES, DEFAULT_STEPS, DEFAULT_TIMEOUT_MS, MAX_SHRINK_ATTEMPTS};
use crate::runtime::{MAX_STARTUP, MAX_TIMEOUT, primitives};
use crate::semantics::{Unit, compile_units};
use crate::structure::{self, StructureContract, StructureReport, StructureRule};
use crate::syntax::{self, Lexer, Token, TokenKind};
use crate::voice::{VOICES, Voice};
use ignore::{Ignore, IgnoreDeclaration};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

pub mod ignore;
pub mod runstate;
pub mod status;
pub mod task;

pub const MANIFEST_NAME: &str = "project.bla";
pub const PROFILE_FIELDS: &str =
    "command, prepare, seed, cases, steps, timeout_ms, startup_ms, shrink_budget";

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
    pub mission: Option<MemoryEntry>,
    pub system: Option<MemoryEntry>,
    pub process: Option<MemoryEntry>,
    pub knowledge: Vec<MemoryEntry>,
    pub profile: Option<Profile>,
    pub profile_span: Option<Span>,
    pub voice: Voice,
    pub ignores: Vec<IgnoreDeclaration>,
}

#[derive(Clone, Debug)]
pub struct MemoryEntry {
    pub display: String,
    pub path: PathBuf,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Profile {
    pub command: Vec<String>,
    #[serde(default)]
    pub prepare: Option<Vec<String>>,
    pub seed: u64,
    pub cases: usize,
    pub steps: usize,
    pub timeout_ms: u64,
    #[serde(default)]
    pub startup_ms: Option<u64>,
    pub shrink_budget: usize,
}

impl Profile {
    pub fn startup(&self) -> u64 {
        self.startup_ms.unwrap_or(self.timeout_ms)
    }
}

#[derive(Clone, Debug)]
pub struct ResolvedCommand {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub written: Vec<String>,
}

enum Statement {
    Entry(Entry),
    Mission(MemoryEntry),
    System(MemoryEntry),
    Process(MemoryEntry),
    Knowledge(MemoryEntry),
    Profile(Profile, Span),
    Tone(Voice, Span),
    Ignore(IgnoreDeclaration),
}

pub const RESERVED_GROUPS: &[&str] = &[
    "contract",
    "mission",
    "priority",
    "knowledge",
    "ruling",
    "system",
    "responsibility",
    "seam",
    "role",
    "policy",
    "flow",
    "step",
    "runtime",
    "task",
];

const MEMORY_STATEMENTS: &[&str] = &["mission", "system", "process", "knowledge"];

fn memory_example(keyword: &str) -> &'static str {
    match keyword {
        "mission" => "mission.bla",
        "system" => "system.bla",
        "knowledge" => "knowledge/engineering.bla",
        _ => "process.bla",
    }
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
    pub ignore: Ignore,
}

#[derive(Clone)]
pub enum Resolution<'a> {
    Project(Lookup<'a>),
    Memory(String),
}

const OFFERED: usize = 6;

fn offer(ids: &[String]) -> String {
    let shown: Vec<String> = ids
        .iter()
        .take(OFFERED)
        .map(|id| format!("blabla explain {id}"))
        .collect();
    match ids.len().checked_sub(OFFERED) {
        Some(rest) if rest > 0 => format!("{} ({rest} more)", shown.join(" | ")),
        _ => shown.join(" | "),
    }
}

fn narrow<'a, 'b>(candidates: &'b [Lookup<'a>], candidate: &str) -> Vec<&'b Lookup<'a>> {
    let by_label: Vec<&Lookup<'_>> = candidates
        .iter()
        .filter(|found| found.label() == candidate)
        .collect();
    if !by_label.is_empty() {
        return by_label;
    }
    candidates
        .iter()
        .filter(|found| found.id().contains(candidate))
        .collect()
}

#[derive(Clone)]
pub enum Lookup<'a> {
    Rule(&'a Rule),
    Structure(&'a StructureRule),
    Contract(&'a Group),
    Action(String),
}

impl Lookup<'_> {
    pub fn id(&self) -> String {
        match self {
            Lookup::Rule(rule) => rule.id.clone(),
            Lookup::Structure(rule) => rule.id.clone(),
            Lookup::Contract(group) => format!("contract::{}", group.name),
            Lookup::Action(name) => name.clone(),
        }
    }

    fn label(&self) -> &str {
        match self {
            Lookup::Rule(rule) => &rule.label,
            Lookup::Structure(rule) => &rule.label,
            Lookup::Contract(group) => &group.name,
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
    let mut voice = None;
    let mut mission: Option<MemoryEntry> = None;
    let mut system: Option<MemoryEntry> = None;
    let mut process: Option<MemoryEntry> = None;
    let mut knowledge: Vec<MemoryEntry> = Vec::new();
    let mut ignores: Vec<IgnoreDeclaration> = Vec::new();
    while !parser.at_end() {
        match parser.statement(&root)? {
            Statement::Ignore(declaration) => {
                if ignores.iter().any(|seen| {
                    seen.is_list() == declaration.is_list()
                        && seen.written() == declaration.written()
                }) {
                    return Err(parser.error(
                        declaration.span(),
                        "E_DUPLICATE_IGNORE",
                        format!(
                            "'{}' is declared by `ignore` more than once",
                            declaration.written()
                        ),
                    ));
                }
                ignores.push(declaration);
            }
            Statement::Mission(entry) => {
                if mission.is_some() {
                    return Err(parser.error(
                        entry.span,
                        "E_DUPLICATE_MISSION",
                        "the manifest registers more than one mission memory file; a project states one mission",
                    ));
                }
                mission = Some(entry);
            }
            Statement::Knowledge(entry) => {
                if knowledge
                    .iter()
                    .any(|seen| normalize(&seen.path) == normalize(&entry.path))
                {
                    return Err(parser.error(
                        entry.span,
                        "E_DUPLICATE_KNOWLEDGE",
                        format!(
                            "knowledge memory '{}' is registered more than once",
                            entry.display
                        ),
                    ));
                }
                knowledge.push(entry);
            }
            Statement::System(entry) => {
                if system.is_some() {
                    return Err(parser.error(
                        entry.span,
                        "E_DUPLICATE_SYSTEM",
                        "the manifest registers more than one system memory file; a project has at most one",
                    ));
                }
                system = Some(entry);
            }
            Statement::Process(entry) => {
                if process.is_some() {
                    return Err(parser.error(
                        entry.span,
                        "E_DUPLICATE_PROCESS",
                        "the manifest registers more than one process memory file; a project has at most one",
                    ));
                }
                process = Some(entry);
            }
            Statement::Tone(chosen, span) => {
                if voice.is_some() {
                    return Err(parser.error(
                        span,
                        "E_DUPLICATE_VOICE",
                        "the manifest declares more than one `voice`; a project has at most one",
                    ));
                }
                voice = Some(chosen);
            }
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
                if RESERVED_GROUPS.contains(&entry.group.as_str()) {
                    return Err(parser.error(
                        entry.span,
                        "E_RESERVED_GROUP",
                        format!(
                            "group '{}' is reserved because '{}::' names a canonical identity kind; add `as <name>` to give this contract another group",
                            entry.group, entry.group
                        ),
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
        mission,
        system,
        process,
        knowledge,
        profile,
        profile_span,
        voice: voice.unwrap_or_default(),
        ignores,
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
            TokenKind::Identifier(word) if MEMORY_STATEMENTS.contains(&word.as_str()) => {
                let keyword = word.clone();
                self.position += 1;
                let path_token = self.current().clone();
                let TokenKind::String(written) = &path_token.kind else {
                    return Err(self.error(
                        path_token.span,
                        "E_MANIFEST_STATEMENT",
                        format!(
                            "expected a quoted path after `{keyword}`, as in `{keyword} \"{}\"`",
                            memory_example(&keyword)
                        ),
                    ));
                };
                self.position += 1;
                let entry = MemoryEntry {
                    display: written.clone(),
                    path: root.join(written),
                    span: Span {
                        start: start.span.start,
                        end: path_token.span.end,
                        line: start.span.line,
                        column: start.span.column,
                    },
                };
                return Ok(match keyword.as_str() {
                    "mission" => Statement::Mission(entry),
                    "system" => Statement::System(entry),
                    "knowledge" => Statement::Knowledge(entry),
                    _ => Statement::Process(entry),
                });
            }
            TokenKind::Identifier(word) if word == "voice" => {
                self.position += 1;
                let chosen = self.current().clone();
                let TokenKind::Identifier(name) = &chosen.kind else {
                    return Err(self.error(
                        chosen.span,
                        "E_MANIFEST_VOICE",
                        format!(
                            "expected a voice after `voice`; the voices are {}",
                            VOICES.join(", ")
                        ),
                    ));
                };
                let Some(voice) = Voice::parse(name) else {
                    return Err(self.error(
                        chosen.span,
                        "E_MANIFEST_VOICE",
                        format!(
                            "unknown voice '{name}'; the voices are {}",
                            VOICES.join(", ")
                        ),
                    ));
                };
                self.position += 1;
                let span = Span {
                    start: start.span.start,
                    end: chosen.span.end,
                    line: start.span.line,
                    column: start.span.column,
                };
                return Ok(Statement::Tone(voice, span));
            }
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
            TokenKind::Identifier(word) if word == "ignore" => {
                self.position += 1;
                let listed =
                    matches!(&self.current().kind, TokenKind::Identifier(word) if word == "from");
                if listed {
                    self.position += 1;
                }
                let path_token = self.current().clone();
                let TokenKind::String(written) = &path_token.kind else {
                    return Err(self.error(
                        path_token.span,
                        "E_MANIFEST_IGNORE",
                        "expected a quoted pattern, as in `ignore \"dist/\"`, or a quoted list file after `from`, as in `ignore from \".gitignore\"`",
                    ));
                };
                self.position += 1;
                let span = Span {
                    start: start.span.start,
                    end: path_token.span.end,
                    line: start.span.line,
                    column: start.span.column,
                };
                let declaration = if listed {
                    IgnoreDeclaration::List {
                        written: written.clone(),
                        path: root.join(written),
                        span,
                    }
                } else {
                    IgnoreDeclaration::Pattern {
                        written: written.clone(),
                        span,
                    }
                };
                return Ok(Statement::Ignore(declaration));
            }
            _ => {
                return Err(self.error(
                    start.span,
                    "E_MANIFEST_STATEMENT",
                    "expected `use behavior \"path\"`, `draft behavior \"path\"`, `mission \"path\"`, `system \"path\"`, `process \"path\"`, `knowledge \"path\"`, `voice <name>`, `ignore \"pattern\"`, `ignore from \"file\"` or `verify behavior { ... }`",
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
                        "layer '{other}' is not supported; a project composes `behavior` and `structure` contracts, and mission, system, process and knowledge memory are registered by their own statements `mission \"path\"`, `system \"path\"`, `process \"path\"` and `knowledge \"path\"` because they are not layers and never decide completion"
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
        let mut prepare: Option<Vec<String>> = None;
        let mut startup_ms = None;
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
                        "prepare" => {
                            let values = self.command_list(token.span)?;
                            prepare.replace(values).is_some()
                        }
                        "startup_ms" => startup_ms
                            .replace(self.integer(field, 1, MAX_STARTUP.as_millis() as u64)?)
                            .is_some(),
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
                prepare,
                startup_ms,
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
    let ignore = Ignore::new(&manifest.root, &manifest.ignores, always_tracked(&manifest))
        .map_err(|failure| {
            Diagnostic::new(&manifest_file, failure.span, failure.code, failure.message)
        })?;
    Ok(Project {
        manifest,
        contract,
        rules,
        groups,
        structure,
        drafts,
        identity: hasher.finish(),
        ignore,
    })
}

fn always_tracked(manifest: &Manifest) -> BTreeSet<String> {
    let root = normalize(&manifest.root);
    let memory = [&manifest.mission, &manifest.system, &manifest.process]
        .into_iter()
        .flatten()
        .chain(&manifest.knowledge)
        .map(|entry| entry.path.clone());
    std::iter::once(manifest.path.clone())
        .chain(manifest.entries.iter().map(|entry| entry.path.clone()))
        .chain(memory)
        .map(|path| relative(&root, &normalize(&path)))
        .collect()
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
        if let Some(name) = candidate.strip_prefix("contract::") {
            return match self.groups.iter().find(|group| group.name == name) {
                Some(group) => Ok(Lookup::Contract(group)),
                None => Err(self.unknown_rule(query)),
            };
        }
        let candidates = self.all_lookups();
        if let Some(found) = candidates.iter().find(|found| found.id() == candidate) {
            return Ok(found.clone());
        }
        if let Some(group) = self.groups.iter().find(|group| group.name == candidate) {
            return Err(self.diagnostic(
                "E_COARSE_IDENTITY",
                format!(
                    "'{query}' is the group of a contract, not an identity; run: blabla explain contract::{}",
                    group.name
                ),
            ));
        }
        match narrow(&candidates, candidate).as_slice() {
            [found] => Ok((*found).clone()),
            [] => Err(self.unknown_rule(query)),
            many => Err(self.ambiguous(query, many)),
        }
    }

    fn all_lookups(&self) -> Vec<Lookup<'_>> {
        self.rules
            .iter()
            .map(Lookup::Rule)
            .chain(self.structure_rules().map(Lookup::Structure))
            .collect()
    }

    pub fn candidate_ids(&self, query: &str) -> Vec<String> {
        let candidates = self.all_lookups();
        narrow(&candidates, query)
            .iter()
            .map(|found| found.id())
            .collect()
    }

    pub fn resolve<'a>(
        &'a self,
        query: &str,
        names: &[String],
    ) -> Result<Resolution<'a>, Diagnostic> {
        let found = self.lookup(query);
        if names.is_empty() {
            return match found {
                Ok(lookup) => Ok(Resolution::Project(lookup)),
                Err(diagnostic) if diagnostic.code == "E_UNKNOWN_RULE" => {
                    Err(self.unknown_identity(query))
                }
                Err(diagnostic) => Err(diagnostic),
            };
        }
        match found {
            Ok(lookup) => Err(self.collision(query, &[lookup.id()], names)),
            Err(diagnostic) if diagnostic.code == "E_AMBIGUOUS_RULE" => {
                Err(self.collision(query, &self.candidate_ids(query), names))
            }
            Err(diagnostic) if diagnostic.code == "E_COARSE_IDENTITY" => {
                Err(self.collision(query, &[format!("contract::{query}")], names))
            }
            Err(_) if names.len() > 1 => Err(self.collision(query, &[], names)),
            Err(_) => Ok(Resolution::Memory(names[0].clone())),
        }
    }

    fn unknown_identity(&self, query: &str) -> Diagnostic {
        self.diagnostic(
            "E_UNKNOWN_RULE",
            format!(
                "no object matches '{query}' in project {}; blabla status lists every contract::<group>, mission::<name>, knowledge::<pack>, system::<name> and role::<name> this project has",
                self.manifest.name
            ),
        )
    }

    fn collision(&self, query: &str, rules: &[String], names: &[String]) -> Diagnostic {
        let ids: Vec<String> = names.iter().chain(rules.iter()).cloned().collect();
        let scope = if rules.is_empty() {
            "in project memory"
        } else {
            "across rules and project memory"
        };
        self.diagnostic(
            "E_AMBIGUOUS_IDENTITY",
            format!(
                "'{query}' is not a canonical identity and names {} objects {scope}; run one of: {}",
                ids.len(),
                offer(&ids)
            ),
        )
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
        let ids: Vec<String> = candidates.iter().map(|found| found.id()).collect();
        self.diagnostic(
            "E_AMBIGUOUS_RULE",
            format!(
                "'{query}' is not a canonical identity and matches {} rules; run one of: {}",
                ids.len(),
                offer(&ids)
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

pub fn fingerprint(
    root: &Path,
    extra_files: &[PathBuf],
    excluded: &[PathBuf],
    ignore: &Ignore,
) -> String {
    let mut hasher = Fnv::new();
    let excluded: Vec<PathBuf> = excluded.iter().map(|path| normalize(path)).collect();
    walk(root, root, &excluded, ignore, &mut |visit| match visit {
        Visit::UnreadableDirectory(name) => {
            hasher.write_str("unreadable-directory");
            hasher.write_str(name);
        }
        Visit::File(name, path) => hash_file(name, path, &mut hasher),
    });
    for file in extra_files {
        if file.is_file() {
            hash_file(&file.display().to_string(), file, &mut hasher);
        }
    }
    hasher.finish()
}

fn executable_form(candidate: &Path) -> Option<PathBuf> {
    if candidate.exists() || std::env::consts::EXE_SUFFIX.is_empty() {
        return None;
    }
    let mut name = candidate.file_name()?.to_os_string();
    name.push(std::env::consts::EXE_SUFFIX);
    let suffixed = candidate.with_file_name(name);
    suffixed.exists().then_some(suffixed)
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
        let absolute = match executable_form(&absolute) {
            Some(found) => found,
            None => absolute,
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
        fingerprint(
            &self.manifest.root,
            extra_files,
            &self.contract_files(),
            &self.ignore,
        )
    }
}

fn walk(
    root: &Path,
    directory: &Path,
    excluded: &[PathBuf],
    ignore: &Ignore,
    visit: &mut dyn FnMut(Visit<'_>),
) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        visit(Visit::UnreadableDirectory(&relative(root, directory)));
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
            if ignore.skips_directory(&relative(root, &path)) {
                continue;
            }
            walk(root, &path, excluded, ignore, visit);
        } else if kind.is_file() {
            let name = relative(root, &path);
            if excluded.contains(&normalize(&path)) || ignore.skips_file(&name) {
                continue;
            }
            visit(Visit::File(&name, &path));
        }
    }
}

enum Visit<'a> {
    UnreadableDirectory(&'a str),
    File(&'a str, &'a Path),
}

pub fn snapshot(root: &Path, ignore: &Ignore) -> BTreeMap<String, String> {
    let mut digests = BTreeMap::new();
    walk(root, root, &[], ignore, &mut |visit| {
        if let Visit::File(name, path) = visit {
            let mut hasher = Fnv::new();
            hash_file(name, path, &mut hasher);
            digests.insert(name.to_owned(), hasher.finish());
        }
    });
    digests
}

pub fn digest_of(root: &Path, relative_path: &str) -> Option<String> {
    let path = root.join(relative_path);
    if !path.is_file() {
        return None;
    }
    let mut hasher = Fnv::new();
    hash_file(relative_path, &path, &mut hasher);
    Some(hasher.finish())
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
