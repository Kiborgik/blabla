use blabla::project::status::CompletionState;
use blabla::project::task::{self, Evidence, Opening, Task};
use blabla::skeptic::{self, Evidence as Grounds};
use blabla::structure::falsify::FalsifyReport;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const WORKER: &str = "haiku-4.5";
const ORCHESTRATOR: &str = "opus-5";
const DELIVERABLE: &str = "src/attested.rs";
const CHECK: &str = "cargo test --test attestation";
const VERBS: [(&str, Option<&str>); 9] = [
    ("resolve", Some(ORCHESTRATOR)),
    ("attribute", Some(ORCHESTRATOR)),
    ("scope", None),
    ("check", None),
    ("deliverable --add", None),
    ("deliverable --remove", Some(ORCHESTRATOR)),
    ("approve-model", None),
    ("answer", Some(ORCHESTRATOR)),
    ("ask", Some(ORCHESTRATOR)),
];

pub struct Attestation {
    task: Task,
    tree: BTreeMap<String, String>,
    clock: u64,
    verbs: usize,
    close_refused: bool,
    confirm_refused: bool,
}

impl Attestation {
    pub fn new() -> Attestation {
        let tree = BTreeMap::from([(DELIVERABLE.to_owned(), "deliverable-0".to_owned())]);
        let task = task::record_from(
            Opening {
                name: "attested".to_owned(),
                role: "worker".to_owned(),
                statement: "a probe whose orchestrator records are attested, not proven".to_owned(),
                scope: vec!["src".to_owned()],
                deliverables: vec![DELIVERABLE.to_owned()],
                check: Some(CHECK.to_owned()),
                ..Default::default()
            },
            0,
            tree.clone(),
            vec![Some("deliverable-0".to_owned())],
        );
        Attestation {
            task,
            tree,
            clock: 0,
            verbs: 0,
            close_refused: false,
            confirm_refused: false,
        }
    }

    fn tick(&mut self) -> u64 {
        self.clock += 1;
        self.clock
    }

    pub fn call(&mut self, name: &str) -> bool {
        match name {
            "take_the_task" => self.take(),
            "record_an_orchestrator_verb_while_carried" => {
                if task::carrier(&self.task).is_some() {
                    self.record();
                }
            }
            "record_an_orchestrator_verb_while_not_carried" => {
                if task::carrier(&self.task).is_none() {
                    self.record();
                }
            }
            "hand_the_task_back" => self.hand_back(),
            "confirm_the_records_made_during_carry" => {
                self.hand_back();
                self.confirm();
            }
            "confirm_while_the_task_is_carried" => {
                if task::carrier(&self.task).is_some() {
                    self.confirm();
                }
            }
            "try_to_close_the_carried_task" => self.close(),
            _ => return false,
        }
        true
    }

    fn take(&mut self) {
        if self.task.open() && task::apply(&mut self.task, "accepted") {
            let unix = self.tick();
            task::record_acceptance(&mut self.task, &self.tree, WORKER, unix);
        }
    }

    fn confirm(&mut self) {
        if !self.task.open() {
            return;
        }
        let unix = self.tick();
        self.confirm_refused = task::confirm(&mut self.task, ORCHESTRATOR, unix).is_err();
    }

    fn record(&mut self) {
        if !self.task.open() {
            return;
        }
        let (verb, model) = VERBS[self.verbs % VERBS.len()];
        self.verbs += 1;
        let unix = self.tick();
        task::attest(&mut self.task, verb, model, unix);
    }

    fn hand_back(&mut self) {
        if task::carrier(&self.task).is_none() {
            return;
        }
        let unix = self.tick();
        self.tree
            .insert(DELIVERABLE.to_owned(), format!("deliverable-{unix}"));
        self.task.evidence.push(Evidence {
            check: CHECK.to_owned(),
            exit: 0,
            tree: format!("tree-{unix}"),
            tool: "cargo".to_owned(),
            unix,
            inputs: task::evidence_inputs(&self.task, &self.tree),
            command: None,
            log: None,
        });
        let blockers = self.report().assignment_blockers().len();
        task::record_challenge(&mut self.task, &self.tree, blockers, unix);
        let blockers = self.report().assignment_blockers().len();
        let _ = task::mark_ready(&mut self.task, &self.tree, blockers);
    }

