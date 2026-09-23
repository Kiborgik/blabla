use super::ignore::Ignore;
use super::status::{
    CompletionState, Record, State, evaluate, explain_view, format_unix, primitive_view,
    status_view,
};
use super::{
    Lookup, Profile, discover, fingerprint, load, locate, parse_manifest, read_manifest,
    resolve_command,
};
use crate::diagnostic::Span;
use crate::ir::ActionKind;
use serde_json::json;
use std::path::Path;
use tempfile::TempDir;

const PROFILE_MANIFEST: &str = "project Demo\nuse behavior \"core.bla\"\n\nverify behavior {\n    command [\"python\", \"app.py\"]\n    seed 7\n    cases 1\n    steps 8\n    timeout_ms 1000\n    shrink_budget 256\n}\n";

const CORE: &str = r#"
type Item {
    id: int,
    text: string
}

state items: [Item]

action add(text: string)
action restart()

when add {
    expect "add-count": input.text == "" or count(after.items) == count(before.items) + 1
}
"#;

const FEATURE: &str = r#"
when add {
    expect "add-keeps-existing": all(before.items, old => any(after.items, item => item == old))
}

when restart {
    expect "persistence": after.items == before.items
}

always "unique-ids" { unique(items, item => item.id) }
"#;

fn write(root: &Path, relative: &str, text: &str) {
    let path = root.join(relative);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, text).unwrap();
}

fn project(root: &Path, manifest: &str, files: &[(&str, &str)]) -> super::Project {
    write(root, "project.bla", manifest);
    for (relative, text) in files {
        write(root, relative, text);
    }
    load(read_manifest(&root.join("project.bla")).unwrap()).unwrap()
}

fn project_error(
    root: &Path,
    manifest: &str,
    files: &[(&str, &str)],
) -> crate::diagnostic::Diagnostic {
    write(root, "project.bla", manifest);
    for (relative, text) in files {
        write(root, relative, text);
    }
    match read_manifest(&root.join("project.bla")).and_then(load) {
        Ok(_) => panic!("expected a project error"),
        Err(diagnostic) => diagnostic,
    }
}

#[test]
fn manifest_parses_name_layers_drafts_and_aliases() {
    let manifest = parse_manifest(
        Path::new("/work/project.bla"),
        "project Glyph\nuse behavior \"contracts/core.bla\"\ndraft behavior \"contracts/next.bla\" as upcoming\n",
    )
    .unwrap();
    assert_eq!(manifest.name, "Glyph");
    assert_eq!(manifest.entries.len(), 2);
    assert_eq!(manifest.entries[0].group, "core");
    assert!(!manifest.entries[0].draft);
    assert_eq!(
        manifest.entries[0].path,
        Path::new("/work").join("contracts/core.bla")
    );
    assert_eq!(manifest.entries[1].group, "upcoming");
    assert!(manifest.entries[1].draft);
    assert_eq!(manifest.entries[1].span.line, 3);
}

#[test]
fn manifest_rejects_missing_header_unsupported_layers_and_bad_statements() {
    let path = Path::new("project.bla");
    let header = parse_manifest(path, "use behavior \"a.bla\"").unwrap_err();
    assert_eq!(header.code, "E_PROJECT_HEADER");
    let unnamed = parse_manifest(path, "project").unwrap_err();
    assert_eq!(unnamed.code, "E_PROJECT_HEADER");
    let layer = parse_manifest(path, "project X\nuse mission \"m.bla\"").unwrap_err();
    assert_eq!(layer.code, "E_UNSUPPORTED_LAYER");
    assert_eq!(layer.location.line, 2);
    let statement = parse_manifest(path, "project X\nbehavior \"a.bla\"").unwrap_err();
    assert_eq!(statement.code, "E_MANIFEST_STATEMENT");
    let unquoted = parse_manifest(path, "project X\nuse behavior core").unwrap_err();
    assert_eq!(unquoted.code, "E_MANIFEST_STATEMENT");
    let alias = parse_manifest(path, "project X\nuse behavior \"a.bla\" as").unwrap_err();
    assert_eq!(alias.code, "E_MANIFEST_STATEMENT");
}

#[test]
fn ignore_declarations_parse_and_a_duplicate_bare_or_missing_one_is_refused() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("project.bla");
    let parsed = parse_manifest(
        &path,
        "project X\nignore \"dist/\"\nignore from \".gitignore\"\nignore \".gitignore\"\n",
    )
    .unwrap();
    assert_eq!(parsed.ignores.len(), 3);
    assert!(parsed.ignores[1].is_list());
    assert!(!parsed.ignores[2].is_list());
    let twice =
        parse_manifest(&path, "project X\nignore \"dist/\"\nignore \"dist/\"\n").unwrap_err();
    assert_eq!(twice.code, "E_DUPLICATE_IGNORE");
    assert_eq!(twice.location.line, 3);
    let bare = parse_manifest(&path, "project X\nignore from\n").unwrap_err();
    assert_eq!(bare.code, "E_MANIFEST_IGNORE");
    let missing = load(parsed).unwrap_err();
    assert_eq!(missing.code, "E_IGNORE_LIST_MISSING");
    assert_eq!(missing.location.line, 3);
}

