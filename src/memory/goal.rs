use super::mission::MissionMemory;
use super::syntax::Block;
use super::{Memory, expect_fields, expect_keywords, list, text};
use crate::diagnostic::Diagnostic;
use serde::Serialize;
use std::collections::BTreeSet;

pub const FILE_NAME: &str = "goals.bla";

pub const AUTHORITY: &str = include_str!("../cli/text/authority-goal.md");

pub const STATES: [&str; 3] = ["active", "done", "dropped"];

#[derive(Clone, Debug, Serialize)]
pub struct Goal {
    pub name: String,
    pub serves: Vec<String>,
    pub statement: String,
    pub expect: Vec<String>,
    pub state: String,
}

impl Goal {
    pub fn id(&self) -> String {
        format!("goal::{}", self.name)
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct GoalMemory {
    pub goals: Vec<Goal>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Verdict {
    Held,
    NotHeld,
    Unverified,
    Unresolved,
}

impl Verdict {
    pub fn word(self) -> &'static str {
        match self {
            Verdict::Held => "held",
            Verdict::NotHeld => "not-held",
            Verdict::Unverified => "unverified",
            Verdict::Unresolved => "unresolved",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Expectation {
    pub identity: String,
    pub verdict: Verdict,
}

#[derive(Clone, Debug, Serialize)]
pub struct Outcome {
    pub goal: String,
    pub state: String,
    pub expected: usize,
    pub held: usize,
    pub not_held: usize,
    pub unverified: usize,
    pub unresolved: usize,
    pub expectations: Vec<Expectation>,
}

impl Outcome {
    pub fn holds(&self) -> bool {
        self.held == self.expected
    }

    pub fn ready_to_close(&self) -> bool {
        self.state == STATES[0] && self.expected > 0 && self.holds()
    }

    pub fn unmet(&self) -> bool {
        self.state == STATES[1] && !self.holds()
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct GoalStatus {
    pub file: String,
    pub state: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<String>,
    pub active: Vec<Outcome>,
    pub done: usize,
    pub dropped: usize,
    pub authority: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct GoalExplainView {
    pub kind: &'static str,
    pub id: String,
    pub statement: String,
    pub state: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub serves: Vec<String>,
    pub outcome: Outcome,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub serving_tasks: Vec<(String, String)>,
    pub authority: &'static str,
}

pub fn outcome(goal: &Goal, lookup: impl Fn(&str) -> Verdict) -> Outcome {
    let expectations: Vec<Expectation> = goal
        .expect
        .iter()
        .map(|identity| Expectation {
            identity: identity.clone(),
            verdict: lookup(identity),
        })
        .collect();
    let count = |verdict: Verdict| {
        expectations
            .iter()
            .filter(|expectation| expectation.verdict == verdict)
            .count()
    };
    Outcome {
        goal: goal.id(),
        state: goal.state.clone(),
        expected: expectations.len(),
        held: count(Verdict::Held),
        not_held: count(Verdict::NotHeld),
        unverified: count(Verdict::Unverified),
        unresolved: count(Verdict::Unresolved),
        expectations,
    }
}

pub fn build(blocks: &[Block]) -> Result<GoalMemory, Diagnostic> {
    expect_keywords(blocks, &["goal"])?;
    let mut memory = GoalMemory::default();
    for block in blocks {
        expect_fields(block, &["statement", "expect", "state"], &["serves"])?;
        memory.goals.push(Goal {
            name: block.name.clone(),
            serves: list(block, "serves"),
            statement: text(block, "statement")?,
            expect: list(block, "expect"),
            state: text(block, "state")?,
        });
    }
    Ok(memory)
}

pub fn validate(memory: &GoalMemory) -> Vec<String> {
    let mut problems = Vec::new();
    let mut names: BTreeSet<&str> = BTreeSet::new();
    for goal in &memory.goals {
        if !names.insert(goal.name.as_str()) {
            problems.push(format!(
                "the goal {:?} is declared twice; goal::{} must resolve to one goal",
                goal.name, goal.name
            ));
        }
        if !STATES.contains(&goal.state.as_str()) {
            problems.push(format!(
                "goal {:?} has state {:?}; a goal's state is one of {}",
                goal.name,
                goal.state,
                STATES.join(", ")
            ));
        }
        if goal.expect.is_empty() {
            problems.push(format!(
                "goal {:?} expects nothing; a goal names at least one rule or contract it waits on, or it would hold with nothing checked",
                goal.name
            ));
        }
        for identity in &goal.expect {
            if !is_canonical(identity) {
                problems.push(format!(
                    "goal {:?} expects {identity:?}, which is not a canonical identity; an expectation is contract::<group> or <group>::<label>",
                    goal.name
                ));
            }
        }
    }
    problems
}

fn is_canonical(identity: &str) -> bool {
    match identity.split_once("::") {
        Some(("contract", group)) => is_group(group),
        Some((group, label)) => {
            is_group(group) && !label.is_empty() && !label.contains("::") && label.trim() == label
        }
        None => false,
    }
}

fn is_group(group: &str) -> bool {
    !group.is_empty()
        && !group
            .chars()
            .any(|character| character == ':' || character.is_whitespace())
}

pub fn serving_problems(memory: &GoalMemory, mission: &Memory<MissionMemory>) -> Vec<String> {
    let mut problems = Vec::new();
    for goal in &memory.goals {
        for priority in &goal.serves {
            let reason = match mission {
                Memory::Present(declared)
                    if declared
                        .priorities
                        .iter()
                        .any(|found| &found.name == priority) =>
                {
                    continue;
                }
                Memory::Present(declared) => format!(
                    "the mission memory declares no such priority; declared priorities are {}",
                    named(
                        &declared
                            .priorities
                            .iter()
                            .map(|found| found.name.as_str())
                            .collect::<Vec<&str>>()
                    )
                ),
                Memory::Unregistered | Memory::Ignored(_) => {
                    "no mission memory is registered, so serves must stay empty until `mission \"path\"` registers one".to_owned()
                }
                other => format!(
                    "the mission memory is {}, so no priority resolves",
                    other.state()
                ),
            };
            problems.push(format!(
                "goal {:?} serves {priority:?}, but {reason}",
                goal.name
            ));
        }
    }
    problems
}

pub fn outcomes(memory: &Memory<GoalMemory>, lookup: impl Fn(&str) -> Verdict) -> Vec<Outcome> {
    memory
        .present()
        .map(|memory| {
            memory
                .goals
                .iter()
                .map(|goal| outcome(goal, &lookup))
                .collect()
        })
        .unwrap_or_default()
}

pub fn status(memory: &Memory<GoalMemory>, file: &str, outcomes: &[Outcome]) -> Option<GoalStatus> {
    if matches!(memory, Memory::Unregistered) {
        return None;
    }
    let counted = |state: &str| {
        outcomes
            .iter()
            .filter(|outcome| outcome.state == state)
            .count()
    };
    Some(GoalStatus {
        file: file.to_owned(),
        state: memory.state(),
        problems: memory.problems(),
        active: outcomes
            .iter()
            .filter(|outcome| outcome.state == STATES[0])
            .cloned()
            .collect(),
        done: counted(STATES[1]),
        dropped: counted(STATES[2]),
        authority: AUTHORITY,
    })
}

pub fn canonical(memory: &Memory<GoalMemory>, query: &str) -> Vec<String> {
    let Some(memory) = memory.present() else {
        return Vec::new();
    };
    let name = query.strip_prefix("goal::").unwrap_or(query);
    memory
        .goals
        .iter()
        .filter(|goal| goal.name == name)
        .map(Goal::id)
        .take(1)
        .collect()
}

pub fn explain(
    memory: &Memory<GoalMemory>,
    query: &str,
    outcomes: &[Outcome],
    serving_tasks: Vec<(String, String)>,
) -> Option<GoalExplainView> {
    let name = query.strip_prefix("goal::")?;
    let goal = memory
        .present()?
        .goals
        .iter()
        .find(|goal| goal.name == name)?;
    let outcome = outcomes
        .iter()
        .find(|outcome| outcome.goal == goal.id())?
        .clone();
    Some(GoalExplainView {
        kind: "goal",
        id: goal.id(),
        statement: goal.statement.clone(),
        state: goal.state.clone(),
        serves: goal
            .serves
            .iter()
            .map(|priority| format!("priority::{priority}"))
            .collect(),
        outcome,
        serving_tasks,
        authority: AUTHORITY,
    })
}

fn named(names: &[&str]) -> String {
    if names.is_empty() {
        return "none".to_owned();
    }
    names.join(", ")
}
