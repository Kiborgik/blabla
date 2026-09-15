use super::{
    DependencyTarget, Fact, Literal, ModuleDecl, Polarity, StructureContract, StructureRule,
};
use crate::diagnostic::{Diagnostic, Location, Span};
use crate::syntax::{Lexer, Token, TokenKind};
use std::collections::HashSet;
use std::path::Path;

pub const FACT_FORMS: &str = "`module <m>`, `symbol <m>::<Name>[.<member>]`, `dependency <m> -> <m>|\"<external>\"`, `value <m>::<Name> contains <literal>`";

pub fn is_structure_source(source: &str) -> bool {
    source
        .trim_start()
        .strip_prefix("module")
        .is_some_and(|rest| rest.starts_with(char::is_whitespace))
}

pub fn parse(
    file: &str,
    source: &str,
    root: &Path,
    group: Option<&str>,
) -> Result<StructureContract, Diagnostic> {
    let tokens = Lexer::new(file, source).lex()?;
    let mut parser = StructureParser {
        file,
        source,
        tokens: &tokens,
        position: 0,
        root,
        group,
        modules: Vec::new(),
        rules: Vec::new(),
        labels: HashSet::new(),
    };
    parser.parse_all()?;
    Ok(StructureContract {
        group: group.map(str::to_owned),
        file: file.to_owned(),
        source: source.to_owned(),
        modules: parser.modules,
        rules: parser.rules,
    })
}

struct StructureParser<'a> {
    file: &'a str,
    source: &'a str,
    tokens: &'a [Token],
    position: usize,
    root: &'a Path,
    group: Option<&'a str>,
    modules: Vec<ModuleDecl>,
    rules: Vec<StructureRule>,
    labels: HashSet<String>,
}

