use super::{Finding, Task, covers};
use crate::memory::system::System;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome {
    Delivered,
    Partial,
    Blocked,
    NotApplicable,
}

impl Outcome {
    pub const ALL: [Outcome; 4] = [
        Outcome::Delivered,
        Outcome::Partial,
        Outcome::Blocked,
        Outcome::NotApplicable,
    ];

    pub const fn word(self) -> &'static str {
        match self {
            Outcome::Delivered => "delivered",
            Outcome::Partial => "partial",
            Outcome::Blocked => "blocked",
            Outcome::NotApplicable => "not-applicable",
        }
    }

    pub fn from_word(word: &str) -> Option<Outcome> {
        Outcome::ALL
            .into_iter()
            .find(|outcome| outcome.word() == word)
    }

    pub const fn leaves_residual(self) -> bool {
        matches!(self, Outcome::Partial | Outcome::Blocked)
    }

    pub fn words() -> String {
        Outcome::ALL.map(Outcome::word).join(", ")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Claim {
    Updated,
    Unchanged,
}

impl Claim {
    pub const ALL: [Claim; 2] = [Claim::Updated, Claim::Unchanged];

    pub const fn word(self) -> &'static str {
        match self {
            Claim::Updated => "updated",
            Claim::Unchanged => "unchanged",
        }
    }

    pub fn from_word(word: &str) -> Option<Claim> {
        Claim::ALL.into_iter().find(|claim| claim.word() == word)
    }

    pub fn words() -> String {
        Claim::ALL.map(Claim::word).join(", ")
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentClaim {
    pub intent: String,
    pub claim: Claim,
}

impl IntentClaim {
    pub fn parse(text: &str) -> Result<IntentClaim, String> {
        let invalid = || {
            format!(
                "claim {text:?} must read INTENT=CLAIM with CLAIM one of {}",
                Claim::words()
            )
        };
        let (intent, word) = text.split_once('=').ok_or_else(invalid)?;
        let claim = Claim::from_word(word).ok_or_else(invalid)?;
        if intent.is_empty() {
            return Err(invalid());
        }
        Ok(IntentClaim {
            intent: intent.to_owned(),
            claim,
        })
    }
}

pub fn affected_intents(task: &Task, systems: &[System]) -> Vec<String> {
    let mut affected: Vec<String> = systems
        .iter()
        .filter(|system| {
            system.paths.iter().any(|path| {
                task.scope
                    .iter()
                    .any(|scope| covers(path, scope) || covers(scope, path))
            })
        })
        .map(|system| format!("system::{}", system.name))
        .collect();
    affected.extend(task.goal.iter().map(|goal| format!("goal::{goal}")));
    affected
}

pub fn claim_mismatch(affected: &[String], claims: &[IntentClaim]) -> Option<String> {
    let mut claimed: Vec<&str> = claims.iter().map(|claim| claim.intent.as_str()).collect();
    claimed.sort_unstable();
    let duplicated = claimed.windows(2).any(|pair| pair[0] == pair[1]);
    let mut required: Vec<&str> = affected.iter().map(String::as_str).collect();
    required.sort_unstable();
    if claimed == required && !duplicated {
        return None;
    }
    Some(format!(
        "intent claims must name each affected intent once ({}); got ({})",
        required.join(", "),
        claimed.join(", ")
    ))
}

pub fn residual_finding(task: &Task, outcome: Outcome) -> Finding {
    Finding {
        id: task.next_finding_id(),
        statement: format!(
            "goal outcome {} at hand-back: the task does not deliver the goal it serves",
            outcome.word()
        ),
        addressed: None,
        resolution: None,
        residual: true,
    }
}
