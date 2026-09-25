const require_chunk = require("./chunk.cjs");
const require_class_name = require("./class-name.cjs");
let node_path = require("node:path");
let _bamboocss_shared = require("@bamboocss/shared");
let node_fs = require("node:fs");
let _ampproject_remapping = require("@ampproject/remapping");
_ampproject_remapping = require_chunk.__toESM(_ampproject_remapping);
let _jridgewell_gen_mapping = require("@jridgewell/gen-mapping");
let magic_string = require("magic-string");
magic_string = require_chunk.__toESM(magic_string);
let postcss = require("postcss");
postcss = require_chunk.__toESM(postcss);
let postcss_selector_parser = require("postcss-selector-parser");
postcss_selector_parser = require_chunk.__toESM(postcss_selector_parser);
//#region src/prune-static-css.ts
/** The generated declaration that identifies a Bamboo stylesheet after minification. */
const SENTINEL = "--made-with-bamboo";
/**
* Remove source-graph atoms no transformed module can emit.
*
* `prunableClasses` contains only atoms extracted from the source graph. Explicit `staticCss`
* additions are absent and survive as a safelist; graph atoms are governed by the transformed
* module reachability set, regardless of whether they originated in `css()` or a recipe.
*/
const pruneStaticCss = (css, session, { environment, prune = true, requiredClasses } = {}) => {
	if (!css.includes(SENTINEL)) return css;
	const root = postcss.default.parse(css);
	const prunable = new Set([...session.prunableClasses].map(require_class_name.bare));
	const used = new Set([...session.usedClasses].map(require_class_name.bare));
	const isUtilityRule = (rule) => {
		let parent = rule.parent;
		while (parent) {
			if (parent.type === "atrule") {
				const atRule = parent;
				if (atRule.name === "layer" && atRule.params === session.utilityLayer) return true;
			}
			parent = parent.parent;
		}
		return false;
	};
	if (prune) root.walkRules((rule) => {
		if (!isUtilityRule(rule)) return;
		let removedAny = false;
		let selector;
		try {
			selector = (0, postcss_selector_parser.default)((selectors) => {
				selectors.each((candidate) => {
					const classes = /* @__PURE__ */ new Set();
					candidate.walkClasses((classNode) => {
						classes.add(require_class_name.bare(classNode.toString().slice(1)));
					});
					if (classes.size !== 1) return;
					const [className] = classes;
					if (!className || !prunable.has(className) || used.has(className)) return;
					candidate.remove();
					removedAny = true;
					session.prunedClasses.add(className);
				});
			}).processSync(rule.selector);
		} catch {
			return;
		}
		if (!removedAny) return;
		if (!selector.trim()) {
			rule.remove();
			return;
		}
		rule.selector = selector;
	});
	let removed = true;
	while (removed) {
		removed = false;
		root.walkAtRules((rule) => {
			if (rule.nodes?.length !== 0) return;
			rule.remove();
			removed = true;
		});
	}
	const present = /* @__PURE__ */ new Set();
	root.walkRules((rule) => {
		if (!isUtilityRule(rule)) return;
		try {
			(0, postcss_selector_parser.default)((selectors) => {
				selectors.walkClasses((classNode) => {
					present.add(require_class_name.bare(classNode.toString().slice(1)));
				});
			}).processSync(rule.selector);
		} catch {}
	});
	const required = requiredClasses ?? new Set([...session.usedClasses].filter((className) => prunable.has(require_class_name.bare(className))));
	const orphaned = [];
	for (const className of required) {
		if (/\s/.test(className)) {
			orphaned.push(className);
			continue;
		}
		if (present.has(require_class_name.bare(className))) continue;
		orphaned.push(className);
	}
	if (orphaned.length) {
		const describe = (className) => {
			if (/\s/.test(className)) return `  ${className}\n      (malformed key: a class name cannot contain whitespace)`;
			const normalized = require_class_name.bare(className);
			const extracted = prunable.has(normalized) ? "in the extracted atoms" : "NOT extracted";
			const near = [...present].filter((candidate) => candidate !== className && candidate.replaceAll("\\", "") === normalized);
			return `  ${className}\n      (${extracted}; no rule in the sheet` + (near.length ? `; a rule exists under ${near.map((n) => JSON.stringify(n)).join(", ")}` : "") + `)`;
		};
		const environmentDescription = environment ? ` for the ${JSON.stringify(environment)} environment` : "";
		const guidance = orphaned.every((className) => prunable.has(require_class_name.bare(className))) ? "Extraction saw every one of these calls, but rule generation produced no declarations for them — the shape of a value nothing resolves, such as a `mixin` naming a composition the theme does not define. Check the class name's property and value against the theme, and look for a `🎋 warn [utility]` line above naming the same value. Set `unresolvedToken: 'error'` to fail fast at the exact call next time." : "The current source generation no longer provides every rule required by the JavaScript outputs still on disk. Bamboo refused to replace the prior stylesheet. Finish rebuilding every output which retains an older generation, then rebuild the stylesheet. If every output is already current, report this as a compiler bug with the block above.";
		throw new Error(`bamboocss: ${orphaned.length} compiled class(es) still named by live output have no rule in the candidate stylesheet${environmentDescription}. Elements carrying them would render unstyled.\n\n${(0, _bamboocss_shared.truncateList)(orphaned.map(describe), {
			unit: "class",
			separator: "\n"
		})}\n\n` + guidance);
	}
	return root.toString();
};
//#endregion
//#region src/css-output-module.ts
const INLINE_SOURCE_MAP = /\n?\/\/# sourceMappingURL=data:application\/json[^\n]*$/;
/** Rewrite one generated chunk without invalidating all mappings after the changed string. */
const replaceChunkReference = (chunk, bundle, previous, next, sourcemap) => {
	if (!chunk.code.includes(previous)) return;
	const magic = new magic_string.default(chunk.code);
	let index = chunk.code.indexOf(previous);
	while (index !== -1) {
		magic.overwrite(index, index + previous.length, next);
		index = chunk.code.indexOf(previous, index + previous.length);
	}
	chunk.code = magic.toString();
	if (!chunk.map) return;
	const file = chunk.map.file;
	const debugId = chunk.map.debugId;
	const combined = (0, _ampproject_remapping.default)([magic.generateMap({
		source: chunk.fileName,
		hires: "boundary"
	}), chunk.map], () => null);
	if (file) combined.file = file;
	if (debugId) combined.debugId = debugId;
	const rollupMap = combined;
	rollupMap.toUrl = () => `data:application/json;charset=utf-8;base64,${Buffer.from(combined.toString()).toString("base64")}`;
	chunk.map = rollupMap;
	if (sourcemap === "inline") {
		chunk.code = chunk.code.replace(INLINE_SOURCE_MAP, "");
		chunk.code += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(combined.toString()).toString("base64")}`;
		return;
	}
	const mapAsset = bundle[`${chunk.fileName}.map`];
	if (mapAsset?.type === "asset") mapAsset.source = combined.toString();
};
/** Replace an emitted filename wherever Vite or Rollup has already recorded it. */
const replaceAssetReferences = (bundle, previous, next, sourcemap) => {
	const replace = (value) => value.replaceAll(previous, next);
	for (const output of Object.values(bundle)) {
		if (output.type === "asset") {
			if (typeof output.source === "string") output.source = replace(output.source);
			continue;
		}
		replaceChunkReference(output, bundle, previous, next, sourcemap);
		const referencedFiles = output.referencedFiles;
		if (referencedFiles) output.referencedFiles = referencedFiles.map(replace);
		const importedCss = output.viteMetadata?.importedCss;
		if (importedCss?.delete(previous)) importedCss.add(next);
	}
};
/**
* Could this bundle entry be the generated stylesheet?
*
* The filename is checked before the bytes because the alternative decodes every asset in the
* bundle to a UTF-8 string in order to search it — fonts, images and sourcemaps included. On an
* app with a large asset graph that is seconds of decode and a lot of garbage, twice over, to
* answer a question the extension already answers. The marker is a CSS custom property, so it
* cannot occur anywhere but CSS.
*/
const isCssAsset = (output) => output.type === "asset" && output.fileName.endsWith(".css");
/** Decode a generated Bamboo stylesheet, or decline any other bundle entry. */
const generatedCssSource = (output) => {
	if (!isCssAsset(output)) return void 0;
	const source = typeof output.source === "string" ? output.source : Buffer.from(output.source).toString();
	return source.includes("--made-with-bamboo") ? source : void 0;
};
/**
* Whether this bundle replaces a previously generated Bamboo stylesheet — or, given the set of
* assets a pass already handled, whether any generated sheet is still waiting for one.
*/
const containsGeneratedCssAsset = (bundle, handled, handledNames) => Object.values(bundle).some((output) => generatedCssSource(output) !== void 0 && !handled?.has(output) && !handledNames?.has(output.fileName));
const optimizeStaticCssAssets = (bundle, session, options = {}) => {
	const { environment, prune = true, requiredClasses, sourcemap = session.sourcemap, handled, handledNames, split } = options;
	/** Assets in this bundle that carry the generated stylesheet, pruned or not. */
	let sheets = 0;
	/** Their file names, after any rename below. */
	const names = [];
	const results = [];
	for (const output of Object.values(bundle)) {
		const source = generatedCssSource(output);
		if (source === void 0) continue;
		if (handled?.has(output) || handledNames?.has(output.fileName)) continue;
		handled?.add(output);
		handledNames?.add(output.fileName);
		sheets++;
		names.push(output.fileName);
		const original = output.fileName;
		const pruned = pruneStaticCss(source, session, {
			environment,
			prune,
			requiredClasses
		});
		if (!prune) {
			results.push({
				original,
				fileName: original,
				source,
				optimized: source,
				asset: output,
				moved: /* @__PURE__ */ new Set()
			});
			continue;
		}
		let optimized = pruned;
		let moved = /* @__PURE__ */ new Set();
		if (split?.ownership.size) {
			const divided = splitStaticCss(pruned, session, split.ownership, split.coOccurrences);
			optimized = divided.css;
			moved = divided.moved;
			for (const [chunk, css] of divided.chunks) split.emit(chunk, css);
		}
		output.source = optimized;
		if (optimized === source) {
			results.push({
				original,
				fileName: original,
				source,
				optimized,
				asset: output,
				moved
			});
			continue;
		}
		names.pop();
		const nextName = output.fileName.replace(/\.css$/, `.b-${(0, _bamboocss_shared.toHash)(optimized)}.css`);
		if (bundle[nextName] && bundle[nextName] !== output) throw new Error(`bamboocss: final CSS asset name collision at ${JSON.stringify(nextName)}.`);
		const previous = output.fileName;
		output.fileName = nextName;
		names.push(nextName);
		handledNames?.add(nextName);
		results.push({
			original,
			fileName: nextName,
			source,
			optimized,
			asset: output,
			moved
		});
		replaceAssetReferences(bundle, previous, nextName, sourcemap);
		if (!session.refusesBundleKeys) try {
			bundle[nextName] = output;
			if (bundle[nextName] === output && nextName !== previous) delete bundle[previous];
		} catch {}
	}
	return {
		sheets,
		names,
		results
	};
};
/** Text outputs a stylesheet's name can appear in. Fonts and images are skipped unread. */
const REFERENCING_EXTENSIONS = /\.(?:[cm]?js|html?|css|json|txt|map|webmanifest|svg|xml)$/i;
const CHUNK_EXTENSIONS = /\.[cm]?js$/i;
/**
* Rewrite one written file the way `replaceChunkReference` rewrites a chunk in memory.
*
* A chunk with a sourcemap — a sibling `.map`, or one inlined — has its mappings carried
* across the edit: the replacement changes the length of a line, and every mapping after it
* on that line would otherwise be off by the difference.
*/
const replaceFileReference = (path, previous, next) => {
	const code = (0, node_fs.readFileSync)(path, "utf8");
	if (!code.includes(previous)) return false;
	if (!CHUNK_EXTENSIONS.test(path)) {
		(0, node_fs.writeFileSync)(path, code.replaceAll(previous, next));
		return true;
	}
	const magic = new magic_string.default(code);
	let index = code.indexOf(previous);
	while (index !== -1) {
		magic.overwrite(index, index + previous.length, next);
		index = code.indexOf(previous, index + previous.length);
	}
	let rewritten = magic.toString();
	const inlineMap = code.match(INLINE_SOURCE_MAP)?.[0];
	const mapPath = `${path}.map`;
	const rawMap = inlineMap ? JSON.parse(Buffer.from(inlineMap.slice(inlineMap.indexOf("base64,") + 7), "base64").toString()) : (0, node_fs.existsSync)(mapPath) ? JSON.parse((0, node_fs.readFileSync)(mapPath, "utf8")) : void 0;
	if (rawMap) {
		const combined = (0, _ampproject_remapping.default)([magic.generateMap({
			source: (0, node_path.basename)(path),
			hires: "boundary"
		}), rawMap], () => null);
		if (rawMap.file) combined.file = rawMap.file;
		if (rawMap.debugId) combined.debugId = rawMap.debugId;
		if (inlineMap) rewritten = rewritten.replace(INLINE_SOURCE_MAP, "") + `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(combined.toString()).toString("base64")}`;
		else (0, node_fs.writeFileSync)(mapPath, combined.toString());
	}
	(0, node_fs.writeFileSync)(path, rewritten);
	return true;
};
/**
* Prune every deferred sheet against the whole run's reachability, on disk.
*
* From the *unpruned* source, not from the file: the file was pruned against a partial run and
* may lack a rule a later environment reaches, and pruning cannot put a rule back. When the
* final bytes are the provisional bytes — the common case, since a later environment usually
* reaches nothing new — nothing on disk moves and every recorded name stays right. When they
* differ, the same contract as `optimizeStaticCssAssets` applies: the bytes and the name move
* together, every written reference moves with them across environments, and a copy of the
* provisional sheet a framework wrote into another output is replaced the same way.
*/
const finalizeDeferredSheets = (sheets, session, options) => {
	const { requiredClasses, prune = true, outputs, bundle, sourcemap = session.sourcemap } = options;
	const finalized = [];
	for (const sheet of sheets) {
		if (!(0, node_fs.existsSync)((0, node_path.join)(sheet.dir, sheet.fileName))) continue;
		let final = pruneStaticCss(sheet.source, session, {
			prune,
			requiredClasses
		});
		if (sheet.moved?.size) final = splitStaticCss(final, session, new Map([...sheet.moved].map((className) => [className, ""]))).css;
		if (!prune || final === sheet.provisional) {
			finalized.push({
				...sheet,
				before: sheet.provisional.length,
				after: sheet.provisional.length
			});
			continue;
		}
		const nextName = sheet.originalFileName.replace(/\.css$/, `.b-${(0, _bamboocss_shared.toHash)(final)}.css`);
		const directories = new Set([sheet.dir]);
		for (const output of outputs) directories.add(output.dir);
		for (const dir of directories) {
			const copy = (0, node_path.join)(dir, sheet.fileName);
			if (!(0, node_fs.existsSync)(copy)) continue;
			if (dir !== sheet.dir && (0, node_fs.readFileSync)(copy, "utf8") !== sheet.provisional) continue;
			(0, node_fs.writeFileSync)((0, node_path.join)(dir, nextName), final);
			(0, node_fs.rmSync)(copy, { force: true });
		}
		const seen = /* @__PURE__ */ new Set();
		for (const output of outputs) for (const file of output.files) {
			if (!REFERENCING_EXTENSIONS.test(file)) continue;
			const target = (0, node_path.join)(output.dir, file);
			if (seen.has(target) || file === sheet.fileName) continue;
			seen.add(target);
			if (!(0, node_fs.existsSync)(target)) continue;
			replaceFileReference(target, sheet.fileName, nextName);
		}
		if (sheet.asset) {
			sheet.asset.source = final;
			sheet.asset.fileName = nextName;
			if (sheet.bundle) {
				try {
					sheet.bundle[nextName] = sheet.asset;
					if (sheet.bundle[nextName] === sheet.asset) delete sheet.bundle[sheet.fileName];
				} catch {}
				replaceAssetReferences(sheet.bundle, sheet.fileName, nextName, sheet.sourcemap);
			}
		}
		if (bundle) replaceAssetReferences(bundle, sheet.fileName, nextName, sourcemap);
		finalized.push({
			...sheet,
			renamed: nextName,
			before: sheet.provisional.length,
			after: final.length
		});
	}
	return finalized;
};
/**
* Which atoms must not leave the entry sheet, because moving them would change a winner.
*
* Sublayers carry precedence *between* different specificity/condition/priority groups, but
* two atoms that agree on all of those share a sublayer, and within one sublayer the winner is
* still decided by source order — `cx(css({color}), css({color}))` is exactly that shape. The
* entry sheet and a chunk sheet have no defined order relative to each other, so moving one
* member of such a pair makes the winner depend on which file the browser parses first, which
* varies with caching and preload.
*
* So a class is held back when some element carries it together with another class in the same
* sublayer and the two would not travel to the same sheet. Everything else still splits: atoms
* that never co-occur, and co-occurring atoms whose sublayers already order them.
*/
const unsafeToMove = (bySublayer, ownership, coOccurrences) => {
	const held = /* @__PURE__ */ new Set();
	const destinationOf = (className) => ownership.get(className) ?? "";
	for (const [className, neighbours] of coOccurrences) {
		const sublayer = bySublayer.get(className);
		if (sublayer === void 0) continue;
		for (const neighbour of neighbours) {
			if (neighbour === className) continue;
			if (bySublayer.get(neighbour) !== sublayer) continue;
			if (destinationOf(className) === destinationOf(neighbour)) continue;
			held.add(className);
			held.add(neighbour);
		}
	}
	return held;
};
/** The at-rules a rule sits under, outermost first, as name and params. */
const ancestryOf = (rule) => {
	const chain = [];
	let parent = rule.parent;
	while (parent && parent.type !== "root") {
		if (parent.type === "atrule") {
			const atRule = parent;
			chain.unshift({
				name: atRule.name,
				params: atRule.params
			});
		}
		parent = parent.parent;
	}
	return chain;
};
/** The container in `root` under the same at-rule chain, created where absent. */
const containerFor = (root, chain) => {
	let container = root;
	for (const { name, params } of chain) {
		let next = container.nodes?.find((node) => node.type === "atrule" && node.name === name && node.params === params);
		if (!next) {
			next = postcss.default.atRule({
				name,
				params,
				nodes: []
			});
			container.append(next);
		}
		container = next;
	}
	return container;
};
/**
* Move every utility rule a lazily loaded chunk owns into a sheet of that chunk's own.
*
* Reads the finished entry sheet — pruned, sublayered, minified or not — and walks its
* utility rules. A selector naming exactly one class that `ownership` assigns to a chunk is
* moved to that chunk's sheet under the same at-rule chain: the utilities layer, its sublayer,
* any media or container query. A rule with several selectors is split per selector, since a
* merged rule's members can belong to different chunks. Whatever nothing owns stays.
*
* Each chunk sheet opens with the entry's sublayer order statement, so whichever sheet the
* document happens to parse first establishes the same order. That is what makes the split
* safe at all: precedence lives in the sublayers, not in where a rule sits.
*/
const splitStaticCss = (css, session, ownership, coOccurrences) => {
	const chunks = /* @__PURE__ */ new Map();
	const moved = /* @__PURE__ */ new Set();
	if (!ownership.size || !css.includes("--made-with-bamboo")) return {
		css,
		chunks,
		moved
	};
	const root = postcss.default.parse(css);
	const roots = /* @__PURE__ */ new Map();
	const rootFor = (chunk) => {
		let chunkRoot = roots.get(chunk);
		if (!chunkRoot) {
			chunkRoot = postcss.default.root();
			roots.set(chunk, chunkRoot);
		}
		return chunkRoot;
	};
	const isUtilityRule = (rule) => {
		let parent = rule.parent;
		while (parent) {
			if (parent.type === "atrule") {
				const atRule = parent;
				if (atRule.name === "layer" && atRule.params === session.utilityLayer) return true;
			}
			parent = parent.parent;
		}
		return false;
	};
	let order;
	root.walkAtRules("layer", (atRule) => {
		if (order || atRule.nodes) return;
		const parent = atRule.parent;
		if (parent?.type === "atrule" && parent.params === session.utilityLayer) order = atRule;
	});
	/** The sublayer each single-class utility selector was written into. */
	const sublayerOf = (rule) => {
		let parent = rule.parent;
		while (parent) {
			if (parent.type === "atrule") {
				const atRule = parent;
				if (atRule.name === "layer") {
					const grandparent = atRule.parent;
					if (grandparent?.type === "atrule" && grandparent.params === session.utilityLayer) return atRule.params;
				}
			}
			parent = parent.parent;
		}
	};
	const soleClassOf = (selector) => {
		let only;
		try {
			(0, postcss_selector_parser.default)((selectors) => {
				const classes = /* @__PURE__ */ new Set();
				selectors.walkClasses((classNode) => {
					classes.add(require_class_name.bare(classNode.toString().slice(1)));
				});
				if (classes.size === 1) only = [...classes][0];
			}).processSync(selector);
		} catch {}
		return only;
	};
	const held = /* @__PURE__ */ new Set();
	if (coOccurrences?.size) {
		const bySublayer = /* @__PURE__ */ new Map();
		root.walkRules((rule) => {
			if (!isUtilityRule(rule)) return;
			const sublayer = sublayerOf(rule);
			if (sublayer === void 0) return;
			for (const selector of rule.selectors) {
				const className = soleClassOf(selector);
				if (className !== void 0) bySublayer.set(className, sublayer);
			}
		});
		for (const className of unsafeToMove(bySublayer, ownership, coOccurrences)) held.add(className);
	}
	root.walkRules((rule) => {
		if (!isUtilityRule(rule)) return;
		const kept = [];
		const taken = /* @__PURE__ */ new Map();
		for (const selector of rule.selectors) {
			let owner;
			const className = soleClassOf(selector);
			if (className !== void 0 && !held.has(className)) {
				owner = ownership.get(className);
				if (owner !== void 0) moved.add(className);
			}
			if (owner === void 0) kept.push(selector);
			else (taken.get(owner) ?? taken.set(owner, []).get(owner)).push(selector);
		}
		if (!taken.size) return;
		const chain = ancestryOf(rule);
		for (const [chunk, selectors] of taken) containerFor(rootFor(chunk), chain).append(rule.clone({ selectors }));
		if (kept.length) rule.selectors = kept;
		else rule.remove();
	});
	let removed = true;
	while (removed) {
		removed = false;
		root.walkAtRules((atRule) => {
			if (atRule.nodes?.length !== 0) return;
			atRule.remove();
			removed = true;
		});
	}
	for (const [chunk, chunkRoot] of roots) {
		if (order) chunkRoot.nodes.find((node) => node.type === "atrule" && node.name === "layer" && node.params === session.utilityLayer)?.prepend(order.clone());
		chunks.set(chunk, chunkRoot.toString());
	}
	return {
		css: root.toString(),
		chunks,
		moved
	};
};
/** A class token of a selector, escapes and all: `.hover\\:c_red600` up to its unescaped `:`. */
const CLASS_TOKEN = /\.((?:\\.|[^\\\s.:>+~[\](),])+)/g;
/**
* The top-level comma-separated parts of a selector list as written, each with its offset.
*
* `rule.selectors` splits the same way but loses where each part sits, and a merged rule's
* selectors sit on separate lines in the unminified sheet a dev server serves.
*/
const selectorParts = (raw) => {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < raw.length; index++) {
		const char = raw[index];
		if (char === "\\") index++;
		else if (char === "(" || char === "[") depth++;
		else if (char === ")" || char === "]") depth--;
		else if (char === "," && depth === 0) {
			parts.push({
				text: raw.slice(start, index),
				offset: start
			});
			start = index + 1;
		}
	}
	parts.push({
		text: raw.slice(start),
		offset: start
	});
	return parts.map((part) => {
		const leading = part.text.length - part.text.trimStart().length;
		return {
			text: part.text.trim(),
			offset: part.offset + leading
		};
	});
};
/** `start` advanced over `text` up to `offset`, in 1-based lines and columns. */
const positionAt = (text, offset, start) => {
	let { line, column } = start;
	for (let index = 0; index < offset; index++) if (text[index] === "\n") {
		line++;
		column = 1;
	} else column++;
	return {
		line,
		column
	};
};
/**
* A source map from each rule of the served stylesheet to the call site its atom was first
* encoded at, for DevTools to name the file and line a rule came from.
*
* Read off the finished sheet rather than threaded through its generation: rules enter the
* postcss tree as strings, which strips their positions, and the optimizer re-parses the text
* twice more. One parse here costs the same as one of those and needs no cooperation from
* either. A rule maps at its selector, and a merged rule maps each of its selectors, since
* the optimizer folds rules from different call sites into one. `sourcesContent` is left for
* Vite to fill from disk, which it does for a dev stylesheet's map before inlining it.
*/
const cssSourceMap = (css, origins) => {
	const byBareClass = /* @__PURE__ */ new Map();
	for (const [className, origin] of origins) {
		const name = require_class_name.bare(className);
		if (!byBareClass.has(name)) byBareClass.set(name, origin);
	}
	if (!byBareClass.size) return void 0;
	const originOf = (selector) => {
		for (const match of selector.matchAll(CLASS_TOKEN)) {
			const origin = byBareClass.get(require_class_name.bare(match[1]));
			if (origin) return origin;
		}
	};
	const map = new _jridgewell_gen_mapping.GenMapping();
	let mapped = 0;
	postcss.default.parse(css).walkRules((rule) => {
		const start = rule.source?.start;
		if (!start) return;
		const raw = rule.raws.selector?.raw ?? rule.selector;
		for (const part of selectorParts(raw)) {
			const origin = originOf(part.text);
			if (!origin) continue;
			const generated = positionAt(raw, part.offset, start);
			(0, _jridgewell_gen_mapping.addMapping)(map, {
				generated: {
					line: generated.line,
					column: generated.column - 1
				},
				source: origin.filePath,
				original: {
					line: origin.line,
					column: origin.column - 1
				}
			});
			mapped++;
		}
	});
	if (!mapped) return void 0;
	const encoded = (0, _jridgewell_gen_mapping.toEncodedMap)(map);
	return {
		version: 3,
		mappings: encoded.mappings,
		names: [...encoded.names],
		sources: encoded.sources.map((source) => source ?? "")
	};
};
//#endregion
exports.containsGeneratedCssAsset = containsGeneratedCssAsset;
exports.cssSourceMap = cssSourceMap;
exports.finalizeDeferredSheets = finalizeDeferredSheets;
exports.optimizeStaticCssAssets = optimizeStaticCssAssets;
exports.pruneStaticCss = pruneStaticCss;
exports.splitStaticCss = splitStaticCss;
