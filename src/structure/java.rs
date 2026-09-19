use super::treesitter::{Facts, LineIndex, node_text};
use super::{Literal, ModuleDecl, ModuleFacts, Provider, ProviderFailure, normalize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tree_sitter::{Node, Tree};

pub const PROVIDER_ID: &str = "java";

pub const EXTENSIONS: [&str; 1] = ["java"];

pub struct JavaProvider;

impl Provider for JavaProvider {
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
        Ok(modules
            .iter()
            .map(|module| (module.key(), inspect_module(root, module, modules)))
            .collect())
    }

    fn external_target_error(&self, target: &str) -> Option<String> {
        if target.is_empty() {
            return Some(
                "an external target cannot be empty; it is a Java package or type name, such as \"java.util\" or \"java.util.List\""
                    .to_owned(),
            );
        }
        if target.ends_with(".*") {
            return Some(format!(
                "{target:?} names a wildcard rather than a type or package; write the package or the type the rule means"
            ));
        }
        None
    }
}

fn inspect_module(root: &Path, module: &ModuleDecl, all_modules: &[&ModuleDecl]) -> ModuleFacts {
    let language = tree_sitter_java::LANGUAGE;
    super::treesitter::inspect_module(module, &language.into(), |source, tree| {
        Scan::new(root, &module.path, source, all_modules).run(tree)
    })
}

struct Scan {
    file: PathBuf,
    source: String,
    lines: LineIndex,
    facts: Facts,
    package: Vec<String>,
    declared_modules: Vec<(PathBuf, Vec<String>)>,
}

impl Scan {
    fn new(root: &Path, file: &Path, source: &str, declared_modules: &[&ModuleDecl]) -> Scan {
        let file = normalize(file);
        let root = normalize(root);
        let mut modules = Vec::new();
        for module in declared_modules {
            if let Some(dotted) = super::dotted(&root, &module.path) {
                let parts: Vec<String> = dotted.split('.').map(|s| s.to_string()).collect();
                modules.push((module.path.clone(), parts));
            }
        }
        Scan {
            file: file.clone(),
            source: source.to_string(),
            lines: LineIndex::new(source),
            facts: Facts::default(),
            package: Vec::new(),
            declared_modules: modules,
        }
    }

    fn run(mut self, tree: &Tree) -> Facts {
        let root = tree.root_node();
        let mut cursor = root.walk();

        for child in root.children(&mut cursor) {
            if !child.is_named() {
                continue;
            }
            match child.kind() {
                "package_declaration" => self.read_package(&child),
                "import_declaration" => self.import_declaration(&child),
                "class_declaration"
                | "interface_declaration"
                | "enum_declaration"
                | "record_declaration"
                | "annotation_type_declaration" => self.type_declaration(&child),
                _ => {}
            }
        }

        self.add_same_package_unknowns();
        self.facts
    }

