use crate::support::write;
use blabla::project::ignore::Ignore;
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
    assert!(observed.starts_with("app/domain.py:15 "), "{observed}");
    assert!(observed.ends_with("VaultDomain.restart"), "{observed}");
    let (state, observed) = status(report, "domain-independent-of-store");
    assert_eq!(state, RuleStatus::Red);
    assert!(observed.starts_with("app/domain.py:20 "), "{observed}");
    assert!(observed.ends_with("(app/store.py)"), "{observed}");
    let (state, observed) = status(report, "domain-no-json");
    assert_eq!(state, RuleStatus::Red);
    assert!(observed.starts_with("app/domain.py:2 "), "{observed}");
    assert!(observed.ends_with("(\"json\")"), "{observed}");
    assert_eq!(status(report, "domain-no-os").0, RuleStatus::Green);
    assert_eq!(status(report, "domain-uses-model").0, RuleStatus::Green);
    assert_eq!(status(report, "durable-keeper").0, RuleStatus::Green);
    assert_eq!(status(report, "id-is-the-key").0, RuleStatus::Green);
    let (state, _) = status(report, "computed");
    assert_eq!(state, RuleStatus::Error);
    assert_eq!(status(report, "limit").0, RuleStatus::Error);
    let (state, observed) = status(report, "no-protocol-restart");
    assert_eq!(state, RuleStatus::Red);
    assert!(observed.starts_with("app/protocol.py:1 "), "{observed}");
    assert!(observed.ends_with("\"restart\""), "{observed}");
    let (state, observed) = status(report, "store-module");
    assert_eq!(state, RuleStatus::Red);
    assert!(observed.starts_with("app/store.py"), "{observed}");
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

fn rust_report(root: &Path, contract_text: &str) -> blabla::structure::StructureReport {
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    verify(&[contract], root, &default_providers())
}

fn assert_green(report: &blabla::structure::StructureReport, ids: &[&str]) {
    for id in ids {
        assert_eq!(status(report, id).0, RuleStatus::Green, "{id}");
    }
}

#[test]
fn rust_provider_reports_every_symbol_kind() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let source = "pub trait Reader {\n    fn read(&self);\n    fn close(&self);\n}\n\
pub trait Writer {\n    fn write(&mut self, data: &str);\n}\n\
pub struct Buffer {}\nimpl Writer for Buffer {\n    fn write(&mut self, data: &str) {}\n}\n\
pub struct Config {\n    pub name: String,\n    pub timeout: u32,\n}\n\
impl Config {\n    pub fn new() -> Self { Config { name: String::new(), timeout: 30 } }\n    pub fn reset(&mut self) {}\n}\n\
pub enum Status {\n    Ready,\n    Running,\n    Done,\n}\n\
pub struct Container<T> {}\nimpl<T> Container<T> {\n    pub fn get(&self) -> Option<&T> { None }\n}\n\
pub trait Settings {\n    const VERSION: u32;\n    const NAME: &str;\n}\n\
pub struct AppConfig;\nimpl Settings for AppConfig {\n    const VERSION: u32 = 2;\n    const NAME: &str = \"App\";\n}\n\
pub union Data {\n    pub i: u32,\n    pub b: bool,\n}\n\
mod hidden {\n    pub struct InlineHidden {}\n    pub fn inline_func() {}\n}\n";
    write(root, "src/lib.rs", source);
    let contract_text = "module core \"src/lib.rs\"\n\
require \"has-read\": symbol core::Reader.read\n\
require \"has-close\": symbol core::Reader.close\n\
require \"buffer-write\": symbol core::Buffer.write\n\
require \"config-name\": symbol core::Config.name\n\
require \"config-timeout\": symbol core::Config.timeout\n\
require \"config-new\": symbol core::Config.new\n\
require \"config-reset\": symbol core::Config.reset\n\
require \"status-ready\": symbol core::Status.Ready\n\
require \"status-done\": symbol core::Status.Done\n\
require \"container-get\": symbol core::Container.get\n\
require \"trait-version\": symbol core::Settings.VERSION\n\
require \"trait-name\": symbol core::Settings.NAME\n\
require \"impl-version\": symbol core::AppConfig.VERSION\n\
require \"impl-name\": symbol core::AppConfig.NAME\n\
require \"union-i\": symbol core::Data.i\n\
require \"union-b\": symbol core::Data.b\n\
forbid \"inline-hidden\": symbol core::InlineHidden";
    let report = rust_report(root, contract_text);
    assert_eq!(report.status, LayerStatus::Green, "{report:?}");
    assert_green(
        &report,
        &[
            "has-read",
            "has-close",
            "buffer-write",
            "config-name",
            "config-timeout",
            "config-new",
            "config-reset",
            "status-ready",
            "status-done",
            "container-get",
            "trait-version",
            "trait-name",
            "impl-version",
            "impl-name",
            "union-i",
            "union-b",
            "inline-hidden",
        ],
    );

    write(
        root,
        "src/lib.rs",
        &source.replace("fn read(&self);", "fn scan(&self);"),
    );
    let renamed = rust_report(root, contract_text);
    assert_eq!(status(&renamed, "has-read").0, RuleStatus::Red);
    assert_eq!(status(&renamed, "has-close").0, RuleStatus::Green);
}

