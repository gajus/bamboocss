//! Token accounting: which design-token paths a file asks for, and what it asks for in a way the
//! build cannot follow.
//!
//! A port of `packages/node/src/token-accounting.ts`, which walked the TypeScript tree. The rules
//! are unchanged and documented there; this file keeps only what the Rust shape adds.
//!
//! The one structural difference is scope. The TypeScript pass approximated shadowing by
//! collecting "scopes that bind this name" and testing range containment. Oxc's semantic model
//! resolves every identifier reference to the symbol it binds, so "is this `token` the import?"
//! is answered exactly: a reference whose symbol is not an import binding is a local, whatever it
//! is called.

use std::collections::HashSet;

use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, ImportDeclarationSpecifier, Statement, TSModuleReference},
};
use oxc_ast_visit::{Visit, walk};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, Semantic, SemanticBuilder};
use oxc_span::{GetSpan, Span};
use oxc_syntax::symbol::SymbolId;

#[napi(object)]
pub struct NativeTokenDecline {
    pub reason: String,
    pub line: u32,
    pub start: u32,
    pub end: u32,
}

#[napi(object)]
pub struct NativeTokenAccounting {
    pub paths: Vec<String>,
    pub prefixes: Vec<String>,
    pub declined: Vec<NativeTokenDecline>,
    /// The file did not parse; nothing below the first error can be trusted.
    pub unparsed: bool,
}

pub(crate) struct Accountant<'s> {
    source: &'s str,
    /// Specifiers that name the tokens artifact, already resolved through tsconfig paths.
    is_entrypoint: &'s dyn Fn(&str) -> bool,
    paths: Vec<String>,
    prefixes: Vec<String>,
    declined: Vec<NativeTokenDecline>,
}

impl<'s> Accountant<'s> {
    fn decline(&mut self, span: Span, reason: &str) {
        let (line, _) = crate::line_and_column(self.source, span.start);
        self.declined.push(NativeTokenDecline {
            reason: reason.to_string(),
            line,
            start: crate::utf16_offset(self.source, span.start),
            end: crate::utf16_offset(self.source, span.end),
        });
    }
}

/// How a local symbol relates to the artifact.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Binding {
    /// The `token` export, imported from the artifact.
    Token,
    /// A namespace import of the artifact.
    Namespace,
}

