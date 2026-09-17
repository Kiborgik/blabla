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

#[test]
fn rust_trait_method_is_a_symbol_and_renaming_it_turns_rule_red() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "src/lib.rs",
        "pub trait Reader {\n    fn read(&self);\n    fn close(&self);\n}\n",
    );
    let contract_text = "module core \"src/lib.rs\"\nrequire \"has-read\": symbol core::Reader.read\nrequire \"has-close\": symbol core::Reader.close";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(report.status, LayerStatus::Green);
    assert_eq!(status(&report, "has-read").0, RuleStatus::Green);
    assert_eq!(status(&report, "has-close").0, RuleStatus::Green);

    write(
        root,
        "src/lib.rs",
        "pub trait Reader {\n    fn scan(&self);\n    fn close(&self);\n}\n",
    );
    let contract2 = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report2 = verify(&[contract2], root, &default_providers());
    let (state, _) = status(&report2, "has-read");
    assert_eq!(state, RuleStatus::Red);
    assert_eq!(status(&report2, "has-close").0, RuleStatus::Green);
}

#[test]
fn rust_impl_trait_for_type_method_is_a_symbol() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "src/lib.rs",
        "pub trait Writer {\n    fn write(&mut self, data: &str);\n}\npub struct Buffer {}\nimpl Writer for Buffer {\n    fn write(&mut self, data: &str) {}\n}\n",
    );
    let contract_text =
        "module core \"src/lib.rs\"\nrequire \"buffer-write\": symbol core::Buffer.write";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(report.status, LayerStatus::Green);
    assert_eq!(status(&report, "buffer-write").0, RuleStatus::Green);
}

#[test]
fn rust_inherent_impl_method_struct_field_and_enum_variant_are_symbols() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "src/lib.rs",
        "pub struct Config {\n    pub name: String,\n    pub timeout: u32,\n}\nimpl Config {\n    pub fn new() -> Self { Config { name: String::new(), timeout: 30 } }\n    pub fn reset(&mut self) {}\n}\npub enum Status {\n    Ready,\n    Running,\n    Done,\n}\n",
    );
    let contract_text = "module core \"src/lib.rs\"\nrequire \"config-name\": symbol core::Config.name\nrequire \"config-timeout\": symbol core::Config.timeout\nrequire \"config-new\": symbol core::Config.new\nrequire \"config-reset\": symbol core::Config.reset\nrequire \"status-ready\": symbol core::Status.Ready\nrequire \"status-done\": symbol core::Status.Done";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(report.status, LayerStatus::Green);
    assert_eq!(status(&report, "config-name").0, RuleStatus::Green);
    assert_eq!(status(&report, "config-timeout").0, RuleStatus::Green);
    assert_eq!(status(&report, "config-new").0, RuleStatus::Green);
    assert_eq!(status(&report, "config-reset").0, RuleStatus::Green);
    assert_eq!(status(&report, "status-ready").0, RuleStatus::Green);
    assert_eq!(status(&report, "status-done").0, RuleStatus::Green);
}

#[test]
fn rust_inline_mod_body_items_are_not_symbols() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "src/lib.rs",
        "pub struct Public {}\nmod hidden {\n    pub struct InlineHidden {}\n    pub fn inline_func() {}\n}\n",
    );
    let contract_text = "module core \"src/lib.rs\"\nrequire \"public\": symbol core::Public\nforbid \"inline-hidden\": symbol core::InlineHidden";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "public").0, RuleStatus::Green);
    assert_eq!(status(&report, "inline-hidden").0, RuleStatus::Green);
}

#[test]
fn rust_dependency_through_plain_use() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "src/lib.rs", "pub mod utils;\npub fn main() {}\n");
    write(root, "src/utils.rs", "pub fn help() {}\n");
    write(
        root,
        "src/app.rs",
        "use crate::utils;\nfn run() { utils::help(); }\n",
    );
    let contract_text = "module core \"src/lib.rs\"\nmodule app \"src/app.rs\"\nmodule utils \"src/utils.rs\"\nrequire \"app-uses-utils\": dependency app -> utils";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "app-uses-utils").0, RuleStatus::Green);
}

