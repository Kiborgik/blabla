use crate::diagnostic::{Diagnostic, Location, Span};
use crate::ir::{
    Action, ActionKind, BinaryOp, Contract, Expr, ExprKind, Field, MAX_INT, Predicate, QueryOp,
    Type, UnaryOp,
};
use crate::syntax::{
    self, BinaryOperator, Declaration, Expression, ExpressionKind, FieldDeclaration,
    InvariantDeclaration, PredicateDeclaration, TypeDeclaration, TypeReference, TypeReferenceKind,
    UnaryOperator,
};
use serde_json::{Number, Value};
use std::collections::{HashMap, HashSet};

const RESERVED_VALUE_NAMES: [&str; 9] = [
    "true", "false", "null", "not", "and", "or", "before", "input", "after",
];

pub fn compile(file: &str, source: &str) -> Result<Contract, Diagnostic> {
    let syntax = syntax::parse(file, source)?;
    compile_units(&[Unit {
        file,
        source,
        group: None,
        declarations: &syntax.declarations,
    }])
}

#[derive(Clone, Copy)]
pub struct Unit<'a> {
    pub file: &'a str,
    pub source: &'a str,
    pub group: Option<&'a str>,
    pub declarations: &'a [Declaration],
}

pub fn compile_units(units: &[Unit<'_>]) -> Result<Contract, Diagnostic> {
    Compiler::new(units).compile()
}

fn declarations<'a>(units: &'a [Unit<'a>]) -> impl Iterator<Item = (usize, &'a Declaration)> {
    units.iter().enumerate().flat_map(|(index, unit)| {
        unit.declarations
            .iter()
            .map(move |declaration| (index, declaration))
    })
}

struct Compiler<'a> {
    units: &'a [Unit<'a>],
    current: usize,
    type_declarations: HashMap<String, (usize, &'a TypeDeclaration)>,
    type_repeats: Vec<(usize, &'a TypeDeclaration)>,
    type_units: HashMap<String, Vec<usize>>,
    resolved_types: HashMap<String, Type>,
    resolving_types: HashSet<String>,
}

impl<'a> Compiler<'a> {
    fn new(units: &'a [Unit<'a>]) -> Self {
        Self {
            units,
            current: 0,
            type_declarations: HashMap::new(),
            type_repeats: Vec::new(),
            type_units: HashMap::new(),
            resolved_types: HashMap::new(),
            resolving_types: HashSet::new(),
        }
    }

    fn compile(mut self) -> Result<Contract, Diagnostic> {
        self.collect_type_declarations()?;
        let units = self.units;
        for (unit, declaration) in declarations(units) {
            if let Declaration::Type(declaration) = declaration {
                self.current = unit;
                self.resolve_named_type(&declaration.name, declaration.name_span)?;
            }
        }
        self.check_type_repeats()?;

        let state_units = self.declaring_units(|declaration| match declaration {
            Declaration::State(declaration) => Some(declaration.name.as_str()),
            _ => None,
        });
        let action_units = self.declaring_units(|declaration| match declaration {
            Declaration::Action(declaration) => Some(declaration.name.as_str()),
            _ => None,
        });
        let mut state: Vec<Field> = Vec::new();
        let mut seen_state = HashSet::new();
        let mut actions: Vec<Action> = Vec::new();
        let mut action_indices = HashMap::new();
        let mut seen_actions = HashSet::new();

        for (unit, declaration) in declarations(units) {
            self.current = unit;
            match declaration {
                Declaration::State(declaration) => {
                    self.reject_reserved_value_name(&declaration.name, declaration.name_span)?;
                    if !seen_state.insert((unit, declaration.name.clone())) {
                        return Err(self.error(
                            declaration.name_span,
                            "E_DUPLICATE_STATE",
                            format!("duplicate state declaration '{}'", declaration.name),
                        ));
                    }
                    let field = Field {
                        name: declaration.name.clone(),
                        ty: self.resolve_type_reference(&declaration.ty)?,
                    };
                    match state
                        .iter()
                        .position(|existing| existing.name == field.name)
                    {
                        None => state.push(field),
                        Some(index) if state[index] == field => {}
                        Some(_) => {
                            return Err(self.error(
                                declaration.name_span,
                                "E_INCOMPATIBLE_STATE",
                                format!(
                                    "state '{}' declared incompatibly in: {}",
                                    declaration.name,
                                    self.files(&state_units[&declaration.name])
                                ),
                            ));
                        }
                    }
                }
                Declaration::Action(declaration) => {
                    if !seen_actions.insert((unit, declaration.name.clone())) {
                        return Err(self.error(
                            declaration.name_span,
                            "E_DUPLICATE_ACTION",
                            format!("duplicate action declaration '{}'", declaration.name),
                        ));
                    }
                    let params = self.resolve_fields(&declaration.params, "action parameter")?;
                    let kind = if declaration.name == "restart" {
                        if !params.is_empty() {
                            return Err(self.error(
                                declaration.name_span,
                                "E_RESTART_PARAMETERS",
                                "trusted restart takes no parameters",
                            ));
                        }
                        ActionKind::Restart
                    } else {
                        ActionKind::Application
                    };
                    for param in &params {
                        if !param.ty.is_action_parameter() {
                            return Err(self.error(
                                declaration.name_span,
                                "E_ACTION_PARAMETER_TYPE",
                                format!(
                                    "action parameter '{}' must have a scalar or optional scalar type",
                                    param.name
                                ),
                            ));
                        }
                    }
                    match action_indices.get(&declaration.name) {
                        None => {
                            action_indices.insert(declaration.name.clone(), actions.len());
                            actions.push(Action {
                                name: declaration.name.clone(),
                                kind,
                                params,
                                postconditions: Vec::new(),
                            });
                        }
                        Some(&index) => {
                            let existing: &Action = &actions[index];
                            if existing.kind != kind || existing.params != params {
                                return Err(self.error(
                                    declaration.name_span,
                                    "E_INCOMPATIBLE_ACTION",
                                    format!(
                                        "action '{}' declared incompatibly in: {}",
                                        declaration.name,
                                        self.files(&action_units[&declaration.name])
                                    ),
                                ));
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        if actions.is_empty() {
            self.current = self.first_unit();
            return Err(self.error(
                self.first_span(),
                "E_NO_ACTIONS",
                "contract must declare at least one action",
            ));
        }

        let state_type = Type::Record(state.clone());
        let mut invariants = Vec::new();
        let mut labels = HashSet::new();
        let mut predicate_count = 0;

        for (unit, declaration) in declarations(units) {
            self.current = unit;
            match declaration {
                Declaration::When(when) => {
                    let Some(&action_index) = action_indices.get(&when.action) else {
                        return Err(self.error(
                            when.action_span,
                            "E_UNKNOWN_ACTION",
                            format!("unknown action '{}'", when.action),
                        ));
                    };
                    for predicate in &when.predicates {
                        self.insert_label(
                            &mut labels,
                            &self.qualify(&predicate.label),
                            predicate.label_span,
                        )?;
                        let lowered = self.lower_postcondition(
                            predicate,
                            &state_type,
                            &actions[action_index].params,
                        )?;
                        actions[action_index].postconditions.push(lowered);
                        predicate_count += 1;
                    }
                }
                Declaration::Invariant(invariant) => {
                    self.insert_label(
                        &mut labels,
                        &self.qualify(&invariant.label),
                        invariant.label_span,
                    )?;
                    invariants.push(self.lower_invariant(invariant, &state)?);
                    predicate_count += 1;
                }
                _ => {}
            }
        }

        if predicate_count == 0 {
            self.current = self.first_unit();
            return Err(self.error(
                self.first_span(),
                "E_NO_PREDICATES",
                "contract must declare at least one predicate",
            ));
        }

        Ok(Contract {
            state,
            actions,
            invariants,
        })
    }

    fn declaring_units<'d>(
        &self,
        name_of: impl Fn(&'d Declaration) -> Option<&'d str>,
    ) -> HashMap<String, Vec<usize>>
    where
        'a: 'd,
    {
        let mut result: HashMap<String, Vec<usize>> = HashMap::new();
        for (unit, declaration) in declarations(self.units) {
            if let Some(name) = name_of(declaration) {
                let units = result.entry(name.to_owned()).or_default();
                if !units.contains(&unit) {
                    units.push(unit);
                }
            }
        }
        result
    }

    fn files(&self, units: &[usize]) -> String {
        units
            .iter()
            .map(|&unit| self.units[unit].file)
            .collect::<Vec<_>>()
            .join(", ")
    }

    fn first_unit(&self) -> usize {
        self.units
            .iter()
            .position(|unit| !unit.declarations.is_empty())
            .unwrap_or(0)
    }

    fn qualify(&self, label: &str) -> String {
        match self.units[self.current].group {
            Some(group) => format!("{group}::{label}"),
            None => label.to_owned(),
        }
    }

    fn check_type_repeats(&mut self) -> Result<(), Diagnostic> {
        let repeats = std::mem::take(&mut self.type_repeats);
        for (unit, declaration) in repeats {
            self.current = unit;
            let fields = self.resolve_fields(&declaration.fields, "record field")?;
            let expected = self.resolve_named_type(&declaration.name, declaration.name_span)?;
            if expected != Type::Record(fields) {
                return Err(self.error(
                    declaration.name_span,
                    "E_INCOMPATIBLE_TYPE",
                    format!(
                        "type '{}' declared incompatibly in: {}",
                        declaration.name,
                        self.files(&self.type_units[&declaration.name])
                    ),
                ));
            }
        }
        Ok(())
    }

    fn collect_type_declarations(&mut self) -> Result<(), Diagnostic> {
        let units = self.units;
        for (unit, declaration) in declarations(units) {
            let Declaration::Type(declaration) = declaration else {
                continue;
            };
            self.current = unit;
            let same_unit = self
                .type_units
                .get(&declaration.name)
                .is_some_and(|units| units.contains(&unit));
            if matches!(
                declaration.name.as_str(),
                "bool" | "int" | "float" | "string" | "optional" | "null"
            ) || same_unit
            {
                return Err(self.error(
                    declaration.name_span,
                    "E_DUPLICATE_TYPE",
                    format!("duplicate type declaration '{}'", declaration.name),
                ));
            }
            self.type_units
                .entry(declaration.name.clone())
                .or_default()
                .push(unit);
            if self.type_declarations.contains_key(&declaration.name) {
                self.type_repeats.push((unit, declaration));
            } else {
                self.type_declarations
                    .insert(declaration.name.clone(), (unit, declaration));
            }
        }
        Ok(())
    }

    fn resolve_named_type(&mut self, name: &str, span: Span) -> Result<Type, Diagnostic> {
        match name {
            "bool" => return Ok(Type::Bool),
            "int" => return Ok(Type::Int),
            "float" => return Ok(Type::Float),
            "string" => return Ok(Type::String),
            _ => {}
        }
        if let Some(ty) = self.resolved_types.get(name) {
            return Ok(ty.clone());
        }
        let Some((owner, declaration)) = self.type_declarations.get(name).copied() else {
            return Err(self.error(span, "E_UNKNOWN_TYPE", format!("unknown type '{name}'")));
        };
        if !self.resolving_types.insert(name.to_owned()) {
            return Err(self.error(
                span,
                "E_RECURSIVE_TYPE",
                format!("recursive type '{name}' is not supported"),
            ));
        }
        let previous = self.current;
        self.current = owner;
        let fields = self.resolve_fields(&declaration.fields, "record field");
        self.current = previous;
        let fields = fields?;
        self.resolving_types.remove(name);
        let ty = Type::Record(fields);
        self.resolved_types.insert(name.to_owned(), ty.clone());
        Ok(ty)
    }

    fn resolve_type_reference(&mut self, reference: &TypeReference) -> Result<Type, Diagnostic> {
        match &reference.kind {
            TypeReferenceKind::Named(name) => self.resolve_named_type(name, reference.span),
            TypeReferenceKind::List(inner) => {
                Ok(Type::List(Box::new(self.resolve_type_reference(inner)?)))
            }
            TypeReferenceKind::Optional(inner) => {
                let ty = self.resolve_type_reference(inner)?;
                if matches!(ty, Type::Optional(_)) {
                    return Err(self.error(
                        reference.span,
                        "E_OPTIONAL_TYPE",
                        "nested optionals have no distinct JSON representation",
                    ));
                }
                Ok(Type::Optional(Box::new(ty)))
            }
        }
    }

    fn resolve_fields(
        &mut self,
        declarations: &[FieldDeclaration],
        description: &str,
    ) -> Result<Vec<Field>, Diagnostic> {
        let mut fields = Vec::new();
        let mut names = HashSet::new();
        for declaration in declarations {
            if !names.insert(declaration.name.clone()) {
                return Err(self.error(
                    declaration.name_span,
                    "E_DUPLICATE_FIELD",
                    format!("duplicate {description} '{}'", declaration.name),
                ));
            }
            fields.push(Field {
                name: declaration.name.clone(),
                ty: self.resolve_type_reference(&declaration.ty)?,
            });
        }
        Ok(fields)
    }

    fn insert_label(
        &self,
        labels: &mut HashSet<String>,
        label: &str,
        span: Span,
    ) -> Result<(), Diagnostic> {
        if !labels.insert(label.to_owned()) {
            return Err(self.error(
                span,
                "E_DUPLICATE_LABEL",
                format!("duplicate property label '{label}'"),
            ));
        }
        Ok(())
    }

    fn lower_postcondition(
        &self,
        predicate: &PredicateDeclaration,
        state_type: &Type,
        params: &[Field],
    ) -> Result<Predicate, Diagnostic> {
        let mut environment =
            Environment::postcondition(state_type.clone(), Type::Record(params.to_vec()));
        let expr = self.lower_expression(&predicate.expr, &mut environment)?;
        self.require_type(&expr, &Type::Bool, "postcondition")?;
        Ok(self.predicate(
            &predicate.label,
            predicate.location,
            &predicate.expr,
            expr,
            environment.next_slot,
            false,
        ))
    }

    fn lower_invariant(
        &self,
        invariant: &InvariantDeclaration,
        state: &[Field],
    ) -> Result<Predicate, Diagnostic> {
        let mut environment = Environment::invariant(state);
        let mut expr = self.lower_expression(&invariant.expr, &mut environment)?;
        self.require_type(&expr, &Type::Bool, "invariant")?;
        if invariant.forbidden {
            expr = Expr {
                span: expr.span,
                ty: Type::Bool,
                kind: ExprKind::Unary {
                    op: UnaryOp::Not,
                    operand: Box::new(expr),
                },
            };
        }
        Ok(self.predicate(
            &invariant.label,
            invariant.location,
            &invariant.expr,
            expr,
            environment.next_slot,
            invariant.forbidden,
        ))
    }

    fn predicate(
        &self,
        label: &str,
        location: Span,
        syntax_expr: &Expression,
        expr: Expr,
        slots: usize,
        forbidden: bool,
    ) -> Predicate {
        let unit = &self.units[self.current];
        Predicate {
            label: self.qualify(label),
            expr,
            location: Location {
                file: unit.file.to_owned(),
                line: location.line,
                column: location.column,
            },
            source: unit.source[syntax_expr.span.start..syntax_expr.span.end]
                .trim()
                .to_owned(),
            slots,
            forbidden,
        }
    }

    fn lower_expression(
        &self,
        expression: &Expression,
        environment: &mut Environment,
    ) -> Result<Expr, Diagnostic> {
        let mut lowered = self.lower_expression_inner(expression, environment)?;
        if let Type::Optional(inner) = &lowered.ty
            && access_path(expression).is_some_and(|path| environment.nonnull.contains(&path))
        {
            lowered.ty = inner.as_ref().clone();
        }
        Ok(lowered)
    }

    fn lower_expression_inner(
        &self,
        expression: &Expression,
        environment: &mut Environment,
    ) -> Result<Expr, Diagnostic> {
        let span = expression.span;
        match &expression.kind {
            ExpressionKind::Null => Ok(literal(Value::Null, Type::Null, span)),
            ExpressionKind::Float(value) => {
                let number = value
                    .parse::<f64>()
                    .ok()
                    .and_then(Number::from_f64)
                    .ok_or_else(|| {
                        self.error(span, "E_FLOAT_RANGE", "float literal must be finite")
                    })?;
                Ok(literal(Value::Number(number), Type::Float, span))
            }
            ExpressionKind::Bool(value) => Ok(literal(Value::Bool(*value), Type::Bool, span)),
            ExpressionKind::String(value) => {
                Ok(literal(Value::String(value.clone()), Type::String, span))
            }
            ExpressionKind::Int(value) => {
                let parsed = value.parse::<i128>().map_err(|_| {
                    self.error(
                        span,
                        "E_INTEGER_RANGE",
                        "integer literal is outside the supported range",
                    )
                })?;
                if parsed > i128::from(MAX_INT) {
                    return Err(self.error(
                        span,
                        "E_INTEGER_RANGE",
                        format!("integer literal must be at most {MAX_INT}"),
                    ));
                }
                Ok(literal(
                    Value::Number(Number::from(parsed as i64)),
                    Type::Int,
                    span,
                ))
            }
            ExpressionKind::Name(name) => self.lower_name(name, span, environment),
            ExpressionKind::Field {
                base,
                name,
                name_span,
            } => {
                let base = self.lower_expression(base, environment)?;
                let Type::Record(fields) = &base.ty else {
                    return Err(self.error(
                        *name_span,
                        "E_FIELD_BASE",
                        "field access requires a record",
                    ));
                };
                let Some(field) = fields.iter().find(|field| field.name == *name) else {
                    return Err(self.error(
                        *name_span,
                        "E_UNKNOWN_FIELD",
                        format!("record has no field '{name}'"),
                    ));
                };
                Ok(Expr {
                    ty: field.ty.clone(),
                    span,
                    kind: ExprKind::Field {
                        base: Box::new(base),
                        name: name.clone(),
                    },
                })
            }
            ExpressionKind::Unary { op, operand } => {
                let operand = self.lower_expression(operand, environment)?;
                let (op, expected, ty) = match op {
                    UnaryOperator::Not => (UnaryOp::Not, Type::Bool, Type::Bool),
                    UnaryOperator::Negate if operand.ty == Type::Float => {
                        (UnaryOp::Negate, Type::Float, Type::Float)
                    }
                    UnaryOperator::Negate => (UnaryOp::Negate, Type::Int, Type::Int),
                };
                self.require_type(&operand, &expected, "unary operand")?;
                Ok(Expr {
                    kind: ExprKind::Unary {
                        op,
                        operand: Box::new(operand),
                    },
                    ty,
                    span,
                })
            }
            ExpressionKind::Binary { op, left, right } => {
                let lowered_left = self.lower_expression(left, environment)?;
                let previous = environment.nonnull.len();
                if matches!(op, BinaryOperator::And | BinaryOperator::Or) {
                    nonnull_when(left, *op == BinaryOperator::And, &mut environment.nonnull);
                }
                let lowered_right = self.lower_expression(right, environment);
                environment.nonnull.truncate(previous);
                self.lower_binary(*op, lowered_left, lowered_right?, span)
            }
            ExpressionKind::Call {
                name,
                name_span,
                arguments,
            } => self.lower_call(name, *name_span, arguments, span, environment),
            ExpressionKind::Lambda { .. } => Err(self.error(
                span,
                "E_LAMBDA_CONTEXT",
                "binders are only valid in collection queries",
            )),
        }
    }

    fn lower_name(
        &self,
        name: &str,
        span: Span,
        environment: &Environment,
    ) -> Result<Expr, Diagnostic> {
        if let Some(binding) = environment
            .bindings
            .iter()
            .rev()
            .find(|binding| binding.name == name)
        {
            return Ok(Expr {
                kind: ExprKind::Load(binding.slot),
                ty: binding.ty.clone(),
                span,
            });
        }
        if let Some(binding) = environment
            .roots
            .iter()
            .find(|binding| binding.name == name)
        {
            return Ok(Expr {
                kind: ExprKind::Load(binding.slot),
                ty: binding.ty.clone(),
                span,
            });
        }
        if let Some(field) = environment.state.iter().find(|field| field.name == name) {
            let base = Expr {
                kind: ExprKind::Load(0),
                ty: Type::Record(environment.state.clone()),
                span,
            };
            return Ok(Expr {
                kind: ExprKind::Field {
                    base: Box::new(base),
                    name: name.to_owned(),
                },
                ty: field.ty.clone(),
                span,
            });
        }
        Err(self.error(
            span,
            "E_UNKNOWN_NAME",
            format!("unknown value name '{name}'"),
        ))
    }

    fn lower_binary(
        &self,
        op: BinaryOperator,
        left: Expr,
        right: Expr,
        span: Span,
    ) -> Result<Expr, Diagnostic> {
        let numeric = if left.ty == Type::Float {
            Type::Float
        } else {
            Type::Int
        };
        let (op, operand_type, result_type) = match op {
            BinaryOperator::Equal => (BinaryOp::Equal, None, Type::Bool),
            BinaryOperator::NotEqual => (BinaryOp::NotEqual, None, Type::Bool),
            BinaryOperator::Less => (BinaryOp::Less, Some(numeric), Type::Bool),
            BinaryOperator::LessEqual => (BinaryOp::LessEqual, Some(numeric), Type::Bool),
            BinaryOperator::Greater => (BinaryOp::Greater, Some(numeric), Type::Bool),
            BinaryOperator::GreaterEqual => (BinaryOp::GreaterEqual, Some(numeric), Type::Bool),
            BinaryOperator::Add => (BinaryOp::Add, Some(numeric.clone()), numeric),
            BinaryOperator::Subtract => (BinaryOp::Subtract, Some(numeric.clone()), numeric),
            BinaryOperator::And => (BinaryOp::And, Some(Type::Bool), Type::Bool),
            BinaryOperator::Or => (BinaryOp::Or, Some(Type::Bool), Type::Bool),
        };
        if let Some(expected) = operand_type {
            self.require_type(&left, &expected, "left operand")?;
            self.require_type(&right, &expected, "right operand")?;
        } else if !equality_compatible(&left.ty, &right.ty) {
            return Err(self.error(
                right.span,
                "E_TYPE_MISMATCH",
                format!(
                    "equality operands have different types: {:?} and {:?}",
                    left.ty, right.ty
                ),
            ));
        }
        Ok(Expr {
            kind: ExprKind::Binary {
                op,
                left: Box::new(left),
                right: Box::new(right),
            },
            ty: result_type,
            span,
        })
    }

    fn lower_call(
        &self,
        name: &str,
        name_span: Span,
        arguments: &[Expression],
        span: Span,
        environment: &mut Environment,
    ) -> Result<Expr, Diagnostic> {
        match name {
            "count" => {
                if arguments.len() != 1 {
                    return Err(self.arity(name_span, name, 1, arguments.len()));
                }
                let list = self.lower_expression(&arguments[0], environment)?;
                if !matches!(list.ty, Type::List(_)) {
                    return Err(self.error(list.span, "E_TYPE_MISMATCH", "count expects a list"));
                }
                Ok(Expr {
                    kind: ExprKind::Count(Box::new(list)),
                    ty: Type::Int,
                    span,
                })
            }
            "any" | "all" | "unique" => {
                if arguments.len() != 2 {
                    return Err(self.arity(name_span, name, 2, arguments.len()));
                }
                let list = self.lower_expression(&arguments[0], environment)?;
                let Type::List(item_type) = &list.ty else {
                    return Err(self.error(
                        list.span,
                        "E_TYPE_MISMATCH",
                        format!("{name} expects a list"),
                    ));
                };
                let ExpressionKind::Lambda {
                    binder,
                    binder_span,
                    body,
                } = &arguments[1].kind
                else {
                    return Err(self.error(
                        arguments[1].span,
                        "E_BINDER_REQUIRED",
                        format!("{name} requires a binder expression"),
                    ));
                };
                self.reject_reserved_value_name(binder, *binder_span)?;
                if environment.name_is_active(binder) {
                    return Err(self.error(
                        *binder_span,
                        "E_BINDING_SHADOW",
                        format!("binding '{binder}' shadows an active value"),
                    ));
                }
                let slot = environment.next_slot;
                environment.next_slot += 1;
                environment.bindings.push(Binding {
                    name: binder.clone(),
                    slot,
                    ty: item_type.as_ref().clone(),
                });
                let body = self.lower_expression(body, environment);
                environment.bindings.pop();
                let body = body?;
                let op = match name {
                    "any" => {
                        self.require_type(&body, &Type::Bool, "any predicate")?;
                        QueryOp::Any
                    }
                    "all" => {
                        self.require_type(&body, &Type::Bool, "all predicate")?;
                        QueryOp::All
                    }
                    "unique" => {
                        if !body.ty.is_action_parameter() {
                            return Err(self.error(
                                body.span,
                                "E_UNIQUE_KEY_TYPE",
                                "unique key must be scalar or optional scalar",
                            ));
                        }
                        QueryOp::Unique
                    }
                    _ => unreachable!(),
                };
                Ok(Expr {
                    kind: ExprKind::Query {
                        op,
                        list: Box::new(list),
                        slot,
                        body: Box::new(body),
                    },
                    ty: Type::Bool,
                    span,
                })
            }
            _ => Err(self.error(
                name_span,
                "E_UNKNOWN_FUNCTION",
                format!("unknown function '{name}'"),
            )),
        }
    }

    fn require_type(
        &self,
        expression: &Expr,
        expected: &Type,
        context: &str,
    ) -> Result<(), Diagnostic> {
        if !types_equal(&expression.ty, expected) {
            return Err(self.error(
                expression.span,
                "E_TYPE_MISMATCH",
                format!(
                    "{context} must have type {expected:?}, found {:?}",
                    expression.ty
                ),
            ));
        }
        Ok(())
    }

    fn arity(&self, span: Span, name: &str, expected: usize, actual: usize) -> Diagnostic {
        self.error(
            span,
            "E_ARITY",
            format!("{name} expects {expected} arguments, found {actual}"),
        )
    }

    fn reject_reserved_value_name(&self, name: &str, span: Span) -> Result<(), Diagnostic> {
        if RESERVED_VALUE_NAMES.contains(&name) {
            return Err(self.error(
                span,
                "E_RESERVED_NAME",
                format!("'{name}' is reserved and cannot be used as a value binding"),
            ));
        }
        Ok(())
    }

    fn first_span(&self) -> Span {
        self.units
            .iter()
            .find_map(|unit| unit.declarations.first())
            .map(declaration_span)
            .unwrap_or(Span {
                start: 0,
                end: 0,
                line: 1,
                column: 1,
            })
    }

    fn error(&self, span: Span, code: &str, message: impl Into<String>) -> Diagnostic {
        Diagnostic::new(self.units[self.current].file, span, code, message)
    }
}

#[derive(Clone)]
struct Binding {
    name: String,
    slot: usize,
    ty: Type,
}

struct Environment {
    roots: Vec<Binding>,
    state: Vec<Field>,
    bindings: Vec<Binding>,
    next_slot: usize,
    nonnull: Vec<Vec<String>>,
}

impl Environment {
    fn postcondition(state: Type, input: Type) -> Self {
        Self {
            roots: vec![
                Binding {
                    name: "before".to_owned(),
                    slot: 0,
                    ty: state.clone(),
                },
                Binding {
                    name: "input".to_owned(),
                    slot: 1,
                    ty: input,
                },
                Binding {
                    name: "after".to_owned(),
                    slot: 2,
                    ty: state,
                },
            ],
            state: Vec::new(),
            bindings: Vec::new(),
            next_slot: 3,
            nonnull: Vec::new(),
        }
    }

    fn invariant(state: &[Field]) -> Self {
        Self {
            roots: Vec::new(),
            state: state.to_vec(),
            bindings: Vec::new(),
            next_slot: 3,
            nonnull: Vec::new(),
        }
    }

    fn name_is_active(&self, name: &str) -> bool {
        self.roots.iter().any(|binding| binding.name == name)
            || self.state.iter().any(|field| field.name == name)
            || self.bindings.iter().any(|binding| binding.name == name)
    }
}

fn literal(value: Value, ty: Type, span: Span) -> Expr {
    Expr {
        kind: ExprKind::Literal(value),
        ty,
        span,
    }
}

fn declaration_span(declaration: &Declaration) -> Span {
    match declaration {
        Declaration::Type(value) => value.name_span,
        Declaration::State(value) => value.name_span,
        Declaration::Action(value) => value.name_span,
        Declaration::When(value) => value.action_span,
        Declaration::Invariant(value) => value.location,
    }
}

fn types_equal(left: &Type, right: &Type) -> bool {
    match (left, right) {
        (Type::Bool, Type::Bool)
        | (Type::Int, Type::Int)
        | (Type::Float, Type::Float)
        | (Type::Null, Type::Null)
        | (Type::String, Type::String) => true,
        (Type::List(left), Type::List(right)) | (Type::Optional(left), Type::Optional(right)) => {
            types_equal(left, right)
        }
        (Type::Record(left), Type::Record(right)) => {
            left.len() == right.len()
                && left.iter().all(|left_field| {
                    right.iter().any(|right_field| {
                        left_field.name == right_field.name
                            && types_equal(&left_field.ty, &right_field.ty)
                    })
                })
        }
        _ => false,
    }
}

fn equality_compatible(left: &Type, right: &Type) -> bool {
    types_equal(left, right)
        || match (left, right) {
            (Type::Optional(_), Type::Null) | (Type::Null, Type::Optional(_)) => true,
            (Type::Optional(inner), other) | (other, Type::Optional(inner)) => {
                types_equal(inner, other)
            }
            _ => false,
        }
}

fn access_path(expression: &Expression) -> Option<Vec<String>> {
    match &expression.kind {
        ExpressionKind::Name(name) => Some(vec![name.clone()]),
        ExpressionKind::Field { base, name, .. } => {
            let mut path = access_path(base)?;
            path.push(name.clone());
            Some(path)
        }
        _ => None,
    }
}

fn nonnull_when(expression: &Expression, truth: bool, paths: &mut Vec<Vec<String>>) {
    match &expression.kind {
        ExpressionKind::Unary {
            op: UnaryOperator::Not,
            operand,
        } => nonnull_when(operand, !truth, paths),
        ExpressionKind::Binary { op, left, right } => {
            if (*op == BinaryOperator::NotEqual && truth)
                || (*op == BinaryOperator::Equal && !truth)
            {
                let value = if matches!(left.kind, ExpressionKind::Null) {
                    right
                } else if matches!(right.kind, ExpressionKind::Null) {
                    left
                } else {
                    return;
                };
                if let Some(path) = access_path(value) {
                    paths.push(path);
                }
            } else if (*op == BinaryOperator::And && truth) || (*op == BinaryOperator::Or && !truth)
            {
                nonnull_when(left, truth, paths);
                nonnull_when(right, truth, paths);
            }
        }
        _ => {}
    }
}