pub(crate) fn account(
    source: &str,
    source_type: oxc_span::SourceType,
    is_entrypoint: &dyn Fn(&str) -> bool,
) -> NativeTokenAccounting {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() || parsed.panicked {
        return NativeTokenAccounting {
            paths: Vec::new(),
            prefixes: Vec::new(),
            declined: Vec::new(),
            unparsed: true,
        };
    }
    let semantic = SemanticBuilder::new_compiler()
        .with_build_nodes(true)
        .build(&parsed.program)
        .semantic;
    let scoping = semantic.scoping();

    let mut accountant = Accountant {
        source,
        is_entrypoint,
        paths: Vec::new(),
        prefixes: Vec::new(),
        declined: Vec::new(),
    };

    let mut bindings: Vec<(SymbolId, Binding)> = Vec::new();

    for statement in &parsed.program.body {
        match statement {
            // `export { token } from './tokens'` and `export * from './tokens'` hand the binding
            // to a module this pass may never visit.
            Statement::ExportFromDeclaration(export) => {
                if (accountant.is_entrypoint)(export.source.value.as_str()) {
                    accountant.decline(export.span, "re-exported");
                }
            }
            Statement::ExportAllDeclaration(export) => {
                if (accountant.is_entrypoint)(export.source.value.as_str()) {
                    accountant.decline(export.span, "re-exported");
                }
            }
            Statement::ImportDeclaration(declaration) => {
                if declaration.import_kind.is_type() {
                    continue;
                }
                let Some(specifiers) = &declaration.specifiers else {
                    continue;
                };
                let specifier = declaration.source.value.as_str();
                if !(accountant.is_entrypoint)(specifier) {
                    // A module this pass cannot classify may be a barrel re-exporting the
                    // artifact, so key on the imported *name*.
                    for item in specifiers {
                        match item {
                            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                if !named.import_kind.is_type() && named.imported.name() == "token"
                                {
                                    accountant.decline(named.span, "unclassified-import");
                                }
                            }
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                                if default.local.name == "token" {
                                    accountant.decline(default.local.span, "unclassified-import");
                                }
                            }
                            // A namespace only matters if something reads `.token` off it.
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                                if let Some(symbol) = namespace.local.symbol_id.get()
                                    && reads_token_member(&semantic, scoping, symbol)
                                {
                                    accountant.decline(namespace.local.span, "unclassified-import");
                                }
                            }
                        }
                    }
                    continue;
                }
                for item in specifiers {
                    match item {
                        // The artifact has no default export.
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                            accountant.decline(default.local.span, "unsupported-import");
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                            if let Some(symbol) = namespace.local.symbol_id.get() {
                                bindings.push((symbol, Binding::Namespace));
                            }
                        }
                        ImportDeclarationSpecifier::ImportSpecifier(named) => {
                            if named.import_kind.is_type() {
                                continue;
                            }
                            let Some(symbol) = named.local.symbol_id.get() else {
                                continue;
                            };
                            if named.imported.name() == "token" {
                                bindings.push((symbol, Binding::Token));
                            } else if used_as_value(scoping, symbol) {
                                // A barrel matching the specifier test could re-export `token`
                                // under another name, so a *called* binding is not safe.
                                accountant.decline(named.span, "unsupported-import");
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // `import ds = require('…')` can nest inside a namespace, so it is found by walking.
    // `require()` and `import()` bind by destructuring, so they are found the same way.
    let mut finder = ImportShapes {
        accountant: &mut accountant,
    };
    finder.visit_program(&parsed.program);

    // Every reference to a binding of the artifact, resolved exactly by symbol.
    for (symbol, kind) in &bindings {
        for reference in scoping.get_resolved_references(*symbol) {
            let node = reference.node_id();
            account_reference(&mut accountant, &semantic, node, *kind);
        }
    }

    // A local variable named `token` whose initializer could be the artifact. Oxc binds it as
    // a local, so the symbol walk above never sees it — but `const { token } = useTheme()` or
    // `const { token } = ui` (a namespace import a barrel could make the artifact) reaches the
    // artifact all the same. Only bindings that provably hold something this file defines are
    // excused: parameters, catch variables, function and class names, and a destructure off a
    // binding that is itself one of those. Declining costs bytes; accepting costs a rule.
    for symbol in scoping.symbol_ids() {
        if scoping.symbol_name(symbol) != "token"
            || bindings.iter().any(|(bound, _)| *bound == symbol)
        {
            continue;
        }
        if provably_local(&semantic, scoping, symbol) {
            continue;
        }
        for reference in scoping.get_resolved_references(symbol) {
            if !reference.is_value() {
                continue;
            }
            let span = semantic.nodes().get_node(reference.node_id()).kind().span();
            accountant.decline(span, "unresolved-reference");
        }
    }

    // A bare `token` this pass never bound came from somewhere it could not follow. An
    // unresolved reference has no symbol, so it cannot be a local of the same name. A property
    // *name* `x.token` is not a reference and is handled below.
    for reference_id in scoping.root_unresolved_references_ids().flatten() {
        let reference = scoping.get_reference(reference_id);
        let node = semantic.nodes().get_node(reference.node_id());
        if let AstKind::IdentifierReference(identifier) = node.kind()
            && identifier.name == "token"
        {
            let (resolved, span) = accepted_path(&semantic, reference.node_id(), Binding::Token);
            match resolved {
                Some(Accepted::Path(path)) => accountant.paths.push(path),
                Some(Accepted::Prefix(prefix)) => accountant.prefixes.push(prefix),
                None => accountant.decline(span, "unresolved-reference"),
            }
        }
    }

    // `theme.token(k)` on an object this pass never bound reaches the artifact through a barrel.
    let namespaces: HashSet<SymbolId> = bindings
        .iter()
        .filter(|(_, kind)| *kind == Binding::Namespace)
        .map(|(symbol, _)| *symbol)
        .collect();
    for node in semantic.nodes().iter() {
        match node.kind() {
            AstKind::StaticMemberExpression(member) if member.property.name == "token" => {
                if !is_namespace_read(&member.object, scoping, &namespaces) {
                    accountant.decline(member.property.span, "unresolved-reference");
                }
            }
            AstKind::ComputedMemberExpression(member)
                if matches!(
                    member.expression.get_inner_expression(),
                    Expression::StringLiteral(literal) if literal.value == "token"
                ) =>
            {
                accountant.decline(member.span, "unresolved-reference");
            }
            _ => {}
        }
    }

    // Doc comments: `{@link token}` or `typeof token` in JSDoc is a reference the parse tree does
    // not carry. Declining keeps every declaration — the lenient direction.
    for comment in &parsed.program.comments {
        let text = comment.content_span().source_text(source);
        if comment.is_jsdoc() && contains_word(text, "token") && !bindings.is_empty() {
            accountant.decline(comment.span, "unresolved-reference");
        }
    }

    accountant.paths.sort();
    accountant.paths.dedup();
    accountant.prefixes.sort();
    accountant.prefixes.dedup();
    accountant
        .declined
        .sort_by_key(|entry| (entry.start, entry.end));
    accountant
        .declined
        .dedup_by(|a, b| a.start == b.start && a.end == b.end && a.reason == b.reason);

    NativeTokenAccounting {
        paths: accountant.paths,
        prefixes: accountant.prefixes,
        declined: accountant.declined,
        unparsed: false,
    }
}

/// Whether a symbol is bound to something this file defines, and so cannot be the artifact.
///
/// Parameters, catch variables and function/class names always are. A variable is only when it
/// destructures off one of those — `const { token } = props` where `props` is a parameter — and
/// one level deep, as the TypeScript pass did: a chain declines, which costs bytes, never a rule.
fn provably_local(semantic: &Semantic<'_>, scoping: &Scoping, symbol: SymbolId) -> bool {
    let declaration = semantic.symbol_declaration(symbol);
    match declaration.kind() {
        AstKind::FormalParameter(_)
        | AstKind::CatchParameter(_)
        | AstKind::Function(_)
        | AstKind::Class(_)
        | AstKind::TSInterfaceDeclaration(_)
        | AstKind::TSTypeAliasDeclaration(_) => true,
        AstKind::VariableDeclarator(declarator) => {
            let Some(init) = &declarator.init else {
                return false;
            };
            let Some(root) = root_identifier(init) else {
                return false;
            };
            let Some(root_symbol) = root
                .reference_id
                .get()
                .and_then(|reference| scoping.get_reference(reference).symbol_id())
            else {
                return false;
            };
            matches!(
                semantic.symbol_declaration(root_symbol).kind(),
                AstKind::FormalParameter(_) | AstKind::CatchParameter(_)
            )
        }
        _ => false,
    }
}

/// `props`, `props.theme` and `props['theme']` all root at `props`; anything else roots nowhere.
fn root_identifier<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier),
        Expression::StaticMemberExpression(member) => root_identifier(&member.object),
        Expression::ComputedMemberExpression(member) => root_identifier(&member.object),
        _ => None,
    }
}

