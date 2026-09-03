use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrowFunctionBody, ArrowFunctionExpression, BindingPattern, CallExpression,
        Declaration, Expression, FormalParameters, Function, FunctionBody,
        ImportDeclarationSpecifier, JSXExpression, LogicalExpression, ModuleExportName,
        ObjectPropertyKind, Statement,
    },
};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, Semantic, SemanticBuilder};
use oxc_span::SourceType;
use oxc_syntax::{
    operator::{BinaryOperator, LogicalOperator, UnaryOperator},
    symbol::SymbolId,
};

use crate::{NativeEntrypoint, NativePathMapping, NativeProjectOptions, NativeToken};

#[derive(Clone, Debug)]
pub(crate) struct EvalResult {
    pub value: Option<serde_json::Value>,
    /// Fragments emitted for branches whose condition is not statically known.
    pub conditions: Vec<serde_json::Value>,
    pub complete: bool,
}

impl EvalResult {
    fn known(value: impl Into<serde_json::Value>) -> Self {
        Self {
            value: Some(value.into()),
            conditions: Vec::new(),
            complete: true,
        }
    }

    pub fn unknown() -> Self {
        Self {
            value: None,
            conditions: Vec::new(),
            complete: false,
        }
    }

    fn undefined() -> Self {
        // JavaScript `undefined` is a known value, but has no JSON representation. It is
        // deliberately omitted from an object or argument just like the TypeScript extractor.
        Self {
            value: None,
            conditions: Vec::new(),
            complete: true,
        }
    }

    pub fn data(self) -> Vec<serde_json::Value> {
        let mut output = self.conditions;
        if let Some(value) = self.value {
            output.push(value);
        }
        output
    }
}

#[derive(Clone, Debug)]
struct ImportBinding {
    specifier: String,
    imported: ImportedName,
}

#[derive(Clone, Debug)]
enum ImportedName {
    Named(String),
    Default,
    Namespace,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct ExportKey {
    file: String,
    name: String,
}

pub(crate) struct ProjectReads {
    pub dependencies: Vec<String>,
    pub pending_candidates: Vec<String>,
    pub configuration_files: Vec<String>,
}

pub(crate) struct ProjectEvaluator<'a> {
    sources: HashMap<String, &'a str>,
    source_types: HashMap<String, SourceType>,
    entrypoints: &'a [NativeEntrypoint],
    cwd: PathBuf,
    base_url: Option<PathBuf>,
    paths: Vec<(String, Vec<String>)>,
    tokens: HashMap<String, (Option<serde_json::Value>, Option<String>)>,
    export_stack: RefCell<HashSet<ExportKey>>,
    active_owner: RefCell<Option<String>>,
    dependencies: RefCell<HashMap<String, HashSet<String>>>,
    pending_candidates: RefCell<HashMap<String, HashSet<String>>>,
    configuration_files: RefCell<HashMap<String, HashSet<String>>>,
}

