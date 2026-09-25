import { createRequire } from "node:module";
//#region src/astro-to-tsx.ts
/**
* Astro's compiler, loaded the first time a `.astro` file is actually parsed.
*
* Auto-injected into every project, so a static import would make every build pay to load a
* compiler most projects never call — the reason the Vue and Svelte plugins load theirs lazily
* too. The `sync` entry because `parser:before` is synchronous. `@astrojs/compiler` is an
* optional peer: `astro` depends on it, so a project with `.astro` files already has it.
*/
let convert;
const load = () => convert ??= createRequire(import.meta.url)("@astrojs/compiler/sync").convertToTSX;
/** The inline source map Astro appends, which nothing downstream reads. */
const SOURCE_MAP_COMMENT = /\n\/\/# sourceMappingURL=data:[^\n]*\s*$/;
/**
* A `.astro` file as TSX the extractor can parse.
*
* Nothing converted these before: the TypeScript parser read the raw file, recovering from the
* `---` fences and the template well enough to find calls in it. Oxc, which does all extraction
* now, rejects that text, failing the build on every Astro component.
*
* Astro's own TSX output is what its language tools type-check against — the frontmatter as
* module code, the template as JSX in a fragment — so it is valid by construction and keeps
* every expression the template evaluates, `class={css({ … })}` included.
*/
const astroToTsx = (code, filename) => {
	let result;
	try {
		result = load()(code, { filename });
	} catch {
		return "";
	}
	return result.code.replace(SOURCE_MAP_COMMENT, "\n");
};
//#endregion
//#region src/index.ts
function pluginAstro() {
	return {
		name: "@bamboocss/plugin-astro",
		hooks: { "parser:before": ({ filePath, content }) => {
			if (filePath.endsWith(".astro")) return astroToTsx(content, filePath);
		} }
	};
}
//#endregion
export { astroToTsx, pluginAstro };
