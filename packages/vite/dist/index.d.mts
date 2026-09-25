import MagicString from "magic-string";
import { Plugin } from "vite";
//#region src/css.d.ts
/**
 * What a project imports to get the stylesheet.
 *
 * Spelled with a `.css` extension because that is how vite decides what a module is: the
 * id is all it has for a module with no file behind it, so `virtual:bamboo` would be
 * bundled as javascript and injected as a script.
 */
declare const VIRTUAL_CSS_ID = "virtual:bamboo.css";
//#endregion
//#region src/plugin.d.ts
interface BambooVitePluginOptions {
  /** Path to `bamboo.config.ts`. Resolved the same way the CLI resolves it. */
  configPath?: string;
  cwd?: string;
  /**
   * Report every call site the compiler rejected, and why, per file.
   *
   * @default false
   */
  reportSkipped?: boolean;
  /**
   * Print a coverage summary when the build finishes: how much compiled, and why any
   * candidates were rejected.
   *
   * On by default. Without it there is no signal that the transform did anything, and
   * no way to tell a project where everything folds from one where nothing does.
   *
   * @default true
   */
  reportSummary?: boolean;
  /**
   * Maximum complete selections compiled for one runtime `cva`/`sva` call. This bounds
   * build time and memory for the exact compound-variant decision table. @default 65536
   */
  maxRecipeStates?: number;
  /**
   * Remove rules for atoms no compiled module can emit. Builds only; dev never prunes.
   *
   * Off ships the whole extracted stylesheet: every rule the source graph produced, including
   * ones nothing reaches. Larger, and never wrong *by pruning*. Bamboo still refuses a sheet
   * which lacks a compiler-owned rule named by live JavaScript; disabling pruning cannot make
   * that mixed-generation output styled.
   *
   * The pruned sheet is also renamed to a hash of its own bytes, and that is not a separate
   * setting because it cannot safely be one. Rollup and Rolldown expand `[hash]` before
   * `generateBundle`, where pruning has to run, so the name Vite assigned describes the sheet
   * as it was *before* pruning. Leaving that name on pruned bytes is how a stale stylesheet
   * outlives a deploy — a change to reachability alone, which is what upgrading Bamboo is,
   * leaves identical source CSS under an identical name with different content, and a CDN
   * holding that key keeps serving the old one. So the bytes and the name move together or
   * neither does.
   *
   * Reach for this if something downstream derives an artifact from the stylesheet's *content*
   * during `generateBundle` before Bamboo runs — subresource integrity is the clear case, since
   * an `integrity` attribute is a digest of the bytes and no amount of reference rewriting can
   * carry it across an edit — or to rule pruning out while diagnosing a missing rule. Where the
   * consumer can be moved after Bamboo instead (`order: 'post'`, `writeBundle`, `closeBundle`),
   * do that and keep the pruning.
   *
   * @default true
   */
  pruneCss?: boolean;
  /**
   * Give each lazily loaded chunk a stylesheet of the utilities only it uses, and keep the
   * rest in the entry sheet. Builds only, and only where Vite's own `build.cssCodeSplit` is on.
   *
   * An atom two chunks use stays in the entry sheet, so nothing is ever downloaded twice; a
   * route that is the only user of a style downloads that style with the route. Precedence
   * does not depend on which sheet a rule is in, since it lives in the cascade sublayers.
   *
   * @default true
   */
  splitCss?: boolean;
}
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
declare const bamboocss: (options?: BambooVitePluginOptions) => Plugin[];
//#endregion
export { type BambooVitePluginOptions, VIRTUAL_CSS_ID, bamboocss, bamboocss as default };