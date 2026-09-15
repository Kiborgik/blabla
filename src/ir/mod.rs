use crate::diagnostic::{Location, Span};
use serde_json::Value;

pub const MAX_INT: i64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Type {
    Bool,
    Int,
    Float,
    String,
    Null,
    Optional(Box<Type>),
    List(Box<Type>),
    Record(Vec<Field>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Field {
    pub name: String,
    pub ty: Type,
}

#[derive(Clone, Debug)]
pub struct Contract {
    pub state: Vec<Field>,
    pub actions: Vec<Action>,
    pub invariants: Vec<Predicate>,
}

#[derive(Clone, Debug)]
pub struct Action {
    pub name: String,
    pub kind: ActionKind,
    pub params: Vec<Field>,
    pub postconditions: Vec<Predicate>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActionKind {
    Application,
    Restart,
}

impl Type {
    pub fn is_scalar(&self) -> bool {
        matches!(self, Self::Bool | Self::Int | Self::Float | Self::String)
    }

    pub fn is_action_parameter(&self) -> bool {
        self.is_scalar() || matches!(self, Self::Optional(inner) if inner.is_scalar())
    }
}

#[derive(Clone, Debug)]
pub struct Predicate {
    pub label: String,
    pub expr: Expr,
    pub location: Location,
    pub source: String,
    pub slots: usize,
    pub forbidden: bool,
}

#[derive(Clone, Debug)]
pub struct Expr {
    pub kind: ExprKind,
    pub ty: Type,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub enum ExprKind {
    Literal(Value),
    Load(usize),
    Field {
        base: Box<Expr>,
        name: String,
    },
    Unary {
        op: UnaryOp,
        operand: Box<Expr>,
    },
    Binary {
        op: BinaryOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Count(Box<Expr>),
    Query {
        op: QueryOp,
        list: Box<Expr>,
        slot: usize,
        body: Box<Expr>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnaryOp {
    Not,
    Negate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinaryOp {
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QueryOp {
    Any,
    All,
    Unique,
}