#[test]
fn manifest_rejects_duplicate_paths_and_duplicate_groups() {
    let path = Path::new("project.bla");
    let twice = parse_manifest(
        path,
        "project X\nuse behavior \"a.bla\"\ndraft behavior \"./a.bla\"",
    )
    .unwrap_err();
    assert_eq!(twice.code, "E_DUPLICATE_USE");
    assert_eq!(twice.location.line, 3);
    let groups = parse_manifest(
        path,
        "project X\nuse behavior \"a/core.bla\"\nuse behavior \"b/core.bla\"",
    )
    .unwrap_err();
    assert_eq!(groups.code, "E_DUPLICATE_GROUP");
    let aliased = parse_manifest(
        path,
        "project X\nuse behavior \"a/core.bla\"\nuse behavior \"b/core.bla\" as other",
    )
    .unwrap();
    assert_eq!(aliased.entries[1].group, "other");
}

#[test]
fn discovery_returns_the_nearest_manifest_and_locate_reports_missing_projects() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "project.bla", "project Root");
    write(root, "apps/server/project.bla", "project Server");
    std::fs::create_dir_all(root.join("apps/server/src/domain")).unwrap();
    std::fs::create_dir_all(root.join("apps/web")).unwrap();
    assert_eq!(
        discover(&root.join("apps/server/src/domain")).unwrap(),
        root.join("apps/server/project.bla")
    );
    assert_eq!(
        discover(&root.join("apps/web")).unwrap(),
        root.join("project.bla")
    );
    assert_eq!(discover(root).unwrap(), root.join("project.bla"));
    let empty = TempDir::new().unwrap();
    assert!(discover(empty.path()).is_none());
    let missing = locate(None, empty.path()).unwrap_err();
    assert_eq!(missing.code, "E_NO_PROJECT");
    assert!(
        missing.message.contains("blabla init"),
        "{}",
        missing.message
    );
    assert_eq!(
        locate(Some(Path::new("apps/server")), root).unwrap(),
        root.join("apps/server/project.bla")
    );
    assert_eq!(
        locate(Some(&root.join("project.bla")), empty.path()).unwrap(),
        root.join("project.bla")
    );
    assert_eq!(
        locate(Some(Path::new("apps/web")), root).unwrap_err().code,
        "E_NO_PROJECT"
    );
    assert_eq!(
        locate(Some(Path::new("nowhere.bla")), root)
            .unwrap_err()
            .code,
        "E_NO_PROJECT"
    );
}

#[test]
fn load_shares_declarations_across_files_and_qualifies_rule_ids() {
    let temp = TempDir::new().unwrap();
    let project = project(
        temp.path(),
        "project Demo\nuse behavior \"contracts/core.bla\"\nuse behavior \"contracts/feature.bla\"\n",
        &[
            ("contracts/core.bla", CORE),
            ("contracts/feature.bla", FEATURE),
        ],
    );
    let contract = project.contract.as_ref().unwrap();
    assert_eq!(contract.state.len(), 1);
    assert_eq!(contract.actions.len(), 2);
    let add = &contract.actions[0];
    assert_eq!(add.name, "add");
    assert_eq!(add.kind, ActionKind::Application);
    let labels: Vec<&str> = add
        .postconditions
        .iter()
        .map(|predicate| predicate.label.as_str())
        .collect();
    assert_eq!(labels, ["core::add-count", "feature::add-keeps-existing"]);
    assert_eq!(
        contract.actions[1].postconditions[0].label,
        "feature::persistence"
    );
    assert_eq!(contract.invariants[0].label, "feature::unique-ids");
    let ids: Vec<&str> = project.rules.iter().map(|rule| rule.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "core::add-count",
            "feature::add-keeps-existing",
            "feature::persistence",
            "feature::unique-ids"
        ]
    );
    let persistence = &project.rules[2];
    assert_eq!(persistence.group, "feature");
    assert_eq!(persistence.label, "persistence");
    assert_eq!(persistence.file, "contracts/feature.bla");
    assert_eq!(persistence.line, 7);
    assert_eq!(persistence.action.as_deref(), Some("restart"));
    assert_eq!(persistence.source, "after.items == before.items");
    assert_eq!(project.groups.len(), 2);
    assert_eq!(project.groups[0].rules, 1);
    assert_eq!(project.groups[1].rules, 3);
    assert!(project.drafts.is_empty());
}

