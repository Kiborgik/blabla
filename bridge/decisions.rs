use blabla::project::status::CompletionState;
use blabla::project::task::{self, Acceptance, Answer, Evidence, Question, Task};
use blabla::skeptic::{self, Evidence as Grounds};
use blabla::structure::falsify::FalsifyReport;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const WORKER: &str = "haiku-4.5";
const ORCHESTRATOR: &str = "opus-5";
const DELIVERABLE: &str = "src/deliverable.rs";
const CHECK: &str = "cargo test --lib decisions";
const CHOICES: [&str; 3] = ["cache", "lock", "clock"];

const PROCESS_TEXT: &str = r#"
role "worker" {
    purpose "carry out one bounded task"
    model ["haiku-4.5"]
    block_below "60"
}
"#;

pub struct Decisions {
    task: Task,
    tree: BTreeMap<String, String>,
    floor: u8,
    asked: usize,
    last_refused: bool,
    handed_back: bool,
}

fn declared_floor() -> u8 {
    let blocks = blabla::memory::syntax::parse("process.bla", PROCESS_TEXT)
        .expect("the process text parses");
    let process = blabla::memory::process::build(&blocks).expect("the process text builds");
    assert!(blabla::memory::process::validate(&process).is_empty());
    process
        .roles
        .iter()
        .find(|role| role.name == "worker")
        .map(|role| role.floor())
        .expect("the worker role is declared")
}

impl Decisions {
    pub fn new() -> Decisions {
        let opened = BTreeMap::from([(DELIVERABLE.to_owned(), "deliverable-0".to_owned())]);
        let mut task = task::record_from(
            task::Opening {
                name: "decide".to_owned(),
                role: "worker".to_owned(),
                statement: "a probe that asks instead of guessing".to_owned(),
                scope: vec!["src".to_owned()],
                deliverables: vec![DELIVERABLE.to_owned()],
                check: Some(CHECK.to_owned()),
                ..Default::default()
            },
            0,
            opened.clone(),
            vec![Some("deliverable-0".to_owned())],
        );
        assert!(task::apply(&mut task, "accepted"));
        task.accepted = Some(Acceptance {
            model: WORKER.to_owned(),
            unix: 1,
            changed_at_acceptance: None,
        });
        let tree = BTreeMap::from([(DELIVERABLE.to_owned(), "deliverable-1".to_owned())]);
        task.evidence.push(Evidence {
            check: CHECK.to_owned(),
            exit: 0,
            tree: "tree".to_owned(),
            tool: "cargo".to_owned(),
            unix: 2,
            inputs: task::evidence_inputs(&task, &tree),
            command: None,
            log: None,
        });
        Decisions {
            task,
            tree,
            floor: declared_floor(),
            asked: 0,
            last_refused: false,
            handed_back: false,
        }
    }

    pub fn call(&mut self, name: &str) -> bool {
        match name {
            "decide_at_or_above_the_floor" => {
                let confidence = if self.asked.is_multiple_of(2) {
                    self.floor
                } else {
                    100
                };
                self.ask(None, i64::from(confidence));
            }
            "decide_below_the_floor" => {
                let confidence = if self.asked.is_multiple_of(2) {
                    self.floor.saturating_sub(1)
                } else {
                    0
                };
                self.ask(None, i64::from(confidence));
            }
            "decide_on_a_blocked_task" => self.ask(None, 100),
            "decide_with_a_pick_outside_the_options" => {
                let outside = if self.asked.is_multiple_of(2) {
                    "maybe"
                } else {
                    "fan"
                };
                self.ask(Some(outside), i64::from(self.floor));
            }
            "decide_with_a_confidence_outside_the_range" => {
                let confidence = if self.asked.is_multiple_of(2) {
                    101
                } else {
                    -1
                };
                self.ask(None, confidence);
            }
            "answer_agreeing_with_the_pick" => self.answer(true),
            "answer_overruling_the_pick" => self.answer(false),
            "try_to_hand_back" => self.hand_back(),
            "resume_while_a_decision_is_unanswered" => {
                task::apply(&mut self.task, "accepted");
            }
            _ => return false,
        }
        true
    }

    fn ask(&mut self, outside: Option<&str>, confidence: i64) {
        let choice = !self.asked.is_multiple_of(2);
        self.asked += 1;
        let (options, pick) = if choice {
            (
                CHOICES.map(str::to_owned).to_vec(),
                outside.unwrap_or(CHOICES[self.asked % CHOICES.len()]),
            )
        } else {
            (Vec::new(), outside.unwrap_or(task::YES_NO[self.asked % 2]))
        };
        let asked = Question {
            question: format!("question {}", self.asked),
            options,
            pick: pick.to_owned(),
            confidence,
            model: WORKER.to_owned(),
        };
        self.last_refused = task::decide(&mut self.task, asked, self.floor).is_err();
    }

