use blabla::project::status::CompletionState;
use blabla::project::task::{
    self, Acceptance, Assessment, Attribution, Evidence, Exception, Finding, FindingResolution,
    Note, Task,
};
use blabla::skeptic::{self, Evidence as Grounds};
use blabla::structure::falsify::FalsifyReport;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const PERMITTED: &str = "haiku-4.5";
const ALIAS: &str = "haiku45-host-id";
const OUTSIDE_POLICY: &str = "sonnet-4";
const UNAPPROVED_MODEL: &str = "gpt-4-turbo";
const DECLARED_CHECK: &str = "cargo test --lib structure";

const PROCESS_TEXT: &str = r#"
role "worker" {
    purpose "carry out one bounded task"
    model ["haiku-4.5", "gpt-5.6-luna"]
    consult ["testing"]
}

alias "haiku45-host-id" { model "haiku-4.5" }
"#;
const OTHER_CHECK: &str = "cargo test --doc";
const DELIVERABLE: &str = "src/deliverable.rs";
const SHARED_INPUT: &str = "src/shared.rs";
const UNRELATED: &str = "src/notes.md";
const OUTSIDE_SCOPE: &str = "other/elsewhere.rs";
const BREACHED: &str = "other/worker.rs";
const UNKNOWN: &str = "other/unknown.rs";
const CONCURRENT_PATH: &str = "other/concurrent.rs";

pub struct Assignment {
    task: Task,
    tree: BTreeMap<String, String>,
    resolution: task::Resolution,
    revision: u64,
    opened: usize,
    other_tasks: Vec<Task>,
    late_deliverable_reads_unchanged: Option<bool>,
    address_refused: bool,
}

fn digest(seed: &str) -> String {
    seed.to_owned()
}

const ROLES: [&str; 3] = ["worker", "orchestrator", "reviewer"];

fn opening(role: &str, revision: usize) -> task::Opening {
    task::Opening {
        name: format!("probe-{revision}"),
        role: role.to_owned(),
        statement: "a probe assignment".to_owned(),
        scope: vec!["src".to_owned()],
        deliverables: vec![DELIVERABLE.to_owned()],
        check: Some(DECLARED_CHECK.to_owned()),
        inputs: vec![SHARED_INPUT.to_owned()],
        ..Default::default()
    }
}

fn lenses_for(role: &str) -> Vec<String> {
    match role {
        "reviewer" => vec![
            "reviewing".to_owned(),
            "engineering".to_owned(),
            "design".to_owned(),
        ],
        "orchestrator" => vec!["engineering".to_owned(), "design".to_owned()],
        _ => vec!["engineering".to_owned(), "testing".to_owned()],
    }
}

impl Assignment {
    pub fn new() -> Assignment {
        let mut assignment = Assignment {
            task: Task {
                name: "probe".to_owned(),
                role: "worker".to_owned(),
                ..Default::default()
            },
            tree: BTreeMap::new(),
            resolution: task::Resolution {
                models: Vec::new(),
                lenses: Vec::new(),
                requirements: Vec::new(),
                verification: "focused".to_owned(),
            },
            revision: 0,
            opened: 2,
            other_tasks: Vec::new(),
            late_deliverable_reads_unchanged: None,
            address_refused: false,
        };
        assignment.open();
        assignment
    }

    fn resume(&mut self) {
        self.open();
        self.accept_on(PERMITTED);
        self.bump(DELIVERABLE, "deliverable");
        self.reconcile();
        if self.opened.is_multiple_of(2) {
            return;
        }
        let blockers = self.assignment_blockers();
        let _ = task::mark_ready(&mut self.task, &self.tree, blockers);
    }

    fn open_again(&mut self) {
        if task::replaceable(Some(&self.task)) {
            self.open();
        }
    }

