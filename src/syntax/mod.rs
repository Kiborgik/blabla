use crate::diagnostic::{Diagnostic, Span};

#[derive(Clone, Debug)]
pub struct Contract {
    pub declarations: Vec<Declaration>,
}

#[derive(Clone, Debug)]
pub enum Declaration {
    Type(TypeDeclaration),
    State(StateDeclaration),
    Action(ActionDeclaration),
    When(WhenDeclaration),
    Invariant(InvariantDeclaration),
}

#[derive(Clone, Debug)]
pub struct TypeDeclaration {
    pub name: String,
    pub name_span: Span,
    pub fields: Vec<FieldDeclaration>,
}

#[derive(Clone, Debug)]
pub struct StateDeclaration {
    pub name: String,
    pub name_span: Span,
    pub ty: TypeReference,
}

#[derive(Clone, Debug)]
pub struct ActionDeclaration {
    pub name: String,
    pub name_span: Span,
    pub params: Vec<FieldDeclaration>,
}

#[derive(Clone, Debug)]
pub struct WhenDeclaration {
    pub action: String,
    pub action_span: Span,
    pub predicates: Vec<PredicateDeclaration>,
}

#[derive(Clone, Debug)]
pub struct PredicateDeclaration {
    pub label: String,
    pub label_span: Span,
    pub location: Span,
    pub expr: Expression,
}

#[derive(Clone, Debug)]
pub struct InvariantDeclaration {
    pub label: String,
    pub label_span: Span,
    pub location: Span,
    pub forbidden: bool,
    pub expr: Expression,
}

#[derive(Clone, Debug)]
pub struct FieldDeclaration {
    pub name: String,
    pub name_span: Span,
    pub ty: TypeReference,
}

