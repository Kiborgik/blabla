use super::{
    CollectionFact, EntryFact, ImportFact, Literal, ModuleDecl, ModuleFacts, SymbolFact,
    UnreadableImport, normalize,
};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tree_sitter::{Language, Node, Parser, Tree};

pub struct LineIndex(Vec<u32>);

impl LineIndex {
    pub fn new(source: &str) -> LineIndex {
        LineIndex(
            source
                .bytes()
                .enumerate()
                .filter(|(_, byte)| *byte == b'\n')
                .map(|(offset, _)| offset as u32)
                .collect(),
        )
    }

    pub fn line_at(&self, offset: u32) -> usize {
        self.0.partition_point(|&newline| newline < offset) + 1
    }

    pub fn line_of(&self, node: &Node) -> usize {
        self.line_at(node.start_byte() as u32)
    }
}

pub fn node_text(node: &Node, source: &str) -> String {
    let start = node.start_byte().min(source.len());
    let end = node.end_byte().min(source.len());
    if start <= end {
        source[start..end].to_string()
    } else {
        String::new()
    }
}

pub fn unquote(text: &str) -> &str {
    text.trim_matches('"').trim_matches('\'').trim_matches('`')
}

pub fn first_error(node: &Node, source: &str, lines: &LineIndex) -> Option<(String, usize)> {
    if node.is_error() {
        let text = node_text(node, source);
        return Some((format!("unexpected {text:?}"), lines.line_of(node)));
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(found) = first_error(&child, source, lines) {
            return Some(found);
        }
    }
    None
}

#[derive(Default)]
pub struct Facts {
    symbols: BTreeMap<Vec<String>, usize>,
    imports: BTreeMap<String, usize>,
    collections: Vec<CollectionFact>,
    entries: Vec<EntryFact>,
    unsupported: Vec<SymbolFact>,
    unresolved: Vec<UnreadableImport>,
}

impl Facts {
    pub fn symbol(&mut self, path: Vec<String>, line: usize) {
        self.symbols
            .entry(path)
            .and_modify(|existing| *existing = (*existing).min(line))
            .or_insert(line);
    }

    pub fn defines(&self, path: &[String]) -> bool {
        self.symbols.contains_key(path)
    }

    pub fn import(&mut self, name: String, line: usize) {
        if name.is_empty() {
            return;
        }
        self.imports
            .entry(name)
            .and_modify(|existing| *existing = (*existing).min(line))
            .or_insert(line);
    }

    pub fn collection(&mut self, path: Vec<String>, line: usize, values: Vec<Literal>) {
        self.collections.push(CollectionFact { path, line, values });
    }

    pub fn entry(
        &mut self,
        path: Vec<String>,
        key: Literal,
        line: usize,
        values: Option<Vec<Literal>>,
    ) {
        self.entries.push(EntryFact {
            path,
            key,
            line,
            values,
        });
    }

    pub fn unreadable_value(&mut self, path: Vec<String>, line: usize) {
        self.unsupported.push(SymbolFact { path, line });
    }

    pub fn unknown_import(&mut self, form: String, line: usize, covers: Option<String>) {
        if self
            .unresolved
            .iter()
            .any(|existing| existing.form == form && existing.covers == covers)
        {
            return;
        }
        self.unresolved
            .push(UnreadableImport { form, line, covers });
    }

    fn into_module_facts(self, mut facts: ModuleFacts) -> ModuleFacts {
        facts.symbols = self
            .symbols
            .into_iter()
            .map(|(path, line)| SymbolFact { path, line })
            .collect();
        facts.imports = self
            .imports
            .into_iter()
            .map(|(name, line)| ImportFact { name, line })
            .collect();
        facts.collections = self.collections;
        facts.entries = self.entries;
        facts.unsupported = self.unsupported;
        facts.unresolved_imports = self.unresolved;
        facts
    }
}

pub fn inspect_module<F>(module: &ModuleDecl, language: &Language, scan: F) -> ModuleFacts
where
    F: FnOnce(&str, &Tree) -> Facts,
{
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

    let mut parser = Parser::new();
    if let Err(failure) = parser.set_language(language) {
        facts.error = Some(format!("the grammar could not be loaded: {failure}"));
        return facts;
    }

    let Some(tree) = parser.parse(&source, None) else {
        facts.error = Some("the file could not be parsed".to_owned());
        return facts;
    };

    if tree.root_node().has_error() {
        let lines = LineIndex::new(&source);
        facts.error = Some(match first_error(&tree.root_node(), &source, &lines) {
            Some((message, 0)) => message,
            Some((message, line)) => format!("{message} (line {line})"),
            None => "syntax error".to_owned(),
        });
        return facts;
    }

    scan(&source, &tree).into_module_facts(facts)
}

pub struct Neighbourhood<'a> {
    root: PathBuf,
    declared: Vec<(&'a ModuleDecl, PathBuf)>,
}

impl<'a> Neighbourhood<'a> {
    pub fn new(root: &Path, declared: &[&'a ModuleDecl]) -> Neighbourhood<'a> {
        Neighbourhood {
            root: normalize(root),
            declared: declared
                .iter()
                .map(|module| (*module, normalize(&module.path)))
                .collect(),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn in_directory(&self, directory: &Path) -> Vec<&'a ModuleDecl> {
        let directory = normalize(directory);
        self.declared
            .iter()
            .filter(|(_, path)| path.parent() == Some(directory.as_path()))
            .map(|(module, _)| *module)
            .collect()
    }

    pub fn siblings_of(&self, file: &Path) -> Vec<&'a ModuleDecl> {
        let file = normalize(file);
        let Some(directory) = file.parent() else {
            return Vec::new();
        };
        self.in_directory(directory)
            .into_iter()
            .filter(|module| normalize(&module.path) != file)
            .collect()
    }

    pub fn dotted(&self, module: &ModuleDecl) -> Option<String> {
        super::dotted(&self.root, &module.path)
    }

    pub fn matching<P>(&self, predicate: P) -> Vec<&'a ModuleDecl>
    where
        P: Fn(&ModuleDecl) -> bool,
    {
        self.declared
            .iter()
            .filter(|(module, _)| predicate(module))
            .map(|(module, _)| *module)
            .collect()
    }
}
