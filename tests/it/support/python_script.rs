use std::process::Command;

pub fn python(script: &str) -> Command {
    let mut command = Command::new(crate::interpreter::python());
    command.args(["-c", script]);
    command
}
