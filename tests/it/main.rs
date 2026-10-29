#[path = "../../bridge/bounded_results.rs"]
mod bounded_results;
#[path = "../../bridge/component.rs"]
mod component;
#[path = "support/interpreter.rs"]
mod interpreter;
#[path = "support/process.rs"]
mod process;
#[path = "support/python_script.rs"]
mod python_script;
mod source_cli {
    include!("../../bridge/source_cli.rs");

    mod testing;

    pub(crate) use testing::{
        artifact_identity, diagnostic_publication, owned_artifact, provenance_builds,
    };
}
#[path = "support/cli.rs"]
mod support;
#[path = "../../bridge/task_machine.rs"]
mod task_machine;
#[path = "../../bridge/task_roles.rs"]
mod task_roles;

mod acceptance;
mod attestation;
mod bounded_result_bridge;
mod bounded_result_closure;
mod cli;
mod cli_output;
mod compiler;
mod compiler_values;
mod coverage;
mod decisions;
mod expert_calibration;
mod expert_calibration_cli;
mod expert_cli;
mod expert_memory;
mod expert_native;
mod expert_packet;
mod expert_pilot;
mod expert_policy;
mod expert_provider;
mod expert_task_goal;
mod falsify;
mod glyph;
mod goal_coverage;
mod goals;
mod knowledge;
mod layers;
mod leases;
mod lifecycle;
mod navigation;
mod onboarding;
mod project;
mod project_input_drift;
mod project_inventory;
mod questions;
mod review_evidence_reuse;
mod runtime;
mod runtime_command_diagnostics;
mod skeptic;
mod source_cli_transport;
mod structure;
mod system;
mod task_acceptance_model_guidance;
mod task_amendments;
mod task_budget;
mod task_check_bindings;
mod task_claims;
mod task_compact_receipts;
mod task_evidence_exit;
mod task_evidence_progress;
mod task_freshness;
mod task_lifecycle;
mod task_machine_bridge;
mod task_recovery_guidance;
mod task_role_bridge;
mod task_role_resolution;
mod task_tracking;
mod task_workflow;
mod values;
mod verifier;

const UNMEASURED_ALLOWANCE: std::time::Duration = std::time::Duration::from_secs(30);
