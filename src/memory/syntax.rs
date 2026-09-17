use crate::diagnostic::{Diagnostic, Location, Span};
use crate::syntax::{Lexer, Token, TokenKind};

#[derive(Clone, Debug)]
pub struct Block {
    pub keyword: String,
    pub name: String,
    pub location: Location,
    pub fields: Vec<Field>,
}

#[derive(Clone, Debug)]
pub struct Field {
    pub name: String,
    pub values: Vec<String>,
    pub list: bool,
    pub location: Location,
}

impl Block {
    pub fn field(&self, name: &str) -> Option<&Field> {
        self.fields.iter().find(|field| field.name == name)
    }
}

impl Field {
    pub fn text(&self) -> &str {
        self.values.first().map(String::as_str).unwrap_or_default()
    }
}

pub fn is_identity_safe(name: &str) -> bool {
    let mut characters = name.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphanumeric())
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}

pub const SYSTEM_KEYWORDS: &[&str] = &["system", "responsibility", "seam"];
pub const PROCESS_KEYWORDS: &[&str] = &["role", "policy", "flow", "step"];
pub const MISSION_KEYWORDS: &[&str] = &["mission", "priority"];
pub const KNOWLEDGE_KEYWORDS: &[&str] = &["knowledge", "ruling"];

pub fn kind(file: &str, source: &str) -> Option<&'static str> {
    let tokens = Lexer::new(file, source).lex().ok()?;
    let TokenKind::Identifier(first) = &tokens.first()?.kind else {
        return None;
    };
    let first = first.as_str();
    [
        ("system", SYSTEM_KEYWORDS),
        ("process", PROCESS_KEYWORDS),
        ("mission", MISSION_KEYWORDS),
        ("knowledge", KNOWLEDGE_KEYWORDS),
    ]
    .into_iter()
    .find(|(_, keywords)| keywords.contains(&first))
    .map(|(kind, _)| kind)
}

pub fn parse(file: &str, source: &str) -> Result<Vec<Block>, Diagnostic> {
    let tokens = Lexer::new(file, source).lex()?;
    let mut parser = Parser {
        file,
        tokens: &tokens,
        position: 0,
    };
    parser.blocks()
}

struct Parser<'a> {
    file: &'a str,
    tokens: &'a [Token],
    position: usize,
}

impl Parser<'_> {
    fn blocks(&mut self) -> Result<Vec<Block>, Diagnostic> {
        let mut blocks = Vec::new();
        while !matches!(self.current().kind, TokenKind::Eof) {
            blocks.push(self.block()?);
        }
        Ok(blocks)
    }

    fn block(&mut self) -> Result<Block, Diagnostic> {
        let start = self.current().clone();
        let TokenKind::Identifier(keyword) = &start.kind else {
            return Err(self.error(
                start.span,
                "E_MEMORY_SYNTAX",
                "expected a declaration keyword such as `mission`, `priority`, `knowledge`, `ruling`, `system`, `responsibility`, `seam`, `role`, `policy`, `flow` or `step`",
            ));
        };
        let keyword = keyword.clone();
        self.position += 1;
        let name_token = self.current().clone();
        let TokenKind::String(name) = &name_token.kind else {
            return Err(self.error(
                name_token.span,
                "E_MEMORY_SYNTAX",
                format!("expected a quoted name after `{keyword}`"),
            ));
        };
        let name = name.clone();
        if !is_identity_safe(&name) {
            return Err(self.error(
                name_token.span,
                "E_MEMORY_NAME",
                format!(
                    "{name:?} cannot be part of a canonical identity; a name starts with a letter or digit and continues with letters, digits, '_' or '-'"
                ),
            ));
        }
        self.position += 1;
        let open = self.current().clone();
        if open.kind != TokenKind::LeftBrace {
            return Err(self.error(
                open.span,
                "E_MEMORY_SYNTAX",
                format!("expected `{{` after `{keyword} {name:?}`"),
            ));
        }
        self.position += 1;
        let mut fields: Vec<Field> = Vec::new();
        while self.current().kind != TokenKind::RightBrace {
            if matches!(self.current().kind, TokenKind::Eof) {
                return Err(self.error(
                    self.current().span,
                    "E_MEMORY_SYNTAX",
                    format!("`{keyword} {name:?}` is never closed with `}}`"),
                ));
            }
            let field = self.field()?;
            if let Some(previous) = fields.iter().find(|seen| seen.name == field.name) {
                return Err(self.error(
                    Span {
                        start: 0,
                        end: 0,
                        line: field.location.line,
                        column: field.location.column,
                    },
                    "E_MEMORY_FIELD",
                    format!(
                        "`{}` is given twice in `{keyword} {name:?}`; the first is at line {}",
                        field.name, previous.location.line
                    ),
                ));
            }
            fields.push(field);
        }
        self.position += 1;
        Ok(Block {
            keyword,
            name,
            location: self.location(start.span),
            fields,
        })
    }

    fn field(&mut self) -> Result<Field, Diagnostic> {
        let start = self.current().clone();
        let TokenKind::Identifier(name) = &start.kind else {
            return Err(self.error(start.span, "E_MEMORY_SYNTAX", "expected a field name"));
        };
        let name = name.clone();
        self.position += 1;
        let value = self.current().clone();
        match &value.kind {
            TokenKind::String(text) => {
                self.position += 1;
                Ok(Field {
                    name,
                    values: vec![text.clone()],
                    list: false,
                    location: self.location(start.span),
                })
            }
            TokenKind::LeftBracket => {
                self.position += 1;
                let mut values = Vec::new();
                while self.current().kind != TokenKind::RightBracket {
                    let element = self.current().clone();
                    let TokenKind::String(text) = &element.kind else {
                        return Err(self.error(
                            element.span,
                            "E_MEMORY_SYNTAX",
                            format!("`{name}` takes quoted values"),
                        ));
                    };
                    values.push(text.clone());
                    self.position += 1;
                    if self.current().kind == TokenKind::Comma {
                        self.position += 1;
                    }
                }
                self.position += 1;
                Ok(Field {
                    name,
                    values,
                    list: true,
                    location: self.location(start.span),
                })
            }
            _ => Err(self.error(
                value.span,
                "E_MEMORY_SYNTAX",
                format!("`{name}` takes a quoted value or a list of quoted values"),
            )),
        }
    }

    fn current(&self) -> &Token {
        self.tokens
            .get(self.position)
            .unwrap_or_else(|| self.tokens.last().expect("the lexer always emits Eof"))
    }

    fn location(&self, span: Span) -> Location {
        Location {
            file: self.file.to_owned(),
            line: span.line,
            column: span.column,
        }
    }

    fn error(&self, span: Span, code: &str, message: impl Into<String>) -> Diagnostic {
        Diagnostic {
            location: self.location(span),
            code: code.into(),
            message: message.into(),
        }
    }
}