#[test]
fn rust_dependency_through_fully_qualified_path_without_use() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "src/lib.rs", "pub mod utils;\npub fn main() {}\n");
    write(root, "src/utils.rs", "pub fn help() {}\n");
    write(
        root,
        "src/app.rs",
        "fn run() {\n    crate::utils::help();\n}\n",
    );
    let contract_text = "module core \"src/lib.rs\"\nmodule app \"src/app.rs\"\nmodule utils \"src/utils.rs\"\nrequire \"app-uses-utils\": dependency app -> utils";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "app-uses-utils").0, RuleStatus::Green);
}

#[test]
fn rust_dependency_through_path_inside_macro() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "src/lib.rs", "pub mod config;\npub fn main() {}\n");
    write(root, "src/config.rs", "pub const TIMEOUT: u32 = 30;\n");
    write(
        root,
        "src/app.rs",
        "fn run() {\n    let values = vec![crate::config::TIMEOUT];\n}\n",
    );
    let contract_text = "module core \"src/lib.rs\"\nmodule app \"src/app.rs\"\nmodule config \"src/config.rs\"\nrequire \"app-uses-config\": dependency app -> config";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "app-uses-config").0, RuleStatus::Green);
}

#[test]
fn rust_dependency_through_mod_declaration() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "src/lib.rs", "pub mod child;\nfn main() {}\n");
    write(root, "src/child.rs", "pub fn helper() {}\n");
    let contract_text = "module core \"src/lib.rs\"\nmodule child \"src/child.rs\"\nrequire \"declares-child\": dependency core -> child";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "declares-child").0, RuleStatus::Green);
}

#[test]
fn rust_forbid_dependency_is_red_on_fully_qualified_path() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "src/lib.rs", "pub mod db;\nfn main() {}\n");
    write(root, "src/db.rs", "pub fn query() {}\n");
    write(
        root,
        "src/app.rs",
        "fn run() {\n    crate::db::query();\n}\n",
    );
    let contract_text = "module core \"src/lib.rs\"\nmodule app \"src/app.rs\"\nmodule db \"src/db.rs\"\nforbid \"no-db\": dependency app -> db";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "no-db").0, RuleStatus::Red);
}

#[test]
fn rust_value_contains_over_const_array_of_strings() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "src/lib.rs",
        "pub const ALLOWED: &[&str] = &[\"read\", \"write\", \"admin\"];\npub const BLACKLIST: &[&str] = &[\"guest\", \"deny\"];\n",
    );
    let contract_text = "module core \"src/lib.rs\"\nrequire \"has-read\": value core::ALLOWED contains \"read\"\nrequire \"has-write\": value core::ALLOWED contains \"write\"\nforbid \"no-guest\": value core::ALLOWED contains \"guest\"\nrequire \"has-deny\": value core::BLACKLIST contains \"deny\"";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "has-read").0, RuleStatus::Green);
    assert_eq!(status(&report, "has-write").0, RuleStatus::Green);
    assert_eq!(status(&report, "no-guest").0, RuleStatus::Green);
    assert_eq!(status(&report, "has-deny").0, RuleStatus::Green);
}

#[test]
fn rust_value_maps_k_to_v_over_const_array_of_tuples() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "src/lib.rs",
        "pub const DEFAULTS: &[(u32, &str)] = &[(1, \"low\"), (5, \"medium\"), (10, \"high\")];\n",
    );
    let contract_text = "module core \"src/lib.rs\"\nrequire \"map-1-to-low\": value core::DEFAULTS maps 1 to \"low\"\nrequire \"map-5-to-medium\": value core::DEFAULTS maps 5 to \"medium\"\nrequire \"map-10-to-high\": value core::DEFAULTS maps 10 to \"high\"\nrequire \"map-1-to-high\": value core::DEFAULTS maps 1 to \"high\"";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "map-1-to-low").0, RuleStatus::Green);
    assert_eq!(status(&report, "map-5-to-medium").0, RuleStatus::Green);
    assert_eq!(status(&report, "map-10-to-high").0, RuleStatus::Green);
    assert_eq!(status(&report, "map-1-to-high").0, RuleStatus::Red);
}

