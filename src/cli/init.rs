use blabla::project::{MANIFEST_NAME, discover};
use blabla::report::{DEFAULT_CASES, DEFAULT_STEPS, DEFAULT_TIMEOUT_MS, MAX_SHRINK_ATTEMPTS};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const CONTRACT_PATH: &str = "contracts/behavior/core.bla";
pub const AGENTS_PATH: &str = "AGENTS.md";
pub const SKILL_PATH: &str = ".agents/skills/blabla/SKILL.md";
pub const HOST_SKILL_PATH: &str = ".claude/skills/blabla/SKILL.md";
pub const SKILL_TOPICS: [&str; 9] = [
    "assignment",
    "role",
    "scope",
    "verification",
    "acceptance",
    "evidence",
    "blocker",
    "challenge",
    "hand-back",
];

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

Inspect what status printed, by its canonical identity; never invent one:
  contract::<group>  <group>::<label>  mission::<name>  priority::<name>
  system::<name>  responsibility::<name>  seam::<name>  role::<name>  policy::<name>
  flow::<name>  step::<name>  knowledge::<pack>  ruling::<pack>::<name>  runtime::<name>
  blabla explain <identity>
  blabla guide agent
Process roles, policies and flows are ADVISORY; BlaBla does not enforce them, and a ruling is
reusable expertise rather than permission to widen the task you were given.
Delegating one bounded change, and challenging the account of it: blabla guide loop

Before declaring work complete:
  blabla finish

Only OVERALL GREEN means completion.
YELLOW means NOT COMPLETE.
Do not weaken contracts to obtain GREEN.
";

const SKILL_HEAD: &str = "---
name: blabla
description: Use when a repository contains project.bla or .bla contracts. BlaBla is the project's executable memory: check status, explain rules, verify an implementation, author or change contracts.
---

# BlaBla

BlaBla turns behavioral and structural intent into executable contracts and reports GREEN, YELLOW or RED per layer.
`project.bla` is the machine entry point; `blabla status` is the agent entry point.
The contracts are the authority; this skill only teaches the workflow.

## Implementation workflow

1. `blabla status`: project name, BEHAVIOR / STRUCTURE / OVERALL state, per-contract summary, next rules, completion gate.
2. `blabla explain <group>::<label>`: owning contract and line, the rule text, required witnesses and counterexample, or the observed structural fact.
   Coarser identities open the level above: `contract::<group>` lists a contract's rules, `system::<name>` its responsibilities and seams.
   Every identity is printed by the command before it; never construct one by guessing a separator.
3. Implement.
4. `blabla finish`: verifies structure, runs the project's canonical behavior verification and decides completion (exit 0 only for OVERALL GREEN).
5. RED: repair using the minimized counterexample or the observed fact. YELLOW: supply the missing witness; NOT COMPLETE. OVERALL GREEN: done.

Read a contract file only when `explain` is not enough. Never edit a `.bla` file to reach GREEN.
`blabla run -- <application>` is a quick manual check; only `blabla finish` decides completion.

## Contract authoring and bootstrap

`blabla guide bootstrap` is the canonical procedure: source authority ordering, conflicts,
unknowns, draft contracts (`draft behavior \"path\"` in `project.bla`), the skeptic pass and
promotion to `use behavior` by a human.

## Working under an assignment

A project may hand you a bounded task instead of the whole repository. `blabla task show <name>` prints the assignment -- statement, role, write scope,
deliverables, findings, declared check, scratch -- then the routes below, in the order they are taken: acceptance, the declared check and its evidence,
a blocker, a finding, the challenge, the hand-back. That view is the authority, never this file.
";

const SKILL_TAIL: &str = "
Acceptance records that a role took the work through BlaBla, not that it read what it retrieved. `blabla explain role::<name>` and its policies outrank
any brief; a path outside the write scope is a finding, never a widening; a summary prints a passing count on a red run, so read the whole run before
recording it. A hand-back is not acceptance: closing is the orchestrator's decision, and only `blabla finish` decides whether the project is complete.

## Authoring project memory

`blabla guide memory`: the declaration and registration shape for Mission, System, Process and
Knowledge, and the check/register/explain loop. No memory state reaches OVERALL.

## Changing intended behavior

`blabla guide change`: the contract-author phase edits the rule first, then the
implementation phase reaches GREEN.

## Commands

| Command | Purpose |
| --- | --- |
| `blabla status` | BEHAVIOR, STRUCTURE and OVERALL state with the completion gate, exit 0 only for OVERALL GREEN |
| `blabla explain <group>::<label>` | one rule with evidence |
| `blabla explain contract::<group>` | one contract: path, state and the canonical id of every rule |
| `blabla explain mission::<name>` | why the project exists, the priorities that decide a tradeoff and the non-goals |
| `blabla explain system::<name>` | one system: purpose, paths, the responsibilities it owns and its seams |
| `blabla explain knowledge::<pack>` | one reusable knowledge pack and the id of every ruling in it |
| `blabla explain flow::<name>` | the order the roles are meant to work in, one line per step |
| `blabla task <action>` | record one bounded change; `show <name>` prints the routes your role takes next; `open`, `resolve` and `close` are the orchestrator's |
| `blabla challenge` | one grounded challenge to the current account of the work; exit 1 when one stands |
| `blabla finish` | structure check plus canonical behavior verification from project.bla; exit 0 only for OVERALL GREEN |
| `blabla run -- <app>` | manual verification with explicit settings; records the result |
| `blabla check` | compile the project, including drafts |
| `blabla guide <topic>` | agent, bootstrap, change, memory, loop |
";

pub fn skill() -> String {
    format!(
        "{SKILL_HEAD}{}{SKILL_TAIL}",
        super::task::routes_text("<name>", Some("<the declared check>"))
    )
}

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
    pub entry_teaches: Vec<&'static str>,
}

pub fn entry_teaches() -> Vec<&'static str> {
    SKILL_TOPICS.to_vec()
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
        let skill = skill();
        steps.push(create_if_missing(
            &options.dir,
            &options.dir.join(SKILL_PATH),
            &skill,
            options.dry_run,
        )?);
        steps.push(create_if_missing(
            &options.dir,
            &options.dir.join(HOST_SKILL_PATH),
            &skill,
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
        entry_teaches: entry_teaches(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_portable_entry_covers_every_topic_it_declares() {
        let skill = skill();
        for topic in SKILL_TOPICS {
            assert!(skill.contains(topic), "the skill never mentions {topic}");
        }
    }

    #[test]
    fn this_repository_ships_the_same_entry_it_generates() {
        let installed = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(HOST_SKILL_PATH);
        let text = std::fs::read_to_string(&installed)
            .expect("this repository carries the host-loaded copy of the entry");
        assert_eq!(
            text.replace("\r\n", "\n"),
            skill(),
            "the installed entry has drifted from the one init generates"
        );
    }

    #[test]
    fn the_portable_entry_names_no_host_command_and_no_model() {
        let skill = skill();
        for forbidden in ["cargo run", "haiku", "opus", "qwen", "sonnet"] {
            assert!(
                !skill.contains(forbidden),
                "the portable skill hardcodes {forbidden}"
            );
        }
    }
}
