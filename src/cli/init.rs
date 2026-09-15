use blabla::project::{MANIFEST_NAME, discover};
use blabla::report::{DEFAULT_CASES, DEFAULT_STEPS, DEFAULT_TIMEOUT_MS, MAX_SHRINK_ATTEMPTS};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const CONTRACT_PATH: &str = "contracts/behavior/core.bla";
pub const AGENTS_PATH: &str = "AGENTS.md";
pub const SKILL_PATH: &str = ".agents/skills/blabla/SKILL.md";
pub const MARKER_START: &str = "<!-- blabla:start -->";
pub const MARKER_END: &str = "<!-- blabla:end -->";

pub const STARTER_CONTRACT: &str = "type Item {
    id: int,
    text: string
}

state items: [Item]

action add(text: string)
action restart()

when add {
    expect \"add-creates-item\":
        input.text == \"\" or any(after.items, item => item.text == input.text)
}

when restart {
    expect \"persistence\": after.items == before.items
}

always \"unique-ids\" {
    unique(items, item => item.id)
}
";

pub const AGENTS_SNIPPET: &str = "## BlaBla

BlaBla is executable project memory.
`blabla` is a command-line tool on PATH; `blabla --help` lists its commands.

Start with:
  blabla status

Use:
  blabla explain <rule>
  blabla guide agent

Before declaring work complete:
  blabla finish

Only OVERALL GREEN means completion.
YELLOW means NOT COMPLETE.
Do not weaken contracts to obtain GREEN.
";

pub const SKILL: &str = "---
name: blabla
description: Use when a repository contains project.bla or .bla contracts. BlaBla is the project's executable memory: check status, explain rules, verify an implementation, author or change contracts.
---

# BlaBla

BlaBla turns behavioral and structural intent into executable contracts and reports GREEN, YELLOW or RED per layer.
`project.bla` is the machine entry point; `blabla status` is the agent entry point.
The contracts are the authority; this skill only teaches the workflow.

## Implementation workflow

1. `blabla status`: project name, BEHAVIOR / STRUCTURE / OVERALL state, per-contract summary, next rules, completion gate.
2. `blabla explain <rule>`: owning contract and line, the rule text, required witnesses and counterexample, or the observed structural fact.
3. Implement.
4. `blabla finish`: verifies structure, runs the project's canonical behavior verification and decides completion (exit 0 only for OVERALL GREEN).
5. RED: repair using the minimized counterexample or the observed fact. YELLOW: supply the missing witness; NOT COMPLETE. OVERALL GREEN: done.

Read a contract file only when `explain` is not enough. Never edit a `.bla` file to reach GREEN.
`blabla run -- <application>` is a quick manual check; only `blabla finish` decides completion.

## Contract authoring and bootstrap

`blabla guide bootstrap` is the canonical procedure: source authority ordering, conflicts,
unknowns, draft contracts (`draft behavior \"path\"` in `project.bla`), the skeptic pass and
promotion to `use behavior` by a human.

## Changing intended behavior

`blabla guide change`: the contract-author phase edits the rule first, then the
implementation phase reaches GREEN.

## Commands

| Command | Purpose |
| --- | --- |
| `blabla status` | BEHAVIOR, STRUCTURE and OVERALL state with the completion gate, exit 0 only for OVERALL GREEN |
| `blabla explain <rule>` | one rule with evidence |
| `blabla finish` | structure check plus canonical behavior verification from project.bla; exit 0 only for OVERALL GREEN |
| `blabla run -- <app>` | manual verification with explicit settings; records the result |
| `blabla check` | compile the project, including drafts |
| `blabla guide <topic>` | agent, bootstrap, change |
";

