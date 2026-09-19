use super::{
    CollectionFact, Entry, EntryFact, ImportFact, Literal, ModuleDecl, ModuleFacts, Provider,
    ProviderFailure, SymbolFact, UnreadableImport, dotted, normalize,
};
use proc_macro2::{TokenStream, TokenTree};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use syn::spanned::Spanned;
use syn::visit::Visit;

pub const PROVIDER_ID: &str = "rust";
pub const EXTENSIONS: [&str; 1] = ["rs"];

const ROOT_STEMS: [&str; 3] = ["mod", "lib", "main"];
const ROUTE_KEYWORDS: [&str; 3] = ["crate", "self", "super"];
const BUILTIN_TYPES: [&str; 17] = [
    "bool", "char", "f32", "f64", "i8", "i16", "i32", "i64", "i128", "isize", "str", "u8", "u16",
    "u32", "u64", "u128", "usize",
];

pub struct RustProvider;

impl Provider for RustProvider {
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
        let segments: Vec<&str> = target.split('.').collect();
        let head = target
            .split(['.', ':'])
            .next()
            .filter(|head| !head.is_empty())
            .unwrap_or(target);
        if ROUTE_KEYWORDS.contains(&head) {
            return Some(format!(
                "{target:?} names a module inside this crate, not an external crate; declare it with `module` and write `dependency <from> -> <name>`"
            ));
        }
        if segments.iter().all(|segment| is_identifier(segment)) {
            return None;
        }
        Some(format!(
            "{target:?} is not a Rust crate path; an external target is a crate name, optionally followed by its modules separated by dots, as in \"serde\" or \"std.process\""
        ))
    }
}

fn is_identifier(segment: &str) -> bool {
    let mut characters = segment.chars();
    characters
        .next()
        .is_some_and(|first| first == '_' || first.is_alphabetic())
        && characters.all(|character| character == '_' || character.is_alphanumeric())
}

fn inspect_module(root: &Path, module: &ModuleDecl) -> ModuleFacts {
    let mut facts = ModuleFacts::default();
    let source = match std::fs::read_to_string(&module.path) {
        Ok(source) => source,
        Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => return facts,
        Err(failure) => {
            facts.error = Some(failure.to_string());
            return facts;
        }
    };
    facts.exists = true;
    let file = match syn::parse_file(&source) {
        Ok(file) => file,
        Err(failure) => {
            let line = failure.span().start().line;
            facts.error = Some(match line {
                0 => failure.to_string(),
                line => format!("{failure} (line {line})"),
            });
            return facts;
        }
    };
    Scan::new(root, &module.path).run(&file, facts)
}

#[derive(Clone)]
enum Route {
    Internal {
        base: PathBuf,
        segments: Vec<String>,
    },
    External {
        segments: Vec<String>,
    },
}

impl Route {
    fn extended(&self, rest: &[String]) -> Route {
        match self {
            Route::Internal { base, segments } => Route::Internal {
                base: base.clone(),
                segments: [segments.as_slice(), rest].concat(),
            },
            Route::External { segments } => Route::External {
                segments: [segments.as_slice(), rest].concat(),
            },
        }
    }
}

struct Scan {
    root: PathBuf,
    source_root: PathBuf,
    children: PathBuf,
    items: BTreeSet<String>,
    child_modules: BTreeSet<String>,
    aliases: BTreeMap<String, Route>,
    imports: BTreeMap<String, usize>,
    symbols: BTreeMap<Vec<String>, usize>,
    collections: Vec<CollectionFact>,
    entries: Vec<EntryFact>,
    unsupported: Vec<SymbolFact>,
    unresolved_imports: Vec<UnreadableImport>,
}

impl Scan {
    fn new(root: &Path, file: &Path) -> Scan {
        let file = normalize(file);
        let root = normalize(root);
        let directory = file.parent().unwrap_or(&root).to_path_buf();
        let stem = file
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default();
        let children = if ROOT_STEMS.contains(&stem.as_str()) {
            directory.clone()
        } else {
            directory.join(&stem)
        };
        let source_root = source_root(&directory, &root);
        Scan {
            root,
            source_root,
            children,
            items: BTreeSet::new(),
            child_modules: BTreeSet::new(),
            aliases: BTreeMap::new(),
            imports: BTreeMap::new(),
            symbols: BTreeMap::new(),
            collections: Vec::new(),
            entries: Vec::new(),
            unsupported: Vec::new(),
            unresolved_imports: Vec::new(),
        }
    }