    fn read_package(&mut self, node: &Node) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "scoped_identifier" || child.kind() == "identifier" {
                let text = node_text(&child, &self.source);
                let parts: Vec<String> = text.split('.').map(|s| s.to_string()).collect();
                self.package = parts;
                break;
            }
        }
    }

    fn import_declaration(&mut self, node: &Node) {
        let line = self.lines.line_at(node.start_byte() as u32);
        let mut import_path = Vec::new();
        let mut is_static = false;
        let mut is_wildcard = false;

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            match child.kind() {
                "static" => is_static = true,
                "asterisk" | "*" => is_wildcard = true,
                "scoped_identifier" | "identifier" => {
                    let text = node_text(&child, &self.source);
                    import_path = text.split('.').map(|s| s.to_string()).collect();
                }
                _ => {}
            }
        }

        if import_path.is_empty() {
            return;
        }

        if is_static && !import_path.is_empty() {
            import_path.pop();
        }

        if is_wildcard {
            let wildcard_package = import_path.join(".");
            for (_, module_parts) in &self.declared_modules {
                if module_parts.len() > 1 {
                    let module_package = module_parts[..module_parts.len() - 1].join(".");
                    if module_package == wildcard_package {
                        let module_dotted = module_parts.join(".");
                        let form = format!(
                            "a wildcard import of {} could supply any type in that package",
                            wildcard_package
                        );
                        self.facts.unknown_import(form, line, Some(module_dotted));
                    }
                }
            }
        } else {
            let import_name = import_path.join(".");
            self.facts.import(import_name, line);
        }
    }

    fn add_same_package_unknowns(&mut self) {
        if self.package.is_empty() {
            return;
        }

        let this_package = self.package.join(".");
        let line = 1;

        for (file_path, module_parts) in &self.declared_modules {
            if file_path == &self.file {
                continue;
            }

            if module_parts.len() > 1 {
                let module_package = module_parts[..module_parts.len() - 1].join(".");
                if module_package == this_package {
                    let module_dotted = module_parts.join(".");
                    let form = format!(
                        "Java types in one package reference each other without an import; whether this file uses {} cannot be decided statically",
                        module_parts.last().unwrap_or(&"".to_string())
                    );
                    self.facts.unknown_import(form, line, Some(module_dotted));
                }
            }
        }
    }

    fn type_declaration(&mut self, node: &Node) {
        let Some(name_node) = node.child_by_field_name("name") else {
            return;
        };
        let type_name = node_text(&name_node, &self.source);
        let line = self.lines.line_at(name_node.start_byte() as u32);
        self.facts.symbol(vec![type_name.clone()], line);

        if let Some(body_node) = node.child_by_field_name("body") {
            self.type_body(&type_name, &body_node);
        }
    }

    fn type_body(&mut self, type_name: &str, node: &Node) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if !child.is_named() || child.kind() == "{" || child.kind() == "}" {
                continue;
            }
            match child.kind() {
                "field_declaration" => self.field_declaration(type_name, &child),
                "method_declaration" => self.method_declaration(type_name, &child),
                "constructor_declaration" => self.constructor_declaration(type_name, &child),
                "enum_constant" => self.enum_constant(type_name, &child),
                "record_component" => self.record_component(type_name, &child),
                "class_declaration"
                | "interface_declaration"
                | "enum_declaration"
                | "record_declaration"
                | "annotation_type_declaration" => self.nested_type(type_name, &child),
                _ => {}
            }
        }
    }

    fn field_declaration(&mut self, type_name: &str, node: &Node) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if !child.is_named() || child.kind() == "modifiers" {
                continue;
            }
            if child.kind() == "variable_declarator"
                && let Some(name_node) = child.child_by_field_name("name")
            {
                let field_name = node_text(&name_node, &self.source);
                let line = self.lines.line_at(name_node.start_byte() as u32);
                self.facts
                    .symbol(vec![type_name.to_owned(), field_name.clone()], line);

                if let Some(value_node) = child.child_by_field_name("value") {
                    let path = vec![type_name.to_owned(), field_name];
                    self.value(path, line, &value_node);
                }
            }
        }
    }

    fn method_declaration(&mut self, type_name: &str, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let method_name = node_text(&name_node, &self.source);
            let line = self.lines.line_at(name_node.start_byte() as u32);
            self.facts
                .symbol(vec![type_name.to_owned(), method_name], line);
        }
    }

    fn constructor_declaration(&mut self, type_name: &str, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let ctor_name = node_text(&name_node, &self.source);
            let line = self.lines.line_at(name_node.start_byte() as u32);
            self.facts
                .symbol(vec![type_name.to_owned(), ctor_name], line);
        }
    }

    fn enum_constant(&mut self, type_name: &str, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let const_name = node_text(&name_node, &self.source);
            let line = self.lines.line_at(name_node.start_byte() as u32);
            self.facts
                .symbol(vec![type_name.to_owned(), const_name], line);
        }
    }

    fn record_component(&mut self, type_name: &str, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let component_name = node_text(&name_node, &self.source);
            let line = self.lines.line_at(name_node.start_byte() as u32);
            self.facts
                .symbol(vec![type_name.to_owned(), component_name], line);
        }
    }

    fn nested_type(&mut self, parent_name: &str, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let nested_name = node_text(&name_node, &self.source);
            let line = self.lines.line_at(name_node.start_byte() as u32);
            self.facts
                .symbol(vec![parent_name.to_owned(), nested_name], line);
        }
    }

    fn value(&mut self, path: Vec<String>, line: usize, node: &Node) {
        match literal_collection(node, &self.source) {
            Some(values) => self.facts.collection(path.clone(), line, values),
            None => {
                if scalar(node, &self.source).is_none() {
                    self.facts.unreadable_value(path.clone(), line);
                }
            }
        }
        if let Some(pairs) = collection_entries(&self.lines, node, &self.source) {
            for (entry_line, key, values) in pairs {
                self.facts.entry(path.clone(), key, entry_line, values);
            }
        }
    }
}

