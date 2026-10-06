use super::{Clock, Error, Refusal, require};
use crate::expert::ExpertLimits;
use crate::expert::calibration::{self, EvidenceRef};
use crate::expert::native::{Child, NativeCapability};
use crate::expert::provider::ProviderIdentity;
use crate::project::task::revision::RelevantRevision;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AuthorityRef {
    Experimental {
        run_id: String,
        permit_id: String,
        permit_sha256: String,
    },
}
impl AuthorityRef {
    pub fn run_id(&self) -> &str {
        match self {
            Self::Experimental { run_id, .. } => run_id,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskScope {
    pub task: String,
    pub acceptance_epoch: u64,
    pub child: Child,
    pub initial_assignment_revision: RelevantRevision,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BindingScope {
    pub binding_id: String,
    pub question_fingerprint: String,
    pub template_fingerprint: String,
    pub policy_fingerprint: String,
    pub calibration_fingerprint: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Budgets {
    pub provider_attempts: u64,
    pub evaluated_questions: u64,
    pub delivery_attempts: u64,
    pub max_wall_ms: u64,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Spent {
    pub provider_attempts: u64,
    pub evaluated_questions: u64,
    pub delivery_attempts: u64,
}
impl Spent {
    pub fn charge(
        &mut self,
        limits: &Budgets,
        attempts: u64,
        questions: u64,
        deliveries: u64,
    ) -> Result<(), Refusal> {
        let next = Self {
            provider_attempts: self
                .provider_attempts
                .checked_add(attempts)
                .ok_or(Refusal::BudgetExhausted)?,
            evaluated_questions: self
                .evaluated_questions
                .checked_add(questions)
                .ok_or(Refusal::BudgetExhausted)?,
            delivery_attempts: self
                .delivery_attempts
                .checked_add(deliveries)
                .ok_or(Refusal::BudgetExhausted)?,
        };
        if next.provider_attempts > limits.provider_attempts
            || next.evaluated_questions > limits.evaluated_questions
            || next.delivery_attempts > limits.delivery_attempts
        {
            return Err(Refusal::BudgetExhausted);
        }
        *self = next;
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Pilot,
    Expanded,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PermitSpec {
    pub kind: String,
    pub schema_version: u64,
    pub permit_id: String,
    pub run_id: String,
    pub experiment_id: String,
    pub arm: String,
    pub phase: Phase,
    pub promotion_eligible: bool,
    pub protocol: EvidenceRef,
    pub native_plan: EvidenceRef,
    pub frozen_snapshot_sha256: String,
    pub tasks: Vec<TaskScope>,
    pub coordinator: Child,
    pub capability: NativeCapability,
    pub provider: ProviderIdentity,
    pub provider_argv_sha256: String,
    pub runtime_config_sha256: String,
    pub bindings: Vec<BindingScope>,
    pub implementation_fingerprints: BTreeMap<String, String>,
    pub development_manifest_sha256: String,
    pub holdout_manifest_sha256: String,
    pub real_calibration: EvidenceRef,
    pub limits: ExpertLimits,
    pub budgets: Budgets,
    pub not_before_unix_ms: u64,
    pub expires_unix_ms: u64,
    pub stop_on: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Approval {
    pub owner_instruction: EvidenceRef,
    pub issuer_task: String,
    pub issuer_model: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PermitRequest {
    Issue {
        schema_version: u64,
        spec: Box<PermitSpec>,
        approval: Approval,
    },
    Revoke {
        schema_version: u64,
        authority: AuthorityRef,
        reason: String,
        approval: Approval,
    },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IssuedPermit {
    pub spec: PermitSpec,
    pub approval: Approval,
    pub issued: Clock,
    pub permit_sha256: String,
}
impl IssuedPermit {
    pub fn authority(&self) -> AuthorityRef {
        AuthorityRef::Experimental {
            run_id: self.spec.run_id.clone(),
            permit_id: self.spec.permit_id.clone(),
            permit_sha256: self.permit_sha256.clone(),
        }
    }
    pub fn verify_hash(&self) -> Result<(), Error> {
        require(
            self.permit_sha256
                == calibration::canonical_sha256(
                    &serde_json::json!({"spec":self.spec,"approval":self.approval,"issued":self.issued}),
                )?,
            Refusal::PermitMismatch,
        )
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PermitState {
    Active,
    Revoked { recorded: Clock, reason: String },
    Stopped { code: Refusal },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PermitResult {
    Issued {
        permit: Box<IssuedPermit>,
    },
    Revoked {
        authority: AuthorityRef,
        recorded: Clock,
    },
    Refused {
        code: Refusal,
    },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PermitView {
    pub kind: String,
    pub permit: IssuedPermit,
    pub state: PermitState,
    pub spent: Spent,
    pub last_clock: Clock,
}
