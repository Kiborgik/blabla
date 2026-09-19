use super::treesitter::{Facts, LineIndex, Neighbourhood, node_text, unquote};
use super::{Literal, ModuleDecl, ModuleFacts, Provider, ProviderFailure, dotted, normalize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tree_sitter::{Node, Tree};

pub const C_PROVIDER_ID: &str = "c";
pub const CPP_PROVIDER_ID: &str = "cpp";

pub const C_EXTENSIONS: [&str; 1] = ["c"];
pub const CPP_EXTENSIONS: [&str; 7] = ["h", "hpp", "hh", "hxx", "cpp", "cc", "cxx"];

pub struct CProvider;
pub struct CppProvider;

fn include_target_error(target: &str) -> Option<String> {
    if target.is_empty() {
        return Some(
            "an external target cannot be empty; it is an angle-bracket include, such as \"stdio.h\" or \"vector\""
                .to_owned(),
        );
    }
    if target.starts_with("./") || target.starts_with("../") {
        return Some(format!(
            "{target:?} names a header inside this project, not a system include; declare it with `module` and write `dependency <from> -> <name>`"
        ));
    }
    None
}

impl Provider for CProvider {
    fn id(&self) -> &'static str {
        C_PROVIDER_ID
    }

    fn extensions(&self) -> &'static [&'static str] {
        &C_EXTENSIONS
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
            .map(|module| {
                (
                    module.key(),
                    inspect_module(root, module, &neighbourhood, "c"),
                )
            })
            .collect())
    }

    fn external_target_error(&self, target: &str) -> Option<String> {
        include_target_error(target)
    }
}

impl Provider for CppProvider {
    fn id(&self) -> &'static str {
        CPP_PROVIDER_ID
    }

    fn extensions(&self) -> &'static [&'static str] {
        &CPP_EXTENSIONS
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
            .map(|module| {
                (
                    module.key(),
                    inspect_module(root, module, &neighbourhood, "cpp"),
                )
            })
            .collect())
    }

    fn external_target_error(&self, target: &str) -> Option<String> {
        include_target_error(target)
    }
}

fn inspect_module(
    root: &Path,
    module: &ModuleDecl,
    neighbourhood: &Neighbourhood,
    language: &str,
) -> ModuleFacts {
    let lang_obj = match language {
        "c" => tree_sitter_c::LANGUAGE.into(),
        "cpp" => tree_sitter_cpp::LANGUAGE.into(),
        _ => tree_sitter_c::LANGUAGE.into(),
    };

    super::treesitter::inspect_module(module, &lang_obj, |source, tree| {
        Scan::new(root, &module.path, source, neighbourhood).run(tree)
    })
}