impl StructureParser<'_> {
    fn parse_all(&mut self) -> Result<(), Diagnostic> {
        while !self.at_end() {
            let token = self.current().clone();
            match &token.kind {
                TokenKind::Identifier(word) if word == "module" => self.module()?,
                TokenKind::Identifier(word) if word == "require" => self.rule(Polarity::Require)?,
                TokenKind::Identifier(word) if word == "forbid" => self.rule(Polarity::Forbid)?,
                TokenKind::Identifier(word)
                    if matches!(
                        word.as_str(),
                        "type" | "state" | "action" | "when" | "always" | "never"
                    ) =>
                {
                    return Err(self.error(
                        token.span,
                        "E_LAYER_MIX",
                        format!(
                            "'{word}' is a behavior declaration; a structure contract holds only `module`, `require` and `forbid` declarations"
                        ),
                    ));
                }
                _ => {
                    return Err(self.error(
                        token.span,
                        "E_STRUCTURE_SYNTAX",
                        "expected `module <name> \"path\"`, `require \"label\": <fact>` or `forbid \"label\": <fact>`",
                    ));
                }
            }
        }
        Ok(())
    }

    fn module(&mut self) -> Result<(), Diagnostic> {
        let start = self.current().span;
        self.position += 1;
        let (name, name_span) = self.identifier("expected a module name after `module`")?;
        let (written, path_span) =
            self.string("expected a quoted file path after the module name")?;
        if self.modules.iter().any(|module| module.name == name) {
            return Err(self.error(
                name_span,
                "E_DUPLICATE_MODULE",
                format!("module '{name}' is declared more than once"),
            ));
        }
        let span = Span {
            start: start.start,
            end: path_span.end,
            line: start.line,
            column: start.column,
        };
        self.modules.push(ModuleDecl {
            name,
            display: written.replace('\\', "/"),
            path: self.root.join(&written),
            location: self.location(span),
        });
        Ok(())
    }

    fn rule(&mut self, polarity: Polarity) -> Result<(), Diagnostic> {
        let start = self.current().span;
        self.position += 1;
        let (label, label_span) = self.string("expected a quoted rule label")?;
        if label.is_empty() {
            return Err(self.error(
                label_span,
                "E_STRUCTURE_SYNTAX",
                "a rule label cannot be empty",
            ));
        }
        if !self.labels.insert(label.clone()) {
            return Err(self.error(
                label_span,
                "E_DUPLICATE_LABEL",
                format!("label '{label}' is used by more than one rule in this contract"),
            ));
        }
        self.expect(TokenKind::Colon, "expected ':' after the rule label")?;
        let (fact, fact_end) = self.fact()?;
        let span = Span {
            start: start.start,
            end: fact_end,
            line: start.line,
            column: start.column,
        };
        let text = self.source[span.start..span.end]
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let id = match self.group {
            Some(group) => format!("{group}::{label}"),
            None => label.clone(),
        };
        self.rules.push(StructureRule {
            id,
            label,
            polarity,
            fact,
            location: self.location(span),
            source: text,
        });
        Ok(())
    }

    fn fact(&mut self) -> Result<(Fact, usize), Diagnostic> {
        let token = self.current().clone();
        let TokenKind::Identifier(kind) = &token.kind else {
            return Err(self.error(
                token.span,
                "E_STRUCTURE_FACT",
                format!("expected a structural fact: {FACT_FORMS}"),
            ));
        };
        self.position += 1;
        match kind.as_str() {
            "module" => {
                let (module, span) = self.module_reference()?;
                Ok((Fact::Module { module }, span.end))
            }
            "symbol" => {
                let (module, path, end) = self.symbol_reference()?;
                Ok((Fact::Symbol { module, path }, end))
            }
            "dependency" => {
                let (from, _) = self.module_reference()?;
                self.expect(
                    TokenKind::ThinArrow,
                    "expected '->' after the depending module",
                )?;
                let target = self.current().clone();
                self.position += 1;
                let to = match &target.kind {
                    TokenKind::Identifier(name) => {
                        self.known_module(name, target.span)?;
                        DependencyTarget::Module(name.clone())
                    }
                    TokenKind::String(name) => DependencyTarget::External(name.clone()),
                    _ => {
                        return Err(self.error(
                            target.span,
                            "E_STRUCTURE_FACT",
                            "expected a declared module name or a quoted external module after '->'",
                        ));
                    }
                };
                Ok((Fact::Dependency { from, to }, target.span.end))
            }
            "value" => {
                let (module, path, _) = self.symbol_reference()?;
                let keyword = self.current().clone();
                match &keyword.kind {
                    TokenKind::Identifier(word) if word == "contains" => self.position += 1,
                    _ => {
                        return Err(self.error(
                            keyword.span,
                            "E_STRUCTURE_FACT",
                            "expected `contains <literal>` after the value reference",
                        ));
                    }
                }
                let literal = self.current().clone();
                self.position += 1;
                let value = match &literal.kind {
                    TokenKind::String(text) => Literal::Str(text.clone()),
                    TokenKind::Integer(text) => Literal::Int(text.parse().map_err(|_| {
                        self.error(
                            literal.span,
                            "E_STRUCTURE_FACT",
                            "integer literal out of range",
                        )
                    })?),
                    TokenKind::Identifier(word) if word == "true" => Literal::Bool(true),
                    TokenKind::Identifier(word) if word == "false" => Literal::Bool(false),
                    _ => {
                        return Err(self.error(
                            literal.span,
                            "E_STRUCTURE_FACT",
                            "expected a string, integer, `true` or `false` after `contains`",
                        ));
                    }
                };
                Ok((
                    Fact::Contains {
                        module,
                        path,
                        value,
                    },
                    literal.span.end,
                ))
            }
            other => Err(self.error(
                token.span,
                "E_STRUCTURE_FACT",
                format!("unknown structural fact '{other}'; supported facts: {FACT_FORMS}"),
            )),
        }
    }

    fn module_reference(&mut self) -> Result<(String, Span), Diagnostic> {
        let (name, span) = self.identifier("expected a declared module name")?;
        self.known_module(&name, span)?;
        Ok((name, span))
    }

    fn symbol_reference(&mut self) -> Result<(String, Vec<String>, usize), Diagnostic> {
        let (module, span) = self.module_reference()?;
        self.expect(TokenKind::ColonColon, "expected '::' after the module name")?;
        let (first, mut end_span) = self.identifier("expected a symbol name after '::'")?;
        let mut path = vec![first];
        while self.consume(&TokenKind::Dot) {
            let (member, member_span) = self.identifier("expected a member name after '.'")?;
            path.push(member);
            end_span = member_span;
        }
        let _ = span;
        Ok((module, path, end_span.end))
    }

    fn known_module(&self, name: &str, span: Span) -> Result<(), Diagnostic> {
        if self.modules.iter().any(|module| module.name == name) {
            return Ok(());
        }
        Err(self.error(
            span,
            "E_UNKNOWN_MODULE",
            format!("module '{name}' is not declared; add `module {name} \"<path>\"` before the rules that use it"),
        ))
    }

    fn identifier(&mut self, message: &str) -> Result<(String, Span), Diagnostic> {
        let token = self.current().clone();
        match &token.kind {
            TokenKind::Identifier(name) => {
                self.position += 1;
                Ok((name.clone(), token.span))
            }
            _ => Err(self.error(token.span, "E_STRUCTURE_SYNTAX", message)),
        }
    }

    fn string(&mut self, message: &str) -> Result<(String, Span), Diagnostic> {
        let token = self.current().clone();
        match &token.kind {
            TokenKind::String(text) => {
                self.position += 1;
                Ok((text.clone(), token.span))
            }
            _ => Err(self.error(token.span, "E_STRUCTURE_SYNTAX", message)),
        }
    }

    fn expect(&mut self, kind: TokenKind, message: &str) -> Result<Span, Diagnostic> {
        let token = self.current().clone();
        if token.kind == kind {
            self.position += 1;
            Ok(token.span)
        } else {
            Err(self.error(token.span, "E_STRUCTURE_SYNTAX", message))
        }
    }

    fn consume(&mut self, kind: &TokenKind) -> bool {
        if &self.current().kind == kind {
            self.position += 1;
            true
        } else {
            false
        }
    }

    fn at_end(&self) -> bool {
        matches!(self.current().kind, TokenKind::Eof)
    }

    fn current(&self) -> &Token {
        &self.tokens[self.position.min(self.tokens.len() - 1)]
    }

    fn location(&self, span: Span) -> Location {
        Location {
            file: self.file.to_owned(),
            line: span.line,
            column: span.column,
        }
    }

    fn error(&self, span: Span, code: &str, message: impl Into<String>) -> Diagnostic {
        Diagnostic::new(self.file, span, code, message)
    }
}
