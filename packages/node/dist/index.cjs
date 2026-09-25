Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
const require_static_compiler = require("./static-compiler.cjs");
let _bamboocss_logger = require("@bamboocss/logger");
let _bamboocss_config = require("@bamboocss/config");
let _bamboocss_shared = require("@bamboocss/shared");
let fs = require("fs");
let path = require("path");
let picomatch = require("picomatch");
picomatch = __toESM(picomatch);
let _bamboocss_plugin_astro = require("@bamboocss/plugin-astro");
let _bamboocss_plugin_svelte = require("@bamboocss/plugin-svelte");
let _bamboocss_plugin_vue = require("@bamboocss/plugin-vue");
let _bamboocss_core = require("@bamboocss/core");
let _bamboocss_generator = require("@bamboocss/generator");
let node_fs = require("node:fs");
node_fs = __toESM(node_fs);
let node_path = require("node:path");
node_path = __toESM(node_path);
let perfect_debounce = require("perfect-debounce");
let node_module = require("node:module");
let node_url = require("node:url");
let node_process = require("node:process");
node_process = __toESM(node_process, 1);
let node_os = require("node:os");
node_os = __toESM(node_os, 1);
let node_tty = require("node:tty");
node_tty = __toESM(node_tty, 1);
let chokidar = require("chokidar");
chokidar = __toESM(chokidar);
let fast_glob = require("fast-glob");
fast_glob = __toESM(fast_glob);
let fs_extra = require("fs-extra");
fs_extra = __toESM(fs_extra);
let matcher = require("matcher");
let node_readline = require("node:readline");
node_readline = __toESM(node_readline);
let look_it_up = require("look-it-up");
let outdent = require("outdent");
outdent = __toESM(outdent);
let child_process = require("child_process");
//#region src/analyze.ts
/**
* `analyze` is one CLI command, but this module is reachable from `@bamboocss/node`'s index,
* so a static import made every consumer of that index — the CLI on any command, and the Vite
* plugin on every build — load the reporter and its table formatters to run neither. Loading
* it here keeps that off the path of everything that is not the `analyze` command.
*/
async function analyze(ctx, options = {}) {
	const { Reporter, formatRecipeReport, formatTokenReport } = await import("@bamboocss/reporter");
	const reporter = new Reporter(ctx, {
		parserOptions: ctx.parserOptions,
		parseFile: (file) => ctx.parseFile(file),
		prepare: (files) => ctx.prepareNativeExtraction(files),
		getRelativePath: ctx.runtime.path.relative,
		getFiles: ctx.getFiles,
		...options
	});
	reporter.init();
	return {
		getRecipeReport(format = "table") {
			const report = reporter.getRecipeReport();
			return {
				report,
				formatted: formatRecipeReport(report, format)
			};
		},
		getTokenReport(format = "table") {
			const report = reporter.getTokenReport();
			return {
				report,
				formatted: formatTokenReport(report.getSummary(), format)
			};
		},
		writeReport(filePath) {
			const dirname = ctx.runtime.path.dirname(filePath);
			ctx.runtime.fs.ensureDirSync(dirname);
			const str = JSON.stringify(reporter.report, replacer, 2);
			return ctx.runtime.fs.writeFile(filePath, str);
		}
	};
}
function replacer(_, value) {
	if (value instanceof Set) return Array.from(value);
	if (value instanceof Map) return Object.fromEntries(value);
	return value;
}
//#endregion
//#region src/build-info.ts
async function buildInfo(ctx, outfile) {
	const { filesWithCss, files } = ctx.parseFiles();
	_bamboocss_logger.logger.info("cli", `Found ${_bamboocss_logger.colors.bold(`${filesWithCss.length}/${files.length}`)} files using Bamboo`);
	const { minify, staticCss } = ctx.config;
	_bamboocss_logger.logger.info("cli", `Writing ${minify ? "[min] " : " "}${_bamboocss_logger.colors.bold(outfile)}`);
	if (staticCss) {
		_bamboocss_logger.logger.info("cli", "Adding staticCss definitions...");
		ctx.staticCss.process(staticCss);
	}
	const output = JSON.stringify(ctx.encoder.toJSON(), null, minify ? 0 : 2);
	ctx.output.ensure(outfile, process.cwd());
	await ctx.runtime.fs.writeFile(outfile, output);
	_bamboocss_logger.logger.info("cli", "Done!");
}
//#endregion
//#region src/codegen.ts
async function codegen(ctx, ids) {
	const { default: pLimit } = await import("p-limit");
	const limit = pLimit(20);
	if (ctx.config.clean) ctx.output.empty();
	let artifacts = ctx.getArtifacts(ids);
	let hookFiltered = false;
	if (ctx.hooks["codegen:prepare"]) {
		const results = await ctx.hooks["codegen:prepare"]?.({
			changed: ids,
			artifacts
		});
		if (results) {
			artifacts = results;
			hookFiltered = true;
		}
	}
	const promises = artifacts.map((artifact) => limit(() => ctx.output.write(artifact)));
	await Promise.allSettled(promises);
	if (!hookFiltered) ctx.output.prune(ids ? ctx.getArtifacts() : artifacts);
	await ctx.hooks["codegen:done"]?.({ changed: ids });
	return {
		box: ctx.initMessage(),
		msg: ctx.messages.artifactsGenerated()
	};
}
//#endregion
//#region src/extractable-files.ts
/**
* Which of the files `include` matched an extraction pass actually has to read.
*
* A file can only contribute to the stylesheet by *calling* something bamboo owns — `css`, a
* recipe, a pattern, `token`. Every one of those arrives as a binding, and a binding arrives
* through an import: either straight from an entrypoint, or from a local module that got it
* from one. A file with no such chain cannot hold a call, whatever else is in it.
*
* On a real application that is most of the tree. Measured over 6,425 files: 4,062 could reach
* an entrypoint and 2,363 provably could not, and not handing the extractor the latter took the
* pass from 88.9s to 26.3s with byte-identical CSS out. The scan itself costs ~300ms, because
* it reads text and never parses.
*
* ## Skipping is not the same as ignoring
*
* A file left out here is still *reachable*. Cross-file composition works by resolving an
* import and reading what it names, so a module that exports a style object still arrives
* the moment something that qualifies imports it. What is skipped is only asking "does this
* file *originate* a call", of a file that has no binding to originate one with.
*
* ## Everything here fails open
*
* The failure this must not have is dropping a rule, which is silent: the build stays green and
* the class the component asks for has nothing behind it. So every uncertainty resolves toward
* including the file, and the cases are named rather than left to a catch-all — a file that
* cannot be read, a source whose imports could not be scanned, a specifier that looks local and
* resolves to nothing. Being wrong in that direction costs time; being wrong in the other costs
* correctness.
*/
/**
* Module specifiers, from the four places one can appear.
*
* Deliberately loose about what surrounds them. A specifier missed here costs an edge, and an
* edge missed can exclude a file that should have been kept — so the pattern is written to
* over-match rather than to parse, and `scanSpecifiers` treats a source it found nothing in as
* one it failed to read.
*/
const SPECIFIER = /(?:\bfrom\s*|^\s*(?:import|export)\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/gm;
/** The extensions a specifier may omit, in the order the native resolver tries them. */
const EXTENSIONS = [
	".ts",
	".tsx",
	".d.ts",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs"
];
/** What a `.js`-family specifier may actually name, source first. */
const EMITTED = [
	[".js", [
		".ts",
		".tsx",
		".d.ts",
		".js",
		".jsx"
	]],
	[".mjs", [
		".mts",
		".d.mts",
		".mjs"
	]],
	[".cjs", [
		".cts",
		".d.cts",
		".cjs"
	]]
];
/** Every specifier in a source, or `undefined` when the text could not be scanned at all. */
const scanSpecifiers = (text) => {
	const found = [];
	for (const match of text.matchAll(SPECIFIER)) if (match[1]) found.push(match[1]);
	if (found.length) return found;
	return /\b(?:import|require)\b/.test(text) ? void 0 : found;
};
/** A candidate path with every extension a specifier may have omitted. */
const candidatesFor = (base) => {
	const emitted = EMITTED.find(([suffix]) => base.endsWith(suffix));
	return [...emitted ? emitted[1].map((extension) => base.slice(0, -emitted[0].length) + extension) : [base, ...EXTENSIONS.map((extension) => base + extension)], ...EXTENSIONS.map((extension) => `${base}/index${extension}`)];
};
/**
* Where a specifier points, when that is somewhere inside the project.
*
* `undefined` means "nothing local", which is the answer for a package as well as for a broken
* path — and both are correct here, because neither can hand this file a binding bamboo owns.
* bamboo's own resolution stops at the same boundary: a target outside the project reads as
* non-local, so nothing it exports is ever extracted from.
*/
const localTargetOf = (specifier, importer, options) => {
	const bases = [];
	if (specifier.startsWith(".")) bases.push((0, node_path.resolve)((0, node_path.dirname)(importer), specifier));
	else if ((0, node_path.isAbsolute)(specifier)) bases.push(specifier);
	else {
		for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
			const star = pattern.indexOf("*");
			if (star === -1) {
				if (pattern !== specifier) continue;
				for (const target of targets) bases.push((0, node_path.resolve)(options.cwd, target));
				continue;
			}
			const head = pattern.slice(0, star);
			const tail = pattern.slice(star + 1);
			if (!specifier.startsWith(head) || !specifier.endsWith(tail)) continue;
			const filled = specifier.slice(head.length, specifier.length - tail.length);
			for (const target of targets) bases.push((0, node_path.resolve)(options.cwd, target.replace("*", filled)));
		}
		if (options.baseUrl) bases.push((0, node_path.resolve)(options.cwd, options.baseUrl, specifier));
	}
	const exists = options.fileExists ?? node_fs.existsSync;
	const root = options.cwd.endsWith("/") ? options.cwd : `${options.cwd}/`;
	for (const base of bases) {
		if (!base.startsWith(root)) continue;
		for (const candidate of candidatesFor(base)) if (exists(candidate)) return candidate;
	}
};
/**
* The subset of `files` that could hold a call to something bamboo owns.
*
* Two passes over text and no parsing. The first marks every file that names an entrypoint and
* records where each file's other imports point; the second walks those edges backwards from
* the marked set, because a file that imports a module carrying bamboo bindings may be using
* one — a recipe defined with `cva` in one file and called in another is exactly that shape.
*
* The edges are worth more than the walk they were built for. Every one of them names a module
* that is *going* to be demanded, so the same scan that decides what to parse also says which
* virtual or transformed sources the native source map may need — see `auxiliary`.
*/
const selectExtractable = (files, options) => {
	const keep = /* @__PURE__ */ new Set();
	const importers = /* @__PURE__ */ new Map();
	for (const file of files) {
		const text = options.readFile(file);
		if (text === void 0) {
			keep.add(file);
			continue;
		}
		if (options.entrypoints.some((entrypoint) => text.includes(entrypoint))) keep.add(file);
		const specifiers = scanSpecifiers(text);
		if (specifiers === void 0) {
			keep.add(file);
			continue;
		}
		for (const specifier of specifiers) {
			const target = localTargetOf(specifier, file, options);
			if (!target) continue;
			const seen = importers.get(target);
			if (seen) seen.push(file);
			else importers.set(target, [file]);
		}
	}
	let frontier = [...keep];
	while (frontier.length) {
		const next = [];
		for (const target of frontier) for (const importer of importers.get(target) ?? []) {
			if (keep.has(importer)) continue;
			keep.add(importer);
			next.push(importer);
		}
		frontier = next;
	}
	const inventory = new Set(files);
	return {
		auxiliary: [...importers.keys()].filter((target) => !inventory.has(target)),
		extractable: files.filter((file) => keep.has(file))
	};
};
//#endregion
//#region ../../node_modules/.pnpm/ansi-regex@6.2.2/node_modules/ansi-regex/index.js
function ansiRegex({ onlyFirst = false } = {}) {
	return new RegExp(`(?:\\u001B\\][\\s\\S]*?(?:\\u0007|\\u001B\\u005C|\\u009C))|[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]`, onlyFirst ? void 0 : "g");
}
//#endregion
//#region ../../node_modules/.pnpm/strip-ansi@7.1.2/node_modules/strip-ansi/index.js
const regex = ansiRegex();
function stripAnsi(string) {
	if (typeof string !== "string") throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
	return string.replace(regex, "");
}
//#endregion
//#region ../../node_modules/.pnpm/get-east-asian-width@1.4.0/node_modules/get-east-asian-width/lookup.js
function isAmbiguous(x) {
	return x === 161 || x === 164 || x === 167 || x === 168 || x === 170 || x === 173 || x === 174 || x >= 176 && x <= 180 || x >= 182 && x <= 186 || x >= 188 && x <= 191 || x === 198 || x === 208 || x === 215 || x === 216 || x >= 222 && x <= 225 || x === 230 || x >= 232 && x <= 234 || x === 236 || x === 237 || x === 240 || x === 242 || x === 243 || x >= 247 && x <= 250 || x === 252 || x === 254 || x === 257 || x === 273 || x === 275 || x === 283 || x === 294 || x === 295 || x === 299 || x >= 305 && x <= 307 || x === 312 || x >= 319 && x <= 322 || x === 324 || x >= 328 && x <= 331 || x === 333 || x === 338 || x === 339 || x === 358 || x === 359 || x === 363 || x === 462 || x === 464 || x === 466 || x === 468 || x === 470 || x === 472 || x === 474 || x === 476 || x === 593 || x === 609 || x === 708 || x === 711 || x >= 713 && x <= 715 || x === 717 || x === 720 || x >= 728 && x <= 731 || x === 733 || x === 735 || x >= 768 && x <= 879 || x >= 913 && x <= 929 || x >= 931 && x <= 937 || x >= 945 && x <= 961 || x >= 963 && x <= 969 || x === 1025 || x >= 1040 && x <= 1103 || x === 1105 || x === 8208 || x >= 8211 && x <= 8214 || x === 8216 || x === 8217 || x === 8220 || x === 8221 || x >= 8224 && x <= 8226 || x >= 8228 && x <= 8231 || x === 8240 || x === 8242 || x === 8243 || x === 8245 || x === 8251 || x === 8254 || x === 8308 || x === 8319 || x >= 8321 && x <= 8324 || x === 8364 || x === 8451 || x === 8453 || x === 8457 || x === 8467 || x === 8470 || x === 8481 || x === 8482 || x === 8486 || x === 8491 || x === 8531 || x === 8532 || x >= 8539 && x <= 8542 || x >= 8544 && x <= 8555 || x >= 8560 && x <= 8569 || x === 8585 || x >= 8592 && x <= 8601 || x === 8632 || x === 8633 || x === 8658 || x === 8660 || x === 8679 || x === 8704 || x === 8706 || x === 8707 || x === 8711 || x === 8712 || x === 8715 || x === 8719 || x === 8721 || x === 8725 || x === 8730 || x >= 8733 && x <= 8736 || x === 8739 || x === 8741 || x >= 8743 && x <= 8748 || x === 8750 || x >= 8756 && x <= 8759 || x === 8764 || x === 8765 || x === 8776 || x === 8780 || x === 8786 || x === 8800 || x === 8801 || x >= 8804 && x <= 8807 || x === 8810 || x === 8811 || x === 8814 || x === 8815 || x === 8834 || x === 8835 || x === 8838 || x === 8839 || x === 8853 || x === 8857 || x === 8869 || x === 8895 || x === 8978 || x >= 9312 && x <= 9449 || x >= 9451 && x <= 9547 || x >= 9552 && x <= 9587 || x >= 9600 && x <= 9615 || x >= 9618 && x <= 9621 || x === 9632 || x === 9633 || x >= 9635 && x <= 9641 || x === 9650 || x === 9651 || x === 9654 || x === 9655 || x === 9660 || x === 9661 || x === 9664 || x === 9665 || x >= 9670 && x <= 9672 || x === 9675 || x >= 9678 && x <= 9681 || x >= 9698 && x <= 9701 || x === 9711 || x === 9733 || x === 9734 || x === 9737 || x === 9742 || x === 9743 || x === 9756 || x === 9758 || x === 9792 || x === 9794 || x === 9824 || x === 9825 || x >= 9827 && x <= 9829 || x >= 9831 && x <= 9834 || x === 9836 || x === 9837 || x === 9839 || x === 9886 || x === 9887 || x === 9919 || x >= 9926 && x <= 9933 || x >= 9935 && x <= 9939 || x >= 9941 && x <= 9953 || x === 9955 || x === 9960 || x === 9961 || x >= 9963 && x <= 9969 || x === 9972 || x >= 9974 && x <= 9977 || x === 9979 || x === 9980 || x === 9982 || x === 9983 || x === 10045 || x >= 10102 && x <= 10111 || x >= 11094 && x <= 11097 || x >= 12872 && x <= 12879 || x >= 57344 && x <= 63743 || x >= 65024 && x <= 65039 || x === 65533 || x >= 127232 && x <= 127242 || x >= 127248 && x <= 127277 || x >= 127280 && x <= 127337 || x >= 127344 && x <= 127373 || x === 127375 || x === 127376 || x >= 127387 && x <= 127404 || x >= 917760 && x <= 917999 || x >= 983040 && x <= 1048573 || x >= 1048576 && x <= 1114109;
}
function isFullWidth(x) {
	return x === 12288 || x >= 65281 && x <= 65376 || x >= 65504 && x <= 65510;
}
function isWide(x) {
	return x >= 4352 && x <= 4447 || x === 8986 || x === 8987 || x === 9001 || x === 9002 || x >= 9193 && x <= 9196 || x === 9200 || x === 9203 || x === 9725 || x === 9726 || x === 9748 || x === 9749 || x >= 9776 && x <= 9783 || x >= 9800 && x <= 9811 || x === 9855 || x >= 9866 && x <= 9871 || x === 9875 || x === 9889 || x === 9898 || x === 9899 || x === 9917 || x === 9918 || x === 9924 || x === 9925 || x === 9934 || x === 9940 || x === 9962 || x === 9970 || x === 9971 || x === 9973 || x === 9978 || x === 9981 || x === 9989 || x === 9994 || x === 9995 || x === 10024 || x === 10060 || x === 10062 || x >= 10067 && x <= 10069 || x === 10071 || x >= 10133 && x <= 10135 || x === 10160 || x === 10175 || x === 11035 || x === 11036 || x === 11088 || x === 11093 || x >= 11904 && x <= 11929 || x >= 11931 && x <= 12019 || x >= 12032 && x <= 12245 || x >= 12272 && x <= 12287 || x >= 12289 && x <= 12350 || x >= 12353 && x <= 12438 || x >= 12441 && x <= 12543 || x >= 12549 && x <= 12591 || x >= 12593 && x <= 12686 || x >= 12688 && x <= 12773 || x >= 12783 && x <= 12830 || x >= 12832 && x <= 12871 || x >= 12880 && x <= 42124 || x >= 42128 && x <= 42182 || x >= 43360 && x <= 43388 || x >= 44032 && x <= 55203 || x >= 63744 && x <= 64255 || x >= 65040 && x <= 65049 || x >= 65072 && x <= 65106 || x >= 65108 && x <= 65126 || x >= 65128 && x <= 65131 || x >= 94176 && x <= 94180 || x >= 94192 && x <= 94198 || x >= 94208 && x <= 101589 || x >= 101631 && x <= 101662 || x >= 101760 && x <= 101874 || x >= 110576 && x <= 110579 || x >= 110581 && x <= 110587 || x === 110589 || x === 110590 || x >= 110592 && x <= 110882 || x === 110898 || x >= 110928 && x <= 110930 || x === 110933 || x >= 110948 && x <= 110951 || x >= 110960 && x <= 111355 || x >= 119552 && x <= 119638 || x >= 119648 && x <= 119670 || x === 126980 || x === 127183 || x === 127374 || x >= 127377 && x <= 127386 || x >= 127488 && x <= 127490 || x >= 127504 && x <= 127547 || x >= 127552 && x <= 127560 || x === 127568 || x === 127569 || x >= 127584 && x <= 127589 || x >= 127744 && x <= 127776 || x >= 127789 && x <= 127797 || x >= 127799 && x <= 127868 || x >= 127870 && x <= 127891 || x >= 127904 && x <= 127946 || x >= 127951 && x <= 127955 || x >= 127968 && x <= 127984 || x === 127988 || x >= 127992 && x <= 128062 || x === 128064 || x >= 128066 && x <= 128252 || x >= 128255 && x <= 128317 || x >= 128331 && x <= 128334 || x >= 128336 && x <= 128359 || x === 128378 || x === 128405 || x === 128406 || x === 128420 || x >= 128507 && x <= 128591 || x >= 128640 && x <= 128709 || x === 128716 || x >= 128720 && x <= 128722 || x >= 128725 && x <= 128728 || x >= 128732 && x <= 128735 || x === 128747 || x === 128748 || x >= 128756 && x <= 128764 || x >= 128992 && x <= 129003 || x === 129008 || x >= 129292 && x <= 129338 || x >= 129340 && x <= 129349 || x >= 129351 && x <= 129535 || x >= 129648 && x <= 129660 || x >= 129664 && x <= 129674 || x >= 129678 && x <= 129734 || x === 129736 || x >= 129741 && x <= 129756 || x >= 129759 && x <= 129770 || x >= 129775 && x <= 129784 || x >= 131072 && x <= 196605 || x >= 196608 && x <= 262141;
}
//#endregion
//#region ../../node_modules/.pnpm/get-east-asian-width@1.4.0/node_modules/get-east-asian-width/index.js
function validate(codePoint) {
	if (!Number.isSafeInteger(codePoint)) throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
}
function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
	validate(codePoint);
	if (isFullWidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) return 2;
	return 1;
}
//#endregion
//#region ../../node_modules/.pnpm/string-width@7.2.0/node_modules/string-width/index.js
var import_emoji_regex = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = () => {
		return /[#*0-9]\uFE0F?\u20E3|[\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23ED-\u23EF\u23F1\u23F2\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB\u25FC\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692\u2694-\u2697\u2699\u269B\u269C\u26A0\u26A7\u26AA\u26B0\u26B1\u26BD\u26BE\u26C4\u26C8\u26CF\u26D1\u26E9\u26F0-\u26F5\u26F7\u26F8\u26FA\u2702\u2708\u2709\u270F\u2712\u2714\u2716\u271D\u2721\u2733\u2734\u2744\u2747\u2757\u2763\u27A1\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B55\u3030\u303D\u3297\u3299]\uFE0F?|[\u261D\u270C\u270D](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?|[\u270A\u270B](?:\uD83C[\uDFFB-\uDFFF])?|[\u23E9-\u23EC\u23F0\u23F3\u25FD\u2693\u26A1\u26AB\u26C5\u26CE\u26D4\u26EA\u26FD\u2705\u2728\u274C\u274E\u2753-\u2755\u2795-\u2797\u27B0\u27BF\u2B50]|\u26D3\uFE0F?(?:\u200D\uD83D\uDCA5)?|\u26F9(?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|\u2764\uFE0F?(?:\u200D(?:\uD83D\uDD25|\uD83E\uDE79))?|\uD83C(?:[\uDC04\uDD70\uDD71\uDD7E\uDD7F\uDE02\uDE37\uDF21\uDF24-\uDF2C\uDF36\uDF7D\uDF96\uDF97\uDF99-\uDF9B\uDF9E\uDF9F\uDFCD\uDFCE\uDFD4-\uDFDF\uDFF5\uDFF7]\uFE0F?|[\uDF85\uDFC2\uDFC7](?:\uD83C[\uDFFB-\uDFFF])?|[\uDFC4\uDFCA](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDFCB\uDFCC](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDCCF\uDD8E\uDD91-\uDD9A\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF43\uDF45-\uDF4A\uDF4C-\uDF7C\uDF7E-\uDF84\uDF86-\uDF93\uDFA0-\uDFC1\uDFC5\uDFC6\uDFC8\uDFC9\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF8-\uDFFF]|\uDDE6\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF]|\uDDE7\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF]|\uDDE8\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF7\uDDFA-\uDDFF]|\uDDE9\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF]|\uDDEA\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA]|\uDDEB\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7]|\uDDEC\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE]|\uDDED\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA]|\uDDEE\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9]|\uDDEF\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5]|\uDDF0\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF]|\uDDF1\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE]|\uDDF2\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF]|\uDDF3\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF]|\uDDF4\uD83C\uDDF2|\uDDF5\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE]|\uDDF6\uD83C\uDDE6|\uDDF7\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC]|\uDDF8\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF]|\uDDF9\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF]|\uDDFA\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF]|\uDDFB\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA]|\uDDFC\uD83C[\uDDEB\uDDF8]|\uDDFD\uD83C\uDDF0|\uDDFE\uD83C[\uDDEA\uDDF9]|\uDDFF\uD83C[\uDDE6\uDDF2\uDDFC]|\uDF44(?:\u200D\uD83D\uDFEB)?|\uDF4B(?:\u200D\uD83D\uDFE9)?|\uDFC3(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?|\uDFF3\uFE0F?(?:\u200D(?:\u26A7\uFE0F?|\uD83C\uDF08))?|\uDFF4(?:\u200D\u2620\uFE0F?|\uDB40\uDC67\uDB40\uDC62\uDB40(?:\uDC65\uDB40\uDC6E\uDB40\uDC67|\uDC73\uDB40\uDC63\uDB40\uDC74|\uDC77\uDB40\uDC6C\uDB40\uDC73)\uDB40\uDC7F)?)|\uD83D(?:[\uDC3F\uDCFD\uDD49\uDD4A\uDD6F\uDD70\uDD73\uDD76-\uDD79\uDD87\uDD8A-\uDD8D\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA\uDECB\uDECD-\uDECF\uDEE0-\uDEE5\uDEE9\uDEF0\uDEF3]\uFE0F?|[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC](?:\uD83C[\uDFFB-\uDFFF])?|[\uDC6E-\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4\uDEB5](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDD74\uDD90](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?|[\uDC00-\uDC07\uDC09-\uDC14\uDC16-\uDC25\uDC27-\uDC3A\uDC3C-\uDC3E\uDC40\uDC44\uDC45\uDC51-\uDC65\uDC6A\uDC79-\uDC7B\uDC7D-\uDC80\uDC84\uDC88-\uDC8E\uDC90\uDC92-\uDCA9\uDCAB-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDDA4\uDDFB-\uDE2D\uDE2F-\uDE34\uDE37-\uDE41\uDE43\uDE44\uDE48-\uDE4A\uDE80-\uDEA2\uDEA4-\uDEB3\uDEB7-\uDEBF\uDEC1-\uDEC5\uDED0-\uDED2\uDED5-\uDED8\uDEDC-\uDEDF\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB\uDFF0]|\uDC08(?:\u200D\u2B1B)?|\uDC15(?:\u200D\uD83E\uDDBA)?|\uDC26(?:\u200D(?:\u2B1B|\uD83D\uDD25))?|\uDC3B(?:\u200D\u2744\uFE0F?)?|\uDC41\uFE0F?(?:\u200D\uD83D\uDDE8\uFE0F?)?|\uDC68(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDC68\uDC69]\u200D\uD83D(?:\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?)|[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?)|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFC-\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFC-\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFD-\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFD\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFE])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFE]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?))?|\uDC69(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?[\uDC68\uDC69]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?|\uDC69\u200D\uD83D(?:\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?))|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFC-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFC-\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFC-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB\uDFFD-\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFD-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB-\uDFFD\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFD\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFE])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB-\uDFFE]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFE])))?))?|\uDD75(?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|\uDE2E(?:\u200D\uD83D\uDCA8)?|\uDE35(?:\u200D\uD83D\uDCAB)?|\uDE36(?:\u200D\uD83C\uDF2B\uFE0F?)?|\uDE42(?:\u200D[\u2194\u2195]\uFE0F?)?|\uDEB6(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?)|\uD83E(?:[\uDD0C\uDD0F\uDD18-\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5\uDEC3-\uDEC5\uDEF0\uDEF2-\uDEF8](?:\uD83C[\uDFFB-\uDFFF])?|[\uDD26\uDD35\uDD37-\uDD39\uDD3C-\uDD3E\uDDB8\uDDB9\uDDCD\uDDCF\uDDD4\uDDD6-\uDDDD](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDDDE\uDDDF](?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDD0D\uDD0E\uDD10-\uDD17\uDD20-\uDD25\uDD27-\uDD2F\uDD3A\uDD3F-\uDD45\uDD47-\uDD76\uDD78-\uDDB4\uDDB7\uDDBA\uDDBC-\uDDCC\uDDD0\uDDE0-\uDDFF\uDE70-\uDE7C\uDE80-\uDE8A\uDE8E-\uDEC2\uDEC6\uDEC8\uDECD-\uDEDC\uDEDF-\uDEEA\uDEEF]|\uDDCE(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?|\uDDD1(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1|\uDDD1\u200D\uD83E\uDDD2(?:\u200D\uD83E\uDDD2)?|\uDDD2(?:\u200D\uD83E\uDDD2)?))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE])))?))?|\uDEF1(?:\uD83C(?:\uDFFB(?:\u200D\uD83E\uDEF2\uD83C[\uDFFC-\uDFFF])?|\uDFFC(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB\uDFFD-\uDFFF])?|\uDFFD(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])?|\uDFFE(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB-\uDFFD\uDFFF])?|\uDFFF(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB-\uDFFE])?))?)/g;
	};
})))(), 1);
const segmenter = new Intl.Segmenter();
const defaultIgnorableCodePointRegex = /^\p{Default_Ignorable_Code_Point}$/u;
function stringWidth(string, options = {}) {
	if (typeof string !== "string" || string.length === 0) return 0;
	const { ambiguousIsNarrow = true, countAnsiEscapeCodes = false } = options;
	if (!countAnsiEscapeCodes) string = stripAnsi(string);
	if (string.length === 0) return 0;
	let width = 0;
	const eastAsianWidthOptions = { ambiguousAsWide: !ambiguousIsNarrow };
	for (const { segment: character } of segmenter.segment(string)) {
		const codePoint = character.codePointAt(0);
		if (codePoint <= 31 || codePoint >= 127 && codePoint <= 159) continue;
		if (codePoint >= 8203 && codePoint <= 8207 || codePoint === 65279) continue;
		if (codePoint >= 768 && codePoint <= 879 || codePoint >= 6832 && codePoint <= 6911 || codePoint >= 7616 && codePoint <= 7679 || codePoint >= 8400 && codePoint <= 8447 || codePoint >= 65056 && codePoint <= 65071) continue;
		if (codePoint >= 55296 && codePoint <= 57343) continue;
		if (codePoint >= 65024 && codePoint <= 65039) continue;
		if (defaultIgnorableCodePointRegex.test(character)) continue;
		if ((0, import_emoji_regex.default)().test(character)) {
			width += 2;
			continue;
		}
		width += eastAsianWidth(codePoint, eastAsianWidthOptions);
	}
	return width;
}
//#endregion
//#region ../../node_modules/.pnpm/chalk@5.6.2/node_modules/chalk/source/vendor/ansi-styles/index.js
const ANSI_BACKGROUND_OFFSET$1 = 10;
const wrapAnsi16$1 = (offset = 0) => (code) => `\u001B[${code + offset}m`;
const wrapAnsi256$1 = (offset = 0) => (code) => `\u001B[${38 + offset};5;${code}m`;
const wrapAnsi16m$1 = (offset = 0) => (red, green, blue) => `\u001B[${38 + offset};2;${red};${green};${blue}m`;
const styles$2 = {
	modifier: {
		reset: [0, 0],
		bold: [1, 22],
		dim: [2, 22],
		italic: [3, 23],
		underline: [4, 24],
		overline: [53, 55],
		inverse: [7, 27],
		hidden: [8, 28],
		strikethrough: [9, 29]
	},
	color: {
		black: [30, 39],
		red: [31, 39],
		green: [32, 39],
		yellow: [33, 39],
		blue: [34, 39],
		magenta: [35, 39],
		cyan: [36, 39],
		white: [37, 39],
		blackBright: [90, 39],
		gray: [90, 39],
		grey: [90, 39],
		redBright: [91, 39],
		greenBright: [92, 39],
		yellowBright: [93, 39],
		blueBright: [94, 39],
		magentaBright: [95, 39],
		cyanBright: [96, 39],
		whiteBright: [97, 39]
	},
	bgColor: {
		bgBlack: [40, 49],
		bgRed: [41, 49],
		bgGreen: [42, 49],
		bgYellow: [43, 49],
		bgBlue: [44, 49],
		bgMagenta: [45, 49],
		bgCyan: [46, 49],
		bgWhite: [47, 49],
		bgBlackBright: [100, 49],
		bgGray: [100, 49],
		bgGrey: [100, 49],
		bgRedBright: [101, 49],
		bgGreenBright: [102, 49],
		bgYellowBright: [103, 49],
		bgBlueBright: [104, 49],
		bgMagentaBright: [105, 49],
		bgCyanBright: [106, 49],
		bgWhiteBright: [107, 49]
	}
};
Object.keys(styles$2.modifier);
const foregroundColorNames$1 = Object.keys(styles$2.color);
const backgroundColorNames$1 = Object.keys(styles$2.bgColor);
[...foregroundColorNames$1, ...backgroundColorNames$1];
function assembleStyles$1() {
	const codes = /* @__PURE__ */ new Map();
	for (const [groupName, group] of Object.entries(styles$2)) {
		for (const [styleName, style] of Object.entries(group)) {
			styles$2[styleName] = {
				open: `\u001B[${style[0]}m`,
				close: `\u001B[${style[1]}m`
			};
			group[styleName] = styles$2[styleName];
			codes.set(style[0], style[1]);
		}
		Object.defineProperty(styles$2, groupName, {
			value: group,
			enumerable: false
		});
	}
	Object.defineProperty(styles$2, "codes", {
		value: codes,
		enumerable: false
	});
	styles$2.color.close = "\x1B[39m";
	styles$2.bgColor.close = "\x1B[49m";
	styles$2.color.ansi = wrapAnsi16$1();
	styles$2.color.ansi256 = wrapAnsi256$1();
	styles$2.color.ansi16m = wrapAnsi16m$1();
	styles$2.bgColor.ansi = wrapAnsi16$1(ANSI_BACKGROUND_OFFSET$1);
	styles$2.bgColor.ansi256 = wrapAnsi256$1(ANSI_BACKGROUND_OFFSET$1);
	styles$2.bgColor.ansi16m = wrapAnsi16m$1(ANSI_BACKGROUND_OFFSET$1);
	Object.defineProperties(styles$2, {
		rgbToAnsi256: {
			value(red, green, blue) {
				if (red === green && green === blue) {
					if (red < 8) return 16;
					if (red > 248) return 231;
					return Math.round((red - 8) / 247 * 24) + 232;
				}
				return 16 + 36 * Math.round(red / 255 * 5) + 6 * Math.round(green / 255 * 5) + Math.round(blue / 255 * 5);
			},
			enumerable: false
		},
		hexToRgb: {
			value(hex) {
				const matches = /[a-f\d]{6}|[a-f\d]{3}/i.exec(hex.toString(16));
				if (!matches) return [
					0,
					0,
					0
				];
				let [colorString] = matches;
				if (colorString.length === 3) colorString = [...colorString].map((character) => character + character).join("");
				const integer = Number.parseInt(colorString, 16);
				return [
					integer >> 16 & 255,
					integer >> 8 & 255,
					integer & 255
				];
			},
			enumerable: false
		},
		hexToAnsi256: {
			value: (hex) => styles$2.rgbToAnsi256(...styles$2.hexToRgb(hex)),
			enumerable: false
		},
		ansi256ToAnsi: {
			value(code) {
				if (code < 8) return 30 + code;
				if (code < 16) return 90 + (code - 8);
				let red;
				let green;
				let blue;
				if (code >= 232) {
					red = ((code - 232) * 10 + 8) / 255;
					green = red;
					blue = red;
				} else {
					code -= 16;
					const remainder = code % 36;
					red = Math.floor(code / 36) / 5;
					green = Math.floor(remainder / 6) / 5;
					blue = remainder % 6 / 5;
				}
				const value = Math.max(red, green, blue) * 2;
				if (value === 0) return 30;
				let result = 30 + (Math.round(blue) << 2 | Math.round(green) << 1 | Math.round(red));
				if (value === 2) result += 60;
				return result;
			},
			enumerable: false
		},
		rgbToAnsi: {
			value: (red, green, blue) => styles$2.ansi256ToAnsi(styles$2.rgbToAnsi256(red, green, blue)),
			enumerable: false
		},
		hexToAnsi: {
			value: (hex) => styles$2.ansi256ToAnsi(styles$2.hexToAnsi256(hex)),
			enumerable: false
		}
	});
	return styles$2;
}
const ansiStyles$1 = assembleStyles$1();
//#endregion
//#region ../../node_modules/.pnpm/chalk@5.6.2/node_modules/chalk/source/vendor/supports-color/index.js
function hasFlag(flag, argv = globalThis.Deno ? globalThis.Deno.args : node_process.default.argv) {
	const prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--";
	const position = argv.indexOf(prefix + flag);
	const terminatorPosition = argv.indexOf("--");
	return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
}
const { env } = node_process.default;
let flagForceColor;
if (hasFlag("no-color") || hasFlag("no-colors") || hasFlag("color=false") || hasFlag("color=never")) flagForceColor = 0;
else if (hasFlag("color") || hasFlag("colors") || hasFlag("color=true") || hasFlag("color=always")) flagForceColor = 1;
function envForceColor() {
	if ("FORCE_COLOR" in env) {
		if (env.FORCE_COLOR === "true") return 1;
		if (env.FORCE_COLOR === "false") return 0;
		return env.FORCE_COLOR.length === 0 ? 1 : Math.min(Number.parseInt(env.FORCE_COLOR, 10), 3);
	}
}
function translateLevel(level) {
	if (level === 0) return false;
	return {
		level,
		hasBasic: true,
		has256: level >= 2,
		has16m: level >= 3
	};
}
function _supportsColor(haveStream, { streamIsTTY, sniffFlags = true } = {}) {
	const noFlagForceColor = envForceColor();
	if (noFlagForceColor !== void 0) flagForceColor = noFlagForceColor;
	const forceColor = sniffFlags ? flagForceColor : noFlagForceColor;
	if (forceColor === 0) return 0;
	if (sniffFlags) {
		if (hasFlag("color=16m") || hasFlag("color=full") || hasFlag("color=truecolor")) return 3;
		if (hasFlag("color=256")) return 2;
	}
	if ("TF_BUILD" in env && "AGENT_NAME" in env) return 1;
	if (haveStream && !streamIsTTY && forceColor === void 0) return 0;
	const min = forceColor || 0;
	if (env.TERM === "dumb") return min;
	if (node_process.default.platform === "win32") {
		const osRelease = node_os.default.release().split(".");
		if (Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) return Number(osRelease[2]) >= 14931 ? 3 : 2;
		return 1;
	}
	if ("CI" in env) {
		if ([
			"GITHUB_ACTIONS",
			"GITEA_ACTIONS",
			"CIRCLECI"
		].some((key) => key in env)) return 3;
		if ([
			"TRAVIS",
			"APPVEYOR",
			"GITLAB_CI",
			"BUILDKITE",
			"DRONE"
		].some((sign) => sign in env) || env.CI_NAME === "codeship") return 1;
		return min;
	}
	if ("TEAMCITY_VERSION" in env) return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
	if (env.COLORTERM === "truecolor") return 3;
	if (env.TERM === "xterm-kitty") return 3;
	if (env.TERM === "xterm-ghostty") return 3;
	if (env.TERM === "wezterm") return 3;
	if ("TERM_PROGRAM" in env) {
		const version = Number.parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
		switch (env.TERM_PROGRAM) {
			case "iTerm.app": return version >= 3 ? 3 : 2;
			case "Apple_Terminal": return 2;
		}
	}
	if (/-256(color)?$/i.test(env.TERM)) return 2;
	if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) return 1;
	if ("COLORTERM" in env) return 1;
	return min;
}
function createSupportsColor(stream, options = {}) {
	return translateLevel(_supportsColor(stream, {
		streamIsTTY: stream && stream.isTTY,
		...options
	}));
}
const supportsColor = {
	stdout: createSupportsColor({ isTTY: node_tty.default.isatty(1) }),
	stderr: createSupportsColor({ isTTY: node_tty.default.isatty(2) })
};
//#endregion
//#region ../../node_modules/.pnpm/chalk@5.6.2/node_modules/chalk/source/utilities.js
function stringReplaceAll(string, substring, replacer) {
	let index = string.indexOf(substring);
	if (index === -1) return string;
	const substringLength = substring.length;
	let endIndex = 0;
	let returnValue = "";
	do {
		returnValue += string.slice(endIndex, index) + substring + replacer;
		endIndex = index + substringLength;
		index = string.indexOf(substring, endIndex);
	} while (index !== -1);
	returnValue += string.slice(endIndex);
	return returnValue;
}
function stringEncaseCRLFWithFirstIndex(string, prefix, postfix, index) {
	let endIndex = 0;
	let returnValue = "";
	do {
		const gotCR = string[index - 1] === "\r";
		returnValue += string.slice(endIndex, gotCR ? index - 1 : index) + prefix + (gotCR ? "\r\n" : "\n") + postfix;
		endIndex = index + 1;
		index = string.indexOf("\n", endIndex);
	} while (index !== -1);
	returnValue += string.slice(endIndex);
	return returnValue;
}
//#endregion
//#region ../../node_modules/.pnpm/chalk@5.6.2/node_modules/chalk/source/index.js
const { stdout: stdoutColor, stderr: stderrColor } = supportsColor;
const GENERATOR = Symbol("GENERATOR");
const STYLER = Symbol("STYLER");
const IS_EMPTY = Symbol("IS_EMPTY");
const levelMapping = [
	"ansi",
	"ansi",
	"ansi256",
	"ansi16m"
];
const styles$1 = Object.create(null);
const applyOptions = (object, options = {}) => {
	if (options.level && !(Number.isInteger(options.level) && options.level >= 0 && options.level <= 3)) throw new Error("The `level` option should be an integer from 0 to 3");
	const colorLevel = stdoutColor ? stdoutColor.level : 0;
	object.level = options.level === void 0 ? colorLevel : options.level;
};
const chalkFactory = (options) => {
	const chalk = (...strings) => strings.join(" ");
	applyOptions(chalk, options);
	Object.setPrototypeOf(chalk, createChalk.prototype);
	return chalk;
};
function createChalk(options) {
	return chalkFactory(options);
}
Object.setPrototypeOf(createChalk.prototype, Function.prototype);
for (const [styleName, style] of Object.entries(ansiStyles$1)) styles$1[styleName] = { get() {
	const builder = createBuilder(this, createStyler(style.open, style.close, this[STYLER]), this[IS_EMPTY]);
	Object.defineProperty(this, styleName, { value: builder });
	return builder;
} };
styles$1.visible = { get() {
	const builder = createBuilder(this, this[STYLER], true);
	Object.defineProperty(this, "visible", { value: builder });
	return builder;
} };
const getModelAnsi = (model, level, type, ...arguments_) => {
	if (model === "rgb") {
		if (level === "ansi16m") return ansiStyles$1[type].ansi16m(...arguments_);
		if (level === "ansi256") return ansiStyles$1[type].ansi256(ansiStyles$1.rgbToAnsi256(...arguments_));
		return ansiStyles$1[type].ansi(ansiStyles$1.rgbToAnsi(...arguments_));
	}
	if (model === "hex") return getModelAnsi("rgb", level, type, ...ansiStyles$1.hexToRgb(...arguments_));
	return ansiStyles$1[type][model](...arguments_);
};
for (const model of [
	"rgb",
	"hex",
	"ansi256"
]) {
	styles$1[model] = { get() {
		const { level } = this;
		return function(...arguments_) {
			const styler = createStyler(getModelAnsi(model, levelMapping[level], "color", ...arguments_), ansiStyles$1.color.close, this[STYLER]);
			return createBuilder(this, styler, this[IS_EMPTY]);
		};
	} };
	const bgModel = "bg" + model[0].toUpperCase() + model.slice(1);
	styles$1[bgModel] = { get() {
		const { level } = this;
		return function(...arguments_) {
			const styler = createStyler(getModelAnsi(model, levelMapping[level], "bgColor", ...arguments_), ansiStyles$1.bgColor.close, this[STYLER]);
			return createBuilder(this, styler, this[IS_EMPTY]);
		};
	} };
}
const proto = Object.defineProperties(() => {}, {
	...styles$1,
	level: {
		enumerable: true,
		get() {
			return this[GENERATOR].level;
		},
		set(level) {
			this[GENERATOR].level = level;
		}
	}
});
const createStyler = (open, close, parent) => {
	let openAll;
	let closeAll;
	if (parent === void 0) {
		openAll = open;
		closeAll = close;
	} else {
		openAll = parent.openAll + open;
		closeAll = close + parent.closeAll;
	}
	return {
		open,
		close,
		openAll,
		closeAll,
		parent
	};
};
const createBuilder = (self, _styler, _isEmpty) => {
	const builder = (...arguments_) => applyStyle(builder, arguments_.length === 1 ? "" + arguments_[0] : arguments_.join(" "));
	Object.setPrototypeOf(builder, proto);
	builder[GENERATOR] = self;
	builder[STYLER] = _styler;
	builder[IS_EMPTY] = _isEmpty;
	return builder;
};
const applyStyle = (self, string) => {
	if (self.level <= 0 || !string) return self[IS_EMPTY] ? "" : string;
	let styler = self[STYLER];
	if (styler === void 0) return string;
	const { openAll, closeAll } = styler;
	if (string.includes("\x1B")) while (styler !== void 0) {
		string = stringReplaceAll(string, styler.close, styler.open);
		styler = styler.parent;
	}
	const lfIndex = string.indexOf("\n");
	if (lfIndex !== -1) string = stringEncaseCRLFWithFirstIndex(string, closeAll, openAll, lfIndex);
	return openAll + string + closeAll;
};
Object.defineProperties(createChalk.prototype, styles$1);
const chalk = createChalk();
createChalk({ level: stderrColor ? stderrColor.level : 0 });
//#endregion
//#region ../../node_modules/.pnpm/widest-line@5.0.0/node_modules/widest-line/index.js
function widestLine(string) {
	let lineWidth = 0;
	for (const line of string.split("\n")) lineWidth = Math.max(lineWidth, stringWidth(line));
	return lineWidth;
}
//#endregion
//#region ../../node_modules/.pnpm/cli-boxes@3.0.0/node_modules/cli-boxes/boxes.json
var require_boxes = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"single": {
			"topLeft": "┌",
			"top": "─",
			"topRight": "┐",
			"right": "│",
			"bottomRight": "┘",
			"bottom": "─",
			"bottomLeft": "└",
			"left": "│"
		},
		"double": {
			"topLeft": "╔",
			"top": "═",
			"topRight": "╗",
			"right": "║",
			"bottomRight": "╝",
			"bottom": "═",
			"bottomLeft": "╚",
			"left": "║"
		},
		"round": {
			"topLeft": "╭",
			"top": "─",
			"topRight": "╮",
			"right": "│",
			"bottomRight": "╯",
			"bottom": "─",
			"bottomLeft": "╰",
			"left": "│"
		},
		"bold": {
			"topLeft": "┏",
			"top": "━",
			"topRight": "┓",
			"right": "┃",
			"bottomRight": "┛",
			"bottom": "━",
			"bottomLeft": "┗",
			"left": "┃"
		},
		"singleDouble": {
			"topLeft": "╓",
			"top": "─",
			"topRight": "╖",
			"right": "║",
			"bottomRight": "╜",
			"bottom": "─",
			"bottomLeft": "╙",
			"left": "║"
		},
		"doubleSingle": {
			"topLeft": "╒",
			"top": "═",
			"topRight": "╕",
			"right": "│",
			"bottomRight": "╛",
			"bottom": "═",
			"bottomLeft": "╘",
			"left": "│"
		},
		"classic": {
			"topLeft": "+",
			"top": "-",
			"topRight": "+",
			"right": "|",
			"bottomRight": "+",
			"bottom": "-",
			"bottomLeft": "+",
			"left": "|"
		},
		"arrow": {
			"topLeft": "↘",
			"top": "↓",
			"topRight": "↙",
			"right": "←",
			"bottomRight": "↖",
			"bottom": "↑",
			"bottomLeft": "↗",
			"left": "→"
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/camelcase@8.0.0/node_modules/camelcase/index.js
var import_cli_boxes = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	const cliBoxes = require_boxes();
	module.exports = cliBoxes;
	module.exports.default = cliBoxes;
})))(), 1);
const UPPERCASE = /[\p{Lu}]/u;
const LOWERCASE = /[\p{Ll}]/u;
const LEADING_CAPITAL = /^[\p{Lu}](?![\p{Lu}])/gu;
const IDENTIFIER = /([\p{Alpha}\p{N}_]|$)/u;
const SEPARATORS = /[_.\- ]+/;
const LEADING_SEPARATORS = new RegExp("^" + SEPARATORS.source);
const SEPARATORS_AND_IDENTIFIER = new RegExp(SEPARATORS.source + IDENTIFIER.source, "gu");
const NUMBERS_AND_IDENTIFIER = new RegExp("\\d+" + IDENTIFIER.source, "gu");
const preserveCamelCase = (string, toLowerCase, toUpperCase, preserveConsecutiveUppercase) => {
	let isLastCharLower = false;
	let isLastCharUpper = false;
	let isLastLastCharUpper = false;
	let isLastLastCharPreserved = false;
	for (let index = 0; index < string.length; index++) {
		const character = string[index];
		isLastLastCharPreserved = index > 2 ? string[index - 3] === "-" : true;
		if (isLastCharLower && UPPERCASE.test(character)) {
			string = string.slice(0, index) + "-" + string.slice(index);
			isLastCharLower = false;
			isLastLastCharUpper = isLastCharUpper;
			isLastCharUpper = true;
			index++;
		} else if (isLastCharUpper && isLastLastCharUpper && LOWERCASE.test(character) && (!isLastLastCharPreserved || preserveConsecutiveUppercase)) {
			string = string.slice(0, index - 1) + "-" + string.slice(index - 1);
			isLastLastCharUpper = isLastCharUpper;
			isLastCharUpper = false;
			isLastCharLower = true;
		} else {
			isLastCharLower = toLowerCase(character) === character && toUpperCase(character) !== character;
			isLastLastCharUpper = isLastCharUpper;
			isLastCharUpper = toUpperCase(character) === character && toLowerCase(character) !== character;
		}
	}
	return string;
};
const preserveConsecutiveUppercase = (input, toLowerCase) => {
	LEADING_CAPITAL.lastIndex = 0;
	return input.replaceAll(LEADING_CAPITAL, (match) => toLowerCase(match));
};
const postProcess = (input, toUpperCase) => {
	SEPARATORS_AND_IDENTIFIER.lastIndex = 0;
	NUMBERS_AND_IDENTIFIER.lastIndex = 0;
	return input.replaceAll(NUMBERS_AND_IDENTIFIER, (match, pattern, offset) => ["_", "-"].includes(input.charAt(offset + match.length)) ? match : toUpperCase(match)).replaceAll(SEPARATORS_AND_IDENTIFIER, (_, identifier) => toUpperCase(identifier));
};
function camelCase(input, options) {
	if (!(typeof input === "string" || Array.isArray(input))) throw new TypeError("Expected the input to be `string | string[]`");
	options = {
		pascalCase: false,
		preserveConsecutiveUppercase: false,
		...options
	};
	if (Array.isArray(input)) input = input.map((x) => x.trim()).filter((x) => x.length).join("-");
	else input = input.trim();
	if (input.length === 0) return "";
	const toLowerCase = options.locale === false ? (string) => string.toLowerCase() : (string) => string.toLocaleLowerCase(options.locale);
	const toUpperCase = options.locale === false ? (string) => string.toUpperCase() : (string) => string.toLocaleUpperCase(options.locale);
	if (input.length === 1) {
		if (SEPARATORS.test(input)) return "";
		return options.pascalCase ? toUpperCase(input) : toLowerCase(input);
	}
	if (input !== toLowerCase(input)) input = preserveCamelCase(input, toLowerCase, toUpperCase, options.preserveConsecutiveUppercase);
	input = input.replace(LEADING_SEPARATORS, "");
	input = options.preserveConsecutiveUppercase ? preserveConsecutiveUppercase(input, toLowerCase) : toLowerCase(input);
	if (options.pascalCase) input = toUpperCase(input.charAt(0)) + input.slice(1);
	return postProcess(input, toUpperCase);
}
//#endregion
//#region ../../node_modules/.pnpm/ansi-regex@5.0.1/node_modules/ansi-regex/index.js
var require_ansi_regex = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = ({ onlyFirst = false } = {}) => {
		const pattern = ["[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)", "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))"].join("|");
		return new RegExp(pattern, onlyFirst ? void 0 : "g");
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/strip-ansi@6.0.1/node_modules/strip-ansi/index.js
var require_strip_ansi = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const ansiRegex = require_ansi_regex();
	module.exports = (string) => typeof string === "string" ? string.replace(ansiRegex(), "") : string;
}));
//#endregion
//#region ../../node_modules/.pnpm/is-fullwidth-code-point@3.0.0/node_modules/is-fullwidth-code-point/index.js
var require_is_fullwidth_code_point = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const isFullwidthCodePoint = (codePoint) => {
		if (Number.isNaN(codePoint)) return false;
		if (codePoint >= 4352 && (codePoint <= 4447 || codePoint === 9001 || codePoint === 9002 || 11904 <= codePoint && codePoint <= 12871 && codePoint !== 12351 || 12880 <= codePoint && codePoint <= 19903 || 19968 <= codePoint && codePoint <= 42182 || 43360 <= codePoint && codePoint <= 43388 || 44032 <= codePoint && codePoint <= 55203 || 63744 <= codePoint && codePoint <= 64255 || 65040 <= codePoint && codePoint <= 65049 || 65072 <= codePoint && codePoint <= 65131 || 65281 <= codePoint && codePoint <= 65376 || 65504 <= codePoint && codePoint <= 65510 || 110592 <= codePoint && codePoint <= 110593 || 127488 <= codePoint && codePoint <= 127569 || 131072 <= codePoint && codePoint <= 262141)) return true;
		return false;
	};
	module.exports = isFullwidthCodePoint;
	module.exports.default = isFullwidthCodePoint;
}));
//#endregion
//#region ../../node_modules/.pnpm/emoji-regex@8.0.0/node_modules/emoji-regex/index.js
var require_emoji_regex = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = function() {
		return /\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62(?:\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67|\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74|\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73)\uDB40\uDC7F|\uD83D\uDC68(?:\uD83C\uDFFC\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68\uD83C\uDFFB|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFE])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFD])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFC])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83D\uDC68|(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D[\uDC66\uDC67])|[\u2695\u2696\u2708]\uFE0F|\uD83D[\uDC66\uDC67]|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|(?:\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708])\uFE0F|\uD83C\uDFFB\u200D(?:\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C[\uDFFB-\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFB\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFC\u200D\uD83E\uDD1D\u200D\uD83D\uDC69)\uD83C\uDFFB|\uD83E\uDDD1(?:\uD83C\uDFFF\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1(?:\uD83C[\uDFFB-\uDFFF])|\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1)|(?:\uD83E\uDDD1\uD83C\uDFFE\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFF\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB-\uDFFE])|(?:\uD83E\uDDD1\uD83C\uDFFC\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFD\u200D\uD83E\uDD1D\u200D\uD83D\uDC69)(?:\uD83C[\uDFFB\uDFFC])|\uD83D\uDC69(?:\uD83C\uDFFE\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFB\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFC-\uDFFF])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|(?:\uD83E\uDDD1\uD83C\uDFFD\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFE\u200D\uD83E\uDD1D\u200D\uD83D\uDC69)(?:\uD83C[\uDFFB-\uDFFD])|\uD83D\uDC69\u200D\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D[\uDC66\uDC67])|(?:\uD83D\uDC41\uFE0F\u200D\uD83D\uDDE8|\uD83D\uDC69(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|(?:(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)\uFE0F|\uD83D\uDC6F|\uD83E[\uDD3C\uDDDE\uDDDF])\u200D[\u2640\u2642]|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uD83C[\uDFFB-\uDFFF])\u200D[\u2640\u2642]|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD6-\uDDDD])(?:(?:\uD83C[\uDFFB-\uDFFF])\u200D[\u2640\u2642]|\u200D[\u2640\u2642])|\uD83C\uDFF4\u200D\u2620)\uFE0F|\uD83D\uDC69\u200D\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08|\uD83D\uDC15\u200D\uD83E\uDDBA|\uD83D\uDC69\u200D\uD83D\uDC66|\uD83D\uDC69\u200D\uD83D\uDC67|\uD83C\uDDFD\uD83C\uDDF0|\uD83C\uDDF4\uD83C\uDDF2|\uD83C\uDDF6\uD83C\uDDE6|[#\*0-9]\uFE0F\u20E3|\uD83C\uDDE7(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF])|\uD83C\uDDF9(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF])|\uD83C\uDDEA(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA])|\uD83E\uDDD1(?:\uD83C[\uDFFB-\uDFFF])|\uD83C\uDDF7(?:\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC])|\uD83D\uDC69(?:\uD83C[\uDFFB-\uDFFF])|\uD83C\uDDF2(?:\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF])|\uD83C\uDDE6(?:\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF])|\uD83C\uDDF0(?:\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF])|\uD83C\uDDED(?:\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA])|\uD83C\uDDE9(?:\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF])|\uD83C\uDDFE(?:\uD83C[\uDDEA\uDDF9])|\uD83C\uDDEC(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE])|\uD83C\uDDF8(?:\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF])|\uD83C\uDDEB(?:\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7])|\uD83C\uDDF5(?:\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE])|\uD83C\uDDFB(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA])|\uD83C\uDDF3(?:\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF])|\uD83C\uDDE8(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF5\uDDF7\uDDFA-\uDDFF])|\uD83C\uDDF1(?:\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE])|\uD83C\uDDFF(?:\uD83C[\uDDE6\uDDF2\uDDFC])|\uD83C\uDDFC(?:\uD83C[\uDDEB\uDDF8])|\uD83C\uDDFA(?:\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF])|\uD83C\uDDEE(?:\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9])|\uD83C\uDDEF(?:\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5])|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uD83C[\uDFFB-\uDFFF])|(?:[\u261D\u270A-\u270D]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC70\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDCAA\uDD74\uDD7A\uDD90\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD0F\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD36\uDDB5\uDDB6\uDDBB\uDDD2-\uDDD5])(?:\uD83C[\uDFFB-\uDFFF])|(?:[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF93\uDFA0-\uDFCA\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF4\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC3E\uDC40\uDC42-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDD7A\uDD95\uDD96\uDDA4\uDDFB-\uDE4F\uDE80-\uDEC5\uDECC\uDED0-\uDED2\uDED5\uDEEB\uDEEC\uDEF4-\uDEFA\uDFE0-\uDFEB]|\uD83E[\uDD0D-\uDD3A\uDD3C-\uDD45\uDD47-\uDD71\uDD73-\uDD76\uDD7A-\uDDA2\uDDA5-\uDDAA\uDDAE-\uDDCA\uDDCD-\uDDFF\uDE70-\uDE73\uDE78-\uDE7A\uDE80-\uDE82\uDE90-\uDE95])|(?:[#\*0-9\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u261D\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692-\u2697\u2699\u269B\u269C\u26A0\u26A1\u26AA\u26AB\u26B0\u26B1\u26BD\u26BE\u26C4\u26C5\u26C8\u26CE\u26CF\u26D1\u26D3\u26D4\u26E9\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|\uD83C[\uDC04\uDCCF\uDD70\uDD71\uDD7E\uDD7F\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE02\uDE1A\uDE2F\uDE32-\uDE3A\uDE50\uDE51\uDF00-\uDF21\uDF24-\uDF93\uDF96\uDF97\uDF99-\uDF9B\uDF9E-\uDFF0\uDFF3-\uDFF5\uDFF7-\uDFFF]|\uD83D[\uDC00-\uDCFD\uDCFF-\uDD3D\uDD49-\uDD4E\uDD50-\uDD67\uDD6F\uDD70\uDD73-\uDD7A\uDD87\uDD8A-\uDD8D\uDD90\uDD95\uDD96\uDDA4\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA-\uDE4F\uDE80-\uDEC5\uDECB-\uDED2\uDED5\uDEE0-\uDEE5\uDEE9\uDEEB\uDEEC\uDEF0\uDEF3-\uDEFA\uDFE0-\uDFEB]|\uD83E[\uDD0D-\uDD3A\uDD3C-\uDD45\uDD47-\uDD71\uDD73-\uDD76\uDD7A-\uDDA2\uDDA5-\uDDAA\uDDAE-\uDDCA\uDDCD-\uDDFF\uDE70-\uDE73\uDE78-\uDE7A\uDE80-\uDE82\uDE90-\uDE95])\uFE0F|(?:[\u261D\u26F9\u270A-\u270D]|\uD83C[\uDF85\uDFC2-\uDFC4\uDFC7\uDFCA-\uDFCC]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66-\uDC78\uDC7C\uDC81-\uDC83\uDC85-\uDC87\uDC8F\uDC91\uDCAA\uDD74\uDD75\uDD7A\uDD90\uDD95\uDD96\uDE45-\uDE47\uDE4B-\uDE4F\uDEA3\uDEB4-\uDEB6\uDEC0\uDECC]|\uD83E[\uDD0F\uDD18-\uDD1F\uDD26\uDD30-\uDD39\uDD3C-\uDD3E\uDDB5\uDDB6\uDDB8\uDDB9\uDDBB\uDDCD-\uDDCF\uDDD1-\uDDDD])/g;
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/string-width@4.2.3/node_modules/string-width/index.js
var require_string_width = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const stripAnsi = require_strip_ansi();
	const isFullwidthCodePoint = require_is_fullwidth_code_point();
	const emojiRegex = require_emoji_regex();
	const stringWidth = (string) => {
		if (typeof string !== "string" || string.length === 0) return 0;
		string = stripAnsi(string);
		if (string.length === 0) return 0;
		string = string.replace(emojiRegex(), "  ");
		let width = 0;
		for (let i = 0; i < string.length; i++) {
			const code = string.codePointAt(i);
			if (code <= 31 || code >= 127 && code <= 159) continue;
			if (code >= 768 && code <= 879) continue;
			if (code > 65535) i++;
			width += isFullwidthCodePoint(code) ? 2 : 1;
		}
		return width;
	};
	module.exports = stringWidth;
	module.exports.default = stringWidth;
}));
//#endregion
//#region ../../node_modules/.pnpm/ansi-styles@6.2.3/node_modules/ansi-styles/index.js
var import_ansi_align = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	const stringWidth = require_string_width();
	function ansiAlign(text, opts) {
		if (!text) return text;
		opts = opts || {};
		const align = opts.align || "center";
		if (align === "left") return text;
		const split = opts.split || "\n";
		const pad = opts.pad || " ";
		const widthDiffFn = align !== "right" ? halfDiff : fullDiff;
		let returnString = false;
		if (!Array.isArray(text)) {
			returnString = true;
			text = String(text).split(split);
		}
		let width;
		let maxWidth = 0;
		text = text.map(function(str) {
			str = String(str);
			width = stringWidth(str);
			maxWidth = Math.max(width, maxWidth);
			return {
				str,
				width
			};
		}).map(function(obj) {
			return new Array(widthDiffFn(maxWidth, obj.width) + 1).join(pad) + obj.str;
		});
		return returnString ? text.join(split) : text;
	}
	ansiAlign.left = function left(text) {
		return ansiAlign(text, { align: "left" });
	};
	ansiAlign.center = function center(text) {
		return ansiAlign(text, { align: "center" });
	};
	ansiAlign.right = function right(text) {
		return ansiAlign(text, { align: "right" });
	};
	module.exports = ansiAlign;
	function halfDiff(maxWidth, curWidth) {
		return Math.floor((maxWidth - curWidth) / 2);
	}
	function fullDiff(maxWidth, curWidth) {
		return maxWidth - curWidth;
	}
})))(), 1);
const ANSI_BACKGROUND_OFFSET = 10;
const wrapAnsi16 = (offset = 0) => (code) => `\u001B[${code + offset}m`;
const wrapAnsi256 = (offset = 0) => (code) => `\u001B[${38 + offset};5;${code}m`;
const wrapAnsi16m = (offset = 0) => (red, green, blue) => `\u001B[${38 + offset};2;${red};${green};${blue}m`;
const styles = {
	modifier: {
		reset: [0, 0],
		bold: [1, 22],
		dim: [2, 22],
		italic: [3, 23],
		underline: [4, 24],
		overline: [53, 55],
		inverse: [7, 27],
		hidden: [8, 28],
		strikethrough: [9, 29]
	},
	color: {
		black: [30, 39],
		red: [31, 39],
		green: [32, 39],
		yellow: [33, 39],
		blue: [34, 39],
		magenta: [35, 39],
		cyan: [36, 39],
		white: [37, 39],
		blackBright: [90, 39],
		gray: [90, 39],
		grey: [90, 39],
		redBright: [91, 39],
		greenBright: [92, 39],
		yellowBright: [93, 39],
		blueBright: [94, 39],
		magentaBright: [95, 39],
		cyanBright: [96, 39],
		whiteBright: [97, 39]
	},
	bgColor: {
		bgBlack: [40, 49],
		bgRed: [41, 49],
		bgGreen: [42, 49],
		bgYellow: [43, 49],
		bgBlue: [44, 49],
		bgMagenta: [45, 49],
		bgCyan: [46, 49],
		bgWhite: [47, 49],
		bgBlackBright: [100, 49],
		bgGray: [100, 49],
		bgGrey: [100, 49],
		bgRedBright: [101, 49],
		bgGreenBright: [102, 49],
		bgYellowBright: [103, 49],
		bgBlueBright: [104, 49],
		bgMagentaBright: [105, 49],
		bgCyanBright: [106, 49],
		bgWhiteBright: [107, 49]
	}
};
Object.keys(styles.modifier);
const foregroundColorNames = Object.keys(styles.color);
const backgroundColorNames = Object.keys(styles.bgColor);
[...foregroundColorNames, ...backgroundColorNames];
function assembleStyles() {
	const codes = /* @__PURE__ */ new Map();
	for (const [groupName, group] of Object.entries(styles)) {
		for (const [styleName, style] of Object.entries(group)) {
			styles[styleName] = {
				open: `\u001B[${style[0]}m`,
				close: `\u001B[${style[1]}m`
			};
			group[styleName] = styles[styleName];
			codes.set(style[0], style[1]);
		}
		Object.defineProperty(styles, groupName, {
			value: group,
			enumerable: false
		});
	}
	Object.defineProperty(styles, "codes", {
		value: codes,
		enumerable: false
	});
	styles.color.close = "\x1B[39m";
	styles.bgColor.close = "\x1B[49m";
	styles.color.ansi = wrapAnsi16();
	styles.color.ansi256 = wrapAnsi256();
	styles.color.ansi16m = wrapAnsi16m();
	styles.bgColor.ansi = wrapAnsi16(ANSI_BACKGROUND_OFFSET);
	styles.bgColor.ansi256 = wrapAnsi256(ANSI_BACKGROUND_OFFSET);
	styles.bgColor.ansi16m = wrapAnsi16m(ANSI_BACKGROUND_OFFSET);
	Object.defineProperties(styles, {
		rgbToAnsi256: {
			value(red, green, blue) {
				if (red === green && green === blue) {
					if (red < 8) return 16;
					if (red > 248) return 231;
					return Math.round((red - 8) / 247 * 24) + 232;
				}
				return 16 + 36 * Math.round(red / 255 * 5) + 6 * Math.round(green / 255 * 5) + Math.round(blue / 255 * 5);
			},
			enumerable: false
		},
		hexToRgb: {
			value(hex) {
				const matches = /[a-f\d]{6}|[a-f\d]{3}/i.exec(hex.toString(16));
				if (!matches) return [
					0,
					0,
					0
				];
				let [colorString] = matches;
				if (colorString.length === 3) colorString = [...colorString].map((character) => character + character).join("");
				const integer = Number.parseInt(colorString, 16);
				return [
					integer >> 16 & 255,
					integer >> 8 & 255,
					integer & 255
				];
			},
			enumerable: false
		},
		hexToAnsi256: {
			value: (hex) => styles.rgbToAnsi256(...styles.hexToRgb(hex)),
			enumerable: false
		},
		ansi256ToAnsi: {
			value(code) {
				if (code < 8) return 30 + code;
				if (code < 16) return 90 + (code - 8);
				let red;
				let green;
				let blue;
				if (code >= 232) {
					red = ((code - 232) * 10 + 8) / 255;
					green = red;
					blue = red;
				} else {
					code -= 16;
					const remainder = code % 36;
					red = Math.floor(code / 36) / 5;
					green = Math.floor(remainder / 6) / 5;
					blue = remainder % 6 / 5;
				}
				const value = Math.max(red, green, blue) * 2;
				if (value === 0) return 30;
				let result = 30 + (Math.round(blue) << 2 | Math.round(green) << 1 | Math.round(red));
				if (value === 2) result += 60;
				return result;
			},
			enumerable: false
		},
		rgbToAnsi: {
			value: (red, green, blue) => styles.ansi256ToAnsi(styles.rgbToAnsi256(red, green, blue)),
			enumerable: false
		},
		hexToAnsi: {
			value: (hex) => styles.ansi256ToAnsi(styles.hexToAnsi256(hex)),
			enumerable: false
		}
	});
	return styles;
}
const ansiStyles = assembleStyles();
//#endregion
//#region ../../node_modules/.pnpm/wrap-ansi@9.0.2/node_modules/wrap-ansi/index.js
const ESCAPES = new Set(["\x1B", ""]);
const END_CODE = 39;
const ANSI_ESCAPE_BELL = "\x07";
const ANSI_CSI = "[";
const ANSI_OSC = "]";
const ANSI_SGR_TERMINATOR = "m";
const ANSI_ESCAPE_LINK = `${ANSI_OSC}8;;`;
const wrapAnsiCode = (code) => `${ESCAPES.values().next().value}${ANSI_CSI}${code}${ANSI_SGR_TERMINATOR}`;
const wrapAnsiHyperlink = (url) => `${ESCAPES.values().next().value}${ANSI_ESCAPE_LINK}${url}${ANSI_ESCAPE_BELL}`;
const wordLengths = (string) => string.split(" ").map((character) => stringWidth(character));
const wrapWord = (rows, word, columns) => {
	const characters = [...word];
	let isInsideEscape = false;
	let isInsideLinkEscape = false;
	let visible = stringWidth(stripAnsi(rows.at(-1)));
	for (const [index, character] of characters.entries()) {
		const characterLength = stringWidth(character);
		if (visible + characterLength <= columns) rows[rows.length - 1] += character;
		else {
			rows.push(character);
			visible = 0;
		}
		if (ESCAPES.has(character)) {
			isInsideEscape = true;
			isInsideLinkEscape = characters.slice(index + 1, index + 1 + ANSI_ESCAPE_LINK.length).join("") === ANSI_ESCAPE_LINK;
		}
		if (isInsideEscape) {
			if (isInsideLinkEscape) {
				if (character === ANSI_ESCAPE_BELL) {
					isInsideEscape = false;
					isInsideLinkEscape = false;
				}
			} else if (character === ANSI_SGR_TERMINATOR) isInsideEscape = false;
			continue;
		}
		visible += characterLength;
		if (visible === columns && index < characters.length - 1) {
			rows.push("");
			visible = 0;
		}
	}
	if (!visible && rows.at(-1).length > 0 && rows.length > 1) rows[rows.length - 2] += rows.pop();
};
const stringVisibleTrimSpacesRight = (string) => {
	const words = string.split(" ");
	let last = words.length;
	while (last > 0) {
		if (stringWidth(words[last - 1]) > 0) break;
		last--;
	}
	if (last === words.length) return string;
	return words.slice(0, last).join(" ") + words.slice(last).join("");
};
const exec = (string, columns, options = {}) => {
	if (options.trim !== false && string.trim() === "") return "";
	let returnValue = "";
	let escapeCode;
	let escapeUrl;
	const lengths = wordLengths(string);
	let rows = [""];
	for (const [index, word] of string.split(" ").entries()) {
		if (options.trim !== false) rows[rows.length - 1] = rows.at(-1).trimStart();
		let rowLength = stringWidth(rows.at(-1));
		if (index !== 0) {
			if (rowLength >= columns && (options.wordWrap === false || options.trim === false)) {
				rows.push("");
				rowLength = 0;
			}
			if (rowLength > 0 || options.trim === false) {
				rows[rows.length - 1] += " ";
				rowLength++;
			}
		}
		if (options.hard && lengths[index] > columns) {
			const remainingColumns = columns - rowLength;
			const breaksStartingThisLine = 1 + Math.floor((lengths[index] - remainingColumns - 1) / columns);
			if (Math.floor((lengths[index] - 1) / columns) < breaksStartingThisLine) rows.push("");
			wrapWord(rows, word, columns);
			continue;
		}
		if (rowLength + lengths[index] > columns && rowLength > 0 && lengths[index] > 0) {
			if (options.wordWrap === false && rowLength < columns) {
				wrapWord(rows, word, columns);
				continue;
			}
			rows.push("");
		}
		if (rowLength + lengths[index] > columns && options.wordWrap === false) {
			wrapWord(rows, word, columns);
			continue;
		}
		rows[rows.length - 1] += word;
	}
	if (options.trim !== false) rows = rows.map((row) => stringVisibleTrimSpacesRight(row));
	const preString = rows.join("\n");
	const pre = [...preString];
	let preStringIndex = 0;
	for (const [index, character] of pre.entries()) {
		returnValue += character;
		if (ESCAPES.has(character)) {
			const { groups } = new RegExp(`(?:\\${ANSI_CSI}(?<code>\\d+)m|\\${ANSI_ESCAPE_LINK}(?<uri>.*)${ANSI_ESCAPE_BELL})`).exec(preString.slice(preStringIndex)) || { groups: {} };
			if (groups.code !== void 0) {
				const code = Number.parseFloat(groups.code);
				escapeCode = code === END_CODE ? void 0 : code;
			} else if (groups.uri !== void 0) escapeUrl = groups.uri.length === 0 ? void 0 : groups.uri;
		}
		const code = ansiStyles.codes.get(Number(escapeCode));
		if (pre[index + 1] === "\n") {
			if (escapeUrl) returnValue += wrapAnsiHyperlink("");
			if (escapeCode && code) returnValue += wrapAnsiCode(code);
		} else if (character === "\n") {
			if (escapeCode && code) returnValue += wrapAnsiCode(escapeCode);
			if (escapeUrl) returnValue += wrapAnsiHyperlink(escapeUrl);
		}
		preStringIndex += character.length;
	}
	return returnValue;
};
function wrapAnsi(string, columns, options) {
	return String(string).normalize().replaceAll("\r\n", "\n").split("\n").map((line) => exec(line, columns, options)).join("\n");
}
//#endregion
//#region ../../node_modules/.pnpm/boxen@8.0.1/node_modules/boxen/index.js
const NEWLINE = "\n";
const PAD = " ";
const NONE = "none";
const terminalColumns = () => {
	const { env, stdout, stderr } = node_process.default;
	if (stdout?.columns) return stdout.columns;
	if (stderr?.columns) return stderr.columns;
	if (env.COLUMNS) return Number.parseInt(env.COLUMNS, 10);
	return 80;
};
const getObject = (detail) => typeof detail === "number" ? {
	top: detail,
	right: detail * 3,
	bottom: detail,
	left: detail * 3
} : {
	top: 0,
	right: 0,
	bottom: 0,
	left: 0,
	...detail
};
const getBorderWidth = (borderStyle) => borderStyle === NONE ? 0 : 2;
const getBorderChars = (borderStyle) => {
	const sides = [
		"topLeft",
		"topRight",
		"bottomRight",
		"bottomLeft",
		"left",
		"right",
		"top",
		"bottom"
	];
	let characters;
	if (borderStyle === NONE) {
		borderStyle = {};
		for (const side of sides) borderStyle[side] = "";
	}
	if (typeof borderStyle === "string") {
		characters = import_cli_boxes.default[borderStyle];
		if (!characters) throw new TypeError(`Invalid border style: ${borderStyle}`);
	} else {
		if (typeof borderStyle?.vertical === "string") {
			borderStyle.left = borderStyle.vertical;
			borderStyle.right = borderStyle.vertical;
		}
		if (typeof borderStyle?.horizontal === "string") {
			borderStyle.top = borderStyle.horizontal;
			borderStyle.bottom = borderStyle.horizontal;
		}
		for (const side of sides) if (borderStyle[side] === null || typeof borderStyle[side] !== "string") throw new TypeError(`Invalid border style: ${side}`);
		characters = borderStyle;
	}
	return characters;
};
const makeTitle = (text, horizontal, alignment) => {
	let title = "";
	const textWidth = stringWidth(text);
	switch (alignment) {
		case "left":
			title = text + horizontal.slice(textWidth);
			break;
		case "right":
			title = horizontal.slice(textWidth) + text;
			break;
		default:
			horizontal = horizontal.slice(textWidth);
			if (horizontal.length % 2 === 1) {
				horizontal = horizontal.slice(Math.floor(horizontal.length / 2));
				title = horizontal.slice(1) + text + horizontal;
			} else {
				horizontal = horizontal.slice(horizontal.length / 2);
				title = horizontal + text + horizontal;
			}
			break;
	}
	return title;
};
const makeContentText = (text, { padding, width, textAlignment, height }) => {
	text = (0, import_ansi_align.default)(text, { align: textAlignment });
	let lines = text.split(NEWLINE);
	const textWidth = widestLine(text);
	const max = width - padding.left - padding.right;
	if (textWidth > max) {
		const newLines = [];
		for (const line of lines) {
			const alignedLinesArray = (0, import_ansi_align.default)(wrapAnsi(line, max, { hard: true }), { align: textAlignment }).split("\n");
			const longestLength = Math.max(...alignedLinesArray.map((s) => stringWidth(s)));
			for (const alignedLine of alignedLinesArray) {
				let paddedLine;
				switch (textAlignment) {
					case "center":
						paddedLine = PAD.repeat((max - longestLength) / 2) + alignedLine;
						break;
					case "right":
						paddedLine = PAD.repeat(max - longestLength) + alignedLine;
						break;
					default:
						paddedLine = alignedLine;
						break;
				}
				newLines.push(paddedLine);
			}
		}
		lines = newLines;
	}
	if (textAlignment === "center" && textWidth < max) lines = lines.map((line) => PAD.repeat((max - textWidth) / 2) + line);
	else if (textAlignment === "right" && textWidth < max) lines = lines.map((line) => PAD.repeat(max - textWidth) + line);
	const paddingLeft = PAD.repeat(padding.left);
	const paddingRight = PAD.repeat(padding.right);
	lines = lines.map((line) => {
		const newLine = paddingLeft + line + paddingRight;
		return newLine + PAD.repeat(width - stringWidth(newLine));
	});
	if (padding.top > 0) lines = [...Array.from({ length: padding.top }).fill(PAD.repeat(width)), ...lines];
	if (padding.bottom > 0) lines = [...lines, ...Array.from({ length: padding.bottom }).fill(PAD.repeat(width))];
	if (height && lines.length > height) lines = lines.slice(0, height);
	else if (height && lines.length < height) lines = [...lines, ...Array.from({ length: height - lines.length }).fill(PAD.repeat(width))];
	return lines.join(NEWLINE);
};
const boxContent = (content, contentWidth, options) => {
	const colorizeBorder = (border) => {
		const newBorder = options.borderColor ? getColorFunction(options.borderColor)(border) : border;
		return options.dimBorder ? chalk.dim(newBorder) : newBorder;
	};
	const colorizeContent = (content) => options.backgroundColor ? getBGColorFunction(options.backgroundColor)(content) : content;
	const chars = getBorderChars(options.borderStyle);
	const columns = terminalColumns();
	let marginLeft = PAD.repeat(options.margin.left);
	if (options.float === "center") {
		const marginWidth = Math.max((columns - contentWidth - getBorderWidth(options.borderStyle)) / 2, 0);
		marginLeft = PAD.repeat(marginWidth);
	} else if (options.float === "right") {
		const marginWidth = Math.max(columns - contentWidth - options.margin.right - getBorderWidth(options.borderStyle), 0);
		marginLeft = PAD.repeat(marginWidth);
	}
	let result = "";
	if (options.margin.top) result += NEWLINE.repeat(options.margin.top);
	if (options.borderStyle !== NONE || options.title) result += colorizeBorder(marginLeft + chars.topLeft + (options.title ? makeTitle(options.title, chars.top.repeat(contentWidth), options.titleAlignment) : chars.top.repeat(contentWidth)) + chars.topRight) + NEWLINE;
	const lines = content.split(NEWLINE);
	result += lines.map((line) => marginLeft + colorizeBorder(chars.left) + colorizeContent(line) + colorizeBorder(chars.right)).join(NEWLINE);
	if (options.borderStyle !== NONE) result += NEWLINE + colorizeBorder(marginLeft + chars.bottomLeft + chars.bottom.repeat(contentWidth) + chars.bottomRight);
	if (options.margin.bottom) result += NEWLINE.repeat(options.margin.bottom);
	return result;
};
const sanitizeOptions = (options) => {
	if (options.fullscreen && node_process.default?.stdout) {
		let newDimensions = [node_process.default.stdout.columns, node_process.default.stdout.rows];
		if (typeof options.fullscreen === "function") newDimensions = options.fullscreen(...newDimensions);
		options.width ||= newDimensions[0];
		options.height ||= newDimensions[1];
	}
	options.width &&= Math.max(1, options.width - getBorderWidth(options.borderStyle));
	options.height &&= Math.max(1, options.height - getBorderWidth(options.borderStyle));
	return options;
};
const formatTitle = (title, borderStyle) => borderStyle === NONE ? title : ` ${title} `;
const determineDimensions = (text, options) => {
	options = sanitizeOptions(options);
	const widthOverride = options.width !== void 0;
	const columns = terminalColumns();
	const borderWidth = getBorderWidth(options.borderStyle);
	const maxWidth = columns - options.margin.left - options.margin.right - borderWidth;
	const widest = widestLine(wrapAnsi(text, columns - borderWidth, {
		hard: true,
		trim: false
	})) + options.padding.left + options.padding.right;
	if (options.title && widthOverride) {
		options.title = options.title.slice(0, Math.max(0, options.width - 2));
		options.title &&= formatTitle(options.title, options.borderStyle);
	} else if (options.title) {
		options.title = options.title.slice(0, Math.max(0, maxWidth - 2));
		if (options.title) {
			options.title = formatTitle(options.title, options.borderStyle);
			if (stringWidth(options.title) > widest) options.width = stringWidth(options.title);
		}
	}
	options.width ||= widest;
	if (!widthOverride) {
		if (options.margin.left && options.margin.right && options.width > maxWidth) {
			const multiplier = (columns - options.width - borderWidth) / (options.margin.left + options.margin.right);
			options.margin.left = Math.max(0, Math.floor(options.margin.left * multiplier));
			options.margin.right = Math.max(0, Math.floor(options.margin.right * multiplier));
		}
		options.width = Math.min(options.width, columns - borderWidth - options.margin.left - options.margin.right);
	}
	if (options.width - (options.padding.left + options.padding.right) <= 0) {
		options.padding.left = 0;
		options.padding.right = 0;
	}
	if (options.height && options.height - (options.padding.top + options.padding.bottom) <= 0) {
		options.padding.top = 0;
		options.padding.bottom = 0;
	}
	return options;
};
const isHex = (color) => color.match(/^#(?:[0-f]{3}){1,2}$/i);
const isColorValid = (color) => typeof color === "string" && (chalk[color] ?? isHex(color));
const getColorFunction = (color) => isHex(color) ? chalk.hex(color) : chalk[color];
const getBGColorFunction = (color) => isHex(color) ? chalk.bgHex(color) : chalk[camelCase(["bg", color])];
function boxen(text, options) {
	options = {
		padding: 0,
		borderStyle: "single",
		dimBorder: false,
		textAlignment: "left",
		float: "left",
		titleAlignment: "left",
		...options
	};
	if (options.align) options.textAlignment = options.align;
	if (options.borderColor && !isColorValid(options.borderColor)) throw new Error(`${options.borderColor} is not a valid borderColor`);
	if (options.backgroundColor && !isColorValid(options.backgroundColor)) throw new Error(`${options.backgroundColor} is not a valid backgroundColor`);
	options.padding = getObject(options.padding);
	options.margin = getObject(options.margin);
	options = determineDimensions(text, options);
	text = makeContentText(text, options);
	return boxContent(text, options.width, options);
}
//#endregion
//#region src/cli-box.ts
const createBox = (options) => boxen(options.content, {
	padding: {
		left: 3,
		right: 3,
		top: 1,
		bottom: 1
	},
	borderColor: "magenta",
	borderStyle: "round",
	title: options.title,
	titleAlignment: "center"
});
//#endregion
//#region src/tsconfig-utils.ts
/**
* If `filename` points to a `.json` file that exists as a regular file, return its absolute path.
*/
async function resolveDirectTsconfigJson(filename) {
	if (node_path.default.extname(filename) !== ".json") return null;
	const resolved = node_path.default.resolve(filename);
	try {
		const stat = await node_fs.promises.stat(resolved);
		if (stat.isFile() || stat.isFIFO()) return resolved;
		throw new Error(`${filename} exists but is not a regular file.`);
	} catch (e) {
		if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") return null;
		throw e;
	}
}
/**
* Walk upward from `dirname(filename)` and return the first existing `configName`,
* stopping at `root` (inclusive) or the filesystem root.
*/
async function findClosestTsconfig(filename, root, configName = "tsconfig.json") {
	const resolvedRoot = node_path.default.resolve(root);
	let dir = node_path.default.dirname(node_path.default.resolve(filename));
	for (;;) {
		const candidate = node_path.default.join(dir, configName);
		try {
			const stat = await node_fs.promises.stat(candidate);
			if (stat.isFile() || stat.isFIFO()) return candidate;
		} catch {}
		if (dir === resolvedRoot || node_path.default.dirname(dir) === dir) return null;
		dir = node_path.default.dirname(dir);
	}
}
/**
* Resolve `compilerOptions.baseUrl` the same way TypeScript does: relative to the tsconfig file.
* Falls back to `cwd` when `baseUrl` is omitted.
*/
function resolveBaseUrlForCompilerOptions(baseUrl, tsconfigFile, cwd) {
	if (baseUrl == null) return cwd;
	if (baseUrl.startsWith("${")) return baseUrl;
	if (node_path.default.isAbsolute(baseUrl)) return baseUrl;
	return node_path.default.resolve(node_path.default.dirname(tsconfigFile), baseUrl);
}
const SOURCE_EXTENSIONS = [
	".ts",
	".tsx",
	".mts",
	".cts"
];
function resolveReferencedTsconfigPath(refPath, fromDir, configName = "tsconfig.json") {
	const p = refPath.endsWith(".json") ? refPath : node_path.default.join(refPath, configName);
	return node_path.default.resolve(fromDir, p);
}
/**
* When a file belongs to a referenced project (TypeScript project references),
* return that project's merged tsconfig for `compilerOptions`.
*/
async function resolveSolutionTsconfigForFile(absoluteFilename, rootTsconfigPath, rootParsed, getTsconfigModule, cache) {
	const { parseTsconfig } = getTsconfigModule;
	if (isSourceFileIncludedInTsconfig(absoluteFilename, rootTsconfigPath, rootParsed)) return {
		tsconfig: rootParsed,
		tsconfigFile: rootTsconfigPath
	};
	const refs = rootParsed.references;
	if (!refs?.length) return {
		tsconfig: rootParsed,
		tsconfigFile: rootTsconfigPath
	};
	if (!SOURCE_EXTENSIONS.some((ext) => absoluteFilename.endsWith(ext))) return {
		tsconfig: rootParsed,
		tsconfigFile: rootTsconfigPath
	};
	const rootDir = node_path.default.dirname(rootTsconfigPath);
	for (const ref of refs) {
		const refPath = resolveReferencedTsconfigPath(ref.path, rootDir);
		try {
			await node_fs.promises.access(refPath);
		} catch {
			continue;
		}
		const childParsed = parseTsconfig(refPath, cache);
		if (isSourceFileIncludedInTsconfig(absoluteFilename, refPath, childParsed)) return {
			tsconfig: childParsed,
			tsconfigFile: refPath
		};
	}
	return {
		tsconfig: rootParsed,
		tsconfigFile: rootTsconfigPath
	};
}
const POSIX_SEP_RE = new RegExp("\\" + node_path.default.posix.sep, "g");
const NATIVE_SEP_RE = new RegExp("\\" + node_path.default.sep, "g");
const PATTERN_REGEX_CACHE = /* @__PURE__ */ new Map();
const GLOB_ALL_PATTERN = `**/*`;
const TS_EXTENSIONS = [
	".ts",
	".tsx",
	".mts",
	".cts"
];
const TSJS_EXTENSIONS = TS_EXTENSIONS.concat([
	".js",
	".jsx",
	".mjs",
	".cjs"
]);
const TS_EXTENSIONS_RE_GROUP = `\\.(?:${TS_EXTENSIONS.map((ext) => ext.slice(1)).join("|")})`;
const TSJS_EXTENSIONS_RE_GROUP = `\\.(?:${TSJS_EXTENSIONS.map((ext) => ext.slice(1)).join("|")})`;
const IS_POSIX = node_path.default.posix.sep === node_path.default.sep;
const native2posix = IS_POSIX ? (filename) => filename : (filename) => filename.replace(NATIVE_SEP_RE, node_path.default.posix.sep);
const resolve2posix = IS_POSIX ? (dir, filename) => dir ? node_path.default.resolve(dir, filename) : node_path.default.resolve(filename) : (dir, filename) => {
	const posix2native = (f) => f.replace(POSIX_SEP_RE, node_path.default.sep);
	return native2posix(dir ? node_path.default.resolve(posix2native(dir), posix2native(filename)) : node_path.default.resolve(posix2native(filename)));
};
function isGlobMatch(filename, dir, patterns, allowJs) {
	const extensions = allowJs ? TSJS_EXTENSIONS : TS_EXTENSIONS;
	return patterns.some((patternArg) => {
		let pattern = patternArg;
		let lastWildcardIndex = pattern.length;
		let hasWildcard = false;
		let hasExtension = false;
		let hasSlash = false;
		let lastSlashIndex = -1;
		for (let i = pattern.length - 1; i > -1; i--) {
			const c = pattern[i];
			if (!hasWildcard) {
				if (c === "*" || c === "?") {
					lastWildcardIndex = i;
					hasWildcard = true;
				}
			}
			if (!hasSlash) {
				if (c === ".") hasExtension = true;
				else if (c === "/") {
					lastSlashIndex = i;
					hasSlash = true;
				}
			}
			if (hasWildcard && hasSlash) break;
		}
		if (!hasExtension && (!hasWildcard || lastWildcardIndex < lastSlashIndex)) {
			pattern += `${pattern.endsWith("/") ? "" : "/"}${GLOB_ALL_PATTERN}`;
			lastWildcardIndex = pattern.length - 1;
			hasWildcard = true;
		}
		if (lastWildcardIndex < pattern.length - 1 && !filename.endsWith(pattern.slice(lastWildcardIndex + 1))) return false;
		if (pattern.endsWith("*") && !extensions.some((ext) => filename.endsWith(ext))) return false;
		if (pattern === GLOB_ALL_PATTERN) return filename.startsWith(`${dir}/`);
		const resolvedPattern = resolve2posix(dir, pattern);
		let firstWildcardIndex = -1;
		for (let i = 0; i < resolvedPattern.length; i++) if (resolvedPattern[i] === "*" || resolvedPattern[i] === "?") {
			firstWildcardIndex = i;
			hasWildcard = true;
			break;
		}
		if (firstWildcardIndex > 1 && !filename.startsWith(resolvedPattern.slice(0, firstWildcardIndex - 1))) return false;
		if (!hasWildcard) return filename === resolvedPattern;
		if (firstWildcardIndex + GLOB_ALL_PATTERN.length === resolvedPattern.length - (pattern.length - 1 - lastWildcardIndex) && resolvedPattern.slice(firstWildcardIndex, firstWildcardIndex + GLOB_ALL_PATTERN.length) === GLOB_ALL_PATTERN) return true;
		if (PATTERN_REGEX_CACHE.has(resolvedPattern)) return PATTERN_REGEX_CACHE.get(resolvedPattern).test(filename);
		const regex = pattern2regex(resolvedPattern, allowJs);
		PATTERN_REGEX_CACHE.set(resolvedPattern, regex);
		return regex.test(filename);
	});
}
function pattern2regex(resolvedPattern, allowJs) {
	let regexStr = "^";
	for (let i = 0; i < resolvedPattern.length; i++) {
		const char = resolvedPattern[i];
		if (char === "?") {
			regexStr += "[^\\/]";
			continue;
		}
		if (char === "*") {
			if (resolvedPattern[i + 1] === "*" && resolvedPattern[i + 2] === "/") {
				i += 2;
				regexStr += "(?:[^\\/]*\\/)*";
				continue;
			}
			regexStr += "[^\\/]*";
			continue;
		}
		if ("/.+^${}()|[]\\".includes(char)) regexStr += "\\";
		regexStr += char;
	}
	if (resolvedPattern.endsWith("*")) regexStr += allowJs ? TSJS_EXTENSIONS_RE_GROUP : TS_EXTENSIONS_RE_GROUP;
	regexStr += "$";
	return new RegExp(regexStr);
}
function isIncluded(filename, tsconfigFile, tsconfig) {
	const dir = native2posix(node_path.default.dirname(tsconfigFile));
	const files = (tsconfig.files || []).map((file) => resolve2posix(dir, file));
	const absoluteFilename = resolve2posix(null, filename);
	if (files.includes(filename)) return true;
	const allowJs = tsconfig.compilerOptions?.allowJs;
	if (isGlobMatch(absoluteFilename, dir, tsconfig.include || (tsconfig.files ? [] : [GLOB_ALL_PATTERN]), allowJs)) return !isGlobMatch(absoluteFilename, dir, tsconfig.exclude || [], allowJs);
	return false;
}
/** Whether `absoluteFilename` is part of the compilation set defined by this tsconfig. */
function isSourceFileIncludedInTsconfig(absoluteFilename, tsconfigFile, tsconfig) {
	return isIncluded(absoluteFilename, tsconfigFile, tsconfig);
}
//#endregion
//#region src/load-tsconfig.ts
const readPathsFromCache = (cache) => {
	const prefix = "readFileSync:";
	const suffix = ":utf8";
	return Array.from(cache.keys()).filter((key) => key.startsWith(prefix) && key.endsWith(suffix)).map((key) => key.slice(13, -5));
};
/**
* Exact tsconfig files read while producing one resolved Node config.
*
* This metadata is deliberately kept outside `LoadConfigResult`: it is incremental resolver
* provenance, not Bamboo configuration, and must therefore neither participate in
* `diffConfigs` nor become part of the public/serialized config shape.
*/
const resolutionFilesByConfig = /* @__PURE__ */ new WeakMap();
const rememberTsConfigResolutionFiles = (conf, files) => {
	resolutionFilesByConfig.set(conf, Object.freeze([...new Set(files)].sort()));
};
const getTsConfigResolutionFiles = (conf) => resolutionFilesByConfig.get(conf) ?? Object.freeze(conf.tsconfigFile ? [node_path.default.resolve(conf.tsconfigFile)] : []);
const referencedTsconfigPath = (reference, rootPath) => node_path.default.resolve(node_path.default.dirname(rootPath), reference.endsWith(".json") ? reference : node_path.default.join(reference, "tsconfig.json"));
const MAX_TSCONFIG_REFERENCE_FILES = 256;
const getImplicitBaseUrl = (compilerOptions) => {
	if (!compilerOptions) return void 0;
	const matches = Object.getOwnPropertySymbols(compilerOptions).filter((candidate) => candidate.description === "implicitBaseUrl");
	if (matches.length !== 1) return void 0;
	const symbol = matches[0];
	const descriptor = Object.getOwnPropertyDescriptor(compilerOptions, symbol);
	if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") return void 0;
	return {
		owner: compilerOptions,
		symbol,
		value: descriptor.value
	};
};
const collectReferenceGraph = async (rootPath, rootParsed, parseTsconfig, cache) => {
	const references = [];
	const unresolvedReferences = [];
	let traversalLimitExceeded = false;
	const visited = new Set([node_path.default.resolve(rootPath)]);
	const queue = [{
		parsed: rootParsed,
		path: rootPath
	}];
	for (let index = 0; index < queue.length; index++) {
		const current = queue[index];
		for (const reference of current.parsed.references ?? []) {
			const referencedPath = referencedTsconfigPath(reference.path, current.path);
			references.push({
				from: current.path,
				path: referencedPath
			});
			if (visited.has(referencedPath)) continue;
			if (visited.size >= MAX_TSCONFIG_REFERENCE_FILES) {
				traversalLimitExceeded = true;
				unresolvedReferences.push(referencedPath);
				continue;
			}
			visited.add(referencedPath);
			try {
				const source = await node_fs.promises.readFile(referencedPath, "utf8");
				JSON.parse(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"));
				queue.push({
					parsed: parseTsconfig(referencedPath, cache),
					path: referencedPath
				});
			} catch {
				unresolvedReferences.push(referencedPath);
			}
		}
	}
	return {
		references,
		traversalLimitExceeded,
		unresolvedReferences
	};
};
async function loadTsConfig(conf, cwd, provenance, resolutionFiles) {
	const root = cwd;
	let tsconfigFile = await resolveDirectTsconfigJson(conf.path);
	const direct = tsconfigFile !== null;
	if (!tsconfigFile) {
		if (resolutionFiles) resolutionFiles.value = Object.freeze([]);
		tsconfigFile = await findClosestTsconfig(conf.path, root, "tsconfig.json");
	}
	if (!tsconfigFile) {
		if (provenance) provenance.value = {
			direct: false,
			readPaths: [],
			references: [],
			traversalLimitExceeded: false,
			unresolvedReferences: []
		};
		return {
			tsconfig: {},
			tsconfigFile: void 0
		};
	}
	const gtc = await import("get-tsconfig");
	const cache = /* @__PURE__ */ new Map();
	const rootParsed = gtc.parseTsconfig(tsconfigFile, cache);
	const { tsconfig, tsconfigFile: effectiveTsconfigPath } = await resolveSolutionTsconfigForFile(node_path.default.resolve(conf.path), tsconfigFile, rootParsed, gtc, cache);
	const compilerOptions = tsconfig?.compilerOptions;
	const implicitBaseUrl = getImplicitBaseUrl(compilerOptions);
	const result = {
		tsconfig,
		tsconfigFile: effectiveTsconfigPath
	};
	if (resolutionFiles) resolutionFiles.value = Object.freeze([...new Set(readPathsFromCache(cache).map((file) => node_path.default.resolve(file)))].sort());
	if (compilerOptions?.paths) {
		const baseUrl = compilerOptions.baseUrl;
		result.tsOptions = {
			baseUrl,
			pathMappings: (0, _bamboocss_config.convertTsPathsToRegexes)(compilerOptions.paths, resolveBaseUrlForCompilerOptions(baseUrl, effectiveTsconfigPath, cwd))
		};
	}
	if (provenance) {
		const referenceGraph = await collectReferenceGraph(tsconfigFile, rootParsed, gtc.parseTsconfig, cache);
		provenance.value = {
			direct,
			effectivePath: effectiveTsconfigPath,
			implicitBaseUrl,
			readPaths: readPathsFromCache(cache),
			references: referenceGraph.references,
			rootPath: tsconfigFile,
			traversalLimitExceeded: referenceGraph.traversalLimitExceeded,
			unresolvedReferences: referenceGraph.unresolvedReferences
		};
	}
	return result;
}
//#endregion
//#region src/diff-engine.ts
const applyTsConfig = (conf, next) => {
	conf.tsconfig = next?.tsconfig ?? {};
	conf.tsconfigFile = next?.tsconfigFile;
	conf.tsOptions = next?.tsOptions;
};
var DiffEngine = class {
	ctx;
	prevConfig;
	constructor(ctx) {
		this.ctx = ctx;
		this.prevConfig = ctx.conf.deserialize();
	}
	/**
	* Reload config from disk and refresh the context
	*/
	async reloadConfigAndRefreshContext(fn) {
		const conf = await (0, _bamboocss_config.loadConfig)({
			cwd: this.ctx.config.cwd,
			file: this.ctx.conf.path
		});
		const resolutionFiles = {};
		const tsconfig = await loadTsConfig(conf, conf.config.cwd || this.ctx.config.cwd, void 0, resolutionFiles);
		applyTsConfig(conf, tsconfig);
		rememberTsConfigResolutionFiles(conf, resolutionFiles.value ?? []);
		const affected = this.refresh(conf, fn);
		if (!affected.hasConfigChanged) {
			applyTsConfig(this.ctx.conf, tsconfig);
			rememberTsConfigResolutionFiles(this.ctx.conf, resolutionFiles.value ?? []);
		}
		return affected;
	}
	/** @internal Exact tsconfig files behind the currently attached resolution options. */
	getResolutionConfigFiles = () => getTsConfigResolutionFiles(this.ctx.conf);
	/**
	* Update the context from the refreshed config
	* then persist the changes on each affected engines
	* Returns the list of affected artifacts/engines
	*/
	refresh(conf, fn) {
		const affected = (0, _bamboocss_config.diffConfigs)(() => conf.deserialize(), this.prevConfig);
		if (!affected.hasConfigChanged || !this.prevConfig) return affected;
		fn?.(conf);
		this.prevConfig = conf.deserialize();
		return affected;
	}
};
//#endregion
//#region src/parser-result.ts
/**
* What extraction found in one file, and the encoder calls that turn it into rules.
*
* Filled from the native analysis by `BambooContext.parseFile`; nothing here reads source.
*/
var ParserResult = class {
	context;
	/** Ordered list of all ResultItem */
	all = [];
	css = /* @__PURE__ */ new Set();
	cva = /* @__PURE__ */ new Set();
	sva = /* @__PURE__ */ new Set();
	token = /* @__PURE__ */ new Set();
	viewTransition = /* @__PURE__ */ new Set();
	recipe = /* @__PURE__ */ new Map();
	pattern = /* @__PURE__ */ new Map();
	filePath;
	encoder;
	/** Resolver targets crossed while extracting values which contributed CSS. */
	dependencies = /* @__PURE__ */ new Set();
	/** Styles the build could not fully see. @see `UnresolvedStyle` */
	unresolved = [];
	/**
	* Calls to a name the pattern or recipe entrypoint no longer exports.
	*
	* Separate from `unresolved`, which grades a call the build *did* see and could only
	* partly resolve. These it saw and could not resolve at all: the binding is dead, so every
	* rule the call would have contributed is absent rather than incomplete. Reported by
	* `assertNoDeadCalls` rather than warned about, for that reason.
	*/
	deadCalls = [];
	/**
	* Whether each result item is attributed to its call site, for a source map.
	*
	* Off for a source a `parser:before` hook rewrote: its positions are the hook's output's,
	* not the file's, and a wrong line is worse than none.
	*/
	origins = true;
	/** Set on a result the native engine produced, with the reads it reported. @internal */
	native = false;
	nativePendingCandidates = [];
	nativeConfigurationFiles = [];
	constructor(context, encoder) {
		this.context = context;
		this.encoder = encoder ?? context.encoder;
	}
	append(result) {
		this.all.push(result);
		return result;
	}
	set(name, result) {
		switch (name) {
			case "css":
				this.setCss(result);
				break;
			case "cva":
				this.setCva(result);
				break;
			case "sva":
				this.setSva(result);
				break;
			case "token":
				this.setToken(result);
				break;
			default: throw new _bamboocss_shared.BambooError("UNKNOWN_RESULT_TYPE", `Unknown parser result type: "${name}". Expected one of: css, cva, sva, token`);
		}
	}
	setCss(result) {
		this.css.add(this.append(Object.assign({ type: "css" }, result)));
		if (result.data.some(Array.isArray)) throw new _bamboocss_shared.BambooError("INVALID_STYLE_ARGUMENT", "An array is not a style argument.", { hint: "Spread it instead, e.g. css(...styles) rather than css(styles)." });
		const encoder = this.encoder;
		encoder.withOrigin(this.originOf(result), () => result.data.forEach((obj) => encoder.processAtomic(obj)));
	}
	/** The call site of `result`, when the encoder is recording them. */
	originOf = (result) => {
		if (!this.origins || !this.encoder.recordOrigins) return void 0;
		return result.atomOrigin;
	};
	setCva(result) {
		this.cva.add(this.append(Object.assign({ type: "cva" }, result)));
		const encoder = this.encoder;
		encoder.withOrigin(this.originOf(result), () => result.data.forEach((data) => encoder.processAtomicRecipe(data)));
	}
	setSva(result) {
		this.sva.add(this.append(Object.assign({ type: "sva" }, result)));
		const encoder = this.encoder;
		encoder.withOrigin(this.originOf(result), () => result.data.forEach((data) => encoder.processAtomicSlotRecipe(data)));
	}
	/**
	* `kind` separates the variable reference — `token()` — from `token.value()`, the resolved
	* literal. They share this set deliberately: everything that reads a result for the token
	* *path* wants both, and only the fold cares which half was asked for.
	*/
	setToken(result, kind = "token") {
		this.token.add(this.append(Object.assign({ type: kind }, result)));
	}
	setViewTransition(result) {
		this.viewTransition.add(this.append(Object.assign({ type: "viewTransition" }, result)));
		const encoder = this.encoder;
		result.data.forEach((obj) => encoder.processViewTransition(obj));
	}
	setPattern(name, result) {
		(0, _bamboocss_shared.getOrCreateSet)(this.pattern, name).add(this.append(Object.assign({
			type: "pattern",
			name
		}, result)));
		this.encoder.withOrigin(this.originOf(result), () => result.data.forEach((obj) => this.encoder.processPattern(name, obj)));
	}
	/**
	* @param unresolved The variant axes the call site passed and the build could not read.
	* `button({ size })` with a dynamic `size` and `button()` both arrive as `{}`, and the
	* difference decides whether a class the encoder is about to emit has a rule behind it.
	*/
	setRecipe(recipeName, result, unresolved) {
		(0, _bamboocss_shared.getOrCreateSet)(this.recipe, recipeName).add(this.append(Object.assign({ type: "recipe" }, result)));
		const encoder = this.encoder;
		const recipes = this.context.recipes;
		if (!recipes.getConfig(recipeName)) return;
		const axes = unresolved?.size ? new Set(unresolved) : void 0;
		if (result.type) result.data.forEach((data) => {
			const [recipeProps, styleProps] = recipes.splitProps(recipeName, data);
			encoder.processStyleProps(styleProps);
			encoder.processRecipe(recipeName, recipeProps, axes);
		});
		else result.data.forEach((data) => {
			encoder.processRecipe(recipeName, data, axes);
		});
	}
	isEmpty() {
		return this.all.length === 0;
	}
	setFilePath(filePath) {
		this.filePath = filePath;
		return this;
	}
	/** @internal Called with each resolver target the native evaluation crossed. */
	addDependency(filePath) {
		this.dependencies.add(filePath.replaceAll("\\", "/"));
	}
	/** Local source paths crossed while resolving values this extraction encoded. */
	getDependencies() {
		const own = this.filePath?.replaceAll("\\", "/");
		return [...this.dependencies].filter((path) => path !== own).sort();
	}
	toArray() {
		return this.all;
	}
	toJSON() {
		return {
			css: Array.from(this.css),
			cva: Array.from(this.cva),
			sva: Array.from(this.sva),
			token: Array.from(this.token),
			viewTransition: Array.from(this.viewTransition),
			recipe: Object.fromEntries(Array.from(this.recipe.entries()).map(([key, value]) => [key, Array.from(value)])),
			pattern: Object.fromEntries(Array.from(this.pattern.entries()).map(([key, value]) => [key, Array.from(value)]))
		};
	}
};
//#endregion
//#region src/source-project.ts
/**
* The source view every engine reads: disk, with caller-supplied bytes layered over it.
*
* Extraction and the Vite compiler run in Rust, and the Rust resolver reads ordinary files
* itself. What it cannot see is bytes that exist nowhere on disk — a single-file component's
* compiled script, a test's in-memory module — so those are held here, as overlays, and handed
* across the native boundary with every analysis. Nothing here parses anything.
*/
var SourceProject = class {
	options;
	/** Bytes explicitly supplied by a caller rather than read from disk, by normalized path. */
	overlays = /* @__PURE__ */ new Map();
	compilerOptions;
	constructor(options) {
		this.options = options;
		this.compilerOptions = { ...options.compilerOptions };
	}
	normalizePath = (filePath) => filePath.replaceAll("\\", "/");
	/** The `baseUrl` and `paths` module resolution reads. */
	get resolutionOptions() {
		return {
			baseUrl: this.compilerOptions.baseUrl,
			paths: this.compilerOptions.paths
		};
	}
	/** A tsconfig reload replaced the options resolution reads. */
	refreshResolutionConfiguration = (compilerOptions = {}) => {
		this.compilerOptions = { ...compilerOptions };
	};
	/** Source bytes from an overlay, else from disk; `undefined` when neither can be read. */
	getSourceText = (filePath) => {
		const overlay = this.overlays.get(this.normalizePath(filePath));
		if (overlay !== void 0) return overlay;
		try {
			return this.options.readFile(filePath);
		} catch {
			return;
		}
	};
	/** Whether that same source view can read a path. */
	sourceExists = (filePath) => this.overlays.has(this.normalizePath(filePath)) || this.options.fileExists(filePath);
	/** Whether a caller supplied bytes that can differ from the path on disk. */
	sourceIsOverridden = (filePath) => this.overlays.has(this.normalizePath(filePath));
	/** Every path a caller supplied bytes for. */
	getOverriddenSources = () => [...this.overlays.keys()];
	/** Supply the bytes for a path. */
	overlaySource = (filePath, content) => {
		this.overlays.set(this.normalizePath(filePath), content);
	};
	/**
	* Supply the bytes for a module, under the path extraction will ask for.
	*
	* A relative path resolves against the project's working directory, as `parseFile` resolves
	* it — so a module added as `src/a.tsx` is the one `parseFile('src/a.tsx')` reads.
	*/
	addSourceFile = (filePath, content) => {
		this.overlaySource(this.absolute(filePath), content);
	};
	absolute = (filePath) => (0, node_path.isAbsolute)(filePath) ? filePath : (0, node_path.join)(this.options.cwd ?? process.cwd(), filePath);
	/** Forget bytes supplied through `overlaySource`. Returns whether there were any. */
	removeOverlay = (filePath) => this.overlays.delete(this.normalizePath(filePath));
	/**
	* A watched file changed on disk. Disk is now the truth for it, so an overlay that
	* stood in for it goes.
	*/
	reloadSourceFile = (filePath) => {
		this.removeOverlay(this.absolute(filePath));
	};
	/**
	* A watched file was deleted. Its styles go with it — nothing re-parses a file that is gone,
	* so they would otherwise outlive it for as long as the context does.
	*/
	removeSourceFile = (filePath, encoder = this.options.parserOptions.encoder) => {
		encoder.releaseFile(this.absolute(filePath));
		this.removeOverlay(this.absolute(filePath));
	};
	/**
	* Restore an encoder dump from a `.json` file in `include` — the output of `bamboo ship`,
	* or a library's shipped extraction — and report it as an empty result for that file.
	*/
	parseJson = (filePath, encoder = this.options.parserOptions.encoder) => {
		const content = this.getSourceText(filePath);
		if (content === void 0) throw new Error(`bamboo: could not read ${filePath}`);
		encoder.fromJSON(JSON.parse(content));
		return new ParserResult(this.options.parserOptions, encoder).setFilePath(filePath);
	};
};
//#endregion
//#region src/glob-dirname.ts
function globDirname(globs) {
	const rootDirs = /* @__PURE__ */ new Set();
	for (const glob of globs) {
		const scan = picomatch.default.scan(glob, { tokens: true });
		if (!scan.isGlob) {
			rootDirs.add(glob);
			continue;
		}
		const nonGlobTokens = scan.tokens?.filter((token) => !token.isPrefix && !token.isGlob);
		if (nonGlobTokens?.length) rootDirs.add((0, path.join)(...nonGlobTokens.map((token) => token.value)));
	}
	if (rootDirs.size === 0) return ["."];
	return Array.from(rootDirs);
}
//#endregion
//#region src/node-runtime.ts
/**
* What the source glob ignores.
*
* `**\/*.d.ts` is unconditional. It used to be a *default* that a user's own `exclude`
* replaced, so declaration files were scanned by whether the project happened to set that
* option at all — excluded for `exclude: []`, included for `exclude: ['**\/*.stories.tsx']`.
* Nothing chose that; the default was simply appended when nothing else was there.
*
* A declaration file carries no runtime code and can emit no styles. It is still read by the
* reference scans, which are deliberately over-inclusive, so scanning one could keep a token
* named in a doc comment or a reset rule for an element named in a JSDoc example. Those are
* spurious keeps rather than a guarantee anyone relied on — and they were never available to
* the projects on the other side of the same condition.
*
* Copied rather than appended to. `opts.exclude` is `ctx.config.exclude` itself, so pushing
* onto it edited the user's resolved config in place, and the next call then saw a list it had
* mutated.
*/
const globIgnore = (exclude) => ["**/*.d.ts", ...exclude ?? []];
/**
* The order the source glob returns files in, made a decision rather than an accident.
*
* `fast-glob` hands back whatever `readdir` gave it, which is the filesystem's order and is not
* the same on every machine. That order is not cosmetic: it is the order atoms enter the sheet,
* and sheet order is what decides a conflict between two classes on one element — `cx` joins
* them and the browser picks by position, not by the order they were passed. So an unsorted
* glob lets two checkouts of the same commit build stylesheets that resolve the same conflict
* differently, and makes the emitted bytes irreproducible, which is also what content-hashed
* asset caching is keyed on.
*
* Sorted by code unit rather than `localeCompare`, whose answer depends on the host's locale —
* the exact class of machine-dependence this exists to remove.
*/
const sortSources = (files) => files.sort();
const nodeRuntime = {
	cwd() {
		return process.cwd();
	},
	env(name) {
		return process.env[name];
	},
	path: {
		join: path.join,
		relative: path.relative,
		dirname: path.dirname,
		extname: path.extname,
		isAbsolute: path.isAbsolute,
		sep: path.sep,
		resolve: path.resolve,
		abs(cwd, str) {
			return (0, path.isAbsolute)(str) ? str : (0, path.join)(cwd, str);
		}
	},
	fs: {
		existsSync: fs_extra.default.existsSync,
		readFileSync(filePath) {
			return fs_extra.default.readFileSync(filePath, "utf8");
		},
		glob(opts) {
			if (!opts.include) return [];
			return sortSources(fast_glob.default.sync(opts.include, {
				cwd: opts.cwd,
				ignore: globIgnore(opts.exclude),
				absolute: true
			}));
		},
		writeFile: fs_extra.default.writeFile,
		writeFileSync: fs_extra.default.writeFileSync,
		readDirSync: fs_extra.default.readdirSync,
		isDirSync(path$6) {
			return fs_extra.default.statSync(path$6, { throwIfNoEntry: false })?.isDirectory() ?? false;
		},
		rmDirSync: fs_extra.default.emptyDirSync,
		rmFileSync: fs_extra.default.removeSync,
		ensureDirSync(path$7) {
			return fs_extra.default.ensureDirSync(path$7);
		},
		watch(options) {
			const { include, exclude, cwd, poll } = options;
			const coalesce = poll || process.platform === "win32";
			const dirnames = globDirname(include);
			const isValidPath = (0, picomatch.default)(include, {
				cwd,
				ignore: exclude
			});
			const workingDir = cwd || process.cwd();
			const watcher = chokidar.default.watch(dirnames, {
				usePolling: poll,
				cwd,
				ignored(path$8, stats) {
					const relativePath = (0, path.relative)(workingDir, path$8);
					return !!stats?.isFile() && !isValidPath(relativePath);
				},
				ignoreInitial: true,
				ignorePermissionErrors: true,
				awaitWriteFinish: coalesce ? {
					stabilityThreshold: 50,
					pollInterval: 10
				} : false
			});
			_bamboocss_logger.logger.debug("watch:file", `Watching [ ${dirnames.join(", ")} ]`);
			process.once("SIGINT", async () => {
				await watcher.close();
			});
			return watcher;
		}
	}
};
process.setMaxListeners(Infinity);
process.on("unhandledRejection", (reason) => {
	_bamboocss_logger.logger.caughtError("process", "Unhandled rejection", reason);
});
process.on("uncaughtException", (error) => {
	_bamboocss_logger.logger.caughtError("process", "Uncaught exception", error);
});
//#endregion
//#region src/output-engine.ts
var OutputEngine = class {
	paths;
	fs;
	path;
	constructor(options) {
		const { paths, runtime } = options;
		this.paths = paths;
		this.fs = runtime.fs;
		this.path = runtime.path;
	}
	empty = () => {
		this.fs.rmDirSync(this.path.join(...this.paths.root));
	};
	ensure = (file, cwd) => {
		const outPath = this.path.resolve(cwd, file);
		const dirname = this.path.dirname(outPath);
		this.fs.ensureDirSync(dirname);
		return outPath;
	};
	/**
	* Delete files in the generated directories that this codegen no longer produces.
	*
	* Codegen was write-only, so an artifact that stopped being generated stayed on disk
	* forever. Dropping a pattern from the config rewrote `patterns/index.js` without it and
	* left `patterns/stack.js` sitting beside it — importing through the barrel then failed
	* loudly, which is fine, but a deep import resolved, ran, returned a class name and
	* emitted no css. A stale artifact is worse than a missing one: it answers.
	*
	* Scoped to the directories this call actually wrote to, so a directory bamboo does not
	* generate into is never read, let alone emptied. It is bounded twice over, because the
	* cost of being wrong here is a deleted file rather than a stale one:
	*
	* - only a *complete* codegen may be swept, since a filtered artifact list cannot say what
	*   a directory should contain. That is the caller's to enforce;
	* - within a directory, only files carrying an extension this codegen actually wrote
	*   *there* are eligible. `patterns/` got `.mjs` and `.d.ts` files, so a leftover
	*   `stack.mjs` is stale; a `.gitignore`, a `README.md` or a `styles.css` is not the kind
	*   of thing we put there and is none of our business.
	*
	* The second bound replaces a list of known exceptions, which was the wrong shape: a
	* denylist has to name every file anyone might legitimately keep in an output directory,
	* and the failure mode when it misses one is silent deletion. It missed the `.gitignore`
	* that ships inside a generated directory, which is committed in this repo's own fixtures.
	* Reasoning from what we wrote needs no such list.
	*
	* Subdirectories are left alone; they are swept as themselves when their own artifacts
	* are written.
	*/
	prune = (artifacts) => {
		const produced = /* @__PURE__ */ new Map();
		/** Per directory, the file extensions this codegen wrote into it. */
		const kinds = /* @__PURE__ */ new Map();
		for (const artifact of artifacts) {
			if (!artifact) continue;
			const dir = this.path.join(...artifact.dir ?? this.paths.root);
			let files = produced.get(dir);
			if (!files) produced.set(dir, files = /* @__PURE__ */ new Set());
			let extensions = kinds.get(dir);
			if (!extensions) kinds.set(dir, extensions = /* @__PURE__ */ new Set());
			for (const { file, code } of artifact.files) {
				if (!code) continue;
				files.add(file);
				extensions.add(this.path.extname(file));
			}
		}
		let removed = 0;
		for (const [dir, files] of produced) {
			if (!this.fs.existsSync(dir)) continue;
			const extensions = kinds.get(dir);
			for (const entry of this.fs.readDirSync(dir)) {
				if (files.has(entry)) continue;
				if (!extensions.has(this.path.extname(entry))) continue;
				const absPath = this.path.join(dir, entry);
				if (this.fs.isDirSync(absPath)) continue;
				_bamboocss_logger.logger.debug("write:stale", `removing ${entry}`);
				this.fs.rmFileSync(absPath);
				removed++;
			}
		}
		if (removed) _bamboocss_logger.logger.debug("write:stale", `Removed ${removed} artifact(s) no longer generated`);
		return { removed };
	};
	write = (output) => {
		if (!output) return;
		const { dir = this.paths.root, files } = output;
		this.fs.ensureDirSync(this.path.join(...dir));
		return Promise.allSettled(files.map(async (artifact) => {
			if (!artifact?.code) return;
			const { file, code } = artifact;
			const absPath = this.path.join(...dir, file);
			_bamboocss_logger.logger.debug("write:file", dir.slice(-1).concat(file).join("/"));
			if (file === "package.json") return this.writePackageJson(absPath, code);
			if (this.isUnchanged(absPath, code)) {
				_bamboocss_logger.logger.debug("write:unchanged", dir.slice(-1).concat(file).join("/"));
				return;
			}
			return this.fs.writeFile(absPath, code);
		}));
	};
	/**
	* Whether the file on disk already holds exactly what codegen would write.
	*
	* Not for the write itself, which is cheap — 54 artifacts and 1.4 MB measure ~6ms, against
	* ~1.3ms to read them back and compare. It is for the mtime. Codegen rewrote every artifact
	* on every build whether or not a byte moved, and most builds move nothing: `csstype.d.ts` is
	* copied verbatim from a constant and accounts for 895 kB on its own. Everything downstream
	* watches those files — the dev server's module graph, `tsc --incremental`, any bundler with
	* the output directory in scope — and each of them re-does work for a file that is identical
	* to the one it already read.
	*
	* A read that throws is an answer, not a failure: the file is unreadable or absent, so it has
	* to be written.
	*/
	isUnchanged = (absPath, code) => {
		if (!this.fs.existsSync(absPath)) return false;
		try {
			return this.fs.readFileSync(absPath) === code;
		} catch {
			return false;
		}
	};
	/**
	* Unlike the rest of the output, `package.json` is not exclusively ours: `emit-pkg`
	* writes entrypoints to the same path, and consumers hand-edit it. Overwriting would
	* drop that, so only keys that are absent get filled in — anything already declared,
	* including a deliberate `sideEffects`, is left as it stands.
	*/
	writePackageJson = (absPath, code) => {
		if (!this.fs.existsSync(absPath)) return this.fs.writeFile(absPath, code);
		let existing;
		try {
			existing = JSON.parse(this.fs.readFileSync(absPath));
		} catch {
			_bamboocss_logger.logger.warn("write:file", `Skipped ${absPath}: could not be parsed as JSON`);
			return;
		}
		const missing = Object.entries(JSON.parse(code)).filter(([key]) => existing[key] === void 0);
		if (!missing.length) return;
		return this.fs.writeFile(absPath, JSON.stringify({
			...existing,
			...Object.fromEntries(missing)
		}, null, 2) + "\n");
	};
};
//#endregion
//#region src/create-context.ts
/** A thrown value's message, for a `catch` binding that is typed `unknown`. */
const messageOf = (error) => error instanceof Error ? error.message : String(error);
const nativeBinaryName = () => {
	if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64.node";
	if (process.platform === "darwin" && process.arch === "x64") return "darwin-x64.node";
	if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64-gnu.node";
	if (process.platform === "linux" && process.arch === "x64") return "linux-x64-gnu.node";
	if (process.platform === "win32" && process.arch === "x64") return "win32-x64-msvc.node";
};
/**
* What each loss is, and what the author can do about it.
*
* Kept apart from the sentence around it so every reason has to answer both questions.
* "Make the value static" is the fix for a value the build could not evaluate and no help
* at all for two arguments it could not tell apart, and a diagnostic that gives the wrong
* instruction is worse than one that gives none.
*/
const unresolvedReasons = {
	"unresolvable-value": (prop) => [`${prop} will not reach the stylesheet because its value is not statically known`, "Make the value static to group it."],
	"missing-property": (prop) => [`${prop} will not reach the stylesheet because its value could not be evaluated at build time`, "Make the value static to group it."],
	"unenumerable-keys": () => ["an object spread or computed key leaves the build unable to tell which properties this call sets", "Write the properties out, or spread a value the build can resolve, to group it."],
	"unresolved-raw": (prop) => [`${prop}.raw() composes its own props rather than its styles, so ${prop}'s declarations will not reach the stylesheet`, `Call it instead — cx(${prop}(props), css({ … })) — or move the overrides into ${prop} itself.`]
};
var BambooContext = class extends _bamboocss_generator.Generator {
	runtime;
	project;
	output;
	diff;
	explicitDeps = [];
	/**
	* Files whose extraction threw, keyed by path, holding what it threw.
	*
	* A parse failure is not an opinion about a build that still works. The file's styles never
	* reach the encoder, so every rule it would have contributed is absent from the stylesheet
	* and the classes its components ask for have nothing behind them — the same shape as a
	* naming disagreement, and the reverse of `reportUnresolvedStyles`, where what the build
	* *did* see still applies. Logging it and carrying on is how a build printed error-level
	* lines, dropped rules, and exited 0.
	*
	* Retained rather than rethrown from the `catch`, so one pass names every broken file
	* instead of the first. Keyed by file, so a failure survives the incremental passes that
	* skip an unchanged file: nothing re-parses it, and its styles stay missing until it does.
	*
	* The error rather than its message, so `assertExtracted` can hand the originals on as a
	* `cause`. The aggregate carries a code of its own — `ERR_BAMBOO_EXTRACT_FAILED` — and the
	* codes underneath it are what a caller has to read to tell a retired token spelling from a
	* syntax error.
	*/
	parseFailures = /* @__PURE__ */ new Map();
	/**
	* Files that call a binding their entrypoint no longer exports, keyed by path.
	*
	* Keyed and scoped exactly like `parseFailures`, and for the same reasons: an incremental
	* pass that skips an unchanged file does not re-parse it, so the finding has to outlive the
	* pass that recorded it or a no-op rebuild launders a broken build into a green one — and it
	* has to be dropped once the file is fixed, deleted, or leaves `include`, or the fix can
	* never take.
	*/
	deadCalls = /* @__PURE__ */ new Map();
	/** Extraction results produced without materializing TypeScript ASTs. */
	nativeExtractions = /* @__PURE__ */ new Map();
	/** Native semantic reads retained across incremental passes. */
	nativeDependencies = /* @__PURE__ */ new Map();
	nativePendingCandidates = /* @__PURE__ */ new Map();
	nativeConfigurationFiles = /* @__PURE__ */ new Map();
	nativeAuxiliaryFiles = [];
	/** Parser-hook output staged by the prefilter for the following native boundary. */
	nativePreparedSources = /* @__PURE__ */ new Map();
	/** Per-file parser-hook options and whether a transform invalidated source locations. */
	nativeSourceMetadata = /* @__PURE__ */ new Map();
	parserHooks;
	constructor(conf) {
		super(conf);
		const config = conf.config;
		this.runtime = nodeRuntime;
		this.parserHooks = conf.hooks;
		config.cwd = this.runtime.path.resolve(this.runtime.cwd(), config.cwd || ".");
		if (config.logLevel) _bamboocss_logger.logger.level = config.logLevel;
		this.project = new SourceProject({
			cwd: config.cwd,
			readFile: (filePath) => this.runtime.fs.readFileSync(filePath),
			fileExists: (filePath) => this.runtime.fs.existsSync(filePath),
			compilerOptions: conf.tsconfig?.compilerOptions,
			parserOptions: this.parserOptions
		});
		this.output = new OutputEngine(this);
		this.diff = new DiffEngine(this);
		this.explicitDeps = this.getExplicitDependencies();
		const disagreement = (0, _bamboocss_core.checkNamingAgreement)(this);
		if (disagreement) throw new _bamboocss_shared.BambooError("NAMING_DISAGREEMENT", (0, _bamboocss_core.formatNamingDisagreement)(disagreement));
	}
	/**
	* Report `css()` calls whose styles the build could not fully see.
	*
	* A warning rather than an error: the build is not wrong, the call site is unresolvable,
	* and the declarations it did resolve still apply. But the ones it could not have no rule
	* behind them and are simply absent, so it must not be silent.
	*/
	reportUnresolvedStyles = (result) => {
		const unresolved = result.unresolved;
		if (!unresolved?.length) return;
		for (const entry of unresolved) {
			if (this.isGenerated(entry.filePath)) continue;
			const where = `${entry.filePath}:${entry.line}:${entry.column}`;
			const prop = entry.prop ? `\`${entry.prop}\`` : "a property";
			const [what] = unresolvedReasons[entry.reason](prop);
			if (entry.kind === "recipe") {
				const at = entry.prop ? ` at \`${entry.prop}\`` : "";
				_bamboocss_logger.logger.warn("recipe", `${where} — ${what}${at}. A recipe's classes are named from a hash of its config, so a declaration the build cannot see gives the build and the browser different names and the element renders with no styles at all. Set \`className\` on the recipe, so its name does not depend on what the build could resolve. See https://bamboocss.com/docs/concepts/recipes`);
				continue;
			}
			{
				const at = entry.prop ? ` at \`${entry.prop}\`` : "";
				_bamboocss_logger.logger.warn("css", `${where} — ${what}${at}. The build emits a rule per declaration it can see, and the runtime names a class for every declaration the object actually has — so the ones it could not see have no rule behind them and are simply absent. Write the value out, or generate it with \`staticCss\` if it is genuinely dynamic. See https://bamboocss.com/docs/guides/dynamic-styling`);
			}
		}
	};
	getExplicitDependencies = () => {
		const { cwd, dependencies } = this.config;
		if (!dependencies) return [];
		return this.runtime.fs.glob({
			include: dependencies,
			cwd
		});
	};
	initMessage = () => {
		return createBox({
			content: this.messages.codegenComplete(),
			title: this.messages.exclamation()
		});
	};
	getFiles = () => {
		const { include, exclude, cwd } = this.config;
		return this.runtime.fs.glob({
			include,
			exclude,
			cwd
		});
	};
	/**
	* Fail the build if any file's extraction threw.
	*
	* Called at the end of an extraction pass rather than from the `catch`, so the message names
	* every broken file at once — a config with one retired token spelling in six components is
	* fixed once, not six builds in a row.
	*
	* This is what makes the integrations agree. `cssgen` already exited non-zero on a file it
	* could not extract, by letting the throw through; every bundler goes through `parseFile`,
	* which caught it. CI running a build passed what CI running `cssgen` rejected, over the same
	* source.
	*
	* `files` is the set still in scope, which the caller has usually just globbed. Deleting the
	* offending file, or taking it out of `include`, is a *fix* — and nothing re-parses a file
	* that is gone, so the entry that outlived it would fail every later build, naming a path
	* that no longer exists. A context outlives rebuilds (it is replaced only when the config
	* changes) and both long-lived integrations hold one, so that wedged a dev server until the
	* process was restarted.
	*/
	assertExtracted = (files) => {
		if (!this.parseFailures.size) return;
		const inScope = new Set(Array.from(files ?? this.getFiles(), (file) => this.runtime.path.abs(this.config.cwd, file)));
		for (const file of this.parseFailures.keys()) if (!inScope.has(file)) this.parseFailures.delete(file);
		if (!this.parseFailures.size) return;
		const detail = (0, _bamboocss_shared.truncateList)(Array.from(this.parseFailures.entries(), ([file, error]) => `${this.relative(file)}\n${messageOf(error).replace(/^(?=.)/gm, "  ")}`), { unit: "file" });
		throw new _bamboocss_shared.BambooError("EXTRACT_FAILED", `${this.parseFailures.size} file(s) could not be extracted:\n\n${detail}\n\nNothing emits a rule for a file the build could not read, so every style in these is absent from the stylesheet and the classes their components ask for have nothing behind them.`, { cause: new AggregateError(Array.from(this.parseFailures.values()), `${this.parseFailures.size} file(s) could not be extracted`) });
	};
	/**
	* Fail on a call to a binding the pattern or recipe entrypoint no longer exports.
	*
	* The same test `assertExtracted` applies, against the other way of arriving at the same
	* output. There the build could not read the file; here it read it and the call named
	* nothing, so the extractor recorded no styles and the class the component asks for has no
	* rule behind it. Both leave a green build and a stylesheet missing rules, which is the one
	* failure a diff of the output is the only way to notice.
	*
	* Not graded by a severity option, unlike an unresolved token path: that one is inferred
	* from a value's shape and can be wrong about a literal, while this is read off the
	* entrypoint's own export list. There is no configuration under which calling a binding
	* that does not exist is what someone meant.
	*
	* Scoped like `assertExtracted`, for the reasons given there — a file taken out of
	* `include` or deleted is a fix, and an entry naming a path that no longer exists would
	* fail every later build and wedge a dev server.
	*/
	assertNoDeadCalls = (files) => {
		if (!this.deadCalls.size) return;
		const inScope = new Set(Array.from(files ?? this.getFiles(), (file) => this.runtime.path.abs(this.config.cwd, file)));
		for (const file of this.deadCalls.keys()) if (!inScope.has(file)) this.deadCalls.delete(file);
		if (!this.deadCalls.size) return;
		const entrypoint = {
			pattern: "pattern",
			recipe: "recipe"
		};
		const occurrences = Array.from(this.deadCalls.entries()).flatMap(([file, calls]) => calls.map((call) => ({
			file,
			call
		})));
		const detail = (0, _bamboocss_shared.truncateList)(Array.from((0, _bamboocss_shared.groupBy)(occurrences, ({ call }) => `${call.entrypoint}\0${call.mod}\0${call.name}\0${call.alias}`), ([, group]) => {
			const { call } = group[0];
			const named = call.alias === call.name ? `\`${call.name}\`` : `\`${call.name}\` (called as \`${call.alias}\`)`;
			const files = (0, _bamboocss_shared.uniq)(group.map(({ file }) => this.relative(file)));
			const shown = files.slice(0, 5).join(", ");
			const rest = files.length > 5 ? `, … and ${files.length - 5} more` : "";
			return `${named} is not a ${entrypoint[call.entrypoint]} — \`${call.mod}\` does not export it.\n  ${files.length} file(s): ${shown}${rest}`;
		}), { unit: "binding" });
		const count = occurrences.length;
		throw new _bamboocss_shared.BambooError("DEAD_IMPORT", `${count} call(s) name a binding that does not exist:\n\n${detail}\n\nBoth entrypoints are generated from your config, so what they export moves when it does — a pattern dropped from a preset, a recipe renamed. The call survives that as a binding to nothing: nothing extracts it, so every rule it would have contributed is absent from the stylesheet and the classes their components ask for have nothing behind them.`);
	};
	/** A path as the user typed it, when it is under `cwd`. */
	relative = (file) => file.startsWith(this.config.cwd) ? file.slice(this.config.cwd.length + 1) : file;
	/**
	* Whether a file is one bamboo wrote.
	*
	* `include` conventionally covers a source tree that `outdir` sits inside — `./src/**` and
	* `src/styled-system` — so the build routinely parses its own output. That is load-bearing
	* rather than accidental, which is why the answer here is "do not report it" rather than
	* "do not read it": the token and keyframe scans read whatever `include` covers, and a
	* project that excludes its `outdir` should not lose them.
	*/
	isGenerated = (file) => {
		const outdir = this.runtime.path.join(...this.paths.root);
		return file === outdir || file.startsWith(outdir + this.runtime.path.sep);
	};
	/**
	* The text extraction reads for a file: its `parser:before` output, or its bytes when no hook
	* rewrites it. `undefined` when the file cannot be read at all.
	*
	* The same preparation `analyzeMany` is handed, so every scan that compares "what the parser
	* holds" against "what is on disk" compares against what extraction actually saw.
	*/
	parsedSourceText = (filePath, onDisk) => {
		const original = this.project.getSourceText(filePath) ?? onDisk;
		if (original === void 0) return void 0;
		return this.prepareNativeSource(filePath, original).source;
	};
	/**
	* Token accounting for one file's text, in Rust — see `token-accounting.ts` for the rules.
	*
	* This used to walk the TypeScript tree, which meant reading `project.getSourceFile` for
	* every file mentioning a token, and that started the Go compiler over the whole inventory
	* on every stylesheet build, since `prune.tokens` defaults on.
	*/
	accountTokens = (filePath, source) => {
		const { paths = {} } = this.project.resolutionOptions;
		return this.loadNativeExtractor().accountTokens(filePath, source, this.imports.value.tokens, Object.entries(paths).map(([pattern, values]) => ({
			pattern,
			paths: values
		})));
	};
	/**
	* What the Vite compiler needs to know about modules, in one native call. See
	* `native-extractor/src/fold/model.rs`.
	*
	* `sources` are the modules to analyze, as the bundler hands them over. Every other module a
	* value is resolved through is read the way extraction reads it: its `parser:before` output
	* when a hook rewrites it, disk otherwise, and an overlay the project holds wins over both.
	*/
	compileModules = (sources, options) => {
		const { baseUrl, paths = {} } = this.project.resolutionOptions;
		const own = new Set(sources.map((source) => source.filename.replaceAll("\\", "/")));
		const auxiliary = [];
		for (const filePath of new Set([...this.nativeAuxiliaryFiles, ...this.project.getOverriddenSources()])) {
			const filename = this.runtime.path.abs(this.config.cwd, filePath);
			if (own.has(filename.replaceAll("\\", "/"))) continue;
			const overridden = this.project.sourceIsOverridden(filename);
			if (!overridden && !this.parserHooks["parser:before"] && this.runtime === nodeRuntime) continue;
			const original = this.project.getSourceText(filename);
			if (original === void 0) continue;
			const prepared = this.prepareNativeSource(filename, original);
			if (prepared.source !== original || overridden || this.runtime !== nodeRuntime) auxiliary.push({
				filename,
				source: prepared.source
			});
		}
		return this.loadNativeExtractor().compileModules(sources, auxiliary, {
			cwd: this.config.cwd,
			baseUrl,
			paths: Object.entries(paths).map(([pattern, values]) => ({
				pattern,
				paths: values
			})),
			tokens: this.nativeTokens,
			cssModules: this.imports.value.css,
			tokenModules: this.imports.value.tokens,
			recipeModules: this.imports.value.recipe,
			patternModules: this.imports.value.pattern,
			recipeNames: this.recipes.keys,
			patternNames: this.patterns.keys,
			references: options.references
		});
	};
	/**
	* The token table as the native evaluator reads it.
	*
	* Built once per context rather than per call: `compileModules` runs once per transformed
	* module, and the table is every token in the project — rebuilding it priced the whole
	* dictionary into every file, most of which never call `token()`.
	*/
	get nativeTokens() {
		this.nativeTokenTable ??= this.tokens.allTokens.map((token) => ({
			path: token.name,
			value: this.tokens.view.get(token.name),
			variable: this.tokens.view.getVar(token.name)
		}));
		return this.nativeTokenTable;
	}
	nativeTokenTable;
	/** Load the required Rust extractor from the workspace or the published prebuild directory. */
	loadNativeExtractor = () => {
		const nativeRequire = (0, node_module.createRequire)(require("url").pathToFileURL(__filename).href);
		try {
			return nativeRequire("@bamboocss/native-extractor");
		} catch (workspaceError) {
			const binary = nativeBinaryName();
			if (!binary) throw new _bamboocss_shared.BambooError("NATIVE_EXTRACTION", `Native extraction is not available for ${process.platform}-${process.arch}.`, { cause: workspaceError });
			try {
				return nativeRequire((0, node_path.join)((0, node_path.dirname)((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href)), "native", binary));
			} catch (publishedError) {
				throw new _bamboocss_shared.BambooError("NATIVE_EXTRACTION", `Failed to load the native extractor binary ${binary}.`, { cause: publishedError });
			}
		}
	};
	prepareNativeSource = (filePath, original) => {
		let parserOptions = {};
		const source = this.parserHooks["parser:before"]?.({
			filePath,
			content: original,
			configure: (options) => {
				parserOptions = {
					...parserOptions,
					...options
				};
			}
		}) ?? original;
		return {
			original,
			source,
			metadata: {
				options: parserOptions,
				origins: source === original
			}
		};
	};
	/** Prepare a whole extraction pass in one coarse native invocation. */
	prepareNativeExtraction = (filePaths) => {
		this.nativeExtractions.clear();
		this.nativeSourceMetadata.clear();
		const owners = new Set(filePaths.map((filePath) => this.runtime.path.abs(this.config.cwd, filePath).replaceAll("\\", "/")));
		for (const owner of owners) {
			this.nativeDependencies.delete(owner);
			this.nativePendingCandidates.delete(owner);
			this.nativeConfigurationFiles.delete(owner);
		}
		const sources = [];
		const auxiliary = [...this.parserHooks["parser:before"] || this.runtime !== nodeRuntime ? this.nativeAuxiliaryFiles : this.nativeAuxiliaryFiles.filter(this.project.sourceIsOverridden), ...this.project.getOverriddenSources()];
		const inventory = (0, _bamboocss_shared.uniq)([...filePaths, ...auxiliary]);
		for (const filePath of inventory) {
			if (filePath.endsWith(".json")) continue;
			const filename = this.runtime.path.abs(this.config.cwd, filePath);
			const sourceKey = filename.replaceAll("\\", "/");
			let prepared = this.nativePreparedSources.get(sourceKey);
			if (!prepared) {
				let original = this.project.getSourceText(filename);
				if (original === void 0) try {
					original = this.runtime.fs.readFileSync(filename);
				} catch (error) {
					if ([
						"ENOENT",
						"EISDIR",
						"ENOTDIR"
					].includes(error.code ?? "")) continue;
					throw error;
				}
				prepared = this.prepareNativeSource(filename, original);
			}
			if (owners.has(sourceKey)) {
				this.nativeSourceMetadata.set(sourceKey, prepared.metadata);
				sources.push({
					filename,
					source: prepared.source
				});
			} else if (prepared.source !== prepared.original || this.runtime !== nodeRuntime || this.project.sourceIsOverridden(filename)) sources.push({
				filename,
				source: prepared.source
			});
		}
		if (!sources.length) {
			this.nativePreparedSources.clear();
			return;
		}
		const entrypoints = [
			{
				kind: "css",
				modules: this.imports.value.css,
				names: [
					"css",
					"cva",
					"sva",
					"cx",
					"fallback",
					"viewTransition"
				]
			},
			{
				kind: "token",
				modules: this.imports.value.tokens,
				names: ["token"]
			},
			{
				kind: "recipe",
				modules: this.imports.value.recipe,
				names: this.recipes.keys
			},
			{
				kind: "pattern",
				modules: this.imports.value.pattern,
				names: this.patterns.keys
			}
		];
		const { baseUrl, paths = {} } = this.project.resolutionOptions;
		const options = {
			cwd: this.config.cwd,
			baseUrl,
			paths: Object.entries(paths).map(([pattern, values]) => ({
				pattern,
				paths: values
			})),
			tokens: this.nativeTokens,
			jsx: this.jsx.isEnabled
		};
		let analyses;
		try {
			analyses = this.loadNativeExtractor().analyzeMany(sources, entrypoints, options);
		} finally {
			this.nativePreparedSources.clear();
		}
		for (const analysis of analyses) {
			const owner = analysis.filename.replaceAll("\\", "/");
			if (!owners.has(owner)) continue;
			this.nativeExtractions.set(owner, analysis);
			this.nativeDependencies.set(owner, analysis.dependencies);
			this.nativePendingCandidates.set(owner, analysis.pendingCandidates);
			this.nativeConfigurationFiles.set(owner, analysis.configurationFiles);
		}
	};
	/** Included extraction owners whose native value graph reaches `filePath`, transitively. */
	getNativeDependents = (filePath) => {
		const changed = filePath.replaceAll("\\", "/");
		const selected = /* @__PURE__ */ new Set();
		let frontier = [changed];
		while (frontier.length) {
			const next = [];
			for (const dependency of frontier) for (const [owner, dependencies] of this.nativeDependencies) {
				const pending = this.nativePendingCandidates.get(owner) ?? [];
				if (selected.has(owner) || ![...dependencies, ...pending].some((item) => item.replaceAll("\\", "/") === dependency)) continue;
				selected.add(owner);
				next.push(owner);
			}
			frontier = next;
		}
		return [...selected];
	};
	/** @internal Native dependency edges, from dependency to extraction owner. */
	getNativeDependencyLedger = () => [...this.nativeDependencies].flatMap(([owner, dependencies]) => dependencies.map((dependency) => [dependency.replaceAll("\\", "/"), owner]));
	forgetNativeFile = (filePath) => {
		const file = this.runtime.path.abs(this.config.cwd, filePath).replaceAll("\\", "/");
		this.nativeDependencies.delete(file);
		this.nativePendingCandidates.delete(file);
		this.nativeConfigurationFiles.delete(file);
		this.nativeExtractions.delete(file);
		this.nativeSourceMetadata.delete(file);
	};
	parseNativeFile = (filePath, native, encoder) => {
		if (native.errors.length) throw new _bamboocss_shared.BambooError("NATIVE_EXTRACTION", `Native extraction failed for ${filePath}:\n${native.errors.join("\n")}`);
		const result = new ParserResult(this.parserOptions, encoder).setFilePath(filePath);
		result.native = true;
		result.nativePendingCandidates = native.pendingCandidates;
		result.nativeConfigurationFiles = native.configurationFiles;
		for (const dependency of native.dependencies) result.addDependency(dependency);
		const metadata = this.nativeSourceMetadata.get(filePath.replaceAll("\\", "/"));
		result.origins = metadata?.origins ?? true;
		for (const call of native.calls) {
			const atomOrigin = encoder.recordOrigins && result.origins ? {
				filePath,
				line: call.line,
				column: call.column
			} : void 0;
			if (call.kind === "jsx") {
				const recipeTag = [call.name, call.importedName].find((tag) => this.jsx.isJsxTagRecipe(tag));
				const isBambooComponent = Boolean(recipeTag);
				if (!(metadata?.options.matchTag ? metadata.options.matchTagMode === "override" ? metadata.options.matchTag(call.name, isBambooComponent) : isBambooComponent || metadata.options.matchTag(call.name, isBambooComponent) : isBambooComponent) || !recipeTag) continue;
				const data = call.arguments.map((properties) => Object.fromEntries(Object.entries(properties).filter(([property]) => {
					const isRecipeProperty = this.jsx.isRecipeProp(recipeTag, property);
					return metadata?.options.matchTagProp ? isRecipeProperty && metadata.options.matchTagProp(call.name, property) : isRecipeProperty;
				})));
				for (const recipe of this.recipes.filter(recipeTag)) result.setRecipe(recipe.baseName, {
					type: "jsx-recipe",
					name: call.name,
					data,
					atomOrigin
				}, new Set(call.unresolvedKeys));
				continue;
			}
			const item = {
				name: call.importedName,
				data: call.arguments,
				atomOrigin,
				tokenCalleeRange: call.kind === "token" || call.kind === "tokenValue" ? {
					start: call.calleeStart,
					end: call.calleeEnd
				} : void 0
			};
			const recipeConfig = call.kind === "css" && (call.importedName === "cva" || call.importedName === "sva");
			if (!(recipeConfig && item.data.every((data) => typeof data.className === "string" && data.className !== ""))) for (const loss of call.losses) result.unresolved.push({
				kind: recipeConfig ? "recipe" : "atomic",
				prop: loss.prop,
				filePath,
				line: call.line,
				column: call.column,
				reason: loss.reason
			});
			if (call.kind === "css" && [
				"css",
				"cva",
				"sva"
			].includes(call.importedName)) result.set(call.importedName, item);
			else if (call.kind === "css" && call.importedName === "viewTransition") result.setViewTransition(item);
			else if (call.kind === "pattern") result.setPattern(call.importedName, item);
			else if (call.kind === "recipe") result.setRecipe(call.importedName, item, new Set(call.unresolvedKeys));
			else if (call.kind === "token" || call.kind === "tokenValue") result.setToken(item, call.kind);
			else if (call.kind === "dead") result.deadCalls.push({
				name: call.importedName,
				alias: call.name,
				mod: call.module,
				entrypoint: this.imports.value.pattern.some((module) => call.module.includes(module)) ? "pattern" : "recipe"
			});
		}
		this.parserHooks["parser:after"]?.({
			filePath,
			result
		});
		return result;
	};
	parseFile = (filePath, styleEncoder) => {
		const file = this.runtime.path.abs(this.config.cwd, filePath);
		const nativeFile = file.replaceAll("\\", "/");
		_bamboocss_logger.logger.debug("file:extract", file);
		const measure = _bamboocss_logger.logger.time.debug(`Parsed ${file}`);
		let result;
		try {
			const encoder = styleEncoder || this.parserOptions.encoder;
			if (file.endsWith(".json")) result = encoder.withOwner("extract", file, () => this.project.parseJson(file, encoder));
			else {
				if (!this.nativeExtractions.has(nativeFile)) this.prepareNativeExtraction([file]);
				const native = this.nativeExtractions.get(nativeFile);
				if (!native && !this.runtime.fs.existsSync(file)) {
					encoder.releaseFile(file);
					this.parseFailures.delete(file);
					this.deadCalls.delete(file);
					measure();
					return;
				}
				if (!native) throw new _bamboocss_shared.BambooError("NATIVE_EXTRACTION", `Native extraction produced no result for ${file}.`);
				result = encoder.withOwner("extract", file, () => this.parseNativeFile(file, native, encoder));
			}
			this.nativeExtractions.delete(nativeFile);
			this.nativeSourceMetadata.delete(nativeFile);
			this.parseFailures.delete(file);
		} catch (error) {
			this.nativeExtractions.delete(nativeFile);
			this.nativeSourceMetadata.delete(nativeFile);
			_bamboocss_logger.logger.caughtError("file:extract", `Failed to parse ${file}`, error);
			this.parseFailures.set(file, error);
		}
		if (result) {
			this.reportUnresolvedStyles(result);
			if (result.deadCalls.length) this.deadCalls.set(file, result.deadCalls);
			else this.deadCalls.delete(file);
		}
		measure();
		return result;
	};
	/**
	* Extract every file in one pass, and fail on the ones that could not be read.
	*
	* Routed through `parseFile` rather than parsing directly, so the two entry points cannot
	* disagree about what a failure means. This one used to let the first throw out, which is
	* why `cssgen` and a bundler build reported different things about the same source.
	*/
	/**
	* The entrypoint specifiers, as `ImportMap` matches them.
	*
	* Every `mods` list at once rather than the `css` one alone: a file whose only bamboo import
	* is a recipe, a pattern or `token` originates calls just as surely, and leaving those out
	* would skip it.
	*/
	get entrypointSpecifiers() {
		return (0, _bamboocss_shared.uniq)(Object.values(this.imports.matchers).flatMap((matcher) => matcher.mods));
	}
	/**
	* The files this pass has to read, out of everything `include` matched.
	*
	* See `selectExtractable`. Kept behind a method so the reasons live in one place and a caller
	* that wants the whole inventory — the watcher, the token scan — is unaffected: this narrows
	* what is *parsed*, not what the project holds.
	*/
	extractableFiles = (files) => {
		this.nativePreparedSources.clear();
		const { baseUrl, paths } = this.project.resolutionOptions;
		const measure = _bamboocss_logger.logger.time.debug("Selected extractable files");
		const { auxiliary, extractable } = selectExtractable(files, {
			baseUrl,
			cwd: this.config.cwd,
			entrypoints: this.entrypointSpecifiers,
			paths,
			fileExists: this.project.sourceExists,
			readFile: (filePath) => {
				try {
					const original = this.project.getSourceText(filePath) ?? this.runtime.fs.readFileSync(filePath);
					const filename = this.runtime.path.abs(this.config.cwd, filePath);
					const prepared = this.prepareNativeSource(filename, original);
					this.nativePreparedSources.set(filename.replaceAll("\\", "/"), prepared);
					return prepared.source;
				} catch {
					return;
				}
			}
		});
		this.nativeAuxiliaryFiles = auxiliary;
		_bamboocss_logger.logger.debug("file:extract", `${extractable.length} of ${files.length} file(s) can reach a bamboo entrypoint; ${files.length - extractable.length} cannot and are not parsed; ${auxiliary.length} local import target(s) sit outside the inventory`);
		measure();
		return extractable;
	};
	parseFiles = (styleEncoder) => {
		const encoder = styleEncoder || this.parserOptions.encoder;
		const files = this.extractableFiles(this.getFiles());
		this.prepareNativeExtraction(files);
		const filesWithCss = [];
		const results = [];
		files.forEach((file) => {
			const result = this.parseFile(file, encoder);
			if (!result || result.isEmpty()) return;
			results.push(result);
			if (encoder.isEmpty()) return;
			filesWithCss.push(file);
		});
		this.assertExtracted(files);
		this.assertNoDeadCalls(files);
		return {
			filesWithCss,
			files,
			results
		};
	};
	writeCss = (sheet) => {
		_bamboocss_logger.logger.info("css", this.runtime.path.join(...this.paths.root, "styles.css"));
		return this.output.write({
			id: "styles.css",
			dir: this.paths.root,
			files: [{
				file: "styles.css",
				code: this.getCss(sheet)
			}]
		});
	};
	writeSplitCss = async (sheet) => {
		const { path: pathUtil, fs } = this.runtime;
		const rootDir = this.paths.root;
		const stylesDir = [...rootDir, "styles"];
		const artifacts = this.getSplitCssArtifacts(sheet);
		const subDirs = new Set(artifacts.themes.map((a) => a.dir).filter(Boolean));
		fs.ensureDirSync(pathUtil.join(...stylesDir));
		subDirs.forEach((dir) => fs.ensureDirSync(pathUtil.join(...stylesDir, dir)));
		const styleFiles = [];
		for (const layer of artifacts.layers) {
			styleFiles.push({
				file: layer.file,
				code: layer.code
			});
			_bamboocss_logger.logger.info("css", pathUtil.join(...stylesDir, layer.file));
		}
		for (const theme of artifacts.themes) {
			styleFiles.push({
				file: `${theme.dir}/${theme.file}`,
				code: theme.code
			});
			_bamboocss_logger.logger.info("css", pathUtil.join(...stylesDir, theme.dir, theme.file));
		}
		await this.output.write({
			id: "styles",
			dir: stylesDir,
			files: styleFiles
		});
		_bamboocss_logger.logger.info("css", pathUtil.join(...rootDir, "styles.css"));
		await this.output.write({
			id: "styles.css",
			dir: rootDir,
			files: [{
				file: "styles.css",
				code: artifacts.index
			}]
		});
		const recipesIndex = pathUtil.join(...stylesDir, "recipes.css");
		const recipesDir = pathUtil.join(...stylesDir, "recipes");
		if (fs.existsSync(recipesIndex)) fs.rmFileSync(recipesIndex);
		if (fs.existsSync(recipesDir)) fs.rmFileSync(recipesDir);
	};
	watchConfig = (cb, opts) => {
		const { cwd, poll, exclude } = opts ?? {};
		_bamboocss_logger.logger.info("ctx:watch", this.messages.configWatch());
		this.runtime.fs.watch({
			include: (0, _bamboocss_shared.uniq)([...this.explicitDeps, ...this.conf.dependencies]),
			exclude,
			cwd,
			poll
		}).on("change", (0, perfect_debounce.debounce)(async (file) => {
			_bamboocss_logger.logger.info("ctx:change", "config changed, rebuilding...");
			await reportRebuildFailure(() => cb(file));
		}));
	};
	watchFiles = (cb, opts) => {
		const { include, exclude, poll, cwd } = this.config;
		_bamboocss_logger.logger.info("ctx:watch", this.messages.watch());
		this.runtime.fs.watch({
			...opts,
			include,
			exclude,
			poll,
			cwd
		}).on("all", (0, perfect_debounce.debounce)(async (event, file) => {
			_bamboocss_logger.logger.info(`file:${event}`, file);
			await reportRebuildFailure(() => cb(event, file));
		}));
	};
};
/**
* Report a failed rebuild as a failed rebuild.
*
* Chokidar is an `EventEmitter`, so it discards whatever a listener returns, and the debounce
* wrapper attaches no rejection handler — a throw from inside a rebuild became a dangling
* promise. `node-runtime.ts` then catches it as `Unhandled rejection`, which labels a config
* error as an internal crash, leaves the exit code at 0, and is suppressed entirely at
* `logLevel: 'silent'`. The initial build is caught by the CLI and prints properly; only
* rebuilds of the identical source were silent, which is the worse half of the asymmetry.
*
* Caught rather than rethrown: a watcher's job is to survive a bad intermediate state and
* rebuild when the next edit fixes it. What it must not do is claim success.
*/
async function reportRebuildFailure(run) {
	try {
		await run();
	} catch (error) {
		_bamboocss_logger.logger.error("ctx:rebuild", error instanceof Error ? error.message : String(error));
	}
}
//#endregion
//#region src/config.ts
const RESOLVED_HOOKS_NAME = "__resolved__";
const AUTO_PARSER_HOOKS = Object.freeze([
	"vue",
	"svelte",
	"astro"
]);
const autoPluginFactories = {
	astro: _bamboocss_plugin_astro.pluginAstro,
	svelte: _bamboocss_plugin_svelte.pluginSvelte,
	vue: _bamboocss_plugin_vue.pluginVue
};
/**
* Built-in plugins that are auto-injected when using the CLI or PostCSS plugin.
* These provide Vue, Svelte and Astro single-file-component support.
*
* LightningCSS is not among them any more. It was reached through a `lightningcss: true`
* config flag whose only job was to push `pluginLightningcss()` into this list — a second
* way to say something `plugins` already said, and the expensive one: naming the plugin
* here meant a static import, which made `@bamboocss/plugin-lightningcss` a hard dependency
* of this package, which put a native binary in every install whether or not the flag was
* ever set. List the plugin yourself to use it.
*/
function getAutoPlugins() {
	return AUTO_PARSER_HOOKS.map((identity) => autoPluginFactories[identity]());
}
/** Resolve all config state without constructing the parser Project owned by BambooContext. */
async function prepareNodeConfig(options = {}) {
	const { config, configPath } = options;
	const cwd = options.cwd ?? options?.config?.cwd ?? process.cwd();
	const conf = await (0, _bamboocss_config.loadConfig)({
		cwd,
		file: configPath
	});
	if (config) Object.assign(conf.config, config);
	if (options.cwd) conf.config.cwd = options.cwd;
	if (options.dev) conf.config.dev = true;
	const autoPlugins = getAutoPlugins();
	conf.hooks = (0, _bamboocss_config.mergeHooks)([...autoPlugins, {
		name: RESOLVED_HOOKS_NAME,
		hooks: conf.hooks
	}]);
	conf.config.plugins = [...autoPlugins, ...conf.config.plugins ?? []];
	const tsconfigResolutionFiles = {};
	const tsConfResult = await loadTsConfig(conf, cwd, void 0, tsconfigResolutionFiles);
	if (tsConfResult) Object.assign(conf, tsConfResult);
	rememberTsConfigResolutionFiles(conf, tsconfigResolutionFiles.value ?? []);
	return { conf };
}
/**
* Load config and create context with auto-injected plugins.
* Used by the CLI and PostCSS plugin.
*/
async function loadConfigAndCreateContext(options = {}) {
	const { conf } = await prepareNodeConfig(options);
	return new BambooContext(conf);
}
//#endregion
//#region src/source-snapshots.ts
/**
* Every file `include` covers, read once.
*
* The scans that decide what survives pruning — the token reference set, the reachability
* gate, the strict accounting — all want the same two copies of the same files, and each used
* to fetch them itself. A strict build therefore read every file three times over: once to
* collect references, once to account, and once more for the gate whenever the accounting
* declined. Yielding a snapshot lets one walk feed all of them.
*
* Both copies, because neither alone is complete and the text scans are safe when over-fed. A
* file the parser transformed is stored rewritten (`parseSourceFile` calls `replaceWithText`),
* and those transforms lose things the scans want: `svelteToTsx` and `vueToTsx` each swallow a
* throw and return an empty string, and a Vue SFC with a render function and no `<template>`
* becomes the literal `<template>undefined</template>`. Read only the parsed copy and a file
* like that reports no tokens and no elements at all.
*
* The parsed copy still has to be read as well, because `parser:before` is the documented way
* to teach bamboo a format it does not know. A template compiled to jsx by such a hook holds
* nothing a scan of the raw file would recognise, and that is the hook working as intended.
*/
function* sourceSnapshots(ctx) {
	for (const file of ctx.getFiles()) yield readSnapshot(ctx, ctx.runtime.path.abs(ctx.config.cwd, file));
}
/** One file's snapshot, for a walk that decides per file whether it needs to read at all. */
function readSnapshot(ctx, filePath) {
	let onDisk;
	try {
		onDisk = ctx.runtime.fs.readFileSync(filePath);
	} catch {
		onDisk = void 0;
	}
	return {
		filePath,
		onDisk,
		parsed: ctx.parsedSourceText(filePath, onDisk)
	};
}
/**
* The distinct texts a snapshot carries.
*
* One when the parser holds the file as written, two when a transform rewrote it. Every
* textual scan wants both, and wants neither twice.
*/
function* snapshotTexts(snapshot) {
	const { onDisk, parsed } = snapshot;
	if (onDisk != null) yield onDisk;
	if (parsed != null && parsed !== onDisk) yield parsed;
}
//#endregion
//#region src/token-accounting.ts
/**
* The one decline `prune.unresolvedPath: 'error'` fails the build on.
*
* That setting asserts that every token path resolves, and this is the reason that says otherwise:
* a token binding used in a way the build cannot follow — a path built at runtime, a binding
* assigned away, a namespace enumerated. It is about the author's *token usage*, and it has a
* fix at the call site.
*
* Nothing else may throw, because nothing else is necessarily about tokens at all. The other
* reasons were written under a premise this would break: declining was free, so every branch
* that could not prove a shape declined, and the accepted set was kept deliberately small.
* `import(`./pages/${name}`)` declines as `dynamic-import` because the specifier is not a
* literal and *could* be the artifact; `import lexer = require('./tokenizer')` declines because
* the statement contains the substring `token`. Both are routine code with nothing to do with
* design tokens, and failing a build over them would be indefensible. They keep every
* declaration, which is what they always did, and say so.
*/
const failsStrict = (entry) => entry.reason === "unresolved-reference";
/**
* One file's contribution, split out so the build can account and scan in a single walk.
*
* `pruneTokensForBuild` needs the keep set, the reachability answer and this accounting from
* the same files; three separate passes read every file three times.
*/
function accountSnapshot(ctx, snapshot, accounting) {
	const { filePath, onDisk, parsed } = snapshot;
	const { paths, prefixes, declined } = accounting;
	{
		if (onDisk == null || parsed == null || parsed !== onDisk) {
			if (!(mentionsToken(ctx, onDisk) || mentionsToken(ctx, parsed))) return;
			declined.push({
				filePath,
				line: 1,
				reason: onDisk == null || parsed == null ? "unreadable" : "transformed"
			});
			return;
		}
		if (!mentionsToken(ctx, parsed)) return;
		const native = ctx.accountTokens(filePath, parsed);
		if (native.unparsed) {
			declined.push({
				filePath,
				line: 1,
				reason: "unparsed"
			});
			return;
		}
		for (const path of native.paths) paths.add(path);
		for (const prefix of native.prefixes) prefixes.add(prefix);
		for (const entry of native.declined) declined.push({
			filePath,
			...entry
		});
	}
}
/**
* Whether a file is worth walking — because it can name the artifact, or because a shape in it
* declines without naming one.
*
* The obvious half is the substring `token`, which an import of the default entrypoint, a call,
* a member read and a `require` of it all put in the source. Three things defeat it, and each one
* is a silent under-keep rather than a slow build, so the test errs wide:
*
* - **A configured entrypoint need not spell it.** `importMap: { tokens: '@acme/design' }` and a
*   tsconfig path mapping both make `isTokensEntrypoint` true for a specifier with no `token` in
*   it, so the configured modules are tested for as well.
* - **An identifier may be written with unicode escapes.** An import specifier can spell the `t`
*   of `token` as a backslash-u escape and still bind the export, which `nameOf` resolves and
*   there is a test on. Both escape forms — the four-digit one and the braced one — begin with a
*   backslash followed by `u`, so testing for that pair catches every spelling.
* - **`require()` and `import()` decline on a specifier this cannot read**, which is a statement
*   about the specifier rather than about tokens: `import(`./pages/${name}`)` names nothing and
*   declines all the same, because it *could* be the artifact. Skipping the file would drop that
*   decline and with it the keep it was standing in for.
*
* A false positive costs one identifier walk. A false negative deletes a declaration something
* still asks for, so anything uncertain belongs on the walking side.
*/
const IMPORTING_CALL = /\b(?:require|import)\s*\(/;
const mentionsToken = (ctx, text) => {
	if (text == null) return false;
	if (text.includes("token") || text.includes("\\u")) return true;
	if (ctx.imports.value.tokens.some((mod) => text.includes(mod))) return true;
	return IMPORTING_CALL.test(text);
};
//#endregion
//#region src/token-references.ts
/**
* `token('spacing.4')` and `token.value('colors.red.300')`, including the whitespace a
* formatter may leave behind. The parser reports both, resolving constants and template
* literals through them — `token.value()` included, since it is recorded as its own kind
* rather than dropped for having a property access as its callee. Scanning the text still
* earns its place twice over: it covers a path built somewhere the extractor cannot
* follow, and it covers the callers below that supply no `results` at all.
*/
const TOKEN_CALL = /\btoken(?:\s*\.\s*value)?\s*\(\s*['"`]([^'"`]+)['"`]/g;
/** An import of the generated tokens artifact, under any of the spellings that reach it. */
const TOKEN_IMPORT = /\b(?:from|import|require)\s*\(?\s*['"][^'"]*\/tokens(\/[^'"]*|\.[cm]?[jt]sx?)?['"]/;
/** A call to `token()` or `token.value()`, whatever the argument is — or is not. */
const TOKEN_CALLEE = /\btoken(\s*\.\s*value)?\s*\(/;
/** The same, but only where the argument is a string literal — the shape `TOKEN_CALL` resolves. */
const TOKEN_CALL_LITERAL = /\btoken(?:\s*\.\s*value)?\s*\(\s*['"`]/;
/** String literals, contents and all. */
const STRING_LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
/**
* Whether a token is reached from javascript at all — a call of any shape, or an import of the
* artifact. It no longer decides pruning on its own: the accounting does that, and this is the
* gate the *fallback* defers to when the accounting declines. A project reaching for no token at
* all is one a decline cannot endanger, so it keeps nothing extra.
*
* The awkward part is that a token reference inside a css value is now spelled `token(…)` too,
* and it must *not* count: `css({ border: '1px solid token(colors.red.300)' })` reaches a token
* from a stylesheet, where the css scan already accounts for it, not from javascript. Reading it
* as a call turned pruning off wholesale — measured at 3.2x the stylesheet on a sandbox, since
* "keep everything" is what the gate means. It was only ever latent before, because `{…}` was
* the spelling the docs used and it looked nothing like a call.
*
* So a `token(` that survives blanking every string literal is a real call, and one that does
* not was written inside a string. The literal-argument test comes first and on the raw text,
* which is what keeps this a superset of `TOKEN_CALL` as the coupling in `collectTokenReferences`
* requires: a resolvable call embedded in a template literal — a fixture holding source code —
* still counts, even though blanking would hide it.
*
* No `g` flag on the tests, so `test` carries no state between files.
*/
const reachableFromJs = (text) => {
	if (TOKEN_IMPORT.test(text) || TOKEN_CALL_LITERAL.test(text)) return true;
	return TOKEN_CALLEE.test(text) && TOKEN_CALLEE.test(text.replace(STRING_LITERAL, "''"));
};
/**
* The text of every file `include` covers — as written on disk, and, when they differ, as the
* parser understands it.
*
* Both, because neither alone is complete and every scan below is safe when over-fed. A file
* the parser transformed is stored rewritten (`parseSourceFile` calls `replaceWithText`), and
* those transforms lose things the scans want: `svelteToTsx` and `vueToTsx` each swallow a
* throw and return an empty string, and a Vue SFC with a render function and no `<template>`
* becomes the literal `<template>undefined</template>`. Read only the parsed copy and a file
* like that reports no tokens and no elements at all.
*
* The parsed copy still has to be read as well, because `parser:before` is the documented way
* to teach bamboo a format it does not know. A template compiled to jsx by such a hook holds
* nothing a scan of the raw file would recognise, and that is the hook working as intended.
*
* So the cost is one extra read per file, and a second regex pass over the files a transform
* actually changed. Measured at ~14ms for 806 files, against a build where css emission alone
* is an order of magnitude more.
*/
function* sourceTexts(ctx) {
	for (const snapshot of sourceSnapshots(ctx)) yield* snapshotTexts(snapshot);
}
const createSourceScanCache = () => ({
	signature: "",
	entries: /* @__PURE__ */ new Map(),
	resolvedTokenReferences: /* @__PURE__ */ new Map()
});
const resolvedTokenReferences = (result) => {
	if (!result) return [];
	const facts = [];
	for (const item of result.token) {
		if (!item.tokenCalleeRange || !item.data?.length) continue;
		const paths = [];
		for (const value of item.data) {
			if (typeof value !== "string") break;
			paths.push(value);
		}
		if (paths.length !== item.data.length) continue;
		facts.push({
			...item.tokenCalleeRange,
			paths: [...new Set(paths)].sort()
		});
	}
	return facts.sort((left, right) => left.start - right.start || left.end - right.end);
};
const sameResolvedTokenReferences = (left, right) => (left?.length ?? 0) === right.length && right.every((fact, index) => fact.start === left[index].start && fact.end === left[index].end && fact.paths.length === left[index].paths.length && fact.paths.every((path, pathIndex) => path === left[index].paths[pathIndex]));
/**
* Reconcile one file's lightweight token facts after extraction.
*
* Deleting the source scan only when the semantic facts moved is important for dependents:
* changing an imported constant can change `token(KEY)` without changing the consumer's mtime.
*/
const recordResolvedTokenReferences = (cache, filePath, result) => {
	const next = resolvedTokenReferences(result);
	if (sameResolvedTokenReferences(cache.resolvedTokenReferences.get(filePath), next)) return;
	if (next.length) cache.resolvedTokenReferences.set(filePath, next);
	else cache.resolvedTokenReferences.delete(filePath);
	cache.entries.delete(filePath);
};
const reconcileAccounting = (accounting, references, filePath) => {
	if (!references?.length) return;
	const ranges = new Set(references.map(({ start, end }) => `${start}:${end}`));
	for (const reference of references) for (const path of reference.paths) accounting.paths.add(path);
	accounting.declined = accounting.declined.filter((entry) => entry.reason !== "unresolved-reference" || filePath !== void 0 && entry.filePath !== filePath || entry.start == null || entry.end == null || !ranges.has(`${entry.start}:${entry.end}`));
};
const OPEN_TAG = /<\s*([a-z][\w-]*)(?=[\s/>]|$)/g;
const scanSnapshot = (ctx, snapshot, options, patterns, resolvedReferences) => {
	const tokenPaths = /* @__PURE__ */ new Set();
	const cssVars = /* @__PURE__ */ new Set();
	const elements = /* @__PURE__ */ new Set();
	const keyframeHits = /* @__PURE__ */ new Set();
	let reachable = false;
	for (const text of snapshotTexts(snapshot)) {
		for (const match of text.matchAll(TOKEN_CALL)) tokenPaths.add(match[1]);
		for (const name of (0, _bamboocss_shared.cssVarRefs)(text)) cssVars.add(name);
		if (!reachable && reachableFromJs(text)) reachable = true;
		if (options.elements) for (const match of text.matchAll(OPEN_TAG)) elements.add(match[1].toLowerCase());
		for (const [name, pattern] of patterns) if (!keyframeHits.has(name) && pattern.test(text)) keyframeHits.add(name);
	}
	const accounting = {
		paths: /* @__PURE__ */ new Set(),
		prefixes: /* @__PURE__ */ new Set(),
		declined: []
	};
	accountSnapshot(ctx, snapshot, accounting);
	reconcileAccounting(accounting, resolvedReferences);
	return {
		tokenPaths: [...tokenPaths],
		cssVars: [...cssVars],
		reachableFromJs: reachable,
		elements: [...elements],
		keyframeHits: [...keyframeHits],
		accountingPaths: [...accounting.paths],
		accountingPrefixes: [...accounting.prefixes],
		accountingDeclined: accounting.declined
	};
};
/**
* Every source-derived answer the pruning passes need, from one walk over the sources.
*
* The token scan, the reachability gate, the strict accounting, the keyframe references and
* the rendered-element set all read the same two copies of the same files, and each caller
* used to run its own sweep — `Builder.toCss` paid the walk up to three times per stylesheet.
* This is the same de-duplication `pruneTokensForBuild` already performed for its own three
* answers, extended to all five.
*
* With a `cache`, a file whose mtime has not moved is not even read: its previous contribution
* merges as-is, which is what turns the walk from O(project) to O(changed) on a rebuild.
* Without one — the one-shot CLI paths — the keyframe scan keeps its historical early exit:
* once every declared name is found, later files skip those tests.
*/
function collectSourceScans(ctx, options, cache, mtimeOf, files) {
	const result = {
		tokenPaths: /* @__PURE__ */ new Set(),
		cssVars: /* @__PURE__ */ new Set(),
		reachableFromJs: false,
		elements: /* @__PURE__ */ new Set(),
		keyframeHits: /* @__PURE__ */ new Set(),
		accounting: {
			paths: /* @__PURE__ */ new Set(),
			prefixes: /* @__PURE__ */ new Set(),
			declined: []
		}
	};
	const signature = `${options.elements ? 1 : 0}\n${options.keyframeNames.join("\n")}`;
	if (cache && cache.signature !== signature) {
		cache.entries.clear();
		cache.signature = signature;
	}
	const allPatterns = options.keyframeNames.map((name) => [name, new RegExp(`\\b${escapeRegExp(name)}\\b`)]);
	const remaining = cache ? void 0 : new Set(options.keyframeNames);
	const merge = (scan) => {
		for (const path of scan.tokenPaths) result.tokenPaths.add(path);
		for (const name of scan.cssVars) result.cssVars.add(name);
		if (scan.reachableFromJs) result.reachableFromJs = true;
		for (const element of scan.elements) result.elements.add(element);
		for (const name of scan.keyframeHits) {
			result.keyframeHits.add(name);
			remaining?.delete(name);
		}
		for (const path of scan.accountingPaths) result.accounting.paths.add(path);
		for (const prefix of scan.accountingPrefixes) result.accounting.prefixes.add(prefix);
		result.accounting.declined.push(...scan.accountingDeclined);
	};
	const seen = cache ? /* @__PURE__ */ new Set() : void 0;
	for (const file of files ?? ctx.getFiles()) {
		const filePath = ctx.runtime.path.abs(ctx.config.cwd, file);
		seen?.add(filePath);
		if (cache) {
			const mtime = mtimeOf?.(filePath) ?? ((0, fs.existsSync)(filePath) ? (0, fs.statSync)(filePath).mtimeMs : -Infinity);
			const entry = cache.entries.get(filePath);
			if (entry && entry.mtime === mtime) {
				merge(entry.scan);
				continue;
			}
			const scan = scanSnapshot(ctx, readSnapshot(ctx, filePath), options, allPatterns, cache.resolvedTokenReferences.get(filePath));
			cache.entries.set(filePath, {
				mtime,
				scan
			});
			merge(scan);
			continue;
		}
		const patterns = remaining.size ? allPatterns.filter(([name]) => remaining.has(name)) : [];
		merge(scanSnapshot(ctx, readSnapshot(ctx, filePath), options, patterns));
	}
	if (cache && seen) {
		for (const filePath of cache.entries.keys()) if (!seen.has(filePath)) cache.entries.delete(filePath);
		for (const filePath of cache.resolvedTokenReferences.keys()) if (!seen.has(filePath)) cache.resolvedTokenReferences.delete(filePath);
	}
	return result;
}
/**
* Returns the custom properties left standing, for `pruneKeyframes` to root its own walk
* at — see `Generator.pruneKeyframes`. `'all'` when this pass had nothing to remove and so
* never computed the closure, which is not a missing answer but the correct one: a sheet
* nothing was removed from still declares everything it declared.
*/
function pruneTokensForBuild(ctx, sheet, results, sourceScans) {
	if (ctx.config.prune?.tokens === false) return ctx.pruneTokens(sheet)?.reachable ?? "all";
	const unresolved = ctx.config.prune?.unresolvedPath ?? "off";
	const scans = sourceScans ?? collectSourceScans(ctx, {
		keyframeNames: [],
		elements: false
	});
	const paths = new Set(scans.tokenPaths);
	const vars = new Set(scans.cssVars);
	const accounting = scans.accounting;
	const reachable = scans.reachableFromJs;
	for (const result of results) {
		if (result.filePath) reconcileAccounting(accounting, resolvedTokenReferences(result), ctx.runtime.path.abs(ctx.config.cwd, result.filePath));
		for (const item of result.token) for (const value of item.data ?? []) if (typeof value === "string") paths.add(value);
	}
	for (const name of tokenVarsFor(ctx, paths)) vars.add(name);
	const declared = declaredKeeps(ctx);
	for (const name of tokenVarsFor(ctx, declared)) vars.add(name);
	for (const name of tokenVarsFor(ctx, accounting.paths)) vars.add(name);
	const bounded = (ctx.config.prune?.keepTokens?.length ?? 0) > 0;
	if (accounting.prefixes.size && (bounded || !accounting.declined.length || !reachable)) {
		const prefixes = Array.from(accounting.prefixes);
		const matched = [];
		for (const token of ctx.tokens.allTokens) if (prefixes.some((prefix) => token.name.startsWith(prefix))) matched.push(token.name);
		for (const name of tokenVarsFor(ctx, matched)) vars.add(name);
	}
	const failing = accounting.declined.filter(failsStrict);
	const reported = accounting.declined.filter((entry) => !failsStrict(entry));
	if (bounded && unresolved === "error" && accounting.declined.length) throw new _bamboocss_shared.BambooError("TOKEN_REFERENCE_UNRESOLVED", `${accounting.declined.length} token reference(s) could not be accounted for.\n\n${formatDeclined(ctx, accounting.declined)}\n\n\`prune.unresolvedPath: 'error'\` asserts that every token path resolves at build time, and \`prune.keepTokens\` declares where the ones that do not will land. Those are contradictory, so one has to go: drop \`keepTokens\` and respell the paths, or set \`prune: { unresolvedPath: 'warn' }\` and let the keeps cover them.`);
	if (failing.length && unresolved !== "off") {
		const where = `${failing.length} token reference(s) could not be resolved.\n\n${formatDeclined(ctx, failing)}\n\n`;
		if (unresolved === "error") throw new _bamboocss_shared.BambooError("TOKEN_REFERENCE_UNRESOLVED", where + "`prune.unresolvedPath: 'error'` asserts that every token path resolves at build time. Spell the path as a string literal at the call, give a template a static prefix so it can be bounded, name the category they land in with `prune: { keepTokens: ['colors.*'] }` and drop to `prune: { unresolvedPath: 'warn' }`, or set `prune: { unresolvedPath: 'off' }` to stop asserting.");
		_bamboocss_logger.logger.warn("tokens:unresolved", bounded ? where + "`prune.keepTokens` covers them: they keep what it names rather than every declaration in the theme. Nothing checks that they stay inside it, which is why it is yours to declare — a read landing outside the patterns loses its declaration and resolves to a `var()` with nothing behind it. Respell what you can, and widen the patterns for what you cannot." : where + "An unfollowable path keeps every token declaration. Spell the path as a string literal at the call, give a template a static prefix so it can be bounded, name the category they land in with `prune: { keepTokens: ['colors.*'] }`, or set `prune: { unresolvedPath: 'off' }` to stop reporting it.");
	}
	if (reported.length && unresolved !== "off") _bamboocss_logger.logger.warn("tokens:unresolved", `${reported.length} reference(s) could not be accounted for, so ` + (bounded ? `\`prune.keepTokens\` decides what they keep` : `every token declaration is kept`) + `.\n\n${formatDeclined(ctx, reported)}\n\nThese are shapes the build cannot follow rather than paths you can respell — a component stored post-transform, a file it could not parse, a barrel it cannot classify, a dynamic \`import()\`. ` + (bounded ? "Nothing checks that they stay inside `keepTokens`, which is why it is yours to declare: a read landing outside it loses its declaration. Narrow `include`, or widen the patterns." : "Narrow `include`, name the categories they reach with `prune: { keepTokens: [...] }`, or accept the keeps."));
	return ctx.pruneTokens(sheet, vars, !bounded && accounting.declined.length > 0 && reachable)?.reachable ?? "all";
}
/**
* The dash-cased spelling of a token path, as it appears in the emitted css variable.
*
* Not a transform this applies — only one it recognises, to tell a user their pattern is
* written against the wrong side of the system. The paths are camelCase (`fontSizes.3xl`) and
* the variables are dash-cased (`--font-sizes-3xl`), so `font-sizes.*` is the natural thing to
* write after reading `styles.css` and it matches nothing at all.
*/
const dashed = (path) => path.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
/**
* The token names `prune.keepTokens` names, matched against the whole theme.
*
* Patterns are anchored globs over the dotted token *path* — `colors.*`, `colors.brand.*`,
* `!colors.legacy.*`, or a bare path for one token. Matched case-sensitively, because a path is
* a key in the config rather than free text.
*
* A pattern that matches nothing is reported rather than ignored. It is nearly always a typo
* for one that would have matched, and the failure it causes is the one this whole module is
* careful about everywhere else: a declaration dropped while something still asks for it, with
* no error and no warning, resolving to a `var()` that inherits instead of falling back.
*/
function declaredKeeps(ctx) {
	const patterns = ctx.config.prune?.keepTokens;
	if (!patterns?.length) return [];
	const includes = patterns.filter((pattern) => !pattern.startsWith("!"));
	if (!includes.length) _bamboocss_logger.logger.warn("prune:tokens", `\`prune.keepTokens\` holds only exclusions, so it keeps every token they do not name:\n\n${patterns.map((pattern) => `  ${pattern}`).join("\n")}\n\nA leading \`!\` subtracts from a selection and there is none here. Add the categories to keep — \`['colors.*', '!colors.legacy.*']\` — or use \`prune: { tokens: false }\` if keeping everything is the intent.`);
	const matched = [];
	const used = /* @__PURE__ */ new Set();
	for (const token of ctx.tokens.allTokens) {
		if ((0, matcher.isMatch)(token.name, patterns, { caseSensitive: true })) matched.push(token.name);
		if (used.size === includes.length) continue;
		for (const pattern of includes) if ((0, matcher.isMatch)(token.name, pattern, { caseSensitive: true })) used.add(pattern);
	}
	const unused = includes.filter((pattern) => !used.has(pattern));
	if (unused.length) {
		const paths = ctx.tokens.allTokens.map((token) => token.name);
		const respell = unused.map((pattern) => {
			const hit = paths.find((path) => (0, matcher.isMatch)(dashed(path), pattern, { caseSensitive: true }));
			if (!hit) return `  ${pattern}`;
			return `  ${pattern} — matches \`${dashed(hit)}\`, which is the css variable's spelling. Write the token path: \`${hit.split(".")[0]}.*\``;
		}).join("\n");
		_bamboocss_logger.logger.warn("prune:tokens", `${unused.length} \`prune.keepTokens\` pattern(s) match no token in this theme:\n\n${respell}\n\nA pattern is an anchored glob over the dotted token *path* — \`colors.*\`, not \`colors\`, and \`fontSizes.*\` rather than the \`--font-sizes-\` spelling the css variable uses. One that matches nothing keeps nothing, which is silent everywhere except here.`);
	}
	return matched;
}
/** The custom properties a set of token paths resolves to. */
function tokenVarsFor(ctx, paths) {
	const vars = /* @__PURE__ */ new Set();
	for (const path of paths) {
		if (!path) continue;
		const ref = ctx.tokens.view.getVar(path);
		if (!ref) continue;
		for (const name of (0, _bamboocss_shared.cssVarRefs)(ref)) vars.add(name);
	}
	return vars;
}
/** Where to look, grouped by file. The surrounding text differs by whether this throws. */
function formatDeclined(ctx, declined) {
	const byFile = /* @__PURE__ */ new Map();
	for (const entry of declined) {
		const list = byFile.get(entry.filePath) ?? [];
		list.push(entry);
		byFile.set(entry.filePath, list);
	}
	return Array.from(byFile.entries()).map(([filePath, entries]) => {
		return [`  ${filePath.startsWith(ctx.config.cwd) ? filePath.slice(ctx.config.cwd.length + 1) : filePath}`, ...entries.map((entry) => `    ${entry.line}: ${entry.reason}`)].join("\n");
	}).join("\n");
}
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The keyframes the theme declares — the allow-list `pruneKeyframes` works against. */
const keyframeNames = (ctx) => Object.keys(ctx.config.theme?.keyframes ?? {});
/**
* The HTML element names the source renders.
*
* A textual scan for an opening tag, over the same files the other collectors read. Matching
* `<tag` rather than parsing: a template can spell an element in more ways than a parser of
* any one framework's syntax would find, and over-reporting an element only keeps a reset
* rule that would otherwise go.
*
* Lowercase-initial only, so a JSX component (`<Button />`) is not mistaken for an element.
* That cuts the other way too — a component rendering `<button>` inside a dependency is
* invisible here, which is why `preflight.prune` is opt-in.
*
* The commoner blind spot is nearer than a dependency: this reads `include`, and `include`
* conventionally covers components rather than markup. An entry template — `index.html`,
* `app.html` — is where `<table>`, `<noscript>` and a page's static markup usually live, and a
* glob rooted at `./src` does not match it, so every element appearing only there loses its
* reset. Nothing here can detect that; the file simply is not in the list. Listing it in
* `include` fixes it, because this reads whatever `include` covers rather than only what the
* parser understands — `token-references.test.ts` pins both halves.
*
* Reading the raw file as well as the parsed copy is what makes an SFC work here; see
* `sourceTexts`. On a healthy `.svelte` file the two agree on everything but `<script>`, so
* the raw read earns its place only when a transform fails -- and there it is the difference
* between the file's elements and none of them.
*/
function collectRenderedElements(ctx) {
	const found = /* @__PURE__ */ new Set();
	for (const content of sourceTexts(ctx)) for (const match of content.matchAll(/<\s*([a-z][\w-]*)(?=[\s/>]|$)/g)) found.add(match[1].toLowerCase());
	return found;
}
//#endregion
//#region src/assemble-sheet.ts
/**
* One stylesheet from an already-extracted encoder.
*
* Vite, `bamboo cssgen`, and the CLI `bamboo` command all finish here so a recipe lowered to
* atoms cannot have a different sheet depending on which integration asked for it.
*/
const assembleExtractedSheet = (ctx, { layerParams = false, sourceScanCache, mtimeOf, sourceInventory, parserResults = [] } = {}) => {
	ctx.encoder.atomizeObservedRecipes();
	const sheet = ctx.createSheet();
	if (layerParams) {
		const recipeLayer = ctx.config.layers?.recipes ?? "recipes";
		sheet.layers.root.prepend(`@layer ${sheet.layers.layerNames.filter((name) => name !== recipeLayer).join(", ")};`);
	}
	ctx.appendBaselineCss(sheet, { atomizeRecipes: true });
	const collectElements = (0, _bamboocss_core.prunesPreflight)(ctx.config.preflight);
	const pruneKeyframes = Boolean(ctx.config.prune?.keyframes);
	const declaredKeyframes = pruneKeyframes ? keyframeNames(ctx) : [];
	const scans = ctx.config.prune?.tokens !== false || collectElements || pruneKeyframes ? collectSourceScans(ctx, {
		keyframeNames: declaredKeyframes,
		elements: collectElements
	}, sourceScanCache, mtimeOf, sourceInventory) : void 0;
	const reachableVars = pruneTokensForBuild(ctx, sheet, parserResults, scans);
	if (collectElements && scans) ctx.prunePreflight(sheet, scans.elements);
	if (pruneKeyframes && scans) ctx.pruneKeyframes(sheet, scans.keyframeHits, reachableVars);
	return sheet;
};
//#endregion
//#region src/builder.ts
const fileModifiedMap = /* @__PURE__ */ new Map();
/** Binary minimum heap; callers provide the stable semantic rank used for ties/order. */
var MinPriorityQueue = class {
	compare;
	values = [];
	constructor(compare) {
		this.compare = compare;
	}
	get size() {
		return this.values.length;
	}
	push = (value) => {
		let index = this.values.length;
		this.values.push(value);
		while (index > 0) {
			const parent = index - 1 >> 1;
			const parentValue = this.values[parent];
			if (this.compare(value, parentValue) >= 0) break;
			this.values[index] = parentValue;
			index = parent;
		}
		this.values[index] = value;
	};
	pop = () => {
		if (!this.values.length) return void 0;
		const first = this.values[0];
		const last = this.values.pop();
		if (!this.values.length) return first;
		let index = 0;
		while (true) {
			const left = index * 2 + 1;
			if (left >= this.values.length) break;
			const right = left + 1;
			let next = left;
			if (right < this.values.length && this.compare(this.values[right], this.values[left]) < 0) next = right;
			if (this.compare(last, this.values[next]) <= 0) break;
			this.values[index] = this.values[next];
			index = next;
		}
		this.values[index] = last;
		return first;
	};
};
var Builder = class {
	/**
	* The current bamboo context
	*/
	context;
	hasEmitted = false;
	filesMeta;
	explicitDepsMeta;
	affecteds;
	configDependencies = /* @__PURE__ */ new Set();
	/** Last complete included inventory, including members which have since been deleted. */
	sourceInventory;
	/** Existing included owners selected by the last resolution-ledger invalidation pass. */
	affectedFiles;
	/** Dependency-before-importer parse order for the selected owners. */
	extractionOrder;
	/** Exact cross-file semantic reads retained per included extraction owner. */
	resolutionReadSets = /* @__PURE__ */ new Map();
	/** Previously semantic paths which are absent, retained only while their owner is unchanged. */
	pendingResolutionReadSets = /* @__PURE__ */ new Map();
	/** Missing local priority candidates which can redirect a current semantic resolution. */
	resolutionCandidateSets = /* @__PURE__ */ new Map();
	/** Exact resolver configuration reads retained per included semantic owner. */
	resolutionConfigurationSets = /* @__PURE__ */ new Map();
	/** Byte snapshots for resolver configuration files, independent of filesystem mtimes. */
	resolutionConfigurationBytes = /* @__PURE__ */ new Map();
	/** Previous effective tsconfig read-set, needed to classify its deletion as an option reload. */
	tsconfigResolutionFiles = [];
	/** Config-graph mtimes as of the last completed setup, consulted by the dev fast path. */
	configGraphMtimes;
	/** Per-file source-scan results for `toCss`, valid while each file's mtime stands still. */
	sourceScanCache = createSourceScanCache();
	/**
	* Dependency edges as they stood before this pass's first source mutation, and the owners
	* each changed file reached then — before re-extraction replaces the edges that found them.
	*/
	capturedLedger;
	capturedDependents = /* @__PURE__ */ new Map();
	/**
	* Reload one edited source, keeping the closure the next extraction pass has to select.
	*
	* An integration which shares this context has to refresh an edited module before anything
	* folds against it — a consumer is transformed before the module it imports, so the fold
	* would otherwise bake in the previous contents. Doing that through the Project directly
	* loses the graph the rebuild needs: reloading retracts the file's own forward edges, and
	* `invalidateChangedSources` reads them afterwards to find its dependents. So the mutation
	* belongs here, behind a snapshot taken before the first of them.
	*
	* Once per pass, not once per file: the first mutation is the boundary, and every later one
	* in the same event is already described by that snapshot. `refreshSourceState` consumes it.
	*/
	reloadSource = (filePath) => {
		const ctx = this.getContextOrThrow();
		this.captureResolutionLedger(ctx, filePath);
		ctx.project.reloadSourceFile(filePath);
	};
	/** The deletion half of `reloadSource`, with the same snapshot obligation. */
	removeSource = (filePath) => {
		const ctx = this.getContextOrThrow();
		this.captureResolutionLedger(ctx, filePath);
		ctx.project.removeSourceFile(filePath);
		ctx.forgetNativeFile(filePath);
	};
	captureResolutionLedger = (ctx, filePath) => {
		this.capturedLedger ??= ctx.getNativeDependencyLedger();
		const file = this.absOwner(ctx, filePath);
		if (!this.capturedDependents.has(file)) this.capturedDependents.set(file, ctx.getNativeDependents(file));
	};
	/** @internal Current and missing resolver paths which can change the stylesheet. */
	getResolutionReadFiles = () => {
		const files = /* @__PURE__ */ new Set();
		for (const readSets of [
			this.resolutionReadSets,
			this.pendingResolutionReadSets,
			this.resolutionCandidateSets
		]) for (const dependencies of readSets.values()) for (const dependency of dependencies) files.add(dependency);
		return Object.freeze([...files].sort());
	};
	/** @internal The inventory reconciled by the most recent extraction pass. */
	getSourceFiles = () => Object.freeze([...this.sourceInventory ?? []]);
	/** The compiled `include`/`exclude` matcher of each context, since the compiler asks per module. */
	sourceMatchers = /* @__PURE__ */ new WeakMap();
	/**
	* @internal Whether this path is one `include` covers and `exclude` does not.
	*
	* What decides source membership when a file appears, and what the Vite compiler asks of
	* every module it is handed: a module outside the extraction inventory yields no rule, so
	* compiling it is wasted — and with the TypeScript 7 backend, far from free.
	*/
	isPotentialSourceFile = (filePath) => {
		const ctx = this.getContextOrThrow();
		const absolutePath = this.absOwner(ctx, filePath);
		const relativePath = this.sourcePath(ctx.runtime.path.relative(ctx.config.cwd, absolutePath));
		if (!this.sourceMatchers.has(ctx)) {
			const sourcePatterns = ctx.config.include ?? [];
			this.sourceMatchers.set(ctx, sourcePatterns.length ? (0, picomatch.default)(sourcePatterns, { ignore: globIgnore(ctx.config.exclude) }) : void 0);
		}
		const sourceMatcher = this.sourceMatchers.get(ctx);
		return sourceMatcher?.(relativePath) || sourceMatcher?.(absolutePath) || false;
	};
	/** @internal Whether creating or deleting this path can change a `dependencies` glob. */
	isPotentialConfigDependency = (filePath) => {
		const ctx = this.getContextOrThrow();
		const absolutePath = this.absOwner(ctx, filePath);
		const relativePath = this.sourcePath(ctx.runtime.path.relative(ctx.config.cwd, absolutePath));
		const patterns = ctx.config.dependencies ?? [];
		const matcher = patterns.length ? (0, picomatch.default)(patterns) : void 0;
		return matcher?.(relativePath) || matcher?.(absolutePath) || false;
	};
	/** @internal Exact local package/tsconfig files which can change semantic resolution. */
	getResolutionConfigurationFiles = () => {
		const files = /* @__PURE__ */ new Set();
		for (const configurations of this.resolutionConfigurationSets.values()) for (const configuration of configurations) files.add(configuration);
		return Object.freeze([...files].sort());
	};
	readResolutionConfiguration = (file) => {
		try {
			return (0, fs.readFileSync)(file).toString("base64");
		} catch (error) {
			if (error?.code === "ENOENT") return void 0;
			throw error;
		}
	};
	changedResolutionConfigurations = (knownChanges) => this.getResolutionConfigurationFiles().filter((file) => (!knownChanges || knownChanges.has(this.sourcePath(file))) && this.resolutionConfigurationBytes.get(file) !== this.readResolutionConfiguration(file));
	snapshotResolutionConfigurations = () => {
		const current = new Set(this.getResolutionConfigurationFiles());
		for (const file of current) this.resolutionConfigurationBytes.set(file, this.readResolutionConfiguration(file));
		for (const file of this.resolutionConfigurationBytes.keys()) if (!current.has(file)) this.resolutionConfigurationBytes.delete(file);
	};
	recordConfigDependencies = (ctx, cwd) => {
		const root = cwd ?? ctx.config.cwd;
		for (const file of (0, _bamboocss_shared.uniq)([...ctx.conf.dependencies, ...ctx.explicitDeps])) this.configDependencies.add((0, path.resolve)(root, file));
	};
	setup = async (options = {}) => {
		_bamboocss_logger.logger.debug("builder", "🚧 Setup");
		const configPath = options.configPath ?? (0, _bamboocss_config.findConfig)({ cwd: options.cwd });
		if (!this.context) return this.setupContext({
			configPath,
			cwd: options.cwd,
			dev: options.dev,
			atomOrigins: options.atomOrigins
		});
		const ctx = this.getContextOrThrow();
		const previousExplicitDeps = [...ctx.explicitDeps];
		const previousTsconfigFiles = this.tsconfigResolutionFiles.length ? this.tsconfigResolutionFiles : ctx.diff.getResolutionConfigFiles();
		/**
		* Dev fast path: skip the config reload when nothing that can change the resolved config
		* has moved on disk.
		*
		* `reloadConfigAndRefreshContext` re-bundles and re-evaluates the config file and the
		* tsconfig chain on every call, and a dev server reaches `setup` on every stylesheet
		* rebuild — that is 10–18ms paid per source edit for a config that cannot have changed,
		* since editing the config restarts the dev server outside this method's control anyway.
		* The guard set is exactly what the reload would re-read: the config file, its bundled
		* import graph, the explicit `dependencies`, and the tsconfig files behind resolution. Any
		* of them moving — including appearing or disappearing, which `getFileMeta` reports as a
		* changed mtime — takes the full reload below, as does a file the last snapshot never saw.
		*
		* Dev-only because the reload is also the recovery for edits this guard cannot see — a
		* preset external to the config bundle — and a one-shot build keeps paying the reload
		* rather than trading that recovery for a latency only watch mode feels.
		*/
		if (options.dev && this.configGraphUnchanged(configPath, options.sourceChanges)) {
			this.affecteds = {
				artifacts: /* @__PURE__ */ new Set(),
				hasConfigChanged: false,
				diffs: []
			};
			this.explicitDepsMeta = this.checkFilesChanged(this.context.explicitDeps);
			this.refreshSourceState(ctx, previousTsconfigFiles, options.sourceChanges);
			return;
		}
		this.affecteds = await ctx.diff.reloadConfigAndRefreshContext((conf) => {
			this.context = new BambooContext(conf);
		});
		const nextContext = this.getContextOrThrow();
		nextContext.encoder.recordOrigins = Boolean(options.atomOrigins);
		if (options.sourceChanges?.needsConfigReload) {
			const { cwd: configCwd, dependencies } = nextContext.config;
			nextContext.explicitDeps = dependencies ? nextContext.runtime.fs.glob({
				include: dependencies,
				cwd: configCwd
			}) : [];
		}
		this.recordConfigDependencies(nextContext, options.cwd);
		this.tsconfigResolutionFiles = nextContext.diff.getResolutionConfigFiles();
		_bamboocss_logger.logger.debug("builder", this.affecteds);
		const explicitDeps = options.sourceChanges?.needsConfigReload ? (0, _bamboocss_shared.uniq)([...previousExplicitDeps, ...this.context.explicitDeps]) : this.context.explicitDeps;
		const knownChanges = options.sourceChanges ? new Set(options.sourceChanges.files.map((file) => this.absOwner(this.context, file))) : void 0;
		this.explicitDepsMeta = this.checkFilesChanged(explicitDeps, knownChanges);
		if (this.explicitDepsMeta.hasFilesChanged) {
			this.explicitDepsMeta.changes.forEach((meta, file) => {
				fileModifiedMap.set(file, meta.mtime);
			});
			_bamboocss_logger.logger.debug("builder", "⚙️ Explicit config dependencies changed");
			this.affecteds.hasConfigChanged = true;
		}
		if (this.affecteds.hasConfigChanged) {
			_bamboocss_logger.logger.debug("builder", "⚙️ Config changed, reloading");
			this.filesMeta = void 0;
			this.affectedFiles = void 0;
			this.extractionOrder = void 0;
			this.sourceInventory = void 0;
			this.resolutionReadSets.clear();
			this.pendingResolutionReadSets.clear();
			this.resolutionCandidateSets.clear();
			this.resolutionConfigurationSets.clear();
			this.resolutionConfigurationBytes.clear();
			this.sourceScanCache.entries.clear();
			this.sourceScanCache.resolvedTokenReferences.clear();
			this.capturedLedger = void 0;
			this.capturedDependents.clear();
			await ctx.hooks["config:change"]?.({
				config: ctx.config,
				changes: this.affecteds
			});
			this.snapshotConfigGraphMtimes(configPath);
			return;
		}
		this.refreshSourceState(ctx, previousTsconfigFiles, options.sourceChanges);
		this.snapshotConfigGraphMtimes(configPath);
	};
	/** Every file whose content participates in the resolved config, for the dev fast path. */
	configGraphFiles = (configPath) => (0, _bamboocss_shared.uniq)([
		...configPath ? [configPath] : [],
		...this.configDependencies,
		...this.tsconfigResolutionFiles,
		...this.context?.explicitDeps ?? []
	].map(path.normalize));
	configGraphUnchanged = (configPath, sourceChanges) => {
		const snapshot = this.configGraphMtimes;
		if (!snapshot) return false;
		if (sourceChanges?.needsConfigReload) return false;
		const changed = sourceChanges ? new Set(sourceChanges.files.map((file) => this.sourcePath((0, path.resolve)(this.context?.config.cwd ?? "", file)))) : void 0;
		for (const file of this.configGraphFiles(configPath)) {
			if (changed?.has(this.sourcePath((0, path.resolve)(this.context?.config.cwd ?? "", file)))) return false;
			const recorded = snapshot.get(file);
			if (recorded === void 0 || recorded !== this.getFileMeta(file).mtime) return false;
		}
		return true;
	};
	snapshotConfigGraphMtimes = (configPath) => {
		const snapshot = /* @__PURE__ */ new Map();
		for (const file of this.configGraphFiles(configPath)) snapshot.set(file, this.getFileMeta(file).mtime);
		this.configGraphMtimes = snapshot;
	};
	/** The per-pass source bookkeeping every setup ends with, config reload or not. */
	refreshSourceState = (ctx, previousTsconfigFiles, sourceChanges) => {
		const knownChanges = sourceChanges ? new Set(sourceChanges.files.map((file) => this.absOwner(ctx, file))) : void 0;
		const changedResolutionConfigurations = this.changedResolutionConfigurations(knownChanges);
		const changedResolutionSet = new Set(changedResolutionConfigurations);
		const resolutionAffected = /* @__PURE__ */ new Set();
		const resolutionLedger = this.capturedLedger ?? (changedResolutionConfigurations.length ? ctx.getNativeDependencyLedger() : void 0);
		const capturedDependents = this.capturedDependents;
		this.capturedLedger = void 0;
		this.capturedDependents = /* @__PURE__ */ new Map();
		for (const [owner, configurations] of this.resolutionConfigurationSets) if (configurations.some((file) => changedResolutionSet.has(file))) resolutionAffected.add(owner);
		if (changedResolutionConfigurations.length) {
			const tsconfigCandidates = new Set([...previousTsconfigFiles, ...this.tsconfigResolutionFiles]);
			if (changedResolutionConfigurations.some((file) => tsconfigCandidates.has(file))) ctx.project.refreshResolutionConfiguration(ctx.conf.tsconfig?.compilerOptions);
		}
		const needsInventoryScan = !sourceChanges || sourceChanges.needsInventoryScan || this.sourceInventory === void 0;
		const inventory = needsInventoryScan ? ctx.getFiles() : [...this.sourceInventory];
		const allTracked = (0, _bamboocss_shared.uniq)([
			...this.sourceInventory ?? inventory,
			...inventory,
			...this.getResolutionReadFiles()
		]);
		const trackedPaths = new Set(allTracked.map((file) => this.absOwner(ctx, file)));
		const tracked = knownChanges && !needsInventoryScan ? [...knownChanges].filter((file) => trackedPaths.has(file)) : allTracked;
		this.filesMeta = tracked.length ? this.checkFilesChanged(tracked, knownChanges) : changedResolutionConfigurations.length ? {
			changes: /* @__PURE__ */ new Map(),
			hasFilesChanged: false
		} : void 0;
		for (const [file, meta] of this.filesMeta?.changes ?? []) if (!meta.isUnchanged) this.sourceScanCache.entries.delete(this.absOwner(ctx, file));
		if (this.filesMeta?.hasFilesChanged) {
			_bamboocss_logger.logger.debug("builder", "Files changed, invalidating them");
			this.invalidateChangedSources(ctx, inventory, resolutionAffected, resolutionLedger, capturedDependents);
		} else if (changedResolutionConfigurations.length) {
			ctx.encoder?.reconcileFileOwnerOrder("extract", inventory);
			this.extractionOrder = this.orderAffectedFiles(inventory, resolutionAffected, resolutionLedger ?? []);
			this.affectedFiles = new Set(this.extractionOrder.map(this.sourcePath));
		} else {
			this.affectedFiles = /* @__PURE__ */ new Set();
			this.extractionOrder = [];
		}
		this.sourceInventory = [...inventory];
	};
	/** Normalize the path identity shared by the Project ledger and file-owner keys. */
	sourcePath = (file) => file.replaceAll("\\", "/");
	/**
	* Refresh changed sources, then select them and their transitive included consumers.
	*
	* Consumers come from the native evaluator's read graph, which includes paths a consumer
	* probed and did not find — so a file appearing reaches the importers that were waiting for
	* it. The graph is read before anything is re-extracted: re-extraction replaces an owner's
	* edges, and waiting would lose the very closure the rebuild needs. An integration that
	* mutated sources earlier in the pass captured it then (`reloadSource`, `removeSource`).
	*/
	invalidateChangedSources = (ctx, inventory, seededAffected = /* @__PURE__ */ new Set(), previousLedger, capturedDependents = /* @__PURE__ */ new Map()) => {
		const current = new Set(inventory.map(this.sourcePath));
		const changed = [...this.filesMeta?.changes ?? []].filter(([, meta]) => !meta.isUnchanged).map(([file]) => this.sourcePath(file));
		const ledger = previousLedger ?? ctx.getNativeDependencyLedger();
		const affected = new Set(seededAffected);
		for (const file of changed) {
			if (current.has(file)) affected.add(file);
			for (const dependent of capturedDependents.get(file) ?? []) affected.add(this.sourcePath(dependent));
			for (const dependent of ctx.getNativeDependents(file)) affected.add(this.sourcePath(dependent));
		}
		for (const file of changed) if (!(0, fs.existsSync)(file)) {
			ctx.project.removeSourceFile(file);
			ctx.forgetNativeFile(file);
			fileModifiedMap.set(file, -Infinity);
		} else ctx.project.reloadSourceFile(file);
		ctx.encoder?.reconcileFileOwnerOrder("extract", inventory);
		this.extractionOrder = this.orderAffectedFiles(inventory, affected, ledger);
		this.affectedFiles = new Set(this.extractionOrder.map(this.sourcePath));
	};
	/** Deterministic topological order, with current inventory order as the stable tie-break. */
	orderAffectedFiles = (inventory, affected, ledger) => {
		const files = inventory.filter((file) => affected.has(this.sourcePath(file)));
		const byPath = new Map(files.map((file) => [this.sourcePath(file), file]));
		const inventoryRank = new Map(files.map((file, index) => [this.sourcePath(file), index]));
		const outgoing = /* @__PURE__ */ new Map();
		const indegree = new Map(files.map((file) => [this.sourcePath(file), 0]));
		const addEdge = (rawTarget, rawImporter) => {
			if (!rawTarget) return;
			const target = this.sourcePath(rawTarget);
			const importer = this.sourcePath(rawImporter);
			if (target === importer || !byPath.has(target) || !byPath.has(importer)) return;
			const importers = outgoing.get(target) ?? /* @__PURE__ */ new Set();
			if (importers.has(importer)) return;
			importers.add(importer);
			outgoing.set(target, importers);
			indegree.set(importer, (indegree.get(importer) ?? 0) + 1);
		};
		for (const [target, importer] of ledger) addEdge(target, importer);
		for (const [target, importer] of this.getContextOrThrow().getNativeDependencyLedger()) addEdge(target, importer);
		const compare = (left, right) => (inventoryRank.get(left) ?? 0) - (inventoryRank.get(right) ?? 0);
		const ready = new MinPriorityQueue(compare);
		for (const [file, degree] of indegree) if (degree === 0) ready.push(file);
		const ordered = [];
		const emitted = /* @__PURE__ */ new Set();
		while (ready.size) {
			const file = ready.pop();
			ordered.push(file);
			emitted.add(file);
			for (const importer of outgoing.get(file) ?? []) {
				const next = (indegree.get(importer) ?? 0) - 1;
				indegree.set(importer, next);
				if (next === 0) ready.push(importer);
			}
		}
		for (const file of byPath.keys()) if (!emitted.has(file)) ordered.push(file);
		return ordered.map((file) => byPath.get(file));
	};
	/**
	* Write the generated `styled-system`, so an integration can be a project's only codegen.
	*
	* The first call writes everything. That looks like the redundant half — a project that ran
	* `bamboo codegen` already has the files — but it is the only call that ever mattered, and it
	* used to do nothing: the guard below read `hasEmitted` before it was ever set, so the first
	* call fell straight through to setting the flag and the artifacts were written only after a
	* *subsequent* config change. A clone with no `styled-system/` on disk therefore got none from
	* `vite dev` or `vite build` either, which is what the callers exist to guarantee — the dev
	* server answered with an error overlay, and the build failed to resolve `styled-system/css`
	* from the first module that imports it. Every project has had to run the CLI first and pass
	* for a build step, which on one react-router app is 585 ms of a 2,242 ms build, ~97% of it
	* spent loading modules to do 21 ms of work.
	*
	* Later calls stay narrow, which is what the guard was reaching for. A watch rebuild re-emits
	* only the artifacts a config change affected, and a rebuild that changed no config writes
	* nothing at all.
	*/
	async emit() {
		if (!this.hasEmitted) {
			_bamboocss_logger.logger.debug("builder", "Emit artifacts");
			await codegen(this.getContextOrThrow());
		} else if (this.affecteds?.hasConfigChanged) {
			_bamboocss_logger.logger.debug("builder", "Emit artifacts after config change");
			await codegen(this.getContextOrThrow(), Array.from(this.affecteds.artifacts));
		}
		this.hasEmitted = true;
	}
	setupContext = async (options) => {
		const { configPath, cwd, dev } = options;
		const ctx = await loadConfigAndCreateContext({
			configPath,
			cwd,
			dev
		});
		ctx.encoder.recordOrigins = Boolean(options.atomOrigins);
		this.recordConfigDependencies(ctx, cwd);
		this.context = ctx;
		this.tsconfigResolutionFiles = ctx.diff.getResolutionConfigFiles();
		return ctx;
	};
	getContextOrThrow = () => {
		if (!this.context) throw new _bamboocss_shared.BambooError("NO_CONTEXT", "context not loaded");
		return this.context;
	};
	/** One canonical spelling for verification keys: absolute, forward slashes. */
	absOwner = (ctx, file) => this.sourcePath(ctx.runtime?.path?.abs ? ctx.runtime.path.abs(ctx.config.cwd, file) : file);
	getFileMeta = (file) => {
		const mtime = (0, fs.existsSync)(file) ? (0, fs.statSync)(file).mtimeMs : -Infinity;
		return {
			mtime,
			isUnchanged: fileModifiedMap.has(file) && mtime === fileModifiedMap.get(file)
		};
	};
	checkFilesChanged(files, knownChanges) {
		const changes = /* @__PURE__ */ new Map();
		let hasFilesChanged = false;
		for (const file of files) {
			const meta = this.getFileMeta(file);
			if (knownChanges?.has(this.sourcePath(file))) meta.isUnchanged = false;
			changes.set(file, meta);
			if (!meta.isUnchanged) hasFilesChanged = true;
		}
		return {
			changes,
			hasFilesChanged
		};
	}
	extractFile = (ctx, file) => {
		const meta = this.filesMeta?.changes.get(file) ?? this.getFileMeta(file);
		const hasConfigChanged = this.affecteds ? this.affecteds.hasConfigChanged : true;
		if (meta.isUnchanged && !hasConfigChanged && !this.affectedFiles?.has(this.sourcePath(file))) return;
		const owner = this.sourcePath(file);
		const previousReads = this.resolutionReadSets.get(owner) ?? [];
		const previousPending = this.pendingResolutionReadSets.get(owner) ?? [];
		const previousCandidates = this.resolutionCandidateSets.get(owner) ?? [];
		const previousConfigurations = this.resolutionConfigurationSets.get(owner) ?? [];
		const parserResult = ctx.parseFile(file);
		recordResolvedTokenReferences(this.sourceScanCache, this.absOwner(ctx, file), parserResult);
		fileModifiedMap.set(file, meta.mtime);
		if (parserResult) {
			const readSet = {
				dependencies: (0, _bamboocss_shared.uniq)(parserResult.getDependencies()).sort(),
				pendingCandidates: (0, _bamboocss_shared.uniq)([...parserResult.nativePendingCandidates]).sort()
			};
			const currentReads = readSet.dependencies;
			const currentConfigurations = (0, _bamboocss_shared.uniq)([...currentReads.length || readSet.pendingCandidates.length ? this.tsconfigResolutionFiles : [], ...parserResult.nativeConfigurationFiles]).sort();
			this.resolutionReadSets.set(owner, currentReads);
			if (readSet.pendingCandidates.length) this.resolutionCandidateSets.set(owner, readSet.pendingCandidates);
			else this.resolutionCandidateSets.delete(owner);
			const pending = meta.isUnchanged ? (0, _bamboocss_shared.uniq)([...previousPending, ...previousReads]).filter((dependency) => !(0, fs.existsSync)(dependency) && !currentReads.includes(dependency) && (!previousCandidates.includes(dependency) || readSet.pendingCandidates.includes(dependency))).sort() : [];
			if (pending.length) this.pendingResolutionReadSets.set(owner, pending);
			else this.pendingResolutionReadSets.delete(owner);
			const configurations = currentConfigurations.length || !meta.isUnchanged ? currentConfigurations : previousConfigurations;
			if (configurations.length) this.resolutionConfigurationSets.set(owner, configurations);
			else this.resolutionConfigurationSets.delete(owner);
		}
		return parserResult;
	};
	extract = () => {
		const ctx = this.getContextOrThrow();
		const hasConfigChanged = this.affecteds ? this.affecteds.hasConfigChanged : true;
		if (!this.filesMeta && !hasConfigChanged) {
			_bamboocss_logger.logger.debug("builder", "No files or config changed, skipping extract");
			ctx.assertExtracted();
			return ctx.assertNoDeadCalls();
		}
		const files = !hasConfigChanged && this.sourceInventory ? [...this.sourceInventory] : ctx.getFiles();
		const inventory = new Set(files.map(this.sourcePath));
		if (hasConfigChanged) {
			this.resolutionReadSets.clear();
			this.pendingResolutionReadSets.clear();
			this.resolutionCandidateSets.clear();
			this.resolutionConfigurationSets.clear();
		} else {
			for (const owner of this.resolutionReadSets.keys()) if (!inventory.has(owner)) this.resolutionReadSets.delete(owner);
			for (const owner of this.pendingResolutionReadSets.keys()) if (!inventory.has(owner)) this.pendingResolutionReadSets.delete(owner);
			for (const owner of this.resolutionCandidateSets.keys()) if (!inventory.has(owner)) this.resolutionCandidateSets.delete(owner);
			for (const owner of this.resolutionConfigurationSets.keys()) if (!inventory.has(owner)) this.resolutionConfigurationSets.delete(owner);
		}
		ctx.encoder?.reconcileFileOwnerOrder("extract", files);
		const filesToExtract = hasConfigChanged ? ctx.extractableFiles(files) : this.extractionOrder ?? files;
		const done = _bamboocss_logger.logger.time.info("Extracted in");
		ctx.prepareNativeExtraction(filesToExtract);
		for (const file of filesToExtract) this.extractFile(ctx, file);
		done();
		this.sourceInventory = [...files];
		for (const file of (0, _bamboocss_shared.uniq)([...files, ...this.getResolutionReadFiles()])) {
			const mtime = this.filesMeta?.changes.get(file)?.mtime ?? fileModifiedMap.get(file) ?? this.getFileMeta(file).mtime;
			fileModifiedMap.set(file, mtime);
		}
		this.snapshotResolutionConfigurations();
		this.affectedFiles = void 0;
		this.extractionOrder = void 0;
		ctx.assertExtracted(files);
		ctx.assertNoDeadCalls(files);
	};
	/**
	* The finished stylesheet, as a string.
	*
	* `layerParams` controls the `@layer a, b, c;` statement that fixes layer order. CSS layers
	* are ordered by first appearance otherwise.
	*
	* `extract` has to have run first: this reads the encoder rather than filling it.
	*/
	toCss = ({ layerParams = false } = {}) => {
		const ctx = this.getContextOrThrow();
		const sheet = assembleExtractedSheet(ctx, {
			layerParams,
			sourceScanCache: this.sourceScanCache,
			mtimeOf: (filePath) => this.filesMeta?.changes.get(filePath)?.mtime ?? fileModifiedMap.get(filePath),
			sourceInventory: this.sourceInventory
		});
		return ctx.getCss(sheet);
	};
	/**
	* Each atom's first call site, by class name, as recorded by the last `extract`.
	*
	* Empty unless `setup` was asked for `atomOrigins`.
	*/
	getAtomOrigins = () => this.getContextOrThrow().getAtomOrigins();
};
//#endregion
//#region src/cpu-profile.ts
const startProfiling = async (cwd, prefix, isWatching) => {
	const session = new (await (import("node:inspector").then((r) => r.default))).Session();
	session.connect();
	let state = "idle";
	const setState = (s) => {
		state = s;
	};
	await new Promise((resolve) => {
		session.post("Profiler.enable", () => {
			session.post("Profiler.start", () => {
				setState("profiling");
				resolve();
			});
		});
	});
	const toggleProfiler = () => {
		if (state === "idle") {
			console.log("Starting CPU profiling...");
			setState("starting");
			session.post("Profiler.start", () => {
				setState("profiling");
				console.log("Press 'p' to stop profiling...");
			});
		} else if (state === "profiling") {
			console.log("Stopping CPU profiling...");
			stopProfiling();
		}
	};
	if (isWatching) {
		node_readline.default.emitKeypressEvents(process.stdin);
		if (process.stdin.isTTY) process.stdin.setRawMode(true);
		console.log("Press 'p' to stop profiling...");
		process.stdin.on("keypress", (str, key) => {
			if (key.name === "p") toggleProfiler();
			if (key.ctrl && key.name === "c") stopProfiling(() => process.exit());
		});
	}
	const stopProfiling = (cb) => {
		if (state !== "profiling") {
			cb?.();
			return;
		}
		setState("stopping");
		session.post("Profiler.stop", (err, params) => {
			setState("idle");
			if (err) {
				_bamboocss_logger.logger.error("cpu-prof", err);
				cb?.();
				return;
			}
			if (!params?.profile) {
				cb?.();
				return;
			}
			const title = `bamboo-${prefix}-${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:.]/g, "")}`;
			const outfile = node_path.default.join(cwd, `${title}.cpuprofile`);
			node_fs.default.writeFileSync(outfile, JSON.stringify(params.profile));
			_bamboocss_logger.logger.info("cpu-prof", outfile);
			cb?.();
		});
	};
	return stopProfiling;
};
//#endregion
//#region src/cssgen.ts
const cssgen = async (ctx, options) => {
	const { outfile, type, splitting } = options;
	if (type) {
		const sheet = ctx.createSheet();
		const done = _bamboocss_logger.logger.time.info(ctx.messages.cssArtifactComplete(type));
		ctx.appendCssOfType(type, sheet);
		if (type === "preflight" && (0, _bamboocss_core.prunesPreflight)(ctx.config.preflight)) ctx.prunePreflight(sheet, collectRenderedElements(ctx));
		if (outfile) {
			const css = ctx.getCss(sheet);
			_bamboocss_logger.logger.info("css", ctx.runtime.path.resolve(outfile));
			await ctx.runtime.fs.writeFile(outfile, css);
		} else await ctx.writeCss(sheet);
		done();
	} else {
		const { files, results } = ctx.parseFiles();
		const done = _bamboocss_logger.logger.time.info(ctx.messages.buildComplete(files.length));
		const sheet = assembleExtractedSheet(ctx, {
			layerParams: true,
			parserResults: results
		});
		if (splitting) await ctx.writeSplitCss(sheet);
		else if (outfile) {
			const css = ctx.getCss(sheet);
			_bamboocss_logger.logger.info("css", ctx.runtime.path.resolve(outfile));
			await ctx.runtime.fs.writeFile(outfile, css);
		} else await ctx.writeCss(sheet);
		done();
	}
};
//#endregion
//#region src/debug.ts
async function debug(ctx, options) {
	const files = ctx.getFiles();
	const measureTotal = _bamboocss_logger.logger.time.debug(`Done parsing ${files.length} files`);
	ctx.config.minify = false;
	const { fs, path: path$5 } = ctx.runtime;
	const outdir = options.outdir;
	if (!options.dry && outdir) {
		fs.ensureDirSync(outdir);
		_bamboocss_logger.logger.info("cli", `Writing ${_bamboocss_logger.colors.bold(`${outdir}/config.json`)}`);
		await fs.writeFile(`${outdir}/config.json`, JSON.stringify(ctx.config, null, 2));
	}
	if (options.onlyConfig) {
		measureTotal();
		return;
	}
	const filesWithCss = [];
	ctx.prepareNativeExtraction(files);
	files.map((file) => {
		const measure = _bamboocss_logger.logger.time.debug(`Parsed ${file}`);
		const encoder = ctx.encoder.clone();
		const result = ctx.parseFile(file, encoder);
		measure();
		if (!result || result.isEmpty() || encoder.isEmpty()) return;
		const styles = ctx.decoder.clone().collect(encoder);
		const css = ctx.getParserCss(styles);
		if (!css) return;
		if (options.dry) {
			console.log({
				path: file,
				ast: result,
				code: css
			});
			return;
		}
		if (outdir) {
			filesWithCss.push(file);
			const parsedPath = (0, path.parse)(file);
			const relative = path$5.relative(ctx.config.cwd, parsedPath.dir);
			const astJsonPath = `${relative}${path$5.sep}${parsedPath.name}.ast.json`.replaceAll(path$5.sep, "__");
			const cssPath = `${relative}${path$5.sep}${parsedPath.name}.css`.replaceAll(path$5.sep, "__");
			_bamboocss_logger.logger.info("cli", `Writing ${_bamboocss_logger.colors.bold(`${outdir}/${astJsonPath}`)}`);
			_bamboocss_logger.logger.info("cli", `Writing ${_bamboocss_logger.colors.bold(`${outdir}/${cssPath}`)}`);
			return Promise.allSettled([fs.writeFile(`${outdir}${path$5.sep}${astJsonPath}`, JSON.stringify(result.toJSON(), null, 2)), fs.writeFile(`${outdir}${path$5.sep}${cssPath}`, css)]);
		}
	});
	_bamboocss_logger.logger.info("cli", `Found ${_bamboocss_logger.colors.bold(`${filesWithCss.length}/${files.length}`)} files using Bamboo`);
	measureTotal();
}
//#endregion
//#region src/generate.ts
async function build(ctx, sourceScanCache, artifactIds) {
	await codegen(ctx, artifactIds);
	if (ctx.config.emitTokensOnly) return _bamboocss_logger.logger.info("css:emit", "Successfully rebuilt the css variables and js function to query your tokens ✨");
	const done = _bamboocss_logger.logger.time.info("");
	const parsed = ctx.parseFiles();
	if (sourceScanCache) {
		for (const result of parsed.results) if (result.filePath) recordResolvedTokenReferences(sourceScanCache, ctx.runtime.path.abs(ctx.config.cwd, result.filePath), result);
	}
	const sheet = assembleExtractedSheet(ctx, sourceScanCache ? {
		layerParams: true,
		sourceScanCache,
		sourceInventory: parsed.files
	} : {
		layerParams: true,
		parserResults: parsed.results
	});
	await ctx.writeCss(sheet);
	done(ctx.messages.buildComplete(parsed.files.length));
}
async function generate(config, configPath) {
	let ctx = await loadConfigAndCreateContext({
		config,
		configPath
	});
	const sourceScanCache = createSourceScanCache();
	const { cwd, watch, poll } = ctx.config;
	await build(ctx, watch ? sourceScanCache : void 0);
	if (watch) {
		ctx.watchConfig(async () => {
			const affecteds = await ctx.diff.reloadConfigAndRefreshContext((conf) => {
				ctx = new BambooContext(conf);
			});
			sourceScanCache.entries.clear();
			sourceScanCache.resolvedTokenReferences.clear();
			_bamboocss_logger.logger.info("ctx:updated", "config rebuilt ✅");
			await ctx.hooks["config:change"]?.({
				config: ctx.config,
				changes: affecteds
			});
			return build(ctx, sourceScanCache, Array.from(affecteds.artifacts));
		}, {
			cwd,
			poll
		});
		/**
		* Re-parses every affected file, then builds and writes the stylesheet once.
		*
		* One edit can affect many files — a shared style file is folded into all of
		* its importers — and the sheet is rebuilt from the whole parser result, not
		* per file. Writing per file would run the optimize pipeline and hit the disk
		* once per importer for a single keystroke.
		*/
		const bundleStyles = async (ctx, changedFilePaths, inventoryChanged = false) => {
			let parsed = 0;
			ctx.prepareNativeExtraction(changedFilePaths);
			for (const filePath of changedFilePaths) {
				const result = ctx.parseFile(filePath);
				recordResolvedTokenReferences(sourceScanCache, filePath, result);
				if (result) parsed++;
			}
			if (parsed === 0 && !inventoryChanged) return;
			const outfile = ctx.runtime.path.join(...ctx.paths.root, "styles.css");
			const done = _bamboocss_logger.logger.time.info(ctx.messages.buildComplete(parsed));
			const sheet = assembleExtractedSheet(ctx, {
				layerParams: true,
				sourceScanCache
			});
			const css = ctx.getCss(sheet);
			await ctx.runtime.fs.writeFile(outfile, css);
			done();
		};
		ctx.watchFiles(async (event, file) => {
			const filePath = ctx.runtime.path.abs(cwd, file);
			if (event === "unlink") {
				const dependents = ctx.getNativeDependents(filePath);
				ctx.project.removeSourceFile(filePath);
				ctx.forgetNativeFile(filePath);
				sourceScanCache.entries.delete(filePath);
				sourceScanCache.resolvedTokenReferences.delete(filePath);
				await bundleStyles(ctx, dependents, true);
			} else if (event === "change") {
				const dependents = ctx.getNativeDependents(filePath);
				ctx.project.reloadSourceFile(filePath);
				await bundleStyles(ctx, [...new Set([filePath, ...dependents])]);
			} else if (event === "add") {
				const dependents = ctx.getNativeDependents(filePath);
				await bundleStyles(ctx, [...new Set([filePath, ...dependents])]);
			}
		});
	}
}
//#endregion
//#region src/git-ignore.ts
function setupGitIgnore(ctx) {
	const { outdir, gitignore } = ctx.config;
	if (!gitignore) return;
	const txt = outdent.default`
  
  ## Bamboo
  ${outdir}
  `;
	const file = (0, look_it_up.lookItUpSync)(".gitignore");
	if (!file) return (0, fs.writeFileSync)(".gitignore", txt);
	if (!(0, fs.readFileSync)(file, "utf-8").includes(outdir)) (0, fs.appendFileSync)(file, txt);
}
//#endregion
//#region src/logstream.ts
const setLogStream = (options) => {
	const { cwd = process.cwd() } = options;
	let stream;
	if (options.logfile) {
		const outPath = node_path.default.resolve(cwd, options.logfile);
		ensure(outPath);
		node_fs.default.closeSync(node_fs.default.openSync(outPath, "a"));
		_bamboocss_logger.logger.info("logfile", outPath);
		stream = node_fs.default.createWriteStream(outPath, { flags: "a" });
		_bamboocss_logger.logger.onLog = (entry) => {
			stream?.write(JSON.stringify(entry) + "\n");
		};
	}
	process.once("SIGINT", () => {
		stream?.end();
	});
	return {
		end() {
			stream?.end();
		},
		[Symbol.dispose]: () => {
			stream?.end();
		}
	};
};
const ensure = (outPath) => {
	const dirname = node_path.default.dirname(outPath);
	node_fs.default.mkdirSync(dirname, { recursive: true });
	return outPath;
};
//#endregion
//#region src/setup-config.ts
async function setupConfig(cwd, opts = {}) {
	const { force, outExtension, outdir = "styled-system", strictValues } = opts;
	let configFile;
	try {
		configFile = (0, _bamboocss_config.findConfig)({ cwd });
	} catch (err) {
		if (!(err instanceof _bamboocss_shared.BambooError)) throw err;
	}
	const { detect } = await import("package-manager-detector");
	const pm = ((await detect({ cwd }))?.agent ?? "npm").split("@")[0];
	const cmd = pm === "npm" ? "npm run" : pm;
	const file = (0, look_it_up.lookItUpSync)("tsconfig.json", cwd) ? "bamboo.config.ts" : "bamboo.config.mjs";
	_bamboocss_logger.logger.info("init:config", `creating bamboo config file: ${(0, _bamboocss_logger.quote)(file)}`);
	if (!force && configFile) _bamboocss_logger.logger.warn("init:config", _bamboocss_core.messages.configExists(cmd));
	else {
		const content = outdent.outdent`
import { defineConfig } from "@bamboocss/dev"

export default defineConfig({
    // Whether to use css reset
    preflight: true,
    ${outExtension ? `\n // The extension for the emitted JavaScript files\noutExtension: '${outExtension}',` : ""}
    // Where to look for your css declarations
    include: ["./src/**/*.{js,jsx,ts,tsx}", "./pages/**/*.{js,jsx,ts,tsx}"],
${strictValues ? `
// Require every style value to be a token, so a raw css value is written \`[14px]\`.
// A misspelled token is reported by the build whether or not this is on.
strictValues: ${JSON.stringify(strictValues)},\n` : ""}

    // Files to exclude
    exclude: [],

    // Tokens, keyframes and @property rules nothing in the emitted css reaches are dropped
    // by default — worth 36-78% of a new project's stylesheet. If you read tokens from
    // somewhere the build cannot see them — \`token()\` with a computed path, or a
    // hand-written stylesheet outside \`include\` — name the categories they land in with
    // \`prune: { keepTokens: ['colors.*'] }\`, or set \`prune: { tokens: false }\`.

    // Useful for theme customization
    theme: {
      extend: {}
    },

    // The output directory for your css system
    outdir: ${JSON.stringify(outdir)},
})
    `;
		const filePath = (0, path.join)(cwd, file);
		await fs_extra.default.writeFile(filePath, content);
		try {
			(0, child_process.execFileSync)("oxfmt", [filePath], { stdio: "ignore" });
		} catch {}
		_bamboocss_logger.logger.log(_bamboocss_core.messages.thankYou());
	}
}
//#endregion
//#region src/spec.ts
async function spec(ctx, options) {
	const { outdir } = options;
	const specs = ctx.getSpec();
	const specDir = outdir ? [ctx.config.cwd, outdir] : ctx.paths.specs;
	const specDirPath = ctx.runtime.path.join(...specDir);
	const writeSpec = async (spec) => {
		await ctx.output.write({
			id: `spec-${spec.type}`,
			dir: specDir,
			files: [{
				file: `${spec.type}.json`,
				code: JSON.stringify(spec, null, 2)
			}]
		});
	};
	await Promise.all(specs.map(writeSpec));
	const specTypes = specs.map((s) => s.type);
	_bamboocss_logger.logger.info("spec", `Generated ${specTypes.length} spec file(s) → ${specDirPath}`);
	return specs;
}
//#endregion
//#region src/vite-integration.ts
/**
* Every extension Vite accepts for its config, so "is this a Vite project" is answered by the
* same file Vite itself would load.
*
* A file rather than a resolvable `vite` package: Vite is a transitive dependency of plenty of
* things — Vitest above all — and a project that has one for its tests and builds with webpack
* is exactly the case this must not mistake for a Vite app.
*/
const VITE_CONFIG_FILES = [
	"vite.config.ts",
	"vite.config.js",
	"vite.config.mjs",
	"vite.config.mts",
	"vite.config.cjs",
	"vite.config.cts"
];
/** The project's Vite config, if it has one. Not resolved further than existence. */
const findViteConfig = (cwd) => VITE_CONFIG_FILES.map((file) => (0, path.join)(cwd, file)).find((file) => (0, fs.existsSync)(file));
/**
* Frameworks that author styles in a file the Vite compiler does not transform as JavaScript
* until a dedicated preprocessor exists. Vue, Svelte and Astro compile through
* `bamboocss:compiler-sfc`. HTML / Handlebars templates still do not.
*/
const TEMPLATE_EXTENSIONS = /\b(?:html|hbs)\b/;
const TEMPLATE_PACKAGES = [];
/**
* Does this project author styles somewhere the Vite compiler cannot reach?
*
* Two signals because the two callers know different things. A resolved config names the file
* types directly, and is authoritative when it does; `bamboo init` runs before there is one,
* so the dependency list stands in. Either one is enough — both directions of a wrong answer
* here only decide whether advice is offered, and the advice is worth less than a Svelte
* project being told to break itself.
*/
const hasUncompilableSources = (options) => {
	if (options.include?.some((glob) => TEMPLATE_EXTENSIONS.test(glob))) return true;
	try {
		const manifest = JSON.parse((0, fs.readFileSync)((0, path.join)(options.cwd, "package.json"), "utf8"));
		const dependencies = {
			...manifest.dependencies,
			...manifest.devDependencies
		};
		return TEMPLATE_PACKAGES.some((name) => name in dependencies);
	} catch {
		return false;
	}
};
//#endregion
exports.BambooContext = BambooContext;
exports.Builder = Builder;
exports.ParserResult = ParserResult;
exports.SourceProject = SourceProject;
exports.analyze = analyze;
exports.buildInfo = buildInfo;
exports.codegen = codegen;
exports.cssgen = cssgen;
exports.debug = debug;
exports.findViteConfig = findViteConfig;
exports.generate = generate;
Object.defineProperty(exports, "generatePackageExports", {
	enumerable: true,
	get: function() {
		return _bamboocss_generator.generatePackageExports;
	}
});
exports.hasUncompilableSources = hasUncompilableSources;
exports.isStaticCompilerActive = require_static_compiler.isStaticCompilerActive;
exports.loadConfigAndCreateContext = loadConfigAndCreateContext;
exports.markStaticCompilerActive = require_static_compiler.markStaticCompilerActive;
exports.setLogStream = setLogStream;
exports.setupConfig = setupConfig;
exports.setupGitIgnore = setupGitIgnore;
exports.spec = spec;
exports.startProfiling = startProfiling;