impl<'a> ProjectEvaluator<'a> {
    pub fn new(
        sources: impl IntoIterator<Item = (&'a str, &'a str)>,
        entrypoints: &'a [NativeEntrypoint],
        options: Option<&NativeProjectOptions>,
    ) -> Self {
        let mut source_map = HashMap::new();
        let mut source_types = HashMap::new();
        for (filename, source) in sources {
            let normalized = normalize_path(filename);
            source_types.insert(normalized.clone(), source_type_for(filename));
            source_map.insert(normalized, source);
        }
        let cwd = options
            .and_then(|options| options.cwd.as_deref())
            .map(PathBuf::from)
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_default();
        let base_url = options
            .and_then(|options| options.base_url.as_deref())
            .map(|base| cwd.join(base));
        let paths = options
            .map(|options| {
                options
                    .paths
                    .iter()
                    .map(|mapping| (mapping.pattern.clone(), mapping.paths.clone()))
                    .collect()
            })
            .unwrap_or_default();
        let tokens = options
            .map(|options| {
                options
                    .tokens
                    .iter()
                    .map(|token| {
                        (
                            token.path.clone(),
                            (token.value.clone(), token.variable.clone()),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self {
            sources: source_map,
            source_types,
            entrypoints,
            cwd,
            base_url,
            paths,
            tokens,
            export_stack: RefCell::new(HashSet::new()),
            active_owner: RefCell::new(None),
            dependencies: RefCell::new(HashMap::new()),
            pending_candidates: RefCell::new(HashMap::new()),
            configuration_files: RefCell::new(HashMap::new()),
        }
    }

    pub fn begin_file(&self, filename: &str) {
        *self.active_owner.borrow_mut() = Some(normalize_path(filename));
    }

    pub fn end_file(&self, filename: &str) -> ProjectReads {
        *self.active_owner.borrow_mut() = None;
        let owner = normalize_path(filename);
        let take = |map: &RefCell<HashMap<String, HashSet<String>>>| {
            let mut values = map
                .borrow_mut()
                .remove(&owner)
                .unwrap_or_default()
                .into_iter()
                .collect::<Vec<_>>();
            values.sort();
            values
        };
        ProjectReads {
            dependencies: take(&self.dependencies),
            pending_candidates: take(&self.pending_candidates),
            configuration_files: take(&self.configuration_files),
        }
    }

    pub fn entrypoint(&self, specifier: &str) -> Option<&NativeEntrypoint> {
        self.entrypoints.iter().find(|entrypoint| {
            entrypoint
                .modules
                .iter()
                .any(|module| specifier.contains(module))
        })
    }

    fn token(&self, path: &str, value: bool) -> Option<serde_json::Value> {
        let (literal, variable) = self.tokens.get(path)?;
        if value {
            literal.clone()
        } else {
            variable.clone().map(Into::into)
        }
    }

    fn source(&self, filename: &str) -> Option<StringSource<'a>> {
        let normalized = normalize_path(filename);
        if let Some(source) = self.sources.get(&normalized) {
            return Some(StringSource::Borrowed(source));
        }
        fs::read_to_string(filename).ok().map(StringSource::Owned)
    }

    fn record_read(&self, map: &RefCell<HashMap<String, HashSet<String>>>, path: &Path) {
        if let Some(owner) = self.active_owner.borrow().as_ref() {
            map.borrow_mut()
                .entry(owner.clone())
                .or_default()
                .insert(normalize_path(path.to_string_lossy().as_ref()));
        }
    }

    fn package_import_bases(&self, importer: &Path, specifier: &str) -> Vec<PathBuf> {
        let mut directory = importer.parent();
        while let Some(current) = directory {
            let manifest = current.join("package.json");
            if manifest.is_file() {
                // The nearest package scope owns every `#` specifier. Record it even when the
                // current map has no matching key, because adding one must invalidate an
                // unchanged importer on the next incremental pass.
                self.record_read(&self.configuration_files, &manifest);
                let Ok(source) = fs::read_to_string(&manifest) else {
                    return Vec::new();
                };
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&source) else {
                    return Vec::new();
                };
                let Some(imports) = json.get("imports").and_then(serde_json::Value::as_object)
                else {
                    return Vec::new();
                };
                let Some((mapping, capture)) = package_mapping(imports, specifier) else {
                    return Vec::new();
                };
                let mut targets = Vec::new();
                collect_package_targets(mapping, &mut targets);
                return targets
                    .into_iter()
                    .map(|target| current.join(target.replace('*', capture)))
                    .collect();
            }
            directory = current.parent();
        }
        Vec::new()
    }

    fn package_bases(&self, importer: &Path, specifier: &str) -> Vec<PathBuf> {
        let segments = specifier.split('/').collect::<Vec<_>>();
        let package_segments = if specifier.starts_with('@') { 2 } else { 1 };
        if segments.len() < package_segments {
            return Vec::new();
        }
        let package_name = segments[..package_segments].join("/");
        let subpath = segments[package_segments..].join("/");
        let mut directory = importer.parent();
        while let Some(current) = directory {
            let package = current.join("node_modules").join(&package_name);
            let manifest = package.join("package.json");
            if manifest.is_file()
                && let Ok(source) = fs::read_to_string(&manifest)
                && let Ok(json) = serde_json::from_str::<serde_json::Value>(&source)
            {
                self.record_read(&self.configuration_files, &manifest);
                let mut targets = Vec::new();
                let has_exports = json.get("exports").is_some();
                if let Some(exports) = json.get("exports") {
                    let key = if subpath.is_empty() {
                        ".".to_string()
                    } else {
                        format!("./{subpath}")
                    };
                    let mapping = if let Some(exports) = exports.as_object()
                        && exports.keys().any(|key| key.starts_with('.'))
                    {
                        package_mapping(exports, &key)
                    } else if subpath.is_empty() {
                        Some((exports, ""))
                    } else {
                        None
                    };
                    if let Some((export, capture)) = mapping {
                        collect_package_targets(export, &mut targets);
                        for target in &mut targets {
                            *target = target.replace('*', capture);
                        }
                    }
                }
                if targets.is_empty() {
                    if has_exports {
                        return Vec::new();
                    }
                    if !subpath.is_empty() {
                        targets.push(subpath);
                    } else {
                        for field in ["source", "module", "main"] {
                            if let Some(value) = json.get(field).and_then(serde_json::Value::as_str)
                            {
                                targets.push(value.to_string());
                                break;
                            }
                        }
                        if targets.is_empty() {
                            targets.push("index".to_string());
                        }
                    }
                }
                return targets
                    .into_iter()
                    .map(|target| package.join(target))
                    .collect();
            }
            directory = current.parent();
        }
        Vec::new()
    }

    fn resolve(&self, importer: &str, specifier: &str) -> Option<String> {
        let mut bases = Vec::new();
        let importer_path = Path::new(importer);
        if specifier.starts_with('.') {
            bases.push(importer_path.parent()?.join(specifier));
        } else if Path::new(specifier).is_absolute() {
            bases.push(PathBuf::from(specifier));
        } else {
            let path_mapping = self
                .paths
                .iter()
                .filter_map(|(pattern, targets)| {
                    wildcard_match(pattern, specifier).map(|capture| (pattern, targets, capture))
                })
                .max_by_key(|(pattern, _, _)| path_mapping_priority(pattern));
            let matched_path = path_mapping.is_some();
            if let Some((_, targets, capture)) = path_mapping {
                for target in targets {
                    let target = target.replace('*', capture);
                    bases.push(self.base_url.as_ref().unwrap_or(&self.cwd).join(target));
                }
            }
            if specifier.starts_with('#') {
                if !matched_path {
                    bases.extend(self.package_import_bases(importer_path, specifier));
                }
            } else {
                if let Some(base_url) = &self.base_url {
                    bases.push(base_url.join(specifier));
                }
                bases.extend(self.package_bases(importer_path, specifier));
            }
        }

        for base in bases {
            let mut higher_priority: Vec<PathBuf> = Vec::new();
            for candidate in path_candidates(&base) {
                let normalized = normalize_path(candidate.to_string_lossy().as_ref());
                if self.sources.contains_key(&normalized) || candidate.is_file() {
                    for pending in higher_priority {
                        self.record_read(&self.pending_candidates, &pending);
                    }
                    self.record_read(&self.dependencies, &candidate);
                    return Some(normalized);
                }
                // The extensionless lexical base is not a file TypeScript redirects to when
                // it appears, but an earlier source extension is. Keep only those real
                // higher-priority candidates (for example target.ts before target.tsx).
                if candidate != base && candidate.extension().is_some() {
                    higher_priority.push(candidate);
                }
            }
            // No candidate exists yet. Any source spelling in the resolver's precedence
            // table can make this import start resolving, not only the lexical specifier
            // (`./value.js` may appear as `value.ts`, for example).
            for candidate in path_candidates(&base) {
                if candidate != base || candidate.extension().is_some() {
                    self.record_read(&self.pending_candidates, &candidate);
                }
            }
        }
        None
    }

    fn evaluate_import(&self, importer: &str, binding: &ImportBinding) -> EvalResult {
        let ImportedName::Named(name) = &binding.imported else {
            // Preserve the established boundary. Default and namespace values were never
            // executed across files, because doing so would turn package/application modules
            // into build scripts.
            return EvalResult::unknown();
        };
        let Some(target) = self.resolve(importer, &binding.specifier) else {
            return EvalResult::unknown();
        };
        self.evaluate_export(&target, name)
    }

    fn evaluate_export(&self, filename: &str, name: &str) -> EvalResult {
        let key = ExportKey {
            file: normalize_path(filename),
            name: name.to_string(),
        };
        {
            let mut stack = self.export_stack.borrow_mut();
            if !stack.insert(key.clone()) {
                return EvalResult::unknown();
            }
        }
        let result = self.evaluate_export_uncached(&key.file, &key.name);
        self.export_stack.borrow_mut().remove(&key);
        result
    }

    fn evaluate_export_uncached(&self, filename: &str, name: &str) -> EvalResult {
        let Some(source) = self.source(filename) else {
            return EvalResult::unknown();
        };
        let source_type = self
            .source_types
            .get(filename)
            .copied()
            .unwrap_or_else(|| source_type_for(filename));
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source.as_str(), source_type).parse();
        if !parsed.diagnostics.is_empty() {
            return EvalResult::unknown();
        }
        let semantic = SemanticBuilder::new_compiler()
            .with_build_nodes(true)
            .build(&parsed.program);
        if !semantic.diagnostics.is_empty() {
            return EvalResult::unknown();
        }
        let mut evaluator = FileEvaluator::new(filename, self, &semantic.semantic, &parsed.program);

        // `export const value = …` and `export function helper() { … }`.
        for statement in &parsed.program.body {
            if let Statement::ExportDeclaration(export) = statement {
                match &export.declaration {
                    Declaration::VariableDeclaration(declaration) => {
                        for declarator in &declaration.declarations {
                            if declarator
                                .id
                                .get_binding_identifier()
                                .is_some_and(|id| id.name == name)
                                && let Some(symbol) = declarator
                                    .id
                                    .get_binding_identifier()
                                    .and_then(|id| id.symbol_id.get())
                            {
                                return evaluator.evaluate_symbol(symbol);
                            }
                        }
                    }
                    Declaration::FunctionDeclaration(function)
                        if function.id.as_ref().is_some_and(|id| id.name == name) =>
                    {
                        // A function is meaningful only when called. Returning unknown here
                        // keeps a bare function value out of style data.
                        return EvalResult::unknown();
                    }
                    _ => {}
                }
            }
        }

        // `export { local as public }` and `export { value as public } from './module'`.
        for statement in &parsed.program.body {
            match statement {
                Statement::ExportNamedDeclaration(export) => {
                    for specifier in &export.specifiers {
                        if module_name(&specifier.exported) != name {
                            continue;
                        }
                        if let ModuleExportName::IdentifierReference(identifier) = &specifier.local
                            && let Some(reference) = identifier.reference_id.get()
                            && let Some(symbol) =
                                evaluator.scoping.get_reference(reference).symbol_id()
                        {
                            return evaluator.evaluate_symbol(symbol);
                        }
                    }
                }
                Statement::ExportFromDeclaration(export) => {
                    for specifier in &export.specifiers {
                        if module_name(&specifier.exported) != name {
                            continue;
                        }
                        let Some(target) = self.resolve(filename, export.source.value.as_str())
                        else {
                            return EvalResult::unknown();
                        };
                        return self.evaluate_export(&target, module_name(&specifier.local));
                    }
                }
                _ => {}
            }
        }

        // A star barrel. Cycles terminate through `export_stack`, while another exported name
        // may still continue through the same file because the key includes the name.
        for statement in &parsed.program.body {
            if let Statement::ExportAllDeclaration(export) = statement {
                let Some(target) = self.resolve(filename, export.source.value.as_str()) else {
                    continue;
                };
                let result = self.evaluate_export(&target, name);
                if result.value.is_some() || result.complete {
                    return result;
                }
            }
        }
        EvalResult::unknown()
    }

    fn call_imported(
        &self,
        importer: &str,
        binding: &ImportBinding,
        arguments: Vec<EvalResult>,
    ) -> EvalResult {
        let ImportedName::Named(name) = &binding.imported else {
            return EvalResult::unknown();
        };
        let Some(target) = self.resolve(importer, &binding.specifier) else {
            return EvalResult::unknown();
        };
        self.call_export(&target, name, arguments)
    }

    fn call_export(&self, filename: &str, name: &str, arguments: Vec<EvalResult>) -> EvalResult {
        let key = ExportKey {
            file: normalize_path(filename),
            name: format!("{name}()"),
        };
        {
            let mut stack = self.export_stack.borrow_mut();
            if !stack.insert(key.clone()) {
                return EvalResult::unknown();
            }
        }
        let result = self.call_export_uncached(filename, name, arguments);
        self.export_stack.borrow_mut().remove(&key);
        result
    }

    fn call_export_uncached(
        &self,
        filename: &str,
        name: &str,
        arguments: Vec<EvalResult>,
    ) -> EvalResult {
        let Some(source) = self.source(filename) else {
            return EvalResult::unknown();
        };
        let source_type = self
            .source_types
            .get(filename)
            .copied()
            .unwrap_or_else(|| source_type_for(filename));
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source.as_str(), source_type).parse();
        if !parsed.diagnostics.is_empty() {
            return EvalResult::unknown();
        }
        let semantic = SemanticBuilder::new_compiler()
            .with_build_nodes(true)
            .build(&parsed.program);
        if !semantic.diagnostics.is_empty() {
            return EvalResult::unknown();
        }
        let mut evaluator = FileEvaluator::new(filename, self, &semantic.semantic, &parsed.program);

        for statement in &parsed.program.body {
            if let Statement::ExportDeclaration(export) = statement {
                match &export.declaration {
                    Declaration::FunctionDeclaration(function)
                        if function.id.as_ref().is_some_and(|id| id.name == name) =>
                    {
                        return evaluator.call_function(function, arguments);
                    }
                    Declaration::VariableDeclaration(declaration) => {
                        for declarator in &declaration.declarations {
                            if declarator
                                .id
                                .get_binding_identifier()
                                .is_some_and(|id| id.name == name)
                                && let Some(expression) = &declarator.init
                            {
                                return evaluator.call_expression_value(expression, arguments);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        for statement in &parsed.program.body {
            match statement {
                Statement::ExportNamedDeclaration(export) => {
                    for specifier in &export.specifiers {
                        if module_name(&specifier.exported) != name {
                            continue;
                        }
                        if let ModuleExportName::IdentifierReference(identifier) = &specifier.local
                            && let Some(reference) = identifier.reference_id.get()
                            && let Some(symbol) =
                                evaluator.scoping.get_reference(reference).symbol_id()
                        {
                            return evaluator.call_symbol(symbol, arguments);
                        }
                    }
                }
                Statement::ExportFromDeclaration(export) => {
                    for specifier in &export.specifiers {
                        if module_name(&specifier.exported) != name {
                            continue;
                        }
                        let Some(target) = self.resolve(filename, export.source.value.as_str())
                        else {
                            return EvalResult::unknown();
                        };
                        return self.call_export(&target, module_name(&specifier.local), arguments);
                    }
                }
                Statement::ExportAllDeclaration(export) => {
                    let Some(target) = self.resolve(filename, export.source.value.as_str()) else {
                        continue;
                    };
                    let result = self.call_export(&target, name, arguments.clone());
                    if result.value.is_some() || result.complete {
                        return result;
                    }
                }
                _ => {}
            }
        }
        EvalResult::unknown()
    }
}

enum StringSource<'a> {
    Borrowed(&'a str),
    Owned(String),
}
impl StringSource<'_> {
    fn as_str(&self) -> &str {
        match self {
            Self::Borrowed(value) => value,
            Self::Owned(value) => value,
        }
    }
}

pub(crate) struct FileEvaluator<'a, 'project, 'sources> {
    filename: &'a str,
    project: &'project ProjectEvaluator<'sources>,
    semantic: &'a Semantic<'a>,
    pub scoping: &'a Scoping,
    imports: HashMap<SymbolId, ImportBinding>,
    environment: HashMap<SymbolId, EvalResult>,
    evaluating: HashSet<SymbolId>,
}

impl<'a, 'project, 'sources> FileEvaluator<'a, 'project, 'sources> {
    pub fn new(
        filename: &'a str,
        project: &'project ProjectEvaluator<'sources>,
        semantic: &'a Semantic<'a>,
        program: &'a oxc_ast::ast::Program<'a>,
    ) -> Self {
        let scoping = semantic.scoping();
        let mut imports = HashMap::new();
        for statement in &program.body {
            let Statement::ImportDeclaration(declaration) = statement else {
                continue;
            };
            for specifier in declaration.specifiers.iter().flatten() {
                let (local, imported) = match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(specifier) => (
                        &specifier.local,
                        ImportedName::Named(specifier.imported.name().to_string()),
                    ),
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                        (&specifier.local, ImportedName::Default)
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                        (&specifier.local, ImportedName::Namespace)
                    }
                };
                if let Some(symbol) = local.symbol_id.get() {
                    imports.insert(
                        symbol,
                        ImportBinding {
                            specifier: declaration.source.value.to_string(),
                            imported,
                        },
                    );
                }
            }
        }
        Self {
            filename,
            project,
            semantic,
            scoping,
            imports,
            environment: HashMap::new(),
            evaluating: HashSet::new(),
        }
    }

    pub fn evaluate(&mut self, expression: &'a Expression<'a>) -> EvalResult {
        match expression {
            Expression::BooleanLiteral(value) => EvalResult::known(value.value),
            Expression::NullLiteral(_) => EvalResult::known(serde_json::Value::Null),
            Expression::NumericLiteral(value) => serde_json::Number::from_f64(value.value)
                .map_or_else(EvalResult::unknown, |value| {
                    EvalResult::known(serde_json::Value::Number(value))
                }),
            Expression::StringLiteral(value) => {
                EvalResult::known(normalize_whitespace(value.value.as_str()))
            }
            Expression::TemplateLiteral(template) => {
                let mut output = String::new();
                let mut complete = true;
                for (index, quasi) in template.quasis.iter().enumerate() {
                    let raw = quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |value| value.as_str());
                    output.push_str(raw);
                    if let Some(expression) = template.expressions.get(index) {
                        let value = self.evaluate(expression);
                        complete &= value.complete;
                        let Some(value) = value.value else {
                            return EvalResult::unknown();
                        };
                        output.push_str(&to_js_string(&value));
                    }
                }
                let mut result = EvalResult::known(normalize_whitespace(&output));
                result.complete = complete;
                result
            }
            Expression::ArrayExpression(array) => {
                let mut output = Vec::new();
                let mut conditions = Vec::new();
                let mut complete = true;
                for element in &array.elements {
                    match element {
                        oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread) => {
                            let value = self.evaluate(&spread.argument);
                            complete &= value.complete;
                            conditions.extend(value.conditions);
                            if let Some(serde_json::Value::Array(values)) = value.value {
                                output.extend(values);
                            } else {
                                complete = false;
                            }
                        }
                        oxc_ast::ast::ArrayExpressionElement::Elision(_) => {
                            output.push(serde_json::Value::Null)
                        }
                        _ => {
                            let value = element
                                .as_expression()
                                .map_or_else(EvalResult::unknown, |value| self.evaluate(value));
                            complete &= value.complete;
                            conditions.extend(value.conditions);
                            output.push(value.value.unwrap_or(serde_json::Value::Null));
                        }
                    }
                }
                EvalResult {
                    value: Some(output.into()),
                    conditions,
                    complete,
                }
            }
            Expression::ObjectExpression(object) => {
                let mut output = serde_json::Map::with_capacity(object.properties.len());
                let mut conditions = Vec::new();
                let mut complete = true;
                for property in &object.properties {
                    match property {
                        ObjectPropertyKind::ObjectProperty(property) => {
                            if property.method {
                                complete = false;
                                continue;
                            }
                            let key = if property.computed {
                                property
                                    .key
                                    .as_expression()
                                    .and_then(|key| self.evaluate(key).value)
                                    .map(|key| to_js_string(&key))
                            } else {
                                property.key.static_name().map(|name| name.into_owned())
                            };
                            let Some(key) = key else {
                                complete = false;
                                continue;
                            };
                            let value = self.evaluate(&property.value);
                            complete &= value.complete;
                            for condition in value.conditions {
                                let mut fragment = serde_json::Map::new();
                                fragment.insert(key.clone(), condition);
                                conditions.push(fragment.into());
                            }
                            if let Some(value) = value.value {
                                output.insert(key, value);
                            }
                        }
                        ObjectPropertyKind::SpreadProperty(spread) => {
                            let value = self.evaluate(&spread.argument);
                            complete &= value.complete;
                            conditions.extend(value.conditions);
                            if let Some(serde_json::Value::Object(values)) = value.value {
                                output.extend(values);
                            } else {
                                complete = false;
                            }
                        }
                    }
                }
                EvalResult {
                    value: Some(output.into()),
                    conditions,
                    complete,
                }
            }
            Expression::Identifier(identifier) => {
                if identifier.name == "undefined" {
                    return EvalResult::undefined();
                }
                let Some(reference) = identifier.reference_id.get() else {
                    return EvalResult::unknown();
                };
                let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else {
                    return EvalResult::unknown();
                };
                self.evaluate_symbol(symbol)
            }
            Expression::StaticMemberExpression(member) => {
                let object = self.evaluate(&member.object);
                member_value(object, member.property.name.as_str())
            }
            Expression::ComputedMemberExpression(member) => {
                let object = self.evaluate(&member.object);
                let property = self.evaluate(&member.expression);
                let Some(property) = property.value.map(|value| to_js_string(&value)) else {
                    return EvalResult::unknown();
                };
                member_value(object, &property)
            }
            Expression::ParenthesizedExpression(value) => self.evaluate(&value.expression),
            Expression::TSAsExpression(value) => self.evaluate(&value.expression),
            Expression::TSSatisfiesExpression(value) => self.evaluate(&value.expression),
            Expression::TSTypeAssertion(value) => self.evaluate(&value.expression),
            Expression::TSNonNullExpression(value) => self.evaluate(&value.expression),
            Expression::TSInstantiationExpression(value) => self.evaluate(&value.expression),
            Expression::UnaryExpression(value) => {
                self.evaluate_unary(value.operator, &value.argument)
            }
            Expression::BinaryExpression(value) => {
                self.evaluate_binary(value.operator, &value.left, &value.right)
            }
            Expression::LogicalExpression(value) => self.evaluate_logical(value),
            Expression::ConditionalExpression(value) => {
                let test = self.evaluate(&value.test);
                if let Some(test) = test.value {
                    return if truthy(&test) {
                        self.evaluate(&value.consequent)
                    } else {
                        self.evaluate(&value.alternate)
                    };
                }
                let left = self.evaluate(&value.consequent);
                let right = self.evaluate(&value.alternate);
                let mut conditions = left.conditions;
                if let Some(value) = left.value {
                    conditions.push(value);
                }
                conditions.extend(right.conditions);
                if let Some(value) = right.value {
                    conditions.push(value);
                }
                EvalResult {
                    value: None,
                    conditions,
                    complete: left.complete && right.complete,
                }
            }
            Expression::CallExpression(call) => self.evaluate_call(call),
            Expression::SequenceExpression(sequence) => sequence
                .expressions
                .last()
                .map_or_else(EvalResult::undefined, |value| self.evaluate(value)),
            Expression::ChainExpression(_) => EvalResult::unknown(),
            _ => EvalResult::unknown(),
        }
    }

    pub fn evaluate_jsx_expression(&mut self, expression: &'a JSXExpression<'a>) -> EvalResult {
        expression
            .as_expression()
            .map_or_else(EvalResult::undefined, |value| self.evaluate(value))
    }

    pub fn evaluate_symbol(&mut self, symbol: SymbolId) -> EvalResult {
        if let Some(value) = self.environment.get(&symbol) {
            return value.clone();
        }
        if !self.evaluating.insert(symbol) {
            return EvalResult::unknown();
        }
        let result = if let Some(binding) = self.imports.get(&symbol).cloned() {
            self.project.evaluate_import(self.filename, &binding)
        } else {
            match self.semantic.symbol_declaration(symbol).kind() {
                AstKind::VariableDeclarator(declarator) => {
                    let value = declarator
                        .init
                        .as_ref()
                        .map_or_else(EvalResult::undefined, |expression| {
                            self.evaluate(expression)
                        });
                    // A destructured symbol denotes its property, not the declarator's entire
                    // initializer. Binding every sibling at once also mirrors JavaScript's
                    // defaults and avoids re-evaluating the same static initializer.
                    self.bind_pattern(&declarator.id, value);
                    self.environment
                        .get(&symbol)
                        .cloned()
                        .unwrap_or_else(EvalResult::unknown)
                }
                _ => EvalResult::unknown(),
            }
        };
        self.evaluating.remove(&symbol);
        result
    }

    fn evaluate_unary(
        &mut self,
        operator: UnaryOperator,
        argument: &'a Expression<'a>,
    ) -> EvalResult {
        if operator == UnaryOperator::Void {
            return EvalResult::undefined();
        }
        let value = self.evaluate(argument);
        let Some(value) = value.value else {
            return EvalResult::unknown();
        };
        match operator {
            UnaryOperator::LogicalNot => EvalResult::known(!truthy(&value)),
            UnaryOperator::UnaryPlus => number_value(&value)
                .and_then(serde_json::Number::from_f64)
                .map_or_else(EvalResult::unknown, |n| {
                    EvalResult::known(serde_json::Value::Number(n))
                }),
            UnaryOperator::UnaryNegation => number_value(&value)
                .and_then(|number| serde_json::Number::from_f64(-number))
                .map_or_else(EvalResult::unknown, |n| {
                    EvalResult::known(serde_json::Value::Number(n))
                }),
            UnaryOperator::BitwiseNot => number_value(&value)
                .map(|number| EvalResult::known(!(number as i32)))
                .unwrap_or_else(EvalResult::unknown),
            UnaryOperator::Typeof => EvalResult::known(match value {
                serde_json::Value::Null => "object",
                serde_json::Value::Bool(_) => "boolean",
                serde_json::Value::Number(_) => "number",
                serde_json::Value::String(_) => "string",
                _ => "object",
            }),
            UnaryOperator::Delete => EvalResult::known(true),
            UnaryOperator::Void => EvalResult::undefined(),
        }
    }

    fn evaluate_binary(
        &mut self,
        operator: BinaryOperator,
        left: &'a Expression<'a>,
        right: &'a Expression<'a>,
    ) -> EvalResult {
        let left = self.evaluate(left);
        let right = self.evaluate(right);
        let complete = left.complete && right.complete;
        let (Some(left), Some(right)) = (left.value, right.value) else {
            return EvalResult::unknown();
        };
        let value = match operator {
            // The established extractor boxes `+` through property-name evaluation, which
            // stringifies both sides even when both are numeric. Preserve that observable
            // behavior: class names and CSS snapshots already contain it.
            BinaryOperator::Addition => Some(serde_json::Value::String(format!(
                "{}{}",
                to_js_string(&left),
                to_js_string(&right)
            ))),
            BinaryOperator::Subtraction => numeric_binary(&left, &right, |a, b| a - b),
            BinaryOperator::Multiplication => numeric_binary(&left, &right, |a, b| a * b),
            BinaryOperator::Division => numeric_binary(&left, &right, |a, b| a / b),
            BinaryOperator::Remainder => numeric_binary(&left, &right, |a, b| a % b),
            BinaryOperator::Exponential => numeric_binary(&left, &right, f64::powf),
            BinaryOperator::Equality | BinaryOperator::StrictEquality => {
                Some((left == right).into())
            }
            BinaryOperator::Inequality | BinaryOperator::StrictInequality => {
                Some((left != right).into())
            }
            BinaryOperator::LessThan => compare_binary(&left, &right, |a, b| a < b),
            BinaryOperator::LessEqualThan => compare_binary(&left, &right, |a, b| a <= b),
            BinaryOperator::GreaterThan => compare_binary(&left, &right, |a, b| a > b),
            BinaryOperator::GreaterEqualThan => compare_binary(&left, &right, |a, b| a >= b),
            BinaryOperator::BitwiseOR => integer_binary(&left, &right, |a, b| a | b),
            BinaryOperator::BitwiseXOR => integer_binary(&left, &right, |a, b| a ^ b),
            BinaryOperator::BitwiseAnd => integer_binary(&left, &right, |a, b| a & b),
            BinaryOperator::ShiftLeft => integer_binary(&left, &right, |a, b| a << b),
            BinaryOperator::ShiftRight | BinaryOperator::ShiftRightZeroFill => {
                integer_binary(&left, &right, |a, b| a >> b)
            }
            BinaryOperator::In => match right {
                serde_json::Value::Object(ref object) => {
                    Some(object.contains_key(&to_js_string(&left)).into())
                }
                serde_json::Value::Array(ref array) => Some(
                    to_js_string(&left)
                        .parse::<usize>()
                        .is_ok_and(|index| index < array.len())
                        .into(),
                ),
                _ => None,
            },
            BinaryOperator::Instanceof => None,
        };
        value.map_or_else(EvalResult::unknown, |value| EvalResult {
            value: Some(value),
            conditions: Vec::new(),
            complete,
        })
    }

    fn evaluate_logical(&mut self, expression: &'a LogicalExpression<'a>) -> EvalResult {
        let left = self.evaluate(&expression.left);
        if let Some(value) = &left.value {
            let select_right = match expression.operator {
                LogicalOperator::Or => !truthy(value),
                LogicalOperator::And => truthy(value),
                LogicalOperator::Coalesce => value.is_null(),
            };
            return if select_right {
                self.evaluate(&expression.right)
            } else {
                left
            };
        }
        let right = self.evaluate(&expression.right);
        let mut conditions = left.conditions;
        conditions.extend(right.conditions);
        if let Some(value) = right.value {
            conditions.push(value);
        }
        EvalResult {
            value: None,
            conditions,
            complete: left.complete && right.complete,
        }
    }

    fn evaluate_call(&mut self, call: &'a CallExpression<'a>) -> EvalResult {
        let arguments = call
            .arguments
            .iter()
            .map(|argument| match argument {
                Argument::SpreadElement(_) => EvalResult::unknown(),
                _ => argument
                    .as_expression()
                    .map_or_else(EvalResult::unknown, |argument| self.evaluate(argument)),
            })
            .collect::<Vec<_>>();

        if let Expression::StaticMemberExpression(member) = &call.callee
            && member.property.name == "join"
        {
            let array = self.evaluate(&member.object);
            let separator = arguments
                .first()
                .and_then(|argument| argument.value.as_ref())
                .map_or_else(|| ",".to_string(), to_js_string);
            if let Some(serde_json::Value::Array(values)) = array.value {
                return EvalResult {
                    value: Some(
                        values
                            .iter()
                            .map(to_js_string)
                            .collect::<Vec<_>>()
                            .join(&separator)
                            .into(),
                    ),
                    conditions: Vec::new(),
                    complete: array.complete && arguments.iter().all(|argument| argument.complete),
                };
            }
        }

        if let Some((symbol, members)) = callee_symbol_and_members(&call.callee, self.scoping) {
            if let Some(binding) = self.imports.get(&symbol).cloned() {
                if let Some(entrypoint) = self.project.entrypoint(&binding.specifier) {
                    let mut path = match &binding.imported {
                        ImportedName::Named(name) => vec![name.clone()],
                        ImportedName::Namespace => Vec::new(),
                        ImportedName::Default => return EvalResult::unknown(),
                    };
                    path.extend(members.iter().cloned());
                    if entrypoint.kind == "token"
                        && path.first().is_some_and(|name| name == "token")
                    {
                        let is_value = path.get(1).is_some_and(|name| name == "value");
                        let Some(token_path) = arguments
                            .first()
                            .and_then(|value| value.value.as_ref())
                            .and_then(|value| value.as_str())
                        else {
                            return EvalResult::unknown();
                        };
                        return self
                            .project
                            .token(token_path, is_value)
                            .map_or_else(EvalResult::undefined, EvalResult::known);
                    }
                    if entrypoint.kind == "css"
                        && path.first().is_some_and(|name| name == "fallback")
                    {
                        if arguments.iter().any(|value| value.value.is_none()) {
                            return EvalResult::undefined();
                        }
                        return EvalResult::known(format!(
                            "fallback({})",
                            arguments
                                .iter()
                                .map(|value| to_js_string(value.value.as_ref().unwrap()))
                                .collect::<Vec<_>>()
                                .join(", ")
                        ));
                    }
                    if path.get(1).is_some_and(|name| name == "raw") {
                        return arguments
                            .into_iter()
                            .next()
                            .unwrap_or_else(EvalResult::undefined);
                    }
                }
                if members.is_empty() {
                    return self
                        .project
                        .call_imported(self.filename, &binding, arguments);
                }
            }
            if members.is_empty() {
                return self.call_symbol(symbol, arguments);
            }
        }

        // Object.assign({}, a, b) is common in helper modules and remains deterministic.
        if global_callee_path(&call.callee).as_deref()
            == Some(&["Object".to_string(), "assign".to_string()][..])
        {
            let mut output = serde_json::Map::new();
            let mut complete = true;
            for argument in arguments {
                complete &= argument.complete;
                if let Some(serde_json::Value::Object(value)) = argument.value {
                    output.extend(value);
                } else {
                    complete = false;
                }
            }
            return EvalResult {
                value: Some(output.into()),
                conditions: Vec::new(),
                complete,
            };
        }
        EvalResult::unknown()
    }

    pub fn call_symbol(&mut self, symbol: SymbolId, arguments: Vec<EvalResult>) -> EvalResult {
        if let Some(binding) = self.imports.get(&symbol).cloned() {
            return self
                .project
                .call_imported(self.filename, &binding, arguments);
        }
        match self.semantic.symbol_declaration(symbol).kind() {
            AstKind::Function(function) => self.call_function(function, arguments),
            AstKind::VariableDeclarator(declarator) => declarator
                .init
                .as_ref()
                .map_or_else(EvalResult::unknown, |expression| {
                    self.call_expression_value(expression, arguments)
                }),
            _ => EvalResult::unknown(),
        }
    }

    pub fn call_expression_value(
        &mut self,
        expression: &'a Expression<'a>,
        arguments: Vec<EvalResult>,
    ) -> EvalResult {
        match expression {
            Expression::ArrowFunctionExpression(function) => self.call_arrow(function, arguments),
            Expression::FunctionExpression(function) => self.call_function(function, arguments),
            Expression::Identifier(identifier) => {
                let Some(reference) = identifier.reference_id.get() else {
                    return EvalResult::unknown();
                };
                let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else {
                    return EvalResult::unknown();
                };
                self.call_symbol(symbol, arguments)
            }
            Expression::ParenthesizedExpression(value) => {
                self.call_expression_value(&value.expression, arguments)
            }
            Expression::TSAsExpression(value) => {
                self.call_expression_value(&value.expression, arguments)
            }
            Expression::TSSatisfiesExpression(value) => {
                self.call_expression_value(&value.expression, arguments)
            }
            _ => EvalResult::unknown(),
        }
    }

    pub fn call_function(
        &mut self,
        function: &'a Function<'a>,
        arguments: Vec<EvalResult>,
    ) -> EvalResult {
        let Some(body) = function.body.as_deref() else {
            return EvalResult::unknown();
        };
        self.call_body(&function.params, body, arguments)
    }

    fn call_arrow(
        &mut self,
        function: &'a ArrowFunctionExpression<'a>,
        arguments: Vec<EvalResult>,
    ) -> EvalResult {
        let previous = self.environment.clone();
        self.bind_parameters(&function.params, arguments);
        let result = match &function.body {
            ArrowFunctionBody::FunctionBody(body) => self.execute_statements(&body.statements),
            _ => function
                .body
                .as_expression()
                .map_or_else(EvalResult::unknown, |body| self.evaluate(body)),
        };
        self.environment = previous;
        result
    }

    fn call_body(
        &mut self,
        parameters: &'a FormalParameters<'a>,
        body: &'a FunctionBody<'a>,
        arguments: Vec<EvalResult>,
    ) -> EvalResult {
        let previous = self.environment.clone();
        self.bind_parameters(parameters, arguments);
        let result = self.execute_statements(&body.statements);
        self.environment = previous;
        result
    }

    fn bind_parameters(
        &mut self,
        parameters: &'a FormalParameters<'a>,
        arguments: Vec<EvalResult>,
    ) {
        for (index, parameter) in parameters.items.iter().enumerate() {
            let mut value = arguments
                .get(index)
                .cloned()
                .unwrap_or_else(EvalResult::undefined);
            if value.value.is_none()
                && value.complete
                && let Some(initializer) = parameter.initializer.as_deref()
            {
                value = self.evaluate(initializer);
            }
            self.bind_pattern(&parameter.pattern, value);
        }
        if let Some(rest) = &parameters.rest {
            let values = &arguments[parameters.items.len().min(arguments.len())..];
            let complete = values
                .iter()
                .all(|value| value.complete && value.value.is_some());
            let value = complete.then(|| {
                values
                    .iter()
                    .filter_map(|value| value.value.clone())
                    .collect::<Vec<_>>()
                    .into()
            });
            self.bind_pattern(
                &rest.rest.argument,
                EvalResult {
                    value,
                    conditions: Vec::new(),
                    complete,
                },
            );
        }
    }

    fn bind_pattern(&mut self, pattern: &'a BindingPattern<'a>, value: EvalResult) {
        match pattern {
            BindingPattern::BindingIdentifier(identifier) => {
                if let Some(symbol) = identifier.symbol_id.get() {
                    self.environment.insert(symbol, value);
                }
            }
            BindingPattern::AssignmentPattern(pattern) => {
                let value = if value.value.is_none() && value.complete {
                    self.evaluate(&pattern.right)
                } else {
                    value
                };
                self.bind_pattern(&pattern.left, value);
            }
            BindingPattern::ObjectPattern(pattern) => {
                let mut consumed = Vec::new();
                for property in &pattern.properties {
                    let key = if property.computed {
                        property
                            .key
                            .as_expression()
                            .and_then(|key| self.evaluate(key).value)
                            .map(|value| to_js_string(&value))
                    } else {
                        property.key.static_name().map(|name| name.into_owned())
                    };
                    if let Some(key) = &key {
                        consumed.push(key.clone());
                    }
                    let child = key
                        .map_or_else(EvalResult::unknown, |key| member_value(value.clone(), &key));
                    self.bind_pattern(&property.value, child);
                }
                if let Some(rest) = &pattern.rest {
                    let mut remainder = value.clone();
                    remainder.value = match remainder.value {
                        Some(serde_json::Value::Object(mut object)) => {
                            for key in consumed {
                                object.remove(&key);
                            }
                            Some(object.into())
                        }
                        _ => None,
                    };
                    if remainder.value.is_none() {
                        remainder.complete = false;
                    }
                    self.bind_pattern(&rest.argument, remainder);
                }
            }
            BindingPattern::ArrayPattern(pattern) => {
                for (index, element) in pattern.elements.iter().enumerate() {
                    if let Some(element) = element {
                        self.bind_pattern(element, member_value(value.clone(), &index.to_string()));
                    }
                }
                if let Some(rest) = &pattern.rest {
                    let mut remainder = value;
                    remainder.value = match remainder.value {
                        Some(serde_json::Value::Array(array)) => Some(
                            array
                                .into_iter()
                                .skip(pattern.elements.len())
                                .collect::<Vec<_>>()
                                .into(),
                        ),
                        _ => None,
                    };
                    if remainder.value.is_none() {
                        remainder.complete = false;
                    }
                    self.bind_pattern(&rest.argument, remainder);
                }
            }
        }
    }

    fn execute_statements(&mut self, statements: &'a [Statement<'a>]) -> EvalResult {
        for statement in statements {
            match statement {
                Statement::ReturnStatement(statement) => {
                    return statement
                        .argument
                        .as_ref()
                        .map_or_else(EvalResult::undefined, |value| self.evaluate(value));
                }
                Statement::VariableDeclaration(declaration) => {
                    for declarator in &declaration.declarations {
                        let value = declarator
                            .init
                            .as_ref()
                            .map_or_else(EvalResult::undefined, |value| self.evaluate(value));
                        self.bind_pattern(&declarator.id, value);
                    }
                }
                Statement::IfStatement(statement) => {
                    let test = self.evaluate(&statement.test);
                    if let Some(test) = test.value {
                        let selected = if truthy(&test) {
                            Some(&statement.consequent)
                        } else {
                            statement.alternate.as_ref()
                        };
                        if let Some(selected) = selected {
                            let result = self.execute_statement(selected);
                            if result.value.is_some() || !result.complete {
                                return result;
                            }
                        }
                    } else {
                        return EvalResult::unknown();
                    }
                }
                Statement::BlockStatement(block) => {
                    let result = self.execute_statements(&block.body);
                    if result.value.is_some() || !result.complete {
                        return result;
                    }
                }
                _ => {}
            }
        }
        EvalResult::undefined()
    }

