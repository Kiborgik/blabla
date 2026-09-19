use blabla::application::{AppConfig, Application};
use blabla::report::{Call, RunOptions, RunStatus};
use blabla::runtime::AppSession;
use blabla::semantics::compile;
use blabla::verify::run;
use serde_json::json;
use std::path::Path;
use std::time::Duration;

fn config() -> AppConfig {
    AppConfig {
        executable: "python".into(),
        args: vec![
            Path::new("examples/leases/app.py")
                .canonicalize()
                .unwrap()
                .into_os_string(),
        ],
        timeout: Duration::from_secs(1),
        startup: Duration::from_secs(1),
    }
}

#[test]
fn preserves_all_three_recorded_semantic_regressions_and_persists_them() {
    let contract = compile("leases.bla", include_str!("../examples/leases.bla")).unwrap();
    let mut app = AppSession::spawn(&config()).unwrap();
    for (calls, expected) in [
        (
            vec![
                ("claim", vec![json!("é"), json!("n"), json!(6)]),
                ("tick", vec![json!(6)]),
            ],
            json!([]),
        ),
        (
            vec![
                ("claim", vec![json!("cak"), json!(" "), json!(1)]),
                ("release", vec![json!("cak"), json!("")]),
            ],
            json!([{"resource":"cak","holder":" ","ticks":1}]),
        ),
        (
            vec![
                ("claim", vec![json!("é"), json!("d"), json!(1)]),
                ("renew", vec![json!("é"), json!("d"), json!(1)]),
            ],
            json!([{"resource":"é","holder":"d","ticks":1}]),
        ),
    ] {
        app.reset().unwrap();
        for (action, args) in calls {
            app.call(&Call {
                action: action.into(),
                args,
            })
            .unwrap();
        }
        assert_eq!(app.observe(&contract.state).unwrap()["leases"], expected);
        app.restart().unwrap();
        assert_eq!(app.observe(&contract.state).unwrap()["leases"], expected);
    }
    app.finish().unwrap();
}

#[test]
fn lease_campaign_checks_generated_action_combinations() {
    let contract = compile("leases.bla", include_str!("../examples/leases.bla")).unwrap();
    let options = RunOptions {
        seed: 1234,
        cases: 1,
        steps: 64,
        shrink_budget: 64,
    };
    let report = run(&contract, &options, || AppSession::spawn(&config())).unwrap();
    assert_eq!(
        report.status,
        RunStatus::Green,
        "{:?}",
        report
            .coverage_summary
            .coverage
            .iter()
            .filter(|p| p.witnesses == 0)
            .map(|p| (&p.id, &p.required_witness))
            .collect::<Vec<_>>()
    );
    for name in ["claim", "renew", "release", "tick", "restart"] {
        assert!(report.sequences[0].iter().any(|call| call.action == name));
    }
}
