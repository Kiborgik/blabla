use super::{ModuleDecl, ModuleFacts, Provider, ProviderFailure};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

pub const EXTRACTOR: &str = include_str!("python_facts.py");
pub const PROVIDER_ID: &str = "python";
pub const EXTENSIONS: [&str; 1] = ["py"];
const INTERPRETERS: [&str; 2] = ["python", "python3"];

pub struct PythonProvider;

#[derive(Serialize)]
struct Request<'a> {
    root: String,
    modules: Vec<ModuleRequest<'a>>,
}

#[derive(Serialize)]
struct ModuleRequest<'a> {
    key: String,
    path: String,
    package: Vec<String>,
    display: &'a str,
}

#[derive(serde::Deserialize)]
struct Response {
    modules: BTreeMap<String, ModuleFacts>,
}

impl Provider for PythonProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn extensions(&self) -> &'static [&'static str] {
        &EXTENSIONS
    }

    fn symbol_depth(&self) -> usize {
        2
    }

    fn inspect(
        &self,
        root: &Path,
        modules: &[&ModuleDecl],
    ) -> Result<BTreeMap<String, ModuleFacts>, ProviderFailure> {
        let request = Request {
            root: root.display().to_string(),
            modules: modules
                .iter()
                .map(|module| ModuleRequest {
                    key: module.key(),
                    path: module.path.display().to_string(),
                    package: module.package(root),
                    display: &module.display,
                })
                .collect(),
        };
        let input =
            serde_json::to_vec(&request).map_err(|failure| unavailable(failure.to_string()))?;
        let output = run_extractor(&input)?;
        let response: Response = serde_json::from_slice(&output).map_err(|failure| {
            unavailable(format!(
                "the extractor returned unreadable facts: {failure}: {}",
                String::from_utf8_lossy(&output)
            ))
        })?;
        Ok(response.modules)
    }
}

fn run_extractor(input: &[u8]) -> Result<Vec<u8>, ProviderFailure> {
    let mut last_error = None;
    for interpreter in INTERPRETERS {
        let spawned = Command::new(interpreter)
            .args(["-I", "-c", EXTRACTOR])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = match spawned {
            Ok(child) => child,
            Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => {
                last_error = Some(format!("'{interpreter}' was not found on PATH"));
                continue;
            }
            Err(failure) => {
                return Err(unavailable(format!(
                    "cannot start '{interpreter}': {failure}"
                )));
            }
        };
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(input)
                .map_err(|failure| unavailable(format!("cannot send module list: {failure}")))?;
        }
        let output = child
            .wait_with_output()
            .map_err(|failure| unavailable(format!("cannot read extractor output: {failure}")))?;
        if output.status.success() {
            return Ok(output.stdout);
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if output.status.code() == Some(9009) || stderr.is_empty() && output.stdout.is_empty() {
            last_error = Some(format!("'{interpreter}' is not a working interpreter"));
            continue;
        }
        return Err(unavailable(format!(
            "'{interpreter}' exited with {}: {stderr}",
            output.status
        )));
    }
    Err(unavailable(last_error.unwrap_or_else(|| {
        "no Python interpreter found".to_owned()
    })))
}

fn unavailable(message: String) -> ProviderFailure {
    ProviderFailure::Unavailable {
        provider: PROVIDER_ID,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostic::Location;
    use std::path::Path;
    use tempfile::TempDir;

    fn module(root: &Path, name: &str, relative: &str) -> crate::structure::ModuleDecl {
        crate::structure::ModuleDecl {
            name: name.to_owned(),
            display: relative.to_owned(),
            path: root.join(relative),
            location: Location {
                file: "test.bla".to_owned(),
                line: 1,
                column: 1,
            },
        }
    }

    fn inspect_one(root: &Path, decl: &crate::structure::ModuleDecl) -> Vec<String> {
        PythonProvider
            .inspect(root, &[decl])
            .unwrap()
            .remove(&decl.key())
            .unwrap()
            .unresolved_imports
            .iter()
            .map(|u| u.form.clone())
            .collect()
    }

    #[test]
    fn importlib_import_module_with_variable_is_unresolved() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        std::fs::write(
            root.join("m.py"),
            "import importlib\nmod = 'sys'\nx = importlib.import_module(mod)\n",
        )
        .unwrap();
        let decl = module(root, "m", "m.py");
        let forms = inspect_one(root, &decl);
        assert!(!forms.is_empty());
        assert!(forms.iter().any(|f| f.contains("import_module")));
    }

    #[test]
    fn importlib_import_module_with_string_literal_resolves() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        std::fs::write(
            root.join("m.py"),
            "import importlib\nx = importlib.import_module('sys')\n",
        )
        .unwrap();
        let decl = module(root, "m", "m.py");
        let forms = inspect_one(root, &decl);
        assert!(forms.is_empty());
    }
}