    fn execute_statement(&mut self, statement: &'a Statement<'a>) -> EvalResult {
        match statement {
            Statement::BlockStatement(block) => self.execute_statements(&block.body),
            Statement::ReturnStatement(statement) => statement
                .argument
                .as_ref()
                .map_or_else(EvalResult::undefined, |value| self.evaluate(value)),
            _ => self.execute_statements(std::slice::from_ref(statement)),
        }
    }
}

fn callee_symbol_and_members(
    expression: &Expression<'_>,
    scoping: &Scoping,
) -> Option<(SymbolId, Vec<String>)> {
    match expression {
        Expression::Identifier(identifier) => {
            let reference = identifier.reference_id.get()?;
            Some((scoping.get_reference(reference).symbol_id()?, Vec::new()))
        }
        Expression::StaticMemberExpression(member) => {
            let (symbol, mut members) = callee_symbol_and_members(&member.object, scoping)?;
            members.push(member.property.name.to_string());
            Some((symbol, members))
        }
        Expression::ComputedMemberExpression(member) => {
            let Expression::StringLiteral(property) = &member.expression else {
                return None;
            };
            let (symbol, mut members) = callee_symbol_and_members(&member.object, scoping)?;
            members.push(property.value.to_string());
            Some((symbol, members))
        }
        Expression::ParenthesizedExpression(value) => {
            callee_symbol_and_members(&value.expression, scoping)
        }
        _ => None,
    }
}

