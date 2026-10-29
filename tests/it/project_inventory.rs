use crate::support::{self, cli_json, tree_snapshot, write};
use serde_json::Value;
use std::path::Path;
use tempfile::TempDir;

fn fixture(manifest: &str) -> TempDir {
    let temp = TempDir::new().unwrap();
    write(
        temp.path(),
        "project.bla",
        &format!("project Inventory\n{manifest}"),
    );
    temp
}

fn inventory(root: &Path, extra: &[&str]) -> (i32, Value) {
    let mut arguments = vec!["inventory"];
    arguments.extend_from_slice(extra);
    cli_json(root, &arguments)
}

fn entry<'a>(report: &'a Value, path: &str) -> &'a Value {
    report["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["path"] == path)
        .unwrap_or_else(|| panic!("missing {path}: {report}"))
}

#[test]
fn discovers_unregistered_files_without_parsing_loading_or_writing_them() {
    let temp = fixture("");
    write(
        temp.path(),
        "notes/deep/forgotten.bla",
        "not valid BlaBla and must never be loaded\n",
    );
    write(
        temp.path(),
        ".blabla/verification.json",
        "{\"sentinel\":true}",
    );
    let before = tree_snapshot(temp.path());
    let (code, report) = inventory(temp.path(), &[]);
    assert_eq!(code, 0, "{report}");
    assert_eq!(report["complete"], true);
    assert_eq!(
        entry(&report, "notes/deep/forgotten.bla")["registration"],
        "unregistered"
    );
    assert_eq!(
        entry(&report, "notes/deep/forgotten.bla")["identities"],
        serde_json::json!([])
    );
    assert!(report.get("overall").is_none());
    assert_eq!(tree_snapshot(temp.path()), before);
}

#[test]
fn preserves_registration_aliases_drafts_and_manifest_locations_without_compilation() {
    let temp = fixture(
        "use behavior \"contracts/shared.bla\" as ledger\ndraft structure \"contracts/future.bla\" as proposal\nknowledge \"knowledge/team.bla\"\n",
    );
    for path in [
        "contracts/shared.bla",
        "contracts/future.bla",
        "knowledge/team.bla",
    ] {
        write(
            temp.path(),
            path,
            "invalid content is inventoried, not verified\n",
        );
    }
    let (code, report) = inventory(temp.path(), &[]);
    assert_eq!(code, 0, "{report}");
    let active = entry(&report, "contracts/shared.bla");
    assert_eq!(active["registration"], "active");
    assert_eq!(active["kind"], "behavior");
    assert_eq!(
        active["identities"],
        serde_json::json!(["contract::ledger"])
    );
    assert_eq!(active["registered_at"]["line"], 2);
    assert_eq!(
        entry(&report, "contracts/future.bla")["registration"],
        "draft"
    );
    assert_eq!(entry(&report, "knowledge/team.bla")["kind"], "knowledge");
    assert_eq!(report["entries"].as_array().unwrap().len(), 4);
}

#[test]
fn broken_registered_paths_remain_visible_and_return_an_error() {
    let temp = fixture("use behavior \"absent.bla\" as absent\nknowledge \"folder.bla\"\n");
    std::fs::create_dir(temp.path().join("folder.bla")).unwrap();
    let (code, report) = inventory(temp.path(), &[]);
    assert_eq!(code, 1, "{report}");
    assert_eq!(entry(&report, "absent.bla")["readability"], "missing");
    assert_eq!(entry(&report, "folder.bla")["readability"], "not_file");
    assert_eq!(report["complete"], true);
    assert!(!report["diagnostics"].as_array().unwrap().is_empty());
}