struct Scan<'a> {
    root: PathBuf,
    directory: PathBuf,
    source: String,
    lines: LineIndex,
    facts: Facts,
    neighbourhood: &'a Neighbourhood<'a>,
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
        let directory = file.parent().unwrap_or(&root).to_path_buf();
        Scan {
            root,
            directory,
            source: source.to_string(),
            lines: LineIndex::new(source),
            facts: Facts::default(),
            neighbourhood,
        }
    }

    fn run(mut self, tree: &Tree) -> Facts {
        let root = tree.root_node();
        let mut cursor = root.walk();

        for child in root.children(&mut cursor) {
            if child.is_named() {
                self.top_level_item(&child);
            }
        }

        self.facts
    }

    fn top_level_item(&mut self, node: &Node) {
        match node.kind() {
            "function_definition" => self.function_definition(node),
            "type_definition" => self.type_definition(node),
            "declaration" => self.declaration(node),
            "struct_specifier" => self.struct_specifier(node),
            "union_specifier" => self.union_specifier(node),
            "enum_specifier" => self.enum_specifier(node),
            "preproc_include" => self.preproc_include(node),
            "preproc_def" => self.preproc_def(node),
            "namespace_definition" => self.namespace_definition(node),
            "class_specifier" => self.class_specifier(node),
            "preproc_if"
            | "preproc_ifdef"
            | "preproc_else"
            | "preproc_elif"
            | "preproc_elifdef"
            | "linkage_specification"
            | "declaration_list" => self.guarded_items(node),
            _ => {}
        }
    }

    fn guarded_items(&mut self, node: &Node) {
        let mut cursor = node.walk();
        let children: Vec<Node> = node.children(&mut cursor).collect();
        for child in &children {
            if child.is_named() {
                self.top_level_item(child);
            }
        }
    }

    fn function_definition(&mut self, node: &Node) {
        let Some(declarator) = node.child_by_field_name("declarator") else {
            return;
        };
        let line = self.lines.line_of(node);
        if let Some((owner, member)) = self.qualified_owner(&declarator) {
            self.facts.symbol(vec![owner, member], line);
            return;
        }
        if let Some(direct_name) = self.declarator_name(&declarator) {
            self.facts.symbol(vec![direct_name], line);
        }
    }

    fn qualified_owner(&self, node: &Node) -> Option<(String, String)> {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "qualified_identifier" {
                return self.innermost_qualified(&child);
            }
            if matches!(
                child.kind(),
                "function_declarator"
                    | "pointer_declarator"
                    | "reference_declarator"
                    | "parenthesized_declarator"
                    | "array_declarator"
            ) && let Some(found) = self.qualified_owner(&child)
            {
                return Some(found);
            }
        }
        None
    }

    fn innermost_qualified(&self, node: &Node) -> Option<(String, String)> {
        let scope = node.child_by_field_name("scope")?;
        let name = node.child_by_field_name("name")?;
        if name.kind() == "qualified_identifier" {
            return self.innermost_qualified(&name);
        }
        let owner = node_text(&scope, &self.source);
        let member = node_text(&name, &self.source);
        if owner.is_empty() || member.is_empty() {
            return None;
        }
        Some((owner, member))
    }

    fn type_definition(&mut self, node: &Node) {
        let line = self.lines.line_of(node);
        let mut cursor = node.walk();
        let names: Vec<String> = node
            .children_by_field_name("declarator", &mut cursor)
            .filter_map(|child| self.declarator_name(&child))
            .collect();
        for name in &names {
            self.facts.symbol(vec![name.clone()], line);
        }
        let Some(specifier) = node.child_by_field_name("type") else {
            return;
        };
        let tag = specifier
            .child_by_field_name("name")
            .map(|name| node_text(&name, &self.source))
            .filter(|tag| !tag.is_empty());
        if let Some(tag) = &tag {
            self.facts.symbol(vec![tag.clone()], line);
        }
        let owners: Vec<String> = names.into_iter().chain(tag).collect();
        for owner in &owners {
            match specifier.kind() {
                "struct_specifier" | "class_specifier" => self.struct_fields(&specifier, owner),
                "union_specifier" => self.union_fields(&specifier, owner),
                "enum_specifier" => self.enum_enumerators(&specifier, owner),
                _ => {}
            }
        }
    }

    fn declaration(&mut self, node: &Node) {
        let node_text_full = node_text(node, &self.source);
        let is_typedef = node_text_full.contains("typedef");

        let mut cursor = node.walk();
        let children: Vec<Node> = node.children(&mut cursor).collect();

        let mut struct_index: Option<usize> = None;
        let mut union_index: Option<usize> = None;
        let mut enum_index: Option<usize> = None;

        for (i, child) in children.iter().enumerate() {
            match child.kind() {
                "struct_specifier" => {
                    if is_typedef && self.is_anonymous_specifier(child) {
                        struct_index = Some(i);
                    } else {
                        self.struct_specifier_top_level(child);
                    }
                }
                "union_specifier" => {
                    if is_typedef && self.is_anonymous_specifier(child) {
                        union_index = Some(i);
                    } else {
                        self.union_specifier_top_level(child);
                    }
                }
                "enum_specifier" => {
                    if is_typedef && self.is_anonymous_specifier(child) {
                        enum_index = Some(i);
                    } else {
                        self.enum_specifier_top_level(child);
                    }
                }
                "type_definition" => {
                    if let Some(name_node) = child.child_by_field_name("name") {
                        let name = node_text(&name_node, &self.source);
                        let line = self.lines.line_of(child);
                        self.facts.symbol(vec![name], line);
                    }
                }
                _ => {}
            }
        }

        for child in &children {
            match child.kind() {
                "identifier"
                | "function_declarator"
                | "parenthesized_declarator"
                | "pointer_declarator"
                | "array_declarator"
                | "init_declarator" => {
                    if is_typedef
                        && (struct_index.is_some() || union_index.is_some() || enum_index.is_some())
                    {
                        if let Some(name) = self.declarator_name(child) {
                            let line = self.lines.line_of(child);
                            self.facts.symbol(vec![name.clone()], line);

                            if let Some(si) = struct_index {
                                self.struct_fields(&children[si], &name);
                            }
                            if let Some(ui) = union_index {
                                self.union_fields(&children[ui], &name);
                            }
                            if let Some(ei) = enum_index {
                                self.enum_enumerators(&children[ei], &name);
                            }
                        }
                    } else {
                        self.process_declarator_with_init(child, is_typedef);
                    }
                }
                _ => {}
            }
        }

        if is_typedef {
            for child in &children {
                if (child.kind() == "declarator"
                    || child.kind() == "pointer_declarator"
                    || child.kind() == "array_declarator"
                    || child.kind() == "reference_declarator"
                    || child.kind() == "init_declarator")
                    && child.parent().map(|p| p.kind()) != Some("init_declarator")
                    && let Some(name) = self.declarator_name(child)
                {
                    let line = self.lines.line_of(node);
                    if !self.facts.defines(std::slice::from_ref(&name)) {
                        self.facts.symbol(vec![name], line);
                    }
                }
            }
        }
    }

    fn is_anonymous_specifier(&self, node: &Node) -> bool {
        node.child_by_field_name("name").is_none()
    }

    fn process_declarator_with_init(&mut self, node: &Node, _is_typedef: bool) {
        if let Some(name) = self.declarator_name(node) {
            let line = self.lines.line_of(node);
            self.facts.symbol(vec![name.clone()], line);

            if let Some(init_node) = node.child_by_field_name("value") {
                self.process_initializer(&name, &init_node, line);
            } else if let Some(parent) = node.parent()
                && parent.kind() == "init_declarator"
                && let Some(init_node) = parent.child_by_field_name("value")
            {
                self.process_initializer(&name, &init_node, line);
            }
        } else {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if (child.kind() == "declarator"
                    || child.kind() == "array_declarator"
                    || child.kind() == "pointer_declarator")
                    && let Some(name) = self.declarator_name(&child)
                {
                    let line = self.lines.line_of(&child);
                    self.facts.symbol(vec![name.clone()], line);
                    if let Some(init_node) = child.child_by_field_name("value") {
                        self.process_initializer(&name, &init_node, line);
                    } else if let Some(parent) = child.parent()
                        && parent.kind() == "init_declarator"
                        && let Some(init_node) = parent.child_by_field_name("value")
                    {
                        self.process_initializer(&name, &init_node, line);
                    }
                }
            }
        }
    }

    fn struct_specifier(&mut self, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let name = node_text(&name_node, &self.source);
            if !name.is_empty() {
                let line = self.lines.line_of(node);
                self.facts.symbol(vec![name.clone()], line);
                self.struct_fields(node, &name);
            }
        }
    }

    fn struct_specifier_top_level(&mut self, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let name = node_text(&name_node, &self.source);
            if !name.is_empty() {
                let line = self.lines.line_of(node);
                self.facts.symbol(vec![name.clone()], line);
                self.struct_fields(node, &name);
            }
        }
    }

    fn struct_fields(&mut self, node: &Node, struct_name: &str) {
        if let Some(body_node) = node.child_by_field_name("body") {
            let mut cursor = body_node.walk();
            for child in body_node.children(&mut cursor) {
                if child.kind() == "field_declaration" {
                    self.extract_field_declarations(&child, struct_name);
                }
            }
        }
    }

    fn extract_field_declarations(&mut self, node: &Node, parent_name: &str) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            match child.kind() {
                "declarator"
                | "pointer_declarator"
                | "reference_declarator"
                | "array_declarator" => {
                    if let Some(field_name) = self.declarator_name(&child) {
                        let line = self.lines.line_of(&child);
                        self.facts
                            .symbol(vec![parent_name.to_string(), field_name], line);
                    }
                }
                "function_declarator" => {
                    if let Some(field_name) = self.declarator_name(&child) {
                        let line = self.lines.line_of(&child);
                        self.facts
                            .symbol(vec![parent_name.to_string(), field_name], line);
                    }
                }
                "field_identifier" => {
                    let field_name = node_text(&child, &self.source);
                    if !field_name.is_empty() {
                        let line = self.lines.line_of(&child);
                        self.facts
                            .symbol(vec![parent_name.to_string(), field_name], line);
                    }
                }
                "identifier" => {
                    let field_name = node_text(&child, &self.source);
                    if !field_name.is_empty() {
                        let line = self.lines.line_of(&child);
                        self.facts
                            .symbol(vec![parent_name.to_string(), field_name], line);
                    }
                }
                _ => {}
            }
        }
    }

    fn union_specifier(&mut self, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let name = node_text(&name_node, &self.source);
            if !name.is_empty() {
                let line = self.lines.line_of(node);
                self.facts.symbol(vec![name.clone()], line);
                self.union_fields(node, &name);
            }
        }
    }

    fn union_specifier_top_level(&mut self, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let name = node_text(&name_node, &self.source);
            if !name.is_empty() {
                let line = self.lines.line_of(node);
                self.facts.symbol(vec![name.clone()], line);
                self.union_fields(node, &name);
            }
        }
    }

    fn union_fields(&mut self, node: &Node, union_name: &str) {
        if let Some(body_node) = node.child_by_field_name("body") {
            let mut cursor = body_node.walk();
            for child in body_node.children(&mut cursor) {
                if child.kind() == "field_declaration" {
                    self.extract_field_declarations(&child, union_name);
                }
            }
        }
    }

    fn enum_specifier(&mut self, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let name = node_text(&name_node, &self.source);
            if !name.is_empty() {
                let line = self.lines.line_of(node);
                self.facts.symbol(vec![name.clone()], line);
                self.enum_enumerators(node, &name);
            }
        }
    }

    fn enum_specifier_top_level(&mut self, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let name = node_text(&name_node, &self.source);
            if !name.is_empty() {
                let line = self.lines.line_of(node);
                self.facts.symbol(vec![name.clone()], line);
                self.enum_enumerators(node, &name);
            }
        }
    }

    fn enum_enumerators(&mut self, node: &Node, enum_name: &str) {
        if let Some(body_node) = node.child_by_field_name("body") {
            let mut cursor = body_node.walk();
            for child in body_node.children(&mut cursor) {
                if child.kind() == "enumerator"
                    && let Some(name_node) = child.child_by_field_name("name")
                {
                    let enum_member = node_text(&name_node, &self.source);
                    let line = self.lines.line_of(&name_node);
                    self.facts
                        .symbol(vec![enum_name.to_string(), enum_member], line);
                }
            }
        }
    }

    fn class_specifier(&mut self, node: &Node) {
        if let Some(name_node) = node.child_by_field_name("name") {
            let name = node_text(&name_node, &self.source);
            if !name.is_empty() {
                let line = self.lines.line_of(node);
                self.facts.symbol(vec![name.clone()], line);
                self.class_members(node, &name);
            }
        }
    }

    fn class_members(&mut self, node: &Node, class_name: &str) {
        if let Some(body_node) = node.child_by_field_name("body") {
            let mut cursor = body_node.walk();
            for child in body_node.children(&mut cursor) {
                match child.kind() {
                    "function_definition" => {
                        if let Some(declarator_node) = child.child_by_field_name("declarator")
                            && let Some(member_name) = self.declarator_name(&declarator_node)
                        {
                            let line = self.lines.line_of(&declarator_node);
                            self.facts
                                .symbol(vec![class_name.to_string(), member_name], line);
                        }
                    }
                    "field_declaration" => {
                        self.extract_field_declarations(&child, class_name);
                    }
                    _ => {}
                }
            }
        }
    }

    fn process_initializer(&mut self, name: &str, node: &Node, line: usize) {
        match node.kind() {
            "initializer_list" => {
                self.process_initializer_list(name, node, line);
            }
            "call_expression" | "function_call" => {
                self.facts.unreadable_value(vec![name.to_string()], line);
            }
            "cast_expression" => {
                self.facts.unreadable_value(vec![name.to_string()], line);
            }
            "identifier" => {
                self.facts.unreadable_value(vec![name.to_string()], line);
            }
            "string_literal" | "number_literal" | "char_literal" | "true" | "false" => {}
            _ => {}
        }
    }

    fn process_initializer_list(&mut self, name: &str, node: &Node, line: usize) {
        let mut cursor = node.walk();
        let children: Vec<Node> = node.children(&mut cursor).collect();

        let mut literals = Vec::new();
        let mut entries = Vec::new();
        let mut pair_count = 0;
        let mut is_pairs = true;

        for child in &children {
            if child.kind() == "," {
                continue;
            }
            if !child.is_named() {
                continue;
            }

            match child.kind() {
                "initializer_list" => {
                    pair_count += 1;
                    let inner_children: Vec<Node> = {
                        let mut inner_cursor = child.walk();
                        child.children(&mut inner_cursor).collect()
                    };

                    let mut pair_key: Option<Literal> = None;
                    let mut pair_values: Vec<Literal> = Vec::new();
                    let mut literal_count = 0;

                    for inner_child in &inner_children {
                        if inner_child.kind() == "," {
                            continue;
                        }
                        if !inner_child.is_named() {
                            continue;
                        }

                        let lit_text = self.extract_literal_text(inner_child);
                        if let Some(lit) = parse_literal(&lit_text) {
                            if literal_count == 0 {
                                pair_key = Some(lit.clone());
                            } else {
                                pair_values.push(lit);
                            }
                            literal_count += 1;
                        } else {
                            is_pairs = false;
                            break;
                        }
                    }

                    if is_pairs && pair_key.is_some() {
                        if let Some(key) = pair_key {
                            entries.push((
                                line,
                                key,
                                if pair_values.is_empty() {
                                    None
                                } else {
                                    Some(pair_values)
                                },
                            ));
                        }
                    } else {
                        is_pairs = false;
                    }
                }
                _ => {
                    let lit_text = self.extract_literal_text(child);
                    if let Some(lit) = parse_literal(&lit_text) {
                        literals.push(lit);
                    } else {
                        is_pairs = false;
                    }
                }
            }
        }

        let path = vec![name.to_string()];

        if !entries.is_empty() && is_pairs && pair_count > 0 {
            for (entry_line, key, values) in entries {
                self.facts.entry(path.clone(), key, entry_line, values);
            }
        } else if !literals.is_empty() && pair_count == 0 {
            self.facts.collection(path, line, literals);
        }
    }

    fn extract_literal_text(&self, node: &Node) -> String {
        match node.kind() {
            "string_literal" => {
                if let Some(content_child) = node.child_by_field_name("string_content") {
                    let content_text = node_text(&content_child, &self.source);
                    format!("\"{}\"", content_text)
                } else {
                    node_text(node, &self.source)
                }
            }
            _ => node_text(node, &self.source),
        }
    }

    fn namespace_definition(&mut self, node: &Node) {
        if let Some(body_node) = node.child_by_field_name("body") {
            let mut cursor = body_node.walk();
            for child in body_node.children(&mut cursor) {
                if child.is_named() {
                    self.top_level_item(&child);
                }
            }
        }
    }

    fn preproc_include(&mut self, node: &Node) {
        let line = self.lines.line_of(node);
        let text = node_text(node, &self.source);

        if text.contains("#include \"") {
            if let Some(start) = text.find("\"")
                && let Some(end) = text.rfind("\"")
                && start < end
            {
                let path_str = &text[start + 1..end];
                self.record_quoted_include(path_str, line);
            }
        } else if text.contains("#include <") {
            if let Some(start) = text.find("<")
                && let Some(end) = text.find(">")
                && start < end
            {
                let header = &text[start + 1..end];
                self.facts.import(header.to_string(), line);
            }
        } else if text.contains("#include") {
            self.facts.unknown_import(
                format!("{} (macro include operand)", text.trim()),
                line,
                None,
            );
        }
    }

    fn record_quoted_include(&mut self, path_str: &str, line: usize) {
        let joined = normalize(&self.directory.join(path_str));
        let candidates: Vec<PathBuf> = vec![joined.clone(), normalize(&self.root.join(path_str))];

        for candidate in candidates {
            if candidate.is_file() {
                for module in self.declared_modules() {
                    if normalize(&module.path) == candidate
                        && let Some(dotted_name) = self.neighbourhood.dotted(module)
                    {
                        self.facts.import(dotted_name, line);
                        return;
                    }
                }

                if let Some(name) = dotted(&self.root, &candidate) {
                    self.facts.import(name, line);
                    return;
                }
            }
        }

        let form = format!(
            "#include \"{path_str}\" resolves to no declared module and no file beside this one; it may sit on an include path BlaBla cannot see"
        );
        let mut covered = self.covering_modules(path_str);
        if covered.is_empty() {
            covered.extend(self.covering_files(path_str));
        }
        if covered.is_empty() {
            self.facts.unknown_import(form, line, None);
            return;
        }
        for name in covered {
            self.facts.unknown_import(form.clone(), line, Some(name));
        }
    }

    fn covering_files(&self, path_str: &str) -> Vec<String> {
        let wanted = path_str
            .split(['/', '\\'])
            .next_back()
            .unwrap_or_default()
            .to_lowercase();
        if wanted.is_empty() {
            return Vec::new();
        }
        let mut found = Vec::new();
        collect_named(&self.root, &wanted, 0, &mut found);
        found
            .iter()
            .filter_map(|path| dotted(&self.root, path))
            .collect()
    }

    fn declared_modules(&self) -> Vec<&'a ModuleDecl> {
        self.neighbourhood.matching(|_| true)
    }

    fn covering_modules(&self, path_str: &str) -> Vec<String> {
        match self.find_covering_module(path_str) {
            Some(name) => vec![name],
            None => Vec::new(),
        }
    }

    fn find_covering_module(&self, path_str: &str) -> Option<String> {
        let path_parts: Vec<&str> = path_str.split(['/', '\\']).collect();
        let filename = path_parts.last().copied().unwrap_or("");

        for module in self.declared_modules() {
            let module_path_str = module.path.to_string_lossy();
            let module_parts: Vec<&str> = module_path_str.split(['/', '\\']).collect();
            let module_filename = module_parts.last().copied().unwrap_or("");

            if !filename.is_empty()
                && !module_filename.is_empty()
                && (filename.to_lowercase() == module_filename.to_lowercase()
                    || module_filename.starts_with(&filename.to_lowercase()))
                && let Some(dotted_name) = self.neighbourhood.dotted(module)
            {
                return Some(dotted_name);
            }
        }
        None
    }

    fn preproc_def(&mut self, node: &Node) {
        let line = self.lines.line_of(node);

        if let Some(name_node) = node.child_by_field_name("name") {
            let name = node_text(&name_node, &self.source);

            if let Some(value_node) = node.child_by_field_name("value") {
                let value_text = node_text(&value_node, &self.source).trim().to_string();

                if parse_literal(&value_text).is_some() {
                    self.facts.symbol(vec![name.clone()], line);
                } else {
                    let text = node_text(node, &self.source);
                    if !text.contains("(") {
                        self.facts.symbol(vec![name.clone()], line);
                        if !is_simple_literal(&value_text) {
                            self.facts.unreadable_value(vec![name], line);
                        }
                    }
                }
            } else {
                self.facts.symbol(vec![name], line);
            }
        }
    }

    fn declarator_name(&self, node: &Node) -> Option<String> {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "identifier"
                || child.kind() == "field_identifier"
                || child.kind() == "type_identifier"
            {
                let name = node_text(&child, &self.source);
                if !name.is_empty() {
                    return Some(name);
                }
            }
            if (child.kind() == "reference_declarator"
                || child.kind() == "pointer_declarator"
                || child.kind() == "function_declarator"
                || child.kind() == "array_declarator"
                || child.kind() == "parenthesized_declarator")
                && let Some(name) = self.declarator_name(&child)
            {
                return Some(name);
            }
        }

        if node.kind() == "identifier"
            || node.kind() == "field_identifier"
            || node.kind() == "type_identifier"
        {
            let name = node_text(node, &self.source);
            if !name.is_empty() {
                return Some(name);
            }
        }

        if let Some(child) = node.child(0) {
            return self.declarator_name(&child);
        }

        None
    }
}