    fn run(mut self, file: &syn::File, mut facts: ModuleFacts) -> ModuleFacts {
        self.collect_names(&file.items);
        self.collect_uses(&file.items);
        self.collect_child_modules(&file.items);
        self.declarations(&file.items);
        self.visit_file(file);
        facts.symbols = self
            .symbols
            .iter()
            .map(|(path, line)| SymbolFact {
                path: path.clone(),
                line: *line,
            })
            .collect();
        facts.imports = self
            .imports
            .iter()
            .map(|(name, line)| ImportFact {
                name: name.clone(),
                line: *line,
            })
            .collect();
        facts.collections = self.collections;
        facts.entries = self.entries;
        facts.unsupported = self.unsupported;
        facts.unresolved_imports = self.unresolved_imports;
        facts
    }

    fn collect_names(&mut self, items: &[syn::Item]) {
        for item in items {
            match item {
                syn::Item::Mod(declaration) => {
                    self.items.insert(declaration.ident.to_string());
                    if declaration.content.is_none() {
                        self.child_modules.insert(declaration.ident.to_string());
                    }
                }
                other => {
                    if let Some(name) = item_name(other) {
                        self.items.insert(name);
                    }
                }
            }
        }
    }

    fn collect_uses(&mut self, items: &[syn::Item]) {
        for item in items {
            match item {
                syn::Item::Use(declaration) => {
                    let mut leaves = Vec::new();
                    collect_use_tree(&declaration.tree, &mut Vec::new(), &mut leaves);
                    let line = declaration.use_token.span.start().line;
                    for (segments, alias) in leaves {
                        let Some(route) = self.classify_use(&segments) else {
                            continue;
                        };
                        if let Some(alias) = alias {
                            self.aliases.insert(alias, route.clone());
                        }
                        self.record(&route, line);
                    }
                }
                syn::Item::ExternCrate(declaration) => {
                    let route = Route::External {
                        segments: vec![declaration.ident.to_string()],
                    };
                    self.record(&route, declaration.extern_token.span.start().line);
                }
                syn::Item::Mod(declaration) => {
                    if let Some((_, nested)) = &declaration.content {
                        self.collect_uses(nested);
                    }
                }
                _ => {}
            }
        }
    }

    fn collect_child_modules(&mut self, items: &[syn::Item]) {
        for item in items {
            if let syn::Item::Mod(declaration) = item
                && declaration.content.is_none()
            {
                let route = Route::Internal {
                    base: self.children.clone(),
                    segments: vec![declaration.ident.to_string()],
                };
                self.record(&route, declaration.ident.span().start().line);
            }
        }
    }

    fn scan_tokens(&mut self, stream: TokenStream) {
        let mut run: Vec<String> = Vec::new();
        let mut line = 0;
        let mut colons = 0;
        for tree in stream {
            match tree {
                TokenTree::Group(group) => {
                    self.flush(&mut run, line);
                    colons = 0;
                    self.scan_tokens(group.stream());
                }
                TokenTree::Ident(ident) => {
                    if colons != 2 {
                        self.flush(&mut run, line);
                    }
                    if run.is_empty() {
                        line = ident.span().start().line;
                    }
                    run.push(ident.to_string());
                    colons = 0;
                }
                TokenTree::Punct(punct) if punct.as_char() == ':' => {
                    colons += 1;
                    if colons > 2 {
                        self.flush(&mut run, line);
                        colons = 0;
                    }
                }
                _ => {
                    self.flush(&mut run, line);
                    colons = 0;
                }
            }
        }
        self.flush(&mut run, line);
    }

    fn flush(&mut self, run: &mut Vec<String>, line: usize) {
        if run.is_empty() {
            return;
        }
        if let Some(route) = self.classify_path(run) {
            self.record(&route, line);
        }
        run.clear();
    }

    fn classify_use(&self, segments: &[String]) -> Option<Route> {
        let first = segments.first()?.as_str();
        match first {
            "crate" => Some(Route::Internal {
                base: self.source_root.clone(),
                segments: segments[1..].to_vec(),
            }),
            "self" => Some(Route::Internal {
                base: self.children.clone(),
                segments: segments[1..].to_vec(),
            }),
            "super" => self.super_route(segments),
            _ if self.child_modules.contains(first) => Some(Route::Internal {
                base: self.children.clone(),
                segments: segments.to_vec(),
            }),
            _ => Some(Route::External {
                segments: segments.to_vec(),
            }),
        }
    }