    fn close(&mut self) {
        if !self.task.open() {
            self.close_refused = true;
            return;
        }
        let standing = self.report().grounded.len();
        let unix = self.tick();
        self.close_refused =
            !task::accept_result(&mut self.task, &self.tree, standing, ORCHESTRATOR, unix);
    }

    fn report(&self) -> skeptic::ChallengeReport {
        skeptic::challenge(&Grounds {
            task: Some(&self.task),
            tree: &self.tree,
            completion: CompletionState::Green,
            completion_reason: "",
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

    pub fn observe(&self) -> Value {
        let standing: Vec<Value> = self
            .report()
            .grounded
            .iter()
            .map(|class| json!({ "class": class }))
            .collect();
        json!({
            "carried": task::carrier(&self.task).is_some(),
            "records_during_carry": self.task.recorded_during_carry().count(),
            "unconfirmed_during_carry": self.task.unconfirmed_during_carry().count(),
            "carry_closed": !self.task.open(),
            "carry_close_refused": self.close_refused,
            "confirm_refused": self.confirm_refused,
            "attestation_standing": standing,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn standing(attestation: &Attestation) -> Vec<String> {
        attestation.observe()["attestation_standing"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["class"].as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn a_record_made_while_carried_stands_after_hand_back_and_holds_the_close_until_confirmed() {
        let mut attestation = Attestation::new();
        attestation.call("take_the_task");
        attestation.call("record_an_orchestrator_verb_while_carried");
        attestation.call("hand_the_task_back");
        let observed = attestation.observe();
        assert_eq!(observed["carried"], false, "{observed}");
        assert_eq!(observed["records_during_carry"], 1, "{observed}");
        assert_eq!(observed["unconfirmed_during_carry"], 1, "{observed}");
        assert_eq!(attestation.task.state, "ready");
        assert_eq!(
            standing(&attestation),
            vec!["orchestrator-record-during-carry".to_owned()]
        );
        attestation.call("try_to_close_the_carried_task");
        let observed = attestation.observe();
        assert_eq!(observed["carry_close_refused"], true, "{observed}");
        assert_eq!(observed["carry_closed"], false, "{observed}");
        attestation.call("confirm_the_records_made_during_carry");
        let observed = attestation.observe();
        assert_eq!(observed["unconfirmed_during_carry"], 0, "{observed}");
        assert_eq!(observed["records_during_carry"], 1, "{observed}");
        assert!(standing(&attestation).is_empty());
        attestation.call("try_to_close_the_carried_task");
        let observed = attestation.observe();
        assert_eq!(observed["carry_close_refused"], false, "{observed}");
        assert_eq!(observed["carry_closed"], true, "{observed}");
    }

    #[test]
    fn the_carrier_cannot_confirm_records_from_its_own_carry() {
        let mut attestation = Attestation::new();
        attestation.call("take_the_task");
        attestation.call("record_an_orchestrator_verb_while_carried");
        attestation.call("confirm_while_the_task_is_carried");
        let observed = attestation.observe();
        assert_eq!(observed["confirm_refused"], true, "{observed}");
        assert_eq!(observed["carried"], true, "{observed}");
        assert_eq!(observed["unconfirmed_during_carry"], 1, "{observed}");
        attestation.call("confirm_the_records_made_during_carry");
        let observed = attestation.observe();
        assert_eq!(observed["confirm_refused"], false, "{observed}");
        assert_eq!(observed["carried"], false, "{observed}");
        assert_eq!(observed["unconfirmed_during_carry"], 0, "{observed}");
        assert_eq!(attestation.task.state, "ready");
    }

    #[test]
    fn a_record_made_while_nobody_carries_the_task_is_kept_but_not_listed() {
        let mut attestation = Attestation::new();
        attestation.call("record_an_orchestrator_verb_while_not_carried");
        attestation.call("take_the_task");
        attestation.call("hand_the_task_back");
        attestation.call("record_an_orchestrator_verb_while_not_carried");
        assert_eq!(attestation.task.orchestrator_records.len(), 2);
        let observed = attestation.observe();
        assert_eq!(observed["records_during_carry"], 0, "{observed}");
        assert!(standing(&attestation).is_empty());
        attestation.call("try_to_close_the_carried_task");
        assert_eq!(attestation.observe()["carry_closed"], true);
    }
}