fn scalar(node: &Node, source: &str) -> Option<Literal> {
    match node.kind() {
        "string_literal" => {
            let text = node_text(node, source);
            let trimmed = text.trim_start_matches('"').trim_end_matches('"');
            Some(Literal::Str(trimmed.to_string()))
        }
        "true" | "false" => Some(Literal::Bool(node_text(node, source) == "true")),
        "decimal_integer_literal"
        | "hex_integer_literal"
        | "octal_integer_literal"
        | "binary_integer_literal" => {
            let text = node_text(node, source);
            if let Ok(num) = text.parse::<i64>() {
                Some(Literal::Int(num))
            } else {
                None
            }
        }
        _ => None,
    }
}

fn literal_collection(node: &Node, source: &str) -> Option<Vec<Literal>> {
    match node.kind() {
        "array_initializer" => {
            let mut values = Vec::new();
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() != ","
                    && child.is_named()
                    && child.kind() != "{"
                    && child.kind() != "}"
                {
                    values.push(scalar(&child, source)?);
                }
            }
            Some(values)
        }
        "method_invocation" => {
            let method_text = node_text(node, source);
            if method_text.contains("List.of(") || method_text.contains("Set.of(") {
                let mut values = Vec::new();
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "argument_list" {
                        let mut arg_cursor = child.walk();
                        for arg in child.children(&mut arg_cursor) {
                            if arg.kind() != ","
                                && arg.is_named()
                                && arg.kind() != "("
                                && arg.kind() != ")"
                            {
                                values.push(scalar(&arg, source)?);
                            }
                        }
                        break;
                    }
                }
                if !values.is_empty() {
                    return Some(values);
                }
            }
            None
        }
        _ => None,
    }
}

fn collection_entries(lines: &LineIndex, node: &Node, source: &str) -> Option<Vec<super::Entry>> {
    match node.kind() {
        "method_invocation" => {
            let method_text = node_text(node, source);
            if method_text.contains("Map.of(") {
                let mut entries = Vec::new();
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "argument_list" {
                        let mut args = Vec::new();
                        let mut arg_cursor = child.walk();
                        for arg in child.children(&mut arg_cursor) {
                            if arg.kind() != ","
                                && arg.is_named()
                                && arg.kind() != "("
                                && arg.kind() != ")"
                            {
                                args.push(arg);
                            }
                        }
                        for pair in args.chunks(2) {
                            if pair.len() == 2 {
                                let key = scalar(&pair[0], source)?;
                                let line = lines.line_at(child.start_byte() as u32);
                                let value = expression_payload(&pair[1], source);
                                entries.push((line, key, value));
                            }
                        }
                        break;
                    }
                }
                if !entries.is_empty() {
                    return Some(entries);
                }
            } else if method_text.contains("Map.entry(") {
                let mut entries = Vec::new();
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "argument_list" {
                        let mut args = Vec::new();
                        let mut arg_cursor = child.walk();
                        for arg in child.children(&mut arg_cursor) {
                            if arg.kind() != ","
                                && arg.is_named()
                                && arg.kind() != "("
                                && arg.kind() != ")"
                            {
                                args.push(arg);
                            }
                        }
                        if args.len() == 2 {
                            let key = scalar(&args[0], source)?;
                            let line = lines.line_at(child.start_byte() as u32);
                            let value = expression_payload(&args[1], source);
                            entries.push((line, key, value));
                        }
                        break;
                    }
                }
                if !entries.is_empty() {
                    return Some(entries);
                }
            }
            None
        }
        "array_initializer" => {
            let mut entries = Vec::new();
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "array_initializer" {
                    let mut sub_cursor = child.walk();
                    let mut elements = Vec::new();
                    for sub_child in child.children(&mut sub_cursor) {
                        if sub_child.kind() != ","
                            && sub_child.is_named()
                            && sub_child.kind() != "{"
                            && sub_child.kind() != "}"
                        {
                            elements.push(sub_child);
                        }
                    }
                    if elements.len() == 2 {
                        let key = scalar(&elements[0], source)?;
                        let line = lines.line_at(child.start_byte() as u32);
                        let value = expression_payload(&elements[1], source);
                        entries.push((line, key, value));
                    } else {
                        return None;
                    }
                }
            }
            if entries.is_empty() {
                return None;
            }
            Some(entries)
        }
        _ => None,
    }
}