    fn classify_path(&self, segments: &[String]) -> Option<Route> {
        let first = segments.first()?.as_str();
        match first {
            "crate" => Some(Route::Internal {
                base: self.source_root.clone(),
                segments: segments[1..].to_vec(),
            }),
            "self" => Some(Route::Internal {
                base: self.children.clone(),
                segments: segments[1..].to_vec(),
            }),
            "super" => self.super_route(segments),
            "Self" | "_" => None,
            _ if self.child_modules.contains(first) => Some(Route::Internal {
                base: self.children.clone(),
                segments: segments.to_vec(),
            }),
            _ if self.aliases.contains_key(first) => {
                Some(self.aliases[first].extended(&segments[1..]))
            }
            _ if self.items.contains(first) => None,
            _ if BUILTIN_TYPES.contains(&first) => None,
            _ if starts_uppercase(first) => None,
            _ if segments.len() >= 2 => Some(Route::External {
                segments: segments.to_vec(),
            }),
            _ => None,
        }
    }

    fn super_route(&self, segments: &[String]) -> Option<Route> {
        let levels = segments
            .iter()
            .take_while(|segment| segment.as_str() == "super")
            .count();
        let mut base = self.children.clone();
        for _ in 0..levels {
            if !base.pop() {
                return None;
            }
        }
        if !base.starts_with(&self.root) {
            return None;
        }
        Some(Route::Internal {
            base,
            segments: segments[levels..].to_vec(),
        })
    }

    fn record(&mut self, route_taken: &Route, line: usize) {
        let name = match route_taken {
            Route::External { segments } => segments.join("."),
            Route::Internal { base, segments } => match route(base, segments) {
                Resolution::Module(target) => {
                    let Some(name) = dotted(&self.root, &target) else {
                        return;
                    };
                    name
                }
                Resolution::Item => {
                    let Some(target) = module_file(base) else {
                        return;
                    };
                    let Some(name) = dotted(&self.root, &target) else {
                        return;
                    };
                    name
                }
                Resolution::Undecidable => {
                    self.undecidable(base, segments, line);
                    return;
                }
            },
        };
        if name.is_empty() {
            return;
        }
        self.imports
            .entry(name)
            .and_modify(|existing| *existing = (*existing).min(line))
            .or_insert(line);
    }

    fn undecidable(&mut self, base: &Path, segments: &[String], line: usize) {
        let covers = module_file(base).and_then(|target| dotted(&self.root, &target));
        let form = format!(
            "use {} names no module this provider can locate; whether it is an item of {} or a module it cannot see cannot be decided statically",
            segments.join("::"),
            covers.clone().unwrap_or_else(|| "that module".to_owned())
        );
        if self
            .unresolved_imports
            .iter()
            .any(|unknown: &UnreadableImport| unknown.form == form)
        {
            return;
        }
        self.unresolved_imports
            .push(UnreadableImport { form, line, covers });
    }