fn contains_word(text: &str, word: &str) -> bool {
    text.match_indices(word).any(|(index, _)| {
        let before = text[..index].chars().next_back();
        let after = text[index + word.len()..].chars().next();
        !before.is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '$')
            && !after.is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '$')
    })
}

fn is_namespace_read(
    object: &Expression<'_>,
    scoping: &Scoping,
    namespaces: &HashSet<SymbolId>,
) -> bool {
    let Expression::Identifier(identifier) = object.get_inner_expression() else {
        return false;
    };
    identifier
        .reference_id
        .get()
        .and_then(|reference| scoping.get_reference(reference).symbol_id())
        .is_some_and(|symbol| namespaces.contains(&symbol))
}

fn reads_token_member(semantic: &Semantic<'_>, scoping: &Scoping, symbol: SymbolId) -> bool {
    scoping.get_resolved_references(symbol).any(|reference| {
        match semantic.nodes().parent_kind(reference.node_id()) {
            AstKind::StaticMemberExpression(member) => member.property.name == "token",
            AstKind::ComputedMemberExpression(member) => !matches!(
                member.expression.get_inner_expression(),
                Expression::StringLiteral(literal) if literal.value != "token"
            ),
            _ => false,
        }
    })
}

/// Whether a symbol is read anywhere outside a type position.
fn used_as_value(scoping: &Scoping, symbol: SymbolId) -> bool {
    scoping
        .get_resolved_references(symbol)
        .any(|reference| reference.is_value())
}

enum Accepted {
    Path(String),
    Prefix(String),
}

/// One reference to a binding of the artifact: record what it asks for, or decline.
fn account_reference(
    accountant: &mut Accountant<'_>,
    semantic: &Semantic<'_>,
    node: oxc_semantic::NodeId,
    kind: Binding,
) {
    // `export { token }` hands the binding to a module this pass may never visit.
    if let AstKind::ExportSpecifier(_) = semantic.nodes().parent_kind(node) {
        let span = semantic.nodes().get_node(node).kind().span();
        accountant.decline(span, "re-exported");
        return;
    }
    // A reference in a type position — `typeof token` — produces no `var()`.
    if semantic
        .nodes()
        .ancestor_kinds(node)
        .any(|kind| kind.is_type())
    {
        return;
    }
    let (resolved, span) = accepted_path(semantic, node, kind);
    match resolved {
        Some(Accepted::Path(path)) => accountant.paths.push(path),
        Some(Accepted::Prefix(prefix)) => accountant.prefixes.push(prefix),
        None => accountant.decline(span, "unresolved-reference"),
    }
}

