import type { BambooContext } from './create-context'

/** What `bamboo doctor` found: the project as the build reads it, and what stops the build. */
export interface DoctorReport {
  cwd: string
  /** The config file the project was loaded from. */
  config: string
  /** The files `include` and `exclude` select. */
  sources: number
  /** The generated `styled-system`, against what `bamboo codegen` would write now. */
  artifacts: {
    outdir: string
    files: number
    /** Absent, relative to `outdir`. */
    missing: string[]
    /** Present and other than codegen would write them, relative to `outdir`. */
    stale: string[]
    /**
     * Generated once and no longer, which `bamboo codegen` removes, relative to `outdir`: a module
     * for a pattern or recipe the config dropped resolves, and answers with class names for rules
     * that are gone.
     */
    leftover: string[]
  }
  /** Files the build could not extract, relative to `cwd`, with why. */
  unextracted: Array<{ file: string; message: string }>
  /** Calls to a pattern or recipe the entrypoint does not export, as `file: name`. */
  deadCalls: string[]
  /** Whether a file of the project's names `@bamboocss/vite`: registers the plugin, or reads its types. */
  usesVitePlugin: boolean
  /**
   * Whether a file of the project's names `virtual:bamboo.css`, which a project registering the
   * plugin has to import: without it `vite build` fails, and a dev server renders pages unstyled.
   */
  importsStylesheet: boolean
  conditions: number
  /** Token count by category. */
  tokens: Record<string, number>
  utilities: number
  recipes: number
  patterns: number
  /** One line for each thing to fix; the command fails when there is any. */
  problems: string[]
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The files a project registers the plugin and imports the stylesheet from, which can be anywhere
 * in it: an entry module, a root layout, `nuxt.config.ts`, `.storybook/preview.ts`, `index.html`.
 * Not its dependencies, nor what codegen writes, and declaration files are not read at all.
 */
const sourceGlobs = [
  '**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,vue,svelte,astro,mdx,html}',
  '.storybook/**/*.{js,jsx,ts,tsx,mjs,mts}',
]

/**
 * Whether the project registers the Vite plugin, and whether it imports `virtual:bamboo.css`.
 *
 * Read off the text, as a mention, so a commented-out import counts as one: what this finds wrong
 * is that nothing mentions the stylesheet at all, which it can say without a false alarm.
 */
const scanStylesheetImport = (ctx: BambooContext) => {
  const { fs, path } = ctx.runtime
  const cwd = ctx.config.cwd
  const outdir = path.relative(cwd, path.resolve(cwd, ctx.config.outdir)).replaceAll('\\', '/')
  const files = fs.glob({ include: sourceGlobs, exclude: ['**/node_modules/**', `${outdir}/**`], cwd })

  let usesVitePlugin = false
  let importsStylesheet = false
  for (const file of files) {
    let text: string
    try {
      text = fs.readFileSync(file)
    } catch {
      continue
    }
    usesVitePlugin ||= text.includes('@bamboocss/vite')
    importsStylesheet ||= text.includes('virtual:bamboo.css')
    if (usesVitePlugin && importsStylesheet) break
  }
  return { usesVitePlugin, importsStylesheet }
}

/**
 * Whether a generated file holds what codegen would write there.
 *
 * A file that cannot be read is not — codegen writes over it, as `OutputEngine` does. A
 * `package.json` is the consumer's as much as codegen's: `emit-pkg` writes entrypoints into it
 * and codegen only fills in the keys that are absent, so it is current when it has every one.
 */
const isCurrent = (ctx: BambooContext, file: string, name: string, code: string) => {
  let text: string
  try {
    text = ctx.runtime.fs.readFileSync(file)
  } catch {
    return false
  }
  if (name !== 'package.json') return text === code
  try {
    const existing = JSON.parse(text)
    return Object.keys(JSON.parse(code)).every((key) => existing[key] !== undefined)
  } catch {
    return false
  }
}

/**
 * Check a project the way the build reads it, without writing anything.
 *
 * What it reports are the causes of a build that does not do what it is asked, in the order a
 * reader would look: a generated `styled-system` out of step with the config — the types and the
 * runtime say one thing and the stylesheet another — a source the extractor cannot read, whose
 * every style is absent, and a call naming a pattern or recipe that does not exist.
 */
export async function doctor(ctx: BambooContext): Promise<DoctorReport> {
  const { fs, path } = ctx.runtime
  const cwd = ctx.config.cwd
  const outdir = path.join(...ctx.paths.root)
  const relativeToOutdir = (file: string) => path.relative(outdir, file)

  // What `bamboo codegen` would write, a plugin's `codegen:prepare` included.
  let artifacts = ctx.getArtifacts()
  artifacts = (await ctx.hooks['codegen:prepare']?.({ artifacts, changed: undefined })) ?? artifacts

  const missing: string[] = []
  const stale: string[] = []
  let files = 0
  for (const artifact of artifacts) {
    if (!artifact) continue
    const dir = artifact.dir ?? ctx.paths.root
    for (const entry of artifact.files) {
      if (!entry?.code) continue
      files++
      const file = path.join(...dir, entry.file)
      if (!fs.existsSync(file)) missing.push(relativeToOutdir(file))
      else if (!isCurrent(ctx, file, entry.file, entry.code)) stale.push(relativeToOutdir(file))
    }
  }
  const leftover = ctx.output.prune(artifacts, { dry: true }).stale.map(relativeToOutdir)

  const sources = ctx.getFiles()
  try {
    ctx.parseFiles()
  } catch (error) {
    // The two checks that fail the build on what this reports, below, from what they recorded.
    // Anything else — the native extractor failing to load — is no finding, and a report saying
    // nothing is wrong would be one.
    const { code } = error as { code?: string }
    if (code !== 'ERR_BAMBOO_EXTRACT_FAILED' && code !== 'ERR_BAMBOO_DEAD_IMPORT') throw error
  }
  const unextracted = Array.from(ctx.parseFailures, ([file, error]) => ({
    file: path.relative(cwd, file),
    message: messageOf(error),
  }))
  const deadCalls = Array.from(ctx.deadCalls, ([file, calls]) =>
    calls.map((call) => `${path.relative(cwd, file)}: ${call.alias}`),
  ).flat()

  const tokens: Record<string, number> = {}
  for (const [category, values] of ctx.tokens.view.categoryMap) tokens[category] = values.size

  const { usesVitePlugin, importsStylesheet } = scanStylesheetImport(ctx)

  const problems: string[] = []
  const outOfStep = [
    missing.length && `${missing.length} missing`,
    stale.length && `${stale.length} out of date`,
    leftover.length && `${leftover.length} no longer generated`,
  ].filter(Boolean)
  if (outOfStep.length) {
    problems.push(
      `The generated files in ${path.relative(cwd, outdir) || '.'} are out of step with the config, ` +
        `${outOfStep.join(', ')}: run \`bamboo codegen\`.`,
    )
  }
  if (unextracted.length) problems.push(`${unextracted.length} source file(s) could not be extracted.`)
  if (deadCalls.length) problems.push(`${deadCalls.length} call(s) name a pattern or recipe that does not exist.`)
  if (usesVitePlugin && !importsStylesheet) {
    problems.push(
      'Nothing imports `virtual:bamboo.css`, so pages render unstyled and `vite build` fails: import it once, from ' +
        'the application entry module.',
    )
  }

  return {
    cwd,
    config: ctx.conf.path,
    sources: sources.length,
    artifacts: { outdir, files, missing, stale, leftover },
    unextracted,
    deadCalls,
    usesVitePlugin,
    importsStylesheet,
    conditions: ctx.conditions.keys().length,
    tokens,
    utilities: ctx.utility.keys().length,
    recipes: ctx.recipes.keys.length,
    patterns: ctx.patterns.keys.length,
    problems,
  }
}

/** The report as a reader takes it in: the project first, then what to fix. */
export function formatDoctorReport(report: DoctorReport): string {
  const tokenCount = Object.values(report.tokens).reduce((sum, count) => sum + count, 0)
  const categories = Object.keys(report.tokens).length
  const lines = [
    `config      ${report.config}`,
    `sources     ${report.sources} file(s)`,
    `styled-system ${report.artifacts.outdir}, ${report.artifacts.files} file(s)`,
    ...(report.usesVitePlugin
      ? [`stylesheet  virtual:bamboo.css ${report.importsStylesheet ? 'imported' : 'not imported'}`]
      : []),
    `tokens      ${tokenCount} in ${categories} categor${categories === 1 ? 'y' : 'ies'}`,
    `conditions  ${report.conditions}`,
    `utilities   ${report.utilities}`,
    `recipes     ${report.recipes}`,
    `patterns    ${report.patterns}`,
  ]

  // The report keeps each path as the platform spells it; the text names it as `include` is
  // written, with `/`, so it reads the same on Windows.
  const detail = (title: string, items: string[]) =>
    items.length ? [``, title, ...items.map((item) => `  ${item}`)] : []
  const files = (items: string[]) => items.map((item) => item.replaceAll('\\', '/'))
  lines.push(
    ...detail('missing', files(report.artifacts.missing)),
    ...detail('out of date', files(report.artifacts.stale)),
    ...detail('no longer generated', files(report.artifacts.leftover)),
    ...detail(
      'not extracted',
      report.unextracted.map(
        ({ file, message }) => `${file.replaceAll('\\', '/')}: ${message.split('\n').find(Boolean) ?? ''}`,
      ),
    ),
    ...detail('calls to nothing', files(report.deadCalls)),
  )

  lines.push('', report.problems.length ? report.problems.join('\n') : 'No problems found.')
  return lines.join('\n')
}