    fn declarations(&mut self, items: &[syn::Item]) {
        for item in items {
            match item {
                syn::Item::Struct(declaration) => {
                    let name = declaration.ident.to_string();
                    self.symbol(vec![name.clone()], declaration.ident.span().start().line);
                    self.fields(&name, &declaration.fields);
                }
                syn::Item::Union(declaration) => {
                    let name = declaration.ident.to_string();
                    self.symbol(vec![name.clone()], declaration.ident.span().start().line);
                    for field in &declaration.fields.named {
                        if let Some(ident) = &field.ident {
                            self.symbol(
                                vec![name.clone(), ident.to_string()],
                                ident.span().start().line,
                            );
                        }
                    }
                }
                syn::Item::Enum(declaration) => {
                    let name = declaration.ident.to_string();
                    self.symbol(vec![name.clone()], declaration.ident.span().start().line);
                    for variant in &declaration.variants {
                        self.symbol(
                            vec![name.clone(), variant.ident.to_string()],
                            variant.ident.span().start().line,
                        );
                    }
                }
                syn::Item::Trait(declaration) => {
                    let name = declaration.ident.to_string();
                    self.symbol(vec![name.clone()], declaration.ident.span().start().line);
                    for member in &declaration.items {
                        match member {
                            syn::TraitItem::Fn(function) => self.symbol(
                                vec![name.clone(), function.sig.ident.to_string()],
                                function.sig.ident.span().start().line,
                            ),
                            syn::TraitItem::Type(alias) => self.symbol(
                                vec![name.clone(), alias.ident.to_string()],
                                alias.ident.span().start().line,
                            ),
                            syn::TraitItem::Const(constant) => {
                                let path = vec![name.clone(), constant.ident.to_string()];
                                let line = constant.ident.span().start().line;
                                self.symbol(path.clone(), line);
                                self.value(path, line, constant.default.as_ref().map(|(_, e)| e));
                            }
                            _ => {}
                        }
                    }
                }
                syn::Item::Impl(block) => {
                    let Some(name) = self_type_name(&block.self_ty) else {
                        continue;
                    };
                    for member in &block.items {
                        match member {
                            syn::ImplItem::Fn(function) => self.symbol(
                                vec![name.clone(), function.sig.ident.to_string()],
                                function.sig.ident.span().start().line,
                            ),
                            syn::ImplItem::Type(alias) => self.symbol(
                                vec![name.clone(), alias.ident.to_string()],
                                alias.ident.span().start().line,
                            ),
                            syn::ImplItem::Const(constant) => {
                                let path = vec![name.clone(), constant.ident.to_string()];
                                let line = constant.ident.span().start().line;
                                self.symbol(path.clone(), line);
                                self.value(path, line, Some(&constant.expr));
                            }
                            _ => {}
                        }
                    }
                }
                syn::Item::Const(declaration) => {
                    let path = vec![declaration.ident.to_string()];
                    let line = declaration.ident.span().start().line;
                    self.symbol(path.clone(), line);
                    self.value(path, line, Some(&declaration.expr));
                }
                syn::Item::Static(declaration) => {
                    let path = vec![declaration.ident.to_string()];
                    let line = declaration.ident.span().start().line;
                    self.symbol(path.clone(), line);
                    self.value(path, line, Some(&declaration.expr));
                }
                other => {
                    if let Some(name) = item_name(other)
                        && let Some(span) = item_span(other)
                    {
                        self.symbol(vec![name], span);
                    }
                }
            }
        }
    }

    fn fields(&mut self, owner: &str, fields: &syn::Fields) {
        if let syn::Fields::Named(named) = fields {
            for field in &named.named {
                if let Some(ident) = &field.ident {
                    self.symbol(
                        vec![owner.to_owned(), ident.to_string()],
                        ident.span().start().line,
                    );
                }
            }
        }
    }

    fn symbol(&mut self, path: Vec<String>, line: usize) {
        self.symbols
            .entry(path)
            .and_modify(|existing| *existing = (*existing).min(line))
            .or_insert(line);
    }

    fn value(&mut self, path: Vec<String>, line: usize, expr: Option<&syn::Expr>) {
        match expr.and_then(literal_collection) {
            Some(values) => self.collections.push(CollectionFact {
                path: path.clone(),
                line,
                values,
            }),
            None => self.unsupported.push(SymbolFact {
                path: path.clone(),
                line,
            }),
        }
        if let Some(entries) = expr.and_then(collection_entries) {
            for (entry_line, key, values) in entries {
                self.entries.push(EntryFact {
                    path: path.clone(),
                    key,
                    line: entry_line,
                    values,
                });
            }
        }
    }
}

impl<'ast> Visit<'ast> for Scan {
    fn visit_path(&mut self, path: &'ast syn::Path) {
        let segments: Vec<String> = path
            .segments
            .iter()
            .map(|segment| segment.ident.to_string())
            .collect();
        let line = path.span().start().line;
        if path.leading_colon.is_some() {
            if !segments.is_empty() {
                self.record(&Route::External { segments }, line);
            }
        } else if let Some(route) = self.classify_path(&segments) {
            self.record(&route, line);
        }
        syn::visit::visit_path(self, path);
    }

    fn visit_macro(&mut self, node: &'ast syn::Macro) {
        self.scan_tokens(node.tokens.clone());
        syn::visit::visit_macro(self, node);
    }
}