    fn closed_after_change(&mut self) {
        self.open();
        self.accept_on(PERMITTED);
        self.bump(DELIVERABLE, "deliverable");
        self.reconcile();
        let blockers = self.assignment_blockers();
        task::mark_ready(&mut self.task, &self.tree, blockers).expect("reconciled handback");
        let standing = self.standing().len();
        assert!(task::accept_result(
            &mut self.task,
            &self.tree,
            standing,
            PERMITTED,
            4
        ));
        self.bump(OUTSIDE_SCOPE, "later-concurrent-change");
    }

    fn open(&mut self) {
        self.opened += 1;
        self.address_refused = false;
        let role = ROLES[self.opened % ROLES.len()];
        let opening = opening(role, self.opened);
        self.tree = BTreeMap::from([
            (DELIVERABLE.to_owned(), digest("deliverable-0")),
            (SHARED_INPUT.to_owned(), digest("shared-0")),
            (UNRELATED.to_owned(), digest("unrelated-0")),
        ]);
        self.task = task::record_from(
            opening,
            0,
            self.tree.clone(),
            vec![Some(digest("deliverable-0"))],
        );
        let blocks = blabla::memory::syntax::parse("process.bla", PROCESS_TEXT)
            .expect("process text parses");
        let process = blabla::memory::process::build(&blocks).expect("process builds");
        let permitted = blabla::memory::process::permitted_models(&process, "worker");
        self.resolution = task::resolve(
            &self.task,
            &permitted,
            &lenses_for(role),
            "focused",
            &[("contract::probe".to_owned(), vec![DELIVERABLE.to_owned()])],
        );
    }

    fn accept_on(&mut self, model: &str) {
        if self.task.state == "accepted" || task::apply(&mut self.task, "accepted") {
            self.task.accepted = Some(Acceptance {
                model: model.to_owned(),
                unix: 1,
                changed_at_acceptance: None,
            });
        }
    }

    fn record_evidence(&mut self, check: &str) {
        self.record_result(check, 0);
    }

    fn record_result(&mut self, check: &str, exit: i32) {
        self.task.evidence.push(Evidence {
            check: check.to_owned(),
            exit,
            tree: digest("tree"),
            tool: "cargo".to_owned(),
            unix: 2,
            inputs: task::evidence_inputs(&self.task, &self.tree),
            command: None,
            log: None,
        });
    }

    fn bump(&mut self, path: &str, seed: &str) {
        self.revision += 1;
        let revision = self.revision;
        self.tree
            .insert(path.to_owned(), format!("{seed}-{revision}"));
    }

    fn ensure_declared_evidence(&mut self) {
        if !self
            .task
            .evidence
            .iter()
            .any(|entry| entry.check == DECLARED_CHECK)
        {
            self.record_evidence(DECLARED_CHECK);
        }
    }

    fn reconcile(&mut self) {
        for exception in &mut self.task.exceptions {
            if exception.approval.is_none() {
                exception.approval = Some("owner approved".to_owned());
            }
        }
        let unassessed: Vec<String> = self
            .resolution
            .lenses
            .iter()
            .filter(|lens| {
                !self
                    .task
                    .assessments
                    .iter()
                    .any(|entry| &&entry.ruling == lens)
            })
            .cloned()
            .collect();
        for ruling in unassessed {
            self.task.assessments.push(Assessment {
                ruling,
                statement: "assessed".to_owned(),
                unix: 3,
            });
        }
        let unknown: Vec<String> = self
            .tree
            .keys()
            .filter(|path| task::attribute(&self.task, &self.tree, path) == task::ATTRIBUTIONS[2])
            .cloned()
            .collect();
        for path in unknown {
            let digest = self.tree.get(&path).cloned();
            self.task.attributions.push(Attribution {
                path,
                kind: task::ATTRIBUTIONS[1].to_owned(),
                digest,
                model: None,
            });
        }
        self.record_evidence(DECLARED_CHECK);
        let blockers = self.assignment_blockers();
        task::record_challenge(&mut self.task, &self.tree, blockers, 3);
    }

