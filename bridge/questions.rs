use blabla::project::status::CompletionState;
use blabla::project::task::{self, Acceptance, Answer, Ask, Evidence, Opening, Pick, Task};
use blabla::skeptic::{self, Evidence as Grounds};
use blabla::structure::falsify::FalsifyReport;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const WORKER: &str = "haiku-4.5";
const ORCHESTRATOR: &str = "opus-5";
const DELIVERABLE: &str = "src/asked.rs";
const CHECK: &str = "cargo test --test questions";
const CHOICES: [&str; 3] = ["this-task", "concurrent", "flaky"];
const QUESTION_FLOORS: [i64; 2] = [90, 100];
const BETWEEN: i64 = 80;

const PROCESS_TEXT: &str = r#"
role "orchestrator" {
    purpose "divide the work and ask the calls it doubts"
    model ["opus-5"]
}

role "worker" {
    purpose "carry out one bounded task"
    model ["haiku-4.5"]
    block_below "70"
}
"#;

pub struct Questions {
    task: Task,
    tree: BTreeMap<String, String>,
    role_floor: u8,
    orchestrator: Vec<String>,
    attempts: usize,
    clock: u64,
    ask_refused: bool,
    pick_refused: bool,
    handed_back: bool,
}

fn declared() -> (u8, Vec<String>) {
    let blocks = blabla::memory::syntax::parse("process.bla", PROCESS_TEXT)
        .expect("the process text parses");
    let process = blabla::memory::process::build(&blocks).expect("the process text builds");
    assert!(blabla::memory::process::validate(&process).is_empty());
    let floor = process
        .roles
        .iter()
        .find(|role| role.name == "worker")
        .map(|role| role.floor())
        .expect("the worker role is declared");
    (
        floor,
        blabla::memory::process::permitted_models(&process, "orchestrator"),
    )
}

impl Questions {
    pub fn new() -> Questions {
        let opened = BTreeMap::from([(DELIVERABLE.to_owned(), "asked-0".to_owned())]);
        let mut task = task::record_from(
            Opening {
                name: "asked".to_owned(),
                role: "worker".to_owned(),
                statement: "a probe the orchestrator questions before hand-back".to_owned(),
                scope: vec!["src".to_owned()],
                deliverables: vec![DELIVERABLE.to_owned()],
                check: Some(CHECK.to_owned()),
                ..Default::default()
            },
            0,
            opened,
            vec![Some("asked-0".to_owned())],
        );
        assert!(task::apply(&mut task, "accepted"));
        task.accepted = Some(Acceptance {
            model: WORKER.to_owned(),
            unix: 1,
            changed_at_acceptance: None,
        });
        let tree = BTreeMap::from([(DELIVERABLE.to_owned(), "asked-1".to_owned())]);
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
        let (role_floor, orchestrator) = declared();
        Questions {
            task,
            tree,
            role_floor,
            orchestrator,
            attempts: 0,
            clock: 2,
            ask_refused: false,
            pick_refused: false,
            handed_back: false,
        }
    }

    pub fn call(&mut self, name: &str) -> bool {
        match name {
            "ask_a_question_as_the_orchestrator" => {
                let floor = QUESTION_FLOORS[self.attempts % QUESTION_FLOORS.len()];
                self.ask(ORCHESTRATOR, floor);
            }
            "ask_a_question_as_a_worker" => {
                let floor = QUESTION_FLOORS[self.attempts % QUESTION_FLOORS.len()];
                self.ask(WORKER, floor);
            }
            "ask_with_a_floor_below_the_roles_floor" => {
                let below = [i64::from(self.role_floor) - 1, 0, -1];
                self.ask(ORCHESTRATOR, below[self.attempts % below.len()]);
            }
            "pick_at_or_above_the_questions_floor" => {
                if let Some((id, floor)) = self.first(false) {
                    let confidence = if self.attempts.is_multiple_of(2) {
                        i64::from(floor)
                    } else {
                        100
                    };
                    self.pick(id, confidence);
                }
            }
            "pick_between_the_roles_floor_and_the_questions_floor" => {
                if let Some((id, _)) = self.first(false) {
                    self.pick(id, BETWEEN);
                }
            }
            "pick_a_question_already_picked" => {
                if let Some((id, floor)) = self.first(true) {
                    let confidence = if self.attempts.is_multiple_of(2) {
                        100
                    } else {
                        i64::from(floor) - 1
                    };
                    self.pick(id, confidence);
                }
            }
            "try_to_hand_back_the_asked_task" => self.hand_back(),
            "answer_the_blocking_pick_and_resume" => self.answer_and_resume(),
            _ => return false,
        }
        true
    }

    fn tick(&mut self) -> u64 {
        self.clock += 1;
        self.clock
    }

    fn ask(&mut self, model: &str, floor: i64) {
        let choice = !self.attempts.is_multiple_of(2);
        self.attempts += 1;
        let asked = Ask {
            question: format!("Is failure {} this task's?", self.attempts),
            options: if choice {
                CHOICES.map(str::to_owned).to_vec()
            } else {
                Vec::new()
            },
            floor: Some(floor),
            model: model.to_owned(),
        };
        self.ask_refused =
            task::ask(&mut self.task, asked, self.role_floor, &self.orchestrator).is_err();
        if !self.ask_refused {
            let unix = self.tick();
            task::attest(&mut self.task, "ask", Some(model), unix);
        }
    }

