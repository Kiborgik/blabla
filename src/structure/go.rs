use super::treesitter::{Facts, LineIndex, Neighbourhood, node_text};
use super::{Literal, ModuleDecl, ModuleFacts, Provider, ProviderFailure, normalize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tree_sitter::{Node, Tree};

pub const PROVIDER_ID: &str = "go";

pub const EXTENSIONS: [&str; 1] = ["go"];

pub struct GoProvider;

impl Provider for GoProvider {
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
        let neighbourhood = Neighbourhood::new(root, modules);
        Ok(modules
            .iter()
            .map(|module| (module.key(), inspect_module(root, module, &neighbourhood)))
            .collect())
    }

    fn external_target_error(&self, target: &str) -> Option<String> {
        if target.is_empty() {
            return Some(
                "an external target cannot be empty; it is a Go import path, such as \"fmt\" or \"github.com/owner/repo/pkg\""
                    .to_owned(),
            );
        }
        if target.starts_with("./") || target.starts_with("../") {
            return Some(format!(
                "{target:?} is a relative path rather than a Go import path; declare the file with `module` and write `dependency <from> -> <name>`"
            ));
        }
        None
    }
}

fn inspect_module(root: &Path, module: &ModuleDecl, neighbourhood: &Neighbourhood) -> ModuleFacts {
    let language = tree_sitter_go::LANGUAGE.into();
    super::treesitter::inspect_module(module, &language, |source, tree| {
        Scan::new(root, &module.path, source, neighbourhood).run(tree)
    })
}

struct Scan<'a> {
    root: PathBuf,
    file_path: PathBuf,
    source: String,
    lines: LineIndex,
    facts: Facts,
    neighbourhood: &'a Neighbourhood<'a>,
    package_line: usize,
}