    pub fn report(&self) -> skeptic::ChallengeReport {
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
            role: Some(&self.resolution),
            other_tasks: &self.other_tasks,
        })
    }

    fn standing(&self) -> Vec<String> {
        self.report()
            .grounded
            .iter()
            .map(|class| (*class).to_owned())
            .collect()
    }

    fn assignment_blockers(&self) -> usize {
        self.standing()
            .iter()
            .filter(|class| !matches!(class.as_str(), "verification-not-current" | "vacuous-rule"))
            .count()
    }

    fn live(&self) -> bool {
        self.task.closed_unix.is_none()
    }

    fn create_concurrent_task_and_close(&mut self) {
        self.revision += 1;
        let revision = self.revision;
        let concurrent_name = format!("concurrent-{}", revision);

        let opened_tree_before_bump = self.tree.clone();
        self.bump(CONCURRENT_PATH, "concurrent");

        let mut concurrent_task = Task {
            name: concurrent_name,
            role: "orchestrator".to_owned(),
            statement: "a concurrent task".to_owned(),
            scope: vec!["other".to_owned()],
            deliverables: vec![task::Deliverable {
                path: CONCURRENT_PATH.to_owned(),
                opened_digest: opened_tree_before_bump.get(CONCURRENT_PATH).cloned(),
            }],
            opened_unix: 1,
            opened_tree: opened_tree_before_bump.clone(),
            state: "closed".to_owned(),
            check: Some(DECLARED_CHECK.to_owned()),
            check_inputs: vec!["other".to_owned()],
            accepted: Some(Acceptance {
                model: PERMITTED.to_owned(),
                unix: 1,
                changed_at_acceptance: None,
            }),
            challenged: Some(task::ChallengeReceipt {
                fingerprint: "concurrent-receipt".to_owned(),
                unix: 3,
            }),
            attributions: vec![Attribution {
                path: CONCURRENT_PATH.to_owned(),
                kind: task::ATTRIBUTIONS[0].to_owned(),
                digest: Some(digest(&format!("concurrent-{}", revision))),
                model: None,
            }],
            ..Default::default()
        };

        let evidence_inputs = task::evidence_inputs(&concurrent_task, &self.tree);

        concurrent_task.evidence = vec![Evidence {
            check: DECLARED_CHECK.to_owned(),
            exit: 0,
            tree: digest("tree"),
            tool: "cargo".to_owned(),
            unix: 2,
            inputs: evidence_inputs,
            command: None,
            log: None,
        }];

        concurrent_task.closed_unix = Some(4);
        if let Some(path_digest) = self.tree.get(CONCURRENT_PATH) {
            concurrent_task
                .closed_paths
                .insert(CONCURRENT_PATH.to_owned(), path_digest.clone());
        }
        self.other_tasks.push(concurrent_task);
    }

    fn change_concurrent_task_path_again(&mut self) {
        if self.other_tasks.is_empty() {
            self.create_concurrent_task_and_close();
        }
        self.bump(CONCURRENT_PATH, "concurrent");
    }

    const RECORDS: [&'static str; 21] = [
        "accept_with_a_permitted_model",
        "accept_with_an_outside_policy_model",
        "propose_an_outside_policy_model",
        "approve_the_proposed_model",
        "record_a_lens_assessment",
        "record_a_finding",
        "mark_ready_for_review",
        "challenge_the_assignment",
        "accept_the_result",
        "record_a_check_result",
        "record_a_failing_check_result",
        "record_a_result_for_a_different_check",
        "reconcile_the_standing_challenges",
        "widen_the_scope_to_cover_the_breach",
        "the_orchestrator_notes_the_task",
        "a_concurrent_task_delivers_and_closes",
        "a_closed_concurrent_tasks_path_changes_again",
        "owe_a_path_changed_since_the_opening",
        "address_a_finding_under_an_approved_exception",
        "address_a_finding_with_an_unapproved_outside_model",
        "note_the_task_while_its_check_runs",
    ];

    pub fn call(&mut self, action: &str) -> bool {
        let records = Assignment::RECORDS.contains(&action);
        if records && !self.live() {
            return true;
        }
        match action {
            "open_a_task" => self.open(),
            "resume_a_task_already_under_way" => self.resume(),
            "resume_a_closed_task_after_a_concurrent_change" => self.closed_after_change(),
            "open_a_task_whose_name_is_already_recorded" => self.open_again(),
            "record_a_finding" => {
                let id = self.task.next_finding_id();
                self.task.findings.push(Finding {
                    id,
                    statement: "a probe finding".to_owned(),
                    addressed: None,
                    resolution: Some(FindingResolution {
                        evidence: "settled inside the task".to_owned(),
                        model: None,
                    }),
                });
            }
            "widen_the_scope_to_cover_the_breach" => {
                if !self.task.scope.iter().any(|allowed| allowed == BREACHED) {
                    self.task.scope.push(BREACHED.to_owned());
                }
            }
            "accept_with_a_permitted_model" => self.accept_on(PERMITTED),
            "accept_with_an_alias_of_a_permitted_model" => self.accept_on(ALIAS),
            "accept_with_an_outside_policy_model" => self.accept_on(OUTSIDE_POLICY),
            "propose_an_outside_policy_model" => self.task.exceptions.push(Exception {
                model: OUTSIDE_POLICY.to_owned(),
                reason: "the work is design heavy".to_owned(),
                approval: None,
            }),
            "approve_the_proposed_model" => {
                for exception in &mut self.task.exceptions {
                    exception.approval = Some("owner approved".to_owned());
                }
            }
            "change_a_deliverable" => self.bump(DELIVERABLE, "deliverable"),
            "record_a_lens_assessment" => {
                let next = self
                    .resolution
                    .lenses
                    .iter()
                    .find(|lens| {
                        !self
                            .task
                            .assessments
                            .iter()
                            .any(|entry| &&entry.ruling == lens)
                    })
                    .cloned();
                self.revision += 1;
                let ruling = next.unwrap_or_else(|| format!("extra-{}", self.revision));
                self.task.assessments.push(Assessment {
                    ruling,
                    statement: "assessed".to_owned(),
                    unix: 3,
                });
            }
            "mark_ready_for_review" => {
                let blockers = self.assignment_blockers();
                let _ = task::mark_ready(&mut self.task, &self.tree, blockers);
            }
            "challenge_the_assignment" => {
                let blockers = self.assignment_blockers();
                task::record_challenge(&mut self.task, &self.tree, blockers, 3);
            }
            "accept_the_result" => {
                let standing = self.standing().len();
                task::accept_result(&mut self.task, &self.tree, standing, PERMITTED, 4);
            }
            "record_a_check_result" => self.record_evidence(DECLARED_CHECK),
            "record_a_failing_check_result" => self.record_result(DECLARED_CHECK, 101),
            "record_a_result_for_a_different_check" => self.record_evidence(OTHER_CHECK),
            "change_the_source_after_a_check" => {
                if self.live() {
                    self.ensure_declared_evidence();
                }
                self.bump(SHARED_INPUT, "shared");
            }
            "an_unrelated_file_changes" => {
                self.bump(UNRELATED, "unrelated");
            }
            "a_concurrent_orchestrator_change_lands" => {
                self.bump(OUTSIDE_SCOPE, "elsewhere");
                if self.live() {
                    self.task.attributions.push(Attribution {
                        path: OUTSIDE_SCOPE.to_owned(),
                        kind: task::ATTRIBUTIONS[1].to_owned(),
                        digest: self.tree.get(OUTSIDE_SCOPE).cloned(),
                        model: None,
                    });
                }
            }
            "a_change_of_unknown_origin_appears" => {
                self.bump(UNKNOWN, "unknown");
            }
            "reconcile_the_standing_challenges" => self.reconcile(),
            "the_worker_writes_outside_its_scope" => {
                self.bump(BREACHED, "worker");
                if self.live() {
                    self.task.attributions.push(Attribution {
                        path: BREACHED.to_owned(),
                        kind: task::ATTRIBUTIONS[0].to_owned(),
                        digest: self.tree.get(BREACHED).cloned(),
                        model: None,
                    });
                }
            }
            "the_orchestrator_notes_the_task" => {
                self.task.notes.push(Note {
                    statement: "orchestrator note".to_owned(),
                    unix: 5,
                });
            }
            "a_concurrent_task_delivers_and_closes" => {
                self.create_concurrent_task_and_close();
            }
            "a_closed_concurrent_tasks_path_changes_again" => {
                self.change_concurrent_task_path_again();
            }
            "owe_a_path_changed_since_the_opening" => {
                self.bump(SHARED_INPUT, "later");
                self.late_deliverable_reads_unchanged =
                    Some(self.owe_a_path_changed_since_the_opening(SHARED_INPUT));
            }
            "address_a_finding_under_an_approved_exception" => {
                self.accept_on(OUTSIDE_POLICY);
                for exception in &mut self.task.exceptions {
                    exception.approval = Some("owner approved".to_owned());
                }
                self.address_a_finding(OUTSIDE_POLICY, 6);
            }
            "address_a_finding_with_an_unapproved_outside_model" => {
                self.accept_on(UNAPPROVED_MODEL);
                self.address_a_finding(UNAPPROVED_MODEL, 7);
            }
            "note_the_task_while_its_check_runs" => {
                let copy = self.task.clone();
                self.task.notes.push(Note {
                    statement: "note added during check".to_owned(),
                    unix: 8,
                });
                task::apply_evidence(
                    &mut self.task,
                    Evidence {
                        check: DECLARED_CHECK.to_owned(),
                        exit: 0,
                        tree: "tree".to_owned(),
                        tool: "test".to_owned(),
                        unix: 9,
                        inputs: task::evidence_inputs(&copy, &self.tree),
                        command: None,
                        log: None,
                    },
                );
            }
            _ => return false,
        }
        true
    }

    fn address_a_finding(&mut self, model: &str, unix: u64) {
        if self.task.findings.is_empty() {
            let id = self.task.next_finding_id();
            self.task.findings.push(Finding {
                id,
                statement: "finding to address".to_owned(),
                addressed: None,
                resolution: None,
            });
        }
        let allowed = task::can_address_finding(&self.task, model, &self.resolution.models);
        self.address_refused = !allowed;
        if !allowed {
            return;
        }
        if let Some(finding) = self.task.findings.first_mut() {
            finding.addressed = Some(task::Addressed {
                model: model.to_owned(),
                statement: format!("addressed by {model}"),
                unix,
            });
        }
        self.task.challenged = None;
    }

    pub fn owe_a_path_changed_since_the_opening(&mut self, path: &str) -> bool {
        task::owe_path(&mut self.task, path.to_owned());
        let deliverable = self.task.deliverables.iter().find(|d| d.path == path);
        match deliverable {
            None => true,
            Some(d) => d.opened_digest == task::observed_digest(&self.tree, path),
        }
    }

    pub fn observe(&self) -> Value {
        let readiness = task::readiness(&self.task, &self.tree);
        let standing: Vec<Value> = self
            .standing()
            .into_iter()
            .map(|class| json!({ "class": class }))
            .collect();
        json!({
            "phase": self.task.state,
            "role": self.task.role,
            "lenses": self.resolution.lenses.iter().map(|id| json!({ "id": id })).collect::<Vec<Value>>(),
            "assessed": self.task.assessments.iter().map(|entry| json!({ "id": entry.ruling })).collect::<Vec<Value>>(),
            "standing": standing,
            "assignment_accepted": self.task.accepted.is_some(),
            "result_accepted": self.task.result.is_some(),
            "evidence_recorded": readiness.recorded,
            "evidence_current": readiness.current,
            "evidence_answers_the_declared_check": readiness.answers_declared_check,
            "readiness_supported": readiness.supported,
            "challenge_current": task::challenge_current(&self.task, &self.tree),
            "exception_approved": self.task.exceptions.iter().any(|entry| entry.approval.is_some()),
            "breach_in_scope": self.task.in_scope(BREACHED),
            "deliverables": self.task.deliverables.len(),
            "findings": self.task.findings.len(),
            "closed": !self.live(),
            "late_deliverable_reads_unchanged": self.late_deliverable_reads_unchanged.unwrap_or(false),
            "address_refused": self.address_refused,
            "notes": self.task.notes.len(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resumed_work_exercises_both_guarded_handback_and_result_acceptance() {
        let mut assignment = Assignment::new();
        assignment.call("resume_a_task_already_under_way");
        assert_eq!(assignment.observe()["phase"], "accepted");
        assignment.call("mark_ready_for_review");
        assert_eq!(assignment.observe()["phase"], "ready");
        assignment.call("accept_the_result");
        assert_eq!(assignment.observe()["closed"], true);
        assignment.call("resume_a_task_already_under_way");
        assert_eq!(assignment.observe()["phase"], "ready");
        assignment.call("change_the_source_after_a_check");
        assignment.call("accept_the_result");
        assert_eq!(assignment.observe()["closed"], false);
    }

    #[test]
    fn closed_history_reports_later_changes_without_absorbing_a_scope_breach() {
        let mut assignment = Assignment::new();
        assignment.call("resume_a_closed_task_after_a_concurrent_change");
        let observed = assignment.observe();
        assert_eq!(observed["closed"], true);
        assert_eq!(observed["result_accepted"], true);
        let standing = observed["standing"].as_array().unwrap();
        assert!(
            standing
                .iter()
                .any(|item| item["class"] == "attribution-unknown")
        );
        assert!(!standing.iter().any(|item| item["class"] == "scope-breach"));
    }

    #[test]
    fn a_closed_task_takes_no_address_and_no_note() {
        let mut assignment = Assignment::new();
        assignment.call("resume_a_closed_task_after_a_concurrent_change");
        assert_eq!(assignment.observe()["closed"], true);
        let before = serde_json::to_value(&assignment.task).unwrap();
        for action in [
            "address_a_finding_under_an_approved_exception",
            "address_a_finding_with_an_unapproved_outside_model",
            "note_the_task_while_its_check_runs",
        ] {
            assert!(assignment.call(action));
            assert_eq!(serde_json::to_value(&assignment.task).unwrap(), before);
        }
    }

    #[test]
    fn an_approved_model_the_task_was_not_accepted_on_is_refused() {
        let mut assignment = Assignment::new();
        assignment.call("accept_with_a_permitted_model");
        assignment.call("propose_an_outside_policy_model");
        assignment.call("approve_the_proposed_model");
        assignment.address_a_finding(OUTSIDE_POLICY, 6);
        assert_eq!(assignment.observe()["exception_approved"], true);
        assert_eq!(assignment.observe()["address_refused"], true);
        assert!(assignment.task.findings[0].addressed.is_none());
        assignment.call("address_a_finding_under_an_approved_exception");
        assert_eq!(assignment.observe()["address_refused"], false);
        assert!(assignment.task.findings[0].addressed.is_some());
    }

    #[test]
    fn a_refused_address_leaves_the_finding_standing() {
        let mut assignment = Assignment::new();
        assignment.call("accept_with_a_permitted_model");
        assignment.call("address_a_finding_with_an_unapproved_outside_model");
        let observed = assignment.observe();
        assert_eq!(observed["address_refused"], true);
        assert!(assignment.task.findings[0].addressed.is_none());
        assert!(
            observed["standing"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["class"] == "unresolved-finding")
        );
    }
}
