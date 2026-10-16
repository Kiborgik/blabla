use crate::cli::Cli;
use clap::{Command, CommandFactory};

fn collect_undescribed(command: &Command, path: &str, undescribed: &mut Vec<String>) {
    if command
        .get_about()
        .is_none_or(|about| about.to_string().trim().is_empty())
    {
        undescribed.push(path.to_owned());
    }
    for subcommand in command.get_subcommands() {
        collect_undescribed(
            subcommand,
            &format!("{path} {}", subcommand.get_name()),
            undescribed,
        );
    }
}

#[test]
fn every_expert_subcommand_describes_itself() {
    let root = Cli::command();
    let expert = root
        .find_subcommand("expert")
        .expect("the root command has an expert subcommand");
    let mut undescribed = Vec::new();
    collect_undescribed(expert, "expert", &mut undescribed);
    assert!(
        undescribed.is_empty(),
        "expert subcommands without an about description: {undescribed:?}"
    );
}
