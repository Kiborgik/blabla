use super::*;
use blabla::expert::{
    native as core,
    pilot::{Error, Refusal},
};
use clap::{Args, Subcommand};
use serde::{Serialize, de::DeserializeOwned};
#[derive(Args)]
pub(in crate::cli) struct RequestPath {
    #[arg(long)]
    request: PathBuf,
}
#[derive(Subcommand)]
pub(in crate::cli) enum Action {
    Enroll(RequestPath),
    CaptureBoundary(RequestPath),
    Observe(RequestPath),
    PrepareWake(RequestPath),
    Consume(RequestPath),
    RecordResponse(RequestPath),
    Invalidate(RequestPath),
    StartRun(RequestPath),
    Advance(RequestPath),
    HostNext {
        #[arg(long)]
        run: String,
    },
    HostClaim(RequestPath),
    HostResult(RequestPath),
}
pub(super) fn read_request<T: DeserializeOwned + Serialize>(path: &Path) -> Result<T, Error> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > core::MAX_NATIVE_BYTES as u64
    {
        return Err(Error::InvalidInput);
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(core::MAX_NATIVE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    core::decode(&bytes)
}
pub(super) fn fail(error: Error, json: bool) -> i32 {
    match error {
        Error::Refused(code) => emit_refusal(
            &core::NativeResult::NoAdvice {
                code,
                completion: None,
            },
            code,
            json,
        ),
        Error::InvalidInput => super::fail(TraceError::InvalidInput, json),
        Error::Io => super::fail(TraceError::Io, json),
    }
}
pub(super) fn run(project: &Project, action: Action, json: bool) -> i32 {
    let store = match TraceStore::new(&project.manifest.root, TraceLimits::default()) {
        Ok(s) => s,
        Err(e) => return super::fail(e, json),
    };
    macro_rules! output {
        ($expression:expr) => {
            return match $expression {
                Ok(value) => native_output(&value, json),
                Err(error) => fail(error, json),
            };
        };
    }
    let (expected, path) = match action {
        Action::HostNext { run } => {
            return match core::run::host_next(&store, &run) {
                Ok(value) => emit(&value, json),
                Err(error) => closed_error(error, json),
            };
        }
        Action::HostClaim(path) => {
            let request = match read_request::<core::ClaimRequest>(&path.request) {
                Ok(r) => r,
                Err(e) => return fail(e, json),
            };
            return match core::run::claim(&store, project, &request) {
                Ok(r) => emit(&r, json),
                Err(Error::Refused(code)) => {
                    emit_refusal(&core::ClaimResult::Refused { code }, code, json)
                }
                Err(e) => fail(e, json),
            };
        }
        Action::HostResult(path) => {
            let request = match read_request::<core::HostResult>(&path.request) {
                Ok(r) => r,
                Err(e) => return fail(e, json),
            };
            return match core::run::host_result(&store, project, &request) {
                Ok(r) => emit(&r, json),
                Err(Error::Refused(code)) => {
                    emit_refusal(&core::HostRecordResult::Refused { code }, code, json)
                }
                Err(e) => fail(e, json),
            };
        }
        Action::Enroll(p) => ("enroll", p),
        Action::CaptureBoundary(p) => ("capture_boundary", p),
        Action::Observe(p) => ("observe", p),
        Action::PrepareWake(p) => ("prepare_wake", p),
        Action::Consume(p) => ("consume", p),
        Action::RecordResponse(p) => ("record_response", p),
        Action::Invalidate(p) => ("invalidate", p),
        Action::StartRun(p) => ("start_run", p),
        Action::Advance(p) => ("advance", p),
    };
    let request = match read_request::<core::NativeRequest>(&path.request) {
        Ok(r) => r,
        Err(e) => return fail(e, json),
    };
    if serde_json::to_value(&request)
        .ok()
        .and_then(|v| v["kind"].as_str().map(str::to_owned))
        .as_deref()
        != Some(expected)
    {
        return fail(Error::InvalidInput, json);
    }
    match request {
        core::NativeRequest::Enroll { enrollment, .. } => {
            output!(core::run::enroll(&store, project, *enrollment));
        }
        core::NativeRequest::CaptureBoundary {
            work_key,
            child_attestation,
            statements,
            final_boundary,
            ..
        } => {
            output!(core::run::capture_boundary(
                &store,
                project,
                &work_key,
                &child_attestation,
                &statements,
                final_boundary
            ));
        }
        core::NativeRequest::Observe {
            schema_version,
            key,
            boundary_operation_id,
            idle_operation_id,
            config_sha256,
        } => {
            output!(core::run::observe(
                &store,
                project,
                &core::ObserveRequest {
                    schema_version,
                    kind: "observe".into(),
                    key,
                    boundary_operation_id,
                    idle_operation_id,
                    config_sha256
                }
            ));
        }
        core::NativeRequest::PrepareWake {
            checkpoint,
            request_id,
            authority,
            ..
        } => {
            output!(core::run::prepare(
                &store,
                project,
                &checkpoint,
                &request_id,
                &authority
            ));
        }
        core::NativeRequest::Consume {
            wake,
            task,
            acceptance_epoch,
            generation,
            child_attestation,
            first_action_attestation,
            ..
        } => {
            output!(core::run::consume(
                &store,
                project,
                core::run::ConsumeRequest {
                    wake: &wake,
                    task: &task,
                    acceptance_epoch,
                    generation,
                    child_attestation: &child_attestation,
                    first_action_attestation,
                }
            ));
        }
        core::NativeRequest::RecordResponse {
            checkpoint,
            request_id,
            evidence,
            ..
        } => {
            output!(core::run::record_response(
                &store,
                project,
                &checkpoint,
                &request_id,
                &evidence
            ));
        }
        core::NativeRequest::Invalidate {
            key,
            reason,
            evidence,
            coordinator,
            ..
        } => {
            output!(core::run::invalidate(
                &store,
                &key,
                reason,
                &evidence,
                &coordinator
            ));
        }
        core::NativeRequest::StartRun {
            run_id,
            native_plan,
            protocol,
            ..
        } => advance_output(
            core::run::start(&store, project, &run_id, &native_plan, &protocol),
            &run_id,
            json,
        ),
        core::NativeRequest::Advance {
            run_id,
            native_plan_sha256,
            coordinator,
            ..
        } => advance_output(
            core::run::advance(&store, project, &run_id, &native_plan_sha256, &coordinator),
            &run_id,
            json,
        ),
    }
}

fn refusal_exit(code: Refusal) -> i32 {
    match code {
        Refusal::StorageMissing
        | Refusal::StorageCorrupt
        | Refusal::ClockUncertain
        | Refusal::UncertainDelivery => 4,
        Refusal::InvalidInput => 2,
        _ => 0,
    }
}
pub(super) fn emit_refusal(value: &impl Serialize, code: Refusal, json: bool) -> i32 {
    emit(value, json).max(refusal_exit(code))
}
fn native_output(value: &core::NativeResult, json: bool) -> i32 {
    match value {
        core::NativeResult::NoAdvice { code, .. } => emit_refusal(value, *code, json),
        _ => emit(value, json),
    }
}
fn closed_error(error_value: Error, json: bool) -> i32 {
    match error_value {
        Error::Refused(code) => emit_error(
            error("expert", format!("{code:?}"), None),
            json,
            refusal_exit(code).max(2),
        ),
        other => fail(other, json),
    }
}
fn advance_output(result: Result<core::AdvanceResult, Error>, run_id: &str, json: bool) -> i32 {
    match result {
        Ok(value @ core::AdvanceResult::ArmStopped { code, .. }) => {
            emit_refusal(&value, code, json)
        }
        Ok(value) => emit(&value, json),
        Err(Error::Refused(code))
            if refusal_exit(code) == 0 && code != Refusal::IdentityMismatch =>
        {
            emit(
                &core::AdvanceResult::ArmStopped {
                    run_id: run_id.into(),
                    code,
                },
                json,
            )
        }
        Err(error) => closed_error(error, json),
    }
}