fn global_callee_path(expression: &Expression<'_>) -> Option<Vec<String>> {
    match expression {
        Expression::Identifier(identifier) if identifier.reference_id.get().is_some() => {
            Some(vec![identifier.name.to_string()])
        }
        Expression::StaticMemberExpression(member) => {
            let mut path = global_callee_path(&member.object)?;
            path.push(member.property.name.to_string());
            Some(path)
        }
        _ => None,
    }
}

fn member_value(mut result: EvalResult, property: &str) -> EvalResult {
    let object_was_known = result.value.is_some();
    result.value = match result.value {
        Some(serde_json::Value::Object(object)) => object.get(property).cloned(),
        Some(serde_json::Value::Array(array)) => {
            if property == "length" {
                Some(array.len().into())
            } else {
                property
                    .parse::<usize>()
                    .ok()
                    .and_then(|index| array.get(index).cloned())
            }
        }
        Some(serde_json::Value::String(value)) if property == "length" => {
            Some(value.encode_utf16().count().into())
        }
        _ => None,
    };
    // A missing property on a known value is JavaScript's known `undefined`; only a member of
    // an unknown receiver remains unresolved.
    if result.value.is_none() && !object_was_known {
        result.complete = false;
    }
    result
}

fn module_name<'a>(name: &'a ModuleExportName<'a>) -> &'a str {
    name.name().as_str()
}