    fn first(&self, picked: bool) -> Option<(String, u8)> {
        self.task
            .questions
            .iter()
            .find(|asked| task::picked_by(&self.task, &asked.id).is_some() == picked)
            .map(|asked| (asked.id.clone(), asked.floor))
    }

    fn pick(&mut self, on: String, confidence: i64) {
        let options = self
            .task
            .questions
            .iter()
            .find(|asked| asked.id == on)
            .map(|asked| asked.options.clone())
            .unwrap_or_default();
        self.attempts += 1;
        let given = Pick {
            on,
            pick: options[self.attempts % options.len()].clone(),
            confidence,
            model: WORKER.to_owned(),
        };
        self.pick_refused = task::pick(&mut self.task, given, self.role_floor).is_err();
    }

    fn answer_and_resume(&mut self) {
        let Some(blocking) = task::unanswered_decision(&self.task) else {
            return;
        };
        let id = blocking.id;
        let pick = if self.attempts.is_multiple_of(2) {
            blocking.pick.clone()
        } else {
            blocking
                .options
                .iter()
                .find(|option| **option != blocking.pick)
                .cloned()
                .expect("a decision has at least two options")
        };
        self.attempts += 1;
        let answered = task::answer(
            &mut self.task,
            id,
            Answer {
                pick,
                model: ORCHESTRATOR.to_owned(),
                reason: "the orchestrator read the evidence behind the pick".to_owned(),
            },
        );
        assert!(answered.is_ok(), "{answered:?}");
        let unix = self.tick();
        task::attest(&mut self.task, "answer", Some(ORCHESTRATOR), unix);
        if task::apply(&mut self.task, "accepted") {
            let unix = self.tick();
            task::record_acceptance(&mut self.task, &self.tree, WORKER, unix);
        }
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

    fn hand_back(&mut self) {
        let unix = self.tick();
        let blockers = self.report().assignment_blockers().len();
        task::record_challenge(&mut self.task, &self.tree, blockers, unix);
        let blockers = self.report().assignment_blockers().len();
        self.handed_back = task::mark_ready(&mut self.task, &self.tree, blockers).is_ok();
        if self.handed_back {
            assert!(task::apply(&mut self.task, "accepted"));
        }
    }

    pub fn observe(&self) -> Value {
        let standing: Vec<Value> = self
            .report()
            .grounded
            .iter()
            .map(|class| json!({ "class": class }))
            .collect();
        json!({
            "role_floor": self.role_floor,
            "questions_asked": self.task.questions.len(),
            "questions_unpicked": self.task.unpicked().count(),
            "ask_refused": self.ask_refused,
            "pick_refused": self.pick_refused,
            "asked_task_blocked": self.task.state == "blocked",
            "asked_task_handed_back": self.handed_back,
            "question_standing": standing,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn standing(questions: &Questions) -> Vec<String> {
        questions.observe()["question_standing"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["class"].as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn an_asked_question_holds_the_hand_back_until_a_confident_pick_settles_it() {
        let mut questions = Questions::new();
        assert_eq!(questions.observe()["role_floor"], 70);
        questions.call("ask_a_question_as_the_orchestrator");
        let observed = questions.observe();
        assert_eq!(observed["questions_asked"], 1, "{observed}");
        assert_eq!(observed["questions_unpicked"], 1, "{observed}");
        assert_eq!(observed["ask_refused"], false, "{observed}");
        questions.call("try_to_hand_back_the_asked_task");
        assert_eq!(questions.observe()["asked_task_handed_back"], false);
        assert!(standing(&questions).contains(&"question-unpicked".to_owned()));
        questions.call("pick_at_or_above_the_questions_floor");
        let observed = questions.observe();
        assert_eq!(observed["questions_unpicked"], 0, "{observed}");
        assert_eq!(observed["asked_task_blocked"], false, "{observed}");
        questions.call("pick_a_question_already_picked");
        assert_eq!(questions.observe()["pick_refused"], true);
        questions.call("try_to_hand_back_the_asked_task");
        let observed = questions.observe();
        assert_eq!(observed["asked_task_handed_back"], true, "{observed}");
        assert!(!standing(&questions).contains(&"question-unpicked".to_owned()));
    }

    #[test]
    fn a_pick_between_the_floors_blocks_and_a_worker_or_a_low_floor_cannot_ask() {
        let mut questions = Questions::new();
        questions.call("ask_a_question_as_a_worker");
        assert_eq!(questions.observe()["ask_refused"], true);
        for _ in 0..3 {
            questions.call("ask_with_a_floor_below_the_roles_floor");
            assert_eq!(questions.observe()["ask_refused"], true);
        }
        assert_eq!(questions.observe()["questions_asked"], 0);
        questions.call("ask_a_question_as_the_orchestrator");
        questions.call("pick_between_the_roles_floor_and_the_questions_floor");
        let observed = questions.observe();
        assert_eq!(observed["asked_task_blocked"], true, "{observed}");
        assert_eq!(observed["questions_unpicked"], 0, "{observed}");
        assert!(standing(&questions).contains(&"decision-unanswered".to_owned()));
        questions.call("answer_the_blocking_pick_and_resume");
        let observed = questions.observe();
        assert_eq!(observed["asked_task_blocked"], false, "{observed}");
        assert!(!standing(&questions).contains(&"decision-unanswered".to_owned()));
        questions.call("ask_a_question_as_the_orchestrator");
        questions.call("pick_at_or_above_the_questions_floor");
        questions.call("try_to_hand_back_the_asked_task");
        let observed = questions.observe();
        assert_eq!(observed["asked_task_handed_back"], true, "{observed}");
    }
}
