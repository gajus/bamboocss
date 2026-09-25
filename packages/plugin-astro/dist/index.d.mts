import { BambooPlugin } from "@bamboocss/types";

//#region src/astro-to-tsx.d.ts
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
declare const astroToTsx: (code: string, filename?: string) => string;
//#endregion
//#region src/index.d.ts
declare function pluginAstro(): BambooPlugin;
//#endregion
export { astroToTsx, pluginAstro };