#[test]
fn load_reports_incompatible_declarations_naming_every_file() {
    let temp = TempDir::new().unwrap();
    let manifest =
        "project Demo\nuse behavior \"a.bla\"\nuse behavior \"b.bla\"\nuse behavior \"c.bla\"\n";
    let state = project_error(
        temp.path(),
        manifest,
        &[
            (
                "a.bla",
                "state count: int\naction tick()\nwhen tick { expect \"a\": after.count >= 0 }",
            ),
            ("b.bla", "state count: int"),
            ("c.bla", "state count: string"),
        ],
    );
    assert_eq!(state.code, "E_INCOMPATIBLE_STATE");
    assert_eq!(state.location.file, "c.bla");
    assert!(
        state.message.contains("a.bla, b.bla, c.bla"),
        "{}",
        state.message
    );

    let temp = TempDir::new().unwrap();
    let ty = project_error(
        temp.path(),
        manifest,
        &[
            (
                "a.bla",
                "type Item { id: int }\nstate items: [Item]\naction tick()\nwhen tick { expect \"a\": count(after.items) >= 0 }",
            ),
            ("b.bla", "type Item { id: int }"),
            ("c.bla", "type Item { id: int, text: string }"),
        ],
    );
    assert_eq!(ty.code, "E_INCOMPATIBLE_TYPE");
    assert_eq!(ty.location.file, "c.bla");
    assert!(ty.message.contains("a.bla, b.bla, c.bla"), "{}", ty.message);

    let temp = TempDir::new().unwrap();
    let action = project_error(
        temp.path(),
        manifest,
        &[
            (
                "a.bla",
                "state count: int\naction tick(step: int)\nwhen tick { expect \"a\": after.count >= 0 }",
            ),
            ("b.bla", "action tick(step: int)"),
            ("c.bla", "action tick(step: string)"),
        ],
    );
    assert_eq!(action.code, "E_INCOMPATIBLE_ACTION");
    assert_eq!(action.location.file, "c.bla");
    assert!(
        action.message.contains("a.bla, b.bla, c.bla"),
        "{}",
        action.message
    );
}

#[test]
fn load_keeps_same_file_duplicates_as_errors_and_allows_labels_per_group() {
    let temp = TempDir::new().unwrap();
    let duplicate = project_error(
        temp.path(),
        "project Demo\nuse behavior \"a.bla\"\n",
        &[(
            "a.bla",
            "state count: int\nstate count: int\naction tick()\nwhen tick { expect \"a\": after.count >= 0 }",
        )],
    );
    assert_eq!(duplicate.code, "E_DUPLICATE_STATE");

    let temp = TempDir::new().unwrap();
    let label = project_error(
        temp.path(),
        "project Demo\nuse behavior \"a.bla\"\nuse behavior \"b.bla\"\n",
        &[
            (
                "a.bla",
                "state count: int\naction tick()\nwhen tick { expect \"same\": after.count >= 0 }",
            ),
            (
                "b.bla",
                "when tick { expect \"same\": after.count >= 0 }\nalways \"same\" { count >= 0 }",
            ),
        ],
    );
    assert_eq!(label.code, "E_DUPLICATE_LABEL");
    assert_eq!(label.location.file, "b.bla");

    let temp = TempDir::new().unwrap();
    let shared = project(
        temp.path(),
        "project Demo\nuse behavior \"a.bla\"\nuse behavior \"b.bla\"\n",
        &[
            (
                "a.bla",
                "state count: int\naction tick()\nwhen tick { expect \"same\": after.count >= 0 }",
            ),
            ("b.bla", "when tick { expect \"same\": after.count >= 0 }"),
        ],
    );
    let ids: Vec<&str> = shared.rules.iter().map(|rule| rule.id.as_str()).collect();
    assert_eq!(ids, ["a::same", "b::same"]);
    assert!(
        matches!(shared.lookup("same"), Err(diagnostic) if diagnostic.code == "E_AMBIGUOUS_RULE")
    );
}

#[test]
fn load_rejects_missing_contracts_and_manifests_used_as_contracts() {
    let temp = TempDir::new().unwrap();
    let missing = project_error(
        temp.path(),
        "project Demo\nuse behavior \"contracts/none.bla\"\n",
        &[],
    );
    assert_eq!(missing.code, "E_MISSING_CONTRACT");
    assert_eq!(missing.location.line, 2);
    assert!(
        missing.message.contains("contracts/none.bla"),
        "{}",
        missing.message
    );

    let temp = TempDir::new().unwrap();
    let recursive = project_error(
        temp.path(),
        "project Demo\nuse behavior \"project.bla\"\n",
        &[],
    );
    assert_eq!(recursive.code, "E_MANIFEST_AS_CONTRACT");

    let temp = TempDir::new().unwrap();
    let nested = project_error(
        temp.path(),
        "project Demo\nuse behavior \"child/project.bla\"\n",
        &[(
            "child/project.bla",
            "project Child\nuse behavior \"../project.bla\"\n",
        )],
    );
    assert_eq!(nested.code, "E_MANIFEST_AS_CONTRACT");
}

