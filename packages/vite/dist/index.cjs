Object.defineProperties(exports, {
	__esModule: { value: true },
	[Symbol.toStringTag]: { value: "Module" }
});
require("./chunk.cjs");
const require_class_name = require("./class-name.cjs");
let node_path = require("node:path");
let _bamboocss_logger = require("@bamboocss/logger");
let _bamboocss_shared = require("@bamboocss/shared");
let node_crypto = require("node:crypto");
let node_fs = require("node:fs");
let _bamboocss_node_static_compiler = require("@bamboocss/node/static-compiler");
//#region src/lazy-modules.ts
/**
* Keep one asynchronous initialization in flight, retain its fulfilled value, and forget only
* a rejected attempt so a later Vite rebuild can recover.
*
* Starting through a resolved promise also turns a synchronous loader throw into the same
* rejected-promise contract as a failed dynamic import.
*/
const createRetryableLazy = (load) => {
	let pending;
	return () => {
		if (pending) return pending;
		const attempt = Promise.resolve().then(load);
		pending = attempt;
		attempt.catch(() => {
			if (pending === attempt) pending = void 0;
		});
		return attempt;
	};
};
/** Process-wide module loading; individual plugin instances still own their mutable state. */
const loadNodeModule = createRetryableLazy(() => Promise.resolve().then(() => require("./node-module.cjs")));
const loadConfigModule = createRetryableLazy(() => Promise.resolve().then(() => require("./config-module.cjs")));
/**
* Keep stylesheet parsing, selector inventory and late sourcemap rewriting behind one built
* chunk. The injectable loader proves sharing and retry without exposing a package subpath.
*/
const createLazyCssOutputModule = (loadCssOutput = () => Promise.resolve().then(() => require("./css-output-module.cjs"))) => createRetryableLazy(loadCssOutput);
/** One process-wide CSS-output load shared by every plugin instance and Vite environment. */
const loadCssOutputModule = createLazyCssOutputModule();
/**
* Keep the AST fold behind its own built chunk. The injectable loader is an architectural
* seam: callers can prove sharing and retry without a production-only switch, while the
* default remains a statically discoverable dynamic import for both published formats.
*/
const createLazyFoldModule = (loadFold = () => Promise.resolve().then(() => require("./fold-module.cjs"))) => createRetryableLazy(loadFold);
/** One process-wide fold-module load shared by every plugin instance and Vite environment. */
const loadFoldModule = createLazyFoldModule();
/**
* The one Builder a run compiles against, created only when a hook first needs it.
*
* Per host rather than per plugin instance: the compiler and the stylesheet share it now.
* @see `createCompilationHost`
*/
const createLazyBuilder = (loadNode = loadNodeModule) => createRetryableLazy(async () => {
	const { Builder } = await loadNode();
	return new Builder();
});
//#endregion
//#region src/compilation-host.ts
const createCompilationHost = (options = {}) => {
	const { configPath, cwd } = options;
	const loadBuilder = options.loadBuilder ?? createLazyBuilder();
	let command = "build";
	let devSourcemap = false;
	let builder;
	let generation;
	let nextGenerationId = 0;
	/**
	* The setup covering the pass currently open.
	*
	* A cold start reaches this twice — the compiler's `pre` `buildStart`, then the CSS
	* plugin's — for one instant in which nothing can have changed on disk. Sharing one attempt
	* across both is what keeps a project from loading and evaluating its config twice per
	* build. Cleared once a stylesheet pass consumes it, and on any source mutation, so no
	* later pass can be answered by a setup taken before an edit.
	*/
	let openSetup;
	let openSetupStale = false;
	let cssPass;
	let changedSourceFiles = /* @__PURE__ */ new Set();
	let needsInventoryScan = false;
	let needsConfigReload = false;
	const recordSourceChange = (filePath, event, options) => {
		changedSourceFiles.add(filePath);
		if (event !== "update") needsInventoryScan = true;
		needsConfigReload ||= options?.needsConfigReload === true;
		openSetupStale = true;
	};
	const takeSourceChanges = () => {
		const changes = {
			files: [...changedSourceFiles].sort(),
			needsInventoryScan,
			...needsConfigReload ? { needsConfigReload: true } : {}
		};
		changedSourceFiles = /* @__PURE__ */ new Set();
		needsInventoryScan = false;
		needsConfigReload = false;
		return changes;
	};
	const restoreSourceChanges = (changes) => {
		for (const file of changes.files) changedSourceFiles.add(file);
		needsInventoryScan ||= changes.needsInventoryScan === true;
		needsConfigReload ||= changes.needsConfigReload === true;
	};
	const settled = async (attempt) => {
		try {
			await attempt;
		} catch {}
	};
	const publish = () => {
		const context = builder.getContextOrThrow();
		if (generation?.context !== context) generation = {
			id: ++nextGenerationId,
			context,
			encoder: context.encoder.clone()
		};
		return generation;
	};
	const runSetup = async () => {
		builder ??= await loadBuilder();
		const sourceChanges = takeSourceChanges();
		try {
			await builder.setup({
				configPath,
				cwd,
				dev: command === "serve",
				atomOrigins: command === "serve" && devSourcemap,
				...command === "serve" ? { sourceChanges } : {}
			});
			return publish();
		} catch (error) {
			if (command === "serve") restoreSourceChanges(sourceChanges);
			throw error;
		}
	};
	/**
	* The setup covering the pass currently open, started at most once.
	*
	* Started through a resolved promise, so a synchronous throw becomes the same
	* rejected-attempt contract a failed module load has and a later hook can retry it. A
	* source mutation observed while one is in flight does not cancel it — two overlapping
	* `Builder.setup` calls would interleave their change detection — it queues a fresh one
	* behind it.
	*/
	const setupOnce = () => {
		const previous = openSetup;
		if (previous && !openSetupStale) return previous;
		openSetupStale = false;
		const attempt = previous ? settled(previous).then(runSetup) : Promise.resolve().then(runSetup);
		openSetup = attempt;
		attempt.catch(() => {
			if (openSetup === attempt) openSetup = void 0;
		});
		return attempt;
	};
	return {
		setCommand(next) {
			command = next;
		},
		setDevSourcemap(enabled) {
			devSourcemap = enabled;
		},
		isSourceFile(filePath) {
			return builder?.context ? builder.isPotentialSourceFile(filePath) : true;
		},
		current: () => generation,
		async ensureGeneration() {
			if (cssPass) await settled(cssPass);
			if (generation) return Promise.resolve(generation);
			return setupOnce();
		},
		isCssPassActive: () => cssPass !== void 0,
		async runCssPass(run) {
			while (cssPass) await settled(cssPass);
			let release;
			cssPass = new Promise((resolve) => {
				release = resolve;
			});
			try {
				const passGeneration = await setupOnce();
				return await run(builder, passGeneration);
			} finally {
				openSetup = void 0;
				openSetupStale = false;
				cssPass = void 0;
				release();
			}
		},
		async runCompilerWork(run) {
			while (cssPass) await settled(cssPass);
			return run();
		},
		noteSourceChange(filePath, event, options) {
			if (command === "serve") recordSourceChange(filePath, event, options);
		},
		reloadSource(filePath) {
			recordSourceChange(filePath, "update");
			builder?.reloadSource(filePath);
		},
		removeSource(filePath) {
			recordSourceChange(filePath, "update");
			builder?.removeSource(filePath);
		}
	};
};
//#endregion
//#region src/static-session.ts
/** Store one semantic class token in the selector spelling used by reachability sets. */
const selectorClassName = (token) => token.includes("\\") ? token : (0, _bamboocss_shared.esc)(token);
const createStaticCompilationSession = () => {
	const session = {
		utilityLayer: "utilities",
		sourcemap: false,
		cssLoaded: false,
		transformedFiles: /* @__PURE__ */ new Set(),
		extractedFiles: /* @__PURE__ */ new Set(),
		prunableClasses: /* @__PURE__ */ new Set(),
		viewTransitionClasses: /* @__PURE__ */ new Set(),
		usedClasses: /* @__PURE__ */ new Set(),
		expectedEnvironments: void 0,
		participatingEnvironments: /* @__PURE__ */ new Set(),
		completedEnvironments: /* @__PURE__ */ new Set(),
		prunedClasses: /* @__PURE__ */ new Set(),
		deferredSheets: [],
		writtenOutputs: [],
		prunedAssets: /* @__PURE__ */ new WeakSet(),
		prunedSheetNames: /* @__PURE__ */ new WeakMap(),
		splitCss: true,
		beginOutputProjection(_environment, _outputOptions, _bundle, replacesGeneratedStylesheet) {
			if (replacesGeneratedStylesheet) session.prunedClasses.clear();
			const prunable = new Set([...session.prunableClasses].map((className) => className.replaceAll("\\", "")));
			const requiredClasses = new Set([...session.usedClasses].filter((className) => prunable.has(className.replaceAll("\\", ""))));
			return {
				cssLoaded: session.cssLoaded,
				requiredClasses,
				restore() {}
			};
		},
		markClassUsed(className) {
			for (const token of className.split(" ")) {
				if (!token) continue;
				session.usedClasses.add(selectorClassName(token));
			}
		}
	};
	return session;
};
/**
* Expected or observed environments whose current generation has not completed yet.
*
* Empty means everything the run will contribute has been contributed, which is the condition
* every whole-run judgement here waits for: pruning the stylesheet against reachability, and
* the two guards that ask whether the compiled modules and the extraction graph agree. Each of
* those is false about a build in progress and true only about a finished one.
*
* The environment currently at `buildEnd` may be supplied as the candidate completing this
* call. That keeps publication transactional: whole-run checks can include its finished graph
* without marking it complete before those checks themselves succeed.
*
* Empty is also the answer for a single-environment build, where the only participant is the
* completing candidate — so that path is unchanged.
*
* An environment a run declares and then never builds leaves this permanently non-empty, and
* those judgements are skipped for the run. Every one of them errs towards shipping more CSS
* or asserting less, so that is the safe direction to be wrong in.
*/
const remainingEnvironments = (session, completingEnvironment) => {
	const participating = new Set(session.expectedEnvironments ?? []);
	for (const environment of session.participatingEnvironments) participating.add(environment);
	return [...participating].filter((name) => name !== completingEnvironment && !session.completedEnvironments.has(name));
};
//#endregion
//#region src/css.ts
/**
* What a project imports to get the stylesheet.
*
* Spelled with a `.css` extension because that is how vite decides what a module is: the
* id is all it has for a module with no file behind it, so `virtual:bamboo` would be
* bundled as javascript and injected as a script.
*/
const VIRTUAL_CSS_ID = "virtual:bamboo.css";
/**
* Rollup's convention for a module with no file: a leading NUL tells every other plugin
* not to try reading it off disk.
*/
const RESOLVED_ID = `\0${VIRTUAL_CSS_ID}`;
/**
* The queries Vite appends to a CSS module — `?url`, `?raw`, `?inline`, and the
* `?transform-only` that its own `?url` handling rewrites to.
*
* None of them resolved here, so asking the stylesheet for its URL failed as an unresolvable
* path. Rather than answering each one, the query is carried onto the resolved id and the CSS
* is served for whatever it is: Vite's CSS pipeline already knows what each means, and
* answering them here would be a second, worse copy of it.
*
* `?url` in particular makes the sheet an asset of its own rather than part of whatever
* stylesheet the importer belongs to. That is what `?url` means rather than a shortcoming, but
* it is not what a project concatenating Bamboo's CSS into one global stylesheet wants.
*/
const queryOf = (id) => {
	const at = id.indexOf("?");
	return at === -1 ? "" : id.slice(at);
};
/** `?url`, tested the way Vite's asset plugin tests it — the plugin a dev server leaves it to. */
const URL_QUERY = /(?:\?|&)url(?:&|$)/;
/** Whether some chunk of the bundle bundled the stylesheet module itself. */
const bundleHoldsStylesheetModule = (bundle) => Object.values(bundle).some((output) => output.type === "chunk" && Object.keys(output.modules ?? {}).some((id) => id === RESOLVED_ID));
/**
* Where a dev server serves the stylesheet, spelled the way Vite writes the URL of any module with
* no file behind it: `/@id/`, then the resolved id with its NUL as `__x00__`, behind the server's
* `origin` and base.
*
* The base is taken decoded, so `encodeURI` applies its escapes exactly once, as Vite does for an
* asset's URL. Vite 6 and up carry it as `decodedBase`, which is missing from the published types,
* hence the cast; Vite 5 has only `base`, decoded here instead.
*/
const devStylesheetUrl = (config) => {
	const join = (a, b) => a && b ? `${a.replace(/\/$/, "")}/${b.replace(/^\//, "")}` : a || b;
	const base = config?.decodedBase ?? decodeURI(config?.base ?? "/");
	return encodeURI(join(join(config?.server.origin ?? "", base), `@id/__x00__${VIRTUAL_CSS_ID}`));
};
/**
* Whether the bundler behind this run refuses new keys on the output bundle.
*
* Rolldown does, and logs a warning naming this plugin when one is attempted — see
* `StaticCompilationSession.refusesBundleKeys`.
*
* Read off the *resolved config*, which is the only place that answers for the run actually
* happening. Importing `vite` from this module and testing its `rolldownVersion` looks like
* the same question and is not: this package declares `vite` as a peer, so in a pnpm project
* the import resolves to Bamboo's own devDependency — Vite 7, rollup — while the user builds
* with Vite 8 and rolldown. That version answered "rollup", the assignment went ahead, and the
* warning this exists to remove was still printed on every build. `build.rolldownOptions` is
* present only on a rolldown build and belongs to the config the user's Vite handed us.
*
* Synchronous on purpose. `configResolved` is not a place to introduce a yield: two test files
* sharing one sandbox race on temporary sources, and an `await` here widened that window
* enough to fail a registration assertion.
*/
const bundlerRefusesBundleKeys = (config) => config.build !== void 0 && "rolldownOptions" in config.build;
/**
* A thrown value Vite can actually report.
*
* `catch` binds `unknown`, and anything under compilation — a dependency, a config hook, a
* bare `throw 'string'` — may throw a primitive. Vite's dev error middleware puts what it is
* handed into a `WeakSet` to deduplicate it, which throws `TypeError: Invalid value used in
* weak set` for anything that is not an object, and the real failure is lost behind that.
*
* Shared by every hook that can throw while the dev server is serving, so the two cannot
* drift: a request for the stylesheet reaches `load`, and a request for a module reaches
* `transform`, and both are answered by the same middleware.
*/
const asError = (error, context) => error instanceof Error ? error : new Error(`bamboocss: ${context}: ${String(error)}`, { cause: error });
/**
* Which lazily loaded chunk each atom exclusive to one belongs to.
*
* An atom belongs to a chunk when every module that emits it is in that chunk, and the chunk
* is not loaded with an entry anyway — an entry, or anything an entry statically imports,
* would put the atom in the entry sheet's own company either way. An atom two chunks share,
* or one no compiled module emits — `staticCss` — has no owner and stays where every route
* finds it. Loading with an entry is the static import closure of every entry, which is what
* the browser fetches before the first render.
*/
const chunkOwnership = (bundle, environment, session) => {
	const classNamesOf = session.classNamesOf;
	const ownership = /* @__PURE__ */ new Map();
	/**
	* Which atoms were emitted onto one element together.
	*
	* Collected on the same walk that decides ownership, from the same class strings, because
	* the split has to know which pairs can compete before it may move either of them. Only
	* strings naming more than one class say anything.
	*/
	const coOccurrences = /* @__PURE__ */ new Map();
	if (!classNamesOf) return {
		ownership,
		coOccurrences
	};
	const chunks = Object.values(bundle).filter((output) => output.type === "chunk");
	const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
	const eager = /* @__PURE__ */ new Set();
	const visit = (fileName) => {
		if (eager.has(fileName)) return;
		eager.add(fileName);
		for (const imported of byFileName.get(fileName)?.imports ?? []) visit(imported);
	};
	for (const chunk of chunks) if (chunk.isEntry) visit(chunk.fileName);
	const owners = /* @__PURE__ */ new Map();
	for (const chunk of chunks) {
		const owner = eager.has(chunk.fileName) ? null : chunk.fileName;
		for (const moduleId of Object.keys(chunk.modules)) for (const classNames of classNamesOf(environment, moduleId) ?? []) {
			const together = [];
			for (const token of classNames.split(" ")) {
				if (!token) continue;
				const className = require_class_name.bare(token);
				together.push(className);
				const previous = owners.get(className);
				if (previous === void 0) owners.set(className, owner);
				else if (previous !== owner) owners.set(className, null);
			}
			if (together.length < 2) continue;
			for (const className of together) {
				const neighbours = coOccurrences.get(className) ?? /* @__PURE__ */ new Set();
				for (const neighbour of together) if (neighbour !== className) neighbours.add(neighbour);
				coOccurrences.set(className, neighbours);
			}
		}
	}
	for (const [className, owner] of owners) if (owner !== null) ownership.set(className, owner);
	_bamboocss_logger.logger.debug("vite", `Split: ${chunks.length} chunk(s), ${eager.size} loaded with an entry, ${owners.size} atom(s) seen, ${ownership.size} owned by a lazy chunk.`);
	return {
		ownership,
		coOccurrences
	};
};
/**
* Prune every generated sheet in `bundle` this generation has not pruned yet.
*
* Reached twice per output. The early hook, ordered `pre`, reaches a sheet Vite emitted while
* rendering chunks — every `cssCodeSplit: true` build — before any other plugin's
* `generateBundle` reads its name, so a framework recording asset names records the final one.
* That was not a courtesy: `@vitejs/plugin-rsc` snapshots the server build's stylesheet name in
* a normal-order hook and writes it into a manifest at the end of the run, so a rename in a
* `post` hook left every server-rendered page linking a stylesheet that no longer existed. The
* late hook, ordered `post`, reaches what Vite emits from its own `generateBundle` — the single
* `style.css` of a `cssCodeSplit: false` build. Exactly one of the two opens a projection for a
* given sheet.
*
* Pruning waits for no one; finalizing does. The stylesheet is emitted by the environment that
* *imports* it, which in an SSR app is the client — and the client builds first, before the
* server environment has transformed a single module. Two answers were tried before this one.
* Holding the sheet back until every environment had contributed meant never pruning in any SSR
* framework, since the client's output is on disk before the server starts. Pruning against the
* client alone, with a guard that failed the build when a later environment reached a rule it had
* removed, made a styled component that renders only on the server a build failure — and under
* React Server Components most components never reach the client graph at all.
*
* So while environments remain, the sheet is pruned against what the run knows so far and
* written under a name hashed from those bytes, and it is recorded as deferred with its unpruned
* source. When the last environment writes its output, `bamboocss:output-write-observer` prunes
* that source again against the union of every environment's reachability. Usually the result is
* the bytes already on disk, and nothing moves. When a later environment restored a rule, the
* final bytes go under a new name, every written reference moves with them, and so does any copy
* of the provisional sheet another output carries. A single-environment build, a run whose
* sheet-carrying environment builds last, and an in-memory build take the direct path, where the
* guard in `buildEnd` still fails a later environment that reaches a rule the sheet lost.
*/
const pruneEmittedSheets = async (context, session, outputOptions, bundle, isWrite, pruneCss, splitCss) => {
	const { containsGeneratedCssAsset, optimizeStaticCssAssets } = await loadCssOutputModule();
	let handledNames = session.prunedSheetNames.get(outputOptions);
	if (!handledNames) {
		handledNames = /* @__PURE__ */ new Set();
		session.prunedSheetNames.set(outputOptions, handledNames);
	}
	const carriesSheet = containsGeneratedCssAsset(bundle, session.prunedAssets, handledNames);
	const environmentName = context.environment?.name ?? "default";
	const pending = remainingEnvironments(session, environmentName);
	const completesRun = !pending.length && session.deferredSheets.length > 0;
	if (!carriesSheet && !completesRun) return;
	const outputProjection = session.beginOutputProjection(environmentName, outputOptions, bundle, carriesSheet);
	try {
		const outputDir = outputOptions.dir ?? (outputOptions.file ? (0, node_path.dirname)(outputOptions.file) : void 0);
		const deferred = pruneCss && isWrite === true && outputDir !== void 0 && pending.length > 0;
		const remaining = (0, _bamboocss_shared.truncateList)(pending, {
			unit: "environment",
			separator: ", "
		});
		const sourcemap = context.environment?.config?.build?.sourcemap ?? session.sourcemap;
		if (completesRun) await session.finalizeDeferred?.({
			environment: environmentName,
			bundle,
			sourcemap
		});
		if (!carriesSheet) return;
		const cssCodeSplit = context.environment?.config?.build?.cssCodeSplit ?? session.cssCodeSplit ?? true;
		const split = splitCss && session.splitCss && pruneCss && cssCodeSplit && context.emitFile && context.getFileName ? {
			...chunkOwnership(bundle, environmentName, session),
			emit: (chunkFileName, css) => {
				const chunk = bundle[chunkFileName];
				const referenceId = context.emitFile({
					type: "asset",
					name: `${chunk?.name ?? "chunk"}.css`,
					source: css
				});
				const fileName = context.getFileName(referenceId);
				chunk?.viteMetadata?.importedCss?.add(fileName);
				const emitted = bundle[fileName];
				if (emitted) session.prunedAssets.add(emitted);
			}
		} : void 0;
		const { sheets, results } = optimizeStaticCssAssets(bundle, session, {
			environment: environmentName,
			prune: pruneCss,
			requiredClasses: outputProjection.requiredClasses,
			sourcemap: context.environment?.config?.build?.sourcemap,
			handled: session.prunedAssets,
			handledNames,
			split
		});
		if (sheets && !pruneCss) _bamboocss_logger.logger.info("vite", "Reachability pruning is off (`pruneCss: false`). The full extracted stylesheet ships.");
		if (!sheets || !pruneCss || !pending.length) return;
		if (deferred) {
			for (const result of results) session.deferredSheets.push({
				environment: environmentName,
				dir: (0, node_path.resolve)(outputDir),
				originalFileName: result.original,
				fileName: result.fileName,
				source: result.source,
				provisional: result.optimized,
				sourcemap,
				asset: result.asset,
				bundle,
				moved: result.moved
			});
			_bamboocss_logger.logger.debug("vite", `Pruned the stylesheet against what the run knows, with ${remaining} still to compile. It is pruned again from source once the last environment has written its output, and renamed only if that restores a rule.`);
		} else _bamboocss_logger.logger.debug("vite", `Pruning against the ${JSON.stringify(environmentName)} environment with ${remaining} still to compile. An in-memory build has no file to finalize, so a class only those reach fails the build rather than shipping without its rule.`);
	} finally {
		outputProjection.restore();
	}
};
/**
* The early half of the stylesheet's output lifecycle. @see `pruneEmittedSheets`
*
* A plugin of its own because one plugin carries one `generateBundle`, and this one has to be
* ordered `pre` while the checks in `bamboocssCss` have to see the finished bundle.
*/
const bamboocssCssEarly = (options) => ({
	name: "bamboocss:css-early",
	sharedDuringBuild: true,
	/**
	* A watch rebuild renders into the same output options object, so the names pruned by the
	* previous build would otherwise still read as handled, and the sheet a rebuild re-emits
	* under an unchanged name would ship unpruned.
	*/
	renderStart(outputOptions) {
		options.session.prunedSheetNames.delete(outputOptions);
	},
	generateBundle: {
		order: "pre",
		async handler(outputOptions, bundle, isWrite) {
			await pruneEmittedSheets(this, options.session, outputOptions, bundle, isWrite, options.pruneCss ?? true, true);
		}
	}
});
/**
* Serve bamboo's stylesheet as a virtual module, in dev and in build.
*
* This is the integration itself, not an optimisation: without it nothing emits css and
* the generated `styled-system` runtime names classes no rule exists for.
*
* A virtual module rather than a file written to disk, because vite already owns the two
* things a file would have to reimplement. In dev it injects css over the websocket and
* replaces it in place, so an edit repaints without reloading; in build it hashes the
* content into the asset graph and lets the bundler decide where it lands. Writing
* `styles.css` and asking the project to import it means the build reads a file the same
* process just wrote, which is a race on any watch rebuild.
*/
const bamboocssCss = (options) => {
	const { configPath, cwd, loadCssOutput = loadCssOutputModule, session, host = createCompilationHost({
		configPath,
		cwd
	}), pruneCss = true } = options;
	let builder;
	let server;
	let command = "build";
	/** The run's own `build` options, for a bundler with no per-environment config. */
	let ssrBuildOptions;
	/** Every source, resolver input and expanded config dependency which can change the sheet. */
	const extractedSourceFiles = () => {
		const activeBuilder = builder;
		const context = activeBuilder?.context;
		if (!context) return [];
		return [...new Set([
			...activeBuilder.getSourceFiles(),
			...activeBuilder.getResolutionReadFiles(),
			...activeBuilder.getResolutionConfigurationFiles(),
			...context.explicitDeps
		].map((file) => context.runtime.path.abs(context.config.cwd, file)))];
	};
	/**
	* Serialised, because both `load` and the watcher can reach it and `Builder` keeps one
	* context. Two overlapping passes would extract into the same encoder and emit the
	* stylesheet twice over.
	*/
	let pending;
	/**
	* Which change the current `pending` was generated for, and the validated sheet it produced.
	*
	* Every environment loads the virtual stylesheet — a react-router dev server loads it once
	* for the client graph and once for SSR — and each load used to run a complete extraction
	* and optimization pass to produce byte-identical CSS. The sheet is a function of the source
	* files alone, and the watcher below is the single point every event that can reach it
	* passes through — Vite's own propagation only arrives via the watch edges `transform` registers,
	* over the same extracted files the watcher checks. A monotonic counter bumped there is
	* therefore enough to know whether a build already reflects the world a load is asking about.
	*
	* Dev only. A production build has no dev watcher to advance the counter, so serving the
	* memo there would hand `vite build --watch` a stale sheet; builds regenerate per load.
	*/
	let changeGeneration = 0;
	let pendingGeneration = -1;
	let servedCss;
	/**
	* Whether the served stylesheet carries a source map: a dev server with Vite's
	* `css.devSourcemap` on. Off, and the extraction pass records no call sites at all.
	*/
	let devSourcemap = false;
	/** Each atom's first call site, by class name, from the last pass. @see `Builder.getAtomOrigins` */
	let atomOrigins;
	/**
	* Held by the host for its whole length, rather than only around each mutation.
	*
	* Extraction fills the encoder this sheet is emitted from and `toCss` reads it back, with a
	* deliberate macrotask between them. The compiler shares the AST both halves run against,
	* so a transform folding a module in that window would re-prepare a source the extraction
	* pass has already read and `toCss` has not finished reporting on. The host makes compiler
	* work wait instead; a fold is a few milliseconds and this is the one place correctness
	* depends on it.
	*/
	const build = () => host.runCssPass(async (activeBuilder) => {
		builder = activeBuilder;
		await activeBuilder.emit();
		activeBuilder.extract();
		await new Promise((settle) => setImmediate(settle));
		if (activeBuilder.context) {
			session.utilityLayer = activeBuilder.context.config.layers?.utilities ?? "utilities";
			session.extractedFiles.clear();
			for (const file of extractedSourceFiles()) session.extractedFiles.add(file);
		}
		let graphAtomHashes;
		if (activeBuilder.context) {
			activeBuilder.context.encoder.atomizeObservedRecipes();
			graphAtomHashes = new Set(activeBuilder.context.encoder.atomic);
		}
		const css = activeBuilder.toCss({ layerParams: true });
		atomOrigins = devSourcemap ? activeBuilder.getAtomOrigins?.() : void 0;
		session.prunableClasses.clear();
		session.viewTransitionClasses.clear();
		if (graphAtomHashes && activeBuilder.context) {
			const decoder = activeBuilder.context.decoder.collect(activeBuilder.context.encoder);
			for (const atom of decoder.atomic) if (graphAtomHashes.has(atom.hash)) session.prunableClasses.add(atom.className);
			for (const transition of decoder.view_transitions) {
				session.viewTransitionClasses.add(transition.className);
				session.prunableClasses.add((0, _bamboocss_shared.esc)(transition.className));
			}
		}
		return css;
	});
	const generate = () => {
		if (command === "serve" && pending && pendingGeneration === changeGeneration) return pending;
		pendingGeneration = changeGeneration;
		pending = Promise.resolve(pending).catch(() => void 0).then(build);
		return pending;
	};
	/**
	* The pass that runs before Rollup resolves anything, and the sheet it produced.
	*
	* `emit` writes `styled-system/`, and reaching it through `load` is too late to be what a
	* fresh clone needs: `load` runs when the *virtual module* is requested, and a module's
	* imports are all resolved before any of them is loaded. So `app/root.tsx` importing both
	* `styled-system/css` and `virtual:bamboo.css` has the first resolved while the directory is
	* still absent — the client build carried on and externalised it, the ssr build failed with
	* "Rolldown failed to resolve import", and `vite dev` served an error overlay. `buildStart` is
	* the first hook Rollup calls, and it precedes all of that.
	*
	* Memoised, and consumed by the first `load` rather than regenerated for it. `buildStart` runs
	* once per environment against this one shared instance, and nothing can have invalidated the
	* result in between — the modules that would invalidate it have not been transformed yet.
	* Regenerating would mean a second full extraction on every cold start, to produce the same
	* bytes.
	*/
	let prebuilt;
	let prebuildStarted = false;
	const prebuild = async () => {
		if (!prebuildStarted) {
			prebuildStarted = true;
			prebuilt = generate();
		}
		const attempt = prebuilt ?? pending;
		if (!attempt) return;
		try {
			await attempt;
		} catch (error) {
			if (prebuilt === attempt || prebuilt === void 0 && pending === attempt) {
				prebuildStarted = false;
				prebuilt = void 0;
			}
			throw error;
		}
	};
	/**
	* The dev config graph is independent of Builder setup and is needed one hook earlier. Keep
	* its module load and graph walk single-flight as well: shared plugins may be resolved for
	* client and SSR concurrently, but both describe the same Vite config.
	*/
	const configDependencyLoaders = /* @__PURE__ */ new Map();
	const discoverConfigDependencies = (root) => {
		const projectRoot = cwd ?? root;
		let discover = configDependencyLoaders.get(projectRoot);
		if (!discover) {
			const created = createRetryableLazy(async () => {
				const { findConfig, getConfigDependencies } = await loadConfigModule();
				return getConfigDependencies(findConfig({
					cwd: projectRoot,
					file: configPath
				})).deps;
			});
			configDependencyLoaders.set(projectRoot, created);
			discover = created;
		}
		return discover();
	};
	return {
		name: "bamboocss:css",
		/**
		* One instance for every environment of a build, rather than one per environment.
		*
		* Vite re-reads the config file once per environment, so a project that lists this plugin
		* in `vite.config.ts` — every project — got a *fresh* instance per environment, each with
		* its own compilation session, context and ts-morph project. Nothing an environment
		* established could then be seen by the next one, which is the premise the reachability
		* accounting below is built on, and it also meant the whole config load and extraction
		* happened once per environment.
		*/
		sharedDuringBuild: true,
		async configResolved(config) {
			command = config.command;
			host.setCommand(config.command);
			devSourcemap = config.command === "serve" && Boolean(config.css?.devSourcemap);
			host.setDevSourcemap(devSourcemap);
			session.sourcemap = config.build.sourcemap;
			session.cssCodeSplit = config.build.cssCodeSplit;
			session.refusesBundleKeys = bundlerRefusesBundleKeys(config);
			ssrBuildOptions = {
				ssr: config.build.ssr,
				ssrEmitAssets: config.build.ssrEmitAssets
			};
			/**
			* Tell Vite that `bamboo.config.ts` is a config file, so editing one restarts the server.
			*
			* Tokens live there, and they are what a designer iterates on most — "restart the dev
			* server to see a colour change" is the wrong instruction for the file most likely to be
			* edited all afternoon. Nothing watched it: `watch` is the CLI's own watcher, and a
			* project running `vite dev` never reaches it.
			*
			* A restart rather than re-emitting the stylesheet. The two plugins share one context now,
			* and the compiler re-derives everything it holds when `Builder.setup` replaces it — so the
			* half-updated state this used to prevent, with the compiler naming classes from the old
			* config against a sheet emitted from the new one, can no longer happen. What a restart
			* still buys is the rest of the server: a changed `outdir`, a preset that adds an entry
			* point, and every module Vite has already transformed against the previous config.
			*
			* Through Vite's own list rather than a watcher of ours. Vite adds these paths to the
			* files it watches, which is what reaches a config *outside* `root` — a monorepo with one
			* config above `apps/web`, or a preset resolved into `node_modules`, neither of which the
			* project watcher covers. It also means the restart is Vite's, with its own concurrency
			* guard and its own error reporting, rather than a second implementation of both.
			*
			* The config's own import graph is resolved the way `Builder` resolves it, minus the
			* tsconfig paths it has not loaded yet at this point. `dependencies` globs are not
			* expanded here: they are declared as an escape hatch for a *config reload*, and turning
			* every file matching one into a full server restart is not what a project asking for
			* that meant.
			*/
			if (config.command === "serve") try {
				const deps = await discoverConfigDependencies(config.root);
				config.configFileDependencies.push(...deps);
			} catch {}
			if (config.builder && config.environments) session.expectedEnvironments = new Set(Object.keys(config.environments));
		},
		/**
		* The definitive environment list, for a run that reaches `builder.buildApp()` without
		* configuring `builder` — the shape `vite build` itself takes, where exactly one
		* environment is set up and pruning is therefore safe.
		*/
		buildApp: {
			order: "pre",
			async handler(builder) {
				session.expectedEnvironments = new Set(Object.keys(builder.environments));
			}
		},
		/**
		* Put `styled-system/` on disk before anything resolves an import of it.
		*
		* Normalized rather than rethrown as caught, for the reason the compiler's `buildStart`
		* gives: this evaluates the user's config and its hooks, and in dev anything that is not an
		* object crashes Vite's error middleware instead of being reported.
		*/
		async buildStart() {
			try {
				await prebuild();
			} catch (error) {
				throw asError(error, `failed to generate ${VIRTUAL_CSS_ID}`);
			}
		},
		resolveId(id) {
			const query = queryOf(id);
			const base = id.slice(0, id.length - query.length);
			if (base !== "virtual:bamboo.css" && base !== RESOLVED_ID) return null;
			return `${RESOLVED_ID}${query}`;
		},
		async load(id) {
			const query = queryOf(id);
			if (id.slice(0, id.length - query.length) !== RESOLVED_ID) return null;
			session.cssLoaded = true;
			if (command === "serve" && URL_QUERY.test(query)) return `export default ${JSON.stringify(devStylesheetUrl(server?.config))}`;
			const generationAtStart = changeGeneration;
			if (command === "serve" && servedCss?.generation === generationAtStart) return servedCss.map ? {
				code: servedCss.css,
				map: servedCss.map
			} : servedCss.css;
			let css;
			let map;
			try {
				const cssOutput = command === "serve" ? await loadCssOutput() : void 0;
				const validateDevCss = cssOutput?.pruneStaticCss;
				const first = prebuilt;
				prebuilt = void 0;
				css = await (first ?? generate());
				if (validateDevCss) css = validateDevCss(css, session, { prune: false });
				if (devSourcemap && atomOrigins?.size) map = cssOutput?.cssSourceMap?.(css, atomOrigins);
			} catch (error) {
				throw asError(error, `failed to generate ${VIRTUAL_CSS_ID}`);
			}
			if (command === "serve" && generationAtStart === changeGeneration) servedCss = {
				generation: generationAtStart,
				css,
				map
			};
			if (command === "build" && this.addWatchFile) for (const file of session.extractedFiles) this.addWatchFile(file);
			return map ? {
				code: css,
				map
			} : css;
		},
		/**
		* Register every extracted file against the stylesheet, in the graph that just asked for it.
		*
		* In dev this has to happen here rather than in `load`. Vite attaches what `load` registers to
		* the module's node in the graph, and a request for a module the graph has no node for yet runs
		* `load` first and creates the node afterwards, so everything `load` registered is dropped
		* without a word. `vite:css-analysis` then records no importer edges, Vite's own propagation
		* never reaches the sheet in that environment, and the watcher below does not force a reload
		* either, because the edited file does have a module there. The component repaints with a class
		* whose rule never arrives, and stays that way until a restart.
		*
		* A browser's import never meets it, since the importer's analysis creates the node before the
		* sheet is requested. A `transformRequest` that reaches the sheet first does. TanStack Start
		* sends one on every page load when `__root.tsx` imports the stylesheet: its dev-only SSR style
		* collection transforms the sheet in the client environment on the server, before the browser's
		* import has put a node there.
		*
		* By `transform` the node exists, and the context is the one `vite:css-analysis` reads after
		* every plugin has run, so the edges are recorded however the request arrived. From the
		* session's set rather than `extractedSourceFiles()`, which re-globs the include patterns per
		* call; every pass assigns the set from that same expression.
		*
		* Filtered by id, so a bundler that honours hook filters never calls in for any other module.
		* The exact check stays for one that does not.
		*/
		transform: {
			filter: { id: /virtual:bamboo\.css/ },
			handler(_code, id) {
				if (command !== "serve") return;
				const query = queryOf(id);
				if (id.slice(0, id.length - query.length) !== RESOLVED_ID) return;
				if (URL_QUERY.test(query)) return;
				if (this.addWatchFile) for (const file of session.extractedFiles) this.addWatchFile(file);
			}
		},
		configureServer(devServer) {
			server = devServer;
			/**
			* The graph the stylesheet's own module lives in, which is the one that has to reach it.
			*
			* `transform` registers every extracted file with `addWatchFile`, and `vite:css-analysis`
			* turns those into real importer edges — the virtual module ends up a direct importer of
			* each file the extractor read. So an edit to any of them propagates to the stylesheet on
			* Vite's own pass, in whichever environment holds that edge.
			*
			* The client one, because CSS is a client concern: an ssr environment never applies a
			* stylesheet update, and asking whether *any* environment matched would skip the forced
			* reload below for a server-only module whose styles the client still has to be told
			* about. Vite 5 has one graph and no `environments`, where the question is exact.
			*/
			const clientGraph = devServer.environments?.client?.moduleGraph ?? devServer.moduleGraph;
			const invalidate = (file, event) => {
				const activeBuilder = builder;
				const ctx = activeBuilder?.context;
				if (!ctx) return;
				const absoluteFile = ctx.runtime.path.abs(ctx.config.cwd, file);
				const wasExtracted = session.extractedFiles.has(absoluteFile);
				const changesConfigMembership = event !== "update" && activeBuilder.isPotentialConfigDependency(absoluteFile);
				if (!wasExtracted && (event !== "create" || !activeBuilder.isPotentialSourceFile(absoluteFile) && !changesConfigMembership)) return;
				host.noteSourceChange(absoluteFile, event, { needsConfigReload: changesConfigMembership });
				changeGeneration++;
				prebuilt = void 0;
				const sheets = [RESOLVED_ID, `${RESOLVED_ID}?direct`].flatMap((sheetId) => {
					const sheet = server?.moduleGraph.getModuleById(sheetId);
					return sheet ? [sheet] : [];
				});
				if (!sheets.length) return;
				if (wasExtracted && clientGraph.getModulesByFile(absoluteFile)?.size) return;
				for (const sheet of sheets) {
					server?.moduleGraph.invalidateModule(sheet);
					server?.reloadModule(sheet);
				}
				_bamboocss_logger.logger.debug("vite", `styles invalidated by ${absoluteFile}`);
			};
			devServer.watcher.on("change", (file) => invalidate(file, "update"));
			devServer.watcher.on("add", (file) => invalidate(file, "create"));
			devServer.watcher.on("unlink", (file) => invalidate(file, "delete"));
		},
		generateBundle: {
			order: "post",
			async handler(outputOptions, bundle, isWrite) {
				const context = this;
				await pruneEmittedSheets(context, session, outputOptions, bundle, isWrite, pruneCss, false);
				const { containsGeneratedCssAsset } = await loadCssOutputModule();
				const environment = context.environment;
				const environmentName = environment?.name ?? "default";
				const replacesGeneratedStylesheet = containsGeneratedCssAsset(bundle);
				const outputProjection = session.beginOutputProjection(environmentName, outputOptions, bundle, false);
				try {
					if (!outputProjection.cssLoaded) return;
					if (!session.transformedFiles.size) return;
					/**
					* An SSR bundle emits no CSS assets, and is not supposed to.
					*
					* `build.ssrEmitAssets` is off by default, so Vite discards them: the client build is
					* what carries the stylesheet, and a server bundle that imports `virtual:bamboo.css`
					* from shared code — a root component, a layout — still asks this plugin to load it.
					* Which means the environment *served* the sheet and then emitted nothing, and the
					* check below read that as the failure it exists to catch.
					*
					* It fails a build that is entirely correct. Qwik's `vite build --ssr` is the shape
					* that showed it: 7/7 calls compiled, the client bundle carrying the stylesheet, and
					* the server bundle refusing to finish. React Router does not hit it only because its
					* plugin turns `ssrEmitAssets` on.
					*
					* Read per environment where that exists, falling back to the run's own config, so
					* Vite 5's single-config builds are answered by the same question.
					*/
					const buildOptions = environment?.config?.build ?? ssrBuildOptions;
					if (buildOptions?.ssr && !buildOptions.ssrEmitAssets) return;
					/**
					* A server bundle that kept the stylesheet *module* is not missing it.
					*
					* Astro's prerender build turns `ssrEmitAssets` on and still emits no CSS asset: its
					* own CSS plugin reads the stylesheet off the chunk that bundled it and inlines it into
					* each page's HTML. The chunk still lists the module, which is the one thing a plugin
					* that dropped the sheet could not leave behind. A client bundle gets no such pass —
					* a browser is only styled by an asset.
					*/
					if (buildOptions?.ssr && bundleHoldsStylesheetModule(bundle)) return;
					if (!replacesGeneratedStylesheet) throw new Error(`bamboocss: ${session.transformedFiles.size} module(s) were compiled to Bamboo class values, but no emitted asset carries the generated stylesheet. The build would ship unstyled.\n\nThis happens when another plugin, or the bundler itself, drops or replaces the CSS asset after it is emitted. If you are on Rolldown, report this — the rename that used to cause it is already disabled there. Otherwise look for a plugin running in \`generateBundle\` that rewrites CSS assets.`);
				} finally {
					outputProjection.restore();
				}
			}
		}
	};
};
//#endregion
//#region src/plugin.ts
const DEFAULT_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;
const SFC_EXTENSIONS = /\.(?:vue|svelte|astro)$/i;
/**
* Framework script submodules. Vue spells `lang.ts` as a bare query key; Svelte uses
* `lang=ts`; both set `type=script`. The compiler must see that JS, not the wrapping SFC —
* folding the SFC uses parser:before offsets that do not match the file Vite emits.
*/
const SFC_SCRIPT_QUERY = /[?&](?:type=script(?:&|$)|lang\.tsx?(?:&|$)|lang=tsx?(?:&|$)|lang\.jsx?(?:&|$))/i;
const SFC_JSX_QUERY = /[?&](?:lang\.tsx|lang=tsx|lang\.jsx|lang=jsx)(?:&|$)/i;
const SFC_SCRIPT_TAG = /<script[\s>/]/i;
const NODE_MODULES = /node_modules/;
const TRANSFORM_META_KEY = "bamboocss:transform";
const TRANSFORM_ARTIFACT_VERSION = 3;
/**
* Queries that make Vite serve something other than the module's own source.
*
* `./theme.tsx?raw` is a module whose text is `export default "…"`, and `?url`, `?worker` and
* `?sharedworker` are wrappers of the same kind. The query has to be stripped before the
* extension is tested — otherwise nothing matches `.tsx` — and stripping it is what made these
* look like the file itself. The transform then handed the wrapper's text to ts-morph *under
* the real file's path*, overwriting the parsed module every fold reads for that path.
*
* That is not theoretical: a module folding `css(shared)` against a sibling the entry also
* imported as `?raw` failed the build with "1 call(s) could not be compiled" — the compiler
* had read `export default "…"` and found no `shared` to resolve. The advice it prints, to
* make the value statically analyzable, is unfollowable, because the source already was.
*
* Whether it bites depends on which of the two ids Rollup transforms last, so the same project
* can build and then stop building because an import moved.
*
* A deny list rather than an allow list of benign queries: dev ids carry `?t=` after an edit
* and `?import` when a dynamic import is rewritten, and rejecting an unrecognised one of those
* would silently stop folding a module rather than loudly refuse it.
*
* Exactly these four, matching Vite's own `SPECIAL_QUERY_RE`. The list was drafted wider —
* `?inline`, `?no-inline`, `?worklet`, `?init` — and every one of those was wrong: Vite has no
* `worklet` query at all, `?init` is `.wasm` only and that extension is already rejected below,
* and `inline`/`no-inline` merely pick base64-versus-file for something that *already* matched
* `raw`/`url`, so `./a.tsx?inline` is served as the module's own source. Rejecting an id that
* carries real source is the expensive direction: the transform declines, its atoms never reach
* the reachability set, pruning removes their rules, and the runtime still returns the class
* names — unstyled elements, no error. Only names verified against Vite belong here.
*
* Note `?worker_file`, which is how dev serves a worker's *real* source, is deliberately absent
* and must stay absent. It contains "worker" and is the obvious next entry; adding it would
* stop folding every worker module in dev, silently, by the mechanism above.
*
* Tested against the whole id rather than a split-off query, so it cannot disagree with
* `queryOf` in `css.ts` about where the query starts.
*/
const WRAPPED_MODULE_QUERY = /[?&](?:raw|url|worker|sharedworker)(?:&|=|$)/;
const shouldTransform = (id) => {
	if (id.startsWith("\0")) return false;
	if (WRAPPED_MODULE_QUERY.test(id)) return false;
	const [filePath] = id.split("?");
	if (!filePath) return false;
	if (NODE_MODULES.test(filePath)) return false;
	return DEFAULT_EXTENSIONS.test(filePath) || SFC_EXTENSIONS.test(filePath);
};
/**
* Path ts-morph should parse for this transform.
*
* A `.vue` / `.svelte` / `.astro` id is either a raw SFC (skip — offsets would not match), a
* `type=script` submodule, or the framework's compiled JS stored under the SFC path. The last
* two are JavaScript or TypeScript: parsing them as the SFC would run `parser:before` and fold
* the wrong bytes. A sibling `.ts`/`.tsx` path preserves JSX parsing and skips those hooks.
*
* Returns `null` when the module is still a raw SFC and must be left to the framework plugin.
* Astro frontmatter is `---`, not `<script>`, so a tag check alone would parse the template.
*/
/** The module specifiers that reach bamboo — the `styled-system` paths and any `importMap` — per context. */
const entrypointNeedles = /* @__PURE__ */ new WeakMap();
/**
* Whether a module's text names a bamboo entrypoint at all.
*
* A textual test on purpose: it runs before the module is parsed, on modules outside the
* extraction inventory, to decide whether parsing is worth it. The outdir's own name is among
* the needles, so a relative import of the generated `styled-system` counts too.
*/
const namesEntrypoint = (ctx, code) => {
	let needles = entrypointNeedles.get(ctx);
	if (!needles) {
		const outdirName = ctx.imports.outdir.split("/").filter(Boolean).at(-1);
		needles = [...new Set([outdirName ?? "", ...Object.values(ctx.imports.value).flat()].filter((needle) => needle.length > 0))];
		entrypointNeedles.set(ctx, needles);
	}
	return needles.some((needle) => code.includes(needle));
};
/** A module specifier in an import, export-from, dynamic import or require. */
const MODULE_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
/** How a relative specifier may name a file, in the order the bundler tries them. */
const SPECIFIER_SUFFIXES = [
	"",
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	"/index.ts",
	"/index.tsx",
	"/index.js"
];
/**
* Whether a module imports a module the extraction inventory covers.
*
* Answered from `include`, the filesystem and the compiler's overlays — no parse — which is
* what makes it affordable to ask of every module outside the inventory. A relative specifier
* is tried against the file names a bundler would, and an aliased one through `resolveAlias`,
* which the caller supplies from the fold chunk so the tsconfig-path resolver stays out of the
* public entry. A package name is not followed: a published package ships its own output.
*/
const importsSourceModule = (isSourceModule, resolveAlias, filePath, code) => {
	const directory = (0, node_path.dirname)(filePath);
	const covered = (base) => SPECIFIER_SUFFIXES.some((suffix) => isSourceModule(base + suffix));
	for (const match of code.matchAll(MODULE_SPECIFIER)) {
		const specifier = match[1];
		if (specifier.startsWith(".") || specifier.startsWith("/")) {
			if (covered(specifier.startsWith("/") ? specifier : (0, node_path.resolve)(directory, specifier))) return true;
			continue;
		}
		const aliased = resolveAlias(specifier);
		if (aliased && covered((0, node_path.resolve)(aliased))) return true;
	}
	return false;
};
const compilerParsePath = (id, code) => {
	const [filePath, query = ""] = id.split("?");
	if (!filePath) return null;
	if (!SFC_EXTENSIONS.test(filePath)) return filePath;
	const normalizedQuery = `?${query}`;
	if (SFC_SCRIPT_QUERY.test(normalizedQuery)) return `${filePath}.__bamboo__.${SFC_JSX_QUERY.test(normalizedQuery) ? "tsx" : "ts"}`;
	const trimmed = code.trimStart();
	if (/\.astro$/i.test(filePath) && (trimmed.startsWith("---") || trimmed.startsWith("<"))) return null;
	if (SFC_SCRIPT_TAG.test(code) || /<(?:template|style)[\s>/]/i.test(code)) return null;
	if (trimmed.startsWith("<")) return null;
	return `${filePath}.__bamboo__.ts`;
};
/**
* Is this file part of the generated `styled-system` rather than the user's source?
*
* Resolved to a path and compared as a prefix, rather than by looking for the outdir's
* last segment somewhere in the file's path. `outdir` is a user setting: a project that
* generates into `src/styles` would otherwise have *every* directory named `styles`
* treated as generated, and folding would quietly stop happening in the one place an app
* is most likely to keep its style calls.
*
* `resolve` rather than `join`, so an absolute `outdir` is honoured rather than appended
* to the cwd.
*/
const isGeneratedOutput = (filePath, ctx) => {
	const { cwd, outdir } = ctx.config;
	if (!outdir) return false;
	const slashed = (value) => value.replaceAll("\\", "/").replace(/\/$/, "");
	const root = slashed((0, node_path.resolve)(cwd, outdir));
	const file = slashed(filePath);
	return file === root || file.startsWith(`${root}/`);
};
/** 1-indexed line of a source offset, for an error a user can navigate to. */
const lineAt = (code, offset) => code.slice(0, offset).split("\n").length;
/**
* One spelling for a path used as a map key against paths from somewhere else.
*
* The fold reports dependencies as ts-morph sees them and Vite reports a changed file as its
* watcher saw it. On Windows those differ by separator, and can differ by the case of the
* drive letter alone — chokidar reports what the OS handed it, `path.resolve` preserves
* whatever the cwd had. Either would make every lookup below miss and restore the exact
* staleness they exist to fix, silently, since a miss is indistinguishable from a module that
* folded nothing. Only the drive letter is case-folded: the rest of the path is compared as
* written, because elsewhere the filesystem may well be case-sensitive.
*/
const normalizeFsPath = (file) => (0, node_path.resolve)(file).replaceAll("\\", "/").replace(/^[a-z]:\//, (drive) => drive.toUpperCase());
const formatSkipped = (id, skipped) => {
	const counts = /* @__PURE__ */ new Map();
	for (const entry of skipped) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
	return `${id}: ${Array.from(counts.entries()).map(([reason, count]) => `${reason}=${count}`).join(" ")}`;
};
/**
* Vite integration for Bamboo CSS.
*
* Three plugins. The first emits the stylesheet as a virtual module. The second compiles
* JavaScript and TypeScript with `enforce: 'pre'` so it sees source close to what the CSS
* extractor reads off disk. The third compiles Vue, Svelte and Astro with `enforce: 'post'`
* so it folds the framework's compiled JavaScript — a `pre` hook that skipped the raw SFC
* would never run again on the same id. Script submodules (`type=script`) are SFC paths and
* therefore fold in the post plugin, after the framework has extracted them.
*/
const bamboocss = (options = {}) => {
	const { configPath, cwd, reportSkipped = false, reportSummary = true, maxRecipeStates, pruneCss = true, splitCss = true } = options;
	(0, _bamboocss_node_static_compiler.markStaticCompilerActive)();
	if (maxRecipeStates !== void 0 && (!Number.isSafeInteger(maxRecipeStates) || maxRecipeStates < 1)) throw new Error("bamboocss: `maxRecipeStates` must be a positive safe integer.");
	if ("renameCssAsset" in options) throw new Error("bamboocss: `renameCssAsset` has been replaced by `pruneCss`. Use `pruneCss: false` for what `renameCssAsset: false` did — it always disabled the pruning as well, since pruned bytes under the unpruned sheet's name is what lets a CDN serve a stale stylesheet. The new name says which of the two it is really about.");
	const staticSession = createStaticCompilationSession();
	staticSession.splitCss = splitCss;
	/**
	* One Builder, one resolved config, one context and one ts-morph project for the run.
	*
	* Created here rather than by either plugin because both need it and neither may own it:
	* the compiler used to load a second config of its own, which is why a token edit could
	* leave it naming classes from the old one against a sheet emitted from the new one.
	*/
	const host = createCompilationHost({
		configPath,
		cwd
	});
	const transformArtifactIntegrityKey = (0, node_crypto.randomBytes)(32);
	const serializeTransformArtifact = (environment, artifact) => JSON.stringify([
		TRANSFORM_META_KEY,
		environment,
		artifact.version,
		artifact.moduleId,
		artifact.file,
		artifact.folded,
		artifact.skipped.map(([reason, count]) => [reason, count]),
		artifact.survivors.map(({ line, name, reason }) => [
			line,
			name,
			reason
		]),
		artifact.transformedFile,
		[...artifact.classNames],
		[...artifact.dependencies],
		artifact.signature ? [
			artifact.signature.input,
			artifact.signature.output,
			artifact.signature.path
		] : null
	]);
	const transformArtifactIntegrity = (environment, artifact) => (0, node_crypto.createHmac)("sha256", transformArtifactIntegrityKey).update(serializeTransformArtifact(environment, artifact)).digest("base64url");
	const sealTransformArtifact = (environment, artifact) => {
		const detached = {
			...artifact,
			skipped: artifact.skipped.map(([reason, count]) => [reason, count]),
			survivors: artifact.survivors.map((survivor) => ({ ...survivor })),
			classNames: [...artifact.classNames],
			dependencies: [...artifact.dependencies],
			...artifact.signature ? { signature: { ...artifact.signature } } : {}
		};
		return {
			...detached,
			integrity: transformArtifactIntegrity(environment, detached)
		};
	};
	const skipReasons = new Set([
		"dynamic",
		"raw-call",
		"recipe-call",
		"unsupported-kind",
		"not-imported",
		"no-call-expression",
		"overlapping",
		"unresolved-token",
		"runtime-binding",
		"compile-failed",
		"opaque-composition"
	]);
	const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
	const isNonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
	const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
	const isTransformArtifact = (value) => {
		if (!isRecord(value) || value.version !== TRANSFORM_ARTIFACT_VERSION) return false;
		if (typeof value.moduleId !== "string" || typeof value.file !== "string") return false;
		if (!isNonNegativeInteger(value.folded) || typeof value.transformedFile !== "boolean") return false;
		if (typeof value.integrity !== "string" || !/^[\w-]{43}$/.test(value.integrity)) return false;
		if (!Array.isArray(value.classNames) || !value.classNames.every((entry) => typeof entry === "string")) return false;
		if (!Array.isArray(value.dependencies) || !value.dependencies.every((entry) => typeof entry === "string")) return false;
		if (!Array.isArray(value.skipped) || !value.skipped.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && skipReasons.has(entry[0]) && isPositiveInteger(entry[1]))) return false;
		if (!Array.isArray(value.survivors) || !value.survivors.every((entry) => isRecord(entry) && Number.isSafeInteger(entry.line) && entry.line >= 1 && typeof entry.name === "string" && typeof entry.reason === "string" && skipReasons.has(entry.reason))) return false;
		if (value.signature === void 0) return true;
		return isRecord(value.signature) && typeof value.signature.input === "string" && typeof value.signature.output === "string" && value.signature.path === value.file;
	};
	const hasValidTransformArtifactIntegrity = (environment, artifact) => {
		const expected = Buffer.from(transformArtifactIntegrity(environment, artifact));
		const actual = Buffer.from(artifact.integrity);
		return actual.length === expected.length && (0, node_crypto.timingSafeEqual)(actual, expected);
	};
	const cachedArtifactError = (id, environment, value, snapshotProblem) => {
		let problem;
		if (snapshotProblem) problem = snapshotProblem;
		else if (!isRecord(value) || value.version !== TRANSFORM_ARTIFACT_VERSION) problem = isRecord(value) && (typeof value.version === "number" || typeof value.version === "string") ? `uses version ${JSON.stringify(value.version)}; expected schema version ${TRANSFORM_ARTIFACT_VERSION}` : `is malformed and has no valid version; expected schema version ${TRANSFORM_ARTIFACT_VERSION}`;
		else if (!isTransformArtifact(value)) problem = `is malformed for schema version ${TRANSFORM_ARTIFACT_VERSION}`;
		else if (value.moduleId !== id || value.file !== id.split("?")[0]) problem = `does not belong to this module id and physical file`;
		else if (!hasValidTransformArtifactIntegrity(environment, value)) problem = `failed its schema version ${TRANSFORM_ARTIFACT_VERSION} integrity check`;
		else problem = `could not be validated for schema version ${TRANSFORM_ARTIFACT_VERSION}`;
		return /* @__PURE__ */ new Error(`bamboocss: cached transform metadata for ${JSON.stringify(id)} in the ${JSON.stringify(environment)} environment ${problem}.\n\nBamboo cannot safely rebuild from this entry because cached JavaScript may still name CSS classes whose rules would be dropped. Restart Vite to invalidate its in-memory transform cache. If this persists, clear Vite's cache directory and rebuild.`);
	};
	const transformStateByEnvironment = /* @__PURE__ */ new Map();
	/** States currently materialized in the shared CSS session's reachability projection. */
	const projectedTransformStates = /* @__PURE__ */ new Set();
	const projectedUsedClassCounts = /* @__PURE__ */ new Map();
	const projectedTransformedFileCounts = /* @__PURE__ */ new Map();
	let projectedCssLoadedCount = 0;
	/**
	* One fold per file content per change event, shared across environments and hooks.
	*
	* A single edit folds the same bytes repeatedly: `hotUpdate` provisionally re-folds every
	* dependent once per environment to decide what to invalidate, then `transform` folds the
	* edited module for the client graph, again for SSR, and once more for each update a
	* framework re-drives — react-router's server-change trigger calls `reloadModule` per pass.
	* All of them read the same shared ts-morph project under the same config, so the result is
	* a function of the bytes alone and the repeats were pure cost: on the app this was measured
	* on, four transforms of a 46 kB route module per edit, ~10 ms each.
	*
	* `watchChange` clears it, which is the exact validity window: entries are correct until a
	* file event changes what a fold could resolve, and `watchChange` is the one hook Vite calls
	* for every such event before any update work begins.
	*
	* Keyed by path *and* content digest, not path alone, because one physical file is served
	* as more than one module shape in the same event — react-router clips a route module down
	* to its route exports for the client graph while SSR gets the full file — and a last-write
	* key would make the two shapes evict each other on every pass.
	*
	* Dev only, like the verdict memo it sits beside: a build transforms each module once per
	* environment with no bracketing events, and holding every module's fold for the length of a
	* build is memory a one-shot pass has no reason to spend.
	*/
	const foldMemoByContent = /* @__PURE__ */ new Map();
	const foldMemoKey = (filePath, inputDigest) => `${filePath}\0${inputDigest}`;
	/** The immutable generation currently occupying each configured output on disk. */
	const liveOutputSlotsByEnvironment = /* @__PURE__ */ new Map();
	/** Graphs which passed `buildEnd`, but whose output has not succeeded yet. */
	const preparedGenerations = /* @__PURE__ */ new Map();
	/** Success accumulated across hosts which run one buildStart/buildEnd pair per output. */
	const pendingOutputCycles = /* @__PURE__ */ new Map();
	/** Last configured output whose render phase actually began, for missing-marker recovery. */
	const lastStartedOutputSlotByEnvironment = /* @__PURE__ */ new Map();
	const nextBuildSerialByEnvironment = /* @__PURE__ */ new Map();
	const observedBuildSerialByEnvironment = /* @__PURE__ */ new Map();
	const buildSerialByState = /* @__PURE__ */ new WeakMap();
	/** Output finalizers installed by the `options` hook for the next generation. */
	const outputTokensByEnvironment = /* @__PURE__ */ new Map();
	const OUTPUT_FINALIZER = Symbol("bamboocss-output-finalizer");
	const OUTPUT_START_MARKER = Symbol("bamboocss-output-start-marker");
	const DIRECT_OUTPUT_TOKEN = 0;
	let nextOutputToken = 0;
	let nextEpochId = 0;
	const outputIdentityByBundle = /* @__PURE__ */ new WeakMap();
	const outputIdentityByOptions = /* @__PURE__ */ new WeakMap();
	const outputStageByBundle = /* @__PURE__ */ new WeakMap();
	const outputStageByOptions = /* @__PURE__ */ new WeakMap();
	const environmentOf = (context) => context.environment;
	const environmentName = (context) => environmentOf(context)?.name ?? "default";
	const newEnvironmentState = () => ({
		transformArtifactsByModule: /* @__PURE__ */ new Map(),
		usedClassCounts: /* @__PURE__ */ new Map(),
		transformedFileCounts: /* @__PURE__ */ new Map(),
		dependentsByDependency: /* @__PURE__ */ new Map(),
		dependenciesByModule: /* @__PURE__ */ new Map(),
		filesByModule: /* @__PURE__ */ new Map(),
		foldSignatures: /* @__PURE__ */ new Map(),
		foldInputsByModule: /* @__PURE__ */ new Map(),
		transformedModulesThisRun: /* @__PURE__ */ new Set(),
		unchangedFolds: /* @__PURE__ */ new Map(),
		changedRun: 0,
		cssLoaded: false
	});
	const cloneEnvironmentState = (state) => ({
		transformArtifactsByModule: new Map(state.transformArtifactsByModule),
		usedClassCounts: new Map(state.usedClassCounts),
		transformedFileCounts: new Map(state.transformedFileCounts),
		dependentsByDependency: new Map([...state.dependentsByDependency].map(([dependency, dependents]) => [dependency, new Set(dependents)])),
		dependenciesByModule: new Map([...state.dependenciesByModule].map(([moduleId, dependencies]) => [moduleId, new Set(dependencies)])),
		filesByModule: new Map(state.filesByModule),
		foldSignatures: new Map(state.foldSignatures),
		foldInputsByModule: new Map(state.foldInputsByModule),
		transformedModulesThisRun: new Set(state.transformedModulesThisRun),
		unchangedFolds: new Map(state.unchangedFolds),
		changedRun: state.changedRun,
		cssLoaded: state.cssLoaded
	});
	const environmentState = (context) => {
		const identity = environmentName(context);
		let state = transformStateByEnvironment.get(identity);
		if (!state) {
			state = newEnvironmentState();
			transformStateByEnvironment.set(identity, state);
		}
		return state;
	};
	const allSurvivors = (states) => [...states].flatMap((state) => [...state.transformArtifactsByModule.values()].flatMap((artifact) => artifact.survivors.map(({ line, name, reason }) => ({
		file: artifact.file,
		line,
		name,
		reason
	}))));
	const createSurvivorError = (entries) => {
		const byFile = /* @__PURE__ */ new Map();
		for (const entry of entries) {
			const list = byFile.get(entry.file) ?? [];
			list.push(entry);
			byFile.set(entry.file, list);
		}
		const named = (entry) => entry.reason === "runtime-binding" || entry.reason === "compile-failed" ? entry.name : `${entry.name}()`;
		const detail = (0, _bamboocss_shared.truncateList)(Array.from(byFile.entries(), ([file, fileEntries]) => [`  ${file}`, ...fileEntries.map((entry) => `    ${entry.line}: ${named(entry)} — ${entry.reason}`)].join("\n")), {
			unit: "file",
			separator: "\n"
		});
		const threw = entries.some((entry) => entry.reason === "compile-failed");
		return /* @__PURE__ */ new Error(`bamboocss: ${entries.length} call(s) could not be compiled.\n\n${detail}\n\n` + (threw ? "`compile-failed` is a module the compiler threw on — see the error logged for it above. Nothing was established about its calls either way.\n\n" : "") + (entries.some((entry) => entry.reason === "runtime-binding") ? "`runtime-binding` is a Bamboo value read rather than called. An inline `cva`/`sva` declaration is erased, so its binding is `undefined` at runtime: calling it compiles, including from another module, but reading the value itself — `const alias = badge`, `badge.raw(...)`, re-exporting it — has nothing behind it. The location given is the read to change, not the declaration.\n\n" : "") + "Bamboo emits no runtime styling fallback or recipe layer. Make the values finite and statically analyzable, move variation into declared recipe variants, or safelist intentional dynamic classes with `staticCss`.\n\nSet `BAMBOO_DIAGNOSTIC_LIMIT=all` to list every finding rather than the first few.");
	};
	/**
	* Which modules folded a value read out of which other module, for dev invalidation.
	*
	* `addWatchFile` reports the same edges, and in a build that is enough — Rollup discards a
	* module whose watched file changed. Vite's dev server does not: a module that *statically
	* imports* the changed one is only **soft**-invalidated, which by design keeps its cached
	* transform result and rewrites nothing but the timestamps on its import specifiers. That
	* cached result is where the compiled class string lives, so the edit never reaches it.
	*
	* The recipe case is the one users meet, because it is the one where the class is compiled
	* into somebody else's module: an inline `cva` declaration is erased, and each *call site*
	* becomes a literal in the module that calls it. Editing the recipe then updates the class
	* in a module Vite has decided not to re-transform, so the browser and the SSR render keep
	* the old class — with no error, and with Vite and Bamboo both logging as if the edit landed.
	* A restart applies it, which is what makes it read as "recipes do not hot-reload".
	*
	* `css(sharedObject)` across modules fails identically; it is rarer only because a consumer
	* that folds *nothing but* recipe calls has its import erased, and an erased import is not a
	* static one, so Vite hard-invalidates it and the bug hides. Import one more value from the
	* same module — the shape any real `ui.ts` has — and the import survives, and so does the
	* stale class.
	*
	* Keyed by dependency, since "what changed" is the question asked, and tracked in the other
	* direction as well so a re-transform can retract edges the module no longer has.
	*/
	const recordFoldDependencies = (state, moduleId, file, dependencies) => {
		const { dependenciesByModule, dependentsByDependency, filesByModule } = state;
		const normalizedFile = normalizeFsPath(file);
		const next = new Set(dependencies.map(normalizeFsPath).filter((dependency) => dependency !== normalizedFile));
		const previous = dependenciesByModule.get(moduleId);
		filesByModule.set(moduleId, file);
		for (const dependency of previous ?? []) {
			if (next.has(dependency)) continue;
			const dependents = dependentsByDependency.get(dependency);
			if (!dependents?.delete(moduleId)) continue;
			if (!dependents.size) dependentsByDependency.delete(dependency);
		}
		if (!next.size) {
			dependenciesByModule.delete(moduleId);
			return;
		}
		dependenciesByModule.set(moduleId, next);
		for (const dependency of next) {
			const dependents = dependentsByDependency.get(dependency);
			if (dependents) dependents.add(moduleId);
			else dependentsByDependency.set(dependency, new Set([moduleId]));
		}
	};
	/**
	* What each cross-file consumer was last handed, and what it last compiled to.
	*
	* Editing a shared module re-transforms everything that folded a value out of it, and most of
	* those re-transforms recompute the bytes they already had: an edit to one export changes the
	* consumers reading *that* export, not the ones reading something else from the same file.
	* `foldDependentModules` uses this to tell those two apart.
	*
	* Digests, not text. Retaining every consumer's source and compiled output for the life of the
	* process is the same order of memory as the ts-morph project already holding it; two 44-byte
	* strings per entry is not, and it does not grow with module size. The set is bounded the way
	* `dependenciesByModule` is — an entry exists only while a module's fold actually reads another
	* file, which most modules never do — so a project that folds nothing across a boundary pays
	* neither the bytes nor the hashing.
	*
	* The *input* digest is what makes the output digest safe to act on. The check below re-folds
	* a consumer from disk, and disk is the right text only if that is what the last transform was
	* handed: a module built by another plugin's `load`, or one edited in the same save, fails
	* that comparison and is treated as changed. `path` is the spelling `transform` used, because
	* the fold keys on it and Windows spells it more than one way.
	*/
	const digest = (text) => (0, node_crypto.createHash)("sha256").update(text).digest("base64");
	/** Fingerprint the generated Bamboo assets after every plugin which may rewrite the bundle. */
	const bambooCssDigest = (bundle) => {
		const assets = [];
		for (const output of Object.values(bundle)) {
			if (!isRecord(output) || output.type !== "asset") continue;
			if (typeof output.fileName !== "string" || !output.fileName.endsWith(".css")) continue;
			const { source } = output;
			if (typeof source !== "string" && !(source instanceof Uint8Array)) continue;
			const text = typeof source === "string" ? source : Buffer.from(source).toString();
			if (!text.includes("--made-with-bamboo")) continue;
			assets.push(text);
		}
		if (!assets.length) return void 0;
		return digest(JSON.stringify(assets.sort()));
	};
	const adjustContributionCount = (counts, value, delta) => {
		const next = (counts.get(value) ?? 0) + delta;
		if (next < 0) throw new Error(`bamboocss: internal contribution count underflow for ${JSON.stringify(value)}`);
		if (next > 0) counts.set(value, next);
		else counts.delete(value);
		return next;
	};
	/** Update the projection index for one module contribution without scanning its siblings. */
	const adjustTransformContribution = (state, artifact, delta) => {
		if (artifact.transformedFile) adjustContributionCount(state.transformedFileCounts, (0, node_path.resolve)(artifact.file), delta);
		for (const classNames of artifact.classNames) for (const token of classNames.split(" ")) if (token) adjustContributionCount(state.usedClassCounts, selectorClassName(token), delta);
	};
	const replaceTransformArtifact = (state, artifact) => {
		const previous = state.transformArtifactsByModule.get(artifact.moduleId);
		if (previous) adjustTransformContribution(state, previous, -1);
		state.transformArtifactsByModule.set(artifact.moduleId, artifact);
		adjustTransformContribution(state, artifact, 1);
	};
	const deleteTransformArtifact = (state, moduleId) => {
		const previous = state.transformArtifactsByModule.get(moduleId);
		if (!previous) return false;
		adjustTransformContribution(state, previous, -1);
		return state.transformArtifactsByModule.delete(moduleId);
	};
	const adjustProjectedTransformState = (state, delta) => {
		for (const className of state.usedClassCounts.keys()) {
			const next = adjustContributionCount(projectedUsedClassCounts, className, delta);
			if (next === 1 && delta === 1) staticSession.usedClasses.add(className);
			else if (next === 0) staticSession.usedClasses.delete(className);
		}
		for (const file of state.transformedFileCounts.keys()) {
			const next = adjustContributionCount(projectedTransformedFileCounts, file, delta);
			if (next === 1 && delta === 1) staticSession.transformedFiles.add(file);
			else if (next === 0) staticSession.transformedFiles.delete(file);
		}
		if (state.cssLoaded) projectedCssLoadedCount += delta;
		if (projectedCssLoadedCount < 0) throw new Error("bamboocss: internal stylesheet contribution count underflow");
	};
	/**
	* Re-derive the two global sets CSS pruning consumes from environment-owned artifacts.
	*
	* A watch run may rebuild one environment or several at once. The candidate being judged
	* replaces its own previous contribution; every sibling contributes its committed generation,
	* even when a replacement for that sibling is already in flight. Its old JavaScript remains
	* the live output until the replacement succeeds, so pruning against a half-filled candidate
	* would remove rules that output still names.
	*/
	const contributionStates = (candidateEnvironment, candidateState) => {
		const states = [];
		const seenEpochs = /* @__PURE__ */ new Set();
		let candidateIncluded = false;
		for (const [environment, slots] of liveOutputSlotsByEnvironment) if (environment === candidateEnvironment && candidateState) {
			states.push(candidateState);
			candidateIncluded = true;
		} else for (const { epoch } of slots.values()) {
			if (seenEpochs.has(epoch.id)) continue;
			seenEpochs.add(epoch.id);
			states.push(epoch.state);
		}
		if (candidateEnvironment && candidateState && !candidateIncluded) states.push(candidateState);
		return states;
	};
	const rebuildStaticTransformContributions = (candidateEnvironment, candidateState) => {
		const nextStates = new Set(contributionStates(candidateEnvironment, candidateState));
		for (const state of projectedTransformStates) if (!nextStates.has(state)) adjustProjectedTransformState(state, -1);
		for (const state of nextStates) if (!projectedTransformStates.has(state)) adjustProjectedTransformState(state, 1);
		projectedTransformStates.clear();
		for (const state of nextStates) projectedTransformStates.add(state);
		staticSession.cssLoaded = projectedCssLoadedCount > 0;
	};
	/**
	* Snapshot which reported classes Bamboo actually extracted for this JavaScript generation.
	*
	* Fold artifacts also report literal classes passed through helpers such as `cx('external',
	* css(...))`. Intersecting with the extraction inventory keeps those useful reachability facts
	* without later demanding that Bamboo provide a rule it never owned.
	*/
	const ownedClassesForState = (state) => {
		const extracted = new Map([...staticSession.prunableClasses].map((className) => [require_class_name.bare(className), className]));
		const owned = /* @__PURE__ */ new Set();
		for (const className of state.usedClassCounts.keys()) {
			const extractedClass = extracted.get(require_class_name.bare(className));
			if (extractedClass !== void 0) owned.add(extractedClass);
		}
		return owned;
	};
	const createTransformEpoch = (state) => {
		const detachedState = cloneEnvironmentState(state);
		return {
			id: ++nextEpochId,
			state: detachedState,
			ownedClasses: ownedClassesForState(detachedState)
		};
	};
	/** Apply the same candidate-replaces-its-environment rule as the reachability projection. */
	const requiredClassesForProjection = (candidateEnvironment, candidateOwnedClasses) => {
		const required = /* @__PURE__ */ new Set();
		let candidateIncluded = false;
		const seenEpochs = /* @__PURE__ */ new Set();
		for (const [environment, slots] of liveOutputSlotsByEnvironment) {
			if (environment === candidateEnvironment) {
				for (const className of candidateOwnedClasses) required.add(className);
				candidateIncluded = true;
				continue;
			}
			for (const { epoch } of slots.values()) {
				if (seenEpochs.has(epoch.id)) continue;
				seenEpochs.add(epoch.id);
				for (const className of epoch.ownedClasses) required.add(className);
			}
		}
		if (!candidateIncluded) for (const className of candidateOwnedClasses) required.add(className);
		return required;
	};
	const currentRequiredClasses = () => {
		const prunable = new Set([...staticSession.prunableClasses].map(require_class_name.bare));
		return new Set([...staticSession.usedClasses].filter((className) => prunable.has(require_class_name.bare(className))));
	};
	/** Derive loss history from the stylesheet outputs which are still observable. */
	const rebuildLivePrunedClasses = () => {
		staticSession.prunedClasses.clear();
		for (const slots of liveOutputSlotsByEnvironment.values()) for (const slot of slots.values()) for (const className of slot.prunedClasses ?? []) staticSession.prunedClasses.add(className);
	};
	/**
	* Prune the sheets the run wrote whole, now that every environment has contributed.
	*
	* Reached from the write hook of whichever environment completes the run, which is the first
	* point at which the union of every environment's reachability exists and every reference to
	* the sheet is on disk. A run that never completes — an environment declared and never built
	* — leaves the sheets whole, and says so as the process exits.
	*/
	const finalizeDeferredSheetsIfComplete = async (candidate, bundle, sourcemap) => {
		if (!staticSession.deferredSheets.length) return;
		if (remainingEnvironments(staticSession, candidate).length) return;
		const sheets = staticSession.deferredSheets.splice(0);
		const { finalizeDeferredSheets } = await loadCssOutputModule();
		const committed = staticSession.prunedClasses;
		staticSession.prunedClasses = /* @__PURE__ */ new Set();
		let finalized;
		let lost;
		try {
			finalized = finalizeDeferredSheets(sheets, staticSession, {
				prune: pruneCss,
				requiredClasses: currentRequiredClasses(),
				outputs: staticSession.writtenOutputs,
				bundle,
				sourcemap
			});
		} finally {
			lost = staticSession.prunedClasses;
			staticSession.prunedClasses = committed;
		}
		for (const sheet of finalized) for (const slot of liveOutputSlotsByEnvironment.get(sheet.environment)?.values() ?? []) slot.prunedClasses = new Set(lost);
		rebuildLivePrunedClasses();
		for (const sheet of finalized) {
			if (!sheet.renamed) continue;
			_bamboocss_logger.logger.info("vite", `Pruned ${sheet.originalFileName} against every environment once the last had written, which restored a rule the earlier prune removed: ${sheet.before} → ${sheet.after} bytes, now ${sheet.renamed}.`);
		}
	};
	const observeEnvironmentBuildStart = (environment) => {
		const serial = (nextBuildSerialByEnvironment.get(environment) ?? 0) + 1;
		nextBuildSerialByEnvironment.set(environment, serial);
		observedBuildSerialByEnvironment.set(environment, serial);
	};
	/** Open a replacement without discarding the generation a failed rebuild can fall back to. */
	const beginEnvironmentGeneration = (environment) => {
		preparedGenerations.delete(environment);
		const state = newEnvironmentState();
		const observedSerial = observedBuildSerialByEnvironment.get(environment);
		const buildSerial = observedSerial ?? (nextBuildSerialByEnvironment.get(environment) ?? 0) + 1;
		if (observedSerial === void 0) nextBuildSerialByEnvironment.set(environment, buildSerial);
		else observedBuildSerialByEnvironment.delete(environment);
		buildSerialByState.set(state, buildSerial);
		transformStateByEnvironment.set(environment, state);
		staticSession.participatingEnvironments.add(environment);
		if (liveOutputSlotsByEnvironment.get(environment)?.size) staticSession.completedEnvironments.add(environment);
		else staticSession.completedEnvironments.delete(environment);
		rebuildStaticTransformContributions();
		return state;
	};
	/** Collapse an environment to a generation which replaced all of its observable outputs. */
	const completeEnvironmentGeneration = (environment, state) => {
		if (transformStateByEnvironment.get(environment) !== state) return;
		const epoch = createTransformEpoch(state);
		liveOutputSlotsByEnvironment.set(environment, new Map([[DIRECT_OUTPUT_TOKEN, { epoch }]]));
		staticSession.completedEnvironments.add(environment);
		rebuildStaticTransformContributions();
		rebuildLivePrunedClasses();
	};
	const prepareEnvironmentGeneration = (environment, state) => {
		if (transformStateByEnvironment.get(environment) !== state) return;
		preparedGenerations.set(environment, {
			state,
			epoch: createTransformEpoch(state),
			buildSerial: buildSerialByState.get(state) ?? 0,
			outputTokens: new Set(outputTokensByEnvironment.get(environment) ?? []),
			stagedOutputs: /* @__PURE__ */ new Map()
		});
		rebuildStaticTransformContributions();
	};
	const sameTokens = (left, right) => left.size === right.size && [...left].every((token) => right.has(token));
	/** The first configured output is an observable boundary even when its later hooks throw. */
	const beginOutputCycle = (environment, outputSlot) => {
		const previousSlot = lastStartedOutputSlotByEnvironment.get(environment);
		if (outputSlot === 0 || previousSlot !== void 0 && outputSlot <= previousSlot) pendingOutputCycles.delete(environment);
		lastStartedOutputSlotByEnvironment.set(environment, outputSlot);
	};
	const completeOutputCycle = (environment, cycle) => {
		liveOutputSlotsByEnvironment.set(environment, new Map(cycle.candidatesBySlot));
		pendingOutputCycles.delete(environment);
		preparedGenerations.delete(environment);
		staticSession.completedEnvironments.add(environment);
		rebuildStaticTransformContributions();
		rebuildLivePrunedClasses();
	};
	const publishPreparedOutput = (environment, outputToken, outputSlot, wasWritten) => {
		const generation = preparedGenerations.get(environment);
		if (!generation || transformStateByEnvironment.get(environment) !== generation.state) return;
		if (!generation.outputTokens.has(outputToken)) return;
		const mode = wasWritten ? "write" : "memory";
		let cycle = pendingOutputCycles.get(environment);
		const serialContinues = cycle !== void 0 && outputSlot > cycle.lastOutputSlot && (generation.buildSerial === cycle.lastBuildSerial || generation.buildSerial === cycle.lastBuildSerial + (outputSlot - cycle.lastOutputSlot));
		if (!cycle || cycle.mode !== mode || !sameTokens(cycle.expectedTokens, generation.outputTokens) || cycle.successfulTokens.has(outputToken) || !serialContinues) {
			cycle = {
				expectedTokens: new Set(generation.outputTokens),
				successfulTokens: /* @__PURE__ */ new Set(),
				candidatesBySlot: /* @__PURE__ */ new Map(),
				lastBuildSerial: generation.buildSerial,
				lastOutputSlot: outputSlot,
				mode
			};
			pendingOutputCycles.set(environment, cycle);
		}
		const stage = generation.stagedOutputs.get(outputToken);
		const candidateSlot = {
			epoch: generation.epoch,
			...stage?.prunedClasses ? { prunedClasses: new Set(stage.prunedClasses) } : {}
		};
		cycle.successfulTokens.add(outputToken);
		cycle.candidatesBySlot.set(outputSlot, candidateSlot);
		cycle.lastBuildSerial = generation.buildSerial;
		cycle.lastOutputSlot = outputSlot;
		const allOutputsSucceeded = cycle.successfulTokens.size === cycle.expectedTokens.size;
		if (wasWritten) {
			const slots = liveOutputSlotsByEnvironment.get(environment) ?? /* @__PURE__ */ new Map();
			slots.set(outputSlot, candidateSlot);
			liveOutputSlotsByEnvironment.set(environment, slots);
			staticSession.completedEnvironments.add(environment);
			rebuildStaticTransformContributions();
			rebuildLivePrunedClasses();
		}
		if (!allOutputsSucceeded || !wasWritten) return;
		completeOutputCycle(environment, cycle);
	};
	const closePreparedMemoryOutputs = (environment) => {
		const cycle = pendingOutputCycles.get(environment);
		if (!cycle || cycle.mode !== "memory" || cycle.successfulTokens.size !== cycle.expectedTokens.size) return;
		completeOutputCycle(environment, cycle);
	};
	/** Restore the still-live output contribution when the replacement generation fails. */
	const rollbackEnvironmentGeneration = (environment, state) => {
		if (transformStateByEnvironment.get(environment) !== state) return;
		preparedGenerations.delete(environment);
		pendingOutputCycles.delete(environment);
		const slots = liveOutputSlotsByEnvironment.get(environment);
		const liveEpochs = /* @__PURE__ */ new Map();
		for (const { epoch } of slots?.values() ?? []) liveEpochs.set(epoch.id, epoch);
		const latestLive = [...liveEpochs.values()].sort((a, b) => a.id - b.id).at(-1);
		if (latestLive) {
			transformStateByEnvironment.set(environment, cloneEnvironmentState(latestLive.state));
			staticSession.completedEnvironments.add(environment);
		} else {
			transformStateByEnvironment.delete(environment);
			staticSession.completedEnvironments.delete(environment);
		}
		rebuildStaticTransformContributions();
		rebuildLivePrunedClasses();
	};
	staticSession.finalizeDeferred = ({ environment, bundle, sourcemap }) => finalizeDeferredSheetsIfComplete(environment, bundle, sourcemap);
	staticSession.classNamesOf = (environment, moduleId) => transformStateByEnvironment.get(environment)?.transformArtifactsByModule.get(moduleId)?.classNames;
	staticSession.beginOutputProjection = (environment, outputOptions, bundle, replacesGeneratedStylesheet) => {
		const generation = preparedGenerations.get(environment);
		if (!generation || transformStateByEnvironment.get(environment) !== generation.state) {
			const currentState = transformStateByEnvironment.get(environment);
			return {
				cssLoaded: currentState?.cssLoaded ?? staticSession.cssLoaded,
				requiredClasses: requiredClassesForProjection(environment, currentState ? ownedClassesForState(currentState) : currentRequiredClasses()),
				restore() {}
			};
		}
		const committedPrunedClasses = staticSession.prunedClasses;
		staticSession.prunedClasses = new Set(committedPrunedClasses);
		rebuildStaticTransformContributions(environment, generation.epoch.state);
		const requiredClasses = requiredClassesForProjection(environment, generation.epoch.ownedClasses);
		if (replacesGeneratedStylesheet) staticSession.prunedClasses.clear();
		let restored = false;
		return {
			cssLoaded: generation.epoch.state.cssLoaded,
			requiredClasses,
			restore() {
				if (restored) return;
				restored = true;
				const previous = outputStageByBundle.get(bundle) ?? outputStageByOptions.get(outputOptions);
				const stage = replacesGeneratedStylesheet ? {
					cssDigest: bambooCssDigest(bundle),
					prunedClasses: new Set([...previous?.prunedClasses ?? [], ...staticSession.prunedClasses])
				} : previous ? {
					cssDigest: bambooCssDigest(bundle),
					prunedClasses: new Set(previous.prunedClasses ?? [])
				} : {};
				outputStageByBundle.set(bundle, stage);
				outputStageByOptions.set(outputOptions, stage);
				staticSession.prunedClasses = committedPrunedClasses;
				rebuildStaticTransformContributions();
			}
		};
	};
	/** Aggregate environment-owned coverage once the participating generation is complete. */
	const reportTransformCoverage = (states) => {
		const perFile = /* @__PURE__ */ new Map();
		const reportedCoverageByModule = /* @__PURE__ */ new Map();
		for (const state of states) for (const artifact of state.transformArtifactsByModule.values()) {
			const coverageKey = JSON.stringify([
				artifact.file,
				artifact.folded,
				artifact.skipped
			]);
			const reported = reportedCoverageByModule.get(artifact.moduleId);
			if (reported?.has(coverageKey)) continue;
			if (reported) reported.add(coverageKey);
			else reportedCoverageByModule.set(artifact.moduleId, new Set([coverageKey]));
			const entry = perFile.get(artifact.file) ?? {
				folded: 0,
				skipped: /* @__PURE__ */ new Map()
			};
			entry.folded += artifact.folded;
			for (const [reason, count] of artifact.skipped) entry.skipped.set(reason, (entry.skipped.get(reason) ?? 0) + count);
			perFile.set(artifact.file, entry);
		}
		let folded = 0;
		let filesWithFolds = 0;
		const skipped = /* @__PURE__ */ new Map();
		for (const entry of perFile.values()) {
			folded += entry.folded;
			if (entry.folded) filesWithFolds++;
			for (const [reason, count] of entry.skipped) skipped.set(reason, (skipped.get(reason) ?? 0) + count);
		}
		const declined = Array.from(skipped.values()).reduce((sum, count) => sum + count, 0);
		const total = folded + declined;
		if (!total) return;
		const share = Math.round(folded / total * 100);
		const reasons = Array.from(skipped.entries()).sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${reason}=${count}`).join(" ");
		_bamboocss_logger.logger.info("vite:transform", `Compiled ${folded}/${total} (${share}%) across ${filesWithFolds}/${perFile.size} files` + (reasons ? ` — declined: ${reasons}` : ""));
	};
	/** Apply every per-build fact established by one trusted or validated transform artifact. */
	const commitTransformArtifact = (state, artifact) => {
		const { file, moduleId } = artifact;
		replaceTransformArtifact(state, artifact);
		recordFoldDependencies(state, moduleId, file, artifact.dependencies);
		if (artifact.signature) state.foldSignatures.set(moduleId, artifact.signature);
		else {
			state.foldSignatures.delete(moduleId);
			state.foldInputsByModule.delete(moduleId);
		}
	};
	/** Snapshot and authenticate transform metadata owned by Rollup's external cache. */
	const applyCachedTransformArtifact = (state, value, expectedModuleId, environment) => {
		let snapshot;
		try {
			snapshot = structuredClone(value);
		} catch {
			throw cachedArtifactError(expectedModuleId, environment, void 0, `could not be snapshotted as serializable schema version ${TRANSFORM_ARTIFACT_VERSION} data`);
		}
		if (!isTransformArtifact(snapshot) || snapshot.moduleId !== expectedModuleId || snapshot.file !== expectedModuleId.split("?")[0] || !hasValidTransformArtifactIntegrity(environment, snapshot)) throw cachedArtifactError(expectedModuleId, environment, snapshot);
		commitTransformArtifact(state, snapshot);
	};
	/**
	* Replay transform metadata for modules Rollup reused from its cache.
	*
	* `buildStart` has to clear reachability because a watch rebuild may have a different graph,
	* but Rollup does not call `transform` again for an unchanged module. The transform result is
	* still present on that module as serializable metadata, and `buildEnd` is the common Rollup
	* and Rolldown point where the complete graph can be enumerated while CSS generation is still
	* ahead of us. Replaying here restores the exact state pruning and the finished-build guards
	* would have observed after a clean build.
	*
	* Freshly transformed module IDs are skipped inside this environment only. Besides avoiding
	* duplicate work, that makes a failed transform authoritative: an older cached artifact must
	* not overwrite the diagnostic and signature retraction established by the failing pass.
	*/
	const replayCachedTransformArtifacts = (pluginContext) => {
		if (!pluginContext.getModuleIds || !pluginContext.getModuleInfo) return;
		const state = environmentState(pluginContext);
		for (const id of pluginContext.getModuleIds()) {
			if (state.transformedModulesThisRun.has(id)) continue;
			const meta = pluginContext.getModuleInfo(id)?.meta;
			if (!meta || !Object.prototype.hasOwnProperty.call(meta, TRANSFORM_META_KEY)) continue;
			const artifact = meta[TRANSFORM_META_KEY];
			applyCachedTransformArtifact(state, artifact, id, environmentName(pluginContext));
		}
	};
	/**
	* How many dependents in a row may come back changed before the check gives up for this event.
	*
	* The check costs a re-fold — ~0.2 ms per dependent measured on a twenty-consumer fan-out — and
	* it is paid on the awaited path, before Vite is told anything. That is linear in the number of
	* consumers and does not bound itself: a shared module with three hundred of them adds ~59 ms to
	* every edit, including the edits where nothing *can* be suppressed because the change moved the
	* recipe base and every consumer really did recompile.
	*
	* The trade is worth it whenever anything is suppressible. Measured on the same fan-out, a
	* suppressed consumer saves ~2.3 ms of re-transform for the ~0.23 ms its check costs, so the
	* check pays for itself at about one consumer in ten. What does not pay is the case where the
	* answer is going to be "changed" for all of them, and that case announces itself: a run of
	* consumers that all came back changed. Stopping after eight bounds it. On a three-hundred
	* consumer fan-out, an edit to the recipe base — where nothing can be suppressed — costs 3.6 ms
	* here rather than the 59 ms checking every one of them would, stacked onto an edit already
	* spending 600 ms re-transforming. A single unchanged consumer resets the run, so the same
	* fan-out editing a value no fold reads still checks all three hundred: 49 ms spent against
	* 520 ms of re-transform not done, and a 715 ms edit reduced to 183 ms.
	*
	* Giving up is always the safe direction — an unchecked dependent is treated as changed, which
	* is what this path did before any of this existed — so the bound can only cost the
	* optimisation, never correctness. It costs it where the optimisation was worth least: for the
	* run to reach eight, the consumers seen so far have to be uniformly changed.
	*/
	const CHANGED_RUN_LIMIT = 8;
	/**
	* Whether re-folding `dependent` now produces exactly the bytes it produced last time.
	*
	* Only the fold can answer that. The consumer's own source has not changed, so whether its
	* compiled output moves depends entirely on what the edited module resolves to *this* time,
	* and there is no cheaper way to learn that than to resolve it. Doing it here rather than
	* waiting for the re-transform is the whole point: the decision is needed before the update is
	* announced, and for a consumer that turns out to be unchanged this fold *replaces* the
	* re-transform rather than adding to it.
	*
	* Conservative in every failure — no recorded signature, a file that will not read, a parse
	* that returns nothing, a fold that throws — because "changed" is what this path did before,
	* and a wrong "unchanged" is a stale class string in the browser.
	*/
	const foldOutputUnchanged = (state, dependent) => {
		const memoized = state.unchangedFolds.get(dependent);
		if (memoized !== void 0) return memoized;
		if (host.isCssPassActive()) return false;
		if (!compilerStateIsCurrent()) return false;
		const unchanged = state.changedRun < CHANGED_RUN_LIMIT && refoldMatchesSignature(state, dependent);
		state.changedRun = unchanged ? 0 : state.changedRun + 1;
		state.unchangedFolds.set(dependent, unchanged);
		return unchanged;
	};
	const refoldMatchesSignature = (state, dependent) => {
		const signature = state.foldSignatures.get(dependent);
		if (!signature || !ctx || !foldSourceImpl || !styleCompiler) return false;
		try {
			const retained = state.foldInputsByModule.get(dependent);
			const code = retained?.input === signature.input ? retained.code : (0, node_fs.readFileSync)(signature.path, "utf8");
			const parsePath = retained?.input === signature.input ? retained.parsePath : signature.path;
			const inputDigest = digest(code);
			if (inputDigest !== signature.input) return false;
			const memoKey = foldMemoKey(parsePath, inputDigest);
			let result = foldMemoByContent.get(memoKey)?.result;
			if (!result) {
				result = compileWith(code, parsePath, false);
				foldMemoByContent.set(memoKey, {
					result,
					reportedSurvivors: false
				});
			}
			const unchanged = digest(result.code) === signature.output;
			/**
			* Edges re-recorded exactly on the way to suppressing a module. A changed provisional
			* fold may add newly observed edges, but never retracts the last recoverable ones.
			*
			* The first is necessary: *which* files a module folds from can move while the bytes it
			* emits do not — a value now re-exported through a different module, say — and suppressing
			* the announcement means no transform will run to notice. Leaving the old edges would make
			* the next edit to the new dependency reach nobody.
			*
			* A changed result is only a provisional check on the way to a real transform, which
			* records the exact answer. If that pass throws, the additive update has kept every old
			* edge while also making a fix in a newly observed dependency able to retry it.
			*/
			if (unchanged) recordFoldDependencies(state, dependent, signature.path, result.dependencies);
			else recordFoldDependencies(state, dependent, signature.path, [...state.dependenciesByModule.get(dependent) ?? [], ...result.dependencies]);
			return unchanged;
		} catch {
			return false;
		}
	};
	/**
	* Modules to re-transform because `file` changed, hard-invalidated on the way out.
	*
	* Invalidating is the fix. It drops the stale compiled result, which is the defect itself,
	* and it has to happen here rather than being left to `updateModules`: Vite *soft*-
	* invalidates an importer that statically imports the changed module, and a soft invalidation
	* keeps the cached transform — the very place the compiled class string lives.
	*
	* Doing it here also survives another plugin filtering the list afterwards — a framework's
	* own `hotUpdate` decides what its route modules do, and the stale bytes have to go either
	* way.
	*
	* *Naming* those modules back to Vite is a different question, and the answer is almost
	* always no. `addWatchFile` makes every consumer a direct importer of the dependency in the
	* module graph, so `propagateUpdate` walks to all of them from the changed file by itself and
	* sends exactly the same update. Returning them as well does not merge into that pass: a
	* framework plugin downstream reads the list and re-drives HMR per entry — react-router's
	* `react-router-server-change-trigger-client-hmr` calls `reloadModule` once per module, in
	* both its client and its ssr pass — and each of those is a separate `updateModules`, a
	* separate `hmr update`, and a separate refetch of the whole module by the browser.
	*
	* Measured on a five-route react-router app, one `css()` edit in a shared `ui.ts`: eight
	* `hmr update` messages, `root.tsx` and `dashboard.tsx` fetched five times each, 554 kB over
	* the socket for a one-line edit. Dropping the redundant half takes it to four messages and
	* 367 kB with the same modules re-transformed and the same edit applied.
	*
	* So the list is returned only when Vite has matched nothing for the file and would otherwise
	* do nothing at all — a dependency the fold read that never became a module of its own. That
	* one can end in a page reload, which is the honest outcome: its compiled classes really did
	* change, and a reload is what Vite does with any update nothing accepts.
	*/
	const foldDependentModules = (state, file, modules, graph, verify = true) => {
		const dependents = state.dependentsByDependency.get(normalizeFsPath(file));
		if (!dependents?.size) return;
		const added = [];
		for (const dependent of [...dependents]) {
			/**
			* A consumer whose compiled bytes this edit does not move is left entirely alone.
			*
			* Announcing one tells the browser to refetch a module it already has verbatim: a round
			* trip, and behind it — in a framework that re-drives HMR per entry, as react-router does
			* with `reloadModule` in both its client and its ssr pass — a router revalidation.
			*
			* Skipping the *invalidation* follows from the same fact, and is where the cost actually
			* sits. Vite only soft-invalidates a module that statically imports the changed one, which
			* keeps its cached transform result and re-serves it for the price of rewriting import
			* timestamps; hard-invalidating turns that into a full re-transform through every plugin
			* in the chain. On a fan-out of twenty consumers of one shared module, editing a runtime
			* value no fold reads took the transforms Bamboo runs for that edit from 22 to 2.
			*
			* How much that is worth depends on whether the consumer's import statement *survives* the
			* fold. When it imports nothing from the module but the value being folded, the binding
			* goes dead, esbuild drops the statement, and the only edge left is the non-static one
			* `addWatchFile` created — which Vite hard-invalidates by itself, so declining to here
			* saves nothing and the re-fold is pure cost. Import one more thing from the same module,
			* which is the shape a real shared `ui.ts` has, and the statement stays, the consumer is a
			* static importer, and Bamboo's invalidation is the only reason it re-transforms at all.
			*
			* Safe by what "identical" means. The invalidation exists to drop a compiled class string
			* that no longer matches the source it was compiled from; when recompiling produces the
			* same string, there is nothing stale to drop. Whichever way the module is reached next —
			* Vite's own propagation, a later request, or nothing at all — the bytes it yields are the
			* bytes this fold just computed.
			*
			* Nor can it mask an update Vite would have sent by itself. This only ever withholds a
			* name Bamboo added; `modules` is passed through untouched. A consumer that also *imports*
			* the edited module for a runtime value is still reached by `propagateUpdate` exactly as
			* it would be with no plugin here at all — that direction was never this list's to decide.
			*/
			if (verify && foldOutputUnchanged(state, dependent)) continue;
			const exact = graph.getModuleById?.(dependent);
			const dependentFile = state.filesByModule.get(dependent) ?? dependent;
			const candidates = exact ? [exact] : graph.getModulesByFile(normalizeFsPath(dependentFile)) ?? [];
			for (const module of candidates) {
				if (modules.includes(module) || added.includes(module)) continue;
				graph.invalidateModule(module);
				added.push(module);
			}
		}
		if (!added.length) return;
		/**
		* Gated on whether Vite's own pass will actually *reach* these modules, not merely on whether
		* it has something to propagate from.
		*
		* `propagateUpdate` stops at the first self-accepting module and never walks its importers.
		* So when every module Vite matched for the changed file accepts itself — which is what React
		* Fast Refresh makes of any file exporting a component — the consumers that folded a value out
		* of it are hard-invalidated here and then never announced to anybody. The browser keeps
		* running the module it already has, with the class string compiled from the *previous*
		* contents, until something else forces a reload. Editing a component that a sibling folds
		* from is the ordinary way to meet that.
		*
		* A module that does not accept itself does propagate outward, and `addWatchFile` has made
		* each consumer a direct importer, so Vite sends the same update by itself; naming them again
		* is the duplication measured in the doc comment above. Hence `some` rather than `length`:
		* one non-self-accepting module is enough for the walk to arrive. An empty list keeps its old
		* meaning — nothing to duplicate, so this is the only announcement there will be.
		*/
		if (modules.some((module) => !module.isSelfAccepting)) return;
		return [...modules, ...added];
	};
	let ctx;
	let foldSourceImpl;
	let resolveTsPathImpl;
	let styleCompiler;
	let command = "build";
	let defaultEmitAssets = true;
	let exitWarningInstalled = false;
	/** Which context the published derivations below were built from. */
	let derivedGeneration = -1;
	/**
	* Whether the compiler state below still describes the context the host is on.
	*
	* Only `ensureCompilerState` re-derives, and only an awaited hook may call it — so the two
	* synchronous entry points, the speculative prefold and the unchanged-dependent check, can
	* be reached after a stylesheet pass has published a config reload they have not seen. Both
	* decline rather than fold against a style compiler from the previous config.
	*/
	const compilerStateIsCurrent = () => {
		const current = host.current();
		return current !== void 0 && current.id === derivedGeneration;
	};
	const ensureContext = async () => {
		ctx = (await host.ensureGeneration()).context;
	};
	/**
	* Load the fold chunk and derive everything that depends on the resolved context.
	*
	* Keyed on context *identity* rather than derived once. `Builder.setup` replaces its context
	* on a config reload, and the style-set compiler is a closure over the previous one — a stale
	* one names classes from the old config while the stylesheet is emitted from the new one,
	* and nothing downstream can see the difference.
	*
	* Published as a set, and only once every part of the attempt has succeeded, so a failed
	* chunk load leaves no half-compiler visible to HMR.
	*/
	const ensureCompilerState = async () => {
		const [initialGeneration, fold] = await Promise.all([host.ensureGeneration(), loadFoldModule()]);
		const currentGeneration = await host.ensureGeneration();
		const generation = currentGeneration.id === initialGeneration.id ? initialGeneration : currentGeneration;
		if (derivedGeneration === generation.id && foldSourceImpl) {
			ctx = generation.context;
			return;
		}
		const derivedStyleCompiler = fold.createStaticStyleSetCompiler(generation.context, fold.createRuntimeCss(generation.context));
		ctx = generation.context;
		foldSourceImpl = fold.foldSource;
		resolveTsPathImpl = fold.resolveTsPathPattern;
		styleCompiler = derivedStyleCompiler;
		derivedGeneration = generation.id;
	};
	/**
	* Compile one module's text.
	*
	* The text is the bundler's: after every `enforce: 'pre'` plugin and Vite's own load. Every
	* *other* module a value is resolved through is read the way extraction reads it, so the
	* compiler and the stylesheet never disagree about a dependency. Nothing is installed
	* anywhere — the analysis is a pure function of these bytes and the project's files, which
	* is what lets a transform of a rewritten module run without displacing the checkout.
	*/
	const compileWith = (code, parsePath, reportSurvivors) => {
		if (!ctx || !foldSourceImpl || !styleCompiler) throw new Error("bamboo: the compiler is not initialized");
		if (parsePath.includes(".__bamboo__.")) ctx.project.overlaySource(parsePath, code);
		const [analysis] = ctx.compileModules([{
			filename: parsePath,
			source: code
		}], { references: reportSurvivors });
		if (!analysis) throw new Error(`bamboo: no analysis for ${parsePath}`);
		if (analysis.errors.length && analysis.calls.length === 0 && analysis.imports.length === 0) throw new Error(`bamboo: could not parse ${parsePath}:\n${analysis.errors.join("\n")}`);
		const result = foldSourceImpl({
			ctx,
			code,
			analysis,
			filePath: parsePath,
			styleCompiler,
			maxRecipeStates,
			reportSurvivors
		});
		const dependencies = result.dependencies.filter((dependency) => !isGeneratedOutput(dependency, ctx));
		return dependencies.length === result.dependencies.length ? result : {
			...result,
			dependencies
		};
	};
	const outputFinalizerTag = (value) => {
		if (!value || typeof value !== "object") return void 0;
		return value[OUTPUT_FINALIZER];
	};
	const outputStartMarkerTag = (value) => {
		if (!value || typeof value !== "object") return void 0;
		return value[OUTPUT_START_MARKER];
	};
	const findOutputFinalizer = (value, environment, outputSlot) => {
		if (Array.isArray(value)) {
			for (const entry of value) {
				const found = findOutputFinalizer(entry, environment, outputSlot);
				if (found) return found;
			}
			return;
		}
		const identity = outputFinalizerTag(value);
		return identity?.environment === environment && identity.outputSlot === outputSlot ? value : void 0;
	};
	const findOutputStartMarker = (value, environment, outputSlot) => {
		if (Array.isArray(value)) {
			for (const entry of value) {
				const found = findOutputStartMarker(entry, environment, outputSlot);
				if (found) return found;
			}
			return;
		}
		const identity = outputStartMarkerTag(value);
		return identity?.environment === environment && identity.outputSlot === outputSlot ? value : void 0;
	};
	const stripOutputLifecyclePlugins = (value) => {
		if (Array.isArray(value)) return value.flatMap(stripOutputLifecyclePlugins);
		return value == null || outputFinalizerTag(value) || outputStartMarkerTag(value) ? [] : [value];
	};
	const createOutputStartMarker = (environment, outputSlot) => {
		return Object.assign({
			name: `bamboocss:output-start:${environment}:${outputSlot}`,
			renderStart: {
				order: "pre",
				sequential: true,
				handler() {
					beginOutputCycle(environment, outputSlot);
				}
			}
		}, { [OUTPUT_START_MARKER]: {
			environment,
			outputSlot
		} });
	};
	const createOutputFinalizer = (environment, outputSlot) => {
		const outputToken = ++nextOutputToken;
		return Object.assign({
			name: `bamboocss:output-finalizer:${environment}:${outputSlot}`,
			generateBundle: {
				order: "post",
				handler(outputOptions, bundle, isWrite) {
					if (!bundle || typeof bundle !== "object") return;
					const identity = {
						environment,
						outputSlot,
						outputToken
					};
					outputIdentityByBundle.set(bundle, identity);
					if (outputOptions && typeof outputOptions === "object") outputIdentityByOptions.set(outputOptions, identity);
					const generation = preparedGenerations.get(environment);
					const stage = outputStageByBundle.get(bundle) ?? (outputOptions && typeof outputOptions === "object" ? outputStageByOptions.get(outputOptions) : void 0);
					if (stage?.cssDigest && bambooCssDigest(bundle) !== stage.cssDigest) throw new Error("bamboocss: an output plugin changed or removed the generated stylesheet after Bamboo finalized its reachability. The cached prune history would no longer describe the emitted CSS. Preserve the Bamboo asset in later `generateBundle` hooks, or run that transformation before Bamboo.");
					if (generation && stage) generation.stagedOutputs.set(outputToken, stage);
					if (!isWrite) publishPreparedOutput(environment, outputToken, outputSlot, false);
				}
			}
		}, { [OUTPUT_FINALIZER]: {
			environment,
			outputSlot,
			outputToken
		} });
	};
	const installOutputFinalizers = (inputOptions, environment) => {
		if (!inputOptions.output) {
			outputTokensByEnvironment.delete(environment);
			return;
		}
		const outputs = Array.isArray(inputOptions.output) ? inputOptions.output : [inputOptions.output];
		const outputTokens = /* @__PURE__ */ new Set();
		const installed = outputs.map((output, outputSlot) => {
			const existing = findOutputFinalizer(output.plugins, environment, outputSlot);
			const existingStart = findOutputStartMarker(output.plugins, environment, outputSlot);
			if (existing && existingStart) {
				outputTokens.add(existing[OUTPUT_FINALIZER].outputToken);
				return output;
			}
			const finalizer = existing ?? createOutputFinalizer(environment, outputSlot);
			const startMarker = existingStart ?? createOutputStartMarker(environment, outputSlot);
			outputTokens.add(finalizer[OUTPUT_FINALIZER].outputToken);
			output.plugins = [
				startMarker,
				...stripOutputLifecyclePlugins(output.plugins),
				finalizer
			];
			return output;
		});
		inputOptions.output = Array.isArray(inputOptions.output) ? installed : installed[0];
		outputTokensByEnvironment.set(environment, outputTokens);
	};
	const compiler = {
		name: "bamboocss:compiler",
		enforce: "pre",
		/** See the same declaration on the css plugin: one instance per build, not per environment. */
		sharedDuringBuild: true,
		options(inputOptions) {
			installOutputFinalizers(inputOptions, environmentName(this));
			return inputOptions;
		},
		configResolved(config) {
			command = config.command;
			host.setCommand(config.command);
			defaultEmitAssets = config.build?.emitAssets ?? (!config.build?.ssr || config.build?.ssrEmitAssets === true);
			if (config.command === "build" && !exitWarningInstalled) {
				exitWarningInstalled = true;
				process.once("beforeExit", () => {
					if (!staticSession.deferredSheets.length) return;
					_bamboocss_logger.logger.warn("vite", `The stylesheet was pruned against an incomplete run: ${(0, _bamboocss_shared.truncateList)(remainingEnvironments(staticSession), {
						unit: "environment",
						separator: ", "
					})} never completed, so a rule only those reach was never restored. Build every declared environment, or set \`bamboocss({ pruneCss: false })\` to ship the full extracted stylesheet.`);
				});
			}
			const plugins = config.plugins;
			if (plugins) {
				for (const finalizer of [outputWriteObserver, memoryOutputCommitter]) {
					const index = plugins.indexOf(finalizer);
					if (index !== -1) plugins.splice(index, 1);
				}
				plugins.unshift(outputWriteObserver);
				plugins.push(memoryOutputCommitter);
			}
		},
		async buildStart() {
			const environment = environmentName(this);
			const state = beginEnvironmentGeneration(environment);
			try {
				await ensureContext();
			} catch (error) {
				rollbackEnvironmentGeneration(environment, state);
				throw asError(error, "failed to load the bamboo config");
			}
		},
		/**
		* Take a changed module out of the parser's hands before the rebuild reads it.
		*
		* `addWatchFile` below registers the modules a fold read, so editing one re-transforms
		* its consumers. That is only half of it. The consumer is transformed *before* the
		* module it imports — that is how a bundler discovers imports at all — so by the time
		* the changed module's own `transform` refreshes it in the ts-morph project, the fold
		* that reads it has already run against the previous contents and baked a stale class
		* into the bundle. Rollup calls this hook before any of that, which is the only point
		* where refreshing is early enough.
		*
		* Both entry points clear the box-node cache, which is the part that matters: a
		* resolution memoized against the old contents outlives the file itself.
		*
		* A created file is handled as an edit. `reloadSourceFile` cannot re-read one the
		* parser has never held, and does not need to — it clears the cache, and the extractor
		* adds a newly-reachable module from disk on next use. What the shared path *is* needed
		* for is an editor's atomic save, which arrives as a delete followed by a create while
		* the parser still holds the file.
		*/
		watchChange(id, change) {
			foldMemoByContent.clear();
			for (const state of transformStateByEnvironment.values()) {
				state.unchangedFolds.clear();
				state.changedRun = 0;
			}
			const [filePath] = id.split("?");
			if (!filePath) return;
			if (change.event === "update") host.noteSourceChange(filePath, change.event);
			if (!ctx) return;
			if (!shouldTransform(id)) return;
			if (change.event === "delete") {
				host.removeSource(filePath);
				for (const extension of ["ts", "tsx"]) ctx.project.removeOverlay(`${filePath}.__bamboo__.${extension}`);
				const deleted = normalizeFsPath(filePath);
				for (const state of transformStateByEnvironment.values()) for (const [moduleId, moduleFile] of [...state.filesByModule]) {
					if (normalizeFsPath(moduleFile) !== deleted) continue;
					recordFoldDependencies(state, moduleId, moduleFile, []);
					state.foldSignatures.delete(moduleId);
					state.foldInputsByModule.delete(moduleId);
					deleteTransformArtifact(state, moduleId);
					state.filesByModule.delete(moduleId);
				}
				return;
			}
			if (SFC_EXTENSIONS.test(filePath)) return;
			host.reloadSource(filePath);
			/**
			* Fold the edited file before the browser asks for it.
			*
			* The first transform after an edit is the one fold the memo cannot already hold — the
			* bytes are new — and it sits on the repaint path: the websocket round trip plus the
			* module refetch land ~15-30ms after this hook, and the fold costs ~5-13ms of that
			* budget on a route-sized module. Folding one macrotask later, after the update hooks
			* have run and the broadcast is out, has the memo hot before the request arrives.
			*
			* `setImmediate` is the load-bearing part: this hook is awaited before Vite announces
			* anything, so the work must not run inline. Content-keyed like every memo entry, so a
			* racing save cannot poison anything — the entry states what these exact bytes fold to,
			* and a later event's `watchChange` clears the memo before that event's transforms run.
			* Failures are swallowed here; the real transform runs the same fold and owns the
			* diagnostics.
			*/
			if (command === "serve") setImmediate(() => {
				if (!ctx || !foldSourceImpl || !styleCompiler) return;
				if (host.isCssPassActive() || !compilerStateIsCurrent()) return;
				try {
					const code = (0, node_fs.readFileSync)(filePath, "utf8");
					const memoKey = foldMemoKey(filePath, digest(code));
					if (foldMemoByContent.has(memoKey)) return;
					foldMemoByContent.set(memoKey, {
						result: compileWith(code, filePath, true),
						reportedSurvivors: true
					});
				} catch {}
			});
		},
		/**
		* Re-transform whatever folded a value out of the file that just changed.
		*
		* Dev only — `hotUpdate` does not run in a build, where Rollup's own invalidation already
		* covers this — and additive: the modules Vite matched are returned alongside, so this
		* decides nothing about them.
		*
		* `handleHotUpdate` below stands in on Vite 5, which has no `hotUpdate`. Not quite the
		* same thing: Vite 5 calls that hook for an update and not for a file appearing or being
		* deleted, so a recipe file *created* while the server runs leaves its consumers stale
		* there. Vite 6 and up call `hotUpdate` for all three, and never call `handleHotUpdate`
		* when a plugin has both — including its deprecation warning — so exactly one of the two
		* runs on any supported version.
		*
		* `environment` optional-chained for the same reason `addWatchFile` is in `transform`:
		* a harness driving the hook need not supply a full plugin context, and a `TypeError`
		* here is swallowed into an HMR error payload that a middleware-mode server sends
		* nowhere.
		*/
		hotUpdate({ file, modules }) {
			const graph = this.environment?.moduleGraph;
			if (!graph) return;
			/**
			* The provisional re-folds exist to spare the *browser*: an announced client module is a
			* refetch round trip, and behind a framework that re-drives HMR per entry, a router
			* revalidation — that is what deciding "unchanged" before Vite is told anything buys.
			*
			* A server graph has none of that economy. Its modules are re-transformed by this same
			* process the next time something renders, nothing is announced by invalidating quietly,
			* and the verification runs on the awaited path *before* the client's update can be
			* broadcast — on a react-router app, re-folding every SSR consumer of a shared style
			* module added ~15ms to each edit's repaint for work whose only reader was the next
			* `.data` revalidation. Invalidate outright there and let the next render pay lazily,
			* off the repaint path. `verify` stays on when the consumer kind is unknown — a harness
			* without environment config keeps the conservative shape.
			*/
			const consumer = this.environment?.config?.consumer;
			return foldDependentModules(environmentState(this), file, modules, graph, consumer !== "server");
		},
		handleHotUpdate({ file, modules, server }) {
			const legacy = server;
			if (legacy.environments) return;
			return foldDependentModules(environmentState(this), file, modules, legacy.moduleGraph);
		},
		async transform(code, id) {
			return compileModule.call(this, code, id, false);
		},
		buildEnd(buildError) {
			const environment = environmentName(this);
			const state = environmentState(this);
			if (buildError) {
				rollbackEnvironmentGeneration(environment, state);
				return;
			}
			try {
				replayCachedTransformArtifacts(this);
				let currentWillEmitCss = false;
				if (typeof this.getModuleIds === "function") {
					state.cssLoaded = [...this.getModuleIds()].some((id) => id.split("?")[0] === `\0${VIRTUAL_CSS_ID}`);
					currentWillEmitCss = state.cssLoaded && (this.environment?.config?.build?.emitAssets ?? defaultEmitAssets);
				}
				const states = contributionStates(environment, state);
				rebuildStaticTransformContributions(environment, state);
				const survivors = allSurvivors(states);
				if (survivors.length) throw createSurvivorError(survivors);
				const lost = currentWillEmitCss || staticSession.deferredSheets.length ? [] : [...staticSession.usedClasses].filter((className) => staticSession.prunedClasses.has(require_class_name.bare(className)));
				if (lost.length) throw new Error(`bamboocss: ${lost.length} class(es) compiled in the ${JSON.stringify(environment)} environment were already pruned out of a stylesheet emitted by an earlier one. Elements carrying them would render unstyled.\n\n${(0, _bamboocss_shared.truncateList)(lost.map((className) => `  ${className}`), {
					unit: "class",
					separator: "\n"
				})}\n\nThe stylesheet was pruned before this environment compiled. A run that announces its environments — \`builder\` in the Vite config, which every framework building more than one sets — holds pruning back until the last one has written, so this is a run that built environments one at a time without saying so, or a rebuild of this environment alone after the sheet was finalized. These classes are reached only from here, so no rule for them survived.\n\nConfigure \`builder\` so the run announces its environments, rebuild every environment together, or set \`bamboocss({ pruneCss: false })\` to ship the whole extracted stylesheet.`);
				const remaining = remainingEnvironments(staticSession, environment);
				if (typeof this.getModuleInfo === "function" && !remaining.length) {
					if (!staticSession.cssLoaded) throw new Error(`bamboocss: compiled class values were produced, but ${JSON.stringify(VIRTUAL_CSS_ID)} was not imported. Add \`import ${JSON.stringify(VIRTUAL_CSS_ID)}\` once, from a JavaScript or TypeScript module in the application entry graph.\n\nIt has to be a JS import. \`@import\` from a stylesheet does not reach it: the id names a virtual module resolved by this plugin, and Vite resolves CSS \`@import\` before plugin resolution, so it fails as an unresolvable path. A project that ships one preloaded stylesheet imports this from its entry module instead, and lets Vite emit the CSS asset.`);
					const outsideExtraction = [...staticSession.transformedFiles].filter((file) => !staticSession.extractedFiles.has(file));
					if (outsideExtraction.length) throw new Error(`bamboocss: ${outsideExtraction.length} statically compiled module(s) are outside the CSS extraction graph:\n\n${(0, _bamboocss_shared.truncateList)(outsideExtraction.map((file) => `  ${file}`), {
						unit: "file",
						separator: "\n"
					})}\n\nAdd them to \`include\` in bamboo.config, or no CSS rule can back their emitted classes.`);
				}
				if (reportSummary && (command !== "build" || !remaining.length)) reportTransformCoverage(states);
				if (command === "serve" || !outputTokensByEnvironment.get(environment)?.size) completeEnvironmentGeneration(environment, state);
				else prepareEnvironmentGeneration(environment, state);
			} catch (error) {
				rollbackEnvironmentGeneration(environment, state);
				throw error;
			}
		},
		renderError() {
			const environment = environmentName(this);
			const state = transformStateByEnvironment.get(environment);
			if (state) rollbackEnvironmentGeneration(environment, state);
		}
	};
	const compilerSfc = {
		name: "bamboocss:compiler-sfc",
		enforce: "post",
		sharedDuringBuild: true,
		async transform(code, id) {
			return compileModule.call(this, code, id, true);
		}
	};
	async function compileModule(code, id, sfcOnly) {
		if (!shouldTransform(id)) return null;
		const [pathForFilter] = id.split("?");
		if (!pathForFilter) return null;
		if (SFC_EXTENSIONS.test(pathForFilter) !== sfcOnly) return null;
		try {
			await ensureCompilerState();
		} catch (error) {
			throw asError(error, "failed to initialize the bamboo compiler");
		}
		if (!ctx || !foldSourceImpl || !styleCompiler) return null;
		const [filePath] = id.split("?");
		if (isGeneratedOutput(filePath, ctx)) return null;
		if (!(host.isSourceFile(filePath) && ctx.project.getSourceText(filePath) === code) && !namesEntrypoint(ctx, code) && !importsSourceModule((path) => ctx.project.sourceIsOverridden(path) || host.isSourceFile(path) && (0, node_fs.existsSync)(path), (specifier) => {
			const mappings = ctx.conf.tsOptions?.pathMappings;
			return mappings ? resolveTsPathImpl?.(mappings, specifier) : void 0;
		}, filePath, code)) {
			_bamboocss_logger.logger.debug("vite:transform", `Skipped ${filePath}: ${host.isSourceFile(filePath) ? "rewritten before bamboo" : "outside `include`"}, and it reaches nothing bamboo`);
			return null;
		}
		const parsePath = compilerParsePath(id, code);
		if (parsePath === null) return null;
		const state = environmentState(this);
		state.transformedModulesThisRun.add(id);
		let inputDigest;
		let result;
		try {
			/**
			* Serialized against the stylesheet pass, which may be replacing the context this folds
			* against. Synchronous throughout, so waiting once at the top is sufficient.
			*/
			const compiled = await host.runCompilerWork(() => {
				if (!ctx || !foldSourceImpl || !styleCompiler) return null;
				const memoKey = command === "serve" ? foldMemoKey(parsePath, inputDigest ??= digest(code)) : void 0;
				const memoized = memoKey ? foldMemoByContent.get(memoKey) : void 0;
				if (memoized?.reportedSurvivors) return memoized.result;
				const folded = compileWith(code, parsePath, true);
				if (memoKey) foldMemoByContent.set(memoKey, {
					result: folded,
					reportedSurvivors: true
				});
				return folded;
			});
			if (!compiled) return null;
			result = compiled;
		} catch (error) {
			_bamboocss_logger.logger.caughtError("vite:transform", `Failed to compile ${filePath}`, error);
			commitTransformArtifact(state, {
				version: TRANSFORM_ARTIFACT_VERSION,
				moduleId: id,
				file: filePath,
				folded: 0,
				skipped: [["compile-failed", 1]],
				survivors: [{
					line: 1,
					name: "compiler",
					reason: "compile-failed"
				}],
				transformedFile: false,
				classNames: [],
				dependencies: [...state.dependenciesByModule.get(id) ?? []]
			});
			state.foldSignatures.delete(id);
			state.foldInputsByModule.delete(id);
			if (command === "serve") throw asError(error, `failed to compile ${filePath}`);
			return null;
		}
		const skippedHere = /* @__PURE__ */ new Map();
		for (const entry of result.skipped) skippedHere.set(entry.reason, (skippedHere.get(entry.reason) ?? 0) + 1);
		const survivorsHere = [];
		for (const entry of result.skipped) {
			if (entry.reason === "not-imported" || entry.reason === "overlapping") continue;
			if (entry.name === "cx" && (entry.reason === "dynamic" || entry.reason === "opaque-composition")) continue;
			survivorsHere.push({
				line: lineAt(code, entry.start),
				name: entry.name,
				reason: entry.reason
			});
		}
		const artifact = {
			version: TRANSFORM_ARTIFACT_VERSION,
			moduleId: id,
			file: filePath,
			folded: result.folded.length,
			skipped: [...skippedHere],
			survivors: survivorsHere,
			transformedFile: result.folded.some((entry) => entry.kind === "class" || entry.kind === "slots"),
			classNames: [...new Set(result.folded.flatMap((entry) => entry.classNames))],
			dependencies: [...result.dependencies],
			...result.dependencies.length ? { signature: {
				input: inputDigest ??= digest(code),
				output: digest(result.code),
				path: filePath
			} } : {}
		};
		commitTransformArtifact(state, artifact);
		if (artifact.signature && (command === "serve" || parsePath !== filePath)) state.foldInputsByModule.set(id, {
			code,
			input: artifact.signature.input,
			parsePath
		});
		else state.foldInputsByModule.delete(id);
		if (reportSkipped && result.skipped.length) _bamboocss_logger.logger.info("vite:transform", formatSkipped(filePath, result.skipped));
		for (const dependency of result.dependencies) this.addWatchFile?.(dependency);
		if (command === "serve" && artifact.survivors.length) {
			state.foldSignatures.delete(id);
			state.foldInputsByModule.delete(id);
			throw createSurvivorError(artifact.survivors.map((survivor) => ({
				file: filePath,
				...survivor
			})));
		}
		const meta = { [TRANSFORM_META_KEY]: sealTransformArtifact(environmentName(this), artifact) };
		if (!result.folded.length) return typeof this.getModuleInfo === "function" ? {
			code,
			map: null,
			meta
		} : null;
		_bamboocss_logger.logger.debug("vite:transform", `Compiled ${result.folded.length} call(s) in ${filePath}`);
		return {
			code: result.code,
			map: result.map,
			meta
		};
	}
	const outputWriteObserver = {
		name: "bamboocss:output-write-observer",
		enforce: "pre",
		sharedDuringBuild: true,
		buildStart: {
			order: "pre",
			sequential: true,
			handler() {
				observeEnvironmentBuildStart(environmentName(this));
			}
		},
		writeBundle: {
			order: "pre",
			sequential: true,
			async handler(outputOptions, bundle) {
				const environment = environmentName(this);
				const outputDir = outputOptions.dir ?? (outputOptions.file ? (0, node_path.dirname)(outputOptions.file) : void 0);
				if (outputDir) staticSession.writtenOutputs.push({
					environment,
					dir: (0, node_path.resolve)(outputDir),
					files: Object.values(bundle).map((output) => output.fileName)
				});
				const identity = outputIdentityByBundle.get(bundle) ?? outputIdentityByOptions.get(outputOptions);
				if (identity?.environment === environment) publishPreparedOutput(identity.environment, identity.outputToken, identity.outputSlot, true);
				await finalizeDeferredSheetsIfComplete();
			}
		}
	};
	const memoryOutputCommitter = {
		name: "bamboocss:output-memory-committer",
		enforce: "post",
		sharedDuringBuild: true,
		closeBundle: {
			order: "post",
			sequential: true,
			handler() {
				closePreparedMemoryOutputs(environmentName(this));
			}
		}
	};
	return [
		bamboocssCss({
			configPath,
			cwd,
			host,
			session: staticSession,
			pruneCss
		}),
		bamboocssCssEarly({
			session: staticSession,
			pruneCss
		}),
		compiler,
		compilerSfc
	];
};
//#endregion
exports.VIRTUAL_CSS_ID = VIRTUAL_CSS_ID;
exports.bamboocss = bamboocss;
exports.default = bamboocss;
