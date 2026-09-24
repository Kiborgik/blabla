use blabla::memory::goal::{self, Goal, Outcome, Verdict};
use blabla::project::status::{CompletionState, State, state_verdict};
use blabla::skeptic::{self, Evidence};
use blabla::structure::falsify::FalsifyReport;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const WRITTEN_RULE: &str = "demo::a-written-rule";
const UNWRITTEN_RULE: &str = "demo::an-unwritten-rule";

pub struct Goals {
    goal: Option<Goal>,
    recorded: State,
    stale: bool,
}

impl Goals {
    pub fn new() -> Goals {
        Goals {
            goal: None,
            recorded: State::Unverified,
            stale: false,
        }
    }

    pub fn call(&mut self, name: &str) -> bool {
        match name {
            "declare_an_active_goal_on_a_green_rule" => {
                self.recorded = State::Green;
                self.stale = false;
                self.goal = Some(declared(&[WRITTEN_RULE]));
            }
            "declare_an_active_goal_on_an_unwritten_rule" => {
                self.goal = Some(declared(&[WRITTEN_RULE, UNWRITTEN_RULE]));
            }
            "the_expected_rule_turns_red" => {
                self.recorded = State::Red;
                self.stale = false;
            }
            "the_recorded_run_goes_stale" => self.stale = true,
            "mark_the_goal_done" => self.mark(goal::STATES[1]),
            "drop_the_goal" => self.mark(goal::STATES[2]),
            _ => return false,
        }
        true
    }

    fn mark(&mut self, state: &str) {
        if let Some(goal) = self.goal.as_mut() {
            goal.state = state.to_owned();
        }
    }

    fn lookup(&self, identity: &str) -> Verdict {
        if identity != WRITTEN_RULE {
            return Verdict::Unresolved;
        }
        state_verdict(if self.stale {
            State::Stale
        } else {
            self.recorded
        })
    }

    pub fn observe(&self) -> Value {
        let outcomes: Vec<Outcome> = self
            .goal
            .iter()
            .map(|goal| goal::outcome(goal, |identity| self.lookup(identity)))
            .collect();
        let falsified = || FalsifyReport {
            invocations: 0,
            falsifiable: 0,
            vacuous: 0,
            unevaluable: 0,
            total: 0,
            rules: Vec::new(),
        };
        let completion = if self.stale {
            CompletionState::Stale
        } else {
            CompletionState::Green
        };
        let report = skeptic::challenge_with_goals(
            &Evidence {
                task: None,
                tree: &BTreeMap::new(),
                completion,
                completion_reason: "the goals bridge models the recorded run",
                falsify: &falsified,
                role: None,
                other_tasks: &[],
            },
            &outcomes,
        );
        let standing: Vec<Value> = report
            .grounded
            .iter()
            .map(|class| json!({ "class": class }))
            .collect();
        let outcome = outcomes.first();
        json!({
            "goal_state": outcome.map(|outcome| outcome.state.as_str()).unwrap_or("none"),
            "expectations": outcome.map(|outcome| outcome.expected).unwrap_or(0),
            "held": outcome.map(|outcome| outcome.held).unwrap_or(0),
            "unverified": outcome.map(|outcome| outcome.unverified).unwrap_or(0),
            "unresolved": outcome.map(|outcome| outcome.unresolved).unwrap_or(0),
            "goal_standing": standing,
        })
    }
}

fn declared(expect: &[&str]) -> Goal {
    Goal {
        name: "ship-goals".to_owned(),
        serves: Vec::new(),
        statement: "Goals are executable objectives.".to_owned(),
        expect: expect
            .iter()
            .map(|identity| (*identity).to_owned())
            .collect(),
        state: goal::STATES[0].to_owned(),
    }
}
