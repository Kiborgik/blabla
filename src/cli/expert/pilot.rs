use super::*;
use blabla::expert::pilot::{self, PermitRequest, PermitResult};
use clap::Subcommand;
#[derive(Subcommand)]
pub(in crate::cli) enum Action {
    Issue {
        #[arg(long)]
        request: PathBuf,
    },
    Show {
        #[arg(long)]
        run: String,
    },
    Revoke {
        #[arg(long)]
        request: PathBuf,
    },
}
pub(super) fn run(project: &Project, action: Action, json: bool) -> i32 {
    let store = match TraceStore::new(&project.manifest.root, TraceLimits::default()) {
        Ok(s) => s,
        Err(e) => return super::fail(e, json),
    };
    let result = match action {
        Action::Show { run } => {
            return match pilot::show(&store, &run) {
                Ok(view) => emit(&view, json),
                Err(e) => fail(e, json),
            };
        }
        Action::Issue { request } => match super::native::read_request::<PermitRequest>(&request) {
            Ok(PermitRequest::Issue {
                schema_version: 1,
                spec,
                approval,
            }) => pilot::issue(&store, project, *spec, approval),
            Ok(_) => Err(pilot::Error::InvalidInput),
            Err(e) => Err(e),
        },
        Action::Revoke { request } => {
            match super::native::read_request::<PermitRequest>(&request) {
                Ok(PermitRequest::Revoke {
                    schema_version: 1,
                    authority,
                    reason,
                    approval,
                }) => pilot::revoke(&store, project, authority, reason, approval),
                Ok(_) => Err(pilot::Error::InvalidInput),
                Err(e) => Err(e),
            }
        }
    };
    match result {
        Ok(result @ PermitResult::Refused { code }) => {
            super::native::emit_refusal(&result, code, json)
        }
        Ok(result) => emit(&result, json),
        Err(e) => fail(e, json),
    }
}
fn fail(error: pilot::Error, json: bool) -> i32 {
    match error {
        pilot::Error::Refused(code) => {
            super::native::emit_refusal(&PermitResult::Refused { code }, code, json)
        }
        other => super::native::fail(other, json),
    }
}