impl<'a> Scan<'a> {
    fn new(
        root: &Path,
        file: &Path,
        source: &str,
        neighbourhood: &'a Neighbourhood<'a>,
    ) -> Scan<'a> {
        let file = normalize(file);
        let root = normalize(root);
        Scan {
            root,
            file_path: file,
            source: source.to_string(),
            lines: LineIndex::new(source),
            facts: Facts::default(),
            neighbourhood,
            package_line: 1,
        }
    }

    fn run(mut self, tree: &Tree) -> Facts {
        let root = tree.root_node();
        let mut cursor = root.walk();

        for child in root.children(&mut cursor) {
            if child.is_named() {
                self.top_level_statement(&child);
            }
        }

        self.emit_same_package_unknowns();
        self.facts
    }

    fn top_level_statement(&mut self, node: &Node) {
        match node.kind() {
            "package_clause" => self.record_package(node),
            "import_declaration" => self.import_declaration(node),
            "function_declaration" => self.function_declaration(node),
            "type_declaration" => self.type_declaration(node),
            "const_declaration" => self.const_declaration(node),
            "var_declaration" => self.var_declaration(node),
            "method_declaration" => self.method_declaration(node),
            _ => {}
        }
    }

    fn record_package(&mut self, node: &Node) {
        self.package_line = self.lines.line_of(node);
    }

    fn function_declaration(&mut self, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let name = node_text(&name_node, &self.source);
            let line = self.lines.line_of(&name_node);
            self.facts.symbol(vec![name], line);
        }
    }

    fn method_declaration(&mut self, node: &Node) {
        if let Some(receiver_node) = node.child_by_field_name("receiver")
            && let Some(name_node) = node.child_by_field_name("name")
        {
            let receiver_type = self.extract_receiver_type(&receiver_node);
            let method_name = node_text(&name_node, &self.source);
            let line = self.lines.line_of(&name_node);
            self.facts.symbol(vec![receiver_type, method_name], line);
        }
    }

    fn extract_receiver_type(&self, receiver_node: &Node) -> String {
        let mut cursor = receiver_node.walk();
        for child in receiver_node.children(&mut cursor) {
            if child.is_named()
                && child.kind() == "parameter_declaration"
                && let Some(type_node) = child.child_by_field_name("type")
            {
                return self.extract_type_identifier(&type_node);
            }
        }
        String::new()
    }

    fn extract_type_identifier(&self, node: &Node) -> String {
        match node.kind() {
            "type_identifier" => node_text(node, &self.source),
            "pointer_type" => {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.is_named() {
                        let result = self.extract_type_identifier(&child);
                        if !result.is_empty() {
                            return result;
                        }
                    }
                }
                String::new()
            }
            "generic_type" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    return self.extract_type_identifier(&name_node);
                }
                String::new()
            }
            _ => String::new(),
        }
    }

    fn type_declaration(&mut self, node: &Node) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.is_named() && child.kind() == "type_spec" {
                self.type_spec(&child);
            }
        }
    }

    fn type_spec(&mut self, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let type_name = node_text(&name_node, &self.source);
            let line = self.lines.line_of(&name_node);
            self.facts.symbol(vec![type_name.clone()], line);

            if let Some(type_node) = node.child_by_field_name("type") {
                self.extract_type_members(&type_name, &type_node);
            }
        }
    }

    fn extract_type_members(&mut self, type_name: &str, node: &Node) {
        match node.kind() {
            "struct_type" => self.extract_struct_fields(type_name, node),
            "interface_type" => self.extract_interface_methods(type_name, node),
            _ => {}
        }
    }

    fn extract_struct_fields(&mut self, struct_name: &str, node: &Node) {
        self.extract_fields_recursive(struct_name, node);
    }

    fn extract_fields_recursive(&mut self, struct_name: &str, node: &Node) {
        let mut cursor = node.walk();
        let mut found_first_on_this_level = false;

        for child in node.children(&mut cursor) {
            if !child.is_named() {
                continue;
            }

            match child.kind() {
                "identifier" if !found_first_on_this_level => {
                    let field_name = node_text(&child, &self.source);
                    if !field_name.is_empty() {
                        let line = self.lines.line_of(&child);
                        self.facts
                            .symbol(vec![struct_name.to_owned(), field_name], line);
                        found_first_on_this_level = true;
                    }
                }
                "field_declaration" => {
                    self.extract_field_names(struct_name, &child);
                    found_first_on_this_level = false;
                }
                "field_declaration_list" | "embedded_field_list" => {
                    self.extract_fields_recursive(struct_name, &child);
                }
                _ => {}
            }
        }
    }

    fn extract_field_names(&mut self, struct_name: &str, node: &Node) {
        let mut cursor = node.walk();

        for child in node.children(&mut cursor) {
            if child.is_named() && child.kind() == "field_identifier" {
                let field_name = node_text(&child, &self.source);
                if !field_name.is_empty() {
                    let line = self.lines.line_of(&child);
                    self.facts
                        .symbol(vec![struct_name.to_owned(), field_name], line);
                }
            }
        }
    }

    fn extract_interface_methods(&mut self, interface_name: &str, node: &Node) {
        self.extract_methods_recursive(interface_name, node);
    }

    fn extract_methods_recursive(&mut self, interface_name: &str, node: &Node) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if !child.is_named() {
                continue;
            }

            if child.kind() == "method_elem"
                && let Some(name_node) = child.child_by_field_name("name")
            {
                let method_name = node_text(&name_node, &self.source);
                if !method_name.is_empty() {
                    let line = self.lines.line_of(&name_node);
                    self.facts
                        .symbol(vec![interface_name.to_owned(), method_name], line);
                }
            }
        }
    }

    fn const_declaration(&mut self, node: &Node) {
        self.const_or_var_declaration(node);
    }

    fn var_declaration(&mut self, node: &Node) {
        self.const_or_var_declaration(node);
    }

    fn const_or_var_declaration(&mut self, node: &Node) {
        let mut cursor = node.walk();
        let children: Vec<Node> = node.children(&mut cursor).collect();
        for child in &children {
            if !child.is_named() {
                continue;
            }
            match child.kind() {
                "const_spec" | "var_spec" => self.const_or_var_spec(child),
                "const_spec_list" | "var_spec_list" => self.const_or_var_declaration(child),
                _ => {}
            }
        }
    }

    fn const_or_var_spec(&mut self, node: &Node) {
        let mut cursor = node.walk();
        let names: Vec<Node> = node.children_by_field_name("name", &mut cursor).collect();
        let mut values = node.walk();
        let values: Vec<Node> = node.children_by_field_name("value", &mut values).collect();
        for (index, name_node) in names.iter().enumerate() {
            let name = node_text(name_node, &self.source);
            let line = self.lines.line_of(name_node);
            let path = vec![name];
            self.facts.symbol(path.clone(), line);
            let value = match values.len() {
                1 if names.len() == 1 => values.first(),
                _ => values.get(index),
            };
            if let Some(value_node) = value {
                self.value(path, line, value_node);
            }
        }
    }

    fn value(&mut self, path: Vec<String>, line: usize, node: &Node) {
        if self.try_extract_value(&path, line, node) {
            return;
        }

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.is_named() {
                if self.try_extract_value(&path, line, &child) {
                    return;
                }

                if child.kind() == "literal_value" || child.kind() == "literal_element" {
                    let mut inner_cursor = child.walk();
                    for inner_child in child.children(&mut inner_cursor) {
                        if inner_child.is_named()
                            && self.try_extract_value(&path, line, &inner_child)
                        {
                            return;
                        }
                    }
                }
            }
        }

        self.facts.unreadable_value(path, line);
    }

    fn try_extract_value(&mut self, path: &[String], line: usize, node: &Node) -> bool {
        match node.kind() {
            "interpreted_string_literal" | "raw_string_literal" | "rune_literal" => {
                if let Some(literal) = self.extract_string_literal(node) {
                    self.facts.collection(path.to_vec(), line, vec![literal]);
                }
                true
            }
            "int_literal" | "float_literal" | "imaginary_literal" => {
                if let Ok(value) = node_text(node, &self.source).parse::<i64>() {
                    self.facts
                        .collection(path.to_vec(), line, vec![Literal::Int(value)]);
                }
                true
            }
            k if k == "true" || k == "false" => {
                let value = k == "true";
                self.facts
                    .collection(path.to_vec(), line, vec![Literal::Bool(value)]);
                true
            }
            "composite_literal" => {
                self.extract_composite_literal(path, line, node);
                true
            }
            "literal_value" => {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.is_named() && self.try_extract_value(path, line, &child) {
                        return true;
                    }
                }
                false
            }
            _ => false,
        }
    }

    fn extract_string_literal(&self, node: &Node) -> Option<Literal> {
        let text = node_text(node, &self.source);
        let unquoted = super::treesitter::unquote(&text);
        Some(Literal::Str(unquoted.to_owned()))
    }

    fn extract_composite_literal(&mut self, path: &[String], line: usize, node: &Node) {
        if let Some(body_node) = node.child_by_field_name("body") {
            let mut cursor = body_node.walk();
            let mut has_keyed = false;
            let mut has_values = false;

            for child in body_node.children(&mut cursor) {
                if !child.is_named() {
                    continue;
                }
                if child.kind() == "keyed_element" {
                    has_keyed = true;
                } else if child.kind() != "{" && child.kind() != "}" && child.kind() != "," {
                    has_values = true;
                }
            }

            if has_keyed {
                self.extract_map_entries(path, line, &body_node);
            } else if has_values {
                self.extract_array_pair_entries(path, line, &body_node);
                self.extract_collection_elements(path, line, &body_node);
            }
        }
    }

    fn extract_collection_elements(&mut self, path: &[String], line: usize, node: &Node) {
        let mut values = Vec::new();
        let mut cursor = node.walk();
        let mut has_complex_element = false;

        for child in node.children(&mut cursor) {
            if !child.is_named()
                || child.kind() == "{"
                || child.kind() == "}"
                || child.kind() == ","
            {
                continue;
            }

            if child.kind() == "literal_element" {
                if let Some(literal) = self.extract_literal_from_element(&child) {
                    values.push(literal);
                } else {
                    has_complex_element = true;
                    break;
                }
            } else if let Some(literal) = self.extract_literal(&child) {
                values.push(literal);
            } else {
                has_complex_element = true;
                break;
            }
        }

        if has_complex_element {
            return;
        }

        if !values.is_empty() {
            self.facts.collection(path.to_vec(), line, values);
        }
    }

    fn extract_array_pair_entries(&mut self, path: &[String], line: usize, node: &Node) {
        let mut cursor = node.walk();

        for child in node.children(&mut cursor) {
            if !child.is_named()
                || child.kind() == "{"
                || child.kind() == "}"
                || child.kind() == ","
            {
                continue;
            }

            if let Some((key, values)) = self.extract_pair(&child) {
                self.facts.entry(path.to_vec(), key, line, values);
            }
        }
    }

    fn extract_pair(&self, node: &Node) -> Option<(Literal, Option<Vec<Literal>>)> {
        let pair_node = self.get_pair_composite(node)?;

        let body = if pair_node.kind() == "composite_literal" {
            pair_node.child_by_field_name("body")?
        } else if pair_node.kind() == "literal_value" {
            pair_node
        } else {
            return None;
        };

        let mut literals = Vec::new();
        let mut cursor = body.walk();

        for child in body.children(&mut cursor) {
            if !child.is_named()
                || child.kind() == "{"
                || child.kind() == "}"
                || child.kind() == ","
            {
                continue;
            }

            let lit = self.extract_any_literal(&child);

            if let Some(l) = lit {
                literals.push(l);
            }
        }

        if literals.len() >= 2 {
            let key = literals.remove(0);
            return Some((key, Some(literals)));
        } else if literals.len() == 1 {
            let key = literals.remove(0);
            return Some((key, None));
        }
        None
    }

    fn get_pair_composite<'b>(&self, node: &Node<'b>) -> Option<Node<'b>> {
        if node.kind() == "literal_element" {
            let mut cursor = node.walk();
            node.children(&mut cursor).find(|child| {
                child.is_named()
                    && (child.kind() == "composite_literal" || child.kind() == "literal_value")
            })
        } else if node.kind() == "composite_literal" || node.kind() == "literal_value" {
            Some(*node)
        } else {
            None
        }
    }

    fn extract_any_literal(&self, node: &Node) -> Option<Literal> {
        match node.kind() {
            "literal_element" | "literal_value" => {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.is_named()
                        && let Some(lit) = self.extract_any_literal(&child)
                    {
                        return Some(lit);
                    }
                }
                None
            }
            _ => self.extract_literal(node),
        }
    }

    fn extract_literal_from_element(&self, element: &Node) -> Option<Literal> {
        let mut cursor = element.walk();
        for child in element.children(&mut cursor) {
            if child.is_named()
                && let Some(lit) = self.extract_literal(&child)
            {
                return Some(lit);
            }
        }
        None
    }

    fn extract_map_entries(&mut self, path: &[String], line: usize, node: &Node) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if !child.is_named() || child.kind() != "keyed_element" {
                continue;
            }

            if let Some(key_node) = child.child_by_field_name("key") {
                let key_elem = if key_node.kind() == "literal_element" {
                    self.extract_literal_from_element(&key_node)
                } else {
                    self.extract_literal(&key_node)
                };

                if let Some(key) = key_elem
                    && let Some(value_node) = child.child_by_field_name("value")
                {
                    let values = if value_node.kind() == "literal_element" {
                        self.extract_value_as_literals_from_element(&value_node)
                    } else {
                        self.extract_value_as_literals(&value_node)
                    };
                    self.facts.entry(path.to_vec(), key, line, values);
                }
            }
        }
    }

    fn extract_value_as_literals_from_element(&self, element: &Node) -> Option<Vec<Literal>> {
        let mut cursor = element.walk();
        for child in element.children(&mut cursor) {
            if child.is_named() {
                return self.extract_value_as_literals(&child);
            }
        }
        None
    }

    fn extract_literal(&self, node: &Node) -> Option<Literal> {
        match node.kind() {
            "interpreted_string_literal" | "raw_string_literal" | "rune_literal" => {
                self.extract_string_literal(node)
            }
            "int_literal" | "float_literal" | "imaginary_literal" => node_text(node, &self.source)
                .parse::<i64>()
                .ok()
                .map(Literal::Int),
            "true" => Some(Literal::Bool(true)),
            "false" => Some(Literal::Bool(false)),
            _ => None,
        }
    }

    fn extract_value_as_literals(&self, node: &Node) -> Option<Vec<Literal>> {
        match node.kind() {
            "interpreted_string_literal" | "raw_string_literal" | "rune_literal" => {
                self.extract_literal(node).map(|l| vec![l])
            }
            "int_literal" | "float_literal" | "imaginary_literal" => {
                self.extract_literal(node).map(|l| vec![l])
            }
            k if k == "true" || k == "false" => self.extract_literal(node).map(|l| vec![l]),
            "composite_literal" => {
                let mut values = Vec::new();
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.is_named() && child.kind() != "keyed_element" {
                        let lit = if child.kind() == "literal_element" {
                            self.extract_literal_from_element(&child)
                        } else {
                            self.extract_literal(&child)
                        };
                        values.push(lit?);
                    }
                }
                if !values.is_empty() {
                    Some(values)
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    fn import_declaration(&mut self, node: &Node) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if !child.is_named() {
                continue;
            }
            match child.kind() {
                "import_spec" => self.import_spec(&child),
                "import_spec_list" => {
                    let mut list_cursor = child.walk();
                    for spec in child.children(&mut list_cursor) {
                        if spec.is_named() && spec.kind() == "import_spec" {
                            self.import_spec(&spec);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn import_spec(&mut self, node: &Node) {
        let Some(path_node) = node.child_by_field_name("path") else {
            return;
        };
        let text = node_text(&path_node, &self.source);
        let import_path = super::treesitter::unquote(&text).to_owned();
        let line = self.lines.line_of(node);
        self.resolve_import(&import_path, line);
    }

    fn resolve_import(&mut self, import_path: &str, line: usize) {
        if let Some((base, inside)) = self.inside_this_module(import_path) {
            let mut directory = base;
            for part in inside.split('/').filter(|part| !part.is_empty()) {
                directory.push(part);
            }
            let declared: Vec<String> = self
                .neighbourhood
                .in_directory(&directory)
                .into_iter()
                .filter_map(|module| self.neighbourhood.dotted(module))
                .collect();
            if !declared.is_empty() {
                for name in declared {
                    self.facts.import(name, line);
                }
                return;
            }
        }

        self.facts.import(import_path.to_owned(), line);
    }

    fn inside_this_module(&self, import_path: &str) -> Option<(PathBuf, String)> {
        let (directory, module_path) = self.nearest_go_mod()?;
        if import_path == module_path {
            return Some((directory, String::new()));
        }
        import_path
            .strip_prefix(&format!("{module_path}/"))
            .map(|inside| (directory, inside.to_owned()))
    }

    fn nearest_go_mod(&self) -> Option<(PathBuf, String)> {
        let mut directory = self.file_path.parent()?.to_path_buf();
        loop {
            if let Some(module_path) = declared_module_path(&directory) {
                return Some((directory, module_path));
            }
            if directory == self.root {
                return None;
            }
            directory = directory.parent()?.to_path_buf();
        }
    }

    fn emit_same_package_unknowns(&mut self) {
        let siblings = self.neighbourhood.siblings_of(&self.file_path);
        for sibling in siblings {
            if sibling.path != self.file_path {
                let sibling_dotted = self
                    .neighbourhood
                    .dotted(sibling)
                    .unwrap_or_else(|| sibling.stem());
                let form = "Go files in one package reference each other without an import; whether this file uses that file cannot be decided statically".to_owned();
                self.facts
                    .unknown_import(form, self.first_statement_line(), Some(sibling_dotted));
            }
        }
    }

    fn first_statement_line(&self) -> usize {
        self.package_line
    }
}

fn declared_module_path(directory: &Path) -> Option<String> {
    let content = std::fs::read_to_string(directory.join("go.mod")).ok()?;
    content
        .lines()
        .find_map(|line| line.strip_prefix("module "))
        .map(|rest| rest.trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn module(root: &Path, name: &str, relative: &str) -> ModuleDecl {
        ModuleDecl {
            name: name.to_owned(),
            display: format!("{name} ({relative})"),
            path: root.join(relative),
            location: crate::diagnostic::Location {
                file: "test".to_owned(),
                line: 1,
                column: 0,
            },
        }
    }

    fn write(root: &Path, relative: &str, text: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn inspect_one(root: &Path, decl: &ModuleDecl) -> ModuleFacts {
        GoProvider
            .inspect(root, &[decl])
            .unwrap()
            .remove(&decl.key())
            .unwrap()
    }

    #[test]
    fn a_missing_file_exists_false_without_an_error() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        let decl = module(root, "m", "missing.go");
        let facts = inspect_one(root, &decl);
        assert!(!facts.exists);
        assert!(facts.error.is_none());
    }

    #[test]
    fn a_file_that_does_not_parse_sets_an_error_with_a_line() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "broken.go", "package main\n\nfunc broken( {\n\n");
        let decl = module(root, "m", "broken.go");
        let facts = inspect_one(root, &decl);
        assert!(facts.exists);
        assert!(facts.error.is_some());
        let error = facts.error.unwrap();
        assert!(
            error.contains("line"),
            "error message should mention the line: {error}"
        );
    }

    #[test]
    fn top_level_and_member_symbols_are_reported() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "symbols.go",
            "package main\n\nfunc MyFunc() {}\n\ntype MyStruct struct {\n  Field1 string\n}\n\ntype MyInterface interface {\n  Method1()\n}\n\nconst MyConst = 1\n\nvar MyVar = 2\n",
        );
        let decl = module(root, "m", "symbols.go");
        let facts = inspect_one(root, &decl);
        assert!(facts.exists);
        assert!(facts.error.is_none());

        let names: Vec<Vec<String>> = facts.symbols.iter().map(|s| s.path.clone()).collect();
        assert!(
            names.contains(&vec!["MyFunc".to_owned()]),
            "should have MyFunc; got {:?}",
            names
        );
        assert!(
            names.contains(&vec!["MyStruct".to_owned()]),
            "should have MyStruct; got {:?}",
            names
        );
        assert!(
            names.contains(&vec!["MyInterface".to_owned()]),
            "should have MyInterface; got {:?}",
            names
        );
        assert!(
            names.contains(&vec!["MyConst".to_owned()]),
            "should have MyConst; got {:?}",
            names
        );
        assert!(
            names.contains(&vec!["MyVar".to_owned()]),
            "should have MyVar; got {:?}",
            names
        );
    }

    #[test]
    fn struct_fields_and_interface_methods_are_reported() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "types.go",
            "package main\n\ntype Storage struct {\n  Path string\n  Size int\n}\n\ntype Reader interface {\n  Read(p []byte) (n int, err error)\n  Close() error\n}\n",
        );
        let decl = module(root, "m", "types.go");
        let facts = inspect_one(root, &decl);

        let names: Vec<Vec<String>> = facts.symbols.iter().map(|s| s.path.clone()).collect();
        assert!(
            names.contains(&vec!["Storage".to_owned(), "Path".to_owned()]),
            "should have Storage.Path; got {:?}",
            names
        );
        assert!(
            names.contains(&vec!["Storage".to_owned(), "Size".to_owned()]),
            "should have Storage.Size; got {:?}",
            names
        );
        assert!(
            names.contains(&vec!["Reader".to_owned(), "Read".to_owned()]),
            "should have Reader.Read; got {:?}",
            names
        );
        assert!(
            names.contains(&vec!["Reader".to_owned(), "Close".to_owned()]),
            "should have Reader.Close; got {:?}",
            names
        );
    }

    #[test]
    fn methods_with_receivers_are_reported() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "methods.go",
            "package main\n\ntype Storage struct {}\n\nfunc (s *Storage) Save() error { return nil }\nfunc (r Reader) Read() ([]byte, error) { return nil, nil }\n",
        );
        let decl = module(root, "m", "methods.go");
        let facts = inspect_one(root, &decl);

        let names: Vec<Vec<String>> = facts.symbols.iter().map(|s| s.path.clone()).collect();
        assert!(
            names.contains(&vec!["Storage".to_owned(), "Save".to_owned()]),
            "should have Storage.Save; got {:?}",
            names
        );
        assert!(
            names.contains(&vec!["Reader".to_owned(), "Read".to_owned()]),
            "should have Reader.Read; got {:?}",
            names
        );
    }

    #[test]
    fn a_grouped_var_block_reports_every_name_and_its_value() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "grouped.go",
            "package main\n\nvar (\n\tAlpha = 1\n\tAllowed = []string{\"read\", \"write\"}\n)\n\nconst (\n\tCeiling = 9\n)\n",
        );
        let decl = module(root, "m", "grouped.go");
        let facts = inspect_one(root, &decl);
        let has = |name: &str| {
            facts
                .symbols
                .iter()
                .any(|s| s.path == vec![name.to_owned()])
        };

        assert!(has("Alpha"), "got {:?}", facts.symbols);
        assert!(has("Allowed"), "got {:?}", facts.symbols);
        assert!(has("Ceiling"), "got {:?}", facts.symbols);
        assert!(
            facts
                .collections
                .iter()
                .any(|c| c.path == vec!["Allowed".to_owned()]
                    && c.values.contains(&Literal::Str("read".to_owned()))),
            "got {:?}",
            facts.collections
        );
    }

    #[test]
    fn a_spec_declaring_several_names_reports_all_of_them() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "multi.go",
            "package main\n\nvar Alpha, Beta = 1, 2\n\nconst First, Second = \"a\", \"b\"\n",
        );
        let decl = module(root, "m", "multi.go");
        let facts = inspect_one(root, &decl);
        let has = |name: &str| {
            facts
                .symbols
                .iter()
                .any(|s| s.path == vec![name.to_owned()])
        };

        for name in ["Alpha", "Beta", "First", "Second"] {
            assert!(has(name), "{name} missing; got {:?}", facts.symbols);
        }
    }

    #[test]
    fn an_aliased_or_blank_import_is_still_the_path_it_names() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "aliased.go",
            "package main\n\nimport (\n\t_ \"github.com/lib/pq\"\n\tj \"encoding/json\"\n\t. \"strings\"\n)\n\nfunc main() {}\n",
        );
        let decl = module(root, "m", "aliased.go");
        let facts = inspect_one(root, &decl);
        let named = |name: &str| facts.imports.iter().any(|import| import.name == name);

        assert!(named("github.com/lib/pq"), "got {:?}", facts.imports);
        assert!(named("encoding/json"), "got {:?}", facts.imports);
        assert!(named("strings"), "got {:?}", facts.imports);
        assert!(!named("_"), "the local alias is not the dependency");
        assert!(!named("j"), "the local alias is not the dependency");
        assert!(!named("."), "the local alias is not the dependency");
    }

    #[test]
    fn an_external_import_is_reported_verbatim() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "single.go",
            "package main\n\nimport \"fmt\"\nimport \"encoding/json\"\n\nfunc main() {}\n",
        );
        let decl = module(root, "m", "single.go");
        let facts = inspect_one(root, &decl);

        assert!(
            facts.imports.iter().any(|i| i.name == "fmt"),
            "single form should have fmt import; got {:?}",
            facts.imports
        );
        assert!(
            facts.imports.iter().any(|i| i.name == "encoding/json"),
            "single form should have encoding/json import; got {:?}",
            facts.imports
        );
    }

    #[test]
    fn grouped_external_imports_are_reported() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "grouped.go",
            "package main\n\nimport (\n\t\"encoding/json\"\n\t\"fmt\"\n)\n\nfunc main() {}\n",
        );
        let decl = module(root, "m", "grouped.go");
        let facts = inspect_one(root, &decl);

        assert!(
            facts.imports.iter().any(|i| i.name == "fmt"),
            "grouped form should have fmt import; got {:?}",
            facts.imports
        );
        assert!(
            facts.imports.iter().any(|i| i.name == "encoding/json"),
            "grouped form should have encoding/json import; got {:?}",
            facts.imports
        );
    }

    #[test]
    fn an_internal_import_resolves_to_a_declared_sibling_module() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "go.mod", "module github.com/example/project\n");
        write(
            root,
            "main.go",
            "package main\n\nimport \"github.com/example/project/pkg\"\n\nfunc main() {}\n",
        );
        write(root, "pkg/lib.go", "package pkg\n\nfunc Help() {}\n");
        let importer = module(root, "main", "main.go");
        let sibling = module(root, "pkg", "pkg/lib.go");
        let facts = GoProvider
            .inspect(root, &[&importer, &sibling])
            .unwrap()
            .remove(&importer.key())
            .unwrap();

        let observable = super::super::dotted(root, &sibling.path).unwrap();
        assert!(
            facts.imports.iter().any(|i| i.name == observable),
            "the import must be reported under the name the evaluator matches ({observable}); got {:?}",
            facts.imports
        );
    }

    #[test]
    fn an_internal_import_resolves_through_a_go_mod_below_the_project_root() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "go/go.mod", "module github.com/example/project\n");
        write(
            root,
            "go/app/main.go",
            "package app\n\nimport \"github.com/example/project/store\"\n\nfunc Run() { _ = store.Open }\n",
        );
        write(root, "go/store/db.go", "package store\n\nfunc Open() {}\n");
        let importer = module(root, "goapp", "go/app/main.go");
        let target = module(root, "gostore", "go/store/db.go");
        let facts = GoProvider
            .inspect(root, &[&importer, &target])
            .unwrap()
            .remove(&importer.key())
            .unwrap();

        let observable = super::super::dotted(root, &target.path).unwrap();
        assert!(
            facts.imports.iter().any(|i| i.name == observable),
            "a go.mod below the project root must still make the import internal ({observable}); got {:?}",
            facts.imports
        );
    }

    #[test]
    fn grouped_internal_import_with_same_package_sibling() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "go.mod", "module github.com/example/project\n");
        write(
            root,
            "main.go",
            "package main\n\nimport (\n\t\"github.com/example/project/pkg\"\n\t\"fmt\"\n)\n\nfunc main() { _ = Help }\n",
        );
        write(root, "pkg/lib.go", "package pkg\n\nfunc Help() {}\n");
        let importer = module(root, "main", "main.go");
        let sibling = module(root, "pkg", "pkg/lib.go");
        let facts = GoProvider
            .inspect(root, &[&importer, &sibling])
            .unwrap()
            .remove(&importer.key())
            .unwrap();

        let observable = super::super::dotted(root, &sibling.path).unwrap();
        assert!(
            facts.imports.iter().any(|i| i.name == observable),
            "the grouped form must report the name the evaluator matches ({observable}); got {:?}",
            facts.imports
        );
        assert!(
            facts.imports.iter().any(|i| i.name == "fmt"),
            "grouped form should also have fmt import; got {:?}",
            facts.imports
        );
    }

    #[test]
    fn a_same_package_sibling_produces_a_scoped_unknown() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.go", "package main\n\nfunc main() {}\n");
        write(root, "helper.go", "package main\n\nfunc Helper() {}\n");
        let main_file = module(root, "main", "main.go");
        let helper_file = module(root, "helper", "helper.go");
        let facts = GoProvider
            .inspect(root, &[&main_file, &helper_file])
            .unwrap()
            .remove(&main_file.key())
            .unwrap();

        let unresolved = &facts.unresolved_imports;
        assert!(!unresolved.is_empty(), "should have unresolved import");
        assert!(
            unresolved[0].covers == Some("helper".to_owned()),
            "should cover helper; got {:?}",
            unresolved
        );
    }

    #[test]
    fn a_slice_literal_becomes_a_collection() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "values.go",
            "package main\n\nvar Allowed = []string{\"read\", \"write\", \"delete\"}\n",
        );
        let decl = module(root, "m", "values.go");
        let facts = inspect_one(root, &decl);

        let collections: Vec<&crate::structure::CollectionFact> = facts
            .collections
            .iter()
            .filter(|c| c.path == vec!["Allowed".to_owned()])
            .collect();
        assert!(!collections.is_empty(), "should have Allowed collection");
        let col = collections[0];
        assert_eq!(col.values.len(), 3);
        assert!(
            col.values
                .contains(&crate::structure::Literal::Str("read".to_owned()))
        );
    }

    #[test]
    fn a_map_literal_becomes_entries() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "mapping.go",
            "package main\n\nvar Config = map[string]string{\n  \"host\": \"localhost\",\n  \"port\": \"8080\",\n}\n",
        );
        let decl = module(root, "m", "mapping.go");
        let facts = inspect_one(root, &decl);

        let entries: Vec<&crate::structure::EntryFact> = facts
            .entries
            .iter()
            .filter(|e| e.path == vec!["Config".to_owned()])
            .collect();
        assert!(!entries.is_empty(), "should have Config entries");
        assert!(
            entries
                .iter()
                .any(|e| e.key == crate::structure::Literal::Str("host".to_owned()))
        );
    }

    #[test]
    fn a_non_literal_initializer_lands_in_unsupported() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "unreadable.go",
            "package main\n\nfunc GetValue() string { return \"value\" }\n\nvar Dynamic = GetValue()\n",
        );
        let decl = module(root, "m", "unreadable.go");
        let facts = inspect_one(root, &decl);

        assert!(
            facts
                .unsupported
                .iter()
                .any(|u| u.path == vec!["Dynamic".to_owned()]),
            "should report Dynamic as unsupported; got {:?}",
            facts.unsupported
        );
    }

    #[test]
    fn a_plain_scalar_initializer_is_not_unsupported() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "scalar.go",
            "package main\n\nvar Name = \"John\"\nvar Count = 42\nvar Flag = true\n",
        );
        let decl = module(root, "m", "scalar.go");
        let facts = inspect_one(root, &decl);

        assert!(
            !facts
                .unsupported
                .iter()
                .any(|u| u.path == vec!["Name".to_owned()]),
            "scalar should not be unsupported; got {:?}",
            facts.unsupported
        );
    }

    #[test]
    fn array_of_pairs_becomes_entries() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "pairs.go",
            "package main\n\nvar Pairs = [][2]string{{\"read\", \"allowed\"}, {\"write\", \"denied\"}}\n",
        );
        let decl = module(root, "m", "pairs.go");
        let facts = inspect_one(root, &decl);

        assert!(
            facts
                .entries
                .iter()
                .any(|e| e.path == vec!["Pairs".to_owned()]
                    && e.key == crate::structure::Literal::Str("read".to_owned())),
            "should have Pairs[\"read\"] entry; got {:?}",
            facts.entries
        );
        assert!(
            facts
                .entries
                .iter()
                .any(|e| e.path == vec!["Pairs".to_owned()]
                    && e.key == crate::structure::Literal::Str("write".to_owned())),
            "should have Pairs[\"write\"] entry; got {:?}",
            facts.entries
        );
    }

    #[test]
    fn entry_with_unreadable_payload_records_none() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "unreadable.go",
            "package main\n\nfunc GetValue() string { return \"value\" }\n\nvar Config = map[string]string{\"key\": GetValue()}\n",
        );
        let decl = module(root, "m", "unreadable.go");
        let facts = inspect_one(root, &decl);

        let key_entry = facts.entries.iter().find(|e| {
            e.path == vec!["Config".to_owned()]
                && e.key == crate::structure::Literal::Str("key".to_owned())
        });

        assert!(key_entry.is_some(), "should have entry for key \"key\"");
        assert!(
            key_entry.unwrap().values.is_none(),
            "unreadable payload should be None, not dropped"
        );
    }
}