/// Accepts the callee position and nothing else: `token('x')`, `token.value('x')`, and the
/// namespaced `ns.token('x')` / `ns.token.value('x')`. Anything else is the binding escaping.
fn accepted_path(
    semantic: &Semantic<'_>,
    node: oxc_semantic::NodeId,
    kind: Binding,
) -> (Option<Accepted>, Span) {
    let nodes = semantic.nodes();
    let identifier_span = nodes.get_node(node).kind().span();
    let mut current = node;

    // Climb to the expression that is the callee, through `.token` (namespace) and `.value`.
    let mut members: Vec<String> = Vec::new();
    loop {
        let parent = nodes.parent_node(current);
        match parent.kind() {
            AstKind::StaticMemberExpression(member)
                if member.object.span() == nodes.get_node(current).kind().span() =>
            {
                members.push(member.property.name.to_string());
                current = parent.id();
            }
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_) => current = parent.id(),
            _ => break,
        }
    }

    let expected: &[&[&str]] = match kind {
        Binding::Token => &[&[], &["value"]],
        Binding::Namespace => &[&["token"], &["token", "value"]],
    };
    if !expected
        .iter()
        .any(|shape| shape.iter().copied().eq(members.iter().map(String::as_str)))
    {
        return (None, identifier_span);
    }

    let callee_span = nodes.get_node(current).kind().span();
    let AstKind::CallExpression(call) = nodes.parent_kind(current) else {
        return (None, identifier_span);
    };
    if call.callee.span() != callee_span {
        return (None, identifier_span);
    }
    let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
        return (None, identifier_span);
    };
    (literal_path(argument), identifier_span)
}

/// The path a call asks for, or the prefix a template literal is bounded by.
fn literal_path(argument: &Expression<'_>) -> Option<Accepted> {
    match argument.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(Accepted::Path(literal.value.to_string())),
        Expression::TemplateLiteral(template) => {
            if let Some(value) = template.single_quasi() {
                return Some(Accepted::Path(value.to_string()));
            }
            let head = template.quasis.first()?;
            let head = head
                .value
                .cooked
                .as_ref()
                .map_or(head.value.raw.as_str(), |value| value.as_str());
            (!head.is_empty()).then(|| Accepted::Prefix(head.to_string()))
        }
        _ => None,
    }
}

/// `import x = require()`, `require()` and `import()` shapes, wherever they nest.
struct ImportShapes<'a, 's> {
    accountant: &'a mut Accountant<'s>,
}

impl<'ast> Visit<'ast> for ImportShapes<'_, '_> {
    fn visit_ts_import_equals_declaration(
        &mut self,
        declaration: &oxc_ast::ast::TSImportEqualsDeclaration<'ast>,
    ) {
        // Declined when it could be the artifact: a `require` of a specifier naming it, or any
        // import-equals whose text mentions `token` at all (the lenient direction).
        let text = declaration.span.source_text(self.accountant.source);
        let names_artifact = matches!(
            &declaration.module_reference,
            TSModuleReference::ExternalModuleReference(reference)
                if (self.accountant.is_entrypoint)(reference.expression.value.as_str())
        );
        if names_artifact || text.contains("token") {
            self.accountant.decline(declaration.span, "import-equals");
        }
        walk::walk_ts_import_equals_declaration(self, declaration);
    }

    fn visit_call_expression(&mut self, call: &oxc_ast::ast::CallExpression<'ast>) {
        if let Expression::Identifier(callee) = &call.callee
            && callee.name == "require"
        {
            let readable = matches!(
                call.arguments.first().and_then(Argument::as_expression).map(Expression::get_inner_expression),
                Some(Expression::StringLiteral(literal)) if !(self.accountant.is_entrypoint)(literal.value.as_str())
            );
            if !readable {
                self.accountant.decline(call.span, "require");
            }
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_import_expression(&mut self, expression: &oxc_ast::ast::ImportExpression<'ast>) {
        let readable = matches!(
            expression.source.get_inner_expression(),
            Expression::StringLiteral(literal) if !(self.accountant.is_entrypoint)(literal.value.as_str())
        );
        if !readable {
            self.accountant.decline(expression.span, "dynamic-import");
        }
        walk::walk_import_expression(self, expression);
    }
}
