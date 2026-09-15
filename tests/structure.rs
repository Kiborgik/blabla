use blabla::structure::syntax::parse;
use blabla::structure::{LayerStatus, RuleStatus, default_providers, verify};
use std::path::Path;
use tempfile::TempDir;

const MODEL: &str = "from dataclasses import dataclass\n\nVAULT_IDS = (\"A\", \"B\", \"C\")\nDURABLE_FIELDS = (\"keeper\", \"glyph\", \"charge\", \"sealed\", \"quarantined\")\nCOMPUTED = tuple(sorted(DURABLE_FIELDS))\nLIMIT: int = 9\n\n\n@dataclass\nclass Vault:\n    id: str\n    keeper: str | None = None\n\n\n@dataclass\nclass DurableVault:\n    id: str\n";

const DOMAIN: &str = "from model import VAULT_IDS, Vault\nimport json\n\n\nclass VaultDomain:\n    def __init__(self):\n        self.vaults = {}\n\n    def rotate(self, key):\n        pass\n\n    async def sync(self):\n        pass\n\n    def restart(self):\n        pass\n\n\ndef helper():\n    from store import VaultStore\n    return VaultStore\n";

const PROTOCOL: &str = "ARGUMENTS = {\n    \"bind\": (str, str),\n    \"restart\": (),\n}\n\n\nclass Protocol:\n    def dispatch(self, request):\n        pass\n";

const CONTRACT: &str = r#"
module model    "app/model.py"
module domain   "app/domain.py"
module store    "app/store.py"
module protocol "app/protocol.py"

require "durable-fields":        symbol model::DURABLE_FIELDS
require "vault":                 symbol model::Vault
require "domain-rotate":         symbol domain::VaultDomain.rotate
require "domain-sync":           symbol domain::VaultDomain.sync
forbid  "no-domain-restart":     symbol domain::VaultDomain.restart
forbid  "domain-independent-of-store": dependency domain -> store
forbid  "domain-no-json":        dependency domain -> "json"
forbid  "domain-no-os":          dependency domain -> "os"
require "domain-uses-model":     dependency domain -> model
require "durable-keeper":        value model::DURABLE_FIELDS contains "keeper"
forbid  "id-is-the-key":         value model::DURABLE_FIELDS contains "id"
require "computed":              value model::COMPUTED contains "keeper"
require "limit":                 value model::LIMIT contains 9
forbid  "no-protocol-restart":   value protocol::ARGUMENTS contains "restart"
require "store-module":          module store
"#;

fn write(root: &Path, relative: &str, text: &str) {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn report(root: &Path) -> blabla::structure::StructureReport {
    let contract = parse("architecture.bla", CONTRACT, root, Some("architecture")).unwrap();
    verify(&[contract], root, &default_providers())
}

fn status(report: &blabla::structure::StructureReport, id: &str) -> (RuleStatus, String) {
    let rule = report.result(&format!("architecture::{id}")).unwrap();
    (
        rule.status,
        rule.observed
            .clone()
            .unwrap_or_else(|| rule.message.clone()),
    )
}

#[test]
fn the_python_provider_reports_symbols_members_imports_and_literal_collections() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "app/model.py", MODEL);
    write(root, "app/domain.py", DOMAIN);
    write(root, "app/protocol.py", PROTOCOL);
    let first = report(root);
    let report = &first;
    assert_eq!(report.invocations, 1);
    assert_eq!(report.status, LayerStatus::Red, "{report:?}");
    assert_eq!(status(report, "durable-fields").0, RuleStatus::Green);
    assert_eq!(status(report, "vault").0, RuleStatus::Green);
    assert_eq!(status(report, "domain-rotate").0, RuleStatus::Green);
    assert_eq!(status(report, "domain-sync").0, RuleStatus::Green);
    let (state, observed) = status(report, "no-domain-restart");
    assert_eq!(state, RuleStatus::Red);
    assert_eq!(observed, "app/domain.py:15 defines VaultDomain.restart");
    let (state, observed) = status(report, "domain-independent-of-store");
    assert_eq!(state, RuleStatus::Red);
    assert_eq!(observed, "app/domain.py:20 imports store (app/store.py)");
    let (state, observed) = status(report, "domain-no-json");
    assert_eq!(state, RuleStatus::Red);
    assert_eq!(observed, "app/domain.py:2 imports json (\"json\")");
    assert_eq!(status(report, "domain-no-os").0, RuleStatus::Green);
    assert_eq!(status(report, "domain-uses-model").0, RuleStatus::Green);
    assert_eq!(status(report, "durable-keeper").0, RuleStatus::Green);
    assert_eq!(status(report, "id-is-the-key").0, RuleStatus::Green);
    let (state, message) = status(report, "computed");
    assert_eq!(state, RuleStatus::Error);
    assert!(message.contains("not a literal collection"), "{message}");
    assert_eq!(status(report, "limit").0, RuleStatus::Error);
    let (state, observed) = status(report, "no-protocol-restart");
    assert_eq!(state, RuleStatus::Red);
    assert_eq!(observed, "app/protocol.py:1 ARGUMENTS contains \"restart\"");
    let (state, observed) = status(report, "store-module");
    assert_eq!(state, RuleStatus::Red);
    assert_eq!(observed, "app/store.py does not exist");
    let again = report_json(&self::report(root));
    assert_eq!(report_json(report), again);
}

