use super::treesitter::{Facts, LineIndex, node_text};
use super::{
    Entry, Literal, ModuleDecl, ModuleFacts, Provider, ProviderFailure, dotted, normalize,
};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tree_sitter::{Node, Tree};

pub const PROVIDER_ID: &str = "typescript";

pub const EXTENSIONS: [&str; 6] = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];

pub struct TypeScriptProvider;

impl Provider for TypeScriptProvider {
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
            .map(|module| (module.key(), inspect_module(root, module)))
            .collect())
    }

    fn external_target_error(&self, target: &str) -> Option<String> {
        if target.is_empty() {
            return Some(
                "an external target cannot be empty; it is a package name, such as \"react\" or \"@scope/pkg\", optionally followed by a subpath"
                    .to_owned(),
            );
        }
        if target.starts_with("./") || target.starts_with("../") {
            return Some(format!(
                "{target:?} names a module inside this project, not an external package; declare it with `module` and write `dependency <from> -> <name>`"
            ));
        }
        None
    }
}

fn inspect_module(root: &Path, module: &ModuleDecl) -> ModuleFacts {
    let language = select_language(&module.path);
    super::treesitter::inspect_module(module, &language, |source, tree| {
        Scan::new(root, &module.path, source).run(tree)
    })
}

fn select_language(path: &Path) -> tree_sitter::Language {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "tsx" | "jsx" => tree_sitter_typescript::LANGUAGE_TSX.into(),
        _ => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
    }
}

struct Scan {
    root: PathBuf,
    directory: PathBuf,
    source: String,
    lines: LineIndex,
    facts: Facts,
}