fn normalize_path(path: &str) -> String {
    let path = PathBuf::from(path);
    let mut output = PathBuf::new();
    for component in path.components() {
        use std::path::Component;
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                output.pop();
            }
            other => output.push(other.as_os_str()),
        }
    }
    output.to_string_lossy().replace('\\', "/")
}

fn source_type_for(filename: &str) -> SourceType {
    SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx())
}

fn collect_package_targets(value: &serde_json::Value, output: &mut Vec<String>) {
    match value {
        serde_json::Value::String(value) => output.push(value.clone()),
        serde_json::Value::Array(values) => {
            for value in values {
                collect_package_targets(value, output);
            }
        }
        serde_json::Value::Object(values) => {
            // TypeScript's bundler resolution prefers the import/default branches. Preserve
            // declaration order for other condition sets rather than executing package code.
            for condition in ["import", "default", "types"] {
                if let Some(value) = values.get(condition) {
                    collect_package_targets(value, output);
                    return;
                }
            }
            if let Some(value) = values.values().next() {
                collect_package_targets(value, output);
            }
        }
        _ => {}
    }
}

fn path_mapping_priority(pattern: &str) -> (bool, usize, usize) {
    let Some(star) = pattern.find('*') else {
        return (true, pattern.len(), 0);
    };
    (false, star, pattern.len() - star - 1)
}