#[test]
fn rust_provider_reports_dependencies_through_every_route() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "src/lib.rs",
        "pub mod utils;\npub mod config;\npub mod db;\npub mod child;\npub fn main() {}\n",
    );
    write(root, "src/utils.rs", "pub fn help() {}\n");
    write(root, "src/config.rs", "pub const TIMEOUT: u32 = 30;\n");
    write(root, "src/db.rs", "pub fn query() {}\n");
    write(root, "src/child.rs", "pub fn helper() {}\n");
    write(
        root,
        "src/plain.rs",
        "use crate::utils;\nfn run() { utils::help(); }\n",
    );
    write(
        root,
        "src/qualified.rs",
        "fn run() {\n    crate::child::helper();\n}\n",
    );
    write(
        root,
        "src/macros.rs",
        "fn run() {\n    let values = vec![crate::config::TIMEOUT];\n}\n",
    );
    write(
        root,
        "src/direct.rs",
        "fn run() {\n    crate::db::query();\n}\n",
    );
    write(
        root,
        "src/external.rs",
        "use serde::Serialize;\nfn main() {}\n",
    );
    let contract_text = "module core \"src/lib.rs\"\n\
module utils \"src/utils.rs\"\n\
module config \"src/config.rs\"\n\
module db \"src/db.rs\"\n\
module child \"src/child.rs\"\n\
module plain \"src/plain.rs\"\n\
module qualified \"src/qualified.rs\"\n\
module macros \"src/macros.rs\"\n\
module direct \"src/direct.rs\"\n\
module external \"src/external.rs\"\n\
require \"plain-use\": dependency plain -> utils\n\
require \"qualified-path\": dependency qualified -> child\n\
require \"macro-path\": dependency macros -> config\n\
require \"mod-declaration\": dependency core -> utils\n\
forbid \"no-db\": dependency direct -> db\n\
forbid \"no-serde\": dependency external -> \"serde\"";
    let report = rust_report(root, contract_text);
    assert_green(
        &report,
        &[
            "plain-use",
            "qualified-path",
            "macro-path",
            "mod-declaration",
        ],
    );
    assert_eq!(status(&report, "no-db").0, RuleStatus::Red);
    assert_eq!(status(&report, "no-serde").0, RuleStatus::Red);
}

#[test]
fn rust_provider_extracts_literal_values() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "src/lib.rs",
        "pub const ALLOWED: &[&str] = &[\"read\", \"write\", \"admin\"];\n\
pub const BLACKLIST: &[&str] = &[\"guest\", \"deny\"];\n\
pub const COUNTS: &[i32] = &[10, 20, 30];\n\
pub const DEFAULTS: &[(u32, &str)] = &[(1, \"low\"), (5, \"medium\"), (10, \"high\")];\n",
    );
    let contract_text = "module core \"src/lib.rs\"\n\
require \"has-read\": value core::ALLOWED contains \"read\"\n\
require \"has-write\": value core::ALLOWED contains \"write\"\n\
forbid \"no-guest\": value core::ALLOWED contains \"guest\"\n\
require \"has-deny\": value core::BLACKLIST contains \"deny\"\n\
require \"has-20\": value core::COUNTS contains 20\n\
require \"map-1-to-low\": value core::DEFAULTS maps 1 to \"low\"\n\
require \"map-5-to-medium\": value core::DEFAULTS maps 5 to \"medium\"\n\
require \"map-10-to-high\": value core::DEFAULTS maps 10 to \"high\"\n\
require \"map-1-to-high\": value core::DEFAULTS maps 1 to \"high\"";
    let report = rust_report(root, contract_text);
    assert_green(
        &report,
        &[
            "has-read",
            "has-write",
            "no-guest",
            "has-deny",
            "has-20",
            "map-1-to-low",
            "map-5-to-medium",
            "map-10-to-high",
        ],
    );
    assert_eq!(status(&report, "map-1-to-high").0, RuleStatus::Red);
}