fn collect_use_tree(
    tree: &syn::UseTree,
    prefix: &mut Vec<String>,
    leaves: &mut Vec<(Vec<String>, Option<String>)>,
) {
    match tree {
        syn::UseTree::Path(segment) => {
            prefix.push(segment.ident.to_string());
            collect_use_tree(&segment.tree, prefix, leaves);
            prefix.pop();
        }
        syn::UseTree::Name(name) => {
            let ident = name.ident.to_string();
            if ident == "self" {
                leaves.push((prefix.clone(), prefix.last().cloned()));
            } else {
                let mut segments = prefix.clone();
                segments.push(ident.clone());
                leaves.push((segments, Some(ident)));
            }
        }
        syn::UseTree::Rename(rename) => {
            let ident = rename.ident.to_string();
            let alias = rename.rename.to_string();
            if ident == "self" {
                leaves.push((prefix.clone(), Some(alias)));
            } else {
                let mut segments = prefix.clone();
                segments.push(ident);
                leaves.push((segments, Some(alias)));
            }
        }
        syn::UseTree::Glob(_) => leaves.push((prefix.clone(), None)),
        syn::UseTree::Group(group) => {
            for item in &group.items {
                collect_use_tree(item, prefix, leaves);
            }
        }
    }
}

fn source_root(directory: &Path, root: &Path) -> PathBuf {
    let mut candidate = directory.to_path_buf();
    loop {
        if candidate.join("lib.rs").is_file() || candidate.join("main.rs").is_file() {
            return candidate;
        }
        if candidate == root || !candidate.pop() {
            return root.to_path_buf();
        }
    }
}

enum Resolution {
    Module(PathBuf),
    Item,
    Undecidable,
}

fn route(base: &Path, segments: &[String]) -> Resolution {
    for length in (1..=segments.len()).rev() {
        let mut directory = base.to_path_buf();
        for part in &segments[..length - 1] {
            directory.push(part);
        }
        let last = &segments[length - 1];
        let direct = directory.join(format!("{last}.rs"));
        if direct.is_file() {
            return Resolution::Module(direct);
        }
        let nested = directory.join(last).join("mod.rs");
        if nested.is_file() {
            return Resolution::Module(nested);
        }
    }
    if segments.len() <= 1 {
        Resolution::Item
    } else {
        Resolution::Undecidable
    }
}