#[test]
fn load_checks_drafts_against_the_active_set_without_composing_them() {
    let temp = TempDir::new().unwrap();
    let project = project(
        temp.path(),
        "project Demo\nuse behavior \"core.bla\"\ndraft behavior \"good.bla\"\ndraft behavior \"bad.bla\"\n",
        &[
            ("core.bla", CORE),
            (
                "good.bla",
                "when restart { expect \"kept\": after.items == before.items }",
            ),
            ("bad.bla", "state items: [string]"),
        ],
    );
    assert_eq!(project.rules.len(), 1);
    assert_eq!(project.groups.len(), 1);
    assert_eq!(project.drafts.len(), 2);
    assert!(project.drafts[0].check.is_ok());
    let failure = project.drafts[1].check.as_ref().unwrap_err();
    assert_eq!(failure.code, "E_INCOMPATIBLE_STATE");
    assert_eq!(failure.location.file, "bad.bla");

    let temp = TempDir::new().unwrap();
    let drafts_only = super::load(
        read_manifest(&{
            write(
                temp.path(),
                "project.bla",
                "project Demo\ndraft behavior \"core.bla\"\n",
            );
            write(temp.path(), "core.bla", CORE);
            temp.path().join("project.bla")
        })
        .unwrap(),
    )
    .unwrap();
    assert!(drafts_only.contract.is_none());
    assert!(drafts_only.rules.is_empty());
    assert!(drafts_only.drafts[0].check.is_ok());
    let view = status_view(
        &drafts_only,
        &evaluate(&drafts_only, Ok(None)),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.state, State::NoActiveContracts);
    assert_eq!(view.exit, 5);
}

#[test]
fn lookup_resolves_ids_labels_obligations_and_actions() {
    let temp = TempDir::new().unwrap();
    let project = project(
        temp.path(),
        "project Demo\nuse behavior \"contracts/core.bla\"\nuse behavior \"contracts/feature.bla\"\n",
        &[
            ("contracts/core.bla", CORE),
            ("contracts/feature.bla", FEATURE),
        ],
    );
    assert!(
        matches!(project.lookup("core::add-count"), Ok(Lookup::Rule(rule)) if rule.id == "core::add-count")
    );
    assert!(
        matches!(project.lookup("persistence"), Ok(Lookup::Rule(rule)) if rule.id == "feature::persistence")
    );
    assert!(
        matches!(project.lookup("feature::persistence/root.restart..nondefault"), Ok(Lookup::Rule(rule)) if rule.id == "feature::persistence")
    );
    assert!(
        matches!(project.lookup("unique"), Ok(Lookup::Rule(rule)) if rule.id == "feature::unique-ids")
    );
    assert!(
        matches!(project.lookup("action/restart"), Ok(Lookup::Action(name)) if name == "restart")
    );
    assert!(
        matches!(project.lookup("add"), Err(diagnostic) if diagnostic.code == "E_AMBIGUOUS_RULE")
    );
    assert!(
        matches!(project.lookup("nothing"), Err(diagnostic) if diagnostic.code == "E_UNKNOWN_RULE")
    );
    assert!(
        matches!(project.lookup("action/nothing"), Err(diagnostic) if diagnostic.code == "E_UNKNOWN_RULE")
    );
}

#[test]
fn runtime_dependencies_derive_from_the_restart_action_kind_alone() {
    let temp = TempDir::new().unwrap();
    let project = project(
        temp.path(),
        "project Demo\nuse behavior \"contracts/core.bla\"\nuse behavior \"contracts/feature.bla\"\n",
        &[
            ("contracts/core.bla", CORE),
            ("contracts/feature.bla", FEATURE),
        ],
    );
    let restart = project
        .contract
        .as_ref()
        .unwrap()
        .actions
        .iter()
        .find(|action| action.kind == ActionKind::Restart)
        .unwrap();
    assert_eq!(restart.name, "restart");
    for rule in &project.rules {
        let expected = (rule.action.as_deref() == Some("restart")).then_some("runtime::restart");
        assert_eq!(rule.runtime, expected, "{}", rule.id);
    }
    assert_eq!(project.runtime_primitives(), vec!["runtime::restart"]);
    assert_eq!(
        project.rules_using("runtime::restart"),
        vec!["feature::persistence"]
    );
    assert!(project.rules_using("runtime::reset").is_empty());

    let evaluation = evaluate(&project, Ok(None));
    let rule = explain_view(&project, &evaluation, "feature::persistence").unwrap();
    assert_eq!(rule.depends_on, vec!["runtime::restart"]);
    let action = explain_view(&project, &evaluation, "action/restart").unwrap();
    assert_eq!(action.depends_on, vec!["runtime::restart"]);
    for query in ["core::add-count", "action/add", "feature::unique-ids"] {
        assert!(
            explain_view(&project, &evaluation, query)
                .unwrap()
                .depends_on
                .is_empty(),
            "{query}"
        );
    }
    assert_eq!(
        status_view(
            &project,
            &evaluation,
            &crate::structure::StructureReport::none()
        )
        .runtime_primitives,
        vec!["runtime::restart"]
    );

    let primitive = primitive_view(Some(&project), "runtime::restart").unwrap();
    assert_eq!(primitive.id, "runtime::restart");
    assert_eq!(primitive.used_by, vec!["feature::persistence"]);
    assert!(
        primitive_view(None, "runtime::restart")
            .unwrap()
            .used_by
            .is_empty()
    );
    let unknown = primitive_view(Some(&project), "runtime::reset").unwrap_err();
    assert!(unknown.contains("runtime::restart"), "{unknown}");

    let application_only = super::load(
        read_manifest(&temp.path().join("project.bla"))
            .map(|mut manifest| {
                manifest.entries.truncate(1);
                manifest
            })
            .unwrap(),
    )
    .unwrap();
    assert!(application_only.runtime_primitives().is_empty());
}