impl Scan {
    fn new(root: &Path, file: &Path, source: &str) -> Scan {
        let file = normalize(file);
        let root = normalize(root);
        let directory = file.parent().unwrap_or(&root).to_path_buf();
        Scan {
            root,
            directory,
            source: source.to_string(),
            lines: LineIndex::new(source),
            facts: Facts::default(),
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

        self.facts
    }

    fn top_level_statement(&mut self, node: &Node) {
        self.requires_in_statement(node);

        match node.kind() {
            "lexical_declaration" | "variable_declaration" => self.variable_declaration(node),
            "function_declaration" => self.function_declaration(node),
            "class_declaration" => self.class_declaration(node),
            "type_alias_declaration" => self.type_alias_declaration(node),
            "interface_declaration" => self.interface_declaration(node),
            "enum_declaration" => self.enum_declaration(node),
            "import_statement" => self.import_declaration(node),
            "export_statement" => self.handle_export_statement(node),
            _ => {}
        }
    }

    fn handle_export_statement(&mut self, node: &Node) {
        if is_export_all(node) {
            self.export_all(node);
        } else if is_export_default(node) {
            self.export_default(node);
        } else {
            self.export_named(node);
        }
    }

    fn variable_declaration(&mut self, node: &Node) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            match child.kind() {
                "variable_declarator" => {
                    if let Some(name_node) = child.child_by_field_name("name") {
                        let name = node_text(&name_node, &self.source);
                        let line = self.lines.line_at(name_node.start_byte() as u32);
                        let path = vec![name];
                        self.symbol(path.clone(), line);

                        if let Some(value_node) = child.child_by_field_name("value") {
                            self.value(path, line, &value_node);
                        }
                    }
                }
                "identifier" | "object_pattern" | "array_pattern" => {
                    let name = node_text(&child, &self.source);
                    if !name.is_empty() && name != "const" && name != "let" && name != "var" {
                        let line = self.lines.line_at(child.start_byte() as u32);
                        let path = vec![name];
                        self.symbol(path.clone(), line);

                        if let Some(next_node) = child.next_sibling()
                            && next_node.kind() == "="
                            && let Some(value_node) = next_node.next_sibling()
                        {
                            self.value(path, line, &value_node);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn function_declaration(&mut self, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let name = node_text(&name_node, &self.source);
            let line = self.lines.line_at(name_node.start_byte() as u32);
            self.symbol(vec![name], line);
        }
    }

    fn class_declaration(&mut self, node: &Node) {
        let Some(name_node) = node.child_by_field_name("name") else {
            return;
        };
        let name = node_text(&name_node, &self.source);
        let line = self.lines.line_at(name_node.start_byte() as u32);
        self.symbol(vec![name.clone()], line);

        if let Some(body_node) = node.child_by_field_name("body") {
            let mut cursor = body_node.walk();
            for child in body_node.children(&mut cursor) {
                if !child.is_named() || child.kind() == "{" || child.kind() == "}" {
                    continue;
                }
                match child.kind() {
                    "method_definition" => {
                        if let Some(name_node) = child.child_by_field_name("name") {
                            let member = node_text(&name_node, &self.source);
                            let member_line = self.lines.line_at(name_node.start_byte() as u32);
                            self.symbol(vec![name.clone(), member], member_line);
                        }
                    }
                    "public_field_definition" => {
                        if let Some(name_node) = child.child_by_field_name("name") {
                            let member = node_text(&name_node, &self.source);
                            let member_line = self.lines.line_at(name_node.start_byte() as u32);
                            let path = vec![name.clone(), member];
                            self.symbol(path.clone(), member_line);

                            if let Some(value_node) = child.child_by_field_name("value") {
                                self.value(path, member_line, &value_node);
                            }
                        }
                    }
                    "property_signature" => {
                        if let Some(name_node) = child.child_by_field_name("name") {
                            let member = node_text(&name_node, &self.source);
                            let member_line = self.lines.line_at(name_node.start_byte() as u32);
                            let path = vec![name.clone(), member];
                            self.symbol(path.clone(), member_line);

                            if let Some(value_node) = child.child_by_field_name("value") {
                                self.value(path, member_line, &value_node);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    fn interface_declaration(&mut self, node: &Node) {
        let Some(name_node) = node.child_by_field_name("name") else {
            return;
        };
        let name = node_text(&name_node, &self.source);
        let line = self.lines.line_at(name_node.start_byte() as u32);
        self.symbol(vec![name.clone()], line);

        if let Some(body_node) = node.child_by_field_name("body") {
            let mut cursor = body_node.walk();
            for child in body_node.children(&mut cursor) {
                if !child.is_named() {
                    continue;
                }
                match child.kind() {
                    "property_signature" | "method_signature" => {
                        if let Some(name_node) = child.child_by_field_name("name") {
                            let member = node_text(&name_node, &self.source);
                            let member_line = self.lines.line_at(name_node.start_byte() as u32);
                            self.symbol(vec![name.clone(), member], member_line);
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    fn enum_declaration(&mut self, node: &Node) {
        let Some(name_node) = node.child_by_field_name("name") else {
            return;
        };
        let name = node_text(&name_node, &self.source);
        let line = self.lines.line_at(name_node.start_byte() as u32);
        self.symbol(vec![name.clone()], line);

        if let Some(body_node) = node.child_by_field_name("body") {
            let mut cursor = body_node.walk();
            for child in body_node.children(&mut cursor) {
                if !child.is_named() {
                    continue;
                }
                if child.kind() == "property_identifier" {
                    let member_name = node_text(&child, &self.source);
                    let member_line = self.lines.line_at(child.start_byte() as u32);
                    self.symbol(vec![name.clone(), member_name], member_line);
                }
            }
        }
    }

    fn type_alias_declaration(&mut self, node: &Node) {
        let Some(name_node) = node.child_by_field_name("name") else {
            return;
        };
        let name = node_text(&name_node, &self.source);
        let line = self.lines.line_at(name_node.start_byte() as u32);
        self.symbol(vec![name], line);
    }

    fn import_declaration(&mut self, node: &Node) {
        if let Some(source_node) = node.child_by_field_name("source") {
            let source_text = node_text(&source_node, &self.source);
            let source = source_text.trim_matches('"').trim_matches('\'');
            let line = self.lines.line_at(node.start_byte() as u32);
            self.record_source(source, line);
        }
    }

    fn export_all(&mut self, node: &Node) {
        if let Some(source_node) = node.child_by_field_name("source") {
            let source_text = node_text(&source_node, &self.source);
            let source = source_text.trim_matches('"').trim_matches('\'');
            let line = self.lines.line_at(node.start_byte() as u32);
            self.record_source(source, line);
        }
    }

    fn export_named(&mut self, node: &Node) {
        if let Some(source_node) = node.child_by_field_name("source") {
            let source_text = node_text(&source_node, &self.source);
            let source = source_text.trim_matches('"').trim_matches('\'');
            let line = self.lines.line_at(node.start_byte() as u32);
            self.record_source(source, line);
        }

        if let Some(declaration_node) = node.child_by_field_name("declaration") {
            self.top_level_statement(&declaration_node);
        }
    }

    fn export_default(&mut self, node: &Node) {
        if let Some(decl_node) = node.child_by_field_name("declaration") {
            match decl_node.kind() {
                "function_declaration" => self.function_declaration(&decl_node),
                "class_declaration" => self.class_declaration(&decl_node),
                "interface_declaration" => self.interface_declaration(&decl_node),
                _ => {}
            }
        }
    }

    fn symbol(&mut self, path: Vec<String>, line: usize) {
        self.facts.symbol(path, line);
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

    fn record_source(&mut self, specifier: &str, line: usize) {
        let name = if specifier.starts_with("./") || specifier.starts_with("../") {
            let Some(resolved) = self.resolve_relative(specifier) else {
                return;
            };
            let Some(name) = dotted(&self.root, &resolved) else {
                return;
            };
            name
        } else {
            specifier.to_owned()
        };
        self.facts.import(name, line);
    }

    fn resolve_relative(&self, specifier: &str) -> Option<PathBuf> {
        let joined = normalize(&self.directory.join(specifier));
        if joined.is_file() {
            return Some(joined);
        }
        let stem = match joined.extension().and_then(|extension| extension.to_str()) {
            Some(extension)
                if EXTENSIONS
                    .iter()
                    .any(|candidate| extension.eq_ignore_ascii_case(candidate)) =>
            {
                joined.with_extension("")
            }
            _ => joined.clone(),
        };
        for extension in EXTENSIONS {
            let candidate = stem.with_extension(extension);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        for extension in EXTENSIONS {
            let candidate = joined.join(format!("index.{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        None
    }

    fn requires_in_statement(&mut self, node: &Node) {
        match node.kind() {
            "block" | "statement_block" => {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.is_named() {
                        self.requires_in_statement(&child);
                    }
                }
            }
            "if_statement" => {
                if let Some(cond_node) = node.child_by_field_name("condition") {
                    self.requires_in_expression(&cond_node);
                }
                if let Some(cons_node) = node.child_by_field_name("consequence") {
                    self.requires_in_statement(&cons_node);
                }
                if let Some(alt_node) = node.child_by_field_name("alternative") {
                    self.requires_in_statement(&alt_node);
                }
            }
            "while_statement" => {
                if let Some(cond_node) = node.child_by_field_name("condition") {
                    self.requires_in_expression(&cond_node);
                }
                if let Some(body_node) = node.child_by_field_name("body") {
                    self.requires_in_statement(&body_node);
                }
            }
            "do_statement" => {
                if let Some(body_node) = node.child_by_field_name("body") {
                    self.requires_in_statement(&body_node);
                }
                if let Some(cond_node) = node.child_by_field_name("condition") {
                    self.requires_in_expression(&cond_node);
                }
            }
            "for_statement" => {
                if let Some(init_node) = node.child_by_field_name("init") {
                    self.requires_in_for_init(&init_node);
                }
                if let Some(cond_node) = node.child_by_field_name("condition") {
                    self.requires_in_expression(&cond_node);
                }
                if let Some(update_node) = node.child_by_field_name("update") {
                    self.requires_in_expression(&update_node);
                }
                if let Some(body_node) = node.child_by_field_name("body") {
                    self.requires_in_statement(&body_node);
                }
            }
            "for_in_statement" => {
                if let Some(left_node) = node.child_by_field_name("left") {
                    self.requires_in_for_left(&left_node);
                }
                if let Some(right_node) = node.child_by_field_name("right") {
                    self.requires_in_expression(&right_node);
                }
                if let Some(body_node) = node.child_by_field_name("body") {
                    self.requires_in_statement(&body_node);
                }
            }
            "switch_statement" => {
                if let Some(expr_node) = node.child_by_field_name("value") {
                    self.requires_in_expression(&expr_node);
                }
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "switch_case" || child.kind() == "switch_default" {
                        let mut case_cursor = child.walk();
                        for case_child in child.children(&mut case_cursor) {
                            if case_child.kind() == "case" {
                                self.requires_in_expression(&case_child);
                            } else if case_child.kind() != ":" {
                                self.requires_in_statement(&case_child);
                            }
                        }
                    }
                }
            }
            "try_statement" => {
                if let Some(body_node) = node.child_by_field_name("body") {
                    self.requires_in_statement(&body_node);
                }
                if let Some(catch_node) = node.child_by_field_name("handler")
                    && let Some(catch_body) = catch_node.child_by_field_name("body")
                {
                    self.requires_in_statement(&catch_body);
                }
                if let Some(finally_node) = node.child_by_field_name("finalizer") {
                    self.requires_in_statement(&finally_node);
                }
            }
            "variable_declaration" | "lexical_declaration" => {
                self.variable_declaration(node);
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "variable_declarator"
                        && let Some(init_node) = child.child_by_field_name("value")
                    {
                        self.requires_in_expression(&init_node);
                    }
                }
            }
            "function_declaration" => self.requires_in_function(node),
            "class_declaration" => self.requires_in_class(node),
            "enum_declaration" => {
                if let Some(body_node) = node.child_by_field_name("body") {
                    let mut cursor = body_node.walk();
                    for child in body_node.children(&mut cursor) {
                        if child.kind() == "enum_body_declaration"
                            && let Some(value_node) = child.child_by_field_name("value")
                        {
                            self.requires_in_expression(&value_node);
                        }
                    }
                }
            }
            "export_statement" => {
                if let Some(decl_node) = node.child_by_field_name("declaration") {
                    self.requires_in_statement(&decl_node);
                }
            }
            "expression_statement" => {
                if let Some(expr_node) = node.child_by_field_name("expression") {
                    self.requires_in_expression(&expr_node);
                }
            }
            "return_statement" => {
                if let Some(expr_node) = node.child_by_field_name("value") {
                    self.requires_in_expression(&expr_node);
                } else {
                    let mut cursor = node.walk();
                    for child in node.children(&mut cursor) {
                        if child.is_named() && child.kind() != "return" {
                            self.requires_in_expression(&child);
                        }
                    }
                }
            }
            "throw_statement" => {
                if let Some(expr_node) = node.child_by_field_name("value") {
                    self.requires_in_expression(&expr_node);
                }
            }
            "labeled_statement" => {
                if let Some(stmt_node) = node.child_by_field_name("body") {
                    self.requires_in_statement(&stmt_node);
                }
            }
            _ => {}
        }
    }

    fn requires_in_for_init(&mut self, node: &Node) {
        if node.kind() == "variable_declaration" {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "variable_declarator"
                    && let Some(init_node) = child.child_by_field_name("value")
                {
                    self.requires_in_expression(&init_node);
                }
            }
        } else {
            self.requires_in_expression(node);
        }
    }

    fn requires_in_for_left(&mut self, node: &Node) {
        if node.kind() == "variable_declaration" {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "variable_declarator"
                    && let Some(init_node) = child.child_by_field_name("value")
                {
                    self.requires_in_expression(&init_node);
                }
            }
        }
    }

    fn requires_in_function(&mut self, node: &Node) {
        if let Some(body_node) = node.child_by_field_name("body") {
            self.requires_in_statement(&body_node);
        }
    }

    fn requires_in_class(&mut self, node: &Node) {
        if let Some(body_node) = node.child_by_field_name("body") {
            let mut cursor = body_node.walk();
            for child in body_node.children(&mut cursor) {
                if !child.is_named() {
                    continue;
                }
                match child.kind() {
                    "method_definition" => {
                        if let Some(func_body) = child.child_by_field_name("value")
                            && let Some(stmt_body) = func_body.child_by_field_name("body")
                        {
                            self.requires_in_statement(&stmt_body);
                        }
                    }
                    "public_field_definition" => {
                        if let Some(value_node) = child.child_by_field_name("value") {
                            self.requires_in_expression(&value_node);
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    fn requires_in_call(&mut self, node: &Node) {
        if is_require_call(node, &self.source) {
            self.record_call_target(node, "require(...)");
        }

        if is_dynamic_import_call(node) {
            self.record_call_target(node, "import(...)");
        }

        if let Some(func_node) = node.child_by_field_name("function") {
            self.requires_in_expression(&func_node);
        }
        if let Some(args_node) = node.child_by_field_name("arguments") {
            let mut cursor = args_node.walk();
            for child in args_node.children(&mut cursor) {
                if child.is_named() && child.kind() != "arguments" {
                    self.requires_in_expression(&child);
                }
            }
        }
    }

    fn record_call_target(&mut self, node: &Node, form: &str) {
        let line = self.lines.line_at(node.start_byte() as u32);
        if let Some(args_node) = node.child_by_field_name("arguments") {
            let mut cursor = args_node.walk();
            for child in args_node.children(&mut cursor) {
                if child.kind() == "string" {
                    let text = node_text(&child, &self.source);
                    let trimmed = text.trim_matches('"').trim_matches('\'').trim_matches('`');
                    self.record_source(trimmed, line);
                    return;
                }
            }
        }
        self.facts.unknown_import(form.to_owned(), line, None);
    }

    fn requires_in_expression(&mut self, node: &Node) {
        match node.kind() {
            "call_expression" => self.requires_in_call(node),
            "new_expression" => {
                if let Some(constructor_node) = node.child_by_field_name("constructor") {
                    self.requires_in_expression(&constructor_node);
                }
                if let Some(args_node) = node.child_by_field_name("arguments") {
                    let mut cursor = args_node.walk();
                    for child in args_node.children(&mut cursor) {
                        if child.is_named() {
                            self.requires_in_expression(&child);
                        }
                    }
                }
            }
            "import" => {
                if let Some(source_node) = node.child_by_field_name("source") {
                    let text = node_text(&source_node, &self.source);
                    let trimmed = text.trim_matches('"').trim_matches('\'');
                    let line = self.lines.line_at(node.start_byte() as u32);
                    self.record_source(trimmed, line);
                }
                if let Some(options_node) = node.child_by_field_name("options") {
                    self.requires_in_expression(&options_node);
                }
            }
            "array" => {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.is_named() && child.kind() != ";" {
                        self.requires_in_expression(&child);
                    }
                }
            }
            "object" => {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "pair"
                        && let Some(value_node) = child.child_by_field_name("value")
                    {
                        self.requires_in_expression(&value_node);
                    }
                }
            }
            "arrow_function" => {
                if let Some(body_node) = node.child_by_field_name("body") {
                    if body_node.kind() == "block" {
                        self.requires_in_statement(&body_node);
                    } else {
                        self.requires_in_expression(&body_node);
                    }
                }
            }
            "function" => {
                if let Some(body_node) = node.child_by_field_name("body") {
                    self.requires_in_statement(&body_node);
                }
            }
            "class" => self.requires_in_class(node),
            "assignment_expression" => {
                if let Some(right_node) = node.child_by_field_name("right") {
                    self.requires_in_expression(&right_node);
                }
                if let Some(left_node) = node.child_by_field_name("left") {
                    self.requires_in_expression(&left_node);
                }
            }
            "await_expression" => {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() != "await" {
                        self.requires_in_expression(&child);
                    }
                }
            }
            "binary_expression" => {
                if let Some(left_node) = node.child_by_field_name("left") {
                    self.requires_in_expression(&left_node);
                }
                if let Some(right_node) = node.child_by_field_name("right") {
                    self.requires_in_expression(&right_node);
                }
            }
            "logical_expression" => {
                if let Some(left_node) = node.child_by_field_name("left") {
                    self.requires_in_expression(&left_node);
                }
                if let Some(right_node) = node.child_by_field_name("right") {
                    self.requires_in_expression(&right_node);
                }
            }
            "conditional_expression" => {
                if let Some(cond_node) = node.child_by_field_name("condition") {
                    self.requires_in_expression(&cond_node);
                }
                if let Some(cons_node) = node.child_by_field_name("consequence") {
                    self.requires_in_expression(&cons_node);
                }
                if let Some(alt_node) = node.child_by_field_name("alternative") {
                    self.requires_in_expression(&alt_node);
                }
            }
            "parenthesized_expression" => {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() != "(" && child.kind() != ")" {
                        self.requires_in_expression(&child);
                    }
                }
            }
            "sequence_expression" => {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.is_named() {
                        self.requires_in_expression(&child);
                    }
                }
            }
            "template_string" => {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "template_substitution" {
                        let mut sub_cursor = child.walk();
                        for sub_child in child.children(&mut sub_cursor) {
                            if sub_child.is_named() {
                                self.requires_in_expression(&sub_child);
                            }
                        }
                    }
                }
            }
            "unary_expression" => {
                if let Some(arg_node) = node.child_by_field_name("argument") {
                    self.requires_in_expression(&arg_node);
                }
            }
            "update_expression" => {
                if let Some(arg_node) = node.child_by_field_name("argument") {
                    self.requires_in_expression(&arg_node);
                }
            }
            "yield_expression" => {
                if let Some(arg_node) = node.child_by_field_name("argument") {
                    self.requires_in_expression(&arg_node);
                }
            }
            "member_expression" => {
                if let Some(obj_node) = node.child_by_field_name("object") {
                    self.requires_in_expression(&obj_node);
                }
                if let Some(prop_node) = node.child_by_field_name("property") {
                    self.requires_in_expression(&prop_node);
                }
            }
            _ => {}
        }
    }
}

fn is_export_all(node: &Node) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "export_star_specifier" {
            return true;
        }
    }
    false
}

fn is_export_default(node: &Node) -> bool {
    node_text(node, "").contains("default")
}

fn is_require_call(node: &Node, source: &str) -> bool {
    if node.kind() != "call_expression" {
        return false;
    }
    if let Some(func_node) = node.child_by_field_name("function")
        && func_node.kind() == "identifier"
    {
        let func_text = node_text(&func_node, source);
        return func_text == "require";
    }
    false
}

fn is_dynamic_import_call(node: &Node) -> bool {
    if node.kind() != "call_expression" {
        return false;
    }
    if let Some(func_node) = node.child_by_field_name("function") {
        return func_node.kind() == "import";
    }
    false
}

fn scalar(node: &Node, source: &str) -> Option<Literal> {
    let kind = node.kind();
    if matches!(kind, "as_expression" | "satisfies_expression") {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() != "as" && child.kind() != "satisfies" && child.is_named() {
                return scalar(&child, source);
            }
        }
    }

    match kind {
        "string" => {
            let text = node_text(node, source);
            let trimmed = text.trim_matches('"').trim_matches('\'').trim_matches('`');
            Some(Literal::Str(trimmed.to_string()))
        }
        "true" | "false" => Some(Literal::Bool(node_text(node, source) == "true")),
        "number" => {
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

fn readable_object_pairs<'a>(node: &Node<'a>) -> Option<Vec<Node<'a>>> {
    let mut pairs = Vec::new();
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if !child.is_named() {
            continue;
        }
        if child.kind() != "pair" {
            return None;
        }
        pairs.push(child);
    }
    Some(pairs)
}

fn literal_collection(node: &Node, source: &str) -> Option<Vec<Literal>> {
    let kind = node.kind();
    if matches!(kind, "as_expression" | "satisfies_expression") {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() != "as" && child.kind() != "satisfies" && child.is_named() {
                return literal_collection(&child, source);
            }
        }
    }

    match kind {
        "array" => {
            let mut values = Vec::new();
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() != "," && child.is_named() {
                    values.push(scalar(&child, source)?);
                }
            }
            Some(values)
        }
        "object" => {
            let mut values = Vec::new();
            for pair in readable_object_pairs(node)? {
                let key_node = pair.child_by_field_name("key")?;
                values.push(object_key_literal(&key_node, source)?);
            }
            if values.is_empty() && is_empty_object(node) {
                return Some(values);
            }
            if values.is_empty() {
                return None;
            }
            Some(values)
        }
        _ => None,
    }
}

fn object_key_literal(node: &Node, source: &str) -> Option<Literal> {
    match node.kind() {
        "property_identifier" => Some(Literal::Str(node_text(node, source))),
        "string" => {
            let text = node_text(node, source);
            let trimmed = text.trim_matches('"').trim_matches('\'');
            Some(Literal::Str(trimmed.to_string()))
        }
        "number" => {
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

fn is_empty_object(node: &Node) -> bool {
    node.child_count() <= 2
}

fn collection_entries(lines: &LineIndex, node: &Node, source: &str) -> Option<Vec<Entry>> {
    let kind = node.kind();
    if matches!(kind, "as_expression" | "satisfies_expression") {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() != "as" && child.kind() != "satisfies" && child.is_named() {
                return collection_entries(lines, &child, source);
            }
        }
    }

    match kind {
        "array" => {
            let mut entries = Vec::new();
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "array" {
                    let mut sub_cursor = child.walk();
                    let mut elements = Vec::new();
                    for sub_child in child.children(&mut sub_cursor) {
                        if sub_child.kind() != "," && sub_child.is_named() {
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
        "object" => {
            let mut entries = Vec::new();
            for pair in readable_object_pairs(node)? {
                let key_node = pair.child_by_field_name("key")?;
                let key = object_key_literal(&key_node, source)?;
                let value_node = pair.child_by_field_name("value")?;
                let line = lines.line_at(pair.start_byte() as u32);
                let value = expression_payload(&value_node, source);
                entries.push((line, key, value));
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
        TypeScriptProvider
            .inspect(root, &[declaration])
            .unwrap()
            .remove(&declaration.key())
            .unwrap()
    }

    #[test]
    fn a_missing_file_exists_false_without_an_error() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        let declaration = module(root, "m", "missing.ts");
        let facts = inspect_one(root, &declaration);
        assert!(!facts.exists);
        assert!(facts.error.is_none());
    }

    #[test]
    fn a_plain_object_literal_is_still_read_as_a_collection() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "m.ts",
            "export const GATES = { fmt: [\"fmt\"], clippy: [\"clippy\"] };\n",
        );
        let declaration = module(root, "m", "m.ts");
        let facts = inspect_one(root, &declaration);
        let path = vec!["GATES".to_owned()];
        let collection = facts
            .collections
            .iter()
            .find(|item| item.path == path)
            .expect("a wholly readable object is a collection");
        assert!(collection.values.contains(&Literal::Str("fmt".to_owned())));
        assert!(
            collection
                .values
                .contains(&Literal::Str("clippy".to_owned()))
        );
        assert!(facts.entries.iter().any(|entry| entry.path == path));
        assert!(!facts.unsupported.iter().any(|item| item.path == path));
    }

    #[test]
    fn a_dynamic_import_of_a_literal_path_is_still_resolved() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "m.ts",
            "export const load = () => import(\"node:fs\");\n",
        );
        let declaration = module(root, "m", "m.ts");
        let facts = inspect_one(root, &declaration);
        assert!(facts.imports.iter().any(|item| item.name == "node:fs"));
        assert!(facts.unresolved_imports.is_empty());
    }

    #[test]
    fn a_dynamic_import_of_an_expression_is_reported_as_unresolved() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "m.ts",
            "export function load(name: string) {\n    return import(name);\n}\n",
        );
        let declaration = module(root, "m", "m.ts");
        let facts = inspect_one(root, &declaration);
        assert!(facts.imports.is_empty());
        assert!(!facts.unresolved_imports.is_empty());
    }

    #[test]
    fn a_require_of_an_expression_is_reported_as_unresolved() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "m.js",
            "function load(name) {\n    return require(name);\n}\n",
        );
        let declaration = module(root, "m", "m.js");
        let facts = inspect_one(root, &declaration);
        assert!(facts.imports.is_empty());
        assert!(!facts.unresolved_imports.is_empty());
    }

    #[test]
    fn await_import_of_a_literal_path_is_still_resolved() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "m.ts",
            "export async function load() { return await import(\"node:fs\"); }\n",
        );
        let declaration = module(root, "m", "m.ts");
        let facts = inspect_one(root, &declaration);
        assert!(facts.imports.iter().any(|item| item.name == "node:fs"));
        assert!(facts.unresolved_imports.is_empty());
    }

    #[test]
    fn await_import_of_an_expression_is_reported_as_unresolved() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "m.ts",
            "export async function load(name: string) { return await import(name); }\n",
        );
        let declaration = module(root, "m", "m.ts");
        let facts = inspect_one(root, &declaration);
        assert!(facts.imports.is_empty());
        assert!(!facts.unresolved_imports.is_empty());
    }

    #[test]
    fn an_object_carrying_a_spread_is_unreadable_not_a_shorter_collection() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "m.ts",
            "const BASE = { clippy: [\"clippy\"] };\nexport const GATES = { ...BASE, fmt: [\"fmt\"] };\n",
        );
        let declaration = module(root, "m", "m.ts");
        let facts = inspect_one(root, &declaration);
        let path = vec!["GATES".to_owned()];
        assert!(!facts.collections.iter().any(|item| item.path == path));
        assert!(!facts.entries.iter().any(|entry| entry.path == path));
        assert!(facts.unsupported.iter().any(|item| item.path == path));
    }

    #[test]
    fn an_object_carrying_a_shorthand_property_is_unreadable() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "m.ts",
            "const fmt = [\"fmt\"];\nexport const GATES = { fmt, clippy: [\"clippy\"] };\n",
        );
        let declaration = module(root, "m", "m.ts");
        let facts = inspect_one(root, &declaration);
        let path = vec!["GATES".to_owned()];
        assert!(!facts.collections.iter().any(|item| item.path == path));
        assert!(!facts.entries.iter().any(|entry| entry.path == path));
        assert!(facts.unsupported.iter().any(|item| item.path == path));
    }

    #[test]
    fn a_file_that_does_not_parse_sets_an_error_with_a_line() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "broken.ts", "export const x = ;\n");
        let declaration = module(root, "m", "broken.ts");
        let facts = inspect_one(root, &declaration);
        assert!(facts.exists);
        let error = facts.error.expect("a syntax error was expected");
        assert!(error.contains("line"), "{error}");
    }

    #[test]
    fn top_level_and_member_symbols_are_reported() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.ts",
            "export function helper() {}\n\nexport class Service {\n    static id = 1;\n    run() {}\n}\n\ninterface Shape {\n    area(): number;\n}\n\nenum Color {\n    Red,\n}\n\ntype Alias = string;\n",
        );
        let declaration = module(root, "m", "app.ts");
        let facts = inspect_one(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|part| (*part).to_owned()).collect();
            facts.symbols.iter().any(|symbol| symbol.path == path)
        };
        assert!(has(&["helper"]));
        assert!(has(&["Service"]));
        assert!(has(&["Service", "id"]));
        assert!(has(&["Service", "run"]));
        assert!(has(&["Shape"]));
        assert!(has(&["Shape", "area"]));
        assert!(has(&["Color"]));
        assert!(has(&["Color", "Red"]));
        assert!(has(&["Alias"]));
    }

    #[test]
    fn a_relative_import_resolves_to_a_declared_sibling_module() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "src/sibling.ts", "export const value = 1;\n");
        write(
            root,
            "src/main.ts",
            "import { value } from \"./sibling\";\nexport const doubled = value * 2;\n",
        );
        let importer = module(root, "main", "src/main.ts");
        let sibling = module(root, "sibling", "src/sibling.ts");
        let facts = TypeScriptProvider
            .inspect(root, &[&importer, &sibling])
            .unwrap()
            .remove(&importer.key())
            .unwrap();
        assert!(
            facts
                .imports
                .iter()
                .any(|import| import.name == "src.sibling"),
            "{:?}",
            facts.imports
        );
    }

    #[test]
    fn an_external_package_import_is_reported_verbatim() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.ts",
            "import debounce from \"@scope/pkg/sub\";\nexport const used = debounce;\n",
        );
        let declaration = module(root, "m", "app.ts");
        let facts = inspect_one(root, &declaration);
        assert!(
            facts
                .imports
                .iter()
                .any(|import| import.name == "@scope/pkg/sub"),
            "{:?}",
            facts.imports
        );
    }

    #[test]
    fn a_literal_array_becomes_a_collection() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.ts",
            "export const LIST = [\"a\", \"b\", 3] as const;\n",
        );
        let declaration = module(root, "m", "app.ts");
        let facts = inspect_one(root, &declaration);
        let collection = facts
            .collections
            .iter()
            .find(|collection| collection.path == vec!["LIST".to_owned()])
            .expect("LIST should be a literal collection");
        assert_eq!(
            collection.values,
            vec![
                Literal::Str("a".to_owned()),
                Literal::Str("b".to_owned()),
                Literal::Int(3),
            ]
        );
    }

    #[test]
    fn an_object_literal_is_read_as_entries() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.ts",
            "export const GATES = {\n    clippy: \"clippy\",\n    fmt: [\"fmt\", \"check\"],\n};\n",
        );
        let declaration = module(root, "m", "app.ts");
        let facts = inspect_one(root, &declaration);
        let path = vec!["GATES".to_owned()];
        let clippy = facts
            .entries
            .iter()
            .find(|entry| entry.path == path && entry.key == Literal::Str("clippy".to_owned()))
            .expect("clippy entry should be reported");
        assert_eq!(clippy.values, Some(vec![Literal::Str("clippy".to_owned())]));
        let fmt = facts
            .entries
            .iter()
            .find(|entry| entry.path == path && entry.key == Literal::Str("fmt".to_owned()))
            .expect("fmt entry should be reported");
        assert_eq!(
            fmt.values,
            Some(vec![
                Literal::Str("fmt".to_owned()),
                Literal::Str("check".to_owned())
            ])
        );
    }

    #[test]
    fn a_non_literal_initializer_lands_in_unsupported() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.ts",
            "function compute() { return 1; }\nexport const COMPUTED = compute();\n",
        );
        let declaration = module(root, "m", "app.ts");
        let facts = inspect_one(root, &declaration);
        assert!(
            facts
                .unsupported
                .iter()
                .any(|symbol| symbol.path == vec!["COMPUTED".to_owned()]),
            "{:?}",
            facts.unsupported
        );
        assert!(
            facts
                .collections
                .iter()
                .all(|collection| collection.path != vec!["COMPUTED".to_owned()])
        );
    }

    #[test]
    fn a_plain_scalar_initializer_is_not_unsupported() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "app.ts", "export const NAME = \"blabla\";\n");
        let declaration = module(root, "m", "app.ts");
        let facts = inspect_one(root, &declaration);
        assert!(
            facts
                .unsupported
                .iter()
                .all(|symbol| symbol.path != vec!["NAME".to_owned()]),
            "{:?}",
            facts.unsupported
        );
        assert!(
            facts
                .symbols
                .iter()
                .any(|symbol| symbol.path == vec!["NAME".to_owned()])
        );
    }

    #[test]
    fn require_and_dynamic_import_are_found_anywhere_in_the_source() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "app.ts",
            "function load() {\n    const a = require(\"left-pad\");\n    return import(\"right-pad\");\n}\n",
        );
        let declaration = module(root, "m", "app.ts");
        let facts = inspect_one(root, &declaration);
        assert!(facts.imports.iter().any(|import| import.name == "left-pad"));
        assert!(
            facts
                .imports
                .iter()
                .any(|import| import.name == "right-pad")
        );
    }
}
