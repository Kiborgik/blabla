use std::fs;
use std::path::Path;
use tempfile::TempDir;

#[path = "support/cli.rs"]
mod support;

#[test]
fn the_checked_in_entry_is_what_init_writes() {
    let workspace = TempDir::new().unwrap();
    let directory = workspace.path().to_owned();
    let mut args = support::args(&["init", "--agents", "--dir"]);
    args.push(directory.as_os_str());
    args.extend(support::args(&["--name", "Widget"]));
    let output = support::run(&args);
    assert!(output.status.success());

    let generated = fs::read_to_string(directory.join(".claude/skills/blabla/SKILL.md")).unwrap();
    let checked_in = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join(".claude/skills/blabla/SKILL.md"),
    )
    .unwrap();
    assert_eq!(
        generated.replace("\r\n", "\n"),
        checked_in.replace("\r\n", "\n")
    );
}