#[derive(Clone, Debug)]
pub struct Options {
    pub dir: PathBuf,
    pub name: Option<String>,
    pub agents: bool,
    pub dry_run: bool,
    pub command: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Step {
    pub path: String,
    pub action: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Outcome {
    pub directory: String,
    pub name: String,
    pub dry_run: bool,
    pub profile: bool,
    pub steps: Vec<Step>,
    pub nested_in: Option<String>,
    pub agents_block: Option<String>,
}

pub fn agents_block() -> String {
    format!("{MARKER_START}\n{AGENTS_SNIPPET}{MARKER_END}\n")
}

pub fn manifest(name: &str, command: &[String]) -> String {
    let mut text = format!("project {name}\n\ndraft behavior \"{CONTRACT_PATH}\"\n");
    if !command.is_empty() {
        let elements: Vec<String> = command
            .iter()
            .map(|element| format!("\"{}\"", element.replace('\\', "/").replace('"', "\\\"")))
            .collect();
        text.push_str(&format!(
            "\nverify behavior {{\n    command [{}]\n    seed 0\n    cases {DEFAULT_CASES}\n    steps {DEFAULT_STEPS}\n    timeout_ms {DEFAULT_TIMEOUT_MS}\n    shrink_budget {MAX_SHRINK_ATTEMPTS}\n}}\n",
            elements.join(", ")
        ));
    }
    text
}

pub fn project_name(dir: &Path) -> String {
    let raw = dir
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut name: String = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if name.is_empty() {
        name = "Project".into();
    } else if name.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
        name = format!("Project_{name}");
    }
    name
}

fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

pub fn run(options: &Options) -> Result<Outcome, String> {
    let name = match &options.name {
        Some(name) => {
            if !valid_name(name) {
                return Err(format!(
                    "project name '{name}' must be an identifier: letters, digits and underscores, not starting with a digit"
                ));
            }
            name.clone()
        }
        None => project_name(&options.dir),
    };
    let mut steps = Vec::new();
    if !options.dir.is_dir() {
        if options.dry_run {
            steps.push(step(&options.dir, &options.dir, "would create"));
        } else {
            std::fs::create_dir_all(&options.dir)
                .map_err(|failure| format!("cannot create {}: {failure}", options.dir.display()))?;
            steps.push(step(&options.dir, &options.dir, "create"));
        }
    }
    let nested_in = options
        .dir
        .parent()
        .and_then(discover)
        .map(|path| path.display().to_string());
    let manifest_path = options.dir.join(MANIFEST_NAME);
    let profile = if manifest_path.exists() {
        std::fs::read_to_string(&manifest_path)
            .map(|existing| existing.contains("verify behavior"))
            .unwrap_or(false)
    } else {
        !options.command.is_empty()
    };
    steps.push(create_if_missing(
        &options.dir,
        &manifest_path,
        &manifest(&name, &options.command),
        options.dry_run,
    )?);
    steps.push(create_if_missing(
        &options.dir,
        &options.dir.join(CONTRACT_PATH),
        STARTER_CONTRACT,
        options.dry_run,
    )?);
    let mut block = None;
    if options.agents {
        steps.push(integrate_agents(
            &options.dir,
            &options.dir.join(AGENTS_PATH),
            options.dry_run,
        )?);
        steps.push(create_if_missing(
            &options.dir,
            &options.dir.join(SKILL_PATH),
            SKILL,
            options.dry_run,
        )?);
        block = Some(agents_block());
    }
    Ok(Outcome {
        directory: options.dir.display().to_string(),
        name,
        dry_run: options.dry_run,
        profile,
        steps,
        nested_in,
        agents_block: block,
    })
}

fn step(root: &Path, path: &Path, action: &str) -> Step {
    Step {
        path: path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/"),
        action: action.into(),
    }
}

fn create_if_missing(
    root: &Path,
    path: &Path,
    content: &str,
    dry_run: bool,
) -> Result<Step, String> {
    if path.exists() {
        return Ok(step(root, path, "exists"));
    }
    if dry_run {
        return Ok(step(root, path, "would create"));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|failure| format!("cannot create {}: {failure}", parent.display()))?;
    }
    std::fs::write(path, content)
        .map_err(|failure| format!("cannot write {}: {failure}", path.display()))?;
    Ok(step(root, path, "create"))
}

fn integrate_agents(root: &Path, path: &Path, dry_run: bool) -> Result<Step, String> {
    let block = agents_block();
    if !path.exists() {
        if dry_run {
            return Ok(step(root, path, "would create"));
        }
        std::fs::write(path, &block)
            .map_err(|failure| format!("cannot write {}: {failure}", path.display()))?;
        return Ok(step(root, path, "create"));
    }
    let existing = std::fs::read_to_string(path)
        .map_err(|failure| format!("cannot read {}: {failure}", path.display()))?;
    let starts = existing.matches(MARKER_START).count();
    let ends = existing.matches(MARKER_END).count();
    let (updated, action) = match (starts, ends) {
        (0, 0) => {
            let separator = if existing.is_empty() || existing.ends_with("\n\n") {
                ""
            } else if existing.ends_with('\n') {
                "\n"
            } else {
                "\n\n"
            };
            (format!("{existing}{separator}{block}"), "append")
        }
        (1, 1) => {
            let start = existing.find(MARKER_START).unwrap_or(0);
            let end = existing.find(MARKER_END).unwrap_or(0);
            if end < start {
                return Err(format!(
                    "{} has its BlaBla end marker before the start marker; repair it by hand",
                    path.display()
                ));
            }
            let end = end + MARKER_END.len();
            let current = &existing[start..end];
            let trimmed_block = block.trim_end_matches('\n');
            if current == trimmed_block {
                return Ok(step(root, path, "unchanged"));
            }
            (
                format!(
                    "{}{}{}",
                    &existing[..start],
                    trimmed_block,
                    &existing[end..]
                ),
                "update",
            )
        }
        _ => {
            return Err(format!(
                "{} has an unmatched BlaBla marker ({MARKER_START} x{starts}, {MARKER_END} x{ends}); repair it by hand",
                path.display()
            ));
        }
    };
    if dry_run {
        return Ok(step(root, path, &format!("would {action}")));
    }
    std::fs::write(path, updated)
        .map_err(|failure| format!("cannot write {}: {failure}", path.display()))?;
    Ok(step(
        root,
        path,
        if action == "append" {
            "appended"
        } else {
            "updated"
        },
    ))
}
