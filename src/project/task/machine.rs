use super::{Task, challenge_current, readiness, unanswered_decision};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskState {
    #[default]
    Open,
    Accepted,
    Blocked,
    Ready,
    Closed,
    Withdrawn,
}

impl TaskState {
    pub const ALL: [TaskState; 6] = [
        TaskState::Open,
        TaskState::Accepted,
        TaskState::Blocked,
        TaskState::Ready,
        TaskState::Closed,
        TaskState::Withdrawn,
    ];

    pub const fn word(self) -> &'static str {
        match self {
            TaskState::Open => "open",
            TaskState::Accepted => "accepted",
            TaskState::Blocked => "blocked",
            TaskState::Ready => "ready",
            TaskState::Closed => "closed",
            TaskState::Withdrawn => "withdrawn",
        }
    }

    pub fn label(self) -> String {
        self.word().to_ascii_uppercase()
    }

    pub const fn live(self) -> bool {
        !matches!(self, TaskState::Closed | TaskState::Withdrawn)
    }

    pub fn from_word(word: &str) -> Option<TaskState> {
        TaskState::ALL
            .into_iter()
            .find(|state| state.word() == word)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Accept,
    Block,
    Ready,
    Close,
    Withdraw,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Guard {
    DecisionAnswered,
    AssignmentAccepted,
    QuestionsPicked,
    CheckDeclared,
    EvidenceSupported,
    ChallengeCurrent,
    ChallengeClear,
    OutcomeClaimed,
    IntentClaimed,
}

impl Guard {
    pub const fn code(self) -> &'static str {
        match self {
            Guard::DecisionAnswered => "await-answer",
            Guard::AssignmentAccepted => "accept",
            Guard::QuestionsPicked => "pick-question",
            Guard::CheckDeclared => "declare-check",
            Guard::EvidenceSupported => "record-evidence",
            Guard::ChallengeCurrent => "challenge",
            Guard::ChallengeClear => "resolve-challenge",
            Guard::OutcomeClaimed => "claim-outcome",
            Guard::IntentClaimed => "claim-intent",
        }
    }

    fn holds(self, task: &Task, facts: &Facts<'_>) -> bool {
        match self {
            Guard::DecisionAnswered => unanswered_decision(task).is_none(),
            Guard::AssignmentAccepted => task.accepted.is_some(),
            Guard::QuestionsPicked => task.unpicked().next().is_none(),
            Guard::CheckDeclared => task.declares_check(),
            Guard::EvidenceSupported => readiness(task, facts.tree).supported,
            Guard::ChallengeCurrent => challenge_current(task, facts.tree),
            Guard::ChallengeClear => facts.standing == 0,
            Guard::OutcomeClaimed => task.goal.is_some() == task.outcome.is_some(),
            Guard::IntentClaimed => {
                !task.asks_intent
                    || facts
                        .intents
                        .map_or(!task.intent_claims.is_empty(), |required| {
                            task.intent_claims.len() == required
                        })
            }
        }
    }
}

#[derive(Debug)]
pub struct Transition {
    pub command: Command,
    pub from: &'static [TaskState],
    pub to: TaskState,
    pub guards: &'static [Guard],
    pub clears_challenge: bool,
}

const LIVE: &[TaskState] = &[
    TaskState::Open,
    TaskState::Accepted,
    TaskState::Blocked,
    TaskState::Ready,
];

const WORKING: &[TaskState] = &[TaskState::Open, TaskState::Accepted, TaskState::Blocked];

pub const TRANSITIONS: &[Transition] = &[
    Transition {
        command: Command::Accept,
        from: LIVE,
        to: TaskState::Accepted,
        guards: &[Guard::DecisionAnswered],
        clears_challenge: true,
    },
    Transition {
        command: Command::Block,
        from: &[TaskState::Accepted],
        to: TaskState::Blocked,
        guards: &[],
        clears_challenge: true,
    },
    Transition {
        command: Command::Ready,
        from: &[TaskState::Accepted],
        to: TaskState::Ready,
        guards: &[
            Guard::DecisionAnswered,
            Guard::AssignmentAccepted,
            Guard::QuestionsPicked,
            Guard::CheckDeclared,
            Guard::EvidenceSupported,
            Guard::ChallengeCurrent,
            Guard::ChallengeClear,
            Guard::OutcomeClaimed,
            Guard::IntentClaimed,
        ],
        clears_challenge: false,
    },
    Transition {
        command: Command::Close,
        from: &[TaskState::Ready],
        to: TaskState::Closed,
        guards: &[
            Guard::ChallengeClear,
            Guard::EvidenceSupported,
            Guard::ChallengeCurrent,
        ],
        clears_challenge: false,
    },
    Transition {
        command: Command::Withdraw,
        from: LIVE,
        to: TaskState::Withdrawn,
        guards: &[],
        clears_challenge: true,
    },
];