#[derive(Clone, Debug)]
pub struct TypeReference {
    pub kind: TypeReferenceKind,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub enum TypeReferenceKind {
    Named(String),
    List(Box<TypeReference>),
    Optional(Box<TypeReference>),
}

#[derive(Clone, Debug)]
pub struct Expression {
    pub kind: ExpressionKind,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub enum ExpressionKind {
    Bool(bool),
    Int(String),
    Float(String),
    Null,
    String(String),
    Name(String),
    Field {
        base: Box<Expression>,
        name: String,
        name_span: Span,
    },
    Unary {
        op: UnaryOperator,
        operand: Box<Expression>,
    },
    Binary {
        op: BinaryOperator,
        left: Box<Expression>,
        right: Box<Expression>,
    },
    Call {
        name: String,
        name_span: Span,
        arguments: Vec<Expression>,
    },
    Lambda {
        binder: String,
        binder_span: Span,
        body: Box<Expression>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnaryOperator {
    Not,
    Negate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinaryOperator {
    Equal,
    NotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
    Add,
    Subtract,
    And,
    Or,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TokenKind {
    Identifier(String),
    Integer(String),
    Float(String),
    String(String),
    LeftBrace,
    RightBrace,
    LeftBracket,
    RightBracket,
    LeftParen,
    RightParen,
    Colon,
    ColonColon,
    Comma,
    Dot,
    Arrow,
    ThinArrow,
    EqualEqual,
    BangEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
    Plus,
    Minus,
    Eof,
}

#[derive(Clone, Debug)]
pub(crate) struct Token {
    pub(crate) kind: TokenKind,
    pub(crate) span: Span,
}

pub fn parse(file: &str, source: &str) -> Result<Contract, Diagnostic> {
    let tokens = Lexer::new(file, source).lex()?;
    Parser {
        file,
        tokens,
        position: 0,
    }
    .parse_contract()
}

pub(crate) struct Lexer<'a> {
    file: &'a str,
    source: &'a str,
    offset: usize,
    line: usize,
    column: usize,
}

impl<'a> Lexer<'a> {
    pub(crate) fn new(file: &'a str, source: &'a str) -> Self {
        Self {
            file,
            source,
            offset: 0,
            line: 1,
            column: 1,
        }
    }

    pub(crate) fn lex(mut self) -> Result<Vec<Token>, Diagnostic> {
        let mut tokens = Vec::new();
        while self.offset < self.source.len() {
            let ch = self.current_char().unwrap();
            if ch.is_whitespace() {
                self.advance();
                continue;
            }
            let start = self.mark();
            let kind = match ch {
                '{' => self.single(TokenKind::LeftBrace),
                '}' => self.single(TokenKind::RightBrace),
                '[' => self.single(TokenKind::LeftBracket),
                ']' => self.single(TokenKind::RightBracket),
                '(' => self.single(TokenKind::LeftParen),
                ')' => self.single(TokenKind::RightParen),
                ':' => {
                    self.advance();
                    if self.current_char() == Some(':') {
                        self.advance();
                        TokenKind::ColonColon
                    } else {
                        TokenKind::Colon
                    }
                }
                ',' => self.single(TokenKind::Comma),
                '.' => self.single(TokenKind::Dot),
                '+' => self.single(TokenKind::Plus),
                '-' => {
                    self.advance();
                    if self.current_char() == Some('>') {
                        self.advance();
                        TokenKind::ThinArrow
                    } else {
                        TokenKind::Minus
                    }
                }
                '=' => {
                    self.advance();
                    if self.current_char() == Some('=') {
                        self.advance();
                        TokenKind::EqualEqual
                    } else if self.current_char() == Some('>') {
                        self.advance();
                        TokenKind::Arrow
                    } else {
                        return Err(self.error(start, "E_SYNTAX", "expected '=' or '>' after '='"));
                    }
                }
                '!' => {
                    self.advance();
                    if self.current_char() == Some('=') {
                        self.advance();
                        TokenKind::BangEqual
                    } else {
                        return Err(self.error(start, "E_SYNTAX", "expected '=' after '!'"));
                    }
                }
                '<' => {
                    self.advance();
                    if self.current_char() == Some('=') {
                        self.advance();
                        TokenKind::LessEqual
                    } else {
                        TokenKind::Less
                    }
                }
                '>' => {
                    self.advance();
                    if self.current_char() == Some('=') {
                        self.advance();
                        TokenKind::GreaterEqual
                    } else {
                        TokenKind::Greater
                    }
                }
                '"' => self.string(start)?,
                c if c.is_ascii_digit() => self.number(start)?,
                c if c.is_ascii_alphabetic() || c == '_' => self.identifier(),
                _ => {
                    return Err(self.error(
                        start,
                        "E_SYNTAX",
                        format!("unexpected character '{ch}'"),
                    ));
                }
            };
            tokens.push(Token {
                kind,
                span: self.span_from(start),
            });
        }
        let span = Span {
            start: self.offset,
            end: self.offset,
            line: self.line,
            column: self.column,
        };
        tokens.push(Token {
            kind: TokenKind::Eof,
            span,
        });
        Ok(tokens)
    }

    fn single(&mut self, kind: TokenKind) -> TokenKind {
        self.advance();
        kind
    }

    fn identifier(&mut self) -> TokenKind {
        let start = self.offset;
        while matches!(self.current_char(), Some(c) if c.is_ascii_alphanumeric() || c == '_') {
            self.advance();
        }
        TokenKind::Identifier(self.source[start..self.offset].to_owned())
    }

    fn number(&mut self, span: Span) -> Result<TokenKind, Diagnostic> {
        let start = self.offset;
        while matches!(self.current_char(), Some(c) if c.is_ascii_digit()) {
            self.advance();
        }
        let mut floating = false;
        if self.current_char() == Some('.') {
            floating = true;
            self.advance();
            if !matches!(self.current_char(), Some(c) if c.is_ascii_digit()) {
                return Err(self.error(span, "E_NUMBER", "expected digits after decimal point"));
            }
            while matches!(self.current_char(), Some(c) if c.is_ascii_digit()) {
                self.advance();
            }
        }
        if matches!(self.current_char(), Some('e' | 'E')) {
            floating = true;
            self.advance();
            if matches!(self.current_char(), Some('+' | '-')) {
                self.advance();
            }
            if !matches!(self.current_char(), Some(c) if c.is_ascii_digit()) {
                return Err(self.error(span, "E_NUMBER", "expected exponent digits"));
            }
            while matches!(self.current_char(), Some(c) if c.is_ascii_digit()) {
                self.advance();
            }
        }
        let value = self.source[start..self.offset].to_owned();
        Ok(if floating {
            TokenKind::Float(value)
        } else {
            TokenKind::Integer(value)
        })
    }

    fn string(&mut self, start: Span) -> Result<TokenKind, Diagnostic> {
        let start_offset = self.offset;
        self.advance();
        let mut escaped = false;
        while let Some(ch) = self.current_char() {
            if !escaped && ch == '"' {
                self.advance();
                let raw = &self.source[start_offset..self.offset];
                return serde_json::from_str(raw)
                    .map(TokenKind::String)
                    .map_err(|error| {
                        self.error(
                            start,
                            "E_STRING",
                            format!("invalid string literal: {error}"),
                        )
                    });
            }
            if !escaped && (ch == '\n' || ch == '\r') {
                return Err(self.error(start, "E_STRING", "unterminated string literal"));
            }
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            }
            self.advance();
        }
        Err(self.error(start, "E_STRING", "unterminated string literal"))
    }

    fn current_char(&self) -> Option<char> {
        self.source[self.offset..].chars().next()
    }

    fn advance(&mut self) {
        if let Some(ch) = self.current_char() {
            self.offset += ch.len_utf8();
            if ch == '\n' {
                self.line += 1;
                self.column = 1;
            } else {
                self.column += 1;
            }
        }
    }

    fn mark(&self) -> Span {
        Span {
            start: self.offset,
            end: self.offset,
            line: self.line,
            column: self.column,
        }
    }

    fn span_from(&self, start: Span) -> Span {
        Span {
            end: self.offset,
            ..start
        }
    }

    fn error(&self, span: Span, code: &str, message: impl Into<String>) -> Diagnostic {
        Diagnostic::new(self.file, span, code, message)
    }
}

struct Parser<'a> {
    file: &'a str,
    tokens: Vec<Token>,
    position: usize,
}

impl Parser<'_> {
    fn parse_contract(mut self) -> Result<Contract, Diagnostic> {
        let mut declarations = Vec::new();
        while !self.at(&TokenKind::Eof) {
            let token = self.current().clone();
            let keyword = match &token.kind {
                TokenKind::Identifier(value) => value.as_str(),
                _ => return Err(self.error(token.span, "E_DECLARATION", "expected a declaration")),
            };
            declarations.push(match keyword {
                "type" => Declaration::Type(self.parse_type_declaration()?),
                "state" => Declaration::State(self.parse_state_declaration()?),
                "action" => Declaration::Action(self.parse_action_declaration()?),
                "when" => Declaration::When(self.parse_when_declaration()?),
                "always" => Declaration::Invariant(self.parse_invariant(false)?),
                "never" => Declaration::Invariant(self.parse_invariant(true)?),
                _ => {
                    return Err(self.error(
                        token.span,
                        "E_DECLARATION",
                        format!("unknown declaration '{keyword}'"),
                    ));
                }
            });
        }
        Ok(Contract { declarations })
    }

    fn parse_type_declaration(&mut self) -> Result<TypeDeclaration, Diagnostic> {
        self.expect_keyword("type")?;
        let (name, name_span) = self.expect_identifier("type name")?;
        self.expect(TokenKind::LeftBrace, "expected '{' after type name")?;
        let fields = self.parse_fields(TokenKind::RightBrace)?;
        self.expect(TokenKind::RightBrace, "expected '}' after type fields")?;
        Ok(TypeDeclaration {
            name,
            name_span,
            fields,
        })
    }

    fn parse_state_declaration(&mut self) -> Result<StateDeclaration, Diagnostic> {
        self.expect_keyword("state")?;
        let (name, name_span) = self.expect_identifier("state name")?;
        self.expect(TokenKind::Colon, "expected ':' after state name")?;
        let ty = self.parse_type_reference()?;
        Ok(StateDeclaration {
            name,
            name_span,
            ty,
        })
    }

    fn parse_action_declaration(&mut self) -> Result<ActionDeclaration, Diagnostic> {
        self.expect_keyword("action")?;
        let (name, name_span) = self.expect_identifier("action name")?;
        self.expect(TokenKind::LeftParen, "expected '(' after action name")?;
        let params = self.parse_fields(TokenKind::RightParen)?;
        self.expect(
            TokenKind::RightParen,
            "expected ')' after action parameters",
        )?;
        Ok(ActionDeclaration {
            name,
            name_span,
            params,
        })
    }

    fn parse_fields(&mut self, end: TokenKind) -> Result<Vec<FieldDeclaration>, Diagnostic> {
        let mut fields = Vec::new();
        if self.at(&end) {
            return Ok(fields);
        }
        loop {
            let (name, name_span) = self.expect_identifier("field name")?;
            self.expect(TokenKind::Colon, "expected ':' after field name")?;
            let ty = self.parse_type_reference()?;
            fields.push(FieldDeclaration {
                name,
                name_span,
                ty,
            });
            if !self.consume(&TokenKind::Comma) {
                break;
            }
            if self.at(&end) {
                return Err(self.error(
                    self.current().span,
                    "E_SYNTAX",
                    "trailing commas are not supported",
                ));
            }
        }
        Ok(fields)
    }

    fn parse_type_reference(&mut self) -> Result<TypeReference, Diagnostic> {
        if self.consume(&TokenKind::LeftBracket) {
            let start = self.previous().span;
            let inner = self.parse_type_reference()?;
            let end = self
                .expect(TokenKind::RightBracket, "expected ']' after list type")?
                .span;
            return Ok(TypeReference {
                kind: TypeReferenceKind::List(Box::new(inner)),
                span: joined(start, end),
            });
        }
        let (name, span) = self.expect_identifier("type")?;
        if name == "optional" {
            self.expect(TokenKind::Less, "expected '<' after optional")?;
            let inner = self.parse_type_reference()?;
            let end = self
                .expect(TokenKind::Greater, "expected '>' after optional type")?
                .span;
            return Ok(TypeReference {
                kind: TypeReferenceKind::Optional(Box::new(inner)),
                span: joined(span, end),
            });
        }
        Ok(TypeReference {
            kind: TypeReferenceKind::Named(name),
            span,
        })
    }

    fn parse_when_declaration(&mut self) -> Result<WhenDeclaration, Diagnostic> {
        self.expect_keyword("when")?;
        let (action, action_span) = self.expect_identifier("action name")?;
        self.expect(TokenKind::LeftBrace, "expected '{' after action name")?;
        let mut predicates = Vec::new();
        while !self.at(&TokenKind::RightBrace) {
            if self.at(&TokenKind::Eof) {
                return Err(self.error(self.current().span, "E_SYNTAX", "unterminated when block"));
            }
            let location = self.expect_keyword("expect")?.span;
            let (label, label_span) = self.expect_string("property label")?;
            self.expect(TokenKind::Colon, "expected ':' after property label")?;
            let expr = self.parse_expression()?;
            predicates.push(PredicateDeclaration {
                label,
                label_span,
                location,
                expr,
            });
        }
        self.advance();
        Ok(WhenDeclaration {
            action,
            action_span,
            predicates,
        })
    }

    fn parse_invariant(&mut self, forbidden: bool) -> Result<InvariantDeclaration, Diagnostic> {
        let keyword = if forbidden { "never" } else { "always" };
        let location = self.expect_keyword(keyword)?.span;
        let (label, label_span) = self.expect_string("property label")?;
        self.expect(TokenKind::LeftBrace, "expected '{' after property label")?;
        let expr = self.parse_expression()?;
        self.expect(TokenKind::RightBrace, "expected '}' after invariant")?;
        Ok(InvariantDeclaration {
            label,
            label_span,
            location,
            forbidden,
            expr,
        })
    }

    fn parse_expression(&mut self) -> Result<Expression, Diagnostic> {
        if let (TokenKind::Identifier(binder), TokenKind::Arrow) =
            (&self.current().kind, &self.peek().kind)
        {
            let binder = binder.clone();
            let binder_span = self.current().span;
            self.advance();
            self.advance();
            let body = self.parse_expression()?;
            return Ok(Expression {
                span: joined(binder_span, body.span),
                kind: ExpressionKind::Lambda {
                    binder,
                    binder_span,
                    body: Box::new(body),
                },
            });
        }
        self.parse_or()
    }

    fn parse_or(&mut self) -> Result<Expression, Diagnostic> {
        let mut expr = self.parse_and()?;
        while self.consume_keyword("or") {
            let right = self.parse_and()?;
            expr = binary(BinaryOperator::Or, expr, right);
        }
        Ok(expr)
    }

    fn parse_and(&mut self) -> Result<Expression, Diagnostic> {
        let mut expr = self.parse_equality()?;
        while self.consume_keyword("and") {
            let right = self.parse_equality()?;
            expr = binary(BinaryOperator::And, expr, right);
        }
        Ok(expr)
    }

    fn parse_equality(&mut self) -> Result<Expression, Diagnostic> {
        let left = self.parse_ordered()?;
        let op = if self.consume(&TokenKind::EqualEqual) {
            Some(BinaryOperator::Equal)
        } else if self.consume(&TokenKind::BangEqual) {
            Some(BinaryOperator::NotEqual)
        } else {
            None
        };
        let Some(op) = op else { return Ok(left) };
        if is_comparison(&left) {
            return Err(self.error(
                left.span,
                "E_CHAINED_COMPARISON",
                "chained comparisons require a Boolean operator",
            ));
        }
        let right = self.parse_ordered()?;
        if is_comparison(&right)
            || self.at(&TokenKind::EqualEqual)
            || self.at(&TokenKind::BangEqual)
        {
            return Err(self.error(
                self.current().span,
                "E_CHAINED_COMPARISON",
                "chained comparisons require a Boolean operator",
            ));
        }
        Ok(binary(op, left, right))
    }

    fn parse_ordered(&mut self) -> Result<Expression, Diagnostic> {
        let left = self.parse_additive()?;
        let op = if self.consume(&TokenKind::Less) {
            Some(BinaryOperator::Less)
        } else if self.consume(&TokenKind::LessEqual) {
            Some(BinaryOperator::LessEqual)
        } else if self.consume(&TokenKind::Greater) {
            Some(BinaryOperator::Greater)
        } else if self.consume(&TokenKind::GreaterEqual) {
            Some(BinaryOperator::GreaterEqual)
        } else {
            None
        };
        let Some(op) = op else { return Ok(left) };
        let right = self.parse_additive()?;
        if matches!(
            self.current().kind,
            TokenKind::Less | TokenKind::LessEqual | TokenKind::Greater | TokenKind::GreaterEqual
        ) {
            return Err(self.error(
                self.current().span,
                "E_CHAINED_COMPARISON",
                "chained comparisons require a Boolean operator",
            ));
        }
        Ok(binary(op, left, right))
    }

    fn parse_additive(&mut self) -> Result<Expression, Diagnostic> {
        let mut expr = self.parse_unary()?;
        loop {
            let op = if self.consume(&TokenKind::Plus) {
                Some(BinaryOperator::Add)
            } else if self.consume(&TokenKind::Minus) {
                Some(BinaryOperator::Subtract)
            } else {
                None
            };
            let Some(op) = op else { break };
            let right = self.parse_unary()?;
            expr = binary(op, expr, right);
        }
        Ok(expr)
    }

    fn parse_unary(&mut self) -> Result<Expression, Diagnostic> {
        if self.consume_keyword("not") {
            let start = self.previous().span;
            let operand = self.parse_unary()?;
            return Ok(Expression {
                span: joined(start, operand.span),
                kind: ExpressionKind::Unary {
                    op: UnaryOperator::Not,
                    operand: Box::new(operand),
                },
            });
        }
        if self.consume(&TokenKind::Minus) {
            let start = self.previous().span;
            let operand = self.parse_unary()?;
            return Ok(Expression {
                span: joined(start, operand.span),
                kind: ExpressionKind::Unary {
                    op: UnaryOperator::Negate,
                    operand: Box::new(operand),
                },
            });
        }
        self.parse_postfix()
    }

    fn parse_postfix(&mut self) -> Result<Expression, Diagnostic> {
        let mut expr = self.parse_primary()?;
        while self.consume(&TokenKind::Dot) {
            let (name, name_span) = self.expect_identifier("field name")?;
            let span = joined(expr.span, name_span);
            expr = Expression {
                span,
                kind: ExpressionKind::Field {
                    base: Box::new(expr),
                    name,
                    name_span,
                },
            };
        }
        Ok(expr)
    }

    fn parse_primary(&mut self) -> Result<Expression, Diagnostic> {
        let token = self.current().clone();
        match token.kind {
            TokenKind::Float(value) => {
                self.advance();
                Ok(Expression {
                    kind: ExpressionKind::Float(value),
                    span: token.span,
                })
            }
            TokenKind::Integer(value) => {
                self.advance();
                Ok(Expression {
                    kind: ExpressionKind::Int(value),
                    span: token.span,
                })
            }
            TokenKind::String(value) => {
                self.advance();
                Ok(Expression {
                    kind: ExpressionKind::String(value),
                    span: token.span,
                })
            }
            TokenKind::Identifier(name) if name == "null" => {
                self.advance();
                Ok(Expression {
                    kind: ExpressionKind::Null,
                    span: token.span,
                })
            }
            TokenKind::Identifier(name) if name == "true" || name == "false" => {
                self.advance();
                Ok(Expression {
                    kind: ExpressionKind::Bool(name == "true"),
                    span: token.span,
                })
            }
            TokenKind::Identifier(name) => {
                self.advance();
                if self.consume(&TokenKind::LeftParen) {
                    let mut arguments = Vec::new();
                    if !self.at(&TokenKind::RightParen) {
                        loop {
                            arguments.push(self.parse_expression()?);
                            if !self.consume(&TokenKind::Comma) {
                                break;
                            }
                        }
                    }
                    let end = self
                        .expect(TokenKind::RightParen, "expected ')' after arguments")?
                        .span;
                    Ok(Expression {
                        span: joined(token.span, end),
                        kind: ExpressionKind::Call {
                            name,
                            name_span: token.span,
                            arguments,
                        },
                    })
                } else {
                    Ok(Expression {
                        kind: ExpressionKind::Name(name),
                        span: token.span,
                    })
                }
            }
            TokenKind::LeftParen => {
                self.advance();
                let start = token.span;
                let mut expr = self.parse_expression()?;
                let end = self
                    .expect(TokenKind::RightParen, "expected ')' after expression")?
                    .span;
                expr.span = joined(start, end);
                Ok(expr)
            }
            _ => Err(self.error(token.span, "E_EXPRESSION", "expected an expression")),
        }
    }

    fn expect_keyword(&mut self, expected: &str) -> Result<Token, Diagnostic> {
        let token = self.current().clone();
        if matches!(&token.kind, TokenKind::Identifier(value) if value == expected) {
            self.advance();
            Ok(token)
        } else {
            Err(self.error(token.span, "E_SYNTAX", format!("expected '{expected}'")))
        }
    }

    fn consume_keyword(&mut self, expected: &str) -> bool {
        if matches!(&self.current().kind, TokenKind::Identifier(value) if value == expected) {
            self.advance();
            true
        } else {
            false
        }
    }

    fn expect_identifier(&mut self, description: &str) -> Result<(String, Span), Diagnostic> {
        let token = self.current().clone();
        if let TokenKind::Identifier(value) = token.kind {
            self.advance();
            Ok((value, token.span))
        } else {
            Err(self.error(token.span, "E_SYNTAX", format!("expected {description}")))
        }
    }

    fn expect_string(&mut self, description: &str) -> Result<(String, Span), Diagnostic> {
        let token = self.current().clone();
        if let TokenKind::String(value) = token.kind {
            self.advance();
            Ok((value, token.span))
        } else {
            Err(self.error(token.span, "E_SYNTAX", format!("expected {description}")))
        }
    }

    fn expect(&mut self, expected: TokenKind, message: &str) -> Result<Token, Diagnostic> {
        let token = self.current().clone();
        if token.kind == expected {
            self.advance();
            Ok(token)
        } else {
            Err(self.error(token.span, "E_SYNTAX", message))
        }
    }

    fn consume(&mut self, expected: &TokenKind) -> bool {
        if self.at(expected) {
            self.advance();
            true
        } else {
            false
        }
    }

    fn at(&self, expected: &TokenKind) -> bool {
        &self.current().kind == expected
    }

    fn current(&self) -> &Token {
        &self.tokens[self.position]
    }

    fn peek(&self) -> &Token {
        &self.tokens[(self.position + 1).min(self.tokens.len() - 1)]
    }

    fn previous(&self) -> &Token {
        &self.tokens[self.position - 1]
    }

    fn advance(&mut self) {
        if self.position + 1 < self.tokens.len() {
            self.position += 1;
        }
    }

    fn error(&self, span: Span, code: &str, message: impl Into<String>) -> Diagnostic {
        Diagnostic::new(self.file, span, code, message)
    }
}

fn binary(op: BinaryOperator, left: Expression, right: Expression) -> Expression {
    Expression {
        span: joined(left.span, right.span),
        kind: ExpressionKind::Binary {
            op,
            left: Box::new(left),
            right: Box::new(right),
        },
    }
}

fn is_comparison(expr: &Expression) -> bool {
    matches!(
        expr.kind,
        ExpressionKind::Binary {
            op: BinaryOperator::Equal
                | BinaryOperator::NotEqual
                | BinaryOperator::Less
                | BinaryOperator::LessEqual
                | BinaryOperator::Greater
                | BinaryOperator::GreaterEqual,
            ..
        }
    )
}

fn joined(start: Span, end: Span) -> Span {
    Span {
        end: end.end,
        ..start
    }
}