#[test]
fn rust_parse_errors_and_missing_files_are_reported_per_rule() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "src/lib.rs", "pub fn broken(\n    pass\n}\n");
    let report = rust_report(
        root,
        "module core \"src/lib.rs\"\nrequire \"check-fn\": symbol core::broken",
    );
    assert_eq!(status(&report, "check-fn").0, RuleStatus::Error);
    assert_eq!(report.status, LayerStatus::Error);

    write(root, "src/lib.rs", "fn main() {}\n");
    let report = rust_report(
        root,
        "module core \"src/lib.rs\"\nmodule missing \"src/missing.rs\"\nrequire \"missing-exists\": module missing\nforbid \"missing-forbidden\": symbol missing::Item",
    );
    assert_eq!(status(&report, "missing-exists").0, RuleStatus::Red);
    assert_eq!(status(&report, "missing-forbidden").0, RuleStatus::Green);
}

#[test]
fn rust_external_target_naming_an_internal_route_is_error_not_a_vacuous_forbid() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "src/lib.rs", "pub mod core;\n");
    write(
        root,
        "src/core.rs",
        "use serde::Serialize;\n\npub fn run() {\n    let _ = crate::other::helper();\n}\n",
    );
    let contract_text = "module core \"src/core.rs\"\n\
forbid \"internal-colon\": dependency core -> \"crate::other\"\n\
forbid \"internal-dot\": dependency core -> \"super.other\"\n\
forbid \"crate-path\": dependency core -> \"serde::Serialize\"\n\
require \"crate-root\": dependency core -> \"serde\"\n";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "internal-colon").0, RuleStatus::Error);
    assert_eq!(status(&report, "internal-dot").0, RuleStatus::Error);
    assert_eq!(status(&report, "crate-path").0, RuleStatus::Error);
    assert_eq!(status(&report, "crate-root").0, RuleStatus::Green);
    assert_eq!(report.status, LayerStatus::Error);
}

#[test]
fn python_external_targets_keep_their_dotted_submodule_semantics() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "app/thing.py", "import os.path\nimport json\n");
    let contract_text = "module thing \"app/thing.py\"\n\
require \"submodule\": dependency thing -> \"os.path\"\n\
require \"root\": dependency thing -> \"os\"\n\
forbid \"absent\": dependency thing -> \"socket\"\n";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "submodule").0, RuleStatus::Green);
    assert_eq!(status(&report, "root").0, RuleStatus::Green);
    assert_eq!(status(&report, "absent").0, RuleStatus::Green);
    assert_eq!(report.status, LayerStatus::Green);
}

#[test]
fn a_structure_contract_with_no_rules_is_refused_and_one_rule_is_accepted() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "app/thing.py", "x = 1\n");
    let refused = parse(
        "arch.bla",
        "module thing \"app/thing.py\"\n",
        root,
        Some("architecture"),
    )
    .unwrap_err();
    assert_eq!(refused.code, "E_NO_RULES");
    let accepted = parse(
        "arch.bla",
        "module thing \"app/thing.py\"\nrequire \"test\": module thing\n",
        root,
        Some("architecture"),
    )
    .unwrap();
    assert_eq!(accepted.rules.len(), 1);
}

fn lines_report(root: &Path, text: &str) -> blabla::structure::StructureReport {
    let contract = parse("size.bla", text, root, Some("size")).unwrap();
    verify(&[contract], root, &default_providers())
}

fn lines_status(report: &blabla::structure::StructureReport, id: &str) -> (RuleStatus, String) {
    let rule = report.result(&format!("size::{id}")).unwrap();
    (
        rule.status,
        rule.observed
            .clone()
            .unwrap_or_else(|| rule.message.clone()),
    )
}

fn lines_falsification(root: &Path, text: &str) -> blabla::structure::falsify::FalsifyReport {
    let contract = parse("size.bla", text, root, Some("size")).unwrap();
    blabla::structure::falsify::falsify(&[contract], root, &default_providers(), &Ignore::default())
}

fn write_lines(root: &Path, relative: &str, count: usize) {
    write(root, relative, &"x\n".repeat(count));
}

#[test]
fn a_lines_rule_over_a_directory_holds_when_every_file_is_within_the_bound() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write_lines(root, "pack/one.txt", 3);
    write_lines(root, "pack/deep/two.txt", 2);
    let report = lines_report(
        root,
        "module pack \"pack\"\nrequire \"bounded\": lines pack <= 3\n",
    );
    assert_eq!(lines_status(&report, "bounded").0, RuleStatus::Green);
    assert_eq!(report.status, LayerStatus::Green);
    assert_eq!(report.invocations, 0);
}