#[test]
fn identity_follows_contract_text_and_fingerprint_follows_implementation_files() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let files = [("contracts/core.bla", CORE)];
    let manifest = "project Demo\nuse behavior \"contracts/core.bla\"\n";
    let first = project(root, manifest, &files);
    let again = project(root, manifest, &files);
    assert_eq!(first.identity, again.identity);
    let before = fingerprint(root, &[], &[], &Ignore::default());
    assert_eq!(before, fingerprint(root, &[], &[], &Ignore::default()));
    write(root, ".blabla/status.json", "{}");
    write(root, "target/debug/app.exe", "binary");
    assert_eq!(before, fingerprint(root, &[], &[], &Ignore::default()));
    write(root, "app/main.py", "print('v1')");
    let with_app = fingerprint(root, &[], &[], &Ignore::default());
    assert_ne!(before, with_app);
    write(root, "app/main.py", "print('v2')");
    assert_ne!(with_app, fingerprint(root, &[], &[], &Ignore::default()));
    let outside = TempDir::new().unwrap();
    write(outside.path(), "tool.py", "a");
    let extra = vec![outside.path().join("tool.py")];
    let with_extra = fingerprint(root, &extra, &[], &Ignore::default());
    assert_ne!(with_extra, fingerprint(root, &[], &[], &Ignore::default()));
    write(outside.path(), "tool.py", "b");
    assert_ne!(
        with_extra,
        fingerprint(root, &extra, &[], &Ignore::default())
    );
    write(
        root,
        "contracts/core.bla",
        &format!("{CORE}\nalways \"more\" {{ count(items) >= 0 }}\n"),
    );
    let changed = load(read_manifest(&root.join("project.bla")).unwrap()).unwrap();
    assert_ne!(first.identity, changed.identity);
}

fn record(project: &super::Project, report: serde_json::Value, fingerprint_value: &str) -> Record {
    Record {
        verifier_version: env!("CARGO_PKG_VERSION").into(),
        project: project.manifest.name.clone(),
        manifest: project.manifest.path.display().to_string(),
        project_identity: project.identity.clone(),
        implementation_fingerprint: fingerprint_value.into(),
        fingerprinted_files: Vec::new(),
        application: vec!["python".into(), "app.py".into()],
        timeout_ms: 1000,
        profile: project.manifest.profile.clone(),
        run_id: None,
        structure: None,
        recorded_unix: 951_782_400,
        report,
    }
}

fn obligation(id: &str, property: &str, status: &str, witnesses: usize) -> serde_json::Value {
    json!({
        "id": id,
        "property": property,
        "action": null,
        "location": null,
        "required_witness": format!("witness for {id}"),
        "status": status,
        "evaluations": witnesses,
        "witnesses": witnesses,
        "passes": witnesses,
        "failures": 0,
        "first_witness_action": null,
        "first_witness_ms": null,
        "first_witness_trace": null,
        "shortest_witness_trace": null,
        "reason": if status == "unexercised" { json!("No successful meaningful witness") } else { json!(null) }
    })
}

fn report(status: &str, coverage: Vec<serde_json::Value>) -> serde_json::Value {
    let verified = coverage
        .iter()
        .filter(|o| o["status"] == "verified")
        .count();
    let unexercised = coverage
        .iter()
        .filter(|o| o["status"] == "unexercised")
        .count();
    let violated = coverage
        .iter()
        .filter(|o| o["status"] == "violated")
        .count();
    json!({
        "verifier_version": env!("CARGO_PKG_VERSION"),
        "status": status,
        "seed": 7,
        "cases": 1,
        "steps": 8,
        "shrink_budget": 256,
        "cases_executed": 1,
        "steps_executed": 8,
        "sequences": [],
        "verified": verified,
        "unexercised": unexercised,
        "violated": violated,
        "coverage": coverage,
        "metrics": {}
    })
}