pub struct Facts<'a> {
    pub tree: &'a BTreeMap<String, String>,
    pub standing: usize,
    pub intents: Option<usize>,
}

static NO_TREE: BTreeMap<String, String> = BTreeMap::new();

impl Facts<'static> {
    pub fn record_only() -> Facts<'static> {
        Facts {
            tree: &NO_TREE,
            standing: 0,
            intents: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    State(TaskState),
    Guard(Guard),
}

fn transition_from(command: Command, state: TaskState) -> Option<&'static Transition> {
    TRANSITIONS
        .iter()
        .find(|row| row.command == command && row.from.contains(&state))
}

fn admitted(
    task: &Task,
    command: Command,
    facts: &Facts<'_>,
    skipped: &[Guard],
) -> Result<&'static Transition, Refusal> {
    let row = transition_from(command, task.state).ok_or(Refusal::State(task.state))?;
    match row
        .guards
        .iter()
        .filter(|guard| !skipped.contains(guard))
        .find(|guard| !guard.holds(task, facts))
    {
        Some(guard) => Err(Refusal::Guard(*guard)),
        None => Ok(row),
    }
}

pub const CLAIM_GUARDS: &[Guard] = &[Guard::OutcomeClaimed, Guard::IntentClaimed];

pub fn refusal(task: &Task, command: Command, facts: &Facts<'_>) -> Option<Refusal> {
    admitted(task, command, facts, &[]).err()
}

pub fn refusal_without(
    task: &Task,
    command: Command,
    facts: &Facts<'_>,
    skipped: &[Guard],
) -> Option<Refusal> {
    admitted(task, command, facts, skipped).err()
}