#[test]
fn a_lines_rule_over_a_directory_is_red_and_names_the_first_file_over_the_bound() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write_lines(root, "pack/a.txt", 2);
    write_lines(root, "pack/b.txt", 4);
    write_lines(root, "pack/c.txt", 5);
    let report = lines_report(
        root,
        "module pack \"pack\"\nrequire \"bounded\": lines pack <= 3\n",
    );
    let (status, observed) = lines_status(&report, "bounded");
    assert_eq!(status, RuleStatus::Red);
    assert!(observed.contains("pack/b.txt"), "{observed}");
    assert!(!observed.contains("pack/c.txt"), "{observed}");
    assert_eq!(report.status, LayerStatus::Red);
}

#[test]
fn a_forbid_lines_rule_inverts_the_bound() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write_lines(root, "pack/a.txt", 2);
    let report = lines_report(
        root,
        "module pack \"pack\"\nforbid \"within\": lines pack <= 3\nforbid \"beyond\": lines pack <= 1\n",
    );
    assert_eq!(lines_status(&report, "within").0, RuleStatus::Red);
    assert_eq!(lines_status(&report, "beyond").0, RuleStatus::Green);
}

#[test]
fn a_lines_rule_over_a_single_file_counts_that_file_without_a_provider() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write_lines(root, "notes/log.txt", 3);
    write(root, "notes/last.txt", "a\nb\nc");
    let report = lines_report(
        root,
        "module log \"notes/log.txt\"\nmodule last \"notes/last.txt\"\nrequire \"fits\": lines log <= 3\nrequire \"over\": lines log <= 2\nrequire \"unterminated\": lines last <= 3\nrequire \"unterminated-over\": lines last <= 2\n",
    );
    assert_eq!(lines_status(&report, "fits").0, RuleStatus::Green);
    assert_eq!(lines_status(&report, "over").0, RuleStatus::Red);
    assert_eq!(lines_status(&report, "unterminated").0, RuleStatus::Green);
    assert_eq!(
        lines_status(&report, "unterminated-over").0,
        RuleStatus::Red
    );
    assert_eq!(report.invocations, 0);
}

#[test]
fn a_lines_rule_shares_a_module_with_provider_facts() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "app/model.py", "class Vault:\n    pass\n");
    let report = lines_report(
        root,
        "module model \"app/model.py\"\nrequire \"vault\": symbol model::Vault\nrequire \"short\": lines model <= 5\nrequire \"tiny\": lines model <= 1\n",
    );
    assert_eq!(lines_status(&report, "vault").0, RuleStatus::Green);
    assert_eq!(lines_status(&report, "short").0, RuleStatus::Green);
    assert_eq!(lines_status(&report, "tiny").0, RuleStatus::Red);
    assert_eq!(report.invocations, 1);
}

#[test]
fn a_lines_rule_skips_what_project_walks_skip() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write_lines(root, "pack/a.txt", 2);
    write_lines(root, "pack/node_modules/huge.txt", 50);
    write_lines(root, "pack/target/huge.txt", 50);
    let report = lines_report(
        root,
        "module pack \"pack\"\nrequire \"bounded\": lines pack <= 3\n",
    );
    assert_eq!(lines_status(&report, "bounded").0, RuleStatus::Green);
}

#[test]
fn a_lines_rule_never_runs_project_code() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let sentinel = root.join("executed.txt");
    let module = format!(
        "from pathlib import Path\n\nPath({:?}).write_text(\"executed\")\n",
        sentinel.display().to_string()
    );
    write(root, "pack/run.py", &module);
    let report = lines_report(
        root,
        "module pack \"pack\"\nrequire \"bounded\": lines pack <= 10\n",
    );
    assert!(!sentinel.exists(), "a project file was executed");
    assert_eq!(lines_status(&report, "bounded").0, RuleStatus::Green);
    assert_eq!(report.invocations, 0);
}

#[test]
fn a_lines_rule_over_a_missing_module_is_red_when_required() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let report = lines_report(
        root,
        "module pack \"pack\"\nrequire \"bounded\": lines pack <= 3\n",
    );
    assert_eq!(lines_status(&report, "bounded").0, RuleStatus::Red);
}

#[test]
fn a_lines_rule_over_a_directory_outside_the_project_root_is_an_error() {
    let temp = TempDir::new().unwrap();
    let project = temp.path().join("project");
    std::fs::create_dir_all(&project).unwrap();
    write_lines(temp.path(), "outside/a.txt", 1);
    let report = lines_report(
        &project,
        "module pack \"../outside\"\nrequire \"bounded\": lines pack <= 3\n",
    );
    assert_eq!(lines_status(&report, "bounded").0, RuleStatus::Error);
    assert_eq!(report.status, LayerStatus::Error);
}

