import { createContext } from '@bamboocss/fixture'
import { esc } from '@bamboocss/shared'
import type { Config } from '@bamboocss/types'
import { isAbsolute, join } from 'node:path'
import { foldSource, type FoldResult } from '../src/fold'
import { createRuntimeCss } from '../src/runtime-css'
import { createStaticStyleSetCompiler } from '../src/style-set'

export const FILE_PATH = 'app/src/test.tsx'

export const createFoldFixture = (userConfig?: Parameters<typeof createContext>[0]) => {
  const ctx = createContext(userConfig)
  const runtimeCss = createRuntimeCss(ctx)
  const styleCompiler = createStaticStyleSetCompiler(ctx, runtimeCss)

  /**
   * Where a fixture path lives. Relative paths resolve against the project's working
   * directory, as they do everywhere else; nothing is written there — the bytes are an overlay
   * both the extractor and the compiler read instead of disk.
   */
  const pathOf = (filePath: string) => (isAbsolute(filePath) ? filePath : join(ctx.config.cwd, filePath))

  /**
   * The stylesheet pass's reading of a module, which is what gives a folded class a rule.
   * Runs against the overlay, so a later fold of the same path sees the same bytes.
   */
  const extract = (filePath: string, code: string) => {
    ctx.project.overlaySource(filePath, code)
    ctx.parseFile(filePath)
  }

  const compile = (code: string, filePath: string, reportSurvivors: boolean, maxRecipeStates?: number) => {
    const path = pathOf(filePath)
    extract(path, code)
    const [analysis] = ctx.compileModules([{ filename: path, source: code }], { references: reportSurvivors })
    return foldSource({
      ctx,
      code,
      analysis: analysis!,
      filePath: path,
      styleCompiler,
      maxRecipeStates,
      reportSurvivors,
    })
  }

  const fold = (code: string, filePath = FILE_PATH, reportSurvivors = false): FoldResult =>
    compile(code, filePath, reportSurvivors)

  /** What `strict` would see: the fold with its output-based survivor check on. */
  const foldStrict = (code: string, filePath = FILE_PATH): FoldResult => fold(code, filePath, true)

  /** Fold recipes to globally shared utility atoms, as the strict production compiler does. */
  const foldStyleSets = (code: string, filePath = FILE_PATH, maxRecipeStates?: number): FoldResult =>
    compile(code, filePath, false, maxRecipeStates)

  /**
   * Fold several times in a row, as the vite plugin does across a build.
   *
   * Kept as its own name because the tests using it are about state that outlives one module
   * — there is none now, since every analysis reads the project's current bytes, and those
   * tests pin that it stays that way.
   */
  const foldWithCache = fold

  /** Add the modules an entry imports before folding it. */
  const addFiles = (files: Record<string, string>) => {
    for (const [path, source] of Object.entries(files)) extract(pathOf(path), source)
  }

  /** CSS for everything parsed through this fixture so far. */
  const getCss = () => {
    const sheet = ctx.createSheet()
    ctx.appendParserCss(sheet)
    return ctx.getCss(sheet)
  }

  /** CSS backing the classes emitted by `foldStyleSets`. */
  const getStyleSetCss = () => {
    ctx.encoder.atomizeObservedRecipes()
    const sheet = ctx.createSheet()
    ctx.appendParserCss(sheet)
    return ctx.getCss(sheet)
  }

  return { ctx, fold, foldStrict, foldStyleSets, foldWithCache, addFiles, getCss, getStyleSetCss, runtimeCss, pathOf }
}

/**
 * The class names a folded call resolved to.
 *
 * A fold emits the attribute form (`c_red.300`); the stylesheet emits the escaped
 * selector form (`.c_red\.300`). `esc` is the forward transform the decoder applies,
 * so applying it here compares the two without needing a fragile inverse.
 */
export const selectorsFor = (className: string) =>
  className
    .split(' ')
    .filter(Boolean)
    .map((name) => `.${esc(name)}`)

export const foldCode = (code: string, userConfig?: Config) => createFoldFixture(userConfig).fold(code).code