    fn target(&self) -> Option<&task::Decision> {
        self.task
            .decisions
            .iter()
            .find(|decision| decision.unanswered_below_floor())
            .or_else(|| {
                self.task
                    .decisions
                    .iter()
                    .rev()
                    .find(|decision| decision.answer.is_none())
            })
    }

    fn answer(&mut self, agreeing: bool) {
        let Some(decision) = self.target() else {
            return;
        };
        let pick = if agreeing {
            decision.pick.clone()
        } else {
            decision
                .options
                .iter()
                .find(|option| **option != decision.pick)
                .cloned()
                .expect("a decision has at least two options")
        };
        let id = decision.id;
        let answered = task::answer(
            &mut self.task,
            id,
            Answer {
                pick,
                model: ORCHESTRATOR.to_owned(),
                reason: "the orchestrator read the evidence".to_owned(),
            },
        );
        assert!(answered.is_ok(), "{answered:?}");
    }

    fn report(&self) -> skeptic::ChallengeReport {
        skeptic::challenge(&Grounds {
            task: Some(&self.task),
            tree: &self.tree,
            completion: CompletionState::Stale,
            completion_reason: "during a worker's task the project run is the orchestrator's and not current",
            falsify: &|| FalsifyReport {
                invocations: 0,
                falsifiable: 0,
                vacuous: 0,
                unevaluable: 0,
                total: 0,
                rules: Vec::new(),
            },
            role: None,
            other_tasks: &[],
        })
    }

    fn blockers(&self) -> usize {
        self.report()
            .grounded
            .iter()
            .filter(|class| !matches!(**class, "verification-not-current" | "vacuous-rule"))
            .count()
    }

    fn hand_back(&mut self) {
        let blockers = self.blockers();
        task::record_challenge(&mut self.task, &self.tree, blockers, 3);
        self.handed_back = task::mark_ready(&mut self.task, &self.tree, blockers).is_ok();
        if self.handed_back {
            assert!(task::apply(&mut self.task, "accepted"));
        }
    }

    pub fn observe(&self) -> Value {
        let calibration = task::calibration(std::slice::from_ref(&self.task), str::to_owned);
        let total = |count: fn(&task::Calibration) -> usize| -> usize {
            calibration.iter().map(count).sum()
        };
        let standing: Vec<Value> = self
            .report()
            .grounded
            .iter()
            .map(|class| json!({ "class": class }))
            .collect();
        json!({
            "floor_percent": self.floor,
            "decisions": self.task.decisions.len(),
            "unanswered_below_floor": self
                .task
                .decisions
                .iter()
                .filter(|decision| decision.unanswered_below_floor())
                .count(),
            "blocked": self.task.state == "blocked",
            "answered": total(|model| model.answered),
            "answers_held": total(|model| model.held),
            "overruled": total(|model| model.overruled),
            "last_refused": self.last_refused,
            "handed_back": self.handed_back,
            "decision_standing": standing,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_decision_below_the_floor_blocks_until_answered_and_resumed() {
        let mut ledger = Decisions::new();
        assert_eq!(ledger.observe()["floor_percent"], 60);
        ledger.call("decide_below_the_floor");
        assert_eq!(ledger.observe()["blocked"], true);
        ledger.call("resume_while_a_decision_is_unanswered");
        ledger.call("try_to_hand_back");
        let observed = ledger.observe();
        assert_eq!(observed["blocked"], true, "{observed}");
        assert_eq!(observed["handed_back"], false, "{observed}");
        ledger.call("answer_overruling_the_pick");
        assert_eq!(ledger.observe()["blocked"], true);
        ledger.call("resume_while_a_decision_is_unanswered");
        ledger.call("try_to_hand_back");
        let observed = ledger.observe();
        assert_eq!(observed["handed_back"], true, "{observed}");
        assert_eq!(observed["overruled"], 1);
    }

    #[test]
    fn a_decision_at_the_floor_stands() {
        let mut ledger = Decisions::new();
        ledger.call("decide_at_or_above_the_floor");
        let observed = ledger.observe();
        assert_eq!(observed["decisions"], 1);
        assert_eq!(observed["unanswered_below_floor"], 0);
        assert_eq!(observed["blocked"], false);
    }
}