#[test]
fn any_other_fact_on_a_directory_module_is_a_contract_error() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write_lines(root, "pack/a.txt", 1);
    write(root, "app/model.py", "class Vault:\n    pass\n");
    let facts = [
        "require \"a\": module pack",
        "require \"a\": symbol pack::Vault",
        "require \"a\": dependency pack -> \"json\"",
        "require \"a\": dependency model -> pack",
        "require \"a\": value pack::LIMIT contains 1",
        "require \"a\": value pack::LIMIT maps 1 to 2",
    ];
    let codes: Vec<String> = facts
        .iter()
        .map(|fact| {
            let text = format!("module pack \"pack\"\nmodule model \"app/model.py\"\n{fact}\n");
            parse("size.bla", &text, root, Some("size"))
                .unwrap_err()
                .code
        })
        .collect();
    assert!(codes.iter().all(|code| *code == codes[0]), "{codes:?}");
    assert_ne!(codes[0], "E_STRUCTURE_FACT");
    assert_ne!(codes[0], "E_STRUCTURE_SYNTAX");
}

#[test]
fn a_lines_rule_needs_a_declared_module_and_an_integer_bound() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let unknown = parse(
        "size.bla",
        "require \"a\": lines pack <= 3\n",
        root,
        Some("size"),
    )
    .unwrap_err();
    assert_eq!(unknown.code, "E_UNKNOWN_MODULE");
    let malformed = parse(
        "size.bla",
        "module pack \"pack\"\nrequire \"a\": lines pack <= \"three\"\n",
        root,
        Some("size"),
    )
    .unwrap_err();
    assert_eq!(malformed.code, "E_STRUCTURE_FACT");
    let missing_bound = parse(
        "size.bla",
        "module pack \"pack\"\nrequire \"a\": lines pack 3\n",
        root,
        Some("size"),
    )
    .unwrap_err();
    assert_eq!(missing_bound.code, "E_STRUCTURE_SYNTAX");
}

#[test]
fn falsification_turns_a_green_lines_rule_red_and_a_red_one_green() {
    use blabla::structure::falsify::Verdict;
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write_lines(root, "pack/a.txt", 2);
    write_lines(root, "pack/b.txt", 2);
    let report = lines_falsification(
        root,
        "module pack \"pack\"\nrequire \"within\": lines pack <= 3\nrequire \"beyond\": lines pack <= 1\n",
    );
    let by_id = |id: &str| {
        report
            .rules
            .iter()
            .find(|rule| rule.id == format!("size::{id}"))
            .unwrap()
    };
    let within = by_id("within");
    assert_eq!(within.status, RuleStatus::Green);
    assert_eq!(within.verdict, Verdict::Falsifiable);
    assert_eq!(within.counterfactual_status, Some(RuleStatus::Red));
    let beyond = by_id("beyond");
    assert_eq!(beyond.status, RuleStatus::Red);
    assert_eq!(beyond.verdict, Verdict::Falsifiable);
    assert_eq!(beyond.counterfactual_status, Some(RuleStatus::Green));
    assert_eq!(report.vacuous, 0);
    assert_eq!(report.unevaluable, 0);
}

#[test]
fn a_lines_rule_over_a_directory_with_no_file_is_red_when_required() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    std::fs::create_dir_all(root.join("pack")).unwrap();
    write_lines(root, "pack/node_modules/huge.txt", 50);
    let report = lines_report(
        root,
        "module pack \"pack\"\nrequire \"bounded\": lines pack <= 3\n",
    );
    assert_eq!(lines_status(&report, "bounded").0, RuleStatus::Red);
}

#[cfg(windows)]
#[test]
fn a_lines_rule_matches_a_directory_spelled_in_another_case() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write_lines(root, "pack/a.txt", 2);
    write_lines(root, "pack/b.txt", 5);
    let report = lines_report(
        root,
        "module pack \"PACK\"\nrequire \"bounded\": lines pack <= 3\n",
    );
    assert_eq!(lines_status(&report, "bounded").0, RuleStatus::Red);
}

#[test]
fn falsification_of_a_lines_rule_over_an_empty_directory_is_vacuous() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    std::fs::create_dir_all(root.join("pack")).unwrap();
    let report = lines_falsification(
        root,
        "module pack \"pack\"\nrequire \"within\": lines pack <= 3\n",
    );
    assert_eq!(
        report.rules[0].verdict,
        blabla::structure::falsify::Verdict::Vacuous
    );
}