fn expression_payload(node: &Node, source: &str) -> Option<Vec<Literal>> {
    if let Some(val) = scalar(node, source) {
        return Some(vec![val]);
    }
    literal_collection(node, source)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostic::Location;
    use tempfile::TempDir;

    fn module(root: &Path, name: &str, relative: &str) -> ModuleDecl {
        ModuleDecl {
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

    fn write(root: &Path, relative: &str, text: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn inspect_one(root: &Path, declaration: &ModuleDecl) -> ModuleFacts {
        JavaProvider
            .inspect(root, &[declaration])
            .unwrap()
            .remove(&declaration.key())
            .unwrap()
    }

    #[test]
    fn a_missing_file_exists_false_without_an_error() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        let declaration = module(root, "m", "missing.java");
        let facts = inspect_one(root, &declaration);
        assert!(!facts.exists);
        assert!(facts.error.is_none());
    }

    #[test]
    fn a_file_that_does_not_parse_sets_an_error_with_a_line() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "broken.java", "class Broken {\n    int x =;\n}\n");
        let declaration = module(root, "m", "broken.java");
        let facts = inspect_one(root, &declaration);
        assert!(facts.exists);
        let error = facts.error.expect("a syntax error was expected");
        assert!(error.contains("line"), "{error}");
    }

    #[test]
    fn a_class_with_fields_and_methods_reports_symbols() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.java",
            "public class Service {\n    private int id;\n    public void run() {}\n}\n",
        );
        let declaration = module(root, "m", "app.java");
        let facts = inspect_one(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|part| (*part).to_owned()).collect();
            facts.symbols.iter().any(|symbol| symbol.path == path)
        };
        assert!(has(&["Service"]));
        assert!(has(&["Service", "id"]));
        assert!(has(&["Service", "run"]));
    }

    #[test]
    fn an_enum_with_constants_reports_them_as_members() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.java",
            "public enum Color {\n    RED,\n    GREEN,\n    BLUE;\n}\n",
        );
        let declaration = module(root, "m", "app.java");
        let facts = inspect_one(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|part| (*part).to_owned()).collect();
            facts.symbols.iter().any(|symbol| symbol.path == path)
        };
        assert!(has(&["Color"]));
        assert!(has(&["Color", "RED"]));
        assert!(has(&["Color", "GREEN"]));
        assert!(has(&["Color", "BLUE"]));
    }

    #[test]
    fn a_nested_type_contributes_only_its_own_name() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.java",
            "public class Outer {\n    public class Inner {\n        public void method() {}\n    }\n}\n",
        );
        let declaration = module(root, "m", "app.java");
        let facts = inspect_one(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|part| (*part).to_owned()).collect();
            facts.symbols.iter().any(|symbol| symbol.path == path)
        };
        assert!(has(&["Outer"]));
        assert!(has(&["Outer", "Inner"]));
        assert!(!has(&["Outer", "Inner", "method"]));
    }

    #[test]
    fn a_single_type_import_of_a_declared_module_records_under_dotted_path() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "src/Sibling.java", "public class Sibling {}\n");
        write(
            root,
            "src/Main.java",
            "import src.Sibling;\npublic class Main {}\n",
        );
        let main = module(root, "main", "src/Main.java");
        let sibling = module(root, "sibling", "src/Sibling.java");
        let facts = JavaProvider
            .inspect(root, &[&main, &sibling])
            .unwrap()
            .remove(&main.key())
            .unwrap();
        assert!(
            facts
                .imports
                .iter()
                .any(|import| import.name == "src.Sibling"),
            "{:?}",
            facts.imports
        );
    }

    #[test]
    fn an_external_type_import_is_recorded_verbatim() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.java",
            "import java.util.List;\npublic class App {}\n",
        );
        let declaration = module(root, "m", "app.java");
        let facts = inspect_one(root, &declaration);
        assert!(
            facts
                .imports
                .iter()
                .any(|import| import.name == "java.util.List"),
            "{:?}",
            facts.imports
        );
    }

    #[test]
    fn a_wildcard_import_produces_scoped_unknowns_per_declared_module_in_that_package() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "mypackage/First.java",
            "package mypackage;\npublic class First {}\n",
        );
        write(
            root,
            "mypackage/Second.java",
            "package mypackage;\npublic class Second {}\n",
        );
        write(
            root,
            "elsewhere/Main.java",
            "package elsewhere;\nimport mypackage.*;\npublic class Main {}\n",
        );
        let first = module(root, "first", "mypackage/First.java");
        let second = module(root, "second", "mypackage/Second.java");
        let main = module(root, "main", "elsewhere/Main.java");
        let facts = JavaProvider
            .inspect(root, &[&first, &second, &main])
            .unwrap()
            .remove(&main.key())
            .unwrap();
        let covers_first = facts
            .unresolved_imports
            .iter()
            .any(|u| u.covers.as_ref().is_some_and(|c| c.contains("First")));
        let covers_second = facts
            .unresolved_imports
            .iter()
            .any(|u| u.covers.as_ref().is_some_and(|c| c.contains("Second")));
        assert!(
            covers_first,
            "should cover First: {:?}",
            facts.unresolved_imports
        );
        assert!(
            covers_second,
            "should cover Second: {:?}",
            facts.unresolved_imports
        );
    }

    #[test]
    fn same_package_siblings_produce_scoped_unknowns() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "pkg/First.java",
            "package pkg;\npublic class First {}\n",
        );
        write(
            root,
            "pkg/Second.java",
            "package pkg;\npublic class Second {}\n",
        );
        let first = module(root, "first", "pkg/First.java");
        let second = module(root, "second", "pkg/Second.java");
        let facts = JavaProvider
            .inspect(root, &[&first, &second])
            .unwrap()
            .remove(&first.key())
            .unwrap();
        assert!(
            facts
                .unresolved_imports
                .iter()
                .any(|u| u.covers.as_ref().is_some_and(|c| c.contains("Second"))),
            "should produce scoped unknown for same-package sibling: {:?}",
            facts.unresolved_imports
        );
    }

    #[test]
    fn an_array_initializer_becomes_a_collection() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.java",
            "public class App {\n    public static final String[] LIST = {\"a\", \"b\", \"c\"};\n}\n",
        );
        let declaration = module(root, "m", "app.java");
        let facts = inspect_one(root, &declaration);
        let path = vec!["App".to_owned(), "LIST".to_owned()];
        let collection = facts
            .collections
            .iter()
            .find(|collection| collection.path == path)
            .expect("LIST should be a literal collection");
        assert_eq!(
            collection.values,
            vec![
                Literal::Str("a".to_owned()),
                Literal::Str("b".to_owned()),
                Literal::Str("c".to_owned())
            ]
        );
    }

    #[test]
    fn map_of_becomes_entries() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.java",
            "import java.util.Map;\npublic class App {\n    public static final Map<String, String> CONFIG = Map.of(\"key1\", \"value1\", \"key2\", \"value2\");\n}\n",
        );
        let declaration = module(root, "m", "app.java");
        let facts = inspect_one(root, &declaration);
        let path = vec!["App".to_owned(), "CONFIG".to_owned()];
        let key1_entry = facts
            .entries
            .iter()
            .find(|entry| entry.path == path && entry.key == Literal::Str("key1".to_owned()));
        assert!(key1_entry.is_some(), "Map.of should create entries");
    }

    #[test]
    fn a_constructor_call_initializer_lands_in_unreadable() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.java",
            "public class App {\n    public static final List<?> LIST = new ArrayList<>();\n}\n",
        );
        let declaration = module(root, "m", "app.java");
        let facts = inspect_one(root, &declaration);
        let path = vec!["App".to_owned(), "LIST".to_owned()];
        assert!(
            facts.unsupported.iter().any(|symbol| symbol.path == path),
            "constructor call should be unsupported"
        );
    }

    #[test]
    fn a_readable_scalar_is_not_unsupported() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.java",
            "public class App {\n    public static final String NAME = \"test\";\n}\n",
        );
        let declaration = module(root, "m", "app.java");
        let facts = inspect_one(root, &declaration);
        let path = vec!["App".to_owned(), "NAME".to_owned()];
        assert!(
            facts.unsupported.iter().all(|symbol| symbol.path != path),
            "readable scalar should not be unsupported"
        );
    }
}