#[test]
fn status_view_derives_rule_states_group_states_and_next_rules() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let project = project(
        root,
        "project Demo\nuse behavior \"contracts/core.bla\"\nuse behavior \"contracts/feature.bla\"\n",
        &[
            ("contracts/core.bla", CORE),
            ("contracts/feature.bla", FEATURE),
        ],
    );
    let unverified = status_view(
        &project,
        &evaluate(&project, Ok(None)),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(unverified.state, State::Unverified);
    assert_eq!(unverified.exit, 5);
    assert_eq!(unverified.rules.total, 4);
    assert_eq!(unverified.rules.green, 0);
    assert!(unverified.next.is_empty());
    assert!(unverified.groups[0].state.is_none());

    let current = project.fingerprint(&[]);
    let yellow = report(
        "yellow",
        vec![
            obligation("action/add", "add", "verified", 3),
            obligation("action/restart", "restart", "unexercised", 0),
            obligation("core::add-count/root", "core::add-count", "verified", 3),
            obligation(
                "feature::add-keeps-existing/root",
                "feature::add-keeps-existing",
                "verified",
                3,
            ),
            obligation(
                "feature::persistence/root.restart..true",
                "feature::persistence",
                "unexercised",
                0,
            ),
            obligation(
                "feature::persistence/root.restart..nondefault",
                "feature::persistence",
                "unexercised",
                0,
            ),
            obligation(
                "feature::unique-ids/root",
                "feature::unique-ids",
                "unexercised",
                0,
            ),
        ],
    );
    let view = status_view(
        &project,
        &evaluate(
            &project,
            Ok(Some(record(&project, yellow.clone(), &current))),
        ),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.state, State::Yellow);
    assert_eq!(view.exit, 5);
    assert_eq!(
        (
            view.rules.total,
            view.rules.green,
            view.rules.yellow,
            view.rules.red
        ),
        (4, 2, 2, 0)
    );
    assert_eq!((view.actions.total, view.actions.exercised), (2, 1));
    assert_eq!(view.groups[0].state, Some(State::Green));
    assert_eq!(view.groups[1].state, Some(State::Yellow));
    assert_eq!(view.groups[1].counts.green, 1);
    let next: Vec<&str> = view.next.iter().map(|rule| rule.id.as_str()).collect();
    assert_eq!(next, ["feature::persistence", "feature::unique-ids"]);
    let recorded = view.recorded.as_ref().unwrap();
    assert_eq!(recorded.recorded_at, "2000-02-29T00:00:00Z");
    assert!(recorded.stale.is_empty());

    let mut red_coverage = yellow["coverage"].as_array().unwrap().clone();
    red_coverage[3] = obligation(
        "feature::add-keeps-existing/root",
        "feature::add-keeps-existing",
        "violated",
        1,
    );
    let mut red = report("red", red_coverage);
    red["property"] = json!("feature::add-keeps-existing");
    red["minimal_sequence"] = json!([{"action": "add", "args": ["x"]}]);
    red["original_sequence_length"] = json!(5);
    red["minimal_sequence_length"] = json!(1);
    red["predicate"] = json!("all(before.items, old => any(after.items, item => item == old))");
    red["expected"] = json!(true);
    red["actual"] = json!(false);
    let evaluation = evaluate(&project, Ok(Some(record(&project, red, &current))));
    let view = status_view(
        &project,
        &evaluation,
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.state, State::Red);
    assert_eq!(view.exit, 1);
    assert_eq!(view.next[0].id, "feature::add-keeps-existing");
    assert_eq!(view.next[0].state, State::Red);
    let explained = explain_view(&project, &evaluation, "add-keeps-existing").unwrap();
    assert_eq!(explained.state, State::Red);
    assert_eq!(explained.file.as_deref(), Some("contracts/feature.bla"));
    assert_eq!(
        explained.failure.as_ref().unwrap().minimal_sequence.len(),
        1
    );
    let green_rule = explain_view(&project, &evaluation, "core::add-count").unwrap();
    assert_eq!(green_rule.state, State::Green);
    assert!(green_rule.failure.is_none());
    let action = explain_view(&project, &evaluation, "action/restart").unwrap();
    assert_eq!(action.state, State::Yellow);
    assert_eq!(action.obligations.len(), 1);
}

#[test]
fn status_view_is_stale_when_contracts_implementation_or_verifier_change() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let project = project(
        root,
        "project Demo\nuse behavior \"core.bla\"\n",
        &[("core.bla", CORE)],
    );
    let green = report(
        "green",
        vec![
            obligation("action/add", "add", "verified", 3),
            obligation("action/restart", "restart", "verified", 1),
            obligation("core::add-count/root", "core::add-count", "verified", 3),
        ],
    );
    let fresh = record(&project, green.clone(), &project.fingerprint(&[]));
    let view = status_view(
        &project,
        &evaluate(&project, Ok(Some(fresh.clone()))),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.state, State::Green);
    assert_eq!(view.exit, 0);

    write(root, "app.py", "changed implementation");
    let view = status_view(
        &project,
        &evaluate(&project, Ok(Some(fresh.clone()))),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.state, State::Stale);
    assert_eq!(view.exit, 5);
    assert_eq!(view.recorded.as_ref().unwrap().stale, ["implementation"]);
    assert!(view.next.is_empty());
    assert_eq!(view.rules.green, 0);

    let mut contracts = record(&project, green.clone(), &project.fingerprint(&[]));
    contracts.project_identity = "0000000000000000".into();
    let view = status_view(
        &project,
        &evaluate(&project, Ok(Some(contracts))),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.recorded.as_ref().unwrap().stale, ["contracts"]);

    let mut verifier = record(&project, green, &project.fingerprint(&[]));
    verifier.verifier_version = "0.0.0".into();
    let view = status_view(
        &project,
        &evaluate(&project, Ok(Some(verifier))),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.state, State::Stale);
    assert_eq!(view.recorded.as_ref().unwrap().stale, ["verifier"]);

    let view = status_view(
        &project,
        &evaluate(&project, Err("cannot parse".into())),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.state, State::Unverified);
    assert_eq!(view.record_error.as_deref(), Some("cannot parse"));
}