fn report_json(report: &blabla::structure::StructureReport) -> String {
    serde_json::to_string(report).unwrap()
}

#[test]
fn inspecting_a_module_never_executes_its_top_level_code() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let sentinel = root.join("executed.txt");
    let module = format!(
        "import sys\nfrom pathlib import Path\n\nPath({:?}).write_text(\"executed\")\nsys.exit(3)\n\nMARKER = (\"a\", \"b\")\n\n\nclass Live:\n    def run(self):\n        pass\n",
        sentinel.display().to_string()
    );
    write(root, "app/model.py", &module);
    write(root, "app/domain.py", "x = 1\n");
    write(root, "app/store.py", "y = 2\n");
    write(root, "app/protocol.py", "ARGUMENTS = {}\n");
    let report = report(root);
    assert!(!sentinel.exists(), "the provider executed repository code");
    assert_eq!(report.errors, 0, "{report:?}");
    let contract = parse(
        "s.bla",
        "module model \"app/model.py\"\nrequire \"marker\": value model::MARKER contains \"a\"\nrequire \"live-run\": symbol model::Live.run",
        root,
        Some("s"),
    )
    .unwrap();
    let extra = verify(&[contract], root, &default_providers());
    assert_eq!(extra.status, LayerStatus::Green, "{extra:?}");
    assert!(!sentinel.exists());
}

#[test]
fn syntax_errors_and_relative_imports_are_reported_per_module() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "app/model.py", "def broken(:\n    pass\n");
    write(
        root,
        "app/domain.py",
        "from . import model\nfrom .store import VaultStore\nfrom ..lib import util\n",
    );
    write(root, "app/store.py", "class VaultStore:\n    pass\n");
    write(root, "app/protocol.py", "ARGUMENTS = {}\n");
    let contract = parse(
        "s.bla",
        "module model \"app/model.py\"\nmodule domain \"app/domain.py\"\nmodule store \"app/store.py\"\nrequire \"model-vault\": symbol model::Vault\nrequire \"domain-model\": dependency domain -> model\nrequire \"domain-store\": dependency domain -> store\nrequire \"domain-lib\": dependency domain -> \"lib\"",
        root,
        Some("s"),
    )
    .unwrap();
    let report = verify(&[contract], root, &default_providers());
    let broken = report.result("s::model-vault").unwrap();
    assert_eq!(broken.status, RuleStatus::Error);
    assert!(
        broken.message.contains("could not be parsed"),
        "{}",
        broken.message
    );
    assert_eq!(
        report.result("s::domain-model").unwrap().status,
        RuleStatus::Green
    );
    assert_eq!(
        report.result("s::domain-store").unwrap().status,
        RuleStatus::Green
    );
    assert_eq!(
        report.result("s::domain-lib").unwrap().status,
        RuleStatus::Green
    );
}