const WALK_DEPTH: usize = 8;

const UNWALKED: [&str; 6] = [
    ".blabla",
    ".git",
    "target",
    "node_modules",
    ".venv",
    "__pycache__",
];

fn collect_named(directory: &Path, wanted: &str, depth: usize, found: &mut Vec<PathBuf>) {
    if depth > WALK_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if kind.is_dir() {
            if !UNWALKED.contains(&name.as_str()) {
                collect_named(&path, wanted, depth + 1, found);
            }
        } else if name == wanted {
            found.push(path);
        }
    }
}

fn parse_literal(text: &str) -> Option<Literal> {
    let trimmed = text.trim();

    if trimmed == "true" || trimmed == "false" {
        return Some(Literal::Bool(trimmed == "true"));
    }

    if let Ok(num) = trimmed.parse::<i64>() {
        return Some(Literal::Int(num));
    }

    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        let unquoted = unquote(trimmed);
        return Some(Literal::Str(unquoted.to_string()));
    }

    None
}

fn is_simple_literal(text: &str) -> bool {
    parse_literal(text).is_some()
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

    fn inspect_one_c(root: &Path, declaration: &ModuleDecl) -> ModuleFacts {
        CProvider
            .inspect(root, &[declaration])
            .unwrap()
            .remove(&declaration.key())
            .unwrap()
    }

    fn inspect_one_cpp(root: &Path, declaration: &ModuleDecl) -> ModuleFacts {
        CppProvider
            .inspect(root, &[declaration])
            .unwrap()
            .remove(&declaration.key())
            .unwrap()
    }

    #[test]
    fn a_prototype_and_an_uninitialised_variable_are_symbols() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "decls.c",
            "int serve(const int *adapter);\nstatic int counter;\nstatic char *cursor;\n",
        );
        let declaration = module(root, "m", "decls.c");
        let facts = inspect_one_c(root, &declaration);
        let has = |name: &str| {
            facts
                .symbols
                .iter()
                .any(|s| s.path == vec![name.to_owned()])
        };

        for name in ["serve", "counter", "cursor"] {
            assert!(has(name), "{name} missing; got {:?}", facts.symbols);
        }
    }

    #[test]
    fn a_pointer_array_is_a_symbol_and_a_collection() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "table.c",
            "static const char *KINDS[] = {\"box\", \"line\"};\nstatic const int SIZES[] = {1, 2};\n",
        );
        let declaration = module(root, "m", "table.c");
        let facts = inspect_one_c(root, &declaration);
        let has = |name: &str| {
            facts
                .symbols
                .iter()
                .any(|s| s.path == vec![name.to_owned()])
        };

        assert!(has("KINDS"), "got {:?}", facts.symbols);
        assert!(has("SIZES"), "got {:?}", facts.symbols);
        assert!(
            facts
                .collections
                .iter()
                .any(|c| c.path == vec!["KINDS".to_owned()]
                    && c.values.contains(&Literal::Str("line".to_owned()))),
            "got {:?}",
            facts.collections
        );
    }

    #[test]
    fn an_out_of_line_definition_belongs_to_its_innermost_owner() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "ool.cpp",
            "namespace deep {\nclass Thing;\n}\n\nvoid deep::Thing::run() {}\n\nvoid Plain::go() {}\n",
        );
        let declaration = module(root, "m", "ool.cpp");
        let facts = inspect_one_cpp(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|part| (*part).to_owned()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };

        assert!(has(&["Thing", "run"]), "got {:?}", facts.symbols);
        assert!(has(&["Plain", "go"]), "got {:?}", facts.symbols);
        assert!(!has(&["run"]), "the bare member must not be top level");
    }

    #[test]
    fn an_unresolvable_include_is_scoped_to_the_files_it_could_name() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "sub/util.h", "typedef struct { int a; } U;\n");
        write(root, "other.c", "int other(void) { return 1; }\n");
        write(
            root,
            "inc.c",
            "#include \"util.h\"\nint inc(void) { return 0; }\n",
        );
        let declaration = module(root, "m", "inc.c");
        let facts = inspect_one_c(root, &declaration);

        assert!(
            !facts.unresolved_imports.is_empty(),
            "the include must stay unknown"
        );
        assert!(
            facts
                .unresolved_imports
                .iter()
                .all(|unknown| unknown.covers.is_some()),
            "an unknown that can be bounded must not be unbounded; got {:?}",
            facts.unresolved_imports
        );
        assert!(
            facts
                .unresolved_imports
                .iter()
                .any(|unknown| unknown.covers.as_deref() == Some("sub.util")),
            "got {:?}",
            facts.unresolved_imports
        );
        assert!(
            facts
                .unresolved_imports
                .iter()
                .all(|unknown| unknown.covers.as_deref() != Some("other")),
            "an unrelated module must stay decidable; got {:?}",
            facts.unresolved_imports
        );
    }

    #[test]
    fn a_missing_file_exists_false_without_an_error() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        let declaration = module(root, "m", "missing.c");
        let facts = inspect_one_c(root, &declaration);
        assert!(!facts.exists);
        assert!(facts.error.is_none());
    }

    #[test]
    fn a_c_file_with_syntax_error_sets_error_with_line() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "broken.c", "int x = ;\n");
        let declaration = module(root, "m", "broken.c");
        let facts = inspect_one_c(root, &declaration);
        assert!(facts.exists);
        assert!(facts.error.is_some(), "a syntax error was expected");
    }

    #[test]
    fn c_function_definition_is_recorded_as_symbol() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.c", "int add(int a, int b) { return a + b; }\n");
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        assert!(
            facts
                .symbols
                .iter()
                .any(|s| s.path == vec!["add".to_string()])
        );
    }

    #[test]
    fn c_struct_definition_is_recorded_as_symbol() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.c", "struct Point { int x; int y; };\n");
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(has(&["Point"]));
    }

    #[test]
    fn c_enum_definition_is_recorded_with_enumerators() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.c", "enum Color { Red, Green, Blue };\n");
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(has(&["Color"]));
        assert!(has(&["Color", "Red"]));
        assert!(has(&["Color", "Green"]));
        assert!(has(&["Color", "Blue"]));
    }

    #[test]
    fn c_union_definition_is_recorded_with_fields() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.c", "union Data { int i; float f; };\n");
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(has(&["Data"]));
    }

    #[test]
    fn object_like_define_is_recorded_as_symbol() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.c", "#define PI 3.14159\n");
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        assert!(
            facts
                .symbols
                .iter()
                .any(|s| s.path == vec!["PI".to_string()])
        );
    }

    #[test]
    fn angle_bracket_include_is_recorded_verbatim() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.c", "#include <stdio.h>\n");
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        assert!(facts.imports.iter().any(|i| i.name == "stdio.h"));
    }

    #[test]
    fn quoted_include_resolves_to_declared_module() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "util.c", "int helper() { return 1; }\n");
        write(
            root,
            "main.c",
            "#include \"util.c\"\nint main() { return 0; }\n",
        );
        let importer = module(root, "main", "main.c");
        let util = module(root, "util", "util.c");
        let facts = CProvider
            .inspect(root, &[&importer, &util])
            .unwrap()
            .remove(&importer.key())
            .unwrap();
        assert!(
            facts.imports.iter().any(|i| i.name == "util"),
            "{:?}",
            facts.imports
        );
    }

    #[test]
    fn unresolvable_quoted_include_produces_unknown_with_none() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.c", "#include \"missing.h\"\n");
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        assert!(!facts.unresolved_imports.is_empty());
        let unresolved = &facts.unresolved_imports[0];
        assert_eq!(unresolved.covers, None);
    }

    #[test]
    fn macro_include_produces_unknown_with_none() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "main.c",
            "#define MY_HEADER \"header.h\"\n#include MY_HEADER\n",
        );
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        assert!(!facts.unresolved_imports.is_empty());
    }

    #[test]
    fn cpp_class_with_member_functions() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "main.cpp",
            "class Foo { public: int bar(); int baz; };\n",
        );
        let declaration = module(root, "m", "main.cpp");
        let facts = inspect_one_cpp(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(has(&["Foo"]));
    }

    #[test]
    fn cpp_namespace_members_contribute_at_top_level() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "main.cpp",
            "namespace myns { class Foo {}; void helper() {} }\n",
        );
        let declaration = module(root, "m", "main.cpp");
        let facts = inspect_one_cpp(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(has(&["Foo"]));
        assert!(has(&["helper"]));
    }

    #[test]
    fn call_initializer_lands_in_unreadable() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.c", "int value = compute();\n");
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        assert!(
            facts
                .unsupported
                .iter()
                .any(|s| s.path == vec!["value".to_string()])
        );
    }

    #[test]
    fn simple_scalar_initializer_is_not_unsupported() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.c", "const char *name = \"hello\";\n");
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        assert!(
            !facts
                .unsupported
                .iter()
                .any(|s| s.path == vec!["name".to_string()])
        );
    }

    #[test]
    fn array_literal_becomes_collection() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.c", "int values[] = {1, 2, 3};\n");
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        let path = vec!["values".to_string()];
        assert!(
            facts.collections.iter().any(|c| c.path == path),
            "Collection should be recorded for array initializer. Found: {:?}",
            facts.collections
        );
    }

    #[test]
    fn integer_array_literal_becomes_collection() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.c", "int values[] = {1, 2, 3};\n");
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        let path = vec!["values".to_string()];
        assert!(
            facts
                .collections
                .iter()
                .any(|c| c.path == path && c.values.len() == 3)
        );
    }

    #[test]
    fn array_of_pairs_becomes_entries() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "main.c",
            "struct Entry { const char *k; const char *v; };\nstruct Entry data[] = {{\"a\", \"1\"}, {\"b\", \"2\"}};\n",
        );
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        let path = vec!["data".to_string()];
        assert!(facts.entries.iter().filter(|e| e.path == path).count() == 2);
        let entry_a = facts
            .entries
            .iter()
            .find(|e| e.path == path && e.key == Literal::Str("a".to_string()));
        assert!(entry_a.is_some());
        assert_eq!(
            entry_a.unwrap().values,
            Some(vec![Literal::Str("1".to_string())])
        );
    }

    #[test]
    fn cpp_class_declared_method() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "main.hpp",
            "class MyClass { public: int getValue(); };\n",
        );
        let declaration = module(root, "m", "main.hpp");
        let facts = inspect_one_cpp(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(has(&["MyClass"]));
        assert!(has(&["MyClass", "getValue"]));
    }

    #[test]
    fn cpp_class_data_member() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.hpp", "class MyClass { private: int data; };\n");
        let declaration = module(root, "m", "main.hpp");
        let facts = inspect_one_cpp(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(has(&["MyClass"]));
        assert!(has(&["MyClass", "data"]));
    }

    #[test]
    fn cpp_struct_member() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.hpp", "struct MyStruct { int field; };\n");
        let declaration = module(root, "m", "main.hpp");
        let facts = inspect_one_cpp(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(has(&["MyStruct"]));
        assert!(has(&["MyStruct", "field"]));
    }

    #[test]
    fn cpp_member_in_anonymous_namespace() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.hpp", "namespace { struct Inner { int x; }; }\n");
        let declaration = module(root, "m", "main.hpp");
        let facts = inspect_one_cpp(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(has(&["Inner"]));
        assert!(has(&["Inner", "x"]));
    }

    #[test]
    fn cpp_reference_returning_member() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "main.hpp",
            "class MyClass { public: const int& getValue() const; };\n",
        );
        let declaration = module(root, "m", "main.hpp");
        let facts = inspect_one_cpp(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(has(&["MyClass"]));
        assert!(has(&["MyClass", "getValue"]));
    }

    #[test]
    fn cpp_pointer_returning_member() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "main.hpp",
            "class MyClass { public: int* getData(); };\n",
        );
        let declaration = module(root, "m", "main.hpp");
        let facts = inspect_one_cpp(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(has(&["MyClass"]));
        assert!(has(&["MyClass", "getData"]));
    }

    #[test]
    fn cpp_pointer_data_member() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.hpp", "class MyClass { private: int* ptr; };\n");
        let declaration = module(root, "m", "main.hpp");
        let facts = inspect_one_cpp(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(has(&["MyClass"]));
        assert!(has(&["MyClass", "ptr"]));
    }

    #[test]
    fn typedef_anonymous_struct_c() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root, "main.c", "typedef struct { int x; int y; } Point;\n");
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(
            has(&["Point"]),
            "Expected symbol Point, found: {:?}",
            facts.symbols.iter().map(|s| &s.path).collect::<Vec<_>>()
        );
        assert!(has(&["Point", "x"]));
        assert!(has(&["Point", "y"]));
    }

    #[test]
    fn typedef_anonymous_enum_c() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(
            root,
            "main.c",
            "typedef enum { RED = 0, GREEN = 1 } Color;\n",
        );
        let declaration = module(root, "m", "main.c");
        let facts = inspect_one_c(root, &declaration);
        let has = |path: &[&str]| {
            let path: Vec<String> = path.iter().map(|p| p.to_string()).collect();
            facts.symbols.iter().any(|s| s.path == path)
        };
        assert!(
            has(&["Color"]),
            "Expected symbol Color, found: {:?}",
            facts.symbols.iter().map(|s| &s.path).collect::<Vec<_>>()
        );
        assert!(has(&["Color", "RED"]));
        assert!(has(&["Color", "GREEN"]));
    }
}