#[test]
fn unix_timestamps_render_as_utc() {
    assert_eq!(format_unix(0), "1970-01-01T00:00:00Z");
    assert_eq!(format_unix(86_400), "1970-01-02T00:00:00Z");
    assert_eq!(format_unix(951_782_400), "2000-02-29T00:00:00Z");
    assert_eq!(format_unix(1_757_800_000 + 3_661), "2025-09-13T22:47:41Z");
}

#[test]
fn manifest_parses_one_verification_profile_with_defaults_and_rejects_bad_ones() {
    let path = Path::new("project.bla");
    let full = parse_manifest(path, PROFILE_MANIFEST).unwrap();
    assert_eq!(
        full.profile,
        Some(Profile {
            command: vec!["python".into(), "app.py".into()],
            prepare: None,
            seed: 7,
            cases: 1,
            steps: 8,
            timeout_ms: 1000,
            startup_ms: None,
            shrink_budget: 256,
        })
    );
    assert_eq!(full.profile_span.unwrap().line, 4);
    assert_eq!(full.entries.len(), 1);
    let minimal = parse_manifest(
        path,
        "project X\nverify behavior { command [\"./run.sh\",] }\nuse behavior \"a.bla\"",
    )
    .unwrap();
    assert_eq!(
        minimal.profile,
        Some(Profile {
            command: vec!["./run.sh".into()],
            prepare: None,
            seed: 0,
            cases: 16,
            steps: 32,
            timeout_ms: 1000,
            startup_ms: None,
            shrink_budget: 256,
        })
    );
    assert_eq!(minimal.entries[0].group, "a");
    let none = parse_manifest(path, "project X\nuse behavior \"a.bla\"").unwrap();
    assert!(none.profile.is_none());
    for (source, code) in [
        (
            "project X\nverify behavior { command [\"a\"] }\nverify behavior { command [\"b\"] }",
            "E_DUPLICATE_PROFILE",
        ),
        (
            "project X\nverify behavior { steps 4 }",
            "E_PROFILE_COMMAND",
        ),
        (
            "project X\nverify behavior { command [] }",
            "E_PROFILE_COMMAND",
        ),
        (
            "project X\nverify behavior { command [\"\"] }",
            "E_PROFILE_COMMAND",
        ),
        (
            "project X\nverify behavior { command [python] }",
            "E_PROFILE_COMMAND",
        ),
        (
            "project X\nverify behavior { command [\"a\"] budget 4 }",
            "E_PROFILE_FIELD",
        ),
        (
            "project X\nverify behavior { command [\"a\"] steps 4 steps 5 }",
            "E_PROFILE_FIELD",
        ),
        (
            "project X\nverify behavior { command [\"a\"] steps 0 }",
            "E_PROFILE_FIELD",
        ),
        (
            "project X\nverify behavior { command [\"a\"] timeout_ms 5001 }",
            "E_PROFILE_FIELD",
        ),
        (
            "project X\nverify behavior { command [\"a\"] shrink_budget 257 }",
            "E_PROFILE_FIELD",
        ),
        (
            "project X\nverify behavior { command [\"a\"] seed -1 }",
            "E_PROFILE_FIELD",
        ),
        (
            "project X\nverify behavior { command [\"a\"]",
            "E_MANIFEST_STATEMENT",
        ),
        (
            "project X\nverify behavior command [\"a\"]",
            "E_MANIFEST_STATEMENT",
        ),
        (
            "project X\nverify mission { command [\"a\"] }",
            "E_UNSUPPORTED_LAYER",
        ),
    ] {
        let diagnostic = parse_manifest(path, source).unwrap_err();
        assert_eq!(diagnostic.code, code, "{source}: {}", diagnostic.message);
    }
}

#[test]
fn identity_ignores_the_verification_profile_but_fingerprint_and_staleness_see_it() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let files = [("core.bla", CORE)];
    let without = project(root, "project Demo\nuse behavior \"core.bla\"\n", &files);
    let with = project(root, PROFILE_MANIFEST, &files);
    assert_eq!(without.identity, with.identity);
    let renamed = project(root, "project Other\nuse behavior \"core.bla\"\n", &files);
    assert_ne!(without.identity, renamed.identity);
}