fn package_mapping<'map, 'specifier>(
    mappings: &'map serde_json::Map<String, serde_json::Value>,
    specifier: &'specifier str,
) -> Option<(&'map serde_json::Value, &'specifier str)> {
    if let Some(value) = mappings.get(specifier) {
        return Some((value, ""));
    }
    mappings
        .iter()
        .filter_map(|(pattern, value)| {
            wildcard_match(pattern, specifier).map(|capture| (pattern, value, capture))
        })
        .max_by_key(|(pattern, _, _)| path_mapping_priority(pattern))
        .map(|(_, value, capture)| (value, capture))
}

fn wildcard_match<'a>(pattern: &str, specifier: &'a str) -> Option<&'a str> {
    let Some(star) = pattern.find('*') else {
        return (pattern == specifier).then_some("");
    };
    let (head, tail_with_star) = pattern.split_at(star);
    let tail = &tail_with_star[1..];
    specifier.strip_prefix(head)?.strip_suffix(tail)
}

fn path_candidates(base: &Path) -> Vec<PathBuf> {
    const EXTENSIONS: &[&str] = &["ts", "tsx", "d.ts", "mts", "cts", "js", "jsx", "mjs", "cjs"];
    let mut output = vec![base.to_path_buf()];
    let text = base.to_string_lossy();
    let emitted = [
        (".js", &[".ts", ".tsx", ".d.ts", ".js", ".jsx"][..]),
        (".mjs", &[".mts", ".d.mts", ".mjs"][..]),
        (".cjs", &[".cts", ".d.cts", ".cjs"][..]),
    ];
    if let Some((suffix, replacements)) = emitted.iter().find(|(suffix, _)| text.ends_with(suffix))
    {
        output.clear();
        for replacement in *replacements {
            output.push(PathBuf::from(format!(
                "{}{}",
                &text[..text.len() - suffix.len()],
                replacement
            )));
        }
    } else if base.extension().is_none() {
        for extension in EXTENSIONS {
            output.push(PathBuf::from(format!("{text}.{extension}")));
        }
        for extension in EXTENSIONS {
            output.push(base.join(format!("index.{extension}")));
        }
    }
    output
}