#[test]
fn rust_parse_error_sets_rule_to_error() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "src/lib.rs", "pub fn broken(\n    pass\n}\n");
    let contract_text = "module core \"src/lib.rs\"\nrequire \"check-fn\": symbol core::broken";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "check-fn").0, RuleStatus::Error);
    assert_eq!(report.status, LayerStatus::Error);
}

#[test]
fn rust_missing_file_is_red_on_require_and_green_on_forbid() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "src/lib.rs", "fn main() {}\n");
    let contract_text = "module core \"src/lib.rs\"\nmodule missing \"src/missing.rs\"\nrequire \"missing-exists\": module missing\nforbid \"missing-forbidden\": symbol missing::Item";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    let (state, _) = status(&report, "missing-exists");
    assert_eq!(state, RuleStatus::Red);
    let (state, _) = status(&report, "missing-forbidden");
    assert_eq!(state, RuleStatus::Green);
}

#[test]
fn rust_generic_impl_type_name_ignores_generic_parameters() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "src/lib.rs",
        "pub struct Container<T> {}\nimpl<T> Container<T> {\n    pub fn get(&self) -> Option<&T> { None }\n}\n",
    );
    let contract_text =
        "module core \"src/lib.rs\"\nrequire \"container-get\": symbol core::Container.get";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "container-get").0, RuleStatus::Green);
}

#[test]
fn rust_static_const_values_are_extractable() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "src/lib.rs",
        "pub const MODES: &[&str] = &[\"sync\", \"async\"];\npub const COUNTS: &[i32] = &[10, 20, 30];\n",
    );
    let contract_text = "module core \"src/lib.rs\"\nrequire \"sync-mode\": value core::MODES contains \"sync\"\nrequire \"async-mode\": value core::MODES contains \"async\"\nrequire \"has-20\": value core::COUNTS contains 20";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "sync-mode").0, RuleStatus::Green);
    assert_eq!(status(&report, "async-mode").0, RuleStatus::Green);
    assert_eq!(status(&report, "has-20").0, RuleStatus::Green);
}

#[test]
fn rust_impl_const_and_trait_const_are_symbols() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "src/lib.rs",
        "pub trait Config {\n    const VERSION: u32;\n    const NAME: &str;\n}\npub struct AppConfig;\nimpl Config for AppConfig {\n    const VERSION: u32 = 2;\n    const NAME: &str = \"App\";\n}\n",
    );
    let contract_text = "module core \"src/lib.rs\"\nrequire \"trait-version\": symbol core::Config.VERSION\nrequire \"trait-name\": symbol core::Config.NAME\nrequire \"impl-version\": symbol core::AppConfig.VERSION\nrequire \"impl-name\": symbol core::AppConfig.NAME";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "trait-version").0, RuleStatus::Green);
    assert_eq!(status(&report, "trait-name").0, RuleStatus::Green);
    assert_eq!(status(&report, "impl-version").0, RuleStatus::Green);
    assert_eq!(status(&report, "impl-name").0, RuleStatus::Green);
}

#[test]
fn rust_external_crate_dependency() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(root, "src/lib.rs", "use serde::Serialize;\nfn main() {}\n");
    let contract_text =
        "module core \"src/lib.rs\"\nforbid \"no-serde\": dependency core -> \"serde\"";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "no-serde").0, RuleStatus::Red);
}

#[test]
fn rust_union_fields_are_symbols() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    write(
        root,
        "src/lib.rs",
        "pub union Data {\n    pub i: u32,\n    pub b: bool,\n}\n",
    );
    let contract_text = "module core \"src/lib.rs\"\nrequire \"union-i\": symbol core::Data.i\nrequire \"union-b\": symbol core::Data.b";
    let contract = parse("arch.bla", contract_text, root, Some("architecture")).unwrap();
    let report = verify(&[contract], root, &default_providers());
    assert_eq!(status(&report, "union-i").0, RuleStatus::Green);
    assert_eq!(status(&report, "union-b").0, RuleStatus::Green);
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