#[test]
fn resolve_command_resolves_project_paths_and_keeps_literals() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "app/main.py", "print()");
    write(root, "run.py", "print()");
    write(root, "data/notes.txt", "x");
    let written: Vec<String> = [
        "python",
        "app/main.py",
        "run.py",
        "persistent",
        "data",
        "--flag=./x",
        "./run.py",
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();
    let resolved = resolve_command(&written, root, "project.bla", Span::default()).unwrap();
    assert_eq!(resolved.program, Path::new("python"));
    assert_eq!(resolved.args.len(), 6);
    assert_eq!(
        Path::new(&resolved.args[0]),
        root.join("app").join("main.py")
    );
    assert_eq!(Path::new(&resolved.args[1]), root.join("run.py"));
    assert_eq!(resolved.args[2], "persistent");
    assert_eq!(resolved.args[3], "data");
    assert_eq!(resolved.args[4], "--flag=./x");
    assert_eq!(Path::new(&resolved.args[5]), root.join("run.py"));
    assert_eq!(resolved.written, written);
    let missing = resolve_command(
        &["python".to_owned(), "missing/main.py".to_owned()],
        root,
        "project.bla",
        Span::default(),
    )
    .unwrap_err();
    assert_eq!(missing.code, "E_APPLICATION_PATH");
    assert!(
        missing.message.contains("missing/main.py"),
        "{}",
        missing.message
    );
    assert!(
        missing.message.contains(&root.display().to_string()),
        "{}",
        missing.message
    );
    let absolute = root.join("run.py").display().to_string();
    let passthrough = resolve_command(
        std::slice::from_ref(&absolute),
        root,
        "project.bla",
        Span::default(),
    )
    .unwrap();
    assert_eq!(passthrough.program, Path::new(&absolute));
    let elsewhere = TempDir::new().unwrap();
    let other_base = resolve_command(
        &["python".to_owned(), "run.py".to_owned()],
        elsewhere.path(),
        "project.bla",
        Span::default(),
    )
    .unwrap();
    assert_eq!(other_base.args[0], "run.py");
}

#[test]
fn status_view_gates_completion_on_a_fresh_canonical_run() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let project = project(root, PROFILE_MANIFEST, &[("core.bla", CORE)]);
    let green = report(
        "green",
        vec![
            obligation("action/add", "add", "verified", 3),
            obligation("action/restart", "restart", "verified", 1),
            obligation("core::add-count/root", "core::add-count", "verified", 3),
        ],
    );
    let unverified = status_view(
        &project,
        &evaluate(&project, Ok(None)),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(unverified.completion.state, CompletionState::Unverified);
    assert!(!unverified.completion.allowed);
    assert_eq!(unverified.completion.command, Some("blabla finish"));
    assert_eq!(unverified.exit, 5);

    let canonical = record(&project, green.clone(), &project.fingerprint(&[]));
    let view = status_view(
        &project,
        &evaluate(&project, Ok(Some(canonical.clone()))),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.state, State::Green);
    assert_eq!(view.completion.state, CompletionState::Green);
    assert!(view.completion.allowed);
    assert_eq!(view.exit, 0);
    assert!(view.recorded.as_ref().unwrap().canonical);

    let mut other_settings = canonical.clone();
    other_settings.report["steps"] = json!(4);
    let view = status_view(
        &project,
        &evaluate(&project, Ok(Some(other_settings))),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.state, State::Green);
    assert_eq!(view.completion.state, CompletionState::NotCanonical);
    assert!(!view.completion.allowed);
    assert_eq!(view.exit, 5);
    assert!(!view.recorded.as_ref().unwrap().canonical);

    let mut other_command = canonical.clone();
    other_command.application = vec!["python".into(), "other.py".into()];
    let view = status_view(
        &project,
        &evaluate(&project, Ok(Some(other_command))),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.completion.state, CompletionState::NotCanonical);

    let mut older_profile = canonical.clone();
    older_profile.profile = None;
    let view = status_view(
        &project,
        &evaluate(&project, Ok(Some(older_profile))),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.state, State::Stale);
    assert_eq!(view.recorded.as_ref().unwrap().stale, ["profile"]);
    assert_eq!(view.completion.state, CompletionState::Stale);
    assert_eq!(view.exit, 5);

    let yellow = report(
        "yellow",
        vec![
            obligation("action/add", "add", "verified", 3),
            obligation("action/restart", "restart", "unexercised", 0),
            obligation("core::add-count/root", "core::add-count", "verified", 3),
        ],
    );
    let view = status_view(
        &project,
        &evaluate(
            &project,
            Ok(Some(record(&project, yellow, &project.fingerprint(&[])))),
        ),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.completion.state, CompletionState::Yellow);
    assert!(!view.completion.allowed);
    assert_eq!(view.exit, 5);

    let unprofiled = super::load(
        parse_manifest(
            &root.join("project.bla"),
            "project Demo\nuse behavior \"core.bla\"\n",
        )
        .unwrap(),
    )
    .unwrap();
    let plain = record(&unprofiled, green, &unprofiled.fingerprint(&[]));
    let view = status_view(
        &unprofiled,
        &evaluate(&unprofiled, Ok(Some(plain))),
        &crate::structure::StructureReport::none(),
    );
    assert_eq!(view.state, State::Green);
    assert_eq!(view.completion.state, CompletionState::Green);
    assert!(view.completion.allowed);
    assert_eq!(view.completion.command, None);
    assert_eq!(view.exit, 0);
}
