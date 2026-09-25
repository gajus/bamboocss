const require_chunk = require("./chunk.cjs");
let node_path = require("node:path");
let _bamboocss_shared = require("@bamboocss/shared");
let magic_string = require("magic-string");
magic_string = require_chunk.__toESM(magic_string);
let _bamboocss_config_ts_path = require("@bamboocss/config/ts-path");
//#region src/fold-recipe.ts
/**
* Binding name → the config it was declared with, for the module's own module-scope recipes.
*
* A name declared twice, or a config that resolved to more than one value, cannot be lowered
* against one config, and guessing would fold half the call sites against the wrong recipe.
*/
const collectRecipeConfigs = (analysis) => {
	const configs = /* @__PURE__ */ new Map();
	for (const definition of analysis.calls) {
		if (definition.kind !== "cva" && definition.kind !== "sva" || !definition.binding) continue;
		const name = definition.binding;
		if (definition.data.length !== 1 || configs.has(name)) {
			configs.set(name, AMBIGUOUS);
			continue;
		}
		const config = definition.data[0];
		if (!config || typeof config !== "object") continue;
		configs.set(name, { config });
	}
	return configs;
};
/** Pick a complete precompiled StyleSet for one or more runtime recipe axes. */
const RECIPE_MAP_HELPER = "cvaMap";
/** Guard the exact compiler against accidentally materialising an enormous Cartesian product. */
const DEFAULT_MAX_RECIPE_STATES = 65536;
/** What `recipe.splitVariantProps` calls, reached directly once the call is lowered. */
const SPLIT_PROPS_HELPER = "splitProps";
/** Marker for a binding the fold must never resolve — declared twice, or unresolvable. */
const AMBIGUOUS = Object.freeze({ config: {} });
/** `.size`, or `["x-large"]` when the variant is not a valid identifier. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const propertyAccess = (key) => IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
/**
* Make a generated compile helper callable at this call site, by whatever name the file gives it.
*
* Unlike `cx`, an inline recipe's callee is a local binding, so there is nothing to match —
* the host here is any import of the generated css module, which a file defining a recipe
* necessarily has, since `cva` came from it.
*/
const ensureRecipeHelperImport = (imported, analysis, shadowedHere, isBambooCssModule, isGeneratedCssModule, newImportModule, helperModuleFromSubpath) => {
	let host;
	let subpathModule;
	for (const declaration of analysis.imports) {
		if (declaration.typeOnly) continue;
		for (const named of declaration.specifiers) {
			if (named.typeOnly) continue;
			if (named.imported === imported) {
				if (!isBambooCssModule(declaration.module)) return void 0;
				return shadowedHere.includes(named.local) ? void 0 : { name: named.local };
			}
		}
		if (!host && isGeneratedCssModule(declaration.module) && declaration.specifiers.length > 0) host = declaration;
		if (!subpathModule) subpathModule = helperModuleFromSubpath?.(declaration.module);
	}
	const fallbackModule = newImportModule ?? subpathModule;
	if (!host && !fallbackModule) return void 0;
	if (analysis.moduleScopeNames.includes(imported)) return void 0;
	if (shadowedHere.includes(imported)) return void 0;
	if (!host) {
		const anchor = analysis.imports.at(-1);
		if (!anchor) return void 0;
		return {
			name: imported,
			insert: {
				pos: anchor.span.end,
				names: [imported],
				module: fallbackModule
			}
		};
	}
	const last = host.specifiers.at(-1);
	if (!last) return void 0;
	return {
		name: imported,
		insert: {
			pos: last.end,
			names: [imported]
		}
	};
};
/**
* Lower one invocation, or say why not.
*
* Every property written at the call site has to be a literal. A selection is not additive —
* an unresolved variant does not merely omit a class, it can change which of several the
* recipe applies — so a partially-known selection is not foldable at all.
*/
const lowerRecipeCall = (call, entry, styleCompiler, slot, maxRecipeStates = DEFAULT_MAX_RECIPE_STATES) => {
	if (!entry || entry === AMBIGUOUS) return {
		kind: "decline",
		reason: "unknown-recipe"
	};
	const { config } = entry;
	if (config.slots !== void 0) {
		if (!Array.isArray(config.slots) || slot !== void 0 && !config.slots.includes(slot)) return {
			kind: "decline",
			reason: "unsupported-shape"
		};
	} else if (slot) return {
		kind: "decline",
		reason: "unsupported-shape"
	};
	if (!config.base && !config.variants && !config.className) return {
		kind: "decline",
		reason: "unknown-recipe"
	};
	if (call.argumentCount > 1) return {
		kind: "decline",
		reason: "unsupported-shape"
	};
	const selection = {};
	/** Variant → the source expression selecting it, for axes that stay runtime decisions. */
	const dynamicAxes = /* @__PURE__ */ new Map();
	/**
	* Variants whose expression could run something, in the order the source evaluates them.
	*
	* The text is kept, not just the key: a later property writing the same key replaces the
	* entry in `dynamicAxes`, and the expression recorded here would then never be emitted.
	*/
	const effectful = [];
	if (call.argumentCount === 1) {
		const written = call.selection;
		if (!written) return {
			kind: "decline",
			reason: "dynamic"
		};
		/**
		* `input(variantProps)` — a selection the build cannot see inside.
		*
		* The complete StyleSets are knowable: the config declares every scalar value each axis
		* accepts. This is the shape a wrapper component takes, where variants are its public API
		* and therefore cannot be literals by definition.
		*
		* An identifier only. Each variant reads the binding again, and re-reading anything else —
		* a call, a property access — would evaluate it once per axis instead of once.
		*/
		if (written.identifier !== void 0) for (const key of Object.keys(config.variants ?? {})) dynamicAxes.set(key, `${written.identifier}${propertyAccess(key)}`);
		else {
			if (written.unenumerable || !written.properties) return {
				kind: "decline",
				reason: "dynamic"
			};
			for (const property of written.properties) {
				const { key } = property;
				if (property.shorthand) {
					dynamicAxes.set(key, property.text);
					delete selection[key];
					continue;
				}
				if (!property.inert) {
					if (!Object.hasOwn(config.variants ?? {}, key)) return {
						kind: "decline",
						reason: "dynamic"
					};
					effectful.push({
						key,
						text: property.text
					});
					dynamicAxes.set(key, property.text);
					delete selection[key];
					continue;
				}
				if (property.literal !== void 0) {
					selection[key] = property.literal;
					dynamicAxes.delete(key);
					continue;
				}
				if (property.resolved === void 0) {
					dynamicAxes.set(key, property.text);
					delete selection[key];
					continue;
				}
				const value = property.resolved;
				if (value !== null && typeof value === "object") return {
					kind: "decline",
					reason: "dynamic"
				};
				selection[key] = value;
				dynamicAxes.delete(key);
			}
		}
	}
	/**
	* Every expression that could run something has to reach the output carrying its own text.
	*
	* A later property writing the same key replaces it in `dynamicAxes` — `badge({ tone: a(),
	* tone: 'b' })` is last-wins for the *value*, but `a()` still runs, and emitting only the
	* literal would delete it. Duplicate keys are a type error in TypeScript; the fold does not
	* typecheck and does transform `.js`, so this is reachable.
	*/
	const everyEffectSurvives = () => effectful.every(({ key, text }) => dynamicAxes.get(key) === text);
	const compiledSelection = (selected) => {
		if (Array.isArray(config.slots) && slot === void 0) {
			const slots = {};
			const classNames = /* @__PURE__ */ new Set();
			for (const slotName of config.slots) {
				const styles = styleCompiler.resolveRecipe(config, selected, slotName);
				if (!styles) return void 0;
				const className = styleCompiler.className(styles);
				slots[slotName] = className;
				for (const token of className.split(" ")) if (token) classNames.add(token);
			}
			return {
				value: slots,
				classNames: [...classNames]
			};
		}
		const styles = styleCompiler.resolveRecipe(config, selected, slot);
		if (!styles) return void 0;
		const className = styleCompiler.className(styles);
		return {
			value: className,
			classNames: className.split(" ").filter(Boolean),
			styles
		};
	};
	if (dynamicAxes.size === 0) {
		if (!everyEffectSurvives()) return {
			kind: "decline",
			reason: "dynamic"
		};
		const compiled = compiledSelection(selection);
		if (!compiled) return {
			kind: "decline",
			reason: "dynamic"
		};
		if (typeof compiled.value === "string") return {
			kind: "class",
			className: compiled.value,
			styles: compiled.styles
		};
		return {
			kind: "slots",
			expression: JSON.stringify(compiled.value),
			classNames: compiled.classNames,
			dynamic: false
		};
	}
	if (!everyEffectSurvives()) return {
		kind: "decline",
		reason: "dynamic"
	};
	if (effectful.length > 1) {
		const variantOrder = Object.keys(config.variants ?? {});
		const keys = effectful.map((entry) => entry.key);
		if ([...keys].sort((a, b) => variantOrder.indexOf(a) - variantOrder.indexOf(b)).join("\0") !== keys.join("\0")) return {
			kind: "decline",
			reason: "dynamic"
		};
	}
	for (const key of [...dynamicAxes.keys()]) if (!Object.hasOwn(config.variants ?? {}, key)) dynamicAxes.delete(key);
	if (dynamicAxes.size === 0) {
		const compiled = compiledSelection(selection);
		if (!compiled) return {
			kind: "decline",
			reason: "dynamic"
		};
		if (typeof compiled.value === "string") return {
			kind: "class",
			className: compiled.value,
			styles: compiled.styles
		};
		return {
			kind: "slots",
			expression: JSON.stringify(compiled.value),
			classNames: compiled.classNames,
			dynamic: false
		};
	}
	/**
	* Compile the finite recipe state space into a reduced decision table.
	*
	* Each leaf is a *complete* final StyleSet. This matters for declarations overridden by
	* variants and compounds: selecting independent per-axis atoms would put both values in
	* the utility layer and let stylesheet order, rather than the recipe's merge order, pick
	* the winner. Complete leaves retain the same precedence while sharing their atoms with
	* every `css()` and recipe in the build.
	*
	* `undefined` is its own edge because it restores a default variant. `null` and any
	* undeclared value take the miss edge and explicitly suppress that default. Declared
	* values use string keys, matching JavaScript's property-key coercion in the recipe
	* runtime. A flat alternating key/value array avoids the special `__proto__` semantics
	* of an object literal.
	*/
	const axes = Object.keys(config.variants ?? {}).filter((key) => dynamicAxes.has(key));
	const stateCount = axes.reduce((product, axis) => product * (Object.keys(config.variants?.[axis] ?? {}).length + 2), 1);
	if (stateCount > maxRecipeStates) throw new Error(`Static recipe compilation would inspect ${stateCount.toLocaleString("en-US")} selections across ${axes.length} runtime variant axes, above maxRecipeStates=${maxRecipeStates.toLocaleString("en-US")}. Make one or more axes statically known, split the recipe, or raise the limit explicitly.`);
	const expressions = axes.map((axis) => dynamicAxes.get(axis));
	const wholeSlots = Array.isArray(config.slots) && slot === void 0;
	return {
		kind: "dynamic-style",
		map: {
			outputKind: wholeSlots ? "slots" : "class",
			compile(before = [], after = []) {
				const nodes = [];
				const nodeByShape = /* @__PURE__ */ new Map();
				const leaves = [];
				const leafByShape = /* @__PURE__ */ new Map();
				const emittedClasses = /* @__PURE__ */ new Set();
				const leaf = (dynamicSelection) => {
					const selected = {
						...selection,
						...dynamicSelection
					};
					if (wholeSlots) {
						const compiled = compiledSelection(selected);
						if (!compiled || typeof compiled.value === "string") return internLeaf("");
						for (const token of compiled.classNames) emittedClasses.add(token);
						return internLeaf(compiled.value);
					}
					const styles = styleCompiler.resolveRecipe(config, selected, slot);
					if (!styles) return internLeaf("");
					const className = styleCompiler.className(styleCompiler.compose(...before, styles, ...after));
					for (const token of className.split(" ")) if (token) emittedClasses.add(token);
					return internLeaf(className);
				};
				function internLeaf(value) {
					const shape = JSON.stringify(value);
					const known = leafByShape.get(shape);
					if (known !== void 0) return ~known;
					const id = leaves.length;
					leaves.push(value);
					leafByShape.set(shape, id);
					return ~id;
				}
				const buildNode = (index, dynamicSelection) => {
					if (index === axes.length) return leaf(dynamicSelection);
					const axis = axes[index];
					const values = Object.keys(config.variants?.[axis] ?? {});
					const miss = buildNode(index + 1, {
						...dynamicSelection,
						[axis]: null
					});
					const absentSelection = { ...dynamicSelection };
					delete absentSelection[axis];
					const absent = buildNode(index + 1, absentSelection);
					const byValue = [];
					for (const value of values) byValue.push(value, buildNode(index + 1, {
						...dynamicSelection,
						[axis]: value
					}));
					const refs = [
						miss,
						absent,
						...byValue.filter((_, valueIndex) => valueIndex % 2 === 1)
					];
					if (refs.every((ref) => ref === refs[0])) return refs[0];
					const node = [
						miss,
						absent,
						byValue
					];
					const shape = JSON.stringify(node);
					const known = nodeByShape.get(shape);
					if (known !== void 0) return known;
					const id = nodes.length;
					nodes.push(node);
					nodeByShape.set(shape, id);
					return id;
				};
				const root = buildNode(0, {});
				const staticLeaf = root < 0 ? leaves[~root] : void 0;
				return {
					expression: root < 0 && effectful.length === 0 ? JSON.stringify(staticLeaf) : `${RECIPE_MAP_HELPER}([${expressions.join(", ")}], ${JSON.stringify(nodes)}, ${JSON.stringify(leaves)}, ${root})`,
					classNames: [...emittedClasses],
					staticClasses: typeof staticLeaf === "string" ? staticLeaf : "",
					outputKind: wholeSlots ? "slots" : "class",
					usesHelper: !(root < 0 && effectful.length === 0)
				};
			}
		}
	};
};
//#endregion
//#region src/runtime-css.ts
/** The shape `createCss` and `createMergeCss` both take, derived from a resolved context. */
const createCssContext = (ctx) => ({
	hash: Boolean(ctx.hash.className),
	conditions: {
		shift: ctx.conditions.shift,
		finalize: ctx.conditions.finalize
	},
	utility: {
		prefix: ctx.utility.prefix,
		hasShorthand: ctx.utility.hasShorthand,
		resolveShorthand: ctx.utility.resolveShorthand.bind(ctx.utility),
		transform: ctx.utility.transform.bind(ctx.utility),
		toHash: ctx.utility.toHash.bind(ctx.utility)
	}
});
const createRuntimeCss = (ctx) => {
	const cssContext = createCssContext(ctx);
	const cssFn = (0, _bamboocss_shared.createCssUncached)(cssContext);
	const { mergeCssUncached } = (0, _bamboocss_shared.createMergeCss)(cssContext);
	return (0, _bamboocss_shared.memo)((...styles) => cssFn(mergeCssUncached(...styles)));
};
/**
* The map is every token in the project, so it is built once per context and shared by
* every module in the build — not once per `foldSource`, which would price a whole token
* table into each of the overwhelming majority of modules that call `token()` zero times.
* Keyed weakly so a context that goes out of scope takes its table with it.
*
* Both halves of the generated entry are stored, because `token()` and `token.value()` read
* different ones and building a second table would pay the same per-project cost twice.
*/
const tokenValues = /* @__PURE__ */ new WeakMap();
const tokenValuesFor = (ctx) => {
	let values = tokenValues.get(ctx);
	if (values) return values;
	values = /* @__PURE__ */ new Map();
	for (const token of ctx.tokens.allTokens) {
		const { varRef, isVirtual, condition } = token.extensions;
		values.set(token.name, {
			value: ctx.tokens.view.get(token.name) ?? (isVirtual || condition !== "base" ? varRef : token.value),
			variable: ctx.tokens.view.getVar(token.name) ?? varRef
		});
	}
	tokenValues.set(ctx, values);
	return values;
};
const createRuntimeTokenValue = (ctx) => (path) => {
	const value = tokenValuesFor(ctx).get(path)?.value;
	return typeof value === "string" ? value : void 0;
};
/**
* The generated runtime's `token()`, rebuilt in-process.
*
* Reads the `variable` half of the same entry `token.value()` reads the `value` half of.
* That half is `varRef` for every token regardless of condition, so unlike
* `createRuntimeTokenValue` there is no split to get wrong and no non-string case to
* decline: a `var()` reference is a string or the token does not exist. Which is what makes
* the default form the trivially foldable one.
*/
const createRuntimeToken = (ctx) => (path) => tokenValuesFor(ctx).get(path)?.variable || void 0;
//#endregion
//#region src/fold.ts
/**
* The skip reasons that leave a `css()`-family call in the output.
*
* `overlapping` is handled by the enclosing fold, and `not-imported` is somebody else's
* function of the same name — neither leaves a call of ours.
*/
const SURVIVES_TO_RUNTIME = new Set([
	"dynamic",
	"opaque-composition",
	"runtime-binding",
	"raw-call",
	"unsupported-kind",
	"no-call-expression",
	"unresolved-token",
	"compile-failed"
]);
/**
* Imports a surviving reference to is not a failure.
*
* These are what the compiler itself writes; all live in `cx` and pull no engine, so a
* reference to one is the fold having worked.
*/
const PERMITTED_BINDINGS = new Set([
	"cx",
	RECIPE_MAP_HELPER,
	SPLIT_PROPS_HELPER
]);
const LEADING_RELATIVE = /^(?:\.\.?\/)+/;
const TRAILING_SLASH = /\/$/;
const MODULE_EXTENSION = /\.[mc]?[jt]sx?$/;
const TRAILING_INDEX = /\/index$/;
const hasStyles = (data) => data.length > 0 && data.every((entry) => entry != null && typeof entry === "object");
/** `recipe(props).slot` names a slot only when the recipe declares one by that name. */
const slotsOf = (config) => Array.isArray(config?.slots) ? config.slots : [];
const foldSource = (options) => {
	const { ctx, code, analysis, styleCompiler, maxRecipeStates, reportSurvivors } = options;
	const runtimeToken = createRuntimeToken(ctx);
	const runtimeTokenValue = createRuntimeTokenValue(ctx);
	/**
	* Does this specifier name a module that exports the css API, exactly?
	*
	* `ImportMap.match` is substring-based, which is right for deciding whether a call is
	* bamboo's and wrong for deciding whether a module can be imported *from*:
	* `styled-system/css/css` matches while exporting no `cx`. So the comparison is equality,
	* after resolving a tsconfig path alias the way `ImportMap.match` does and stripping an
	* extension or a trailing `/index`, which bamboo's own output makes a file spell.
	*/
	const cssModules = ctx.imports.matchers.css?.mods ?? [];
	/**
	* The generated css module, the only one whose exports are known. A configured
	* `importMap.css` points at the user's own wrapper, which need not re-export `cx`.
	*/
	const generatedCssModule = [ctx.imports.outdir, "css"].join("/");
	const pathMappings = ctx.conf.tsOptions?.pathMappings;
	const trim = (value) => value.replaceAll("\\", "/").replace(LEADING_RELATIVE, "").replace(TRAILING_SLASH, "").replace(MODULE_EXTENSION, "").replace(TRAILING_INDEX, "");
	const matchesModule = (mod, entries) => {
		const candidates = [mod];
		if (pathMappings) {
			const resolved = (0, _bamboocss_config_ts_path.resolveTsPathPattern)(pathMappings, mod);
			if (resolved) candidates.push(resolved);
		}
		return candidates.some((candidate) => {
			const normalized = trim(candidate);
			return entries.some((entry) => {
				const target = trim(entry);
				return normalized === target || normalized.endsWith(`/${target}`);
			});
		});
	};
	const isBambooCssModule = (mod) => matchesModule(mod, cssModules);
	const isGeneratedCssModule = (mod) => matchesModule(mod, [generatedCssModule]);
	/**
	* Where the compiler's helpers can be imported from, for a file that imports the generated
	* css module by *subpath* — `styled-system/css/cva.js` exports `cva`, not `cvaMap`, so the
	* sibling `cx` module is the host, spelled with the caller's own prefix and extension.
	*/
	const helperModuleFromSubpath = (mod) => {
		const normalized = mod.replaceAll("\\", "/");
		const at = normalized.lastIndexOf("/css/");
		if (at < 0) return void 0;
		const prefix = normalized.slice(0, at + 5 - 1);
		if (!isGeneratedCssModule(prefix)) return void 0;
		const rest = normalized.slice(at + 5);
		if (!rest || rest.includes("/")) return void 0;
		const dot = rest.lastIndexOf(".");
		const extension = dot > 0 ? rest.slice(dot) : "";
		if (rest === `cx${extension}`) return void 0;
		return `${prefix}/cx${extension}`;
	};
	/** The generated css entry as spelled beside an imported config recipe. */
	const configRecipeCssSpecifier = (binding) => {
		for (const declaration of analysis.imports) {
			if (declaration.typeOnly) continue;
			if (!declaration.specifiers.some((named) => !named.typeOnly && named.local === binding)) continue;
			const mod = declaration.module.replaceAll("\\", "/");
			const at = mod.lastIndexOf("/recipes");
			if (at >= 0) return `${mod.slice(0, at)}/css`;
		}
		return generatedCssModule;
	};
	/** A relative specifier learnt from another module, expressed from the module being folded. */
	const rebaseSpecifier = (specifier, declaringPath, consumingPath) => {
		if (!specifier.startsWith(".")) return specifier;
		const absolute = (0, node_path.resolve)((0, node_path.dirname)(declaringPath), specifier);
		const rebased = (0, node_path.relative)((0, node_path.dirname)(consumingPath), absolute).replaceAll("\\", "/");
		if (!rebased) return void 0;
		return rebased.startsWith(".") ? rebased : `./${rebased}`;
	};
	const folded = [];
	const skipped = [];
	/** Modules other than this one whose declarations a folded recipe call selected. */
	const foreignDependencies = /* @__PURE__ */ new Set();
	const recipeConfigs = collectRecipeConfigs(analysis);
	/** The specifier a call's helper import is written with when the file has none to extend. */
	const helperModules = /* @__PURE__ */ new Map();
	for (const imported of analysis.importedRecipes) {
		if (recipeConfigs.has(imported.local)) continue;
		const config = imported.config;
		recipeConfigs.set(imported.local, config && typeof config === "object" ? {
			config,
			filePath: imported.filePath,
			dependencies: imported.dependencies
		} : AMBIGUOUS);
		const cssSpecifier = imported.declaringImports.find((specifier) => isGeneratedCssModule(specifier));
		helperModules.set(imported.local, cssSpecifier ? rebaseSpecifier(cssSpecifier, imported.filePath, options.filePath) : void 0);
	}
	const candidates = [];
	const seenRanges = /* @__PURE__ */ new Set();
	const recipeDefinitions = [];
	for (const call of analysis.calls) {
		const { kind } = call;
		const name = kind === "tokenValue" ? "token" : call.name;
		const start = call.span.start;
		const end = call.span.end;
		if (kind === "cva" || kind === "sva") {
			const entry = call.binding ? recipeConfigs.get(call.binding) : void 0;
			if (call.binding && entry && entry !== AMBIGUOUS) recipeDefinitions.push({
				name: call.binding,
				start,
				end
			});
			continue;
		}
		if (kind === "cx") continue;
		if (call.notImported) {
			skipped.push({
				name,
				reason: "not-imported",
				start,
				end
			});
			continue;
		}
		if (kind === "token" || kind === "tokenValue") {
			const rangeKey = `${start}:${end}`;
			if (seenRanges.has(rangeKey)) continue;
			seenRanges.add(rangeKey);
			const wantsValue = kind === "tokenValue";
			if (!wantsValue && call.calleeProperty !== void 0) {
				skipped.push({
					name,
					reason: "unsupported-kind",
					start,
					end
				});
				continue;
			}
			if (!call.exact || typeof call.data[0] !== "string") {
				skipped.push({
					name,
					reason: "dynamic",
					start,
					end
				});
				continue;
			}
			if (!call.trailingArgumentsInert) {
				skipped.push({
					name,
					reason: "dynamic",
					start,
					end
				});
				continue;
			}
			const path = call.data[0];
			const value = wantsValue ? runtimeTokenValue(path) : runtimeToken(path);
			if (!value) {
				skipped.push({
					name,
					reason: "unresolved-token",
					start,
					end
				});
				continue;
			}
			candidates.push({
				call,
				name,
				start,
				end,
				value
			});
			continue;
		}
		if (kind === "cva-call" || kind === "recipe") {
			const rangeKey = `${start}:${end}`;
			if (seenRanges.has(rangeKey)) continue;
			seenRanges.add(rangeKey);
			if (call.raw) {
				if (kind === "recipe") skipped.push({
					name,
					reason: "raw-call",
					start,
					end
				});
				continue;
			}
			if (kind === "recipe" && !recipeConfigs.has(name)) {
				const config = ctx.recipes.getConfig(name);
				if (config) {
					recipeConfigs.set(name, { config });
					helperModules.set(name, configRecipeCssSpecifier(name));
				}
			}
			const entry = recipeConfigs.get(name);
			const declaredSlots = slotsOf(entry?.config);
			const slot = call.slot !== void 0 && declaredSlots.includes(call.slot) ? call.slot : void 0;
			const replaceEnd = slot !== void 0 ? call.slotEnd ?? end : end;
			const lowered = lowerRecipeCall(call, entry, styleCompiler, slot, maxRecipeStates);
			const helperFor = (helper) => ensureRecipeHelperImport(helper, analysis, call.shadowedHelpers, isBambooCssModule, isGeneratedCssModule, helperModules.get(name), helperModuleFromSubpath);
			const foreign = entry && entry !== AMBIGUOUS ? entry.dependencies : void 0;
			if (lowered.kind === "dynamic-style") {
				const helper = helperFor(RECIPE_MAP_HELPER);
				if (helper) {
					candidates.push({
						call,
						name,
						start,
						end: replaceEnd,
						className: "",
						classNames: [],
						styleMap: lowered.map,
						mapHelperName: helper.name,
						insert: helper.insert,
						outputKind: lowered.map.outputKind === "slots" ? "slots" : void 0,
						foreign
					});
					continue;
				}
				skipped.push({
					name,
					reason: "recipe-call",
					start,
					end
				});
				continue;
			}
			if (lowered.kind === "slots") {
				const helper = lowered.helper ? helperFor(lowered.helper) : void 0;
				if (!lowered.helper || helper) {
					const replacement = lowered.helper && helper && helper.name !== lowered.helper ? lowered.expression.replaceAll(`${lowered.helper}(`, `${helper.name}(`) : lowered.expression;
					candidates.push({
						call,
						name,
						start,
						end: replaceEnd,
						replacement,
						className: "",
						classNames: lowered.classNames,
						insert: helper?.insert,
						outputKind: "slots",
						foreign
					});
					continue;
				}
				skipped.push({
					name,
					reason: "recipe-call",
					start,
					end
				});
				continue;
			}
			if (lowered.kind === "class") {
				candidates.push({
					call,
					name,
					start,
					end: replaceEnd,
					replacement: JSON.stringify(lowered.className),
					className: lowered.className,
					classNames: lowered.className.split(" ").filter(Boolean),
					styleSet: lowered.styles,
					foreign
				});
				continue;
			}
			skipped.push({
				name,
				reason: "recipe-call",
				start,
				end
			});
			continue;
		}
		const rangeKey = `${start}:${end}`;
		if (seenRanges.has(rangeKey)) continue;
		seenRanges.add(rangeKey);
		if (call.raw) {
			skipped.push({
				name,
				reason: "raw-call",
				start,
				end
			});
			continue;
		}
		if (!call.exact || !hasStyles(call.data)) {
			skipped.push({
				name,
				reason: "dynamic",
				start,
				end
			});
			continue;
		}
		candidates.push({
			call,
			name,
			start,
			end
		});
	}
	/**
	* Resolve every fully static candidate to symbolic declarations before allocating a class.
	* An enclosing `cx()` needs the declarations of its arguments so it can discard overridden
	* values before any string exists.
	*/
	for (const candidate of candidates) {
		if (candidate.styleSet || candidate.value !== void 0 || candidate.replacement || candidate.styleMap) continue;
		const { call } = candidate;
		const data = call.data;
		if (call.kind === "css") {
			candidate.styleSet = styleCompiler.compose(...data);
			continue;
		}
		if (call.kind === "pattern") {
			candidate.styleSet = styleCompiler.compose(...data.map((entry) => ctx.patterns.transform(call.name, entry)));
			continue;
		}
		if (call.kind === "viewTransition") {
			const semantic = (0, _bamboocss_shared.viewTransitionClassName)(data[0], ctx.utility.prefix);
			candidate.className = styleCompiler.allocateClassString(semantic);
			candidate.classNames = [candidate.className];
			candidate.replacement = JSON.stringify(candidate.className);
		}
	}
	const byRange = new Map(candidates.map((candidate) => [`${candidate.start}:${candidate.end}`, candidate]));
	for (const call of analysis.calls) {
		if (call.kind !== "cx" || call.notImported) continue;
		const matched = [];
		const parts = [];
		const dynamic = [];
		const constantCandidates = [];
		let supported = true;
		const take = (arg) => {
			const candidate = byRange.get(`${arg.span.start}:${arg.span.end}`);
			if (candidate?.styleMap?.outputKind === "class") {
				dynamic.push(candidate);
				parts.push({
					kind: "dynamic",
					candidate
				});
				return true;
			}
			if (candidate?.styleSet) {
				matched.push(candidate);
				parts.push({
					kind: "style",
					candidate
				});
				return true;
			}
			if (candidate?.call.kind === "viewTransition" && candidate.replacement && candidate.className) {
				constantCandidates.push(candidate);
				parts.push({
					kind: "class",
					value: candidate.className,
					candidate
				});
				return true;
			}
			if (arg.kind === "string") {
				parts.push({
					kind: "class",
					value: arg.value ?? ""
				});
				return true;
			}
			if (arg.kind === "array") {
				if (!arg.elements) return false;
				for (const element of arg.elements) if (!take(element)) return false;
				return true;
			}
			return arg.kind === "ignored";
		};
		for (const arg of call.cxArguments) {
			if (take(arg)) continue;
			supported = false;
			break;
		}
		if (!supported || dynamic.length > 1) {
			const composesStyleSet = (arg) => {
				const candidate = byRange.get(`${arg.span.start}:${arg.span.end}`);
				if (candidate?.styleSet || candidate?.styleMap?.outputKind === "class" || candidate?.replacement) return true;
				return arg.kind === "array" && (arg.elements ?? []).some(composesStyleSet);
			};
			const mixed = !supported && call.cxArguments.some(composesStyleSet);
			skipped.push({
				name: "cx",
				reason: mixed ? "opaque-composition" : "dynamic",
				start: call.span.start,
				end: call.span.end
			});
			continue;
		}
		const calleeName = localNameOf(analysis, "cx", isBambooCssModule) ?? "cx";
		if (dynamic.length === 1 && matched.length > 0) {
			const dynamicCandidate = dynamic[0];
			const styleParts = parts.filter((part) => part.kind !== "class");
			const dynamicIndex = styleParts.findIndex((part) => part.kind === "dynamic");
			const before = styleParts.slice(0, dynamicIndex).filter((part) => part.kind === "style").map((part) => part.candidate.styleSet);
			const after = styleParts.slice(dynamicIndex + 1).filter((part) => part.kind === "style").map((part) => part.candidate.styleSet);
			const compiled = dynamicCandidate.styleMap.compile(before, after);
			const expression = compiled.usesHelper && dynamicCandidate.mapHelperName && dynamicCandidate.mapHelperName !== "cvaMap" ? compiled.expression.replaceAll(`${RECIPE_MAP_HELPER}(`, `${dynamicCandidate.mapHelperName}(`) : compiled.expression;
			const arguments_ = [];
			let wroteCompiled = false;
			for (const part of parts) {
				if (part.kind === "class") {
					if (part.value) arguments_.push(JSON.stringify(part.value));
					continue;
				}
				if (!wroteCompiled) {
					arguments_.push(expression);
					wroteCompiled = true;
				}
			}
			dynamicCandidate.subsumed = true;
			candidates.push({
				call,
				name: "cx",
				start: call.span.start,
				end: call.span.end,
				replacement: arguments_.length === 1 ? arguments_[0] : `${calleeName}(${arguments_.join(", ")})`,
				className: "",
				classNames: [...compiled.classNames, ...parts.filter((part) => part.kind === "class").flatMap((part) => part.value.split(" "))].filter(Boolean),
				insert: compiled.usesHelper ? dynamicCandidate.insert : void 0,
				foreign: styleParts.flatMap((part) => part.candidate.foreign ?? [])
			});
			continue;
		}
		if (matched.length === 0) {
			if (constantCandidates.length === 0) continue;
			const className = parts.filter((part) => part.kind === "class").map((part) => part.value).filter(Boolean).join(" ");
			candidates.push({
				call,
				name: "cx",
				start: call.span.start,
				end: call.span.end,
				replacement: JSON.stringify(className),
				className,
				classNames: className.split(" ").filter(Boolean)
			});
			continue;
		}
		const merged = styleCompiler.compose(...matched.map((candidate) => candidate.styleSet));
		const compiled = styleCompiler.className(merged);
		const classParts = [];
		let wroteCompiled = false;
		for (const part of parts) {
			if (part.kind === "class") {
				if (part.value) classParts.push(part.value);
				continue;
			}
			if (!wroteCompiled && compiled) {
				classParts.push(compiled);
				wroteCompiled = true;
			}
		}
		candidates.push({
			call,
			name: "cx",
			start: call.span.start,
			end: call.span.end,
			replacement: JSON.stringify(classParts.join(" ")),
			className: classParts.join(" "),
			classNames: classParts.flatMap((part) => part.split(" ")).filter(Boolean),
			styleSet: merged,
			foreign: matched.flatMap((candidate) => candidate.foreign ?? [])
		});
	}
	for (const candidate of candidates) {
		if (!candidate.styleMap || candidate.subsumed || candidate.replacement) continue;
		const compiled = candidate.styleMap.compile();
		candidate.replacement = compiled.usesHelper && candidate.mapHelperName && candidate.mapHelperName !== "cvaMap" ? compiled.expression.replaceAll(`${RECIPE_MAP_HELPER}(`, `${candidate.mapHelperName}(`) : compiled.expression;
		if (!compiled.usesHelper) candidate.insert = void 0;
		candidate.className = compiled.staticClasses;
		candidate.classNames = compiled.classNames;
		candidate.outputKind = compiled.outputKind === "slots" ? "slots" : void 0;
	}
	/** Compile every style fragment a recipe config declares, for nothing but the throw. */
	const assertCompiles = (config) => {
		if (!config) return;
		const fragments = [config.base, ...Object.values(config.variants ?? {}).flatMap(Object.values)];
		for (const compound of config.compoundVariants ?? []) if (compound && typeof compound === "object") fragments.push(compound.css);
		const slots = Array.isArray(config.slots) ? config.slots : void 0;
		for (const fragment of fragments) {
			if (!fragment || typeof fragment !== "object") continue;
			for (const styles of slots ? slots.map((slot) => fragment[slot]) : [fragment]) if (styles && typeof styles === "object") styleCompiler.className(styles);
		}
	};
	/** Ranges the rewrite actually replaced. */
	const applied = [];
	if (candidates.length === 0 && recipeDefinitions.length === 0) {
		if (reportSurvivors) reportRuntimeBindings();
		return {
			code,
			map: null,
			folded,
			skipped,
			dependencies: []
		};
	}
	candidates.sort((a, b) => a.start - b.start || b.end - a.end);
	const magic = new magic_string.default(code);
	const insertedNames = /* @__PURE__ */ new Set();
	const applyInsert = (insert) => {
		if (!insert) return;
		const missing = insert.names.filter((name) => !insertedNames.has(name));
		if (!missing.length) return;
		magic.appendLeft(insert.pos, insert.module ? `\nimport { ${missing.join(", ")} } from '${insert.module}'` : missing.map((name) => `, ${name}`).join(""));
		for (const name of missing) insertedNames.add(name);
	};
	const collides = (start, end) => applied.some(([from, to]) => start < to && from < end);
	for (const candidate of candidates) {
		if (candidate.subsumed) continue;
		const { name, start, end } = candidate;
		if (collides(start, end)) {
			skipped.push({
				name,
				reason: "overlapping",
				start,
				end
			});
			continue;
		}
		for (const dependency of candidate.foreign ?? []) foreignDependencies.add(dependency);
		if (candidate.value !== void 0) {
			magic.overwrite(start, end, JSON.stringify(candidate.value));
			applied.push([start, end]);
			folded.push({
				name,
				kind: "value",
				className: "",
				classNames: [],
				value: candidate.value,
				start,
				end
			});
			continue;
		}
		if (candidate.replacement) {
			magic.overwrite(start, end, candidate.replacement);
			applyInsert(candidate.insert);
			applied.push([start, end]);
			folded.push({
				name,
				kind: candidate.outputKind ?? "class",
				className: candidate.className ?? "",
				classNames: (candidate.classNames ?? [candidate.className ?? ""]).filter(Boolean),
				start,
				end
			});
			continue;
		}
		let className;
		try {
			className = styleCompiler.className(candidate.styleSet ?? {});
		} catch {
			skipped.push({
				name,
				reason: "dynamic",
				start,
				end
			});
			continue;
		}
		magic.overwrite(start, end, JSON.stringify(className));
		applied.push([start, end]);
		folded.push({
			name,
			kind: "class",
			className,
			classNames: className ? [className] : [],
			start,
			end
		});
	}
	for (const split of candidates.length > 0 ? analysis.splitCalls : []) {
		const entry = split.imported ? { config: ctx.recipes.getConfig(split.binding) } : recipeConfigs.get(split.binding);
		if (!entry || entry === AMBIGUOUS || !entry.config) continue;
		const { start, end } = split.span;
		if (collides(start, end)) continue;
		const helper = ensureRecipeHelperImport(SPLIT_PROPS_HELPER, analysis, split.shadowedHelpers, isBambooCssModule, isGeneratedCssModule, helperModules.get(split.binding), helperModuleFromSubpath);
		if (!helper) continue;
		const keys = Object.keys(entry.config.variants ?? {});
		magic.overwrite(start, end, `${helper.name}(${split.argumentText}, ${JSON.stringify(keys)})`);
		applyInsert(helper.insert);
		applied.push([start, end]);
	}
	for (const { name, start, end } of recipeDefinitions) {
		if (collides(start, end)) continue;
		assertCompiles(recipeConfigs.get(name)?.config);
		magic.overwrite(start, end, "undefined");
		applied.push([start, end]);
		folded.push({
			name,
			kind: "definition",
			className: "",
			classNames: [],
			start,
			end
		});
	}
	/**
	* Bindings from a bamboo module still referenced once every rewrite is applied.
	*
	* Deliberately not driven by the call ledger: that is the recogniser, and the point here is
	* to catch what it did not see. A namespace import, a default import, a re-export — each
	* leaves a live reference and no ledger entry at all.
	*/
	function reportRuntimeBindings() {
		const bambooModules = [
			...cssModules,
			...ctx.imports.matchers.recipe?.mods ?? [],
			...ctx.imports.matchers.pattern?.mods ?? [],
			...ctx.imports.matchers.tokens?.mods ?? []
		];
		const declinedRanges = () => skipped.filter((entry) => SURVIVES_TO_RUNTIME.has(entry.reason) && entry.end > entry.start).map((entry) => [entry.start, entry.end]);
		const inside = (ranges, start) => ranges.some(([from, to]) => start >= from && start < to);
		const recipeBindings = /* @__PURE__ */ new Set();
		for (const [name, entry] of recipeConfigs) if (entry !== AMBIGUOUS) recipeBindings.add(name);
		for (const imported of analysis.importedRecipes) recipeBindings.add(imported.local);
		for (const binding of recipeBindings) {
			const references = analysis.references.filter((reference) => reference.name === binding);
			if (references.length === 0) continue;
			const declined = declinedRanges();
			if (references.some((reference) => inside(declined, reference.span.start))) continue;
			const survivor = references.find((reference) => !inside(applied, reference.span.start));
			if (!survivor) continue;
			skipped.push({
				name: binding,
				reason: "runtime-binding",
				start: survivor.span.start,
				end: survivor.span.end
			});
		}
		const shapes = analysis.runtimeShapes.filter((shape) => matchesModule(shape.module, bambooModules));
		const byStart = (a, b) => a.span.start - b.span.start;
		for (const shape of shapes.filter((entry) => entry.kind === "import" || entry.kind === "require").sort(byStart)) skipped.push({
			name: shape.name,
			reason: "runtime-binding",
			start: shape.span.start,
			end: shape.span.end
		});
		for (const shape of shapes.filter((entry) => entry.kind === "import-equals").sort(byStart)) skipped.push({
			name: shape.name,
			reason: "runtime-binding",
			start: shape.span.start,
			end: shape.span.end
		});
		/** Local name -> what to call it in the report. */
		const watched = /* @__PURE__ */ new Map();
		for (const declaration of analysis.imports) {
			if (declaration.typeOnly || !matchesModule(declaration.module, bambooModules)) continue;
			for (const named of declaration.specifiers) {
				if (named.typeOnly || PERMITTED_BINDINGS.has(named.imported)) continue;
				watched.set(named.local, named.imported);
			}
			if (declaration.namespaceLocal) watched.set(declaration.namespaceLocal, `${declaration.namespaceLocal}.*`);
			if (declaration.defaultLocal) watched.set(declaration.defaultLocal, declaration.defaultLocal);
		}
		for (const shape of shapes) {
			if (shape.kind !== "export-star" && shape.kind !== "export-from") continue;
			if (shape.kind === "export-from" && PERMITTED_BINDINGS.has(shape.name)) continue;
			skipped.push({
				name: shape.name,
				reason: "runtime-binding",
				start: shape.span.start,
				end: shape.span.end
			});
		}
		for (const exported of analysis.localExports) {
			const imported = watched.get(exported.local);
			if (imported === void 0) continue;
			skipped.push({
				name: imported,
				reason: "runtime-binding",
				start: exported.span.start,
				end: exported.span.end
			});
		}
		if (watched.size === 0) return;
		const declined = declinedRanges();
		const exportRanges = analysis.localExports.map((exported) => [exported.span.start, exported.span.end]);
		const survivors = [];
		for (const [local, imported] of watched) for (const reference of analysis.references) {
			if (reference.name !== local) continue;
			const { start, end } = reference.span;
			if (inside(applied, start) || inside(declined, start) || inside(exportRanges, start)) continue;
			survivors.push({
				name: imported,
				reason: "runtime-binding",
				start,
				end
			});
			break;
		}
		survivors.sort((a, b) => a.start - b.start);
		skipped.push(...survivors);
	}
	if (reportSurvivors) reportRuntimeBindings();
	if (folded.length === 0) return {
		code,
		map: null,
		folded,
		skipped,
		dependencies: []
	};
	const dependencies = new Set([...analysis.dependencies, ...foreignDependencies]);
	dependencies.delete(options.filePath);
	return {
		code: magic.toString(),
		map: magic.generateMap({
			source: options.filePath,
			hires: true,
			includeContent: true
		}),
		folded,
		skipped,
		dependencies: [...dependencies]
	};
};
/** The local name a module gives an import of `imported` from a Bamboo css module. */
const localNameOf = (analysis, imported, isBambooCssModule) => {
	for (const declaration of analysis.imports) {
		if (declaration.typeOnly || !isBambooCssModule(declaration.module)) continue;
		for (const named of declaration.specifiers) if (!named.typeOnly && named.imported === imported) return named.local;
	}
};
//#endregion
//#region src/style-set.ts
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** A compound selector matches only through variant classes the recipe actually emits. */
const matchesCompound = (compound, selection, variants) => {
	for (const [key, expected] of Object.entries(compound)) {
		if (key === "css") continue;
		const declared = variants?.[key];
		const selected = selection[key];
		if (selected == null || !declared || !Object.hasOwn(declared, String(selected))) return false;
		if (!(Array.isArray(expected) ? expected : [expected]).some((value) => value != null && String(selected) === String(value))) return false;
	}
	return true;
};
/**
* Resolve the style fragments one recipe call contributes, in emitted-rule precedence.
*
* This intentionally rejects conditional variant *selections*. A scalar selects a style
* object; an object such as `{ base: 'sm', md: 'lg' }` selects several objects under
* conditions and needs a separate lowering. Returning `undefined` rejects that call instead
* of silently compiling only one branch.
*/
const createStaticStyleSetCompiler = (ctx, runtimeCss, allocateClassString = (className) => className) => {
	const { mergeCssUncached } = (0, _bamboocss_shared.createMergeCss)(createCssContext(ctx));
	const compose = (...styles) => mergeCssUncached(...styles);
	const resolveRecipe = (config, input = {}, slot) => {
		const slots = Array.isArray(config.slots) ? config.slots : void 0;
		if (Boolean(slots) !== Boolean(slot)) return void 0;
		if (slot && !slots?.includes(slot)) return void 0;
		const selection = {
			...config.defaultVariants ?? {},
			...(0, _bamboocss_shared.compact)(input)
		};
		if (Object.values(selection).some((value) => isRecord(value))) return void 0;
		const fragments = [];
		const take = (candidate) => {
			if (!isRecord(candidate)) return;
			const styles = slot ? candidate[slot] : candidate;
			if (isRecord(styles)) fragments.push(styles);
		};
		take(config.base);
		for (const variant of Object.keys(config.variants ?? {})) {
			const value = selection[variant];
			if (value == null) continue;
			take(config.variants?.[variant]?.[String(value)]);
		}
		for (const compound of config.compoundVariants ?? []) {
			if (!isRecord(compound) || !matchesCompound(compound, selection, config.variants)) continue;
			take(compound.css);
		}
		return compose(...fragments);
	};
	return {
		compose,
		resolveRecipe,
		className: (...styles) => runtimeCss(...styles),
		allocateClassString
	};
};
//#endregion
exports.createRuntimeCss = createRuntimeCss;
exports.createStaticStyleSetCompiler = createStaticStyleSetCompiler;
exports.foldSource = foldSource;
Object.defineProperty(exports, "resolveTsPathPattern", {
	enumerable: true,
	get: function() {
		return _bamboocss_config_ts_path.resolveTsPathPattern;
	}
});