pub fn fire(task: &mut Task, command: Command, facts: &Facts<'_>) -> Result<(), Refusal> {
    let row = admitted(task, command, facts, &[])?;
    task.state = row.to;
    if row.clears_challenge {
        task.challenged = None;
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    Accept,
    Check,
    Blocker,
    Note,
    Finding,
    Addressed,
    Decide,
    Lens,
    Challenge,
    Falsify,
    HandBack,
}

const RECORD_ROUTES: &[(Route, &[TaskState])] = &[
    (Route::Check, &TaskState::ALL),
    (Route::Note, WORKING),
    (Route::Finding, LIVE),
    (Route::Addressed, WORKING),
    (Route::Decide, WORKING),
    (Route::Lens, &[TaskState::Accepted]),
    (Route::Challenge, LIVE),
    (Route::Falsify, &[TaskState::Accepted]),
];

impl Route {
    pub const ALL: [Route; 11] = [
        Route::Accept,
        Route::Check,
        Route::Blocker,
        Route::Note,
        Route::Finding,
        Route::Addressed,
        Route::Decide,
        Route::Lens,
        Route::Challenge,
        Route::Falsify,
        Route::HandBack,
    ];

    pub const fn word(self) -> &'static str {
        match self {
            Route::Accept => "accept",
            Route::Check => "check",
            Route::Blocker => "blocker",
            Route::Note => "note",
            Route::Finding => "finding",
            Route::Addressed => "addressed",
            Route::Decide => "decide",
            Route::Lens => "lens",
            Route::Challenge => "challenge",
            Route::Falsify => "falsify",
            Route::HandBack => "hand-back",
        }
    }

    pub const fn command(self) -> Option<Command> {
        match self {
            Route::Accept => Some(Command::Accept),
            Route::Blocker => Some(Command::Block),
            Route::HandBack => Some(Command::Ready),
            _ => None,
        }
    }

    pub fn offered_in(self, state: TaskState) -> bool {
        match self.command() {
            Some(command) => transition_from(command, state).is_some(),
            None => RECORD_ROUTES
                .iter()
                .any(|(route, states)| *route == self && states.contains(&state)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::TaskState::{Accepted, Blocked, Closed, Open, Ready, Withdrawn};
    use super::*;

    #[test]
    fn each_command_moves_from_exactly_its_states_to_one_state() {
        let expected: [(Command, &[TaskState], TaskState); 5] = [
            (Command::Accept, &[Open, Accepted, Blocked, Ready], Accepted),
            (Command::Block, &[Accepted], Blocked),
            (Command::Ready, &[Accepted], Ready),
            (Command::Close, &[Ready], Closed),
            (
                Command::Withdraw,
                &[Open, Accepted, Blocked, Ready],
                Withdrawn,
            ),
        ];
        let table: Vec<(Command, Vec<TaskState>, TaskState)> = TRANSITIONS
            .iter()
            .map(|row| (row.command, row.from.to_vec(), row.to))
            .collect();
        let wanted: Vec<(Command, Vec<TaskState>, TaskState)> = expected
            .iter()
            .map(|(command, from, to)| (*command, from.to_vec(), *to))
            .collect();
        assert_eq!(table, wanted);
    }

    #[test]
    fn each_route_is_offered_in_exactly_its_states() {
        let working: &[TaskState] = &[Open, Accepted, Blocked];
        let live: &[TaskState] = &[Open, Accepted, Blocked, Ready];
        let expected: [(Route, &[TaskState]); 11] = [
            (Route::Accept, live),
            (Route::Check, &TaskState::ALL),
            (Route::Blocker, &[Accepted]),
            (Route::Note, working),
            (Route::Finding, live),
            (Route::Addressed, working),
            (Route::Decide, working),
            (Route::Lens, &[Accepted]),
            (Route::Challenge, live),
            (Route::Falsify, &[Accepted]),
            (Route::HandBack, &[Accepted]),
        ];
        for (route, states) in expected {
            let offered: Vec<TaskState> = TaskState::ALL
                .into_iter()
                .filter(|state| route.offered_in(*state))
                .collect();
            assert_eq!(offered, states.to_vec(), "{}", route.word());
        }
    }

    #[test]
    fn a_route_bound_to_a_command_is_offered_where_its_transition_starts() {
        for route in Route::ALL {
            let Some(command) = route.command() else {
                continue;
            };
            let row = TRANSITIONS
                .iter()
                .find(|row| row.command == command)
                .expect("every routed command has a transition");
            for state in TaskState::ALL {
                assert_eq!(route.offered_in(state), row.from.contains(&state));
            }
        }
    }

    #[test]
    fn a_refused_command_names_its_reason_and_leaves_the_task_as_it_was() {
        let cases = [
            (Open, Command::Block, Refusal::State(Open)),
            (Closed, Command::Accept, Refusal::State(Closed)),
            (Withdrawn, Command::Withdraw, Refusal::State(Withdrawn)),
            (
                Accepted,
                Command::Ready,
                Refusal::Guard(Guard::AssignmentAccepted),
            ),
            (
                Ready,
                Command::Close,
                Refusal::Guard(Guard::EvidenceSupported),
            ),
        ];
        for (state, command, refused) in cases {
            let mut task = Task {
                state,
                ..Task::default()
            };
            let before = serde_json::to_value(&task).expect("a task serializes");
            assert_eq!(
                fire(&mut task, command, &Facts::record_only()),
                Err(refused)
            );
            assert_eq!(
                serde_json::to_value(&task).expect("a task serializes"),
                before
            );
        }
    }

    #[test]
    fn every_state_word_reads_and_writes_back_unchanged() {
        let words = [
            "open",
            "accepted",
            "blocked",
            "ready",
            "closed",
            "withdrawn",
        ];
        for word in words {
            let state: TaskState =
                serde_json::from_value(serde_json::json!(word)).expect("a state word reads");
            assert_eq!(state.word(), word);
            assert_eq!(serde_json::to_value(state).expect("a state writes"), word);
            assert_eq!(TaskState::from_word(word), Some(state));
        }
        assert_eq!(TaskState::ALL.map(TaskState::word).to_vec(), words.to_vec());
        assert_eq!(TaskState::from_word("CLOSED"), None);
    }
}