#[test]
fn respects_ignore_protection_generated_directories_and_nested_project_boundaries() {
    let temp = fixture(
        "ignore from \".gitignore\"\nuse behavior \"ignored/registered.bla\" as protected\nknowledge \"child/shared.bla\"\n",
    );
    write(temp.path(), "child/shared.bla", "uncompiled\n");
    write(temp.path(), ".gitignore", "ignored/\ngenerated/\n");
    for path in [
        "ignored/registered.bla",
        "ignored/orphan.bla",
        "generated/orphan.bla",
        "target/orphan.bla",
        ".blabla/scratch/orphan.bla",
        "child/contracts/orphan.bla",
    ] {
        write(temp.path(), path, "uncompiled\n");
    }
    write(temp.path(), "child/project.bla", "project Child\n");
    write(temp.path(), "ordinary/deep/orphan.bla", "uncompiled\n");
    let (code, report) = inventory(temp.path(), &[]);
    assert_eq!(code, 0, "{report}");
    assert_eq!(
        entry(&report, "ignored/registered.bla")["registration"],
        "active"
    );
    assert_eq!(
        entry(&report, "ordinary/deep/orphan.bla")["registration"],
        "unregistered"
    );
    for path in [
        "ignored/orphan.bla",
        "generated/orphan.bla",
        "target/orphan.bla",
        ".blabla/scratch/orphan.bla",
        "child/project.bla",
        "child/contracts/orphan.bla",
    ] {
        assert!(
            !report["entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["path"] == path),
            "{path}: {report}"
        );
    }
    assert!(
        report["boundaries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["path"] == "child" && item["reason"] == "nested_project")
    );
    assert_eq!(entry(&report, "child/shared.bla")["registration"], "memory");
}

#[test]
fn explicitly_registered_external_knowledge_is_listed_without_scanning_its_neighbors() {
    let temp = TempDir::new().unwrap();
    write(
        temp.path(),
        "app/project.bla",
        "project Inventory\nknowledge \"../shared/team.bla\"\n",
    );
    write(
        temp.path(),
        "shared/team.bla",
        "knowledge \"team\" { purpose \"Shared advice\" }\n",
    );
    write(
        temp.path(),
        "shared/orphan.bla",
        "not discovered from app\n",
    );
    let (code, report) = inventory(&temp.path().join("app"), &[]);
    assert_eq!(code, 0, "{report}");
    let shared = entry(&report, "../shared/team.bla");
    assert_eq!(shared["external"], true);
    assert_eq!(shared["readability"], "readable");
    assert_eq!(report["entries"].as_array().unwrap().len(), 2);
}

#[test]
fn bounded_scan_is_explicitly_incomplete_and_complete_output_is_deterministic() {
    let temp = fixture("");
    for index in 0..12 {
        write(
            temp.path(),
            &format!("files/{index:02}.bla"),
            "uncompiled\n",
        );
    }
    let (code, report) = inventory(temp.path(), &["--max-entries", "5"]);
    assert_eq!(code, 1, "{report}");
    assert_eq!(report["complete"], false);
    assert_eq!(report["scanned_entries"], 6);
    assert!(
        report["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["code"] == "scan_limit")
    );
    let (code, complete) = inventory(temp.path(), &[]);
    assert_eq!(code, 0, "{complete}");
    assert_eq!(inventory(temp.path(), &[]).1, complete);
    let paths: Vec<_> = complete["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["path"].as_str().unwrap())
        .collect();
    let mut sorted = paths.clone();
    sorted.sort();
    assert_eq!(paths, sorted);
}

#[cfg(unix)]
#[test]
fn does_not_follow_discovered_or_explicit_registered_symlinks() {
    use std::os::unix::fs::symlink;
    let temp = fixture("knowledge \"linked/team.bla\"\n");
    let outside = TempDir::new().unwrap();
    write(
        outside.path(),
        "team.bla",
        "secret input must not be read\n",
    );
    symlink(outside.path(), temp.path().join("linked")).unwrap();
    symlink(
        outside.path().join("team.bla"),
        temp.path().join("loose.bla"),
    )
    .unwrap();
    let (code, report) = inventory(temp.path(), &[]);
    assert_eq!(code, 1, "{report}");
    assert_eq!(entry(&report, "linked/team.bla")["readability"], "symlink");
    assert!(
        !report["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["path"] == "loose.bla")
    );
    assert!(
        report["boundaries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["reason"] == "symlink")
    );
}

#[test]
fn existing_manifest_duplicate_alias_diagnostics_are_preserved() {
    let temp = fixture("use behavior \"a.bla\" as same\nuse behavior \"b.bla\" as same\n");
    let (code, report) = inventory(temp.path(), &[]);
    assert_ne!(code, 0);
    assert_eq!(
        report["diagnostic"]["code"], "E_DUPLICATE_GROUP",
        "{report}"
    );
}

#[test]
fn every_memory_registration_and_custom_manifest_location_is_preserved() {
    let temp = fixture(
        "mission \"intent/why.bla\"\nsystem \"intent/parts.bla\"\nprocess \"intent/how.bla\"\ngoal \"intent/outcomes.bla\"\nknowledge \"intent/advice.bla\"\n",
    );
    for path in ["why", "parts", "how", "outcomes", "advice"] {
        write(temp.path(), &format!("intent/{path}.bla"), "uncompiled\n");
    }
    std::fs::rename(
        temp.path().join("project.bla"),
        temp.path().join("custom.bla"),
    )
    .unwrap();
    std::fs::create_dir(temp.path().join("subdir")).unwrap();
    let output = support::run_in(
        Some(&temp.path().join("subdir")),
        &support::args(&["--json", "--project", "../custom.bla", "inventory"]),
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(entry(&report, "custom.bla")["registration"], "manifest");
    for (path, kind) in [
        ("why", "mission"),
        ("parts", "system"),
        ("how", "process"),
        ("outcomes", "goal"),
        ("advice", "knowledge"),
    ] {
        let found = entry(&report, &format!("intent/{path}.bla"));
        assert_eq!(found["registration"], "memory");
        assert_eq!(found["kind"], kind);
    }
    assert_eq!(report["entries"].as_array().unwrap().len(), 6);
}

#[test]
fn deep_discovery_stops_with_an_explicit_limit_instead_of_claiming_completeness() {
    let temp = fixture("");
    let deep = format!("{}orphan.bla", "level/".repeat(66));
    write(temp.path(), &deep, "uncompiled\n");
    let (code, report) = inventory(temp.path(), &[]);
    assert_eq!(code, 1, "{report}");
    assert_eq!(report["complete"], false);
    assert!(
        report["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["code"] == "scan_limit")
    );
}

#[test]
fn human_and_json_surfaces_share_inventory_exit_semantics() {
    let temp = fixture("");
    write(temp.path(), "forgotten.bla", "uncompiled\n");
    let output = support::run_in(Some(temp.path()), &support::args(&["inventory"]));
    assert!(output.status.success());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("forgotten.bla"));
    assert_eq!(inventory(temp.path(), &[]).0, 0);
    write(
        temp.path(),
        "project.bla",
        "project Inventory\nknowledge \"absent.bla\"\n",
    );
    let output = support::run_in(Some(temp.path()), &support::args(&["inventory"]));
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(inventory(temp.path(), &[]).0, 1);
}