fn is_javascript_whitespace(character: char) -> bool {
    matches!(character, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

fn normalize_whitespace(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut whitespace = false;
    for character in value.chars() {
        if is_javascript_whitespace(character) {
            if !whitespace {
                output.push(' ');
                whitespace = true;
            }
        } else {
            output.push(character);
            whitespace = false;
        }
    }
    output
}

fn truthy(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(value) => *value,
        serde_json::Value::Number(value) => value
            .as_f64()
            .is_some_and(|value| value != 0.0 && !value.is_nan()),
        serde_json::Value::String(value) => !value.is_empty(),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => true,
    }
}

fn to_js_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => {
            let number = value.as_f64().unwrap_or(f64::NAN);
            if number.fract() == 0.0 && number.is_finite() {
                format!("{number:.0}")
            } else {
                value.to_string()
            }
        }
        serde_json::Value::String(value) => value.clone(),
        serde_json::Value::Array(values) => values
            .iter()
            .map(to_js_string)
            .collect::<Vec<_>>()
            .join(","),
        serde_json::Value::Object(_) => "[object Object]".to_string(),
    }
}

fn number_value(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Null => Some(0.0),
        serde_json::Value::Bool(value) => Some(if *value { 1.0 } else { 0.0 }),
        serde_json::Value::Number(value) => value.as_f64(),
        serde_json::Value::String(value) => value.trim().parse().ok(),
        _ => None,
    }
}

fn numeric_binary(
    left: &serde_json::Value,
    right: &serde_json::Value,
    operation: impl FnOnce(f64, f64) -> f64,
) -> Option<serde_json::Value> {
    serde_json::Number::from_f64(operation(number_value(left)?, number_value(right)?))
        .map(Into::into)
}
fn integer_binary(
    left: &serde_json::Value,
    right: &serde_json::Value,
    operation: impl FnOnce(i32, i32) -> i32,
) -> Option<serde_json::Value> {
    Some(operation(number_value(left)? as i32, number_value(right)? as i32).into())
}
fn compare_binary(
    left: &serde_json::Value,
    right: &serde_json::Value,
    operation: impl FnOnce(f64, f64) -> bool,
) -> Option<serde_json::Value> {
    Some(operation(number_value(left)?, number_value(right)?).into())
}

// Keep the N-API option types used in this module live under strict dead-code linting even
// when a platform build strips one branch of module resolution.
const _: fn(&NativePathMapping, &NativeToken) = |_, _| {};