fn module_file(directory: &Path) -> Option<PathBuf> {
    for stem in ROOT_STEMS {
        let candidate = directory.join(format!("{stem}.rs"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let name = directory.file_name()?.to_string_lossy().into_owned();
    let sibling = directory.parent()?.join(format!("{name}.rs"));
    sibling.is_file().then_some(sibling)
}

fn self_type_name(ty: &syn::Type) -> Option<String> {
    match ty {
        syn::Type::Path(path) => path
            .path
            .segments
            .last()
            .map(|segment| segment.ident.to_string()),
        syn::Type::Reference(reference) => self_type_name(&reference.elem),
        syn::Type::Group(group) => self_type_name(&group.elem),
        syn::Type::Paren(paren) => self_type_name(&paren.elem),
        _ => None,
    }
}

fn item_name(item: &syn::Item) -> Option<String> {
    match item {
        syn::Item::Fn(declaration) => Some(declaration.sig.ident.to_string()),
        syn::Item::Struct(declaration) => Some(declaration.ident.to_string()),
        syn::Item::Enum(declaration) => Some(declaration.ident.to_string()),
        syn::Item::Union(declaration) => Some(declaration.ident.to_string()),
        syn::Item::Trait(declaration) => Some(declaration.ident.to_string()),
        syn::Item::TraitAlias(declaration) => Some(declaration.ident.to_string()),
        syn::Item::Type(declaration) => Some(declaration.ident.to_string()),
        syn::Item::Const(declaration) => Some(declaration.ident.to_string()),
        syn::Item::Static(declaration) => Some(declaration.ident.to_string()),
        syn::Item::Mod(declaration) => Some(declaration.ident.to_string()),
        syn::Item::Macro(declaration) => declaration.ident.as_ref().map(ToString::to_string),
        _ => None,
    }
}

fn item_span(item: &syn::Item) -> Option<usize> {
    match item {
        syn::Item::Fn(declaration) => Some(declaration.sig.ident.span()),
        syn::Item::TraitAlias(declaration) => Some(declaration.ident.span()),
        syn::Item::Type(declaration) => Some(declaration.ident.span()),
        syn::Item::Mod(declaration) => Some(declaration.ident.span()),
        syn::Item::Macro(declaration) => declaration.ident.as_ref().map(syn::Ident::span),
        _ => None,
    }
    .map(|span| span.start().line)
}

fn starts_uppercase(name: &str) -> bool {
    name.chars().next().is_some_and(char::is_uppercase)
}

fn unwrap(expr: &syn::Expr) -> &syn::Expr {
    match expr {
        syn::Expr::Reference(reference) => unwrap(&reference.expr),
        syn::Expr::Group(group) => unwrap(&group.expr),
        syn::Expr::Paren(paren) => unwrap(&paren.expr),
        _ => expr,
    }
}

fn scalar(expr: &syn::Expr) -> Option<Literal> {
    let syn::Expr::Lit(literal) = unwrap(expr) else {
        return None;
    };
    match &literal.lit {
        syn::Lit::Str(value) => Some(Literal::Str(value.value())),
        syn::Lit::Bool(value) => Some(Literal::Bool(value.value)),
        syn::Lit::Int(value) => value.base10_parse::<i64>().ok().map(Literal::Int),
        _ => None,
    }
}

fn elements(expr: &syn::Expr) -> Option<Vec<&syn::Expr>> {
    match unwrap(expr) {
        syn::Expr::Array(array) => Some(array.elems.iter().collect()),
        syn::Expr::Tuple(tuple) => Some(tuple.elems.iter().collect()),
        _ => None,
    }
}

fn literal_collection(expr: &syn::Expr) -> Option<Vec<Literal>> {
    elements(expr)?.into_iter().map(scalar).collect()
}

fn payload(expr: &syn::Expr) -> Option<Vec<Literal>> {
    if let Some(value) = scalar(expr) {
        return Some(vec![value]);
    }
    literal_collection(expr)
}

fn collection_entries(expr: &syn::Expr) -> Option<Vec<Entry>> {
    let mut entries = Vec::new();
    for element in elements(expr)? {
        let pair = elements(element)?;
        if pair.len() != 2 {
            return None;
        }
        let key = scalar(pair[0])?;
        entries.push((element.span().start().line, key, payload(pair[1])));
    }
    Some(entries)
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

    fn inspect_one(root: &Path, declaration: &ModuleDecl) -> ModuleFacts {
        RustProvider
            .inspect(root, &[declaration])
            .unwrap()
            .remove(&declaration.key())
            .unwrap()
    }

    #[test]
    fn an_unresolvable_internal_use_is_an_unknown_scoped_to_the_module_it_could_hide() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        std::fs::write(root.join("lib.rs"), "use crate::absent::Thing;\n").unwrap();
        let declaration = module(root, "lib", "lib.rs");
        let facts = inspect_one(root, &declaration);
        assert!(
            facts.imports.is_empty(),
            "a route naming no module this provider can locate must not become an edge; got {:?}",
            facts.imports
        );
        assert_eq!(facts.unresolved_imports.len(), 1);
        assert_eq!(
            facts.unresolved_imports[0].covers.as_deref(),
            Some("lib"),
            "the unknown must name the one module it could be hiding so every other dependency stays decidable"
        );
    }

    #[test]
    fn a_single_remaining_segment_is_still_an_item_of_the_module_that_owns_it() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        std::fs::write(root.join("lib.rs"), "use crate::Thing;\n").unwrap();
        let declaration = module(root, "lib", "lib.rs");
        let facts = inspect_one(root, &declaration);
        let names: Vec<&str> = facts.imports.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, ["lib"]);
        assert!(
            facts.unresolved_imports.is_empty(),
            "a module without a file does not compile, so one remaining segment can only be an item of that module; got {:?}",
            facts.unresolved_imports
        );
    }

    #[test]
    fn a_super_route_still_reaches_the_parent_module_file() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        std::fs::create_dir_all(root.join("area")).unwrap();
        std::fs::write(
            root.join("area/mod.rs"),
            "pub struct Thing;\npub mod leaf;\n",
        )
        .unwrap();
        std::fs::write(root.join("area/leaf.rs"), "use super::Thing;\n").unwrap();
        let parent = module(root, "area", "area/mod.rs");
        let leaf = module(root, "leaf", "area/leaf.rs");
        let facts = RustProvider
            .inspect(root, &[&parent, &leaf])
            .unwrap()
            .remove(&leaf.key())
            .unwrap();
        let observable = super::super::dotted(root, &parent.path).unwrap();
        assert!(
            facts.imports.iter().any(|i| i.name == observable),
            "the documented super fallback must survive the correction ({observable}); got {:?}",
            facts.imports
        );
        assert!(facts.unresolved_imports.is_empty());
    }
}
