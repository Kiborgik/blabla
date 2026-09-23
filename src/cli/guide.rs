use super::task;
use clap::ValueEnum;
use serde::Serialize;
use std::borrow::Cow;

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Topic {
    Agent,
    Bootstrap,
    Change,
    Memory,
    Loop,
}

pub const TOPICS: &str = include_str!("text/guide-topics.md");

const LOOP_HEAD: &str = include_str!("text/guide-loop-head.md");

const LOOP_TAIL: &str = include_str!("text/guide-loop-tail.md");

pub fn loop_text() -> String {
    format!(
        "{LOOP_HEAD}{}{LOOP_TAIL}",
        task::routes_text("<name>", Some("<the check the assignment declares>"))
    )
}

pub const AGENT: &str = include_str!("text/guide-agent.md");

pub const BOOTSTRAP: &str = include_str!("text/guide-bootstrap.md");

pub const CHANGE: &str = include_str!("text/guide-change.md");

pub const MEMORY: &str = include_str!("text/guide-memory.md");

pub fn text(topic: Option<Topic>) -> Cow<'static, str> {
    match topic {
        None => Cow::Borrowed(TOPICS),
        Some(Topic::Agent) => Cow::Borrowed(AGENT),
        Some(Topic::Bootstrap) => Cow::Borrowed(BOOTSTRAP),
        Some(Topic::Change) => Cow::Borrowed(CHANGE),
        Some(Topic::Memory) => Cow::Borrowed(MEMORY),
        Some(Topic::Loop) => Cow::Owned(loop_text()),
    }
}
